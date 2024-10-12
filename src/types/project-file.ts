import { MessageCommand } from "../enums";
import type { StringNumber } from "./general";
import type { PrintMessageCommand } from "./printer-messages";

export interface ProjectFileCommand extends PrintMessageCommand {
  command: MessageCommand.PROJECT_FILE;
  plate_idx: StringNumber;
  subtask_name: string;
  url: string;
  timestamp: number;
}
