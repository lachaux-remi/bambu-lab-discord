import { EmbedBuilder } from "discord.js";

import { NOTIFICATION_COLOR, NOTIFICATION_FOOTER_ICON, NOTIFICATION_FOOTER_TEXT } from "../../constants";
import type { Status } from "../../types/printer-status";

export const printStarted = async (status: Status) => {
  return new EmbedBuilder()
    .setTitle("Démarrage de l'impression")
    .setDescription(`L'imprimante ce prépare pour imprimer **${status.taskName}**`)
    .setColor(NOTIFICATION_COLOR)
    .setFooter({
      text: NOTIFICATION_FOOTER_TEXT,
      iconURL: NOTIFICATION_FOOTER_ICON
    })
    .setTimestamp(new Date())
    .setImage(status.projectImageUrl);
};
