import { SCREENSHOT_ATTACHMENT_NAME, SCREENSHOT_ATTACHMENT_URL } from "../../../constants";
import type { EmbedResult } from "../../../types/discord";
import { createBaseEmbed } from "./base";

export const printStopped = async (screenshotFn: () => Promise<Buffer | null>): Promise<EmbedResult> => {
  const screenshot = await screenshotFn();

  const embed = createBaseEmbed()
    .setTitle("Impression interrompue")
    .setDescription(`L'imprimante a été interrompue pour une raison inconnue.`);

  if (screenshot) {
    embed.setImage(SCREENSHOT_ATTACHMENT_URL);
    return { embed, files: [{ name: SCREENSHOT_ATTACHMENT_NAME, buffer: screenshot }] };
  }

  return { embed };
};
