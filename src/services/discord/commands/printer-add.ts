import { ChannelType, ChatInputCommandInteraction } from "discord.js";

import { getLogger } from "../../../libs/logger";
import { addPrinter } from "../../database";
import { printerManager } from "../../printer-manager";
import { ensureForumTags, ensurePrinterTag } from "../bot";

const logger = getLogger("PrinterAdd");

export const handlePrinterAdd = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const name = interaction.options.getString("name", true);
  const ip = interaction.options.getString("ip", true);
  const serial = interaction.options.getString("serial", true);
  const accessCode = interaction.options.getString("access_code", true);
  const channel = interaction.options.getChannel("channel", true);
  const port = interaction.options.getInteger("port") ?? 8883;

  // Vérifier que c'est un forum channel
  if (channel.type !== ChannelType.GuildForum) {
    await interaction.reply({
      content: "❌ Le channel doit être un **forum channel**",
      ephemeral: true
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // Ajouter l'imprimante à la base de données
  const printer = addPrinter({
    name,
    ip,
    port,
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

  // S'assurer que les tags de base existent dans le forum
  await ensureForumTags(channel.id);

  // Créer le tag pour cette imprimante
  await ensurePrinterTag(channel.id, name);

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
        `Vérifiez la configuration et utilisez \`/printer start ${name}\``
    );
  }
};
