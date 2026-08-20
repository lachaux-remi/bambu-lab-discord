import {
  AttachmentBuilder,
  ChannelType,
  Client,
  EmbedBuilder,
  ForumChannel,
  GatewayIntentBits,
  Message
} from "discord.js";

import { DISCORD_BOT_TOKEN, FORUM_TAG_DEFINITIONS } from "../../constants";
import { ForumTag } from "../../enums";
import { getLogger } from "../../libs/logger";
import type { DiscordFileAttachment, ForumTagPayload } from "../../types/discord";
import type { PrinterConfig } from "../../types/printer-config";

const logger = getLogger("DiscordBot");

let client: Client | null = null;

// Cache des forum channels déjà récupérés
const forumChannelCache: Map<string, ForumChannel> = new Map();
const forumMutationQueues: Map<string, Promise<void>> = new Map();

const normalizeTagName = (n: string) => n.trim().toLowerCase();

const queueForumMutation = async <T>(forumChannelId: string, mutation: () => Promise<T>): Promise<T> => {
  const previousMutation = forumMutationQueues.get(forumChannelId) ?? Promise.resolve();
  const operation = previousMutation.then(mutation, mutation);
  const queueTail = operation.then(
    () => undefined,
    () => undefined
  );
  forumMutationQueues.set(forumChannelId, queueTail);

  try {
    return await operation;
  } finally {
    if (forumMutationQueues.get(forumChannelId) === queueTail) {
      forumMutationQueues.delete(forumChannelId);
    }
  }
};

/**
 * Récupère les IDs des tags pour un forum donné
 */
const getTagIdsForNames = (forum: ForumChannel, names: string[]): string[] => {
  const available = forum.availableTags ?? [];
  const map = new Map(available.map(t => [normalizeTagName(t.name ?? ""), t.id]));
  const ids: string[] = [];
  for (const n of names) {
    const id = map.get(normalizeTagName(n));
    if (id) {
      ids.push(id);
    } else {
      logger.debug({ tag: n }, "Tag not found on forum (might be a printer tag to create)");
    }
  }
  return ids;
};

/**
 * Récupère un forum channel par son ID
 */
const getForumChannel = async (channelId: string): Promise<ForumChannel | null> => {
  if (!client) {
    return null;
  }

  // Check cache
  if (forumChannelCache.has(channelId)) {
    return forumChannelCache.get(channelId)!;
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || channel.type !== ChannelType.GuildForum) {
      logger.error({ channelId }, "Channel is not a forum channel");
      return null;
    }

    const forum = channel as ForumChannel;
    forumChannelCache.set(channelId, forum);
    return forum;
  } catch (error) {
    logger.error({ error, channelId }, "Failed to fetch forum channel");
    return null;
  }
};

const reconcileForumTagsUnlocked = async (
  forumChannelId: string,
  printerNames: readonly string[]
): Promise<{ created: string[]; removed: string[] }> => {
  const forum = await getForumChannel(forumChannelId);
  if (!forum) {
    return { created: [], removed: [] };
  }

  try {
    logger.info({ channelId: forumChannelId }, "🏷️  Synchronizing forum tags...");

    const existing = forum.availableTags ?? [];
    const desiredPayload: ForumTagPayload[] = existing.map(tag => ({
      id: tag.id,
      name: tag.name,
      moderated: tag.moderated,
      emoji: tag.emoji ? { id: tag.emoji.id, name: tag.emoji.name } : undefined
    }));
    const desiredTags = new Map<string, { name: string; emoji: string }>();
    for (const definition of FORUM_TAG_DEFINITIONS) {
      desiredTags.set(normalizeTagName(definition.name), definition);
    }
    for (const printerName of printerNames) {
      const name = printerName.trim();
      if (name) {
        desiredTags.set(normalizeTagName(name), { name, emoji: "🖨️" });
      }
    }

    const existingNames = new Set(existing.map(tag => normalizeTagName(tag.name ?? "")));
    const toCreate = Array.from(desiredTags.entries())
      .filter(([normalizedName]) => !existingNames.has(normalizedName))
      .map(([, tag]) => tag);

    for (const tag of toCreate) {
      desiredPayload.push({
        name: tag.name,
        moderated: true,
        emoji: { id: null, name: tag.emoji }
      });
    }

    if (toCreate.length === 0) {
      logger.info({ channelId: forumChannelId }, "✅ Forum tags already in sync");
      return { created: [], removed: [] };
    }

    const created = toCreate.map(tag => tag.name);
    logger.info({ created }, "📝 Applying tag changes...");
    await forum.edit({ availableTags: desiredPayload });

    forumChannelCache.delete(forumChannelId);

    logger.info({ created }, "✅ Forum tags synchronized");
    return { created, removed: [] };
  } catch (error) {
    logger.error({ error }, "❌ Failed to reconcile forum tags");
    return { created: [], removed: [] };
  }
};

export const ensureForumTags = async (forumChannelId: string): Promise<{ created: string[]; removed: string[] }> => {
  return queueForumMutation(forumChannelId, async () => {
    forumChannelCache.delete(forumChannelId);
    return reconcileForumTagsUnlocked(forumChannelId, []);
  });
};

/**
 * Réconcilie au démarrage les tags de chaque forum configuré sans toucher aux tags étrangers.
 */
export const reconcileConfiguredForumTags = async (printers: readonly PrinterConfig[]): Promise<void> => {
  const printerNamesByForum = new Map<string, string[]>();
  for (const printer of printers) {
    const printerNames = printerNamesByForum.get(printer.forumChannelId) ?? [];
    printerNames.push(printer.name);
    printerNamesByForum.set(printer.forumChannelId, printerNames);
  }

  await Promise.all(
    Array.from(printerNamesByForum, ([forumChannelId, printerNames]) =>
      queueForumMutation(forumChannelId, async () => {
        forumChannelCache.delete(forumChannelId);
        await reconcileForumTagsUnlocked(forumChannelId, printerNames);
      })
    )
  );
};

/**
 * Ajoute un tag d'imprimante à un forum
 */
const ensurePrinterTagUnlocked = async (forumChannelId: string, printerName: string): Promise<boolean> => {
  const forum = await getForumChannel(forumChannelId);
  if (!forum) {
    return false;
  }

  try {
    const existing = forum.availableTags ?? [];
    const normalizedName = normalizeTagName(printerName);

    // Check if tag already exists
    if (existing.some(t => normalizeTagName(t.name ?? "") === normalizedName)) {
      logger.debug({ printerName }, "Printer tag already exists");
      return true;
    }

    // Add the new printer tag
    const newPayload: ForumTagPayload[] = existing.map(t => ({
      id: t.id,
      name: t.name,
      moderated: t.moderated,
      emoji: t.emoji ? { id: t.emoji.id, name: t.emoji.name } : undefined
    }));

    newPayload.push({
      name: printerName,
      moderated: true,
      emoji: { id: null, name: "🖨️" }
    });

    await forum.edit({ availableTags: newPayload });

    // Refresh cache
    forumChannelCache.delete(forumChannelId);

    logger.info({ printerName, channelId: forumChannelId }, "✅ Printer tag created");
    return true;
  } catch (error) {
    logger.error({ error, printerName }, "Failed to create printer tag");
    return false;
  }
};

export const ensurePrinterTag = async (forumChannelId: string, printerName: string): Promise<boolean> => {
  return queueForumMutation(forumChannelId, async () => {
    forumChannelCache.delete(forumChannelId);
    return ensurePrinterTagUnlocked(forumChannelId, printerName);
  });
};

/**
 * Initialise le client Discord
 */
export const initDiscordClient = async (): Promise<void> => {
  if (!DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN is required");
  }

  client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

  client.on("clientReady", () => {
    logger.info({ tag: client?.user?.tag }, "Discord client ready");
  });

  client.on("error", error => logger.error({ error }, "Discord client error"));

  try {
    await client.login(DISCORD_BOT_TOKEN);
  } catch (error) {
    logger.error({ error }, "Failed to login Discord client");
    await client.destroy();
    client = null;
    throw error;
  }
};

export const shutdownDiscordClient = async (): Promise<void> => {
  const discordClient = client;
  client = null;

  await Promise.allSettled(forumMutationQueues.values());
  await discordClient?.destroy();
  forumChannelCache.clear();
  forumMutationQueues.clear();
};

/**
 * Crée un thread pour une impression
 */
export const createPrintThread = async (
  printKey: string,
  title: string,
  initialEmbed: EmbedBuilder,
  files?: DiscordFileAttachment[],
  tags?: string[],
  forumChannelId?: string
): Promise<string | null> => {
  if (!client) {
    logger.warn("Discord bot not initialized, cannot create thread");
    return null;
  }

  if (!forumChannelId) {
    logger.warn("No forum channel ID provided, cannot create thread");
    return null;
  }

  const forum = await getForumChannel(forumChannelId);
  if (!forum) {
    return null;
  }

  try {
    // Prepare attachments
    const attachments: AttachmentBuilder[] = [];
    if (files) {
      for (const f of files) {
        if (f.buffer) {
          attachments.push(new AttachmentBuilder(f.buffer, { name: f.name }));
        }
      }
    }

    const appliedTags =
      tags && tags.length ? getTagIdsForNames(forum, tags) : getTagIdsForNames(forum, [ForumTag.IN_PROGRESS]);

    const thread = await forum.threads.create({
      name: title,
      autoArchiveDuration: 10080,
      appliedTags: appliedTags.length ? appliedTags : undefined,
      message: { embeds: [initialEmbed], files: attachments.length ? attachments : undefined }
    });

    logger.info({ threadId: thread.id, printKey }, "Created forum post (thread) for print");
    return thread.id;
  } catch (error) {
    logger.error({ error }, "Failed to create thread");
    return null;
  }
};

export const isPrintThreadAvailable = async (threadId: string): Promise<boolean> => {
  if (!client) {
    return false;
  }

  try {
    const channel = await client.channels.fetch(threadId);
    return !!channel?.isThread();
  } catch (error) {
    logger.warn({ error, threadId }, "Persisted print thread is no longer available");
    return false;
  }
};

/**
 * Envoie un message dans un thread existant
 */
export const sendToThread = async (
  threadId: string,
  embed: EmbedBuilder,
  files?: DiscordFileAttachment[]
): Promise<Message | null> => {
  if (!client) {
    logger.warn("Discord bot not initialized, cannot send to thread");
    return null;
  }

  try {
    const channel = await client.channels.fetch(threadId);
    if (!channel || !channel.isThread()) {
      logger.warn({ threadId }, "Thread not found or channel is not a thread");
      return null;
    }

    const attachments: AttachmentBuilder[] = [];
    if (files) {
      for (const f of files) {
        if (f.buffer) {
          attachments.push(new AttachmentBuilder(f.buffer, { name: f.name }));
        }
      }
    }

    return await channel.send({
      embeds: [embed],
      files: attachments.length ? attachments : undefined
    });
  } catch (error) {
    logger.error({ error }, "Failed to send message to thread");
    return null;
  }
};

/**
 * Met à jour les tags d'un thread
 */
export const updateThreadTags = async (threadId: string, tagNames: string[]): Promise<boolean> => {
  if (!client) {
    logger.warn("Discord bot not initialized, cannot update thread tags");
    return false;
  }

  try {
    const thread = await client.channels.fetch(threadId);
    if (!thread || !thread.isThread()) {
      logger.warn({ threadId }, "Thread not found or channel is not a thread");
      return false;
    }

    // Get the parent forum
    const parentId = thread.parentId;
    if (!parentId) {
      logger.warn({ threadId }, "Thread has no parent");
      return false;
    }

    const forum = await getForumChannel(parentId);
    if (!forum) {
      return false;
    }

    const tagIds = getTagIdsForNames(forum, tagNames);

    if (tagIds.length === 0) {
      logger.warn({ tagNames }, "No valid tag IDs found for requested tags");
      return false;
    }

    await thread.setAppliedTags(tagIds);
    logger.debug({ threadId, tagNames }, "Updated thread tags");
    return true;
  } catch (error) {
    logger.error({ error, threadId, tagNames }, "Failed to update thread tags");
    return false;
  }
};

/**
 * Archive un thread
 */
export const archiveThread = async (threadId: string): Promise<boolean> => {
  if (!client) {
    return false;
  }
  try {
    const channel = await client.channels.fetch(threadId);
    if (!channel || !channel.isThread()) {
      return false;
    }
    await channel.setArchived(true);
    return true;
  } catch (error) {
    logger.error({ error }, "Failed to archive thread");
    return false;
  }
};

/**
 * Obtient le client Discord (pour les commandes slash)
 */
export const getDiscordClient = (): Client | null => {
  return client;
};
