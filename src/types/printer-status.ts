import { PrintState } from "../enums";
import type { StringNumber } from "./general";

export interface Status {
  state: PrintState;
  currentLayer: number;
  maxLayers: number;
  progressPercent: number;
  startedAt: number;
  remainingTime: number;
  model: string;
  project: string;
  projectImageUrl: string | null;
  plate: StringNumber;
  trayColor: `#${string}`;
  trayType: string;
  isMulticolor: boolean;
}
