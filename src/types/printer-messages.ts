import { MessageCommand } from "../enums";

export interface PrintMessage {
  print: PrintMessageCommand;
}

export type PrintMessageCommand = {
  command: MessageCommand;
} & Record<string, unknown>;
