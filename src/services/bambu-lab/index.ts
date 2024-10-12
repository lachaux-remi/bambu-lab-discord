import { MqttClient, connect } from "mqtt";
import EventEmitter from "node:events";

import {
  BAMBULAB_BROKER_ADDRESS,
  BAMBULAB_CLIENT_PASSWORD,
  BAMBULAB_CLIENT_USERNAME,
  BAMBULAB_PRINTER_SERIAL_NUMBER
} from "../../constants";
import { MessageCommand } from "../../enums";
import { getLogger } from "../../libs/logger";
import type { ClientEvents } from "../../types/client-events";
import type { PrintMessage } from "../../types/printer-messages";
import PrinterStatus from "../printer-status";

const logger = getLogger("BambuLab");

export default class extends EventEmitter {
  private mqttClient?: MqttClient;
  private printerStatus?: PrinterStatus;

  private readonly topicReport = `device/${BAMBULAB_PRINTER_SERIAL_NUMBER}/report`;
  private readonly topicRequest = `device/${BAMBULAB_PRINTER_SERIAL_NUMBER}/request`;

  public constructor() {
    super();

    this.printerStatus = new PrinterStatus(this);
  }

  public override on<K extends keyof ClientEvents>(event: K, listener: (...arguments_: ClientEvents[K]) => void): this {
    super.on(event as keyof ClientEvents, listener);
    return this;
  }

  public connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.mqttClient = connect(BAMBULAB_BROKER_ADDRESS, {
        username: BAMBULAB_CLIENT_USERNAME,
        password: BAMBULAB_CLIENT_PASSWORD,
        reconnectPeriod: 1,
        rejectUnauthorized: false
      });

      this.mqttClient.on("connect", () => {
        logger.info("Connected to printer");

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
        logger.debug({ reasonCode: packet.reasonCode }, "Disconnected from printer");
      });
      this.mqttClient.on("message", (receivedTopic: string, payload: Buffer) => {
        if (receivedTopic !== this.topicReport) {
          return;
        }

        this.onMessage(payload.toString()).catch(() => true);
      });
      this.mqttClient.on("error", error => {
        logger.error({ message: error.message }, "Error connecting to BambuLab MQTT server");
        reject(error);
      });
    });
  }

  protected async onMessage(packet: string): Promise<void> {
    const data = JSON.parse(packet);
    const key = Object.keys(data)[0];

    logger.debug({ key, data: data[key] }, "Received message");

    if (this.isPrintMessage(data)) {
      this.printerStatus?.onUpdate(data.print);
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
