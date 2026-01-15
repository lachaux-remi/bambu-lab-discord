import type { AmsMappingSlot } from "../types/project-file";

/**
 * Détecte si une impression utilise plusieurs couleurs/filaments
 * @param amsMapping - Tableau des slots AMS utilisés (-1 = non utilisé, >= 0 = slot utilisé)
 * @returns true si multicolore (2+ filaments), false sinon
 */
export const isMulticolorPrint = (amsMapping?: number[]): boolean => {
  if (!amsMapping || amsMapping.length === 0) {
    return false;
  }

  const usedFilaments = amsMapping.filter(slot => slot >= 0);
  return usedFilaments.length > 1;
};

/**
 * Détecte si une impression utilise plusieurs couleurs via ams_mapping2
 * @param amsMapping2 - Tableau des slots AMS avec IDs détaillés
 * @returns true si multicolore (2+ filaments), false sinon
 */
export const isMulticolorPrintV2 = (amsMapping2?: AmsMappingSlot[]): boolean => {
  if (!amsMapping2 || amsMapping2.length === 0) {
    return false;
  }

  const usedSlots = amsMapping2.filter(m => m.ams_id !== 255 && m.slot_id !== 255);
  return usedSlots.length > 1;
};

/**
 * Compte le nombre de filaments utilisés dans une impression
 * @param amsMapping - Tableau des slots AMS utilisés
 * @returns Nombre de filaments utilisés
 */
export const getFilamentCount = (amsMapping?: number[]): number => {
  if (!amsMapping || amsMapping.length === 0) {
    return 0;
  }

  return amsMapping.filter(slot => slot >= 0).length;
};
