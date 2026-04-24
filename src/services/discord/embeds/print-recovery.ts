import type { EmbedResult } from "../../../types/discord";
import { createBaseEmbed } from "./base";

export const printRecovery = async (screenshotFn: () => Promise<Buffer | null>): Promise<EmbedResult> => {
  const screenshot = await screenshotFn();

  const embed = createBaseEmbed()
    .setTitle("Récupération après coupure")
    .setDescription(`L'imprimante est prête à reprendre l'impression.`);

  if (screenshot) {
    embed.setImage("attachment://screenshot.jpg");
    return { embed, files: [{ name: "screenshot.jpg", buffer: screenshot }] };
  }

  return { embed };
};
