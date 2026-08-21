import EventEmitter from "node:events";
import { describe, expect, it } from "vitest";

import { PrintState } from "../src/enums";
import type BambuLabClient from "../src/services/bambu-lab";
import PrinterStatus from "../src/services/printer-status";
import type { Status } from "../src/types/printer-status";
import { getDiscordTagsForStatus, getInitialDiscordTags } from "../src/utils/discord-tags.util";
import { realMqttMulticolorCycle } from "./fixtures/real-mqtt-multicolor-cycle";

describe("real multicolor MQTT print cycle", () => {
  it("preserves multicolor detection through completion and selects the Discord tags", async () => {
    const emittedStatuses: Status[] = [];
    const client = new EventEmitter() as EventEmitter & Pick<BambuLabClient, "emitStatus">;
    client.emitStatus = async (current: Status): Promise<void> => {
      emittedStatuses.push({ ...current });
    };
    const printerStatus = new PrinterStatus(client as BambuLabClient);

    for (const payload of realMqttMulticolorCycle) {
      await printerStatus.onUpdate(payload);
    }

    expect(emittedStatuses.map(status => status.state)).toEqual([
      PrintState.PREPARE,
      PrintState.PREPARE,
      PrintState.RUNNING,
      PrintState.RUNNING,
      PrintState.RUNNING,
      PrintState.FINISH
    ]);
    expect(emittedStatuses.at(-1)).toMatchObject({
      state: PrintState.FINISH,
      model: "multicolor-model-fixture",
      project: "Multicolor fixture print",
      subtaskId: "multicolor-subtask-fixture",
      taskId: "multicolor-task-fixture",
      gcodeFile: "multicolor-fixture.gcode.3mf",
      plate: "1",
      isMulticolor: true,
      currentLayer: 26,
      maxLayers: 26,
      progressPercent: 100
    });
    expect(getInitialDiscordTags(emittedStatuses[2].isMulticolor ?? false)).toEqual(["En cours", "Multicolore"]);
    expect(getDiscordTagsForStatus(emittedStatuses.at(-1) as Status)).toEqual(["Multicolore", "Réussi"]);
  });
});
