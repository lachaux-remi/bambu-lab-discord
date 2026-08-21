import { CommandResult, LightMode, LightNode, MessageCommand, PrintState } from "../../enums";
import type { PrintMessage, PrintMessageCommand, StopCommand } from "../../types/printer-messages";
import type { ProjectFileCommand } from "../../types/project-file";
import type { LightReport, PushStatusCommand } from "../../types/push-status";

const PRINT_STATES = new Set<string>(Object.values(PrintState));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isIdentity = (value: unknown): value is string | number => typeof value === "string" || isFiniteNumber(value);

const isPlateIndex = (value: unknown): value is number | `${number}` =>
  (typeof value === "number" && Number.isInteger(value) && value >= 0) ||
  (typeof value === "string" && /^\d+$/.test(value));

const isPrintState = (value: unknown): value is PrintState => typeof value === "string" && PRINT_STATES.has(value);

const parseLightsReport = (value: unknown): LightReport[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const reports = value.filter(
    (report): report is LightReport =>
      isRecord(report) &&
      report.node === LightNode.CHAMBER &&
      (report.mode === LightMode.ON || report.mode === LightMode.OFF)
  );
  return reports.length > 0 ? reports : undefined;
};

const parsePushStatus = (data: Record<string, unknown>): PushStatusCommand => {
  const command: PushStatusCommand = { command: MessageCommand.PUSH_STATUS };

  if (isIdentity(data.subtask_id)) {
    command.subtask_id = data.subtask_id;
  }
  if (isIdentity(data.task_id)) {
    command.task_id = data.task_id;
  }
  if (typeof data.subtask_name === "string") {
    command.subtask_name = data.subtask_name;
  }
  if (typeof data.gcode_file === "string") {
    command.gcode_file = data.gcode_file;
  }
  if (isPlateIndex(data.plate_idx)) {
    command.plate_idx = data.plate_idx;
  }
  if (isPrintState(data.gcode_state)) {
    command.gcode_state = data.gcode_state;
  }
  if (isFiniteNumber(data.layer_num)) {
    command.layer_num = data.layer_num;
  }
  if (isFiniteNumber(data.total_layer_num)) {
    command.total_layer_num = data.total_layer_num;
  }
  if (isFiniteNumber(data.mc_percent)) {
    command.mc_percent = data.mc_percent;
  }
  if (isFiniteNumber(data.mc_remaining_time)) {
    command.mc_remaining_time = data.mc_remaining_time;
  }

  const lightsReport = parseLightsReport(data.lights_report);
  if (lightsReport) {
    command.lights_report = lightsReport;
  }

  return command;
};

const parseProjectFile = (data: Record<string, unknown>): ProjectFileCommand => {
  const command: ProjectFileCommand = { command: MessageCommand.PROJECT_FILE };

  if (isIdentity(data.subtask_id)) {
    command.subtask_id = data.subtask_id;
  }
  if (isIdentity(data.task_id)) {
    command.task_id = data.task_id;
  }
  if (typeof data.model_id === "string") {
    command.model_id = data.model_id;
  }
  if (typeof data.gcode_file === "string") {
    command.gcode_file = data.gcode_file;
  }
  if (isPlateIndex(data.plate_idx)) {
    command.plate_idx = data.plate_idx;
  }
  if (typeof data.subtask_name === "string") {
    command.subtask_name = data.subtask_name;
  }
  if (typeof data.url === "string") {
    command.url = data.url;
  }
  if (Array.isArray(data.ams_mapping) && data.ams_mapping.every(isFiniteNumber)) {
    command.ams_mapping = data.ams_mapping;
  }

  return command;
};

const parseStop = (data: Record<string, unknown>): StopCommand => {
  const command: StopCommand = { command: MessageCommand.STOP };
  if (data.result === CommandResult.SUCCESS || data.result === CommandResult.FAILED) {
    command.result = data.result;
  }
  return command;
};

const parsePrintCommand = (value: unknown): PrintMessageCommand | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  switch (value.command) {
    case MessageCommand.PUSH_STATUS:
      return parsePushStatus(value);
    case MessageCommand.PROJECT_FILE:
      return parseProjectFile(value);
    case MessageCommand.STOP:
      return parseStop(value);
    default:
      return undefined;
  }
};

export const parsePrintMessage = (value: unknown): PrintMessage | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const print = parsePrintCommand(value.print);
  return print ? { print } : undefined;
};
