import EventEmitter from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessageCommand, PrintState } from "../src/enums";
import type { PrinterConfig } from "../src/types/printer-config";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  getPrinter: vi.fn(),
  printCancelled: vi.fn(),
  printFailed: vi.fn(),
  printProgress: vi.fn()
}));

class FakeMqttClient extends EventEmitter {
  public connected = true;
  public readonly endAsync = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  public readonly reconnect = vi.fn();
  public readonly subscribe = vi.fn((_topic: string, callback: (error?: Error) => void) => callback());
  public readonly publish = vi.fn((_topic: string, _payload: string, callback?: (error?: Error) => void) =>
    callback?.()
  );
}

vi.mock("mqtt", () => ({ connect: mocks.connect }));
vi.mock("../src/libs/logger", () => ({
  getLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));
vi.mock("../src/libs/rtc", () => ({ takeScreenshot: vi.fn().mockResolvedValue(null) }));
vi.mock("../src/services/database", () => ({
  getPrinter: mocks.getPrinter,
  getEnabledPrinters: vi.fn().mockReturnValue([]),
  getActivePrintThread: vi.fn().mockReturnValue(null),
  setActivePrintThread: vi.fn().mockReturnValue(true),
  removeActivePrintThread: vi.fn().mockReturnValue(true)
}));
vi.mock("../src/services/discord/bot", () => ({
  createPrintThread: vi.fn().mockResolvedValue("thread-1"),
  isPrintThreadAvailable: vi.fn().mockResolvedValue(true),
  sendToThread: vi.fn().mockResolvedValue(true),
  updateThreadTags: vi.fn().mockResolvedValue(undefined)
}));
vi.mock("../src/services/discord/embeds", () => {
  const result = { embed: { title: "notification" }, files: [] };
  return {
    printStarted: vi.fn().mockReturnValue(result),
    printRecovery: vi.fn().mockResolvedValue(result),
    printCancelled: mocks.printCancelled.mockResolvedValue(result),
    printFailed: mocks.printFailed.mockResolvedValue(result),
    printFinished: vi.fn().mockResolvedValue(result),
    printPaused: vi.fn().mockResolvedValue(result),
    printProgress: mocks.printProgress.mockResolvedValue(result),
    printResumed: vi.fn().mockResolvedValue(result),
    printStopped: vi.fn().mockResolvedValue(result)
  };
});

const config: PrinterConfig = {
  id: "printer-fixture",
  name: "Fixture P1S",
  ip: "192.0.2.10",
  port: 8883,
  rtcPort: 6000,
  serial: "SERIAL-FIXTURE",
  accessCode: "fixture-code",
  forumChannelId: "forum-fixture",
  enabled: true,
  createdAt: 1,
  updatedAt: 1
};

describe("cancelled print MQTT cycle", () => {
  let mqttClient: FakeMqttClient;
  let report: (print: Record<string, unknown>) => void;

  const startPrinter = async (): Promise<void> => {
    const { printerManager } = await import("../src/services/printer-manager");
    const started = printerManager.startPrinter(config.id);
    await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce());
    mqttClient.emit("connect");
    await started;
  };

  const startPausedPrint = (): void => {
    report({
      command: MessageCommand.PROJECT_FILE,
      subtask_name: "Fixture print",
      plate_idx: 1
    });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.RUNNING, mc_percent: 78 });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.PAUSE, layer_num: 3, total_layer_num: 26 });
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mqttClient = new FakeMqttClient();
    mocks.connect.mockReturnValue(mqttClient);
    mocks.getPrinter.mockReturnValue(config);
    report = (print): void => {
      mqttClient.emit("message", `device/${config.serial}/report`, Buffer.from(JSON.stringify({ print })));
    };
  });

  it("routes a successful stop followed by PAUSE then FAILED as a cancellation", async () => {
    await startPrinter();
    startPausedPrint();
    report({ command: MessageCommand.STOP, reason: "success", result: "success" });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.PAUSE, mc_percent: 78 });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.FAILED, mc_percent: 0 });

    await vi.waitFor(() => expect(mocks.printCancelled).toHaveBeenCalledOnce());
    expect(mocks.printFailed).not.toHaveBeenCalled();
  });

  it("does not emit an artificial progress notification for a successful stop while running", async () => {
    await startPrinter();
    report({ command: MessageCommand.PROJECT_FILE, subtask_name: "Fixture print", plate_idx: 1 });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.RUNNING, mc_percent: 78 });
    report({ command: MessageCommand.STOP, reason: "success", result: "success" });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.FAILED, mc_percent: 0 });

    await vi.waitFor(() => expect(mocks.printCancelled).toHaveBeenCalledOnce());
    expect(mocks.printProgress).not.toHaveBeenCalled();
  });

  it("keeps a failed stop as a genuine print failure", async () => {
    await startPrinter();
    startPausedPrint();
    report({ command: MessageCommand.STOP, reason: "failed", result: "failed" });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.FAILED, mc_percent: 0 });

    await vi.waitFor(() => expect(mocks.printFailed).toHaveBeenCalledOnce());
    expect(mocks.printCancelled).not.toHaveBeenCalled();
  });

  it("keeps FAILED without a stop as a genuine print failure", async () => {
    await startPrinter();
    startPausedPrint();
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.FAILED, mc_percent: 0 });

    await vi.waitFor(() => expect(mocks.printFailed).toHaveBeenCalledOnce());
    expect(mocks.printCancelled).not.toHaveBeenCalled();
  });

  it("does not carry a successful stop into the next project", async () => {
    await startPrinter();
    startPausedPrint();
    report({ command: MessageCommand.STOP, reason: "success", result: "success" });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.FAILED, mc_percent: 0 });
    await vi.waitFor(() => expect(mocks.printCancelled).toHaveBeenCalledOnce());
    mocks.printCancelled.mockClear();

    report({ command: MessageCommand.PROJECT_FILE, subtask_name: "Next fixture print", plate_idx: 1 });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.RUNNING, mc_percent: 10 });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.FAILED, mc_percent: 0 });

    await vi.waitFor(() => expect(mocks.printFailed).toHaveBeenCalledOnce());
    expect(mocks.printCancelled).not.toHaveBeenCalled();
  });
});
