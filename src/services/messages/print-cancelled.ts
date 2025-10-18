import { EmbedBuilder } from "discord.js";

import { NOTIFICATION_COLOR, NOTIFICATION_FOOTER_ICON, NOTIFICATION_FOOTER_TEXT } from "../../constants";
import { uploadScreenshot } from "../../libs/s3-storage";
import type { Status } from "../../types/printer-status";
import { formatMinuteToBestDisplay, timeDiffInMinutes } from "../../utils/time.util";

export const printCancelled = async (status: Status) => {
  let time = "";
  if (status.startedAt) {
    const timeDiff = timeDiffInMinutes(status.startedAt, new Date().getTime());
    time = ` après ${formatMinuteToBestDisplay(timeDiff)}`;
  }

  const progressText = status.progressPercent ? ` à ${status.progressPercent}%` : "";

  return new EmbedBuilder()
    .setTitle("Impression annulée")
    .setDescription(`L'impression a été annulée${progressText}${time}.`)
    .setColor(NOTIFICATION_COLOR)
    .setFooter({
      text: NOTIFICATION_FOOTER_TEXT,
      iconURL: NOTIFICATION_FOOTER_ICON
    })
    .setTimestamp(new Date())
    .setThumbnail(status.projectImageUrl)
    .setImage(await uploadScreenshot());
};
