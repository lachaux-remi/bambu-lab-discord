import { RTC_URL } from "../../constants";
import { getLogger } from "../logger";

const logger = getLogger("RTC");

export const takeScreenshotBuffer = async (): Promise<Buffer> => {
  return fetch(RTC_URL).then(async response => {
    if (!response.ok) {
      logger.error(`Failed to get screenshot from ${RTC_URL}`);
    }

    return Buffer.from(await response.arrayBuffer());
  });
};
