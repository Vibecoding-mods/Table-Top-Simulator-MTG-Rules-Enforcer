// Pure decisions for the Linux/macOS companion: probe facts in, a light out. No I/O here (only crypto for hashes and
// the update signature), so --selftest can feed canned inputs (selftest.js).
// This is a port of the Windows app's companion/src/Logic.cs and the pure rules of companion/src/Update.cs. The
// decisions are the same; the sentences name this platform's things (Podman or Docker, forward-slash paths, no WSL,
// no Task Manager). Keep the two in step: a rule changed there is changed here.
"use strict";
const crypto = require("crypto");
const path = require("path").posix;

// ───────────────────────────── lights and verdicts ─────────────────────────────

const Light = { Grey: "grey", Busy: "busy", Green: "green", Amber: "amber", Red: "red" };

// One light's answer: colour, a plain sentence, at most one fix button, an action the step runner may take, a hint.
function verdict(light, text, o) {
  o = o || {};
  return { light, text, fix: o.fix || null, fixLabel: o.label || null, action: o.action || null, hint: o.hint || null };
}
const vText = (v) => `${v.light}: ${v.text}${v.fix ? ` [${v.fixLabel}]` : ""}${v.action ? ` {${v.action}}` : ""}`;

const Fixes = {
  Retry: "retry", // run the start sequence again from this step
  DockerStart: "docker-start",
  ImagesLoad: "images-load",
  StackRestart: "stack-restart",
  BridgeRestart: "bridge-restart",
  BridgeStart: "bridge-start", // only when nothing runs: never locked
  TtsOpen: "tts-open",
  ShowProgram: "show-program",
  // the fixes that restart or change the engine: locked while a game is on (or can't tell)
  locksDuringGame(fix) { return fix === Fixes.ImagesLoad || fix === Fixes.StackRestart || fix === Fixes.BridgeRestart; },
};

const Actions = { StartDesktop: "start-desktop", Wait: "wait", Load: "load", StartBridge: "start-bridge" };

// ───────────────────────────── where the app runs from ─────────────────────────────

// Every path the app uses, for one of the two layouts.
//   friend: the package folder (version.json at its top), bundled node, container names mtg-table-*
//   home:   the repo (bridge/bridge.js and Start MTG.bat), the node running this, container names stack-*
function makeLayout(mode, home) {
  const l = { mode, home, friend: mode === "friend" };
  l.composeFile = path.join(home, "stack", "compose.yml");
  l.bridgeJs = path.join(home, "bridge", "bridge.js");
  l.envFile = path.join(home, "stack", ".env");
  l.deployedFile = path.join(home, "stack", "deployed.json");
  if (l.friend) {
    l.versionFile = path.join(home, "version.json");
    l.project = "mtg-table";
    l.nodeExe = path.join(home, "runtime", "node", "bin", "node");
    l.logsDir = path.join(home, "logs");
    l.bridgeLog = path.join(l.logsDir, "bridge.log");
    l.tableJson = path.join(home, "table", "MTG Table.json");
    l.tablePng = path.join(home, "table", "MTG Table.png");
    l.imagesTar = null; // findImagesTar fills it
    // (the app starts the bridge with MTG_LOG_DIR=logs, so its resume file is logs/bridge-game.json; tmp/ is where a
    // bridge started by hand with MTG_HOME alone keeps it, so a game of that one locks too)
    l.resumeFiles = [path.join(home, "tmp", "bridge-game.json"), path.join(l.logsDir, "bridge-game.json")];
  } else {
    l.project = "stack";
    l.nodeExe = "node";
    l.logsDir = path.join(home, "tmp");
    l.bridgeLog = path.join(l.logsDir, "bridge-live.log");
    l.resumeFiles = [path.join(home, "tmp", "bridge-game.json")];
  }
  l.companionLog = path.join(l.logsDir, "companion.log");
  return l;
}

const isRepo = (dir, fileExists) => fileExists(path.join(dir, "bridge", "bridge.js")) && fileExists(path.join(dir, "Start MTG.bat"));

// Friend mode when version.json sits in the folder above the companion's own (the package root); home mode when the
// companion is inside the repo (companion-node/, so look up to 4 folders up for bridge/bridge.js + Start MTG.bat).
// appDir: the folder the companion's folder is in (as the Windows exe's folder).
function detectLayout(appDir, fileExists, overrideHome) {
  if (overrideHome) {
    if (fileExists(path.join(overrideHome, "version.json"))) return makeLayout("friend", overrideHome);
    if (isRepo(overrideHome, fileExists)) return makeLayout("home", overrideHome);
    return null;
  }
  if (fileExists(path.join(appDir, "version.json"))) return makeLayout("friend", appDir);
  let dir = appDir;
  for (let i = 0; i < 5 && dir; i++) {
    if (isRepo(dir, fileExists)) return makeLayout("home", dir);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

// images/mtg-images.tar, else .tar.gz, else any .tar* in images/
function findImagesTar(home, fileExists, listDir) {
  const dir = path.join(home, "images");
  for (const n of ["mtg-images.tar", "mtg-images.tar.gz", "mtg-images.tgz"]) if (fileExists(path.join(dir, n))) return path.join(dir, n);
  for (const f of listDir(dir)) if (path.basename(f).toLowerCase().includes(".tar")) return f;
  return null;
}

// ───────────────────────────── the start sequence ─────────────────────────────

const Names = ["Container engine", "Engine images", "Engine stack", "Table save", "Bridge", "TTS"];
const Step = { Docker: 0, Images: 1, Stack: 2, Save: 3, Bridge: 4, Tts: 5 };

// The wait for the engine (each of its two waits). A cold Forge room took 2 min 15 s to open on 2 cores on 2026-11-10.
const StackWaitSeconds = 300;
const stackTimedOut = (why) => `The engine didn't get ready within ${StackWaitSeconds / 60} minutes: ${why}`;

// The step a run begins at: the requested step, but never past the first step not yet done (Logic.StartFrom).
function startFrom(requested, stoppedAt, stoppedNowGreen) {
  if (stoppedAt <= 0) return requested;
  return Math.min(requested, stoppedNowGreen ? stoppedAt + 1 : stoppedAt);
}

// The step to carry on from once the step the sequence stopped at turned green by itself; 0: nothing to do.
function resumeAfterStop(stoppedAt, stoppedNowGreen, observe) {
  return stoppedAt > 0 && stoppedNowGreen && !observe ? stoppedAt + 1 : 0;
}

// ───────────────────────────── game lock ─────────────────────────────

// http results: { kind: "ok"|"refused"|"timeout"|"error", status, body, error }
const httpOk = (body) => ({ kind: "ok", status: 200, body, error: null });
const httpOf = (kind) => ({ kind, status: 0, body: null, error: kind });

const parseJson = (s) => { if (!s) return null; try { return JSON.parse(s); } catch { return null; } };
const isObj = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
const get = (o, k) => (isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null);
const has = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);
const str = (o, k) => { const v = get(o, k); return v === null || v === undefined ? null : String(v); };
const int = (o, k) => { const v = Number(get(o, k)); return Number.isFinite(v) ? Math.trunc(v) : 0; };

const Game = {
  on: (text, turn) => ({ kind: "on", text, turn: turn || 0 }),
  none: (text) => ({ kind: "none", text, turn: 0 }),
  cantTell: (text) => ({ kind: "cantTell", text, turn: 0 }),
};

function decideGame(state, resumeAgeSec) {
  const fresh = resumeAgeSec !== null && resumeAgeSec !== undefined && resumeAgeSec > -60 && resumeAgeSec < 60;
  if (state.kind === "ok" && state.status === 200) {
    const o = parseJson(state.body);
    if (!isObj(o)) return fresh ? Game.on("A game is on (the bridge's answer couldn't be read).", 0) : Game.cantTell("The bridge's answer couldn't be read.");
    const started = get(o, "started") === true;
    const seats = Array.isArray(get(o, "seats")) ? get(o, "seats") : null;
    let turn = 0;
    if (seats) for (const s of seats) turn = Math.max(turn, int(s, "turn"));
    if (started) return Game.on(`Game on: turn ${turn}, ${playersText(o, seats)}.`, turn);
    if (seats) return Game.on("A game is set up or just finished. Restarts unlock after it is cleared: type \"mtg reset\" in TTS chat.", turn);
    if (fresh) return Game.on("The bridge just restarted and is bringing a game back.", 0);
    return Game.none("No game.");
  }
  if (state.kind === "refused") return fresh ? Game.on("A game was on a moment ago and the bridge stopped; it restarts by itself.", 0) : Game.none("No game (the bridge isn't running).");
  return fresh ? Game.on("A game is on (the bridge is slow to answer).", 0)
    : Game.cantTell(`Can't tell whether a game is on: the bridge didn't answer (${state.error || state.kind}).`);
}

// "3 players (2 AI)": /state's players and ai count everyone; an older bridge gives only the people's seats
function playersText(state, seats) {
  const people = seats ? seats.length : 0;
  const players = has(state, "players") ? int(state, "players") : people;
  const ai = int(state, "ai");
  return `${players}${players === 1 ? " player" : " players"}${ai > 0 ? ` (${ai} AI)` : ""}`;
}

const locked = (g) => !g || g.kind !== "none";
const lockText = (g) => (g && g.kind === "cantTell" ? "Locked: can't tell whether a game is on. Try again in a minute." : "Locked: a game is on. Do this after the game.");

// ───────────────────────────── 1. container engine (Docker or Podman) ─────────────────────────────

const DockerUrl = "https://www.docker.com/products/docker-desktop/";

// f: { platform: "linux"|"darwin", runtime: "docker"|"podman"|null, cliFound, desktopFound, answers, desktopRunning,
//      waiting, waitedSec, accessDenied, osType, version, cpus, detail }
// desktopFound is Docker Desktop on a Mac (the only engine this app starts itself); Podman needs no daemon.
function decideDocker(f) {
  const name = f.runtime === "podman" ? "Podman" : "Docker";
  if (f.answers) {
    if (String(f.osType || "").toLowerCase() === "windows")
      return verdict(Light.Red, "Docker is set to Windows containers. Switch it to Linux containers, then press Try again.", { fix: Fixes.Retry, label: "Try again" });
    return verdict(Light.Green, `Running${f.version ? ` (${name} ${f.version}${f.cpus > 0 ? `, ${f.cpus} CPUs` : ""})` : ""}.`);
  }
  if (!f.cliFound && !f.desktopFound) {
    if (f.platform === "darwin")
      return verdict(Light.Red, `Install Docker Desktop, then press Try again. Get it from ${DockerUrl}`, {
        fix: Fixes.Retry, label: "Try again",
        hint: `Docker Desktop isn't installed on this Mac.\nDownload it yourself from:\n    ${DockerUrl}\nInstall it, start it once, accept its agreement, then press Try again.\nOn an Apple Silicon Mac, also turn on Settings > General > "Use Rosetta for x86_64/amd64 emulation".`,
      });
    return verdict(Light.Red, "Neither Podman nor Docker was found. On a Steam Deck, Podman comes with SteamOS 3.5 or newer: update SteamOS, then press Try again. On another Linux, install podman (or Docker), then press Try again.", {
      fix: Fixes.Retry, label: "Try again",
      hint: "Steam Deck: Settings > System > Software Updates (SteamOS 3.5 or newer has podman).\nOther Linux: install the podman package with your package manager (or Docker Engine), then press Try again.",
    });
  }
  // (running, but this account may not use it: waiting would only say "starting" for 3 minutes)
  if (f.accessDenied)
    return verdict(Light.Red, f.platform === "darwin"
      ? "Docker Desktop is running, but this account can't use it yet. Quit Docker Desktop, start it again, then press Try again."
      : "Docker is running, but this account may not use it (permission denied on its socket). Add yourself to the docker group (sudo usermod -aG docker $USER), sign out and back in, then press Try again. Or install podman, which needs no group.", { fix: Fixes.Retry, label: "Try again" });
  if (!f.desktopFound)
    return verdict(Light.Red, f.runtime === "podman"
      ? `Podman is installed but doesn't answer${f.detail ? ` (${clip(f.detail, 200)})` : ""}. In a terminal, "podman info" shows why. Then press Try again.`
      : `${name} isn't answering${f.detail ? ` (${clip(f.detail, 200)})` : ""}. Start it yourself${f.platform === "darwin" ? "" : " (sudo systemctl start docker, or Docker Desktop)"}, then press Try again.`, { fix: Fixes.Retry, label: "Try again" });
  if (f.waiting) {
    if (f.waitedSec >= 180)
      return verdict(Light.Red, "Docker Desktop didn't answer within 3 minutes. Open its window and finish anything it asks (agreement, sign-in, an update), then press the button.", { fix: Fixes.DockerStart, label: "Start Docker Desktop" });
    return verdict(Light.Busy, `Docker Desktop is starting (${Math.trunc(f.waitedSec)} s). If it opens a window asking for something, answer it.`, { action: Actions.Wait });
  }
  if (f.desktopRunning) return verdict(Light.Busy, "Docker Desktop is starting.", { action: Actions.Wait });
  return verdict(Light.Busy, "Starting Docker Desktop.", { action: Actions.StartDesktop });
}

// ───────────────────────────── 2. engine images ─────────────────────────────

// ids are compared without "sha256:", and a short id matches a long one it starts (12 hex at least)
function sameId(a, b) {
  if (!a || !b) return false;
  a = a.trim().toLowerCase(); b = b.trim().toLowerCase();
  if (a.startsWith("sha256:")) a = a.slice(7);
  if (b.startsWith("sha256:")) b = b.slice(7);
  if (a.length < 12 || b.length < 12) return a === b;
  return a.startsWith(b) || b.startsWith(a);
}

// Podman prints an image id as bare hex; Docker as sha256:<hex>. The app and the bridge compare ids exactly
// (stack/deployed.json), so every id is written the Docker way.
function normId(id) {
  if (!id) return id || null;
  const t = String(id).trim();
  return /^[0-9a-f]{64}$/i.test(t) ? `sha256:${t.toLowerCase()}` : t;
}

// stack/deployed.json after a load: when this engine gave the images yet another id, that id becomes node / relay and
// the package's goes to nodePackage / relayPackage. null: nothing to change.
function deployedAfterLoad(deployed, relay, node) {
  if (!isObj(deployed) || !relay || !node) return null;
  const next = { ...deployed };
  let changed = false;
  for (const [k, id] of [["relay", relay], ["node", node]]) {
    if (str(deployed, k) === id || str(deployed, `${k}Config`) === id) continue; // (the bridge compares exactly)
    if (!has(next, `${k}Package`)) next[`${k}Package`] = str(deployed, k);
    next[k] = id;
    changed = true;
  }
  return changed ? next : null;
}

function shortId(id) {
  if (!id) return "none";
  if (id.startsWith("sha256:")) id = id.slice(7);
  return id.length > 8 ? id.slice(0, 8) : id;
}

// f: { friend, loadedAlready, locked, relayId, nodeId, wantRelay, wantNode, tarPath }
function decideImages(f) {
  const relayOk = !!f.relayId && (!f.wantRelay || sameId(f.relayId, f.wantRelay));
  const nodeOk = !!f.nodeId && (!f.wantNode || sameId(f.nodeId, f.wantNode));
  const ids = `relay ${shortId(f.relayId)}, engine ${shortId(f.nodeId)}`;
  if (!f.friend) {
    if (!f.relayId || !f.nodeId) return verdict(Light.Red, "The engine images aren't built. Run bash engine/build-images.sh (about 20 minutes), then press Try again.", { fix: Fixes.Retry, label: "Try again" });
    if (!relayOk || !nodeOk) return verdict(Light.Amber, `Present (${ids}), but not the images in stack/deployed.json (node tools/deploy.js).`);
    return verdict(Light.Green, `Present (${ids}).`);
  }
  if (relayOk && nodeOk) return verdict(Light.Green, `Ready (${ids}).`);
  const bothThere = !!f.relayId && !!f.nodeId;
  if (f.loadedAlready) {
    if (bothThere) return verdict(Light.Amber, `Loaded, but the image ids differ from this package's version.json (${ids}). Games may still work; tell whoever sent the package.`);
    return verdict(Light.Red, "Loading the engine images didn't work. The log has the engine's message.", { fix: Fixes.ImagesLoad, label: "Load the engine again" });
  }
  if (!f.tarPath) return verdict(Light.Red, "The engine file (images/mtg-images.tar) is missing from the package. Unpack the package again, then press Try again.", { fix: Fixes.Retry, label: "Try again" });
  if (f.locked && bothThere) return verdict(Light.Amber, "This package has a newer engine; it loads after the game.");
  return verdict(Light.Busy, `${bothThere ? "Updating" : "Loading"} the engine images (first run: a few minutes).`, { action: Actions.Load });
}

// ───────────────────────────── 3. engine stack ─────────────────────────────

// relay / room: { exists, state, health } | null; login: { kind: ok|refused|closed|authFailed|timeout|error|skipped,
// roomFound, roomStatus, ms, detail } | null
function decideStack(relay, room, login, game, friend) {
  if (!relay || !relay.exists) return verdict(Light.Red, "The engine isn't running (no relay container).", { fix: Fixes.StackRestart, label: "Start the engine" });
  if (relay.state !== "running") return verdict(Light.Red, `The engine's relay is ${relay.state}.`, { fix: Fixes.StackRestart, label: "Start the engine" });
  if (!room || !room.exists || room.state !== "running") return verdict(Light.Red, "The Forge room container isn't running.", { fix: Fixes.StackRestart, label: "Start the engine" });
  if (relay.health === "starting") return verdict(Light.Busy, "The relay is starting.");
  if (relay.health === "unhealthy") return verdict(Light.Red, "The relay's own health check fails.", { fix: Fixes.StackRestart, label: "Restart relay and room" });
  if (!login || login.kind === "skipped") return verdict(Light.Green, `Running${locked(game) ? " (not probed during a game)" : ""}.`);
  switch (login.kind) {
    case "authFailed":
      return verdict(Light.Red, `The relay refused the key (${login.detail || "no reason"}). ${friend
        ? "A MANABREW_SERVER_KEY setting on this computer (an environment variable, or a stack/.env file in this folder) gives the engine another key: remove it, press Stop everything, then start again."
        : "Check MANABREW_SERVER_KEY in stack/.env."}`, { fix: Fixes.Retry, label: "Try again" });
    case "ok":
      if (!login.roomFound) return verdict(Light.Busy, "The relay works; the Forge room isn't open yet.");
      if (login.roomStatus === "Lobby") return verdict(Light.Green, `Ready: room ${Room} is open (login ${login.ms} ms).`);
      if (locked(game)) return verdict(Light.Green, `Ready: room ${Room} is in a game.`);
      return verdict(Light.Red, "The room is busy with an earlier game, so a new start would be refused.", { fix: Fixes.StackRestart, label: "Restart relay and room" });
    default:
      return verdict(Light.Red, `The relay is up, but this computer can't log in to it (${String(login.kind).toLowerCase()}), so games would fail at setup. This happens after the container engine restarts, or after sleep.`, { fix: Fixes.StackRestart, label: "Restart relay and room" });
  }
}

// The first folder of the package the bridge can't write, in words, or null. tryWrite: dir -> null when writable.
function writeProblem(dirs, tryWrite) {
  for (const d of dirs) {
    const err = tryWrite(d);
    if (err !== null && err !== undefined)
      return `This folder can't be written to (${d}: ${err}). The bridge keeps its logs and card pictures here. Move the whole folder somewhere you can write, such as ~/Games/MTG-Table (not a read-only folder or a mounted archive), and start the companion from there.`;
  }
  return null;
}

// The container engine's output when starting the engine failed, in words (Logic.ComposeFailure)
function composeFailure(output, friend) {
  if (output === null || output === undefined) return "The engine didn't start.";
  const has_ = (s) => output.toLowerCase().includes(s.toLowerCase());
  if (has_("port is already allocated") || has_("address already in use") || has_("bind: address"))
    return friend
      ? "Port 9443 is taken, most likely by another copy of the MTG engine (an older copy of this folder, or a developer's setup). Stop that one first (Stop everything in its MTG Companion), then press the button."
      : "Port 9443 is taken, most likely by another copy of the MTG engine (e.g. the repo's \"stack\" containers). Stop that one first (docker compose -p stack stop), then press the button.";
  if (has_("pull access denied") || has_("No such image") || has_("image not known") || has_("short-name"))
    return "The container engine can't find the engine images. Press Try again on the Engine images row.";
  const last = output.trim().split("\n").map((s) => s.trim()).filter((s) => s.length > 0).pop();
  return `The engine didn't start: ${last || "no message"}.`;
}

// ───────────────────────────── 4. table save ─────────────────────────────

const SaveName = /^TS_Save_(\d+)\.(json|png)$/i;

// What to do with the table save (Logic.PlanSave). Never writes over a file the app didn't install:
//   - the file state.json says we installed: update it only when the package's save hash changed and it still hashes
//     to what we put there;
//   - else a save byte-identical to ours: adopt it (no write);
//   - else a new TS_Save_N.json with N past every number in use (.json or .png).
// existing: [{ name, size }]; st: { saveFile, saveHash } | null; hashOf(name) -> sha8
function planSave(existing, st, wantHash, ourHash, ourSize, hashOf) {
  if (!wantHash) wantHash = ourHash;
  const names = new Set(existing.map((e) => e.name.toLowerCase()));
  const present = (n) => names.has(n.toLowerCase());
  if (st && st.saveFile && SaveName.test(st.saveFile) && st.saveFile.toLowerCase().endsWith(".json")) {
    if (present(st.saveFile)) {
      if (st.saveHash === wantHash) return { kind: "skip", file: st.saveFile, text: `Installed as ${st.saveFile} (up to date).` };
      // overwritten only while it is still the file we put there: one the player saved over is theirs now
      if (hashOf(st.saveFile) === st.saveHash) return { kind: "update", file: st.saveFile, text: `Updating ${st.saveFile} to this package's table.` };
    } else return { kind: "install", file: st.saveFile, text: `Installing the table again as ${st.saveFile}.` };
  }
  for (const e of existing) {
    if (!e.name.toLowerCase().endsWith(".json") || !SaveName.test(e.name) || e.size !== ourSize) continue;
    if (hashOf(e.name) === ourHash) return { kind: "adopt", file: e.name, text: `Already installed as ${e.name}.` };
  }
  let max = 0;
  for (const e of existing) {
    const m = SaveName.exec(e.name);
    if (m) { const k = parseInt(m[1], 10); if (Number.isFinite(k)) max = Math.max(max, k); }
  }
  const file = `TS_Save_${max + 1}.json`;
  return { kind: "install", file, text: `Installing the table as ${file}.` };
}

// The save's own name, as TTS lists it
function readSaveName(json) {
  if (json === null || json === undefined) return null;
  const m = /"SaveName"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(json.length > 4096 ? json.slice(0, 4096) : json);
  if (!m) return null;
  try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
}

// ───────────────────────────── 5. bridge ─────────────────────────────

const BridgeArg = /(^|[\s"\\/])bridge\.js(["\s]|$)/i;
// a node command line running a file named exactly bridge.js (not echo-bridge.js or a *-bridge.js fake)
const isBridgeCommandLine = (cmd) => cmd !== null && cmd !== undefined && BridgeArg.test(cmd);
const norm = (p) => String(p || "").replace(/\\/g, "/").toLowerCase();

// The programs holding the bridge's ports: [{ port, pid, name, commandLine }]. ourBridgeJs: the package's bridge.js
// (friend mode), or null in home mode, where any bridge.js counts as ours. null when nothing is wrong. A listener whose
// owner couldn't be read (pid null) is "can't tell" and left to /versions, as a node whose command line can't be read.
function decidePorts(held, ourBridgeJs, friend) {
  for (const l of held) {
    if (l.port !== 39998 && l.port !== 48787) continue;
    if (l.pid === null || l.pid === undefined) continue;
    const isNode = /^node(\.exe)?$/i.test(l.name || "");
    if (isNode && (l.commandLine === null || l.commandLine === undefined)) continue; // can't tell: /versions decides
    if (isNode && isBridgeCommandLine(l.commandLine)) {
      if (!ourBridgeJs || norm(l.commandLine).includes(norm(ourBridgeJs))) continue;
      return verdict(Light.Red, `Another MTG bridge is already running (process ${l.pid}: ${clip(l.commandLine, 120)}). Stop it first (${friend ? "Stop everything in the MTG Companion of that other copy" : "in the repo: stop the bridge"}), then press Try again.`, { fix: Fixes.Retry, label: "Try again" });
    }
    return verdict(Light.Red, `${l.name || "a program"} (process ${l.pid}) is using port ${l.port}, which the bridge needs. This is usually the Tabletop Simulator extension in VS Code or Atom: close that program (or: kill ${l.pid}), then press the button.`, { fix: Fixes.ShowProgram, label: "I closed it: try again" });
  }
  return null;
}

function decideBridge(versions, portProblem, bridgeProcess, wantBridge, friend) {
  if (portProblem) return portProblem;
  if (versions.kind === "ok" && versions.status === 200) {
    const now = str(get(parseJson(versions.body), "now"), "bridge");
    if (wantBridge && now !== null && now !== wantBridge)
      return verdict(Light.Amber, `Running, but it isn't ${friend ? "this package's" : "the deployed"} bridge (${now}, expected ${wantBridge}). Restart it between games.`, { fix: Fixes.BridgeRestart, label: "Restart the bridge" });
    return verdict(Light.Green, `Running (bridge ${now || "?"}).`);
  }
  if (versions.kind === "refused") {
    if (bridgeProcess) return verdict(Light.Busy, "The bridge is starting.", { action: Actions.Wait });
    return verdict(Light.Busy, "Starting the bridge.", { action: Actions.StartBridge });
  }
  return verdict(Light.Amber, `The bridge runs but didn't answer in time (${versions.error || versions.kind}). It may be busy.`, { fix: Fixes.BridgeRestart, label: "Restart the bridge" });
}

// The bridge loop's restart line count, from the bridge's log
const countExits = (logTail) => (logTail ? (logTail.match(/\[bridge exited with code/g) || []).length : 0);

// ───────────────────────────── 6. TTS ─────────────────────────────

const DefaultSaveName = "MTG Table (rules engine)";
const Room = "tts-commander";
const ttsHowTo = (saveName) => `In TTS: Create → Singleplayer (or Multiplayer) → Games → Save & Load → ${saveName || DefaultSaveName}`;

// f: { running, versionsOk, tableHeard, steamFound, home, table, wantTable, saveName, tableHeardAgoSec, ttsUpSec }
function decideTts(f) {
  const how = ttsHowTo(f.saveName);
  if (!f.running) {
    if (!f.steamFound) return verdict(Light.Amber, "Steam wasn't found. Install Steam and Tabletop Simulator, then press Open TTS.", { fix: Fixes.TtsOpen, label: "Open TTS" });
    return verdict(Light.Amber, "Tabletop Simulator isn't running.", { fix: Fixes.TtsOpen, label: "Open TTS", hint: how });
  }
  if (!f.versionsOk) return verdict(Light.Amber, "TTS is running. The table can be checked once the bridge runs.", { hint: how });
  if (!f.tableHeard) return verdict(Light.Amber, `TTS is running. Load the table: ${how}.`, { hint: how });
  // (the stamp the bridge holds is the last table it heard: from an earlier TTS when this one started after it.
  // 5 s for the two clocks' reading times.)
  const known = (x) => x !== null && x !== undefined;
  if (known(f.tableHeardAgoSec) && known(f.ttsUpSec) && f.tableHeardAgoSec > f.ttsUpSec + 5)
    return verdict(Light.Amber, `TTS is running, the table isn't loaded in it yet. Load the table: ${how}.`, { hint: how });
  if (f.table === null || f.table === undefined) return verdict(Light.Red, `Old table loaded (it has no version): load ${f.saveName || DefaultSaveName} again.`, { hint: how });
  if (f.table === "dev") return verdict(Light.Amber, "Connected; the table was built from source, not deployed.");
  if (f.wantTable && f.table !== f.wantTable)
    return verdict(Light.Red, `Old table loaded (${f.table}, this ${f.home ? "deploy" : "package"} has ${f.wantTable}): load ${f.saveName || DefaultSaveName} again.`, { hint: how });
  return verdict(Light.Green, `Connected: table ${f.table} is loaded.`);
}

// ───────────────────────────── small helpers ─────────────────────────────

const sha8 = (data) => crypto.createHash("sha256").update(data).digest("hex").slice(0, 8);
function clip(s, n) { if (s === null || s === undefined) return ""; s = String(s); return s.length <= n ? s : `${s.slice(0, n)}…`; }

// The relay key: MANABREW_SERVER_KEY in stack/.env, else the compose default
function relayKey(envText) {
  if (envText)
    for (const line of envText.replace(/\r/g, "").split("\n")) {
      const t = line.trim();
      if (t.startsWith("MANABREW_SERVER_KEY=")) {
        const v = t.slice("MANABREW_SERVER_KEY=".length).trim().replace(/^["']+|["']+$/g, "");
        if (v.length > 0) return v;
      }
    }
  return "tts-local";
}

const rank = (l) => (l === Light.Red ? 4 : l === Light.Amber ? 3 : l === Light.Busy ? 2 : l === Light.Green ? 1 : 0);
function worst(lights) {
  let w = Light.Green, any = false, grey = true;
  for (const l of lights) { any = true; if (l !== Light.Grey) grey = false; if (rank(l) > rank(w)) w = l; }
  return !any || grey ? Light.Grey : w;
}

// ───────────────────────────── self-update: the pure rules (Update.cs) ─────────────────────────────
// The Linux/macOS companion CHECKS for updates and verifies the signature; it does not install them (yet): the
// release's runtime and companion parts are the Windows ones. An update found is offered as "download the new package".

const Updates = {
  Format: 1,
  Repo: "Vibecoding-mods/Table-Top-Simulator-Mock-MTGA",
  ApiBase: "https://api.github.com",
  UserAgent: "MTG-Companion",
  ManifestAsset: "update-manifest.json",
  SignatureAsset: "update-manifest.json.sig",
  NotPublic: "Updates will work once the project is public.",
  CheckEveryMs: 6 * 3600 * 1000,
  // the parts a Unix package can take from a release (runtime and companion are the Windows node.exe and exe)
  PartOrder: ["app", "table", "images"],
  KnownParts: ["app", "table", "runtime", "images", "companion"],
};
const TagRe = /^[\w.-]{1,100}$/;
const validTag = (tag) => typeof tag === "string" && TagRe.test(tag) && tag.replace(/^\.+|\.+$/g, "").length > 0;
const validFile = validTag;
const imagesVersion = (node, relay) => sha8(Buffer.from(`${node}${relay}`, "utf8"));

// the public keys this app trusts: release-keys.txt (base64 of X || Y, one per line; # comments)
const parseKeys = (text) => String(text || "").split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));

// ECDSA P-256 over the manifest's bytes, IEEE P1363 (r || s, 64 bytes), base64 in the .sig asset
function verifySignature(data, sigText, keys) {
  let sig;
  try {
    const t = String(sigText || "").trim();
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(t)) return false;
    sig = Buffer.from(t, "base64");
  } catch { return false; }
  if (!data || sig.length !== 64) return false;
  for (const k of keys) {
    try {
      const xy = Buffer.from(k, "base64");
      if (xy.length !== 64) continue;
      const key = crypto.createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: xy.subarray(0, 32).toString("base64url"), y: xy.subarray(32).toString("base64url") } });
      if (crypto.verify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, sig)) return true;
    } catch { /* next key */ }
  }
  return false;
}

// update-manifest.json, checked: tags and file names plain, every part with a sha256 and a size. { m } or { error }
function parseManifest(text) {
  const o = parseJson(text);
  if (!isObj(o)) return { error: "the update manifest isn't JSON" };
  const m = { format: int(o, "format"), minCompanion: int(o, "minCompanion"), version: str(o, "version"), built: str(o, "built"), gitCommit: str(o, "gitCommit"), versionJson: get(o, "versionJson"), deployedJson: get(o, "deployedJson"), parts: {} };
  if (m.format < 1) return { error: "the update manifest has no format" };
  if (!validTag(m.version)) return { error: "the update manifest has no usable version" };
  if (!isObj(m.versionJson) || !isObj(m.deployedJson)) return { error: "the update manifest lacks version.json or deployed.json" };
  const parts = get(o, "parts");
  if (!isObj(parts) || Object.keys(parts).length === 0) return { error: "the update manifest lists no parts" };
  for (const [k, v] of Object.entries(parts)) {
    if (!Updates.KnownParts.includes(k)) continue; // (a part this app doesn't know: a newer release)
    const p = { name: k, file: str(v, "file"), sha256: (str(v, "sha256") || "").toLowerCase(), version: str(v, "version"), release: str(v, "release") || m.version, size: Number(str(v, "size") || 0) || 0 };
    if (!validFile(p.file)) return { error: `the ${k} part has no plain file name` };
    if (!/^[0-9a-f]{64}$/.test(p.sha256)) return { error: `the ${k} part has no sha256` };
    if (p.size <= 0) return { error: `the ${k} part has no size` };
    if (!p.version) return { error: `the ${k} part has no version` };
    if (!validTag(p.release)) return { error: `the ${k} part names no usable release` };
    m.parts[k] = p;
  }
  return { m };
}

// The version of a part this package has: version.json parts, else what older packages already say
function localVersion(v, part) {
  const s = str(get(v, "parts"), part);
  if (s !== null) return s;
  switch (part) {
    case "table": return str(v, "save");
    case "runtime": return str(v, "nodeVersion");
    case "images": { const n = str(v, "node"), r = str(v, "relay"); return n !== null && r !== null ? imagesVersion(n, r) : null; }
    default: return null;
  }
}

// `built` as the packager writes it (toISOString), an ISO time with its zone; else null (ms since the epoch)
const IsoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$/;
function builtTime(s) {
  if (typeof s !== "string" || !IsoTime.test(s)) return null;
  const t = Date.parse(s.replace(/(\.\d{3})\d+/, "$1"));
  return Number.isFinite(t) ? t : null;
}

// A release built before this package is refused (whoever can move "latest" could serve an older signed release)
function downgrade(local, m) {
  const mine = builtTime(str(local, "built")), theirs = builtTime(m.built);
  if (mine === null) return "This package's version.json has no build time, so no release can be checked against it: download the full package again.";
  if (theirs === null) return `The update manifest of ${m.version} has no usable build time: not installing it.`;
  if (theirs < mine) return `The latest release (${m.version}) is older than this package; not installing it.`;
  return null;
}

function updatePlan(local, m, format) {
  const p = { upToDate: false, refused: null, fetch: [] };
  for (const k of Updates.PartOrder) { const part = m.parts[k]; if (part && localVersion(local, k) !== part.version) p.fetch.push(part); }
  p.upToDate = p.fetch.length === 0;
  if (m.minCompanion > format) { p.refused = "This release needs a newer MTG Companion. Download the full package again."; p.upToDate = false; }
  const older = downgrade(local, m);
  if (older) { p.refused = older; p.upToDate = false; }
  return p;
}
const planAvailable = (p) => !!p && !p.upToDate && !p.refused;

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
function describe(p, m) {
  const names = p.fetch.map((x) => (x.name === "app" ? "bridge and decks" : x.name === "images" ? "engine" : x.name));
  return `Update available: ${m.version} (${names.join(", ")}). Download the new package for this computer from the project's Releases page and unpack it beside this one.`;
}

// a release from GET .../releases/latest
function parseRelease(body) {
  const o = parseJson(body);
  const tag = str(o, "tag_name");
  if (!validTag(tag)) return null;
  const assets = (Array.isArray(get(o, "assets")) ? get(o, "assets") : []).map((a) => ({ name: str(a, "name"), url: str(a, "url"), size: Number(str(a, "size") || 0) || 0 }));
  return { tag, assets };
}

function checkFailed(status, error) {
  if (status === 404) return Updates.NotPublic;
  if (status === 401 || status === 403) return `Couldn't check for updates: GitHub refused (HTTP ${status}; a token may be wrong or expired, or too many checks this hour).`;
  return `Couldn't check for updates (${status > 0 ? `HTTP ${status}` : error || "no answer"}).`;
}

function checkDue(lastCheckIso, nowMs) {
  const last = Date.parse(lastCheckIso || "");
  if (!Number.isFinite(last)) return true;
  const since = nowMs - last;
  return since >= Updates.CheckEveryMs || since < 0; // (a clock set back: check)
}

// Whether a URL may be fetched, and whether it is the API (the only host a token goes to). { ok, api }
const UpdateHosts = ["api.github.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"];
function loopback(u) { return u.protocol === "http:" && !u.username && !u.password && (u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]"); }
function allowedUrl(url, testBase) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, api: false }; }
  if (u.username || u.password) return { ok: false, api: false };
  if (testBase) {
    let b;
    try { b = new URL(testBase); } catch { return { ok: false, api: false }; }
    if (!loopback(b)) return { ok: false, api: false };
    if (u.protocol === b.protocol && u.hostname === b.hostname && u.port === b.port) return { ok: true, api: true };
    return { ok: u.protocol === "http:" && u.hostname === "localhost" && u.port === b.port, api: false };
  }
  if (u.protocol !== "https:" || u.port !== "") return { ok: false, api: false };
  const host = u.hostname.toLowerCase();
  if (!UpdateHosts.includes(host)) return { ok: false, api: false };
  return { ok: true, api: host === "api.github.com" };
}
const tokenFor = (api, testBase, token) => (api && !testBase ? token || null : null);

// the update's state, one snapshot (UpdateState.Checked)
function updateChecked(s, r, laterSame, nowIso) {
  const available = !r.failed && planAvailable(r.plan);
  return {
    ...s, lastCheck: nowIso, text: r.text,
    status: available ? "available" : r.quiet ? "not-public" : r.failed || (r.plan && r.plan.refused) ? "failed" : "up-to-date",
    error: available || r.quiet || !(r.failed || (r.plan && r.plan.refused)) ? null : r.text,
    available: available ? r.manifest.version : null, notes: available ? r.text : null, later: available && laterSame, progress: -1,
  };
}

module.exports = {
  Light, verdict, vText, Fixes, Actions, makeLayout, detectLayout, findImagesTar, Names, Step,
  StackWaitSeconds, stackTimedOut, startFrom, resumeAfterStop,
  httpOk, httpOf, parseJson, isObj, get, has, str, int, Game, decideGame, playersText, locked, lockText,
  DockerUrl, decideDocker, sameId, normId, deployedAfterLoad, shortId, decideImages,
  decideStack, writeProblem, composeFailure, SaveName, planSave, readSaveName,
  isBridgeCommandLine, decidePorts, decideBridge, countExits,
  DefaultSaveName, Room, ttsHowTo, decideTts, sha8, clip, relayKey, worst,
  Updates, validTag, imagesVersion, parseKeys, verifySignature, parseManifest, localVersion, builtTime, downgrade,
  updatePlan, planAvailable, describe, parseRelease, checkFailed, checkDue, allowedUrl, tokenFor, updateChecked, mb,
};
