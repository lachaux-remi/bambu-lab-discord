/**
 * Configuration d'une imprimante Bambu Lab
 */
export interface PrinterConfig {
  /** Identifiant unique (slug) */
  id: string;
  /** Nom d'affichage */
  name: string;
  /** Adresse IP de l'imprimante */
  ip: string;
  /** Port MQTT (défaut: 8883) */
  port: number;
  /** Port RTC pour les captures d'écran (défaut: 6000) */
  rtcPort: number;
  /** Numéro de série de l'imprimante */
  serial: string;
  /** Code d'accès de l'imprimante */
  accessCode: string;
  /** ID du forum channel Discord où poster les threads */
  forumChannelId: string;
  /** Imprimante activée ou non */
  enabled: boolean;
  /** Date de création */
  createdAt: number;
  /** Date de dernière modification */
  updatedAt: number;
}

/**
 * Configuration complète du bot (stockée en JSON)
 */
export interface BotConfig {
  /** Version du schéma de configuration */
  version: number;
  /** Liste des imprimantes configurées */
  printers: Record<string, PrinterConfig>;
}
