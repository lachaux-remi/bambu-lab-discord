import type { CommandResult, MessageCommand } from "../enums";
import type { ProjectFileCommand } from "./project-file";
import type { PushStatusCommand } from "./push-status";

export interface PrintMessage {
  print: PrintMessageCommand;
}

export interface StopCommand {
  command: MessageCommand.STOP;
  result?: CommandResult;
}

export type PrintMessageCommand = ProjectFileCommand | PushStatusCommand | StopCommand;
