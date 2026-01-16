import { takeScreenshot } from "../../../libs/rtc";
import type { DiscordFileAttachment, EmbedResult } from "../../../types/discord";
import type { PrinterConnection } from "../../../types/printer-config";
import type { Status } from "../../../types/printer-status";
import { formatMinuteToBestDisplay, timeDiffInMinutes } from "../../../utils/time.util";
import { createBaseEmbed } from "./base";

export const printProgress = async (status: Status, printer: PrinterConnection): Promise<EmbedResult> => {
  let time = "N/D";
  if (status.startedAt) {
    const timeDiff = timeDiffInMinutes(status.startedAt, new Date().getTime());
    time = formatMinuteToBestDisplay(timeDiff);
  }

  const screenshot = await takeScreenshot(printer.ip, printer.accessCode);
  const files: DiscordFileAttachment[] = [];

  const embed = createBaseEmbed()
    .setTitle("Progression de l'impression")
    .setDescription(`L'imprimante a fait **${status.progressPercent}%** de l'impression.`)
    .addFields(
      { name: "Couche", value: `${status.currentLayer} / ${status.maxLayers}`, inline: true },
      { name: "Durée", value: time, inline: true },
      { name: "Temps restant", value: formatMinuteToBestDisplay(status.remainingTime), inline: true }
    );

  if (status.projectImage) {
    embed.setThumbnail("attachment://project.png");
    files.push({ name: "project.png", buffer: status.projectImage });
  }

  if (screenshot) {
    embed.setImage("attachment://screenshot.jpg");
    files.push({ name: "screenshot.jpg", buffer: screenshot });
  }

  return { embed, files: files.length > 0 ? files : undefined };
};
