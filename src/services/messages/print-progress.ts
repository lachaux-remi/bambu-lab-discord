import { EmbedBuilder } from "discord.js";

import { NOTIFICATION_COLOR, NOTIFICATION_FOOTER_ICON, NOTIFICATION_FOOTER_TEXT } from "../../constants";
import { getScreenshotURL } from "../../libs/s3-storage";
import type { Status } from "../../types/printer-status";
import { formatMinuteToBestDisplay, timeDiffInMinutes } from "../../utils/time.util";

export const printProgress = async (status: Status) => {
  let time = "N/D";
  if (status.startedAt) {
    const timeDiff = timeDiffInMinutes(new Date(), new Date(status.startedAt));
    time = formatMinuteToBestDisplay(timeDiff);
  }

  return (
    new EmbedBuilder()
      .setTitle("Progression de l'Impression")
      .setDescription(`L'imprimante a fait **${status.progressPercent}%** de l'impression.`)
      .setColor(NOTIFICATION_COLOR)
      .addFields(
        { name: "Couche", value: `${status.currentLayer} / ${status.maxLayers}`, inline: true },
        { name: "Durée", value: time, inline: true },
        { name: "Temps restant", value: formatMinuteToBestDisplay(status.remainingTime), inline: true }
      )
      .setFooter({
        text: NOTIFICATION_FOOTER_TEXT,
        iconURL: NOTIFICATION_FOOTER_ICON
      })
      // TODO change for printer plate image
      .setImage(await getScreenshotURL())
      .setTimestamp(new Date())
  );
};
