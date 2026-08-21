import EventEmitter from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommandResult, MessageCommand, PrintState } from "../src/enums";
import type { PrinterConfig } from "../src/types/printer-config";

const mocks = vi.hoisted(() => {
  const state = { cancellationRequested: false, targets: new Set<string>() };
  return {
    connect: vi.fn(),
    getPrinter: vi.fn(),
    printCancelled: vi.fn(),
    printFailed: vi.fn(),
    printProgress: vi.fn(),
    state,
    coordinator: {
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      communicationLost: vi.fn().mockResolvedValue(undefined),
      communicationReady: vi.fn().mockResolvedValue(undefined),
      recordCancellationRequested: vi.fn(async () => {
        state.cancellationRequested = true;
      }),
      restoreCancellationRequested: vi.fn((_printerId: string, status: { cancellationRequested?: boolean }) => {
        if (state.cancellationRequested) {
          status.cancellationRequested = true;
        }
      }),
      recordStatus: vi.fn(async (context: { status: { state: PrintState } }) => {
        if (context.status.state === PrintState.PREPARE) {
          state.cancellationRequested = false;
        }
      }),
      hasPrintTarget: vi.fn((printerId: string, printKey: string) => state.targets.has(`${printerId}:${printKey}`)),
      recoverThread: vi.fn((context: { printerId: string; printKey: string }) => {
        state.targets.add(`${context.printerId}:${context.printKey}`);
      }),
      discardPrint: vi.fn((printerId: string) => {
        for (const target of state.targets) {
          if (target.startsWith(`${printerId}:`)) {
            state.targets.delete(target);
          }
        }
        state.cancellationRequested = false;
      }),
      enqueueThreadCreation: vi.fn(async (context: { printerId: string; printKey: string }) => {
        state.targets.add(`${context.printerId}:${context.printKey}`);
      }),
      enqueueNotification: vi.fn(async (context, _result, _tags, terminal: boolean) => {
        if (terminal) {
          state.targets.delete(`${context.printerId}:${context.printKey}`);
          state.cancellationRequested = false;
        }
      })
    }
  };
});

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
vi.mock("../src/services/printer-manager/print-notification-coordinator", () => ({
  printNotificationCoordinator: mocks.coordinator
}));

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
    mocks.state.cancellationRequested = false;
    mocks.state.targets.clear();
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
    report({ command: MessageCommand.STOP, reason: CommandResult.SUCCESS, result: CommandResult.SUCCESS });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.PAUSE, mc_percent: 78 });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.FAILED, mc_percent: 0 });

    await vi.waitFor(() => expect(mocks.printCancelled).toHaveBeenCalledOnce());
    expect(mocks.printFailed).not.toHaveBeenCalled();
  });

  it("does not emit an artificial progress notification for a successful stop while running", async () => {
    await startPrinter();
    report({ command: MessageCommand.PROJECT_FILE, subtask_name: "Fixture print", plate_idx: 1 });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.RUNNING, mc_percent: 78 });
    report({ command: MessageCommand.STOP, reason: CommandResult.SUCCESS, result: CommandResult.SUCCESS });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.FAILED, mc_percent: 0 });

    await vi.waitFor(() => expect(mocks.printCancelled).toHaveBeenCalledOnce());
    expect(mocks.printProgress).not.toHaveBeenCalled();
  });

  it("keeps a failed stop as a genuine print failure", async () => {
    await startPrinter();
    startPausedPrint();
    report({ command: MessageCommand.STOP, reason: CommandResult.FAILED, result: CommandResult.FAILED });
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
    report({ command: MessageCommand.STOP, reason: CommandResult.SUCCESS, result: CommandResult.SUCCESS });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.FAILED, mc_percent: 0 });
    await vi.waitFor(() => expect(mocks.printCancelled).toHaveBeenCalledOnce());
    mocks.printCancelled.mockClear();

    report({ command: MessageCommand.PROJECT_FILE, subtask_name: "Next fixture print", plate_idx: 1 });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.RUNNING, mc_percent: 10 });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.FAILED, mc_percent: 0 });

    await vi.waitFor(() => expect(mocks.printFailed).toHaveBeenCalledOnce());
    expect(mocks.printCancelled).not.toHaveBeenCalled();
  });

  it("does not finish STOP processing before cancellation persistence completes", async () => {
    let finishPersistence: (() => void) | undefined;
    mocks.coordinator.recordCancellationRequested.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishPersistence = () => {
            mocks.state.cancellationRequested = true;
            resolve();
          };
        })
    );
    await startPrinter();
    startPausedPrint();
    await vi.waitFor(() => expect(mocks.coordinator.enqueueThreadCreation).toHaveBeenCalledOnce());

    report({ command: MessageCommand.STOP, reason: CommandResult.SUCCESS, result: CommandResult.SUCCESS });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.FAILED, mc_percent: 0 });
    await vi.waitFor(() => expect(mocks.coordinator.recordCancellationRequested).toHaveBeenCalledOnce());
    expect(mocks.printCancelled).not.toHaveBeenCalled();
    expect(mocks.printFailed).not.toHaveBeenCalled();

    finishPersistence?.();
    await vi.waitFor(() => expect(mocks.printCancelled).toHaveBeenCalledOnce());
    expect(mocks.printFailed).not.toHaveBeenCalled();
  });

  it("creates a distinct target when a new print starts without project metadata", async () => {
    await startPrinter();
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.RUNNING, mc_percent: 10 });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.FINISH, mc_percent: 100 });
    report({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.RUNNING, mc_percent: 5 });

    await vi.waitFor(() => expect(mocks.coordinator.enqueueThreadCreation).toHaveBeenCalledTimes(2));
    const firstKey = mocks.coordinator.enqueueThreadCreation.mock.calls[0]![0].printKey;
    const secondKey = mocks.coordinator.enqueueThreadCreation.mock.calls[1]![0].printKey;
    expect(secondKey).not.toBe(firstKey);
  });
});
