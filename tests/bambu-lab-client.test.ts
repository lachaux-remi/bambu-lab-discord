import EventEmitter from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MessageCommand, PrintState } from "../src/enums";
import BambuLabClient from "../src/services/bambu-lab";
import type { PrinterConfig } from "../src/types/printer-config";

const { connectMock } = vi.hoisted(() => ({ connectMock: vi.fn() }));

vi.mock("mqtt", () => ({ connect: connectMock }));

type MqttCallback = (error?: Error) => void;

class FakeMqttClient extends EventEmitter {
  public connected = true;
  public readonly end = vi.fn();
  public readonly endAsync = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  public readonly reconnect = vi.fn();
  public readonly subscribe = vi.fn((_topic: string, callback: MqttCallback) => callback());
  public readonly publish = vi.fn((_topic: string, _payload: string, callback?: MqttCallback) => callback?.());
}

const config: PrinterConfig = {
  id: "printer-1",
  name: "Test Printer",
  ip: "192.0.2.10",
  port: 8883,
  rtcPort: 6000,
  serial: "SERIAL-1",
  accessCode: "access-code",
  forumChannelId: "forum-1",
  enabled: true,
  createdAt: 1,
  updatedAt: 1
};

describe("BambuLabClient MQTT lifecycle", () => {
  let mqttClient: FakeMqttClient;
  let client: BambuLabClient;

  beforeEach(() => {
    mqttClient = new FakeMqttClient();
    connectMock.mockReset();
    connectMock.mockReturnValue(mqttClient);
    client = new BambuLabClient(config);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscribes to reports before requesting the initial push", async () => {
    const order: string[] = [];
    let finishSubscription: MqttCallback | undefined;
    mqttClient.subscribe.mockImplementation((_topic, callback) => {
      order.push("subscribe");
      finishSubscription = callback;
    });
    mqttClient.publish.mockImplementation((_topic, _payload, callback) => {
      order.push("publish");
      callback?.();
    });

    const connection = client.connect();
    mqttClient.emit("connect");

    expect(mqttClient.subscribe).toHaveBeenCalledWith("device/SERIAL-1/report", expect.any(Function));
    expect(mqttClient.publish).not.toHaveBeenCalled();
    finishSubscription?.();
    await connection;

    expect(order).toEqual(["subscribe", "publish"]);
    expect(mqttClient.publish).toHaveBeenCalledWith(
      "device/SERIAL-1/request",
      JSON.stringify({ pushing: { sequence_id: "1", command: "pushall" }, user_id: 123_456_789 }),
      expect.any(Function)
    );
  });

  it("rejects a failed initial subscription and tears down the transport", async () => {
    const error = new Error("subscribe failed");
    mqttClient.subscribe.mockImplementation((_topic, callback) => callback(error));

    const connection = client.connect();
    mqttClient.emit("connect");

    await expect(connection).rejects.toBe(error);
    expect(mqttClient.end).toHaveBeenCalledWith(true);
    expect(mqttClient.reconnect).not.toHaveBeenCalled();
    expect(client.isConnected()).toBe(false);
  });

  it("rejects a failed initial publish and tears down the transport", async () => {
    const error = new Error("publish failed");
    mqttClient.publish.mockImplementation((_topic, _payload, callback) => callback?.(error));

    const connection = client.connect();
    mqttClient.emit("connect");

    await expect(connection).rejects.toBe(error);
    expect(mqttClient.end).toHaveBeenCalledWith(true);
    expect(mqttClient.reconnect).not.toHaveBeenCalled();
    expect(client.isConnected()).toBe(false);
  });

  it("times out initial session setup with deterministic forced transport teardown", async () => {
    vi.useFakeTimers();
    client = new BambuLabClient(config, 1_000);
    mqttClient.subscribe.mockImplementation(() => undefined);

    const connection = client.connect();
    const rejection = expect(connection).rejects.toThrow("timed out after 1000ms");
    mqttClient.emit("connect");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(connectMock).toHaveBeenCalledWith(
      "mqtts://192.0.2.10:8883",
      expect.objectContaining({ connectTimeout: 1_000 })
    );
    expect(mqttClient.end).toHaveBeenCalledWith(true);
    expect(client.isConnected()).toBe(false);
    await rejection;
  });

  it("disconnect cancels and owns an in-flight initial connection", async () => {
    const connection = client.connect();
    const rejection = expect(connection).rejects.toThrow("initial connection cancelled");

    await client.disconnect();

    await rejection;
    expect(mqttClient.end).toHaveBeenCalledWith(true);
    expect(client.isConnected()).toBe(false);
  });

  it("processes incoming report messages sequentially", async () => {
    let releaseFirstListener: (() => void) | undefined;
    const firstListenerFinished = new Promise<void>(resolve => {
      releaseFirstListener = resolve;
    });
    const observedProgress: number[] = [];
    client.on("status", async status => {
      observedProgress.push(status.progressPercent);
      if (status.progressPercent === 10) {
        await firstListenerFinished;
      }
    });
    const connection = client.connect();
    mqttClient.emit("connect");
    await connection;

    const message = (progressPercent: number): Buffer =>
      Buffer.from(
        JSON.stringify({
          print: {
            command: MessageCommand.PUSH_STATUS,
            gcode_state: PrintState.RUNNING,
            mc_percent: progressPercent
          }
        })
      );
    mqttClient.emit("message", "device/SERIAL-1/report", message(10));
    mqttClient.emit("message", "device/SERIAL-1/report", message(20));
    await vi.waitFor(() => expect(observedProgress).toEqual([10]));

    releaseFirstListener?.();
    await vi.waitFor(() => expect(observedProgress).toEqual([10, 20]));
  });

  it("awaits transport shutdown and disconnects idempotently", async () => {
    let finishShutdown: (() => void) | undefined;
    mqttClient.endAsync.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finishShutdown = resolve;
        })
    );
    const connection = client.connect();
    mqttClient.emit("connect");
    await connection;

    let firstDisconnected = false;
    let secondDisconnected = false;
    const firstDisconnect = client.disconnect().then(() => {
      firstDisconnected = true;
    });
    const secondDisconnect = client.disconnect().then(() => {
      secondDisconnected = true;
    });
    await Promise.resolve();

    expect(firstDisconnected).toBe(false);
    expect(secondDisconnected).toBe(false);
    expect(mqttClient.endAsync).toHaveBeenCalledOnce();
    finishShutdown?.();
    await Promise.all([firstDisconnect, secondDisconnect]);
    expect(firstDisconnected).toBe(true);
    expect(secondDisconnected).toBe(true);
  });
});
