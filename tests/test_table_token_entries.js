// Token runs (docs/handoff/token-entries-report.md): the bridge sends identical tokens in a row of a battlefield as ONE
// entry (bridge.js tokenRuns: the first token's entry with gi, the others' ids, "engine-card-N" ids as [N, count] ranges;
// the others' new details as { a: first id }), and the table lays each run out again before it reads the board
// (engine-renderer.lua engineExpandRuns and the alias step in mergeStatic). Checked, at 1, 50 and 1,000 tokens and on a
// mixed board over several boards: the boards the table reads after mergeStatic (every zone of every player, every
// card's details by id) are the same with runs as without them, so the renderer draws the same; and what it costs:
// the message bytes and the fengari time of the table's decoder (engineJsonDecode) plus mergeStatic, without and with.
// No TTS save needed.
//   node tests/test_table_token_entries.js
const fs = require("fs");
const path = require("path");
const harness = require("./bridge-harness");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

const ROOT = path.join(__dirname, "..");
const RENDERER = fs.readFileSync(path.join(ROOT, "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
const JSONLUA = fs.readFileSync(path.join(ROOT, "tools", "engine-json.lua"), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const hr = () => Number(process.hrtime.bigint()) / 1e6;

// ── the table's side: mergeStatic and what it needs, on fengari ──
const cut = (start) => {
  const a = RENDERER.indexOf(start);
  const b = a < 0 ? -1 : RENDERER.indexOf("\nend\n", a);
  if (a < 0 || b < 0) { console.log(`FAIL test_table_token_entries: ${start.trim()} is gone`); process.exit(1); }
  return RENDERER.slice(a, b + 5);
};
const FUNCS = ["\nfunction engineExpandUrl(", "\nfunction engineFaceKey(", "\nfunction engineStoreStatic(", "\nfunction engineExpandRuns(", "\nfunction engineHasRuns(",
  "\nfunction engineExpandRun(", "\nfunction engineExpandIds(", "\nfunction engineCopyCard(", "\nfunction engineDeepCopy("].map(cut).join("")
  + cut("\nlocal function mergeStatic(m)").replace("local function mergeStatic(m)", "function mergeStatic(m)");
const DUMP = `
function dumpValue(v)
  if type(v) ~= "table" then return type(v) == "string" and string.format("%q", v) or tostring(v) end
  local keys = {}
  for k in pairs(v) do keys[#keys + 1] = k end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  local parts = {}
  for _, k in ipairs(keys) do parts[#parts + 1] = tostring(k) .. "=" .. dumpValue(v[k]) end
  return "{" .. table.concat(parts, ",") .. "}"
end
-- one board in, as the table takes it: decode, merge, keep as the last board; the board as read, and every card's details
function takeBoard(json)
  local m = engineJsonDecode(json)
  mergeStatic(m)
  lastTable = m
  local ids = {}
  for _, pl in ipairs(m.players or {}) do
    for _, z in ipairs({ "hand", "battlefield", "graveyard", "exile", "command", "playable", "revealed", "ctlHand" }) do
      for _, c in ipairs(pl[z] or {}) do ids[#ids + 1] = c.id end
    end
  end
  table.sort(ids)
  local st = {}
  for _, id in ipairs(ids) do st[#st + 1] = id .. ":" .. dumpValue(engineStatic[id]) end
  return dumpValue(m.players) .. "\\n" .. table.concat(st, "\\n")
end
function timeBoard(json, runs)
  local t = os.clock()
  for _ = 1, runs do engineStatic = {} lastTable = nil local m = engineJsonDecode(json) mergeStatic(m) end
  return tostring((os.clock() - t) * 1000 / runs)
end
`;
function luaState() {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const src = `engineStatic = {}\nlastTable = nil\n${JSONLUA}\n${FUNCS}\n${DUMP}`;
  if (lauxlib.luaL_loadstring(L, to_luastring(src)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
    console.log(`FAIL test_table_token_entries: the table code doesn't load: ${lua.lua_tojsstring(L, -1)}`); process.exit(1);
  }
  return (fn, ...args) => {
    lua.lua_getglobal(L, to_luastring(fn));
    for (const a of args) { if (typeof a === "number") lua.lua_pushnumber(L, a); else lua.lua_pushstring(L, to_luastring(a)); }
    if (lua.lua_pcall(L, args.length, 1, 0) !== lua.LUA_OK) throw new Error(`${fn}: ${lua.lua_tojsstring(L, -1)}`);
    const v = lua.lua_tojsstring(L, -1);
    lua.lua_pop(L, 1);
    return v;
  };
}

// ── the bridge's side: boards of tokens through sendTable ──
const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const blank = () => ({ turn: 9, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [], combatAssignments: [],
  players: [{ id: "player-0", life: 40, manaPool: {}, status: "playing" }, { id: "player-1", life: 40, manaPool: {}, status: "playing" }],
  zones: ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) });
const token = (n, o = {}) => ({ id: `engine-card-${n}`, identity: { name: o.name || "Soldier", isToken: true }, types: ["Creature"], subtypes: [o.sub || "Soldier"],
  power: o.p ?? 1, toughness: o.t ?? 1, controllerId: o.ctl || "player-0", ownerId: o.ctl || "player-0", text: o.text || "", colors: ["W"],
  ...(o.tapped ? { tapped: true } : {}), ...(o.counters ? { counters: o.counters } : {}), ...(o.attacking ? { isAttacking: true, attackTargetId: "player-1" } : {}),
  ...(o.unbounded ? { unbounded: true } : {}), ...(o.att ? { attachedTo: o.att } : {}), ...(o.damage ? { damage: o.damage } : {}) });
const card = (n, name, o = {}) => ({ id: `engine-card-${n}`, identity: { name }, types: o.types || ["Creature"], power: o.p ?? 2, toughness: o.t ?? 2,
  controllerId: o.ctl || "player-0", ownerId: o.ctl || "player-0", text: o.text || "", ...(o.att ? { attachedTo: o.att } : {}) });
function board(cards) {
  const gv = blank();
  for (const c of cards) {
    const bf = gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === c.controllerId);
    bf.cards.push(c);
    bf.count = bf.cards.length;
  }
  return gv;
}
// the table messages for a run of boards, with or without token runs (one bridge, one game)
async function messages(boards, runs, { hello = null } = {}) {
  const h = harness.load();
  try {
    h.B._tokenRuns(runs);
    if (hello) { h.B.onTTS({ t: "hello", ...hello }); await h.flush(100000); }
    const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
    seat.slot = "player-0";
    seat.respond = () => {};
    h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
      slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
      started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
    const out = [];
    for (const gv of boards) {
      seat.board = { state: { gameView: gv }, fingerprint: null };
      const n0 = h.effects.length;
      h.B.sendTable(); await h.flush(100000);
      // (every table message the board brought, in order: a picture found later is a second one, its zones kept)
      out.push(h.effects.slice(n0).filter((e) => e.tts?.t === "table").map((e) => e.tts));
    }
    return out;
  } finally { h.B._tokenRuns(false); harness.restore(); }
}
// two boards sent before the table takes either: the newer replaces the older in the outbox (toTTS), the older's
// details kept; the table never sees the first board's runs
async function replacedMessages(first, second, runs) {
  const h = harness.load();
  try {
    h.B._tokenRuns(runs);
    const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
    seat.slot = "player-0";
    seat.respond = () => {};
    h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
      slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
      started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
    const n0 = h.effects.length;
    // (an empty board takes the line to the table; the first then waits in the outbox, and the second replaces it)
    seat.board = { state: { gameView: board([]) }, fingerprint: null };
    h.B.sendTable();
    seat.board = { state: { gameView: first }, fingerprint: null };
    h.B.sendTable();
    seat.board = { state: { gameView: second }, fingerprint: null };
    h.B.sendTable();
    await h.flush(100000);
    return [h.effects.slice(n0).filter((e) => e.tts?.t === "table").map((e) => e.tts)];
  } finally { h.B._tokenRuns(false); harness.restore(); }
}
// what the table reads after each message, for the boards' messages in order (a fresh table)
function tableReads(boards) {
  const call = luaState();
  return boards.map((msgs) => msgs.map((m) => call("takeBoard", JSON.stringify(m))).join("\n--\n"));
}
const runsIn = (msgs) => msgs.flatMap((m) => (m?.players || []).flatMap((p) => p.battlefield || [])).filter((c) => c.gi).length;
const bytes = (boards) => boards.flat().reduce((s, m) => s + JSON.stringify(m).length, 0);

async function compare(name, boards, { wantRuns = true } = {}) {
  const plain = await messages(boards, false);
  const runs = await messages(boards, true);
  ok(`${name}: a board every time`, plain.every((x) => x.length) && runs.every((x) => x.length) && plain.every((x, i) => x.length === runs[i].length),
    `${plain.map((x) => x.length)} / ${runs.map((x) => x.length)}`);
  const a = tableReads(plain), b = tableReads(runs);
  const differ = a.findIndex((x, i) => x !== b[i]);
  ok(`${name}: the table reads the same boards with token runs`, differ < 0, differ < 0 ? "" : `board ${differ + 1}: ${firstDiff(a[differ], b[differ])}`);
  if (wantRuns) ok(`${name}: the boards carry token runs`, runs.some((m) => runsIn(m) > 0), "no gi sent");
  else ok(`${name}: no run where nothing repeats`, runs.every((m) => runsIn(m) === 0), "a gi sent");
  return { plain, runs };
}
// the bridge's packRunIds, for the recorded streams
function runIds(ids) {
  const out = [];
  for (const id of ids) {
    const m = /^engine-card-(\d+)$/.exec(id);
    const n = m ? Number(m[1]) : null;
    const last = out.at(-1);
    if (n != null && Array.isArray(last) && last[0] + last[1] === n) last[1]++;
    else out.push(n != null ? [n, 1] : id);
  }
  return out;
}
function firstDiff(x, y) {
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  return `at ${i}: plain …${x.slice(Math.max(0, i - 60), i + 80)}… runs …${y.slice(Math.max(0, i - 60), i + 80)}…`;
}

(async () => {
  const sizes = {};
  for (const n of [1, 50, 1000]) {
    const many = (k0, k, o) => Array.from({ length: k }, (_, i) => token(k0 + i, o));
    const first = board(many(1000, n));
    // (the next board: one token taps and a new one comes; then one dies)
    const second = board([...many(1000, n).map((c, i) => (i === 0 ? { ...c, tapped: true } : c)), token(5000)]);
    const third = board([...many(1001, Math.max(0, n - 1)), token(5000)]);
    const { plain, runs } = await compare(`${n} tokens`, [first, second, third], { wantRuns: n > 1 });
    sizes[n] = { plain: bytes(plain.slice(0, 1)), runs: bytes(runs.slice(0, 1)), plainAll: bytes(plain), runsAll: bytes(runs), msgs: [plain[0][0], runs[0][0]] };
  }
  ok("1,000 tokens: the first board is under a tenth of its old size", sizes[1000].runs * 10 < sizes[1000].plain, `${sizes[1000].runs} vs ${sizes[1000].plain} bytes`);
  ok("1,000 tokens: the ids go as one range", (() => { const c = sizes[1000].msgs[1].players.flatMap((p) => p.battlefield || []).find((x) => x.gi); return c && JSON.stringify(c.gi) === "[[1001,999]]"; })(), "gi not one range");

  // a mixed board: tapped, countered, attacking, infinite, damaged and enchanted tokens; another kind; a card between two
  // runs; the other player's tokens; and ids that aren't in a row
  const mixed = [
    ...Array.from({ length: 6 }, (_, i) => token(100 + i)),
    ...Array.from({ length: 3 }, (_, i) => token(110 + i, { tapped: true })),
    ...Array.from({ length: 2 }, (_, i) => token(120 + i, { counters: { P1P1: 1 } })),
    card(130, "Grizzly Bears"),
    ...Array.from({ length: 4 }, (_, i) => token(140 + i)),
    ...Array.from({ length: 5 }, (_, i) => token(150 + i, { attacking: true })),
    ...Array.from({ length: 3 }, (_, i) => token(160 + i * 7, { name: "Zombie", sub: "Zombie", p: 2, t: 2 })),
    ...Array.from({ length: 2 }, (_, i) => token(170 + i, { unbounded: true })),
    token(180, { damage: 1 }), token(181), token(182),
    // (a Goblin the same as the Soldiers in all but its details: never in their run)
    token(183, { name: "Goblin", sub: "Goblin" }), token(184), token(185),
    // (ids that aren't "engine-card-N": sent as themselves)
    ...["engine-token-a", "engine-token-b", "engine-token-c"].map((id) => ({ ...token(0), id })),
    card(190, "Pacifism", { types: ["Enchantment"], att: "engine-card-181" }),
    ...Array.from({ length: 4 }, (_, i) => token(200 + i, { ctl: "player-1", name: "Goblin", sub: "Goblin" })),
  ];
  const mixed2 = mixed.map((c) => (c.id === "engine-card-101" ? { ...c, counters: { P1P1: 2 } } : c.id === "engine-card-141" ? { ...c, tapped: true } : c));
  await compare("mixed board", [board(mixed), board(mixed2), board(mixed)]);
  {
    // (the run's first token gone in the second board: the next one stands first, with details it was never sent)
    const a = board(Array.from({ length: 8 }, (_, i) => token(300 + i)));
    const b = board([token(301, { tapped: true }), ...Array.from({ length: 6 }, (_, i) => token(302 + i))]);
    const plain = await replacedMessages(a, b, false), runs = await replacedMessages(a, b, true);
    const x = tableReads(plain), y = tableReads(runs);
    const firstOnly = (msgs) => msgs.some((m) => m.players?.some((p) => (p.battlefield || []).some((c) => c.id === "engine-card-300")));
    ok("outbox: the first board was replaced before the table took it", !firstOnly(plain[0]) && !firstOnly(runs[0]), "the first board reached the table");
    ok("outbox: a board replaced before the table took it", plain[0].length > 0 && x[0] === y[0], x[0] === y[0] ? `${plain[0].length} messages` : firstDiff(x[0], y[0]));
  }
  await compare("no two alike", [board([token(1), token(2, { tapped: true }), card(3, "Grizzly Bears"), token(4, { name: "Zombie", sub: "Zombie" })])], { wantRuns: false });
  // (a table that doesn't say it reads runs gets none: the hello's tokenRuns)
  for (const says of [false, true]) {
    const sent = await messages([board(Array.from({ length: 20 }, (_, i) => token(i + 1)))], false, { hello: { keepRewind: true, ...(says ? { tokenRuns: true } : {}) } });
    const n = sent[0][0].players.find((p) => p.color === "Blue").battlefield.length;
    if (says) ok("a table whose hello says tokenRuns gets runs", runsIn(sent[0]) > 0 && n === 1, `${n} entries`);
    else ok("a table without tokenRuns gets every token", runsIn(sent[0]) === 0 && n === 20, `${n} entries`);
  }
  ok("the table says it reads runs in its hello", (RENDERER.match(/keepRewind = true, tokenRuns = true,/g) || []).length === 2, "engineHello");

  // ── with the Workshop table: the table golden's own games drawn by the fake TTS, as recorded and with their boards'
  // token runs packed as the bridge packs them (slim tokens alike in a row, by the details the stream sent); every step's
  // effects (objects, setVectorLines, UI) must be byte-identical ──
  let save = null;
  try { save = require("./golden/table-run").buildSave(); } catch (e) { save = null; }
  if (!save) console.log("SKIP fake-TTS part: it needs the Workshop table (MTG_TABLE_JSON), as tests/test_table_golden.js does");
  else {
    const { simulate } = require("./lua/run-sim");
    const { scenarios } = require("./golden/table-run");
    const NO_BUNDLE = "engineFxBundle = { fx = nil, sounds = nil }";
    let packed = 0;
    for (const sc of scenarios()) {
      const statics = {};
      const steps = sc.steps.map((st) => {
        if (st.msg?.t !== "table") return st;
        const m = JSON.parse(st.msg.json);
        for (const [id, x] of Object.entries(m.cards || {})) statics[id] = JSON.stringify(x);
        for (const pl of m.players || []) {
          if (!pl.battlefield) continue;
          const out = [];
          let run = null;
          for (const c of pl.battlefield) {
            const st0 = c.s === 1 ? statics[c.id] : null;
            const key = st0 && JSON.parse(st0).tok ? `${JSON.stringify({ ...c, id: null })}|${st0}` : null;
            if (key && run && run.key === key) { run.ids.push(c.id); continue; }
            if (run && run.ids.length) { run.first.gi = runIds(run.ids); packed++; }
            run = key ? { first: c, key, ids: [] } : null;
            out.push(c);
          }
          if (run && run.ids.length) { run.first.gi = runIds(run.ids); packed++; }
          pl.battlefield = out;
        }
        return { ...st, msg: { ...st.msg, json: JSON.stringify(m) } };
      });
      const opts = { save, prelude: NO_BUNDLE, ...(sc.seated ? { seated: sc.seated } : {}) };
      const a = simulate({ ...opts, steps: sc.steps }), b = simulate({ ...opts, steps });
      const k = a.steps.findIndex((x, i) => JSON.stringify(x) !== JSON.stringify(b.steps[i]));
      ok(`fake TTS: ${sc.name} draws the same with token runs`, k < 0 && a.steps.length === b.steps.length && JSON.stringify(a.errors) === JSON.stringify(b.errors),
        k < 0 ? "errors differ" : `step ${k}: ${JSON.stringify(a.steps[k]).slice(0, 200)} vs ${JSON.stringify(b.steps[k]).slice(0, 200)}`);
    }
    console.log(`fake TTS: ${packed} token runs packed in the table golden's games`);
  }

  // ── what it costs: bytes, and the table's decode + mergeStatic on fengari ──
  const call = luaState();
  const rows = [];
  for (const n of [1, 50, 1000]) {
    const [p, r] = sizes[n].msgs.map((m) => JSON.stringify(m));
    const reps = n >= 1000 ? 3 : 20;
    rows.push({ tokens: n, bytesBefore: p.length, bytesAfter: r.length, msBefore: +Number(call("timeBoard", p, reps)).toFixed(2), msAfter: +Number(call("timeBoard", r, reps)).toFixed(2) });
  }
  for (const row of rows) console.log(`cost: ${row.tokens} tokens, first board: ${row.bytesBefore} -> ${row.bytesAfter} bytes; table decode + merge (fengari) ${row.msBefore} -> ${row.msAfter} ms`);
  ok("1,000 tokens: the table's decode and merge take less time", rows[2].msAfter < rows[2].msBefore, JSON.stringify(rows[2]));

  console.log(`${failed ? "FAIL" : "PASS"} test_table_token_entries: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_table_token_entries: ${e.stack}`); process.exit(1); });
