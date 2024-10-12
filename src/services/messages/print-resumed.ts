import { EmbedBuilder } from "discord.js";

import { NOTIFICATION_COLOR, NOTIFICATION_FOOTER_ICON, NOTIFICATION_FOOTER_TEXT } from "../../constants";
import { uploadScreenshot } from "../../libs/s3-storage";

export const printResumed = async () => {
  return new EmbedBuilder()
    .setTitle("Reprise de l'Impression")
    .setDescription(`L'imprimante a repris l'impression.`)
    .setColor(NOTIFICATION_COLOR)
    .setFooter({
      text: NOTIFICATION_FOOTER_TEXT,
      iconURL: NOTIFICATION_FOOTER_ICON
    })
    .setTimestamp(new Date())
    .setImage(await uploadScreenshot());
};
