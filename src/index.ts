import { getLogger } from "./libs/logger";
import { initDiscordClient } from "./services/discord/bot";
import { registerCommands, setupCommandHandlers } from "./services/discord/commands";
import { printerManager } from "./services/printer-manager";

const logger = getLogger("Application");

const main = async () => {
  logger.info("🚀 Starting Bambu Lab Discord Bot...");

  // Initialize Discord client
  await initDiscordClient();

  // Wait a bit for the client to be ready
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Register slash commands
  await registerCommands();

  // Setup command handlers
  setupCommandHandlers();

  // Start all enabled printers
  await printerManager.startAll();

  logger.info("✅ Bot started successfully");

  // Graceful shutdown
  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    printerManager.stopAll();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.info("Shutting down...");
    printerManager.stopAll();
    process.exit(0);
  });
};

main().catch(error => {
  logger.error({ error }, "Failed to start bot");
  process.exit(1);
});
