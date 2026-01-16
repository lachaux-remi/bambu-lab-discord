import type { EmbedBuilder } from "discord.js";

import { NOTIFICATION_PERCENT } from "./constants";
import { PrintState } from "./enums";
import {
  createPrintThread,
  initDiscordClient,
  sendToThread,
  sendWebhookMessage,
  updateThreadTags
} from "./libs/discord";
import { getLogger } from "./libs/logger";
import BambuLabClient from "./services/bambu-lab";
import { printCancelled } from "./services/messages/print-cancelled";
import { printFailed } from "./services/messages/print-failed";
import { printFinished } from "./services/messages/print-finished";
import { printPaused } from "./services/messages/print-paused";
import { printProgress } from "./services/messages/print-progress";
import { printRecovery } from "./services/messages/print-recovery";
import { printResumed } from "./services/messages/print-resumed";
import { printStarted } from "./services/messages/print-started";
import { printStopped } from "./services/messages/print-stopped";
import type { Status } from "./types/printer-status";
import { getInitialDiscordTags } from "./utils/discord-tags.util";

const logger = getLogger("Application");
const bambuLabClient = new BambuLabClient();

let lastProgressPercent = 0;

// In-memory mapping: printKey -> threadId
const printThreads = new Map<string, string>();

// Initialize Discord bot (non-blocking)
initDiscordClient().catch(err => logger.warn({ err }, "Discord init failed"));

// Generate a unique key for each print job
// Using startedAt ensures each new print gets its own thread
const getPrintKey = (status: Status) => {
  // startedAt is set when project_file is received, so it's unique per print job
  const timestamp = status.startedAt ?? Date.now();
  return `${status.model ?? "unknown"}:${status.project ?? "unknown"}:${timestamp}`;
};

// Helper to update thread tags based on print state
const updatePrintThreadTags = async (printKey: string, status: Status, state: PrintState) => {
  const threadId = printThreads.get(printKey);
  if (!threadId) {
    return;
  }

  const colorTag = (status.isMulticolor ?? false) ? "Multicolore" : "Monocolor";
  let stateTag: string;

  switch (state) {
    case PrintState.FINISH:
      stateTag = "Réussi";
      break;
    case PrintState.FAILED:
      stateTag = "Échoué";
      break;
    case PrintState.PAUSE:
      stateTag = "En pause";
      break;
    default:
      stateTag = "En cours";
  }

  const tags = [stateTag, colorTag];
  logger.debug({ threadId, tags, state }, "Updating thread tags");
  await updateThreadTags(threadId, tags);
};

bambuLabClient.on("status", async (newStatus: Status, oldStatus: Status) => {
  oldStatus.state = oldStatus.state ?? PrintState.UNKNOWN;

  logger.debug(
    {
      transition: `${oldStatus.state} → ${newStatus.state}`,
      progress: newStatus.progressPercent,
      project: newStatus.project
    },
    "State transition detected"
  );

  const printKey = getPrintKey(newStatus);

  const sendMessage = async (embed: EmbedBuilder) => {
    const threadId = printThreads.get(printKey);
    if (threadId) {
      const sent = await sendToThread(threadId, embed);
      if (sent) {
        return;
      }
    }
    await sendWebhookMessage(embed);
  };

  if (
    [PrintState.PREPARE, PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(oldStatus.state) &&
    [PrintState.RUNNING].includes(newStatus.state)
  ) {
    lastProgressPercent = 0;
    logger.info("Print started");

    // Check if thread already exists for this print
    const existingThreadId = printThreads.get(printKey);
    if (existingThreadId) {
      logger.warn(
        { printKey, threadId: existingThreadId },
        "Thread already exists for this print key - reusing existing thread"
      );
      return;
    }

    const embed = (await printStarted(newStatus)) as EmbedBuilder;
    // create thread and post initial message with appropriate tags
    const title = `${newStatus.project ?? "Impression"}`;
    const tags = getInitialDiscordTags(newStatus.isMulticolor ?? false);
    logger.info({ printKey, tags, isMulticolor: newStatus.isMulticolor }, "Creating new thread for print");
    const threadId = await createPrintThread(printKey, title, embed, undefined, tags);
    if (threadId) {
      printThreads.set(printKey, threadId);
      logger.info({ printKey, threadId }, "Thread created and mapped");
    } else {
      await sendWebhookMessage(embed);
    }
    return;
  } else if (
    [PrintState.RUNNING].includes(oldStatus.state) &&
    [PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(newStatus.state)
  ) {
    if (newStatus.state === PrintState.FINISH) {
      // Check if print was completed (100%) or cancelled (<100%)
      const isCompleted = (newStatus.progressPercent ?? 0) === 100;
      if (isCompleted) {
        logger.info("Print finished successfully");
        const embed = (await printFinished(newStatus)) as EmbedBuilder;
        await sendMessage(embed);
        await updatePrintThreadTags(printKey, newStatus, PrintState.FINISH);
      } else {
        logger.info({ progress: newStatus.progressPercent }, "Print cancelled");
        const embed = (await printCancelled(newStatus)) as EmbedBuilder;
        await sendMessage(embed);
        await updatePrintThreadTags(printKey, newStatus, PrintState.FAILED);
      }
    } else if (newStatus.state === PrintState.FAILED) {
      logger.info("Print failed");
      const embed = (await printFailed(newStatus)) as EmbedBuilder;
      await sendMessage(embed);
      await updatePrintThreadTags(printKey, newStatus, PrintState.FAILED);
    } else if (newStatus.state === PrintState.IDLE) {
      logger.info("Print stopped");
      const embed = (await printStopped()) as EmbedBuilder;
      await sendMessage(embed);
      await updatePrintThreadTags(printKey, newStatus, PrintState.FAILED);
    }

    // Clean up thread mapping after print ends
    if (printThreads.has(printKey)) {
      logger.debug({ printKey }, "Removing print from active threads mapping");
      printThreads.delete(printKey);
    }

    // Optionally archive thread later; for now we keep threads open
    // if (threadId) {
    //   await archiveThread(threadId);
    // }

    return;
  } else if ([PrintState.RUNNING].includes(oldStatus.state) && [PrintState.PAUSE].includes(newStatus.state)) {
    logger.info("Print paused");
    const embed = (await printPaused()) as EmbedBuilder;
    await sendMessage(embed);
    await updatePrintThreadTags(printKey, newStatus, PrintState.PAUSE);
    return;
  } else if ([PrintState.PAUSE].includes(oldStatus.state) && [PrintState.RUNNING].includes(newStatus.state)) {
    logger.info("Print resumed");
    const embed = (await printResumed()) as EmbedBuilder;
    await sendMessage(embed);
    await updatePrintThreadTags(printKey, newStatus, PrintState.RUNNING);
    return;
  } else if ([PrintState.UNKNOWN].includes(oldStatus.state) && [PrintState.PAUSE].includes(newStatus.state)) {
    logger.info("Print recovery");
    lastProgressPercent = (newStatus.progressPercent % NOTIFICATION_PERCENT) * NOTIFICATION_PERCENT;
    const embed = (await printRecovery()) as EmbedBuilder;
    await sendMessage(embed);
    return;
  } else if ([PrintState.UNKNOWN].includes(oldStatus.state) && [PrintState.RUNNING].includes(newStatus.state)) {
    lastProgressPercent = Math.trunc(newStatus.progressPercent / NOTIFICATION_PERCENT) * NOTIFICATION_PERCENT;
    // this happens when the client connects to the printer while it already has an ongoing job
    // we ignore this for now
    return;
  } else if (
    [PrintState.UNKNOWN].includes(oldStatus.state) &&
    [PrintState.PREPARE, PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(newStatus.state)
  ) {
    // this usually only happens when the client connects, all of which we ignore
    return;
  } else if (
    [PrintState.PREPARE, PrintState.FINISH, PrintState.FAILED].includes(oldStatus.state) &&
    [PrintState.IDLE].includes(newStatus.state)
  ) {
    // this happens right before a job start, but since IDLE doesn't mean the print has started, we don't do anything
    return;
  }

  const progressPercent = newStatus.progressPercent ?? 0;
  if (progressPercent >= lastProgressPercent + NOTIFICATION_PERCENT && newStatus.state === PrintState.RUNNING) {
    lastProgressPercent = progressPercent;
    const embed = (await printProgress(newStatus)) as EmbedBuilder;
    await sendMessage(embed);
  }
});

bambuLabClient.connect().catch(() => true);
