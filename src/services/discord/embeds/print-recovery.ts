import { uploadScreenshot } from "../../../libs/s3-storage";
import type { PrinterConnection } from "../../../types/printer-config";
import { createBaseEmbed } from "./base";

export const printRecovery = async (printer: PrinterConnection) => {
  return createBaseEmbed()
    .setTitle("Récupération après coupure")
    .setDescription(`L'imprimante est prête à reprendre l'impression.`)
    .setImage(await uploadScreenshot(printer.ip, printer.accessCode));
};
