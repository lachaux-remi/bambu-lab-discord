import { takeScreenshot } from "../../../libs/rtc";
import type { EmbedResult } from "../../../types/discord";
import type { PrinterConnection } from "../../../types/printer-config";
import { createBaseEmbed } from "./base";

export const printStopped = async (printer: PrinterConnection): Promise<EmbedResult> => {
  const screenshot = await takeScreenshot(printer.ip, printer.accessCode);

  const embed = createBaseEmbed()
    .setTitle("Impression interrompue")
    .setDescription(`L'imprimante a été interrompue pour une raison inconnue.`);

  if (screenshot) {
    embed.setImage("attachment://screenshot.jpg");
    return { embed, files: [{ name: "screenshot.jpg", buffer: screenshot }] };
  }

  return { embed };
};
