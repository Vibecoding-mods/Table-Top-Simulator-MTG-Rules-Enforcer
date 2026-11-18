// The game log's life line in a shared-life game (bridge.js logEvents; live 2HG check 2026-11-18): every partner's row shows
// the team's one total (CR 810.4), so a team that lost 6 read "White: 80 -> 74 life (-6)" and "AI 1: 80 -> 74 life (-6,
// Reanimate)", as if 12 were lost. In Two-Headed Giant and Three-Headed Giant it is one line for the team, its cause kept:
// "White + AI 1: 80 -> 74 life (-6, Reanimate)". Free-for-all and 2v2 (teams that don't share life) keep a line a player.
//   node tests/test_bridge_team_life_log.js
// (BRIDGE_PATH=<a copy> tests a copy: tools/mutate-team-life-log.js breaks one so a check fails by name.)
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const NAMES = ["White", "AI 1", "Yellow", "Blue", "Green", "Purple"];
const COLORS = ["White", "Red", "Yellow", "Blue", "Green", "Purple"];
// rule: "sharedLife" (2HG, 3HG), "sharedTurns" (2HG Level 2), "teams" (2v2: own life), or null (free-for-all);
// size: the team size (2 or 3); life: each player's life
function board(life, rule, size, fill) {
  const ids = life.map((_, i) => `player-${i}`);
  const b = { turn: 3, step: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1", stack: [],
    players: ids.map((id, i) => ({ id, life: life[i], ...(rule ? { teamNumber: Math.floor(i / size) + 1 } : {}) })),
    zones: ids.flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) };
  if (rule) b.teamRules = { rule, poisonToLose: size === 3 ? 20 : 15 };
  if (fill) fill(b);
  return b;
}
const put = (b, zone, card, ownerId) => { const z = b.zones.find((x) => x.zone === zone && x.ownerId === ownerId); z.cards.push(card); z.count = z.cards.length; };
const spell = (n, name, text, ctl = "player-1") => ({ id: `engine-stack-${n}`, sourceId: `engine-card-${n}`, controllerId: ctl, ownerId: ctl, identity: { name },
  sourceAbilityText: text, text: `${name} (${n}) - ${text}` });
const card = (n, name, ctl = "player-1") => ({ id: `engine-card-${n}`, identity: { name }, types: ["Sorcery"], controllerId: ctl, ownerId: ctl });

// the life lines between two boards, with the spell resolving (its card from the stack to the graveyard)
function lifeLines(seats, before, after, n, ctl = "player-1", cmd = null) {
  const h = harness.load();
  try {
    const slotNames = {}, slotColor = {};
    for (let i = 0; i < seats; i++) { slotNames[`player-${i}`] = NAMES[i]; slotColor[`player-${i}`] = COLORS[i]; }
    h.B._setGame({ seats: new Map(), bots: 0, total: seats, playerOrder: [], slotNames, slotColor, started: true, closing: false, fromTable: true,
      sentStatic: {}, sentZones: {}, eventSeq: 10 });
    const facts = h.B.engineFacts(n ? [{ seq: 11, cardId: `engine-card-${n}`, from: "Stack", to: "Graveyard", ownerId: ctl }] : []);
    const a = h.B.logSnapshot(before), b = h.B.logSnapshot(after);
    if (cmd) { a.cmd = cmd.before; b.cmd = cmd.after; }
    return h.B.logEvents(a, b, after, facts).filter((l) => / life \(/.test(l));
  } finally { harness.restore(); }
}

const WHISPER = [206, "Night's Whisper", "You draw two cards and you lose 2 life."];
const EACH = [207, "Test Drain (each player)", "Each player loses 1 life."];
const resolving = (spec, ctl = "player-1") => (b) => b.stack.push(spell(spec[0], spec[1], spec[2], ctl));
const resolved = (spec, ctl = "player-1") => (b) => put(b, "graveyard", card(spec[0], spec[1], ctl), ctl);

// Two-Headed Giant: one line for the team, the cause kept
same("2HG: a shared loss is one team line, its cause kept",
  lifeLines(4, board([30, 30, 30, 30], "sharedLife", 2, resolving(WHISPER)), board([28, 28, 30, 30], "sharedLife", 2, resolved(WHISPER)), 206),
  ["White + AI 1: 30 -> 28 life (-2, Night's Whisper)"]);
same("2HG Level 2 (shared turns): one team line too",
  lifeLines(4, board([30, 30, 30, 30], "sharedTurns", 2, resolving(WHISPER)), board([28, 28, 30, 30], "sharedTurns", 2, resolved(WHISPER)), 206),
  ["White + AI 1: 30 -> 28 life (-2, Night's Whisper)"]);
// (each partner losing 1 is the team's 2: one source's 1 explains neither row, so no cause, as before this change; one
// team line each, not four)
same("2HG: both teams losing is one line for each team, not one for each player",
  lifeLines(4, board([30, 30, 30, 30], "sharedLife", 2, resolving(EACH)), board([28, 28, 28, 28], "sharedLife", 2, resolved(EACH)), 207),
  ["White + AI 1: 30 -> 28 life (-2)", "Yellow + Blue: 30 -> 28 life (-2)"]);
same("2HG: a gain is one team line too",
  lifeLines(4, board([30, 30, 30, 30], "sharedLife", 2), board([30, 30, 33, 33], "sharedLife", 2)),
  ["Yellow + Blue: 30 -> 33 life (+3)"]);
same("2HG: partners whose rows don't show the same change keep their own lines",
  lifeLines(4, board([30, 30, 30, 30], "sharedLife", 2), board([28, 29, 30, 30], "sharedLife", 2)),
  ["White: 30 -> 28 life (-2)", "AI 1: 30 -> 29 life (-1)"]);
const cmd = { before: { "player-0": {} }, after: { "player-0": { "engine-card-301": 5 } } };
ok("2HG: commander damage still on the team's line",
  ((l) => l.length === 1 && /^White \+ AI 1: 30 -> 25 life \(-5\); commander damage from .*: 5 in all$/.test(l[0]))(
    lifeLines(4, board([30, 30, 30, 30], "sharedLife", 2), board([25, 25, 30, 30], "sharedLife", 2), null, "player-1", cmd)),
  JSON.stringify(lifeLines(4, board([30, 30, 30, 30], "sharedLife", 2), board([25, 25, 30, 30], "sharedLife", 2), null, "player-1", cmd)));

// Three-Headed Giant: three partners on one line
same("3HG: a shared loss is one line for the three partners",
  lifeLines(6, board([45, 45, 45, 45, 45, 45], "sharedLife", 3, resolving(WHISPER)), board([43, 43, 43, 45, 45, 45], "sharedLife", 3, resolved(WHISPER)), 206),
  ["White + AI 1 + Yellow: 45 -> 43 life (-2, Night's Whisper)"]);

// no shared life: a line a player, as before
same("free-for-all: a line a player",
  lifeLines(4, board([40, 40, 40, 40], null, 2, resolving(EACH)), board([39, 39, 39, 39], null, 2, resolved(EACH)), 207),
  ["White: 40 -> 39 life (-1, Test Drain (each player))", "AI 1: 40 -> 39 life (-1, Test Drain (each player))",
    "Yellow: 40 -> 39 life (-1, Test Drain (each player))", "Blue: 40 -> 39 life (-1, Test Drain (each player))"]);
same("2v2 (teams with their own life): a line a player",
  lifeLines(4, board([20, 20, 20, 20], "teams", 2, resolving(EACH)), board([19, 19, 19, 19], "teams", 2, resolved(EACH)), 207),
  ["White: 20 -> 19 life (-1, Test Drain (each player))", "AI 1: 20 -> 19 life (-1, Test Drain (each player))",
    "Yellow: 20 -> 19 life (-1, Test Drain (each player))", "Blue: 20 -> 19 life (-1, Test Drain (each player))"]);

process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} team life log checks pass\n`);
process.exit(failed ? 1 : 0);
