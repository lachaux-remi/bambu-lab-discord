import { EmbedBuilder, MessageFlags } from "discord.js";
import type { ChatInputCommandInteraction, InteractionReplyOptions } from "discord.js";

import { getAllPrinters } from "../../database";
import { printerManager } from "../../printer-manager";

const MAX_EMBED_FIELDS = 25;
const MAX_EMBED_TEXT_LENGTH = 5_800;
const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_MESSAGE_EMBED_TEXT_LENGTH = 6_000;
const MAX_FIELD_NAME_LENGTH = 256;
const MAX_FIELD_VALUE_LENGTH = 1_024;
const EMBED_TITLE = "🖨️ Imprimantes configurées";

interface PrinterField {
  inline: true;
  name: string;
  value: string;
}

const truncate = (value: string, maximum: number): string =>
  value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;

export const handlePrinterList = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const printers = getAllPrinters();

  if (printers.length === 0) {
    await interaction.reply({
      content: "📭 Aucune imprimante configurée\n\nUtilisez `/printer add` pour en ajouter une",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const pages: PrinterField[][] = [];
  let fields: PrinterField[] = [];
  let textLength = EMBED_TITLE.length;

  for (const printer of printers) {
    const status = printerManager.getPrinterStatus(printer.id);
    const statusEmoji = status.connected ? "🟢" : status.running ? "🟡" : "🔴";
    const enabledText = printer.enabled ? "" : " (désactivée)";
    const field: PrinterField = {
      name: truncate(`${statusEmoji} ${printer.name}${enabledText}`, MAX_FIELD_NAME_LENGTH),
      value: truncate(
        [`📍 \`${printer.ip}:${printer.port}\``, `🏷️ \`${printer.serial}\``, `📺 <#${printer.forumChannelId}>`].join(
          "\n"
        ),
        MAX_FIELD_VALUE_LENGTH
      ),
      inline: true
    };
    const fieldTextLength = field.name.length + field.value.length;

    if (fields.length === MAX_EMBED_FIELDS || textLength + fieldTextLength > MAX_EMBED_TEXT_LENGTH) {
      pages.push(fields);
      fields = [];
      textLength = EMBED_TITLE.length;
    }

    fields.push(field);
    textLength += fieldTextLength;
  }
  pages.push(fields);

  const embeds = pages.map((page, index) =>
    new EmbedBuilder()
      .setTitle(EMBED_TITLE)
      .setColor("#24a543")
      .addFields(page)
      .setFooter({ text: `Page ${index + 1}/${pages.length}` })
      .setTimestamp()
  );
  const batches: EmbedBuilder[][] = [];
  let batch: EmbedBuilder[] = [];
  let batchTextLength = 0;

  for (const [index, embed] of embeds.entries()) {
    const footerLength = `Page ${index + 1}/${pages.length}`.length;
    const embedTextLength =
      EMBED_TITLE.length +
      footerLength +
      pages[index].reduce((total, field) => total + field.name.length + field.value.length, 0);

    if (
      batch.length === MAX_EMBEDS_PER_MESSAGE ||
      (batch.length > 0 && batchTextLength + embedTextLength > MAX_MESSAGE_EMBED_TEXT_LENGTH)
    ) {
      batches.push(batch);
      batch = [];
      batchTextLength = 0;
    }

    batch.push(embed);
    batchTextLength += embedTextLength;
  }
  batches.push(batch);

  for (const [index, embeds] of batches.entries()) {
    const response = { embeds, flags: MessageFlags.Ephemeral } satisfies InteractionReplyOptions;
    if (index === 0) {
      await interaction.reply(response);
    } else {
      await interaction.followUp(response);
    }
  }
};
