import { MessageCommand, PrintState } from "../../src/enums";
import type { PrintMessageCommand } from "../../src/types/printer-messages";

// Minimal, anonymized payloads captured from a real two-color P1S print on 2026-08-20.
// Hardware identifiers, project metadata, network data, credentials, and live-view data are excluded.
export const realMqttMulticolorCycle = [
  {
    command: MessageCommand.PROJECT_FILE,
    subtask_id: "multicolor-subtask-fixture",
    task_id: "multicolor-task-fixture",
    model_id: "multicolor-model-fixture",
    plate_idx: "1",
    subtask_name: "Multicolor fixture print",
    use_ams: true,
    ams_mapping: [0, -1, 2, -1],
    ams_mapping2: [
      { ams_id: 0, slot_id: 0 },
      { ams_id: 255, slot_id: 255 },
      { ams_id: 0, slot_id: 2 },
      { ams_id: 255, slot_id: 255 }
    ]
  },
  {
    command: MessageCommand.PUSH_STATUS,
    subtask_id: "multicolor-subtask-fixture",
    task_id: "multicolor-task-fixture",
    gcode_file: "multicolor-fixture.gcode.3mf",
    subtask_name: "Multicolor fixture print",
    gcode_state: PrintState.PREPARE
  },
  {
    command: MessageCommand.PUSH_STATUS,
    gcode_state: PrintState.RUNNING,
    layer_num: 0,
    mc_percent: 0
  },
  {
    command: MessageCommand.PUSH_STATUS,
    gcode_state: PrintState.RUNNING,
    layer_num: 1,
    total_layer_num: 26,
    mc_percent: 57
  },
  {
    command: MessageCommand.PUSH_STATUS,
    gcode_state: PrintState.RUNNING,
    layer_num: 26,
    mc_percent: 98
  },
  {
    command: MessageCommand.PUSH_STATUS,
    gcode_state: PrintState.FINISH,
    layer_num: 26,
    total_layer_num: 26,
    mc_percent: 100
  }
] satisfies readonly PrintMessageCommand[];
