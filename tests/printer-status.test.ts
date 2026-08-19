import EventEmitter from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessageCommand, PrintState } from "../src/enums";
import type BambuLabClient from "../src/services/bambu-lab";
import PrinterStatus from "../src/services/printer-status";
import type { Status } from "../src/types/printer-status";

describe("PrinterStatus", () => {
  let client: EventEmitter & Pick<BambuLabClient, "emitStatus">;
  let status: PrinterStatus;

  beforeEach(() => {
    client = new EventEmitter() as EventEmitter & Pick<BambuLabClient, "emitStatus">;
    client.emitStatus = async (newStatus: Status, oldStatus: Status): Promise<void> => {
      client.emit("status", newStatus, oldStatus);
    };
    status = new PrinterStatus(client as BambuLabClient);
  });

  it("initializes a print from project metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T03:04:05Z"));
    const listener = vi.fn();
    client.on("status", listener);

    await status.onUpdate({
      command: MessageCommand.PROJECT_FILE,
      model_id: "model-1",
      subtask_name: "calibration cube",
      plate_idx: "1",
      ams_mapping: [0, 2]
    });

    expect(listener).toHaveBeenCalledOnce();
    const [newStatus, oldStatus] = listener.mock.calls[0];
    expect(oldStatus).toEqual({});
    expect(newStatus).toMatchObject({
      state: PrintState.PREPARE,
      model: "model-1",
      project: "calibration cube",
      plate: "1",
      isMulticolor: true,
      currentLayer: 0,
      maxLayers: 0,
      progressPercent: 0,
      remainingTime: 0,
      startedAt: Date.now()
    });
    vi.useRealTimers();
  });

  it("accumulates incremental status transitions and preserves the previous snapshot", async () => {
    const listener = vi.fn();
    client.on("status", listener);

    await status.onUpdate({
      command: MessageCommand.PUSH_STATUS,
      subtask_name: "benchy",
      gcode_state: PrintState.RUNNING,
      layer_num: 4,
      total_layer_num: 100,
      mc_percent: 8,
      mc_remaining_time: 92
    });
    await status.onUpdate({
      command: MessageCommand.PUSH_STATUS,
      gcode_state: PrintState.PAUSE,
      layer_num: 5,
      mc_percent: 10
    });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0]).toMatchObject({
      state: PrintState.PAUSE,
      project: "benchy",
      currentLayer: 5,
      maxLayers: 100,
      progressPercent: 10,
      remainingTime: 92
    });
    expect(listener.mock.calls[1][1]).toMatchObject({
      state: PrintState.RUNNING,
      currentLayer: 4,
      progressPercent: 8
    });
  });

  it("does not emit for unknown commands or non-critical remaining-time updates", async () => {
    const listener = vi.fn();
    client.on("status", listener);

    await status.onUpdate({ command: "unknown" as MessageCommand });
    await status.onUpdate({ command: MessageCommand.PUSH_STATUS, mc_remaining_time: 42 });

    expect(listener).not.toHaveBeenCalled();
  });
});
