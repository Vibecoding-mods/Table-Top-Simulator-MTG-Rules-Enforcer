// The I/O of the Linux/macOS companion: commands, HTTP to the bridge, the relay login, processes, ports and files.
// Node built-ins only. Every decision is in logic.js / platform.js; this file only reads and runs.
"use strict";
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const P = require("./mods").platform();

// ───────────────────────────── files ─────────────────────────────

function readText(file) { try { return fs.readFileSync(file, "utf8"); } catch { return null; } }
function readHead(file, n) {
  try { const fd = fs.openSync(file, "r"); try { const b = Buffer.alloc(n); const got = fs.readSync(fd, b, 0, n, 0); return b.subarray(0, got).toString("utf8"); } finally { fs.closeSync(fd); } } catch { return null; }
}
function tail(file, n) {
  try {
    const st = fs.statSync(file); const len = Math.min(n, st.size); const fd = fs.openSync(file, "r");
    try { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, st.size - len); return b.toString("utf8"); } finally { fs.closeSync(fd); }
  } catch { return null; }
}
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
// null when a file can be made and removed in dir, else why not
function tryWrite(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, ".mtg-companion-write-test"); fs.writeFileSync(f, "x"); fs.unlinkSync(f); return null; } catch (e) { return e.message; }
}
// a JSON file written whole or not at all (rename over the old one)
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(obj, null, 1)}\n`);
  fs.renameSync(tmp, file);
}

// ───────────────────────────── commands ─────────────────────────────

// An executable on PATH, or in the places a Mac's Docker Desktop / Homebrew put theirs (a Finder-started .command
// may have a short PATH)
function which(name) {
  const dirs = String(process.env.PATH || "").split(":").concat(["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin",
    "/Applications/Docker.app/Contents/Resources/bin", path.join(os.homedir(), ".local", "bin")]);
  for (const d of dirs) {
    if (!d) continue;
    const f = path.join(d, name);
    try { fs.accessSync(f, fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch { /* next */ }
  }
  return null;
}

// Runs a program (no shell): { code, out (stdout + stderr), timedOut }. onLine: each output line; onTick(pid): every s.
function run(cmd, args, o) {
  o = o || {};
  return new Promise((done) => {
    let out = "", timedOut = false, finished = false, buf = "";
    let p;
    try { p = spawn(cmd, args, { cwd: o.cwd, env: o.env || process.env, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { done({ code: -1, out: e.message, timedOut: false }); return; }
    const onData = (d) => {
      const s = d.toString("utf8");
      if (out.length < 1 << 20) out += s;
      if (o.onLine) { buf += s; const lines = buf.split(/\r?\n/); buf = lines.pop(); for (const l of lines) if (l.trim()) o.onLine(l); }
    };
    p.stdout.on("data", onData); p.stderr.on("data", onData);
    const timer = setTimeout(() => { timedOut = true; try { p.kill("SIGKILL"); } catch { /* gone */ } }, o.timeoutMs || 60000);
    const ticker = o.onTick ? setInterval(() => { try { o.onTick(p.pid); } catch { /* a progress line only */ } }, 1000) : null;
    const end = (code) => { if (finished) return; finished = true; clearTimeout(timer); if (ticker) clearInterval(ticker); if (o.onLine && buf.trim()) o.onLine(buf); done({ code: code === null ? -1 : code, out, timedOut }); };
    p.on("error", (e) => { out += e.message; end(-1); });
    p.on("close", end);
  });
}

// started and left alone (TTS, the browser, Docker Desktop)
function launch(cmd, args, env) {
  try { const p = spawn(cmd, args, { detached: true, stdio: "ignore", env: env || process.env }); p.on("error", () => {}); p.unref(); return true; } catch { return false; }
}

// bytes a process has read so far (Linux /proc/<pid>/io rchar), -1 when unknown (the image load's percentage)
function bytesRead(pid) {
  const t = readText(`/proc/${pid}/io`);
  const m = t && /^rchar:\s*(\d+)/m.exec(t);
  return m ? Number(m[1]) : -1;
}

// ───────────────────────────── the bridge's HTTP ─────────────────────────────

// { kind: ok|refused|timeout|error, status, body, error, ms }. Only "connection refused" means nothing listens.
function httpCall(method, url, json, timeoutMs) {
  return new Promise((done) => {
    const t0 = Date.now();
    let settled = false;
    const fin = (r) => { if (!settled) { settled = true; r.ms = Date.now() - t0; done(r); } };
    let req;
    try {
      const body = json === null || json === undefined ? null : Buffer.from(json, "utf8");
      req = http.request(url, { method, agent: false, headers: body ? { "Content-Type": "application/json", "Content-Length": body.length } : {} }, (res) => {
        const parts = [];
        res.on("data", (d) => parts.push(d));
        res.on("end", () => fin({ kind: "ok", status: res.statusCode, body: Buffer.concat(parts).toString("utf8"), error: null }));
        res.on("error", (e) => fin({ kind: "error", status: 0, body: null, error: e.message }));
      });
      req.setTimeout(timeoutMs, () => { fin({ kind: "timeout", status: 0, body: null, error: `no answer in ${Math.round(timeoutMs / 1000)} s` }); req.destroy(); });
      req.on("error", (e) => fin(e.code === "ECONNREFUSED" ? { kind: "refused", status: 0, body: null, error: "nothing listens" } : { kind: "error", status: 0, body: null, error: e.message }));
      if (body) req.write(body);
      req.end();
    } catch (e) { fin({ kind: "error", status: 0, body: null, error: e.message }); }
  });
}
const httpGet = (url, ms) => httpCall("GET", url, null, ms);
const httpPost = (url, json, ms) => httpCall("POST", url, json, ms);

// ───────────────────────────── the relay login (catches a stale port forward) ─────────────────────────────

// Logs in as companion-xxxx with the bridge's own messages, asks for the room list, and closes properly (a lobby
// session that closes is removed by the relay at once). Node 22+ has WebSocket built in.
function relayLogin(url, key, room, stepMs) {
  return new Promise((done) => {
    const t0 = Date.now();
    const r = { kind: "error", roomFound: false, roomStatus: null, ms: 0, detail: null };
    if (typeof WebSocket !== "function") { r.detail = "this Node has no WebSocket"; done(r); return; }
    let ws, stage = "connect", timer = null, finished = false;
    const finish = (kind, detail) => {
      if (finished) return; finished = true; clearTimeout(timer);
      r.kind = kind; if (detail) r.detail = detail; r.ms = Date.now() - t0;
      try { if (ws && ws.readyState === 1) ws.close(1000); } catch { /* closing anyway */ }
      done(r);
    };
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => finish("timeout", `no ${stage === "connect" ? "connection" : stage}`), stepMs); };
    try { ws = new WebSocket(url); } catch (e) { finish("error", e.message); return; }
    arm();
    ws.onopen = () => {
      stage = "AuthResult"; arm();
      const user = `companion-${Math.random().toString(16).slice(2, 6)}`;
      ws.send(JSON.stringify({ type: "Authenticate", username: user, password: key, service: false, client_platform: "unknown", engine_gate: "unknown", client_version: "3.56.0" }));
    };
    ws.onmessage = (ev) => {
      let o; try { o = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8")); } catch { return; }
      if (stage === "AuthResult" && o.type === "AuthResult") {
        if (!o.success) { finish("authFailed", o.error ? String(o.error) : null); return; }
        stage = "RoomList"; arm();
        ws.send(JSON.stringify({ type: "ListRooms" }));
      } else if (stage === "RoomList" && o.type === "RoomList") {
        const rooms = Array.isArray(o.rooms) ? o.rooms : [];
        const found = rooms.find((x) => x && x.room_name === room && x.status === "Lobby") || rooms.find((x) => x && x.room_name === room);
        r.roomFound = !!found; r.roomStatus = found ? String(found.status) : null;
        finish("ok");
      }
    };
    ws.onerror = (ev) => {
      const msg = String((ev && (ev.message || (ev.error && ev.error.message))) || "");
      if (stage === "connect") finish(/ECONNREFUSED|refused/i.test(msg) ? "refused" : "closed", msg || "connection failed");
      else finish("closed", msg || "connection dropped");
    };
    ws.onclose = () => finish(stage === "connect" ? "closed" : "closed", `closed before ${stage}`);
  });
}

// Whether host:port takes a TCP connection: { kind: ok|refused|notFound|timeout|error, detail }. The own-server check
// runs it first, because a failed WebSocket doesn't say why (Node's gives "network error" for all of these).
function tcpReach(host, port, ms) {
  return new Promise((done) => {
    const net = require("net");
    let finished = false;
    const finish = (kind, detail) => { if (finished) return; finished = true; try { sock.destroy(); } catch { /* closing anyway */ } done({ kind, detail: detail || null }); };
    const sock = net.connect({ host: host.replace(/^\[|\]$/g, ""), port });
    sock.setTimeout(ms, () => finish("timeout", `no answer in ${Math.round(ms / 1000)} s`));
    sock.on("connect", () => finish("ok"));
    sock.on("error", (e) => {
      const code = e && e.code;
      if (code === "ECONNREFUSED") finish("refused", code);
      else if (code === "ENOTFOUND" || code === "EAI_AGAIN") finish("notFound", code);
      else if (code === "ETIMEDOUT") finish("timeout", code);
      else finish("error", code || (e && e.message) || "connection failed");
    });
  });
}

// ───────────────────────────── processes and ports ─────────────────────────────

// Every process this account can see: [{ pid, cmd, upSec }]. Linux: /proc (no tools needed); macOS: ps.
async function processes() {
  if (process.platform === "linux") {
    const out = [];
    const uptime = Number((readText("/proc/uptime") || "0").split(" ")[0]) || 0;
    const hz = 100; // (USER_HZ: 100 on every Linux the Deck and desktop distributions ship)
    let names = [];
    try { names = fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n)); } catch { return out; }
    for (const n of names) {
      const raw = readText(`/proc/${n}/cmdline`);
      if (!raw) continue;
      const ticks = P.procStartTicks(readText(`/proc/${n}/stat`));
      const pc = P.procFromCmdline(raw, readText(`/proc/${n}/comm`));
      out.push({ pid: Number(n), name: pc.name, cmd: pc.cmd, upSec: ticks === null ? null : uptime - ticks / hz });
    }
    return out;
  }
  const r = await run("ps", ["-A", "-ww", "-o", "pid=,etime=,command="], { timeoutMs: 10000 });
  return r.code === 0 ? P.parsePs(r.out) : [];
}

// Who holds the bridge's ports: [{ port, pid, name, commandLine }]; pid null when something listens but its owner
// can't be read (another account's process): "can't tell", left to /versions.
async function listeners(ports) {
  const held = [];
  const procs = await processes();
  const cmdOf = (pid) => { const p = procs.find((x) => x.pid === pid); return p ? p.cmd : null; };
  if (process.platform === "linux") {
    const socks = [];
    for (const f of ["/proc/net/tcp", "/proc/net/tcp6"]) socks.push(...P.procListening(readText(f), ports));
    const byInode = new Map(socks.map((s) => [s.inode, s.port]));
    const found = new Set();
    if (byInode.size) {
      for (const p of procs) {
        let fds = [];
        try { fds = fs.readdirSync(`/proc/${p.pid}/fd`); } catch { continue; }
        for (const fd of fds) {
          let link = ""; try { link = fs.readlinkSync(`/proc/${p.pid}/fd/${fd}`); } catch { continue; }
          const m = /^socket:\[(\d+)\]$/.exec(link);
          if (m && byInode.has(m[1]) && !found.has(m[1])) { found.add(m[1]); held.push({ port: byInode.get(m[1]), pid: p.pid, name: p.name || P.procName(p.cmd), commandLine: p.cmd }); }
        }
      }
    }
    for (const s of socks) if (!found.has(s.inode)) held.push({ port: s.port, pid: null, name: null, commandLine: null });
    return held;
  }
  for (const port of ports) {
    const r = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], { timeoutMs: 10000 });
    for (const x of P.parseLsof(r.out)) {
      const cmd = cmdOf(x.pid);
      held.push({ port, pid: x.pid, name: x.name || (cmd ? P.procName(cmd) : null), commandLine: cmd }); // (lsof's own name: ps joins arguments by spaces)
    }
  }
  return held;
}

function kill(pids, signal) {
  for (const pid of pids) { try { process.kill(pid, signal || "SIGTERM"); } catch { /* gone */ } }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
// A running process's command line (arguments joined by spaces), or null when it is gone or can't be read: Linux
// /proc/<pid>/cmdline, macOS ps. Used to check that a pid from a file is still the process that wrote it.
function commandOf(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "linux") { const raw = readText(`/proc/${pid}/cmdline`); return raw ? P.procFromCmdline(raw, null).cmd : null; }
  try { const r = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 5000 }); return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null; } catch { return null; }
}

module.exports = { readText, readHead, tail, exists, tryWrite, writeJsonAtomic, which, run, launch, bytesRead, httpGet, httpPost, relayLogin, tcpReach, processes, listeners, kill, alive, commandOf };
