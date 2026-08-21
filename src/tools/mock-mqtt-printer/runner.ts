import { ChannelType } from "discord.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getLogger } from "../../libs/logger";
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
import { MockMqttPrinter } from "./broker";
import { type ScenarioPlayerResult, playScenario } from "./player";
import type { PrinterScenario, PublishStep } from "./scenario";

const logger = getLogger("MQTT-ScenarioRunner");
const PRINTER_ID = "mock-scenario-printer";
const PRINTER_NAME = "MQTT Scenario Bench";
const SERIAL = "MOCK_SCENARIO_SERIAL";
const ACCESS_CODE = "mock-scenario-access-code";

export interface DiscordE2EOptions {
  forumChannelId: string;
  guildId: string;
}

export interface RunScenarioOptions {
  discord?: DiscordE2EOptions;
  timeScale?: number;
}

export interface ScenarioNotification {
  id: string;
  kind: "message" | "thread";
  tags: string[];
  threadId: string;
  title: string;
  url?: string;
}

export interface ScenarioRunResult extends ScenarioPlayerResult {
  final: PrinterStatusView;
  mode: "discord-e2e" | "mock-discord";
  name: string;
  notifications: ScenarioNotification[];
  pushallCount: number;
  shutdown: "clean";
  status: "passed";
}

class ScenarioBambuLabClient extends BambuLabClient {
  public override async takeScreenshotWithLight(): Promise<Buffer | null> {
    // Keep captures local while preserving enough asynchronous work to exercise the real MQTT backlog under bursts.
    await new Promise(resolve => setTimeout(resolve, 10));
    return null;
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

const assertScenario = (
  scenario: PrinterScenario,
  final: PrinterStatusView,
  notifications: readonly ScenarioNotification[],
  pushallCount: number
): void => {
  const failures: string[] = [];
  const expectedFinal = scenario.expect.final;
  if (expectedFinal?.connected !== undefined && final.connected !== expectedFinal.connected) {
    failures.push(`connected expected ${expectedFinal.connected}, received ${final.connected}`);
  }
  if (expectedFinal?.running !== undefined && final.running !== expectedFinal.running) {
    failures.push(`running expected ${expectedFinal.running}, received ${final.running}`);
  }
  if (expectedFinal?.state !== undefined && final.print?.state !== expectedFinal.state) {
    failures.push(`state expected ${expectedFinal.state}, received ${final.print?.state ?? "undefined"}`);
  }
  if (expectedFinal?.progressPercent !== undefined && final.print?.progressPercent !== expectedFinal.progressPercent) {
    failures.push(
      `progressPercent expected ${expectedFinal.progressPercent}, received ${final.print?.progressPercent ?? "undefined"}`
    );
  }
  const titles = notifications.map(notification => notification.title);
  for (const title of scenario.expect.includeNotificationTitles ?? []) {
    if (!titles.includes(title)) {
      failures.push(`missing notification title ${JSON.stringify(title)}`);
    }
  }
  for (const title of scenario.expect.excludeNotificationTitles ?? []) {
    if (titles.includes(title)) {
      failures.push(`unexpected notification title ${JSON.stringify(title)}`);
    }
  }
  for (const [title, requiredTags] of Object.entries(scenario.expect.requiredTagsByNotificationTitle ?? {})) {
    const matchingNotification = notifications.find(notification => notification.title === title);
    if (!matchingNotification) {
      failures.push(`missing notification title ${JSON.stringify(title)} for tag assertion`);
      continue;
    }
    for (const tag of requiredTags) {
      if (!matchingNotification.tags.includes(tag)) {
        failures.push(`notification ${JSON.stringify(title)} is missing tag ${JSON.stringify(tag)}`);
      }
    }
  }
  if (
    scenario.expect.maximumNotificationCount !== undefined &&
    notifications.length > scenario.expect.maximumNotificationCount
  ) {
    failures.push(
      `notification count expected at most ${scenario.expect.maximumNotificationCount}, received ${notifications.length}`
    );
  }
  if (scenario.expect.minimumPushallCount !== undefined && pushallCount < scenario.expect.minimumPushallCount) {
    failures.push(`pushall count expected at least ${scenario.expect.minimumPushallCount}, received ${pushallCount}`);
  }
  const threadCount = notifications.filter(notification => notification.kind === "thread").length;
  if (scenario.expect.threadCount !== undefined && threadCount !== scenario.expect.threadCount) {
    failures.push(`thread count expected ${scenario.expect.threadCount}, received ${threadCount}`);
  }
  if (failures.length > 0) {
    throw new Error(`Scenario ${scenario.name} failed:\n- ${failures.join("\n- ")}`);
  }
};

const prepareDiscord = async (discord: DiscordE2EOptions, config: PrinterConfig): Promise<void> => {
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
};

export const runScenario = async (
  scenario: PrinterScenario,
  options: RunScenarioOptions = {}
): Promise<ScenarioRunResult> => {
  const timeScale = options.timeScale ?? 0.01;
  const storageDirectory = mkdtempSync(join(tmpdir(), "bambu-mqtt-scenario-"));
  const printer = new MockMqttPrinter({ host: "127.0.0.1", port: 0, serial: SERIAL, accessCode: ACCESS_CODE });
  const recorder = new DeliveryRecorder(options.discord);
  const activeThreads = new Map<string, ActivePrintThread>();
  let manager: PrinterManager | undefined;
  let discordStarted = false;
  let final: PrinterStatusView | undefined;
  let playerResult: ScenarioPlayerResult | undefined;
  let runError: unknown;
  let shutdownError: unknown;

  try {
    await printer.start();
    const config: PrinterConfig = {
      id: PRINTER_ID,
      name: PRINTER_NAME,
      ip: printer.host,
      port: printer.port,
      rtcPort: 60_000,
      serial: printer.serial,
      accessCode: ACCESS_CODE,
      forumChannelId: options.discord?.forumChannelId ?? "mock-forum",
      enabled: true,
      createdAt: 1,
      updatedAt: 1
    };
    if (options.discord) {
      await prepareDiscord(options.discord, config);
      discordStarted = true;
    }
    const setActiveThread = (printerId: string, threadId: string, identity?: PrintIdentity | string): boolean => {
      const normalizedIdentity = typeof identity === "object" ? identity : undefined;
      activeThreads.set(printerId, {
        threadId,
        updatedAt: Date.now(),
        ...(typeof identity === "string" ? { project: identity } : {}),
        ...(normalizedIdentity ? { identity: normalizedIdentity, project: normalizedIdentity.project } : {})
      });
      return true;
    };
    const removeActiveThread = (printerId: string): boolean => {
      activeThreads.delete(printerId);
      return true;
    };
    const createManager = (): PrinterManager => {
      const coordinator = new PrintNotificationCoordinator({
        storageDirectory,
        mqttLossDelayMs: Math.max(10, Math.round(60_000 * timeScale)),
        deliverPrintThread: recorder.printThread,
        deliverThreadNotification: recorder.threadNotification,
        setActivePrintThread: setActiveThread,
        removeActivePrintThread: removeActiveThread
      });
      return new PrinterManager({
        getPrinter: id => (id === PRINTER_ID ? config : null),
        getEnabledPrinters: () => [config],
        getActivePrintThread: id => activeThreads.get(id) ?? null,
        removeActivePrintThread: removeActiveThread,
        createClient: clientConfig =>
          new ScenarioBambuLabClient(clientConfig, 5_000, {
            protocol: "mqtt",
            reconnectPeriodMs: Math.max(10, Math.round(5_000 * timeScale))
          }),
        notificationCoordinator: coordinator
      });
    };
    manager = createManager();

    const started = await manager.startPrinter(PRINTER_ID);
    if (!started) {
      throw new Error("Real PrinterManager could not connect to the mock MQTT printer");
    }
    await printer.waitForPushall(1, 5_000);
    playerResult = await playScenario(scenario, printer, {
      timeScale,
      reconnectTimeoutMs: 5_000,
      restart: async () => {
        const previousManager = manager;
        if (!previousManager) {
          throw new Error("Cannot restart a scenario manager that has not started");
        }
        await waitUntil(() => activeThreads.has(PRINTER_ID), "active print thread persistence before restart");
        await previousManager.stopAll();
        manager = createManager();
        if (!(await manager.startPrinter(PRINTER_ID))) {
          throw new Error("Real PrinterManager could not reconnect after a scenario restart");
        }
      },
      afterPublish: async step => {
        if (step.action !== "raw" && step.action !== "stop") {
          await waitUntil(
            () =>
              matchesPublishedStep(manager?.getPrinterStatus(PRINTER_ID) ?? { running: false, connected: false }, step),
            `${step.action} status processing`
          );
        }
      },
      onStep: (index, action) => logger.info({ scenario: scenario.name, step: index + 1, action }, "Running step")
    });

    const requiredTitles = scenario.expect.includeNotificationTitles ?? [];
    await waitUntil(
      () => requiredTitles.every(title => recorder.notifications.some(notification => notification.title === title)),
      "expected notifications"
    );
    await wait(100);
    final = manager.getPrinterStatus(PRINTER_ID);
    assertScenario(scenario, final, recorder.notifications, printer.pushallCount);
  } catch (error) {
    runError = error;
  } finally {
    const shutdownErrors: unknown[] = [];
    const clean = async (operation: () => Promise<void>): Promise<void> => {
      try {
        await operation();
      } catch (error) {
        shutdownErrors.push(error);
      }
    };
    const runningManager = manager;
    if (runningManager) {
      await clean(() => runningManager.stopAll());
    }
    await clean(() => printer.stop());
    if (discordStarted) {
      await clean(shutdownDiscordClient);
    }
    try {
      rmSync(storageDirectory, { recursive: true, force: true });
    } catch (error) {
      shutdownErrors.push(error);
    }
    if (shutdownErrors.length > 0) {
      shutdownError = new AggregateError(shutdownErrors, "Controlled shutdown failed");
    }
  }

  if (runError || shutdownError) {
    const errors: unknown[] = [];
    if (runError) {
      errors.push(runError);
    }
    if (shutdownError) {
      errors.push(shutdownError);
    }
    throw new AggregateError(
      errors,
      shutdownError ? "Scenario run or controlled shutdown failed" : "Scenario run failed"
    );
  }
  if (!final || !playerResult) {
    throw new Error("Scenario runner completed without a result");
  }
  return {
    status: "passed",
    name: scenario.name,
    mode: options.discord ? "discord-e2e" : "mock-discord",
    ...playerResult,
    pushallCount: printer.pushallCount,
    final,
    notifications: recorder.notifications,
    shutdown: "clean"
  };
};
