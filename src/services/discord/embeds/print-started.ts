import { PROJECT_IMAGE_ATTACHMENT_NAME, PROJECT_IMAGE_ATTACHMENT_URL } from "../../../constants";
import type { EmbedResult } from "../../../types/discord";
import type { Status } from "../../../types/printer-status";
import { DISCORD_EMBED_DESCRIPTION_LIMIT, truncateDiscordText } from "../payload";
import { createBaseEmbed } from "./base";

export const printStarted = (status: Status): EmbedResult => {
  const embed = createBaseEmbed()
    .setTitle("Démarrage de l'impression")
    .setDescription(
      truncateDiscordText(
        `L'imprimante se prépare pour imprimer **${status.project}**\n${status.model}`,
        DISCORD_EMBED_DESCRIPTION_LIMIT
      )
    );

  if (status.projectImage) {
    embed.setImage(PROJECT_IMAGE_ATTACHMENT_URL);
    return { embed, files: [{ name: PROJECT_IMAGE_ATTACHMENT_NAME, buffer: status.projectImage }] };
  }

  return { embed };
};
