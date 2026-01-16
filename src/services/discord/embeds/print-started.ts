import type { EmbedResult } from "../../../types/discord";
import type { Status } from "../../../types/printer-status";
import { createBaseEmbed } from "./base";

export const printStarted = (status: Status): EmbedResult => {
  const embed = createBaseEmbed()
    .setTitle("Démarrage de l'impression")
    .setDescription(`L'imprimante se prépare pour imprimer **${status.project}**\n${status.model}`);

  if (status.projectImage) {
    embed.setImage("attachment://project.png");
    return { embed, files: [{ name: "project.png", buffer: status.projectImage }] };
  }

  return { embed };
};
