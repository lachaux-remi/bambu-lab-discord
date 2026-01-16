import { REST, Routes, SlashCommandBuilder } from "discord.js";

import { DISCORD_BOT_TOKEN } from "../../../constants";
import { getLogger } from "../../../libs/logger";
// Import handlers for start/stop/status
import { printerManager } from "../../printer-manager";
import { getDiscordClient } from "../bot";
import { handlePrinterAdd } from "./printer-add";
import { handlePrinterEdit } from "./printer-edit";
import { handlePrinterList } from "./printer-list";
import { handlePrinterRemove } from "./printer-remove";

const logger = getLogger("DiscordCommands");

const commands = [
  new SlashCommandBuilder()
    .setName("printer")
    .setDescription("Gérer les imprimantes")
    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription("Ajouter une nouvelle imprimante")
        .addStringOption(opt => opt.setName("name").setDescription("Nom de l'imprimante").setRequired(true))
        .addStringOption(opt => opt.setName("ip").setDescription("Adresse IP de l'imprimante").setRequired(true))
        .addStringOption(opt => opt.setName("serial").setDescription("Numéro de série").setRequired(true))
        .addStringOption(opt => opt.setName("access_code").setDescription("Code d'accès").setRequired(true))
        .addChannelOption(opt =>
          opt.setName("channel").setDescription("Forum channel pour les notifications").setRequired(true)
        )
        .addStringOption(opt => opt.setName("rtc_url").setDescription("URL du flux RTC (optionnel)").setRequired(false))
        .addIntegerOption(opt => opt.setName("port").setDescription("Port MQTT (défaut: 8883)").setRequired(false))
    )
    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription("Supprimer une imprimante")
        .addStringOption(opt =>
          opt.setName("name").setDescription("Nom de l'imprimante").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand(sub => sub.setName("list").setDescription("Lister toutes les imprimantes"))
    .addSubcommand(sub =>
      sub
        .setName("edit")
        .setDescription("Modifier une imprimante")
        .addStringOption(opt =>
          opt.setName("name").setDescription("Nom de l'imprimante").setRequired(true).setAutocomplete(true)
        )
        .addStringOption(opt => opt.setName("new_name").setDescription("Nouveau nom").setRequired(false))
        .addStringOption(opt => opt.setName("ip").setDescription("Nouvelle adresse IP").setRequired(false))
        .addStringOption(opt => opt.setName("serial").setDescription("Nouveau numéro de série").setRequired(false))
        .addStringOption(opt => opt.setName("access_code").setDescription("Nouveau code d'accès").setRequired(false))
        .addChannelOption(opt => opt.setName("channel").setDescription("Nouveau forum channel").setRequired(false))
        .addBooleanOption(opt =>
          opt.setName("enabled").setDescription("Activer/désactiver l'imprimante").setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("start")
        .setDescription("Démarrer une imprimante")
        .addStringOption(opt =>
          opt.setName("name").setDescription("Nom de l'imprimante").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("stop")
        .setDescription("Arrêter une imprimante")
        .addStringOption(opt =>
          opt.setName("name").setDescription("Nom de l'imprimante").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("Afficher le statut d'une imprimante")
        .addStringOption(opt =>
          opt.setName("name").setDescription("Nom de l'imprimante").setRequired(true).setAutocomplete(true)
        )
    )
].map(cmd => cmd.toJSON());

/**
 * Enregistre les commandes slash auprès de Discord
 */
export const registerCommands = async (): Promise<void> => {
  if (!DISCORD_BOT_TOKEN) {
    logger.warn("No Discord token, skipping command registration");
    return;
  }

  const client = getDiscordClient();
  if (!client?.user) {
    logger.warn("Discord client not ready, skipping command registration");
    return;
  }

  const rest = new REST().setToken(DISCORD_BOT_TOKEN);

  try {
    logger.info("🔄 Registering slash commands...");

    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

    logger.info("✅ Slash commands registered successfully");
  } catch (error) {
    logger.error({ error }, "Failed to register slash commands");
  }
};

/**
 * Configure les handlers pour les commandes
 */
export const setupCommandHandlers = (): void => {
  const client = getDiscordClient();
  if (!client) {
    return;
  }

  client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName !== "printer") {
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case "add":
          await handlePrinterAdd(interaction);
          break;
        case "remove":
          await handlePrinterRemove(interaction);
          break;
        case "list":
          await handlePrinterList(interaction);
          break;
        case "edit":
          await handlePrinterEdit(interaction);
          break;
        case "start":
          await handlePrinterStart(interaction);
          break;
        case "stop":
          await handlePrinterStop(interaction);
          break;
        case "status":
          await handlePrinterStatus(interaction);
          break;
        default:
          await interaction.reply({ content: "Commande inconnue", ephemeral: true });
      }
    } catch (error) {
      logger.error({ error, subcommand }, "Error handling command");
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Une erreur est survenue", ephemeral: true });
      }
    }
  });

  // Handle autocomplete
  client.on("interactionCreate", async interaction => {
    if (!interaction.isAutocomplete()) {
      return;
    }

    if (interaction.commandName !== "printer") {
      return;
    }

    const focusedOption = interaction.options.getFocused(true);
    if (focusedOption.name === "name") {
      const { getAllPrinters } = await import("../../database/index.js");
      const printers = getAllPrinters();
      const filtered = printers.filter((p: { name: string }) =>
        p.name.toLowerCase().includes(focusedOption.value.toLowerCase())
      );

      await interaction.respond(
        filtered.slice(0, 25).map((p: { name: string; id: string }) => ({ name: p.name, value: p.id }))
      );
    }
  });
};

const handlePrinterStart = async (interaction: import("discord.js").ChatInputCommandInteraction): Promise<void> => {
  const printerId = interaction.options.getString("name", true);

  await interaction.deferReply({ ephemeral: true });

  const success = await printerManager.startPrinter(printerId);

  if (success) {
    await interaction.editReply(`✅ Imprimante **${printerId}** démarrée`);
  } else {
    await interaction.editReply(`❌ Impossible de démarrer l'imprimante **${printerId}**`);
  }
};

const handlePrinterStop = async (interaction: import("discord.js").ChatInputCommandInteraction): Promise<void> => {
  const printerId = interaction.options.getString("name", true);

  const success = printerManager.stopPrinter(printerId);

  if (success) {
    await interaction.reply({ content: `✅ Imprimante **${printerId}** arrêtée`, ephemeral: true });
  } else {
    await interaction.reply({
      content: `❌ L'imprimante **${printerId}** n'est pas en cours d'exécution`,
      ephemeral: true
    });
  }
};

const handlePrinterStatus = async (interaction: import("discord.js").ChatInputCommandInteraction): Promise<void> => {
  const printerId = interaction.options.getString("name", true);

  const { getPrinter } = await import("../../database/index.js");
  const config = getPrinter(printerId);

  if (!config) {
    await interaction.reply({ content: `❌ Imprimante **${printerId}** non trouvée`, ephemeral: true });
    return;
  }

  const status = printerManager.getPrinterStatus(printerId);

  const statusEmoji = status.connected ? "🟢" : status.running ? "🟡" : "🔴";
  const statusText = status.connected ? "Connectée" : status.running ? "En cours de connexion..." : "Arrêtée";

  await interaction.reply({
    content: `**${config.name}** (${config.ip})\n${statusEmoji} ${statusText}`,
    ephemeral: true
  });
};
