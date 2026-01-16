import { takeScreenshot } from "../../../libs/rtc";
import type { EmbedResult } from "../../../types/discord";
import type { PrinterConnection } from "../../../types/printer-config";
import { createBaseEmbed } from "./base";

export const printResumed = async (printer: PrinterConnection): Promise<EmbedResult> => {
  const screenshot = await takeScreenshot(printer.ip, printer.accessCode);

  const embed = createBaseEmbed()
    .setTitle("Reprise de l'impression")
    .setDescription(`L'imprimante a repris l'impression.`);

  if (screenshot) {
    embed.setImage("attachment://screenshot.jpg");
    return { embed, files: [{ name: "screenshot.jpg", buffer: screenshot }] };
  }

  return { embed };
};
