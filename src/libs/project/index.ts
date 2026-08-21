import AdmZip from "adm-zip";
import type { LookupAddress, LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import type { StringNumber } from "../../types/general";
import { getLogger } from "../logger";

const logger = getLogger("Project");

const MAX_RETRIES = 5;
const MAX_REDIRECTS = 5;
const MAX_PROJECT_SIZE = 100 * 1024 * 1024;
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
const DNS_LOOKUP_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 15_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class ProjectDownloadRejectedError extends Error {}

const blockedIpv4Addresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}

const blockedIpv6Addresses = new BlockList();

for (const [network, prefix] of [
  ["::", 96],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8]
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

const isPrivateIpAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) {
    return blockedIpv4Addresses.check(address, "ipv4");
  }
  return family !== 6 || blockedIpv6Addresses.check(address, "ipv6");
};

/**
 * Node 24 cannot cancel dns.lookup. This timeout only bounds the application wait; the underlying getaddrinfo work may
 * continue in libuv's thread pool. Promise.race keeps observing that lookup, so a late rejection is still handled.
 */
const lookupProjectHostname = async (hostname: string): Promise<LookupAddress[]> => {
  const { promise: timeoutPromise, reject: rejectTimeout } = Promise.withResolvers<never>();
  const timeout = setTimeout(() => {
    rejectTimeout(new Error(`DNS lookup timed out after ${DNS_LOOKUP_TIMEOUT_MS} ms`));
  }, DNS_LOOKUP_TIMEOUT_MS);

  try {
    return await Promise.race([lookup(hostname, { all: true, order: "verbatim" }), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
};

const validateProjectUrl = async (url: URL): Promise<LookupAddress[]> => {
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new ProjectDownloadRejectedError("Project URL must use HTTPS without credentials or a custom port");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const hostnameWithoutTrailingDot = hostname.replace(/\.$/, "");
  if (hostnameWithoutTrailingDot === "localhost" || hostnameWithoutTrailingDot.endsWith(".localhost")) {
    throw new ProjectDownloadRejectedError("Project URL cannot target localhost");
  }

  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await lookupProjectHostname(hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIpAddress(address))) {
    throw new ProjectDownloadRejectedError("Project URL resolved to a private or reserved address");
  }

  return addresses;
};

const requestedFamily = (family: LookupOptions["family"]): number => {
  if (family === 4 || family === "IPv4") {
    return 4;
  }
  if (family === 6 || family === "IPv6") {
    return 6;
  }
  return 0;
};

const createPinnedLookup =
  (addresses: LookupAddress[]): LookupFunction =>
  (_hostname, options, callback) => {
    const family = requestedFamily(options.family);
    const matchingAddresses = family === 0 ? addresses : addresses.filter(address => address.family === family);

    if (matchingAddresses.length === 0) {
      const error = new Error("No validated address matches the requested IP family") as NodeJS.ErrnoException;
      error.code = "ENOTFOUND";
      callback(error, options.all ? [] : "", family);
      return;
    }

    if (options.all) {
      callback(null, matchingAddresses);
      return;
    }

    const [address] = matchingAddresses;
    callback(null, address.address, address.family);
  };

const requestProjectUrl = (url: URL, addresses: LookupAddress[]): Promise<IncomingMessage> =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        agent: false,
        lookup: createPinnedLookup(addresses),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      },
      resolve
    );
    request.once("error", reject);
    request.end();
  });

const fetchProjectFile = async (initialUrl: string): Promise<IncomingMessage> => {
  let url: URL;
  try {
    url = new URL(initialUrl);
  } catch {
    throw new ProjectDownloadRejectedError("Project URL is invalid");
  }

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const addresses = await validateProjectUrl(url);
    const response = await requestProjectUrl(url, addresses);

    if (![301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      return response;
    }

    const location = response.headers.location;
    response.destroy();
    if (!location || redirectCount === MAX_REDIRECTS) {
      throw new ProjectDownloadRejectedError("Project URL exceeded the redirect limit");
    }

    try {
      url = new URL(location, url);
    } catch {
      throw new ProjectDownloadRejectedError("Project redirect URL is invalid");
    }
  }

  throw new ProjectDownloadRejectedError("Project URL exceeded the redirect limit");
};

const readProjectBody = async (response: IncomingMessage): Promise<Buffer> => {
  const contentLengthHeader = response.headers["content-length"];
  const contentLength = Number(Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader);
  if (Number.isFinite(contentLength) && contentLength > MAX_PROJECT_SIZE) {
    response.destroy();
    throw new ProjectDownloadRejectedError("Project file exceeds the maximum allowed size");
  }

  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of response) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalSize += bufferChunk.byteLength;
    if (totalSize > MAX_PROJECT_SIZE) {
      response.destroy();
      throw new ProjectDownloadRejectedError("Project file exceeds the maximum allowed size");
    }
    chunks.push(bufferChunk);
  }

  return Buffer.concat(chunks, totalSize);
};

export interface ExtractProjectImageData {
  url: string;
  plate: StringNumber;
}

/**
 * Télécharge le fichier 3mf et extrait l'image de prévisualisation de la plaque
 *
 * @param data Les données pour extraire l'image
 * @param attempt Le nombre de tentatives
 * @returns Le buffer de l'image PNG ou null
 */
export const extractProjectImage = async (
  data: ExtractProjectImageData,
  attempt: number = 0
): Promise<Buffer | null> => {
  if (attempt >= MAX_RETRIES) {
    logger.error({ maxRetries: MAX_RETRIES }, "Failed to extract project image after max attempts");
    return null;
  }

  const { url, plate } = data;
  const logUrl = (() => {
    try {
      const parsedUrl = new URL(url);
      return `${parsedUrl.origin}${parsedUrl.pathname}`;
    } catch {
      return "invalid URL";
    }
  })();

  try {
    const response = await fetchProjectFile(url);
    const status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      response.destroy();
      if (status < 500 && ![408, 429].includes(status)) {
        logger.warn({ status, url: logUrl }, "Project file request was rejected");
        return null;
      }

      logger.warn({ status, url: logUrl }, "Failed to fetch project file, retrying...");
      await delay(1000);
      return extractProjectImage(data, attempt + 1);
    }

    const projectBuffer = await readProjectBody(response);

    // Extraire l'image de la plaque depuis le fichier 3mf (qui est un zip)
    const projectZip = new AdmZip(projectBuffer);
    const plateEntry = projectZip.getEntry(`Metadata/plate_${plate}.png`);

    if (!plateEntry) {
      logger.error({ plate }, "Plate image not found in project file");
      return null;
    }

    if (plateEntry.header.size > MAX_IMAGE_SIZE) {
      logger.error({ plate, size: plateEntry.header.size }, "Plate image exceeds the maximum allowed size");
      return null;
    }

    const imageBuffer = plateEntry.getData();
    if (imageBuffer.length > MAX_IMAGE_SIZE || !imageBuffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      logger.error({ plate, size: imageBuffer.length }, "Plate image is too large or is not a valid PNG");
      return null;
    }

    logger.debug({ plate, size: imageBuffer.length }, "Project image extracted");

    return imageBuffer;
  } catch (error) {
    if (error instanceof ProjectDownloadRejectedError) {
      logger.error({ error, url: logUrl }, "Project file request rejected");
      return null;
    }

    logger.warn({ error, url: logUrl }, "Error fetching project file, retrying...");
    await delay(1000);
    return extractProjectImage(data, attempt + 1);
  }
};
