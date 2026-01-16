import {
  AttachmentBuilder,
  ChannelType,
  Client,
  EmbedBuilder,
  ForumChannel,
  GatewayIntentBits,
  Message,
  TextChannel
} from "discord.js";

import { DISCORD_BOT_TOKEN, DISCORD_PARENT_CHANNEL_ID, FORUM_TAG_DEFINITIONS } from "../../constants";
import type { DiscordFileAttachment, ForumTagPayload } from "../../types/discord";
import { getLogger } from "../logger";

const logger = getLogger("DiscordBot");

let client: Client | null = null;
let parentChannel: TextChannel | ForumChannel | null = null;
let parentIsForum = false;

const normalizeTagName = (n: string) => n.trim().toLowerCase();

const getTagIdsForNames = (forum: ForumChannel, names: string[]) => {
  const available = forum.availableTags ?? [];
  const map = new Map(available.map(t => [normalizeTagName(t.name ?? ""), t.id]));
  const ids: string[] = [];
  for (const n of names) {
    const id = map.get(normalizeTagName(n));
    if (id) {
      ids.push(id);
    } else {
      logger.warn({ tag: n }, "Requested tag not found on forum");
    }
  }
  return ids;
};

export const ensureForumTags = async (forum: ForumChannel) => {
  try {
    // Always run sync when called — caller controls whether to call at startup
    logger.info("🏷️  Synchronizing forum tags...");

    // existing tags
    const existing = forum.availableTags ?? [];

    // Build desired payload exactly equal to FORUM_TAG_DEFINITIONS order
    const desiredPayload: ForumTagPayload[] = FORUM_TAG_DEFINITIONS.map(d => ({
      id: undefined,
      name: d.name,
      moderated: d.moderated ?? false,
      emoji: { id: null, name: d.emoji }
    }));

    // Compute diffs for logging
    const desiredNames = new Set(FORUM_TAG_DEFINITIONS.map(d => normalizeTagName(d.name)));
    const existingNames = new Set(existing.map(t => normalizeTagName(t.name ?? "")));

    const toCreate = FORUM_TAG_DEFINITIONS.filter(d => !existingNames.has(normalizeTagName(d.name))).map(d => d.name);
    const toRemove = existing.filter(t => !desiredNames.has(normalizeTagName(t.name ?? ""))).map(t => t.name);

    // If nothing to change, skip edit
    if (toCreate.length === 0 && toRemove.length === 0) {
      logger.info(
        `✅ Forum tags already in sync (${FORUM_TAG_DEFINITIONS.length} tags: ${FORUM_TAG_DEFINITIONS.map(d => `${d.emoji} ${d.name}`).join(", ")})`
      );
      return { created: [], removed: [] };
    }

    logger.info({ toCreate, toRemove }, "📝 Applying tag changes...");

    // Apply full sync by editing availableTags
    await forum.edit({ availableTags: desiredPayload });

    logger.info(
      {
        created: toCreate.length > 0 ? toCreate : undefined,
        removed: toRemove.length > 0 ? toRemove : undefined,
        total: FORUM_TAG_DEFINITIONS.length
      },
      `✅ Forum tags synchronized successfully! Total: ${FORUM_TAG_DEFINITIONS.length} tags`
    );

    if (toCreate.length > 0) {
      logger.info(`   ➕ Created: ${toCreate.map(t => `"${t}"`).join(", ")}`);
    }
    if (toRemove.length > 0) {
      logger.info(`   ➖ Removed: ${toRemove.map(t => `"${t}"`).join(", ")}`);
    }

    return { created: toCreate, removed: toRemove };
  } catch (error) {
    logger.error({ error }, "❌ Failed to ensure forum tags");
    return { created: [], removed: [], error: String(error) };
  }
};

export const initDiscordClient = async (): Promise<void> => {
  if (!DISCORD_BOT_TOKEN || !DISCORD_PARENT_CHANNEL_ID) {
    logger.warn("Discord bot token or parent channel id missing; bot will remain disabled");
    return;
  }

  client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

  let readyHandled = false;
  const onClientReady = async () => {
    if (readyHandled) {
      return;
    }
    readyHandled = true;

    logger.info({ tag: client?.user?.tag }, "Discord client ready");
    try {
      const channel = await client!.channels.fetch(DISCORD_PARENT_CHANNEL_ID);
      if (!channel) {
        logger.error({ channelId: DISCORD_PARENT_CHANNEL_ID }, "Configured parent channel not found");
        return;
      }

      // Detect forum channel explicitly
      if (channel.type === ChannelType.GuildForum) {
        // For forum channels, create posts via forum.threads.create
        parentIsForum = true;
        parentChannel = channel as ForumChannel;
        logger.info({ channelId: DISCORD_PARENT_CHANNEL_ID }, "✅ Parent forum channel detected and configured");

        // Ensure tags if enabled
        logger.info("🔧 Auto-create tags - synchronizing tags now...");
        await ensureForumTags(parentChannel as ForumChannel);

        return;
      }

      // Accept regular text channels as well
      if (channel.isTextBased()) {
        parentIsForum = false;
        parentChannel = channel as TextChannel;
        logger.info({ channelId: DISCORD_PARENT_CHANNEL_ID }, "Parent text channel set for threads");
        return;
      }

      logger.error(
        { channelId: DISCORD_PARENT_CHANNEL_ID, channelType: channel.type },
        "Configured parent channel is not a text or forum channel"
      );
    } catch (err) {
      logger.error({ err }, "Failed to fetch parent channel");
    }
  };

  // Prefer the new event name; also attach to 'ready' for compatibility but use guard to run handler only once
  client.on("clientReady", onClientReady);

  client.on("error", error => logger.error({ error }, "Discord client error"));

  await client.login(DISCORD_BOT_TOKEN).catch(error => {
    logger.error({ error }, "Failed to login Discord client");
  });
};

export const createPrintThread = async (
  printKey: string,
  title: string,
  initialEmbed: EmbedBuilder,
  files?: DiscordFileAttachment[],
  tags?: string[]
): Promise<string | null> => {
  if (!client || !parentChannel) {
    logger.warn("Discord bot not initialized or parent channel missing, cannot create thread");
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

    if (parentIsForum) {
      const forum = parentChannel as ForumChannel;

      const appliedTags = tags && tags.length ? getTagIdsForNames(forum, tags) : getTagIdsForNames(forum, ["En cours"]);

      // Create a forum post (thread) with an initial message containing the embed and applied tags
      const thread = await forum.threads.create({
        name: title,
        autoArchiveDuration: 10080,
        appliedTags: appliedTags.length ? appliedTags : undefined,
        message: { embeds: [initialEmbed], files: attachments.length ? attachments : undefined }
      });

      const threadId = thread.id;
      logger.info({ threadId, printKey }, "Created forum post (thread) for print");
      return threadId;
    }

    // Otherwise, for normal text channels, create a starter message and start a thread from it
    const starterMessage: Message = await (parentChannel as TextChannel).send({
      embeds: [initialEmbed],
      files: attachments.length ? attachments : undefined
    });

    const thread = await starterMessage.startThread({ name: title, autoArchiveDuration: 10080 /* 7 days */ });

    logger.info({ threadId: thread.id, printKey }, "Created thread for print");
    return thread.id;
  } catch (error) {
    logger.error({ error }, "Failed to create thread");
    return null;
  }
};

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

export const syncForumTags = async () => {
  if (!parentChannel || !parentIsForum) {
    logger.warn("No forum parent channel available to sync tags");
    return { created: [], removed: [], skipped: true };
  }
  return await ensureForumTags(parentChannel as ForumChannel);
};

export const updateThreadTags = async (threadId: string, tagNames: string[]): Promise<boolean> => {
  if (!client || !parentChannel || !parentIsForum) {
    logger.warn("Discord bot not initialized or not a forum channel, cannot update thread tags");
    return false;
  }

  try {
    const forum = parentChannel as ForumChannel;
    const thread = await client.channels.fetch(threadId);

    if (!thread || !thread.isThread()) {
      logger.warn({ threadId }, "Thread not found or channel is not a thread");
      return false;
    }

    // Récupérer les IDs des tags demandés
    const tagIds = getTagIdsForNames(forum, tagNames);

    if (tagIds.length === 0) {
      logger.warn({ tagNames }, "No valid tag IDs found for requested tags");
      return false;
    }

    // Mettre à jour les tags du thread
    await thread.setAppliedTags(tagIds);
    logger.info({ threadId, tagNames, tagIds }, "Updated thread tags");
    return true;
  } catch (error) {
    logger.error({ error, threadId, tagNames }, "Failed to update thread tags");
    return false;
  }
};
