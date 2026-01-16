/**
 * Script de débogage pour capturer les messages MQTT bruts de l'imprimante.
 * Utilisez ce script pour diagnostiquer les problèmes avec les événements MQTT.
 *
 * Usage: pnpm run debug:mqtt
 *
 * Requires environment variables:
 * - PRINTER_ADDRESS: IP address of the printer
 * - PRINTER_ACCESS_CODE: Access code of the printer
 * - PRINTER_SERIAL_NUMBER: Serial number of the printer
 * - PRINTER_PORT (optional): MQTT port (default: 8883)
 */
import { appendFileSync, writeFileSync } from "fs";
import { connect } from "mqtt";
import { join } from "path";

import { getLogger } from "../libs/logger";

const logger = getLogger("MQTT-Debug");

// Configuration from environment variables
const PRINTER_IP = process.env.PRINTER_ADDRESS!;
const PRINTER_PORT = process.env.PRINTER_PORT || "8883";
const PRINTER_ACCESS_CODE = process.env.PRINTER_ACCESS_CODE!;
const PRINTER_SERIAL = process.env.PRINTER_SERIAL_NUMBER!;
const BROKER_ADDRESS = `mqtts://${PRINTER_IP}:${PRINTER_PORT}`;

if (!PRINTER_IP || !PRINTER_ACCESS_CODE || !PRINTER_SERIAL) {
  logger.error("Missing required environment variables: PRINTER_ADDRESS, PRINTER_ACCESS_CODE, PRINTER_SERIAL_NUMBER");
  process.exit(1);
}

// Créer un fichier de log avec timestamp
const logFileName = join(process.cwd(), `mqtt-debug-${Date.now()}.log`);
logger.info(`Logging to file: ${logFileName}`);

// Initialiser le fichier
writeFileSync(logFileName, `MQTT Debug Log - Started at ${new Date().toISOString()}\n${"=".repeat(100)}\n\n`);

// Helper pour logger à la fois dans console et fichier
const logToFile = (message: string) => {
  appendFileSync(logFileName, `${message}\n`);
};

const topicReport = `device/${PRINTER_SERIAL}/report`;
const topicRequest = `device/${PRINTER_SERIAL}/request`;

logger.info(`Connecting to ${BROKER_ADDRESS}`);
logger.info(`Serial: ${PRINTER_SERIAL}`);

const client = connect(BROKER_ADDRESS, {
  username: "bblp",
  password: PRINTER_ACCESS_CODE,
  reconnectPeriod: 1,
  rejectUnauthorized: false
});

client.on("connect", () => {
  logger.info("✓ Connected to printer");
  logToFile(`\n[${new Date().toISOString()}] ✓ Connected to printer`);

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
  logToFile(`[${new Date().toISOString()}] Listening for messages...\n`);
  logger.info("─".repeat(80));
});

client.on("message", (topic: string, payload: Buffer) => {
  if (topic !== topicReport) {
    return;
  }

  try {
    const data = JSON.parse(payload.toString());
    const key = Object.keys(data)[0];
    const timestamp = new Date().toISOString();

    // Log complet du message brut dans le fichier
    logToFile(`\n${"=".repeat(100)}`);
    logToFile(`[${timestamp}] 📨 Message received - Key: ${key}`);
    logToFile(`${"=".repeat(100)}`);
    logToFile(JSON.stringify(data, null, 2));

    // Log complet du message brut dans la console
    logger.info(`\n${"=".repeat(80)}`);
    logger.info(`📨 Message received - Key: ${key}`);
    logger.info(`${"=".repeat(80)}`);
    logger.info(JSON.stringify(data, null, 2));
    logger.info(`${"─".repeat(80)}\n`);

    // Si c'est un message print, afficher des détails supplémentaires
    if (data.print) {
      const details = [
        `📋 Print message details:`,
        `   Command: ${data.print.command}`,
        `   State: ${data.print.gcode_state || "N/A"}`,
        `   Progress: ${data.print.mc_percent || "N/A"}%`,
        `   Layer: ${data.print.layer_num || "N/A"}/${data.print.total_layer_num || "N/A"}`,
        `   Project: ${data.print.subtask_name || "N/A"}`,
        `   Remaining: ${data.print.mc_remaining_time || "N/A"}min`,
        `   AMS Status: ${data.print.ams_status || "N/A"}`,
        `   AMS Exist: ${data.print.ams_exist_bits || "N/A"}`,
        `   Tray Now: ${data.print.tray_now || "N/A"}`,
        `   Tray Target: ${data.print.tray_tar || "N/A"}`
      ];

      // Détecter multicolore si c'est un project_file
      if (data.print.command === "project_file" && data.print.ams_mapping) {
        const amsMapping = data.print.ams_mapping;
        const usedFilaments = amsMapping.filter((slot: number) => slot >= 0);
        const isMulticolor = usedFilaments.length > 1;
        const colorMode = isMulticolor ? "🌈 MULTICOLORE" : "🎨 MONOCOLOR";

        details.push(`   Use AMS: ${data.print.use_ams || "N/A"}`);
        details.push(`   AMS Mapping: [${amsMapping.join(", ")}]`);
        details.push(`   Filaments Used: ${usedFilaments.length}`);
        details.push(`   Color Mode: ${colorMode}`);
      }

      details.push(`${"─".repeat(80)}\n`);

      details.forEach(line => {
        logger.info(line);
        logToFile(line);
      });
    }
  } catch (error) {
    const errorMsg = `Failed to parse message: ${error}`;
    const rawMsg = `Raw payload: ${payload.toString()}`;
    logger.error(errorMsg);
    logger.info(rawMsg);
    logToFile(`\n[ERROR] ${errorMsg}`);
    logToFile(rawMsg);
  }
});

client.on("error", error => {
  const errorMsg = `❌ Error: ${error.message}`;
  logger.error(errorMsg);
  logToFile(`\n[${new Date().toISOString()}] ${errorMsg}`);
});

client.on("disconnect", () => {
  const msg = "Disconnected from printer";
  logger.info(msg);
  logToFile(`\n[${new Date().toISOString()}] ${msg}`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  logger.info("\nShutting down...");
  logToFile(`\n[${new Date().toISOString()}] Shutting down...`);
  client.end();
  process.exit(0);
});
