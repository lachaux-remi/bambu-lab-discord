import { takeScreenshot } from "../../../libs/rtc";
import type { EmbedResult } from "../../../types/discord";
import type { PrinterConnection } from "../../../types/printer-config";
import { createBaseEmbed } from "./base";

export const printRecovery = async (printer: PrinterConnection): Promise<EmbedResult> => {
  const screenshot = await takeScreenshot(printer.ip, printer.accessCode);

  const embed = createBaseEmbed()
    .setTitle("Récupération après coupure")
    .setDescription(`L'imprimante est prête à reprendre l'impression.`);

  if (screenshot) {
    embed.setImage("attachment://screenshot.jpg");
    return { embed, files: [{ name: "screenshot.jpg", buffer: screenshot }] };
  }

  return { embed };
};
