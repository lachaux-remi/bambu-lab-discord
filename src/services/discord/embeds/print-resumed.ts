import type { EmbedResult } from "../../../types/discord";
import { createBaseEmbed } from "./base";

export const printResumed = async (screenshotFn: () => Promise<Buffer | null>): Promise<EmbedResult> => {
  const screenshot = await screenshotFn();

  const embed = createBaseEmbed()
    .setTitle("Reprise de l'impression")
    .setDescription(`L'imprimante a repris l'impression.`);

  if (screenshot) {
    embed.setImage("attachment://screenshot.jpg");
    return { embed, files: [{ name: "screenshot.jpg", buffer: screenshot }] };
  }

  return { embed };
};
