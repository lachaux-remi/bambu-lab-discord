import { type APIEmbed, EmbedBuilder } from "discord.js";

import type { DiscordFileAttachment } from "../../types/discord";

export const DISCORD_ATTACHMENT_SIZE_LIMIT = 10 * 1024 * 1024;
export const DISCORD_EMBED_DESCRIPTION_LIMIT = 4_096;
export const DISCORD_EMBED_FIELD_VALUE_LIMIT = 1_024;
export const DISCORD_EMBED_FOOTER_LIMIT = 2_048;
export const DISCORD_EMBED_TEXT_LIMIT = 6_000;
export const DISCORD_EMBED_TITLE_LIMIT = 256;

const DISCORD_EMBED_AUTHOR_NAME_LIMIT = 256;
const DISCORD_EMBED_FIELD_COUNT_LIMIT = 25;
const DISCORD_EMBED_FIELD_NAME_LIMIT = 256;

interface MutableEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface NormalizedDiscordPayload {
  embed: EmbedBuilder;
  files: DiscordFileAttachment[];
  embedWasTruncated: boolean;
  omittedAttachmentSizes: number[];
}

const endsWithHighSurrogate = (value: string): boolean => {
  const finalCodeUnit = value.charCodeAt(value.length - 1);
  return finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff;
};

export const truncateDiscordText = (value: string, maximum: number, preservedSuffix?: string): string => {
  if (value.length <= maximum) {
    return value;
  }

  if (preservedSuffix && value.includes(preservedSuffix)) {
    const prefix = value.slice(0, value.lastIndexOf(preservedSuffix)).trimEnd();
    const separator = prefix ? " " : "";
    const availablePrefixLength = Math.max(0, maximum - preservedSuffix.length - separator.length);
    return `${truncateDiscordText(prefix, availablePrefixLength)}${separator}${preservedSuffix}`;
  }

  const truncated = value.slice(0, maximum);
  return endsWithHighSurrogate(truncated) ? truncated.slice(0, -1) : truncated;
};

export const discordEmbedTextLength = (embed: APIEmbed): number =>
  (embed.title?.length ?? 0) +
  (embed.description?.length ?? 0) +
  (embed.footer?.text.length ?? 0) +
  (embed.author?.name.length ?? 0) +
  (embed.fields ?? []).reduce((total, field) => total + field.name.length + field.value.length, 0);

const minimumNonEmptyLength = (value: string): number => (value.codePointAt(0)! > 0xffff ? 2 : 1);

const normalizeEmbed = (embed: APIEmbed, preservedFooterSuffix?: string): APIEmbed => {
  let title = embed.title ? truncateDiscordText(embed.title, DISCORD_EMBED_TITLE_LIMIT) : undefined;
  let description = embed.description
    ? truncateDiscordText(embed.description, DISCORD_EMBED_DESCRIPTION_LIMIT)
    : undefined;
  const footer = embed.footer
    ? {
        ...embed.footer,
        text: truncateDiscordText(embed.footer.text, DISCORD_EMBED_FOOTER_LIMIT, preservedFooterSuffix)
      }
    : undefined;
  const author = embed.author
    ? { ...embed.author, name: truncateDiscordText(embed.author.name, DISCORD_EMBED_AUTHOR_NAME_LIMIT) }
    : undefined;
  const fields: MutableEmbedField[] | undefined = embed.fields
    ?.slice(0, DISCORD_EMBED_FIELD_COUNT_LIMIT)
    .map(field => ({
      ...field,
      name: truncateDiscordText(field.name, DISCORD_EMBED_FIELD_NAME_LIMIT),
      value: truncateDiscordText(field.value, DISCORD_EMBED_FIELD_VALUE_LIMIT)
    }));

  const currentEmbed = (): APIEmbed => ({
    ...embed,
    title,
    description,
    footer,
    author,
    fields
  });
  let excess = discordEmbedTextLength(currentEmbed()) - DISCORD_EMBED_TEXT_LIMIT;
  const reduce = (value: string, minimum: number): string => {
    if (excess <= 0 || value.length <= minimum) {
      return value;
    }
    const next = truncateDiscordText(value, Math.max(minimum, value.length - excess));
    excess -= value.length - next.length;
    return next;
  };

  for (let index = (fields?.length ?? 0) - 1; index >= 0 && excess > 0; index -= 1) {
    const field = fields?.[index];
    if (field) {
      field.value = reduce(field.value, minimumNonEmptyLength(field.value));
    }
  }
  if (description) {
    description = reduce(description, 0) || undefined;
  }
  for (let index = (fields?.length ?? 0) - 1; index >= 0 && excess > 0; index -= 1) {
    const field = fields?.[index];
    if (field) {
      field.name = reduce(field.name, minimumNonEmptyLength(field.name));
    }
  }
  if (title) {
    title = reduce(title, 0) || undefined;
  }
  if (author && excess > 0) {
    author.name = reduce(author.name, minimumNonEmptyLength(author.name));
  }

  return currentEmbed();
};

const stripAttachmentReferences = (embed: APIEmbed, omittedNames: ReadonlySet<string>): APIEmbed => {
  const normalized = { ...embed };
  if (
    normalized.image?.url?.startsWith("attachment://") &&
    omittedNames.has(normalized.image.url.slice("attachment://".length))
  ) {
    delete normalized.image;
  }
  if (
    normalized.thumbnail?.url?.startsWith("attachment://") &&
    omittedNames.has(normalized.thumbnail.url.slice("attachment://".length))
  ) {
    delete normalized.thumbnail;
  }
  return normalized;
};

export const normalizeDiscordPayload = (
  embed: EmbedBuilder,
  files?: DiscordFileAttachment[],
  preservedFooterSuffix?: string
): NormalizedDiscordPayload => {
  const originalEmbed = embed.data;
  const normalizedFiles = (files ?? []).filter(
    file => file.buffer && file.buffer.length <= DISCORD_ATTACHMENT_SIZE_LIMIT
  );
  const acceptedNames = new Set(normalizedFiles.map(file => file.name));
  const omittedNames = new Set((files ?? []).filter(file => !acceptedNames.has(file.name)).map(file => file.name));
  const omittedAttachmentSizes = (files ?? []).flatMap(file =>
    file.buffer && file.buffer.length > DISCORD_ATTACHMENT_SIZE_LIMIT ? [file.buffer.length] : []
  );
  const normalizedEmbed = stripAttachmentReferences(normalizeEmbed(originalEmbed, preservedFooterSuffix), omittedNames);

  return {
    embed: EmbedBuilder.from(normalizedEmbed),
    files: normalizedFiles,
    embedWasTruncated:
      discordEmbedTextLength(normalizedEmbed) < discordEmbedTextLength(originalEmbed) ||
      (originalEmbed.fields?.length ?? 0) > DISCORD_EMBED_FIELD_COUNT_LIMIT,
    omittedAttachmentSizes
  };
};
