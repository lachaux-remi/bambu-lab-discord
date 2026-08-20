import { CHAMBER_LIGHT_OFF_DELAY_MS, NOTIFICATION_PERCENT } from "../../constants";
import { PrintState } from "../../enums";
import { isTlsCertificateError } from "../../libs/bambu-tls";
import { getLogger } from "../../libs/logger";
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
  removeActivePrintThread
} from "../database";
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
import { printNotificationCoordinator } from "./print-notification-coordinator";

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
  latestStatus?: Status;
  recoveredThread?: ActivePrintThread;
  chamberLightTimer?: NodeJS.Timeout;
}

export interface PrinterStatusView {
  readonly running: boolean;
  readonly connected: boolean;
  readonly print?: {
    readonly state?: PrintState;
    readonly project?: string;
    readonly progressPercent?: number;
    readonly currentLayer?: number;
    readonly maxLayers?: number;
    readonly remainingTime?: number;
  };
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
    printNotificationCoordinator.start();
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
    await printNotificationCoordinator.stop();
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
    printNotificationCoordinator.start();
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
  public getPrinterStatus(printerId: string): PrinterStatusView {
    const instance = this.printers.get(printerId);
    return {
      running: !!instance,
      connected: instance?.client.isConnected() ?? false,
      ...(instance?.latestStatus
        ? {
            print: {
              state: instance.latestStatus.state,
              project: instance.latestStatus.project,
              progressPercent: instance.latestStatus.progressPercent,
              currentLayer: instance.latestStatus.currentLayer,
              maxLayers: instance.latestStatus.maxLayers,
              remainingTime: instance.latestStatus.remainingTime
            }
          }
        : {})
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

    client.on("lost", () => {
      void printNotificationCoordinator.communicationLost(instance.config.id);
    });
    client.on("ready", () => {
      void printNotificationCoordinator.communicationReady(instance.config.id);
    });
    client.on("cancellationRequested", () => {
      void printNotificationCoordinator.recordCancellationRequested(instance.config.id);
    });
    client.on("status", async (newStatus: Status, oldStatus: Status) => {
      printNotificationCoordinator.restoreCancellationRequested(instance.config.id, newStatus);
      instance.latestStatus = { ...newStatus };
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

  private getNotificationContext(instance: PrinterInstance, printKey: string, status: Status) {
    return {
      printerId: instance.config.id,
      printerName: instance.config.name,
      printKey,
      status
    };
  }

  private async takeBestEffortScreenshot(instance: PrinterInstance): Promise<Buffer | null> {
    try {
      return await instance.client.takeScreenshotWithLight();
    } catch (error) {
      logger.warn({ printer: instance.config.name, error }, "Screenshot unavailable; continuing notification");
      return null;
    }
  }

  private scheduleChamberLightOff(instance: PrinterInstance): void {
    logger.info(
      { printer: instance.config.name, delayMs: CHAMBER_LIGHT_OFF_DELAY_MS },
      "Scheduling chamber light turn-off"
    );
    if (instance.chamberLightTimer) {
      clearTimeout(instance.chamberLightTimer);
    }
    instance.chamberLightTimer = setTimeout(() => {
      instance.chamberLightTimer = undefined;
      instance.client.turnOffChamberLight();
    }, CHAMBER_LIGHT_OFF_DELAY_MS);
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
    const context = this.getNotificationContext(instance, printKey, newStatus);
    await printNotificationCoordinator.recordStatus(context);

    const sendMessage = async (
      result: Awaited<ReturnType<typeof printProgress>>,
      state = newStatus.state,
      terminal = false,
      capture = false
    ) => {
      const tags = [...getDiscordTagsForStatus({ ...newStatus, state }), config.name];
      await printNotificationCoordinator.enqueueNotification(
        context,
        result,
        tags,
        terminal,
        capture ? () => this.takeBestEffortScreenshot(instance) : undefined
      );
    };

    if (
      oldStatus.state === PrintState.UNKNOWN &&
      [PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(newStatus.state)
    ) {
      const recoveredThread = instance.recoveredThread;
      if (
        !recoveredThread ||
        arePrintIdentitiesIncompatible(getRecoveredPrintIdentity(recoveredThread), buildPrintIdentity(newStatus))
      ) {
        instance.recoveredThread = undefined;
        removeActivePrintThread(config.id);
        printNotificationCoordinator.discardPrint(config.id);
        return;
      }
      printNotificationCoordinator.recoverThread(context, recoveredThread.threadId);
      instance.recoveredThread = undefined;
      if (newStatus.state === PrintState.FINISH && (newStatus.progressPercent ?? 0) === 100) {
        await sendMessage(await printFinished(newStatus, async () => null), PrintState.FINISH, true, true);
      } else if (newStatus.state === PrintState.FINISH || newStatus.cancellationRequested === true) {
        await sendMessage(await printCancelled(newStatus, async () => null), PrintState.FAILED, true, true);
      } else if (newStatus.state === PrintState.FAILED) {
        await sendMessage(await printFailed(newStatus, async () => null), PrintState.FAILED, true, true);
      } else {
        await sendMessage(await printStopped(async () => null), PrintState.FAILED, true, true);
      }
      this.scheduleChamberLightOff(instance);
      return;
    }

    if (oldStatus.state === PrintState.UNKNOWN && newStatus.state === PrintState.PREPARE) {
      instance.recoveredThread = undefined;
      removeActivePrintThread(config.id);
      printNotificationCoordinator.discardPrint(config.id);
    }

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
          printNotificationCoordinator.discardPrint(config.id);
        } else {
          printNotificationCoordinator.recoverThread(context, recoveredThread.threadId);
          logger.info(
            { printKey, threadId: recoveredThread.threadId, printer: config.name },
            "Recovered active print thread"
          );
        }
        instance.recoveredThread = undefined;
      }

      if (!printNotificationCoordinator.hasPrintTarget(config.id, printKey)) {
        const result =
          newStatus.state === PrintState.PAUSE ? await printRecovery(async () => null) : printStarted(newStatus);
        const tags = [...getDiscordTagsForStatus(newStatus), config.name];
        await printNotificationCoordinator.enqueueThreadCreation(
          context,
          result,
          tags,
          config.forumChannelId,
          newStatus.project ?? "Impression",
          buildPrintIdentity(newStatus),
          newStatus.state === PrintState.PAUSE ? () => this.takeBestEffortScreenshot(instance) : undefined
        );
      } else if (newStatus.state === PrintState.PAUSE) {
        const result = await printRecovery(async () => null);
        await sendMessage(result, PrintState.PAUSE, false, true);
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

      if (printNotificationCoordinator.hasPrintTarget(config.id, printKey)) {
        logger.warn({ printKey }, "Thread already exists for this print key");
        return;
      }

      const result = printStarted(newStatus);
      const tags = [...getInitialDiscordTags(newStatus.isMulticolor ?? false), config.name];

      logger.info({ printKey, tags, printer: config.name }, "Creating new thread for print");
      await printNotificationCoordinator.enqueueThreadCreation(
        context,
        result,
        tags,
        config.forumChannelId,
        newStatus.project ?? "Impression",
        buildPrintIdentity(newStatus)
      );
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
          const result = await printFinished(newStatus, async () => null);
          await sendMessage(result, PrintState.FINISH, true, true);
        } else {
          logger.info({ printer: config.name, progress: newStatus.progressPercent }, "Print cancelled");
          const result = await printCancelled(newStatus, async () => null);
          await sendMessage(result, PrintState.FAILED, true, true);
        }
      } else if (newStatus.state === PrintState.FAILED) {
        const cancelled = newStatus.cancellationRequested === true;
        logger.info({ printer: config.name }, cancelled ? "Print cancelled" : "Print failed");
        const result = await (cancelled ? printCancelled : printFailed)(newStatus, async () => null);
        await sendMessage(result, PrintState.FAILED, true, true);
      } else if (newStatus.state === PrintState.IDLE) {
        logger.info({ printer: config.name }, "Print stopped");
        const result = await printStopped(async () => null);
        await sendMessage(result, PrintState.FAILED, true, true);
      }

      // Schedule chamber light turn-off after delay if no new print starts
      this.scheduleChamberLightOff(instance);

      return;
    }

    // Print paused
    if ([PrintState.RUNNING].includes(oldStatus.state) && [PrintState.PAUSE].includes(newStatus.state)) {
      logger.info({ printer: config.name }, "Print paused");
      const result = await printPaused(async () => null);
      await sendMessage(result, PrintState.PAUSE, false, true);
      return;
    }

    // Print resumed
    if ([PrintState.PAUSE].includes(oldStatus.state) && [PrintState.RUNNING].includes(newStatus.state)) {
      logger.info({ printer: config.name }, "Print resumed");
      const result = await printResumed(async () => null);
      await sendMessage(result, PrintState.RUNNING, false, true);
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
      const result = await printProgress(newStatus, async () => null);
      await sendMessage(result, newStatus.state, false, true);
    }
  }
}

// Export singleton
export const printerManager = new PrinterManager();
