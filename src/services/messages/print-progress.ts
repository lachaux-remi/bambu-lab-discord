import { uploadScreenshot } from "../../libs/s3-storage";
import type { Status } from "../../types/printer-status";
import { createBaseEmbed } from "../../utils/embed.util";
import { formatMinuteToBestDisplay, timeDiffInMinutes } from "../../utils/time.util";

export const printProgress = async (status: Status) => {
  let time = "N/D";
  if (status.startedAt) {
    const timeDiff = timeDiffInMinutes(status.startedAt, new Date().getTime());
    time = formatMinuteToBestDisplay(timeDiff);
  }

  return createBaseEmbed()
    .setTitle("Progression de l'Impression")
    .setDescription(`L'imprimante a fait **${status.progressPercent}%** de l'impression.`)
    .addFields(
      { name: "Couche", value: `${status.currentLayer} / ${status.maxLayers}`, inline: true },
      { name: "Durée", value: time, inline: true },
      { name: "Temps restant", value: formatMinuteToBestDisplay(status.remainingTime), inline: true }
    )
    .setThumbnail(status.projectImageUrl)
    .setImage(await uploadScreenshot());
};
