// Break-it proofs for the selftest: each case breaks one decision in a COPY of logic.js or platform.js (in a temp
// folder), runs the selftest against the copy (MTG_COMPANION_LOGIC / MTG_COMPANION_PLATFORM, see mods.js) and requires
// the named check to go red. The real files are never edited: their sha256 is taken before and compared after.
//   node companion-node/breakit.js        exit code = cases that didn't go red, plus 100 if an original changed
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const here = __dirname;
const Cases = [
  ["logic.js", "after a stop that turned green, a button skips the next step",
    "stoppedNowGreen ? stoppedAt + 1 : stoppedAt", "stoppedNowGreen ? stoppedAt + 2 : stoppedAt",
    "Start the bridge after the engine stopped it (green now)"],
  ["logic.js", "the table save is updated even after the player saved over it",
    "if (hashOf(st.saveFile) === st.saveHash) return { kind: \"update\"", "if (true) return { kind: \"update\"",
    "ours but the player saved over it"],
  ["logic.js", "a resume file 10 minutes old still locks restarts",
    "resumeAgeSec < 60;", "resumeAgeSec < 6000;", "stale resume file"],
  ["logic.js", "a game being set up doesn't lock restarts",
    "if (seats) return Game.on(", "if (false) return Game.on(", "seated but not started"],
  ["logic.js", "any update manifest signature is accepted",
    "if (crypto.verify(\"sha256\", data, { key, dsaEncoding: \"ieee-p1363\" }, sig)) return true;", "return true;",
    "one byte changed: refused"],
  ["logic.js", "a release a moment older than the package is offered (downgrade)",
    "if (theirs < mine)", "if (theirs < mine - 1)", "a millisecond older is refused"],
  ["logic.js", "an update URL with user info (https://api.github.com@evil) is followed",
    "if (u.username || u.password) return { ok: false, api: false };", "", "user info refused"],
  ["logic.js", "the GitHub token is sent to a test server",
    "(api && !testBase ? token || null : null)", "(api ? token || null : null)", "token: only to the API"],
  ["logic.js", "short image ids match by prefix",
    "if (a.length < 12 || b.length < 12) return a === b;", "", "under 12 hex must be equal"],
  ["logic.js", "another copy's bridge on the ports counts as ours",
    "if (!ourBridgeJs || norm(l.commandLine).includes(norm(ourBridgeJs))) continue;", "continue;",
    "friend mode, held by the repo's bridge"],
  ["logic.js", "Restart relay and room is allowed during a game",
    "fix === Fixes.ImagesLoad || fix === Fixes.StackRestart || fix === Fixes.BridgeRestart", "fix === Fixes.ImagesLoad || fix === Fixes.BridgeRestart",
    "locked fixes: restart relay/room"],
  ["platform.js", "the relay's port is published on every network interface",
    "a.push(\"-p\", \"127.0.0.1:9443:9443\")", "a.push(\"-p\", \"9443:9443\")", "relay: port on 127.0.0.1 only"],
  ["platform.js", "a room joined to an old relay's network is kept after the relay is created again",
    "return relayPlan !== \"keep\" && own !== \"run\" ? \"replace\" : own;", "return own;", "a relay run, started or replaced has a new namespace"],
  ["logic.js", "stop.sh stops the engine during a game without --force",
    "if (force || !locked(g)) return null;", "return null;", "stop.sh during a game: refused"],
  ["logic.js", "the save step goes on (and makes a folder) when TTS has never run here",
    "if (found) return null;", "return null;", "no TTS folder anywhere: amber"],
  ["platform.js", "a Saves folder no TTS made counts as found",
    "return { dir: path.join(hit || native[0], \"Saves\"), found: !!hit, tried };", "return { dir: path.join(hit || native[0], \"Saves\"), found: true, tried };",
    "TTS never started: not found"],
  ["platform.js", "Steam libraries on an SD card are never looked in",
    "libs.push(r, ...steamLibraries(readText(path.join(r, \"steamapps\", \"libraryfolders.vdf\"))));", "libs.push(r);", "TTS on the SD card through Proton"],
  ["platform.js", "the engine key is written on the run command line",
    "a.push(\"-e\", Secret.includes(k) ? k : `${k}=${v}`);", "a.push(\"-e\", `${k}=${v}`);", "the key never on the command line"],
  ["platform.js", "replacing the relay removes it before the room that depends on it",
    "[\"rm\", \"-f\", ...(roomExists ? [room] : []), containerName(project, \"relay\")]", "[\"rm\", \"-f\", containerName(project, \"relay\"), ...(roomExists ? [room] : [])]",
    "replacing the relay removes the room first"],
  ["platform.js", "a bridge-loop pid file is trusted without checking it is this package's loop",
    "&& new RegExp(`\\\\s--home ${escRe(home)}(\\\\s--|$)`).test(cmd);", ";", "another package's loop is not ours"],
  ["platform.js", "the instance lock trusts any companion.js process, a bridge loop or --stop too",
    " && !/\\s--(bridge-loop|stop|selftest)(\\s|$)/.test(cmd);", ";", "a bridge loop or a --stop is not a companion"],
  ["platform.js", "Podman keeps the image's health check",
    "if (o.runtime === \"podman\") a.push(\"--no-healthcheck\");", "", "Podman: no health check"],
  ["platform.js", "on a Deck the TTS process found is Steam's launcher wrapper",
    "(b.upSec ?? Infinity) < (a.upSec ?? Infinity) ? b : a", "(b.upSec ?? Infinity) > (a.upSec ?? Infinity) ? b : a", "TTS on a Deck"],
  ["platform.js", "a Linux process is named by its comm (Node's \"MainThread\") instead of its program",
    "const name = path.basename(argv[0] || \"\") || String(comm || \"\").trim() || null;", "const name = String(comm || \"\").trim() || path.basename(argv[0] || \"\") || null;",
    "Node renames its process MainThread"],
  ["platform.js", "Proton's Saves folder is never used",
    "const tried = [...new Set([...native, ...proton])];", "const tried = [...new Set(native)];", "TTS only ever run through Proton"],
  ["logic.js", "before Start engine, Docker Desktop not running is a red light",
    "if (v.action === Actions.StartDesktop) return verdict(Light.Grey,", "if (false) return verdict(Light.Grey,", "before start: Docker not running: grey"],
  ["logic.js", "before Start engine, a red light's own hint is hidden behind press Start engine",
    "if (needsStart) return (list.find((v) => v.hint && v.light === Light.Red) || {}).hint || StartHint;", "if (needsStart) return StartHint;",
    "before start, a red light with a hint comes first"],
  ["logic.js", "--start is ignored (launch only checks even when asked to start)",
    "args.includes(\"--start\") || ", "", "--start: the flags that start at launch"],
  ["logic.js", "the engine counts as up without the bridge",
    " && rows[4] === Light.Green;", ";", "engine up: engine, images, stack and bridge green"],
  ["logic.js", "before Start engine an amber TTS row makes the header amber",
    "if (stoppedOrNotStarted) return all.includes(Light.Red) ? Light.Red : Light.Grey;", "", "header light: before start or after a stop"],
  ["logic.js", "own server: the default port isn't the relay's",
    "let port = DefaultServerPort;", "let port = 443;", "server.json: host only: port 9443"],
  ["logic.js", "own server: a ws:// address in host is taken as a name",
    "if (/^[a-z][a-z0-9+.-]*:\\/\\//i.test(host)) return", "if (false) return", "a ws:// in host is refused"],
  ["logic.js", "own server: a misspelt setting is ignored",
    "if (unknown.length) return { ok: false", "if (false) return { ok: false", "a misspelt setting is refused by name"],
  ["logic.js", "own server: MTG_SERVER_KEY beats the key in server.json",
    "if (!r.server.key && typeof envKey === \"string\"", "if (typeof envKey === \"string\"", "the file's key beats MTG_SERVER_KEY"],
  ["logic.js", "own server: --server's port is dropped",
    "return m[2] !== undefined ? { host: m[1], port: Number(m[2]) } : { host: m[1] };", "return { host: m[1] };", "--server host:port beats the file's host and port"],
  ["logic.js", "own server: secure: true still connects with ws://",
    "`${s.secure ? \"wss\" : \"ws\"}://${s.host}:${s.port}`", "`ws://${s.host}:${s.port}`", "secure: true is wss://"],
  ["logic.js", "own server: a refused connection gets the generic message",
    "    case \"refused\":\n      return verdict(Light.Red, `Your server", "    case \"refused-x\":\n      return verdict(Light.Red, `Your server", "refused: red, says nothing listens on the port"],
  ["logic.js", "own server: a refused key gets the generic message",
    "    case \"authFailed\":\n      return verdict(Light.Red, `Your server", "    case \"authFailed-x\":\n      return verdict(Light.Red, `Your server", "refused key: red, says to put the server's key"],
  ["logic.js", "own server: a busy room on the server counts as ready",
    "      if (locked(game)) return verdict(Light.Green, `Your server (${at}): room", "      if (true) return verdict(Light.Green, `Your server (${at}): room", "a busy room on the server is red"],
  ["logic.js", "own server: steps 1-2 are grey, so the engine never counts as up",
    "const serverNotNeeded = (s) => verdict(Light.Green,", "const serverNotNeeded = (s) => verdict(Light.Grey,", "steps 1-2 green with a server (engine up)"],
  ["logic.js", "own server: a server.json problem doesn't show",
    "if (!setting.ok) return verdict(Light.Red, `Own server: ${setting.problem}`", "if (!setting.ok) return verdict(Light.Green, `Own server: ${setting.problem}`", "a server.json problem is the engine light's red"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const originals = ["logic.js", "platform.js"].map((f) => path.join(here, f));
const before = originals.map(sha);

let missed = 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-breakit-"));
try {
  // the unbroken copies must pass first, or a red check proves nothing
  const runWith = (logic, platform) => spawnSync(process.execPath, [path.join(here, "selftest.js")], { encoding: "utf8", env: { ...process.env, MTG_COMPANION_BREAKIT: "1", MTG_COMPANION_LOGIC: logic, MTG_COMPANION_PLATFORM: platform } });
  const cleanL = path.join(tmp, "logic.js"), cleanP = path.join(tmp, "platform.js");
  fs.copyFileSync(originals[0], cleanL); fs.copyFileSync(originals[1], cleanP);
  const base = runWith(cleanL, cleanP);
  if (base.status !== 0) { console.log(`the selftest fails on the unbroken copies (${base.status}): fix that first`); process.exit(1); }
  console.log(`unbroken copies: ${(base.stdout.trim().split("\n").pop())}`);
  Cases.forEach(([file, what, find, repl, name], i) => {
    const src = fs.readFileSync(path.join(here, file), "utf8");
    const at = src.indexOf(find);
    if (at < 0 || src.indexOf(find, at + 1) >= 0) { missed++; console.log(`NOT APPLIED ${what}: the text to break is ${at < 0 ? "missing" : "there twice"} in ${file}`); return; }
    const broken = path.join(tmp, `case${i}-${file}`);
    fs.writeFileSync(broken, src.slice(0, at) + repl + src.slice(at + find.length));
    const r = file === "logic.js" ? runWith(broken, cleanP) : runWith(cleanL, broken);
    const red = r.stdout.split("\n").filter((l) => l.startsWith("FAIL "));
    const hit = red.some((l) => l.includes(name));
    if (!hit) missed++;
    console.log(`${hit ? "RED" : "MISSED"} ${what}  ->  ${hit ? `FAIL ${name} (${red.length} red)` : `"${name}" stayed green${red.length ? `; red: ${red.map((l) => l.slice(5, 60)).join(" | ")}` : ""}`}`);
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

const after = originals.map(sha);
const changed = originals.filter((f, i) => before[i] !== after[i]);
console.log(changed.length ? `ORIGINAL CHANGED: ${changed.join(", ")}` : `originals untouched (sha256 ${before.map((h) => h.slice(0, 12)).join(", ")})`);
console.log(`${Cases.length - missed} of ${Cases.length} breaks turned their check red`);
process.exit(missed + (changed.length ? 100 : 0));
