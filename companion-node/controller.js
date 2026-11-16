// The start sequence (6 steps, one light each), the watcher that keeps the lights current afterwards, and the actions
// behind the fix buttons and the menu: a port of the Windows app's companion/src/Controller.cs. One worker loop (async,
// one thing at a time), so two actions never overlap. Nothing that restarts or changes the engine runs while a game
// is on, or while the app can't tell (logic.locked).
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./mods").logic();
const P = require("./mods").platform();
const probes = require("./probes");
const bridgeLoop = require("./bridge-loop");

const { Light, verdict, Fixes, Actions, Step, Names } = L;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// companion.log (5 MB, then .1)
const Log = {
  file: null,
  write(line) {
    if (!Log.file) return;
    try {
      try { if (fs.statSync(Log.file).size > 5 * 1024 * 1024) { try { fs.unlinkSync(`${Log.file}.1`); } catch { /* none */ } fs.renameSync(Log.file, `${Log.file}.1`); } } catch { /* new */ }
      fs.mkdirSync(path.dirname(Log.file), { recursive: true });
      const d = new Date(), two = (n) => String(n).padStart(2, "0");
      fs.appendFileSync(Log.file, `[${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}] ${line}\n`);
    } catch { /* a log line is never worth a crash */ }
  },
};
const hhmmss = (d) => d.toTimeString().slice(0, 8);

class Controller {
  // o: { layout, observe, findSaves (() => platform.savesDirFor's { dir, found, tried }) or savesDir (a fixed folder,
  //      tests), stateDir, appDir (the companion's folder), platform, arch, engine, bridgeUrl, runtimeOverride }
  constructor(o) {
    this.L = o.layout; this.observe = !!o.observe; this.findSaves = o.findSaves || (() => ({ dir: o.savesDir, found: true, tried: [] })); this.savesDir = this.findSaves().dir; this.stateDir = o.stateDir;
    this.appDir = o.appDir; this.platform = o.platform; this.arch = o.arch;
    this.bridgeUrl = o.bridgeUrl || "http://127.0.0.1:48787";
    this.engine = o.engine;
    // own server (logic.serverSetting): null runs the engine here; else steps 1-2 are not needed and step 3 is a login
    this.server = o.server || null;
    // the Workshop table: where to look ((savesDir, id) => [files]; default: Mods/Workshop beside Saves only), and the
    // patcher ((workshop, out) => make-table.js's result; default: the package's own, run by its Node). Tests: fakes.
    this.workshopCandidates = o.workshopCandidates || ((savesDir, id) => [path.join(path.dirname(savesDir), "Mods", "Workshop", `${id}.json`)]);
    this.buildTable = o.buildTable || null;
    this.builtStamp = null; // (the table stamp this host's Workshop copy made, when that isn't the package's: the TTS light expects it)
    this.rows = Names.map((n) => ({ name: n, v: verdict(Light.Grey, "Not checked yet."), at: null }));
    this.game = L.Game.cantTell("Not checked yet.");
    this.phase = "Starting";
    this.versionText = "";
    this.listeners = []; this.notify = null;
    this.firstPassDone = false; this.windowVisible = true; this.onlySteps = null;
    this.work = []; this.quit = false; this.cancel = false; this.wakeUp = null;
    this.pendingFrom = 0; this.resumeFrom = 0; this.stoppedAt = 0;
    // Launch only checks: the worker's first turn is one read-only pass of the six steps (checkPending), and nothing
    // starts until Start engine (or a fix button) asks; autoStart (--start) runs the start sequence at launch instead.
    // engineStarted: a start sequence ran (or the check found the engine already up); until then, parts that are only
    // not running yet are grey and point at Start engine (logic.beforeStart).
    this.autoStart = !!o.autoStart; this.checkPending = true; this.checking = false; this.engineStarted = false;
    this.busyLogged = new Map(); this.notified = new Map();
    this.forceFresh = false; this.forceLoad = false; this.everythingStopped = false; this.ttsLaunched = false;
    this.versionsCache = null; this.versionsAt = 0; this.loginAt = 0; this.imagesAt = 0; this.loginCache = null;
    this.update = { status: "idle", current: null, available: null, notes: null, progress: -1, deferred: false, later: false, error: null, lastCheck: null, text: "" };
    this.updateBusy = false;
    this.reloadPackage();
    if (!this.L.friend) this.rows[Step.Save].v = verdict(Light.Grey, `Home mode: you keep your own save (${this.saveName}).`);
  }

  // the package's files: at start (and after an update replaced them)
  reloadPackage() {
    const l = this.L;
    this.version = l.friend ? L.parseJson(probes.readText(l.versionFile)) : null;
    this.deployed = L.parseJson(probes.readText(l.deployedFile));
    this.relayKey = P.engineKey(process.env.MANABREW_SERVER_KEY, L.relayKey(probes.readText(l.envFile)));
    this.saveName = l.friend ? (L.readSaveName(probes.readHead(l.tableJson, 8192)) || L.DefaultSaveName) : "Mock MTGA 4 player";
    if (l.friend) l.imagesTar = L.findImagesTar(l.home, probes.exists, (d) => { try { return fs.readdirSync(d).map((f) => path.posix.join(d, f)); } catch { return []; } });
    const v = this.version, d = this.deployed;
    if (v) this.versionText = `Package ${L.str(v, "release") || `built ${L.str(v, "built") || "?"}`}, commit ${L.str(v, "gitCommit") || "?"}, table ${L.str(v, "table") || "?"}, bridge ${L.str(v, "bridge") || "?"}`;
    else if (d) this.versionText = `Home mode, deployed table ${L.str(d, "table") || "?"}, bridge ${L.str(d, "bridge") || "?"}`;
    this.update.current = this.versionShort();
  }

  versionShort() {
    if (!this.version) return this.L.friend ? "Package version unknown" : "Home mode";
    const b = L.str(this.version, "built");
    return `Version ${L.str(this.version, "release") || `built ${b && b.length >= 10 ? b.slice(0, 10) : "?"}`}`;
  }
  get dryRun() { return this.observe || this.checking; } // (observe mode, or the launch check: read only)
  want(key) { return L.str(this.L.friend ? this.version : this.deployed, key); }

  // ───────────────────────────── the worker ─────────────────────────────

  start() {
    Log.write(`start: ${this.L.mode} mode, home ${this.L.home}${this.observe ? " (observe only: no changes)" : ""}; ${this.platform}/${this.arch}; saves ${this.savesDir}`);
    if (this.L.friend) Log.write(`package: ${JSON.stringify(this.version)}`);
    if (this.server) Log.write(this.server.ok ? `own server: ${L.serverWords(this.server.server)}${this.server.server.secure ? " (wss)" : ""}, ${this.server.server.key ? "its key from server.json or MTG_SERVER_KEY" : "this package's key"}` : `own server: ${this.server.problem}`);
    if (!this.observe) Log.write(this.autoStart ? "launch: --start: running the start sequence" : "launch: checking only; Start engine starts the engine");
    this.loopDone = this.loop();
  }

  async loop() {
    while (!this.quit) {
      let ran = false;
      try { ran = await this.workOnce(() => this.monitorTick()); } catch (e) { Log.write(`worker failed: ${e.stack || e}`); }
      if (!ran && !this.quit) await this.wait(this.windowVisible ? 5000 : 15000);
    }
  }

  wait(ms) { return new Promise((r) => { const t = setTimeout(() => { this.wakeUp = null; r(); }, ms); this.wakeUp = () => { clearTimeout(t); this.wakeUp = null; r(); }; }); }
  wake() { if (this.wakeUp) this.wakeUp(); }
  nudge() { this.wake(); }
  async stop() { this.quit = true; this.cancel = true; this.wake(); if (this.loopDone) await Promise.race([this.loopDone, sleep(3000)]); }

  enqueue(a) { this.work.push(a); this.cancel = true; this.wake(); }

  // One turn: a queued press, else a queued start-sequence run, else the watcher and the carry-on check. true: it ran
  // a press or a run (go round again at once); false: it watched.
  async workOnce(watch) {
    const a = this.work.shift();
    if (a) {
      this.cancel = false;
      await this.safe(a, "action");
      // a press that interrupted the start sequence: carry on from that step, unless the press restarted or stopped it
      if (this.pendingFrom === 0 && this.resumeFrom > 0 && !this.everythingStopped) this.pendingFrom = this.resumeFrom;
      this.resumeFrom = 0;
      return true;
    }
    if (this.checkPending && this.autoStart && !this.observe) { this.checkPending = false; this.pendingFrom = 1; } // (--start: the launch runs the start sequence)
    if (this.pendingFrom > 0) {
      this.checkPending = false; // (a start before the launch check ran: the run is the check)
      const from = this.startAt(this.pendingFrom); this.pendingFrom = 0; this.cancel = false;
      await this.safe(() => this.runSequence(from), "start sequence");
      this.firstPassDone = true;
      this.fire();
      return true;
    }
    if (this.checkPending) {
      this.checkPending = false; this.cancel = false;
      await this.checkPass();
      this.firstPassDone = true;
      this.fire();
      return true;
    }
    if (!this.everythingStopped) { await this.safe(watch, "watch"); this.resumeIfGreen(); }
    this.firstPassDone = true;
    return false;
  }

  async safe(f, what) { try { await f(); } catch (e) { Log.write(`${what} failed: ${e.stack || e}`); } }

  // waits, but wakes for a new action or quit; false when the wait was cut short
  async pause(ms) {
    const until = Date.now() + ms;
    while (Date.now() < until) { if (this.quit || this.cancel) return false; await sleep(Math.min(200, until - Date.now())); }
    return !(this.quit || this.cancel);
  }

  stepGreen(step) { return step > 0 && step <= this.rows.length && this.rows[step - 1].v.light === Light.Green; }
  startAt(requested) { return L.startFrom(requested, this.stoppedAt, this.stepGreen(this.stoppedAt)); }
  resumeIfGreen() {
    const resume = L.resumeAfterStop(this.stoppedAt, this.stepGreen(this.stoppedAt), this.observe);
    if (resume === 0 || this.pendingFrom !== 0) return;
    Log.write(`step ${this.stoppedAt} (${Names[this.stoppedAt - 1]}) is green now: carrying on from step ${resume}`);
    this.pendingFrom = resume; this.wake();
  }

  onChanged(f) { this.listeners.push(f); return () => { this.listeners = this.listeners.filter((x) => x !== f); }; }
  fire() { for (const f of this.listeners.slice()) { try { f(); } catch { /* a listener's problem */ } } }

  set(i, v) {
    const row = this.rows[i];
    const changed = !row.v || row.v.light !== v.light || row.v.text !== v.text || row.v.fix !== v.fix;
    row.v = v; row.at = new Date();
    if (!changed) return;
    // (a progress line every second would flood the log: busy text changes go in at most every 15 s)
    const last = this.busyLogged.get(i);
    const progress = v.light === Light.Busy && last && Date.now() - last < 15000;
    if (!progress) { Log.write(`light ${row.name}: ${L.vText(v)}`); if (v.light === Light.Busy) this.busyLogged.set(i, Date.now()); else this.busyLogged.delete(i); }
    if (v.light === Light.Red && !this.observe) {
      const n = this.notified.get(i);
      if (!n || Date.now() - n > 10 * 60000) { this.notified.set(i, Date.now()); if (this.notify) try { this.notify(`MTG: ${row.name}`, v.text); } catch { /* only a note */ } }
    }
    this.fire();
  }

  setPhase(p) { if (this.phase !== p) { this.phase = p; Log.write(`phase: ${p}`); this.fire(); } }

  // ───────────────────────────── game lock ─────────────────────────────

  async refreshGame() {
    const st = await probes.httpGet(`${this.bridgeUrl}/state`, 5000);
    let age = null;
    for (const f of this.L.resumeFiles) {
      try { const a = (Date.now() - fs.statSync(f).mtimeMs) / 1000; if (age === null || a < age) age = a; } catch { /* none */ }
    }
    const g = L.decideGame(st, age);
    const changed = !this.game || this.game.kind !== g.kind || this.game.text !== g.text;
    this.game = g;
    if (changed) { Log.write(`game: ${g.kind}: ${g.text}`); this.fire(); }
  }
  get isLocked() { return L.locked(this.game); }

  // ───────────────────────────── the start sequence ─────────────────────────────

  // the launch's check: the six steps read only (each do* treats it as observe mode, with Start engine's words);
  // nothing is started, loaded, installed or opened
  async checkPass() {
    this.checking = !this.observe;
    try { await this.safe(() => this.runSequence(1), "check"); } finally { this.checking = false; }
  }

  // the Start engine button: the start sequence from step 1, as every launch ran it before (2026-11-14)
  startEngine() {
    if (this.observe) return "Observe mode: nothing is changed.";
    Log.write("button: start engine");
    this.enqueue(() => { this.everythingStopped = false; this.pendingFrom = 1; });
    return null;
  }

  // nothing has been started yet (launch only checked, or Stop everything ran) and no start is queued: the page points
  // at Start engine
  get needsStart() { return !this.observe && !this.engineStarted && this.pendingFrom === 0; }

  // a light as shown before Start engine (logic.beforeStart), else as decided
  unstarted(step, v) { return this.engineStarted || this.observe ? v : L.beforeStart(step, v); }

  async runSequence(from) {
    this.everythingStopped = false; this.stoppedAt = 0;
    if (!this.dryRun) this.engineStarted = true;
    const fresh = this.forceFresh; this.forceFresh = false;
    for (let step = from; step <= 6 && !this.quit; step++) {
      if (this.onlySteps && !this.onlySteps.has(step)) { this.rows[step - 1].v = verdict(Light.Grey, "Skipped (--steps)."); continue; }
      this.setPhase(this.observe ? "Checking (observe only)" : this.checking ? `Checking: step ${step} of 6` : `Starting: step ${step} of 6`);
      let ok;
      switch (step - 1) {
        case Step.Docker: ok = this.server ? this.serverNotNeeded(Step.Docker) : await this.doDocker(); break;
        case Step.Images: ok = this.server ? this.serverNotNeeded(Step.Images) : await this.doImages(); break;
        case Step.Stack: ok = this.server ? await this.doServer() : await this.doStack(fresh); break;
        case Step.Save: ok = await this.doSave(); break;
        case Step.Bridge: ok = await this.doBridge(); break;
        default: ok = await this.doTts(); break;
      }
      // (stoppedAt too: a press for a later step must not skip this unfinished one, logic.startFrom)
      // (the launch check cut short by a press: nothing to resume, the check runs again unless the press starts)
      if (this.cancel && !this.quit && this.checking) { this.checkPending = true; return; }
      if (this.cancel && !this.quit) { this.resumeFrom = step; this.stoppedAt = step; this.setPhase("Interrupted"); return; }
      if (!ok && !this.dryRun) {
        this.stoppedAt = step;
        this.setPhase(`Stopped at step ${step} (${Names[step - 1]}): see the red light`);
        for (let k = step; k < 6; k++) this.rows[k].v = verdict(Light.Grey, `Waiting for ${Names[step - 1]}.`);
        if (!this.L.friend) this.rows[Step.Save].v = verdict(Light.Grey, `Home mode: you keep your own save (${this.saveName}).`);
        this.fire();
        return;
      }
    }
    if (this.checking && L.engineUp(this.rows.map((r) => r.v.light))) { this.engineStarted = true; Log.write("launch check: the engine is already up"); }
    this.setPhase(this.observe ? "Observing (no changes)" : this.checking && !this.engineStarted ? L.NotStartedPhase : "Ready");
  }

  // ── own server: steps 1-2 run nothing here, step 3 logs in to the server

  serverNotNeeded(step) {
    this.set(step, this.server.ok ? L.serverNotNeeded(this.server.server) : verdict(Light.Grey, "Own server: see the engine stack light."));
    return true;
  }

  async doServer() {
    if (!this.server.ok) { this.set(Step.Stack, L.decideServer(this.server, null, this.game)); return false; }
    await this.refreshGame();
    this.set(Step.Stack, verdict(Light.Busy, `Connecting to your server (${L.serverWords(this.server.server)}).`));
    const login = this.isLocked ? { kind: "skipped" } : await this.login();
    const v = L.decideServer(this.server, login, this.game);
    this.set(Step.Stack, v);
    return v.light === Light.Green;
  }

  async monitorServer() {
    this.serverNotNeeded(Step.Docker); this.serverNotNeeded(Step.Images);
    if (!this.server.ok) { this.set(Step.Stack, L.decideServer(this.server, null, this.game)); return; }
    const login = this.isLocked ? { kind: "skipped" } : !this.loginCache || Date.now() - this.loginAt > 60000 ? await this.login() : this.loginCache;
    this.set(Step.Stack, this.unstarted(Step.Stack, L.decideServer(this.server, login, this.game)));
  }

  // what the bridge needs to use the server: its relay address and key (MTG_RELAY, MTG_KEY: bridge.js's arg())
  serverEnv() {
    if (!this.server || !this.server.ok) return {};
    const s = this.server.server;
    return { MTG_RELAY: L.serverUrl(s), ...(s.key ? { MTG_KEY: s.key } : {}) };
  }

  // ── 1. the container engine

  async doDocker() {
    let waitStart = null;
    while (!this.quit) {
      const f = await this.engine.detect();
      f.waiting = waitStart !== null;
      f.waitedSec = waitStart !== null ? (Date.now() - waitStart) / 1000 : 0;
      let v = L.decideDocker(f);
      if (this.dryRun && v.action) v = this.checking ? L.beforeStart(Step.Docker, v) : verdict(Light.Red, f.desktopRunning ? "Docker Desktop runs, but its engine isn't answering." : "Docker isn't running (the app would start Docker Desktop).");
      this.set(Step.Docker, v);
      if (v.light === Light.Green) return true;
      if (v.light === Light.Red || this.dryRun) return false;
      if (v.action === Actions.StartDesktop && waitStart === null) { this.engine.startDesktop(); waitStart = Date.now(); }
      else if (waitStart === null) waitStart = Date.now();
      if (!(await this.pause(3000))) return false;
    }
    return false;
  }

  // ── 2. engine images

  async doImages() {
    if (this.rows[Step.Docker].v.light !== Light.Green) { this.set(Step.Images, verdict(Light.Grey, "Waiting for the container engine.")); return this.dryRun; }
    let loaded = false;
    for (let round = 0; round < 3 && !this.quit; round++) {
      const r1 = await this.engine.imageId(P.Images.relay), r2 = await this.engine.imageId(P.Images["forge-room"]);
      if (r1.error || r2.error) { this.set(Step.Images, verdict(Light.Red, `Can't read the engine images: ${r1.error || r2.error}.`, { fix: Fixes.Retry, label: "Try again" })); return false; }
      let relay = r1.id, node = r2.id;
      await this.refreshGame();
      let [wantRelay, wantNode] = this.L.friend ? this.expectedImages() : [this.want("relay"), this.want("node")];
      if (loaded && relay && node) {
        // (after a load, the ids are whatever this engine gives the package's images: remember them)
        if (!L.sameId(relay, wantRelay) || !L.sameId(node, wantNode)) Log.write(`after the load the engine reports ${this.imageDiff(relay, node)}: remembered as this package's images`);
        this.rememberImages(relay, node);
        if (this.L.friend) this.rewriteDeployed(relay, node);
        wantRelay = relay; wantNode = node;
      }
      const f = { friend: this.L.friend, relayId: relay, nodeId: node, wantRelay, wantNode, tarPath: this.L.imagesTar, loadedAlready: loaded, locked: this.isLocked };
      if (this.forceLoad && this.L.friend && !loaded && this.L.imagesTar && !this.isLocked) f.relayId = null; // (the fix button: load again)
      this.forceLoad = false;
      let v = L.decideImages(f);
      this.imagesAt = Date.now();
      if (v.action === Actions.Load && !this.dryRun) {
        this.set(Step.Images, v);
        if (!(await this.loadImages())) { this.set(Step.Images, verdict(Light.Red, "Loading the engine images didn't work. The log (Open logs folder, companion.log) has the engine's message.", { fix: Fixes.ImagesLoad, label: "Load the engine again" })); return false; }
        loaded = true;
        continue;
      }
      if (this.checking && v.action === Actions.Load) v = L.beforeStart(Step.Images, v);
      else if (this.observe && v.action === Actions.Load) v = verdict(Light.Amber, `Would load the engine images from ${path.posix.basename(this.L.imagesTar)} (${this.imageDiff(relay, node)}).`);
      this.set(Step.Images, v);
      return v.light === Light.Green || v.light === Light.Amber;
    }
    return false;
  }

  imageDiff(relay, node) { return `here: relay ${L.shortId(relay)}, engine ${L.shortId(node)}; package: relay ${L.shortId(this.want("relay"))}, engine ${L.shortId(this.want("node"))}`; }

  async loadImages() {
    let size = 1;
    try { size = Math.max(1, fs.statSync(this.L.imagesTar).size); } catch { /* unknown */ }
    return this.engine.load(this.L.imagesTar, size, (pct, sec) =>
      this.set(Step.Images, verdict(Light.Busy, `Loading the engine images (first run only): ${pct >= 0 ? `${pct}% of ${size >> 20} MB, ` : ""}${sec} s.`)));
  }

  // ── 3. engine stack

  async login() {
    const own = this.server && this.server.ok ? this.server.server : null;
    // (own server: a TCP connection first, which says why a server can't be reached; the WebSocket doesn't)
    const reach = own ? await probes.tcpReach(own.host, own.port, 5000) : null;
    const r = reach && reach.kind !== "ok" ? { kind: reach.kind, roomFound: false, roomStatus: null, ms: 0, detail: reach.detail } : await probes.relayLogin(own ? L.serverUrl(own) : "ws://127.0.0.1:9443", own && own.key ? own.key : this.relayKey, L.Room, own ? 5000 : 3000);
    this.loginCache = r; this.loginAt = Date.now();
    if (r.kind !== "ok") Log.write(`relay login: ${r.kind} ${r.detail || ""}`);
    return r;
  }

  async doStack(fresh) {
    if (this.rows[Step.Docker].v.light !== Light.Green) { this.set(Step.Stack, verdict(Light.Grey, "Waiting for the container engine.")); return this.dryRun; }
    await this.refreshGame();
    const locked = this.isLocked;
    let autoRestarts = 0;
    if (!locked && !this.dryRun) {
      this.set(Step.Stack, verdict(Light.Busy, "Starting the engine (relay and Forge room)."));
      const up = await this.engine.up();
      if (up.code !== 0) { this.set(Step.Stack, verdict(Light.Red, L.composeFailure(up.timedOut ? "timed out" : up.out, this.L.friend), { fix: Fixes.StackRestart, label: "Start the engine" })); return false; }
      // (a room left over from an earlier game refuses a new start: Start MTG.bat restarts both every time)
      if (this.L.friend || fresh) {
        this.set(Step.Stack, verdict(Light.Busy, "Opening a fresh room (restarting relay and room)."));
        if (!(await this.restartRelayRoom())) return false;
        autoRestarts = 1;
      }
    }
    let until = Date.now() + L.StackWaitSeconds * 1000;
    let loginFails = 0, busy = 0;
    while (!this.quit) {
      const a = await this.engine.container("relay"), b = await this.engine.container("forge-room");
      if (a.error || b.error) { this.set(Step.Stack, verdict(Light.Red, `Can't read the engine containers: ${a.error || b.error}.`, { fix: Fixes.Retry, label: "Try again" })); return false; }
      const relay = a.info, room = b.info;
      const canLogin = relay && relay.exists && relay.state === "running" && relay.health !== "starting" && !locked;
      const login = canLogin ? await this.login() : { kind: "skipped" };
      let v = this.unstarted(Step.Stack, L.decideStack(relay, room, login, this.game, this.L.friend));
      if (this.dryRun || v.light === Light.Green || login.kind === "authFailed") { this.set(Step.Stack, v); return v.light === Light.Green; }
      if (locked && v.light === Light.Red) { this.set(Step.Stack, v); return false; }
      // (healthy, or no health check at all: Podman runs the relay without one)
      const broken = canLogin && (relay.health === "healthy" || relay.health === "") && login.kind !== "ok";
      if (broken) loginFails++;
      if (login.kind === "ok" && login.roomFound && login.roomStatus !== "Lobby") busy++;
      if ((loginFails >= 3 || busy >= 5) && autoRestarts < 2 && !locked && !this.observe) {
        Log.write(loginFails >= 3 ? "the relay is up but logins fail (stale port forward?): restarting relay and room" : "the room stays busy: restarting relay and room");
        this.set(Step.Stack, verdict(Light.Busy, "The relay didn't let this computer in; restarting relay and room."));
        if (!(await this.restartRelayRoom())) return false;
        autoRestarts++; loginFails = 0; busy = 0;
        until = Date.now() + L.StackWaitSeconds * 1000;
        continue;
      }
      if (Date.now() > until) {
        if (v.light !== Light.Red) v = verdict(Light.Red, L.stackTimedOut(v.text), { fix: Fixes.StackRestart, label: "Restart relay and room" });
        this.set(Step.Stack, v);
        return false;
      }
      this.set(Step.Stack, verdict(Light.Busy, `Waiting for the engine: ${v.text}`));
      if (!(await this.pause(2000))) return false;
    }
    return false;
  }

  async restartRelayRoom() {
    const r = await this.engine.restart();
    if (r.code !== 0) { this.set(Step.Stack, verdict(Light.Red, L.composeFailure(r.timedOut ? "timed out" : r.out, this.L.friend), { fix: Fixes.StackRestart, label: "Restart relay and room" })); return false; }
    return true;
  }

  // ── 4. table save (friend mode)

  stateFile() { return path.join(this.stateDir, "state.json"); }
  stateDict() { const o = L.parseJson(probes.readText(this.stateFile())); return L.isObj(o) ? o : {}; }
  writeState(d) { d.at = new Date().toISOString(); probes.writeJsonAtomic(this.stateFile(), d); }
  loadState() {
    const o = L.parseJson(probes.readText(this.stateFile()));
    return o ? { saveFile: L.str(o, "saveFile"), saveHash: L.str(o, "saveHash"), savesDir: L.str(o, "savesDir") } : null;
  }
  saveState(s) { const d = this.stateDict(); d.saveFile = s.saveFile; d.saveHash = s.saveHash; d.savesDir = s.savesDir; d.package = this.L.home; this.writeState(d); }

  // state.json holds the image ids the engine gave the package's images at the last load (Podman's and Docker's
  // containerd store report other ids than `docker save` ran on), so they don't load again at every start
  rememberImages(relay, node) {
    const d = this.stateDict();
    d.images = { wantRelay: this.want("relay"), wantNode: this.want("node"), relay, node };
    this.writeState(d);
  }
  // the package's stack/deployed.json names the ids the bridge expects; after a load, put this engine's there
  rewriteDeployed(relay, node) {
    const next = L.deployedAfterLoad(this.deployed, relay, node);
    if (!next) return;
    try { probes.writeJsonAtomic(this.L.deployedFile, next); this.deployed = next; Log.write(`stack/deployed.json: this engine's image ids recorded (${this.imageDiff(relay, node)})`); }
    catch (e) { Log.write(`stack/deployed.json not rewritten: ${e.message}`); }
  }
  expectedImages() {
    let relay = this.want("relay"), node = this.want("node");
    const im = L.get(this.stateDict(), "images");
    if (im && L.str(im, "wantRelay") === relay && L.str(im, "wantNode") === node && L.str(im, "relay") && L.str(im, "node")) { relay = L.str(im, "relay"); node = L.str(im, "node"); }
    return [relay, node];
  }

  // The Workshop table the package makes its table from: version.json "workshop" (id, url), else the 4-player one.
  // (A 6-player table, once its profile exists, comes as a second entry of version.json "tables"; this step makes the
  // first, required one.)
  workshopId() { return L.str(L.get(this.version, "workshop"), "id") || L.TableWorkshopId; }
  workshopLink() { return L.str(L.get(this.version, "workshop"), "url") || L.workshopUrl(this.workshopId()); }

  // the package's table/make-table.js run by the package's own Node: the Workshop copy in, the table out
  runMakeTable(workshop, outFile) {
    const script = path.join(this.L.home, "table", "make-table.js");
    if (!probes.exists(script)) return { ok: false, error: "table/make-table.js is missing from the package. Unpack the package again" };
    const node = probes.exists(this.L.nodeExe) ? this.L.nodeExe : process.execPath;
    const r = require("child_process").spawnSync(node, [script, workshop, outFile], { encoding: "utf8", timeout: 120000, maxBuffer: 1 << 24, cwd: this.L.home });
    if (r.error) return { ok: false, error: r.error.code === "ETIMEDOUT" ? "the patcher took over 2 minutes" : `couldn't run ${node}: ${r.error.message}` };
    return L.parseMakeTable(r.status, `${r.stderr || ""}\n${r.stdout || ""}`.trim()); // (its JSON line is the last of stdout)
  }

  async doSave() {
    if (!this.L.friend) { this.set(Step.Save, verdict(Light.Grey, `Home mode: you keep your own save (${this.saveName}).`)); return true; }
    const where = this.findSaves();
    this.savesDir = where.dir;
    const notYet = L.savesFolderVerdict(where.found, where.tried);
    if (notYet) { Log.write(`no TTS folder yet; looked in: ${where.tried.join(" | ")}`); this.set(Step.Save, notYet); return false; }
    // the table: made here from the host's own Workshop copy (the package ships none)
    const tried = this.workshopCandidates(this.savesDir, this.workshopId());
    const workshop = tried.find((f) => probes.exists(f));
    if (!workshop) { Log.write(`no Workshop table ${this.workshopId()}; looked in: ${tried.join(" | ")}`); this.set(Step.Save, L.workshopMissing(this.workshopLink(), tried)); return false; }
    // (a check makes it in a temp file: it changes nothing, not even the package's table folder)
    const made = this.dryRun ? path.join(require("os").tmpdir(), `mtg-companion-table-${process.pid}-${Date.now()}.json`) : this.L.tableJson;
    try {
      fs.mkdirSync(path.dirname(made), { recursive: true });
      const b = (this.buildTable || ((w, o) => this.runMakeTable(w, o)))(workshop, made);
      Log.write(`table from ${workshop}: ${b.ok ? `stamp ${b.stamp}, save ${b.save}, Workshop copy ${b.workshop}` : `failed: ${b.error}`}`);
      if (!b.ok || !probes.exists(made)) { this.set(Step.Save, b.missing ? L.workshopMissing(this.workshopLink(), tried) : L.tableBuildFailed(b.ok ? { error: "it wrote nothing" } : b)); return false; }
      const ours = fs.readFileSync(made);
      const ourHash = L.sha8(ours);
      const packageSave = this.want("save"), packageTable = this.want("table");
      if (packageSave && packageSave !== ourHash) Log.write(`note: this Workshop copy made save ${ourHash} (stamp ${b.stamp}), the package was checked with ${packageSave} (${packageTable})`);
      this.builtStamp = b.stamp && b.stamp !== packageTable ? b.stamp : null;
      if (!this.dryRun && this.builtStamp) this.rewriteDeployedTable(this.builtStamp);
      const want = ourHash; // (what goes into the save is what was just made)
      const finished = (text) => L.saveDone(text, ourHash, packageSave, b.stamp, packageTable);
      const dir = this.savesDir;
      const existing = probes.exists(dir) ? fs.readdirSync(dir).filter((f) => { try { return fs.statSync(path.join(dir, f)).isFile(); } catch { return false; } }).map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size })) : [];
      let st = this.loadState();
      if (st && path.resolve(st.savesDir || "/nonexistent") !== path.resolve(dir)) st = null;
      const plan = L.planSave(existing, st, want, ourHash, ours.length, (n) => L.sha8(fs.readFileSync(path.join(dir, n))));
      Log.write(`save plan: ${plan.kind} ${plan.file} (${plan.text}) in ${dir}`);
      if (this.dryRun) {
        this.set(Step.Save, plan.kind === "skip" || plan.kind === "adopt" ? finished(plan.text)
          : this.checking ? verdict(Light.Grey, `Start engine does this: ${plan.text}`) : verdict(Light.Amber, `Would do: ${plan.text} (in ${dir})`));
        return true;
      }
      if (plan.kind === "update") { await this.refreshGame(); if (this.isLocked) { this.set(Step.Save, verdict(Light.Amber, "A newer table is in this package; it installs after the game.")); return true; } }
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, plan.file), png = target.replace(/\.json$/i, ".png");
      if (plan.kind === "install") {
        // (a link, or a copy with COPYFILE_EXCL where links don't work, refuses an existing file: never overwrites)
        const tmp = `${target}.mtg-companion-tmp`;
        fs.writeFileSync(tmp, ours);
        try {
          try { fs.linkSync(tmp, target); } catch (e) { if (e.code === "EEXIST") throw e; fs.copyFileSync(tmp, target, fs.constants.COPYFILE_EXCL); }
        } finally { try { fs.unlinkSync(tmp); } catch { /* gone */ } }
        if (probes.exists(this.L.tablePng) && !probes.exists(png)) fs.copyFileSync(this.L.tablePng, png, fs.constants.COPYFILE_EXCL);
      } else if (plan.kind === "update") {
        const backup = path.join(this.stateDir, "backup");
        fs.mkdirSync(backup, { recursive: true });
        const st2 = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
        fs.copyFileSync(target, path.join(backup, `${plan.file.replace(/\.json$/i, "")}-${st2}.json`), fs.constants.COPYFILE_EXCL);
        const old = fs.readdirSync(backup).filter((f) => f.endsWith(".json")).map((f) => ({ f, t: fs.statSync(path.join(backup, f)).mtimeMs })).sort((x, y) => y.t - x.t).slice(5);
        for (const o of old) { try { fs.unlinkSync(path.join(backup, o.f)); } catch { /* kept */ } }
        fs.copyFileSync(this.L.tableJson, target);
        if (probes.exists(this.L.tablePng)) fs.copyFileSync(this.L.tablePng, png);
      }
      // (the hash of the bytes now in that file: planSave overwrites it later only while it still hashes to this)
      this.saveState({ saveFile: plan.file, saveHash: ourHash, savesDir: dir });
      const done = plan.kind === "skip" || plan.kind === "adopt" ? plan.text : plan.kind === "update" ? `Updated ${plan.file} (${this.saveName}).` : `Installed as ${plan.file} (${this.saveName}).`;
      this.set(Step.Save, finished(done));
      return true;
    } catch (e) {
      Log.write(`save install failed: ${e.stack || e}`);
      this.set(Step.Save, verdict(Light.Red, `Couldn't install the table save: ${e.message}`, { fix: Fixes.Retry, label: "Try again" }));
      return false;
    } finally {
      if (this.dryRun) for (const f of [made, made.replace(/\.json$/i, ".png")]) { try { fs.unlinkSync(f); } catch { /* none */ } }
    }
  }

  // The table this host made, in the package's stack/deployed.json (its Workshop copy made another than the package's)
  rewriteDeployedTable(stamp) {
    const next = L.deployedWithTable(this.deployed, stamp);
    if (!next) return;
    try { probes.writeJsonAtomic(this.L.deployedFile, next); this.deployed = next; Log.write(`stack/deployed.json: this host's table ${stamp} recorded`); }
    catch (e) { Log.write(`stack/deployed.json not rewritten: ${e.message}`); }
  }

  // ── 5. bridge

  async bridgeProcessExists() { return P.bridgeProcs(await probes.processes(), this.L.bridgeJs).length > 0 || bridgeLoop.loopPid(this.L) !== null; }

  async bridgeVerdict(vers) {
    const held = await probes.listeners([39998, 48787]);
    let portProblem = L.decidePorts(held, this.L.friend ? this.L.bridgeJs : null, this.L.friend);
    const proc = vers.kind === "ok" ? true : await this.bridgeProcessExists();
    const known = held.filter((l) => l.pid !== null && l.pid !== undefined);
    if (!portProblem && vers.kind === "refused" && !proc && known.length > 0) {
      // a node we couldn't read holds a port, and nothing answers: still not ours to start over
      const l = known[0];
      portProblem = verdict(Light.Red, `${l.name || "A program"} (process ${l.pid}) holds port ${l.port}, which the bridge needs. Close it (or: kill ${l.pid}), then press the button.`, { fix: Fixes.ShowProgram, label: "I closed it: try again" });
    }
    return L.decideBridge(vers, portProblem, proc, this.want("bridge"), this.L.friend);
  }

  async doBridge() {
    let started = false, t0 = Date.now();
    while (!this.quit) {
      const vers = await probes.httpGet(`${this.bridgeUrl}/versions`, 15000);
      if (vers.kind === "ok") { this.versionsCache = vers; this.versionsAt = Date.now(); }
      let v = await this.bridgeVerdict(vers);
      if (v.light === Light.Red) this.versionsCache = null; // (another program answers: its table isn't ours to judge)
      if (this.dryRun) {
        if (this.checking) v = L.beforeStart(Step.Bridge, v);
        else if (v.action === Actions.StartBridge) v = verdict(Light.Red, "The bridge isn't running (the app would start it).");
        this.set(Step.Bridge, v);
        return v.light === Light.Green;
      }
      if (v.action === Actions.StartBridge && !started) {
        // a folder the bridge can't write would only crash it again every 3 s: say so once instead
        const unwritable = this.L.friend ? L.writeProblem([this.L.logsDir, path.posix.dirname(this.L.bridgeJs)], probes.tryWrite) : null;
        if (unwritable) { this.set(Step.Bridge, verdict(Light.Red, unwritable, { fix: Fixes.Retry, label: "Try again" })); return false; }
        this.set(Step.Bridge, v);
        this.startBridge();
        started = true; t0 = Date.now();
        if (!(await this.pause(1500))) return false;
        continue;
      }
      if (v.light === Light.Green || (v.light === Light.Amber && !started)) { this.set(Step.Bridge, v); return true; }
      if (v.light === Light.Red) { this.set(Step.Bridge, v); return false; }
      if (Date.now() - t0 > 45000) {
        const tailLines = String(probes.tail(this.L.bridgeLog, 4000) || "").replace(/\r/g, "").split("\n").filter((s) => s.trim()).slice(-5);
        const why = tailLines.join(" | ");
        const hint = why.includes("EADDRINUSE") ? " A port it needs is taken by another program." : "";
        this.set(Step.Bridge, verdict(Light.Red, `The bridge didn't start.${hint} Last log lines: ${L.clip(why, 300)}`, { fix: Fixes.BridgeStart, label: "Start the bridge" }));
        return false;
      }
      this.set(Step.Bridge, started ? verdict(Light.Busy, `Starting the bridge (${Math.round((Date.now() - t0) / 1000)} s).`) : v);
      if (!(await this.pause(1500))) return false;
    }
    return false;
  }

  // the bridge loop: this same companion with --bridge-loop, detached (closing the companion leaves a game alone)
  startBridge() {
    const args = [path.join(this.appDir, "companion.js"), "--bridge-loop", "--home", this.L.home];
    if (this.engine.o.override) args.push("--runtime", this.engine.o.override);
    Log.write(`starting the bridge loop: ${process.execPath} ${args.join(" ")}`);
    probes.launch(process.execPath, args, { ...process.env, ...this.engine.bridgeEnv(), ...this.serverEnv() });
  }

  async stopBridge() { Log.write("stopping the bridge loop and the bridge"); await bridgeLoop.stop(this.L); }

  // ── 6. TTS

  async ttsProc() { return P.findTts(await probes.processes()); }
  steamCmd() { return this.platform === "darwin" ? null : probes.which("steam"); }
  steamFound() {
    if (this.platform === "darwin") return probes.exists("/Applications/Steam.app") || probes.exists(path.join(require("os").homedir(), "Library", "Application Support", "Steam"));
    const h = require("os").homedir();
    return !!this.steamCmd() || probes.exists(path.join(h, ".steam", "steam")) || probes.exists(path.join(h, ".local", "share", "Steam"));
  }
  launchTts() {
    const [cmd, args] = P.ttsLaunch(this.platform, this.steamCmd());
    Log.write(`opening TTS: ${cmd} ${args.join(" ")}`);
    if (probes.launch(cmd, args)) this.ttsLaunched = true; else Log.write("TTS didn't open");
  }

  async doTts() {
    if (!(await this.ttsProc()) && !this.dryRun && !this.ttsLaunched && this.steamFound()) {
      this.launchTts();
      this.set(Step.Tts, verdict(Light.Busy, "Opening Tabletop Simulator through Steam."));
      const until = Date.now() + 120000;
      while (!(await this.ttsProc()) && Date.now() < until) if (!(await this.pause(2000))) return false;
    }
    await this.updateTts();
    return true;
  }

  async updateTts() {
    const vers = this.versionsCache && Date.now() - this.versionsAt < 90000 ? this.versionsCache : null;
    const body = vers ? L.parseJson(vers.body) : null;
    const now = L.get(body, "now");
    // (when the table last spoke, as of now: the bridge's answer is up to 90 s old)
    const heardAgo = L.get(body, "tableHeardMs") === null ? null : L.int(body, "tableHeardMs") / 1000 + (Date.now() - this.versionsAt) / 1000;
    const tts = await this.ttsProc();
    this.set(Step.Tts, L.decideTts({
      running: !!tts, versionsOk: !!vers, tableHeard: L.has(now, "table"), table: L.str(now, "table"), wantTable: this.builtStamp || this.want("table"),
      saveName: this.saveName, steamFound: this.steamFound(), home: !this.L.friend, tableHeardAgoSec: heardAgo, ttsUpSec: tts ? tts.upSec : null,
    }));
  }

  // ───────────────────────────── the watcher ─────────────────────────────

  async monitorTick() {
    await this.refreshGame();
    const f = this.server ? null : await this.engine.detect();
    if (this.server) await this.monitorServer();
    else if (f.answers) this.set(Step.Docker, L.decideDocker(f));
    else if (!this.engineStarted && !this.observe) this.set(Step.Docker, L.beforeStart(Step.Docker, L.decideDocker(f))); // (before Start engine: no red light for a Docker nobody asked to start)
    else this.set(Step.Docker, verdict(f.desktopRunning ? Light.Amber : Light.Red, f.desktopRunning ? "Docker Desktop runs, but its engine isn't answering (starting or stopped)." : L.decideDocker({ ...f, desktopFound: false }).text,
      f.desktopFound ? { fix: Fixes.DockerStart, label: "Start Docker Desktop" } : { fix: Fixes.Retry, label: "Try again" }));
    if (f && f.answers) {
      if (Date.now() - this.imagesAt > 5 * 60000 && this.rows[Step.Images].v.light !== Light.Busy) {
        this.imagesAt = Date.now();
        const r1 = await this.engine.imageId(P.Images.relay), r2 = await this.engine.imageId(P.Images["forge-room"]);
        if (!r1.error && !r2.error) {
          const [wr, wn] = this.L.friend ? this.expectedImages() : [this.want("relay"), this.want("node")];
          let v = this.unstarted(Step.Images, L.decideImages({ friend: this.L.friend, relayId: r1.id, nodeId: r2.id, wantRelay: wr, wantNode: wn, tarPath: this.L.imagesTar, locked: this.isLocked }));
          if (v.action === Actions.Load) v = verdict(Light.Amber, `The engine images differ from this package (${this.imageDiff(r1.id, r2.id)}).`, { fix: Fixes.ImagesLoad, label: "Load the engine images" });
          this.set(Step.Images, v);
        }
      }
      const a = await this.engine.container("relay"), b = await this.engine.container("forge-room");
      if (!a.error && !b.error) {
        const rc = a.info, oc = b.info;
        const canLogin = rc && rc.exists && rc.state === "running" && rc.health !== "starting" && !this.isLocked;
        const login = !canLogin ? { kind: "skipped" } : !this.loginCache || Date.now() - this.loginAt > 60000 ? await this.login() : this.loginCache;
        this.set(Step.Stack, this.unstarted(Step.Stack, L.decideStack(rc, oc, login, this.game, this.L.friend)));
      }
    } else if (!this.server) this.set(Step.Stack, verdict(Light.Grey, "Waiting for the container engine."));
    // bridge: /versions every 30 s, not more (each call runs an inspect inside the bridge)
    if (Date.now() - this.versionsAt > 30000) {
      const vers = await probes.httpGet(`${this.bridgeUrl}/versions`, 15000);
      if (vers.kind === "ok") { this.versionsCache = vers; this.versionsAt = Date.now(); } else this.versionsAt = Date.now() - 25000; // (try again in 5 s)
      let v = this.unstarted(Step.Bridge, await this.bridgeVerdict(vers));
      if (v.action === Actions.StartBridge) v = verdict(Light.Red, "The bridge isn't running.", { fix: Fixes.BridgeStart, label: "Start the bridge" });
      else if (v.action === Actions.Wait) v = verdict(Light.Busy, "The bridge is (re)starting.");
      if (vers.kind !== "ok" || v.light === Light.Red) this.versionsCache = null;
      this.set(Step.Bridge, v);
    }
    await this.updateTts();
    // (the engine came up without Start engine, e.g. a companion that was restarted: it counts as started)
    if (!this.engineStarted && !this.observe && this.pendingFrom === 0 && L.engineUp(this.rows.map((r) => r.v.light))) {
      this.engineStarted = true; Log.write("the engine is up (started outside this app): watching it as started");
      if (this.phase === L.NotStartedPhase || this.phase === L.StoppedPhase) this.setPhase("Ready");
    }
    if (!this.observe && this.phase.startsWith("Ready")) this.setPhase(this.rows.some((r) => r.v.light === Light.Red) ? "Ready, with a problem: see the red light" : "Ready");
  }

  // ───────────────────────────── buttons and menu ─────────────────────────────

  // a fix button; returns a refusal sentence when the game lock stops it
  doFix(row, fix) {
    if (this.observe) return "Observe mode: nothing is changed.";
    if (Fixes.locksDuringGame(fix) && this.isLocked) return L.lockText(this.game);
    Log.write(`button: ${fix} on ${Names[row]}`);
    switch (fix) {
      case Fixes.Retry: this.enqueue(() => { this.pendingFrom = row + 1; }); break;
      case Fixes.DockerStart: this.enqueue(() => { this.engine.startDesktop(); this.pendingFrom = 1; }); break;
      case Fixes.ImagesLoad: this.enqueue(() => { this.forceLoad = true; this.pendingFrom = 2; }); break;
      case Fixes.StackRestart: this.enqueue(async () => { await this.refreshGame(); if (this.isLocked) return; this.forceFresh = true; this.pendingFrom = 3; }); break;
      case Fixes.BridgeRestart: this.enqueue(async () => { await this.refreshGame(); if (this.isLocked) return; await this.stopBridge(); this.pendingFrom = 5; }); break;
      case Fixes.BridgeStart: this.enqueue(() => { this.pendingFrom = 5; }); break;
      case Fixes.TtsOpen: this.enqueue(() => { this.launchTts(); }); break;
      case Fixes.ShowProgram: this.enqueue(() => { this.pendingFrom = 5; }); break;
      default: break;
    }
    return null;
  }

  restartEngine() {
    if (this.observe) return "Observe mode: nothing is changed.";
    if (this.isLocked) return L.lockText(this.game);
    Log.write("menu: restart engine");
    this.enqueue(async () => {
      await this.refreshGame();
      if (this.isLocked) { Log.write(`restart refused: ${this.game.text}`); return; }
      this.setPhase("Restarting the engine");
      await this.stopBridge();
      this.forceFresh = true;
      this.pendingFrom = 1;
    });
    return null;
  }

  // Stops the bridge and the engine containers; the container engine and TTS stay as they are.
  stopEverything(done) {
    if (this.observe) { if (done) done(); return; }
    Log.write(`menu: stop everything (game: ${this.game.kind})`);
    this.enqueue(async () => {
      this.everythingStopped = true; this.pendingFrom = 0; this.stoppedAt = 0; this.engineStarted = false;
      this.setPhase("Stopping");
      await this.stopBridge();
      if (!this.server && this.engine.cli && this.rows[Step.Docker].v.light === Light.Green) await (this.L.friend ? this.engine.down() : this.engine.stop());
      for (let i = 0; i < this.rows.length; i++)
        if (i !== Step.Docker) this.rows[i].v = verdict(Light.Grey, i === Step.Save ? (this.L.friend ? "Installed (unchanged)." : this.rows[i].v.text) : "Stopped.");
      this.setPhase(L.StoppedPhase);
      this.fire();
      if (done) done();
    });
  }

  // a button's work is still going: queued, about to start the sequence, or the sequence/stop running
  get workPending() {
    if (this.work.length > 0) return true;
    const p = this.phase || "";
    return this.pendingFrom > 0 || p.startsWith("Starting") || p.startsWith("Restarting") || p.startsWith("Stopping");
  }

  statusPageShownBefore() { return L.get(this.stateDict(), "statusPageShown") === true; }
  markStatusPageShown() { try { const d = this.stateDict(); d.statusPageShown = true; this.writeState(d); } catch (e) { Log.write(`state.json: the status page flag wasn't written (${e.message})`); } }

  // the text dump for --observe --dump
  dump() {
    const out = [`MTG Companion ${this.observe ? "observe" : "status"} at ${new Date().toISOString()}`, `Mode: ${this.L.mode}, home ${this.L.home}`];
    if (this.versionText) out.push(this.versionText);
    out.push(`Container engine: ${this.engine.runtime || "none"} (${this.engine.cli || "no CLI"})`, `Saves: ${this.savesDir}`, `Phase: ${this.phase}`, `Game: ${this.game.kind}: ${this.game.text}${this.isLocked ? "  [restart buttons locked]" : ""}`);
    this.rows.forEach((r, i) => out.push(`  ${i + 1} ${r.name.padEnd(16)} [${r.v.light.toUpperCase().padEnd(5)}] ${r.v.text}${r.v.fix ? `   (button: ${r.v.fixLabel}${Fixes.locksDuringGame(r.v.fix) && this.isLocked ? ", locked" : ""})` : ""}`));
    const lc = this.loginCache;
    out.push(lc ? `Relay login: ${lc.kind}${lc.roomFound ? `, room ${lc.roomStatus}` : ", room not listed"}${lc.detail ? ` (${lc.detail})` : ""}, ${lc.ms} ms` : `Relay login: not tried (${this.isLocked ? "locked by the game state" : "relay not ready"})`);
    return `${out.join("\n")}\n`;
  }
}

module.exports = { Controller, Log, hhmmss };
