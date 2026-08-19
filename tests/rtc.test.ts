import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { extractJpegFrame, takeScreenshotFromBambuStream } from "../src/libs/rtc";

const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }));

vi.mock("node:tls", () => ({ connect: connectMock }));
vi.mock("tls", () => ({ connect: connectMock }));

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
  });

  it("extracts only a complete JPEG frame", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x01, 0x02, 0xff, 0xd9]);

    expect(extractJpegFrame(Buffer.from([0x00, ...jpeg, 0x03]))).toEqual(jpeg);
    expect(extractJpegFrame(jpeg.subarray(0, -1))).toBeNull();
    expect(extractJpegFrame(Buffer.from("not a jpeg"))).toBeNull();
  });

  it("authenticates, assembles fragmented stream data, and closes after one frame", async () => {
    const result = takeScreenshotFromBambuStream("192.0.2.1", "access-code", 6001);
    connected();

    expect(connectMock).toHaveBeenCalledWith(
      { host: "192.0.2.1", port: 6001, rejectUnauthorized: false },
      expect.any(Function)
    );
    const authPayload = socket.write.mock.calls[0][0] as Buffer;
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

  it("settles with null when the peer closes before a complete frame", async () => {
    const result = takeScreenshotFromBambuStream("192.0.2.1", "code");
    socket.emit("close");

    await expect(result).resolves.toBeNull();
  });

  it("destroys the socket and settles on timeout", async () => {
    vi.useFakeTimers();
    const result = takeScreenshotFromBambuStream("192.0.2.1", "code");

    await vi.advanceTimersByTimeAsync(15_000);

    await expect(result).resolves.toBeNull();
    expect(socket.destroy).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("settles with null on socket errors", async () => {
    const result = takeScreenshotFromBambuStream("192.0.2.1", "code");
    socket.emit("error", new Error("connection refused"));

    await expect(result).resolves.toBeNull();
    expect(socket.destroy).toHaveBeenCalledOnce();
  });
});
