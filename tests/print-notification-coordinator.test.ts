import { EmbedBuilder } from "discord.js";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForumTag, PrintState } from "../src/enums";
import type { Status } from "../src/types/printer-status";

const mocks = vi.hoisted(() => ({
  deliverPrintThread: vi.fn(),
  deliverThreadNotification: vi.fn(),
  setActivePrintThread: vi.fn().mockReturnValue(true),
  removeActivePrintThread: vi.fn().mockReturnValue(true)
}));

vi.mock("../src/services/discord/bot", () => ({
  deliverPrintThread: mocks.deliverPrintThread,
  deliverThreadNotification: mocks.deliverThreadNotification
}));
vi.mock("../src/services/database", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/services/database")>();
  return {
    ...actual,
    setActivePrintThread: mocks.setActivePrintThread,
    removeActivePrintThread: mocks.removeActivePrintThread
  };
});
vi.mock("../src/libs/logger", () => ({
  getLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));

const originalWorkingDirectory = process.cwd();
let workingDirectory: string;

const status = (state: PrintState, overrides: Partial<Status> = {}): Status => ({
  state,
  currentLayer: 1,
  maxLayers: 10,
  progressPercent: 10,
  startedAt: 1,
  remainingTime: 10,
  model: "model",
  project: "Project",
  projectImage: null,
  plate: 1,
  trayColor: "#ffffff",
  trayType: "PLA",
  isMulticolor: false,
  ...overrides
});

const context = (state: PrintState = PrintState.RUNNING) => ({
  printerId: "printer-1",
  printerName: "Workshop P1S",
  printKey: "printer-1:model:1",
  status: status(state)
});

const readOutbox = () => JSON.parse(readFileSync(join(workingDirectory, "config", "notification-outbox.json"), "utf8"));

const flushCurrentTimers = async (): Promise<void> => {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1);
  }
};

describe.sequential("PrintNotificationCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    workingDirectory = mkdtempSync(join(tmpdir(), "notification-outbox-"));
    process.chdir(workingDirectory);
    vi.resetModules();
    vi.clearAllMocks();
    mocks.deliverPrintThread.mockResolvedValue({ status: "sent", value: { threadId: "thread-1" } });
    mocks.deliverThreadNotification.mockResolvedValue({ status: "sent", value: { messageId: "message-1" } });
  });

  afterEach(() => {
    process.chdir(originalWorkingDirectory);
    rmSync(workingDirectory, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("persists attachments across retries and deletes them only after acknowledgement", async () => {
    mocks.deliverThreadNotification
      .mockResolvedValueOnce({ status: "retryable" })
      .mockResolvedValueOnce({ status: "sent", value: { messageId: "message-1" } });
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");
    const coordinator = new PrintNotificationCoordinator();
    coordinator.start();
    coordinator.recoverThread(context(), "thread-1");
    await coordinator.enqueueNotification(
      context(),
      {
        embed: new EmbedBuilder().setImage("attachment://screenshot.jpg"),
        files: [{ name: "screenshot.jpg", buffer: Buffer.from("captured-image") }]
      },
      [ForumTag.IN_PROGRESS, ForumTag.MONOCOLOR, "Workshop P1S"]
    );

    const attachmentsPath = join(workingDirectory, "config", "notification-attachments");
    expect(readdirSync(attachmentsPath)).toHaveLength(1);
    expect(readOutbox().events).toHaveLength(1);

    await flushCurrentTimers();
    expect(mocks.deliverThreadNotification).toHaveBeenCalledOnce();
    expect(mocks.deliverThreadNotification.mock.calls[0][0].files[0].buffer.toString()).toBe("captured-image");
    expect(readdirSync(attachmentsPath)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.deliverThreadNotification).toHaveBeenCalledTimes(2);
    expect(readOutbox().events).toEqual([]);
    expect(readdirSync(attachmentsPath)).toEqual([]);
    await coordinator.stop();
  });

  it("persists the notification intent before best-effort screenshot acquisition completes", async () => {
    let finishCapture: ((value: Buffer | null) => void) | undefined;
    const capture = new Promise<Buffer | null>(resolve => {
      finishCapture = resolve;
    });
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");
    const coordinator = new PrintNotificationCoordinator();
    coordinator.start();
    coordinator.recoverThread(context(), "thread-1");

    const enqueue = coordinator.enqueueNotification(
      context(),
      { embed: new EmbedBuilder().setTitle("Progress") },
      [ForumTag.IN_PROGRESS],
      false,
      () => capture
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(readOutbox().events).toEqual([expect.objectContaining({ status: "acquiring" })]);
    expect(mocks.deliverThreadNotification).not.toHaveBeenCalled();
    finishCapture?.(Buffer.from("captured"));
    await enqueue;

    expect(readOutbox().events[0]).toMatchObject({
      status: "pending",
      attachments: [expect.objectContaining({ name: "screenshot.jpg", size: 8 })],
      embed: { image: { url: "attachment://screenshot.jpg" } }
    });
    await coordinator.stop();
  });

  it("reconciles an ambiguous accepted send after a crash instead of blindly resending", async () => {
    mocks.deliverThreadNotification.mockImplementationOnce(() => {
      expect(readOutbox().events[0]).toMatchObject({ status: "ambiguous", ambiguityChecks: 0 });
      return Promise.resolve({ status: "ambiguous" });
    });
    let module = await import("../src/services/printer-manager/print-notification-coordinator");
    let coordinator = new module.PrintNotificationCoordinator();
    coordinator.start();
    coordinator.recoverThread(context(), "thread-1");
    await coordinator.enqueueNotification(context(), { embed: new EmbedBuilder().setTitle("Progress") }, [
      ForumTag.IN_PROGRESS
    ]);
    await flushCurrentTimers();
    await coordinator.stop();

    mocks.deliverThreadNotification.mockResolvedValueOnce({
      status: "sent",
      value: { messageId: "already-accepted" }
    });
    vi.resetModules();
    module = await import("../src/services/printer-manager/print-notification-coordinator");
    coordinator = new module.PrintNotificationCoordinator();
    coordinator.start();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(mocks.deliverThreadNotification).toHaveBeenLastCalledWith(
      expect.objectContaining({ reconcileOnly: true, threadId: "thread-1" })
    );
    expect(readOutbox().events).toEqual([]);
    await coordinator.stop();
  });

  it("waits 60 seconds, sends one neutral loss alert, and restores tags after the first valid status", async () => {
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");
    const coordinator = new PrintNotificationCoordinator();
    coordinator.start();
    coordinator.recoverThread(context(), "thread-1");
    await coordinator.communicationLost("printer-1");

    await vi.advanceTimersByTimeAsync(59_999);
    expect(mocks.deliverThreadNotification).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await flushCurrentTimers();
    expect(mocks.deliverThreadNotification).toHaveBeenCalledOnce();
    const loss = mocks.deliverThreadNotification.mock.calls[0][0];
    expect(loss.embed.data.description).toContain("L’état actuel de l’impression est inconnu");
    expect(loss.tags).toEqual([ForumTag.MONOCOLOR, ForumTag.ATTENTION, "Workshop P1S"]);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocks.deliverThreadNotification).toHaveBeenCalledOnce();
    await coordinator.communicationReady("printer-1");
    await coordinator.recordStatus(context(PrintState.PAUSE));
    await flushCurrentTimers();

    expect(mocks.deliverThreadNotification).toHaveBeenCalledTimes(2);
    expect(mocks.deliverThreadNotification.mock.calls[1][0].tags).toEqual([
      ForumTag.MONOCOLOR,
      ForumTag.PAUSED,
      "Workshop P1S"
    ]);
    await coordinator.stop();
  });

  it("supersedes an undelivered loss alert and never emits a stale recovery sequence", async () => {
    mocks.deliverThreadNotification.mockResolvedValue({ status: "retryable" });
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");
    const coordinator = new PrintNotificationCoordinator();
    coordinator.start();
    coordinator.recoverThread(context(), "thread-1");
    await coordinator.communicationLost("printer-1");
    await vi.advanceTimersByTimeAsync(60_000);
    await flushCurrentTimers();
    expect(mocks.deliverThreadNotification).toHaveBeenCalledOnce();

    await coordinator.communicationReady("printer-1");
    await coordinator.recordStatus(context());
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.deliverThreadNotification).toHaveBeenCalledOnce();
    expect(readOutbox().events).toEqual([expect.objectContaining({ kind: "mqtt-lost", status: "superseded" })]);
    await coordinator.stop();
  });

  it("does not announce recovery when the first status after reconnection is terminal", async () => {
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");
    const coordinator = new PrintNotificationCoordinator();
    coordinator.start();
    coordinator.recoverThread(context(), "thread-1");
    await coordinator.communicationLost("printer-1");
    await vi.advanceTimersByTimeAsync(60_000);
    await flushCurrentTimers();
    await coordinator.communicationReady("printer-1");
    await coordinator.recordStatus(context(PrintState.FAILED));
    await flushCurrentTimers();

    expect(mocks.deliverThreadNotification).toHaveBeenCalledOnce();
    expect(mocks.deliverThreadNotification.mock.calls[0][0].embed.data.title).toBe("Communication perdue");
    await coordinator.stop();
  });

  it("restores cancellation intent after restart and clears it only with terminal acknowledgement", async () => {
    let module = await import("../src/services/printer-manager/print-notification-coordinator");
    let coordinator = new module.PrintNotificationCoordinator();
    coordinator.start();
    coordinator.recoverThread(context(), "thread-1");
    await coordinator.recordCancellationRequested("printer-1");
    await coordinator.stop();

    vi.resetModules();
    module = await import("../src/services/printer-manager/print-notification-coordinator");
    coordinator = new module.PrintNotificationCoordinator();
    coordinator.start();
    const failed = status(PrintState.FAILED, { cancellationRequested: false });
    coordinator.restoreCancellationRequested("printer-1", failed);
    expect(failed.cancellationRequested).toBe(true);

    await coordinator.enqueueNotification(
      { ...context(PrintState.FAILED), status: failed },
      { embed: new EmbedBuilder().setTitle("Cancelled") },
      [ForumTag.FAILED],
      true
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(readOutbox().activePrints).toEqual({});
    expect(mocks.removeActivePrintThread).toHaveBeenCalledWith("printer-1");
    await coordinator.stop();
  });

  it("enforces the 20 MiB limit and removes orphan files on startup", async () => {
    mkdirSync(join(workingDirectory, "config", "notification-attachments"), { recursive: true });
    writeFileSync(join(workingDirectory, "config", "notification-attachments", "orphan.jpg"), "orphan");
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");
    const coordinator = new PrintNotificationCoordinator();
    coordinator.start();
    expect(existsSync(join(workingDirectory, "config", "notification-attachments", "orphan.jpg"))).toBe(false);
    coordinator.recoverThread(context(), "thread-1");
    await coordinator.enqueueNotification(
      context(),
      {
        embed: new EmbedBuilder().setImage("attachment://large.jpg"),
        files: [{ name: "large.jpg", buffer: Buffer.alloc(20 * 1024 * 1024 + 1) }]
      },
      [ForumTag.IN_PROGRESS]
    );

    const event = readOutbox().events[0];
    expect(event.attachments).toEqual([]);
    expect(event.embed.image).toBeUndefined();
    await coordinator.stop();
  });
});
