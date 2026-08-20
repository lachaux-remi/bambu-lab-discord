export enum MessageCommand {
  PUSH_STATUS = "push_status",
  PROJECT_FILE = "project_file",
  STOP = "stop"
}

export enum CommandResult {
  SUCCESS = "success",
  FAILED = "failed"
}

export enum LightMode {
  ON = "on",
  OFF = "off"
}

export enum LightNode {
  CHAMBER = "chamber_light"
}

export enum PrintState {
  UNKNOWN = "UNKNOWN",
  PREPARE = "PREPARE",
  RUNNING = "RUNNING",
  PAUSE = "PAUSE",
  FAILED = "FAILED",
  FINISH = "FINISH",
  IDLE = "IDLE"
}

export enum ForumTag {
  IN_PROGRESS = "En cours",
  SUCCEEDED = "Réussi",
  FAILED = "Échoué",
  PAUSED = "En pause",
  ATTENTION = "Attention",
  MULTICOLOR = "Multicolore",
  MONOCOLOR = "Monocolor"
}
