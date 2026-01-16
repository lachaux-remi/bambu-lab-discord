import AdmZip from "adm-zip";
import { setTimeout } from "timers/promises";

import type { StringNumber } from "../../types/general";
import { getLogger } from "../logger";

const logger = getLogger("Project");

const MAX_RETRIES = 5;

export interface ExtractProjectImageData {
  url: string;
  plate: StringNumber;
}

/**
 * Télécharge le fichier 3mf et extrait l'image de prévisualisation de la plaque
 *
 * @param data Les données pour extraire l'image
 * @param attempt Le nombre de tentatives
 * @returns Le buffer de l'image PNG ou null
 */
export const extractProjectImage = async (
  data: ExtractProjectImageData,
  attempt: number = 0
): Promise<Buffer | null> => {
  if (attempt >= MAX_RETRIES) {
    logger.error({ maxRetries: MAX_RETRIES }, "Failed to extract project image after max attempts");
    return null;
  }

  const { url, plate } = data;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      logger.warn({ status: response.status, url }, "Failed to fetch project file, retrying...");
      await setTimeout(1000);
      return extractProjectImage(data, attempt + 1);
    }

    const projectBuffer = await response.arrayBuffer();

    // Extraire l'image de la plaque depuis le fichier 3mf (qui est un zip)
    const projectZip = new AdmZip(Buffer.from(projectBuffer));
    const plateEntry = projectZip.getEntry(`Metadata/plate_${plate}.png`);

    if (!plateEntry) {
      logger.error({ plate }, "Plate image not found in project file");
      return null;
    }

    const imageBuffer = plateEntry.getData();
    logger.debug({ plate, size: imageBuffer.length }, "Project image extracted");

    return imageBuffer;
  } catch (error) {
    logger.warn({ error: (error as Error).message, url }, "Error fetching project file, retrying...");
    await setTimeout(1000);
    return extractProjectImage(data, attempt + 1);
  }
};
