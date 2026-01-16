import { takeScreenshot } from "../../../libs/rtc";
import type { EmbedResult } from "../../../types/discord";
import type { PrinterConnection } from "../../../types/printer-config";
import type { Status } from "../../../types/printer-status";
import { createBaseEmbed } from "./base";

export const printFailed = async (status: Status, printer: PrinterConnection): Promise<EmbedResult> => {
  const screenshot = await takeScreenshot(printer.ip, printer.accessCode);

  const embed = createBaseEmbed()
    .setTitle("Impression échouée")
    .setDescription(`L'imprimante a échoué à imprimer **${status.project}**.`);

  if (screenshot) {
    embed.setImage("attachment://screenshot.jpg");
    return { embed, files: [{ name: "screenshot.jpg", buffer: screenshot }] };
  }

  return { embed };
};
