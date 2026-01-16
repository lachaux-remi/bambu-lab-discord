import type { MessageCommand } from "../enums";

export interface PrintMessage {
  print: PrintMessageCommand;
}

export interface PrintMessageCommand {
  command: MessageCommand;
  [key: string]: unknown;
}
