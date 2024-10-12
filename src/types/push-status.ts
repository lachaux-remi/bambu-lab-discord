import { MessageCommand, PrintState } from "../enums";
import type { IntRange, StringNumber } from "./general";
import type { PrintMessageCommand } from "./printer-messages";

export interface PushStatusCommand extends PrintMessageCommand {
  command: MessageCommand.PUSH_STATUS;
  ams: AMSStatus;
  gcode_state: PrintState;
  layer_num: number;
  total_layer_num: number;
  mc_percent: IntRange<0, 100>;
  mc_remaining_time: number;
  subtask_name: string;
}

export interface AMSStatus {
  ams: [AMS] | [AMS, AMS] | [AMS, AMS, AMS] | [AMS, AMS, AMS, AMS];
  tray_now: StringNumber;
}

export interface AMS {
  tray: [Tray?, Tray?, Tray?, Tray?];
}

export interface Tray {
  id: string;
  tray_color: string;
  tray_type: string;
}
