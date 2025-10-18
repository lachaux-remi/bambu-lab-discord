import { MessageCommand, PrintState } from "../enums";
import type { IntRange } from "./general";
import type { PrintMessageCommand } from "./printer-messages";

export interface PushStatusCommand extends PrintMessageCommand {
  command: MessageCommand.PUSH_STATUS;
  subtask_name?: string;
  gcode_state?: PrintState;
  layer_num?: number;
  total_layer_num?: number;
  mc_percent?: IntRange<0, 100>;
  mc_remaining_time?: number;
}
