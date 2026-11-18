// The Mairsil hand test's bridge findings in the "Placement and look" group (docs/HAND-TEST-MAIRSIL.md): what the
// table is sent for them, from a board fed straight to sendTable.
//   node tests/test_bridge_mairsil_look.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const SLOTS = ["player-0", "player-1", "player-2"];
const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const blank = () => ({ turn: 3, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
  players: SLOTS.map((id) => ({ id, life: 40, status: "playing" })),
  zones: SLOTS.flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) });
const card = (n, name, types, ctl, extra = {}) => ({ id: `engine-card-${n}`, identity: { name }, types, controllerId: ctl, ownerId: ctl, visibility: "visible", ...extra });
const put = (b, zone, c) => { const z = b.zones.find((x) => x.zone === zone && x.ownerId === c.ownerId); z.cards.push(c); z.count = z.cards.length; };

// the table message's battlefield cards by id
async function tableOf(fill) {
  const b = blank();
  fill(b);
  const h = harness.load();
  try {
    const seat = new h.B.Seat("White", "neheb_minotaur_commander");
    seat.slot = "player-0";
    seat.board = { state: { gameView: b }, fingerprint: null };
    h.B._setGame({ seats: new Map([["White", seat]]), bots: 2, total: 3, playerOrder: ["tts-White-ab12", "bot-1", "bot-2"],
      slotNames: { "player-0": "White", "player-1": "AI 1", "player-2": "AI 2" }, slotColor: { "player-0": "White", "player-1": "Blue", "player-2": "Red" },
      started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
    h.B.sendTable(); await h.flush();
    const t = h.effects.filter((e) => e.tts && e.tts.t === "table").map((e) => e.tts)[0] || { players: [] };
    return Object.fromEntries(t.players.flatMap((p) => p.battlefield || []).map((c) => [c.id, c]));
  } finally { harness.restore(); }
}
const goad = (c) => (c?.kw || []).filter((k) => /^Goaded/.test(k));

(async () => {
  // 9: static goad. An Impetus aura (its controller AI 2, on AI 1's creature) and a Mark of the Rani token (White's, on
  // AI 2's creature) goad their creature by their controller; a Mocking Doppelganger's copy goads the others of its
  // name, everyone's; the Doppelganger that copied nothing goads nothing; an aura without the words goads nothing.
  const IMPETUS = "Enchant creature\nEnchanted creature gets +1/+1 and is goaded. (It attacks each combat if able and attacks a player other than you if able.)\nWhenever enchanted creature attacks, you draw a card and lose 1 life.";
  const RANI = "Enchant creature\nEnchanted creature gets +2/+2 and is goaded.";
  const MOCK = "You may have Mocking Doppelganger enter as a copy of a creature an opponent controls, except it has \"Other creatures with the same name as this creature are goaded.\"";
  const cards = await tableOf((b) => {
    put(b, "battlefield", card(1, "Craw Wurm", ["Creature"], "player-1", { attachmentIds: ["engine-card-2"] }));
    put(b, "battlefield", card(2, "Coercive Impetus", ["Enchantment"], "player-2", { attachedTo: "engine-card-1", text: IMPETUS }));
    put(b, "battlefield", card(3, "Grizzly Bears", ["Creature"], "player-2", { attachmentIds: ["engine-card-4"] }));
    put(b, "battlefield", card(4, "Mark of the Rani", ["Enchantment"], "player-0", { attachedTo: "engine-card-3", text: RANI, identity: { name: "Mark of the Rani", isToken: true } }));
    put(b, "battlefield", card(5, "Serra Angel", ["Creature"], "player-0", { isCopy: true, text: "Flying, vigilance\nOther creatures with the same name as this creature are goaded." }));
    put(b, "battlefield", card(6, "Serra Angel", ["Creature"], "player-1"));
    put(b, "battlefield", card(7, "Serra Angel", ["Creature"], "player-2"));
    put(b, "battlefield", card(8, "Mocking Doppelganger", ["Creature"], "player-1", { text: MOCK }));
    put(b, "battlefield", card(9, "Mocking Doppelganger", ["Creature"], "player-2", { text: MOCK }));
    put(b, "battlefield", card(10, "Llanowar Elves", ["Creature"], "player-2", { attachmentIds: ["engine-card-11"] }));
    put(b, "battlefield", card(11, "Pacifism", ["Enchantment"], "player-0", { attachedTo: "engine-card-10", text: "Enchant creature\nEnchanted creature can't attack or block." }));
  });
  ok("precondition 9: the board reached the table", Object.keys(cards).length === 11, Object.keys(cards).join(","));
  same("9 static goad: an Impetus aura goads its creature by the aura's controller", goad(cards["engine-card-1"]), ["Goaded by AI 2"]);
  same("9 static goad: a Mark of the Rani token goads its creature by its controller", goad(cards["engine-card-3"]), ["Goaded by White"]);
  same("9 static goad: a Mocking Doppelganger copy goads the other creatures of its name", [goad(cards["engine-card-6"]), goad(cards["engine-card-7"])], [["Goaded by White"], ["Goaded by White"]]);
  same("9 static goad: the copy itself isn't goaded", goad(cards["engine-card-5"]), []);
  same("9 static goad: a Doppelganger that copied nothing goads nothing", [goad(cards["engine-card-8"]), goad(cards["engine-card-9"])], [[], []]);
  same("9 static goad: an aura without the words goads nothing", goad(cards["engine-card-10"]), []);

  // 5, 6: caged cards. Forge's exiledWith names the original Mairsil for a card its copy caged, and a Mairsil that left;
  // the card lies under a permanent that has its abilities now, and says who has them
  const MAIRSIL = "When Mairsil, the Pretender enters, you may exile an artifact or creature card from your hand or graveyard and put a cage counter on it.\nMairsil, the Pretender has all activated abilities of all cards you own in exile with cage counters on them. You may activate each of those abilities only once each turn.";
  const exileOf = async (fill) => {
    const b = blank();
    fill(b);
    const h = harness.load();
    try {
      const seat = new h.B.Seat("White", "neheb_minotaur_commander");
      seat.slot = "player-0";
      seat.board = { state: { gameView: b }, fingerprint: null };
      h.B._setGame({ seats: new Map([["White", seat]]), bots: 2, total: 3, playerOrder: ["tts-White-ab12", "bot-1", "bot-2"],
        slotNames: { "player-0": "White", "player-1": "AI 1", "player-2": "AI 2" }, slotColor: { "player-0": "White", "player-1": "Blue", "player-2": "Red" },
        started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
      h.B.sendTable(); await h.flush();
      const t = h.effects.filter((e) => e.tts && e.tts.t === "table").map((e) => e.tts)[0] || { players: [] };
      return Object.fromEntries(t.players.flatMap((p) => p.exile || []).map((c) => [c.id, c]));
    } finally { harness.restore(); }
  };
  const caged = (n, host, extra = {}) => card(n, "Kiki-Jiki, Mirror Breaker", ["Creature"], "player-0", { exiledWith: host, counters: { Cage: 1 }, ...extra });
  const cageNote = (c) => (c?.nt || []).filter((x) => /^Caged/.test(x));
  {
    // the original in the command zone, its copy (Spark Double) on the battlefield: the card lies under the copy
    const ex = await exileOf((b) => {
      put(b, "command", card(20, "Mairsil, the Pretender", ["Creature"], "player-0", { text: MAIRSIL }));
      put(b, "battlefield", card(21, "Mairsil, the Pretender", ["Creature"], "player-0", { text: MAIRSIL, isCopy: true }));
      put(b, "exile", caged(22, "engine-card-20"));
      put(b, "exile", card(23, "Grizzly Bears", ["Creature"], "player-0", { exiledWith: "engine-card-20" }));
    });
    same("5 cage: a caged card whose Mairsil left lies under the copy that has its abilities", ex["engine-card-22"]?.ew, "engine-card-21");
    same("6 cage: it says who has its abilities", cageNote(ex["engine-card-22"]), ["Caged: Mairsil, the Pretender has its activated abilities"]);
    same("5 cage: a plain exiled card keeps Forge's link", ex["engine-card-23"]?.ew, "engine-card-20");
  }
  {
    // both on the battlefield: Forge's own link stands; the note names both
    const ex = await exileOf((b) => {
      put(b, "battlefield", card(20, "Mairsil, the Pretender", ["Creature"], "player-0", { text: MAIRSIL }));
      put(b, "battlefield", card(21, "Mairsil, the Pretender", ["Creature"], "player-0", { text: MAIRSIL, isCopy: true }));
      put(b, "exile", caged(22, "engine-card-20"));
    });
    same("5 cage: Forge's link stands while that Mairsil has the abilities", ex["engine-card-22"]?.ew, "engine-card-20");
    same("6 cage: two Mairsils, each has them", cageNote(ex["engine-card-22"]), ["Caged: each Mairsil, the Pretender has its activated abilities"]);
  }
  {
    // no Mairsil: in exile, and it says so; another player's Mairsil doesn't have them (cards YOU own)
    const ex = await exileOf((b) => {
      put(b, "battlefield", card(30, "Mairsil, the Pretender", ["Creature"], "player-1", { text: MAIRSIL }));
      put(b, "exile", caged(22, "engine-card-20"));
    });
    same("6 cage: with no Mairsil of its owner's it says nothing has them", [ex["engine-card-22"]?.ew, cageNote(ex["engine-card-22"])], ["engine-card-20", ["Caged: nothing on the battlefield has its activated abilities now"]]);
  }

  process.stdout.write(`${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL test_bridge_mairsil_look: ${e && e.stack || e}\n`); process.exit(1); });
