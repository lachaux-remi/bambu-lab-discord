import { EmbedBuilder } from "discord.js";

import { NOTIFICATION_COLOR, NOTIFICATION_FOOTER_ICON, NOTIFICATION_FOOTER_TEXT } from "../constants";

/**
 * Crée un EmbedBuilder avec les paramètres de base communs à toutes les notifications
 * (footer, couleur, timestamp)
 *
 * @returns Un EmbedBuilder préconfiguré
 */
export const createBaseEmbed = (): EmbedBuilder => {
  return new EmbedBuilder()
    .setColor(NOTIFICATION_COLOR)
    .setFooter({
      text: NOTIFICATION_FOOTER_TEXT,
      iconURL: NOTIFICATION_FOOTER_ICON
    })
    .setTimestamp(new Date());
};
