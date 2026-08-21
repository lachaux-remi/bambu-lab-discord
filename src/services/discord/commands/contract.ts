export const PRINTER_COMMAND_NAME = "printer";

export const PRINTER_SUBCOMMAND = {
  ADD: "add",
  EDIT: "edit",
  LIST: "list",
  RECONNECT: "reconnect",
  REMOVE: "remove",
  SCREENSHOT: "screenshot",
  STATUS: "status"
} as const;

export const PRINTER_OPTION = {
  ACCESS_CODE: "access_code",
  CHANNEL: "channel",
  ENABLED: "enabled",
  IP: "ip",
  NAME: "name",
  NEW_NAME: "new_name",
  PORT: "port",
  RTC_PORT: "rtc_port",
  SERIAL: "serial"
} as const;
