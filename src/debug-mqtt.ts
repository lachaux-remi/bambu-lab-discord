/**
 * Script de débogage pour capturer les messages MQTT bruts de l'imprimante.
 * Utilisez ce script pour diagnostiquer les problèmes avec les événements MQTT.
 *
 * Usage: pnpm run debug:mqtt
 */
import { connect } from "mqtt";

import {
  BAMBULAB_BROKER_ADDRESS,
  BAMBULAB_CLIENT_PASSWORD,
  BAMBULAB_CLIENT_USERNAME,
  BAMBULAB_PRINTER_SERIAL_NUMBER
} from "./constants";
import { getLogger } from "./libs/logger";

const logger = getLogger("MQTT-Debug");

const topicReport = `device/${BAMBULAB_PRINTER_SERIAL_NUMBER}/report`;
const topicRequest = `device/${BAMBULAB_PRINTER_SERIAL_NUMBER}/request`;

logger.info(`Connecting to ${BAMBULAB_BROKER_ADDRESS}`);
logger.info(`Serial: ${BAMBULAB_PRINTER_SERIAL_NUMBER}`);

const client = connect(BAMBULAB_BROKER_ADDRESS, {
  username: BAMBULAB_CLIENT_USERNAME,
  password: BAMBULAB_CLIENT_PASSWORD,
  reconnectPeriod: 1,
  rejectUnauthorized: false
});

client.on("connect", () => {
  logger.info("✓ Connected to printer");
  client.subscribe(topicReport);

  // Demander tous les statuts
  client.publish(
    topicRequest,
    JSON.stringify({
      pushing: {
        sequence_id: "1",
        command: "pushall"
      },
      user_id: 123_456_789
    })
  );

  logger.info("Listening for messages... (Press Ctrl+C to stop)");
  logger.info("─".repeat(80));
});

client.on("message", (topic: string, payload: Buffer) => {
  if (topic !== topicReport) {
    return;
  }

  try {
    const data = JSON.parse(payload.toString());
    const key = Object.keys(data)[0];

    // Log complet du message brut
    logger.info(`\n${"=".repeat(80)}`);
    logger.info(`📨 Message received - Key: ${key}`);
    logger.info(`${"=".repeat(80)}`);
    console.log(JSON.stringify(data, null, 2));
    logger.info(`${"─".repeat(80)}\n`);

    // Si c'est un message print, afficher des détails supplémentaires
    if (data.print) {
      logger.info(`📋 Print message details:`);
      logger.info(`   Command: ${data.print.command}`);
      logger.info(`   State: ${data.print.gcode_state || "N/A"}`);
      logger.info(`   Progress: ${data.print.mc_percent || "N/A"}%`);
      logger.info(`   Layer: ${data.print.layer_num || "N/A"}/${data.print.total_layer_num || "N/A"}`);
      logger.info(`   Project: ${data.print.subtask_name || "N/A"}`);
      logger.info(`   Remaining: ${data.print.mc_remaining_time || "N/A"}min`);
      logger.info(`${"─".repeat(80)}\n`);
    }
  } catch (error) {
    logger.error(`Failed to parse message: ${error}`);
    logger.info(`Raw payload: ${payload.toString()}`);
  }
});

client.on("error", error => {
  logger.error(`❌ Error: ${error.message}`);
});

client.on("disconnect", () => {
  logger.info("Disconnected from printer");
});

// Graceful shutdown
process.on("SIGINT", () => {
  logger.info("\nShutting down...");
  client.end();
  process.exit(0);
});
