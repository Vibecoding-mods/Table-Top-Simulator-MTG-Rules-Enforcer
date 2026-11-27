// Why players lost (LOSS_REASONS, lossReasons, gameEndWords): the poison and commander-damage limits are the engine's
// teamRules when it sends them (Two-Headed Giant: 15 poison, 42 commander damage), and a winner still playing is never
// named as a loser (2026-11-27). No TTS, no ports.
//   node tests/test_bridge_loss_reasons.js
const harness = require("./bridge-harness");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 300)}` : ""}\n`); } };
const h = harness.load();
try {
  h.B._setGame({ seats: new Map(), bots: 1, total: 2, playerOrder: [], slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  const board = (over) => ({ gameOver: true, winnerId: "player-0", players: [
    { id: "player-0", life: 20, status: "playing", counters: { POISON: 11 }, commanderDamage: {}, ...(over?.winner || {}) },
    { id: "player-1", life: 0, status: "lost", counters: {}, commanderDamage: {}, ...(over?.loser || {}) }], zones: [] });
  let s = h.B.gameEndWords(board({ winner: {} }));
  ok("a still-playing winner with 11 poison is not a loser", !/poison/.test(s || ""), s);
  s = h.B.gameEndWords({ ...board({}), teamRules: { rule: "life", poisonToLose: 15 }, players: [{ id: "player-0", life: 20, status: "lost", counters: { POISON: 11 }, commanderDamage: {} }, { id: "player-1", life: 20, status: "playing", counters: {}, commanderDamage: {} }], winnerId: "player-1" });
  ok("11 poison is under a team game's 15: not said", !/poison/.test(s || ""), s);
  s = h.B.gameEndWords({ ...board({}), players: [{ id: "player-0", life: 20, status: "lost", counters: { POISON: 10 }, commanderDamage: {} }, { id: "player-1", life: 20, status: "playing", counters: {}, commanderDamage: {} }], winnerId: "player-1" });
  ok("10 poison loses a normal game, said", /Blue has 10 poison counters/.test(s || ""), s);
  s = h.B.gameEndWords({ ...board({}), teamRules: { rule: "life", poisonToLose: 15 }, players: [{ id: "player-0", life: 20, status: "lost", counters: { POISON: 15 }, commanderDamage: {} }, { id: "player-1", life: 20, status: "playing", counters: {}, commanderDamage: {} }], winnerId: "player-1" });
  ok("15 poison loses a team game, said", /Blue has 15 poison counters/.test(s || ""), s);
  // the winner's teammate is no loser either; a loser the board still shows "playing" is named (2026-11-27)
  const team = (id, n, over) => ({ id, life: 20, status: "playing", teamNumber: n, counters: {}, commanderDamage: {}, ...over });
  s = h.B.gameEndWords({ gameOver: true, winnerId: "player-0", teamRules: { rule: "sharedLife", poisonToLose: 15 }, zones: [], players: [
    team("player-0", 1), team("player-1", 2, { life: 0, status: "lost" }), team("player-2", 1, { commanderDamage: { c9: 21 } }), team("player-3", 2, { life: 0, status: "lost" })] });
  ok("the winner's teammate with 21 commander damage is not a loser", !/commander/.test(s || "") && /is at 0 life/.test(s || ""), s);
  s = h.B.gameEndWords(board({ loser: { status: "playing" } }));
  ok("a loser the board still shows playing is named", /AI 1 is at 0 life/.test(s || ""), s);
} finally { harness.restore(); }
process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} loss reason checks pass\n`);
process.exit(failed ? 1 : 0);
