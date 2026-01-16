import type { EmbedBuilder } from "discord.js";

import { NOTIFICATION_PERCENT } from "../../constants";
import { PrintState } from "../../enums";
import { getLogger } from "../../libs/logger";
import type { PrinterConfig } from "../../types/printer-config";
import type { Status } from "../../types/printer-status";
import { getDiscordTagsForStatus, getInitialDiscordTags } from "../../utils/discord-tags.util";
import BambuLabClient from "../bambu-lab";
import { getEnabledPrinters, getPrinter } from "../database";
import { createPrintThread, sendToThread, updateThreadTags } from "../discord/bot";
import {
  printCancelled,
  printFailed,
  printFinished,
  printPaused,
  printProgress,
  printRecovery,
  printResumed,
  printStarted,
  printStopped
} from "../discord/embeds";

const logger = getLogger("PrinterManager");

interface PrinterInstance {
  client: BambuLabClient;
  config: PrinterConfig;
  lastProgressPercent: number;
  printThreads: Map<string, string>;
}

class PrinterManager {
  private printers: Map<string, PrinterInstance> = new Map();

  /**
   * Démarre toutes les imprimantes activées
   */
  public async startAll(): Promise<void> {
    const enabledPrinters = getEnabledPrinters();
    logger.info({ count: enabledPrinters.length }, "Starting all enabled printers");

    for (const config of enabledPrinters) {
      await this.startPrinter(config.id);
    }
  }

  /**
   * Arrête toutes les imprimantes
   */
  public stopAll(): void {
    logger.info({ count: this.printers.size }, "Stopping all printers");

    for (const [id] of this.printers) {
      this.stopPrinter(id);
    }
  }

  /**
   * Démarre une imprimante spécifique
   */
  public async startPrinter(printerId: string): Promise<boolean> {
    const config = getPrinter(printerId);
    if (!config) {
      logger.error({ printerId }, "Printer not found");
      return false;
    }

    if (this.printers.has(printerId)) {
      logger.warn({ printerId }, "Printer already running");
      return true;
    }

    const client = new BambuLabClient(config);
    const instance: PrinterInstance = {
      client,
      config,
      lastProgressPercent: 0,
      printThreads: new Map()
    };

    this.setupClientListeners(instance);

    try {
      await client.connect();
      this.printers.set(printerId, instance);
      logger.info({ printerId, name: config.name }, "Printer started");
      return true;
    } catch (error) {
      logger.error({ printerId, error }, "Failed to start printer");
      return false;
    }
  }

  /**
   * Arrête une imprimante spécifique
   */
  public stopPrinter(printerId: string): boolean {
    const instance = this.printers.get(printerId);
    if (!instance) {
      logger.warn({ printerId }, "Printer not running");
      return false;
    }

    instance.client.disconnect();
    this.printers.delete(printerId);
    logger.info({ printerId }, "Printer stopped");
    return true;
  }

  /**
   * Redémarre une imprimante
   */
  public async restartPrinter(printerId: string): Promise<boolean> {
    this.stopPrinter(printerId);
    return await this.startPrinter(printerId);
  }

  /**
   * Obtient le statut d'une imprimante
   */
  public getPrinterStatus(printerId: string): { running: boolean; connected: boolean } {
    const instance = this.printers.get(printerId);
    return {
      running: !!instance,
      connected: instance?.client.isConnected() ?? false
    };
  }

  /**
   * Liste toutes les imprimantes en cours d'exécution
   */
  public getRunningPrinters(): string[] {
    return Array.from(this.printers.keys());
  }

  /**
   * Configure les listeners pour un client
   */
  private setupClientListeners(instance: PrinterInstance): void {
    const { client } = instance;

    client.on("status", async (newStatus: Status, oldStatus: Status) => {
      await this.handleStatusChange(instance, newStatus, oldStatus);
    });
  }

  /**
   * Génère une clé unique pour un print job
   */
  private getPrintKey(config: PrinterConfig, status: Status): string {
    const timestamp = status.startedAt ?? Date.now();
    return `${config.id}:${status.model ?? "unknown"}:${status.project ?? "unknown"}:${timestamp}`;
  }

  /**
   * Met à jour les tags d'un thread
   */
  private async updatePrintThreadTags(
    instance: PrinterInstance,
    printKey: string,
    status: Status,
    state: PrintState
  ): Promise<void> {
    const threadId = instance.printThreads.get(printKey);
    if (!threadId) {
      return;
    }

    const tags = getDiscordTagsForStatus({ ...status, state });
    // Ajouter le tag de l'imprimante
    tags.push(instance.config.name);

    logger.debug({ threadId, tags, state, printer: instance.config.name }, "Updating thread tags");
    await updateThreadTags(threadId, tags);
  }

  /**
   * Gère les changements de statut d'une imprimante
   */
  private async handleStatusChange(instance: PrinterInstance, newStatus: Status, oldStatus: Status): Promise<void> {
    const { config } = instance;
    oldStatus.state = oldStatus.state ?? PrintState.UNKNOWN;

    logger.debug(
      {
        printer: config.name,
        transition: `${oldStatus.state} → ${newStatus.state}`,
        progress: newStatus.progressPercent,
        project: newStatus.project
      },
      "State transition detected"
    );

    const printKey = this.getPrintKey(config, newStatus);

    const sendMessage = async (embed: EmbedBuilder): Promise<void> => {
      const threadId = instance.printThreads.get(printKey);
      if (threadId) {
        const sent = await sendToThread(threadId, embed);
        if (sent) {
          return;
        }
      }
      // Pas de fallback webhook - on log juste l'erreur
      logger.warn({ printer: config.name, printKey }, "No thread found for print, message not sent");
    };

    // Print started
    if (
      [PrintState.PREPARE, PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(oldStatus.state) &&
      [PrintState.RUNNING].includes(newStatus.state)
    ) {
      instance.lastProgressPercent = 0;
      logger.info({ printer: config.name }, "Print started");

      const existingThreadId = instance.printThreads.get(printKey);
      if (existingThreadId) {
        logger.warn({ printKey, threadId: existingThreadId }, "Thread already exists for this print key");
        return;
      }

      const embed = printStarted(newStatus);
      const title = newStatus.project ?? "Impression";
      const tags = [...getInitialDiscordTags(newStatus.isMulticolor ?? false), config.name];

      logger.info({ printKey, tags, printer: config.name }, "Creating new thread for print");
      const threadId = await createPrintThread(printKey, title, embed, undefined, tags, config.forumChannelId);

      if (threadId) {
        instance.printThreads.set(printKey, threadId);
        logger.info({ printKey, threadId, printer: config.name }, "Thread created and mapped");
      }
      return;
    }

    // Print finished/failed/stopped
    if (
      [PrintState.RUNNING].includes(oldStatus.state) &&
      [PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(newStatus.state)
    ) {
      if (newStatus.state === PrintState.FINISH) {
        const isCompleted = (newStatus.progressPercent ?? 0) === 100;
        if (isCompleted) {
          logger.info({ printer: config.name }, "Print finished successfully");
          const embed = await printFinished(newStatus, config);
          await sendMessage(embed);
          await this.updatePrintThreadTags(instance, printKey, newStatus, PrintState.FINISH);
        } else {
          logger.info({ printer: config.name, progress: newStatus.progressPercent }, "Print cancelled");
          const embed = await printCancelled(newStatus, config);
          await sendMessage(embed);
          await this.updatePrintThreadTags(instance, printKey, newStatus, PrintState.FAILED);
        }
      } else if (newStatus.state === PrintState.FAILED) {
        logger.info({ printer: config.name }, "Print failed");
        const embed = await printFailed(newStatus, config);
        await sendMessage(embed);
        await this.updatePrintThreadTags(instance, printKey, newStatus, PrintState.FAILED);
      } else if (newStatus.state === PrintState.IDLE) {
        logger.info({ printer: config.name }, "Print stopped");
        const embed = await printStopped(config);
        await sendMessage(embed);
        await this.updatePrintThreadTags(instance, printKey, newStatus, PrintState.FAILED);
      }

      if (instance.printThreads.has(printKey)) {
        logger.debug({ printKey, printer: config.name }, "Removing print from active threads mapping");
        instance.printThreads.delete(printKey);
      }
      return;
    }

    // Print paused
    if ([PrintState.RUNNING].includes(oldStatus.state) && [PrintState.PAUSE].includes(newStatus.state)) {
      logger.info({ printer: config.name }, "Print paused");
      const embed = await printPaused(config);
      await sendMessage(embed);
      await this.updatePrintThreadTags(instance, printKey, newStatus, PrintState.PAUSE);
      return;
    }

    // Print resumed
    if ([PrintState.PAUSE].includes(oldStatus.state) && [PrintState.RUNNING].includes(newStatus.state)) {
      logger.info({ printer: config.name }, "Print resumed");
      const embed = await printResumed(config);
      await sendMessage(embed);
      await this.updatePrintThreadTags(instance, printKey, newStatus, PrintState.RUNNING);
      return;
    }

    // Recovery from power outage
    if ([PrintState.UNKNOWN].includes(oldStatus.state) && [PrintState.PAUSE].includes(newStatus.state)) {
      logger.info({ printer: config.name }, "Print recovery");
      instance.lastProgressPercent = (newStatus.progressPercent % NOTIFICATION_PERCENT) * NOTIFICATION_PERCENT;
      const embed = await printRecovery(config);
      await sendMessage(embed);
      return;
    }

    // Reconnect to running print
    if ([PrintState.UNKNOWN].includes(oldStatus.state) && [PrintState.RUNNING].includes(newStatus.state)) {
      instance.lastProgressPercent =
        Math.trunc(newStatus.progressPercent / NOTIFICATION_PERCENT) * NOTIFICATION_PERCENT;
      return;
    }

    // Other state transitions we ignore
    if (
      [PrintState.UNKNOWN].includes(oldStatus.state) &&
      [PrintState.PREPARE, PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(newStatus.state)
    ) {
      return;
    }

    if (
      [PrintState.PREPARE, PrintState.FINISH, PrintState.FAILED].includes(oldStatus.state) &&
      [PrintState.IDLE].includes(newStatus.state)
    ) {
      return;
    }

    // Progress update
    const progressPercent = newStatus.progressPercent ?? 0;
    if (
      progressPercent >= instance.lastProgressPercent + NOTIFICATION_PERCENT &&
      newStatus.state === PrintState.RUNNING
    ) {
      instance.lastProgressPercent = progressPercent;
      const embed = await printProgress(newStatus, config);
      await sendMessage(embed);
    }
  }
}

// Export singleton
export const printerManager = new PrinterManager();
