import {
  PROJECT_IMAGE_ATTACHMENT_NAME,
  PROJECT_IMAGE_ATTACHMENT_URL,
  SCREENSHOT_ATTACHMENT_NAME,
  SCREENSHOT_ATTACHMENT_URL
} from "../../../constants";
import type { DiscordFileAttachment, EmbedResult } from "../../../types/discord";
import type { Status } from "../../../types/printer-status";
import { formatMinuteToBestDisplay, timeDiffInMinutes } from "../../../utils/time.util";
import { createBaseEmbed } from "./base";

export const printCancelled = async (
  status: Status,
  screenshotFn: () => Promise<Buffer | null>
): Promise<EmbedResult> => {
  let time = "";
  if (status.startedAt) {
    const timeDiff = timeDiffInMinutes(status.startedAt, new Date().getTime());
    time = ` après ${formatMinuteToBestDisplay(timeDiff)}`;
  }

  const progressText = status.progressPercent ? ` à ${status.progressPercent}%` : "";
  const screenshot = await screenshotFn();
  const files: DiscordFileAttachment[] = [];

  const embed = createBaseEmbed()
    .setTitle("Impression annulée")
    .setDescription(`L'impression a été annulée${progressText}${time}.`);

  if (status.projectImage) {
    embed.setThumbnail(PROJECT_IMAGE_ATTACHMENT_URL);
    files.push({ name: PROJECT_IMAGE_ATTACHMENT_NAME, buffer: status.projectImage });
  }

  if (screenshot) {
    embed.setImage(SCREENSHOT_ATTACHMENT_URL);
    files.push({ name: SCREENSHOT_ATTACHMENT_NAME, buffer: screenshot });
  }

  return { embed, files: files.length > 0 ? files : undefined };
};
