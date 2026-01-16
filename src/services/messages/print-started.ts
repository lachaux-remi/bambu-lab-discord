import type { Status } from "../../types/printer-status";
import { createBaseEmbed } from "../../utils/embed.util";

export const printStarted = async (status: Status) => {
  return createBaseEmbed()
    .setTitle("Démarrage de l'impression")
    .setDescription(`L'imprimante se prépare pour imprimer **${status.project}**\n${status.model}`)
    .setImage(status.projectImageUrl);
};
