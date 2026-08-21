import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractJpegFrame, takeScreenshotFromBambuStream } from "../src/libs/rtc";

const { connectMock, loggerMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  loggerMock: { debug: vi.fn(), warn: vi.fn() }
}));

vi.mock("node:tls", () => ({ connect: connectMock }));
vi.mock("tls", () => ({ connect: connectMock }));
vi.mock("../src/libs/logger", () => ({ getLogger: () => loggerMock }));

class FakeSocket extends EventEmitter {
  public readonly destroy = vi.fn();
  public readonly write = vi.fn();
}

describe("RTC stream", () => {
  let socket: FakeSocket;
  let connected: () => void;

  beforeEach(() => {
    socket = new FakeSocket();
    connectMock.mockReset();
    connectMock.mockImplementation((_options, callback) => {
      connected = callback;
      return socket;
    });
    loggerMock.debug.mockReset();
    loggerMock.warn.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("extracts only a complete JPEG frame", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x01, 0x02, 0xff, 0xd9]);

    expect(extractJpegFrame(Buffer.from([0x00, ...jpeg, 0x03]))).toEqual(jpeg);
    expect(extractJpegFrame(jpeg.subarray(0, -1))).toBeNull();
    expect(extractJpegFrame(Buffer.from("not a jpeg"))).toBeNull();
  });

  it("authenticates, assembles fragmented stream data, and closes after one frame", async () => {
    const result = takeScreenshotFromBambuStream("192.0.2.1", "access-code", "SERIAL-1", 6001);
    connected();

    expect(connectMock).toHaveBeenCalledWith(
      {
        ca: expect.any(Buffer),
        host: "192.0.2.1",
        port: 6001,
        rejectUnauthorized: true,
        servername: "SERIAL-1"
      },
      expect.any(Function)
    );
    const authPayload = socket.write.mock.calls[0]![0] as Buffer;
    expect(authPayload).toHaveLength(80);
    expect(authPayload.readUInt32LE(0)).toBe(0x40);
    expect(authPayload.subarray(16, 20).toString("ascii")).toBe("bblp");
    expect(authPayload.subarray(48, 59).toString("ascii")).toBe("access-code");

    socket.emit("data", Buffer.from([0x00, 0xff, 0xd8]));
    socket.emit("data", Buffer.from([0xff, 0xe1, 0x12, 0x34]));
    socket.emit("data", Buffer.from([0xff, 0xd9, 0x99]));

    expect(await result).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x12, 0x34, 0xff, 0xd9]));
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it("recognizes JPEG markers split between chunks", async () => {
    const result = takeScreenshotFromBambuStream("192.0.2.1", "code", "SERIAL-1");

    socket.emit("data", Buffer.from([0x00, 0xff]));
    socket.emit("data", Buffer.from([0xd8, 0x12, 0x34, 0xff]));
    socket.emit("data", Buffer.from([0xd9, 0x99]));

    await expect(result).resolves.toEqual(Buffer.from([0xff, 0xd8, 0x12, 0x34, 0xff, 0xd9]));
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it("processes thousands of tiny chunks with one final concatenation", async () => {
    const jpeg = Buffer.alloc(5_004, 0x12);
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    jpeg[jpeg.length - 2] = 0xff;
    jpeg[jpeg.length - 1] = 0xd9;
    const concatSpy = vi.spyOn(Buffer, "concat");
    const result = takeScreenshotFromBambuStream("192.0.2.1", "code", "SERIAL-1");

    for (let index = 0; index < jpeg.length; index += 1) {
      socket.emit("data", jpeg.subarray(index, index + 1));
    }

    await expect(result).resolves.toEqual(jpeg);
    expect(concatSpy).toHaveBeenCalledOnce();
  });

  it("rejects the chunk that exceeds the stream limit before concatenating", async () => {
    const maximumFrame = Buffer.alloc(20 * 1024 * 1024, 0x12);
    maximumFrame[0] = 0xff;
    maximumFrame[1] = 0xd8;
    const concatSpy = vi.spyOn(Buffer, "concat");
    const result = takeScreenshotFromBambuStream("192.0.2.1", "code", "SERIAL-1");

    socket.emit("data", maximumFrame);
    socket.emit("data", Buffer.from([0x00]));

    await expect(result).resolves.toBeNull();
    expect(concatSpy).not.toHaveBeenCalled();
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(loggerMock.debug).toHaveBeenCalledWith(
      { ip: "192.0.2.1", bufferSize: 20 * 1024 * 1024 + 1 },
      "Bambu stream frame exceeded maximum size"
    );
  });

  it("settles with null when the peer closes before a complete frame", async () => {
    const result = takeScreenshotFromBambuStream("192.0.2.1", "code", "SERIAL-1");
    socket.emit("close");

    await expect(result).resolves.toBeNull();
  });

  it("destroys the socket and settles on timeout", async () => {
    vi.useFakeTimers();
    const concatSpy = vi.spyOn(Buffer, "concat");
    const result = takeScreenshotFromBambuStream("192.0.2.1", "code", "SERIAL-1");
    socket.emit("data", Buffer.from([0xff, 0xd8, 0x12, 0x34]));

    await vi.advanceTimersByTimeAsync(15_000);

    await expect(result).resolves.toBeNull();
    expect(concatSpy).not.toHaveBeenCalled();
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(loggerMock.debug).toHaveBeenCalledWith(
      { ip: "192.0.2.1", port: 6000, bufferSize: 4 },
      "Bambu stream timeout"
    );
  });

  it("settles with null on socket errors", async () => {
    const result = takeScreenshotFromBambuStream("192.0.2.1", "code", "SERIAL-1");
    socket.emit("error", new Error("connection refused"));

    await expect(result).resolves.toBeNull();
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it("returns null and logs certificate validation failures with identity context", async () => {
    const result = takeScreenshotFromBambuStream("192.0.2.1", "code", "SERIAL-1");
    const error = Object.assign(new Error("certificate does not match"), {
      code: "ERR_TLS_CERT_ALTNAME_INVALID"
    });
    socket.emit("error", error);

    await expect(result).resolves.toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      {
        ip: "192.0.2.1",
        port: 6000,
        expectedIdentity: "SERIAL-1",
        error: "certificate does not match"
      },
      "Bambu camera certificate validation failed"
    );
  });

  it("uses the explicit insecure fallback for RTC", async () => {
    vi.stubEnv("BAMBU_TLS_INSECURE", "true");
    vi.resetModules();
    const { takeScreenshotFromBambuStream: takeInsecureScreenshot } = await import("../src/libs/rtc");

    const result = takeInsecureScreenshot("192.0.2.1", "code", "SERIAL-1");
    expect(connectMock).toHaveBeenCalledWith(
      expect.objectContaining({ rejectUnauthorized: false, servername: "SERIAL-1" }),
      expect.any(Function)
    );
    socket.emit("close");

    await expect(result).resolves.toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledWith(expect.stringContaining("BAMBU_TLS_INSECURE=true"));
  });
});
