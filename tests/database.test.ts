import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrinterConfig } from "../src/types/printer-config";

const fsTracking = vi.hoisted(() => ({
  descriptorPaths: new Map<number, string>(),
  directoryFsyncError: undefined as NodeJS.ErrnoException | undefined,
  events: [] as Array<{ operation: "close" | "fsync" | "open" | "rename"; path: string }>
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    openSync: (...arguments_: Parameters<typeof actual.openSync>) => {
      const descriptor = actual.openSync(...arguments_);
      const path = String(arguments_[0]);
      fsTracking.descriptorPaths.set(descriptor, path);
      fsTracking.events.push({ operation: "open", path });
      return descriptor;
    },
    fsyncSync: (descriptor: number) => {
      const path = fsTracking.descriptorPaths.get(descriptor) ?? "unknown";
      fsTracking.events.push({ operation: "fsync", path });
      if (fsTracking.directoryFsyncError && path.endsWith("/config")) {
        throw fsTracking.directoryFsyncError;
      }
      actual.fsyncSync(descriptor);
    },
    closeSync: (descriptor: number) => {
      const path = fsTracking.descriptorPaths.get(descriptor) ?? "unknown";
      fsTracking.events.push({ operation: "close", path });
      fsTracking.descriptorPaths.delete(descriptor);
      actual.closeSync(descriptor);
    },
    renameSync: (...arguments_: Parameters<typeof actual.renameSync>) => {
      fsTracking.events.push({ operation: "rename", path: String(arguments_[1]) });
      actual.renameSync(...arguments_);
    }
  };
});

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

const writePlaintextPrinterConfig = (): void => {
  writeFileSync(
    join(workingDirectory, "config", "printers.json"),
    JSON.stringify({
      version: 1,
      printers: {
        "p1s-bureau": {
          ...printerInput,
          id: "p1s-bureau",
          createdAt: 1_000,
          updatedAt: 1_000
        }
      }
    }),
    "utf8"
  );
};

describe.sequential("configuration persistence", () => {
  beforeEach(() => {
    workingDirectory = mkdtempSync(join(tmpdir(), "bambu-config-"));
    process.chdir(workingDirectory);
    delete process.env.CONFIG_ENCRYPTION_KEY;
    fsTracking.descriptorPaths.clear();
    fsTracking.directoryFsyncError = undefined;
    fsTracking.events.length = 0;
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
    vi.restoreAllMocks();
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

  it("fsyncs the parent directory after the atomic rename and closes both descriptors", async () => {
    const database = await import("../src/services/database");

    expect(database.saveConfig({ version: 1, printers: {} })).toBe(true);

    expect(fsTracking.events.map(event => event.operation)).toEqual([
      "open",
      "fsync",
      "close",
      "rename",
      "open",
      "fsync",
      "close"
    ]);
    expect(fsTracking.events[0].path).toMatch(/printers\.json\..+\.tmp$/);
    expect(fsTracking.events[3].path).toBe(join(workingDirectory, "config", "printers.json"));
    expect(fsTracking.events.slice(4).map(event => event.path)).toEqual([
      join(workingDirectory, "config"),
      join(workingDirectory, "config"),
      join(workingDirectory, "config")
    ]);
  });

  it("reports Linux directory fsync failures, closes the directory, and leaves no temporary file", async () => {
    const database = await import("../src/services/database");
    fsTracking.directoryFsyncError = Object.assign(new Error("directory fsync failed"), { code: "EINVAL" });

    expect(database.saveConfig({ version: 1, printers: {} })).toBe(false);

    const directoryEvents = fsTracking.events.filter(event => event.path === join(workingDirectory, "config"));
    expect(directoryEvents.map(event => event.operation)).toEqual(["open", "fsync", "close"]);
    expect(readdirSync(join(workingDirectory, "config"))).toEqual(["printers.json"]);
  });

  it("ignores only known unsupported directory fsync errors away from Linux", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const database = await import("../src/services/database");
    fsTracking.directoryFsyncError = Object.assign(new Error("directory fsync unsupported"), { code: "EINVAL" });

    expect(database.saveConfig({ version: 1, printers: {} })).toBe(true);
    expect(fsTracking.events.at(-1)).toEqual({
      operation: "close",
      path: join(workingDirectory, "config")
    });
  });

  it("rejects a malformed encryption key even when it decodes to 32 bytes", async () => {
    process.env.CONFIG_ENCRYPTION_KEY = `${randomBytes(32).toString("base64")}!!!!`;
    const database = await import("../src/services/database");

    expect(() => database.loadConfig()).toThrow("CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  });

  it("supports the complete printer CRUD lifecycle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    process.env.CONFIG_ENCRYPTION_KEY = randomBytes(32).toString("base64");
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

  it("migrates plaintext access codes when an encryption key is configured", async () => {
    const database = await import("../src/services/database");
    database.loadConfig();
    writePlaintextPrinterConfig();
    process.env.CONFIG_ENCRYPTION_KEY = randomBytes(32).toString("base64");

    expect(database.loadConfig().printers["p1s-bureau"].accessCode).toBe("secret");

    const persisted = JSON.parse(readFileSync(join(workingDirectory, "config", "printers.json"), "utf8"));
    expect(persisted.printers["p1s-bureau"].accessCode).toMatch(/^enc:v1:/);
    expect(persisted.printers["p1s-bureau"].accessCode).not.toContain("secret");
  });

  it("preserves existing ciphertext while migrating a mixed configuration", async () => {
    process.env.CONFIG_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const database = await import("../src/services/database");
    database.addPrinter(printerInput);
    const configPath = join(workingDirectory, "config", "printers.json");
    const beforeMigration = JSON.parse(readFileSync(configPath, "utf8"));
    const existingCiphertext = beforeMigration.printers["p1s-bureau"].accessCode;
    beforeMigration.printers["x1-carbon"] = {
      ...printerInput,
      id: "x1-carbon",
      name: "X1 Carbon",
      serial: "SECOND-SERIAL",
      accessCode: "second-secret",
      createdAt: 2_000,
      updatedAt: 2_000
    };
    writeFileSync(configPath, JSON.stringify(beforeMigration), "utf8");

    database.loadConfig();

    const afterMigration = JSON.parse(readFileSync(configPath, "utf8"));
    expect(afterMigration.printers["p1s-bureau"].accessCode).toBe(existingCiphertext);
    expect(afterMigration.printers["x1-carbon"].accessCode).toMatch(/^enc:v1:/);
    expect(afterMigration.printers["x1-carbon"].accessCode).not.toContain("second-secret");
  });

  it("refuses to load printer access codes without an encryption key", async () => {
    const database = await import("../src/services/database");
    database.loadConfig();
    writePlaintextPrinterConfig();

    expect(() => database.loadConfig()).toThrow("CONFIG_ENCRYPTION_KEY is required when printers are configured");
  });

  it("refuses to persist printer access codes without an encryption key", async () => {
    const database = await import("../src/services/database");

    expect(database.addPrinter(printerInput)).toBeNull();
    expect(database.getAllPrinters()).toEqual([]);
    expect(JSON.parse(readFileSync(join(workingDirectory, "config", "printers.json"), "utf8"))).toEqual({
      version: 1,
      printers: {}
    });
  });

  it("persists and removes active print thread recovery state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const database = await import("../src/services/database");

    expect(database.setActivePrintThread("printer", "thread-1", "Benchy")).toBe(true);
    expect(database.getActivePrintThread("printer")).toEqual({
      threadId: "thread-1",
      updatedAt: 2_000,
      project: "Benchy"
    });
    expect(JSON.parse(readFileSync(join(workingDirectory, "config", "active-threads.json"), "utf8"))).toEqual({
      printer: { threadId: "thread-1", updatedAt: 2_000, project: "Benchy" }
    });
    expect(database.removeActivePrintThread("printer")).toBe(true);
    expect(database.getActivePrintThread("printer")).toBeNull();
  });

  it("persists the hierarchical print identity while retaining the legacy project field", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);
    const database = await import("../src/services/database");
    const identity = {
      subtaskId: "subtask-1",
      taskId: "task-1",
      gcodeFile: "Metadata/plate_1.gcode",
      plate: "1",
      project: "Benchy"
    };

    expect(database.setActivePrintThread("printer", "thread-1", identity)).toBe(true);
    expect(database.getActivePrintThread("printer")).toEqual({
      threadId: "thread-1",
      updatedAt: 2_000,
      project: "Benchy",
      identity
    });

    vi.resetModules();
    const reloadedDatabase = await import("../src/services/database");
    expect(reloadedDatabase.getActivePrintThread("printer")).toEqual({
      threadId: "thread-1",
      updatedAt: 2_000,
      project: "Benchy",
      identity
    });
  });

  it("loads legacy active thread recovery state without a project", async () => {
    mkdirSync(join(workingDirectory, "config"));
    writeFileSync(
      join(workingDirectory, "config", "active-threads.json"),
      JSON.stringify({ printer: { threadId: "thread-legacy", updatedAt: 1_000 } }),
      "utf8"
    );
    const database = await import("../src/services/database");

    expect(database.getActivePrintThread("printer")).toEqual({ threadId: "thread-legacy", updatedAt: 1_000 });
  });

  it("rejects persisted zero or empty identity fields without rejecting the legacy file format", async () => {
    mkdirSync(join(workingDirectory, "config"));
    writeFileSync(
      join(workingDirectory, "config", "active-threads.json"),
      JSON.stringify({
        invalid: {
          threadId: "thread-invalid",
          updatedAt: 1_000,
          project: "Benchy",
          identity: { subtaskId: "0", project: "Benchy" }
        }
      }),
      "utf8"
    );
    const database = await import("../src/services/database");

    expect(database.getActivePrintThread("invalid")).toBeNull();
  });

  it("reports persistence failures", async () => {
    writeFileSync(join(workingDirectory, "config"), "not a directory", "utf8");
    const database = await import("../src/services/database");

    expect(database.saveConfig({ version: 1, printers: {} })).toBe(false);
  });
});
