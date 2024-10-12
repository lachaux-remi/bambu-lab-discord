import type { Status } from ".";

export interface ClientEvents {
  status: [status: Status, latestStatus: Status];
}
