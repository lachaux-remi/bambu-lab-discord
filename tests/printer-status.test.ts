import EventEmitter from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommandResult, MessageCommand, PrintState } from "../src/enums";
import type BambuLabClient from "../src/services/bambu-lab";
import PrinterStatus from "../src/services/printer-status";
import type { Status } from "../src/types/printer-status";
import { realMqttPrintCycle } from "./fixtures/real-mqtt-print-cycle";

const extractProjectImageMock = vi.hoisted(() => vi.fn());

vi.mock("../src/libs/project", () => ({ extractProjectImage: extractProjectImageMock }));

describe("PrinterStatus", () => {
  let client: EventEmitter & Pick<BambuLabClient, "emitCancellationRequested" | "emitStatus">;
  let status: PrinterStatus;

  beforeEach(() => {
    extractProjectImageMock.mockReset();
    client = new EventEmitter() as EventEmitter & Pick<BambuLabClient, "emitCancellationRequested" | "emitStatus">;
    client.emitStatus = async (newStatus: Status, oldStatus: Status): Promise<void> => {
      client.emit("status", newStatus, oldStatus);
    };
    client.emitCancellationRequested = async (): Promise<void> => {
      client.emit("cancellationRequested");
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
    const [newStatus, oldStatus] = listener.mock.calls[0]!;
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

  it("extracts and stores the project image for plate zero", async () => {
    const image = Buffer.from("project-image");
    const listener = vi.fn();
    extractProjectImageMock.mockResolvedValue(image);
    client.on("status", listener);

    await status.onUpdate({
      command: MessageCommand.PROJECT_FILE,
      url: "https://example.com/project.3mf",
      plate_idx: 0
    });

    expect(extractProjectImageMock).toHaveBeenCalledOnce();
    expect(extractProjectImageMock).toHaveBeenCalledWith({
      url: "https://example.com/project.3mf",
      plate: "0"
    });
    expect(listener.mock.calls[0]?.[0].projectImage).toBe(image);
  });

  it("does not extract a project image when the plate is absent", async () => {
    await status.onUpdate({
      command: MessageCommand.PROJECT_FILE,
      url: "https://example.com/project.3mf"
    });

    expect(extractProjectImageMock).not.toHaveBeenCalled();
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
    expect(listener.mock.calls[1]?.[0]).toMatchObject({
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
    expect(listener.mock.calls[1]?.[1]).toMatchObject({
      state: PrintState.RUNNING,
      currentLayer: 4,
      progressPercent: 8
    });
  });

  it("preserves print identity and progress across a real pause-resume-finish cycle", async () => {
    const transitions: Array<{ current: Status; previous: Status }> = [];
    client.on("status", (current: Status, previous: Status) => {
      transitions.push({ current: { ...current }, previous: { ...previous } });
    });

    for (const payload of realMqttPrintCycle) {
      await status.onUpdate(payload);
    }

    expect(transitions.map(({ current }) => current.state)).toEqual([
      PrintState.PREPARE,
      PrintState.PREPARE,
      PrintState.RUNNING,
      PrintState.RUNNING,
      PrintState.PAUSE,
      PrintState.RUNNING,
      PrintState.FINISH
    ]);
    expect(transitions.at(-1)?.current).toMatchObject({
      state: PrintState.FINISH,
      model: "model-fixture",
      project: "Fixture print",
      subtaskId: "subtask-fixture",
      taskId: "task-fixture",
      gcodeFile: "fixture.gcode.3mf",
      plate: "1",
      isMulticolor: false,
      currentLayer: 5,
      maxLayers: 26,
      progressPercent: 100
    });
    expect(transitions[4]).toMatchObject({
      current: { state: PrintState.PAUSE },
      previous: { state: PrintState.RUNNING, progressPercent: 80 }
    });
    expect(transitions[5]).toMatchObject({
      current: { state: PrintState.RUNNING },
      previous: { state: PrintState.PAUSE }
    });
    expect(transitions[6]).toMatchObject({
      current: { state: PrintState.FINISH, progressPercent: 100 },
      previous: { state: PrintState.RUNNING, progressPercent: 80 }
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

    expect(listener).toHaveBeenCalledTimes(2);
    const [newStatus] = listener.mock.calls[1]!;
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
    await status.onUpdate({ command: MessageCommand.STOP, result: CommandResult.SUCCESS });
    expect(emittedStatuses).toHaveLength(1);

    await status.onUpdate({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.FAILED });
    await status.onUpdate({ command: MessageCommand.PUSH_STATUS, gcode_state: PrintState.RUNNING });

    expect(emittedStatuses).toHaveLength(3);
    expect(emittedStatuses[1]).toMatchObject({
      state: PrintState.FAILED,
      cancellationRequested: true
    });
    expect(emittedStatuses[2]).toMatchObject({
      state: PrintState.RUNNING,
      cancellationRequested: false
    });
    expect(emittedStatuses[2]!.startedAt).toBeGreaterThan(emittedStatuses[1]!.startedAt!);
  });

  it("does not emit for unknown commands or non-critical remaining-time updates", async () => {
    const listener = vi.fn();
    client.on("status", listener);

    await status.onUpdate({ command: "unknown" as MessageCommand });
    await status.onUpdate({ command: MessageCommand.PUSH_STATUS, mc_remaining_time: 42 });

    expect(listener).not.toHaveBeenCalled();
  });
});
