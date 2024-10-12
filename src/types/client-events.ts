import type { Status } from "./printer-status";

export interface ClientEvents {
  status: [status: Status, latestStatus: Status];
}
