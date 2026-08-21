import { ChatInputCommandInteraction, MessageFlags } from "discord.js";

import { getPrinter } from "../../database";
import { printerManager } from "../../printer-manager";

export const handlePrinterReconnect = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const printerId = interaction.options.getString("name", true);
  const printer = getPrinter(printerId);
  if (!printer) {
    await interaction.reply({
      content: `❌ Imprimante **${printerId}** non trouvée`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (!printer.enabled) {
    await interaction.reply({
      content: `❌ L'imprimante **${printer.name}** est désactivée. Réactivez-la avec \`/printer edit\` avant de demander une reconnexion.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const reconnected = await printerManager.restartPrinter(printerId);
  if (!reconnected) {
    await interaction.editReply(
      `❌ La reconnexion immédiate de l'imprimante **${printer.name}** a échoué. Vérifiez sa configuration, sa disponibilité et les logs.`
    );
    return;
  }

  await interaction.editReply(`✅ Imprimante **${printer.name}** reconnectée.`);
};
