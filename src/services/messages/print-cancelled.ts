import { uploadScreenshot } from "../../libs/s3-storage";
import type { Status } from "../../types/printer-status";
import { createBaseEmbed } from "../../utils/embed.util";
import { formatMinuteToBestDisplay, timeDiffInMinutes } from "../../utils/time.util";

export const printCancelled = async (status: Status) => {
  let time = "";
  if (status.startedAt) {
    const timeDiff = timeDiffInMinutes(status.startedAt, new Date().getTime());
    time = ` après ${formatMinuteToBestDisplay(timeDiff)}`;
  }

  const progressText = status.progressPercent ? ` à ${status.progressPercent}%` : "";

  return createBaseEmbed()
    .setTitle("Impression annulée")
    .setDescription(`L'impression a été annulée${progressText}${time}.`)
    .setThumbnail(status.projectImageUrl)
    .setImage(await uploadScreenshot());
};
