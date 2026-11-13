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
const home = require("./home"); // where the data and logs are (MTG_HOME, MTG_LOG_DIR; unset: the repo)

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
const COMPOSE = versions.COMPOSE;
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
// (the table's mergeStatic, tools/engine-renderer.lua, fills in the same lists)
const ZONE_KEYS = ["hand", "battlefield", "graveyard", "exile", "command", "playable", "revealed", "ctlHand"];
// A reveal's pictures (the table pages through them, 7 at a time): 7 left out Animist's Awakening's 8th, 2026-10-30
const REVEAL_PICTURES = 40;
// How long a clash's log line waits for the other human seats to be shown the same clash (each acknowledges in turn,
// so one player's slow OK delays the next one's question): see the clash in onPrompt
const CLASH_SAME_MS = 120000;
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
      // (the exiled and countered ids are sent once too: sendTable has already cleared them, so the replaced board's go along)
      for (const k of ["exd", "ctrd"]) {
        if (older[k]?.length) customMessage[k] = [...new Set([...older[k], ...(customMessage[k] || [])])];
      }
      outbox.splice(i, 1);
    }
  }
  const entry = { t: customMessage.t, msg: customMessage, queuedAt: performance.now() };
  // A question (or its close) goes ahead of the boards, log lines and rules texts waiting in line: TTS takes one
  // message at a time (a board 50-120 ms, slow-tail doc), and the player waits for the question, not for a board
  // that a newer one may replace anyway. It never passes another prompt, a chat line, a refusal or a clear, so
  // what those say keeps its order. (A question already reaches TTS before its own board, scheduleTable's 40 ms.)
  if (customMessage.t === "prompt") {
    let at = outbox.length;
    while (at > 0 && QUESTION_PASSES.has(outbox[at - 1].t)) at--;
    outbox.splice(at, 0, entry);
  } else outbox.push(entry);
  if (!sending) pump();
}
// what a question may go ahead of in the outbox (see toTTS)
const QUESTION_PASSES = new Set(["table", "gamelog", "texts"]);
function pump() {
  const next = outbox.shift();
  if (!next) { sending = false; return; }
  // (players by their table names in everything the table is sent, whatever built it: see tableNames. A username is
  // letters, digits and hyphens, so a JSON string can be read as text here)
  const msg = { t: next.t, json: tableNames(JSON.stringify(next.msg)) };
  // how long it waited for TTS to take the messages ahead of it (GET /stats "wait", and q in the recording)
  const waited = Math.round(performance.now() - next.queuedAt);
  noteWait(next.t === "prompt" && next.msg.promptId == null ? "close" : next.t, waited);
  // MTG_RECORD=file: keep every message sent to TTS, with its time, for replaying into TTS (stutter hunting)
  if (process.env.MTG_RECORD) fs.appendFile(process.env.MTG_RECORD, JSON.stringify({ at: Date.now(), q: waited, msg }) + "\n", () => {});
  ttsStats.n++; ttsStats.bytes += msg.json.length; ttsStats.max = Math.max(ttsStats.max, msg.json.length);
  if (next.t === "table") { ttsStats.tables++; ttsStats.tableBytes += msg.json.length; }
  ttsStats.maxByType[next.t] = Math.max(ttsStats.maxByType[next.t] || 0, msg.json.length);
  if (msg.json.length > 3000) ttsStats.big = [...(ttsStats.big || []).slice(-9), `${next.t} ${msg.json.length}`];
  sending = true;
  const sock = net.connect(TTS_OUT, "127.0.0.1", () => { ttsSaw(true); sock.end(JSON.stringify({ messageID: 2, customMessage: msg })); });
  sock.on("close", pump);
  sock.setTimeout(10000, () => { log(`TTS didn't take a ${next.t} message within 10 s; moving on`); sock.destroy(); });
  sock.on("error", (e) => { if (e.code === "ECONNREFUSED") { ttsSaw(false); log("TTS not reachable on 39999 (is a game loaded?)"); } else log(`sending to TTS: ${e.message}`); });
}
// (GET /stats, since this bridge started) wait: per message kind, how long messages waited in the outbox for TTS;
// engine: per engine question type, the engine's own time (engineMs); trips: engine questions per question shown to a
// player after their answer (the ones between were answered by the bridge itself: passes, End turn, auto-pay).
// Each is { n, sum, max, hist } with hist counting samples under each SLOW_BUCKETS bound (ms; the last is the rest).
// The slow tail's live questions (docs/slow-tail-2026-11.md) read these after a game.
const ttsStats = { n: 0, bytes: 0, max: 0, tables: 0, tableBytes: 0, maxByType: {}, wait: {}, engine: {}, trips: {} };
const SLOW_BUCKETS = [16, 50, 100, 250, 500, 1000, 3000];
function noteSample(group, key, v) {
  if (!Number.isFinite(v)) return;
  const s = (group[key] ??= { n: 0, sum: 0, max: 0, hist: new Array(SLOW_BUCKETS.length + 1).fill(0) });
  s.n++; s.sum += v; s.max = Math.max(s.max, v);
  const b = SLOW_BUCKETS.findIndex((x) => v < x);
  s.hist[b < 0 ? SLOW_BUCKETS.length : b]++;
}
const noteWait = (kind, ms) => noteSample(ttsStats.wait, kind, ms);
// For GET /health: whether TTS answered last (a send connected, or a message came: true; a send refused: false; null
// until either), and when the table last spoke
const ttsLink = { up: null, tableAt: 0 };
const ttsSaw = (up) => { ttsLink.up = up; };
const chat = (text, color) => toTTS({ t: "chat", text, color: color || null });

// ───────── table log: tmp/table-log.log (2026-10-24) ─────────
// The table's side of the game in plain words, one line per event: what each player was asked and what they answered,
// what they dragged and clicked that reached the engine, the chat they were told, and (from the table itself, "tlog")
// what the table did without the engine: held draws and their release, messages to a player, cards slid back. The
// bridge log only said "from TTS: answer (106 bytes)", and "Blue drew a card but it isn't on the table" (a draw held
// on the library with Blue's Auto off) took a live probe to explain.
const TABLE_LOG = home.tmp("table-log.log");
const clockNow = () => { const d = new Date(); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":"); };
function tlog(color, text) {
  // (the players as the table names them: the log says what each was shown, see tableNames)
  fs.appendFile(TABLE_LOG, `[${clockNow()}] ${String(color || "-").padEnd(6)} ${tableNames(text)}\n`, () => {});
}

// Keeping the three aligned, seen on GET /versions and in a chat warning. Nothing here changes the game.
// (LIVE: the real bridge; a test that loaded this file has no docker)
const LIVE = require.main === module;
const CHECK_LOG = home.tmp("table-check.log"), GUESS_LOG = home.tmp("guess-log.log");
const BRIDGE_HASH = LIVE ? versions.bridgeHash() : null; // (read now: the code this process runs, whatever the file becomes)
let tableStamp; // the version the table last said: undefined until it said one, null from a table older than stamps
// the table's hello said it reuses the last board's restore points when a board says keepRewind (see sendTable); an
// older table, or one not heard from since the bridge started, gets them in every board
let tableKeepsRewind = false;
const TABLE_ROW_PICTURES = 7; // the pictures the table's card row holds (ROW_MAX in tools/engine-renderer.lua)
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
// Why a spell on the stack can't be countered, as far as the table can read it: its own words ("This spell can't be
// countered.", when Forge's stack text has them), or a permanent of its controller's ("Green spells you control can't be
// countered.", Allosaurus Shepherd; "Creature and enchantment spells ...", Destiny Spinner). Returns null, or
// { sure: true, said: "it can't be countered" }, or { card, sure, said: 'Destiny Spinner (AI 1): "..."' }, sure only
// when the sentence names no kind of spell (the stack item says nothing of its types or colours).
function cantBeCounteredWhy(gv, text, ctl) {
  if (/\b(?:this spell|it) can't be countered\b/i.test(String(text || ""))) return { sure: true, said: "it can't be countered" };
  for (const z of gv.zones || []) {
    if (z.zone !== "battlefield") continue;
    for (const c of z.cards || []) {
      if (c.isFaceDown || c.phasedOut || !c.identity?.name || (c.controllerId || z.ownerId) !== ctl) continue;
      const s = String(c.currentText ?? c.text ?? "").replace(/\([^)]*\)/g, "").split(/\n+|(?<=\.)\s+/)
        .map((x) => x.trim()).find((x) => /^[A-Za-z, -]*?\bspells you control can't be countered\b/i.test(x) && !/\bthis turn\b/i.test(x));
      if (s) return { card: c.identity.name, sure: /^spells you control\b/i.test(s), said: `${c.identity.name} (${nameOf(c.controllerId || z.ownerId)}): "${s}"` };
    }
  }
  return null;
}
// An ability text that is only the way a spell was cast, its cost and that cost's reminder, nothing of what it does:
// Forge's alternative-cost spell abilities, Wash Away's cleave "Cleave {1}{U}{U} (You may cast this spell for its cleave
// cost. ...)" and Spider-Sense's "Web-Slinging {U} (You may cast this spell for {U} if ...)". What such a spell does is
// read from its card's text (logSnapshot says why not Forge's stack words); White's own Wash Away and Spider-Sense on
// its Divinations read no "is countered", keyword sweep kw-20. Only the whole text: a way with more words after its
// reminder is read as it stands, by isCounterspell.
const castWayOnly = (t) => /^(?:[A-Z][\w-]*(?: [^(\n]*?)? )?\(You may cast this spell\b[^)]*\)\.?$/.test(String(t || "").trim());
// The game log on disk, as the table's log panel shows it: game-log.txt beside the bridge (a friend package's logs
// folder). It was only ever written from Forge's "log" envelopes, which our node never sends, so no game-log.txt
// existed anywhere (live check 2026-11-11). Each line has its own time. One write at a time, the next call's lines
// waiting for it: separate fs.appendFile calls run on libuv's thread pool and can land in any order, so a header, a
// rewritten line and the lines after it came out of order.
const GAME_LOG = home.beside("game-log.txt");
let gameLogWaiting = "", gameLogWriting = false;
function gameLogFile(lines) {
  if (!game.logFileStarted) {
    game.logFileStarted = true;
    gameLogWaiting += `[${clockNow()}] === Game: ${Object.keys(game.slotNames || {}).map(nameOf).join(", ")} ===\n`;
  }
  for (const line of lines) gameLogWaiting += `[${clockNow()}] ${line}\n`;
  gameLogWrite();
}
function gameLogWrite() {
  if (gameLogWriting || !gameLogWaiting) return;
  const text = gameLogWaiting;
  gameLogWaiting = "";
  gameLogWriting = true;
  // (a failed write is dropped, as the other logs' are; the next one still goes)
  fs.appendFile(GAME_LOG, text, () => { gameLogWriting = false; gameLogWrite(); });
}
// a line in the game log, and to the table's log panel
function gameLogLine(line) {
  // (players by their table names, whatever the caller built the line from: a reveal's raw title put "self-hosted-node-
  // …-bot's Battlefield" in the log, hp-20 gap)
  line = displayText(line);
  (game.log ??= []).push(line);
  gameLogFile([line]);
  toTTS({ t: "gamelog", lines: [line] });
}
// a line said after the next board's lines, or in 2 s: a reveal comes as a prompt in the middle of its spell, before the
// board that shows what the spell did first (Chaos Warp's "AI 1 reveals Island" came before "Island is put into AI 1's
// library", rebuilt re-test)
function holdLogLine(line) {
  const g = game;
  (g.heldLines ??= []).push(displayText(line));
  clearTimeout(g.heldTimer);
  g.heldTimer = setTimeout(() => { if (game === g) for (const l of g.heldLines.splice(0)) gameLogLine(l); }, 2000);
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

// SPEC.md §8: share the editor port with the VSCode/Atom TTS plugin (bridge/editor-forward.js). Off unless
// MTG_EDITOR_FORWARD_PORT (--editor-forward-port) is set. The callbacks run later, when `game` and execInTTS exist.
// Save & Play from the plugin goes through only with no game, a table check that found none of the player's cards or
// decks (tools/tts-push-global.js's check), and a backup of the save (MTG_TTS_SAVE, default Saves/TS_Save_1.json).
const { createEditorForwarder, BRIDGE_EXEC_BASE, TABLE_CHECK_LUA } = require("./editor-forward");
const editorForward = createEditorForwarder({
  forwardPort: arg("editor-forward-port", 0), commandPort: arg("editor-command-port", 0), ttsPort: TTS_OUT, ttsInPort: TTS_IN,
  gameRunning: () => !!game, checkTable: () => execInTTS(TABLE_CHECK_LUA, 8000), log,
});
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
    if (!editorForward.offer(msg, text)) return; // the editor plugin's alone (SPEC.md §8)
    if (msg.messageID === 4 && msg.customMessage) {
      if (process.env.MTG_TRACE) log(`from TTS: ${msg.customMessage.t} (${text.length} bytes)`);
      guarded(`TTS message ${msg.customMessage.t}`, () => onTTS(msg.customMessage));
    } else guarded("TTS debug message", () => onTTSDebug(msg));
  });
  sock.on("error", () => {});
});
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") console.error(`Port ${TTS_IN} is taken: close the VSCode/Atom TTS plugin (or another bridge) and retry. To use both, move the plugin to another port (SPEC.md §8, MTG_EDITOR_FORWARD_PORT).`);
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

// ───────────────────────── Planechase (docs/planechase-dungeon-engine-spec.md P1, P8) ─────────────────────────
// The host's switch for the next games ("mtg planechase on|off", shown to everyone) and the planar pool ("mtg planes
// random [N]", N planes and phenomena a player, or "mtg planes <name>; <name>; ..."). The pool goes in the first seated
// player's deck as its planes; the engine (our Forge build, Planechase.planarDecks) deals it to every player's planar
// deck, planes first, and turns Planechase on when a deck has planes. AI decks bring none.
const planechase = { on: false, names: null, per: 10 };
let forgePlaneList = null;
function forgePlanes() {
  if (!forgePlaneList) {
    try { const j = JSON.parse(fs.readFileSync(path.join(__dirname, "forge-planes.json"), "utf8")); forgePlaneList = { planes: j.planes || [], phenomena: j.phenomena || [] }; }
    catch { forgePlaneList = { planes: [], phenomena: [] }; log("forge-planes.json missing: run node tools/build-forge-plane-list.js"); }
  }
  return forgePlaneList;
}
// a typed name as Forge spells it, and whether it is a phenomenon, or null
function planeNamed(typed) {
  const { planes, phenomena } = forgePlanes();
  const k = normName(typed);
  const plane = planes.find((n) => normName(n) === k);
  if (plane) return { name: plane, phenomenon: false };
  const phen = phenomena.find((n) => normName(n) === k);
  return phen ? { name: phen, phenomenon: true } : null;
}
const shuffled = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// The pool for a game of n players: the host's names, or per x n at random with no repeats and at most 2 phenomena in
// 10 (the official deck rule). { names } or { error } (the engine needs a plane for every player).
function planarPool(n) {
  if (planechase.names) {
    const planesIn = planechase.names.filter((x) => !planeNamed(x)?.phenomenon).length;
    return planesIn < n ? { error: `Planechase needs a plane for every player: the list has ${planesIn} for ${n} players (mtg planes random, or name more).` } : { names: [...planechase.names] };
  }
  const { planes, phenomena } = forgePlanes();
  const size = planechase.per * n;
  const phen = Math.min(phenomena.length, Math.floor(size / 5));
  const picked = [...shuffled(planes).slice(0, size - phen), ...shuffled(phenomena).slice(0, phen)];
  return picked.filter((x) => planes.includes(x)).length < n ? { error: "Planechase needs a plane for every player, and the bridge's plane list is empty (node tools/build-forge-plane-list.js)." } : { names: picked };
}
const planarWords = () => (planechase.names ? `${planechase.names.length} chosen planes and phenomena` : `${planechase.per} random planes and phenomena a player`);
function onPlanechase(m) {
  planechase.on = m.on !== false;
  chat(`[MTG] Planechase ${planechase.on ? `on for the next games (${planarWords()}; mtg planes to choose)` : "off"}.`);
}
function onPlanes(m) {
  const text = String(m.text || "").trim();
  const r = /^random(?:\s+(\d+))?$/i.exec(text);
  if (r || text === "") {
    const k = r?.[1] ? Number(r[1]) : 10;
    if (!(k >= 1 && k <= 30)) return chat("[MTG] Use:  mtg planes random [1-30]  (planes and phenomena a player)", m.color);
    Object.assign(planechase, { names: null, per: k });
    return chat(`[MTG] Planar decks: ${planarWords()}.${planechase.on ? "" : " (Planechase is off: mtg planechase on)"}`);
  }
  const typed = text.split(/\s*;\s*/).filter(Boolean);
  const found = typed.map((t) => planeNamed(t));
  const unknown = typed.filter((t, i) => !found[i]);
  if (unknown.length) return chat(`[MTG] Not planes Forge knows: ${unknown.join("; ")}. Separate names with ;`, m.color);
  const names = [...new Set(found.map((x) => x.name))];
  Object.assign(planechase, { names });
  chat(`[MTG] Planar decks: ${names.join(", ")}.${planechase.on ? "" : " (Planechase is off: mtg planechase on)"}`);
}
// a plane for the deck sent to the engine (as a preset's cards are, loadPreset)
const planeDeckCard = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [planeNamed(name)?.phenomenon ? "Phenomenon" : "Plane"],
  subtypes: [], supertypes: [], colorIdentity: [], text: "", uris: {} });
const isPlanarCard = (c) => (c.types || []).some((t) => t === "Plane" || t === "Phenomenon");
// The planar block of a table board: who controls the planes, what the next roll costs, that player's planar deck size
// and the last roll (the table's banner), or null in a game without Planechase
function planarRow(pub) {
  const p = pub.planar;
  if (!p) return null;
  const ctl = p.controllerId || pub.activePlayerId;
  return { controller: game.slotColor[ctl] || null, rollCost: Number(p.dieRollsThisTurn) || 0, deckCount: p.deckCounts?.[ctl] ?? null,
    ...(p.lastRoll ? { last: { who: game.slotColor[p.lastRoll.playerId] || null, result: String(p.lastRoll.result || ""), seq: p.lastRoll.seq ?? 0 } } : {}) };
}
// The planar die's special action (Forge's "Planar Dice" effect card, kept out of the board: every player has one, any
// of them rolls the one die) once, on the plane, with what it costs now: free, then {1}, {2} for the rolls taken.
// `planarAb`: the words on the plane's own button, which holds 16 characters (engineAbilityShort)
function planarActions(actions, gv, cname) {
  const isRoll = (a) => a.type === "activateAbility" && (cname(a.cardId) === "Planar Dice" || /\broll the planar dic?e\b/i.test(String(a.description || a.label || "")));
  if (!actions.some(isRoll)) return actions;
  const n = Number(gv.planar?.dieRollsThisTurn) || 0;
  const plane = gv.planar?.planeIds?.[0] || null;
  let first = true;
  return actions.flatMap((a) => {
    if (!isRoll(a)) return [a];
    if (!first) return [];
    first = false;
    return [{ ...a, ...(plane ? { cardId: plane } : {}), description: `Roll the planar die (${n ? `{${n}}` : "free"})`, planarRoll: true,
      planarAb: `Planar die: ${n ? `{${n}}` : "free"}` }];
  });
}

// ───────────────────────── Decks imported on the table ("mtg ready") ─────────────────────────
// Forge's card names, built by tools/build-forge-card-index.js from the engine container.
let forgeCards = null;
function forgeIndex() {
  if (!forgeCards) {
    // (with no prototype: a lookup by any typed name reads only the file's own names; "constructor" or "toString"
    // found Object's and passed as a card, verifier 2026-11-11)
    forgeCards = Object.create(null);
    try { Object.assign(forgeCards, JSON.parse(fs.readFileSync(path.join(__dirname, "forge-cards.json"), "utf8")).index); }
    catch { log("forge-cards.json missing: run node tools/build-forge-card-index.js"); }
  }
  return forgeCards;
}
const normName = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’‘`]/g, "'")
  .replace(/\s+/g, " ").trim().toLowerCase();
const BASICS = new Set(["plains", "island", "swamp", "mountain", "forest", "wastes",
  "snow-covered plains", "snow-covered island", "snow-covered swamp", "snow-covered mountain", "snow-covered forest", "snow-covered wastes"]);
const readyDecks = {}; // color → { deckName, cards, commanders, images }
const asList = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.values(x) : []);

// Cards printed in another language (2026-11-12: a deck's "アクローマの意志" and "嵐の伝導者、ラル" were unknown to the
// engine, which has English names only). Scryfall gives the English name: by the printing's id, which the card's face
// picture link holds (the importer's img.klrmngr.com and Scryfall's own CDN both name the picture by it), else by a
// search on the printed name in any language. Found names are kept in foreign-names.json, a miss for this run only.
const FOREIGN_FILE = path.join(__dirname, "foreign-names.json");
let foreignNames = null; // "id:<printing id>" or "name:<normName of the printed name>" → English name
const foreignMissed = new Set(); // keys Scryfall answered with no card, this run
let foreignQueue = Promise.resolve(); // one lookup at a time: a second Ready finds the first one's answers
const PRINTING_ID = /\/(?:front|back)\/[0-9a-f]\/[0-9a-f]\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[a-z]+(?:\?|$)/i;
function foreignCache() {
  if (!foreignNames) {
    foreignNames = Object.create(null); // (no prototype: see forgeIndex)
    try { Object.assign(foreignNames, JSON.parse(fs.readFileSync(FOREIGN_FILE, "utf8"))); }
    catch (e) { if (e.code !== "ENOENT") log(`foreign-names.json unreadable, starting empty: ${e.message}`); }
  }
  return foreignNames;
}
function foreignKeys(c) {
  const id = PRINTING_ID.exec(String(c.f || ""))?.[1];
  return { id: id ? `id:${id.toLowerCase()}` : null, name: `name:${normName(c.n)}` };
}
function englishName(c) {
  const cache = foreignCache(), k = foreignKeys(c);
  return (k.id && cache[k.id]) || cache[k.name] || null;
}
// the decks' cards the engine doesn't know that Scryfall can still be asked about
function foreignToAsk(seats) {
  const index = forgeIndex(), out = [];
  for (const entry of Object.values(seats)) {
    for (const c of [...asList(entry?.commander), ...asList(entry?.library)]) {
      if (!c?.n || index[normName(c.n)] || englishName(c)) continue;
      const k = foreignKeys(c);
      if ((k.id && !foreignMissed.has(k.id)) || !foreignMissed.has(k.name)) out.push(c);
    }
  }
  return out;
}
// Asks Scryfall for the English names of `cards`: the ids in batches of 75, then the rest by printed name one at a time,
// ~8 requests a second. A request that fails (no network, 429, 5xx) stops the lookup and remembers nothing, so the next
// Ready asks again; the deck check then says what it said before.
async function lookUpForeign(cards) {
  const cache = foreignCache();
  const headers = { Accept: "application/json", "User-Agent": "mtg-tts-bridge" };
  const pause = () => new Promise((r) => setTimeout(r, 120));
  const ask = (url, o = {}) => fetch(url, { ...o, headers: { ...headers, ...o.headers }, signal: AbortSignal.timeout(10000) }).catch(() => null);
  let found = 0;
  const ids = [...new Set(cards.map((c) => foreignKeys(c).id).filter((k) => k && !cache[k] && !foreignMissed.has(k)))];
  for (let i = 0; i < ids.length; i += 75) {
    const batch = ids.slice(i, i + 75);
    const res = await ask("https://api.scryfall.com/cards/collection", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: batch.map((k) => ({ id: k.slice(3) })) }) });
    await pause();
    // (400: a link's id that is no Scryfall id spoils the batch; those cards are asked by name below)
    if (!res || (!res.ok && res.status !== 400)) { log(`Scryfall foreign names: ${res ? `HTTP ${res.status}` : "unreachable"}`); return found; }
    const data = res.ok ? (await res.json()).data || [] : [];
    for (const card of data) if (card?.id && card.name) { cache[`id:${String(card.id).toLowerCase()}`] = card.name; found++; }
    for (const k of batch) if (!cache[k]) foreignMissed.add(k);
  }
  const byName = new Map();
  for (const c of cards) { const k = foreignKeys(c).name; if (!englishName(c) && !foreignMissed.has(k)) byName.set(k, String(c.n)); }
  for (const [k, printed] of byName) {
    const q = `!"${printed.replace(/["\\]/g, "")}" lang:any`;
    const res = await ask(`https://api.scryfall.com/cards/search?include_multilingual=true&q=${encodeURIComponent(q)}`);
    await pause();
    // (404: no such card; 400: a name Scryfall's search can't read. Either way not this name again this run)
    if (res && (res.status === 404 || res.status === 400)) { foreignMissed.add(k); continue; }
    if (!res || !res.ok) { log(`Scryfall foreign names: ${res ? `HTTP ${res.status}` : "unreachable"}`); break; }
    const card = (await res.json()).data?.[0];
    if (card?.name) { cache[k] = card.name; found++; } else foreignMissed.add(k);
  }
  if (found) {
    const tmp = `${FOREIGN_FILE}.tmp`;
    fs.writeFile(tmp, JSON.stringify(cache, null, 1), (e) => {
      if (e) return log(`foreign-names.json not saved: ${e.message}`);
      fs.rename(tmp, FOREIGN_FILE, (e2) => { if (e2) log(`foreign-names.json not saved: ${e2.message}`); });
    });
  }
  return found;
}

// ───── Player-made card art (docs/custom-art-spec.md, plain cards) ─────
// A deck-list line "1 Sol Ring #https://.../sol.png" makes the Card Importer give that card the link as its picture,
// and "mtg ready" sends it as the card's face. A face from any other host than the importer's own card pictures is such
// a picture (a link to another Scryfall printing is a printing like any other). The table never marks which lines had a
// link, so the host is the only sign.
// wsrv.nl is a public proxy for any picture, so it counts as a normal printing only when it proxies Scryfall's CDN
const NORMAL_ART = /^https?:\/\/(?:img\.klrmngr\.com\/|(?:[a-z0-9-]+\.)*scryfall\.(?:io|com)\/|wsrv\.nl\/\?url=(?:https?:\/\/)?cards\.scryfall\.io\/)/i;
const isCustomArt = (u) => typeof u === "string" && u !== "" && u !== DEFAULT_BACK && !NORMAL_ART.test(u);
const ART_MAX = 500;
// Why a player's link can't be used, or null. The link goes into JSON and the table's Lua tables, so no quotes,
// backslashes, angle brackets, spaces or control characters (the bridge checks again: the table's text is not trusted).
// No fetch: the bridge never visits a player's link (it could point into the host's own network).
function artProblem(u) {
  if (u.length > ART_MAX) return `the link is longer than ${ART_MAX} characters`;
  if (!/^https:\/\//i.test(u)) return "the link must start with https://";
  if (/[\s"'`\\<>\x00-\x1f\x7f]/.test(u)) return "the link has a space, quote, backslash or angle bracket in it";
  // Steam Cloud links (TTS's Cloud Manager, Workshop pictures) carry no file extension: /ugc/<number>/<hex>/
  const steamCloud = /^https:\/\/(?:steamusercontent-a\.akamaihd\.net|(?:[a-z0-9-]+\.)?steamusercontent\.com)\/ugc\/\d+\/[0-9A-F]+\/?$/i.test(u);
  if (!steamCloud && !/\.(?:png|jpe?g|webp)$/i.test(u.split("?")[0])) return "the link must end in .png, .jpg, .jpeg or .webp, or be a Steam Cloud link";
  return null;
}
// The host's switch, "mtg art off|on" (every player's table): off, every card shows its normal picture (imagesFor). It
// stays as set until switched back, and a restarted bridge keeps it (the resume file).
const customArt = { off: false };
function onArt(m) {
  customArt.off = m.on === false;
  if (customArt.off) {
    // (the normal pictures of the cards that wore a player's, asked for now: they had no need of the lookup by name)
    const decks = game?.pictures || Object.fromEntries(Object.entries(readyDecks).map(([c, r]) => [c, r.images]));
    for (const deck of Object.values(decks)) for (const [name, list] of Object.entries(deck || {})) if (list.some((i) => i.custom)) cachedImage(name);
  }
  chat(customArt.off ? "[MTG] Custom card art off: everyone sees the normal card pictures. (mtg art on, host)"
    : "[MTG] Custom card art on: cards wear the pictures their players linked in the deck list (1 Sol Ring #https://...). (mtg art off, host)");
  if (game?.started) { saveResume(); scheduleTable(); }
}
// The "mtg ready" lines about a deck's own pictures: which cards wear the player's, which links were not used, and a
// name given two links. `art`: engine name → { links (usable, in deck order), bad (the first reason one was not) }
function artNotes(art, copies) {
  const lines = [];
  for (const [name, a] of Object.entries(art)) {
    if (a.bad) lines.push(`${name}: the picture link was not used (${a.bad})${a.links.length ? "" : "; it shows its normal picture"}`);
    if (!a.links.length) continue;
    if (BASICS.has(normName(name))) lines.push(`${name}: your ${a.links.length === 1 ? "picture" : `${a.links.length} pictures`} among its ${copies(name)} copies`);
    else {
      lines.push(`${name}: your picture on all ${copies(name)} copies`);
      if (a.links.length > 1) lines.push(`${name}: ${a.links.length} different picture links; every copy wears the first`);
    }
  }
  const MAX = 12;
  return lines.length > MAX ? [...lines.slice(0, MAX), `and ${lines.length - MAX} more`] : lines;
}

function checkDeck(color, entry) {
  const index = forgeIndex();
  const unknown = [];
  const commanders = [];
  const cards = [];
  const translated = new Map(); // printed name → engine name (foreign printings, see foreignKeys)
  // engine name → the table's own pictures of it, one per printing in the deck (a deck with three Plains printings keeps
  // all three; imagesFor gives each engine card one of them). A player's own picture is marked custom; for any name but
  // a basic land it is the only one of its kind, the first link given (every: every copy wears it), and goes first.
  const images = {};
  const art = {};
  const resolve = (c) => {
    let name = index[normName(c.n)];
    if (!name) {
      const english = englishName(c);
      name = english ? index[normName(english)] : null;
      if (name) translated.set(String(c.n), name);
    }
    if (!name) { unknown.push(c.n || "(unnamed card)"); return null; }
    const list = (images[name] ??= []);
    const face = c.f || null;
    if (isCustomArt(face)) {
      const a = (art[name] ??= { links: [], bad: null });
      const why = artProblem(face);
      if (why) { a.bad ??= why; return name; } // (left out: the card shows its normal picture)
      if (!a.links.includes(face)) a.links.push(face);
      const basic = BASICS.has(normName(name));
      if (basic && !list.some((i) => i.face === face)) list.push({ face, back: c.b || null, custom: true });
      else if (!basic && a.links.length === 1) list.unshift({ face, back: c.b || null, custom: true, every: true });
      return name;
    }
    if (!list.some((i) => i.face === face)) list.push({ face, back: c.b || null });
    return name;
  };
  for (const c of asList(entry.commander)) { const n = resolve(c); if (n) commanders.push(n); }
  for (const c of asList(entry.library)) { const n = resolve(c); if (n) cards.push(n); }
  for (const cmd of commanders) { const i = cards.indexOf(cmd); if (i >= 0) cards.splice(i, 1); } // commander left in the library
  const counts = {};
  for (const n of cards) counts[n] = (counts[n] || 0) + 1;
  const extras = Object.entries(counts).filter(([n, k]) => k > 1 && !BASICS.has(normName(n))).map(([n, k]) => `${k}× ${n}`);
  const total = cards.length + commanders.length;
  const notes = artNotes(art, (n) => (counts[n] || 0) + commanders.filter((x) => x === n).length);
  const artSaid = notes.length ? `\nYour card art${customArt.off ? " (the host has custom art off for now: everyone sees the normal pictures)" : ""}:\n- ${notes.join("\n- ")}` : "";

  const problems = [];
  if (!asList(entry.library).length) problems.push("no deck found in your library zone; put your imported deck there");
  if (!commanders.length) problems.push("no commander found; put it on your command zone, or hover it and type: mtg commander");
  if (unknown.length) problems.push(`the engine doesn't know ${unknown.length} card(s): ${unknown.slice(0, 8).join(", ")}${unknown.length > 8 ? `, and ${unknown.length - 8} more` : ""}. Swap them out or fix the names`);
  const warnings = [];
  if (asList(entry.library).length && total !== 100) warnings.push(`${total} cards (Commander decks are 100 including the commander)`);
  if (extras.length) warnings.push(`more than one copy of: ${extras.slice(0, 5).join(", ")}${extras.length > 5 ? " ..." : ""} (fine only if the card allows it)`);

  const label = `${color}${entry.deckName ? ` (${entry.deckName})` : ""}`;
  const names = [...translated].map(([p, n]) => `${p} → ${n}`);
  const foreign = names.length ? `\nForeign names: ${names.slice(0, 8).join(", ")}${names.length > 8 ? `, and ${names.length - 8} more` : ""}` : "";
  if (problems.length) {
    delete readyDecks[color];
    chat(`[MTG] ${label}: not ready.\n- ${problems.join("\n- ")}${warnings.length ? `\nAlso: ${warnings.join("; ")}` : ""}${foreign}${artSaid}`, color);
    return false;
  }
  readyDecks[color] = { deckName: entry.deckName || `${color}'s deck`, cards, commanders, images };
  checkDeckImages(images);
  chat(`[MTG] ${label}: ready. ${cards.length} cards + commander ${commanders.join(" & ")}; every card is known to the engine.${warnings.length ? `\nCheck: ${warnings.join("; ")}` : ""}${foreign}${artSaid}`, color);
  log(`${color} deck ready: ${total} cards, commander ${commanders.join(" & ")}`);
  return true;
}

// colour → how many deck checks it has had: a check waiting on Scryfall is dropped for a colour checked since (another
// deck readied meanwhile) or reset (mtg reset), so it never puts back a deck that is no longer the one on the table
const deckGen = {};
function onDecks(m, looked = false) {
  let seats = m.seats && typeof m.seats === "object" ? m.seats : {};
  if (looked) seats = Object.fromEntries(Object.entries(seats).filter(([c]) => deckGen[c] === looked[c]));
  else for (const c of Object.keys(seats)) deckGen[c] = (deckGen[c] || 0) + 1;
  const colors = Object.keys(seats);
  if (looked && !colors.length) return;
  // cards the engine doesn't know may be foreign printings: Scryfall is asked first, then the decks are checked. The
  // table is answered now (its "no answer from the bridge" warning comes after 4 s), the Ready buttons after the check.
  const ask = looked ? [] : foreignToAsk(seats);
  if (ask.length) {
    chat(`[MTG] Looking up ${ask.length} card name(s) the engine doesn't know on Scryfall (printed in another language?)...`, colors.length === 1 ? colors[0] : null);
    for (const c of colors) delete readyDecks[c]; // (a deck readied before isn't the one being checked: not for a Start meanwhile)
    toTTS({ t: "deckReport", request: m.request, ready: [], checked: [] });
    const gens = Object.fromEntries(colors.map((c) => [c, deckGen[c]]));
    foreignQueue = foreignQueue.then(() => lookUpForeign(ask)).catch((e) => log(`Scryfall foreign names: ${e.message}`))
      .then(() => guarded("decks after the name lookup", () => onDecks({ ...m, seats, request: -1 }, gens)));
    return;
  }
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

// ───────────────────────── AI seats (docs/next-features-2026-11-09.md items 17 + 20) ─────────────────────────
// Per empty table colour: who plays it, and with which deck, kept from game to game like "mtg aideck". "forge": a Forge
// AI (the node's own). "harmless": a seat the bridge plays itself (HarmlessSeat), for testing: it keeps its hand, passes
// every priority and never attacks or blocks. Set by "mtg ai <colour> ..." (host) and the companion page (POST /tools).
// A colour set here is an AI player in every game while nobody sits there, whatever the start asked for; its deck wins
// over "mtg aideck" and over a deck lying in that seat. A person sitting at the colour plays it as usual.
const aiSeatChoice = {}; // colour -> { kind: "forge" | "harmless", deck: { deckName, deck, commanderName }, source }
const AI_KINDS = { forge: "Forge AI", harmless: "Harmless bot" };
const HARMLESS_DECK = "ai_passive_lands"; // ("mtg ai Red harmless" with no deck named)

// A deck list as players paste or export it: "1 Sol Ring", "1x Sol Ring", "Sol Ring (CMM) 410 *F*", with the commander
// under a "Commander" line (Arena, Moxfield) or marked *CMDR*. Other heading lines ("Deck", "Mainboard") start the
// deck again; a "Sideboard", "Maybeboard" or "Companion" part isn't played. "//" and "#" lines are comments.
function parseDeckList(text) {
  const cards = [], commanders = [];
  let part = "deck";
  for (const raw of String(text || "").split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || /^(\/\/|#)/.test(line)) continue;
    const head = /^(commanders?|deck|main ?deck|mainboard|sideboard|maybeboard|companion)\s*:?$/i.exec(line);
    if (head) { const h = head[1].toLowerCase(); part = h.startsWith("commander") ? "commander" : /side|maybe|companion/.test(h) ? "skip" : "deck"; continue; }
    if (part === "skip") continue;
    let marked = false;
    line = line.replace(/\*CMDR\*/i, () => { marked = true; return " "; }).trim();
    const m = /^(\d{1,3})\s*x?\s+(.+)$/i.exec(line);
    // (the printing and the tags after the name: "(CMM) 410", "*F*", "[Ramp]", "#Ramp")
    const name = (m ? m[2] : line).replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+\S+)?/, "").replace(/\s+(\*[A-Za-z]+\*|\[[^\]]*\]|#\S+)/g, "").trim();
    if (!name) continue;
    for (let k = 0; k < Math.min(m ? Number(m[1]) : 1, 99); k++) (part === "commander" || marked ? commanders : cards).push(name);
  }
  return { cards, commanders };
}

// A deck for an AI seat, from a preset id or a deck list: { deck (the engine's form), source } or { error }. A list is
// checked as a table deck is (checkDeck): a commander, and every card known to the engine.
function aiSeatDeck({ preset, list, name } = {}) {
  if (preset) {
    if (!listCommanderPresets().includes(preset)) return { error: `no Commander deck "${String(preset).slice(0, 60)}"` };
    return { deck: loadPreset(preset), source: preset };
  }
  if (!String(list || "").trim()) return { error: "choose a deck or give a deck list" };
  const { cards, commanders } = parseDeckList(list);
  const index = forgeIndex();
  const unknown = [];
  const known = (n) => { const e = index[normName(n)]; if (!e) unknown.push(n); return e; };
  const cmd = commanders.map(known).filter(Boolean), rest = cards.map(known).filter(Boolean);
  const names = [...new Set(unknown)];
  if (names.length) return { error: `the engine doesn't know ${names.length} card(s): ${names.slice(0, 8).join(", ")}${names.length > 8 ? ", ..." : ""}` };
  if (!cmd.length) return { error: "no commander: put it under a line that says Commander, or mark it *CMDR*" };
  if (!rest.length) return { error: "the list has no cards besides the commander" };
  for (const c of cmd) { const i = rest.indexOf(c); if (i >= 0) rest.splice(i, 1); } // (a commander listed in the deck too)
  // (the name is said in chat: TTS would draw a "[ff0000]" in it as a colour, so codes in brackets go)
  const deckName = String(name || "").replace(/\[[^\]]*\]/g, "").trim().slice(0, 60) || `${cmd.join(" & ")} (deck list)`;
  return { deck: engineDeckFromTable({ deckName, cards: rest, commanders: cmd }), source: "list" };
}

// One AI seat: kind "forge", "harmless" or "off", and the deck (aiSeatDeck's). { ok, message }.
function setAiSeat(color, kind, spec = {}) {
  const c = TABLE_COLORS.find((x) => x.toLowerCase() === String(color || "").toLowerCase());
  if (!c) return { ok: false, message: `No seat "${String(color || "").slice(0, 20)}": the seats are ${TABLE_COLORS.join(", ")}.` };
  if (kind === "off") { delete aiSeatChoice[c]; return { ok: true, message: `${c}: no AI set.` }; }
  if (!Object.hasOwn(AI_KINDS, kind)) return { ok: false, message: `${c}: say harmless, forge or off.` };
  const r = aiSeatDeck(kind === "harmless" && !spec.preset && !spec.list ? { preset: HARMLESS_DECK } : spec);
  if (r.error) return { ok: false, message: `${c}: ${r.error}.` };
  aiSeatChoice[c] = { kind, deck: r.deck, source: r.source };
  return { ok: true, message: `${c}: ${AI_KINDS[kind]} playing ${r.deck.deckName}${game?.started ? " (from the next game)" : ""}.` };
}
// the AI seats set among `colors`, in words ("mtg ai", and the start's line)
const aiSeatsText = (colors = TABLE_COLORS) => colors.filter((c) => aiSeatChoice[c]).map((c) => `${c}: ${AI_KINDS[aiSeatChoice[c].kind]} (${aiSeatChoice[c].deck.deckName})`).join("; ");

// "mtg ai" (host): list; "mtg ai clear"; "mtg ai <colour> off"; "mtg ai <colour> harmless|forge [deck id]" (the deck id
// is the rest of the line)
function onAiSeatChat(text) {
  const [color, kind, ...more] = String(text || "").trim().split(/\s+/);
  const preset = more.join(" ");
  if (!color || color === "list") return chat(`[MTG] AI seats: ${aiSeatsText() || "none set"}. Use  mtg ai <colour> harmless|forge [deck]  or  mtg ai <colour> off  (decks: ${listCommanderPresets().join(", ")}).`);
  if (color === "clear") { for (const c of Object.keys(aiSeatChoice)) delete aiSeatChoice[c]; return chat("[MTG] AI seats cleared."); }
  if (kind === "forge" && !preset) return chat(`[MTG] Name the Forge AI's deck:  mtg ai ${color} forge <deck>  (decks: ${listCommanderPresets().join(", ")}).`);
  const r = setAiSeat(color, kind, preset ? { preset } : {});
  chat(`[MTG] ${r.message}`);
}

// Relay link recovery (2026-10-20). A dropped link used to end the game ("lost the engine connection", never back).
// The relay keeps a seat for the room's reconnect window (reconnect_timeout_s, 60 s by default; then the node
// concedes it), and logging in again with the same username reclaims the session (AuthResult reconnected:true).
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000]; // then every 8 s
const RECONNECT_GIVE_UP_MS = 55000; // last try starts by ~63 s: the relay forfeits the seat at reconnect_timeout_s + 5 = 65 s
const PING_EVERY_MS = 20000, SILENT_DEAD_MS = 45000;
// How long a player's answer is kept for the log (a target pick, a "Pay {1}?"): one window for every reader, so a pick
// can't be attached to a stack item by one and refused by another
const ANSWER_MS = 60000;
const fresh = (r) => !!r && Date.now() - r.at < ANSWER_MS;

class Seat {
  // The follow-ups clearFollowUps drops, besides the `lately` memory:
  // - what the player asked for before the rewind (End turn answered the redone turn's priority by itself, stage 3
  //   review 2026-10-27): endTurnAt, resolveStack, queuedPlay, attachTo;
  // - the other answers kept for the player (the next target, a search's Done, an unless round, a payment in progress;
  //   the rewind kept them, suite review 2026-10-27): targetPicks, cardsDone, unless, autoPayCard, autoPayFailedFor;
  // - our own auto-pay (left set, the same card's payment asked again after the rewind would be tapped without asking,
  //   suite review 2026-11-05): smartPay, tappedFor, payingCost;
  // - a text change's first word (the redone first question, within 3 prompt ids, read as the second) and the
  //   creatures that must attack (core-moves cleanup plan): textWord, mustAttack;
  // - the undone attack's engine data, refusal and picks (a rewind back into declare attackers showed the undone
  //   attempt's "isn't legal", batch 1 review 2026-11-12): attackData, attackRefused, lastAttack.
  static FOLLOW_UPS = ["endTurnAt", "resolveStack", "queuedPlay", "attachTo", "targetPicks", "cardsDone", "unless", "autoPayCard",
    "autoPayFailedFor", "smartPay", "tappedFor", "payingCost", "textWord", "mustAttack", "attackData", "attackRefused", "lastAttack"];
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
    this.mullsTaken = resume?.mullsTaken || 0; // (the prompt's mulliganCount is cards owed: 0 after the rules' free one)
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
  // Everything kept for the player between questions, dropped at once when a rewind undoes the turns it was for
  // (checkRestored). One list, so a new follow-up field is cleared by adding it here (core-moves cleanup plan, step 4).
  clearFollowUps() {
    for (const k of Seat.FOLLOW_UPS) this[k] = null;
    this.forget();
  }
  respond(promptId, type, output) {
    if (game?.fix?.state === "applying" && game.fix.activeAt) game.fix.activeAt = Date.now();
    if (type === "mulligan" && output?.keep === false) mulliganTaken(this);
    // (cards chosen to discard: what reaches the graveyard next is a discard, instants too; see logEvents)
    const asked = this.lastRawPrompt?.input?.presentation;
    if (type === "chooseCards" && /discard/i.test(`${asked?.title || ""} ${asked?.description || ""}`)) this.note("discard", this.slot);
    // (a mana source tapped while paying too: its own "pay 1 life?" is part of tapping it; Mana Confluence tapped for
    // Vampiric Tutor's {B} asked it, hp-08 gap)
    if (type === "payManaCost" && output?.type === "act") {
      const act = (this.lastRawPrompt?.input?.actions || []).find((a) => a.id === output.actionId);
      const card = act?.cardId ? cardIndex(this.board?.state?.gameView || {})[act.cardId] : null;
      if (card) this.note("manaTap", act.cardId, card.identity?.name || null, `${act.cost || ""} ${card.text || ""}`);
      if (card) notePain(this, act, card);
    }
    // (what the player's answers say that no board shows, for the log: see logEvents)
    if (game && this.lastRawPrompt) {
      const raw = this.lastRawPrompt, src = raw.sourceCard;
      // (targets picked, by the card whose spell or ability they are: a cast line names them, and a spell target is
      // in no stack item Forge sends; "White casts Counterspell" named no target, Kykar #8; Skullclamp's equip, #3.
      // A follow-up pick adds to the first. Kept with the words they were asked for, and used only for a stack item with
      // those words: a pick for a cast that was then cancelled named the target of that card's next, other spell. A
      // cancel forgets them.)
      // (the harness's target prompt is cancellable exactly while a spell is being cast or an ability activated
      // (castingAbility != null, ManaBrewInteractiveSession's target prompt; set only by playChosenSpellAbility and
      // playFree): a casting pick is that play's, a trigger's never is. Each sub-ability's targets are asked apart, its
      // own chosenTargets from 0, so a casting pick with the same words adds to the play's earlier ones: Arc Trail's
      // second target replaced its first, checker round 4. A cost's sacrifice, or an edict's victim's, is asked the same
      // way and is no target: publishSacrificePrompt's, intent "sacrifice" titled "Sacrifice". An edict's target prompt
      // has that intent too (its api's), but asks for a player, titled "Choose player to sacrifice" (playerTargetTitle);
      // every scripted Sacrifice target is a player or opponent.)
      const sacrifice = raw.input?.intent === "sacrifice" && raw.input?.presentation?.title === "Sacrifice";
      if (type === "chooseBoardTargets" && output?.type === "boardTargets" && src?.id && !sacrifice) {
        const ids = (output.chosen || []).map((t) => `${t.kind}|${t.id}`);
        const was = game.picked?.get(src.id);
        const text = String(raw.sourceAbilityText || ""), casting = raw.input?.cancellable === true;
        const more = was?.text === text && (Number(raw.input?.chosenTargets) > 0 || (casting && was.casting));
        (game.picked ??= new Map()).set(src.id, { ids: more ? [...was.ids, ...ids] : ids, text, casting, at: Date.now() });
      } else if (output?.type === "cancel" && src?.id) game.picked?.delete(src.id);
      // (a source chosen, Reflect Damage's, a Circle of Protection's, Deflecting Palm's: said, and kept for what it does
      // to that source's damage this turn; Reflect Damage's choice read nothing, Kykar #6, Deflecting Palm's #24. Only the
      // exact shields those cards make: Reflect Damage's "dealt to that source's controller instead", a Circle's and
      // Deflecting Palm's "would deal damage to you this turn, prevent that damage", Palm's damage back. Beacon of Destiny,
      // Harm's Way, Nova Pentacle and the like send it elsewhere or prevent part of it: said as chosen, nothing more.)
      const asked = `${raw.input?.presentation?.text || ""} ${raw.input?.presentation?.description || ""}`;
      if (type === "chooseCards" && /^\s*Choose a source\b/i.test(asked) && src?.identity?.name) {
        const picked = (raw.input.cards || []).filter((c) => (output?.chosenCardIds || []).includes(c.id) && c.identity?.name);
        const how = String(raw.sourceAbilityText || src.text || "");
        if (picked.length) {
          gameLogLine(`${nameOf(this.slot)} chooses ${picked.map((c) => c.identity.name).join(", ")} (${src.identity.name})`);
          // (kept for the turn it was chosen in: "this turn", every such shield's words)
          const turn = this.board?.state?.gameView?.turn;
          const kind = /\bthat damage is dealt to that source's controller instead\b/i.test(how) ? "redirect"
            : /\bwould deal damage to you this turn, prevent that damage\b/i.test(how) ? "prevent" : null;
          game.sourceShields = (game.sourceShields || []).filter((x) => x.turn === turn);
          // (every such choice by its card's words, its chooser and the sources chosen, for that player's order question of
          // shields on one event, "which applies first?", and the damage it splits, see owedCombat)
          game.chosenSources = [...(game.chosenSources || []).filter((x) => x.turn === turn), { by: src.identity.name, how, turn, slot: this.slot, ids: picked.map((c) => c.id) }];
          if (kind) for (const c of picked) game.sourceShields.push({ id: c.id, by: src.identity.name, slot: this.slot, turn, kind,
            ...(kind === "prevent" && /\bIf damage is prevented this way, [^.]* deals that much damage to that source's controller\b/i.test(how) ? { back: true } : {}) });
        }
      }
      // (a yes or no to a card's "may", or to its "Pay {1}?", each answer kept, by the card, with who gave it: an
      // "unless that player pays" or a "you may pay" trigger's, see unlessNews. Forge asks the payment first, Rhystic
      // Study's "Pay {1}?" before "Do you want to draw a card?". Every answer, as one card's two triggers ask twice.)
      // (only a real yes or no: an answer of any other shape isn't kept as either)
      if (type === "chooseBoolean" && src?.id && typeof output?.value === "boolean") {
        const kind = /^Pay\b/i.test(String(raw.input?.presentation?.title || "")) ? "pay" : "may";
        const list = (game.answers ??= new Map()).get(src.id) || [];
        game.answers.set(src.id, [...list.filter(fresh), { kind, slot: this.slot, value: output.value, at: Date.now() }]);
      }
    }
    // (the blocks a player declared, this turn's: a board that shows them may never come, the next one is past combat,
    // and an attacker they blocked must not read as unblocked, damageNews)
    if (type === "chooseBlockers" && output?.type === "declareBlockers" && game) {
      const turn = this.board?.state?.gameView?.turn;
      if (game.declaredBlocks?.turn !== turn) game.declaredBlocks = { turn, ids: new Set() };
      for (const a of output.assignments || []) if (a.attackerId) game.declaredBlocks.ids.add(a.attackerId);
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
      if (act?.cardId && act.isManaAbility) {
        this.note("manaTap", act.cardId, cardName, text);
        const card = cardIndex(this.board?.state?.gameView || {})[act.cardId];
        if (card) notePain(this, act, card);
      }
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
        // (and not after the game-over question, which said why already: the relay aborts right after it, and "Game over:
        // AI 1 is at 0 life." was said twice, live check 12)
        if (game?.abortSaid || game?.over) break;
        if (game) game.abortSaid = true;
        const gv = this.board?.state?.gameView;
        // (as gameEndWords tells it: a game won by life, poison or commander damage also ends here, and that is the
        // reason, not an empty library, playtest 2026-10-27; who conceded, never an empty library, live 2026-11-08; "a
        // draw" for a board the engine says is over, Kykar #16)
        const why = gameEndWords(gv);
        // (else the bare fact: the relay sends this for every game that ends, a normal end too ("room reset to lobby"),
        // and every concession ended with "Game aborted.", which reads as a crash, live 2026-11-08)
        chat(why ? `[MTG] Game over: ${why}.` : "[MTG] The game has ended.");
        break;
      }
    }
  }
  onEnvelope(env) {
    if (!env || !this.slot) return;
    const forUs = env.forPlayer === this.slot;
    switch (env.kind) {
      case "state":
        if (forUs || (!this.board && env.forPlayer == null)) { this.board = { state: env.state, fingerprint: env.fingerprint ?? null }; checkRestored(this); noteBoard(env.state?.gameView); scheduleView(this); }
        break;
      case "stateDelta":
        if (!forUs) break;
        if (!this.board || this.board.fingerprint !== env.base) { this.send({ type: "RequestResync" }); break; }
        this.board = { state: delta.apply(this.board.state, env.patch), fingerprint: env.fingerprint };
        noteBoard(this.board.state?.gameView);
        checkRestored(this);
        scheduleView(this);
        break;
      case "prompt":
        if (env.forPlayer === this.slot) {
          // (the engine's own time since our last answer, and its time to build the message: tells a slow engine from a
          // busy TTS in any game's log, tmp/slow-tail/logs.md)
          log(`${this.color} prompt #${env.prompt?.promptId} ${env.prompt?.input?.type || "?"}: engine ${env.engineMs ?? "-"} ms, emit ${env.emitMs ?? "-"} ms`);
          noteSample(ttsStats.engine, env.prompt?.input?.type || "?", env.engineMs);
          this.trips = (this.trips || 0) + 1;
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

// A "harmless" AI seat (aiSeatChoice): the bridge logs it in and seats it like a person, so the engine asks it every
// question, and answers each at once (harmlessAnswer) without showing anything. It isn't in game.seats: the table and
// the manual fixes see an AI player (onGameStarted names it "AI n"). The engine, though, counts it as a person, so it is
// asked in every rewind vote: it says yes (harmlessVotes). A restarted bridge logs it back in with the people's seats
// (resume: saveResume), but a link that drops while the bridge runs isn't retried: the engine then concedes that seat.
class HarmlessSeat extends Seat {
  constructor(color, deck, resume = null) {
    super(color, null, resume);
    this.deck = deck; // ({ deckName, deck, commanderName }: onRoomUpdate sends it)
    this.harmless = true;
  }
  onClosed() {
    clearTimeout(this.pingTimer);
    if (this.closed || !game || game.closing || !(game.harmless || []).includes(this)) return;
    // (said, as a person's seat says it: while setting up, the start waits for this seat for ever, verifier 2026-11-11)
    if (!game.started || !this.slot) {
      log(`${this.color} (harmless): relay connection closed before the game started`);
      return chat(`[MTG] The harmless bot at ${this.color} lost the engine connection while setting up. Type "mtg reset", then "mtg start".`);
    }
    log(`${this.color} (harmless): relay connection closed; not reconnected (the engine concedes the seat)`);
    chat(`[MTG] The harmless bot at ${this.color} lost the engine connection; the engine concedes its seat.`);
  }
  // (the people's seats say a game's end and the relay's errors: this seat reads no board, so its "Game over" had no
  // reason and could win the race to the table, and an error was said to a colour nobody sits at)
  onRelay(msg) {
    if (msg?.type === "GameAborted") return;
    if (msg?.type === "Error" && !(this.rejoinUntil && Date.now() < this.rejoinUntil)) return log(`${this.color} (harmless): relay error ${msg.code}: ${msg.message}`);
    super.onRelay(msg);
  }
  onEnvelope(env) {
    if (!env || !this.slot || env.forPlayer !== this.slot) return;
    if (env.kind === "error") { log(`${this.color} (harmless): engine rejected an answer: ${JSON.stringify(env.error).slice(0, 300)}`); return; }
    if (env.kind !== "prompt") return; // (its own board is never read)
    const p = env.prompt || {};
    if (p.kind === "priority") return this.answer(0, "chooseAction", { type: "pass" });
    if (p.input?.type === "gameOver") return; // (the people's seats say it)
    const out = harmlessAnswer(p.input);
    if (out) this.answer(p.promptId, p.input.type, out);
    else log(`${this.color} (harmless): no answer for a ${p.input?.type || "?"} question`);
  }
  answer(promptId, type, output) {
    this.send({ type: "BroadcastState", state: { kind: "response", fromPlayer: this.slot, promptId: promptId ?? 0, action: { type, output } } });
  }
}
// Every relay link of the game: the people's seats and the harmless bots (game.harmless, never in game.seats).
const allSeats = () => (game ? [...game.seats.values(), ...(game.harmless || [])] : []);
// The engine asks every seat that isn't its own bot in a rewind vote (ManaBrewInteractiveSession's voters), harmless
// bots too, and a vote waits for all of them: each says yes, once per vote, as a Forge AI is never asked. Read from the
// people's boards (noteBoard): a harmless bot reads none.
function harmlessVotes(gv) {
  const v = gv?.restoreVote;
  if (!v || v.status?.type !== "pending") return;
  for (const h of game?.harmless || []) {
    if (!h.slot || h.votedOn === v.voteId || !(v.awaitingPlayerIds || []).includes(h.slot)) continue;
    h.votedOn = v.voteId;
    h.directive({ type: "restoreVote", voteId: v.voteId, accept: true });
  }
}
// What a harmless seat answers, in the engine's answer shapes (the ones onPrompt's toOutput makes): keep the hand, pass,
// no attack (only creatures that must), no block (only attackers that must be blocked, when the engine says so),
// "no" to every may, the fewest picks a question allows (the first ones), a scry kept on top. null: no answer known.
function harmlessAnswer(input) {
  const i = input || {};
  const first = (list, k) => (list || []).slice(0, Math.max(0, Number(k) || 0));
  switch (i.type) {
    case "mulligan": return { type: "mulliganDecision", keep: true };
    case "mulliganPutBack": return { type: "mulliganPutBackDecision", cardIds: first(i.handCardIds, i.count) };
    case "chooseAction": return { type: "pass" };
    case "payManaCost": return { type: "cancel" };
    case "chooseBoardTargets": return { type: "boardTargets", chosen: first(i.candidates, (Number(i.minTargets) || 0) - (Number(i.chosenTargets) || 0)).map((c) => ({ kind: c.kind, id: c.id })) };
    case "chooseBoolean": return { type: "decision", value: false };
    case "chooseCards": return { type: "chooseCardsDecision", chosenCardIds: first(i.cards, i.min).map((c) => c.id) };
    case "chooseNumber": return { type: "numberDecision", chosenNumber: Number(i.min) || 0 };
    case "chooseFromSelection": return { type: "selectionDecision", chosenIndices: first(i.options, i.minTotal).map((o, k) => k) };
    case "chooseAttackers": return { type: "declareAttackers", assignments: (i.attackers || []).filter((a) => a.mustAttack && (a.validTargetIds || []).length).map((a) => ({ attackerId: a.attackerId, targetId: a.validTargetIds[0] })) };
    case "chooseBlockers": return { type: "declareBlockers", assignments: !i.error ? [] : (i.attackers || []).filter((a) => a.mustBeBlocked && (a.validBlockerIds || []).length).map((a) => ({ blockerId: a.validBlockerIds[0], attackerId: a.attackerId })) };
    case "scry": {
      const zones = i.zones || [];
      const keep = zones.includes("libraryTop") ? "libraryTop" : zones[0];
      return { type: "scryDecision", zoneCardIds: zones.map((z) => (z === keep ? (i.cards || []).map((c) => c.id) : [])) };
    }
    case "chooseColor": return (i.validColors || []).length ? { type: "colorDecision", chosenColors: { [i.validColors[0]]: i.amount } } : null;
    case "revealCards": return { type: "revealCardsAcknowledged" };
    case "diceRolled": return { type: "diceRolledAcknowledged" };
    case "reorder": return { type: "reorderDecision", orderedIds: (i.items || []).map((x) => x.id) };
    case "chooseDamageAssignmentOrder": return { type: "damageAssignmentOrderDecision", orderedBlockerIds: i.blockerIds || [] };
    case "chooseCombatDamageAssignment": {
      const to = (i.blockerIds || [])[0] || i.defenderId;
      return { type: "combatDamageAssignmentDecision", assignments: to ? [{ assigneeId: to, damage: i.totalDamage }] : [] };
    }
    default: return null;
  }
}

// ───────── Crash recovery (2026-10-22) ─────────
// The running game is saved every few seconds (who sits where, under which relay username, in which room). A bridge
// that starts again within the relay's grace period (it gives a dropped player's seat away after ~65 s) logs back in
// as the same players and asks for a resync: the board and the open question come back, the game goes on. The
// bridge once died mid-game (exit 0xC0000409, nothing in its log) and the game was lost with it.
const RESUME_FILE = process.env.MTG_RESUME_FILE || home.tmp("bridge-game.json");
const RESUME_MAX_AGE_MS = 50000;
function saveResume() {
  if (!game || !game.started || game.closing || game.autoplay || game.over) return;
  const snap = {
    savedAt: Date.now(),
    game: { bots: game.bots, total: game.total, playerOrder: game.playerOrder, slotNames: game.slotNames, slotColor: game.slotColor,
      fromTable: game.fromTable, roomId: game.roomId, deckNames: [...(game.deckNames || [])],
      // (who had which turn: "White's 6th turn" read "2nd" after a resume without it)
      turnOwners: game.turnOwners || {}, friendly: game.friendly, friendlyOver: game.friendlyOver,
      // (each deck's own pictures: every Plains keeps its printing after a restart, imagesFor)
      pictures: game.pictures, ...(customArt.off ? { artOff: true } : {}), // (and the host's "mtg art off", onArt)
      // (who went out when, and each library as last seen in the game: a true deck-out is still said after a restart,
      // noteOuts; and the printed P/T seen for each name, so a copy's badge stays as it was, notePrinted)
      outOrder: game.outOrder, outStamp: game.outStamp, outWhere: game.outWhere, inLibrary: game.inLibrary, emptyAt: game.emptyAt, printedPT: game.printedPT },
    seats: [...game.seats.values()].map((st) => ({ color: st.color, deckId: st.deckId, username: st.username, slot: st.slot, roomId: st.roomId, mullsTaken: st.mullsTaken })),
    ...(game.harmless?.length ? { harmless: game.harmless.map((h) => ({ color: h.color, username: h.username, slot: h.slot, roomId: h.roomId })) } : {}),
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
  customArt.off = snap.game.artOff === true;
  for (const st of snap.seats) game.seats.set(st.color, new Seat(st.color, st.deckId, st));
  if (snap.harmless?.length) game.harmless = snap.harmless.map((h) => new HarmlessSeat(h.color, null, h));
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
  game.fxJump = true; // (the next board is a jump, not a play: the table plays no effects for it)
  toTTS({ t: "started", colors: game.slotColor, names: game.slotNames, ai: Object.keys(game.slotColor).filter((k) => !TABLE_COLORS.includes(game.slotNames[k])).map((k) => game.slotColor[k]) });
  scheduleTable();
  for (const st of game.seats.values()) autoNotice(st); // (a reloaded table has forgotten its Auto-resolve lists)
  // show each player's still-open question again (re-running the last prompt could answer it twice)
  for (const st of game.seats.values()) if (st.prompt?.ui) showPrompt(st, st.prompt.ui.allCards ? { cards: st.prompt.ui.allCards } : {});
}

// Friendly mulligans (SPEC "Friendly mulligans"): the table's one shared count, the free mulligans each player has in
// all. Anything but 1 or 2 is none.
const friendlyCount = (n) => (n === 1 || n === 2 ? n : 0);

// The Forge AI players the node is asked for: every AI player but the harmless bots the bridge plays itself
const forgeBotCount = () => game.bots - (game.harmlessWanted || []).length;

// fromTable: the group's table draws the game (default: games whose decks come from the table)
function startGame(seatList, bots, requireReady = false, fromTable = requireReady, aiSeats = [], friendly = 0) {
  if (game) { chat('[MTG] A game is already set up. Type "mtg reset" first.'); return; }
  const notReady = requireReady ? seatList.filter((c) => !readyDecks[c]) : [];
  if (notReady.length) { chat(`[MTG] Not started: ${notReady.join(", ")} still need \"mtg ready\" (import your deck, put your commander on the command zone).`); return; }
  // (the colours set as AI seats that nobody sits at: an AI player each, in every game, see aiSeatChoice)
  const preset = TABLE_COLORS.filter((c) => aiSeatChoice[c] && !seatList.includes(c));
  bots = Math.max(bots, preset.length);
  const total = seatList.length + bots;
  if (!seatList.length) { chat("[MTG] Nobody is seated."); return; }
  // the table has a playmat per colour (TABLE_COLORS); a 5th player had no colour and no zones (5-8 players: PLAN M6)
  if (total < 2 || total > TABLE_COLORS.length) { chat(`[MTG] Need 2-${TABLE_COLORS.length} players total (seated ${seatList.length} + ${bots} AI).`); return; }
  const aiTable = aiSeats.filter((c) => readyDecks[c] && !preset.includes(c)).slice(0, bots - preset.length); // (empty seats' ready decks, in order: see below)
  const pool = planechase.on ? planarPool(total) : null;
  if (pool?.error) { chat(`[MTG] Not started: ${pool.error}`); return; }
  game = { seats: new Map(), bots, total, playerOrder: [], slotNames: {}, slotColor: {}, started: false, closing: false, fromTable, setupAt: Date.now(), pendingPlays: [],
    friendly: friendlyCount(friendly),
    // (Planechase: the planar pool, sent in the first seated player's deck, onRoomUpdate)
    planes: pool?.names || null, planeSeat: pool ? seatList[0] : null,
    // decks put in empty seats' library zones (checked by "mtg ready" like a player's) are played by the AI; the seat
    // each came from, for its pictures (onGameStarted)
    aiTableDecks: aiTable.map((c) => engineDeckFromTable(readyDecks[c])), aiTableColors: aiTable,
    // (the AI seats set for this game: the harmless ones the bridge plays, the Forge ones by colour, see onRoomUpdate)
    harmlessWanted: preset.filter((c) => aiSeatChoice[c].kind === "harmless").map((c) => ({ color: c, deck: aiSeatChoice[c].deck })),
    forgeSeats: preset.filter((c) => aiSeatChoice[c].kind === "forge").map((c) => ({ color: c, deck: aiSeatChoice[c].deck })) };
  for (const c of aiSeats) if (!readyDecks[c] && !preset.includes(c)) chat(`[MTG] The deck in ${c}'s seat isn't ready (see above); that AI plays a built-in deck.`);
  seatList.forEach((color, i) => game.seats.set(color, new Seat(color, deckChoice[color] || DEFAULT_DECKS[i % DEFAULT_DECKS.length])));
  // (a debug setup waits for its player's next game: one not in this game is dropped, not kept for a later one)
  for (const c of Object.keys(debugChoice)) if (!seatList.includes(c)) { chat(`[MTG] Debug "${debugChoice[c].name}" dropped: ${c} isn't in this game.`); delete debugChoice[c]; }
  const harmlessN = game.harmlessWanted.length, forgeN = forgeBotCount();
  chat(`[MTG] Setting up: ${seatList.join(", ")}${forgeN ? ` + ${forgeN} Forge AI` : ""}${harmlessN ? ` + ${harmlessN} harmless bot${harmlessN > 1 ? "s" : ""}` : ""}...`);
  if (preset.length) chat(`[MTG] AI seats: ${aiSeatsText(preset)}.`);
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
    const d = seat.deck || (readyDecks[seat.color] ? engineDeckFromTable(readyDecks[seat.color]) : loadPreset(seat.deckId));
    const planes = game.planes && seat.color === game.planeSeat && !seat.harmless ? game.planes : null;
    seat.send({ type: "SetDeckSelection", deck_name: d.deckName, deck: planes ? { ...d.deck, planes: planes.map(planeDeckCard) } : d.deck, commander_name: d.commanderName });
    if (planes) { chat(`[MTG] Planechase: ${planes.length} planes and phenomena dealt to the planar decks.`); for (const n of planes) cachedImage(n); }
    seat.commanderNames = (d.deck.commanders || []).map((c) => c.identity?.name || c.name).filter(Boolean);
    (game.deckNames ??= new Set());
    for (const c of [...(d.deck.cards || []), ...(d.deck.commanders || [])]) game.deckNames.add(c.identity?.name || c.name);
    seat.send({ type: "SetReady", ready: true });
    chat(`[MTG] ${seat.color}${seat.harmless ? " (harmless bot)" : ""} joined with ${d.deckName}.`);
  }
  const seats = [...game.seats.values()];
  // (the harmless bots log in once every person's seat is in the room: the relay's controller is the first seated, and
  // only a person's seat can be asked to start, controllerOf)
  if (!game.harmless && (game.harmlessWanted || []).length && seats.every((s) => s.joined)) game.harmless = game.harmlessWanted.map((h) => new HarmlessSeat(h.color, h.deck));
  // the relay resets a room to 4 seats after every game: make room for everyone first (controller only)
  if (!game.maxSet && typeof room.max_players === "number" && room.max_players < game.total) {
    game.maxSet = true;
    controllerOf(room, seats).send({ type: "SetMaxPlayers", max_players: game.total });
  }
  const forgeBots = forgeBotCount();
  if (!game.botsRequested && forgeBots > 0 && seats.every((s) => s.joined)) {
    game.botsRequested = true;
    const used = new Set(seats.map((s) => s.deckId));
    // (a deck chosen with "mtg aideck" comes first: before, a deck lying in an empty seat beat it, and a test against
    // a harmless AI got the player's other Commander deck instead)
    // (with the table seat each deck came from, null for a preset: the k-th deck goes to the k-th bot, onGameStarted)
    // (an AI seat's own deck before all of them: the k-th of those bots sits at that seat's colour, clockwiseOrder)
    const choices = [...(game.forgeSeats || []).map((f) => [f.deck, null]), ...aiDeckChoice.map((id) => [loadPreset(id), null]), ...game.aiTableDecks.map((d, i) => [d, game.aiTableColors?.[i] ?? null]),
      ...DEFAULT_DECKS.filter((d) => !used.has(d)).map((id) => [loadPreset(id), null])].slice(0, forgeBots);
    const botDecks = choices.map(([d]) => d);
    game.botDeckColors = choices.map(([, c]) => c);
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
// AI seats (aiSeatChoice): a harmless bot sits at its own colour, and the k-th Forge bot at the k-th Forge AI seat's
// (its deck is the k-th, onRoomUpdate); the other AI players take the colours left. Kept as game.colorOfUser for
// onGameStarted, only in a game with AI seats (without them the colours are given exactly as before).
function clockwiseOrder(room) {
  const byColor = {};
  for (const st of allSeats()) byColor[st.color] = st.username;
  const humans = new Set(Object.values(byColor));
  const forge = game.forgeSeats || [];
  const others = room.players.filter((p) => !humans.has(p.username));
  if (forge.length) {
    const k = botIndexOf(others.map((p) => p.username));
    for (const p of others) { const f = forge[k(p.username) ?? -1]; if (f && !byColor[f.color]) byColor[f.color] = p.username; }
  }
  const placed = new Set(Object.values(byColor));
  // (the colours left, a Forge AI seat's last: kept for its own bot, but one whose name says no index still gets a
  // colour, rather than be left out of the seat order)
  const isForge = (c) => forge.some((f) => f.color === c);
  const free = [...TABLE_COLORS.filter((c) => !byColor[c] && !isForge(c)), ...TABLE_COLORS.filter((c) => !byColor[c] && isForge(c))];
  for (const p of others) if (!placed.has(p.username) && free.length) byColor[free.shift()] = p.username;
  if ((game.harmless || []).length || forge.length) game.colorOfUser = Object.fromEntries(Object.entries(byColor).map(([c, u]) => [u, c]));
  return TABLE_COLORS.filter((c) => byColor[c]).map((c) => byColor[c]);
}

// Which Forge bot each AI username is, from 0 (the node names them "<name>", "<name> 2", "<name> 3"...; the k-th was
// given the k-th deck of spawnBot's list): a function of the username, null for one that isn't a bot of that list.
function botIndexOf(ai) {
  const first = ai.find((u) => ai.every((v) => v === u || v.startsWith(`${u} `)));
  return (u) => {
    if (u === first) return 0;
    const k = first != null && u.startsWith(`${first} `) ? Number(u.slice(first.length + 1)) : NaN;
    return Number.isInteger(k) && k >= 2 ? k - 1 : null;
  };
}

function onGameStarted(msg) {
  if (!game || game.closing || game.started) return;
  game.started = true;
  game.playerOrder = msg.player_order;
  let ai = 0;
  // AI players sit at the table colours nobody is using, so their cards have a playmat to land on.
  // (in a game with AI seats, the colour each was seated at, clockwiseOrder)
  const mapped = game.colorOfUser || {};
  const freeColors = TABLE_COLORS.filter((c) => !game.seats.has(c) && !Object.values(mapped).includes(c));
  msg.player_order.forEach((username, i) => {
    const seat = [...game.seats.values()].find((s) => s.username === username);
    game.slotNames[`player-${i}`] = seat ? seat.color : `AI ${++ai}`;
    game.slotColor[`player-${i}`] = seat ? seat.color : mapped[username] || freeColors.shift() || null;
  });
  // (the decks' own pictures for this game, by the table colour of the seat playing them: kept in the resume file, so a
  // restarted bridge shows each card as it was; readyDecks starts empty then. See imagesFor.)
  game.pictures = gamePictures(msg.player_order);
  toTTS({ t: "gamelog", reset: true, lines: [] }); // (a new game: the last game's log lines go, playtest 2026-10-26)
  toTTS({ t: "started", colors: game.slotColor, names: game.slotNames,
    ai: Object.keys(game.slotColor).filter((k) => !TABLE_COLORS.includes(game.slotNames[k])).map((k) => game.slotColor[k]) });
  // Ask Scryfall now for every deck card whose picture isn\'t cached yet (the links arrive with the board). TTS itself
  // doesn\'t preload them (2026-10-19, PresentMon: each destroyed preload card cost a ~370 ms asset clean-up).
  for (const n of game.deckNames || []) pictureOf(n);
  chat(`[MTG] Game started! Seats in turn order: ${msg.player_order.map((_, i) => game.slotNames[`player-${i}`]).join(" → ")}. Life ${msg.starting_life}. A dice roll decides who goes first.`);
  log(`game started ${msg.game_id}: ${Object.values(game.slotNames).join(", ")}`);
  if (game.friendly) friendlySay(`Free mulligans this game: ${game.friendly} each${rulesFreeMulligans() ? " (the rules' free one included)" : ""}.`);
  saveResume();
}
// Each seat's deck pictures, keyed by the colour it sits at: a player's own readied deck; an AI's, the table deck it was
// given (botDeckColors: the seat that deck lay in, which need not be the colour the AI sits at: an AI seated at Red with
// Yellow's deck showed White's Plains, verifier 2026-11-09). A deck nobody plays has no pictures here.
// The relay's node names the bot given decks[k] "<name>" for k = 0 and "<name> <k+1>" after that (self-hosted-node
// spawn_bots), and the bots join in any order; an AI whose name doesn't say which it is gets none.
function gamePictures(order) {
  const ai = order.filter((u) => !allSeats().some((s) => s.username === u));
  const botIndex = botIndexOf(ai);
  const pictures = {};
  order.forEach((u, i) => {
    const color = game.slotColor[`player-${i}`];
    const seat = [...game.seats.values()].find((s) => s.username === u);
    const k = seat ? null : botIndex(u);
    const from = seat ? seat.color : k != null ? game.botDeckColors?.[k] ?? null : null;
    if (color && from && readyDecks[from]) pictures[color] = readyDecks[from].images;
  });
  return pictures;
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
  // (and one found before its printed P/T was kept, "pow" absent, is looked up again: its badge would read the picture as
  // showing no numbers until then, every 1/1 Soldier showing 1/1)
  for (const k of Object.keys(imageCache)) if (k.startsWith("token:") && (!imageCache[k]?.face || !("pow" in imageCache[k]))) delete imageCache[k];
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
// A lookup's answer into the cache. A card already pictured keeps its picture and only gains its face names: a card
// asked again for its names (otherSide) must not change printing, which would replace it on the table.
function putImage(name, entry) {
  const k = normName(name);
  const old = imageCache[k];
  imageCache[k] = old?.face ? { ...old, ...(entry.faces ? { faces: entry.faces } : {}) } : entry;
}
// A two-faced card's other side, by Scryfall's pictures (the engine says isDoubleFaced only for transform and meld, not
// for a modal double-faced card): { pic, name }, the name null until known. An entry from before names were kept asks
// Scryfall once per bridge run; the board is sent again when it answers. null for a card with one face (an adventure,
// a split or a flip card has one picture), a token or a copy (Clone as Valki has Valki's face only).
const facesAsked = new Set();
function otherSide(c, name) {
  if (!name || c.identity?.isToken || c.isCopy) return null;
  const hit = imageCache[normName(name)];
  if (!hit?.back) return null;
  if (!hit.faces && !facesAsked.has(normName(name))) { facesAsked.add(normName(name)); imageWanted.add(name); setImmediate(fetchImages); }
  const own = normName(name);
  const other = (hit.faces || []).find((n) => normName(n) !== own) || null;
  return { pic: hit.back, name: other };
}
// The side of a two-faced card an action plays: 1 the face the card shows (its name), 2 its other face; null for an
// action of no one side (an ability, cycling) or a card with one face. Forge's harness names the face in the label,
// "Cast Tibalt, Cosmic Impostor" for Valki's back, "Play Emeria, Shattered Skyclave" for Emeria's Call's, both in mode
// "normal"; the relay protocol's backFaceLand mode is a back face too.
function actionSide(a, card) {
  if (!a || !card) return null;
  const own = card.identity?.name || "";
  if (!otherSide(card, own)) return null;
  if (a.mode?.type === "backFaceLand") return 2;
  if (a.type !== "cast" && a.type !== "playLand") return null;
  const said = /^(?:Cast|Play) (.+)$/.exec(String(a.label || ""))?.[1];
  if (!said) return null;
  return said === own || said.startsWith(`${own} (`) ? 1 : 2;
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
        // (a two-faced card's face names, its own first: the table names both, docs/card-other-side-spec.md)
        const names = back && faces[0]?.name && faces[1]?.name ? [faces[0].name, faces[1].name] : null;
        const entry = { face, back, ...(names ? { faces: names } : {}) };
        putImage(card.name, entry);
        if (faces[0]?.name) putImage(faces[0].name, entry);
        // the back face under its own name, showing the back: a transformed card is named after its back face
        // (before this, that name was never found and was asked for again and again)
        if (faces[1]?.name && back) putImage(faces[1].name, { face: back, back: face, ...(names ? { faces: [names[1], names[0]] } : {}) });
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

// A card's picture from a deck put on the table: its OWNER's deck first (ownerColor: a stolen card or a token copy keeps
// its owner's printing; every player's Plains showed the first-readied deck's, live 2026-11-08), then another deck
// with the card (an AI seat plays a deck from a colour it may not sit at); null when no deck has it (the lookup by name,
// cachedImage). A deck with several printings gives each engine card one of them by the number in its id: the same one
// on every board (the table replaces a card whose picture changes) and after a bridge restart, with nothing stored.
// The number picks from the deck's whole list, and a printing with no usable picture passes to the next one in the
// list: a dead link found mid-game (checkDeckImages) moves only the cards that showed it. (Picking from the usable ones
// alone moved other cards too, as the list shrank.)
// The running game's pictures (game.pictures, in the resume file), else the decks readied since.
function imagesFor(name, ownerColor = null, id = null) {
  const decks = game?.pictures || Object.fromEntries(Object.entries(readyDecks).map(([c, r]) => [c, r.images]));
  // (an owner known: that deck's pictures only, else the lookup by name. Another deck's could be a custom picture: the
  // AI's Mountain showed White's Lightning Bolt art on a Mountain, live check 2026-11-11. Owner unknown: any deck's)
  const order = ownerColor != null ? [ownerColor] : [...new Set([...TABLE_COLORS, ...Object.keys(decks)])];
  const n = Number(/(\d+)\D*$/.exec(String(id ?? ""))?.[1] ?? 0);
  // (a deck card without its own picture, or with the card back as its face, uses the lookup by name: Fire // Ice
  // showed a card back, 2026-10-26)
  // (a player's own picture only while the host has custom art on, "mtg art off"; passed over, the card shows the deck's
  // normal printing of it if it has one, else the lookup by name)
  const usable = (i) => i.face && i.face !== DEFAULT_BACK && !deadImages.has(i.face) && !(i.custom && customArt.off);
  for (const color of order) {
    const all = decks[color]?.[name] || [];
    // (a card other than a basic land wears its player's picture on every copy, docs/custom-art-spec.md "Rule for
    // copies": not one printing by the id's number. As given, never rewritten: ttsImage changes Scryfall's links only)
    const every = all.find((i) => i.every && usable(i));
    if (every) return { face: every.face, back: every.back };
    const k = n % (all.length || 1);
    const img = [...all.slice(k), ...all.slice(0, k)].find(usable);
    if (img) return { ...img, face: ttsImage(img.face), back: ttsImage(img.back) };
  }
  return null;
}
// A deck's own picture links can be dead (the image host no longer has that printing: Evolving Wilds showed blank, and
// every panel that wanted its picture kept the previous card's, playtest 2026-10-26). They are checked once when the
// deck is readied; a link that answers 404 is passed over for the bridge's own lookup by name.
const deadImages = new Set();
const checkedImages = new Set();
async function checkDeckImages(images) {
  const urls = [...new Set(Object.values(images).flat().map((i) => i.face).filter((u) => u && /^https:\/\/img\.klrmngr\.com\//.test(u) && !checkedImages.has(u)))];
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
// A printed power or toughness as a number, null when it isn't one ("*", "X", "1+*", absent): a picture that shows no
// number can't match the card's (0 is a number: a 0/1 Kelp)
const ptNumber = (v) => (v != null && /^\d+$/.test(String(v)) ? Number(v) : null);
function tokenImage(c) {
  const { base, key, p, t, colors } = tokenKey(c);
  if (!base) return null;
  if (imageCache[key]) return imageCache[key];
  if (!tokenWanted.has(key)) {
    const exact = [`t:token`, `!"${base}"`, p != null ? `pow=${p}` : "", t != null ? `tou=${t}` : "", `c=${colors || "c"}`].filter(Boolean).join(" ");
    // (only the first query asks for the P/T: its hit's printed P/T is recorded with the picture, see fetchTokens)
    tokenWanted.set(key, [{ q: exact, pt: p != null && t != null }, { q: `t:token !"${base}"` }, { q: `t:token name:"${base}"` }]);
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
      for (const { q, pt } of queries) {
        const res = await fetch(`https://api.scryfall.com/cards/search?unique=art&order=released&dir=desc&q=${encodeURIComponent(q)}`,
          { headers: { Accept: "application/json", "User-Agent": "mtg-tts-bridge/0.1" } }).catch(() => null);
        await new Promise((r) => setTimeout(r, 120));
        if (!res || res.status === 429 || res.status >= 500) { transient = true; break; }
        if (!res.ok) continue; // 404: nothing for this query; try the next
        const card = (await res.json()).data?.[0];
        // (the P/T printed on the picture, kept only from the search that asked for this token's P/T: the name-only
        // searches found one Dinosaur Beast picture for the 4/4, 6/6 and 18/18 alike, live 2026-11-08; tableCard's bp/bt)
        if (card?.id) {
          entry = { face: `https://img.klrmngr.com/display/front/${card.id[0]}/${card.id[1]}/${card.id}.webp`, back: null,
            pow: pt ? card.power ?? null : null, tou: pt ? card.toughness ?? null : null };
          break;
        }
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
// zone: the zone list the card is drawn from (sendTable), for what only means something there: a graveyard card's
// flashback, an exiled card's madness, warp or plot, a permanent's owner and choices
// views: every human seat's card index, for the choices only every seat can see (choiceWords)
function tableCard(c, { blockers = null, active = null, zone = null, views = [] } = {}) {
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
      // (what the badge compares against, as for a face-up card's picture: a face-down permanent is a 2/2 by the rules,
      // so a plain morph shows no numbers and a pumped or damaged one does)
      ...(c.power != null ? { bp: 2, bt: 2 } : {}),
      ...(c.phasedOut ? { po: true } : {}),
      ...(c.isForetold ? { fo: true } : {}), ...(c.exiledWith ? { ew: c.exiledWith } : {}) };
  }
  const name = c.identity.name;
  // the picture: a token's own (tokenImage), else its owner's deck's (a token copy of a deck card too), else by name
  const tok = c.identity.isToken ? tokenImage(c) : null;
  const img = tok?.face ? tok : imagesFor(name, game.slotColor?.[c.ownerId] || null, c.id);
  const face = img?.face || cachedImage(name)?.face || null;
  // (the table's badge shows when the numbers differ from bp/bt, so these are what the card's picture says, null when
  // it says none or isn't known: Saw in Half's 1/1 tokens of a 2/2 have a base of 1/1, and looked 2/2 with no badge,
  // playtest 2026-10-31; a 6/6 X/X Dinosaur Beast showed no badge, its base 6 standing in for the picture's */*, live
  // 2026-11-08. A token's own picture says the P/T Scryfall printed on it, kept only from a search by its P/T; a card's,
  // the printed P/T the engine sends for a numeric one, else the one it sent for a card of that name, notePrinted: a
  // Clone copying Grizzly Bears shows the Bears' picture (looked up by name), and the engine sends no printed P/T for it,
  // its paper being Clone's.)
  const [bp, bt] = tok?.face ? [ptNumber(tok.pow), ptNumber(tok.tou)]
    : c.identity.isToken && !face ? [null, null]
    : c.printedPower != null || c.printedToughness != null ? [c.printedPower ?? null, c.printedToughness ?? null]
    : Object.hasOwn(game.printedPT || {}, name) ? game.printedPT[name] : [null, null];
  // (a dungeon is in no deck: its picture was first asked for as it entered, and its first look was a card back,
  // hp-08 #2 2026-10-28. A card that ventures or takes the initiative asks for them all ahead.)
  if (/\bventure into\b|\binitiative\b/i.test(c.text || "")) for (const d of DUNGEON_NAMES) cachedImage(d);
  const typeLine = [...(c.supertypes || []), ...(c.types || [])].join(" ") + ((c.subtypes || []).length ? ` — ${c.subtypes.join(" ")}` : "");
  const other = otherSide(c, name);
  const prep = zone === "battlefield" ? preparedBy(c.id) : null; // (its prepare spell's copy in exile: notePrepared)
  return {
    // a double-faced card's back is its other face (the imported deck's back is the plain card back): flipping it
    // on the table shows the other side, as the table's own state button did
    id: c.id, n: name, f: face, b: imageCache[normName(name)]?.back || img?.back || DEFAULT_BACK,
    // (and its other side again, kept where the back is the plain one, a hand: the table gives such a card a second
    // state to read and cast it by, docs/card-other-side-spec.md; n2 that side's name)
    ...(other ? { o2: other.pic, ...(other.name ? { n2: other.name } : {}) } : {}),
    tl: typeLine, cmc: c.cmc || 0, tx: c.text || "", ty: c.types || [],
    tap: !!c.tapped, fd: !!c.isFaceDown, p: c.power ?? null, t: c.toughness ?? null,
    bp, bt,
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
    // a prepared creature's spell copy (notePrepared): shown with its creature, as a linked exile, when it isn't in a
    // seated player's playable row (HAND-TEST-HP06 #20)
    ...(!c.exiledWith && !c.encodedOn && game?.prepared?.has(c.id) ? { ew: game.prepared.get(c.id).host } : {}),
    // its text as changed (Mind Bend, Exchange of Words, Deadpool, Volrath's Shapeshifter: Forge's current text, sent
    // only when changed) and its printed name when a text effect renamed it (hp-25 T0 T13)
    // (each line once: Forge's text repeats a replacement's line, "As Deadpool enters, ..." twice on the Shapeshifter)
    // (an empty one is a text taken away: Llanowar Elves after Exchange of Words with Grizzly Bears, 2026-11-05)
    ...(c.currentText != null ? { ct: [...new Set(displayText(c.currentText).replace(/\r\n/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean))].join("\n") || "(no text)" } : {}),
    ...(c.printedName ? { pn: c.printedName } : {}),
    ...(c.isForetold ? { fo: true } : {}),
    ...(c.isCopy ? { cp: true } : {}), // (a copy of another card: marked COPY on the table)
    ...(c.phasedOut ? { po: true } : {}), // (phased out: stays where it was, marked on the table; our Forge build sends it)
    // (goaded, which Forge doesn't show: with the keywords another card gave it, "Goaded by White", hp-05 gap)
    // (and exerted, which nothing showed: Arena of Glory stays tapped through its controller's next untap step, hp-09 gap)
    // (a curse on a player: the player it is on, for the table to lay it on their mat, engine1112 attachedToPlayer)
    ...(c.attachedToPlayer && game.slotColor[c.attachedToPlayer] ? { attP: game.slotColor[c.attachedToPlayer] } : {}),
    ...statusLists(c, [...(game.goaded?.has(c.id) ? [`Goaded by ${nameOf(game.goaded.get(c.id).by)}`] : []),
      ...(game.renowned?.has(c.id) ? ["Renowned"] : []),
      ...(game.suspected?.has(c.id) ? ["Suspected: can't block"] : []),
      // (a permanent's states and what a delayed trigger will do to it; a card elsewhere is in a pile or a hand)
      ...(zone === "battlefield" ? [...cardStateWords(c), ...delayedWordsOf(c.id)] : []),
      ...hauntedBy(c.id).map((n) => `Haunted by ${n}`),
      ...(c.summoningSick && active === c.controllerId && c.types?.includes("Creature") ? ["Summoning sick"] : []),
      ...(c.isCrewed ? ["Crewed"] : []), ...(c.isBestowed ? ["Bestowed"] : []), ...(c.isRingBearer ? ["Ring-bearer"] : []),
      // (prepared, which Forge's card view doesn't say: its spell copy in exile, notePrepared; HAND-TEST-HP06 #20)
      ...(prep ? [`Prepared: ${prep.spell} — ${nameOf(c.controllerId) || "its controller"} may cast a copy`] : []),
      ...(c.finalChapter ? [`Chapter ${loreOf(c)} of ${c.finalChapter}`, ...nextChapter(c)] : []),
      ...(c.classLevel ? [`Level ${c.classLevel}`, ...nextLevel(c)] : []),
      // (Forge's own combat sums, as the attackers and blockers stand; a trick can still change it)
      ...(c.wouldDieInCombat && (c.isAttacking || blockers?.has(c.id)) ? ["Dies in this combat as it stands"] : []),
      ...(zone === "battlefield" && ownerOf(c) && c.controllerId && ownerOf(c) !== c.controllerId ? [`Owned by ${nameOf(ownerOf(c))}`] : []),
      ...(zone === "battlefield" ? choiceWords(c, views) : [])]),
    ...cardNotes(c, zone),
    ...costNow(c, zone), // (what it costs now, when that isn't its printed cost: the table's cost badge)
  };
}

// What the card's status box lists: kw, what changed about it (granted keywords and the table's marks), and ow, the
// always-on keywords of its own. A card nothing changed has no box, so ow goes only with a box (kw, or phased out).
function statusLists(c, marks) {
  const { granted, own } = cardKeywords(c);
  const kw = [...granted, ...marks];
  return { ...(kw.length ? { kw } : {}), ...((kw.length || c.phasedOut) && own.length ? { ow: own } : {}) };
}

// The states Forge keeps on a permanent that its picture doesn't show, as status box words (engine1112: CardDto
// exerted, skipsNextUntap, monstrous, saddled/saddledBy, harnessed, solved, unlockedDoors, pairedWith, protectorId,
// cantAttack, cantBlock, mustAttack; docs/readability-audit-2026-11-12.md E3-E5). An older engine sends none of the new
// ones (and `exerted` only for the turn it was exerted), so its cards say what they said before. Exerted lasts until
// its controller's untap step: Forge clears the turn's count at cleanup but keeps the creature frozen.
function cardStateWords(c) {
  const out = [];
  const card = (id) => game?.namesSeen?.get(id) || "a card";
  if (c.exerted) out.push("Exerted (won't untap)");
  // (one line for one fact: exerted already says it won't untap)
  else if (c.skipsNextUntap) out.push("Doesn't untap next untap step");
  if (c.monstrous) out.push("Monstrous");
  if (c.saddled) out.push((c.saddledBy || []).length ? `Saddled (by ${c.saddledBy.map(card).join(", ")})` : "Saddled");
  if (c.harnessed) out.push("Harnessed");
  // (Forge's flag, else the log's own guess from a "solved" line, game.solved, for an older engine)
  if (c.solved || game?.solved?.has(c.id)) out.push("Solved");
  const doors = (c.unlockedDoors || []).map(String);
  if (doors.length) out.push(doors.length > 1 ? "Both doors unlocked" : `Unlocked: ${doors[0]}`);
  if (c.pairedWith) out.push(`Paired with ${card(c.pairedWith)}`);
  if (c.protectorId) out.push(`Protected by ${nameOf(c.protectorId)}`);
  if (c.attachedToPlayer) out.push(`Attached to ${nameOf(c.attachedToPlayer)}`);
  // (Forge flags a creature with defender as unable to attack: its own keyword says so already. A suspected creature's
  // line says it can't block.)
  const cantAttack = c.cantAttack && !hasKeyword(c, "Defender");
  const cantBlock = c.cantBlock && !game?.suspected?.has(c.id);
  if (cantAttack && cantBlock) out.push("Can't attack or block");
  else if (cantAttack) out.push("Can't attack");
  else if (cantBlock) out.push("Can't block");
  if (c.mustAttack) out.push("Must attack");
  return out;
}

// Forge's delayed triggers (engine1112 GameViewDto.delayed: { id, text, controllerId, hostCardId?, cardIds[], when?,
// turnOf? }, docs/readability-audit-2026-11-12.md E2), read once a board (sendTable keeps it as game.delayedNow): `cards`, card id ->
// what will happen to it ("Sacrificed at end step", "Returns at end step") or, on the trigger's own card, what it will
// do ("At end step: sacrifice Hill Giant"); `players`, slot -> [{ label, tip }] for one with no card that waits for a
// player's turn (a pact's upkeep cost). Nothing from an engine that sends none.
const DELAYED_VERBS = [[/^sacrifice\b/i, "Sacrificed"], [/^exile\b/i, "Exiled"], [/^destroy\b/i, "Destroyed"],
  [/^return\b.*\b(?:to (?:its|their) owners?'s? hands?|to your hand)\b/i, "Returns to hand"], [/^return\b/i, "Returns"],
  [/^(?:shuffle|put)\b.*\binto (?:its|their) owners?'s? librar/i, "Shuffled into library"]];
// (Forge's text with the "at the beginning of ..." clause dropped and a leading one cut: "At the beginning of the next
// end step, return it" -> "return it")
const delayedAction = (text) => String(text || "").trim().replace(/^at the beginning of [^,]*,\s*/i, "")
  .replace(/\s+at the beginning of [^.,]*/i, "").replace(/\.\s*$/, "").split(/\.\s/)[0];
function delayedWhen(d) {
  if (!d.when) return "";
  return d.turnOf ? ` at ${nameOf(d.turnOf)}'s next ${d.when}` : ` at ${d.when}`;
}
// (hidden information: what every seat sees comes from one seat's view, and Forge's texts name the cards a trigger
// remembers, which the engine strips of ids but not of names; a trigger whose host or any remembered card is face
// down or out of the public zones in that view shows no text, only its fixed words, publicCardIds)
function delayedOf(pub) {
  const cards = new Map(), players = new Map();
  const shown = publicCardIds(pub);
  const add = (map, k, v) => { if (!map.has(k)) map.set(k, []); if (!map.get(k).some((x) => JSON.stringify(x) === JSON.stringify(v))) map.get(k).push(v); };
  for (const d of Array.isArray(pub?.delayed) ? pub.delayed : []) {
    if (!d || typeof d.text !== "string") continue;
    const ids = Array.isArray(d.cardIds) ? d.cardIds : [];
    const open = [...ids, ...(d.hostCardId ? [d.hostCardId] : [])].every((id) => shown.has(id));
    const action = open ? delayedAction(d.text) : "";
    const verb = open ? DELAYED_VERBS.find(([re]) => re.test(action)) : null;
    const when = delayedWhen(d); // (" at end step", or "")
    const At = when ? `A${when.slice(2)}` : "Later"; // ("At end step")
    const doing = open ? shortText(`${At}: ${action.charAt(0).toLowerCase()}${action.slice(1)}`, 80) : `${At}: a delayed trigger`;
    for (const id of ids) add(cards, id, verb ? `${verb[1]}${when || " later"}` : doing);
    if (d.hostCardId && !ids.includes(d.hostCardId)) add(cards, d.hostCardId, doing);
    // (no card to mark and waiting for a player's turn, or with no card at all: the player's mark, Pact of Negation's)
    if (!ids.length && (d.turnOf || !d.hostCardId)) {
      const who = d.turnOf || d.controllerId;
      const host = d.hostCardId ? game?.namesSeen?.get(d.hostCardId) : null;
      const label = `${d.turnOf && d.when ? "NEXT " : ""}${d.when ? `${String(d.when).toUpperCase()}: ` : ""}${open ? action.toUpperCase() : "DELAYED TRIGGER"}`;
      if (who) add(players, who, { label: shortText(label, 40), tip: open ? `${host ? `${host}: ` : ""}${d.text.trim()}` : "" });
    }
  }
  return { cards, players };
}
// The ids of the cards every seat may see in a view: face up in a public zone (the log's PUBLIC_ZONES)
// or on the stack; not a hand's or a library's, nor a face-down or hidden one
function publicCardIds(pub) {
  const ids = new Set();
  for (const z of pub?.zones || []) {
    if (!PUBLIC_ZONES.includes(z.zone)) continue;
    for (const c of z.cards || []) if (c?.id && c.identity && !c.isFaceDown && c.visibility !== "hidden") ids.add(c.id);
  }
  // (a spell on the stack by its own id; not an ability's source, which may be a card in a hand)
  for (const s of pub?.stack || []) if (s?.id && s.identity?.name && !s.isFaceDown) ids.add(s.id);
  return ids;
}
const delayedWordsOf = (id) => game?.delayedNow?.cards.get(id) || [];

// What a card in a graveyard or exile can still do, and its counters in exile (suspend's time counters, Dauthi
// Voidwalker's void counters): the table puts these in its hover text and on its pile, as the cards inside a pile deck
// show no status box
function cardNotes(c, zone) {
  const nt = [];
  if (zone === "graveyard" && c.flashbackCost) {
    const cost = keywordCostText(c, "Flashback", c.flashbackCost);
    nt.push(cost ? `Flashback ${cost}` : "Has flashback");
  }
  // (what a delayed trigger will do to it, a card in a pile showing no status box: Flickerwisp's exiled card returns)
  if (zone === "exile" || zone === "graveyard") nt.push(...delayedWordsOf(c.id));
  if (zone === "exile") {
    if (c.isMadnessExiled) nt.push(`Exiled for madness: its owner may cast it for ${keywordCostText(c, "Madness", c.madnessCost) || "its madness cost"}, or it goes to the graveyard`);
    if (c.isWarpExiled) nt.push("Warped: its owner may cast it from exile on a later turn");
    if (c.isPlotted) nt.push("Plotted: its owner may cast it without paying its mana cost on a later turn, as a sorcery");
    // (a prepared creature's spell copy, notePrepared: not a card of anyone's deck; Forge lets the creature's controller
    // cast it, and it ceases to exist when the creature leaves the battlefield)
    const prep = game?.prepared?.get(c.id);
    if (prep) nt.push(`Prepared by ${prep.hostName}: a copy of its spell, not a card. ${(prep.ctl && nameOf(prep.ctl)) || "Its controller"} may cast it; doing so unprepares ${prep.hostName}. It ceases to exist if ${prep.hostName} leaves the battlefield.`);
    // (exile only: counters leave a card that moves (CR 122.2), and nothing reads counters in a graveyard)
    for (const [k, n] of Object.entries(c.counters || {})) if (n) nt.push(`${n} ${counterWords(k.toUpperCase()) || `${k.toLowerCase()} counter`}${n === 1 ? "" : "s"}`);
  }
  return nt.length ? { nt: nt } : {};
}
// A keyword's cost as the card prints it ("Flashback {2}{R}", "Flashback—Pay 3 life"), else Forge's cost string as
// mana symbols ("2 R" -> "{2}{R}"), for a keyword another card granted; null for any other cost of Forge's
// ("Discard<1/Card>"), which is no words for a player
function keywordCostText(c, word, cost) {
  const printed = new RegExp(`\\b${word}(?: |—)([^(\\n]+)`).exec(c.text || "")?.[1]?.trim().replace(/\.$/, "");
  if (printed) return printed;
  const parts = String(cost || "").trim().split(/\s+/);
  return cost && parts.every((p) => /^[0-9WUBRGCXSP/]+$/.test(p)) ? parts.map((p) => `{${p}}`).join("") : null;
}

// What a card costs now when that isn't its printed cost, for the table's cost badge (docs/cost-badge-spec.md): ec, the
// cost now, and mc, the printed one ("" for Forge's "no cost"). The cost now is Forge's effectiveManaCost (every
// reduction, increase and the commander tax Forge applies; sent only for a card its seat may cast from the hand, the
// command zone or the library's top, and only when it differs). Display only: the payment question says what is paid.
// A commander in the command zone: the engine's cost (or the printed one when it sent none) plus its commanderTax.
// Forge's effective cost leaves the tax out there: CostAdjustment.adjust adds it only when the card's castFrom is the
// command zone, which GameAction sets as the card moves to the stack, so a commander waiting in the command zone is
// priced untaxed (Mairsil showed no badge once a Thalia hand cost had come, live check 2026-11-12). Should an engine
// ever price the tax in, its cost then has at least the tax more generic than the printed one, and is taken as it is:
// the one misreading left is an untaxed cost raised by the tax's amount or more by other effects.
function costNow(c, zone) {
  const printed = c.manaCost && c.manaCost !== "no cost" ? String(c.manaCost) : "";
  let now = c.effectiveManaCost || null;
  const tax = zone === "command" ? Number(c.commanderTax) || 0 : 0;
  const base = now || printed;
  if (tax > 0 && base && genericOf(base) - genericOf(printed) < tax) {
    const generic = /^\{(\d+)\}/.exec(base);
    now = `{${(generic ? Number(generic[1]) : 0) + tax}}${generic ? base.slice(generic[0].length) : base}`;
  }
  return now && now !== printed ? { ec: now, mc: printed } : {};
}
// the generic part of a mana cost string, "{3}{U}" -> 3 (none: 0)
const genericOf = (cost) => Number(/^\{(\d+)\}/.exec(cost || "")?.[1] || 0);

// The lore counters on a Saga (the counter's name comes from Forge: compared without its case)
const loreOf = (c) => Object.entries(c.counters || {}).find(([k]) => k.toUpperCase() === "LORE")?.[1] || 0;

// The cards haunting a creature (game.haunting: haunting card id -> its creature's id), by name (hp-20 gap)
function hauntedBy(id) {
  return [...(game?.haunting || [])].filter(([, t]) => t === id).map(([h]) => game.namesSeen?.get(h) || "a haunting card");
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
const shortText = (s, n = 90) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
// A Saga's next chapter, which its next lore counter brings (Forge's chapter list: one entry may cover several, "I, II")
function nextChapter(c) {
  const n = loreOf(c) + 1;
  const ch = (c.sagaChapters || []).find((x) => (x.chapters || []).includes(n));
  return ch && n <= c.finalChapter ? [`Next, chapter ${ROMAN[n] || n}: ${shortText(ch.oracle)}`] : [];
}
// A Class's next level and what it costs to gain
function nextLevel(c) {
  const next = (c.classLevels || []).find((x) => x.level === c.classLevel + 1);
  return next?.cost ? [`Level ${next.level} costs ${next.cost}`] : [];
}

// What a permanent chose as it entered (a colour, a creature type, a card name, a player), in words. A choice made in
// secret reaches only the seats allowed to see it, and the table is drawn the same for everyone, so a choice is said
// only when every human seat's view (views: each seat's card index) has it.
const COLOR_WORDS = { W: "white", U: "blue", B: "black", R: "red", G: "green", C: "colorless" };
const CHOICE_WORDS = {
  color: (x) => `Chosen colour: ${(x.colors || []).map((k) => COLOR_WORDS[k] || k).join(", ")}`,
  type: (x) => `Chosen type: ${(x.values || []).join(", ")}`,
  namedCard: (x) => `Named: ${(x.names || []).join(", ")}`,
  chosenCard: (x) => `Chose ${x.count} card${x.count === 1 ? "" : "s"}`,
  number: (x) => `Chosen number: ${x.value}`,
  mode: (x) => `Chosen: ${x.value}`,
  player: (x) => `Chosen player: ${game.slotNames[x.playerId] ? nameOf(x.playerId) : x.name || x.playerId}`,
};
function choiceWords(c, views) {
  const same = (x) => views.every((v) => (v[c.id]?.choices || []).some((y) => JSON.stringify(y) === JSON.stringify(x)));
  return (c.choices || []).filter((x) => CHOICE_WORDS[x.kind] && same(x)).map((x) => CHOICE_WORDS[x.kind](x));
}


// Keywords a card has now that its own text doesn't give it: granted by another card (Skrelv's toxic 1 and hexproof
// from a colour on Kenrith showed nowhere, hp-07 #31). Forge's keyword strings read as words (as it sent them live):
// "Toxic:1" -> "Toxic 1", "Hexproof:Red" -> "Hexproof from red", "Landwalk:Swamp" -> "Swampwalk",
// "Protection:Card.Black:black" -> "Protection from black". Its internal ones are left out: "ETBReplacement:...", and
// the run-together names ("MayFlashSac", "AlternateAdditionalCost") and the few plain words that aren't keywords
// ("Chapter:3:DBSacrifice,..." read "Chapter from DBSacrifice,..." on a Saga, Ur-Dragon game 2026-11-01; a dungeon's
// "Dungeon:DBEntrance,..." boxed its room list, live check batch 2 2026-11-12).
// Its own keywords are returned too, those that are always on: Equip or Cycling on a permanent is no status.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The ids of one kind in a player's target picks ("card|engine-card-5", "player|player-1": the boardTargets answer's)
const pickedIds = (ids, kind) => (ids || []).filter((t) => t.startsWith(`${kind}|`)).map((t) => t.slice(kind.length + 1));
// A chooseCards question that asks for a source (Reflect Damage's, a Circle's, Deflecting Palm's: Forge's "Choose a
// source " or its zone headings): titled so, and never offered as a library search. Seat.respond's own looser test of
// the raw words only adds the "chooses" line.
const isSourceChoice = (input) => !!input.sourceHeadings || /^Choose a source\b/i.test(String(input.presentation?.description || "").trim());
const NOT_KEYWORD = /Replacement|^ETB|^Hidden|^Static|^Trigger|^[A-Z][a-z]+[A-Z]|^(Chapter|Class|Visit|Prize|Piracy|Dungeon)$/;
const ALWAYS_ON = /^(Flying|First Strike|Double Strike|Deathtouch|Lifelink|Trample|Vigilance|Haste|Reach|Menace|Hexproof|Indestructible|Defender|Shroud|Ward|Protection|Fear|Intimidate|Skulk|Shadow|Horsemanship|Flanking|Banding|Infect|Wither|Toxic|Afflict|Annihilator|Exalted|Prowess|Bushido|Rampage|Battle Cry|Dethrone|Undying|Persist|Absorb|Melee|Mentor|Training|Riot|Backup|Changeling|\w+walk)\b/i;
// Whether a card has a keyword: Forge's keyword string starts with it and no more letters follow ("Suspend 1—{R}",
// "Suspend:3:..." are Suspend; Flashback is not Flash). One reader for every such check: "/flash/i" matched Flashback,
// and a flashback sorcery read as castable at instant speed.
function hasKeyword(c, word) {
  const w = String(word).toLowerCase();
  return (c?.keywords || []).some((k) => { const s = String(k).toLowerCase(); return s.startsWith(w) && !/^[a-z-]/.test(s.slice(w.length)); });
}

function cardKeywords(c) {
  const granted = [], own = [];
  // (its text as changed when it was: Mind Bend's islandwalk is its own text, not a grant, hp-25)
  const text = String(c.currentText != null ? withoutForgeNotes(c.currentText).replace(/\r\n/g, "\n") : c.text || "");
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
// slot: the seat's player. Another player's library never counts: Forge's list also takes a card that seat may only
// look at, and Courser of Kruphix's revealed top card was in the opponent's row as well as its owner's (each scry then
// threw it across the table, 2026-11-08 20:23 game). Our Forge build (2026-11-09) sends mayPlay only for a card the
// seat may really play; an older one counts a look, so a library card of another player is left out either way (no
// card lets you play from another player's library top).
// (another player's hand too, when this seat may cast from it: Sen Triplets; never marked by an older build)
function playableOf(own, toCard, slot) {
  const out = [];
  for (const z of own?.zones || []) {
    // (and the library's top card when its owner may play it: The Reality Chip offered "Cast Enlightened Tutor" from
    // the top of the library with nothing shown, hp-13 gap; the row is the owner's own second hand zone)
    const mine = z.ownerId === slot;
    if (z.zone !== "exile" && z.zone !== "graveyard" && !(z.zone === "library" && mine) && !(z.zone === "hand" && !mine)) continue;
    // (with its zone: a flashback card's entry carries "Flashback {cost}" as its graveyard entry does, or the table drew
    // it without, and its self-check called the hover text wrong, Lingering Souls 2026-11-08)
    for (const c of z.cards || []) if (c.mayPlay && c.visibility !== "hidden") out.push(toCard(c, z.zone));
  }
  return out;
}

// A player's hand cards shown to the whole table (Revelation's "Players play with their hands revealed", Sen
// Triplets' "plays with their hand revealed"): the ones every other human seat's view shows (Forge sends another
// player's hand card only when that seat may see it). An AI's too, read from the human seats. One seat's private look
// (Mindslaver's controller sees the hand) isn't public, so a card counts only when every other seat sees it, and the
// seat controlling this player (controlledBy) isn't asked: it sees the hand by that control, so with two humans its
// look alone would have made the hand public.
function revealedOf(p, seats, toCard) {
  const by = seats.length ? (seats[0].board.state.gameView.players || []).find((x) => x.id === p.id)?.controlledBy : null;
  const others = seats.filter((s) => s.slot !== p.id && s.slot !== by);
  if (!others.length) return [];
  const sees = others.map((s) => new Set((zoneOf(s.board.state.gameView, "hand", p.id).cards || [])
    .filter((c) => c.visibility === "visible" && c.identity).map((c) => c.id)));
  return (zoneOf(others[0].board.state.gameView, "hand", p.id).cards || []).filter((c) => sees.every((ids) => ids.has(c.id)))
    // (face up, its plain back as in a hand: a double-faced card's back would be its other face)
    .map((c) => ({ ...toCard(c), b: DEFAULT_BACK }));
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
// Who owns each card. Forge's battlefield card names its controller as its owner (InteractiveSnapshotExtractor builds a
// battlefield card with the index of the player whose battlefield holds it, the controller), so a stolen card's owner is
// read where it is certain: any other zone (always its owner's), a stack item (its source's owner) or Forge's events
// (CardView's owner). A card only ever seen on the battlefield keeps what it showed first: a token's owner is the player
// it entered under. Chaos Warp on AI 1's Serra Angel under White's control read "is put into White's library", Kykar #12;
// the assimilated Grizzly Bears read White's, re-test new bug 9.
function noteOwners(pub) {
  if (!game) return;
  const owners = (game.owners ??= new Map());
  for (const z of pub.zones || []) for (const c of z.cards || []) {
    if (!c.id || !z.ownerId) continue;
    if (z.zone !== "battlefield") owners.set(c.id, z.ownerId);
    else if (!owners.has(c.id)) owners.set(c.id, c.ownerId || z.ownerId);
  }
  for (const s of pub.stack || []) if (s.sourceId && s.ownerId) owners.set(s.sourceId, s.ownerId);
  for (const e of Array.isArray(pub.events) ? pub.events : []) if (e.cardId && e.ownerId) owners.set(e.cardId, e.ownerId);
}
// (a card's owner by noteOwners, else what its zone says)
function ownerOf(c, z) { return game?.owners?.get(c.id) || c.ownerId || z?.ownerId; }
// Prepared creatures (Grave Researcher, Emeritus of Conflict; HAND-TEST-HP06 #20), read from the board alone. Forge's
// AlterAttributeEffect ("Prepared") makes a copy of the creature's prepare spell in the preparing player's exile, from
// the creature's own paper card (CopyPermanentEffect.getProtoType: a token, so identity.isToken, with the creature's set
// and collector number and the spell's name, no token script), and an effect card that lets the creature's controller
// cast it. The effect card is immutable, so the harness leaves it out of the command zone, and the harness sends no
// prepared flag: the copy is the one sign. Casting the copy unprepares the creature, and its leaving play (or "becomes
// unprepared") makes the copy cease to exist, so a creature is prepared while its copy is in exile. A copy is an
// instant or a sorcery (every prepare spell in Forge's cardsfolder, 69 cards, 2026-11-12) with a set and collector
// number; Forge lets the creature's controller cast it (mayPlay), which a seat's view shows only when that controller
// is a human seat, so an AI's creature's copy goes by its printing alone. A copy keeps the creature it was first matched
// with while both are there; a new one takes a creature of that printing with another name not already prepared, a
// card before a token copy of it, and of those first one controlled by the copy's exile owner (Forge's activator,
// AlterAttributeEffect: the creature's own controller unless another card prepared it). Two alike prepared at once may
// swap names, the one gap. -> game.prepared: copy id -> { host: the creature's id, hostName, ctl: its controller,
// spell: the copy's name }.
function notePrepared(pub) {
  if (!game) return new Map();
  const field = [];
  for (const z of pub.zones || []) if (z.zone === "battlefield") for (const c of z.cards || []) if (c.identity?.name && !c.isFaceDown) field.push(c);
  const copies = [];
  for (const z of pub.zones || []) {
    if (z.zone !== "exile") continue;
    for (const c of z.cards || []) {
      if (c.identity?.isToken && !c.identity.tokenScript && !c.isFaceDown && c.identity.setCode && c.identity.cardNumber && c.identity.name
        && (c.types || []).some((t) => t === "Instant" || t === "Sorcery")) copies.push({ c, owner: z.ownerId });
    }
  }
  // (Forge's mayPlay in the board's view or any human seat's, and the players those views belong to)
  const playable = new Set(), viewed = new Set();
  const views = [pub];
  for (const s of game.seats?.values() || []) if (s.board?.state?.gameView) { views.push(s.board.state.gameView); if (s.slot) viewed.add(s.slot); }
  for (const gv of views) for (const z of gv.zones || []) if (z.zone === "exile") for (const c of z.cards || []) if (c.mayPlay) playable.add(c.id);
  const was = game.prepared || new Map(), now = new Map(), hosting = new Set();
  const link = (c, h) => { now.set(c.id, { host: h.id, hostName: h.identity.name, ctl: h.controllerId || null, spell: c.identity.name }); hosting.add(h.id); };
  for (const { c } of copies) {
    const h = field.find((f) => f.id === was.get(c.id)?.host);
    if (h) link(c, h);
  }
  for (const { c, owner } of copies) {
    if (now.has(c.id)) continue;
    const alike = field.filter((f) => !hosting.has(f.id) && f.identity.name !== c.identity.name && f.identity.setCode === c.identity.setCode
      && String(f.identity.cardNumber) === String(c.identity.cardNumber) && (playable.has(c.id) || !viewed.has(f.controllerId)));
    const cards = alike.filter((f) => !f.identity.isToken);
    const pool = cards.length ? cards : alike;
    const h = pool.find((f) => (f.controllerId || owner) === owner) || pool[0];
    if (h) link(c, h);
  }
  game.prepared = now;
  return now;
}
// the prepared copy whose creature is this one (notePrepared), or null
function preparedBy(hostId) {
  for (const p of game?.prepared?.values() || []) if (p.host === hostId) return p;
  return null;
}
// The room a dungeon card is in, by Forge's player dungeonState: the card by its cardId, or, from an engine that sends no
// id, the dungeon of that name in its owner's command zone. Null when no player's state names it or it is in no room yet.
function dungeonPlayerOf(pub, c, owner) {
  return (pub.players || []).find((p) => p.dungeonState && (p.dungeonState.cardId ? p.dungeonState.cardId === c.id
    : p.id === owner && p.dungeonState.name === c.identity?.name)) || null;
}
function dungeonRoomOf(pub, c, owner) { return dungeonPlayerOf(pub, c, owner)?.dungeonState.room || null; }
function logSnapshot(pub, prev = null) {
  const cards = {}, counts = {};
  noteOwners(pub);
  const prepared = notePrepared(pub);
  for (const z of pub.zones || []) {
    if (PUBLIC_ZONES.includes(z.zone)) for (const c of z.cards || []) {
      // (a face-down card is named in nobody's log: the board comes from one seat's view, which may know what it is)
      // (its owner by noteOwners: a battlefield card's own ownerId is its controller's, Kykar #12)
      if (c.identity) cards[c.id] = { zone: z.zone, name: c.isFaceDown ? "a face-down card" : c.identity.name, fd: !!c.isFaceDown,
        owner: ownerOf(c, z), ctl: c.controllerId || z.ownerId,
        // (a plane or a phenomenon in a command zone: Planechase's lines)
        ...(z.zone === "command" && (c.types || []).includes("Plane") ? { planar: "plane" } : z.zone === "command" && (c.types || []).includes("Phenomenon") ? { planar: "phenomenon" } : {}),
        // (what a creature can deal and has been dealt, for the damage lines: see damageNews)
        ...(c.damage > 0 ? { dmg: c.damage } : {}), ...((c.types || []).includes("Creature") && /^\d+$/.test(String(c.power ?? "")) ? { pw: Number(c.power) } : {}),
        ...(hasKeyword(c, "Lifelink") ? { ll: true } : {}), ...(hasKeyword(c, "Double Strike") ? { ds: true } : {}), ...(hasKeyword(c, "First Strike") ? { fs: true } : {}),
        // (the player it attacks, by Forge's attack target alone: attackingPlayerId names the defending player when it
        // attacks their planeswalker too)
        ...(c.isAttacking && /^player-/.test(String(c.attackTargetId || "")) ? { atp: c.attackTargetId } : {}),
        // (and the planeswalker or battle it attacks, for the attack line: "White attacks with Hero of Bladehold" didn't
        // say it attacked Jace, live check 2026-11-11)
        ...(c.isAttacking && c.attackTargetId && !/^player-/.test(String(c.attackTargetId)) ? { atc: c.attackTargetId } : {}),
        // (a creature's keywords, for the ones a spell gives: see tapNews)
        ...(z.zone === "battlefield" && c.keywords?.length && (c.types || []).includes("Creature") ? { kw: c.keywords.map(String) } : {}),
        land: (c.types || []).includes("Land"), creature: (c.types || []).includes("Creature"), token: !!c.identity.isToken, attacking: !!c.isAttacking, tapped: !!c.tapped,
        ...(c.isPlotted ? { plotted: true } : {}), ...(c.attachedTo ? { att: c.attachedTo } : {}),
        // (the Ring-bearer, for the Ring's tempt line: readability audit C7)
        ...(c.isRingBearer ? { rb: true } : {}),
        ...(c.exiledWith ? { ew: c.exiledWith, rl: !!c.returnsWhenHostLeaves } : {}),
        // (a prepared creature's spell copy: its creature, for the prepare and cast lines; notePrepared)
        ...(z.zone === "exile" && prepared.has(c.id) ? { prep: prepared.get(c.id).host, prepBy: prepared.get(c.id).hostName } : {}),
        // (its own name when it is a copy or renamed: Clone as Bloodline Keeper, rebuilt hand test #10)
        ...(c.printedName && !c.isFaceDown && c.printedName !== c.identity.name ? { pn: c.printedName } : {}),
        spell: (c.types || []).some((t) => t === "Instant" || t === "Sorcery"), p1: c.counters?.P1P1 || 0, m1: c.counters?.M1M1 || 0,
        // (its other counters but loyalty, for its arrival line: Tangle Wire's 4 fade counters read nothing, hp-14 gap)
        ...((o) => (o.length ? { ctrs: o } : {}))(Object.entries(c.counters || {}).filter(([k, n]) => n > 0 && !/^(?:P1P1|M1M1|LOYALTY)$/i.test(k))),
        // (Forge's key is "Loyalty": read as "LOYALTY", no planeswalker's loyalty was ever seen, Kykar #13 probe)
        ...((n) => (n > 0 ? { loy: n } : {}))(Object.entries(c.counters || {}).find(([k]) => /^loyalty$/i.test(k))?.[1]),
        ...(c.mergedCardIds?.length ? { merged: [...c.mergedCardIds] } : {}),
        ...(hasKeyword(c, "Rebound") ? { rebound: true } : {}),
        ...(hasKeyword(c, "Suspend") ? { suspend: true } : {}),
        // (phasing is no zone change, so it stays "battlefield" here: Forge says which, the log no longer guesses)
        ...(c.phasedOut ? { po: true } : {}),
        // (a dungeon's room, Forge's "[Room: Cave Entrance]" note: venturing read only its effect, "+1 life", mechanic run hp-08;
        // Forge's own dungeonState first, docs/planechase-dungeon-engine-spec.md D5)
        ...((r) => (z.zone === "command" && r ? { room: r } : {}))(z.zone === "command" ? dungeonRoomOf(pub, c, z.ownerId) ?? /\[Room: ([^\]]+)\]/.exec(String(c.currentText ?? c.text ?? ""))?.[1] : null),
        // (its text as it reads now, for a text box swap: Exchange of Words was in no log, rebuilt hand test #11)
        ...(z.zone === "battlefield" && !c.isFaceDown ? { tx: String(c.currentText ?? c.text ?? "").replace(/\r\n/g, "\n").trim() } : {}),
        // (it gives mana by sacrificing itself: a Treasure's sacrifice, see sacrificeWords)
        ...(/\bSacrifice [^:.]*: Add\b/.test(c.text || "") ? { selfMana: true } : {}) };
    }
    if (z.zone === "hand" || z.zone === "library") counts[`${z.zone}:${z.ownerId}`] = z.count ?? (z.cards || []).length;
  }
  const life = Object.fromEntries((pub.players || []).map((p) => [p.id, p.life]));
  // keyed by what it is, not its id: a spell keeps changing ids while it is being cast
  const stack = {};
  for (const s of pub.stack || []) {
    // (a spell by its card alone: its text grows as it is cast, Tooth and Nail entwined read "casts Tooth and Nail" twice, hp-09)
    const ability = isAbilityOnStack(s, pub);
    // (a spell still being cast is not on the stack yet: its extra costs come once it is, and Llanowar Elite kicked read
    // "White casts Llanowar Elite" from the board before the kicker was chosen, keyword sweep 2026-11-04. Only spells are
    // ever mid-cast, a retrace one still in the graveyard too, where it looks like an ability)
    if (s.isCasting) continue;
    const key = ability ? `${s.sourceId}|${s.sourceAbilityText || ""}` : `${s.sourceId}|spell`;
    // (Forge's paradigm effect is "<card>' Paradigm": said by its card, hp-23 gap)
    // (and an effect, "Eternal Dominion (5)'s Effect": read "... (5)'s Effect's ability triggers", hp-23 gap)
    const effect = /(?:'s Effect|' Paradigm)$/.test(s.identity?.name || "");
    let name = s.identity?.name && s.identity.name !== "?" ? s.identity.name.replace(/' Paradigm$/, "").replace(/(?: \(\d+\))?'s Effect$/, "") : ability ? "a face-down permanent" : "a face-down spell"; // (a face-down creature's ward read "a face-down spell's", hp-20 gap)
    // (a token's ability by the log's word for it: "Goblin Shaman Token's ability triggers" on the real table, 2026-11-05)
    // (or by Forge's word, its token sacrificed to pay for it: a Clue's, Kykar #19)
    if (ability && (cards[s.sourceId]?.token || s.identity?.isToken) && s.identity?.name) name = tokenWords(name, true);
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
    const when = /^(?:When|Whenever|At)\b/.test(s.sourceAbilityText || "");
    // (and by the engine's word when it gives one: a Saga's chapter, "I — Create ...", and a delayed trigger, Arcane
    // Denial's "Draw a card.", read "White uses Fable of the Mirror-Breaker's ability", rebuilt hand test 2026-11-04 #8;
    // from an engine that gives none, a chapter by its numeral and a delayed trigger by Forge's own "at the ..." ending)
    const chapter = (s.sourceAbilityText || "").match(/^([IVX]+(?:, [IVX]+)*) — /)?.[1];
    const trigger = ability && (when || !!s.isTrigger || !!chapter
      // (no cost before a colon: Reflection of Kiki-Jiki's own "{1}, {T}: ... Sacrifice it at the beginning of the next end
      // step." is an activation)
      || (/\bat the (?:beginning of (?:the|your) next (?:end step|upkeep)|end of combat)\.$/.test(s.sourceAbilityText || "") && !/^[^.]*?:\s/.test(s.sourceAbilityText)));
    // (and a keyword's trigger by its keyword, its reminder saying when: Ward's read "AI 1 uses Hexing Squelcher's
    // ability", gap-04)
    // (a keyword of two words whole: Hero of Bladehold's "Battle cry (Whenever ...)" read "battle triggers", hp-16 gap;
    // not an article: "Champion a Merfolk (When ...)" read "champion a triggers", hp-19 gap)
    // (and Forge's "<Keyword> N - <card>" form, no reminder: Surging Dementia's "Ripple 4 - Surging Dementia" read "White
    // uses Surging Dementia's ability", hp-23 gap)
    // ("For Mirrodin!" whole, as printed: it read "Hexplate Wallbreaker's for triggers", mechanic run hp-16)
    const kwTrigger = chapter && ability ? `chapter ${chapter}` : ability && !when ? abilityWord || (s.sourceAbilityText || "").match(/^(For Mirrodin!)\s*\((?:When|Whenever|At)\b/)?.[1]
      // (the second word in capitals too, as Forge writes "Living Weapon": Batterskull's read "living triggers", keyword
      // sweep kw-16)
      || (s.sourceAbilityText || "").match(/^([A-Z][a-z]+(?: (?!an?\b|the\b)[A-Za-z][a-z]+)?)\b[^(]*\((?:When|Whenever|At)\b/)?.[1]?.toLowerCase()
      || (s.sourceAbilityText || "").match(/^([A-Z][a-z]+)(?: \d+)? - [A-Z]/)?.[1]?.toLowerCase()
      // (and a keyword with its reminder straight after it, no cost, so no activation: Paradigm's, and evoke's sacrifice,
      // whose reminder has no "When"; Wispmare's read "Yellow uses Wispmare's ability", keyword sweep)
      || (s.sourceAbilityText || "").match(/^([A-Z][a-z]+) \(/)?.[1]?.toLowerCase()
      // (and one with a cost paid while casting, whose reminder says what it does once the creature enters: offspring's,
      // squad's; Iridescent Vinelasher's read "White uses Iridescent Vinelasher's ability", keyword sweep 2026-11-04)
      || (s.sourceAbilityText || "").match(/^([A-Z][a-z]+) \{[^(]*\((?:You may pay an additional|As an additional cost)\b/)?.[1]?.toLowerCase() : null;
    // (a regeneration shield's creature: the ability's target, or its own source, see logEvents)
    const cardTargets = (s.targets || []).filter((t) => t.kind === "card").map((t) => t.id);
    // (each player once: Explosion's damage and its draw at one player are two targets, and read as two hits of 2 its
    // "-2" was left bare, Kykar probe)
    const playerTargets = [...new Set((s.targets || []).filter((t) => t.kind === "player").map((t) => t.id))];
    const regen = ability && /\bRegenerate\b/.test(s.sourceAbilityText || "") ? (cardTargets.length ? cardTargets : [s.sourceId]) : null;
    // (an ability its source has from a card exiled with it, by that card: Mairsil's from its caged Royal Assassin read
    // "White uses Mairsil, the Pretender's ability", rebuilt hand test #17)
    const own = (s.sourceAbilityText || "").replace(/\.$/, "");
    const via = ability && !trigger && own ? (pub.zones || []).filter((z) => z.zone === "exile").flatMap((z) => z.cards || [])
      .find((c) => c.exiledWith === s.sourceId && c.identity?.name && (c.text || "").includes(own))?.identity.name : null;
    // (a dungeon room's ability, "Yawning Portal — You gain 1 life. (Leads to: Dungeon Level)": the room ventured into.
    // Forge writes no room note on the dungeon card itself; venturing read only "+1 life", mechanic run hp-08 re-test)
    const room = ability && (/\(Leads to: /.test(s.sourceAbilityText || "") || (pub.zones || []).some((z) => z.zone === "command" && (z.cards || []).some((c) => c.id === s.sourceId && (c.types || []).includes("Dungeon"))))
      ? (s.sourceAbilityText || "").match(/^([^—(]+?) — /)?.[1] || null : null;
    stack[key] ??= { id: s.sourceId, name, ctl: s.controllerId, ability, trigger, kwTrigger, upkeepCost, n: 0, sids: [], tg: [], ...(regen ? { regen } : {}), ...(effect ? { effect } : {}),
      ...(s.optionalCosts?.length ? { opt: s.optionalCosts } : {}), ...(via ? { via } : {}), ...(room ? { room } : {}),
      // (its words and the cards it targets: a goad's creatures, see logEvents)
      text: s.sourceAbilityText || "", cardTg: cardTargets, plTg: playerTargets,
      // (Forge's stack words, its numbers and "Activator" filled in: a damage's amount, an unless payment's payer)
      desc: s.text || "" };
    stack[key].n++;
    stack[key].sids.push(s.id);
    // (each item's own targets, by its stack id: two of Niv-Mizzet's pings are one entry, and one may resolve before the
    // other; see logEvents' resolved)
    (stack[key].tgBy ??= {})[s.id] = { c: cardTargets, p: playerTargets };
    // (and its own stack words: two triggers of one card from two opponents' spells name two Activators, see unlessNews)
    (stack[key].descBy ??= {})[s.id] = s.text || "";
    for (const t of s.targets || []) if (t.kind === "spell") stack[key].tg.push(t.id);
    // (and those a counterspell targets: an instant or sorcery under one is countered too, see logEvents)
    // (one cast another way, by its card once it has left the stack, see logEvents: not by Forge's stack words, "Wash Away
    // (81) - Counter Divination (80).", which a counter itself countered still shows, its card then in a hand, suite
    // review 2026-11-06)
    if (castWayOnly(s.sourceAbilityText)) stack[key].way = true;
    else if (isCounterspell(s.sourceAbilityText || s.text || "")) for (const t of s.targets || []) if (t.kind === "spell") (stack[key].ctg ??= []).push(t.id);
  }
  // (who blocks whom: blocker id -> the attackers it blocks)
  const blocks = {};
  for (const a of pub.combatAssignments || []) if (a.blockerId && a.attackerId) (blocks[a.blockerId] ||= []).push(a.attackerId);
  // (each player's land plays this turn: an AI's land play is told from a land an effect put there by it)
  const lands = Object.fromEntries((pub.players || []).map((p) => [p.id, p.landsPlayedThisTurn ?? null]));
  // (each player's marks, PLAYER_MARKS' values: the log says some when they change)
  const marks = Object.fromEntries((pub.players || []).map((p) => [p.id, trackMarks(p, pub).values]));
  // (Planechase: the planes in play and the planar die's last roll, Forge's planar block; null in other games)
  const planar = pub.planar ? { ids: (pub.planar.planeIds || []).map(String), controller: pub.planar.controllerId || null, roll: pub.planar.lastRoll || null } : null;
  return { cards, counts, life, lands, stack, blocks, marks, turnRun: turnRuns(prev, marks, pub), turn: pub.turn, step: pub.step, active: pub.activePlayerId, day: pub.dayTime, planar };
}
// Whose turn another player runs: player id -> the controller, for a control that is a turn's (the TURN RUN BY label
// and the "takes control of ...'s turn" line; any other control is said plainly, see PLAYER_MARKS' controlledBy). Forge
// hands a whole turn over only by ControlPlayerEffect (Mindslaver, Sorin Markov, Emrakul the Promised End: from the
// turn's start to the next cleanup, or one combat with Secret of Bloodbending). It also hands a player over for a
// moment, on any player's turn: Opposition Agent's "control while searching" (ChangeZoneEffect, ChooseCardEffect) and a
// spell cast under another player's control (PlayEffect, MagicStack.resolveStack). Those last only while an ability
// resolves, and Forge keeps a resolving ability on the stack until it is done. So a control is a turn's once a board
// shows it on the active player with an empty stack, and stays one while the same player keeps it (prev: the board
// before, whose turnRun this carries on; null for a game's first board).
function turnRuns(prev, marks, pub) {
  const out = {};
  for (const [p, m] of Object.entries(marks)) {
    const by = m.controlledBy;
    if (by && (prev?.turnRun?.[p] === by || (pub.activePlayerId === p && !(pub.stack || []).length))) out[p] = by;
  }
  return out;
}

// A stack item is an ability (not a spell) when Forge gives it ability text and it isn't a spell: Forge also gives
// instants and sorceries their text, so "White uses Lightning Bolt's ability" was logged for a cast. A spell's card is
// in no zone while it is on the stack; an ability's source still is (battlefield, graveyard, command zone, ...), and a
// triggered ability says when it triggers.
// An activated ability's words, its cost before the colon: mana, a sacrifice, a tap, a loyalty cost, ...
const ACTIVATION_COST = /^(?:\{[^}]+\}|Sacrifice\b|Pay\b|Discard\b|Remove\b|Exile\b|Tap\b|Untap\b|Return\b|[+−-](?:\d+|X)|0)[^.:]*:\s/;
// What an ability does, in a few words, for its trigger or activation line: its first sentence, from Forge's own
// ability text (the stack item's sourceAbilityText, or the action's "<cost>: <effect>." description), less its
// trigger condition ("When ... enters, "), its cost (before the colon), reminder text and Forge's notes; its own card's
// name at the start read "it". "Hero of Bladehold's ability triggers (White)" and "AI 1 uses Merfolk Looter's ability"
// said nothing of what they did (readability audit C2, 2026-11-12). "" when nothing is left.
const GIST_MAX = 90;
function abilityGist(text, name = "") {
  // (the card's name masked, as it can hold a comma or a colon: "Whenever Syr Konrad, the Grim or another creature dies, ...")
  // (one ability's words only: more lines are a card's whole text, which says nothing of which ability this is)
  const mask = "\u0001";
  // (reminder text inside reminder text taken out from the inside; a parenthesis left over is unbalanced text, no gist)
  let t = withoutForgeNotes(String(text || ""));
  for (let was = null; was !== t;) { was = t; t = t.replace(/\s*\([^()]*\)/g, ""); }
  t = t.trim();
  if (/\n|[()]/.test(t)) return "";
  t = t.replace(/\s+/g, " ").replace(/\bCARDNAME\b/g, mask);
  if (name) t = t.split(name).join(mask);
  // (an ability word or a flavor word before it: "Battalion — Whenever ...", "Timey-Wimey — {7}: ...")
  t = t.replace(/^[A-Z][A-Za-z'!-]*(?: [A-Za-z'!-]+){0,3} — (?=When|Whenever|At\b|\{|[+−-]?\d|[A-Z][^.:]*:\s)/, "");
  if (/^(?:When|Whenever|At)\b/.test(t)) {
    const comma = t.indexOf(", ");
    if (comma < 0) return "";
    t = t.slice(comma + 2);
  } else {
    // (the action's words can name its card before its cost: "Sensei's Divining Top: {T}: Draw a card, ...")
    for (let i = 0, cost; i < 3 && (cost = /^[^.:]*:\s/.exec(t)); i++) t = t.slice(cost[0].length);
  }
  // (its first sentence; a modal one up to its choice, "choose one")
  t = t.split(/\.(?:\s|$)| •/)[0].replace(/\s*—\s*$/, "").trim();
  if (/^choose\b/i.test(t)) t = t.replace(/\s*—.*$/, "");
  t = t.replace(new RegExp(`^${mask}(?=[ ']|$)`), "it").split(mask).join(name);
  if (!t) return "";
  t = t[0].toLowerCase() + t.slice(1);
  if (t.length > GIST_MAX) t = `${t.slice(0, GIST_MAX).replace(/\s+\S*$/, "")}...`;
  return t;
}
const gistWords = (text, name) => ((g) => (g ? `: ${g}` : ""))(abilityGist(text, name));
function isAbilityOnStack(s, pub) {
  if (!s.sourceAbilityText || s.isPermanentSpell) return false;
  // (the engine's word first: a token's "Partner with" trigger, the token gone to the legend rule, was in no zone and read
  // "White casts Zndrsplt, Eye of Wisdom", rebuilt re-test. In every feed seen so far isTrigger is true or left out,
  // never false, so its absence proves nothing and a trigger's own words stand in for it; not "As": a spell's text can
  // start "As an additional cost to cast this spell", and Big Score read "(your ability)" and "White uses Big Score's
  // ability" for Jin-Gitaxias's copy, Kykar #25. A trigger whose words start "As" and that comes without isTrigger
  // would be read as a spell; none has been seen.)
  if (s.isTrigger || /^(When|Whenever|At)\b/.test(s.sourceAbilityText)) return true;
  // (Forge's "<Keyword> - <card>" trigger, its source the spell on the stack: Throes of Chaos's "Cascade - Throes of
  // Chaos" read as a second spell, "White casts Throes of Chaos" twice, hp-15)
  if (/^[A-Z][a-z]+(?: \d+)? - .+$/.test(s.sourceAbilityText)) return true;
  // (Paradigm's trigger, its source an effect in no zone: "White casts Improvisation Capstone' Paradigm", hp-23 gap)
  if (/^Paradigm \(/.test(s.sourceAbilityText)) return true;
  // (and a keyword activated from a hand no one else sees: another player's transmute read "AI 1 casts ...", keyword sweep)
  if (keywordKind(s.sourceAbilityText) !== "ability") return true;
  // (a token's, or one with a cost before its colon, its source sacrificed to pay it and so in no zone: no token is cast,
  // and no spell's words start with a cost; AI 1's Clue read "AI 1 casts Clue Token", Kykar #19. A copy of a spell is
  // no token: Twincast's of Big Score has isToken false.)
  if (s.identity?.isToken || ACTIVATION_COST.test(s.sourceAbilityText)) return true;
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
  // (a new spell or ability of the card: its earlier target picks are not this one's, see Seat.respond)
  game.picked?.delete(act.cardId);
  // (a foretell hides the card: "White uses Delayed Blast Fireball's ability" named it to the whole table, hp-06 2026-10-28)
  // (and a suspend is said as one: "White uses Profane Tutor's ability", hp-06 #14; an embalm read "White uses Vizier of Many Faces's ability", hp-16 gap)
  const way = String(act.label || act.description || "");
  const kind = act.type === "cast" ? "cast" : keywordKind(way);
  // (a swap with the hand is seen a board or more later, its record said by then: see handRoom in logEvents)
  if (kind === "ninjutsu" || kind === "aura swap") seat.note("handSwap", act.cardId);
  // (a face-down cast is said unnamed: the log is the whole table's, and Morph's "Cast Grim Haruspex (face down)" read
  // "White casts Grim Haruspex", gap-04)
  const faceDown = kind === "cast" && / \(face down\)$/i.test(way);
  // (and a cast by another way says which: Faithless Looting's flashback read "White casts Faithless Looting" twice, gap-04;
  // Forge's mode names its cost, "flashback", "webSlinging", "more_than_meets_the_eye")
  // (a prototype cast is a normal mode: the harness's label says it, "Cast Autonomous Assembler (Prototype)", keyword sweep;
  // and a cleave cast, "Cast Dig Up (Cleave)": both of Dig Up's casts read "Cast Dig Up", and the table offered one, sweep 2026-11-05)
  const how = kind === "cast" && !faceDown && act.mode?.type === "alternative" && act.mode.cost
    ? String(act.mode.cost).replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
    : kind === "cast" && / \((Prototype|Cleave)\)$/.exec(way)?.[1].toLowerCase() || null;
  // (the card where the player saw it)
  const zone = (seat.board?.state?.gameView?.zones || []).find((z) => (z.cards || []).some((c) => c.id === act.cardId));
  const card = zone?.cards.find((c) => c.id === act.cardId);
  // (the face being cast, by the action's own label: Tibalt, Valki's back, read "White casts Valki, God of Lies", re-test
  // 2026-10-31)
  const face = kind === "cast" && !how ? String(act.label || "").match(/^Cast (.+)$/)?.[1] : null;
  if (face && card?.isDoubleFaced && !name.includes("//")) name = face;
  // (and one half of a split card, the stack's name for it too: "White casts Expansion // Explosion" for Explosion,
  // Kykar #14. Not both halves fused, "Cast both halves (fuse)".)
  else if (face && name.includes("//") && name.split(" // ").includes(face)) name = face;
  // (free by the card's own words, Forge's static alternative cost: Flawless Maneuver with a commander out read "White
  // casts Flawless Maneuver", Kykar #22)
  const free = kind === "cast" && act.mode?.type === "staticAlternative" && /\byou may cast (?:this spell|it) without paying its mana cost\b/i.test(card?.text || "");
  // (and a cast from where it was, by the card's own keyword when Forge's action names none)
  const from = kind === "cast" ? castFrom(zone?.zone, card) : null;
  game.pendingPlays.push({ id: act.cardId, name: faceDown ? "a face-down spell" : how ? `${name} (${how})` : `${name}${from ? ` ${from}` : ""}${free ? " without paying its mana cost" : ""}`, ctl: seat.slot, kind, text: way, at: Date.now(), promptId: promptId ?? 0 });
}
// A mana ability tapped that deals damage to its player, noted for the life line it makes (paintapLoss in logEvents):
// the amount its pay button says (manaPainDamage: the line that adds the mana made and says "deals N damage to you", a
// pain land's coloured {T} or Ancient Tomb's {C}{C}; none for its colourless {T}, none for damage under a condition,
// Tomb of Urami's). Three bare "White: 38 -> 37 life (-1)" lines for Adarkar Wastes, Battlefield Forge and Shivan
// Reef, Kykar #4. (No name: City of Brass's "becomes tapped" damage is a trigger, resolving on a later board.)
function notePain(seat, act, card) {
  if (!game || !(act?.producedMana || []).length) return;
  const n = manaPainDamage(act, card.text, null);
  // (old ones go here too: a game the table doesn't draw logs no board to use them up)
  if (n) game.painTaps = [...(game.painTaps || []).filter((t) => Date.now() - t.at < 10000), { slot: seat.slot, id: card.id, name: card.identity?.name || "a land", n, at: Date.now() }];
}
// Where a cast came from, said after its name: nothing from a hand or the command zone.
// (the top of the library: Augur of Autumn's coven cast of King Macar read "White casts King Macar", hp-14 gap; exile:
// Avatar's Wrath's airbent Skyhunter Strike Force cast for {2} read "White casts Skyhunter Strike Force", hp-18 gap; a
// graveyard by retrace or jump-start, which Forge's action doesn't name: Raven's Crime and Maximize Velocity read "White
// casts ...", keyword sweep 2026-11-03)
function castFrom(zone, card) {
  if (zone === "library") return "from the top of their library";
  if (zone === "exile") return "from exile";
  if (zone !== "graveyard") return null;
  const way = ["Jump-start", "Retrace"].find((k) => hasKeyword(card, k));
  return way ? `(${way.toLowerCase()})` : "from their graveyard";
}
// The extra costs a spell was cast with (the harness's stack optionalCosts, Forge's OptionalCost names), as words after
// its name: "(kicked)". Any other name says nothing: retrace and jump-start are said by castFrom, buyback by the spell's
// return to its hand. (Llanowar Elite kicked and Dream's Grip entwined read "Red casts ...", keyword sweep 2026-11-03)
// (Prototype: the harness adds it for a prototype cast, so an AI's reads "AI 1 casts X (prototype)" as ours does, keyword sweep gap)
const OPTIONAL_COST_WORDS = { Kicker1: "kicked", Kicker2: "kicked", Entwine: "entwined", Bargain: "bargained", PromiseGift: "gift promised", Prototype: "prototype", Cleave: "cleave" };
// (a word the cast's own name already says is left out: our prototype cast is named "X (prototype)" by notePlay)
function optionalWords(opt, name = "") {
  const words = (opt || []).map((k) => OPTIONAL_COST_WORDS[k]).filter((w) => w && !name.endsWith(` (${w})`));
  const said = [...new Set(words)].map((w) => (w === "kicked" && words.filter((x) => x === w).length > 1 ? "kicked twice" : w));
  return said.length ? ` (${said.join(", ")})` : "";
}

// The keyword an activated ability is used by, from the action's words or its stack item's text, the same form
// ("Unearth {U} (...)", "Wizardcycling {3} (...)"): "ability" for none. The stack's text words another player's
// activation, which has no action of ours (an AI's unearth read "AI 1 uses Combat Courier's ability", keyword sweep).
// Each activated keyword's line (w: who, n: the card), the one list keywordKind reads them by: a keyword in one list
// and not another read "uses X's ability" (keyword sweep). Cycling, landcycling's too, is read by its own pattern.
// (ninjutsu, fortify and aura swap: Yuriko's, C.A.M.P.'s and Arcanum Wings's read "White uses ...'s ability", hp-24 gap;
// encore and transmute: Impulsive Pilferer's and Dizzy Spell's the same, keyword sweep 2026-11-03; reinforce: Mosquito
// Guard's, its target another creature, so "with")
const keywordVerb = (k) => (w, n) => `${w} ${k}${/sh$/.test(k) ? "es" : "s"} ${n}`;
const KEYWORD_WORDS = {
  foretell: (w) => `${w} foretells a card`, "level up": (w, n) => `${w} levels up ${n}`, fortify: (w, n) => `${w} fortifies with ${n}`,
  "aura swap": (w, n) => `${w} swaps ${n} (aura swap)`, cycle: keywordVerb("cycle"), reinforce: (w, n) => `${w} reinforces with ${n}`,
  ...Object.fromEntries(["suspend", "unearth", "crew", "saddle", "embalm", "eternalize", "encore", "renew", "scavenge", "transmute", "bloodrush", "forecast", "ninjutsu"].map((k) => [k, keywordVerb(k)])),
};
const KEYWORD_USED = new RegExp(`^(?:[^:]*: )?(?:Commander )?(${Object.keys(KEYWORD_WORDS).join("|")})\\b`, "i");
function keywordKind(way) {
  return KEYWORD_USED.exec(way)?.[1].toLowerCase()
    // (cycling, landcycling too: Eagles of the North's plainscycling read "White uses Eagles of the North's ability", hp-18 gap)
    || (/^(?:[^:]*: )?(?:[A-Z][a-z]*)?cycling\b/i.test(way) ? "cycle" : null)
    // (turning a card face up is no ability: "is turned face up" says it; Gudul Lurker's megamorph also read "White uses
    // Gudul Lurker's ability", hp-10)
    || (/^(?:[^:]*: )?(?:Megamorph|Morph|Disguise)\b/i.test(way) ? "faceup" : "ability");
}

// A player's keyword activation said by its keyword, the same whether its stack item was seen or not (Joraga
// Treespeaker's level up read "White uses Joraga Treespeaker's ability"; a crew seen on the stack read the same, hp-11)
function keywordLine(kind, ctl, name) {
  return KEYWORD_WORDS[kind]?.(nameOf(ctl), name) ?? null;
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
  // (firstDraw / firstDiscard: each player's first of each by Forge's order, so a discard before its draw is said first;
  // Fable's chapter II read "draws 2 cards" then "discards ...", rebuilt re-test)
  // (offStack: the cards that left the stack, in Forge's order, each with where to and its owner, for what took a spell
  // off it, see logEvents)
  // (firstSeq: each moved card's first move by Forge's order, so what was moved to pay a cost before a draw is said
  // before it, see logEvents)
  const facts = { moves: new Map(), firstSeq: new Map(), draws: {}, tutors: {}, mills: {}, explored: {}, firstDraw: {}, firstDiscard: {}, causes: new Map(), drawsBy: new Map(), drawCause: {}, offStack: [] };
  for (const e of events) {
    if (e.seq <= seen) continue;
    if (e.from === "Stack" && e.cardId) facts.offStack.push({ id: e.cardId, to: e.to, owner: e.ownerId });
    // (an engine that names causes: a move without one means something only then, buyback's return, see logEvents)
    if (e.cause) game.feedCauses = true;
    if (e.from === "Library") {
      const tally = e.to === "Hand" ? (e.how === "draw" ? facts.draws : facts.tutors)
        : e.to === "Exile" || (e.to === "Graveyard" && e.how !== "surveil") ? facts.mills : null;
      if (tally) tally[e.ownerId] = (tally[e.ownerId] || 0) + 1;
      if (tally === facts.tutors && e.cause === "Explore") facts.explored[e.ownerId] = e.causeName;
      if (tally === facts.draws) {
        facts.firstDraw[e.ownerId] ??= e.seq;
        // (the one card all of a player's draws came from, else null: see updateLog's draw join)
        const by = e.causeCardId || null;
        facts.drawCause[e.ownerId] = e.ownerId in facts.drawCause && facts.drawCause[e.ownerId] !== by ? null : by;
      }
    }
    if (e.how === "discard") facts.firstDiscard[e.ownerId] ??= e.seq;
    // (what an ability did, by the card whose ability it was: one that went on the stack and resolved between two boards
    // was never named, re-test 2 bug g. An effect's word only: not a cost's, a replacement's, or a card moving itself.)
    if (e.causeCardId && e.causeCardId !== e.cardId && /^[A-Z][A-Za-z]+$/.test(e.cause || "")) facts.causes.set(e.causeCardId, e.causeName);
    // (and how many cards each one drew: of two Mentor of the Meek triggers, which were paid for, see unlessNews)
    if (e.causeCardId && e.how === "draw") facts.drawsBy.set(e.causeCardId, (facts.drawsBy.get(e.causeCardId) || 0) + 1);
    if (!e.cardId) continue;
    const was = facts.moves.get(e.cardId);
    const cause = was?.cause ? { cause: was.cause, causeName: was.causeName } : e.cause ? { cause: e.cause, causeName: e.causeName } : {};
    // (through: the zone it passed on the way, a commander countered and recast before the next board went Stack, Command,
    // Stack, which read as never having left; Arcane Denial on Niv-Mizzet, recast at once, rebuilt re-test 2)
    // (owner: Forge's card's own, which the battlefield's view doesn't give, see noteOwners)
    facts.moves.set(e.cardId, { from: was ? was.from : e.from, to: e.to, how: e.how || was?.how, ...(was ? { through: was.to } : {}), ...cause,
      ...((was?.owner || e.ownerId) ? { owner: was?.owner || e.ownerId } : {}) });
    if (!facts.firstSeq.has(e.cardId)) facts.firstSeq.set(e.cardId, e.seq);
  }
  return facts;
}
// What took a card out of its library into a graveyard, from Forge's word on the move (EngineEventLog's how and
// cause): every mechanic that moves cards there is one of these kinds, and its name is only the label the line carries
// (dredge mills, an explore or a surveil puts, PLAN "every mechanic through the core moves"). A move Forge says nothing
// of, from an older engine or no feed, is a mill, as the boards always read it.
function libraryKind(m) {
  const dredge = /^(.+) - Dredge (\d+)$/.exec(m?.cause || "");
  if (dredge) return { kind: "dredge", card: dredge[1], n: dredge[2] };
  if (m?.how === "surveil" || m?.cause === "Surveil") return { kind: "surveil" };
  if (m?.how === "mill" || !m?.cause || m.cause === "Mill") return { kind: "mill" };
  return m.cause === "Explore" ? { kind: "explore", card: m.causeName } : { kind: "put" };
}
// A move made to pay a cost (the harness's cause "Cost:<keyword, alternative cost or cost part>": cycling's discard,
// delve's exile, a sacrifice for Fling), as words after the move's own line: the cost's keyword and the card it paid
// for. Empty for any other move, and for a card that paid for itself with no keyword (a Treasure's sacrifice).
const COST_KEYWORDS = { Cycling: "cycling", TypeCycling: "cycling", Delve: "delve", Escape: "escape", Emerge: "emerge", Embalm: "embalm", Eternalize: "eternalize", Encore: "encore", Scavenge: "scavenge", Transmute: "transmute", Reinforce: "reinforce", Evoke: "evoke" };
function costWords(m, name) {
  const k = /^Cost:(\w+)$/.exec(m?.cause || "")?.[1];
  if (!k) return "";
  const forCard = m.causeName && m.causeName !== name ? ` for ${m.causeName}` : "";
  // (another card sacrificed to a mana ability paid for mana, not for the card: "Spirit token is sacrificed (to pay for
  // Kykar, Wind's Fury)" read as paying for casting Kykar, Kykar hand test #2)
  if (k === "Sacrifice" && forCard && sacrificesForMana(m.causeName)) return ` for mana (${m.causeName})`;
  return COST_KEYWORDS[k] ? ` (${COST_KEYWORDS[k]}${forCard})` : forCard ? ` (to pay${forCard})` : "";
}
// A card on the battlefield (either board logEvents is telling, logBoards) whose only abilities with a sacrifice in their
// cost make mana: Kykar's "Sacrifice a Spirit: Add {R}.", Ashnod's Altar, Phyrexian Altar. Not Goblin Bombardment, nor a
// card with a sacrifice cost of another kind too (then the sacrifice may have paid for either). (tx: only a battlefield
// card has its text in a log snapshot, logSnapshot; both boards, as the card may be on only the one after)
// (logBoards is set at the top of logEvents and read only from inside it, through costWords and sacrificeWords: a
// caller outside logEvents would read the last logged boards)
let logBoards = [];
function sacrificesForMana(name) {
  const c = logBoards.flatMap((b) => Object.values(b?.cards || {})).find((x) => x.name === name && x.tx);
  const costs = String(c?.tx || "").split(/\n/).map((l) => /^([^:"]*\bSacrifice\b[^:"]*):\s*(.*)$/i.exec(l)).filter(Boolean);
  return costs.length > 0 && costs.every((x) => /^Add\b/.test(x[2]));
}
// A sacrifice's words after its line: its cost's, or "for mana" for a card that pays its own mana ability with itself
// (seven Treasures for one spell read "Treasure Token is sacrificed" seven times, no reason, rebuilt hand test #3)
// (and the effect that made its player sacrifice it, Forge's resolving "Sacrifice": Diabolic Edict's Hill Giant read
// only "is sacrificed", ability sweep)
function sacrificeWords(m, was) {
  return costWords(m, was.name) || (was.selfMana && (!m?.cause || (m.cause === "Cost:Sacrifice" && m.causeName === was.name)) ? " for mana" : "")
    || (m?.cause === "Sacrifice" && m.causeName && m.causeName !== was.name ? ` (${m.causeName})` : "");
}
// (many cards by count: Cut Your Losses's 46 read as one name after another, hp-16)
const byCount = (names) => [...names.reduce((m, n) => m.set(n, (m.get(n) || 0) + 1), new Map())].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(", ");
const listOf = (names) => (names.length > 6 ? byCount(names) : names.join(", "));
// (the same, keeping the order: only a run of one card next to itself counted, for cards whose order is told)
const byRuns = (names) => names.reduce((runs, n) => (runs.at(-1)?.[0] === n ? runs.at(-1)[1]++ : runs.push([n, 1]), runs), []).map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(", ");
const listInOrder = (names) => (names.length > 6 ? byRuns(names) : names.join(", "));
// each kind's line, for the cards one player had moved that way at once (w: who, k: the kind and what it names)
const LIBRARY_WORDS = {
  mill: (w, names) => `${w} mills ${names.length > 6 ? `${names.length} cards: ${listOf(names)}` : listOf(names)}`,
  dredge: (w, names, k) => `${w} dredges ${k.card} instead of drawing (dredge ${k.n}), milling ${listOf(names)}`,
  surveil: (w, names) => `${w} surveils, putting ${listOf(names)} into their graveyard`,
  explore: (w, names, k) => `${k.card || "A creature"} explores: ${w} puts ${listOf(names)} into their graveyard`,
  put: (w, names) => `${w} puts ${listOf(names)} into their graveyard from their library`,
};
// What put a card into exile (exileKind in logEvents decides it, once), each kind's line. The kinds in EXILE_GROUPED
// take every card exiled that way at once, in one line where the first was: Uro's escape cost read five "is exiled"
// (hp-09), Avatar's Wrath nine (hp-18), Benthic Infiltrator's ingest one per card (hp-21).
const EXILE_WORDS = {
  graveyard: (w, names, k) => `${names.join(", ")} ${names.length === 1 ? "is" : "are"} exiled from ${w}'s graveyard${k.label}`,
  battlefield: (w, names, k) => `${names.length === 1 ? `${names[0]} is` : `${byCount(names)} are`} exiled${k.label || ""}`,
  library: (w, names, k) => `${byCount(names)} ${names.length === 1 ? "is" : "are"} exiled from ${w}'s library${k.label || ""}`,
  haunt: (w, names, k) => `${names[0]} is exiled haunting ${k.card}`,
  suspended: (w, names, k) => `${names[0]} is exiled suspended with ${k.n} time counter${k.n === 1 ? "" : "s"}: ${w} may cast it without paying its mana cost when the last is removed`,
  adventure: (w, names, k) => `${names[0]} goes on an adventure (${k.card})`,
  rebound: (w, names) => `${names[0]} is exiled with rebound: ${w} may cast it at their next upkeep`,
  plotted: (w, names) => `${names[0]} is exiled and plotted: ${w} may cast it without paying its mana cost on a later turn, as a sorcery`,
  paradigm: (w, names) => `${names[0]} is exiled (paradigm): at the start of each of their first main phases, ${w} may cast a copy of it without paying its mana cost`,
  hand: (w, names, k) => `${w} exiles ${names[0]} from their hand ${k.cast ? "to cast" : "to pay for"} ${k.card}${k.kw ? ` (${k.kw})` : ""}`,
  // (a prepared creature's spell copy, made in exile: not a card exiled; Grave Researcher's read "Reanimate is exiled",
  // HAND-TEST-HP06 #20)
  prepared: (w, names, k) => `${k.card} becomes prepared (${names[0]})`,
  plain: (w, names, k) => `${names[0]} is exiled${k.label || ""}`,
};
const EXILE_GROUPED = new Set(["graveyard", "battlefield", "library"]);
// a detain's words, one target or "up to two" (Lyev Skyknight's, Azorius Justiciar's): see logEvents and onPrompt
const DETAIN_TARGET = /\bdetains? (?:up to (?:one|two|three|four|\d+) )?target\b/i;
// What a player's library gave their hand (drawn, or put there by a search or an explore's reveal) and what their
// hand gave their graveyard (discarded), each kind's line: n, how many; names, the cards; k, what the line names
const HAND_WORDS = {
  draw: (w, n) => `${w} draws ${countWords(n, n, "card")}`,
  put: (w, n, k) => `${w} puts ${countWords(n, n, "card")} from their library into their hand${k.explore != null ? ` (${k.explore} explores)` : ""}`,
  putNamed: (w, names) => `${w} puts ${names.join(", ")} into their hand`,
  discard: (w, names) => `${w} discards ${names.join(", ")}`,
};
// What a text-changing spell changed, ": old → new": Forge's own "Elf (was Goblin)" note when it writes one, else the
// words gone and the words new (a few each; more, and only that it changed is said). Word by word read "Goblins →
// strike" for Artificial Evolution and "This → protection" for Sleight of Mind, mechanic run hp-25 re-test 2026-11-05.
// (Forge's own text: "<strike>Goblin</strike> Elf", the note as the table shows it; reminder text left out, as Forge
// leaves it out of a changed text, "First strike, protection from red" for White Knight, mechanic run hp-25 re-test 2)
function textChangeWords(was, now) {
  [was, now] = [was, now].map((t) => withoutForgeNotes(String(t || "")));
  const noted = /\b([\w'-]+) \(was ([\w'-]+)\)/.exec(now);
  if (noted) return `: ${noted[2]} → ${noted[1]}`;
  [was, now] = [was, now].map((t) => t.replace(/\s*\([^)]*\)/g, ""));
  // (words of three letters or more: "a Swamp" becoming "an Island" is no change of "a"; and the shortest of a family,
  // "Swampwalk" and "Swamp" read "Swamp")
  const words = (t) => [...new Set(t.toLowerCase().split(/[^\w'-]+/).filter((w) => w.length > 2))];
  const a = words(was), b = words(now);
  const roots = (ws) => ws.filter((w) => !ws.some((o) => o !== w && w.startsWith(o)));
  const gone = roots(a.filter((w) => !b.includes(w))), added = roots(b.filter((w) => !a.includes(w)));
  if (!gone.length || !added.length || gone.length > 3 || added.length > 3) return "";
  const asIn = (t, w) => t.split(/[^\w'-]+/).find((x) => x.toLowerCase() === w);
  return `: ${gone.map((w) => asIn(was, w)).join(", ")} → ${added.map((w) => asIn(now, w)).join(", ")}`;
}
// What moved a card, by Forge's word on the move (EngineEventLog markCause): the card of the spell or ability resolving
// as it moved, when the move's cause is an effect's API name ("Destroy", "ChangeZone", "Discard", ...) and that card is
// another one. Null for a state-based move (a creature dead of its damage, a legend-rule loser: Forge names no cause
// outside a resolution), a cost's ("Cost:..."), a replacement's (Dredge's "<card> - Dredge N"), a mill, explore or
// surveil (their own lines name them), a card moving itself (persist, evoke's sacrifice) and an engine that names no
// causes. "Batterskull is destroyed" after "White casts Krosan Grip" named nothing, and Reanimate's, Cyclonic Rift's
// and Duress's lines the same (readability audit C1, 2026-11-12). names: the card's own names (Forge's, a copy's printed one).
function causeBy(m, ...names) {
  if (!m?.causeName || !/^[A-Z][A-Za-z]+$/.test(m.cause || "") || ["Mill", "Explore", "Surveil"].includes(m.cause)) return null;
  return names.includes(m.causeName) ? null : m.causeName;
}
const causeWords = (k) => (k?.by ? ` (${k.by})` : "");
// How a card left the battlefield, a graveyard or exile for a zone that isn't exile (departureKind in logEvents, and
// its battlefield-to-graveyard line, decide the kind), each kind's line: w is its owner. "tokens" takes every token
// gone at once in one line (Avatar's Wrath's eight read one "leaves the battlefield" each, hp-18 gap). k.by: what moved
// it, causeBy.
const LEAVE_WORDS = {
  sacrificed: (w, names, k) => `${names.length === 1 ? `${names[0]} is` : `${byCount(names)} are`} sacrificed${k.label || ""}`,
  dies: (w, names, k) => `${names[0]} dies${causeWords(k)}`,
  destroyed: (w, names, k) => `${names[0]} is destroyed${k?.by ? ` by ${k.by}` : ""}`,
  graveyard: (w, names, k) => `${names[0]} goes to the graveyard${causeWords(k)}`,
  exiled: (w, names, k) => `${names[0]} is exiled${k?.by ? ` by ${k.by}` : ""}`,
  libraryTop: (w, names, k) => `${names[0]} is put on top of ${w}'s library${causeWords(k)}`,
  library: (w, names, k) => `${names[0]} is put into ${w}'s library${causeWords(k)}`,
  hand: (w, names, k) => `${names[0]} returns to ${w}'s hand${causeWords(k)}`,
  tokenHand: (w, names, k) => `${names[0]} returns to ${w}'s hand${causeWords(k)} and ceases to exist`,
  handFrom: (w, names, k) => `${names[0]} is put into ${w}'s hand from ${k.from}${causeWords(k)}`,
  tokens: (w, names) => (names.length === 1 ? `${names[0]} leaves the battlefield` : `${byCount(names)} leave the battlefield`),
  left: (w, names) => `${names[0]} leaves the battlefield`,
};
// An extra turn: Forge says so on the new active player (isExtraTurn, set at each turn start), read once by the
// extraTurn row of PLAYER_MARKS, which also draws the EXTRA TURN label. Only Forge's flag: the guess from turn order
// called Time Warp on another player's turn 6 plain and turn 7 extra (review 2026-11-05), and a board without the
// flag is a plain turn (the harness always sends it; trackMarks step 7).
function extraTurn(cur) {
  return cur.marks?.[cur.active]?.extraTurn === true;
}
// The spells a spell no board showed on the stack took off it, cast and resolved between two boards: the AI's answer.
// Forge moves a spell's targets as it resolves and the spell itself after them, so the spells that left the stack just
// before a counterspell, or a "return target spell", were its targets; one that resolved left after the spells above
// it, and a counterspell itself countered did nothing. Craw Wurm under the AI's Counterspell read only "AI 1 casts
// Counterspell", keyword sweep kw-14. offStack: engineFacts's, Forge's order; prevSpellOf: the last board's stack
// spells by card id; cards: logSnapshot's. -> card id -> { how: "counter" or "return", by: the card that took it }
function takenOffStack(offStack, prevSpellOf, cards, pubIndex) {
  const taken = new Map();
  for (let i = offStack.length - 1; i >= 0; i--) {
    const { id: r, to, owner } = offStack[i], text = pubIndex[r]?.text || "";
    // (one seen on the stack has its targets; one itself taken off did nothing)
    if (prevSpellOf.has(r) || taken.has(r)) continue;
    // (an instant or sorcery that resolved, or was itself countered: a permanent's "counter target spell" is an ability
    // of what it became, which resolved by the battlefield, Voidmage Prodigy's, Mystic Snake's, Venser's "return target
    // spell"; and one with "unless" may have been paid, Mana Leak, as isCounterspell. Each read "<the spell before> is
    // countered", suite review 2026-11-06)
    if (!cards[r]?.spell || (to !== "Graveyard" && to !== "Exile") || /\bunless\b/i.test(text)) continue;
    const how = /\bcounter (?:target|up to \w+ target|any number of target)\b[^.]*\bspells?\b/i.test(text) ? "counter" : /\breturn target spell\b/i.test(text) ? "return" : null;
    if (!how) continue;
    const n = /\bany number of target\b/i.test(text) ? i : { two: 2, three: 3, four: 4 }[/\bup to (two|three|four) target\b/i.exec(text)?.[1].toLowerCase()] || 1;
    // (a target it could have had, else it had none of these, and the spells before it left on their own: one that
    // resolved onto the battlefield; for "return", one not in a hand (no line reads that today: a return is read only
    // from a hand); an AI's own, as Forge's AI counters or sends back no spell of its team's by choice (CounterAi;
    // ChangeZoneAi's doExileSpellLogic takes an opponent's); and for a counter of abilities too, Disallow, Tale's End,
    // one no board showed, as it may have countered a trigger after that spell resolved. The AI's Negate over its
    // Counterspell, on one Divination, read "Negate is countered"; Disallow after the AI's own Bolt, "Lightning Bolt is
    // countered", suite review 2026-11-06)
    const ctl = cards[r].ctl || owner, ai = !seatOfSlot(ctl), abilities = /\bcounter target\b[^.]*\babilit(?:y|ies)\b/i.test(text);
    for (let j = i - 1; j >= i - n && j >= 0; j--) {
      const t = offStack[j], seen = prevSpellOf.get(t.id);
      if (t.to === "Battlefield" || (how === "return" && t.to !== "Hand") || (ai && (seen?.ctl ?? t.owner) === ctl) || (abilities && !seen)) break;
      taken.set(t.id, { how, by: r });
    }
  }
  return taken;
}

// What dealt damage between two boards, and to what (Forge sends no damage event: GameViewDto.events moves cards only),
// said only where the boards make it certain; anything less leaves the life line bare and the creature unnamed (a
// wrong source is worse than none: Shock beside a shock land, divided damage, two sources at one creature, checker
// 2026-11-07). The evidence:
// - combat: an unblocked attacker still on the battlefield, at the player Forge says it attacks (attackTargetId; one at
//   a planeswalker hits no player), its power once for each combat damage step crossed (double strike in both), and
//   lifelink's gain beside it;
// - a damage spell or ability that left the stack and says "<its name> deals N damage" once, no "divided": N at each
//   target, Forge's or the player's picks (no target known, nothing: no guessing by who lost that much), and at "each
//   opponent / each player" once for each item that left ("each creature" only by those plain words); a creature's
//   marked damage told only when it adds up: one item at it, its rise exactly its amount; or items of fixed amounts
//   summing to it; a target gone to its graveyard only with one item
//   at it, by Forge's order after the spell and no other cause. No combat damage step crossed for any creature's line.
// A loss nothing explains stays bare: a pain land of another player's, a trigger that came and went between two boards,
// an AI's Lightning Bolt (Forge names no spell's target). Niv-Mizzet's pings read only "ability triggers" and "dies",
// Kykar #11; Kykar's double-strike lifelink attack four bare life lines, #26; Pyroclasm's survivor nothing, ability sweep.
// A source chosen for a prevention or a redirect (sourceShields, the player's answer) says what became of its damage,
// once the boards show it happened: Reflect Damage's redirect read only "AI 1: 404 -> 401 life (-3)", Kykar #6; Circle of
// Protection: Red's prevention nothing at all. otherParts(p): a part of p's life change known outside these lines (a
// pain land, life paid). -> { lines (said before what came of them), loss / gain: player -> [{ n, w: the words }] }
function damageNews(prev, cur, resolved, facts, otherParts = () => false) {
  const lines = [], loss = {}, gain = {};
  const why = (t, p, n, w) => { if (n > 0 && p) (t[p] ||= []).push({ n, w }); };
  const lost = (p) => (prev.life[p] ?? 0) - (cur.life[p] ?? 0);
  // (a shield of this turn for that source, and for that player when it prevents; used up once said)
  const shieldFor = (id, p) => (game.sourceShields || []).find((x) => x.id === id && x.turn === cur.turn && (x.kind === "redirect" || x.slot === p)) || null;
  const used = (sh) => { game.sourceShields = game.sourceShields.filter((x) => x !== sh); };
  // (a damage item's redirect or prevention, said on the board it shows on; combat damage goes through owe below, as
  // its loss can come a board later)
  const redirected = (sh, src, name, n) => {
    lines.push(`${poss(name)} damage is dealt to ${nameOf(src.ctl)} instead (${sh.by})`);
    why(loss, src.ctl, n, `damage from ${name}, redirected by ${sh.by}`);
    used(sh);
  };
  const prevented = (sh, src, name, p, n) => {
    lines.push(`${poss(name)} damage to ${nameOf(p)} is prevented (${sh.by})`);
    // (Deflecting Palm's "deals that much damage to that source's controller")
    if (sh.back && lost(src.ctl) >= n) { lines.push(`${sh.by} deals ${n} damage to ${nameOf(src.ctl)}`); why(loss, src.ctl, n, `damage from ${sh.by}`); }
    used(sh);
  };
  // (Forge's step names in turn order, SKIP_ORDER; its "end" is never sent)
  const at = (s) => SKIP_ORDER.indexOf(s);
  const crossed = (s) => cur.turn === prev.turn && at(prev.step) >= 0 && at(prev.step) < at(s) && at(s) <= at(cur.step);
  const firstStep = crossed("combatFirstStrikeDamage"), regular = crossed("combatDamage");
  // What a shield sends back at a source's controller in combat (Reflect Damage's redirect, Deflecting Palm's damage
  // back): said once that player lost all of it. A question in the middle of the damage (which shield applies first)
  // splits it over two boards of one step, the first with none of it lost yet: kept for the next board of that step, and
  // said there only once that question was answered in that step (game.orderAnswer), the loss exactly what is owed and
  // no other part of it known (a damage item, a pain land, life paid: otherParts). AI 1's -5 from Reflect Damage and
  // Deflecting Palm read bare, Kykar re-test bug #6; a Reflect Damage that never applied named Blue's Lightning Bolt at
  // AI 1 later in the step, verify 2026-11-09. A redirect's shield is used up once said, or once that player lost life
  // it can't be told from; kept while nothing was lost, as it may not have applied (another shield went first).
  // And only when the shield the answer put first is known (orderAnswer.first) and is its own, or a source chosen this
  // turn for another source: Circle of Protection: Red put first on Hill Giant leaves Reflect Damage unapplied, and an
  // unexplained -3 of AI 1's read "dealt to AI 1 instead", verify round 2.
  // (A first strike's split, the next board already the regular damage, stays bare.)
  const owedBy = (list) => { const m = new Map(); for (const o of list) m.set(o.p, [...(m.get(o.p) || []), o]); return m; };
  const owedSum = (list) => list.reduce((a, o) => a + o.n, 0);
  const late = game.owedCombat;
  game.owedCombat = null;
  const lateSaid = [];
  if (late) {
    const sameStep = late.turn === cur.turn && prev.step === late.step && cur.step === late.step;
    const asked = game.orderAnswer?.turn === late.turn && game.orderAnswer?.step === late.step;
    const first = game.orderAnswer?.first, chosen = (game.chosenSources || []).filter((x) => x.turn === late.turn);
    // (an unknown first, null, is neither: every shield and chosen source has its card's name)
    const firstOk = (o) => first === o.by || chosen.some((x) => x.by === first) && !chosen.some((x) => x.by === first && (x.ids || []).includes(o.src));
    const keep = [];
    for (const [p, list] of owedBy(late.list)) {
      if (sameStep && asked && list.every(firstOk) && lost(p) === owedSum(list)) lateSaid.push([p, list]);
      else if (sameStep && lost(p) === 0) keep.push(...list);
      else if (lost(p) !== 0) for (const o of list) if (o.sh) used(o.sh);
    }
    if (keep.length) game.owedCombat = { ...late, list: keep };
  }
  if (firstStep || regular) {
    const owed = [];
    // (by: the shield's card, src: the attacker, for orderAnswer.first above; sh: a redirect's shield, used once said)
    const owe = (p, n, line, w, by, src, sh = null) => owed.push({ p, n, line, w, by, src, sh });
    // (an attacker is unblocked only when the blocks are known: a board from the declare blockers step on, or the blocks a
    // player declared this turn; a board before them and one past combat showed a blocked Hill Giant as unblocked, its
    // damage "prevented" by a Circle that was never used, review 2026-11-09)
    const blocksKnown = at(prev.step) >= at("combatDeclareBlockers");
    const blocked = new Set([...Object.values(prev.blocks || {}), ...Object.values(cur.blocks || {})].flat()
      .concat(game.declaredBlocks?.turn === cur.turn ? [...game.declaredBlocks.ids] : []));
    // (each attacker that dealt combat damage: still there, an attacker killed first dealt none)
    const hitters = Object.entries(prev.cards).filter(([id, a]) => a.zone === "battlefield" && a.attacking && a.pw && cur.cards[id]?.zone === "battlefield")
      .map(([id, a]) => ({ id, a, n: a.pw * ((firstStep && (a.fs || a.ds) ? 1 : 0) + (regular && (!a.fs || a.ds) ? 1 : 0)), name: tokenWords(a.name, a.token) })).filter((x) => x.n > 0);
    // (what the unblocked ones would deal each player, for a prevention: the player lost less than that; read only below,
    // with the blocks known)
    const aimed = {};
    for (const x of hitters) if (!blocked.has(x.id) && x.a.atp in cur.life) aimed[x.a.atp] = (aimed[x.a.atp] || 0) + x.n;
    for (const { id, a, n, name } of hitters) {
      let stopped = false;
      if (blocksKnown && !blocked.has(id) && a.atp in cur.life) {
        const sh = shieldFor(id, a.atp);
        // (a redirect, or a prevention, only when the player it was aimed at lost no more than the others aimed there: Hill
        // Giant's 3 that Blue lost read "dealt to AI 1 instead" beside AI 1's 3 paid elsewhere, checker round 3)
        if (sh?.kind === "redirect" && lost(a.atp) <= aimed[a.atp] - n) {
          owe(a.ctl, n, `${poss(name)} combat damage is dealt to ${nameOf(a.ctl)} instead (${sh.by})`, `damage from ${name}, redirected by ${sh.by}`, sh.by, id, sh);
        } else if (sh?.kind === "prevent" && lost(a.atp) <= aimed[a.atp] - n) {
          lines.push(`${poss(name)} combat damage to ${nameOf(a.atp)} is prevented (${sh.by})`);
          // (Deflecting Palm's "deals that much damage to that source's controller": the attacker's power on the board
          // before, so only while both boards agree on it, a Giant Growth between them is unseen)
          if (sh.back && cur.cards[id]?.pw === prev.cards[id]?.pw) owe(a.ctl, n, `${sh.by} deals ${n} damage to ${nameOf(a.ctl)}`, `damage from ${sh.by}`, sh.by, id);
          used(sh);
          stopped = true;
        } else if (!sh) why(loss, a.atp, n, `combat damage from ${name}`);
      }
      if (a.ll && !stopped) why(gain, a.ctl, n, `lifelink from ${name}`);
    }
    // (said when that player lost at least all of it; kept when they lost nothing yet, see owedCombat above)
    for (const [p, list] of owedBy(owed)) {
      if (lost(p) >= owedSum(list)) for (const o of list) { lines.push(o.line); why(loss, p, o.n, o.w); if (o.sh) used(o.sh); }
      else if (lost(p) === 0) game.owedCombat = { turn: cur.turn, step: cur.step, list: [...(game.owedCombat?.list || []), ...list] };
      else for (const o of list) if (o.sh) used(o.sh);
    }
  }
  // (the damage items: what deals damage by its own name, "Target creature you control deals damage equal to its power"
  // is the creature's, Rabid Bite's, and named by no one; its amount, Forge's words with the numbers filled in, an X by
  // Forge's "(X=3)", else the card's; certain only once and undivided: Electrolyze's 2 "divided as you choose", Arc
  // Trail's "2 damage to any target and 1 damage to another target")
  const items = resolved.flatMap((s) => {
    if (!new RegExp(`(?:^|[\\s(,.;:—-])(?:${escapeRe(s.name)}|this (?:creature|spell|permanent|artifact|enchantment|land|planeswalker)) deals (?:\\d+|X) damage\\b`, "i").test(s.text)) return [];
    const n0 = /\bdeals? (\d+) damage\b/i.exec(s.desc)?.[1] ?? (/\bdeals? X damage\b/i.test(s.text) ? /\(X=(\d+)\)/.exec(s.desc)?.[1] : null) ?? /\bdeals? (\d+) damage\b/i.exec(s.text)?.[1];
    const fixed = !/\bdivided\b/i.test(s.text) && (s.text.match(/\b(?:\d+|X) damage\b/gi) || []).length === 1;
    const n = fixed && n0 != null && Number(n0) > 0 ? Number(n0) : null;
    // (its card targets with each item's own, so two pings at one creature are two; the player's picks, one item's)
    const picks = pickedIds(s.pk, "card");
    const cardTg = [...s.cardTg, ...[...new Set(picks)].filter((x) => !s.cardTg.includes(x))];
    // (a player once for each item that targeted them: two of Niv-Mizzet's pings in one stack entry)
    const plTg = [...s.plTg, ...[...new Set(pickedIds(s.pk, "player"))].filter((p) => !s.plTg.includes(p))];
    // (every creature only by the plain words, nothing after "creature" that limits it: "each creature that isn't a
    // Pirate", "without flying", "you don't control", "each other creature" and "each opponent" are not every creature,
    // checker round 3)
    const each = /\bdamage to each creature(?: and each (?:player|planeswalker))? *(?:[.;]|$)/im.test(s.text);
    return [{ s, n, cardTg, plTg, each, src: { ctl: s.ctl, ...(cur.cards[s.id] || prev.cards[s.id]), id: s.id }, dealt: 0, hit: new Map() }];
  });
  // (each creature's items: how many of each item's hits it took)
  const onCreature = new Map();
  for (const it of items) {
    const ids = [...it.cardTg, ...(it.each ? Object.keys(prev.cards).flatMap((id) => Array(it.s.gone || 1).fill(id)) : [])];
    for (const id of ids) {
      if (prev.cards[id]?.zone !== "battlefield" || !prev.cards[id].creature) continue;
      const list = onCreature.get(id) || [];
      const e = list.find((x) => x.it === it);
      if (e) e.k++; else list.push({ it, k: 1 });
      onCreature.set(id, list);
    }
  }
  const say = (it, d, id) => { if (!it.hit.has(d)) it.hit.set(d, []); it.hit.get(d).push(id); it.dealt += d; };
  if (!firstStep && !regular) for (const [id, list] of onCreature) {
    const now = cur.cards[id];
    const one = list.length === 1 && list[0].k === 1 ? list[0].it : null;
    if (now?.zone === "battlefield") {
      const r = (now.dmg || 0) - (prev.cards[id].dmg || 0);
      if (r <= 0) continue;
      // (one item: only its own known amount, the rise exactly that; a rise of more had another source beside it, one no
      // item names, Rabid Bite's beside a Pyroclasm read "Pyroclasm deals 5 damage", checker round 3)
      if (one) { if (one.n && r === one.n) say(one, r, id); }
      else if (list.every((x) => x.it.n) && list.reduce((a, x) => a + x.k * x.it.n, 0) === r) for (const x of list) for (let i = 0; i < x.k; i++) say(x.it, x.it.n, id);
      continue;
    }
    // (one gone: of the damage, to a graveyard, not sacrificed nor by another card's effect, and by Forge's order after
    // the spell left the stack, as state-based actions follow its resolution; a Bolt whose Bears were murdered first
    // fizzled. A target only: a wipe's dead say "dies".)
    if (!one || !one.n || !one.cardTg.includes(id) || !facts) continue;
    const m = facts.moves.get(id), spellAt = facts.firstSeq.get(one.s.id);
    if (m?.to === "Graveyard" && m.how !== "sacrificed" && !m.cause && (spellAt == null || facts.firstSeq.get(id) > spellAt)) say(one, one.n, id);
  }
  for (const it of items) {
    const { s, n, src } = it;
    // (each of its items once: one line per amount, the creatures dealt that much together, same names counted; "each
    // creature" with how many when that was every creature: Pyroclasm read its line and then about 50 more "Pyroclasm
    // deals 2 damage to Spirit token", Kykar re-test new bug 3. A creature hit by two of its items is in two lines.)
    const creatures = Object.keys(prev.cards).filter((id) => prev.cards[id].zone === "battlefield" && prev.cards[id].creature);
    for (const [d, ids] of it.hit) {
      const k = new Map();
      for (const x of ids) k.set(x, (k.get(x) || 0) + 1);
      const most = Math.max(...k.values());
      for (let i = 0; i < most; i++) {
        const hit = [...k].filter(([, c]) => c > i).map(([x]) => x);
        const all = it.each && hit.length > 1 && hit.length === creatures.length;
        lines.push(`${s.name} deals ${d} damage to ${all ? `each creature (${hit.length})` : byCount(hit.map((x) => tokenWords(prev.cards[x].name, prev.cards[x].token)))}`);
      }
    }
    if (!n) continue;
    const times = (ps) => ps.flatMap((p) => Array(s.gone || 1).fill(p));
    const players = it.plTg.length ? it.plTg : /\bdamage to each opponent\b/i.test(s.text) ? times(Object.keys(cur.life).filter((p) => p !== s.ctl))
      : /\bdamage to each player\b/i.test(s.text) ? times(Object.keys(cur.life)) : [];
    for (const p of players) {
      const sh = shieldFor(src.id, p);
      if (sh?.kind === "prevent" && lost(p) <= 0) prevented(sh, src, s.name, p, n);
      else if (sh?.kind === "redirect" && lost(src.ctl) >= n && lost(p) <= 0) redirected(sh, src, s.name, n);
      else if (!sh && lost(p) > 0) { why(loss, p, n, `damage from ${s.name}`); it.dealt += n; }
    }
    if (src.ll && it.dealt) why(gain, src.ctl, it.dealt, `lifelink from ${s.name}`);
  }
  // (what was owed from the board before, now that this board's other parts are known, see owedCombat above)
  for (const [p, list] of lateSaid) {
    const alone = !(loss[p] || []).length && !(gain[p] || []).length && !otherParts(p);
    for (const o of list) { if (alone) { lines.push(o.line); why(loss, p, o.n, o.w); } if (o.sh) used(o.sh); }
  }
  return { lines, loss, gain };
}
// A life change's parts in words, the same words once with their count: "damage from Niv-Mizzet, Parun ×2"; parts
// apart by ";", as card names have commas
function lifeWords(parts) {
  const k = new Map();
  for (const x of parts) k.set(x.w, (k.get(x.w) || 0) + 1);
  return [...k].map(([w, n]) => (n > 1 ? `${w} ×${n}` : w)).join("; ");
}
// What gained or lost a player life other than damage, for the life line: the spells and abilities that just resolved
// (resolved, with a dungeon room just entered as one: its own words) whose words give that player life or take it,
// and the abilities just put on the stack whose cost pays it ("Pay N life:"). rest: the part of the change nothing else
// explains, the sign said. -> its parts [{ n, w }] summing to rest, or [] when that isn't certain: one source of an
// amount unknown ("life equal to ..."), or sources whose known amounts add up to it. Kitchen Finks's "+2" and a dungeon
// room's "-1" read bare (readability audit C3, 2026-11-12).
// (who: "you" is its controller, "each opponent" the others, "target player" its player targets, "its controller" the
// controller of the cards it targets; any other subject, "that player", "defending player", is not said)
// (and an amount after the verb, a number, X, "life equal to" or "that much": "Whenever you gain life" gives none)
const LIFE_AMOUNT = String.raw`(?= (?:\d+|X) life\b| life equal to\b| that much life\b)`;
const LIFE_WHO = [
  [new RegExp(String.raw`\byou (gain|lose)${LIFE_AMOUNT}`, "i"), (s) => [s.ctl]],
  [new RegExp(String.raw`\beach opponent (gains|loses)${LIFE_AMOUNT}`, "i"), (s, all) => all.filter((p) => p !== s.ctl)],
  [new RegExp(String.raw`\beach player (gains|loses)${LIFE_AMOUNT}`, "i"), (s, all) => all],
  [new RegExp(String.raw`\btarget (?:player|opponent) (gains|loses)${LIFE_AMOUNT}`, "i"), (s) => s.plTg || []],
  [new RegExp(String.raw`\b(?:its|that creature's|that permanent's) controller (gains|loses)${LIFE_AMOUNT}`, "i"),
    (s, all, prev) => [...new Set((s.cardTg || []).map((id) => prev.cards[id]?.ctl).filter(Boolean))]],
];
function lifeSources(p, rest, sources, all, prev) {
  if (!rest) return [];
  const fits = [];
  for (const s of sources) {
    // (each clause of its words that gives or takes life, the first that names p with rest's sign)
    for (const clause of String(s.text || "").split(/(?<=\.)\s+|,? and (?=you |each |target |its |that )/i)) {
      const hit = LIFE_WHO.find(([re]) => re.test(clause));
      if (!hit) continue;
      const verb = hit[0].exec(clause)[1].toLowerCase();
      if ((rest > 0) !== /^gain/.test(verb) || !hit[1](s, all, prev).includes(p)) continue;
      const n = /\b(?:gains?|loses?) (\d+) life\b/i.exec(clause)?.[1];
      fits.push({ s, n: n != null ? Number(n) * (s.gone || 1) : null });
      break;
    }
  }
  if (!fits.length) return [];
  const sign = rest > 0 ? 1 : -1;
  if (fits.length === 1 && (fits[0].n == null || fits[0].n === Math.abs(rest))) return [{ n: rest, w: fits[0].s.w }];
  return fits.every((f) => f.n != null) && fits.reduce((a, f) => a + f.n, 0) === Math.abs(rest) ? fits.map((f) => ({ n: sign * f.n, w: f.s.w })) : [];
}
// An "unless that player pays" or a "you may pay ... If you do" that resolved: paid or not, said only when certain.
// First the payer's own answer, a player of ours asked "Pay {1}?" (game.answers, by the card: one card's two triggers
// ask twice), unless the feed's draws contradict it (a "yes" whose payment then failed). Else only when what it does
// is a draw and nothing else, as Forge's feed names the card that caused each draw (facts.drawsBy) and so says whether
// it happened: "you may pay {1}. If you do, draw a card", drawn means paid;
// "draw a card unless that player pays", drawn means not paid, and not drawn means paid unless the draw was its
// controller's to decline ("you may draw"): then their "no" to it, which Forge asks only once the payment was declined
// (Rhystic Study: "Pay {1}?", then "Do you want to draw a card?"), or a player of ours asked fewer times than not drawn.
// Anything else it does, a counter, damage, life, is no evidence of a payment in the feed (Extort, Soul Barrier,
// Chancellor of the Annex): nothing said. Nor without the feed. The payer of an "unless" is Forge's "Activator" in the
// trigger's words; Esper Sentinel's {X} is its power. Esper Sentinel, Rhystic Study and Mystic Remora read only "White
// draws a card", Kykar #7; Mentor of the Meek, #21.
function unlessNews(prev, cur, resolved, facts) {
  const lines = [];
  for (const s of resolved) {
    const unless = /\bunless (?:that player|its controller|they|he or she|that spell's controller) pays? ((?:\{[^}]+\})+)/i.exec(s.text);
    const may = /\byou may pay ((?:\{[^}]+\})+)\. If you do\b/i.exec(s.text);
    if (!unless && !may) continue;
    // (this card's answers, used up here)
    const answers = (game.answers?.get(s.id) || []).filter(fresh);
    game.answers?.delete(s.id);
    let cost = (unless || may)[1];
    // (X by this card's own power only, named: "where X is enchanted creature's power" is another card's, as xNow reads it)
    const self = prev.cards[s.id];
    if (cost === "{X}" && self?.pw != null && self.name && new RegExp(`\\bwhere X is ${escapeRe(self.name)}'s power\\b`, "i").test(s.text)) cost = `{${self.pw}}`;
    // (Forge's usernames, as displayText reads them: any case)
    // (each item that left by its own words, and one payer for them all or none: Esper Sentinel's two triggers, AI 1's
    // spell and AI 2's, merged into one entry read "AI 1 doesn't pay" and "AI 1 pays", checker round 4)
    const activator = (d) => /\bActivator: ([^,\]]+)/.exec(d || "")?.[1]?.trim().toLowerCase();
    const bys = new Set((s.left?.length ? s.left : [null]).map((sid) => activator(sid != null && s.descBy?.[sid] != null ? s.descBy[sid] : s.desc)));
    const by = bys.size === 1 ? [...bys][0] : null;
    const k = by ? (game.playerOrder || []).findIndex((u) => String(u || "").toLowerCase() === by) : -1;
    const payer = may ? s.ctl : k >= 0 ? `player-${k}` : null;
    if (!payer) continue;
    const gone = s.gone || 1;
    const each = (n, line) => { for (let i = 0; i < n; i++) lines.push(line); };
    const pays = `${nameOf(payer)} pays ${cost} (${s.name})`, not = `${nameOf(payer)} doesn't pay ${cost} (${s.name})`;
    // (what it does is a draw and nothing else: then the feed's draws say whether it was paid)
    const drawOnly = may ? /\byou may pay (?:\{[^}]+\})+\. If you do, draw a card\.?$/i.test(s.text.trim())
      : /^(?:When|Whenever|At)\b[^.]*, (?:you may )?draw a card unless\b[^.]*\.$/i.test(s.text.trim());
    const drew = facts ? Math.min(gone, facts.drawsBy?.get(s.id) || 0) : 0;
    const own = answers.filter((a) => a.kind === "pay" && a.slot === payer);
    if (own.length) {
      // (all of them answered, or nothing: which of the others was which is unknown. And none the feed contradicts: a
      // "yes" whose payment failed, Blue's yes to AI 1's Rhystic Study then AI 1's draw, read "Blue pays {1}", checker
      // round 3. Paid, a "you may pay" draws once each, and a yes with no draw may be a failed payment; an "unless"
      // draws only unpaid, and not always: "you may draw", or a draw from an empty library, so only a draw beyond the
      // "no"s contradicts them.)
      // (with no feed for the window, a "you may pay" yes is said only when the payer's hand grew: a yes with nothing drawn
      // may be a failed payment)
      const paid = own.filter((a) => a.value).length;
      const grew = (cur.counts[`hand:${payer}`] ?? 0) > (prev.counts[`hand:${payer}`] ?? 0);
      const fits = !drawOnly || (facts ? (may ? drew === paid : drew <= gone - paid) : !may || !paid || grew);
      if (own.length === gone && fits) for (const a of own) lines.push(a.value ? pays : not);
      continue;
    }
    if (!facts || !drawOnly) continue;
    if (may) {
      each(drew, pays);
      each(gone - drew, not);
      continue;
    }
    each(drew, not);
    const rest = gone - drew;
    if (!rest) continue;
    if (!/, you may draw a card unless\b/i.test(s.text)) { each(rest, pays); continue; }
    // (the controller's own "may" answers: a "no" was asked once the payment was declined; a player of ours asked fewer
    // times than its items left paid for the rest, never asked)
    const mine = answers.filter((a) => a.kind === "may" && a.slot === s.ctl);
    const no = mine.filter((a) => !a.value).length, yes = mine.length - no;
    if (no > rest || yes !== drew) continue;
    each(no, `${nameOf(payer)} doesn't pay ${cost}, and ${nameOf(s.ctl)} declines (${s.name})`);
    if (seatOfSlot(s.ctl)) each(rest - no, pays);
  }
  return lines;
}
// What a resolved "tap / untap target ..." did to its targets, and a permanent that just became a creature (Icy
// Manipulator, Kiora's Follower and Mutavault read only "White uses X's ability", ability sweep)
function tapNews(prev, cur, resolved) {
  const lines = [];
  for (const s of resolved) {
    if (!/\b(?:tap|untap)\b[^.]*\btarget\b/i.test(s.text)) continue;
    for (const id of s.cardTg) {
      const was = prev.cards[id], now = cur.cards[id];
      if (was?.zone === "battlefield" && now?.zone === "battlefield" && was.tapped !== now.tapped) lines.push(`${s.name} ${now.tapped ? "taps" : "untaps"} ${tokenWords(now.name, now.token)}`);
    }
  }
  for (const [id, c] of Object.entries(cur.cards)) {
    const was = prev.cards[id];
    if (c.zone === "battlefield" && was?.zone === "battlefield" && c.creature && !was.creature) lines.push(`${tokenWords(c.name, c.token)} becomes a creature`);
  }
  // (and the keywords a resolved spell or ability gave creatures, the same ones together: Akroma's Will resolved with no
  // line at all, its keywords on the cards, Kykar #26. Each keyword only by what names it: Lightning Helix's "you gain 3
  // life" took a haste from elsewhere, checker 2026-11-07; one named by none is not said.)
  const gave = resolved.filter((s) => /\b(?:gains?|gets? [+-]\d+\/[+-]\d+ and gains?|have)\b/i.test(s.text));
  if (gave.length) {
    const by = new Map();
    for (const [id, c] of Object.entries(cur.cards)) {
      const was = prev.cards[id];
      if (c.zone !== "battlefield" || was?.zone !== "battlefield" || !c.creature) continue;
      const added = (c.kw || []).filter((k) => !(was.kw || []).includes(k));
      // (its keywords by the spells that name them: "kw, kw|giver, giver")
      const givers = new Map();
      for (const k of added) {
        // (and only what it could give it to: a targeted gift its known targets, a "you control" one its controller's)
        const from = gave.filter((s) => new RegExp(`\\b${escapeRe(k)}\\b`, "i").test(s.text)
          && (!/\btarget\b/i.test(s.text) || [...(s.cardTg || []), ...pickedIds(s.pk, "card")].includes(id))
          && (!/\byou control\b/i.test(s.text) || c.ctl === s.ctl)).map((s) => s.name);
        if (from.length) { const g = from.join(", "); givers.set(g, [...(givers.get(g) || []), k]); }
      }
      for (const [g, kws] of givers) { const key = `${kws.join(", ")}|${g}`; by.set(key, [...(by.get(key) || []), tokenWords(c.name, c.token)]); }
    }
    for (const [key, names] of by) {
      const [kws, g] = key.split("|");
      // (same names counted: Akroma's Will and Flawless Maneuver read "Spirit token, Spirit token, ..." some 50 times,
      // Kykar re-test new bug 7)
      lines.push(`${byCount(names)} ${names.length > 1 ? "gain" : "gains"} ${kws.toLowerCase()} (${g})`);
    }
  }
  return lines;
}

function logEvents(prev, cur, pub, facts = null) {
  logBoards = [prev, cur]; // (for sacrificesForMana)
  const out = [];
  const who = (id) => nameOf(id);
  const turnBegan = cur.turn !== prev.turn && !!cur.active;
  const oldTurn = []; // (the lines of spells that resolved in the turn just ended: they go above the header)
  if (turnBegan) {
    // (an extra turn, Forge's flag: Stitch in Time's read as a plain turn, rebuilt hand test #15)
    out.push(`--- ${who(cur.active)}'s turn ${game.turnsTaken?.[cur.active] || 1}${extraTurn(cur) ? " (extra turn)" : ""} ---`);
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
  const pubIndex = cardIndex(pub);
  // (a spell cast another way, whose stack item said nothing of what it does (castWayOnly): a counterspell by its card's
  // text, the card now off the stack; Spider-Sense cast by web-slinging, keyword sweep kw-20)
  for (const s of prevSpellOf.values()) if (s.way && pubIndex[s.id] && isCounterspell(pubIndex[s.id].text || "")) for (const t of s.tg) prevCounterTargeted.add(t);
  // (and the spells taken off the stack by one no board showed there, see takenOffStack; those seen on the stack have
  // their targets, above. answeredOld: the ones that took a spell seen on the last board's stack, so cast in that turn)
  const takenOff = takenOffStack(facts?.offStack || [], prevSpellOf, cur.cards, pubIndex);
  const answeredOld = new Set([...takenOff].filter(([id]) => prevSpellOf.has(id)).map(([, t]) => t.by));
  const curSids = new Set(Object.values(cur.stack).flatMap((s) => s.sids));
  // (what was on the stack on either board, for the lines below that look for a spell or ability there)
  const bothStacks = [...Object.values(prev.stack), ...Object.values(cur.stack)];
  // (resolved: what left the stack and wasn't countered, for what it did: its "unless" payment, its damage, its taps
  // and the keywords it gave, see unlessNews, damageNews, tapNews; its suspect, goad and detain, below)
  // (each entry with the items of it that left, one of two of a card's triggers too: gone, how many, and their targets)
  const resolved = Object.values(prev.stack).flatMap((s) => {
    const left = s.sids.filter((x) => !curSids.has(x));
    if (!left.length || s.sids.some((x) => prevCounterTargeted.has(x)) || takenOff.get(s.id)?.how === "counter") return [];
    const by = (k, all) => (s.tgBy ? left.flatMap((x) => s.tgBy[x]?.[k] || []) : all);
    return [{ ...s, gone: left.length, left, cardTg: by("c", s.cardTg), plTg: by("p", s.plTg) }];
  });
  // (what countered a spell, said after "is countered": the counterspell seen targeting it, the one no board showed that
  // took it, or the only counterspell that resolved just now, with no ability that counters beside it (Voidmage
  // Prodigy's above a Counterspell may be what countered it); "Marble Diamond is countered" said nothing of White's
  // Counterspell, Kykar #8, nor Talisman of Dominance of Jin-Gitaxias's copy)
  const counterSpells = resolved.filter((s) => !s.ability && isCounterspell(s.text));
  const onlyCounter = counterSpells.length === 1 && !resolved.some((s) => s.ability && isCounterspell(s.text)) ? counterSpells[0] : null;
  // (every "is countered" line names its counter through counteredBy, so the cards it is asked for are the ones countered
  // on this board: lines.countered, for the table's COUNTERED pop-up (sendTable's ctrd). The table can't tell from the
  // stack: Forge's stack words name the target, "Counter Fury.", and its stack lists no spell targets, live check
  // 2026-11-12)
  const counteredIds = new Set();
  const counteredBy = (id) => {
    counteredIds.add(id);
    const sids = prevSpellOf.get(id)?.sids || [], off = takenOff.get(id);
    const name = Object.values(prev.stack).find((x) => x.id !== id && x.ctg?.some((t) => sids.includes(t)))?.name
      || (off?.how === "counter" ? cur.cards[off.by]?.name || prev.cards[off.by]?.name : null)
      || (onlyCounter && onlyCounter.id !== id ? onlyCounter.name : null);
    return name ? ` by ${name}` : "";
  };
  // (a countered spell by the face cast, its stack item's name: Valki cast as Tibalt, Cosmic Impostor read "Valki, God of
  // Lies is countered", live check batch 2 2026-11-12)
  const castName = (id, c) => prevSpellOf.get(id)?.name ?? c.name;
  // (a counterspell that resolved with its target still on the stack: that spell can't be countered (Carnage Tyrant,
  // or a card such as Destiny Spinner), and Forge says nothing, so the counter looked broken; the user, 2026-11-10:
  // "you can't counter spell something". Its targets: Forge's, else the player's own picks this turn when it is the
  // only counterspell that resolved now. isCounterspell has no "unless", so a payment is no reason here.)
  // (not one the engine's feed says left the stack: it was countered, and what's on the stack now is a recast or an
  // old picture, test_bridge_events "one still on the stack under its own id")
  const leftInFeed = new Set((facts?.offStack || []).map((o) => o.id));
  for (const s of counterSpells) {
    const hit = new Set(s.ctg?.length ? s.ctg : onlyCounter === s ? counterKept : []);
    for (const x of Object.values(cur.stack)) {
      if (x.ability || !prevSpellOf.has(x.id) || leftInFeed.has(x.id) || !x.sids.some((t) => hit.has(t))) continue;
      const why = cantBeCounteredWhy(pub, x.text || x.desc, x.ctl);
      out.push(`${x.name} can't be countered: ${s.name} did nothing to it${why && why.card ? ` (${why.said})` : ""}`);
    }
  }
  // (the targets the player picked for a stack item of theirs, kept on it while it stays: Forge's stack names no spell's
  // targets, Shock's and Counterspell's list is empty, so its own targets are the player's picks alone; picks asked for
  // these words only, see Seat.respond)
  for (const [key, s] of Object.entries(cur.stack)) {
    const pick = game.picked?.get(s.id);
    // (a casting pick with no words is a permanent spell's, whose stack item has none either: an Aura's, which named no
    // target, checker round 4; any other only with its words)
    if (pick && !prev.stack[key]?.pk && (pick.text || pick.casting) && pick.text === s.text && fresh(pick)) { s.pk = pick.ids; game.picked.delete(s.id); }
    else if (prev.stack[key]?.pk) s.pk = prev.stack[key].pk;
  }
  // (" targeting X and Y": a stack item's targets by name, Forge's and the player's picks, or a pick not yet on any stack
  // item (one cast and gone before a board showed it); "White casts Counterspell" named no target, Kykar #8)
  // (a record's pick, with no stack item to hold it, only a casting one (see Seat.respond): made while that play was
  // being cast or activated, as notePlay forgets the card's earlier picks. Any other is not this play's and is kept for
  // its own item: a creature's enter trigger's pick read "casts <the creature> targeting", checker round 3. Not by the
  // card's words: Forge's prompt words differ from the Oracle text for half the targeted instants in our decks, Into
  // the Roil's kicker line, and a permanent spell's prompt has none, Pacifism's, checker round 4.)
  const targetWords = (s, id = s?.id) => {
    let ids = [...(s?.cardTg || []).map((x) => `card|${x}`), ...(s?.plTg || []).map((x) => `player|${x}`), ...(s?.pk || [])];
    const pick = !s && game.picked?.get(id);
    if (pick?.casting && fresh(pick)) { ids = pick.ids; game.picked.delete(id); }
    const stackName = (sid) => bothStacks.find((x) => x.sids.includes(sid))?.name;
    const names = [...new Set(ids)].map((t) => {
      const kind = t.slice(0, t.indexOf("|")), tid = t.slice(t.indexOf("|") + 1), c = cur.cards[tid] || prev.cards[tid];
      if (kind === "player") return who(tid);
      if (kind === "spell") return stackName(tid);
      const name = c?.name ?? pubIndex[tid]?.identity?.name;
      return name ? tokenWords(name, c?.token) : null;
    }).filter(Boolean);
    return names.length ? ` targeting ${andList(names)}` : "";
  };
  // (a cast of a prepared creature's spell copy names the creature, the copy having been in exile on the last board:
  // notePrepared, HAND-TEST-HP06 #20)
  const prepWords = (id) => (prev.cards[id]?.prepBy ? ` (prepared by ${prev.cards[id].prepBy})` : "");
  // (and that cast's line when no board showed the copy on the stack: cast and resolved between two boards, an AI's.
  // Its caster is the creature's controller, Forge's MayPlayPlayer$ EffectSourceController; the copy is in the exile of
  // the player who prepared it.)
  const prepCast = (id) => {
    const h = prev.cards[id].prep;
    if (!castNow.has(id)) out.push(`${who(cur.cards[h]?.ctl || prev.cards[h]?.ctl || prev.cards[id].owner)} casts ${prev.cards[id].name}${prepWords(id)}`);
  };
  const onStack = (st, id) => Object.values(st).some((s) => s.id === id && !s.ability);
  // (an activation's line, by its stack item or the player's record of it: an equip names what it equips, Skullclamp's
  // read "White uses Skullclamp's ability", Kykar #3; a planeswalker's says which ability and the loyalty it cost,
  // "White uses Ral Zarek's ability", #13; any other, its targets)
  const activationLine = (s, mine) => {
    const id = s?.id ?? mine.id, ctl = s?.ctl ?? mine.ctl, name = s?.name ?? mine.name, text = s?.text || mine?.text || "";
    const tg = targetWords(s, id);
    if (/^Equip\b/i.test(text) && tg) return `${who(ctl)} equips ${tg.slice(" targeting ".length)} with ${name}`;
    const was = prev.cards[id]?.loy, now = cur.cards[id]?.loy, cost = /^([+−-]?(?:\d+|X)):/.exec(text)?.[1];
    // (the cost is the ability's own words; its loyalty before and after only when both boards show it: a planeswalker
    // cast and activated between two boards read "White uses Ral Zarek's ability". A planeswalker's alone, by its type
    // on this board or its loyalty on the last (gone from view since, to a hand): an artifact's "0: Draw a card." read
    // "activates Weird Thing's 0", checker round 3)
    const walker = was != null || (pubIndex[id]?.types || []).includes("Planeswalker");
    // (and what it does, abilityGist: "White uses Merfolk Looter's ability: draw a card, then discard a card",
    // readability audit C2)
    const gist = gistWords(text, name);
    if (cost && walker) return `${who(ctl)} activates ${poss(name)} ${cost.replace("−", "-")}${now != null && was != null && now !== was ? ` (loyalty ${was} -> ${now})` : ""}${tg}${gist}`;
    return `${who(ctl)} uses ${poss(name)} ability${s?.via ? ` (${poss(s.via)})` : ""}${tg}${gist}`;
  };
  // (a permanent spell straight from the stack into a graveyard was countered too, by whatever did it, an ability or a
  // spell: of those only an Aura can lose its target and not resolve, and one that resolved went by the battlefield,
  // evoke's sacrifice and the legend rule's loser. One cast by another name, a double-faced card's other face, goes by
  // the face cast, its stack item: a sorcery face resolves into the graveyard, its front a creature, and has its spell
  // text (Forge's sourceAbilityText, an instant's or a sorcery's words); a permanent face has none and was countered.
  // Valki cast as Tibalt, Cosmic Impostor and countered read no "is countered", live check 2026-11-12)
  const counteredOff = (id, c, moved) => {
    if (takenOff.get(id)?.how === "counter") return true;
    if (moved?.from !== "Stack" || moved.to !== "Graveyard" || moved.through || c.land || (pubIndex[id]?.subtypes || []).includes("Aura")) return false;
    const cast = prevSpellOf.get(id);
    return cast && cast.name !== c.name ? !cast.text : !c.spell;
  };
  // (lines said after the cards' own: a spell countered by one cast just now, after that cast; [line, the spell's card])
  const later = [], sayAfter = (now, id, line) => (now ? out.push(line) : later.push([line, id]));
  // (came off the stack, or was just logged as a cast: not a discard, not "put into a graveyard")
  // (or by its card: a split card resolves under its half's name, "Cut // Ribbons is put into White's graveyard", hp-11)
  const fromStack = (id, c) => castNow.has(id) || prevStackNames.has(c.name) || Object.values(prev.stack).some((x) => x.id === id);
  // (a stack ability with no record of the player's (a trigger, or an AI's) seen with a permanent that just entered is
  // said after the entry, which most often caused it: Kodama of the East Tree's read before "Lizard Blades enters the battlefield", Lotus Field's before Lotus Field, hp-05)
  const entered = Object.entries(cur.cards).some(([id, c]) => c.zone === "battlefield" && prev.cards[id]?.zone !== "battlefield");
  const afterEntries = [];
  // (and a trigger after everything else the board shows, which is what made it trigger: Fable's chapter read before its
  // lore counter, Electro's leave trigger before "Electro dies", Goblin Shaman's before "White attacks", rebuilt hand
  // test #9. Added at the very end: the grouped lines keep their places.)
  const triggered = [];
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
  // (an item seen before under its own stack id is no new one, whatever it is taken for now: Raven's Crime cast by retrace
  // is still in the graveyard on the casting board, so an ability there, and a spell once it left; "casts" twice, keyword sweep)
  // (Forge never gives a stack id twice: "engine-stack-<n>" counts up, "casting-<n>" is the ability being cast)
  const prevSids = new Set(Object.values(prev.stack).flatMap((s) => s.sids));
  // (an item gone from the stack in this board resolved (or was countered) before anything new went on it: a spell or
  // activation new now is said after what that did, after its triggers too. Fury's damage trigger killed four creatures,
  // then the AI activated Jace, and the deaths read after "AI 1 activates Jace Beleren's +2", live game 2026-11-11)
  const resolvedHere = Object.values(prev.stack).some((s) => s.sids.length > 0 && s.sids.every((x) => !curSids.has(x)));
  const afterResolved = [];
  for (const [key, s] of Object.entries(cur.stack)) {
    // (a spell back under a new stack id left the stack and was cast again, Forge giving no stack id twice: countered, if a
    // counterspell had it, and recast in one board; Niv-Mizzet read as never countered nor recast, rebuilt re-test 2.
    // Where it went between is the feed's word, which has no cast from the command zone: Stack, Graveyard, Command.)
    const left = facts?.moves.get(s.id), landed = (ids) => ids.length > 0 && ids.every((x) => /^engine-stack-/.test(x));
    // (by its last ids having landed: one only now landing from its cast is the same cast)
    if (!s.ability && prevSpellOf.has(s.id) && landed(prevSpellOf.get(s.id).sids) && !s.sids.some((x) => prevSids.has(x))) {
      const via = left?.from === "Stack" ? (left.to === "Stack" ? left.through : left.to) : null;
      if (prevSpellOf.get(s.id).sids.some((sid) => prevCounterTargeted.has(sid))) out.push(`${s.name} is countered${counteredBy(s.id)}${via === "Command" ? " and returns to the command zone" : ""}`);
      else if (via === "Hand") out.push(`${s.name} returns to ${who(s.ctl)}'s hand`);
      out.push(`${who(s.ctl)} casts ${s.name}${optionalWords(s.opt)}`);
      spellsSeen.add(`${s.ctl}|${s.name}`);
      continue;
    }
    for (let k = Math.max(prev.stack[key]?.n || 0, s.sids.filter((x) => prevSids.has(x)).length); k < s.n; k++) {
      // (spell or ability by what the player started when there is a record: ninjutsu's card is in the hand, so the
      // stack alone called it a cast, stage 3 review 2026-10-27)
      const mine = said(s.id);
      if (!mine) {
        // (an early "casts" line hides only a cast: it hid the commander's own enter trigger; an early line of any other
        // kind, an ability's or a keyword's, hides the card's next stack item, whose kind the stack only guesses, suite
        // review; a ninjutsu's, checked for "ability" alone, read twice, keyword sweep)
        const early = game.saidEarly.findIndex((x) => x.id === s.id && (x.kind !== "cast" || !s.ability));
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
        || Object.values(prev.stack).some((x) => x.effect && x.name === s.name)
        // (or by the trigger that casts it: cipher's "may cast a copy of Last Thoughts", whose copy Forge makes a card of
        // its own with no copy flag; it read "White casts Last Thoughts", kw-17 2026-11-06)
        || Object.values(prev.stack).some((x) => x.ability && `${x.text} ${x.desc}`.includes(`cast a copy of ${s.name}`)));
      if (!ability) { spellsSeen.add(`${s.ctl}|${s.name}`); namesSeen.add(s.name); }
      (!mine && ability && (s.trigger || s.kwTrigger || s.upkeepCost) ? triggered : !mine && ability && entered ? afterEntries : resolvedHere ? afterResolved : out).push(s.upkeepCost ? `${poss(s.name)} ${s.upkeepCost}, or it is sacrificed`
        : ability && s.room ? `${who(s.ctl)} ventures into ${s.room} (${s.name})`
        : ability ? keywordLine(mine ? mine.kind : !s.trigger && !s.kwTrigger ? keywordKind(s.text) : null, s.ctl, s.name) || (!mine && s.kwTrigger ? `${poss(s.name)} ${s.kwTrigger} triggers (${who(s.ctl)})` : !mine && s.trigger ? `${poss(s.name)} ability triggers (${who(s.ctl)})${gistWords(s.text, s.name)}` : activationLine(s, mine))
        : k >= 1 || copyOf ? `${who(s.ctl)} copies ${s.name}` : `${who(s.ctl)} casts ${mine ? mine.name : s.name}${prepWords(s.id)}${optionalWords(s.opt, mine?.name)}${targetWords(s)}`);
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
    else if (e.kind === "cast" && cur.cards[e.id] && (!prev.cards[e.id] || prev.cards[e.id].zone !== cur.cards[e.id].zone)) { out.push(`${who(e.ctl)} casts ${e.name}${prepWords(e.id)}${targetWords(null, e.id)}`); e.said = true; castNow.add(e.id); game.saidEarly.push({ id: e.id, kind: e.kind, at: Date.now() }); }
    else if (e.kind === "faceup" && back) e.said = true;
    else if (e.kind !== "cast" && back) { out.push(keywordLine(e.kind, e.ctl, e.name) || activationLine(null, e)); e.said = true; game.saidEarly.push({ id: e.id, kind: e.kind, at: Date.now() }); }
  }
  // (a spell back in a hand from the stack, which no board shows: buyback's, by no other spell. Forge gives no move off
  // the stack a cause, so a spell another one sent back, Remand or Unsubstantiate, is told by that spell: Remand counters
  // it and says so, after its cast when no board showed it, keyword sweep kw-14. Whispers of the Muse's buyback read
  // nothing, keyword sweep. Only from an engine that names causes: from one that names none, every Remand would read as
  // a buyback.)
  // (or into a library, countered: Memory Lapse's on top, Spell Crumple's on the bottom, Hinder's either, by the
  // counter's words; Memory Lapse's spell read nothing, suite review 2026-11-06)
  for (const [id, m] of facts?.moves || []) {
    const s = m.from === "Stack" && (m.to === "Hand" || m.to === "Library") && prevSpellOf.get(id);
    if (!s) continue;
    const seenBy = s.sids.some((x) => prevCounterTargeted.has(x)) ? "counter" : s.sids.some((x) => prevTargeted.has(x)) ? "return" : null;
    const by = seenBy || takenOff.get(id)?.how, owner = who(cur.cards[id]?.owner || s.ctl);
    if (m.to === "Library") {
      if (by !== "counter") continue;
      const words = (seenBy ? Object.values(prev.stack).find((x) => x.ctg?.some((t) => s.sids.includes(t)))?.text : pubIndex[takenOff.get(id)?.by]?.text) || "";
      const top = /\btop\b[^.]*\bits owner's library\b/i.test(words), bottom = /\bbottom of its owner's library\b/i.test(words);
      sayAfter(seenBy, id, `${s.name} is countered${counteredBy(id)} and put ${top && !bottom ? "on top of" : bottom && !top ? "on the bottom of" : "into"} ${owner}'s library`);
      continue;
    }
    sayAfter(seenBy || !by, id, by === "counter" ? `${s.name} is countered${counteredBy(id)} and returns to ${owner}'s hand`
      : `${s.name} returns to ${owner}'s hand${!by && !m.cause && game.feedCauses ? " (buyback)" : ""}`);
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
  // (suspect, goad and detain below read resolved, above: not one countered, as the text-change line below tells it; a
  // countered Lyev Decree detained nothing, checker 2026-11-07, and a countered goad or suspect does nothing either.
  // And unseen: what left the stack with no board showing it there, taken as resolved unless a counterspell no board
  // showed is known to have taken it (takenOff); one that fizzled can't be told. For them alone, as nothing says what
  // else it did.
  // First the player's own targeted trigger noted at its target pick: resolved once off the stack, taken from the stack
  // above when a board showed it there.)
  const unseen = [];
  game.ownTargeted = (game.ownTargeted || []).filter((t) => {
    if (Object.values(cur.stack).some((s) => s.id === t.id)) return true;
    if (!Object.values(prev.stack).some((s) => s.id === t.id)) unseen.push({ ctl: t.ctl, text: t.text, cardTg: t.targets });
    return false;
  });
  // suspect (Forge shows only its menace): a resolved "suspect target creature" makes its targets suspected until they
  // leave the battlefield, said in the log and shown on each card (see tableCard); Nelly Borca, hp-14 gap
  game.suspected ??= new Set();
  for (const id of game.suspected) if (cur.cards[id]?.zone !== "battlefield") game.suspected.delete(id);
  // tribute (Forge shows nothing of the opponent's choice, an AI's never asked here): unpaid, said once while the card
  // stays, by Forge's own "if tribute wasn't paid" trigger, which it makes only then (on a stack, or asking its player,
  // see onPrompt), or by no counters at all on its arrival. Master Biomancer's counters on a Ravager whose tribute was
  // declined read nothing, checker 2026-11-07. Paid, the counters on its arrival line say it.
  // (game.tribute: card id -> "unpaid", its trigger's question seen (onPrompt), or "said"; forgotten as it leaves)
  game.tribute ??= new Map();
  for (const [id, was] of Object.entries(prev.cards)) if (was.zone === "battlefield" && cur.cards[id]?.zone !== "battlefield") game.tribute.delete(id);
  const tributeCard = (id, c) => !c.fd && game.tribute.get(id) !== "said" && /(?:^|\n)Tribute \d+\b/.test(pubIndex[id]?.text || "");
  const tributeTrig = (id) => game.tribute.get(id) === "unpaid" || bothStacks.some((s) => s.id === id && /\bif tribute wasn't paid\b/i.test(s.text));
  const sayTribute = (id, c) => { game.tribute.set(id, "said"); out.push(`Tribute wasn't paid for ${c.name}`); };
  for (const g of [...resolved, ...unseen]) {
    if (!/\bsuspect target creature\b/i.test(g.text)) continue;
    const ids = g.cardTg.filter((id) => cur.cards[id]?.zone === "battlefield" && !game.suspected.has(id));
    for (const id of ids) game.suspected.add(id);
    if (ids.length) out.push(`${ids.map((id) => cur.cards[id].name).join(", ")} ${ids.length > 1 ? "are" : "is"} suspected: menace, and can't block`);
  }
  for (const [id, c] of Object.entries(cur.cards)) {
    // (not one a counterspell no board showed took off the stack: a Disrupt Decorum countered unseen goaded, checker
    // 2026-11-07)
    if (c.zone !== "graveyard" || prev.cards[id]?.zone === "graveyard" || !c.spell || Object.values(prev.stack).some((s) => s.id === id) || takenOff.get(id)?.how === "counter") continue;
    const picks = seatOfSlot(c.ctl)?.targetPicks;
    unseen.push({ ctl: c.ctl, text: pubIndex[id]?.text || "", cardTg: picks && picks.src === id ? pickedIds(picks.ids, "card") : [] });
  }
  for (const g of [...resolved, ...unseen]) {
    if (!/\bgoad\b/i.test(g.text)) continue;
    const all = /\bgoad (?:all|each) creatures? (?:you don't control|your opponents control)\b/i.test(g.text);
    // ("goad all suspected creatures": every suspected one, its own controller's too, Nelly Borca)
    const ids = /\bgoad all suspected creatures\b/i.test(g.text) ? [...game.suspected]
      : all ? Object.entries(cur.cards).filter(([, c]) => c.zone === "battlefield" && c.creature && c.ctl !== g.ctl).map(([id]) => id) : g.cardTg.filter((id) => cur.cards[id]?.zone === "battlefield");
    if (!ids.length) continue;
    for (const id of ids) game.goaded.set(id, { by: g.ctl, turn: cur.turn });
    out.push(`${ids.map((id) => cur.cards[id].name).join(", ")} ${ids.length > 1 ? "are" : "is"} goaded by ${who(g.ctl)}: ${ids.length > 1 ? "they attack" : "it attacks"} each combat, a player other than ${who(g.ctl)} if able, until ${who(g.ctl)}'s next turn`);
  }
  // detain (Forge shows none): a resolved "detain target ..." said of its targets; Lyev Skyknight's read only "ability
  // triggers", keyword sweep kw-21
  // ("detain up to two target ...", Azorius Justiciar's, Lyev Decree's and Archon of the Triumvirate's, checker
  // 2026-11-07; not one countered, see resolved. One that fizzled, its targets made illegal but still there, the boards
  // can't tell.)
  // (kept until that player's next turn, as goad is, for the attack question's "can't attack" list: attackReminder)
  game.detained ??= new Map();
  for (const [id, g] of game.detained) if ((cur.active === g.by && cur.turn > g.turn) || cur.cards[id]?.zone !== "battlefield") game.detained.delete(id);
  for (const g of [...resolved, ...unseen]) {
    if (!DETAIN_TARGET.test(g.text)) continue;
    const ids = g.cardTg.filter((id) => cur.cards[id]?.zone === "battlefield");
    for (const id of ids) game.detained.set(id, { by: g.ctl, turn: cur.turn });
    if (ids.length) out.push(`${ids.map((id) => cur.cards[id].name).join(", ")} ${ids.length > 1 ? "are" : "is"} detained: until ${who(g.ctl)}'s next turn ${ids.length > 1 ? "they" : "it"} can't attack or block, and ${ids.length > 1 ? "their" : "its"} activated abilities can't be activated`);
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
  // (the attack goes before what came of it in the same board: Goblin Shaman's Treasure read before "attacks with",
  // re-test 2 bug a; its place is kept here and filled at the end)
  // (kept by identity, not index: a line put in above it, the last turn's cleanup discard at the top, moves it, and the
  // index cut the turn's header in its stead, live check 2026-11-07 "White discards Blasphemous Act", "", "AI 1 draws")
  const attackSlot = {};
  out.push(attackSlot);
  // (an ability no board showed on the stack, named before what it did: a permanent's, not the player's own activation,
  // which has its line; Archmage Emeritus's draw read "AI 1 draws a card" alone, re-test 2 bug g)
  const stackSeen = facts?.causes.size ? bothStacks : [];
  for (const [id, name] of facts?.causes || []) {
    const src = cur.cards[id] || prev.cards[id];
    if (src?.zone !== "battlefield" || stackSeen.some((x) => x.id === id) || pending.some((e) => e.id === id)) continue;
    // (one that triggers on something entering goes after the entries, as the draw does: Eidolon of Blossoms' read before
    // "Asceticism enters the battlefield", mechanic run hp-09 2026-11-05; Argothian Enchantress' cast trigger stays first)
    (drawAfter && /\benters\b/i.test(pubIndex[id]?.text || "") ? afterEntries : out).push(`${poss(tokenWords(name || src.name, src.token))} ability resolves (${who(src.ctl)})`);
  }
  // (the "unless" payments of what resolved, said before the draw they made or didn't; its damage, before what died of
  // it; its taps and the keywords it gave, below)
  // (the life changes' parts known from the players' own answers, for the damage lines and the life lines below)
  // Pain lands' damage, noted as they were tapped, for the first board that shows the land tapped only, as Forge deals
  // it with the mana: three bare "-1" lines for Adarkar Wastes, Battlefield Forge and Shivan Reef, Kykar #4; one kept for
  // later named a later, other loss, checker 2026-11-07. A board logged again from before the tap (another seat's, a
  // redraw) keeps it, for 10 s; one without the land drops it.
  const pains = (game.painTaps || []).filter((t) => cur.cards[t.id]?.tapped);
  game.painTaps = (game.painTaps || []).filter((t) => !pains.includes(t) && cur.cards[t.id] && Date.now() - t.at < 10000);
  // And life paid for a Phyrexian symbol, on a board of that cast only: its card on this board's stack (being cast or
  // cast), or just gone from the board before's; 10 s at most. One kept from a cast cancelled or over named a later,
  // other loss, verify 2026-11-09. Mondrak's read a bare "White: 55 -> 53 life (-2)", Kykar re-test new bug 10.
  const onStackNow = (x) => (pub.stack || []).some((s) => s.sourceId === x.card);
  game.lifePays = (game.lifePays || []).filter((x) => x.card && Date.now() - x.at < 10000);
  const payable = game.lifePays.filter((x) => onStackNow(x) || Object.keys(prev.stack).some((k) => k.startsWith(`${x.card}|`)));
  game.lifePays = game.lifePays.filter(onStackNow);
  const damage = damageNews(prev, cur, resolved, facts, (p) => pains.some((t) => t.slot === p) || payable.some((x) => x.slot === p));
  out.push(...unlessNews(prev, cur, resolved, facts), ...damage.lines);
  // (a counterspell that resolved alone on the stack had nothing left to counter: the spell it targeted was gone
  // already. AI 1's Arcane Denial, its target countered by Jin-Gitaxias's copy, left the stack with no line, Kykar #26.
  // Only a spell whose one sentence that targets is "Counter target ... spell", no modes, no ability: Cryptic Command's
  // and Dimir Charm's other modes do things, Stifle's and Disallow's target can be an ability; and nothing else at all on
  // the stack, a spell read as an ability included, Kozilek's Return's "When you cast this spell", checker 2026-11-07)
  for (const s of resolved) if (!s.ability && /^Counter target (?:[\w-]+ )*?spell\b[^.]*\./i.test(s.text) && !/\babilit(?:y|ies)\b|•|\bchoose\b/i.test(s.text)
    && (s.text.match(/\btargets?\b/gi) || []).length === 1 && Object.keys(prev.stack).length === 1) out.push(`${s.name} does nothing: the spell it targeted is gone`);
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
  for (const s of bothStacks) if (/\btarget (?:player|opponent) discards\b/i.test(s.text || "")) for (const p of s.plTg || []) looted.add(p);
  const lootedOut = (o) => looted.has(o) ? Object.entries(cur.cards).filter(([id, c]) => c.owner === o && c.zone === "graveyard" && !prev.cards[id] && !fromStack(id, c)).length : 0;
  const drawAt = {};
  const sayDrawn = (owner, n, searched) => {
    if (!drawAfter && !searched) drawAt[owner] ??= out.length;
    // (the cards its owner just revealed from that library, as many as went: by name; Dark Confidant's and Yuriko's
    // revealed card read "puts a card from their library into their hand", mechanic run hp-24/hp-26 2026-11-05)
    const rv = searched && !(owner in (facts?.explored || {})) && game?.lastReveal;
    // (of a reveal until a card is found, the last one when one was sought: grandeur's, keyword sweep kw-25. Until more
    // are found, Forge's DigUntilEffect stops at the last of them and the others can be anywhere among those revealed:
    // the ones now in their owner's hand on that seat's own board, else none named; Fathom Trawl's three read the last
    // three revealed, checker 2026-11-07)
    const rvFresh = rv && !rv.used && rv.slot === owner && rv.zone === "library" && Date.now() - rv.at < 30000;
    // (and of a reveal that put some of them in the hand, the rest elsewhere, the same: Fact or Fiction's pile read "White
    // puts 3 cards from their library into their hand", its five cards revealed by name, Kykar #10)
    const inHand = () => {
      const ids = new Set(zoneOf(seatOfSlot(owner)?.board?.state?.gameView || {}, "hand", owner).cards.map((c) => c.id));
      const found = (rv.cards || []).filter((c) => ids.has(c.id)).map((c) => c.name);
      return found.length === n ? found : null;
    };
    const named = !rvFresh ? null : rv.names?.length === n ? rv.names
      : rv.names?.length > n ? (rv.until && n === 1 ? rv.names.slice(-1) : inHand()) : null;
    if (named) rv.used = true;
    // (and its reveal, still held, said first: Dark Confidant's read "puts Mountain into their hand" above "reveals
    // Mountain", mechanic run hp-26 re-test 2026-11-05)
    const heldAt = named ? (game.heldLines || []).indexOf(displayText(rv.line)) : -1;
    if (heldAt >= 0) (drawAfter ? afterEntries : out).push(game.heldLines.splice(heldAt, 1)[0]);
    const line = named ? HAND_WORDS.putNamed(who(owner), named)
      : searched
      ? HAND_WORDS.put(who(owner), n, { explore: owner in (facts?.explored || {}) ? facts.explored[owner] || "a creature" : null })
      : HAND_WORDS.draw(who(owner), n);
    if (!searched) drawLines[owner] = line;
    (drawAfter ? afterEntries : out).push(line);
  };
  const drawLines = {}; // (each player's draw line, for a cost paid before it: see the end)
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
    // (and what made them discard, Forge's word, when it is one card for them all and no cost's: "AI 1 discards Island
    // (Duress)", readability audit C1)
    const bys = new Set(ids.map((id) => (costWords(facts?.moves.get(id), cur.cards[id].name) ? null : causeBy(facts?.moves.get(id), cur.cards[id].name))));
    const by = bys.size === 1 ? [...bys][0] : null;
    const line = HAND_WORDS.discard(who(owner), ids.map((id) => cur.cards[id].name + costWords(facts?.moves.get(id), cur.cards[id].name))) + (by ? ` (${by})` : "");
    const at = cur.turn !== prev.turn && cur.active && owner === prev.active ? 0
      : drawAt[owner] != null && facts && facts.firstDiscard[owner] < facts.firstDraw[owner] ? drawAt[owner] : out.length;
    out.splice(at, 0, line);
    for (const k of Object.keys(drawAt)) if (drawAt[k] >= at) drawAt[k]++;
  }
  const discardedIds = new Set(Object.values(discarded).flat());
  // cards into a graveyard from nowhere seen, up to what left that player's library and didn't reach their hand (the
  // hand's gain plus what was discarded from it): a mill, said in one line where the first card was (Emry's four cards
  // read as four "is put into White's graveyard", hp-06). An AI's loot between two boards can't be told from a mill.
  const millLeft = {}, millAll = {};
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
  // (cards a player searched out into their graveyard aren't milled: Buried Alive's read "White mills Skyhunter Strike
  // Force", hp-18 gap)
  // (cards moved one way at once, by one player: one line where the first was, said by its words table at the end)
  const groups = {};
  const grouped = (words, owner, name, k) => {
    const key = `${k.kind}|${owner}|${k.card || ""}|${k.label || ""}`;
    if (!groups[key]) { groups[key] = { words, owner, k, at: out.length, names: [] }; out.push(""); }
    groups[key].names.push(name);
    // (the group's first move by Forge's order, of those that carry one: see the cost's place at the end)
    if (k.seq != null) groups[key].seq = Math.min(groups[key].seq ?? k.seq, k.seq);
  };
  // a permanent's leave line (LEAVE_WORDS): tokens gone, and sacrifices for one reason (seven Treasures for mana, rebuilt
  // hand test #3), one line for all; any other its own
  const leave = (owner, name, k) => (k.kind === "tokens" || (k.kind === "sacrificed" && k.label)
    ? grouped(LEAVE_WORDS, "", name, k) : out.push(LEAVE_WORDS[k.kind](who(owner), [name], k)));
  const milled = (owner, name, k = { kind: "mill" }) => {
    if (k.kind === "mill" && seatOfSlot(owner)?.justDid("search", 20000)) k = { kind: "put" };
    grouped(LIBRARY_WORDS, owner, name, k);
  };
  // How a permanent no public zone shows any more left the battlefield, decided once: its kind (LEAVE_WORDS)
  const departureKind = (id, was, gone, toHand) => {
    if (toLibraryTop.has(id)) return { kind: "libraryTop" };
    if (was.token && gone?.how === "sacrificed") return { kind: "sacrificed", label: sacrificeWords(gone, was) };
    // (destroyed by what resolved, said so: "Soldier token is destroyed by Wrath of God", readability audit C1)
    if (was.token && gone?.how === "destroyed" && causeBy(gone, was.name, was.pn)) return { kind: "destroyed" };
    if (was.token && was.creature && gone?.to === "Graveyard") return { kind: "dies" };
    // (a noncreature token destroyed, by Forge's word: Wear's copy on a Clue read "Clue token leaves the battlefield",
    // Kykar #19)
    if (was.token && gone?.how === "destroyed") return { kind: "destroyed" };
    if (was.token && gone?.to === "Exile") return { kind: "exiled" };
    // (a token bounced: it goes to the hand and ceases to exist; sweep's Everywhere read "leaves the battlefield", hp-23)
    if (was.token && gone?.to === "Hand") return { kind: "tokenHand" };
    if (!was.token && gone?.to === "Library") return { kind: "library" };
    if (!was.token && !was.fd && toHand) return { kind: "hand" };
    // (a creature token gone in the combat damage step died: a token leaves no card in a graveyard, and a blocked
    // Phyrexian Mite read "leaves the battlefield", hp-11 gap)
    if (was.token && was.creature && /damage/i.test(cur.step || "")) return { kind: "dies" };
    if (was.token) return { kind: "tokens" };
    return { kind: "left" };
  };
  // What put a card into exile, decided once: its kind (EXILE_WORDS), whose line it is, and what the line names
  const exileKind = (id, c, from, was, moved) => {
    // (a prepared creature's spell copy: made there, never moved there; notePrepared)
    if (!from && c.prep) return { kind: "prepared", owner: c.owner, card: c.prepBy };
    // (its adventure resolved: the stack had it under the adventure's name, Stomp; read "is exiled", hp-02 #1)
    // (not a split or aftermath card, cast by its half's name, nor a face-down spell, suite review)
    const adventure = !c.name.includes("//") && !c.fd && Object.values(prev.stack).find((x) => x.id === id && x.name !== c.name && x.name !== "a face-down spell");
    // (a rebound spell off the stack comes back: Ephemerate read "Ephemerate is exiled", hp-09)
    const rebound = !adventure && c.rebound && Object.values(prev.stack).some((x) => x.id === id && !x.ability);
    // (a haunting card exiled from the graveyard says what it haunts, its own line, hp-20 gap)
    const haunted = from === "graveyard" && game.haunting?.has(id) && cur.cards[game.haunting.get(id)];
    if (haunted) return { kind: "haunt", owner: c.owner, card: haunted.name };
    // (and from a graveyard by what they paid for: delve's and escape's cards, one line each)
    if (from === "graveyard") return { kind: "graveyard", owner: was.owner, label: costWords(moved, c.name), cost: /^Cost:/.test(moved?.cause || ""), seq: facts?.firstSeq.get(id) };
    if (from === "battlefield" && !adventure && !rebound) return { kind: "battlefield", owner: "" };
    // (a hidden card exiled suspended: the Tenth Doctor's from the library read "Diabolic Tutor is exiled", hp-21 gap)
    if (!from && c.suspend && timeCounters(c)) return { kind: "suspended", owner: c.owner, n: timeCounters(c) };
    // (and from a library, up to what left it for no hand)
    if (!from && !adventure && !rebound && !c.plotted && (moved ? moved.from === "Library" : !fromStack(id, c) && millLeft[c.owner] > 0)) return { kind: "library", owner: c.owner };
    if (adventure) return { kind: "adventure", owner: c.owner, card: adventure.name };
    if (rebound) return { kind: "rebound", owner: c.ctl };
    // (plotted: Aven Interrupter's exiled spell read "Preordain is exiled", hiding that its owner may cast it free later,
    // hp-08 gap)
    if (c.plotted) return { kind: "plotted", owner: c.owner };
    // (a paradigm spell, exiled as it resolves: Improvisation Capstone read "is exiled", hp-23 gap)
    if (!from && /(?:^|\n)Paradigm \(/.test(pubIndex[id]?.text || "")) return { kind: "paradigm", owner: c.owner };
    // (from a hand to pay for another card: Fury's evoke read only "Sneak Attack is exiled", live game 2026-11-11. "To
    // cast" while that card is a spell on the stack; the keyword when the harness names one, not a cost part's class)
    if (!from && moved?.from === "Hand" && /^Cost:/.test(moved.cause || "") && moved.causeName && moved.causeName !== c.name) {
      const cast = [...Object.values(prev.stack), ...Object.values(cur.stack)].some((s) => !s.ability && s.name === moved.causeName);
      return { kind: "hand", owner: c.owner, card: moved.causeName, cast, kw: COST_KEYWORDS[moved.cause.slice(5)] || null };
    }
    return { kind: "plain", owner: c.owner };
  };
  const toGraveyard = (c) => out.push(`${c.name} is put into ${who(c.owner)}'s graveyard`);
  // (a return to the battlefield's words in brackets: its controller, or what brought it back (causeBy), with the
  // controller too when that isn't the zone's owner)
  const backBy = (moved, c, was) => {
    const by = causeBy(moved, c.name, c.pn, was.name);
    return !by ? who(c.ctl) : c.ctl === was.owner ? by : `${who(c.ctl)}, ${by}`;
  };
  const phased = [];
  // (an aura or equipment gone from the battlefield after the permanent it was on, by Forge's order, is said after the
  // others: "Pacifism goes to the graveyard" came before "Craw Wurm dies", Kykar re-test new bug 6)
  const seqOf = (x) => facts?.firstSeq.get(x);
  const afterHost = (id) => { const h = prev.cards[id]?.att; return !!h && prev.cards[id].zone === "battlefield" && cur.cards[id]?.zone !== "battlefield"
    && seqOf(h) != null && seqOf(id) != null && seqOf(h) < seqOf(id); };
  const arrivals = Object.entries(cur.cards);
  for (const [id, c] of [...arrivals.filter(([x]) => !afterHost(x)), ...arrivals.filter(([x]) => afterHost(x))]) {
    const was = prev.cards[id];
    // (one put onto the battlefield attacking was never declared: its arrival line says so instead; Hero of Bladehold's
    // Soldiers read "White attacks with Soldier Token, Soldier Token", hp-16 gap)
    // (by whom each attacks, a planeswalker, a battle or a player: in a game of two too, where "White attacks with Soldier
    // token" didn't say at whom, live game 2026-11-11)
    if (c.attacking && was?.zone === "battlefield" && !was.attacking) {
      const target = c.atc || c.atp || "";
      (attackers[`${c.ctl}|${target}`] ||= { ctl: c.ctl, target, names: [] }).names.push(tokenWords(c.name, c.token));
    }
    if (was && was.zone === c.zone && was.fd && !c.fd) out.push(`${c.name} is turned face up (${who(c.ctl)})`);
    // (the same card under another name on the battlefield: it transformed or became a copy; Growing Rites of Itlimoc becoming Itlimoc,
    // Cradle of the Sun logged nothing, hp-03 #3)
    else if (was && was.zone === c.zone && c.zone === "battlefield" && !was.fd && !c.fd && was.name !== c.name && !mutatedHosts.has(id)) out.push(`${was.name} becomes ${c.name}`);
    // (one that got counters too says so after them, below: Slip Out the Back puts its counter on first, and read
    // "phases out" then "gets a +1/+1 counter", Kykar #21)
    if (was && was.zone === c.zone && !was.po !== !c.po) {
      const countered = c.p1 !== was.p1 || c.m1 !== was.m1 || JSON.stringify(c.ctrs) !== JSON.stringify(was.ctrs);
      (countered ? phased : out).push(`${c.name} phases ${c.po ? "out" : "in"}`);
    }
    if (was && was.zone === c.zone) continue;
    const n0 = out.length;
    const from = was ? was.zone : null;
    const moved = facts?.moves.get(id);
    // (a spell off the stack that another spell targeted was countered: an instant or sorcery only under a counterspell,
    // since one under Twincast resolves; Counterspell on the Rats logged nothing, hp-01 #6; An Offer You Can't Refuse's
    // Opt, gap-04. Into a graveyard, or a commander into the command zone: Arcane Denial on Niv-Mizzet, rebuilt re-test)
    const countered = !from && (prevSpellOf.get(id)?.sids || []).some((sid) => (c.spell ? prevCounterTargeted : prevTargeted).has(sid));
    const exileCountered = !from && (prevSpellOf.get(id)?.sids || []).some((sid) => prevCounterTargeted.has(sid));
    if (facts && !moved) noteGuess("arrival", `${c.name}: ${from || "nowhere seen"} to ${c.zone}`);
    // (a land played, not put: by Forge's word, else by the record of a player's play)
    const landPlayed = moved ? moved.how === "played" : landPlays.has(id);
    // (an arrival with its +1/+1 counters: Mycoloth's devour and Indoraptor's undying put them on unsaid, hp-13)
    const withP1 = c.p1 ? ` with ${c.p1 === 1 ? "a +1/+1 counter" : `${c.p1} +1/+1 counters`}` : "";
    // (and an Aura or Equipment with what it is attached to: Changing Loyalty and its two replicate copies read only
    // "creates Changing Loyalty", hp-14 gap)
    // (and its -1/-1 counters: persist's return read "Kitchen Finks returns to the battlefield from White's graveyard
    // (White)", keyword sweep kw-10; a token's loyalty, which nothing printed shows: Empower's Jace token, kw-07)
    const others = [...(c.m1 ? [countWords(c.m1, c.m1, "-1/-1 counter")] : []), ...(c.token && c.loy ? [countWords(c.loy, c.loy, "loyalty counter")] : []),
      ...(c.ctrs || []).map(([k, n]) => countWords(n, n, counterWords(k.toUpperCase()) || `${k.toLowerCase()} counter`))].join(" and ");
    const arrive = `${withP1}${others ? `${withP1 ? " and" : " with"} ${others}` : ""}${c.attacking ? `, ${c.tapped ? "tapped and " : ""}attacking` : ""}${c.att && cur.cards[c.att] ? `, attached to ${cur.cards[c.att].name}` : ""}`;
    if (c.zone === "battlefield" && mutatedInto.has(id)) {
      const host = mutatedInto.get(id), under = prev.cards[host]?.name ?? cur.cards[host].name;
      out.push(`${c.name} mutates ${cur.cards[host].name === c.name && under !== c.name ? "onto" : "under"} ${under}`);
    } else if (c.zone === "battlefield") {
      // (a copy by its own name and what it copies, from anywhere: Spark Double back from a graveyard as Mairsil read
      // "Mairsil, the Pretender returns to the battlefield", rebuilt re-test)
      const [self, asCopy] = c.pn ? [c.pn, ` as ${c.name}`] : [c.name, ""];
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
          const robbed = bothStacks.find((s) => s.ctl === c.ctl && /\btarget (?:opponent|player)'s library\b/i.test(s.text || "") && s.plTg?.some((p) => p !== c.ctl));
          put.names.push(`${robbed ? `${who(robbed.plTg.find((p) => p !== c.ctl))}'s ` : ""}${c.name}`);
          out[put.at] = `${who(c.ctl)} puts ${listOf(put.names)} onto the battlefield${c.tapped ? " tapped" : ""}${arrive}`;
        }
      }
      // (the same tokens together, one line with their count: An Offer You Can't Refuse's two Treasures read "AI 1 creates
      // Treasure Token" twice, gap-04)
      // (a name with a comma is a legend's and has no plural: Saw in Half's copies read "White creates 2 Mairsil, the
      // Pretenders", rebuilt hand test #5)
      else if (c.token) {
        const made = (tokensMade[`${c.ctl}|${c.name}${arrive}`] ??= { at: out.length, n: 0 });
        made.n++;
        // (a copy token has only the copied card's name: Saw in Half's read "White creates Mairsil, the Pretender", rebuilt re-test;
        // Forge's own "Treasure Token" read so too, Arena says "a Treasure token", re-test 2 bug d)
        const base = tokenBase(c.name);
        out[made.at] = made.n === 1 ? `${who(c.ctl)} creates ${/^[aeiou]/i.test(base) ? "an" : "a"} ${base} token${arrive}`
          : `${who(c.ctl)} creates ${made.n} ${base} tokens${arrive}`;
      }
      // (brought back: Necromancy said nothing about what it returned, playtest 2026-10-26)
      else if (from === "graveyard" && c.land && landPlayed) out.push(`${who(c.ctl)} plays ${c.name} from ${who(was.owner)}'s graveyard${arrive}`);
      // (by what brought it back, Forge's word, its new controller too when that isn't the graveyard's owner: "Craw Wurm
      // returns to the battlefield from White's graveyard (Reanimate)", readability audit C1)
      else if (from === "graveyard") out.push(`${self} returns to the battlefield from ${who(was.owner)}'s graveyard${asCopy}${arrive} (${backBy(moved, c, was)})`);
      // (cast from exile: an adventurer, a foretold card, ... enters; read "returns ... from exile", hp-02 #3)
      // (a land played from exile is a play: Tibalt's read "returns to the battlefield from exile", re-test 2026-10-31)
      else if (from === "exile" && c.land && landPlayed) out.push(`${who(c.ctl)} plays ${c.name} from exile${arrive}`);
      else if (from === "exile") out.push(castNow.has(id) ? `${self} enters the battlefield${asCopy}${arrive} (${who(c.ctl)})` : `${self} returns to the battlefield from exile${asCopy}${arrive} (${backBy(moved, c, was)})`);
      // (face down: off the stack a face-down spell's creature, else put there (manifest, cloak); Abhorrent Oculus's
      // manifest dread read "a face-down card enters the battlefield (White)", hp-09)
      // (by cloak, from what just resolved: Unexplained Absence's read "AI 1 puts a card onto the battlefield face down",
      // hp-20 gap)
      else if (c.fd) out.push(fromStack(id, c) ? `A face-down creature enters the battlefield (${who(c.ctl)})`
        : cloaking ? `${who(c.ctl)} cloaks a card: a face-down 2/2 with ward {2}` : `${who(c.ctl)} puts a card onto the battlefield face down`);
      // (Clone as Bloodline Keeper read "Bloodline Keeper enters the battlefield", rebuilt hand test #10)
      else out.push(`${self} enters the battlefield${asCopy}${arrive} (${who(c.ctl)})`);
      // (tribute declined: it enters with none of its counters, or with others' and its trigger seen, which only that
      // trigger's "if tribute wasn't paid" told; keyword sweep kw-22. See tributeCard.)
      if (tributeCard(id, c) && (!c.p1 || tributeTrig(id))) sayTribute(id, c);
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
      // (a prepared creature's spell copy, from exile to the graveyard: cast and resolved unseen, prepCast)
      else if (from === "exile" && was.prep) prepCast(id);
      else if (from === "battlefield") {
        // (and what destroyed it or put it there, Forge's word: "Batterskull is destroyed by Krosan Grip", a creature
        // destroyed so too, "Grizzly Bears is destroyed by Murder"; one dead of its damage has no cause and "dies",
        // readability audit C1)
        const by = costWords(moved, c.name) ? null : causeBy(moved, c.name, was.name, was.pn);
        const kind = (moved ? moved.how === "sacrificed" : ownSacrifice) ? "sacrificed" : moved?.how === "destroyed" && by ? "destroyed"
          : was.creature ? "dies" : moved?.how === "destroyed" ? "destroyed" : "graveyard";
        // (by what it was on the battlefield, a copy with its own name: "Clone dies" for a Bloodline Keeper, "Fable of the
        // Mirror-Breaker dies" for Reflection of Kiki-Jiki, rebuilt hand test #10)
        // (a face-down one by the face the graveyard shows)
        const gone = was.fd ? c.name : was.pn ? `${was.name} (${was.pn})` : tokenWords(was.name, was.token);
        leave(c.owner, gone, { kind, label: kind === "sacrificed" ? sacrificeWords(moved, was) : costWords(moved, c.name), ...(by ? { by } : {}) });
      }
      else if (countered) out.push(`${castName(id, c)} is countered${counteredBy(id)}`);
      // (by one no board showed on the stack, or by an ability: said after that spell's cast, below)
      else if (!from && counteredOff(id, c, moved)) {
        if (moved?.from === "Stack" && !fromStack(id, c)) out.push(`${who(c.owner)} casts ${c.name}`);
        // (by the face cast: "Tibalt, Cosmic Impostor is countered", not its card's front, Valki)
        sayAfter(false, id, `${castName(id, c)} is countered${counteredBy(id)}`);
      }
      // (an epic spell resolved: its player's spells are gone for good, shown nowhere; Eternal Dominion, hp-23 gap)
      else if (!from && fromStack(id, c) && /(?:^|\n)Epic \(/.test(pubIndex[id]?.text || "")) out.push(`${who(c.owner)} can't cast spells for the rest of the game (epic); at each of their upkeeps, ${c.name} is copied`);
      // (off the stack by Forge's word with no board showing it there: an AI's spell resolved between two boards)
      else if (!from && moved?.from === "Stack" && !fromStack(id, c)) out.push(`${who(c.owner)} casts ${c.name}`);
      else if (!from && !discardedIds.has(id) && (moved?.from === "Library" || !fromStack(id, c))) {
        if (moved) {
          if (moved.from === "Library") milled(c.owner, c.name, libraryKind(moved));
          else toGraveyard(c);
        }
        // (the card whose ability its owner just used from the hand: discarded as the cost; Muddle the Mixture's transmute
        // and Lórien Revealed's cycling read "is put into White's graveyard", hp-17 hp-05)
        else if (abilityRecords.has(id)) out.push(HAND_WORDS.discard(who(c.owner), [c.name]));
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
    } else if (c.zone === "exile" && !from && (exileCountered || takenOff.get(id)?.how === "counter")) {
      // (a spell countered into exile, Dissipate's "exile it instead", or one with flashback: read "Craw Wurm is exiled",
      // keyword sweep kw-14. By a counterspell only: one that exiles a spell, Mindbreak Trap, doesn't counter it.)
      if (moved?.from === "Stack" && !fromStack(id, c)) out.push(`${who(c.owner)} casts ${c.name}`);
      sayAfter(exileCountered, id, `${castName(id, c)} is countered${counteredBy(id)} and exiled`);
    } else if (c.zone === "exile") {
      const k = exileKind(id, c, from, was, moved);
      // (exiled with a permanent, its counters and whether it comes back: Mairsil's cage read "Ancient Copper Dragon is
      // exiled", rebuilt hand test #1)
      // (not itself: Tithing Blade exiled to pay its own craft read "Tithing Blade is exiled with Tithing Blade", mechanic run hp-12)
      // (nor the card it was paid for, its cost's words name it: forage read "(to pay for Treetop Sentries) with Treetop
      // Sentries", live check 11)
      const host = c.ew && c.ew !== id && !(/^Cost:/.test(moved?.cause || "") && moved.causeName === cur.cards[c.ew]?.name) && cur.cards[c.ew];
      // (and what exiled it, Forge's word, unless a cost's words or the card it is exiled with name it already: "Elemental
      // token is exiled" after Swords to Plowshares named nothing, readability audit C1)
      const by = !k.label && causeBy(moved, c.name, was?.name);
      if (by && !(host && host.name === by) && ["graveyard", "battlefield", "library", "plain"].includes(k.kind)) k.label = ` by ${by}`;
      if (host && ["graveyard", "battlefield", "library", "plain"].includes(k.kind)) {
        const ctrs = (c.ctrs || []).map(([t, n]) => countWords(n, n, counterWords(t.toUpperCase()) || `${t.toLowerCase()} counter`)).join(" and ");
        k.label = `${k.label || ""} with ${host.name}${ctrs ? ` (${ctrs})` : ""}${c.rl ? `, until ${host.name} leaves the battlefield` : ""}`;
      }
      if (k.kind === "library") {
        millLeft[c.owner]--;
        if (game.exiledSaid?.delete(id)) continue;
      }
      if (EXILE_GROUPED.has(k.kind)) grouped(EXILE_WORDS, k.owner, c.name, k);
      else out.push(EXILE_WORDS[k.kind](who(k.owner), [c.name], k));
    } else if (c.zone === "command" && (from || countered)) {
      // (from the battlefield, how it left first, Forge's word or the graveyard it passed: Ral Zarek's 3 damage on Errant,
      // Street Artist read only "returns to the command zone", Kykar #13. "Is destroyed" only by Forge's word: a
      // planeswalker at 0 loyalty passes the graveyard undestroyed, checker 2026-11-07.)
      const how = from !== "battlefield" || !moved ? null : moved.how === "sacrificed" ? "is sacrificed"
        : moved.how === "destroyed" ? (was.creature ? "dies" : "is destroyed") : moved.through === "Graveyard" ? (was.creature ? "dies" : null)
        : moved.through === "Exile" ? "is exiled" : null;
      out.push(countered ? `${castName(id, c)} is countered${counteredBy(id)} and returns to the command zone` : `${c.name} ${how ? `${how} and returns` : "returns"} to the command zone`);
    } else if (c.zone === "command" && takenOff.get(id)?.how === "counter") sayAfter(false, id, `${castName(id, c)} is countered${counteredBy(id)} and returns to the command zone`);
    // (a spell that resolved in the turn just ended, on the board that began the next: its line before the turn header;
    // and one that took a spell seen on the stack then, cast in that turn too)
    if (turnBegan && out.length > n0 && !castNow.has(id) && (fromStack(id, c) || answeredOld.has(id))) oldTurn.push([n0, out.length]);
  }
  // (and a line said after, of a spell seen on the last board's stack, above a new turn's header with it: a Craw Wurm
  // countered at the end of the turn read under the next turn's header, suite review 2026-11-06)
  for (const [line, id] of later) {
    if (turnBegan && prevSpellOf.has(id)) oldTurn.push([out.length, out.length + 1]);
    out.push(line);
  }
  // (two permanents' text boxes swapped: both changed in one board as a spell that exchanges text boxes resolved, or each
  // now reads as the other did; Exchange of Words was in no log, rebuilt hand test #11)
  const retexted = Object.entries(cur.cards).filter(([id, c]) => c.tx != null && prev.cards[id]?.tx != null && c.tx !== prev.cards[id].tx);
  if (retexted.length === 2) {
    const [[a, ca], [b, cb]] = retexted;
    const swapper = Object.values(prev.stack).find((s) => /\bexchange\b[^.]*\btext box/i.test(s.text || "") && !s.sids.some((x) => curSids.has(x)));
    if (swapper || (ca.tx === prev.cards[b].tx && cb.tx === prev.cards[a].tx)) out.push(`${ca.name} and ${cb.name} exchange text boxes${swapper ? ` (${swapper.name})` : ""}`);
  }
  // (a word in a permanent's text changed by the spell that targeted it, just resolved: the first word that differs, as
  // it was and as it is; Mind Bend, Artificial Evolution and Sleight of Mind were in no log, mechanic run hp-25 2026-11-05)
  // (a target with no such word: Glamerdye on a Forest read "Forest's text changes (Glamerdye)", Forge having only
  // dropped its reminder, hp-25)
  const bare = (t) => withoutForgeNotes(String(t || "")).replace(/\s*\([^)]*\)/g, "").trim();
  for (const s of Object.values(prev.stack)) {
    if (!/\bchange the text of\b/i.test(s.text || "") || s.sids.some((x) => curSids.has(x))) continue;
    // (not a spell countered: a countered Mind Bend read "Mind Bend changes nothing in Bog Wraith's text" under its "is
    // countered", suite review 2026-11-05; one that fizzled can't be told from the boards and still says it)
    const countered = s.sids.some((x) => prevCounterTargeted.has(x)) || takenOff.get(s.id)?.how === "counter";
    for (const id of s.cardTg) {
      const c = cur.cards[id];
      if (c?.tx == null || prev.cards[id]?.tx == null) continue;
      const words = c.tx !== prev.cards[id].tx ? textChangeWords(prev.cards[id].tx, c.tx) : "";
      if (words || bare(c.tx) !== bare(prev.cards[id].tx)) out.push(`${c.name}'s text changes${words} (${s.name})`);
      else if (!countered) out.push(`${s.name} changes nothing in ${c.name}'s text`);
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
    // (a prepared creature's spell copy gone from exile is no card leaving it: cast (the stack's line, or prepCast's when
    // no board showed it there), gone with its creature, which ceased its copy, or unprepared with the creature still
    // there, Infinite Coursework's "It becomes unprepared"; notePrepared, HAND-TEST-HP06 #20)
    if (was.zone === "exile" && was.prep) {
      const mv = facts?.moves.get(id);
      if (onStack(cur.stack, id) || castNow.has(id) || cur.cards[was.prep]?.zone !== "battlefield") continue;
      if (mv?.from === "Stack" || mv?.to === "Stack") prepCast(id);
      else out.push(`${was.prepBy} becomes unprepared`);
      continue;
    }
    // (its owner by Forge's move first: the battlefield's view names the controller, see noteOwners)
    const o = facts?.moves.get(id)?.owner || was.owner;
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
    // (what moved it, Forge's word: "Grizzly Bears returns to AI 1's hand (Cyclonic Rift)", readability audit C1)
    const by = causeBy(gone, was.name, was.pn);
    if (was.zone === "battlefield") {
      const k = departureKind(id, was, gone, toHand);
      if (k.kind === "hand") handRoom[o] = Math.max(0, handRoom[o] - 1);
      leave(o, tokenWords(was.name, was.token), { ...k, ...(by ? { by } : {}) });
    } else if (gone && libraryKind(gone).kind === "dredge") {
      // (the dredged card, said in its dredge's line)
    } else if ((was.zone === "graveyard" || was.zone === "exile") && !was.fd && toHand) {
      handRoom[o] = Math.max(0, handRoom[o] - 1);
      out.push(LEAVE_WORDS.handFrom(who(o), [was.name], { from: was.zone === "exile" ? "exile" : "the graveyard", by }));
    }
  }
  // (a player's marks that changed, in PLAYER_MARKS' order, each row's `say` for every player: only between two boards
  // that both have the player, so a game's first board, or a player new to it, says nothing; `at` says whose turn
  // another player runs on this board and the one before, turnRuns)
  // (and for a mark only one player holds, the monarch's and the initiative's, `from`: the one player who held it on the
  // board before; `cause`: what gave it, the one spell or ability that resolved now whose words give it to that player,
  // "combat damage" for the mark's own combat trigger; `bearer`: the player's Ring-bearer on this board. Readability
  // audit C6, C7, 2026-11-12)
  // (by what it does, its trigger condition left out: the Initiative's own "Whenever you take the initiative ..., venture
  // into Undercity" gives none)
  // (and one that gives it to another player only when it concerns this one: it targets the player or a card they
  // control, or it targets nothing and is the mark's own combat trigger, its holder's, `from`; a "target opponent
  // becomes the monarch" at someone else, resolving with a combat change, named the wrong card, review 2026-11-12)
  const markCause = (p, re, from) => {
    const does = (s) => String(s.text || "").replace(/^(?:When|Whenever|At)\b[^,]*,\s*/i, "");
    const mine = (s) => s.plTg.includes(p) || s.cardTg.some((id) => (cur.cards[id] || prev.cards[id])?.ctl === p)
      || (!s.plTg.length && !s.cardTg.length && from != null && s.ctl === from && /\bcombat damage\b/i.test(s.text || ""));
    const by = resolved.filter((s) => (re.you.test(does(s)) ? s.ctl === p : re.other.test(does(s)) && mine(s)));
    return by.length !== 1 ? null : /\bcombat damage\b/i.test(by[0].text) ? "combat damage" : by[0].name;
  };
  const MARK_GIVERS = { monarch: { you: /\byou become the monarch\b/i, other: /\bbecomes the monarch\b/i },
    initiative: { you: /\byou take the initiative\b/i, other: /\btakes the initiative\b/i } };
  for (const row of PLAYER_MARKS) if (row.say) for (const [p, now] of Object.entries(cur.marks || {})) {
    const was = prev.marks?.[p];
    if (!was || now[row.key] === was[row.key]) continue;
    const held = typeof now[row.key] === "boolean" ? Object.keys(prev.marks || {}).filter((q) => q !== p && prev.marks[q]?.[row.key] === true && !cur.marks[q]?.[row.key]) : [];
    const bearer = Object.values(cur.cards).filter((c) => c.rb && c.ctl === p && c.zone === "battlefield").map((c) => tokenWords(c.name, c.token));
    const line = row.say(who(p), now[row.key], was[row.key], { turnRun: cur.turnRun?.[p], wasTurnRun: prev.turnRun?.[p],
      from: held.length === 1 ? who(held[0]) : null, cause: MARK_GIVERS[row.key] ? markCause(p, MARK_GIVERS[row.key], held.length === 1 ? held[0] : null) : null, bearer: bearer.length === 1 ? bearer[0] : null });
    if (!line) continue;
    // (the initiative before the venture it made, said earlier in this board: the swap keeps every line's index, which
    // the lines written by index at the end hold)
    const venture = row.key === "initiative" ? out.findIndex((x) => typeof x === "string" && x.startsWith(`${who(p)} ventures into `) && x.endsWith(" (Undercity)")) : -1;
    if (venture >= 0) { out.push(out[venture]); out[venture] = line; } else out.push(line);
  }
  // (the rooms ventured into: after the marks, as taking the initiative ventures too)
  for (const [id, c] of Object.entries(cur.cards)) if (c.room && prev.cards[id]?.room !== c.room) {
    const line = `${who(c.owner)} ventures into ${c.room} (${c.name})`;
    if (!out.includes(line) && !triggered.includes(line)) out.push(line);
  }
  // (Planechase: the die's roll once, by its sequence number, whichever seat's board brings it; then the planeswalk it
  // caused, or any other: by the planes in play changing, not by the plane card's zone, which follows the active
  // player's command zone every turn)
  if (cur.planar?.roll && cur.planar.roll.seq !== prev.planar?.roll?.seq) out.push(`${who(cur.planar.roll.playerId)} rolls the planar die: ${cur.planar.roll.result}`);
  if (cur.planar && prev.planar && cur.planar.ids.join("|") !== prev.planar.ids.join("|")) {
    const name = (id) => cur.cards[id]?.name || prev.cards[id]?.name || game.namesSeen?.get(id) || "a plane";
    const left = prev.planar.ids.filter((id) => !cur.planar.ids.includes(id) && prev.cards[id]?.planar === "plane");
    for (const id of cur.planar.ids.filter((x) => !prev.planar.ids.includes(x))) {
      const by = who(cur.planar.controller || cur.active);
      out.push(cur.cards[id]?.planar === "phenomenon" ? `${by} encounters ${name(id)}`
        : `${by} planeswalks to ${name(id)}${left.length ? ` (from ${left.map(name).join(" and ")})` : ""}`);
    }
  }
  // (day and night: Brutal Cathar made it day with nothing shown or logged, playtest 2026-10-26)
  if (cur.day !== prev.day && (cur.day === "day" || cur.day === "night")) out.push(`It becomes ${cur.day}`);
  // ("White attacks Jace Beleren (AI 1) with Hero of Bladehold"; whom by the attack target Forge names, a planeswalker or
  // battle by its name and controller, a player by name)
  const attacked = (id) => {
    if (!id) return null;
    if (/^player-/.test(id)) return who(id);
    const d = cur.cards[id] || prev.cards[id];
    return d ? `${d.name} (${who(d.ctl)})` : null;
  };
  const attackLines = Object.values(attackers).map(({ ctl, target, names }) => {
    const whom = attacked(target);
    return `${who(ctl)} attacks ${whom ? `${whom} ` : ""}with ${tokensCounted(names)}`;
  });
  // blocks, which the table draws as lines and the log never said (Fog Bank blocking Cavalry Master, hp-10 gap): each
  // attacker's new blockers, one line per attacker. Tokens are counted ("2 Soldier tokens block a Zombie token", token
  // stacks spec: the real table read "Soldier Token, Soldier Token block Zombie Token"), and the same block on several
  // tokens of one kind is one line ("2 Zombie tokens are blocked by a Soldier token each").
  const newBlocks = {};
  for (const [b, at] of Object.entries(cur.blocks || {})) for (const a of at) if (!(prev.blocks?.[b] || []).includes(a) && cur.cards[b] && cur.cards[a]) (newBlocks[a] ||= []).push(b);
  const blockLines = new Map(); // what is said of one attacker -> { n: how many attackers it is said of, line, subject, a }
  for (const [a, bs] of Object.entries(newBlocks)) {
    const at = cur.cards[a];
    const tokens = at.token || bs.some((b) => cur.cards[b].token);
    // (no token in it: the line as it always read, "Wall of Air, Coral Barrier block Herald of Hoofbeats")
    const subject = tokens ? tokensCounted(bs.map((b) => tokenWords(cur.cards[b].name, cur.cards[b].token)), true) : bs.map((b) => cur.cards[b].name).join(", ");
    const line = `${subject} ${bs.length > 1 ? "block" : "blocks"} ${at.token ? tokensCounted([tokenWords(at.name, true)], true) : at.name}`;
    const key = at.token ? `${subject}|${at.name}` : `${line}|${a}`;
    const was = blockLines.get(key);
    if (was) was.n++; else blockLines.set(key, { n: 1, line: line.charAt(0).toUpperCase() + line.slice(1), subject, a });
  }
  for (const { n, line, subject, a } of blockLines.values()) {
    out.push(n === 1 ? line : `${n} ${tokenWords(cur.cards[a].name, true)}s are blocked by ${subject} each`);
  }
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
    // (a tribute's trigger seen a board after its card arrived: see tributeCard)
    if (c.zone === "battlefield" && was?.zone === "battlefield" && tributeCard(id, c) && tributeTrig(id)) sayTribute(id, c);
    // (attached to something new while it stays: For Mirrodin!'s Equipment onto its Rebel, an equip; Hexplate Wallbreaker
    // read "creates Rebel Token" and nothing of the attach, hp-16 gap)
    if (c.zone === "battlefield" && was?.zone === "battlefield" && c.att && c.att !== was.att && cur.cards[c.att]) out.push(`${c.name} is attached to ${cur.cards[c.att].name}`);
    // (a new controller: Volatile Stormdrake's exchange with Precinct Captain was never said, hp-16 gap)
    // (from whom, and by what: the one spell or ability that resolved now whose words take or exchange control, targeting
    // this card or no card; "White gains control of Island" named neither Expropriate nor AI 1, readability audit C6. A
    // control given back as an effect ends has no such cause and names only from whom. The card that is the ability's
    // own source counts as targeted: Volatile Stormdrake's exchange targets only the other creature, review 2026-11-12)
    if (c.zone === "battlefield" && was?.zone === "battlefield" && c.ctl !== was.ctl) {
      const by = resolved.filter((s) => /\b(?:gains?|exchange) control\b/i.test(s.text || "") && (s.cardTg.includes(id) || s.id === id || !s.cardTg.length));
      out.push(`${who(c.ctl)} gains control of ${c.name} from ${who(was.ctl)}${by.length === 1 ? ` (${by[0].name})` : ""}`);
    }
    // (and its other counters, gained or lost, with how many are left: Tangle Wire's fading took a fade counter off each
    // upkeep and the log said nothing, hp-14 gap)
    if (c.zone === "battlefield" && was?.zone === "battlefield") {
      const now = Object.fromEntries(c.ctrs || []), then = Object.fromEntries(was.ctrs || []);
      for (const k of new Set([...Object.keys(now), ...Object.keys(then)])) {
        const d = (now[k] || 0) - (then[k] || 0), noun = counterWords(k.toUpperCase()) || `${k.toLowerCase()} counter`;
        if (d) out.push(`${c.name} ${d > 0 ? "gets" : "loses"} ${countWords(Math.abs(d), Math.abs(d), noun)} (${now[k] || 0} ${d > 0 ? "in all" : "left"})`);
      }
    }
    // (and loyalty an effect puts on, not its own ability's cost, which that ability's line says: a second Empower on the
    // Jace token said nothing, the table showing Loyalty 4, keyword sweep kw-07)
    // (its own ability: the player's record of it, or the ability seen on a stack. The state counts no loyalty
    // activations, so an AI's +1 that resolved between two boards is told by its timing: a rise of one of its own "+N:"
    // costs, in its controller's main phase, no spell gone from the stack with it, the first such rise this turn, as a
    // planeswalker activates once a turn. An AI Chandra's 4 to 5 read "gets a loyalty counter (5 in all)", checker
    // 2026-11-07. A proliferate or the like that fits all of that is taken for the ability and not said.)
    if (c.zone === "battlefield" && was?.zone === "battlefield" && (c.loy || 0) > (was.loy || 0)) {
      const n = c.loy - (was.loy || 0);
      const own = pending.some((e) => e.id === id && e.kind !== "cast") || bothStacks.some((s) => s.id === id && s.ability);
      const plusCosts = [...String(pubIndex[id]?.text || "").matchAll(/(?:^|\n)\[?\+(\d+)\]?:/g)].map((m) => Number(m[1]));
      const spellGone = (facts?.offStack || []).some((o) => cur.cards[o.id]?.spell) || [...prevSpellOf.keys()].some((sid) => !stackIds.has(sid));
      const unseenOwn = !own && plusCosts.includes(n) && cur.active === c.ctl && cur.turn === prev.turn && /^main/i.test(cur.step || "")
        && !spellGone && game.ownLoyalty?.get(id) !== cur.turn;
      if (own || unseenOwn) (game.ownLoyalty ??= new Map()).set(id, cur.turn);
      else out.push(`${tokenWords(c.name, c.token)} gets ${countWords(n, n, "loyalty counter")} (${c.loy} in all)`);
    }
  }
  // (what a resolved "taps an untapped ..." made its player tap: Tangle Wire's upkeep taps read nothing, hp-14 gap)
  for (const s of Object.values(prev.stack)) {
    if (s.sids.some((x) => curSids.has(x)) || !/\btaps? an untapped\b/i.test(s.text || "")) continue;
    const by = {};
    for (const [id, c] of Object.entries(cur.cards)) if (c.zone === "battlefield" && c.tapped && prev.cards[id]?.zone === "battlefield" && !prev.cards[id].tapped) (by[c.ctl] ||= []).push(c.name);
    for (const [ctl, names] of Object.entries(by)) out.push(`${who(ctl)} taps ${names.join(", ")} (${s.name})`);
  }
  const tapLines = tapNews(prev, cur, resolved);
  out.push(...phased, ...tapLines);
  // (what else gives or takes life, lifeSources: what resolved, by its room for a dungeon's; a room just entered with
  // no stack item of it, by the dungeon card's words for it; a "Pay N life:" cost just put on the stack)
  const roomsOnStack = new Set(bothStacks.map((s) => s.room).filter(Boolean));
  const lifeFrom = [...resolved.map((s) => ({ ...s, w: s.room || s.name })),
    ...Object.entries(cur.cards).filter(([id, c]) => c.room && prev.cards[id]?.room !== c.room && !roomsOnStack.has(c.room)).flatMap(([id, c]) => {
      const words = String(pubIndex[id]?.text || "").split("\n").map((x) => x.trim()).find((x) => x.startsWith(`${c.room} — `));
      return words ? [{ text: words.slice(c.room.length + 3), ctl: c.owner, w: c.room }] : [];
    }),
    ...Object.values(cur.stack).filter((s) => s.ability && s.sids.some((x) => !prevSids.has(x))).flatMap((s) => {
      const n = /^[^:.]*\bPay (\d+) life\b[^:.]*:\s/i.exec(s.text || "")?.[1];
      return n ? [{ text: `You lose ${n} life.`, ctl: s.ctl, gone: s.sids.filter((x) => !prevSids.has(x)).length, w: `paid for ${s.name}` }] : [];
    })];
  // (each life change with what made it, when what the boards and the player's answers show adds up to it, each part by
  // its words; else bare, as no source is guessed: the pain lands and life paid above, pains and payable)
  for (const [p, l] of Object.entries(cur.life)) {
    const before = prev.life[p];
    if (before == null || l === before) continue;
    const pain = l < before ? pains.filter((t) => t.slot === p) : [];
    const paid = l < before ? payable.filter((x) => x.slot === p) : [];
    if (paid.length) game.lifePays = game.lifePays.filter((x) => !paid.includes(x));
    const parts = [...(damage.gain[p] || []), ...[...(damage.loss[p] || []), ...pain.map((t) => ({ n: t.n, w: `damage from ${t.name}` })),
      ...paid.map((x) => ({ n: x.n, w: `paid for ${x.name}` }))].map((x) => ({ n: -x.n, w: x.w }))];
    parts.push(...lifeSources(p, l - before - parts.reduce((a, x) => a + x.n, 0), lifeFrom, Object.keys(cur.life), prev));
    const why = parts.length && parts.reduce((a, x) => a + x.n, 0) === l - before ? `, ${lifeWords(parts)}` : "";
    out.push(`${who(p)}: ${before} -> ${l} life (${l > before ? "+" : ""}${l - before}${why})`);
  }
  out.push(...triggered, ...afterResolved);
  // (each group's line made once and kept on it, for the moves after the cuts below to find)
  for (const g of Object.values(groups)) out[g.at] = g.line = g.words[g.k.kind](who(g.owner), g.names, g.k);
  for (const [n, g] of Object.entries(p1Gains)) {
    const what = `${n === "1" ? "a" : n} +1/+1 counter${n === "1" ? "" : "s"}`;
    out[g.at] = g.names.length === 1 ? `${g.names[0]} gets ${what}` : `${byCount(g.names)} each get ${what}`;
  }
  // (last: the lines above are written by index. What resolved in the turn just ended goes above the new turn's header:
  // the AI's Sensei's Divining Top "entered" after White's turn header, re-test 2 bug i; the new turn's own lines, its
  // draw, stay under it. The attack's place is found by identity, so neither these cuts nor the discard's insert above
  // move it; the discard's insert is the only line put in mid-list, and it shifts the one index kept before it, drawAt.)
  const oldLines = oldTurn.flatMap(([a, b]) => out.slice(a, b));
  for (const [a, b] of oldTurn.reverse()) out.splice(a, b - a);
  out.splice(out.indexOf(attackSlot), 1, ...attackLines);
  out.unshift(...oldLines);
  // (each line a sentence: "a face-down card is exiled" began in lower case, hp-16)
  const lines = out.map(sentence);
  // (a cost paid from a graveyard before the draw it paid for, by Forge's order, said before that draw: forage's exile
  // read after "White draws a card", live check 11. By the lines themselves, all indexes being spent. Each group by its
  // own first move: a Treasure's sacrifice before the draw moved a delve after it above it too, checker 2026-11-07.)
  for (const g of Object.values(groups)) {
    const drawn = drawLines[g.owner];
    if (!g.k.cost || !drawn || !(g.seq < facts?.firstDraw[g.owner])) continue;
    const from = lines.indexOf(sentence(g.line)), to = lines.indexOf(sentence(drawn));
    if (to >= 0 && from > to) lines.splice(to, 0, ...lines.splice(from, 1));
  }
  // (a resolved spell's untap said before the draw its own text puts after it, the draw being that spell's by Forge and
  // the board's only player to draw: "AI 1 draws 2 cards" came before "Make It So untaps Karn's Bastion", Kykar re-test
  // new bug 6)
  const drewNow = Object.keys(facts?.draws || {});
  if (drewNow.length === 1 && drawLines[drewNow[0]]) for (const s of resolved) {
    const t = String(s.text || ""), u = t.search(/\buntap\b/i), d = t.search(/\bdraws?\b/i);
    if (u < 0 || d < 0 || u > d || !(facts.drawsBy.get(s.id) > 0)) continue;
    for (const l of tapLines.filter((x) => x.startsWith(`${s.name} untaps `)).map(sentence)) {
      const from = lines.indexOf(l), to = lines.indexOf(sentence(drawLines[drewNow[0]]));
      if (to >= 0 && from > to) lines.splice(to, 0, ...lines.splice(from, 1));
    }
  }
  // (sources sacrificed for mana, for updateLog to add to the line before when they are paid one click a board)
  const sac = Object.values(groups).find((g) => g.k.kind === "sacrificed" && g.k.label === " for mana");
  if (sac) {
    lines.manaSac = { names: sac.names, line: sentence(sac.line) };
    // (said before the cast it paid for: the last Treasure clicked lands on the cast's board, and real TTS read "Treasure
    // token ×3 are sacrificed for mana", "White casts Inspiration", "Treasure token is sacrificed for mana", 2026-11-05)
    const at = lines.indexOf(lines.manaSac.line), cast = lines.findIndex((l) => / casts /.test(l));
    if (cast >= 0 && cast < at) lines.splice(cast, 0, ...lines.splice(at, 1));
  }
  // (each player's draw line, how many and by what, and whether that card is still on the stack: for updateLog to join
  // the draws of one spell a question split over two boards)
  lines.draws = {};
  for (const [owner, line] of Object.entries(drawLines)) {
    const by = facts?.drawCause[owner];
    if (by) lines.draws[owner] = { line: sentence(line), n: facts.draws[owner], by, onStack: Object.keys(cur.stack).some((k) => k.startsWith(`${by}|`)) };
  }
  // (the cards of the spells said to be countered on this board, see counteredBy)
  lines.countered = [...counteredIds];
  return lines;
}
const sentence = (l) => (l ? l[0].toUpperCase() + l.slice(1) : l);

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
  const cur = logSnapshot(pub, game.logPrev);
  // (every public card's name this game, for a card gone from all zones: see cname)
  game.namesSeen ??= new Map();
  // (a face-down card's name here is already "a face-down card": logSnapshot hides it)
  for (const [id, c] of Object.entries(cur.cards)) game.namesSeen.set(id, c.name);
  // (every card seen in a command zone this game: a commander, for the legend rule's choice; see chooseCards)
  game.commandIds ??= new Set();
  for (const [id, c] of Object.entries(cur.cards)) if (c.zone === "command") game.commandIds.add(id);
  const prev = game.logPrev;
  game.logPrev = cur;
  const facts = engineFacts(pub.events);
  // (battlefield to exile, for the table's exile sound: see sendTable's exd)
  for (const [id, mv] of facts?.moves || []) if (mv.from === "Battlefield" && mv.to === "Exile") (game.fxExiled ??= new Set()).add(id);
  if (!prev) return;
  const lines = logEvents(prev, cur, pub, facts);
  // (the spells countered, for the table's COUNTERED pop-up: see sendTable's ctrd)
  for (const id of lines.countered || []) (game.fxCountered ??= new Set()).add(id);
  flashNews(prev, cur, pub);
  if (!lines.length) return;
  if (game.heldLines?.length) { clearTimeout(game.heldTimer); lines.push(...game.heldLines.splice(0)); }
  game.log ??= [];
  // (Treasures paid for one spell one click at a time read four "Treasure token is sacrificed for mana" lines, re-test 2
  // bug c: a board whose first line is more of them, right after the last such line, joins that line, and the table's
  // log is sent again)
  const last = game.lastManaSac;
  game.lastManaSac = lines.manaSac || null;
  const joined = last && lines.manaSac && lines[0] === lines.manaSac.line && game.log.at(-1) === last.line;
  // (the file can't take a line back: a joined line is written again, saying which one it stands for)
  const rewritten = [];
  if (joined) {
    const names = [...last.names, ...lines.manaSac.names];
    game.lastManaSac = { names, line: sentence(LEAVE_WORDS.sacrificed("", names, { label: " for mana" })) };
    game.log[game.log.length - 1] = game.lastManaSac.line;
    rewritten.push(`${game.lastManaSac.line} (in place of "${last.line}")`);
    lines.shift();
  }
  // (one spell's draws split over two boards by a question between them, the spell still on the stack in the first: one
  // line. Village Rites' two read "draws a card" twice when a Darkblast in the graveyard asked "dredge?" between them,
  // live_events_check 2026-11-09. Only when nothing was logged after that board's lines (lastDraws.end, the log's
  // length then): a line said in between, a choice or a reveal, came after the first draw, and a join would put the
  // second above it.)
  const lastDraws = game.lastDraws?.end === game.log.length ? game.lastDraws : null;
  const draws = lines.draws || {};
  let drawJoined = false;
  for (const [owner, d] of Object.entries(draws)) {
    const was = lastDraws?.draws[owner];
    if (!was || !was.onStack || was.by !== d.by) continue;
    const at = game.log.lastIndexOf(was.line);
    const i = lines.indexOf(d.line);
    if (at < 0 || i < 0) continue;
    const n = was.n + d.n;
    game.log[at] = sentence(HAND_WORDS.draw(nameOf(owner), n));
    rewritten.push(`${game.log[at]} (in place of "${was.line}")`);
    lines.splice(i, 1);
    // (and joined again if a third board goes on drawing for it)
    draws[owner] = { ...d, line: game.log[at], n };
    drawJoined = true;
  }
  game.log.push(...lines);
  gameLogFile([...rewritten, ...lines]);
  if (game.log.length > 300) game.log.splice(0, game.log.length - 300);
  game.lastDraws = { end: game.log.length, draws };
  toTTS(joined || drawJoined ? { t: "gamelog", lines: game.log.slice(-60), reset: true } : { t: "gamelog", lines });
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
    const st = { n: c.n, f: shortUrl(c.f), b: shortUrl(c.b), o2: shortUrl(c.o2), n2: c.n2, tl: c.tl, cmc: c.cmc, ty: c.ty, tok: c.tok, bp: c.bp, bt: c.bt };
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
    const { n, f, b, o2, n2, tl, cmc, tx, ty, tok, bp, bt, ...dyn } = c;
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

// A player row's dungeon, from Forge's dungeonState (docs/planechase-dungeon-engine-spec.md D5-D7): `dungeon` {id, name,
// room, next, text}, the room's text and the rooms it leads to from the state's room list (the first room when it is in
// none yet), and `dungeonsDone`, the dungeons completed (left out at 0). The card's id from the state, else the dungeon
// of that name in the player's command zone (an engine that sends no id, nor rooms: then next and text are empty).
function dungeonRow(p, command) {
  const out = {};
  const ds = p.dungeonState;
  if (ds?.name) {
    const rooms = Array.isArray(ds.rooms) ? ds.rooms.filter((r) => r && r.name) : [];
    const room = String(ds.room || "");
    const here = room ? rooms.find((r) => r.name === room) : null;
    const id = ds.cardId || (command || []).find((c) => c.identity?.name === ds.name)?.id || null;
    out.dungeon = { id, name: String(ds.name), room, next: (room ? here?.next || [] : rooms.length ? [rooms[0].name] : []).map(String),
      text: String(here?.text || "") };
  }
  const done = Array.isArray(p.completedDungeons) ? p.completedDungeons.length : 0;
  if (done > 0) out.dungeonsDone = done;
  return out;
}
// The words on the dungeon card itself (the table's room box, `dg`; its tooltip `dgt`, the room's text):
// "ROOM: Goblin Lair" / "NEXT: Storeroom or Dark Pool" (or "LAST ROOM") / "COMPLETED: 1"
function dungeonLabel(d, done) {
  const lines = [d.room ? `ROOM: ${d.room}` : "NO ROOM YET"];
  if (d.next.length) lines.push(`${d.room ? "NEXT" : "FIRST"}: ${d.next.join(" or ")}`);
  else if (d.room && d.text) lines.push("LAST ROOM");
  if (done > 0) lines.push(`COMPLETED: ${done}`);
  return { dg: lines.join("\n"), ...(d.text ? { dgt: `${d.room} — ${d.text}` } : {}) };
}

function sendTable() {
  if (!game?.started || game.autoplay || !game.fromTable) return; // (other games get the text board, sendView)
  const seats = [...game.seats.values()].filter((s) => s.board?.state?.gameView);
  if (!seats.length) return;
  const pub = seats[0].board.state.gameView;
  // blocker id -> the attackers it blocks (the table draws a line to each)
  const blockers = new Map();
  for (const a of pub.combatAssignments || []) blockers.set(a.blockerId, [...(blockers.get(a.blockerId) || []), a.attackerId]);
  const toCard = (c) => tableCard(c, { blockers });
  trackTurns(pub, seats);
  updateLog(pub);
  const rewind = rewindNews(pub);
  fixNews(pub);
  const byId = cardIndex(pub);
  game.delayedNow = delayedOf(pub); // (the delayed triggers' words on their cards: tableCard, cardNotes)
  const views = seats.map((s) => cardIndex(s.board.state.gameView));
  for (const s of seats) noteTypes(s.board.state.gameView); // (before the stack below: its instants)
  // (Planechase: the planes and phenomena in play come out of the command zones, which they follow the active player
  // through, into the board's own planes list; the table draws them at its centre)
  const planeCards = (pub.zones || []).filter((z) => z.zone === "command").flatMap((z) => (z.cards || []).filter(isPlanarCard));
  const planeIds = new Set(planeCards.map((c) => c.id));
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
      // the marks under the life total (allMarks: PLAYER_MARKS, playerMarks)
      ...playerMarks(p, pub),
      cmdDamage,
      // Commander tax per commander, in command-zone order (casts × 2).
      tax: Object.values(p.commanderCasts || {}).map((n) => 2 * (n || 0)),
      library: zoneOf(pub, "library", p.id).count,
      handCount: zoneOf(pub, "hand", p.id).count,
      // in a hand a card shows the plain back: TTS shows the other players a hand card's back, and a double-faced
      // card's back is its other face (playtest 2026-10-25: a daybound card in Yellow's hand showed its night side)
      hand: own ? zoneOf(own, "hand", p.id).cards.map((c) => ({ ...toCard(c), b: DEFAULT_BACK })) : null,
      battlefield: zoneOf(pub, "battlefield", p.id).cards.map((c) => tableCard(c, { blockers, active: pub.activePlayerId, zone: "battlefield", views })),
      graveyard: zoneOf(pub, "graveyard", p.id).cards.map((c) => tableCard(c, { blockers, zone: "graveyard" })),
      exile: zoneOf(pub, "exile", p.id).cards.map((c) => tableCard(c, { blockers, zone: "exile" })),
      command: command.filter((c) => !planeIds.has(c.id)).map((c) => tableCard(c, { blockers, zone: "command" })), // (zone: a commander's tax, costNow)
      ...dungeonRow(p, command),
    };
    // (the dungeon card's own label, its room, where it leads and the dungeons completed: dungeonRow)
    if (row.dungeon?.id) row.command = row.command.map((c) => (c.id === row.dungeon.id ? { ...c, ...dungeonLabel(row.dungeon, row.dungeonsDone) } : c));
    // (after the zones: the cards a seat may play from outside its hand, built once; none once the game is over: Sen
    // Triplets' stand-ins kept glowing as playable under GAME OVER, real-table check 2026-11-10)
    const playable = own && !pub.gameOver ? playableOf(own, (c, zone) => tableCard(c, { blockers, zone }), p.id) : [];
    if (playable.length) row.playable = playable;
    // (and the hand cards shown to everyone: the table lays them face up at the owner's seat)
    const revealed = revealedOf(p, seats, toCard);
    if (revealed.length) row.revealed = revealed;
    // (a player a seat controls: its hand as the controller's view shows it, for the controller's second hand zone only;
    // Mindslaver's turn left White playing AI 1 blind, Kykar re-test new bug 1)
    const ctl = p.controlledBy && p.controlledBy !== p.id && seats.find((s) => s.slot === p.controlledBy);
    const ctlHand = ctl ? zoneOf(ctl.board.state.gameView, "hand", p.id).cards.filter((c) => c.identity?.name) : [];
    if (ctlHand.length) { row.ctlHand = ctlHand.map((c) => ({ ...toCard(c), b: DEFAULT_BACK })); row.ctlBy = ctl.color; }
    return row;
  });
  // TTS decodes JSON slowly (~70 ms per full board, felt as a hitch every update). A card's fixed details (name,
  // pictures, type line, rules text) go out once in `cards`; zone lists then carry only what changes (tapped,
  // counters, damage, ...) plus s:1 meaning "details as sent before". A reload (hello) or new game resends all.
  const { slim, statics } = slimmer(game);
  for (const pl of players) for (const z of ZONE_KEYS) if (pl[z]) pl[z] = pl[z].map(slim);
  const planar = planarRow(pub);
  const planes = planeCards.map((c) => slim({ ...toCard(c), ctl: planar?.controller || game.slotColor[c.controllerId] || null }));
  const stack = (pub.stack || []).map((s) => ({
    // (its text without Forge's card numbers: stackText)
    id: s.id, n: s.identity?.name || "?", tx: stackText(s), ctl: game.slotColor[s.controllerId] || null,
    src: s.sourceId || null, spell: !s.sourceAbilityText, // a spell's card is its source: the table moves that card
    ...(isSpellOfType(s, pub, "Instant") ? { ins: true } : {}), // (an instant spell: the table's instant sound)
    ...(isSpellOfType(s, pub, "Sorcery") ? { sor: true } : {}), // (a sorcery spell: the table's sorcery sound)
    // (a spell that isn't `spell`, its spell text read as an ability's: an instant or a sorcery; the table's COUNTERED
    // pop-up takes either)
    ...(s.sourceAbilityText && !isAbilityOnStack(s, pub) ? { sp: true } : {}),
    // what it targets, for the target lines: a player's colour, a card id or another stack item's id
    tg: (s.targets || []).map((t) => (t.kind === "player" ? { k: "p", c: game.slotColor[t.id] || null } : { k: t.kind === "spell" ? "s" : "c", id: t.id }))
      .filter((t) => t.c || t.id),

    // (a spell's picture is its card's, sourceId; the owner's printing)
    f: pictureOf(s.identity?.name, { id: s.sourceId || s.id, ownerId: s.ownerId }),
  }));
  const tableMsg = {
    t: "table", turn: pub.turn, step: pub.step, active: game.slotColor[pub.activePlayerId] || null,
    activeTurnNo: game.turnsTaken?.[pub.activePlayerId] || 1,
    priority: game.slotColor[pub.priorityPlayerId] || null, gameOver: !!pub.gameOver,
    ...(pub.gameOver ? { overWhy: gameEndWords(pub) } : {}), // (why it ended, on the top bar: Kykar hand test #16)
    ...(pub.dayTime === "day" || pub.dayTime === "night" ? { day: pub.dayTime } : {}), // (shown beside the turn on the table)
    winner: pub.winnerId ? game.slotColor[pub.winnerId] || nameOf(pub.winnerId) : null, players, stack, cards: statics,
    rewind, // restore points and the open vote (in the board update: a message of its own doubled the traffic)
    ...(planes.length || planar ? { planes, planar } : {}), // (Planechase: planarRow)
    ...(game.fix ? { fix: fixState() } : {}), // (a manual fix under way, PLAN M7)
  };
  // An update identical to the last one costs TTS a decode and a redraw for nothing (and feeds its GC pauses).
  const sig = JSON.stringify(tableMsg);
  if (sig === game.lastTableSig) return;
  game.lastTableSig = sig;
  // (after a rewind or a resend: the table plays no effects for this board. Left out of the signature: the board after
  // it, the same but for the flag, would go out again for nothing)
  if (game.fxJump) tableMsg.jump = true;
  // (and the cards gone from the battlefield to exile since the last board sent, by the engine's word: a token exiled
  // ceases to exist and no board shows it in exile, so the table's exile sound would read it as a death. Out of the
  // signature too; cleared once sent)
  if (game.fxExiled?.size) tableMsg.exd = [...game.fxExiled];
  // (and the cards of the spells the log said were countered since the last board sent: the table's COUNTERED pop-up
  // and countered effect go by these, the stack telling no counter's target. Out of the signature; cleared once sent)
  if (game.fxCountered?.size) tableMsg.ctrd = [...game.fxCountered];
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
  // The restore points the same as in the last board sent are left out, the board says keepRewind and the table reuses
  // its copy (27% of a board update's bytes, and unchanged in 3 updates of 4: tmp/json-decode/impact.md). Kept with the
  // zones, so a resend or a rewind sends them in full again. Only to a table that said it understands keepRewind.
  if (tableKeepsRewind) {
    const rw = JSON.stringify(tableMsg.rewind ?? null);
    if (game.sentZones["|rewind"] === rw) { delete tableMsg.rewind; tableMsg.keepRewind = true; } else game.sentZones["|rewind"] = rw;
  }
  toTTS(tableMsg);
  // (cleared after the send, not before the same-board check: a board skipped as identical keeps it for the next)
  game.fxJump = false;
  game.fxExiled?.clear();
  game.fxCountered?.clear();
  flushTexts();
}

function resetGame(reason) {
  if (game) { game.closing = true; for (const s of allSeats()) s.close(); }
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
const IMG_DIR = home.tmp("img-cache"); // jpgs for the /img/ route (older table scripts)
// card: the engine card (or stack item) it is the picture of, for its owner's deck and its printing (imagesFor): the
// picture in a question is the one on the table
function pictureOf(name, card = null) {
  return (name && (imagesFor(name, card ? game?.slotColor?.[card.ownerId] || null : null, card?.id)?.face || cachedImage(name)?.face)) || null;
}

// The picture the table's card row shows for a card (undefined when face-down or not known yet).
function imgOf(c) {
  const name = c && c.visibility !== "hidden" ? c.identity?.name : null;
  return pictureOf(name, c) || undefined;
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
// Labels for a list of creatures, each its cardLabel (cname when the view lacks it), with " #n" in the list's order
// when that still reads the same as another's: id -> label (the attackers' and blockers' lists)
function numberedLabels(ids, byId, cname) {
  const sized = new Map(ids.map((id) => [id, byId[id] ? cardLabel(byId[id]) : cname(id)]));
  const same = {};
  for (const [id, l] of sized) (same[l] ??= []).push(id);
  return (id) => (same[sized.get(id)]?.length > 1 ? `${sized.get(id)} #${same[sized.get(id)].indexOf(id) + 1}` : sized.get(id) ?? cname(id));
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
// "A", "A and B", "A, B and C"
const andList = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] || "");
// Why the game ended, for the chat, the game log, the table's top bar, a refused rewind and the relay's abort: the last
// losers' reasons (LOSS_REASONS, else an empty library, deckedPlayers), who conceded (concededPlayers), and the winner;
// with none of these, "a draw" once the engine says the game is over and names no winner (Kykar hand test #16: the
// table said only "Game over."), else null. The engine's own reason (its runaway-game cap, a card's "the game is a
// draw") doesn't reach the bridge, so a draw says no why: a guessed one is worse than none (verify 2026-11-07: two
// empty libraries read as the runaway cap). "White and Yellow conceded. Blue wins." (live 2026-11-08: "White had to
// draw from an empty library", a conceded player's library reading 0.)
function gameEndWords(gv) {
  const decked = deckedPlayers(gv).map((p) => nameOf(p.id));
  const conceded = concededPlayers(gv).map((p) => nameOf(p.id));
  const lost = [lossReasons(gv), decked.length ? `${andList(decked)} drew from an empty library` : null,
    conceded.length ? `${andList(conceded)} conceded` : null].filter(Boolean).join(", ") || null;
  const won = gv?.winnerId ? `${nameOf(gv.winnerId)} wins` : null;
  if (lost) return won ? `${lost}. ${won}` : lost;
  // (a draw only when the engine says the game is over: a gameOver question with a board still playing tells nothing)
  return won || (gv?.gameOver ? "a draw" : null);
}
// The players a board shows lost by drawing from an empty library: among the last to go out (outLast), not the winner,
// not one who conceded; once the engine says the game is over, only players out of it (one still playing with an empty
// library hasn't drawn from it yet). The library on the board that shows them out says nothing: a conceded player's
// reads 0 (live 2026-11-08), and so does every loser's in a game of 3 or more, whose cards leave the game with them
// (CR 800.4a: a Thassa's Oracle win read "AI 1 and AI 2 drew from an empty library", verify 2026-11-09). So the
// evidence is the bridge's own record (noteOuts): the library was already empty on a board that still showed the player
// in the game, before that draw step, and they went out in their own draw step, the draw they couldn't make. A deck-out the boards can't show
// that way (an effect's draw, both libraries at once) is said without a reason: a guessed one is worse than none. A
// player with a reason in LOSS_REASONS is said with that one (12 poison read as an empty library, playtest 2026-10-27).
// gameEndWords uses it.
function deckedPlayers(gv) {
  return (gv?.players || []).filter(outLast).filter((p) => p.id !== gv.winnerId && p.status !== "conceded" && (!gv.gameOver || (p.status && p.status !== "playing"))
    && !LOSS_REASONS.some((r) => r(p)) && drewFromEmpty(gv, p));
}
// (where the player went out: the board that first showed them out, else this one, a player the relay's abort stopped)
// The library empty already before that draw step: one first seen empty in that same draw step was their draw's last
// card, drawn (a player who drew their last card and then lost to Laboratory Maniac read as decked, review 2026-11-09).
function drewFromEmpty(gv, p) {
  const where = game?.outWhere?.[p.id] ?? { step: gv.step, active: gv.activePlayerId, turn: gv.turn };
  const empty = game?.emptyAt?.[p.id];
  return game?.inLibrary?.[p.id] === 0 && !!empty && !(empty.step === "draw" && empty.turn === where.turn)
    && where.step === "draw" && where.active === p.id;
}
// The concessions said at the game's end: every player the engine shows conceded since the last player lost another way
// (White and Yellow conceding 19 s apart both ended it, live 2026-11-08; one who conceded on turn 5 before another lost
// at 0 life on turn 20 did not), in seat order. Every one of them did concede; with no other loss between, an early
// concession is named beside the last one, as both left the winner alone.
function concededPlayers(gv) {
  const players = gv?.players || [];
  const at = (p) => game?.outOrder?.[p.id];
  const lastLoss = Math.max(0, ...players.filter((p) => p.status === "lost" && at(p) != null).map(at));
  return players.filter((p) => p.status === "conceded" && (at(p) == null || at(p) > lastLoss || outLast(p)));
}
// The order players left the game in (status lost / conceded first seen), so an end-of-game message names who lost
// last, not a player out since turn 5 at -3 life (stage 3 review 2026-10-27). Called with each board.
// Also what deckedPlayers needs: each player's library count on the last board that showed them still in the game
// (game.inLibrary), the turn and step that library was first seen empty in (game.emptyAt), and the step, active player
// and turn of the board that first showed them out (game.outWhere).
function noteOuts(gv) {
  if (!game || !gv) return;
  game.outOrder ??= {};
  game.inLibrary ??= {};
  game.outWhere ??= {};
  game.emptyAt ??= {};
  let any = false;
  for (const p of gv.players || []) {
    if (p.status && p.status !== "playing") {
      if (game.outOrder[p.id] == null) { game.outOrder[p.id] = (game.outStamp ?? 0) + 1; game.outWhere[p.id] = { step: gv.step, active: gv.activePlayerId, turn: gv.turn }; any = true; }
    } else if ((gv.zones || []).some((z) => z.zone === "library" && z.ownerId === p.id)) {
      const n = zoneOf(gv, "library", p.id).count || 0;
      game.inLibrary[p.id] = n;
      // (the turn and step it was first seen empty in, drewFromEmpty)
      if (n > 0) delete game.emptyAt[p.id]; else game.emptyAt[p.id] ??= { turn: gv.turn, step: gv.step };
    }
  }
  if (any) game.outStamp = (game.outStamp ?? 0) + 1;
}
// The printed P/T of each card name the engine has sent one for (game.printedPT, kept in the resume file), for a card
// of that name it sends none for (tableCard: a copy, whose paper is another card's). Forge's harness sends a card's
// printed P/T only from the face of its own paper that bears its current name, and only when both are numbers, so the
// numbers are that name's, as printed on every picture of it. Tokens are left out: their names aren't unique ("Soldier"
// is a 1/1 and a 2/2). Read from every board before it is drawn, so a copy drawn before its original on a board gets them.
function notePrinted(gv) {
  if (!game || !gv) return;
  for (const z of gv.zones || []) for (const c of z.cards || []) {
    if (c?.identity?.name && !c.identity.isToken && !c.isFaceDown && c.printedPower != null && c.printedToughness != null) {
      (game.printedPT ??= {})[c.identity.name] = [c.printedPower, c.printedToughness];
    }
  }
}
// What the bridge records from each board the engine sends, before it is drawn
function noteBoard(gv) { noteOuts(gv); notePrinted(gv); harmlessVotes(gv); }
// The card types seen face up, by card id and by name, from every seat's view (sendTable): Forge's stack item carries
// no types, and the table's instant and sorcery sounds need them (isSpellOfType). Not the battlefield, where effects change types
// (an animated land) and no instant ever is; not tokens or copies by name (defensive: outside the battlefield neither
// is known to carry an instant's name without its type). Face-down and hidden cards are skipped: their types aren't
// the card's, and the first types seen stick.
function noteTypes(gv) {
  if (!game || !gv) return;
  const byId = (game.typesById ??= new Map()), byName = (game.typesByName ??= new Map());
  for (const z of gv.zones || []) {
    if (z.zone === "battlefield") continue;
    for (const c of z.cards || []) {
      const name = c.identity?.name;
      if (!c.id || !name || c.isFaceDown || c.visibility === "hidden" || !Array.isArray(c.types) || !c.types.length) continue;
      // (set once: each view's card brings a new array, and a card's printed types don't change outside the battlefield)
      if (!byId.has(c.id)) byId.set(c.id, c.types);
      if (!c.identity.isToken && !c.isCopy && !byName.has(name)) byName.set(name, c.types);
    }
  }
}
// A stack item that is an instant (or, type "Sorcery", a sorcery) spell, for the table's instant and sorcery sounds
// (`ins`, `sor`, docs/m5-effects-design.md section 6): a spell, not an ability, no longer being cast, whose card was
// seen as that type (by its stack name first, a split card's half; else by its card). One never seen face up (an AI's first, from a hand no seat sees) isn't known, and
// sounds nothing. A copy is told on the table, by the stack before it.
function isSpellOfType(s, pub, type) {
  if (!game || s.isCasting || s.isPermanentSpell || isAbilityOnStack(s, pub)) return false;
  const types = game.typesByName?.get(s.identity?.name) || game.typesById?.get(s.sourceId);
  return Array.isArray(types) && types.includes(type);
}
// Not out before the last players to go (still playing, or among them)
function outLast(p) { const at = game?.outOrder?.[p.id]; return at == null || at === game.outStamp; }
// (a conceded player's reason is the concession, whatever the board shows: concededPlayers)
function lossReasons(gv) {
  const said = [];
  for (const p of (gv?.players || []).filter((p) => outLast(p) && p.status !== "conceded")) {
    const why = LOSS_REASONS.map((r) => r(p)).filter(Boolean);
    if (why.length) said.push(`${nameOf(p.id)} ${why.join(" and ")}`);
  }
  return said.length ? said.join(", ") : null;
}
// A player counter the engine may spell either way ("POISON" / "poison").
const playerCounter = (p, name) => (p.counters || {})[name.toUpperCase()] || (p.counters || {})[name] || 0;

// The mark field of a player's table row (sendTable), from PLAYER_MARKS below: `allMarks`, the whole label under the
// life total in order (left out when there is none). The old fields (poison, energy, monarch, initiative, blessed,
// story, marks) went once both halves were live (docs/core-moves-cleanup-plan.md "2. trackMarks" step 6).
// A PLAYER_MARKS row with a `row` key is sent under that key too, its value as read, left out when it shows nothing:
// `extraTurns`, the extra turns the player has coming, drawn beside the life counter rather than in the label ("EXTRA
// TURN" for one, "EXTRA TURN nx" for n, engineExtraTurnBadge); left out at 0 and from an engine that doesn't send the
// count.
function playerMarks(p, pub) {
  // (updateLog has just read this board: game.logPrev is its log snapshot)
  const { values, labels, tips } = trackMarks(p, pub, { turnRun: game.logPrev?.turnRun?.[p.id] });
  const out = labels.length ? { allMarks: labels } : {};
  // (markTips: each box's own hover text, by allMarks' order, "" for the boxes' common one; only when one has its own)
  if (tips.some(Boolean)) out.markTips = tips;
  // (the life gained and lost this turn, for the life counter's hover text; Forge sends each only above 0)
  const life = [positive(p.lifeGainedThisTurn) ? `Gained ${p.lifeGainedThisTurn} life this turn` : "",
    positive(p.lifeLostThisTurn) ? `Lost ${p.lifeLostThisTurn} life this turn` : ""].filter(Boolean);
  if (life.length) out.lifeTip = life.join("\n");
  for (const m of PLAYER_MARKS) if (m.row && markShown(values[m.key])) out[m.row] = values[m.key];
  return out;
}
// Every mark under a player's life total, one row each: `read` takes its value from Forge's player (p) and the game
// (pub); `label(v, at)` says it on the table (a list of labels for keywords); `say(who, now, was, at)`, if the row has
// one, is the log line when the value changes (null: nothing to say), see logEvents (`at`: whose turn another player
// runs, turnRuns; only controlledBy reads it). The rows' order is the label's order. A value
// of 0, false, null, "" or [] shows nothing. A number (a player counter, the Ring, speed, prevention) is read as a
// positive number or 0 (`positive`): a "0", true or -1 is 0, so the label and the log see the same value (review
// 2026-11-06; jr suite 2026-11-06). Forge sends all of these and nothing else showed them: poison (Skrelv's toxic,
// playtest 2026-10-27), energy (structural review the same day), the monarch and the initiative (Palace Jailer,
// hp-17), the city's blessing and an enduring story (hp-21), then the other player counters, the Ring's temptations,
// speed, another player in control (Mindslaver's turn, Opposition Agent's search), an extra turn, damage prevention
// shields, a changed hand size, and keywords on the player (hexproof, "can't lose the game"; table-map gaps 2026-11-03).
// The log said none of the first six either: Vraska's Fall's poison (hp-11), Volatile Stormdrake's energy gained and
// paid (hp-16), Palace Jailer's monarch (hp-17), Wayward Swordtooth's ascend (hp-11), Kíli the Resourceful's story (hp-21),
// nor the Ring, speed or another player in control (trackMarks step 7, 2026-11-06).
const positive = (n) => (typeof n === "number" && n > 0 ? n : 0);
// (a held mark's words after its line: from whom and by what, logEvents' `at.from` and `at.cause`, "(from White, combat damage)")
const heldWords = (at = {}) => ((w) => (w.length ? ` (${w.join(", ")})` : ""))([...(at.from ? [`from ${at.from}`] : []), ...(at.cause ? [at.cause] : [])]);
const counterOf = (name) => (p) => positive(playerCounter(p, name));
const PLAYER_MARKS = [
  { key: "poison", read: counterOf("poison"), label: (n) => `POISON ${n}`,
    say: (who, n, was) => (n > was ? `${who} gets ${countWords(n - was, n - was, "poison counter")} (${n} in all)`
      : `${who} loses ${countWords(was - n, was - n, "poison counter")} (${n} in all)`) },
  { key: "energy", read: counterOf("energy"), label: (n) => `ENERGY ${n}`,
    say: (who, n, was) => (n > was ? `${who} gets ${n - was} energy (${n} in all)` : `${who} pays ${was - n} energy (${n} left)`) },
  { key: "monarch", read: (p, pub) => pub.monarchId === p.id, label: () => "MONARCH", say: (who, now, was, at) => (now ? `${who} becomes the monarch${heldWords(at)}` : null) },
  { key: "initiative", read: (p, pub) => pub.initiativeHolderId === p.id, label: () => "INITIATIVE", say: (who, now, was, at) => (now ? `${who} takes the initiative${heldWords(at)}` : null) },
  { key: "blessed", read: (p) => !!p.hasCityBlessing, label: () => "CITY'S BLESSING", say: (who, now) => (now ? `${who} gets the city's blessing` : null) },
  { key: "story", read: (p) => !!p.hasEnduringStory, label: () => "ENDURING STORY", say: (who, now) => (now ? `${who} has an enduring story` : null) },
  { key: "experience", read: counterOf("experience"), label: (n) => `EXPERIENCE ${n}` },
  { key: "radiation", read: counterOf("radiation"), label: (n) => `RAD ${n}` },
  { key: "ticket", read: counterOf("ticket"), label: (n) => `TICKETS ${n}` },
  // (the dungeons Forge lists as completed, as one string so two boards compare by value: a line for each one added,
  // nothing when a rewind shortens it; left out by an engine that doesn't send the list. Before the rooms' lines in the
  // log, so a venture past a last room reads "completes", then "ventures into", spec D6)
  { key: "dungeons", read: (p) => (Array.isArray(p.completedDungeons) ? p.completedDungeons.map(String).join("\n") : ""),
    label: (v) => `DUNGEONS ${v.split("\n").length}`,
    say: (who, now, was) => {
      const all = now ? now.split("\n") : [], before = was ? was.split("\n") : [];
      return all.length > before.length ? `${who} completes ${all[all.length - 1]} (${all.length} dungeon${all.length === 1 ? "" : "s"} completed)` : null;
    } },
  // (Forge's count of temptations only goes up in play, getNumRingTemptedYou: a rewind or a restarted game lowers it,
  // and that says nothing)
  { key: "ring", read: (p) => positive(p.ringLevel), label: (n) => `RING TEMPTED ${n}`,
    say: (who, n, was, at = {}) => (n > was ? `${who} is tempted by the Ring${n - was > 1 ? ` ${n - was} times` : ""} (${n})${at.bearer ? `: Ring-bearer ${at.bearer}` : ""}` : null) },
  // (0 until a "Start your engines!" card; then 1 to 4, up once a turn, Forge's "Max Speed!" at 4, never down below 1)
  { key: "speed", read: (p) => positive(p.speed), label: (n) => `SPEED ${n}`,
    say: (who, n, was) => (n > was ? `${was ? `${who}'s speed goes up to ${n}` : `${who} starts their engines (speed ${n})`}${n === 4 ? " (max speed)" : ""}`
      : n ? `${who}'s speed goes down to ${n}` : null) },
  // (String: a name that isn't text must not throw, or the whole board would not go out. Forge sends it while another
  // player controls this one, for a turn or for a moment, Opposition Agent's search: a turn's is worded as one only
  // when turnRuns says it is)
  { key: "controlledBy", read: (p) => p.controlledBy || null,
    label: (id, at) => `${at.turnRun === id ? "TURN RUN BY" : "CONTROLLED BY"} ${String(nameOf(id)).toUpperCase()}`,
    say: (who, id, was, at) => {
      const by = String(nameOf(id || was));
      if (id) return at.turnRun === id ? `${by} takes control of ${who}'s turn` : `${by} controls ${who} for now`;
      return at.wasTurnRun === was ? `${by}'s control of ${who}'s turn ends` : `${by} no longer controls ${who}`;
    } },
  // (while it is theirs: Forge keeps the flag on the player after the turn. The value is Forge's own flag for the
  // active player, true only when the flag is true: the turn header reads it too, extraTurn, so the label and the
  // header agree on a flag of 1 or "true", which neither takes as one. No number: it says this turn is one; more still
  // queued are the extraTurns row's, beside the life counter, 2026-11-12)
  { key: "extraTurn", read: (p, pub) => pub.activePlayerId === p.id && p.isExtraTurn === true, label: () => "EXTRA TURN" },
  { key: "prevention", read: (p) => positive(p.damagePrevention), label: (n) => `PREVENT ${n}` },
  // (as text: a maximum of 0 is shown)
  { key: "handSize", read: (p) => (p.unlimitedHandSize ? "none" : p.maxHandSize != null && p.maxHandSize !== 7 ? String(p.maxHandSize) : null),
    label: (n) => (n === "none" ? "NO MAX HAND SIZE" : `MAX HAND ${n}`) },
  { key: "keywords", read: playerKeywordLabels, label: (list) => list },
  // (engine1112, docs/readability-audit-2026-11-12.md E6, E1, E2: the active player's spells this turn and the storm
  // count; the rules effects and emblems on the player; a delayed trigger waiting for their turn with no card to mark,
  // a pact's upkeep cost. Each box's hover says it whole: `tip`. Nothing from an engine that sends none.)
  { key: "spells", read: spellsMark, label: (v) => v,
    tip: (v, p, pub) => `${nameOf(p.id)} has cast ${countWords(positive(p.spellsCastThisTurn), positive(p.spellsCastThisTurn), "spell")} this turn. Storm count (every player's spells this turn): ${positive(pub.stormCount) || positive(p.spellsCastThisTurn)}` },
  { key: "effects", read: effectMarks, label: (list) => list.map((m) => m.split("\t")[0]), tip: (list) => list.map((m) => m.split("\t")[1]) },
  { key: "delayed", read: (p, pub) => (delayedOf(pub).players.get(p.id) || []).map((d) => `${d.label}\t${d.tip}`),
    label: (list) => list.map((m) => m.split("\t")[0]), tip: (list) => list.map((m) => m.split("\t")[1]) },
  // (Forge's extra turn count, up when Time Walk resolves and down as each turn starts: no label, the table draws it
  // beside the life counter, counted from 1, "EXTRA TURN" then "EXTRA TURN 2x", the row's extraTurns, see playerMarks;
  // the log says each one added, the count after it)
  { key: "extraTurns", row: "extraTurns", read: (p) => positive(p.extraTurnCount), label: () => [],
    say: (who, n, was) => (n > was ? `${who} will take ${n - was > 1 ? `${n - was} extra turns` : "an extra turn"} (${n} coming)` : null) },
];
const markShown = (v) => (Array.isArray(v) ? v.length > 0 : !!v);
// One player's marks: { values: key -> value, labels: the whole label list in order }. `at.turnRun`: who runs this
// player's turn, from turnRuns (the label says a turn's control as one)
// `tips`: each label's own hover text from its row's `tip(v)` (a list, by the label's order), else ""
function trackMarks(p, pub, at = {}) {
  const values = {}, labels = [], tips = [];
  for (const m of PLAYER_MARKS) {
    const v = (values[m.key] = m.read(p, pub));
    if (!markShown(v)) continue;
    const said = [].concat(m.label(v, at));
    const own = m.tip ? [].concat(m.tip(v, p, pub)) : [];
    labels.push(...said);
    tips.push(...said.map((_, i) => String(own[i] || "")));
  }
  return { values, labels, tips };
}
// A player's rules effects and emblems (engine1112 PlayerDto.effects: { id, name, text, sourceCardId?, emblem,
// untilEndOfTurn, duration? }, docs/readability-audit-2026-11-12.md E1) as short labels, the whole text in each box's
// hover: "FOG THIS TURN", "EMBLEM: GIDEON", "TEFERI'S PROTECTION UNTIL YOUR NEXT TURN", "SKIPS NEXT 2 TURNS". Past
// EFFECT_MARKS, one "+n MORE EFFECTS" box whose hover lists the rest. As one string per effect ("label\ttip", so two
// boards compare by value); [] from an engine that sends none.
const EFFECT_MARKS = 3;
const EFFECT_DURATIONS = { UntilYourNextTurn: "until your next turn", UntilYourNextUpkeep: "until your next upkeep",
  UntilEndOfCombat: "this combat", UntilTheEndOfYourNextTurn: "until the end of your next turn", UntilHostLeavesPlay: "while its source stays" };
// (hidden information, as delayedOf: an effect whose source card is face down or out of the public zones in the view
// every seat's board comes from shows no text, and no label made from its name; an emblem is public, its label stays)
function effectMark(e, shown) {
  const name = String(e.name || "").trim();
  const text = String(e.text || "").trim();
  const open = !e.sourceCardId || shown.has(e.sourceCardId);
  const base = name.replace(/'s Effect$/i, "").replace(/ Effect$/i, "").trim() || "Effect";
  const dur = e.untilEndOfTurn ? "this turn" : EFFECT_DURATIONS[e.duration] || "";
  const skip = /^Skip your next (?:(\w+) )?turns?\b/i.exec(text);
  const n = skip ? (skip[1] ? NUMBER_WORDS[skip[1].toLowerCase()] || Number(skip[1]) || 0 : 1) : 0;
  const label = e.emblem ? `EMBLEM: ${base.replace(/^Emblem\s*[-—:]?\s*/i, "").split(",")[0].trim() || base}`
    : n ? (n > 1 ? `SKIPS NEXT ${n} TURNS` : "SKIPS NEXT TURN")
    : e.untilEndOfTurn && /\bprevent all combat damage\b/i.test(text) ? "FOG THIS TURN"
    : `${open ? base : "RULES EFFECT"}${dur ? ` ${dur}` : ""}`;
  return `${label.toUpperCase()}\t${open ? `${base}${dur ? ` (${dur})` : ""}: ${text || "(no text)"}` : ""}`;
}
function effectMarks(p, pub) {
  const shown = publicCardIds(pub);
  const all = (Array.isArray(p.effects) ? p.effects : []).filter((e) => e && (e.name || e.text)).map((e) => effectMark(e, shown));
  if (all.length <= EFFECT_MARKS + 1) return all;
  const rest = all.slice(EFFECT_MARKS);
  return [...all.slice(0, EFFECT_MARKS), `+${rest.length} MORE EFFECTS\t${rest.map((m) => m.split("\t")[1]).filter(Boolean).join("\n")}`];
}
// The spells cast this turn, for the active player (engine1112 PlayerDto.spellsCastThisTurn and GameViewDto.stormCount,
// each sent only above 0, E6): "SPELLS THIS TURN: 2 (STORM 3)", the storm count being every player's spells
function spellsMark(p, pub) {
  if (pub.activePlayerId !== p.id) return null;
  const mine = positive(p.spellsCastThisTurn), storm = positive(pub.stormCount);
  return mine || storm ? `SPELLS THIS TURN: ${mine} (STORM ${storm || mine})` : null;
}
// (a keyword as cards' keywords read, "Protection:Player.Opponent:each of your opponents" -> "Protection from each
// of your opponents", the internal ones left out; one written as a sentence, "You can't lose the game.", as it is)
function playerKeywordLabels(p) {
  const kws = (p.playerKeywords || []).map(String);
  const sentences = kws.filter((k) => /\.\s*$/.test(k));
  const words = cardKeywords({ keywords: kws.filter((k) => !sentences.includes(k)), text: "" }).granted;
  return [...words, ...sentences.map((k) => k.trim().replace(/\.$/, ""))].map((k) => shortText(k, 32).toUpperCase());
}

function cardIndex(gv) {
  const byId = {};
  for (const z of gv.zones || []) for (const c of z.cards || []) byId[c.id] = c;
  return byId;
}

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
// (reminder text is no rule: Defender's "(This creature can't attack.)" and exalted's "attacks alone" listed every
// wall and exalted card as a limit; checked against Forge's 32,967 Oracle lines, 2026-11-10)
const attackRulesText = (c) => String(c.currentText ?? c.text ?? "").replace(/\([^)]*\)/g, "");
// The rules on the battlefield that limit or tax attacks, read from their text: Forge's attack question carries none of
// them (docs/attack-reminder-spec.md parts 1 and 2; part 3, the engine sending its own, is not built). Face-down cards
// have no text. Returns
//   onField: [[card, its battlefield zone]]; ctlOf(card, zone): its controller; limiters: the names of cards whose text limits attacks at all;
//   limits: [{ card, ctl, n, at }]: Silent Arbiter, Crawlspace, The Eternal Wanderer, Mirri while tapped (at: null for
//     every attack, else the player's slot or the planeswalker's card id);
//   taxes: [{ card, ctl, cost, pw, only }]: Propaganda's "{2} for each creature attacking you" (pw: Sphere of Safety's
//     "or planeswalkers you control" too; only: the word before "creatures", Elephant Grass's "Nonblack", or "");
//   costs: [{ card, on, cost, more }]: one creature's own price, Brainwash on it or Qal Sisma Behemoth's own (on: that
//     creature's id; more: words after the cost, Cowed by Wisdom's "for each card in your hand");
//   cants: [{ card, ctl, at, only, without }]: Blazing Archon's "Creatures can't attack you" (at: ctl) and Moat's
//     "Creatures without flying can't attack" (at: null, without: "flying");
//   others: [{ card, ctl, sentence }]: any other "can't attack ... unless" sentence (Reclamation's land), said as written.
function attackRules(gv) {
  const out = { onField: [], limiters: [], limits: [], taxes: [], costs: [], cants: [], others: [], ctlOf: (c, z) => c.controllerId || z.ownerId };
  for (const z of gv.zones || []) if (z.zone === "battlefield") for (const c of z.cards || []) if (!c.isFaceDown && c.identity?.name) out.onField.push([c, z]);
  const { ctlOf } = out;
  for (const [c, z] of out.onField) {
    const name = c.identity.name;
    const text = attackRulesText(c);
    const ctl = ctlOf(c, z);
    if (/\bcan't attack\b|\bno more than \w+ creatures? can attack\b|\bcan only attack alone\b/i.test(text)) out.limiters.push(name);
    // Silent Arbiter: "No more than one creature can attack each combat."; Crawlspace: "... can attack you each combat.";
    // The Eternal Wanderer: "... can attack The Eternal Wanderer each combat." (attacks at it only)
    const m = new RegExp(`\\bno more than (\\w+) creatures? can attack (?:(you|this planeswalker|${escapeRe(name)}) )?each combat\\b`, "i").exec(text);
    const n = m ? NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1]) : NaN;
    // Mirri, Weatherlight Duelist: "As long as Mirri ... is tapped, no more than one creature ..."
    if (Number.isFinite(n) && !(/\bas long as [^.]*? is tapped, no more than\b/i.test(text) && !c.tapped)) {
      out.limits.push({ card: c, ctl, n, at: !m[2] ? null : /^you$/i.test(m[2]) ? ctl : c.id });
    }
    for (const sentence of text.split(/\n|(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean)) {
      // (Oracle wordings from Forge's cardsfolder, 2026-11-11: Propaganda, Ghostly Prison, Windborn Muse, Koskun Falls,
      // Sphere of Safety, Norn's Annex, Baird, Archangel of Tithes while untapped, Collective Restraint's "Domain —")
      const tax = /^(?:As long as [^,]+ is untapped, )?(?:[A-Z][a-z]+ — )?(?:([A-Za-z]+) )?creatures can't attack (you or planeswalkers you control|you) unless their controller pays ((?:\{[^}]+\})+|\d+ life) for each\b(.*)$/i.exec(sentence);
      if (tax) {
        if (/^As long as /i.test(sentence) && c.tapped) continue;
        out.taxes.push({ card: c, ctl, cost: attackXWorked(tax[3], tax[4], out.onField.filter(([y, yz]) => ctlOf(y, yz) === ctl).map(([y]) => y)), pw: /planeswalkers/i.test(tax[2]), only: tax[1] && !/^creatures$/i.test(tax[1]) ? tax[1] : "" });
        continue;
      }
      // Brainwash, Oppressive Rays, Cowed by Wisdom on the creature they enchant; Qal Sisma Behemoth's own
      const aura = /^Enchanted creature can't attack(?: or block)? unless its controller pays ((?:\{[^}]+\})+)(.*?)\.?$/i.exec(sentence);
      const own = new RegExp(`^${escapeRe(name)} can't attack(?: or block)? unless you pay ((?:\\{[^}]+\\})+)(.*?)\\.?$`, "i").exec(sentence);
      if ((aura && c.attachedTo) || own) {
        const x = aura || own;
        out.costs.push({ card: c, on: aura ? c.attachedTo : c.id, cost: x[1], more: x[2].trim() });
        continue;
      }
      // Blazing Archon, Elephant Grass's "Black creatures can't attack you."; Moat, Magus of the Moat
      const cant = /^(?:([A-Za-z]+) )?creatures (?:without (\w+) )?can't attack( you)?\.?$/i.exec(sentence);
      if (cant) { out.cants.push({ card: c, ctl, at: cant[3] ? ctl : null, only: cant[1] && !/^creatures$/i.test(cant[1]) ? cant[1] : "", without: cant[2] || "" }); continue; }
      if (/\bcan't attack\b[^.]*\bunless\b/i.test(sentence)) out.others.push({ card: c, ctl, sentence: sentence.replace(/\.?$/, ".") });
    }
  }
  return out;
}
// A tax's {X} worked out where the board can count it (Sphere of Safety: enchantments its controller controls;
// Collective Restraint: basic land types among their lands), else left as {X}. mine: the face-up permanents the tax's
// controller controls.
function attackXWorked(cost, rest, mine) {
  if (!/\{X\}/i.test(cost)) return cost;
  let x = null;
  if (/\bwhere X is the number of enchantments you control\b/i.test(rest)) x = mine.filter((c) => (c.types || []).includes("Enchantment")).length;
  if (/\bwhere X is the number of basic land types among lands you control\b/i.test(rest)) {
    x = ["Plains", "Island", "Swamp", "Mountain", "Forest"].filter((t) => mine.some((c) => (c.types || []).includes("Land") && (c.subtypes || []).includes(t))).length;
  }
  return x == null ? cost : cost.replace(/\{X\}/gi, `{${x}}`);
}
// Several costs paid as one (Forge adds every tax on one attacker into one payment): "{2}" + "{W/P}" -> "{2}{W/P}",
// "{2}" + "{2}" -> "{4}", life after the mana ("{2} and 2 life")
function attackCostSum(costs) {
  let generic = 0, life = 0;
  const other = [];
  for (const cost of costs) {
    const l = /^(\d+) life$/i.exec(cost);
    if (l) { life += Number(l[1]); continue; }
    for (const s of String(cost).match(/\{[^}]+\}/g) || []) { if (/^\{\d+\}$/.test(s)) generic += Number(s.slice(1, -1)); else other.push(s); }
  }
  const mana = `${generic ? `{${generic}}` : ""}${other.join("")}`;
  return [mana, life ? `${life} life` : ""].filter(Boolean).join(" and ") || "{0}";
}
// Whether "Black", "Nonblack", "Green" ... names this creature (Elephant Grass, Reclamation): true, false, or null when
// the word isn't a colour the bridge can read
function attackWordFits(card, word) {
  if (!word) return true;
  const w = word.toLowerCase();
  const letter = COLOR_LETTER[w.replace(/^non-?/, "")];
  if (!letter) return null;
  return String(card.color || "").includes(letter) !== /^non/.test(w);
}

// The engine's own attack data (docs/attack-reminder-spec.md part 3), when it sends it: the harness puts Forge's tax per
// defender on each attacker (`costs`: [{ defenderId, cost, sourceIds, sourceNames }]), the creatures that can't attack
// all or one defender and why (`unavailable`: [{ cardId, defenderId?, reason, sourceId?, sourceName? }]) and the attack
// limits (`limits`: [{ max, defenderId?, sourceId, sourceName }]). Such an engine always sends `unavailable` and
// `limits`, empty or not; an older one sends neither and the text reading (attackRules) stays. Effects with no text on
// the board (War Tax, Sivitri's +1, an emblem) are known only this way. Returns null, or { costs: { attackerId: [...] },
// unavailable, limits }.
function engineAttackData(input) {
  if (!Array.isArray(input?.unavailable) && !Array.isArray(input?.limits)) return null;
  const costs = {};
  for (const a of input.attackers || []) costs[a.attackerId] = (a.costs || []).map((c) => ({ ...c, cost: engineCostWords(c.cost), sourceNames: c.sourceNames || [] }));
  return { costs, unavailable: input.unavailable || [], limits: input.limits || [] };
}
// Forge's cost text (Cost.toSimpleString: its parts joined by ", ") in the words attackCostSum uses: a worked-out X's
// shard is left out ("{X}{3}" for Sphere of Safety with 3 enchantments, ManaCost.getSimpleString; Forge pays the X as 0,
// CombatUtil.checkPropagandaEffects), so is the {0} mana part a sum starts from ("{0}, Pay 2 life", Sivitri's +1), and
// CostPayLife's "Pay 2 life" is "2 life": "{2}, Pay 2 life" -> "{2} and 2 life"
function engineCostWords(cost) {
  const parts = String(cost || "").split(", ").map((p) => p.replace(/\{X\}/g, "").replace(/^Pay (\d+ life)$/, "$1")).filter(Boolean);
  const said = parts.length > 1 ? parts.filter((p) => p !== "{0}") : parts;
  return said.join(" and ") || "{0}";
}
// the harness's reason words for a creature that can't attack (host ManaBrewInteractiveSession.attackRefusal); "static"
// is said by the card that forbids it, "goaded" by who goaded it (attackReminder)
const ENGINE_CANT_WORDS = { tapped: "tapped", phasedOut: "phased out", summoningSick: "summoning sick", detained: "detained", defender: "defender", keyword: "its own text" };
const engineCantWords = (u) => (u.reason === "static" && u.sourceName ? u.sourceName : ENGINE_CANT_WORDS[u.reason] || "an effect on the table");
// The attack limits as [{ card, ctl, n, at }] (attackRules' shape): the engine's when it sends them (`card` then has only
// the source's id and name, `ctl` its controller when the board shows the card, else null), else the text's
function attackLimits(gv, E, R) {
  if (!E) return R.limits;
  const byId = cardIndex(gv);
  return E.limits.map((l) => ({ card: { id: l.sourceId, identity: { name: l.sourceName } }, ctl: byId[l.sourceId]?.controllerId || null, n: l.max, at: l.defenderId || null }));
}
// a limit's card with whose it is ("Crawlspace (AI 1)"; one the board doesn't show by name alone), and whom it covers
// in words: a player by name, the planeswalker that limits attacks on itself by its name (The Eternal Wanderer), another
// defender as defenderWords says it
const limitWho = (l) => `${l.card.identity.name}${l.ctl ? ` (${nameOf(l.ctl)})` : ""}`;
const limitAt = (gv, input, l) => (String(l.at).startsWith("player-") ? nameOf(l.at) : l.at === l.card.id ? l.card.identity.name : defenderWords(gv, input, l.at));

// Why Forge refused an attack, from the rules text on the battlefield: Forge says only "Attack declaration invalid"
// (Crawlspace allowed 2 attackers at White, Blue sent "All attack" with 3 eight times and was told nothing, live game
// 2026-11-10; docs/attack-reminder-spec.md part 1). `attack` is the refused declaration, [{ attackerId, targetId }];
// E: the attack question's engine data (engineAttackData), whose limits are used instead of the text's.
// Returns { broken: sentences naming each limit the attack broke, limiters: "Cards on the table that limit attacks:
// ..." when nothing was found broken but such cards are out, else "" }.
function attackRefusalReason(gv, attack, E = null) {
  const total = attack.length;
  const atTarget = {};
  for (const a of attack) atTarget[a.targetId] = (atTarget[a.targetId] || 0) + 1;
  const said = [];
  const R = attackRules(gv);
  const { onField, limiters } = R;
  const textOf = attackRulesText;
  for (const l of attackLimits(gv, E, R)) {
    const chosen = l.at ? atTarget[l.at] || 0 : total;
    if (chosen > l.n) said.push(`${limitWho(l)}: no more than ${l.n} creature${l.n === 1 ? "" : "s"} can attack ${l.at ? `${limitAt(gv, {}, l)} ` : ""}each combat. You chose ${chosen}.`);
  }
  // Mogg Flunkies: "can't attack or block alone"; Master of Cruelties: "can only attack alone", Errantry's enchanted
  // creature too
  const rulesOf = (id) => [id, ...onField.filter(([c]) => c.attachedTo === id).map(([c]) => c.id)]
    .map((cid) => onField.find(([c]) => c.id === cid)).filter(Boolean)
    .map(([c]) => c.id === id ? textOf(c) : (textOf(c).match(/\benchanted creature [^.]*\./gi) || []).join(" ")).join(" ");
  for (const a of attack) {
    const me = onField.find(([c]) => c.id === a.attackerId)?.[0];
    if (!me) continue;
    if (total === 1 && /\bcan't attack(?: or block)? alone\b/i.test(rulesOf(me.id))) said.push(`${me.identity.name} can't attack alone.`);
    if (total > 1 && /\bcan only attack alone\b/i.test(rulesOf(me.id))) said.push(`${me.identity.name} can only attack alone.`);
  }
  const names = said.length ? [] : [...new Set(limiters)];
  return { broken: said, limiters: names.length ? `Cards on the table that limit attacks: ${names.slice(0, 6).join(", ")}${names.length > 6 ? ", ..." : ""}.` : "" };
}

// The taxes (attackRules) on attacking a defender: its controller's, at a planeswalker or battle only those that say
// "or planeswalkers you control". ctl: the defender's controller (the player itself for a player).
function attackTaxesAt(R, ctl, defenderId) { return R.taxes.filter((t) => t.ctl === ctl && (defenderId === ctl || t.pw)); }

// A defender in words: a player by name, a planeswalker or battle with whose it is ("Teferi (AI 1's planeswalker)"),
// by the question's attackTargets kind when it has one, else by the card's types
function defenderWords(gv, input, id) {
  if (String(id).startsWith("player-")) return nameOf(id);
  const c = cardIndex(gv)[id];
  const kind = (input.attackTargets || []).find((t) => t.id === id)?.kind || ((c?.types || []).includes("Battle") ? "battle" : "planeswalker");
  const label = c?.identity?.name || (input.attackTargets || []).find((t) => t.id === id)?.label || id;
  return c?.controllerId ? `${label} (${nameOf(c.controllerId)}'s ${kind})` : label;
}

// What the attack question reminds the player of before they pick (docs/attack-reminder-spec.md part 2; the user
// 2026-11-10: "if there's a pay to attack or multiple creatures can't attack, a prompt should pop up to remind
// players"): the taxes per defender, the limits, each creature's own price, the creatures that can't attack and why,
// and who an offered creature can't attack. From the engine's own data when it sends it (engineAttackData, part 3),
// else from the rules text (attackRules) and the board's flags. `slot`: the attacking player. Returns { lines: the full
// list for the panel, note: the one line for the corner ("" when nothing applies), cantAttack: { cardId: "X can't
// attack: reason." } for Q/E on one not offered, taxAt(defenderId): the taxes on attacking it, [{ card, cost, summed }]
// (summed: cost is already the whole price, as the engine's is) }.
function attackReminder(gv, input, slot) {
  const R = attackRules(gv);
  const E = engineAttackData(input);
  const byId = cardIndex(gv);
  const offered = (input.attackers || []).filter((a) => (a.validTargetIds || []).length);
  const offeredIds = new Set(offered.map((a) => a.attackerId));
  const defenders = (input.attackTargets || []).length ? input.attackTargets.map((t) => t.id) : [...new Set(offered.flatMap((a) => a.validTargetIds))];
  const ctlOf = (id) => (String(id).startsWith("player-") ? id : byId[id]?.controllerId);
  const name = (c) => c.identity?.name || c.id;
  // (engine: each offered creature's tax at d, [{ a, t }], t null for one that pays nothing there)
  const engineTaxAt = (d) => offered.filter((a) => a.validTargetIds.includes(d)).map((a) => ({ a, t: (E.costs[a.attackerId] || []).find((x) => x.defenderId === d) || null }));
  const taxAt = E ? (d) => {
    const paid = engineTaxAt(d).filter((x) => x.t);
    return paid.length ? [{ card: { identity: { name: paid[0].t.sourceNames.join(" + ") } }, cost: [...new Set(paid.map((x) => x.t.cost))].join(" or "), summed: true }] : [];
  } : (d) => attackTaxesAt(R, ctlOf(d), d).map((t) => ({ card: t.card, cost: t.cost, only: t.only }));
  const mineOn = R.onField.filter(([c, z]) => R.ctlOf(c, z) === slot).map(([c]) => c);
  const lines = [];
  const notes = [];
  const taxed = [];
  let own = [];
  if (E) {
    // the engine's taxes, one line per defender: its sources and Forge's total when every creature that can attack it
    // pays the same, else each creature's price ("Attacking AI 1: Grizzly Bears {5} (Propaganda + Brainwash), ...")
    for (const d of defenders) {
      const at = engineTaxAt(d);
      const paid = at.filter((x) => x.t);
      if (!paid.length) continue;
      taxed.push(d);
      const who = defenderWords(gv, input, d);
      const same = paid.length === at.length && new Set(paid.map((x) => `${x.t.cost}|${x.t.sourceNames.join("|")}`)).size === 1;
      lines.push(same ? `${paid[0].t.sourceNames.join(" + ")} (${nameOf(ctlOf(d))}): ${paid[0].t.cost} for each creature attacking ${who}.`
        : `Attacking ${who}: ${paid.map((x) => `${name(byId[x.a.attackerId] || { id: x.a.attackerId })} ${x.t.cost} (${x.t.sourceNames.join(" + ")})`).join(", ")}.`);
      notes.push(`${who} ${[...new Set(paid.map((x) => x.t.cost))].join(" or ")} each`);
    }
  } else {
    // taxes, one line per taxing player whose taxes reach a defender (a player who can't be attacked here, only their
    // planeswalker: only the taxes that say "or planeswalkers you control")
    const taxNames = (ts) => ts.map((t) => `${name(t.card)}${t.only ? ` (${t.only.toLowerCase()} creatures)` : ""}`).join(" + ");
    for (const p of new Set(defenders.map(ctlOf).filter(Boolean))) {
      const all = R.taxes.filter((t) => t.ctl === p);
      const pwTax = all.filter((t) => t.pw);
      const isDefender = defenders.includes(p);
      const hasPw = defenders.some((d) => d !== p && ctlOf(d) === p);
      if (!(isDefender ? all : hasPw ? pwTax : []).length) continue;
      taxed.push(p);
      const cost = attackCostSum(all.map((t) => t.cost));
      const pwCost = attackCostSum(pwTax.map((t) => t.cost));
      if (!isDefender) {
        lines.push(`${taxNames(pwTax)} (${nameOf(p)}): ${pwCost} for each creature attacking their planeswalkers.`);
        notes.push(`${poss(nameOf(p))} planeswalkers ${pwCost} each`);
        continue;
      }
      const pwWords = !hasPw || !pwTax.length ? "" : pwCost === cost ? " or their planeswalkers" : `; ${pwCost} for each attacking their planeswalkers`;
      lines.push(`${taxNames(all)} (${nameOf(p)}): ${cost} for each creature attacking ${nameOf(p)}${pwWords}.`);
      notes.push(`${nameOf(p)} ${cost} each`);
    }
    // one creature's own price (Brainwash, Qal Sisma Behemoth), for the offered ones (the engine's costs carry it)
    own = R.costs.filter((x) => offeredIds.has(x.on));
    for (const x of own) {
      const who = name(byId[x.on] || { id: x.on });
      lines.push(x.card.id === x.on ? `${who} can attack only if you pay ${x.cost}${x.more ? ` ${x.more}` : ""}.` : `${name(x.card)}: ${who} can attack only if you pay ${x.cost}${x.more ? ` ${x.more}` : ""}.`);
    }
    for (const x of R.others.slice(0, 3)) lines.push(`${name(x.card)} (${nameOf(x.ctl)}): ${x.sentence}`);
  }
  if (taxed.length || own.length) {
    const me = gv.players?.find((p) => p.id === slot);
    const pool = Object.values(me?.manaPool || {}).reduce((n, v) => n + Math.max(0, Number(v) || 0), 0);
    const open = mineOn.filter((c) => !c.tapped && !c.phasedOut
      && ((c.types || []).includes("Land") || /(?:^|\n)\{T\}(?:, [^:\n]*)?: Add\b/.test(attackRulesText(c)))).length;
    lines.push(`You have about ${open + pool} mana open. Attackers tap before you pay, so an attacking mana creature can't help pay.`);
  }
  // limits, for every attack or at a defender
  for (const l of attackLimits(gv, E, R)) {
    if (l.at && !defenders.includes(l.at)) continue;
    const at = l.at ? ` ${limitAt(gv, input, l)}` : "";
    lines.push(`${limitWho(l)}: at most ${l.n} creature${l.n === 1 ? "" : "s"} can attack${at || " each combat"}.`);
    if (!taxed.length) notes.push(`at most ${l.n} can attack${at || ""} (${name(l.card)})`);
  }
  // the player's creatures that can't attack at all, with the reason (tapped ones are plain to see)
  const cantAttack = {};
  const groups = new Map();
  const auras = (id) => R.onField.map(([c]) => c).filter((c) => c.attachedTo === id && /\benchanted creature can't attack\b(?![^.]*\bunless\b)/i.test(attackRulesText(c)));
  const reasonOf = (c) => {
    const u = E?.unavailable.find((x) => x.cardId === c.id && !x.defenderId);
    if (u) return engineCantWords(u);
    if (c.phasedOut) return "phased out";
    if (c.summoningSick && !hasKeyword(c, "Haste")) return "summoning sick";
    if (game?.detained?.has(c.id)) return "detained";
    if (hasKeyword(c, "Defender")) return "defender";
    const aura = auras(c.id)[0];
    if (aura) return name(aura);
    if (new RegExp(`(?:^|\\n|\\. )${escapeRe(name(c))} can't attack(?: or block)?\\.`, "i").test(attackRulesText(c)) || (c.keywords || []).some((k) => /^CARDNAME can't attack\b/i.test(String(k)))) return "its own text";
    const rule = R.cants.find((r) => !r.at && attackWordFits(c, r.only) === true && (!r.without || !hasKeyword(c, r.without)));
    return rule ? name(rule.card) : "an effect on the table";
  };
  for (const c of mineOn) {
    if (!(c.types || []).includes("Creature") || c.tapped || offeredIds.has(c.id)) continue;
    const why = reasonOf(c);
    cantAttack[c.id] = `${name(c)} can't attack: ${why}.`;
    const key = `${name(c)}|${!!c.identity?.isToken}|${why}`;
    groups.set(key, { c, why, n: (groups.get(key)?.n || 0) + 1 });
  }
  const cantList = [...groups.values()].map(({ c, why, n }) => {
    const token = !!c.identity?.isToken;
    return `${n > 1 ? `${n} ${token ? `${tokenBase(name(c))} tokens` : name(c)}` : tokenWords(name(c), token)} (${why})`;
  });
  if (cantList.length) lines.push(`Can't attack: ${cantList.join(", ")}.`);
  // (summoning sickness alone comes every turn: in the panel, not the corner)
  if (cantList.length && [...groups.values()].some((g) => g.why !== "summoning sick")) notes.push(`can't attack: ${cantList.join(", ")}`);
  // offered creatures that can't attack one defender: goad, Blazing Archon, or no reason the board shows
  for (const d of defenders) {
    const missing = offered.filter((a) => !a.validTargetIds.includes(d));
    if (!missing.length) continue;
    const why = (a) => {
      if (E) {
        const u = E.unavailable.find((x) => x.cardId === a.attackerId && x.defenderId === d);
        // (goad: by this player, or, at a planeswalker, "goaded" alone: it must attack a player it may attack instead)
        if (u?.reason === "goaded") return String(d).startsWith("player-") ? `goaded by ${nameOf(d)}` : "goaded";
        return u?.reason === "static" && u.sourceName ? u.sourceName : "";
      }
      const g = game?.goaded?.get(a.attackerId);
      if (g && g.by === d) return `goaded by ${nameOf(d)}`;
      const card = byId[a.attackerId] || {};
      const rule = R.cants.find((r) => r.at === ctlOf(d) && attackWordFits(card, r.only) !== false && (!r.without || !hasKeyword(card, r.without)));
      return rule ? name(rule.card) : "";
    };
    const reasons = missing.map(why);
    if (missing.length === offered.length && new Set(reasons).size === 1) {
      lines.push(`No creature of yours can attack ${defenderWords(gv, input, d)}${reasons[0] ? ` (${reasons[0]})` : ""}.`);
    } else {
      lines.push(`Can't attack ${defenderWords(gv, input, d)}: ${missing.map((a, i) => `${name(byId[a.attackerId] || { id: a.attackerId })}${reasons[i] ? ` (${reasons[i]})` : ""}`).join(", ")}.`);
    }
  }
  const note = notes.length ? `${taxed.length ? "Attack tax: " : ""}${notes.join("; ")}.` : "";
  return { lines, note: note.charAt(0).toUpperCase() + note.slice(1), cantAttack, taxAt };
}

// Whose attack tax a payment for an attacker is: "Propaganda (AI 1)", "Ghostly Prison + Norn's Annex (AI 1)",
// "Brainwash" (its own price), or null when no tax the board shows covers it. E: the attack question's engine data
// (engineAttackData), whose sources for this attacker and defender are said instead ("War Tax (AI 1)")
function attackTaxWords(gv, attackerId, targetId, E = null) {
  const ctl = String(targetId).startsWith("player-") ? targetId : cardIndex(gv)[targetId]?.controllerId;
  if (E) {
    const t = (E.costs[attackerId] || []).find((x) => x.defenderId === targetId);
    return t && t.sourceNames.length ? `${t.sourceNames.join(" + ")} (${nameOf(ctl)})` : null;
  }
  const R = attackRules(gv);
  const at = attackTaxesAt(R, ctl, targetId).map((t) => t.card.identity.name);
  const own = R.costs.filter((x) => x.on === attackerId).map((x) => x.card.identity.name);
  if (!at.length && !own.length) return null;
  return [...(at.length ? [`${at.join(" + ")} (${nameOf(ctl)})`] : []), ...own].join(", ");
}

// Whom the attackers left at "whom?" attack (item 25, the user 2026-11-10: "Attack" and "All attack" ask which player
// or planeswalker to attack). One step for all of them: a button per player or planeswalker any of them can attack, its
// tax said, "One by one" when there are several, and Back to the attack question. The options are "player|" and "card|"
// ids, the table's target surface, so a click on a life counter or a planeswalker answers too. A creature that can't
// attack the one picked is asked again with the rest. o: { asked: the attackers' options, byAttacker: attacker id ->
// target id or "?", cname(id): an attacker's words (chooseAttackers' attackerLabel), defender(id): its words, taxAt(id): the taxes on attacking it, done(byAttacker): the answer
// once none is left, back(): the attack question again }; each: one creature at a time.
function attackWhom(o, each = false) {
  const left = o.asked.filter((at) => o.byAttacker[at.attackerId] === "?");
  if (!left.length) return o.done(o.byAttacker);
  const group = each ? [left[0]] : left;
  const targets = [...new Set(group.flatMap((at) => at.validTargetIds))];
  const optId = (t) => (String(t).startsWith("player-") ? `player|${t}` : `card|${t}`);
  // (no colon in a label: the corner cuts a long one at its colon)
  const tax = (t) => { const x = o.taxAt(t); return x.length ? ` (tax ${x[0].summed ? x[0].cost : attackCostSum(x.map((y) => y.cost))} each)` : ""; };
  const names = group.map((at) => o.cname(at.attackerId));
  const others = left.length < o.asked.length && !each;
  const ui = {
    title: group.length === 1 ? `Attack whom with ${names[0]}?` : `Attack whom with ${others ? "the other " : ""}${group.length} creatures?`, mode: "single", kind: "choice",
    text: [group.length > 1 ? `Attacking: ${names.join(", ")}.` : "", "Click a life counter or a planeswalker, or a button.",
      group.some((at) => targets.some((t) => !at.validTargetIds.includes(t))) ? "One that can't attack your pick is asked again." : ""].filter(Boolean).join(" "),
    options: [...targets.map((t) => ({ id: optId(t), label: `${o.defender(t)}${tax(t)}` })),
      ...(group.length > 1 ? [{ id: "__each", label: "One by one" }] : []), { id: "__back", label: "Back" }],
    // (a timed-out player gets Forge's first target, not Back, which timeoutChoice takes first)
    onTimeout: optId(targets[0]),
  };
  const toOutput = (a) => {
    if (a[0] === "__back") return o.back();
    if (a[0] === "__each") return attackWhom(o, true);
    const t = String(a[0]).slice(String(a[0]).indexOf("|") + 1);
    const byAttacker = { ...o.byAttacker };
    for (const at of group) if (at.validTargetIds.includes(t)) byAttacker[at.attackerId] = t;
    return attackWhom({ ...o, byAttacker }, each);
  };
  return next(ui, toOutput);
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

// a static alternative cost by what the card says it is (Flare of Duplication: "sacrifice a nontoken red creature instead
// of its mana cost")
// (or a free cast as one, with its condition: Flawless Maneuver's and Fierce Guardianship's "If you control a commander,
// you may cast this spell without paying its mana cost." read "alternative cost", Kykar hand test #22)
function altCostWords(gv, cardId) {
  const text = String(cardIndex(gv || {})[cardId]?.text || "");
  const alt = text.match(/\bYou may ([^.]+?) rather than pay this spell's mana cost\b/i)?.[1];
  if (alt) return `${alt} instead of its mana cost`;
  const free = text.match(/(?:^|[.\n]\s*)(?:(?:If|As long as) ([^,.]+), )?you may cast (?:this spell|it) without paying its mana cost\b/i);
  return free ? `without paying its mana cost${free[1] ? ` (${free[1]})` : ""}` : "alternative cost";
}
// a token's name without Forge's " Token": "Treasure Token" -> "Treasure" (said "a Treasure token", re-test 2 bug d)
function tokenBase(name) { return String(name).replace(/ tokens?$/i, ""); }
// a card as the log names it: a token as "Goblin Shaman token"
function tokenWords(name, token) { return token ? `${tokenBase(name)} token` : name; }
// a list of names with each kind of token counted, in the order first seen: "Fog Bank, 2 Soldier tokens" (token stacks
// spec: twenty tokens read as twenty names). Other cards are listed as they are; with `article`, one token reads "a
// Soldier token". Takes names as tokenWords writes them.
function tokensCounted(names, article = false) {
  const counts = new Map();
  for (const n of names) if (/ token$/.test(n)) counts.set(n, (counts.get(n) || 0) + 1);
  const out = [];
  for (const n of names) {
    if (!counts.has(n)) { out.push(n); continue; }
    const k = counts.get(n);
    if (k === 0) continue; // (said already, counted)
    out.push(k > 1 ? `${k} ${n}s` : article ? `${/^[aeiou]/i.test(n) ? "an" : "a"} ${n}` : n);
    counts.set(n, 0);
  }
  return out.join(", ");
}
// a card's possessive: "Exchange of Words' ability", not "Exchange of Words's" (re-test 2 bug f)
function poss(name) { return /s$/i.test(String(name)) ? `${name}'` : `${name}'s`; }

// Forge's headings inside a list of choices: ChooseSourceEffect's fake cards ("--PERMANENTS:--", "--SPELLS ON THE
// STACK:--", "--OBJECTS REFERRED TO ON THE STACK:--", "--CARDS IN THE COMMAND ZONE:--") and TargetSelection's strings
// ("--CARDS ON BATTLEFIELD:--", "--CARDS IN EXILE:--" ...). A real choice such as "-- Pile 1 (0 cards) --" is none.
function isForgeHeading(label) { return /^--[A-Z][A-Z ]*:--$/.test(String(label ?? "").trim()); }
// a card's zone as a choice's label says it, when that is not the battlefield
const ZONE_SAID = { command: "command zone", stack: "on the stack", graveyard: "graveyard", exile: "exile", hand: "hand", library: "library" };
// Cards offered in one question that read alike are told apart by what differs (INV-6: Circle of Protection's source
// choice offered "Rograkh, Son of Rohgahh 0/1" twice, one commander each): the zone, whose it is, a token, the
// commander, and a number for what is still alike, as the legend rule's choice does. Copies that can't differ in a
// way that matters (two Mountains in one player's hand, library, graveyard or exile) are left alike. options: { id, label } with a
// card id; cards: the question's cards; me: the asked seat's slot.
function tellApart(options, cards, me) {
  const card = (o) => cards.find((c) => c.id === o.id);
  const groups = {};
  for (const o of options) if (card(o)) (groups[o.label] ??= []).push(o);
  for (const g of Object.values(groups)) {
    if (g.length < 2) continue;
    const cs = g.map(card);
    const differ = (f) => new Set(cs.map(f)).size > 1;
    const who = (c) => c.controllerId ?? c.ownerId;
    if (!differ((c) => c.zone) && !differ(who) && ["hand", "library", "graveyard", "exile"].includes(cs[0].zone)) continue;
    const tags = cs.map(() => []);
    if (differ((c) => c.zone)) cs.forEach((c, k) => tags[k].push(ZONE_SAID[c.zone] || c.zone || "battlefield"));
    if (differ(who)) cs.forEach((c, k) => tags[k].push(who(c) === me ? "yours" : `${nameOf(who(c))}'s`));
    if (differ((c) => !!c.identity?.isToken)) cs.forEach((c, k) => { if (c.identity?.isToken) tags[k].push("token"); });
    if (differ((c) => !!game?.commandIds?.has(c.id))) cs.forEach((c, k) => { if (game.commandIds.has(c.id)) tags[k].push("commander"); });
    // (inside a bracket the label already ends with: "(command zone, yours)", not "(command zone) (yours)")
    g.forEach((o, k) => { if (tags[k].length) o.label = /\)$/.test(o.label) ? `${o.label.slice(0, -1)}, ${tags[k].join(", ")})` : `${o.label} (${tags[k].join(", ")})`; });
    const still = {};
    for (const o of g) (still[o.label] ??= []).push(o);
    for (const same of Object.values(still)) if (same.length > 1) same.forEach((o, k) => { o.label += ` #${k + 1}`; });
  }
}

// Forge's plural of a word that is plural already (its Lang.getPlural adds "es" to any word ending in "s"): Mondrak's
// cost read "Sacrifice two other artifacts and/or creatureses", Kykar hand test #18. Undone for the nouns a cost counts
// (PLURAL_NOUNS), and for any word the card's own text has in its plain plural form (cardText: "Goblins" for "Goblinses"),
// in any case ("halflingses" for "Halflings"), unless the card's text has the "-ses" form itself. A word ending "ss",
// "us" or "is" is a singular whose plural "-ses" is right: "Kisses" stays beside "Kiss of the Amesha" (verify 2026-11-07);
// so are the few singulars in "ns" or "as" (SINGULAR_S: "two Lenses" beside "Lens Keeper" read "two Lens", verify
// 2026-11-09), named one by one, as most words in "ns" and "as" are plurals Forge doubles: Goblinses, Plainses, Hydrases.
const PLURAL_NOUNS = /^(?:creatures|artifacts|enchantments|permanents|tokens|spells|players|opponents|counters|planeswalkers|instants|sorceries|battles|cards|lands|nonlands)$/i;
const SINGULAR_S = /(?:ss|us|is)$|^(?:lens|gas|atlas|canvas|bias|alias)$/i;
function undoublePlural(text, cardText = "") {
  return String(text).replace(/\b([A-Za-z]+s)es\b/g, (m, w) => (PLURAL_NOUNS.test(w)
    || (cardText && !SINGULAR_S.test(w) && new RegExp(`\\b${escapeRe(w)}\\b`, "i").test(cardText) && !new RegExp(`\\b${escapeRe(m)}\\b`, "i").test(cardText)) ? w : m));
}

// Engine text names players by relay username; show TTS colors / "AI n" instead.
function displayText(text) {
  if (!game || !text) return text;
  return tableNames(undoublePlural(withoutForgeNotes(String(text))));
}
// Every relay username in a text as the game log names that player ("White", "AI 1"), nothing else changed: displayText's
// last step, and the net every message to the table goes through (pump), so no path can show "self-hosted-node-…-bot"
// (a creature's "Protection from self-hosted-node-…-bot" reached the table's keyword box, 2026-11-06 game; the live
// check 2026-11-11 saw the raw id on a prompt). Before a game, or with no player list yet, the text as it is.
function tableNames(text) {
  if (!game?.playerOrder?.length || !text) return text;
  // (every name in one pass, the longest first: the second AI is "<node>-bot 2", which holds the first's "<node>-bot",
  // and name by name it read "AI 1 2", keyword sweep kw-15 "Mob Verdict: choose one :: AI 1 / AI 1 2")
  // (case-insensitive: the engine sometimes capitalises names, "Self-hosted-node-…-bot picked …")
  // (made once per player list, game.nameMatch: every prompt's text comes through here)
  const key = game.playerOrder.join("\n");
  if (game.nameMatch?.key !== key) {
    // (only the relay's own forms, "tts-<colour>-<4>" and "…-bot", whole: this runs over whole JSON messages too (pump),
    // where a short name would hit keys and words; a test game's "ai" turned the "ai" key and "AI 1" into "AI 1 1")
    const names = game.playerOrder.map((username, i) => [String(username || ""), i]).filter(([u]) => /^tts-\w+-|-bot(?: \d+)?$/i.test(u)).sort((a, b) => b[0].length - a[0].length);
    game.nameMatch = { key, slotOf: new Map(names.map(([u, i]) => [u.toLowerCase(), i])), any: names.length ? new RegExp(`(?<![\\w-])(?:${names.map(([u]) => escapeRe(u)).join("|")})(?![\\w-])`, "gi") : null };
  }
  const { slotOf, any } = game.nameMatch;
  return any ? String(text).replace(any, (m) => nameOf(`player-${slotOf.get(m.toLowerCase())}`)) : text;
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
  // (proliferate's own step, Forge's lblChooseProliferateTarget: Experimental Augury, whose text has another "put" too,
  // read "choose up to 1 card", Kykar hand test #23)
  [/^Choose any number of permanents and\/or players for proliferate$/i, (m, { src }) => ({ title: `${src}: give which another counter (proliferate)?` })],
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
  // (the Ring's tempting, Forge's lblChooseRingBearer: Claim the Precious read "choose a card", live check 9)
  [/^Choose your Ring-bearer$/i, () => ({ title: "The Ring: choose your Ring-bearer", text: "It becomes legendary and has the Ring's abilities so far." })],
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
    && { title: `${src}: haunt which creature?`, note: `${src} is exiled haunting it; when that creature dies, ${poss(src)} haunt trigger happens again.` },
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
// (a bare number not the end of a range: "among one or two target creatures" and "one, two, or three target creatures"
// read "among one or which creatures", verify 2026-11-07; those keep the generic title)
const MANY_TARGETS = /\b(?:any number of|up to (?:two|three|four|five|six|seven|eight|nine|ten|\d+|X)|(?<!\bor |, )(?:two|three|four|five|\d+|X)) (other )?target\b/i;
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
    // (and both zones whole: Mairsil's "from your hand or graveyard" read "from your hand?" over a graveyard card,
    // rebuilt hand test #14)
    else if (kind === "cards" && (m = s.match(/\bexile (?:an?|one) ((?:[\w-]+,? ){1,3})card from your (hand or graveyard|graveyard or hand|hand|graveyard)\b/i))) found.push(`exile which ${m[1]}card from your ${m[2]}?`);
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
    // (several targets, one "target" in the sentence: Guardian of Faith's "any number of other target creatures you
    // control phase out" read "choose up to 70 targets", Clever Concealment's "choose up to 120 targets", Kykar #23)
    } else if (kind === "targets" && (s.match(/\btarget\b/gi) || []).length === 1 && MANY_TARGETS.test(s)) {
      const q = s.replace(/\.$/, "").replace(MANY_TARGETS, (m, other) => (other ? "which other" : "which"));
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

// A fused split card's half whose target the candidates are ("(Wear) Destroy target artifact." over artifacts), or null.
// Only while the spell's ability text is the Fuse reminder: a half cast alone has its own text. The halves, from the card
// text Forge sends ("(Wear) Destroy target artifact.\nFuse (...)\r\n\r\n(Tear) ..."), are kept by name for the copy, whose
// card is in no zone (game.splitHalves). typesAll(t): every candidate has card type t.
function fusedHalf(name, cardText, abilityText, typesAll) {
  if (!/ \/\/ /.test(String(name || ""))) return null;
  const halves = [...String(cardText || "").matchAll(/^\(([^()]+)\) ([^\r\n]+)/gm)].map((m) => ({ name: m[1], text: m[2].trim() }));
  if (game && halves.length > 1) (game.splitHalves ??= {})[name] = halves;
  const known = halves.length > 1 ? halves : game?.splitHalves?.[name] || [];
  if (known.length < 2 || !/^Fuse\b/.test(String(abilityText || ""))) return null;
  const fits = known.filter((h) => { const t = /\btarget ([a-z]+)\b/i.exec(h.text)?.[1]; return !!t && typesAll(t[0].toUpperCase() + t.slice(1).toLowerCase()); });
  return fits.length === 1 ? fits[0] : null;
}

// X's value now, from the asking ability's "where X is <card>'s power" and that card on the board: Esper Sentinel's
// "Pay {X}?" didn't say what X was (Kykar probe 2026-11-07). null when the text says no such thing. Power only: the
// cards that make a player pay {X} by a card's stat (Esper Sentinel, Mausoleum Wanderer, Tomakul Phoenix) all say power.
function xNow(abilityText, sourceCard, byId) {
  const m = /\bwhere X is ([^.,]+?)'s power\b/i.exec(String(abilityText || ""));
  if (!m) return null;
  const card = sourceCard && m[1] === sourceCard.identity?.name ? byId[sourceCard.id] || sourceCard
    : Object.values(byId).find((c) => c.identity?.name === m[1]);
  return card?.power != null && Number.isFinite(Number(card.power)) ? { n: Number(card.power), why: `X is ${m[1]}'s power` } : null;
}

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
  // (nor one about another player: Esper Sentinel's No read "No: aI 1 draws a card", Kykar probe 2026-11-07)
  if (Object.values(game?.slotNames || {}).some((n) => n && s.startsWith(`${n} `))) return s;
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
      poison: trackMarks(p, gv).values.poison,
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

// ───────────────────────── A question of the bridge's own under the engine's (askUnder) ─────────────────────────
// The bridge asks the player something of its own while the engine's question stays open underneath: "how do you play
// it?" (a card with several ways), "cast it now?" (Necromancy outside a sorcery's time), "which ability?" and "which
// mana?" (a card turned with Q/E), the colour of a "Mana: tap X" button. Unlike steps (next()), its way back returns to
// the question underneath exactly as it was, and the card the gesture moved is put back on the table (refused).
//   ui: the sub-question (prepareUi runs here); pick(picks): the engine's answer for any other option
//   back: the label of its way back, an option of its own (added last, id "__back": the panel lists it and the timer
//   takes it first, timeoutChoice; the corner shows only the first option and End turn / Resolve all / No / Cancel, so
//   not Back, engine-renderer.lua engineUpdateCorner); returns: the card id put back (null: none)
// The question underneath is kept as seat.prompt.under ({ ui, toOutput, step, returns }) while the sub-question is open,
// and Back re-sends it as it was first sent (its ui, its step: none for the engine's question).
// One at a time: onIntent refuses every gesture while one is open, and E is asked only from the priority question's own
// answer, so a sub-question is never asked under another. Closed any other way than by its own answer (a new engine
// question, mtg skip, auto-resolve, a fix holding the question, a rewind: closePrompt), its card goes back too.
// Returns ASKED, what a toOutput returns once it has asked a sub-question itself (onAnswer then sends nothing). Needs an
// open question (seat.prompt) to ask under.
const ASKED = { asked: true };
function askUnder(seat, ui, pick, { back, returns = null }) {
  const p = seat.prompt;
  const under = { ui: p.ui, toOutput: p.toOutput, step: p.step, returns };
  ui.options = [...(ui.options || []), { id: "__back", label: back }];
  prepareUi(ui);
  const toOutput = (picks) => {
    if (picks[0] !== "__back") return pick(picks);
    // (the card dragged out goes back where it came from: nothing else redraws it, playtest 2026-10-26)
    if (under.returns) toTTS({ t: "refused", color: seat.color, id: under.returns });
    // (its own step kept: the table's corner keys a question by id and step, and a new step made it a new question,
    // finding 5. Its ui as it was sent, not worded again: onPrompt worded it once)
    seat.prompt = { ...seat.prompt, ui: under.ui, toOutput: under.toOutput, step: under.step, under: null };
    showPrompt(seat);
    return ASKED;
  };
  seat.prompt = { ...p, ui, toOutput, step: Date.now() % 100000, under };
  showPrompt(seat);
  return ASKED;
}
// The seat's open question sent to its panel as it is kept: seat.prompt's id, its step (none for an engine question
// as first asked) and its ui. Every re-send goes through here, so what is shown is what is stored, and a later
// sub-question saves the step the table really saw (the table's corner keys a question by id and step,
// engine-renderer.lua engineUpdateCorner). extra: fields for this message only (resendToTable's `cards`).
function showPrompt(seat, extra = {}) {
  const p = seat.prompt;
  toTTS({ t: "prompt", color: seat.color, promptId: p.promptId, step: p.step, ...p.ui, ...extra });
}

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

// A choice among players and permanents that is no target (Forge's chooseSingleEntityForEffect over a mixed list, which
// the harness asks as a chooseFromSelection of labels: Zevlor's copy over a player and their permanents, a creature put
// onto the battlefield attacking choosing whom it attacks; a list of cards alone is asked as cards instead) names each
// by Forge's toString: a player by its engine name, a card as "<name> (<Forge's number>)", a number that is not our
// card id. So a card is known by its name, when exactly one card of that name is on the battlefield, face up (one of
// that name in another zone doesn't count: the list is of players and permanents, and a dead Jace Beleren in a graveyard
// left the live Jace unmapped, live check 2026-11-11). All of them known, with a card among them: the target ids, in the
// options' order, that the table answers by clicking a life counter or the card (item 24, planeswalkers by click,
// 2026-11-11); else null, and the list is asked as before.
function entityChoiceIds(options, gv) {
  const ids = [];
  for (const o of options) {
    const e = entityLabel(o, gv);
    if (e?.slot) { ids.push(`player|${e.slot}`); continue; }
    if (!e || e.field.length !== 1 || e.field[0].isFaceDown) return null;
    ids.push(`card|${e.field[0].id}`);
  }
  return ids.some((v) => v.startsWith("card|")) && new Set(ids).size === ids.length ? ids : null;
}
// One option of such a list, read from Forge's label: { slot } for a player (by engine name), { name, field: every card
// of that name on the battlefield } for "<name> (<Forge's number>)", else null. (entityChoiceIds and entityWords)
function entityLabel(o, gv) {
  const label = String(o.label ?? "").trim();
  const k = label ? (game?.playerOrder || []).map((u) => String(u || "").toLowerCase()).indexOf(label.toLowerCase()) : -1;
  if (k >= 0) return { slot: `player-${k}` };
  const name = /^(.+) \(\d+\)$/.exec(label)?.[1];
  if (!name) return null;
  return { name, field: (gv.zones || []).filter((z) => z.zone === "battlefield").flatMap((z) => z.cards || []).filter((c) => c.identity?.name === name) };
}
// The same list in words, when entityChoiceIds can't map it (two permanents of one name): a player by table name, a
// card by its name and whose it is ("Jace Beleren (AI 1's planeswalker)"), never Forge's number ("Jace Beleren (201)",
// live check 2026-11-11); several alike are numbered. { labels, players: any player among them, walkers: every card a
// planeswalker on the battlefield, defenders: every card a planeswalker or battle on the battlefield (what a creature
// can attack), onField: every card on the battlefield }, or null for a list that isn't players and "<name> (<number>)"
// cards.
function entityWords(options, gv) {
  let cards = 0, players = false, walkers = true, defenders = true, onField = true;
  const words = options.map((o) => {
    const e = entityLabel(o, gv);
    if (!e) return null;
    if (e.slot) { players = true; return nameOf(e.slot); }
    const { name } = e;
    cards++;
    const these = e.field.filter((c) => !c.isFaceDown);
    const each = (...types) => these.length > 0 && these.every((c) => types.some((t) => (c.types || []).includes(t)));
    if (!these.length) onField = false;
    if (!each("Planeswalker")) walkers = false;
    if (!each("Planeswalker", "Battle")) defenders = false;
    // (none on the battlefield: by whose zone it is in, when all of that name are in one, "Ral Zarek (in AI 1's
    // graveyard)"; it read the bare name, nothing to tell it by, item 2 of the 2026-11-11 list)
    if (!these.length) {
      const where = (gv.zones || []).filter((z) => z.zone !== "battlefield" && (z.cards || []).some((c) => c.identity?.name === name && !c.isFaceDown));
      return where.length === 1 && where[0].ownerId ? `${name} (in ${nameOf(where[0].ownerId)}'s ${ZONE_SAID[where[0].zone] || where[0].zone})` : name;
    }
    const ctls = new Set(these.map((c) => c.controllerId));
    if (ctls.size !== 1 || !these[0].controllerId) return name;
    const types = these[0].types || [];
    const kind = types.includes("Planeswalker") ? "planeswalker" : types.includes("Battle") ? "battle" : types.includes("Creature") ? "creature" : "permanent";
    return `${name} (${nameOf(these[0].controllerId)}'s ${kind})`;
  });
  if (!cards || words.includes(null)) return null;
  const nth = {};
  const labels = words.map((w) => (words.filter((x) => x === w).length > 1 ? `${w} #${(nth[w] = (nth[w] || 0) + 1)}` : w));
  return { labels, players, walkers, defenders, onField };
}

// The creature such a list chooses a defender for (CR 506.3b, a creature put onto the battlefield attacking: Forge's
// addToCombat passes it as the chooser's "Attacker"): the harness sends Forge's own question, "Choose which defender to
// attack with <name>", as the description and the creature as the question's one target. { id, name }, or null for any
// other list, or from an engine that doesn't send it.
function defenderChoiceAttacker(input) {
  const asked = /^Choose which defender to attack with (.+)$/.exec(String(input.presentation?.description || "").trim());
  const targets = input.presentation?.targets || [];
  return asked && targets.length === 1 && targets[0].kind === "card" && targets[0].id ? { id: targets[0].id, name: asked[1] } : null;
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
// the list's own words for a skip (the table's engineAutoChoices), and where it stops
const SKIP_SAID = { upkeep: "Until upkeep", draw: "Until draw", main: "Until main phase", combat: "Until combat", blockers: "Until blockers",
  damage: "Until damage", main2: "Until main 2", end: "Until end step", mine: "Until my turn" };
const SKIP_WHERE = { upkeep: "the upkeep", draw: "the draw step", main: "the first main phase", combat: "beginning of combat and declare attackers",
  blockers: "the declare blockers step", damage: "the combat damage steps", main2: "the second main phase", end: "the end step" };
// Forge's steps in the table's words, for what the chat says of one ("Skip ended: combatBegin" read so, live check 12)
const STEP_WORDS = { untap: "untap step", upkeep: "upkeep", draw: "draw step", main1: "main phase", combatBegin: "beginning of combat",
  combatDeclareAttackers: "declare attackers step", combatDeclareBlockers: "declare blockers step", combatFirstStrikeDamage: "first-strike damage step",
  combatDamage: "combat damage step", combatEnd: "end of combat", main2: "second main phase", end: "end step", endOfTurn: "end step", cleanup: "cleanup step" };
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
// whether a skip stops at this step. "Until <phase>" stays on and stops at that phase in every turn, yours and the
// others' (the user, 2026-11-09 item 3: "the button is undone when a new phase pops up", "'Until combat' stops at my
// combat and my opponents'"); a phase Forge gives no priority in that turn (no attackers: no blockers step) is passed.
// "Until my turn" is one stop, as before (the whole of every other turn passed is Auto-resolve's job).
function skipStopsHere(skip, gv, slot) {
  return skip.phase === "mine" ? skipReached(skip, gv, slot) : SKIP_PHASES[skip.phase].includes(gv.step);
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
    if (kind !== "colour word") rest.sort((x, y) => String(x.label).localeCompare(String(y.label), undefined, { numeric: true }));
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
// The damage a mana ability deals to you, said with its button: " (1 damage to you)" for Adarkar Wastes' {W} or {U} but
// not its {C}, " (2 damage to you)" for Ancient Tomb (Kykar hand test #4: "Tap Adarkar Wastes for {W}" never said it).
// From the ability's own text when the action carries it ("{T}: Add {C}{C}. Ancient Tomb deals 2 damage to you."), else
// the card's line whose "Add" makes that mana (a payment's action names only the card); two such lines that disagree are
// told apart by the action's ability number. And City of Brass's "Whenever City of Brass becomes tapped, it deals 1
// damage to you." (name: the card's; another card's or "a creature" becoming tapped isn't this one's). Damage under a
// condition the table doesn't check says nothing: Tomb of Urami's "... deals 1 damage to you if you don't control an
// Ogre" (verify 2026-11-07); a wrong amount is worse than none. Forge's ability number is the card's mana-ability index,
// which needn't follow the text's lines (an ability the card has from its type or another card comes in too), so the
// colour decides first and the number only between lines that both make it.
function manaPainText(a, cardText, name) {
  const n = manaPainDamage(a, cardText, name);
  return n ? ` (${n} damage to you)` : "";
}
// A mana choice's label: the colour it makes (manaLabel) and its pain, else Forge's words, else the fallback
function manaChoiceText(a, card, fallback) {
  const l = manaLabel(a);
  return (l || a.description || fallback) + (l ? manaPainText(a, card?.text, card?.identity?.name) : "");
}
// (the amount manaPainText says, 0 for none: also what notePain records for the log)
function manaPainDamage(a, cardText, name) {
  const isAdd = (l) => /:\s*Add\b/.test(l);
  const lines = isAdd(String(a.description || "")) ? [String(a.description)] : String(cardText || "").split(/\r?\n/).filter(isAdd);
  const made = [...producedColours(a, (c) => /^[WUBRGC]$/.test(c))];
  const fits = made.length ? lines.filter((l) => {
    const add = l.slice(l.search(/:\s*Add\b/));
    return made.every((c) => add.includes(`{${c}}`) || (c !== "C" && /\bone mana of any colou?r\b/i.test(add)));
  }) : [];
  // (the sentence that deals it, whole: with an "if" or "unless" in it, no amount)
  const dmg = (l) => {
    const s = String(l || "").split(/(?<=\.)\s+/).find((x) => /\bdeals \d+ damage to you\b/.test(x));
    return s && !/\b(?:if|unless|as long as)\b/i.test(s) ? Number(/\bdeals (\d+) damage to you\b/.exec(s)[1]) : 0;
  };
  let n = fits.length && fits.every((l) => dmg(l) === dmg(fits[0])) ? dmg(fits[0])
    : fits.includes(lines[a.abilityIndex]) ? dmg(lines[a.abilityIndex]) : 0;
  const tapped = name ? String(cardText || "").split(/\r?\n/).find((l) => l.startsWith(`Whenever ${name} becomes tapped, `)) : null;
  n += Number(/\bbecomes tapped, it deals (\d+) damage to you\b/i.exec(dmg(tapped) ? tapped : "")?.[1] || 0);
  return n;
}
// A mana creature's or artifact's priority button by what its mana ability costs: "Mana: tap Llanowar Elves", but "Mana:
// Kykar, Wind's Fury (sacrifice a Spirit)", "Mana: tap Lotus Petal (also sacrifice it)" and "Mana: Simian Spirit Guide
// (exile it from your hand)" (Kykar hand test #1: every one said "tap", and Kykar's ability doesn't tap). acts: the card's
// mana abilities; with different costs, "tap" only when every one of them taps.
function manaButtonLabel(name, acts) {
  const costs = [...new Set(acts.map((a) => String(a.cost || "{T}")))];
  const taps = (c) => c.split(/,\s*/).includes("{T}");
  if (costs.length === 1) return `Mana: ${taps(costs[0]) ? "tap " : ""}${name}${manaCostExtra({ cost: costs[0] })}`;
  return `Mana: ${costs.every(taps) ? "tap " : ""}${name}`;
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

// Auto-pay that keeps the colours the hand needs (Arena's auto-tapper does; Forge's took 4 of 5 Forests for a scavenge
// {4}{B} with 4 Plains untapped, so Bear Umbra's {2}{G}{G} was lost, mechanic run hp-17). owed: the cost still owed;
// acts: the payment's actions; hand: the other cards in hand; cards: the card index. Returns the action to tap next, or
// null when the whole cost can't be planned from plain {T} sources (then Forge's own auto-pay does it).
// Each source taps once; the cheapest to lose first: the fewest hand cards needing its colours (a creature counts half
// a card more, so it goes after a land nothing needs but before one the hand needs), then a painless ability before one
// that deals damage to you (a pain land's {C} before its coloured one), then the card making fewer colours (a basic
// before a dual land).
function smartPayTap(owed, acts, hand, cards) {
  const syms = [...String(owed || "").matchAll(/\{([^}]+)\}/g)].map((m) => m[1].toUpperCase());
  if (!syms.length || syms.some((x) => !/^(\d+|[WUBRGC])$/.test(x))) return null;
  const made = (a) => producedColours(a, (c) => /^[WUBRGC]$/.test(c));
  const plain = acts.filter((a) => (a.type === "activateManaAbility" || a.isManaAbility) && a.cardId && (!a.cost || a.cost === "{T}")
    && made(a).size > 0 && (a.producedMana || []).reduce((n, m) => n + (Number(m.amount) || 1), 0) <= 1);
  const need = {};
  for (const c of hand) for (const col of new Set([...String(c.manaCost || "").matchAll(/[WUBRG]/g)].map((m) => m[0]))) need[col] = (need[col] || 0) + 1;
  // (a card's colours over all its actions: a dual land is two actions of one colour each, so one action's colours
  // could never tell it from a basic)
  const colsOf = (cardId) => new Set(plain.filter((a) => a.cardId === cardId).flatMap((a) => [...made(a)]));
  const loss = (cardId) => [...colsOf(cardId)].reduce((n, col) => n + (need[col] || 0), 0) + ((cards[cardId]?.types || []).includes("Creature") ? 0.5 : 0);
  // (Llanowar Wastes' "{B} or {G}" deals 1 damage to you: it paid a generic {1} whenever Forge listed it first)
  const pain = (a) => (/\bdamage to you\b/i.test(String(a.description || "")) ? 1 : 0);
  const used = new Set(), taps = [];
  const pick = (ok) => {
    const best = plain.filter((a) => !used.has(a.cardId) && ok(a))
      .sort((x, y) => loss(x.cardId) - loss(y.cardId) || pain(x) - pain(y) || colsOf(x.cardId).size - colsOf(y.cardId).size)[0];
    if (best) { used.add(best.cardId); taps.push(best); }
    return !!best;
  };
  const colours = syms.filter((x) => !/^\d+$/.test(x));
  const scarce = (col) => plain.filter((a) => made(a).has(col)).length;
  for (const col of [...colours].sort((x, y) => scarce(x) - scarce(y))) if (!pick((a) => made(a).has(col))) return null;
  const generic = syms.filter((x) => /^\d+$/.test(x)).reduce((n, x) => n + Number(x), 0);
  for (let i = 0; i < generic; i++) if (!pick(() => true)) return null;
  return taps[0] || null;
}

// The colours a mana action makes: its producedMana's, else the colour its id ends in ("tap:engine-card-9:G"). keep:
// which of producedMana's count (smartPayTap keeps WUBRGC only, so an "ANY" falls back to the id). One reading for the
// three that need it (manaRank, the payment's rank, smartPayTap; it was written three times, suite review 2026-11-05).
function producedColours(a, keep = () => true) {
  const set = new Set((a.producedMana || []).map((m) => String(m.color || "").toUpperCase()).filter(keep));
  const c = String(a.id || "").match(/:([WUBRGC])$/);
  if (!set.size && c) set.add(c[1]);
  return set;
}

function manaRank(cost, a) {
  const made = producedColours(a);
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

// A board still waiting in scheduleTable's 40 ms, with something on the stack the log hasn't seen: sent (and logged)
// before its priority is answered. One passed by itself resolves it before the next board, and what no logged board
// showed was never said (Fire's prowess trigger, cast in your main phase and passed like Arena, read only "casts Fire //
// Ice", mechanic run hp-40 2026-11-05).
function logPriorityStack(gv) {
  if (!tableQueued || !game?.logPrev) return;
  const logged = new Set(Object.values(game.logPrev.stack || {}).flatMap((s) => s.sids || []));
  if ((gv.stack || []).some((x) => !logged.has(x.id))) guarded("sendTable", sendTable);
}

// "End turn" pressed this turn: priority passes and the attack is skipped until the turn number changes; from another
// turn it is forgotten. One check for both (structural review 2026-10-27: it was written twice).
function endTurnHolds(seat, gv) {
  if (seat.endTurnAt != null && seat.endTurnAt === gv.turn) return true;
  seat.endTurnAt = null;
  return false;
}
// "Resolve all" and "Resolve N× <name>" (seat.resolveStack): the seat's own priority passes while the stack resolves.
// One round trip per stack item was most of a big stack's wait (3 games 2026-11-12: 49 Resolve and 43 Resolve all
// presses, 26 of those cut short by the player's own new triggers, 450 ms a pass at one item and 1800 ms at 11+). Only
// this seat's priority is passed: every other player, the AI and a second person, is still asked by the engine on each
// item as usual, and a question (a target, a choice, an order) is asked as usual and the passing goes on after it.
//   { ids: the stack items there at the press, by: whose priority was passed (forP or the seat), turn, step,
//     passes: passes made, seen: stack signature -> times seen, group: the run's key ("Resolve N×") or null, left,
//     label: the button's words, for the chat line }
// A run of the same trigger on top of the stack (same controller, same source name, same text, no targets): Monk
// Token's prowess from eight different tokens is one run.
const RESOLVE_ALL_CAP = 200; // passes in a row, then it stops and says so
const RESOLVE_LOOP_REPEATS = 4; // the same stack (names, texts, controllers) seen this often: a loop, it stops
// A stack item's text as the table shows it (its tx) and as a run compares it: Forge's stack text names cards with its
// own number ("Change the text of Goblin King (37) by ...", hp-25 T5; "Monk Token (281)" from each token), and
// "Ponder (18) - " in front, which the table's pop-up also cuts, goes first.
const stackText =(s) => displayText(s.text || "").replace(/^[^\n]{0,100}?\(\d+\) - /, "").replace(/([A-Za-z'’,]) \(\d+\)/g, "$1");
const stackRunKey = (s) => `${s.controllerId}\u0001${s.identity?.name || "?"}\u0001${stackText(s)}`;
// how many items on top of the stack make one run of `who`'s untargeted abilities alike, and its key (abilities only:
// a spell is one press each, and a spell's targets may not all be listed)
function stackRun(stack, who, gv) {
  const top = stack[stack.length - 1];
  const alike = (s) => s && s.controllerId === who && !(s.targets || []).length && isAbilityOnStack(s, gv) && stackRunKey(s) === stackRunKey(top);
  let n = 0;
  while (alike(stack[stack.length - 1 - n])) n++;
  return { n, key: n ? stackRunKey(top) : null, name: top?.identity?.name || "?" };
}
function startResolving(gv, who, group) {
  const stack = gv.stack || [];
  const run = group ? stackRun(stack, who, gv) : null;
  return { ids: new Set(stack.map((x) => x.id)), by: who, turn: gv.turn ?? null, step: gv.step ?? null, passes: 0, seen: new Map(),
    group: run?.key || null, left: run ? run.n - 1 : 0, label: run ? `Resolve ${run.n}× ${run.name}` : "Resolve all" };
}
// The reason "Resolve all" ends at this priority: null to pass on, "" to stop without a word (the stack is empty, the
// run is done), or the words said when the question then shows. Ending it hands the priority back to the usual stops
// (worthStopping): one with nothing to stop for still passes by itself, and then nothing is said, the cap's and the
// loop's words included (only your own triggers left and no stop on: Arena-style passing, as without Resolve all).
function resolvingStops(seat, gv) {
  const rs = seat.resolveStack;
  const stack = gv.stack || [];
  if (!stack.length) return "";
  if ((rs.turn != null && gv.turn !== rs.turn) || (rs.step != null && gv.step !== rs.step)) return `${rs.label} stopped: ${gv.turn !== rs.turn ? "a new turn began" : "the step changed"}.`;
  // (someone else answered: a new item that isn't this player's; an item there at the press is passed as before)
  const theirs = stack.find((x) => !rs.ids.has(x.id) && x.controllerId !== seat.slot && x.controllerId !== rs.by);
  if (theirs) return `${rs.label} stopped: ${nameOf(theirs.controllerId)} put ${theirs.identity?.name || "something"} on the stack.`;
  if (rs.group) {
    if (rs.left <= 0 || stackRunKey(stack[stack.length - 1]) !== rs.group || (stack[stack.length - 1].targets || []).length) return "";
  }
  if (rs.passes >= RESOLVE_ALL_CAP) return `${rs.label} stopped after passing ${RESOLVE_ALL_CAP} times by itself. Press it again to go on.`;
  const sig = stack.map(stackRunKey).join("\u0002");
  const seen = (rs.seen.get(sig) || 0) + 1;
  rs.seen.set(sig, seen);
  if (seen >= RESOLVE_LOOP_REPEATS) return `${rs.label} stopped: the same stack came back ${seen} times (a loop?). Press it again to go on.`;
  return null;
}
// The players a seat controls now (Forge's controlledBy: Mindslaver's turn, Opposition Agent's search).
function ruledBy(gv, slot) {
  return (gv.players || []).filter((p) => p.id !== slot && p.controlledBy === slot).map((p) => p.id);
}
// The controlled player a seat's question is about, or null for the seat's own. The engine sends a controlled player's
// questions to the seat that controls them and names that seat as the decider (engine/README.md, "A controlled player's
// prompts go to the controlling seat"), so the question itself never says whose it is; only what the board makes
// certain is read: a priority question is the priority holder's (one player holds priority at a time, and the board
// names them), the attack is the active player's, and a question of the card just played from such a question is that
// player's too (seat.actingFor). AI 1's main-phase priority under Mindslaver was passed unseen as "not your turn",
// Kykar re-test new bug 1.
// (what was played for a controlled player lasts that turn and that control only, and cards to choose that are all in
// the seat's own hand are its own choice, a discard of its own to that player's spell: a Mind Rot kept from an earlier
// question titled Blue's own discard "AI 1 (you control)", verify 2026-11-09; all in a controlled player's hand, that
// player's, Blue's own Mind Rot at AI 1 on AI 1's controlled turn, verify round 2)
function actingFor(seat, prompt, gv) {
  const ruled = ruledBy(gv, seat.slot);
  if (seat.actingFor && (seat.actingFor.turn !== gv.turn || !ruled.includes(seat.actingFor.p))) seat.actingFor = null;
  if (!ruled.length) return null;
  const type = prompt.input?.type;
  if (type === "chooseAction") return ruled.includes(gv.priorityPlayerId) ? gv.priorityPlayerId : null;
  if (type === "chooseAttackers") return ruled.includes(gv.activePlayerId) ? gv.activePlayerId : null;
  const cards = prompt.input?.cards || [];
  const allIn = (p) => { const hand = zoneOf(gv, "hand", p).cards || []; return cards.length > 0 && cards.every((c) => hand.some((x) => x.id === c.id)); };
  if (allIn(seat.slot)) return null;
  const holder = ruled.find(allIn);
  if (holder) return holder;
  const a = seat.actingFor, card = prompt.sourceCard?.id || prompt.input?.cardId;
  return a && card && a.card === card ? a.p : null;
}
function onPrompt(seat, prompt) {
  // (a new engine question while a sub-question was open, the engine asking again after a reconnect: that question is
  // gone, its card goes back now, and it is taken off the panel even when the bridge answers the new one itself, End
  // turn holding; review 2026-11-05 finding 4 and 2026-11-06)
  if (seat.prompt?.under) closePrompt(seat);
  seat.lastRawPrompt = prompt;
  if (game?.fix?.state === "applying") game.fix.activeAt = Date.now(); // (the engine is playing a fix's free plays: fixWatchdog)
  if (prompt.input?.type === "chooseAction") seat.priorityPromptId = prompt.promptId ?? 0; // (the log's "priority came back")
  // (the attack just declared is only the declaration's: its refusal and its tax payments come before any priority, so
  // priority ends it. A payment after that, a pump on an attacker in the same step or an ability a turn later, is no
  // attack tax: payManaCost)
  if (prompt.input?.type === "chooseAction" || prompt.kind === "priority") seat.lastAttack = null;
  // MTG_RAW=1 (tests): every question as the engine sent it, to see what a prompt carries
  if (process.env.MTG_RAW) log(`raw ${seat.color}: ${JSON.stringify(prompt).slice(0, 4000)}`);
  if (prompt.kind === "priority") { seat.respond(0, "chooseAction", { type: "pass" }); return; }
  // (Forge's zone headings in a source choice are fake cards, "--PERMANENTS:--", "--SPELLS ON THE STACK:--" ...
  // (ChooseSourceEffect): never options, Forge only asks again when one is picked, Kykar hand test #5 #24. The question
  // remembers it had them, see chooseCards.)
  if (prompt.input?.type === "chooseCards" && (prompt.input.cards || []).some((c) => isForgeHeading(c.identity?.name))) {
    prompt = { ...prompt, input: { ...prompt.input, cards: prompt.input.cards.filter((c) => !isForgeHeading(c.identity?.name)), sourceHeadings: true } };
  }
  const input = prompt.input || {};
  const type = input.type;
  const gv = seat.board?.state?.gameView || {};
  const byId = cardIndex(gv);
  // (a look at the top cards, not shown (see revealCards): the pick from among them shows them; with no such pick next,
  // nothing among them could be taken, and what was seen is said instead)
  if (seat.heldLook) {
    const held = seat.heldLook;
    seat.heldLook = null;
    const picks = ["chooseCards", "chooseFromSelection"].includes(type) ? [...(input.cards || []), ...(input.options || [])].map((c) => c.id) : [];
    if (!picks.some((id) => held.ids.includes(id))) chat(`[MTG] You looked at the top ${countWords(held.n, held.n, "card").replace(/^an? /, "")} of your library: ${held.names.join(", ")}. None of them could be chosen.`, seat.color);
  }
  // (whose question it is: a controlled player's, see actingFor; a new priority question ends what the last one played)
  const forP = actingFor(seat, prompt, gv);
  if (type === "chooseAction") { seat.actingFor = null; seat.splitAsk = null; }
  // (a face-down card of someone else's asks under no name: the ward question of the AI's cloaked Garruk's Companion read
  // "Garruk's Companion has ward: pay {2}" and "Pay {2} for Garruk's Companion", hp-20 gap)
  const fdSrc = prompt.sourceCard && (prompt.sourceCard.isFaceDown || byId[prompt.sourceCard.id]?.isFaceDown);
  if (fdSrc && (prompt.sourceCard.controllerId ?? byId[prompt.sourceCard.id]?.controllerId) !== seat.slot) {
    prompt = { ...prompt, sourceCard: { ...prompt.sourceCard, identity: { ...prompt.sourceCard.identity, name: "A face-down creature" }, text: "" } };
  }
  // (a question with no card, by the one card on the board whose text asks it: a token Mairsil's cage question, asked as
  // it entered from Helm of the Host's trigger, had no name, rebuilt hand test #6)
  const asked = !prompt.sourceCard && String(input.presentation?.title || "").replace(/\?$/, "").toLowerCase();
  if (asked && asked.length > 30) {
    const askers = Object.values(byId).filter((c) => c.identity?.name && String(c.text || "").toLowerCase().includes(asked));
    if (askers.length && askers.every((c) => c.identity.name === askers[0].identity.name)) prompt = { ...prompt, sourceCard: askers[0] };
  }
  // (the asking card's rules text, from the prompt or the board: "" when neither has it)
  const srcCardText = String(prompt.sourceCard?.text || byId[prompt.sourceCard?.id]?.text || "");
  // (a question of a tribute card's "if tribute wasn't paid" trigger, which Forge makes only when it wasn't: noted for
  // the log, see logEvents)
  // (not over "said": a second question of the same trigger must not have it said again)
  if (game && prompt.sourceCard?.id && /\bif tribute wasn't paid\b/i.test(String(prompt.sourceAbilityText || ""))) {
    game.tribute ??= new Map();
    if (game.tribute.get(prompt.sourceCard.id) !== "said") game.tribute.set(prompt.sourceCard.id, "unpaid");
  }
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
  if (type !== "payManaCost") { seat.autoPayFailedFor = null; seat.smartPay = null; }
  if (type !== "chooseBoolean") seat.cardsDone = null; // (only the question right after counts)
  // the cost being paid, for a "Choose a color" from a source tapped while paying (Command Tower)
  if (type === "payManaCost") seat.payingCost = input.manaCost || null;
  else if (type !== "chooseColor") seat.payingCost = null;
  const opts = (list) => list.map((o, i) => ({ id: String(o.id ?? i), label: o.label }));
  if (debugPrompt(seat, type, prompt, gv)) return;

  switch (type) {
    case "mulligan":
      // (Arena: "Keep" / "Mulligan"; how many were taken goes below, not in the question)
      ui = { title: "Keep this hand?", mode: "single", options: [{ id: "keep", label: "Keep" }, { id: "mull", label: friendlyFreeLeft(seat) > 0 ? "Mulligan (free)" : "Mulligan" }],
        ...(game?.friendly ? { text: friendlyText(seat) } : input.mulliganCount ? { text: `Mulligans so far: ${input.mulliganCount}.` } : {}) };
      toOutput = (a) => ({ type: "mulliganDecision", keep: a[0] === "keep", ...(friendlyExtra() ? { freeCards: friendlyExtra() } : {}) });
      break;
    case "mulliganPutBack":
      ui = { title: `Put ${countWords(input.count, input.count, "card")} on the bottom of your library`, mode: "multi", min: input.count, max: input.count,
        options: input.handCardIds.map((id) => ({ id, label: cname(id) })) };
      toOutput = (a) => ({ type: "mulliganPutBackDecision", cardIds: a });
      break;
    case "chooseAction": {
      const actions = planarActions((input.actions || []).filter((a) => a.type !== "undoMana" && !a.isManaAbility), gv, cname);
      if (process.env.MTG_TRACE) {
        const special = actions.filter((a) => (a.type === "cast" && a.mode?.type && a.mode.type !== "normal") || (a.type === "activateAbility" && /ninjutsu|web/i.test(a.description || "")));
        if (special.length) log(`special actions ${seat.color} (${gv.step}): ${special.map((a) => `${a.label || a.description} ${JSON.stringify(a.mode || {})}`).join(" | ")}`);
      }
      if (holdForFix(seat, prompt, gv)) return;
      logPriorityStack(gv);
      // a spell or ability dragged while it wasn't this player's priority (during their blockers question, or while
      // someone else held priority): used now, at the first priority it can be (playtest 2026-10-24: Blue dragged
      // Galadriel's Dismissal while blocking, was told "wait", and combat passed by without asking)
      if (seat.queuedPlay) {
        const q = seat.queuedPlay;
        // (a two-faced card dragged showing one side: that side, never the other, docs/card-other-side-spec.md)
        const mine = actions.filter((a) => a.cardId === q.id && a.type !== "undoMana" && !a.isManaAbility);
        const sides = q.side ? mine.map((a) => actionSide(a, cardIndex(gv)[q.id])) : [];
        const queued = !q.side ? mine[0] : mine.find((a, i) => sides[i] === q.side) || (sides.some((s) => s != null) ? null : mine[0]);
        let act = Date.now() - q.at < QUEUED_PLAY_MS && queued;
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
      // "Resolve all" / "Resolve N×": keep passing through what was there and this player's own new triggers; another
      // player's new item, a new step or turn, an empty stack, the end of the run or the cap stops it (resolvingStops)
      const stackIds = (gv.stack || []).map((x) => x.id);
      let resolveSaid = "";
      if (seat.resolveStack) {
        const why = resolvingStops(seat, gv);
        if (why === null) {
          seat.resolveStack.passes++;
          if (seat.resolveStack.group) seat.resolveStack.left--;
          seat.respond(prompt.promptId, type, { type: "pass" });
          return;
        }
        seat.resolveStack = null;
        resolveSaid = why;
      }
      // Your own main phase waits for you when you can do something there (Pass / End turn); with nothing to do it
      // passes by itself, like Arena (see worthStopping).
      // (the player whose priority it is: a player this seat controls asks as itself, its main phase its own, see actingFor)
      const who = forP || seat.slot;
      const myMain = gv.activePlayerId === who && /main/i.test(gv.step || "");
      // Arena-style stops: besides your main phases, you only get asked when an opponent put something on the
      // stack you could answer, or in a step you switched a stop on for (panel: Start of turn / Combat / End of turn).
      const opponentsStack = (gv.stack || []).some((x) => x.controllerId !== who);
      const stepStop = [...(seat.stops || DEFAULT_STOPS)].some((group) => (STOP_STEPS[group] || []).includes(gv.step));
      // your own main phase only when you can actually do something there (Arena passes it otherwise); your own spell
      // waiting to resolve only when you hold a spell to answer it with (ownSpellStop, below)
      // ninjutsu (and sneak) only work after blockers are declared (Forge skips that step when nobody can block, so the
      // damage steps count too): always stop there when you can use one, even with
      // the Combat stop off (otherwise Arena-style passing skipped the only moment it is allowed)
      // someone is attacking and you could respond: asked after attackers and after blockers are declared, as Arena does
      // when you hold an instant (playtest 2026-10-24: with the Combat stop off, Blue's Galadriel's Dismissal never got
      // the chance while Yellow attacked)
      const attacking = (gv.zones || []).some((z) => z.zone === "battlefield" && (z.cards || []).some((c) => c.isAttacking));
      const combatStop = gv.activePlayerId !== who && attacking && ["combatDeclareAttackers", "combatDeclareBlockers"].includes(gv.step);
      // the attacker too, once blockers are declared and something blocks, as Arena does: the pump spell or the ping
      // for the blocker (live check 2026-11-11: Craw Wurm blocked Hero of Bladehold, and White, holding Giant Growth,
      // Lightning Bolt and Prodigal Pyromancer, was passed through blockers and damage). The blocks are Forge's
      // combatAssignments (blockerId, attackerId); a board that marks blockers on the card says isBlocking.
      const blocked = (gv.combatAssignments || []).some((a) => a.blockerId && a.attackerId)
        || (gv.zones || []).some((z) => z.zone === "battlefield" && (z.cards || []).some((c) => c.isBlocking));
      const attackerStop = gv.activePlayerId === who && attacking && blocked && gv.step === "combatDeclareBlockers";
      const ninjaStop = ["combatDeclareBlockers", "combatFirstStrikeDamage", "combatDamage"].includes(gv.step) && actions.some((a) =>
        (a.type === "activateAbility" && /ninjutsu/i.test(`${a.description || ""} ${a.label || ""}`)) ||
        (a.type === "cast" && a.mode?.type === "alternative" && a.mode.cost === "sneak"));
      // "mtg skip <phase>": passed until that phase; an opponent's spell or ability on the stack ends it there (see
      // SKIP_PHASES). Questions other than priority (targets, blocks, discards) are still asked.
      let skipStop = false;
      if (seat.skipTo) {
        const theirs = (gv.stack || []).find((x) => x.controllerId !== seat.slot);
        if (theirs || skipStopsHere(seat.skipTo, gv, seat.slot)) {
          // (said once per stop: each priority in that phase, or under that spell, asks without a second line)
          const once = seat.skipTo.phase === "mine";
          const key = theirs ? `stack|${theirs.id}` : `${gv.turn}|${gv.activePlayerId}|${seat.skipTo.phase}`;
          if (seat.skipTo.said !== key) {
            chat(`[MTG] ${once ? "Skip ended" : "Stopped"}: ${theirs ? `${theirs.identity?.name || "something"} (${nameOf(theirs.controllerId)}) is on the stack` : `${STEP_WORDS[gv.step] || gv.step}, ${gv.activePlayerId === seat.slot ? "your" : `${nameOf(gv.activePlayerId)}'s`} turn`}.${once ? "" : ` "${SKIP_SAID[seat.skipTo.phase]}" stays on.`}`, seat.color);
            seat.skipTo.said = key;
          }
          if (once) { seat.skipTo = null; autoNotice(seat); }
          skipStop = true; // (stopped there, whatever the step stops say)
        } else {
          seat.respond(prompt.promptId, type, { type: "pass" });
          if (seat.prompt) closePrompt(seat);
          return;
        }
      }
      // Auto-resolve: someone else's turn, so pass (your own turn still asks as usual)
      if (autoResolve[seat.color] && gv.activePlayerId !== who) {
        seat.respond(prompt.promptId, type, { type: "pass" });
        if (seat.prompt) closePrompt(seat);
        return;
      }
      // mana you tapped for and haven't spent can be taken back (the engine's undo for that source): you are always
      // asked then, so the land can be turned back instead of the mana being lost (playtest 2026-10-23: "I gotta be
      // able to untap without the full undo")
      // (only while mana floats: Forge keeps the undo list after an "unless you pay" cost paid during a trigger, so
      // Mystic Remora's upkeep left one "Untap Forest (mana back)" per land for mana already spent, hp-05)
      const pool = gv.players?.find((p) => p.id === who)?.manaPool;
      const floating = !pool || Object.values(pool).some((n) => n > 0);
      const undos = floating ? (input.actions || []).filter((a) => a.type === "undoMana" && a.cardId) : [];
      // "mtg hold": priority kept once this turn with something on the stack you could respond with (2026-10-29 request:
      // Flusterstorm on your own Bolt had no moment). Your own spell with a spell in hand stops by itself now
      // (ownSpellStop); hold still keeps it over your own trigger, or with only an ability to answer with.
      const holdStop = seat.hold === gv.turn && (gv.stack || []).length > 0 && actions.length > 0;
      if (holdStop) seat.hold = null;
      // your own spell on the stack while you hold a spell to answer it with: asked, in every step (live game 2026-11-11:
      // White's Lightning Bolt in main 1 resolved with no stop while Counterspell was castable, but over Giant Growth in
      // combat White was asked, by attackerStop). Not your own trigger, and not for an ability or mana alone.
      // (the top item only, the one that resolves next: Time Warp at the bottom stopped every one of the 22 triggers
      // above it, each its own press, 2026-11-12 prompt #643)
      const topItem = (gv.stack || [])[(gv.stack || []).length - 1];
      const ownSpellStop = !!topItem && topItem.controllerId === who && !isAbilityOnStack(topItem, gv) && actions.some((a) => a.type === "cast");
      const worthStopping = (myMain && !(gv.stack || []).length && actions.length > 0) || (actions.length && (opponentsStack || stepStop || ninjaStop || combatStop || attackerStop || ownSpellStop))
        || undos.length > 0 || skipStop || holdStop;
      // what a stop on someone else's spell offered (to see why "Resolve" came up)
      if (worthStopping && opponentsStack) log(`${seat.color} may respond to the stack with: ${actions.map((a) => a.label || a.description || a.id).join(" | ") || "(nothing)"}`);
      if (!worthStopping) {
        seat.respond(prompt.promptId, type, { type: "pass" });
        if (seat.prompt) closePrompt(seat);
        return;
      }
      // (why a "Resolve all" ended here, said only when it does stop: a stop that passes on by itself says nothing)
      if (resolveSaid) chat(`[MTG] ${resolveSaid}`, seat.color);
      // the way a spell is cast (web-slinging, flashback, back face, ...) and identical labels numbered
      const castLabel = (a) => {
        const m = a.mode || {};
        const how = m.type === "alternative" ? String(m.cost || "alternative cost").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
          : m.type === "backFaceLand" ? "back face" : m.type === "roomRightSplit" ? "right door" : m.type === "unlockDoor" ? "unlock door"
          : m.type === "foretellExile" ? "foretell (exile it face down)" : m.type === "staticAlternative" ? altCostWords(gv, a.cardId) : "";
        // the engine's own label already names the mode in brackets ("(WebSlinging)"): keep one readable version
        const base = how ? String(a.label || `Cast ${cname(a.cardId)}`).replace(/\s*\([A-Za-z]+\)$/, "") : (a.label || `Cast ${cname(a.cardId)}`);
        return `${base}${!how ? "" : /^without paying\b/.test(how) ? ` ${how}` : ` — ${how}`}`;
      };
      // mana abilities of creatures and artifacts (Delighted Halfling, mana rocks) as buttons; lands stay on Q/E
      const manaButtons = (input.actions || []).filter((a) => a.isManaAbility && a.cardId && !(byId[a.cardId]?.types || []).includes("Land"));
      // identical copies (four Forests) show once; several ways to cast the SAME card are numbered
      // (but not one permanent's ability for another's: three Mairsils could each destroy a tapped creature and the list
      // offered one, so the player couldn't pick which taps, rebuilt hand test #12)
      const labelCount = {}, labelCard = {}, labelCards = {};
      const onBattlefield = new Set((gv.zones || []).filter((z) => z.zone === "battlefield").flatMap((z) => (z.cards || []).map((c) => c.id)));
      const numbered = (label, cardId, ability) => {
        if (ability && labelCard[label] !== undefined && labelCard[label] !== cardId) {
          const cards = (labelCards[label] ??= [labelCard[label]]);
          if (!cards.includes(cardId)) cards.push(cardId);
          return `${label} (#${cards.indexOf(cardId) + 1})`;
        }
        if (labelCard[label] !== undefined && labelCard[label] !== cardId) return null;
        labelCard[label] = cardId;
        labelCount[label] = (labelCount[label] || 0) + 1;
        return labelCount[label] > 1 ? `${label} (option ${labelCount[label]})` : label;
      };
      // (Arena's pass button: "Resolve" while something is on the stack, "Next" otherwise; "Resolve all" passes until
      // the stack is empty; "Resolve N× <name>" the run of the same trigger on top, two or more, the user's idea
      // 2026-11-12: 8 Monk Token prowess triggers in one press)
      const run = stackRun(gv.stack || [], who, gv);
      ui = { title: forP ? `${nameOf(forP)}'s priority (you control)` : "Your priority", mode: "single", options: [{ id: "__pass", label: stackIds.length ? "Resolve" : "Next" },
        ...(run.n >= 2 ? [{ id: "__group", label: `Resolve ${run.n}× ${run.name}` }] : []),
        ...(stackIds.length ? [{ id: "__resolve", label: `Resolve all (${stackIds.length})` }] : []),
        { id: "__endturn", label: "End turn" }, ...actions.map((a) => ({
        id: a.id, cardId: a.cardId, label: numbered(a.type === "cast" ? castLabel(a) : a.planarRoll ? a.description : `${cname(a.cardId) || a.label || "Ability"}: ${undoublePlural(a.description || "ability", byId[a.cardId]?.text)}`, a.cardId, a.type === "activateAbility" && onBattlefield.has(a.cardId)),
        // (the ability alone, for the card's own buttons and menu: the table cut the name back off the label in two
        // places, structural review 2026-10-27)
        ...(a.type === "activateAbility" ? { ab: a.planarAb || displayText(undoublePlural(a.description || "ability", byId[a.cardId]?.text)) } : {}),
        // (which side of a two-faced card it plays: the card's menu lists the side it shows first)
        ...(actionSide(a, byId[a.cardId]) ? { side: actionSide(a, byId[a.cardId]) } : {}),
      })).filter((o) => o.label !== null), ...[...new Set(manaButtons.map((a) => a.cardId))].map((cid) => ({ id: `__mana:${cid}`, cardId: cid,
        label: manaButtonLabel(cname(cid), manaButtons.filter((m) => m.cardId === cid)) })), ...undos.map((a) => ({ id: a.id, cardId: a.cardId, label: `Untap ${cname(a.cardId)} (mana back)` }))] };
      toOutput = (a) => (a[0] === "__pass" ? { type: "pass" } : a[0] === "__endturn" ? (seat.endTurnAt = gv.turn, { type: "pass" })
        : a[0] === "__resolve" || a[0] === "__group" ? (seat.resolveStack = startResolving(gv, who, a[0] === "__group"), { type: "pass" })
        : String(a[0]).startsWith("__mana:") ? manaChoice(String(a[0]).slice(7)) : { type: "act", actionId: a[0] });
      // one button per mana creature/artifact; if it can make several kinds of mana, a question under this one asks
      // which (Back and a timeout return to priority and turn the card back: the table turns it at the button press,
      // engine-renderer.lua optimistic "Mana: tap", review 2026-11-06)
      const manaText = (m) => manaChoiceText(m, byId[m.cardId], "mana");
      const manaChoice = (cid) => {
        const acts = manaButtons.filter((m) => m.cardId === cid);
        if (acts.length === 1) return { type: "act", actionId: acts[0].id };
        return askUnder(seat, { title: `${acts.every((m) => /\{T\}/.test(String(m.cost || "{T}"))) ? "Tap" : "Use"} ${cname(cid)} for which mana?`, mode: "single", kind: "choice",
          options: distinctLabels(acts, manaText).map((label, i) => ({ id: acts[i].id, label })) }, (b) => ({ type: "act", actionId: b[0] }), { back: "Back", returns: cid });
      };
      // (what a controlled player plays: its payment and targets that follow are that player's too, actingFor)
      if (forP) {
        const base = toOutput;
        toOutput = (a) => { const out = base(a); if (out?.type === "act") seat.actingFor = { p: forP, card: (input.actions || []).find((x) => x.id === out.actionId)?.cardId, turn: gv.turn }; return out; };
      }
      break;
    }
    case "payManaCost":
      // Four seat fields about paying, kept apart on purpose (merging them changed behaviour, see
      // docs/reviews/structural-review-bridge-2026-10-20.md #2): autoPayCard = Forge's auto-pay asked for this card,
      // tappedFor = a source tapped by hand for it, autoPayFailedFor = auto-pay already failed for it (survives a tap),
      // smartPay = our own auto-pay under way for it ({ card, sent }: the card and the taps already sent, see smartPayTap).
      // Auto-pay fills the mana pool, then the engine asks to confirm: do that for the player.
      // Same after the player tapped the last source by hand: the cost is covered, so finish paying (like Arena). And
      // for a spell or ability the player just started while mana floats: Arena pays from the pool by itself (every
      // cast asked "Pay from mana pool", playtest 2026-10-26). A cost for someone else's card (a tax, ward) still asks.
      // (only for a payment that names its card: two missing ids are not "the same card", stage 3 review 2026-10-27)
      const ownJustNow = seat.justDid("start", 60000)?.id === input.cardId;
      // (not when life can pay part of it: a Phyrexian {B/P} is the player's choice, and Vraska's Compleated paid with
      // floating mana never offered the life, hp-22 #1 2026-10-28)
      const canPayLife = (input.actions || []).some((a) => a.type === "payLife" || a.id === "pay-life");
      if (input.cardId && (seat.autoPayCard === input.cardId || seat.smartPay?.card === input.cardId || seat.tappedFor === input.cardId || ownJustNow) && input.canConfirmFromPool && !canPayLife) {
        seat.autoPayCard = null;
        seat.smartPay = null;
        seat.tappedFor = null;
        seat.forget("start");
        seat.respond(prompt.promptId, type, { type: "pay", auto: false });
        return;
      }
      // (the cost less the pool's mana: what our auto-pay plans, the taps are ranked against and the title says)
      // (the payer's: a player this seat controls pays from their own pool and keeps their own hand, see actingFor)
      const payer = forP || seat.slot;
      const pool = gv.players?.find((p) => p.id === payer)?.manaPool || {};
      const owed = costLeft(input.manaCost, pool);
      // (our auto-pay under way: the next planned tap, or Forge's own auto-pay when the rest can't be planned)
      // (a tap already sent and offered again was not taken: Forge's auto-pay then, not the same tap sent for ever; a
      // payment answered by itself looped 1,600 times once, 2026-10-22 review)
      const handOthers = () => (zoneOf(gv, "hand", payer).cards || []).filter((c) => c.id !== input.cardId);
      if (input.cardId && seat.smartPay?.card === input.cardId && !input.canConfirmFromPool) {
        const next = smartPayTap(owed, input.actions || [], handOthers(), byId);
        if (next && !seat.smartPay.sent.includes(next.id)) { seat.smartPay.sent.push(next.id); seat.respond(prompt.promptId, type, { type: "act", actionId: next.id }); return; }
        seat.smartPay = null;
        seat.autoPayCard = input.cardId;
        seat.respond(prompt.promptId, type, { type: "pay", auto: true });
        return;
      }
      seat.smartPay = null;
      // Auto-pay already ran for this spell and the engine still asks: don't offer it again (it would loop).
      const autoFailed = seat.autoPayCard === input.cardId || seat.autoPayFailedFor === input.cardId;
      seat.autoPayFailedFor = autoFailed ? input.cardId : null;
      seat.autoPayCard = null;
      // When the pool already covers the cost the engine waits for "pay from pool"; asking it to auto-pay
      // again would just repeat this prompt, so that becomes the first (default) button.
      // (a land that can pay two needed colours pays the one no other source here offers: with Urborg, a Forest can
      // make {B} or {G}; for {B}{G} it made {B}, the Swamp {B} too, and nothing was left for {G}, 2026-10-22)
      const payActs = (input.actions || []).filter((a) => a.type !== "undoMana");
      seat.payingCost = owed; // (for a "Choose a color" that comes next: Command Tower)
      const rankOf = (a) => {
        const r = manaRank(owed, a);
        if (r < 2) return r;
        const others = payActs.filter((o) => o.cardId !== a.cardId && manaRank(owed, o) > 0);
        return [...producedColours(a)].some((col) => !others.some((o) => producedColours(o).has(col))) ? 3 : 2;
      };
      // a Phyrexian cost paid with life (our Forge build's "pay-life"): said as such and offered before the taps that
      // can't pay it (it read "pay-life", last, under "Tap Swamp for {B}" for Skrelv's {W/P}, playtest 2026-10-27)
      // (the protocol's PaymentAction { type: "payLife", amount }, manabrew protocol-types.json)
      const lifeAct = (input.actions || []).find((a) => a.type === "payLife" || a.id === "pay-life");
      const lifeN = lifeAct && Number.isFinite(Number(lifeAct.amount)) ? Number(lifeAct.amount) : null;
      // (which kind of tap pays for this spell, from its rules text: our Forge build sends Improvise's taps as mana
      // abilities with no cost and no mana, not the protocol's useResource, hp-12 re-test 2026-10-27)
      const payKind = resourceKindOf(byId[input.cardId]?.text || game?.cardText?.[input.cardId] || "");
      // (what is still owed once the pool's mana counts: Forge sends the cost before the pool is spent, and four Treasures
      // clicked one at a time each read "Pay {3}{U} for Inspiration" on the real table, 2026-11-05)
      const owes = owed !== input.manaCost && owed !== "{0}" ? `${owed} more` : input.manaCost;
      // (a tap that can pay none of what is owed isn't offered, when every symbol owed is one the rank reads: a colour,
      // generic, X, a hybrid of those or Phyrexian; a snow {S} or anything else keeps every tap. Viscera Seer's {B} offered
      // only "Tap Mountain for {R}", and Yellow tapped and undid it in a loop until Cancel, 2026-11-09 00:51)
      const plainOwed = [...owed.matchAll(/\{([^}]+)\}/g)].every((m) => m[1].toUpperCase().split("/").every((x) => /^(?:\d+|X|[WUBRGCP])$/.test(x)));
      const useless = (a) => plainOwed && owed !== "{0}" && a.type !== "undoMana" && a !== lifeAct && !payKind
        && (a.type === "activateManaAbility" || a.isManaAbility || /^tap:/.test(String(a.id))) && manaRank(owed, a) === 0;
      const dropped = (input.actions || []).filter(useless);
      ui = { title: `Pay ${owes}${input.cardName || src ? ` for ${input.cardName || src}` : ""}`, mode: "single", options: [
        ...(input.canConfirmFromPool ? [{ id: "__pool", label: "Pay from mana pool" }] : autoFailed ? [] : [{ id: "__auto", label: "Auto-pay" }]),
        ...(lifeAct ? [{ id: lifeAct.id || "pay-life", label: `Pay ${lifeN ?? 2} life` }] : []),
        ...(input.actions || []).filter((a) => a !== lifeAct && !useless(a)).map((a) => ({ id: a.id, cardId: a.cardId, label: a.type === "undoMana" ? `Undo mana from ${cname(a.cardId)}`
          : a.type === "useResource" || a.type === "releaseResource" ? resourceLabel(a, cname(a.cardId))
          : payKind && isResourceTap(a) ? resourceLabel({ ...a, type: "useResource", resource: payKind }, a.description || cname(a.cardId))
          : a.description ? `${!a.cost || /\{T\}/.test(a.cost) ? "Tap" : "Use"} ${a.description}${payManaText(a)}${/\bdamage to you\b/i.test(a.description) ? "" : manaPainText(a, byId[a.cardId]?.text, byId[a.cardId]?.identity?.name)}${manaCostExtra(a)}` : a.id, ...(a.type === "undoMana" ? {} : { rank: rankOf(a) }) })),
        { id: "__cancel", label: "Cancel" },
      ] };
      if (autoFailed && !input.canConfirmFromPool) ui.text = "Auto-pay couldn't finish this payment. Tap other sources, undo some taps, or Cancel.";
      // an attack tax (Propaganda, Brainwash): Forge asks it per attacker once attackers are declared, as a plain
      // payment for the creature; said whose tax it is, and that Cancel leaves only that creature out (seen live as
      // "Pay {W/P} for Mother of Runes" with nothing naming Norn's Annex, 2026-11-10; docs/attack-reminder-spec.md part 2)
      // (only before priority comes back: seat.lastAttack is cleared there, see onPrompt's top)
      const attack = gv.step === "combatDeclareAttackers" && input.cardId ? (seat.lastAttack || []).find((x) => x.attackerId === input.cardId) : null;
      const whose = attack ? attackTaxWords(gv, attack.attackerId, attack.targetId, seat.attackData) : null;
      const who = input.cardName || src || cname(input.cardId);
      // (and said when nothing that is left can pay: the player otherwise sees only Cancel. Cancel as its button reads:
      // "Don't attack with X" for an attack tax)
      if (dropped.length && !input.canConfirmFromPool && !ui.options.some((o) => o.rank > 0 || o.id === "__auto" || o.id === (lifeAct?.id || "pay-life"))) {
        const undo = (input.actions || []).some((a) => a.type === "undoMana");
        const cancelSaid = whose ? (undo ? `Undo a tap, or choose "Don't attack with ${who}".` : `Choose "Don't attack with ${who}" to leave it out of the attack.`)
          : undo ? "Undo a tap, or Cancel." : "Cancel to take it back.";
        ui.text = `Nothing here can pay ${owed}: ${[...new Set(dropped.map((a) => cname(a.cardId)))].join(", ")} can't make that mana. ${cancelSaid}`;
      }
      if (whose) {
        ui.title = `${whose}: pay ${owes} to attack with ${who}?`;
        ui.note = `Cancel: ${who} doesn't attack.`;
        ui.options = ui.options.map((o) => (o.id === "__cancel" ? { ...o, label: `Don't attack with ${who}` } : o));
      }
      toOutput = (a) => {
        // remember a hand tap so the next prompt can finish paying by itself; any other answer forgets it
        seat.tappedFor = String(a[0]).startsWith("tap:") ? input.cardId : null;
        // (the stack showed it, so the log said "casts" and nothing took that back: Silvergill Adept, hp-24 gap)
        if (a[0] === "__cancel" && game?.log?.slice(-12).includes(`${seat.color} casts ${input.cardName || src}`)) gameLogLine(`${seat.color} cancels ${input.cardName || src}`);
        // (life paid for a Phyrexian symbol, for the life line: Mondrak's read a bare "White: 55 -> 53 life (-2)", Kykar
        // re-test new bug 10; see lifePays in logEvents, by the card paid for)
        if (lifeAct && a[0] === (lifeAct.id || "pay-life") && game && input.cardId && (input.cardName || src)) {
          game.lifePays = [...(game.lifePays || []).filter((x) => Date.now() - x.at < 10000), { slot: payer, n: lifeN ?? 2, name: input.cardName || src, card: input.cardId, at: Date.now() }];
        }
        // (ours only for a payment that names its card: the next question finds it by that id)
        const first = a[0] === "__auto" && input.cardId && smartPayTap(owed, input.actions || [], handOthers(), byId);
        if (first) { seat.smartPay = { card: input.cardId, sent: [first.id] }; return { type: "act", actionId: first.id }; }
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
      const newest = !src && [...(gv.stack || [])].reverse().find((s) => s.controllerId === seat.slot && !isAbilityOnStack(s, gv) && !byId[s.sourceId]);
      // (or, when that is the resolving spell that copies another, the spell it copies: Flare of Duplication's copy of
      // Lightning Bolt read "Copy of Flare of Duplication: choose a player to damage", re-test 2 2026-11-05)
      // (the real engine sent Flare with no targets, only its text "Copy Lightning Bolt (162).": the spell that text names,
      // real table 2026-11-05)
      const copies = (s) => newest && s !== newest && s.identity?.name && String(newest.text || "").replace(/ \(\d+\)/g, "").includes(`Copy ${s.identity.name}`);
      const copy = newest && ((newest.targets || []).filter((t) => t.kind === "spell").map((t) => (gv.stack || []).find((s) => s.id === t.id)).find(Boolean)
        || (gv.stack || []).find(copies) || newest);
      // (or by the effect on the stack that makes it, "Eternal Dominion (5)'s Effect": epic's upkeep copy read "Choose a player
      // to search their library", no card named, hp-23 gap)
      const effectOf = !src && !copy && (gv.stack || []).map((s) => String(s.identity?.name || "").match(/^(.+?)(?: \(\d+\))?'s Effect$/)?.[1]).find(Boolean);
      const unnamed = copy ? `Copy of ${copy.identity?.name}` : effectOf;
      const baseTitle = targetTitle(title, src, minLeft, maxLeft, noun);
      const firstTitle = unnamed ? `${unnamed}: ${baseTitle.replace(/^C/, "c")}` : baseTitle;
      ui = { title: firstTitle,
        mode: "multi", min: minLeft, max: maxLeft, cancel: input.cancellable,
        // (a copy offered as a target before it reaches the stack has no name yet: its original's, not "engine-card-144", re-test 2026-10-30)
        // (and a face-down card you may not see by what it is, not its card id: the AI's face-down 2/2 read "engine-card-970",
        // suite review 2026-11-05)
        options: input.candidates.map((c) => ({ id: `${c.kind}|${c.id}`, label: cname(c.id) === c.id && copy ? `${copy.identity?.name} (the copy)`
          // (Forge's own view of one you may not see, { visibility: "hidden", id }, reads the same, relations review)
          : cname(c.id) === c.id && (byId[c.id]?.isFaceDown || byId[c.id]?.visibility === "hidden") ? "Face-down creature" : cname(c.id),
          // a target inside a graveyard/exile pile has no card of its own on the table to click: give it a picture, so
          // the table shows it in the card row (Emry's "target artifact card in your graveyard", 2026-10-21 sweep)
          ...((gv.zones || []).some((z) => (z.zone === "graveyard" || z.zone === "exile") && z.cards.some((x) => x.id === c.id)) ? { img: imgOf(byId[c.id]) } : {}) })) };
      // (a token beside a card of its name says so: Cut Your Losses offered "Galadhrim Brigade / Galadhrim Brigade", the
      // squad token and the card, mechanic run hp-16 2026-11-05)
      // (decided before any label changes: two token copies read "Coruscation Mage (token) / Coruscation Mage", hp-14)
      const cardOf = (o) => byId[o.id.split("|")[1]];
      const tokenTwins = ui.options.filter((o) => cardOf(o)?.identity?.isToken && ui.options.some((x) => x !== o && x.label === o.label));
      for (const o of tokenTwins) o.label += " (token)";
      // (a face-down card you may see is named, and says it is face down: Bowmasters offered the manifested card as
      // "Brainstorm", hp-06)
      for (const o of ui.options) if (cardOf(o)?.isFaceDown && cardOf(o)?.identity) o.label += " (face down)";
      // (a counterspell's target that can't be countered says so: countering it does nothing; the user 2026-11-10)
      if (isCounterspell(String(prompt.sourceAbilityText || srcCardText))) {
        const stuck = [];
        for (const o of ui.options) {
          if (!o.id.startsWith("spell|")) continue;
          const s = (gv.stack || []).find((x) => x.id === o.id.slice(6));
          const why = s && cantBeCounteredWhy(gv, `${s.text || ""}\n${s.sourceAbilityText || ""}`, s.controllerId);
          if (!why) continue;
          o.label += why.sure ? " (can't be countered)" : ` (maybe can't be countered: ${why.card})`;
          stuck.push(`${s.identity?.name || o.label}: ${why.said}`);
        }
        if (stuck.length && !ui.text) ui.text = `Countering does nothing to a spell that can't be countered. ${stuck.join("; ")}.`;
      }
      // (two creatures that still read alike get their power/toughness, then anything still alike a number: Coruscation
      // Mage's two token copies read "Coruscation Mage (token) / Coruscation Mage (token)", hp-14; two Treasures, two
      // Forests and two unseen face-down cards read alike too, relations review 2026-11-05)
      // (then by whose they are, when that tells them apart: White's Clone of Serra Angel and AI 1's Serra Angel read
      // "Serra Angel 4/4 #1 / #2" in Control Magic's list, its controller, and in Chaos Warp's once both were White's, its
      // owner; Kykar re-test new bug 4)
      const whoseWord = (p, mine, theirs) => (p === seat.slot ? mine : theirs(nameOf(p)));
      for (const pass of ["pt", "ctl", "owner", "n"]) {
        const seen = {};
        for (const o of ui.options) (seen[o.label] ??= []).push(o);
        for (const group of Object.values(seen)) {
          if (group.length < 2 || (pass === "pt" && !group.every((o) => cardOf(o)?.power != null))) continue;
          const by = pass === "ctl" ? (o) => cardOf(o)?.controllerId : pass === "owner" ? (o) => (cardOf(o) ? ownerOf(cardOf(o)) : null) : null;
          if (by && (!group.every(by) || new Set(group.map(by)).size < 2)) continue;
          group.forEach((o, k) => {
            const c = cardOf(o);
            if (pass === "pt") { if (c?.power != null && c?.toughness != null) o.label = o.label.replace(/^([^(]+?)(?= \(|$)/, `$1 ${c.power}/${c.toughness}`); }
            else if (pass === "ctl") o.label += whoseWord(by(o), " (yours)", (n) => ` (${poss(n)})`);
            else if (pass === "owner") o.label += whoseWord(by(o), " (owned by you)", (n) => ` (owned by ${n})`);
            else o.label += ` #${k + 1}`;
          });
        }
      }
      // (a modal spell's chosen modes, which Forge adds after its list and a blank line: Collective Resistance's
      // hexproof target read "choose a target", hp-21)
      const chosenModes = String(prompt.sourceAbilityText || "").match(/•[^]*?\r?\n\r?\n\s*([^]+)$/)?.[1];
      // (a copy asks in its original's words, by the copied spell's text: Twincast's copy of Shock read "Copy of Shock:
      // choose a target to deal damage to" where Shock read "deals 2 damage to which target?", Kykar hand test #14)
      // (the stack item's rules text: its "text" is Forge's resolved line, "Explosion (220) - Explosion (220) deals 0 damage
      // to ...", Kykar probe 2026-11-07)
      const copyText = !src && copy ? String(copy.sourceAbilityText || byId[copy.sourceId]?.text || "") : "";
      // (a fused split card asks each half's target under that half's name, by the half whose target the candidates are:
      // Wear // Tear read "Wear // Tear: choose a target to destroy" twice with the Fuse reminder as its text, its copy
      // "Copy of Wear // Tear: ..." too, Kykar hand test #20. Its card text has the halves as "(Wear) Destroy target
      // artifact." lines, kept by name for the copy, whose card is on the stack and in no zone)
      const half = fusedHalf(src || copy?.identity?.name, srcCardText, prompt.sourceAbilityText || copyText, all);
      if (half) prompt = { ...prompt, sourceAbilityText: half.text };
      const asker = half ? half.name : src || (copy && unnamed ? copy.identity?.name : null);
      const askedAs = half ? (src ? half.name : `Copy of ${half.name}`) : src || unnamed;
      // (Forge's own question in our words, with no card name before it; only with a card to name)
      const bare = asker ? baseTitle : "";
      const targetWords = half ? half.text : chosenModes || prompt.sourceAbilityText || srcCardText || copyText;
      // (a mutating spell's own target, asked while it is cast: Gemrazer's read "destroy which artifact or enchantment an
      // opponent controls?", its mutate trigger's sentence, hp-09)
      const mutateOnto = !prompt.sourceAbilityText && String(prompt.sourceCard?.text || "").match(/^Mutate\b[^(\n]*\(If you cast this spell for its mutate cost, put it over or under target ([^.]+?)\./im)?.[1];
      const srcOnBattlefield = (gv.zones || []).some((z) => z.zone === "battlefield" && (z.cards || []).some((x) => x.id === prompt.sourceCard?.id));
      let why = asker && /^choose (?:a|an|up to 1) target(?: to [a-z ]+)?$/i.test(bare)
        ? (mutateOnto && !srcOnBattlefield ? `mutate onto which ${mutateOnto}?`
          // (the chosen modes, one a line after Forge's list, read as modes too: Collective Resistance's three read "choose
          // a target to destroy", hp-21 gap)
          : modeTargetQuestion(chosenModes ? chosenModes.split(/\r?\n/).filter((l) => l.trim()).map((l) => `• ${l.trim().replace(/^•\s*/, "")}`).join("\n") : prompt.sourceAbilityText || srcCardText || copyText, input.candidates, byId, seat.slot)
            || purposeOf(targetWords, "target")) : null;
      // (two target sentences: the one the candidates fit, yours or not yours; Bridgeworks Battle's "Target creature you
      // control gets +2/+2 ... Then it fights up to one target creature you don't control" read "choose a target", hp-04 #2)
      if (!why && asker && /^choose (?:a|an|up to 1) target(?: to [a-z ]+)?$/i.test(bare)) {
        const ctl = (c) => byId[c.id]?.controllerId;
        const mineOnly = input.candidates.length > 0 && input.candidates.every((c) => ctl(c) === seat.slot);
        const theirsOnly = input.candidates.length > 0 && input.candidates.every((c) => ctl(c) && ctl(c) !== seat.slot);
        const fit = String(targetWords || "").split(/(?<=\.)\s+/).filter((x) => /\btarget\b/i.test(x))
          .filter((x) => (mineOnly ? /\btarget [^.]*\byou control\b/i.test(x) : theirsOnly ? /\b(?:you don't control|an opponent controls)\b/i.test(x) : false));
        if (fit.length === 1) why = purposeOf(fit[0], "target");
      }
      // (a sentence that starts with the card's own name drops it after "<card>: ": Heated Debate's read "Heated Debate:
      // heated Debate deals 4 damage to which ...?", hp-14 gap)
      if (why && asker && why.toLowerCase().startsWith(`${asker.toLowerCase()} `)) why = why.slice(asker.length + 1);
      if (why) ui.title = `${askedAs}: ${why}`;
      // (a revolt card says whether revolt is on: a permanent of the player's left the battlefield this turn)
      const revolt = /(?:^|\n)Revolt — ([^\n]+)/.exec(srcCardText)?.[1];
      if (revolt && game?.revolt) {
        const on = game.revolt[seat.slot] === gv.turn;
        ui.text = `${ui.text ? `${ui.text}\n` : ""}Revolt is ${on ? "ON" : "off"}: ${on ? "a permanent you controlled left the battlefield this turn" : "no permanent you controlled has left the battlefield this turn"}.`;
        // (and with revolt on, the question says the revolt number: Fatal Push asked "mana value 2 or less", hp-15)
        const instead = on && /\b(mana value|power|toughness) (\d+|X) or (less|greater|more) instead\b/i.exec(revolt);
        if (instead) ui.title = ui.title.replace(new RegExp(`\\b${instead[1]} (?:\\d+|X) or (?:less|greater|more)\\b`, "i"), `${instead[1]} ${instead[2]} or ${instead[3]}`);
      }
      if (src) {
        const ctx = { src, uiTitle: ui.title, title: String(title), ability: String(prompt.sourceAbilityText || ""), cardText: srcCardText, srcOnBattlefield, maxTargets: input.maxTargets, cardsOnly: input.candidates.length > 0 && input.candidates.every((c) => c.kind === "card") };
        for (const say of KEYWORD_TARGETS) {
          const said = say(ctx);
          if (said?.title) ui.title = said.title;
          if (said?.note) ui.text = ui.note = said.note;
        }
      }
      // (several targets with no verb of Forge's: what they are for, from the one sentence that targets several, when
      // nothing above said it (Strive's "to copy", Support's own words stay). Guardian of Faith read "choose up to 70
      // targets", Clever Concealment "choose up to 120 targets", Kykar hand test #23)
      const untold = ui.title === firstTitle;
      const many = asker && untold && /^choose (?:up to |\d+ to )?\d+ targets$/i.test(bare) ? purposeOf(targetWords, "targets") : null;
      if (many) ui.title = `${askedAs}: ${many.toLowerCase().startsWith(`${asker.toLowerCase()} `) ? many.slice(asker.length + 1) : many}`;
      // (a player question whose verb we don't know says the card's own "target player" sentence: Emrakul's "choose a
      // player to control" read as controlling the player; it gains control of their creatures, hp-06 2026-10-28)
      const playerVerb = String(title).match(/^Choose (?:a )?player to (\w+)/i)?.[1]?.toLowerCase();
      const playerSentence = asker && playerVerb && !Object.hasOwn(PLAYER_VERBS, playerVerb)
        // (not reminder text in brackets: Partner with's; a cost or loyalty before a colon is left out: Kenrith's "{3}{U}:")
        && String(prompt.sourceAbilityText || srcCardText || copyText).replace(/\([^()]*\)/g, "")
          .split(/(?<=\.)\s+|\n/).filter((x) => /\btarget player\b/i.test(x));
      if (playerSentence?.length === 1) {
        // (a mode's bullet and the card's own name at its start left out: entwine's second target read "Barbed Lightning: •
        // Barbed Lightning deals 3 damage to which player or planeswalker?", keyword sweep kw-06)
        const s = playerSentence[0].trim().replace(/^•\s*/, "").replace(new RegExp(`^${escapeRe(asker)} (?=[a-z])`), "").replace(/^[+−–-]?\d+:\s*/, "").replace(/^[^:.]*\{[^:.]*\}[^:.]*:\s*/, "").replace(/^(?:When|Whenever|At)\b[^,]*,\s*/i, "").replace(/\btarget player\b/i, "which player").replace(/\.$/, "");
        ui.title = `${askedAs}: ${s[0].toLowerCase()}${s.slice(1)}?`;
      }
      // (Partner with: Forge's "Choose player to fetch" names neither the partner nor that it's a may, hp-06 2026-10-28)
      const partner = /^Choose (?:a )?player to fetch\b/i.test(String(title))
        && srcCardText.match(/\bPartner with ([^(\n]+?)\s*(?:\(|\n|$)/);
      if (partner && src) {
        ui.title = `${src}: which player may search their library for ${partner[1]}?`;
        ui.text = ui.note = `Partner with: that player may put ${partner[1]} into their hand from their library, then shuffle.`;
      }
      // (a card dealing two amounts to two targets asks one question for each, in its words' order, the same words twice:
      // each says its amount, the second "which other target". Arc Trail read "choose a target to deal damage to" twice,
      // where Forge's own prompts say "(2 damage)" and "(1 damage)", Kykar re-test new bug 5. The same question asked
      // again, its candidates unchanged, is the same one; a priority question in between starts over, see splitAsk.)
      const amounts = [...String(prompt.sourceAbilityText || srcCardText).matchAll(/\b(\d+) damage to (?:any other target|another target|any target|target [a-z ]+?)(?= and\b|[.,;]|$)/gi)].map((m) => m[1]);
      if (src && !chosen && amounts.length === 2 && amounts[0] !== amounts[1] && prompt.sourceCard?.id) {
        const sig = input.candidates.map((c) => c.id).join(",");
        const was = seat.splitAsk?.src === prompt.sourceCard.id ? seat.splitAsk : null;
        const k = !was ? 0 : was.sig === sig ? was.k : was.k + 1;
        if (k < 2) {
          seat.splitAsk = { src: prompt.sourceCard.id, k, sig };
          ui.title = `${askedAs}: deal ${amounts[k]} damage to which ${k ? "other " : ""}target?`;
        }
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
        // (a detain's too, the same way: Lyev Skyknight's, keyword sweep kw-21)
        const trigText = String(prompt.sourceAbilityText || srcCardText);
        if (game && (/\bsuspect target\b/i.test(trigText) || DETAIN_TARGET.test(trigText)) && prompt.sourceCard?.id) {
          (game.ownTargeted ??= []).push({ id: prompt.sourceCard.id, ctl: prompt.decidingPlayerId, text: trigText, targets: pickedIds(a, "card") });
        }
        // (and a counterspell's: the player's own resolves before any board shows it on the stack, so its targets are
        // noted here; An Offer You Can't Refuse's Divination read no "is countered", gap-04 re-test)
        // (by the card's text when the ability's is only the way it was cast: cleave's, web-slinging's, keyword sweep kw-20)
        const pickText = String(prompt.sourceAbilityText || srcCardText);
        if (game && isCounterspell(castWayOnly(pickText) ? srcCardText : pickText)) for (const v of a) if (v.startsWith("spell|")) (game.counterTargets ??= new Set()).add(v.slice(6));
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
        // ("Pay {X}?" with X's value: "Pay {1}?", the text saying why)
        const xv = /\{X\}/.test(title) ? xNow(prompt.sourceAbilityText || srcCardText, prompt.sourceCard, byId) : null;
        const ask = title.replace(/\?\s*$/, "").replace(/\{X\}/g, xv ? `{${xv.n}}` : "{X}");
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
            : otherwiseDo === "sacrifice" ? { text: `Or drag ${src} to your graveyard to sacrifice it.` } : xv ? { text: `${xv.why}: ${xv.n}.` } : {}) };
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
          ? pickedIds(picks.ids, "card").map((v) => byId[v]?.identity?.name).filter(Boolean)
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
        // (kinship's reveal of the card just looked at, by its name: the log read only "White looked at a card", keyword sweep
        // kw-05)
        const shown = seat.lastShown;
        const kinReveal = /^Reveal cards to other players\?$/i.test(title) && /^Kinship —/i.test(String(prompt.sourceAbilityText || ""))
          && shown?.src === src && shown.names?.length && Date.now() - shown.at < 60000 ? shown.names : null;
        toOutput = (a) => {
          if (a[0] === "yes" && kinReveal && game) gameLogLine(`${seat.color} reveals ${kinReveal.join(", ")} (${src})`);
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
        // (a source choice left with one real source once Forge's headings are gone says it is the source: "Deflecting
        // Palm: the source is Rograkh, Son of Rohgahh 0/1 (the only choice)", verify 2026-11-07)
        chat(`[MTG] ${src ? `${src}: ` : ""}${input.sourceHeadings ? "the source is " : ""}${cardLabel(only)} (the only choice)`, seat.color);
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
          // (your commander, and the one that just entered, said: Mairsil cast from the command zone beside the one from the
          // hand read "Mairsil, the Pretender 4/4 / Mairsil, the Pretender 4/4", mechanic run rebuilt 2026-11-05)
          options: input.cards.map((c) => ({ id: c.id, label: `${cardLabel(c)}${c.identity?.isToken ? " (token)" : ""}${c.isCopy ? " (copy)" : ""}${game?.commandIds?.has(c.id) ? " (commander)" : ""}${game?.logPrev && game.logPrev.cards[c.id]?.zone !== "battlefield" ? " (just entered)" : ""}`, img: imgOf(c) })) };
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
      // (not when the keyword's own reminder is the search: a typecycling's; Hobbit Hole's halflingcycling read its land
      // ability's "search your library for which basic land card?", keyword sweep kw-23)
      const ownSearch = /\([^()]*\bsearch your library\b[^()]*\)/i.test(String(prompt.sourceAbilityText || ""));
      const words = String((keywordOnly(prompt.sourceAbilityText) && !ownSearch && input.cards.length && input.cards.every((c) => c.zone === "library") && cardText)
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
      // (what a fateseal put on the bottom and what a cipher encoded onto, which no board shows: the log said nothing after
      // "White looked at a card (AI 1's library)", and only "Last Thoughts is exiled", keyword sweep kw-18 kw-17)
      const bottomOf = desc.match(/^Choose card\(s\) to put on the bottom of (.+?) library$/i)?.[1];
      const encoding = /^Choose a creature you control to encode\s*$/i.test(desc);
      // (whose library by the table's name, "their" for the player's own: Forge names the player by the engine's name)
      const bottomName = bottomOf && game ? displayText(bottomOf) : bottomOf;
      const whose = bottomName === seat.color ? "their" : poss(bottomName);
      // (a source choice says so, Forge's "Choose a source " or its zone headings: Reflect Damage's, Deflecting Palm's and
      // Circle of Protection's read "choose a card", Kykar hand test #5 #24; and where a source is when it is no
      // permanent, the headings' word: a commander in the command zone, a spell on the stack)
      if (src && isSourceChoice(input)) {
        ui.title = /^Choose a source\s*$/i.test(desc) || !/^Choose a source\b/i.test(desc)
          ? `${src}: choose ${input.max > 1 ? countWords(input.min, input.max, "source") : "a source"}` : `${src}: ${desc[0].toLowerCase()}${desc.slice(1)}`;
        if (/^Choose a source\s*$/i.test(desc)) delete ui.text;
        // (a spell comes with no zone: said by the stack, as Deflecting Palm itself was offered, Kykar probe 2026-11-07)
        for (const o of ui.options) {
          const z = input.cards.find((c) => c.id === o.id)?.zone || ((gv.stack || []).some((s) => s.sourceId === o.id || s.id === o.id) ? "stack" : null);
          if (z && z !== "battlefield") o.label += ` (${ZONE_SAID[z] || z})`;
        }
      }
      toOutput = (a) => {
        if (a[0] === "__cancel") return { type: "cancel" };
        if (game && src && bottomOf) gameLogLine(a.length ? `${seat.color} puts ${countWords(a.length, a.length, "card")} on the bottom of ${whose} library (${src})`
          : `${seat.color} leaves ${input.cards.length === 1 ? "the card" : "the cards"} on top of ${whose} library (${src})`);
        if (game && src && encoding && a.length) holdLogLine(`${seat.color} encodes ${src} onto ${a.map((id) => input.cards.find((c) => c.id === id)?.identity?.name).filter(Boolean).join(", ")}`);
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
        // (a card revealed to pay a cost is shown to the table: Foreboding Ruins's Mountain was in no log, rebuilt hand test #2;
        // Forge says "Reveal for cost" in the question's description, the title only in our cases, re-test)
        const shown = a.map((id) => input.cards.find((c) => c.id === id)?.identity?.name).filter(Boolean);
        if (shown.length && game && [title, desc].some((t) => /^Reveal for cost$/i.test(String(t || "")))) holdLogLine(`${seat.color} reveals ${shown.join(", ")}${src ? ` (${src})` : ""}`);
        // (a search that reveals what it finds shows it to the table: Ash Barrens' basic landcycling read only "puts a card
        // from their library into their hand", mechanic run hp-03 2026-11-05)
        else if (fromLibrary && !onTop && shown.length && game && /\breveal (?:it|that card|them|those cards|the chosen cards?)\b/i.test(effectText)) holdLogLine(`${seat.color} reveals ${shown.join(", ")}${src ? ` (${src})` : ""}`);
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
        // (but a copy of the card is cast, the card itself stays: Arcane Bombardment's "cast any number of the copies"
        // read "play which card?" with the drag hint, and a dragged-out card is no copy, Kykar hand test #27)
        const copiesCast = /\b(?:cast|play)\b[^.]*\bcop(?:y|ies)\b/i.test(String(prompt.sourceAbilityText || srcCardText));
        if (input.cards.length && input.cards.every((c) => inPile(c.id)) && copiesCast) {
          ui.copies = true;
          if (src && /^[^:]+: (?:(?:play|cast) which cards?\?|choose\b.*)$/i.test(String(ui.title))) ui.title = `${src}: cast which cop${input.max > 1 ? "ies" : "y"}?`;
          ui.text = "The copy is cast; the card stays where it is.";
        } else if (input.cards.length && input.cards.every((c) => inPile(c.id))) {
          ui.pileChoices = input.cards.map((c) => c.id);
          ui.text = "Pick from the list, or right-click the graveyard/exile → Search and drag the card out.";
        }
        // (a source is never searched for: a spell on the stack or a commander isn't in the library)
        if (input.cards.length && input.cards.every((c) => !visible.has(c.id)) && !isSourceChoice(input)) {
          // the same send-once details as the board: a full card list cost TTS ~300 ms to decode (Cultivate, 13 KB)
          const sl = slimmer(game);
          const full = input.cards.map((c) => tableCard(c));
          ui.librarySearch = full.map(sl.slim);
          if (Object.keys(sl.statics).length) ui.cards = sl.statics;
          // (more pictures than the table's card row holds, ROW_MAX 7 in tools/engine-renderer.lua: the table lists them
          // by name in the panel and never reads an option's picture, so the link goes once, in `cards`. It was the library
          // a second time, ~12 KB of a 40 KB tutor question: tmp/json-decode/impact.md)
          if (ui.options.filter((o) => o.img).length > TABLE_ROW_PICTURES) ui.options = ui.options.map(({ img, ...o }) => o);
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
      // the order of replacement effects (Forge's "Choose" over each replacer's text, no card ids): titled as that, each
      // option by the card whose text it is. Anointed Procession and Mondrak read "Kykar, Wind's Fury: choose one" over
      // the two bare sentences (Kykar hand test #17). A card is named only when it is the one card (by name) on the
      // battlefield with that sentence: Anointed Procession, Parallel Lives and Doubling Season share theirs, and the first
      // of them read as the source of every copy (verify 2026-11-07); such an option keeps its bare sentence.
      // (and the prevention shields, by a source chosen this turn: Reflect Damage, Circle of Protection: Red and Deflecting
      // Palm on one combat's damage asked "Choose" over three bare sentences, Kykar re-test new bug 2. Forge's sentence for
      // a chosen source, "the chosen red source deals damage to you", is the card's "a red source of your choice would deal
      // damage to you this turn" with the source chosen: matched in the card's words, see chosenSources)
      const replacing = (l) => /\bwould\b[^.]*\binstead\b|\binstead\b[^.]*\bwould\b|\bprevent (?:that|all|the next \d+) damage\b/i.test(l);
      if (title === "Choose" && input.maxTotal === 1 && input.minTotal === 1 && labels.length >= 1 && labels.every(replacing)) {
        const onField = new Set((gv.zones || []).filter((z) => z.zone === "battlefield").flatMap((z) => (z.cards || []).map((c) => c.id)));
        const plain = (s) => String(s).toLowerCase().replace(/\bthe chosen ((?:[a-z]+ )?)source deals damage\b/g, "a $1source of your choice would deal damage")
          .replace(/ this turn\b/g, "").replace(/\.\s*$/, "");
        const whose = (l) => {
          const s = l.replace(/\.\s*$/, "");
          const names = new Set(Object.values(byId).filter((x) => onField.has(x.id) && String(x.text || "").includes(s)).map((x) => x.identity?.name));
          if (names.size === 1) return [...names][0];
          const chose = new Set((game?.chosenSources || []).filter((x) => x.turn === gv.turn && x.slot === seat.slot && plain(x.how).includes(plain(l))).map((x) => x.by));
          return !names.size && chose.size === 1 ? [...chose][0] : null;
        };
        ui = { title: src ? `${src}: which applies first?` : "Which applies first?", mode: "single", keepOrder: true,
          text: "Each of these changes the same event. The one you pick applies first, the rest after it.",
          options: labels.map((l, i) => { const n = whose(l); return { id: i, label: n && !l.includes(n) ? `${n}: ${l}` : l }; }) };
        // (answered in a damage step: the damage it splits over two boards, and whose shield went first, by its card or
        // null when unknown, see owedCombat in damageNews)
        const damageOrder = labels.some((l) => /\bdamage\b/i.test(l));
        toOutput = (a) => {
          if (game && damageOrder) game.orderAnswer = { turn: gv.turn, step: gv.step, first: labels[Number(a[0])] == null ? null : whose(labels[Number(a[0])]) };
          return { type: "selectionDecision", chosenIndices: a.map(Number) };
        };
        break;
      }
      // players and permanents to choose from, no target (see entityChoiceIds): asked as a target question, so a life
      // counter or the card (a planeswalker) answers it by a click; the answer goes back as the options' numbers
      const entity = input.options.length > 1 && entityChoiceIds(input.options, gv);
      // (a creature put onto the battlefield attacking chooses whom it attacks, CR 506.3b: the harness names it, see
      // defenderChoiceAttacker, so the title says which creature and the table lights it, ui.attacker; Hero of Bladehold's
      // two tokens, asked one by one, read alike, live check 2026-11-11)
      const attacker = defenderChoiceAttacker(input);
      const who = attacker && (byId[attacker.id] ? cardLabel(byId[attacker.id]) : attacker.name);
      if (entity) {
        const players = entity.some((v) => v.startsWith("player|"));
        const walkers = entity.filter((v) => v.startsWith("card|")).every((v) => (byId[v.slice(5)]?.types || []).includes("Planeswalker"));
        const what = `${players ? "player or " : ""}${walkers ? "planeswalker" : "permanent"}`;
        // (from an engine that doesn't name the creature: whom it attacks is read from the card's words)
        const attacks = players && walkers && /\battacking\b/i.test(String(prompt.sourceAbilityText || srcCardText));
        ui = { kind: "target", title: `${src ? `${src}: ` : ""}${who ? `${who} attacks which` : attacks ? "attack which" : "choose which"} ${what}?`, mode: "multi",
          min: input.minTotal ?? 1, max: input.maxTotal ?? 1, options: entity.map((v) => ({ id: v, label: cname(v.split("|")[1]) })),
          ...(attacker ? { attacker: attacker.id } : {}) };
        toOutput = (a) => ({ type: "selectionDecision", chosenIndices: a.map((v) => entity.indexOf(v)).filter((i) => i >= 0) });
        break;
      }
      // one the board can't map is asked from the panel, in words, and titled by what it is for: an attacking token's
      // defender read "Hero of Bladehold: choose one" over "AI 1", "Jace Beleren (201)" (live check 2026-11-11)
      // (whom it attacks only for a list of what can be attacked, players and planeswalkers or battles, from a card that
      // puts creatures onto the battlefield attacking: "attacking" alone, as in "target attacking creature", is no
      // defender's choice)
      const words = input.options.length > 1 && entityWords(input.options, gv);
      if (words) {
        const rules = String(prompt.sourceAbilityText || srcCardText);
        const what = `${words.players ? "player or " : ""}${words.walkers ? "planeswalker" : words.onField ? "permanent" : "card"}`;
        const attacks = words.players && words.defenders && /\b(?:create|put|return)s?\b[^.]*\battacking\b/i.test(rules);
        const token = attacks && /\btokens?\b[^.]*\battacking\b/i.test(rules);
        ui = { title: `${src ? `${src}: ` : ""}${who ? `${who} attacks whom?` : token ? "the token attacks whom?" : attacks ? "attack whom?" : `choose which ${what}?`}`, mode: "multi",
          min: input.minTotal ?? 1, max: input.maxTotal ?? 1, options: opts(words.labels.map((label, i) => ({ id: i, label }))),
          ...(attacker ? { attacker: attacker.id } : {}) };
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
      // A creature with more than one player or planeswalker to attack has "→ whom?" as its first option: a click on it
      // picks that, and so does All attack, and whom it attacks is asked after (attackWhom) instead of Forge's first
      // target for everyone (item 25, the user 2026-11-10). A life counter or planeswalker clicked, or a pair picked in
      // the panel, still sets the target at once.
      const many = (at) => at.validTargetIds.length > 1;
      const pairs = [];
      // (each attacker with its size and counters, and a number when that still reads the same: Lingering Souls' tokens
      // read "Spirit Token → Blue" four times, 2026-11-08/09 game; in the "whom?" question after too)
      const attackerLabel = numberedLabels(input.attackers.map((at) => at.attackerId), byId, cname);
      // (A-Z as every list of pairs, by those labels, so tokens of one name and two sizes don't interleave, #9 before
      // #10; each creature's "whom?" before its targets: the table's click takes the first option of the creature, so
      // the question is kept in this order, keepOrder)
      const az = (x, y) => String(x).localeCompare(String(y), undefined, { numeric: true });
      for (const at of [...input.attackers].sort((x, y) => az(attackerLabel(x.attackerId), attackerLabel(y.attackerId)))) {
        if (many(at)) pairs.push({ id: `${at.attackerId}|?`, label: `${attackerLabel(at.attackerId)} → whom? (asked next)` });
        const targets = at.validTargetIds.map((tid) => ({ id: `${at.attackerId}|${tid}`, label: `${attackerLabel(at.attackerId)} → ${cname(tid)}` }));
        pairs.push(...targets.sort((x, y) => az(x.label, y.label)));
      }
      const must = input.attackers.filter((a) => a.mustAttack && a.validTargetIds.length);
      // "All attack" sends every creature; "No attacks" none (except those that must attack, at their first target).
      const quick = pairs.length ? [{ id: "__allattack", label: "All attack" }, { id: "__noattack", label: "No attacks" }] : [];
      // (who must attack, said on the question and again if the attack is refused: Kardur, Doomscourge sent four of Red's
      // Dragons in, and all they saw was "Attack declaration invalid", 15 times, game 2026-11-01)
      seat.mustAttack = must.map((m) => cname(m.attackerId));
      // (the reason the last attack was refused stays on the question until it is answered: chat alone was missed)
      const refused = seat.attackRefused;
      const mustLine = must.length ? `Must attack: ${seat.mustAttack.join(", ")}.` : "";
      const said = [refused, mustLine].filter(Boolean).join(" ");
      // the taxes, limits and who can't attack, before any pick (attackReminder; the refusal keeps the corner)
      const remind = attackReminder(gv, input, forP || seat.slot);
      // (the engine's own attack data, kept for this declaration's refusal and tax payments; null from an older engine)
      seat.attackData = engineAttackData(input);
      const attackData = seat.attackData;
      const text = [said, ...remind.lines].filter(Boolean).join("\n");
      const note = refused || remind.note;
      ui = { title: "Choose attackers", mode: "multi", min: 0, max: pairs.length, keepOrder: true, options: [...quick, ...pairs], ...(text ? { text } : {}), ...(note ? { note } : {}),
        ...(Object.keys(remind.cantAttack).length ? { cantAttack: remind.cantAttack } : {}) };
      const askUi = ui;
      // the declaration once every attacker has its target. "All attack" over a limit the table can read (Crawlspace,
      // Silent Arbiter, a creature that can only attack alone) is stopped here and the limit said, nothing sent: Forge
      // would only refuse it (the user's pick (a), 2026-11-10). Creatures picked one by one still go to Forge, whose
      // refusal is explained as before.
      const declare = (byAttacker, all) => {
        const assignments = Object.entries(byAttacker).map(([attackerId, targetId]) => ({ attackerId, targetId }));
        if (all) {
          const { broken } = attackRefusalReason(gv, assignments, attackData);
          if (broken.length) {
            const stop = `"All attack" would break a limit, so nothing was sent. ${broken.join(" ")} Pick the attackers yourself.`;
            chat(`[MTG] ${stop}`, seat.color);
            return next({ ...askUi, text: [[stop, mustLine].filter(Boolean).join(" "), ...remind.lines].join("\n"), note: stop }, toOutput);
          }
        }
        seat.lastAttack = assignments;
        seat.attackRefused = null;
        return { type: "declareAttackers", assignments };
      };
      toOutput = (a) => {
        const byAttacker = {};
        // (No attacks alone keeps a must-attack creature at its first target, as End turn does: nothing is asked then)
        const none = !a.some((v) => v !== "__noattack");
        for (const m of must) byAttacker[m.attackerId] = many(m) && !none ? "?" : m.validTargetIds[0];
        if (a.includes("__allattack")) for (const at of input.attackers) if (at.validTargetIds.length) byAttacker[at.attackerId] ??= many(at) ? "?" : at.validTargetIds[0];
        // (a target picked wins over "whom?" for the same creature, in any order)
        for (const v of a) {
          if (v.startsWith("__")) continue;
          const [att, tgt] = v.split("|");
          if (tgt !== "?" || byAttacker[att] == null) byAttacker[att] = tgt;
        }
        const asked = input.attackers.filter((at) => byAttacker[at.attackerId] === "?");
        if (!asked.length) return declare(byAttacker, a.includes("__allattack"));
        return attackWhom({ asked, byAttacker, cname: attackerLabel, defender: (id) => defenderWords(gv, input, id), taxAt: remind.taxAt,
          done: (chosen) => declare(chosen, a.includes("__allattack")), back: () => next(askUi, toOutput) });
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
      // (each blocker and attacker with its size and a number when that still reads the same, as the attackers' list:
      // twenty "Spirit Token blocks Goblin Token" lines couldn't be told apart, and the table's confirmation of each
      // read the same, combat clarity 2026-11-11)
      const blockerLabel = numberedLabels([...new Set(input.attackers.flatMap((at) => at.validBlockerIds))], byId, cname);
      const attackerLabel = numberedLabels(input.attackers.map((at) => at.attackerId), byId, cname);
      for (const at of input.attackers) for (const b of at.validBlockerIds) pairs.push({ id: `${b}|${at.attackerId}`,
        label: `${blockerLabel(b)} blocks ${attackerLabel(at.attackerId)}${at.minBlockers > 1 ? ` (needs ${at.minBlockers}+ blockers)` : ""}${at.mustBeBlocked ? " (must be blocked)" : ""}` });
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
      // (a title that is only the card's name, by the card's own "choose a color" sentence: Thriving Isle read "Thriving
      // Isle", text "Play land", Kykar probe 2026-11-07)
      const says = !tapped && src && (title === src || /^Choose a colou?r$/i.test(title)) ? /[^.\n]*\b(choose an? colou?r\b[^.\n]*)\.?/i.exec(srcCardText) : null;
      if (says) { ui.title = `${src}: ${says[1]}`; ui.text = says[0].trim(); }
      if (!tapped) {
        const said = textChangeQuestion(seat, ui, src, prompt, gv, byId);
        if (said) { const inner = toOutput; toOutput = (a) => { said(a); return inner(a); }; }
      }
    }
      break;
    case "revealCards":
      // Forge's warning about its own AI deck isn't meant for players.
      if (/^AI can't play/i.test(title)) { seat.respond(prompt.promptId, type, { type: "revealCardsAcknowledged" }); return; }
      // A look at the top cards that a pick from among them follows: "Look at these cards" (OK), then "choose an instant
      // card" over the same cards (doubled prompts, the user 2026-11-09 item 5). Not shown: the pick has the cards. Held,
      // and settled by the next question (heldLook): with no pick from them, what was seen is said in chat.
      // (Forge's title is only "Look at these cards", zone "library": a top-card reveal (Dark Confidant) and Ponder's look
      // come the same way, so only by the ability's words, "look at the top ... from among them". A search's look is
      // settled further down, by what it seeks; Hideaway's too.)
      {
        const words = String((keywordOnly(prompt.sourceAbilityText) && srcCardText) || prompt.sourceAbilityText || srcCardText || "");
        const own = String(input.ownerPlayerId || "").replace("-view", "") === seat.slot;
        if (/^look at these cards$/i.test(String(title)) && input.zone === "library" && own && (input.cards || []).length
          && /\blook at the top (?:\w+ )?cards? of your library\b/i.test(words) && /\bfrom among (?:them|those cards|the cards)\b/i.test(words)) {
          seat.heldLook = { ids: input.cards.map((c) => c.id), names: input.cards.map((c) => cardLabel(c)), n: input.cards.length };
          // (the table's log still says a look happened, as a shown look says it: private, so no names)
          if (game) gameLogLine(`${seat.color} looked at ${countWords(input.cards.length, input.cards.length, "card")} (their library)`);
          seat.respond(prompt.promptId, type, { type: "revealCardsAcknowledged" });
          return;
        }
      }
      // a notice with no cards ("White picked AI 1", "AI 1 vote Money"): told in chat and the game log, not asked (one
      // test game asked for OK 15 times; Arena shows such things in passing)
      if (/^Attack declaration invalid\b/i.test(title)) {
        const names = seat.mustAttack || [];
        const { broken, limiters } = attackRefusalReason(gv, seat.lastAttack || [], seat.attackData);
        const why = broken.join(" ");
        seat.attackRefused = why ? `That attack isn't legal. ${why}` : null;
        const rest = names.length ? `Must attack: ${names.join(", ")}. Any you don't choose are sent for you. Check the table too: an effect can also forbid attacking a player.`
          : why ? "" : `Something on the table limits who can attack, or who they can attack.${limiters ? ` ${limiters}` : ""}`;
        chat(`[MTG] That attack isn't legal. ${[why, rest].filter(Boolean).join(" ")}`, seat.color);
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
        // (a coin flip is the table's, said of its player: "White saw: Zndrsplt, Eye of Wisdom: You win the flip",
        // rebuilt hand test #7)
        const flip = plain.match(/^(?:(.+): )?You (win|lose) the flip\.?$/);
        // (and a die roll, said of its roller: "White saw: Ancient Copper Dragon: White rolled 6", re-test 2 bug b)
        const roll = plain.match(/^(?:(.+): )?(.+?) rolled (\d+(?:(?:, | and |\+)\d+)*)\.?$/);
        const roller = roll && Object.values(game?.slotNames || {}).includes(roll[2]) ? roll[2] : null;
        if (game) gameLogLine(mine && mine[2] === me ? `${me} chooses ${mine[3]} (${mine[1]})`
          : flip ? `${me} ${flip[2]}s the flip${flip[1] ? ` (${flip[1]})` : ""}`
            : roller ? `${roller} rolls ${roll[3]}${roll[1] ? ` (${roll[1]})` : ""}` : `${seat.color} saw: ${plain}`);
        seat.respond(prompt.promptId, type, { type: "revealCardsAcknowledged" });
        return;
      }
      if (/ reveals: .*Mana Value=/i.test(title)) {
        // (Forge's clash: one line per player and the result; said as "You: Island (0), AI 1: Forest (0). Nobody wins.")
        // (the engine's lines name players by their engine usernames: displayText first, then this seat by its colour
        // even where its engine name isn't in the player list; "You" in its own question)
        const me = nameOf(seat.slot);
        const named = (p) => (p === seat.username ? me : p);
        const lines = String(title).split(/[\r\n]+/).map((l) => displayText(l.trim())).filter(Boolean);
        const shown = lines.map((l) => l.match(/^(.+?) reveals: (.+?)\. Mana Value= ?(\d+)/)).filter(Boolean).map(([, p, c, v]) => ({ p: named(p), c, v }));
        const end = lines.find((l) => !/ reveals: /.test(l)) || "";
        const winner = end.match(/^(.+?) wins/i)?.[1];
        const result = (you) => (/no winner/i.test(end) ? "Nobody wins." : winner ? (you && named(winner) === me ? "You win." : `${named(winner)} wins.`) : end.replace(/!$/, "."));
        ui = { title: `${src ? `${src}: ` : ""}clash`, mode: "single", text: `${shown.map(({ p, c, v }) => `${p === me ? "You" : p}: ${c} (${v})`).join(", ")}. ${result(true)}`.trim(),
          options: [{ id: "ok", label: "OK" }], show: input.cards.slice(0, REVEAL_PICTURES).map((c) => ({ n: cardLabel(c), img: imgOf(c) })) };
        // (and in the game log, by the players' table names: no line named the clash's cards or its winner, keyword sweep
        // kw-07 "Lash Out: clash". Forge reveals it to every player (ClashEffect, revealTo all), so each human seat is
        // asked, one after another: the same line from a seat that hasn't seen it yet is that clash again, said once; from
        // a seat that has, a new clash with the same cards, as a card kept on top is revealed again)
        if (game) {
          const line = `Clash${src ? ` (${src})` : ""}: ${shown.map(({ p, c, v }) => `${p} reveals ${c} (mana value ${v})`).join(", ")}. ${result(false)}`.trim();
          const last = game.lastClash;
          if (last?.line === line && !last.seats.has(seat.color) && Date.now() - last.at < CLASH_SAME_MS) last.seats.add(seat.color);
          else { gameLogLine(line); game.lastClash = { line, at: Date.now(), seats: new Set([seat.color]) }; }
        }
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
      seat.lastShown = { ids: shownIds, src, at: Date.now(), names: input.cards.map((c) => c.identity?.name).filter(Boolean) };
      // (Forge's trailing " - " left out: "revealed for Explore - (your library)", hp-06 #16)
      // (Forge's "Face-down card leaves the <player>'s Battlefield:" read "... the AI 1's Battlefield: (AI 1's graveyard)",
      // hp-20 gap)
      ui = { title: `${revealedNow ? "Revealed" : String(title || "").replace(/\s+-\s*$/, "").replace(/^Face-down card leaves the (.+?)'s Battlefield:?$/i, "A face-down card left $1's battlefield") || "Revealed"}${input.ownerPlayerId ? ` (${String(input.ownerPlayerId).replace("-view", "") === seat.slot ? "your" : `${nameOf(String(input.ownerPlayerId).replace("-view", ""))}'s`} ${input.zone})` : ""}`, mode: "single",
        text: input.cards.map((c) => cardLabel(c)).join(", "), options: [{ id: "ok", label: "OK" }],
        show: input.cards.slice(0, REVEAL_PICTURES).map((c) => ({ n: cardLabel(c), img: imgOf(c) })) }; // pictures in the card row
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
        // (many by count, as a mill's are: a whole library exiled or revealed read "Island, Island, Island, ...", keyword
        // sweep kw-22 kw-25; in their order, only a run of one card counted, as the order is the library's: "Island, Opt,
        // Island, Swamp, Island, Opt, Forest" read "Island ×3, Opt ×2, Swamp, Forest", checker 2026-11-07)
        const many = listInOrder(input.cards.map((c) => cardLabel(c)));
        const line = exiledTop ? `${seat.color} exiles from the top of their library${said ? ` (${said})` : ""}: ${many}`
          // (a reveal is said as the revealing player's, once for the table: "White saw: Chaos Warp: revealed from AI 1's
          // library: Mountain", rebuilt hand test #7)
          : revealedNow ? `${owner} reveals ${many} from their ${input.zone}${said ? ` (${said})` : ""}`
          : revealed ? `${seat.color} saw: ${ui.title}: ${ui.text}`
          : `${seat.color} looked at ${countWords(input.cards.length, input.cards.length, "card")} (${mine ? "their" : `${nameOf(ownerSlot)}'s`} ${input.zone})`;
        // (each seat is shown a reveal: said once)
        const again = revealedNow && game.lastReveal?.line === line && Date.now() - game.lastReveal.at < 5000;
        // (until: revealed until a card is found, which is the last; grandeur's Divination read "puts a card from their
        // library into their hand", keyword sweep kw-25)
        // (cards: each with its id, for which of them went to the hand, see logEvents)
        const cards = input.cards.filter((c) => c.identity?.name).map((c) => ({ id: c.id, name: c.identity.name }));
        if (revealedNow) game.lastReveal = { line, at: Date.now(), slot: ownerSlot, zone: input.zone, names: cards.map((c) => c.name), cards, until: /\buntil you reveal\b/i.test(abilityWords) };
        if (!again) (revealedNow ? holdLogLine : gameLogLine)(line);
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
      // (permanents returned to the battlefield: Ephemerate's order is the order they come back, enters triggers too)
      const comesBack = /\breturn\b[^.]*\bbattlefield\b/i.test(what);
      // (a look at the top of a library said in the log, as Brainstorm's put-back is: Ponder's read nothing, rebuilt hand
      // test #16)
      if (onTop && game && /\blook at the top \w+ cards of your library\b/i.test(what)) gameLogLine(`${seat.color} looks at the top ${input.items.length === 1 ? "card" : `${input.items.length} cards`} of their library (${src})`);
      const [words, hint] = trig
        ? [(n) => `Your triggers: click the one that happens ${n ? "next" : "first"}`, "The one you click first happens first. Not sure? Keep this order."]
        : bottom
          ? [(n) => `${src || title}: these go to the bottom of your library${n ? ` (${n + 1})` : ""}`, "The order on the bottom hardly matters: Keep this order is fine."]
          : onTop
            ? [(n) => `${src}: click the card to put ${n ? `next (number ${n + 1} from the top)` : "on top"}`, "Your library's top card first. Not sure? Keep this order."]
            // (any other order in words too: Ephemerate's two creatures coming back read "Ephemerate: pick #1", hp-09)
            // (its enters triggers only for what comes back: Pestilence's own order said "(its enters triggers too)")
            : [(n) => `${src || title || "Put these in order"}: click the one that ${comesBack ? "comes back" : "goes"} ${n ? "next" : "first"}`,
              comesBack ? "The one you click first comes back first (its enters triggers too). Not sure? Keep this order."
                : "The one you click first goes first. Not sure? Keep this order."];
      // (to the bottom: the order hardly ever matters, so the engine's order is kept without asking, 2026-10-22 review)
      // (nor does the order an "exile all" effect takes permanents in: Sunfall asked "Sunfall: pick #1" over six creatures,
      // hp-09)
      const exileAll = !trig && /\bexile all\b/i.test(prompt.sourceAbilityText || "")
        && input.items.every((i) => (gv.zones || []).some((z) => z.zone === "battlefield" && (z.cards || []).some((c) => c.id === i.id)));
      // (nor the order of things that are all the same once Forge's object numbers are out: Flusterstorm's three storm
      // copies asked "click the one that happens first" over "Flusterstorm (145) - Counter Chart a Course (61) unless...",
      // hp-08 gap)
      // (an item's text without Forge's notes and object numbers: the "[Card: Twinflame ...]" note names the spell that
      // set a trigger off, and its "target" is none of the trigger's, hp-14 re-test)
      const oracleOf = (i) => withoutForgeNotes(String(i.oracle || "")).replace(/ \(\d+\)/g, "");
      const plain = (i) => `${cardLabel(i.card)}|${oracleOf(i)}`;
      // (and identical triggers from copies of one card, as Arena orders them itself: two Coruscation Mages, a 2/2 and a
      // 1/1, asked which pings first, hp-14; not when they target, since the targets may differ)
      const sameTrig = (i) => `${i.card?.identity?.name}|${oracleOf(i)}`;
      const allSame = input.items.length > 1 && (input.items.every((i) => plain(i) === plain(input.items[0]))
        || (trig && input.items.every((i) => sameTrig(i) === sameTrig(input.items[0]) && !/\btarget\b/i.test(oracleOf(i)))));
      // (nor the order lands are put onto the battlefield together: Animist's Awakening's four lands asked "click the card
      // to put on top", hp-15 gap)
      const landsDown = !trig && input.items.length > 0 && input.items.every((i) => (i.card?.types || []).includes("Land"))
        && /\bland cards?\b[^.]*\bonto the battlefield\b/i.test(prompt.sourceAbilityText || "");
      if (bottom || exileAll || allSame || landsDown) { seat.respond(prompt.promptId, type, { type: "reorderDecision", orderedIds: input.items.map((i) => i.id) }); return; }
      // (Forge's object numbers left out of what is shown: "Counter Chart a Course (61)")
      // (and an effect's own name too: "First Day of Class (225)'s Effect" read so, keyword sweep kw-13)
      const items = input.items.map((i) => ({ id: i.id, label: String(cardLabel(i.card)).replace(/^(.+?) \(\d+\)'s Effect$/, (m, n) => `${poss(n)} effect`) + (i.oracle ? `: ${shorten(oracleOf(i), 60)}` : ""), img: imgOf(i.card) }));
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
      // (why, as far as the board tells it, and "a draw" with no winner: see gameEndWords)
      const why = gameEndWords(gv);
      // (once to each player: the question comes again)
      const told = game ? (game.overSaid ??= new Set()) : null;
      if (!told?.has(seat.color)) chat(why ? `[MTG] Game over: ${why}.` : `[MTG] Game over.`, seat.color);
      told?.add(seat.color);
      // (and in the game log, once: White's loss to an empty library under Reforge the Soul ended it unsaid, hp-15 gap)
      if (game && !game.over) gameLogLine(why ? `Game over: ${why}` : "Game over");
      if (game) game.over = true;
      // (and nobody's question stays open: White's "Your priority" with Next and End turn was still up under GAME OVER
      // after the concession, Kykar re-test new bug 8)
      for (const s of game ? game.seats.values() : [seat]) if (s.prompt) closePrompt(s);
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
  // (Forge's keyword text says "this creature" on a card that is none: graft on Llanowar Reborn asked "move a +1/+1
  // counter from this creature onto it?", hp-18)
  const srcTypes = prompt.sourceCard?.types || byId[prompt.sourceCard?.id]?.types || [];
  if (srcTypes.length && !srcTypes.includes("Creature") && typeof ui.title === "string") {
    const kind = ["Land", "Artifact", "Enchantment", "Planeswalker", "Battle"].find((t) => srcTypes.includes(t));
    // (a sentence's first word too: "This creature ..." -> "This land ...")
    ui.title = ui.title.replace(/\b([Tt])his creature\b/g, (m, t) => `${t}his ${kind ? kind.toLowerCase() : "permanent"}`);
  }
  // (Forge repeats a replacement effect's text in its title: said once)
  const ability = prompt.sourceAbilityText && !String(ui.text || "").includes(String(prompt.sourceAbilityText).slice(0, 60))
    ? shorten(String(prompt.sourceAbilityText), 160) : null;
  ui.text = displayText([ui.text, ability].filter(Boolean).join("\n"));
  ui.text = plainWords(ui.text);
  ui.title = plainWords(displayText(ui.title));
  // (a question asked for a player this seat controls says so: Mindslaver's turn asked White for AI 1 under no name,
  // Kykar re-test new bug 1)
  if (forP && type !== "chooseAction" && typeof ui.title === "string") ui.title = `${nameOf(forP)} (you control): ${ui.title}`;
  if (ui.options) ui.options = ui.options.map((o) => ({ ...o, label: plainWords(displayText(o.label)) })); // keeps id/cardId
  // (no heading of Forge's is ever an option, whatever the question: see isForgeHeading)
  if (ui.options) ui.options = ui.options.filter((o) => !isForgeHeading(o.label));
  if (type === "chooseCards" && ui.options) tellApart(ui.options, input.cards || [], seat.slot);
  ui.min ??= 1; ui.max ??= 1;
  // Lists of cards, targets, types or pairs read better A-Z (the engine gives them in no useful order).
  // (unless the question put its own first: a text change's word list, the target's words first)
  // (numbers by their value: same-named tokens read "#1, #10, #11, #2", Kykar hand test #9)
  if (ui.mode === "multi" && ui.options && !ui.keepOrder) {
    const quick = ui.options.filter((o) => String(o.id).startsWith("__"));
    ui.options = [...quick, ...ui.options.filter((o) => !String(o.id).startsWith("__")).sort((x, y) => String(x.label ?? "").localeCompare(String(y.label ?? ""), undefined, { numeric: true }))];
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
  seat.prompt = { promptId: prompt.promptId, type, toOutput, input, sentAt: performance.now(), picks: [], ui, forP };
  if (process.env.MTG_TRACE) log(`prompt ${seat.color} #${prompt.promptId}: ${type} "${ui.title}"`);
  if (seat.tripsOpen) { seat.tripsOpen = false; noteSample(ttsStats.trips, "after an answer", seat.trips); }
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
  if (total > TIMER_WARN) seat.timerWarn = setTimeout(() => guarded("timer warning", () => { if (seat.prompt?.promptId === promptId) chat(`[MTG] ${TIMER_WARN} seconds left to answer.`, seat.color); }), (total - TIMER_WARN) * 1000); // (to the player asked only: it went to everyone, live check 1)
  seat.timerEnd = setTimeout(() => guarded("timer", () => timerExpired(seat, promptId)), total * 1000);
  seat.timerWarn?.unref?.(); seat.timerEnd.unref?.();
}
// The safest legal answer to what's on screen: pass, keep, no attackers or blockers, No, cancel a payment; else the
// question's first legal picks. A question can name its own (ui.onTimeout); a sub-question with Back steps back to
// the question under it, whose own safe answer then applies (review 2026-11-05: a timeout on "how do you play it?"
// cast the first way).
function timeoutChoice(ui) {
  if (ui.onTimeout) return [ui.onTimeout];
  if (ui.mode === "number") return [String(ui.min ?? 0)];
  const ids = (ui.options || []).map((o) => String(o.id));
  if (ui.mode === "multi") return ids.filter((id) => !id.startsWith("__")).slice(0, ui.min || 0);
  return [["__back", "__pass", "keep", "__cancel", "__auto", "__keep", "auto", "ok", "no"].find((id) => ids.includes(id)) ?? ids[0]];
}
function timerExpired(seat, promptId) {
  if (seat.prompt?.promptId !== promptId) return;
  // (a manual fix or a rewind vote holds the game: everyone's clock waits)
  // (but a fix being applied is the engine playing its free plays: their questions are timed like any other)
  // (an open vote only: Forge keeps the vote's record on the board once it has ended, and every clock stopped for good
  // after the first rewind vote of a game)
  if ((game?.fix && game.fix.state !== "applying") || seat.board?.state?.gameView?.restoreVote?.status?.type === "pending") { armTimer(seat); return; }
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
// The seat's open question is answered or gone: forget it and take it off the player's panel. A sub-question
// (askUnder) closed by anything but its own answer gives its card back (refused: the table turned or moved it at the
// gesture, and nothing else redraws it until the next board; review 2026-11-06). answered: the open question itself was
// answered (onAnswer), so its card goes ahead.
function closePrompt(seat, answered = false) {
  const back = !answered && seat.prompt?.under?.returns;
  if (back) toTTS({ t: "refused", color: seat.color, id: back });
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

// The rules on the battlefield that forbid what a player just tried, quoted with their card: Grand Abolisher's "Your
// opponents can't cast spells during your turn.", Drannith Magistrate's "... from anywhere other than their hands.",
// Null Rod's "Activated abilities of artifacts can't be activated." (the user, 2026-11-10: "you can't cast while not
// your turn, you can't cast from anywhere except your hand"). kind: "cast", "land" or "activate"; `card` the card tried,
// `zone` where it is, `who` the player trying. Only sentences that can apply now are kept: one aimed at opponents is
// not quoted to its controller, "during your turn" only on that turn, a type, colour, mana value or zone it names has to
// match. A sentence whose words can't be checked (Rule of Law's "more than one spell each turn") is kept: it may be why.
// Returns ['Grand Abolisher (AI 1): "Your opponents can't cast spells during your turn."', ...]. Static text only:
// abilities ("{T}: ...", "When ...") and one-turn effects ("this turn") are skipped, and an effect from a resolved spell
// (Silence) is on no permanent, so it isn't found.
const RESTRICTS = {
  cast: /\bcan't cast\b|\bcan't be cast\b|\bcan cast (?:spells|no more than)\b|\bcan cast [^.]*\bonly\b/i,
  land: /\bcan't play lands?\b|\bcan play lands? only\b/i,
  activate: /\bcan't be activated\b|\bcan't activate\b/i,
};
const COLOR_LETTER = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
// does "noncreature", "instant and sorcery", "red", "multicolored", ... describe this card? (an unknown word: yes)
function describesCard(words, card) {
  const types = (card?.types || []).map((t) => t.toLowerCase());
  const supers = (card?.supertypes || []).map((t) => t.toLowerCase());
  const color = String(card?.color || "");
  const has = (w) => w in COLOR_LETTER ? color.includes(COLOR_LETTER[w]) : w === "multicolored" ? color.length > 1 : w === "colorless" ? !color
    : w === "monocolored" ? color.length === 1 : types.includes(w) || supers.includes(w) ? true
    : /^(creature|artifact|enchantment|instant|sorcery|planeswalker|land|battle|kindred|legendary)$/.test(w) ? false : null;
  const list = String(words).toLowerCase().split(/[\s,]+/).map((w) => w.replace(/(?<=[a-z])(?:s|ies)$/, (m) => (m === "ies" ? "y" : ""))).filter((w) => w && !/^(and|or|a|an)$/.test(w));
  const pos = [];
  for (const w of list) {
    const neg = w.startsWith("non") ? w.slice(3).replace(/^-/, "") : null;
    const r = has(neg || w);
    if (r === null) return true;
    if (neg) { if (r) return false; } else pos.push(r);
  }
  return !pos.length || pos.some(Boolean);
}
function restrictionLines(gv, kind, who, card, zone) {
  const out = [];
  const sorceryNow = gv.activePlayerId === who && /main/i.test(gv.step || "") && !(gv.stack || []).length;
  for (const z of gv.zones || []) {
    if (z.zone !== "battlefield") continue;
    for (const c of z.cards || []) {
      if (c.isFaceDown || c.phasedOut || !c.identity?.name) continue;
      const ctl = c.controllerId || z.ownerId;
      const lines = String(c.currentText ?? c.text ?? "").replace(/\([^)]*\)/g, "").split(/\n+/)
        .filter((l) => !/^\s*(?:When|Whenever|At)\b/i.test(l) && !/^[^."]*(?:\{[^}]*\}|^\s*[+−-]?\d+|\])[^."]*:\s/.test(l));
      for (const s of lines.flatMap((l) => l.split(/(?<=\.)\s+/)).map((x) => x.trim()).filter(Boolean)) {
        if (!RESTRICTS[kind].test(s) || /\bthis turn\b/i.test(s)) continue;
        const name = c.identity.name;
        const self = new RegExp(`^(?:${escapeRe(name)}|this (?:creature|permanent|artifact))\\b`, "i");
        if (/^(?:enchanted|equipped|fortified) /i.test(s)) { if (c.attachedTo !== card?.id) continue; }
        else if (self.test(s)) { if (c.id !== card?.id) continue; }
        else if (/\b(?:your opponents|each opponent|opponents)\b/i.test(s)) { if (who === ctl) continue; }
        else if (/^you\b/i.test(s) && who !== ctl) continue;
        if (/\bduring your turn\b/i.test(s) && gv.activePlayerId !== ctl) continue;
        if (/\bduring combat\b/i.test(s) && !/combat|attack|block|damage/i.test(gv.step || "")) continue;
        if (/\bonly (?:any time (?:they|you) could cast a sorcery|as a sorcery)\b/i.test(s) && sorceryNow) continue;
        if (/\bonly during (?:their|your) own turns?\b/i.test(s) && gv.activePlayerId === who) continue;
        if (/\bfrom anywhere other than (?:their|your) hands?\b/i.test(s)) { if (zone === "hand") continue; }
        else if (/\bfrom (?:[a-z' ]*?)(?:graveyards?|librar(?:y|ies)|exile)\b/i.test(s)) {
          const from = s.match(/\bfrom ([^.]*)/i)[1];
          if (!(zone === "graveyard" && /graveyard/i.test(from) || zone === "library" && /librar/i.test(from) || zone === "exile" && /exile/i.test(from))) continue;
        }
        const parity = s.match(/\bwith (even|odd) mana values?\b/i)?.[1];
        if (parity && Number.isFinite(card?.cmc) && (card.cmc % 2 === 0) !== (parity.toLowerCase() === "even")) continue;
        const mv = s.match(/\bmana value (\d+) or (greater|more|less|fewer)\b/i);
        if (mv && Number.isFinite(card?.cmc) && (/greater|more/i.test(mv[2]) ? card.cmc < Number(mv[1]) : card.cmc > Number(mv[1]))) continue;
        const spellWords = kind === "cast" ? (s.match(/\bcan't cast ([a-z, -]*?)spells\b/i) || s.match(/^([a-z, -]*?)spells\b[^.]*\bcan't be cast\b/i))?.[1] : null;
        if (spellWords && !describesCard(spellWords, card)) continue;
        const of = kind === "activate" ? s.match(/\bactivated abilities of ([a-z, -]+?)(?: (?:you|your opponents|an opponent) controls?)?(?: with [^.]*?)? can't\b/i)?.[1] : null;
        if (of && !/^sources?$/i.test(of.trim()) && !describesCard(of, card)) continue;
        if (kind === "activate" && /\bwith the chosen name\b/i.test(s) && (c.choices || []).length && !(c.choices || []).some((x) => (x.values || []).includes(card?.identity?.name))) continue;
        out.push(`${name} (${nameOf(ctl)}): "${s}"`);
      }
    }
  }
  return [...new Set(out)];
}
const onTheTable = (lines) => ` On the table: ${lines.slice(0, 3).join("; ")}${lines.length > 3 ? "; ..." : ""}.`;

// The mana a player could make now, about: their pool, and each untapped permanent of theirs with a "{T}: Add" ability
// (a basic land 1; a creature only once it can tap). Cost reducers, rituals and lands with other costs are not seen,
// so it is said as "about", and only when the card costs more.
function manaAvailable(gv, who) {
  const p = (gv.players || []).find((x) => x.id === who);
  let n = Object.values(p?.manaPool || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  for (const z of gv.zones || []) {
    if (z.zone !== "battlefield") continue;
    for (const c of z.cards || []) {
      if ((c.controllerId || z.ownerId) !== who || c.tapped || c.phasedOut) continue;
      const types = c.types || [];
      if (types.includes("Creature") && c.summoningSick && !hasKeyword(c, "Haste")) continue;
      const add = String(c.text || "").match(/\{T\}(?:, [^:\n]*)?: Add ([^.\n]*)/);
      if (add) n += (add[1].match(/\{[WUBRGC]\}/g) || []).length || (/\btwo\b/i.test(add[1]) ? 2 : /\bthree\b/i.test(add[1]) ? 3 : 1);
      else if (types.includes("Land") && (c.supertypes || []).includes("Basic")) n += 1;
    }
  }
  return n;
}

// The first target a spell must have and whether the table has one: "Counterspell needs a spell on the stack to
// target, and there is none." Not for "up to" targets nor a modal spell ("Choose one —"), whose modes target apart.
// Hexproof and shroud are counted for permanents; protection and other "can't be the target" rules are not.
const TARGET_NOUNS = { spell: null, creature: "Creature", artifact: "Artifact", enchantment: "Enchantment", planeswalker: "Planeswalker", land: "Land", permanent: "" };
function missingTarget(gv, who, card, name) {
  const text = String(card?.currentText ?? card?.text ?? "").replace(/\([^)]*\)/g, "");
  if (/^\s*Choose (?:one|two|three|any|up to)\b/im.test(text) || !/(Instant|Sorcery)/.test((card?.types || []).join(" "))) return null;
  const re = /\btarget (spell|creature|artifact|enchantment|planeswalker|land|permanent)\b(?: (you control|an opponent controls|you don't control))?/gi;
  let m;
  while ((m = re.exec(text))) {
    if (/\b(?:up to (?:one|two|three|four|five|X|\w+)|any number of)\s*(?:other )?$/i.test(text.slice(Math.max(0, m.index - 24), m.index))) continue;
    const noun = m[1].toLowerCase();
    if (noun === "spell") {
      const spells = (gv.stack || []).filter((s) => !isAbilityOnStack(s, gv));
      return spells.length ? null : `${name} needs a spell on the stack to target, and there is none.`;
    }
    const whose = m[2]?.toLowerCase();
    const all = (gv.zones || []).filter((z) => z.zone === "battlefield").flatMap((z) => (z.cards || []).map((c) => [c, c.controllerId || z.ownerId]))
      .filter(([c, ctl]) => !c.phasedOut && (TARGET_NOUNS[noun] ? (c.types || []).includes(TARGET_NOUNS[noun]) : true)
        && (!whose || (whose === "you control" ? ctl === who : ctl !== who)));
    const legal = all.filter(([c, ctl]) => !hasKeyword(c, "Shroud") && !(ctl !== who && hasKeyword(c, "Hexproof")));
    if (legal.length) return null;
    return `${name} needs a target (target ${noun}${whose ? ` ${whose}` : ""}), and there is ${all.length ? "none it can target: they have hexproof or shroud" : "none on the table"}.`;
  }
  return null;
}

// anyPriority: the reason it couldn't be played even at this seat's priority (a drag made out of priority, onIntent)
function whyNot(seat, cardId, { anyPriority = false } = {}) {
  const gv = seat.board?.state?.gameView || {};
  const card = cardIndex(gv)[cardId];
  const name = card?.identity?.name || "That card";
  // (a card of a player this seat controls is played as that player: its turn and priority count, see actingFor)
  const where = (gv.zones || []).find((z) => (z.cards || []).some((c) => c.id === cardId));
  const holder = where?.ownerId;
  const zone = where?.zone;
  const who = ruledBy(gv, seat.slot).includes(holder) ? holder : seat.slot;
  const me = (gv.players || []).find((p) => p.id === who);
  const types = card?.types || [];
  const myMain = gv.activePlayerId === who && /main/i.test(gv.step || "") && !(gv.stack || []).length;
  if (card?.phasedOut) return `${name} is phased out: it counts as not there until it phases in.`;
  if (!anyPriority && gv.priorityPlayerId !== who) return `${name}: wait, it isn't ${who === seat.slot ? "your" : `${nameOf(who)}'s`} priority.`;
  // (a permanent already on the battlefield is not played: Arena of Glory, its one ability a mana ability, read "lands
  // can only be played in your main phase with an empty stack" in the main phase, hp-09)
  if (zone === "battlefield") {
    const text = String(card?.text || "");
    const banned = restrictionLines(gv, "activate", who, card, zone);
    if (banned.length) return `${name}: its abilities can't be used.${onTheTable(banned)}`;
    // (summoning sickness: a creature's {T} abilities wait for its controller's next turn, haste aside)
    if (types.includes("Creature") && card.summoningSick && !hasKeyword(card, "Haste") && /(?:^|\n)[^:\n]*\{T\}[^:\n]*:/.test(text)) {
      return `${name} has summoning sickness: its {T} abilities work from your next turn (it came under your control this turn).`;
    }
    const mana = /(?:^|\n)[^:\n]*:\s*Add (?:\{|one|two|three|X|an amount|that much|mana)/i.test(text);
    return `${name}: none of its abilities can be used right now${mana ? " (a mana ability is used while paying a cost: tap it then)" : ""}.`;
  }
  // (a card somewhere it can't be played from, and nothing lets it: the hand and, for a commander, the command zone are
  // the usual places; a graveyard, exile or a library only by a card's leave, said so. "Your graveyard" or AI 1's.)
  const fromElsewhere = zone && zone !== "hand" && zone !== "command";
  if (fromElsewhere) {
    const banned = restrictionLines(gv, types.includes("Land") ? "land" : "cast", who, card, zone);
    if (banned.length) return `${name} can't be ${types.includes("Land") ? "played" : "cast"} from there.${onTheTable(banned)}`;
    const whose = holder === who ? "your" : `${nameOf(holder)}'s`;
    const lets = zone === "graveyard" ? "something lets you (flashback, escape, unearth or a card's effect)" : "a card's effect lets you";
    const own = zone === "graveyard" && /(?:^|\n)(?:Flashback|Escape|Retrace|Jump-start|Disturb|Embalm|Eternalize|Unearth|Aftermath|Harmonize|Mayhem)\b/i.test(String(card?.text || ""));
    if (!own) return `${name} is in ${whose} ${ZONE_SAID[zone] || zone}: it can be ${types.includes("Land") ? "played" : "cast"} from there only if ${lets}.`;
  }
  if (types.includes("Land")) {
    if (gv.activePlayerId !== who) return `${name}: lands can only be played on ${who === seat.slot ? "your" : `${nameOf(who)}'s`} turn.`;
    if (me && me.landsPlayedThisTurn >= (me.maxLandPlaysPerTurn || 1)) return `${name}: you already played a land this turn.`;
    const banned = restrictionLines(gv, "land", who, card, zone);
    if (banned.length) return `${name}: you can't play lands right now.${onTheTable(banned)}`;
    return `${name}: lands can only be played in your main phase with an empty stack.`;
  }
  const instantSpeed = types.includes("Instant") || hasKeyword(card, "Flash");
  if (!instantSpeed && !myMain) return `${name}: only at sorcery speed (your main phase, empty stack).`;
  const banned = restrictionLines(gv, "cast", who, card, zone);
  if (banned.length) return `${name} can't be cast right now.${onTheTable(banned)}`;
  const target = missingTarget(gv, who, card, name);
  if (target) return target;
  // (the commander tax: {2} more for each earlier cast from the command zone)
  const tax = zone === "command" ? 2 * (Number(me?.commanderCasts?.[cardId]) || 0) : 0;
  const cost = (Number(card?.cmc) || 0) + tax;
  const avail = manaAvailable(gv, who);
  if (cost > avail) return `${name}: probably not enough mana. It costs ${card?.manaCost && card.manaCost !== "no cost" ? `${card.manaCost} (${card.cmc})` : cost}${tax ? ` plus {${tax}} commander tax` : ""}, and you have about ${avail} available.`;
  return `${name}: can't be cast right now (not enough mana or the right colours, no legal targets, or another restriction).`;
}

// "If you cast it any time a sorcery couldn't have been cast, ... sacrifices it at the beginning of the next cleanup
// step" (Necromancy, and cards worded like it): read from the rules text, not a list of names
function sacrificedIfInstant(card) {
  const text = String(card?.text || "");
  return /any time a sorcery couldn.t have been cast/i.test(text) && /sacrifices? it/i.test(text);
}
// your own main phase with an empty stack: when a sorcery could be cast (or the main phase of the player whose question
// is open, one this seat controls: see actingFor)
function sorceryTime(seat, gv) {
  return gv.activePlayerId === (seat.prompt?.forP || seat.slot) && /main/i.test(gv.step || "") && !(gv.stack || []).length;
}

// A player's answer or gesture starts a count of the engine questions until the next one shown to them (GET /stats trips)
function startTrips(color) {
  const seat = game?.seats?.get(color);
  if (seat) { seat.trips = 0; seat.tripsOpen = true; }
}

function onIntent(m) {
  if (process.env.MTG_TRACE) log(`intent ${m.color}: ${m.kind} ${m.id} (${cardNameIn(game?.seats.get(m.color) || {}, m.id)})`); // eslint-disable-line no-param-reassign
  const seat = game?.seats.get(m.color);
  if (!seat || !game.started) return;
  const p = seat.prompt;
  const input = p?.input || {};
  const name = cardNameIn(seat, m.id);
  // One question of the bridge's own at a time (askUnder): a gesture while one is open is refused and the open one
  // stays. (Before, a second card dragged was cast and left the first one on the battlefield, and a Q/E nested a second
  // sub-question whose Cancel went back to the first: review 2026-11-05, "Missed".) Nothing is done for a gesture
  // made while the player had a different question in front of them; that question's Back still puts its card back.
  if (p?.under) {
    const back = (p.ui?.options || []).find((o) => o.id === "__back")?.label;
    return refuse(seat, m.id, `${name} stays: answer "${p.ui?.title || "the open question"}" first${back ? ` (or ${back})` : ""}.`);
  }
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
      const gv = seat.board?.state?.gameView || {};
      const card = cardIndex(gv)[m.id];
      // (a card in a graveyard, exile or a library only when the engine says this seat may play it. Rancor, discarded a
      // moment before, was dragged from beside the graveyard and queued, and the next drag of it was read as a hand card
      // again, 2026-11-08 23:39. A permanent's drag is kept as before: the next priority uses it for an equip, a
      // loyalty or a {T} ability.)
      const zone = (gv.zones || []).find((z) => (z.cards || []).some((c) => c.id === m.id))?.zone;
      const offPlay = zone === "graveyard" || zone === "exile" || zone === "library";
      if (card && !(card.types || []).includes("Land") && offPlay && !card.mayPlay) {
        return refuse(seat, m.id, whyNot(seat, m.id, { anyPriority: true }));
      }
      if (card && !(card.types || []).includes("Land")) {
        seat.queuedPlay = { id: m.id, at: Date.now(), ...(m.side === 1 || m.side === 2 ? { side: m.side } : {}) };
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
    // (a click on a mana rock or creature at priority taps it, as its "Mana: tap" button does: Arcane Signet was refused
    // with "none of its abilities can be used right now", mechanic run hp-01 2026-11-05)
    if (!acts.length && (seat.prompt?.ui?.options || []).some((o) => o.id === `__mana:${m.id}`)) return onAnswer(seat.color, seat.prompt.promptId, [`__mana:${m.id}`]);
    if (!acts.length) return refuse(seat, m.id, whyNot(seat, m.id));
    // A two-faced card plays the side the table shows (its state, or turned over: docs/card-other-side-spec.md): only
    // that side's ways, with the ways of no one side (cycling). A side it can't play now is said, the other side is not
    // played instead. A table that sends no side asks among them all, as before.
    const shown = m.side === 1 || m.side === 2 ? m.side : null;
    if (shown) {
      const card = cardIndex(seat.board?.state?.gameView || {})[m.id];
      const sideOf = (a) => actionSide(a, card);
      const theirs = acts.filter((a) => sideOf(a) === shown);
      if (!theirs.length && acts.some((a) => sideOf(a) != null)) {
        const other = otherSide(card, name)?.name;
        const face = shown === 1 ? name : other || `${name}'s other side`;
        const can = shown === 1 ? other || "Its other side" : name;
        const verb = shown === 1 && (card?.types || []).includes("Land") ? "played" : "cast";
        return refuse(seat, m.id, `${face} can't be ${verb} right now. ${can} can: show that side and drag it again.`);
      }
      if (theirs.length) acts = acts.filter((a) => sideOf(a) === shown || sideOf(a) == null);
    }
    // (a controlled player's card: what it asks next is that player's, see actingFor)
    if (p.forP) seat.actingFor = { p: p.forP, card: acts[0].cardId, turn: seat.board?.state?.gameView?.turn };
    // A card that can be played more than one way (a modal double-faced card: cast the spell or play the land; an
    // adventure; a split card): ask, as Arena does, instead of taking the first. "Back" returns to the open question.
    // (one way per label and mode: Flare of Duplication's "sacrifice a nontoken red creature" cast has the same label as its
    // normal one, and a drag cast it for mana with no question, rebuilt hand test #18)
    const wayKey = (a) => `${a.label || a.description || a.id}|${a.mode?.type || ""}|${a.mode?.cost || ""}`;
    const ways = [];
    for (const a of acts) if (!ways.some((w) => wayKey(w) === wayKey(a))) ways.push(a);
    if (ways.length > 1) {
      // (a keyword's way without its reminder sentence, its cost kept: Foretell's button read "Foretell (During your turn,
      // you may pay {2} and exile", cut there, hp-06 2026-10-28)
      const wayLabel = (a) => {
        // (the harness's short name for More Than Meets the Eye: "Cast Starscream, Seeker Leader (MTMtE)", hp-17)
        const l = String(a.label || a.description || (a.type === "cast" ? `Cast ${name}` : "Use its ability")).replace(`${name}: `, "")
          .replace(/\(MTMtE\)$/, "(More Than Meets the Eye)");
        // (a split card cast whole is its fuse: "Cast Turn // Burn" beside "Cast Turn" and "Cast Burn", hp-15)
        if (a.type === "cast" && name.includes(" // ") && l === `Cast ${name}`) return "Cast both halves (fuse)";
        // (an alternative cost under the plain label: by what the card says it is)
        if (a.mode?.type === "staticAlternative" && l === `Cast ${name}`) {
          const how = altCostWords(seat.board?.state?.gameView, a.cardId);
          return /^without paying\b/.test(how) ? `Cast ${name} ${how}` : `Cast ${name} (${how})`;
        }
        // (a reminder sentence only: "Cast X (WebSlinging)" names the way, and keeps its brackets)
        const m = l.match(/^([^()]+?) \((.+\.)\)$/);
        if (!m || m[1].includes("{")) return m ? m[1] : l;
        const pay = m[2].match(/\bpay ((?:\{[^}]+\})+)/i);
        return pay ? `${m[1]} (pay ${pay[1]})` : m[1];
      };
      return askUnder(seat, { title: `${name}: how do you play it?`, text: "", mode: "single", kind: "choice", min: 1, max: 1,
        options: ways.map((a) => ({ id: String(a.id), label: wayLabel(a) })) },
      (picks) => ({ type: "act", actionId: ways.find((a) => String(a.id) === picks[0])?.id ?? picks[0] }), { back: "Back", returns: m.id });
    }
    const act = acts.find((a) => a.mode?.type === "normal") || acts[0];
    // Necromancy and the like: cast when a sorcery couldn't be, it is sacrificed at the next cleanup step (and the
    // creature it brought back with it). Ask first (playtest 2026-10-25: Necromancy cast in the draw step; the
    // Obliterator it returned was gone half a second later and it looked like the table had lost it)
    const gv = seat.board?.state?.gameView || {};
    if (act.type === "cast" && sacrificedIfInstant(cardIndex(gv)[m.id]) && !sorceryTime(seat, gv)) {
      return askUnder(seat, { title: `${name}: cast it now?`, mode: "single", kind: "choice", min: 1, max: 1,
        text: `Cast now, outside your main phase, ${name} is sacrificed at the next cleanup step, and whatever it brings back goes with it. Cast it in your main phase to keep it.`,
        options: [{ id: String(act.id), label: "Cast anyway" }] }, () => ({ type: "act", actionId: act.id }), { back: "Wait (keep it)", returns: m.id });
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
      // (Cancel and a timeout go back to priority and put the turned card back: refused, as Back does above)
      return askUnder(seat, { title: `${name}: which ability?`, mode: "single", kind: "choice",
        options: acts.map((a) => ({ id: a.id, label: a.label || a.description || a.id })) }, (a) => ({ type: "act", actionId: a[0] }), { back: "Cancel", returns: m.id });
    }
    if (acts.length === 1) return act(acts[0]);
    // a land with a choice of colours: ask which, under the same prompt
    const manaCard = cardIndex(seat.board?.state?.gameView || {})[m.id];
    return askUnder(seat, { title: `Tap ${name} for which mana?`, mode: "single", kind: "choice",
      options: distinctLabels(acts, (a) => manaChoiceText(a, manaCard, a.id)).map((label, i) => ({ id: acts[i].id, label })) },
    (a) => ({ type: "act", actionId: a[0] }), { back: "Cancel", returns: m.id });
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

// Forge's own log entries, a "log" envelope each: none come from our self-hosted node (manabrew-rs never makes one,
// checked 2026-11-11), so the game log file is the bridge's own log (gameLogFile); one that did come would go there too
function onGameLog(entry) {
  if (!entry?.message) return;
  const text = displayText(entry.message);
  gameLogFile([`(Forge, ${entry.entryType}) ${text}`]);
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
    showPrompt(seat); // (with its step: a sub-question or a step re-sent without it read as the question under it)
    return;
  }
  const problem = ttsScry ? null : answerProblem(ui, picks);
  if (problem) {
    log(`answer refused for ${color} #${promptId}: ${problem} (${JSON.stringify(picks).slice(0, 120)})`);
    chat(`[MTG] ${problem} Choose again.`, color);
    showPrompt(seat); // (with its step: a sub-question or a step re-sent without it read as the question under it)
    return;
  }
  const out = toOutput(picks.map(String));
  if (out === ASKED) return; // (a sub-question asked, or its way back taken: askUnder sent it)
  if (out && out.__next) {
    // a step-by-step choice: show the next step under the same engine prompt
    const ui2 = prepareUi(out.__next.ui);
    const step = Date.now() % 100000;
    seat.prompt = { ...seat.prompt, ui: ui2, toOutput: out.__next.toOutput, step };
    showPrompt(seat);
    return;
  }
  seat.respond(promptId, type, out);
  closePrompt(seat, true);
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
// A card name the table read can arrive as its UTF-8 bytes, one character each: "アクローマの意志" came as
// "ã\u0082¢ã\u0082¯…" (2026-11-12; tmp/table-log.log holds those characters, UTF-8 encoded once more). Both of the
// bridge's ports decode UTF-8 correctly (tests/test_foreign_names.js), so the bytes were made characters inside TTS,
// whose Lua strings are UTF-16: its JSON.lua turns a \uXXXX escape into UTF-8 bytes, one character each.
// A string of only U+0000-U+00FF whose bytes are valid UTF-8 with a multi-byte character is read as that UTF-8; a
// real Latin-1 name ("Séance": é followed by a letter) is not valid UTF-8 and stays as it is.
const UTF8_AS_LATIN1 = /[Â-ô][\u0080-¿]/;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
function fromUtf8Bytes(s) {
  if (!UTF8_AS_LATIN1.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  try { return utf8Decoder.decode(Buffer.from(s, "latin1")); } catch { return s; }
}
const tableText = (k, v) => (typeof v === "string" ? fromUtf8Bytes(v) : v);
function onTTS(m) {
  ttsSaw(true); ttsLink.tableAt = Date.now();
  if (typeof m.json === "string") {
    // (the reviver only for a text that may hold such characters, raw or escaped)
    const latin = /[\u0080-ÿ]|\\u00[89a-f]/i.test(m.json);
    try { m = { ...JSON.parse(m.json, latin ? tableText : undefined), t: m.t }; } catch { return log(`bad json payload for ${m.t}`); }
  }
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
      tableKeepsRewind = m.keepRewind === true;
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
        startGame(asList(m.seats), Number(m.bots) || 0, !!m.requireReady, m.autoplay ? false : (m.fromTable ?? !!m.requireReady), asList(m.aiSeats), m.friendly);
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
    case "aiseat": // "mtg ai ..." (the host's, make-engine-copy.js)
      onAiSeatChat(m.text);
      break;
    case "reset":
      for (const c of Object.keys(readyDecks)) delete readyDecks[c]; // the next game reads decks from the table again
      for (const c of Object.keys(deckGen)) deckGen[c]++; // (and a check waiting on Scryfall is dropped)
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
      startTrips(m.color);
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
      chat(phase === "mine" ? "[MTG] Passing until your next turn; an opponent's spell stops it. (mtg skip off)"
        : `[MTG] "${SKIP_SAID[phase]}": you pass priority except in ${SKIP_WHERE[phase]} (every turn, anyone's) or when an opponent's spell or ability is on the stack. It stays on until you change it. (mtg skip off)`, m.color);
      // a priority already waiting goes at once
      if (seat.prompt?.type === "chooseAction" && !skipStopsHere(seat.skipTo, gv, seat.slot) && !(gv.stack || []).some((x) => x.controllerId !== seat.slot)) {
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
      startTrips(m.color);
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
    case "debug":
      onDebug(m);
      break;
    case "planechase":
      onPlanechase(m);
      break;
    case "planes":
      onPlanes(m);
      break;
    case "art": // "mtg art on|off" (host, checked on the table)
      onArt(m);
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
// (a step the list doesn't offer in the table's words too: a point asked for by its id, which onRewind takes from any of
// Forge's checkpoints, said Forge's own step name in the chat and the log, the gap "Skip ended: combatBegin" had, live
// check 12)
const rewindStep = (step) => REWIND_STEPS[step] || STEP_WORDS[step] || step;
// (every seat as the game log names it: an AI seat is "AI 2", not its colour "Yellow"; live check 2026-11-11, the rewind
// list said "Yellow's attacks" and the vote "Waiting for Yellow" while the log said AI 2)
const seatWords = (slot) => (game.slotColor[slot] ? nameOf(slot) : null);
function checkpointLabel(c) {
  return `turn ${c.turn}, ${nameOf(c.activePlayerId)}'s ${rewindStep(c.step)}`;
}
function rewindState(gv) {
  const points = (gv.checkpoints || []).filter((c) => REWIND_STEPS[c.step]).slice(-12).reverse()
    .map((c) => ({ id: c.checkpointId, label: checkpointLabel(c) }));
  const v = gv.restoreVote;
  // (waiting: the colours still to vote, which the table matches against its own seats; waitingNames: the people among
  // them, by name. A harmless bot votes by itself at once (harmlessVotes), so the table isn't told it waits for one)
  const bots = new Set((game.harmless || []).map((h) => h.slot));
  const awaiting = (v?.awaitingPlayerIds || []).filter((id) => game.slotColor[id]);
  // (byColor: the asker's seat, whose Keep playing button takes the vote back, onRewindVote)
  const vote = v ? { id: v.voteId, to: v.checkpoint ? checkpointLabel(v.checkpoint) : "?", by: seatWords(v.requestedByPlayerId), byColor: game.slotColor[v.requestedByPlayerId] || null,
    waiting: awaiting.map((id) => game.slotColor[id]), waitingNames: awaiting.filter((id) => !bots.has(id)).map(nameOf), status: v.status?.type || "pending",
    declinedBy: v.status?.playerId ? seatWords(v.status.playerId) : null } : null;
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
  else if (v.status === "pending") chat(`[MTG] ${v.by || "A player"} asks to rewind to ${v.to}.${v.waitingNames.length ? ` Waiting for ${v.waitingNames.join(", ")}: vote in the pop-up (or type  mtg vote yes / mtg vote no).` : ""}`);
  else if (v.status === "declined" && game.voteWithdrawn === v.id) chat(`[MTG] ${v.by || "The player who asked"} withdrew the rewind.`);
  else if (v.status === "declined") chat(`[MTG] Rewind declined${v.declinedBy ? ` by ${v.declinedBy}` : ""}.`);
  else if (v.status === "unavailable") chat("[MTG] That point is no longer kept, so the rewind was cancelled.");
  return r;
}
function onRewind(color, checkpointId) {
  const seat = game?.seats.get(color);
  const gv = seat?.board?.state?.gameView;
  if (!gv || !game.started) return chat("[MTG] Only a player in the running game can ask to rewind.", color);
  // (a finished game first: the engine ended Kykar's game as a draw and every player was "lost", so the refusal read
  // "Players who are out can't ask to rewind", Kykar hand test #16)
  if (gv.gameOver || game.over) { const why = gameEndWords(gv); return chat(`[MTG] The game has ended${why ? ` (${why})` : ""}, so it can't be rewound. Start a new game.`, color); }
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
  // (the asker's no takes it back. Forge lets only a voter it waits for decline, so the no goes through one of those
  // seats; the chat then says it was withdrawn (rewindNews). A voter who never answers held the game until someone
  // conceded, table log 2026-11-12 01:18)
  if (!accept && v.requestedByPlayerId === seat.slot && !(v.awaitingPlayerIds || []).includes(seat.slot)) {
    const voter = [...game.seats.values()].find((st) => (v.awaitingPlayerIds || []).includes(st.slot));
    if (!voter) return chat("[MTG] Nobody is left to vote: the rewind goes ahead.", color);
    log(`${color} withdraws the rewind (vote ${v.voteId}), declined through ${voter.color}'s seat`);
    game.voteWithdrawn = v.voteId;
    voter.directive({ type: "restoreVote", voteId: v.voteId, accept: false });
    return;
  }
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
  createCard: { name: "cardName", player: "player", zone: "zone", tapped: "bool?" },
  // fix from hand (docs/m7-manual-fix-spec.md §12, tmp/fix-from-hand-protocol.md): played by the engine after the plain
  // ops, with triggers on and no mana; `ability` is never sent by the table (the engine asks when there are several)
  freeCast: { card: "card", player: "player" }, freeLand: { card: "card", player: "player" },
  freeActivate: { card: "card", player: "player", ability: "count?" },
  // the engine's own draw and mill (Forge's Player.drawCards and mill), made after the plain ops with triggers on, like
  // the free plays: the companion's debug tools only (fixOps refuses them in a list the table sent), as no fix op can
  // reach a library card (the board shows none).
  // Engine images built before 2026-11-11 drop a directive with these unread (fixWatchdog says so).
  draw: { player: "player", n: "count" }, mill: { player: "player", n: "count" },
  // dungeons in a debug setup (docs/planechase-dungeon-engine-spec.md D4): no triggers, as every op here
  dungeon: { player: "player", name: "cardName", room: "cardName?" }, completedDungeon: { player: "player", name: "cardName" },
  initiative: { player: "player" },
  // Planechase (spec P7): run after the plain ops, with triggers on, as the free plays are
  planeswalk: { player: "player", name: "cardName" }, chaos: { player: "player" },
};
const FREE_OPS = new Set(["freeCast", "freeLand", "freeActivate"]);
const LIBRARY_OPS = new Set(["draw", "mill"]);
const nCards = (n) => `${n} card${n === 1 ? "" : "s"}`;
const FIX_KINDS = { hand: "fix from hand", board: "edit the board" };
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
    if (Object.hasOwn(TOKEN_COLOURS, w)) colours += TOKEN_COLOURS[w];
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
  // a card by its name, as Forge's card list has it (the engine says "no card named ..." for one it doesn't know)
  cardName: (v) => !(typeof v === "string" && v.trim() !== "" && v.length <= 141) && `No card name "${String(v).slice(0, 40)}".`,
};
// a token change as the player said it: "Red gets a treasure token, tapped"
const getsToken = (who, text, tapped) => `${who} gets ${/^[aeiou]/i.test(text) ? "an" : "a"} ${text} token${tapped ? ", tapped" : ""}`;
// the engine answers an applyState at once, or first asks a free play's questions; this long with neither (fixWatchdog)
// and the fix goes back to editing
const FIX_ANSWER_MS = 20000;
function fixVoters(pub, except) {
  return [...game.seats.values()].filter((s) => s.color !== except && isPlaying(pub, s.slot)).map((s) => s.color);
}
function slotOfColor(color) { return Object.keys(game.slotColor).find((slot) => game.slotColor[slot] === color) || null; }
// The cards of a fix, by id, and the zone each is in, from every seated player's board: a board shows only its own
// seat's hand (Forge hides the others), and a fix from hand can hold picks from several players' hands while one of
// them presses Done. A card a board shows hidden (face-down exile) is taken from a board that shows it.
function fixCardView(pub) {
  const byId = {};
  const zoneOfCard = {};
  for (const gv of [pub, ...[...(game?.seats?.values() || [])].map((s) => s.board?.state?.gameView)]) {
    for (const z of gv?.zones || []) for (const c of z.cards || []) {
      if (byId[c.id] && (byId[c.id].identity || !c.identity)) continue;
      byId[c.id] = c;
      zoneOfCard[c.id] = z.zone;
    }
  }
  return { byId, zoneOfCard };
}
// The table names players by colour; the engine by slot. A list the table built is checked here, so a bad op is
// refused with a reason instead of reaching the engine. Returns { ops, lines } or { error }. ownWords: a change may say
// itself (`shown`), only for a list the bridge made (a debug setup): the table's list never words its own vote.
// kind: "hand" for a fix from hand (its graveyard moves are worded as such), else a board fix.
function fixOps(list, pub, ownWords = false, kind = null) {
  if (!Array.isArray(list) || !list.length) return { error: "Nothing was changed." };
  const { byId, zoneOfCard } = fixCardView(pub);
  const cardName = (id) => byId[id]?.identity?.name || id;
  const where = (c) => `${nameOf(c.ownerId)}'s ${zoneOfCard[c.id] || "?"}`;
  const ops = [];
  const lines = [];
  for (const raw of list) {
    const want = FIX_OPS[raw?.op];
    if (!want) return { error: `Can't read the change ${JSON.stringify(raw)}.` };
    if (LIBRARY_OPS.has(raw.op) && !ownWords) return { error: "Draw and mill come only from the companion page's debug tools." };
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
    // a free play is a table player's own card, in their hand (or, to activate, under their control on the battlefield):
    // said here, before the vote, rather than as the engine's refusal after it
    if (FREE_OPS.has(op.op)) {
      if (!game.seats.get(raw.player)) return { error: `${raw.player} isn't a player at the table: only a seated player's card can be played for free.` };
      const inHand = zoneOfCard[op.card] === "hand" && c.ownerId === op.player;
      const onField = zoneOfCard[op.card] === "battlefield" && (c.controllerId ?? c.ownerId) === op.player;
      if (!(inHand || (op.op === "freeActivate" && onField))) return { error: `${cardName(op.card)} isn't in ${poss(nameOf(op.player))} hand${op.op === "freeActivate" ? " or on their battlefield" : ""}.` };
    }
    lines.push(ownWords && typeof raw.shown === "string" ? raw.shown : {
      move: () => (kind === "hand" && op.zone === "graveyard" && zoneOfCard[op.card] === "hand" ? `${nameOf(c.ownerId)} puts ${cardName(op.card)} into their graveyard (no effect)` : null) || `${cardName(op.card)}: ${where(c)} → ${nameOf(c.ownerId)}'s ${op.zone}${op.zone === "library" ? (op.position === "bottom" ? " (bottom)" : " (top)") : ""}`,
      tap: () => `${cardName(op.card)}: ${op.tapped ? "tapped" : "untapped"}`,
      counters: () => `${cardName(op.card)}: ${op.n} ${counterWords(op.kind) || op.kind}${op.n === 1 ? "" : "s"}`,
      attach: () => (op.to ? `${cardName(op.card)}: attached to ${cardName(op.to)}` : `${cardName(op.card)}: not attached`),
      control: () => `${cardName(op.card)}: now controlled by ${nameOf(op.player)}`,
      faceDown: () => `${cardName(op.card)}: face ${op.value ? "down" : "up"}`,
      life: () => `${nameOf(op.player)} life → ${op.n}`,
      poison: () => `${nameOf(op.player)} poison → ${op.n}`,
      commanderDamage: () => `${nameOf(op.player)}: ${op.n} damage from ${cardName(op.from)}`,
      // (by what the player typed, not Forge's script name: "New token for Red: treasure (c_a_treasure_sac)" twelve
      // times, rebuilt hand test #4; the same lines are counted below)
      createToken: () => getsToken(nameOf(op.player), raw.script, op.tapped),
      mana: () => { const each = {}; for (const m of op.mana.split(" ")) each[m] = (each[m] || 0) + 1; return `${nameOf(op.player)} gets mana until the end of the turn: ${Object.entries(each).map(([m, k]) => `${k} {${m}}`).join(", ")}`; },
      createCard: () => `${nameOf(op.player)} gets ${op.name} (${op.zone}${op.tapped ? ", tapped" : ""})`,
      freeCast: () => `${nameOf(op.player)} casts ${cardName(op.card)} for free`,
      freeActivate: () => `${nameOf(op.player)} activates ${poss(cardName(op.card))} ability for free`,
      freeLand: () => `${nameOf(op.player)} plays ${cardName(op.card)} for free (the land drop stays unused)`,
      draw: () => `${nameOf(op.player)} draws ${nCards(op.n)}`,
      mill: () => `${nameOf(op.player)} mills ${nCards(op.n)}`,
      dungeon: () => `${nameOf(op.player)} is in ${op.name}, ${op.room ? `room ${op.room}` : "no room yet"}`,
      completedDungeon: () => `${nameOf(op.player)} has completed ${op.name}`,
      initiative: () => `${nameOf(op.player)} takes the initiative`,
      planeswalk: () => `${nameOf(op.player)} planeswalks to ${op.name}`,
      chaos: () => `Chaos ensues for ${nameOf(op.player)}`,
    }[op.op]());
    ops.push(op);
  }
  return { ops, lines: [...lines.reduce((m, l) => m.set(l, (m.get(l) || 0) + 1), new Map())].map(([l, k]) => (k > 1 ? `${l} ×${k}` : l)) };
}
// the fix part of a board update
function fixState() {
  const f = game?.fix;
  return f ? { id: f.id, state: f.state, ...(f.kind ? { kind: f.kind } : {}), by: f.by, waiting: f.waiting, lines: f.lines || null, message: f.message || null } : null;
}
function fixNews(pub) {
  const f = game.fix;
  const r = pub.stateFix;
  if (!f || f.state !== "applying" || !r || r.fixId !== f.applyId) return;
  if (r.applied) {
    log(`fix #${f.id} applied (${f.applyId})`);
    const what = f.debug ? `debug ${f.debug.tool ? "tool" : "setup"} "${f.debug.name}"` : "manual fix";
    chat(`[MTG] ${what[0].toUpperCase()}${what.slice(1)} applied: ${f.lines.join("; ")}.`);
    // (and in the game log, which said nothing of King Macar put on top of the library by hand, hp-14 gap)
    gameLogLine(`${f.by}'s ${what}: ${f.lines.join("; ")}`);
    // (free plays the engine couldn't make: a choice cancelled, no legal target, a cost that couldn't be paid. The rest
    // of the fix stands; the table shows nothing of it by itself)
    for (const d of Array.isArray(r.dropped) ? r.dropped : []) {
      const op = f.ops?.[d.index];
      const id = d.card || op?.card;
      const name = fixCardView(pub).byId[id]?.identity?.name || game.namesSeen?.get(id) || id || "a card";
      const line = `Not played in the fix: ${name}${op?.player ? ` (${nameOf(op.player)})` : ""}: ${String(d.reason || "no reason given").replace(/^not played:\s*/i, "")}`;
      log(`fix #${f.id}: ${line}`);
      chat(`[MTG] ${line}`);
      gameLogLine(line);
    }
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
  // (a debug setup sent back is an ordinary fix from here: what gets applied is the list the table makes)
  Object.assign(f, { state: "editing", message, waiting: [], debug: null });
  chat(text);
  scheduleTable();
}
// (on the bridge's 5-second tick) an apply with no answer: the directive was lost or refused unread
// A fix from hand's free plays ask the players (targets, X, costs, trigger order) before the engine's answer comes: a
// question that came after the apply means the engine took the list. Then it waits while one is open, and counts from
// the last question or answer, not the apply (20 s fired while a player was still picking a target).
function fixWatchdog() {
  const f = game?.fix;
  if (!f || f.state !== "applying") return;
  if (f.activeAt && [...game.seats.values()].some((st) => st.prompt)) return;
  if (Date.now() - Math.max(f.appliedAt, f.activeAt || 0) < FIX_ANSWER_MS) return;
  log(`fix #${f.id}: no answer from the engine to ${f.applyId}`);
  // (a draw or a mill: the likeliest reason is an engine built before those ops, which drops the directive unread)
  const old = (f.ops || []).some((op) => LIBRARY_OPS.has(op.op)) ? " Draw and mill need the engine image built with them: an engine built before draw and mill drops the change unread." : "";
  fixBackToEditing(f, "no answer from the engine", `[MTG] The engine didn't answer the fix.${old} Back to editing: press Done to try again, or Cancel.`);
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
  if (f.state === "pausing") fixHeld(f);
  else scheduleTable();
  return true;
}
// the engine is held for the fix: into editing, or, for a debug setup, its list goes to the vote (or to the engine) at once
function fixHeld(f) {
  if (!f.debug) return fixBackToEditing(f, null, FIX_PAUSED);
  // (built now, from the board the pause stopped at: the dealt hand it moves away is the one in hand now)
  const pub = game.seats.get(f.by)?.board?.state?.gameView || f.held.seat.board?.state?.gameView;
  // (a debug tool's one change, debugTools, or a scenario's)
  const r = fixOps(f.debug.build ? f.debug.build(pub) : debugList(f.debug.scenario, f.by, pub, f.debug.midGame), pub, true);
  if (r.error) { chat(`[MTG] Debug "${f.debug.name}": ${r.error}`, f.by); return endFix(); }
  Object.assign(f, { ops: r.ops, lines: r.lines, message: null });
  chat(`[MTG] Debug "${f.debug.name}": ${r.lines.join("; ")}.`);
  if (!fixAsk(f, pub, f.by, "review", f.debug.tool ? `wants to use the debug tool "${f.debug.name}"` : `wants to set up the debug scenario "${f.debug.name}"`)) fixApply(f, pub);
  scheduleTable();
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
  if (f.held) return fixHeld(f);
  f.state = "pausing";
  chat("[MTG] Manual fix: waiting for a moment with nothing on the stack...");
}
function fixApply(f, pub) {
  f.applyId = game.fixApplies = Math.max(game.fixApplies || 0, pub.stateFix?.fixId || 0) + 1;
  f.appliedAt = Date.now();
  f.activeAt = null;
  f.state = "applying";
  f.waiting = [];
  const seat = f.held.seat;
  f.spent = f.held; // (the engine answers with a new question; until then this one may still be open)
  f.held = null;
  log(`fix #${f.id}: ${JSON.stringify(f.ops)}`);
  // (a free play is a new cast or activation of its card, as notePlay's: the card's earlier picks are not its; the
  // harness's playFree casts it with castingAbility set, so its own picks come as casting ones)
  for (const op of f.ops) if (FREE_OPS.has(op.op) && op.card) game.picked?.delete(op.card);
  seat.directive({ type: "applyState", fixId: f.applyId, ops: f.ops });
}
// why this player can't change the game now (a manual fix or a debug setup), or null
function fixRefusal(seat, pub) {
  if (!isPlaying(pub, seat.slot)) return "[MTG] Players who are out can't change the game.";
  if (pub.gameOver) return "[MTG] The game is over.";
  return null;
}
// A new fix, a manual one or a debug setup (`debug`: { name, scenario }): the others vote on the pause, else it pauses.
// why no new fix can start now (one is under way, or a rewind vote is open), or null: openFix's and runDebugTool's
function fixBusy(pub) {
  if (game.fix) return "A manual fix is already under way.";
  if (pub.restoreVote?.status?.type === "pending") return "Finish the rewind vote first.";
  return null;
}
function openFix(color, pub, debug = null) {
  const busy = fixBusy(pub);
  if (busy) return chat(`[MTG] ${busy}`, color);
  const nf = { id: (game.fixCount = (game.fixCount || 0) + 1), by: color, held: null, ...(debug ? { debug } : {}) };
  game.fix = nf;
  log(debug ? `${color} ${debug.tool ? "uses the debug tool" : "sets up the debug scenario"} ${debug.name} (#${nf.id})` : `${color} calls a manual fix (#${nf.id})`);
  const what = debug ? `asks to pause the game ${debug.tool ? "for the debug tool" : "to set up the debug scenario"} "${debug.name}"` : "asks to pause the game for a manual fix";
  if (!fixAsk(nf, pub, color, "voting", what)) fixPaused(nf);
  scheduleTable();
}
function onFix(m) {
  const color = m.color;
  const seat = game?.seats.get(color);
  const pub = seat?.board?.state?.gameView;
  if (!pub || !game.started || !game.fromTable) return chat("[MTG] Only a player in a running table game can use manual fix.", color);
  const no = fixRefusal(seat, pub);
  if (no) return chat(no, color);
  const f = game.fix;
  switch (m.action) {
    case "call":
      return openFix(color, pub);
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
    // which kind of fix, picked on the table once the game is paused: "hand" (cards stay locked, the players pick free
    // plays from their hands) or "board" (move the cards). The first pick counts, for the whole fix.
    case "kind": {
      if (!f || f.state !== "editing") return chat("[MTG] The game isn't paused for a fix.", color);
      if (m.kind !== "hand" && m.kind !== "board") return;
      if (f.kind && f.kind !== m.kind) return chat(`[MTG] ${f.kindBy} already chose: ${FIX_KINDS[f.kind]}.`, color);
      if (f.kind) return;
      Object.assign(f, { kind: m.kind, kindBy: color });
      log(`fix #${f.id}: ${color} chose ${m.kind}`);
      chat(`[MTG] ${color} chose: ${FIX_KINDS[m.kind]}.`);
      break;
    }
    case "done": {
      if (!f || f.state !== "editing") return chat("[MTG] The game isn't paused for a fix.", color);
      // (no kind said: a board fix, as before the kind was asked; "mtg mana <n>" presses Done before anyone picks)
      const kind = f.kind || (m.kind === "hand" ? "hand" : "board");
      const r = fixOps(m.ops, pub, false, kind);
      if (r.error) return chat(`[MTG] ${r.error}`, color);
      // "what should have happened", one line each: never ops; in the vote's list, the bridge log and the table log,
      // with the fix id and the seat, and in the game log once applied (fixNews)
      const notes = (Array.isArray(m.notes) ? m.notes : []).map((n) => ({ color: n?.color, text: typeof n?.text === "string" ? n.text.trim().slice(0, 200) : "" }))
        .filter((n) => n.text && game.seats.has(n.color));
      for (const n of notes) { log(`fix #${f.id} note (${n.color}): ${n.text}`); tlog(n.color, `fix #${f.id} note: ${n.text}`); }
      r.lines.push(...notes.map((n) => `Note (${n.color}): ${n.text}`));
      // (the kind is kept only when someone said it: a refused list goes back to editing as it was)
      if (!f.kind && (m.kind === "hand" || m.kind === "board")) f.kind = m.kind;
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
// ───────── debug scenarios ("mtg debug <name>", scenarios/<name>.json) ─────────
// A test board set up through the manual fix: lands on the battlefield (20 basics in the commander's colours unless the
// file names them), the named cards in hand (the dealt hand goes to the bottom of the library unless keepHand), and
// cards in any other zone, for the caller ("you") and the opponents ("opponents", or one colour: "Red"). Typed before
// a game, it waits for the caller's first priority on their own turn (the opening hand is kept by itself); during one, it goes at the
// next moment with nothing on the stack. Other players vote as for any fix.
const SCENARIO_DIR = process.env.MTG_SCENARIO_DIR || home.data("scenarios"); // (MTG_SCENARIO_DIR: tests)
const debugChoice = {}; // colour -> { name, scenario }: set up at that player's first priority in the next game
const DEBUG_ZONES = ["battlefield", "hand", "library", "graveyard", "exile"];
const BASIC_OF = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };
function listScenarios() {
  try { return fs.readdirSync(SCENARIO_DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort(); } catch { return []; }
}
function loadScenario(name) {
  const names = listScenarios();
  if (!/^[\w-]{1,60}$/.test(name) || !names.includes(name)) return { error: `No debug scenario "${name}". Scenarios: ${names.join(", ") || "none"}.` };
  let scenario;
  try { scenario = JSON.parse(fs.readFileSync(path.join(SCENARIO_DIR, `${name}.json`), "utf8")); }
  catch (e) { return { error: `Scenario "${name}" can't be read: ${e.message}` }; }
  const bad = scenarioProblem(scenario);
  return bad ? { error: `Scenario "${name}": ${bad}` } : { scenario };
}
// what's wrong with a scenario's shape, or null: a wrong one is refused when typed, not half set up later
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function scenarioProblem(scenario) {
  if (!isPlain(scenario)) return "it must be one { ... } object.";
  const sides = [["you", scenario.you || scenario], ...Object.entries(scenario).filter(([k]) => k === "opponents" || TABLE_COLORS.includes(k))];
  for (const [who, side] of sides) {
    if (!isPlain(side)) return `"${who}" must be a { ... } object.`;
    const lands = side.lands;
    if (lands !== undefined && !Number.isInteger(lands) && !Array.isArray(lands) && !isPlain(lands)) return `${who === "you" ? "" : `${who}: `}"lands" must be a number, a list of names, or counts by name.`;
    for (const k of [...DEBUG_ZONES, "tokens", "completedDungeons"]) if (side[k] !== undefined && !Array.isArray(side[k])) return `${who === "you" ? "" : `${who}: `}"${k}" must be a list.`;
    if (side.dungeon !== undefined && !(isPlain(side.dungeon) && typeof side.dungeon.name === "string" && (side.dungeon.room == null || typeof side.dungeon.room === "string"))) return `${who === "you" ? "" : `${who}: `}"dungeon" must be { "name": ..., "room": ... }.`;
  }
  if (scenario.initiative !== undefined && scenario.initiative !== "you" && !TABLE_COLORS.includes(scenario.initiative)) return '"initiative" must be "you" or a colour.';
  if (scenario.planeswalk !== undefined && !(typeof scenario.planeswalk === "string" && scenario.planeswalk.trim())) return '"planeswalk" must be the name of a plane.';
  return null;
}
// one player's part of a scenario as manual-fix changes (the table's form: players by colour). midGame: typed during a
// game, where the caller's hand stays and no lands come unless the file says so (the 20 lands and the hand to the
// bottom are for a game's start: a mid-game "mtg debug" without keepHand bottomed the hand, live check 2026-11-11)
function debugSide(side, color, pub, you, midGame = false) {
  const out = [];
  if (!side || typeof side !== "object") return out;
  const slot = slotOfColor(color);
  let lands = side.lands ?? (you && !midGame ? 20 : 0);
  if (Number.isInteger(lands)) {
    // (the commander's colours; with none, colourless: Wastes)
    const command = (pub.zones || []).find((z) => z.zone === "command" && z.ownerId === slot)?.cards || [];
    const colours = [...new Set(command.flatMap((c) => [...String(c.color || "")]).filter((ch) => BASIC_OF[ch]))];
    const kinds = colours.length ? colours.map((ch) => BASIC_OF[ch]) : ["Wastes"];
    lands = Array.from({ length: Math.max(0, Math.min(lands, 60)) }, (_, k) => kinds[k % kinds.length]);
  } else if (lands && typeof lands === "object" && !Array.isArray(lands)) {
    // ({ "Mountain": 10, "Island": 10 }: so many of each)
    lands = Object.entries(lands).flatMap(([name, k]) => Array(Math.max(0, Math.min(Number(k) || 0, 60))).fill(name));
  }
  for (const name of Array.isArray(lands) ? lands : []) out.push({ op: "createCard", name, player: color, zone: "battlefield" });
  if (you && !(side.keepHand ?? midGame)) {
    const hand = (pub.zones || []).find((z) => z.zone === "hand" && z.ownerId === slot)?.cards || [];
    for (const c of hand) if (c.id) out.push({ op: "move", card: c.id, zone: "library", position: "bottom", shown: `${poss(nameOf(slot))} dealt hand: to the bottom of the library` });
  }
  for (const zone of DEBUG_ZONES) {
    for (const e of Array.isArray(side[zone]) ? side[zone] : []) {
      const name = typeof e === "string" ? e : e?.name;
      out.push({ op: "createCard", name, player: color, zone, ...(e?.tapped ? { tapped: true } : {}) });
    }
  }
  // tokens as "mtg fix token" takes them ("treasure", "2/2 red goblin shaman"), ready to attack like every card here
  for (const e of Array.isArray(side.tokens) ? side.tokens : []) {
    const text = typeof e === "string" ? e : e?.name;
    out.push({ op: "createCard", name: tokenScript(text) || text, player: color, zone: "battlefield", ...(e?.tapped ? { tapped: true } : {}),
      shown: getsToken(nameOf(slot), text, e?.tapped) });
  }
  if (Number.isInteger(side.life)) out.push({ op: "life", player: color, n: side.life });
  if (Number.isInteger(side.mana) && side.mana > 0) {
    const k = Math.min(side.mana, 99);
    out.push({ op: "mana", player: color, mana: ["W", "U", "B", "R", "G", "C"].flatMap((m) => Array(k).fill(m)).join(" ") });
  }
  // (a dungeon with its room, or none yet: the next venture goes to its first room; dungeons already completed)
  if (isPlain(side.dungeon) && side.dungeon.name) out.push({ op: "dungeon", player: color, name: side.dungeon.name, ...(side.dungeon.room ? { room: side.dungeon.room } : {}) });
  for (const name of Array.isArray(side.completedDungeons) ? side.completedDungeons : []) out.push({ op: "completedDungeon", player: color, name });
  return out;
}
function debugList(scenario, color, pub, midGame = false) {
  const list = debugSide(scenario.you || scenario, color, pub, true, midGame);
  for (const other of Object.values(game.slotColor)) {
    if (other === color || !isPlaying(pub, slotOfColor(other))) continue;
    list.push(...debugSide(scenario[other] || scenario.opponents, other, pub, false));
  }
  // (who has the initiative: "you" or a colour at the table)
  const takes = scenario.initiative === "you" ? color : scenario.initiative;
  if (takes && Object.values(game.slotColor).includes(takes) && isPlaying(pub, slotOfColor(takes))) list.push({ op: "initiative", player: takes });
  // (Planechase, the caller's: to a plane from a planar deck, by its name as Forge spells it; chaos on the plane in play)
  if (typeof scenario.planeswalk === "string") list.push({ op: "planeswalk", player: color, name: planeNamed(scenario.planeswalk)?.name || scenario.planeswalk.trim() });
  if (scenario.chaos === true) list.push({ op: "chaos", player: color });
  return list;
}
function onDebug(m) {
  const color = m.color;
  const name = String(m.scenario || "").trim();
  if (name === "" || name === "list") return chat(`[MTG] Debug scenarios: ${listScenarios().join(", ") || "none"}. Use  mtg debug <name>  (mtg debug off).`, color);
  if (name === "off") { delete debugChoice[color]; return chat("[MTG] Debug setup off.", color); }
  const r = loadScenario(name);
  if (r.error) return chat(`[MTG] ${r.error}`, color);
  const seat = game?.seats.get(color);
  const pub = seat?.board?.state?.gameView;
  if (!pub || !game.started || !game.fromTable) {
    debugChoice[color] = { name, scenario: r.scenario };
    return chat(`[MTG] Debug "${name}" is set up at your first priority on your own turn in the next game (your opening hand is kept). Start the game.`, color);
  }
  const no = fixRefusal(seat, pub);
  if (no) return chat(no, color);
  openFix(color, pub, { name, scenario: r.scenario, midGame: true });
}
// (onPrompt) a debug game: the opening hand is kept, and the first priority on the caller's own turn with nothing on the
// stack starts the setup (the board is there for their first turn, whoever went first; it applied on the AI's turn 1 and
// left the sorceries waiting, first live run 2026-11-04)
function debugPrompt(seat, type, prompt, gv) {
  const d = debugChoice[seat.color];
  if (!d || !game?.fromTable) return false;
  if (type === "mulligan") { seat.respond(prompt.promptId, "mulligan", { type: "mulliganDecision", keep: true }); return true; }
  if (type === "chooseAction" && !game.fix && gv.activePlayerId === seat.slot && !(gv.stack || []).length) { delete debugChoice[seat.color]; openFix(seat.color, gv, d); }
  return false;
}

// ───────── debug tools (docs/next-features-2026-11-09.md items 18 + 21; the companion page, POST /tools) ─────────
// One change to one player, as a debug setup of its own: the manual fix's pause, vote and applyState, with the change
// built from the board the pause stopped at (f.debug.build). Only while the host has switched debug tools on (the
// companion page; off at every bridge start), said to the whole table both ways. The change is made in the name of the
// player it is for when a person sits there (the others vote, as for "mtg debug"), else of the first person's seat.
// Draw and mill are the engine's own (the draw/mill ops, LIBRARY_OPS): the board shows no library card for a fix op to
// move, and Forge drawing or milling itself counts the draw, fires the triggers and logs the move as in play.
let debugTools = false;
// a player's library count, as the board shows it (the cards stay hidden), or null
const libraryCount = (pub, color) => (pub.zones || []).find((z) => z.zone === "library" && z.ownerId === slotOfColor(color))?.count ?? null;
const cardCountProblem = (n) => (Number.isInteger(n) && n >= 1 && n <= 99 ? null : "say 1 to 99 cards");
const DEBUG_TOOLS = {
  // { (color, n, name, mana, pub) -> what it says, (n, name, mana) -> a check's refusal or null, (color, pub, n, name,
  // mana) -> the fix list, optionally (color, pub) -> a refusal from the board or null }
  mana: { words: (c, n, name, mana) => `add ${n} ${mana} mana to ${c}'s pool`,
    check: (n, name, mana) => (!/^[WUBRGC]$/.test(mana || "") ? "pick a mana colour: W, U, B, R, G or C" : !(Number.isInteger(n) && n >= 1 && n <= 99) ? "say 1 to 99 mana" : null),
    build: (c, pub, n, name, mana) => [{ op: "mana", player: c, mana: Array(n).fill(mana).join(" ") }] },
  hand: { words: (c, n, name) => `put ${name} into ${c}'s hand`, check: (n, name) => cardNameProblem(name),
    build: (c, pub, n, name) => [{ op: "createCard", name: forgeIndex()[normName(name)], player: c, zone: "hand" }] },
  battlefield: { words: (c, n, name) => `put ${name} onto ${c}'s battlefield`, check: (n, name) => (tokenScript(name) && !forgeIndex()[normName(name)] ? null : cardNameProblem(name)),
    build: (c, pub, n, name) => [{ op: "createCard", name: forgeIndex()[normName(name)] || tokenScript(name), player: c, zone: "battlefield" }] },
  life: { words: (c, n) => `set ${c}'s life to ${n}`, check: (n) => (Number.isInteger(n) && n >= 0 && n <= 999 ? null : "say a life total from 0 to 999"),
    build: (c, pub, n) => [{ op: "life", player: c, n }] },
  untap: { words: (c) => `untap everything ${c} controls`, check: () => null,
    build: (c, pub) => (pub.zones || []).filter((z) => z.zone === "battlefield").flatMap((z) => z.cards || [])
      .filter((x) => x.tapped && (x.controllerId ?? x.ownerId) === slotOfColor(c)).map((x) => ({ op: "tap", card: x.id, tapped: false })),
    refuse: (c, pub) => (DEBUG_TOOLS.untap.build(c, pub).length ? null : `${c} has nothing tapped.`) },
  // (past the library's end is allowed, as running out is a thing to test, and said)
  draw: { words: (c, n, name, mana, pub) => { const k = libraryCount(pub, c); return `make ${c} draw ${nCards(n)}${k != null && n > k ? ` (${k} in the library: drawing from an empty library loses the game)` : ""}`; },
    check: cardCountProblem, build: (c, pub, n) => [{ op: "draw", player: c, n }] },
  mill: { words: (c, n, name, mana, pub) => { const k = libraryCount(pub, c); return `mill ${nCards(n)} from ${c}'s library${k != null && n > k ? ` (${k} in it)` : ""}`; },
    check: cardCountProblem, build: (c, pub, n) => [{ op: "mill", player: c, n }],
    refuse: (c, pub) => (libraryCount(pub, c) === 0 ? `${c}'s library is empty: there is nothing to mill.` : null) },
};
function cardNameProblem(name) {
  const n = String(name || "").trim();
  if (!n) return "name a card";
  return forgeIndex()[normName(n)] ? null : `the engine has no card called "${n.slice(0, 60)}"`;
}
// The running table game, with its board, or { error }: what a debug tool can change (debugToolGame) and what the
// page is told it can (toolsState), one test for both
function runningTableGame() {
  const pub = leadSeat()?.board?.state?.gameView;
  if (!game?.started || !game.fromTable || !pub) return { error: "No table game is running." };
  if (pub.gameOver || game.over) return { error: "The game is over." };
  return { pub };
}
function debugToolGame() {
  return debugTools ? runningTableGame() : { error: "Debug tools are off: switch them on first." };
}
// m: { tool, color, n, name, mana } -> { ok, message }
function runDebugTool(m) {
  const t = Object.hasOwn(DEBUG_TOOLS, m?.tool) ? DEBUG_TOOLS[m.tool] : null;
  if (!t) return { ok: false, message: `No debug tool "${String(m?.tool || "").slice(0, 20)}".` };
  const g = debugToolGame();
  if (g.error) return { ok: false, message: g.error };
  const color = TABLE_COLORS.find((c) => c === m.color);
  const slot = color && slotOfColor(color);
  if (!slot) return { ok: false, message: `${String(m.color || "That colour").slice(0, 20)} isn't in this game.` };
  if (!isPlaying(g.pub, slot)) return { ok: false, message: `${color} is out of the game.` };
  const busy = fixBusy(g.pub);
  if (busy) return { ok: false, message: busy };
  const n = m.n == null || m.n === "" ? null : Number(m.n);
  const name = String(m.name || "").trim(), mana = String(m.mana || "").trim().toUpperCase();
  const bad = t.check(n, name, mana);
  if (bad) return { ok: false, message: `${bad[0].toUpperCase()}${bad.slice(1)}.` };
  const no = t.refuse?.(color, g.pub);
  if (no) return { ok: false, message: no };
  const by = game.seats.has(color) ? color : [...game.seats.values()].find((s) => isPlaying(g.pub, s.slot))?.color;
  if (!by) return { ok: false, message: "Nobody at the table is still in the game." };
  const words = t.words(color, n, name, mana, g.pub);
  openFix(by, g.pub, { name: words, tool: true, build: (pub) => t.build(color, pub, n, name, mana) });
  return { ok: true, message: `Debug tool: ${words}.` };
}
function setDebugTools(on) {
  if (debugTools === !!on) return { ok: true, message: `Debug tools are already ${on ? "on" : "off"}.` };
  debugTools = !!on;
  chat(debugTools ? "[MTG] The host switched debug tools on (companion page): changes to the game come as debug setups, voted on as a manual fix." : "[MTG] The host switched debug tools off.");
  // (off means off: a debug tool still waiting for its pause or its votes goes too; one the engine is applying is past
  // stopping, as a manual fix's Cancel is then)
  const f = game?.fix;
  if (!debugTools && f?.debug?.tool && f.state !== "applying") {
    log(`fix #${f.id}: debug tool cancelled, debug tools switched off`);
    chat(`[MTG] Debug tool "${f.debug.name}" cancelled: debug tools are off.`);
    endFix();
  }
  return { ok: true, message: `Debug tools ${debugTools ? "on" : "off"}.` };
}

// ───────── the companion page's table tools (GET/POST /tools on the debug port; companion/WebUi.cs /api/tools) ─────────
function toolsState() {
  const pub = leadSeat()?.board?.state?.gameView;
  const inGame = game?.started ? Object.values(game.slotColor || {}).filter(Boolean) : [];
  return {
    seats: TABLE_COLORS.map((c) => {
      const a = aiSeatChoice[c];
      return { color: c, person: !!game?.seats?.has(c), inGame: inGame.includes(c),
        ai: a ? { kind: a.kind, kindLabel: AI_KINDS[a.kind], deckName: a.deck.deckName, source: a.source } : null };
    }),
    presets: listCommanderPresets(),
    debug: { on: debugTools, game: !runningTableGame().error, fix: !!game?.fix,
      players: game?.started ? Object.keys(game.slotColor).filter((s) => game.slotColor[s] && isPlaying(pub, s)).map((s) => ({ color: game.slotColor[s], name: nameOf(s) })) : [] },
    tools: Object.keys(DEBUG_TOOLS),
  };
}
// a POST /tools body (already JSON) -> { ok, message }; a success is also said to the table
function onToolsPost(m) {
  if (!isPlain(m)) return { ok: false, message: "Send one { ... } object." };
  let r;
  if (m.kind === "ai-seat") r = setAiSeat(m.color, m.seat, { preset: m.preset || null, list: m.list || null, name: m.name || null });
  else if (m.kind === "debug-mode") return setDebugTools(m.on === true);
  else if (m.kind === "debug") r = runDebugTool(m);
  else return { ok: false, message: `Unknown kind "${String(m.kind || "").slice(0, 20)}".` };
  if (r.ok && m.kind === "ai-seat") chat(`[MTG] AI seat (companion page): ${r.message}`);
  return r;
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

// Friendly mulligans. The engine takes the count off what a kept hand owes (the Keep answer's freeCards); these say so
// at the table. game.friendly is the free mulligans in all: with 3 or more players the rules' free one (Forge gives it
// by itself) is one of them, so the engine is asked only for the rest (friendlyExtra) and a count of 1 is the rules.
const rulesFreeMulligans = () => (game.total > 2 ? 1 : 0);
const friendlyExtra = () => (game?.friendly ? Math.max(0, game.friendly - rulesFreeMulligans()) : 0);
const friendlySay = (line) => { chat(`[MTG] ${line}`); gameLogLine(line); };
function friendlyFreeLeft(seat) {
  return game?.friendly ? Math.max(0, Math.max(game.friendly, rulesFreeMulligans()) - seat.mullsTaken) : 0;
}
function friendlyText(seat) {
  const left = friendlyFreeLeft(seat);
  if (left) return `Free mulligans left: ${left}.`;
  const owed = Math.max(0, seat.mullsTaken - Math.max(game.friendly, rulesFreeMulligans()));
  return owed ? `Keeping puts ${owed} on the bottom.` : "No free mulligans left: the next one costs a card.";
}
function mulliganTaken(seat) {
  seat.mullsTaken++;
  if (!game?.friendly) return;
  saveResume(); // (a bridge restart between mulligans keeps the count)
  const nth = seat.mullsTaken, all = Math.max(game.friendly, rulesFreeMulligans());
  if (nth > all) return; // one that costs a card
  friendlySay(`${seat.color} took a free mulligan (${nth} of ${all}).`);
  if (nth === all) friendlySay(`That was ${seat.color}'s last free mulligan: their next one costs a card.`);
}
function friendlyEnded(gv) {
  if (!game.friendly || game.friendlyOver || !(gv.turn >= 1)) return;
  game.friendlyOver = true;
  friendlySay("Friendly mulligans are over: normal rules from here.");
}

// After a restore the engine is back at an earlier point and asks its questions again. A question that was open
// before it must not be answered any more: an answer reaching the engine's new question crashed Forge in a test
// (rules-check --game rewind: "unsupported action kind: choose_action" while it waited for a target).
function checkRestored(seat) {
  const gv = seat.board?.state?.gameView;
  if (!gv || !game) return;
  friendlyEnded(gv);
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
  seat.clearFollowUps();
  game.pendingPlays = (game.pendingPlays || []).filter((e) => e.ctl !== seat.slot);
  if (seat === leadSeat()) {
    chat(`[MTG] Rewound to turn ${gv.turn} (${rewindStep(gv.step)}).`);
    game.sentZones = {}; // the next board update sends every zone in full
    game.fxJump = true; // (and says it is a jump: the table plays no death / damage effects for what the rewind undid)
    game.lastTableSig = null; // (and goes out even if it matches the last one sent)
    // the log says the rewind, and the board it went back to is its new start: the difference was told as plays
    // ("Dauthi Voidwalker returns to the battlefield", "Command Tower leaves the battlefield", hp-07 #36 2026-10-27)
    game.logPrev = null;
    // (and what the players' answers said for the log: a source chosen, a "Pay {1}?", a target pick, a pain land's
    // tap, the blocks, all from the turns undone; a shield chosen before the rewind named a replayed turn's damage
    // "prevented", review 2026-11-09. A player the rewind brought back is in the game again: how they went out is undone.)
    game.picked?.clear(); game.answers?.clear(); game.sourceShields = []; game.painTaps = []; game.declaredBlocks = null; game.owedCombat = null; game.lifePays = []; game.chosenSources = []; game.orderAnswer = null;
    for (const p of gv.players || []) if (!p.status || p.status === "playing") { delete game.outOrder?.[p.id]; delete game.outWhere?.[p.id]; }
    // (the turn as the log's headers count it, each player's own: "White's turn 4", suite review 2026-10-27)
    // (whose turn and which step: Forge's turn number counts every player's turns, unlike the log's headers, and the
    // per-player count isn't wound back, suite review 2026-10-27)
    gameLogLine(`--- Rewound to ${nameOf(gv.activePlayerId)}'s turn (${rewindStep(gv.step)}) ---`);
  }
}

// ───────────────────────── Debug channel (localhost; always on) ────────────────────────
// Refuses browser requests (they carry an Origin header) and foreign Host headers (DNS rebinding): see debugServer.─
// TTS sends prints (2), errors (3) and Lua return values (5) to this port as well. They go to tts-console.log.
// POST Lua to http://127.0.0.1:48787/exec and it runs in the loaded game's Global; the reply carries
// the return value plus any prints/errors that arrived meanwhile.
const http = require("http");
const DEBUG_PORT = Number(arg("debug-port", 48787));
const CONSOLE_LOG = home.beside("tts-console.log");
const consoleLines = [];
let consoleTotal = 0; // lines ever added (consoleLines keeps the last 500)
let execSeq = BRIDGE_EXEC_BASE; // (Execute Lua answers from here up are the bridge's; lower ones the editor plugin's)
const execWaiters = new Map();

function onTTSDebug(msg) {
  ttsSaw(true);
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
  // (decoded as text by Node: a character split across two chunks is held until its other bytes arrive; `body += d` on
  // raw Buffers turned an accented card name split at a chunk edge into two replacement marks, tmp/msg-size/live.md)
  req.setEncoding("utf8");
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
  } else if (req.url === "/tools" && req.method === "GET") {
    // the companion page's table tools: AI seats and debug tools (toolsState); POST changes one (onToolsPost)
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(toolsState()));
  } else if (req.url === "/tools" && req.method === "POST") {
    readBody(req, res, (body) => {
      let r;
      try { r = onToolsPost(JSON.parse(body)); } catch (e) { r = { ok: false, message: e instanceof SyntaxError ? "The body isn't JSON." : `Failed: ${e.message}` }; log(`POST /tools: ${e.message}`); }
      res.writeHead(200, { "Content-Type": "application/json" }); // (a refusal too: its message is the answer, r.ok false)
      res.end(JSON.stringify(r));
    });
  } else if (req.url === "/stats") {
    res.end(JSON.stringify(ttsStats));
  } else if (req.url === "/health") {
    // cheap enough to poll every few seconds (no docker, no TTS round trip): the companion app's game lock and lights
    const phase = !game ? "none" : game.over ? "over" : game.started ? "running" : "setup";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ phase, started: !!game?.started && !game.over, seats: !!game?.seats?.size, bridge: BRIDGE_HASH,
      table: { stamp: tableStamp ?? null, lastHeardMs: ttsLink.tableAt ? Date.now() - ttsLink.tableAt : null }, ttsConnected: ttsLink.up }));
  } else if (req.url === "/versions") {
    // is what's running what the last deploy put together, and what the table's check and the log's guesses found
    versionsNow((now) => {
      const deployed = versions.readManifest();
      res.writeHead(200, { "Content-Type": "application/json" });
      // tableHeardMs: how long ago the table last spoke (null: not since the bridge started). now.table is the stamp the
      // table said then, which outlives that TTS: the companion's light was green while a relaunched TTS sat on its main
      // menu (live check 2026-11-11), so it compares this with how long TTS has been running
      res.end(JSON.stringify({ now, deployed, outOfStep: versions.outOfStep(now, deployed), waiting: versions.waiting(deployed), alignment,
        tableHeardMs: ttsLink.tableAt ? Date.now() - ttsLink.tableAt : null }, null, 1));
    });
  } else if (req.url === "/state") {
    const seats = game ? [...game.seats.values()].map((st) => {
      const gv = st.board?.state?.gameView;
      const bf = (gv?.zones || []).filter((z) => z.zone === "battlefield").map((z) => ({ owner: z.ownerId, cards: z.cards.map((c) => `${c.identity?.name}${c.tapped ? "(T)" : ""}`) }));
      return { color: st.color, slot: st.slot, turn: gv?.turn, step: gv?.step, battlefield: bf, manaPool: gv?.players?.find((p) => p.id === st.slot)?.manaPool, rawPrompt: st.lastRawPrompt };
    }) : null;
    res.writeHead(200, { "Content-Type": "application/json" });
    // (players: everyone in the game, ai: the AI seats among them, for the companion's banner: "seats" is only the people)
    res.end(JSON.stringify({ started: !!game?.started && !game.over, seats, players: game ? game.total ?? null : null, ai: game ? game.bots ?? null : null }, null, 1));
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
  editorForward.start();
  process.on("SIGINT", () => { if (game) { game.closing = true; for (const s of allSeats()) s.close(); } setTimeout(() => process.exit(0), 200); });
  resumeGame();
  setInterval(() => { guarded("save game", saveResume); guarded("fix watchdog", fixWatchdog); }, 5000);
} else {
  // Loaded by a test (tests/bridge-harness.js): the logic without servers. `game` is set through _setGame.
  module.exports = {
    alignment, tableCard, costNow, versionsNow, warnOutOfStep, Seat, onTTS, onTTSDebug, onPrompt, onRoomUpdate, onGameStarted, toTTS, fixWatchdog, debugServer, answerProblem, onIntent, onAnswer, whyNot, refuse, cardLabel, imgOf, displayText, shortUrl, ttsImage, payManaText, manaRank, otherwiseText, distinctLabels, saveResume, resumeGame,
    summarizeLands, orderSteps, costLeft, countWords, targetTitle, yesNoWords, arenaWords, scryPlaceSteps, damageSteps, prepareUi, sendTable, logSnapshot, logEvents, engineFacts, updateLog, gameLogLine, cardIndex, nameOf, notePlay, hasKeyword,
    _setGame: (g) => { game = g; }, _getGame: () => game, _outbox: outbox, _readyDecks: readyDecks, _timerExpired: timerExpired, _timeoutChoice: timeoutChoice, _stopTimer: stopTimer, _friendlyCount: friendlyCount,
    _readBody: readBody, _execInTTS: execInTTS, _editorForward: editorForward, _ttsServer: server,
    parseDeckList, aiSeatDeck, setAiSeat, onAiSeatChat, harmlessAnswer, HarmlessSeat, clockwiseOrder, gamePictures, startGame, runDebugTool, setDebugTools, toolsState, onToolsPost,
    _aiSeatChoice: aiSeatChoice, _startResolving: startResolving, _customArt: customArt, artProblem, isCustomArt,
  };
}
