import { RTC_URL } from "../../constants";
import { getLogger } from "../logger";

const logger = getLogger("RTC");

export const takeScreenshotBuffer = async (): Promise<Buffer | null> => {
  return fetch(RTC_URL)
    .then(async response => {
      if (!response.ok) {
        logger.error({ status: response.status, statusText: response.statusText }, "Failed to get screenshot");
        return null;
      }

      return Buffer.from(await response.arrayBuffer());
    })
    .catch((error: Error) => {
      logger.error({ error: error.message }, "RTC fetch error");
      return null;
    });
};
