import { MqttClient, connect } from "mqtt";
import EventEmitter from "node:events";

import { CHAMBER_LIGHT_WARMUP_MS, ERROR_LOG_COOLDOWN_MS, MQTT_PROTOCOL } from "../../constants";
import { MessageCommand } from "../../enums";
import { getLogger } from "../../libs/logger";
import { takeScreenshot } from "../../libs/rtc";
import type { ClientEvents } from "../../types/client-events";
import type { PrinterConfig } from "../../types/printer-config";
import type { PrintMessage } from "../../types/printer-messages";
import PrinterStatus from "../printer-status";

const logger = getLogger("BambuLab");

export default class BambuLabClient extends EventEmitter {
  private mqttClient?: MqttClient;
  private printerStatus?: PrinterStatus;
  private readonly config: PrinterConfig;

  private readonly topicReport: string;
  private readonly topicRequest: string;
  private readonly brokerAddress: string;

  private lastMqttErrorLoggedAt?: number;
  private chamberLightOn: boolean = false;
  private messageQueue: Promise<void> = Promise.resolve();

  public constructor(config: PrinterConfig) {
    super();

    this.config = config;
    this.topicReport = `device/${config.serial}/report`;
    this.topicRequest = `device/${config.serial}/request`;
    this.brokerAddress = `${MQTT_PROTOCOL}://${config.ip}:${config.port}`;

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

  public connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      logger.info({ printer: this.config.name, ip: this.config.ip }, "Connecting to printer...");

      const mqttClient = connect(this.brokerAddress, {
        username: "bblp",
        password: this.config.accessCode,
        reconnectPeriod: 5000,
        rejectUnauthorized: false
      });
      this.mqttClient = mqttClient;
      let initialConnectionSettled = false;

      const failInitialConnection = (error: Error): void => {
        if (initialConnectionSettled) {
          logger.error({ printer: this.config.name, message: error.message }, "Failed to initialize MQTT session");
          mqttClient.reconnect();
          return;
        }

        initialConnectionSettled = true;
        mqttClient.end(true);
        if (this.mqttClient === mqttClient) {
          this.mqttClient = undefined;
        }
        reject(error);
      };

      mqttClient.on("connect", () => {
        logger.info({ printer: this.config.name }, "Connected to printer");

        mqttClient.subscribe(this.topicReport, error => {
          if (error) {
            failInitialConnection(error);
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
                failInitialConnection(publishError);
                return;
              }

              if (!initialConnectionSettled) {
                initialConnectionSettled = true;
                resolve();
              }
            }
          );
        });
      });
      mqttClient.on("disconnect", packet => {
        logger.debug({ printer: this.config.name, reasonCode: packet.reasonCode }, "Disconnected from printer");
      });
      mqttClient.on("message", (receivedTopic: string, payload: Buffer) => {
        if (receivedTopic !== this.topicReport) {
          return;
        }

        const packet = payload.toString();
        this.messageQueue = this.messageQueue
          .then(() => this.onMessage(packet))
          .catch(error => {
            logger.error({ printer: this.config.name, error }, "Failed to process MQTT message");
          });
      });
      mqttClient.on("error", error => {
        const now = Date.now();
        if (!this.lastMqttErrorLoggedAt || now - this.lastMqttErrorLoggedAt >= ERROR_LOG_COOLDOWN_MS) {
          logger.error(
            { printer: this.config.name, message: error.message },
            "Error connecting to BambuLab MQTT server"
          );
          this.lastMqttErrorLoggedAt = now;
        }
        if (!initialConnectionSettled) {
          failInitialConnection(error);
        }
      });
    });
  }

  public disconnect(): void {
    if (this.mqttClient) {
      logger.info({ printer: this.config.name }, "Disconnecting from printer");
      this.mqttClient.end();
      this.mqttClient = undefined;
    }
  }

  /**
   * Turn off the chamber light
   */
  public turnOffChamberLight(): void {
    if (!this.mqttClient?.connected) {
      logger.warn({ printer: this.config.name }, "Cannot turn off chamber light: not connected");
      return;
    }

    logger.info({ printer: this.config.name }, "Turning off chamber light");
    this.mqttClient.publish(
      this.topicRequest,
      JSON.stringify({
        system: {
          sequence_id: "0",
          command: "ledctrl",
          led_node: "chamber_light",
          led_mode: "off",
          led_on_time: 500,
          led_off_time: 500,
          loop_times: 1,
          interval_time: 1000
        }
      })
    );
  }

  /**
   * Turn on the chamber light
   */
  public turnOnChamberLight(): void {
    if (!this.mqttClient?.connected) {
      logger.warn({ printer: this.config.name }, "Cannot turn on chamber light: not connected");
      return;
    }

    logger.info({ printer: this.config.name }, "Turning on chamber light");
    this.mqttClient.publish(
      this.topicRequest,
      JSON.stringify({
        system: {
          sequence_id: "0",
          command: "ledctrl",
          led_node: "chamber_light",
          led_mode: "on",
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
  public async takeScreenshotWithLight(): Promise<Buffer | null> {
    const wasLightOn = this.chamberLightOn;

    if (!wasLightOn) {
      logger.debug({ printer: this.config.name }, "Chamber light was off, turning on for screenshot");
      this.turnOnChamberLight();
      await new Promise(resolve => setTimeout(resolve, CHAMBER_LIGHT_WARMUP_MS));
    }

    try {
      return await takeScreenshot(this.config.ip, this.config.accessCode, this.config.rtcPort);
    } finally {
      if (!wasLightOn) {
        logger.debug({ printer: this.config.name }, "Turning off chamber light after screenshot");
        this.turnOffChamberLight();
      }
    }
  }

  public isConnected(): boolean {
    return this.mqttClient?.connected ?? false;
  }

  protected async onMessage(packet: string): Promise<void> {
    let parsedData: unknown;
    try {
      parsedData = JSON.parse(packet);
    } catch (error) {
      logger.error({ error, packetLength: packet.length }, "Failed to parse MQTT message");
      return;
    }

    if (!parsedData || typeof parsedData !== "object" || Array.isArray(parsedData)) {
      logger.warn({ packetLength: packet.length }, "MQTT message must contain a JSON object");
      return;
    }

    const data = parsedData as Record<string, unknown>;

    const key = Object.keys(data)[0];

    logger.debug({ key, data: data[key] }, "Received message");

    // Track chamber light state from lights_report
    const printData = data.print as Record<string, unknown> | undefined;
    if (Array.isArray(printData?.lights_report)) {
      const lightsReport = printData.lights_report as Array<{ node: string; mode: string }>;
      const chamberLight = lightsReport.find(l => l.node === "chamber_light");
      if (chamberLight) {
        this.chamberLightOn = chamberLight.mode === "on";
        logger.debug({ printer: this.config.name, chamberLightOn: this.chamberLightOn }, "Chamber light state updated");
      }
    }

    if (this.isPrintMessage(data)) {
      logger.debug({ command: data.print.command }, "Processing print message");
      await this.printerStatus?.onUpdate(data.print);
    } else {
      logger.debug({ keys: Object.keys(data), hasprint: !!data.print }, "Message not recognized as print message");
    }
  }

  protected isPrintMessage(data: Partial<PrintMessage>): data is PrintMessage {
    return (
      !!data?.print &&
      !!data?.print?.command &&
      [MessageCommand.PUSH_STATUS, MessageCommand.PROJECT_FILE].includes(data.print.command)
    );
  }
}
