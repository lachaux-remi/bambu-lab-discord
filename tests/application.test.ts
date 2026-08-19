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
