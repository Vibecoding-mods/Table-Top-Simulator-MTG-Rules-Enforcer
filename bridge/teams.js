// The team modes for the bridge (docs/game-modes-spec.md §4, §4.1, §5.5, §6): Two-Headed Giant (Level 1), 2v2 and
// Juggernaut (3v1); 2v2 in Standard only, the other two in Commander only (TEAM_MODES). The table's teams, checked at
// start, the engine's gameConfig, and what a team game adds to the table's board. The table keeps the choice (ENGINE_TEAMS, ENGINE_TEAM_MODE and ENGINE_JUGG in
// engine-renderer.lua: "mtg mode 2hg|2v2|juggernaut|ffa", "mtg team <colour> <1|2>", "mtg juggernaut ...") and sends it
// with every start, as it sends free mulligans, so a restarted bridge needs nothing kept here. Kept out of bridge.js so
// the other game modes' work there (Standard's MODES) and this one meet only at their call sites.
//
// The three share one plumbing (§4): every player's team (and the Juggernaut's life, hand, perks, commander limit and
// first turn) go to the node as gameConfig before StartGame; the engine's teamRules ("sharedLife" or "teams") and each
// player's teamNumber come back on every board.
//
// Two-Headed Giant, Level 1 (Commander only, TEAM_MODES): partners share life (80 a team), poison (15) and a
// commander's damage (42), lose together, block for each other and see each other's hands; each player still takes their own
// turn, the team's back to back, and the starting team skips its first draws. The engine does all of that once the
// node's gameConfig says teamRules "sharedLife" (engine/forge.patch, forge-harness ManaBrewEngineAdapter.configureTeamRules);
// the bridge only says who is on which team.
//
// Two-Headed Giant, Level 2 (teamRules "sharedTurns", the table's "mtg 2hg turns shared"): Level 1 plus one turn for the
// team (CR 805, 810.2): both partners are on their turn, attack together and block together. The engine still asks one
// player at a time; the bridge reads the whole team as the active players (turnPlayerIds, isTurnOf) and says the team's
// attack and block on each partner's question (teamAttackLines, teamBlockLines). Spec §5.11.
//
// 2v2 (§4.1; Standard only, TEAM_MODES): two teams of two, each player their own life (Standard's 20, no commander) and
// their own turn round the table; teammates can't attack each other; a team wins when both its opponents have lost
// (Forge's own team game over, teamRules "teams"). Any two-and-two split; by default the sides, as in Two-Headed Giant.
//
// Juggernaut (§6): one player against a team of three. The Juggernaut starts at 80 life (40 in Standard: twice the
// format's) with 10 cards, draws 1 more card in each draw step, has no extra land play (option 1), is knocked out by 21
// commander damage from one commander (option 42) and goes first; the turn order is the Juggernaut then each challenger
// (default) or "after": the Juggernaut after every challenger. The perks are Forge card-script lines on an effect card in
// the Juggernaut's command zone (forge-harness Perks); "after" is an extra turn at each challenger's upkeep plus the
// Juggernaut's own normal turns skipped (Forge ReplaceBeginTurn ExtraTurn$ False), so rewinds and extra turns stay
// Forge's. The Juggernaut wins when all three have lost; the three win together when the Juggernaut loses.

// Archenemy (docs/team-turns-archenemy-plan.md §2, the user's answers §2.7): one player, the archenemy, against everyone
// else as one team, in Commander or Standard. The archenemy starts at twice the format's life (80, or 40 in Standard: a
// house rule), goes first (CR 904.6) and has a scheme deck: 20 random schemes from Forge's (bridge/forge-schemes.json)
// or the host's list. The others keep the format's life and their own turns. The engine (cloud/archenemy-rules) takes
// gameConfig's archenemy flag and the archenemy's schemes, refuses a bad scheme deck, forces the teams and takes no
// restore points in a scheme game, so the bridge says Undo is off. The bridge keeps the setting ("mtg archenemy",
// "mtg schemes", like Planechase's) and a start from the table can also carry it (teamMode "archenemy").

// Three-Headed Giant (spec §8, rule 810.11): Two-Headed Giant with three a team, on the six-seat table, Level 1 (each
// player their own turn, the team's back to back). The teams are the table's sides, which are next to each other in
// turn order (White + Red + Yellow, Green + Blue + Purple; the engine needs partners side by side in seat order). The
// engine gives the team's life and limits by team size: 45 life, 20 poison (810.11), 120 life and 63 commander damage
// in Commander (its own house numbers, 40 and 21 a head); the bridge sends only the teams.
const SIX_COLORS = ["White", "Red", "Yellow", "Green", "Blue", "Purple"]; // (the six-seat table in turn order, bridge.js TABLE_COLORS)
const THREE_TEAMS = { White: 1, Red: 1, Yellow: 1, Green: 2, Blue: 2, Purple: 2 };

const TEAM_COLORS = ["White", "Red", "Yellow", "Blue"]; // (the table's seats in turn order, bridge.js TABLE_COLORS)
// The seat colours of a game of n seats in turn order (engine-test.js names its seats by them): the four-seat table's
// up to four, the six-seat table's from five (its fourth seat is Green, not Blue; a six-seat engine-test report named
// the last two "seat4" / "seat5", headless six-seat run 2026-11-17)
const seatColorsFor = (n) => (Number(n) > TEAM_COLORS.length ? SIX_COLORS.slice(0, Math.min(Number(n), SIX_COLORS.length)) : [...TEAM_COLORS]);
// the default sides: the two seats on each long side of the table, which are next to each other in turn order
const DEFAULT_TEAMS = { White: 1, Red: 1, Yellow: 2, Blue: 2 };

// The table's teams as sent ({ White: 1, Red: 1, Yellow: 2, Blue: 2 }; numbers or "1"/"2"), each colour 1 or 2 ->
// a clean copy, or null when the message has none (a free-for-all game).
function teamsOf(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  for (const c of TEAM_COLORS) {
    const n = Number(raw[c]);
    out[c] = n === 1 || n === 2 ? n : DEFAULT_TEAMS[c];
  }
  return out;
}

// A start message's team setup (its teams, teamMode, teamTurns and juggernaut fields): { teams, mode, jugg, turns };
// teams null is a free-for-all game. A Juggernaut start's teams come from the Juggernaut's colour, whatever teams it
// sent. turns: "shared" for a Two-Headed Giant start whose teamTurns is "shared" (Level 2, the table's "mtg 2hg turns
// shared"), else null (Level 1: each player takes their own turn).
// colors: the table's seats in turn order (the bridge's TABLE_COLORS: four, or six on the six-seat table), which an
// Archenemy start's teams cover (the archenemy against everyone else, archTeams).
function setupOf(m, colors = TEAM_COLORS) {
  if (m?.teamMode === "archenemy") {
    const arch = archOf(m.archenemy, colors);
    return { teams: archTeams(arch.color, colors), mode: "archenemy", jugg: null, turns: null, arch };
  }
  if (m?.teamMode === "3hg") return { teams: { ...THREE_TEAMS }, mode: "3hg", jugg: null, turns: null };
  if (m?.teamMode === "juggernaut") {
    const jugg = juggOf(m.juggernaut);
    return { teams: juggTeams(jugg.color), mode: "juggernaut", jugg, turns: null };
  }
  const teams = teamsOf(m?.teams);
  const mode = teams ? teamModeOf(m?.teamMode) : null;
  return { teams, mode, jugg: null, turns: mode === "2hg" && m?.teamTurns === "shared" ? "shared" : null };
}

// The team modes: what a start's teamMode can be (teams sent with none: Two-Headed Giant, as the table sent before 2v2
// and Juggernaut), the engine's rule for each, its name in chat, and the one game mode (bridge.js MODES) it is played
// in: 2v2 only in Standard, Two-Headed Giant and Juggernaut only in Commander (the owner's call, spec §4.1).
const TEAM_MODES = {
  "2hg": { rule: "sharedLife", name: "Two-Headed Giant", gameMode: "commander" },
  "2v2": { rule: "teams", name: "2v2", gameMode: "standard" },
  juggernaut: { rule: "teams", name: "Juggernaut", gameMode: "commander" },
  archenemy: { rule: "teams", name: "Archenemy", gameMode: null }, // (either game mode, §2.7 answer 1)
  "3hg": { rule: "sharedLife", name: "Three-Headed Giant", gameMode: null, seats: 6 }, // (either game mode; the six-seat table)
};
const teamModeOf = (raw) => (Object.prototype.hasOwnProperty.call(TEAM_MODES, raw) ? raw : "2hg");
// Why a team mode can't be played in a game mode ("commander" | "standard"), in words for chat; null when it can.
function teamModeProblem(teamMode, gameMode) {
  const t = TEAM_MODES[teamModeOf(teamMode)];
  if (t.gameMode == null) return null;
  if (t.gameMode === gameMode) return null;
  const words = (k) => (k === "standard" ? "Standard" : "Commander");
  return `${t.name} is played in ${words(t.gameMode)} only, and the game mode is ${words(gameMode)}. Switch with  mtg mode ${t.gameMode}  or pick another Teams mode.`;
}

// The Juggernaut's settings (spec §6), the host's: who, life (null: twice the format's), opening hand, extra cards per
// draw step, extra land plays, the commander damage from one commander that knocks them out, and the turn order.
const JUGG_DEFAULTS = { color: "White", life: null, hand: 10, draw: 1, land: 0, cmd: 21, order: "first" };
const JUGG_LIMITS = { life: [1, 999], hand: [0, 30], draw: [0, 5], land: [0, 5], cmd: [1, 99] };
// a start's juggernaut field -> a clean copy (each bad or missing value its default)
function juggOf(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const out = { ...JUGG_DEFAULTS };
  if (TEAM_COLORS.includes(r.color)) out.color = r.color;
  for (const [k, [lo, hi]] of Object.entries(JUGG_LIMITS)) {
    const n = Number(r[k]);
    if (r[k] != null && Number.isInteger(n) && n >= lo && n <= hi) out[k] = n;
  }
  if (r.order === "after") out.order = "after";
  return out;
}
// the Juggernaut's starting life: the host's, else twice the format's (80 in Commander, 40 in Standard)
const juggLife = (jugg, std) => jugg.life ?? (std ? 40 : 80);
// the teams of a Juggernaut game: the Juggernaut alone on team 1, the three on team 2
const juggTeams = (color) => Object.fromEntries(TEAM_COLORS.map((c) => [c, c === color ? 1 : 2]));
// Archenemy's teams on a table of these seats (four, or the six-seat table's six): the archenemy alone, everyone else
const archTeams = (color, colors = TEAM_COLORS) => Object.fromEntries(colors.map((c) => [c, c === color ? 1 : 2]));
const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
// The Juggernaut's perks as Forge card-script lines (forge-harness Perks: one effect card, hidden from the view), [] for
// none. Static triggers, so they are rules of the game, not abilities on the stack. Kept in step with the lines
// forge-harness PlayerRulesTest proves (DRAW, LAND, AFTER_EACH).
function juggPerks(jugg) {
  const lines = ["Name:Juggernaut"];
  if (jugg.draw > 0) {
    lines.push(`T:Mode$ Phase | Phase$ Draw | ValidPlayer$ You | TriggerZones$ Command | Static$ True | Execute$ JuggDraw | TriggerDescription$ At the beginning of your draw step, draw ${jugg.draw} additional card${jugg.draw === 1 ? "" : "s"}.`,
      `SVar:JuggDraw:DB$ Draw | Defined$ You | NumCards$ ${jugg.draw}`);
  }
  if (jugg.land > 0) lines.push(`S:Mode$ Continuous | Affected$ You | AdjustLandPlays$ ${jugg.land} | EffectZone$ Command | Description$ You may play ${jugg.land} additional land${jugg.land === 1 ? "" : "s"} on each of your turns.`);
  if (jugg.order === "after") {
    lines.push("T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ Opponent | TriggerZones$ Command | Static$ True | Execute$ JuggTurn | TriggerDescription$ At the beginning of each opponent's upkeep, take an extra turn after this one.",
      "SVar:JuggTurn:DB$ AddTurn | Defined$ You | NumTurns$ 1",
      "R:Event$ BeginTurn | ActiveZones$ Command | ValidPlayer$ You | ExtraTurn$ False | Skip$ True | Description$ You skip your turns that aren't extra turns.");
  }
  return lines.length > 1 ? lines : [];
}
// the Juggernaut's settings in words, for chat: "80 life, 10 cards, 1 extra card each draw step, ..."
function juggWords(jugg, std) {
  return [`${juggLife(jugg, std)} life`, `${jugg.hand} cards`, `${plural(jugg.draw, "extra card")} each draw step`,
    plural(jugg.land, "extra land play"), `out at ${jugg.cmd} commander damage`,
    jugg.order === "after" ? "a turn after every challenger's" : "goes first"].join(", ");
}

// The archenemy's settings: who (any seat: a seated player or an AI one) and the host's scheme list (null: 20 at random).
const ARCH_DEFAULTS = { color: "White", schemes: null };
// The scheme deck's rules, as the engine checks them (Archenemy.schemeDecks, cloud/archenemy-rules): at least 20
// schemes, at most 2 of each (Forge's DeckFormat), and 20 drawn at random when the host names none.
const ARCH_SCHEMES = 20, ARCH_COPIES = 2;
// a start's archenemy field -> a clean copy (a colour not among the table's seats the default; schemes kept only as a
// list of names). colors: the table's seats (four, or six)
function archOf(raw, colors = TEAM_COLORS) {
  const r = raw && typeof raw === "object" ? raw : {};
  const out = { ...ARCH_DEFAULTS };
  if (colors.indexOf(r.color) >= 0) out.color = r.color;
  if (Array.isArray(r.schemes) && r.schemes.length && r.schemes.every((n) => typeof n === "string" && n.trim())) out.schemes = r.schemes.map((n) => n.trim());
  return out;
}
// the archenemy's starting life: twice the format's (80 in Commander, 40 in Standard)
const archLife = (std) => (std ? 40 : 80);
// Why a scheme list can't be the archenemy's deck (null when it can): count is the list's size, copies its names counted
function schemeDeckProblem(names) {
  if (!Array.isArray(names)) return "no scheme deck";
  if (names.length < ARCH_SCHEMES) return `a scheme deck needs at least ${ARCH_SCHEMES} schemes; this one has ${names.length}`;
  const count = {};
  for (const n of names) count[n] = (count[n] || 0) + 1;
  const many = Object.entries(count).filter(([, k]) => k > ARCH_COPIES).map(([n, k]) => `${n} (${k})`);
  return many.length ? `a scheme deck holds at most ${ARCH_COPIES} of each scheme: ${many.join(", ")}` : null;
}
// the archenemy's setup in words, for chat: "80 life, goes first, 20 random schemes"
const archWords = (arch, std) => `${archLife(std)} life, goes first, ${arch.schemes ? `${plural(arch.schemes.length, "chosen scheme")}` : `${ARCH_SCHEMES} random schemes`}`;

// colour list -> "White + Red"
const teamWords = (colors) => colors.join(" + ");
// the colours of each team, in turn order: { 1: [...], 2: [...] }
function sides(teams) {
  const out = { 1: [], 2: [] };
  for (const c of TEAM_COLORS) out[teams[c]].push(c);
  return out;
}

// Why these teams can't start a game of `total` players (null when they can). mode "2hg" (Level 1): two teams of two,
// every seat filled (AI players take the empty ones), and partners next to each other in turn order, round the table
// (the team plays its turns back to back, and the engine's first-draw skip counts the starting team's first turns).
// "2v2": two teams of two, any split. "juggernaut": four players (the teams come from the Juggernaut's colour, juggTeams).
// "3hg": all six seats filled (the teams are the table's sides, THREE_TEAMS).
function teamsProblem(teams, total, mode = "2hg") {
  const fill = "Add AI players with  mtg start ai N  or  mtg ai <colour> forge.";
  // (Archenemy: the archenemy against one to five others; the teams come from the archenemy's colour)
  if (mode === "archenemy") return total >= 2 ? null : `Archenemy needs the archenemy and at least one other player. ${fill}`;
  if (mode === "3hg") return total === SIX_COLORS.length ? null : `Three-Headed Giant needs all six seats filled (seated players + AI players), not ${total}. ${fill}`;
  if (mode === "juggernaut") return total === 4 ? null : `Juggernaut is one against three: all four seats filled (seated players + AI players), not ${total}. ${fill}`;
  const s = sides(teams);
  const split = `two teams of two (now team 1: ${teamWords(s[1]) || "nobody"}, team 2: ${teamWords(s[2]) || "nobody"}). Use  mtg team <colour> <1|2>.`;
  if (mode === "2v2") {
    if (total !== 4) return `2v2 needs all four seats filled (seated players + AI players), not ${total}. ${fill}`;
    return s[1].length === 2 && s[2].length === 2 ? null : `2v2 needs ${split}`;
  }
  if (total !== 4) return `Two-Headed Giant needs all four seats filled (seated players + AI players), not ${total}. ${fill}`;
  if (s[1].length !== 2 || s[2].length !== 2) return `Two-Headed Giant needs ${split}`;
  const at = (c) => TEAM_COLORS.indexOf(c);
  const nextTo = (a, b) => Math.abs(at(a) - at(b)) === 1 || Math.abs(at(a) - at(b)) === TEAM_COLORS.length - 1;
  // (team 1 side by side among four seats leaves team 2 side by side too, so one test covers both)
  if (!nextTo(...s[1])) return `Partners sit next to each other in turn order (White, Red, Yellow, Blue): ${teamWords(s[1])} and ${teamWords(s[2])} don't. Use  mtg team <colour> <1|2>.`;
  return null;
}

// The node's gameConfig payload (self-hosted-node host.rs, java_backend GameConfig): teamRules and each player's team
// by relay username. usernames: the StartGame seat order; colors: each one's table colour, in the same order.
// Two-Headed Giant: life, poison and commander damage are left to the engine's 2HG defaults (30 / 80, 15, 42). 2v2:
// teamRules "teams", each player's life the engine's default. Juggernaut (jugg: juggOf; std: a Standard game): teams
// "teams", and the Juggernaut's life, hand, perks, own commander limit (only when not 21, Forge's) and first turn.
// turns "shared" (Two-Headed Giant only): teamRules "sharedTurns", Level 2's one turn for the team (CR 805, 810.2).
// Archenemy (arch: { color, names }, names the scheme deck to play): the flag archenemy, and the archenemy's life,
// first turn and schemes (the engine reads players[].schemes).
function gameConfig(teams, usernames, colors, mode = "2hg", jugg = null, std = false, turns = null, arch = null) {
  const rule = mode === "2hg" && turns === "shared" ? "sharedTurns" : TEAM_MODES[teamModeOf(mode)].rule;
  return { type: "gameConfig", teamRules: rule, ...(mode === "archenemy" ? { archenemy: true } : {}), players: usernames.map((u, i) => {
    const p = { username: u, team: teams[colors[i]] };
    if (mode === "archenemy") return arch && colors[i] === arch.color ? { ...p, startingLife: archLife(std), goesFirst: true, schemes: [...(arch.names || [])] } : p;
    if (mode !== "juggernaut" || !jugg || colors[i] !== jugg.color) return p;
    const perks = juggPerks(jugg);
    return { ...p, startingLife: juggLife(jugg, std), startingHand: jugg.hand, ...(perks.length ? { perks } : {}),
      ...(jugg.cmd !== 21 ? { commanderDamageToLose: jugg.cmd } : {}), goesFirst: true };
  }) };
}

// A board's teams, from the engine's own fields (teamRules, each player's teamNumber): null outside a team game. In a
// "teams" game (2v2, Juggernaut) a player alone on a team (the Juggernaut) has no teamNumber (the engine sends one only
// to a player with a teammate) and is a side of its own. slotColor: slot -> colour.
const teamKey = (p) => p.teamNumber ?? `alone:${p.id}`;
// The engine's rules where partners share life, poison and losing: Level 1 ("sharedLife", each player's own turn) and
// Level 2 ("sharedTurns": the team's one turn as well, CR 805 and 810.2). Every shared-life piece reads both.
const sharesLife = (pub) => pub?.teamRules?.rule === "sharedLife" || pub?.teamRules?.rule === "sharedTurns";
const sharesTurns = (pub) => pub?.teamRules?.rule === "sharedTurns";
function boardTeams(pub, slotColor) {
  const rules = pub?.teamRules;
  if (!rules || (!sharesLife(pub) && rules.rule !== "teams")) return null;
  const byTeam = new Map();
  for (const p of pub.players || []) {
    if (p.teamNumber == null && rules.rule !== "teams") continue;
    const key = teamKey(p);
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key).push(slotColor[p.id] || p.id);
  }
  return { rule: rules.rule, poison: rules.poisonToLose, cmd: rules.commanderDamageToLose ?? null, byTeam };
}

// The players on p's team, p too (by Forge's teamNumber); just p outside a shared-life game.
function teamOf(p, pub) {
  if (!sharesLife(pub) || p.teamNumber == null) return [p];
  return (pub.players || []).filter((q) => q.teamNumber === p.teamNumber);
}

// p with the commander damage its whole team took (the house rule, spec §12: a team loses at 42 from one commander), for the
// table's trackers: both partners show the team's number. p itself outside a team game.
function withTeamDamage(p, pub) {
  const team = teamOf(p, pub);
  if (team.length < 2) return p;
  const total = {};
  for (const q of team) for (const [cid, n] of Object.entries(q.commanderDamage || {})) total[cid] = (total[cid] || 0) + (Number(n) || 0);
  return { ...p, commanderDamage: total };
}

// The board's `teams` field for the table: { poison, cmd, sides: [[colours], ...], turns, won } in a shared-life game
// (turns: "shared" in a Level 2 game, where the table reads the active player's whole side as the one whose turn it is);
// { rule: "teams", mode, sides, juggernaut, won } in a 2v2 or Juggernaut game (mode: the bridge's game.teamMode when
// known; juggernaut: the lone side's colour in a Juggernaut game); else nothing. won: the winning team's colours once
// the game is over with a winner.
// archColor: the archenemy's colour in an Archenemy game (the board's archenemy).
function teamsField(pub, slotColor, mode = null, archColor = null) {
  const t = boardTeams(pub, slotColor);
  if (!t) return mode === "archenemy" && archColor ? archTeamsField(pub, slotColor, archColor) : {};
  const winner = pub.winnerId && (pub.players || []).find((p) => p.id === pub.winnerId);
  const won = winner && (winner.teamNumber != null || t.rule === "teams") ? t.byTeam.get(teamKey(winner)) || null : null;
  const sideList = [...t.byTeam.values()];
  if (t.rule === "teams") {
    const lone = mode === "juggernaut" ? sideList.find((side) => side.length === 1) : null;
    return { teams: { rule: "teams", ...(mode ? { mode } : {}), sides: sideList, ...(lone ? { juggernaut: lone[0] } : {}),
      ...(mode === "archenemy" && archColor ? { archenemy: archColor } : {}), ...(pub.gameOver && won ? { won } : {}) } };
  }
  return { teams: { poison: t.poison, ...(t.cmd != null ? { cmd: t.cmd } : {}), sides: sideList, ...(t.rule === "sharedTurns" ? { turns: "shared" } : {}),
    ...(pub.gameOver && won ? { won } : {}) } };
}

// Archenemy with no team numbers on the board: the engine names a team only when it has two players or more, so with
// two players (the archenemy against one) the sides come from the archenemy's colour: the archenemy, and the rest.
function archTeamsField(pub, slotColor, archColor) {
  const colors = (pub.players || []).map((p) => slotColor[p.id] || p.id);
  const others = colors.filter((c) => c !== archColor);
  if (!colors.includes(archColor) || !others.length) return {};
  const sideList = colors[0] === archColor ? [[archColor], others] : [others, [archColor]];
  const winner = pub.winnerId && (pub.players || []).find((p) => p.id === pub.winnerId);
  const winColor = winner ? slotColor[winner.id] || winner.id : null;
  const won = winColor == null ? null : winColor === archColor ? [archColor] : others;
  return { teams: { rule: "teams", mode: "archenemy", sides: sideList, archenemy: archColor, ...(pub.gameOver && won ? { won } : {}) } };
}

// The life counter's hover line in a shared-life game: "Team life: White + Red" (both partners' counters show the
// team's one total, 810.4), or null
function teamLifeTip(p, pub, slotColor) {
  const team = teamOf(p, pub);
  return team.length > 1 ? `Team life: ${teamWords(team.map((q) => slotColor[q.id] || q.id))}` : null;
}

// "POISON 3" -> "POISON 3/15" in a shared-life game (the team's count out of the team's limit)
function poisonLabel(label, pub) {
  const lim = sharesLife(pub) ? pub.teamRules.poisonToLose : null;
  return lim && /^POISON \d+$/.test(label) ? `${label}/${lim}` : label;
}

// The game's end in words, a team game's way: "White + Red win" for the winning team, "White wins" for a lone winner
// (the Juggernaut). won: from teamsField.
const teamWinWords = (won, nameOf) => `${teamWords(won.map(nameOf))} ${won.length === 1 ? "wins" : "win"}`;

// The teams said at setup, by mode (jugg: juggOf; std: a Standard game; turns: setupOf's, Two-Headed Giant's level)
function setupWords(mode, teams, jugg, std, turns = null, arch = null) {
  const s = sides(teams);
  if (mode === "archenemy" && arch) {
    const others = Object.keys(teams).filter((c) => c !== arch.color);
    return `Archenemy: ${arch.color} (${archWords(arch, std)}) vs ${teamWords(others)} (${std ? 20 : 40} life each, their own turns). The archenemy sets a scheme in motion at each of their first main phases; the archenemy wins when all the others have lost, and they win together when the archenemy loses. Undo is off in Archenemy games.`;
  }
  if (mode === "juggernaut") {
    return `Juggernaut: ${jugg.color} (${juggWords(jugg, std)}) vs ${teamWords(TEAM_COLORS.filter((c) => c !== jugg.color))} (${std ? 20 : 40} life each). The Juggernaut wins when all three have lost; the three win together when the Juggernaut loses.`;
  }
  if (mode === "2v2") return `2v2: ${teamWords(s[1])} vs ${teamWords(s[2])} (each player their own 20 life and turn; teammates can't attack each other; a team wins when both its opponents have lost).`;
  if (mode === "3hg") {
    const t = { 1: SIX_COLORS.filter((c) => teams[c] === 1), 2: SIX_COLORS.filter((c) => teams[c] === 2) };
    return `Three-Headed Giant: ${teamWords(t[1])} vs ${teamWords(t[2])} (shared life: ${std ? 45 : 120} a team, poison 20; each player takes their own turn, the team's back to back; the team blocks together).`;
  }
  if (turns === "shared") return `Two-Headed Giant: ${teamWords(s[1])} vs ${teamWords(s[2])} (shared life, poison 15; each team takes one turn together, attacks together and blocks together).`;
  return `Two-Headed Giant: ${teamWords(s[1])} vs ${teamWords(s[2])} (shared life, poison 15; each player takes their own turn, the team's back to back).`;
}

// ── Level 2: the team's shared turn (CR 805.4-805.5, 805.10; docs/game-modes-spec.md §5.4-5.5) ──
// The engine names one active player (the team's lead, its first seat in turn order) and still asks each question of
// one player; in a "sharedTurns" game the turn is the whole team's, so both partners are active players (sorcery timing,
// land plays, attacking, "Until my turn") and the other team the defending players. Outside a "sharedTurns" game each
// of these is the one active player, exactly as before.

// the ids of the players whose turn it is, the active player first: the active player's team in a shared-turn game
// (the engine's activeTeamIds when it sends them, tests/golden/fixtures/2hg-level2-protocol.json; else the players
// with the active player's teamNumber)
function turnPlayerIds(pub) {
  const a = pub?.activePlayerId;
  if (!a) return [];
  if (!sharesTurns(pub)) return [a];
  if (Array.isArray(pub.activeTeamIds) && pub.activeTeamIds.includes(a)) return [a, ...pub.activeTeamIds.filter((id) => id !== a)];
  const lead = (pub.players || []).find((p) => p.id === a);
  if (lead?.teamNumber == null) return [a];
  return [a, ...(pub.players || []).filter((p) => p.id !== a && p.teamNumber === lead.teamNumber).map((p) => p.id)];
}
// whether it is player id's turn (their team's, in a shared-turn game)
const isTurnOf = (pub, id) => id != null && turnPlayerIds(pub).includes(id);
// whether players a and b are partners in a shared-turn game (never outside one: there each player is their own side for
// the turn's stops, as before)
function turnPartners(pub, a, b) {
  if (!sharesTurns(pub) || a == null || b == null || a === b) return false;
  const pa = (pub.players || []).find((p) => p.id === a), pb = (pub.players || []).find((p) => p.id === b);
  return pa?.teamNumber != null && pa.teamNumber === pb?.teamNumber;
}
// player id's partner in a shared-turn game, or null
const turnPartnerOf = (pub, id) => (sharesTurns(pub) ? (pub.players || []).find((p) => turnPartners(pub, id, p.id))?.id || null : null);
// whose turn, as said to player id: "your" / "White's", and in a shared-turn game "your team's" / "White + Red's"
// (nameOf: id -> the player's name)
function turnWhose(pub, id, nameOf) {
  if (!sharesTurns(pub)) return pub.activePlayerId === id ? "your" : `${nameOf(pub.activePlayerId)}'s`;
  const ids = turnPlayerIds(pub);
  return ids.includes(id) ? "your team's" : `${teamWords(ids.map(nameOf))}'s`;
}
// What each partner declared in this turn's combat, by their answers (bridge.js keeps it as game.teamDecl:
// { turn, attacks: { slot: [{ attackerId, targetId }] }, blocks: { slot: [{ blockerId, attackerId }] } }): the engine
// asks the second partner before any board shows the first one's part. The partner's part of kind ("attacks" or
// "blocks"), [] when none is kept for this turn.
const declaredBy = (decl, pub, slot, kind) => (decl && decl.turn === pub.turn && decl[kind]?.[slot]) || [];
// The attack question of a player in a shared-turn game (805.10a-b: one combined attack, each player declares their own
// creatures; the engine asks the partners one after the other): the line that says so, with what the partner already
// attacks with (on the board, isAttacking, or in their answer, decl). cards: the board's cards (isAttacking,
// attackTargetId, controllerId); cname(id): a card's or a player's words; nameOf(id): a player's name. [] outside a
// shared-turn game.
function teamAttackLines(pub, who, cards, cname, nameOf, decl = null) {
  const partner = turnPartnerOf(pub, who);
  if (!partner) return [];
  const at = new Map();
  for (const c of cards) if (c.isAttacking && (c.controllerId || c.ownerId) === partner) at.set(c.id, c.attackTargetId || null);
  for (const a of declaredBy(decl, pub, partner, "attacks")) if (a.attackerId && !at.get(a.attackerId)) at.set(a.attackerId, a.targetId || null);
  if (!at.size) return [`Your team attacks together: you pick your creatures, ${nameOf(partner)} picks theirs.`];
  return [`Your team attacks together. ${nameOf(partner)} attacks with ${[...at].map(([id, tgt]) => `${cname(id)}${tgt ? ` → ${cname(tgt)}` : ""}`).join(", ")}. Now pick yours.`];
}
// The block question of a defending player in a shared-turn game (805.10d: the team blocks as one, and a defender may
// block a creature attacking either partner): the lines that say so, with the partner's blocks already on the board.
// blocks: Forge's combatAssignments; controllerOf(id): a card's controller; decl: as teamAttackLines'. [] outside a
// shared-turn game.
function teamBlockLines(pub, who, blocks, controllerOf, cname, nameOf, decl = null) {
  const partner = turnPartnerOf(pub, who);
  if (!partner) return [];
  const seen = new Set();
  const theirs = [...(blocks || []), ...declaredBy(decl, pub, partner, "blocks")].filter((a) => {
    const key = `${a.blockerId}|${a.attackerId}`;
    if (!a.blockerId || !a.attackerId || seen.has(key) || controllerOf(a.blockerId) !== partner) return false;
    seen.add(key);
    return true;
  });
  const head = `Your team blocks together: you and ${nameOf(partner)} can each block any attacker, even one attacking your partner.`;
  return theirs.length ? [head, `${nameOf(partner)} blocks: ${theirs.map((a) => `${cname(a.blockerId)} blocks ${cname(a.attackerId)}`).join(", ")}.`] : [head];
}

// The team's trigger order (805.7: the active team puts all its triggers on the stack in one order, which the primary
// player, the team's first seat, picks, 805.2): asked of who with both partners' triggers in items (each { id, card }).
// { partner, theirs: the partner's item ids, hint, toPartner } when some item is the partner's, else null.
function teamTriggerWords(pub, who, items, nameOf) {
  const partner = turnPartnerOf(pub, who);
  if (!partner) return null;
  const theirs = new Set((items || []).filter((i) => (i.card?.controllerId || i.card?.ownerId) === partner).map((i) => i.id));
  if (!theirs.size) return null;
  return { partner, theirs,
    hint: `You order your team's triggers, ${nameOf(partner)}'s too (you are the team leader). The one you click first happens first. Not sure? Keep this order.`,
    toPartner: `${nameOf(who)} is putting your team's triggers in order, yours too (the team leader does).` };
}
// A refused team attack or block (track C, docs/2hg-level2-combat.md: a notice with no cards to every player of the
// team, "Attack declaration invalid" or "Block declaration invalid: <reason>", then each is asked again, first seat
// first): the words for player who, or null outside a shared-turn game or for any other notice.
function teamRefusalWords(pub, who, title, nameOf) {
  const m = /^(Attack|Block) declaration invalid\b:?\s*(.*)$/i.exec(String(title || "").trim());
  if (!m || !turnPartnerOf(pub, who)) return null;
  const team = (pub.players || []).filter((p) => p.id === who || turnPartners(pub, who, p.id)).map((p) => p.id);
  const attack = m[1].toLowerCase() === "attack";
  const why = m[2] ? ` ${m[2].replace(/\.?$/, ".")}` : "";
  return `Your team's ${attack ? "attack" : "blocks"} together ${attack ? "isn't" : "aren't"} legal.${why} You are both asked again, ${nameOf(team[0])} first.`;
}
// ── The team's joint block (engine team-block, CR 805.10d and 805.2; docs/game-modes-spec.md §5.12) ──
// A Two-Headed Giant team block asks each defender in turn, again after a partner changes the team's block, until an
// answer changes nothing; after 4 revise rounds the primary player's latest answer stands. The chooseBlockers prompt
// then carries four optional fields: title ("Block with Yellow", "Yellow changed the blocks. Agree or change?"),
// reviseRound (1-4, absent in round 1), currentAssignments (the defender's own blocks: sent back unchanged, they are
// "Agree") and teamBlockLines (one line per attacker, "Goblin Guide -> your Bear + Yellow's Wall"). A prompt without
// any of them (free-for-all, 2v2, Juggernaut, an older engine) is no joint block: null.
function jointBlock(input) {
  if (!input || !["title", "reviseRound", "currentAssignments", "teamBlockLines"].some((k) => input[k] != null)) return null;
  return {
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : null,
    round: Number.isInteger(input.reviseRound) && input.reviseRound > 0 ? input.reviseRound : null,
    // (the answer Agree sends: the prompt's own list, untouched; null when the prompt has none, and then no Agree)
    agree: Array.isArray(input.currentAssignments) ? JSON.parse(JSON.stringify(input.currentAssignments)) : null,
    // (the option ids to pre-fill, "<blocker>|<attacker>")
    on: new Set((Array.isArray(input.currentAssignments) ? input.currentAssignments : []).filter((a) => a && a.blockerId && a.attackerId).map((a) => `${a.blockerId}|${a.attackerId}`)),
    lines: Array.isArray(input.teamBlockLines) ? input.teamBlockLines.map((l) => String(l)) : [],
  };
}
// The table's seat colours (TTS's player colours) as text colours, for a player's name in the team's block
const SEAT_HEX = { White: "#FFFFFF", Brown: "#C08050", Red: "#FF5A4F", Orange: "#F4641D", Yellow: "#E7E52C", Green: "#31B32B",
  Teal: "#21B19B", Blue: "#4DA3FF", Purple: "#B45CF0", Pink: "#F570CE" };
// The team's block as the panel shows it: one line per attacker, "->" drawn as an arrow, each other player's name
// ("Yellow's Wall of Wood") in their seat colour (TTS rich text). players: [{ name, color }] as the lines name them
// (the bridge's table names). colored false: the plain lines (the corner's note, which is cut to length).
function jointBlockLines(lines, players, colored = true) {
  return (lines || []).map((line) => {
    let out = String(line).split(" -> ").join(" → ");
    if (!colored) return out;
    for (const p of players || []) {
      const hex = SEAT_HEX[p.color];
      const said = `${p.name}'s `;
      if (hex && p.name && out.includes(said)) out = out.split(said).join(`<color=${hex}>${p.name}'s</color> `);
    }
    return out;
  });
}
// A joint block's notice (a no-card revealCards to each defender): a change, "Yellow: Wall of Wood now blocks Hill
// Giant." / "Blue: Centaur Courser no longer blocks.", said as it is; the cap's "Yellow decides (team leader)" (the
// owner's wording, 2026-11-17: the engine sends it so from engine1121-ownerdecisions), said as it is. An engine before
// that sends "Yellow settles the team's blocks (rule 805.2)", said the new way.
// { kind: "change" | "settle", line }, or null for any other notice.
function teamBlockNotice(text) {
  const t = String(text || "").trim();
  const settle = /^(.+?) decides \(team leader\)\.?$/.exec(t) || /^(.+?) settles the team's blocks \(rule 805\.2\)\.?$/.exec(t);
  if (settle) return { kind: "settle", line: `${settle[1]} decides (team leader)` };
  if (/^[^:]+: .+ (?:now blocks .+|no longer blocks)\.$/.test(t)) return { kind: "change", line: t };
  return null;
}
module.exports = { seatColorsFor, jointBlock, jointBlockLines, teamBlockNotice, SEAT_HEX, teamTriggerWords, teamRefusalWords, sharesLife, sharesTurns, turnPlayerIds, isTurnOf, turnPartners, turnPartnerOf, turnWhose, teamAttackLines, teamBlockLines, TEAM_COLORS, DEFAULT_TEAMS, TEAM_MODES, JUGG_DEFAULTS, setupOf, teamModeOf, teamModeProblem, juggOf, juggLife, juggTeams, juggPerks, juggWords,
  setupWords, teamsOf, teamWords, sides, teamsProblem, gameConfig, boardTeams, teamOf, withTeamDamage, teamsField, teamLifeTip,
  poisonLabel, teamWinWords, ARCH_DEFAULTS, ARCH_SCHEMES, ARCH_COPIES, archOf, archTeams, archLife, schemeDeckProblem, archWords, SIX_COLORS, THREE_TEAMS };
