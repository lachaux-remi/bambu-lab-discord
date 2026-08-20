import { ChatInputCommandInteraction, MessageFlags } from "discord.js";

import { ForumTag } from "../../../enums";
import { getPrinter } from "../../database";
import { printerManager } from "../../printer-manager";
import { createPrintThread } from "../bot";
import { createBaseEmbed } from "../embeds";

export const handlePrinterScreenshot = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const printerId = interaction.options.getString("name", true);
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
    .setTitle(`📸 Test de capture — ${printer.name}`)
    .setDescription("Notification de test générée manuellement depuis Discord.")
    .setImage("attachment://screenshot.jpg");
  const threadId = await createPrintThread(
    `camera-test:${printer.id}:${Date.now()}`,
    `📸 Test caméra — ${printer.name}`,
    embed,
    [{ name: "screenshot.jpg", buffer: screenshot }],
    [ForumTag.ATTENTION, printer.name],
    printer.forumChannelId
  );

  if (!threadId) {
    await interaction.editReply("❌ La capture a réussi, mais la notification n'a pas pu être créée dans le forum.");
    return;
  }

  await interaction.editReply(`✅ Notification de test créée dans <#${threadId}>.`);
};
