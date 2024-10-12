import { EmbedBuilder } from "discord.js";

import { NOTIFICATION_COLOR, NOTIFICATION_FOOTER_ICON, NOTIFICATION_FOOTER_TEXT } from "../../constants";
import { getScreenshotURL } from "../../libs/s3-storage";

export const printRecovery = async () => {
  return new EmbedBuilder()
    .setTitle("Coupure de courant")
    .setDescription(`L'imprimante est prète à reprendre l'impression.`)
    .setColor(NOTIFICATION_COLOR)
    .setFooter({
      text: NOTIFICATION_FOOTER_TEXT,
      iconURL: NOTIFICATION_FOOTER_ICON
    })
    .setTimestamp(new Date())
    .setImage(await getScreenshotURL());
};
