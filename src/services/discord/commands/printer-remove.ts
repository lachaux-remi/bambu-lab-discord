import { ChatInputCommandInteraction, MessageFlags } from "discord.js";

import { getLogger } from "../../../libs/logger";
import { getPrinter, removePrinter } from "../../database";
import { printerManager } from "../../printer-manager";
import { PRINTER_OPTION } from "./contract";

const logger = getLogger("PrinterRemove");

export const handlePrinterRemove = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const printerId = interaction.options.getString(PRINTER_OPTION.NAME, true);

  const printer = getPrinter(printerId);
  if (!printer) {
    await interaction.reply({
      content: `❌ Imprimante **${printerId}** non trouvée`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // Arrêter l'imprimante si elle est en cours d'exécution
  await printerManager.stopPrinter(printerId);

  // Supprimer de la base de données
  const success = removePrinter(printerId);

  if (success) {
    logger.info({ printerId, name: printer.name }, "Printer removed via command");
    await interaction.reply({
      content: `✅ Imprimante **${printer.name}** supprimée`,
      flags: MessageFlags.Ephemeral
    });
  } else {
    await interaction.reply({
      content: `❌ Impossible de supprimer l'imprimante **${printer.name}**`,
      flags: MessageFlags.Ephemeral
    });
  }
};
