import { PrintState } from "../enums";
import type { Status } from "../types/printer-status";

/**
 * Détermine les tags Discord à appliquer en fonction du statut de l'impression
 * @param status - Statut actuel de l'impression
 * @returns Tableau des noms de tags à appliquer
 */
export const getDiscordTagsForStatus = (status: Status): string[] => {
  const tags: string[] = [];

  // Tag de couleur (toujours présent)
  if (status.isMulticolor) {
    tags.push("Multicolore");
  } else {
    tags.push("Monocolor");
  }

  // Tag d'état
  switch (status.state) {
    case PrintState.PREPARE:
    case PrintState.RUNNING:
      tags.push("En cours");
      break;
    case PrintState.FINISH:
      tags.push("Réussi");
      break;
    case PrintState.FAILED:
      tags.push("Échoué");
      break;
    case PrintState.PAUSE:
      tags.push("En pause");
      break;
    default:
      tags.push("En cours");
  }

  return tags;
};

/**
 * Détermine les tags Discord initiaux lors de la création du thread
 * @param isMulticolor - Si l'impression est multicolore
 * @returns Tableau des noms de tags à appliquer
 */
export const getInitialDiscordTags = (isMulticolor: boolean): string[] => {
  const tags = ["En cours"];

  if (isMulticolor) {
    tags.push("Multicolore");
  } else {
    tags.push("Monocolor");
  }

  return tags;
};
