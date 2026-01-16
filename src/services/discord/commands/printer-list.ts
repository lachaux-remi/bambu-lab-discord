import { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";

import { getAllPrinters } from "../../database";
import { printerManager } from "../../printer-manager";

export const handlePrinterList = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const printers = getAllPrinters();

  if (printers.length === 0) {
    await interaction.reply({
      content: "📭 Aucune imprimante configurée\n\nUtilisez `/printer add` pour en ajouter une",
      ephemeral: true
    });
    return;
  }

  const embed = new EmbedBuilder().setTitle("🖨️ Imprimantes configurées").setColor("#24a543").setTimestamp();

  for (const printer of printers) {
    const status = printerManager.getPrinterStatus(printer.id);
    const statusEmoji = status.connected ? "🟢" : status.running ? "🟡" : "🔴";
    const enabledText = printer.enabled ? "" : " (désactivée)";

    embed.addFields({
      name: `${statusEmoji} ${printer.name}${enabledText}`,
      value: [
        `📍 \`${printer.ip}:${printer.port}\``,
        `🏷️ \`${printer.serial}\``,
        `📺 <#${printer.forumChannelId}>`
      ].join("\n"),
      inline: true
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
};
