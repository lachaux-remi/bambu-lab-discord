import { SCREENSHOT_ATTACHMENT_NAME, SCREENSHOT_ATTACHMENT_URL } from "../../../constants";
import type { EmbedResult } from "../../../types/discord";
import type { Status } from "../../../types/printer-status";
import { DISCORD_EMBED_DESCRIPTION_LIMIT, truncateDiscordText } from "../payload";
import { createBaseEmbed } from "./base";

export const printFailed = async (status: Status, screenshotFn: () => Promise<Buffer | null>): Promise<EmbedResult> => {
  const screenshot = await screenshotFn();

  const embed = createBaseEmbed()
    .setTitle("Impression échouée")
    .setDescription(
      truncateDiscordText(`L'imprimante a échoué à imprimer **${status.project}**.`, DISCORD_EMBED_DESCRIPTION_LIMIT)
    );

  if (screenshot) {
    embed.setImage(SCREENSHOT_ATTACHMENT_URL);
    return { embed, files: [{ name: SCREENSHOT_ATTACHMENT_NAME, buffer: screenshot }] };
  }

  return { embed };
};
