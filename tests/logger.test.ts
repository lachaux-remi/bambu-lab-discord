import type { LoggerOptions } from "pino";
import { describe, expect, it, vi } from "vitest";

const { childMock, pinoMock } = vi.hoisted(() => ({ childMock: vi.fn(), pinoMock: vi.fn() }));

vi.mock("pino", async importOriginal => {
  const actual = await importOriginal<typeof import("pino")>();
  return {
    default: Object.assign(pinoMock, { stdSerializers: actual.default.stdSerializers })
  };
});

describe("logger", () => {
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
});
