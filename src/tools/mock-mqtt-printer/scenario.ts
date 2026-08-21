import { readFileSync } from "node:fs";

import { CommandResult, PrintState } from "../../enums";

const PRINT_STATES = new Set<string>(Object.values(PrintState));
const COMMAND_RESULTS = new Set<string>(Object.values(CommandResult));
const MAX_BURST_MESSAGES = 10_000;
const MAX_DURATION_MS = 10 * 60_000;

export interface ProjectStep {
  action: "project";
  payload?: Record<string, unknown>;
}

export interface StatusStep {
  action: "status";
  state?: PrintState;
  payload?: Record<string, unknown>;
}

export interface StopStep {
  action: "stop";
  result: CommandResult;
}

export interface RawStep {
  action: "raw";
  payload: string;
}

export type PublishStep = ProjectStep | RawStep | StatusStep | StopStep;

export interface BurstStep {
  action: "burst";
  count: number;
  messages: PublishStep[];
}

export interface OutageStep {
  action: "outage";
  durationMs: number;
  resume?: Omit<StatusStep, "action">;
}

export interface RestartStep {
  action: "restart";
  resume: Omit<StatusStep, "action">;
}

export interface WaitStep {
  action: "wait";
  durationMs: number;
}

export type ScenarioStep = BurstStep | OutageStep | PublishStep | RestartStep | WaitStep;

export interface ScenarioExpectation {
  final?: {
    connected?: boolean;
    progressPercent?: number;
    running?: boolean;
    state?: PrintState;
  };
  includeNotificationTitles?: string[];
  excludeNotificationTitles?: string[];
  maximumNotificationCount?: number;
  minimumPushallCount?: number;
  requiredTagsByNotificationTitle?: Record<string, string[]>;
  threadCount?: number;
}

export interface PrinterScenario {
  version: 1;
  name: string;
  description?: string;
  steps: ScenarioStep[];
  expect: ScenarioExpectation;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fail = (path: string, message: string): never => {
  throw new Error(`Invalid mock printer scenario at ${path}: ${message}`);
};

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    fail(path, "must be an object");
  }
}

const readOptionalPayload = (value: Record<string, unknown>, path: string): Record<string, unknown> | undefined => {
  const payload = value.payload;
  if (payload === undefined) {
    return undefined;
  }
  assertRecord(payload, `${path}.payload`);
  if ("command" in payload || "gcode_state" in payload) {
    fail(`${path}.payload`, "command and gcode_state are owned by the scenario action");
  }
  return payload;
};

const readDuration = (value: unknown, path: string): number => {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > MAX_DURATION_MS) {
    fail(path, `must be an integer between 0 and ${MAX_DURATION_MS}`);
  }
  return Number(value);
};

const readStatus = (value: Record<string, unknown>, path: string): StatusStep => {
  const state = value.state;
  if (state !== undefined && (typeof state !== "string" || !PRINT_STATES.has(state))) {
    fail(`${path}.state`, `must be one of ${Array.from(PRINT_STATES).join(", ")}`);
  }
  const payload = readOptionalPayload(value, path);
  if (state === undefined && payload === undefined) {
    fail(path, "requires state or payload");
  }
  return {
    action: "status",
    ...(state === undefined ? {} : { state: state as PrintState }),
    ...(payload ? { payload } : {})
  };
};

const readPublishStep = (value: unknown, path: string): PublishStep => {
  assertRecord(value, path);
  const action = value.action;
  if (typeof action !== "string") {
    return fail(path, "must be an object with an action");
  }

  switch (action) {
    case "project": {
      const payload = readOptionalPayload(value, path);
      return { action: "project", ...(payload ? { payload } : {}) };
    }
    case "status":
      return readStatus(value, path);
    case "stop": {
      const result = value.result;
      if (typeof result !== "string" || !COMMAND_RESULTS.has(result)) {
        return fail(`${path}.result`, `must be one of ${Array.from(COMMAND_RESULTS).join(", ")}`);
      }
      return { action: "stop", result: result as CommandResult };
    }
    case "raw": {
      const payload = value.payload;
      if (typeof payload !== "string") {
        return fail(`${path}.payload`, "must be a string");
      }
      return { action: "raw", payload };
    }
    default:
      return fail(`${path}.action`, "must publish project, status, stop, or raw");
  }
};

const readStep = (value: unknown, path: string): ScenarioStep => {
  assertRecord(value, path);
  const action = value.action;
  if (typeof action !== "string") {
    return fail(path, "must be an object with an action");
  }
  if (["project", "status", "stop", "raw"].includes(action)) {
    return readPublishStep(value, path);
  }

  if (action === "wait") {
    return { action: "wait", durationMs: readDuration(value.durationMs, `${path}.durationMs`) };
  }

  if (action === "outage") {
    const resume = value.resume;
    if (resume !== undefined) {
      assertRecord(resume, `${path}.resume`);
    }
    const status = resume ? readStatus(resume, `${path}.resume`) : undefined;
    return {
      action: "outage",
      durationMs: readDuration(value.durationMs, `${path}.durationMs`),
      ...(status ? { resume: { state: status.state, payload: status.payload } } : {})
    };
  }

  if (action === "restart") {
    const resume = value.resume;
    assertRecord(resume, `${path}.resume`);
    const status = readStatus(resume, `${path}.resume`);
    return { action: "restart", resume: { state: status.state, payload: status.payload } };
  }

  if (action === "burst") {
    if (!Number.isInteger(value.count) || Number(value.count) < 1 || Number(value.count) > MAX_BURST_MESSAGES) {
      fail(`${path}.count`, `must be an integer between 1 and ${MAX_BURST_MESSAGES}`);
    }
    const messages = value.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return fail(`${path}.messages`, "must be a non-empty array");
    }
    return {
      action: "burst",
      count: Number(value.count),
      messages: messages.map((message, index) => readPublishStep(message, `${path}.messages[${index}]`))
    };
  }

  return fail(`${path}.action`, "must be project, status, stop, raw, burst, outage, restart, or wait");
};

const readStringArray = (value: unknown, path: string): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every(item => typeof item === "string" && item.length > 0)) {
    fail(path, "must be an array of non-empty strings");
  }
  return value as string[];
};

const readRequiredTags = (value: unknown): Record<string, string[]> | undefined => {
  if (value === undefined) {
    return undefined;
  }
  assertRecord(value, "expect.requiredTagsByNotificationTitle");
  const entries = Object.entries(value);
  if (entries.some(([title]) => title.length === 0)) {
    fail("expect.requiredTagsByNotificationTitle", "must use non-empty notification titles");
  }
  const parsed: Record<string, string[]> = {};
  for (const [title, tags] of entries) {
    const parsedTags = readStringArray(tags, `expect.requiredTagsByNotificationTitle.${title}`) ?? [];
    if (parsedTags.length === 0) {
      fail(`expect.requiredTagsByNotificationTitle.${title}`, "must contain at least one tag");
    }
    parsed[title] = parsedTags;
  }
  return parsed;
};

const readExpectation = (value: unknown): ScenarioExpectation => {
  assertRecord(value, "expect");
  const final = value.final;
  if (final !== undefined) {
    assertRecord(final, "expect.final");
  }
  if (final?.state !== undefined && (typeof final.state !== "string" || !PRINT_STATES.has(final.state))) {
    fail("expect.final.state", `must be one of ${Array.from(PRINT_STATES).join(", ")}`);
  }
  for (const key of ["connected", "running"] as const) {
    if (final?.[key] !== undefined && typeof final[key] !== "boolean") {
      fail(`expect.final.${key}`, "must be a boolean");
    }
  }
  if (final?.progressPercent !== undefined && !Number.isFinite(final.progressPercent)) {
    fail("expect.final.progressPercent", "must be a finite number");
  }
  for (const key of ["maximumNotificationCount", "minimumPushallCount", "threadCount"] as const) {
    if (value[key] !== undefined && (!Number.isInteger(value[key]) || Number(value[key]) < 0)) {
      fail(`expect.${key}`, "must be a non-negative integer");
    }
  }
  const includeNotificationTitles = readStringArray(
    value.includeNotificationTitles,
    "expect.includeNotificationTitles"
  );
  const excludeNotificationTitles = readStringArray(
    value.excludeNotificationTitles,
    "expect.excludeNotificationTitles"
  );
  const requiredTagsByNotificationTitle = readRequiredTags(value.requiredTagsByNotificationTitle);

  return {
    ...(final
      ? {
          final: {
            ...(final.connected === undefined ? {} : { connected: final.connected as boolean }),
            ...(final.progressPercent === undefined ? {} : { progressPercent: Number(final.progressPercent) }),
            ...(final.running === undefined ? {} : { running: final.running as boolean }),
            ...(final.state === undefined ? {} : { state: final.state as PrintState })
          }
        }
      : {}),
    ...(includeNotificationTitles ? { includeNotificationTitles } : {}),
    ...(excludeNotificationTitles ? { excludeNotificationTitles } : {}),
    ...(requiredTagsByNotificationTitle ? { requiredTagsByNotificationTitle } : {}),
    ...(value.maximumNotificationCount === undefined
      ? {}
      : { maximumNotificationCount: Number(value.maximumNotificationCount) }),
    ...(value.minimumPushallCount === undefined ? {} : { minimumPushallCount: Number(value.minimumPushallCount) }),
    ...(value.threadCount === undefined ? {} : { threadCount: Number(value.threadCount) })
  };
};

export const parseScenario = (value: unknown): PrinterScenario => {
  assertRecord(value, "root");
  if (value.version !== 1) {
    fail("version", "must equal 1");
  }
  const name = value.name;
  if (typeof name !== "string" || name.trim() === "") {
    return fail("name", "must be a non-empty string");
  }
  if (value.description !== undefined && typeof value.description !== "string") {
    fail("description", "must be a string");
  }
  const steps = value.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    return fail("steps", "must be a non-empty array");
  }

  return {
    version: 1,
    name,
    ...(value.description === undefined ? {} : { description: value.description as string }),
    steps: steps.map((step, index) => readStep(step, `steps[${index}]`)),
    expect: readExpectation(value.expect)
  };
};

export const loadScenario = (path: string): PrinterScenario => {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read mock printer scenario ${path}`, { cause: error });
  }
  return parseScenario(value);
};
