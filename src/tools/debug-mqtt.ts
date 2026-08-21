/**
 * Capture MQTT messages as sanitized NDJSON suitable for sharing.
 *
 * Usage: pnpm run debug:mqtt
 *
 * Requires PRINTER_ADDRESS, PRINTER_ACCESS_CODE and PRINTER_SERIAL_NUMBER.
 * PRINTER_PORT is optional and defaults to 8883.
 */
import { connect } from "mqtt";
import type { MqttClient } from "mqtt";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";

import { BAMBU_USERNAME } from "../constants";
import { CommandResult, LightMode, LightNode, MessageCommand, PrintState } from "../enums";
import { getBambuTlsOptions } from "../libs/bambu-tls";
import { getLogger } from "../libs/logger";

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type Sanitizer = (value: unknown) => JsonValue;

interface ValidCaptureRecord {
  timestamp: string;
  key: string;
  payload: JsonValue;
}

interface InvalidCaptureRecord {
  timestamp: string;
  key: "invalid_json";
  error: {
    byteLength: number;
    sha256: string;
  };
}

export type CaptureRecord = InvalidCaptureRecord | ValidCaptureRecord;

const REDACTED = "[REDACTED]";
const REDACTED_URL = "[REDACTED_URL]";
const CREDENTIAL_KEY =
  /(^auth$|^ttcodeenc$|accesscode|password|passwd|authorization|token|apikey|secret|credential|encryptionkey|cryptkey|privatekey|clientkey|signature)/;
const IDENTITY_KEY = /(^id$|(id|uuid)$)/;
const PROJECT_NAME_KEY =
  /(^file$|^path$|(subtask|project|job).*(name|path|file)|gcode(file|path|name)|filename|filepath)/;
const SERIAL_KEY = /(^sn$|serial)/;
const AMS_SERIAL_KEY = /^amsid$/;
const FINGERPRINT_KEY = /^md5$/;
const IP_KEY = /(^ip$|ipaddress$|ipv[46]$|hostname$|hostaddress$)/;
const URL = /[a-z][a-z\d+.-]*:\/\//i;
const SIGNED_URL_FRAGMENT = /(x-amz-(credential|signature)|[?&](signature|credential|token)=)/i;

const normalizeKey = (key: string): string => key.replaceAll(/[^a-z\d]/gi, "").toLowerCase();
const ALLOWED_STRING_VALUES = new Map<string, ReadonlySet<string>>([
  ["command", new Set<string>(Object.values(MessageCommand))],
  ["gcodestate", new Set<string>(Object.values(PrintState))],
  ["result", new Set<string>(Object.values(CommandResult))],
  ["node", new Set<string>(Object.values(LightNode))],
  ["mode", new Set<string>(Object.values(LightMode))]
]);

const pseudonym = (salt: string, kind: string, value: unknown): string => {
  const digest = createHash("sha256")
    .update(salt)
    .update("\0")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 12);
  return `[${kind}_${digest}]`;
};

/** Creates a non-mutating recursive sanitizer with stable pseudonyms for one capture. */
export const createCaptureSanitizer = (salt = randomBytes(32).toString("hex")): Sanitizer => {
  const sanitize = (value: unknown, sourceKey = ""): JsonValue => {
    const key = normalizeKey(sourceKey);

    if (CREDENTIAL_KEY.test(key)) {
      return REDACTED;
    }
    if (typeof value === "string") {
      if (AMS_SERIAL_KEY.test(key) || SERIAL_KEY.test(key)) {
        return pseudonym(salt, "SERIAL", value);
      }
      if (IDENTITY_KEY.test(key)) {
        return pseudonym(salt, "ID", value);
      }
      if (FINGERPRINT_KEY.test(key)) {
        return pseudonym(salt, "HASH", value);
      }
      if (IP_KEY.test(key)) {
        return pseudonym(salt, "IP", value);
      }
      if (PROJECT_NAME_KEY.test(key)) {
        return pseudonym(salt, "PROJECT", value);
      }
      if (ALLOWED_STRING_VALUES.get(key)?.has(value) === true) {
        return value;
      }
      if (URL.test(value) || SIGNED_URL_FRAGMENT.test(value)) {
        return REDACTED_URL;
      }
      if (isIP(value) !== 0) {
        return pseudonym(salt, "IP", value);
      }
      return pseudonym(salt, "STRING", value);
    }
    if (value === null || typeof value === "boolean" || typeof value === "number") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(item => sanitize(item, sourceKey));
    }
    if (typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([childKey, child]) => [childKey, sanitize(child, childKey)])
      );
    }
    return REDACTED;
  };

  return value => sanitize(value);
};

export const createCaptureRecord = (
  payload: Buffer,
  timestamp = new Date().toISOString(),
  sanitize = createCaptureSanitizer()
): CaptureRecord => {
  try {
    const parsed: unknown = JSON.parse(payload.toString("utf8"));
    const key =
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed)[0] : undefined;
    return { timestamp, key: key ?? "value", payload: sanitize(parsed) };
  } catch {
    return {
      timestamp,
      key: "invalid_json",
      error: {
        byteLength: payload.byteLength,
        sha256: createHash("sha256").update(payload).digest("hex")
      }
    };
  }
};

export const formatCaptureRecord = (record: CaptureRecord): string => `${JSON.stringify(record)}\n`;

export const createCaptureOutput = (path: string): WriteStream => createWriteStream(path, { flags: "wx", mode: 0o600 });

const display = (value: JsonValue | undefined): string => String(value ?? "N/A");

export const formatConsoleSummary = (record: CaptureRecord, previousState?: string): string => {
  if ("error" in record) {
    return `[${record.timestamp}] invalid JSON bytes=${record.error.byteLength} sha256=${record.error.sha256}`;
  }

  const root = record.payload;
  const print =
    root !== null && !Array.isArray(root) && typeof root === "object" && "print" in root ? root.print : undefined;
  if (print === null || Array.isArray(print) || typeof print !== "object") {
    return `[${record.timestamp}] key=${record.key}`;
  }

  const currentState = typeof print.gcode_state === "string" ? print.gcode_state : undefined;
  const state =
    previousState && currentState && previousState !== currentState ? `${previousState}→${currentState}` : currentState;
  const details = [
    `command=${display(print.command)}`,
    `state=${display(state)}`,
    `progress=${display(print.mc_percent)}%`,
    `layer=${display(print.layer_num)}/${display(print.total_layer_num)}`,
    `remaining=${display(print.mc_remaining_time)}min`
  ];
  if (print.subtask_name !== undefined) {
    details.push(`project=${display(print.subtask_name)}`);
  }
  if (Array.isArray(print.ams_mapping)) {
    details.push(`ams=[${print.ams_mapping.map(display).join(",")}]`);
  }
  return `[${record.timestamp}] print ${details.join(" ")}`;
};

const closeStream = (stream: WriteStream): Promise<void> =>
  new Promise((resolve, reject) => {
    stream.once("error", reject);
    stream.end(resolve);
  });

const closeClient = (client: MqttClient): Promise<void> =>
  new Promise((resolve, reject) => {
    client.end(false, {}, error => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

export const runMqttCapture = async (): Promise<void> => {
  const logger = getLogger("MQTT-Debug");
  const printerIp = process.env.PRINTER_ADDRESS;
  const printerPort = process.env.PRINTER_PORT || "8883";
  const accessCode = process.env.PRINTER_ACCESS_CODE;
  const printerSerial = process.env.PRINTER_SERIAL_NUMBER;

  if (!printerIp || !accessCode || !printerSerial) {
    logger.error("Missing required environment variables: PRINTER_ADDRESS, PRINTER_ACCESS_CODE, PRINTER_SERIAL_NUMBER");
    process.exitCode = 1;
    return;
  }

  const outputPath = join(process.cwd(), `mqtt-debug-${Date.now()}.ndjson`);
  const output = createCaptureOutput(outputPath);
  const sanitize = createCaptureSanitizer();
  const topicReport = `device/${printerSerial}/report`;
  const topicRequest = `device/${printerSerial}/request`;
  const client = connect(`mqtts://${printerIp}:${printerPort}`, {
    username: BAMBU_USERNAME,
    password: accessCode,
    reconnectPeriod: 5_000,
    ...getBambuTlsOptions(printerSerial)
  });
  let shutdownPromise: Promise<void> | undefined;
  let previousPrintState: string | undefined;

  logger.info({ outputPath }, "Writing sanitized MQTT capture (NDJSON)");
  logger.info("Connecting to configured printer");

  client.on("connect", () => {
    logger.info("Connected; listening for MQTT messages (press Ctrl+C to stop)");
    client.subscribe(topicReport);
    client.publish(topicRequest, JSON.stringify({ pushing: { sequence_id: "1", command: "pushall" } }));
  });

  client.on("message", (topic: string, payload: Buffer) => {
    if (topic !== topicReport) {
      return;
    }
    const record = createCaptureRecord(payload, new Date().toISOString(), sanitize);
    output.write(formatCaptureRecord(record));
    logger.info(formatConsoleSummary(record, previousPrintState));
    if ("payload" in record) {
      const root = record.payload;
      const print =
        root !== null && !Array.isArray(root) && typeof root === "object" && "print" in root ? root.print : undefined;
      if (
        print !== null &&
        !Array.isArray(print) &&
        typeof print === "object" &&
        typeof print.gcode_state === "string"
      ) {
        previousPrintState = print.gcode_state;
      }
    }
  });

  client.on("error", () => {
    logger.error("MQTT connection error; retrying in 5 seconds");
  });

  client.on("disconnect", () => {
    logger.info("Disconnected from configured printer");
  });

  const shutdown = (signal: NodeJS.Signals): Promise<void> => {
    shutdownPromise ??= (async () => {
      logger.info({ signal }, "Stopping MQTT capture...");
      await closeClient(client);
      await closeStream(output);
      logger.info({ outputPath }, "MQTT capture stopped");
    })();
    return shutdownPromise;
  };

  const handleSignal = (signal: NodeJS.Signals): void => {
    void shutdown(signal).catch(() => {
      logger.error("Failed to stop MQTT capture cleanly");
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
};

if (require.main === module) {
  void runMqttCapture().catch(() => {
    const logger = getLogger("MQTT-Debug");
    logger.error("Failed to run MQTT capture");
    process.exitCode = 1;
  });
}
