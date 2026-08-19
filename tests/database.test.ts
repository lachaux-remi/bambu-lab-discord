import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrinterConfig } from "../src/types/printer-config";

const originalWorkingDirectory = process.cwd();
const originalEncryptionKey = process.env.CONFIG_ENCRYPTION_KEY;
let workingDirectory: string;

const printerInput: Omit<PrinterConfig, "id" | "createdAt" | "updatedAt"> = {
  name: "P1S Bureau",
  ip: "192.0.2.10",
  port: 8883,
  rtcPort: 6000,
  serial: "SERIAL",
  accessCode: "secret",
  forumChannelId: "channel",
  enabled: true
};

describe.sequential("configuration persistence", () => {
  beforeEach(() => {
    workingDirectory = mkdtempSync(join(tmpdir(), "bambu-config-"));
    process.chdir(workingDirectory);
    delete process.env.CONFIG_ENCRYPTION_KEY;
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalWorkingDirectory);
    if (originalEncryptionKey === undefined) {
      delete process.env.CONFIG_ENCRYPTION_KEY;
    } else {
      process.env.CONFIG_ENCRYPTION_KEY = originalEncryptionKey;
    }
    rmSync(workingDirectory, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("creates and persists a default configuration when none exists", async () => {
    const database = await import("../src/services/database");

    expect(database.loadConfig()).toEqual({ version: 1, printers: {} });
    expect(JSON.parse(readFileSync(join(workingDirectory, "config", "printers.json"), "utf8"))).toEqual({
      version: 1,
      printers: {}
    });
  });

  it("supports the complete printer CRUD lifecycle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const database = await import("../src/services/database");

    const added = database.addPrinter(printerInput);
    expect(added).toMatchObject({ id: "p1s-bureau", createdAt: 1_000, updatedAt: 1_000 });
    expect(database.addPrinter(printerInput)).toBeNull();
    expect(database.getEnabledPrinters()).toEqual([added]);

    vi.setSystemTime(2_000);
    const updated = database.updatePrinter("p1s-bureau", { name: "Renamed", enabled: false, id: "ignored" });
    expect(updated).toMatchObject({ id: "p1s-bureau", name: "Renamed", enabled: false, updatedAt: 2_000 });
    expect(database.getEnabledPrinters()).toEqual([]);

    database.reloadConfig();
    expect(database.getPrinter("p1s-bureau")).toEqual(updated);
    expect(database.removePrinter("p1s-bureau")).toBe(true);
    expect(database.removePrinter("p1s-bureau")).toBe(false);
    expect(database.getAllPrinters()).toEqual([]);
  });

  it("refuses to replace a corrupt configuration with an empty default", async () => {
    const database = await import("../src/services/database");
    database.loadConfig();
    writeFileSync(join(workingDirectory, "config", "printers.json"), "{not-json", "utf8");

    expect(() => database.loadConfig()).toThrow();
  });

  it("encrypts access codes and decrypts them after reload", async () => {
    process.env.CONFIG_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const database = await import("../src/services/database");

    expect(database.addPrinter(printerInput)).not.toBeNull();
    const persisted = JSON.parse(readFileSync(join(workingDirectory, "config", "printers.json"), "utf8"));
    expect(persisted.printers["p1s-bureau"].accessCode).toMatch(/^enc:v1:/);
    expect(persisted.printers["p1s-bureau"].accessCode).not.toContain("secret");

    database.reloadConfig();
    expect(database.getPrinter("p1s-bureau")?.accessCode).toBe("secret");
  });

  it("persists and removes active print thread recovery state", async () => {
    const database = await import("../src/services/database");

    expect(database.setActivePrintThread("printer", "thread-1")).toBe(true);
    expect(database.getActivePrintThread("printer")?.threadId).toBe("thread-1");
    expect(database.removeActivePrintThread("printer")).toBe(true);
    expect(database.getActivePrintThread("printer")).toBeNull();
  });

  it("reports persistence failures", async () => {
    writeFileSync(join(workingDirectory, "config"), "not a directory", "utf8");
    const database = await import("../src/services/database");

    expect(database.saveConfig({ version: 1, printers: {} })).toBe(false);
  });
});
