import { RTC_URL } from "../../constants";
import { getLogger } from "../logger";

const logger = getLogger("RTC");

export const takeScreenshotBuffer = async (): Promise<Buffer | null> => {
  return fetch(RTC_URL)
    .then(async response => {
      if (!response.ok) {
        logger.error({ response }, `Failed to get screenshot`);
        return null;
      }

      return Buffer.from(await response.arrayBuffer());
    })
    .catch(() => null);
};
