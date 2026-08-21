import { MessageFlags, PermissionFlagsBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";

import {
  DEFAULT_MQTT_PORT,
  DEFAULT_RTC_PORT,
  DISCORD_BOT_TOKEN,
  MAX_NETWORK_PORT,
  MIN_NETWORK_PORT
} from "../../../constants";
import { getLogger } from "../../../libs/logger";
import { getDiscordClient } from "../bot";
import { PRINTER_COMMAND_NAME, PRINTER_OPTION, PRINTER_SUBCOMMAND } from "./contract";
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
    .setName(PRINTER_COMMAND_NAME)
    .setDescription("Gérer les imprimantes")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub
        .setName(PRINTER_SUBCOMMAND.ADD)
        .setDescription("Ajouter une nouvelle imprimante")
        .addStringOption(opt =>
          opt.setName(PRINTER_OPTION.NAME).setDescription("Nom de l'imprimante").setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName(PRINTER_OPTION.IP).setDescription("Adresse IP de l'imprimante").setRequired(true)
        )
        .addStringOption(opt => opt.setName(PRINTER_OPTION.SERIAL).setDescription("Numéro de série").setRequired(true))
        .addStringOption(opt =>
          opt.setName(PRINTER_OPTION.ACCESS_CODE).setDescription("Code d'accès").setRequired(true)
        )
        .addChannelOption(opt =>
          opt.setName(PRINTER_OPTION.CHANNEL).setDescription("Forum channel pour les notifications").setRequired(true)
        )
        .addIntegerOption(opt =>
          opt
            .setName(PRINTER_OPTION.PORT)
            .setDescription(`Port MQTT (défaut: ${DEFAULT_MQTT_PORT})`)
            .setMinValue(MIN_NETWORK_PORT)
            .setMaxValue(MAX_NETWORK_PORT)
            .setRequired(false)
        )
        .addIntegerOption(opt =>
          opt
            .setName(PRINTER_OPTION.RTC_PORT)
            .setDescription(`Port RTC pour les captures d'écran (défaut: ${DEFAULT_RTC_PORT})`)
            .setMinValue(MIN_NETWORK_PORT)
            .setMaxValue(MAX_NETWORK_PORT)
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName(PRINTER_SUBCOMMAND.REMOVE)
        .setDescription("Supprimer une imprimante")
        .addStringOption(opt =>
          opt.setName(PRINTER_OPTION.NAME).setDescription("Nom de l'imprimante").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand(sub => sub.setName(PRINTER_SUBCOMMAND.LIST).setDescription("Lister toutes les imprimantes"))
    .addSubcommand(sub =>
      sub
        .setName(PRINTER_SUBCOMMAND.STATUS)
        .setDescription("Afficher l'état détaillé d'une imprimante")
        .addStringOption(opt =>
          opt.setName(PRINTER_OPTION.NAME).setDescription("Nom de l'imprimante").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName(PRINTER_SUBCOMMAND.RECONNECT)
        .setDescription("Forcer la reconnexion immédiate d'une imprimante")
        .addStringOption(opt =>
          opt.setName(PRINTER_OPTION.NAME).setDescription("Nom de l'imprimante").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName(PRINTER_SUBCOMMAND.SCREENSHOT)
        .setDescription("Créer une notification publique avec une capture caméra")
        .addStringOption(opt =>
          opt.setName(PRINTER_OPTION.NAME).setDescription("Nom de l'imprimante").setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName(PRINTER_SUBCOMMAND.EDIT)
        .setDescription("Modifier une imprimante")
        .addStringOption(opt =>
          opt.setName(PRINTER_OPTION.NAME).setDescription("Nom de l'imprimante").setRequired(true).setAutocomplete(true)
        )
        .addStringOption(opt => opt.setName(PRINTER_OPTION.NEW_NAME).setDescription("Nouveau nom").setRequired(false))
        .addStringOption(opt => opt.setName(PRINTER_OPTION.IP).setDescription("Nouvelle adresse IP").setRequired(false))
        .addStringOption(opt =>
          opt.setName(PRINTER_OPTION.SERIAL).setDescription("Nouveau numéro de série").setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName(PRINTER_OPTION.ACCESS_CODE).setDescription("Nouveau code d'accès").setRequired(false)
        )
        .addChannelOption(opt =>
          opt.setName(PRINTER_OPTION.CHANNEL).setDescription("Nouveau forum channel").setRequired(false)
        )
        .addIntegerOption(opt =>
          opt
            .setName(PRINTER_OPTION.PORT)
            .setDescription("Nouveau port MQTT")
            .setMinValue(MIN_NETWORK_PORT)
            .setMaxValue(MAX_NETWORK_PORT)
            .setRequired(false)
        )
        .addIntegerOption(opt =>
          opt
            .setName(PRINTER_OPTION.RTC_PORT)
            .setDescription("Nouveau port RTC pour les captures d'écran")
            .setMinValue(MIN_NETWORK_PORT)
            .setMaxValue(MAX_NETWORK_PORT)
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt.setName(PRINTER_OPTION.ENABLED).setDescription("Activer ou désactiver l'imprimante").setRequired(false)
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

const sendCommandError = async (
  interaction: ChatInputCommandInteraction,
  error: unknown,
  subcommand: string
): Promise<void> => {
  logger.error({ error, subcommand }, "Error handling command");

  try {
    if (interaction.replied) {
      await interaction.followUp({ content: "Une erreur est survenue", flags: MessageFlags.Ephemeral });
    } else if (interaction.deferred) {
      await interaction.editReply("Une erreur est survenue");
    } else {
      await interaction.reply({ content: "Une erreur est survenue", flags: MessageFlags.Ephemeral });
    }
  } catch (responseError) {
    logger.error({ error: responseError, commandError: error, subcommand }, "Failed to send command error response");
  }
};

const handleCommandInteraction = async (interaction: ChatInputCommandInteraction): Promise<void> => {
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
      case PRINTER_SUBCOMMAND.ADD:
        await handlePrinterAdd(interaction);
        break;
      case PRINTER_SUBCOMMAND.REMOVE:
        await handlePrinterRemove(interaction);
        break;
      case PRINTER_SUBCOMMAND.LIST:
        await handlePrinterList(interaction);
        break;
      case PRINTER_SUBCOMMAND.STATUS:
        await handlePrinterStatus(interaction);
        break;
      case PRINTER_SUBCOMMAND.RECONNECT:
        await handlePrinterReconnect(interaction);
        break;
      case PRINTER_SUBCOMMAND.EDIT:
        await handlePrinterEdit(interaction);
        break;
      case PRINTER_SUBCOMMAND.SCREENSHOT:
        await handlePrinterScreenshot(interaction);
        break;
      default:
        await interaction.reply({ content: "Commande inconnue", flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    await sendCommandError(interaction, error, subcommand);
  }
};

const handleAutocompleteInteraction = async (interaction: AutocompleteInteraction): Promise<void> => {
  try {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.respond([]);
      return;
    }

    const focusedOption = interaction.options.getFocused(true);
    if (focusedOption.name === PRINTER_OPTION.NAME) {
      const { getAllPrinters } = await import("../../database/index.js");
      const printers = getAllPrinters();
      const filtered = printers.filter((p: { name: string }) =>
        p.name.toLowerCase().includes(focusedOption.value.toLowerCase())
      );

      await interaction.respond(
        filtered.slice(0, 25).map((p: { name: string; id: string }) => ({ name: p.name, value: p.id }))
      );
    }
  } catch (error) {
    logger.error({ error }, "Error handling autocomplete");
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

  client.on("interactionCreate", interaction => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName !== PRINTER_COMMAND_NAME) {
      return;
    }

    void handleCommandInteraction(interaction).catch(error => {
      logger.error({ error }, "Unhandled command interaction failure");
    });
  });

  // Handle autocomplete
  client.on("interactionCreate", interaction => {
    if (!interaction.isAutocomplete()) {
      return;
    }

    if (interaction.commandName !== PRINTER_COMMAND_NAME) {
      return;
    }

    void handleAutocompleteInteraction(interaction).catch(error => {
      logger.error({ error }, "Unhandled autocomplete interaction failure");
    });
  });
};
