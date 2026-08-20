import { createServer } from "node:net";

import { LightMode, LightNode, MessageCommand, PrintState } from "../enums";
import { getLogger } from "../libs/logger";
import type { PrintMessage } from "../types/printer-messages";

const logger = getLogger("MQTT-MockPrinter");

const host = process.env.MOCK_MQTT_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.MOCK_MQTT_PORT ?? "1883", 10);
const serial = process.env.MOCK_PRINTER_SERIAL ?? "DEV_SERIAL";
const accessCode = process.env.MOCK_PRINTER_ACCESS_CODE ?? "mock-access-code";
const stepDuration = Number.parseInt(process.env.MOCK_MQTT_STEP_MS ?? "750", 10);

const topicReport = `device/${serial}/report`;
const topicRequest = `device/${serial}/request`;

const wait = async (duration: number): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, duration));
};

const scenario: PrintMessage[] = [
  {
    print: {
      command: MessageCommand.PROJECT_FILE,
      model_id: "development-benchy",
      plate_idx: "1",
      subtask_name: "Benchy MQTT simulé",
      use_ams: true,
      ams_mapping: [0, 1]
    }
  },
  {
    print: {
      command: MessageCommand.PUSH_STATUS,
      subtask_name: "Benchy MQTT simulé",
      gcode_state: PrintState.RUNNING,
      layer_num: 1,
      total_layer_num: 100,
      mc_percent: 0,
      mc_remaining_time: 12,
      lights_report: [{ node: LightNode.CHAMBER, mode: LightMode.ON }]
    }
  },
  {
    print: {
      command: MessageCommand.PUSH_STATUS,
      gcode_state: PrintState.RUNNING,
      layer_num: 25,
      mc_percent: 25,
      mc_remaining_time: 9
    }
  },
  {
    print: {
      command: MessageCommand.PUSH_STATUS,
      gcode_state: PrintState.PAUSE,
      layer_num: 30,
      mc_percent: 30,
      mc_remaining_time: 8
    }
  },
  {
    print: {
      command: MessageCommand.PUSH_STATUS,
      gcode_state: PrintState.RUNNING,
      layer_num: 30,
      mc_percent: 30,
      mc_remaining_time: 8
    }
  },
  {
    print: {
      command: MessageCommand.PUSH_STATUS,
      gcode_state: PrintState.RUNNING,
      layer_num: 50,
      mc_percent: 50,
      mc_remaining_time: 6
    }
  },
  {
    print: {
      command: MessageCommand.PUSH_STATUS,
      gcode_state: PrintState.RUNNING,
      layer_num: 75,
      mc_percent: 75,
      mc_remaining_time: 3
    }
  },
  {
    print: {
      command: MessageCommand.PUSH_STATUS,
      gcode_state: PrintState.RUNNING,
      layer_num: 100,
      mc_percent: 100,
      mc_remaining_time: 0
    }
  },
  {
    print: {
      command: MessageCommand.PUSH_STATUS,
      gcode_state: PrintState.FINISH,
      layer_num: 100,
      mc_percent: 100,
      mc_remaining_time: 0
    }
  }
];

const main = async (): Promise<void> => {
  const { Aedes } = await import("aedes");
  const broker = await Aedes.createBroker({
    authenticate: (_client, username, password, done) => {
      done(null, username === "bblp" && password?.toString() === accessCode);
    }
  });
  const server = createServer(broker.handle);
  let scenarioRunning = false;

  const publish = async (message: PrintMessage): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      broker.publish(
        {
          cmd: "publish",
          topic: topicReport,
          payload: Buffer.from(JSON.stringify(message)),
          qos: 0,
          retain: false,
          dup: false
        },
        error => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }
      );
    });
  };

  const runScenario = async (): Promise<void> => {
    if (scenarioRunning) {
      logger.warn("Simulation already running; ignoring duplicate pushall request");
      return;
    }

    scenarioRunning = true;
    logger.info({ messages: scenario.length }, "Starting simulated print");

    try {
      for (const [index, message] of scenario.entries()) {
        if (index > 0) {
          await wait(stepDuration);
        }
        await publish(message);
        logger.info(
          { step: index + 1, command: message.print.command, state: message.print.gcode_state },
          "Published simulated printer message"
        );
      }
      logger.info("Simulated print finished; send another pushall request to replay it");
    } finally {
      scenarioRunning = false;
    }
  };

  broker.on("clientReady", client => {
    logger.info({ clientId: client.id }, "MQTT client connected");
  });

  broker.on("publish", (packet, client) => {
    if (!client || packet.topic !== topicRequest) {
      return;
    }

    try {
      const request = JSON.parse(packet.payload.toString()) as { pushing?: { command?: string } };
      if (request.pushing?.command === "pushall") {
        void runScenario();
      }
    } catch (error) {
      logger.warn({ error }, "Ignoring invalid request payload");
    }
  });

  server.listen(port, host, () => {
    logger.info(
      { address: `mqtt://${host}:${port}`, serial, topicRequest, topicReport },
      "Mock Bambu Lab MQTT printer ready"
    );
  });

  const shutdown = (): void => {
    server.close(() => broker.close(() => process.exit(0)));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

main().catch(error => {
  logger.error({ error }, "Failed to start mock MQTT printer");
  process.exitCode = 1;
});
