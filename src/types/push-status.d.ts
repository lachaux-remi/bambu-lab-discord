import type { LightMode, LightNode, MessageCommand, PrintState } from "../enums";
import type { StringNumber } from "./general";

export interface LightReport {
  node: LightNode;
  mode: LightMode;
}

export interface PushStatusCommand {
  command: MessageCommand.PUSH_STATUS;
  subtask_id?: string | number;
  task_id?: string | number;
  subtask_name?: string;
  gcode_file?: string;
  plate_idx?: StringNumber | number;
  gcode_state?: PrintState;
  layer_num?: number;
  total_layer_num?: number;
  mc_percent?: number;
  mc_remaining_time?: number;
  lights_report?: LightReport[];
}
