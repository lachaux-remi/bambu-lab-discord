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
  /** Buffer de l'image de prévisualisation du projet (extrait du fichier 3mf) */
  projectImage: Buffer | null;
  plate: StringNumber;
  trayColor: HexColor;
  trayType: string;
  isMulticolor: boolean;
}
