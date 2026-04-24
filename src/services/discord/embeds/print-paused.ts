import type { EmbedResult } from "../../../types/discord";
import { createBaseEmbed } from "./base";

export const printPaused = async (screenshotFn: () => Promise<Buffer | null>): Promise<EmbedResult> => {
  const screenshot = await screenshotFn();

  const embed = createBaseEmbed().setTitle("Impression en pause").setDescription(`L'imprimante a été mise en pause.`);

  if (screenshot) {
    embed.setImage("attachment://screenshot.jpg");
    return { embed, files: [{ name: "screenshot.jpg", buffer: screenshot }] };
  }

  return { embed };
};
