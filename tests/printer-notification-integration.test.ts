import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PrintState } from "../src/enums";
import type { PrinterConfig } from "../src/types/printer-config";
import type { Status } from "../src/types/printer-status";

const mocks = vi.hoisted(() => {
  type StatusListener = (newStatus: Status, oldStatus: Status) => void | Promise<void>;
  const clients: Array<{ emitStatus: StatusListener }> = [];
  const Client = vi.fn(function () {
    let statusListener: StatusListener | undefined;
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
      on: vi.fn((event: string, listener: StatusListener) => {
        if (event === "status") {
          statusListener = listener;
        }
        return client;
      }),
      emitStatus: async (newStatus: Status, oldStatus: Status) => await statusListener?.(newStatus, oldStatus),
      takeScreenshotWithLight: vi.fn().mockResolvedValue(null),
      turnOffChamberLight: vi.fn()
    };
    clients.push(client);
    return client;
  });

  return {
    Client,
    clients,
    getPrinter: vi.fn(),
    deliverPrintThread: vi.fn(),
    deliverThreadNotification: vi.fn(),
    setActivePrintThread: vi.fn().mockReturnValue(true),
    removeActivePrintThread: vi.fn().mockReturnValue(true)
  };
});

vi.mock("../src/services/bambu-lab", () => ({ default: mocks.Client }));
vi.mock("../src/services/database", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/services/database")>();
  return {
    ...actual,
    getPrinter: mocks.getPrinter,
    getEnabledPrinters: vi.fn().mockReturnValue([]),
    getActivePrintThread: vi.fn().mockReturnValue(null),
    setActivePrintThread: mocks.setActivePrintThread,
    removeActivePrintThread: mocks.removeActivePrintThread
  };
});
vi.mock("../src/services/discord/bot", () => ({
  deliverPrintThread: mocks.deliverPrintThread,
  deliverThreadNotification: mocks.deliverThreadNotification
}));
vi.mock("../src/libs/logger", () => ({
  getLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));

const config: PrinterConfig = {
  id: "printer-integration",
  name: "Integration P1S",
  ip: "192.0.2.20",
  port: 8883,
  rtcPort: 6000,
  serial: "SERIAL-INTEGRATION",
  accessCode: "fixture-code",
  forumChannelId: "forum-integration",
  enabled: true,
  createdAt: 1,
  updatedAt: 1
};

const status = (state: PrintState, progressPercent: number): Status => ({
  state,
  currentLayer: progressPercent,
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

const originalWorkingDirectory = process.cwd();
let workingDirectory: string;
let stopPrinterManager: (() => Promise<void>) | undefined;

describe.sequential("PrinterManager notification integration", () => {
  beforeEach(() => {
    workingDirectory = mkdtempSync(join(tmpdir(), "printer-notification-integration-"));
    process.chdir(workingDirectory);
    vi.resetModules();
    vi.clearAllMocks();
    mocks.clients.length = 0;
    stopPrinterManager = undefined;
    mocks.getPrinter.mockReturnValue(config);
    mocks.deliverPrintThread.mockResolvedValue({ status: "sent", value: { threadId: "thread-integration" } });
    mocks.deliverThreadNotification.mockResolvedValue({ status: "sent", value: { messageId: "message-finished" } });
  });

  afterEach(async () => {
    await stopPrinterManager?.();
    process.chdir(originalWorkingDirectory);
    rmSync(workingDirectory, { recursive: true, force: true });
  });

  it("delivers a complete print cycle through the real notification coordinator", async () => {
    const { printerManager } = await import("../src/services/printer-manager");
    stopPrinterManager = () => printerManager.stopAll();
    await expect(printerManager.startPrinter(config.id)).resolves.toBe(true);
    const client = mocks.clients[0];
    if (!client) {
      throw new Error("Expected PrinterManager to create a Bambu client");
    }

    await client.emitStatus(status(PrintState.RUNNING, 10), status(PrintState.PREPARE, 0));
    await vi.waitFor(() => expect(mocks.deliverPrintThread).toHaveBeenCalledOnce());
    expect(mocks.setActivePrintThread).toHaveBeenCalledWith(config.id, "thread-integration", { project: "Benchy" });

    await client.emitStatus(status(PrintState.FINISH, 100), status(PrintState.RUNNING, 10));
    await vi.waitFor(() => expect(mocks.deliverThreadNotification).toHaveBeenCalledOnce());

    expect(mocks.deliverThreadNotification).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-integration", tags: ["Monocolor", "Réussi", config.name] })
    );
    expect(mocks.removeActivePrintThread).toHaveBeenCalledWith(config.id);
  });
});
