import type { DiscordFileAttachment, EmbedResult } from "../../../types/discord";
import type { Status } from "../../../types/printer-status";
import { formatMinuteToBestDisplay, timeDiffInMinutes } from "../../../utils/time.util";
import { createBaseEmbed } from "./base";

export const printFinished = async (status: Status, screenshotFn: () => Promise<Buffer | null>): Promise<EmbedResult> => {
  let time = "";
  if (status.startedAt) {
    const timeDiff = timeDiffInMinutes(status.startedAt, new Date().getTime());
    time = ` en ${formatMinuteToBestDisplay(timeDiff)}`;
  }

  const screenshot = await screenshotFn();
  const files: DiscordFileAttachment[] = [];

  const embed = createBaseEmbed()
    .setTitle("Impression terminée")
    .setDescription(`L'imprimante a fini d'imprimer${time}.`);

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
