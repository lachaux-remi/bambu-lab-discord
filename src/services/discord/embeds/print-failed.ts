import type { EmbedResult } from "../../../types/discord";
import type { Status } from "../../../types/printer-status";
import { createBaseEmbed } from "./base";

export const printFailed = async (status: Status, screenshotFn: () => Promise<Buffer | null>): Promise<EmbedResult> => {
  const screenshot = await screenshotFn();

  const embed = createBaseEmbed()
    .setTitle("Impression échouée")
    .setDescription(`L'imprimante a échoué à imprimer **${status.project}**.`);

  if (screenshot) {
    embed.setImage("attachment://screenshot.jpg");
    return { embed, files: [{ name: "screenshot.jpg", buffer: screenshot }] };
  }

  return { embed };
};
