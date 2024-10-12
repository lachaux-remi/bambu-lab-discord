import { MessageCommand } from "../enums";
import type { PrintMessageCommand } from "./printer-messages";

export interface ProjectFileCommand extends PrintMessageCommand {
  command: MessageCommand.PROJECT_FILE;
  subtask_name: string;
  url: string;
  timestamp: number;
}
