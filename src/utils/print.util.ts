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
