import { EmbedBuilder } from "discord.js";

import { NOTIFICATION_COLOR, NOTIFICATION_FOOTER_ICON, NOTIFICATION_FOOTER_TEXT } from "../../constants";
import { getProjectURL, getScreenshotURL } from "../../libs/s3-storage";
import type { Status } from "../../types";

export const printStarted = async (status: Status) => {
  return new EmbedBuilder()
    .setURL(await getProjectURL(status))
    .setTitle("Démarrage de l'impression")
    .setDescription(`L'imprimante ce prépare pour imprimer **${status.taskName}**`)
    .setColor(NOTIFICATION_COLOR)
    .setFooter({
      text: NOTIFICATION_FOOTER_TEXT,
      iconURL: NOTIFICATION_FOOTER_ICON
    })
    .setTimestamp(new Date())
    .setImage(await getScreenshotURL());
};
