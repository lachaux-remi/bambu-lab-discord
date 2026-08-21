import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { getLogger } from "../libs/logger";
import { MockMqttPrinter } from "./mock-mqtt-printer/broker";
import { playScenario } from "./mock-mqtt-printer/player";
import { runScenario } from "./mock-mqtt-printer/runner";
import { loadScenario } from "./mock-mqtt-printer/scenario";

const logger = getLogger("MQTT-MockPrinter");
const scenarioDirectory = join(process.cwd(), "scenarios", "mock-mqtt-printer");
const defaultScenarioPath = join(scenarioDirectory, "successful-print.json");
const e2eScenarioPath = join(scenarioDirectory, "discord-e2e-smoke.json");

interface CliOptions {
  discordE2E: boolean;
  help: boolean;
  mode: "ci" | "serve";
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
  const options: CliOptions = { discordE2E: false, help: false, mode: "serve", scenarioPaths: [] };
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
      case "--discord-e2e":
        options.discordE2E = true;
        options.mode = "ci";
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
  if (options.scenarioPaths.length === 0) {
    options.scenarioPaths.push(options.discordE2E ? e2eScenarioPath : defaultScenarioPath);
  }
  if (options.discordE2E && options.scenarioPaths.length !== 1) {
    throw new Error("--discord-e2e runs exactly one explicitly selected scenario");
  }
  return options;
};

const printHelp = (): void => {
  process.stdout.write(`Usage:
  pnpm run dev:mqtt-emulator -- --serve [scenario.json]
  pnpm run test:mqtt-scenario -- [scenario.json]
  pnpm run test:mqtt-scenario -- --all
  pnpm run test:mqtt-scenario -- --discord-e2e [scenario.json]

Options:
  --ci                 Run with the real BambuLabClient/PrinterManager and deterministic mock Discord.
  --serve              Serve the scenario to an external bot and replay it on each pushall.
  --all                Run every versioned JSON scenario with mock Discord.
  --discord-e2e        Explicitly use real Discord; requires MOCK_DISCORD_GUILD_ID and MOCK_DISCORD_FORUM_CHANNEL_ID.
  --time-scale NUMBER  Scale logical waits and the 60-second MQTT alert threshold (CI default: 0.01).
`);
};

const errorMessage = (error: unknown): string => {
  if (error instanceof AggregateError) {
    return Array.from(error.errors, errorMessage).join("; ");
  }
  return error instanceof Error ? error.message : "Unknown scenario error";
};

const runCi = async (options: CliOptions): Promise<void> => {
  const discord = options.discordE2E
    ? {
        guildId: process.env.MOCK_DISCORD_GUILD_ID ?? "",
        forumChannelId: process.env.MOCK_DISCORD_FORUM_CHANNEL_ID ?? ""
      }
    : undefined;
  if (discord && (!discord.guildId || !discord.forumChannelId)) {
    throw new Error("Discord E2E requires MOCK_DISCORD_GUILD_ID and MOCK_DISCORD_FORUM_CHANNEL_ID");
  }

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
  if (options.discordE2E && options.mode !== "ci") {
    throw new Error("Discord E2E is only available in deterministic CI mode");
  }
  if (options.mode === "ci") {
    await runCi(options);
  } else {
    await serve(options);
  }
};

main().catch(error => {
  logger.error({ error }, "Mock MQTT printer failed");
  process.exitCode = 1;
});
