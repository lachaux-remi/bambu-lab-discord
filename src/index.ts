import { Application } from "./application";
import { getLogger } from "./libs/logger";
import { ConfigLoadError, getConfig } from "./services/database";
import { initDiscordClient, shutdownDiscordClient } from "./services/discord/bot";
import { registerCommands, setupCommandHandlers } from "./services/discord/commands";
import { printerManager } from "./services/printer-manager";

const logger = getLogger("Application");

const application = new Application({
  discord: {
    start: async () => {
      await initDiscordClient();
      try {
        await registerCommands();
        setupCommandHandlers();
      } catch (error) {
        await shutdownDiscordClient();
        throw error;
      }
    },
    stop: shutdownDiscordClient
  },
  printers: {
    start: () => printerManager.startAll(),
    stop: () => printerManager.stopAll()
  }
});

const main = async (): Promise<void> => {
  logger.info("🚀 Starting Bambu Lab Discord Bot...");
  getConfig();
  await application.start();
  logger.info("✅ Bot operational; Discord is ready and unavailable printers will reconnect automatically");
};

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  logger.info({ signal }, "Shutting down...");
  try {
    await application.stop();
    logger.info("Shutdown complete");
  } catch (error) {
    logger.error({ error }, "Failed to shut down cleanly");
    process.exitCode = 1;
  }
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

main().catch(async error => {
  if (error instanceof ConfigLoadError) {
    logger.fatal(
      { path: error.configPath, reason: error.reason, issues: error.issues },
      "Failed to load printer configuration; refusing to start"
    );
  } else {
    logger.error({ error }, "Failed to start bot");
  }
  process.exitCode = 1;
  await application.stop().catch(shutdownError => {
    logger.error({ error: shutdownError }, "Failed to clean up after startup error");
  });
});
