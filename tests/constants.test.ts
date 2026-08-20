import { afterEach, describe, expect, it, vi } from "vitest";

describe("numeric environment settings", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses defaults when Compose injects empty values", async () => {
    vi.stubEnv("NOTIFICATION_PERCENT", "");
    vi.stubEnv("ERROR_LOG_COOLDOWN_MINUTES", "   ");
    vi.stubEnv("CHAMBER_LIGHT_OFF_DELAY_MINUTES", "");
    vi.stubEnv("CHAMBER_LIGHT_WARMUP_MS", "");

    const settings = await import("../src/constants");

    expect(settings.NOTIFICATION_PERCENT).toBe(5);
    expect(settings.ERROR_LOG_COOLDOWN_MS).toBe(60_000);
    expect(settings.CHAMBER_LIGHT_OFF_DELAY_MS).toBe(300_000);
    expect(settings.CHAMBER_LIGHT_WARMUP_MS).toBe(1_500);
  });

  it("preserves explicit zero values only for settings that support them", async () => {
    vi.stubEnv("ERROR_LOG_COOLDOWN_MINUTES", "0");
    vi.stubEnv("CHAMBER_LIGHT_OFF_DELAY_MINUTES", "0");
    vi.stubEnv("CHAMBER_LIGHT_WARMUP_MS", "0");

    const settings = await import("../src/constants");

    expect(settings.ERROR_LOG_COOLDOWN_MS).toBe(60_000);
    expect(settings.CHAMBER_LIGHT_OFF_DELAY_MS).toBe(0);
    expect(settings.CHAMBER_LIGHT_WARMUP_MS).toBe(0);
  });
});
