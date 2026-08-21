import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createCaptureOutput } from "../src/tools/debug-mqtt";
import { saveScreenshot } from "../src/tools/debug-rtc";

let workingDirectory: string | undefined;

afterEach(() => {
  if (workingDirectory) {
    rmSync(workingDirectory, { recursive: true, force: true });
    workingDirectory = undefined;
  }
});

const temporaryPath = (filename: string): string => {
  workingDirectory ??= mkdtempSync(join(tmpdir(), "bambu-debug-output-"));
  return join(workingDirectory, filename);
};

describe("debug output files", () => {
  it("creates MQTT NDJSON output exclusively with mode 0600", async () => {
    const path = temporaryPath("capture.ndjson");
    const output = createCaptureOutput(path);
    output.end("record\n");
    await once(output, "close");

    expect(readFileSync(path, "utf8")).toBe("record\n");
    expect(statSync(path).mode & 0o777).toBe(0o600);

    const duplicate = createCaptureOutput(path);
    await expect(once(duplicate, "open")).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("creates RTC JPEG output exclusively with mode 0600", () => {
    const path = temporaryPath("capture.jpg");
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

    expect(saveScreenshot(image, path)).toBe(path);
    expect(readFileSync(path)).toEqual(image);
    expect(statSync(path).mode & 0o777).toBe(0o600);

    expect(() => saveScreenshot(image, path)).toThrow(expect.objectContaining({ code: "EEXIST" }));
  });

  it("handles a rejected direct RTC debug run with a safe log and exit code 1", () => {
    const configDirectory = temporaryPath("config");
    mkdirSync(configDirectory);
    const sensitiveValue = "sensitive-config-value-must-not-appear";
    writeFileSync(join(configDirectory, "printers.json"), `{invalid-json:${sensitiveValue}`, "utf8");
    const environment = { ...process.env, LOG_FORMAT: "json" };
    delete environment.PRINTER_ADDRESS;
    delete environment.PRINTER_ACCESS_CODE;
    delete environment.PRINTER_SERIAL_NUMBER;

    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
        join(process.cwd(), "src", "tools", "debug-rtc.ts")
      ],
      { cwd: workingDirectory, encoding: "utf8", env: environment }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output.match(/Failed to run RTC debug test/g)).toHaveLength(1);
    expect(output).not.toContain(sensitiveValue);
    expect(output).not.toContain("unhandledRejection");
  });
});
