// The six-seat table stream (docs/m6-six-seat-spec.md step 14): a headless six-seat game (tools/headless-six.js
// --record) played through the bridge as the six-seat table's game, and what the bridge sends the table written as a
// stream fixture in the shape of tests/golden/fixtures/table-stream-4p.json ([{ at, t, json }]).
// The bridge runs sandboxed (tests/bridge-harness.js: no relay, no TTS, fake clock): the table says hello with its six
// seats, White starts with 5 AI players, the relay's lobby and GameStarted come as the relay sends them, then each
// recorded state and question goes to White's seat as the relay's envelopes. Said in the output: the seat order, the
// colours, any error the bridge logged.
// The relay's side is kept packed (pack / unpack): the first state, then each state as its changes from the one before
// ({ $o: keys changed, $k: the keys' order when it changed } for an object, { $a: indexes changed } for a list of the same length, { $v: the new value },
// { $del: 1 }), so turns 1 to 15 of a six-seat game take about half a megabyte instead of four.
//   node tools/m6-stream.js <recording.json> [--turns 15] [--out tests/golden/fixtures/table-stream-6p.json]
//     [--relay tests/golden/fixtures/six-seat-relay.json]   (the input, packed, for tests/test_bridge_six_golden.js)
//     [--archenemy]   (the table starts an Archenemy game, ARCH_START: a recording of headless-six.js --archenemy)
const fs = require("fs");
const path = require("path");
const harness = require("../tests/bridge-harness");

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const REC = process.argv[2];
const TURNS = Number(arg("turns", 15));
const RELAY = arg("relay", path.join(__dirname, "..", "tests", "golden", "fixtures", "six-seat-relay.json"));
const OUT = arg("out", path.join(__dirname, "..", "tests", "golden", "fixtures", "table-stream-6p.json"));
// the Archenemy game's start from the table (as tools/headless-six.js --archenemy plays it): Purple the archenemy with
// the first 20 schemes of bridge/forge-schemes.json
const ARCH_START = (() => { const j = require(path.join(__dirname, "..", "bridge", "forge-schemes.json")); return { teamMode: "archenemy", archenemy: { color: "Purple", schemes: [...j.schemes, ...(j.ongoing || [])].slice(0, 20) } }; })();
const SIX = ["White", "Red", "Yellow", "Green", "Blue", "Purple"];
const KEEP = new Set(["started", "table", "prompt", "gamelog", "texts", "chat", "clear"]);

// extra: more of the table's start message (an Archenemy game: { teamMode: "archenemy", archenemy: { color, schemes } })
async function stream(rec, turns, extra = {}) {
  const h = harness.load();
  const frame = (ws, m) => ws.emit("message", JSON.stringify(m));
  h.B.onTTS({ t: "hello", json: JSON.stringify({ tableSeats: SIX }) });
  h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["White"], bots: 5, fromTable: true, ...extra }) });
  await h.flush();
  const g = h.B._getGame();
  if (!g) throw new Error(`the bridge didn't start a game: ${JSON.stringify(h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text))}`);
  const white = g.seats.get("White");
  white.heartbeat = () => {};
  white.ws.emit("open");
  frame(white.ws, { type: "AuthResult", success: true });
  frame(white.ws, { type: "RoomList", rooms: [{ room_id: "room-1", room_name: "tts-commander", status: "Lobby" }] });
  const bots = ["Forge AI", "Forge AI 2", "Forge AI 3", "Forge AI 4", "Forge AI 5"].map((u) => ({ username: u, ready: true, connected: true, is_bot: true }));
  frame(white.ws, { type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 6, players: [{ username: white.username, ready: true, connected: true }, ...bots] } });
  await h.flush();
  const start = h.effects.map((e) => e.relay).find((r) => r?.type === "StartGame");
  if (!start) throw new Error("no StartGame");
  frame(white.ws, { type: "GameStarted", player_order: start.seat_order, game_id: "g6", starting_life: 40 });
  await h.flush();
  const from = h.effects.length;
  let n = 0;
  for (const x of rec) {
    if (x.kind === "state") {
      if ((x.board.gameView.turn || 0) > turns) break;
      white.onEnvelope({ kind: "state", forPlayer: "player-0", state: x.board, fingerprint: `s${++n}` });
    } else white.onEnvelope({ kind: "prompt", forPlayer: "player-0", prompt: x.prompt });
    await h.flush();
  }
  const out = [];
  let at = 0;
  for (const e of h.effects.slice(from)) {
    if (e.tts && KEEP.has(e.tts.t)) out.push({ at: at++, t: e.tts.t, json: JSON.stringify(e.tts) });
  }
  const errors = h.effects.filter((e) => e.log && /\bERROR\b|TypeError|ReferenceError|RangeError|threw/.test(e.log)).map((e) => e.log.slice(0, 200));
  // (startChats: what the bridge said in chat before the game, the setup words; not part of the stream fixture)
  const startChats = h.effects.slice(0, from).filter((e) => e.tts?.t === "chat").map((e) => String(e.tts.text || ""));
  const result = { out, order: start.seat_order, colors: { ...g.slotColor }, names: { ...g.slotNames }, errors, startChats };
  harness.restore();
  return result;
}

const plain = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
function diff(a, b) {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  if (plain(a) && plain(b)) {
    const out = {};
    for (const k of Object.keys(b)) { const d = diff(a[k], b[k]); if (d !== undefined) out[k] = d; }
    for (const k of Object.keys(a)) if (!(k in b)) out[k] = { $del: 1 };
    // (and the keys' order when it changed: a key added in the middle)
    const kept = [...Object.keys(a).filter((k) => k in b), ...Object.keys(b).filter((k) => !(k in a))];
    return kept.join() === Object.keys(b).join() ? { $o: out } : { $o: out, $k: Object.keys(b) };
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    const out = {};
    b.forEach((v, i) => { const d = diff(a[i], v); if (d !== undefined) out[i] = d; });
    return { $a: out };
  }
  return { $v: b };
}
function patch(a, d) {
  if (d.$v !== undefined) return JSON.parse(JSON.stringify(d.$v));
  if (d.$o) {
    const out = { ...a };
    for (const [k, v] of Object.entries(d.$o)) { if (v.$del) delete out[k]; else out[k] = patch(a[k], v); }
    // (the keys in the new state's order: a JSON key order the bridge's output could follow)
    return d.$k ? Object.fromEntries(d.$k.map((k) => [k, out[k]])) : out;
  }
  if (d.$a) return a.map((v, i) => (d.$a[i] ? patch(v, d.$a[i]) : v));
  return a;
}
// a recording (headless-six.js --record) up to the end of turn `turns` -> the fixture; and back
function pack(rec, turns) {
  const steps = [];
  let prev = null;
  for (const x of rec) {
    if (x.kind === "state") {
      if ((x.board.gameView.turn || 0) > turns) break;
      steps.push({ s: prev ? diff(prev, x.board) || { $o: {} } : { $v: x.board } });
      prev = x.board;
    } else steps.push({ p: x.prompt });
  }
  return { packed: 1, steps };
}
function unpack(fx) {
  const out = [];
  let prev = null;
  for (const st of fx.steps) {
    if (st.p) { out.push({ kind: "prompt", prompt: st.p }); continue; }
    prev = prev ? patch(prev, st.s) : patch(null, st.s);
    out.push({ kind: "state", board: prev });
  }
  return out;
}

module.exports = { stream, pack, unpack, ARCH_START };

if (require.main === module) {
  (async () => {
    const packed = pack(JSON.parse(fs.readFileSync(REC, "utf8")), TURNS);
    fs.writeFileSync(RELAY, JSON.stringify(packed));
    // (the bridge is fed the unpacked fixture, as the test feeds it: the same input both times)
    const r = await stream(unpack(packed), 99, process.argv.includes("--archenemy") ? ARCH_START : {});
    fs.writeFileSync(OUT, JSON.stringify(r.out));
    const count = {};
    for (const m of r.out) count[m.t] = (count[m.t] || 0) + 1;
    process.stdout.write(`seat order ${r.order.join(", ")}; colours ${JSON.stringify(r.colors)}\n`);
    process.stdout.write(`${r.out.length} messages ${JSON.stringify(count)}, ${fs.statSync(OUT).size} bytes -> ${path.relative(process.cwd(), OUT)}\n`);
    process.stdout.write(`relay input: ${packed.steps.length} steps, ${fs.statSync(RELAY).size} bytes -> ${path.relative(process.cwd(), RELAY)}\n`);
    for (const e of r.errors) process.stdout.write(`  ERROR ${e}\n`);
  })().catch((e) => { process.stdout.write(`FAIL m6-stream: ${e.stack}\n`); process.exit(1); });
}
