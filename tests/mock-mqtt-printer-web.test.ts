import { afterEach, describe, expect, it, vi } from "vitest";

import { PrintState } from "../src/enums";
import type { PrinterScenario, ScenarioStep, StatusStep } from "../src/tools/mock-mqtt-printer/scenario";
import {
  DEFAULT_CAMERA_PLACEHOLDER,
  DEFAULT_PROJECT_PLACEHOLDER,
  type DiscordTargetDetails,
  type ScenarioSessionOptions,
  type ScenarioSessionSnapshot
} from "../src/tools/mock-mqtt-printer/session";
import { WebBenchController } from "../src/tools/mock-mqtt-printer/web-controller";
import { type RunningWebBenchServer, startWebBenchServer } from "../src/tools/mock-mqtt-printer/web-server";

const printer = {
  id: "web-printer",
  name: "Web Printer",
  serial: "WEB_SERIAL",
  accessCode: "fake-access-code"
};

const startInput = {
  printer,
  speed: 100,
  discordEnabled: false
};

class FakeSession {
  public readonly played: PrinterScenario[] = [];
  public readonly playedSteps: ScenarioStep[][] = [];
  public readonly deletedThreads: string[] = [];
  public disconnected = false;
  public cameraPlaceholder?: Buffer;
  public projectPlaceholder?: Buffer;
  public started = false;
  public stopped = false;
  private current: ScenarioSessionSnapshot["current"];

  public constructor(public readonly options: ScenarioSessionOptions) {}

  public async start(): Promise<void> {
    this.started = true;
  }

  public async stop(): Promise<void> {
    this.stopped = true;
  }

  public async play(scenario: PrinterScenario): Promise<void> {
    this.played.push(structuredClone(scenario));
    await this.playSteps(scenario.steps);
  }

  public async playSteps(steps: ScenarioStep[]): Promise<void> {
    this.playedSteps.push(structuredClone(steps));
    for (const step of steps) {
      if (step.action === "project") {
        this.current = {
          state: PrintState.PREPARE,
          project: typeof step.payload?.subtask_name === "string" ? step.payload.subtask_name : undefined,
          hasProjectImage: this.projectPlaceholder !== undefined
        };
      } else if (step.action === "status") {
        this.applyStatus(step);
      }
    }
  }

  public async disconnectMqtt(): Promise<void> {
    this.disconnected = true;
  }

  public async reconnectMqtt(resume?: Omit<StatusStep, "action">): Promise<void> {
    this.disconnected = false;
    if (resume) {
      this.applyStatus({ action: "status", ...resume });
    }
  }

  public setProjectPlaceholder(buffer: Buffer): void {
    this.projectPlaceholder = Buffer.from(buffer);
  }

  public setCameraPlaceholder(buffer: Buffer): void {
    this.cameraPlaceholder = Buffer.from(buffer);
  }

  public snapshot(): ScenarioSessionSnapshot {
    return {
      running: this.started && !this.stopped,
      connected: this.started && !this.stopped && !this.disconnected,
      printer: { ...printer, ...this.options.printer },
      mqtt: { host: "127.0.0.1", port: 18_883, paused: this.disconnected, pushallCount: 1 },
      discordMode: this.options.discord ? "discord-e2e" : "mock-discord",
      mediaConfigured: this.projectPlaceholder !== undefined && this.cameraPlaceholder !== undefined,
      ...(this.current ? { current: { ...this.current } } : {}),
      notifications: []
    };
  }

  public async deleteDiscordThread(threadId: string): Promise<void> {
    this.deletedThreads.push(threadId);
  }

  private applyStatus(step: StatusStep): void {
    const payload = step.payload ?? {};
    this.current = {
      ...this.current,
      ...(step.state === undefined ? {} : { state: step.state }),
      ...(typeof payload.mc_percent === "number" ? { progressPercent: payload.mc_percent } : {}),
      ...(typeof payload.layer_num === "number" ? { currentLayer: payload.layer_num } : {}),
      ...(typeof payload.total_layer_num === "number" ? { maxLayers: payload.total_layer_num } : {}),
      ...(typeof payload.mc_remaining_time === "number" ? { remainingTime: payload.mc_remaining_time } : {}),
      hasProjectImage: this.projectPlaceholder !== undefined
    };
  }
}

const createFakeController = (options: { discord?: boolean; failStart?: boolean } = {}) => {
  const sessions: FakeSession[] = [];
  const target: DiscordTargetDetails = {
    guildId: "guild-1",
    forumChannelId: "forum-1",
    guildName: "Test Guild",
    forumName: "test-forum"
  };
  const controller = new WebBenchController({
    createSession: sessionOptions => {
      const session = new FakeSession(sessionOptions);
      if (options.failStart) {
        session.start = async () => {
          throw new Error("startup failed");
        };
      }
      sessions.push(session);
      return session;
    },
    ...(options.discord
      ? {
          discord: { guildId: target.guildId, forumChannelId: target.forumChannelId },
          inspectDiscord: async () => target
        }
      : {})
  });
  return { controller, sessions, target };
};

describe("web bench controller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a session and records manual actions in the shared JSON v1 timeline", async () => {
    const { controller, sessions } = createFakeController();

    await controller.start(startInput);
    await controller.execute({
      label: "Projet puis progression",
      steps: [
        { action: "project", payload: { subtask_name: "Benchy" } },
        { action: "status", state: "RUNNING", payload: { mc_percent: 25 } }
      ]
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.options).toMatchObject({ printer, timeScale: 0.01 });
    expect(sessions[0]?.projectPlaceholder).toEqual(DEFAULT_PROJECT_PLACEHOLDER);
    expect(sessions[0]?.cameraPlaceholder).toEqual(DEFAULT_CAMERA_PLACEHOLDER);
    expect(controller.exportScenario().steps).toEqual([
      { action: "project", payload: { subtask_name: "Benchy" } },
      { action: "status", state: PrintState.RUNNING, payload: { mc_percent: 25 } }
    ]);
    expect(controller.state()).toMatchObject({
      simulationRestartRequired: false,
      discord: { active: false, available: false },
      session: { connected: true, current: { state: PrintState.RUNNING, progressPercent: 25 } }
    });
    expect(controller.state().history.map(entry => entry.label)).toEqual([
      "Simulation démarrée",
      "Projet puis progression"
    ]);

    await controller.close();
    expect(sessions[0]?.stopped).toBe(true);
  });

  it("uses normalized logical waits and freezes an automatic run while paused", async () => {
    vi.useFakeTimers();
    const { controller } = createFakeController();
    await controller.start(startInput);
    await controller.startAuto({
      durationMs: 1_000,
      steps: 2,
      speed: 1,
      project: { subtask_name: "Auto" },
      status: { total_layer_num: 20 }
    });

    await vi.advanceTimersByTimeAsync(250);
    await controller.pause();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(controller.state().auto).toMatchObject({ active: true, paused: true, completedSteps: 0 });

    await controller.resume();
    await vi.advanceTimersByTimeAsync(500);
    expect(controller.state().auto).toMatchObject({ active: true, completedSteps: 1 });
    await vi.advanceTimersByTimeAsync(500);
    expect(controller.state().auto.active).toBe(false);
    expect(controller.state().session?.current).toMatchObject({
      state: PrintState.FINISH,
      progressPercent: 100,
      currentLayer: 20,
      remainingTime: 0
    });
    expect(controller.exportScenario().steps.filter(step => step.action === "wait")).toEqual([
      { action: "wait", durationMs: 500 },
      { action: "wait", durationMs: 500 }
    ]);

    await controller.close();
  });

  it("keeps an MQTT outage provisional until reconnect and exports its selected logical duration", async () => {
    const { controller } = createFakeController();
    await controller.start(startInput);
    await controller.disconnect({ durationMs: 65_000 });

    expect(controller.state().outage).toEqual({ durationMs: 65_000, provisional: true });
    expect(controller.exportScenario().steps).toEqual([]);

    await controller.reconnect({ state: "PAUSE", payload: { mc_percent: 42 } });

    expect(controller.state().outage).toBeUndefined();
    expect(controller.exportScenario().steps).toEqual([
      {
        action: "outage",
        durationMs: 65_000,
        resume: { state: PrintState.PAUSE, payload: { mc_percent: 42 } }
      }
    ]);
    await controller.close();
  });

  it("validates automatic waits, raw payloads, bursts and notification images at their explicit bounds", async () => {
    const { controller } = createFakeController();
    await controller.start(startInput);

    await expect(
      controller.startAuto({ durationMs: 600_001, steps: 1, speed: 1, project: {}, status: {} })
    ).rejects.toThrow("scenario wait limit");
    await expect(
      controller.execute({ steps: [{ action: "raw", payload: "x".repeat(1024 * 1024 + 1) }] })
    ).rejects.toThrow("production MQTT limit");
    await expect(
      controller.execute({
        steps: [{ action: "burst", count: 10_001, messages: [{ action: "status", state: "RUNNING" }] }]
      })
    ).rejects.toThrow("between 1 and 10000");
    expect(() => controller.upload("project", Buffer.from("not an image"), "image/png")).toThrow("valid PNG or JPEG");
    expect(() => controller.upload("camera", Buffer.alloc(10 * 1024 * 1024 + 1), "image/jpeg")).toThrow(
      "Discord attachment limit"
    );

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    controller.upload("project", jpeg, "image/jpeg");
    expect(controller.getPlaceholder("project")).toEqual(jpeg);
    expect(controller.getPlaceholder("camera")).toEqual(DEFAULT_CAMERA_PLACEHOLDER);
    expect(controller.state().history.at(-1)).toMatchObject({ kind: "admin", label: "Placeholder projet remplacé" });
    await controller.close();
  });

  it("imports and replays through a fresh session while keeping administration outside scenario steps", async () => {
    const { controller, sessions } = createFakeController();
    const scenario = {
      version: 1,
      name: "imported",
      steps: [{ action: "status", state: "RUNNING", payload: { mc_percent: 10 } }],
      expect: {}
    } as const;

    controller.importScenario(scenario);
    await controller.start(startInput);
    expect(controller.exportScenario()).toEqual(scenario);
    await controller.replay();
    await expect(controller.deleteThread({ threadId: "thread-1" })).rejects.toThrow("explicit confirmation");
    await controller.deleteThread({ threadId: "thread-1", confirm: true });

    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.stopped).toBe(true);
    expect(sessions[1]?.played[0]).toEqual(scenario);
    expect(sessions[1]?.deletedThreads).toEqual(["thread-1"]);
    expect(controller.exportScenario()).toEqual(scenario);
    await controller.close();
  });

  it("requires server opt-in and an inspected target confirmation before real Discord can become active", async () => {
    const disabled = createFakeController();
    await expect(disabled.controller.inspectDiscordTarget()).rejects.toThrow("not enabled");

    const { controller, sessions, target } = createFakeController({ discord: true });
    await expect(controller.start({ ...startInput, discordEnabled: true })).rejects.toThrow(
      "Real Discord requires confirmation"
    );
    expect(sessions).toHaveLength(0);

    await controller.start({
      ...startInput,
      discordEnabled: true,
      confirmDiscordTarget: `${target.guildId}:${target.forumChannelId}`
    });
    expect(sessions[0]?.options.discord).toEqual({ guildId: target.guildId, forumChannelId: target.forumChannelId });
    expect(controller.state().discord).toMatchObject({ active: true, available: true, target });
    await controller.stop();
    expect(controller.state().discord.active).toBe(false);
  });

  it("cleans up a newly created session when startup fails", async () => {
    const { controller, sessions } = createFakeController({ failStart: true });

    await expect(controller.start(startInput)).rejects.toThrow("startup failed");

    expect(sessions[0]?.stopped).toBe(true);
    expect(controller.state().session).toBeUndefined();
  });
});

describe("web bench HTTP adapter", () => {
  let server: RunningWebBenchServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  const startServer = async () => {
    const { controller } = createFakeController();
    server = await startWebBenchServer({ controller, host: "127.0.0.1", port: 0 });
    return `http://${server.host}:${server.port}`;
  };

  it("serves the UI and health endpoint with restrictive browser headers", async () => {
    const base = await startServer();

    const health = await fetch(`${base}/api/health`);
    const page = await fetch(base);
    const script = await fetch(`${base}/app.js`);

    expect(await health.json()).toEqual({ status: "ok" });
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(page.headers.get("x-frame-options")).toBe("DENY");
    expect(await page.text()).toContain("Banc imprimante MQTT");
    expect(script.headers.get("content-type")).toContain("text/javascript");
  });

  it("guards mutations and reports JSON and action validation errors without exposing server state", async () => {
    const base = await startServer();

    const missingGuard = await fetch(`${base}/api/session/start`, { method: "POST", body: "{}" });
    expect(missingGuard.status).toBe(400);
    expect(await missingGuard.json()).toEqual({ error: "mutating requests require x-mock-printer-ui: 1" });

    const invalidJson = await fetch(`${base}/api/session/start`, {
      method: "POST",
      headers: { "x-mock-printer-ui": "1", "content-type": "application/json" },
      body: "{"
    });
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: "request body must be valid JSON" });
  });

  it("routes session actions, upload validation and scenario export through the controller", async () => {
    const base = await startServer();
    const headers = { "x-mock-printer-ui": "1", "content-type": "application/json" };

    const started = await fetch(`${base}/api/session/start`, {
      method: "POST",
      headers,
      body: JSON.stringify(startInput)
    });
    expect(started.status).toBe(200);

    const action = await fetch(`${base}/api/actions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ label: "Progression", steps: [{ action: "status", state: "RUNNING" }] })
    });
    expect(action.status).toBe(200);
    expect(await action.json()).toMatchObject({ session: { current: { state: "RUNNING" } } });

    const defaultProject = await fetch(`${base}/api/placeholder/project`);
    const defaultCamera = await fetch(`${base}/api/placeholder/camera`);
    expect(Buffer.from(await defaultProject.arrayBuffer())).toEqual(DEFAULT_PROJECT_PLACEHOLDER);
    expect(Buffer.from(await defaultCamera.arrayBuffer())).toEqual(DEFAULT_CAMERA_PLACEHOLDER);

    const badUpload = await fetch(`${base}/api/placeholder/project`, {
      method: "PUT",
      headers: { "x-mock-printer-ui": "1", "content-type": "image/png" },
      body: "invalid"
    });
    expect(badUpload.status).toBe(400);
    expect(await badUpload.json()).toEqual({ error: "image must be a valid PNG or JPEG" });

    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const uploaded = await fetch(`${base}/api/placeholder/camera`, {
      method: "PUT",
      headers: { "x-mock-printer-ui": "1", "content-type": "image/jpeg" },
      body: jpeg
    });
    expect(uploaded.status).toBe(200);
    const placeholder = await fetch(`${base}/api/placeholder/camera`);
    expect(placeholder.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await placeholder.arrayBuffer())).toEqual(jpeg);

    const exported = await fetch(`${base}/api/scenario/export`);
    expect(exported.headers.get("content-disposition")).toContain("mock-printer-scenario.json");
    expect(await exported.json()).toMatchObject({ version: 1, steps: [{ action: "status", state: "RUNNING" }] });
  });
});

describe.sequential("web bench real engine integration", () => {
  it("drives the real BambuLabClient and PrinterManager with injected placeholder media", async () => {
    const controller = new WebBenchController();
    try {
      await controller.start(startInput);
      await controller.execute({
        steps: [
          { action: "project", payload: { model_id: "web-integration", subtask_name: "Web integration" } },
          {
            action: "status",
            state: "RUNNING",
            payload: { mc_percent: 25, layer_num: 5, total_layer_num: 20, mc_remaining_time: 15 }
          },
          { action: "status", state: "FINISH", payload: { mc_percent: 100, mc_remaining_time: 0 } }
        ]
      });

      expect(controller.state().session).toMatchObject({
        running: true,
        connected: true,
        discordMode: "mock-discord",
        mediaConfigured: true,
        current: { state: PrintState.FINISH, progressPercent: 100, hasProjectImage: true }
      });
      await vi.waitFor(() => {
        expect(controller.state().session?.notifications.map(notification => notification.title)).toEqual(
          expect.arrayContaining(["Démarrage de l'impression", "Impression terminée"])
        );
      });
      const notifications = controller.state().session?.notifications ?? [];
      expect(notifications.find(notification => notification.kind === "thread")?.attachmentSizes).toContain(
        DEFAULT_PROJECT_PLACEHOLDER.length
      );
      expect(
        notifications.find(notification => notification.title === "Impression terminée")?.attachmentSizes
      ).toContain(DEFAULT_CAMERA_PLACEHOLDER.length);
    } finally {
      await controller.close();
    }
  });
});
