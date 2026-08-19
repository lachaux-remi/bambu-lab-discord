import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "src/application.ts",
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
        branches: 48,
        functions: 70,
        lines: 65,
        statements: 64,
        "src/application.ts": { branches: 100, functions: 100, lines: 100, statements: 100 },
        "src/libs/rtc/**": { branches: 75, functions: 90, lines: 88, statements: 88 },
        "src/services/bambu-lab/**": { branches: 47, functions: 55, lines: 58, statements: 57 },
        "src/services/database/**": { branches: 68, functions: 100, lines: 84, statements: 84 },
        "src/services/discord/bot.ts": { branches: 17, functions: 50, lines: 43, statements: 43 },
        "src/services/discord/commands/index.ts": { branches: 20, functions: 84, lines: 48, statements: 48 },
        "src/services/printer-manager/**": { branches: 43, functions: 46, lines: 55, statements: 52 },
        "src/services/printer-status/**": { branches: 82, functions: 100, lines: 98, statements: 98 },
        "src/utils/**": { branches: 87, functions: 100, lines: 95, statements: 95 }
      }
    }
  }
});
