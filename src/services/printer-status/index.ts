import { MessageCommand, PrintState } from "../../enums";
import { getLogger } from "../../libs/logger";
import { extractProjectImage } from "../../libs/project";
import type { PrintMessageCommand } from "../../types/printer-messages";
import type { Status } from "../../types/printer-status";
import type { ProjectFileCommand } from "../../types/project-file";
import type { PushStatusCommand } from "../../types/push-status";
import { isMulticolorPrint } from "../../utils/print.util";
import BambuLabClient from "../bambu-lab";

const logger = getLogger("PrinterStatus");

export default class PrinterStatus {
  private latestStatus: Status = {} as Status;

  public constructor(private client: BambuLabClient) {}

  public async onUpdate(data: PrintMessageCommand): Promise<void> {
    const newStatus: Status = {} as Status;

    if (this.isProjectFileCommand(data)) {
      logger.debug(
        { model: data.model_id, project: data.subtask_name, plate: data.plate_idx },
        "Project file received"
      );

      if (data.model_id) {
        newStatus.model = data.model_id;
      }

      if (data.subtask_name) {
        newStatus.project = data.subtask_name;
      }

      if (data.plate_idx) {
        newStatus.plate = data.plate_idx;
      }

      // Détecter si l'impression est multicolore
      if (data.ams_mapping) {
        newStatus.isMulticolor = isMulticolorPrint(data.ams_mapping);
        logger.debug({ amsMapping: data.ams_mapping, isMulticolor: newStatus.isMulticolor }, "Multicolor detection");
      }

      if (data.url && data.url.startsWith("https://") && data.plate_idx) {
        newStatus.projectImage = await extractProjectImage({
          url: data.url,
          plate: data.plate_idx
        });
      }

      newStatus.state = PrintState.PREPARE;
      newStatus.currentLayer = 0;
      newStatus.maxLayers = 0;
      newStatus.progressPercent = 0;
      newStatus.remainingTime = 0;
      newStatus.startedAt = new Date().getTime();
    } else if (this.isPushStatusCommand(data)) {
      logger.debug(
        {
          subtask: data.subtask_name,
          state: data.gcode_state,
          layer: data.layer_num,
          total: data.total_layer_num,
          percent: data.mc_percent
        },
        "Push status received"
      );

      // Mettre à jour tous les champs présents dans le message
      if (data.subtask_name) {
        newStatus.project = data.subtask_name;
      }

      if (data.gcode_state) {
        newStatus.state = data.gcode_state;
      }
      // Mettre à jour les informations de progression si elles sont présentes
      // (indépendamment de l'état actuel, car les messages sont incrémentaux)
      if (data.layer_num !== undefined) {
        newStatus.currentLayer = data.layer_num;
      }

      if (data.total_layer_num !== undefined) {
        newStatus.maxLayers = data.total_layer_num;
      }

      if (data.mc_percent !== undefined) {
        newStatus.progressPercent = Number(data.mc_percent);
      }

      if (data.mc_remaining_time !== undefined) {
        newStatus.remainingTime = Number(data.mc_remaining_time);
      }
    } else {
      logger.warn({ command: data.command, keys: Object.keys(data) }, "Unknown message command type");
      return;
    }

    const oldStatus = { ...this.latestStatus };
    this.latestStatus = Object.assign(this.latestStatus, newStatus);

    // Émettre l'événement seulement si des champs importants ont changé
    const hasImportantChanges =
      newStatus.state !== undefined ||
      newStatus.progressPercent !== undefined ||
      newStatus.currentLayer !== undefined ||
      newStatus.project !== undefined ||
      newStatus.projectImage !== undefined;

    if (hasImportantChanges) {
      logger.debug(
        { oldState: oldStatus.state, newState: this.latestStatus.state, changes: Object.keys(newStatus) },
        "Status updated, emitting event"
      );
      this.client.emit("status", this.latestStatus, oldStatus);
    } else {
      logger.debug({ changes: Object.keys(newStatus) }, "Non-critical update, skipping event emission");
    }
  }

  protected isPushStatusCommand(data: PrintMessageCommand): data is PushStatusCommand {
    return data.command === MessageCommand.PUSH_STATUS;
  }

  protected isProjectFileCommand(data: PrintMessageCommand): data is ProjectFileCommand {
    return data.command === MessageCommand.PROJECT_FILE;
  }
}
