import AdmZip from "adm-zip";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { setTimeout } from "timers/promises";

import type { StringNumber } from "../../types/general";
import { getLogger } from "../logger";

const logger = getLogger("Project");

const MAX_RETRIES = 5;
const MAX_REDIRECTS = 5;
const MAX_PROJECT_SIZE = 100 * 1024 * 1024;
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class UnsafeProjectUrlError extends Error {}

const isPrivateIpAddress = (address: string): boolean => {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("::ffff:")
  );
};

const validateProjectUrl = async (url: URL): Promise<void> => {
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new UnsafeProjectUrlError("Project URL must use HTTPS without credentials or a custom port");
  }

  if (url.hostname === "localhost") {
    throw new UnsafeProjectUrlError("Project URL cannot target localhost");
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIpAddress(address))) {
    throw new UnsafeProjectUrlError("Project URL resolved to a private or reserved address");
  }
};

const fetchProjectFile = async (initialUrl: string): Promise<Response> => {
  let url = new URL(initialUrl);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await validateProjectUrl(url);
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirectCount === MAX_REDIRECTS) {
      throw new UnsafeProjectUrlError("Project URL exceeded the redirect limit");
    }

    url = new URL(location, url);
  }

  throw new UnsafeProjectUrlError("Project URL exceeded the redirect limit");
};

const readProjectBody = async (response: Response): Promise<Buffer> => {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PROJECT_SIZE) {
    await response.body?.cancel();
    throw new UnsafeProjectUrlError("Project file exceeds the maximum allowed size");
  }

  if (!response.body) {
    throw new Error("Project response did not contain a body");
  }

  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of response.body) {
    totalSize += chunk.byteLength;
    if (totalSize > MAX_PROJECT_SIZE) {
      await response.body.cancel();
      throw new UnsafeProjectUrlError("Project file exceeds the maximum allowed size");
    }
    chunks.push(Buffer.from(chunk));
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
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status < 500 && ![408, 429].includes(response.status)) {
        logger.warn({ status: response.status, url: logUrl }, "Project file request was rejected");
        return null;
      }

      logger.warn({ status: response.status, url: logUrl }, "Failed to fetch project file, retrying...");
      await setTimeout(1000);
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
    if (error instanceof UnsafeProjectUrlError) {
      logger.error({ error: error.message, url: logUrl }, "Unsafe project file request rejected");
      return null;
    }

    logger.warn({ error: (error as Error).message, url: logUrl }, "Error fetching project file, retrying...");
    await setTimeout(1000);
    return extractProjectImage(data, attempt + 1);
  }
};
