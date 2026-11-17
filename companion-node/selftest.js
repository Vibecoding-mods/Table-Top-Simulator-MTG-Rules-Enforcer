// --selftest: the decision logic against canned inputs, as the Windows app's companion/src/SelfTest.cs (the same
// check names where the rule is the same). One line per check; the exit code is the failure count. Runs on any OS:
// nothing here needs Linux, macOS, Docker or Podman (the server checks use a port on 127.0.0.1; the shim check needs
// sh and is skipped without it).
//   node companion-node/companion.js --selftest [--out FILE]
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const L = require("./mods").logic();
const P = require("./mods").platform();
const { Light, Fixes, Actions, verdict } = L;

let out = [], fails = 0, passes = 0;
const check = (name, ok, got) => { if (ok) passes++; else fails++; out.push(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `   got: ${typeof got === "string" ? got : JSON.stringify(got)}`}`); };
const section = (s) => out.push(`-- ${s}`);
const files = (...present) => { const s = new Set(present); return (p) => s.has(p); };

function modes() {
  section("home vs friend mode");
  let l = L.detectLayout("/home/deck/MTG-Table", files("/home/deck/MTG-Table/version.json", "/home/deck/MTG-Table/bridge/bridge.js"), null);
  check("friend: version.json beside the companion", l && l.mode === "friend" && l.home === "/home/deck/MTG-Table", l && l.mode);
  check("friend: bundled node, project mtg-table, logs/", l && l.nodeExe === "/home/deck/MTG-Table/runtime/node/bin/node" && l.project === "mtg-table" && l.companionLog === "/home/deck/MTG-Table/logs/companion.log" && l.bridgeLog === "/home/deck/MTG-Table/logs/bridge.log");
  check("friend: compose and table paths", l && l.composeFile === "/home/deck/MTG-Table/stack/compose.yml" && l.tableJson === "/home/deck/MTG-Table/table/MTG Table.json");
  l = L.detectLayout("/r", files("/r/bridge/bridge.js", "/r/Start MTG.bat"), null);
  check("home: the companion in companion-node/ finds the repo above it", l && l.mode === "home" && l.home === "/r", l && l.home);
  check("home: node of this run, project stack, tmp/ logs", l && l.nodeExe === "node" && l.project === "stack" && l.bridgeLog === "/r/tmp/bridge-live.log");
  l = L.detectLayout("/r/dist/MTG-Table", files("/r/dist/MTG-Table/version.json", "/r/bridge/bridge.js", "/r/Start MTG.bat"), null);
  check("a package inside a repo is friend mode", l && l.mode === "friend" && l.home === "/r/dist/MTG-Table");
  check("bridge.js without Start MTG.bat or version.json: no layout", L.detectLayout("/Downloads", files("/Downloads/bridge/bridge.js"), null) === null);
  l = L.detectLayout("/x", files("/r/bridge/bridge.js", "/r/Start MTG.bat"), "/r");
  check("--home points at the repo", l && l.mode === "home" && l.home === "/r");
  check("images: .tar.gz accepted", L.findImagesTar("/P", files("/P/images/mtg-images.tar.gz"), () => []) === "/P/images/mtg-images.tar.gz");
  check("images: any .tar in images/", L.findImagesTar("/P", files(), () => ["/P/images/engine-2026.tar"]) === "/P/images/engine-2026.tar");
}

function sequence() {
  section("the start sequence after a stop");
  check("no stop: a button starts where it asks", L.startFrom(5, 0, false) === 5 && L.startFrom(1, 0, false) === 1);
  check("Start the bridge after the engine stopped it (still red): the engine step again, not step 5", L.startFrom(5, 3, false) === 3, L.startFrom(5, 3, false));
  check("Start the bridge after the engine stopped it (green now): the save step, never skipped", L.startFrom(5, 3, true) === 4, L.startFrom(5, 3, true));
  check("a button at or before the stopped step: unchanged", L.startFrom(3, 3, true) === 3 && L.startFrom(2, 3, false) === 2 && L.startFrom(4, 4, false) === 4);
  check("a button one past the stopped step that is still red: the stopped step", L.startFrom(4, 3, false) === 3);
  let broke = null;
  for (let req = 1; req <= 7 && !broke; req++) for (let at = 0; at <= 6 && !broke; at++) for (const green of [false, true]) {
    const got = L.startFrom(req, at, green), first = at === 0 ? Infinity : green ? at + 1 : at;
    if (got > req || got > first || (got !== req && got !== first)) { broke = `startFrom(${req}, ${at}, ${green}) = ${got}`; break; }
  }
  check("every button, every stop: the requested step or the first step not done, whichever is earlier", !broke, broke);
  check("resume: the stopped step turned green, carry on from the next", L.resumeAfterStop(3, true, false) === 4);
  check("resume: still red, or no stop, or observe mode: nothing", L.resumeAfterStop(3, false, false) === 0 && L.resumeAfterStop(0, true, false) === 0 && L.resumeAfterStop(3, true, true) === 0);
  check("engine wait: at least twice the 2 min 15 s cold start of 2026-11-10", L.StackWaitSeconds >= 270, L.StackWaitSeconds);
  check("engine wait: the red text names the wait in minutes", L.stackTimedOut("room busy").includes(`within ${L.StackWaitSeconds / 60} minutes: room busy`));
}

function docker() {
  section("container engine");
  let v = L.decideDocker({ platform: "linux" });
  check("missing (Linux): red, names Podman and SteamOS 3.5, Try again, no action", v.light === Light.Red && v.text.includes("Podman") && v.text.includes("SteamOS 3.5") && v.fix === Fixes.Retry && !v.action, v);
  v = L.decideDocker({ platform: "darwin" });
  check("missing (Mac): red, says Install Docker Desktop with the address", v.light === Light.Red && v.text.includes("Install Docker Desktop") && v.text.includes("docker.com") && !v.action, v);
  v = L.decideDocker({ platform: "darwin", runtime: "docker", cliFound: true, desktopFound: true });
  check("installed, not running: start Docker Desktop", v.action === Actions.StartDesktop && v.light === Light.Busy, v);
  v = L.decideDocker({ platform: "darwin", runtime: "docker", cliFound: true, desktopFound: true, waiting: true, waitedSec: 40 });
  check("starting (40 s): keep waiting", v.light === Light.Busy && v.action === Actions.Wait, v);
  v = L.decideDocker({ platform: "darwin", runtime: "docker", cliFound: true, desktopFound: true, desktopRunning: true });
  check("Docker Desktop process up, engine not yet: wait, don't start a second one", v.action === Actions.Wait, v);
  v = L.decideDocker({ platform: "darwin", runtime: "docker", cliFound: true, desktopFound: true, waiting: true, waitedSec: 181 });
  check("not answering after 3 minutes: red, Start Docker Desktop", v.light === Light.Red && v.fix === Fixes.DockerStart, v);
  v = L.decideDocker({ platform: "linux", runtime: "podman", cliFound: true, answers: true, version: "4.9.3", cpus: 8 });
  check("running: green with version and CPUs", v.light === Light.Green && v.text.includes("Podman 4.9.3") && v.text.includes("8 CPUs"), v);
  v = L.decideDocker({ platform: "linux", runtime: "podman", cliFound: true, detail: "cannot set up namespace" });
  check("Podman installed but silent: red, podman info, the reason, no start", v.light === Light.Red && v.text.includes("podman info") && v.text.includes("namespace") && !v.action, v);
  v = L.decideDocker({ platform: "linux", runtime: "docker", cliFound: true, accessDenied: true });
  check("socket refuses this account: red, docker group, not 'starting'", v.light === Light.Red && v.text.includes("docker group") && v.fix === Fixes.Retry && !v.action, v);
  v = L.decideDocker({ platform: "linux", runtime: "docker", cliFound: true, answers: true, osType: "linux", accessDenied: true });
  check("answers: green even if an earlier probe was refused", v.light === Light.Green, v);
  section("which engine");
  check("Docker answering wins", P.chooseRuntime({ dockerFound: true, dockerAnswers: true, podmanFound: true }) === "docker");
  check("Steam Deck: no Docker, Podman: podman", P.chooseRuntime({ podmanFound: true }) === "podman");
  check("Linux: Docker installed but down, Podman there: podman", P.chooseRuntime({ dockerFound: true, dockerAnswers: false, podmanFound: true }) === "podman");
  check("Mac: Docker Desktop not started yet, Podman there too: docker (the app starts it)", P.chooseRuntime({ dockerFound: true, desktopFound: true, podmanFound: true }) === "docker");
  check("an engine chosen this run is kept while it is installed", P.chooseRuntime({ sticky: "podman", dockerFound: true, dockerAnswers: true, podmanFound: true }) === "podman");
  check("--runtime overrides", P.chooseRuntime({ override: "podman", dockerFound: true, dockerAnswers: true }) === "podman");
  check("nothing installed: none", P.chooseRuntime({}) === null);
  const pi = P.parseInfo("podman", '{"host":{"os":"linux","cpus":8,"security":{"rootless":true}},"version":{"Version":"4.9.3"}}');
  check("podman info: version, CPUs, rootless", pi && pi.version === "4.9.3" && pi.cpus === 8 && pi.rootless, pi);
  const di = P.parseInfo("docker", '{"ServerVersion":"27.3.1","OSType":"linux","NCPU":10}');
  check("docker info: version, OS, CPUs", di && di.version === "27.3.1" && di.osType === "linux" && di.cpus === 10, di);
  check("docker info, daemon down: no version", !(P.parseInfo("docker", '{"ServerErrors":["Cannot connect"]}') || {}).version);
  check("permission denied on the socket is access denied", P.accessDeniedText("permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock"));
}

const R = "sha256:dbfe69213fff7e3eccb6db806e09afbec608e7c56105020d70e3b8ac631e74b3";
const N = "sha256:ef61822078a04ba83bd1086449a2a92b3860ac3d377444a2da658e1ee781c0f6";

function images() {
  section("engine images");
  let v = L.decideImages({ friend: true, tarPath: "x.tar", wantRelay: R, wantNode: N });
  check("missing: load from the tar", v.action === Actions.Load && v.text.startsWith("Loading"), v);
  v = L.decideImages({ friend: true, tarPath: "x.tar", relayId: R, nodeId: "sha256:0000000000000000000000000000", wantRelay: R, wantNode: N });
  check("engine id differs from version.json: load (update)", v.action === Actions.Load && v.text.startsWith("Updating"), v);
  v = L.decideImages({ friend: true, tarPath: "x.tar", relayId: R, nodeId: N, wantRelay: R.slice(7), wantNode: N.slice(7, 19) });
  check("ok: same ids (with or without sha256:, short or long)", v.light === Light.Green && !v.action, v);
  v = L.decideImages({ friend: true, tarPath: null, wantRelay: R, wantNode: N });
  check("missing and no tar: red, unpack again", v.light === Light.Red && v.text.includes("missing from the package") && !v.action, v);
  v = L.decideImages({ friend: true, tarPath: "x.tar", relayId: R, nodeId: "sha256:1111111111111111", wantRelay: R, wantNode: N, loadedAlready: true });
  check("loaded but still different: amber, no second load", v.light === Light.Amber && !v.action, v);
  v = L.decideImages({ friend: true, tarPath: "x.tar", wantRelay: R, wantNode: N, loadedAlready: true });
  check("loaded and still missing: red with a load button", v.light === Light.Red && v.fix === Fixes.ImagesLoad, v);
  v = L.decideImages({ friend: true, tarPath: "x.tar", relayId: R, nodeId: "sha256:1111111111111111", wantRelay: R, wantNode: N, locked: true });
  check("different during a game: amber, loads after the game", v.light === Light.Amber && !v.action, v);
  check("no ids in version.json: present is enough", L.decideImages({ friend: true, tarPath: "x.tar", relayId: R, nodeId: N }).light === Light.Green);
  v = L.decideImages({ friend: false, relayId: R });
  check("home, missing: red, build-images.sh, never loads", v.light === Light.Red && v.text.includes("build-images.sh") && !v.action, v);
  check("SameId: short prefix of 12+", L.sameId("ef61822078a0", N));
  check("SameId: under 12 hex must be equal", !L.sameId("ef6182", N));
  check("SameId: different", !L.sameId(R, N));
  check("Podman's bare ids are written as Docker's (sha256:)", L.normId(R.slice(7)) === R && L.normId(R) === R && L.normId(null) === null && L.normId("mtg-relay:exile") === "mtg-relay:exile");
  const RC = "sha256:aaaa69213fff7e3eccb6db806e09afbec608e7c56105020d70e3b8ac631e74b3", NC = "sha256:bbbb822078a04ba83bd1086449a2a92b3860ac3d377444a2da658e1ee781c0f6", NX = "sha256:cccc822078a04ba83bd1086449a2a92b3860ac3d377444a2da658e1ee781c0f6";
  const dep = { bridge: "5079109f", relay: R, node: N, relayConfig: RC, nodeConfig: NC };
  check("deployed: same ids (containerd store): unchanged", L.deployedAfterLoad(dep, R, N) === null);
  check("deployed: the config ids (classic store, Podman): unchanged", L.deployedAfterLoad(dep, RC, NC) === null);
  const nd = L.deployedAfterLoad(dep, R, NX);
  check("deployed: another engine id: recorded as node, the package's kept", nd && nd.node === NX && nd.nodePackage === N && nd.relay === R && !("relayPackage" in nd) && nd.bridge === "5079109f", nd);
  check("deployed: the input isn't changed", dep.node === N);
  const nd2 = L.deployedAfterLoad(nd, R, R);
  check("deployed: a second change keeps the first package id", nd2 && nd2.nodePackage === N && nd2.node === R);
  check("deployed: a short id isn't exact: rewritten", L.deployedAfterLoad(dep, R, N.slice(7)) !== null);
  check("deployed: no record or no ids: nothing", L.deployedAfterLoad(null, R, N) === null && L.deployedAfterLoad(dep, null, N) === null && L.deployedAfterLoad(dep, R, "") === null);
}

const up = (health) => ({ exists: true, state: "running", health });

function stack() {
  section("engine stack");
  const none = L.Game.none("No game."), on = L.Game.on("Game on", 6);
  let v = L.decideStack({ exists: false }, up(""), null, none);
  check("relay missing: red, Start the engine", v.light === Light.Red && v.fix === Fixes.StackRestart, v);
  v = L.decideStack(up("starting"), up(""), { kind: "skipped" }, none);
  check("relay starting: busy", v.light === Light.Busy, v);
  v = L.decideStack(up("healthy"), up(""), { kind: "closed" }, none);
  check("healthy but the login drops (stale 9443 forward): red, restart relay and room", v.light === Light.Red && v.fix === Fixes.StackRestart && v.text.includes("fail at setup"), v);
  v = L.decideStack(up("healthy"), up(""), { kind: "ok", roomFound: true, roomStatus: "Lobby", ms: 40 }, none);
  check("login ok, room in Lobby: green", v.light === Light.Green, v);
  v = L.decideStack(up(""), up(""), { kind: "ok", roomFound: true, roomStatus: "Lobby", ms: 40 }, none);
  check("Podman (no health check), login ok: green", v.light === Light.Green, v);
  v = L.decideStack(up("healthy"), up(""), { kind: "ok", roomFound: true, roomStatus: "InGame" }, none);
  check("room InGame with no game: red (leftover room)", v.light === Light.Red && v.fix === Fixes.StackRestart, v);
  v = L.decideStack(up("healthy"), up(""), { kind: "ok", roomFound: true, roomStatus: "InGame" }, on);
  check("room InGame during our game: green", v.light === Light.Green, v);
  v = L.decideStack(up("healthy"), up(""), { kind: "authFailed", detail: "bad key" }, none);
  check("key refused: red, no restart button", v.light === Light.Red && v.fix === Fixes.Retry, v);
  check("room not listed yet: busy", L.decideStack(up("healthy"), up(""), { kind: "ok", roomFound: false }, none).light === Light.Busy);
  check("room container stopped: red", L.decideStack(up("healthy"), { exists: true, state: "exited" }, null, none).light === Light.Red);
  v = L.decideStack(up("healthy"), up(""), { kind: "authFailed", detail: "bad key" }, none, true);
  check("friend, key refused: Stop everything, no repo stack/.env advice", v.text.includes("Stop everything") && !v.text.includes("Check MANABREW_SERVER_KEY in stack"), v);
  const taken = "Error: rootlessport listen tcp 127.0.0.1:9443: bind: address already in use";
  check("friend start: port taken says Stop everything (Podman's words too)", L.composeFailure(taken, true).includes("Stop everything") && L.composeFailure("Bind for 127.0.0.1:9443 failed: port is already allocated", true).includes("another copy of the MTG engine"));
  check("images missing in Podman's words: Try again on Engine images", L.composeFailure("Error: mtg-relay:exile: image not known", true).includes("Engine images"));
  section("the containers without compose");
  const ra = P.runArgs("relay", { project: "mtg-table", runtime: "podman", key: "k1", platform: "linux", arch: "x64" });
  const s = ra.join(" ");
  check("relay: compose's container name, its own network namespace (no network flag)", s.includes("--name mtg-table-relay-1") && !s.includes("--network"), s);
  check("relay: port on 127.0.0.1 only", s.includes("-p 127.0.0.1:9443:9443") && !/-p 9443/.test(s), s);
  check("relay: the key by name, never pulled, restarts unless stopped", ra.includes("MANABREW_SERVER_KEY") && s.includes("--pull never") && s.includes("--restart unless-stopped") && ra[ra.length - 1] === "mtg-relay:exile", s);
  check("Podman: no health check (the login decides)", s.includes("--no-healthcheck"));
  const rr = P.runArgs("forge-room", { project: "mtg-table", runtime: "docker", key: "k1", platform: "darwin", arch: "arm64" }).join(" ");
  check("room: in the relay's network namespace, reaching it as ws://127.0.0.1:9443 (no DNS needed)", rr.includes("--network container:mtg-table-relay-1") && rr.includes("SELF_HOSTED_NODE_RELAY_URL=ws://127.0.0.1:9443"), rr);
  check("room: the same key, room tts-commander, 4 seats, no port of its own", rr.split(" ").includes("SELF_HOSTED_NODE_SERVER_KEY") && rr.includes("SELF_HOSTED_NODE_ROOM_NAME=tts-commander") && rr.includes("SELF_HOSTED_NODE_MAX_PLAYERS=4") && !rr.includes(" -p "), rr);
  check("Docker: keeps the image's health check", !rr.includes("--no-healthcheck"));
  check("Apple Silicon: the amd64 images under emulation", rr.includes("--platform linux/amd64") && !s.includes("--platform"));
  check("the same container names the bridge reads (versions.js: <project>-forge-room-1)", P.containerName("mtg-table", "forge-room") === "mtg-table-forge-room-1");
  check("up: no container: run; stopped: start; running: keep; new image: replace", P.upPlan({ exists: false }, R, L.sameId) === "run" && P.upPlan({ exists: true, state: "exited", image: R }, R, L.sameId) === "start"
    && P.upPlan({ exists: true, state: "running", image: R }, R, L.sameId) === "keep" && P.upPlan({ exists: true, state: "running", image: N }, R, L.sameId) === "replace");
  check("the key never on the command line (ps shows it): passed by name, its value in the command's environment", !s.includes("k1") && !rr.includes("k1") && P.secretEnv("relay", "k1").MANABREW_SERVER_KEY === "k1" && P.secretEnv("forge-room", "k1").SELF_HOSTED_NODE_SERVER_KEY === "k1", s);
  check("replacing the relay removes the room first (Podman refuses to remove a container others depend on)", JSON.stringify(P.removeArgs("mtg-table", "relay", true)) === JSON.stringify(["rm", "-f", "mtg-table-forge-room-1", "mtg-table-relay-1"]));
  check("replacing the relay with no room: only the relay (rm -f of a missing container fails on Podman)", JSON.stringify(P.removeArgs("mtg-table", "relay", false)) === JSON.stringify(["rm", "-f", "mtg-table-relay-1"]) && JSON.stringify(P.removeArgs("mtg-table", "forge-room", true)) === JSON.stringify(["rm", "-f", "mtg-table-forge-room-1"]));
  section("pids from files (reused after a reboot)");
  const loopCmd = "/home/deck/MTG Table/runtime/node/bin/node /home/deck/MTG Table/companion/companion.js --bridge-loop --home /home/deck/MTG Table";
  check("the bridge loop's pid: still ours when it is companion.js --bridge-loop --home <this package>", P.isLoopCmd(loopCmd, "/home/deck/MTG Table") && P.isLoopCmd(`${loopCmd} --runtime podman`, "/home/deck/MTG Table"));
  check("another package's loop is not ours (even a folder whose name starts the same)", !P.isLoopCmd(loopCmd.replace(/MTG Table$/, "MTG Table2"), "/home/deck/MTG Table") && !P.isLoopCmd(loopCmd, "/home/deck/MTG"));
  check("a reused pid (another program, the companion itself, gone) is not the loop", !P.isLoopCmd("/usr/lib/firefox/firefox", "/home/deck/MTG Table") && !P.isLoopCmd("./runtime/node/bin/node companion/companion.js", "/home/deck/MTG Table") && !P.isLoopCmd(null, "/x"));
  check("the instance lock's pid: a companion (started by start.sh, or by hand)", P.isCompanionCmd("./runtime/node/bin/node companion/companion.js") && P.isCompanionCmd("node /r/companion-node/companion.js --observe"));
  check("a bridge loop or a --stop is not a companion; nor is any other program", !P.isCompanionCmd(loopCmd) && !P.isCompanionCmd("node companion/companion.js --stop") && !P.isCompanionCmd("/usr/bin/kwin_wayland") && !P.isCompanionCmd("node mycompanion.js") && !P.isCompanionCmd(null));
  const running = { exists: true, state: "running", image: N };
  check("room: relay kept: the room's own plan (keep, start, run, replace)", P.roomPlan(running, N, "keep", L.sameId) === "keep" && P.roomPlan({ ...running, state: "exited" }, N, "keep", L.sameId) === "start" && P.roomPlan({ exists: false }, N, "keep", L.sameId) === "run" && P.roomPlan(running, R, "keep", L.sameId) === "replace");
  check("room: a relay run, started or replaced has a new namespace: a running room is created again", ["run", "start", "replace"].every((rp) => P.roomPlan(running, N, rp, L.sameId) === "replace" && P.roomPlan({ ...running, state: "exited" }, N, rp, L.sameId) === "replace"));
  check("room: no room yet: run, whatever the relay did", ["keep", "run", "start", "replace"].every((rp) => P.roomPlan({ exists: false }, N, rp, L.sameId) === "run"));
  check("the key: the environment's, else stack/.env's", P.engineKey(" s1 ", "f") === "s1" && P.engineKey("", "f") === "f" && P.engineKey(undefined, "f") === "f");
  const ci = P.containerFromInspect('[{"Id":"abc","Name":"/mtg-table-relay-1","Image":"' + R.slice(7) + '","State":{"Status":"running","Health":{"Status":"healthy"}}}]', L.normId);
  check("container inspect: state, health, the image id as Docker writes it", ci && ci.state === "running" && ci.health === "healthy" && ci.image === R && ci.name === "mtg-table-relay-1", ci);
  const cp = P.containerFromInspect('[{"Id":"abc","Name":"mtg-table-relay-1","Image":"x","State":{"Status":"running"}}]', L.normId);
  check("container inspect without a health check: health empty", cp && cp.health === "", cp);
}

function ports() {
  section("ports");
  const ours = "/home/deck/MTG-Table/bridge/bridge.js";
  let v = L.decidePorts([{ port: 39998, pid: 4242, name: "code", commandLine: "/usr/share/code/code --type=utility" }], ours);
  check("port held by VS Code: red, names it and the port", v && v.light === Light.Red && v.text.includes("code") && v.text.includes("39998") && v.text.includes("4242") && v.fix === Fixes.ShowProgram, v);
  v = L.decidePorts([{ port: 39998, pid: 7, name: "node", commandLine: "/home/deck/MTG-Table/runtime/node/bin/node --report-on-fatalerror /home/deck/MTG-Table/bridge/bridge.js" }], ours);
  check("held by our own bridge: fine", v === null, v);
  v = L.decidePorts([{ port: 48787, pid: 8, name: "node", commandLine: "node --report-on-fatalerror bridge.js" }], ours, true);
  check("friend mode, held by the repo's bridge: red, another bridge, stop it in that companion", v && v.text.includes("Another MTG bridge") && v.text.includes("Stop everything"), v);
  check("home mode, any bridge.js is ours", L.decidePorts([{ port: 48787, pid: 8, name: "node", commandLine: "node bridge.js" }], null) === null);
  check("echo-bridge.js is not the bridge", (L.decidePorts([{ port: 39998, pid: 9, name: "node", commandLine: "node /x/echo-bridge.js" }], null) || {}).light === Light.Red);
  check("other ports are ignored", L.decidePorts([{ port: 9443, pid: 9, name: "rootlessport" }], ours) === null);
  check("an owner that can't be read: can't tell, left to /versions", L.decidePorts([{ port: 39998, pid: null, name: null, commandLine: null }], ours) === null);
  check("write problem: none when all writable", L.writeProblem(["/P/logs", "/P/bridge"], () => null) === null);
  const wp = L.writeProblem(["/P/logs", "/P/bridge"], (d) => (d.endsWith("bridge") ? "EACCES: permission denied" : null));
  check("write problem: names the folder and the error, suggests ~/Games/MTG-Table", wp && wp.includes("/P/bridge") && wp.includes("EACCES") && wp.includes("~/Games/MTG-Table") && !wp.includes("/P/logs"), wp);
  check("bridge.js as a whole file name", L.isBridgeCommandLine("node bridge.js") && L.isBridgeCommandLine("/a b/node /a b/bridge/bridge.js") && L.isBridgeCommandLine("node ./bridge/bridge.js --relay x"));
  check("not a bridge: echo-bridge.js, bridge.json", !L.isBridgeCommandLine("node echo-bridge.js") && !L.isBridgeCommandLine("node bridge.json") && !L.isBridgeCommandLine(null));
  section("processes");
  const tcp = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 0100007F:9C3E 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 55501 1 0\n   1: 0100007F:BE93 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 55502 1 0\n   2: 0100007F:BE93 0100007F:D431 01 00000000:00000000 00:00000000 00000000  1000        0 55503 1 0\n";
  const lis = P.procListening(tcp, [39998, 48787]);
  check("/proc/net/tcp: the LISTEN sockets on 39998 and 48787, not the connections", lis.length === 2 && lis[0].port === 39998 && lis[0].inode === "55501" && lis[1].port === 48787, lis);
  check("/proc/<pid>/stat: start time past a name with spaces and ')'", P.procStartTicks("1234 (Tabletop Simula) x) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654 20") === 987654);
  check("ps etime: mm:ss, hh:mm:ss, dd-hh:mm:ss", P.parseEtime("05:07") === 307 && P.parseEtime("01:00:00") === 3600 && P.parseEtime("2-00:00:01") === 172801 && P.parseEtime("x") === null);
  const ps = P.parsePs("  501   10:00 /Applications/Steam.app/Contents/MacOS/steam_osx\n  777   00:30 /Users/a/Library/Application Support/Steam/steamapps/common/Tabletop Simulator/Tabletop Simulator.app/Contents/MacOS/Tabletop Simulator\n");
  check("ps: pid, age and the whole command line", ps.length === 2 && ps[1].pid === 777 && ps[1].upSec === 30 && ps[1].cmd.endsWith("MacOS/Tabletop Simulator"), ps);
  check("TTS on a Mac is found", P.findTts(ps) && P.findTts(ps).pid === 777);
  const deck = [{ pid: 1, upSec: 300, cmd: "/home/deck/.local/share/Steam/ubuntu12_32/reaper SteamLaunch AppId=286160 -- /home/deck/.local/share/Steam/steamapps/common/Tabletop Simulator/Tabletop Simulator.x86_64" },
    { pid: 2, upSec: 290, cmd: "/home/deck/.local/share/Steam/steamapps/common/Tabletop Simulator/Tabletop Simulator.x86_64" }, { pid: 3, upSec: 10, cmd: "node companion.js" }];
  check("TTS on a Deck: the game itself, not Steam's launcher wrapper", P.findTts(deck) && P.findTts(deck).pid === 2, P.findTts(deck));
  check("TTS not running: none", P.findTts([{ pid: 3, cmd: "steam steam://rungameid/286160" }]) === null);
  // (seen on Linux 2026-11-12: the package's own bridge on 48787 was "MainThread (process 27)", a red light)
  const raw = "/home/deck/MTG Table/runtime/node/bin/node\0--report-on-fatalerror\0/home/deck/MTG Table/bridge/bridge.js\0";
  const pc = P.procFromCmdline(raw, "MainThread\n");
  check("Linux: Node renames its process MainThread; the name is still node, from argv[0]", pc.name === "node" && pc.cmd === "/home/deck/MTG Table/runtime/node/bin/node --report-on-fatalerror /home/deck/MTG Table/bridge/bridge.js", pc);
  check("Linux: so the package's own bridge on its port is fine", L.decidePorts([{ port: 48787, pid: 27, name: pc.name, commandLine: pc.cmd }], "/home/deck/MTG Table/bridge/bridge.js", true) === null);
  check("Linux: no command line (a kernel thread): comm", P.procFromCmdline("", "kworker/0:1\n").name === "kworker/0:1" && P.procFromCmdline(null, null).name === null);
  section("the test hook (mods.js)");
  const { overrideAllowed } = require("./mods");
  const tdir = path.join(os.tmpdir(), "mtg-breakit-abc"), copy = path.join(tdir, "case1-logic.js");
  check("a broken copy loads only for breakit: its marker, a temp mtg-breakit-* folder, selftest.js running", overrideAllowed({ MTG_COMPANION_BREAKIT: "1" }, copy, os.tmpdir(), "/x/selftest.js"));
  check("the companion itself never loads another file (no marker, another folder, or companion.js running)", !overrideAllowed({}, copy, os.tmpdir(), "/x/selftest.js") && !overrideAllowed({ MTG_COMPANION_BREAKIT: "1" }, path.join(os.tmpdir(), "evil", "logic.js"), os.tmpdir(), "/x/selftest.js")
    && !overrideAllowed({ MTG_COMPANION_BREAKIT: "1" }, copy, os.tmpdir(), "/x/companion.js") && !overrideAllowed({ MTG_COMPANION_BREAKIT: "1" }, path.join(tdir, "x.json"), os.tmpdir(), "/x/selftest.js") && !overrideAllowed({ MTG_COMPANION_BREAKIT: "1" }, null, os.tmpdir(), "/x/selftest.js"));
  check("lsof -F: pid and command", JSON.stringify(P.parseLsof("p4242\ncnode\nf12\np9\ncCode Helper\n")) === JSON.stringify([{ pid: 4242, name: "node" }, { pid: 9, name: "Code Helper" }]));
  const bp = P.bridgeProcs([{ pid: 5, name: "node", cmd: "/home/deck/MTG Table/runtime/node/bin/node --report-on-fatalerror /home/deck/MTG Table/bridge/bridge.js" }, { pid: 6, name: "node", cmd: "node /home/deck/MTG Table/companion/companion.js --bridge-loop --home /home/deck/MTG Table" }], "/home/deck/MTG Table/bridge/bridge.js");
  check("the package's bridge among the processes (a folder with a space), not the loop", bp.length === 1 && bp[0].pid === 5, bp);
}

function bridge() {
  section("bridge");
  const portV = verdict(Light.Red, "code holds 39998", { fix: Fixes.ShowProgram, label: "x" });
  check("a held port wins over everything", L.decideBridge(L.httpOf("refused"), portV, false, "e517dd99", true) === portV);
  check("nothing answers, no process: start it", L.decideBridge(L.httpOf("refused"), null, false, "e517dd99", true).action === Actions.StartBridge);
  check("process but refused: starting, wait", L.decideBridge(L.httpOf("refused"), null, true, "e517dd99", true).action === Actions.Wait);
  let v = L.decideBridge(L.httpOk('{"now":{"bridge":"e517dd99"}}'), null, true, "e517dd99", true);
  check("/versions answers with the package's bridge: green", v.light === Light.Green && v.text.includes("e517dd99"), v);
  v = L.decideBridge(L.httpOk('{"now":{"bridge":"aaaaaaaa"}}'), null, true, "e517dd99", true);
  check("another bridge version: amber with a restart button", v.light === Light.Amber && v.fix === Fixes.BridgeRestart, v);
  v = L.decideBridge(L.httpOf("timeout"), null, true, null, true);
  check("slow is not down: a timeout is amber, never a start", v.light === Light.Amber && !v.action, v);
  check("exit lines counted", L.countExits("x\n[bridge exited with code 1 at 1; restarting in 3 s]\n[bridge exited with code 1 at 2; restarting in 3 s]\n") === 2);
}

function gameLock() {
  section("game lock");
  const st = (b) => L.httpOk(b);
  let g = L.decideGame(st('{"started":true,"seats":[{"turn":6},{"turn":6}]}'), null);
  check("/state started:true: game on, turn 6", g.kind === "on" && g.turn === 6 && L.locked(g), g.text);
  g = L.decideGame(st('{"started":true,"seats":[{"turn":6}],"players":3,"ai":2}'), null);
  check("banner: one person and two AI: 3 players (2 AI)", g.text === "Game on: turn 6, 3 players (2 AI).", g.text);
  check("banner: two people, no AI: no AI part", L.decideGame(st('{"started":true,"seats":[{"turn":6},{"turn":6}],"players":2,"ai":0}'), null).text === "Game on: turn 6, 2 players.");
  check("banner: an older bridge without the counts: its seats, singular for one", L.decideGame(st('{"started":true,"seats":[{"turn":4}]}'), null).text === "Game on: turn 4, 1 player.");
  g = L.decideGame(st('{"started":false,"seats":[{"color":"White"}]}'), null);
  check("seated but not started (setup or just over): locked", g.kind === "on" && L.locked(g), g.text);
  g = L.decideGame(st('{"started":false,"seats":null}'), null);
  check("seats null: no game, unlocked", g.kind === "none" && !L.locked(g), g.text);
  check("seats null but a resume file 12 s old: locked (bridge just restarted)", L.locked(L.decideGame(st('{"started":false,"seats":null}'), 12)));
  check("no bridge, no resume file: no game", L.decideGame(L.httpOf("refused"), null).kind === "none");
  check("no bridge, resume file 20 s old (crashed mid-game): game on", L.decideGame(L.httpOf("refused"), 20).kind === "on");
  check("no bridge, stale resume file (10 min): no game", L.decideGame(L.httpOf("refused"), 600).kind === "none");
  g = L.decideGame(L.httpOf("timeout"), null);
  check("bridge times out: can't tell, locked", g.kind === "cantTell" && L.locked(g), g.text);
  check("unreadable answer: can't tell", L.decideGame(st("not json"), null).kind === "cantTell");
  check("HTTP 500: can't tell", L.decideGame({ kind: "ok", status: 500, body: "" }, null).kind === "cantTell");
  check("locked fixes: restart relay/room, bridge, image load", Fixes.locksDuringGame(Fixes.StackRestart) && Fixes.locksDuringGame(Fixes.BridgeRestart) && Fixes.locksDuringGame(Fixes.ImagesLoad));
  section("stop.sh during a game");
  const forceCmd = "./stop.sh --force";
  const sr = L.stopRefusal(L.Game.on("Game on: turn 6, 4 players.", 6), false, forceCmd);
  check("stop.sh during a game: refused, says the game ends and how to force it", !!sr && sr.includes("a game is on") && sr.includes("turn 6") && sr.includes(forceCmd), sr);
  check("stop.sh when it can't tell: refused too", (L.stopRefusal(L.Game.cantTell("bridge slow"), false, forceCmd) || "").includes("can't tell"));
  check("stop.sh --force during a game: goes ahead", L.stopRefusal(L.Game.on("Game on", 6), true, forceCmd) === null);
  check("stop.sh with no game: goes ahead", L.stopRefusal(L.Game.none("No game."), false, forceCmd) === null);
  check("never locked: open TTS, start Docker, start a dead bridge, try again", !Fixes.locksDuringGame(Fixes.TtsOpen) && !Fixes.locksDuringGame(Fixes.DockerStart) && !Fixes.locksDuringGame(Fixes.BridgeStart) && !Fixes.locksDuringGame(Fixes.Retry));
}

const E = (...names) => names.map((n) => ({ name: n, size: n.endsWith(".json") ? 1000 : 50 }));

function saves() {
  section("table save install");
  const noHash = () => "other";
  let p = L.planSave(E("TS_Save_1.json", "TS_Save_1.png", "TS_AutoSave.json", "SaveFileInfos.json"), null, "aaaa1111", "aaaa1111", 2000, noHash);
  check("first run: a new number (TS_Save_2.json)", p.kind === "install" && p.file === "TS_Save_2.json", p);
  p = L.planSave(E("TS_Save_3.png", "TS_Save_1.json"), null, "aaaa1111", "aaaa1111", 2000, noHash);
  check("a number used only by a .png is taken too (TS_Save_4.json)", p.kind === "install" && p.file === "TS_Save_4.json", p);
  check("empty Saves folder: TS_Save_1.json", L.planSave([], null, "a", "a", 2000, noHash).file === "TS_Save_1.json");
  const st = { saveFile: "TS_Save_2.json", saveHash: "aaaa1111" };
  p = L.planSave(E("TS_Save_1.json", "TS_Save_2.json"), st, "aaaa1111", "aaaa1111", 2000, noHash);
  check("ours, same hash: leave it (even if the player saved over it)", p.kind === "skip" && p.file === "TS_Save_2.json", p);
  p = L.planSave(E("TS_Save_1.json", "TS_Save_2.json"), st, "bbbb2222", "bbbb2222", 2000, (n) => (n === "TS_Save_2.json" ? "aaaa1111" : "other"));
  check("ours, untouched, package hash changed: update that same file", p.kind === "update" && p.file === "TS_Save_2.json", p);
  p = L.planSave(E("TS_Save_1.json", "TS_Save_2.json"), st, "bbbb2222", "bbbb2222", 2000, noHash);
  check("ours but the player saved over it, package changed: a new number, never that file", p.kind === "install" && p.file === "TS_Save_3.json", p);
  p = L.planSave(E("TS_Save_1.json"), st, "bbbb2222", "bbbb2222", 2000, noHash);
  check("ours but deleted: install again under the same free name", p.kind === "install" && p.file === "TS_Save_2.json", p);
  const ex = [{ name: "TS_Save_1.json", size: 999 }, { name: "TS_Save_5.json", size: 2000 }];
  p = L.planSave(ex, null, "aaaa1111", "aaaa1111", 2000, (n) => (n === "TS_Save_5.json" ? "aaaa1111" : "zzzz"));
  check("no record, an identical file exists: adopt it, no write", p.kind === "adopt" && p.file === "TS_Save_5.json", p);
  p = L.planSave(ex, null, "aaaa1111", "aaaa1111", 2000, () => "zzzz");
  check("same size, other content: a new number, never that file", p.kind === "install" && p.file === "TS_Save_6.json", p);
  check("a record naming a non-TS_Save file is ignored (never updated)", L.planSave(E("TS_Save_1.json", "Mock.json"), { saveFile: "Mock.json", saveHash: "x" }, "a", "a", 2000, noHash).file === "TS_Save_2.json");
  check("a record with a path in it is ignored", L.planSave(E("TS_Save_1.json"), { saveFile: "../TS_Save_1.json", saveHash: "x" }, "a", "a", 2000, noHash).file === "TS_Save_2.json");
  check("a name in another case is the same file (never two that differ only in case)", L.planSave(E("ts_save_2.json"), null, "a", "a", 2000, noHash).file === "TS_Save_3.json");
  // every install lands on a free name and every update on the recorded file: 500 random folders
  let seed = 7; const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  let bad = null;
  for (let i = 0; i < 500 && !bad; i++) {
    let names = [];
    for (let k = 0, m = rnd(8); k < m; k++) names.push(`TS_Save_${1 + rnd(11)}${rnd(2) ? ".json" : ".png"}`);
    if (rnd(3) === 0) names.push("TS_AutoSave.json");
    names = [...new Set(names)];
    const s = rnd(2) === 0 ? { saveFile: `TS_Save_${1 + rnd(11)}.json`, saveHash: rnd(2) ? "h1" : "h2" } : null;
    const plan = L.planSave(E(...names), s, "h1", "h1", 1000, () => (rnd(4) === 0 ? "h1" : "h0"));
    const there = names.includes(plan.file);
    const ok = plan.kind === "install" ? !there : plan.kind === "update" ? !!s && plan.file === s.saveFile && there : there;
    if (!ok) bad = `${names.join(",")} -> ${plan.kind} ${plan.file}`;
  }
  check("500 random Saves folders: never writes over a file it didn't install", !bad, bad);
  check("SaveName read from the save", L.readSaveName('{\n  "SaveName": "MTG Table (rules engine)",\n  "EpochTime": 1}') === "MTG Table (rules engine)");
  check("SaveName with an escaped quote", L.readSaveName('{"SaveName": "A \\"B\\""}') === 'A "B"');
  check("sha8 like the bridge's", L.sha8(Buffer.from("abc")) === "ba7816bf");
  section("where the saves go");
  const yes = (...dirs) => (d) => dirs.includes(d);
  const sd = (plat, home, ex, env, rt) => P.savesDirFor(plat, home, ex, env, rt);
  let w = sd("darwin", "/Users/a", yes("/Users/a/Library/Tabletop Simulator"));
  check("Mac: ~/Library/Tabletop Simulator/Saves (TTS knowledge base), found", w.dir === "/Users/a/Library/Tabletop Simulator/Saves" && w.found, w);
  check("Mac, TTS never run: not found", sd("darwin", "/Users/a", () => false).found === false);
  w = sd("linux", "/home/deck", yes("/home/deck/.local/share/Tabletop Simulator"));
  check("Linux, native TTS: ~/.local/share/Tabletop Simulator/Saves (TTS knowledge base)", w.dir === "/home/deck/.local/share/Tabletop Simulator/Saves" && w.found, w);
  const proton = "/home/deck/.local/share/Steam/steamapps/compatdata/286160/pfx/drive_c/users/steamuser/Documents/My Games/Tabletop Simulator";
  check("Linux, TTS only ever run through Proton: the Proton prefix's Saves", sd("linux", "/home/deck", yes(proton)).dir === `${proton}/Saves`);
  check("Linux, both: the native one", sd("linux", "/home/deck", yes(proton, "/home/deck/.local/share/Tabletop Simulator")).dir.startsWith("/home/deck/.local/share/Tabletop"));
  w = sd("linux", "/home/deck", () => false);
  check("Linux, TTS never started: not found (the companion waits, makes nothing), dir where native TTS would put it", w.found === false && w.dir === "/home/deck/.local/share/Tabletop Simulator/Saves" && w.tried.length > 5, w);
  const card = "/run/media/mmcblk0p1/steamapps/compatdata/286160/pfx/drive_c/users/steamuser/Documents/My Games/Tabletop Simulator";
  const vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"/home/deck/.local/share/Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"/run/media/mmcblk0p1"\n\t\t"apps"\t{ "286160" "1" }\n\t}\n}\n';
  w = sd("linux", "/home/deck", yes(card), {}, (f) => (f === "/home/deck/.local/share/Steam/steamapps/libraryfolders.vdf" ? vdf : null));
  check("Linux, TTS on the SD card through Proton: its library from libraryfolders.vdf", w.found && w.dir === `${card}/Saves`, w);
  check("libraryfolders.vdf: every library path", JSON.stringify(P.steamLibraries(vdf)) === JSON.stringify(["/home/deck/.local/share/Steam", "/run/media/mmcblk0p1"]) && P.steamLibraries(null).length === 0);
  const flat = "/home/deck/.var/app/com.valvesoftware.Steam/.local/share/Tabletop Simulator";
  check("Linux, Flatpak Steam, native TTS: the Flatpak's folder", sd("linux", "/home/deck", yes(flat)).dir === `${flat}/Saves`);
  check("Linux, Flatpak Steam, TTS through Proton", sd("linux", "/home/deck", yes(`/home/deck/.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/compatdata/286160/pfx/drive_c/users/steamuser/Documents/My Games/Tabletop Simulator`)).found);
  check("Linux, $XDG_DATA_HOME elsewhere but TTS in ~/.local/share: found there", sd("linux", "/home/deck", yes("/home/deck/.local/share/Tabletop Simulator"), { XDG_DATA_HOME: "/data/x" }).dir === "/home/deck/.local/share/Tabletop Simulator/Saves");
  let v = L.savesFolderVerdict(false, w.tried);
  check("no TTS folder anywhere: amber, run TTS once, Try again (no folder made)", v && v.light === Light.Amber && v.text.includes("Run Tabletop Simulator once") && v.fix === Fixes.Retry, v);
  check("a TTS folder found: no verdict, the save step goes on", L.savesFolderVerdict(true, []) === null);
  check("state: ~/.local/state/mtg-companion, ~/Library/Application Support/MTG Companion", P.stateDirFor("linux", "/home/deck") === "/home/deck/.local/state/mtg-companion" && P.stateDirFor("darwin", "/Users/a") === "/Users/a/Library/Application Support/MTG Companion");
}

function tts() {
  section("TTS");
  const S = "MTG Table (rules engine)";
  let v = L.decideTts({ running: false, steamFound: true, saveName: S });
  check("not running: amber, Open TTS", v.light === Light.Amber && v.fix === Fixes.TtsOpen, v);
  v = L.decideTts({ running: true, versionsOk: true, tableHeard: false, saveName: S });
  check("running, no table yet: the menu path", v.light === Light.Amber && v.text.includes(`Create → Singleplayer (or Multiplayer) → Games → Save & Load → ${S}`), v);
  v = L.decideTts({ running: true, versionsOk: true, tableHeard: true, table: "11111111", wantTable: "0fa50b21", saveName: S });
  check("old table loaded: red, load it again", v.light === Light.Red && v.text.startsWith("Old table loaded") && v.text.includes(`load ${S} again`), v);
  check("a table older than stamps: red", L.decideTts({ running: true, versionsOk: true, tableHeard: true, table: null, wantTable: "0fa50b21" }).light === Light.Red);
  v = L.decideTts({ running: true, versionsOk: true, tableHeard: true, table: "0fa50b21", wantTable: "0fa50b21" });
  check("the package's table: green", v.light === Light.Green && v.text.includes("0fa50b21"), v);
  v = L.decideTts({ running: true, versionsOk: true, tableHeard: true, table: "0fa50b21", wantTable: "0fa50b21", tableHeardAgoSec: 600, ttsUpSec: 30, saveName: S });
  check("a table heard before this TTS started: amber, load the table", v.light === Light.Amber && v.text.includes("isn't loaded") && v.text.includes("Save & Load"), v);
  check("a table heard since this TTS started: green", L.decideTts({ running: true, versionsOk: true, tableHeard: true, table: "0fa50b21", wantTable: "0fa50b21", tableHeardAgoSec: 20, ttsUpSec: 90 }).light === Light.Green);
  check("TTS start time unknown: the stamp decides, as before", L.decideTts({ running: true, versionsOk: true, tableHeard: true, table: "0fa50b21", wantTable: "0fa50b21", tableHeardAgoSec: 600, ttsUpSec: null }).light === Light.Green);
  check("heard just as TTS started (the two readings seconds apart): green", L.decideTts({ running: true, versionsOk: true, tableHeard: true, table: "0fa50b21", wantTable: "0fa50b21", tableHeardAgoSec: 92, ttsUpSec: 90 }).light === Light.Green);
  check("bridge down: amber, can't check the table", L.decideTts({ running: true, versionsOk: false }).light === Light.Amber);
  check("/versions without now.table: no table heard", !L.has(L.get(L.parseJson('{"now":{"bridge":"x","node":null}}'), "now"), "table"));
  const now = L.get(L.parseJson('{"now":{"bridge":"x","table":null}}'), "now");
  check("/versions now.table null: heard, no stamp", L.has(now, "table") && L.str(now, "table") === null);
  check("Steam: steam steam://rungameid/286160 (Linux), open (Mac), xdg-open without the steam command", JSON.stringify(P.ttsLaunch("linux", "/usr/bin/steam")) === JSON.stringify(["/usr/bin/steam", ["steam://rungameid/286160"]]) && P.ttsLaunch("darwin", null)[0] === "open" && P.ttsLaunch("linux", null)[0] === "xdg-open");
}

function misc() {
  section("misc");
  check("relay key from stack/.env", L.relayKey("FOO=1\r\nMANABREW_SERVER_KEY=\"s3cret\"\r\n") === "s3cret");
  check("relay key default", L.relayKey(null) === "tts-local" && L.relayKey("MANABREW_SERVER_KEY=") === "tts-local");
  check("worst light: red beats amber", L.worst([Light.Green, Light.Amber, Light.Red]) === Light.Red);
  check("worst light: all grey is grey", L.worst([Light.Grey, Light.Grey]) === Light.Grey);
  check("worst light: grey rows don't hide green", L.worst([Light.Grey, Light.Green]) === Light.Green);
}

const Part = (file, version, release, size) => JSON.stringify({ file, sha256: "a".repeat(64), size: size === undefined ? 100 : size, version, ...(release ? { release } : {}) });
const Manifest = (parts, min, version) => `{"format":1,"version":"${version || "v2026.11.10-1200"}","built":"2026-11-10T12:00:00Z","minCompanion":${min || 1},"parts":{${parts}},"versionJson":{"bridge":"b2"},"deployedJson":{"bridge":"b2"}}`;

function update() {
  section("self-update (check only)");
  let r = L.parseManifest(Manifest(`"app":${Part("app.zip", "a2")},"images":${Part("images.tar", "i1", "v2026.11.01-0900")},"table":${Part("table.zip", "s1")}`));
  check("manifest: parsed, parts and their releases", r.m && Object.keys(r.m.parts).length === 3 && r.m.parts.images.release === "v2026.11.01-0900" && r.m.parts.app.release === "v2026.11.10-1200", r.error);
  r = L.parseManifest(Manifest(`"app":${Part("..\\x.zip", "a")}`));
  check("manifest: a file name with a path is refused", !r.m && r.error.includes("file name"), r.error);
  check("manifest: a file name of dots is refused", !L.parseManifest(Manifest(`"app":${Part("..", "a")}`)).m);
  r = L.parseManifest(Manifest('"app":{"file":"app.zip","size":5,"version":"a"}'));
  check("manifest: no sha256 refused", !r.m && r.error.includes("sha256"), r.error);
  r = L.parseManifest(Manifest(`"app":${Part("app.zip", "a", null, 0)}`));
  check("manifest: size 0 refused", !r.m && r.error.includes("size"), r.error);
  check("manifest: a tag with a slash refused", !L.parseManifest(Manifest(`"app":${Part("app.zip", "a")}`, 1, "v1/../x")).m);
  check("manifest: not JSON", !L.parseManifest("<html>").m);
  check("manifest: an unknown part is skipped", Object.keys(L.parseManifest(Manifest(`"app":${Part("app.zip", "a")},"maps":${Part("maps.zip", "m")}`)).m.parts).length === 1);
  check("manifest: a part in release '..' refused", !L.parseManifest(Manifest(`"app":${Part("app.zip", "a", "..")}`)).m);
  const old = { save: "s1", node: N, relay: R, nodeVersion: "v24.1.0" };
  check("local: an old package's table, images and runtime versions", L.localVersion(old, "table") === "s1" && L.localVersion(old, "images") === L.imagesVersion(N, R) && L.localVersion(old, "runtime") === "v24.1.0");
  check("local: parts win", L.localVersion({ save: "s1", parts: { table: "s9" } }, "table") === "s9");
  check("images version: sha8 of node + relay (the packager's)", L.imagesVersion("n", "r") === L.sha8(Buffer.from("nr")) && L.imagesVersion("n", "r") !== L.imagesVersion("r", "n"));
  const local = { built: "2026-11-10T12:00:00.000Z", parts: { app: "a1", table: "s1", images: "i1", companion: "c1" } };
  const all = Manifest(`"app":${Part("app.zip", "a1")},"table":${Part("table.zip", "s1")},"images":${Part("images.tar", "i1")},"companion":${Part("MTG.Companion.exe", "c1")},"runtime":${Part("runtime.zip", "v99")}`);
  let p = L.updatePlan(local, L.parseManifest(all).m, 1);
  check("plan: same versions: up to date (the Windows runtime and exe don't count here)", p.upToDate && p.fetch.length === 0 && !p.refused, p);
  p = L.updatePlan(local, L.parseManifest(all.replace('"a1"', '"a2"')).m, 1);
  check("plan: new app only", !p.upToDate && p.fetch.length === 1 && p.fetch[0].name === "app", p);
  p = L.updatePlan(local, L.parseManifest(all.replace('"c1"', '"c2"')).m, 1);
  check("plan: a new Windows exe alone is no update here", p.upToDate, p);
  p = L.updatePlan(local, L.parseManifest(Manifest(`"app":${Part("app.zip", "a2")}`, 2)).m, 1);
  check("plan: needs a newer app: refused, download the full package", p.refused && p.refused.includes("full package"), p);
  const builtAt = (t) => all.replace('"a1"', '"a2"').replace('"built":"2026-11-10T12:00:00Z"', t === null ? '"built0":""' : `"built":"${t}"`);
  p = L.updatePlan(local, L.parseManifest(builtAt("2026-11-09T12:00:00Z")).m, 1);
  check("downgrade: an older release is refused, says so", p.refused && p.refused.includes("older than this package; not installing it") && !p.upToDate, p.refused);
  check("downgrade: a millisecond older is refused", (L.updatePlan(local, L.parseManifest(builtAt("2026-11-10T11:59:59.999Z")).m, 1).refused || "").includes("older"));
  p = L.updatePlan(local, L.parseManifest(builtAt("2026-11-10T13:00:00+01:00")).m, 1);
  check("downgrade: the same time in another zone and format is the same build: the parts decide (new app offered)", !p.refused && p.fetch.some((x) => x.name === "app"), p.refused);
  check("downgrade: a newer release is offered", L.planAvailable(L.updatePlan(local, L.parseManifest(builtAt("2026-11-11T00:00:00Z")).m, 1)));
  check("downgrade: a manifest with no build time is refused", (L.updatePlan(local, L.parseManifest(builtAt(null)).m, 1).refused || "").includes("no usable build time"));
  for (const b of [{ parts: { app: "a1" } }, { built: "garbage" }, { built: "11/10/2026" }, { built: "2026-11-10T12:00:00" }])
    check(`downgrade: no usable local build time (${JSON.stringify(b)}) is refused (fail safe)`, (L.updatePlan(b, L.parseManifest(builtAt("2026-11-11T00:00:00Z")).m, 1).refused || "").includes("no build time"));
  const u = (url, base) => L.allowedUrl(url, base);
  check("url: the API over https, the token's host", u("https://api.github.com/repos/x/y/releases/latest").ok && u("https://api.github.com/x").api);
  check("url: the asset hosts, no token", u("https://objects.githubusercontent.com/a?b=c").ok && !u("https://objects.githubusercontent.com/a").api && u("https://release-assets.githubusercontent.com/x").ok && u("https://github.com/o/r/releases/download/t/f").ok);
  check("url: http refused", !u("http://api.github.com/x").ok);
  check("url: another host refused", !u("https://example.com/app.zip").ok && !u("https://api.github.com.evil.com/x").ok && !u("https://evilgithub.com/x").ok);
  check("url: user info refused (https://api.github.com@evil)", !u("https://api.github.com@evil.com/x").ok && !u("https://user@api.github.com/x").ok);
  check("url: another port refused", !u("https://api.github.com:8443/x").ok);
  check("url: garbage refused", !u("not a url").ok && !u(null).ok && !u("file:///C:/x").ok);
  check("url, test base: the fake is the API, localhost on its port the asset host", u("http://127.0.0.1:5000/repos", "http://127.0.0.1:5000").api && u("http://localhost:5000/dl/x", "http://127.0.0.1:5000").ok && !u("http://localhost:5000/dl/x", "http://127.0.0.1:5000").api);
  check("url, test base off this PC: every URL refused", !u("http://10.0.0.5:5000/repos", "http://10.0.0.5:5000").ok);
  check("token: only to the API, never to a test server", L.tokenFor(true, null, "t") === "t" && L.tokenFor(false, null, "t") === null && L.tokenFor(true, "http://127.0.0.1:5000", "t") === null);
  check("tag: dots alone refused", !L.validTag(".") && !L.validTag("..") && !L.validTag(null) && !L.validTag("a b") && !L.validTag("a/b"));
  check("tag: release names kept", L.validTag("v2026.11.10-1432") && L.validTag(".v1") && L.validTag("a_b"));
  const rel = L.parseRelease('{"tag_name":"v1","assets":[{"name":"update-manifest.json","url":"https://api.github.com/repos/o/r/releases/assets/7","size":900}]}');
  check("release: tag and assets", rel && rel.tag === "v1" && rel.assets.length === 1 && rel.assets[0].size === 900);
  check("release: no tag", L.parseRelease('{"message":"Not Found"}') === null && L.parseRelease("nope") === null);
  check("check: 404 is the quiet line", L.checkFailed(404, null) === L.Updates.NotPublic);
  check("check: 403 names the token or the rate limit", L.checkFailed(403, null).includes("token") && L.checkFailed(0, "timed out").includes("timed out"));
  const now = Date.UTC(2026, 10, 10, 12);
  check("check due: never checked", L.checkDue(null, now) && L.checkDue("garbage", now));
  check("check due: 5 h ago no, 6 h ago yes", !L.checkDue(new Date(now - 5 * 3600e3).toISOString(), now) && L.checkDue(new Date(now - 6 * 3600e3).toISOString(), now));
  check("check due: a time in the future (clock set back) yes", L.checkDue(new Date(now + 2 * 3600e3).toISOString(), now));
  const avail = { manifest: L.parseManifest(all.replace('"a1"', '"a2"')).m, text: "Update available" };
  avail.plan = L.updatePlan(local, avail.manifest, 1);
  let us = L.updateChecked({ status: "checking" }, avail, false, "t");
  check("state: available, with the version and notes", us.status === "available" && us.available === "v2026.11.10-1200" && us.notes === "Update available" && us.error === null, us);
  us = L.updateChecked(us, { failed: true, quiet: true, text: L.Updates.NotPublic }, false, "t");
  check("state: 404 is not-public, no error, nothing offered", us.status === "not-public" && us.error === null && us.available === null, us);
  us = L.updateChecked(us, { failed: true, text: "Couldn't check for updates (HTTP 500)." }, false, "t");
  check("state: a failed check is failed, with the error", us.status === "failed" && us.error.includes("HTTP 500"), us);
  // the manifest's signature (the vector the Windows selftest uses, made by the packager's Node code)
  section("self-update: the signature");
  const nodeKey = "4w4l1SZR71phfBRUhXcqlR4YLfGtHULpwc8aIxg56paGWyP2mawAWljSG0D2M0wAp1igtNUsslS8lYlWH8iCHg==";
  const nodeSig = "Z5TpT6mOHeP5OyJbFH3p7ea9gSMs33pRjun+kueLaypZVg2gO+gyZ/OPsEU5SjjSUwRlFu+XUIQN2l1V/IMcpw==";
  const data = Buffer.from('{"format":1,"version":"v1"}\n', "utf8");
  check("signature: the packager's (Node) signature verifies", L.verifySignature(data, nodeSig, [nodeKey]));
  const changed = Buffer.from(data); changed[changed.length - 2] ^= 1;
  check("signature: one byte changed: refused", !L.verifySignature(changed, nodeSig, [nodeKey]));
  check("signature: missing, short or garbage: refused", !L.verifySignature(data, null, [nodeKey]) && !L.verifySignature(data, "", [nodeKey]) && !L.verifySignature(data, "not base64!", [nodeKey]) && !L.verifySignature(data, Buffer.alloc(63).toString("base64"), [nodeKey]));
  check("signature: no trusted key: refused", !L.verifySignature(data, nodeSig, []) && !L.verifySignature(data, nodeSig, ["AAAA"]));
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const other = Buffer.concat([Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64");
  const sig = crypto.sign("sha256", data, { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
  check("signature: another key's signature refused; either of two keys accepted (a key change)", !L.verifySignature(data, sig, [nodeKey]) && L.verifySignature(data, sig, [nodeKey, other]) && L.verifySignature(data, nodeSig, [other, nodeKey]));
  check("keys file: comments and blank lines skipped", JSON.stringify(L.parseKeys(`# keys\r\n\r\n  ${nodeKey}  \r\n#x\n`)) === JSON.stringify([nodeKey]));
  const keysFile = path.join(__dirname, "..", "companion", "release-keys.txt");
  const shipped = fs.existsSync(path.join(__dirname, "release-keys.txt")) ? path.join(__dirname, "release-keys.txt") : keysFile;
  if (fs.existsSync(shipped)) check("the project's release key file parses to at least one P-256 key", L.parseKeys(fs.readFileSync(shipped, "utf8")).some((k) => Buffer.from(k, "base64").length === 64));
}

// ───────────────────────────── the status page: parser, guards, API ─────────────────────────────

function parser() {
  section("status page: the HTTP parser");
  const { parseHead, reader } = require("./web");
  const feed = (raw, chunks) => new Promise((done) => { const rd = reader(done); if (chunks) for (const c of chunks) rd.data(Buffer.from(c, "latin1")); else rd.data(Buffer.from(raw, "latin1")); rd.end(); });
  const h = parseHead("GET /api/status?x=1 HTTP/1.1\r\nHost: 127.0.0.1:1\r\nx-mtg-token: abc", 16384);
  check("a GET parses: method, path without the query, headers by any case", h.method === "GET" && h.path === "/api/status" && h.headers["x-mtg-token"] === "abc", h);
  const cases = [
    ["garbage: 400", "hello", 400], ["a request line with 4 parts: 400", "GET / x HTTP/1.1\r\nHost: a", 400], ["an absolute URL as target: 400", "GET http://x/ HTTP/1.1\r\nHost: a", 400],
    ["a lower-case method: 400", "get / HTTP/1.1\r\nHost: a", 400], ["HTTP/2.0: 505", "GET / HTTP/2.0\r\nHost: a", 505], ["a header without a colon: 400", "GET / HTTP/1.1\r\nHost: a\r\nnocolon", 400],
    ["a folded header: 400", "GET / HTTP/1.1\r\nHost: a\r\n x: y", 400], ["a space before the colon: 400", "GET / HTTP/1.1\r\nHost : a", 400],
    ["two Host headers: 400", "GET / HTTP/1.1\r\nHost: a\r\nHost: b", 400], ["two token headers: 400", "GET / HTTP/1.1\r\nHost: a\r\nX-MTG-Token: 1\r\nx-mtg-token: 2", 400],
    ["chunked bodies: 501", "POST / HTTP/1.1\r\nHost: a\r\nTransfer-Encoding: chunked", 501], ["Content-Length not a number: 400", "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 1x", 400],
    ["a big body (1 MB announced): 413 before reading it", "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 1048576", 413], ["a 9-digit-plus Content-Length: 400 (no overflow)", "POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 1234567890", 400],
    ["HTTP/1.1 without Host: 400", "GET / HTTP/1.1\r\nAccept: x", 400],
  ];
  for (const [name, head, want] of cases) { const r = parseHead(head, 16384); check(name, r.error === want, r); }
  check("two Accept headers are merged, not refused", parseHead("GET / HTTP/1.1\r\nHost: a\r\nAccept: x\r\nAccept: y", 16384).headers.accept === "x, y");
  check("over 50 headers: 431", parseHead(`GET / HTTP/1.1\r\nHost: a${"\r\nA: b".repeat(51)}`, 16384).error === 431);
  return Promise.all([
    feed("POST /api/action HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\n\r\nhello").then((r) => check("a POST body is read to Content-Length", r && r.body === "hello", r)),
    feed("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 5\r\n\r\nhel").then((r) => check("a body shorter than Content-Length: 400", r && r.error === 400, r)),
    feed("").then((r) => check("an empty connection: no request, no answer", r === null, r)),
    feed(null, ["GET / HT", "TP/1.1\r\nHo", "st: a\r\n\r\n"]).then((r) => check("a request in pieces is put together", r && r.path === "/" && !r.error, r)),
    feed(`GET / HTTP/1.1\r\nHost: a\r\nX: ${"y".repeat(9000)}\r\n\r\n`).then((r) => check("a head over 8 KB: 431", r && r.error === 431, r)),
    feed("GET / HTTP/1.1\nHost: a\n\n").then((r) => check("bare LF line ends: 400", r && r.error === 400, r)),
    feed("GET / HTTP/1.1\r\nHost: a\r\nX: \u00e9\r\n\r\n").then((r) => check("a non-ASCII byte in the head: 400", r && r.error === 400, r)),
    new Promise((done) => { const rd = reader(done); rd.data(Buffer.concat([Buffer.from("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\n"), Buffer.from([0xc3, 0x28])])); }).then((r) => check("a body that isn't UTF-8: 400", r && r.error === 400, r)),
  ]);
}

// a Controller with no worker started, a fake engine, in a temp package with no table save (so step 4 stops red)
function fakeController(observe) {
  const { Controller } = require("./controller");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-companion-selftest-"));
  const layout = L.makeLayout("friend", tmp.replace(/\\/g, "/"));
  const engine = { o: {}, cli: null, runtime: null, detect: async () => ({}), bridgeEnv: () => ({}), startDesktop: () => false };
  const c = new Controller({ layout, observe, savesDir: path.join(tmp, "saves"), stateDir: path.join(tmp, "state"), appDir: __dirname, platform: "linux", arch: "x64", engine, bridgeUrl: "http://127.0.0.1:9" });
  c.onlySteps = new Set([4]);
  return { c, tmp };
}

// the host's Workshop copy, beside the controller's Saves folder (or at `at`), and a patcher that makes the table by
// copying it (and its .png) as make-table.js would write them: a test changes the copy to change the table
function fakeWorkshop(c, text, at) {
  const ws = at || path.join(path.dirname(c.savesDir), "Mods", "Workshop", `${L.TableWorkshopId}.json`);
  fs.mkdirSync(path.dirname(ws), { recursive: true });
  fs.writeFileSync(ws, text);
  if (at) c.workshopCandidates = () => [ws];
  c.buildTable = (w, out) => {
    fs.copyFileSync(w, out);
    const png = w.replace(/\.json$/i, ".png");
    if (fs.existsSync(png)) fs.copyFileSync(png, out.replace(/\.json$/i, ".png"));
    return { ok: true, stamp: null };
  };
  return ws;
}

async function wiring() {
  section("the start sequence wiring (Controller.workOnce, no worker, a fake watcher)");
  const { c, tmp } = fakeController(false);
  try {
    let watched = 0;
    const watch = async () => { watched++; };
    check("wiring: before any run, no stop: a button starts where it asks", c.stoppedAt === 0 && c.startAt(5) === 5);
    let ran = await c.workOnce(watch);
    check("launch: the first turn is the check, not the watcher and not the start sequence: no stop recorded, Not started", ran && watched === 0 && c.pendingFrom === 0 && c.stoppedAt === 0 && c.phase === L.NotStartedPhase && c.needsStart && !c.engineStarted, `${ran} ${watched} / ${c.stoppedAt} / ${c.phase}`);
    check("launch: the check read the save step (red: no table here) and set no row waiting", c.rows[L.Step.Save].v.light === Light.Red && c.rows[L.Step.Tts].v.text !== "Waiting for Table save.", c.rows[L.Step.Save].v);
    ran = await c.workOnce(watch);
    check("launch: then only the watcher, nothing queued, still Not started", !ran && watched === 1 && c.pendingFrom === 0 && c.needsStart, `${ran} ${watched} / ${c.pendingFrom}`);
    check("launch: Start engine queues a press (nothing runs until the worker takes it)", c.startEngine() === null && c.work.length === 1 && c.pendingFrom === 0);
    ran = await c.workOnce(watch);
    check("Start engine: the press is a turn of its own: it queues the start sequence from step 1", ran && c.pendingFrom === 1 && !c.needsStart, c.pendingFrom);
    watched = 0;
    ran = await c.workOnce(watch);
    check("wiring: Start engine's turn runs the start sequence, not the watcher; the red step is recorded", ran && watched === 0 && c.pendingFrom === 0 && c.stoppedAt === 4 && c.phase.startsWith("Stopped at step 4") && c.engineStarted, `${ran} ${watched} ${c.stoppedAt} ${c.phase}`);
    check("wiring: the steps after the stop wait for it", c.rows[4].v.light === Light.Grey && c.rows[5].v.text === "Waiting for Table save.", c.rows[5].v);
    ran = await c.workOnce(watch);
    check("wiring: still red: a watcher turn, nothing queued", !ran && watched === 1 && c.pendingFrom === 0 && c.stoppedAt === 4);
    c.doFix(L.Step.Bridge, Fixes.BridgeStart);
    ran = await c.workOnce(watch);
    check("wiring: a press is a turn of its own: it queues its step", ran && watched === 1 && c.pendingFrom === 5, c.pendingFrom);
    await c.workOnce(watch);
    check("wiring: Start the bridge while the save is red: the save step again, not step 5", c.stoppedAt === 4 && c.phase.startsWith("Stopped at step 4"), `${c.stoppedAt} ${c.phase}`);
    let pressed = false;
    const off = c.onChanged(() => { if (!pressed && c.phase === "Starting: step 4 of 6") { pressed = true; c.doFix(L.Step.Bridge, Fixes.Retry); } });
    c.doFix(L.Step.Bridge, Fixes.BridgeStart);
    await c.workOnce(watch); // the press
    await c.workOnce(watch); // the run, interrupted by the second press
    off();
    check("wiring: a press during a run interrupts it, and the unfinished step is remembered", pressed && c.phase === "Interrupted" && c.stoppedAt === 4, `${pressed} ${c.phase} ${c.stoppedAt}`);
    await c.workOnce(watch); await c.workOnce(watch);
    check("wiring: pressed again during the run: the interrupted step still runs first, never skipped", c.stoppedAt === 4 && c.phase.startsWith("Stopped at step 4"), `${c.stoppedAt} ${c.phase}`);
    c.rows[L.Step.Save].v = verdict(Light.Red, "Not yet.");
    ran = await c.workOnce(async () => { watched++; c.rows[L.Step.Save].v = verdict(Light.Green, "Installed."); });
    check("wiring: the watcher's turn that sees it green queues the next step", !ran && c.pendingFrom === 5, `${ran} ${c.pendingFrom}`);
    ran = await c.workOnce(watch);
    check("wiring: the run that carries on forgets the stop", ran && c.stoppedAt === 0 && c.pendingFrom === 0 && c.phase === "Ready", `${c.stoppedAt} ${c.phase}`);
    const before = watched;
    ran = await c.workOnce(watch);
    check("wiring: no second carry-on: the next turn only watches", !ran && watched === before + 1 && c.pendingFrom === 0);
    // the game lock refuses (the worker isn't started: nothing can run)
    c.game = L.Game.on("Game on: turn 6, 4 players.", 6);
    const r1 = c.restartEngine(), r2 = c.doFix(L.Step.Stack, Fixes.StackRestart), r3 = c.doFix(L.Step.Bridge, Fixes.BridgeRestart), r4 = c.doFix(L.Step.Images, Fixes.ImagesLoad);
    check("game on: Restart engine refused", r1 && r1.includes("game is on"), r1);
    check("game on: Restart relay and room, Restart the bridge, Load the engine images refused", !!r2 && !!r3 && !!r4);
    c.game = L.Game.cantTell("bridge slow");
    check("can't tell: Restart engine refused too", (c.restartEngine() || "").includes("can't tell"));
    const o = fakeController(true);
    o.c.game = L.Game.none("No game.");
    check("observe mode: every change refused", !!o.c.restartEngine() && !!o.c.doFix(L.Step.Tts, Fixes.TtsOpen) && o.c.startEngine() === "Observe mode: nothing is changed." && o.c.work.length === 0 && !o.c.needsStart);
    await o.c.workOnce(watch);
    o.c.rows[L.Step.Save].v = verdict(Light.Green, "Installed.");
    await o.c.workOnce(watch);
    check("wiring: observe mode never records a stop, so never carries on", o.c.stoppedAt === 0 && o.c.pendingFrom === 0 && o.c.phase === "Observing (no changes)", `${o.c.stoppedAt} ${o.c.phase}`);
    fs.rmSync(o.tmp, { recursive: true, force: true });
  } catch (e) { check("wiring: no exception", false, e.stack); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// Launch only checks (2026-11-14, as the Windows app). The table save is the one step that changes something without
// a container engine, so it is the proof: a package with a table, --steps 4. The launch's check installs nothing;
// Start engine installs it; --start (autoStart) installs it at launch as every launch did before.
async function launchStartsNothing() {
  section("launch only checks; Start engine starts");
  const mk = (observe, autoStart) => {
    const x = fakeController(observe);
    fakeWorkshop(x.c, '{"SaveName": "Selftest table", "ObjectStates": []}');
    x.c.reloadPackage();
    x.c.autoStart = autoStart;
    x.c.stopBridge = async () => {}; // (never near a real bridge)
    return x;
  };
  const filesIn = (d) => (fs.existsSync(d) ? fs.readdirSync(d).length : 0);
  let watched = 0;
  const watch = async () => { watched++; };
  const all = [];
  try {
    const n = mk(false, false); all.push(n);
    const c = n.c;
    await c.workOnce(watch);
    check("launch starts nothing: the check installed no table save", filesIn(c.savesDir) === 0, filesIn(c.savesDir));
    check("launch starts nothing: the save row is grey and says Start engine does it", c.rows[L.Step.Save].v.light === Light.Grey && c.rows[L.Step.Save].v.text === "Start engine does this: Installing the table as TS_Save_1.json.", c.rows[L.Step.Save].v);
    check("launch starts nothing: Not started, nothing queued, not started", c.phase === L.NotStartedPhase && c.pendingFrom === 0 && c.needsStart && !c.engineStarted, c.phase);
    check("launch starts nothing: the check made the table in a temp file, not in the package", !fs.existsSync(c.L.tableJson));
    await c.workOnce(watch); await c.workOnce(watch);
    check("launch starts nothing: the watcher's turns install nothing either", watched === 2 && filesIn(c.savesDir) === 0, `${watched} / ${filesIn(c.savesDir)}`);
    c.startEngine();
    await c.workOnce(watch); // the press
    await c.workOnce(watch); // the start sequence
    check("Start engine: the table save installed (TS_Save_1.json), the row green, Ready", fs.existsSync(path.join(c.savesDir, "TS_Save_1.json")) && c.rows[L.Step.Save].v.light === Light.Green && c.phase === "Ready" && c.engineStarted && !c.needsStart, `${L.vText(c.rows[L.Step.Save].v)} / ${c.phase}`);
    c.stopEverything(null);
    await c.workOnce(watch);
    check("Stop everything: back to not started (Stopped. Start engine starts it again.)", c.phase === L.StoppedPhase && c.phase === "Stopped. Start engine starts it again." && c.needsStart && !c.engineStarted && c.everythingStopped, c.phase);
    c.startEngine();
    await c.workOnce(watch); await c.workOnce(watch);
    check("Start engine after Stop everything: runs again, Ready", c.phase === "Ready" && !c.everythingStopped && c.engineStarted, c.phase);

    const a = mk(false, true); all.push(a);
    const ran = await a.c.workOnce(watch);
    check("--start: the launch's first turn is the start sequence: the save installed, Ready", ran && fs.existsSync(path.join(a.c.savesDir, "TS_Save_1.json")) && a.c.phase === "Ready" && a.c.engineStarted, `${a.c.phase} / ${filesIn(a.c.savesDir)}`);

    const o = mk(true, true); all.push(o);
    await o.c.workOnce(watch);
    check("--observe beats --start: nothing installed, Observing", filesIn(o.c.savesDir) === 0 && o.c.phase === "Observing (no changes)" && !o.c.needsStart && o.c.startEngine() !== null, o.c.phase);

    // an engine found already up at launch counts as started (Start MTG.bat, or a companion that was restarted)
    const u = mk(false, false); all.push(u);
    u.c.onlySteps = null;
    const green = (i) => async () => { u.c.set(i, verdict(Light.Green, "Up.")); return true; };
    u.c.doDocker = green(L.Step.Docker); u.c.doImages = green(L.Step.Images); u.c.doStack = green(L.Step.Stack);
    u.c.doSave = async () => { u.c.set(L.Step.Save, verdict(Light.Grey, "Start engine does this: x")); return true; };
    u.c.doBridge = green(L.Step.Bridge); u.c.doTts = async () => { u.c.set(L.Step.Tts, verdict(Light.Amber, "TTS isn't running.")); return true; };
    await u.c.workOnce(watch);
    check("launch: the engine already up counts as started: Ready, no Start engine needed", u.c.engineStarted && !u.c.needsStart && u.c.phase === "Ready", `${u.c.phase} ${u.c.engineStarted}`);

    // a press during the launch check: the check stops, the press runs, nothing is resumed from the check
    const p = mk(false, false); all.push(p);
    let pressed = false;
    const off = p.c.onChanged(() => { if (!pressed && p.c.phase === "Checking: step 4 of 6") { pressed = true; p.c.startEngine(); } });
    await p.c.workOnce(watch); off();
    check("a press during the launch check: the check is cut short with nothing to resume, the press waits its turn", pressed && p.c.checkPending && p.c.resumeFrom === 0 && p.c.stoppedAt === 0 && p.c.work.length === 1, `${pressed} ${p.c.checkPending} ${p.c.resumeFrom} ${p.c.work.length}`);
    await p.c.workOnce(watch); await p.c.workOnce(watch);
    check("then Start engine's run is the check: the save installed, the check not run again", fs.existsSync(path.join(p.c.savesDir, "TS_Save_1.json")) && !p.c.checkPending && p.c.phase === "Ready", p.c.phase);
  } catch (e) { check("launch starts nothing: no exception", false, e.stack); } finally { for (const x of all) fs.rmSync(x.tmp, { recursive: true, force: true }); }
}

// the watcher before Start engine: parts that only aren't running stay grey (no red light, no notification); after a
// start they are red again; an engine found up by the watcher counts as started. Every probe that could reach this
// PC's real engine, bridge or TTS is replaced (the login, the bridge verdict, the TTS process).
async function watcherBeforeStart() {
  section("the watcher before Start engine");
  const { c, tmp } = fakeController(false);
  try {
    const notes = [];
    c.notify = (t, m) => notes.push(`${t}: ${m}`);
    let facts = { platform: "darwin", runtime: "docker", cliFound: true, desktopFound: true };
    let images = { id: null }, relay = { exists: false };
    c.engine = { o: {}, cli: "docker", runtime: "docker", detect: async () => ({ ...facts }), imageId: async () => ({ ...images }), container: async (n) => ({ info: n === "relay" ? relay : relay.exists ? up("") : { exists: false } }), bridgeEnv: () => ({}), startDesktop: () => false };
    c.L.imagesTar = "/P/images/mtg-images.tar"; // (a package with its images file: missing images are only not loaded yet)
    c.login = async () => ({ kind: "ok", roomFound: true, roomStatus: "Lobby", ms: 1 });
    let bridgeUp = false;
    c.bridgeVerdict = async (vers) => (bridgeUp ? verdict(Light.Green, "Running (bridge x).") : L.decideBridge(vers, null, false, null, true));
    c.ttsProc = async () => null;
    c.phase = L.NotStartedPhase;
    await c.monitorTick();
    check("watcher, before start: Docker Desktop not running: grey, not red, no notification", c.rows[L.Step.Docker].v.light === Light.Grey && notes.length === 0, c.rows[L.Step.Docker].v);
    facts = { ...facts, answers: true, version: "27.3.1", cpus: 4 };
    c.imagesAt = 0; c.versionsAt = 0;
    await c.monitorTick();
    const lights = c.rows.slice(0, 5).map((r) => r.v.light);
    check("watcher, before start: images not loaded, no engine containers, no bridge: grey, none red, no notification", c.rows[L.Step.Images].v.light === Light.Grey && c.rows[L.Step.Stack].v.light === Light.Grey && c.rows[L.Step.Bridge].v.light === Light.Grey && !lights.includes(Light.Red) && notes.length === 0, c.rows.map((r) => L.vText(r.v)));
    check("watcher, before start: still Not started", c.needsStart && c.phase === L.NotStartedPhase, c.phase);
    c.engineStarted = true; c.imagesAt = 0; c.versionsAt = 0; facts = { ...facts, answers: false };
    await c.monitorTick();
    check("watcher, after a start: Docker Desktop not answering is no longer grey", c.rows[L.Step.Docker].v.light !== Light.Grey, c.rows[L.Step.Docker].v);
    facts = { ...facts, answers: true };
    await c.monitorTick();
    check("watcher, after a start: the stack and the bridge missing are red again (with their buttons)", c.rows[L.Step.Stack].v.light === Light.Red && c.rows[L.Step.Bridge].v.light === Light.Red && c.rows[L.Step.Bridge].v.fix === Fixes.BridgeStart, c.rows.map((r) => L.vText(r.v)));
    c.engineStarted = false; c.phase = L.NotStartedPhase; c.imagesAt = 0; c.versionsAt = 0;
    images = { id: R }; relay = up("healthy"); bridgeUp = true; c.loginAt = 0; c.loginCache = null;
    await c.monitorTick();
    check("watcher: an engine that came up without Start engine counts as started: Ready", c.engineStarted && !c.needsStart && c.phase === "Ready", `${c.rows.map((r) => r.v.light).join(",")} / ${c.phase}`);
  } catch (e) { check("watcher before start: no exception", false, e.stack); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function startEngineRules() {
  section("Start engine: the rules");
  check("--start: the flags that start at launch (--start, a self-update's restart); none: launch only checks",
    L.autoStart(["--start"]) && L.autoStart(["--after-update"]) && L.autoStart(["--apply-update", "v1.2"]) && !L.autoStart([]) && !L.autoStart(["--observe"]) && !L.autoStart(["--no-browser", "--web-port", "0"]));
  const src = fs.readFileSync(path.join(__dirname, "companion.js"), "utf8");
  check("companion.js: --start reaches the Controller, never with --observe", src.includes("autoStart: !observe && L.autoStart(args)"));
  check("companion.js: the page opens after the first pass when nothing is started", src.includes("controller.rows.map((r) => r.v.light), controller.needsStart)"));
  const notRunning = L.decideDocker({ platform: "darwin", runtime: "docker", cliFound: true, desktopFound: true });
  const bs = L.beforeStart(L.Step.Docker, notRunning);
  check("before start: Docker not running: grey, points at Start engine (no red, no notification)", notRunning.action === Actions.StartDesktop && bs.light === Light.Grey && bs.text.includes("Start engine") && !bs.fix, bs);
  const waiting = L.beforeStart(L.Step.Docker, L.decideDocker({ platform: "darwin", runtime: "docker", cliFound: true, desktopFound: true, desktopRunning: true }));
  check("before start: Docker Desktop up, engine not answering yet: grey, Start engine waits", waiting.light === Light.Grey && waiting.text.includes("Start engine"), waiting);
  const missing = L.decideDocker({ platform: "linux" });
  check("before start: no container engine installed is a real problem: kept red with its hint", L.beforeStart(L.Step.Docker, missing) === missing && missing.light === Light.Red && !!missing.hint);
  const silent = L.decideDocker({ platform: "linux", runtime: "podman", cliFound: true, detail: "x" });
  check("before start: Podman installed but silent is a real problem: kept red", L.beforeStart(L.Step.Docker, silent) === silent && silent.light === Light.Red);
  const noRelay = L.decideStack(null, null, null, L.Game.none("No game."));
  const bsStack = L.beforeStart(L.Step.Stack, noRelay);
  check("before start: no relay container: grey, Start engine", bsStack.light === Light.Grey && bsStack.text.includes("Start engine"), bsStack);
  const unhealthy = L.decideStack(up("unhealthy"), up(""), null, L.Game.none("No game."));
  check("before start: an unhealthy relay is a real problem: kept red", L.beforeStart(L.Step.Stack, unhealthy) === unhealthy && unhealthy.light === Light.Red, unhealthy);
  const noBridge = L.decideBridge(L.httpOf("refused"), null, false, null, true);
  const bsBridge = L.beforeStart(L.Step.Bridge, noBridge);
  check("before start: no bridge: grey, Start engine (no StartBridge action left to act on)", noBridge.action === Actions.StartBridge && bsBridge.light === Light.Grey && !bsBridge.action && bsBridge.text.includes("Start engine"), bsBridge);
  const port = verdict(Light.Red, "code holds port 39998.", { fix: Fixes.ShowProgram, label: "Show the program" });
  check("before start: a port taken is a real problem: kept", L.beforeStart(L.Step.Bridge, port) === port);
  const load = L.decideImages({ friend: true, tarPath: "x.tar" });
  check("before start: images to load: grey, Start engine loads them", load.action === Actions.Load && L.beforeStart(L.Step.Images, load).light === Light.Grey);
  const noTar = L.decideImages({ friend: true, tarPath: null, wantRelay: R, wantNode: N });
  check("before start: the images file missing from the package is a real problem: kept red", L.beforeStart(L.Step.Images, noTar) === noTar && noTar.light === Light.Red);
  const tts = verdict(Light.Amber, "Tabletop Simulator isn't running.", { fix: Fixes.TtsOpen, label: "Open TTS", hint: "In TTS: Create" });
  check("before start: the TTS row is left as it is (its Open TTS button too)", L.beforeStart(L.Step.Tts, tts) === tts);
  check("engine up: engine, images, stack and bridge green (save and TTS don't count)", L.engineUp([Light.Green, Light.Green, Light.Green, Light.Grey, Light.Green, Light.Amber])
    && !L.engineUp([Light.Green, Light.Green, Light.Grey, Light.Green, Light.Green, Light.Green]) && !L.engineUp([Light.Green, Light.Green, Light.Green, Light.Green, Light.Grey, Light.Green]));
  const rows = [bs, verdict(Light.Grey, "x"), bsStack, verdict(Light.Grey, "y"), bsBridge, tts];
  check("what to do next: before start: press Start engine (not the TTS row's hint)", L.nextHint(rows, true, "T") === L.StartHint && L.StartHint.startsWith("The engine isn't running. Press Start engine"));
  check("what to do next: after start: the first amber/red hint, as before", L.nextHint(rows, false, "T") === "In TTS: Create");
  rows[0] = missing;
  check("what to do next: before start, a red light with a hint comes first", L.nextHint(rows, true, "T") === missing.hint);
  check("what to do next: nothing to say: how to load the table", L.nextHint([verdict(Light.Green, "ok")], false, "My table").startsWith(`${L.ttsHowTo("My table")}\n\nOnly the host`));
  check("header light: before start or after a stop, grey unless red (an amber TTS row doesn't count)", L.overall([Light.Grey, Light.Amber], true) === Light.Grey && L.overall([Light.Red, Light.Amber], true) === Light.Red && L.overall([Light.Green, Light.Amber], false) === Light.Amber);
  const { openAfterFirstPass } = require("./web");
  check("after the first pass: with a red light", openAfterFirstPass(false, [Light.Green, Light.Red]) && !openAfterFirstPass(false, [Light.Green, Light.Amber, Light.Busy]) && !openAfterFirstPass(true, [Light.Red]));
  check("after the first pass: or with nothing started (the page has Start engine); never in observe mode", openAfterFirstPass(false, [Light.Green, Light.Grey], true) && !openAfterFirstPass(false, [Light.Green, Light.Grey], false) && !openAfterFirstPass(true, [Light.Grey], true));
}

// the status page before Start engine: Not started, the hint, Start engine first and gold, one press queued
async function notStartedStatus() {
  section("status page: not started");
  const { WebUi, pageFromCs } = require("./web");
  const { c, tmp } = fakeController(false);
  const o = fakeController(true);
  const w = new WebUi(c, { page: "<html>{{TOKEN}}{{NONCE}}</html>" }), wo = new WebUi(o.c, { page: "<html>{{TOKEN}}{{NONCE}}</html>" });
  try {
    c.game = L.Game.none("No game.");
    c.rows[0].v = verdict(Light.Grey, "Docker Desktop isn't running. Start engine starts it.");
    c.rows[5].v = verdict(Light.Amber, "Tabletop Simulator isn't running.", { fix: Fixes.TtsOpen, label: "Open TTS", hint: "In TTS: Create" });
    let s = w.status();
    check("not started: needsStart before any start", c.needsStart);
    check("not started: the header says Not started, grey (the amber TTS row doesn't make it amber)", s.worst.text === "Not started" && s.worst.state === "grey", s.worst);
    check("not started: What to do next says press Start engine (not the TTS row's hint)", s.hint === L.StartHint && s.hint.includes("Press Start engine"), s.hint);
    check("not started: Start engine first in the menu, enabled, gold (primary), no confirm", s.menu[0].id === "start-engine" && s.menu[0].label === "Start engine" && s.menu[0].enabled && s.menu[0].primary === true && s.menu[0].confirm === null, s.menu[0]);
    check("status: the menu: start-engine, restart-engine, stop-everything, open-logs", s.menu.map((m) => m.id).join(",") === "start-engine,restart-engine,stop-everything,open-logs", s.menu.map((m) => m.id).join(","));
    check("not started: the other menu buttons are never primary", s.menu.slice(1).every((m) => !m.primary));
    c.rows[0].v = verdict(Light.Red, "Install Docker Desktop.", { fix: Fixes.Retry, label: "Try again", hint: "Docker Desktop isn't installed on this Mac." });
    s = w.status();
    check("not started, a real problem: the red light's hint comes first, the header names it", s.hint === "Docker Desktop isn't installed on this Mac." && s.worst.text === "Problem: Container engine", `${s.hint} / ${s.worst.text}`);
    c.rows[0].v = verdict(Light.Grey, "Docker Desktop isn't running. Start engine starts it.");
    let res = await w.route("start-engine", false);
    check("Start engine: accepted, one action queued, nothing run here", res.ok && res.message.startsWith("Starting the engine") && c.work.length === 1, res);
    res = await w.route("start-engine", false);
    check("Start engine twice while queued: Already running, still one action", res.ok && res.message.startsWith("Already running") && c.work.length === 1, res);
    await c.workOnce(async () => {}); // (the press only: it queues step 1; the run itself is never made here)
    check("Start engine's press: the start sequence queued from step 1, no longer needsStart", c.pendingFrom === 1 && !c.needsStart, c.pendingFrom);
    s = w.status();
    check("Start engine's press: the gold goes off, the hint is the normal one again", !s.menu[0].primary && s.hint === "In TTS: Create", s.hint);
    res = await w.route("start-engine", false);
    check("Start engine while its run is queued: Already running, nothing more queued", res.ok && res.message.startsWith("Already running") && c.work.length === 0 && c.pendingFrom === 1, res);
    c.pendingFrom = 0; c.engineStarted = true;
    s = w.status();
    check("status: started: Start engine stays enabled but isn't the gold one", s.menu[0].id === "start-engine" && s.menu[0].enabled && !s.menu[0].primary, s.menu[0]);
    c.everythingStopped = true; c.engineStarted = false; // (as stopEverything leaves it)
    c.rows[0].v = verdict(Light.Green, "Docker 27.");
    s = w.status();
    check("stopped: still Stopped (not Not started), the hint says press Start engine, Start engine is the gold one", s.worst.text === "Stopped" && s.hint === L.StartHint && s.menu[0].primary === true, `${s.worst.text} / ${s.hint}`);
    const ores = await wo.route("start-engine", false);
    check("observe mode: Start engine refused, nothing queued, never gold", !ores.ok && ores.message === "Observe mode: nothing is changed." && o.c.work.length === 0 && !wo.status().menu[0].primary && !wo.status().menu[0].enabled, ores);
    const cs = path.join(__dirname, "..", "companion", "src", "WebPage.cs");
    const page = fs.existsSync(path.join(__dirname, "page.html")) ? fs.readFileSync(path.join(__dirname, "page.html"), "utf8") : fs.existsSync(cs) ? pageFromCs(fs.readFileSync(cs, "utf8")) : null;
    if (page) check("the shared page draws start-engine: its tip, the play icon, primary drawn gold", page.includes("'start-engine': 'Start engine:") && page.includes("'start-engine': 'play'") && page.includes("v.kind === 'fix' || v.primary ? ' fix' : ''"));
  } catch (e) { check("not started: no exception", false, e.stack); } finally { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(o.tmp, { recursive: true, force: true }); }
}

// the save step for real, in a temp folder: install, adopt, a player's save never overwritten
async function saveFiles() {
  section("table save: the files");
  const { c, tmp } = fakeController(false);
  try {
    const ws = fakeWorkshop(c, '{"SaveName": "MTG Table (rules engine)", "x": 1}');
    fs.writeFileSync(ws.replace(/\.json$/, ".png"), "png");
    fs.mkdirSync(c.savesDir, { recursive: true });
    fs.writeFileSync(path.join(c.savesDir, "TS_Save_1.json"), "the player's own");
    c.reloadPackage();
    let ok = await c.doSave();
    check("install: TS_Save_2.json and its picture, the player's TS_Save_1 untouched", ok && fs.readFileSync(path.join(c.savesDir, "TS_Save_2.json"), "utf8").includes("rules engine") && fs.existsSync(path.join(c.savesDir, "TS_Save_2.png")) && fs.readFileSync(path.join(c.savesDir, "TS_Save_1.json"), "utf8") === "the player's own", c.rows[3].v);
    check("install: state.json records the file, its hash and the folder", (c.loadState() || {}).saveFile === "TS_Save_2.json" && c.loadState().saveHash === L.sha8(fs.readFileSync(c.L.tableJson)));
    ok = await c.doSave();
    check("a second start: up to date, no new file", ok && !fs.existsSync(path.join(c.savesDir, "TS_Save_3.json")) && c.rows[3].v.text.includes("up to date"), c.rows[3].v);
    fs.writeFileSync(path.join(c.savesDir, "TS_Save_2.json"), "the player saved over it");
    fs.writeFileSync(ws, '{"SaveName": "MTG Table (rules engine)", "x": 2}');
    c.reloadPackage();
    ok = await c.doSave();
    check("a new package table after the player saved over ours: TS_Save_3.json, theirs kept", ok && fs.readFileSync(path.join(c.savesDir, "TS_Save_2.json"), "utf8") === "the player saved over it" && fs.existsSync(path.join(c.savesDir, "TS_Save_3.json")), c.rows[3].v);
    fs.writeFileSync(ws, '{"SaveName": "MTG Table (rules engine)", "x": 3}');
    c.reloadPackage();
    ok = await c.doSave();
    check("a newer package table, ours untouched: updated in place, a backup kept", ok && fs.readFileSync(path.join(c.savesDir, "TS_Save_3.json"), "utf8").includes('"x": 3') && fs.readdirSync(path.join(c.stateDir, "backup")).length === 1 && !fs.existsSync(path.join(c.savesDir, "TS_Save_4.json")), c.rows[3].v);
  } catch (e) { check("save files: no exception", false, e.stack); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  // TTS never run here: the step waits, makes no folder, and goes on once TTS's folder appears
  const n = fakeController(false);
  try {
    fakeWorkshop(n.c, '{"SaveName": "MTG Table (rules engine)"}', path.join(n.tmp, "workshop", `${L.TableWorkshopId}.json`));
    const tts = path.join(n.tmp, "home", "Tabletop Simulator");
    n.c.findSaves = () => ({ dir: path.join(tts, "Saves"), found: fs.existsSync(tts), tried: [tts] });
    n.c.reloadPackage();
    let ok = await n.c.doSave();
    check("no TTS folder yet: the save step stops amber, says run TTS once, makes no folder", !ok && n.c.rows[3].v.light === Light.Amber && n.c.rows[3].v.text.includes("Run Tabletop Simulator once") && !fs.existsSync(tts), n.c.rows[3].v);
    fs.mkdirSync(tts, { recursive: true });
    ok = await n.c.doSave();
    check("TTS run once (its folder there): Try again installs the table", ok && fs.existsSync(path.join(tts, "Saves", "TS_Save_1.json")), n.c.rows[3].v);
  } catch (e) { check("no TTS folder: no exception", false, e.stack); } finally { fs.rmSync(n.tmp, { recursive: true, force: true }); }
}

// the table save made from the host's own Workshop copy (the package ships no table): the pure parts, then the
// controller on a temp package with a fake patcher
async function workshopTable() {
  section("the table from the host's Workshop copy");
  const native = P.workshopCandidates("linux", "/home/deck/.local/share/Tabletop Simulator/Saves", "2296042369", "/home/deck", {}, () => null);
  check("Workshop (Linux): beside Saves first", native[0] === "/home/deck/.local/share/Tabletop Simulator/Mods/Workshop/2296042369.json", native[0]);
  check("Workshop (Linux): then the game's own folder in Steam's libraries (Game Data location)", native.includes("/home/deck/.local/share/Steam/steamapps/common/Tabletop Simulator/Tabletop Simulator_Data/Mods/Workshop/2296042369.json"), native);
  const sd = P.workshopCandidates("linux", "/x/Saves", "1", "/home/deck", {}, (f) => (f === "/home/deck/.local/share/Steam/steamapps/libraryfolders.vdf" ? '"path" "/run/media/mmcblk0p1"' : null));
  check("Workshop (Linux): an SD card's library too", sd.includes("/run/media/mmcblk0p1/steamapps/common/Tabletop Simulator/Tabletop Simulator_Data/Mods/Workshop/1.json"), sd);
  const proton = P.workshopCandidates("linux", "/home/deck/.local/share/Steam/steamapps/compatdata/286160/pfx/drive_c/users/steamuser/Documents/My Games/Tabletop Simulator/Saves", "2296042369", "/home/deck", {}, () => null);
  check("Workshop (Proton): beside the prefix's Saves", proton[0] === "/home/deck/.local/share/Steam/steamapps/compatdata/286160/pfx/drive_c/users/steamuser/Documents/My Games/Tabletop Simulator/Mods/Workshop/2296042369.json", proton[0]);
  const mac = P.workshopCandidates("darwin", "/Users/a/Library/Tabletop Simulator/Saves", "2296042369", "/Users/a", {}, () => null);
  check("Workshop (macOS): beside Saves", mac.length === 1 && mac[0] === "/Users/a/Library/Tabletop Simulator/Mods/Workshop/2296042369.json", mac);
  const miss = L.workshopMissing(L.workshopUrl(L.TableWorkshopId), native);
  check("Workshop missing: red, the link, what to do, Try again (the Windows companion's words)", miss.light === Light.Red && miss.fix === Fixes.Retry
    && miss.text === "Subscribe to the table on the Steam Workshop: https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369, start TTS once so it downloads, then press Try again.", miss);
  check("Workshop missing: the hint names where it looked", miss.hint.includes(native[0]) && miss.hint.includes(native[1]));
  check("the 6-player table's link is ready for its profile", L.workshopUrl(L.SixWorkshopId) === "https://steamcommunity.com/sharedfiles/filedetails/?id=2293586471");
  const okb = L.parseMakeTable(0, 'noise\n{"ok":true,"table":"4p","stamp":"5a6fd66e","save":"09d84816","workshop":"e502cd67"}\n');
  check("make-table: its JSON line read", okb.ok && okb.stamp === "5a6fd66e" && okb.save === "09d84816" && okb.workshop === "e502cd67" && okb.error === null, okb);
  const gone = L.parseMakeTable(3, '{"ok":false,"missing":true,"error":"x isn\'t there"}');
  check("make-table: the Workshop file gone", !gone.ok && gone.missing && gone.error === "x isn't there", gone);
  const bad = L.parseMakeTable(1, '{"ok":false,"error":"a patch didn\'t apply to this Workshop copy: FAIL Draw"}');
  check("make-table: a patch that didn't apply", !bad.ok && !bad.missing && bad.error.includes("FAIL Draw"));
  check("make-table: ok:true but a non-zero exit is a failure", !L.parseMakeTable(1, '{"ok":true}').ok);
  const none = L.parseMakeTable(1, "Error: Cannot find module");
  check("make-table: no JSON line: a failure that says what it printed", !none.ok && none.error.includes("Cannot find module"), none);
  const refused = L.tableBuildFailed(bad);
  check("make-table failed: red, why, Try again, a hint about the Workshop table changing", refused.light === Light.Red && refused.text.includes("FAIL Draw") && refused.fix === Fixes.Retry && refused.hint.includes("newer"), refused);
  check("save done: the package's table: green; no hash to compare: green", L.saveDone("Installed.", "s1", "s1", "t1", "t1").light === Light.Green && L.saveDone("Installed.", "s1", null, "t1", null).light === Light.Green);
  const other = L.saveDone("Installed.", "s2", "s1", "t2", "t1");
  check("save done: another Workshop copy made another table: amber, says both", other.light === Light.Amber && other.text.startsWith("Installed.") && other.text.includes("t2") && other.text.includes("t1"), other);
  const dep = { table: "t1", bridge: "b" };
  const next = L.deployedWithTable(dep, "t2");
  check("deployed.json: the host's table, the package's kept as tablePackage", next && next.table === "t2" && next.tablePackage === "t1" && next.bridge === "b" && dep.table === "t1", next);
  check("deployed.json: already the host's: no rewrite; the package's kept on a second rewrite", L.deployedWithTable(dep, "t1") === null && L.deployedWithTable(null, "t2") === null && L.deployedWithTable(next, "t3").tablePackage === "t1");

  // the controller: a temp package, a fake patcher
  const { c, tmp } = fakeController(false);
  try {
    const body1 = '{"SaveName": "MTG Table (rules engine)", "v": 1}';
    fs.writeFileSync(c.L.versionFile, JSON.stringify({ table: "t1", save: L.sha8(Buffer.from(body1)), workshop: { id: L.TableWorkshopId, url: L.workshopUrl(L.TableWorkshopId) } }));
    fs.mkdirSync(path.dirname(c.L.deployedFile), { recursive: true });
    fs.writeFileSync(c.L.deployedFile, JSON.stringify({ table: "t1", bridge: "b" }));
    c.reloadPackage();
    const ws = path.join(path.dirname(c.savesDir), "Mods", "Workshop", `${L.TableWorkshopId}.json`);
    let body = body1, stamp = "t1", refuse = false, runs = 0, seen = null;
    c.buildTable = (w, out) => { runs++; seen = w; if (refuse) return { ok: false, error: "a patch didn't apply to this Workshop copy: FAIL Draw" }; fs.writeFileSync(out, body); return { ok: true, stamp }; };
    const saves = () => (fs.existsSync(c.savesDir) ? fs.readdirSync(c.savesDir).filter((f) => f.endsWith(".json")).length : 0);
    const row = () => c.rows[L.Step.Save].v;
    let ok = await c.doSave();
    check("no Workshop copy: red with the subscribe hint, the patcher never ran, nothing installed", !ok && row().light === Light.Red && row().text.startsWith("Subscribe to the table on the Steam Workshop: https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369") && runs === 0 && saves() === 0, row());
    fs.mkdirSync(path.dirname(ws), { recursive: true });
    fs.writeFileSync(ws, "{}");
    refuse = true;
    ok = await c.doSave();
    check("the patcher refuses the copy: red with its reason, nothing installed", !ok && row().light === Light.Red && row().text.includes("FAIL Draw") && runs === 1 && saves() === 0, row());
    refuse = false;
    ok = await c.doSave();
    check("the package's table from the Workshop copy: green, installed, made from the file found", ok && row().light === Light.Green && saves() === 1 && fs.readFileSync(path.join(c.savesDir, "TS_Save_1.json"), "utf8") === body && seen === ws, row());
    check("the table it made stays in the package's table folder", fs.readFileSync(c.L.tableJson, "utf8") === body);
    check("the package's deployed.json untouched while the table is the package's", JSON.parse(fs.readFileSync(c.L.deployedFile, "utf8")).table === "t1");
    body = '{"SaveName": "MTG Table (rules engine)", "v": 2}'; stamp = "t9";
    ok = await c.doSave();
    check("another Workshop copy (its author changed it): installed over our untouched save, amber, says both tables", ok && row().light === Light.Amber && row().text.includes("t9") && row().text.includes("t1") && fs.readFileSync(path.join(c.savesDir, "TS_Save_1.json"), "utf8") === body && saves() === 1, row());
    const dj = JSON.parse(fs.readFileSync(c.L.deployedFile, "utf8"));
    check("another Workshop copy: deployed.json says the host's table, the package's kept", dj.table === "t9" && dj.tablePackage === "t1" && dj.bridge === "b", dj);
    check("another Workshop copy: the TTS light expects the host's table", c.builtStamp === "t9");
    fs.unlinkSync(ws);
    ok = await c.doSave();
    check("the Workshop copy unsubscribed later: red again, the installed save left alone", !ok && row().light === Light.Red && fs.readFileSync(path.join(c.savesDir, "TS_Save_1.json"), "utf8") === body, row());
    // the real patcher path: the package's table/make-table.js missing is a red light, not an exception
    c.buildTable = null;
    fs.writeFileSync(ws, "{}");
    ok = await c.doSave();
    check("no table/make-table.js in the package: red, says to unpack again", !ok && row().light === Light.Red && row().text.includes("make-table.js is missing"), row());
  } catch (e) { check("Workshop table: no exception", false, e.stack); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// the real server on a free port: the guards and the API, as a browser and an attacker would talk to it
async function server() {
  section("status page: the server");
  const { WebUi, pageFromCs } = require("./web");
  const cs = path.join(__dirname, "..", "companion", "src", "WebPage.cs");
  const page = fs.existsSync(path.join(__dirname, "page.html")) ? fs.readFileSync(path.join(__dirname, "page.html"), "utf8") : fs.existsSync(cs) ? pageFromCs(fs.readFileSync(cs, "utf8")) : "<html><meta content='{{TOKEN}}'><script nonce='{{NONCE}}'></script></html>";
  const { c, tmp } = fakeController(false);
  const w = new WebUi(c, { page });
  try {
    if (!(await w.start(0))) { check("server: starts on a free port", false); return; }
    const host = `127.0.0.1:${w.port}`;
    const send = (raw) => new Promise((done) => {
      const s = net.connect(w.port, "127.0.0.1"); let got = "";
      s.on("data", (d) => { got += d.toString("utf8"); }); s.on("end", () => done(got)); s.on("error", () => done(got)); s.write(raw);
    });
    const req = (method, p, headers, body) => send(`${method} ${p} HTTP/1.1\r\n${Object.entries({ Host: host, ...headers }).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`).join("\r\n")}${body !== undefined ? `\r\nContent-Length: ${Buffer.byteLength(body)}` : ""}\r\n\r\n${body || ""}`);
    const status = (r) => Number((/^HTTP\/1\.1 (\d+)/.exec(r) || [])[1]);
    const json = (r) => { try { return JSON.parse(r.slice(r.indexOf("\r\n\r\n") + 4)); } catch { return null; } };
    check("the token: 32 hex characters", /^[0-9a-f]{32}$/.test(w.token));
    if (fs.existsSync(cs)) check("the page from WebPage.cs: no Windows-only 'MTG Companion.exe' left", !pageFromCs(fs.readFileSync(cs, "utf8")).includes(".exe") && pageFromCs(fs.readFileSync(cs, "utf8")).includes("start.sh"));
    let r = await req("GET", "/", {});
    check("GET / (no token needed): the page, with this run's token in it", status(r) === 200 && r.includes(w.token) && !r.includes("{{TOKEN}}"), r.slice(0, 200));
    const nonce = (/script-src 'nonce-([0-9a-f]+)'/.exec(r) || [])[1];
    check("the page: a CSP with a nonce the page's script carries", !!nonce && r.includes(`nonce='${nonce}'`));
    check("bad Host (DNS rebinding): 403, no page, no token", status(await req("GET", "/", { Host: `evil.com:${w.port}` })) === 403);
    check("Host 127.0.0.1:port or localhost:port: allowed", status(await req("GET", "/", { Host: `LOCALHOST:${w.port}` })) === 200);
    check("/api/status without the token: 403 bad-token", (json(await req("GET", "/api/status", {})) || {}).error === "bad-token");
    check("a token prefix: refused", status(await req("GET", "/api/status", { "X-MTG-Token": w.token.slice(0, 31) })) === 403);
    r = await req("GET", "/api/status", { "X-MTG-Token": w.token });
    const s = json(r);
    check("/api/status with the token: 200 JSON", status(r) === 200 && s && s.api === 1, r.slice(0, 300));
    check("status: six lights in step order, each with step, name, state, text, action", s && s.lights.length === 6 && s.lights.every((x, i) => x.step === i + 1 && x.name === L.Names[i] && "action" in x && ["green", "amber", "red", "grey"].includes(x.state)));
    check("status: the menu has no WSL item (Windows only)", s && s.menu.every((m) => m.id !== "wsl-limits") && s.menu.some((m) => m.id === "stop-everything"));
    check("a cross-origin Origin: 403 bad-origin", (json(await req("GET", "/api/status", { "X-MTG-Token": w.token, Origin: "http://evil.com" })) || {}).error === "bad-origin");
    check("Sec-Fetch-Site cross-site on the API: 403", status(await req("GET", "/api/status", { "X-MTG-Token": w.token, "Sec-Fetch-Site": "cross-site" })) === 403);
    check("POST as text/plain (a form or no-cors fetch): 415", status(await req("POST", "/api/action", { "X-MTG-Token": w.token, "Content-Type": "text/plain" }, '{"id":"open-logs"}')) === 415);
    check("POST an unknown id: 400", status(await req("POST", "/api/action", { "X-MTG-Token": w.token, "Content-Type": "application/json" }, '{"id":"rm-rf"}')) === 400);
    c.rows[2].v = verdict(Light.Red, "The engine isn't running.", { fix: Fixes.StackRestart, label: "Start the engine" });
    c.game = L.Game.on("Game on", 3);
    const st2 = json(await req("GET", "/api/status", { "X-MTG-Token": w.token }));
    check("status: a red light's button: id fix:2:stack-restart, locked during a game", st2.lights[2].action && st2.lights[2].action.id === "fix:2:stack-restart" && st2.lights[2].action.locked === true && st2.worst.text === "Problem: Engine stack", st2.lights[2]);
    r = json(await req("POST", "/api/action", { "X-MTG-Token": w.token, "Content-Type": "application/json" }, '{"id":"fix:2:stack-restart"}'));
    check("a locked fix pressed anyway: refused with the lock text, nothing queued", r && r.ok === false && r.message.includes("game is on") && c.work.length === 0, r);
    r = json(await req("POST", "/api/action", { "X-MTG-Token": w.token, "Content-Type": "application/json" }, '{"id":"fix:2:bridge-restart"}'));
    check("a button that changed: refused", r && r.ok === false && r.message.includes("changed"), r);
    r = json(await req("POST", "/api/action", { "X-MTG-Token": w.token, "Content-Type": "application/json" }, '{"id":"stop-everything"}'));
    check("Stop everything during a game: asks again first", r && r.ok === false && r.needConfirm === true, r);
    const rawStatus = await req("GET", "/api/status", { "X-MTG-Token": w.token }), rawPage = await req("GET", "/", {});
    check("answers: no-store, nosniff, frame DENY, no-referrer, Connection: close, no CORS header", [rawStatus, rawPage].every((x) => /\r\nCache-Control: no-store/i.test(x) && /\r\nX-Content-Type-Options: nosniff/i.test(x) && /\r\nX-Frame-Options: DENY/i.test(x) && /\r\nReferrer-Policy: no-referrer/i.test(x) && /\r\nConnection: close/i.test(x) && !/Access-Control/i.test(x)), rawStatus.slice(0, 400));
    r = json(await req("POST", "/api/tools", { "X-MTG-Token": w.token, "Content-Type": "application/json" }, '{"kind":"shell","cmd":"x"}'));
    check("tools: an unknown kind is refused, the bridge not asked", r && r.error === "bad-body", r);
  } catch (e) { check("server: no exception", false, e.stack); } finally { w.stop(); fs.rmSync(tmp, { recursive: true, force: true }); }
}

// the bridge's `docker` calls through shim/docker, with a fake engine CLI that prints what it was given
function shim() {
  section("the shim the bridge's docker calls go through");
  const sh = spawnSync("sh", ["-c", "echo ok"], { encoding: "utf8" });
  if (sh.status !== 0) { out.push("SKIP the shim checks: no sh here"); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-shim-"));
  try {
    const fake = path.join(tmp, "fakecli");
    fs.writeFileSync(fake, '#!/bin/sh\nif [ "$1" = "inspect" ]; then echo "0306d683de26e2d96747b6820914df61cc984c90e3343e9872504906a50ce7d1"; echo "sha256:58cf2e3da2511b13f1d6e796485e9d50568f1ba19c4c4a09230c522fc19375f5"; exit 0; fi\necho "$@"\n');
    fs.chmodSync(fake, 0o755);
    const shimFile = path.join(__dirname, "shim", "docker");
    const run = (...a) => spawnSync("sh", [shimFile, ...a], { encoding: "utf8", env: { ...process.env, MTG_CONTAINER_CLI: fake.replace(/\\/g, "/"), MTG_PROJECT: "mtg-table" } });
    let r = run("compose", "-f", "/p/stack/compose.yml", "restart", "-t", "3", "forge-room");
    check("compose restart -t 3 forge-room: the engine's restart of mtg-table-forge-room-1", r.status === 0 && r.stdout.trim() === "restart -t 3 mtg-table-forge-room-1", r.stdout + r.stderr);
    r = run("inspect", "-f", "{{.Image}}", "mtg-table-forge-room-1", "mtg-table-relay-1");
    check("inspect: Podman's bare ids get sha256:, Docker's are kept", r.status === 0 && r.stdout.trim().split(/\r?\n/).every((x) => x.startsWith("sha256:")) && r.stdout.trim().split(/\r?\n/).length === 2, r.stdout);
    r = run("compose", "up", "-d");
    check("other compose commands: refused with a reason", r.status !== 0 && r.stderr.includes("isn't supported"), r.stderr);
    r = spawnSync("sh", [shimFile, "ps"], { encoding: "utf8", env: { ...process.env, MTG_CONTAINER_CLI: "" } });
    check("no engine given: refused, says to start it from the companion", r.status !== 0 && r.stderr.includes("MTG Companion"));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

function ownServer() {
  section("own server (server.json, --server)");
  const set = (o, spec = null, envKey = null) => L.serverSetting(o === null ? null : typeof o === "string" ? o : JSON.stringify(o), spec, envKey);
  let r = set({ host: "Mtg.Example.org", key: "file-key" });
  check("server.json: host and key only: port 9443, ws://", r && r.ok && r.server.host === "mtg.example.org" && r.server.port === 9443 && L.serverUrl(r.server) === "ws://mtg.example.org:9443" && r.server.key === "file-key", r);
  r = set({ host: "mtg.example.org" });
  check("no key anywhere: refused, says to put the server's key in server.json (never this package's key)", r && !r.ok && r.noKey && r.problem.includes("no key for your server") && r.problem.includes("\"key\"") && r.problem.includes("MTG_SERVER_KEY"), r);
  check("no server.json and no --server: the engine runs here", set(null) === null);
  r = set({ host: "a.example.org", port: 9555, key: "file-key", secure: true }, "A.example.org.:7000", "env-key");
  check("--server host:port beats the file's host and port; for the file's own host its key and secure are kept", r && r.ok && r.server.host === "a.example.org." && r.server.port === 7000 && r.server.key === "file-key" && r.server.secure === true, r);
  r = set({ host: "a.example.org", port: 9555, key: "file-key", secure: true }, "b.example.org", "env-key");
  check("--server naming another host: the file's key, port and secure are dropped (MTG_SERVER_KEY, 9443, ws://)", r && r.ok && r.server.host === "b.example.org" && r.server.port === 9443 && r.server.key === "env-key" && r.server.secure === false, r);
  r = set({ host: "a.example.org", key: "file-key" }, "b.example.org:7000", null);
  check("--server naming another host, no MTG_SERVER_KEY: refused, says the file's key isn't sent to another server", r && !r.ok && r.noKey && r.problem.includes("isn't sent to another server") && !r.problem.includes("file-key"), r);
  r = set({ host: "a.example.org" }, null, "env-key");
  check("no key in server.json: MTG_SERVER_KEY is used", r && r.ok && r.server.key === "env-key", r);
  r = set({ host: "a.example.org", key: "file-key" }, null, "env-key");
  check("the file's key beats MTG_SERVER_KEY", r && r.ok && r.server.key === "file-key", r);
  r = set(null, "10.0.0.5", "env-key");
  check("--server with no port: 9443", r && r.ok && r.server.port === 9443 && r.server.host === "10.0.0.5", r);
  r = set({ host: "[2001:db8::5]", port: "9444", secure: true, key: "k" });
  check("secure: true is wss://, an IPv6 address in brackets, a port given as text", r && r.ok && L.serverUrl(r.server) === "wss://[2001:db8::5]:9444", r);
  r = set({ host: "ws://mtg.example.org:9443" });
  check("a ws:// in host is refused, saying to give the name only", r && !r.ok && r.problem.includes("without ws://"), r);
  r = set({ host: "mtg.example.org", hots: "x" });
  check("a misspelt setting is refused by name", r && !r.ok && r.problem.includes("\"hots\""), r);
  for (const bad of [0, 70000, "x", 9443.5]) {
    r = set({ host: "mtg.example.org", port: bad, key: "k" });
    check(`port ${JSON.stringify(bad)} is refused (1 to 65535)`, r && !r.ok && r.problem.includes("1 to 65535"), r);
  }
  r = set("{ host: oops");
  check("server.json that isn't JSON: refused, says how to write it or to delete it", r && !r.ok && r.problem.includes("isn't valid JSON") && r.problem.includes("delete it"), r);
  for (const v of ["false", "0", "null", "[]", "\"mtg.example.org\""]) {
    r = set(v);
    check(`server.json holding ${v}: an error, not the engine on this computer`, r !== null && !r.ok && r.problem.startsWith("server.json:"), r);
  }
  r = set("\uFEFF{ \"host\": \"mtg.example.org\", \"key\": \"k\" }");
  check("server.json with a UTF-8 BOM (Notepad's) is read", r && r.ok && r.server.host === "mtg.example.org", r);
  r = set({ host: "my_server.lan", key: "k" });
  check("a host with an underscore is a name", r && r.ok && r.server.host === "my_server.lan", r);
  r = set({ host: "mtg.example.org.", key: "k" });
  check("a host with a trailing dot is a name", r && r.ok && r.server.host === "mtg.example.org.", r);
  for (const bad of ["mtg..example.org", ".mtg.example.org", "mtg.example.org..", "-mtg.example.org"]) {
    r = set({ host: bad, key: "k" });
    check(`"${bad}" is still refused`, r && !r.ok && r.problem.includes("isn't a server name"), r);
  }
  check("same host: case and a trailing dot don't count", L.sameHost("A.example.org.", "a.example.org") && !L.sameHost("a.example.org", "b.example.org"));
  r = set({ host: "my server" });
  check("a host with a space is refused", r && !r.ok && r.problem.includes("isn't a server name"), r);
  r = set({ host: "mtg.example.org", key: "" });
  check("an empty key is refused", r && !r.ok && r.problem.includes("\"key\""), r);
  check("server.json readable by others (0644): said, with the mode", (L.serverFileModeProblem(0o100644) || "").includes("644"), L.serverFileModeProblem(0o100644));
  check("server.json readable by this account only (0600): nothing to say", L.serverFileModeProblem(0o100600) === null && L.serverFileModeProblem(0o100400) === null);

  const ok = set({ host: "mtg.example.org", port: 9443, key: "server-key" });
  const on = L.Game.on("a game is on");
  const d = (login, game = L.Game.none("no game")) => L.decideServer(ok, login, game);
  let v = d({ kind: "ok", roomFound: true, roomStatus: "Lobby", ms: 40 });
  check("connected, room open: green, names the server", v.light === Light.Green && v.text.includes("mtg.example.org:9443") && v.text.includes(L.Room), v);
  v = d({ kind: "refused", detail: "ECONNREFUSED" });
  check("refused: red, says nothing listens on the port, Try again", v.light === Light.Red && v.text.includes("nothing listens on port 9443") && v.fix === Fixes.Retry, v);
  v = d({ kind: "timeout", detail: "no connection" });
  check("timeout: red, says the firewall and the address", v.light === Light.Red && v.text.includes("firewall") && v.text.includes("server.json"), v);
  v = d({ kind: "closed", detail: "getaddrinfo ENOTFOUND" });
  check("unreachable (a name that doesn't resolve): red, the reason shown", v.light === Light.Red && v.text.includes("Can't reach your server") && v.text.includes("ENOTFOUND"), v);
  v = d({ kind: "authFailed", detail: "bad key" });
  check("refused key: red, says to put the server's key in server.json", v.light === Light.Red && v.text.includes("refused the key") && v.text.includes("\"key\""), v);
  v = d({ kind: "ok", roomFound: false });
  check("connected, no Forge room: red, says to start it on the server", v.light === Light.Red && v.text.includes("isn't open"), v);
  v = d({ kind: "ok", roomFound: true, roomStatus: "InGame" });
  check("a busy room on the server is red when no game is on here", v.light === Light.Red && v.text.includes("busy"), v);
  v = L.decideServer(ok, { kind: "ok", roomFound: true, roomStatus: "InGame" }, on);
  check("the room in our own game: green", v.light === Light.Green, v);
  v = L.decideServer(set({ host: "ws://x" }), null, null);
  check("a server.json problem is the engine light's red, Try again", v.light === Light.Red && v.text.startsWith("Own server: server.json:") && v.fix === Fixes.Retry, v);
  v = L.decideServer(set({ host: "mtg.example.org" }), null, null);
  check("no key: the engine light's red says so", v.light === Light.Red && v.text.includes("no key for your server"), v);
  // the server's engine build against the table's (the owner's decision 2026-11-17: warn when they differ)
  const open = { kind: "ok", roomFound: true, roomStatus: "Lobby", ms: 40 };
  v = L.decideServer(ok, { ...open, engineBuild: "engine1121" }, L.Game.none("no game"), "engine1121");
  check("engine build: the same as the table's: green", v.light === Light.Green && v.text.includes("is open"), v);
  v = L.decideServer(ok, { ...open, engineBuild: "engine1120" }, L.Game.none("no game"), "engine1121");
  check("engine build: another than the table's: amber, names both", v.light === Light.Amber && v.text.includes("engine1120") && v.text.includes("engine1121") && v.text.includes("ask the host"), v);
  v = L.decideServer(ok, { kind: "ok", roomFound: true, roomStatus: "InGame", engineBuild: "engine1120" }, on, "engine1121");
  check("engine build: another during our own game: amber too", v.light === Light.Amber, v);
  v = L.decideServer(ok, { ...open, engineBuild: null }, L.Game.none("no game"), "engine1121");
  check("engine build: a server too old to say: green, no warning", v.light === Light.Green, v);
  v = L.decideServer(ok, { ...open, engineBuild: "engine1121" }, L.Game.none("no game"), null);
  check("engine build: a deploy too old to say: green, no warning", v.light === Light.Green, v);
  const rows = [L.serverNotNeeded(ok.server).light, L.serverNotNeeded(ok.server).light, Light.Green, Light.Grey, Light.Green];
  check("steps 1-2 green with a server (engine up)", L.engineUp(rows), rows);

  // the running bridge's engine (GET /versions relay, remoteEngine)
  const vers = (o) => L.httpOk(JSON.stringify({ now: { bridge: "b1" }, ...o }));
  const local = vers({ relay: "ws://127.0.0.1:9443", remoteEngine: false }), theirs = vers({ relay: "ws://mtg.example.org:9443", remoteEngine: true });
  v = L.decideBridge(local, null, true, "b1", true, ok.server);
  check("own server, the bridge still runs for the engine here: amber, restarted (RestartBridge)", v.light === Light.Amber && v.action === L.Actions.RestartBridge && v.fix === Fixes.BridgeRestart && v.text.includes("ws://127.0.0.1:9443"), v);
  v = L.decideBridge(theirs, null, true, "b1", true, ok.server);
  check("own server, the bridge runs for it: green", v.light === Light.Green, v);
  v = L.decideBridge(vers({ relay: "ws://other.example.org:9443", remoteEngine: true }), null, true, "b1", true, ok.server);
  check("own server, the bridge runs for another server: restarted", v.action === L.Actions.RestartBridge, v);
  v = L.decideBridge(vers({}), null, true, "b1", true, ok.server);
  check("own server, a bridge that doesn't say its relay: restarted (it can't be told apart)", v.action === L.Actions.RestartBridge && v.text.includes("doesn't say"), v);
  v = L.decideBridge(theirs, null, true, "b1", true, null);
  check("no server, the bridge runs for a server: restarted", v.action === L.Actions.RestartBridge, v);
  v = L.decideBridge(vers({}), null, true, "b1", true, null);
  check("no server, an older bridge that doesn't say: kept (green)", v.light === Light.Green, v);
}

async function serverWiring() {
  section("own server wiring (Controller: no container engine, a login to the server, the bridge's relay)");
  const probes = require("./probes");
  const real = probes.relayLogin, realReach = probes.tcpReach, realGet = probes.httpGet;
  const logins = [];
  probes.tcpReach = async () => ({ kind: "ok", detail: null });
  probes.relayLogin = async (url, key, room, ms) => { logins.push({ url, key, ms }); return { kind: "ok", roomFound: true, roomStatus: "Lobby", ms: 5 }; };
  const { c, tmp } = fakeController(false);
  const envHad = { MTG_KEY: process.env.MTG_KEY, MTG_SERVER_KEY: process.env.MTG_SERVER_KEY };
  try {
    let engineCalls = 0, downs = 0;
    c.engine = { o: {}, cli: "docker", detect: async () => { engineCalls++; return { answers: true }; }, bridgeEnv: () => { engineCalls++; return { MTG_CONTAINER_CLI: "docker" }; }, up: async () => { engineCalls++; return { code: 0 }; }, down: async () => { engineCalls++; downs++; }, stop: async () => { engineCalls++; downs++; } };
    c.server = L.serverSetting(JSON.stringify({ host: "mtg.example.org", port: 9555, key: "server-key" }), null, null);
    c.onlySteps = new Set([1, 2, 3]);
    await c.runSequence(1);
    check("own server: steps 1-2 not needed (green), nothing asked of the container engine", c.rows[L.Step.Docker].v.light === Light.Green && c.rows[L.Step.Images].v.light === Light.Green && engineCalls === 0, `${engineCalls} ${L.vText(c.rows[0].v)}`);
    check("own server: the engine step logs in to the server with its key", logins.length === 1 && logins[0].url === "ws://mtg.example.org:9555" && logins[0].key === "server-key" && c.rows[L.Step.Stack].v.light === Light.Green, logins);
    process.env.MTG_KEY = "stray-key"; process.env.MTG_SERVER_KEY = "server-key";
    const env = c.bridgeLaunchEnv();
    const keyFile = env.MTG_KEY_FILE;
    let fileKey = null, mode = null;
    try { fileKey = fs.readFileSync(keyFile, "utf8"); mode = fs.statSync(keyFile).mode & 0o777; } catch { /* none */ }
    check("own server: the bridge gets the server's relay and a key file (MTG_RELAY, MTG_REMOTE_ENGINE, MTG_KEY_FILE)", env.MTG_RELAY === "ws://mtg.example.org:9555" && env.MTG_REMOTE_ENGINE === "1" && fileKey === "server-key" && typeof keyFile === "string" && path.dirname(keyFile) === c.stateDir, { env: { MTG_RELAY: env.MTG_RELAY, MTG_KEY_FILE: keyFile }, fileKey });
    check("own server: the key is in none of the bridge's environment (MTG_KEY and MTG_SERVER_KEY dropped)", !Object.values(env).some((x) => String(x).includes("server-key") || String(x).includes("stray-key")) && !("MTG_KEY" in env), Object.keys(env).filter((k) => /KEY/.test(k)));
    check("own server: the key file is readable by this account only (0600)", process.platform === "win32" || mode === 0o600, mode === null ? "no file" : mode.toString(8));
    check("own server: the container engine isn't asked for the bridge's settings", engineCalls === 0, engineCalls);
    c.stopBridge = async () => {};
    c.stopEverything(null);
    await c.workOnce(async () => {});
    check("own server: Stop everything stops the bridge only, never the server's engine", engineCalls === 0 && c.everythingStopped, engineCalls);
    check("own server: Stop everything removes the key file", typeof keyFile === "string" && !fs.existsSync(keyFile));
    let watchError = null;
    try { await c.monitorTick(); } catch (e) { watchError = e.message; }
    check("own server: the watcher asks no container engine either", !watchError && engineCalls === 0 && c.rows[L.Step.Docker].v.light === Light.Green, watchError || engineCalls);

    // a bridge left running for the engine on this computer: restarted for the server (once), never during a game
    const bodies = [];
    let stops = 0;
    c.stopBridge = async () => { stops++; };
    c.startBridge = () => { bodies.push("started"); };
    let answer = () => ({ relay: "ws://127.0.0.1:9443", remoteEngine: false });
    probes.httpGet = async (url) => (url.endsWith("/versions") ? (stops > 0 && bodies.length === 0 ? L.httpOf("refused")
      : L.httpOk(JSON.stringify({ now: { bridge: null }, ...(stops > 0 ? { relay: "ws://mtg.example.org:9555", remoteEngine: true } : answer()) }))) : L.httpOf("refused"));
    c.bridgeProcessExists = async () => false;
    let ok = await c.doBridge();
    check("own server: a bridge running for the engine here is stopped and started again for the server", ok && stops === 1 && bodies.length === 1 && c.rows[L.Step.Bridge].v.light === Light.Green, { stops, bodies, v: L.vText(c.rows[L.Step.Bridge].v) });
    stops = 0; bodies.length = 0;
    const realRefresh = c.refreshGame;
    c.refreshGame = async () => { c.game = L.Game.on("Game on: turn 3."); };
    ok = await c.doBridge();
    check("own server: during a game that bridge is left alone (amber, restart after the game)", stops === 0 && c.rows[L.Step.Bridge].v.light === Light.Amber && c.rows[L.Step.Bridge].v.text.includes("Locked"), { stops, v: L.vText(c.rows[L.Step.Bridge].v) });
    c.refreshGame = realRefresh;
    probes.httpGet = realGet;

    // a server.json with a problem is no server for stopping: the engine here is stopped
    c.server = L.serverSetting("{ \"host\": \"ws://x\" }", null, null);
    c.stopBridge = async () => {};
    engineCalls = 0; downs = 0;
    c.stopEverything(null);
    await c.workOnce(async () => {});
    check("server.json with a problem: Stop everything stops the engine on this computer", downs === 1, { engineCalls, downs });
    c.server = L.serverSetting("{ \"host\": \"mtg.example.org\" }", null, null);
    logins.length = 0;
    await c.runSequence(3);
    check("own server with no key: the engine light is red, and no login is tried (this package's key never goes out)", logins.length === 0 && c.rows[L.Step.Stack].v.light === Light.Red && c.rows[L.Step.Stack].v.text.includes("no key"), { logins, v: L.vText(c.rows[L.Step.Stack].v) });
    c.server = null;
    fs.mkdirSync(c.stateDir, { recursive: true });
    fs.writeFileSync(c.keyFile(), "left-over");
    const env2 = c.bridgeLaunchEnv();
    check("no server: the bridge gets no relay or key file setting (the engine here), and an old key file is removed", !("MTG_RELAY" in env2) && !("MTG_KEY_FILE" in env2) && !("MTG_REMOTE_ENGINE" in env2) && !fs.existsSync(c.keyFile()), Object.keys(env2).filter((k) => k.startsWith("MTG_")));
  } finally {
    probes.relayLogin = real; probes.tcpReach = realReach; probes.httpGet = realGet;
    for (const [k, v] of Object.entries(envHad)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main(outFile) {
  out = []; fails = 0; passes = 0;
  modes(); sequence(); docker(); images(); stack(); ports(); bridge(); gameLock(); saves(); tts(); misc(); update();
  startEngineRules(); ownServer();
  await parser(); await wiring(); await launchStartsNothing(); await watcherBeforeStart(); await saveFiles(); await workshopTable(); await server(); await notStartedStatus();
  try { await serverWiring(); } catch (e) { check("own server wiring: ran to the end", false, e.stack || e.message); }
  shim();
  out.push(`${passes} passed, ${fails} failed`);
  const text = `${out.join("\n")}\n`;
  if (outFile) fs.writeFileSync(outFile, text); else process.stdout.write(text);
  return fails;
}

module.exports = { main };
if (require.main === module) main(process.argv[2] === "--out" ? process.argv[3] : null).then((f) => process.exit(f));
