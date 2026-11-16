// How long the bridge takes with a huge token board (docs/big-turns.md, the Scute Swarm turn of 2026-11-15): for N
// identical Scute Swarm tokens and a stack of landfall triggers, the time of the bridge's own work per engine step:
//  - patch: applying the engine's stateDelta (two new tokens, the top trigger gone) to the held board
//  - log: the game log's diff of two boards (logSnapshot + logEvents)
//  - table: building and sending the table message (sendTable), and its size in bytes
//  - prompt: a priority question with the run on the stack, answered by "Resolve all" (onPrompt)
// A measurement, not a gate: it prints a table and exits 0.
//   node tests/bench_big_board.js [200,1000,3000]
const harness = require("./bridge-harness");
const delta = require("../bridge/state-delta");

const sizes = (process.argv[2] || "100,300,1000,3000").split(",").map(Number);
const LANDFALL = "Landfall — Whenever a land you control enters, create a token that's a copy of Scute Swarm.";
const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const hr = () => Number(process.hrtime.bigint()) / 1e6;
const blank = () => ({ turn: 9, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
  players: [{ id: "player-0", life: 40, manaPool: {} }, { id: "player-1", life: 40, manaPool: {} }],
  zones: ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) });
const token = (n) => ({ id: `engine-card-${n}`, identity: { name: "Scute Swarm", isToken: true }, types: ["Creature"], subtypes: ["Insect"], power: 1, toughness: 1,
  controllerId: "player-0", ownerId: "player-0", text: LANDFALL, colors: ["G"] });
const trig = (n, src) => ({ id: `engine-stack-${n}`, sourceId: src, controllerId: "player-0", ownerId: "player-0", identity: { name: "Scute Swarm", isToken: true },
  isTrigger: true, sourceAbilityText: LANDFALL, targets: [], text: `Scute Swarm (${src.replace(/\D/g, "")}) - ${LANDFALL}` });
function board(n, run) {
  const gv = blank();
  const bf = gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
  for (let k = 0; k < n; k++) bf.cards.push(token(1000 + k));
  bf.count = bf.cards.length;
  gv.stack = Array.from({ length: run }, (_, k) => trig(k, `engine-card-${1000 + k}`));
  return gv;
}

(async () => {
  const rows = [];
  for (const n of sizes) {
    const h = harness.load();
    try {
      const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
      seat.slot = "player-0";
      const gv = board(n, Math.min(n, 200));
      seat.board = { state: { gameView: gv }, fingerprint: null };
      h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
        slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
        started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
      seat.respond = () => {};
      h.B.sendTable(); await h.flush(); // (the first board: every card's details)
      const first = h.effects.filter((e) => e.tts).map((e) => e.tts.t + ":" + JSON.stringify(e.tts).length).join(" "); if (process.env.SHOW) process.stdout.write(`${n} first: ${first}\n`);
      const patch = { gameView: { stack: { $d: [gv.stack.at(-1).id] }, zones: { $k: { "battlefield/player-0": { cards: { $k: { [`engine-card-${9000}`]: token(9000), [`engine-card-${9001}`]: token(9001) } }, count: n + 2 } } } } };
      let t = hr();
      const next = delta.apply(seat.board.state, patch);
      const patchMs = hr() - t;
      t = hr();
      const lines = h.B.logEvents(h.B.logSnapshot(gv), h.B.logSnapshot(next.gameView), next.gameView, h.B.engineFacts([]));
      const logMs = hr() - t;
      seat.board = { state: next, fingerprint: null };
      const before = h.effects.length;
      t = hr();
      h.B.sendTable(); await h.flush();
      const tableMs = hr() - t;
      const sent = h.effects.slice(before).filter((e) => e.tts);
      const bytes = sent.reduce((s, e) => s + JSON.stringify(e.tts).length, 0);
      const prompt = { promptId: 77, decidingPlayerId: "player-0", input: { type: "chooseAction", actions: [], presentation: { title: "Your priority" } } };
      t = hr();
      h.B.onPrompt(seat, prompt); await h.flush();
      const promptMs = hr() - t;
      const after = h.effects.slice(before).filter((e) => e.tts); const allBytes = after.reduce((s, e) => s + JSON.stringify(e.tts).length, 0); const kinds = after.map((e) => e.tts.t + ":" + JSON.stringify(e.tts).length).join(" ");
      rows.push({ tokens: n, stack: gv.stack.length, patchMs: +patchMs.toFixed(1), logMs: +logMs.toFixed(1), logLines: lines.length, tableMs: +tableMs.toFixed(1), tableBytes: bytes, promptMs: +promptMs.toFixed(1), allBytes, kinds });
    } finally { harness.restore(); }
  }
  console.table(rows);
})();
