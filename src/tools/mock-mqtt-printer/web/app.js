/* global URL, document, fetch, localStorage, setInterval, window */

const STORAGE_KEY = "bambu-mqtt-web-bench-v1";
const MUTATION_HEADERS = { "x-mock-printer-ui": "1" };
const formIds = [
  "printer-name",
  "printer-id",
  "printer-serial",
  "printer-access-code",
  "session-speed",
  "project-name",
  "model-id",
  "plate-index",
  "task-id",
  "subtask-id",
  "gcode-file",
  "total-layers",
  "duration-minutes",
  "auto-steps",
  "auto-speed",
  "multicolor",
  "progress",
  "current-layer",
  "remaining-time",
  "raw-payload",
  "burst-count",
  "outage-duration",
  "outage-resume-state"
];

const element = id => document.getElementById(id);
const value = id => element(id).value;
const number = id => Number(value(id));
const checked = id => element(id).checked;
const setText = (id, text) => {
  element(id).textContent = text;
};
const toggle = (id, visible) => element(id).classList.toggle("hidden", !visible);

let currentState;
let discordTarget;
let editorDirty = false;
let busy = 0;
let restartWarningVisible = false;

const updateControlState = () => {
  const sessionActive = currentState?.session !== undefined;
  const waiting = busy > 0;
  const automatic = currentState?.auto.active === true;
  const printState = currentState?.session?.current?.state;
  const printActive = ["PREPARE", "RUNNING", "PAUSE"].includes(printState);
  for (const id of ["send-raw", "send-partial", "send-burst"]) {
    element(id).disabled = waiting || !sessionActive;
  }
  element("start-manual").disabled = waiting || !sessionActive || automatic || printActive;
  element("start-auto").disabled = waiting || !sessionActive || automatic || printActive;
  element("send-progress").disabled = waiting || !sessionActive || !printActive;
  element("pause").disabled = waiting || printState !== "RUNNING";
  element("resume").disabled = waiting || printState !== "PAUSE";
  for (const id of ["finish", "fail", "cancel"]) {
    element(id).disabled = waiting || !printActive;
  }
  element("disconnect").disabled = waiting || !sessionActive || currentState?.outage !== undefined;
  element("reconnect").disabled = waiting || !sessionActive || currentState?.outage === undefined;
  element("start-session").disabled = waiting || sessionActive;
  element("stop-session").disabled = waiting || !sessionActive;
  element("apply-scenario").disabled = waiting;
  element("replay-scenario").disabled = waiting;
  element("discord-enabled").disabled = waiting || currentState?.discord.available !== true || sessionActive;
};

const request = async (path, options = {}) => {
  const response = await fetch(path, options);
  const contentType = response.headers.get("content-type") ?? "";
  const result = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(result.error ?? `HTTP ${response.status}`);
  }
  return result;
};

const post = (path, body = {}) =>
  request(path, {
    method: "POST",
    headers: { ...MUTATION_HEADERS, "content-type": "application/json" },
    body: JSON.stringify(body)
  });

const showError = error => {
  const message = error instanceof Error ? error.message : String(error);
  setText("error-banner", message);
  toggle("error-banner", true);
};

const clearError = () => toggle("error-banner", false);

const run = async operation => {
  busy += 1;
  document.body.dataset.busy = "true";
  document.body.setAttribute("aria-busy", "true");
  updateControlState();
  clearError();
  try {
    const state = await operation();
    if (state?.scenario) {
      render(state);
    }
    return state;
  } catch (error) {
    showError(error);
    throw error;
  } finally {
    busy -= 1;
    if (busy === 0) {
      delete document.body.dataset.busy;
      document.body.removeAttribute("aria-busy");
    }
    updateControlState();
  }
};

const projectPayload = () => ({
  model_id: value("model-id"),
  subtask_name: value("project-name"),
  plate_idx: number("plate-index"),
  task_id: value("task-id"),
  subtask_id: value("subtask-id"),
  gcode_file: value("gcode-file"),
  use_ams: checked("multicolor"),
  ams_mapping: checked("multicolor") ? [0, 1] : [0]
});

const statusPayload = () => ({
  subtask_name: value("project-name"),
  task_id: value("task-id"),
  subtask_id: value("subtask-id"),
  gcode_file: value("gcode-file"),
  plate_idx: number("plate-index"),
  layer_num: number("current-layer"),
  total_layer_num: number("total-layers"),
  mc_percent: number("progress"),
  mc_remaining_time: number("remaining-time")
});

const saveLocal = (scenario, replaceScenario = false) => {
  const form = {};
  for (const id of formIds) {
    const input = element(id);
    form[id] = input.type === "checkbox" ? input.checked : input.value;
  }
  let storedScenario;
  try {
    storedScenario = JSON.parse(localStorage.getItem(STORAGE_KEY))?.scenario;
  } catch {
    storedScenario = undefined;
  }
  const persistedScenario =
    !replaceScenario && scenario?.steps?.length === 0 && storedScenario?.steps?.length > 0 ? storedScenario : scenario;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ form, scenario: persistedScenario }));
};

const restoreLocal = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(stored);
    for (const [id, saved] of Object.entries(parsed.form ?? {})) {
      const input = element(id);
      if (!input) {
        continue;
      }
      if (input.type === "checkbox") {
        input.checked = saved === true;
      } else {
        input.value = String(saved);
      }
    }
    restartWarningVisible = true;
    return parsed.scenario;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return undefined;
  }
};

const makeEmptyItem = text => {
  const item = document.createElement("li");
  item.className = "empty";
  item.textContent = text;
  return item;
};

const renderNotifications = state => {
  const list = element("notification-list");
  list.replaceChildren();
  const notifications = state.session?.notifications ?? [];
  setText("notification-count", String(notifications.length));
  if (notifications.length === 0) {
    list.append(makeEmptyItem("Aucune notification."));
    return;
  }
  for (const notification of [...notifications].reverse()) {
    const item = document.createElement("li");
    const title = document.createElement("strong");
    title.textContent = notification.title;
    item.append(title);
    const details = document.createElement("span");
    details.textContent = `${notification.kind === "thread" ? "Thread" : "Message"} · ${notification.tags.join(" · ")}${notification.deleted ? " · supprimé" : ""}`;
    item.append(details);
    if (notification.url && !notification.deleted) {
      const actions = document.createElement("div");
      actions.className = "event-actions";
      const link = document.createElement("a");
      link.href = notification.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Ouvrir sur Discord ↗";
      actions.append(link);
      if (notification.kind === "thread" && state.discord.active) {
        const button = document.createElement("button");
        button.className = "danger-ghost";
        button.type = "button";
        button.textContent = "Supprimer";
        button.disabled = busy > 0;
        button.addEventListener("click", () => {
          if (
            window.confirm(
              `Supprimer définitivement le thread ${notification.threadId} créé dans cette session ? Cette action ne supprime aucun autre thread.`
            )
          ) {
            void run(() =>
              post("/api/discord/thread/delete", { threadId: notification.threadId, confirm: true })
            ).catch(() => undefined);
          }
        });
        actions.append(button);
      }
      item.append(actions);
    }
    list.append(item);
  }
};

const renderHistory = state => {
  const list = element("history-list");
  list.replaceChildren();
  setText("history-count", String(state.history.length));
  if (state.history.length === 0) {
    list.append(makeEmptyItem("La chronologie est vide."));
    return;
  }
  for (const event of [...state.history].reverse()) {
    const item = document.createElement("li");
    item.dataset.status = event.status;
    const label = document.createElement("strong");
    label.textContent = event.label;
    const details = document.createElement("span");
    const time = new Date(event.at).toLocaleTimeString("fr-FR");
    details.textContent = `${time} · ${event.status}${event.detail ? ` · ${event.detail}` : ""}`;
    item.append(label, details);
    list.append(item);
  }
};

const render = state => {
  const sessionEnded = currentState?.session !== undefined && state.session === undefined;
  currentState = state;
  const session = state.session;
  const current = session?.current;
  const connected = session?.connected === true;
  restartWarningVisible = session ? false : restartWarningVisible || sessionEnded;
  toggle("restart-warning", restartWarningVisible);
  setText("mqtt-badge", !session ? "MQTT arrêté" : connected ? "MQTT connecté" : "MQTT déconnecté");
  element("mqtt-badge").className = `badge ${connected ? "badge-online" : "badge-muted"}`;
  const printState = current?.state ?? "État inconnu";
  setText("print-badge", printState);
  setText("current-state", session ? printState : "Non démarré");
  element("connection-dot").classList.toggle("connected", connected);
  setText("broker-address", session ? `mqtt://${session.mqtt.host}:${session.mqtt.port}` : "Non démarré");
  setText("current-project", current?.project ?? "—");
  setText("current-progress", current?.progressPercent === undefined ? "—" : `${current.progressPercent} %`);
  setText(
    "current-layers",
    current?.currentLayer === undefined ? "—" : `${current.currentLayer} / ${current.maxLayers ?? "—"}`
  );
  setText("current-remaining", current?.remainingTime === undefined ? "—" : `${current.remainingTime} min`);
  setText(
    "current-colors",
    current?.isMulticolor === undefined ? "—" : current.isMulticolor ? "Multicolore" : "Monocolor"
  );
  setText("pushall-count", String(session?.mqtt.pushallCount ?? 0));
  setText(
    "auto-state",
    state.auto.active
      ? state.auto.paused
        ? "Automatique · pause"
        : `${state.auto.completedSteps}/${state.auto.steps} étapes`
      : "Manuel"
  );
  toggle("outage-provisional", state.outage !== undefined);

  setText(
    "discord-availability",
    state.discord.available
      ? "Double confirmation requise avant tout envoi"
      : "Indisponible sans activation serveur explicite"
  );
  setText("discord-badge", state.discord.active ? "DISCORD RÉEL ACTIF" : "Discord mocké");
  element("discord-badge").className = `badge ${state.discord.active ? "badge-danger" : "badge-mock"}`;

  renderNotifications(state);
  renderHistory(state);
  if (!editorDirty) {
    element("scenario-editor").value = JSON.stringify(state.scenario, null, 2);
  }
  saveLocal(state.scenario);
  updateControlState();
};

const inspectDiscord = async () => {
  discordTarget = await run(() => post("/api/discord/inspect"));
  setText("discord-target", `${discordTarget.guildName} / #${discordTarget.forumName}`);
  toggle("discord-confirm", true);
  return discordTarget;
};

element("discord-enabled").addEventListener("change", () => {
  if (!checked("discord-enabled")) {
    element("discord-confirmed").checked = false;
    toggle("discord-confirm", false);
    return;
  }
  void inspectDiscord().catch(() => {
    element("discord-enabled").checked = false;
  });
});

element("start-session").addEventListener("click", () => {
  void run(async () => {
    const realDiscord = checked("discord-enabled");
    if (realDiscord && !discordTarget) {
      await inspectDiscord();
    }
    const state = await post("/api/session/start", {
      printer: {
        name: value("printer-name"),
        id: value("printer-id"),
        serial: value("printer-serial"),
        accessCode: value("printer-access-code")
      },
      speed: number("session-speed"),
      discordEnabled: realDiscord,
      confirmDiscordTarget:
        realDiscord && checked("discord-confirmed")
          ? `${discordTarget.guildId}:${discordTarget.forumChannelId}`
          : undefined
    });
    saveLocal(state.scenario, true);
    restartWarningVisible = false;
    return state;
  }).catch(() => undefined);
});

element("stop-session").addEventListener("click", () => {
  void run(() => post("/api/session/stop")).catch(() => undefined);
});

element("start-manual").addEventListener("click", () => {
  void run(() =>
    post("/api/actions", {
      label: "Impression manuelle démarrée",
      steps: [
        { action: "project", payload: projectPayload() },
        {
          action: "status",
          state: "RUNNING",
          payload: { ...statusPayload(), mc_percent: 0, layer_num: 0 }
        }
      ]
    })
  ).catch(() => undefined);
});

element("start-auto").addEventListener("click", () => {
  void run(() =>
    post("/api/auto/start", {
      durationMs: Math.round(number("duration-minutes") * 60_000),
      steps: number("auto-steps"),
      speed: number("auto-speed"),
      project: projectPayload(),
      status: { ...statusPayload(), layer_num: 0, mc_percent: 0 }
    })
  ).catch(() => undefined);
});

element("progress").addEventListener("input", () => setText("progress-output", `${value("progress")} %`));
element("send-progress").addEventListener("click", () => {
  void run(() =>
    post("/api/actions", {
      label: `Progression manuelle ${number("progress")}%`,
      steps: [{ action: "status", state: "RUNNING", payload: statusPayload() }]
    })
  ).catch(() => undefined);
});

for (const [id, path] of [
  ["pause", "/api/controls/pause"],
  ["resume", "/api/controls/resume"]
]) {
  element(id).addEventListener("click", () => {
    void run(() => post(path)).catch(() => undefined);
  });
}
for (const [id, type] of [
  ["finish", "success"],
  ["fail", "failure"],
  ["cancel", "cancel"]
]) {
  element(id).addEventListener("click", () => {
    void run(() => post("/api/controls/finish", { type })).catch(() => undefined);
  });
}

element("send-raw").addEventListener("click", () => {
  void run(() =>
    post("/api/actions", { label: "Payload brut", steps: [{ action: "raw", payload: value("raw-payload") }] })
  ).catch(() => undefined);
});
element("send-partial").addEventListener("click", () => {
  void run(() =>
    post("/api/actions", {
      label: "Statut partiel",
      steps: [
        {
          action: "status",
          payload: { layer_num: number("current-layer"), mc_percent: number("progress") }
        }
      ]
    })
  ).catch(() => undefined);
});
element("send-burst").addEventListener("click", () => {
  void run(() =>
    post("/api/actions", {
      label: `Rafale de ${number("burst-count")} messages`,
      steps: [
        {
          action: "burst",
          count: number("burst-count"),
          messages: [
            { action: "status", state: "PAUSE", payload: { mc_percent: number("progress") } },
            { action: "status", state: "RUNNING", payload: { mc_percent: number("progress") } }
          ]
        }
      ]
    })
  ).catch(() => undefined);
});
element("disconnect").addEventListener("click", () => {
  void run(() => post("/api/mqtt/disconnect", { durationMs: number("outage-duration") })).catch(() => undefined);
});
element("reconnect").addEventListener("click", () => {
  void run(() =>
    post("/api/mqtt/reconnect", {
      state: value("outage-resume-state"),
      payload: { mc_percent: number("progress") }
    })
  ).catch(() => undefined);
});

const dropzone = element("dropzone");
const fileInput = element("placeholder-input");
const uploadPlaceholder = async file => {
  const state = await request("/api/placeholder", {
    method: "PUT",
    headers: { ...MUTATION_HEADERS, "content-type": file.type },
    body: file
  });
  element("placeholder-preview").src = `${URL.createObjectURL(file)}`;
  render(state);
};
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});
for (const type of ["dragenter", "dragover"]) {
  dropzone.addEventListener(type, event => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
}
for (const type of ["dragleave", "drop"]) {
  dropzone.addEventListener(type, event => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
  });
}
dropzone.addEventListener("drop", event => {
  const file = event.dataTransfer.files[0];
  if (file) {
    void run(() => uploadPlaceholder(file)).catch(() => undefined);
  }
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file) {
    void run(() => uploadPlaceholder(file)).catch(() => undefined);
  }
});

element("scenario-editor").addEventListener("input", () => {
  editorDirty = true;
});
element("load-timeline").addEventListener("click", () => {
  editorDirty = false;
  element("scenario-editor").value = JSON.stringify(currentState.scenario, null, 2);
});
element("apply-scenario").addEventListener("click", () => {
  void run(async () => {
    const scenario = JSON.parse(value("scenario-editor"));
    const state = await post("/api/scenario/import", scenario);
    editorDirty = false;
    return state;
  }).catch(() => undefined);
});
element("replay-scenario").addEventListener("click", () => {
  void run(() => post("/api/scenario/replay")).catch(() => undefined);
});
element("export-scenario").addEventListener("click", () => {
  const link = document.createElement("a");
  link.href = "/api/scenario/export";
  link.download = "mock-printer-scenario.json";
  link.click();
});

for (const id of formIds) {
  element(id).addEventListener("input", () => saveLocal(currentState?.scenario));
}

const initialize = async () => {
  const restoredScenario = restoreLocal();
  const state =
    Array.isArray(restoredScenario?.steps) && restoredScenario.steps.length > 0
      ? await post("/api/scenario/import", restoredScenario)
      : await request("/api/state");
  render(state);
  if (restoredScenario) {
    element("scenario-editor").value = JSON.stringify(restoredScenario, null, 2);
  }
  setInterval(() => {
    if (busy === 0) {
      void request("/api/state").then(render).catch(showError);
    }
  }, 750);
};

void initialize().catch(showError);
