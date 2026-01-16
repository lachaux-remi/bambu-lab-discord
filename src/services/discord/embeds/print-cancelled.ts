import { uploadScreenshot } from "../../../libs/s3-storage";
import type { PrinterConnection } from "../../../types/printer-config";
import type { Status } from "../../../types/printer-status";
import { formatMinuteToBestDisplay, timeDiffInMinutes } from "../../../utils/time.util";
import { createBaseEmbed } from "./base";

export const printCancelled = async (status: Status, printer: PrinterConnection) => {
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
    .setImage(await uploadScreenshot(printer.ip, printer.accessCode));
};
