// Example /api/status answers in friend mode, built only from sentences in companion/src (Logic.cs, Controller.cs,
// WebUi.cs, Update.cs). Fed to the real status page (served by the real companion) through CDP Fetch interception.
const SAVE = "MTG Table (rules engine)";
const HOW = "In TTS: Create → Singleplayer (or Multiplayer) → Games → Save & Load → " + SAVE;
const HINT_DEFAULT = HOW + "\n\nOnly the host runs this app. Friends join your TTS game (Multiplayer) and need nothing else.";
const WORD = { green: "OK", amber: "Check", red: "Problem", busy: "Working", grey: "—" };
const NAMES = ["Docker", "Engine images", "Engine stack", "Table save", "Bridge", "TTS"];

function L(i, state, text, extra) {
  extra = extra || {};
  return {
    step: i + 1, name: NAMES[i], state: state === "busy" ? "amber" : state, busy: state === "busy", word: WORD[state],
    text, hint: extra.hint || null, at: state === "grey" && text === "Not checked yet." ? null : (extra.at || "20:14:0" + i), action: extra.action || null,
  };
}
const fix = (row, id, label, confirm, locked) => ({ id: `fix:${row}:${id}`, label, locked: !!locked, lockText: locked ? "Locked: a game is on. Do this after the game." : null, confirm: confirm || null });

const GREEN = [
  L(0, "green", "Running (Docker 29.8.2, 2 CPUs)."),
  L(1, "green", "Ready (relay 57aa07a9, engine 975d62f6)."),
  L(2, "green", "Ready: room tts-commander is open (login 55 ms)."),
  L(3, "green", "Installed as TS_Save_12.json (up to date)."),
  L(4, "green", "Running (bridge 0b87883d)."),
  L(5, "green", "Connected: table 651735d5 is loaded."),
];

function menu(locked, gameText) {
  return [
    { id: "restart-engine", label: locked ? "Restart engine (locked: game on)" : "Restart engine", enabled: !locked,
      title: locked ? "Locked: a game is on. Do this after the game." : "Stops the bridge, restarts relay and room, then starts the bridge again.",
      confirm: "Restart the engine? This stops the bridge, restarts the relay and the Forge room, and starts the bridge again (under a minute).", confirmLocked: false },
    { id: "stop-everything", label: "Stop everything", enabled: true, title: "Stops the bridge and the engine containers; Docker Desktop and TTS keep running.",
      confirm: locked ? gameText + "\n\nStopping everything ends that game for everyone. Stop anyway?" : "Stop the bridge and the engine containers? Docker Desktop and TTS keep running.", confirmLocked: locked },
    { id: "open-logs", label: "Open logs folder", enabled: true, title: "C:\\Games\\MTG-Table\\logs", confirm: null, confirmLocked: false },
    { id: "wsl-limits", label: "Limit Docker's CPU use…", enabled: true, title: "Optional: gives Docker 2 cores so TTS runs smoother.", confirm: "(confirm)", confirmLocked: false },
  ];
}

function updateUpToDate() {
  return { title: "Updates", line: "Up to date (v2026.11.12-2040).", status: "up-to-date", current: "v2026.11.12-2040", available: null, progress: -1, deferred: false, error: null, lastCheck: "20:13",
    actions: [{ id: "update-check", label: "Check for updates", enabled: true, title: "Last checked 20:13", confirm: null, confirmLocked: false }] };
}

function status(o) {
  const lights = o.lights;
  const order = ["red", "busy", "amber", "grey", "green"];
  let worst = "green";
  for (const l of lights) { const s = l.busy ? "busy" : l.state; if (order.indexOf(s) < order.indexOf(worst)) worst = s; }
  let head;
  const red = lights.find(l => l.state === "red");
  if (red) head = "Problem: " + red.name;
  else if (worst === "busy") head = o.phase;
  else if (worst === "amber") head = lights.filter(l => l.state === "amber" && !l.busy).length + " to check";
  else if (worst === "grey") head = "Stopped";
  else head = o.game && o.game.kind === "on" ? "Ready: game on" : "Ready";
  const hintL = lights.find(l => l.hint && l.state !== "green" && l.state !== "grey");
  return {
    api: 1, app: "MTG Companion", at: "20:14:07", mode: "friend", home: "C:\\Games\\MTG-Table", observe: false, phase: o.phase,
    worst: { state: worst === "busy" ? "amber" : worst, busy: worst === "busy", text: head },
    game: o.game || { kind: "none", text: "No game.", turn: 0, locked: false, lockText: null },
    lights, menu: menu(!!(o.game && o.game.locked), o.game ? o.game.text : ""), hint: hintL ? hintL.hint : HINT_DEFAULT,
    versions: { text: "Package v2026.11.12-2040, commit 61e94b6, table 651735d5, bridge 0b87883d", companion: "1.0.0.0", table: "651735d5", bridge: "0b87883d", save: SAVE },
    log: { file: "C:\\Games\\MTG-Table\\logs\\companion.log", lines: o.log || [
      "[2026-11-12 20:13:41] start: Friend mode, home C:\\Games\\MTG-Table; docker C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
      "[2026-11-12 20:13:41] light Docker: Green: Running (Docker 29.8.2, 2 CPUs).",
      "[2026-11-12 20:13:42] light Engine images: Green: Ready (relay 57aa07a9, engine 975d62f6).",
      "[2026-11-12 20:13:58] light Engine stack: Green: Ready: room tts-commander is open (login 55 ms).",
    ] },
    update: o.update === undefined ? updateUpToDate() : o.update,
  };
}

const S = {};
S.ready = status({ phase: "Ready", lights: GREEN });

S.firstStart = status({ phase: "Starting: step 2 of 6", lights: [
  GREEN[0],
  L(1, "busy", "Loading the engine images (first run only): 42% of 1112 MB, 95 s."),
  L(2, "grey", "Not checked yet."), L(3, "grey", "Not checked yet."), L(4, "grey", "Not checked yet."), L(5, "grey", "Not checked yet."),
], update: { title: "Updates", line: "This package: v2026.11.12-2040.", status: "idle", current: "v2026.11.12-2040", available: null, progress: -1, deferred: false, error: null, lastCheck: null,
  actions: [{ id: "update-check", label: "Check for updates", enabled: true, title: "Not checked yet.", confirm: null, confirmLocked: false }] } });

S.ttsAmber = status({ phase: "Ready", lights: [GREEN[0], GREEN[1], GREEN[2], GREEN[3], GREEN[4],
  L(5, "amber", "TTS is running. Load the table: " + HOW + ".", { hint: HOW })] });

S.ttsNotRunning = status({ phase: "Ready", lights: [GREEN[0], GREEN[1], GREEN[2], GREEN[3], GREEN[4],
  L(5, "amber", "Tabletop Simulator isn't running.", { hint: HOW, action: fix(5, "tts-open", "Open TTS") })] });

S.redStack = status({ phase: "Ready, with a problem: see the red light", lights: [GREEN[0], GREEN[1],
  L(2, "red", "The relay is up, but this PC can't log in to it (refused), so games would fail at setup. This happens after Docker or WSL restarts.",
    { action: fix(2, "stack-restart", "Restart relay and room", "Restart the relay and the Forge room (about 20 s)?") }),
  GREEN[3], GREEN[4], GREEN[5]] });

S.redDocker = status({ phase: "Stopped at step 1 (Docker): see the red light", lights: [
  L(0, "red", "Docker Desktop didn't answer within 3 minutes. Open its window and finish anything it asks (agreement, sign-in, a WSL update or a restart), then press the button.",
    { action: fix(0, "docker-start", "Start Docker Desktop") }),
  L(1, "grey", "Waiting for Docker."), L(2, "grey", "Waiting for Docker."), L(3, "grey", "Waiting for Docker."), L(4, "grey", "Waiting for Docker."), L(5, "grey", "Waiting for Docker."),
] });

const GAME = { kind: "on", text: "Game on: turn 5, 3 players (2 AI).", turn: 5, locked: true, lockText: "Locked: a game is on. Do this after the game." };
S.gameOn = status({ phase: "Ready", game: GAME, lights: [GREEN[0], GREEN[1],
  L(2, "green", "Ready: room tts-commander is in a game."), GREEN[3],
  L(4, "amber", "The bridge runs but didn't answer in time (timeout). It may be busy.", { action: fix(4, "bridge-restart", "Restart the bridge", "Restart the bridge (a few seconds)? TTS will redraw the table.", true) }),
  GREEN[5]] });

S.update = status({ phase: "Ready", lights: GREEN, update: {
  title: "Update available: v2026.11.14-1910", line: "Update available: v2026.11.14-1910 (bridge and decks, table; 3.4 MB to download).", status: "available",
  current: "v2026.11.12-2040", available: "v2026.11.14-1910", progress: -1, deferred: false, error: null, lastCheck: "20:13",
  actions: [
    { id: "update-now", label: "Update now", enabled: true, title: "Downloads and installs v2026.11.14-1910.", confirm: "(confirm)", confirmLocked: false },
    { id: "update-later", label: "Later", enabled: true, title: "No reminder for this update until you check again.", confirm: null, confirmLocked: false },
    { id: "update-check", label: "Check for updates", enabled: true, title: "Last checked 20:13", confirm: null, confirmLocked: false },
  ] } });

S.notPublic = status({ phase: "Ready", lights: GREEN, update: {
  title: "Updates", line: "Updates will work once the project is public.", status: "not-public", current: "v2026.11.12-2040", available: null, progress: -1, deferred: false, error: null, lastCheck: "20:13",
  actions: [{ id: "update-check", label: "Check for updates", enabled: true, title: "Last checked 20:13", confirm: null, confirmLocked: false }] } });

S.toolsOn = (real) => Object.assign({}, real, {
  seats: [
    { color: "White", person: true, inGame: true, ai: null },
    { color: "Red", person: false, inGame: true, ai: { kind: "forge", kindLabel: "Forge AI", deckName: "Animar", source: "starter_deck_animar" } },
    { color: "Yellow", person: false, inGame: true, ai: { kind: "harmless", kindLabel: "Harmless bot", deckName: "Passive AI (lands only)", source: "ai_passive_lands" } },
    { color: "Blue", person: false, inGame: false, ai: null },
  ],
  debug: { on: true, game: true, fix: false, players: [{ color: "White", name: "Host" }, { color: "Red", name: "Red" }, { color: "Yellow", name: "Yellow" }] },
});

module.exports = S;
