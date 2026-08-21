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

export const printProgress = async (
  status: Status,
  screenshotFn: () => Promise<Buffer | null>
): Promise<EmbedResult> => {
  let time = "N/D";
  if (status.startedAt) {
    const timeDiff = timeDiffInMinutes(status.startedAt, new Date().getTime());
    time = formatMinuteToBestDisplay(timeDiff);
  }

  const screenshot = await screenshotFn();
  const files: DiscordFileAttachment[] = [];

  const embed = createBaseEmbed()
    .setTitle("Progression de l'impression")
    .setDescription(`L'imprimante a fait **${status.progressPercent}%** de l'impression.`)
    .addFields(
      { name: "Couche", value: `${status.currentLayer} / ${status.maxLayers}`, inline: true },
      { name: "Durée", value: time, inline: true },
      { name: "Temps restant", value: formatMinuteToBestDisplay(status.remainingTime ?? 0), inline: true }
    );

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
