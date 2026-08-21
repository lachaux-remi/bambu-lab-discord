import { ChannelType, ChatInputCommandInteraction, MessageFlags } from "discord.js";

import { DEFAULT_MQTT_PORT, DEFAULT_RTC_PORT } from "../../../constants";
import { getLogger } from "../../../libs/logger";
import { addPrinter } from "../../database";
import { printerManager } from "../../printer-manager";
import { ensurePrinterTag } from "../bot";
import { PRINTER_OPTION } from "./contract";

const logger = getLogger("PrinterAdd");

export const handlePrinterAdd = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const name = interaction.options.getString(PRINTER_OPTION.NAME, true);
  const ip = interaction.options.getString(PRINTER_OPTION.IP, true);
  const serial = interaction.options.getString(PRINTER_OPTION.SERIAL, true);
  const accessCode = interaction.options.getString(PRINTER_OPTION.ACCESS_CODE, true);
  const channel = interaction.options.getChannel(PRINTER_OPTION.CHANNEL, true);
  const port = interaction.options.getInteger(PRINTER_OPTION.PORT) ?? DEFAULT_MQTT_PORT;
  const rtcPort = interaction.options.getInteger(PRINTER_OPTION.RTC_PORT) ?? DEFAULT_RTC_PORT;

  // Vérifier que c'est un forum channel
  if (channel.type !== ChannelType.GuildForum) {
    await interaction.reply({
      content: "❌ Le channel doit être un **forum channel**",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const tagPreparation = await ensurePrinterTag(channel.id, name);
  if (tagPreparation.status !== "ready") {
    await interaction.editReply(
      tagPreparation.status === "capacity"
        ? `❌ Le forum a atteint sa limite de ${tagPreparation.maximum} tags. Supprimez un tag avant d'ajouter l'imprimante.`
        : "❌ Impossible de préparer les tags du forum. Aucune imprimante n'a été ajoutée."
    );
    return;
  }

  // Ajouter l'imprimante à la base de données
  const printer = addPrinter({
    name,
    ip,
    port,
    rtcPort,
    serial,
    accessCode,
    forumChannelId: channel.id,
    enabled: true
  });

  if (!printer) {
    await interaction.editReply("❌ Une imprimante avec ce nom existe déjà");
    return;
  }

  logger.info({ printerId: printer.id, name, ip }, "Printer added via command");

  // Démarrer l'imprimante automatiquement
  const started = await printerManager.startPrinter(printer.id);

  if (started) {
    await interaction.editReply(
      `✅ Imprimante **${name}** ajoutée et démarrée\n` +
        `📍 IP: \`${ip}:${port}\`\n` +
        `🏷️ Serial: \`${serial}\`\n` +
        `📺 Forum: <#${channel.id}>`
    );
  } else {
    await interaction.editReply(
      `⚠️ Imprimante **${name}** ajoutée mais impossible de la démarrer\n` +
        `Vérifiez la configuration réseau et redémarrez le bot.`
    );
  }
};
