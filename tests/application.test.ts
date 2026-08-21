import { describe, expect, it, vi } from "vitest";

import { Application } from "../src/application";

describe("Application lifecycle", () => {
  it("starts Discord before the printers", async () => {
    const order: string[] = [];
    const application = new Application({
      discord: {
        start: vi.fn(async () => {
          order.push("discord");
        }),
        stop: vi.fn()
      },
      printers: {
        start: vi.fn(async () => {
          order.push("printers");
        }),
        stop: vi.fn()
      }
    });

    await application.start();

    expect(order).toEqual(["discord", "printers"]);
  });

  it("does not resume startup after shutdown is requested during Discord startup", async () => {
    const order: string[] = [];
    const discordStartup = Promise.withResolvers<void>();
    const printerStart = vi.fn();
    const application = new Application({
      discord: {
        start: vi.fn(async () => {
          order.push("discord:start");
          await discordStartup.promise;
          order.push("discord:started");
        }),
        stop: vi.fn(async () => {
          order.push("discord:stop");
        })
      },
      printers: {
        start: printerStart,
        stop: vi.fn(async () => {
          order.push("printers:stop");
        })
      }
    });

    const startup = application.start();
    expect(application.start()).toBe(startup);
    const shutdown = application.stop();
    expect(order).toEqual(["discord:start"]);

    discordStartup.resolve();
    await Promise.all([startup, shutdown]);

    expect(printerStart).not.toHaveBeenCalled();
    expect(order).toEqual(["discord:start", "discord:started", "printers:stop", "discord:stop"]);
    await application.stop();
    await application.start();
    expect(order).toHaveLength(4);
  });

  it("finishes shutdown when printer startup fails after stop was requested", async () => {
    const printerStartup = Promise.withResolvers<void>();
    const printerStop = vi.fn();
    const discordStop = vi.fn();
    const application = new Application({
      discord: { start: vi.fn(), stop: discordStop },
      printers: {
        start: vi.fn(() => printerStartup.promise),
        stop: printerStop
      }
    });

    const startup = application.start();
    await Promise.resolve();
    const shutdown = application.stop();
    printerStartup.reject(new Error("printer startup failed during shutdown"));

    await expect(startup).rejects.toThrow("printer startup failed during shutdown");
    await shutdown;
    expect(printerStop).toHaveBeenCalledOnce();
    expect(discordStop).toHaveBeenCalledOnce();
  });

  it("stops partially started services when printer startup fails", async () => {
    const discordStop = vi.fn();
    const printerStop = vi.fn();
    const application = new Application({
      discord: {
        start: vi.fn(),
        stop: discordStop
      },
      printers: {
        start: vi.fn().mockRejectedValue(new Error("printer startup failed")),
        stop: printerStop
      }
    });

    await expect(application.start()).rejects.toThrow("printer startup failed");

    expect(printerStop).toHaveBeenCalledOnce();
    expect(discordStop).toHaveBeenCalledOnce();
  });

  it("stops the printers before Discord", async () => {
    const order: string[] = [];
    const application = new Application({
      discord: {
        start: vi.fn(),
        stop: vi.fn(async () => {
          order.push("discord");
        })
      },
      printers: {
        start: vi.fn(),
        stop: vi.fn(async () => {
          order.push("printers");
        })
      }
    });

    await application.stop();

    expect(order).toEqual(["printers", "discord"]);
  });

  it("runs shutdown only once when called concurrently", async () => {
    let finishPrinterShutdown: (() => void) | undefined;
    const printerStop = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finishPrinterShutdown = resolve;
        })
    );
    const discordStop = vi.fn();
    const application = new Application({
      discord: { start: vi.fn(), stop: discordStop },
      printers: { start: vi.fn(), stop: printerStop }
    });

    const firstShutdown = application.stop();
    const secondShutdown = application.stop();

    expect(printerStop).toHaveBeenCalledOnce();
    finishPrinterShutdown?.();
    await Promise.all([firstShutdown, secondShutdown]);
    expect(discordStop).toHaveBeenCalledOnce();
  });

  it("still stops Discord when printer shutdown fails", async () => {
    const discordStop = vi.fn();
    const application = new Application({
      discord: { start: vi.fn(), stop: discordStop },
      printers: {
        start: vi.fn(),
        stop: vi.fn().mockRejectedValue(new Error("printer shutdown failed"))
      }
    });

    await expect(application.stop()).rejects.toThrow("printer shutdown failed");

    expect(discordStop).toHaveBeenCalledOnce();
  });
});
