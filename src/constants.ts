import type { ForumTagDefinition } from "./types/discord";

export const APP_DEBUG = process.env.DEBUG === "true";

// Notification settings
export const NOTIFICATION_PERCENT = parseInt(process.env.NOTIFICATION_PERCENT || "5", 10);
export const NOTIFICATION_FOOTER_TEXT = process.env.NOTIFICATION_FOOTER_TEXT || "Bambu Lab Discord";
export const NOTIFICATION_FOOTER_ICON = process.env.NOTIFICATION_FOOTER_ICON || "";
export const NOTIFICATION_COLOR = (process.env.NOTIFICATION_COLOR || "#24a543") as `#${string}`;

// MQTT error log cooldown in minutes (default: 5 minutes)
export const ERROR_LOG_COOLDOWN_MS = parseInt(process.env.ERROR_LOG_COOLDOWN_MINUTES || "5", 10) * 60 * 1000;

// Delay before turning off the chamber light after a print ends (default: 5 minutes)
export const CHAMBER_LIGHT_OFF_DELAY_MS = parseInt(process.env.CHAMBER_LIGHT_OFF_DELAY_MINUTES || "5", 10) * 60 * 1000;

// Delay after turning on the chamber light before capturing a screenshot (default: 1500ms)
export const CHAMBER_LIGHT_WARMUP_MS = parseInt(process.env.CHAMBER_LIGHT_WARMUP_MS || "1500", 10);

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
