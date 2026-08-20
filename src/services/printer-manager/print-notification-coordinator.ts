import { type APIEmbed, EmbedBuilder } from "discord.js";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, join } from "node:path";

import { ForumTag, PrintState } from "../../enums";
import { getLogger } from "../../libs/logger";
import type { EmbedResult } from "../../types/discord";
import type { Status } from "../../types/printer-status";
import { getDiscordTagsForStatus } from "../../utils/discord-tags.util";
import {
  type PrintIdentity,
  fsyncDirectory,
  removeActivePrintThread,
  setActivePrintThread,
  writeJsonAtomic
} from "../database";
import { type DiscordFailureReason, deliverPrintThread, deliverThreadNotification } from "../discord/bot";
import { createBaseEmbed } from "../discord/embeds";

const logger = getLogger("PrintNotificationCoordinator");
const OUTBOX_PATH = join(process.cwd(), "config", "notification-outbox.json");
const ATTACHMENTS_PATH = join(process.cwd(), "config", "notification-attachments");
const MAX_ATTACHMENTS_SIZE = 20 * 1024 * 1024;
const MQTT_LOSS_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 60_000;

type EventKind = "create" | "message" | "mqtt-lost" | "mqtt-recovered";
type EventStatus = "acquiring" | "pending" | "ambiguous" | "failed" | "superseded";

interface PersistedAttachment {
  name: string;
  file: string;
  size: number;
}

interface NotificationEvent {
  id: string;
  printerId: string;
  printKey: string;
  kind: EventKind;
  status: EventStatus;
  createdAt: number;
  nextAttemptAt: number;
  attempts: number;
  ambiguityChecks: number;
  embed: APIEmbed;
  attachments: PersistedAttachment[];
  tags: string[];
  forumChannelId?: string;
  title?: string;
  terminal?: boolean;
  threadId?: string;
  messageId?: string;
  identity?: PrintIdentity;
  lastFailure?: DiscordFailureReason;
}

interface ActivePrintState {
  printKey: string;
  printerName: string;
  state: PrintState;
  isMulticolor: boolean;
  cancellationRequested: boolean;
  threadId?: string;
  mqtt?: {
    lostAt: number;
    ready: boolean;
    alertEventId?: string;
    alertDelivered: boolean;
  };
}

interface OutboxState {
  version: 2;
  events: NotificationEvent[];
  activePrints: Record<string, ActivePrintState>;
}

interface PrintContext {
  printerId: string;
  printerName: string;
  printKey: string;
  status: Status;
}

const emptyState = (): OutboxState => ({ version: 2, events: [], activePrints: {} });

const writeState = (state: OutboxState): void => {
  writeJsonAtomic(OUTBOX_PATH, state);
};

const loadState = (): OutboxState => {
  if (!existsSync(OUTBOX_PATH)) {
    return emptyState();
  }
  try {
    const value = JSON.parse(readFileSync(OUTBOX_PATH, "utf8")) as Partial<OutboxState>;
    if (value.version !== 2 || !Array.isArray(value.events) || !value.activePrints) {
      throw new Error("Unsupported notification outbox schema");
    }
    return value as OutboxState;
  } catch (error) {
    throw new Error(`Failed to load notification outbox from ${OUTBOX_PATH}`, { cause: error });
  }
};

const stripMissingAttachmentReferences = (embed: APIEmbed, names: ReadonlySet<string>): APIEmbed => ({
  ...embed,
  ...(embed.image?.url?.startsWith("attachment://") && names.has(embed.image.url.slice("attachment://".length))
    ? { image: undefined }
    : {}),
  ...(embed.thumbnail?.url?.startsWith("attachment://") && names.has(embed.thumbnail.url.slice("attachment://".length))
    ? { thumbnail: undefined }
    : {})
});

export class PrintNotificationCoordinator {
  private state: OutboxState = emptyState();
  private started = false;
  private processing = false;
  private deliveryRequested = false;
  private retryTimer?: NodeJS.Timeout;
  private readonly lossTimers = new Map<string, NodeJS.Timeout>();
  private readonly printerQueues = new Map<string, Promise<void>>();

  public start(): void {
    if (this.started) {
      return;
    }
    this.state = loadState();
    const supersededAttachments: PersistedAttachment[] = [];
    let stateChanged = false;
    for (const event of this.state.events) {
      if (event.status === "acquiring") {
        event.status = "pending";
        event.nextAttemptAt = Date.now();
        stateChanged = true;
      } else if (event.status === "superseded") {
        supersededAttachments.push(...this.detachAttachments(event));
        stateChanged = true;
      }
    }
    this.state.events = this.state.events.filter(event => event.status !== "superseded");
    if (stateChanged) {
      this.persist();
    }
    this.started = true;
    this.deleteAttachmentFiles(supersededAttachments);
    this.cleanOrphanAttachments();
    for (const [printerId, active] of Object.entries(this.state.activePrints)) {
      if (active.mqtt && !active.mqtt.alertEventId) {
        this.scheduleLossAlert(printerId, active.mqtt.lostAt);
      }
    }
    this.scheduleDelivery(0);
  }

  public async stop(): Promise<void> {
    this.started = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    for (const timer of this.lossTimers.values()) {
      clearTimeout(timer);
    }
    this.lossTimers.clear();
    await Promise.allSettled(this.printerQueues.values());
  }

  public hasPrintTarget(printerId: string, printKey: string): boolean {
    const active = this.state.activePrints[printerId];
    return active?.printKey === printKey && (!!active.threadId || this.hasPendingCreate(printerId, printKey));
  }

  public recoverThread(context: PrintContext, threadId: string): void {
    this.ensureStarted();
    this.state.activePrints[context.printerId] = {
      ...this.contextState(context),
      cancellationRequested: this.state.activePrints[context.printerId]?.cancellationRequested ?? false,
      threadId
    };
    this.backfillEventTargets(context.printerId, context.printKey, threadId);
    this.persist();
  }

  public discardPrint(printerId: string): void {
    delete this.state.activePrints[printerId];
    this.persist();
  }

  public restoreCancellationRequested(printerId: string, status: Status): void {
    if (this.state.activePrints[printerId]?.cancellationRequested) {
      status.cancellationRequested = true;
    }
  }

  public recordCancellationRequested(printerId: string): Promise<void> {
    return this.enqueuePrinter(printerId, () => {
      const active = this.state.activePrints[printerId];
      if (active) {
        active.cancellationRequested = true;
        this.persist();
      }
    });
  }

  public recordStatus(context: PrintContext): Promise<void> {
    return this.enqueuePrinter(context.printerId, async () => {
      this.ensureStarted();
      const active = this.state.activePrints[context.printerId];
      if (!active) {
        return;
      }
      const samePrint = active.printKey === context.printKey;
      if (samePrint && active.state === context.status.state) {
        active.printerName = context.printerName;
        active.isMulticolor = context.status.isMulticolor ?? false;
      }
      if (context.status.cancellationRequested === true) {
        active.cancellationRequested = true;
      }

      if (active.mqtt?.ready) {
        const alertEvent = this.findEvent(active.mqtt.alertEventId);
        if (!active.mqtt.alertDelivered) {
          if (alertEvent && alertEvent.status !== "failed") {
            const attachments = this.detachAttachments(alertEvent);
            this.state.events = this.state.events.filter(event => event.id !== alertEvent.id);
            this.persist();
            this.deleteAttachmentFiles(attachments);
          }
        } else if ([PrintState.RUNNING, PrintState.PAUSE].includes(context.status.state)) {
          await this.addEvent({
            ...context,
            printKey: active.printKey,
            kind: "mqtt-recovered",
            result: {
              embed: createBaseEmbed()
                .setTitle("Communication rétablie")
                .setDescription("La communication MQTT avec l’imprimante est rétablie.")
            },
            tags: [...getDiscordTagsForStatus(context.status), context.printerName]
          });
        }
        delete active.mqtt;
      }

      if ([PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(context.status.state)) {
        delete active.mqtt;
      }
      this.persist();
    });
  }

  public communicationLost(printerId: string): Promise<void> {
    return this.enqueuePrinter(printerId, () => {
      this.ensureStarted();
      const active = this.state.activePrints[printerId];
      if (!active || ![PrintState.RUNNING, PrintState.PAUSE].includes(active.state) || active.mqtt) {
        return;
      }
      active.mqtt = { lostAt: Date.now(), ready: false, alertDelivered: false };
      this.persist();
      this.scheduleLossAlert(printerId, active.mqtt.lostAt);
    });
  }

  public communicationReady(printerId: string): Promise<void> {
    return this.enqueuePrinter(printerId, () => {
      const mqtt = this.state.activePrints[printerId]?.mqtt;
      if (mqtt) {
        mqtt.ready = true;
        this.persist();
      }
    });
  }

  public enqueueThreadCreation(
    context: PrintContext,
    result: EmbedResult,
    tags: string[],
    forumChannelId: string,
    title: string,
    identity?: PrintIdentity,
    capture?: () => Promise<Buffer | null>
  ): Promise<void> {
    return this.enqueuePrinter(context.printerId, async () => {
      this.ensureStarted();
      this.state.activePrints[context.printerId] = {
        ...this.contextState(context),
        cancellationRequested: false
      };
      await this.addEvent({ ...context, kind: "create", result, tags, forumChannelId, title, identity, capture });
    });
  }

  public enqueueNotification(
    context: PrintContext,
    result: EmbedResult,
    tags: string[],
    terminal = false,
    capture?: () => Promise<Buffer | null>
  ): Promise<void> {
    return this.enqueuePrinter(context.printerId, async () => {
      const active = this.state.activePrints[context.printerId];
      const threadId = active?.printKey === context.printKey ? active.threadId : undefined;
      const pendingTerminal = terminal
        ? this.state.events.find(
            event =>
              event.printerId === context.printerId &&
              event.terminal &&
              ["acquiring", "pending", "ambiguous"].includes(event.status) &&
              (threadId ? event.threadId === threadId : event.printKey === context.printKey)
          )
        : undefined;
      if (pendingTerminal) {
        if (active?.printKey === context.printKey) {
          this.updateActiveStatus(active, context);
          this.persist();
        }
        return;
      }
      if (active?.printKey === context.printKey) {
        this.updateActiveStatus(active, context);
      }
      await this.addEvent({ ...context, kind: "message", result, tags, terminal, capture });
    });
  }

  private ensureStarted(): void {
    if (!this.started) {
      this.start();
    }
  }

  private contextState(context: PrintContext): Omit<ActivePrintState, "cancellationRequested"> {
    return {
      printKey: context.printKey,
      printerName: context.printerName,
      state: context.status.state,
      isMulticolor: context.status.isMulticolor ?? false
    };
  }

  private updateActiveStatus(active: ActivePrintState, context: PrintContext): void {
    active.printerName = context.printerName;
    active.state = context.status.state;
    active.isMulticolor = context.status.isMulticolor ?? false;
    active.cancellationRequested ||= context.status.cancellationRequested === true;
  }

  private enqueuePrinter(printerId: string, operation: () => void | Promise<void>): Promise<void> {
    const previous = this.printerQueues.get(printerId) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    const tail = current.then(
      () => undefined,
      () => undefined
    );
    this.printerQueues.set(printerId, tail);
    void tail.then(() => {
      if (this.printerQueues.get(printerId) === tail) {
        this.printerQueues.delete(printerId);
      }
    });
    return current;
  }

  private hasPendingCreate(printerId: string, printKey: string): boolean {
    return this.state.events.some(
      event =>
        event.printerId === printerId &&
        event.printKey === printKey &&
        event.kind === "create" &&
        !["failed", "superseded"].includes(event.status)
    );
  }

  private findEvent(eventId?: string): NotificationEvent | undefined {
    return eventId ? this.state.events.find(event => event.id === eventId) : undefined;
  }

  private backfillEventTargets(printerId: string, printKey: string, threadId: string): void {
    for (const event of this.state.events) {
      if (event.printerId === printerId && event.printKey === printKey && !event.threadId) {
        event.threadId = threadId;
      }
    }
  }

  private async addEvent(input: {
    printerId: string;
    printerName: string;
    printKey: string;
    kind: EventKind;
    result: EmbedResult;
    tags: string[];
    forumChannelId?: string;
    title?: string;
    terminal?: boolean;
    identity?: PrintIdentity;
    capture?: () => Promise<Buffer | null>;
  }): Promise<string> {
    const id = randomBytes(12).toString("hex");
    const active = this.state.activePrints[input.printerId];
    const event: NotificationEvent = {
      id,
      printerId: input.printerId,
      printKey: input.printKey,
      kind: input.kind,
      status: input.capture ? "acquiring" : "pending",
      createdAt: Date.now(),
      nextAttemptAt: Date.now(),
      attempts: 0,
      ambiguityChecks: 0,
      embed: input.result.embed.toJSON(),
      attachments: this.persistAttachments(id, input.result),
      tags: input.tags,
      forumChannelId: input.forumChannelId,
      title: input.title,
      terminal: input.terminal,
      threadId: active?.printKey === input.printKey ? active.threadId : undefined,
      identity: input.identity
    };
    const omittedNames = new Set(
      (input.result.files ?? [])
        .map(file => file.name)
        .filter(name => !event.attachments.some(attachment => attachment.name === name))
    );
    event.embed = stripMissingAttachmentReferences(event.embed, omittedNames);
    this.state.events.push(event);
    this.persist();
    if (input.capture) {
      try {
        const screenshot = await input.capture();
        const currentSize = event.attachments.reduce((total, attachment) => total + attachment.size, 0);
        if (screenshot && currentSize + screenshot.length <= MAX_ATTACHMENTS_SIZE) {
          event.attachments.push(this.persistAttachment(id, event.attachments.length, "screenshot.jpg", screenshot));
          event.embed = { ...event.embed, image: { url: "attachment://screenshot.jpg" } };
        } else if (screenshot) {
          logger.warn(
            { eventId: id, totalSize: currentSize + screenshot.length, limit: MAX_ATTACHMENTS_SIZE },
            "Notification attachments exceed size limit"
          );
        }
      } catch (error) {
        logger.warn({ eventId: id, error }, "Screenshot unavailable; continuing notification");
      }
      event.status = "pending";
      event.nextAttemptAt = Date.now();
      this.persist();
    }
    this.scheduleDelivery(0);
    return id;
  }

  private persistAttachments(eventId: string, result: EmbedResult): PersistedAttachment[] {
    const files = (result.files ?? []).filter(file => file.buffer);
    const totalSize = files.reduce((total, file) => total + file.buffer!.length, 0);
    if (totalSize > MAX_ATTACHMENTS_SIZE) {
      logger.warn({ eventId, totalSize, limit: MAX_ATTACHMENTS_SIZE }, "Notification attachments exceed size limit");
      return [];
    }
    if (files.length === 0) {
      return [];
    }
    mkdirSync(ATTACHMENTS_PATH, { recursive: true, mode: 0o700 });
    const attachments = files.map((file, index) => this.persistAttachment(eventId, index, file.name, file.buffer!));
    fsyncDirectory(ATTACHMENTS_PATH);
    return attachments;
  }

  private persistAttachment(eventId: string, index: number, name: string, buffer: Buffer): PersistedAttachment {
    mkdirSync(ATTACHMENTS_PATH, { recursive: true, mode: 0o700 });
    const diskName = `${eventId}-${index}-${basename(name)}`;
    const descriptor = openSync(join(ATTACHMENTS_PATH, diskName), "w", 0o600);
    try {
      writeFileSync(descriptor, buffer);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    fsyncDirectory(ATTACHMENTS_PATH);
    return { name, file: diskName, size: buffer.length };
  }

  private readAttachments(event: NotificationEvent): Array<{ name: string; buffer: Buffer }> {
    return event.attachments.flatMap(attachment => {
      const path = join(ATTACHMENTS_PATH, basename(attachment.file));
      return existsSync(path) ? [{ name: attachment.name, buffer: readFileSync(path) }] : [];
    });
  }

  private scheduleLossAlert(printerId: string, lostAt: number): void {
    const existing = this.lossTimers.get(printerId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(
      () => {
        this.lossTimers.delete(printerId);
        void this.enqueuePrinter(printerId, async () => {
          const active = this.state.activePrints[printerId];
          if (!active?.mqtt || active.mqtt.ready || active.mqtt.alertEventId) {
            return;
          }
          const eventId = await this.addEvent({
            printerId,
            printerName: active.printerName,
            printKey: active.printKey,
            kind: "mqtt-lost",
            result: {
              embed: createBaseEmbed()
                .setTitle("Communication perdue")
                .setDescription(
                  "La communication MQTT avec l’imprimante est perdue. L’état actuel de l’impression est inconnu."
                )
            },
            tags: [
              active.isMulticolor ? ForumTag.MULTICOLOR : ForumTag.MONOCOLOR,
              ForumTag.ATTENTION,
              active.printerName
            ]
          });
          active.mqtt.alertEventId = eventId;
          this.persist();
        });
      },
      Math.max(0, lostAt + MQTT_LOSS_DELAY_MS - Date.now())
    );
    this.lossTimers.set(printerId, timer);
  }

  private scheduleDelivery(delay: number): void {
    if (!this.started) {
      return;
    }
    if (this.processing) {
      this.deliveryRequested = true;
      return;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.processEvents();
    }, delay);
  }

  private async processEvents(): Promise<void> {
    if (!this.started || this.processing) {
      return;
    }
    this.processing = true;
    let processedEvent = false;
    try {
      const firstEventByPrinter = new Map<string, NotificationEvent>();
      for (const candidate of this.state.events
        .filter(candidate => ["pending", "ambiguous"].includes(candidate.status))
        .sort((left, right) => left.createdAt - right.createdAt)) {
        if (!firstEventByPrinter.has(candidate.printerId)) {
          firstEventByPrinter.set(candidate.printerId, candidate);
        }
      }
      const deliverableEvents = Array.from(firstEventByPrinter.values());
      const event = deliverableEvents.find(candidate => candidate.nextAttemptAt <= Date.now());
      if (!event) {
        const next = deliverableEvents.sort((left, right) => left.nextAttemptAt - right.nextAttemptAt)[0];
        if (next) {
          this.scheduleDelivery(Math.max(0, next.nextAttemptAt - Date.now()));
        }
        return;
      }
      processedEvent = true;
      await this.enqueuePrinter(event.printerId, () => this.deliver(event));
    } finally {
      this.processing = false;
      if (processedEvent || this.deliveryRequested) {
        this.deliveryRequested = false;
        this.scheduleDelivery(0);
      }
    }
  }

  private async deliver(event: NotificationEvent): Promise<void> {
    const active = this.state.activePrints[event.printerId];
    const reconcileOnly = event.status === "ambiguous" && event.ambiguityChecks < 3;
    if (!reconcileOnly) {
      // Journal the uncertain outcome before calling Discord. If the process stops after
      // Discord accepts the mutation, startup will reconcile the marker instead of resending.
      event.status = "ambiguous";
      event.ambiguityChecks = 0;
      this.persist();
    }
    const embed = EmbedBuilder.from(event.embed);
    const files = this.readAttachments(event);
    const result =
      event.kind === "create"
        ? await deliverPrintThread({
            eventId: event.id,
            printKey: event.printKey,
            title: event.title ?? "Impression",
            embed,
            files,
            tags: event.tags,
            forumChannelId: event.forumChannelId ?? "",
            reconcileOnly
          })
        : event.threadId
          ? await deliverThreadNotification({
              eventId: event.id,
              threadId: event.threadId,
              messageId: event.messageId,
              embed,
              files,
              tags: event.tags,
              reconcileOnly
            })
          : {
              status: "retryable" as const,
              reason: { category: "target-unavailable" }
            };

    event.attempts += 1;
    if (result.value && "messageId" in result.value) {
      event.messageId = result.value.messageId;
    }
    event.lastFailure = result.status === "sent" ? undefined : result.reason;
    const reconciledThreadId =
      event.kind === "create" && result.value && "threadId" in result.value ? result.value.threadId : undefined;
    if (reconciledThreadId) {
      event.threadId = reconciledThreadId;
      this.backfillEventTargets(event.printerId, event.printKey, reconciledThreadId);
      if (active?.printKey === event.printKey) {
        active.threadId = reconciledThreadId;
        setActivePrintThread(event.printerId, reconciledThreadId, event.identity);
      }
      if (result.status !== "sent") {
        event.status = "ambiguous";
        event.ambiguityChecks = 0;
      }
    }
    let acknowledgedAttachments: PersistedAttachment[] = [];
    if (result.status === "sent") {
      if (event.kind === "mqtt-lost" && active?.printKey === event.printKey && active.mqtt?.alertEventId === event.id) {
        active.mqtt.alertDelivered = true;
      }
      if (event.terminal && active?.printKey === event.printKey) {
        delete this.state.activePrints[event.printerId];
        removeActivePrintThread(event.printerId);
      }
      acknowledgedAttachments = this.detachAttachments(event);
      this.state.events = this.state.events.filter(candidate => candidate.id !== event.id);
    } else if (result.status === "blocked") {
      event.status = "failed";
      logger.error(
        {
          eventId: event.id,
          printerId: event.printerId,
          printKey: event.printKey,
          target: event.threadId ?? event.forumChannelId,
          reason: event.lastFailure
        },
        "Discord notification permanently blocked"
      );
      if (event.kind === "create") {
        for (const dependent of this.state.events) {
          if (
            dependent.printerId === event.printerId &&
            dependent.printKey === event.printKey &&
            dependent.kind !== "create" &&
            ["pending", "ambiguous"].includes(dependent.status)
          ) {
            dependent.status = "failed";
            dependent.lastFailure = {
              category: "target-creation-blocked",
              code: event.lastFailure?.code,
              status: event.lastFailure?.status
            };
          }
        }
      }
    } else {
      if (event.attempts === 1) {
        logger.warn(
          {
            eventId: event.id,
            printerId: event.printerId,
            printKey: event.printKey,
            target: event.threadId ?? event.forumChannelId,
            reason: event.lastFailure
          },
          "Discord notification delivery will be retried"
        );
      }
      if (result.status === "ambiguous") {
        event.status = "ambiguous";
        event.ambiguityChecks = 0;
      } else if (reconciledThreadId) {
        event.status = "ambiguous";
        event.ambiguityChecks = 0;
      } else if (reconcileOnly && !reconciledThreadId) {
        event.ambiguityChecks += 1;
      } else {
        event.status = "pending";
      }
      event.nextAttemptAt = Date.now() + Math.min(2 ** Math.min(event.attempts, 6) * 1_000, MAX_RETRY_DELAY_MS);
    }
    this.persist();
    this.deleteAttachmentFiles(acknowledgedAttachments);
  }

  private detachAttachments(event: NotificationEvent): PersistedAttachment[] {
    const attachments = event.attachments;
    event.attachments = [];
    return attachments;
  }

  private deleteAttachmentFiles(attachments: PersistedAttachment[]): void {
    for (const attachment of attachments) {
      try {
        unlinkSync(join(ATTACHMENTS_PATH, basename(attachment.file)));
      } catch {
        // The file is already absent.
      }
    }
  }

  private cleanOrphanAttachments(): void {
    if (!existsSync(ATTACHMENTS_PATH)) {
      return;
    }
    let changed = false;
    for (const event of this.state.events) {
      const missingNames = new Set<string>();
      event.attachments = event.attachments.filter(attachment => {
        const exists = existsSync(join(ATTACHMENTS_PATH, basename(attachment.file)));
        if (!exists) {
          missingNames.add(attachment.name);
          changed = true;
        }
        return exists;
      });
      event.embed = stripMissingAttachmentReferences(event.embed, missingNames);
    }
    const referenced = new Set(
      this.state.events.flatMap(event => event.attachments.map(attachment => attachment.file))
    );
    for (const file of readdirSync(ATTACHMENTS_PATH)) {
      if (!referenced.has(file)) {
        rmSync(join(ATTACHMENTS_PATH, file), { force: true });
      }
    }
    if (changed) {
      this.persist();
    }
  }

  private persist(): void {
    writeState(this.state);
  }
}

export const printNotificationCoordinator = new PrintNotificationCoordinator();
