import { SCREENSHOT_ATTACHMENT_NAME, SCREENSHOT_ATTACHMENT_URL } from "../../../constants";
import type { EmbedResult } from "../../../types/discord";
import { createBaseEmbed } from "./base";

export const printResumed = async (screenshotFn: () => Promise<Buffer | null>): Promise<EmbedResult> => {
  const screenshot = await screenshotFn();

  const embed = createBaseEmbed()
    .setTitle("Reprise de l'impression")
    .setDescription(`L'imprimante a repris l'impression.`);

  if (screenshot) {
    embed.setImage(SCREENSHOT_ATTACHMENT_URL);
    return { embed, files: [{ name: SCREENSHOT_ATTACHMENT_NAME, buffer: screenshot }] };
  }

  return { embed };
};
