import { MqttClient, connect } from "mqtt";
import EventEmitter from "node:events";

import { CHAMBER_LIGHT_WARMUP_MS, ERROR_LOG_COOLDOWN_MS } from "../../constants";
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

  public constructor(config: PrinterConfig) {
    super();

    this.config = config;
    this.topicReport = `device/${config.serial}/report`;
    this.topicRequest = `device/${config.serial}/request`;
    this.brokerAddress = `mqtts://${config.ip}:${config.port}`;

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

  public connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      logger.info({ printer: this.config.name, ip: this.config.ip }, "Connecting to printer...");

      this.mqttClient = connect(this.brokerAddress, {
        username: "bblp",
        password: this.config.accessCode,
        reconnectPeriod: 1,
        rejectUnauthorized: false
      });

      this.mqttClient.on("connect", () => {
        logger.info({ printer: this.config.name }, "Connected to printer");

        this.mqttClient?.subscribe(this.topicReport);
        this.mqttClient?.publish(
          this.topicRequest,
          JSON.stringify({
            pushing: {
              sequence_id: "1",
              command: "pushall"
            },
            user_id: 123_456_789
          })
        );
        resolve();
      });
      this.mqttClient.on("disconnect", packet => {
        logger.debug({ printer: this.config.name, reasonCode: packet.reasonCode }, "Disconnected from printer");
      });
      this.mqttClient.on("message", (receivedTopic: string, payload: Buffer) => {
        if (receivedTopic !== this.topicReport) {
          return;
        }

        this.onMessage(payload.toString()).catch(() => true);
      });
      this.mqttClient.on("error", error => {
        const now = Date.now();
        if (!this.lastMqttErrorLoggedAt || now - this.lastMqttErrorLoggedAt >= ERROR_LOG_COOLDOWN_MS) {
          logger.error(
            { printer: this.config.name, message: error.message },
            "Error connecting to BambuLab MQTT server"
          );
          this.lastMqttErrorLoggedAt = now;
        }
        reject(error);
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

    const screenshot = await takeScreenshot(this.config.ip, this.config.accessCode, this.config.rtcPort);

    if (!wasLightOn) {
      logger.debug({ printer: this.config.name }, "Turning off chamber light after screenshot");
      this.turnOffChamberLight();
    }

    return screenshot;
  }

  public isConnected(): boolean {
    return this.mqttClient?.connected ?? false;
  }

  protected async onMessage(packet: string): Promise<void> {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(packet);
    } catch (error) {
      logger.error({ error, packetLength: packet.length }, "Failed to parse MQTT message");
      return;
    }

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
      this.printerStatus?.onUpdate(data.print);
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
