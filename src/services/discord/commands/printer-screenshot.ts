import { ChatInputCommandInteraction, MessageFlags } from "discord.js";

import { SCREENSHOT_ATTACHMENT_NAME, SCREENSHOT_ATTACHMENT_URL } from "../../../constants";
import { ForumTag } from "../../../enums";
import { getPrinter } from "../../database";
import { printerManager } from "../../printer-manager";
import { createPrintThread } from "../bot";
import { createBaseEmbed } from "../embeds";
import { DISCORD_EMBED_TITLE_LIMIT, truncateDiscordText } from "../payload";
import { PRINTER_OPTION } from "./contract";

export const handlePrinterScreenshot = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const printerId = interaction.options.getString(PRINTER_OPTION.NAME, true);
  const printer = getPrinter(printerId);
  if (!printer) {
    await interaction.reply({
      content: `❌ Imprimante **${printerId}** non trouvée`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const screenshot = await printerManager.takeScreenshot(printerId);
  if (!screenshot) {
    await interaction.editReply(
      "❌ Impossible de capturer une image. Vérifiez la connexion, le port RTC et les logs TLS de l'imprimante."
    );
    return;
  }

  const embed = createBaseEmbed()
    .setTitle(truncateDiscordText(`📸 Test de capture — ${printer.name}`, DISCORD_EMBED_TITLE_LIMIT))
    .setDescription("Notification de test générée manuellement depuis Discord.")
    .setImage(SCREENSHOT_ATTACHMENT_URL);
  const threadId = await createPrintThread(
    `camera-test:${printer.id}:${Date.now()}`,
    `📸 Test caméra — ${printer.name}`,
    embed,
    [{ name: SCREENSHOT_ATTACHMENT_NAME, buffer: screenshot }],
    [ForumTag.ATTENTION, printer.name],
    printer.forumChannelId
  );

  if (!threadId) {
    await interaction.editReply("❌ La capture a réussi, mais la notification n'a pas pu être créée dans le forum.");
    return;
  }

  await interaction.editReply(`✅ Notification de test créée dans <#${threadId}>.`);
};
