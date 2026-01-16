import { uploadScreenshot } from "../../libs/s3-storage";
import { createBaseEmbed } from "../../utils/embed.util";

export const printPaused = async () => {
  return createBaseEmbed()
    .setTitle("Impression en pause")
    .setDescription(`L'imprimante a été mise en pause.`)
    .setImage(await uploadScreenshot());
};
