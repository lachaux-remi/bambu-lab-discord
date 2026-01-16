import { uploadScreenshot } from "../../../libs/s3-storage";
import type { PrinterConnection } from "../../../types/printer-config";
import { createBaseEmbed } from "./base";

export const printResumed = async (printer: PrinterConnection) => {
  return createBaseEmbed()
    .setTitle("Reprise de l'impression")
    .setDescription(`L'imprimante a repris l'impression.`)
    .setImage(await uploadScreenshot(printer.ip, printer.accessCode));
};
