import { EmbedBuilder } from "discord.js";

import { NOTIFICATION_COLOR, NOTIFICATION_FOOTER_ICON, NOTIFICATION_FOOTER_TEXT } from "../../constants";
import { getScreenshotURL } from "../../libs/s3-storage";
import type { Status } from "../../types/printer-status";

export const printFailed = async (status: Status) => {
  return new EmbedBuilder()
    .setTitle("Impression échouée")
    .setDescription(`L'imprimante a échoué à imprimer **${status.taskName}**.`)
    .setColor(NOTIFICATION_COLOR)
    .setFooter({
      text: NOTIFICATION_FOOTER_TEXT,
      iconURL: NOTIFICATION_FOOTER_ICON
    })
    .setTimestamp(new Date())
    .setImage(await getScreenshotURL());
};
