// The cost badge, phase 2 follow-ups (docs/cost-badge-spec.md Step 5, "Follow-ups"; bridge.js costNow / cardNotes /
// spellCostNotes): our Forge build (engine1117-costbadge3) prices the halves of split and adventure cards and every way
// a card can be cast from its zone:
//  - spellCosts on a split or adventure card in hand: each half with its cost now and printed. The hover says each
//    half whose cost changed ("Stomp: costs {2}{R} now (printed {1}{R})"); a split card has no badge of its own (its
//    picture has a cost for each half), an adventure card keeps its creature's badge (effectiveManaCost).
//  - playCost is the cheapest way from a graveyard or exile, playCostName the half it casts (a split or adventure
//    card), playCostOthers the other ways. A half is said in the hover, with no badge ("Castable: Memory {5}{U}{U} by
//    aftermath (printed {4}{U}{U})"); the other ways too ("Other ways to cast it: Ice {1}{U}; {3}{U}").
// The table draws hover lines as before (the notes): no Lua or XML change.
//   node tests/test_bridge_cost_badge_3.js
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
const S = (name, cost, printed, mode) => ({ name, cost, printed, ...(mode ? { mode } : {}) });

(async () => {
  // ── hand: the halves ──
  const fire = C("engine-card-3001", "Fire // Ice", { types: ["Instant"], manaCost: "{2}{R}{U}", spellCosts: [S("Fire", "{2}{R}", "{1}{R}"), S("Ice", "{2}{U}", "{1}{U}")] });
  const giant = C("engine-card-3002", "Bonecrusher Giant", { types: ["Creature"], manaCost: "{2}{R}", spellCosts: [S("Bonecrusher Giant", "{2}{R}", "{2}{R}"), S("Stomp", "{2}{R}", "{1}{R}")] });
  const taxedGiant = C("engine-card-3003", "Bonecrusher Giant", { types: ["Creature"], manaCost: "{2}{R}", effectiveManaCost: "{3}{R}", spellCosts: [S("Bonecrusher Giant", "{3}{R}", "{2}{R}"), S("Stomp", "{2}{R}", "{1}{R}")] });
  // ── graveyard: the cheapest way, the halves, the others ──
  const memory = C("engine-card-3004", "Commit // Memory", { types: ["Instant", "Sorcery"], manaCost: "{7}{U}{U}{U}", mayPlay: true, playCost: "{5}{U}{U}", playCostMode: "aftermath", playCostName: "Memory", playCostPrinted: "{4}{U}{U}" });
  const deep = C("engine-card-3005", "Deep Analysis", { types: ["Sorcery"], manaCost: "{3}{U}", mayPlay: true, playCost: "{1}{U}", playCostMode: "flashback", playCostOthers: [S("Deep Analysis", "{3}{U}", "{3}{U}", "may play")] });
  const fireKess = C("engine-card-3006", "Fire // Ice", { types: ["Instant"], manaCost: "{2}{R}{U}", mayPlay: true, playCost: "{1}{R}", playCostMode: "may play", playCostName: "Fire", playCostPrinted: "{1}{R}", playCostOthers: [S("Ice", "{1}{U}", "{1}{U}", "may play")] });
  const looting = C("engine-card-3007", "Faithless Looting", { types: ["Sorcery"], manaCost: "{R}", mayPlay: true, playCost: "{R}", playCostMode: "may play", playCostOthers: [S("Faithless Looting", "{2}{R}", "{R}", "flashback")] });
  const p = await tableOf([["hand", fire], ["hand", giant], ["hand", taxedGiant], ["graveyard", memory], ["graveyard", deep], ["graveyard", fireKess], ["graveyard", looting]]);
  const hand = p.hand || [], row = p.playable || [];
  ok("precondition: the hand and the row hold the cards", [3001, 3002, 3003].every((n) => find(hand, `engine-card-${n}`)) && [3004, 3005, 3006, 3007].every((n) => find(row, `engine-card-${n}`)),
    JSON.stringify({ hand: hand.map((c) => c.id), row: row.map((c) => c.id) }));
  const nt = (list, n) => (find(list, `engine-card-${n}`)?.nt || []);
  // split in hand
  same("split in hand: no badge of its own", badge(find(hand, "engine-card-3001")), { });
  same("split in hand: each half's cost now in the hover", nt(hand, 3001), ["Fire: costs {2}{R} now (printed {1}{R})", "Ice: costs {2}{U} now (printed {1}{U})"]);
  // adventure in hand
  same("adventure in hand: the creature unchanged, no badge", badge(find(hand, "engine-card-3002")), { });
  same("adventure in hand: only the changed half said", nt(hand, 3002), ["Stomp: costs {2}{R} now (printed {1}{R})"]);
  same("adventure in hand: a taxed creature keeps its badge", badge(find(hand, "engine-card-3003")), { ec: "{3}{R}", mc: "{2}{R}" });
  same("adventure in hand: and the hover says each changed half", nt(hand, 3003), ["Bonecrusher Giant: costs {3}{R} now (printed {2}{R})", "Stomp: costs {2}{R} now (printed {1}{R})"]);
  // a half from the graveyard
  same("aftermath: a taxed half has no badge (the picture has a cost for each half)", badge(find(row, "engine-card-3004")), { });
  ok("aftermath: the hover says the half, its cost and the way", nt(row, 3004).includes("Castable: Memory {5}{U}{U} by aftermath (printed {4}{U}{U})"), JSON.stringify(nt(row, 3004)));
  // the cheapest way, with the other listed
  same("cheapest: the badge is the cheaper way's", badge(find(row, "engine-card-3005")), { ec: "{1}{U}", mc: "{3}{U}", em: "flashback" });
  ok("cheapest: the other way in the hover", nt(row, 3005).includes("Other ways to cast it: {3}{U}"), JSON.stringify(nt(row, 3005)));
  // halves by a permission: the half named, the other half listed
  same("halves: no badge for a half", badge(find(row, "engine-card-3006")), { });
  ok("halves: the half cast and the other half", nt(row, 3006).includes("Castable: Fire {1}{R}") && nt(row, 3006).includes("Other ways to cast it: Ice {1}{U}"), JSON.stringify(nt(row, 3006)));
  // a permission at the printed cost, with flashback dearer: no badge, the flashback listed with its way
  same("others: the cheapest at the printed cost has no badge", badge(find(row, "engine-card-3007")), { });
  ok("others: a dearer way said with its way", nt(row, 3007).includes("Other ways to cast it: {2}{R} by flashback"), JSON.stringify(nt(row, 3007)));
  // the public graveyard pile says none of it
  const pile = find(p.graveyard, "engine-card-3005");
  ok("pile: the public graveyard entry has no other ways", pile && !(pile.nt || []).some((l) => /Other ways|Castable/.test(l)), JSON.stringify(pile?.nt));
  // costNow alone, for a half
  const h = harness.load();
  same("costNow: a half's playCost is no badge", h.B.costNow({ manaCost: "{7}{U}{U}{U}", playCost: "{5}{U}{U}", playCostName: "Memory", playCostPrinted: "{4}{U}{U}" }, "graveyard", true), {});
  harness.restore();

  process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} cost badge 3 checks pass\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL test_bridge_cost_badge_3: ${e.stack}\n`); process.exit(1); });
