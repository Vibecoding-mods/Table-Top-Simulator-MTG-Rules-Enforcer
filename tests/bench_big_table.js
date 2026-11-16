// How the table copes with a huge token board (docs/big-turns.md): N identical Scute Swarm tokens on Blue's battlefield,
// drawn by tools/engine-renderer.lua on the fake TTS (fengari, not MoonSharp: times are relative). For each N, the board
// arrives, then the same board with two more tokens (one engine step of the Scute chain). Printed: the objects on the
// table after each board (Scute objects / all objects), the run's time and its time over the first (smallest) size's,
// and the board message's size. A measurement, not a gate.
//   node tests/bench_big_table.js [100,1000,3000]
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = buildSave();
const sizes = (process.argv[2] || "20,100,1000,3000").split(",").map(Number);
const cards = { scute: { n: "Scute Swarm", f: "https://example.invalid/scute.jpg", b: "", tl: "Creature — Insect", ty: ["Creature"] } };
const ids = (n) => Array.from({ length: n }, (_, k) => `scute${k}`);
const entry = (id) => ({ s: 1, id, ctl: "Blue", p: "1", t: "1", dmg: 0, ctr: {}, tok: true });
function board(n, first) {
  const all = {};
  for (const id of ids(n)) all[id] = { ...cards.scute };
  const pl = (color, slot, list) => ({
    color, slot, name: color, ai: color === "White", life: 40, status: "playing", pool: {}, poison: 0, energy: 0, cmdDamage: {}, tax: [0], library: 50, handCount: 0,
    hand: color === "Blue" ? [] : null, graveyard: [], exile: [], command: [], battlefield: list.map(entry),
  });
  return JSON.stringify({ t: "table", turn: 3, step: "main1", active: "Blue", activeTurnNo: 2, priority: "Blue", gameOver: false, winner: null,
    players: [pl("Blue", "player-0", ids(n)), pl("White", "player-1", [])], stack: [], cards: first ? all : {} });
}
const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "Blue", "player-1": "White" }, names: { "player-0": "Blue", "player-1": "AI 1" }, ai: ["White"] });
const PRELUDE = 'engineAutoPace.Blue = false engineChat("mtg start ai 1", Player.Blue) return "ok"';
const COUNT = { lua: "local n = 0 for _, o in ipairs(getObjects()) do if o.getGMNotes ~= nil and tostring(o.getGMNotes()):find(\"scute\", 1, true) then n = n + 1 end end return tostring(n) .. \"/\" .. tostring(#getObjects())", frames: 1 };
const rows = [];
for (const n of sizes) {
  const msgs = [board(n, true), board(n + 2, true)];
  const t0 = Date.now();
  const r = simulate({ save, steps: [{ lua: PRELUDE }, { msg: { t: "started", json: STARTED } },
    { msg: { t: "table", json: msgs[0] }, frames: 30 }, { ...COUNT, mark: "after1" },
    { msg: { t: "table", json: msgs[1] }, frames: 30 }, { ...COUNT, mark: "after2" }] });
  const total = Date.now() - t0;
  const v = (m) => (r.steps.find((s) => s.step === m) || {}).value;
  rows.push({ tokens: n, msgKB: Math.round(msgs[1].length / 1024), totalMs: total, overBaseMs: rows.length ? total - rows[0].totalMs : 0, objectsAfter1: v("after1"), objectsAfter2: v("after2"), errors: r.errors.length ? r.errors[0].slice(0, 80) : "" });
}
console.table(rows);
