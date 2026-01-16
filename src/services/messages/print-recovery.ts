import { uploadScreenshot } from "../../libs/s3-storage";
import { createBaseEmbed } from "../../utils/embed.util";

export const printRecovery = async () => {
  return createBaseEmbed()
    .setTitle("Coupure de courant")
    .setDescription(`L'imprimante est prête à reprendre l'impression.`)
    .setImage(await uploadScreenshot());
};
