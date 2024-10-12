import { MessageCommand } from "../../enums";
import type { PrintMessageCommand, ProjectFileCommand, PushStatusCommand, Status } from "../../types";
import BambuLabClient from "../bambu-lab";

export default class {
  private latestStatus: Status = {} as Status;

  public constructor(private client: BambuLabClient) {}

  public onUpdate(data: PrintMessageCommand): void {
    const newStatus: Status = {} as Status;

    if (this.isProjectFileCommand(data)) {
      if (data.subtask_name) {
        newStatus.taskName = data.subtask_name;
      }

      if (data.url) {
        newStatus.url = data.url;
      }

      if (data.timestamp) {
        newStatus.startedAt = data.timestamp;
      }
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

      if (data.ams.tray_now) {
        const currentTray = data.ams.ams
          .find(ams => ams.tray.some(tray => tray?.id === data.ams.tray_now))
          ?.tray.find(tray => tray?.id === data.ams.tray_now);

        if (currentTray) {
          newStatus.trayColor = `#${currentTray.tray_color}`;
          newStatus.trayType = currentTray.tray_type;
        }
      }
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