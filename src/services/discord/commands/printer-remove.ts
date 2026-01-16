import { ChatInputCommandInteraction } from "discord.js";

import { getLogger } from "../../../libs/logger";
import { getPrinter, removePrinter } from "../../database";
import { printerManager } from "../../printer-manager";

const logger = getLogger("PrinterRemove");

export const handlePrinterRemove = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const printerId = interaction.options.getString("name", true);

  const printer = getPrinter(printerId);
  if (!printer) {
    await interaction.reply({
      content: `❌ Imprimante **${printerId}** non trouvée`,
      ephemeral: true
    });
    return;
  }

  // Arrêter l'imprimante si elle est en cours d'exécution
  printerManager.stopPrinter(printerId);

  // Supprimer de la base de données
  const success = removePrinter(printerId);

  if (success) {
    logger.info({ printerId, name: printer.name }, "Printer removed via command");
    await interaction.reply({
      content: `✅ Imprimante **${printer.name}** supprimée`,
      ephemeral: true
    });
  } else {
    await interaction.reply({
      content: `❌ Impossible de supprimer l'imprimante **${printer.name}**`,
      ephemeral: true
    });
  }
};
