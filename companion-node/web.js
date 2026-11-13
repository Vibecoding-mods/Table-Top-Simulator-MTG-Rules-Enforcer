// The status page: a small HTTP/1.1 server on 127.0.0.1 that serves one page and a JSON API over the Controller. A
// port of the Windows app's companion/src/WebUi.cs; the page itself is the Windows app's (companion/src/WebPage.cs),
// read from there in the repo or from page.html beside this file in a package, so the two apps show the same page.
//
//   GET  /              the page, with this run's token and a CSP nonce put in
//   GET  /api/status    the lights, the game lock, the menu, versions, the log tail (status() below; "api": 1)
//   POST /api/action    {"id": "...", "confirmLocked": bool}: the Controller's calls, under the same game lock
//   GET  /api/tools     the bridge's table tools, passed through from the bridge's GET /tools
//   POST /api/tools     {"kind": "ai-seat"|"debug-mode"|"debug", ...}: one change, passed to the bridge
//
// Guards (DNS rebinding, CSRF): Host must be 127.0.0.1:<port> or localhost:<port>; an Origin, when sent, must be that
// origin; /api/* needs the X-MTG-Token header (16 random bytes per run, only ever written into the served page) and
// refuses Sec-Fetch-Site other than same-origin/none; POST needs Content-Type application/json. The parser refuses
// what is unusual (bare LF, folded or duplicate headers, chunked bodies); head 8 KB, body 16 KB, 50 headers, 10 s.
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");
const L = require("./mods").logic();
const probes = require("./probes");
const { Log } = require("./controller");

const { Light, Fixes } = L;
const MaxHead = 8192, MaxBody = 16384, MaxHeaders = 50, MaxOpen = 16, IdleSec = 20, DeadlineMs = 10000;
const TokenHeader = "X-MTG-Token";
const Single = new Set(["host", "content-length", "content-type", "origin", "sec-fetch-site", TokenHeader.toLowerCase()]);
const newToken = () => crypto.randomBytes(16).toString("hex");

// ───────────────────────────── the parser (MiniHttp) ─────────────────────────────

const fail = (status, why) => ({ error: status, why });
const isToken = (s) => !!s && /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/.test(s);

// The request line and headers (without the blank line). { method, target, path, version, headers (lower-case
// names), contentLength } or { error, why }.
function parseHead(head, maxBody) {
  const lines = head.split("\r\n");
  for (const l of lines) if (l.includes("\r") || l.includes("\n")) return fail(400, "a bare CR or LF");
  const rl = lines[0].split(" ");
  if (rl.length !== 3 || !isToken(rl[0]) || rl[1].length === 0) return fail(400, "a malformed request line");
  if (rl[0] !== rl[0].toUpperCase()) return fail(400, "a lower-case method");
  if (rl[2] !== "HTTP/1.1" && rl[2] !== "HTTP/1.0") return fail(rl[2].startsWith("HTTP/") ? 505 : 400, `HTTP version ${L.clip(rl[2], 12)}`);
  if (rl[1][0] !== "/") return fail(400, "the target isn't a path");
  const r = { method: rl[0], target: rl[1], version: rl[2], headers: {}, contentLength: 0, body: "" };
  const q = r.target.search(/[?#]/);
  r.path = q < 0 ? r.target : r.target.slice(0, q);
  if (lines.length - 1 > MaxHeaders) return fail(431, `over ${MaxHeaders} headers`);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0 || line[0] === " " || line[0] === "\t") return fail(400, "a folded or empty header line");
    const colon = line.indexOf(":");
    if (colon <= 0) return fail(400, "a header without a name and colon");
    const name = line.slice(0, colon), value = line.slice(colon + 1).replace(/^[ \t]+|[ \t]+$/g, "");
    if (!isToken(name)) return fail(400, "a bad header name");
    const k = name.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(r.headers, k)) {
      if (Single.has(k)) return fail(400, `a second ${name} header`);
      r.headers[k] = `${r.headers[k]}, ${value}`;
    } else r.headers[k] = value;
  }
  if (r.headers["transfer-encoding"] !== undefined) return fail(501, "Transfer-Encoding isn't supported");
  if (r.version === "HTTP/1.1" && r.headers.host === undefined) return fail(400, "no Host header");
  const cl = r.headers["content-length"];
  if (cl !== undefined) {
    if (cl.length === 0 || cl.length > 9 || !/^[0-9]+$/.test(cl)) return fail(400, "a bad Content-Length");
    const len = parseInt(cl, 10);
    if (len > maxBody) return fail(413, `the body is over ${maxBody} bytes`);
    r.contentLength = len;
  }
  return r;
}

// Feeds bytes as they arrive; done(request or null) once. A request with error != 0 is answered with that status.
function reader(done) {
  let buf = Buffer.alloc(0), head = null, finished = false;
  const finish = (r) => { if (!finished) { finished = true; done(r); } };
  return {
    data(chunk) {
      if (finished) return;
      buf = Buffer.concat([buf, chunk]);
      if (!head) {
        const end = buf.indexOf("\r\n\r\n");
        if (end < 0) { if (buf.length >= MaxHead) finish(fail(431, `the request head is over ${MaxHead} bytes`)); return; }
        if (end >= MaxHead) { finish(fail(431, `the request head is over ${MaxHead} bytes`)); return; }
        for (let i = 0; i < end; i++) { const b = buf[i]; if (b > 126 || (b < 32 && b !== 13 && b !== 10 && b !== 9)) { finish(fail(400, "a non-ASCII or control byte in the request head")); return; } }
        head = parseHead(buf.subarray(0, end).toString("latin1"), MaxBody);
        if (head.error) { finish(head); return; }
        buf = buf.subarray(end + 4);
      }
      if (buf.length >= head.contentLength) {
        const body = buf.subarray(0, head.contentLength);
        try { head.body = new TextDecoder("utf-8", { fatal: true }).decode(body); } catch { finish(fail(400, "the body isn't UTF-8")); return; }
        finish(head);
      }
    },
    end() {
      if (finished) return;
      if (!head && buf.length === 0) finish(null);
      else if (!head) finish(fail(400, "the connection closed inside the request head"));
      else finish(fail(400, "the body is shorter than Content-Length"));
    },
    timeout() { finish(fail(408, head ? "the body came too slowly" : "the request came too slowly")); },
  };
}

const Reasons = { 200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 408: "Request Timeout", 413: "Payload Too Large", 415: "Unsupported Media Type", 431: "Request Header Fields Too Large", 501: "Not Implemented", 502: "Bad Gateway", 505: "HTTP Version Not Supported" };
function writeResp(r) {
  const body = Buffer.from(r.body || "", "utf8");
  let h = `HTTP/1.1 ${r.status} ${Reasons[r.status] || "Error"}\r\nContent-Type: ${r.type || "application/json; charset=utf-8"}\r\nContent-Length: ${body.length}\r\n`;
  h += "Connection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\n";
  if (r.csp) h += `Content-Security-Policy: ${r.csp}\r\n`;
  return Buffer.concat([Buffer.from(`${h}\r\n`, "latin1"), body]);
}

// exactly application/json, with at most a charset=utf-8 parameter
function jsonType(ct) {
  if (ct === undefined || ct === null) return false;
  const parts = ct.split(";");
  if (parts.length > 2 || parts[0].trim().toLowerCase() !== "application/json") return false;
  return parts.length === 1 || parts[1].trim().replace(/"/g, "").toLowerCase() === "charset=utf-8";
}

// ───────────────────────────── the page ─────────────────────────────

// The Windows app's page: page.html beside this file (a package), else the verbatim string in companion/src/WebPage.cs
function pageFromCs(cs) {
  const m = /public const string Html = @"([\s\S]*?)";\s*\}\s*\}\s*$/.exec(cs);
  return m ? m[1] : null;
}
function loadPage(dir) {
  const own = probes.readText(path.join(dir, "page.html"));
  if (own) return own;
  const cs = probes.readText(path.join(dir, "..", "companion", "src", "WebPage.cs"));
  return cs ? pageFromCs(cs) : null;
}

// ───────────────────────────── the JSON ─────────────────────────────

const stateOf = (l) => (l === Light.Green ? "green" : l === Light.Red ? "red" : l === Light.Amber || l === Light.Busy ? "amber" : "grey");
const wordOf = (l) => (l === Light.Green ? "OK" : l === Light.Amber ? "Check" : l === Light.Red ? "Problem" : l === Light.Busy ? "Working" : "—");
const ObserveText = "Observe mode: nothing is changed.";

function confirmOf(v) {
  switch (v.fix) {
    case Fixes.StackRestart: return "Restart the relay and the Forge room (about 20 s)?";
    case Fixes.BridgeRestart: return "Restart the bridge (a few seconds)? TTS will redraw the table.";
    case Fixes.ImagesLoad: return "Load the engine images from the package again (a few minutes)?";
    case Fixes.ShowProgram: return `${v.text}\n\nClose that program yourself first (in a terminal: kill and the process number above). The Bridge step then runs again.`;
    default: return null;
  }
}

// the update section (UpdateSection): checks only; an update found is downloaded and unpacked by hand
const updateWorking = (s) => s === "checking";
function updateTitle(u) {
  switch (u.status) {
    case "available": return `Update available: ${u.available}`;
    case "failed": return "Update problem";
    case "checking": return "Checking for updates";
    default: return "Updates";
  }
}
function updateSection(u, friend, observe) {
  if (!friend || observe || !u) return null;
  const btn = (id, label, enabled, title, confirm) => ({ id, label, enabled, title, confirm, confirmLocked: false });
  const actions = [btn("update-check", u.status === "checking" ? "Checking…" : "Check for updates", !updateWorking(u.status), u.lastCheck ? `Last checked ${u.lastCheck}` : "Not checked yet.", null)];
  return { title: updateTitle(u), line: u.text || `This package: ${u.current || "?"}.`, status: u.status, current: u.current, available: u.available, progress: u.progress, deferred: false, error: u.error, lastCheck: u.lastCheck, actions };
}

class WebUi {
  constructor(c, o) {
    this.c = c; this.o = o || {};
    this.token = newToken();
    this.port = 0;
    this.lastPoll = Date.now();
    this.lastAccepted = null;
    this.page = this.o.page || null;
    this.conns = []; // [{ socket, reading }], oldest first
    this.openFolder = (dir) => { fs.mkdirSync(dir, { recursive: true }); const [cmd, args] = require("./mods").platform().openCommand(c.platform, dir); probes.launch(cmd, args); };
    this.bridgeCall = (method, p, json) => (method === "GET" ? probes.httpGet(`${c.bridgeUrl}${p}`, 5000) : probes.httpPost(`${c.bridgeUrl}${p}`, json, 10000));
    this.updater = this.o.updater || null;
  }

  get url() { return `http://127.0.0.1:${this.port}/`; }

  // Listens on 127.0.0.1:port, else on any free port
  async start(port) {
    for (const p of port === 0 ? [0] : [port, 0]) {
      const ok = await new Promise((done) => {
        const s = net.createServer((sock) => this.accept(sock));
        s.once("error", (e) => { Log.write(`status page: port ${p} isn't free (${e.code})`); done(false); });
        s.listen({ host: "127.0.0.1", port: p, exclusive: true, backlog: MaxOpen }, () => { this.server = s; this.port = s.address().port; done(true); });
      });
      if (ok) break;
    }
    if (!this.server) return false;
    this.idle = setInterval(() => this.idleCheck(Date.now()), 5000);
    this.idle.unref();
    Log.write(`status page: ${this.url}`);
    return true;
  }
  stop() { if (this.idle) clearInterval(this.idle); try { this.server.close(); } catch { /* closed */ } for (const x of this.conns) x.socket.destroy(); }

  accept(socket) {
    const conn = { socket, reading: true };
    if (this.conns.length >= MaxOpen) {
      // full: idle sockets must not lock the page out: drop the oldest one still waiting for its request
      const i = this.conns.findIndex((x) => x.reading);
      if (i < 0) { socket.destroy(); return; }
      this.conns.splice(i, 1)[0].socket.destroy();
    }
    this.conns.push(conn);
    socket.on("close", () => { this.conns = this.conns.filter((x) => x !== conn); });
    socket.on("error", () => {});
    socket.setNoDelay(true);
    const timer = setTimeout(() => rd.timeout(), DeadlineMs);
    const rd = reader(async (req) => {
      clearTimeout(timer);
      conn.reading = false;
      if (req === null) { socket.end(); return; }
      let resp;
      try { resp = await this.handle(req); } catch (e) { Log.write(`status page: ${e.stack || e}`); resp = refuse(500, "error", "The companion hit an error; the log has it."); }
      socket.end(writeResp(resp));
    });
    socket.on("data", (d) => rd.data(d));
    socket.on("end", () => rd.end());
  }

  idleCheck(now) { if (now - this.lastPoll > IdleSec * 1000) this.c.windowVisible = false; }
  polled() { this.lastPoll = Date.now(); if (!this.c.windowVisible) { this.c.windowVisible = true; this.c.nudge(); } }

  hostOk(h) { return typeof h === "string" && (h.toLowerCase() === `127.0.0.1:${this.port}` || h.toLowerCase() === `localhost:${this.port}`); }
  originOk(o) { return typeof o === "string" && (o.toLowerCase() === `http://127.0.0.1:${this.port}` || o.toLowerCase() === `http://localhost:${this.port}`); }
  tokenOk(t) {
    if (typeof t !== "string" || t.length !== this.token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(this.token));
  }

  async handle(r) {
    if (r.error) return refuse(r.error, "bad-request", r.why);
    if (!this.hostOk(r.headers.host)) return refuse(403, "bad-host", `Open the page at ${this.url}`);
    const origin = r.headers.origin;
    if (origin !== undefined && !this.originOk(origin)) return refuse(403, "bad-origin", "Requests from other sites are refused.");
    if (r.path.startsWith("/api/")) {
      const site = r.headers["sec-fetch-site"];
      if (site !== undefined && site !== "same-origin" && site !== "none") return refuse(403, "cross-site", "Requests from other sites are refused.");
      if (!this.tokenOk(r.headers[TokenHeader.toLowerCase()])) return refuse(403, "bad-token", "This page is from an earlier run of the companion: reload it.");
    }
    switch (r.path) {
      case "/": case "/index.html":
        return r.method === "GET" ? this.pageResp() : refuse(405, "method", "GET only.");
      case "/api/status":
        if (r.method !== "GET") return refuse(405, "method", "GET only.");
        this.polled();
        return { status: 200, body: JSON.stringify(this.status()) };
      case "/api/action": {
        if (r.method !== "POST") return refuse(405, "method", "POST only.");
        if (!jsonType(r.headers["content-type"])) return refuse(415, "content-type", "Send application/json.");
        const body = L.parseJson(r.body);
        const id = L.str(body, "id");
        if (!id) return refuse(400, "bad-body", "Send {\"id\": \"...\"}.");
        const res = await this.act(id, L.get(body, "confirmLocked") === true);
        return { status: res.known === false ? 400 : 200, body: JSON.stringify({ ok: !!res.ok, message: res.message, needConfirm: !!res.needConfirm }) };
      }
      case "/api/tools": return this.tools(r);
      default: return refuse(404, "not-found", "Nothing here.");
    }
  }

  pageResp() {
    if (!this.page) return { status: 200, type: "text/plain; charset=utf-8", body: "The status page file is missing (companion/page.html). The companion runs; its log is in the logs folder." };
    const nonce = newToken();
    return {
      status: 200, type: "text/html; charset=utf-8", body: this.page.split("{{TOKEN}}").join(this.token).split("{{NONCE}}").join(nonce),
      csp: `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    };
  }

  showsFix(v) { return !!v.fix && (v.light === Light.Red || v.light === Light.Amber) && !this.c.observe; }
  lightAction(row, v, g, locked) {
    if (!this.showsFix(v)) return null;
    const lockedFix = Fixes.locksDuringGame(v.fix) && locked;
    return { id: `fix:${row}:${v.fix}`, label: v.fixLabel, locked: lockedFix, lockText: lockedFix ? L.lockText(g) : null, confirm: confirmOf(v) };
  }
  headline(w, g) {
    const red = this.c.rows.find((r) => r.v.light === Light.Red);
    if (red) return `Problem: ${red.name}`;
    switch (w) {
      case Light.Busy: return this.c.phase;
      case Light.Amber: return `${this.c.rows.filter((r) => r.v.light === Light.Amber).length} to check`;
      case Light.Grey: return "Stopped";
      default: return g && g.kind === "on" ? "Ready: game on" : "Ready";
    }
  }
  menu(locked, g) {
    const c = this.c;
    return [
      { id: "restart-engine", label: locked ? "Restart engine (locked: game on)" : "Restart engine", enabled: !locked && !c.observe, title: c.observe ? ObserveText : locked ? L.lockText(g) : "Stops the bridge, restarts relay and room, then starts the bridge again.", confirm: "Restart the engine? This stops the bridge, restarts the relay and the Forge room, and starts the bridge again (under a minute).", confirmLocked: false },
      { id: "stop-everything", label: "Stop everything", enabled: !c.observe, title: c.observe ? ObserveText : "Stops the bridge and the engine containers; the container engine and TTS keep running.", confirm: locked ? `${g.text}\n\nStopping everything ends that game for everyone. Stop anyway?` : "Stop the bridge and the engine containers? The container engine and TTS keep running.", confirmLocked: locked },
      { id: "open-logs", label: "Open logs folder", enabled: true, title: c.L.logsDir, confirm: null, confirmLocked: false },
    ];
  }
  logTail(n) {
    const t = Log.file ? probes.tail(Log.file, 16000) : null;
    if (!t) return [];
    const all = t.replace(/\r/g, "").split("\n");
    if (t.length >= 15000 && all.length > 1) all.shift(); // (the first line was cut)
    return all.filter((s) => s.length > 0).slice(-n);
  }

  status() {
    const c = this.c, g = c.game, locked = c.isLocked;
    const lights = c.rows.map((row, i) => ({
      step: i + 1, name: row.name, state: stateOf(row.v.light), busy: row.v.light === Light.Busy, word: wordOf(row.v.light), text: row.v.text, hint: row.v.hint,
      at: row.at ? row.at.toTimeString().slice(0, 8) : null, action: this.lightAction(i, row.v, g, locked),
    }));
    const w = L.worst(c.rows.map((r) => r.v.light));
    const hint = c.rows.map((r) => r.v).filter((v) => v.hint && v.light !== Light.Green && v.light !== Light.Grey).map((v) => v.hint)[0]
      || `${L.ttsHowTo(c.saveName)}\n\nOnly the host runs this app. Friends join your TTS game (Multiplayer) and need nothing else.`;
    return {
      api: 1, app: "MTG Companion", at: new Date().toTimeString().slice(0, 8), mode: c.L.friend ? "friend" : "home", home: c.L.home, observe: c.observe, phase: c.phase,
      worst: { state: stateOf(w), busy: w === Light.Busy, text: this.headline(w, g) },
      game: { kind: g ? g.kind : "cantTell", text: g ? g.text : "", turn: g ? g.turn : 0, locked, lockText: locked ? L.lockText(g) : null },
      lights, menu: this.menu(locked, g), hint,
      versions: { text: c.versionText, companion: this.o.version || "node", table: c.want("table"), bridge: c.want("bridge"), save: c.saveName },
      log: { file: Log.file, lines: this.logTail(60) },
      update: updateSection(c.update, c.L.friend, c.observe),
    };
  }

  // ───────────────────────────── actions ─────────────────────────────

  async act(id, confirmLocked) {
    const res = await this.route(id, confirmLocked);
    if (res.known !== false) Log.write(`status page: ${id}${confirmLocked ? " (confirmed during a game)" : ""}: ${res.ok ? "" : "refused: "}${L.clip(res.message, 120)}`);
    return res;
  }
  repeat(id) { return id === this.lastAccepted && this.c.workPending; }

  async route(id, confirmLocked) {
    const c = this.c;
    const done = (m) => ({ ok: true, message: m }), no = (m) => ({ ok: false, message: m });
    const already = () => done("Already running; the lights show how far it is.");
    if (id.startsWith("fix:")) return this.fix(id);
    switch (id) {
      case "restart-engine": {
        if (!c.observe && this.repeat(id)) return already();
        const refused = c.restartEngine();
        if (refused) return no(refused);
        this.lastAccepted = id;
        return done("Restarting the engine: the lights show each step.");
      }
      case "stop-everything":
        if (c.observe) return no(ObserveText);
        if (this.repeat(id)) return already();
        if (c.isLocked && !confirmLocked) return { ok: false, needConfirm: true, message: `${c.game.text}\n\nStopping everything ends that game for everyone.` };
        c.stopEverything(null);
        this.lastAccepted = id;
        return done("Stopping the bridge and the engine containers.");
      case "open-logs":
        try { this.openFolder(c.L.logsDir); return done(`Opened ${c.L.logsDir}.`); } catch (e) { return no(`Couldn't open the logs folder: ${e.message}`); }
      case "update-check": {
        if (c.observe) return no(ObserveText);
        if (!this.updater) return no(c.L.friend ? "Updates aren't available here." : "Home mode: the repo updates with git, not here.");
        if (c.updateBusy) return already();
        this.updater.checkInBackground();
        this.lastAccepted = id;
        return done("Checking for updates.");
      }
      case "update-now": case "update-later":
        return no("This companion doesn't install updates itself yet: download the new package from the project's Releases page and unpack it beside this one (your table save stays).");
      default: return { known: false, ok: false, message: "Unknown action." };
    }
  }

  fix(id) {
    const c = this.c;
    const p = id.split(":");
    const row = /^\d+$/.test(p[1] || "") ? parseInt(p[1], 10) : -1;
    if (p.length !== 3 || row < 0 || row >= c.rows.length) return { known: false, ok: false, message: "Unknown action." };
    if (c.observe) return { ok: false, message: ObserveText };
    const v = c.rows[row].v;
    if (!this.showsFix(v)) return { ok: false, message: "That light has no button now." };
    if (v.fix !== p[2]) return { ok: false, message: "That button has changed; the page now shows the current one." };
    if (this.repeat(id)) return { ok: true, message: "Already running; the lights show how far it is." };
    const refused = c.doFix(row, v.fix);
    if (refused) return { ok: false, message: refused };
    this.lastAccepted = id;
    return { ok: true, message: `${v.fixLabel}: started.` };
  }

  // ───────────────────────────── table tools (passed through to the bridge) ─────────────────────────────

  async tools(r) {
    if (r.method === "GET") {
      const got = await this.bridgeCall("GET", "/tools", null);
      if (got.kind !== "ok" || got.status !== 200 || !L.isObj(L.parseJson(got.body))) return refuse(502, "no-bridge", noBridge(got));
      return { status: 200, body: got.body };
    }
    if (r.method !== "POST") return refuse(405, "method", "GET or POST only.");
    if (!jsonType(r.headers["content-type"])) return refuse(415, "content-type", "Send application/json.");
    const body = L.parseJson(r.body);
    const kind = L.str(body, "kind");
    if (!L.isObj(body) || !ToolKinds.includes(kind)) return refuse(400, "bad-body", "Send {\"kind\": \"ai-seat\" | \"debug-mode\" | \"debug\", ...}.");
    if (this.c.observe) return { status: 200, body: JSON.stringify({ ok: false, message: ObserveText }) };
    const res = await this.bridgeCall("POST", "/tools", JSON.stringify(body)); // (rewritten from what was parsed, never the raw bytes)
    const answer = res.kind === "ok" ? L.parseJson(res.body) : null;
    if (!L.isObj(answer)) return refuse(502, "no-bridge", noBridge(res));
    Log.write(`status page: tools ${kind}: ${answer.ok === true ? "" : "refused: "}${L.clip(L.str(answer, "message") || "", 120)}`);
    return { status: 200, body: JSON.stringify({ ok: answer.ok === true, message: L.str(answer, "message") || "" }) };
  }
}

const ToolKinds = ["ai-seat", "debug-mode", "debug"];
const refuse = (status, error, message) => ({ status, body: JSON.stringify({ error, message }) });
function noBridge(h) {
  return h.kind === "refused" ? "The bridge isn't running: start the engine first (the Bridge light)."
    : h.kind === "timeout" ? "The bridge didn't answer in time."
      : h.kind === "ok" && h.status === 404 ? "This bridge has no table tools yet: restart the engine to run the new one."
        : `The bridge couldn't be asked (${h.error || `HTTP ${h.status}`}).`;
}

// the first start of a package opens the page once by itself; later starts only when the first pass ends red
const openAtStart = (friend, observe, shownBefore) => friend && !observe && !shownBefore;
const openAfterFirstPass = (observe, lights) => !observe && lights.some((l) => l === Light.Red);

module.exports = { WebUi, parseHead, reader, writeResp, jsonType, pageFromCs, loadPage, stateOf, wordOf, updateSection, openAtStart, openAfterFirstPass, MaxHead, MaxBody, TokenHeader };
