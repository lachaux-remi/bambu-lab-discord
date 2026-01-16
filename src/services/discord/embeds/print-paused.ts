import { uploadScreenshot } from "../../../libs/s3-storage";
import type { PrinterConnection } from "../../../types/printer-config";
import { createBaseEmbed } from "./base";

export const printPaused = async (printer: PrinterConnection) => {
  return createBaseEmbed()
    .setTitle("Impression en pause")
    .setDescription(`L'imprimante a été mise en pause.`)
    .setImage(await uploadScreenshot(printer.ip, printer.accessCode));
};
