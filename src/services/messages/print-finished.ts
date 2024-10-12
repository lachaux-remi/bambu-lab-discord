import { EmbedBuilder } from "discord.js";

import { NOTIFICATION_COLOR, NOTIFICATION_FOOTER_ICON, NOTIFICATION_FOOTER_TEXT } from "../../constants";
import { uploadScreenshot } from "../../libs/s3-storage";
import type { Status } from "../../types/printer-status";
import { formatMinuteToBestDisplay, timeDiffInMinutes } from "../../utils/time.util";

export const printFinished = async (status: Status) => {
  let time = "";
  if (status.startedAt) {
    const timeDiff = timeDiffInMinutes(new Date(), new Date(status.startedAt));
    time = ` en ${formatMinuteToBestDisplay(timeDiff)}`;
  }

  return new EmbedBuilder()
    .setTitle("Impression terminée")
    .setDescription(`L'imprimante a fini d'imprimer${time}.`)
    .setColor(NOTIFICATION_COLOR)
    .setFooter({
      text: NOTIFICATION_FOOTER_TEXT,
      iconURL: NOTIFICATION_FOOTER_ICON
    })
    .setTimestamp(new Date())
    .setThumbnail(status.projectImageUrl)
    .setImage(await uploadScreenshot());
};
