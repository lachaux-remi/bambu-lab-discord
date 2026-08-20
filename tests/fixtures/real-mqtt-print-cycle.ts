import { MessageCommand, PrintState } from "../../src/enums";
import type { PrintMessageCommand } from "../../src/types/printer-messages";

// Minimal, anonymized payloads captured from a real P1S print on 2026-08-20.
// Network data, credentials, signed URLs, serials, and cloud identifiers are intentionally excluded.
export const realMqttPrintCycle = [
  {
    command: MessageCommand.PROJECT_FILE,
    subtask_id: "subtask-fixture",
    task_id: "task-fixture",
    model_id: "model-fixture",
    plate_idx: "1",
    subtask_name: "Fixture print",
    use_ams: true,
    ams_mapping: [0, -1, -1, -1]
  },
  {
    command: MessageCommand.PUSH_STATUS,
    subtask_id: "subtask-fixture",
    task_id: "task-fixture",
    gcode_file: "fixture.gcode.3mf",
    subtask_name: "Fixture print",
    gcode_state: PrintState.PREPARE
  },
  {
    command: MessageCommand.PUSH_STATUS,
    gcode_state: PrintState.RUNNING,
    total_layer_num: 26
  },
  {
    command: MessageCommand.PUSH_STATUS,
    mc_percent: 80,
    layer_num: 5
  },
  {
    command: MessageCommand.PUSH_STATUS,
    gcode_state: PrintState.PAUSE
  },
  {
    command: MessageCommand.PUSH_STATUS,
    gcode_state: PrintState.RUNNING
  },
  {
    command: MessageCommand.PUSH_STATUS,
    gcode_file: "fixture.gcode.3mf",
    gcode_state: PrintState.FINISH,
    mc_percent: 100
  }
] satisfies readonly PrintMessageCommand[];
