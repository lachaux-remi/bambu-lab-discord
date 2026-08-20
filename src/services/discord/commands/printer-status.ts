import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from "discord.js";

import { PrintState } from "../../../enums";
import { formatMinuteToBestDisplay } from "../../../utils/time.util";
import { getPrinter } from "../../database";
import { printerManager } from "../../printer-manager";

const PRINT_STATE_LABELS: Record<PrintState, string> = {
  [PrintState.UNKNOWN]: "Inconnu",
  [PrintState.PREPARE]: "Préparation",
  [PrintState.RUNNING]: "Impression en cours",
  [PrintState.PAUSE]: "En pause",
  [PrintState.FAILED]: "Échec",
  [PrintState.FINISH]: "Terminée",
  [PrintState.IDLE]: "Inactive"
};

const displayNumber = (value: number | undefined, suffix = ""): string =>
  Number.isFinite(value) ? `${value}${suffix}` : "Non disponible";

export const handlePrinterStatus = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const printerId = interaction.options.getString("name", true);
  const printer = getPrinter(printerId);
  if (!printer) {
    await interaction.reply({
      content: `❌ Imprimante **${printerId}** non trouvée`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const status = printerManager.getPrinterStatus(printerId);
  const print = status.print;
  const layer = Number.isFinite(print?.currentLayer)
    ? `${print!.currentLayer}${Number.isFinite(print?.maxLayers) ? ` / ${print!.maxLayers}` : ""}`
    : "Non disponible";
  const remainingTime = Number.isFinite(print?.remainingTime)
    ? formatMinuteToBestDisplay(print!.remainingTime!)
    : "Non disponible";

  const embed = new EmbedBuilder()
    .setTitle(`🖨️ État de ${printer.name}`)
    .setColor(status.connected ? "#24a543" : status.running ? "#e5a50a" : "#c01c28")
    .addFields(
      {
        name: "Gestionnaire",
        value: printer.enabled ? (status.running ? "Démarré" : "Arrêté") : "Désactivée",
        inline: true
      },
      { name: "MQTT", value: status.connected ? "Connecté" : "Déconnecté", inline: true },
      { name: "État d'impression", value: print?.state ? PRINT_STATE_LABELS[print.state] : "Inconnu", inline: true },
      { name: "Projet", value: print?.project || "Non disponible", inline: true },
      { name: "Progression", value: displayNumber(print?.progressPercent, " %"), inline: true },
      { name: "Couche", value: layer, inline: true },
      { name: "Temps restant", value: remainingTime, inline: true }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
};
