import type { ForumTagDefinition } from "./types/discord";

export const APP_DEBUG = process.env.DEBUG === "true";

// S3 Storage configuration
export const S3_ENDPOINT = process.env.AWS_ENDPOINT!;
export const S3_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID!;
export const S3_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY!;
export const S3_REGION = process.env.AWS_REGION || "eu-west-3";
export const S3_SIGNATURE_VERSION = process.env.AWS_SIGNATURE_VERSION || "v4";
export const S3_BUCKET = process.env.AWS_BUCKET || "bambu-lab-p1s";

// Notification settings
export const NOTIFICATION_PERCENT = parseInt(process.env.NOTIFICATION_PERCENT || "5", 10);
export const NOTIFICATION_FOOTER_TEXT = process.env.NOTIFICATION_FOOTER_TEXT || "Bambu Lab Discord";
export const MAX_UPLOAD_RETRIES = 5;
export const NOTIFICATION_FOOTER_ICON =
  process.env.NOTIFICATION_FOOTER_ICON || `${S3_ENDPOINT}/${S3_BUCKET}/webhook.png`;
export const NOTIFICATION_COLOR = (process.env.NOTIFICATION_COLOR || "#24a543") as `#${string}`;

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
