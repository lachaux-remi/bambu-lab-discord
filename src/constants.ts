import type { ForumTagDefinition } from "./types/discord";

const parseNumberSetting = (name: string, fallback: number, minimum: number, maximum: number): number => {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim() === "") {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    console.warn(`${name} must be a number between ${minimum} and ${maximum}; using ${fallback}`);
    return fallback;
  }

  return value;
};

export const APP_DEBUG = process.env.DEBUG === "true";

// Use plaintext MQTT only for a local development broker. Production defaults to MQTT over TLS.
export const MQTT_PROTOCOL = process.env.MQTT_PROTOCOL === "mqtt" ? "mqtt" : "mqtts";

// Notification settings
export const NOTIFICATION_PERCENT = parseNumberSetting("NOTIFICATION_PERCENT", 5, 1, 100);
export const NOTIFICATION_FOOTER_TEXT = process.env.NOTIFICATION_FOOTER_TEXT || "Bambu Lab Discord";
export const NOTIFICATION_FOOTER_ICON = process.env.NOTIFICATION_FOOTER_ICON || "";
export const NOTIFICATION_COLOR = (process.env.NOTIFICATION_COLOR || "#24a543") as `#${string}`;

// Minimum interval between MQTT failure summaries (default: 1 minute)
export const ERROR_LOG_COOLDOWN_MS = parseNumberSetting("ERROR_LOG_COOLDOWN_MINUTES", 1, 1, 1440) * 60 * 1000;

// Delay before turning off the chamber light after a print ends (default: 5 minutes)
export const CHAMBER_LIGHT_OFF_DELAY_MS = parseNumberSetting("CHAMBER_LIGHT_OFF_DELAY_MINUTES", 5, 0, 1440) * 60 * 1000;

// Delay after turning on the chamber light before capturing a screenshot (default: 1500ms)
export const CHAMBER_LIGHT_WARMUP_MS = parseNumberSetting("CHAMBER_LIGHT_WARMUP_MS", 1500, 0, 60_000);

// Discord Bot token
export const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";

// Canonical tags we want to ensure exist in the forum channel (name and emoji)
// Printer-specific tags are created dynamically when printers are added
export const FORUM_TAG_DEFINITIONS: ForumTagDefinition[] = [
  { name: "En cours", emoji: "⏳" },
  { name: "Réussi", emoji: "✅" },
  { name: "Échoué", emoji: "❌" },
  { name: "En pause", emoji: "⏸️" },
  { name: "Attention", emoji: "⚠️" },
  { name: "Multicolore", emoji: "🌈" },
  { name: "Monocolor", emoji: "🎨" }
];
