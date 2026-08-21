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
  removeActivePrintThread: vi.fn().mockReturnValue(true),
  loggerError: vi.fn(),
  loggerWarn: vi.fn()
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
  getLogger: () => ({ debug: vi.fn(), error: mocks.loggerError, info: vi.fn(), warn: mocks.loggerWarn })
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

type JsonRecord = Record<string, unknown>;

const validPersistedOutbox = (): JsonRecord => ({
  version: 2,
  events: [
    {
      id: "event-1",
      printerId: "printer-1",
      printKey: "printer-1:model:1",
      kind: "message",
      status: "pending",
      createdAt: 900,
      nextAttemptAt: 1_000,
      attempts: 1,
      ambiguityChecks: 0,
      embed: {
        title: "Progress",
        description: "Printing",
        color: 0x24a543,
        timestamp: "2026-08-21T00:00:00.000Z",
        footer: { text: "Bambu Lab Discord", icon_url: "https://example.com/footer.png" },
        image: { url: "attachment://screenshot.jpg" },
        thumbnail: { url: "https://example.com/thumbnail.png" },
        fields: [{ name: "Progress", value: "10%", inline: true }]
      },
      attachments: [{ name: "screenshot.jpg", file: "event-1-0-screenshot.jpg", size: 8 }],
      tags: [ForumTag.IN_PROGRESS, ForumTag.MONOCOLOR, "Workshop P1S"],
      terminal: false,
      threadId: "thread-1",
      messageId: "message-previous",
      lastFailure: { category: "discord-rate-limited", code: 20_028, status: 429 }
    }
  ],
  activePrints: {
    "printer-1": {
      printKey: "printer-1:model:1",
      printerName: "Workshop P1S",
      state: PrintState.RUNNING,
      isMulticolor: false,
      cancellationRequested: true,
      threadId: "thread-1",
      mqtt: {
        lostAt: 800,
        ready: true,
        alertEventId: "event-1",
        alertDelivered: false,
        firstStatus: { state: PrintState.PAUSE, isMulticolor: false }
      }
    }
  }
});

const persistedEvents = (snapshot: JsonRecord): JsonRecord[] => snapshot.events as JsonRecord[];
const persistedActivePrint = (snapshot: JsonRecord): JsonRecord =>
  (snapshot.activePrints as JsonRecord)["printer-1"] as JsonRecord;
const persistedMqtt = (snapshot: JsonRecord): JsonRecord => persistedActivePrint(snapshot).mqtt as JsonRecord;

const writeOutbox = (snapshot: JsonRecord): void => {
  mkdirSync(join(workingDirectory, "config"), { recursive: true });
  writeFileSync(join(workingDirectory, "config", "notification-outbox.json"), JSON.stringify(snapshot));
};

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

  it.each([
    ["active prints as an array", (snapshot: JsonRecord) => (snapshot.activePrints = [])],
    ["a missing event embed", (snapshot: JsonRecord) => delete persistedEvents(snapshot)[0].embed],
    ["an unknown event kind", (snapshot: JsonRecord) => (persistedEvents(snapshot)[0].kind = "other")],
    ["an unknown event status", (snapshot: JsonRecord) => (persistedEvents(snapshot)[0].status = "sent")],
    [
      "an attachment with a negative size",
      (snapshot: JsonRecord) => {
        (persistedEvents(snapshot)[0].attachments as JsonRecord[])[0].size = -1;
      }
    ],
    ["a non-array attachment collection", (snapshot: JsonRecord) => (persistedEvents(snapshot)[0].attachments = {})],
    ["a fractional event timestamp", (snapshot: JsonRecord) => (persistedEvents(snapshot)[0].createdAt = 1.5)],
    ["a negative attempt counter", (snapshot: JsonRecord) => (persistedEvents(snapshot)[0].attempts = -1)],
    [
      "a malformed embed footer",
      (snapshot: JsonRecord) => {
        (persistedEvents(snapshot)[0].embed as JsonRecord).footer = [];
      }
    ],
    ["a non-string tag", (snapshot: JsonRecord) => (persistedEvents(snapshot)[0].tags = [ForumTag.IN_PROGRESS, 1])],
    ["an unknown active print state", (snapshot: JsonRecord) => (persistedActivePrint(snapshot).state = "PRINTING")],
    ["a malformed MQTT ready flag", (snapshot: JsonRecord) => (persistedMqtt(snapshot).ready = "yes")],
    [
      "an invalid MQTT recovery state",
      (snapshot: JsonRecord) => {
        (persistedMqtt(snapshot).firstStatus as JsonRecord).state = "PRINTING";
      }
    ],
    ["a malformed print identity", (snapshot: JsonRecord) => (persistedEvents(snapshot)[0].identity = { plate: 1 })],
    [
      "a malformed failure reason",
      (snapshot: JsonRecord) => {
        persistedEvents(snapshot)[0].lastFailure = { category: "discord-transient", status: "503" };
      }
    ],
    [
      "a create event without its forum target",
      (snapshot: JsonRecord) => (persistedEvents(snapshot)[0].kind = "create")
    ],
    [
      "a failed event without a failure reason",
      (snapshot: JsonRecord) => {
        persistedEvents(snapshot)[0].status = "failed";
        delete persistedEvents(snapshot)[0].lastFailure;
      }
    ]
  ])("rejects a version-2 snapshot with %s", async (_description, corrupt) => {
    const snapshot = validPersistedOutbox();
    corrupt(snapshot);
    writeOutbox(snapshot);
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");

    expect(() => new PrintNotificationCoordinator().start()).toThrowError(
      `Failed to load notification outbox from ${join(workingDirectory, "config", "notification-outbox.json")}`
    );
  });

  it("restarts from a valid pending event with persisted embeds, attachments, retries, and active print state", async () => {
    const snapshot = validPersistedOutbox();
    delete persistedActivePrint(snapshot).mqtt;
    writeOutbox(snapshot);
    mkdirSync(join(workingDirectory, "config", "notification-attachments"), { recursive: true });
    writeFileSync(join(workingDirectory, "config", "notification-attachments", "event-1-0-screenshot.jpg"), "captured");
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");
    const coordinator = new PrintNotificationCoordinator();
    coordinator.start();
    await flushCurrentTimers();

    expect(mocks.deliverThreadNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "event-1",
        threadId: "thread-1",
        messageId: "message-previous",
        tags: [ForumTag.IN_PROGRESS, ForumTag.MONOCOLOR, "Workshop P1S"],
        files: [expect.objectContaining({ name: "screenshot.jpg" })]
      })
    );
    expect(mocks.deliverThreadNotification.mock.calls[0][0].embed.toJSON()).toMatchObject({
      title: "Progress",
      footer: { text: "Bambu Lab Discord" },
      fields: [{ name: "Progress", value: "10%", inline: true }]
    });
    expect(readOutbox().events).toEqual([]);
    await coordinator.stop();
  });

  it("restarts from a valid create event with complete print identity", async () => {
    const snapshot = validPersistedOutbox();
    const event = persistedEvents(snapshot)[0];
    event.kind = "create";
    event.forumChannelId = "forum-1";
    event.title = "Workshop print";
    event.identity = {
      subtaskId: "subtask-1",
      taskId: "task-1",
      gcodeFile: "plate.gcode.3mf",
      plate: "1",
      project: "Project"
    };
    delete event.threadId;
    delete event.messageId;
    delete persistedActivePrint(snapshot).mqtt;
    writeOutbox(snapshot);
    mkdirSync(join(workingDirectory, "config", "notification-attachments"), { recursive: true });
    writeFileSync(join(workingDirectory, "config", "notification-attachments", "event-1-0-screenshot.jpg"), "captured");
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");
    const coordinator = new PrintNotificationCoordinator();
    coordinator.start();
    await flushCurrentTimers();

    expect(mocks.deliverPrintThread).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "event-1", forumChannelId: "forum-1", title: "Workshop print" })
    );
    expect(mocks.setActivePrintThread).toHaveBeenCalledWith("printer-1", "thread-1", event.identity);
    await coordinator.stop();
  });

  it("restarts from a valid MQTT alert and recovery journal", async () => {
    const snapshot = validPersistedOutbox();
    const event = persistedEvents(snapshot)[0];
    event.kind = "mqtt-lost";
    event.status = "ambiguous";
    event.reconcileOnlyAfterRecovery = true;
    writeOutbox(snapshot);
    mkdirSync(join(workingDirectory, "config", "notification-attachments"), { recursive: true });
    writeFileSync(join(workingDirectory, "config", "notification-attachments", "event-1-0-screenshot.jpg"), "captured");
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");
    const coordinator = new PrintNotificationCoordinator();
    coordinator.start();
    await flushCurrentTimers();

    expect(mocks.deliverThreadNotification.mock.calls.map(call => call[0].embed.data.title)).toEqual([
      "Progress",
      "Communication rétablie"
    ]);
    expect(mocks.deliverThreadNotification.mock.calls[0][0]).toMatchObject({
      eventId: "event-1",
      reconcileOnly: true,
      threadId: "thread-1"
    });
    expect(readOutbox().activePrints["printer-1"].mqtt).toBeUndefined();
    await coordinator.stop();
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

  it("removes superseded loss alerts without accumulating stale recovery events", async () => {
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
    expect(readOutbox().events).toEqual([]);

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await coordinator.communicationLost("printer-1");
      await vi.advanceTimersByTimeAsync(60_000);
      await flushCurrentTimers();
      await coordinator.communicationReady("printer-1");
      await coordinator.recordStatus(context());
      expect(readOutbox().events).toEqual([]);
    }
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

  it("reconciles an accepted ambiguous loss before delivering recovery and restored tags", async () => {
    mocks.deliverThreadNotification
      .mockResolvedValueOnce({
        status: "ambiguous",
        reason: { category: "discord-result-ambiguous" }
      })
      .mockResolvedValueOnce({ status: "sent", value: { messageId: "loss-accepted" } })
      .mockResolvedValueOnce({ status: "sent", value: { messageId: "recovery" } });
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");
    const coordinator = new PrintNotificationCoordinator();
    coordinator.start();
    coordinator.recoverThread(context(), "thread-1");
    await coordinator.communicationLost("printer-1");
    await vi.advanceTimersByTimeAsync(60_000);
    await flushCurrentTimers();

    await coordinator.communicationReady("printer-1");
    await coordinator.recordStatus(context(PrintState.RUNNING));
    await flushCurrentTimers();

    expect(mocks.deliverThreadNotification).toHaveBeenCalledTimes(3);
    expect(mocks.deliverThreadNotification.mock.calls[1][0]).toMatchObject({
      reconcileOnly: true,
      threadId: "thread-1"
    });
    expect(mocks.deliverThreadNotification.mock.calls.map(call => call[0].embed.data.title)).toEqual([
      "Communication perdue",
      "Communication perdue",
      "Communication rétablie"
    ]);
    expect(mocks.deliverThreadNotification.mock.calls[2][0].tags).toEqual([
      ForumTag.MONOCOLOR,
      ForumTag.IN_PROGRESS,
      "Workshop P1S"
    ]);
    expect(readOutbox().events).toEqual([]);
    await coordinator.stop();
  });

  it("supersedes an ambiguous loss that remains absent without resending it after recovery", async () => {
    mocks.deliverThreadNotification
      .mockResolvedValueOnce({
        status: "ambiguous",
        reason: { category: "discord-result-ambiguous" }
      })
      .mockResolvedValue({
        status: "retryable",
        reason: { category: "discord-reconciliation-pending" }
      });
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");
    const coordinator = new PrintNotificationCoordinator();
    coordinator.start();
    coordinator.recoverThread(context(), "thread-1");
    await coordinator.communicationLost("printer-1");
    await vi.advanceTimersByTimeAsync(60_000);
    await flushCurrentTimers();

    await coordinator.communicationReady("printer-1");
    await coordinator.recordStatus(context(PrintState.RUNNING));
    await flushCurrentTimers();
    await vi.advanceTimersByTimeAsync(4_000);
    await vi.advanceTimersByTimeAsync(8_000);

    expect(mocks.deliverThreadNotification).toHaveBeenCalledTimes(4);
    expect(mocks.deliverThreadNotification.mock.calls.slice(1).every(call => call[0].reconcileOnly)).toBe(true);
    expect(
      mocks.deliverThreadNotification.mock.calls.some(call => call[0].embed.data.title === "Communication rétablie")
    ).toBe(false);
    expect(readOutbox().events).toEqual([]);
    expect(readOutbox().activePrints["printer-1"].mqtt).toBeUndefined();
    await coordinator.stop();
  });

  it("resumes ambiguous loss reconciliation after a crash with the first valid status intact", async () => {
    mocks.deliverThreadNotification.mockResolvedValueOnce({
      status: "ambiguous",
      reason: { category: "discord-result-ambiguous" }
    });
    let module = await import("../src/services/printer-manager/print-notification-coordinator");
    let coordinator = new module.PrintNotificationCoordinator();
    coordinator.start();
    coordinator.recoverThread(context(), "thread-1");
    await coordinator.communicationLost("printer-1");
    await vi.advanceTimersByTimeAsync(60_000);
    await flushCurrentTimers();
    await coordinator.communicationReady("printer-1");
    await coordinator.recordStatus(context(PrintState.PAUSE));
    expect(readOutbox().activePrints["printer-1"].mqtt.firstStatus).toEqual({
      state: PrintState.PAUSE,
      isMulticolor: false
    });
    await coordinator.stop();

    mocks.deliverThreadNotification
      .mockResolvedValueOnce({ status: "sent", value: { messageId: "loss-accepted" } })
      .mockResolvedValueOnce({ status: "sent", value: { messageId: "recovery" } });
    vi.resetModules();
    module = await import("../src/services/printer-manager/print-notification-coordinator");
    coordinator = new module.PrintNotificationCoordinator();
    coordinator.start();
    await flushCurrentTimers();

    expect(mocks.deliverThreadNotification.mock.calls.map(call => call[0].embed.data.title)).toEqual([
      "Communication perdue",
      "Communication perdue",
      "Communication rétablie"
    ]);
    expect(mocks.deliverThreadNotification.mock.calls[2][0].tags).toContain(ForumTag.PAUSED);
    expect(readOutbox().activePrints["printer-1"].mqtt).toBeUndefined();
    await coordinator.stop();
  });

  it("orders a terminal after ambiguous loss resolution without announcing recovery", async () => {
    mocks.deliverThreadNotification
      .mockResolvedValueOnce({
        status: "ambiguous",
        reason: { category: "discord-result-ambiguous" }
      })
      .mockResolvedValueOnce({ status: "sent", value: { messageId: "loss-accepted" } })
      .mockResolvedValueOnce({ status: "sent", value: { messageId: "terminal" } });
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");
    const coordinator = new PrintNotificationCoordinator();
    coordinator.start();
    coordinator.recoverThread(context(), "thread-1");
    await coordinator.communicationLost("printer-1");
    await vi.advanceTimersByTimeAsync(60_000);
    await flushCurrentTimers();

    const terminal = context(PrintState.FAILED);
    await coordinator.communicationReady("printer-1");
    await coordinator.recordStatus(terminal);
    await coordinator.enqueueNotification(
      terminal,
      { embed: new EmbedBuilder().setTitle("Terminal") },
      [ForumTag.FAILED],
      true
    );
    await flushCurrentTimers();

    expect(mocks.deliverThreadNotification.mock.calls.map(call => call[0].embed.data.title)).toEqual([
      "Communication perdue",
      "Communication perdue",
      "Terminal"
    ]);
    expect(readOutbox().events).toEqual([]);
    expect(mocks.removeActivePrintThread).toHaveBeenCalledWith("printer-1");
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

  it("delivers a retried terminal to its original thread before creating the next print target", async () => {
    mocks.deliverThreadNotification
      .mockResolvedValueOnce({ status: "retryable" })
      .mockResolvedValueOnce({ status: "sent", value: { messageId: "terminal-a" } });
    mocks.deliverPrintThread.mockResolvedValue({ status: "sent", value: { threadId: "thread-b" } });
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");
    const coordinator = new PrintNotificationCoordinator();
    const printA = context(PrintState.FAILED);
    const printB = {
      ...context(PrintState.RUNNING),
      printKey: "printer-1:model:2",
      status: status(PrintState.RUNNING, { startedAt: 2 })
    };
    coordinator.start();
    coordinator.recoverThread(printA, "thread-a");
    await coordinator.enqueueNotification(
      printA,
      { embed: new EmbedBuilder().setTitle("Terminal A") },
      [ForumTag.FAILED],
      true
    );
    await flushCurrentTimers();
    expect(mocks.deliverThreadNotification).toHaveBeenLastCalledWith(expect.objectContaining({ threadId: "thread-a" }));

    await coordinator.recordStatus(printB);
    await coordinator.enqueueThreadCreation(
      printB,
      { embed: new EmbedBuilder().setTitle("Print B") },
      [ForumTag.IN_PROGRESS],
      "forum-1",
      "Print B"
    );
    await vi.advanceTimersByTimeAsync(2_000);
    await flushCurrentTimers();

    expect(mocks.deliverThreadNotification).toHaveBeenCalledTimes(2);
    expect(mocks.deliverThreadNotification).toHaveBeenLastCalledWith(expect.objectContaining({ threadId: "thread-a" }));
    expect(mocks.deliverPrintThread).toHaveBeenCalledOnce();
    expect(mocks.deliverThreadNotification.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.deliverPrintThread.mock.invocationCallOrder[0]
    );
    expect(readOutbox().activePrints["printer-1"]).toMatchObject({
      printKey: printB.printKey,
      threadId: "thread-b"
    });
    expect(mocks.removeActivePrintThread).not.toHaveBeenCalled();
    await coordinator.stop();
  });

  it("coalesces a reconstructed terminal after restart onto the pending durable target", async () => {
    let module = await import("../src/services/printer-manager/print-notification-coordinator");
    let coordinator = new module.PrintNotificationCoordinator();
    const original = context(PrintState.FAILED);
    coordinator.start();
    coordinator.recoverThread(original, "thread-a");
    await coordinator.enqueueNotification(
      original,
      { embed: new EmbedBuilder().setTitle("Terminal A") },
      [ForumTag.FAILED],
      true
    );
    await coordinator.stop();

    vi.resetModules();
    module = await import("../src/services/printer-manager/print-notification-coordinator");
    coordinator = new module.PrintNotificationCoordinator();
    const reconstructed = {
      ...context(PrintState.FAILED),
      printKey: "printer-1:model:reconstructed",
      status: status(PrintState.FAILED, { startedAt: 99 })
    };
    coordinator.start();
    await coordinator.recordStatus(reconstructed);
    coordinator.recoverThread(reconstructed, "thread-a");
    await coordinator.enqueueNotification(
      reconstructed,
      { embed: new EmbedBuilder().setTitle("Reconstructed terminal A") },
      [ForumTag.FAILED],
      true
    );

    expect(readOutbox().events).toHaveLength(1);
    await flushCurrentTimers();
    expect(mocks.deliverThreadNotification).toHaveBeenCalledOnce();
    expect(mocks.deliverThreadNotification).toHaveBeenCalledWith(expect.objectContaining({ threadId: "thread-a" }));
    await coordinator.stop();
  });

  it("persists a state transition only in the same snapshot as its notification intent", async () => {
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");
    const coordinator = new PrintNotificationCoordinator();
    const running = context(PrintState.RUNNING);
    const failed = context(PrintState.FAILED);
    coordinator.start();
    coordinator.recoverThread(running, "thread-a");

    await coordinator.recordStatus(failed);
    expect(readOutbox()).toMatchObject({
      events: [],
      activePrints: { "printer-1": { state: PrintState.RUNNING } }
    });

    await coordinator.enqueueNotification(
      failed,
      { embed: new EmbedBuilder().setTitle("Terminal A") },
      [ForumTag.FAILED],
      true
    );
    expect(readOutbox()).toMatchObject({
      events: [expect.objectContaining({ terminal: true, threadId: "thread-a" })],
      activePrints: { "printer-1": { state: PrintState.FAILED, threadId: "thread-a" } }
    });
    await coordinator.stop();
  });

  it("persists a safe failure reason and logs a permanently blocked target", async () => {
    mocks.deliverThreadNotification.mockResolvedValue({
      status: "blocked",
      reason: { category: "discord-access-blocked", code: 10003, status: 404 }
    });
    const { PrintNotificationCoordinator } =
      await import("../src/services/printer-manager/print-notification-coordinator");
    const coordinator = new PrintNotificationCoordinator();
    coordinator.start();
    coordinator.recoverThread(context(), "thread-a");
    await coordinator.enqueueNotification(context(), { embed: new EmbedBuilder().setTitle("Blocked") }, [
      ForumTag.IN_PROGRESS
    ]);
    await flushCurrentTimers();

    expect(readOutbox().events[0]).toMatchObject({
      status: "failed",
      threadId: "thread-a",
      lastFailure: { category: "discord-access-blocked", code: 10003, status: 404 }
    });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        printerId: "printer-1",
        target: "thread-a",
        reason: { category: "discord-access-blocked", code: 10003, status: 404 }
      }),
      "Discord notification permanently blocked"
    );
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
