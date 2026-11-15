// Builds tests/golden/fixtures/2hg-level2-protocol.json: the boards and questions a Two-Headed Giant game with real
// shared team turns (CR 805 + 810, engine teamRules "sharedTurns") is EXPECTED to send each seat, hand-built from the
// current view schema (gameView as InteractiveSnapshotExtractor writes it, prompts as manabrew-protocol defines them),
// so the bridge and table can be built against it before the engine work lands. status "expected": once the engine's
// shared turns and team combat land, record a real game over the same script and replace this file (keep the shape).
// Seats: player-0 White + player-1 Red are team 1 (White its first seat), player-2 Yellow + player-3 Blue are team 2.
// usage: node tests/make_2hg_level2_fixture.js            (writes the fixture)
//        node tests/make_2hg_level2_fixture.js --check    (exit 1 if the file on disk differs from what this builds)
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "golden", "fixtures", "2hg-level2-protocol.json");
const SEATS = ["player-0", "player-1", "player-2", "player-3"];
const NAMES = { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" };
const TEAM = { "player-0": 1, "player-1": 1, "player-2": 2, "player-3": 2 };
const TEAMS = { 1: ["player-0", "player-1"], 2: ["player-2", "player-3"] };
const partner = (s) => TEAMS[TEAM[s]].find((p) => p !== s);

const CARDS = {
  Forest: { cmc: 0, color: "", manaCost: "no cost", types: ["Land"], subtypes: ["Forest"], supertypes: ["Basic"], text: "({T}: Add {G}.)", power: null, toughness: null, keywords: [] },
  Mountain: { cmc: 0, color: "", manaCost: "no cost", types: ["Land"], subtypes: ["Mountain"], supertypes: ["Basic"], text: "({T}: Add {R}.)", power: null, toughness: null, keywords: [] },
  "Grizzly Bears": { cmc: 2, color: "G", manaCost: "{1}{G}", types: ["Creature"], subtypes: ["Bear"], supertypes: [], text: "", power: "2", toughness: "2", keywords: [] },
  Juggernaut: { cmc: 4, color: "", manaCost: "{4}", types: ["Artifact", "Creature"], subtypes: ["Juggernaut"], supertypes: [], text: "Juggernaut attacks each combat if able.\nJuggernaut can't be blocked by Walls.", power: "5", toughness: "3", keywords: [] },
  "Hill Giant": { cmc: 4, color: "R", manaCost: "{3}{R}", types: ["Creature"], subtypes: ["Giant"], supertypes: [], text: "", power: "3", toughness: "3", keywords: [] },
};

let nextId = 1;
const cards = {};
function make(name, owner, zone, extra = {}) {
  const t = CARDS[name];
  const id = `engine-card-${nextId++}`;
  cards[id] = {
    choices: [], classLevels: [], cmc: t.cmc, color: t.color, controllerId: owner, counters: {}, damage: 0, exerted: false, id,
    identity: { cardNumber: "1", isToken: false, name, setCode: "M10" }, isBestowed: false, isDoubleFaced: false, isFaceDown: false,
    isTransformed: false, keywords: t.keywords, manaCost: t.manaCost, ownerId: owner, phasedOut: false, power: t.power,
    ...(t.power !== null ? { basePower: Number(t.power), baseToughness: Number(t.toughness), printedPower: Number(t.power), printedToughness: Number(t.toughness) } : {}),
    sagaChapters: [], subtypes: t.subtypes, summoningSick: zone !== "battlefield", supertypes: t.supertypes, tapped: false, text: t.text,
    toughness: t.toughness, types: t.types, visibility: "visible", zone, ...extra,
  };
  return id;
}

const state = { turn: 1, step: "upkeep", active: "player-0", priority: "player-0", life: { 1: 30, 2: 30 }, landsPlayed: {}, drawn: {}, events: [], combat: [], checkpoints: [], lib: {} };
for (const s of SEATS) { state.landsPlayed[s] = 0; state.drawn[s] = 0; state.lib[s] = 33; }
const hand = {};
for (const s of SEATS) hand[s] = [make(TEAM[s] === 1 ? "Forest" : "Mountain", s, "hand"), make(TEAM[s] === 1 ? "Forest" : "Mountain", s, "hand"), make("Grizzly Bears", s, "hand"), make("Hill Giant", s, "hand"), make("Grizzly Bears", s, "hand"), make("Hill Giant", s, "hand"), make(TEAM[s] === 1 ? "Forest" : "Mountain", s, "hand")];
const bears = make("Grizzly Bears", "player-0", "battlefield");
const jugg = make("Juggernaut", "player-1", "battlefield");
const yellowBears = make("Grizzly Bears", "player-2", "battlefield");
const blueGiant = make("Hill Giant", "player-3", "battlefield");
let eventSeq = 0;
const event = (e) => state.events.push({ id: `event-${++eventSeq}`, seq: eventSeq, ...e });
const moveTo = (id, zone) => { cards[id].zone = zone; };

function player(s) {
  return {
    activeSchemeNames: null, cardsDrawnThisTurn: state.drawn[s], commanderCasts: {}, commanderDamage: {}, completedDungeons: [], controlledBy: null,
    counters: {}, damagePrevention: 0, dungeonState: null, extraTurnCount: 0, hasCityBlessing: false, hasEnduringStory: false, id: s,
    isExtraTurn: false, isHuman: true, landsPlayedThisTurn: state.landsPlayed[s], life: state.life[TEAM[s]], manaPool: { B: 0, C: 0, G: 0, R: 0, U: 0, W: 0 },
    maxHandSize: 7, maxLandPlaysPerTurn: 1, name: NAMES[s], playerKeywords: [], ringLevel: 0, speed: 0, status: "playing", teamNumber: TEAM[s],
    unlimitedHandSize: false, unlimitedLandPlays: false,
  };
}

function view(viewer) {
  const zones = [];
  const seesHand = (owner) => owner === viewer || owner === partner(viewer);
  for (const s of SEATS) {
    for (const zone of ["hand", "graveyard", "exile", "command", "library", "battlefield"]) {
      const inZone = Object.values(cards).filter((c) => c.ownerId === s && c.zone === zone);
      const hidden = zone === "library" || (zone === "hand" && !seesHand(s));
      const shown = hidden ? [] : inZone.map((c) => {
        const { zone: _z, ...dto } = c;
        const atk = state.combat.find((a) => a.attackerId === c.id);
        return atk ? { ...dto, attackTargetId: atk.targetId, attackingPlayerId: atk.targetId, isAttacking: true } : dto;
      });
      zones.push({ cards: shown, count: zone === "library" ? state.lib[s] : inZone.length, ownerId: s, zone });
    }
  }
  const blocks = state.combat.flatMap((a) => (a.blockers || []).map((b) => ({ blockerId: b, attackerId: a.attackerId })));
  return {
    gameView: {
      activePlaneNames: null, activePlayerId: state.active, activeTeamIds: TEAMS[TEAM[state.active]].slice(), checkpoints: state.checkpoints.slice(-4),
      combatAssignments: blocks, dayTime: "neither", events: state.events.slice(-8), gameId: "2hg-level2-expected", gameOver: false,
      initiativeHolderId: null, monarchId: null, players: SEATS.map(player), priorityPlayerId: state.priority, priorityTeamIds: TEAMS[TEAM[state.priority]].slice(),
      restoreVote: null, snapshotRecording: true, stack: [], step: state.step, stormCount: 0,
      teamRules: { rule: "sharedTurns", poisonToLose: 15 }, turn: state.turn, winnerId: null, zones,
    },
  };
}

const record = [];
let promptId = 0;
const note = (text) => record.push({ note: text });
// partners see the same board (CR 810.5: each sees the other's hand), so one board per team, for both its seats
const boards = (why) => { for (const t of [1, 2]) record.push({ seats: TEAMS[t].slice(), step: why, board: view(TEAMS[t][0]) }); };
function ask(seat, input, why) {
  const p = { decidingPlayerId: seat, input, promptId: ++promptId };
  record.push({ seat, step: why, prompt: p });
  return p;
}
const answer = (seat, p, output) => record.push({ seat, answer: { promptId: p.promptId, type: p.input.type, output } });
function actions(seat) {
  const out = [];
  const lands = state.landsPlayed[seat] === 0 && (state.step === "main1" || state.step === "main2") && TEAMS[TEAM[state.active]].includes(seat);
  for (const id of hand[seat]) {
    if (lands && cards[id].types.includes("Land")) out.push({ cardId: id, id: `prompt-action-${out.length}`, label: `Play ${cards[id].identity.name}`, mode: { type: "normal" }, type: "cast" });
  }
  return out;
}
function priorityRound(why, plays = {}) {
  const team = TEAMS[TEAM[state.active]];
  const other = TEAMS[3 - TEAM[state.active]];
  for (const s of team) {
    state.priority = s;
    const acts = actions(s);
    const p = ask(s, { actions: acts, type: "chooseAction" }, why);
    if (plays[s] && acts.length) {
      const land = acts[0];
      answer(s, p, { type: "act", actionId: land.id });
      hand[s] = hand[s].filter((id) => id !== land.cardId);
      moveTo(land.cardId, "battlefield");
      cards[land.cardId].summoningSick = false;
      state.landsPlayed[s]++;
      event({ cardId: land.cardId, from: "Hand", ownerId: s, to: "Battlefield" });
      boards(`${why}: ${NAMES[s]} played a land`);
      const again = ask(s, { actions: actions(s), type: "chooseAction" }, `${why}: ${NAMES[s]} keeps priority after acting (CR 117.3c)`);
      answer(s, again, { type: "pass" });
    } else {
      answer(s, p, { type: "pass" });
    }
  }
  if (Object.keys(plays).some((s) => team.indexOf(s) === 1)) {
    state.priority = team[0];
    const back = ask(team[0], { actions: actions(team[0]), type: "chooseAction" }, `${why}: ${NAMES[team[1]]} acted, so ${NAMES[team[0]]} is asked again before the team passes (CR 805.5b)`);
    answer(team[0], back, { type: "pass" });
  }
  for (const s of other) {
    state.priority = s;
    answer(s, ask(s, { actions: [], type: "chooseAction" }, `${why}: the nonactive team gets priority once the active team passed`), { type: "pass" });
  }
  state.priority = team[0];
}
function step(name) {
  state.step = name;
  state.priority = state.active;
  state.checkpoints.push({ activePlayerId: state.active, checkpointId: state.checkpoints.length + 1, step: name, turn: state.turn });
}
function newTurn(turn, lead) {
  state.turn = turn;
  state.active = lead;
  for (const s of SEATS) { state.landsPlayed[s] = 0; state.drawn[s] = 0; }
  for (const c of Object.values(cards)) if (c.zone === "battlefield" && TEAMS[TEAM[lead]].includes(c.controllerId)) { c.tapped = false; c.summoningSick = false; }
  state.combat = [];
}
function draws() {
  for (const s of TEAMS[TEAM[state.active]]) {
    const id = make(TEAM[s] === 1 ? "Forest" : "Mountain", s, "hand");
    hand[s].push(id);
    state.lib[s]--;
    state.drawn[s] = 1;
    event({ cardId: id, from: "Library", how: "draw", ownerId: s, to: "Hand" });
  }
}

note("Turn 1, team 1 (White + Red) is the starting team: both untap, neither draws (CR 810.6), both may play a land (CR 805.4c).");
newTurn(1, "player-0");
step("upkeep");
boards("turn 1 begins: White's team is active (activePlayerId is the team's first seat, activeTeamIds both)");
step("main1");
boards("turn 1 main 1: no draw step for the starting team (CR 810.6)");
priorityRound("turn 1 main 1", { "player-0": true, "player-1": true });
step("endOfTurn");
note("Turn 2, team 2 (Yellow + Blue): both draw in the draw step, the active team in turn order (CR 805.4b, 805.6a).");
newTurn(2, "player-2");
step("upkeep");
boards("turn 2 begins: the next turn goes to the other team, not to Red (CR 805.4)");
step("draw");
draws();
boards("turn 2 draw: Yellow and Blue each drew one card");
step("main1");
priorityRound("turn 2 main 1", { "player-2": true, "player-3": true });
note("Turn 3, team 1 again: both draw; one combined attack declared by each partner for their own creatures (CR 805.10a-b).");
newTurn(3, "player-0");
step("upkeep");
step("draw");
draws();
step("main1");
boards("turn 3 main 1: White and Red each drew");
priorityRound("turn 3 main 1");
step("combatDeclareAttackers");
const targets = [{ id: "player-2", kind: "player", label: "Yellow" }, { id: "player-3", kind: "player", label: "Blue" }];
const atkWhite = ask("player-0", { attackTargets: targets, attackers: [{ attackerId: bears, costs: [], mustAttack: false, validTargetIds: ["player-2", "player-3"] }], limits: [], type: "chooseAttackers", unavailable: [] },
  "turn 3 declare attackers: White declares her own creatures' attacks (part of the team's one combined attack)");
answer("player-0", atkWhite, { type: "declareAttackers", assignments: [{ attackerId: bears, targetId: "player-2" }] });
state.combat.push({ attackerId: bears, targetId: "player-2", blockers: [] });
cards[bears].tapped = true;
const atkRed = ask("player-1", { attackTargets: targets, attackers: [{ attackerId: jugg, costs: [], mustAttack: true, validTargetIds: ["player-2", "player-3"] }], limits: [], type: "chooseAttackers", unavailable: [] },
  "turn 3 declare attackers: Red declares hers; Juggernaut must attack (CR 805.10b: the combined attack is checked as a whole)");
answer("player-1", atkRed, { type: "declareAttackers", assignments: [{ attackerId: jugg, targetId: "player-3" }] });
state.combat.push({ attackerId: jugg, targetId: "player-3", blockers: [] });
cards[jugg].tapped = true;
boards("turn 3 attackers declared: White's Bears attack Yellow, Red's Juggernaut attacks Blue, one combined attack");
priorityRound("turn 3 declare attackers step");
step("combatDeclareBlockers");
const attackersForBlock = [{ attackerId: bears, mustBeBlocked: false, minBlockers: 1, validBlockerIds: [yellowBears, blueGiant] }, { attackerId: jugg, mustBeBlocked: false, minBlockers: 1, validBlockerIds: [yellowBears, blueGiant] }];
const blkYellow = ask("player-2", { attackers: attackersForBlock.map((a) => ({ ...a, validBlockerIds: [yellowBears] })), availableBlockerIds: [yellowBears], type: "chooseBlockers" },
  "turn 3 declare blockers: Yellow may block either attacker, the one at Blue too (CR 805.10d)");
answer("player-2", blkYellow, { type: "declareBlockers", assignments: [] });
const blkBlue = ask("player-3", { attackers: attackersForBlock.map((a) => ({ ...a, validBlockerIds: [blueGiant] })), availableBlockerIds: [blueGiant], type: "chooseBlockers" },
  "turn 3 declare blockers: Blue blocks the Bears attacking her partner Yellow (CR 805.10d: one combined block)");
answer("player-3", blkBlue, { type: "declareBlockers", assignments: [{ blockerId: blueGiant, attackerId: bears }] });
state.combat[0].blockers.push(blueGiant);
boards("turn 3 blockers declared: Blue's Hill Giant blocks White's Bears");
priorityRound("turn 3 declare blockers step");
step("combatDamage");
state.life[2] -= 5;
moveTo(bears, "graveyard");
cards[bears].tapped = false;
cards[blueGiant].damage = 2;
event({ cardId: bears, from: "Battlefield", ownerId: "player-0", to: "Graveyard" });
state.combat = state.combat.filter((a) => a.attackerId !== bears);
boards("turn 3 combat damage: Juggernaut's 5 to Blue comes off team 2's shared 30 (CR 810.9); the Bears died to the Giant");
priorityRound("turn 3 combat damage step");
step("main2");
priorityRound("turn 3 main 2");
note("End of the script: next the turn passes to team 2 (turn 4).");

const fixture = {
  status: "expected",
  about: "Two-Headed Giant with real shared team turns (teamRules sharedTurns, CR 805 + 810): every board and question each seat is expected to get over three turns. Hand-built by tests/make_2hg_level2_fixture.js from the current view schema; regenerate from a real engine game once the engine's shared turns and team combat land, keeping this shape.",
  proposedFields: {
    "gameView.activeTeamIds": "the active team's seats, first seat first (activePlayerId stays the first seat, the player Forge's turn belongs to)",
    "gameView.priorityTeamIds": "the team that has priority (CR 805.5); priorityPlayerId is the member being asked right now",
    "gameView.teamRules.rule": "sharedTurns (already written by InteractiveSnapshotExtractor)",
  },
  seats: SEATS.map((s) => ({ id: s, name: NAMES[s], team: TEAM[s], human: true })),
  record,
};
const text = JSON.stringify(fixture) + "\n";
if (process.argv.includes("--check")) {
  const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (now !== text) { console.error(`${OUT} is stale: run node tests/make_2hg_level2_fixture.js`); process.exit(1); }
  console.log("2hg-level2-protocol.json is current");
} else {
  fs.writeFileSync(OUT, text);
  console.log(`wrote ${OUT}: ${record.length} entries, ${promptId} questions`);
}
