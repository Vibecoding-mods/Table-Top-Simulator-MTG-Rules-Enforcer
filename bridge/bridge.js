// TTS ↔ Manabrew bridge (SPEC.md §2–§5, milestone M3).
//   TTS Global Lua ⇄ External Editor API (localhost 39999/39998) ⇄ this bridge ⇄ Manabrew relay (one session per TTS seat)
// Run: node bridge.js [--relay ws://127.0.0.1:9443] [--key tts-local] [--room tts-commander]
// Node 22+ (built-in WebSocket). No dependencies.
const net = require("net");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const delta = require("./state-delta");
const versions = require("./versions");

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  const env = `MTG_${name.toUpperCase()}`;
  return i > 0 ? process.argv[i + 1] : process.env[env.replace(/-/g, "_")] || process.env[env] || def;
};
const RELAY = arg("relay", "ws://127.0.0.1:9443");
const KEY = arg("key", "tts-local");
const ROOM = arg("room", "tts-commander");
const CLIENT_VERSION = "3.56.0"; // ≥ 3.17.0 → relay sends change-only patches
const TTS_IN = Number(arg("tts-in", 39998)); // TTS sends to us here
const TTS_OUT = Number(arg("tts-out", 39999)); // TTS listens here
const { presetFile, presetIds } = require("./presets"); // decks/ (ours), then Manabrew's preset_decks
const COMPOSE = path.join(__dirname, "..", "stack", "compose.yml");
const DEFAULT_DECKS = ["neheb_minotaur_commander", "ashling_limitless_commander", "ramses_commander", "real_teval_commander"];

const t0 = performance.now();
const log = (...a) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1).padStart(7)}s]`, ...a);

// Runs fn; a throw is logged instead of ending the process (Node exits on an exception in a socket, WebSocket or timer
// callback, and every seat's engine connection, i.e. the game, goes with it).
function guarded(what, fn) {
  try { return fn(); } catch (e) { log(`ERROR in ${what}: ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e}`); return undefined; }
}

// ───────────────────────── TTS side ─────────────────────────
const outbox = [];
let sending = false;
// TTS only delivers flat messages intact (nested tables arrive as unusable C# objects, and nested sends from
// Lua are dropped), so every payload travels as a JSON string: { t, json }.
const ZONE_KEYS = ["hand", "battlefield", "graveyard", "exile", "command", "playable"];
function toTTS(customMessage) {
  if (game?.autoplay) return; // CPU-contention test: TTS gets nothing
  // (the table log: each question shown, and the chat players are told)
  if (customMessage.t === "prompt" && customMessage.promptId != null) {
    const opts = (customMessage.options || []).map((o) => o.label);
    tlog(customMessage.color, `is asked #${customMessage.promptId} "${customMessage.title || customMessage.kind || "?"}"${opts.length ? `: ${opts.slice(0, 8).join(" | ")}${opts.length > 8 ? ` | ... (${opts.length})` : ""}` : ""}`);
  } else if (customMessage.t === "chat") tlog(customMessage.color || "all", `told: ${customMessage.text}`);
  if (customMessage.t === "table") {
    // While TTS is still busy, a newer board replaces an older one waiting in line (each costs TTS a decode);
    // the older one's card details are kept, since they are only sent once.
    const i = outbox.findIndex((m) => m.t === "table");
    if (i >= 0) {
      // the newer board's "keep" means "same as the board before it": take those zones from the one it replaces
      const older = outbox[i].msg;
      for (const pl of customMessage.players || []) {
        const op = (older.players || []).find((p) => p.color === pl.color);
        if (!op || !pl.keep) continue;
        pl.keep = pl.keep.filter((z) => { if (op[z] != null) { pl[z] = op[z]; return false; } return true; });
        for (const z of op.keep || []) if (pl[z] == null && !pl.keep.includes(z)) pl.keep.push(z);
        if (!pl.keep.length) delete pl.keep;
      }
      customMessage = { ...customMessage, cards: { ...older.cards, ...customMessage.cards } };
      outbox.splice(i, 1);
    }
  }
  outbox.push({ t: customMessage.t, msg: customMessage });
  if (!sending) pump();
}
function pump() {
  const next = outbox.shift();
  if (!next) { sending = false; return; }
  const msg = { t: next.t, json: JSON.stringify(next.msg) };
  // MTG_RECORD=file: keep every message sent to TTS, with its time, for replaying into TTS (stutter hunting)
  if (process.env.MTG_RECORD) fs.appendFile(process.env.MTG_RECORD, JSON.stringify({ at: Date.now(), msg }) + "\n", () => {});
  ttsStats.n++; ttsStats.bytes += msg.json.length; ttsStats.max = Math.max(ttsStats.max, msg.json.length);
  if (next.t === "table") { ttsStats.tables++; ttsStats.tableBytes += msg.json.length; }
  ttsStats.maxByType[next.t] = Math.max(ttsStats.maxByType[next.t] || 0, msg.json.length);
  if (msg.json.length > 3000) ttsStats.big = [...(ttsStats.big || []).slice(-9), `${next.t} ${msg.json.length}`];
  sending = true;
  const sock = net.connect(TTS_OUT, "127.0.0.1", () => sock.end(JSON.stringify({ messageID: 2, customMessage: msg })));
  sock.on("close", pump);
  sock.setTimeout(10000, () => { log(`TTS didn't take a ${next.t} message within 10 s; moving on`); sock.destroy(); });
  sock.on("error", (e) => { if (e.code === "ECONNREFUSED") log("TTS not reachable on 39999 (is a game loaded?)"); else log(`sending to TTS: ${e.message}`); });
}
const ttsStats = { n: 0, bytes: 0, max: 0, tables: 0, tableBytes: 0, maxByType: {} };
const chat = (text, color) => toTTS({ t: "chat", text, color: color || null });

// ───────── table log: tmp/table-log.log (2026-10-24) ─────────
// The table's side of the game in plain words, one line per event: what each player was asked and what they answered,
// what they dragged and clicked that reached the engine, the chat they were told, and (from the table itself, "tlog")
// what the table did without the engine: held draws and their release, messages to a player, cards slid back. The
// bridge log only said "from TTS: answer (106 bytes)", and "Blue drew a card but it isn't on the table" (a draw held
// on the library with Blue's Auto off) took a live probe to explain.
const TABLE_LOG = path.join(__dirname, "..", "tmp", "table-log.log");
const clockNow = () => { const d = new Date(); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":"); };
function tlog(color, text) {
  fs.appendFile(TABLE_LOG, `[${clockNow()}] ${String(color || "-").padEnd(6)} ${text}\n`, () => {});
}

// Keeping the three aligned, seen on GET /versions and in a chat warning. Nothing here changes the game.
// (LIVE: the real bridge; a test that loaded this file has no docker)
const LIVE = require.main === module;
const CHECK_LOG = path.join(__dirname, "..", "tmp", "table-check.log"), GUESS_LOG = path.join(__dirname, "..", "tmp", "guess-log.log");
const BRIDGE_HASH = LIVE ? versions.bridgeHash() : null; // (read now: the code this process runs, whatever the file becomes)
let tableStamp; // the version the table last said: undefined until it said one, null from a table older than stamps
const alignment = { checks: 0, problems: 0, slowestMs: 0, guesses: {} }; // (since this bridge started)

// (a hello comes only at load: a bridge restarted under a loaded table hears the version from these)
function noteStamp(m) { if (m.stamp !== undefined) tableStamp = m.stamp; }

// What the table's own check said (engineCheckRun): each problem to tmp/table-check.log
function noteCheck(m) {
  const problems = String(m.problems || "").split("\n").filter(Boolean);
  noteStamp(m);
  alignment.checks++;
  alignment.problems += problems.length;
  alignment.slowestMs = Math.max(alignment.slowestMs, Number(m.ms) || 0);
  for (const p of problems) fs.appendFile(CHECK_LOG, `[${clockNow()}] turn ${m.turn} ${m.step}: ${p}\n`, () => {});
}

// The log worked something out from two boards though Forge's event feed is on: each one is a thing the feed doesn't
// cover yet. kind: "no feed", "feed gap", "arrival" or "departure".
function noteGuess(kind, detail) {
  alignment.guesses[kind] = (alignment.guesses[kind] || 0) + 1;
  fs.appendFile(GUESS_LOG, `[${clockNow()}] ${kind}: ${detail}\n`, () => {});
}

function versionsNow(done) { versions.containerImages((images) => done({ bridge: BRIDGE_HASH, table: tableStamp, ...images })); }
function warnOutOfStep(now, deployed) { for (const w of versions.outOfStep(now, deployed)) chat(`[MTG] ${w}`); }
function warnIfOutOfStep() {
  if (!LIVE) return;
  versionsNow((now) => warnOutOfStep(now, versions.readManifest()));
}
// Forge's question for an optional trigger or replacement ("Use triggered ability of Sylvan Library?", "Apply
// replacement effect of Abundance?" with its text on the next lines): its first line
const OPTIONAL_ASK = /^(?:Use (?:triggered ability of )?|Apply replacement effect of ).+\?$/;
// A spell that counters its target for sure: "Counter target ..." with no "unless" (Flusterstorm's copies, "unless its
// controller pays {1}", were paid for, and "Chart a Course is countered" was logged as it resolved, hp-08 gap)
const isCounterspell = (t) => /\bcounter target\b/i.test(t) && !/\bunless\b/i.test(t);
// a line in the game log, and to the table's log panel
function gameLogLine(line) {
  // (players by their table names, whatever the caller built the line from: a reveal's raw title put "self-hosted-node-
  // …-bot's Battlefield" in the log, hp-20 gap)
  line = displayText(line);
  (game.log ??= []).push(line);
  toTTS({ t: "gamelog", lines: [line] });
}
// cards from a player's hand put on top of their library, which the boards alone don't say (the hand's drop beside the
// library's rise): Brainstorm's pick, Sylvan Library's card put back (hp-26)
function sayPutOnTop(seat, n) {
  if (game) gameLogLine(`${seat.color} puts ${countWords(n, n, "card")} from their hand on top of their library`);
}
// a card's name from any seat's view (the table sends ids)
function tlogCard(id) {
  for (const st of game?.seats?.values() || []) {
    for (const z of st.board?.state?.gameView?.zones || []) for (const c of z.cards || []) if (c.id === id) return c.identity?.name || id;
  }
  return id;
}
// what a message from the table means, in words (null: not logged here)
function tlogIn(m) {
  const seat = game?.seats?.get(m.color);
  switch (m.t) {
    case "answer": {
      const open = seat?.prompt;
      const labels = new Map((open?.ui?.options || []).map((o) => [String(o.id), o.label]));
      const chosen = asList(m.choice).map((c) => labels.get(String(c)) ?? String(c));
      const stale = open?.promptId !== m.promptId ? ` (the open question is #${open?.promptId ?? "none"})` : "";
      return `answers #${m.promptId}${stale} "${open?.ui?.title || open?.type || "?"}": ${chosen.join(", ") || "(nothing)"}`;
    }
    case "intent": return `${m.kind} ${tlogCard(m.id)}${m.to ? ` -> ${m.to}` : ""}`;
    case "hello": return "table connected";
    case "check": return null; // (tmp/table-check.log has it)
    case "decks": return `sends the decks on the table (${Object.keys(m.decks || {}).join(", ") || "none"})`;
    case "tlog": return null;
    default: {
      const { t, color, json, ...rest } = m;
      return `${t} ${JSON.stringify(rest).slice(0, 200)}`;
    }
  }
}

const server = net.createServer((sock) => {
  const chunks = [];
  sock.on("data", (c) => chunks.push(c));
  sock.on("end", () => {
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (!text) return;
    let msg;
    try { msg = JSON.parse(text); } catch (e) {
      log(`unreadable message from TTS (${text.length} bytes): ${e.message}; starts ${JSON.stringify(text.slice(0, 120))} ends ${JSON.stringify(text.slice(-80))}`);
      return;
    }
    if (msg.messageID === 4 && msg.customMessage) {
      if (process.env.MTG_TRACE) log(`from TTS: ${msg.customMessage.t} (${text.length} bytes)`);
      guarded(`TTS message ${msg.customMessage.t}`, () => onTTS(msg.customMessage));
    } else guarded("TTS debug message", () => onTTSDebug(msg));
  });
  sock.on("error", () => {});
});
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error(`Port ${TTS_IN} is taken: close the VSCode/Atom TTS plugin (or another bridge) and retry.`);
  else console.error(e);
  process.exit(1);
});

// ───────────────────────── Game / seats ─────────────────────────
let game = null; // { seats: Map<color, Seat>, bots, playerOrder, slotNames, started }
const deckChoice = {}; // color → preset id
// color → true: the player's Auto-resolve toggle (2026-10-23): on other players' turns priority passes by itself, even
// with an instant or a sacrifice outlet in hand (no "Resolve" to press each time). Kept from game to game.
const autoResolve = {};
const aiDeckChoice = []; // preset ids for the AI players, in order ("mtg aideck <id>")

function loadPreset(id) {
  const file = presetFile(id);
  const p = JSON.parse(fs.readFileSync(file, "utf8"));
  const toCard = (e) => ({
    identity: { name: e.name, setCode: e.set || "", cardNumber: String(e.cardNumber || "") },
    manaCost: e.manaCost || "", cmc: e.cmc || 0, types: e.types || [], subtypes: e.subtypes || [],
    supertypes: e.supertypes || [], colorIdentity: e.colorIdentity || [], text: e.text || "", uris: {},
  });
  const cards = [];
  let commander = null;
  for (const e of p.cards) {
    if (p.commander && e.name === p.commander && !commander) { commander = toCard(e); continue; }
    for (let k = 0; k < (e.count || 1); k++) cards.push(toCard(e));
  }
  const deck = { name: p.label, cards, sideboard: [], format: p.format || "commander" };
  if (commander) deck.commanders = [commander];
  return { deckName: p.label, deck, commanderName: p.commander || null };
}

// ───────────────────────── Decks imported on the table ("mtg ready") ─────────────────────────
// Forge's card names, built by tools/build-forge-card-index.js from the engine container.
let forgeCards = null;
function forgeIndex() {
  if (!forgeCards) {
    try { forgeCards = JSON.parse(fs.readFileSync(path.join(__dirname, "forge-cards.json"), "utf8")).index; }
    catch { forgeCards = {}; log("forge-cards.json missing: run node tools/build-forge-card-index.js"); }
  }
  return forgeCards;
}
const normName = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘`]/g, "'")
  .replace(/\s+/g, " ").trim().toLowerCase();
const BASICS = new Set(["plains", "island", "swamp", "mountain", "forest", "wastes",
  "snow-covered plains", "snow-covered island", "snow-covered swamp", "snow-covered mountain", "snow-covered forest", "snow-covered wastes"]);
const readyDecks = {}; // color → { deckName, cards, commanders, images }
const asList = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []);

function checkDeck(color, entry) {
  const index = forgeIndex();
  const unknown = [];
  const commanders = [];
  const cards = [];
  const images = {}; // engine name → the table's own card images
  const resolve = (c) => {
    const name = index[normName(c.n)];
    if (!name) { unknown.push(c.n || "(unnamed card)"); return null; }
    images[name] ??= { face: c.f || null, back: c.b || null };
    return name;
  };
  for (const c of asList(entry.commander)) { const n = resolve(c); if (n) commanders.push(n); }
  for (const c of asList(entry.library)) { const n = resolve(c); if (n) cards.push(n); }
  for (const cmd of commanders) { const i = cards.indexOf(cmd); if (i >= 0) cards.splice(i, 1); } // commander left in the library
  const counts = {};
  for (const n of cards) counts[n] = (counts[n] || 0) + 1;
  const extras = Object.entries(counts).filter(([n, k]) => k > 1 && !BASICS.has(normName(n))).map(([n, k]) => `${k}× ${n}`);
  const total = cards.length + commanders.length;

  const problems = [];
  if (!asList(entry.library).length) problems.push("no deck found in your library zone; put your imported deck there");
  if (!commanders.length) problems.push("no commander found; put it on your command zone, or hover it and type: mtg commander");
  if (unknown.length) problems.push(`the engine doesn't know ${unknown.length} card(s): ${unknown.slice(0, 8).join(", ")}${unknown.length > 8 ? `, and ${unknown.length - 8} more` : ""}. Swap them out or fix the names`);
  const warnings = [];
  if (asList(entry.library).length && total !== 100) warnings.push(`${total} cards (Commander decks are 100 including the commander)`);
  if (extras.length) warnings.push(`more than one copy of: ${extras.slice(0, 5).join(", ")}${extras.length > 5 ? " ..." : ""} (fine only if the card allows it)`);

  const label = `${color}${entry.deckName ? ` (${entry.deckName})` : ""}`;
  if (problems.length) {
    delete readyDecks[color];
    chat(`[MTG] ${label}: not ready.\n- ${problems.join("\n- ")}${warnings.length ? `\nAlso: ${warnings.join("; ")}` : ""}`, color);
    return false;
  }
  readyDecks[color] = { deckName: entry.deckName || `${color}'s deck`, cards, commanders, images };
  checkDeckImages(images);
  chat(`[MTG] ${label}: ready. ${cards.length} cards + commander ${commanders.join(" & ")}; every card is known to the engine.${warnings.length ? `\nCheck: ${warnings.join("; ")}` : ""}`, color);
  log(`${color} deck ready: ${total} cards, commander ${commanders.join(" & ")}`);
  return true;
}

function onDecks(m) {
  const seats = m.seats && typeof m.seats === "object" ? m.seats : {};
  const colors = Object.keys(seats);
  const ok = colors.filter((c) => checkDeck(c, seats[c]));
  if (colors.length > 1) chat(`[MTG] Decks ready: ${ok.length}/${colors.length}${ok.length ? ` (${ok.join(", ")})` : ""}.`);
  toTTS({ t: "deckReport", request: m.request, ready: ok, checked: colors });
}

// The engine's deck format, built from a deck checked by "mtg ready". Names only: Forge picks the printing,
// while the table keeps showing each card's own images.
function engineDeckFromTable(r) {
  const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, uris: {} });
  return {
    deckName: r.deckName,
    deck: { name: r.deckName, cards: r.cards.map(card), sideboard: [], format: "commander", commanders: r.commanders.map(card) },
    commanderName: r.commanders[0] || null,
  };
}

function listCommanderPresets() {
  try {
    return presetIds().filter((id) => { try { return JSON.parse(fs.readFileSync(presetFile(id), "utf8")).format === "commander"; } catch { return false; } });
  } catch { return DEFAULT_DECKS; }
}

// Relay link recovery (2026-10-20). A dropped link used to end the game ("lost the engine connection", never back).
// The relay keeps a seat for the room's reconnect window (reconnect_timeout_s, 60 s by default; then the node
// concedes it), and logging in again with the same username reclaims the session (AuthResult reconnected:true).
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000]; // then every 8 s
const RECONNECT_GIVE_UP_MS = 55000; // last try starts by ~63 s: the relay forfeits the seat at reconnect_timeout_s + 5 = 65 s
const PING_EVERY_MS = 20000, SILENT_DEAD_MS = 45000;

class Seat {
  // resume: { username, slot, roomId } of a seat saved before the bridge stopped (resumeGame): it logs in again under
  // the same name as a reconnect (AuthResult below), so the relay hands back its seat and RequestResync the game
  constructor(color, deckId, resume = null) {
    this.color = color;
    this.deckId = deckId;
    this.username = resume?.username || `tts-${color}-${Math.random().toString(36).slice(2, 6)}`;
    this.slot = resume?.slot || null;
    this.board = null; // { state, fingerprint }
    this.prompt = null; // { promptId, ui, toOutput }
    this.joined = false;
    this.ready = false;
    this.closed = false; // "mtg reset" closed it on purpose: no reconnect
    this.lostAt = null;  // when the link to the relay dropped mid-game (reconnecting while set)
    if (resume) { this.roomId = resume.roomId; this.joined = true; this.lostAt = Date.now(); this.tries = 0; }
    this.connect();
  }
  // One relay connection. A link that drops mid-game is reconnected (see RECONNECT_DELAYS); a replaced or dead
  // socket's late events are ignored (`ws !== this.ws`, `ws.dead`).
  connect() {
    const ws = new WebSocket(RELAY);
    this.ws = ws;
    ws.binaryType = "arraybuffer"; // the default "blob" can't be read synchronously (Buffer.from threw)
    ws.addEventListener("open", () => {
      this.heardAt = Date.now();
      this.send({ type: "Authenticate", username: this.username, password: KEY, service: false,
        client_platform: "unknown", engine_gate: "unknown", client_version: CLIENT_VERSION });
      this.heartbeat(ws);
    });
    ws.addEventListener("message", (ev) => {
      if (ws !== this.ws) return;
      this.heardAt = Date.now();
      guarded(`${this.color} relay message`, () => this.onRelay(JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8"))));
    });
    ws.addEventListener("close", () => { if (ws === this.ws && !ws.dead) { ws.dead = true; this.onClosed(); } });
    ws.addEventListener("error", () => {});
  }
  // A Ping every PING_EVERY_MS; nothing at all heard for SILENT_DEAD_MS means a dead link that never closed
  // (Wi-Fi gone, laptop asleep): treat it as closed. (The relay also pings at the WebSocket level every 25 s.)
  heartbeat(ws) {
    clearTimeout(this.pingTimer);
    this.pingTimer = setTimeout(() => {
      if (ws !== this.ws || ws.dead || this.closed) return;
      if (Date.now() - this.heardAt > SILENT_DEAD_MS) {
        log(`${this.color}: nothing from the relay for ${Math.round((Date.now() - this.heardAt) / 1000)} s; reconnecting`);
        ws.dead = true;
        try { ws.close(); } catch {}
        return this.onClosed();
      }
      this.send({ type: "Ping" });
      this.heartbeat(ws);
    }, PING_EVERY_MS);
  }
  onClosed() {
    clearTimeout(this.pingTimer);
    if (this.closed || !game || game.closing || game.seats.get(this.color) !== this) return;
    if (!game.started || !this.slot) {
      // before the game there is no seat to reclaim: setting up again is the way back
      log(`${this.color}: relay connection closed before the game started`);
      return chat(`[MTG] ${this.color} lost the engine connection while setting up. Type "mtg reset", then "mtg start".`);
    }
    if (this.lostAt == null) {
      this.lostAt = Date.now();
      this.tries = 0;
      log(`${this.color}: relay connection lost; reconnecting`);
      chat(`[MTG] ${this.color} lost the engine connection. Reconnecting...`);
    }
    if (Date.now() - this.lostAt > RECONNECT_GIVE_UP_MS) {
      log(`${this.color}: gave up reconnecting after ${Math.round((Date.now() - this.lostAt) / 1000)} s`);
      this.lostAt = null;
      return chat(`[MTG] ${this.color} couldn't reconnect to the engine within a minute (the engine concedes a seat that stays away). Type "mtg reset" to start over.`);
    }
    const delay = RECONNECT_DELAYS[Math.min(this.tries++, RECONNECT_DELAYS.length - 1)];
    this.reconnectTimer = setTimeout(() => { if (!this.closed && game && !game.closing && game.seats.get(this.color) === this) this.connect(); }, delay);
  }
  send(msg) {
    if (this.ws.readyState === 1 && !this.ws.dead) return this.ws.send(JSON.stringify(msg));
    // (while reconnecting: the engine asks the open question again after the resync)
    if (msg.type === "BroadcastState") log(`${this.color}: not sent, relay link down: ${msg.state?.kind}`);
  }
  // What the player just did, by kind, as { id, name, at } — one store, asked and forgotten one way (these were five
  // separate fields with their own time limits and clearing, structural review 2026-10-27):
  //   "activate"  an ability they used (its own "Sacrifice X?" is then answered yes, see chooseBoolean)
  //   "manaTap"   a mana source they tapped (its own "pay 1 life?" is part of tapping it: Mana Confluence)
  //   "revealInstead"  the kind a replacement reveals until, by its card's name, and the card it was asked under
  //               (Abundance's reveal comes as a look under the drawing card, see revealCards)
  //   "mayYes"    Yes to a trigger's "you may ...", its words as text (the card's own restating of it is answered)
  //   "start"     a spell or ability they started, or Pay on their card's may-pay question (the pool pays it)
  //   "search"    a look at their own library (the card that reaches the hand next was put there, not drawn)
  note(kind, id, name = null, text = "") { (this.lately ??= {})[kind] = { id, name, text, at: Date.now() }; }
  justDid(kind, ms) { const r = this.lately?.[kind]; return r && Date.now() - r.at < ms ? r : null; }
  forget(kind) { if (kind) delete this.lately?.[kind]; else this.lately = {}; }
  respond(promptId, type, output) {
    // (cards chosen to discard: what reaches the graveyard next is a discard, instants too; see logEvents)
    const asked = this.lastRawPrompt?.input?.presentation;
    if (type === "chooseCards" && /discard/i.test(`${asked?.title || ""} ${asked?.description || ""}`)) this.note("discard", this.slot);
    // (a mana source tapped while paying too: its own "pay 1 life?" is part of tapping it; Mana Confluence tapped for
    // Vampiric Tutor's {B} asked it, hp-08 gap)
    if (type === "payManaCost" && output?.type === "act") {
      const act = (this.lastRawPrompt?.input?.actions || []).find((a) => a.id === output.actionId);
      const card = act?.cardId ? cardIndex(this.board?.state?.gameView || {})[act.cardId] : null;
      if (card) this.note("manaTap", act.cardId, card.identity?.name || null, `${act.cost || ""} ${card.text || ""}`);
    }
    if (type === "chooseAction" && output?.type === "act") {
      const act = (this.lastRawPrompt?.input?.actions || []).find((a) => a.id === output.actionId);
      // (with its name: Forge asks a cost's "Sacrifice Dauthi Voidwalker?" without a source card, playtest 2026-10-27)
      const cardName = act?.cardId ? cardNameIn(this, act.cardId, null) : null;
      // (with the ability's cost: only the cost it names is confirmed for the player, altitude review 2026-10-27; the
      // words before the ":" when Forge sends no cost apart, not the effect's, stage 3 review 2026-10-27)
      // (no cost apart and no ":": the cost is unknown and nothing is confirmed for the player, suite review 2026-10-27)
      const desc = String(act?.description || "");
      const text = act?.cost || (desc.includes(":") ? desc.split(":")[0] : "");
      if (act?.cardId && act.type === "activateAbility") this.note("activate", act.cardId, cardName, text); else this.forget("activate");
      if (act?.cardId && act.isManaAbility) this.note("manaTap", act.cardId, cardName, text);
      if (act?.cardId && (act.type === "cast" || act.type === "activateAbility") && !act.isManaAbility) {
        this.note("start", act.cardId, cardName);
        notePlay(this, act, cardName, promptId);
      } else this.forget("start");
    }
    // (a pass or another answer to the priority question: no ability is being paid for any more)
    if (type === "chooseAction" && output?.type !== "act") this.forget("activate");
    // (a cost cancelled: the spell or ability never happened, and nothing it started may answer a later question. Only
    // that one: an earlier play not logged yet stays, and so do a tapped land and a look at the library, stage 3 review)
    if (output?.type === "cancel") {
      const started = this.lately?.start;
      const k = started ? (game?.pendingPlays || []).findLastIndex((e) => e.ctl === this.slot && e.id === started.id) : -1;
      if (k >= 0) game.pendingPlays.splice(k, 1);
      this.forget("start");
      this.forget("activate");
    }
    this.send({ type: "BroadcastState", state: { kind: "response", fromPlayer: this.slot, promptId: promptId ?? 0, action: { type, output } } });
  }
  // engine directives (rewind: requestRestore / restoreVote; engine-interface-reference §6)
  directive(d) { this.send({ type: "BroadcastState", state: { kind: "directive", fromPlayer: this.slot, directive: d } }); }
  onRelay(msg) {
    switch (msg.type) {
      case "AuthResult":
        if (!msg.success && this.lostAt != null) {
          // e.g. the old session isn't released yet: close and let the retry loop try again
          log(`${this.color}: relay refused the reconnect (${msg.error}); retrying`);
          this.ws.dead = true;
          try { this.ws.close(); } catch {}
          return this.onClosed();
        }
        if (!msg.success) { log(`${this.color}: relay refused login (${msg.error})`); chat(`[MTG] ${this.color}: relay refused login (${msg.error}).`); return; }
        if (this.lostAt != null) {
          // back in: the relay kept the session (reconnected) or, after a relay restart, the seat is retaken with
          // JoinRoom; then RequestResync replays GameStarted (ignored: the game is running), the board and the question
          const secs = Math.round((Date.now() - this.lostAt) / 1000);
          this.lostAt = null; // (the retry count starts over at the next drop: onClosed resets it)
          if (!msg.reconnected && this.roomId) {
            // (the node may not have rebuilt the room yet: a "room not found" is retried until rejoinUntil)
            this.rejoinUntil = Date.now() + RECONNECT_GIVE_UP_MS;
            this.send({ type: "JoinRoom", room_id: this.roomId, observe: false, as_bot: false });
          }
          this.send({ type: "RequestResync" });
          log(`${this.color}: reconnected after ${secs} s (${msg.reconnected ? "session kept" : "seat retaken"})`);
          chat(`[MTG] ${this.color} reconnected to the engine.`);
          break;
        }
        this.send({ type: "ListRooms" });
        break;
      case "RoomList": {
        if (this.roomId || !game || game.closing) break; // late reply after "mtg reset"
        // a game that was cut off keeps its old room busy for a while; a freshly started engine opens a new one
        const room = msg.rooms.find((r) => r.room_name === ROOM && r.status === "Lobby") || msg.rooms.find((r) => r.room_name === ROOM);
        // a room that has just been restarted takes a few seconds to open again: ask again, every 2 s for 60 s
        if (!room || room.status !== "Lobby") {
          this.roomTries = (this.roomTries || 0) + 1;
          if (this.roomTries <= 30) {
            log(`room ${ROOM} ${room ? `busy (${room.status})` : "not found"}; asking again (${this.roomTries})`);
            setTimeout(() => { if (!this.closed && game && !game.closing && !this.roomId) this.send({ type: "ListRooms" }); }, 2000);
            return;
          }
          if (!room) { log(`room ${ROOM} not found`); chat(`[MTG] Room "${ROOM}" not found. Is the Docker stack running?`); return; }
          log(`room ${ROOM} busy (${room.status})`); chat(`[MTG] Room is busy with another game. Type "mtg reset".`); return;
        }
        this.roomId = room.room_id;
        game.roomId = room.room_id;
        this.send({ type: "JoinRoom", room_id: this.roomId, observe: false, as_bot: false });
        break;
      }
      case "RoomUpdate":
        if (msg.room.room_id === this.roomId) onRoomUpdate(this, msg.room);
        break;
      case "GameStarted":
        this.slot = `player-${msg.player_order.indexOf(this.username)}`;
        onGameStarted(msg);
        break;
      case "StateUpdate":
        if (!game || game.closing) break; // late update after "mtg reset"
        this.rejoinUntil = null; // back in the room
        this.onEnvelope(msg.state);
        break;
      case "Error":
        if (this.rejoinUntil && Date.now() < this.rejoinUntil && /room_not_found|not_in_room|game_not_in_progress/.test(msg.code)) {
          log(`${this.color}: rejoin refused (${msg.code}); trying again in 2 s`);
          if (this.rejoinPending) break; // (JoinRoom and RequestResync can both be refused: one retry for both)
          this.rejoinPending = true;
          this.rejoinTimer = setTimeout(() => {
            this.rejoinPending = false;
            if (this.closed || !game || game.closing) return;
            this.send({ type: "JoinRoom", room_id: this.roomId, observe: false, as_bot: false });
            this.send({ type: "RequestResync" });
          }, 2000);
          break;
        }
        log(`${this.color}: relay error ${msg.code}: ${msg.message}`);
        if (msg.code !== "NotHost" && msg.code !== "not_host") chat(`[MTG] Relay: ${msg.message}`, this.color);
        break;
      case "GameAborted": {
        log(`${this.color}: game aborted by the relay`);
        // Forge stops with a NullPointerException while writing the result of a game a player lost by drawing from an
        // empty library (2026-10-22: turn 28, library 0, right after declining Abundance), and the relay calls that
        // "aborted". Say what happened, once.
        if (game?.abortSaid) break;
        if (game) game.abortSaid = true;
        const gv = this.board?.state?.gameView;
        // (a game won by life, poison or commander damage also ends here: then that is the reason, not an empty library;
        // playtest 2026-10-27: 12 poison was reported as White drawing from an empty library)
        const lost = lossReasons(gv);
        const empty = (gv?.players || []).filter(outLast).filter((p) => (gv.zones || []).some((z) => z.zone === "library" && z.ownerId === p.id) && !zoneOf(gv, "library", p.id).count);
        // (a known reason wins: at the end the library count is not to be trusted, the poisoned game above read as an
        // empty library. Only the players who lost last count, see outLast.)
        if (lost) { chat(`[MTG] Game over: ${lost}.`); break; }
        chat(empty.length ? `[MTG] Game over: ${empty.map((p) => nameOf(p.id)).join(", ")} had to draw from an empty library (that's a loss). The engine stopped the game there.` : "[MTG] Game aborted.");
        break;
      }
    }
  }
  onEnvelope(env) {
    if (!env || !this.slot) return;
    const forUs = env.forPlayer === this.slot;
    switch (env.kind) {
      case "state":
        if (forUs || (!this.board && env.forPlayer == null)) { this.board = { state: env.state, fingerprint: env.fingerprint ?? null }; checkRestored(this); noteOuts(env.state?.gameView); scheduleView(this); }
        break;
      case "stateDelta":
        if (!forUs) break;
        if (!this.board || this.board.fingerprint !== env.base) { this.send({ type: "RequestResync" }); break; }
        this.board = { state: delta.apply(this.board.state, env.patch), fingerprint: env.fingerprint };
        noteOuts(this.board.state?.gameView);
        checkRestored(this);
        scheduleView(this);
        break;
      case "prompt":
        if (env.forPlayer === this.slot) {
          const ok = guarded(`${this.color} prompt ${env.prompt?.input?.type}`, () => (onPrompt(this, env.prompt), true));
          if (!ok) chat(`[MTG] Couldn't show the engine's question (${env.prompt?.input?.type || "?"}); see the bridge log. Try "mtg reset" if the game is stuck.`, this.color);
        }
        break;
      case "error":
        if (forUs) { log(`${this.color}: engine rejected answer: ${JSON.stringify(env.error)}`); chat(`[MTG] Engine rejected that answer (${env.error?.code || "error"}).`, this.color); }
        break;
      case "log":
        if (this === leadSeat()) onGameLog(env.entry);
        break;
      case "fatal":
        log(`engine fatal: ${env.message}`);
        chat(`[MTG] Engine error: ${env.message}`);
        break;
    }
  }
  close() {
    this.closed = true;
    clearTimeout(this.pingTimer);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.rejoinTimer);
    try { this.send({ type: "LeaveRoom" }); this.ws.close(); } catch {}
  }
}

// ───────── Crash recovery (2026-10-22) ─────────
// The running game is saved every few seconds (who sits where, under which relay username, in which room). A bridge
// that starts again within the relay's grace period (it gives a dropped player's seat away after ~65 s) logs back in
// as the same players and asks for a resync: the board and the open question come back, the game goes on. The
// bridge once died mid-game (exit 0xC0000409, nothing in its log) and the game was lost with it.
const RESUME_FILE = process.env.MTG_RESUME_FILE || path.join(__dirname, "..", "tmp", "bridge-game.json");
const RESUME_MAX_AGE_MS = 50000;
function saveResume() {
  if (!game || !game.started || game.closing || game.autoplay || game.over) return;
  const snap = {
    savedAt: Date.now(),
    game: { bots: game.bots, total: game.total, playerOrder: game.playerOrder, slotNames: game.slotNames, slotColor: game.slotColor,
      fromTable: game.fromTable, roomId: game.roomId, deckNames: [...(game.deckNames || [])],
      // (who had which turn: "White's 6th turn" read "2nd" after a resume without it)
      turnOwners: game.turnOwners || {} },
    seats: [...game.seats.values()].map((st) => ({ color: st.color, deckId: st.deckId, username: st.username, slot: st.slot, roomId: st.roomId })),
  };
  const tmp = `${RESUME_FILE}.tmp`;
  fs.mkdir(path.dirname(RESUME_FILE), { recursive: true }, () =>
    fs.writeFile(tmp, JSON.stringify(snap), (e) => { if (!e) fs.rename(tmp, RESUME_FILE, () => {}); }));
}
function clearResume() { fs.unlink(RESUME_FILE, () => {}); }
// At startup: a saved game younger than RESUME_MAX_AGE_MS is rejoined (true); an older one is dropped.
function resumeGame(now = Date.now()) {
  let snap;
  try { snap = JSON.parse(fs.readFileSync(RESUME_FILE, "utf8")); } catch { return false; }
  const age = now - (snap.savedAt || 0);
  if (game || !snap.seats?.length || age > RESUME_MAX_AGE_MS) {
    if (!game) log(`saved game not resumed (${Math.round(age / 1000)} s old)`);
    clearResume();
    return false;
  }
  game = { ...snap.game, deckNames: new Set(snap.game.deckNames || []), seats: new Map(), started: true, closing: false,
    maxSet: true, botsRequested: true, startSent: true, resumed: true };
  for (const st of snap.seats) game.seats.set(st.color, new Seat(st.color, st.deckId, st));
  log(`resuming the game saved ${Math.round(age / 1000)} s ago: ${snap.seats.map((st) => `${st.color} as ${st.username}`).join(", ")}`);
  chat("[MTG] The bridge restarted: rejoining the game...");
  // (once the seats are back and the board has come in)
  setTimeout(() => guarded("resend after resume", resendToTable), 3000);
  return true;
}

// The running game, all of it, to the table again so it can redraw: after a table reload, after the bridge itself
// restarted (the table sends no new "hello" then: playtest 2026-10-23, the reloaded table showed READY / Start and
// pressing Start reset the game the engine still held), or when Start is pressed while a game runs.
function resendToTable() {
  if (!game?.started || !game.fromTable) return;
  game.sentStatic = {};
  if (game.log?.length) toTTS({ t: "gamelog", lines: game.log.slice(-60), reset: true });
  game.lastTableSig = null;
  game.sentZones = {};
  toTTS({ t: "started", colors: game.slotColor, names: game.slotNames, ai: Object.keys(game.slotColor).filter((k) => !TABLE_COLORS.includes(game.slotNames[k])).map((k) => game.slotColor[k]) });
  scheduleTable();
  for (const st of game.seats.values()) autoNotice(st); // (a reloaded table has forgotten its Auto-resolve lists)
  // show each player's still-open question again (re-running the last prompt could answer it twice)
  for (const st of game.seats.values()) if (st.prompt?.ui) toTTS({ t: "prompt", color: st.color, promptId: st.prompt.promptId, ...st.prompt.ui, ...(st.prompt.ui.allCards ? { cards: st.prompt.ui.allCards } : {}) });
}

// fromTable: the group's table draws the game (default: games whose decks come from the table)
function startGame(seatList, bots, requireReady = false, fromTable = requireReady, aiSeats = []) {
  if (game) { chat('[MTG] A game is already set up. Type "mtg reset" first.'); return; }
  const notReady = requireReady ? seatList.filter((c) => !readyDecks[c]) : [];
  if (notReady.length) { chat(`[MTG] Not started: ${notReady.join(", ")} still need \"mtg ready\" (import your deck, put your commander on the command zone).`); return; }
  const total = seatList.length + bots;
  if (!seatList.length) { chat("[MTG] Nobody is seated."); return; }
  // the table has a playmat per colour (TABLE_COLORS); a 5th player had no colour and no zones (5-8 players: PLAN M6)
  if (total < 2 || total > TABLE_COLORS.length) { chat(`[MTG] Need 2-${TABLE_COLORS.length} players total (seated ${seatList.length} + ${bots} AI).`); return; }
  game = { seats: new Map(), bots, total, playerOrder: [], slotNames: {}, slotColor: {}, started: false, closing: false, fromTable, setupAt: Date.now(), pendingPlays: [],
    // decks put in empty seats' library zones (checked by "mtg ready" like a player's) are played by the AI
    aiTableDecks: aiSeats.filter((c) => readyDecks[c]).slice(0, bots).map((c) => engineDeckFromTable(readyDecks[c])) };
  for (const c of aiSeats) if (!readyDecks[c]) chat(`[MTG] The deck in ${c}'s seat isn't ready (see above); that AI plays a built-in deck.`);
  seatList.forEach((color, i) => game.seats.set(color, new Seat(color, deckChoice[color] || DEFAULT_DECKS[i % DEFAULT_DECKS.length])));
  chat(`[MTG] Setting up: ${seatList.join(", ")}${bots ? ` + ${bots} Forge AI` : ""}...`);
  log(`setup: seats ${seatList.join(", ")}, bots ${bots}, relay ${RELAY}`);
}

// Only the room's controller may start the game or add AI players; sending from any other seat is refused with
// "not_host". The controller is the first human seated (the relay's Room::controller_id). room.host is the engine node
// in a hosted room, never a player: asking it always picked White, so a game where Blue's connection joined first
// stayed on "Setting up" until a third Start restarted the room (playtest 2026-10-31).
function controllerOf(room, seats) {
  const first = room.players.find((p) => !p.is_bot) || room.players[0];
  return seats.find((s) => s.username === first?.username) || seats[0];
}

function onRoomUpdate(seat, room) {
  if (!game || game.closing) return; // a late update after "mtg reset"
  const me = room.players.find((p) => p.username === seat.username);
  if (me && !seat.joined) {
    seat.joined = true;
    const d = readyDecks[seat.color] ? engineDeckFromTable(readyDecks[seat.color]) : loadPreset(seat.deckId);
    seat.send({ type: "SetDeckSelection", deck_name: d.deckName, deck: d.deck, commander_name: d.commanderName });
    seat.commanderNames = (d.deck.commanders || []).map((c) => c.identity?.name || c.name).filter(Boolean);
    (game.deckNames ??= new Set());
    for (const c of [...(d.deck.cards || []), ...(d.deck.commanders || [])]) game.deckNames.add(c.identity?.name || c.name);
    seat.send({ type: "SetReady", ready: true });
    chat(`[MTG] ${seat.color} joined with ${d.deckName}.`);
  }
  const seats = [...game.seats.values()];
  // the relay resets a room to 4 seats after every game: make room for everyone first (controller only)
  if (!game.maxSet && typeof room.max_players === "number" && room.max_players < game.total) {
    game.maxSet = true;
    controllerOf(room, seats).send({ type: "SetMaxPlayers", max_players: game.total });
  }
  if (!game.botsRequested && game.bots > 0 && seats.every((s) => s.joined)) {
    game.botsRequested = true;
    const used = new Set(seats.map((s) => s.deckId));
    // (a deck chosen with "mtg aideck" comes first: before, a deck lying in an empty seat beat it, and a test against
    // a harmless AI got the player's other Commander deck instead)
    const botDecks = [...aiDeckChoice.map(loadPreset), ...game.aiTableDecks, ...DEFAULT_DECKS.filter((d) => !used.has(d)).map(loadPreset)].slice(0, game.bots);
    for (const b of botDecks) for (const c of [...b.deck.cards, ...(b.deck.commanders || [])]) {
      cachedImage(c.identity.name);
      (game.deckNames ??= new Set()).add(c.identity.name);
    }
    controllerOf(room, seats).send({ type: "BroadcastState", state: {
      kind: "roomRelay", protocol: "self-hosted-node", version: 1, messageId: `tts-${Date.now()}`, roomId: seat.roomId,
      payload: { type: "spawnBot", deck: botDecks[0], decks: botDecks, forgeAi: true },
    } });
  }
  const ready = room.players.filter((p) => p.ready && p.connected).length;
  if (!game.startSent && room.status === "Lobby" && ready >= game.total) {
    game.startSent = true;
    controllerOf(room, seats).send({ type: "StartGame", format: "Commander", seat_order: clockwiseOrder(room) });
  }
}

// Turns go clockwise round the table, as the seats sit (TABLE_COLORS order: White, Red, Yellow, Blue): the AI players
// take the empty colours, then the relay is asked to seat everyone in that order. Before, the order was who joined
// first with the AI players last, so with White and Yellow seated the turn went White -> Yellow -> Red (playtest
// 2026-10-25: "whoever goes first, the next player is always the one clockwise of them"). onGameStarted gives each AI
// the next free colour in turn order, which is the colour it was seated at here.
function clockwiseOrder(room) {
  const byColor = {};
  for (const st of game.seats.values()) byColor[st.color] = st.username;
  const humans = new Set(Object.values(byColor));
  const free = TABLE_COLORS.filter((c) => !byColor[c]);
  for (const p of room.players) if (!humans.has(p.username) && free.length) byColor[free.shift()] = p.username;
  return TABLE_COLORS.filter((c) => byColor[c]).map((c) => byColor[c]);
}

function onGameStarted(msg) {
  if (!game || game.closing || game.started) return;
  game.started = true;
  game.playerOrder = msg.player_order;
  let ai = 0;
  // AI players sit at the table colours nobody is using, so their cards have a playmat to land on.
  const freeColors = TABLE_COLORS.filter((c) => !game.seats.has(c));
  msg.player_order.forEach((username, i) => {
    const seat = [...game.seats.values()].find((s) => s.username === username);
    game.slotNames[`player-${i}`] = seat ? seat.color : `AI ${++ai}`;
    game.slotColor[`player-${i}`] = seat ? seat.color : freeColors.shift() || null;
  });
  toTTS({ t: "gamelog", reset: true, lines: [] }); // (a new game: the last game's log lines go, playtest 2026-10-26)
  toTTS({ t: "started", colors: game.slotColor, names: game.slotNames,
    ai: Object.keys(game.slotColor).filter((k) => !TABLE_COLORS.includes(game.slotNames[k])).map((k) => game.slotColor[k]) });
  // Ask Scryfall now for every deck card whose picture isn\'t cached yet (the links arrive with the board). TTS itself
  // doesn\'t preload them (2026-10-19, PresentMon: each destroyed preload card cost a ~370 ms asset clean-up).
  for (const n of game.deckNames || []) pictureOf(n);
  chat(`[MTG] Game started! Seats in turn order: ${msg.player_order.map((_, i) => game.slotNames[`player-${i}`]).join(" → ")}. Life ${msg.starting_life}. A dice roll decides who goes first.`);
  log(`game started ${msg.game_id}: ${Object.values(game.slotNames).join(", ")}`);
  saveResume();
}

// ───────────────────────── Whole-table model for the group's table (SPEC §5, PLAN M4 step 3) ─────────────────────────
// One message describing every player's zones, life, commander damage and tax. Public zones come from any seat's
// view; each hand only from its own player's view, so hidden cards never reach other players.
const TABLE_COLORS = ["White", "Red", "Yellow", "Blue"];
const DEFAULT_BACK = "https://steamusercontent-a.akamaihd.net/ugc/1647720103762682461/35EF6E87970E2A5D6581E7D96A99F8A575B7A15F/";
// Pictures for cards that didn't come from the table (AI decks, tokens): TTS can't load Scryfall's redirecting
// "named?format=image" links, so ask Scryfall's card API for the direct .jpg once and remember it on disk.
const IMAGE_CACHE_FILE = path.join(__dirname, "image-cache-klrmngr.json");
let imageCache = {};
try {
  imageCache = JSON.parse(fs.readFileSync(IMAGE_CACHE_FILE, "utf8"));
  // a token search that found no picture is tried again once per bridge start: one that failed in passing was kept as
  // "no picture" for good (the Food token stayed a card back, playtest 2026-10-26)
  for (const k of Object.keys(imageCache)) if (k.startsWith("token:") && !imageCache[k]?.face) delete imageCache[k];
}
catch (e) { if (e.code !== "ENOENT") log(`image cache unreadable, starting empty: ${e.message}`); }
// One writer for the cache file, at most every 2 s, written to a temp file and renamed into place: two writers at
// once corrupted the 4 MB file (then silently replaced by {} on the next start), and each write costs ~100 ms.
let cacheSaveTimer = null, cacheSaving = false, cacheDirty = false;
function saveImageCache() {
  cacheDirty = true;
  if (cacheSaveTimer || cacheSaving) return;
  cacheSaveTimer = setTimeout(() => {
    cacheSaveTimer = null;
    cacheSaving = true;
    cacheDirty = false;
    const tmp = `${IMAGE_CACHE_FILE}.tmp`;
    fs.writeFile(tmp, JSON.stringify(imageCache), (err) => {
      const done = () => { cacheSaving = false; if (cacheDirty) saveImageCache(); };
      if (err) { log(`image cache not saved: ${err.message}`); return done(); }
      fs.rename(tmp, IMAGE_CACHE_FILE, (e) => { if (e) log(`image cache not saved: ${e.message}`); done(); });
    });
  }, 2000);
}
const imageWanted = new Set();
// (venture's three and the initiative's Undercity: see tableCard)
const DUNGEON_NAMES = ["Lost Mine of Phandelver", "Dungeon of the Mad Mage", "Tomb of Annihilation", "Undercity"];
let imageFetching = false;
const stripQuery = (u) => (u ? u.split("?")[0] : null);

function cachedImage(name) {
  const hit = imageCache[normName(name)];
  if (hit) return hit;
  if (name) { imageWanted.add(name); setImmediate(fetchImages); }
  return null;
}

// When Scryfall says "too many requests" (429), fails, or can't be reached, wait before asking again (5 s, doubling
// up to 2 min); retrying at once hammered it many times a second. Only a definite "not found" is remembered as
// "no picture"; a failed request is asked again later.
let imageBackoff = 0, imageRetryAt = 0;
function imageFailure(what) {
  imageBackoff = Math.min(120000, imageBackoff ? imageBackoff * 2 : 5000);
  imageRetryAt = Date.now() + imageBackoff;
  log(`Scryfall images: ${what}, retrying in ${imageBackoff / 1000} s`);
  setTimeout(fetchImages, imageBackoff + 50);
}
// { card } when found, "notfound" when Scryfall says so, "error" when it couldn't be asked
async function fetchNamed(name) {
  await new Promise((r) => setTimeout(r, 120));
  const res = await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`,
    { headers: { Accept: "application/json", "User-Agent": "mtg-tts-bridge/0.1" } }).catch(() => null);
  if (res && res.ok) return { card: await res.json() };
  return res && res.status === 404 ? "notfound" : "error";
}

async function fetchImages() {
  if (imageFetching || !imageWanted.size) return;
  if (Date.now() < imageRetryAt) return;
  imageFetching = true;
  let failed = false;
  try {
    while (imageWanted.size) {
      const batch = [...imageWanted].slice(0, 75);
      batch.forEach((n) => imageWanted.delete(n));
      const res = await fetch("https://api.scryfall.com/cards/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "mtg-tts-bridge/0.1" },
        body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
      }).catch((e) => ({ ok: false, status: `unreachable (${e.message})` }));
      if (!res.ok) {
        batch.forEach((n) => imageWanted.add(n));
        imageFailure(typeof res.status === "number" ? `HTTP ${res.status}` : res.status);
        failed = true;
        break;
      }
      imageBackoff = 0;
      const body = await res.json();
      for (const card of body.data || []) {
        const faces = card.card_faces || [];
        // Same image server the table's Card Importer uses (TTS-friendly); Scryfall's own CDN fails to load in
        // TTS when many pictures are requested at once.
        const hasBack = faces.length > 1 && faces[1]?.image_uris;
        const id = card.id;
        const face = id ? `https://img.klrmngr.com/display/front/${id[0]}/${id[1]}/${id}.webp` : null;
        const back = id && hasBack ? `https://img.klrmngr.com/display/back/${id[0]}/${id[1]}/${id}.webp` : null;
        if (!face) continue;
        const entry = { face, back };
        imageCache[normName(card.name)] = entry;
        if (faces[0]?.name) imageCache[normName(faces[0].name)] = entry;
        // the back face under its own name, showing the back: a transformed card is named after its back face
        // (before this, that name was never found and was asked for again and again)
        if (faces[1]?.name && back) imageCache[normName(faces[1].name)] = { face: back, back: face };
      }
      // Scryfall's batch lookup misses split and Room cards ("Alive // Well"); its exact-name lookup finds them
      for (const miss of body.not_found || []) {
        const r = miss.name && miss.name.includes(" // ") ? await fetchNamed(miss.name) : "notfound";
        if (r === "error") { imageWanted.add(miss.name); continue; } // asked again on the next round
        const card = r.card;
        imageCache[normName(miss.name)] = card?.id
          ? { face: `https://img.klrmngr.com/display/front/${card.id[0]}/${card.id[1]}/${card.id}.webp`, back: null }
          : { face: null, back: null };
      }
      saveImageCache();
      await new Promise((r) => setTimeout(r, 120)); // Scryfall asks for ~10 requests/second at most
    }
  } catch (e) { log(`Scryfall images: ${e.message}`); }
  imageFetching = false;
  if (!failed) scheduleTable(); // redraw cards that were waiting for a picture
}
let tableQueued = false;

function scheduleTable() {
  if (tableQueued) return;
  tableQueued = true;
  setTimeout(() => { tableQueued = false; guarded("sendTable", sendTable); }, 40); // coalesce bursts of patches into one update
}

// TTS can no longer load Scryfall's own CDN ("unsupported format"); the same picture is on the importer's server.
const SCRYFALL_CDN = /^https?:\/\/cards\.scryfall\.io\/[a-z_]+\/(front|back)\/([0-9a-f])\/([0-9a-f])\/([0-9a-f-]+)\.[a-z]+(\?.*)?$/i;
const ttsImage = (u) => (u && SCRYFALL_CDN.test(u) ? u.replace(SCRYFALL_CDN, "https://img.klrmngr.com/display/$1/$2/$3/$4.webp") : u);

function imagesFor(name) {
  for (const r of Object.values(readyDecks)) {
    const img = r.images[name];
    // (a deck card without its own picture, or with the card back as its face, uses the lookup by name: Fire // Ice
    // showed a card back, 2026-10-26)
    if (img && img.face && img.face !== DEFAULT_BACK && !deadImages.has(img.face)) return { ...img, face: ttsImage(img.face), back: ttsImage(img.back) };
  }
  return null;
}
// A deck's own picture links can be dead (the image host no longer has that printing: Evolving Wilds showed blank, and
// every panel that wanted its picture kept the previous card's, playtest 2026-10-26). They are checked once when the
// deck is readied; a link that answers 404 is passed over for the bridge's own lookup by name.
const deadImages = new Set();
const checkedImages = new Set();
async function checkDeckImages(images) {
  const urls = [...new Set(Object.values(images).map((i) => i.face).filter((u) => u && /^https:\/\/img\.klrmngr\.com\//.test(u) && !checkedImages.has(u)))];
  for (const u of urls) checkedImages.add(u);
  for (let i = 0; i < urls.length; i += 8) {
    await Promise.all(urls.slice(i, i + 8).map(async (u) => {
      const res = await fetch(u, { method: "HEAD" }).catch(() => null);
      if (res && res.status === 404) { deadImages.add(u); log(`dead deck picture: ${u}`); }
    }));
  }
}

// Tokens aren't found by name ("Insect Token"), so search Scryfall's token cards by name, P/T and colours, then by
// name alone. Remembered in the same image cache under a "token:" key.
const tokenWanted = new Map(); // cache key -> [queries to try]
let tokenFetching = false;
function tokenKey(c) {
  const base = String(c.identity.name || "").replace(/\s+Token$/i, "").trim();
  const p = c.basePower ?? c.power, t = c.baseToughness ?? c.toughness;
  const colors = String(c.color || "").replace(/[^WUBRG]/gi, "").toLowerCase();
  return { base, key: `token:${base}|${p ?? ""}/${t ?? ""}|${colors}`, p, t, colors };
}
function tokenImage(c) {
  const { base, key, p, t, colors } = tokenKey(c);
  if (!base) return null;
  if (imageCache[key]) return imageCache[key];
  if (!tokenWanted.has(key)) {
    const exact = [`t:token`, `!"${base}"`, p != null ? `pow=${p}` : "", t != null ? `tou=${t}` : "", `c=${colors || "c"}`].filter(Boolean).join(" ");
    tokenWanted.set(key, [exact, `t:token !"${base}"`, `t:token name:"${base}"`]);
    setImmediate(fetchTokens);
  }
  return null;
}
// Searches for the wanted tokens' pictures. A search with no result tries the next query, and "no picture" is
// remembered only when every query answered; a failed request (429, 5xx, no network) keeps the token wanted and
// waits (5 s doubling to 2 min) instead of remembering a miss forever.
let tokenBackoff = 0, tokenRetryAt = 0;
async function fetchTokens() {
  if (tokenFetching || !tokenWanted.size || Date.now() < tokenRetryAt) return;
  tokenFetching = true;
  let failed = false;
  try {
    for (const [key, queries] of [...tokenWanted]) {
      let entry = { face: null, back: null }, transient = false;
      for (const q of queries) {
        const res = await fetch(`https://api.scryfall.com/cards/search?unique=art&order=released&dir=desc&q=${encodeURIComponent(q)}`,
          { headers: { Accept: "application/json", "User-Agent": "mtg-tts-bridge/0.1" } }).catch(() => null);
        await new Promise((r) => setTimeout(r, 120));
        if (!res || res.status === 429 || res.status >= 500) { transient = true; break; }
        if (!res.ok) continue; // 404: nothing for this query; try the next
        const card = (await res.json()).data?.[0];
        if (card?.id) { entry = { face: `https://img.klrmngr.com/display/front/${card.id[0]}/${card.id[1]}/${card.id}.webp`, back: null }; break; }
      }
      if (transient) { failed = true; break; }
      tokenWanted.delete(key);
      imageCache[key] = entry;
      saveImageCache();
    }
  } catch (e) { log(`Scryfall tokens: ${e.message}`); failed = true; }
  tokenFetching = false;
  if (failed) {
    tokenBackoff = Math.min(120000, tokenBackoff ? tokenBackoff * 2 : 5000);
    tokenRetryAt = Date.now() + tokenBackoff;
    log(`Scryfall tokens: failed, retrying in ${tokenBackoff / 1000} s`);
    setTimeout(fetchTokens, tokenBackoff + 50);
    return;
  }
  tokenBackoff = 0;
  scheduleTable();
}

// blockers: ids of creatures blocking on the board being drawn (sendTable); other callers have none
// active: whose turn it is, for a card on the battlefield (a creature that can't attack yet is news on its controller's
// turn only; Forge calls every creature card sick until it has been in play, in hand as well)
function tableCard(c, blockers = null, active = null) {
  if (!c || c.visibility === "hidden" || !c.identity) return { id: c?.id, fd: true };
  // A face-down card (morph, manifest, foretold or "exiled face down") travels without name, picture or text: the
  // board goes to every player's table from one seat's view, and that seat may be allowed to see what it is.
  if (c.isFaceDown) {
    return { id: c.id, fd: true, tap: !!c.tapped, p: c.power ?? null, t: c.toughness ?? null, dmg: c.damage || 0,
      ctr: Object.fromEntries(Object.entries(c.counters || {}).filter(([, k]) => k)), att: c.attachedTo || null,
      ctl: game.slotColor[c.controllerId] || null, atk: !!c.isAttacking, blk: !!(blockers && blockers.has(c.id)),
      atkT: c.isAttacking ? (game.slotColor[c.attackTargetId] || c.attackTargetId || null) : null,
      blkOf: blockers?.get?.(c.id) || null,
      // (public: that it is foretold, or hidden away under a permanent; not what it is. A face-down permanent is a 2/2
      // creature, and the table lays it out with the creatures, hp-07 2026-10-27; never its real types, which the
      // owner's view carries: a foretold Instant, a manifested land, stage 3 review 2026-10-27)
      ty: c.power != null ? ["Creature"] : [],
      ...(c.phasedOut ? { po: true } : {}),
      ...(c.isForetold ? { fo: true } : {}), ...(c.exiledWith ? { ew: c.exiledWith } : {}) };
  }
  const name = c.identity.name;
  const img = c.identity.isToken ? tokenImage(c) : imagesFor(name);
  // (a dungeon is in no deck: its picture was first asked for as it entered, and its first look was a card back,
  // hp-08 #2 2026-10-28. A card that ventures or takes the initiative asks for them all ahead.)
  if (/\bventure into\b|\binitiative\b/i.test(c.text || "")) for (const d of DUNGEON_NAMES) cachedImage(d);
  const typeLine = [...(c.supertypes || []), ...(c.types || [])].join(" ") + ((c.subtypes || []).length ? ` — ${c.subtypes.join(" ")}` : "");
  return {
    // a double-faced card's back is its other face (the imported deck's back is the plain card back): flipping it
    // on the table shows the other side, as the table's own state button did
    id: c.id, n: name, f: img?.face || cachedImage(name)?.face || null, b: imageCache[normName(name)]?.back || img?.back || DEFAULT_BACK,
    tl: typeLine, cmc: c.cmc || 0, tx: c.text || "", ty: c.types || [],
    tap: !!c.tapped, fd: !!c.isFaceDown, p: c.power ?? null, t: c.toughness ?? null,
    // (the table's badge shows when the numbers differ from bp/bt, so these are what the card's picture says: Saw in Half's
    // 1/1 tokens of a 2/2 have a base of 1/1, and looked 2/2 with no badge, playtest 2026-10-31)
    bp: c.printedPower ?? c.basePower ?? null, bt: c.printedToughness ?? c.baseToughness ?? null,
    ctr: Object.fromEntries(Object.entries(c.counters || {}).filter(([, k]) => k)), dmg: c.damage || 0,
    att: c.attachedTo || null, tok: !!c.identity.isToken, sick: !!c.summoningSick, ctl: game.slotColor[c.controllerId] || null,
    // in combat: attacking (and at whom), blocking (from the game's blocker list)
    atk: !!c.isAttacking, atkT: c.isAttacking ? (game.slotColor[c.attackTargetId] || c.attackTargetId || null) : null,
    blk: !!(blockers && blockers.has(c.id)), blkOf: blockers?.get?.(c.id) || null, // (the attackers it blocks: lines)
    // exile links (our Forge build, 2026-10-23): the card that exiled it, whether it comes back when that card leaves,
    // and foretold; absent with the stock server
    ...(c.exiledWith ? { ew: c.exiledWith, rl: !!c.returnsWhenHostLeaves } : {}),
    // a cipher card encoded on a creature: shown with it, as a linked exile (hp-25 T10)
    ...(c.encodedOn && !c.exiledWith ? { ew: c.encodedOn, enc: true } : {}),
    // its text as changed (Mind Bend, Exchange of Words, Deadpool, Volrath's Shapeshifter: Forge's current text, sent
    // only when changed) and its printed name when a text effect renamed it (hp-25 T0 T13)
    // (each line once: Forge's text repeats a replacement's line, "As Deadpool enters, ..." twice on the Shapeshifter)
    ...(c.currentText ? { ct: [...new Set(displayText(c.currentText).replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean))].join("\n") } : {}),
    ...(c.printedName ? { pn: c.printedName } : {}),
    ...(c.isForetold ? { fo: true } : {}),
    ...(c.isCopy ? { cp: true } : {}), // (a copy of another card: marked COPY on the table)
    ...(c.phasedOut ? { po: true } : {}), // (phased out: stays where it was, marked on the table; our Forge build sends it)
    // (goaded, which Forge doesn't show: with the keywords another card gave it, "Goaded by White", hp-05 gap)
    // (and exerted, which nothing showed: Arena of Glory stays tapped through its controller's next untap step, hp-09 gap)
    ...statusLists(c, [...(game.goaded?.has(c.id) ? [`Goaded by ${nameOf(game.goaded.get(c.id).by)}`] : []),
      ...(c.exerted ? ["Exerted: doesn't untap next turn"] : []), ...(game.renowned?.has(c.id) ? ["Renowned"] : []),
      ...(game.suspected?.has(c.id) ? ["Suspected: can't block"] : []), ...(game.solved?.has(c.id) ? ["Solved"] : []),
      ...hauntedBy(c.id).map((n) => `Haunted by ${n}`),
      ...(c.summoningSick && active === c.controllerId && c.types?.includes("Creature") ? ["Summoning sick"] : []),
      ...(c.isCrewed ? ["Crewed"] : []), ...(c.isBestowed ? ["Bestowed"] : []), ...(c.isRingBearer ? ["Ring-bearer"] : []),
      ...(c.finalChapter ? [`Chapter ${loreOf(c)} of ${c.finalChapter}`] : []), ...(c.classLevel ? [`Level ${c.classLevel}`] : [])]),
  };
}

// What the card's status box lists: kw, what changed about it (granted keywords and the table's marks), and ow, the
// always-on keywords of its own. A card nothing changed has no box, so ow goes only with a box (kw, or phased out).
function statusLists(c, marks) {
  const { granted, own } = cardKeywords(c);
  const kw = [...granted, ...marks];
  return { ...(kw.length ? { kw } : {}), ...((kw.length || c.phasedOut) && own.length ? { ow: own } : {}) };
}

// The lore counters on a Saga (the counter's name comes from Forge: compared without its case)
const loreOf = (c) => Object.entries(c.counters || {}).find(([k]) => k.toUpperCase() === "LORE")?.[1] || 0;

// The cards haunting a creature (game.haunting: haunting card id -> its creature's id), by name (hp-20 gap)
function hauntedBy(id) {
  return [...(game?.haunting || [])].filter(([, t]) => t === id).map(([h]) => game.namesSeen?.get(h) || "a haunting card");
}

// Keywords a card has now that its own text doesn't give it: granted by another card (Skrelv's toxic 1 and hexproof
// from a colour on Kenrith showed nowhere, hp-07 #31). Forge's keyword strings read as words (as it sent them live):
// "Toxic:1" -> "Toxic 1", "Hexproof:Red" -> "Hexproof from red", "Landwalk:Swamp" -> "Swampwalk",
// "Protection:Card.Black:black" -> "Protection from black". Its internal ones are left out: "ETBReplacement:...", and
// the run-together names ("MayFlashSac", "AlternateAdditionalCost") and the few plain words that aren't keywords
// ("Chapter:3:DBSacrifice,..." read "Chapter from DBSacrifice,..." on a Saga, Ur-Dragon game 2026-11-01).
// Its own keywords are returned too, those that are always on: Equip or Cycling on a permanent is no status.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NOT_KEYWORD = /Replacement|^ETB|^Hidden|^Static|^Trigger|^[A-Z][a-z]+[A-Z]|^(Chapter|Class|Visit|Prize|Piracy)$/;
const ALWAYS_ON = /^(Flying|First Strike|Double Strike|Deathtouch|Lifelink|Trample|Vigilance|Haste|Reach|Menace|Hexproof|Indestructible|Defender|Shroud|Ward|Protection|Fear|Intimidate|Skulk|Shadow|Horsemanship|Flanking|Banding|Infect|Wither|Toxic|Afflict|Annihilator|Exalted|Prowess|Bushido|Rampage|Battle Cry|Dethrone|Undying|Persist|Absorb|Melee|Mentor|Training|Riot|Backup|Changeling|\w+walk)\b/i;
function cardKeywords(c) {
  const granted = [], own = [];
  // (its text as changed when it was: Mind Bend's islandwalk is its own text, not a grant, hp-25)
  const text = String(c.currentText ? withoutForgeNotes(c.currentText).replace(/\r\n/g, "\n") : c.text || "");
  for (const k of c.keywords || []) {
    const [base, ...rest] = String(k).split(":");
    if (!/^[A-Z][A-Za-z ]*$/.test(base) || NOT_KEYWORD.test(base)) continue;
    const arg = rest.length ? String(rest[rest.length - 1]).trim() : "";
    const word = !arg ? base : /^\d+$/.test(arg) ? `${base} ${arg}` : base === "Landwalk" ? `${arg}walk`
      : /^(Hexproof|Protection)$/.test(base) ? `${base} from ${arg.toLowerCase()}` : rest.length >= 2 ? `${base} from ${arg}` : `${base} ${arg}`;
    // (its own when its keyword lines name it: at a line's start or after ", " - "Swampwalk", "Protection from white
    // and from black"; not "flying" inside "block only creatures with flying", suite review 2026-10-27)
    const list = new RegExp(`(^|\\n|, )${escapeRe(word.split(" ")[0])}\\b`, "i").test(text) ? own : granted;
    if (list === own && !ALWAYS_ON.test(word)) continue;
    if (!list.includes(word)) list.push(word);
  }
  return { granted, own };
}

// The cards a seat may play from outside its hand right now (exile, graveyard; not the command zone, where the
// commander already has its spot), from that seat's own view: a face-down card it may look at comes with its face.
// Forge's own list (Player.getCardsActivatableInExternalZones), sent by our Forge build as mayPlay.
function playableOf(own, toCard) {
  const out = [];
  for (const z of own?.zones || []) {
    // (and the library's top card when its owner may play it: The Reality Chip offered "Cast Enlightened Tutor" from
    // the top of the library with nothing shown, hp-13 gap; the row is the owner's own second hand zone)
    if (z.zone !== "exile" && z.zone !== "graveyard" && z.zone !== "library") continue;
    for (const c of z.cards || []) if (c.mayPlay && c.visibility !== "hidden") out.push(toCard(c));
  }
  return out;
}

// Forge numbers turns across all players (turn 10 = your 5th in a 2-player game); count each player's own turns.
function trackTurns(pub, seats) {
  // whose turn each engine turn number was; a rewind forgets the turns after it, so "your turn N" goes back too
  game.turnOwners ??= {};
  // (turn 0 is the mulligans before the first turn, with a player marked active: it counted as their turn, so White's
  // 4th turn read "White's turn 5", hp-22 re-test 2026-10-28)
  if (pub.activePlayerId && pub.turn != null && pub.turn >= 1) {
    for (const t of Object.keys(game.turnOwners)) if (Number(t) > pub.turn) delete game.turnOwners[t];
    game.turnOwners[pub.turn] = pub.activePlayerId;
  }
  game.turnsTaken = {};
  for (const p of Object.values(game.turnOwners)) game.turnsTaken[p] = (game.turnsTaken[p] || 0) + 1;
  for (const st of seats) {
    const hand = zoneOf(st.board.state.gameView, "hand", st.slot).cards;
    const ids = new Set(hand.map((c) => c.id));
    if (st.prevHand && st.prevHand.size) {
      const drawn = hand.filter((c) => !st.prevHand.has(c.id)).map((c) => c.identity?.name).filter(Boolean);
      if (drawn.length && drawn.length <= 3) chat(`[MTG] Into your hand: ${drawn.join(", ")}`, st.color);
    }
    st.prevHand = ids;
  }
}

// ───────────────────────── Game log (phase 3) ─────────────────────────
// What each player did, worked out by comparing public board states: battlefield, graveyards, exile, command
// zone, stack, life and the hand/library counts. Hidden cards are never named.
const PUBLIC_ZONES = ["battlefield", "graveyard", "exile", "command"];
function logSnapshot(pub) {
  const cards = {}, counts = {};
  for (const z of pub.zones || []) {
    if (PUBLIC_ZONES.includes(z.zone)) for (const c of z.cards || []) {
      // (a face-down card is named in nobody's log: the board comes from one seat's view, which may know what it is)
      if (c.identity) cards[c.id] = { zone: z.zone, name: c.isFaceDown ? "a face-down card" : c.identity.name, fd: !!c.isFaceDown,
        owner: z.ownerId, ctl: c.controllerId || z.ownerId,
        land: (c.types || []).includes("Land"), creature: (c.types || []).includes("Creature"), token: !!c.identity.isToken, attacking: !!c.isAttacking, tapped: !!c.tapped,
        ...(c.isPlotted ? { plotted: true } : {}), ...(c.attachedTo ? { att: c.attachedTo } : {}),
        spell: (c.types || []).some((t) => t === "Instant" || t === "Sorcery"), p1: c.counters?.P1P1 || 0, m1: c.counters?.M1M1 || 0,
        // (its other counters but loyalty, for its arrival line: Tangle Wire's 4 fade counters read nothing, hp-14 gap)
        ...((o) => (o.length ? { ctrs: o } : {}))(Object.entries(c.counters || {}).filter(([k, n]) => n > 0 && !/^(?:P1P1|M1M1|LOYALTY)$/i.test(k))),
        ...(c.mergedCardIds?.length ? { merged: [...c.mergedCardIds] } : {}),
        ...((c.keywords || []).some((k) => /^Rebound\b/i.test(k)) ? { rebound: true } : {}),
        ...((c.keywords || []).some((k) => /^Suspend\b/i.test(k)) ? { suspend: true } : {}),
        // (phasing is no zone change, so it stays "battlefield" here: Forge says which, the log no longer guesses)
        ...(c.phasedOut ? { po: true } : {}) };
    }
    if (z.zone === "hand" || z.zone === "library") counts[`${z.zone}:${z.ownerId}`] = z.count ?? (z.cards || []).length;
  }
  const life = Object.fromEntries((pub.players || []).map((p) => [p.id, p.life]));
  // keyed by what it is, not its id: a spell keeps changing ids while it is being cast
  const stack = {};
  for (const s of pub.stack || []) {
    // (a spell by its card alone: its text grows as it is cast, Tooth and Nail entwined read "casts Tooth and Nail" twice, hp-09)
    const ability = isAbilityOnStack(s, pub);
    const key = ability ? `${s.sourceId}|${s.sourceAbilityText || ""}` : `${s.sourceId}|spell`;
    // (Forge's paradigm effect is "<card>' Paradigm": said by its card, hp-23 gap)
    // (and an effect, "Eternal Dominion (5)'s Effect": read "... (5)'s Effect's ability triggers", hp-23 gap)
    const effect = /(?:'s Effect|' Paradigm)$/.test(s.identity?.name || "");
    const name = s.identity?.name && s.identity.name !== "?" ? s.identity.name.replace(/' Paradigm$/, "").replace(/(?: \(\d+\))?'s Effect$/, "") : ability ? "a face-down permanent" : "a face-down spell"; // (a face-down creature's ward read "a face-down spell's", hp-20 gap)
    // (an upkeep cost's trigger by its keyword: Karmic Guide's echo read "White uses Karmic Guide's ability", then "dies", hp-06)
    // (and cumulative upkeep's, by its cost: Mystic Remora's read "uses Mystic Remora's ability", hp-05)
    // (a cost that isn't mana is said as itself: Glacial Chasm's "Cumulative upkeep—Pay 2 life.", "pay 2 life for each ...")
    const cumulative = (s.sourceAbilityText || "").match(/^Cumulative upkeep[—\s-]+(.+?)\.?\s*(?:\(|$)/i)?.[1];
    const upkeepCost = /\bunless you pay its echo cost\b/i.test(s.sourceAbilityText || "") ? "echo: pay its echo cost"
      : cumulative ? `cumulative upkeep: ${/^\{/.test(cumulative) ? `pay ${cumulative}` : cumulative[0].toLowerCase() + cumulative.slice(1)} for each age counter on it` : null;
    // (its own stack ids and the spells it targets: "is countered" goes by a spell another one targeted, suite review)
    // (a trigger by its words: Dark Confidant's and Mirri's Guile's upkeep triggers read "White uses ...'s ability", hp-26)
    // (an ability word's trigger, "Battalion — Whenever ...", by its word: Frontline Medic's, hp-13 gap)
    // (a flavor word's too, hyphen, apostrophe and "!" and all: the Tenth Doctor's "Allons-y! — Whenever you attack" read
    // "White uses The Tenth Doctor's ability", hp-21 gap)
    const abilityWord = (s.sourceAbilityText || "").match(/^([A-Z][a-z'-]+(?: [A-Za-z'-]+){0,3})!? — (?:When|Whenever|At)\b/)?.[1]?.toLowerCase() || null;
    const trigger = ability && /^(?:When|Whenever|At)\b/.test(s.sourceAbilityText || "");
    // (and a keyword's trigger by its keyword, its reminder saying when: Ward's read "AI 1 uses Hexing Squelcher's
    // ability", gap-04)
    // (a keyword of two words whole: Hero of Bladehold's "Battle cry (Whenever ...)" read "battle triggers", hp-16 gap;
    // not an article: "Champion a Merfolk (When ...)" read "champion a triggers", hp-19 gap)
    // (and Forge's "<Keyword> N - <card>" form, no reminder: Surging Dementia's "Ripple 4 - Surging Dementia" read "White
    // uses Surging Dementia's ability", hp-23 gap)
    const kwTrigger = ability && !trigger ? abilityWord || (s.sourceAbilityText || "").match(/^([A-Z][a-z]+(?: (?!an?\b|the\b)[a-z]+)?)\b[^(]*\((?:When|Whenever|At)\b/)?.[1]?.toLowerCase()
      || (s.sourceAbilityText || "").match(/^([A-Z][a-z]+)(?: \d+)? - [A-Z]/)?.[1]?.toLowerCase()
      || (/^Paradigm \(/.test(s.sourceAbilityText || "") ? "paradigm" : null) : null;
    // (a regeneration shield's creature: the ability's target, or its own source, see logEvents)
    const cardTargets = (s.targets || []).filter((t) => t.kind === "card").map((t) => t.id);
    const regen = ability && /\bRegenerate\b/.test(s.sourceAbilityText || "") ? (cardTargets.length ? cardTargets : [s.sourceId]) : null;
    stack[key] ??= { id: s.sourceId, name, ctl: s.controllerId, ability, trigger, kwTrigger, upkeepCost, n: 0, sids: [], tg: [], ...(regen ? { regen } : {}), ...(effect ? { effect } : {}),
      // (its words and the cards it targets: a goad's creatures, see logEvents)
      text: s.sourceAbilityText || "", cardTg: cardTargets, plTg: (s.targets || []).filter((t) => t.kind === "player").map((t) => t.id) };
    stack[key].n++;
    stack[key].sids.push(s.id);
    for (const t of s.targets || []) if (t.kind === "spell") stack[key].tg.push(t.id);
    // (and those a counterspell targets: an instant or sorcery under one is countered too, see logEvents)
    if (isCounterspell(s.sourceAbilityText || s.text || "")) for (const t of s.targets || []) if (t.kind === "spell") (stack[key].ctg ??= []).push(t.id);
  }
  // (who blocks whom: blocker id -> the attackers it blocks)
  const blocks = {};
  for (const a of pub.combatAssignments || []) if (a.blockerId && a.attackerId) (blocks[a.blockerId] ||= []).push(a.attackerId);
  // (each player's land plays this turn: an AI's land play is told from a land an effect put there by it)
  const lands = Object.fromEntries((pub.players || []).map((p) => [p.id, p.landsPlayedThisTurn ?? null]));
  // (who has the city's blessing: Ascend's, which nothing showed, hp-11 gap)
  const blessed = Object.fromEntries((pub.players || []).map((p) => [p.id, !!p.hasCityBlessing]));
  const story = Object.fromEntries((pub.players || []).map((p) => [p.id, !!p.hasEnduringStory]));
  // (poison counters: Vraska's Fall and Prologue to Phyresis gave the AI three and the log said nothing, hp-11 gap)
  const poison = Object.fromEntries((pub.players || []).map((p) => [p.id, playerCounter(p, "poison")]));
  const energy = Object.fromEntries((pub.players || []).map((p) => [p.id, playerCounter(p, "energy")]));
  return { cards, counts, life, lands, stack, blocks, blessed, story, poison, energy, monarch: pub.monarchId || null, initiative: pub.initiativeHolderId || null, turn: pub.turn, step: pub.step, active: pub.activePlayerId, day: pub.dayTime };
}

// A stack item is an ability (not a spell) when Forge gives it ability text and it isn't a spell: Forge also gives
// instants and sorceries their text, so "White uses Lightning Bolt's ability" was logged for a cast. A spell's card is
// in no zone while it is on the stack; an ability's source still is (battlefield, graveyard, command zone, ...), and a
// triggered ability says when it triggers.
function isAbilityOnStack(s, pub) {
  if (!s.sourceAbilityText || s.isPermanentSpell) return false;
  if (/^(When|Whenever|At|As)\b/.test(s.sourceAbilityText)) return true;
  // (Forge's "<Keyword> - <card>" trigger, its source the spell on the stack: Throes of Chaos's "Cascade - Throes of
  // Chaos" read as a second spell, "White casts Throes of Chaos" twice, hp-15)
  if (/^[A-Z][a-z]+(?: \d+)? - .+$/.test(s.sourceAbilityText)) return true;
  // (Paradigm's trigger, its source an effect in no zone: "White casts Improvisation Capstone' Paradigm", hp-23 gap)
  if (/^Paradigm \(/.test(s.sourceAbilityText)) return true;
  // (not the hand or the library: a spell with buyback was still listed in the hand, and "White uses Constant Mists's
  // ability" was logged, playtest 2026-10-27)
  return (pub.zones || []).some((z) => z.zone !== "hand" && z.zone !== "library" && (z.cards || []).some((c) => c.id === s.sourceId));
}

// What the player started (a cast, an ability) when a board with it on the stack never comes: it was paid from the pool
// and resolved before the next board, and the log said only "enters the battlefield" (playtest 2026-10-27). Recorded in
// Seat.respond; logEvents says it when the stack shows it, when the card turns up in a public zone (a cast), or once the
// payment is over (an ability). A Cancel forgets it.
function notePlay(seat, act, name, promptId) {
  if (!game || !act?.cardId || !name) return;
  game.pendingPlays = (game.pendingPlays || []).filter((e) => Date.now() - e.at < 60000); // (bounded where nothing logs)
  // (a foretell hides the card: "White uses Delayed Blast Fireball's ability" named it to the whole table, hp-06 2026-10-28)
  // (and a suspend is said as one: "White uses Profane Tutor's ability", hp-06 #14; an embalm read "White uses Vizier of Many Faces's ability", hp-16 gap)
  const way = String(act.label || act.description || "");
  const kind = act.type === "cast" ? "cast" : /^(?:[^:]*: )?Foretell\b/i.test(way) ? "foretell"
    // (and ninjutsu, fortify and aura swap: Yuriko's, C.A.M.P.'s and Arcanum Wings's read "White uses ...'s ability", hp-24 gap)
    : /^(?:[^:]*: )?(?:Commander )?(Suspend|Unearth|Crew|Saddle|Level up|Embalm|Eternalize|Renew|Scavenge|Bloodrush|Forecast|Ninjutsu|Fortify|Aura swap)\b/i.exec(way)?.[1].toLowerCase()
    // (cycling, landcycling too: Eagles of the North's plainscycling read "White uses Eagles of the North's ability", hp-18 gap)
    || (/^(?:[^:]*: )?(?:[A-Z][a-z]*)?cycling\b/i.test(way) ? "cycle" : null)
    // (turning a card face up is no ability: "is turned face up" says it; Gudul Lurker's megamorph also read "White uses
    // Gudul Lurker's ability", hp-10)
    || (/^(?:[^:]*: )?(?:Megamorph|Morph|Disguise)\b/i.test(way) ? "faceup" : "ability");
  // (a swap with the hand is seen a board or more later, its record said by then: see handRoom in logEvents)
  if (kind === "ninjutsu" || kind === "aura swap") seat.note("handSwap", act.cardId);
  // (a face-down cast is said unnamed: the log is the whole table's, and Morph's "Cast Grim Haruspex (face down)" read
  // "White casts Grim Haruspex", gap-04)
  const faceDown = kind === "cast" && / \(face down\)$/i.test(way);
  // (and a cast by another way says which: Faithless Looting's flashback read "White casts Faithless Looting" twice, gap-04;
  // Forge's mode names its cost, "flashback", "webSlinging", "more_than_meets_the_eye")
  const how = kind === "cast" && !faceDown && act.mode?.type === "alternative" && act.mode.cost
    ? String(act.mode.cost).replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() : null;
  // (and from the top of the library: Augur of Autumn's coven cast of King Macar read "White casts King Macar", hp-14 gap)
  const zoneOfCard = (zn) => kind === "cast" && (seat.board?.state?.gameView?.zones || []).some((z) => z.zone === zn && (z.cards || []).some((c) => c.id === act.cardId));
  const fromTop = zoneOfCard("library");
  // (and from exile with no way named: Avatar's Wrath's airbent Skyhunter Strike Force cast for {2} read "White casts
  // Skyhunter Strike Force", hp-18 gap)
  const fromExile = zoneOfCard("exile");
  // (the face being cast, by the action's own label: Tibalt, Valki's back, read "White casts Valki, God of Lies", re-test
  // 2026-10-31)
  const face = kind === "cast" && !how ? String(act.label || "").match(/^Cast (.+)$/)?.[1] : null;
  const doubleFaced = (seat.board?.state?.gameView?.zones || []).some((z) => (z.cards || []).some((c) => c.id === act.cardId && c.isDoubleFaced));
  if (face && doubleFaced && !name.includes("//")) name = face;
  game.pendingPlays.push({ id: act.cardId, name: faceDown ? "a face-down spell" : how ? `${name} (${how})` : fromTop ? `${name} from the top of their library` : fromExile ? `${name} from exile` : name, ctl: seat.slot, kind, text: way, at: Date.now(), promptId: promptId ?? 0 });
}

// A player's keyword activation said by its keyword, the same whether its stack item was seen or not (Joraga
// Treespeaker's level up read "White uses Joraga Treespeaker's ability"; a crew seen on the stack read the same, hp-11)
function keywordLine(kind, ctl, name) {
  const who = nameOf(ctl);
  return kind === "foretell" ? `${who} foretells a card` : kind === "level up" ? `${who} levels up ${name}`
    : kind === "fortify" ? `${who} fortifies with ${name}` : kind === "aura swap" ? `${who} swaps ${name} (aura swap)`
    : ["suspend", "unearth", "crew", "saddle", "embalm", "eternalize", "renew", "scavenge", "cycle", "bloodrush", "forecast", "ninjutsu"].includes(kind) ? `${who} ${kind}${/sh$/.test(kind) ? "es" : "s"} ${name}` : null;
}

const timeCounters = (c) => (c.ctrs || []).find(([k]) => /^time$/i.test(k))?.[1] || 0;
// What Forge says moved since the last board (GameViewDto.events, EngineEventLog on the engine side), or null when it
// says nothing: an older engine or the Rust one (an empty list, where our Forge has moved no card yet either), the first
// board a bridge sees, or falling behind its ring. The log then works it out from the boards. One move per card, from
// its first zone to its last, so a card sacrificed and then exiled in one go stays sacrificed.
// (call it on every board, a new game's or a rewind's first too: it keeps the place in the ring)
function engineFacts(events) {
  if (!Array.isArray(events)) {
    if (!game.noFeedSaid) noteGuess("no feed", "this engine sends no events");
    game.noFeedSaid = true;
    return null;
  }
  const seen = game.eventSeq;
  game.eventSeq = events.length ? events[events.length - 1].seq : seen ?? 0;
  if (seen == null || !events.length) return null;
  if (events[0].seq > seen + 1) { noteGuess("feed gap", `events ${seen + 1} to ${events[0].seq - 1} fell behind`); return null; }
  const facts = { moves: new Map(), draws: {}, tutors: {}, mills: {} };
  for (const e of events) {
    if (e.seq <= seen) continue;
    if (e.from === "Library") {
      const tally = e.to === "Hand" ? (e.how === "draw" ? facts.draws : facts.tutors)
        : e.to === "Exile" || (e.to === "Graveyard" && e.how !== "surveil") ? facts.mills : null;
      if (tally) tally[e.ownerId] = (tally[e.ownerId] || 0) + 1;
    }
    if (!e.cardId) continue;
    const was = facts.moves.get(e.cardId);
    facts.moves.set(e.cardId, { from: was ? was.from : e.from, to: e.to, how: e.how || was?.how });
  }
  return facts;
}
function logEvents(prev, cur, pub, facts = null) {
  const out = [];
  const who = (id) => nameOf(id);
  if (cur.turn !== prev.turn && cur.active) {
    out.push(`--- ${who(cur.active)}'s turn ${game.turnsTaken?.[cur.active] || 1} ---`);
    // (a look at a library last turn says nothing about this turn's draw: Top looked, then the draw step's card read
    // "puts 1 card from their library", stage 3 review 2026-10-27)
    for (const st of game.seats.values()) st.forget("search");
  }
  const pending = (game.pendingPlays ??= []);
  const castNow = new Set(); // (logged as cast just now: an instant already in the graveyard is not also a discard)
  const landPlays = new Set(); // (a player's land play, from its record: any other land arriving was put there)
  // (one record per play: two activations seen once lose no line, stage 3 review 2026-10-27)
  // (not a land play's record, which its land's own trigger on the stack took: Mosswort Bridge's hideaway logged "casts
  // Mosswort Bridge", then "puts Mosswort Bridge onto the battlefield", hp-16)
  const said = (id) => { const e = pending.find((x) => x.id === id && !x.said && !(x.kind === "cast" && cur.cards[id]?.land)); if (e) e.said = true; return e; };
  // (logged from the record before any board showed it on the stack: the stack showing it later is not a second play)
  game.saidEarly = (game.saidEarly || []).filter((x) => Date.now() - x.at < 60000);
  const stackIds = new Set(Object.values(cur.stack).map((s) => s.id));
  const prevStackNames = new Set(Object.values(prev.stack).map((s) => s.name));
  // (cards that were spells on the last stack and that another stack item targeted: those countered; by id, so a
  // same-named card milled, an evoked creature or a legend-rule loser isn't "countered", suite review 2026-10-28)
  // (with the spells the player's own counterspell targeted, noted as the target was picked; kept for the turn)
  // (the last turn's still count in the board that brings the new turn: Wash Away's cleave in the AI's main phase, the
  // turn over before the next board, read no "is countered", hp-19 gap)
  const counterKept = [...(game.counterTargets || [])];
  if (game.counterTurn !== cur.turn) { game.counterTargets = new Set(); game.counterTurn = cur.turn; }
  const prevTargeted = new Set([...Object.values(prev.stack).flatMap((s) => s.tg || []), ...counterKept]);
  const prevCounterTargeted = new Set([...Object.values(prev.stack).flatMap((s) => s.ctg || []), ...counterKept]);
  const prevSpellOf = new Map(Object.values(prev.stack).filter((s) => !s.ability).map((s) => [s.id, s]));
  // (came off the stack, or was just logged as a cast: not a discard, not "put into a graveyard")
  // (or by its card: a split card resolves under its half's name, "Cut // Ribbons is put into White's graveyard", hp-11)
  const fromStack = (id, c) => castNow.has(id) || prevStackNames.has(c.name) || Object.values(prev.stack).some((x) => x.id === id);
  // (a stack ability with no record of the player's (a trigger, or an AI's) seen with a permanent that just entered is
  // said after the entry, which most often caused it: Kodama of the East Tree's read before "Lizard Blades enters the battlefield", Lotus Field's before Lotus Field, hp-05)
  const entered = Object.entries(cur.cards).some(([id, c]) => c.zone === "battlefield" && prev.cards[id]?.zone !== "battlefield");
  const afterEntries = [];
  // (and a draw seen with a nonland entry, past the draw step: Asceticism's constellation draw read before "Asceticism
  // enters the battlefield", hp-09; a draw step's draw beside a land play or a cast stays first)
  const drawAfter = cur.turn === prev.turn && !/^(?:untap|upkeep|draw)/i.test(prev.step || "")
    && Object.entries(cur.cards).some(([id, c]) => c.zone === "battlefield" && !c.land && prev.cards[id]?.zone !== "battlefield");
  // (the spells already on the stack before, by player and name: a copy's line, below)
  const spellsSeen = new Set(Object.values(prev.stack).filter((s) => !s.ability).map((s) => `${s.ctl}|${s.name}`));
  const namesSeen = new Set(Object.values(prev.stack).filter((s) => !s.ability).map((s) => s.name));
  // (and how many more of each name there are, whoever controls them: a spell only changing hands is no new one; the AI's
  // demonstrate copy, made under White's control first, read "White copies" and then "AI 1 casts Incarnation Technique",
  // hp-23 gap)
  const spellsOf = (st) => Object.values(st).filter((s) => !s.ability).reduce((m, s) => m.set(s.name, (m.get(s.name) || 0) + s.n), new Map());
  const before = spellsOf(prev.stack), moreOf = spellsOf(cur.stack);
  for (const [n, k] of moreOf) moreOf.set(n, k - (before.get(n) || 0));
  for (const [key, s] of Object.entries(cur.stack)) {
    for (let k = prev.stack[key]?.n || 0; k < s.n; k++) {
      // (spell or ability by what the player started when there is a record: ninjutsu's card is in the hand, so the
      // stack alone called it a cast, stage 3 review 2026-10-27)
      const mine = said(s.id);
      if (!mine) {
        // (an early "casts" line hides only a cast: it hid the commander's own enter trigger; an early ability line hides
        // the card's next stack item, whose kind the stack only guesses - ninjutsu's card is in the hand, suite review)
        const early = game.saidEarly.findIndex((x) => x.id === s.id && (x.kind === "ability" || !s.ability));
        if (early >= 0) { game.saidEarly.splice(early, 1); continue; }
      }
      // (any record but a cast is an ability on the stack: an unearth, a crew, a face-up trigger, hp-10)
      const ability = mine ? mine.kind !== "cast" : s.ability;
      // (a second of one card's spell on the stack is a copy: Cut Your Losses's casualty copy read "casts" twice, hp-16)
      // (and one by the same player and name with a card of its own and no cast: Forge makes each storm copy its own
      // card, and Flusterstorm's three copies read "White casts Flusterstorm" three times, hp-08 gap)
      if (!ability && !s.ability && !mine && !(moreOf.get(s.name) > 0)) {
        if (!spellsSeen.has(`${s.ctl}|${s.name}`)) out.push(`${who(s.ctl)} controls that copy of ${s.name}`);
        spellsSeen.add(`${s.ctl}|${s.name}`);
        continue;
      }
      if (!ability && !s.ability) moreOf.set(s.name, (moreOf.get(s.name) || 0) - 1);
      // (or by another player with no card from their hand: the AI's demonstrate copy, hp-23 gap)
      // (or made by its own card's effect: epic's upkeep copy read "White casts Eternal Dominion", hp-23 gap)
      const copyOf = !ability && !mine && (spellsSeen.has(`${s.ctl}|${s.name}`)
        || (namesSeen.has(s.name) && !((cur.counts[`hand:${s.ctl}`] ?? 0) < (prev.counts[`hand:${s.ctl}`] ?? 0)))
        || Object.values(prev.stack).some((x) => x.effect && x.name === s.name));
      if (!ability) { spellsSeen.add(`${s.ctl}|${s.name}`); namesSeen.add(s.name); }
      (!mine && ability && entered ? afterEntries : out).push(s.upkeepCost ? `${s.name}'s ${s.upkeepCost}, or it is sacrificed`
        : ability ? keywordLine(mine?.kind, s.ctl, s.name) || (!mine && s.kwTrigger ? `${s.name}'s ${s.kwTrigger} triggers (${who(s.ctl)})` : !mine && s.trigger ? `${s.name}'s ability triggers (${who(s.ctl)})` : `${who(s.ctl)} uses ${s.name}'s ability`)
        : k >= 1 || copyOf ? `${who(s.ctl)} copies ${s.name}` : `${who(s.ctl)} casts ${mine ? mine.name : s.name}`);
    }
  }
  for (const e of pending) {
    // (said above, or on the stack now, or still; a land play stays itself while its own trigger is on the stack, hp-16)
    if (e.said || (stackIds.has(e.id) && !(e.kind === "cast" && cur.cards[e.id]?.land))) continue;
    const seat = seatOfSlot(e.ctl);
    // (an ability: once the engine asks this player's priority again after it (onPrompt), it is on the stack (seen
    // above) or done)
    const back = (seat?.priorityPromptId ?? -1) > e.promptId;
    // (a land play comes as a "cast" too: it arrives as a land and is "plays", below, stage 3 review 2026-10-27)
    if (e.kind === "cast" && cur.cards[e.id]?.land) { e.said = true; landPlays.add(e.id); }
    // (newly public, or moved from a public zone: a commander cast from the command zone was seen there already, and its
    // cast went unlogged, hp-07 #39 2026-10-27)
    else if (e.kind === "cast" && cur.cards[e.id] && (!prev.cards[e.id] || prev.cards[e.id].zone !== cur.cards[e.id].zone)) { out.push(`${who(e.ctl)} casts ${e.name}`); e.said = true; castNow.add(e.id); game.saidEarly.push({ id: e.id, kind: e.kind, at: Date.now() }); }
    else if (e.kind === "faceup" && back) e.said = true;
    else if (e.kind !== "cast" && back) { out.push(keywordLine(e.kind, e.ctl, e.name) || `${who(e.ctl)} uses ${e.name}'s ability`); e.said = true; game.saidEarly.push({ id: e.id, kind: e.kind, at: Date.now() }); }
  }
  const abilityRecords = new Set(pending.filter((e) => e.kind !== "cast").map((e) => e.id));
  game.pendingPlays = pending.filter((e) => !e.said && Date.now() - e.at < 60000);
  // (what left a library for the hand: when a graveyard or exile card left too, less the cards that came public from
  // nowhere, not cast, played or off the stack; Chord of Calling's creature to the battlefield beside Pinnacle Monk's
  // card back from the graveyard read "White puts a card from their library into their hand", hp-05. With nothing else
  // to fill the hand, a draw: a card into a graveyard beside it may have come from anywhere.)
  const prevStackIds = new Set(Object.values(prev.stack).map((s) => s.id));
  const vanished = new Set(Object.entries(prev.cards).filter(([id, w]) => !cur.cards[id] && (w.zone === "graveyard" || w.zone === "exile") && !w.fd).map(([, w]) => w.owner));
  const elsewhere = {};
  for (const [id, c] of Object.entries(cur.cards)) {
    if (vanished.has(c.owner) && !prev.cards[id] && !c.token && !castNow.has(id) && !landPlays.has(id) && !prevStackIds.has(id)) elsewhere[c.owner] = (elsewhere[c.owner] || 0) + 1;
  }
  // (a permanent its own ability puts on top of its owner's library, gone from the battlefield: in the library count, and
  // said so; Sensei's Divining Top's draw read "Sensei's Divining Top returns to White's hand" and no draw, hp-26)
  // (by the player's record, or by its ability on the stack before: live, the ability is seen on the stack and said, and
  // its record dropped, a snapshot before it resolves; hp-26 re-test)
  // (gone by its stack ids: its key changes when its source is hidden, a bounced Top's ability read as a spell)
  const topText = /\bon top of its owner's library\b/i;
  const curSids = new Set(Object.values(cur.stack).flatMap((s) => s.sids));
  const toLibraryTop = new Set([...pending.filter((e) => e.kind !== "cast" && topText.test(e.text || "")).map((e) => e.id),
    ...Object.entries(prev.stack).filter(([k, s]) => s.ability && !s.sids.some((x) => curSids.has(x)) && topText.test(k)).map(([, s]) => s.id)]
    .filter((id) => prev.cards[id]?.zone === "battlefield" && !cur.cards[id]));
  const toLibraryOf = (o) => [...toLibraryTop].filter((id) => prev.cards[id].owner === o).length;
  // a regeneration (Forge shows no shield): a "Regenerate" ability shields its creature this turn, and that creature
  // tapped while not attacking nor by its own {T} ability regenerated instead of being destroyed (Drudge Skeletons under
  // Murder read nothing after "casts Murder", gap-04). The shields: an ability seen leaving the stack (the AI's), the
  // player's own record ("Regenerate <itself>": the player's resolve before any board shows them on the stack), and a
  // regeneration target the player picked (see the target branch, `regenShield`)
  if (game.regenTurn !== cur.turn) { game.regenShields = new Set(); game.regenTurn = cur.turn; }
  for (const s of Object.values(prev.stack)) if (!s.sids.some((x) => curSids.has(x))) for (const id of s.regen || []) game.regenShields.add(id);
  for (const e of pending) if (e.kind === "ability" && /\bRegenerate\b/.test(e.text || "") && !/\bRegenerate target\b/.test(e.text || "")) game.regenShields.add(e.id);
  // goad (Forge shows none): a resolved spell or ability whose text goads, by its words: all/each creature(s) its
  // controller doesn't control, else its targets; noted until that player's next turn, said in the log and shown on
  // each card (see tableCard). Disrupt Decorum logged only "casts", hp-05 gap.
  game.goaded ??= new Map();
  for (const [id, g] of game.goaded) if (cur.active === g.by && cur.turn > g.turn) game.goaded.delete(id);
  const goads = [];
  for (const s of Object.values(prev.stack)) if (!s.sids.some((x) => curSids.has(x))) goads.push({ ctl: s.ctl, text: s.text || "", targets: s.cardTg || [] });
  // (and the player's own targeted trigger noted at its target pick: resolved once off the stack, taken from the stack
  // above when a board showed it there)
  game.ownTargeted = (game.ownTargeted || []).filter((t) => {
    if (Object.values(cur.stack).some((s) => s.id === t.id)) return true;
    if (!Object.values(prev.stack).some((s) => s.id === t.id)) goads.push(t);
    return false;
  });
  // suspect (Forge shows only its menace): a resolved "suspect target creature" makes its targets suspected until they
  // leave the battlefield, said in the log and shown on each card (see tableCard); Nelly Borca, hp-14 gap
  game.suspected ??= new Set();
  for (const id of game.suspected) if (cur.cards[id]?.zone !== "battlefield") game.suspected.delete(id);
  for (const g of goads) {
    if (!/\bsuspect target creature\b/i.test(g.text)) continue;
    const ids = g.targets.filter((id) => cur.cards[id]?.zone === "battlefield" && !game.suspected.has(id));
    for (const id of ids) game.suspected.add(id);
    if (ids.length) out.push(`${ids.map((id) => cur.cards[id].name).join(", ")} ${ids.length > 1 ? "are" : "is"} suspected: menace, and can't block`);
  }
  const pubIndex = cardIndex(pub);
  for (const [id, c] of Object.entries(cur.cards)) {
    if (c.zone !== "graveyard" || prev.cards[id]?.zone === "graveyard" || !c.spell || Object.values(prev.stack).some((s) => s.id === id)) continue;
    const picks = seatOfSlot(c.ctl)?.targetPicks;
    goads.push({ ctl: c.ctl, text: pubIndex[id]?.text || "", targets: picks && picks.src === id ? picks.ids.filter((v) => v.startsWith("card|")).map((v) => v.slice(5)) : [] });
  }
  for (const g of goads) {
    if (!/\bgoad\b/i.test(g.text)) continue;
    const all = /\bgoad (?:all|each) creatures? (?:you don't control|your opponents control)\b/i.test(g.text);
    // ("goad all suspected creatures": every suspected one, its own controller's too, Nelly Borca)
    const ids = /\bgoad all suspected creatures\b/i.test(g.text) ? [...game.suspected]
      : all ? Object.entries(cur.cards).filter(([, c]) => c.zone === "battlefield" && c.creature && c.ctl !== g.ctl).map(([id]) => id) : g.targets.filter((id) => cur.cards[id]?.zone === "battlefield");
    if (!ids.length) continue;
    for (const id of ids) game.goaded.set(id, { by: g.ctl, turn: cur.turn });
    out.push(`${ids.map((id) => cur.cards[id].name).join(", ")} ${ids.length > 1 ? "are" : "is"} goaded by ${who(g.ctl)}: ${ids.length > 1 ? "they attack" : "it attacks"} each combat, a player other than ${who(g.ctl)} if able, until ${who(g.ctl)}'s next turn`);
  }
  // revolt (Forge shows none): the turn a permanent its controller had left the battlefield, for the question of a revolt
  // card (see the target branch); Fatal Push asked "mana value 2 or less" after Evolving Wilds was cracked, hp-15 gap
  game.revolt ??= {};
  for (const [id, w] of Object.entries(prev.cards)) if (w.zone === "battlefield" && cur.cards[id]?.zone !== "battlefield") game.revolt[w.ctl] = cur.turn;
  // renowned (Forge shows none, and renown never triggers twice): a renown trigger gone from the stack with its creature
  // still on the battlefield made it renowned, said once and shown on the card until it leaves (Relic Seeker, hp-14 gap)
  game.renowned ??= new Set();
  for (const s of Object.values(prev.stack)) {
    if (s.kwTrigger !== "renown" || s.sids.some((x) => curSids.has(x)) || cur.cards[s.id]?.zone !== "battlefield" || game.renowned.has(s.id)) continue;
    game.renowned.add(s.id);
    out.push(`${cur.cards[s.id].name} becomes renowned`);
  }
  for (const id of game.renowned) if (cur.cards[id]?.zone !== "battlefield") game.renowned.delete(id);
  // (a haunt ends when its creature leaves the battlefield or the haunting card leaves the graveyard and exile)
  for (const [h, t] of game.haunting || []) {
    if (cur.cards[t]?.zone !== "battlefield" || !["graveyard", "exile"].includes(cur.cards[h]?.zone)) game.haunting.delete(h);
  }
  // (and solved, the same way: a Case's "To solve —" trigger gone from the stack with the Case still there; Case of the
  // Locked Hothouse read "White uses Case of the Locked Hothouse's ability" and showed nothing, hp-17 gap)
  game.solved ??= new Set();
  for (const s of Object.values(prev.stack)) {
    if (!/^To solve —/i.test(s.text || "") || s.sids.some((x) => curSids.has(x)) || cur.cards[s.id]?.zone !== "battlefield" || game.solved.has(s.id)) continue;
    game.solved.add(s.id);
    out.push(`${cur.cards[s.id].name} is solved`);
  }
  for (const id of game.solved) if (cur.cards[id]?.zone !== "battlefield") game.solved.delete(id);
  for (const id of game.regenShields) {
    const was = prev.cards[id], now = cur.cards[id];
    const ownTap = pending.some((e) => e.id === id && e.kind === "ability" && /\{T\}/.test(e.text || ""));
    if (was?.zone === "battlefield" && now?.zone === "battlefield" && !was.tapped && now.tapped && !now.attacking && !ownTap) {
      out.push(`${now.name} regenerates`);
      game.regenShields.delete(id);
    }
  }
  // (something that cloaks just resolved: an ability gone from the stack, or a spell that reached a graveyard)
  const cloaking = [...Object.values(prev.stack).filter((s) => !s.sids.some((x) => curSids.has(x))).map((s) => s.text || ""),
    ...Object.entries(cur.cards).filter(([id, c]) => c.zone === "graveyard" && c.spell && !prev.cards[id]).map(([id]) => pubIndex[id]?.text || "")].some((t) => /\bcloaks?\b/i.test(t));
  const libLoss = (o) => Math.max(0, (prev.counts[`library:${o}`] ?? 0) - (cur.counts[`library:${o}`] ?? 0) + toLibraryOf(o));
  // (below 0, more came public than left the library: the rest left the hand, which so gained more than it shows)
  const libToHandRaw = (o) => libLoss(o) - (elsewhere[o] || 0);
  const libToHand = (o) => Math.max(0, libToHandRaw(o));
  // a spell or ability of a player's that says discard, just resolved: what reached their graveyard from their hand is a
  // discard, and their draw counts it (the AI's Chart a Course, draw two and discard one, read "AI 1 draws a card" and
  // "AI 1 mills Island", hp-08 gap)
  // (and "Each player discards their hand": everyone's; Reforge the Soul's read "AI 1 mills ..." and "AI 1 draws a card"
  // for the AI's seven, hp-15 gap)
  const looted = new Set();
  for (const s of Object.values(prev.stack)) {
    if (s.sids.some((x) => curSids.has(x)) || !/\bdiscards?\b/i.test(s.text || "")) continue;
    looted.add(s.ctl);
    if (/\beach player discards\b/i.test(s.text)) for (const p of Object.keys(cur.life)) looted.add(p);
    else if (/\beach opponent discards\b/i.test(s.text)) for (const p of Object.keys(cur.life)) if (p !== s.ctl) looted.add(p);
  }
  // (and a hand over seven as a turn ends: cleanup's discard; the AI's Deep Analysis read "is put into AI 1's graveyard",
  // hp-26 gap)
  if (cur.turn !== prev.turn && prev.active && (prev.counts[`hand:${prev.active}`] ?? 0) > 7) looted.add(prev.active);
  // (and the player a spell targets, the spell gone or still resolving: Surging Dementia's AI discarded two sorceries that
  // read "is put into AI 1's graveyard", hp-23 gap)
  for (const s of [...Object.values(prev.stack), ...Object.values(cur.stack)]) if (/\btarget (?:player|opponent) discards\b/i.test(s.text || "")) for (const p of s.plTg || []) looted.add(p);
  const lootedOut = (o) => looted.has(o) ? Object.entries(cur.cards).filter(([id, c]) => c.owner === o && c.zone === "graveyard" && !prev.cards[id] && !fromStack(id, c)).length : 0;
  const sayDrawn = (owner, k, searched) => (drawAfter ? afterEntries : out).push(searched ? `${who(owner)} puts ${countWords(k, k, "card")} from their library into their hand` : `${who(owner)} draws ${countWords(k, k, "card")}`);
  for (const [owner, k] of Object.entries(facts?.draws || {})) sayDrawn(owner, k, false);
  for (const [owner, k] of Object.entries(facts?.tutors || {})) {
    seatOfSlot(owner)?.forget("search");
    sayDrawn(owner, k, true);
  }
  for (const [p, n] of facts ? [] : Object.entries(cur.counts)) {
    const [zone, owner] = p.split(":");
    const before = prev.counts[p];
    // (a hand discarded then drawn anew can end smaller: the discards count back, White's 8 to 2 under Reforge the Soul
    // said no draw, hp-15 gap)
    if (zone === "hand" && before != null && n + lootedOut(owner) > before && prev.counts[`library:${owner}`] != null && libToHand(owner) > 0) {
      // (just after a search or a look at their library the card was put there, not drawn: landcycling's land was
      // logged as "White draws a card", playtest 2026-10-27)
      const ownerSeat = seatOfSlot(owner);
      const searched = !!ownerSeat?.justDid("search", 20000);
      if (searched) ownerSeat.forget("search");
      // (no more than left the library for it: a graveyard card into the hand beside a draw read "draws 2 cards", hp-05)
      sayDrawn(owner, Math.min(n - before + lootedOut(owner), libToHand(owner)), searched);
    }
  }
  // cards from a hand into a graveyard together: one line (14 lines for a discard to hand size, playtest 2026-10-27)
  const discarded = {};
  for (const [id, c] of Object.entries(cur.cards)) {
    if (facts?.moves.has(id)) {
      if (facts.moves.get(id).how === "discard" && c.zone === "graveyard" && !prev.cards[id]) (discarded[c.owner] ||= []).push(id);
      continue;
    }
    // (an instant or sorcery from a hand into a graveyard between boards was most often cast, an AI's resolved in one
    // go: a discard only when its owner just chose cards to discard, else the neutral line below, stage 3 review)
    // (or its owner just chose cards to discard, the hand level by a draw beside it: connive and loot read as mills, suite
    // review 2026-10-28)
    // (or a spell or ability of theirs that says discard just resolved: the AI's Chart a Course, draw two and discard
    // one, read "AI 1 draws a card" and "AI 1 mills Island", hp-08 gap)
    const chose = seatOfSlot(c.owner)?.justDid("discard", 20000) || looted.has(c.owner);
    if (c.zone === "graveyard" && !prev.cards[id] && !fromStack(id, c) && (!c.spell || chose)
      && (chose || (cur.counts[`hand:${c.owner}`] ?? Infinity) < (prev.counts[`hand:${c.owner}`] ?? -Infinity))) (discarded[c.owner] ||= []).push(id);
  }
  for (const [owner, ids] of Object.entries(discarded)) {
    // (no more than could have left the hand: its drop, and what was drawn beside a chosen discard, at most what left the
    // library; a card beyond that came from elsewhere, suite review)
    const handDrop = prev.counts[`hand:${owner}`] - cur.counts[`hand:${owner}`];
    if (!ids.every((id) => facts?.moves.has(id))) {
      if (!seatOfSlot(owner)?.justDid("discard", 20000) && !looted.has(owner)) { if (ids.length > handDrop) { delete discarded[owner]; continue; } }
      else ids.splice(Math.max(0, handDrop + libLoss(owner)));
    }
    if (!ids.length) { delete discarded[owner]; continue; }
    // (the last turn's player's discard, seen with the new turn: their cleanup's, said before the new turn's line; read
    // "--- AI 1's turn 2 ---" then "White discards ...", hp-05)
    const line = `${who(owner)} discards ${ids.map((id) => cur.cards[id].name).join(", ")}`;
    if (cur.turn !== prev.turn && cur.active && owner === prev.active) out.unshift(line); else out.push(line);
  }
  const discardedIds = new Set(Object.values(discarded).flat());
  // cards into a graveyard from nowhere seen, up to what left that player's library and didn't reach their hand (the
  // hand's gain plus what was discarded from it): a mill, said in one line where the first card was (Emry's four cards
  // read as four "is put into White's graveyard", hp-06). An AI's loot between two boards can't be told from a mill.
  const millLeft = {}, millAll = {}, mills = {}, gyExiles = {}, libExiles = {}, bfExiles = { at: null, names: [] }, tokensGone = { at: null, names: [] };
  for (const k of Object.keys(cur.counts)) {
    const owner = k.startsWith("library:") ? k.slice(8) : null;
    if (owner == null || prev.counts[k] == null) continue;
    // (no more than left the library for the hand: Life from the Loam's dredge, the hand's card from the graveyard, cut
    // its three milled cards to "mills Forest, Forest" and "Plains is put into White's graveyard", hp-17)
    const drawn = Math.min(Math.max(0, (cur.counts[`hand:${owner}`] ?? 0) - (prev.counts[`hand:${owner}`] ?? 0) + (discarded[owner] || []).length), libToHand(owner));
    millLeft[owner] = facts ? facts.mills[owner] || 0 : Math.max(0, libLoss(owner) - drawn);
    millAll[owner] = millLeft[owner];
  }
  // (a card merged into a permanent this time: it mutated onto or under it; Gemrazer onto Eidolon of Blossoms read
  // "Eidolon of Blossoms becomes Gemrazer", "Gemrazer enters the battlefield", hp-09)
  const mutatedInto = new Map();
  for (const [id, c] of Object.entries(cur.cards)) for (const m of c.merged || []) if (!(prev.cards[id]?.merged || []).includes(m)) mutatedInto.set(m, id);
  const mutatedHosts = new Set(mutatedInto.values());
  const attackers = {}, landPlaysLeft = {}, tokensMade = {}, landsPut = {};
  const milled = (owner, name) => {
    if (!mills[owner]) { mills[owner] = { at: out.length, names: [] }; out.push(""); }
    mills[owner].names.push(name);
  };
  const toGraveyard = (c) => out.push(`${c.name} is put into ${who(c.owner)}'s graveyard`);
  for (const [id, c] of Object.entries(cur.cards)) {
    const was = prev.cards[id];
    // (one put onto the battlefield attacking was never declared: its arrival line says so instead; Hero of Bladehold's
    // Soldiers read "White attacks with Soldier Token, Soldier Token", hp-16 gap)
    if (c.attacking && was?.zone === "battlefield" && !was.attacking) (attackers[c.ctl] ||= []).push(c.name);
    if (was && was.zone === c.zone && was.fd && !c.fd) out.push(`${c.name} is turned face up (${who(c.ctl)})`);
    // (the same card under another name on the battlefield: it transformed or became a copy; Growing Rites of Itlimoc becoming Itlimoc,
    // Cradle of the Sun logged nothing, hp-03 #3)
    else if (was && was.zone === c.zone && c.zone === "battlefield" && !was.fd && !c.fd && was.name !== c.name && !mutatedHosts.has(id)) out.push(`${was.name} becomes ${c.name}`);
    if (was && was.zone === c.zone && !was.po !== !c.po) out.push(`${c.name} phases ${c.po ? "out" : "in"}`);
    if (was && was.zone === c.zone) continue;
    const from = was ? was.zone : null;
    const moved = facts?.moves.get(id);
    if (facts && !moved) noteGuess("arrival", `${c.name}: ${from || "nowhere seen"} to ${c.zone}`);
    // (a land played, not put: by Forge's word, else by the record of a player's play)
    const landPlayed = moved ? moved.how === "played" : landPlays.has(id);
    // (an arrival with its +1/+1 counters: Mycoloth's devour and Indoraptor's undying put them on unsaid, hp-13)
    const withP1 = c.p1 ? ` with ${c.p1 === 1 ? "a +1/+1 counter" : `${c.p1} +1/+1 counters`}` : "";
    // (and an Aura or Equipment with what it is attached to: Changing Loyalty and its two replicate copies read only
    // "creates Changing Loyalty", hp-14 gap)
    const others = (c.ctrs || []).map(([k, n]) => countWords(n, n, counterWords(k.toUpperCase()) || `${k.toLowerCase()} counter`)).join(" and ");
    const arrive = `${withP1}${others ? `${withP1 ? " and" : " with"} ${others}` : ""}${c.attacking ? `, ${c.tapped ? "tapped and " : ""}attacking` : ""}${c.att && cur.cards[c.att] ? `, attached to ${cur.cards[c.att].name}` : ""}`;
    if (c.zone === "battlefield" && mutatedInto.has(id)) {
      const host = mutatedInto.get(id), under = prev.cards[host]?.name ?? cur.cards[host].name;
      out.push(`${c.name} mutates ${cur.cards[host].name === c.name && under !== c.name ? "onto" : "under"} ${under}`);
    } else if (c.zone === "battlefield") {
      // (a land put onto the battlefield by an effect is not played: Tempt with Discovery's lands read "White plays
      // Forest", "AI 1 plays Swamp", hp-22 #7 2026-10-28. A player's play has its record; an AI's comes from its hand.)
      // (a land token is created, not put: Overlord of the Hauntwoods's Everywhere read "puts Everywhere onto the battlefield", hp-23)
      if (c.land && !c.token && !from && !Object.values(prev.stack).some((x) => x.id === id)) {
        // (an AI's by its land-play count, which a new turn starts at 0; without the count, by its hand: a draw and a
        // play between two boards left the hand as it was and "AI 1 puts Swamp onto the battlefield", hp-22 re-test)
        // (no more plays than the count rose: a land play and a Cultivate's land between two boards read as two plays)
        const landsNow = cur.lands[c.ctl], landsBefore = cur.turn === prev.turn ? (prev.lands[c.ctl] ?? 0) : 0;
        landPlaysLeft[c.ctl] ??= landsNow != null ? Math.max(0, landsNow - landsBefore) : null;
        const played = landPlayed || (!moved && !seatOfSlot(c.ctl) && (landPlaysLeft[c.ctl] != null ? landPlaysLeft[c.ctl]-- > 0
          : (cur.counts[`hand:${c.owner}`] ?? 0) < (prev.counts[`hand:${c.owner}`] ?? 0)));
        // (lands put there together, one line, tapped if so: Animist's Awakening's four read four lines and never said
        // tapped, hp-15 gap)
        if (played) out.push(`${who(c.ctl)} plays ${c.name}${arrive}`);
        else {
          const put = (landsPut[`${c.ctl}|${c.tapped ? "t" : ""}${arrive}`] ??= { at: out.length, names: [] });
          // (another player's by the spell that took it: a card on a battlefield reports that zone's player as its owner, so
          // Eternal Dominion's read "White puts Gaea's Cradle onto the battlefield", hp-23 gap)
          const robbed = [...Object.values(prev.stack), ...Object.values(cur.stack)].find((s) => s.ctl === c.ctl && /\btarget (?:opponent|player)'s library\b/i.test(s.text || "") && s.plTg?.some((p) => p !== c.ctl));
          put.names.push(`${robbed ? `${who(robbed.plTg.find((p) => p !== c.ctl))}'s ` : ""}${c.name}`);
          out[put.at] = `${who(c.ctl)} puts ${put.names.join(", ")} onto the battlefield${c.tapped ? " tapped" : ""}${arrive}`;
        }
      }
      // (the same tokens together, one line with their count: An Offer You Can't Refuse's two Treasures read "AI 1 creates
      // Treasure Token" twice, gap-04)
      else if (c.token) {
        const made = (tokensMade[`${c.ctl}|${c.name}${arrive}`] ??= { at: out.length, n: 0 });
        made.n++;
        out[made.at] = made.n === 1 ? `${who(c.ctl)} creates ${c.name}${arrive}` : `${who(c.ctl)} creates ${made.n} ${c.name}${/s$/.test(c.name) ? "" : "s"}${arrive}`;
      }
      // (brought back: Necromancy said nothing about what it returned, playtest 2026-10-26)
      else if (from === "graveyard" && c.land && landPlayed) out.push(`${who(c.ctl)} plays ${c.name} from ${who(was.owner)}'s graveyard${arrive}`);
      else if (from === "graveyard") out.push(`${c.name} returns to the battlefield from ${who(was.owner)}'s graveyard${arrive} (${who(c.ctl)})`);
      // (cast from exile: an adventurer, a foretold card, ... enters; read "returns ... from exile", hp-02 #3)
      // (a land played from exile is a play: Tibalt's read "returns to the battlefield from exile", re-test 2026-10-31)
      else if (from === "exile" && c.land && landPlayed) out.push(`${who(c.ctl)} plays ${c.name} from exile${arrive}`);
      else if (from === "exile") out.push(castNow.has(id) ? `${c.name} enters the battlefield${arrive} (${who(c.ctl)})` : `${c.name} returns to the battlefield from exile${arrive} (${who(c.ctl)})`);
      // (face down: off the stack a face-down spell's creature, else put there (manifest, cloak); Abhorrent Oculus's
      // manifest dread read "a face-down card enters the battlefield (White)", hp-09)
      // (by cloak, from what just resolved: Unexplained Absence's read "AI 1 puts a card onto the battlefield face down",
      // hp-20 gap)
      else if (c.fd) out.push(fromStack(id, c) ? `A face-down creature enters the battlefield (${who(c.ctl)})`
        : cloaking ? `${who(c.ctl)} cloaks a card: a face-down 2/2 with ward {2}` : `${who(c.ctl)} puts a card onto the battlefield face down`);
      else out.push(`${c.name} enters the battlefield${arrive} (${who(c.ctl)})`);
    } else if (c.zone === "graveyard") {
      // (what it was on the battlefield: the Rats made a Treasure "died" when sacrificed for mana, a creature card again
      // in the graveyard, hp-22 re-test 2026-10-28)
      // (sacrificed by its own resolved ability, "sacrifice it": Tangle Wire's fading with no counter left read "goes to the
      // graveyard", hp-14 gap)
      // (Forge's fading trigger says "sacrifice CARDNAME", or the card's name: live it read "goes to the graveyard" still)
      const ownSacrifice = Object.values(prev.stack).some((s) => s.id === id && !s.sids.some((x) => curSids.has(x))
        && (/\bsacrifice (?:it|CARDNAME|this (?:artifact|creature|enchantment|land|permanent))\b/i.test(s.text || "") || (s.text || "").includes(`sacrifice ${s.name}`)));
      // (an umbra destroyed instead of its creature, which stays: Bear Umbra under Murder on Elegy Acolyte read only "Bear
      // Umbra goes to the graveyard", hp-17 gap)
      const armored = from === "battlefield" && was.att && cur.cards[was.att]?.zone === "battlefield" && /\b(?:Umbra|Totem) armor\b/i.test(pubIndex[id]?.text || "") ? cur.cards[was.att].name : null;
      if (armored) out.push(`${c.name} is destroyed instead of ${armored} (umbra armor)`);
      else if (from === "battlefield") out.push((moved ? moved.how === "sacrificed" : ownSacrifice) ? `${c.name} is sacrificed` : was.creature ? `${c.name} dies`
        : moved?.how === "destroyed" ? `${c.name} is destroyed` : `${c.name} goes to the graveyard`);
      // (a permanent spell from the stack into a graveyard, which another spell targeted, was countered: Counterspell on the
      // Rats logged nothing, hp-01 #6)
      // (an instant or sorcery only under a counterspell: one under Twincast resolves; An Offer You Can't Refuse's Opt
      // logged nothing, gap-04)
      else if (!from && (prevSpellOf.get(id)?.sids || []).some((sid) => (c.spell ? prevCounterTargeted : prevTargeted).has(sid))) out.push(`${c.name} is countered`);
      // (an epic spell resolved: its player's spells are gone for good, shown nowhere; Eternal Dominion, hp-23 gap)
      else if (!from && fromStack(id, c) && /(?:^|\n)Epic \(/.test(pubIndex[id]?.text || "")) out.push(`${who(c.owner)} can't cast spells for the rest of the game (epic); at each of their upkeeps, ${c.name} is copied`);
      // (off the stack by Forge's word with no board showing it there: an AI's spell resolved between two boards)
      else if (!from && moved?.from === "Stack" && !fromStack(id, c)) out.push(`${who(c.owner)} casts ${c.name}`);
      else if (!from && !discardedIds.has(id) && (moved?.from === "Library" || !fromStack(id, c))) {
        if (moved) {
          if (moved.from === "Library" && moved.how !== "surveil") milled(c.owner, c.name);
          else toGraveyard(c);
        }
        // (the card whose ability its owner just used from the hand: discarded as the cost; Muddle the Mixture's transmute
        // and Lórien Revealed's cycling read "is put into White's graveyard", hp-17 hp-05)
        else if (abilityRecords.has(id)) out.push(`${who(c.owner)} discards ${c.name}`);
        // (an AI's own instant or sorcery in its own turn, one card down from its library: as likely cast between two
        // boards as milled, so neither is claimed; the AI's Sleight of Hand read "AI 1 mills Sleight of Hand", hp-08 gap)
        else if (c.spell && !seatOfSlot(c.owner) && cur.active === c.owner && millAll[c.owner] === 1) {
          millLeft[c.owner]--;
          toGraveyard(c);
        } else if (millLeft[c.owner] > 0) {
          millLeft[c.owner]--;
          milled(c.owner, c.name);
        } else toGraveyard(c);
      }
    } else if (c.zone === "exile") {
      // (its adventure resolved: the stack had it under the adventure's name, Stomp; read "is exiled", hp-02 #1)
      // (not a split or aftermath card, cast by its half's name, nor a face-down spell, suite review)
      const adventure = !c.name.includes("//") && !c.fd && Object.values(prev.stack).find((x) => x.id === id && x.name !== c.name && x.name !== "a face-down spell");
      // (a rebound spell off the stack comes back: Ephemerate read "Ephemerate is exiled", hp-09)
      const rebound = !adventure && c.rebound && Object.values(prev.stack).some((x) => x.id === id && !x.ability);
      // (cards from one graveyard exiled together: one line where the first was; Uro's escape cost read five "is exiled", hp-09)
      // (a haunting card exiled from the graveyard says what it haunts, its own line, hp-20 gap)
      if (from === "graveyard" && game.haunting?.has(id) && cur.cards[game.haunting.get(id)]) out.push(`${c.name} is exiled haunting ${cur.cards[game.haunting.get(id)].name}`);
      else if (from === "graveyard") {
        if (!gyExiles[was.owner]) { gyExiles[was.owner] = { at: out.length, names: [] }; out.push(""); }
        gyExiles[was.owner].names.push(c.name);
      // (plotted: Aven Interrupter's exiled spell read "Preordain is exiled", hiding that its owner may cast it free later,
      // hp-08 gap)
      // (and permanents exiled together, one line: Avatar's Wrath read nine "is exiled", hp-18 gap)
      } else if (from === "battlefield" && !adventure && !rebound) {
        if (bfExiles.at == null) { bfExiles.at = out.length; out.push(""); }
        bfExiles.names.push(c.name);
      // (a hidden card exiled suspended: the Tenth Doctor's from the library read "Diabolic Tutor is exiled", hp-21 gap)
      } else if (!from && c.suspend && timeCounters(c)) {
        const n = timeCounters(c);
        out.push(`${c.name} is exiled suspended with ${n} time counter${n === 1 ? "" : "s"}: ${who(c.owner)} may cast it without paying its mana cost when the last is removed`);
      // (and from a library, up to what left it for no hand, one line per owner: Benthic Infiltrator's ingest read "Island
      // is exiled", hp-21 gap)
      } else if (!from && !adventure && !rebound && !c.plotted && (moved ? moved.from === "Library" : !fromStack(id, c) && millLeft[c.owner] > 0)) {
        millLeft[c.owner]--;
        if (game.exiledSaid?.delete(id)) continue;
        if (!libExiles[c.owner]) { libExiles[c.owner] = { at: out.length, names: [] }; out.push(""); }
        libExiles[c.owner].names.push(c.name);
      } else out.push(adventure ? `${c.name} goes on an adventure (${adventure.name})` : rebound ? `${c.name} is exiled with rebound: ${who(c.ctl)} may cast it at their next upkeep`
        : c.plotted ? `${c.name} is exiled and plotted: ${who(c.owner)} may cast it without paying its mana cost on a later turn, as a sorcery`
        // (a paradigm spell, exiled as it resolves: Improvisation Capstone read "is exiled", hp-23 gap)
        : !from && /(?:^|\n)Paradigm \(/.test(pubIndex[id]?.text || "") ? `${c.name} is exiled (paradigm): at the start of each of their first main phases, ${who(c.owner)} may cast a copy of it without paying its mana cost`
        : `${c.name} is exiled`);
    } else if (c.zone === "command" && from) {
      out.push(`${c.name} returns to the command zone`);
    }
  }
  out.push(...afterEntries);
  // (a token ceases to exist wherever it goes: two Angel tokens killed by Apex Altisaur's fights left the log silent,
  // hp-12 re-test 2026-10-27; where it went isn't known, so "leaves" for it too)
  // (a card out of a graveyard or exile while its owner's hand grew by more than their library gave: into that hand;
  // Rancor after Wrath, Raise Dead's creature and Six's land logged nothing, hp-02 #9 hp-03)
  const handRoom = {};
  for (const [id, was] of Object.entries(prev.cards)) {
    if (cur.cards[id]) continue;
    const o = was.owner;
    // (the hand's gain counts the cards cast or played from it just now: Splinter's Technique cast while Champions of the
    // Perfect came back left the hand level, hp-11)
    handRoom[o] ??= Math.max(0, (cur.counts[`hand:${o}`] ?? 0) - (prev.counts[`hand:${o}`] ?? 0) - libToHandRaw(o)
      + [...castNow, ...landPlays].filter((x) => cur.cards[x]?.owner === o && !prev.cards[x]).length
      // (and a spell still on the stack, new and from no public zone: Splinter's Technique while its cost bounced)
      + Object.entries(cur.stack).filter(([k, s]) => !s.ability && s.ctl === o && !prev.stack[k] && !prev.cards[s.id]).length
      // (and a card swapped in from it: ninjutsu's Dryad Sophisticate and aura swap's Arcanum Wings read "leaves the
      // battlefield", hp-24 gap)
      + (seatOfSlot(o)?.justDid("handSwap", 20000)
        ? Object.entries(cur.cards).filter(([id, c]) => c.owner === o && c.zone === "battlefield" && !c.token && !prev.cards[id]).length : 0));
    // (a nontoken permanent gone while its owner's hand grew: returned to the hand; Champions of the Perfect returned by
    // Sneak read "leaves the battlefield", hp-11)
    const gone = facts?.moves.get(id);
    if (facts && !gone) noteGuess("departure", `${was.name} left ${was.zone}`);
    const toHand = gone ? gone.to === "Hand" : handRoom[o] > 0;
    if (was.zone === "battlefield") {
      if (toLibraryTop.has(id)) out.push(`${was.name} is put on top of ${who(o)}'s library`);
      else if (was.token && gone?.how === "sacrificed") out.push(`${was.name} is sacrificed`);
      else if (was.token && was.creature && gone?.to === "Graveyard") out.push(`${was.name} dies`);
      else if (was.token && gone?.to === "Exile") out.push(`${was.name} is exiled`);
      else if (!was.token && gone?.to === "Library") out.push(`${was.name} is put into ${who(o)}'s library`);
      else if (!was.token && !was.fd && toHand) { handRoom[o] = Math.max(0, handRoom[o] - 1); out.push(`${was.name} returns to ${who(o)}'s hand`); }
      // (a creature token gone in the combat damage step died: a token leaves no card in a graveyard, and a blocked
      // Phyrexian Mite read "leaves the battlefield", hp-11 gap)
      else if (was.token && was.creature && /damage/i.test(cur.step || "")) out.push(`${was.name} dies`);
      // (tokens gone together, one line: Avatar's Wrath's eight read one "leaves the battlefield" each, hp-18 gap)
      else if (was.token) { if (tokensGone.at == null) { tokensGone.at = out.length; out.push(""); } tokensGone.names.push(was.name); }
      else out.push(`${was.name} leaves the battlefield`);
    } else if ((was.zone === "graveyard" || was.zone === "exile") && !was.fd && toHand) {
      handRoom[o] = Math.max(0, handRoom[o] - 1); out.push(`${was.name} is put into ${who(o)}'s hand from ${was.zone === "exile" ? "exile" : "the graveyard"}`);
    }
  }
  // (the city's blessing, for the rest of the game: Wayward Swordtooth's ascend, hp-11 gap)
  for (const [p, b] of Object.entries(cur.blessed || {})) if (b && !prev.blessed?.[p]) out.push(`${who(p)} gets the city's blessing`);
  // (and an enduring story, storied's, for the rest of the game: Kíli the Resourceful's said nothing, hp-21 gap)
  for (const [p, b] of Object.entries(cur.story || {})) if (b && prev.story && !prev.story[p]) out.push(`${who(p)} has an enduring story`);
  for (const [p, n] of Object.entries(cur.poison || {})) {
    const was = prev.poison?.[p] ?? 0;
    if (n > was) out.push(`${who(p)} gets ${countWords(n - was, n - was, "poison counter")} (${n} in all)`);
    else if (n < was) out.push(`${who(p)} loses ${countWords(was - n, was - n, "poison counter")} (${n} in all)`);
  }
  // (the monarch and the initiative, never said: Palace Jailer made White the monarch and Starscream converted unexplained,
  // hp-17 gap; "undefined" in a board from before this was recorded is no change)
  if (prev.monarch !== undefined && cur.monarch && cur.monarch !== prev.monarch) out.push(`${who(cur.monarch)} becomes the monarch`);
  if (prev.initiative !== undefined && cur.initiative && cur.initiative !== prev.initiative) out.push(`${who(cur.initiative)} takes the initiative`);
  // (energy, which the table shows and the log never said: Volatile Stormdrake's four, then two paid, hp-16 gap)
  for (const [p, n] of Object.entries(cur.energy || {})) {
    const was = prev.energy?.[p];
    if (was == null || n === was) continue;
    out.push(n > was ? `${who(p)} gets ${n - was} energy (${n} in all)` : `${who(p)} pays ${was - n} energy (${n} left)`);
  }
  // (day and night: Brutal Cathar made it day with nothing shown or logged, playtest 2026-10-26)
  if (cur.day !== prev.day && (cur.day === "day" || cur.day === "night")) out.push(`It becomes ${cur.day}`);
  for (const [ctl, names] of Object.entries(attackers)) out.push(`${who(ctl)} attacks with ${names.join(", ")}`);
  // blocks, which the table draws as lines and the log never said (Fog Bank blocking Cavalry Master, hp-10 gap): each
  // attacker's new blockers, one line per attacker
  const newBlocks = {};
  for (const [b, at] of Object.entries(cur.blocks || {})) for (const a of at) if (!(prev.blocks?.[b] || []).includes(a) && cur.cards[b] && cur.cards[a]) (newBlocks[a] ||= []).push(cur.cards[b].name);
  for (const [a, names] of Object.entries(newBlocks)) out.push(`${names.join(", ")} ${names.length > 1 ? "block" : "blocks"} ${cur.cards[a].name}`);
  // (+1/+1 counters a permanent gains: Amass put Bowmasters' counter on Realmwalker, a changeling and so an Army, and the
  // log said nothing, so no Army token showed and nothing told why, hp-06 2026-10-28)
  // (the same number on several at once, one line with counts: Munda's Vanguard's cohort read sixteen lines, hp-21 gap)
  const p1Gains = {};
  for (const [id, c] of Object.entries(cur.cards)) {
    const was = prev.cards[id];
    if (c.zone === "battlefield" && was?.zone === "battlefield" && c.p1 > (was.p1 || 0)) {
      const n = c.p1 - (was.p1 || 0);
      if (!p1Gains[n]) { p1Gains[n] = { at: out.length, names: [] }; out.push(""); }
      p1Gains[n].names.push(c.name);
    }
    // (and -1/-1 counters: Morcant's blight and wither's damage put them on and the log said nothing, hp-11 gap)
    if (c.zone === "battlefield" && was?.zone === "battlefield" && (c.m1 || 0) > (was.m1 || 0)) {
      const n = c.m1 - (was.m1 || 0);
      out.push(`${c.name} gets ${n === 1 ? "a" : n} -1/-1 counter${n === 1 ? "" : "s"}`);
    }
    // (attached to something new while it stays: For Mirrodin!'s Equipment onto its Rebel, an equip; Hexplate Wallbreaker
    // read "creates Rebel Token" and nothing of the attach, hp-16 gap)
    if (c.zone === "battlefield" && was?.zone === "battlefield" && c.att && c.att !== was.att && cur.cards[c.att]) out.push(`${c.name} is attached to ${cur.cards[c.att].name}`);
    // (a new controller: Volatile Stormdrake's exchange with Precinct Captain was never said, hp-16 gap)
    if (c.zone === "battlefield" && was?.zone === "battlefield" && c.ctl !== was.ctl) out.push(`${who(c.ctl)} gains control of ${c.name}`);
    // (and its other counters, gained or lost, with how many are left: Tangle Wire's fading took a fade counter off each
    // upkeep and the log said nothing, hp-14 gap)
    if (c.zone === "battlefield" && was?.zone === "battlefield") {
      const now = Object.fromEntries(c.ctrs || []), then = Object.fromEntries(was.ctrs || []);
      for (const k of new Set([...Object.keys(now), ...Object.keys(then)])) {
        const d = (now[k] || 0) - (then[k] || 0), noun = counterWords(k.toUpperCase()) || `${k.toLowerCase()} counter`;
        if (d) out.push(`${c.name} ${d > 0 ? "gets" : "loses"} ${countWords(Math.abs(d), Math.abs(d), noun)} (${now[k] || 0} ${d > 0 ? "in all" : "left"})`);
      }
    }
  }
  // (what a resolved "taps an untapped ..." made its player tap: Tangle Wire's upkeep taps read nothing, hp-14 gap)
  for (const s of Object.values(prev.stack)) {
    if (s.sids.some((x) => curSids.has(x)) || !/\btaps? an untapped\b/i.test(s.text || "")) continue;
    const by = {};
    for (const [id, c] of Object.entries(cur.cards)) if (c.zone === "battlefield" && c.tapped && prev.cards[id]?.zone === "battlefield" && !prev.cards[id].tapped) (by[c.ctl] ||= []).push(c.name);
    for (const [ctl, names] of Object.entries(by)) out.push(`${who(ctl)} taps ${names.join(", ")} (${s.name})`);
  }
  for (const [p, l] of Object.entries(cur.life)) {
    const before = prev.life[p];
    if (before != null && l !== before) out.push(`${who(p)}: ${before} -> ${l} life (${l > before ? "+" : ""}${l - before})`);
  }
  // (many cards by count: Cut Your Losses's 46 read as one name after another, hp-16)
  const byCount = (names) => [...names.reduce((m, n) => m.set(n, (m.get(n) || 0) + 1), new Map())].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(", ");
  // (cards a player searched out into their graveyard aren't milled: Buried Alive's read "White mills Skyhunter Strike
  // Force", hp-18 gap)
  for (const [owner, m] of Object.entries(mills)) {
    out[m.at] = seatOfSlot(owner)?.justDid("search", 20000) ? `${who(owner)} puts ${m.names.join(", ")} into their graveyard from their library`
      : m.names.length > 6 ? `${who(owner)} mills ${m.names.length} cards: ${byCount(m.names)}` : `${who(owner)} mills ${m.names.join(", ")}`;
  }
  for (const [owner, g] of Object.entries(libExiles)) out[g.at] = `${byCount(g.names)} ${g.names.length === 1 ? "is" : "are"} exiled from ${who(owner)}'s library`;
  for (const [owner, g] of Object.entries(gyExiles)) out[g.at] = g.names.length === 1 ? `${g.names[0]} is exiled from ${who(owner)}'s graveyard` : `${g.names.join(", ")} are exiled from ${who(owner)}'s graveyard`;
  if (bfExiles.at != null) out[bfExiles.at] = bfExiles.names.length === 1 ? `${bfExiles.names[0]} is exiled` : `${byCount(bfExiles.names)} are exiled`;
  for (const [n, g] of Object.entries(p1Gains)) {
    const what = `${n === "1" ? "a" : n} +1/+1 counter${n === "1" ? "" : "s"}`;
    out[g.at] = g.names.length === 1 ? `${g.names[0]} gets ${what}` : `${byCount(g.names)} each get ${what}`;
  }
  if (tokensGone.at != null) out[tokensGone.at] = tokensGone.names.length === 1 ? `${tokensGone.names[0]} leaves the battlefield` : `${byCount(tokensGone.names)} leave the battlefield`;
  // (each line a sentence: "a face-down card is exiled" began in lower case, hp-16)
  return out.map((l) => (l ? l[0].toUpperCase() + l.slice(1) : l));
}

// A creature that enters and leaves the battlefield within FLASH_MS is said in the chat, with what left alongside it:
// the engine passes empty steps in a fraction of a second, so it could come and go before anyone saw it (playtest
// 2026-10-25: Necromancy cast in the draw step; the Obliterator was on the battlefield for 444 ms)
const FLASH_MS = 3000;
function flashNews(prev, cur, pub) {
  game.bfSince ??= {};
  const now = Date.now();
  const quick = [], along = [];
  for (const [id, c] of Object.entries(cur.cards)) {
    if (c.zone === "battlefield" && prev.cards[id]?.zone !== "battlefield") game.bfSince[id] = now;
  }
  for (const [id, was] of Object.entries(prev.cards)) {
    if (was.zone !== "battlefield" || cur.cards[id]?.zone === "battlefield") continue;
    const since = game.bfSince[id];
    delete game.bfSince[id];
    if (was.token || was.land) continue;
    const to = cur.cards[id]?.zone;
    if (was.creature && since != null && now - since < FLASH_MS) quick.push({ name: was.name, ctl: was.ctl, to });
    else along.push(was.name);
  }
  for (const q of quick) {
    const where = { graveyard: "went to the graveyard", exile: "was exiled", command: "went back to the command zone", hand: "went back to the hand", library: "went into the library" }[q.to] || "left";
    const step = /cleanup/i.test(pub.step || "") ? " at cleanup" : "";
    const with_ = along.length ? `, together with ${along.join(", ")}` : "";
    chat(`[MTG] ${q.name} (${nameOf(q.ctl) || q.ctl}) was on the battlefield only a moment: it ${where}${step}${with_}. See the log.`);
  }
}

function updateLog(pub) {
  const cur = logSnapshot(pub);
  // (every public card's name this game, for a card gone from all zones: see cname)
  game.namesSeen ??= new Map();
  // (a face-down card's name here is already "a face-down card": logSnapshot hides it)
  for (const [id, c] of Object.entries(cur.cards)) game.namesSeen.set(id, c.name);
  const prev = game.logPrev;
  game.logPrev = cur;
  const facts = engineFacts(pub.events);
  if (!prev) return;
  const lines = logEvents(prev, cur, pub, facts);
  flashNews(prev, cur, pub);
  if (!lines.length) return;
  game.log ??= [];
  game.log.push(...lines);
  if (game.log.length > 300) game.log.splice(0, game.log.length - 300);
  toTTS({ t: "gamelog", lines });
}

// Card rules texts trickle out ~1 KB at a time, 150 ms apart, so no single message makes TTS stall.
let textTimer = null;
function flushTexts() {
  if (textTimer || !game?.textQueue?.size) return;
  const texts = {};
  let bytes = 0;
  for (const [id, tx] of game.textQueue) {
    if (bytes > 0 && bytes + tx.length > 1000) break;
    texts[id] = tx;
    bytes += tx.length + id.length + 8;
    game.textQueue.delete(id);
  }
  toTTS({ t: "texts", texts });
  textTimer = setTimeout(() => { textTimer = null; flushTexts(); }, 150);
}

// A card's fixed details (name, pictures, type line) go out once per game in `cards`; lists then carry only what
// changes plus s:1 meaning "details as sent before" (TTS decodes JSON at ~15 ms per KB). Rules texts trickle separately.
// Picture links are most of a card's details: the usual klrmngr link travels as "k" + side + uuid, and the default
// card back as "" (the table rebuilds both; engine-renderer.lua expandUrl).
const KLR = /^https:\/\/img\.klrmngr\.com\/display\/(front|back)\/[0-9a-f]\/[0-9a-f]\/([0-9a-f-]{36})\.webp$/;
function shortUrl(u) {
  if (u == null) return u;
  if (u === DEFAULT_BACK) return "";
  const m = KLR.exec(u);
  return m ? (m[1] === "front" ? "kf" : "kb") + m[2] : u;
}
function slimmer(game) {
  game.sentStatic ??= {};
  const statics = {};
  const slim = (c) => {
    if (c.n == null) return c; // hidden card: nothing to share
    // rules text is the bulk of a card and TTS decodes ~15 ms per KB: it follows separately in small pieces
    const st = { n: c.n, f: shortUrl(c.f), b: shortUrl(c.b), tl: c.tl, cmc: c.cmc, ty: c.ty, tok: c.tok, bp: c.bp, bt: c.bt };
    for (const k of Object.keys(st)) if (st[k] == null || st[k] === false) delete st[k];
    const key = JSON.stringify(st) + "|" + (c.tx || "");
    if (game.sentStatic[c.id] !== key) {
      game.sentStatic[c.id] = key;
      statics[c.id] = st;
      if (c.tx) (game.textQueue ??= new Map()).set(c.id, c.tx);
      // (kept by id: a spell being paid for is on the stack, where Forge sends no rules text - Improvise's taps are
      // named from it, hp-12 re-test 2026-10-27)
      if (c.tx) (game.cardText ??= {})[c.id] = c.tx;
    }
    const { n, f, b, tl, cmc, tx, ty, tok, bp, bt, ...dyn } = c;
    const out = { s: 1 };
    for (const [k, v] of Object.entries(dyn)) {
      // leave out defaults (untapped, no counters, ...); power/toughness 0 is real information
      const empty = v == null || v === false || (v === 0 && k !== "p" && k !== "t") || (typeof v === "object" && !Object.keys(v).length);
      if (!empty) out[k] = v;
    }
    return out;
  };
  return { slim, statics };
}

function sendTable() {
  if (!game?.started || game.autoplay || !game.fromTable) return; // (other games get the text board, sendView)
  const seats = [...game.seats.values()].filter((s) => s.board?.state?.gameView);
  if (!seats.length) return;
  const pub = seats[0].board.state.gameView;
  // blocker id -> the attackers it blocks (the table draws a line to each)
  const blockers = new Map();
  for (const a of pub.combatAssignments || []) blockers.set(a.blockerId, [...(blockers.get(a.blockerId) || []), a.attackerId]);
  const toCard = (c) => tableCard(c, blockers);
  trackTurns(pub, seats);
  updateLog(pub);
  const rewind = rewindNews(pub);
  fixNews(pub);
  const byId = cardIndex(pub);
  const players = (pub.players || []).map((p) => {
    const own = seats.find((s) => s.slot === p.id)?.board.state.gameView;
    const command = zoneOf(pub, "command", p.id).cards;
    const cmdDamage = {};
    for (const [cid, n] of Object.entries(p.commanderDamage || {})) {
      const from = game.slotColor[byId[cid]?.ownerId];
      if (from && n) cmdDamage[from] = (cmdDamage[from] || 0) + n;
    }
    const row = {
      color: game.slotColor[p.id], slot: p.id, name: nameOf(p.id), ai: !own, life: p.life, status: p.status,
      // your own floating mana (only your seat's view has it)
      pool: own ? Object.fromEntries(Object.entries(own.players?.find((x) => x.id === p.id)?.manaPool || {}).filter(([, n]) => n)) : null,
      poison: playerCounter(p, "poison"),
      energy: playerCounter(p, "energy"),
      // (the monarch and the initiative, which Forge sends and nothing showed: Palace Jailer's monarchy, hp-17 gap)
      ...(pub.monarchId === p.id ? { monarch: true } : {}), ...(pub.initiativeHolderId === p.id ? { initiative: true } : {}),
      // (and the city's blessing and an enduring story, for the rest of the game, shown nowhere either, hp-21 gap)
      ...(p.hasCityBlessing ? { blessed: true } : {}), ...(p.hasEnduringStory ? { story: true } : {}),
      cmdDamage,
      // Commander tax per commander, in command-zone order (casts × 2).
      tax: Object.values(p.commanderCasts || {}).map((n) => 2 * (n || 0)),
      library: zoneOf(pub, "library", p.id).count,
      handCount: zoneOf(pub, "hand", p.id).count,
      // in a hand a card shows the plain back: TTS shows the other players a hand card's back, and a double-faced
      // card's back is its other face (playtest 2026-10-25: a daybound card in Yellow's hand showed its night side)
      hand: own ? zoneOf(own, "hand", p.id).cards.map((c) => ({ ...toCard(c), b: DEFAULT_BACK })) : null,
      battlefield: zoneOf(pub, "battlefield", p.id).cards.map((c) => tableCard(c, blockers, pub.activePlayerId)),
      graveyard: zoneOf(pub, "graveyard", p.id).cards.map(toCard),
      exile: zoneOf(pub, "exile", p.id).cards.map(toCard),
      command: command.map(toCard),
    };
    // (after the zones: the cards a seat may play from outside its hand, built once)
    const playable = own ? playableOf(own, toCard) : [];
    if (playable.length) row.playable = playable;
    return row;
  });
  // TTS decodes JSON slowly (~70 ms per full board, felt as a hitch every update). A card's fixed details (name,
  // pictures, type line, rules text) go out once in `cards`; zone lists then carry only what changes (tapped,
  // counters, damage, ...) plus s:1 meaning "details as sent before". A reload (hello) or new game resends all.
  const { slim, statics } = slimmer(game);
  for (const pl of players) for (const z of ["hand", "battlefield", "graveyard", "exile", "command", "playable"]) if (pl[z]) pl[z] = pl[z].map(slim);
  const stack = (pub.stack || []).map((s) => ({
    // (Forge's stack text names cards with its own number: "Change the text of Goblin King (37) by ...", hp-25 T5)
    // ("Ponder (18) - " in front, which the table's pop-up also cuts, goes first)
    id: s.id, n: s.identity?.name || "?", tx: displayText(s.text || "").replace(/^[^\n]{0,100}?\(\d+\) - /, "").replace(/([A-Za-z'’,]) \(\d+\)/g, "$1"), ctl: game.slotColor[s.controllerId] || null,
    src: s.sourceId || null, spell: !s.sourceAbilityText, // a spell's card is its source: the table moves that card
    // what it targets, for the target lines: a player's colour, a card id or another stack item's id
    tg: (s.targets || []).map((t) => (t.kind === "player" ? { k: "p", c: game.slotColor[t.id] || null } : { k: t.kind === "spell" ? "s" : "c", id: t.id }))
      .filter((t) => t.c || t.id),

    f: pictureOf(s.identity?.name),
  }));
  const tableMsg = {
    t: "table", turn: pub.turn, step: pub.step, active: game.slotColor[pub.activePlayerId] || null,
    activeTurnNo: game.turnsTaken?.[pub.activePlayerId] || 1,
    priority: game.slotColor[pub.priorityPlayerId] || null, gameOver: !!pub.gameOver,
    ...(pub.dayTime === "day" || pub.dayTime === "night" ? { day: pub.dayTime } : {}), // (shown beside the turn on the table)
    winner: pub.winnerId ? game.slotColor[pub.winnerId] || nameOf(pub.winnerId) : null, players, stack, cards: statics,
    rewind, // restore points and the open vote (in the board update: a message of its own doubled the traffic)
    ...(game.fix ? { fix: fixState() } : {}), // (a manual fix under way, PLAN M7)
  };
  // An update identical to the last one costs TTS a decode and a redraw for nothing (and feeds its GC pauses).
  const sig = JSON.stringify(tableMsg);
  if (sig === game.lastTableSig) return;
  game.lastTableSig = sig;
  // Zones identical to the last board sent are left out and named in `keep`: the table reuses its copy. A board
  // update was 1.5-4.7 KB and cost TTS 45-120 ms to decode; most updates change one or two zones.
  game.sentZones ??= {};
  for (const pl of tableMsg.players) {
    for (const z of ZONE_KEYS) {
      if (pl[z] == null) { delete game.sentZones[pl.color + "|" + z]; continue; } // (absent: the table empties it; sent again in full later)
      const js = JSON.stringify(pl[z]);
      const key = pl.color + "|" + z;
      if (game.sentZones[key] === js) { (pl.keep ??= []).push(z); delete pl[z]; } else game.sentZones[key] = js;
    }
  }
  toTTS(tableMsg);
  flushTexts();
}

function resetGame(reason) {
  if (game) { game.closing = true; for (const s of game.seats.values()) s.close(); }
  clearResume(); // (a reset game is never rejoined)
  if (game) for (const seat of game.seats.values()) stopTimer(seat, true);
  game = null;
  toTTS({ t: "clear" });
  chat(`[MTG] ${reason}`);
}

// ───────────────────────── View building ─────────────────────────
const pending = new Set();
function scheduleView(seat) {
  scheduleTable();
  if (pending.has(seat)) return;
  pending.add(seat);
  setImmediate(() => { pending.delete(seat); guarded("sendView", () => sendView(seat)); });
}

// A card's picture by name: the table's own image (the deck as imported), else Scryfall's (asked for once, cached).
const IMG_DIR = path.join(__dirname, "..", "tmp", "img-cache"); // jpgs for the /img/ route (older table scripts)
function pictureOf(name) {
  return (name && (imagesFor(name)?.face || cachedImage(name)?.face)) || null;
}

// The picture the table's card row shows for a card (undefined when face-down or not known yet).
function imgOf(c) {
  const name = c && c.visibility !== "hidden" ? c.identity?.name : null;
  return pictureOf(name) || undefined;
}

function battlefieldLabel(c) { return cardLabel(c) + (c?.identity && c.visibility !== "hidden" && c.summoningSick && (c.types || []).includes("Creature") ? " (sick)" : ""); }
// (one argument: as a .map callback it got the index as an "on the battlefield" flag, and library cards read "(sick)",
// hp-07 2026-10-27; battlefieldLabel adds that)
function cardLabel(c) {
  if (!c) return "?";
  if (c.visibility === "hidden" || !c.identity) return "(face-down)";
  let s = c.identity.name;
  if (c.power != null && c.toughness != null) s += ` ${c.power}/${c.toughness}`;
  // (in words: Karn's Bastion's proliferate offered "Kenrith, the Returned King 6/6 [1 P1P1]", hp-05)
  const counters = Object.entries(c.counters || {}).filter(([, n]) => n)
    .map(([k, n]) => `${n} ${counterWords(k) || `${k.toLowerCase()} counter`}${n === 1 ? "" : "s"}`);
  if (counters.length) s += ` [${counters.join(", ")}]`;
  if (c.damage) s += ` (${c.damage} dmg)`;
  return s;
}

// A player's zone in a game view (an empty one when the view doesn't have it).
function zoneOf(gv, kind, owner) {
  return (gv.zones || []).find((z) => z.zone === kind && z.ownerId === owner) || { cards: [], count: 0 };
}

// Why players lost, from the board: life, poison, commander damage (21 from one commander). One list for every
// end-of-game message ("AI 1 has 12 poison counters"); null when none of these applies. (Structural review 2026-10-27:
// the aborted-game message grew one reason at a time, and the normal game over gave none.)
const LOSS_REASONS = [
  (p) => (p.life <= 0 ? `is at ${p.life} life` : null),
  (p) => { const n = playerCounter(p, "poison"); return n >= 10 ? `has ${n} poison counters` : null; },
  (p) => { const n = Math.max(0, ...Object.values(p.commanderDamage || {}).map(Number).filter(Number.isFinite)); return n >= 21 ? `took ${n} damage from one commander` : null; },
];
// The order players left the game in (status lost / conceded first seen), so an end-of-game message names who lost
// last, not a player out since turn 5 at -3 life (stage 3 review 2026-10-27). Called with each board.
function noteOuts(gv) {
  if (!game || !gv) return;
  game.outOrder ??= {};
  let any = false;
  for (const p of gv.players || []) {
    if (p.status && p.status !== "playing" && game.outOrder[p.id] == null) { game.outOrder[p.id] = (game.outStamp ?? 0) + 1; any = true; }
  }
  if (any) game.outStamp = (game.outStamp ?? 0) + 1;
}
// Not out before the last players to go (still playing, or among them)
function outLast(p) { const at = game?.outOrder?.[p.id]; return at == null || at === game.outStamp; }
function lossReasons(gv) {
  const said = [];
  for (const p of (gv?.players || []).filter(outLast)) {
    const why = LOSS_REASONS.map((r) => r(p)).filter(Boolean);
    if (why.length) said.push(`${nameOf(p.id)} ${why.join(" and ")}`);
  }
  return said.length ? said.join(", ") : null;
}
// A player counter the engine may spell either way ("POISON" / "poison").
const playerCounter = (p, name) => (p.counters || {})[name.toUpperCase()] || (p.counters || {})[name] || 0;

function cardIndex(gv) {
  const byId = {};
  for (const z of gv.zones || []) for (const c of z.cards || []) byId[c.id] = c;
  return byId;
}

// Forge's own bookkeeping in a trigger's text is no words for a player: "... you control [Zone Changer: Deadeye
// Navigator (1)]", "Backup 1 (Targeting: [[]])", "... you gain 1 life. [Phase: White]" (hp-12 #2; the stack item's text
// still had them, hp-12 re-test 2026-10-27)
// Forge's text marks too: a changed word is "<strike>red</strike> green" (its card text and ability descriptions after
// Alter Reality, hp-25 T7): said "green (was red)"; its other tags (grey reminder text) are left out.
// ("[Room: Cave Entrance]" on a dungeon's text and "[Card: X, Activator: White, SpellAbility: ...]" on a stack item, hp-08
// #3 #7 2026-10-28; a note cut short by a length limit has no "]")
function withoutForgeNotes(t) {
  // (any "[Name: ...]" note, one bracket deep inside: "[Number Attackers: [The Ur-Dragon]]" on the stack, hp-22 re-test
  // 2026-10-28; card text has no such brackets, a loyalty cost "[-2]" has no name)
  return typeof t !== "string" ? t : t.replace(/\s*\[[A-Z][A-Za-z ]*:(?:\[[^\]]*\]|[^\][])*(?:\]|$)/g, "").replace(/\s*\(Targeting:\s*\[\[.*?\]\]\)/g, "")
    .replace(/<strike>(.*?)<\/strike>\s*([^\s.,;:)]+)/g, "$2 (was $1)").replace(/<\/?(?:span|strike|b|i)\b[^>]*>/g, "")
    // (Forge's tag on the card a delayed trigger remembers: rebound's "cast Ephemerate (Original) without paying", hp-09)
    .replace(/ \(Original\)/g, "")
    // (a script that gives the ability word twice, as PrecostDesc and again in SpellDescription: "The Tenth Doctor:
    // Timey-Wimey — {7}: Timey-Wimey — {7}: Time travel three times", hp-21 gap)
    .replace(/(^|\n|: )([A-Z][\w' -]{0,30} — (?:[^:\n]{0,40}: )?)\2/g, "$1$2");
}

// Engine text names players by relay username; show TTS colors / "AI n" instead.
function displayText(text) {
  if (!game || !text) return text;
  let out = withoutForgeNotes(String(text));
  game.playerOrder.forEach((username, i) => {
    // case-insensitive: the engine sometimes capitalises names ("Self-hosted-node-…-bot picked …")
    const lower = out.toLowerCase();
    const needle = username.toLowerCase();
    let at = lower.lastIndexOf(needle);
    while (at >= 0) {
      out = out.slice(0, at) + nameOf(`player-${i}`) + out.slice(at + username.length);
      at = at > 0 ? lower.lastIndexOf(needle, at - 1) : -1;
    }
  });
  return out;
}

// Forge's question titles in plain words (the player playtested them: "keep the text simple when asking questions").
// "Use triggered ability of Mirri's Guile?" -> "Use Mirri's Guile?"; "Apply replacement effect of Abundance?\r\n<its
// text>" -> "Use Abundance?" with its text below; // a search's "Mystical Tutor (0-1)" -> "Mystical Tutor (up to 1)".
function plainQuestion(title, text) {
  let t = String(title ?? ""), more = null;
  const nl = t.search(/[\r\n]/);
  if (nl >= 0) { more = shorten(t.slice(nl).trim(), 160); t = t.slice(0, nl).trim(); }
  t = t.replace(/^(.*?)Use triggered ability of (.+?)\?$/i, "$1Use $2?")
    .replace(/^(.*?)Apply replacement effect of (.+?)\?$/i, "$1Use $2?");
  t = t.replace(/ \((\d+)-(\d+)\)$/, (_, lo, hi) => ` (${lo === "0" ? `up to ${hi}` : `${lo} to ${hi}`})`);
  return { title: t, text: [more, text].filter(Boolean).join("\n") || undefined };
}
// A yes/no question in Arena's words, with verbs on the buttons where the question has one ("Pay 1 life" / "Don't pay",
// "Sacrifice" / "Keep it") and Yes / No otherwise (Forge's own "Accept" / "Decline" mean nothing to a player).
function yesNoWords(title, src, input) {
  let t = String(title || "").replace(/ {2,}/g, " ").trim();
  const own = (x, d) => (x && x !== "Accept" && x !== "Decline" ? x : d);
  let yes = own(input.confirmLabel, "Yes"), no = own(input.denyLabel, "No"), more = null;
  const pre = src && t.startsWith(`${src}: `) ? `${src}: ` : "";
  let q = t.slice(pre.length);
  let m;
  if ((m = q.match(/^Cancel Search\? Up to (\d+) more card\(s\) can be selected\.?$/i))) {
    q = "Stop searching?"; more = `You can still choose ${m[1]} more card${m[1] === "1" ? "" : "s"}.`; yes = "Stop searching"; no = "Keep searching";
  } else if ((m = q.match(/^\[Explore\] Put (.+?) in your graveyard\?$/i))) {
    // (Forge's "[Explore] Put X in your graveyard?" with Yes / No, hp-06 #17 2026-10-28)
    q = `Explore: put ${m[1]} into your graveyard?`; yes = "Graveyard"; no = "Keep on top";
    more = "A nonland card revealed: the creature that explored gets a +1/+1 counter either way.";
  } else if ((m = q.match(/^Search your ((?:graveyard|exile|library|hand)(?:(?:, | and | or )(?:graveyard|exile|library|hand))*)\?$/i))) {
    // (the card the ability names: Partner with's "Search your library?" for Alphinaud Leveilleur, hp-06 2026-10-28)
    const named = /^library$/i.test(m[1]) && String(input.abilityText || "").match(/\bput (.+?) into (?:your|their) hand from (?:your|their) library\b/i);
    // (and "put a land card from among them into your hand": Six's milled cards read "look in your graveyard and exile for
    // a card?", hp-03 #4)
    const among = String(input.abilityText || "").match(/\byou may put an? ((?:[\w-]+ ){0,2})card from among them into your hand\b/i);
    q = named ? `Search your library for ${named[1]}?` : among ? `Put a ${among[1]}card from among them into your hand?` : `Look in your ${m[1]} for a card?`;
  } else if (/If a commander is in a graveyard or in exile/i.test(q)) {
    q = src ? `Put ${src} back in the command zone?` : "Put your commander back in the command zone?"; yes = "Command zone"; no = "Leave it";
  } else if ((m = q.match(/^Pay ((?:Put|Remove|Sacrifice|Exile|Discard|Tap|Untap|Return)\b.*?)\??$/))) {
    q = `${m[1]}?`; yes = "Yes"; no = "No";
  } else if ((m = q.match(/^Pay (.+?)\??$/)) && /^Ward\b/i.test(String(input.abilityText || input.presentation?.text || ""))) {
    // (an ability targeting it too, by Forge's otherwise sentence: Kenrith's counter ability on Hexing Squelcher, gap-04)
    q = `${src ? `${src} has ward: ` : "Ward: "}pay ${m[1]}, or your ${/'s ability\b/i.test(String(input.presentation?.text || "")) ? "ability" : "spell"} is countered?`; yes = `Pay ${m[1]}`; no = "Don't pay";
  } else if ((m = q.match(/^Pay (.+?)\??$/))) {
    q = `Pay ${m[1]}?`; yes = own(input.confirmLabel, `Pay ${m[1]}`); if (yes === "Pay") yes = `Pay ${m[1]}`; no = own(input.denyLabel, "Don't pay"); if (no === "Decline" || no === "No") no = "Don't pay";
  } else if ((m = q.match(/^Cast (.+?) without paying its mana cost or put it into your hand\?$/i))) {
    q = `Cast ${m[1]} for free?`; yes = "Cast it"; no = "Put in hand";
  } else if (/^put on top of (?:your )?library\?$/i.test(q)) {
    // (a clash: the revealed card stays on top or goes to the bottom)
    q = `Keep ${src || "it"} on top of your library?`; yes = "Top"; no = "Bottom";
  } else if ((m = q.match(/^(?:Do you want to )?sacrifice (.*?)\??$/i))) {
    q = `Sacrifice ${src && /^(this( token| permanent| creature)?|it)?$/i.test(m[1]) ? src : m[1] || "it"}?`; yes = "Sacrifice"; no = "Keep it";
  } else if (OPTIONAL_ASK.test(q.split(/\r?\n/)[0]) && (m = String(input.abilityText || "").match(/\bmay ([^.]+)\./))) {
    // ("Use Deadpool, Trading Card?" / "Use Serra Angel?" said nothing: the ability's own "you may ..." says what,
    // hp-25 T11 T17 2026-10-27; Forge's raw "Apply replacement effect of X?\r\n<its text>" reaches here as it is)
    q = src ? `${src}: ${m[1]}?` : `${m[1][0].toUpperCase()}${m[1].slice(1)}?`;
    more = String(input.abilityText).trim();
  } else if ((m = q.match(/^Do you want to play (.+?)\?$/i))) {
    // (Madness: "Cast Emrakul, the World Anew?" said neither the cost nor where it goes otherwise, hp-06 2026-10-28)
    const madness = String(input.abilityText || "").match(/^Play Madness ((?:\{[^}]+\})+)/i);
    if (madness) { q = `Cast ${m[1]} for its madness cost ${madness[1]}?`; yes = "Cast it"; no = "To graveyard"; more = "Madness: if you don't cast it now, it goes from exile to your graveyard."; }
    // (a free cast says so, and where the card goes if not: Beseech the Mirror's read "Cast Gyre Sage?", hp-13)
    else if (/\bwithout paying its mana cost\b/i.test(String(input.abilityText || ""))) {
      q = `Cast ${m[1]} without paying its mana cost?`; yes = "Cast it";
      no = /\binto your hand if it wasn't cast\b/i.test(String(input.abilityText)) ? "Put in hand" : "Don't cast";
    } else { q = `Cast ${m[1]}?`; yes = "Cast it"; no = "Don't cast"; }
  } else if ((m = q.match(/^Do you want to (.+?)\?$/i))) {
    q = `${m[1][0].toUpperCase()}${m[1].slice(1)}?`.replace(/^Shuffle the library\?$/, "Shuffle your library?");
  } else if (!/\?$/.test(q)) {
    q = `${q[0] ? q[0].toUpperCase() + q.slice(1).replace(/\bCards\b/g, "cards") : q}?`;
  }
  if (no === "Decline") no = "No";
  // (a question that already names the card needs no "<card>: " in front)
  return [`${src && q.includes(src) ? "" : pre}${q}`, yes, no, more];
}
// "a card", "2 cards", "up to 2 cards", "1 to 3 cards" (Arena: "Discard a card.", "Choose up to two targets.")
// Forge titles a target question with its AI's hint ("Buff", "Hostile", "Damage", "Destroy", "Choose player to heal").
// Arena says what you do: "Choose a target to destroy", "Mortify: choose up to 2 targets". The hints that say nothing to
// a player ("Buff", "Friendly", "Hostile") get no verb, for cards and players alike (one table, structural review
// 2026-10-27).
const HINT_WORDS = { buff: "", pump: "", friendly: "", hostile: "", gain: "" };
const PLAYER_VERBS = { ...HINT_WORDS, heal: "gain life", fetch: "search their library", lose: "lose life" };
const TARGET_VERBS = { ...HINT_WORDS, destroy: "to destroy", exile: "to exile", sacrifice: "to sacrifice", damage: "to deal damage to", attach: "to attach it to",
  tap: "to tap", untap: "to untap", return: "to return", bounce: "to return", counter: "to counter", fight: "to fight", copy: "to copy",
  gaincontrol: "to gain control of" };
function targetTitle(title, src, min, max, noun = "permanent") {
  const t = String(title || "").trim();
  const player = t.match(/^Choose (?:a )?player to (\w+)/i);
  // (a sacrifice is a choice, not a target: "choose a land to sacrifice", playtest 2026-10-27)
  const what = player ? countWords(min, max, "player") : countWords(min, max, /^sacrifice$/i.test(t) ? noun : "target");
  // (Forge names some player choices by its AI's hint, "buff" / "friendly" / "hostile": no verb then; Riverchurn
  // Monument's mill asked for "players to buff", playtest 2026-10-27)
  const playerVerb = player && Object.hasOwn(PLAYER_VERBS, player[1].toLowerCase()) ? PLAYER_VERBS[player[1].toLowerCase()] : undefined;
  const verb = player ? (playerVerb === "" ? "" : `to ${playerVerb || player[1].toLowerCase()}`)
    // (and a hint in two words run together: Volatile Stormdrake's read "GainControl", hp-16 gap)
    : /^[A-Z][a-z]+(?:[A-Z][a-z]+)*$/.test(t) ? (Object.hasOwn(TARGET_VERBS, t.toLowerCase()) ? TARGET_VERBS[t.toLowerCase()] : "") : null;
  // a real sentence from the card ("Choose target creature you control") stays as it is
  if (verb === null && t) return `${t}${max > 1 ? ` (${countWords(min, max, "target").replace(/^an? /, "1 ")})` : ""}`;
  const q = `choose ${what}${verb ? ` ${verb}` : ""}`;
  return q[0].toUpperCase() + q.slice(1);
}
// What a bare "choose a target" / "choose a card" / "choose one" is for, from the asking ability's own words (Forge's
// ability text carries its cost: "{1}{G}: Put a +1/+1 counter on target creature." -> "put a +1/+1 counter on which
// creature?"; "Search your library for a basic land card, ..." -> "search your library for which basic land card?";
// "... return a creature card from your graveyard to your hand" -> "return which creature card to your hand?"; "create
// a Food token or a Treasure token" with Food / Treasure buttons -> "create which token?"). Kenrith's five abilities
// all read "choose a target", Demonic Tutor "choose a card" (sweep question audit 2026-10-27). Null unless exactly one
// sentence says it: a card's whole text with two such sentences (Kenrith's, when no ability text came) is no answer.
// A card pick's title (and the line under it) from Forge's own description of the step, which says more than "choose a
// card": one entry per description, matched in turn, the first that answers wins. ctx: { src, input, words, cardText }.
const plural = (input) => (input.max > 1 ? "s" : "");
const exactCount = (input) => (input.min === input.max && input.max > 1 ? ` (choose ${input.max})` : "");
const FORGE_STEPS = [
  // (Aura swap's Aura: Arcanum Wings read "choose up to 1 card from your hand", hp-24 gap)
  [/^Choose a card$/i, (m, { src, words }) => (/^Aura swap\b/i.test(words)
    ? { title: `${src}: aura swap: exchange it with which Aura card from your hand?`, text: "Or pick none: nothing changes." } : null)],
  // (Cultivate's second question, "Select a card to put onto the battlefield", read "search your library for which basic
  // land cards?", hp-02 #7 2026-10-28)
  [/^Select (?:a|an|one|\d+) cards? to ([a-z]+)\b(.*?)\.?$/i, (m, { src, input }) => ({ title: `${src}: ${m[1].toLowerCase()} which card${plural(input)}${m[2]}?` })],
  // (Learn with no Lesson outside the game: the discard to draw; First Day of Class read "choose up to 1 card from your
  // hand", hp-13)
  [/^Reveal a Lesson card\b/i, (m, { src, input }) => (input.cards.every((c) => c.zone === "hand")
    ? { title: `${src}: learn: discard which card to draw a card?`, note: "Or pick none: nothing happens.", text: "Or pick none: nothing happens." } : null)],
  // (Cipher's creature, "Choose a creature you control to encode": Whispering Madness read "choose a card", hp-16)
  [/^Choose a creature you control to encode\s*$/i, (m, { src }) => ({ title: `${src}: encode it onto which creature you control?`,
    text: "When that creature deals combat damage to a player, you may cast a copy of it for free." })],
  // (Fateseal's, "Choose card(s) to put on the bottom of <player> library": Mesmeric Sliver read "choose up to 1 card",
  // hp-24; the player's engine name becomes their table name in the last pass, prepareUi)
  [/^Choose card\(s\) to put on the bottom of (.+?) library$/i, (m, { src }) => ({ title: `${src}: put which cards on the bottom of ${m[1]}'s library?`,
    text: "The rest stay on top in the same order." })],
  // (Analyze the Pollen's read "choose up to 3 cards", hp-13)
  [/^Collect evidence (\d+)$/i, (m, { src }) => ({ title: `${src}: collect evidence ${m[1]}: exile which cards from your graveyard?`,
    note: `Their mana values must add up to ${m[1]} or more.`, text: `Their mana values must add up to ${m[1]} or more.` })],
  // (the card's "behold an Elf (and exile it)"; Champions of the Perfect read "choose a card", hp-11)
  [/^Behold$/i, (m, { src, cardText }) => {
    const b = cardText.match(/\bbehold (?:an?|one) ([^.(]+?)( and exile it)?\s*(?:\.|\()/i);
    return b && { title: `${src}: behold which ${b[1]}${b[2] ? " (it is exiled)" : ""}?`, text: `One you control or one from your hand${b[2] ? ", exiled as part of the cost" : ", shown"}.` };
  }],
  // (face down as a 2/2, and for manifest dread the other card to the graveyard; Abhorrent Oculus's read "put which card
  // onto the battlefield?", hp-09)
  [/^Choose cards? to manifest$/i, (m, { src, words }) => {
    const dread = /\bmanifest dread\b/i.test(words);
    const text = `${dread ? "The other card goes to your graveyard. " : ""}You can turn it face up any time for its mana cost if it's a creature card.`;
    return { title: `${src}: ${dread ? "manifest dread: " : ""}put which card onto the battlefield face down as a 2/2?`, note: text, text };
  }],
  // (a discard paid as an ability's cost, "{G}, Discard a creature card: Search your library ...": Survival of the
  // Fittest's read "search your library for which Creature card?" over the hand card to discard, hp-16 gap)
  [/^Choose cards? to discard$/i, (m, { src, input, words }) => {
    const cost = input.cards.every((c) => c.zone === "hand") && String(words || "").match(/(?:^|\n|,\s*)Discard (?:an?|one|two|three|\d+) ((?:[\w-]+ )*?)cards?(?:,[^:\n]*)?:/i);
    // (and any other discard says discard: Faithless Looting's read "choose a card from your hand")
    return { title: cost ? `${src}: discard which ${cost[1]}card${plural(input)} for the cost?${exactCount(input)}` : `${src}: discard which card${plural(input)}?${exactCount(input)}` };
  }],
  // ("Exile for cost", "Tap for cost": the card's cost line with that verb says which cost, by the keyword before a dash or
  // before its reminder; Uro's escape read "put which land card onto the battlefield? (choose 5)", Evendo's station "tap
  // which card for the cost?", hp-09)
  [/^(\w+) for cost$/i, (m, { src, input, cardText }) => {
    const verb = m[1].toLowerCase();
    const costLine = cardText.split(/\r?\n/).find((l) => new RegExp(`(?:^|[,—:(]\\s*)${verb}\\b`, "i").test(l));
    const keyword = costLine?.match(/^([A-Z][a-z]+(?: [a-z]+)?)\s*(?:[—-]|\()/)?.[1];
    const said = costLine?.replace(/\s*\([^()]*\)\s*$/, "");
    return { title: `${src}: ${verb} which card${plural(input)} for ${keyword ? `its ${keyword.toLowerCase()} cost` : "the cost"}?${exactCount(input)}`,
      ...(costLine ? { text: displayText(said && said !== keyword ? said : costLine.replace(/^[^(]*\(|\)\s*$/g, "")) } : {}) };
  }],
];
function forgeStepWords(desc, ctx) {
  for (const [re, say] of FORGE_STEPS) {
    const m = desc.match(re);
    const said = m && say(m, ctx);
    if (said) return said;
  }
  return null;
}
// A target question said by the asking card's keyword: { title } or { note } or null, every entry in turn (a later
// title over an earlier one). ctx: { src, uiTitle (the title so far), title (Forge's), ability, cardText,
// srcOnBattlefield, maxTargets }.
const KEYWORD_TARGETS = [
  // (Provoke's creature from its reminder: Goblin Grappler's read "provoke: you may have which creature defending player
  // controls untap and block it if able?", hp-21 gap)
  ({ src, uiTitle, cardText }) => /(?:^|\n)Provoke\b/.test(cardText) && / untap and block it if able\?$/.test(uiTitle)
    && { title: `${src}: provoke: which creature untaps and must block it?`, note: `That creature untaps and blocks ${src} if able.` },
  // (Haunt's creature, asked as the haunting card dies: Blind Hunter's read "which player loses 2 life and you gain 2
  // life?" over the creatures, its other sentence, hp-20 gap)
  ({ src, cardText, srcOnBattlefield, cardsOnly }) => cardsOnly && !srcOnBattlefield && /(?:^|\n)Haunt \(When this creature dies, exile it haunting target creature\.\)/i.test(cardText)
    && { title: `${src}: haunt which creature?`, note: `${src} is exiled haunting it; when that creature dies, ${src}'s haunt trigger happens again.` },
  // (Awaken's land, its reminder as the ability text: Part the Waterveil's read "choose a target", hp-16)
  // (over a purpose read from its reminder: "awaken 2—{3}{G} If you cast this spell for {3}{G}, also put ...", suite
  // review)
  ({ src, ability }) => {
    const n = ability.match(/^Awaken (\d+)\b/i)?.[1];
    return n && { title: `${src}: awaken ${n}: which land you control gets ${n} +1/+1 counters and becomes a 0/0 Elemental creature with haste?` };
  },
  // (Support N: Together Forever's read "choose up to 2 targets", hp-14)
  ({ src, uiTitle, cardText }) => {
    const n = /^choose up to \d+ targets$/i.test(uiTitle) && cardText.match(/\bsupport (\d+)\b/i)?.[1];
    return n && { title: `${src}: support ${n}: which ${/\bother target creatures\b/i.test(cardText) ? "other " : ""}creatures get a +1/+1 counter?` };
  },
  // (Strive's extra cost per target said under the pick: Twinflame's "choose up to 8 targets to copy" didn't, hp-14)
  ({ cardText, maxTargets }) => {
    const cost = cardText.match(/^Strive — This spell costs ((?:\{[^}]+\})+) more to cast for each target beyond the first\./m)?.[1];
    return cost && maxTargets > 1 && { note: `Strive: each target after the first costs ${cost} more.` };
  },
  // (Bargain's sacrifice while the spell is cast: Beseech the Mirror read "choose a creature to sacrifice" for The Reality
  // Chip, an artifact, hp-13)
  ({ src, title, srcOnBattlefield, cardText }) => (/^Sacrifice$/i.test(title) && !srcOnBattlefield && /(?:^|\n)Bargain\b/.test(cardText)
    ? { title: `${src}: sacrifice which artifact, enchantment or token (bargain)?` } : null),
];
// A yes/no that Forge words without its keyword, said by the keyword: [title, yes, no, note], or null. One entry each,
// in turn, the first that answers wins. ctx: { src, title, below (the title's second line), ability, cardText }.
const KEYWORD_YESNO = [
  // (Demonstrate's copy, as Forge asks it: "Copy the spell Incarnation Technique?" said nothing of the opponent's copy,
  // hp-23 gap)
  ({ src, ability }) => /^Demonstrate \(/.test(ability)
    && [`${src}: demonstrate: copy it? If you do, an opponent you choose copies it too`, "Copy it", "Don't"],
  // (Paradigm's copy, as Forge asks it from its effect "<card>' Paradigm": "Improvisation Capstone' Paradigm: cast a copy
  // of it from exile ... at the beginning of each of your first main phases?", hp-23 gap)
  ({ src, ability }) => /^Paradigm \(/.test(ability)
    && [`${src.replace(/' Paradigm$/, "")}: paradigm: cast a copy of it without paying its mana cost?`, "Cast a copy", "Don't"],
  // (Ripple's reveal, as Forge asks it: "Ripple 4 - Surging Dementia" read "Use Surging Dementia?", hp-23 gap)
  ({ src, ability }) => {
    const n = ability.match(/^Ripple (\d+) - /)?.[1];
    return n && [`${src}: ripple ${n}: reveal the top ${countWords(+n, +n, "card")} of your library?`, "Reveal them", "Don't",
      `You may cast any ${src} among them without paying its mana cost; the rest go to the bottom of your library.`];
  },
  // (and the way to forage, which the harness asks under Forge's AddOrRemove choice: "Add Counter" / "Remove Counter"
  // buttons for "sacrifice Food instead of exiling three cards?", hp-21 gap)
  ({ src, title }) => /^Forage: sacrifice Food instead of exiling three cards\?$/i.test(String(title).trim())
    && [`${src}: forage: sacrifice a Food, or exile three cards from your graveyard?`, "Sacrifice a Food", "Exile three cards"],
  // (Forage as a cost, as Forge asks it: "Forage" alone read "Camellia, the Seedmiser: Forage?", hp-21 gap)
  ({ src, title }) => /^Forage\??$/i.test(String(title).trim())
    && [`${src}: forage to pay for it (exile three cards from your graveyard or sacrifice a Food)?`, "Forage", "Don't"],
  // (time travel's add or remove, as Forge asks it: "choose what to do with 'Time' counter on Gilded Goose?", hp-21 gap)
  ({ src, title }) => {
    const m = String(title).match(/^choose what to do with '(\w+)' counter on (.+?)\?$/i);
    return m && [`${src}: add or remove a ${m[1].toLowerCase()} counter on ${m[2]}?`, "Add one", "Remove one"];
  },
  // (Kinship's reveal, as Forge asks it live: "Reveal cards to other players?" said nothing of the free play, hp-19 gap)
  ({ src, title, ability }) => /^Reveal cards to other players\?$/i.test(title) && /^Kinship —/i.test(ability)
    && [`${src}: kinship: reveal the top card to play it without paying its mana cost?`, "Reveal it", "Don't",
      `It shares a creature type with ${src}: reveal it, and you may play it for free.`],
  // (Endure's choice, as Forge asks it live: "You may put 2 +1/+1 counters on Leaf-Crowned Elder. If you don't, create a
  // 2/2 white Spirit creature token." read so, with ".?" after it, hp-19 gap)
  ({ title }) => {
    const m = String(title).match(/^You may put (\w+) \+1\/\+1 counters? on (.+?)\. If you don't, create an? (\d+\/\d+ [^.]+?) creature token\.?$/i);
    return m && [`${m[2]}: endure ${m[1]}: put ${m[1]} +1/+1 counter${m[1] === "1" ? "" : "s"} on it, or create a ${m[3]} token?`, "Counters on it", `${m[3].replace(/^\w/, (x) => x.toUpperCase())} token`];
  },
  // (Champion's choice, as Forge asks it live: "Search your battlefield?" under "Champion a Merfolk (...)": Wanderwine
  // Prophets' said nothing of the exile or the sacrifice, hp-19 gap)
  ({ src, title, ability }) => {
    const what = /^Search your battlefield\?$/i.test(title) && ability.match(/^Champion (an? [^(]+?)\s*\(/i)?.[1];
    return what && [`${src}: champion ${what}: exile one of yours until ${src} leaves?`, "Exile one", `Sacrifice ${src}`,
      `If you don't, ${src} is sacrificed. When it leaves the battlefield, the exiled card returns.`];
  },
  // (Miracle's trigger, as Forge asks it live: "Use triggered ability of Reforge the Soul?" with only "Reforge the Soul -
  // Miracle" below, read "Use Reforge the Soul?"; yes reveals it, and its cast for the miracle cost is asked next, hp-15 gap)
  // (and its cast, "Do you want to play Reforge the Soul?" with "Reforge the Soul - Miracle" as the ability: said with
  // the cost)
  ({ src, title, description, ability, cardText }) => {
    const cost = cardText.match(/(?:^|\n)Miracle ((?:\{[^}]+\})+)/)?.[1];
    if (cost && /^Do you want to play /i.test(title) && /^.+ - Miracle$/.test(ability.trim())) return [`${src}: cast it for its miracle cost ${cost}?`, "Cast it", "Don't cast"];
    return cost && /^.+ - Miracle$/.test(String(description || "").trim())
      && [`${src}: miracle: reveal it to cast it for ${cost}?`, "Reveal it", "Keep it", `Your first card drawn this turn: reveal it and you may cast it now for its miracle cost, ${cost}.`];
  },
  // (Extort's "you may pay {W/B}" with what it does: "Blind Obedience: pay {W/B}?" didn't, hp-15)
  ({ src, ability }) => {
    const m = ability.match(/^Extort \(Whenever you cast a spell, you may pay ((?:\{[^}]+\})+)\. If you do, ([^)]+?)\.\)/i);
    return m && [`${src}: extort: pay ${m[1]}?`, `Pay ${m[1]}`, "Don't pay", `If you do, ${m[2]}.`];
  },
  // (Devour's "Do you want to sacrifice?": Mycoloth's read "Mycoloth: sacrifice?", hp-13)
  ({ src, title, cardText }) => {
    const n = /^Do you want to sacrifice\?$/i.test(title) && cardText.match(/(?:^|\n)Devour (\d+)/)?.[1];
    return n && [`${src}: devour: sacrifice creatures as it enters?`, "Sacrifice creatures", "None",
      `It enters with ${n === "1" ? "a +1/+1 counter" : `${n} +1/+1 counters`} for each creature sacrificed.`];
  },
  // (and Exploit's: Sidisi's read "Sidisi, Undead Vizier: sacrifice?"; what it does when it exploits under it)
  ({ src, title, cardText }) => {
    const m = /^Do you want to sacrifice\?$/i.test(title) && /(?:^|\n)Exploit\b/.test(cardText)
      && cardText.match(/\bWhen (?:this creature|[^\n]+?) exploits a creature, ([^\n]+)/i);
    return m && [`${src}: exploit: sacrifice a creature?`, "Sacrifice one", "No", `If you do: ${m[1]}`];
  },
  // (Dredge's replacement, "Apply replacement effect of X?\r\nX - Dredge N": Life from the Loam's read "Use Life from the
  // Loam?", hp-17)
  ({ src, below }) => {
    const n = below.match(/ - Dredge (\d+)$/i)?.[1];
    return n && [`${src}: dredge ${n} instead of drawing?`, "Dredge", "Draw", `Mill ${n} cards and return ${src} from your graveyard to your hand instead of drawing a card.`];
  },
];
function keywordYesNo(ctx) {
  for (const say of KEYWORD_YESNO) {
    const said = say(ctx);
    if (said) return said;
  }
  return null;
}
// A cast way's keyword and cost with only its reminder ("Sneak {1}{B} (You may cast ...)"): Forge's ability text for a
// spell cast that way, which says nothing of what the spell does (hp-11)
const keywordOnly = (t) => !!t && /^[A-Z][a-z]+(?: [a-z]+)?(?: ?\{[^}]+\})*$/.test(String(t).replace(/\([^()]*\)/g, "").trim());
// Of several "search your library for ..." sentences, the one whose kind of card every offered card is: Analyze the
// Pollen's "a basic land card" / "instead ... a creature or land card" read "choose up to 1 card" with a creature
// offered (hp-13). A kind is "X or Y" alternatives of type, supertype or subtype words; null when not exactly one fits.
function searchTheCardsFit(words, cards, max = 1) {
  if (!cards?.length) return null;
  const isA = (c, kind) => kind.split(/\s+or\s+/i).some((alt) => alt.toLowerCase().split(/\s+/).filter((w) => w && w !== "card" && w !== "cards")
    .every((w) => [...(c.types || []), ...(c.supertypes || []), ...(c.subtypes || [])].some((t) => String(t).toLowerCase() === w)));
  const kinds = [...String(words || "").matchAll(/\bsearch your library for (?:an?|up to \w+) ((?:[\w-]+ )*?[\w-]+) cards?\b/gi)].map((m) => m[1]);
  // (several fitting: the narrowest, by fewest alternatives; Traverse the Ulvenwald without delirium offers basic lands,
  // which "a creature or land card" also fits, and read "choose up to 1 card", hp-06 gap)
  const alts = (k) => k.split(/\s+or\s+/i).length;
  const fit = [...new Set(kinds)].filter((k) => cards.every((c) => isA(c, k)));
  const least = Math.min(...fit.map(alts));
  const narrowest = fit.filter((k) => alts(k) === least);
  return narrowest.length === 1 ? `search your library for which ${narrowest[0]} card${max > 1 ? "s" : ""}?` : null;
}
// A modal spell's target question when Forge sends every mode ("• Destroy target noncreature artifact." / "• Target
// creature you control deals damage ... to target creature an opponent controls."): the one target phrase all the
// candidates fit, by its type words, state words and who controls them, made the question. HULK SMASH!'s second target
// read "• Destroy which noncreature artifact?" over Kenrith and Bloom Tender (hp-15 gap). With no modes, the sentences
// with two targets or more: Gimli's Reckless Might's formidable, "target attacking creature you control fights up to one
// target creature you don't control", read "choose a target" (hp-17 gap); a trigger's condition is left out. Null
// unless exactly one fits.
function modeTargetQuestion(text, candidates, byId, slot) {
  const lines = String(text || "").replace(/\([^()]*\)/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => l.startsWith("•")).map((l) => l.replace(/^•\s*/, ""));
  const modes = bullets.length >= 2 ? bullets : lines.flatMap((l) => l.split(/(?<=\.)\s+/)).filter((x) => (x.match(/\btarget\b/gi) || []).length >= 2);
  if (!modes.length || !candidates?.length) return null;
  const STATES = { attacking: (c) => !!c.isAttacking, blocking: (c) => !!c.isBlocking, tapped: (c) => !!c.tapped, untapped: (c) => !c.tapped };
  const fits = (states, words, who, c) => {
    const card = byId[c.id];
    if (!card || c.kind !== "card") return false;
    const types = (card.types || []).map((t) => t.toLowerCase());
    if (!states.every((st) => STATES[st](card))) return false;
    if (!who && words.length === 1 && words[0] === "permanent") return true;
    const ok = words.every((w) => (w.startsWith("non") ? !types.includes(w.slice(3)) : w === "permanent" || types.includes(w)));
    const mine = card.controllerId === slot;
    return ok && (!who || (who === "you control" ? mine : !mine));
  };
  const found = [];
  for (const mode of modes) {
    for (const m of mode.matchAll(/\btarget ((?:(?:attacking|blocking|tapped|untapped) )*)((?:non)?(?:artifact|creature|enchantment|land|planeswalker|battle|permanent)(?: (?:non)?(?:artifact|creature|enchantment|land|planeswalker|battle|permanent))*)(?: (you control|an opponent controls|you don't control))?/gi)) {
      const states = m[1].trim().toLowerCase().split(/\s+/).filter(Boolean);
      const words = m[2].trim().toLowerCase().split(/\s+/);
      // (its "up to one" goes: "fights up to one which creature" read so)
      if (candidates.every((c) => fits(states, words, m[3]?.toLowerCase(), c))) found.push(mode.slice(0, m.index).replace(/\bup to (?:one|two|three|\d+) $/i, "") + m[0].replace(/^target/i, "which") + mode.slice(m.index + m[0].length));
    }
  }
  if (found.length !== 1) return null;
  const q = found[0].replace(/\.$/, "").replace(/^[A-Z][a-z]+(?: [A-Z][a-z]+)* — /, "").replace(/^(?:When|Whenever|At)\b[^,]*,\s*/, "").replace(/^if\b[^,]*,\s*/i, "");
  return `${q[0].toLowerCase()}${q.slice(1)}?`;
}
function purposeOf(words, kind, labels = [], reminders = false) {
  const text = displayText(String(words || ""));
  const raws = (reminders ? text.replace(/[()]/g, " ") : text.replace(/\([^()]*\)/g, "")).split(/\r?\n|(?<=\.)\s+/);
  const found = [];
  for (const raw of raws) {
    // (a loyalty ability's cost too, and a granted ability in quotes left out, its colon not taken for a cost: Vraska's
    // '-2: Target creature becomes a Treasure artifact with "{T}, Sacrifice this artifact: Add ..."', hp-22 #3 2026-10-28)
    // (a keyword with its reminder's trigger, "Mentor (Whenever this creature attacks, put ...)", keeps the keyword:
    // Legion Warboss read "mentor Whenever this creature attacks, put a +1/+1 counter on which ...", hp-14 gap)
    // (the trigger's condition ends at its comma, but not at one inside a card's name, between capitalised words or before
    // "the X": "Whenever Nelly Borca, Impulsive Accuser attacks, suspect ..." read "impulsive Accuser attacks, ...", hp-14)
    const s = raw.replace(/^\s*•\s*/, "").replace(/ with "[^"]*"/g, "").replace(/^[+−–-]?\d+:\s*/, "").replace(/^[^:.]*\{[^:.]*\}[^:.]*:\s*/, "").replace(/^[A-Z][a-z]+(?: [A-Z][a-z]+)* — /, "")
      .replace(/^([A-Z][a-z]+)\s+(?:When|Whenever|At)\b(?:[^,]|(?<=[A-Z][\w'-]*),(?= (?:the )?[A-Z]))*,\s*/, (m, kw) => `${kw.toLowerCase()}: `)
      .replace(/^(?:When|Whenever|At)\b(?:[^,]|(?<=[A-Z][\w'-]*),(?= (?:the )?[A-Z]))*,\s*/, "")
      // (and an intervening "if ..., ": Raging Battle Mouse's celebration read "choose a target", hp-19 gap)
      .replace(/^if\b[^,]*,\s*/i, "").trim();
    let m;
    // (a cost is before the colon, so the sentence as it is: Ninjutsu's "{3}{B}, Return an unblocked attacker you control
    // to hand: Put this card onto the battlefield ...", hp-08 #8 2026-10-28)
    if (kind === "cards" && (m = raw.match(/\breturn (?:an?|one) ([^.:,]+?) you control to (?:its owner's |your )?hand\b/i))) found.push(`return which ${m[1]} to your hand?`);
    // (Sweep's "Return any number of Mountains you control to their owner's hand": Barrel Down Sokenzan read "choose up to
    // 2 cards", hp-23)
    else if (kind === "cards" && (m = s.match(/\breturn any number of ([^.:,]+?) you control to (?:their|its) owner(?:'s|s') hands?\b/i))) found.push(`return which ${m[1]} to your hand?`);
    // (to "card(s)" when it says so, past commas: "an artifact, creature, enchantment, or land card", Eternal Dominion)
    // (and "Target player searches their library": the player asked is the one searching, Varragoth's boast read "choose a
    // card", hp-15 gap)
    else if (kind === "cards" && (m = s.match(/\bsearch(es)? (your|target (?:opponent|player)'s|that player's|their) library for (?:an? |up to (?:one|two|three|\d+) |(?:two|three) )?((?:(?!, (?:reveal|put|then|exile)\b| and (?:put|reveal|exile)\b)[^.])*?\bcards?\b|[^,.]+?)(?:,| and |\.|$)/i))) found.push(`search ${m[1] && m[2] === "their" ? "your" : m[2]} library for which ${m[3]}?`);
    // ("look at the top four cards ..., exile one face down" (Hideaway), "put one of them into your hand"; The
    // Ur-Dragon's "put a permanent card from your hand onto the battlefield", hp-22 #5 2026-10-28)
    // (Crew: "Tap any number of creatures you control with total power N or more": Hedge Shredder's crew read "choose up
    // to 3 cards", hp-04 #3)
    // (time travel's card: The Tenth Doctor's read "choose up to 1 card", hp-21 gap)
    else if (kind === "cards" && /\btime travel\b/i.test(s)) found.push("time travel: add or remove a time counter on which card?");
    // (champion's exile, "sacrifice it unless you exile another Merfolk you control": Wanderwine Prophets read "choose up
    // to 1 card", hp-19 gap)
    else if (kind === "cards" && (m = s.match(/\bunless you exile another ([\w ]+?) you control\b/i))) found.push(`exile which other ${m[1]} you control?`);
    // (a clone's choice, "enter as a copy of a creature you control": Chameleon, Master of Disguise read "choose a card",
    // hp-16 gap)
    else if (kind === "cards" && (m = s.match(/\benters? (?:the battlefield )?as a copy of (?:an?|any) ([^,.]+?)(?:,|\.|$)/i))) found.push(`copy which ${m[1]}?`);
    else if (kind === "cards" && (m = s.match(/\btap any number of (?:other )?(?:untapped )?creatures you control with total power (\d+) or more\b/i))) found.push(/\bteamwork\b/i.test(text) ? `tap which creatures for teamwork (total power ${m[1]} or more)?`
      : `tap which creatures to ${/\bsaddled?\b/i.test(s) ? "saddle" : "crew"} it (total power ${m[1]} or more)?`);
    // ("you may reveal a creature card from among them and put it into your hand": Growing Rites of Itlimoc read "choose
    // up to 1 card", hp-03 #1)
    else if (kind === "cards" && (m = s.match(/\b(?:reveal )?an? ((?:[\w-]+ ){0,2})card from among them and put (?:it|that card) into your hand\b/i))) found.push(`put which ${m[1]}card into your hand?`);
    // (and a count: Brainstorm's "put two cards from your hand on top of your library", hp-02 #8; "from among them":
    // Six's milled land card read "choose up to 1 card", hp-03 #4; "with equal or lesser mana value": Kodama of the East
    // Tree's read "choose up to 1 card from your hand", hp-05)
    else if (kind === "cards" && (m = s.match(/\b(exile|put) (?:one|a card|an? ((?:[\w-]+ ){1,2})card|(?:up to )?(two|three|four|\d+|X|any number of) ((?:[\w-]+ ){1,2})?cards)(?: with [^.,]+?)?(?: of them| of those cards| from your hand| from among them)? (face down|into your hand|onto the battlefield|on top of your library)/i))) found.push(`${m[1].toLowerCase()} which ${m[2] || m[4] || ""}card${m[3] ? "s" : ""} ${m[5]}?`);
    // (and "put two of them into your hand", with no "cards": Dig Through Time read "choose 2 cards", hp-10 gap)
    else if (kind === "cards" && /\bput (?:two|three|four|\d+) of them into your hand\b/i.test(s)) found.push("put which cards into your hand?");
    // (an exile from your hand or graveyard with no destination: Chrome Mox's imprint, "exile a nonartifact, nonland card
    // from your hand", read "choose up to 1 card from your hand", hp-10)
    else if (kind === "cards" && (m = s.match(/\bexile (?:an?|one) ((?:[\w-]+,? ){1,3})card from your (hand|graveyard)\b/i))) found.push(`exile which ${m[1]}card from your ${m[2]}?`);
    // (Tangle Wire: "that player taps an untapped artifact, creature, or land they control for each fade counter";
    // Conspire: "you may tap two untapped creatures you control that share a color with it")
    else if (kind === "cards" && (m = s.match(/\btaps? (?:an?|one|two|three|\d+) ((?:untapped )?[^.]+?) (?:they|you) control\b/i))) found.push(`tap which ${m[1]}?`);
    else if (kind === "cards" && /^proliferate\b/i.test(s)) found.push("give which another counter (proliferate)?");
    // (Expropriate's "For each money vote, choose a permanent owned by the voter and gain control of it", hp-22 #9)
    else if (kind === "cards" && (m = s.match(/\bchoose an? ([^.]+?) owned by ([^.]+?) and gain control of it\b/i))) found.push(`gain control of which ${m[1]} owned by ${m[2]}?`);
    else if (kind !== "selection" && (m = s.match(/\breturn (?:up to one )?(?:an?|target) ([^.]+?) from (?:your|a) graveyard to (your hand|the battlefield)/i))) found.push(`return which ${m[1]} to ${m[2]}?`);
    // (the one creature spared: Avatar's Wrath's "Choose up to one target creature, then airbend all other creatures"
    // read "choose which creature, then airbend all other creatures?", hp-18 gap)
    else if (kind === "target" && (m = s.match(/^choose up to one target creature, then (\w+) all other creatures\b/i))) found.push(`which creature is spared? Every other creature is ${m[1].toLowerCase() === "airbend" ? "airbent" : `${m[1].toLowerCase()}ed`}`);
    // (an Aura's own "Enchant creature" line: Bear Umbra read "choose a target to attach it to", hp-17 gap)
    else if (kind === "target" && (m = s.match(/^Enchant ([a-z][a-z ]*?)\.?$/i))) found.push(`enchant which ${m[1].toLowerCase()}?`);
    // (a cost "for each target" is no target's purpose: Strive's "This spell costs {2}{R} more to cast for each target
    // beyond the first" read "... for each which beyond the first?", hp-14 gap)
    else if (kind === "target" && (s.match(/\btarget\b/gi) || []).length === 1 && !/\b(?:two|three|four|five|\d+|any number of) (?:other )?target\b/i.test(s)
      && !/\bfor each (?:other )?target\b/i.test(s)) {
      // ("Up to one target creature you control gains protection ...", Courageous Resolve, hp-22 #3 2026-10-28)
      // ("any target" whole: Lightning Bolt read "deals 3 damage to any which?", re-test 2026-10-30)
      const q = s.replace(/\.$/, "").replace(/\bany target\b|\b(?:up to one |an? )?(another )?target\b/i, (m, other) => (/^any/i.test(m) ? "which target" : other ? "which other" : "which"));
      // (up to 130 characters: Radiance's "Target creature and each other creature that shares a color with it gain
      // protection from the chosen color until end of turn" read "choose a target" at 90, hp-21)
      if (q.length <= 130) found.push(`${q[0].toLowerCase()}${q.slice(1)}?`);
    } else if (kind === "selection" && labels.length > 1 && labels.every((l) => new RegExp(`\\b${escapeRe(l)} tokens?\\b`, "i").test(s))) found.push("create which token?");
  }
  // (a landcycling's search is only in its reminder text: "Plainscycling {2} ({2}, Discard this card: Search your
  // library for a Plains card, ...)", Angel of the Ruins in the sweep 2026-10-27)
  if (!found.length && !reminders && /\(/.test(text)) return purposeOf(words, kind, labels, true);
  // (the same search said for each player, Tempt with Discovery's "Search your library ... Each opponent may search
  // their library ... search your library ...": the one asked is searching their own library, "your", hp-22 #6)
  const uniq = [...new Set(found)], yours = uniq.filter((f) => /^search your library\b/.test(f));
  return uniq.length === 1 ? uniq[0] : yours.length === 1 && uniq.every((f) => f.startsWith("search ")) ? yours[0] : null;
}
function countWords(min, max, noun) {
  min = Number(min) || 0; max = Number(max) || 0;
  const many = (n) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  if (min === max) return max === 1 ? `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}` : many(max);
  return min === 0 ? `up to ${many(max)}` : `${min} to ${many(max)}`;
}
// Forge's counter codes as players say them ("P1P1" -> "+1/+1 counter", "BURDEN" -> "burden counter")
const COUNTER_WORDS = { P1P1: "+1/+1 counter", M1M1: "-1/-1 counter", P1P0: "+1/+0 counter", P0P1: "+0/+1 counter", M0M1: "-0/-1 counter", M1M0: "-1/-0 counter", M2M1: "-2/-1 counter", P2P2: "+2/+2 counter" };
const counterWords = (label) => COUNTER_WORDS[label] || (/^[A-Z][A-Z0-9_]{2,}$/.test(label) ? `${label.toLowerCase().replace(/_/g, " ")} counter` : null);
// The last pass over every question (Arena's style: short, plain, the card's name in front, verbs on the buttons):
// "CARDNAME" -> the card, "player-view-0" -> the player, Forge's Accept / Decline -> Yes / No, double spaces.
function arenaWords(ui, src, seatSlot) {
  // (Forge's notes are taken out by displayText, which the title, text and options pass through after this; the
  // pictures' names here are card labels, which carry none)
  const fix = (t) => typeof t !== "string" ? t : t
    .replace(/CARDNAME/g, src || "this card")
    .replace(/player-view-(\d+)/g, (m, i) => (`player-${i}` === seatSlot ? "you" : nameOf(`player-${i}`)))
    .replace(/\byou's\b/g, "your").replace(/ {2,}/g, " ");
  ui.title = fix(ui.title);
  // after "<card>: " the question reads on in lower case ("Six: look in your graveyard...", "Ponder: shuffle your library?")
  if (src && typeof ui.title === "string" && ui.title.startsWith(`${src}: `)) {
    const rest = ui.title.slice(src.length + 2);
    if (/^(Use|Shuffle|Pay|Draw|Stop|Put|Sacrifice|Cast|Look|Choose|Search|Exile|Discard|Return|Keep|Reveal|Revealed|Do|Gain|Lose|Create|Tap|Untap|Mill)\b/.test(rest)) ui.title = `${src}: ${rest[0].toLowerCase()}${rest.slice(1)}`;
  }
  if (ui.text) ui.text = fix(ui.text);
  if (ui.options) ui.options = ui.options.map((o) => ({ ...o, label: o.label === "Accept" ? "Yes" : o.label === "Decline" ? "No" : fix(o.label) }));
  if (Array.isArray(ui.show)) ui.show = ui.show.map((c) => ({ ...c, n: fix(c.n) }));
  return ui;
}
function shorten(s, max) { return s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`; }

function nameOf(slot) { return (game && game.slotNames[slot]) || slot; }

// What "No" does in an "unless you pay" question, from Forge's `otherwise: "..."` text, in the player's words:
// "tts-White-x puts a Card.ChosenCard from their hand on top of their library." -> "put Worldly Tutor from your hand on
// top of your library"; "Sacrifices Mystic Remora (6)" -> "sacrifice Mystic Remora". `card` names Card.ChosenCard (the
// card this question is about, when the bridge knows it), else "that card". null when there is no such text.
function otherwiseText(seat, input, card, src = null) {
  const m = String(input.presentation?.text || "").match(/^otherwise:\s*"([\s\S]*)"\s*$/);
  if (!m) return null;
  let s = displayText(m[1]).replace(/\s*\(\d+\)/g, "").replace(/\.$/, "").trim();
  const me = nameOf(seat.slot), user = seat.username || "";
  for (const who of [me, user]) if (who && s.toLowerCase().startsWith(who.toLowerCase() + " ")) s = s.slice(who.length + 1);
  // (a sentence about the asking card itself stays as it is: "Spider-Punk gains haste" read "spider-Punk gains haste",
  // hp-18)
  if (src && s.startsWith(`${src} `)) return s;
  // the verb as an instruction: "puts" -> "put", "Sacrifices" -> "Sacrifice", "passes" -> "pass"
  s = s.replace(/^\w+/, (w) => (/(ss|x|ch|sh|z)es$/i.test(w) ? w.slice(0, -2) : /s$/i.test(w) ? w.slice(0, -1) : w))
    .replace(/\ba Card\.\w+|\bCard\.\w+/g, card || "that card").replace(/\btheir\b/g, "your").replace(/\bthem\b/g, "you");
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function sendView(seat) {
  if (!game || !game.seats || ![...game.seats.values()].includes(seat)) return; // a seat of a game that was reset
  if (game?.autoplay) return; // the CPU-contention test sends TTS nothing
  if (game?.fromTable) return; // the group's table draws the game itself (sendTable)
  const gv = seat.board?.state?.gameView;
  if (!gv) return;
  const zone = (kind, owner) => zoneOf(gv, kind, owner);
  const byId = cardIndex(gv);
  const players = (gv.players || []).map((p) => {
    const bf = zone("battlefield", p.id).cards;
    const lands = bf.filter((c) => (c.types || []).includes("Land"));
    const others = bf.filter((c) => !(c.types || []).includes("Land"));
    const cmdDmg = Object.entries(p.commanderDamage || {}).filter(([, n]) => n)
      .map(([cid, n]) => `${n} from ${byId[cid]?.identity?.name || "a commander"}`);
    return {
      name: nameOf(p.id), you: p.id === seat.slot, life: p.life, status: p.status,
      poison: playerCounter(p, "poison"),
      hand: zone("hand", p.id).count, library: zone("library", p.id).count,
      graveyard: zone("graveyard", p.id).count, exile: zone("exile", p.id).count,
      command: zone("command", p.id).cards.map((c) => cardLabel(c)),
      commanderDamage: cmdDmg,
      permanents: others.map((c) => (c.tapped ? "(T) " : "") + battlefieldLabel(c)),
      lands: summarizeLands(lands),
      active: p.id === gv.activePlayerId, priority: p.id === gv.priorityPlayerId,
    };
  });
  const stack = (gv.stack || []).map((s) => s.description || s.text || s.name || s.sourceName || JSON.stringify(s).slice(0, 80));
  toTTS({
    t: "view", color: seat.color,
    view: {
      turn: gv.turn, step: gv.step, active: nameOf(gv.activePlayerId), priority: nameOf(gv.priorityPlayerId),
      gameOver: !!gv.gameOver, winner: gv.winnerId ? nameOf(gv.winnerId) : null,
      players, stack,
      hand: zone("hand", seat.slot).cards.map((c) => cardLabel(c)),
    },
  });
}

function summarizeLands(lands) {
  const groups = {};
  for (const c of lands) {
    const k = c.identity?.name || "?";
    groups[k] ??= { n: 0, untapped: 0 };
    groups[k].n++;
    if (!c.tapped) groups[k].untapped++;
  }
  return Object.entries(groups).map(([name, g]) => `${name} ${g.untapped}/${g.n}`);
}

// ───────────────────────── Prompts → TTS buttons ─────────────────────────
// Every prompt becomes { title, text, mode: "single"|"multi"|"number"|"info", options, min, max, cancel }
// plus toOutput(answer) that builds the engine's PromptOutput.
// ───────────────────────── Step-by-step choices (phase 3) ─────────────────────────
// Some engine prompts need several small decisions (an order, damage per blocker, where each scried card goes).
// The panel asks them one at a time; a step's toOutput returns { __next: { ui, toOutput } } for the next step,
// and only the last step builds the answer the engine gets.
const next = (ui, toOutput) => ({ __next: { ui, toOutput } });

// Asks for an order one pick at a time. items: [{ id, label }]. done(orderedIds) builds the final answer.
// "Keep this order" finishes with the remaining items as they are.
// title: a text ("<title>: pick #n") or a function of how many are already placed (plain words for the reorders a player
// meets most: "Mirri's Guile: click the card to put on top", then "the next card").
function orderSteps(title, hint, items, done, chosen = []) {
  if (items.length <= 1) return { auto: done([...chosen, ...items].map((i) => i.id)) };
  const ui = {
    title: typeof title === "function" ? title(chosen.length) : `${title}: pick #${chosen.length + 1}`, mode: "single", kind: "order",
    text: [hint, chosen.length ? `So far: ${chosen.map((c, i) => `${i + 1}. ${c.label}`).join("  ")}` : ""].filter(Boolean).join("\n"),
    options: [{ id: "__keep", label: `Keep this order: ${items.map((i) => i.label).join(", ")}` }, ...items.map((i) => ({ id: i.id, label: i.label, img: i.img }))],
  };
  const toOutput = (a) => {
    if (a[0] === "__keep") return done([...chosen, ...items].map((i) => i.id));
    const pickedItem = items.find((i) => i.id === a[0]);
    const rest = items.filter((i) => i !== pickedItem);
    const step = orderSteps(title, hint, rest, done, [...chosen, pickedItem]);
    return step.auto ?? next(step.ui, step.toOutput);
  };
  return { ui, toOutput };
}

// Combat damage: auto (lethal to each blocker in order, the rest to the last one or the player with trample) or
// one number per assignee. assignees: [{ id, label, lethal }]; the last one always takes what is left.
function damageSteps(totalDamage, assignees, done, given = [], left = totalDamage) {
  const i = given.length;
  if (i >= assignees.length - 1 || left <= 0) {
    const out = [...given];
    if (left > 0) out.push({ assigneeId: assignees[Math.min(i, assignees.length - 1)].id, damage: left });
    return { auto: done(out.filter((g) => g.damage > 0)) };
  }
  const a = assignees[i];
  const ui = {
    title: `Damage to ${a.label} (${left} left)`, mode: "number", min: 0, max: left, kind: "number",
    ...(a.img ? { show: [{ n: a.label, img: a.img }] } : {}),
    text: `Lethal for it: ${a.lethal}. Whatever is left after the others goes to ${assignees[assignees.length - 1].label}.`,
  };
  const toOutput = (v) => {
    const dmg = Math.max(0, Math.min(left, Number(v[0]) || 0));
    const step = damageSteps(totalDamage, assignees, done, [...given, { assigneeId: a.id, damage: dmg }], left - dmg);
    return step.auto ?? next(step.ui, step.toOutput);
  };
  return { ui, toOutput };
}

const ZONE_LABEL = { libraryTop: "Top of library", libraryBottom: "Bottom of library", graveyard: "Graveyard", exile: "Exile", hand: "Hand" };

// Scry / surveil and similar: each card gets a destination, then the cards left on top are put in order.
function scryPlaceSteps(cards, zones, label, done, placed = {}) {
  const c = cards[Object.keys(placed).length];
  if (!c) {
    const byZone = zones.map((z) => cards.filter((x) => placed[x.id] === z));
    const topIdx = zones.indexOf("libraryTop");
    if (topIdx >= 0 && byZone[topIdx].length > 1) {
      const step = orderSteps((n) => `Your library: click the card to put ${n ? `next (number ${n + 1} from the top)` : "on top"}`, "Top card first. Not sure? Keep this order.",
        byZone[topIdx].map((x) => ({ id: x.id, label: label(x), img: imgOf(x) })),
        (ids) => done(zones.map((z, i) => (i === topIdx ? ids : byZone[i].map((x) => x.id)))));
      return step;
    }
    return { auto: done(byZone.map((list) => list.map((x) => x.id))) };
  }
  const ui = {
    title: `Where does ${label(c)} go?`, mode: "single", kind: "place",
    text: `Card ${Object.keys(placed).length + 1} of ${cards.length}`,
    options: zones.map((z) => ({ id: z, label: ZONE_LABEL[z] || z })),
    show: [{ n: label(c), img: imgOf(c) }], // the card in question, shown in the table's card row
  };
  const toOutput = (a) => {
    const step = scryPlaceSteps(cards, zones, label, done, { ...placed, [c.id]: a[0] });
    return step.auto ?? next(step.ui, step.toOutput);
  };
  return { ui, toOutput };
}

// What each engine question is, for the table: `kind` on every prompt message (plus `dest: "library"` when the chosen
// cards go to the library). Steps of a question set their own kind ("order", "place", "number", "choice").
const PROMPT_KIND = {
  mulligan: "mulligan", mulliganPutBack: "mulliganPutBack", chooseAction: "priority", payManaCost: "mana",
  chooseBoardTargets: "target", chooseBoolean: "yesno", chooseCards: "cards", chooseNumber: "number",
  chooseFromSelection: "modal", chooseAttackers: "attack", chooseBlockers: "block", scry: "cards", reorder: "order",
  chooseDamageAssignmentOrder: "order", chooseCombatDamageAssignment: "damage", chooseColor: "color",
  revealCards: "reveal", diceRolled: "dice",
};
// "Put 1 card on the bottom of your library": whole words, so "Treetop Village" doesn't count
const toLibrary = (title) => /\b(bottom|top)\b/i.test(String(title || ""));

// Normalises a panel prompt the way onPrompt does for engine prompts (labels, defaults).
// Forge writes life as a cost symbol ("Pay 4 {LIFE}?"); the table shows words.
const plainWords = (s) => (typeof s === "string" ? s.replace(/\{LIFE\}/g, "life") : s);
function prepareUi(ui) {
  ui.text = plainWords(displayText(ui.text || ""));
  ui.title = plainWords(displayText(ui.title));
  // (the corner's note the same way as the text: it skipped player names and Forge's notes, suite review)
  if (ui.note) ui.note = plainWords(displayText(ui.note));
  if (ui.options) ui.options = ui.options.map((o) => ({ ...o, label: plainWords(displayText(o.label)) }));
  ui.min ??= 1; ui.max ??= 1;
  return ui;
}

// Start of turn and End of turn are on until a player switches them off (the table's engineStopsOf: same default).
const DEFAULT_STOPS = new Set(["start", "end"]);
// a Start that arrives within this long of another one (still setting up) is the same press
const START_SETUP_MS = 8000;
// how long a card dragged while it wasn't your priority waits to be cast at your next priority
const QUEUED_PLAY_MS = 30000;
// Which engine steps each panel stop covers (your turn and theirs).
// "mtg skip <phase>": priority passed for the player until that phase (the next time it comes, anyone's turn; "mine" is
// their own next turn); an opponent's spell or ability on the stack stops it, so they can answer. The phase words, in
// turn order, by Forge's steps (2026-10-29, the player's request: "auto skip priority until a chosen phase")
const SKIP_PHASES = { upkeep: ["upkeep"], draw: ["draw"], main: ["main1"], combat: ["combatBegin", "combatDeclareAttackers"],
  blockers: ["combatDeclareBlockers"], damage: ["combatFirstStrikeDamage", "combatDamage"], main2: ["main2"], end: ["end", "endOfTurn"],
  mine: ["upkeep", "draw", "main1"] };
const SKIP_ORDER = ["untap", "upkeep", "draw", "main1", "combatBegin", "combatDeclareAttackers", "combatDeclareBlockers", "combatFirstStrikeDamage",
  "combatDamage", "combatEnd", "main2", "end", "endOfTurn", "cleanup"];
// whether a skip set at (turn, step) has reached its phase: that phase's step, or one past it, in a later turn or later in
// the same turn (Forge gives no priority in some steps: a combat with no attackers has no blockers step); "mine" in the
// player's own next turn
function skipReached(skip, gv, slot) {
  const at = SKIP_ORDER.indexOf(gv.step), first = SKIP_ORDER.indexOf(SKIP_PHASES[skip.phase][0]);
  if (skip.phase === "mine") return gv.activePlayerId === slot && gv.turn > skip.turn;
  return at >= first && (gv.turn > skip.turn || SKIP_ORDER.indexOf(skip.step) < first);
}
// tells the table what this player's Auto-resolve list is set to: a skip's phase, or on / off (the bridge passes, so the
// table only shows it; a skip ends here, not there)
function autoNotice(seat) {
  toTTS({ t: "autostate", color: seat.color, phase: seat.skipTo?.phase || "", on: !!autoResolve[seat.color] });
}
const STOP_STEPS = {
  start: ["upkeep", "draw"],
  combat: ["combatBegin", "combatDeclareAttackers", "combatDeclareBlockers", "combatFirstStrikeDamage", "combatDamage", "combatEnd"],
  end: ["end", "endOfTurn", "cleanup"],
};

// "{G}" / "2{C} {R}": the mana an ability makes ("" when the engine doesn't say).
// (the symbol repeated, as Arena shows it: "Tap Elvish Archdruid for {G}{G}", not "2{G}", hp-25 T14; a big amount as a number)
function manaLabel(a) {
  return (a.producedMana || []).map((pm) => (pm.amount > 1 && pm.amount <= 6 ? `{${pm.color}}`.repeat(pm.amount) : `${pm.amount > 1 ? pm.amount : ""}{${pm.color}}`)).join(" ");
}

// Which mana a payment button gives: City of Brass offers five buttons that all said "Tap City of Brass".
// A cost paid with a permanent or a card instead of mana (the protocol's useResource / releaseResource): said with what
// it pays. "Tap Consuming Sepulcher" for Improvise read like a mana ability, and Power Depot was listed twice the same
// way (hp-12 re-test 2026-10-27).
const RESOURCE_WORDS = {
  improvise: (n) => `Tap ${n} (Improvise: pays {1})`,
  convoke: (n) => `Tap ${n} (Convoke: pays {1} or one mana of its colour)`,
  delve: (n) => `Exile ${n} from your graveyard (Delve: pays {1})`,
  waterbend: (n) => `Tap ${n} (Waterbend: pays {1})`,
};
// A text change's word questions (Mind Bend, Sleight of Mind, Artificial Evolution, Magical Hack ...): Forge asks
// "choose one: Change color | Change type", then "choose a color" (or "a basic land", "a creature type") twice, the
// word replaced and the new one, with the same title (hp-25 T1-T4 2026-10-27). Said what each is; the target's own
// words first in the list (Goblin among ~350 creature types). Returns a function to call with the answer's labels, or
// null when the question isn't one of these.
const TEXT_WORD_KINDS = [[/choose a basic land$/i, "basic land type"], [/choose a colou?r$/i, "colour word"], [/choose a creature type$/i, "creature type"]];
function textChangeQuestion(seat, ui, src, prompt, gv, byId) {
  const words = String(prompt.sourceAbilityText || prompt.sourceCard?.text || byId[prompt.sourceCard?.id]?.text || "");
  if (!src || !/\bchange the text\b/i.test(words)) return null;
  const targetText = textTargetOf(gv, byId, prompt);
  const labels = (ui.options || []).map((o) => String(o.label));
  if (labels.length === 2 && labels.includes("Change color") && labels.includes("Change type")) {
    ui.title = `${src}: change which kind of word?`;
    ui.options = ui.options.map((o) => ({ ...o, label: o.label === "Change color" ? "A colour word" : "A basic land type" }));
    return null;
  }
  const kind = TEXT_WORD_KINDS.find(([re]) => re.test(String(ui.title || "")))?.[1];
  if (!kind) return null;
  const last = seat.textWord;
  // (the very next question from the same card: Forge asks the two back to back; a cast cancelled after the first
  // leaves no pairing for a later one, suite review 2026-10-27)
  const second = last && last.src === src && last.kind === kind && Number(prompt.promptId) - last.pid > 0 && Number(prompt.promptId) - last.pid <= 3;
  if (second) {
    ui.title = `${src}: replace ${last.word} with which ${kind}?`;
    return () => { seat.textWord = null; };
  }
  ui.title = `${src}: replace which ${kind}?`;
  // (a whole word, or with "s" / "walk": "Goblin" in "Other Goblins", "Swamp" in "swampwalk"; not "Mount" in
  // "mountainwalk"); the rest A-Z, colours in their W U B R G order
  const txt = String(targetText || "");
  if (ui.options) {
    const word = (o) => escapeRe(String(o.label).replace(/ \(needed\)$/, ""));
    const mine = (o) => !!txt && new RegExp(`\\b${word(o)}(?:s|walk)?\\b`, "i").test(txt);
    const rest = ui.options.filter((o) => !mine(o));
    if (kind !== "colour word") rest.sort((x, y) => String(x.label).localeCompare(String(y.label)));
    ui.options = [...ui.options.filter(mine), ...rest];
    ui.keepOrder = true;
  }
  return (chosen) => { seat.textWord = { src, kind, word: chosen[0], pid: Number(prompt.promptId) }; };
}

// The text of what the asking spell or ability targets (from its stack item), for textChangeQuestion.
function textTargetOf(gv, byId, prompt) {
  const st = (gv.stack || []).find((s) => s.sourceId && s.sourceId === prompt.sourceCard?.id);
  return (st?.targets || []).map((t) => byId[t.id]).filter(Boolean)
    .map((c) => [c.text, (c.subtypes || []).join(" "), (c.keywords || []).join(" ")].join(" ")).join(" ");
}

// The kind a spell's text names (Improvise, Convoke, Delve, Waterbend), or null.
function resourceKindOf(text) {
  return Object.keys(RESOURCE_WORDS).find((k) => new RegExp(`\\b${k}\\b`, "i").test(String(text))) || null;
}
// A tap our Forge build offers for such a cost: a "mana ability" with no cost, no mana made and no ability number
// (live: { id: "tap:engine-card-8", type: "activateManaAbility", description: "Consuming Sepulcher" }).
function isResourceTap(a) {
  return a.type === "activateManaAbility" && !a.cost && !(a.producedMana || []).length && /^tap:[^:]+$/.test(String(a.id || ""));
}
function resourceLabel(a, name) {
  const words = Object.hasOwn(RESOURCE_WORDS, a.resource) ? RESOURCE_WORDS[a.resource](name) : `Use ${name} (${a.resource || "payment"})`;
  return a.type === "releaseResource" ? `Undo: ${words}` : words;
}

function payManaText(a) {
  const pm = manaLabel(a);
  if (pm) return ` for ${pm}`;
  const c = String(a.id || "").match(/:([WUBRGC])$/);
  return c ? ` for {${c[1]}}` : "";
}
// what a mana ability costs besides tapping, said with it: Arena of Glory's "{T}, {R}, Exert CARDNAME" read "Tap Arena of
// Glory for {R}{R}" beside its plain {R}, hp-09 gap; a cost with no tap is the whole cost ("Use Simian Spirit Guide for {R}
// (exile it from your hand)")
function manaCostExtra(a) {
  const parts = String(a.cost || "").split(/,\s*/).filter(Boolean);
  const extra = parts.filter((p) => p !== "{T}").map((p) => p.replace(/\bCARDNAME\b/g, "it").replace(/^[A-Z]/, (x) => x.toLowerCase()));
  return extra.length ? ` (${parts.includes("{T}") ? "also " : ""}${extra.join(", ")})` : "";
}

// How much a payment button helps the cost still to pay: 2 = it makes a colour a coloured symbol needs, 1 = it can
// only go toward the generic part, 0 = no use (turning City of Brass for {W} while {B} is due just asked again: the
// table used a land's first button, so it re-asked hundreds of times in the hand-play sweep, 2026-10-21).
// The colours a mana cost asks for, by name ("{1}{B}" -> Black; hybrid "{W/U}" -> White and Blue).
const COLOR_NAMES = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
function colorsNeeded(cost) {
  const need = new Set();
  for (const [, sym] of String(cost || "").matchAll(/\{([^}]+)\}/g))
    for (const x of sym.toUpperCase().split("/")) if (COLOR_NAMES[x]) need.add(COLOR_NAMES[x]);
  return need;
}

// What a cost still asks for once the mana already in the pool is used ("{1}{U}{B}" with {U} floating -> "{1}{B}"):
// Forge's payment question repeats the full cost, so ranking against it took City of Brass for {U} again (the first of
// two equal ranks) and the {B} was never paid; a hand-play game looped on it 1,600 times (2026-10-22 review).
function costLeft(cost, pool) {
  const left = { ...(pool || {}) };
  const syms = [...String(cost || "").matchAll(/\{([^}]+)\}/g)].map((m) => m[1].toUpperCase());
  const take = (c) => { if ((left[c] || 0) > 0) { left[c] -= 1; return true; } return false; };
  const keep = [];
  for (const x of syms) if (!(/^[WUBRGC]$/.test(x) && take(x))) keep.push(x); // exact colours first
  const keep2 = [];
  for (const x of keep) if (!(x.includes("/") && x.split("/").some((p) => /^[WUBRGC]$/.test(p) && take(p)))) keep2.push(x); // then hybrid halves
  let spare = Object.values(left).reduce((n, v) => n + Math.max(0, Number(v) || 0), 0);
  const out = [];
  for (const x of keep2) {
    if (/^\d+$/.test(x)) { const n = Math.max(0, Number(x) - spare); spare -= Number(x) - n; if (n) out.push(`{${n}}`); }
    else out.push(`{${x}}`);
  }
  return out.join("") || "{0}";
}

function manaRank(cost, a) {
  const made = new Set((a.producedMana || []).map((m) => String(m.color || "").toUpperCase()));
  const c = String(a.id || "").match(/:([WUBRGC])$/);
  if (!made.size && c) made.add(c[1]);
  if (!made.size || made.has("ANY")) return 1;
  let generic = false, needed = false;
  for (const [, sym] of String(cost || "").matchAll(/\{([^}]+)\}/g)) {
    const parts = sym.toUpperCase().split("/");
    if (parts.some((x) => made.has(x))) needed = true;
    else if (parts.some((x) => /^\d+$/.test(x) || x === "X")) generic = true;
  }
  return needed ? 2 : generic ? 1 : 0;
}

// Buttons that would read the same say what else they do: Llanowar Wastes offered "{G}" twice (its own "{B} or {G}"
// that deals 1 damage, and a plain "{T}: Add {G}" from Yavimaya, Cradle of Growth). The extra is the ability's text
// without its cost and its "Add ..." sentence ("Llanowar Wastes deals 1 damage to you"), or "nothing else".
function distinctLabels(acts, label) {
  const base = acts.map(label);
  const count = {};
  for (const b of base) count[b] = (count[b] || 0) + 1;
  return base.map((b, i) => {
    if (count[b] < 2) return b;
    const rest = String(acts[i].description || "").replace(/^[^:]*:\s*/, "").replace(/Add [^.]*\.\s*/i, "").trim().replace(/\.$/, "");
    return `${b} (${rest || "nothing else"})`;
  });
}

// "End turn" pressed this turn: priority passes and the attack is skipped until the turn number changes; from another
// turn it is forgotten. One check for both (structural review 2026-10-27: it was written twice).
function endTurnHolds(seat, gv) {
  if (seat.endTurnAt != null && seat.endTurnAt === gv.turn) return true;
  seat.endTurnAt = null;
  return false;
}
function onPrompt(seat, prompt) {
  seat.lastRawPrompt = prompt;
  if (prompt.input?.type === "chooseAction") seat.priorityPromptId = prompt.promptId ?? 0; // (the log's "priority came back")
  // MTG_RAW=1 (tests): every question as the engine sent it, to see what a prompt carries
  if (process.env.MTG_RAW) log(`raw ${seat.color}: ${JSON.stringify(prompt).slice(0, 4000)}`);
  if (prompt.kind === "priority") { seat.respond(0, "chooseAction", { type: "pass" }); return; }
  const input = prompt.input || {};
  const type = input.type;
  const gv = seat.board?.state?.gameView || {};
  const byId = cardIndex(gv);
  // (a face-down card of someone else's asks under no name: the ward question of the AI's cloaked Garruk's Companion read
  // "Garruk's Companion has ward: pay {2}" and "Pay {2} for Garruk's Companion", hp-20 gap)
  const fdSrc = prompt.sourceCard && (prompt.sourceCard.isFaceDown || byId[prompt.sourceCard.id]?.isFaceDown);
  if (fdSrc && (prompt.sourceCard.controllerId ?? byId[prompt.sourceCard.id]?.controllerId) !== seat.slot) {
    prompt = { ...prompt, sourceCard: { ...prompt.sourceCard, identity: { ...prompt.sourceCard.identity, name: "A face-down creature" }, text: "" } };
  }
  // (the asking card's rules text, from the prompt or the board: "" when neither has it)
  const srcCardText = String(prompt.sourceCard?.text || byId[prompt.sourceCard?.id]?.text || "");
  // (a spell or ability on the stack by its name and whose it is: Counterspell's target read "engine-stack-56", hp-01 #4)
  const onStack = (id) => (gv.stack || []).find((s) => s.id === id);
  // (spell or ability as the log tells them: Forge gives an instant its text too, so "Lightning Bolt (AI 1's ability)")
  const stackName = (s) => `${s.identity?.name || "a face-down spell"} (${s.controllerId === seat.slot ? "your" : `${nameOf(s.controllerId)}'s`} ${isAbilityOnStack(s, gv) ? "ability" : "spell"})`;
  // (a spell copy is a card in no zone, offered as a target by its card id: by its stack item, "Flusterstorm (your spell)";
  // Flusterstorm's storm copies read "engine-card-146", hp-08 gap)
  // (and a card gone from every zone by the name it had: a Treasure sacrificed while paying read "Undo mana from
  // engine-card-143", hp-13 gap)
  const cname = (id) => { if (byId[id]?.identity?.name) return byId[id].identity.name; if (id?.startsWith("player-")) return nameOf(id); const s = onStack(id) || (gv.stack || []).find((x) => x.sourceId === id); return s ? stackName(s) : game?.namesSeen?.get(id) || id; };
  const src = prompt.sourceCard?.identity?.name;
  // (no title of its own: a plain one, never the engine's question type, "chooseFromSelection")
  const title = input.presentation?.title || { chooseFromSelection: "Choose", chooseCards: "Choose", chooseBoardTargets: "Choose a target", chooseNumber: "Choose a number", chooseColor: "Choose a color", chooseBoolean: "Yes or no?", revealCards: "Revealed", reorder: "Put these in order" }[type] || type;
  let ui;
  let toOutput;
  if (type !== "payManaCost") { seat.autoPayFailedFor = null; }
  if (type !== "chooseBoolean") seat.cardsDone = null; // (only the question right after counts)
  // the cost being paid, for a "Choose a color" from a source tapped while paying (Command Tower)
  if (type === "payManaCost") seat.payingCost = input.manaCost || null;
  else if (type !== "chooseColor") seat.payingCost = null;
  const opts = (list) => list.map((o, i) => ({ id: String(o.id ?? i), label: o.label }));

  switch (type) {
    case "mulligan":
      // (Arena: "Keep" / "Mulligan"; how many were taken goes below, not in the question)
      ui = { title: "Keep this hand?", mode: "single", options: [{ id: "keep", label: "Keep" }, { id: "mull", label: "Mulligan" }],
        ...(input.mulliganCount ? { text: `Mulligans so far: ${input.mulliganCount}.` } : {}) };
      toOutput = (a) => ({ type: "mulliganDecision", keep: a[0] === "keep" });
      break;
    case "mulliganPutBack":
      ui = { title: `Put ${countWords(input.count, input.count, "card")} on the bottom of your library`, mode: "multi", min: input.count, max: input.count,
        options: input.handCardIds.map((id) => ({ id, label: cname(id) })) };
      toOutput = (a) => ({ type: "mulliganPutBackDecision", cardIds: a });
      break;
    case "chooseAction": {
      const actions = (input.actions || []).filter((a) => a.type !== "undoMana" && !a.isManaAbility);
      if (process.env.MTG_TRACE) {
        const special = actions.filter((a) => (a.type === "cast" && a.mode?.type && a.mode.type !== "normal") || (a.type === "activateAbility" && /ninjutsu|web/i.test(a.description || "")));
        if (special.length) log(`special actions ${seat.color} (${gv.step}): ${special.map((a) => `${a.label || a.description} ${JSON.stringify(a.mode || {})}`).join(" | ")}`);
      }
      if (holdForFix(seat, prompt, gv)) return;
      // a spell or ability dragged while it wasn't this player's priority (during their blockers question, or while
      // someone else held priority): used now, at the first priority it can be (playtest 2026-10-24: Blue dragged
      // Galadriel's Dismissal while blocking, was told "wait", and combat passed by without asking)
      if (seat.queuedPlay) {
        const q = seat.queuedPlay;
        let act = Date.now() - q.at < QUEUED_PLAY_MS && actions.find((a) => a.cardId === q.id && a.type !== "undoMana" && !a.isManaAbility);
        if (Date.now() - q.at >= QUEUED_PLAY_MS) seat.queuedPlay = null;
        if (act && act.type === "cast" && sacrificedIfInstant(cardIndex(gv)[q.id]) && !sorceryTime(seat, gv)) {
          seat.queuedPlay = null;
          act = null;
          chat(`[MTG] ${cname(q.id)} not cast: cast now, it would be sacrificed at the next cleanup step. Cast it in your main phase, or drag it again to cast it anyway.`, seat.color);
        }
        if (act) {
          seat.queuedPlay = null;
          log(`${seat.color}: casting the queued ${cname(q.id)}`);
          seat.respond(prompt.promptId, type, { type: "act", actionId: act.id });
          if (seat.prompt) closePrompt(seat);
          return;
        }
      }
      // "End turn": keep passing until the turn number changes (blocks, targets etc. still stop you).
      if (endTurnHolds(seat, gv)) {
        seat.respond(prompt.promptId, type, { type: "pass" });
        return;
      }
      // "Resolve the stack": keep passing while only what was there when you asked is left; anything new stops it
      const stackIds = (gv.stack || []).map((x) => x.id);
      if (seat.resolveStack) {
        const onlyOld = stackIds.length > 0 && stackIds.every((id) => seat.resolveStack.has(id));
        if (onlyOld) { seat.respond(prompt.promptId, type, { type: "pass" }); return; }
        seat.resolveStack = null;
      }
      // Your own main phase waits for you when you can do something there (Pass / End turn); with nothing to do it
      // passes by itself, like Arena (see worthStopping).
      const myMain = gv.activePlayerId === seat.slot && /main/i.test(gv.step || "");
      // Arena-style stops: besides your main phases, you only get asked when an opponent put something on the
      // stack you could answer, or in a step you switched a stop on for (panel: Start of turn / Combat / End of turn).
      const opponentsStack = (gv.stack || []).some((x) => x.controllerId !== seat.slot);
      const stepStop = [...(seat.stops || DEFAULT_STOPS)].some((group) => (STOP_STEPS[group] || []).includes(gv.step));
      // your own spell waiting to resolve in your main phase passes by itself, like Arena
      // and your own main phase only when you can actually do something there (Arena passes it otherwise)
      // ninjutsu (and sneak) only work after blockers are declared (Forge skips that step when nobody can block, so the
      // damage steps count too): always stop there when you can use one, even with
      // the Combat stop off (otherwise Arena-style passing skipped the only moment it is allowed)
      // someone is attacking and you could respond: asked after attackers and after blockers are declared, as Arena does
      // when you hold an instant (playtest 2026-10-24: with the Combat stop off, Blue's Galadriel's Dismissal never got
      // the chance while Yellow attacked)
      const attacking = (gv.zones || []).some((z) => z.zone === "battlefield" && (z.cards || []).some((c) => c.isAttacking));
      const combatStop = gv.activePlayerId !== seat.slot && attacking && ["combatDeclareAttackers", "combatDeclareBlockers"].includes(gv.step);
      const ninjaStop = ["combatDeclareBlockers", "combatFirstStrikeDamage", "combatDamage"].includes(gv.step) && actions.some((a) =>
        (a.type === "activateAbility" && /ninjutsu/i.test(`${a.description || ""} ${a.label || ""}`)) ||
        (a.type === "cast" && a.mode?.type === "alternative" && a.mode.cost === "sneak"));
      // "mtg skip <phase>": passed until that phase; an opponent's spell or ability on the stack ends it there (see
      // SKIP_PHASES). Questions other than priority (targets, blocks, discards) are still asked.
      let skipStop = false;
      if (seat.skipTo) {
        const theirs = (gv.stack || []).find((x) => x.controllerId !== seat.slot);
        if (theirs || skipReached(seat.skipTo, gv, seat.slot)) {
          chat(`[MTG] Skip ended: ${theirs ? `${theirs.identity?.name || "something"} (${nameOf(theirs.controllerId)}) is on the stack` : `${REWIND_STEPS[gv.step] || gv.step}, ${gv.activePlayerId === seat.slot ? "your" : `${nameOf(gv.activePlayerId)}'s`} turn`}.`, seat.color);
          seat.skipTo = null;
          autoNotice(seat);
          skipStop = true; // (stopped there, whatever the step stops say)
        } else {
          seat.respond(prompt.promptId, type, { type: "pass" });
          if (seat.prompt) closePrompt(seat);
          return;
        }
      }
      // Auto-resolve: someone else's turn, so pass (your own turn still asks as usual)
      if (autoResolve[seat.color] && gv.activePlayerId !== seat.slot) {
        seat.respond(prompt.promptId, type, { type: "pass" });
        if (seat.prompt) closePrompt(seat);
        return;
      }
      // mana you tapped for and haven't spent can be taken back (the engine's undo for that source): you are always
      // asked then, so the land can be turned back instead of the mana being lost (playtest 2026-10-23: "I gotta be
      // able to untap without the full undo")
      const undos = (input.actions || []).filter((a) => a.type === "undoMana" && a.cardId);
      // "mtg hold": priority kept once this turn with something on the stack you could respond with: your own spell
      // passed by itself in your main phase, so Flusterstorm on your own Bolt had no moment (2026-10-29 request)
      const holdStop = seat.hold === gv.turn && (gv.stack || []).length > 0 && actions.length > 0;
      if (holdStop) seat.hold = null;
      const worthStopping = (myMain && !(gv.stack || []).length && actions.length > 0) || (actions.length && (opponentsStack || stepStop || ninjaStop || combatStop))
        || undos.length > 0 || skipStop || holdStop;
      // what a stop on someone else's spell offered (to see why "Resolve" came up)
      if (worthStopping && opponentsStack) log(`${seat.color} may respond to the stack with: ${actions.map((a) => a.label || a.description || a.id).join(" | ") || "(nothing)"}`);
      if (!worthStopping) {
        seat.respond(prompt.promptId, type, { type: "pass" });
        if (seat.prompt) closePrompt(seat);
        return;
      }
      // the way a spell is cast (web-slinging, flashback, back face, ...) and identical labels numbered
      const castLabel = (a) => {
        const m = a.mode || {};
        const how = m.type === "alternative" ? String(m.cost || "alternative cost").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
          : m.type === "backFaceLand" ? "back face" : m.type === "roomRightSplit" ? "right door" : m.type === "unlockDoor" ? "unlock door"
          : m.type === "foretellExile" ? "foretell (exile it face down)" : m.type === "staticAlternative" ? "alternative cost" : "";
        // the engine's own label already names the mode in brackets ("(WebSlinging)"): keep one readable version
        const base = how ? String(a.label || `Cast ${cname(a.cardId)}`).replace(/\s*\([A-Za-z]+\)$/, "") : (a.label || `Cast ${cname(a.cardId)}`);
        return `${base}${how ? ` — ${how}` : ""}`;
      };
      // mana abilities of creatures and artifacts (Delighted Halfling, mana rocks) as buttons; lands stay on Q/E
      const manaButtons = (input.actions || []).filter((a) => a.isManaAbility && a.cardId && !(byId[a.cardId]?.types || []).includes("Land"));
      // identical copies (four Forests) show once; several ways to cast the SAME card are numbered
      const labelCount = {}, labelCard = {};
      const numbered = (label, cardId) => {
        if (labelCard[label] !== undefined && labelCard[label] !== cardId) return null;
        labelCard[label] = cardId;
        labelCount[label] = (labelCount[label] || 0) + 1;
        return labelCount[label] > 1 ? `${label} (option ${labelCount[label]})` : label;
      };
      // (Arena's pass button: "Resolve" while something is on the stack, "Next" otherwise; "Resolve all" passes until
      // the stack is empty)
      ui = { title: "Your priority", mode: "single", options: [{ id: "__pass", label: stackIds.length ? "Resolve" : "Next" },
        ...(stackIds.length ? [{ id: "__resolve", label: `Resolve all (${stackIds.length})` }] : []),
        { id: "__endturn", label: "End turn" }, ...actions.map((a) => ({
        id: a.id, cardId: a.cardId, label: numbered(a.type === "cast" ? castLabel(a) : `${cname(a.cardId) || a.label || "Ability"}: ${a.description || "ability"}`, a.cardId),
        // (the ability alone, for the card's own buttons and menu: the table cut the name back off the label in two
        // places, structural review 2026-10-27)
        ...(a.type === "activateAbility" ? { ab: displayText(a.description || "ability") } : {}),
      })).filter((o) => o.label !== null), ...[...new Set(manaButtons.map((a) => a.cardId))].map((cid) => ({ id: `__mana:${cid}`, cardId: cid,
        label: `Mana: tap ${cname(cid)}` })), ...undos.map((a) => ({ id: a.id, cardId: a.cardId, label: `Untap ${cname(a.cardId)} (mana back)` }))] };
      toOutput = (a) => (a[0] === "__pass" ? { type: "pass" } : a[0] === "__endturn" ? (seat.endTurnAt = gv.turn, { type: "pass" })
        : a[0] === "__resolve" ? (seat.resolveStack = new Set(stackIds), { type: "pass" })
        : String(a[0]).startsWith("__mana:") ? manaChoice(String(a[0]).slice(7)) : { type: "act", actionId: a[0] });
      // one button per mana creature/artifact; if it can make several kinds of mana, the next step asks which
      const manaText = (m) => manaLabel(m) || m.description || "mana";
      const manaChoice = (cid) => {
        const acts = manaButtons.filter((m) => m.cardId === cid);
        if (acts.length === 1) return { type: "act", actionId: acts[0].id };
        return next({ title: `Tap ${cname(cid)} for which mana?`, mode: "single", kind: "choice",
          options: distinctLabels(acts, manaText).map((label, i) => ({ id: acts[i].id, label })) }, (b) => ({ type: "act", actionId: b[0] }));
      };
      break;
    }
    case "payManaCost":
      // Three seat fields about paying, kept apart on purpose (merging them changed behaviour, see
      // docs/reviews/structural-review-bridge-2026-10-20.md #2): autoPayCard = auto-pay asked for this card,
      // tappedFor = a source tapped by hand for it, autoPayFailedFor = auto-pay already failed for it (survives a tap).
      // Auto-pay fills the mana pool, then the engine asks to confirm: do that for the player.
      // Same after the player tapped the last source by hand: the cost is covered, so finish paying (like Arena). And
      // for a spell or ability the player just started while mana floats: Arena pays from the pool by itself (every
      // cast asked "Pay from mana pool", playtest 2026-10-26). A cost for someone else's card (a tax, ward) still asks.
      // (only for a payment that names its card: two missing ids are not "the same card", stage 3 review 2026-10-27)
      const ownJustNow = seat.justDid("start", 60000)?.id === input.cardId;
      // (not when life can pay part of it: a Phyrexian {B/P} is the player's choice, and Vraska's Compleated paid with
      // floating mana never offered the life, hp-22 #1 2026-10-28)
      const canPayLife = (input.actions || []).some((a) => a.type === "payLife" || a.id === "pay-life");
      if (input.cardId && (seat.autoPayCard === input.cardId || seat.tappedFor === input.cardId || ownJustNow) && input.canConfirmFromPool && !canPayLife) {
        seat.autoPayCard = null;
        seat.tappedFor = null;
        seat.forget("start");
        seat.respond(prompt.promptId, type, { type: "pay", auto: false });
        return;
      }
      // Auto-pay already ran for this spell and the engine still asks: don't offer it again (it would loop).
      const autoFailed = seat.autoPayCard === input.cardId || seat.autoPayFailedFor === input.cardId;
      seat.autoPayFailedFor = autoFailed ? input.cardId : null;
      seat.autoPayCard = null;
      // When the pool already covers the cost the engine waits for "pay from pool"; asking it to auto-pay
      // again would just repeat this prompt, so that becomes the first (default) button.
      // (a land that can pay two needed colours pays the one no other source here offers: with Urborg, a Forest can
      // make {B} or {G}; for {B}{G} it made {B}, the Swamp {B} too, and nothing was left for {G}, 2026-10-22)
      const madeBy = (a) => {
        const set = new Set((a.producedMana || []).map((m) => String(m.color || "").toUpperCase()));
        const c = String(a.id || "").match(/:([WUBRGC])$/);
        if (!set.size && c) set.add(c[1]);
        return set;
      };
      const payActs = (input.actions || []).filter((a) => a.type !== "undoMana");
      const pool = gv.players?.find((p) => p.id === seat.slot)?.manaPool || {};
      const owed = costLeft(input.manaCost, pool);
      seat.payingCost = owed; // (for a "Choose a color" that comes next: Command Tower)
      const rankOf = (a) => {
        const r = manaRank(owed, a);
        if (r < 2) return r;
        const others = payActs.filter((o) => o.cardId !== a.cardId && manaRank(owed, o) > 0);
        return [...madeBy(a)].some((col) => !others.some((o) => madeBy(o).has(col))) ? 3 : 2;
      };
      // a Phyrexian cost paid with life (our Forge build's "pay-life"): said as such and offered before the taps that
      // can't pay it (it read "pay-life", last, under "Tap Swamp for {B}" for Skrelv's {W/P}, playtest 2026-10-27)
      // (the protocol's PaymentAction { type: "payLife", amount }, manabrew protocol-types.json)
      const lifeAct = (input.actions || []).find((a) => a.type === "payLife" || a.id === "pay-life");
      const lifeN = lifeAct && Number.isFinite(Number(lifeAct.amount)) ? Number(lifeAct.amount) : null;
      // (which kind of tap pays for this spell, from its rules text: our Forge build sends Improvise's taps as mana
      // abilities with no cost and no mana, not the protocol's useResource, hp-12 re-test 2026-10-27)
      const payKind = resourceKindOf(byId[input.cardId]?.text || game?.cardText?.[input.cardId] || "");
      ui = { title: `Pay ${input.manaCost}${input.cardName || src ? ` for ${input.cardName || src}` : ""}`, mode: "single", options: [
        ...(input.canConfirmFromPool ? [{ id: "__pool", label: "Pay from mana pool" }] : autoFailed ? [] : [{ id: "__auto", label: "Auto-pay" }]),
        ...(lifeAct ? [{ id: lifeAct.id || "pay-life", label: `Pay ${lifeN ?? 2} life` }] : []),
        ...(input.actions || []).filter((a) => a !== lifeAct).map((a) => ({ id: a.id, cardId: a.cardId, label: a.type === "undoMana" ? `Undo mana from ${cname(a.cardId)}`
          : a.type === "useResource" || a.type === "releaseResource" ? resourceLabel(a, cname(a.cardId))
          : payKind && isResourceTap(a) ? resourceLabel({ ...a, type: "useResource", resource: payKind }, a.description || cname(a.cardId))
          : a.description ? `${!a.cost || /\{T\}/.test(a.cost) ? "Tap" : "Use"} ${a.description}${payManaText(a)}${manaCostExtra(a)}` : a.id, ...(a.type === "undoMana" ? {} : { rank: rankOf(a) }) })),
        { id: "__cancel", label: "Cancel" },
      ] };
      if (autoFailed && !input.canConfirmFromPool) ui.text = "Auto-pay couldn't finish this payment. Tap other sources, undo some taps, or Cancel.";
      toOutput = (a) => {
        // remember a hand tap so the next prompt can finish paying by itself; any other answer forgets it
        seat.tappedFor = String(a[0]).startsWith("tap:") ? input.cardId : null;
        // (the stack showed it, so the log said "casts" and nothing took that back: Silvergill Adept, hp-24 gap)
        if (a[0] === "__cancel" && game?.log?.slice(-12).includes(`${seat.color} casts ${input.cardName || src}`)) gameLogLine(`${seat.color} cancels ${input.cardName || src}`);
        return a[0] === "__auto" ? (seat.autoPayCard = input.cardId, { type: "pay", auto: true }) : a[0] === "__pool" ? { type: "pay", auto: false }
          : a[0] === "__cancel" ? { type: "cancel" } : { type: "act", actionId: a[0] };
      };
      break;
    case "chooseBoardTargets": {
      // (the creature an equipment was dropped onto: see the "attach" intent)
      const att = seat.attachTo;
      if (att && Date.now() - att.at < 30000 && input.candidates.some((c) => c.id === att.to) && (!prompt.sourceCard?.id || prompt.sourceCard.id === att.source)) {
        seat.attachTo = null;
        seat.respond(prompt.promptId, type, { type: "boardTargets", chosen: [{ kind: "card", id: att.to }] });
        return;
      }
      // Forge asks again for a spell's next target with the whole spell's range ("1 to 2 targets") and how many are
      // chosen so far: what is still needed is the rest, so an optional extra target can be skipped with Done (Fire's
      // second target, playtest 2026-10-26: Done did nothing)
      const chosen = Number(input.chosenTargets) || 0;
      const minLeft = Math.max(0, (Number(input.minTargets) || 0) - chosen), maxLeft = Math.max(1, (Number(input.maxTargets) || 1) - chosen);
      // The player answered the whole question at once (one or more picks, then Done); Forge takes them one at a time and
      // asks "another target?" after each. Send the picks it hasn't taken, then Done, for them (Riverchurn's "up to 2
      // players": Done had to be pressed twice, hp-07 #38 2026-10-27). Only for the same card, while the count matches.
      const sent = seat.targetPicks;
      if (chosen > 0 && sent && sent.src && Date.now() - sent.at < 30000 && sent.src === prompt.sourceCard?.id && chosen <= sent.ids.length) {
        const rest = sent.ids.slice(chosen).filter((v) => input.candidates.some((c) => `${c.kind}|${c.id}` === v));
        if (rest.length || minLeft === 0) {
          if (!rest.length) seat.targetPicks = null; // (kept until the last follow-up, Done, is answered too)
          seat.respond(prompt.promptId, type, { type: "boardTargets", chosen: rest.slice(0, maxLeft).map((v) => { const [kind, id] = v.split("|"); return { kind, id }; }) });
          return;
        }
      }
      seat.targetPicks = null;
      const kinds = input.candidates.map((c) => byId[c.id]?.types || []);
      const all = (t) => kinds.length > 0 && kinds.every((k) => k.includes(t));
      const noun = all("Land") ? "land" : all("Creature") ? "creature" : "permanent";
      // (no asking card: a copy's new target, "You may choose new targets for the copy"; named by the player's own spell
      // on the stack whose card is in no zone, a copy: Flusterstorm's storm copies read "Choose a target to counter", hp-08)
      // (the newest such spell, gv.stack running oldest first: Flusterstorm's copy on your own Bolt read "Copy of Lightning Bolt", re-test 2026-10-30)
      const copy = !src && [...(gv.stack || [])].reverse().find((s) => s.controllerId === seat.slot && !isAbilityOnStack(s, gv) && !byId[s.sourceId]);
      // (or by the effect on the stack that makes it, "Eternal Dominion (5)'s Effect": epic's upkeep copy read "Choose a player
      // to search their library", no card named, hp-23 gap)
      const effectOf = !src && !copy && (gv.stack || []).map((s) => String(s.identity?.name || "").match(/^(.+?)(?: \(\d+\))?'s Effect$/)?.[1]).find(Boolean);
      const unnamed = copy ? `Copy of ${copy.identity?.name}` : effectOf;
      ui = { title: unnamed ? `${unnamed}: ${targetTitle(title, src, minLeft, maxLeft, noun).replace(/^C/, "c")}` : targetTitle(title, src, minLeft, maxLeft, noun),
        mode: "multi", min: minLeft, max: maxLeft, cancel: input.cancellable,
        // (a copy offered as a target before it reaches the stack has no name yet: its original's, not "engine-card-144", re-test 2026-10-30)
        options: input.candidates.map((c) => ({ id: `${c.kind}|${c.id}`, label: cname(c.id) === c.id && copy ? `${copy.identity?.name} (the copy)` : cname(c.id),
          // a target inside a graveyard/exile pile has no card of its own on the table to click: give it a picture, so
          // the table shows it in the card row (Emry's "target artifact card in your graveyard", 2026-10-21 sweep)
          ...((gv.zones || []).some((z) => (z.zone === "graveyard" || z.zone === "exile") && z.cards.some((x) => x.id === c.id)) ? { img: imgOf(byId[c.id]) } : {}) })) };
      // (a modal spell's chosen modes, which Forge adds after its list and a blank line: Collective Resistance's
      // hexproof target read "choose a target", hp-21)
      const chosenModes = String(prompt.sourceAbilityText || "").match(/•[^]*?\r?\n\r?\n\s*([^]+)$/)?.[1];
      const targetWords = chosenModes || prompt.sourceAbilityText || srcCardText;
      // (a mutating spell's own target, asked while it is cast: Gemrazer's read "destroy which artifact or enchantment an
      // opponent controls?", its mutate trigger's sentence, hp-09)
      const mutateOnto = !prompt.sourceAbilityText && String(prompt.sourceCard?.text || "").match(/^Mutate\b[^(\n]*\(If you cast this spell for its mutate cost, put it over or under target ([^.]+?)\./im)?.[1];
      const srcOnBattlefield = (gv.zones || []).some((z) => z.zone === "battlefield" && (z.cards || []).some((x) => x.id === prompt.sourceCard?.id));
      let why = src && /^choose (?:a|an|up to 1) target(?: to [a-z ]+)?$/i.test(ui.title)
        ? (mutateOnto && !srcOnBattlefield ? `mutate onto which ${mutateOnto}?`
          // (the chosen modes, one a line after Forge's list, read as modes too: Collective Resistance's three read "choose
          // a target to destroy", hp-21 gap)
          : modeTargetQuestion(chosenModes ? chosenModes.split(/\r?\n/).filter((l) => l.trim()).map((l) => `• ${l.trim().replace(/^•\s*/, "")}`).join("\n") : prompt.sourceAbilityText || srcCardText, input.candidates, byId, seat.slot)
            || purposeOf(targetWords, "target")) : null;
      // (two target sentences: the one the candidates fit, yours or not yours; Bridgeworks Battle's "Target creature you
      // control gets +2/+2 ... Then it fights up to one target creature you don't control" read "choose a target", hp-04 #2)
      if (!why && src && /^choose (?:a|an|up to 1) target(?: to [a-z ]+)?$/i.test(ui.title)) {
        const ctl = (c) => byId[c.id]?.controllerId;
        const mineOnly = input.candidates.length > 0 && input.candidates.every((c) => ctl(c) === seat.slot);
        const theirsOnly = input.candidates.length > 0 && input.candidates.every((c) => ctl(c) && ctl(c) !== seat.slot);
        const fit = String(targetWords || "").split(/(?<=\.)\s+/).filter((x) => /\btarget\b/i.test(x))
          .filter((x) => (mineOnly ? /\btarget [^.]*\byou control\b/i.test(x) : theirsOnly ? /\b(?:you don't control|an opponent controls)\b/i.test(x) : false));
        if (fit.length === 1) why = purposeOf(fit[0], "target");
      }
      // (a sentence that starts with the card's own name drops it after "<card>: ": Heated Debate's read "Heated Debate:
      // heated Debate deals 4 damage to which ...?", hp-14 gap)
      if (why && src && why.toLowerCase().startsWith(`${src.toLowerCase()} `)) why = why.slice(src.length + 1);
      if (why) ui.title = `${src}: ${why}`;
      // (a revolt card says whether revolt is on: a permanent of the player's left the battlefield this turn)
      const revolt = /(?:^|\n)Revolt — ([^\n]+)/.exec(srcCardText)?.[1];
      if (revolt && game?.revolt) {
        const on = game.revolt[seat.slot] === gv.turn;
        ui.text = `${ui.text ? `${ui.text}\n` : ""}Revolt is ${on ? "ON" : "off"}: ${on ? "a permanent you controlled left the battlefield this turn" : "no permanent you controlled has left the battlefield this turn"}.`;
      }
      if (src) {
        const ctx = { src, uiTitle: ui.title, title: String(title), ability: String(prompt.sourceAbilityText || ""), cardText: srcCardText, srcOnBattlefield, maxTargets: input.maxTargets, cardsOnly: input.candidates.length > 0 && input.candidates.every((c) => c.kind === "card") };
        for (const say of KEYWORD_TARGETS) {
          const said = say(ctx);
          if (said?.title) ui.title = said.title;
          if (said?.note) ui.text = ui.note = said.note;
        }
      }
      // (a player question whose verb we don't know says the card's own "target player" sentence: Emrakul's "choose a
      // player to control" read as controlling the player; it gains control of their creatures, hp-06 2026-10-28)
      const playerVerb = String(title).match(/^Choose (?:a )?player to (\w+)/i)?.[1]?.toLowerCase();
      const playerSentence = src && playerVerb && !Object.hasOwn(PLAYER_VERBS, playerVerb)
        // (not reminder text in brackets: Partner with's; a cost or loyalty before a colon is left out: Kenrith's "{3}{U}:")
        && String(prompt.sourceAbilityText || srcCardText || "").replace(/\([^()]*\)/g, "")
          .split(/(?<=\.)\s+|\n/).filter((x) => /\btarget player\b/i.test(x));
      if (playerSentence?.length === 1) {
        const s = playerSentence[0].trim().replace(/^[+−–-]?\d+:\s*/, "").replace(/^[^:.]*\{[^:.]*\}[^:.]*:\s*/, "").replace(/^(?:When|Whenever|At)\b[^,]*,\s*/i, "").replace(/\btarget player\b/i, "which player").replace(/\.$/, "");
        ui.title = `${src}: ${s[0].toLowerCase()}${s.slice(1)}?`;
      }
      // (Partner with: Forge's "Choose player to fetch" names neither the partner nor that it's a may, hp-06 2026-10-28)
      const partner = /^Choose (?:a )?player to fetch\b/i.test(String(title))
        && srcCardText.match(/\bPartner with ([^(\n]+?)\s*(?:\(|\n|$)/);
      if (partner && src) {
        ui.title = `${src}: which player may search their library for ${partner[1]}?`;
        ui.text = ui.note = `Partner with: that player may put ${partner[1]} into their hand from their library, then shuffle.`;
      }
      if (chosen) ui.title = `${src ? `${src}: ` : ""}${minLeft ? `choose ${countWords(minLeft, maxLeft, "more target")}` : `another target, or Done (${chosen} chosen)`}`;
      // fewer legal targets than the spell needs (Curtains' Call with one creature that can be targeted): it can't be
      // finished, only taken back; say so (the hand-play sweep sat on it for 1,700 tries, 2026-10-21)
      if (input.candidates.length < minLeft) {
        ui.text = `Only ${input.candidates.length} legal target${input.candidates.length === 1 ? "" : "s"} for ${minLeft} needed: press Cancel to take the spell back.`;
        log(`${seat.color}: ${title} needs ${input.minTargets} targets, only ${input.candidates.length} legal`);
      }
      toOutput = (a) => {
        if (a[0] === "__cancel") return { type: "cancel" };
        // (all of them, counted from the first: Forge says how many it has taken in its next question)
        if (!chosen && a.length) seat.targetPicks = { src: prompt.sourceCard?.id ?? null, ids: [...a], at: Date.now() };
        // (a regeneration's target: its shield for the log, see logEvents; Swarmyard's Rats, gap-04)
        if (game && /\bRegenerate target\b/.test(String(prompt.sourceAbilityText || ""))) for (const v of a) if (v.startsWith("card|")) (game.regenShields ??= new Set()).add(v.slice(5));
        // (and a haunt's creature, which Forge shows nowhere: said with the exile and on the haunted card, see logEvents
        // and tableCard; Blind Hunter's read only "is exiled from White's graveyard", hp-20 gap)
        if (game && prompt.sourceCard?.id && !srcOnBattlefield && /(?:^|\n)Haunt \(When this creature dies, exile it haunting target creature\.\)/i.test(srcCardText)) {
          const t = a.find((v) => v.startsWith("card|"));
          if (t) (game.haunting ??= new Map()).set(prompt.sourceCard.id, t.slice(5));
        }
        // (and a suspect's: the player's trigger resolves before any board shows it on the stack, so the suspect and its
        // goad are noted when it is gone, see logEvents; Nelly Borca's read nothing, hp-14 gap)
        if (game && /\bsuspect target\b/i.test(String(prompt.sourceAbilityText || srcCardText)) && prompt.sourceCard?.id) {
          (game.ownTargeted ??= []).push({ id: prompt.sourceCard.id, ctl: prompt.decidingPlayerId, text: String(prompt.sourceAbilityText || srcCardText), targets: a.filter((v) => v.startsWith("card|")).map((v) => v.slice(5)) });
        }
        // (and a counterspell's: the player's own resolves before any board shows it on the stack, so its targets are
        // noted here; An Offer You Can't Refuse's Divination read no "is countered", gap-04 re-test)
        if (game && isCounterspell(String(prompt.sourceAbilityText || srcCardText))) for (const v of a) if (v.startsWith("spell|")) (game.counterTargets ??= new Set()).add(v.slice(6));
        return { type: "boardTargets", chosen: a.map((v) => { const [kind, id] = v.split("|"); return { kind, id }; }) };
      };
      break;
    }
    case "chooseBoolean": {
      // Say which card asks ("Draw two Cards" came right after Sylvan Library's own question, with no name), and for
      // "unless you pay" questions what No does. Sylvan Library, as Forge runs it (raw capture 2026-10-22): choose 2
      // drawn cards, then per card "Pay 4 {LIFE}?" (Pay / Decline, nothing else), and after a No "Select a card from
      // your hand": which chosen card goes back on top. So the question is "pay, or put one back", counted 1 of 2.
      const src = prompt.sourceCard?.identity?.name;
      // Forge asks "Cancel Search? Up to N more card(s) can be selected." after a choice of fewer cards than allowed: the
      // player already pressed Done, which meant stop (the 2026-10-22 review saw it asked 3 times in one game)
      // "Sacrifice Food Token?" right after the player used that card's own "..., Sacrifice this: ..." ability: Forge
      // confirms the cost it was just told to pay; said yes for them (playtest 2026-10-26: Food, Clue and Evolving Wilds
      // each asked again after paying). A sacrifice auto-pay picked (a Treasure) is still asked.
      // The same for a land the player tapped that costs life to tap: paying is part of tapping it ("Mana Confluence:
      // pay 1 life?" came after its colour question, playtest 2026-10-27). Each only when the card is the one just used
      // (its id, or its name when Forge sends no source card: Dauthi Voidwalker) and that ability's cost names the part
      // asked about. (Forge's confirmPayment asks these; answering them in the engine needs an image rebuild, deferred.)
      // (Forge's title may have no "?": "Sacrifice Dauthi Voidwalker" came bare and was asked, hp-07 #32 re-test 2026-10-27)
      // ("Exile Tithing Blade?" right after its own Craft, whose cost exiles it, hp-12 #9 2026-10-27)
      // (the same card's own "may" asked again right after Yes to its trigger: Sylvan Library's "draw two additional cards?"
      // then Forge's "Draw two Cards", hp-26. Its words all in the first question's)
      const mayYes = seat.justDid("mayYes", 15000);
      const wordsOf = (t) => String(t).toLowerCase().split(/[^a-z0-9']+/).filter((w) => w && !["do", "you", "want", "to"].includes(w));
      const asked = wordsOf(title), first = mayYes ? wordsOf(mayYes.text) : [];
      if (mayYes && prompt.sourceCard?.id === mayYes.id && asked.length && asked.every((w) => first.includes(w))) {
        seat.forget("mayYes");
        seat.respond(prompt.promptId, type, { type: "decision", value: true });
        return;
      }
      // (and a mana source's own sacrifice when the player tapped it by hand: "Tap Treasure Token for {R} (also sacrifice
      // this token)" then "Sacrifice Treasure Token?", hp-13 gap. One auto-pay picked is still asked, above.)
      const CONFIRMS = [[/^Sacrifice .+/i, "activate", /sacrifice/i], [/^Exile .+/i, "activate", /\bexile\b/i],
        [/\bpay \d+ life\??$/i, "manaTap", /pay \d+ life/i], [/^Sacrifice .+/i, "manaTap", /\bsacrifice\b/i]];
      for (const [asks, kind, inCost] of CONFIRMS) {
        const u = asks.test(title) ? seat.justDid(kind, 30000) : null;
        const same = u && (prompt.sourceCard?.id ? prompt.sourceCard.id === u.id : !!u.name && title.toLowerCase().includes(u.name.toLowerCase()));
        if (same && inCost.test(u.text)) {
          seat.forget(kind);
          seat.respond(prompt.promptId, type, { type: "decision", value: true });
          return;
        }
      }
      // (a free cast said yes to ("you may cast X without paying its mana cost"): Forge's "Do you want to play X?" right
      // after it is the same cast, asked twice for rebound's Ephemerate, hp-09)
      const playQ = title.match(/^Do you want to play (.+?)\?$/i)?.[1], free = playQ ? seat.justDid("freeCast", 30000) : null;
      if (free && free.name === playQ) {
        seat.forget("freeCast");
        seat.respond(prompt.promptId, type, { type: "decision", value: true });
        return;
      }
      // (Fabricate's choice, which Forge words as a payment: Marionette Apprentice read "pay Put a +1/+1 counter on
      // Marionette Apprentice?" Pay ... | No: create one 1/1 ... Servo, hp-15)
      const fabricate = String(prompt.sourceAbilityText || "").match(/^Fabricate (\d+)\b/i)?.[1];
      if (fabricate && src && /^Pay Put /i.test(title)) {
        const n = Number(fabricate);
        ui = { title: `${src}: fabricate ${n}: ${n === 1 ? "a +1/+1 counter" : `${n} +1/+1 counters`} on it, or ${n === 1 ? "a 1/1 Servo token" : `${n} 1/1 Servo tokens`}?`, mode: "single",
          options: [{ id: "yes", label: n === 1 ? "+1/+1 counter" : "+1/+1 counters" }, { id: "no", label: n === 1 ? "Servo token" : "Servo tokens" }] };
        toOutput = (a) => ({ type: "decision", value: a[0] === "yes" });
        break;
      }
      // (Riot's choice, the same payment wording with no ability text: Spider-Punk read "pay Put a +1/+1 counter on
      // Spider-Punk?" ... | No: Spider-Punk gains haste, hp-18)
      if (src && /^Pay Put a \+1\/\+1 counter on /i.test(title) && /(?:^|\n)Riot\b/.test(srcCardText) && /\bgains haste\b/i.test(String(input.presentation?.text || ""))) {
        ui = { title: `${src}: riot: a +1/+1 counter, or haste?`, mode: "single", options: [{ id: "yes", label: "+1/+1 counter" }, { id: "no", label: "Haste" }] };
        toOutput = (a) => ({ type: "decision", value: a[0] === "yes" });
        break;
      }
      if (/^Cancel Search\?/i.test(title) && seat.cardsDone && seat.cardsDone.src === src) {
        seat.cardsDone = null;
        seat.respond(prompt.promptId, type, { type: "decision", value: true });
        return;
      }
      // the commander replacement into the hand or library, asked under Forge's "Commander Effect" with no card: which
      // commander and where, by what moves it on the stack ("Commander Effect: put it into the command zone instead?"
      // after Into the Roil on Kenrith, gap-04)
      if (src === "Commander Effect" && /\binto its owner's hand or library\b/i.test(String(title))) {
        // (by the seat's own commanders when known: one targeted on the stack, else the only one; a commander returned as a
        // cost (Spider-Sense's web-slinging) read "Blind Hunter: put it into the command zone", Murder's target, hp-20 gap)
        const mine = new Set(seat.commanderNames || []);
        const isMine = (t) => t.kind === "card" && byId[t.id] && (!mine.size || mine.has(byId[t.id].identity?.name));
        const mover = (gv.stack || []).find((s) => (s.targets || []).some(isMine));
        const cmd = mover ? byId[mover.targets.find(isMine).id]?.identity?.name : mine.size === 1 ? [...mine][0] : null;
        const words = String(mover?.sourceAbilityText || "");
        const dest = /\bhand\b/i.test(words) && !/\blibrary\b/i.test(words) ? "hand" : /\blibrary\b/i.test(words) && !/\bhand\b/i.test(words) ? "library" : "hand or library";
        ui = { title: `${cmd || "Your commander"}: put it into the command zone instead of your ${dest}?`, mode: "single",
          options: [{ id: "yes", label: "Command zone" }, { id: "no", label: dest === "hand or library" ? "No" : `Into your ${dest}` }],
          text: "Commander: if it would go into its owner's hand or library, its owner may put it into the command zone instead." };
        toOutput = (a) => ({ type: "decision", value: a[0] === "yes" });
        break;
      }
      const named = src && !title.toLowerCase().includes(src.toLowerCase()) ? `${src}: ${title}` : title;
      const u = src && seat.unless?.src === src && /Card\.ChosenCard/.test(input.presentation?.text || "") ? seat.unless : null;
      // any other question from that card (its next trigger: "Use triggered ability of Sylvan Library?") ends the last
      // round: Forge skips the "which card?" after a No when only one card can go back, so it may still be waiting
      if (src && seat.unless?.src === src && !u) seat.unless = null;
      // (only the chosen cards still in your hand: one already put back, by a drag or the list, is out)
      const inHand = (id) => (gv.zones || []).some((z) => z.zone === "hand" && z.cards.some((c) => c.id === id));
      if (u) { u.ids = u.ids.filter(inHand); u.awaitingPick = false; u.putBack = null; }
      // (not for Ward, said as itself: its "otherwise" read "No: counter Kenrith, the Returned King's ability unless its
      // controller pays {PayLife<2>}", gap-04)
      const otherwise = /^Ward\b/i.test(String(prompt.sourceAbilityText || "")) ? null : otherwiseText(seat, input, u ? "a card" : null, src)?.replace(/ from your hand/, "");
      if (otherwise) {
        const ask = title.replace(/\?\s*$/, "");
        // the gesture that means No: a chosen card onto your library, or the permanent into your graveyard (onIntent)
        const otherwiseDo = /on top of your library/i.test(otherwise) && u ? "library" : /^sacrifice\b/i.test(otherwise) ? "sacrifice" : null;
        const aboutCards = u ? [...u.ids] : otherwiseDo === "sacrifice" && prompt.sourceCard?.id ? [prompt.sourceCard.id] : null;
        if (u) u.k += 1;
        const names = u ? u.ids.map(cname).join(", ") : "";
        // "you may pay {1}{G}. If you do, <effect>": Forge's "otherwise" text is then what paying does, not what No does
        // (Springheart Nantuko's No read "No: create a token that's a copy of Alesha", and created an Insect, playtest
        // 2026-10-27). Told by the ability's own template, "you may pay ... . If you do", and its "If you didn't / don't"
        // sentence says what No does. (Forge marks it UnlessSwitched; sending that flag needs an engine rebuild, deferred.)
        // The whole card's text stands in only when it has one pay in it: another ability's "unless you pay" read with
        // this one's "you may pay" swapped Yes and No (stage 3 review 2026-10-27).
        const cardText = srcCardText;
        const abilityText = prompt.sourceAbilityText ? String(prompt.sourceAbilityText)
          : (cardText.match(/\bpay\b/gi) || []).length === 1 ? cardText : "";
        // (Recover's "If you do, return ... Otherwise, exile ...": Forge's "otherwise" text then holds both sentences,
        // and Pay read "return ... to its owner's hand. Exile ...", hp-22 #8 2026-10-28)
        const ifNot = abilityText.match(/(?:If you (?:didn't|don't|do not|did not)\b[^,]*|\bOtherwise),\s*([^.]+)/i);
        const paysFor = !u && /\byou may pay\b[^.]*\.\s*If you do\b/i.test(abilityText);
        ui = { title: `${src ? `${src}: ` : ""}${ask}?${u && u.k <= u.n ? ` (${u.k} of ${u.n})` : ""}`, mode: "single",
          options: paysFor ? [{ id: "yes", label: `${ask}: ${otherwise.split(/\.\s+/)[0]}` }, { id: "no", label: ifNot ? `No: ${ifNot[1].trim()}` : "No" }]
            : [{ id: "yes", label: ask }, { id: "no", label: `No: ${otherwise}` }],
          ...(aboutCards ? { aboutCards, otherwiseDo } : {}),
          ...(u ? { show: u.ids.filter((id) => imgOf(byId[id])).map((id) => ({ n: cname(id), img: imgOf(byId[id]) })) } : {}),
          ...(otherwiseDo === "library" ? { text: `Chosen: ${names}. Each one you don't pay for goes back on top of your library. Or drag one of them onto your library.` }
            : otherwiseDo === "sacrifice" ? { text: `Or drag ${src} to your graveyard to sacrifice it.` } : {}) };
        toOutput = (a) => {
          if (u && a[0] !== "yes") u.awaitingPick = true;
          // (Pay: the payment that follows is the player's own, paid from the pool by itself, see payManaCost; Springheart
          // Nantuko's landfall asked "Pay from mana pool" right after Pay, playtest 2026-10-27)
          // (only your own card's: a cost for someone else's still asks, stage 3 review 2026-10-27)
          const ctl = byId[prompt.sourceCard?.id]?.controllerId ?? prompt.sourceCard?.controllerId;
          if (a[0] === "yes" && prompt.sourceCard?.id && ctl === seat.slot) seat.note("start", prompt.sourceCard.id, src);
          return { type: "decision", value: a[0] === "yes" };
        };
      } else {
        // (live, a replacement's text comes as the title's second line, "Apply replacement effect of Deadpool, Trading
        // Card?\r\nAs Deadpool enters, you may ...", with no ability text, hp-25 re-test)
        const below = String(input.presentation?.title || "").split(/\r?\n/).slice(1).join(" ").trim();
        // (cascade's or discover's hit, asked with no ability text: a free cast, hp-15)
        const hitCast = !prompt.sourceAbilityText && !below && /^Do you want to play /i.test(title) && seat.justDid("exiledHit", 30000);
        let [t, yes, no, more] = yesNoWords(named, src, { ...input, abilityText: prompt.sourceAbilityText || below || (hitCast ? "You may cast it without paying its mana cost." : "") });
        const said = src && keywordYesNo({ src, title, below, description: String(input.presentation?.description || ""), ability: String(prompt.sourceAbilityText || ""), cardText: srcCardText });
        if (said) [t, yes, no, more] = said;
        // (a "you may" asked after its target was picked names that target: King Macar's inspired asked "exile target
        // creature?" with Garruk's Companion just picked, hp-14 gap)
        const picks = seat.targetPicks;
        // (or, picked longer ago, its targets on the stack, where the trigger stays while it resolves: Goblin Grappler's
        // provoke asked "have target creature defending player controls untap ..." after the Tenth Doctor's reveal, hp-21 gap)
        const resolving = (gv.stack || []).find((s) => s.sourceId === prompt.sourceCard?.id && (s.targets || []).some((x) => x.kind === "card"));
        const picked = picks && picks.src && picks.src === prompt.sourceCard?.id && Date.now() - picks.at < 30000
          ? picks.ids.filter((v) => v.startsWith("card|")).map((v) => byId[v.slice(5)]?.identity?.name).filter(Boolean)
          : (resolving?.targets || []).filter((x) => x.kind === "card").map((x) => byId[x.id]?.identity?.name).filter(Boolean);
        if (picked.length && OPTIONAL_ASK.test(String(title).split(/\r?\n/)[0])) t = t.replace(/\btarget (?:[a-z]+ )??(?:creature|permanent|artifact|enchantment|land|planeswalker|card)s?\b(?: (?:defending player|an opponent|that player) controls)?/i, picked.join(" and "));
        ui = { title: t, mode: "single", options: [{ id: "yes", label: yes }, { id: "no", label: no }], ...(more ? { text: more } : {}) };
        // ("Cast it" on your own card's cast question starts that cast: its payment comes from the pool by itself, as a
        // cast from the hand does; Emrakul's madness cast asked "Pay from mana pool" after it, hp-06 2026-10-28)
        // (whoever is asked casts it, whoever owns the card: Etali's or Villainous Wealth's casts too, suite review)
        // (and "Pay ..." on your own card's question: Extort's payment asked "Pay from mana pool" after Pay {W/B}, hp-15)
        const ownCard = (byId[prompt.sourceCard?.id]?.controllerId ?? prompt.sourceCard?.controllerId) === seat.slot;
        const castsOwn = (yes === "Cast it" || (/^Pay \{/.test(yes) && ownCard)) && prompt.sourceCard?.id;
        const freeCast = String(prompt.sourceAbilityText || below).match(/\byou may cast (.+?) without paying its mana cost\b/i)?.[1];
        toOutput = (a) => {
          if (a[0] === "yes" && castsOwn) seat.note("start", prompt.sourceCard.id, src);
          // (a miracle cast says so, as a flashback does: "White casts Reforge the Soul" said nothing of it, hp-15 gap)
          // (and a reveal's free cast by its keyword: Surging Dementia's ripple cast of its namesake read "White copies
          // Surging Dementia", hp-23 gap)
          const castWay = /^.+ - Miracle$/.test(String(prompt.sourceAbilityText || "").trim()) ? "miracle" : hitCast ? hitCast.text : null;
          if (a[0] === "yes" && castsOwn && game && castWay != null) {
            (game.pendingPlays ??= []).push({ id: prompt.sourceCard.id, name: castWay ? `${src} (${castWay})` : src, ctl: seat.slot, kind: "cast", text: "", at: Date.now(), promptId: prompt.promptId });
          }
          if (a[0] === "yes" && freeCast) seat.note("freeCast", prompt.sourceCard?.id, withoutForgeNotes(freeCast));
          const may = OPTIONAL_ASK.test(String(title).split(/\r?\n/)[0]) && String(prompt.sourceAbilityText || "").match(/\bmay ([^.]+)\./)?.[1];
          if (a[0] === "yes" && may && prompt.sourceCard?.id) seat.note("mayYes", prompt.sourceCard.id, src, may);
          // (Paradigm's yes: the cast question next is its free copy; read "White casts Improvisation Capstone", hp-23 gap)
          if (a[0] === "yes" && /^Paradigm \(/.test(String(prompt.sourceAbilityText || ""))) seat.note("exiledHit", null, src, null);
          return { type: "decision", value: a[0] === "yes" };
        };
      }
      break;
    }
    case "chooseCards": {
      const src = prompt.sourceCard?.identity?.name;
      // (a follow-up picks one card, among cards that were chosen; a new round's "choose 2" isn't one, even when it
      // offers a card put back last turn and drawn again: answering it with one card aborted a game, 2026-10-22)
      const u = src && seat.unless?.src === src && seat.unless.awaitingPick && input.max === 1
        && input.cards.some((c) => seat.unless.ids.includes(c.id)) ? seat.unless : null;
      if (u) {
        // Sylvan Library after a No: which chosen card goes back. A card dragged onto the library already said which.
        const back = u.putBack && input.cards.some((c) => c.id === u.putBack) ? u.putBack : null;
        const done = (id) => { u.awaitingPick = false; u.putBack = null; u.ids = u.ids.filter((x) => x !== id); sayPutOnTop(seat, 1); };
        if (back) { done(back); seat.respond(prompt.promptId, type, { type: "chooseCardsDecision", chosenCardIds: [back] }); return; }
        ui = { title: `${src}: which card goes back on top of your library?`, mode: "multi", min: input.min, max: input.max, dest: "library",
          options: input.cards.map((c) => ({ id: c.id, label: cardLabel(c), img: imgOf(c) })) };
        toOutput = (a) => { done(a[0]); return { type: "chooseCardsDecision", chosenCardIds: a }; };
        break;
      }
      // a pick that must be made, of the only card there is: answered, as Arena doesn't ask a forced choice (Bolster
      // asked "choose a card" with one creature, hp-12 #11 2026-10-27)
      // (only one that can't be cancelled, of your own permanent: a cost's sacrifice keeps its Cancel, and a card from an
      // opponent's revealed hand is shown; said in the chat, suite review 2026-10-27)
      const only = Array.isArray(input.cards) && input.cards.length === 1 ? input.cards[0] : null;
      if (input.min === 1 && input.max === 1 && only && !input.cancellable && only.zone === "battlefield" && (only.controllerId ?? seat.slot) === seat.slot) {
        chat(`[MTG] ${src ? `${src}: ` : ""}${cardLabel(only)} (the only choice)`, seat.color);
        seat.respond(prompt.promptId, type, { type: "chooseCardsDecision", chosenCardIds: [only.id] });
        return;
      }
      // splice: Forge's "Splice" choice of Arcane cards from the hand, titled by the spell, read as the spell's own search
      // ("Kodama's Reach: search your library for which basic land cards?" over Desperate Ritual and Glacial Ray, hp-10 gap)
      if (/^splice$/i.test(String(input.presentation?.description || "").trim()) && input.cards.every((c) => c.zone === "hand")) {
        ui = { title: `${src ? `${src}: ` : ""}splice which Arcane cards onto it?`, mode: "multi", min: input.min, max: input.max,
          text: "Each one's splice cost is paid too, and its text is added to the spell. The spliced cards stay in your hand. Done with none: no splice.",
          options: input.cards.map((c) => ({ id: c.id, label: cardLabel(c), img: imgOf(c) })) };
        // (the cast line says what was spliced, the spliced cards being in a hand nobody else sees: "White casts Kodama's
        // Reach" said nothing of its added damage, hp-10 gap)
        toOutput = (a) => {
          const rec = game && a.length ? (game.pendingPlays || []).find((e) => e.id === prompt.sourceCard?.id && e.kind === "cast" && !e.said) : null;
          if (rec) rec.name = `${rec.name} (spliced: ${a.map((id) => input.cards.find((c) => c.id === id)?.identity?.name || id).join(", ")})`;
          return { type: "chooseCardsDecision", chosenCardIds: a };
        };
        break;
      }
      // mutate's "Auspicious Starrix: choose a card" between the mutating card and the creature it merges with means
      // which one goes on top (its name, power/toughness and type; the rest only add abilities). It took a playtester
      // half a minute to work that out (2026-10-24): said in those words
      const mutating = src && input.max === 1 && input.cards.length === 2 && input.cards.some((c) => c.identity?.name === src)
        && /mutate/i.test(`${prompt.sourceCard?.text || ""} ${(prompt.sourceCard?.keywords || []).join(" ")}`);
      if (mutating) {
        ui = { title: `Mutate: which creature goes on top?`, mode: "multi", min: input.min, max: input.max,
          text: "The top card gives the merged creature its name, power and toughness; it keeps every card's abilities.",
          options: input.cards.map((c) => ({ id: c.id, label: cardLabel(c), img: imgOf(c) })) };
        toOutput = (a2) => ({ type: "chooseCardsDecision", chosenCardIds: a2 });
        break;
      }
      // Forge's own words for a "choose a card for an effect" question come as the description, under a title that is
      // only "Choose" (altitude review 2026-10-27). The legend rule says "You have multiple legendary permanents named
      // ... Choose the one to stay on battlefield": the one chosen stays (the question said neither, playtest
      // 2026-10-27: Alesha and her token copy). Same-name legendary permanents tell it too, for a description-less build.
      const desc = String(input.presentation?.description || "").trim();
      const legendName = input.cards?.[0]?.identity?.name;
      const legend = input.min === 1 && input.max === 1 && Array.isArray(input.cards) && input.cards.length > 1 && (/multiple legendary permanents/i.test(desc)
        || (!desc && input.cards.every((c) => c.zone === "battlefield" && c.identity?.name === legendName && (c.supertypes || []).includes("Legendary")
          && (c.controllerId ?? seat.slot) === seat.slot)));
      if (legend) {
        ui = { title: `Legend rule: which ${legendName} stays?`, mode: "multi", min: 1, max: 1,
          text: "You can have only one. The other goes to the graveyard.",
          options: input.cards.map((c) => ({ id: c.id, label: `${cardLabel(c)}${c.identity?.isToken ? " (token)" : ""}${c.isCopy ? " (copy)" : ""}`, img: imgOf(c) })) };
        toOutput = (a2) => ({ type: "chooseCardsDecision", chosenCardIds: a2 });
        break;
      }
      // What a bare "choose a card" is for, from the ability's (or the card's) own words: Soulbond's pairing, Craft's
      // exiled creature and Bolster's creature all read "choose a card" (hp-12 #1 #10 #11 2026-10-27)
      // (the asking ability's words when Forge sends them, the card's only without: Altar of the Wretched's sacrifice read as
      // its Craft, suite review 2026-10-27)
      // (cards from your library while the ability text is only a cast way's reminder: the card's own text; Splinter's
      // Technique cast by Sneak titled its search "return which unblocked attacker to your hand?", hp-11)
      const cardText = srcCardText;
      const words = String((keywordOnly(prompt.sourceAbilityText) && input.cards.length && input.cards.every((c) => c.zone === "library") && cardText)
        || prompt.sourceAbilityText || cardText || "");
      // (Soulbond on another creature entering pairs that one: "Pair Deadeye Navigator with which creature?" offered only
      // Deadeye when Apex Altisaur entered. Forge's "[Zone Changer: X (n)]" names it; without it, not the source either
      // when the source is one of the choices, hp-12 re-test 2026-10-27)
      // (live, the prompt's ability text has no note; the trigger's stack item, still there while it resolves, has it)
      const stackText = (gv.stack || []).filter((s) => s.sourceId && s.sourceId === prompt.sourceCard?.id).map((s) => s.text || "").join("\n");
      const changer = `${words}\n${stackText}`.match(/\[Zone Changer:\s*(.+?)\s*\(\d+\)\]/)?.[1];
      const paired = changer || ((input.cards || []).some((c) => c.identity?.name === src) ? null : src);
      const purpose = !src ? null : /\bpair\b/i.test(words) && /soulbond|unpaired/i.test(words) ? { title: paired === src ? `Pair ${src} with which creature?` : paired ? `${src}: pair ${paired} with which creature?` : `${src}: pair the creature that entered with which creature?`, text: "The pair share the ability while both stay. Done without one: no pair." }
        : /\bCraft with\b/i.test(words) ? { title: `${src}: which creature is exiled for Craft?` }
        : /\bbolster\b/i.test(words) ? { title: `${src}: which creature gets the bolster counters?`, text: "Bolster: a creature of yours with the least toughness." }
        // (hp-25 T9 T12 T8: cipher's creature, Deadpool's exchange, retrace's discarded land)
        : /\bcipher\b/i.test(words) ? { title: `${src}: encode it on which creature?`, text: "Each time that creature deals combat damage to a player, you may cast a copy of it for free." }
        : /\bexchange (?:his|her|its|their )?\s*text box/i.test(words) ? { title: `${src}: exchange text boxes with which creature?` }
        // (live, Retrace is in the card's text only: the ability text Forge sends is the spell's effect)
        : /\bRetrace\b/.test(`${words}\n${srcCardText || ""}`) && (/from your hand$/i.test(String(title)) || /\bdiscard\b/i.test(String(input.presentation?.description || ""))) ? { title: `${src}: discard which land card (Retrace)?`, text: "Retrace: cast it from your graveyard by discarding a land card." } : null;
      if (purpose && /^(choose|choose up to \d+(?: cards?)?|choose an? card|choose \d+ cards?)(?: from your hand)?$/i.test(String(title).replace(`${src}: `, "").replace(`${src}`, "").trim() || "choose")) {
        ui = { title: purpose.title, mode: "multi", min: input.min, max: input.max, ...(purpose.text ? { text: purpose.text, note: purpose.text } : {}),
          options: input.cards.map((c) => ({ id: c.id, label: cardLabel(c), img: imgOf(c) })) };
        toOutput = (a2) => ({ type: "chooseCardsDecision", chosenCardIds: a2 });
        break;
      }
      // a choice among cards in your hand that the card's own name titles ("Sylvan Library (2)"): say so
      const fromHand = input.cards.length > 0 && input.cards.every((c) => c.zone === "hand") && title === src;
      const howMany = input.min === input.max ? input.min : `${input.min}-${input.max}`;
      // "Sylvan Library: choose 2 cards from your hand", "Demonic Tutor: choose a card", "Discard a card", "You may
      // discard up to 1 card" (the count in words, as Arena; a title that already says "card" gets it in brackets)
      const cards = countWords(input.min, input.max, "card");
      const bare = /^(?:You may )?[A-Za-z]+$/.test(title), counted = /\d|\b(?:a|an|one|two|three|four|five|any|all|each)\b/i.test(title);
      ui = { title: fromHand ? `${title}: choose ${cards} from your hand` : title === src ? `${title}: choose ${cards}`
        : /^Search\b/i.test(title) && !counted ? `${title} for ${cards}` : bare ? `${title} ${cards}` : counted ? title : `${title} (${howMany})`,
        mode: "multi", min: input.min, max: input.max,
        // a card chosen to pay a cost (discard, exile from a graveyard, return, tap): Cancel takes the spell or
        // ability back and untaps what was tapped for its mana (our Forge build, 2026-10-23; rules-check --game
        // costcancel). A part of a two-part cost paid before this question stays paid, as in Forge (a sacrifice can't
        // be undone).
        cancel: input.cancellable,
        // (Forge's description when it says more than the title: "Choose a card" alone is no help)
        ...(desc && !/^choose\b[^.]{0,20}\.?$/i.test(desc) && desc.toLowerCase() !== String(title).toLowerCase() ? { text: displayText(desc) } : {}),
        options: input.cards.map((c) => ({ id: c.id, label: cardLabel(c), img: imgOf(c) })) };
      // (cards from your hand put on top "in any order", Brainstorm's two: the order went unasked, and the last picked
      // ended on top, so Reforge the Soul picked first sat under a Swamp, hp-15 gap. Their order is asked after the pick.)
      const handToTop = input.max > 1 && input.cards.every((c) => c.zone === "hand")
        && /\bput [^.]*?\bfrom your hand on top of your library\b/i.test(String(prompt.sourceAbilityText || srcCardText));
      // (remembered for "pay or put a chosen card back" questions that may follow, see chooseBoolean)
      toOutput = (a) => {
        if (a[0] === "__cancel") return { type: "cancel" };
        seat.unless = src && fromHand ? { src, ids: [...a], n: a.length, k: 0 } : null;
        // (cards picked from your library: the one into your hand next was put there, not drawn, marked as the pick is
        // made; the look's mark had run out when the pick took longer, Growing Rites' Mangara "White draws a card", hp-03 #2)
        // (a card put on top instead: nothing reaches the hand, and the library's count doesn't change, so the log said
        // nothing; a revealed one by name: Mystical Tutor, Worldly Tutor, hp-26)
        const fromLibrary = a.length && input.cards.every((c) => c.zone === "library" && (c.ownerId ?? seat.slot) === seat.slot);
        const effectText = String(prompt.sourceAbilityText || srcCardText);
        // ("then shuffles their library and puts that card on top of it": Varragoth's boast said nothing, hp-15 gap)
        const onTop = fromLibrary && game && effectText.match(/\b(?:(reveal (?:it|that card|them|those cards)),? )?(?:then )?(shuffles?,? and |shuffles? (?:your|their) library,? (?:and |then ))?puts? (?:it|th(?:at|e) card|them|those cards) on top\b/i);
        if (onTop) {
          const names = a.map((id) => input.cards.find((c) => c.id === id)?.identity?.name || id);
          gameLogLine(`${seat.color} ${onTop[1] ? `reveals ${names.join(", ")}, ` : ""}${onTop[2] ? "shuffles and " : ""}puts ${onTop[1] ? (a.length > 1 ? "them" : "it") : countWords(a.length, a.length, "card")} on top of their library`);
        } else if (fromLibrary) seat.note("search", seat.slot);
        // (and cards from your hand on top: the hand's drop beside the library's rise was not said, Brainstorm, hp-26)
        if (a.length && input.cards.every((c) => c.zone === "hand") && /\bput [^.]*?\bfrom your hand on top of your library\b/i.test(effectText)) sayPutOnTop(seat, a.length);
        seat.cardsDone = a.length < input.max ? { src, at: prompt.promptId } : null; // (see "Cancel Search?" in chooseBoolean)
        // (then which of them goes on top; Forge puts them on top one by one, so its last ends on top)
        if (handToTop && a.length > 1) {
          const items = a.map((id) => input.cards.find((c) => c.id === id)).filter(Boolean).map((c) => ({ id: c.id, label: cardLabel(c), img: imgOf(c) }));
          const step = orderSteps((n) => `${src || "Put back"}: click the card to put ${n ? `next (number ${n + 1} from the top)` : "on top"}`,
            "Your library's top card first. Not sure? Keep this order.", items, (ids) => ({ type: "chooseCardsDecision", chosenCardIds: [...ids].reverse() }));
          return step.auto ?? next(step.ui, step.toOutput);
        }
        return { type: "chooseCardsDecision", chosenCardIds: a };
      };
      // Discarding most of a hand (16 of 23 at cleanup, playtest 2026-10-26): the player picks the cards to KEEP, and
      // the rest are discarded. Fewer clicks; dragging a card to the graveyard still discards it (onIntent).
      const keepN = input.cards.length - input.min;
      if (input.min === input.max && keepN < input.min && input.cards.every((c) => c.zone === "hand") && /discard/i.test(title)) {
        ui = { ...ui, title: `Keep ${countWords(keepN, keepN, "card")}: the other ${input.min} are discarded`, min: keepN, max: keepN, keep: true };
        const discard = toOutput;
        toOutput = (k) => (k[0] === "__cancel" ? discard(k) : discard(input.cards.map((c) => c.id).filter((id) => !k.includes(id))));
      }
      // (a cost paid while casting is in a keyword's reminder, not the spell's ability text: Conspire's two creatures to
      // tap read "Rally the Galadhrim: choose 2 cards", re-run 2026-10-28. Only the reminders, so another ability's
      // rules text can't answer.)
      // (with the keyword before each: teamwork's taps read "to crew it", hp-15 gap)
      const reminders = (srcCardText.match(/(?:\b[A-Z][a-z]+(?: \d+)? )?\([^()]*\)/g) || []).join("\n");
      // (and from the hand: the Ur-Dragon's card to put onto the battlefield, hp-22 re-test 2026-10-28)
      // (cards all in the hand, or all in your library: the sentences that say so first; Tooth and Nail's entwined second
      // half read "search your library for which creature cards?", hp-09)
      const zoneSaid = { hand: /\bfrom your hand\b/i, library: /\b(?:search|from) your library\b/i }[input.cards[0]?.zone];
      const zoneWords = zoneSaid && input.cards.every((c) => c.zone === input.cards[0].zone)
        ? String(words || "").split(/\r?\n|(?<=\.)\s+/).filter((x) => zoneSaid.test(x)).join("\n") : "";
      const bareChoice = src && /^choose (?:an? card|up to \d+ cards?|\d+ cards?)(?: from your hand)?$/i.test(String(ui.title).replace(`${src}: `, ""));
      const why = bareChoice
        ? (zoneWords && purposeOf(zoneWords, "cards")) || purposeOf(words, "cards") || (reminders ? purposeOf(reminders.replace(/[()]/g, ""), "cards") : null)
          || searchTheCardsFit(words, input.cards, input.max) : null;
      // (an exact count above one stays said: Tangle Wire's "choose 4 cards" -> "tap which ...? (choose 4)")
      if (why) ui.title = `${src}: ${why}${input.min === input.max && input.max > 1 ? ` (choose ${input.max})` : ""}`;
      // (Forge's own step, when its description names it, over a purpose read from the whole text: see FORGE_STEPS)
      const stepSaid = src && forgeStepWords(String(input.presentation?.description || ""), { src, input, words, cardText: String(cardText || "") });
      if (stepSaid) Object.assign(ui, stepSaid);
      // (Enlist's attackers, asked with no card: "Choose cards (up to 1)" over Yavimaya Steelcrusher, hp-16 gap)
      if (/^Choose attackers to enlist$/i.test(String(input.presentation?.description || "").trim())) {
        Object.assign(ui, { title: `Enlist: which of your attackers enlist${input.max > 1 ? "" : "s"} a creature?`,
          text: "Each one taps a creature of yours that isn't attacking (it has haste or has been yours since the turn began) and gets +X/+0, X that creature's power." });
      }
      // (Amplify's cards to reveal, asked "Choose cards" from the hand: Kilnmouth Dragon read "choose cards (up to 1)", hp-21)
      const amplify = src && /^Choose cards$/i.test(String(title)) && input.cards.every((c) => c.zone === "hand")
        && srcCardText.match(/(?:^|\n)Amplify (\d+) \(As this creature enters, put \w+ \+1\/\+1 counters on it for each ([\w ]+?) card you reveal in your hand\.\)/i);
      if (amplify) {
        ui.title = `${src}: amplify ${amplify[1]}: reveal which ${amplify[2]} cards from your hand?`;
        ui.text = ui.note = `It enters with ${amplify[1]} +1/+1 counters for each.`;
      }
      // (Connive's discard: what a nonland card does decides the pick; "Ledger Shredder: discard a card" didn't say,
      // hp-06 2026-10-28)
      // ("note": a line the table shows under the corner's click hint too, where the panel's text isn't seen)
      if (src && /\bconnives?\b/i.test(words) && /\bdiscard\b/i.test(String(ui.title)) && !ui.keep)
        ui.text = ui.note = `Connive: a nonland card discarded puts a +1/+1 counter on ${words.includes(`${src} connives`) || /\bthis creature connives\b/i.test(words) ? src : "the creature that connives"}.`;
    }
      {
        // Cards that aren't in any zone this player can see are in their library: a search (tutor, fetch).
        // The table puts exactly these cards into the library deck so the player can right-click → Search.
        const visible = new Set(Object.keys(byId));
        const inPile = (id) => (gv.zones || []).some((z) => (z.zone === "graveyard" || z.zone === "exile") && z.cards.some((c) => c.id === id));
        if (input.cards.length && input.cards.every((c) => inPile(c.id))) {
          ui.pileChoices = input.cards.map((c) => c.id);
          ui.text = "Pick from the list, or right-click the graveyard/exile → Search and drag the card out.";
        }
        if (input.cards.length && input.cards.every((c) => !visible.has(c.id))) {
          // the same send-once details as the board: a full card list cost TTS ~300 ms to decode (Cultivate, 13 KB)
          const sl = slimmer(game);
          const full = input.cards.map((c) => tableCard(c));
          ui.librarySearch = full.map(sl.slim);
          if (Object.keys(sl.statics).length) ui.cards = sl.statics;
          setTimeout(flushTexts, 200);
          // a reloaded table has forgotten earlier details: the resend after "hello" carries them all
          Object.defineProperty(ui, "allCards", { value: Object.fromEntries(full.filter((c) => c.n != null).map((c) => [c.id, { n: c.n, f: shortUrl(c.f), b: shortUrl(c.b), tl: c.tl, cmc: c.cmc, ty: c.ty, tok: c.tok, bp: c.bp, bt: c.bt, tx: c.tx }])), enumerable: false });
          ui.text = "Pick from the list, or right-click your library → Search and drag the card out.";
        }
      }
      break;
    case "chooseNumber": {
      // "pay for Offspring? {2}" as a number from 0 to 1 is a yes/no; "choose Amount for Multikicker: {2}" says how many
      // times; a limit of 2147483647 (Forge's "no limit") made Max useless, so the picker stops at 20
      const pay = String(title).match(/^pay for (.+?)\? (.+)$/i);
      const times = String(title).match(/^choose Amount for (.+?): (\{.+\})$/i);
      if (input.min === 0 && input.max === 1 && pay) {
        // a mana cost: "Pay {2} for Offspring?" / Pay {2}, Don't pay; another cost (Casualty: "Sacrifice a creature with
        // power 2 or greater"): "Use Casualty?" with the cost under it
        // (the keyword's reminder text says it better than Forge's cost: Conspire's "It costs: tap two untapped creature
        // that shares a color with Rally the Galadhrims you control" -> "Rally the Galadhrim: tap two untapped creatures
        // you control that share a color with it?", sweep 2026-10-28)
        const kw = escapeRe(pay[1]);
        const reminder = srcCardText.match(new RegExp(`\\b${kw}\\b[^(\\n]*\\(([^)]*)\\)`))?.[1];
        const may = reminder?.match(/^(?:As you cast this spell, )?you may ([^.]+)\.\s*(.*)$/i);
        ui = /^\{/.test(pay[2])
          ? { title: `Pay ${pay[2]} for ${pay[1]}?`, mode: "single", kind: "yesno", options: [{ id: "1", label: `Pay ${pay[2]}` }, { id: "0", label: "Don't pay" }] }
          : may && src ? { title: `${src}: ${may[1]}?`, ...(may[2] ? { text: `${pay[1]}: ${may[2][0].toLowerCase()}${may[2].slice(1)}` } : {}), mode: "single", kind: "yesno", options: [{ id: "1", label: "Yes" }, { id: "0", label: "No" }] }
          : { title: `Use ${pay[1]}?`, text: `It costs: ${pay[2][0].toLowerCase()}${pay[2].slice(1).replace(/\.?$/, ".")}`, mode: "single", kind: "yesno", options: [{ id: "1", label: "Yes" }, { id: "0", label: "No" }] };
      } else {
        ui = { title: times ? `${src ? `${src}: ` : ""}pay ${times[2]} how many times? (${times[1]})` : /^Choose a (?:value|number) for /i.test(title) && src ? `${src}: choose ${/\bX\b/.test(String(prompt.sourceAbilityText || prompt.sourceCard?.text || "")) ? "X" : "a number"}` : title,
          mode: "number", min: input.min, max: Math.min(input.max, Math.max(input.min, 20)) };
        // (a 0-to-1 number whose title is a question is a yes/no: Harmonize's "Tap creature?" was a number picker, hp-19)
        if (input.min === 0 && input.max === 1 && /\?$/.test(String(title)))
          ui = { title: src ? `${src}: ${title[0].toLowerCase()}${title.slice(1)}` : title, mode: "single", kind: "yesno", options: [{ id: "1", label: "Yes" }, { id: "0", label: "No" }] };
        // (Join forces' mana: "Choose a value for amount of mana to pay" read "Minds Aglow: choose X", hp-23)
        if (src && /^Choose a value for amount of mana to pay$/i.test(title)) {
          ui.title = `${src}: ${/^Join forces\b/i.test(String(prompt.sourceAbilityText || "")) ? "join forces: " : ""}pay how much mana?`;
          const effect = String(prompt.sourceAbilityText || "").match(/each player may pay any amount of mana\. ([^]+)$/i)?.[1];
          if (effect) ui.text = ui.note = effect;
        }
        // (Read ahead's chapter: The Cruelty of Gix read "How many counters?", hp-20)
        if (src && /^How many counters\?$/i.test(title) && /(?:^|\n)Read ahead\b/i.test(srcCardText)) {
          ui.title = `${src}: read ahead: start on which chapter?`;
          ui.text = ui.note = "The chapters before it don't happen.";
        }
        // (Harmonize's creature to tap, by its power: Nature's Rhythm read "Choose power of creature to tap", hp-19)
        if (src && /^Choose power of creature to tap$/i.test(title)) {
          ui.title = `${src}: harmonize: tap a creature of how much power, to pay that much less?`;
          ui.text = ui.note = "0: tap none.";
        }
      }
      toOutput = (a) => ({ type: "numberDecision", chosenNumber: Number(a[0]) });
      break;
    }
    case "chooseFromSelection":
    {
      // only one thing to choose and it must be chosen ("choose a kind of counter": +1/+1, six times a game): answered,
      // as Arena doesn't ask a forced choice
      if (input.options.length === 1 && (input.minTotal ?? 0) >= 1) { seat.respond(prompt.promptId, type, { type: "selectionDecision", chosenIndices: [0] }); return; }
      // nor the order of one card's own enter effects, which all apply ("enters tapped", "Graft 1 (... enters with a
      // +1/+1 counter ...)"): Llanowar Reborn asked "choose one" over them, hp-18
      if (input.maxTotal === 1 && (input.minTotal ?? 0) === 1 && /^(?:Play land|Cast )/i.test(String(prompt.sourceAbilityText || ""))
        && input.options.length > 1 && input.options.every((o) => /\benters\b/i.test(String(o.label || "")))) {
        seat.respond(prompt.promptId, type, { type: "selectionDecision", chosenIndices: [0] }); return;
      }
      // Arena: "Choose one —". A title that is just the card's name (or "Choose") says what to do; counter kinds read
      // as counters ("P1P1" -> "+1/+1 counter"); Forge's "Choose a Choose keyword to grant" reads as English.
      // (reminder text in brackets left out: "Arrest — Detain target creature an opponent controls.")
      // (but an additional cost in brackets is kept, as words: two "Some Spell - Sorcery" told apart only by it, hp-19 gap)
      const labels = input.options.map((o) => counterWords(String(o.label ?? "").trim()) || String(o.label ?? "").replace(/\s*\(Additional cost: ([^()]+)\)/i, " — additional cost: $1").replace(/\s*\([^()]{12,}\)/g, "").trim() || `Choice ${input.options.indexOf(o) + 1}`);
      const counters = input.options.length > 0 && input.options.every((o) => counterWords(String(o.label ?? "")));
      // (an additional cost to choose, "Silvergill Adept - Creature 2 / 1 (Additional cost: {3})": the brackets went with
      // the reminder rule above and left two identical "Silvergill Adept - Creature 2 / 1", hp-19 gap)
      // (a council's vote, "each player votes for a nonland permanent you don't control": Council's Judgment read "choose
      // one" over "Burning-Tree Emissary (106)", Forge's object numbers in, hp-20 gap)
      // (a thing voted for has its article; word votes, "votes for time or money", are said below)
      const councilVote = String(prompt.sourceAbilityText || "").match(/\beach player votes for an? ([^.]+?)(?:\.|$)/i)?.[1];
      if (src && councilVote) {
        ui = { title: `${src}: vote for which ${councilVote}?`, mode: "multi", min: input.minTotal, max: input.maxTotal,
          options: input.options.map((o, i) => ({ id: i, label: String(o.label ?? "").replace(/ \(\d+\)$/, "") })) };
        toOutput = (a) => ({ type: "selectionDecision", chosenIndices: a.map(Number) });
        break;
      }
      const costs = input.options.map((o) => /\(Additional cost: ([^()]+)\)\s*$/.exec(String(o.label ?? ""))?.[1]);
      if (src && costs.length > 1 && costs.every(Boolean)) {
        ui = { title: `${src}: pay which additional cost?`, mode: "multi", min: input.minTotal, max: input.maxTotal,
          options: costs.map((c, i) => ({ id: i, label: /^\{/.test(c) ? `Pay ${c}` : `${c[0].toUpperCase()}${c.slice(1)}` })) };
        toOutput = (a) => ({ type: "selectionDecision", chosenIndices: a.map(Number) });
        break;
      }
      const how = input.maxTotal === 1 && input.minTotal === 1 ? "one" : input.minTotal === 0 ? "any you want" : input.minTotal === input.maxTotal ? String(input.maxTotal) : `${input.minTotal} to ${input.maxTotal}`;
      // (Abundance's land or nonland, asked under the drawing card's name: "Kenrith, the Returned King: Abundance", hp-26)
      if (/^Abundance$/.test(String(title)) && labels.join("|") === "Land|Nonland") {
        ui = { title: "Abundance: reveal until a land or a nonland card?", mode: "single", options: [{ id: 0, label: "Land" }, { id: 1, label: "Nonland" }],
          text: "Revealed cards: that card into your hand, the rest on the bottom of your library." };
        // (its reveal next comes as a look under the drawing card: remembered with the kind, see revealCards)
        toOutput = (a) => { seat.note("revealInstead", prompt.sourceCard?.id, "Abundance", Number(a[0]) ? "nonland" : "land"); return { type: "selectionDecision", chosenIndices: a.map(Number) }; };
        break;
      }
      // (and "Choose a Protection" over colours: Bathe in Light's radiance, hp-21)
      const t = title === "Choose a Choose keyword to grant" ? "Choose a keyword to give" : title === "Choose a Creature" ? "Choose a creature type"
        : title === "Choose a Protection" ? "protection from which color?" : title;
      ui = { title: counters ? `${src || t}: choose a kind of counter` : (t === src || t === "Choose") && src ? `${src}: choose ${how}` : t,
        mode: "multi", min: input.minTotal, max: input.maxTotal, options: opts(input.options.map((o, i) => ({ id: i, label: labels[i] }))) };
      // venturing (or the initiative's Undercity): Forge asks "Name a card" for the dungeon and the card's "choose one"
      // for the next room (Acererak, hp-08 #1 #9 2026-10-28)
      if (src && /\bventure into\b|\binitiative\b/i.test(String(prompt.sourceAbilityText || srcCardText || ""))) {
        const dungeon = Object.values(byId).find((c) => (c.types || []).includes("Dungeon") && (c.controllerId ?? c.ownerId) === seat.slot)?.identity?.name;
        if (/^Name a card$/i.test(t)) ui.title = `${src}: venture into which dungeon?`;
        else if (labels.length > 1 && labels.every((l) => /^[A-Z][^—]*? — /.test(l))) ui.title = `${dungeon || src}: which room next?`;
      }
      const why = src && ui.title === `${src}: choose one` ? purposeOf(prompt.sourceAbilityText || srcCardText, "selection", labels) : null;
      if (why) ui.title = `${src}: ${why}`;
      // a vote ("each player votes for time or money", Council's dilemma, Will of the council): said as one, each word
      // with what its votes do; Tiered's modes with their names and extra costs, in the card's order (Expropriate read
      // "choose one: Money, Time", Restoration Magic its three modes A-Z with no costs, hp-22 #9 #11 2026-10-28)
      const rules = displayText(String(prompt.sourceAbilityText || srcCardText || ""));
      const vote = src && rules.match(/\bvotes? for (\w+) or (\w+)\b/i);
      const tiers = [...rules.matchAll(/^•\s*([^—\n]+?) — (\{[^—\n]*\}) — (.+?)\s*$/gm)];
      if (vote && labels.length === 2 && labels.every((l) => [vote[1], vote[2]].some((w) => w.toLowerCase() === l.toLowerCase()))) {
        ui.title = `${src}: vote for ${vote[1]} or ${vote[2]}`;
        const does = (w) => rules.match(new RegExp(`\\bFor each ${w} vote, ([^.]+)`, "i"))?.[1] || rules.match(new RegExp(`\\bIf ${w} gets more votes(?:,? or the vote is tied)?, ([^.]+)`, "i"))?.[1];
        ui.options = ui.options.map((o, i) => ({ ...o, label: does(labels[i]) ? `${labels[i]}: ${does(labels[i])}` : labels[i] }));
        ui.keepOrder = true;
      } else if (src && tiers.length === labels.length && labels.length > 1) {
        const tierOf = (l) => tiers.find((m) => m[3].trim() === l.trim());
        if (labels.every(tierOf)) {
          ui.title = `${src}: choose one tier (an extra cost)`;
          ui.options = ui.options.map((o, i) => { const m = tierOf(labels[i]); return { ...o, label: `${m[1]} (${m[2] === "{0}" ? "no extra cost" : `+${m[2]}`}): ${m[3]}` }; });
          ui.keepOrder = true;
        }
      }
      // (Assist's helper among the players: Game Plan read "choose any you want" over "AI 1", hp-15)
      const assist = src && srcCardText.match(/(?:^|\n)Assist \(Another player can pay up to ((?:\{[^}]+\})+) of this spell's cost\.\)/)?.[1];
      if (assist && input.options.length && input.options.every((o) => game.playerOrder.includes(String(o.label)))) {
        ui.title = `${src}: assist: ask which player to pay up to ${assist} of it?`;
        ui.text = ui.note = "Pick none to pay it all yourself.";
      }
      // optional extra costs ("Spectral Shift: choose any you want: Entwine – {2}", Retrace, Buyback, Kicker): said as
      // a payment (hp-25 T6)
      // (Forge's OptionalCostValue: "<name> – <cost>", the name more than one word or hyphenated ("Promise Gift – Gift
      // something", "Jump-start – Discard a card"), or the cost alone with no name ("Collect evidence 8"), sweep 2026-10-28)
      const extra = labels.map((l) => l.match(/^([A-Z][\w-]*(?: [A-Za-z][\w-]*)*) – (.+)$/) || (labels.length === 1 && /^Collect evidence \d+$/.test(l) ? [l, l, null] : null));
      if ((input.minTotal ?? 0) === 0 && src && extra.length && extra.every(Boolean)) {
        // (Gift's cost is a promise to an opponent: "Gift a card" in the card's text says what they get)
        const gift = srcCardText.match(/\bGift (an? [^(.\n]+?)\s*(?:\(|$)/m)?.[1];
        const say = (e) => (e[1] === "Promise Gift" ? `promise an opponent ${gift || "the gift"}` : e[2] ? `pay ${e[1]} (${e[2]})` : e[1].toLowerCase());
        ui.title = extra.length === 1 ? `${src}: ${say(extra[0])}?` : `${src}: pay which extra costs?`;
        ui.text = "Pick it, then Done. Done alone: not paid.";
        // (Gift's option is the promise: "Pay Promise Gift: Gift something" read as a payment, hp-11)
        ui.options = ui.options.map((o, i) => ({ ...o, label: extra[i][1] === "Promise Gift" ? "Promise the gift" : extra[i][2] ? `Pay ${extra[i][1]}: ${extra[i][2]}` : extra[i][1] }));
      }
    }
      toOutput = (a) => ({ type: "selectionDecision", chosenIndices: a.map(Number) });
      {
        const said = textChangeQuestion(seat, ui, src, prompt, gv, byId);
        if (said) { const inner = toOutput; toOutput = (a) => { said(a.map((i) => ui.options.find((o) => String(o.id) === String(i))?.label ?? String(i))); return inner(a); }; }
      }
      break;
    case "chooseAttackers": {
      const pairs = [];
      for (const at of input.attackers) for (const tid of at.validTargetIds) pairs.push({ id: `${at.attackerId}|${tid}`, label: `${cname(at.attackerId)} → ${cname(tid)}` });
      const must = input.attackers.filter((a) => a.mustAttack && a.validTargetIds.length);
      // "All attack" sends every creature at its first target; "No attacks" none (except those that must attack).
      const quick = pairs.length ? [{ id: "__allattack", label: "All attack" }, { id: "__noattack", label: "No attacks" }] : [];
      // (who must attack, said on the question and again if the attack is refused: Kardur, Doomscourge sent four of Red's
      // Dragons in, and all they saw was "Attack declaration invalid", 15 times, game 2026-11-01)
      seat.mustAttack = must.map((m) => cname(m.attackerId));
      ui = { title: "Choose attackers", mode: "multi", min: 0, max: pairs.length, options: [...quick, ...pairs], ...(must.length ? { text: `Must attack: ${seat.mustAttack.join(", ")}.` } : {}) };
      toOutput = (a) => {
        const byAttacker = {};
        for (const m of must) byAttacker[m.attackerId] = m.validTargetIds[0];
        if (a.includes("__allattack")) for (const at of input.attackers) if (at.validTargetIds.length) byAttacker[at.attackerId] ??= at.validTargetIds[0];
        for (const v of a) { if (v.startsWith("__")) continue; const [att, tgt] = v.split("|"); byAttacker[att] = tgt; }
        return { type: "declareAttackers", assignments: Object.entries(byAttacker).map(([attackerId, targetId]) => ({ attackerId, targetId })) };
      };
      // "End turn" in your main phase skips the attack too, as on Arena (it stopped at "Choose attackers", hp-07
      // 2026-10-27); creatures that must attack still do
      if (endTurnHolds(seat, gv)) {
        seat.respond(prompt.promptId, type, toOutput(["__noattack"]));
        return;
      }
      break;
    }
    case "chooseBlockers": {
      const pairs = [];
      for (const at of input.attackers) for (const b of at.validBlockerIds) pairs.push({ id: `${b}|${at.attackerId}`,
        label: `${cname(b)} blocks ${cname(at.attackerId)}${at.minBlockers > 1 ? ` (needs ${at.minBlockers}+ blockers)` : ""}${at.mustBeBlocked ? " (must be blocked)" : ""}` });
      ui = { title: "Choose blockers", mode: "multi", min: 0, max: pairs.length, options: pairs, text: input.error };
      toOutput = (a) => {
        const byBlocker = {};
        for (const v of a) { const [b, at] = v.split("|"); byBlocker[b] = at; }
        return { type: "declareBlockers", assignments: Object.entries(byBlocker).map(([blockerId, attackerId]) => ({ blockerId, attackerId })) };
      };
      break;
    }
    case "scry": {
      const label = (c) => cardLabel(c);
      const done = (zoneCardIds) => ({ type: "scryDecision", zoneCardIds });
      // (nothing to look at: "Scry 0: choose cards to put on the bottom" with an empty library, hp-08 re-test #10)
      if (!(input.cards || []).length) { seat.respond(prompt.promptId, type, done((input.zones || []).map(() => []))); return; }
      if ((input.zones || []).length === 1) { seat.respond(prompt.promptId, type, done([(input.cards || []).map((c) => c.id)])); return; }
      if (input.zones.length > 2) {
        // each card gets its own destination, then the top of the library is ordered
        const step = scryPlaceSteps(input.cards, input.zones, label, done);
        if (step.auto) { seat.respond(prompt.promptId, type, step.auto); return; }
        ({ ui, toOutput } = step);
        ui.title = `${title}: ${ui.title[0].toLowerCase()}${ui.title.slice(1)}`;
        break;
      }
      // two destinations (scry: top/bottom, surveil: top/graveyard): pick the cards that move, then order the top
      const keepZone = input.zones.includes("libraryTop") ? "libraryTop" : input.zones[0];
      const moveZone = input.zones.find((z) => z !== keepZone) || keepZone;
      const WHERE = { libraryBottom: "on the bottom", graveyard: "in your graveyard", exile: "into exile", hand: "into your hand" };
      // (scry the table's way, 2026-10-24: the cards go into the player's second hand zone; dragged onto the library they
      // stay on top in the order dragged, clicked or dragged to the graveyard they move; the table answers "__tts")
      ui = { title: `${/\d/.test(title) ? title : `${title} ${input.cards.length}`}: choose cards to put ${WHERE[moveZone] || `into ${ZONE_LABEL[moveZone] || moveZone}`}`, mode: "multi", min: 0, max: input.cards.length,
        ...(moveZone === "libraryBottom" ? { dest: "library" } : {}),
        kind: "cards", scry: { move: moveZone, keep: keepZone },
        text: `They are in your second hand zone. Drag a card onto your library to keep it on top (the last one dragged ends up on top)${moveZone === "graveyard" ? ", onto your graveyard to put it there" : "; click one (or right-click > Bottom) to put it on the bottom"}. Then Done.`,
        options: input.cards.map((c) => ({ id: c.id, label: label(c), img: imgOf(c) })) };
      // (a scry, said to the table: how many went to the bottom, not which; Preordain's left no line, hp-26)
      const sayScry = (n) => { if (game && /^scry\b/i.test(String(title))) gameLogLine(`${seat.color} scries ${input.cards.length}: ${n ? `${countWords(n, n, "card")} on the bottom` : "all on top"}`); };
      toOutput = (a) => {
        if (a[0] === "__tts") {
          // the table's whole answer: "top:<id>" top card first, "move:<id>" to the other zone; any card it didn't name stays on top
          const ids = new Set(input.cards.map((c) => c.id));
          const top = a.filter((x) => String(x).startsWith("top:")).map((x) => String(x).slice(4)).filter((id) => ids.has(id));
          const moved = a.filter((x) => String(x).startsWith("move:")).map((x) => String(x).slice(5)).filter((id) => ids.has(id) && !top.includes(id));
          for (const c of input.cards) if (!top.includes(c.id) && !moved.includes(c.id)) top.push(c.id);
          sayScry(moved.length);
          return done(input.zones.map((z) => (z === moveZone ? moved : z === keepZone ? top : [])));
        }
        const moved = input.cards.filter((c) => a.includes(c.id));
        const kept = input.cards.filter((c) => !a.includes(c.id));
        sayScry(moved.length);
        const build =(keptIds) => done(input.zones.map((z) => (z === moveZone ? moved.map((c) => c.id) : z === keepZone ? keptIds : [])));
        if (keepZone !== "libraryTop" || kept.length <= 1) return build(kept.map((c) => c.id));
        const step = orderSteps((n) => `Your library: click the card to put ${n ? `next (number ${n + 1} from the top)` : "on top"}`, "Top card first. Not sure? Keep this order.",
          kept.map((c) => ({ id: c.id, label: label(c), img: imgOf(c) })), build);
        return step.auto ?? next(step.ui, step.toOutput);
      };
      break;
    }
    case "chooseColor":
    {
      if ((input.validColors || []).length === 1) { seat.respond(prompt.promptId, type, { type: "colorDecision", chosenColors: { [input.validColors[0]]: input.amount } }); return; }
      // While paying, the colours the cost asks for come first, marked: Command Tower listed all five and the
      // first one (White) didn't pay {1}{B}, so the payment went round in circles (2026-10-22 hand-play run).
      const need = colorsNeeded(seat.payingCost);
      const colors = [...input.validColors].sort((a, b) => (need.has(b) ? 1 : 0) - (need.has(a) ? 1 : 0));
      // (the colour of a source the player just tapped: "Tap X for which mana?" with {G} buttons, as the bridge's own
      // question for Mana Confluence; Exotic Orchard and Incubation Druid read "choose a color", hp-12 #12 2026-10-27)
      // (or a mana ability's colour asked while paying: Forge tapped Command Tower for the cost, "Command Tower: choose
      // a color" x14 in the sweep's question audit 2026-10-27; Chrome Mox's "any of the exiled card's colors" 2026-10-28)
      const tapped = prompt.sourceCard?.id && (seat.justDid("manaTap", 30000)?.id === prompt.sourceCard.id
        || (seat.payingCost && /^\{T\}[^:]*: Add\b[^.]*\bmana of any\b/im.test(String(prompt.sourceCard.text || byId[prompt.sourceCard.id]?.text || ""))));
      const SYMBOL = { White: "W", Blue: "U", Black: "B", Red: "R", Green: "G", Colorless: "C" };
      const n = Math.max(1, Number(input.amount) || 1);
      ui = { title: tapped ? `Tap ${src || cname(prompt.sourceCard.id)} for which mana?` : src && !title.includes(src) ? `${src}: ${title}` : title, mode: "single",
        options: colors.map((c) => ({ id: c, label: `${tapped && SYMBOL[c] ? `{${SYMBOL[c]}}`.repeat(n) : c}${need.has(c) ? " (needed)" : ""}` })) };
      toOutput = (a) => ({ type: "colorDecision", chosenColors: { [a[0]]: input.amount } });
      if (!tapped) {
        const said = textChangeQuestion(seat, ui, src, prompt, gv, byId);
        if (said) { const inner = toOutput; toOutput = (a) => { said(a); return inner(a); }; }
      }
    }
      break;
    case "revealCards":
      // Forge's warning about its own AI deck isn't meant for players.
      if (/^AI can't play/i.test(title)) { seat.respond(prompt.promptId, type, { type: "revealCardsAcknowledged" }); return; }
      // a notice with no cards ("White picked AI 1", "AI 1 vote Money"): told in chat and the game log, not asked (one
      // test game asked for OK 15 times; Arena shows such things in passing)
      if (/^Attack declaration invalid\b/i.test(title)) {
        const names = seat.mustAttack || [];
        chat(`[MTG] That attack isn't legal. ${names.length ? `Must attack: ${names.join(", ")}. Any you don't choose are sent for you. Check the table too: an effect can also forbid attacking a player.` : "Something on the table limits who can attack, or who they can attack."}`, seat.color);
        seat.respond(prompt.promptId, type, { type: "revealCardsAcknowledged" });
        return;
      }
      if (!(input.cards || []).length) {
        const me = nameOf(seat.slot);
        const said = displayText(`${src ? `${src}: ` : ""}${String(title || "").split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean).join(". ")}`);
        // (a vote: "AI 1 vote Errant (141)", "Current Votes:{Errant (141)=[White, AI 1]}" -> "AI 1 voted for Errant", "Votes: Errant: White, AI 1";
        // said so in the game log too, and Forge's "Money =[" with no space before the colon, hp-22 #10 2026-10-28)
        const plain = said.replace(/ \(\d+\)/g, "").replace(/\b(\w[\w ]*?) vote (?!for)/g, "$1 voted for ")
          .replace(/Current Votes:\{(.*)\}/, (m, v) => `Votes: ${v.replace(/\s*=\[([^\]]*)\]/g, ": $1").replace(/, (?=[^:]*:)/g, "; ")}`);
        const toMe = plain.split(`${me} `).join("You ").replace(/: You /, ": you ");
        chat(`[MTG] ${toMe}`, seat.color);
        // (a player's own pick by a card: "White saw: Incarnation Technique: White picked AI 1", hp-23 gap)
        const mine = plain.match(/^(.+): (\S+) picked (.+)$/);
        if (game) gameLogLine(mine && mine[2] === me ? `${me} chooses ${mine[3]} (${mine[1]})` : `${seat.color} saw: ${plain}`);
        seat.respond(prompt.promptId, type, { type: "revealCardsAcknowledged" });
        return;
      }
      if (/ reveals: .*Mana Value=/i.test(title)) {
        // (Forge's clash: one line per player and the result; said as "You: Island (0), AI 1: Forest (0). Nobody wins.")
        // (the engine's lines name players by their engine usernames: displayText first, then "You" for this seat)
        const me = nameOf(seat.slot);
        const isMe = (p) => p === me || p === seat.username;
        const lines = String(title).split(/[\r\n]+/).map((l) => displayText(l.trim())).filter(Boolean);
        const who = lines.map((l) => l.match(/^(.+?) reveals: (.+?)\. Mana Value= ?(\d+)/)).filter(Boolean)
          .map(([, p, c, v]) => `${isMe(p) ? "You" : p}: ${c} (${v})`);
        const end = lines.find((l) => !/ reveals: /.test(l)) || "";
        const won = end.match(/^(.+?) wins/i);
        const result = /no winner/i.test(end) ? "Nobody wins." : won ? (isMe(won[1]) ? "You win." : `${won[1]} wins.`) : end.replace(/!$/, ".");
        ui = { title: `${src ? `${src}: ` : ""}clash`, mode: "single", text: `${who.join(", ")}. ${result}`.trim(), options: [{ id: "ok", label: "OK" }],
          show: input.cards.slice(0, 7).map((c) => ({ n: cardLabel(c), img: imgOf(c) })) };
        toOutput = () => ({ type: "revealCardsAcknowledged" });
        break;
      }
      // a reveal said as one: Forge's "Look at these cards" for an ability that reveals ("Each player reveals the top card
      // of their library", Parley) and its "<card> - Revealing cards from"; the same cards shown again by the same card a
      // moment later are not asked again (Parley asked OK three times, twice for one Swamp, hp-22 #2 2026-10-28)
      // (a spell cast by a keyword way comes with that keyword's reminder as its ability text: the card's own text says what
      // it does; Splinter's Technique cast by Sneak showed its search as a look at the library, hp-11)
      const abilityWords = String((keywordOnly(prompt.sourceAbilityText) && (srcCardText)) || prompt.sourceAbilityText || "");
      // (Abundance's reveal, instead of a draw, comes as a look under the drawing card: "Kenrith, the Returned King: look at
      // these cards (your library)", and the log said "looked at a card", hp-26)
      // (only under the card it was asked under: Sensei's Divining Top's own look after an Abundance question with nothing to
      // reveal would be named to the whole table, stage 3 review)
      const instead = /^look at these cards$/i.test(String(title)) && input.zone === "library" && [seat.justDid("revealInstead", 30000)]
        .find((r) => r && r.id === prompt.sourceCard?.id);
      if (instead) seat.forget("revealInstead");
      // (Ripple's reveal comes as a look: "Surging Dementia: look at these cards (your library)", hp-23 gap)
      const ripple = /^look at these cards$/i.test(String(title)) && String(prompt.sourceAbilityText || "").match(/^Ripple (\d+) - /)?.[1];
      const revealedNow = instead || ripple || / - Revealing cards from$/i.test(String(title))
        // (an opponent's searched card shown from their hand as the ability reveals it: the AI's Sylvan Scrying read "White
        // looked at a card (AI 1's hand)", hp-23 gap)
        || (/^look at these cards$/i.test(String(title)) && input.zone === "hand" && String(input.ownerPlayerId || "").replace("-view", "") !== seat.slot
          && /\breveal (?:it|that card|them|those cards)\b/i.test(abilityWords))
        // (not a search's look: Cultivate's "reveal those cards" is the found lands; its look at the whole library was
        // logged to the table card by card, hp-02 #6 2026-10-28)
        || (/^look at these cards$/i.test(String(title)) && /\breveals?\b/i.test(abilityWords) && !/\blook at\b/i.test(abilityWords) && !/\bsearch (?:your|their) library\b/i.test(abilityWords));
      const shownIds = input.cards.map((c) => c.id).join(",");
      if (seat.lastShown && seat.lastShown.ids === shownIds && seat.lastShown.src === src && Date.now() - seat.lastShown.at < 15000) {
        seat.respond(prompt.promptId, type, { type: "revealCardsAcknowledged" });
        return;
      }
      seat.lastShown = { ids: shownIds, src, at: Date.now() };
      // (Forge's trailing " - " left out: "revealed for Explore - (your library)", hp-06 #16)
      // (Forge's "Face-down card leaves the <player>'s Battlefield:" read "... the AI 1's Battlefield: (AI 1's graveyard)",
      // hp-20 gap)
      ui = { title: `${revealedNow ? "Revealed" : String(title || "").replace(/\s+-\s*$/, "").replace(/^Face-down card leaves the (.+?)'s Battlefield:?$/i, "A face-down card left $1's battlefield") || "Revealed"}${input.ownerPlayerId ? ` (${String(input.ownerPlayerId).replace("-view", "") === seat.slot ? "your" : `${nameOf(String(input.ownerPlayerId).replace("-view", ""))}'s`} ${input.zone})` : ""}`, mode: "single",
        text: input.cards.map((c) => cardLabel(c)).join(", "), options: [{ id: "ok", label: "OK" }],
        show: input.cards.slice(0, 7).map((c) => ({ n: cardLabel(c), img: imgOf(c) })) }; // pictures in the card row
      if (instead) ui.title = `${instead.name}: revealed until a ${instead.text} card (your library)`;
      // (its "Do you want to play X?" next is the free cast, as cascade's is)
      if (ripple) { ui.title = `${src ? `${src}: ` : ""}ripple ${ripple}: revealed from the top of your library`; seat.note("exiledHit", null, src, "ripple"); }
      // a search for a named card that isn't there: Forge shows the whole library as "Look at these cards"; say it found
      // nothing (Partner with, no Alphinaud Leveilleur in the deck, hp-06 2026-10-28)
      const ownerSlot = String(input.ownerPlayerId || "").replace("-view", ""), mine = ownerSlot === seat.slot;
      const ownLibrary = mine && input.zone === "library";
      // (cards exiled from the top until a hit, by its keyword: Chimil's discover 5 read "Look at these cards (your
      // library)", hp-10)
      // (and Forge's "Cascade - <card>" with no reminder: Throes of Chaos's read the same, hp-15)
      const cascadeSaid = /^Cascade\b/i.test(String(prompt.sourceAbilityText || ""));
      const exiledTop = ownLibrary && (cascadeSaid || /\bexile cards from the top of your library until\b/i.test(abilityWords));
      if (exiledTop) {
        const kw = cascadeSaid ? "cascade" : abilityWords.match(/\b(discover \d+|cascade)\b/i)?.[1];
        // (its "Do you want to play X?" next comes with no ability text: remembered so it reads as the free cast it is)
        seat.note("exiledHit", null, src, kw ? kw.toLowerCase().replace(/ \d+$/, "") : "");
        // (named here, so the board's "exiled from White's library" line leaves them out: Improvisation Capstone's four read
        // twice, hp-23 gap)
        if (game) game.exiledSaid = new Set(input.cards.map((c) => c.id));
        ui.title = `${src ? `${src}: ` : ""}${kw ? `${kw.toLowerCase()}: ` : ""}cards exiled from the top of your library`;
      }
      const sought = ownLibrary && abilityWords.match(/\bput (.+?) into (?:your|their) hand from (?:your|their) library\b/i)?.[1];
      // (and a search for a kind of card, none there: Verdant Catacombs' "a Swamp or Forest card" with no such card,
      // hp-01 #3 2026-10-28. A kind of words without a comma or "card": "a card, put that card" is any card, hp-02 #4.
      // Known words only, each a type or supertype or a capitalised subtype or name: "a green creature card", "a nonland
      // card" read "no ... in your library" with such cards there; and not one kind of two, "... or a Gate card", suite
      // review 2026-10-28)
      const kindAt = ownLibrary && !sought && abilityWords.match(/\bsearch your library for (?:an?|up to \w+) ((?:(?!cards?\b)[\w'-]+ )*?(?:(?!cards?\b)[\w'-]+)(?: or (?:(?!cards?\b)[\w'-]+ ?)+?)?) cards?\b(?! or an? )/i);
      const known = (w) => /^(?:basic|legendary|snow|land|creature|artifact|enchantment|instant|sorcery|planeswalker|battle|kindred|tribal|or)$/i.test(w) || /^[A-Z]/.test(w);
      const kind = kindAt && kindAt[1].split(/\s+/).every(known) ? kindAt[1] : null;
      const anyCard = ownLibrary && /\bsearch your library for (?:an?|up to \w+) cards?\b/i.test(abilityWords);
      const fits = (c, term) => term.toLowerCase().split(/\s+/).filter(Boolean).every((w) => [c.identity?.name, ...(c.types || []), ...(c.subtypes || []), ...(c.supertypes || [])]
        .some((x) => String(x || "").toLowerCase() === w));
      const found = sought ? input.cards.some((c) => c.identity?.name === sought) : kind ? input.cards.some((c) => kind.split(/\s+or\s+/).some((t) => fits(c, t))) : anyCard ? input.cards.length > 0 : null;
      const notFound = found === false;
      if (notFound) { ui.title = `${src ? `${src}: ` : ""}no ${sought || `${kind} card`} in your library`; ui.text = `Your library, as the search saw it: ${ui.text}`; }
      // the card into the hand next was searched for, not drawn (see logEvents): a look at your own library, not a reveal's
      // (Parley's draw that follows is a draw) unless it puts the card into your hand (Hermit Druid's Mountain read "White
      // draws a card", hp-01 #2), and not a search that found nothing (a draw follows)
      // (and "that player puts it into their hand": Goblin Guide's land read "White draws a card", hp-24 gap)
      const searchNote = ownLibrary && !notFound && (!revealedNow || instead || /\bputs? (?:that card|it|them|those cards)\b[^.]*\binto (?:your|their) hand\b/i.test(abilityWords));
      // (not a search that puts its card on top: the draw after it is a draw; Kenrith's just after Enlightened Tutor read
      // "puts a card from their library into their hand", hp-23 gap)
      if (searchNote && !/\bputs? (?:that card|it|them|those cards) on top\b/i.test(abilityWords)) seat.note("search", seat.slot);
      // (a look at your own library before a search understood to have something to find: the search's choice follows,
      // so it isn't asked; Demonic Tutor asked OK on the whole library, then the search, hp-02 #5. Shown when the search
      // wasn't understood: nothing else would show it, suite review)
      if (ownLibrary && found === true && !revealedNow && /\bsearch your library\b/i.test(abilityWords)) {
        seat.respond(prompt.promptId, type, { type: "revealCardsAcknowledged" });
        return;
      }
      // (Hideaway's look: its pick that follows shows the same cards; Mosswort Bridge asked OK over them first, hp-16)
      if (ownLibrary && !revealedNow && /\blook at the top \w+ cards of your library, exile one face down\b/i.test(abilityWords)) {
        seat.respond(prompt.promptId, type, { type: "revealCardsAcknowledged" });
        return;
      }
      // and in the game log, so it can be read again after Resolve. Only what is revealed goes there by name: a look at
      // your own library or hand ("Look at these cards") is private, and the log is the whole table's (playtest
      // 2026-10-26: the log listed a searched library card by card)
      if (game) {
        // (an opponent's pick from their library that Forge shows to the others, "AI 1 picked", is revealed)
        const revealed = revealedNow || /reveal/i.test(String(title)) || !["library", "hand"].includes(input.zone) || (!mine && !/^look at/i.test(String(title)));
        const owner = mine ? seat.color : nameOf(ownerSlot);
        const said = instead ? instead.name : src;
        // (cards exiled face up are the table's to see: the Tenth Doctor's read "White looked at a card (their library)",
        // hp-21 gap)
        const line = exiledTop ? `${seat.color} exiles from the top of their library${said ? ` (${said})` : ""}: ${ui.text}`
          : revealedNow ? `${seat.color} saw: ${said ? `${said}: ` : ""}revealed from ${owner}'s ${input.zone}: ${ui.text}`
          : revealed ? `${seat.color} saw: ${ui.title}: ${ui.text}`
          : `${seat.color} looked at ${countWords(input.cards.length, input.cards.length, "card")} (${mine ? "their" : `${nameOf(ownerSlot)}'s`} ${input.zone})`;
        gameLogLine(line);
      }
      toOutput = () => ({ type: "revealCardsAcknowledged" });
      break;
    case "diceRolled": {
      const rolls = asList(input.rolls);
      const first = rolls.find((r) => r.highlighted);
      // (the table's names: the engine's label is the account name, "self-hosted-node-…-bot", playtest 2026-10-27)
      const who = (r) => game.slotNames[r.playerId] || displayText(r.label) || r.playerId;
      const said = `${rolls.map((r) => `${who(r)} rolled ${asList(r.finalResults).join("+")}`).join(", ")}${first ? `: ${who(first)} goes first` : ""}`;
      if (game.lastDiceSaid !== said) { game.lastDiceSaid = said; chat(`[MTG] Dice roll: ${said}.`); }
      seat.respond(prompt.promptId, type, { type: "diceRolledAcknowledged" });
      return;
    }
    case "reorder": {
      const src = prompt.sourceCard?.identity?.name;
      // the cards just chosen for this same card (Sylvan Library's two): their order only decides which "pay 4 life?"
      // comes first, and after a No the player picks which card goes back anyway, so it isn't asked
      const u = src && seat.unless?.src === src && !seat.unless.awaitingPick ? seat.unless : null;
      if (u && input.items.length === u.ids.length && input.items.every((i) => u.ids.includes(i.card?.id))) {
        seat.respond(prompt.promptId, type, { type: "reorderDecision", orderedIds: input.items.map((i) => i.id) });
        return;
      }
      // In plain words (playtest 2026-10-22: "pick #1 ... in the order the engine asks for" was confusing). Triggers:
      // the first in the list resolves first (Manabrew's own client: "Leftmost resolves first"). Cards put back on the
      // library: the LAST in the list ends on top (headless Ponder, kept order Abundance, Command Tower, Swamp: it drew
      // Swamp, then Command Tower), so the player picks top first and the list is turned round. Cards bound for the
      // bottom: the order rarely matters.
      const what = `${prompt.sourceAbilityText || ""} ${prompt.sourceCard?.text || ""}`;
      // (and "the rest on the bottom", Ripple's: Surging Dementia's three asked "click the card to put on top", hp-23 gap)
      const trig = /^Order triggered abilities/i.test(title), bottom = /bottom of [^.]*library in any order|\bthe rest on the bottom of (?:your|their) library\./i.test(what);
      const onTop = !trig && !bottom && !!src && /library/i.test(what);
      const [words, hint] = trig
        ? [(n) => `Your triggers: click the one that happens ${n ? "next" : "first"}`, "The one you click first happens first. Not sure? Keep this order."]
        : bottom
          ? [(n) => `${src || title}: these go to the bottom of your library${n ? ` (${n + 1})` : ""}`, "The order on the bottom hardly matters: Keep this order is fine."]
          : onTop
            ? [(n) => `${src}: click the card to put ${n ? `next (number ${n + 1} from the top)` : "on top"}`, "Your library's top card first. Not sure? Keep this order."]
            : [title || "Put these in order", "Pick what goes first. Not sure? Keep this order."];
      // (to the bottom: the order hardly ever matters, so the engine's order is kept without asking, 2026-10-22 review)
      // (nor does the order an "exile all" effect takes permanents in: Sunfall asked "Sunfall: pick #1" over six creatures,
      // hp-09)
      const exileAll = !trig && /\bexile all\b/i.test(prompt.sourceAbilityText || "")
        && input.items.every((i) => (gv.zones || []).some((z) => z.zone === "battlefield" && (z.cards || []).some((c) => c.id === i.id)));
      // (nor the order of things that are all the same once Forge's object numbers are out: Flusterstorm's three storm
      // copies asked "click the one that happens first" over "Flusterstorm (145) - Counter Chart a Course (61) unless...",
      // hp-08 gap)
      const plain = (i) => `${cardLabel(i.card)}|${withoutForgeNotes(String(i.oracle || "")).replace(/ \(\d+\)/g, "")}`;
      const allSame = input.items.length > 1 && input.items.every((i) => plain(i) === plain(input.items[0]));
      // (nor the order lands are put onto the battlefield together: Animist's Awakening's four lands asked "click the card
      // to put on top", hp-15 gap)
      const landsDown = !trig && input.items.length > 0 && input.items.every((i) => (i.card?.types || []).includes("Land"))
        && /\bland cards?\b[^.]*\bonto the battlefield\b/i.test(prompt.sourceAbilityText || "");
      if (bottom || exileAll || allSame || landsDown) { seat.respond(prompt.promptId, type, { type: "reorderDecision", orderedIds: input.items.map((i) => i.id) }); return; }
      // (Forge's object numbers left out of what is shown: "Counter Chart a Course (61)")
      const items = input.items.map((i) => ({ id: i.id, label: cardLabel(i.card) + (i.oracle ? `: ${shorten(withoutForgeNotes(String(i.oracle)).replace(/ \(\d+\)/g, ""), 60)}` : ""), img: imgOf(i.card) }));
      const step = orderSteps(words, hint, onTop ? [...items].reverse() : items,
        (ids) => ({ type: "reorderDecision", orderedIds: onTop ? [...ids].reverse() : ids }));
      if (step.auto) { seat.respond(prompt.promptId, type, step.auto); return; }
      ({ ui, toOutput } = step);
      break;
    }
    case "chooseDamageAssignmentOrder": {
      const step = orderSteps(`Order blockers for ${cname(input.attackerId)}`, "Damage is assigned to the first one first.",
        input.blockerIds.map((b) => ({ id: b, label: cardLabel(byId[b]), img: imgOf(byId[b]) })),
        (ids) => ({ type: "damageAssignmentOrderDecision", orderedBlockerIds: ids }));
      if (step.auto) { seat.respond(prompt.promptId, type, step.auto); return; }
      ({ ui, toOutput } = step);
      break;
    }
    case "chooseCombatDamageAssignment": {
      const lethalOf = (b) => {
        const c = byId[b];
        return input.attackerHasDeathtouch ? 1 : Math.max(1, (Number(c?.toughness) || 1) - (c?.damage || 0));
      };
      const assignees = input.blockerIds.map((b) => ({ id: b, label: cname(b), lethal: lethalOf(b), img: imgOf(byId[b]) }));
      if (input.defenderId) assignees.push({ id: input.defenderId, label: cname(input.defenderId), lethal: 0 });
      const done = (assignments) => ({ type: "combatDamageAssignmentDecision", assignments });
      const auto = () => {
        let left = input.totalDamage;
        const out = [];
        assignees.forEach((a, i) => {
          const last = i === assignees.length - 1;
          const dmg = last ? left : Math.min(left, a.lethal);
          if (dmg > 0) out.push({ assigneeId: a.id, damage: dmg });
          left -= dmg;
        });
        return done(out);
      };
      if (assignees.length <= 1) { seat.respond(prompt.promptId, type, auto()); return; }
      ui = { title: `${cname(input.attackerId)}: assign ${input.totalDamage} combat damage`, mode: "single",
        text: `Blocked by ${input.blockerIds.map(cname).join(", ")}${input.defenderId ? ` (trample: the rest can go to ${cname(input.defenderId)})` : ""}. Auto-assign: enough to destroy each blocker in order, the rest to the last.`,
        options: [{ id: "auto", label: "Auto-assign" }, { id: "hand", label: "Assign it myself" }] };
      toOutput = (a) => {
        if (a[0] === "auto") return auto();
        const step = damageSteps(input.totalDamage, assignees, done);
        return step.auto ?? next(step.ui, step.toOutput);
      };
      break;
    }
    case "gameOver": {
      const why = lossReasons(gv);
      chat(why ? `[MTG] Game over: ${why}.` : `[MTG] Game over.`, seat.color);
      // (and in the game log, once: White's loss to an empty library under Reforge the Soul ended it unsaid, hp-15 gap)
      if (game && !game.over) gameLogLine(why ? `Game over: ${why}` : "Game over");
      if (game) game.over = true;
      clearResume(); // (a finished game is never rejoined)
      return;
    }
    default:
      log(`${seat.color}: unhandled prompt ${type}`);
      chat(`[MTG] Unsupported prompt "${type}" — answering with defaults is not possible yet.`, seat.color);
      return;
  }
  ui.kind ??= PROMPT_KIND[type] || type;
  if (!ui.show && prompt.sourceCard && ["yesno", "modal", "color", "number", "damage"].includes(ui.kind) && imgOf(prompt.sourceCard)) {
    ui.show = [{ n: cardLabel(prompt.sourceCard), img: imgOf(prompt.sourceCard) }];
  }
  if (type === "mulliganPutBack" || (type === "chooseCards" && toLibrary(title))) ui.dest = "library";
  ({ title: ui.title, text: ui.text } = plainQuestion(ui.title, ui.text));
  // the asking card's name in front of the question (Arena's "Card: question"), not a "Source:" line under it
  // (a title that already has its own heading, "Scry 1: where does ... go?", gets no second one)
  if (src && ui.title && !/^[^:]{1,40}: /.test(String(ui.title)) && !String(ui.title).toLowerCase().includes(src.toLowerCase()) && !["priority", "mana", "attack", "block"].includes(ui.kind)) ui.title = `${src}: ${ui.title}`;
  arenaWords(ui, src, seat.slot);
  // (Forge repeats a replacement effect's text in its title: said once)
  const ability = prompt.sourceAbilityText && !String(ui.text || "").includes(String(prompt.sourceAbilityText).slice(0, 60))
    ? shorten(String(prompt.sourceAbilityText), 160) : null;
  ui.text = displayText([ui.text, ability].filter(Boolean).join("\n"));
  ui.text = plainWords(ui.text);
  ui.title = plainWords(displayText(ui.title));
  if (ui.options) ui.options = ui.options.map((o) => ({ ...o, label: plainWords(displayText(o.label)) })); // keeps id/cardId
  ui.min ??= 1; ui.max ??= 1;
  // Lists of cards, targets, types or pairs read better A-Z (the engine gives them in no useful order).
  // (unless the question put its own first: a text change's word list, the target's words first)
  if (ui.mode === "multi" && ui.options && !ui.keepOrder) {
    const quick = ui.options.filter((o) => String(o.id).startsWith("__"));
    ui.options = [...quick, ...ui.options.filter((o) => !String(o.id).startsWith("__")).sort((x, y) => String(x.label ?? "").localeCompare(String(y.label ?? "")))];
  }
  // Test mode (start with autoplay: true): the bridge answers every prompt itself with the first choice and TTS gets
  // nothing, so TTS's frame rate can be measured while only Forge is busy (the CPU-contention test).
  if (game?.autoplay) {
    const auto = ui.mode === "number" ? [String(ui.min ?? 0)]
      : ui.mode === "multi" ? (ui.options || []).filter((o) => !String(o.id).startsWith("__")).slice(0, ui.min || 0).map((o) => o.id)
      : [(ui.options || []).find((o) => o.id !== "__endturn" && o.id !== "__resolve")?.id ?? (ui.options || [])[0]?.id];
    seat.respond(prompt.promptId, type, toOutput(auto.map(String)));
    return;
  }
  seat.prompt = { promptId: prompt.promptId, type, toOutput, input, sentAt: performance.now(), picks: [], ui };
  if (process.env.MTG_TRACE) log(`prompt ${seat.color} #${prompt.promptId}: ${type} "${ui.title}"`);
  toTTS({ t: "prompt", color: seat.color, promptId: prompt.promptId, ...ui });
  armTimer(seat);
}

// ───────────────────────── Turn timers (host's toggle, "mtg timer") ─────────────────────────
// Arena's model: seconds per decision, then a personal time bank that refills a little each of your turns; a warning
// near the end; at zero the question takes its safest answer (timeoutChoice). Paused during a manual fix or rewind vote.
// Nobody is conceded for timing out: the host decides that.
const TIMER_DEFAULT = 60, TIMER_BANK = 120, TIMER_REFILL = 15, TIMER_WARN = 15;
function stopTimer(seat, keepBank) {
  clearTimeout(seat.timerWarn); clearTimeout(seat.timerEnd);
  if (seat.timerFrom != null && !keepBank) {
    const used = (Date.now() - seat.timerFrom) / 1000 - (game?.timer?.seconds ?? 0);
    if (used > 0) seat.timeBank = Math.max(0, (seat.timeBank ?? TIMER_BANK) - used);
  }
  seat.timerFrom = null;
}
function armTimer(seat) {
  stopTimer(seat, true);
  const t = game?.timer;
  if (!t?.on || !seat.prompt) return;
  const gv = seat.board?.state?.gameView || {};
  seat.timeBank ??= TIMER_BANK;
  if (gv.activePlayerId === seat.slot && seat.timerTurn !== gv.turn) {
    if (seat.timerTurn != null) seat.timeBank = Math.min(TIMER_BANK, seat.timeBank + TIMER_REFILL);
    seat.timerTurn = gv.turn;
  }
  const total = t.seconds + seat.timeBank, promptId = seat.prompt.promptId;
  seat.timerFrom = Date.now();
  if (total > TIMER_WARN) seat.timerWarn = setTimeout(() => guarded("timer warning", () => { if (seat.prompt?.promptId === promptId) chat(`[MTG] ${seat.color}: ${TIMER_WARN} seconds left to answer.`); }), (total - TIMER_WARN) * 1000);
  seat.timerEnd = setTimeout(() => guarded("timer", () => timerExpired(seat, promptId)), total * 1000);
  seat.timerWarn?.unref?.(); seat.timerEnd.unref?.();
}
// The safest legal answer to what's on screen: pass, keep, no attackers or blockers, No, cancel a payment; else the
// question's first legal picks.
function timeoutChoice(ui) {
  if (ui.mode === "number") return [String(ui.min ?? 0)];
  const ids = (ui.options || []).map((o) => String(o.id));
  if (ui.mode === "multi") return ids.filter((id) => !id.startsWith("__")).slice(0, ui.min || 0);
  return [["__pass", "keep", "__cancel", "__auto", "__keep", "auto", "ok", "no"].find((id) => ids.includes(id)) ?? ids[0]];
}
function timerExpired(seat, promptId) {
  if (seat.prompt?.promptId !== promptId) return;
  // (a manual fix or a rewind vote holds the game: everyone's clock waits)
  if (game?.fix || seat.board?.state?.gameView?.restoreVote) { armTimer(seat); return; }
  seat.timeBank = 0; seat.timerFrom = null;
  chat(`[MTG] ${seat.color} ran out of time: ${seat.prompt.ui?.title || "the question"} took its default answer.`);
  // (a question of several steps keeps its id: each step answered in turn)
  for (let i = 0; i < 12 && seat.prompt?.promptId === promptId; i++) {
    const before = seat.prompt.ui;
    onAnswer(seat.color, promptId, timeoutChoice(before));
    if (seat.prompt?.promptId === promptId && seat.prompt.ui === before) break;
  }
}
function setTimer(on, seconds) {
  if (!game) { chat("[MTG] Timer: no game running."); return; }
  const s = Math.floor(Number(seconds));
  game.timer = { on: !!on, seconds: s >= 10 && s <= 600 ? s : game.timer?.seconds ?? TIMER_DEFAULT };
  for (const seat of game.seats.values()) armTimer(seat);
  chat(on ? `[MTG] Turn timers on: ${game.timer.seconds} seconds a decision, plus a ${TIMER_BANK}-second time bank that refills ${TIMER_REFILL} each of your turns.` : "[MTG] Turn timers off.");
}

// ───────────────────────── Table gestures (SPEC §10a) ─────────────────────────
// The table reports what a player physically did; the bridge turns it into the engine action it means,
// or refuses it (the card snaps back) with a reason.
// The seat's open question is answered or gone: forget it and take it off the player's panel.
function closePrompt(seat) {
  stopTimer(seat);
  seat.prompt = null;
  toTTS({ t: "prompt", color: seat.color, promptId: null });
}

function refuse(seat, cardId, reason) {
  chat(`[MTG] ${reason}`, seat.color);
  toTTS({ t: "refused", color: seat.color, id: cardId });
}

function cardNameIn(seat, cardId, fallback = "That card") {
  return cardIndex(seat.board?.state?.gameView || {})[cardId]?.identity?.name || fallback;
}
// The seat playing a slot (undefined for an AI's)
function seatOfSlot(slot) { return game?.seats.get(game.slotColor[slot]); }

function whyNot(seat, cardId) {
  const gv = seat.board?.state?.gameView || {};
  const card = cardIndex(gv)[cardId];
  const name = card?.identity?.name || "That card";
  const me = (gv.players || []).find((p) => p.id === seat.slot);
  const types = card?.types || [];
  const myMain = gv.activePlayerId === seat.slot && /main/i.test(gv.step || "") && !(gv.stack || []).length;
  if (card?.phasedOut) return `${name} is phased out: it counts as not there until it phases in.`;
  if (gv.priorityPlayerId !== seat.slot) return `${name}: wait, it isn't your priority.`;
  // (a permanent already on the battlefield is not played: Arena of Glory, its one ability a mana ability, read "lands
  // can only be played in your main phase with an empty stack" in the main phase, hp-09)
  if ((gv.zones || []).some((z) => z.zone === "battlefield" && (z.cards || []).some((c) => c.id === cardId))) {
    const mana = /(?:^|\n)[^:\n]*:\s*Add \{/.test(String(card?.text || ""));
    return `${name}: none of its abilities can be used right now${mana ? " (a mana ability is used while paying a cost: tap it then)" : ""}.`;
  }
  if (types.includes("Land")) {
    if (gv.activePlayerId !== seat.slot) return `${name}: lands can only be played on your turn.`;
    if (me && me.landsPlayedThisTurn >= (me.maxLandPlaysPerTurn || 1)) return `${name}: you already played a land this turn.`;
    return `${name}: lands can only be played in your main phase with an empty stack.`;
  }
  const instantSpeed = types.includes("Instant") || (card?.keywords || []).some((k) => /flash/i.test(k));
  if (!instantSpeed && !myMain) return `${name}: only at sorcery speed (your main phase, empty stack).`;
  return `${name}: can't be cast right now (not enough mana, no legal targets, or another restriction).`;
}

// "If you cast it any time a sorcery couldn't have been cast, ... sacrifices it at the beginning of the next cleanup
// step" (Necromancy, and cards worded like it): read from the rules text, not a list of names
function sacrificedIfInstant(card) {
  const text = String(card?.text || "");
  return /any time a sorcery couldn.t have been cast/i.test(text) && /sacrifices? it/i.test(text);
}
// your own main phase with an empty stack: when a sorcery could be cast
function sorceryTime(seat, gv) {
  return gv.activePlayerId === seat.slot && /main/i.test(gv.step || "") && !(gv.stack || []).length;
}

function onIntent(m) {
  if (process.env.MTG_TRACE) log(`intent ${m.color}: ${m.kind} ${m.id} (${cardNameIn(game?.seats.get(m.color) || {}, m.id)})`); // eslint-disable-line no-param-reassign
  const seat = game?.seats.get(m.color);
  if (!seat || !game.started) return;
  const p = seat.prompt;
  const input = p?.input || {};
  const name = cardNameIn(seat, m.id);
  // "Pay ..., or else ..." answered by doing the "or else" by hand: Sylvan Library's card dragged onto the library puts
  // it back, Mystic Remora dragged to the graveyard is sacrificed (both = No; see chooseBoolean's otherwiseDo)
  if (p?.type === "chooseBoolean" && p.ui?.aboutCards?.includes(m.id) && p.ui.otherwiseDo && p.ui.otherwiseDo === { bottom: "library", sacrifice: "sacrifice" }[m.kind]) {
    // (Sylvan Library: the "which card goes back?" that follows a No is answered with this card)
    if (p.ui.otherwiseDo === "library" && seat.unless) { seat.unless.awaitingPick = true; seat.unless.putBack = m.id; }
    closePrompt(seat);
    seat.respond(p.promptId, "chooseBoolean", { type: "decision", value: false });
    return;
  }
  if (p?.type === "chooseBoolean" && p.ui?.aboutCards && p.ui.otherwiseDo === { bottom: "library", sacrifice: "sacrifice" }[m.kind]) {
    return refuse(seat, m.id, `This question is about ${p.ui.aboutCards.map((id) => cardNameIn(seat, id)).join(" or ")}: drag ${p.ui.aboutCards.length > 1 ? "one of those" : "that one"}, or use the buttons.`);
  }
  if (m.kind === "play") {
    if (!p || p.type !== "chooseAction") {
      // not this player's priority now: kept for their next one (see the chooseAction case), unless it is a land
      const card = cardIndex(seat.board?.state?.gameView || {})[m.id];
      if (card && !(card.types || []).includes("Land")) {
        seat.queuedPlay = { id: m.id, at: Date.now() };
        refuse(seat, m.id, `${name}: you'll cast it at your next chance (it isn't your priority right now).`);
        return;
      }
      return refuse(seat, m.id, whyNot(seat, m.id));
    }
    let acts = (input.actions || []).filter((a) => a.cardId === m.id && a.type !== "undoMana" && !a.isManaAbility);
    if (!acts.length) {
      // the engine offers one "Play Island" for all your Islands: playing another copy uses that action
      const zones = seat.board?.state?.gameView?.zones || [];
      const zoneOf = (id) => zones.find((z) => (z.cards || []).some((c) => c.id === id));
      const byId = cardIndex(seat.board?.state?.gameView || {});
      acts = (input.actions || []).filter((a) => a.cardId !== m.id && a.type !== "undoMana" && !a.isManaAbility
        && byId[a.cardId]?.identity?.name === name && zoneOf(a.cardId) && zoneOf(a.cardId) === zoneOf(m.id));
    }
    if (!acts.length) return refuse(seat, m.id, whyNot(seat, m.id));
    // A card that can be played more than one way (a modal double-faced card: cast the spell or play the land; an
    // adventure; a split card): ask, as Arena does, instead of taking the first. "Back" returns to the open question.
    const ways = [];
    for (const a of acts) if (!ways.some((w) => (w.label || w.description || w.id) === (a.label || a.description || a.id))) ways.push(a);
    if (ways.length > 1) {
      const prev = { ui: seat.prompt.ui, toOutput: seat.prompt.toOutput };
      // (a keyword's way without its reminder sentence, its cost kept: Foretell's button read "Foretell (During your turn,
      // you may pay {2} and exile", cut there, hp-06 2026-10-28)
      const wayLabel = (a) => {
        // (the harness's short name for More Than Meets the Eye: "Cast Starscream, Seeker Leader (MTMtE)", hp-17)
        const l = String(a.label || a.description || (a.type === "cast" ? `Cast ${name}` : "Use its ability")).replace(`${name}: `, "")
          .replace(/\(MTMtE\)$/, "(More Than Meets the Eye)");
        // (a split card cast whole is its fuse: "Cast Turn // Burn" beside "Cast Turn" and "Cast Burn", hp-15)
        if (a.type === "cast" && name.includes(" // ") && l === `Cast ${name}`) return "Cast both halves (fuse)";
        // (a reminder sentence only: "Cast X (WebSlinging)" names the way, and keeps its brackets)
        const m = l.match(/^([^()]+?) \((.+\.)\)$/);
        if (!m || m[1].includes("{")) return m ? m[1] : l;
        const pay = m[2].match(/\bpay ((?:\{[^}]+\})+)/i);
        return pay ? `${m[1]} (pay ${pay[1]})` : m[1];
      };
      const ui = prepareUi({ title: `${name}: how do you play it?`, text: "", mode: "single", kind: "choice", min: 1, max: 1,
        options: [...ways.map((a) => ({ id: String(a.id), label: wayLabel(a) })), { id: "__back", label: "Back" }] });
      seat.prompt = { ...seat.prompt, ui,
        toOutput: (picks) => (picks[0] === "__back" ? { __next: { ...prev, returns: m.id } } : { type: "act", actionId: ways.find((a) => String(a.id) === picks[0])?.id ?? picks[0] }) };
      toTTS({ t: "prompt", color: seat.color, promptId: p.promptId, step: Date.now() % 100000, ...ui });
      return;
    }
    const act = acts.find((a) => a.mode?.type === "normal") || acts[0];
    // Necromancy and the like: cast when a sorcery couldn't be, it is sacrificed at the next cleanup step (and the
    // creature it brought back with it). Ask first (playtest 2026-10-25: Necromancy cast in the draw step; the
    // Obliterator it returned was gone half a second later and it looked like the table had lost it)
    const gv = seat.board?.state?.gameView || {};
    if (act.type === "cast" && sacrificedIfInstant(cardIndex(gv)[m.id]) && !sorceryTime(seat, gv)) {
      const prev = { ui: seat.prompt.ui, toOutput: seat.prompt.toOutput };
      const ui = prepareUi({ title: `${name}: cast it now?`, mode: "single", kind: "choice", min: 1, max: 1,
        text: `Cast now, outside your main phase, ${name} is sacrificed at the next cleanup step, and whatever it brings back goes with it. Cast it in your main phase to keep it.`,
        options: [{ id: String(act.id), label: "Cast anyway" }, { id: "__back", label: "Wait (keep it)" }] });
      seat.prompt = { ...seat.prompt, ui, toOutput: (picks) => (picks[0] === "__back" ? { __next: { ...prev, returns: m.id } } : { type: "act", actionId: act.id }) };
      toTTS({ t: "prompt", color: seat.color, promptId: p.promptId, step: Date.now() % 100000, ...ui });
      return;
    }
    closePrompt(seat);
    seat.respond(p.promptId, "chooseAction", { type: "act", actionId: act.id });
    // A land that went straight back to the hand (Dimir Aqueduct and the other bounce lands return a land you
    // control, themselves if there's no other): the player saw the card jump back and thought the drop was ignored.
    // (only a land that says so: Power Depot, still in the hand while its "which applies first?" question was open,
    // was called one, hp-12 #6 2026-10-27)
    const played = cardIndex(seat.board?.state?.gameView || {})[m.id];
    if ((played?.types || []).includes("Land") && /\breturn (?:a|target) land you control\b/i.test(String(played?.text || ""))) {
      const thisGame = game;
      setTimeout(() => {
        if (game !== thisGame) return; // "mtg reset" since
        const gv = seat.board?.state?.gameView || {};
        if (zoneOf(gv, "hand", seat.slot).cards.some((c) => c.id === m.id)) {
          const others = zoneOf(gv, "battlefield", seat.slot).cards.some((c) => (c.types || []).includes("Land"));
          chat(others ? `[MTG] ${name} returned itself to your hand (it returns a land you control when it enters). That used your land drop for this turn.`
            : `[MTG] ${name} was played and came back to your hand: it returns a land you control when it enters, and it was your only land. That used your land drop for this turn; play another land first next time.`, seat.color);
        }
      }, 2500);
    }
    return;
  }
  // Equipment dropped onto one of your creatures: its Equip ability, aimed at that creature (playtest 2026-10-26:
  // "dragging equipment onto a creature does nothing", Arena equips that way). The target question that follows is
  // answered with the creature (chooseBoardTargets).
  if (m.kind === "attach") {
    if (!p || p.type !== "chooseAction") return refuse(seat, m.id, `${name} can't be attached right now.`);
    const act = (input.actions || []).find((a) => a.cardId === m.id && a.type === "activateAbility" && /^([^:(]*: )?(Equip|Reconfigure)\b/i.test(String(a.description || a.label || "")));
    if (!act) return refuse(seat, m.id, `${name} can't be attached right now (equip only in your main phase, with the stack empty and the mana for it).`);
    seat.attachTo = { source: m.id, to: String(m.to || ""), at: Date.now() };
    closePrompt(seat);
    seat.respond(p.promptId, "chooseAction", { type: "act", actionId: act.id });
    return;
  }
  // Tapping a land (Q/E) while you have priority: use its mana ability, so mana floats before you cast.
  if (m.kind === "tapmana") {
    if (!p || p.type !== "chooseAction") return refuse(seat, m.id, `${name} can't be used right now.`);
    let acts = (input.actions || []).filter((a) => a.cardId === m.id && a.isManaAbility);
    const act = (a) => { closePrompt(seat); seat.respond(p.promptId, "chooseAction", { type: "act", actionId: a.id }); };
    if (!acts.length) {
      // no mana ability: turning the card uses its other tap abilities (Hermit Druid's "{G}, {T}: reveal...", a fetch
      // land's "{T}, Pay 1 life, Sacrifice: search..."); with more than one, the player picks
      const taps = (input.actions || []).filter((a) => a.cardId === m.id && !a.isManaAbility && a.type !== "undoMana"
        && a.type !== "cast" && !/^play /i.test(a.label || "") && /\{T\}/.test(`${a.cost || ""} ${a.label || ""} ${a.description || ""}`));
      if (!taps.length) return refuse(seat, m.id, `${name} can't be tapped for anything right now.`);
      if (taps.length === 1) return act(taps[0]);
      acts = taps;
      const ui = prepareUi({ title: `${name}: which ability?`, mode: "single", cancel: true, kind: "choice",
        options: acts.map((a) => ({ id: a.id, label: a.label || a.description || a.id })) });
      const back = { ui: p.ui, toOutput: p.toOutput };
      seat.prompt = { ...p, ui, toOutput: (a) => (a[0] === "__cancel" ? (Object.assign(seat.prompt, back), next(back.ui, back.toOutput)) : { type: "act", actionId: a[0] }) };
      toTTS({ t: "prompt", color: seat.color, promptId: p.promptId, step: Date.now() % 100000, ...ui });
      return;
    }
    if (acts.length === 1) return act(acts[0]);
    // a land with a choice of colours: ask which, under the same prompt
    const ui = prepareUi({ title: `Tap ${name} for which mana?`, mode: "single", cancel: true, kind: "choice",
      options: distinctLabels(acts, (a) => manaLabel(a) || a.description || a.id).map((label, i) => ({ id: acts[i].id, label })) });
    const back = { ui: p.ui, toOutput: p.toOutput };
    seat.prompt = { ...p, ui, toOutput: (a) => (a[0] === "__cancel" ? (Object.assign(seat.prompt, back), next(back.ui, back.toOutput)) : { type: "act", actionId: a[0] }) };
    toTTS({ t: "prompt", color: seat.color, promptId: p.promptId, step: Date.now() % 100000, ...ui });
    return;
  }

  // Dragging one of your permanents to your graveyard: sacrifice it, if that is what the engine is asking.
  if (m.kind === "sacrifice") {
    const sacrifice = /sacrific/i;
    if (p?.type === "chooseCards" && (input.cards || []).some((c) => c.id === m.id)) {
      m = { ...m, kind: "choose" }; // collected like any other card choice below
    } else if (p?.type === "chooseAction") {
      const act = (input.actions || []).find((a) => a.cardId === m.id && !a.isManaAbility && sacrifice.test(`${a.cost || ""} ${a.description || ""}`));
      if (!act) return refuse(seat, m.id, `Nothing lets you sacrifice ${name} right now.`);
      closePrompt(seat);
      seat.respond(p.promptId, "chooseAction", { type: "act", actionId: act.id });
      return;
    } else if (p?.type === "chooseBoolean" && sacrifice.test(input.presentation?.title || "") && !/unless|pay/i.test(input.presentation?.title || "")
      && seat.lastRawPrompt?.sourceCard?.id === m.id) {
      // (before: any drag answered "yes" to any question mentioning a sacrifice, and in "sacrifice it unless you
      // pay" questions "yes" means pay)
      closePrompt(seat);
      seat.respond(p.promptId, "chooseBoolean", p.toOutput(["yes"]));
      return;
    } else if (p?.ui?.options?.some((o) => o.id === `card|${m.id}`) && (p.ui.mode === "single" || p.ui.max === 1)) {
      closePrompt(seat);
      seat.respond(p.promptId, p.type, p.toOutput([`card|${m.id}`]));
      return;
    } else {
      return refuse(seat, m.id, `${name} stays: nothing asks you to sacrifice it right now.`);
    }
  }

  // Dragging cards to answer "discard N" / "put N on the bottom": collect them until the count is reached.
  const wants = { discard: ["chooseCards"], bottom: ["mulliganPutBack", "chooseCards"], choose: ["chooseCards"] }[m.kind];
  if (!wants || !p || !wants.includes(p.type)) return refuse(seat, m.id, `${name} stays where it was: nothing asks you to do that right now.`);
  const allowed = p.type === "mulliganPutBack" ? input.handCardIds || [] : (input.cards || []).map((c) => c.id);
  const need = p.type === "mulliganPutBack" ? input.count : Math.max(1, input.min || 0);
  if (!allowed.includes(m.id)) return refuse(seat, m.id, `${name} isn't one of the cards you can choose.`);
  if (!p.picks.includes(m.id)) p.picks.push(m.id);
  if (p.picks.length < need) {
    // the table marks it chosen (it went back to the hand looking untouched, and a player dragged it again)
    toTTS({ t: "picked", color: seat.color, id: m.id });
    const verb = m.kind === "discard" ? "discard" : m.kind === "bottom" ? "put on the bottom" : "choose";
    return chat(`[MTG] ${name}: chosen to ${verb} (${p.picks.length} of ${need}). Drag ${need - p.picks.length} more.`, seat.color);
  }
  const picks = p.picks.slice(0, need);
  closePrompt(seat);
  seat.respond(p.promptId, p.type, p.type === "mulliganPutBack" ? { type: "mulliganPutBackDecision", cardIds: picks } : { type: "chooseCardsDecision", chosenCardIds: picks });
}

const GAME_LOG = path.join(__dirname, "game-log.txt");
function onGameLog(entry) {
  if (!entry?.message) return;
  const text = displayText(entry.message);
  fs.appendFile(GAME_LOG, `[${new Date().toISOString().slice(11, 19)}] ${entry.entryType}: ${text}
`, () => {});
  if (entry.entryType === "action" || entry.entryType === "stack") toTTS({ t: "log", text });
}

// Why an answer can't be sent to the engine (null when it fits): every pick is one of the question's options, none
// twice, Cancel only where the question allows it, a number within its range, exactly one pick for a single choice.
function answerProblem(ui, picks) {
  if (!ui) return null;
  const ids = new Set((ui.options || []).map((o) => String(o.id)));
  const strs = picks.map(String);
  if (strs[0] === "__cancel" && !ids.has("__cancel")) return ui.cancel ? null : "This question can't be cancelled.";
  if (ui.mode === "number") {
    const n = Number(strs[0]);
    return Number.isInteger(n) && n >= (ui.min ?? 0) && n <= (ui.max ?? n) ? null : `Pick a number from ${ui.min ?? 0} to ${ui.max}.`;
  }
  if (!ui.options) return null;
  if (ui.mode === "single" && strs.length !== 1) return "Pick one option.";
  if (strs.some((x) => !ids.has(x))) return "That isn't one of the options any more.";
  if (new Set(strs).size !== strs.length) return "The same option was picked twice.";
  return null;
}

function onAnswer(color, promptId, choice) {
  const seat = game?.seats.get(color);
  if (!seat?.prompt || Number(seat.prompt.promptId) !== Number(promptId)) return;
  const { type, toOutput } = seat.prompt;
  // TTS serialises an empty Lua table as {} rather than [].
  const picks = Array.isArray(choice) ? choice : choice && typeof choice === "object" ? Object.values(choice) : [choice];
  // A multi-choice answer outside min..max makes Forge throw and abort the whole game: refuse it and ask again.
  const ui = seat.prompt.ui;
  // a scry the table showed in the hand zone answers with its whole layout ("__tts", "top:<id>", "move:<id>"): not
  // option ids, so the count and id checks below don't apply; the scry's own reader keeps only this question's cards
  const ttsScry = ui?.scry && picks[0] === "__tts";
  if (!ttsScry && ui?.mode === "multi" && picks[0] !== "__cancel" && (picks.length < ui.min || picks.length > ui.max)) {
    chat(`[MTG] Choose ${ui.min === ui.max ? ui.min : `${ui.min}-${ui.max}`} (you chose ${picks.length}).`, color);
    toTTS({ t: "prompt", color, promptId, ...ui });
    return;
  }
  const problem = ttsScry ? null : answerProblem(ui, picks);
  if (problem) {
    log(`answer refused for ${color} #${promptId}: ${problem} (${JSON.stringify(picks).slice(0, 120)})`);
    chat(`[MTG] ${problem} Choose again.`, color);
    toTTS({ t: "prompt", color, promptId, ...ui });
    return;
  }
  const out = toOutput(picks.map(String));
  if (out && out.__next) {
    // a step-by-step choice: show the next step under the same engine prompt (after "Back" on a card dragged out to
    // be played, that card goes back where it came from: nothing else redraws it, playtest 2026-10-26)
    if (out.__next.returns) toTTS({ t: "refused", color, id: out.__next.returns });
    const ui2 = prepareUi(out.__next.ui);
    seat.prompt = { ...seat.prompt, ui: ui2, toOutput: out.__next.toOutput };
    toTTS({ t: "prompt", color, promptId, step: Date.now() % 100000, ...ui2 });
    return;
  }
  seat.respond(promptId, type, out);
  closePrompt(seat);
}

let roomRestarting = false; // a "docker compose restart" from "mtg reset" is running
const afterRestart = [];     // what to do once it is done (a Start pressed meanwhile)
// Restarts the Forge room (a fresh engine for the next game); `then` runs when it is back (or at once if a restart
// is already running, when that one finishes).
function restartRoom(then) {
  if (then) afterRestart.push(then);
  if (roomRestarting) return;
  roomRestarting = true;
  execFile("docker", ["compose", "-f", COMPOSE, "restart", "-t", "3", "forge-room"], (err) => {
    roomRestarting = false;
    if (err) log(`room restart failed: ${err.message}`);
    const next = afterRestart.splice(0);
    if (err) return chat(`[MTG] Restart failed: ${err.message}`);
    if (!next.length) return chat("[MTG] Forge room restarted. Press READY, then Start (or type \"mtg start\").");
    for (const f of next) guarded("start after restart", f);
  });
}

// ───────────────────────── TTS commands ─────────────────────────
function onTTS(m) {
  if (typeof m.json === "string") { try { m = { ...JSON.parse(m.json), t: m.t }; } catch { return log(`bad json payload for ${m.t}`); } }
  const said = tlogIn(m);
  if (said) tlog(m.color, said);
  switch (m.t) {
    case "tlog":
      // the table's own events, already one per line with the table's time and colour
      for (const line of String(m.lines || "").split("\n")) if (line) fs.appendFile(TABLE_LOG, `[table] ${line}\n`, () => {});
      break;
    case "check":
      noteCheck(m);
      break;
    case "hello":
      tableStamp = m.stamp ?? null;
      // (the table's repeat while it has drawn nothing, with no game running: nothing to send, suite review)
      if (m.again && !game?.started) break;
      log("TTS connected");
      if (!m.again) warnIfOutOfStep();
      if (game?.started && game.fromTable) resendToTable(); // the table was reloaded mid-game
      // (a table that drew nothing yet asks again: the greeting once is enough)
      if (!m.again) chat(`[MTG] Bridge connected (relay ${RELAY}). Type "mtg help".`);
      if (game) for (const s of game.seats.values()) { scheduleView(s); }
      break;
    case "start": {
      noteStamp(m);
      warnIfOutOfStep();
      const go = () => {
        startGame(asList(m.seats), Number(m.bots) || 0, !!m.requireReady, m.autoplay ? false : (m.fromTable ?? !!m.requireReady), asList(m.aiSeats));
        if (game && m.autoplay) game.autoplay = true;
      };
      // the table's Start button (autoReset): a game left over from before is reset first, and a room that is still
      // restarting is waited for, instead of "type mtg reset" / "room not found" (the user had to type commands)
      // a second Start while the first is still setting up (two arrived in the same instant, playtest 2026-10-25): it
      // took the half-built game for an old one, restarted the Forge room under it, and the game never started
      if (m.autoReset && ((game && !game.started && !game.abortSaid && Date.now() - (game.setupAt || 0) < START_SETUP_MS) || (roomRestarting && afterRestart.length))) {
        log("start ignored: a start is already being set up");
        break;
      }
      if (m.autoReset && (game || roomRestarting)) {
        // a game that ended (won, conceded, aborted) left its room in the lobby again (the relay resets it): the new
        // game starts there at once. Only a game cut off midway needs the Forge room restarted (15-30 s, playtest
        // 2026-10-23: "why does it take so long to restart a game?")
        const finished = game && !roomRestarting && (game.abortSaid || [...game.seats.values()].some((st) => st.board?.state?.gameView?.gameOver));
        if (finished) { resetGame("Starting a new game..."); go(); return; }
        // a game still running (the table was reloaded or TTS closed): Start brings it back instead of throwing it away.
        // Only while the engine still has it (every seat in its room with a board); otherwise the fresh setup below.
        const live = game?.started && game.fromTable && [...game.seats.values()].every((st) => st.roomId && st.board?.state && !st.closed);
        if (live && !roomRestarting) {
          log("start pressed with a game running: resuming it");
          resendToTable();
          chat("[MTG] Your game is still running: it's back on the table. To start a new one instead, the host types  mtg reset  first.");
          return;
        }
        if (game) resetGame("Starting fresh: restarting the Forge room, ~15 s...");
        restartRoom(go);
      } else go();
      break;
    }
    case "aideck": {
      const id = String(m.deck || "").trim();
      if (id === "clear") { aiDeckChoice.length = 0; chat("[MTG] AI players will use the default decks."); }
      // the list is replaced, one deck per AI player in order ("mtg aideck a b"): typing the same command again in the
      // next game added it a second time ("ai_passive_lands, ai_passive_lands", playtest 2026-10-26)
      else if (id && id.split(/[\s,]+/).every((x) => listCommanderPresets().includes(x))) { aiDeckChoice.splice(0, aiDeckChoice.length, ...id.split(/[\s,]+/)); chat(`[MTG] AI decks: ${aiDeckChoice.join(", ")} (before any deck lying in an empty seat).`); }
      else chat(`[MTG] Commander decks: ${listCommanderPresets().join(", ")}`);
      break;
    }
    case "reset":
      for (const c of Object.keys(readyDecks)) delete readyDecks[c]; // the next game reads decks from the table again
      if (roomRestarting) { chat("[MTG] Already restarting the Forge room, one moment..."); break; }
      resetGame("Resetting: restarting the Forge room, ~10 s...");
      restartRoom(null);
      break;
    case "deck":
      if (m.deck && listCommanderPresets().includes(String(m.deck))) { deckChoice[m.color] = m.deck; chat(`[MTG] ${m.color} will play ${m.deck}.`); }
      else chat(`[MTG] Commander decks: ${listCommanderPresets().join(", ")}`, m.color);
      break;
    case "decks":
      onDecks(m);
      break;
    case "intent":
      onIntent(m);
      break;
    case "autoresolve": {
      autoResolve[m.color] = m.on ? true : undefined;
      log(`${m.color}: auto-resolve ${m.on ? "on" : "off"}`);
      // a "Resolve" already waiting on someone else's turn goes at once
      const seat = game?.seats.get(m.color);
      if (seat) {
        if (m.on) seat.skipTo = null; // (one choice at a time: the list on the table has one setting)
        autoNotice(seat);
      }
      const gv = seat?.board?.state?.gameView;
      if (m.on && seat?.prompt?.type === "chooseAction" && gv && gv.activePlayerId !== seat.slot) {
        seat.respond(seat.prompt.promptId, "chooseAction", { type: "pass" });
        closePrompt(seat);
      }
      break;
    }
    case "skipto": {
      // "mtg skip <phase>" (or "off"): see SKIP_PHASES
      const seat = game?.seats.get(m.color);
      const phase = String(m.phase || "").trim().toLowerCase().replace(/^(?:my|my turn|my next turn|next turn)$/, "mine");
      if (!seat) { chat("[MTG] Skip: no game running.", m.color); break; }
      if (phase === "off" || phase === "") { seat.skipTo = null; autoNotice(seat); chat("[MTG] Skip off.", m.color); break; }
      if (!Object.hasOwn(SKIP_PHASES, phase)) { chat(`[MTG] Skip to which phase? ${Object.keys(SKIP_PHASES).join(", ")} (or off).`, m.color); break; }
      const gv = seat.board?.state?.gameView || {};
      seat.skipTo = { phase, turn: gv.turn ?? 0, step: gv.step || "untap" };
      autoResolve[m.color] = undefined; // (or auto-resolve would pass the very stop this asks for)
      autoNotice(seat);
      chat(`[MTG] Passing until ${phase === "mine" ? "your next turn" : `the next ${phase === "main" ? "main phase" : phase === "main2" ? "second main phase" : phase === "end" ? "end step" : `${phase} step`}`}; an opponent's spell stops it. (mtg skip off)`, m.color);
      // a priority already waiting goes at once
      if (seat.prompt?.type === "chooseAction" && !skipReached(seat.skipTo, gv, seat.slot) && !(gv.stack || []).some((x) => x.controllerId !== seat.slot)) {
        seat.respond(seat.prompt.promptId, "chooseAction", { type: "pass" }); closePrompt(seat);
      }
      break;
    }
    case "hold": {
      // "mtg hold" (or "off"): see holdStop in onPrompt
      const seat = game?.seats.get(m.color);
      if (!seat) { chat("[MTG] Hold: no game running.", m.color); break; }
      seat.hold = m.on === false ? null : seat.board?.state?.gameView?.turn ?? 0;
      chat(m.on === false ? "[MTG] Hold off." : "[MTG] Hold: you keep priority once this turn after something goes on the stack, if you can respond.", m.color);
      break;
    }
    case "timer":
      // "mtg timer [seconds|off]" (host, checked on the table)
      setTimer(m.on, m.seconds);
      break;
    case "stops": {
      const seat = game?.seats.get(m.color);
      if (seat) seat.stops = new Set(asList(m.stops));
      break;
    }
    case "answer":
      onAnswer(m.color, m.promptId, m.choice);
      break;
    case "rewind":
      onRewind(m.color, m.checkpointId);
      break;
    case "rewindVote":
      onRewindVote(m.color, m.accept);
      break;
    case "rewindGo":
      onRewindGo(m.color);
      break;
    case "concede":
      onConcede(m.color);
      break;
    case "fix":
      onFix(m);
      break;
    case "winner":
      onWinner(m.color, m.by);
      break;
  }
}

// The seat whose view stands for the whole table (game log, the public board, announcements made once).
function leadSeat() { return game ? [...game.seats.values()][0] : undefined; }
// Still in the game: not lost, not conceded (the engine's PlayerDto.status is playing | lost | conceded).
function isPlaying(gv, slot) { return gv?.players?.find((p) => p.id === slot)?.status === "playing"; }

// ───────── rewind by vote (SPEC §10c Tier A, PLAN M4.5) ─────────
// Forge records restore points (gameView.checkpoints, ~8 per turn, the last 25 kept) and runs the vote itself: a
// requestRestore opens gameView.restoreVote for the other live human seats; with nobody to ask (vs AI) it applies
// at once. The table gets the points worth offering and the vote in each board update (`rewind`).
const REWIND_STEPS = { upkeep: "upkeep", main1: "main phase", combatDeclareAttackers: "attacks", main2: "second main phase" };
function checkpointLabel(c) {
  return `turn ${c.turn}, ${game.slotColor[c.activePlayerId] || nameOf(c.activePlayerId)}'s ${REWIND_STEPS[c.step] || c.step}`;
}
function rewindState(gv) {
  const points = (gv.checkpoints || []).filter((c) => REWIND_STEPS[c.step]).slice(-12).reverse()
    .map((c) => ({ id: c.checkpointId, label: checkpointLabel(c) }));
  const v = gv.restoreVote;
  const vote = v ? { id: v.voteId, to: v.checkpoint ? checkpointLabel(v.checkpoint) : "?", by: game.slotColor[v.requestedByPlayerId] || null,
    waiting: (v.awaitingPlayerIds || []).map((id) => game.slotColor[id]).filter(Boolean), status: v.status?.type || "pending",
    declinedBy: v.status?.playerId ? game.slotColor[v.status.playerId] || null : null } : null;
  // Everyone has voted yes, but Forge rewinds only at a priority question: while a player is answering something else
  // ("Unclaimed Territory: choose a creature type") it waits, and the table said "Waiting for ..." with no name for
  // as long as that took (playtest 2026-10-24). Say who and what.
  if (vote && vote.status === "pending" && vote.waiting.length === 0) {
    const busy = [...game.seats.values()].filter((st) => st.prompt && st.prompt.type !== "chooseAction");
    // (the table shows a button then: anyone can go now, and the open question is dropped with what it would have undone)
    vote.go = busy.length > 0;
    vote.note = busy.length ? `Everyone agreed. ${busy.map((st) => `${st.color} still has "${st.prompt.ui?.title || st.prompt.type}" open`).join(" and ")}: press Rewind to go now.`
      : "Agreed: rewinding...";
  }
  return { points, vote };
}
// the rewind part of a board update, announcing a vote's changes in chat
function rewindNews(pub) {
  const r = rewindState(pub);
  const v = r.vote;
  const key = v ? `${v.id}|${v.status}|${v.note || ""}` : null;
  if (!v || key === game.lastVoteKey) return r;
  game.lastVoteKey = key;
  if (v.note) chat(`[MTG] Rewind to ${v.to}: ${v.note}`);
  else if (v.status === "pending") chat(`[MTG] ${v.by || "A player"} asks to rewind to ${v.to}. Waiting for ${v.waiting.join(", ") || "nobody"}: vote in the pop-up (or type  mtg vote yes / mtg vote no).`);
  else if (v.status === "declined") chat(`[MTG] Rewind declined${v.declinedBy ? ` by ${v.declinedBy}` : ""}.`);
  else if (v.status === "unavailable") chat("[MTG] That point is no longer kept, so the rewind was cancelled.");
  return r;
}
function onRewind(color, checkpointId) {
  const seat = game?.seats.get(color);
  const gv = seat?.board?.state?.gameView;
  if (!gv || !game.started) return chat("[MTG] Only a player in the running game can ask to rewind.", color);
  if (game.fix) return chat("[MTG] Finish the manual fix first (or cancel it).", color);
  const cp = (gv.checkpoints || []).find((c) => String(c.checkpointId) === String(checkpointId));
  if (!cp) return chat("[MTG] That point is no longer kept. Type  mtg undo  for the current list.", color);
  if (gv.restoreVote?.status?.type === "pending") return chat("[MTG] A rewind vote is already open.", color);
  if (!isPlaying(gv, seat.slot)) return chat("[MTG] Players who are out can't ask to rewind.", color);
  log(`${color} asks to rewind to ${checkpointLabel(cp)} (#${cp.checkpointId})`);
  seat.directive({ type: "requestRestore", checkpointId: cp.checkpointId });
}
// The button once everyone has agreed: a yes on a vote with nobody left to ask. Forge then answers the open questions
// with their safe defaults up to the next priority and rewinds there, instead of waiting for a player to click on.
function onRewindGo(color) {
  const seat = game?.seats.get(color);
  const v = seat?.board?.state?.gameView?.restoreVote;
  if (!v || v.status?.type !== "pending" || (v.awaitingPlayerIds || []).length) return chat("[MTG] No agreed rewind is waiting.", color);
  log(`${color} starts the agreed rewind (vote ${v.voteId})`);
  seat.directive({ type: "restoreVote", voteId: v.voteId, accept: true });
}
function onRewindVote(color, accept) {
  const seat = game?.seats.get(color);
  const v = seat?.board?.state?.gameView?.restoreVote;
  if (!v || v.status?.type !== "pending") return chat("[MTG] No rewind vote is open.", color);
  if (!(v.awaitingPlayerIds || []).includes(seat.slot)) return chat("[MTG] Your vote isn't needed for this one.", color);
  seat.directive({ type: "restoreVote", voteId: v.voteId, accept: !!accept });
}
// ───────── manual fix by vote (PLAN M7, docs/m7-manual-fix-spec.md) ─────────
// For what a rewind can't fix (the engine got a rule wrong, or the mistake is older than the restore points): the
// players vote, the engine is held at the next priority question with an empty stack (the bridge just doesn't answer
// it), the table unlocks its cards, the players put things right, the change list is voted on, and the engine applies
// it in one go (our Forge build's applyState directive: no triggers, then state-based actions, a restore point
// before). States: voting -> pausing -> editing -> review -> applying, then gone; Cancel from any of them but applying
// (the list is with the engine then; its answer ends it).
// vs AI there is nobody to ask, so both votes pass at once.
// Each op's fields and their kinds ("?" = may be left out), as the engine's StateOp has them: the relay and the node
// both parse a directive strictly and drop one they can't read without a word (the relay as an "unauthorized game
// envelope"), which would leave the fix waiting for an answer
// that never comes, so anything else is refused here. Only these fields are passed on.
const FIX_OPS = {
  move: { card: "card", zone: "zone", position: "position?" }, tap: { card: "card", tapped: "bool" },
  counters: { card: "card", kind: "kind", n: "count" }, attach: { card: "card", to: "card?" }, control: { card: "card", player: "player" },
  faceDown: { card: "card", value: "bool" }, life: { player: "player", n: "count" }, poison: { player: "player", n: "count" },
  commanderDamage: { player: "player", from: "commander", n: "count" }, createToken: { script: "token", player: "player", tapped: "bool?" },
  mana: { player: "player", mana: "mana" },
};
// Forge's token scripts by name (tools/make-token-list.js), for "mtg fix token ...": what a player types ("treasure",
// "1/1 green saproling", "2/2 black zombie") becomes the script with that colour and size whose name has every other
// word, with the fewest extra words (treasure -> c_a_treasure_sac). A script name typed as it is is taken as it is.
let tokenScripts = null;
const TOKEN_COLOURS = { white: "w", blue: "u", black: "b", red: "r", green: "g", colorless: "c", colourless: "c" };
function tokenScript(text) {
  if (!tokenScripts) {
    try { tokenScripts = JSON.parse(fs.readFileSync(path.join(__dirname, "token-scripts.json"), "utf8")); }
    catch { tokenScripts = []; log("token-scripts.json missing: run node tools/make-token-list.js"); }
  }
  const t = String(text || "").trim().toLowerCase();
  if (!t) return null;
  if (tokenScripts.includes(t)) return t;
  const words = t.split(/[\s,]+/).filter(Boolean);
  let colours = "", pt = null;
  const rest = [];
  for (const w of words) {
    if (TOKEN_COLOURS[w]) colours += TOKEN_COLOURS[w];
    else if (/^\d+\/\d+$/.test(w)) pt = w.replace("/", "_");
    else if (w !== "token" && w !== "tokens" && w !== "creature") rest.push(w);
  }
  // (Forge writes colours in WUBRG order: "bg_1_1_insect")
  colours = [..."wubrgc"].filter((ch) => colours.includes(ch)).join("");
  let best = null;
  for (const name of tokenScripts) {
    const parts = name.split("_");
    if (colours && parts[0] !== colours) continue;
    if (pt && `${parts[1]}_${parts[2]}` !== pt) continue;
    if (!rest.every((w) => parts.includes(w))) continue;
    if (!best || parts.length < best.parts || (parts.length === best.parts && name < best.name)) best = { name, parts: parts.length };
  }
  return best ? best.name : null;
}
const FIX_ZONES = ["battlefield", "hand", "library", "graveyard", "exile", "command"];
// kind -> (value, field name, cards by id) -> the reason it is refused, or false
const FIX_CHECK = {
  card: (v, k, byId) => (typeof v !== "string" || !byId[v]) && `No such card: ${v}.`,
  zone: (v) => !FIX_ZONES.includes(v) && `No zone ${v}.`,
  position: (v) => v !== "top" && v !== "bottom" && `No library position ${v}.`,
  bool: (v, k) => typeof v !== "boolean" && `${k} must be true or false.`,
  count: (v) => !(Number.isInteger(v) && v >= 0 && v <= 999) && `${v} isn't a number the engine takes.`,
  kind: (v) => !(typeof v === "string" && /^[A-Z][A-Z0-9_]*$/.test(v)) && `No counter kind ${v}.`,
  player: (v) => !slotOfColor(v) && `No player ${v}.`,
  // a commander card, or a colour: that player's commander (commanderDamage from the table's counters)
  commander: (v, k, byId) => !(typeof v === "string" && (byId[v] || slotOfColor(v))) && `No commander ${v}.`,
  token: (v) => !tokenScript(v) && `No token called "${v}" (try e.g. treasure, clue, 1/1 green saproling).`,
  // mana symbols, space-separated, as Forge's "Produced" takes them ("W W U C"); it stays in the pool until the end of
  // the turn (Forge's persistent mana: kept through the steps, emptied at cleanup)
  mana: (v) => !(typeof v === "string" && /^[WUBRGC]( [WUBRGC]){0,599}$/.test(v)) && `Can't add the mana "${String(v).slice(0, 40)}".`,
};
const FIX_ANSWER_MS = 20000; // the engine answers an applyState at once; after this the fix goes back to editing
function fixVoters(pub, except) {
  return [...game.seats.values()].filter((s) => s.color !== except && isPlaying(pub, s.slot)).map((s) => s.color);
}
function slotOfColor(color) { return Object.keys(game.slotColor).find((slot) => game.slotColor[slot] === color) || null; }
// The table names players by colour; the engine by slot. A list the table built is checked here, so a bad op is
// refused with a reason instead of reaching the engine. Returns { ops, lines } or { error }.
function fixOps(list, pub) {
  if (!Array.isArray(list) || !list.length) return { error: "Nothing was changed." };
  const byId = cardIndex(pub);
  const zoneOfCard = {};
  for (const z of pub.zones || []) for (const c of z.cards || []) zoneOfCard[c.id] = z.zone;
  const cardName = (id) => byId[id]?.identity?.name || id;
  const where = (c) => `${game.slotColor[c.ownerId] || "?"}'s ${zoneOfCard[c.id] || "?"}`;
  const ops = [];
  const lines = [];
  for (const raw of list) {
    const want = FIX_OPS[raw?.op];
    if (!want) return { error: `Can't read the change ${JSON.stringify(raw)}.` };
    const op = { op: raw.op };
    for (const [k, kind] of Object.entries(want)) {
      const v = raw[k];
      if (v == null) {
        if (kind.endsWith("?")) continue;
        return { error: `Can't read the change ${JSON.stringify(raw)}.` };
      }
      const bad = FIX_CHECK[kind.replace("?", "")](v, k, byId);
      if (bad) return { error: bad };
      op[k] = kind === "player" ? slotOfColor(v) : kind === "token" ? tokenScript(v) : v;
    }
    // only auras, equipment and fortifications go on another permanent
    if (op.op === "attach" && op.to) {
      const c = byId[op.card];
      if (!(c.subtypes || []).some((t) => /^(Aura|Equipment|Fortification)$/.test(t))) return { error: `${cardName(op.card)} can't be attached to anything.` };
    }
    // commander damage counted per colour on the table: the commander of that colour (with partners, the first one
    // takes what the others haven't dealt)
    if (op.op === "commanderDamage" && !byId[op.from]) {
      const from = (pub.players || []).find((p) => p.id === slotOfColor(op.from));
      const victim = (pub.players || []).find((p) => p.id === op.player);
      const ids = Object.keys(from?.commanderCasts || {});
      if (!ids.length) return { error: `${op.from} has no commander.` };
      const others = ids.slice(1).reduce((n, id) => n + ((victim?.commanderDamage || {})[id] || 0), 0);
      op.from = ids[0];
      op.n = Math.max(0, op.n - others);
    }
    const c = op.card ? byId[op.card] : null;
    lines.push({
      move: () => `${cardName(op.card)}: ${where(c)} → ${game.slotColor[c.ownerId] || "?"}'s ${op.zone}${op.zone === "library" ? (op.position === "bottom" ? " (bottom)" : " (top)") : ""}`,
      tap: () => `${cardName(op.card)}: ${op.tapped ? "tapped" : "untapped"}`,
      counters: () => `${cardName(op.card)}: ${op.n} ${counterWords(op.kind) || op.kind}${op.n === 1 ? "" : "s"}`,
      attach: () => (op.to ? `${cardName(op.card)}: attached to ${cardName(op.to)}` : `${cardName(op.card)}: not attached`),
      control: () => `${cardName(op.card)}: now controlled by ${raw.player}`,
      faceDown: () => `${cardName(op.card)}: face ${op.value ? "down" : "up"}`,
      life: () => `${raw.player} life → ${op.n}`,
      poison: () => `${raw.player} poison → ${op.n}`,
      commanderDamage: () => `${raw.player}: ${op.n} damage from ${cardName(op.from)}`,
      createToken: () => `New token for ${raw.player}: ${raw.script} (${op.script})${op.tapped ? ", tapped" : ""}`,
      mana: () => { const each = {}; for (const m of op.mana.split(" ")) each[m] = (each[m] || 0) + 1; return `${raw.player} gets mana until the end of the turn: ${Object.entries(each).map(([m, k]) => `${k} {${m}}`).join(", ")}`; },
    }[op.op]());
    ops.push(op);
  }
  return { ops, lines };
}
// the fix part of a board update
function fixState() {
  const f = game?.fix;
  return f ? { id: f.id, state: f.state, by: f.by, waiting: f.waiting, lines: f.lines || null, message: f.message || null } : null;
}
function fixNews(pub) {
  const f = game.fix;
  const r = pub.stateFix;
  if (!f || f.state !== "applying" || !r || r.fixId !== f.applyId) return;
  if (r.applied) {
    log(`fix #${f.id} applied (${f.applyId})`);
    chat(`[MTG] Manual fix applied: ${f.lines.join("; ")}.`);
    // (and in the game log, which said nothing of King Macar put on top of the library by hand, hp-14 gap)
    gameLogLine(`${f.by}'s manual fix: ${f.lines.join("; ")}`);
    endFix();
  } else {
    const why = r.message || "no reason given";
    log(`fix #${f.id} refused: ${why}`);
    fixBackToEditing(f, why, `[MTG] The engine refused the fix (${why}). Back to editing.`);
  }
}
// into editing: the engine is paused (again, after a refusal, no answer or a declined list); `message` stays on the panel
const FIX_PAUSED = "[MTG] MANUAL FIX: the engine is paused. Move the cards, then press Done (or Cancel).";
function fixBackToEditing(f, message, text) {
  // (refused before it was read, or no answer: the engine may still be at the question the apply went out on, and
  // no new one came to replace it)
  if (!f.held && f.spent) f.held = f.spent;
  Object.assign(f, { state: "editing", message, waiting: [] });
  chat(text);
  scheduleTable();
}
// (on the bridge's 5-second tick) an apply with no answer: the directive was lost or refused unread
function fixWatchdog() {
  const f = game?.fix;
  if (!f || f.state !== "applying" || Date.now() - f.appliedAt < FIX_ANSWER_MS) return;
  log(`fix #${f.id}: no answer from the engine to ${f.applyId}`);
  fixBackToEditing(f, "no answer from the engine", "[MTG] The engine didn't answer the fix. Back to editing: press Done to try again, or Cancel.");
}
// the fix is over: a question held for it goes to its player again
function endFix() {
  const held = game.fix?.held;
  game.fix = null;
  scheduleTable();
  if (held) guarded(`${held.seat.color} prompt after the fix`, () => onPrompt(held.seat, held.prompt));
}
// Held by onPrompt: a priority question with an empty stack while a fix is on. Returns true when it was held. The
// engine has one question open at a time, so a newer one replaces the one held before.
function holdForFix(seat, prompt, gv) {
  const f = game?.fix;
  if (!f || (gv.stack || []).length) return false;
  f.held = { seat, prompt };
  f.spent = null;
  if (seat.prompt) closePrompt(seat);
  if (f.state === "pausing") fixBackToEditing(f, null, FIX_PAUSED);
  else scheduleTable();
  return true;
}
// Opens a vote (state `next`) when anyone else has a say; false when nobody does (vs AI), and the caller goes on.
function fixAsk(f, pub, by, next, what) {
  f.waiting = fixVoters(pub, by);
  if (!f.waiting.length) return false;
  f.state = next;
  chat(`[MTG] ${by} ${what}. Waiting for ${f.waiting.join(", ")}: vote in the pop-up (or type  mtg fix yes / mtg fix no).`);
  return true;
}
// the pause was agreed: at once when a question is already held, else at the next one
function fixPaused(f) {
  // a priority question already open with nothing on the stack (often the caller's own) is held now: the pause used to
  // wait for the next question, so "mtg mana 99" in your own main phase did nothing until you acted (playtest 2026-10-26)
  if (!f.held) {
    for (const st of game.seats.values()) {
      const gv = st.board?.state?.gameView || {};
      if (st.prompt?.type === "chooseAction" && st.lastRawPrompt?.promptId === st.prompt.promptId && holdForFix(st, st.lastRawPrompt, gv)) break;
    }
  }
  if (f.held) return fixBackToEditing(f, null, FIX_PAUSED);
  f.state = "pausing";
  chat("[MTG] Manual fix: waiting for a moment with nothing on the stack...");
}
function fixApply(f, pub) {
  f.applyId = game.fixApplies = Math.max(game.fixApplies || 0, pub.stateFix?.fixId || 0) + 1;
  f.appliedAt = Date.now();
  f.state = "applying";
  f.waiting = [];
  const seat = f.held.seat;
  f.spent = f.held; // (the engine answers with a new question; until then this one may still be open)
  f.held = null;
  log(`fix #${f.id}: ${JSON.stringify(f.ops)}`);
  seat.directive({ type: "applyState", fixId: f.applyId, ops: f.ops });
}
function onFix(m) {
  const color = m.color;
  const seat = game?.seats.get(color);
  const pub = seat?.board?.state?.gameView;
  if (!pub || !game.started || !game.fromTable) return chat("[MTG] Only a player in a running table game can use manual fix.", color);
  if (!isPlaying(pub, seat.slot)) return chat("[MTG] Players who are out can't change the game.", color);
  if (pub.gameOver) return chat("[MTG] The game is over.", color);
  const f = game.fix;
  switch (m.action) {
    case "call": {
      if (f) return chat("[MTG] A manual fix is already under way.", color);
      if (pub.restoreVote?.status?.type === "pending") return chat("[MTG] Finish the rewind vote first.", color);
      const nf = { id: (game.fixCount = (game.fixCount || 0) + 1), by: color, held: null };
      game.fix = nf;
      log(`${color} calls a manual fix (#${nf.id})`);
      if (!fixAsk(nf, pub, color, "voting", "asks to pause the game for a manual fix")) fixPaused(nf);
      break;
    }
    case "vote": {
      if (!f || (f.state !== "voting" && f.state !== "review")) return chat("[MTG] No manual-fix vote is open.", color);
      if (!f.waiting.includes(color)) return chat("[MTG] Your vote isn't needed for this one.", color);
      if (!m.accept) {
        if (f.state === "voting") { chat(`[MTG] Manual fix declined by ${color}.`); endFix(); return; }
        fixBackToEditing(f, null, `[MTG] ${color} declined the changes. Back to editing.`);
        break;
      }
      f.waiting = f.waiting.filter((c) => c !== color);
      if (f.waiting.length) break;
      if (f.state === "voting") fixPaused(f);
      else fixApply(f, pub);
      break;
    }
    case "done": {
      if (!f || f.state !== "editing") return chat("[MTG] The game isn't paused for a fix.", color);
      const r = fixOps(m.ops, pub);
      if (r.error) return chat(`[MTG] ${r.error}`, color);
      Object.assign(f, { ops: r.ops, lines: r.lines, message: null });
      chat(`[MTG] Changes: ${r.lines.join("; ")}.`);
      if (!fixAsk(f, pub, color, "review", "wants to apply these changes")) fixApply(f, pub);
      break;
    }
    case "cancel":
      if (!f) return chat("[MTG] No manual fix to cancel.", color);
      if (f.state === "applying") return chat("[MTG] Too late: the engine is applying it.", color);
      chat(`[MTG] Manual fix cancelled by ${color}.`);
      endFix();
      return;
    default:
      return;
  }
  scheduleTable();
}
// ───────── conceding and declaring the winner (Treachery, PLAN M4.6) ─────────
// Forge plays a free-for-all; in Treachery the roles decide who wins, so players concede or the host declares the
// winner. A concede is the engine's own directive: the player is out for good (the Lua side asks to confirm first).
function onConcede(color) {
  const seat = game?.seats.get(color);
  const gv = seat?.board?.state?.gameView;
  if (!seat || !game.started || !gv?.players?.some((p) => p.id === seat.slot)) return chat("[MTG] Only a player in the running game can concede.", color);
  if (!isPlaying(gv, seat.slot)) return chat("[MTG] You are already out of the game.", color);
  log(`${color} concedes`);
  seat.directive({ type: "concede" });
  chat(`[MTG] ${color} conceded.`);
}
// the host names the winner: every other player at the table concedes. AI seats can't be conceded from here.
function onWinner(color, by) {
  if (!game?.started) return chat("[MTG] No engine game is running.", by);
  if (!Object.values(game.slotColor).includes(color)) return chat(`[MTG] ${color} isn't in this game.`, by); // (every seat's colour is in slotColor)
  const gv = leadSeat()?.board?.state?.gameView;
  const playing = (slot) => isPlaying(gv, slot);
  const out = [...game.seats.values()].filter((s) => s.color !== color && playing(s.slot));
  log(`${by} declares ${color} the winner; conceding ${out.map((s) => s.color).join(", ") || "nobody"}`);
  for (const s of out) s.directive({ type: "concede" });
  const ai = Object.entries(game.slotColor).filter(([slot, c]) => c !== color && !game.seats.has(c) && playing(slot)).map(([, c]) => c);
  chat(`[MTG] ${by} declares ${color} the winner.` + (ai.length ? ` AI players ${ai.join(", ")} can't concede; type  mtg reset  to end the game.` : ""));
}

// After a restore the engine is back at an earlier point and asks its questions again. A question that was open
// before it must not be answered any more: an answer reaching the engine's new question crashed Forge in a test
// (rules-check --game rewind: "unsupported action kind: choose_action" while it waited for a target).
function checkRestored(seat) {
  const gv = seat.board?.state?.gameView;
  if (!gv || !game) return;
  // Two signs, either is enough: the turn number never goes down otherwise, and a restore drops every checkpoint
  // after the one it went back to, so the newest checkpoint id goes DOWN (measured: 56 -> 40). The second also
  // catches a rewind within the same turn. (The STEP going back is no sign: extra combat phases do that.)
  const turn = gv.turn ?? 0;
  const cps = gv.checkpoints || [];
  const newest = cps.length ? cps[cps.length - 1].checkpointId : null;
  const wasTurn = seat.lastTurn, wasNewest = seat.lastCheckpoint;
  seat.lastTurn = turn;
  if (newest != null) seat.lastCheckpoint = newest;
  const turnBack = wasTurn != null && turn < wasTurn;
  const pointsBack = newest != null && wasNewest != null && newest < wasNewest;
  // Third and surest: Forge publishes the vote as "approved" once the restore is done. A rewind to the newest point
  // within the turn moved neither of the other two (hp-07 #36 re-test 2026-10-27: undetected, the log told the
  // difference as plays). (Not on the first board a seat sees: a resumed bridge finds the last vote already there.)
  const approved = gv.restoreVote?.status?.type === "approved" ? gv.restoreVote.voteId : null;
  const voteBack = wasTurn != null && approved != null && approved !== seat.lastApprovedVote;
  if (approved != null) seat.lastApprovedVote = approved;
  if (!turnBack && !pointsBack && !voteBack) return;
  log(`${seat.color}: the game was rewound (turn ${wasTurn} -> ${turn} ${gv.step}${pointsBack ? `, restore points ${wasNewest} -> ${newest}` : ""}${voteBack ? `, vote ${approved} approved` : ""})`);
  if (seat.prompt) closePrompt(seat);
  // (what the player asked for before the rewind is undone with it: End turn answered the redone turn's priority by
  // itself, stage 3 review 2026-10-27)
  seat.endTurnAt = null;
  seat.resolveStack = null;
  seat.queuedPlay = null;
  seat.attachTo = null;
  // (and the other answers kept for the player: the next target, a search's Done, an unless round, a payment in
  // progress; the rewind kept them, suite review 2026-10-27)
  seat.targetPicks = null;
  seat.cardsDone = null;
  seat.unless = null;
  seat.autoPayCard = null;
  seat.tappedFor = null;
  seat.payingCost = null;
  seat.forget();
  game.pendingPlays = (game.pendingPlays || []).filter((e) => e.ctl !== seat.slot);
  if (seat === leadSeat()) {
    chat(`[MTG] Rewound to turn ${gv.turn} (${REWIND_STEPS[gv.step] || gv.step}).`);
    game.sentZones = {}; // the next board update sends every zone in full
    game.lastTableSig = null; // (and goes out even if it matches the last one sent)
    // the log says the rewind, and the board it went back to is its new start: the difference was told as plays
    // ("Dauthi Voidwalker returns to the battlefield", "Command Tower leaves the battlefield", hp-07 #36 2026-10-27)
    game.logPrev = null;
    // (the turn as the log's headers count it, each player's own: "White's turn 4", suite review 2026-10-27)
    // (whose turn and which step: Forge's turn number counts every player's turns, unlike the log's headers, and the
    // per-player count isn't wound back, suite review 2026-10-27)
    gameLogLine(`--- Rewound to ${nameOf(gv.activePlayerId)}'s turn (${REWIND_STEPS[gv.step] || gv.step}) ---`);
  }
}

// ───────────────────────── Debug channel (localhost; always on) ────────────────────────
// Refuses browser requests (they carry an Origin header) and foreign Host headers (DNS rebinding): see debugServer.─
// TTS sends prints (2), errors (3) and Lua return values (5) to this port as well. They go to tts-console.log.
// POST Lua to http://127.0.0.1:48787/exec and it runs in the loaded game's Global; the reply carries
// the return value plus any prints/errors that arrived meanwhile.
const http = require("http");
const DEBUG_PORT = Number(arg("debug-port", 48787));
const CONSOLE_LOG = path.join(__dirname, "tts-console.log");
const consoleLines = [];
let consoleTotal = 0; // lines ever added (consoleLines keeps the last 500)
let execSeq = 0;
const execWaiters = new Map();

function onTTSDebug(msg) {
  let line = null;
  if (msg.messageID === 2) line = `print: ${msg.message}`;
  else if (msg.messageID === 3) line = `ERROR ${msg.guid ?? ""}: ${msg.error || msg.errorMessagePrefix || ""} ${msg.message || ""}`.trim();
  else if (msg.messageID === 5) {
    const w = execWaiters.get(msg.returnID);
    if (w) { execWaiters.delete(msg.returnID); w(msg.returnValue); }
    return;
  } else if (msg.messageID === 1) {
    line = "TTS: game loaded";
    // the running game, again, once TTS has finished loading: the table's "hello" comes while it still loads, and what
    // was sent back then was lost (the table showed READY after a relaunch, hp-22 #14 and hp-06 2026-10-28: TTS's
    // "game loaded" came 3 s after the hello's answer)
    if (game?.started && game.fromTable) setTimeout(() => guarded("resend after load", resendToTable), 2000);
  }
  if (!line) return;
  const stamped = `[${new Date(Date.now()).toISOString().slice(11, 23)}] ${line}`; // (Date.now: the tests' frozen clock)
  consoleLines.push(stamped);
  consoleTotal++;
  if (consoleLines.length > 500) consoleLines.shift();
  fs.appendFile(CONSOLE_LOG, stamped + "\n", () => {});
  if (msg.messageID === 3) log(`TTS ${line}`);
}

function execInTTS(script, timeoutMs = 8000) {
  const returnID = ++execSeq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { execWaiters.delete(returnID); resolve({ timeout: true }); }, timeoutMs);
    execWaiters.set(returnID, (value) => { clearTimeout(timer); resolve({ value }); });
    const sock = net.connect(TTS_OUT, "127.0.0.1", () => sock.end(JSON.stringify({ messageID: 3, returnID, guid: "-1", script })));
    sock.on("error", (e) => { clearTimeout(timer); execWaiters.delete(returnID); resolve({ error: e.message }); });
  });
}

const MAX_BODY = 4 * 1024 * 1024;
const LOCAL_HOSTS = new Set([`127.0.0.1:${DEBUG_PORT}`, `localhost:${DEBUG_PORT}`]);
// collects a request body up to MAX_BODY; bigger requests get 413 and done is never called
function readBody(req, res, done) {
  let body = "", tooBig = false;
  req.on("data", (d) => { if (tooBig) return; body += d; if (body.length > MAX_BODY) { tooBig = true; res.writeHead(413); res.end(); req.destroy(); } });
  req.on("end", () => { if (!tooBig) done(body); });
}
const debugServer = http.createServer((req, res) => {
  if (req.headers.origin || !LOCAL_HOSTS.has(String(req.headers.host || ""))) {
    log(`refused ${req.method} ${req.url} (origin ${req.headers.origin || "-"}, host ${req.headers.host || "-"})`);
    res.writeHead(403); res.end(); return;
  }
  if (req.method === "POST" && req.url === "/msg") {
    // The table's messages arrive here as background web requests: TTS's sendExternalMessage freezes the game
    // for ~80 ms per call, which players felt after every click.
    readBody(req, res, (body) => {
      res.end("ok");
      try {
        const m = JSON.parse(body);
        if (process.env.MTG_TRACE) log(`from TTS (web): ${m.t} (${body.length} bytes)`);
        onTTS(m);
      } catch (e) { log(`bad /msg body: ${e.message}`); }
    });
    return;
  }
  if (req.method === "POST" && req.url === "/exec") {
    readBody(req, res, async (body) => {
      const mark = consoleTotal;
      const result = await execInTTS(body);
      await new Promise((r) => setTimeout(r, 150)); // let trailing prints/errors arrive
      res.writeHead(200, { "Content-Type": "application/json" });
      // (the buffer keeps 500 lines: once full its length stays 500, so a length mark returned nothing)
      res.end(JSON.stringify({ ...result, console: consoleLines.slice(Math.max(0, consoleLines.length - (consoleTotal - mark))) }));
    });
  } else if (req.url.startsWith("/img/")) {
    // Card pictures for tables still running a table script from before 2026-10-23 evening (they ask here; the current
    // script uses a public proxy every player can reach). Removed once and every older save's pictures went white
    // (playtest 2026-10-24): kept for them. /img/front/<scryfall id>.jpg -> Scryfall's jpg, cached in tmp/img-cache.
    const m = /^\/img\/(front|back)\/([0-9a-f-]{36})\.jpg$/.exec(req.url);
    if (!m) { res.writeHead(404); res.end(); return; }
    const file = path.join(IMG_DIR, `${m[1]}-${m[2]}.jpg`);
    const send = (buf) => { res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": buf.length }); res.end(buf); };
    fs.readFile(file, async (err, buf) => {
      if (!err) return send(buf);
      try {
        const url = `https://cards.scryfall.io/normal/${m[1]}/${m[2][0]}/${m[2][1]}/${m[2]}.jpg`;
        const r = await fetch(url, { headers: { Accept: "image/jpeg,*/*", "User-Agent": "mtg-tts-bridge/0.1" }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const got = Buffer.from(await r.arrayBuffer());
        const tmp = `${file}.${process.pid}.part`;
        fs.mkdir(IMG_DIR, { recursive: true }, () => fs.writeFile(tmp, got, (e) => { if (!e) fs.rename(tmp, file, () => {}); }));
        send(got);
      } catch (e) {
        log(`img ${m[2]}: ${e.message}`);
        if (!res.headersSent) res.writeHead(502);
        res.end();
      }
    });
  } else if (req.url === "/stats") {
    res.end(JSON.stringify(ttsStats));
  } else if (req.url === "/versions") {
    // is what's running what the last deploy put together, and what the table's check and the log's guesses found
    versionsNow((now) => {
      const deployed = versions.readManifest();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ now, deployed, outOfStep: versions.outOfStep(now, deployed), waiting: versions.waiting(deployed), alignment }, null, 1));
    });
  } else if (req.url === "/state") {
    const seats = game ? [...game.seats.values()].map((st) => {
      const gv = st.board?.state?.gameView;
      const bf = (gv?.zones || []).filter((z) => z.zone === "battlefield").map((z) => ({ owner: z.ownerId, cards: z.cards.map((c) => `${c.identity?.name}${c.tapped ? "(T)" : ""}`) }));
      return { color: st.color, slot: st.slot, turn: gv?.turn, step: gv?.step, battlefield: bf, manaPool: gv?.players?.find((p) => p.id === st.slot)?.manaPool, rawPrompt: st.lastRawPrompt };
    }) : null;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ started: !!game?.started && !game.over, seats }, null, 1));
  } else if (req.url.startsWith("/card/")) {
    // a card as the engine sends it, from the lead seat's view: GET /card/<name or engine id> (debugging what Forge says)
    let want = "";
    try { want = decodeURIComponent(req.url.slice(6)).toLowerCase().trim(); } catch { want = ""; }
    if (!want) { res.writeHead(400); res.end("name a card: /card/<name or engine id>"); return; }
    const gv = leadSeat()?.board?.state?.gameView;
    const found = (gv?.zones || []).flatMap((z) => (z.cards || []).map((c) => ({ zone: z.zone, owner: z.ownerId, ...c })))
      .filter((c) => c.id === want || String(c.identity?.name || "").toLowerCase().includes(want));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(found, null, 1));
  } else if (req.url === "/log") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(consoleLines.join("\n"));
  } else { res.writeHead(404); res.end(); }
});

if (require.main === module) {
  debugServer.listen(DEBUG_PORT, "127.0.0.1").on("error", (e) => log(`debug port ${DEBUG_PORT} unavailable: ${e.message}`));
  server.listen(TTS_IN, "127.0.0.1", () => log(`Bridge listening for TTS on ${TTS_IN}; relay ${RELAY}, room "${ROOM}". Load tts/mtg-board.lua in TTS.`));
  process.on("SIGINT", () => { if (game) { game.closing = true; for (const s of game.seats.values()) s.close(); } setTimeout(() => process.exit(0), 200); });
  resumeGame();
  setInterval(() => { guarded("save game", saveResume); guarded("fix watchdog", fixWatchdog); }, 5000);
} else {
  // Loaded by a test (tests/bridge-harness.js): the logic without servers. `game` is set through _setGame.
  module.exports = {
    alignment, tableCard, versionsNow, warnOutOfStep, Seat, onTTS, onTTSDebug, onPrompt, onRoomUpdate, onGameStarted, toTTS, fixWatchdog, debugServer, answerProblem, onIntent, onAnswer, whyNot, refuse, cardLabel, imgOf, displayText, shortUrl, ttsImage, payManaText, manaRank, otherwiseText, distinctLabels, saveResume, resumeGame,
    summarizeLands, orderSteps, costLeft, countWords, targetTitle, yesNoWords, arenaWords, scryPlaceSteps, damageSteps, prepareUi, sendTable, logSnapshot, logEvents, engineFacts, updateLog, cardIndex, nameOf,
    _setGame: (g) => { game = g; }, _getGame: () => game, _outbox: outbox, _readyDecks: readyDecks, _timerExpired: timerExpired, _timeoutChoice: timeoutChoice, _stopTimer: stopTimer,
  };
}
