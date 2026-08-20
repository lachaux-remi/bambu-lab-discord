import { CommandResult, MessageCommand, PrintState } from "../../enums";
import { getLogger } from "../../libs/logger";
import { extractProjectImage } from "../../libs/project";
import type { StringNumber } from "../../types/general";
import type { PrintMessageCommand } from "../../types/printer-messages";
import type { Status } from "../../types/printer-status";
import type { ProjectFileCommand } from "../../types/project-file";
import type { PushStatusCommand } from "../../types/push-status";
import { isMulticolorPrint } from "../../utils/print.util";
import BambuLabClient from "../bambu-lab";

const logger = getLogger("PrinterStatus");

const normalizePrintId = (value: string | number | undefined): string | undefined => {
  const normalized = value === undefined ? "" : String(value).trim();
  return normalized && normalized !== "0" ? normalized : undefined;
};

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

      newStatus.subtaskId = normalizePrintId(data.subtask_id);
      newStatus.taskId = normalizePrintId(data.task_id);
      newStatus.gcodeFile = data.gcode_file?.trim() || undefined;

      if (data.plate_idx !== undefined) {
        newStatus.plate = data.plate_idx;
      }

      // Détecter si l'impression est multicolore
      if (data.ams_mapping) {
        newStatus.isMulticolor = isMulticolorPrint(data.ams_mapping);
        logger.debug({ amsMapping: data.ams_mapping, isMulticolor: newStatus.isMulticolor }, "Multicolor detection");
      }

      if (data.url && data.url.startsWith("https://") && data.plate_idx !== undefined) {
        newStatus.projectImage = await extractProjectImage({
          url: data.url,
          plate: String(data.plate_idx) as StringNumber
        });
      }

      newStatus.state = PrintState.PREPARE;
      newStatus.currentLayer = 0;
      newStatus.maxLayers = 0;
      newStatus.progressPercent = 0;
      newStatus.remainingTime = 0;
      newStatus.startedAt = new Date().getTime();
      newStatus.cancellationRequested = false;
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

      if (data.subtask_id !== undefined) {
        newStatus.subtaskId = normalizePrintId(data.subtask_id);
      }

      if (data.task_id !== undefined) {
        newStatus.taskId = normalizePrintId(data.task_id);
      }

      if (data.gcode_file !== undefined) {
        newStatus.gcodeFile = data.gcode_file.trim() || undefined;
      }

      if (data.plate_idx !== undefined) {
        newStatus.plate = data.plate_idx;
      }

      if (data.gcode_state) {
        newStatus.state = data.gcode_state;
        const startsNewPrint =
          [PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(this.latestStatus.state) &&
          [PrintState.PREPARE, PrintState.RUNNING, PrintState.PAUSE].includes(data.gcode_state);
        if (startsNewPrint) {
          newStatus.cancellationRequested = false;
        }
        if (
          [PrintState.RUNNING, PrintState.PAUSE].includes(data.gcode_state) &&
          (this.latestStatus.startedAt === undefined || startsNewPrint)
        ) {
          newStatus.startedAt = Math.max(Date.now(), (this.latestStatus.startedAt ?? -1) + 1);
        }
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
    } else if (data.command === MessageCommand.STOP) {
      if (data.result !== CommandResult.SUCCESS) {
        return;
      }
      newStatus.cancellationRequested = true;
      this.latestStatus.cancellationRequested = true;
      await this.client.emitCancellationRequested();
      return;
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
      newStatus.projectImage !== undefined ||
      newStatus.subtaskId !== undefined ||
      newStatus.taskId !== undefined ||
      newStatus.gcodeFile !== undefined ||
      newStatus.plate !== undefined;

    if (hasImportantChanges) {
      logger.debug(
        { oldState: oldStatus.state, newState: this.latestStatus.state, changes: Object.keys(newStatus) },
        "Status updated, emitting event"
      );
      await this.client.emitStatus(this.latestStatus, oldStatus);
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
