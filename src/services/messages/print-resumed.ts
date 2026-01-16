import { uploadScreenshot } from "../../libs/s3-storage";
import { createBaseEmbed } from "../../utils/embed.util";

export const printResumed = async () => {
  return createBaseEmbed()
    .setTitle("Reprise de l'Impression")
    .setDescription(`L'imprimante a repris l'impression.`)
    .setImage(await uploadScreenshot());
};
