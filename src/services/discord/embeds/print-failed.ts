import { uploadScreenshot } from "../../../libs/s3-storage";
import type { PrinterConnection } from "../../../types/printer-config";
import type { Status } from "../../../types/printer-status";
import { createBaseEmbed } from "./base";

export const printFailed = async (status: Status, printer: PrinterConnection) => {
  return createBaseEmbed()
    .setTitle("Impression échouée")
    .setDescription(`L'imprimante a échoué à imprimer **${status.project}**.`)
    .setImage(await uploadScreenshot(printer.ip, printer.accessCode));
};
