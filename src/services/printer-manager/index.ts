import { CHAMBER_LIGHT_OFF_DELAY_MS, NOTIFICATION_PERCENT } from "../../constants";
import { PrintState } from "../../enums";
import { isTlsCertificateError } from "../../libs/bambu-tls";
import { getLogger } from "../../libs/logger";
import type { EmbedResult } from "../../types/discord";
import type { PrinterConfig } from "../../types/printer-config";
import type { Status } from "../../types/printer-status";
import { getDiscordTagsForStatus, getInitialDiscordTags } from "../../utils/discord-tags.util";
import BambuLabClient from "../bambu-lab";
import {
  type ActivePrintThread,
  type PrintIdentity,
  getActivePrintThread,
  getEnabledPrinters,
  getPrinter,
  removeActivePrintThread,
  setActivePrintThread
} from "../database";
import { createPrintThread, isPrintThreadAvailable, sendToThread, updateThreadTags } from "../discord/bot";
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

const normalizeIdentityText = (value: string | number | undefined): string | undefined => {
  const normalized = value === undefined ? "" : String(value).trim();
  return normalized || undefined;
};

const normalizeIdentityId = (value: string | number | undefined): string | undefined => {
  const normalized = normalizeIdentityText(value);
  return normalized && normalized !== "0" ? normalized : undefined;
};

const buildPrintIdentity = (status: Status): PrintIdentity | undefined => {
  const subtaskId = normalizeIdentityId(status.subtaskId);
  const taskId = normalizeIdentityId(status.taskId);
  const gcodeFile = normalizeIdentityText(status.gcodeFile);
  const plate = normalizeIdentityText(status.plate);
  const project = normalizeIdentityText(status.project);
  const availableFields = {
    ...(taskId ? { taskId } : {}),
    ...(gcodeFile ? { gcodeFile } : {}),
    ...(plate ? { plate } : {}),
    ...(project ? { project } : {})
  };

  if (subtaskId) {
    return { subtaskId, ...availableFields };
  }
  if (taskId) {
    return availableFields;
  }
  if (gcodeFile && project && plate) {
    return { gcodeFile, project, plate };
  }
  if (project) {
    return { project };
  }
  return undefined;
};

const getRecoveredPrintIdentity = (thread: ActivePrintThread): PrintIdentity | undefined => {
  const project = normalizeIdentityText(thread.project);
  if (thread.identity) {
    return thread.identity.project || !project ? thread.identity : { ...thread.identity, project };
  }
  return project ? { project } : undefined;
};

const arePrintIdentitiesIncompatible = (
  persistedIdentity: PrintIdentity | undefined,
  currentIdentity: PrintIdentity | undefined
): boolean => {
  if (!persistedIdentity || !currentIdentity) {
    return false;
  }

  if (persistedIdentity.subtaskId && currentIdentity.subtaskId) {
    return persistedIdentity.subtaskId !== currentIdentity.subtaskId;
  }

  if (persistedIdentity.taskId && currentIdentity.taskId) {
    return (
      persistedIdentity.taskId !== currentIdentity.taskId ||
      (!!persistedIdentity.plate && !!currentIdentity.plate && persistedIdentity.plate !== currentIdentity.plate)
    );
  }

  const persistedDescriptionKnown =
    !!persistedIdentity.gcodeFile && !!persistedIdentity.project && !!persistedIdentity.plate;
  const currentDescriptionKnown = !!currentIdentity.gcodeFile && !!currentIdentity.project && !!currentIdentity.plate;
  if (persistedDescriptionKnown && currentDescriptionKnown) {
    return (
      persistedIdentity.gcodeFile !== currentIdentity.gcodeFile ||
      persistedIdentity.project !== currentIdentity.project ||
      persistedIdentity.plate !== currentIdentity.plate
    );
  }

  return (
    !!persistedIdentity.project && !!currentIdentity.project && persistedIdentity.project !== currentIdentity.project
  );
};

interface PrinterInstance {
  client: BambuLabClient;
  config: PrinterConfig;
  lastProgressPercent: number;
  printThreads: Map<string, string>;
  recoveredThread?: ActivePrintThread;
  chamberLightTimer?: NodeJS.Timeout;
}

interface StartingPrinter {
  instance?: PrinterInstance;
  promise: Promise<boolean>;
  cancelled: boolean;
  cancellation?: Promise<void>;
}

class PrinterManager {
  private printers: Map<string, PrinterInstance> = new Map();
  private startingPrinters: Map<string, StartingPrinter> = new Map();
  private printerOperations: Map<string, Promise<void>> = new Map();

  /**
   * Démarre toutes les imprimantes activées
   */
  public async startAll(): Promise<void> {
    const enabledPrinters = getEnabledPrinters();
    logger.info({ count: enabledPrinters.length }, "Starting all enabled printers");

    let availablePrinters = 0;
    for (const config of enabledPrinters) {
      if (await this.startPrinterInternal(config.id, true)) {
        availablePrinters += 1;
      }
    }

    const unavailablePrinters = enabledPrinters.length - availablePrinters;
    const context = { availablePrinters, unavailablePrinters };
    if (unavailablePrinters > 0) {
      logger.warn(context, "Printer startup complete; unavailable printers will retry in the background");
    } else {
      logger.info(context, "Printer startup complete");
    }
  }

  /**
   * Arrête toutes les imprimantes
   */
  public async stopAll(): Promise<void> {
    const printerIds = new Set([
      ...this.printers.keys(),
      ...this.startingPrinters.keys(),
      ...this.printerOperations.keys()
    ]);
    logger.info({ count: printerIds.size }, "Stopping all printers");
    const results = await Promise.allSettled(Array.from(printerIds, id => this.stopPrinter(id)));
    const errors = results.flatMap(result => (result.status === "rejected" ? [result.reason] : []));
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to stop all printers");
    }
  }

  /**
   * Démarre une imprimante spécifique
   */
  public async startPrinter(printerId: string): Promise<boolean> {
    return await this.startPrinterInternal(printerId, false);
  }

  private async startPrinterInternal(printerId: string, failOnCertificateError: boolean): Promise<boolean> {
    const config = getPrinter(printerId);
    if (!config) {
      logger.error({ printerId }, "Printer not found");
      return false;
    }

    const startingPrinter = this.startingPrinters.get(printerId);
    if (startingPrinter) {
      logger.warn({ printerId }, "Printer already starting");
      return await startingPrinter.promise;
    }
    if (this.printers.has(printerId) && !this.printerOperations.has(printerId)) {
      logger.warn({ printerId }, "Printer already running");
      return true;
    }

    const pendingStart: StartingPrinter = {
      cancelled: false,
      promise: Promise.resolve(false)
    };
    const promise = this.enqueuePrinterOperation(printerId, async () => {
      try {
        return await this.startPrinterOperation(config, pendingStart, failOnCertificateError);
      } finally {
        if (this.startingPrinters.get(printerId) === pendingStart) {
          this.startingPrinters.delete(printerId);
        }
      }
    });
    pendingStart.promise = promise;
    this.startingPrinters.set(printerId, pendingStart);
    return await promise;
  }

  private async startPrinterOperation(
    config: PrinterConfig,
    startingPrinter: StartingPrinter,
    failOnCertificateError: boolean = false
  ): Promise<boolean> {
    if (startingPrinter.cancelled) {
      return false;
    }
    if (this.printers.has(config.id)) {
      logger.warn({ printerId: config.id }, "Printer already running");
      return true;
    }

    const client = new BambuLabClient(config);
    const instance: PrinterInstance = {
      client,
      config,
      lastProgressPercent: 0,
      printThreads: new Map(),
      recoveredThread: getActivePrintThread(config.id) ?? undefined
    };
    startingPrinter.instance = instance;
    this.setupClientListeners(instance);

    try {
      await instance.client.connect();
      if (startingPrinter.cancelled) {
        await instance.client.disconnect();
        return false;
      }

      this.printers.set(config.id, instance);
      logger.info({ printerId: config.id, name: instance.config.name }, "Printer started");
      return true;
    } catch (error) {
      if (!startingPrinter.cancelled && !isTlsCertificateError(error)) {
        this.printers.set(config.id, instance);
        logger.warn(
          { printerId: config.id, name: instance.config.name, error },
          "Printer unavailable at startup; MQTT will retry in the background"
        );
        return false;
      }

      await (startingPrinter.cancellation ?? instance.client.disconnect()).catch(disconnectError => {
        logger.error(
          { printerId: config.id, error: disconnectError },
          "Failed to clean up printer after start failure"
        );
      });
      if (isTlsCertificateError(error)) {
        logger.error({ printerId: config.id, error }, "Failed to start printer due to MQTT certificate validation");
        if (failOnCertificateError) {
          throw error;
        }
      }
      return false;
    }
  }

  /**
   * Arrête une imprimante spécifique
   */
  public async stopPrinter(printerId: string): Promise<boolean> {
    const startingPrinter = this.startingPrinters.get(printerId);
    if (startingPrinter) {
      this.cancelPrinterStart(startingPrinter);
    }

    return await this.enqueuePrinterOperation(printerId, async () => {
      if (startingPrinter) {
        await startingPrinter.cancellation;
        logger.info({ printerId }, "Printer start cancelled");
        return true;
      }

      return await this.stopRunningPrinter(printerId);
    });
  }

  private cancelPrinterStart(startingPrinter: StartingPrinter): void {
    startingPrinter.cancelled = true;
    if (startingPrinter.instance && !startingPrinter.cancellation) {
      const cancellation = startingPrinter.instance.client.disconnect();
      startingPrinter.cancellation = cancellation;
      void cancellation.catch(() => undefined);
    }
  }

  private async stopRunningPrinter(printerId: string): Promise<boolean> {
    const instance = this.printers.get(printerId);
    if (!instance) {
      logger.warn({ printerId }, "Printer not running");
      return false;
    }

    if (instance.chamberLightTimer) {
      clearTimeout(instance.chamberLightTimer);
      instance.chamberLightTimer = undefined;
    }

    await instance.client.disconnect();
    if (this.printers.get(printerId) === instance) {
      this.printers.delete(printerId);
    }
    logger.info({ printerId }, "Printer stopped");
    return true;
  }

  private enqueuePrinterOperation<T>(printerId: string, operation: () => Promise<T>): Promise<T> {
    const previousOperation = this.printerOperations.get(printerId) ?? Promise.resolve();
    const result = previousOperation.then(operation, operation);
    const operationTail = result.then(
      () => undefined,
      () => undefined
    );
    this.printerOperations.set(printerId, operationTail);
    void operationTail.then(() => {
      if (this.printerOperations.get(printerId) === operationTail) {
        this.printerOperations.delete(printerId);
      }
    });
    return result;
  }

  /**
   * Redémarre une imprimante
   */
  public async restartPrinter(printerId: string): Promise<boolean> {
    const currentStart = this.startingPrinters.get(printerId);
    if (currentStart) {
      this.cancelPrinterStart(currentStart);
    }

    const config = getPrinter(printerId);
    const restartStart: StartingPrinter = {
      cancelled: false,
      promise: Promise.resolve(false)
    };
    const promise = this.enqueuePrinterOperation(printerId, async () => {
      try {
        await this.stopRunningPrinter(printerId);
        if (!config) {
          logger.error({ printerId }, "Printer not found");
          return false;
        }
        return await this.startPrinterOperation(config, restartStart);
      } finally {
        if (this.startingPrinters.get(printerId) === restartStart) {
          this.startingPrinters.delete(printerId);
        }
      }
    });
    restartStart.promise = promise;
    this.startingPrinters.set(printerId, restartStart);
    return await promise;
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

  public async takeScreenshot(printerId: string): Promise<Buffer | null> {
    const instance = this.printers.get(printerId);
    if (!instance?.client.isConnected()) {
      return null;
    }

    return await instance.client.takeScreenshotWithLight();
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
    return `${config.id}:${status.model ?? "unknown"}:${timestamp}`;
  }

  private async createTrackedThread(
    instance: PrinterInstance,
    printKey: string,
    status: Status,
    result: EmbedResult,
    tags: string[]
  ): Promise<string | null> {
    const title = status.project ?? "Impression";
    const threadId = await createPrintThread(
      printKey,
      title,
      result.embed,
      result.files,
      tags,
      instance.config.forumChannelId
    );

    if (threadId) {
      instance.printThreads.set(printKey, threadId);
      instance.recoveredThread = undefined;
      if (!setActivePrintThread(instance.config.id, threadId, buildPrintIdentity(status))) {
        logger.warn({ printKey, threadId }, "Thread created but its recovery state could not be persisted");
      }
      logger.info({ printKey, threadId, printer: instance.config.name }, "Thread created and mapped");
    }

    return threadId;
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

    if (
      oldStatus.state === PrintState.UNKNOWN &&
      [PrintState.PREPARE, PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(newStatus.state)
    ) {
      instance.recoveredThread = undefined;
      removeActivePrintThread(config.id);
    }

    const sendMessage = async (result: EmbedResult): Promise<void> => {
      const threadId = instance.printThreads.get(printKey);
      if (threadId) {
        const sent = await sendToThread(threadId, result.embed, result.files);
        if (sent) {
          return;
        }
      }
      // Pas de fallback webhook - on log juste l'erreur
      logger.warn({ printer: config.name, printKey }, "No thread found for print, message not sent");
    };

    // Reattach a persisted thread after a restart, or create one if no previous mapping exists.
    if (oldStatus.state === PrintState.UNKNOWN && [PrintState.RUNNING, PrintState.PAUSE].includes(newStatus.state)) {
      instance.lastProgressPercent =
        Math.trunc((newStatus.progressPercent ?? 0) / NOTIFICATION_PERCENT) * NOTIFICATION_PERCENT;

      if (instance.recoveredThread) {
        const recoveredThread = instance.recoveredThread;
        const persistedIdentity = getRecoveredPrintIdentity(recoveredThread);
        const currentIdentity = buildPrintIdentity(newStatus);
        if (arePrintIdentitiesIncompatible(persistedIdentity, currentIdentity)) {
          logger.info(
            {
              printer: config.name,
              persistedIdentity,
              currentIdentity
            },
            "Persisted thread belongs to a different print"
          );
          removeActivePrintThread(config.id);
        } else if (await isPrintThreadAvailable(recoveredThread.threadId)) {
          instance.printThreads.set(printKey, recoveredThread.threadId);
          logger.info(
            { printKey, threadId: recoveredThread.threadId, printer: config.name },
            "Recovered active print thread"
          );
        } else {
          removeActivePrintThread(config.id);
        }
        instance.recoveredThread = undefined;
      }

      if (!instance.printThreads.has(printKey)) {
        const result =
          newStatus.state === PrintState.PAUSE
            ? await printRecovery(() => instance.client.takeScreenshotWithLight())
            : printStarted(newStatus);
        const tags = [...getDiscordTagsForStatus(newStatus), config.name];
        await this.createTrackedThread(instance, printKey, newStatus, result, tags);
      } else if (newStatus.state === PrintState.PAUSE) {
        const result = await printRecovery(() => instance.client.takeScreenshotWithLight());
        await sendMessage(result);
        await this.updatePrintThreadTags(instance, printKey, newStatus, PrintState.PAUSE);
      }
      return;
    }

    // Print started
    if (
      [PrintState.PREPARE, PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(oldStatus.state) &&
      [PrintState.RUNNING].includes(newStatus.state)
    ) {
      instance.lastProgressPercent = 0;
      logger.info({ printer: config.name }, "Print started");

      // Cancel pending chamber light timer if a new print starts
      if (instance.chamberLightTimer) {
        clearTimeout(instance.chamberLightTimer);
        instance.chamberLightTimer = undefined;
        logger.info({ printer: config.name }, "Chamber light timer cancelled (new print started)");
      }

      const existingThreadId = instance.printThreads.get(printKey);
      if (existingThreadId) {
        logger.warn({ printKey, threadId: existingThreadId }, "Thread already exists for this print key");
        return;
      }

      const result = printStarted(newStatus);
      const tags = [...getInitialDiscordTags(newStatus.isMulticolor ?? false), config.name];

      logger.info({ printKey, tags, printer: config.name }, "Creating new thread for print");
      await this.createTrackedThread(instance, printKey, newStatus, result, tags);
      return;
    }

    // Print finished/failed/stopped
    if (
      [PrintState.RUNNING, PrintState.PAUSE].includes(oldStatus.state) &&
      [PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(newStatus.state)
    ) {
      if (newStatus.state === PrintState.FINISH) {
        const isCompleted = (newStatus.progressPercent ?? 0) === 100;
        if (isCompleted) {
          logger.info({ printer: config.name }, "Print finished successfully");
          const result = await printFinished(newStatus, () => instance.client.takeScreenshotWithLight());
          await sendMessage(result);
          await this.updatePrintThreadTags(instance, printKey, newStatus, PrintState.FINISH);
        } else {
          logger.info({ printer: config.name, progress: newStatus.progressPercent }, "Print cancelled");
          const result = await printCancelled(newStatus, () => instance.client.takeScreenshotWithLight());
          await sendMessage(result);
          await this.updatePrintThreadTags(instance, printKey, newStatus, PrintState.FAILED);
        }
      } else if (newStatus.state === PrintState.FAILED) {
        logger.info({ printer: config.name }, "Print failed");
        const result = await printFailed(newStatus, () => instance.client.takeScreenshotWithLight());
        await sendMessage(result);
        await this.updatePrintThreadTags(instance, printKey, newStatus, PrintState.FAILED);
      } else if (newStatus.state === PrintState.IDLE) {
        logger.info({ printer: config.name }, "Print stopped");
        const result = await printStopped(() => instance.client.takeScreenshotWithLight());
        await sendMessage(result);
        await this.updatePrintThreadTags(instance, printKey, newStatus, PrintState.FAILED);
      }

      if (instance.printThreads.has(printKey)) {
        logger.debug({ printKey, printer: config.name }, "Removing print from active threads mapping");
        instance.printThreads.delete(printKey);
      }
      removeActivePrintThread(config.id);

      // Schedule chamber light turn-off after delay if no new print starts
      logger.info({ printer: config.name, delayMs: CHAMBER_LIGHT_OFF_DELAY_MS }, "Scheduling chamber light turn-off");
      if (instance.chamberLightTimer) {
        clearTimeout(instance.chamberLightTimer);
      }
      instance.chamberLightTimer = setTimeout(() => {
        instance.chamberLightTimer = undefined;
        instance.client.turnOffChamberLight();
      }, CHAMBER_LIGHT_OFF_DELAY_MS);

      return;
    }

    // Print paused
    if ([PrintState.RUNNING].includes(oldStatus.state) && [PrintState.PAUSE].includes(newStatus.state)) {
      logger.info({ printer: config.name }, "Print paused");
      const result = await printPaused(() => instance.client.takeScreenshotWithLight());
      await sendMessage(result);
      await this.updatePrintThreadTags(instance, printKey, newStatus, PrintState.PAUSE);
      return;
    }

    // Print resumed
    if ([PrintState.PAUSE].includes(oldStatus.state) && [PrintState.RUNNING].includes(newStatus.state)) {
      logger.info({ printer: config.name }, "Print resumed");
      const result = await printResumed(() => instance.client.takeScreenshotWithLight());
      await sendMessage(result);
      await this.updatePrintThreadTags(instance, printKey, newStatus, PrintState.RUNNING);
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
      const result = await printProgress(newStatus, () => instance.client.takeScreenshotWithLight());
      await sendMessage(result);
    }
  }
}

// Export singleton
export const printerManager = new PrinterManager();
