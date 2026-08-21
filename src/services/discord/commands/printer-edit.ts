import { ChannelType, ChatInputCommandInteraction, MessageFlags } from "discord.js";

import { MAX_NETWORK_PORT, MIN_NETWORK_PORT } from "../../../constants";
import { getLogger } from "../../../libs/logger";
import type { PrinterConfig } from "../../../types/printer-config";
import { getPrinter, updatePrinter } from "../../database";
import { printerManager } from "../../printer-manager";
import { ensurePrinterTag } from "../bot";
import { PRINTER_OPTION } from "./contract";

const logger = getLogger("PrinterEdit");

export const handlePrinterEdit = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const printerId = interaction.options.getString(PRINTER_OPTION.NAME, true);

  const printer = getPrinter(printerId);
  if (!printer) {
    await interaction.reply({
      content: `❌ Imprimante **${printerId}** non trouvée`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  const wasRunning = printerManager.getPrinterStatus(printerId).running;

  const newName = interaction.options.getString(PRINTER_OPTION.NEW_NAME);
  const ip = interaction.options.getString(PRINTER_OPTION.IP);
  const serial = interaction.options.getString(PRINTER_OPTION.SERIAL);
  const accessCode = interaction.options.getString(PRINTER_OPTION.ACCESS_CODE);
  const channel = interaction.options.getChannel(PRINTER_OPTION.CHANNEL);
  const port = interaction.options.getInteger(PRINTER_OPTION.PORT);
  const rtcPort = interaction.options.getInteger(PRINTER_OPTION.RTC_PORT);
  const enabled = interaction.options.getBoolean(PRINTER_OPTION.ENABLED);

  // Vérifier si le channel est un forum
  if (channel && channel.type !== ChannelType.GuildForum) {
    await interaction.reply({
      content: "❌ Le channel doit être un **forum channel**",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const invalidPort = [port, rtcPort].find(
    value => value !== null && (value < MIN_NETWORK_PORT || value > MAX_NETWORK_PORT)
  );
  if (invalidPort !== undefined) {
    await interaction.reply({
      content: `❌ Les ports doivent être compris entre ${MIN_NETWORK_PORT} et ${MAX_NETWORK_PORT}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Construire les mises à jour
  const updates: Partial<PrinterConfig> = {};
  const changes: string[] = [];
  let runtimeConfigChanged = false;

  if (newName && newName !== printer.name) {
    updates.name = newName;
    changes.push(`Nom: ${printer.name} → ${newName}`);
    runtimeConfigChanged = true;
  }
  if (ip && ip !== printer.ip) {
    updates.ip = ip;
    changes.push(`IP: ${printer.ip} → ${ip}`);
    runtimeConfigChanged = true;
  }
  if (serial && serial !== printer.serial) {
    updates.serial = serial;
    changes.push(`Serial: ${printer.serial} → ${serial}`);
    runtimeConfigChanged = true;
  }
  if (accessCode && accessCode !== printer.accessCode) {
    updates.accessCode = accessCode;
    changes.push(`Code d'accès: ****`);
    runtimeConfigChanged = true;
  }
  if (channel && channel.id !== printer.forumChannelId) {
    updates.forumChannelId = channel.id;
    changes.push(`Channel: <#${channel.id}>`);
    runtimeConfigChanged = true;
  }
  if (port !== null && port !== printer.port) {
    updates.port = port;
    changes.push(`Port MQTT: ${printer.port} → ${port}`);
    runtimeConfigChanged = true;
  }
  if (rtcPort !== null && rtcPort !== printer.rtcPort) {
    updates.rtcPort = rtcPort;
    changes.push(`Port RTC: ${printer.rtcPort} → ${rtcPort}`);
    runtimeConfigChanged = true;
  }
  if (enabled !== null && enabled !== printer.enabled) {
    updates.enabled = enabled;
    changes.push(enabled ? "Imprimante activée" : "Imprimante désactivée");
  }

  if (changes.length === 0) {
    await interaction.editReply("⚠️ Aucune modification spécifiée");
    return;
  }

  if (updates.name || updates.forumChannelId) {
    const tagPreparation = await ensurePrinterTag(
      updates.forumChannelId ?? printer.forumChannelId,
      updates.name ?? printer.name
    );
    if (tagPreparation.status !== "ready") {
      await interaction.editReply(
        tagPreparation.status === "capacity"
          ? `❌ Le forum a atteint sa limite de ${tagPreparation.maximum} tags. Supprimez un tag avant de modifier l'imprimante.`
          : "❌ Impossible de préparer les tags du forum. La configuration de l'imprimante reste inchangée."
      );
      return;
    }
  }

  // Appliquer les mises à jour
  const updated = updatePrinter(printerId, updates);

  if (!updated) {
    await interaction.editReply("❌ Impossible de mettre à jour l'imprimante");
    return;
  }

  logger.info({ printerId, changes }, "Printer updated via command");

  let lifecycleSucceeded = true;
  try {
    if (!updated.enabled) {
      await printerManager.stopPrinter(printerId);
    } else if (!printer.enabled || !wasRunning) {
      lifecycleSucceeded = await printerManager.startPrinter(printerId);
    } else if (runtimeConfigChanged) {
      lifecycleSucceeded = await printerManager.restartPrinter(printerId);
    }
  } catch (error) {
    lifecycleSucceeded = false;
    logger.error({ error, printerId }, "Failed to apply printer lifecycle change");
  }

  if (!lifecycleSucceeded) {
    await interaction.editReply(
      `⚠️ Imprimante **${updated.name}** mise à jour, mais l'application immédiate de son état a échoué. Vérifiez sa configuration et sa disponibilité.`
    );
    return;
  }

  await interaction.editReply(
    `✅ Imprimante **${updated.name}** mise à jour\n\n` + changes.map(c => `• ${c}`).join("\n")
  );
};
