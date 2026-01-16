import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

import { getLogger } from "../../libs/logger";
import type { BotConfig, PrinterConfig } from "../../types/printer-config";

const logger = getLogger("Database");

const CONFIG_PATH = join(process.cwd(), "config", "printers.json");
const CONFIG_VERSION = 1;

/**
 * Configuration par défaut
 */
const DEFAULT_CONFIG: BotConfig = {
  version: CONFIG_VERSION,
  printers: {}
};

/**
 * Charge la configuration depuis le fichier JSON
 */
export const loadConfig = (): BotConfig => {
  try {
    if (!existsSync(CONFIG_PATH)) {
      logger.info("No config file found, creating default config");
      saveConfig(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }

    const data = readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(data) as BotConfig;
    logger.info({ printerCount: Object.keys(config.printers).length }, "Config loaded");
    return config;
  } catch (error) {
    logger.error({ error }, "Failed to load config, using default");
    return DEFAULT_CONFIG;
  }
};

/**
 * Sauvegarde la configuration dans le fichier JSON
 */
export const saveConfig = (config: BotConfig): boolean => {
  try {
    const dir = join(process.cwd(), "config");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
    logger.debug("Config saved");
    return true;
  } catch (error) {
    logger.error({ error }, "Failed to save config");
    return false;
  }
};

// État en mémoire
let currentConfig: BotConfig | null = null;

/**
 * Obtient la configuration actuelle (charge si nécessaire)
 */
export const getConfig = (): BotConfig => {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig;
};

/**
 * Génère un ID unique pour une imprimante à partir de son nom
 */
const generatePrinterId = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
};

/**
 * Ajoute une nouvelle imprimante
 */
export const addPrinter = (printer: Omit<PrinterConfig, "id" | "createdAt" | "updatedAt">): PrinterConfig | null => {
  const config = getConfig();
  const id = generatePrinterId(printer.name);

  if (config.printers[id]) {
    logger.error({ id }, "Printer with this ID already exists");
    return null;
  }

  const now = Date.now();
  const newPrinter: PrinterConfig = {
    ...printer,
    id,
    createdAt: now,
    updatedAt: now
  };

  config.printers[id] = newPrinter;

  if (saveConfig(config)) {
    logger.info({ id, name: printer.name }, "Printer added");
    return newPrinter;
  }

  return null;
};

/**
 * Supprime une imprimante
 */
export const removePrinter = (id: string): boolean => {
  const config = getConfig();

  if (!config.printers[id]) {
    logger.error({ id }, "Printer not found");
    return false;
  }

  const name = config.printers[id].name;
  delete config.printers[id];

  if (saveConfig(config)) {
    logger.info({ id, name }, "Printer removed");
    return true;
  }

  return false;
};

/**
 * Met à jour une imprimante
 */
export const updatePrinter = (id: string, updates: Partial<PrinterConfig>): PrinterConfig | null => {
  const config = getConfig();

  if (!config.printers[id]) {
    logger.error({ id }, "Printer not found");
    return null;
  }

  const updatedPrinter: PrinterConfig = {
    ...config.printers[id],
    ...updates,
    id, // Prevent ID change
    updatedAt: Date.now()
  };

  config.printers[id] = updatedPrinter;

  if (saveConfig(config)) {
    logger.info({ id }, "Printer updated");
    return updatedPrinter;
  }

  return null;
};

/**
 * Récupère une imprimante par son ID
 */
export const getPrinter = (id: string): PrinterConfig | null => {
  const config = getConfig();
  return config.printers[id] ?? null;
};

/**
 * Récupère toutes les imprimantes
 */
export const getAllPrinters = (): PrinterConfig[] => {
  const config = getConfig();
  return Object.values(config.printers);
};

/**
 * Récupère toutes les imprimantes activées
 */
export const getEnabledPrinters = (): PrinterConfig[] => {
  return getAllPrinters().filter(p => p.enabled);
};

/**
 * Recharge la configuration depuis le fichier
 */
export const reloadConfig = (): void => {
  currentConfig = loadConfig();
};
