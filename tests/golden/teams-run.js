// Golden-master runner for bridge/teams.js: calls every export on a grid of inputs (the ugly end heavy: null,
// undefined, wrong types, teamNumber 0, unknown rules, both sides of every boundary) and records, per call, the
// return value, a thrown error's type and message, every call made to a callback (nameOf, cname, controllerOf), any
// change to the arguments, any returned object that IS an argument or one of the module's constants (aliasing), and
// at the end whether any exported constant changed. Shared by tools/capture_teams_golden.js and
// tests/test_teams_golden.js. teams.js is pure (no clock, randomness, disk or network), so nothing needs freezing.
const path = require("path");

const MOD = path.join(__dirname, "..", "..", "bridge", "teams.js");

// a value as JSON that keeps what JSON drops: undefined, NaN, Infinity, -0, Set, Map, functions
function enc(v, seen = new Set()) {
  if (v === undefined) return { $u: 1 };
  if (typeof v === "number") return Number.isNaN(v) ? { $n: "NaN" } : !Number.isFinite(v) ? { $n: String(v) } : Object.is(v, -0) ? { $n: "-0" } : v;
  if (typeof v === "function") return { $fn: v.name || "anon" };
  if (v === null || typeof v !== "object") return v;
  if (seen.has(v)) return { $cycle: 1 };
  seen.add(v);
  let out;
  if (v instanceof Set) out = { $set: [...v].map((x) => enc(x, seen)) };
  else if (v instanceof Map) out = { $map: [...v].map(([k, x]) => [enc(k, seen), enc(x, seen)]) };
  else if (Array.isArray(v)) out = v.map((x) => enc(x, seen));
  else out = Object.fromEntries(Object.keys(v).map((k) => [k, enc(v[k], seen)]));
  seen.delete(v);
  return out;
}

// every object reachable from v (depth-limited), with its path
function objectsIn(v, at = "", out = [], depth = 0) {
  if (!v || typeof v !== "object" || depth > 6) return out;
  out.push([at || "(top)", v]);
  const kids = v instanceof Map ? [...v].map(([k, x]) => [String(k), x]) : v instanceof Set ? [...v].map((x, i) => [String(i), x]) : Object.entries(v);
  for (const [k, x] of kids) objectsIn(x, `${at}.${k}`, out, depth + 1);
  return out;
}

// A recording callback: returns a fixed shape of its argument and logs each call
function recorder(name, log, fn) {
  return (...a) => { log.push([name, ...a.map((x) => enc(x))]); return fn(...a); };
}

function cases() {
  const T = require(MOD);
  const C = [];
  const add = (name, fn, args, opts = {}) => C.push({ name, fn, args, opts });
  const COLORS4 = ["White", "Red", "Yellow", "Blue"];
  const COLORS6 = ["White", "Red", "Yellow", "Green", "Blue", "Purple"];
  const SC = { p0: "White", p1: "Red", p2: "Yellow", p3: "Blue" };
  const SC6 = { p0: "White", p1: "Red", p2: "Yellow", p3: "Green", p4: "Blue", p5: "Purple" };

  // ── seatColorsFor ──
  for (const n of [undefined, null, 0, 1, 2, 3, 4, 5, 6, 7, 10, "4", "5", "6", "x", "", -1, 4.5, 5.5, NaN, Infinity, true]) add(`seatColorsFor ${JSON.stringify(n) ?? "undefined"}${Number.isNaN(n) ? "NaN" : ""}`, "seatColorsFor", [n]);

  // ── teamsOf ──
  const rawTeams = {
    null: null, undefined: undefined, string: "White", number: 1, array: [1, 2], empty: {}, default: { White: 1, Red: 1, Yellow: 2, Blue: 2 },
    strings: { White: "1", Red: "2", Yellow: "1", Blue: "2" }, three: { White: 3, Red: 1, Yellow: 2, Blue: 2 }, zero: { White: 0, Red: 0, Yellow: 0, Blue: 0 },
    floats: { White: 1.0, Red: 2.0, Yellow: 1.5, Blue: "2.0" }, spaced: { White: " 2 ", Red: "1 ", Yellow: "", Blue: null }, bools: { White: true, Red: false, Yellow: true, Blue: true },
    six: { White: 1, Red: 1, Yellow: 1, Green: 2, Blue: 2, Purple: 2 }, lower: { white: 2, red: 2, yellow: 1, blue: 1 }, neg: { White: -1, Red: -2, Yellow: 2, Blue: 1 },
    across: { White: 1, Red: 2, Yellow: 1, Blue: 2 }, wrap: { White: 1, Red: 2, Yellow: 2, Blue: 1 }, allOne: { White: 1, Red: 1, Yellow: 1, Blue: 1 }, arr2: [[1]],
  };
  for (const [k, v] of Object.entries(rawTeams)) add(`teamsOf ${k}`, "teamsOf", [v]);

  // ── teamModeOf ──
  const modes = [undefined, null, "", "2hg", "2v2", "juggernaut", "archenemy", "3hg", "2HG", " 2v2", "ffa", "toString", "__proto__", "constructor", "hasOwnProperty", 2, ["2v2"]];
  for (const m of modes) add(`teamModeOf ${JSON.stringify(m) ?? "undefined"}`, "teamModeOf", [m]);

  // ── teamModeProblem ──
  for (const m of [undefined, "2hg", "2v2", "juggernaut", "archenemy", "3hg", "bogus"]) for (const g of ["commander", "standard", undefined, "Standard", "oathbreaker"]) add(`teamModeProblem ${m} in ${g}`, "teamModeProblem", [m, g]);

  // ── juggOf ──
  const juggs = {
    null: null, undefined: undefined, string: "Red", empty: {}, red: { color: "Red" }, green: { color: "Green" }, lower: { color: "red" },
    bounds_lo: { life: 1, hand: 0, draw: 0, land: 0, cmd: 1 }, bounds_hi: { life: 999, hand: 30, draw: 5, land: 5, cmd: 99 },
    past_lo: { life: 0, hand: -1, draw: -1, land: -1, cmd: 0 }, past_hi: { life: 1000, hand: 31, draw: 6, land: 6, cmd: 100 },
    strings: { life: "60", hand: "7", draw: "2", land: "1", cmd: "30" }, floats: { life: 60.5, hand: 7.0, draw: 1.5, land: "1.0", cmd: 21 },
    nulls: { life: null, hand: null, draw: null, land: null, cmd: null }, empties: { life: "", hand: " ", draw: false, land: true, cmd: [] },
    after: { order: "after" }, afterUpper: { order: "After" }, firstExplicit: { order: "first", color: "Blue" }, full: { color: "Yellow", life: 50, hand: 9, draw: 2, land: 1, cmd: 30, order: "after" },
    zero_life: { life: 0 }, nan: { life: NaN, hand: Infinity }, extra: { color: "Blue", bogus: 1, life: 70 },
  };
  for (const [k, v] of Object.entries(juggs)) add(`juggOf ${k}`, "juggOf", [v]);

  // ── juggLife / juggTeams / juggPerks / juggWords (on clean settings, as the bridge passes them) ──
  const cleanJuggs = { default: T.juggOf(null), life50: T.juggOf({ life: 50 }), life1: T.juggOf({ life: 1 }), none: T.juggOf({ draw: 0, land: 0 }),
    draw1land1: T.juggOf({ draw: 1, land: 1 }), draw2land2: T.juggOf({ draw: 2, land: 2 }), after: T.juggOf({ order: "after", draw: 0 }), all: T.juggOf({ draw: 3, land: 1, order: "after", cmd: 30, hand: 7, color: "Blue" }),
    cmd21: T.juggOf({ cmd: 21 }), cmd20: T.juggOf({ cmd: 20 }), cmd22: T.juggOf({ cmd: 22 }) };
  for (const [k, j] of Object.entries(cleanJuggs)) {
    for (const std of [false, true, undefined, 0, 1]) add(`juggLife ${k} std=${std}`, "juggLife", [j, std]);
    add(`juggPerks ${k}`, "juggPerks", [j]);
    for (const std of [false, true]) add(`juggWords ${k} std=${std}`, "juggWords", [j, std]);
  }
  add("juggLife life 0 kept (?? not ||)", "juggLife", [{ life: 0 }, false]);
  add("juggPerks draw 1 land 0 order first", "juggPerks", [{ draw: 1, land: 0, order: "first" }]);
  add("juggPerks draw -1 land -1", "juggPerks", [{ draw: -1, land: -1 }]);
  add("juggPerks null", "juggPerks", [null]);
  for (const c of ["White", "Red", "Yellow", "Blue", "Green", undefined, null, "white"]) add(`juggTeams ${c}`, "juggTeams", [c]);

  // ── archOf / archTeams / archLife / schemeDeckProblem / archWords ──
  const s20 = Array.from({ length: 20 }, (_, i) => `Scheme ${i}`);
  const arches = { null: null, undefined: undefined, empty: {}, red: { color: "Red" }, green: { color: "Green" }, purple: { color: "Purple" }, lower: { color: "blue" },
    schemes: { color: "Blue", schemes: [" A ", "B"] }, schemesEmpty: { schemes: [] }, schemesBlank: { schemes: ["A", " "] }, schemesNum: { schemes: ["A", 3] },
    schemesString: { schemes: "A" }, schemesNull: { schemes: null }, schemes20: { color: "Yellow", schemes: s20 }, schemesEmptyStr: { schemes: [""] } };
  for (const [k, v] of Object.entries(arches)) for (const [ck, cs] of [["default", undefined], ["four", COLORS4], ["six", COLORS6]]) add(`archOf ${k} colors=${ck}`, "archOf", [v, cs]);
  for (const c of ["White", "Blue", "Purple", "Green", undefined, null]) for (const [ck, cs] of [["default", undefined], ["six", COLORS6], ["two", ["White", "Red"]]]) add(`archTeams ${c} colors=${ck}`, "archTeams", [c, cs]);
  for (const std of [false, true, undefined, 0, 1, "standard"]) add(`archLife std=${JSON.stringify(std) ?? "undefined"}`, "archLife", [std]);
  const decks = { notArray: "x", null: null, undefined: undefined, empty: [], n19: s20.slice(0, 19), n20: s20, n21: [...s20, "Extra"],
    two: [...s20.slice(0, 18), "Dup", "Dup"], three: [...s20.slice(0, 17), "Dup", "Dup", "Dup"], twoThrees: [...s20.slice(0, 14), "A", "A", "A", "B", "B", "B", "B"],
    caseDiff: [...s20.slice(0, 17), "dup", "Dup", "DUP"], proto: [...s20.slice(0, 17), "__proto__", "__proto__", "__proto__"], toStr: [...s20.slice(0, 17), "toString", "toString", "toString"] };
  for (const [k, v] of Object.entries(decks)) add(`schemeDeckProblem ${k}`, "schemeDeckProblem", [v]);
  for (const [k, a] of [["random", { color: "White", schemes: null }], ["one", { color: "White", schemes: ["A"] }], ["many", { color: "White", schemes: s20 }], ["emptyList", { color: "White", schemes: [] }]]) for (const std of [false, true]) add(`archWords ${k} std=${std}`, "archWords", [a, std]);

  // ── teamWords / sides ──
  for (const [k, v] of [["none", []], ["one", ["White"]], ["two", ["White", "Red"]], ["three", ["White", "Red", "Yellow"]], ["notArray", "White"], ["null", null]]) add(`teamWords ${k}`, "teamWords", [v]);
  for (const [k, v] of Object.entries(rawTeams)) if (v && typeof v === "object" && !Array.isArray(v)) add(`sides ${k}`, "sides", [v]);
  add("sides null", "sides", [null]);

  // ── teamsProblem ──
  const tp = { default: rawTeams.default, wrap: rawTeams.wrap, across: rawTeams.across, allOne: rawTeams.allOne, threeOne: { White: 1, Red: 1, Yellow: 1, Blue: 2 },
    redYellow: { White: 2, Red: 1, Yellow: 1, Blue: 2 }, redBlue: { White: 2, Red: 1, Yellow: 2, Blue: 1 }, yellowBlue: { White: 2, Red: 2, Yellow: 1, Blue: 1 }, whiteYellow: { White: 1, Red: 2, Yellow: 1, Blue: 2 } };
  for (const [k, t] of Object.entries(tp)) for (const total of [0, 1, 2, 3, 4, 5, 6, 7, "4"]) for (const mode of [undefined, "2hg", "2v2", "juggernaut", "archenemy", "3hg", "bogus"]) {
    if ((k !== "default" && k !== "across") && total !== 4 && total !== 3) continue; // (the split only matters at 4; 3 shows the order of the checks)
    add(`teamsProblem ${k} total=${JSON.stringify(total)} mode=${mode}`, "teamsProblem", [t, total, mode]);
  }

  // ── setupOf ──
  const starts = {
    null: null, undefined: undefined, empty: {}, ffaMode: { teamMode: "2v2" }, teams2hg: { teams: rawTeams.default }, teams2hgExplicit: { teams: rawTeams.across, teamMode: "2hg" },
    teams2v2: { teams: rawTeams.across, teamMode: "2v2" }, shared: { teams: rawTeams.default, teamMode: "2hg", teamTurns: "shared" }, sharedNoMode: { teams: rawTeams.default, teamTurns: "shared" },
    shared2v2: { teams: rawTeams.default, teamMode: "2v2", teamTurns: "shared" }, sharedUpper: { teams: rawTeams.default, teamTurns: "Shared" }, bogusMode: { teams: rawTeams.default, teamMode: "bogus" },
    jugg: { teamMode: "juggernaut", juggernaut: { color: "Blue", life: 60 }, teams: rawTeams.default }, juggNone: { teamMode: "juggernaut" }, jugg3: { teamMode: "juggernaut", teamTurns: "shared" },
    three: { teamMode: "3hg" }, threeTeams: { teamMode: "3hg", teams: rawTeams.default }, arch: { teamMode: "archenemy", archenemy: { color: "Yellow" } }, archNone: { teamMode: "archenemy" },
    archSix: { teamMode: "archenemy", archenemy: { color: "Purple", schemes: ["A", "B"] } }, teamsString: { teams: "yes" }, teamsArray: { teams: [] },
  };
  for (const [k, m] of Object.entries(starts)) for (const [ck, cs] of [["default", undefined], ["six", COLORS6]]) add(`setupOf ${k} colors=${ck}`, "setupOf", [m, cs]);

  // ── gameConfig ──
  const users = ["u-w", "bot", "bot 2", "u-b"];
  const j = T.juggOf({ color: "Red", draw: 1, land: 1 });
  const jPlain = T.juggOf({ color: "Red", draw: 0, land: 0, cmd: 30 });
  const archA = { color: "Yellow", names: ["S1", "S2"] };
  const gc = [
    ["2hg default", [rawTeams.default, users, COLORS4]], ["2hg explicit", [rawTeams.default, users, COLORS4, "2hg"]],
    ["2hg shared", [rawTeams.default, users, COLORS4, "2hg", null, false, "shared"]], ["2v2 shared ignored", [rawTeams.across, users, COLORS4, "2v2", null, true, "shared"]],
    ["2v2", [rawTeams.across, users, COLORS4, "2v2", null, true]], ["bogus mode", [rawTeams.default, users, COLORS4, "bogus"]],
    ["jugg red cmd", [T.juggTeams("Red"), users, COLORS4, "juggernaut", j, false]], ["jugg red std", [T.juggTeams("Red"), users, COLORS4, "juggernaut", j, true]],
    ["jugg plain cmd30", [T.juggTeams("Red"), users, COLORS4, "juggernaut", jPlain, false]],
    ...[20, 21, 22, 1].map((cmd) => [`jugg cmd${cmd}`, [T.juggTeams("Blue"), users, COLORS4, "juggernaut", T.juggOf({ color: "Blue", cmd }), false]]), ["jugg no settings", [T.juggTeams("Red"), users, COLORS4, "juggernaut", null]],
    ["jugg colour not seated", [T.juggTeams("Green"), users, COLORS4, "juggernaut", T.juggOf({ color: "Green" })]], ["jugg settings outside jugg mode", [rawTeams.default, users, COLORS4, "2v2", j]],
    ["jugg reordered seats", [T.juggTeams("Red"), ["a", "b", "c", "d"], ["Blue", "Red", "White", "Yellow"], "juggernaut", j]],
    ["arch", [T.archTeams("Yellow"), users, COLORS4, "archenemy", null, false, null, archA]], ["arch std", [T.archTeams("Yellow"), users, COLORS4, "archenemy", null, true, null, archA]],
    ["arch no names", [T.archTeams("Yellow"), users, COLORS4, "archenemy", null, false, null, { color: "Yellow" }]], ["arch no arch", [T.archTeams("Yellow"), users, COLORS4, "archenemy"]],
    ["arch six", [T.archTeams("Purple", COLORS6), ["a", "b", "c", "d", "e", "f"], COLORS6, "archenemy", null, false, null, { color: "Purple", names: ["X"] }]],
    ["3hg", [{ White: 1, Red: 1, Yellow: 1, Green: 2, Blue: 2, Purple: 2 }, ["a", "b", "c", "d", "e", "f"], COLORS6, "3hg"]],
    ["3hg shared turns ignored", [{ White: 1, Red: 1, Yellow: 1, Green: 2, Blue: 2, Purple: 2 }, ["a", "b", "c", "d", "e", "f"], COLORS6, "3hg", null, false, "shared"]],
    ["fewer usernames", [rawTeams.default, ["u-w", "u-b"], ["White", "Blue"]]], ["no usernames", [rawTeams.default, [], []]], ["colour missing from teams", [rawTeams.default, ["x"], ["Green"]]],
    ["usernames not array", [rawTeams.default, null, COLORS4]],
  ];
  for (const [k, a] of gc) add(`gameConfig ${k}`, "gameConfig", a);

  // ── boards (pub) ──
  const P = (id, extra = {}) => ({ id, life: 20, ...extra });
  const pubs = {
    null: null, undefined: undefined, empty: {}, ffa: { activePlayerId: "p0", turn: 3, players: [P("p0"), P("p1"), P("p2"), P("p3")] },
    sharedLife: { activePlayerId: "p0", turn: 3, teamRules: { rule: "sharedLife", poisonToLose: 15, commanderDamageToLose: 42 }, players: [P("p0", { teamNumber: 1, commanderDamage: { c9: 5 } }), P("p1", { teamNumber: 1, commanderDamage: { c9: 7, c8: "2" } }), P("p2", { teamNumber: 2 }), P("p3", { teamNumber: 2, commanderDamage: { c1: "x" } })] },
    sharedLifeNoCmd: { activePlayerId: "p2", teamRules: { rule: "sharedLife", poisonToLose: 15 }, players: [P("p0", { teamNumber: 1 }), P("p1", { teamNumber: 1 }), P("p2", { teamNumber: 2 }), P("p3", { teamNumber: 2 })] },
    teamZero: { activePlayerId: "p0", teamRules: { rule: "sharedLife", poisonToLose: 15, commanderDamageToLose: 0 }, players: [P("p0", { teamNumber: 0, commanderDamage: { c: 1 } }), P("p1", { teamNumber: 0, commanderDamage: { c: 2 } }), P("p2", { teamNumber: 1 }), P("p3", { teamNumber: 1 })] },
    sharedLifeOneUnteamed: { activePlayerId: "p0", teamRules: { rule: "sharedLife", poisonToLose: 15 }, players: [P("p0", { teamNumber: 1 }), P("p1", { teamNumber: 1 }), P("p2"), P("p3", { teamNumber: 2 })] },
    sharedTurns: { activePlayerId: "p0", turn: 5, activeTeamIds: ["p0", "p1"], teamRules: { rule: "sharedTurns", poisonToLose: 15, commanderDamageToLose: 42 }, players: [P("p0", { teamNumber: 1 }), P("p1", { teamNumber: 1 }), P("p2", { teamNumber: 2 }), P("p3", { teamNumber: 2 })] },
    sharedTurnsRedLead: { activePlayerId: "p1", turn: 5, activeTeamIds: ["p0", "p1"], teamRules: { rule: "sharedTurns", poisonToLose: 15 }, players: [P("p0", { teamNumber: 1 }), P("p1", { teamNumber: 1 }), P("p2", { teamNumber: 2 }), P("p3", { teamNumber: 2 })] },
    sharedTurnsNoIds: { activePlayerId: "p2", turn: 6, teamRules: { rule: "sharedTurns", poisonToLose: 15 }, players: [P("p0", { teamNumber: 1 }), P("p1", { teamNumber: 1 }), P("p2", { teamNumber: 2 }), P("p3", { teamNumber: 2 })] },
    sharedTurnsBadIds: { activePlayerId: "p2", turn: 6, activeTeamIds: ["p0", "p1"], teamRules: { rule: "sharedTurns", poisonToLose: 15 }, players: [P("p0", { teamNumber: 1 }), P("p1", { teamNumber: 1 }), P("p2", { teamNumber: 2 }), P("p3", { teamNumber: 2 })] },
    sharedTurnsZero: { activePlayerId: "p0", turn: 2, teamRules: { rule: "sharedTurns", poisonToLose: 15 }, players: [P("p0", { teamNumber: 0 }), P("p1", { teamNumber: 0 }), P("p2", { teamNumber: 1 }), P("p3", { teamNumber: 1 })] },
    sharedTurnsLeadUnteamed: { activePlayerId: "p0", teamRules: { rule: "sharedTurns" }, players: [P("p0"), P("p1", { teamNumber: 1 })] },
    sharedTurnsNoActive: { teamRules: { rule: "sharedTurns" }, players: [P("p0", { teamNumber: 1 }), P("p1", { teamNumber: 1 })] },
    teamTurnsArch: { activePlayerId: "p1", turn: 4, activeTeamIds: ["p1", "p2", "p3"], teamRules: { rule: "teamTurns" }, players: [P("p0"), P("p1", { teamNumber: 2 }), P("p2", { teamNumber: 2 }), P("p3", { teamNumber: 2 })] },
    teamTurnsTwo: { activePlayerId: "p0", turn: 1, teamRules: { rule: "teamTurns" }, players: [P("p0"), P("p1")] },
    teams2v2: { activePlayerId: "p1", teamRules: { rule: "teams" }, players: [P("p0", { teamNumber: 1 }), P("p1", { teamNumber: 2 }), P("p2", { teamNumber: 1 }), P("p3", { teamNumber: 2 })] },
    teamsJugg: { activePlayerId: "p1", teamRules: { rule: "teams" }, players: [P("p0", { teamNumber: 1 }), P("p1"), P("p2", { teamNumber: 1 }), P("p3", { teamNumber: 1 })] },
    unknownRule: { activePlayerId: "p0", teamRules: { rule: "bogus", poisonToLose: 10 }, players: [P("p0", { teamNumber: 1 }), P("p1", { teamNumber: 1 })] },
    rulesNoRule: { activePlayerId: "p0", teamRules: {}, players: [P("p0", { teamNumber: 1 })] },
    // (a rule that isn't a string, or names a prototype member: no traits, though RULES[["sharedLife"]] would find one)
    ruleList: { activePlayerId: "p0", teamRules: { rule: ["sharedTurns"], poisonToLose: 15 }, players: [P("p0", { teamNumber: 1 }), P("p1", { teamNumber: 1 }), P("p2", { teamNumber: 2 })] },
    ruleProto: { activePlayerId: "p0", teamRules: { rule: "toString", poisonToLose: 15 }, players: [P("p0", { teamNumber: 1 }), P("p1", { teamNumber: 1 })] },
    noPlayers: { activePlayerId: "p0", teamRules: { rule: "sharedLife", poisonToLose: 15 } },
    unmappedIds: { activePlayerId: "z1", teamRules: { rule: "sharedLife", poisonToLose: 15 }, players: [P("z1", { teamNumber: 1 }), P("z2", { teamNumber: 1 }), P("z3", { teamNumber: 2 })] },
  };
  // the same boards over (game over, a winner)
  const over = (pub, winnerId) => ({ ...pub, gameOver: true, winnerId });
  pubs.sharedLifeWonRed = over(pubs.sharedLife, "p1");
  pubs.sharedLifeWinnerNotOver = { ...pubs.sharedLife, winnerId: "p2" };
  pubs.sharedLifeOverNoWinner = { ...pubs.sharedLife, gameOver: true };
  pubs.sharedLifeWonUnteamed = over(pubs.sharedLifeOneUnteamed, "p2");
  pubs.sharedLifeWonGhost = over(pubs.sharedLife, "nobody");
  pubs.teamZeroWon = over(pubs.teamZero, "p0");
  pubs.sharedTurnsWon = over(pubs.sharedTurns, "p3");
  pubs.teams2v2Won = over(pubs.teams2v2, "p2");
  pubs.teamsJuggWonLone = over(pubs.teamsJugg, "p1");
  pubs.teamsJuggWonTeam = over(pubs.teamsJugg, "p3");
  pubs.teamTurnsArchWonArch = over(pubs.teamTurnsArch, "p0");
  pubs.teamTurnsArchWonTeam = over(pubs.teamTurnsArch, "p2");
  pubs.teamTurnsTwoWonArch = over(pubs.teamTurnsTwo, "p0");
  pubs.teamTurnsTwoWonOther = over(pubs.teamTurnsTwo, "p1");
  pubs.ffaWon = over(pubs.ffa, "p2");
  pubs.ffaArchOverNoWinner = { ...pubs.ffa, players: [P("p0"), P("p1")], gameOver: true };

  for (const [k, pub] of Object.entries(pubs)) {
    add(`sharesLife ${k}`, "sharesLife", [pub]);
    add(`sharesTurns ${k}`, "sharesTurns", [pub]);
    add(`boardTeams ${k}`, "boardTeams", [pub, SC]);
    add(`turnPlayerIds ${k}`, "turnPlayerIds", [pub]);
    for (const [mk, mode, arch] of [["none", undefined, undefined], ["2hg", "2hg", null], ["2v2", "2v2", null], ["jugg", "juggernaut", null], ["arch White", "archenemy", "White"], ["arch Red", "archenemy", "Red"], ["arch none", "archenemy", null], ["arch Green", "archenemy", "Green"]]) {
      add(`teamsField ${k} mode=${mk}`, "teamsField", [pub, SC, mode, arch]);
    }
    if (!pub) continue;
    for (const id of ["p0", "p1", "p2", "p3", "nobody", null, undefined]) {
      const p = (pub.players || []).find((q) => q.id === id) || { id, teamNumber: 1 };
      add(`teamOf ${k} ${id}`, "teamOf", [p, pub]);
      add(`withTeamDamage ${k} ${id}`, "withTeamDamage", [p, pub]);
      add(`teamLifeTip ${k} ${id}`, "teamLifeTip", [p, pub, SC]);
      add(`isTurnOf ${k} ${id}`, "isTurnOf", [pub, id]);
      add(`turnPartnerOf ${k} ${id}`, "turnPartnerOf", [pub, id]);
      add(`turnWhose ${k} ${id}`, "turnWhose", [pub, id, "NAME"]);
      for (const id2 of ["p0", "p1", "p2", "nobody", null]) add(`turnPartners ${k} ${id} ${id2}`, "turnPartners", [pub, id, id2]);
    }
    for (const lab of ["POISON 3", "POISON 0", "POISON 15", "POISON", "POISON 3/15", "poison 3", " POISON 3", "POISON 3 ", "POISON -1", "LIFE 3", "", undefined]) add(`poisonLabel ${k} ${JSON.stringify(lab) ?? "undefined"}`, "poisonLabel", [lab, pub]);
  }
  add("boardTeams sharedLife no slotColor map entries", "boardTeams", [pubs.sharedLife, {}]);
  add("teamsField six-seat arch", "teamsField", [{ activePlayerId: "p0", players: ["p0", "p1", "p2", "p3", "p4", "p5"].map((id) => P(id)), gameOver: true, winnerId: "p4" }, SC6, "archenemy", "Blue"]);
  add("teamsField unknown slot arch", "teamsField", [{ players: [P("p0"), P("zz")] }, SC, "archenemy", "White"]);
  add("teamLifeTip unmapped ids", "teamLifeTip", [pubs.unmappedIds.players[0], pubs.unmappedIds, SC]);

  // ── teamWinWords / setupWords ──
  for (const [k, won] of [["one", ["White"]], ["two", ["White", "Red"]], ["three", ["Red", "Yellow", "Blue"]], ["none", []]]) add(`teamWinWords ${k}`, "teamWinWords", [won, "UPPER"]);
  const juggB = T.juggOf({ color: "Blue", draw: 2, land: 0, order: "after" });
  const sw = [
    ["2hg", ["2hg", rawTeams.default, null, false]], ["2hg across", ["2hg", rawTeams.across, null, false]], ["2hg shared", ["2hg", rawTeams.default, null, false, "shared"]],
    ["2hg turns other", ["2hg", rawTeams.default, null, false, "solo"]], ["2v2", ["2v2", rawTeams.across, null, true]], ["2v2 shared ignored", ["2v2", rawTeams.across, null, true, "shared"]],
    ["jugg cmd", ["juggernaut", T.juggTeams("Blue"), juggB, false]], ["jugg std", ["juggernaut", T.juggTeams("Blue"), juggB, true]], ["jugg default", ["juggernaut", T.juggTeams("White"), T.juggOf(null), false]],
    ["3hg cmd", ["3hg", { White: 1, Red: 1, Yellow: 1, Green: 2, Blue: 2, Purple: 2 }, null, false]], ["3hg std", ["3hg", { White: 1, Red: 1, Yellow: 1, Green: 2, Blue: 2, Purple: 2 }, null, true]],
    ["arch cmd", ["archenemy", T.archTeams("Yellow"), null, false, null, { color: "Yellow", schemes: null }]], ["arch std chosen", ["archenemy", T.archTeams("Red"), null, true, null, { color: "Red", schemes: ["A", "B", "C"] }]],
    ["arch six", ["archenemy", T.archTeams("Purple", COLORS6), null, false, null, { color: "Purple", schemes: null }]],
    ["arch no arch", ["archenemy", T.archTeams("Yellow"), null, false, null, null]], ["bogus", ["bogus", rawTeams.default, null, false]], ["undefined mode", [undefined, rawTeams.default, null, false]],
  ];
  for (const [k, a] of sw) add(`setupWords ${k}`, "setupWords", a);

  // ── teamAttackLines / teamBlockLines / teamTriggerWords / teamRefusalWords ──
  const cards = [
    { id: "c1", isAttacking: true, controllerId: "p1", attackTargetId: "p2" }, { id: "c2", isAttacking: true, controllerId: "p1" },
    { id: "c3", isAttacking: true, ownerId: "p1" }, { id: "c4", isAttacking: false, controllerId: "p1" }, { id: "c5", isAttacking: true, controllerId: "p0", attackTargetId: "p3" },
    { id: "c6", isAttacking: true, controllerId: "p2", ownerId: "p1" },
  ];
  const decl = { turn: 5, attacks: { p1: [{ attackerId: "c7", targetId: "p3" }, { attackerId: "c2", targetId: "p2" }, { attackerId: "c1", targetId: "p3" }, { attackerId: null }], p0: [{ attackerId: "c9" }] },
    blocks: { p3: [{ blockerId: "b9", attackerId: "c1" }, { blockerId: "b1", attackerId: "c1" }, { blockerId: null, attackerId: "c2" }], p2: [{ blockerId: "b5", attackerId: "c5" }] } };
  const declOld = { ...decl, turn: 4 };
  const T5 = pubs.sharedTurns, T6 = pubs.sharedTurnsNoIds;
  const atk = [["shared p0 board", [T5, "p0", cards]], ["shared p0 none", [T5, "p0", []]], ["shared p0 decl", [T5, "p0", [], decl]], ["shared p0 board+decl", [T5, "p0", cards, decl]],
    ["shared p0 old decl", [T5, "p0", [], declOld]], ["shared p1", [T5, "p1", cards, decl]], ["shared p2 (defender)", [T5, "p2", cards, decl]], ["shared nobody", [T5, "nobody", cards]],
    ["sharedLife p0", [pubs.sharedLife, "p0", cards, decl]], ["ffa", [pubs.ffa, "p0", cards]], ["arch p1", [pubs.teamTurnsArch, "p1", [{ id: "x", isAttacking: true, controllerId: "p2" }]]], ["zero team", [pubs.sharedTurnsZero, "p0", [{ id: "z", isAttacking: true, controllerId: "p1" }]]]];
  for (const [k, [pub, who, cs, d]] of atk) add(`teamAttackLines ${k}`, "teamAttackLines", [pub, who, cs, "CNAME", "NAME", d]);
  const blocks = [{ blockerId: "b1", attackerId: "c1" }, { blockerId: "b1", attackerId: "c1" }, { blockerId: "b2", attackerId: "c2" }, { blockerId: "b3", attackerId: "c1" }, { blockerId: "b4" }, { attackerId: "c1" }];
  const ctl = { b1: "p3", b2: "p3", b3: "p2", b9: "p3", b5: "p2" };
  const blk = [["noIds p2 board", [T6, "p2", blocks]], ["noIds p2 none", [T6, "p2", []]], ["noIds p2 null", [T6, "p2", null]], ["noIds p2 decl", [T6, "p2", [], { ...decl, turn: 6 }]],
    ["noIds p2 board+decl", [T6, "p2", blocks, { ...decl, turn: 6 }]], ["noIds p3", [T6, "p3", blocks, { ...decl, turn: 6 }]], ["noIds p2 old decl", [T6, "p2", [], decl]],
    ["shared p0 (attacker)", [T5, "p0", blocks]], ["ffa", [pubs.ffa, "p2", blocks]], ["sharedLife", [pubs.sharedLife, "p2", blocks]]];
  for (const [k, [pub, who, bl, d]] of blk) add(`teamBlockLines ${k}`, "teamBlockLines", [pub, who, bl, "CTL", "CNAME", "NAME", d], { ctl });
  const items = [{ id: "t1", card: { controllerId: "p1" } }, { id: "t2", card: { controllerId: "p0" } }, { id: "t3", card: { ownerId: "p1" } }, { id: "t4" }, { id: "t5", card: { controllerId: "p2", ownerId: "p1" } }];
  for (const [k, [pub, who, its]] of [["shared p0", [T5, "p0", items]], ["shared p0 own only", [T5, "p0", [items[1]]]], ["shared p0 none", [T5, "p0", []]], ["shared p0 null", [T5, "p0", null]],
    ["shared p1", [T5, "p1", items]], ["ffa", [pubs.ffa, "p0", items]], ["sharedLife", [pubs.sharedLife, "p0", items]], ["arch p2", [pubs.teamTurnsArch, "p2", [{ id: "a", card: { controllerId: "p3" } }]]]]) add(`teamTriggerWords ${k}`, "teamTriggerWords", [pub, who, its, "NAME"]);
  const titles = ["Attack declaration invalid", "Attack declaration invalid: Goblin must attack", "Block declaration invalid: Wall can't block.", "block declaration invalid:  lower case  ",
    "  Attack declaration invalid  ", "Attack declaration invalidated", "Attack declaration invalid:", "Attack declaration invalid: two. sentences.", "Your attack is invalid", "", null, undefined, 42];
  for (const t of titles) for (const [pk, pub, who] of [["shared p0", T5, "p0"], ["shared p3", T6, "p3"], ["ffa", pubs.ffa, "p0"], ["sharedLife", pubs.sharedLife, "p0"], ["arch p1", pubs.teamTurnsArch, "p1"]]) add(`teamRefusalWords ${pk} ${JSON.stringify(t) ?? "undefined"}`, "teamRefusalWords", [pub, who, t, "NAME"]);

  // ── jointBlock / jointBlockLines / teamBlockNotice ──
  const inputs = { null: null, undefined: undefined, empty: {}, plain: { type: "chooseBlockers", options: [] }, title: { title: "  Block with Yellow  " }, blankTitle: { title: "   " }, numTitle: { title: 5 },
    round0: { reviseRound: 0 }, round1: { reviseRound: 1 }, round4: { reviseRound: 4 }, roundStr: { reviseRound: "2" }, roundFloat: { reviseRound: 1.5 }, roundNeg: { reviseRound: -1 },
    assignEmpty: { currentAssignments: [] }, assign: { currentAssignments: [{ blockerId: "b1", attackerId: "a1" }, { blockerId: "b1", attackerId: "a1" }, { blockerId: "b2" }, null, { blockerId: "b3", attackerId: "a2", extra: { deep: 1 } }] },
    assignNotArray: { currentAssignments: { blockerId: "b1", attackerId: "a1" } }, lines: { teamBlockLines: ["Goblin -> your Bear + Yellow's Wall", 5, null] }, linesNotArray: { teamBlockLines: "x" },
    nullFields: { title: null, reviseRound: null, currentAssignments: null, teamBlockLines: null }, full: { title: "Yellow changed the blocks. Agree or change?", reviseRound: 2, currentAssignments: [{ blockerId: "b1", attackerId: "a1" }], teamBlockLines: ["A -> B"] } };
  for (const [k, v] of Object.entries(inputs)) add(`jointBlock ${k}`, "jointBlock", [v]);
  const named = [{ name: "Yellow", color: "Yellow" }, { name: "Blue", color: "Blue" }, { name: "Odd", color: "Black" }, { name: "", color: "Red" }, { name: "Pink", color: "Pink" }];
  const jbl = [["basic", ["Goblin Guide -> your Bear + Yellow's Wall", "Hill Giant -> Blue's Centaur + Yellow's Elf", "Ogre -> nothing"]], ["twice", ["A -> Yellow's X + Yellow's Y -> Z"]], ["noSpace", ["A->Yellow's X", "Yellows X"]],
    ["unknownColour", ["A -> Odd's X"]], ["empty", []], ["null", null], ["nonString", [5, null]], ["prefixName", ["A -> Pink's X + MyPink's Y"]]];
  for (const [k, l] of jbl) for (const colored of [true, false, undefined]) for (const [nk, ps] of [["named", named], ["none", null]]) add(`jointBlockLines ${k} colored=${colored} players=${nk}`, "jointBlockLines", [l, ps, colored]);
  const notices = ["Yellow decides (team leader)", "Yellow decides (team leader).", "Yellow settles the team's blocks (rule 805.2)", "Yellow settles the team's blocks (rule 805.2).", "  Blue decides (team leader).  ",
    "Yellow: Wall of Wood now blocks Hill Giant.", "Blue: Centaur Courser no longer blocks.", "Yellow: Wall of Wood now blocks Hill Giant", "Yellow Wall now blocks Giant.", "Yellow: Wall: Two now blocks Giant.",
    "decides (team leader)", "Yellow decides", "Some other notice", "", null, undefined, 0, "Yellow: X no longer blocks Y."];
  for (const t of notices) add(`teamBlockNotice ${JSON.stringify(t) ?? "undefined"}`, "teamBlockNotice", [t]);

  return { C, ctlOf: ctl };
}

// The callbacks the cases name by string: each logs its calls and answers in a fixed, recognisable way
function callbacks(log, opts) {
  return {
    NAME: recorder("nameOf", log, (id) => `N(${id})`),
    UPPER: recorder("nameOf", log, (c) => String(c).toUpperCase()),
    CNAME: recorder("cname", log, (id) => `C(${id})`),
    CTL: recorder("controllerOf", log, (id) => (opts.ctl || {})[id]),
  };
}

function runAll() {
  delete require.cache[require.resolve(MOD)];
  const T = require(MOD);
  const constNames = Object.keys(T).filter((k) => typeof T[k] !== "function").sort();
  const constsBefore = JSON.stringify(enc(Object.fromEntries(constNames.map((k) => [k, T[k]]))));
  const constObjs = constNames.flatMap((k) => objectsIn(T[k], k));
  const out = [];
  // the public surface: every export by name, a function's declared argument count, a constant's value
  out.push({ name: "surface", result: Object.keys(T).sort().map((k) => (typeof T[k] === "function" ? [k, "function", T[k].length] : [k, enc(T[k])])) });
  const { C } = cases();
  const names = new Set();
  for (const c of C) {
    let name = c.name;
    for (let i = 2; names.has(name); i++) name = `${c.name} #${i}`;
    names.add(name);
    const log = [];
    const cb = callbacks(log, c.opts);
    const args = c.args.map((a) => (typeof a === "string" && Object.prototype.hasOwnProperty.call(cb, a) ? cb[a] : a));
    const before = JSON.stringify(enc(args));
    const rec = { name };
    try {
      const fn = T[c.fn];
      if (typeof fn !== "function") throw new Error(`teams.${c.fn} is not an export`);
      const r = fn(...args);
      rec.result = enc(r);
      // a returned object that IS an argument or a module constant (a caller changing it would change those)
      const argObjs = objectsIn(args, "args");
      const alias = [];
      for (const [p, o] of objectsIn(r, "result")) {
        const a = argObjs.find(([, x]) => x === o) || constObjs.find(([, x]) => x === o);
        if (a) alias.push(`${p} is ${a[0]}`);
      }
      if (alias.length) rec.aliases = alias;
    } catch (e) {
      rec.threw = { type: e?.constructor?.name || typeof e, message: String(e?.message ?? e) };
    }
    const after = JSON.stringify(enc(args));
    if (after !== before) rec.argsChanged = JSON.parse(after);
    if (log.length) rec.calls = log;
    out.push(rec);
  }
  const constsAfter = JSON.stringify(enc(Object.fromEntries(constNames.map((k) => [k, T[k]]))));
  out.push({ name: "constants unchanged by every call", result: constsAfter === constsBefore ? true : JSON.parse(constsAfter) });
  return out;
}

// a programming error inside teams.js (not an input it refuses): TypeError/ReferenceError outside the deliberately
// ugly rows is still recorded, since a throw is the behaviour today; this lists them for the capture's report
const thrown = (rows) => rows.filter((r) => r.threw).map((r) => `${r.name}: ${r.threw.type} ${r.threw.message}`);

module.exports = { runAll, thrown, enc };
