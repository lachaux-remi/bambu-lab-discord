import type { EmbedResult } from "../../../types/discord";
import { createBaseEmbed } from "./base";

export const printStopped = async (screenshotFn: () => Promise<Buffer | null>): Promise<EmbedResult> => {
  const screenshot = await screenshotFn();

  const embed = createBaseEmbed()
    .setTitle("Impression interrompue")
    .setDescription(`L'imprimante a été interrompue pour une raison inconnue.`);

  if (screenshot) {
    embed.setImage("attachment://screenshot.jpg");
    return { embed, files: [{ name: "screenshot.jpg", buffer: screenshot }] };
  }

  return { embed };
};
