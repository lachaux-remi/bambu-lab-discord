import { getLogger } from "../../libs/logger";
import type { PrinterStatusView } from "../../services/printer-manager";
import type { ScenarioPlayerResult } from "./player";
import type { PrinterScenario } from "./scenario";
import { type DiscordE2EOptions, type ScenarioNotification, ScenarioSession } from "./session";

const logger = getLogger("MQTT-ScenarioRunner");

export interface RunScenarioOptions {
  discord?: DiscordE2EOptions;
  timeScale?: number;
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

export const runScenario = async (
  scenario: PrinterScenario,
  options: RunScenarioOptions = {}
): Promise<ScenarioRunResult> => {
  const session = new ScenarioSession({ ...options, captureDelayMs: 10 });
  let result: ScenarioPlayerResult | undefined;
  let final: PrinterStatusView | undefined;
  let notifications: ScenarioNotification[] = [];
  let pushallCount = 0;
  let runError: unknown;
  let shutdownError: unknown;

  try {
    await session.start();
    result = await session.play(scenario, (index, action) =>
      logger.info({ scenario: scenario.name, step: index + 1, action }, "Running step")
    );
    await session.waitForNotificationTitles(scenario.expect.includeNotificationTitles ?? []);
    await session.settle();
    final = session.getPrinterStatus();
    notifications = session.getNotifications();
    pushallCount = session.getPushallCount();
    assertScenario(scenario, final, notifications, pushallCount);
  } catch (error) {
    runError = error;
  } finally {
    try {
      await session.stop();
    } catch (error) {
      shutdownError = error;
    }
  }

  if (runError || shutdownError) {
    throw new AggregateError(
      [runError, shutdownError].filter(error => error !== undefined),
      shutdownError ? "Scenario run or controlled shutdown failed" : "Scenario run failed"
    );
  }
  if (!final || !result) {
    throw new Error("Scenario runner completed without a result");
  }
  return {
    status: "passed",
    name: scenario.name,
    mode: options.discord ? "discord-e2e" : "mock-discord",
    ...result,
    pushallCount,
    final,
    notifications,
    shutdown: "clean"
  };
};
