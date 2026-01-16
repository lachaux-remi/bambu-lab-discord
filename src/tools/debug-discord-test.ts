import { EmbedBuilder } from "discord.js";

import { initDiscordClient, sendToThread, syncForumTags, updateThreadTags } from "../libs/discord";
import { createPrintThread } from "../libs/discord/bot";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  console.warn("[debug] Starting Discord debug test...");
  await initDiscordClient();

  // Wait a little for the client to become ready and parent channel to be set
  console.warn("[debug] Waiting for client to initialize (3s)...");
  await wait(3000);

  try {
    console.warn("[debug] Syncing forum tags (will create/remove tags as needed)...");
    const syncResult = await syncForumTags();
    console.warn("[debug] Sync result:", syncResult);
  } catch (err) {
    console.error("[debug] syncForumTags failed:", err);
  }

  const testTitle = `Test print multicolore ${Date.now()}`;
  const embed = new EmbedBuilder()
    .setTitle("Test de thread")
    .setDescription("Ceci est un test de création de thread/post de forum avec tags multicolore")
    .setTimestamp(new Date());

  console.warn("[debug] Creating thread/post with tags: En cours, Multicolore...");
  const threadId = await createPrintThread(`debug-${Date.now()}`, testTitle, embed, undefined, [
    "En cours",
    "Multicolore"
  ]);

  if (!threadId) {
    console.error("[debug] Échec de création du thread/post. Vérifie les logs et la configuration du bot.");
    process.exit(1);
  }

  console.warn(`[debug] Created thread/post with id: ${threadId}`);

  // Send a follow-up message into the thread
  const updateEmbed = new EmbedBuilder()
    .setTitle("Update test")
    .setDescription("Message envoyé dans le thread pour vérifier l'envoi")
    .setTimestamp(new Date());

  const sent = await sendToThread(threadId, updateEmbed);
  if (sent) {
    console.warn("[debug] Message envoyé dans le thread/post avec succès.");

    // Test tag update
    console.warn("[debug] Testing tag update: changing to Réussi, Monocolor...");
    await wait(2000);
    const tagUpdateResult = await updateThreadTags(threadId, ["Réussi", "Monocolor"]);
    if (tagUpdateResult) {
      console.warn("[debug] Tags mis à jour avec succès.");
    } else {
      console.error("[debug] Échec de mise à jour des tags.");
    }

    process.exit(0);
  }

  console.error("[debug] Échec de l'envoi du message dans le thread/post.");
  process.exit(2);
})();
