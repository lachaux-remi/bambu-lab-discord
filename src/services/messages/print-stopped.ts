import { uploadScreenshot } from "../../libs/s3-storage";
import { createBaseEmbed } from "../../utils/embed.util";

export const printStopped = async () => {
  return createBaseEmbed()
    .setTitle("Impression interrompue")
    .setDescription(`L'imprimante a été interrompue pour une raison inconnue.`)
    .setImage(await uploadScreenshot());
};
