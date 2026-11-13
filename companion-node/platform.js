// The Linux/macOS side, pure: where things are on this platform, which container engine to use, the run arguments
// that stand in for the compose file, and the parsers for what /proc, ps, lsof and the container CLI print. No I/O
// here (engine.js and probes.js run the commands and read the files), so --selftest checks all of it on any OS.
"use strict";
const path = require("path").posix;

// ───────────────────────────── folders ─────────────────────────────

const TTS_APP_ID = 286160;

// TTS's Saves folder. macOS: ~/Library/Tabletop Simulator/Saves. Linux, native TTS (the Steam Deck default):
// ~/.local/share/Tabletop Simulator/Saves; TTS run through Proton keeps its Documents in the Proton prefix instead,
// used when only that one exists. exists(dir) -> bool. (Both checked against TTS's knowledge base, see README.)
function savesDirFor(platform, homeDir, exists, env) {
  env = env || {};
  if (platform === "darwin") return path.join(homeDir, "Library", "Tabletop Simulator", "Saves");
  const xdg = env.XDG_DATA_HOME && env.XDG_DATA_HOME.startsWith("/") ? env.XDG_DATA_HOME : path.join(homeDir, ".local", "share");
  const native = path.join(xdg, "Tabletop Simulator", "Saves");
  if (exists(path.dirname(native))) return native;
  for (const steam of [path.join(xdg, "Steam"), path.join(homeDir, ".steam", "steam")]) {
    const proton = path.join(steam, "steamapps", "compatdata", String(TTS_APP_ID), "pfx", "drive_c", "users", "steamuser", "Documents", "My Games", "Tabletop Simulator", "Saves");
    if (exists(path.dirname(proton))) return proton;
  }
  return native;
}

// The companion's own state (state.json, updates.json, save backups)
function stateDirFor(platform, homeDir, env) {
  env = env || {};
  if (platform === "darwin") return path.join(homeDir, "Library", "Application Support", "MTG Companion");
  const base = env.XDG_STATE_HOME && env.XDG_STATE_HOME.startsWith("/") ? env.XDG_STATE_HOME : path.join(homeDir, ".local", "state");
  return path.join(base, "mtg-companion");
}

// ───────────────────────────── the container engine ─────────────────────────────

// Docker when it answers, else Podman (rootless; no daemon), else Docker if it is installed (a Mac's Docker Desktop
// that isn't started yet: the app starts it). sticky: the engine already chosen this run (the stack lives in it).
function chooseRuntime(f) {
  if (f.override === "docker" || f.override === "podman") return f.override;
  if (f.sticky && ((f.sticky === "docker" && (f.dockerFound || f.desktopFound)) || (f.sticky === "podman" && f.podmanFound))) return f.sticky;
  if (f.dockerFound && f.dockerAnswers) return "docker";
  if (f.podmanFound && !f.desktopFound) return "podman";
  if (f.dockerFound || f.desktopFound) return "docker";
  if (f.podmanFound) return "podman";
  return null;
}

// `<cli> info --format "{{json .}}"`: Docker's and Podman's shapes
function parseInfo(runtime, out) {
  let o;
  try { o = JSON.parse(String(out || "").trim().split("\n").filter((l) => l.trim().startsWith("{")).join("\n") || "null"); } catch { o = null; }
  if (!o || typeof o !== "object") return null;
  if (runtime === "podman") {
    const host = o.host || {}, ver = o.version || {};
    return { version: ver.Version || null, osType: host.os || "linux", cpus: Number(host.cpus) || 0, rootless: !!(host.security && host.security.rootless) };
  }
  return { version: o.ServerVersion || null, osType: o.OSType || null, cpus: Number(o.NCPU) || 0, rootless: false };
}

// the CLI's words for "this account may not use the engine"
const accessDeniedText = (out) => /permission denied/i.test(out || "") && /docker\.sock|\/var\/run|connect/i.test(out || "");
const noSuchText = (out) => /no such (image|container|object|network)|image not known|failed to find image|no container with name|not found/i.test(out || "");

// The engine's containers, named as compose names them (the bridge's versions.js reads <project>-forge-room-1)
const containerName = (project, service) => `${project}-${service}-1`;
const networkName = (project) => `${project}_default`;
const Services = ["relay", "forge-room"];
const Images = { relay: "mtg-relay:exile", "forge-room": "mtg-forge-node:exile" };

// `<cli> run` for one service: the same as the package's stack/compose.yml (make-friend-package.js composeYaml) with no
// compose needed. o: { project, runtime, key, platform, arch, seats }.
//   - every port on 127.0.0.1 only; the room reaches the relay as "relay" on the project's own network;
//   - --pull never: the images come from images/mtg-images.tar, there is nothing to pull;
//   - Podman: --no-healthcheck (its health checks need systemd timers a rootless setup may not run, and a check that
//     never runs stays "starting" forever; the relay login decides instead), no --userns needed (no volumes);
//   - an Apple Silicon Mac runs the amd64 images under emulation (Docker Desktop: Rosetta), said with --platform.
function runArgs(service, o) {
  const name = containerName(o.project, service);
  const a = ["run", "-d", "--name", name, "--network", networkName(o.project), "--network-alias", service,
    "--label", `com.docker.compose.project=${o.project}`, "--label", `com.docker.compose.service=${service}`,
    "--restart", "unless-stopped", "--pull", "never"];
  if (o.runtime === "podman") a.push("--no-healthcheck");
  if (o.platform === "darwin" && o.arch === "arm64") a.push("--platform", "linux/amd64");
  const env = service === "relay"
    ? { MANABREW_SERVER_KEY: o.key, RUST_LOG: "manabrew_server=info" }
    : {
      SELF_HOSTED_NODE_RELAY_URL: "ws://relay:9443", SELF_HOSTED_NODE_SERVER_KEY: o.key, SELF_HOSTED_NODE_ROOM_NAME: "tts-commander",
      SELF_HOSTED_NODE_ENGINE_BACKEND: "forge", SELF_HOSTED_NODE_FORMAT: "commander", SELF_HOSTED_NODE_MAX_PLAYERS: String(o.seats || 4),
      SELF_HOSTED_NODE_AUTO_START: "true", RUST_LOG: "self_hosted_node=info",
    };
  for (const [k, v] of Object.entries(env)) a.push("-e", `${k}=${v}`);
  if (service === "relay") a.push("-p", "127.0.0.1:9443:9443");
  a.push(Images[service]);
  return a;
}

// The key the containers get: MANABREW_SERVER_KEY from the environment (as compose reads it), else stack/.env, else
// the default. The login uses the same one, so the two can't disagree.
function engineKey(envVar, envFileKey) { return envVar && envVar.trim() ? envVar.trim() : envFileKey; }

// What `up` must do for one service, from its container and the tag's image id: run it, start it, replace it (the
// image changed, as compose up -d recreates), or leave it.
function upPlan(info, tagId, sameId) {
  if (!info || !info.exists) return "run";
  if (tagId && info.image && !sameId(info.image, tagId)) return "replace";
  if (info.state !== "running") return "start";
  return "keep";
}

// `<cli> container inspect <name>` (a JSON array) -> { exists, id, name, state, health, image }
function containerFromInspect(out, normId) {
  let a;
  try { a = JSON.parse(out); } catch { return null; }
  const o = Array.isArray(a) ? a[0] : a;
  if (!o || typeof o !== "object") return null;
  const st = o.State || {};
  const health = (st.Health && st.Health.Status) || (st.Healthcheck && st.Healthcheck.Status) || "";
  return {
    exists: true, id: o.Id || null, name: String(o.Name || "").replace(/^\//, ""), state: String(st.Status || "").toLowerCase(),
    health: health === "" ? "" : String(health).toLowerCase(), image: normId(o.Image || null), restarts: Number(o.RestartCount) || 0,
  };
}

// ───────────────────────────── processes and ports ─────────────────────────────

// /proc/<pid>/stat -> the start time in clock ticks since boot (field 22; the name in field 2 may hold spaces and ')')
function procStartTicks(stat) {
  const i = String(stat || "").lastIndexOf(")");
  if (i < 0) return null;
  const f = stat.slice(i + 2).split(" ");
  const v = Number(f[19]); // (field 3 is f[0], so field 22 is f[19])
  return Number.isFinite(v) ? v : null;
}

// /proc/net/tcp or tcp6: the inodes of sockets LISTENing on one of `ports`: [{ port, inode }]
function procListening(text, ports) {
  const out = [];
  for (const line of String(text || "").split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10 || f[3] !== "0A") continue;
    const port = parseInt(f[1].split(":").pop(), 16);
    if (ports.includes(port)) out.push({ port, inode: f[9] });
  }
  return out;
}

// `ps -A -ww -o pid=,etime=,command=` (macOS): [{ pid, upSec, cmd }]
function parseEtime(s) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(s || "").trim());
  if (!m) return null;
  return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3]) * 60) + Number(m[4]);
}
function parsePs(out) {
  const procs = [];
  for (const line of String(out || "").split("\n")) {
    const m = /^\s*(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m) procs.push({ pid: Number(m[1]), upSec: parseEtime(m[2]), cmd: m[3] });
  }
  return procs;
}

// `lsof -nP -iTCP:<port> -sTCP:LISTEN -Fpcn` (macOS): [{ pid, name }]
function parseLsof(out) {
  const res = [];
  let cur = null;
  for (const line of String(out || "").split("\n")) {
    if (line.startsWith("p")) { cur = { pid: Number(line.slice(1)), name: null }; res.push(cur); }
    else if (line.startsWith("c") && cur) cur.name = line.slice(1);
  }
  return res;
}

// a process's short name from its command line: the file name of its program ("node" for .../bin/node bridge.js)
// (a guess when the line is joined by spaces: a folder with a space in it cuts it short)
function procName(cmd) {
  const first = String(cmd || "").trim().split(/\s+/)[0] || "";
  return path.basename(first) || null;
}

// A Linux process from /proc/<pid>/cmdline (NUL-separated, so a folder with spaces stays whole) and /proc/<pid>/comm:
// { name, cmd }. The name is argv[0]'s file name, not comm: Node names its main thread "MainThread", and on Linux that
// renames the process's comm, so a bridge would look like a foreign program holding its own port.
function procFromCmdline(raw, comm) {
  const argv = String(raw || "").replace(/\0+$/, "").split("\0");
  const name = path.basename(argv[0] || "") || String(comm || "").trim() || null;
  return { name, cmd: argv.join(" ") };
}

// Tabletop Simulator itself among the processes (native Linux .x86_64, Proton .exe, or the macOS .app), the youngest
// one (Steam's launcher wrapper names it too, and starts first). null when it doesn't run.
function findTts(procs) {
  const tts = procs.filter((p) => /Tabletop Simulator(\.x86_64|\.exe|\.app\/Contents\/MacOS\/)/i.test(p.cmd || "") && !/companion\.js/.test(p.cmd || ""));
  if (!tts.length) return null;
  return tts.reduce((a, b) => ((b.upSec ?? Infinity) < (a.upSec ?? Infinity) ? b : a));
}

// node processes running this package's bridge.js
// (a command line from /proc has its arguments joined by spaces, and the package's folder may hold spaces too)
const bridgeProcs = (procs, bridgeJs) => procs.filter((p) => (p.name === "node" || /(^|\/)node\s/.test(String(p.cmd || ""))) && String(p.cmd || "").includes(bridgeJs) && /bridge\.js(\s|$)/.test(String(p.cmd || "")));

// ───────────────────────────── launching things ─────────────────────────────

// Steam's URL for TTS through Steam itself (Linux: the steam command; macOS: open)
function ttsLaunch(platform, steamCmd) {
  const url = `steam://rungameid/${TTS_APP_ID}`;
  if (platform === "darwin") return ["open", [url]];
  if (steamCmd) return [steamCmd, [url]];
  return ["xdg-open", [url]];
}
const openCommand = (platform, target) => (platform === "darwin" ? ["open", [target]] : ["xdg-open", [target]]);

module.exports = {
  TTS_APP_ID, savesDirFor, stateDirFor, chooseRuntime, parseInfo, accessDeniedText, noSuchText, containerName, networkName,
  Services, Images, runArgs, engineKey, upPlan, containerFromInspect, procStartTicks, procListening, parseEtime, parsePs,
  parseLsof, procName, procFromCmdline, findTts, bridgeProcs, ttsLaunch, openCommand,
};
