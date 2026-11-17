// Each plane's owner from the engine (our Forge build engine1117-planarowners: gameView.planar.ownerIds, plane id ->
// its owner's player id, Planechase.planarState), for rule 901.10's "<plane> leaves the game with <player>"
// (bridge.js logSnapshot / logEvents). The engine's word wins over the bridge's own tracking (the player who
// planeswalked to it, or a trigger's ownerId on the stack), which an engine without ownerIds still gets.
//   node tests/test_bridge_planar_owners.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const blank = () => ({ turn: 3, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
  zones: ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) });
const put = (b, zone, card, ownerId = "player-0") => { const z = b.zones.find((x) => x.zone === zone && x.ownerId === ownerId); z.cards.push(card); z.count = z.cards.length; };
const id = (n) => `engine-card-${n}`;
// (a plane card's ownerId in a board is its command zone's player, who controls it: it can't say who owns it)
const PLANE = (n, name, zoneOf = "player-0") => ({ id: id(n), identity: { name }, types: ["Plane"], ownerId: zoneOf, controllerId: zoneOf, text: "" });
const players = (b, p1 = {}) => { b.players = [{ id: "player-0", status: "playing" }, { id: "player-1", status: "playing", ...p1 }]; return b; };
function setup(h) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
}
const along = (boards) => {
  const h = harness.load();
  try {
    setup(h);
    const lines = [];
    let prev = null;
    for (const b of boards) {
      const snap = h.B.logSnapshot(b);
      if (prev) lines.push(...h.B.logEvents(prev, snap, b, h.B.engineFacts([])));
      prev = snap;
    }
    return lines;
  } finally { harness.restore(); }
};
// a board with one plane in play, its planar controller ctl, and (from the engine) its owner
const at = (ctl, owners) => {
  const b = players(blank());
  put(b, "command", PLANE(70, "Akoum", ctl), ctl);
  b.planar = { controllerId: ctl, planeIds: [id(70)], dieRollsThisTurn: 0, deckCounts: {}, ...(owners ? { ownerIds: owners } : {}) };
  return b;
};
// AI 1 out of the game, Blue planeswalks to Naya from its own planar deck
const toNaya = (owners) => {
  const b = players(blank(), { status: "lost" });
  put(b, "command", PLANE(71, "Naya"));
  b.planar = { controllerId: "player-0", planeIds: [id(71)], dieRollsThisTurn: 0, deckCounts: {}, ...(owners ? { ownerIds: owners } : {}) };
  return b;
};

(async () => {
  // Blue planeswalked to a plane from AI 1's planar deck (Interplanar Tunnel's pick, a debug planeswalk): the bridge's
  // tracking takes Blue as its owner; the engine says AI 1
  same("engine owner: a plane Blue walked to from AI 1's deck leaves with AI 1",
    along([players(blank()), at("player-0", { [id(70)]: "player-1" }), toNaya({ [id(71)]: "player-0" })]),
    ["Akoum leaves the game with AI 1; Blue planeswalks to Naya"]);
  // AI 1 walked to it first, then it moved on with the turn: the tracking says AI 1; the engine says Blue's
  same("engine owner: over the bridge's tracking (a plane of Blue's when AI 1 leaves is an ordinary planeswalk)",
    along([players(blank()), at("player-1", { [id(70)]: "player-0" }), at("player-0", { [id(70)]: "player-0" }), toNaya({ [id(71)]: "player-0" })]),
    ["Blue planeswalks to Naya (from Akoum)"]);
  // the engine's word from the board before the leave, when the board after it no longer has the plane
  same("engine owner: from the board the plane was last on",
    along([players(blank()), at("player-0", { [id(70)]: "player-1" }), toNaya()]),
    ["Akoum leaves the game with AI 1; Blue planeswalks to Naya"]);
  // an engine without ownerIds: the bridge's tracking, as before
  same("older engine: the tracking (who planeswalked to it)",
    along([players(blank()), at("player-1"), at("player-0"), toNaya()]),
    ["Akoum leaves the game with AI 1; Blue planeswalks to Naya"]);
  same("older engine: a plane of Blue's is an ordinary planeswalk",
    along([players(blank()), at("player-0"), toNaya()]),
    ["Blue planeswalks to Naya (from Akoum)"]);
  // the snapshot carries the engine's owners
  {
    const h = harness.load();
    setup(h);
    same("snapshot: the planar block keeps ownerIds", h.B.logSnapshot(at("player-0", { [id(70)]: "player-1" })).planar?.owners, { [id(70)]: "player-1" });
    harness.restore();
  }
  process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} planar owner checks pass\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL test_bridge_planar_owners: ${e.stack}\n`); process.exit(1); });
