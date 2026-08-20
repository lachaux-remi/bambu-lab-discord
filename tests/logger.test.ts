import { Writable } from "node:stream";
import type { LoggerOptions } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";

const { childMock, pinoMock } = vi.hoisted(() => ({ childMock: vi.fn(), pinoMock: vi.fn() }));

vi.mock("pino", async importOriginal => {
  const actual = await importOriginal<typeof import("pino")>();
  return {
    default: Object.assign(pinoMock, { stdSerializers: actual.default.stdSerializers })
  };
});

describe("logger", () => {
  afterEach(() => {
    delete process.env.LOG_FORMAT;
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("serializes Error values stored under the error key", async () => {
    pinoMock.mockReturnValue({ child: childMock });
    childMock.mockReturnValue({});

    const { getLogger } = await import("../src/libs/logger");
    const options = pinoMock.mock.calls[0][0] as LoggerOptions;
    const error = new TypeError("download failed");

    expect(options.serializers?.error(error)).toMatchObject({
      type: "TypeError",
      message: "download failed",
      stack: expect.stringContaining("TypeError: download failed")
    });
    expect(getLogger("Project")).toEqual({});
    expect(childMock).toHaveBeenCalledWith({ service: "Project" });
  });

  it("redacts credentials and encrypted values at common nesting levels", async () => {
    pinoMock.mockReturnValue({ child: childMock });
    childMock.mockReturnValue({});
    const { default: actualPino } = await vi.importActual<typeof import("pino")>("pino");
    await import("../src/libs/logger");
    const options = pinoMock.mock.calls[0][0] as LoggerOptions;
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      }
    });
    const testLogger = actualPino({ ...options, transport: undefined }, destination);

    testLogger.info({
      accessCode: "top-secret",
      changes: { accessCode: "nested-secret", token: "discord-secret" },
      config: { encryption: { ciphertext: "enc:v1:complete-value" } },
      CONFIG_ENCRYPTION_KEY: "encryption-secret",
      DISCORD_BOT_TOKEN: "bot-secret"
    });

    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain("top-secret");
    expect(output).not.toContain("nested-secret");
    expect(output).not.toContain("discord-secret");
    expect(output).not.toContain("enc:v1:complete-value");
    expect(output).not.toContain("encryption-secret");
    expect(output).not.toContain("bot-secret");
  });

  it("allows pretty logs to be selected explicitly", async () => {
    process.env.LOG_FORMAT = "pretty";
    pinoMock.mockReturnValue({ child: childMock });

    await import("../src/libs/logger");

    const options = pinoMock.mock.calls[0][0] as LoggerOptions;
    expect(options.transport).toMatchObject({ target: "pino-pretty" });
  });

  it("allows structured JSON logs to be selected explicitly", async () => {
    process.env.LOG_FORMAT = "json";
    pinoMock.mockReturnValue({ child: childMock });

    await import("../src/libs/logger");

    const options = pinoMock.mock.calls[0][0] as LoggerOptions;
    expect(options.transport).toBeUndefined();
  });
});
