import { SCREENSHOT_ATTACHMENT_NAME, SCREENSHOT_ATTACHMENT_URL } from "../../../constants";
import type { EmbedResult } from "../../../types/discord";
import { createBaseEmbed } from "./base";

export const printPaused = async (screenshotFn: () => Promise<Buffer | null>): Promise<EmbedResult> => {
  const screenshot = await screenshotFn();

  const embed = createBaseEmbed().setTitle("Impression en pause").setDescription(`L'imprimante a été mise en pause.`);

  if (screenshot) {
    embed.setImage(SCREENSHOT_ATTACHMENT_URL);
    return { embed, files: [{ name: SCREENSHOT_ATTACHMENT_NAME, buffer: screenshot }] };
  }

  return { embed };
};
