import { uploadScreenshot } from "../../../libs/s3-storage";
import type { PrinterConnection } from "../../../types/printer-config";
import type { Status } from "../../../types/printer-status";
import { formatMinuteToBestDisplay, timeDiffInMinutes } from "../../../utils/time.util";
import { createBaseEmbed } from "./base";

export const printFinished = async (status: Status, printer: PrinterConnection) => {
  let time = "";
  if (status.startedAt) {
    const timeDiff = timeDiffInMinutes(status.startedAt, new Date().getTime());
    time = ` en ${formatMinuteToBestDisplay(timeDiff)}`;
  }

  return createBaseEmbed()
    .setTitle("Impression terminée")
    .setDescription(`L'imprimante a fini d'imprimer${time}.`)
    .setThumbnail(status.projectImageUrl)
    .setImage(await uploadScreenshot(printer.ip, printer.accessCode));
};
