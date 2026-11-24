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

const Actions = { StartDesktop: "start-desktop", Wait: "wait", Load: "load", StartBridge: "start-bridge", RestartBridge: "restart-bridge" };

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
  l.serverFile = path.join(home, "server.json"); // (own server: where the engine runs, when not on this computer)
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
// stop.sh / Stop MTG.command during a game (or when it can't tell): refused, as the status page's Stop everything
// asks again first; force is the second answer. null: go ahead.
function stopRefusal(g, force, forceCmd) {
  if (force || !locked(g)) return null;
  return `Not stopped: ${g && g.kind === "cantTell" ? "the companion can't tell whether a game is on" : "a game is on"} (${g ? g.text : "no answer"}). Stopping now ends it for everyone at the table. To stop anyway: ${forceCmd}`;
}

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
    if (!f.relayId || !f.nodeId) return verdict(Light.Red, "No engine images. This looks like the source code (GitHub's green Code button): get the MTG-Table zip from the Releases page instead. Hosts building from source: bash engine/build-images.sh (about 20 minutes), then Try again.", { fix: Fixes.Retry, label: "Try again" });
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

// ───────────────────────────── own server (the engine runs on another computer) ─────────────────────────────
// A host may run the engine (relay and Forge room) on their own server instead of this computer. server.json in the
// package folder (in the repo: its root) says where: { "host": "mtg.example.org", "port": 9443, "key": "...",
// "secure": false }; "host" and a key are needed (the key from server.json, else MTG_SERVER_KEY; never this package's
// own key, which is for the engine on this computer). --server host[:port] does the same for one run: for the host
// server.json names it only changes the port; for another host the file's key, port and secure are dropped (a key is
// never sent to a server it wasn't written for), so the key comes from MTG_SERVER_KEY. With a server, steps 1-3 start
// nothing here: the engine step is a login to that server, and the bridge connects to it.
const ServerFile = "server.json";
const DefaultServerPort = 9443;
const ServerKeys = ["host", "port", "key", "secure"];

// a host name (underscores and a trailing dot allowed, as DNS names have them), an IPv4 address or a bracketed IPv6
// one; nothing else (no scheme, path, user or spaces)
function serverHostProblem(h) {
  if (typeof h !== "string" || !h.trim()) return "\"host\" is missing: give the server's name or address, e.g. \"mtg.example.org\".";
  const host = h.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) return `"host" is "${host}": give the name only, without ws:// or http:// (the port goes in "port").`;
  if (/^\[[0-9a-f:.]+\]$/i.test(host)) return null;
  if (host.length > 254 || !/^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*\.?$/i.test(host))
    return `"host" is "${host}", which isn't a server name or address (letters, digits, dots, dashes and underscores; an IPv6 address in [brackets]).`;
  return null;
}

// one server setting: { ok: true, server: { host, port, key, secure } } or { ok: false, problem }
function parseServer(o) {
  if (!isObj(o)) return { ok: false, problem: "it isn't a JSON object like { \"host\": \"mtg.example.org\" }." };
  const unknown = Object.keys(o).filter((k) => !ServerKeys.includes(k));
  if (unknown.length) return { ok: false, problem: `unknown setting${unknown.length > 1 ? "s" : ""} ${unknown.map((k) => `"${k}"`).join(", ")} (the settings are ${ServerKeys.map((k) => `"${k}"`).join(", ")}).` };
  const hp = serverHostProblem(o.host);
  if (hp) return { ok: false, problem: hp };
  let port = DefaultServerPort;
  if (o.port !== undefined && o.port !== null) {
    port = typeof o.port === "string" && /^\d+$/.test(o.port.trim()) ? Number(o.port.trim()) : o.port;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, problem: `"port" is ${JSON.stringify(o.port)}: a number from 1 to 65535 (the relay's is ${DefaultServerPort} unless you changed it).` };
  }
  if (o.key !== undefined && o.key !== null && (typeof o.key !== "string" || !o.key.trim())) return { ok: false, problem: "\"key\" must be the server's key as text (or left out)." };
  if (o.secure !== undefined && o.secure !== null && typeof o.secure !== "boolean") return { ok: false, problem: "\"secure\" must be true or false (true: the server's relay is behind TLS, wss://)." };
  return { ok: true, server: { host: o.host.trim().toLowerCase(), port, key: typeof o.key === "string" ? o.key.trim() : null, secure: o.secure === true } };
}

// "host[:port]" (--server) as a setting object, or null when it isn't one
function serverSpec(spec) {
  if (typeof spec !== "string" || !spec.trim()) return null;
  const t = spec.trim();
  const m = /^(\[[^\]]+\]|[^:\s]+)(?::(\d+))?$/.exec(t);
  if (!m) return { host: t };
  return m[2] !== undefined ? { host: m[1], port: Number(m[2]) } : { host: m[1] };
}

// the same server name: case and a trailing dot don't count
const sameHost = (a, b) => typeof a === "string" && typeof b === "string" && a.trim().toLowerCase().replace(/\.$/, "") === b.trim().toLowerCase().replace(/\.$/, "");

// The server this run uses: null (the engine on this computer), or parseServer's result, which must have a key.
// fileText: server.json's text (null: no file); spec: --server's value (null: none); envKey: MTG_SERVER_KEY.
function serverSetting(fileText, spec, envKey) {
  const hasFile = fileText !== null && fileText !== undefined;
  let fromFile = null;
  if (hasFile) {
    // (a UTF-8 BOM, as Notepad writes one, isn't JSON; any JSON value counts, so false or 0 is an error, never "no file")
    try { fromFile = JSON.parse(String(fileText).replace(/^\uFEFF/, "")); } catch {
      return { ok: false, problem: `${ServerFile} isn't valid JSON. Write it like { "host": "mtg.example.org", "port": 9443, "key": "..." }, or delete it to run the engine on this computer.` };
    }
    if (!isObj(fromFile)) return { ok: false, problem: `${ServerFile}: ${parseServer(fromFile).problem}` };
  }
  const cli = serverSpec(spec);
  if (!hasFile && !cli) return null;
  // --server naming another host than server.json's: none of the file's settings are for it (above all its key)
  const otherHost = !!(cli && fromFile && !sameHost(cli.host, fromFile.host));
  const merged = cli ? (otherHost ? { ...cli } : { ...fromFile, ...cli }) : fromFile;
  const r = parseServer(merged);
  if (!r.ok) return { ok: false, problem: `${cli ? "--server" : ServerFile}: ${r.problem}` };
  if (!r.server.key && typeof envKey === "string" && envKey.trim()) r.server.key = envKey.trim();
  // (never this package's own key: that one is for the engine on this computer, and a server must not be sent it)
  if (!r.server.key)
    return { ok: false, noKey: true, problem: otherHost
      ? `--server ${r.server.host}: no key for this server (${ServerFile}'s key is for ${String(fromFile.host).trim()}, so it isn't sent to another server). Set MTG_SERVER_KEY to this server's key (its MANABREW_SERVER_KEY), or put this server in ${ServerFile}.`
      : `no key for your server (${serverWords(r.server)}). Put the server's key (its MANABREW_SERVER_KEY, in the server's stack/.env) in ${ServerFile} as "key", or set MTG_SERVER_KEY.` };
  return r;
}

// server.json holds the server's key: it should be readable by this account only (mode 0600). mode: the file's
// st_mode. null: private already
function serverFileModeProblem(mode) {
  if (typeof mode !== "number" || (mode & 0o077) === 0) return null;
  return `${ServerFile} can be read by other accounts on this computer (mode ${(mode & 0o777).toString(8).padStart(3, "0")}), and it holds your server's key`;
}

// What the running bridge's GET /versions says it connects to: its relay, and whether it runs for an engine elsewhere
// (bridge.js answers relay and remoteEngine; an older bridge says neither: null)
function bridgeRelay(body) {
  const o = parseJson(body);
  return has(o, "relay") ? { relay: str(o, "relay"), remote: get(o, "remoteEngine") === true } : null;
}
// Whether a running bridge connects to another engine than this run's: with a server, any relay but the server's (or
// a bridge too old to say); without one, a bridge that runs for a server. running: bridgeRelay's result
function relayDiffers(running, server) {
  if (server) return !running || running.relay !== serverUrl(server) || !running.remote;
  return !!running && running.remote;
}

const serverUrl = (s) => `${s.secure ? "wss" : "ws"}://${s.host}:${s.port}`;
const serverWords = (s) => `${s.host}:${s.port}`;
// steps 1 and 2 with a server: nothing to run here
const serverNotNeeded = (s) => verdict(Light.Green, `Not needed here: the engine runs on your server (${serverWords(s)}).`);

// The engine step with a server: its login (probes.relayLogin's result, or { kind: "skipped" } during a game) as a
// light. setting: serverSetting's result.
// The server's engine build against the one this table was deployed with (stack/deployed.json engineBuild): words
// for the warning, or null when they match or either is unknown (a server or a deploy older than the field)
function engineBuildWarning(have, want) {
  if (!have || !want || have === want) return null;
  return `Your server runs engine ${have}, but this table was deployed with engine ${want}. They may not work together: ask the host to update the server, or update this package.`;
}

function decideServer(setting, login, game, wantBuild) {
  if (!setting.ok) return verdict(Light.Red, `Own server: ${setting.problem}`, { fix: Fixes.Retry, label: "Try again" });
  const s = setting.server, at = serverWords(s);
  const again = { fix: Fixes.Retry, label: "Try again" };
  if (!login || login.kind === "skipped") return verdict(Light.Green, `Your server (${at})${locked(game) ? ": not probed during a game" : ""}.`);
  const why = login.detail ? ` (${clip(String(login.detail), 120)})` : "";
  switch (login.kind) {
    case "ok":
      if (!login.roomFound) return verdict(Light.Red, `Connected to your server (${at}), but its Forge room (${Room}) isn't open. Start the Forge room on the server, then press Try again.`, again);
      if (login.roomStatus === "Lobby" || locked(game)) {
        const warn = engineBuildWarning(login.engineBuild, wantBuild);
        if (warn) return verdict(Light.Amber, warn, again);
        return verdict(Light.Green, login.roomStatus === "Lobby" ? `Your server (${at}): room ${Room} is open (login ${login.ms} ms).` : `Your server (${at}): room ${Room} is in a game.`);
      }
      return verdict(Light.Red, `Your server's room (${at}) is busy with an earlier game, so a new start would be refused. Restart the relay and the Forge room on the server.`, again);
    case "authFailed":
      return verdict(Light.Red, `Your server (${at}) refused the key${why}. Put the server's key (its MANABREW_SERVER_KEY) in ${ServerFile} as "key".`, again);
    case "refused":
      return verdict(Light.Red, `Your server (${at}) refused the connection${why}: nothing listens on port ${s.port} there. Check the port in ${ServerFile} and that the engine runs on the server.`, again);
    case "notFound":
      return verdict(Light.Red, `Your server's name "${s.host}" isn't known${why}: it doesn't resolve to an address. Check the spelling of "host" in ${ServerFile} (or use the server's IP address).`, again);
    case "timeout":
      return verdict(Light.Red, `Your server (${at}) didn't answer${why}. Check that it is on, that its firewall lets port ${s.port} in, and the address in ${ServerFile}.`, again);
    default:
      return verdict(Light.Red, `Can't reach your server (${at})${why}. Check the address in ${ServerFile}, that the server is on, and that port ${s.port} is open to this computer${s.secure ? " (secure: true needs TLS on the server)" : ""}.`, again);
  }
}

// ── the table comes from the host's own Workshop copy (the package ships our patcher, table/make-table.js, never the
// Workshop table: Steam lets a subscriber use a Workshop item, not hand out copies). As companion/src/Logic.cs.
const TableWorkshopId = "2296042369"; // the 4-player table
const SixWorkshopId = "2293586471";   // the 6-player table (optional, once its profile exists)
const workshopUrl = (id) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

function workshopMissing(url, tried) {
  return verdict(Light.Red, `Subscribe to the table on the Steam Workshop: ${url}, start TTS once so it downloads, then press Try again.`, {
    fix: Fixes.Retry, label: "Try again",
    hint: `This package doesn't include the table: the companion makes it from your own Workshop copy.\n1. Open ${url} (signed in to Steam) and press Subscribe.\n2. Start Tabletop Simulator once, up to its main menu, so Steam downloads it.\n3. Press Try again.\nLooked for it in:\n    ${(tried || []).join("\n    ")}`,
  });
}

// make-table.js prints one JSON line: { ok, stamp, save, workshop } or { ok: false, missing, error }
function parseMakeTable(code, output) {
  let o = null;
  for (const line of String(output || "").split("\n").reverse()) {
    const t = line.trim();
    if (t.startsWith("{")) { o = parseJson(t); if (isObj(o)) break; o = null; }
  }
  if (!o) {
    const last = String(output || "").trim().split("\n").pop().trim();
    return { ok: false, missing: false, error: `the patcher said nothing${code !== 0 ? ` (exit ${code})` : ""}${last ? `: ${last}` : ""}` };
  }
  const ok = code === 0 && o.ok === true;
  return { ok, missing: o.missing === true, stamp: str(o, "stamp"), save: str(o, "save"), workshop: str(o, "workshop"), error: ok ? null : str(o, "error") || `the patcher failed (exit ${code})` };
}

function tableBuildFailed(b) {
  return verdict(Light.Red, `Couldn't make the table from your Workshop copy: ${b.error}`, {
    fix: Fixes.Retry, label: "Try again",
    hint: "The companion patches your Workshop copy of the table. A patch that doesn't apply means the table's author changed it on the Workshop since this package was made: ask whoever gave you this package for a newer one.",
  });
}

// The save step's line once installed: green when the table is the one this package was checked with, amber when the
// host's Workshop copy made another (its author changed it: it may well work, but it is untested)
function saveDone(text, ourHash, packageSave, stamp, packageTable) {
  if (!packageSave || ourHash === packageSave) return verdict(Light.Green, text);
  return verdict(Light.Amber, `${text} Your Workshop copy of the table isn't the one this package was checked with (the table's author may have changed it): its table is ${stamp || "?"}, the package's ${packageTable || "?"}. It may work; if the table misbehaves, ask for a newer package.`);
}

// The package's stack/deployed.json with the table this host made (the bridge compares the loaded table with it), or
// null when it already says so. The package's own stays as tablePackage.
function deployedWithTable(deployed, stamp) {
  if (!isObj(deployed) || !stamp || str(deployed, "table") === stamp) return null;
  const next = { ...deployed };
  if (!has(next, "tablePackage")) next.tablePackage = str(deployed, "table");
  next.table = stamp;
  return next;
}

// The first folder of the package the bridge can't write, in words, or null. tryWrite: dir -> null when writable.
// The table save step when TTS's own folder wasn't found anywhere (savesDirFor found false): wait, never make it,
// since a save put where TTS doesn't look would be green and never show up. null: the folder is there.
function savesFolderVerdict(found, tried) {
  if (found) return null;
  return verdict(Light.Amber, `Tabletop Simulator hasn't been run on this computer yet (its folder isn't in ${(tried || []).slice(0, 2).join(" or ") || "the usual places"}${(tried || []).length > 2 ? `, or ${tried.length - 2} other places` : ""}). Run Tabletop Simulator once from Steam (up to its main menu), then press Try again.`, { fix: Fixes.Retry, label: "Try again" });
}

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

// server: this run's own server (parseServer's server), or null: the engine on this computer. A bridge running for
// another engine (started before server.json was made or changed) is restarted: action RestartBridge.
function decideBridge(versions, portProblem, bridgeProcess, wantBridge, friend, server) {
  if (portProblem) return portProblem;
  if (versions.kind === "ok" && versions.status === 200) {
    const running = bridgeRelay(versions.body);
    if (relayDiffers(running, server || null))
      return verdict(Light.Amber, `Running, but for another engine (${running && running.relay ? running.relay : "it doesn't say which"}; this run's is ${server ? `your server, ${serverUrl(server)}` : "the one on this computer"}). It is restarted for this one.`, { fix: Fixes.BridgeRestart, label: "Restart the bridge", action: Actions.RestartBridge });
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
// the header's light (Logic.Overall): after Stop everything, or before Start engine, grey unless a light is red
function overall(lights, stoppedOrNotStarted) {
  const all = [...lights];
  if (stoppedOrNotStarted) return all.includes(Light.Red) ? Light.Red : Light.Grey;
  return worst(all);
}

// ───────────────────────────── Start engine (Logic.cs) ─────────────────────────────
// Launching the companion only checks (one read-only pass, then the watcher); the Start engine button runs the start
// sequence (--start on the command line still starts it at launch, as every launch did before 2026-11-14).

const NotStartedPhase = "Not started: press Start engine";
const StoppedPhase = "Stopped. Start engine starts it again.";
const StartHint = "The engine isn't running. Press Start engine (under Actions): it starts the container engine if needed (Docker Desktop on a Mac), the engine (relay and Forge room), installs the table save, starts the bridge and opens Tabletop Simulator. The lights show each step.\n\nOnly the host runs this app. Friends join your TTS game (Multiplayer) and need nothing else.";

// the engine is up: the container engine, the images, the stack and the bridge all green (the save and TTS don't decide it)
const engineUp = (rows) => rows.length >= 5 && rows[0] === Light.Green && rows[1] === Light.Green && rows[2] === Light.Green && rows[4] === Light.Green;

// A light before Start engine was pressed: a part that only isn't running yet is grey and points at Start engine (no
// red light, no notification, nothing started); a real problem (no engine installed, a port taken, a missing package
// file) keeps its light. step: 0-5 as Step.
function beforeStart(step, v) {
  if (!v) return v;
  switch (step) {
    case Step.Docker:
      if (v.action === Actions.StartDesktop) return verdict(Light.Grey, "Docker Desktop isn't running. Start engine starts it.");
      if (v.action === Actions.Wait) return verdict(Light.Grey, "Docker Desktop runs, but its engine isn't answering yet. Start engine waits for it.");
      break;
    case Step.Images:
      if (v.action === Actions.Load) return verdict(Light.Grey, "Not loaded yet. Start engine loads them from the package (first run: a few minutes).");
      break;
    case Step.Stack:
      if (v.fix === Fixes.StackRestart && v.fixLabel === "Start the engine") return verdict(Light.Grey, "Not running. Start engine starts the relay and the Forge room.");
      break;
    case Step.Bridge:
      if (v.action === Actions.StartBridge) return verdict(Light.Grey, "Not running. Start engine starts it.");
      break;
    default: break;
  }
  return v;
}

// "What to do next": the first hint of an amber or red light; before Start engine, the first red light's hint (a real
// problem comes first), else the Start engine sentence; else how to load the table in TTS
function nextHint(rows, needsStart, saveName) {
  const list = rows.filter((v) => v);
  if (needsStart) return (list.find((v) => v.hint && v.light === Light.Red) || {}).hint || StartHint;
  return (list.find((v) => v.hint && v.light !== Light.Green && v.light !== Light.Grey) || {}).hint
    || `${ttsHowTo(saveName)}\n\nOnly the host runs this app. Friends join your TTS game (Multiplayer) and need nothing else.`;
}

// launch starts the engine only when asked (Program.AutoStart): --start, or a self-update's restart (--after-update,
// --apply-update, the Windows app's; this companion doesn't install updates itself yet, so nothing passes them here)
const autoStart = (args) => args.includes("--start") || args.includes("--after-update") || args.includes("--apply-update");

// ───────────────────────────── self-update: the pure rules (Update.cs) ─────────────────────────────
// The Linux/macOS companion CHECKS for updates and verifies the signature; it does not install them (yet): the
// release's runtime and companion parts are the Windows ones. An update found is offered as "download the new package".

const Updates = {
  Format: 2, // (2: the table is made from the host's Workshop copy; the table part is the patcher)
  Repo: "Vibecoding-mods/Table-Top-Simulator-MTG-Rules-Enforcer",
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
// what a set of parts changes, in the owner's words (Updates.Changes): "table", "app" (bridge and decks, the Node
// runtime, the app itself), "engine" (the images); in that order, each once
function changes(parts) {
  const s = new Set(parts || []);
  const c = [];
  if (s.has("table")) c.push("table");
  if (s.has("app") || s.has("runtime") || s.has("companion")) c.push("app");
  if (s.has("images")) c.push("engine");
  return c;
}
function changesWords(c) {
  const w = (c || []).map((x) => `the ${x}`);
  if (!w.length) return "nothing";
  return w.length === 1 ? w[0] : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`;
}
const partWords = (n) => (n === "app" ? "bridge and decks" : n === "images" ? "engine" : n === "companion" ? "this app" : n === "runtime" ? "Node runtime" : n);
function describe(p, m) {
  const names = p.fetch.map((x) => partWords(x.name));
  return `Update available: ${m.version}: changes ${changesWords(changes(p.fetch.map((x) => x.name)))} (${names.join(", ")}). Download the new package for this computer from the project's Releases page and unpack it beside this one.`;
}

// a release from GET .../releases/latest
function parseRelease(body) {
  const o = parseJson(body);
  const tag = str(o, "tag_name");
  if (!validTag(tag)) return null;
  const assets = (Array.isArray(get(o, "assets")) ? get(o, "assets") : []).map((a) => ({ name: str(a, "name"), url: str(a, "url"), size: Number(str(a, "size") || 0) || 0 }));
  return { tag, assets, whatsNew: whatsNew(str(o, "body")) };
}

const WhatsNewMax = 10, WhatsNewItemMax = 400;

// The "### What's new" section of a release's notes (as Updates.WhatsNew in the Windows app): one plain-text line per
// "- " item, continuation lines joined, ** and ` dropped, at most WhatsNewMax items of WhatsNewItemMax characters.
function whatsNew(body) {
  const items = [];
  let inside = false, cur = null;
  const flush = () => {
    if (cur === null) return;
    let t = cur.split("**").join("").split("__").join("").split("`").join("").replace(/\s+/g, " ").trim();
    if (t.length > WhatsNewItemMax) t = t.slice(0, WhatsNewItemMax - 1).trimEnd() + "…";
    if (t && items.length < WhatsNewMax) items.push(t);
    cur = null;
  };
  for (const raw of String(body || "").split(String.fromCharCode(10))) {
    const trim = raw.trim();
    if (trim.startsWith("#")) {
      flush();
      if (inside) break;
      inside = trim.replace(/^#+/, "").trim().replace(/’/g, "'").toLowerCase() === "what's new";
      continue;
    }
    if (!inside) continue;
    if (trim.startsWith("- ") || trim.startsWith("* ")) { flush(); cur = trim.slice(2); }
    else if (trim && cur !== null) cur += " " + trim;
  }
  flush();
  return items;
}

// the release's page on GitHub, made from the tag (never a URL from GitHub's answer)
const releasePage = (tag) => `https://github.com/${Updates.Repo}/releases/tag/${encodeURIComponent(tag || "")}`;

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
    changes: available ? changes(r.plan.fetch.map((x) => x.name)) : null,
    whatsNew: available && r.release && r.release.whatsNew && r.release.whatsNew.length ? r.release.whatsNew : null,
  };
}

module.exports = {
  Light, verdict, vText, Fixes, Actions, makeLayout, detectLayout, findImagesTar, Names, Step,
  StackWaitSeconds, stackTimedOut, startFrom, resumeAfterStop,
  httpOk, httpOf, parseJson, isObj, get, has, str, int, Game, decideGame, playersText, locked, lockText,
  DockerUrl, decideDocker, sameId, normId, deployedAfterLoad, shortId, decideImages,
  TableWorkshopId, SixWorkshopId, workshopUrl, workshopMissing, parseMakeTable, tableBuildFailed, saveDone, deployedWithTable,
  decideStack, ServerFile, DefaultServerPort, parseServer, serverSpec, sameHost, serverSetting, serverFileModeProblem, bridgeRelay, relayDiffers, serverUrl, serverWords, serverNotNeeded, decideServer, engineBuildWarning,
  savesFolderVerdict, stopRefusal, writeProblem, composeFailure, SaveName, planSave, readSaveName,
  isBridgeCommandLine, decidePorts, decideBridge, countExits,
  DefaultSaveName, Room, ttsHowTo, decideTts, sha8, clip, relayKey, worst, overall,
  NotStartedPhase, StoppedPhase, StartHint, engineUp, beforeStart, nextHint, autoStart,
  Updates, validTag, imagesVersion, parseKeys, verifySignature, parseManifest, localVersion, builtTime, downgrade,
  updatePlan, planAvailable, describe, changes, changesWords, parseRelease, whatsNew, releasePage, checkFailed, checkDue, allowedUrl, tokenFor, updateChecked, mb,
};
