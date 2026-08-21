import { ChannelType } from "discord.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BambuLabClient from "../../services/bambu-lab";
import type { ActivePrintThread, PrintIdentity } from "../../services/database";
import {
  type DiscordDeliveryResult,
  type PrintThreadDeliveryInput,
  type ThreadNotificationDeliveryInput,
  deliverPrintThread,
  deliverThreadNotification,
  getDiscordClient,
  initDiscordClient,
  reconcileConfiguredForumTags,
  shutdownDiscordClient
} from "../../services/discord/bot";
import { PrinterManager, type PrinterStatusView } from "../../services/printer-manager";
import { PrintNotificationCoordinator } from "../../services/printer-manager/print-notification-coordinator";
import type { PrinterConfig } from "../../types/printer-config";
import type { Status } from "../../types/printer-status";
import { MockMqttPrinter } from "./broker";
import { type ScenarioPlayerResult, playScenario } from "./player";
import type { PrinterScenario, PublishStep, ScenarioStep, StatusStep } from "./scenario";

export const DEFAULT_SCENARIO_PRINTER = {
  id: "mock-scenario-printer",
  name: "MQTT Scenario Bench",
  serial: "MOCK_SCENARIO_SERIAL",
  accessCode: "mock-scenario-access-code"
} as const;

export interface DiscordE2EOptions {
  forumChannelId: string;
  guildId: string;
}

export interface DiscordTargetDetails extends DiscordE2EOptions {
  forumName: string;
  guildName: string;
}

export interface ScenarioPrinterOptions {
  accessCode: string;
  id: string;
  name: string;
  serial: string;
}

export interface ScenarioSessionOptions {
  captureDelayMs?: number;
  discord?: DiscordE2EOptions;
  printer?: ScenarioPrinterOptions;
  timeScale?: number;
}

export interface ScenarioNotification {
  deleted?: boolean;
  id: string;
  kind: "message" | "thread";
  tags: string[];
  threadId: string;
  title: string;
  url?: string;
}

export interface ScenarioSessionSnapshot {
  connected: boolean;
  current?: Omit<Status, "projectImage"> & { hasProjectImage: boolean };
  discordMode: "discord-e2e" | "mock-discord";
  mediaConfigured: boolean;
  mqtt: {
    host: string;
    paused: boolean;
    port: number;
    pushallCount: number;
  };
  notifications: ScenarioNotification[];
  printer: ScenarioPrinterOptions;
  running: boolean;
}

class ScenarioBambuLabClient extends BambuLabClient {
  public constructor(
    config: PrinterConfig,
    reconnectPeriodMs: number,
    private readonly captureDelayMs: number,
    private readonly getPlaceholder: () => Buffer | undefined,
    private readonly recordStatus: (status: Status) => void
  ) {
    super(config, 5_000, { protocol: "mqtt", reconnectPeriodMs });
  }

  public override async emitStatus(status: Status, oldStatus: Status): Promise<void> {
    const placeholder = this.getPlaceholder();
    if (placeholder && status.projectImage === undefined) {
      status.projectImage = Buffer.from(placeholder);
    }
    this.recordStatus(status);
    await super.emitStatus(status, oldStatus);
  }

  public override async takeScreenshotWithLight(): Promise<Buffer | null> {
    if (this.captureDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.captureDelayMs));
    }
    const placeholder = this.getPlaceholder();
    return placeholder ? Buffer.from(placeholder) : null;
  }
}

class DeliveryRecorder {
  public readonly notifications: ScenarioNotification[] = [];
  private nextThread = 1;
  private nextMessage = 1;

  public constructor(private readonly discord?: DiscordE2EOptions) {}

  public readonly printThread = async (
    input: PrintThreadDeliveryInput
  ): Promise<DiscordDeliveryResult<{ threadId: string }>> => {
    const result = this.discord
      ? await deliverPrintThread(input)
      : ({ status: "sent", value: { threadId: `mock-thread-${this.nextThread++}` } } as const);
    const threadId = result.value?.threadId;
    if (threadId) {
      this.record({
        id: threadId,
        kind: "thread",
        tags: input.tags,
        threadId,
        title: input.embed.data.title ?? input.title,
        ...(this.discord ? { url: `https://discord.com/channels/${this.discord.guildId}/${threadId}` } : {})
      });
    }
    return result;
  };

  public readonly threadNotification = async (
    input: ThreadNotificationDeliveryInput
  ): Promise<DiscordDeliveryResult<{ messageId: string }>> => {
    const result = this.discord
      ? await deliverThreadNotification(input)
      : ({ status: "sent", value: { messageId: `mock-message-${this.nextMessage++}` } } as const);
    const messageId = result.value?.messageId;
    if (messageId) {
      this.record({
        id: messageId,
        kind: "message",
        tags: input.tags,
        threadId: input.threadId,
        title: input.embed.data.title ?? "Notification",
        ...(this.discord
          ? { url: `https://discord.com/channels/${this.discord.guildId}/${input.threadId}/${messageId}` }
          : {})
      });
    }
    return result;
  };

  public getCreatedThread(threadId: string): ScenarioNotification | undefined {
    return this.notifications.find(notification => notification.kind === "thread" && notification.id === threadId);
  }

  public markThreadDeleted(threadId: string): void {
    for (const notification of this.notifications) {
      if (notification.threadId === threadId) {
        notification.deleted = true;
      }
    }
  }

  private record(notification: ScenarioNotification): void {
    if (
      !this.notifications.some(candidate => candidate.kind === notification.kind && candidate.id === notification.id)
    ) {
      this.notifications.push(notification);
    }
  }
}

const wait = async (durationMs: number): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, durationMs));
};

const waitUntil = async (predicate: () => boolean, description: string, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await wait(5);
  }
};

const matchesPublishedStep = (view: PrinterStatusView, step: PublishStep): boolean => {
  if (step.action === "raw" || step.action === "stop") {
    return true;
  }
  if (!view.print) {
    return false;
  }
  if (step.action === "project") {
    return view.print.state === "PREPARE";
  }

  const payload = step.payload ?? {};
  return (
    (step.state === undefined || view.print.state === step.state) &&
    (payload.mc_percent === undefined || view.print.progressPercent === payload.mc_percent) &&
    (payload.layer_num === undefined || view.print.currentLayer === payload.layer_num) &&
    (payload.total_layer_num === undefined || view.print.maxLayers === payload.total_layer_num) &&
    (payload.mc_remaining_time === undefined || view.print.remainingTime === payload.mc_remaining_time) &&
    (payload.subtask_name === undefined || view.print.project === payload.subtask_name)
  );
};

export const inspectDiscordTarget = async (discord: DiscordE2EOptions): Promise<DiscordTargetDetails> => {
  await initDiscordClient();
  try {
    const channel = await getDiscordClient()?.channels.fetch(discord.forumChannelId);
    if (!channel || channel.type !== ChannelType.GuildForum || channel.guildId !== discord.guildId) {
      throw new Error("Discord E2E target is not the configured guild forum");
    }
    return {
      ...discord,
      forumName: channel.name,
      guildName: channel.guild.name
    };
  } finally {
    await shutdownDiscordClient();
  }
};

export class ScenarioSession {
  private readonly storageDirectory = mkdtempSync(join(tmpdir(), "bambu-mqtt-scenario-"));
  private readonly printerOptions: ScenarioPrinterOptions;
  private readonly timeScale: number;
  private readonly discord?: DiscordE2EOptions;
  private readonly captureDelayMs: number;
  private readonly printer: MockMqttPrinter;
  private readonly recorder: DeliveryRecorder;
  private readonly activeThreads = new Map<string, ActivePrintThread>();
  private manager?: PrinterManager;
  private config?: PrinterConfig;
  private placeholder?: Buffer;
  private latestStatus?: Status;
  private discordStarted = false;
  private started = false;
  private stopped = false;

  public constructor(options: ScenarioSessionOptions = {}) {
    this.printerOptions = options.printer ?? { ...DEFAULT_SCENARIO_PRINTER };
    this.timeScale = options.timeScale ?? 0.01;
    if (!Number.isFinite(this.timeScale) || this.timeScale <= 0) {
      throw new Error("Scenario time scale must be greater than zero");
    }
    this.discord = options.discord;
    this.captureDelayMs = options.captureDelayMs ?? 0;
    this.printer = new MockMqttPrinter({
      host: "127.0.0.1",
      port: 0,
      serial: this.printerOptions.serial,
      accessCode: this.printerOptions.accessCode
    });
    this.recorder = new DeliveryRecorder(this.discord);
  }

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }
    if (this.stopped) {
      throw new Error("A stopped scenario session cannot be restarted");
    }

    try {
      await this.printer.start();
      this.config = {
        id: this.printerOptions.id,
        name: this.printerOptions.name,
        ip: this.printer.host,
        port: this.printer.port,
        rtcPort: 60_000,
        serial: this.printer.serial,
        accessCode: this.printerOptions.accessCode,
        forumChannelId: this.discord?.forumChannelId ?? "mock-forum",
        enabled: true,
        createdAt: 1,
        updatedAt: 1
      };
      if (this.discord) {
        await this.prepareDiscord(this.config);
        this.discordStarted = true;
      }
      this.manager = this.createManager(this.config);
      if (!(await this.manager.startPrinter(this.printerOptions.id))) {
        throw new Error("Real PrinterManager could not connect to the mock MQTT printer");
      }
      await this.printer.waitForPushall(1, 5_000);
      this.started = true;
    } catch (error) {
      try {
        await this.stop();
      } catch (shutdownError) {
        throw new AggregateError([error, shutdownError], "Scenario session startup and shutdown failed", {
          cause: shutdownError
        });
      }
      throw error;
    }
  }

  public async play(
    scenario: PrinterScenario,
    onStep?: (index: number, action: string) => void
  ): Promise<ScenarioPlayerResult> {
    this.ensureStarted();
    return await playScenario(scenario, this.printer, {
      timeScale: this.timeScale,
      reconnectTimeoutMs: 5_000,
      restart: () => this.restartManager(),
      afterPublish: step => this.afterPublish(step),
      onStep
    });
  }

  public async playSteps(steps: ScenarioStep[]): Promise<ScenarioPlayerResult> {
    return await this.play({ version: 1, name: "interactive-actions", steps, expect: {} });
  }

  public async disconnectMqtt(): Promise<void> {
    this.ensureStarted();
    await this.printer.pause();
  }

  public async reconnectMqtt(resume?: Omit<StatusStep, "action">): Promise<void> {
    this.ensureStarted();
    const nextPushall = this.printer.pushallCount + 1;
    await this.printer.resume();
    await this.printer.waitForPushall(nextPushall, 5_000);
    if (resume) {
      await this.playSteps([{ action: "status", ...resume }]);
    }
  }

  public setPlaceholder(buffer: Buffer): void {
    this.placeholder = Buffer.from(buffer);
  }

  public getPlaceholder(): Buffer | undefined {
    return this.placeholder ? Buffer.from(this.placeholder) : undefined;
  }

  public getNotifications(): ScenarioNotification[] {
    return this.recorder.notifications.map(notification => ({ ...notification, tags: [...notification.tags] }));
  }

  public getPrinterStatus(): PrinterStatusView {
    return this.manager?.getPrinterStatus(this.printerOptions.id) ?? { running: false, connected: false };
  }

  public getPushallCount(): number {
    return this.printer.pushallCount;
  }

  public async waitForNotificationTitles(titles: readonly string[]): Promise<void> {
    await waitUntil(
      () => titles.every(title => this.recorder.notifications.some(notification => notification.title === title)),
      "expected notifications"
    );
  }

  public async settle(): Promise<void> {
    await wait(100);
  }

  public snapshot(): ScenarioSessionSnapshot {
    const view = this.getPrinterStatus();
    const current = this.latestStatus;
    return {
      running: view.running,
      connected: view.connected,
      printer: { ...this.printerOptions },
      mqtt: {
        host: this.printer.host,
        port: this.printer.port,
        pushallCount: this.printer.pushallCount,
        paused: this.printer.isPaused
      },
      discordMode: this.discord ? "discord-e2e" : "mock-discord",
      mediaConfigured: this.placeholder !== undefined,
      ...(current
        ? {
            current: {
              state: current.state,
              currentLayer: current.currentLayer,
              maxLayers: current.maxLayers,
              progressPercent: current.progressPercent,
              startedAt: current.startedAt,
              remainingTime: current.remainingTime,
              model: current.model,
              project: current.project,
              subtaskId: current.subtaskId,
              taskId: current.taskId,
              gcodeFile: current.gcodeFile,
              plate: current.plate,
              trayColor: current.trayColor,
              trayType: current.trayType,
              isMulticolor: current.isMulticolor,
              cancellationRequested: current.cancellationRequested,
              hasProjectImage: current.projectImage !== undefined && current.projectImage !== null
            }
          }
        : {}),
      notifications: this.getNotifications()
    };
  }

  public async deleteDiscordThread(threadId: string): Promise<void> {
    if (!this.discord || !this.discordStarted) {
      throw new Error("Discord thread deletion is only available in real Discord mode");
    }
    const created = this.recorder.getCreatedThread(threadId);
    if (!created || created.deleted) {
      throw new Error("Only a thread created by the current session can be deleted");
    }
    const channel = await getDiscordClient()?.channels.fetch(threadId);
    if (
      !channel?.isThread() ||
      channel.parentId !== this.discord.forumChannelId ||
      channel.guildId !== this.discord.guildId
    ) {
      throw new Error("Discord thread no longer belongs to the configured session forum");
    }
    await channel.delete("Explicit deletion from the mock MQTT printer bench");
    this.recorder.markThreadDeleted(threadId);
  }

  public async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    const errors: unknown[] = [];
    const clean = async (operation: () => Promise<void>): Promise<void> => {
      try {
        await operation();
      } catch (error) {
        errors.push(error);
      }
    };
    const manager = this.manager;
    this.manager = undefined;
    if (manager) {
      await clean(() => manager.stopAll());
    }
    await clean(() => this.printer.stop());
    if (this.discordStarted) {
      await clean(shutdownDiscordClient);
      this.discordStarted = false;
    }
    try {
      rmSync(this.storageDirectory, { recursive: true, force: true });
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Controlled scenario session shutdown failed");
    }
  }

  private ensureStarted(): void {
    if (!this.started || this.stopped || !this.manager) {
      throw new Error("Scenario session is not running");
    }
  }

  private async prepareDiscord(config: PrinterConfig): Promise<void> {
    const discord = this.discord;
    if (!discord) {
      throw new Error("Discord target is not configured");
    }
    await initDiscordClient();
    try {
      const channel = await getDiscordClient()?.channels.fetch(discord.forumChannelId);
      if (!channel || channel.type !== ChannelType.GuildForum || channel.guildId !== discord.guildId) {
        throw new Error("Discord E2E target is not the configured guild forum");
      }
      await reconcileConfiguredForumTags([config]);
    } catch (error) {
      await shutdownDiscordClient();
      throw error;
    }
  }

  private readonly setActiveThread = (
    printerId: string,
    threadId: string,
    identity?: PrintIdentity | string
  ): boolean => {
    const normalizedIdentity = typeof identity === "object" ? identity : undefined;
    this.activeThreads.set(printerId, {
      threadId,
      updatedAt: Date.now(),
      ...(typeof identity === "string" ? { project: identity } : {}),
      ...(normalizedIdentity ? { identity: normalizedIdentity, project: normalizedIdentity.project } : {})
    });
    return true;
  };

  private readonly removeActiveThread = (printerId: string): boolean => {
    this.activeThreads.delete(printerId);
    return true;
  };

  private createManager(config: PrinterConfig): PrinterManager {
    const coordinator = new PrintNotificationCoordinator({
      storageDirectory: this.storageDirectory,
      mqttLossDelayMs: Math.max(10, Math.round(60_000 * this.timeScale)),
      deliverPrintThread: this.recorder.printThread,
      deliverThreadNotification: this.recorder.threadNotification,
      setActivePrintThread: this.setActiveThread,
      removeActivePrintThread: this.removeActiveThread
    });
    return new PrinterManager({
      getPrinter: id => (id === this.printerOptions.id ? config : null),
      getEnabledPrinters: () => [config],
      getActivePrintThread: id => this.activeThreads.get(id) ?? null,
      removeActivePrintThread: this.removeActiveThread,
      createClient: clientConfig =>
        new ScenarioBambuLabClient(
          clientConfig,
          Math.max(10, Math.round(5_000 * this.timeScale)),
          this.captureDelayMs,
          () => this.placeholder,
          status => {
            this.latestStatus = { ...status };
          }
        ),
      notificationCoordinator: coordinator
    });
  }

  private async restartManager(): Promise<void> {
    const manager = this.manager;
    const config = this.config;
    if (!manager || !config) {
      throw new Error("Cannot restart a scenario manager that has not started");
    }
    await waitUntil(
      () => this.activeThreads.has(this.printerOptions.id),
      "active print thread persistence before restart"
    );
    await manager.stopAll();
    this.manager = this.createManager(config);
    if (!(await this.manager.startPrinter(this.printerOptions.id))) {
      throw new Error("Real PrinterManager could not reconnect after a scenario restart");
    }
  }

  private async afterPublish(step: PublishStep): Promise<void> {
    if (step.action !== "raw" && step.action !== "stop") {
      await waitUntil(() => matchesPublishedStep(this.getPrinterStatus(), step), `${step.action} status processing`);
    }
  }
}
