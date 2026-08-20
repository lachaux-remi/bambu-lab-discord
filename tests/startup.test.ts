import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

describe("application startup", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("logs an invalid configuration once with safe, actionable context", () => {
    const workingDirectory = mkdtempSync(join(tmpdir(), "bambu-startup-"));
    temporaryDirectories.push(workingDirectory);
    mkdirSync(join(workingDirectory, "config"));
    const accessCode = "access-code-must-not-appear";
    writeFileSync(
      join(workingDirectory, "config", "printers.json"),
      JSON.stringify({
        version: 1,
        printers: {
          "herox-p1s": {
            id: "herox-p1s",
            name: 42,
            ip: "192.0.2.10",
            port: 8883,
            rtcPort: 6000.5,
            serial: "SERIAL",
            accessCode,
            forumChannelId: "channel",
            enabled: true
          }
        }
      }),
      "utf8"
    );

    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), join(process.cwd(), "src", "index.ts")],
      {
        cwd: workingDirectory,
        encoding: "utf8",
        env: { ...process.env, LOG_FORMAT: "json" }
      }
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output.match(/Failed to load printer configuration/g)).toHaveLength(1);
    expect(output).toContain(join(workingDirectory, "config", "printers.json"));
    expect(output).toContain("printers.herox-p1s.name must be a string");
    expect(output).toContain("printers.herox-p1s.rtcPort must be an integer");
    expect(output).not.toContain(accessCode);
    expect(output).not.toContain('"stack"');
  });
});
