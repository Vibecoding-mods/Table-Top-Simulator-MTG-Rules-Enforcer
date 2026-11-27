// A refused drag blames a missing target (whyNot, missingTarget) only when no noun of the card's "target X or Y" is on the
// table: Disenchant with just an enchantment out there has a target (2026-11-27).
//   node tests/test_bridge_why_target_union.js
const harness = require("./bridge-harness");
const F = require("./golden/fixtures/dump2.json");
const clone = (x) => JSON.parse(JSON.stringify(x));
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
// Blue (player-0) tries a card with this text; AI 1 has one permanent of these types
function why(text, theirTypes) {
  const h = harness.load();
  try {
    const b = clone(F.board);
    const gv = b.gameView;
    Object.assign(gv, { activePlayerId: "player-0", priorityPlayerId: "player-0", step: "main1", stack: [] });
    const zoneOf = (kind, owner) => gv.zones.find((z) => z.zone === kind && z.ownerId === owner);
    for (const z of gv.zones) if (z.zone === "battlefield") z.cards = [];
    const card = { id: "engine-card-990", identity: { name: "Test Spell" }, types: ["Instant"], cmc: 1, manaCost: "{U}", color: "U", text, keywords: [] };
    zoneOf("hand", "player-0").cards.push(card);
    zoneOf("battlefield", "player-1").cards.push({ id: "engine-card-970", identity: { name: "Their Thing" }, types: theirTypes, text: "", controllerId: "player-1", keywords: [] });
    const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
    seat.slot = "player-0";
    seat.board = { state: clone(b), fingerprint: null };
    h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
      slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" }, started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
    return h.B.whyNot(seat, card.id);
  } finally { harness.restore(); }
}
let s = why("Destroy target artifact or enchantment.", ["Enchantment"]);
ok("target A or B: only a B on the table is no missing target", !/needs a target/.test(s), s);
s = why("Destroy target creature or planeswalker.", ["Planeswalker"]);
ok("target creature or planeswalker: only a planeswalker is no missing target", !/needs a target/.test(s), s);
s = why("Destroy target artifact.", ["Enchantment"]);
ok("target A alone: still said when none is out", /^Test Spell needs a target \(target artifact\), and there is none on the table\.$/.test(s), s);
process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} target-union checks pass\n`);
process.exit(failed ? 1 : 0);
