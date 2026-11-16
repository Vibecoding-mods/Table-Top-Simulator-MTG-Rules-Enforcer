#!/usr/bin/env node
// MTG Companion for Linux (Steam Deck) and macOS: the Windows app's start sequence, watcher and status page, in plain
// Node (no packages). Started by start.sh / "MTG Companion.command" with the Node in runtime/node, or from the repo:
//   node companion-node/companion.js          checks everything (starts nothing), then watches; the status page's
//                                             Start engine button starts it (since 2026-11-14, as the Windows app)
// Flags (the Windows app's, where they apply):
//   --start                 start everything at launch, then watch (what every launch did before 2026-11-14);
//                           --after-update / --apply-update (the Windows app's self-update restart) imply it
//   --observe               reads and shows only: no start, no fix, no update, no single-instance lock (beats --start)
//   --dump FILE             with --observe: write the lights after one pass and exit
//   --no-web, --web-port N, --no-browser     the status page (default 127.0.0.1:48790)
//   --home DIR, --saves DIR, --state DIR, --log FILE, --bridge-url URL, --steps 4,5   overrides (tests)
//   --runtime docker|podman  the container engine (default: Docker if it answers, else Podman)
//   --server HOST[:PORT]     own server: the engine runs there, not here (as server.json in the package folder, which
//                            also holds the key; for another host than the file's, the key comes from MTG_SERVER_KEY;
//                            HOW-TO-PLAY.md "Own server"); nothing is started or stopped here
//   --selftest [--out FILE]  the decision logic against canned inputs; exit code = failures (any OS)
//   --bridge-loop --home DIR internal: the detached process that runs and restarts the bridge
//   --stop                   stops this package's bridge and engine containers (stop.sh), then exits
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };

if (flag("selftest")) {
  require("./selftest").main(opt("out")).then((fails) => process.exit(fails));
} else main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });

async function main() {
  if (process.platform !== "linux" && process.platform !== "darwin") {
    console.error("This is the Linux and macOS companion. On Windows, run MTG Companion.exe. (--selftest runs anywhere.)");
    process.exit(2);
  }
  const L = require("./mods").logic(), P = require("./mods").platform();
  const probes = require("./probes");
  const { Controller, Log } = require("./controller");
  const { Engine } = require("./engine");

  const appDir = path.dirname(__dirname); // (the package root, or the repo: the companion lives one folder below it)
  const layout = L.detectLayout(appDir, probes.exists, opt("home") ? path.resolve(opt("home")) : null);
  if (!layout) { console.error(`No MTG package here: no version.json in ${appDir}, and not inside the repo. Unpack the whole package and start it again.`); process.exit(2); }
  const override = opt("runtime") || process.env.MTG_CONTAINER_RUNTIME || null;
  const engine = new Engine({ project: layout.project, platform: process.platform, arch: process.arch, override, log: (l) => Log.write(l), key: () => controller.relayKey });

  // ── the bridge loop (its own detached process)
  if (flag("bridge-loop")) {
    Log.file = layout.companionLog;
    const env = layout.friend ? { MTG_HOME: layout.home, MTG_LOG_DIR: layout.logsDir } : {};
    env.PATH = `${path.join(__dirname, "shim")}:${process.env.PATH || ""}`;
    // (own server, MTG_REMOTE_ENGINE: no container engine here to find, and the bridge touches none)
    if (!process.env.MTG_CONTAINER_CLI && process.env.MTG_REMOTE_ENGINE !== "1") { await engine.detect(); Object.assign(env, engine.bridgeEnv()); }
    if (!env.MTG_PROJECT) env.MTG_PROJECT = layout.project;
    const nodeExe = layout.friend && probes.exists(layout.nodeExe) ? layout.nodeExe : process.execPath;
    const r = require("./bridge-loop").run(layout, nodeExe, env);
    if (r === 0) process.exit(0);
    return;
  }

  const home = os.homedir();
  // (looked for again at each save step: TTS may be run for the first time while the companion waits)
  const findSaves = () => (opt("saves") ? { dir: path.resolve(opt("saves")), found: true, tried: [] } : P.savesDirFor(process.platform, home, probes.exists, process.env, probes.readText));
  const stateDir = opt("state") ? path.resolve(opt("state")) : P.stateDirFor(process.platform, home, process.env);
  Log.file = opt("log") ? path.resolve(opt("log")) : layout.companionLog;
  const observe = flag("observe");
  // (the Workshop table: beside Saves, wherever TTS keeps them, then in the game's own folder of each Steam library)
  const workshopCandidates = (savesDir, id) => P.workshopCandidates(process.platform, savesDir, id, opt("saves") ? null : home, process.env, probes.readText);
  // (own server: server.json in the package, or --server; null runs the engine on this computer)
  const server = L.serverSetting(probes.exists(layout.serverFile) ? probes.readText(layout.serverFile) : null, opt("server"), process.env.MTG_SERVER_KEY);
  // (server.json holds the server's key: made private when others could read it, or said, when that can't be done)
  if (probes.exists(layout.serverFile) && process.platform !== "win32") {
    let mode = null;
    try { mode = fs.statSync(layout.serverFile).mode; } catch { /* gone */ }
    const open = L.serverFileModeProblem(mode);
    if (open) {
      let fixed = false;
      try { fs.chmodSync(layout.serverFile, 0o600); fixed = L.serverFileModeProblem(fs.statSync(layout.serverFile).mode) === null; } catch { /* not ours to change */ }
      const said = fixed ? `${open}: made readable by you only (chmod 600).` : `${open}. Make it private: chmod 600 "${layout.serverFile}"`;
      console.log(said); Log.write(said);
    }
  }
  const controller = new Controller({ layout, observe, server, autoStart: !observe && L.autoStart(args), findSaves, workshopCandidates, stateDir, appDir: __dirname, platform: process.platform, arch: process.arch, engine, bridgeUrl: opt("bridge-url") || undefined });
  if (opt("steps")) controller.onlySteps = new Set(opt("steps").split(",").map(Number));

  if (flag("stop")) {
    // (as the status page's Stop everything, which asks again during a game: here --force is the second answer)
    await controller.refreshGame();
    const no = L.stopRefusal(controller.game, flag("force"), process.platform === "darwin" ? "./\"Stop MTG.command\" --force" : "./stop.sh --force");
    if (no) { console.log(no); process.exit(3); }
    console.log("Stopping the bridge and the engine containers (the container engine and TTS keep running)...");
    await controller.stopBridge();
    controller.removeKeyFile();
    // (a server.json with a problem counts as no server: the engine running may be this computer's, so it is stopped)
    const remote = !!(server && server.ok);
    if (server && !server.ok) console.log(`Own server: ${server.problem} Stopping the engine on this computer, as without a server.`);
    const f = remote ? null : await engine.detect();
    if (remote) console.log(`Own server (${L.serverWords(server.server)}): its engine was left running.`);
    else if (f.answers) await (layout.friend ? engine.down() : engine.stop());
    else console.log("The container engine isn't answering: its containers were left as they are.");
    console.log("Stopped.");
    process.exit(0);
  }

  // ── one companion per package: a second start opens the first one's page
  const lockFile = path.join(stateDir, `running-${L.sha8(layout.home)}.json`);
  if (!observe) {
    // (the file's pid counts only while it is still a companion whose page answers: after a reboot the number can
    // belong to anything, and a stale file must not make every start say "already running")
    const lk = L.parseJson(probes.readText(lockFile));
    const ours = lk && Number.isInteger(lk.pid) && lk.pid !== process.pid && typeof lk.url === "string" && /^http:\/\/127\.0\.0\.1:\d+\/$/.test(lk.url)
      && probes.alive(lk.pid) && P.isCompanionCmd(probes.commandOf(lk.pid));
    if (ours && (await probes.httpGet(lk.url, 3000)).status === 200) {
      console.log(`MTG Companion is already running: ${lk.url}`);
      const [cmd, a] = P.openCommand(process.platform, lk.url);
      probes.launch(cmd, a);
      process.exit(0);
    }
  }

  let updater = null;
  if (layout.friend && !observe) {
    const { Updater } = require("./update");
    const keysFile = [path.join(__dirname, "release-keys.txt"), path.join(appDir, "companion", "release-keys.txt")].find((f) => probes.exists(f));
    updater = new Updater({ controller, stateDir, keysFile });
  }

  const { WebUi, loadPage, openAtStart, openAfterFirstPass } = require("./web");
  let web = null;
  const openBrowser = () => {
    if (!web) return false;
    const [cmd, a] = P.openCommand(process.platform, web.url);
    const ok = probes.launch(cmd, a);
    Log.write(ok ? `status page opened in the browser: ${web.url}` : `status page: the browser didn't open (${cmd})`);
    return ok;
  };
  if (!flag("no-web")) {
    web = new WebUi(controller, { page: loadPage(__dirname), updater, version: `node ${process.version}` });
    const p = Number(opt("web-port"));
    if (!(await web.start(Number.isInteger(p) && p >= 0 && p < 65536 && opt("web-port") !== null ? p : 48790))) web = null;
  }
  if (web && !observe) { try { probes.writeJsonAtomic(lockFile, { pid: process.pid, url: web.url, home: layout.home }); } catch { /* only for a second start */ } }

  const bye = async () => {
    try { if (Number(L.get(L.parseJson(probes.readText(lockFile)), "pid")) === process.pid) fs.unlinkSync(lockFile); } catch { /* gone */ }
    if (web) web.stop();
    await controller.stop();
    process.exit(0);
  };
  process.on("SIGINT", bye); process.on("SIGTERM", bye); process.on("SIGHUP", bye);

  console.log(`MTG Companion (${layout.mode} mode, ${process.platform}) for ${layout.home}`);
  if (server) console.log(server.ok ? `Own server: the engine runs on ${L.serverWords(server.server)}${server.server.secure ? " (wss)" : ""}; nothing is started here but the bridge.` : `Own server: ${server.problem}`);
  console.log(web ? `Status page: ${web.url}  (open it in a browser on this computer)` : "Status page: off");
  console.log("Closing this window stops the companion only; the engine and the bridge keep running. To stop them: stop.sh, or Stop everything on the status page.");
  console.log(`Log: ${Log.file}`);

  controller.start();
  if (updater && updater.checkDue()) {
    const wait = setInterval(() => { if (controller.firstPassDone) { clearInterval(wait); updater.checkInBackground(); } }, 500);
  }

  // the page opens by itself on the first start of a package, later when the first pass ends with a red light or with
  // nothing started (launch only checks: the page is where Start engine is)
  if (web && !flag("no-browser")) {
    if (openAtStart(layout.friend, observe, controller.statusPageShownBefore())) { if (openBrowser()) controller.markStatusPageShown(); }
    else {
      const t0 = Date.now();
      const w = setInterval(() => {
        if (!controller.firstPassDone && Date.now() - t0 < 600000) return;
        clearInterval(w);
        if (controller.firstPassDone && openAfterFirstPass(observe, controller.rows.map((r) => r.v.light), controller.needsStart)) openBrowser();
      }, 500);
    }
  }

  if (opt("dump")) {
    const w = setInterval(() => {
      if (!controller.firstPassDone) return;
      clearInterval(w);
      fs.writeFileSync(path.resolve(opt("dump")), controller.dump());
      bye();
    }, 300);
  }
}
