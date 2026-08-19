import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { join } from "path";

import { getLogger } from "../../libs/logger";
import type { BotConfig, PrinterConfig } from "../../types/printer-config";

const logger = getLogger("Database");

const CONFIG_PATH = join(process.cwd(), "config", "printers.json");
const ACTIVE_THREADS_PATH = join(process.cwd(), "config", "active-threads.json");
const CONFIG_VERSION = 1;
const ENCRYPTED_VALUE_PREFIX = "enc:v1:";

export interface ActivePrintThread {
  threadId: string;
  updatedAt: number;
  project?: string;
}

type ActivePrintThreads = Record<string, ActivePrintThread>;

/**
 * Configuration par défaut
 */
const DEFAULT_CONFIG: BotConfig = {
  version: CONFIG_VERSION,
  printers: {}
};

const getEncryptionKey = (): Buffer | null => {
  const encodedKey = process.env.CONFIG_ENCRYPTION_KEY;
  if (!encodedKey) {
    return null;
  }

  if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) {
    throw new Error("CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }

  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }

  return key;
};

const getConfigEncryptionKey = (config: BotConfig): Buffer | null => {
  const encryptionKey = getEncryptionKey();
  if (!encryptionKey && Object.keys(config.printers).length > 0) {
    throw new Error("CONFIG_ENCRYPTION_KEY is required when printers are configured");
  }
  return encryptionKey;
};

const encryptAccessCode = (printerId: string, accessCode: string, key: Buffer | null): string => {
  if (!key) {
    return accessCode;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(printerId, "utf8"));
  const encrypted = Buffer.concat([cipher.update(accessCode, "utf8"), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();
  return `${ENCRYPTED_VALUE_PREFIX}${iv.toString("base64")}:${authenticationTag.toString("base64")}:${encrypted.toString("base64")}`;
};

const decryptAccessCode = (printerId: string, accessCode: string, key: Buffer | null): string => {
  if (!accessCode.startsWith(ENCRYPTED_VALUE_PREFIX)) {
    return accessCode;
  }

  if (!key) {
    throw new Error("CONFIG_ENCRYPTION_KEY is required to decrypt the printer configuration");
  }

  const parts = accessCode.slice(ENCRYPTED_VALUE_PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Encrypted printer access code has an invalid format");
  }

  const [encodedIv, encodedAuthenticationTag, encodedValue] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64"));
  decipher.setAAD(Buffer.from(printerId, "utf8"));
  decipher.setAuthTag(Buffer.from(encodedAuthenticationTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encodedValue, "base64")), decipher.final()]).toString("utf8");
};

const createPersistedConfig = (
  config: BotConfig,
  encryptionKey: Buffer | null,
  retainedAccessCodes: ReadonlyMap<string, string> = new Map()
): BotConfig => ({
  ...config,
  printers: Object.fromEntries(
    Object.entries(config.printers).map(([id, printer]) => [
      id,
      {
        ...printer,
        accessCode: retainedAccessCodes.get(id) ?? encryptAccessCode(id, printer.accessCode, encryptionKey)
      }
    ])
  )
});

function assertValidConfig(value: unknown): asserts value is BotConfig {
  if (!value || typeof value !== "object") {
    throw new Error("Printer configuration must be a JSON object");
  }

  const config = value as Partial<BotConfig>;
  if (config.version !== CONFIG_VERSION || !config.printers || typeof config.printers !== "object") {
    throw new Error(`Unsupported or invalid printer configuration (expected version ${CONFIG_VERSION})`);
  }

  for (const [id, printerValue] of Object.entries(config.printers)) {
    const printer = printerValue as Partial<PrinterConfig>;
    if (
      !printer ||
      printer.id !== id ||
      typeof printer.name !== "string" ||
      typeof printer.ip !== "string" ||
      typeof printer.serial !== "string" ||
      typeof printer.accessCode !== "string" ||
      typeof printer.forumChannelId !== "string" ||
      typeof printer.enabled !== "boolean" ||
      !Number.isInteger(printer.port) ||
      !Number.isInteger(printer.rtcPort)
    ) {
      throw new Error(`Invalid configuration for printer ${id}`);
    }
  }
}

const writeJsonAtomic = (path: string, value: unknown): void => {
  const dir = join(process.cwd(), "config");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  let fileDescriptor: number | undefined;
  try {
    fileDescriptor = openSync(temporaryPath, "w", 0o600);
    writeFileSync(fileDescriptor, JSON.stringify(value, null, 2), "utf8");
    fsyncSync(fileDescriptor);
    closeSync(fileDescriptor);
    fileDescriptor = undefined;
    renameSync(temporaryPath, path);
  } catch (error) {
    if (fileDescriptor !== undefined) {
      closeSync(fileDescriptor);
    }
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
    throw error;
  }
};

/**
 * Charge la configuration depuis le fichier JSON
 */
export const loadConfig = (): BotConfig => {
  if (!existsSync(CONFIG_PATH)) {
    logger.info("No config file found, creating default config");
    const defaultConfig = { ...DEFAULT_CONFIG, printers: {} };
    getConfigEncryptionKey(defaultConfig);
    if (!saveConfig(defaultConfig)) {
      throw new Error("Failed to create the default printer configuration");
    }
    return defaultConfig;
  }

  try {
    const data = readFileSync(CONFIG_PATH, "utf-8");
    const config: unknown = JSON.parse(data);
    assertValidConfig(config);

    const encryptionKey = getConfigEncryptionKey(config);
    const retainedAccessCodes = new Map<string, string>();
    let requiresEncryptionMigration = false;
    for (const [id, printer] of Object.entries(config.printers)) {
      if (printer.accessCode.startsWith(ENCRYPTED_VALUE_PREFIX)) {
        retainedAccessCodes.set(id, printer.accessCode);
      } else {
        requiresEncryptionMigration = true;
      }
      printer.accessCode = decryptAccessCode(id, printer.accessCode, encryptionKey);
    }

    if (requiresEncryptionMigration) {
      writeJsonAtomic(CONFIG_PATH, createPersistedConfig(config, encryptionKey, retainedAccessCodes));
      logger.info("Plaintext printer access codes migrated to encrypted storage");
    }

    logger.info({ printerCount: Object.keys(config.printers).length }, "Config loaded");
    return config;
  } catch (error) {
    logger.fatal(
      { error, path: CONFIG_PATH },
      "Failed to load printer configuration; refusing to use an empty default"
    );
    throw error;
  }
};

/**
 * Sauvegarde la configuration dans le fichier JSON
 */
export const saveConfig = (config: BotConfig): boolean => {
  try {
    const encryptionKey = getConfigEncryptionKey(config);
    writeJsonAtomic(CONFIG_PATH, createPersistedConfig(config, encryptionKey));
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

  const updatedConfig: BotConfig = {
    ...config,
    printers: { ...config.printers, [id]: newPrinter }
  };

  if (saveConfig(updatedConfig)) {
    currentConfig = updatedConfig;
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
  const printers = { ...config.printers };
  delete printers[id];
  const updatedConfig: BotConfig = { ...config, printers };

  if (saveConfig(updatedConfig)) {
    currentConfig = updatedConfig;
    removeActivePrintThread(id);
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

  const updatedConfig: BotConfig = {
    ...config,
    printers: { ...config.printers, [id]: updatedPrinter }
  };

  if (saveConfig(updatedConfig)) {
    currentConfig = updatedConfig;
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

let activePrintThreads: ActivePrintThreads | null = null;

const loadActivePrintThreads = (): ActivePrintThreads => {
  if (!existsSync(ACTIVE_THREADS_PATH)) {
    return {};
  }

  try {
    const value: unknown = JSON.parse(readFileSync(ACTIVE_THREADS_PATH, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Active thread state must be a JSON object");
    }

    const threads = value as ActivePrintThreads;
    for (const [printerId, thread] of Object.entries(threads)) {
      if (
        !thread ||
        typeof thread.threadId !== "string" ||
        !Number.isFinite(thread.updatedAt) ||
        (thread.project !== undefined && typeof thread.project !== "string")
      ) {
        throw new Error(`Invalid active thread state for printer ${printerId}`);
      }
    }
    return threads;
  } catch (error) {
    logger.error({ error, path: ACTIVE_THREADS_PATH }, "Failed to load active thread state; starting without recovery");
    return {};
  }
};

const getActivePrintThreads = (): ActivePrintThreads => {
  activePrintThreads ??= loadActivePrintThreads();
  return activePrintThreads;
};

export const getActivePrintThread = (printerId: string): ActivePrintThread | null => {
  return getActivePrintThreads()[printerId] ?? null;
};

export const setActivePrintThread = (printerId: string, threadId: string, project?: string): boolean => {
  const updatedThreads = {
    ...getActivePrintThreads(),
    [printerId]: { threadId, updatedAt: Date.now(), ...(project ? { project } : {}) }
  };

  try {
    writeJsonAtomic(ACTIVE_THREADS_PATH, updatedThreads);
    activePrintThreads = updatedThreads;
    return true;
  } catch (error) {
    logger.error({ error, printerId }, "Failed to persist active print thread");
    return false;
  }
};

export const removeActivePrintThread = (printerId: string): boolean => {
  const updatedThreads = { ...getActivePrintThreads() };
  if (!updatedThreads[printerId]) {
    return true;
  }

  delete updatedThreads[printerId];
  try {
    writeJsonAtomic(ACTIVE_THREADS_PATH, updatedThreads);
    activePrintThreads = updatedThreads;
    return true;
  } catch (error) {
    logger.error({ error, printerId }, "Failed to remove active print thread");
    return false;
  }
};
