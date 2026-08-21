import AdmZip from "adm-zip";
import type { LookupAddress, LookupOptions } from "node:dns";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { extractProjectImage } from "../src/libs/project";
import type { StringNumber } from "../src/types/general";

const { loggerMock, lookupMock, requestMock, sleepMock } = vi.hoisted(() => ({
  loggerMock: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  },
  lookupMock: vi.fn(),
  requestMock: vi.fn(),
  sleepMock: vi.fn()
}));

vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("node:https", () => ({ request: requestMock }));
vi.mock("node:timers/promises", () => ({ setTimeout: sleepMock }));
vi.mock("../src/libs/logger", () => ({ getLogger: () => loggerMock }));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_IMAGE_SIZE = 15 * 1024 * 1024;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const PUBLIC_IPV4: LookupAddress = { address: "93.184.216.34", family: 4 };
const PUBLIC_IPV6: LookupAddress = { address: "2606:4700:4700::1111", family: 6 };

type PinnedLookup = NonNullable<RequestOptions["lookup"]>;

class FakeRequest extends EventEmitter {
  public readonly end = vi.fn();
}

const response = (
  statusCode: number,
  chunks: Iterable<Buffer> = [],
  headers: IncomingMessage["headers"] = {}
): IncomingMessage => {
  const message = Readable.from(chunks) as IncomingMessage;
  message.statusCode = statusCode;
  message.headers = headers;
  return message;
};

const projectArchive = (files: Record<string, Buffer>): Buffer => {
  const archive = new AdmZip();
  for (const [path, contents] of Object.entries(files)) {
    archive.addFile(path, contents);
  }
  return archive.toBuffer();
};

const pngArchive = (plate: StringNumber = "1", contents: Buffer = Buffer.concat([PNG_SIGNATURE, Buffer.from("png")])) =>
  projectArchive({ [`Metadata/plate_${plate}.png`]: contents });

const storedPngArchive = (contents: Buffer = Buffer.concat([PNG_SIGNATURE, Buffer.from("png")])): Buffer => {
  const archive = new AdmZip();
  const entry = archive.addFile("Metadata/plate_1.png", contents);
  entry.header.method = 0;
  return archive.toBuffer();
};

const patchZipHeaders = (
  archive: Buffer,
  patch: (patchedArchive: Buffer, localHeaderOffset: number, centralHeaderOffset: number) => void
): Buffer => {
  const patchedArchive = Buffer.from(archive);
  const endOffset = patchedArchive.lastIndexOf(END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  if (endOffset < 0) {
    throw new Error("Test ZIP is missing its end-of-central-directory record");
  }

  const centralHeaderOffset = patchedArchive.readUInt32LE(endOffset + 16);
  const localHeaderOffset = patchedArchive.readUInt32LE(centralHeaderOffset + 42);
  if (
    patchedArchive.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE ||
    patchedArchive.readUInt32LE(centralHeaderOffset) !== CENTRAL_DIRECTORY_HEADER_SIGNATURE
  ) {
    throw new Error("Test ZIP headers are malformed");
  }

  patch(patchedArchive, localHeaderOffset, centralHeaderOffset);
  return patchedArchive;
};

const respondToRequests = (createResponse: () => IncomingMessage): void => {
  requestMock.mockImplementation((_url: URL, _options: RequestOptions, callback: (value: IncomingMessage) => void) => {
    const request = new FakeRequest();
    request.end.mockImplementation(() => queueMicrotask(() => callback(createResponse())));
    return request;
  });
};

const failRequests = (error: Error): void => {
  requestMock.mockImplementation(() => {
    const request = new FakeRequest();
    request.end.mockImplementation(() => queueMicrotask(() => request.emit("error", error)));
    return request;
  });
};

const invokeLookup = (lookup: PinnedLookup, options: LookupOptions): Promise<string | LookupAddress[]> =>
  new Promise((resolve, reject) => {
    lookup("projects.example", options, (error, address) => {
      if (error) {
        reject(error);
      } else {
        resolve(address);
      }
    });
  });

const extract = (url: string = "https://projects.example/model.3mf", plate: StringNumber = "1") =>
  extractProjectImage({ url, plate });

describe("project image download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookupMock.mockResolvedValue([PUBLIC_IPV4]);
    sleepMock.mockResolvedValue(undefined);
  });

  it.each([
    ["a malformed URL", "not a URL"],
    ["HTTP", "http://projects.example/model.3mf"],
    ["credentials", "https://user:secret@projects.example/model.3mf"],
    ["a custom port", "https://projects.example:8443/model.3mf"],
    ["localhost", "https://localhost/model.3mf"],
    ["localhost with a trailing dot", "https://localhost./model.3mf"],
    ["a localhost subdomain", "https://printer.localhost/model.3mf"],
    ["IPv4 loopback", "https://127.0.0.1/model.3mf"],
    ["private IPv4", "https://192.168.1.2/model.3mf"],
    ["IPv6 loopback", "https://[::1]/model.3mf"],
    ["private IPv6", "https://[fd00::1]/model.3mf"],
    ["IPv4-mapped IPv6", "https://[::ffff:127.0.0.1]/model.3mf"],
    ["NAT64-encoded IPv4", "https://[64:ff9b::7f00:1]/model.3mf"]
  ])("rejects %s", async (_case, url) => {
    await expect(extract(url)).resolves.toBeNull();

    expect(requestMock).not.toHaveBeenCalled();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("rejects a hostname when any resolved IPv4 or IPv6 address is private", async () => {
    lookupMock.mockResolvedValue([
      PUBLIC_IPV4,
      PUBLIC_IPV6,
      { address: "10.0.0.2", family: 4 },
      { address: "fe80::1", family: 6 }
    ]);

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).not.toHaveBeenCalled();
  });

  it("pins every validated DNS address into the HTTPS connection without changing the hostname or TLS options", async () => {
    lookupMock.mockResolvedValue([PUBLIC_IPV4, PUBLIC_IPV6]);
    respondToRequests(() => response(404));

    await expect(extract()).resolves.toBeNull();

    const [url, options] = requestMock.mock.calls[0] as [URL, RequestOptions];
    expect(url.hostname).toBe("projects.example");
    expect(options.agent).toBe(false);
    expect(options).not.toHaveProperty("rejectUnauthorized");
    await expect(invokeLookup(options.lookup as PinnedLookup, { all: true })).resolves.toEqual([
      PUBLIC_IPV4,
      PUBLIC_IPV6
    ]);
    await expect(invokeLookup(options.lookup as PinnedLookup, { family: "IPv4" })).resolves.toBe(PUBLIC_IPV4.address);
    await expect(invokeLookup(options.lookup as PinnedLookup, { family: 6 })).resolves.toBe(PUBLIC_IPV6.address);
  });

  it("fails the pinned lookup rather than performing a new DNS query for an unavailable family", async () => {
    lookupMock.mockResolvedValue([PUBLIC_IPV6]);
    respondToRequests(() => response(404));

    await extract();

    const [, options] = requestMock.mock.calls[0] as [URL, RequestOptions];
    await expect(invokeLookup(options.lookup as PinnedLookup, { family: 4 })).rejects.toMatchObject({
      code: "ENOTFOUND"
    });
    expect(lookupMock).toHaveBeenCalledOnce();
  });

  it("uses separately validated and pinned addresses after a redirect", async () => {
    lookupMock.mockImplementation(async (hostname: string) =>
      hostname === "projects.example" ? [PUBLIC_IPV4] : [PUBLIC_IPV6]
    );
    const responses = [response(302, [], { location: "https://cdn.example/final.3mf" }), response(200, [pngArchive()])];
    respondToRequests(() => responses.shift() as IncomingMessage);

    await expect(extract()).resolves.toEqual(Buffer.concat([PNG_SIGNATURE, Buffer.from("png")]));

    expect(lookupMock).toHaveBeenNthCalledWith(1, "projects.example", { all: true, order: "verbatim" });
    expect(lookupMock).toHaveBeenNthCalledWith(2, "cdn.example", { all: true, order: "verbatim" });
    const [firstUrl, firstOptions] = requestMock.mock.calls[0] as [URL, RequestOptions];
    const [secondUrl, secondOptions] = requestMock.mock.calls[1] as [URL, RequestOptions];
    expect(firstUrl.hostname).toBe("projects.example");
    expect(secondUrl.hostname).toBe("cdn.example");
    await expect(invokeLookup(firstOptions.lookup as PinnedLookup, { all: true })).resolves.toEqual([PUBLIC_IPV4]);
    await expect(invokeLookup(secondOptions.lookup as PinnedLookup, { all: true })).resolves.toEqual([PUBLIC_IPV6]);
  });

  it("rejects a redirect that resolves to a private address", async () => {
    lookupMock.mockImplementation(async (hostname: string) =>
      hostname === "projects.example" ? [PUBLIC_IPV4] : [{ address: "169.254.169.254", family: 4 }]
    );
    respondToRequests(() => response(302, [], { location: "https://metadata.example/latest" }));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a malformed redirect without retrying", async () => {
    respondToRequests(() => response(302, [], { location: "https://[invalid" }));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("enforces the redirect limit", async () => {
    respondToRequests(() => response(302, [], { location: "/next.3mf" }));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledTimes(6);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("does not retry terminal HTTP errors", async () => {
    respondToRequests(() => response(404));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it.each([408, 429, 500, 503])("retries transient HTTP %i responses up to the configured limit", async status => {
    respondToRequests(() => response(status));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledTimes(5);
    expect(sleepMock).toHaveBeenCalledTimes(5);
  });

  it.each([
    ["connection errors", new Error("connection reset")],
    ["timeouts", new DOMException("request timed out", "TimeoutError")]
  ])("retries %s up to the configured limit", async (_case, error) => {
    failRequests(error);

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledTimes(5);
    expect(sleepMock).toHaveBeenCalledTimes(5);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      { error, url: "https://projects.example/model.3mf" },
      "Error fetching project file, retrying..."
    );
  });

  it("retries DNS errors up to the configured limit", async () => {
    const error = new Error("DNS lookup failed");
    lookupMock.mockRejectedValue(error);

    await expect(extract()).resolves.toBeNull();

    expect(lookupMock).toHaveBeenCalledTimes(5);
    expect(requestMock).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      { error, url: "https://projects.example/model.3mf" },
      "Error fetching project file, retrying..."
    );
  });

  it("times out pending DNS lookups and bounds their retries without making an HTTPS request", async () => {
    vi.useFakeTimers();
    try {
      lookupMock.mockImplementation(() => new Promise(() => {}));
      const extraction = extract();
      let settled = false;
      void extraction.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(14_999);
      expect(settled).toBe(false);
      expect(lookupMock).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(false);
      expect(lookupMock).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(60_000);
      await expect(extraction).resolves.toBeNull();
      expect(lookupMock).toHaveBeenCalledTimes(5);
      expect(requestMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("configures a timeout on each HTTPS request", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    respondToRequests(() => response(404));

    await extract();

    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
    timeoutSpy.mockRestore();
  });

  it("rejects an oversized Content-Length before reading the response", async () => {
    const oversizedResponse = response(200, [], { "content-length": String(100 * 1024 * 1024 + 1) });
    const destroySpy = vi.spyOn(oversizedResponse, "destroy");
    respondToRequests(() => oversizedResponse);

    await expect(extract()).resolves.toBeNull();

    expect(destroySpy).toHaveBeenCalledOnce();
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("stops a streamed response as soon as it exceeds the project size limit", async () => {
    const oneMegabyte = Buffer.alloc(1024 * 1024);
    const oversizedResponse = response(
      200,
      Array.from({ length: 101 }, () => oneMegabyte)
    );
    const destroySpy = vi.spyOn(oversizedResponse, "destroy");
    respondToRequests(() => oversizedResponse);

    await expect(extract()).resolves.toBeNull();

    expect(destroySpy).toHaveBeenCalled();
    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("returns null for an invalid ZIP archive", async () => {
    respondToRequests(() => response(200, [Buffer.from("not a zip")]));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("returns null when the requested plate is absent", async () => {
    respondToRequests(() => response(200, [pngArchive("2")]));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("bounds oversized DEFLATE output when the central-directory image size is forged to zero", async () => {
    const oversizedPng = Buffer.alloc(MAX_IMAGE_SIZE + 1);
    PNG_SIGNATURE.copy(oversizedPng);
    const archive = patchZipHeaders(pngArchive("1", oversizedPng), (patchedArchive, _localOffset, centralOffset) => {
      patchedArchive.writeUInt32LE(0, centralOffset + 24);
    });
    respondToRequests(() => response(200, [archive]));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("rejects DEFLATE output larger than 15 MiB", async () => {
    const oversizedPng = Buffer.alloc(MAX_IMAGE_SIZE + 1);
    PNG_SIGNATURE.copy(oversizedPng);
    respondToRequests(() => response(200, [pngArchive("1", oversizedPng)]));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("rejects a DEFLATE entry whose central-directory image size is falsely zero", async () => {
    const archive = patchZipHeaders(pngArchive(), (patchedArchive, _localOffset, centralOffset) => {
      patchedArchive.writeUInt32LE(0, centralOffset + 24);
    });
    respondToRequests(() => response(200, [archive]));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("rejects an inconsistent STORE entry", async () => {
    const archive = patchZipHeaders(pngArchive(), (patchedArchive, localOffset, centralOffset) => {
      patchedArchive.writeUInt16LE(0, localOffset + 8);
      patchedArchive.writeUInt16LE(0, centralOffset + 10);
    });
    respondToRequests(() => response(200, [archive]));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("returns a valid PNG from a STORE entry", async () => {
    const image = Buffer.concat([PNG_SIGNATURE, Buffer.from("stored image")]);
    respondToRequests(() => response(200, [storedPngArchive(image)]));

    await expect(extract()).resolves.toEqual(image);

    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("rejects a ZIP entry whose compressed data is shorter than its declared size", async () => {
    const archive = patchZipHeaders(pngArchive(), (patchedArchive, _localOffset, centralOffset) => {
      patchedArchive.writeUInt32LE(patchedArchive.length, centralOffset + 20);
    });
    respondToRequests(() => response(200, [archive]));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("rejects an encrypted plate image", async () => {
    const archive = patchZipHeaders(pngArchive(), (patchedArchive, localOffset, centralOffset) => {
      patchedArchive.writeUInt16LE(patchedArchive.readUInt16LE(localOffset + 6) | 1, localOffset + 6);
      patchedArchive.writeUInt16LE(patchedArchive.readUInt16LE(centralOffset + 8) | 1, centralOffset + 8);
    });
    respondToRequests(() => response(200, [archive]));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("rejects an unsupported ZIP compression method", async () => {
    const archive = patchZipHeaders(pngArchive(), (patchedArchive, localOffset, centralOffset) => {
      patchedArchive.writeUInt16LE(12, localOffset + 8);
      patchedArchive.writeUInt16LE(12, centralOffset + 10);
    });
    respondToRequests(() => response(200, [archive]));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("rejects a plate image with an invalid CRC", async () => {
    const archive = patchZipHeaders(pngArchive(), (patchedArchive, localOffset, centralOffset) => {
      const invalidCrc = patchedArchive.readUInt32LE(centralOffset + 16) ^ 0xffffffff;
      patchedArchive.writeUInt32LE(invalidCrc >>> 0, localOffset + 14);
      patchedArchive.writeUInt32LE(invalidCrc >>> 0, centralOffset + 16);
    });
    respondToRequests(() => response(200, [archive]));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("does not retry invalid DEFLATE data", async () => {
    const archive = patchZipHeaders(pngArchive(), (patchedArchive, localOffset, centralOffset) => {
      const fileNameLength = patchedArchive.readUInt16LE(localOffset + 26);
      const extraLength = patchedArchive.readUInt16LE(localOffset + 28);
      const compressedSize = patchedArchive.readUInt32LE(centralOffset + 20);
      const dataOffset = localOffset + 30 + fileNameLength + extraLength;
      patchedArchive.fill(0xff, dataOffset, dataOffset + compressedSize);
    });
    respondToRequests(() => response(200, [archive]));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("rejects a plate image without a PNG signature", async () => {
    respondToRequests(() => response(200, [pngArchive("1", Buffer.from("not a png"))]));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("returns the requested PNG image from a valid 3MF archive", async () => {
    const image = Buffer.concat([PNG_SIGNATURE, Buffer.from("image contents")]);
    respondToRequests(() => response(200, [pngArchive("7", image)]));

    await expect(extract("https://projects.example/model.3mf?signature=secret", "7")).resolves.toEqual(image);

    expect(requestMock).toHaveBeenCalledOnce();
    expect(loggerMock.debug).toHaveBeenCalledWith({ plate: "7", size: image.length }, "Project image extracted");
  });
});
