import { MessageCommand } from "../../enums";
import { MockMqttPrinter } from "./broker";
import type { PrinterScenario, PublishStep, StatusStep } from "./scenario";

export interface ScenarioPlayerOptions {
  afterPublish?: (step: PublishStep) => Promise<void>;
  onStep?: (index: number, action: string) => void;
  reconnectTimeoutMs?: number;
  restart?: () => Promise<void>;
  timeScale?: number;
}

export interface ScenarioPlayerResult {
  messagesPublished: number;
  outages: number;
  restarts: number;
}

const wait = async (durationMs: number): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, durationMs));
};

const scaledDuration = (durationMs: number, timeScale: number): number =>
  durationMs === 0 ? 0 : Math.max(1, Math.round(durationMs * timeScale));

export const serializePublishStep = (step: PublishStep): string => {
  switch (step.action) {
    case "raw":
      return step.payload;
    case "project":
      return JSON.stringify({
        print: {
          ...step.payload,
          command: MessageCommand.PROJECT_FILE
        }
      });
    case "status":
      return JSON.stringify({
        print: {
          ...step.payload,
          command: MessageCommand.PUSH_STATUS,
          ...(step.state === undefined ? {} : { gcode_state: step.state })
        }
      });
    case "stop":
      return JSON.stringify({ print: { command: MessageCommand.STOP, result: step.result } });
  }
};

export const playScenario = async (
  scenario: PrinterScenario,
  printer: MockMqttPrinter,
  options: ScenarioPlayerOptions = {}
): Promise<ScenarioPlayerResult> => {
  const timeScale = options.timeScale ?? 1;
  if (!Number.isFinite(timeScale) || timeScale <= 0) {
    throw new Error("Scenario time scale must be greater than zero");
  }
  let messagesPublished = 0;
  let outages = 0;
  let restarts = 0;

  const publish = async (step: PublishStep, synchronize: boolean): Promise<void> => {
    await printer.publish(serializePublishStep(step));
    messagesPublished += 1;
    if (synchronize) {
      await options.afterPublish?.(step);
    }
  };

  for (const [index, step] of scenario.steps.entries()) {
    options.onStep?.(index, step.action);
    if (step.action === "wait") {
      await wait(scaledDuration(step.durationMs, timeScale));
      continue;
    }
    if (step.action === "burst") {
      const burst: Promise<void>[] = [];
      for (let messageIndex = 0; messageIndex < step.count; messageIndex += 1) {
        const message = step.messages[messageIndex % step.messages.length];
        if (!message) {
          throw new Error("Burst does not contain a message template");
        }
        burst.push(publish(message, false));
      }
      await Promise.all(burst);
      continue;
    }
    if (step.action === "outage") {
      outages += 1;
      const nextPushall = printer.pushallCount + 1;
      await printer.pause();
      await wait(scaledDuration(step.durationMs, timeScale));
      await printer.resume();
      await printer.waitForPushall(nextPushall, options.reconnectTimeoutMs ?? 10_000);
      if (step.resume) {
        const resume: StatusStep = { action: "status", ...step.resume };
        await publish(resume, true);
      }
      continue;
    }
    if (step.action === "restart") {
      restarts += 1;
      const nextPushall = printer.pushallCount + 1;
      await options.restart?.();
      await printer.waitForPushall(nextPushall, options.reconnectTimeoutMs ?? 10_000);
      const resume: StatusStep = { action: "status", ...step.resume };
      await publish(resume, true);
      continue;
    }
    await publish(step, true);
  }

  return { messagesPublished, outages, restarts };
};
