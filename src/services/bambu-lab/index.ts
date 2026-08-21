import { MqttClient, connect } from "mqtt";
import EventEmitter from "node:events";

import { BAMBU_USERNAME, CHAMBER_LIGHT_WARMUP_MS, ERROR_LOG_COOLDOWN_MS, MQTT_PROTOCOL } from "../../constants";
import { LightMode, LightNode, MessageCommand } from "../../enums";
import { getBambuTlsOptions, isTlsCertificateError } from "../../libs/bambu-tls";
import { getLogger } from "../../libs/logger";
import { takeScreenshot } from "../../libs/rtc";
import type { ClientEvents } from "../../types/client-events";
import type { PrinterConfig } from "../../types/printer-config";
import type { PrintMessageCommand } from "../../types/printer-messages";
import PrinterStatus from "../printer-status";
import { parsePrintMessage } from "./print-message-parser";

const logger = getLogger("BambuLab");
const configuredConnectTimeoutMs = Number(process.env.MQTT_CONNECT_TIMEOUT_MS);
const MQTT_CONNECT_TIMEOUT_MS =
  Number.isFinite(configuredConnectTimeoutMs) &&
  configuredConnectTimeoutMs >= 1_000 &&
  configuredConnectTimeoutMs <= 300_000
    ? configuredConnectTimeoutMs
    : 30_000;
const MAX_MQTT_PAYLOAD_SIZE = 1024 * 1024;
const MAX_PENDING_MQTT_MESSAGES = 32;
const MAX_LOGGED_MQTT_KEYS = 16;

const sampleObjectKeys = (value: Record<string, unknown>): string[] => {
  const keys: string[] = [];
  for (const key in value) {
    if (Object.hasOwn(value, key)) {
      keys.push(key);
      if (keys.length === MAX_LOGGED_MQTT_KEYS) {
        break;
      }
    }
  }
  return keys;
};

interface ConnectionAttempt {
  promise: Promise<void>;
  cancel: (error: Error) => Promise<void>;
}

export interface BambuLabClientConnectionOptions {
  protocol?: "mqtt" | "mqtts";
  reconnectPeriodMs?: number;
}

enum MqttConnectionState {
  PENDING = "pending",
  RETRYING = "retrying",
  CONNECTED = "connected",
  STOPPED = "stopped"
}

export default class BambuLabClient extends EventEmitter {
  private mqttClient?: MqttClient;
  private connectionAttempt?: ConnectionAttempt;
  private disconnectPromise?: Promise<void>;
  private printerStatus?: PrinterStatus;
  private readonly config: PrinterConfig;

  private readonly topicReport: string;
  private readonly topicRequest: string;
  private readonly brokerAddress: string;

  private mqttFailureCount: number = 0;
  private mqttOutageStartedAt?: number;
  private mqttSuppressedFailureCount: number = 0;
  private mqttSuppressedFailuresSinceSummary: number = 0;
  private lastMqttErrorSummaryAt?: number;
  private mqttAttemptHasFailure: boolean = false;
  private stopping: boolean = false;
  private sessionReady: boolean = false;
  private chamberLightOn: boolean = false;
  private readonly pendingMessages: PrintMessageCommand[] = [];
  private messageProcessor?: Promise<void>;
  private messageAbortController = new AbortController();
  private backlogWarningLogged: boolean = false;
  private oversizedPayloadWarningLogged: boolean = false;
  private screenshotQueue: Promise<void> = Promise.resolve();

  public constructor(
    config: PrinterConfig,
    private readonly connectTimeoutMs: number = MQTT_CONNECT_TIMEOUT_MS,
    private readonly connectionOptions: BambuLabClientConnectionOptions = {}
  ) {
    super();

    this.config = config;
    this.topicReport = `device/${config.serial}/report`;
    this.topicRequest = `device/${config.serial}/request`;
    this.brokerAddress = `${connectionOptions.protocol ?? MQTT_PROTOCOL}://${config.ip}:${config.port}`;

    this.printerStatus = new PrinterStatus(this);
  }

  /**
   * Get the printer configuration
   */
  public getConfig(): PrinterConfig {
    return this.config;
  }

  /**
   * Get the printer ID
   */
  public getId(): string {
    return this.config.id;
  }

  /**
   * Get the printer name
   */
  public getName(): string {
    return this.config.name;
  }

  public override on<K extends keyof ClientEvents>(event: K, listener: (...arguments_: ClientEvents[K]) => void): this {
    super.on(event as keyof ClientEvents, listener);
    return this;
  }

  public async emitStatus(...arguments_: ClientEvents["status"]): Promise<void> {
    for (const listener of this.listeners("status")) {
      await (listener as (...listenerArguments: ClientEvents["status"]) => void | Promise<void>)(...arguments_);
    }
  }

  public async emitCancellationRequested(): Promise<void> {
    for (const listener of this.listeners("cancellationRequested")) {
      await (listener as () => void | Promise<void>)();
    }
  }

  public connect(): Promise<void> {
    if (this.connectionAttempt) {
      return this.connectionAttempt.promise;
    }
    if (this.mqttClient) {
      return Promise.resolve();
    }

    this.stopping = false;
    this.backlogWarningLogged = false;
    this.oversizedPayloadWarningLogged = false;
    if (this.messageAbortController.signal.aborted) {
      this.messageAbortController = new AbortController();
    }

    let cancelConnection!: ConnectionAttempt["cancel"];
    const promise = new Promise<void>((resolve, reject) => {
      logger.info({ printer: this.config.name, ip: this.config.ip }, "Connecting to printer...");

      const mqttClient = connect(this.brokerAddress, {
        username: BAMBU_USERNAME,
        password: this.config.accessCode,
        connectTimeout: this.connectTimeoutMs,
        reconnectPeriod: this.connectionOptions.reconnectPeriodMs ?? 5000,
        ...((this.connectionOptions.protocol ?? MQTT_PROTOCOL) === "mqtts"
          ? getBambuTlsOptions(this.config.serial)
          : {})
      });
      this.mqttClient = mqttClient;
      let connectionState = MqttConnectionState.PENDING;
      const timeout = setTimeout(() => {
        const error = new Error(`MQTT initial connection timed out after ${this.connectTimeoutMs}ms`);
        this.logMqttConnectionFailure(error);
        void failInitialConnection(error, false);
      }, this.connectTimeoutMs);

      const failInitialConnection = (error: Error, stopTransport: boolean): Promise<void> => {
        if (connectionState === MqttConnectionState.STOPPED) {
          return this.disconnectPromise ?? Promise.resolve();
        }
        if (stopTransport) {
          const initialConnectionPending = connectionState === MqttConnectionState.PENDING;
          connectionState = MqttConnectionState.STOPPED;
          this.stopping = true;
          clearTimeout(timeout);
          this.connectionAttempt = undefined;
          const shutdown = this.shutdownTransport(mqttClient, true);
          if (initialConnectionPending) {
            reject(error);
          }
          return shutdown;
        }
        if (connectionState === MqttConnectionState.CONNECTED) {
          logger.error({ printer: this.config.name, message: error.message }, "Failed to initialize MQTT session");
          mqttClient.reconnect();
          return Promise.resolve();
        }

        const initialConnectionPending = connectionState === MqttConnectionState.PENDING;
        connectionState = MqttConnectionState.RETRYING;
        clearTimeout(timeout);
        this.connectionAttempt = undefined;
        if (mqttClient.connected) {
          mqttClient.reconnect();
        }
        if (initialConnectionPending) {
          reject(error);
        }
        return Promise.resolve();
      };
      cancelConnection = error => failInitialConnection(error, true);

      mqttClient.on("connect", () => {
        if (connectionState === MqttConnectionState.STOPPED || this.stopping || this.mqttClient !== mqttClient) {
          return;
        }

        mqttClient.subscribe(this.topicReport, error => {
          if (error) {
            void failInitialConnection(error, false);
            return;
          }
          if (connectionState === MqttConnectionState.STOPPED || this.stopping || this.mqttClient !== mqttClient) {
            return;
          }

          mqttClient.publish(
            this.topicRequest,
            JSON.stringify({
              pushing: {
                sequence_id: "1",
                command: "pushall"
              },
              user_id: 123_456_789
            }),
            publishError => {
              if (publishError) {
                void failInitialConnection(publishError, false);
                return;
              }

              if (connectionState === MqttConnectionState.STOPPED || this.stopping || this.mqttClient !== mqttClient) {
                return;
              }
              if (connectionState === MqttConnectionState.PENDING) {
                clearTimeout(timeout);
                this.connectionAttempt = undefined;
                resolve();
              }
              connectionState = MqttConnectionState.CONNECTED;
              this.logMqttRecovery();
              this.mqttAttemptHasFailure = false;
              this.sessionReady = true;
              this.emit("ready");
              logger.info({ printer: this.config.name }, "Connected to printer");
            }
          );
        });
      });
      mqttClient.on("reconnect", () => {
        if (!this.stopping && this.mqttClient === mqttClient) {
          this.mqttAttemptHasFailure = false;
        }
      });
      mqttClient.on("disconnect", packet => {
        logger.debug({ printer: this.config.name, reasonCode: packet.reasonCode }, "Disconnected from printer");
      });
      const emitCommunicationLost = () => {
        if (!this.stopping && this.mqttClient === mqttClient && this.sessionReady) {
          this.sessionReady = false;
          this.emit("lost");
        }
      };
      mqttClient.on("offline", emitCommunicationLost);
      mqttClient.on("close", emitCommunicationLost);
      mqttClient.on("message", (receivedTopic: string, payload: Buffer) => {
        if (
          receivedTopic !== this.topicReport ||
          this.stopping ||
          connectionState === MqttConnectionState.STOPPED ||
          this.mqttClient !== mqttClient
        ) {
          return;
        }

        if (payload.byteLength > MAX_MQTT_PAYLOAD_SIZE) {
          if (!this.oversizedPayloadWarningLogged) {
            this.oversizedPayloadWarningLogged = true;
            logger.warn(
              {
                printer: this.config.name,
                payloadLength: payload.byteLength,
                maximumPayloadLength: MAX_MQTT_PAYLOAD_SIZE
              },
              "MQTT message exceeds the maximum allowed size"
            );
          }
          return;
        }

        const message = this.parseMessage(payload.toString());
        if (message) {
          this.enqueueMessage(message);
        }
      });
      mqttClient.on("error", error => {
        if (this.stopping || connectionState === MqttConnectionState.STOPPED || this.mqttClient !== mqttClient) {
          return;
        }
        if (isTlsCertificateError(error)) {
          logger.error(
            {
              printer: this.config.name,
              ip: this.config.ip,
              expectedIdentity: this.config.serial,
              message: error.message
            },
            "BambuLab MQTT certificate validation failed"
          );
          const connectionError = Object.assign(
            new Error(
              `MQTT TLS certificate validation failed for printer ${this.config.name} at ${this.config.ip}; ` +
                `expected identity ${this.config.serial}: ${error.message}`,
              { cause: error }
            ),
            { code: (error as Error & { code: string }).code }
          );
          void failInitialConnection(connectionError, true).catch(shutdownError => {
            logger.error({ printer: this.config.name, error: shutdownError }, "Failed to shut down MQTT transport");
          });
          return;
        } else {
          this.logMqttConnectionFailure(error);
        }
        if (connectionState === MqttConnectionState.PENDING) {
          void failInitialConnection(error, false);
        }
      });
    });

    this.connectionAttempt = {
      promise,
      cancel: error => cancelConnection(error)
    };
    return promise;
  }

  private logMqttConnectionFailure(error: Error): void {
    if (this.mqttAttemptHasFailure) {
      return;
    }
    this.mqttAttemptHasFailure = true;
    const now = Date.now();
    this.mqttOutageStartedAt ??= now;
    this.lastMqttErrorSummaryAt ??= now;
    this.mqttFailureCount += 1;

    const context = {
      printer: this.config.name,
      ip: this.config.ip,
      expectedIdentity: this.config.serial,
      message: error.message
    };
    if (this.mqttFailureCount <= 3) {
      logger.error({ ...context, failure: this.mqttFailureCount }, "Error connecting to BambuLab MQTT server");
      return;
    }

    this.mqttSuppressedFailureCount += 1;
    this.mqttSuppressedFailuresSinceSummary += 1;
    if (now - this.lastMqttErrorSummaryAt < ERROR_LOG_COOLDOWN_MS) {
      return;
    }

    logger.error(
      {
        ...context,
        failures: this.mqttFailureCount,
        suppressedFailures: this.mqttSuppressedFailuresSinceSummary
      },
      "MQTT connection failures continue"
    );
    this.mqttSuppressedFailuresSinceSummary = 0;
    this.lastMqttErrorSummaryAt = now;
  }

  private logMqttRecovery(): void {
    if (this.mqttOutageStartedAt === undefined) {
      return;
    }

    logger.info(
      {
        printer: this.config.name,
        outageDurationMs: Date.now() - this.mqttOutageStartedAt,
        failures: this.mqttFailureCount,
        suppressedFailures: this.mqttSuppressedFailureCount
      },
      "MQTT connection recovered"
    );
    this.mqttFailureCount = 0;
    this.mqttOutageStartedAt = undefined;
    this.mqttSuppressedFailureCount = 0;
    this.mqttSuppressedFailuresSinceSummary = 0;
    this.lastMqttErrorSummaryAt = undefined;
  }

  public disconnect(): Promise<void> {
    if (this.disconnectPromise) {
      return this.disconnectPromise;
    }

    this.stopping = true;
    this.sessionReady = false;
    const connectionAttempt = this.connectionAttempt;
    if (connectionAttempt) {
      return connectionAttempt.cancel(new Error("MQTT initial connection cancelled"));
    }

    const mqttClient = this.mqttClient;
    if (!mqttClient) {
      return Promise.resolve();
    }

    logger.info({ printer: this.config.name }, "Disconnecting from printer");
    return this.shutdownTransport(mqttClient, false);
  }

  private shutdownTransport(mqttClient: MqttClient, force: boolean): Promise<void> {
    if (this.disconnectPromise) {
      return this.disconnectPromise;
    }

    this.pendingMessages.length = 0;
    this.messageAbortController.abort();
    const messageProcessor = this.messageProcessor ?? Promise.resolve();
    const shutdown = Promise.all([messageProcessor, this.screenshotQueue]).then(async () => {
      if (this.mqttClient === mqttClient) {
        this.mqttClient = undefined;
      }
      await mqttClient.endAsync(force);
    });
    const disconnectPromise = shutdown.finally(() => {
      if (this.disconnectPromise === disconnectPromise) {
        this.disconnectPromise = undefined;
      }
    });
    this.disconnectPromise = disconnectPromise;
    return disconnectPromise;
  }

  /**
   * Turn off the chamber light
   */
  public turnOffChamberLight(): void {
    this.setChamberLight(LightMode.OFF);
  }

  /**
   * Turn on the chamber light
   */
  public turnOnChamberLight(): void {
    this.setChamberLight(LightMode.ON);
  }

  private setChamberLight(mode: LightMode, allowWhileStopping = false): void {
    if ((!allowWhileStopping && this.stopping) || !this.mqttClient?.connected) {
      logger.warn({ printer: this.config.name }, `Cannot turn ${mode} chamber light: not connected`);
      return;
    }

    logger.info({ printer: this.config.name }, `Turning ${mode} chamber light`);
    this.mqttClient.publish(
      this.topicRequest,
      JSON.stringify({
        system: {
          sequence_id: "0",
          command: "ledctrl",
          led_node: LightNode.CHAMBER,
          led_mode: mode,
          led_on_time: 500,
          led_off_time: 500,
          loop_times: 1,
          interval_time: 1000
        }
      })
    );
  }

  /**
   * Returns whether the chamber light is currently on
   */
  public isChamberLightOn(): boolean {
    return this.chamberLightOn;
  }

  /**
   * Capture a screenshot, turning on the chamber light beforehand if it is off.
   * The light is turned off again after capture only if it was off before.
   */
  public takeScreenshotWithLight(): Promise<Buffer | null> {
    if (this.stopping) {
      return Promise.resolve(null);
    }

    const screenshot = this.screenshotQueue.then(async () => {
      const wasLightOn = this.chamberLightOn;

      if (!wasLightOn) {
        logger.debug({ printer: this.config.name }, "Chamber light was off, turning on for screenshot");
        this.setChamberLight(LightMode.ON, true);
        await new Promise(resolve => setTimeout(resolve, CHAMBER_LIGHT_WARMUP_MS));
      }

      try {
        return await takeScreenshot(this.config.ip, this.config.accessCode, this.config.serial, this.config.rtcPort);
      } finally {
        if (!wasLightOn) {
          logger.debug({ printer: this.config.name }, "Turning off chamber light after screenshot");
          this.setChamberLight(LightMode.OFF, true);
        }
      }
    });

    this.screenshotQueue = screenshot.then(
      () => undefined,
      () => undefined
    );
    return screenshot;
  }

  public isConnected(): boolean {
    return this.mqttClient?.connected ?? false;
  }

  private parseMessage(packet: string): PrintMessageCommand | undefined {
    let parsedData: unknown;
    try {
      parsedData = JSON.parse(packet);
    } catch {
      logger.error({ packetLength: packet.length }, "Failed to parse MQTT message");
      return;
    }

    if (!parsedData || typeof parsedData !== "object" || Array.isArray(parsedData)) {
      logger.warn({ packetLength: packet.length }, "MQTT message must contain a JSON object");
      return;
    }

    const keys = sampleObjectKeys(parsedData as Record<string, unknown>);

    logger.debug({ key: keys[0] }, "Received message");

    const message = parsePrintMessage(parsedData);
    if (!message) {
      logger.debug({ keys }, "Message not recognized as print message");
      return;
    }

    return message.print;
  }

  private enqueueMessage(message: PrintMessageCommand): void {
    const lastIndex = this.pendingMessages.length - 1;
    const previousMessage = this.pendingMessages[lastIndex];
    const coalescesPreviousStatus =
      message.command === MessageCommand.PUSH_STATUS &&
      previousMessage?.command === MessageCommand.PUSH_STATUS &&
      (message.gcode_state === undefined ||
        previousMessage.gcode_state === undefined ||
        message.gcode_state === previousMessage.gcode_state ||
        this.pendingMessages.length >= MAX_PENDING_MQTT_MESSAGES);
    if (coalescesPreviousStatus) {
      this.pendingMessages[lastIndex] = { ...previousMessage, ...message };
      return;
    }

    if (this.pendingMessages.length >= MAX_PENDING_MQTT_MESSAGES) {
      if (!this.backlogWarningLogged) {
        this.backlogWarningLogged = true;
        logger.warn(
          {
            printer: this.config.name,
            pendingMessages: this.pendingMessages.length,
            maximumPendingMessages: MAX_PENDING_MQTT_MESSAGES
          },
          "MQTT message backlog is full"
        );
      }
      return;
    }

    this.pendingMessages.push(message);
    this.startMessageProcessor();
  }

  private startMessageProcessor(): void {
    if (this.messageProcessor || this.stopping) {
      return;
    }

    const trackedProcessor = this.processPendingMessages().finally(() => {
      if (this.messageProcessor === trackedProcessor) {
        this.messageProcessor = undefined;
        if (this.pendingMessages.length > 0 && !this.stopping) {
          this.startMessageProcessor();
        }
      }
    });
    this.messageProcessor = trackedProcessor;
  }

  private async processPendingMessages(): Promise<void> {
    while (!this.stopping) {
      const message = this.pendingMessages.shift();
      if (!message) {
        return;
      }
      this.backlogWarningLogged = false;

      try {
        await this.processMessage(message, this.messageAbortController.signal);
      } catch (error) {
        logger.error({ printer: this.config.name, error }, "Failed to process MQTT message");
      }
    }
  }

  private async processMessage(message: PrintMessageCommand, signal?: AbortSignal): Promise<void> {
    // Track chamber light state from lights_report
    if (message.command === MessageCommand.PUSH_STATUS && message.lights_report) {
      const chamberLight = message.lights_report.find(light => light.node === LightNode.CHAMBER);
      if (chamberLight) {
        this.chamberLightOn = chamberLight.mode === LightMode.ON;
        logger.debug({ printer: this.config.name, chamberLightOn: this.chamberLightOn }, "Chamber light state updated");
      }
    }

    logger.debug({ command: message.command }, "Processing print message");
    await this.printerStatus?.onUpdate(message, signal);
  }

  protected async onMessage(packet: string): Promise<void> {
    const message = this.parseMessage(packet);
    if (message) {
      await this.processMessage(message);
    }
  }
}
