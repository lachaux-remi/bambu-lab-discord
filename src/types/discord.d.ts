export interface ForumTagDefinition {
  name: string;
  emoji: string;
}

/** Payload for Discord forum tag API */
export interface ForumTagPayload {
  id?: string;
  name: string;
  moderated?: boolean;
  emoji?: {
    id: string | null;
    name: string | null;
  };
}

/** File attachment for Discord messages */
export interface DiscordFileAttachment {
  name: string;
  buffer?: Buffer;
  url?: string;
}
