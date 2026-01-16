import { ChannelType, ChatInputCommandInteraction } from "discord.js";

import { getLogger } from "../../../libs/logger";
import { getPrinter, updatePrinter } from "../../database";
import { ensurePrinterTag } from "../bot";

const logger = getLogger("PrinterEdit");

export const handlePrinterEdit = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const printerId = interaction.options.getString("name", true);

  const printer = getPrinter(printerId);
  if (!printer) {
    await interaction.reply({
      content: `❌ Imprimante **${printerId}** non trouvée`,
      ephemeral: true
    });
    return;
  }

  const newName = interaction.options.getString("new_name");
  const ip = interaction.options.getString("ip");
  const serial = interaction.options.getString("serial");
  const accessCode = interaction.options.getString("access_code");
  const channel = interaction.options.getChannel("channel");

  // Vérifier si le channel est un forum
  if (channel && channel.type !== ChannelType.GuildForum) {
    await interaction.reply({
      content: "❌ Le channel doit être un **forum channel**",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // Construire les mises à jour
  const updates: Record<string, unknown> = {};
  const changes: string[] = [];

  if (newName) {
    updates.name = newName;
    changes.push(`Nom: ${printer.name} → ${newName}`);
  }
  if (ip) {
    updates.ip = ip;
    changes.push(`IP: ${printer.ip} → ${ip}`);
  }
  if (serial) {
    updates.serial = serial;
    changes.push(`Serial: ${printer.serial} → ${serial}`);
  }
  if (accessCode) {
    updates.accessCode = accessCode;
    changes.push(`Code d'accès: ****`);
  }
  if (channel) {
    updates.forumChannelId = channel.id;
    changes.push(`Channel: <#${channel.id}>`);
  }

  if (changes.length === 0) {
    await interaction.editReply("⚠️ Aucune modification spécifiée");
    return;
  }

  // Appliquer les mises à jour
  const updated = updatePrinter(printerId, updates);

  if (!updated) {
    await interaction.editReply("❌ Impossible de mettre à jour l'imprimante");
    return;
  }

  logger.info({ printerId, changes }, "Printer updated via command");

  // Si le channel a changé, créer le tag dans le nouveau forum
  if (channel) {
    await ensurePrinterTag(channel.id, newName ?? printer.name);
  }

  await interaction.editReply(
    `✅ Imprimante **${newName ?? printer.name}** mise à jour\n\n` + changes.map(c => `• ${c}`).join("\n")
  );
};
