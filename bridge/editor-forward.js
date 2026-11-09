// Shares TTS's editor port with the VSCode/Atom TTS plugin (SPEC.md §8). Off unless a forward port is set.
// Routing and safety follow tmp/editor-forward/research.md (2026-11-05).
//
// TTS sends all editor traffic to one port (39998), which the bridge holds. No plugin has a port setting, so the user
// edits the two numbers in the plugin's dist/extension.js (39998 -> forwardPort, 39999 -> commandPort). Then:
//   TTS -> 39998 (bridge) -> offer(msg) -> copy to the plugin on forwardPort (fire-and-forget, short timeout)
//   plugin -> commandPort (this module) -> TTS's 39999   (Save & Play only when it can't wipe the table)
// Framing on every hop is TTS's: one JSON object per connection, read until the sender closes.
//
// Routing of TTS -> editor messages (messageID); offer() returns whether the bridge should still handle it:
//   1 game loaded, 2 print, 3 error, unknown IDs: plugin AND bridge
//   1 that answers the plugin's own Get Scripts (within getScriptsMs): plugin only (no table redraw)
//   0 object pushed, 6 game saved, 7 object created: plugin only
//   4 custom message: customMessage.t is a string (our table): bridge only; anything else: plugin only
//   5 Lua return value: returnID >= BRIDGE_EXEC_BASE: bridge only (even late ones); any other: plugin only
// Plugin -> TTS commands: 0 Get Scripts, 2 custom message, 3 execute Lua are relayed as sent. 1 Save & Play is relayed
// only when no game runs, the table check answered and found none of the player's own cards or decks, and the save
// file was backed up; otherwise the plugin gets a made-up print (ID 2) with the reason.
//
// Env (read when the option is not passed): MTG_EDITOR_FORWARD_PORT (where the edited plugin listens; unset/0 = off),
// MTG_EDITOR_COMMAND_PORT (where this module listens for the plugin's commands; unset/0 = no listener),
// MTG_TTS_SAVE (the save file backed up before a Save & Play; default Saves/TS_Save_1.json).
const net = require("net");
const fs = require("fs");
const path = require("path");
const home = require("./home");

// The bridge numbers its own Execute Lua returnIDs from here up; plugins number theirs from 0 or 1 (research §2).
const BRIDGE_EXEC_BASE = 1000000000;

// The same check tools/tts-push-global.js runs: the player's own cards and decks (not engine, test or library cards).
// Returns "" when there are none.
const TABLE_CHECK_LUA = `
local mine = {}
for _, o in ipairs(getObjects()) do
  if o.type == "Card" or o.type == "Deck" then
    local gm = tostring(o.getGMNotes())
    if not gm:find("^engine:") and gm ~= "testcard" and gm ~= "libcard" then
      mine[#mine + 1] = o.type .. " '" .. tostring(o.getName()):gsub("\\n.*", "") .. "'" .. (o.type == "Deck" and (" (" .. o.getQuantity() .. " cards)") or "")
    end
  end
end
return table.concat(mine, "; ")`;

const DEFAULT_SAVE = path.join(process.env.USERPROFILE || "", "Documents", "My Games", "Tabletop Simulator", "Saves", "TS_Save_1.json");
const DEFAULT_BACKUP_DIR = home.tmp("backup");

// A function that copies the save file to backupDir as <name>-YYYY-MM-DD-HH-MM-SS.json (never overwriting one) and
// resolves to the copy's path. Throws (rejects) when the save is missing or can't be copied.
function makeSaveBackup(savePath = process.env.MTG_TTS_SAVE || DEFAULT_SAVE, backupDir = DEFAULT_BACKUP_DIR) {
  return async () => {
    const d = new Date();
    const stamp = [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join("-");
    const base = path.basename(savePath, ".json");
    await fs.promises.mkdir(backupDir, { recursive: true });
    for (let i = 0; i < 100; i++) {
      const to = path.join(backupDir, `${base}-${stamp}${i ? `-${i}` : ""}.json`);
      try { await fs.promises.copyFile(savePath, to, fs.constants.COPYFILE_EXCL); return to; } catch (e) { if (e.code !== "EEXIST") throw e; }
    }
    throw new Error("no free backup name");
  };
}

function createEditorForwarder(opts = {}) {
  const env = opts.env || process.env;
  const port = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 65536 ? n : 0; };
  const ttsPort = port(opts.ttsPort) || 39999; // TTS listens here
  const ttsInPort = port(opts.ttsInPort) || 39998; // the bridge listens here
  let forwardPort = port(opts.forwardPort ?? env.MTG_EDITOR_FORWARD_PORT);
  let commandPort = port(opts.commandPort ?? env.MTG_EDITOR_COMMAND_PORT);
  // the plugin listens on "localhost", which on Windows may be IPv6 only (research §1): try both
  const hosts = opts.hosts || ["127.0.0.1", "::1"];
  const listenHosts = opts.listenHosts || hosts;
  const ttsHost = opts.ttsHost || "127.0.0.1";
  const gameRunning = opts.gameRunning || (() => true); // (unknown = running: refuse)
  const checkTable = opts.checkTable || null; // () => Promise<{ value } | { error } | { timeout }>, the bridge's /exec
  const backupSave = opts.backupSave || makeSaveBackup(env.MTG_TTS_SAVE || DEFAULT_SAVE);
  const log = opts.log || (() => {});
  const now = opts.now || Date.now;
  const timeoutMs = opts.timeoutMs ?? 1000; // a send to the plugin gives up after this much silence
  const downMs = opts.downMs ?? 5000; // after every host refused, drop messages for this long
  const maxQueue = opts.maxQueue ?? 200; // messages waiting for the plugin; the oldest are dropped past this
  const getScriptsMs = opts.getScriptsMs ?? 5000; // a "game loaded" this soon after Get Scripts is its answer
  const checkTimeoutMs = opts.checkTimeoutMs ?? 10000;
  const maxCommandBytes = opts.maxCommandBytes ?? 64 * 1024 * 1024;
  const ttsTimeoutMs = opts.ttsTimeoutMs ?? 10000;

  // a port pointing back at the bridge or at TTS would loop messages forever
  if (forwardPort && (forwardPort === ttsInPort || forwardPort === ttsPort)) {
    log(`editor forward: port ${forwardPort} is the bridge's or TTS's own; forwarding stays off`);
    forwardPort = 0;
  }
  if (commandPort && (commandPort === ttsInPort || commandPort === ttsPort || commandPort === forwardPort)) {
    log(`editor forward: command port ${commandPort} clashes with another port; no command listener`);
    commandPort = 0;
  }
  const on = forwardPort > 0;

  const stats = { forwarded: 0, dropped: 0, blocked: 0, relayed: 0, pluginUp: null };
  const queue = [];
  let busy = false, downUntil = 0, closed = false, hostAt = 0;
  let getScriptsAt = 0; // when the plugin last asked for scripts (0 = no answer pending)
  let saveChecking = false;
  const servers = [];

  function setUp(up) {
    if (stats.pluginUp === up) return;
    stats.pluginUp = up;
    log(up ? `editor forward: plugin reachable on ${forwardPort}` : `editor forward: plugin not listening on ${forwardPort}; dropping its messages for ${downMs / 1000} s at a time`);
  }

  function send(text) {
    if (!on || closed) return;
    if (now() < downUntil) { stats.dropped++; return; }
    if (queue.length >= maxQueue) { queue.shift(); stats.dropped++; }
    queue.push(text);
    if (!busy) pumpOne();
  }
  // one connection at a time, so prints reach the plugin in order
  function pumpOne() {
    const text = queue.shift();
    if (text === undefined || closed) { busy = false; return; }
    busy = true;
    attempt(text, 0);
  }
  function attempt(text, tries) {
    const h = hostAt;
    let ok = false, done = false, refused = false;
    const sock = net.connect(forwardPort, hosts[h], () => { ok = true; sock.end(text); });
    sock.setTimeout(timeoutMs, () => { ok = false; stats.dropped++; sock.destroy(); });
    sock.on("error", (e) => { if (e.code === "ECONNREFUSED" || e.code === "EADDRNOTAVAIL") refused = true; });
    sock.on("close", (hadError) => {
      if (done) return;
      done = true;
      if (refused) {
        hostAt = (h + 1) % hosts.length; // (the other address next time: sticky once one works)
        if (tries + 1 < hosts.length) { attempt(text, tries + 1); return; }
        downUntil = now() + downMs;
        stats.dropped += 1 + queue.length;
        queue.length = 0;
        setUp(false);
      } else if (ok && !hadError) { stats.forwarded++; setUp(true); }
      setImmediate(pumpOne);
    });
  }

  // Called by the bridge for every parsed message from TTS. Returns true when the bridge should still handle it.
  // Never throws, never blocks: sends happen later.
  function offer(msg, text) {
    if (!on || !msg || typeof msg !== "object") return true;
    try {
      const id = msg.messageID;
      const raw = () => (typeof text === "string" && text ? text : JSON.stringify(msg));
      if (id === 4) {
        if (msg.customMessage && typeof msg.customMessage.t === "string") return true;
        send(raw());
        return false;
      }
      if (id === 5) {
        if (Number(msg.returnID) >= BRIDGE_EXEC_BASE) return true;
        send(raw());
        return false;
      }
      if (id === 0 || id === 6 || id === 7) { send(raw()); return false; }
      if (id === 1 && getScriptsAt && now() - getScriptsAt <= getScriptsMs) {
        getScriptsAt = 0;
        send(raw());
        return false;
      }
      send(raw());
      return true;
    } catch (e) {
      log(`editor forward: ${e.message}`);
      return true;
    }
  }

  function isRunning() { try { return !!gameRunning(); } catch { return true; } }

  function relayToTTS(text) {
    const sock = net.connect(ttsPort, ttsHost, () => sock.end(text));
    sock.setTimeout(ttsTimeoutMs, () => { log("editor forward: TTS didn't take the plugin's command in time"); sock.destroy(); });
    sock.on("error", (e) => log(`editor forward: plugin command to TTS failed: ${e.message}`));
    stats.relayed++;
  }

  function refuse(reason) {
    stats.blocked++;
    const why = `[MTG bridge] Save & Play blocked: ${reason}`;
    log(why);
    send(JSON.stringify({ messageID: 2, message: why }));
  }

  // null when Save & Play is safe (and the save is backed up), else the reason it isn't
  async function whyNotSaveAndPlay() {
    if (isRunning()) return "a game is running, and a reload wipes the table";
    if (!checkTable) return "the bridge can't check the table for the player's cards";
    let r;
    try {
      r = await Promise.race([Promise.resolve().then(checkTable), new Promise((res) => setTimeout(() => res({ timeout: true }), checkTimeoutMs))]);
    } catch (e) { return `couldn't check the table first (${e.message})`; }
    if (!r || r.error || r.timeout) return `couldn't check the table first (${(r && r.error) || "no answer"})`;
    if (r.value) return `the table has the player's own cards or decks, which a reload would wipe: ${String(r.value).slice(0, 300)}`;
    if (isRunning()) return "a game started while the table was checked";
    try { log(`editor forward: save backed up to ${await backupSave()}`); } catch (e) { return `couldn't back up the save first (${e.message})`; }
    return null;
  }

  async function saveAndPlay(text) {
    if (saveChecking) { refuse("another Save & Play is still being checked"); return; }
    saveChecking = true;
    try {
      const reason = await whyNotSaveAndPlay();
      if (reason) { refuse(reason); return; }
      getScriptsAt = 0; // its "game loaded" is a real reload: the bridge needs it
      relayToTTS(text);
    } catch (e) {
      refuse(`check failed (${e.message})`);
    } finally { saveChecking = false; }
  }

  function handleCommand(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    let cmd;
    try { cmd = JSON.parse(trimmed); } catch (e) { log(`editor forward: unreadable command from the plugin (${trimmed.length} bytes): ${e.message}`); return; }
    if (!cmd || typeof cmd !== "object") return;
    const id = cmd.messageID;
    if (id === 1) { saveAndPlay(trimmed); return; }
    if (id === 0) getScriptsAt = now();
    if (id === 3 && Number(cmd.returnID) >= BRIDGE_EXEC_BASE) log(`editor forward: the plugin's returnID ${cmd.returnID} is in the bridge's range; its answer will not reach the plugin`);
    relayToTTS(trimmed);
  }

  function onConnection(sock) {
    const chunks = [];
    let size = 0, tooBig = false;
    sock.setTimeout(30000, () => sock.destroy());
    sock.on("data", (c) => {
      if (tooBig) return;
      size += c.length;
      if (size > maxCommandBytes) { tooBig = true; log(`editor forward: plugin command over ${maxCommandBytes} bytes dropped`); sock.destroy(); return; }
      chunks.push(c);
    });
    sock.on("end", () => {
      if (tooBig) return;
      try { handleCommand(Buffer.concat(chunks).toString("utf8")); } catch (e) { log(`editor forward: ${e.message}`); }
    });
    sock.on("error", () => {});
  }

  // Opens the command listener on each listen host (if a command port is set). cb(err) gets the first host's error;
  // the others (e.g. no IPv6) are only logged. Nothing is thrown.
  function start(cb) {
    if (!on || !commandPort || servers.length) { if (cb) setImmediate(cb); return; }
    let left = listenHosts.length, firstErr = null;
    const one = () => { if (--left === 0) { if (servers.length) log(`editor forward: plugin messages go to ${forwardPort}; its commands come in on ${commandPort}`); if (cb) cb(firstErr || undefined); } };
    listenHosts.forEach((h, i) => {
      const s = net.createServer(onConnection);
      s.on("error", (e) => {
        log(`editor forward: command port ${commandPort} unavailable on ${h}: ${e.message}`);
        if (i === 0) firstErr = e;
        const k = servers.indexOf(s); if (k >= 0) servers.splice(k, 1);
        one();
      });
      s.listen(commandPort, h, () => { servers.push(s); one(); });
    });
  }

  function close(cb) {
    closed = true;
    queue.length = 0;
    const all = servers.splice(0);
    let left = all.length;
    if (!left) { if (cb) setImmediate(cb); return; }
    for (const s of all) s.close(() => { if (--left === 0 && cb) cb(); });
  }

  return {
    offer, start, close, stats: () => ({ ...stats, queued: queue.length }),
    enabled: on, forwardPort, commandPort,
  };
}

module.exports = { createEditorForwarder, makeSaveBackup, BRIDGE_EXEC_BASE, TABLE_CHECK_LUA };
