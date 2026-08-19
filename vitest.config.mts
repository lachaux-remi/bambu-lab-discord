import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "src/application.ts",
        "src/libs/project/**/*.ts",
        "src/libs/rtc/**/*.ts",
        "src/services/bambu-lab/**/*.ts",
        "src/services/database/**/*.ts",
        "src/services/discord/bot.ts",
        "src/services/discord/commands/index.ts",
        "src/services/printer-manager/**/*.ts",
        "src/services/printer-status/**/*.ts",
        "src/utils/**/*.ts"
      ],
      reporter: ["text", "html"],
      thresholds: {
        branches: 51.24,
        functions: 74.54,
        lines: 67.13,
        statements: 66.49,
        "src/application.ts": { branches: 100, functions: 100, lines: 100, statements: 100 },
        "src/libs/project/**": { branches: 93.58, functions: 100, lines: 99.27, statements: 99.29 },
        "src/libs/rtc/**": { branches: 75, functions: 90.9, lines: 88.52, statements: 88.52 },
        "src/services/bambu-lab/**": { branches: 47.72, functions: 55.55, lines: 58.18, statements: 57.14 },
        "src/services/database/**": { branches: 71.59, functions: 100, lines: 85.78, statements: 85.85 },
        "src/services/discord/bot.ts": { branches: 19.14, functions: 56.25, lines: 43.71, statements: 44.28 },
        "src/services/discord/commands/index.ts": {
          branches: 20.68,
          functions: 84.61,
          lines: 48.71,
          statements: 48.71
        },
        "src/services/printer-manager/**": { branches: 47.05, functions: 57.69, lines: 60.11, statements: 57.86 },
        "src/services/printer-status/**": { branches: 82.5, functions: 100, lines: 98, statements: 98 },
        "src/utils/**": { branches: 87.5, functions: 100, lines: 95.45, statements: 95.74 }
      }
    }
  }
});
