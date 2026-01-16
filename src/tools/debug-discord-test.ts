import { EmbedBuilder } from "discord.js";

import { getLogger } from "../libs/logger";
import {
  createPrintThread,
  ensureForumTags,
  initDiscordClient,
  sendToThread,
  updateThreadTags
} from "../services/discord";

const logger = getLogger("DiscordTest");
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Forum channel ID for testing (set via env or hardcode for testing)
const TEST_FORUM_CHANNEL_ID = process.env.TEST_FORUM_CHANNEL_ID;

if (!TEST_FORUM_CHANNEL_ID) {
  console.error("Missing TEST_FORUM_CHANNEL_ID environment variable");
  process.exit(1);
}

(async () => {
  logger.info("Starting Discord debug test...");
  await initDiscordClient();

  // Wait a little for the client to become ready
  logger.info("Waiting for client to initialize (3s)...");
  await wait(3000);

  try {
    logger.info("Syncing forum tags...");
    const syncResult = await ensureForumTags(TEST_FORUM_CHANNEL_ID);
    logger.info({ syncResult }, "Sync result");
  } catch (err) {
    logger.error({ err }, "ensureForumTags failed");
  }

  const testTitle = `Test print multicolore ${Date.now()}`;
  const embed = new EmbedBuilder()
    .setTitle("Test de thread")
    .setDescription("Ceci est un test de création de thread/post de forum avec tags multicolore")
    .setTimestamp(new Date());

  logger.info("Creating thread/post with tags: En cours, Multicolore...");
  const threadId = await createPrintThread(
    `debug-${Date.now()}`,
    testTitle,
    embed,
    undefined,
    ["En cours", "Multicolore"],
    TEST_FORUM_CHANNEL_ID
  );

  if (!threadId) {
    logger.error("Échec de création du thread/post. Vérifie les logs et la configuration du bot.");
    process.exit(1);
  }

  logger.info({ threadId }, "Created thread/post");

  // Send a follow-up message into the thread
  const updateEmbed = new EmbedBuilder()
    .setTitle("Update test")
    .setDescription("Message envoyé dans le thread pour vérifier l'envoi")
    .setTimestamp(new Date());

  const sent = await sendToThread(threadId, updateEmbed);
  if (sent) {
    logger.info("Message envoyé dans le thread/post avec succès.");

    // Test tag update
    logger.info("Testing tag update: changing to Réussi, Monocolor...");
    await wait(2000);
    const tagUpdateResult = await updateThreadTags(threadId, ["Réussi", "Monocolor"]);
    if (tagUpdateResult) {
      logger.info("Tags mis à jour avec succès.");
    } else {
      logger.error("Échec de mise à jour des tags.");
    }

    process.exit(0);
  }

  logger.error("Échec de l'envoi du message dans le thread/post.");
  process.exit(2);
})();
