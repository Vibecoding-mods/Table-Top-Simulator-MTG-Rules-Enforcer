const fs = require("fs"), path = require("path");
// Builds the bridge function map page: node tools/bridge-map/build.js (writes tmp/bridge-map.html). Every function
// needs a line in descriptions.js; the build stops and names any that are missing.
const S = __dirname, ROOT = path.join(__dirname, "../..");
require("child_process").execFileSync("node", [path.join(S, "extract.js"), path.join(ROOT, "bridge/bridge.js"), path.join(ROOT, "tmp/bridge-functions.json")]);
const defs = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp/bridge-functions.json"), "utf8"));
const desc = require("./descriptions.js");
const src = fs.readFileSync(path.join(ROOT, "bridge/bridge.js"), "utf8").split(/\r?\n/);
const AREAS = [
  [1, "start", "Start-up and helpers", "Settings, the console log, and the crash guard every callback runs under."],
  [36, "tts", "Talking to TTS", "The one queue every message to the table goes through."],
  [89, "tlog", "Table log and version checks", "tmp/table-log.log, the table's self-check, the guess log, and version drift warnings."],
  [208, "decks", "Decks", "Preset decks and decks imported on the table with \"mtg ready\"."],
  [325, "seat", "Seat: one relay connection per player", "Each human seat logs in to the Manabrew relay on its own WebSocket and carries that player's game traffic."],
  [597, "game", "Starting, saving and resuming a game", "Room set-up, turn order, colours, and rejoining after a bridge restart."],
  [779, "images", "Card pictures and tokens", "Scryfall lookups, the picture cache, token art."],
  [981, "table", "What each card shows on the table", "The per-card model: picture, P/T, status box, hover notes, what can be played from where."],
  [1193, "log", "Game log", "Two boards in, log lines out. Forge's move feed decides when it can; the boards are the fallback."],
  [2050, "send", "Sending the table", "The whole-table update, kept small by sending each card's fixed details once."],
  [2181, "view", "Text board and names", "The plain text board, card labels, player names and marks."],
  [2302, "words", "Question wording", "Forge's questions rewritten in plain, Arena-style words."],
  [2814, "view2", "Text board and names", ""],
  [2863, "prompt", "Questions to buttons", "Every engine question becomes table buttons. onPrompt alone is about a quarter of the file."],
  [4519, "timer", "Turn timers", "The host's optional timers and time banks."],
  [4577, "gesture", "Table gestures and answers", "Drags and clicks on the table, and button answers, turned into engine answers."],
  [4905, "cmd", "Commands from TTS", "The table's messages, by kind, and helpers the rest share."],
  [5069, "rewind", "Rewind by vote", "Asking, voting and going back to an earlier point."],
  [5137, "fix", "Manual fix by vote", "Hand-editing the board with everyone's agreement, then handing it back to the engine."],
  [5412, "concede", "Conceding and the winner", "Treachery's winner and plain concessions."],
  [5493, "debug", "Debug channel", "The localhost HTTP server: /state, /exec, /log, /card, /versions."],
];
const areaOf = (line) => { let a = AREAS[0]; for (const x of AREAS) if (line >= x[0]) a = x; return a[1] === "view2" ? "view" : a[1]; };
const fix = { checkRestored: "rewind", isCounterspell: "log", gameLogLine: "log", sayPutOnTop: "log", tlogCard: "tlog", tlogIn: "tlog", shortUrl: "send", slimmer: "send", flushTexts: "send", sendTable: "send", resetGame: "game", scheduleView: "send" };
const missing = defs.filter((d) => !desc[d.name]).map((d) => d.name);
if (missing.length) { console.error("no description:", missing.join(", ")); process.exit(1); }
const fns = defs.map((d) => ({ n: d.name, s: d.short, l: d.line, z: d.size, k: d.kind, a: fix[d.name] || areaOf(d.line), d: desc[d.name], c: d.calls, b: d.callers }));
const TABLES = ["LIBRARY_WORDS", "EXILE_WORDS", "HAND_WORDS", "LEAVE_WORDS", "COST_KEYWORDS", "KEYWORD_WORDS", "OPTIONAL_COST_WORDS", "CHOICE_WORDS", "COUNTER_WORDS", "LOSS_REASONS", "FORGE_STEPS", "KEYWORD_TARGETS", "KEYWORD_YESNO", "PROMPT_KIND", "RESOURCE_WORDS", "FIX_OPS", "FIX_CHECK"];
const tableInfo = {
  LIBRARY_WORDS: "How each kind of move out of a library is said (mill, dredge, surveil, explore, put). New 2026-11-03.",
  EXILE_WORDS: "How each kind of exile is said (from a graveyard, the battlefield or a library; haunt, suspend, adventure, rebound, plot, paradigm). New 2026-11-03.",
  HAND_WORDS: "How draws, cards put into a hand, and discards are said. New 2026-11-03.",
  LEAVE_WORDS: "How a card leaving the battlefield (dies, destroyed, sacrificed, bounced, tucked, tokens gone) or a graveyard for a hand is said. New 2026-11-03.",
  COST_KEYWORDS: "The cost keywords a move's label names (cycling, delve, escape, emerge, embalm, eternalize, encore, scavenge, transmute, reinforce). New 2026-11-03.",
  OPTIONAL_COST_WORDS: "Forge's optional costs a cast is said with: kicked, entwined, bargained, gift promised. New 2026-11-04.",
  KEYWORD_WORDS: "Each activated keyword and its log line (unearths, encores, transmutes...); keywordKind reads by the same list. New 2026-11-03.",
  CHOICE_WORDS: "Chosen colour, type, name, player, in words.",
  COUNTER_WORDS: "Counter names in words.",
  LOSS_REASONS: "Why a player lost.",
  FORGE_STEPS: "Forge's step-by-step choice texts, rewritten.",
  KEYWORD_TARGETS: "Target questions asked by a keyword.",
  KEYWORD_YESNO: "Yes/no questions asked by a keyword (kicker, buyback...).",
  PROMPT_KIND: "Which table widget each engine question type uses.",
  RESOURCE_WORDS: "Payment buttons for delve, convoke, improvise, waterbend.",
  FIX_OPS: "The changes a manual fix may make.",
  FIX_CHECK: "What a manual fix change is checked for.",
};
const tables = TABLES.map((t) => ({ n: t, l: src.findIndex((x) => x.startsWith(`const ${t} = `)) + 1, d: tableInfo[t] })).filter((t) => t.l > 0);
const areas = AREAS.filter((a) => a[1] !== "view2").map(([l, id, title, blurb]) => ({ id, title, blurb }));
const data = { fns, tables, areas, lines: src.length - (src[src.length - 1] === "" ? 1 : 0), built: "2026-11-03" };
const tpl = fs.readFileSync(path.join(S, "page.html"), "utf8");
fs.writeFileSync(path.join(ROOT, "tmp/bridge-map.html"), tpl.replace("/*DATA*/null", JSON.stringify(data)));
console.log(`${fns.length} functions, ${tables.length} tables, ${(fs.statSync(path.join(ROOT, "tmp/bridge-map.html")).size / 1024).toFixed(0)} KB`);
