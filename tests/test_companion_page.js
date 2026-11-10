// The companion's status page script (companion/src/WebPage.cs): the page is pulled out of the C# string and its
// script is run in a Node vm with a stub DOM, fetch and clock. Covers the pure parts (status JSON to a view model,
// click plans, poll scheduling, the token header, the reload guard) and the shell that wires them (re-arming the poll
// whatever happens, the error banner, buttons disabled while their request is in flight, busy/reconnecting/down).
//   node tests/test_companion_page.js [path/to/WebPage.cs]
// No npm packages.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FILE = process.argv[2] || path.join(__dirname, "..", "companion", "src", "WebPage.cs");
const TOKEN = "0123456789abcdef0123456789abcdef";

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${typeof why === "string" ? why : JSON.stringify(why)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const flush = () => new Promise((r) => setImmediate(r));

// ───────────────────────────── the page out of the C# file ─────────────────────────────

const cs = fs.readFileSync(FILE, "utf8");
const m = /public const string Html = @"([\s\S]*?)";\s*\}\s*\}\s*$/.exec(cs);
if (!m) { console.log(`FAIL can't find the Html verbatim string in ${FILE}`); process.exit(1); }
const html = m[1].split("{{TOKEN}}").join(TOKEN).split("{{NONCE}}").join("n0nce");
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
const script = scripts.length ? scripts[0][2] : "";

{
  ok("static: the C# file has only the two quote characters of the verbatim string", (cs.match(/"/g) || []).length === 2, (cs.match(/"/g) || []).length);
  ok("static: one inline script with the nonce, no src", scripts.length === 1 && /nonce='n0nce'/.test(scripts[0][1]) && !/src=/.test(scripts[0][1]));
  ok("static: the style carries the nonce", /<style nonce='n0nce'>/.test(html));
  ok("static: nothing loaded from elsewhere", !/(src|href)='https?:/.test(html) && !/@import|url\(http/.test(html));
  ok("static: no innerHTML, document.write, eval or Function", !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(script));
  ok("static: no template braces left for C# to fill", !/\{\{|\}\}/.test(m[1].replace(/\{\{(TOKEN|NONCE)\}\}/g, "")));
  const ids = new Set([...html.matchAll(/\sid='([^']+)'/g)].map((x) => x[1]));
  const used = [...script.matchAll(/(?:\$|getElementById)\('([\w-]+)'\)/g)].map((x) => x[1]);
  const missing = used.filter((id) => !ids.has(id));
  ok("static: every id the script looks up is in the page", used.length > 20 && missing.length === 0, missing.join(","));
  ok("static: the hint paragraph has no aria-label (a label hides its text from readers)", /<p class='hint' id='hint'>/.test(html));
  ok("static: the token meta has the id the script reads", /<meta id='mtg-token' name='mtg-token' content='[0-9a-f]{32}'>/.test(html));
}

// ───────────────────────────── a stub DOM built from the page's ids ─────────────────────────────

class El {
  constructor(tag, id) {
    this.tagName = tag; this.id = id || ""; this.attrs = {}; this.children = []; this.className = ""; this._text = "";
    this.hidden = false; this.listeners = {}; this.title = ""; this.type = ""; this.scrollTop = 0; this.clientHeight = 100; this.scrollHeight = 100;
    this.throwOnce = false;
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  setAttribute(k, v) { if (this.throwOnce) { this.throwOnce = false; throw new Error("boom in setAttribute"); } this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  click() { (this.listeners.click || []).forEach((f) => f()); }
}

function makeDom() {
  const byId = {};
  for (const t of html.matchAll(/<([a-zA-Z0-9]+)\b([^>]*)>/g)) {
    const idm = /\sid='([^']+)'/.exec(t[2]);
    if (!idm) continue;
    const e = new El(t[1].toLowerCase(), idm[1]);
    e.hidden = /\shidden(\s|$)/.test(t[2]);
    const cm = /\sclass='([^']*)'/.exec(t[2]);
    if (cm) e.className = cm[1];
    for (const a of t[2].matchAll(/\s([a-z-]+)='([^']*)'/g)) e.attrs[a[1]] = a[2];
    byId[e.id] = e;
  }
  const document = {
    title: "MTG Companion", body: new El("body"), hidden: false, listeners: {},
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => new El(tag),
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
  };
  return { document, byId };
}

function makeClock() {
  let now = 1000000, seq = 0;
  const timers = new Map();
  const c = {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + (ms || 0), fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    polls: () => [...timers.values()].filter((t) => t.fn.name === "poll").map((t) => t.at - now),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await flush();
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        timers.delete(next[0]);
        now = Math.max(now, next[1].at);
        next[1].fn();
      }
      now = end;
      await flush(); await flush();
    },
  };
  return c;
}

// ───────────────────────────── status JSON as WebUi sends it ─────────────────────────────

const NAMES = ["Docker", "Engine images", "Engine stack", "Table save", "Bridge", "TTS"];
const LOCK = "A game is on. Wait until it ends, then press this again.";
function status() {
  return {
    api: 1, app: "MTG Companion", at: "12:00:00", mode: "friend", home: "", observe: false, phase: "Ready",
    worst: { state: "green", busy: false, text: "Ready" },
    game: { kind: "none", text: "No game.", turn: 0, locked: false, lockText: null },
    lights: NAMES.map((n, i) => ({ step: i + 1, name: n, state: "green", busy: false, word: "OK", text: `${n} is fine.`, hint: null, at: "12:00:00", action: null })),
    menu: [
      { id: "restart-engine", label: "Restart engine", enabled: true, title: "Stops the bridge, restarts relay and room.", confirm: "Restart the engine?", confirmLocked: false },
      { id: "stop-everything", label: "Stop everything", enabled: true, title: "Stops the bridge and the containers.", confirm: "Stop the bridge and the engine containers?", confirmLocked: false },
      { id: "open-logs", label: "Open logs folder", enabled: true, title: "C:\\pkg\\logs", confirm: null, confirmLocked: false },
    ],
    hint: "In TTS: Create, Singleplayer.", versions: { text: "table 0fa50b21", companion: "1.2.3.4" },
    log: { file: "C:\\pkg\\logs\\companion.log", lines: ["one", "two"] }, update: null,
  };
}
function redFix(s, locked) {
  s.worst = { state: "red", busy: false, text: "Problem: Engine stack" };
  s.lights[2] = { ...s.lights[2], state: "red", word: "Problem", text: "The relay is down.", action: { id: "fix:2:stack-restart", label: "Restart relay and room", locked: !!locked, lockText: locked ? LOCK : null, confirm: "Restart the relay and the Forge room (about 20 s)?" } };
  return s;
}
function gameOn(s) {
  s.game = { kind: "on", text: "Game on: turn 6, 4 seats.", turn: 6, locked: true, lockText: LOCK };
  redFix(s, true);
  s.menu[0] = { ...s.menu[0], enabled: false, label: "Restart engine (locked: game on)", title: LOCK };
  s.menu[1] = { ...s.menu[1], confirm: "Game on: turn 6.\n\nStopping everything ends that game for everyone. Stop anyway?", confirmLocked: true };
  return s;
}

// ───────────────────────────── the script in a vm ─────────────────────────────

function load(extra) {
  const ctx = vm.createContext(Object.assign({}, extra || {}));
  vm.runInContext(script, ctx, { filename: "WebPage.cs <script>" });
  return ctx;
}
const P = load().MtgPage;
ok("vm: the script defines MtgPage without a document (and starts nothing)", P && typeof P.start === "function" && typeof P.viewModel === "function");

// ───────────────────────────── pure: the view model ─────────────────────────────
{
  const none = { mode: "ok", inflight: {} };
  const v = P.viewModel(status(), none);
  same("vm: header green, the worst light's words, plain title", [v.header.state, v.header.text, v.header.title, v.header.color], ["green", "Ready", "MTG Companion", "#3fb950"]);
  same("vm: six lights with name, word, text, checked time", v.lights.map((l) => [l.state, l.name, l.word, l.at]).slice(0, 2), [["green", "Docker", "OK", "checked 12:00:00"], ["green", "Engine images", "OK", "checked 12:00:00"]]);
  same("vm: no buttons on green lights; no banners", [v.lights.every((l) => l.button === null), v.game.shown, v.observe, v.update, v.conn.banner, v.conn.down], [true, false, false, null, false, false]);
  same("vm: menu in order, enabled, stop-everything drawn as danger", v.menu.map((b) => [b.id, b.disabled, b.danger, b.kind]), [["restart-engine", false, false, "menu"], ["stop-everything", false, true, "menu"], ["open-logs", false, false, "menu"]]);
  same("vm: log lines joined, the file, the footer", [v.log.text, v.log.file, v.footer.versions, v.footer.updated], ["one\ntwo", "C:\\pkg\\logs\\companion.log", "table 0fa50b21 · companion 1.2.3.4", "Updated 12:00:00"]);
  const e = status(); e.log.lines = []; e.versions.text = ""; e.mode = "home"; e.home = "C:\\repo";
  const ve = P.viewModel(e, none);
  same("vm: an empty log says so; home mode in the phase; no version text", [ve.log.text, ve.header.phase, ve.footer.versions], ["(empty)", "Ready · home mode (C:\\repo)", "companion 1.2.3.4"]);
  const busy = status(); busy.worst = { state: "amber", busy: true, text: "Starting: step 2 of 6" }; busy.lights[1] = { ...busy.lights[1], state: "amber", busy: true, word: "—" };
  const vb = P.viewModel(busy, none);
  same("vm: a working light is drawn busy; the dash word reads Not checked", [vb.header.state, vb.lights[1].state, vb.lights[1].word, vb.lights[0].state], ["busy", "busy", "Not checked", "green"]);

  const r = P.viewModel(redFix(status(), false), none);
  const b = r.lights[2].button;
  same("vm: red header, title with the problem", [r.header.state, r.header.title, r.header.color], ["red", "● Problem: Engine stack · MTG Companion", "#f85149"]);
  same("vm: a red light's fix button, enabled, with its confirm", [b.id, b.kind, b.label, b.disabled, b.locked, b.confirm, b.aria], ["fix:2:stack-restart", "fix", "Restart relay and room", false, false, "Restart the relay and the Forge room (about 20 s)?", "Restart relay and room (Engine stack)"]);

  const g = P.viewModel(gameOn(status()), none);
  const gb = g.lights[2].button;
  same("vm: game on: the banner, its title and text", [g.game.shown, g.game.cls, g.game.title, g.game.text], [true, "banner game", "Game in progress", "Game on: turn 6, 4 seats. Buttons that restart the engine are locked until the game is over."]);
  same("vm: game on: the locked fix is disabled with the lock sentence (title and label)", [gb.disabled, gb.locked, gb.title, gb.aria], [true, true, LOCK, `Restart relay and room (Engine stack). ${LOCK}`]);
  same("vm: game on: Restart engine disabled, the lock sentence as its title and label", [g.menu[0].disabled, g.menu[0].locked, g.menu[0].lockText, g.menu[0].aria], [true, true, LOCK, `Restart engine (locked: game on). ${LOCK}`]);
  same("vm: game on: Stop everything stays enabled and carries confirmLocked", [g.menu[1].disabled, g.menu[1].confirmLocked], [false, true]);
  const ct = status(); ct.game = { kind: "cantTell", text: "The bridge is slow.", locked: true, lockText: LOCK };
  const vc = P.viewModel(ct, none);
  same("vm: can't tell: the warn banner", [vc.game.shown, vc.game.cls, vc.game.title], [true, "banner warn", "Can’t tell whether a game is on"]);
  const ob = status(); ob.observe = true;
  ok("vm: observe mode shows its banner", P.viewModel(ob, none).observe === true);

  const d = P.viewModel(gameOn(status()), { mode: "down", inflight: {} });
  same("vm: down: grey header, not running, the game banner hidden", [d.header.state, d.header.text, d.header.title, d.game.shown, d.conn.down], ["grey", "Companion not running", "MTG Companion (not running)", false, true]);
  ok("vm: down: every button disabled (menu and fixes)", d.menu.every((x) => x.disabled) && d.lights[2].button.disabled);
  const busyView = P.viewModel(status(), { mode: "busy", inflight: {} });
  same("vm: busy: the retry banner, buttons still usable", [busyView.conn.banner, busyView.conn.title, busyView.conn.down, busyView.menu[0].disabled], [true, "Companion busy, retrying", false, false]);
  same("vm: reconnecting: its own banner, not down", [P.connView("reconnecting").title, P.connView("reconnecting").down, P.connView("ok").banner], ["Reconnecting", false, false]);
  const fl = P.viewModel(status(), { mode: "ok", inflight: { "restart-engine": true } });
  same("vm: a request in flight: that button busy and disabled, the others not", [fl.menu[0].busy, fl.menu[0].disabled, fl.menu[1].busy, fl.menu[1].disabled], [true, true, false, false]);
  const n0 = P.viewModel(null, none);
  same("vm: before the first answer: connecting, six grey rows, no menu", [n0.header.text, n0.lights.length, n0.lights[0].state, n0.lights[0].text, n0.menu.length, n0.footer.updated], ["Connecting…", 6, "grey", "Not checked yet.", 0, ""]);

  const u = status();
  u.update = { line: "Version 1.3 is ready.", actions: [{ id: "update-now", label: "Install now", enabled: true, title: "", confirm: "Install 1.3?", confirmLocked: false }] };
  const vu = P.viewModel(u, none);
  same("vm: the update section: its line and actions in the menu's shape", [vu.update.title, vu.update.text, vu.update.actions.map((a) => [a.id, a.kind, a.disabled, a.confirm])], ["Update", "Version 1.3 is ready.", [["update-now", "menu", false, "Install 1.3?"]]]);
  // the self-update as WebUi.UpdateSection sends it (companion/src/WebUi.cs; --selftest checks the C# side of this shape)
  const offered = { title: "Update available: v2", line: "Update available: v2 (bridge and decks; 1.0 MB to download).", status: "available", current: "v1", available: "v2", progress: -1, deferred: false, error: null, lastCheck: "2026-11-10T12:00:00Z",
    actions: [
      { id: "update-now", label: "Update now", enabled: true, title: "Update available: v2 (bridge and decks; 1.0 MB to download).", confirm: "Install update v2 now?\n\n…", confirmLocked: false },
      { id: "update-later", label: "Later", enabled: true, title: "No reminder for this update until you check again.", confirm: null, confirmLocked: false },
      { id: "update-check", label: "Check for updates", enabled: true, title: "Last checked 2026-11-10T12:00:00Z", confirm: null, confirmLocked: false }] };
  const uo = status(); uo.update = offered;
  const vo = P.viewModel(uo, none);
  same("vm: an offered update: the server's title and line, three buttons", [vo.update.title, vo.update.text, vo.update.actions.map((a) => [a.id, a.disabled])], ["Update available: v2", offered.line, [["update-now", false], ["update-later", false], ["update-check", false]]]);
  same("click: Update now asks first (its confirm), never confirmLocked", P.clickPlan(vo.update.actions[0], none), { do: "act", id: "update-now", confirm: "Install update v2 now?\n\n…", confirmLocked: false });
  same("click: Later and Check go straight through", [P.clickPlan(vo.update.actions[1], none), P.clickPlan(vo.update.actions[2], none)], [{ do: "act", id: "update-later", confirm: null, confirmLocked: false }, { do: "act", id: "update-check", confirm: null, confirmLocked: false }]);
  const ud = status();
  ud.update = { title: "Downloading update (40%)", line: "Downloading app.zip: 40% of 1.0 MB.", status: "downloading", available: "v2", progress: 40, actions: [{ id: "update-check", label: "Check for updates", enabled: false, title: "Last checked 2026-11-10T12:00:00Z", confirm: null, confirmLocked: false }] };
  const vd = P.viewModel(ud, none);
  same("vm: downloading: the progress in the title, Check disabled", [vd.update.title, vd.update.text, vd.update.actions[0].disabled], ["Downloading update (40%)", "Downloading app.zip: 40% of 1.0 MB.", true]);
  same("click: a disabled update button says its title, sends nothing", P.clickPlan(vd.update.actions[0], none), { do: "say", text: "Last checked 2026-11-10T12:00:00Z", kind: "warn" });
  same("vm: down: every update button disabled", P.viewModel(uo, { mode: "down", inflight: {} }).update.actions.every((a) => a.disabled), true);
  same("vm: update not an object: no section", [P.updateView("x", { down: false, inflight: {} }), P.updateView(null, { down: false, inflight: {} })], [null, null]);
}

// ───────────────────────────── pure: clicks, answers, polling, headers ─────────────────────────────
{
  const g = P.viewModel(gameOn(status()), { mode: "ok", inflight: {} });
  const ctx = { down: false, inflight: {} };
  same("click: a locked fix says the lock sentence, sends nothing", P.clickPlan(g.lights[2].button, ctx), { do: "say", text: LOCK, kind: "warn" });
  same("click: a disabled menu item says why", P.clickPlan(g.menu[0], ctx), { do: "say", text: LOCK, kind: "warn" });
  same("click: stop-everything in a game: act, with its confirm and confirmLocked", P.clickPlan(g.menu[1], ctx), { do: "act", id: "stop-everything", confirm: g.menu[1].confirm, confirmLocked: true });
  const r = P.viewModel(redFix(status(), false), { mode: "ok", inflight: {} });
  same("click: an open fix: act, never confirmLocked", P.clickPlan(r.lights[2].button, ctx), { do: "act", id: "fix:2:stack-restart", confirm: "Restart the relay and the Forge room (about 20 s)?", confirmLocked: false });
  same("click: down: not running, nothing sent", P.clickPlan(r.menu[0], { down: true, inflight: {} }), { do: "say", text: "The companion isn’t running.", kind: "bad" });
  same("click: in flight: nothing sent again", P.clickPlan(r.menu[0], { down: false, inflight: { "restart-engine": true } }).do, "say");
  same("click: nothing there", P.clickPlan(null, ctx), { do: "none" });

  same("answer: needConfirm asks with the message", P.answerPlan({ ok: false, needConfirm: true, message: "Game on." }), { do: "confirm", text: "Game on.\n\nStop anyway?" });
  same("answer: ok says the message", P.answerPlan({ ok: true, message: "Restarting." }), { do: "say", text: "Restarting.", kind: "ok" });
  same("answer: refused, no message", P.answerPlan({ ok: false }), { do: "say", text: "Refused.", kind: "warn" });
  same("answer: ok, no message", P.answerPlan({ ok: true }).text, "Done.");

  const c0 = { misses: 0, since: null, mode: "ok" };
  same("poll: ok: 2.5 s, 30 s when hidden", [P.afterPoll(c0, "ok", 0, false, true).delay, P.afterPoll(c0, "ok", 0, true, true).delay], [2500, 30000]);
  const f1 = P.afterPoll(c0, "fail", 100, false, true);
  same("poll: one miss: no banner yet, the time noted", [f1.conn.misses, f1.conn.mode, f1.conn.since, f1.delay], [1, "ok", 100, 2500]);
  const f2 = P.afterPoll(f1.conn, "fail", 2600, false, true);
  same("poll: two misses within 10 s: busy, retrying", [f2.conn.misses, f2.conn.mode, f2.conn.since], [2, "busy", 100]);
  same("poll: misses lasting 10 s: down", P.afterPoll({ misses: 4, since: 100, mode: "busy" }, "fail", 10100, false, true).conn.mode, "down");
  same("poll: just under 10 s: still busy", P.afterPoll({ misses: 4, since: 100, mode: "busy" }, "fail", 10099, false, true).conn.mode, "busy");
  same("poll: an answer clears it all", P.afterPoll({ misses: 9, since: 1, mode: "down" }, "ok", 99999, false, true), { conn: { misses: 0, since: null, mode: "ok" }, reload: false, delay: 2500 });
  same("poll: a stale token with the guard open: reload", P.afterPoll(c0, "stale", 0, false, true), { conn: { misses: 0, since: null, mode: "reconnecting" }, reload: true, delay: 2500 });
  same("poll: a stale token inside the guard: reconnecting, no reload", P.afterPoll(c0, "stale", 0, false, false), { conn: { misses: 0, since: null, mode: "reconnecting" }, reload: false, delay: 2500 });
  same("poll: one miss after reconnecting keeps reconnecting", P.afterPoll({ misses: 0, since: null, mode: "reconnecting" }, "fail", 5, false, true).conn.mode, "reconnecting");

  same("reload guard: 15 s", [P.reloadAllowed(0, 15000), P.reloadAllowed(1, 15000), P.reloadAllowed(0, 1e12), P.reloadAllowed(5000, 6000)], [true, false, true, false]);
  same("headers: the token; JSON adds the content type", [P.headers("t", false), P.headers("t", true)], [{ "X-MTG-Token": "t" }, { "X-MTG-Token": "t", "Content-Type": "application/json" }]);
}

// ───────────────────────────── the shell, with a stub env ─────────────────────────────

// (start() polls at once, so the first answer's body is given here)
function boot(body) {
  const dom = makeDom(), clock = makeClock(), store = {};
  const h = {
    dom, clock, store, $: (id) => dom.byId[id], body: body || status(), mode: "ok", calls: [], posts: [], answer: () => ({ ok: true, message: "Started." }),
    hold: false, releases: [], confirms: [], confirmAnswer: true, confirmQueue: [], reloads: 0, hidden: false, visible: null,
  };
  const resp = (st, body) => Promise.resolve({ status: st, ok: st >= 200 && st < 300, json: () => Promise.resolve(JSON.parse(JSON.stringify(body))) });
  const fetch = (url, opts) => {
    h.calls.push({ url, opts });
    if (url === "/api/status") {
      if (h.mode === "fail") return Promise.reject(new TypeError("Failed to fetch"));
      if (h.mode === "hang") return new Promise((res, rej) => { opts.signal.onabort = () => rej(new Error("aborted")); });
      if (h.mode === "stale") return resp(403, { error: "bad-token", message: "reload it" });
      if (h.mode === "500") return resp(500, { error: "error", message: "The companion hit an error." });
      return resp(200, h.body);
    }
    const body = JSON.parse(opts.body);
    h.posts.push({ body, headers: opts.headers, method: opts.method });
    if (h.postFail) return Promise.reject(new TypeError("Failed to fetch"));
    if (h.hold) return new Promise((r) => h.releases.push(() => r({ status: 200, ok: true, json: () => Promise.resolve(h.answer(body)) })));
    return resp(200, h.answer(body));
  };
  h.env = {
    document: dom.document, fetch, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, now: clock.now,
    hidden: () => h.hidden, confirm: (t) => { h.confirms.push(t); return h.confirmQueue.length ? h.confirmQueue.shift() : h.confirmAnswer; }, reload: () => { h.reloads++; },
    storage: { get: (k) => (k in store ? store[k] : null), set: (k, v) => { store[k] = String(v); } },
    onVisible: (f) => { h.visible = f; },
    AbortController: function () { const sig = { onabort: null }; this.signal = sig; this.abort = () => { h.aborts++; if (sig.onabort) sig.onabort(); }; },
  };
  h.aborts = 0;
  h.page = P.start(h.env);
  h.menuBtn = (id) => h.$("tools").children.find((b) => b.textContent.indexOf(id) >= 0);
  h.rowBtn = (i) => h.$("lights").children[i].children[2];
  h.toast = () => h.$("toast").textContent;
  return h;
}

(async () => {
  {
    const h = boot();
    ok("shell: before the first answer: six rows, connecting", h.$("lights").children.length === 6 && h.$("overall-text").textContent === "Connecting…");
    await h.clock.advance(0);
    const st = h.calls[0];
    same("shell: the first poll: GET /api/status with the token header", [st.url, st.opts.headers["X-MTG-Token"], st.opts.cache], ["/api/status", TOKEN, "no-store"]);
    same("shell: drawn: header, phase, footer, hint, log", [h.$("overall").className, h.$("overall-text").textContent, h.$("phase").textContent, h.$("updated").textContent, h.$("hint").textContent, h.$("log").textContent],
      ["pill green", "Ready", "Ready", "Updated 12:00:00", "In TTS: Create, Singleplayer.", "one\ntwo"]);
    same("shell: the next poll in 2.5 s, only one armed", h.clock.polls(), [2500]);
    same("shell: the menu buttons drawn enabled", h.$("tools").children.map((b) => [b.textContent, b.getAttribute("aria-disabled"), b.className]),
      [["Restart engine", "false", "btn"], ["Stop everything", "false", "btn danger"], ["Open logs folder", "false", "btn"]]);
    await h.clock.advance(2500);
    same("shell: it polls again after 2.5 s", h.calls.filter((c) => c.url === "/api/status").length, 2);
    h.hidden = true;
    await h.clock.advance(2500);
    same("shell: a hidden tab polls every 30 s", h.clock.polls(), [30000]);
    h.hidden = false;
    h.visible();
    await h.clock.advance(0);
    same("shell: coming back visible polls at once, one timer left", [h.calls.filter((c) => c.url === "/api/status").length, h.clock.polls()], [4, [2500]]);
    h.page.poll(); h.page.poll();
    await h.clock.advance(0);
    same("shell: overlapping polls leave one timer, not two", h.clock.polls(), [2500]);
    await h.clock.advance(7000);
    same("shell: answered polls cancel their 6 s abort", h.aborts, 0);
    h.mode = "hang";
    await h.clock.advance(2500);
    await h.clock.advance(6000);
    same("shell: a poll with no answer is aborted at 6 s, and the next one armed", [h.aborts, h.clock.polls().length], [1, 1]);
  }

  {
    const h = boot();
    await h.clock.advance(0);
    h.mode = "fail";
    await h.clock.advance(2500);
    same("shell: one miss: nothing shown yet, still polling", [h.$("conn").hidden, h.$("down").hidden, h.clock.polls()], [true, true, [2500]]);
    await h.clock.advance(2500);
    same("shell: two misses: Companion busy, retrying", [h.$("conn").hidden, h.$("conn-title").textContent, h.$("down").hidden, h.$("overall-text").textContent], [false, "Companion busy, retrying", true, "Ready"]);
    await h.clock.advance(10000);
    same("shell: misses for 10 s: not running, menu disabled, still polling", [h.$("down").hidden, h.$("conn").hidden, h.$("overall-text").textContent, h.dom.document.title, h.dom.document.body.className,
      h.$("tools").children.every((b) => b.getAttribute("aria-disabled") === "true"), h.clock.polls().length], [false, true, "Companion not running", "MTG Companion (not running)", "is-down", true, 1]);
    const n = h.posts.length;
    h.$("tools").children[0].click();
    ok("shell: a click while down sends nothing and says so", h.posts.length === n && h.toast() === "The companion isn’t running.", h.toast());
    h.mode = "ok";
    await h.clock.advance(2500);
    same("shell: an answer again: banners gone, buttons back", [h.$("down").hidden, h.$("conn").hidden, h.dom.document.body.className, h.$("tools").children[0].getAttribute("aria-disabled")], [true, true, "", "false"]);
    h.mode = "500";
    await h.clock.advance(5000);
    same("shell: HTTP 500s count as misses (busy), polling goes on", [h.$("conn").hidden, h.clock.polls()], [false, [2500]]);
  }

  {
    const h = boot();
    await h.clock.advance(0);
    h.$("logo-dot").throwOnce = true;
    h.body = redFix(status(), false);
    await h.clock.advance(2500);
    same("shell: a draw that throws: the error banner, and the poll is armed again", [h.$("pageerr").hidden, h.$("pageerr-text").textContent.indexOf("boom") >= 0, h.clock.polls()], [false, true, [2500]]);
    await h.clock.advance(2500);
    same("shell: the next good draw hides the error and shows the new lights", [h.$("pageerr").hidden, h.$("overall").className, h.calls.filter((c) => c.url === "/api/status").length], [true, "pill red", 3]);
  }

  {
    const h = boot();
    await h.clock.advance(0);
    h.mode = "stale";
    await h.clock.advance(2500);
    same("shell: a stale token: reload once, the time noted", [h.reloads, h.store["mtg-reload"]], [1, String(h.clock.now())]);
    await h.clock.advance(2500);
    same("shell: stale again inside 15 s: no second reload, Reconnecting, not 'not running'", [h.reloads, h.$("conn").hidden, h.$("conn-title").textContent, h.$("down").hidden, h.clock.polls()], [1, false, "Reconnecting", true, [2500]]);
    await h.clock.advance(12500);
    same("shell: past the 15 s guard: reload again", h.reloads, 2);
  }

  {
    const h = boot(redFix(status(), false));
    await h.clock.advance(0);
    const b = h.rowBtn(2);
    same("shell: a red light's fix button", [b.hidden, b.textContent, b.className, b.getAttribute("aria-disabled"), b.getAttribute("aria-label")], [false, "Restart relay and room", "btn fix", "false", "Restart relay and room (Engine stack)"]);
    h.confirmAnswer = false;
    b.click();
    ok("shell: its confirm declined: nothing sent", h.confirms.length === 1 && h.posts.length === 0, h.confirms);
    h.confirmAnswer = true;
    h.hold = true;
    b.click();
    await flush();
    same("shell: confirmed: POST with the token and JSON type", [h.posts.length, h.posts[0].method, h.posts[0].body, h.posts[0].headers], [1, "POST", { id: "fix:2:stack-restart", confirmLocked: false }, { "X-MTG-Token": TOKEN, "Content-Type": "application/json" }]);
    same("shell: in flight: the button disabled and busy", [b.getAttribute("aria-disabled"), b.getAttribute("aria-busy"), h.toast()], ["true", "true", "Working…"]);
    b.click();
    await flush();
    ok("shell: a second click in flight sends nothing", h.posts.length === 1 && h.confirms.length === 2, h.posts.length);
    h.releases[0]();
    await flush(); await flush();
    same("shell: answered: enabled again, the message shown, a poll soon", [b.getAttribute("aria-disabled"), b.getAttribute("aria-busy"), h.toast(), h.$("toast").className, h.clock.polls()], ["false", "false", "Started.", "toast ok", [400]]);
    h.hold = false;
    h.postFail = true;
    b.click();
    for (let i = 0; i < 4; i++) await flush();
    same("shell: an action with no answer: says so, the button usable again", [h.posts.length, h.toast(), h.$("toast").className, b.getAttribute("aria-disabled"), b.getAttribute("aria-busy")], [2, "The companion didn’t answer.", "toast bad", "false", "false"]);
  }

  {
    const h = boot(gameOn(status()));
    await h.clock.advance(0);
    const b = h.rowBtn(2);
    same("shell: game on: the banner", [h.$("game").hidden, h.$("game").className, h.$("game-title").textContent], [false, "banner game", "Game in progress"]);
    same("shell: game on: the fix drawn locked with the sentence", [b.getAttribute("aria-disabled"), b.title, b.getAttribute("aria-label")], ["true", LOCK, `Restart relay and room (Engine stack). ${LOCK}`]);
    b.click();
    ok("shell: game on: clicking the locked fix sends nothing, says the lock", h.posts.length === 0 && h.confirms.length === 0 && h.toast() === LOCK, h.toast());
    const restart = h.$("tools").children[0];
    same("shell: game on: Restart engine drawn disabled", [restart.getAttribute("aria-disabled"), restart.title], ["true", LOCK]);
    restart.click();
    ok("shell: game on: clicking Restart engine sends nothing", h.posts.length === 0 && h.toast() === LOCK);
    h.$("tools").children[1].click();
    await flush(); await flush();
    same("shell: game on: Stop everything asks, then sends confirmLocked", [h.confirms.length, h.posts.map((p) => p.body)], [1, [{ id: "stop-everything", confirmLocked: true }]]);
    h.body = status();
    await h.clock.advance(2500);
    ok("shell: the game over: the banner hides", h.$("game").hidden === true);
  }

  {
    const h = boot();
    await h.clock.advance(0);
    h.answer = (body) => (body.confirmLocked ? { ok: true, message: "Stopping." } : { ok: false, needConfirm: true, message: "A game just started." });
    h.confirmQueue = [true, false]; // (the button's own confirm, then the answer's)
    h.$("tools").children[1].click();
    await flush(); await flush(); await flush();
    same("shell: needConfirm, declined: asked with the message, nothing more sent", [h.posts.length, h.confirms[1], h.toast()], [1, "A game just started.\n\nStop anyway?", "Nothing was changed."]);
    h.confirmQueue = [true, true];
    h.$("tools").children[1].click();
    for (let i = 0; i < 6; i++) await flush();
    same("shell: needConfirm, accepted: sent again with confirmLocked", [h.posts.map((p) => p.body.confirmLocked), h.toast()], [[false, false, true], "Stopping."]);
  }

  {
    const up = status();
    up.update = { line: "Version 1.3 is ready.", actions: [{ id: "update-now", label: "Install now", enabled: true, title: "", confirm: null, confirmLocked: false }] };
    const h = boot(up);
    await h.clock.advance(0);
    const box = h.$("update-actions");
    same("shell: the update section shows with its button", [h.$("update").hidden, h.$("update-text").textContent, box.children.length, box.children[0].textContent], [false, "Version 1.3 is ready.", 1, "Install now"]);
    box.children[0].click();
    await flush();
    same("shell: its button posts its id", h.posts.map((p) => p.body.id), ["update-now"]);
    h.body = status();
    await h.clock.advance(2500);
    same("shell: no update any more: the section and its button hide", [h.$("update").hidden, box.children[0].hidden], [true, true]);
  }

  {
    // the section as the companion sends it: its title, then a download in progress
    const up = status();
    up.update = { title: "Update available: v2", line: "Update available: v2 (1.0 MB to download).", status: "available", available: "v2",
      actions: [{ id: "update-now", label: "Update now", enabled: true, title: "", confirm: null, confirmLocked: false }, { id: "update-check", label: "Check for updates", enabled: true, title: "", confirm: null, confirmLocked: false }] };
    const h = boot(up);
    await h.clock.advance(0);
    const box = h.$("update-actions");
    same("shell: the server's update title and both buttons", [h.$("update-title").textContent, box.children.map((b) => b.textContent)], ["Update available: v2", ["Update now", "Check for updates"]]);
    box.children[0].click();
    await flush();
    same("shell: Update now posts update-now", h.posts.map((p) => p.body.id), ["update-now"]);
    const dl = status();
    dl.update = { title: "Downloading update (40%)", line: "Downloading app.zip: 40%.", status: "downloading", available: "v2", progress: 40,
      actions: [{ id: "update-check", label: "Check for updates", enabled: false, title: "Busy.", confirm: null, confirmLocked: false }] };
    h.body = dl;
    await h.clock.advance(2500);
    for (let i = 0; i < 4; i++) await flush();
    same("shell: downloading: the new title and line, Update now gone, Check disabled", [h.$("update-title").textContent, h.$("update-text").textContent, box.children.filter((b) => !b.hidden).map((b) => [b.textContent, b.getAttribute("aria-disabled")])],
      ["Downloading update (40%)", "Downloading app.zip: 40%.", [["Check for updates", "true"]]]);
  }

  {
    // the bootstrap: in a browser-like context the script starts itself with the real window functions
    const dom = makeDom(), clock = makeClock(), calls = [];
    const win = {
      fetch: (u, o) => { calls.push([u, o]); return new Promise(() => { }); },
      setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, confirm: () => true, location: { reload() { } },
      sessionStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }, AbortController: undefined,
    };
    load({ document: dom.document, window: win });
    same("bootstrap: starts by itself: one status poll with the page's token", calls.map((c) => [c[0], c[1].headers["X-MTG-Token"]]), [["/api/status", TOKEN]]);
    ok("bootstrap: listens for the tab coming back", (dom.document.listeners.visibilitychange || []).length === 1);
  }

  process.stdout.write(`${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL crashed: ${e && e.stack}`); process.exit(1); });
