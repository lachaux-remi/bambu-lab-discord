import type { APIMessage, EmbedBuilder } from "discord.js";
import { WebhookClient } from "discord.js";

import { DISCORD_WEBHOOK_NOTIFICATION_ID, DISCORD_WEBHOOK_NOTIFICATION_TOKEN } from "../../constants";
import { getLogger } from "../logger";

const logger = getLogger("Discord");

const getNotificationWebhook = (): WebhookClient => {
  return new WebhookClient({
    id: DISCORD_WEBHOOK_NOTIFICATION_ID,
    token: DISCORD_WEBHOOK_NOTIFICATION_TOKEN
  });
};

export const sendWebhookMessage = async (embed: EmbedBuilder): Promise<APIMessage | null> => {
  return await getNotificationWebhook()
    .send({
      embeds: [embed]
    })
    .catch(error => {
      logger.error({ error }, "Failed to send webhook message");
      return null;
    });
};
