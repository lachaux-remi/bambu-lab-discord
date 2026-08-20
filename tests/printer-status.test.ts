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
      subtask_id: "subtask-1",
      task_id: 42,
      model_id: "model-1",
      gcode_file: "Metadata/plate_1.gcode",
      subtask_name: "calibration cube",
      plate_idx: 1,
      ams_mapping: [0, 2]
    });

    expect(listener).toHaveBeenCalledOnce();
    const [newStatus, oldStatus] = listener.mock.calls[0];
    expect(oldStatus).toEqual({});
    expect(newStatus).toMatchObject({
      state: PrintState.PREPARE,
      model: "model-1",
      project: "calibration cube",
      subtaskId: "subtask-1",
      taskId: "42",
      gcodeFile: "Metadata/plate_1.gcode",
      plate: 1,
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
      subtask_id: "cloud-subtask",
      task_id: "cloud-task",
      subtask_name: "benchy",
      gcode_file: "benchy.gcode.3mf",
      plate_idx: 2,
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
      subtaskId: "cloud-subtask",
      taskId: "cloud-task",
      gcodeFile: "benchy.gcode.3mf",
      plate: 2,
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

  it("does not treat zero or empty MQTT identifiers as print IDs", async () => {
    const listener = vi.fn();
    client.on("status", listener);

    await status.onUpdate({
      command: MessageCommand.PROJECT_FILE,
      subtask_id: "cloud-subtask",
      task_id: "cloud-task",
      subtask_name: "Cloud Benchy",
      gcode_file: "cloud-benchy.gcode.3mf",
      plate_idx: 1
    });
    await status.onUpdate({
      command: MessageCommand.PUSH_STATUS,
      subtask_id: "0",
      task_id: "  ",
      subtask_name: "LAN Benchy",
      gcode_file: "",
      plate_idx: 0,
      gcode_state: PrintState.RUNNING
    });

    const [newStatus] = listener.mock.calls[1];
    expect(newStatus.subtaskId).toBeUndefined();
    expect(newStatus.taskId).toBeUndefined();
    expect(newStatus.gcodeFile).toBeUndefined();
    expect(newStatus).toMatchObject({
      project: "LAN Benchy",
      plate: 0
    });
  });

  it("resets cancellation intent when a new print starts without project metadata", async () => {
    const emittedStatuses: Status[] = [];
    client.on("status", (newStatus: Status) => emittedStatuses.push({ ...newStatus }));

    await status.onUpdate({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.PAUSE });
    await status.onUpdate({ command: MessageCommand.STOP, result: "success" });
    await status.onUpdate({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.FAILED });
    await status.onUpdate({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.RUNNING });

    expect(emittedStatuses).toHaveLength(4);
    expect(emittedStatuses[2]).toMatchObject({
      state: PrintState.FAILED,
      cancellationRequested: true
    });
    expect(emittedStatuses[3]).toMatchObject({
      state: PrintState.RUNNING,
      cancellationRequested: false
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
