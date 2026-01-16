import type { PrintState } from "../enums";
import type { HexColor, StringNumber } from "./general";

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
  trayColor: HexColor;
  trayType: string;
  isMulticolor: boolean;
}
