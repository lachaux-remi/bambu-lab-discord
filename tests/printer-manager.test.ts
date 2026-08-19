import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrintState } from "../src/enums";
import type { PrinterConfig } from "../src/types/printer-config";
import type { Status } from "../src/types/printer-status";

const mocks = vi.hoisted(() => {
  type StatusListener = (newStatus: Status, oldStatus: Status) => void | Promise<void>;
  const clients: Array<{
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    isConnected: ReturnType<typeof vi.fn>;
    emitStatus: (newStatus: Status, oldStatus: Status) => Promise<void>;
  }> = [];
  const state: { nextConnection?: Promise<void>; nextConnectionError?: Error } = {};

  const Client = vi.fn(function () {
    let statusListener: StatusListener | undefined;
    const connection = state.nextConnection;
    const connectionError = state.nextConnectionError;
    state.nextConnection = undefined;
    state.nextConnectionError = undefined;
    const client = {
      connect: connection
        ? vi.fn().mockReturnValue(connection)
        : connectionError
          ? vi.fn().mockRejectedValue(connectionError)
          : vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
      on: vi.fn((_event: string, listener: StatusListener) => {
        statusListener = listener;
        return client;
      }),
      emitStatus: async (newStatus: Status, oldStatus: Status) => {
        await statusListener?.(newStatus, oldStatus);
      },
      takeScreenshotWithLight: vi.fn().mockResolvedValue(null),
      turnOffChamberLight: vi.fn()
    };
    clients.push(client);
    return client;
  });

  return {
    Client,
    clients,
    state,
    getPrinter: vi.fn(),
    getEnabledPrinters: vi.fn(),
    getActivePrintThread: vi.fn(),
    setActivePrintThread: vi.fn(),
    removeActivePrintThread: vi.fn(),
    createPrintThread: vi.fn(),
    isPrintThreadAvailable: vi.fn(),
    sendToThread: vi.fn(),
    updateThreadTags: vi.fn(),
    printStarted: vi.fn(),
    printRecovery: vi.fn(),
    printCancelled: vi.fn(),
    printFailed: vi.fn(),
    printFinished: vi.fn(),
    printPaused: vi.fn(),
    printProgress: vi.fn(),
    printResumed: vi.fn(),
    printStopped: vi.fn()
  };
});

vi.mock("../src/services/bambu-lab", () => ({ default: mocks.Client }));
vi.mock("../src/services/database", () => ({
  getPrinter: mocks.getPrinter,
  getEnabledPrinters: mocks.getEnabledPrinters,
  getActivePrintThread: mocks.getActivePrintThread,
  setActivePrintThread: mocks.setActivePrintThread,
  removeActivePrintThread: mocks.removeActivePrintThread
}));
vi.mock("../src/services/discord/bot", () => ({
  createPrintThread: mocks.createPrintThread,
  isPrintThreadAvailable: mocks.isPrintThreadAvailable,
  sendToThread: mocks.sendToThread,
  updateThreadTags: mocks.updateThreadTags
}));
vi.mock("../src/services/discord/embeds", () => ({
  printStarted: mocks.printStarted,
  printRecovery: mocks.printRecovery,
  printCancelled: mocks.printCancelled,
  printFailed: mocks.printFailed,
  printFinished: mocks.printFinished,
  printPaused: mocks.printPaused,
  printProgress: mocks.printProgress,
  printResumed: mocks.printResumed,
  printStopped: mocks.printStopped
}));

const config: PrinterConfig = {
  id: "printer-1",
  name: "Workshop P1S",
  ip: "192.0.2.1",
  port: 8883,
  rtcPort: 6000,
  serial: "SERIAL",
  accessCode: "secret",
  forumChannelId: "forum-1",
  enabled: true,
  createdAt: 1,
  updatedAt: 1
};

const status = (state: PrintState, progressPercent = 25): Status => ({
  state,
  currentLayer: 25,
  maxLayers: 100,
  progressPercent,
  startedAt: 1_000,
  remainingTime: 60,
  model: "benchy-model",
  project: "Benchy",
  projectImage: null,
  plate: 1,
  trayColor: "#ffffff",
  trayType: "PLA",
  isMulticolor: false
});

describe("PrinterManager public seam", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.clients.length = 0;
    mocks.state.nextConnection = undefined;
    mocks.state.nextConnectionError = undefined;
    mocks.getPrinter.mockReturnValue(config);
    mocks.getEnabledPrinters.mockReturnValue([]);
    mocks.getActivePrintThread.mockReturnValue(null);
    mocks.setActivePrintThread.mockReturnValue(true);
    mocks.removeActivePrintThread.mockReturnValue(true);
    mocks.createPrintThread.mockResolvedValue("thread-new");
    mocks.isPrintThreadAvailable.mockResolvedValue(true);
    mocks.sendToThread.mockResolvedValue(true);
    mocks.updateThreadTags.mockResolvedValue(undefined);
    const embedResult = { embed: { title: "notification" }, files: [] };
    mocks.printStarted.mockReturnValue(embedResult);
    mocks.printRecovery.mockResolvedValue(embedResult);
    mocks.printCancelled.mockResolvedValue(embedResult);
    mocks.printFailed.mockResolvedValue(embedResult);
    mocks.printFinished.mockResolvedValue(embedResult);
    mocks.printPaused.mockResolvedValue(embedResult);
    mocks.printProgress.mockResolvedValue(embedResult);
    mocks.printResumed.mockResolvedValue(embedResult);
    mocks.printStopped.mockResolvedValue(embedResult);
  });

  it("reports a missing printer without creating a client", async () => {
    mocks.getPrinter.mockReturnValue(undefined);
    const { printerManager } = await import("../src/services/printer-manager");

    await expect(printerManager.startPrinter("missing")).resolves.toBe(false);
    expect(mocks.Client).not.toHaveBeenCalled();
  });

  it("starts once and treats a duplicate start as successful without taking new ownership", async () => {
    const { printerManager } = await import("../src/services/printer-manager");

    await expect(printerManager.startPrinter(config.id)).resolves.toBe(true);
    await expect(printerManager.startPrinter(config.id)).resolves.toBe(true);

    expect(mocks.Client).toHaveBeenCalledOnce();
    expect(mocks.clients[0].connect).toHaveBeenCalledOnce();
    expect(printerManager.getRunningPrinters()).toEqual([config.id]);
    expect(printerManager.getPrinterStatus(config.id)).toEqual({ running: true, connected: true });
  });

  it("shares one client between concurrent starts for the same printer", async () => {
    let finishConnection: (() => void) | undefined;
    mocks.state.nextConnection = new Promise<void>(resolve => {
      finishConnection = resolve;
    });
    const { printerManager } = await import("../src/services/printer-manager");

    const firstStart = printerManager.startPrinter(config.id);
    const secondStart = printerManager.startPrinter(config.id);
    await Promise.resolve();

    expect(mocks.Client).toHaveBeenCalledOnce();
    expect(mocks.clients[0].connect).toHaveBeenCalledOnce();
    finishConnection?.();
    await expect(Promise.all([firstStart, secondStart])).resolves.toEqual([true, true]);
    expect(printerManager.getRunningPrinters()).toEqual([config.id]);
  });

  it("does not retain ownership after connection failure and permits a retry", async () => {
    mocks.state.nextConnectionError = new Error("offline");
    const { printerManager } = await import("../src/services/printer-manager");

    await expect(printerManager.startPrinter(config.id)).resolves.toBe(false);
    expect(printerManager.getPrinterStatus(config.id).running).toBe(false);
    await expect(printerManager.startPrinter(config.id)).resolves.toBe(true);
    expect(mocks.Client).toHaveBeenCalledTimes(2);
  });

  it("stops a queued start before it opens a connection", async () => {
    const { printerManager } = await import("../src/services/printer-manager");

    const start = printerManager.startPrinter(config.id);
    const stop = printerManager.stopPrinter(config.id);

    await expect(stop).resolves.toBe(true);
    await expect(start).resolves.toBe(false);
    expect(mocks.clients[0].connect).not.toHaveBeenCalled();
    expect(mocks.clients[0].disconnect).toHaveBeenCalledOnce();
    expect(printerManager.getRunningPrinters()).toEqual([]);
  });

  it("stops an in-flight start without publishing or orphaning its client", async () => {
    let cancelConnection: (() => void) | undefined;
    mocks.state.nextConnection = new Promise<void>((_resolve, reject) => {
      cancelConnection = () => reject(new Error("start cancelled"));
    });
    const { printerManager } = await import("../src/services/printer-manager");

    const start = printerManager.startPrinter(config.id);
    await Promise.resolve();
    mocks.clients[0].disconnect.mockImplementation(async () => cancelConnection?.());

    await expect(printerManager.stopPrinter(config.id)).resolves.toBe(true);
    await expect(start).resolves.toBe(false);
    expect(mocks.clients[0].disconnect).toHaveBeenCalledOnce();
    expect(printerManager.getRunningPrinters()).toEqual([]);

    await expect(printerManager.startPrinter(config.id)).resolves.toBe(true);
    expect(mocks.Client).toHaveBeenCalledTimes(2);
  });

  it("awaits disconnect before stopping and restart connects a replacement afterward", async () => {
    const { printerManager } = await import("../src/services/printer-manager");
    await printerManager.startPrinter(config.id);
    let finishDisconnect: (() => void) | undefined;
    mocks.clients[0].disconnect.mockImplementation(() => new Promise<void>(resolve => (finishDisconnect = resolve)));

    const restart = printerManager.restartPrinter(config.id);
    await Promise.resolve();
    expect(mocks.Client).toHaveBeenCalledOnce();
    expect(printerManager.getPrinterStatus(config.id).running).toBe(false);

    finishDisconnect?.();
    await expect(restart).resolves.toBe(true);
    expect(mocks.Client).toHaveBeenCalledTimes(2);
    expect(mocks.clients[1].connect).toHaveBeenCalledOnce();
  });

  it("reports an unknown printer as already stopped", async () => {
    const { printerManager } = await import("../src/services/printer-manager");

    await expect(printerManager.stopPrinter("missing")).resolves.toBe(false);
  });

  it("waits for every disconnect before reporting stopAll failures", async () => {
    mocks.getPrinter.mockImplementation((id: string) => ({ ...config, id }));
    const { printerManager } = await import("../src/services/printer-manager");
    await printerManager.startPrinter("printer-1");
    await printerManager.startPrinter("printer-2");
    mocks.clients[0].disconnect.mockRejectedValue(new Error("disconnect failed"));
    let finishSecondDisconnect: (() => void) | undefined;
    mocks.clients[1].disconnect.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finishSecondDisconnect = resolve;
        })
    );

    let shutdownSettled = false;
    const shutdown = printerManager.stopAll().finally(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();

    expect(shutdownSettled).toBe(false);
    expect(mocks.clients[0].disconnect).toHaveBeenCalledOnce();
    expect(mocks.clients[1].disconnect).toHaveBeenCalledOnce();
    finishSecondDisconnect?.();
    await expect(shutdown).rejects.toThrow("Failed to stop all printers");
    expect(printerManager.getRunningPrinters()).toEqual([]);
  });

  it("reattaches an available persisted thread and removes its recovery record when the print ends", async () => {
    mocks.getActivePrintThread.mockReturnValue({ threadId: "thread-recovered" });
    const { printerManager } = await import("../src/services/printer-manager");
    await printerManager.startPrinter(config.id);

    await mocks.clients[0].emitStatus(status(PrintState.RUNNING), status(PrintState.UNKNOWN, 0));
    expect(mocks.isPrintThreadAvailable).toHaveBeenCalledWith("thread-recovered");
    expect(mocks.createPrintThread).not.toHaveBeenCalled();

    await mocks.clients[0].emitStatus(status(PrintState.FINISH, 100), status(PrintState.RUNNING));
    expect(mocks.sendToThread).toHaveBeenCalledWith("thread-recovered", expect.anything(), []);
    expect(mocks.removeActivePrintThread).toHaveBeenCalledWith(config.id);
  });

  it("replaces an unavailable persisted thread and persists the newly created thread", async () => {
    mocks.getActivePrintThread.mockReturnValue({ threadId: "thread-stale" });
    mocks.isPrintThreadAvailable.mockResolvedValue(false);
    const { printerManager } = await import("../src/services/printer-manager");
    await printerManager.startPrinter(config.id);

    await mocks.clients[0].emitStatus(status(PrintState.RUNNING), status(PrintState.UNKNOWN, 0));

    expect(mocks.removeActivePrintThread).toHaveBeenCalledWith(config.id);
    expect(mocks.createPrintThread).toHaveBeenCalledOnce();
    expect(mocks.setActivePrintThread).toHaveBeenCalledWith(config.id, "thread-new", "Benchy");
  });

  it("replaces a persisted thread when both known project identities differ", async () => {
    mocks.getActivePrintThread.mockReturnValue({ threadId: "thread-old-project", project: "Calibration Cube" });
    const { printerManager } = await import("../src/services/printer-manager");
    await printerManager.startPrinter(config.id);

    await mocks.clients[0].emitStatus(status(PrintState.RUNNING), status(PrintState.UNKNOWN, 0));

    expect(mocks.isPrintThreadAvailable).not.toHaveBeenCalled();
    expect(mocks.removeActivePrintThread).toHaveBeenCalledWith(config.id);
    expect(mocks.createPrintThread).toHaveBeenCalledOnce();
    expect(mocks.setActivePrintThread).toHaveBeenCalledWith(config.id, "thread-new", "Benchy");
  });

  it.each([
    [PrintState.FINISH, 100, "printFinished"],
    [PrintState.FAILED, 25, "printFailed"],
    [PrintState.IDLE, 25, "printStopped"]
  ] as const)(
    "handles PAUSE -> %s as a terminal transition and clears recovery state",
    async (terminalState, progress, expectedNotification) => {
      mocks.getActivePrintThread.mockReturnValue({ threadId: "thread-paused", project: "Benchy" });
      const { printerManager } = await import("../src/services/printer-manager");
      await printerManager.startPrinter(config.id);
      await mocks.clients[0].emitStatus(status(PrintState.PAUSE), status(PrintState.UNKNOWN, 0));
      mocks.sendToThread.mockClear();
      mocks.removeActivePrintThread.mockClear();

      await mocks.clients[0].emitStatus(status(terminalState, progress), status(PrintState.PAUSE));

      expect(mocks[expectedNotification]).toHaveBeenCalledOnce();
      expect(mocks.sendToThread).toHaveBeenCalledWith("thread-paused", expect.anything(), []);
      expect(mocks.removeActivePrintThread).toHaveBeenCalledWith(config.id);
    }
  );
});
