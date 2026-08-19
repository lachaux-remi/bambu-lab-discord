import AdmZip from "adm-zip";
import type { LookupAddress, LookupOptions } from "node:dns";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { extractProjectImage } from "../src/libs/project";

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
vi.mock("timers/promises", () => ({ setTimeout: sleepMock }));
vi.mock("../src/libs/logger", () => ({ getLogger: () => loggerMock }));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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

const pngArchive = (
  plate: string | number = 1,
  contents: Buffer = Buffer.concat([PNG_SIGNATURE, Buffer.from("png")])
) => projectArchive({ [`Metadata/plate_${plate}.png`]: contents });

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

const extract = (url: string = "https://projects.example/model.3mf", plate: string | number = 1) =>
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

  it("retries transient HTTP errors up to the configured limit", async () => {
    respondToRequests(() => response(503));

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

    expect(requestMock).toHaveBeenCalledTimes(5);
  });

  it("returns null when the requested plate is absent", async () => {
    respondToRequests(() => response(200, [pngArchive(2)]));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("rejects a plate image whose declared size exceeds the limit", async () => {
    const oversizedPng = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(15 * 1024 * 1024)]);
    respondToRequests(() => response(200, [pngArchive(1, oversizedPng)]));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("rejects a plate image without a PNG signature", async () => {
    respondToRequests(() => response(200, [pngArchive(1, Buffer.from("not a png"))]));

    await expect(extract()).resolves.toBeNull();

    expect(requestMock).toHaveBeenCalledOnce();
  });

  it("returns the requested PNG image from a valid 3MF archive", async () => {
    const image = Buffer.concat([PNG_SIGNATURE, Buffer.from("image contents")]);
    respondToRequests(() => response(200, [pngArchive("7", image)]));

    await expect(extract("https://projects.example/model.3mf?signature=secret", "7")).resolves.toEqual(image);

    expect(requestMock).toHaveBeenCalledOnce();
    expect(loggerMock.debug).toHaveBeenCalledWith({ plate: "7", size: image.length }, "Project image extracted");
  });
});
