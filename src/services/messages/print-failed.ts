import { uploadScreenshot } from "../../libs/s3-storage";
import type { Status } from "../../types/printer-status";
import { createBaseEmbed } from "../../utils/embed.util";

export const printFailed = async (status: Status) => {
  return createBaseEmbed()
    .setTitle("Impression échouée")
    .setDescription(`L'imprimante a échoué à imprimer **${status.project}**.`)
    .setImage(await uploadScreenshot());
};
