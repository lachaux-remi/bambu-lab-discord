import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MessageCommand, PrintState } from "../src/enums";
import { serializePublishStep } from "../src/tools/mock-mqtt-printer/player";
import { runScenario } from "../src/tools/mock-mqtt-printer/runner";
import { loadScenario, parseScenario } from "../src/tools/mock-mqtt-printer/scenario";

const scenarioDirectory = fileURLToPath(new URL("../scenarios/mock-mqtt-printer/", import.meta.url));
const scenarioFiles = readdirSync(scenarioDirectory)
  .filter(file => file.endsWith(".json"))
  .sort();

describe.sequential("scenario-driven mock MQTT printer", () => {
  it("validates every versioned scenario", () => {
    const scenarios = scenarioFiles.map(file => loadScenario(`${scenarioDirectory}${file}`));

    expect(scenarios.map(scenario => scenario.name)).toEqual([
      "bounded-burst",
      "controlled-shutdown",
      "discord-e2e-smoke",
      "long-outage-pause",
      "long-outage-running",
      "long-outage-terminal",
      "malformed-then-valid",
      "partial-then-valid",
      "restart-active-print",
      "short-outage-running",
      "stop-success",
      "successful-print"
    ]);
  });

  it("rejects ambiguous payload-owned commands", () => {
    expect(() =>
      parseScenario({
        version: 1,
        name: "invalid",
        steps: [{ action: "status", payload: { command: "project_file" } }],
        expect: {}
      })
    ).toThrow("command and gcode_state are owned by the scenario action");
  });

  it("serializes semantic actions as Bambu print reports", () => {
    expect(
      JSON.parse(serializePublishStep({ action: "status", state: PrintState.PAUSE, payload: { mc_percent: 42 } }))
    ).toEqual({
      print: { command: MessageCommand.PUSH_STATUS, gcode_state: "PAUSE", mc_percent: 42 }
    });
  });

  it.each(scenarioFiles)("runs %s through real MQTT, BambuLabClient and PrinterManager", async file => {
    const result = await runScenario(loadScenario(`${scenarioDirectory}${file}`), { timeScale: 0.01 });

    expect(result.status).toBe("passed");
    expect(result.mode).toBe("mock-discord");
    expect(result.shutdown).toBe("clean");
  });
});
