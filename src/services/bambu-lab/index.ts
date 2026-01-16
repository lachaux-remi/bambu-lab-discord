import { MqttClient, connect } from "mqtt";
import EventEmitter from "node:events";

import { MessageCommand } from "../../enums";
import { getLogger } from "../../libs/logger";
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
        logger.error({ printer: this.config.name, message: error.message }, "Error connecting to BambuLab MQTT server");
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
