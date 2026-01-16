import type { Status } from "../../../types/printer-status";
import { createBaseEmbed } from "./base";

export const printStarted = (status: Status) => {
  return createBaseEmbed()
    .setTitle("Démarrage de l'impression")
    .setDescription(`L'imprimante se prépare pour imprimer **${status.project}**\n${status.model}`)
    .setImage(status.projectImageUrl);
};
