import { afterEach, describe, expect, it, vi } from "vitest";

describe("numeric environment settings", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
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

  it.each([
    ["red", "ftp://example.com/icon.png"],
    ["#12345", "file:///tmp/icon.png"],
    ["#1234567", "not a URL"]
  ])("builds an embed with safe fallbacks for invalid notification values", async (color, icon) => {
    vi.stubEnv("NOTIFICATION_COLOR", color);
    vi.stubEnv("NOTIFICATION_FOOTER_ICON", icon);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { createBaseEmbed } = await import("../src/services/discord/embeds/base");
    const embed = createBaseEmbed().toJSON();

    expect(embed.color).toBe(0x24_a5_43);
    expect(embed.footer).toEqual({ text: "Bambu Lab Discord" });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("builds an embed with valid configured notification values", async () => {
    vi.stubEnv("NOTIFICATION_COLOR", "#A1b2C3");
    vi.stubEnv("NOTIFICATION_FOOTER_ICON", "https://example.com/icon.png");

    const { createBaseEmbed } = await import("../src/services/discord/embeds/base");
    const embed = createBaseEmbed().toJSON();

    expect(embed.color).toBe(0xa1_b2_c3);
    expect(embed.footer).toEqual({ text: "Bambu Lab Discord", icon_url: "https://example.com/icon.png" });
  });
});
