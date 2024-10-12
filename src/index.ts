import { NOTIFICATION_PERCENT } from "./constants";
import { PrintState } from "./enums";
import { sendWebhookMessage } from "./libs/discord";
import BambuLabClient from "./services/bambu-lab";
import { printFailed } from "./services/messages/print-failed";
import { printFinished } from "./services/messages/print-finished";
import { printPaused } from "./services/messages/print-paused";
import { printProgress } from "./services/messages/print-progress";
import { printRecovery } from "./services/messages/print-recovery";
import { printResumed } from "./services/messages/print-resumed";
import { printStarted } from "./services/messages/print-started";
import { printStopped } from "./services/messages/print-stopped";

try {
  const bambuLabClient = new BambuLabClient();

  let lastProgressPercent = 0;

  bambuLabClient.on("status", async (newStatus, oldStatus) => {
    oldStatus.state = oldStatus.state ?? PrintState.UNKNOWN;

    if (
      [PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(oldStatus.state) &&
      [PrintState.PREPARE, PrintState.RUNNING].includes(newStatus.state)
    ) {
      lastProgressPercent = 0;
      return await sendWebhookMessage(await printStarted(newStatus));
    } else if (
      [PrintState.PREPARE, PrintState.RUNNING].includes(oldStatus.state) &&
      [PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(newStatus.state)
    ) {
      if (newStatus.state === PrintState.FINISH) {
        return await sendWebhookMessage(await printFinished(newStatus));
      } else if (newStatus.state === PrintState.FAILED) {
        return await sendWebhookMessage(await printFailed(newStatus));
      } else if (newStatus.state === PrintState.IDLE) {
        return await sendWebhookMessage(await printStopped());
      }
    } else if ([PrintState.RUNNING].includes(oldStatus.state) && [PrintState.PAUSE].includes(newStatus.state)) {
      return await sendWebhookMessage(await printPaused());
    } else if ([PrintState.PAUSE].includes(oldStatus.state) && [PrintState.RUNNING].includes(newStatus.state)) {
      return await sendWebhookMessage(await printResumed());
    } else if ([PrintState.UNKNOWN].includes(oldStatus.state) && [PrintState.PAUSE].includes(newStatus.state)) {
      lastProgressPercent = (newStatus.progressPercent % NOTIFICATION_PERCENT) * NOTIFICATION_PERCENT;
      return await sendWebhookMessage(await printRecovery());
    } else if ([PrintState.UNKNOWN].includes(oldStatus.state) && [PrintState.RUNNING].includes(newStatus.state)) {
      lastProgressPercent = Math.trunc(newStatus.progressPercent / NOTIFICATION_PERCENT) * NOTIFICATION_PERCENT;
      // this happens when the client connects to the printer while it already has an ongoing job
      // we ignore this for now
      return;
    } else if (
      [PrintState.UNKNOWN].includes(oldStatus.state) &&
      [PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(newStatus.state)
    ) {
      // this usually only happens when the client connects, all of which we ignore
      return;
    } else if (
      [PrintState.FINISH, PrintState.FAILED].includes(oldStatus.state) &&
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
} catch (error) {
  console.error(error);
}
