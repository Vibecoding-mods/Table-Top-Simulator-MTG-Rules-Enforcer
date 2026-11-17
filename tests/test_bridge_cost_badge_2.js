// The cost badge, phase 2 (docs/cost-badge-spec.md, bridge.js costNow / cardNotes, tools/engine-renderer.lua
// engineCostChange / description): a card its seat may cast from a graveyard, exile or the library's top carries the
// engine's playCost, playCostMode and, for a foretold card, playCostPrinted (our Forge build, engine1117-costbadge2).
// The seat's playable row gets ec / mc / em from them; the public graveyard and exile piles do not; a foretold card
// face down in the row gets the words only, in its hover text; and the table's hover text says the way it is cast.
//   node tests/test_bridge_cost_badge_2.js
const fs = require("fs");
const path = require("path");
const harness = require("./bridge-harness");
const F = require("./golden/fixtures/dump2.json");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const clone = (o) => JSON.parse(JSON.stringify(o));

function setup(h, board) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: clone(board), fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  return seat;
}
const shape = F.board.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0").cards[0];
const C = (id, name, extra = {}) => ({ ...clone(shape), id, identity: { ...shape.identity, name }, ownerId: "player-0", controllerId: "player-0",
  mayPlay: true, visibility: "visible", effectiveManaCost: undefined, ...extra });
const zoneOf = (gv, kind) => {
  let z = gv.zones.find((x) => x.zone === kind && x.ownerId === "player-0");
  if (!z) { z = { zone: kind, ownerId: "player-0", cards: [], count: 0 }; gv.zones.push(z); }
  return z;
};
// Blue's board with these cards put in its zones; the table message's Blue entry
const tableOf = async (cards) => {
  const b = clone(F.board);
  for (const [kind, card] of cards) { const z = zoneOf(b.gameView, kind); z.cards.push(card); z.count = z.cards.length; }
  const h = harness.load();
  try {
    setup(h, b);
    h.B.sendTable(); await h.flush();
    const t = h.effects.filter((e) => e.tts && e.tts.t === "table").map((e) => e.tts)[0] || { players: [] };
    return t.players.find((p) => p.slot === "player-0") || {};
  } finally { harness.restore(); }
};
const find = (list, id) => (list || []).find((c) => c.id === id);
const pick = (c) => (c ? { ec: c.ec, mc: c.mc, em: c.em } : null);

(async () => {
  // ── the bridge ──
  const looting = C("engine-card-2001", "Faithless Looting", { types: ["Sorcery"], manaCost: "{R}", flashbackCost: "2 R", playCost: "{2}{R}", playCostMode: "flashback" });
  const ox = C("engine-card-2002", "Ox of Agonas", { types: ["Creature"], manaCost: "{3}{R}{R}", playCost: "{R}{R}", playCostMode: "escape" });
  const show = C("engine-card-2003", "Slickshot Show-Off", { types: ["Creature"], manaCost: "{1}{R}", isPlotted: true, playCost: "{0}", playCostMode: "plotted" });
  const kess = C("engine-card-2004", "Lightning Bolt", { types: ["Instant"], manaCost: "{R}", playCost: "{R}", playCostMode: "may play" });
  const free = C("engine-card-2005", "Divination", { types: ["Sorcery"], manaCost: "{2}{U}", exiledWith: "engine-card-9", playCost: "{0}", playCostMode: "free" });
  const saw = C("engine-card-2006", "Saw It Coming", { types: ["Instant"], manaCost: "no cost", isFaceDown: true, isForetold: true, playCost: "{1}{U}", playCostMode: "foretold", playCostPrinted: "{1}{U}{U}" });
  const both = C("engine-card-2007", "Opt", { types: ["Instant"], manaCost: "{U}", playCost: "{2}{U}", playCostMode: "may play", effectiveManaCost: "{1}{U}" });
  const p = await tableOf([["graveyard", looting], ["graveyard", ox], ["exile", show], ["graveyard", kess], ["exile", free], ["exile", saw], ["graveyard", both]]);
  const row = p.playable || [];
  ok("precondition: the seven cards are in Blue's playable row", [2001, 2002, 2003, 2004, 2005, 2006, 2007].every((n) => find(row, `engine-card-${n}`)), JSON.stringify(row.map((c) => c.id)));
  same("flashback: the row's Faithless Looting costs {2}{R} by flashback, printed {R}", pick(find(row, "engine-card-2001")), { ec: "{2}{R}", mc: "{R}", em: "flashback" });
  same("escape: the row's Ox of Agonas costs {R}{R} by escape", pick(find(row, "engine-card-2002")), { ec: "{R}{R}", mc: "{3}{R}{R}", em: "escape" });
  same("plot: the row's plotted card costs {0} by plot", pick(find(row, "engine-card-2003")), { ec: "{0}", mc: "{1}{R}", em: "plot" });
  same("may play: a permission at the printed cost has no badge", pick(find(row, "engine-card-2004")), { });
  same("free: a free cast reads {0}, with no way named", pick(find(row, "engine-card-2005")), { ec: "{0}", mc: "{2}{U}" });
  same("effective cost first: the engine's effectiveManaCost wins over playCost", pick(find(row, "engine-card-2007")), { ec: "{1}{U}", mc: "{U}" });
  const sawRow = find(row, "engine-card-2006");
  ok("foretell: the face-down row card has no badge fields", sawRow && sawRow.ec === undefined && sawRow.mc === undefined && sawRow.em === undefined, JSON.stringify(pick(sawRow)));
  ok("foretell: its hover text says the cost now against its face's printed cost", (sawRow?.nt || []).includes("Costs {1}{U} now by foretell (printed {1}{U}{U})"), JSON.stringify(sawRow?.nt));
  const gy = find(p.graveyard, "engine-card-2001");
  ok("graveyard pile: the public entry carries no play cost", gy && gy.ec === undefined && gy.em === undefined, JSON.stringify(pick(gy)));
  const ex = find(p.exile, "engine-card-2003");
  ok("exile pile: the public entry carries no play cost", ex && ex.ec === undefined, JSON.stringify(pick(ex)));
  // another seat's view: no mayPlay, so no row and no cost
  const notMine = await tableOf([["graveyard", { ...looting, mayPlay: false }]]);
  ok("no permission: no row entry and no cost", !find(notMine.playable, "engine-card-2001") && find(notMine.graveyard, "engine-card-2001")?.ec === undefined, JSON.stringify(notMine.playable));
  // costNow alone
  same("costNow: no row, no play cost", harness.load().B.costNow({ manaCost: "{R}", playCost: "{2}{R}", playCostMode: "flashback" }, "graveyard"), {}); harness.restore();
  same("costNow: a hand card's effectiveManaCost is as before", harness.load().B.costNow({ manaCost: "{2}{B}", effectiveManaCost: "{3}{B}", playCost: "{9}" }, "hand"), { ec: "{3}{B}", mc: "{2}{B}" }); harness.restore();

  // ── the table: engineCostChange's hover words with the way, and description on a row card ──
  const RENDERER = fs.readFileSync(path.join(__dirname, "..", "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
  const fn = (name) => {
    const a = RENDERER.indexOf(`\nfunction ${name}(`);
    const b = a < 0 ? -1 : RENDERER.indexOf("\nend\n", a);
    if (a < 0 || b < 0) { console.log(`FAIL test_bridge_cost_badge_2: ${name} is gone`); process.exit(1); }
    return RENDERER.slice(a, b + 5);
  };
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const runLua = (src) => {
    if (lauxlib.luaL_dostring(L, to_luastring(src)) !== lua.LUA_OK) return `ERROR ${lua.lua_tojsstring(L, -1)}`;
    const v = lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); return v;
  };
  const loaded = runLua(`${fn("engineCostPips")}${fn("engineCostChange")} return "ok"`);
  ok("table: precondition, the cost functions load", loaded === "ok", loaded);
  const words = (mc, ec, em) => runLua(`local r = engineCostChange(${JSON.stringify(mc)}, ${JSON.stringify(ec)}, ${em == null ? "nil" : JSON.stringify(em)}) return r and r.text or "nil"`);
  same("table: flashback's words", words("{R}", "{2}{R}", "flashback"), "Costs {2}{R} now by flashback (printed {R})");
  same("table: plot's words, a cheaper cost", words("{1}{R}", "{0}", "plot"), "Costs {0} now by plot (printed {1}{R})");
  same("table: no way, the phase-1 words", words("{2}{B}", "{3}{B}", null), "Costs {3}{B} now (printed {2}{B})");
  same("table: an empty way is no way", words("{2}{B}", "{3}{B}", ""), "Costs {3}{B} now (printed {2}{B})");
  const dir = runLua(`local r = engineCostChange("{R}", "{2}{R}", "flashback") return r.dir .. " " .. tostring(r.generic)`);
  same("table: the badge itself is as phase 1's (dearer, generic 2)", dir, "more 2");
  // description passes the bridge's em on (both callers)
  const desc = RENDERER.slice(RENDERER.indexOf("\nlocal function description("), RENDERER.indexOf("\nend\n", RENDERER.indexOf("\nlocal function description(")));
  ok("table: description passes em to engineCostChange", desc.includes("engineCostChange(c.mc, c.ec, c.em)"), "description doesn't pass c.em");
  const parts = fn("engineCostParts");
  ok("table: the cost badge's tooltip passes em too", parts.includes("engineCostChange(c.mc, c.ec, c.em)"), "engineCostParts doesn't pass c.em");
  // no new screen XML: the change is in the renderer's functions only
  ok("table: no new XML", !/<Panel|<Button|<Text /.test(fn("engineCostChange")), "XML in engineCostChange");

  process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} cost badge 2 checks pass\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_bridge_cost_badge_2: ${e.stack}`); process.exit(1); });
