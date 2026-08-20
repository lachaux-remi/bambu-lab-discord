import EventEmitter from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LightMode, LightNode, MessageCommand, PrintState } from "../src/enums";
import BambuLabClient from "../src/services/bambu-lab";
import type { PrinterConfig } from "../src/types/printer-config";

const { connectMock, loggerMock, takeScreenshotMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  loggerMock: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  },
  takeScreenshotMock: vi.fn()
}));

vi.mock("mqtt", () => ({ connect: connectMock }));
vi.mock("../src/libs/logger", () => ({ getLogger: () => loggerMock }));
vi.mock("../src/libs/rtc", () => ({ takeScreenshot: takeScreenshotMock }));

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
    vi.clearAllMocks();
    connectMock.mockReturnValue(mqttClient);
    takeScreenshotMock.mockReset();
    takeScreenshotMock.mockResolvedValue(null);
    client = new BambuLabClient(config);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
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

  it("never writes raw MQTT payload values to debug logs", async () => {
    const sensitivePayload = JSON.stringify({
      print: {
        command: MessageCommand.PUSH_STATUS,
        gcode_state: PrintState.RUNNING,
        liveview: { ttcode_enc: "TTCODE-SENTINEL" },
        md5: "MD5-SENTINEL",
        tray_uuid: "TRAY-UUID-SENTINEL"
      }
    });

    await (
      client as unknown as {
        onMessage: (packet: string) => Promise<void>;
      }
    ).onMessage(sensitivePayload);

    const serializedLogs = JSON.stringify(loggerMock.debug.mock.calls);
    expect(serializedLogs).not.toContain("SENTINEL");
    expect(loggerMock.debug).toHaveBeenCalledWith({ key: "print" }, "Received message");
  });

  it("bounds startup on a failed initial subscription while retaining mqtt.js retry ownership", async () => {
    const error = new Error("subscribe failed");
    mqttClient.subscribe.mockImplementation((_topic, callback) => callback(error));

    const connection = client.connect();
    mqttClient.emit("connect");

    await expect(connection).rejects.toBe(error);
    expect(mqttClient.end).not.toHaveBeenCalled();
    expect(mqttClient.reconnect).toHaveBeenCalledOnce();
    expect(loggerMock.info).not.toHaveBeenCalledWith(expect.anything(), "MQTT connection recovered");
  });

  it("bounds startup on a failed initial publish while retaining mqtt.js retry ownership", async () => {
    const error = new Error("publish failed");
    mqttClient.publish.mockImplementation((_topic, _payload, callback) => callback?.(error));

    const connection = client.connect();
    mqttClient.emit("connect");

    await expect(connection).rejects.toBe(error);
    expect(mqttClient.end).not.toHaveBeenCalled();
    expect(mqttClient.reconnect).toHaveBeenCalledOnce();
  });

  it("keeps initial session setup bounded without disabling mqtt.js retries", async () => {
    vi.useFakeTimers();
    client = new BambuLabClient(config, 1_000);
    mqttClient.subscribe.mockImplementation(() => undefined);

    const connection = client.connect();
    const rejection = expect(connection).rejects.toThrow("timed out after 1000ms");
    mqttClient.emit("connect");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(connectMock).toHaveBeenCalledWith(
      "mqtts://192.0.2.10:8883",
      expect.objectContaining({
        ca: expect.any(Buffer),
        connectTimeout: 1_000,
        rejectUnauthorized: true,
        servername: "SERIAL-1"
      })
    );
    expect(mqttClient.end).not.toHaveBeenCalled();
    expect(mqttClient.reconnect).toHaveBeenCalledOnce();
    await rejection;
  });

  it("rejects certificate validation failures with useful printer identity context", async () => {
    const tlsError = Object.assign(new Error("certificate does not match"), {
      code: "ERR_TLS_CERT_ALTNAME_INVALID"
    });

    const connection = client.connect();
    mqttClient.emit("error", tlsError);

    await expect(connection).rejects.toMatchObject({
      message: expect.stringContaining(
        "MQTT TLS certificate validation failed for printer Test Printer at 192.0.2.10; expected identity SERIAL-1"
      ),
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
      cause: tlsError
    });
    expect(mqttClient.endAsync).toHaveBeenCalledWith(true);
    expect(client.isConnected()).toBe(false);
  });

  it("counts an initial network incident only once when shutdown re-emits the same error", async () => {
    const networkError = Object.assign(new Error("connect EHOSTUNREACH 192.0.2.10:8883"), {
      code: "EHOSTUNREACH"
    });
    mqttClient.endAsync.mockImplementation(async () => {
      mqttClient.emit("error", networkError);
    });

    const connection = client.connect();
    mqttClient.emit("error", networkError);

    await expect(connection).rejects.toBe(networkError);
    await client.disconnect();
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ failure: 1, message: networkError.message }),
      "Error connecting to BambuLab MQTT server"
    );
  });

  it("keeps mqtt.js retries alive after bounded cold-start failure and connects when the printer returns", async () => {
    const networkError = Object.assign(new Error("connect EHOSTUNREACH 192.0.2.10:8883"), {
      code: "EHOSTUNREACH"
    });

    const connection = client.connect();
    mqttClient.emit("error", networkError);
    await expect(connection).rejects.toBe(networkError);

    expect(mqttClient.end).not.toHaveBeenCalled();
    expect(mqttClient.endAsync).not.toHaveBeenCalled();
    mqttClient.emit("reconnect");
    mqttClient.connected = true;
    mqttClient.emit("connect");

    expect(connectMock).toHaveBeenCalledOnce();
    expect(client.isConnected()).toBe(true);
    expect(loggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({ failures: 1, printer: "Test Printer" }),
      "MQTT connection recovered"
    );
    expect(loggerMock.info).toHaveBeenCalledWith({ printer: "Test Printer" }, "Connected to printer");
  });

  it("stops mqtt.js retries cleanly without logging a false recovery", async () => {
    const networkError = Object.assign(new Error("connect EHOSTUNREACH 192.0.2.10:8883"), {
      code: "EHOSTUNREACH"
    });

    const connection = client.connect();
    mqttClient.emit("error", networkError);
    await expect(connection).rejects.toBe(networkError);
    loggerMock.info.mockClear();

    await client.disconnect();
    mqttClient.emit("error", networkError);
    mqttClient.emit("reconnect");
    mqttClient.emit("connect");

    expect(mqttClient.endAsync).toHaveBeenCalledOnce();
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
    expect(loggerMock.info).not.toHaveBeenCalledWith(expect.anything(), "MQTT connection recovered");
    expect(loggerMock.info).not.toHaveBeenCalledWith(expect.anything(), "Connected to printer");
    expect(client.isConnected()).toBe(false);
  });

  it("logs the first three reconnect failures, then minute summaries without slowing MQTT retries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const connection = client.connect();
    mqttClient.emit("connect");
    await connection;
    loggerMock.error.mockClear();

    const connectionError = new Error("connect ECONNREFUSED 192.0.2.10:8883");
    for (let failure = 0; failure < 4; failure += 1) {
      if (failure > 0) {
        mqttClient.emit("reconnect");
      }
      mqttClient.emit("error", connectionError);
      await vi.advanceTimersByTimeAsync(5_000);
    }

    expect(connectMock).toHaveBeenCalledWith(
      "mqtts://192.0.2.10:8883",
      expect.objectContaining({ reconnectPeriod: 5_000 })
    );
    expect(loggerMock.error).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(40_000);
    mqttClient.emit("reconnect");
    mqttClient.emit("error", connectionError);

    expect(loggerMock.error).toHaveBeenCalledTimes(4);
    expect(loggerMock.error).toHaveBeenLastCalledWith(
      expect.objectContaining({
        failures: 5,
        printer: "Test Printer",
        suppressedFailures: 2
      }),
      "MQTT connection failures continue"
    );

    mqttClient.emit("reconnect");
    mqttClient.emit("error", connectionError);
    expect(loggerMock.error).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60_000);
    mqttClient.emit("reconnect");
    mqttClient.emit("error", connectionError);
    expect(loggerMock.error).toHaveBeenCalledTimes(5);
    expect(loggerMock.error).toHaveBeenLastCalledWith(
      expect.objectContaining({ failures: 7, suppressedFailures: 2 }),
      "MQTT connection failures continue"
    );
  });

  it("logs recovery with outage duration and the total number of suppressed failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const connection = client.connect();
    mqttClient.emit("connect");
    await connection;
    loggerMock.info.mockClear();

    const connectionError = new Error("connection refused");
    for (let failure = 0; failure < 5; failure += 1) {
      if (failure > 0) {
        mqttClient.emit("reconnect");
      }
      mqttClient.emit("error", connectionError);
      await vi.advanceTimersByTimeAsync(5_000);
    }
    mqttClient.emit("connect");

    expect(loggerMock.info).toHaveBeenCalledWith(
      {
        failures: 5,
        outageDurationMs: 25_000,
        printer: "Test Printer",
        suppressedFailures: 2
      },
      "MQTT connection recovered"
    );
  });

  it("always logs TLS certificate errors immediately outside reconnect throttling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const connection = client.connect();
    mqttClient.emit("connect");
    await connection;
    loggerMock.error.mockClear();

    const connectionError = new Error("connection refused");
    for (let failure = 0; failure < 4; failure += 1) {
      if (failure > 0) {
        mqttClient.emit("reconnect");
      }
      mqttClient.emit("error", connectionError);
    }
    const tlsError = Object.assign(new Error("certificate expired"), { code: "CERT_HAS_EXPIRED" });
    mqttClient.emit("error", tlsError);

    expect(loggerMock.error).toHaveBeenCalledTimes(4);
    expect(loggerMock.error).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "certificate expired" }),
      "BambuLab MQTT certificate validation failed"
    );
  });

  it("does not pass TLS options to the plaintext development protocol", async () => {
    vi.stubEnv("MQTT_PROTOCOL", "mqtt");
    vi.resetModules();
    const { default: PlainMqttBambuLabClient } = await import("../src/services/bambu-lab");
    const plainClient = new PlainMqttBambuLabClient({ ...config, port: 1883 });

    const connection = plainClient.connect();
    mqttClient.emit("connect");
    await connection;

    expect(connectMock).toHaveBeenCalledWith("mqtt://192.0.2.10:1883", expect.any(Object));
    const options = connectMock.mock.calls.at(-1)?.[1];
    expect(options).not.toHaveProperty("ca");
    expect(options).not.toHaveProperty("rejectUnauthorized");
    expect(options).not.toHaveProperty("servername");
  });

  it("passes the existing printer serial to RTC capture", async () => {
    vi.useFakeTimers();

    const screenshot = client.takeScreenshotWithLight();
    await vi.advanceTimersByTimeAsync(1_500);
    await screenshot;

    expect(takeScreenshotMock).toHaveBeenCalledWith("192.0.2.10", "access-code", "SERIAL-1", 6000);
  });

  it("uses the canonical chamber light protocol values", async () => {
    const connection = client.connect();
    mqttClient.emit("connect");
    await connection;
    mqttClient.publish.mockClear();

    client.turnOffChamberLight();
    client.turnOnChamberLight();

    const payloads = mqttClient.publish.mock.calls.map(call => JSON.parse(call[1]));
    expect(payloads).toEqual([
      expect.objectContaining({
        system: expect.objectContaining({ led_node: LightNode.CHAMBER, led_mode: LightMode.OFF })
      }),
      expect.objectContaining({
        system: expect.objectContaining({ led_node: LightNode.CHAMBER, led_mode: LightMode.ON })
      })
    ]);
  });

  it("disconnect cancels and owns an in-flight initial connection", async () => {
    const connection = client.connect();
    const rejection = expect(connection).rejects.toThrow("initial connection cancelled");

    await client.disconnect();

    await rejection;
    expect(mqttClient.endAsync).toHaveBeenCalledWith(true);
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
