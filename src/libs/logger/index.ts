import type { Logger } from "pino";
import pino from "pino";

import { APP_DEBUG } from "../../constants";

const logger = pino({ level: APP_DEBUG ? "debug" : "info" });

export const getLogger = (name: string): Logger => logger.child({ service: name });
