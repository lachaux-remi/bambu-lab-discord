import { CommandResult, PrintState } from "../../enums";
import { DISCORD_ATTACHMENT_SIZE_LIMIT } from "../../services/discord/payload";
import type { PrinterScenario, ScenarioStep, StatusStep } from "./scenario";
import { parseScenario } from "./scenario";
import {
  DEFAULT_CAMERA_PLACEHOLDER,
  DEFAULT_PROJECT_PLACEHOLDER,
  type DiscordE2EOptions,
  type DiscordTargetDetails,
  type ScenarioPrinterOptions,
  ScenarioSession,
  type ScenarioSessionOptions,
  type ScenarioSessionSnapshot,
  inspectDiscordTarget
} from "./session";

const MAX_MQTT_PAYLOAD_SIZE = 1024 * 1024;
const MAX_AUTO_DURATION_MS = 24 * 60 * 60_000;
const MAX_AUTO_STEPS = 1_000;
const MAX_SPEED = 10_000;

export type PlaceholderKind = "camera" | "project";

export interface BenchHistoryEntry {
  at: number;
  detail?: string;
  id: number;
  kind: "action" | "admin" | "error" | "lifecycle";
  label: string;
  status: "failed" | "pending" | "succeeded";
}

export interface StartBenchInput {
  confirmDiscordTarget?: string;
  discordEnabled?: boolean;
  printer: ScenarioPrinterOptions;
  speed: number;
}

export interface AutoRunInput {
  durationMs: number;
  project: Record<string, unknown>;
  speed: number;
  status: Record<string, unknown>;
  steps: number;
}

interface AutoRunState {
  completedSteps: number;
  durationMs: number;
  paused: boolean;
  speed: number;
  statusPayload: Record<string, unknown>;
  steps: number;
  timer?: NodeJS.Timeout;
}

interface PendingOutage {
  autoWasRunning: boolean;
  durationMs: number;
}

interface SessionConfiguration {
  discordEnabled: boolean;
  printer: ScenarioPrinterOptions;
  speed: number;
}

interface ScenarioSessionContract {
  deleteDiscordThread(threadId: string): Promise<void>;
  disconnectMqtt(): Promise<void>;
  play(scenario: PrinterScenario): Promise<unknown>;
  playSteps(steps: ScenarioStep[]): Promise<unknown>;
  reconnectMqtt(resume?: Omit<StatusStep, "action">): Promise<void>;
  setCameraPlaceholder(buffer: Buffer): void;
  setProjectPlaceholder(buffer: Buffer): void;
  snapshot(): ScenarioSessionSnapshot;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface WebBenchControllerOptions {
  createSession?: (options: ScenarioSessionOptions) => ScenarioSessionContract;
  discord?: DiscordE2EOptions;
  inspectDiscord?: (options: DiscordE2EOptions) => Promise<DiscordTargetDetails>;
}

export interface WebBenchState {
  auto: {
    active: boolean;
    completedSteps: number;
    paused: boolean;
    steps: number;
  };
  discord: {
    active: boolean;
    available: boolean;
    target?: DiscordTargetDetails;
  };
  history: BenchHistoryEntry[];
  outage?: { durationMs: number; provisional: true };
  scenario: PrinterScenario;
  session?: ScenarioSessionSnapshot;
  simulationRestartRequired: boolean;
}

const ensureRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const readInteger = (value: unknown, label: string, minimum: number, maximum: number): number => {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
};

const readSpeed = (value: unknown): number => {
  if (!Number.isFinite(value) || Number(value) < 1 || Number(value) > MAX_SPEED) {
    throw new Error(`speed must be a number between 1 and ${MAX_SPEED}`);
  }
  return Number(value);
};

const readNonEmptyString = (value: unknown, label: string, maximum = 128): string => {
  if (typeof value !== "string" || value.trim() === "" || value.length > maximum) {
    throw new Error(`${label} must be a non-empty string of at most ${maximum} characters`);
  }
  return value.trim();
};

const parsePrinter = (value: unknown): ScenarioPrinterOptions => {
  const printer = ensureRecord(value, "printer");
  return {
    id: readNonEmptyString(printer.id, "printer.id", 64),
    name: readNonEmptyString(printer.name, "printer.name", 100),
    serial: readNonEmptyString(printer.serial, "printer.serial", 128),
    accessCode: readNonEmptyString(printer.accessCode, "printer.accessCode", 128)
  };
};

const parseSteps = (value: unknown): ScenarioStep[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("steps must be a non-empty array");
  }
  const scenario = parseScenario({ version: 1, name: "web-action", steps: value, expect: {} });
  const inspectPayload = (step: ScenarioStep): void => {
    if (step.action === "raw" && Buffer.byteLength(step.payload) > MAX_MQTT_PAYLOAD_SIZE) {
      throw new Error(`raw payload exceeds the production MQTT limit of ${MAX_MQTT_PAYLOAD_SIZE} bytes`);
    }
    if (step.action === "burst") {
      step.messages.forEach(inspectPayload);
    }
  };
  scenario.steps.forEach(inspectPayload);
  return scenario.steps;
};

const parseImage = (buffer: Buffer, contentType: string): Buffer => {
  if (buffer.length === 0) {
    throw new Error("image upload is empty");
  }
  if (buffer.length > DISCORD_ATTACHMENT_SIZE_LIMIT) {
    throw new Error(`image exceeds the Discord attachment limit of ${DISCORD_ATTACHMENT_SIZE_LIMIT} bytes`);
  }
  const isPng = contentType === "image/png" && buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  const isJpeg = contentType === "image/jpeg" && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!isPng && !isJpeg) {
    throw new Error("image must be a valid PNG or JPEG");
  }
  return Buffer.from(buffer);
};

const isTerminalStep = (step: ScenarioStep): boolean =>
  step.action === "stop" ||
  (step.action === "status" &&
    step.state !== undefined &&
    [PrintState.FINISH, PrintState.FAILED, PrintState.IDLE].includes(step.state));

export class WebBenchController {
  private readonly createSession: NonNullable<WebBenchControllerOptions["createSession"]>;
  private readonly inspectDiscord: NonNullable<WebBenchControllerOptions["inspectDiscord"]>;
  private readonly discord?: DiscordE2EOptions;
  private session?: ScenarioSessionContract;
  private sessionConfiguration?: SessionConfiguration;
  private target?: DiscordTargetDetails;
  private readonly placeholders: Record<PlaceholderKind, Buffer> = {
    camera: Buffer.from(DEFAULT_CAMERA_PLACEHOLDER),
    project: Buffer.from(DEFAULT_PROJECT_PLACEHOLDER)
  };
  private timeline: PrinterScenario = {
    version: 1,
    name: "interactive-web-session",
    description: "Actions exported from the mock MQTT printer web bench.",
    steps: [],
    expect: {}
  };
  private readonly history: BenchHistoryEntry[] = [];
  private nextHistoryId = 1;
  private auto?: AutoRunState;
  private outage?: PendingOutage;
  private actionQueue: Promise<void> = Promise.resolve();

  public constructor(options: WebBenchControllerOptions = {}) {
    this.createSession = options.createSession ?? (sessionOptions => new ScenarioSession(sessionOptions));
    this.inspectDiscord = options.inspectDiscord ?? inspectDiscordTarget;
    this.discord = options.discord;
  }

  public async inspectDiscordTarget(): Promise<DiscordTargetDetails> {
    if (!this.discord) {
      throw new Error("Real Discord mode was not enabled for this server");
    }
    this.target ??= await this.inspectDiscord(this.discord);
    return this.target;
  }

  public async start(value: unknown): Promise<void> {
    const input = ensureRecord(value, "session");
    const printer = parsePrinter(input.printer);
    const speed = readSpeed(input.speed);
    const discordEnabled = input.discordEnabled === true;
    if (discordEnabled) {
      const target = await this.inspectDiscordTarget();
      const expectedConfirmation = `${target.guildId}:${target.forumChannelId}`;
      if (input.confirmDiscordTarget !== expectedConfirmation) {
        throw new Error(`Real Discord requires confirmation for ${target.guildName} / ${target.forumName}`);
      }
    }

    await this.stopSession(false);
    this.sessionConfiguration = { printer, speed, discordEnabled };
    await this.createAndStartSession();
    this.record("lifecycle", "Simulation démarrée", "succeeded", discordEnabled ? "Discord réel" : "Discord mocké");
  }

  public async stop(): Promise<void> {
    await this.stopSession(true);
  }

  public async execute(value: unknown, label = "Action manuelle"): Promise<void> {
    const input = ensureRecord(value, "action");
    const steps = parseSteps(input.steps);
    await this.enqueue(async () => {
      if (steps.some(isTerminalStep)) {
        this.cancelAuto();
      }
      await this.requireSession().playSteps(steps);
      this.appendTimeline(steps);
      this.record("action", readNonEmptyString(input.label ?? label, "label", 120), "succeeded");
    });
  }

  public async startAuto(value: unknown): Promise<void> {
    const input = ensureRecord(value, "auto-run");
    if (this.auto) {
      throw new Error("An automatic print is already active");
    }
    const parsed: AutoRunInput = {
      durationMs: readInteger(input.durationMs, "durationMs", 1, MAX_AUTO_DURATION_MS),
      steps: readInteger(input.steps, "steps", 1, MAX_AUTO_STEPS),
      speed: readSpeed(input.speed),
      project: ensureRecord(input.project, "project"),
      status: ensureRecord(input.status, "status")
    };
    if (Math.ceil(parsed.durationMs / parsed.steps) > 10 * 60_000) {
      throw new Error("durationMs divided by steps must not exceed the scenario wait limit of 600000 ms");
    }
    const initialSteps = parseSteps([
      { action: "project", payload: parsed.project },
      {
        action: "status",
        state: PrintState.RUNNING,
        payload: {
          ...parsed.status,
          mc_percent: 0,
          mc_remaining_time: Math.ceil(parsed.durationMs / 60_000),
          layer_num: 0
        }
      }
    ]);
    await this.enqueue(async () => {
      await this.requireSession().playSteps(initialSteps);
      this.appendTimeline(initialSteps);
      this.auto = {
        completedSteps: 0,
        durationMs: parsed.durationMs,
        paused: false,
        speed: parsed.speed,
        statusPayload: parsed.status,
        steps: parsed.steps
      };
      this.record("action", "Impression automatique démarrée", "succeeded");
      this.scheduleAutoStep();
    });
  }

  public async pause(): Promise<void> {
    await this.enqueue(async () => {
      if (this.auto?.paused) {
        return;
      }
      this.suspendAutoTimer();
      const step: StatusStep = { action: "status", state: PrintState.PAUSE };
      await this.requireSession().playSteps([step]);
      this.appendTimeline([step]);
      if (this.auto) {
        this.auto.paused = true;
      }
      this.record("action", "Impression mise en pause", "succeeded");
    });
  }

  public async resume(): Promise<void> {
    await this.enqueue(async () => {
      const step: StatusStep = { action: "status", state: PrintState.RUNNING };
      await this.requireSession().playSteps([step]);
      this.appendTimeline([step]);
      if (this.auto) {
        this.auto.paused = false;
        this.scheduleAutoStep();
      }
      this.record("action", "Impression reprise", "succeeded");
    });
  }

  public async finish(outcome: unknown): Promise<void> {
    const value = ensureRecord(outcome, "outcome");
    const type = value.type;
    if (!["success", "failure", "cancel"].includes(String(type))) {
      throw new Error("outcome.type must be success, failure, or cancel");
    }
    await this.enqueue(async () => {
      this.cancelAuto();
      const current = this.requireSession().snapshot().current;
      const progress = current?.progressPercent ?? 0;
      const steps: ScenarioStep[] =
        type === "success"
          ? [{ action: "status", state: PrintState.FINISH, payload: { mc_percent: 100, mc_remaining_time: 0 } }]
          : type === "failure"
            ? [{ action: "status", state: PrintState.FAILED, payload: { mc_percent: progress } }]
            : [
                { action: "stop", result: CommandResult.SUCCESS },
                { action: "status", state: PrintState.FAILED, payload: { mc_percent: progress } }
              ];
      await this.requireSession().playSteps(steps);
      this.appendTimeline(steps);
      this.record(
        "action",
        type === "success" ? "Impression terminée" : type === "failure" ? "Impression échouée" : "Impression annulée",
        "succeeded"
      );
    });
  }

  public async disconnect(value: unknown): Promise<void> {
    const input = ensureRecord(value, "outage");
    const durationMs = readInteger(input.durationMs, "durationMs", 0, 10 * 60_000);
    await this.enqueue(async () => {
      if (this.outage) {
        throw new Error("An MQTT outage is already in progress");
      }
      const autoWasRunning = !!this.auto && !this.auto.paused;
      this.suspendAutoTimer();
      await this.requireSession().disconnectMqtt();
      this.outage = { durationMs, autoWasRunning };
      this.record("action", "Coupure MQTT provisoire", "pending", `${durationMs} ms logiques`);
    });
  }

  public async reconnect(value: unknown): Promise<void> {
    const input = ensureRecord(value, "reconnection");
    const outage = this.outage;
    if (!outage) {
      throw new Error("No MQTT outage is in progress");
    }
    const resumeScenario = parseScenario({
      version: 1,
      name: "reconnection",
      steps: [{ action: "status", state: input.state, payload: input.payload }],
      expect: {}
    });
    const resume = resumeScenario.steps[0];
    if (!resume || resume.action !== "status") {
      throw new Error("Reconnection requires a status state or payload");
    }
    await this.enqueue(async () => {
      await this.requireSession().reconnectMqtt({ state: resume.state, payload: resume.payload });
      this.appendTimeline([
        {
          action: "outage",
          durationMs: outage.durationMs,
          resume: { state: resume.state, payload: resume.payload }
        }
      ]);
      this.outage = undefined;
      if (outage.autoWasRunning && this.auto && !this.auto.paused) {
        this.scheduleAutoStep();
      }
      this.record("action", "Connexion MQTT rétablie", "succeeded");
    });
  }

  public upload(kind: PlaceholderKind, buffer: Buffer, contentType: string): void {
    const placeholder = parseImage(buffer, contentType);
    this.placeholders[kind] = placeholder;
    if (kind === "project") {
      this.session?.setProjectPlaceholder(placeholder);
    } else {
      this.session?.setCameraPlaceholder(placeholder);
    }
    this.record(
      "admin",
      kind === "project" ? "Placeholder projet remplacé" : "Placeholder caméra remplacé",
      "succeeded",
      `${buffer.length} octets`
    );
  }

  public getPlaceholder(kind: PlaceholderKind): Buffer {
    return Buffer.from(this.placeholders[kind]);
  }

  public importScenario(value: unknown): PrinterScenario {
    const scenario = parseScenario(value);
    this.timeline = scenario;
    this.record("admin", "Scénario JSON v1 importé", "succeeded", `${scenario.steps.length} étapes`);
    return this.exportScenario();
  }

  public exportScenario(): PrinterScenario {
    return structuredClone(this.timeline);
  }

  public async replay(): Promise<void> {
    if (this.outage) {
      throw new Error("Reconnect MQTT before replaying; a provisional outage is not exportable");
    }
    const scenario = this.exportScenario();
    if (scenario.steps.length === 0) {
      throw new Error("The scenario has no steps to replay");
    }
    this.cancelAuto();
    await this.stopSession(false);
    await this.createAndStartSession();
    await this.requireSession().play(scenario);
    this.record("lifecycle", "Scénario rejoué", "succeeded", `${scenario.steps.length} étapes`);
  }

  public async deleteThread(value: unknown): Promise<void> {
    const input = ensureRecord(value, "thread deletion");
    const threadId = readNonEmptyString(input.threadId, "threadId", 32);
    if (input.confirm !== true) {
      throw new Error("Thread deletion requires explicit confirmation");
    }
    await this.requireSession().deleteDiscordThread(threadId);
    this.record("admin", "Thread Discord supprimé", "succeeded", threadId);
  }

  public state(): WebBenchState {
    return {
      simulationRestartRequired: !this.session,
      discord: {
        available: this.discord !== undefined,
        active: this.session !== undefined && (this.sessionConfiguration?.discordEnabled ?? false),
        ...(this.target ? { target: this.target } : {})
      },
      auto: {
        active: this.auto !== undefined,
        paused: this.auto?.paused ?? false,
        completedSteps: this.auto?.completedSteps ?? 0,
        steps: this.auto?.steps ?? 0
      },
      ...(this.outage ? { outage: { durationMs: this.outage.durationMs, provisional: true as const } } : {}),
      scenario: this.exportScenario(),
      history: this.history.map(entry => ({ ...entry })),
      ...(this.session ? { session: this.session.snapshot() } : {})
    };
  }

  public async close(): Promise<void> {
    await this.stopSession(false);
  }

  private requireSession(): ScenarioSessionContract {
    if (!this.session) {
      throw new Error("Start the simulation before sending actions");
    }
    return this.session;
  }

  private async createAndStartSession(): Promise<void> {
    const configuration = this.sessionConfiguration;
    if (!configuration) {
      throw new Error("No simulation configuration is available");
    }
    const session = this.createSession({
      printer: configuration.printer,
      timeScale: 1 / configuration.speed,
      ...(configuration.discordEnabled && this.discord ? { discord: this.discord } : {})
    });
    session.setProjectPlaceholder(this.placeholders.project);
    session.setCameraPlaceholder(this.placeholders.camera);
    try {
      await session.start();
      this.session = session;
    } catch (error) {
      try {
        await session.stop();
      } catch (shutdownError) {
        throw new AggregateError([error, shutdownError], "Web bench session startup and shutdown failed", {
          cause: shutdownError
        });
      }
      throw error;
    }
  }

  private async stopSession(record: boolean): Promise<void> {
    this.cancelAuto();
    this.outage = undefined;
    const session = this.session;
    this.session = undefined;
    if (session) {
      await session.stop();
      if (record) {
        this.record("lifecycle", "Simulation arrêtée", "succeeded");
      }
    }
  }

  private appendTimeline(steps: ScenarioStep[]): void {
    this.timeline.steps.push(...structuredClone(steps));
    this.timeline.expect = {};
  }

  private scheduleAutoStep(): void {
    const auto = this.auto;
    if (!auto || auto.paused || auto.timer || auto.completedSteps >= auto.steps || this.outage) {
      return;
    }
    const previousTarget = Math.round((auto.durationMs * auto.completedSteps) / auto.steps);
    const nextTarget = Math.round((auto.durationMs * (auto.completedSteps + 1)) / auto.steps);
    const logicalDelay = nextTarget - previousTarget;
    auto.timer = setTimeout(
      () => {
        auto.timer = undefined;
        void this.enqueue(async () => {
          if (this.auto !== auto || auto.paused || this.outage) {
            return;
          }
          const completedSteps = auto.completedSteps + 1;
          const progress = Math.round((completedSteps * 100) / auto.steps);
          const totalLayers =
            typeof auto.statusPayload.total_layer_num === "number" ? auto.statusPayload.total_layer_num : auto.steps;
          const currentLayer = Math.round((completedSteps * totalLayers) / auto.steps);
          const elapsed = Math.round((auto.durationMs * completedSteps) / auto.steps);
          const status: StatusStep = {
            action: "status",
            state: completedSteps === auto.steps ? PrintState.FINISH : PrintState.RUNNING,
            payload: {
              ...auto.statusPayload,
              mc_percent: completedSteps === auto.steps ? 100 : progress,
              layer_num: currentLayer,
              mc_remaining_time: Math.ceil(Math.max(0, auto.durationMs - elapsed) / 60_000)
            }
          };
          await this.requireSession().playSteps([status]);
          this.appendTimeline([{ action: "wait", durationMs: logicalDelay }, status]);
          auto.completedSteps = completedSteps;
          this.record("action", `Progression automatique ${progress}%`, "succeeded");
          if (completedSteps === auto.steps) {
            this.auto = undefined;
          } else {
            this.scheduleAutoStep();
          }
        }).catch(error => {
          this.record("error", "Progression automatique échouée", "failed", this.errorMessage(error));
        });
      },
      Math.max(1, Math.round(logicalDelay / auto.speed))
    );
  }

  private suspendAutoTimer(): void {
    if (this.auto?.timer) {
      clearTimeout(this.auto.timer);
      this.auto.timer = undefined;
    }
  }

  private cancelAuto(): void {
    this.suspendAutoTimer();
    this.auto = undefined;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.actionQueue.then(operation, operation);
    this.actionQueue = run.catch(() => undefined);
    return run;
  }

  private record(
    kind: BenchHistoryEntry["kind"],
    label: string,
    status: BenchHistoryEntry["status"],
    detail?: string
  ): void {
    this.history.push({
      id: this.nextHistoryId++,
      at: Date.now(),
      kind,
      label,
      status,
      ...(detail ? { detail } : {})
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error";
  }
}
