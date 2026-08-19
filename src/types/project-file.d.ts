import type { MessageCommand } from "../enums";
import type { StringNumber } from "./general";
import type { PrintMessageCommand } from "./printer-messages";

export interface AmsMappingSlot {
  ams_id: number;
  slot_id: number;
}

export interface ProjectFileCommand extends PrintMessageCommand {
  command: MessageCommand.PROJECT_FILE;
  subtask_id?: string | number;
  task_id?: string | number;
  model_id?: string;
  gcode_file?: string;
  plate_idx?: StringNumber | number;
  subtask_name?: string;
  url?: string;
  timestamp?: number;
  use_ams?: boolean;
  ams_mapping?: number[];
  ams_mapping2?: AmsMappingSlot[];
}
