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
  const tags = [...html.matchAll(/<(button|select|input|textarea|summary)\b([^>]*)>/g)];
  ok("static: every control in the page has an id (so the script gives it a tooltip)", tags.length >= 14 && tags.every((t) => /\sid='[^']+'/.test(t[2])), tags.filter((t) => !/\sid='/.test(t[2])).map((t) => t[0]).join(" "));
  ok("static: the tooltip box and the describedby holder are there, the box hidden from readers", /<div class='tip' id='tip' aria-hidden='true' hidden>/.test(html) && /<div id='tipdefs' hidden><\/div>/.test(html));
  ok("static: no native title tooltips anywhere (one styled tooltip for all)", !/\stitle='/.test(html) && !/(?<!doc)\.title\s*=/.test(script));
  const moving = html.split("\n").filter((l) => /animation:|transition:/.test(l));
  ok("static: animations and transitions only when the reader allows motion", moving.length >= 4 && moving.every((l) => l.startsWith("@media (prefers-reduced-motion: no-preference)")), moving.filter((l) => !l.startsWith("@media")).join("\n"));
  // (tools/make-friend-package-unix.js ships this page as companion/page.html and refuses unreadable files; the
  // Linux/Mac companion swaps its one Windows-only sentence and checks that no other '.exe' is left)
  ok("static: readable as shipped: no line over 1000 characters, no base64 run", html.split("\n").every((l) => l.length <= 1000) && !/[A-Za-z0-9+/]{200,}={0,2}/.test(html));
  ok("static: the only '.exe' is the down banner's sentence the Linux/Mac companion replaces", html.split(".exe").length === 2 && html.includes("Start MTG Companion.exe again."));
  ok("static: icons are drawn here (data: SVGs), nothing from outside", !/url\((?!'data:)/.test(html));
}

// ───────────────────────────── a stub DOM built from the page's ids ─────────────────────────────

class El {
  constructor(tag, id) {
    this.tagName = tag; this.id = id || ""; this.attrs = {}; this.children = []; this.className = ""; this._text = "";
    this.hidden = false; this.listeners = {}; this.title = ""; this.type = ""; this.scrollTop = 0; this.clientHeight = 100; this.scrollHeight = 100;
    this.throwOnce = false;
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; } // (as a browser: the text replaces the children)
  setAttribute(k, v) { if (this.throwOnce) { this.throwOnce = false; throw new Error("boom in setAttribute"); } this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  click() { (this.listeners.click || []).forEach((f) => f()); }
  fire(t, ev) { (this.listeners[t] || []).forEach((f) => f(ev || {})); }
}
// every element under the given roots (the page's own and the ones the script made), once each
function allEls(roots) {
  const seen = new Set(), out = [];
  const walk = (e) => { if (!e || seen.has(e)) return; seen.add(e); out.push(e); (e.children || []).forEach(walk); };
  roots.forEach(walk);
  return out;
}
const CONTROLS = new Set(["button", "select", "input", "textarea", "summary"]);

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
  const NOWL = "\nRight now: ";
  same("tip: every menu button says what it does, its icon set", g.menu.map((x) => [x.id, x.tip.split(":")[0], !!x.icon]),
    [["restart-engine", "Restart engine", true], ["stop-everything", "Stop everything", true], ["open-logs", "Open logs folder", true]]);
  same("tip: game on: Restart engine's tip says it's locked during a game, and why right now", [/Locked while a game is on/.test(g.menu[0].tip), g.menu[0].tip.endsWith(NOWL + LOCK)], [true, true]);
  same("tip: game on: the locked fix's tip starts with its label and ends with the lock", [gb.tip.startsWith("Restart relay and room: "), gb.tip.endsWith(NOWL + LOCK), gb.icon], [true, true, "restart"]);
  ok("tip: an unlocked button has no 'Right now' line", g.menu[1].tip.indexOf(NOWL) < 0 && /ends that game for everyone/.test(g.menu[1].tip));
  ok("tip: Open logs folder names the folder", v.menu[2].tip.endsWith("\nFolder: C:\\pkg\\logs"));
  const ob2 = status(); ob2.observe = true; ob2.menu[0] = { ...ob2.menu[0], enabled: false, title: "Observe mode: nothing is changed." };
  ok("tip: observe mode: the locked button says so", P.viewModel(ob2, none).menu[0].tip.endsWith(NOWL + "Observe mode: nothing is changed."));
  const fx = (fix, label) => P.lightButton({ id: `fix:0:${fix}`, label, locked: false }, "Docker", { down: false, inflight: {} });
  same("tip: each fix kind its own words and icon", [fx("retry", "Try again"), fx("docker-start", "Start Docker Desktop"), fx("tts-open", "Open TTS"), fx("show-program", "Show the program"), fx("new-thing", "New")].map((x) => [x.tip.split(": ")[0], x.icon]),
    [["Try again", "restart"], ["Start Docker Desktop", "play"], ["Open TTS", "open"], ["Show the program", "window"], ["New", "wrench"]]);
  ok("tip: an unknown fix still gets a sentence", fx("new-thing", "New").tip === "New: the companion’s fix for the Docker step.");
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
  ok("tip: down: every button's tip says the companion isn't running", d.menu.concat([d.lights[2].button]).every((x) => x.tip.endsWith("\nRight now: The companion isn’t running.")));
  ok("tip: in flight: waiting for the answer", fl.menu[0].tip.endsWith("\nRight now: sent; waiting for the companion’s answer."));
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
  same("tip: a disabled update button says it's busy with an update (not its title), and when it last checked", [vd.update.actions[0].tip.endsWith("\nRight now: an update is being checked, downloaded or installed."), vd.update.actions[0].tip.indexOf("\nLast checked 2026-11-10T12:00:00Z\n") > 0],
    [true, true]);
  same("tip: Update now and Later say what they do", [/installs 2 minutes after the game ends/.test(vo.update.actions[0].tip), vo.update.actions[1].tip.startsWith("Later: no reminder"), vo.update.actions.map((a) => a.icon)], [true, true, ["download", "clock", "search"]]);
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
    if (url === "/api/tools" && !opts.method) return h.toolsFail ? Promise.reject(new TypeError("Failed to fetch")) : resp(h.toolsStatus || 200, h.tools);
    const body = JSON.parse(opts.body);
    h.posts.push({ body, headers: opts.headers, method: opts.method, url });
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
    same("shell: game on: the fix drawn locked with the sentence (its tooltip and label)", [b.getAttribute("aria-disabled"), b.getAttribute("data-tip").endsWith(`\nRight now: ${LOCK}`), b.getAttribute("aria-label")], ["true", true, `Restart relay and room (Engine stack). ${LOCK}`]);
    b.click();
    ok("shell: game on: clicking the locked fix sends nothing, says the lock", h.posts.length === 0 && h.confirms.length === 0 && h.toast() === LOCK, h.toast());
    const restart = h.$("tools").children[0];
    same("shell: game on: Restart engine drawn disabled, its tooltip saying why", [restart.getAttribute("aria-disabled"), restart.getAttribute("data-tip").endsWith(`\nRight now: ${LOCK}`)], ["true", true]);
    ok("shell: no native title tooltips on the buttons (the page draws its own)", [b, restart].every((x) => x.title === ""));
    restart.fire("mouseenter");
    same("tip: hovering a locked button shows the tooltip with why it's locked", [h.$("tip").hidden, h.$("tip-text").textContent.startsWith("Restart engine: stops the bridge"), h.$("tip-now").hidden, h.$("tip-now").textContent],
      [false, true, false, `Right now: ${LOCK}`]);
    restart.fire("mouseleave");
    ok("tip: it stays a moment after the pointer leaves", h.$("tip").hidden === false);
    await h.clock.advance(250);
    ok("tip: then hides", h.$("tip").hidden === true);
    h.$("tools").children[1].fire("focus");
    same("tip: keyboard focus shows it too; an unlocked button has no 'Right now' line", [h.$("tip").hidden, h.$("tip-text").textContent.startsWith("Stop everything:"), h.$("tip-now").hidden], [false, true, true]);
    h.$("tools").children[1].fire("blur");
    ok("tip: blur hides it", h.$("tip").hidden === true);
    h.$("tools").children[1].fire("focus");
    h.dom.document.listeners.keydown.forEach((f) => f({ key: "Escape" }));
    ok("tip: Escape hides it", h.$("tip").hidden === true);
    restart.fire("mouseenter");
    restart.fire("mouseleave");
    h.$("tools").children[1].fire("mouseenter");
    await h.clock.advance(250);
    same("tip: moving to the next button shows its tip, not the old one hiding it", [h.$("tip").hidden, h.$("tip-text").textContent.startsWith("Stop everything:")], [false, true]);
    ok("static: the tooltip lets clicks through, so it never covers the next control", /\.tip \{[^}]*pointer-events: none;/.test(html));
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

  // ───────────────────────────── table tools (GET/POST /api/tools) ─────────────────────────────
  const TOOLS = () => ({
    seats: [{ color: "White", person: false, ai: null }, { color: "Red", person: false, ai: { kind: "harmless", kindLabel: "Harmless bot", deckName: "Passive AI (lands only)", source: "ai_passive_lands" } },
      { color: "Yellow", person: false, ai: { kind: "forge", kindLabel: "Forge AI", deckName: "My Neheb", source: "list" } }, { color: "Blue", person: true, ai: null }],
    presets: ["ai_passive_lands", "kykar_winds_fury"],
    debug: { on: true, game: true, fix: false, players: [{ color: "Blue", name: "Blue" }, { color: "White", name: "AI 1" }] }, tools: ["mana", "hand", "battlefield", "life", "untap"],
  });
  {
    const v = P.toolsView(TOOLS());
    same("tools: seats with their kind, deck choice and words", v.seats.map((s) => [s.color, s.kind, s.deck, s.status]), [
      ["White", "off", "", "No AI set: Start’s AI count decides."], ["Red", "harmless", "ai_passive_lands", "Harmless bot, playing Passive AI (lands only)"],
      ["Yellow", "forge", P.LIST_CHOICE, "Forge AI, playing My Neheb"], ["Blue", "off", "", "A person plays it this game."]]);
    same("tools: debug on, usable, the players", [v.ok, v.debug.on, v.debug.usable, v.debug.players], [true, true, true, [{ color: "Blue", name: "Blue" }, { color: "White", name: "AI 1" }]]);
    const off = TOOLS(); off.debug.on = false;
    const fix = TOOLS(); fix.debug.fix = true;
    const nog = TOOLS(); nog.debug.game = false;
    same("tools: off / a fix under way / no game: not usable, each said", [P.toolsView(off).debug, P.toolsView(fix).debug.usable, P.toolsView(fix).debug.note, P.toolsView(nog).debug.note].map((x) => (typeof x === "object" ? [x.on, x.usable, x.note] : x)),
      [[false, false, "Off. Switch them on to change the running game."], false, "On. A manual fix is under way: wait for it to end.", "On. No table game is running."]);
    const down = P.toolsView({ error: "no-bridge", message: "The bridge isn't running: start the engine first (the Bridge light)." });
    same("tools: the companion's refusal: its words, nothing to set", [down.ok, down.state, down.seats.length], [false, "The bridge isn't running: start the engine first (the Bridge light).", 0]);
    same("tools: nothing at all: a plain line", P.toolsView(null).state, "The bridge isn’t answering: start the engine first.");
    const S = P.seatRequest;
    same("seat: None clears it", S("Red", "off", "x", "y", "z"), { kind: "ai-seat", color: "Red", seat: "off" });
    same("seat: a preset", S("Red", "forge", "kykar_winds_fury", "", ""), { kind: "ai-seat", color: "Red", seat: "forge", preset: "kykar_winds_fury" });
    same("seat: harmless with no deck picked: the bridge's own", S("Red", "harmless", "", "", ""), { kind: "ai-seat", color: "Red", seat: "harmless" });
    same("seat: a list, its name trimmed", S("Red", "forge", P.LIST_CHOICE, "1 Shock", "  Mine "), { kind: "ai-seat", color: "Red", seat: "forge", list: "1 Shock", name: "Mine" });
    const TOO_LONG = "That deck list is too long: the page can send 16 KB at most.";
    same("seat: refusals", [S("Red", "forge", "", "", "").error, S("Red", "forge", P.LIST_CHOICE, "  ", "").error, S("Red", "?", "", "", "").error],
      ["Pick a deck for the Forge AI.", "Paste a deck list, or pick a file, first.", "Pick who plays it."]);
    // (the companion reads 16,384 body bytes at most: the body as sent, UTF-8 and JSON escapes, is what is measured)
    const room = 16384 - Buffer.byteLength(JSON.stringify({ kind: "ai-seat", color: "Red", seat: "forge", list: "" }));
    same("seat: a list whose body is exactly 16 KB is sent; one byte more is refused", [S("Red", "forge", P.LIST_CHOICE, "x".repeat(room), "").error, S("Red", "forge", P.LIST_CHOICE, "x".repeat(room + 1), "").error],
      [undefined, TOO_LONG]);
    same("seat: the deck name counts too", S("Red", "forge", P.LIST_CHOICE, "x".repeat(room - 10), "Mine").error, TOO_LONG);
    same("seat: under 15,000 characters but over 16 KB sent (line breaks escaped, accents two bytes): refused",
      [S("Red", "forge", P.LIST_CHOICE, "1 Opt\r\n".repeat(2000), "").error, S("Red", "forge", P.LIST_CHOICE, "é".repeat(9000), "").error, S("Red", "forge", P.LIST_CHOICE, "🂡".repeat(4200), "").error], [TOO_LONG, TOO_LONG, TOO_LONG]);
    same("seat: accents just under 16 KB sent: accepted", S("Red", "forge", P.LIST_CHOICE, "é".repeat(Math.floor(room / 2)), "").error, undefined);
    same("seat: a 4-byte character (a surrogate pair) counts 4: just under 16 KB accepted, one more refused",
      [S("Red", "forge", P.LIST_CHOICE, "🂡".repeat(Math.floor(room / 4)), "").error, S("Red", "forge", P.LIST_CHOICE, "🂡".repeat(Math.floor(room / 4) + 1), "").error], [undefined, TOO_LONG]);
    const D = P.debugRequest;
    same("debug: mana", D("mana", "Blue", "3", "", "R"), { kind: "debug", tool: "mana", color: "Blue", n: 3, mana: "R" });
    same("debug: a card", D("hand", "Blue", "", " Opt ", "R"), { kind: "debug", tool: "hand", color: "Blue", name: "Opt" });
    same("debug: untap needs only the player", D("untap", "White", "x", "", ""), { kind: "debug", tool: "untap", color: "White" });
    same("debug: refusals", [D("life", "", "3").error, D("life", "Blue", "2.5").error, D("life", "Blue", "").error, D("battlefield", "Blue", "", " ").error],
      ["Pick a player.", "Type a whole number in Number.", "Type a whole number in Number.", "Type a card name in Card."]);
    same("debug: draw and mill take Number", [D("draw", "Blue", "2", "x", "R"), D("mill", "White", " 5 ", "", "")],
      [{ kind: "debug", tool: "draw", color: "Blue", n: 2 }, { kind: "debug", tool: "mill", color: "White", n: 5 }]);
    same("debug: draw and mill refusals", [D("draw", "Blue", "").error, D("mill", "Blue", "1.5").error], ["Type a whole number in Number.", "Type a whole number in Number."]);
    same("tools: the bridge's tool list is kept", P.toolsView(TOOLS()).debug.tools, ["mana", "hand", "battlefield", "life", "untap"]);
  }
  {
    const h = boot();
    h.tools = TOOLS();
    await h.clock.advance(0);
    ok("tools: closed: the bridge is never asked", !h.calls.some((c) => c.url === "/api/tools"));
    h.$("tablebox").open = true;
    h.$("tablebox").listeners.toggle.forEach((f) => f());
    for (let i = 0; i < 4; i++) await flush();
    const get = h.calls.find((c) => c.url === "/api/tools");
    same("tools: opened: GET /api/tools with the token", [get && get.opts.headers["X-MTG-Token"], get && get.opts.method], [TOKEN, undefined]);
    const rows = h.$("tt-seats").children;
    same("tools: a row per seat, its colour and words", rows.map((r) => [r.children[0].children[0].textContent, r.children[0].children[1].textContent]),
      [["White", "No AI set: Start’s AI count decides."], ["Red", "Harmless bot, playing Passive AI (lands only)"], ["Yellow", "Forge AI, playing My Neheb"], ["Blue", "A person plays it this game."]]);
    const yellow = rows[2], kind = yellow.children[1].children[0], deck = yellow.children[1].children[1], setBtn = yellow.children[1].children[2], listBox = yellow.children[2];
    same("tools: the seat's current choice is selected; a list's box shown", [kind.value, deck.value, listBox.hidden, deck.children.map((o) => o.value)], ["forge", P.LIST_CHOICE, false, ["", "ai_passive_lands", "kykar_winds_fury", P.LIST_CHOICE]]);
    same("tools: debug on: the box and the players", [h.$("tt-debug").checked, h.$("tt-dbg").hidden, h.$("tt-player").children.map((o) => [o.value, o.textContent]), h.$("tt-mana-btn").getAttribute("aria-disabled")],
      [true, false, [["Blue", "Blue"], ["White", "AI 1 (White)"]], "false"]);
    setBtn.click();
    await flush();
    same("tools: Set with an empty list: said, nothing sent", [h.$("tt-toast").textContent, h.posts.length], ["Paste a deck list, or pick a file, first.", 0]);
    listBox.children[0].value = "Commander\n1 Neheb, the Worthy\n1 Shock";
    listBox.children[1].value = "Mine";
    h.answer = () => ({ ok: true, message: "Yellow: Forge AI playing Mine." });
    setBtn.click();
    for (let i = 0; i < 4; i++) await flush();
    same("tools: Set: POST /api/tools with the list, the answer said, the tools asked again", [h.posts[0] && h.posts[0].url, h.posts[0] && h.posts[0].body, h.$("tt-toast").textContent, h.calls.filter((c) => c.url === "/api/tools" && !c.opts.method).length],
      ["/api/tools", { kind: "ai-seat", color: "Yellow", seat: "forge", list: "Commander\n1 Neheb, the Worthy\n1 Shock", name: "Mine" }, "Yellow: Forge AI playing Mine.", 2]);
    h.$("tt-player").value = "White"; h.$("tt-n").value = "7";
    h.answer = () => ({ ok: false, message: "A manual fix is already under way: finish it first." });
    h.$("tt-life-btn").click();
    for (let i = 0; i < 4; i++) await flush();
    same("tools: Set life: the debug body; a refusal said as a warning", [h.posts[1] && h.posts[1].body, h.$("tt-toast").textContent, h.$("tt-toast").className], [{ kind: "debug", tool: "life", color: "White", n: 7 }, "A manual fix is already under way: finish it first.", "toast warn"]);
    h.$("tt-debug").checked = false;
    h.$("tt-debug").listeners.change.forEach((f) => f());
    for (let i = 0; i < 4; i++) await flush();
    same("tools: the switch posts debug-mode", h.posts[2] && h.posts[2].body, { kind: "debug-mode", on: false });
    const t2 = TOOLS(); t2.debug.on = false; h.tools = t2;
    await h.clock.advance(2500);
    for (let i = 0; i < 4; i++) await flush();
    same("tools: while open they follow the status poll; off hides the tools", [h.$("tt-dbg").hidden, h.$("tt-mana-btn").getAttribute("aria-disabled")], [true, "true"]);
    const n = h.posts.length;
    h.$("tt-mana-btn").click();
    await flush();
    same("tools: a tool pressed while off: says why, sends nothing", [h.$("tt-toast").textContent, h.posts.length], ["Off. Switch them on to change the running game.", n]);
    h.toolsFail = true;
    await h.clock.advance(2500);
    for (let i = 0; i < 4; i++) await flush();
    same("tools: no answer: said, the switch disabled", [h.$("tt-state").textContent, h.$("tt-debug").disabled], ["The bridge isn’t answering: start the engine first.", true]);
    h.$("tablebox").open = false;
    h.$("tablebox").listeners.toggle.forEach((f) => f());
    const asked = h.calls.filter((c) => c.url === "/api/tools").length;
    await h.clock.advance(2500);
    for (let i = 0; i < 4; i++) await flush();
    ok("tools: closed again: no more asking", h.calls.filter((c) => c.url === "/api/tools").length === asked);
  }
  {
    // Draw and Mill: shown only when the bridge lists them (a bridge from before them would refuse them by name)
    const h = boot();
    h.tools = TOOLS();
    h.$("tablebox").open = true;
    h.$("tablebox").listeners.toggle.forEach((f) => f());
    for (let i = 0; i < 4; i++) await flush();
    same("tools: an older bridge's list: Draw and Mill hidden, the others shown", ["draw", "mill", "mana", "untap"].map((id) => h.$(`tt-${id}-btn`).hidden), [true, true, false, false]);
    const t2 = TOOLS(); t2.tools = t2.tools.concat(["draw", "mill"]); h.tools = t2;
    await h.clock.advance(2500);
    for (let i = 0; i < 4; i++) await flush();
    same("tools: a list with draw and mill: both shown and usable", ["draw", "mill"].map((id) => [h.$(`tt-${id}-btn`).hidden, h.$(`tt-${id}-btn`).getAttribute("aria-disabled")]), [[false, "false"], [false, "false"]]);
    h.$("tt-player").value = "Blue"; h.$("tt-n").value = "3";
    h.answer = () => ({ ok: true, message: "Debug tool: make Blue draw 3 cards." });
    h.$("tt-draw-btn").click();
    for (let i = 0; i < 4; i++) await flush();
    same("tools: Draw: the debug body, the answer said", [h.posts[0] && h.posts[0].body, h.$("tt-toast").textContent], [{ kind: "debug", tool: "draw", color: "Blue", n: 3 }, "Debug tool: make Blue draw 3 cards."]);
    h.$("tt-player").value = "White"; h.$("tt-n").value = "4";
    h.$("tt-mill-btn").click();
    for (let i = 0; i < 4; i++) await flush();
    same("tools: Mill: the debug body", h.posts[1] && h.posts[1].body, { kind: "debug", tool: "mill", color: "White", n: 4 });
  }
  {
    // the Starting hand box (bridge toolsState().hand: each colour's next deck, its card names, the hand waiting).
    // Blue's deck is the default Neheb, the Worthy preset's (manabrew/public/preset_decks), here a few of its names.
    const NEHEB = ["Fire-Belly Changeling", "Heated Debate", "Lightning Bolt", "Mountain", "Vraska's Fall"];
    const HAND = (blueWaiting) => ({ max: 7, seats: [
      { color: "White", deck: "Kykar, Wind's Fury", source: "preset", cards: ["Island", "Opt"], waiting: null, added: [] },
      { color: "Red", deck: null, source: null, cards: [], waiting: null, added: [] },
      { color: "Yellow", deck: "Neheb, the Worthy", source: "default", cards: NEHEB, waiting: null, added: [] },
      { color: "Blue", deck: "Neheb, the Worthy", source: "table", cards: NEHEB, waiting: blueWaiting, added: (blueWaiting || []).filter((n) => !NEHEB.includes(n)) }] });
    const boxes = (h) => [1, 2, 3, 4, 5, 6, 7].map((k) => h.$(`tt-hand-${k}`).value || "");
    same("hand: an older bridge (no hand part): nothing to show", [P.toolsView(TOOLS()).hand.known, P.handView(undefined).max], [false, 7]);
    same("hand: the note for a seat with a hand waiting: its deck, the cards, how many dealt, the added ones",
      P.handNote(P.handView(HAND(["Lightning Bolt", "Counterspell"])).seats[3], 7),
      "Blue plays Neheb, the Worthy (the deck checked on the table). Waiting for the next game: Lightning Bolt, Counterspell, and 5 dealt at random. Not in the deck, so added: Counterspell.");
    same("hand: the note for a seat whose deck can't be read, and for the engine's default", [P.handNote(P.handView(HAND(null)).seats[1], 7), P.handNote(P.handView(HAND(null)).seats[2], 7)],
      ["Red’s deck can’t be read now: whether the cards are in it is said when the game starts. Nothing waiting: the next game deals as usual.",
        "Yellow plays Neheb, the Worthy (the engine’s default deck: mtg ready reads the one on your table). Nothing waiting: the next game deals as usual."]);
    same("hand: Set's body: the boxes in order, empty ones left out; none or no seat refused", [P.handRequest("Blue", ["", " Shock ", "", "Neheb, the Worthy"]), P.handRequest("Blue", ["", " "]), P.handRequest("", ["Shock"])],
      [{ kind: "hand", color: "Blue", names: ["Shock", "Neheb, the Worthy"] }, { error: "Type at least one card name (or press Clear)." }, { error: "Pick a seat." }]);

    const h = boot();
    h.tools = TOOLS();
    h.$("tablebox").open = true;
    h.$("tablebox").listeners.toggle.forEach((f) => f());
    for (let i = 0; i < 4; i++) await flush();
    ok("hand: a bridge without it: the box hidden", h.$("tt-hand").hidden === true);
    const t = TOOLS(); t.hand = HAND(["Lightning Bolt", "Counterspell"]); h.tools = t;
    await h.clock.advance(2500);
    for (let i = 0; i < 4; i++) await flush();
    same("hand: shown; a seat per colour with its deck; the seat with the table's deck chosen first",
      [h.$("tt-hand").hidden, h.$("tt-hand-color").children.map((o) => [o.value, o.textContent]), h.$("tt-hand-color").value],
      [false, [["White", "White (Kykar, Wind's Fury)"], ["Red", "Red"], ["Yellow", "Yellow (Neheb, the Worthy)"], ["Blue", "Blue (Neheb, the Worthy)"]], "Blue"]);
    same("hand: the suggestions are that seat's deck; the boxes show what is waiting; the note says it",
      [h.$("tt-hand-names").children.map((o) => o.value), boxes(h), h.$("tt-hand-note").textContent],
      [NEHEB, ["Lightning Bolt", "Counterspell", "", "", "", "", ""], P.handNote(P.handView(t.hand).seats[3], 7)]);
    h.$("tt-hand-1").value = ""; h.$("tt-hand-3").value = "Shock"; h.$("tt-hand-7").value = "Vraska's Fall";
    await h.clock.advance(2500);
    for (let i = 0; i < 4; i++) await flush();
    same("hand: a poll with the same hand waiting keeps what is being typed", boxes(h), ["", "Counterspell", "Shock", "", "", "", "Vraska's Fall"]);
    h.answer = () => ({ ok: true, message: "Picked hand for Blue's next game: Counterspell, Shock, Vraska's Fall, and 4 more dealt at random from the deck." });
    h.$("tt-hand-set").click();
    for (let i = 0; i < 4; i++) await flush();
    same("hand: Set: POST /api/tools with the cards in box order, the answer said", [h.posts.at(-1)?.url, h.posts.at(-1)?.body, h.$("tt-toast").textContent],
      ["/api/tools", { kind: "hand", color: "Blue", names: ["Counterspell", "Shock", "Vraska's Fall"] }, "Picked hand for Blue's next game: Counterspell, Shock, Vraska's Fall, and 4 more dealt at random from the deck."]);
    const t2 = TOOLS(); t2.hand = HAND(["Counterspell", "Shock", "Vraska's Fall"]); h.tools = t2;
    await h.clock.advance(2500);
    for (let i = 0; i < 4; i++) await flush();
    same("hand: the bridge's new hand waiting fills the boxes again", boxes(h), ["Counterspell", "Shock", "Vraska's Fall", "", "", "", ""]);
    h.answer = () => ({ ok: true, message: "Picked hand for Blue cleared." });
    h.$("tt-hand-clear").click();
    for (let i = 0; i < 4; i++) await flush();
    same("hand: Clear: the clear body for the chosen seat", h.posts.at(-1)?.body, { kind: "hand", color: "Blue", clear: true });
    const n = h.posts.length;
    [1, 2, 3].forEach((k) => { h.$(`tt-hand-${k}`).value = " "; });
    h.$("tt-hand-set").click();
    await flush();
    same("hand: Set with every box empty: said, nothing sent", [h.$("tt-toast").textContent, h.posts.length], ["Type at least one card name (or press Clear).", n]);
    h.$("tt-hand-color").value = "White";
    h.$("tt-hand-color").fire("change");
    same("hand: another seat: its deck's names, its (empty) hand, its note", [h.$("tt-hand-names").children.map((o) => o.value), boxes(h), h.$("tt-hand-note").textContent],
      [["Island", "Opt"], ["", "", "", "", "", "", ""], "White plays Kykar, Wind's Fury (chosen with mtg deck). Nothing waiting: the next game deals as usual."]);
    h.answer = () => ({ ok: false, message: "Red is playing too: a picked hand is for games against the AI only." });
    h.$("tt-hand-1").value = "Opt";
    h.$("tt-hand-set").click();
    for (let i = 0; i < 4; i++) await flush();
    same("hand: a refusal is said as a warning", [h.posts.at(-1)?.body, h.$("tt-toast").textContent, h.$("tt-toast").className],
      [{ kind: "hand", color: "White", names: ["Opt"] }, "Red is playing too: a picked hand is for games against the AI only.", "toast warn"]);
    const t3 = TOOLS(); t3.debug.on = false; t3.hand = HAND(null); h.tools = t3;
    await h.clock.advance(2500);
    for (let i = 0; i < 4; i++) await flush();
    const m = h.posts.length;
    h.$("tt-hand-set").click();
    await flush();
    same("hand: debug tools off: the box is hidden with the tools, Set disabled and says why", [h.$("tt-dbg").hidden, h.$("tt-hand-set").getAttribute("aria-disabled"), h.$("tt-toast").textContent, h.posts.length],
      [true, "true", "Off. Switch them on to change the running game.", m]);
    ok("hand: the buttons' tooltips say why now", h.$("tt-hand-set").getAttribute("data-tip").endsWith("\nRight now: Off. Switch them on to change the running game."), h.$("tt-hand-set").getAttribute("data-tip"));
  }

  {
    // every control the page renders, static or made by the script, has a tooltip a screen reader can reach
    const s = redFix(status(), false);
    s.update = { title: "Update available: v2", line: "v2.", actions: [{ id: "update-now", label: "Update now", enabled: true, title: "Downloads and installs v2.", confirm: null, confirmLocked: false },
      { id: "update-check", label: "Check for updates", enabled: true, title: "Not checked yet.", confirm: null, confirmLocked: false }] };
    s.menu.push({ id: "wsl-limits", label: "Limit Docker's CPU use…", enabled: true, title: "Optional.", confirm: "Write the limit?", confirmLocked: false });
    const h = boot(s);
    h.tools = TOOLS(); h.tools.tools.push("draw", "mill");
    await h.clock.advance(0);
    h.$("tablebox").open = true;
    h.$("tablebox").listeners.toggle.forEach((f) => f());
    for (let i = 0; i < 4; i++) await flush();
    const defs = h.$("tipdefs").children;
    const ctl = allEls(Object.values(h.dom.byId)).filter((e) => CONTROLS.has(e.tagName) && !e.hidden); // (a light's unused button stays hidden)
    const bad = ctl.filter((e) => {
      const t = e.getAttribute("data-tip"), d = defs.find((x) => x.id === e.getAttribute("aria-describedby"));
      return !t || t.length < 20 || !d || d.textContent !== t;
    });
    same("tip: every control drawn has a tooltip, read out through aria-describedby", [ctl.length >= 40, bad.map((e) => e.id || `${e.tagName}:${e.textContent || e.getAttribute("aria-label")}`)], [true, []]);
    const tipOf = (e) => (e && e.getAttribute("data-tip")) || "";
    const setRed = ctl.find((e) => e.getAttribute("aria-label") === "Set Red");
    same("tip: each kind starts with its own name (fix, menu, update, seat, debug, toggles, switch)",
      [tipOf(h.rowBtn(2)), tipOf(h.menuBtn("Limit")), tipOf(h.$("update-actions").children[0]), tipOf(setRed), tipOf(h.$("tt-draw-btn")), tipOf(h.$("tablebox-sum")), tipOf(h.$("logbox-sum")), tipOf(h.$("tt-debug"))].map((t) => t.split(":")[0]),
      ["Restart relay and room", "Limit Docker’s CPU use", "Update now", "Set Red", "Draw", "Table tools", "Log", "Debug tools"]);
    ok("tip: tooltip ids are unique", new Set(defs.map((x) => x.id)).size === defs.length && defs.length === allEls(Object.values(h.dom.byId)).filter((e) => e.getAttribute && e.getAttribute("aria-describedby")).length);
    ok("tip: a seat's controls name the seat", ctl.filter((e) => /^Red: /.test(e.getAttribute("aria-label") || "")).every((e) => /^Red: /.test(e.getAttribute("data-tip"))));
    const t2 = TOOLS(); t2.debug.on = false; h.tools = t2;
    await h.clock.advance(2500);
    for (let i = 0; i < 4; i++) await flush();
    same("tip: debug tools off: each tool's tooltip says why it can't be used now", ["mana", "draw"].map((id) => h.$(`tt-${id}-btn`).getAttribute("data-tip").endsWith("\nRight now: Off. Switch them on to change the running game.")), [true, true]);
    h.toolsFail = true;
    await h.clock.advance(2500);
    for (let i = 0; i < 4; i++) await flush();
    same("tip: no bridge: the switch's tooltip says why it is greyed out, and shows on hovering its label", [h.$("tt-debug").getAttribute("data-tip").endsWith("\nRight now: The bridge isn’t answering: start the engine first."), (h.$("tt-debug-label").fire("mouseenter"), h.$("tip").hidden), h.$("tip-now").textContent],
      [true, false, "Right now: The bridge isn’t answering: start the engine first."]);
    const fixBtn = h.rowBtn(2);
    fixBtn.fire("mouseenter");
    h.body = status();
    await h.clock.advance(2500);
    ok("tip: a button that goes away takes its open tooltip with it", fixBtn.hidden === true && h.$("tip").hidden === true);
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
