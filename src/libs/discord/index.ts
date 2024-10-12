import type { APIMessage, EmbedBuilder } from "discord.js";
import { WebhookClient } from "discord.js";

import { DISCORD_WEBHOOK_NOTIFICATION_ID, DISCORD_WEBHOOK_NOTIFICATION_TOKEN } from "../../constants";

const getNotificationWebhook = (): WebhookClient => {
  return new WebhookClient({
    id: DISCORD_WEBHOOK_NOTIFICATION_ID,
    token: DISCORD_WEBHOOK_NOTIFICATION_TOKEN
  });
};

export const sendWebhookMessage = async (embed: EmbedBuilder): Promise<APIMessage> => {
  return await getNotificationWebhook().send({
    embeds: [embed]
  });
};
