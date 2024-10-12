import type { PrintMessageCommand } from ".";
import { MessageCommand } from "../enums";

export interface ProjectFileCommand extends PrintMessageCommand {
  command: MessageCommand.PROJECT_FILE;
  subtask_name: string;
  url: string;
  timestamp: number;
}
