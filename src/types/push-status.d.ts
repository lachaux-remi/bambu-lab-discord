import type { MessageCommand, PrintState } from "../enums";
import type { IntRange, StringNumber } from "./general";
import type { PrintMessageCommand } from "./printer-messages";

export interface LightReport {
  node: string;
  mode: "on" | "off";
}

export interface PushStatusCommand extends PrintMessageCommand {
  command: MessageCommand.PUSH_STATUS;
  subtask_id?: string | number;
  task_id?: string | number;
  subtask_name?: string;
  gcode_file?: string;
  plate_idx?: StringNumber | number;
  gcode_state?: PrintState;
  layer_num?: number;
  total_layer_num?: number;
  mc_percent?: IntRange<0, 100>;
  mc_remaining_time?: number;
  lights_report?: LightReport[];
}
