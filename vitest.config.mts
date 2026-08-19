import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: [
        "src/libs/rtc/**/*.ts",
        "src/services/database/**/*.ts",
        "src/services/printer-status/**/*.ts",
        "src/utils/**/*.ts"
      ],
      reporter: ["text", "html"],
      thresholds: {
        branches: 75,
        functions: 90,
        lines: 85,
        statements: 85
      }
    }
  }
});
