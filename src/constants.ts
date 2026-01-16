import type { ForumTagDefinition } from "./types/discord";

export const APP_DEBUG = process.env.DEBUG === "true";

export const BAMBULAB_CLIENT_USERNAME = process.env.PRINTER_USERNAME || "bblp";
export const BAMBULAB_CLIENT_PASSWORD = process.env.PRINTER_ACCESS_CODE!;
export const BAMBULAB_HOST = process.env.PRINTER_ADDRESS!;
export const BAMBULAB_BROKER_PORT = process.env.PRINTER_PORT || 8883;
export const BAMBULAB_BROKER_ADDRESS = `mqtts://${BAMBULAB_HOST}:${BAMBULAB_BROKER_PORT}`;
export const BAMBULAB_PRINTER_SERIAL_NUMBER = process.env.PRINTER_SERIAL_NUMBER!;

export const DISCORD_WEBHOOK_NOTIFICATION_ID = process.env.DISCORD_WEBHOOK_NOTIFICATION_ID!;
export const DISCORD_WEBHOOK_NOTIFICATION_TOKEN = process.env.DISCORD_WEBHOOK_NOTIFICATION_TOKEN!;
export const RTC_URL = process.env.RTC_URL!;

export const S3_ENDPOINT = process.env.AWS_ENDPOINT!;
export const S3_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID!;
export const S3_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY!;
export const S3_REGION = process.env.AWS_REGION || "eu-west-3";
export const S3_SIGNATURE_VERSION = process.env.AWS_SIGNATURE_VERSION || "v4";
export const S3_BUCKET = process.env.AWS_BUCKET || "bambu-lab-p1s";

export const NOTIFICATION_PERCENT = parseInt(process.env.NOTIFICATION_PERCENT || "5", 10);
export const NOTIFICATION_FOOTER_TEXT = process.env.NOTIFICATION_FOOTER_TEXT || "Bambu Lab Discord";

// Maximum number of retry attempts for uploads
export const MAX_UPLOAD_RETRIES = 5;
export const NOTIFICATION_FOOTER_ICON =
  process.env.NOTIFICATION_FOOTER_ICON || `${S3_ENDPOINT}/${S3_BUCKET}/webhook.png`;
export const NOTIFICATION_COLOR = (process.env.NOTIFICATION_COLOR || "#24a543") as `#${string}`;

// Discord Bot settings for thread-per-print feature
export const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || "";
export const DISCORD_PARENT_CHANNEL_ID = process.env.DISCORD_PARENT_CHANNEL_ID || "";

// Canonical tags we want to ensure exist in the forum channel (name and emoji)
export const FORUM_TAG_DEFINITIONS: ForumTagDefinition[] = [
  { name: "En cours", emoji: "⏳" },
  { name: "Réussi", emoji: "✅" },
  { name: "Échoué", emoji: "❌" },
  { name: "En pause", emoji: "⏸️" },
  { name: "Attention", emoji: "⚠️" },
  { name: "Multicolore", emoji: "🌈" },
  { name: "Monocolor", emoji: "🎨" }
];
