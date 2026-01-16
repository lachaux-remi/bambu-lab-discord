import { uploadScreenshot } from "../../libs/s3-storage";
import type { Status } from "../../types/printer-status";
import { createBaseEmbed } from "../../utils/embed.util";
import { formatMinuteToBestDisplay, timeDiffInMinutes } from "../../utils/time.util";

export const printFinished = async (status: Status) => {
  let time = "";
  if (status.startedAt) {
    const timeDiff = timeDiffInMinutes(status.startedAt, new Date().getTime());
    time = ` en ${formatMinuteToBestDisplay(timeDiff)}`;
  }

  return createBaseEmbed()
    .setTitle("Impression terminée")
    .setDescription(`L'imprimante a fini d'imprimer${time}.`)
    .setThumbnail(status.projectImageUrl)
    .setImage(await uploadScreenshot());
};
