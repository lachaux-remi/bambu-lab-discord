import { MessageFlags, PermissionFlagsBits, REST, Routes, SlashCommandBuilder } from "discord.js";

import {
  DEFAULT_MQTT_PORT,
  DEFAULT_RTC_PORT,
  DISCORD_BOT_TOKEN,
  MAX_NETWORK_PORT,
  MIN_NETWORK_PORT
} from "../../../constants";
import { getLogger } from "../../../libs/logger";
import { getDiscordClient } from "../bot";
import { handlePrinterAdd } from "./printer-add";
import { handlePrinterEdit } from "./printer-edit";
import { handlePrinterList } from "./printer-list";
import { handlePrinterReconnect } from "./printer-reconnect";
import { handlePrinterRemove } from "./printer-remove";
import { handlePrinterScreenshot } from "./printer-screenshot";
import { handlePrinterStatus } from "./printer-status";

const logger = getLogger("DiscordCommands");

const commands = [
  new SlashCommandBuilder()
    .setName("printer")
    .setDescription("Gérer les imprimantes")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
        .addIntegerOption(opt =>
          opt
            .setName("port")
            .setDescription(`Port MQTT (défaut: ${DEFAULT_MQTT_PORT})`)
            .setMinValue(MIN_NETWORK_PORT)
            .setMaxValue(MAX_NETWORK_PORT)
            .setRequired(false)
        )
        .addIntegerOption(opt =>
          opt
            .setName("rtc_port")
            .setDescription(`Port RTC pour les captures d'écran (défaut: ${DEFAULT_RTC_PORT})`)
            .setMinValue(MIN_NETWORK_PORT)
            .setMaxValue(MAX_NETWORK_PORT)
            .setRequired(false)
        )
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
        .setName("status")
        .setDescription("Afficher l'état détaillé d'une imprimante")
        .addStringOption(opt =>
          opt.setName("name").setDescription("Nom de l'imprimante").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("reconnect")
        .setDescription("Forcer la reconnexion immédiate d'une imprimante")
        .addStringOption(opt =>
          opt.setName("name").setDescription("Nom de l'imprimante").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("screenshot")
        .setDescription("Créer une notification publique avec une capture caméra")
        .addStringOption(opt =>
          opt.setName("name").setDescription("Nom de l'imprimante").setRequired(true).setAutocomplete(true)
        )
    )
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
        .addIntegerOption(opt =>
          opt
            .setName("port")
            .setDescription("Nouveau port MQTT")
            .setMinValue(MIN_NETWORK_PORT)
            .setMaxValue(MAX_NETWORK_PORT)
            .setRequired(false)
        )
        .addIntegerOption(opt =>
          opt
            .setName("rtc_port")
            .setDescription("Nouveau port RTC pour les captures d'écran")
            .setMinValue(MIN_NETWORK_PORT)
            .setMaxValue(MAX_NETWORK_PORT)
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt.setName("enabled").setDescription("Activer ou désactiver l'imprimante").setRequired(false)
        )
    )
].map(cmd => cmd.toJSON());

/**
 * Enregistre les commandes slash auprès de Discord
 */
export const registerCommands = async (): Promise<void> => {
  if (!DISCORD_BOT_TOKEN) {
    throw new Error("DISCORD_BOT_TOKEN is required to register commands");
  }

  const client = getDiscordClient();
  if (!client?.user) {
    throw new Error("Discord client is not ready to register commands");
  }

  const rest = new REST().setToken(DISCORD_BOT_TOKEN);

  try {
    logger.info("🔄 Registering slash commands...");

    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });

    logger.info("✅ Slash commands registered successfully");
  } catch (error) {
    logger.error({ error }, "Failed to register slash commands");
    throw error;
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

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: "❌ Vous devez avoir la permission **Gérer le serveur** pour utiliser cette commande.",
        flags: MessageFlags.Ephemeral
      });
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
        case "status":
          await handlePrinterStatus(interaction);
          break;
        case "reconnect":
          await handlePrinterReconnect(interaction);
          break;
        case "edit":
          await handlePrinterEdit(interaction);
          break;
        case "screenshot":
          await handlePrinterScreenshot(interaction);
          break;
        default:
          await interaction.reply({ content: "Commande inconnue", flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
      logger.error({ error, subcommand }, "Error handling command");
      if (interaction.replied) {
        await interaction.followUp({ content: "Une erreur est survenue", flags: MessageFlags.Ephemeral });
      } else if (interaction.deferred) {
        await interaction.editReply("Une erreur est survenue");
      } else {
        await interaction.reply({ content: "Une erreur est survenue", flags: MessageFlags.Ephemeral });
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

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.respond([]);
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
