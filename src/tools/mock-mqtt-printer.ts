import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { getLogger } from "../libs/logger";
import { MockMqttPrinter } from "./mock-mqtt-printer/broker";
import { playScenario } from "./mock-mqtt-printer/player";
import { runScenario } from "./mock-mqtt-printer/runner";
import { loadScenario } from "./mock-mqtt-printer/scenario";
import type { DiscordE2EOptions } from "./mock-mqtt-printer/session";
import { startWebBenchServer } from "./mock-mqtt-printer/web-server";

const logger = getLogger("MQTT-MockPrinter");
const scenarioDirectory = join(process.cwd(), "scenarios", "mock-mqtt-printer");
const defaultScenarioPath = join(scenarioDirectory, "successful-print.json");
const e2eScenarioPath = join(scenarioDirectory, "discord-e2e-smoke.json");

interface CliOptions {
  discordE2E: boolean;
  help: boolean;
  host: string;
  mode: "ci" | "serve" | "web";
  port: number;
  scenarioPaths: string[];
  timeScale?: number;
}

const takeArgument = (arguments_: string[], index: number, option: string): string => {
  const value = arguments_[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
};

const parseCli = (arguments_: string[]): CliOptions => {
  const environmentPort = Number(process.env.PORT ?? "4173");
  if (!Number.isInteger(environmentPort) || environmentPort < 0 || environmentPort > 65_535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }
  const options: CliOptions = {
    discordE2E: false,
    help: false,
    host: "127.0.0.1",
    mode: "web",
    port: environmentPort,
    scenarioPaths: []
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    switch (argument) {
      case "--":
        break;
      case "--ci":
        options.mode = "ci";
        break;
      case "--serve":
        options.mode = "serve";
        break;
      case "--web":
        options.mode = "web";
        break;
      case "--discord-e2e":
        options.discordE2E = true;
        break;
      case "--all":
        options.mode = "ci";
        options.scenarioPaths = readdirSync(scenarioDirectory)
          .filter(file => file.endsWith(".json"))
          .sort()
          .map(file => join(scenarioDirectory, file));
        break;
      case "--scenario":
        options.scenarioPaths.push(resolve(takeArgument(arguments_, index, argument)));
        index += 1;
        break;
      case "--time-scale": {
        const value = Number(takeArgument(arguments_, index, argument));
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error("--time-scale must be greater than zero");
        }
        options.timeScale = value;
        index += 1;
        break;
      }
      case "--host":
        options.host = takeArgument(arguments_, index, argument);
        index += 1;
        break;
      case "--port": {
        const value = Number(takeArgument(arguments_, index, argument));
        if (!Number.isInteger(value) || value < 0 || value > 65_535) {
          throw new Error("--port must be an integer between 0 and 65535");
        }
        options.port = value;
        index += 1;
        break;
      }
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        if (!argument) {
          break;
        }
        if (argument.startsWith("--")) {
          throw new Error(`Unknown option ${argument}`);
        }
        options.scenarioPaths.push(resolve(argument));
    }
  }
  if (options.mode !== "web" && options.scenarioPaths.length === 0) {
    options.scenarioPaths.push(options.discordE2E ? e2eScenarioPath : defaultScenarioPath);
  }
  if (options.discordE2E && options.mode === "ci" && options.scenarioPaths.length !== 1) {
    throw new Error("--discord-e2e runs exactly one explicitly selected scenario");
  }
  return options;
};

const printHelp = (): void => {
  process.stdout.write(`Usage:
  pnpm run dev:mqtt-emulator
  pnpm run dev:mqtt-emulator -- --discord-e2e
  pnpm run dev:mqtt-emulator -- --serve [scenario.json]
  pnpm run test:mqtt-scenario -- [scenario.json]
  pnpm run test:mqtt-scenario -- --all
  pnpm run test:mqtt-scenario -- --discord-e2e [scenario.json]

Options:
  --web                Start the interactive web bench (default).
  --ci                 Run with the real BambuLabClient/PrinterManager and deterministic mock Discord.
  --serve              Serve the scenario to an external bot and replay it on each pushall.
  --all                Run every versioned JSON scenario with mock Discord.
  --discord-e2e        Explicitly use real Discord; requires MOCK_DISCORD_GUILD_ID and MOCK_DISCORD_FORUM_CHANNEL_ID.
  --host HOST          Bind the web UI (default: 127.0.0.1).
  --port PORT          Bind the web UI (default: PORT or 4173; 0 selects a free port).
  --time-scale NUMBER  Scale logical waits and the 60-second MQTT alert threshold (CI default: 0.01).
`);
};

const errorMessage = (error: unknown): string => {
  if (error instanceof AggregateError) {
    return Array.from(error.errors, errorMessage).join("; ");
  }
  return error instanceof Error ? error.message : "Unknown scenario error";
};

const getDiscordOptions = (enabled: boolean): DiscordE2EOptions | undefined => {
  if (!enabled) {
    return undefined;
  }
  const discord = {
    guildId: process.env.MOCK_DISCORD_GUILD_ID ?? "",
    forumChannelId: process.env.MOCK_DISCORD_FORUM_CHANNEL_ID ?? ""
  };
  if (!discord.guildId || !discord.forumChannelId) {
    throw new Error("Discord E2E requires MOCK_DISCORD_GUILD_ID and MOCK_DISCORD_FORUM_CHANNEL_ID");
  }
  return discord;
};

const runCi = async (options: CliOptions): Promise<void> => {
  const discord = getDiscordOptions(options.discordE2E);

  let failed = false;
  for (const path of options.scenarioPaths) {
    const scenario = loadScenario(path);
    try {
      const result = await runScenario(scenario, { timeScale: options.timeScale, ...(discord ? { discord } : {}) });
      process.stdout.write(`SCENARIO_RESULT ${JSON.stringify(result)}\n`);
    } catch (error) {
      failed = true;
      const result = { status: "failed", name: scenario.name, error: errorMessage(error) };
      process.stdout.write(`SCENARIO_RESULT ${JSON.stringify(result)}\n`);
    }
  }
  if (failed) {
    process.exitCode = 1;
  }
};

const startWeb = async (options: CliOptions): Promise<void> => {
  const discord = getDiscordOptions(options.discordE2E);
  const server = await startWebBenchServer({
    host: options.host,
    port: options.port,
    ...(discord ? { discord } : {})
  });
  logger.info(
    {
      address: `http://${server.host}:${server.port}`,
      discordE2EAvailable: options.discordE2E
    },
    "Interactive mock printer web bench ready"
  );

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void server
      .close()
      .then(() => {
        logger.info("Interactive mock printer web bench stopped");
      })
      .catch(error => {
        logger.error({ error }, "Interactive mock printer web bench shutdown failed");
        process.exitCode = 1;
      });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

const serve = async (options: CliOptions): Promise<void> => {
  const [path] = options.scenarioPaths;
  if (!path) {
    throw new Error("Serve mode requires one scenario");
  }
  const scenario = loadScenario(path);
  const printer = new MockMqttPrinter({
    host: process.env.MOCK_MQTT_HOST ?? "127.0.0.1",
    port: Number.parseInt(process.env.MOCK_MQTT_PORT ?? "1883", 10),
    serial: process.env.MOCK_PRINTER_SERIAL ?? "DEV_SERIAL",
    accessCode: process.env.MOCK_PRINTER_ACCESS_CODE ?? "mock-access-code"
  });
  let running = false;
  printer.onPushall(() => {
    if (running) {
      return;
    }
    running = true;
    void playScenario(scenario, printer, {
      timeScale: options.timeScale ?? 1,
      onStep: (index, action) => logger.info({ scenario: scenario.name, step: index + 1, action }, "Running step")
    })
      .then(result => logger.info({ scenario: scenario.name, ...result }, "Scenario completed; pushall will replay it"))
      .catch(error => logger.error({ error, scenario: scenario.name }, "Scenario failed"))
      .finally(() => {
        running = false;
      });
  });
  await printer.start();
  logger.info(
    {
      address: `mqtt://${printer.host}:${printer.port}`,
      serial: printer.serial,
      scenario: scenario.name
    },
    "Mock Bambu Lab MQTT printer ready"
  );

  const shutdown = (): void => {
    void printer.stop().then(() => {
      process.exitCode = 0;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

const main = async (): Promise<void> => {
  const options = parseCli(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.discordE2E && options.mode === "serve") {
    throw new Error("Discord E2E is available in web and deterministic CI modes, not external serve mode");
  }
  if (options.mode === "ci") {
    await runCi(options);
  } else if (options.mode === "serve") {
    await serve(options);
  } else {
    await startWeb(options);
  }
};

main().catch(error => {
  logger.error({ error }, "Mock MQTT printer failed");
  process.exitCode = 1;
});
