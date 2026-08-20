import { ForumTag, PrintState } from "../enums";
import type { Status } from "../types/printer-status";

/**
 * Détermine les tags Discord à appliquer en fonction du statut de l'impression
 * @param status - Statut actuel de l'impression
 * @returns Tableau des noms de tags à appliquer
 */
export const getDiscordTagsForStatus = (status: Pick<Status, "state" | "isMulticolor">): string[] => {
  const tags: string[] = [];

  // Tag de couleur (toujours présent)
  if (status.isMulticolor) {
    tags.push(ForumTag.MULTICOLOR);
  } else {
    tags.push(ForumTag.MONOCOLOR);
  }

  // Tag d'état
  switch (status.state) {
    case PrintState.PREPARE:
    case PrintState.RUNNING:
      tags.push(ForumTag.IN_PROGRESS);
      break;
    case PrintState.FINISH:
      tags.push(ForumTag.SUCCEEDED);
      break;
    case PrintState.FAILED:
      tags.push(ForumTag.FAILED);
      break;
    case PrintState.PAUSE:
      tags.push(ForumTag.PAUSED);
      break;
    default:
      tags.push(ForumTag.IN_PROGRESS);
  }

  return tags;
};

/**
 * Détermine les tags Discord initiaux lors de la création du thread
 * @param isMulticolor - Si l'impression est multicolore
 * @returns Tableau des noms de tags à appliquer
 */
export const getInitialDiscordTags = (isMulticolor: boolean): string[] => {
  const tags: string[] = [ForumTag.IN_PROGRESS];

  if (isMulticolor) {
    tags.push(ForumTag.MULTICOLOR);
  } else {
    tags.push(ForumTag.MONOCOLOR);
  }

  return tags;
};
