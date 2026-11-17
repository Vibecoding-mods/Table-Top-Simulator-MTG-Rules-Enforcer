// The cost badge, phase 4 (docs/handoff/open-after-1121.md §3; bridge.js spellCostNotes): our Forge build
// (engine1121-costbadge4) says what a way to cast a card costs besides mana, in Forge's words: playCostExtra for the way
// cast now, a SpellCostDto's extra for each other way and each half. The hover says it:
//  - "Escape also costs: exile eight other cards from your graveyard." (the way named), "Casting it also costs: ..."
//    for a permission or a free cast;
//  - "Other ways to cast it: {1}{R} by flashback, and pay 3 life";
//  - a half's line in hand, "Stomp: costs {2}{R} now (printed {1}{R}), and pay 2 life".
// The cheapest way is still chosen by the engine (PlayCost.cheapest: mana value, then fewer non-mana parts, then less
// life); the bridge only says it. The table draws hover lines as before: no Lua or XML change.
//   node tests/test_bridge_cost_badge_4.js
const harness = require("./bridge-harness");
const F = require("./golden/fixtures/dump2.json");

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
}
const shape = F.board.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0").cards[0];
const C = (id, name, extra = {}) => ({ ...clone(shape), id, identity: { ...shape.identity, name }, ownerId: "player-0", controllerId: "player-0",
  visibility: "visible", effectiveManaCost: undefined, ...extra });
const zoneOf = (gv, kind) => {
  let z = gv.zones.find((x) => x.zone === kind && x.ownerId === "player-0");
  if (!z) { z = { zone: kind, ownerId: "player-0", cards: [], count: 0 }; gv.zones.push(z); }
  return z;
};
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
const badge = (c) => (c ? { ec: c.ec, mc: c.mc, em: c.em } : null);
const S = (name, cost, printed, mode, extra) => ({ name, cost, printed, ...(mode ? { mode } : {}), ...(extra ? { extra } : {}) });

(async () => {
  const ox = C("engine-card-4001", "Ox of Agonas", { types: ["Creature"], manaCost: "{3}{R}{R}", mayPlay: true, playCost: "{R}{R}", playCostMode: "escape", playCostExtra: "Exile eight other cards from your graveyard" });
  const dread = C("engine-card-4002", "Dread Return", { types: ["Sorcery"], manaCost: "{2}{B}{B}", mayPlay: true, playCost: "{0}", playCostMode: "flashback", playCostExtra: "Sacrifice three creatures" });
  const kessed = C("engine-card-4003", "Flash of Defiance", { types: ["Sorcery"], manaCost: "{1}{R}", mayPlay: true, playCost: "{1}{R}", playCostMode: "may play", playCostOthers: [S("Flash of Defiance", "{1}{R}", "{1}{R}", "flashback", "Pay 3 life")] });
  const free = C("engine-card-4004", "Deep Analysis", { types: ["Sorcery"], manaCost: "{3}{U}", mayPlay: true, playCost: "{0}", playCostMode: "free", playCostExtra: "Pay 3 life" });
  const plain = C("engine-card-4005", "Faithless Looting", { types: ["Sorcery"], manaCost: "{R}", mayPlay: true, playCost: "{2}{R}", playCostMode: "flashback", playCostOthers: [S("Faithless Looting", "{R}", "{R}", "may play")] });
  const giant = C("engine-card-4006", "Bonecrusher Giant", { types: ["Creature"], manaCost: "{2}{R}", spellCosts: [S("Bonecrusher Giant", "{2}{R}", "{2}{R}"), S("Stomp", "{2}{R}", "{1}{R}", null, "Pay 2 life")] });
  const p = await tableOf([["graveyard", ox], ["graveyard", dread], ["graveyard", kessed], ["exile", free], ["graveyard", plain], ["hand", giant]]);
  const hand = p.hand || [], row = p.playable || [];
  ok("precondition: the row and the hand hold the cards", [4001, 4002, 4003, 4004, 4005].every((n) => find(row, `engine-card-${n}`)) && find(hand, "engine-card-4006"),
    JSON.stringify({ hand: hand.map((c) => c.id), row: row.map((c) => c.id) }));
  const nt = (list, n) => (find(list, `engine-card-${n}`)?.nt || []);

  same("escape: the badge is the mana", badge(find(row, "engine-card-4001")), { ec: "{R}{R}", mc: "{3}{R}{R}", em: "escape" });
  ok("escape: the exiled cards said with the way", nt(row, 4001).includes("Escape also costs: exile eight other cards from your graveyard."), JSON.stringify(nt(row, 4001)));
  ok("flashback {0}: the sacrifices said", nt(row, 4002).includes("Flashback also costs: sacrifice three creatures."), JSON.stringify(nt(row, 4002)));
  ok("tie: the plain way cast, nothing extra for it", !nt(row, 4003).some((l) => /also costs/.test(l)), JSON.stringify(nt(row, 4003)));
  ok("tie: the other way with its life", nt(row, 4003).includes("Other ways to cast it: {1}{R} by flashback, and pay 3 life"), JSON.stringify(nt(row, 4003)));
  ok("free: no way named", nt(row, 4004).includes("Casting it also costs: pay 3 life."), JSON.stringify(nt(row, 4004)));
  ok("no extra: no also-costs line", !nt(row, 4005).some((l) => /also costs/.test(l)), JSON.stringify(nt(row, 4005)));
  ok("no extra: the other way without an and", nt(row, 4005).includes("Other ways to cast it: {R}"), JSON.stringify(nt(row, 4005)));
  same("hand: a half's extra after its cost", nt(hand, 4006), ["Stomp: costs {2}{R} now (printed {1}{R}), and pay 2 life"]);
  const pile = find(p.graveyard, "engine-card-4001");
  ok("pile: the public graveyard entry says no extra", pile && !(pile.nt || []).some((l) => /also costs/.test(l)), JSON.stringify(pile?.nt));

  const mapText = require("fs").readFileSync(require("path").join(__dirname, "../bridge/table-map.js"), "utf8");
  ok("table-map: playCostExtra goes to the hover", /playCostExtra:\s*\{\s*to:\s*\["nt"\]/.test(mapText), "table-map.js has no playCostExtra -> nt");

  process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} cost badge 4 checks pass\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL test_bridge_cost_badge_4: ${e.stack}\n`); process.exit(1); });
