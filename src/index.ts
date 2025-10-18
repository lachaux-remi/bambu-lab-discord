import { NOTIFICATION_PERCENT } from "./constants";
import { PrintState } from "./enums";
import { sendWebhookMessage } from "./libs/discord";
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

const logger = getLogger("Application");
const bambuLabClient = new BambuLabClient();

let lastProgressPercent = 0;

bambuLabClient.on("status", async (newStatus, oldStatus) => {
  oldStatus.state = oldStatus.state ?? PrintState.UNKNOWN;

  logger.debug(
    {
      transition: `${oldStatus.state} → ${newStatus.state}`,
      progress: newStatus.progressPercent,
      project: newStatus.project
    },
    "State transition detected"
  );

  if (
    [PrintState.PREPARE, PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(oldStatus.state) &&
    [PrintState.RUNNING].includes(newStatus.state)
  ) {
    lastProgressPercent = 0;
    logger.info("Print started");
    return await sendWebhookMessage(await printStarted(newStatus));
  } else if (
    [PrintState.RUNNING].includes(oldStatus.state) &&
    [PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(newStatus.state)
  ) {
    if (newStatus.state === PrintState.FINISH) {
      // Check if print was completed (100%) or cancelled (<100%)
      const isCompleted = (newStatus.progressPercent ?? 0) === 100;
      if (isCompleted) {
        logger.info("Print finished successfully");
        return await sendWebhookMessage(await printFinished(newStatus));
      } else {
        logger.info({ progress: newStatus.progressPercent }, "Print cancelled");
        return await sendWebhookMessage(await printCancelled(newStatus));
      }
    } else if (newStatus.state === PrintState.FAILED) {
      logger.info("Print failed");
      return await sendWebhookMessage(await printFailed(newStatus));
    } else if (newStatus.state === PrintState.IDLE) {
      logger.info("Print stopped");
      return await sendWebhookMessage(await printStopped());
    }
  } else if ([PrintState.RUNNING].includes(oldStatus.state) && [PrintState.PAUSE].includes(newStatus.state)) {
    logger.info("Print paused");
    return await sendWebhookMessage(await printPaused());
  } else if ([PrintState.PAUSE].includes(oldStatus.state) && [PrintState.RUNNING].includes(newStatus.state)) {
    logger.info("Print resumed");
    return await sendWebhookMessage(await printResumed());
  } else if ([PrintState.UNKNOWN].includes(oldStatus.state) && [PrintState.PAUSE].includes(newStatus.state)) {
    logger.info("Print recovery");
    lastProgressPercent = (newStatus.progressPercent % NOTIFICATION_PERCENT) * NOTIFICATION_PERCENT;
    return await sendWebhookMessage(await printRecovery());
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
    await sendWebhookMessage(await printProgress(newStatus));
  }
});
bambuLabClient.connect().catch(() => true);
