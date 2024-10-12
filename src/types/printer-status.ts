import { PrintState } from "../enums";

export interface Status {
  state: PrintState;
  currentLayer: number;
  maxLayers: number;
  progressPercent: number;
  startedAt: number;
  remainingTime: number;
  taskName: string;
  projectImageUrl: string;
  trayColor: `#${string}`;
  trayType: string;
}
