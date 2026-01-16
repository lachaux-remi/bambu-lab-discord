import type { MessageCommand } from "../enums";
import type { StringNumber } from "./general";
import type { PrintMessageCommand } from "./printer-messages";

export interface AmsMappingSlot {
  ams_id: number;
  slot_id: number;
}

export interface ProjectFileCommand extends PrintMessageCommand {
  command: MessageCommand.PROJECT_FILE;
  model_id?: string;
  plate_idx?: StringNumber;
  subtask_name?: string;
  url?: string;
  timestamp?: number;
  use_ams?: boolean;
  ams_mapping?: number[];
  ams_mapping2?: AmsMappingSlot[];
}
