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
  ["platform.js", "Podman keeps the image's health check",
    "if (o.runtime === \"podman\") a.push(\"--no-healthcheck\");", "", "Podman: no health check"],
  ["platform.js", "on a Deck the TTS process found is Steam's launcher wrapper",
    "(b.upSec ?? Infinity) < (a.upSec ?? Infinity) ? b : a", "(b.upSec ?? Infinity) > (a.upSec ?? Infinity) ? b : a", "TTS on a Deck"],
  ["platform.js", "a Linux process is named by its comm (Node's \"MainThread\") instead of its program",
    "const name = path.basename(argv[0] || \"\") || String(comm || \"\").trim() || null;", "const name = String(comm || \"\").trim() || path.basename(argv[0] || \"\") || null;",
    "Node renames its process MainThread"],
  ["platform.js", "Proton's Saves folder is never used",
    "if (exists(path.dirname(proton))) return proton;", "", "TTS only ever run through Proton"],
];

const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const originals = ["logic.js", "platform.js"].map((f) => path.join(here, f));
const before = originals.map(sha);

let missed = 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-breakit-"));
try {
  // the unbroken copies must pass first, or a red check proves nothing
  const runWith = (logic, platform) => spawnSync(process.execPath, [path.join(here, "selftest.js")], { encoding: "utf8", env: { ...process.env, MTG_COMPANION_LOGIC: logic, MTG_COMPANION_PLATFORM: platform } });
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
