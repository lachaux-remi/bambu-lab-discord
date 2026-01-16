import { uploadScreenshot } from "../../../libs/s3-storage";
import type { PrinterConnection } from "../../../types/printer-config";
import { createBaseEmbed } from "./base";

export const printStopped = async (printer: PrinterConnection) => {
  return createBaseEmbed()
    .setTitle("Impression interrompue")
    .setDescription(`L'imprimante a été interrompue pour une raison inconnue.`)
    .setImage(await uploadScreenshot(printer.ip, printer.accessCode));
};
