import { S3_BUCKET, S3_ENDPOINT } from "../../constants";
import { MessageCommand } from "../../enums";
import { uploadProjectImage } from "../../libs/s3-storage";
import type { PrintMessageCommand } from "../../types/printer-messages";
import type { Status } from "../../types/printer-status";
import type { ProjectFileCommand } from "../../types/project-file";
import type { PushStatusCommand } from "../../types/push-status";
import BambuLabClient from "../bambu-lab";

export default class {
  private latestStatus: Status = {} as Status;

  public constructor(private client: BambuLabClient) {}

  public async onUpdate(data: PrintMessageCommand): Promise<void> {
    const newStatus: Status = {} as Status;

    if (this.isProjectFileCommand(data)) {
      newStatus.taskName = data.subtask_name;

      if (data.url.startsWith("https://")) {
        await uploadProjectImage(data.url, data.subtask_name, data.plate_idx);
      }

      newStatus.projectImageUrl = encodeURI(
        `${S3_ENDPOINT}/${S3_BUCKET}/projects/${data.subtask_name}.${data.plate_idx}.png`
      );

      newStatus.startedAt = data.timestamp;
    } else if (this.isPushStatusCommand(data)) {
      if (data.gcode_state) {
        newStatus.state = data.gcode_state;
      }

      if (data.layer_num) {
        newStatus.currentLayer = data.layer_num;
      }

      if (data.total_layer_num) {
        newStatus.maxLayers = data.total_layer_num;
      }

      if (data.mc_percent) {
        newStatus.progressPercent = Number(data.mc_percent);
      }

      if (data.mc_remaining_time) {
        newStatus.remainingTime = Number(data.mc_remaining_time);
      }

      if (data.subtask_name) {
        newStatus.taskName = data.subtask_name;
      }
    } else {
      return;
    }

    const oldStatus = { ...this.latestStatus };
    this.latestStatus = Object.assign(this.latestStatus, newStatus);
    this.client.emit("status", this.latestStatus, oldStatus);
  }

  protected isPushStatusCommand(data: PrintMessageCommand): data is PushStatusCommand {
    return data.command === MessageCommand.PUSH_STATUS;
  }

  protected isProjectFileCommand(data: PrintMessageCommand): data is ProjectFileCommand {
    return data.command === MessageCommand.PROJECT_FILE;
  }
}
