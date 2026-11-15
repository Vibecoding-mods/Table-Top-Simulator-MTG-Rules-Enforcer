// The team modes for the bridge (docs/game-modes-spec.md §4, §4.1, §5.5, §6): Two-Headed Giant (Level 1), 2v2 Team
// Commander and Juggernaut (3v1). The table's teams, checked at start, the engine's gameConfig, and what a team game
// adds to the table's board. The table keeps the choice (ENGINE_TEAMS, ENGINE_TEAM_MODE and ENGINE_JUGG in
// engine-renderer.lua: "mtg mode 2hg|2v2|juggernaut|ffa", "mtg team <colour> <1|2>", "mtg juggernaut ...") and sends it
// with every start, as it sends free mulligans, so a restarted bridge needs nothing kept here. Kept out of bridge.js so
// the other game modes' work there (Standard's MODES) and this one meet only at their call sites.
//
// The three share one plumbing (§4): every player's team (and the Juggernaut's life, hand, perks, commander limit and
// first turn) go to the node as gameConfig before StartGame; the engine's teamRules ("sharedLife" or "teams") and each
// player's teamNumber come back on every board.
//
// Two-Headed Giant, Level 1: partners share life (30 a team, 80 in Commander), poison (15) and a commander's damage (42
// in Commander), lose together, block for each other and see each other's hands; each player still takes their own
// turn, the team's back to back, and the starting team skips its first draws. The engine does all of that once the
// node's gameConfig says teamRules "sharedLife" (engine/forge.patch, forge-harness ManaBrewEngineAdapter.configureTeamRules);
// the bridge only says who is on which team.
//
// 2v2 Team Commander (§4.1): two teams of two, each player their own life (the format's: 40, or 20 in Standard) and
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

const TEAM_COLORS = ["White", "Red", "Yellow", "Blue"]; // (the table's seats in turn order, bridge.js TABLE_COLORS)
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

// A start message's team setup (its teams, teamMode, juggernaut and teamDraws fields): { teams, mode, jugg }; teams null
// is a free-for-all game. A Juggernaut start's teams come from the Juggernaut's colour, whatever teams it sent. A
// Two-Headed Giant start also has teamDraws: the table's teamDraws setting, true only when it is exactly true.
function setupOf(m) {
  if (m?.teamMode === "juggernaut") {
    const jugg = juggOf(m.juggernaut);
    return { teams: juggTeams(jugg.color), mode: "juggernaut", jugg };
  }
  const teams = teamsOf(m?.teams);
  const mode = teams ? teamModeOf(m?.teamMode) : null;
  return { teams, mode, jugg: null, ...(mode === "2hg" ? { teamDraws: m.teamDraws === true } : {}) };
}

// The team modes: what a start's teamMode can be (teams sent with none: Two-Headed Giant, as the table sent before 2v2
// and Juggernaut), the engine's rule for each, and its name in chat.
const TEAM_MODES = {
  "2hg": { rule: "sharedLife", name: "Two-Headed Giant" },
  "2v2": { rule: "teams", name: "2v2 Team Commander" },
  juggernaut: { rule: "teams", name: "Juggernaut" },
};
const teamModeOf = (raw) => (Object.prototype.hasOwnProperty.call(TEAM_MODES, raw) ? raw : "2hg");

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
function teamsProblem(teams, total, mode = "2hg") {
  const fill = "Add AI players with  mtg start ai N  or  mtg ai <colour> forge.";
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
// teamDraws (shared-life games only): the table's teamDraws setting, true only when it is exactly true.
function gameConfig(teams, usernames, colors, mode = "2hg", jugg = null, std = false, teamDraws = false) {
  const rule = TEAM_MODES[teamModeOf(mode)].rule;
  return { type: "gameConfig", teamRules: rule, ...(rule === "sharedLife" ? { teamDraws: teamDraws === true } : {}), players: usernames.map((u, i) => {
    const p = { username: u, team: teams[colors[i]] };
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
function boardTeams(pub, slotColor) {
  const rules = pub?.teamRules;
  if (!rules || (rules.rule !== "sharedLife" && rules.rule !== "teams")) return null;
  const byTeam = new Map();
  for (const p of pub.players || []) {
    if (p.teamNumber == null && rules.rule === "sharedLife") continue;
    const key = teamKey(p);
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key).push(slotColor[p.id] || p.id);
  }
  return { rule: rules.rule, poison: rules.poisonToLose, cmd: rules.commanderDamageToLose ?? null, byTeam };
}

// The players on p's team, p too (by Forge's teamNumber); just p outside a shared-life game.
function teamOf(p, pub) {
  if (pub?.teamRules?.rule !== "sharedLife" || p.teamNumber == null) return [p];
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

// The board's `teams` field for the table: { poison, cmd, sides: [[colours], ...], won } in a shared-life game;
// { rule: "teams", mode, sides, juggernaut, won } in a 2v2 or Juggernaut game (mode: the bridge's game.teamMode when
// known; juggernaut: the lone side's colour in a Juggernaut game); else nothing. won: the winning team's colours once
// the game is over with a winner.
function teamsField(pub, slotColor, mode = null) {
  const t = boardTeams(pub, slotColor);
  if (!t) return {};
  const winner = pub.winnerId && (pub.players || []).find((p) => p.id === pub.winnerId);
  const won = winner && (winner.teamNumber != null || t.rule === "teams") ? t.byTeam.get(teamKey(winner)) || null : null;
  const sideList = [...t.byTeam.values()];
  if (t.rule === "teams") {
    const lone = mode === "juggernaut" ? sideList.find((side) => side.length === 1) : null;
    return { teams: { rule: "teams", ...(mode ? { mode } : {}), sides: sideList, ...(lone ? { juggernaut: lone[0] } : {}), ...(pub.gameOver && won ? { won } : {}) } };
  }
  return { teams: { poison: t.poison, ...(t.cmd != null ? { cmd: t.cmd } : {}), sides: sideList, ...(pub.gameOver && won ? { won } : {}) } };
}

// The life counter's hover line in a shared-life game: "Team life: White + Red" (both partners' counters show the
// team's one total, 810.4), or null
function teamLifeTip(p, pub, slotColor) {
  const team = teamOf(p, pub);
  return team.length > 1 ? `Team life: ${teamWords(team.map((q) => slotColor[q.id] || q.id))}` : null;
}

// "POISON 3" -> "POISON 3/15" in a shared-life game (the team's count out of the team's limit)
function poisonLabel(label, pub) {
  const lim = pub?.teamRules?.rule === "sharedLife" ? pub.teamRules.poisonToLose : null;
  return lim && /^POISON \d+$/.test(label) ? `${label}/${lim}` : label;
}

// The game's end in words, a team game's way: "White + Red win" for the winning team, "White wins" for a lone winner
// (the Juggernaut). won: from teamsField.
const teamWinWords = (won, nameOf) => `${teamWords(won.map(nameOf))} ${won.length === 1 ? "wins" : "win"}`;

// The teams said at setup, by mode (jugg: juggOf; std: a Standard game)
function setupWords(mode, teams, jugg, std) {
  const s = sides(teams);
  if (mode === "juggernaut") {
    return `Juggernaut: ${jugg.color} (${juggWords(jugg, std)}) vs ${teamWords(TEAM_COLORS.filter((c) => c !== jugg.color))} (${std ? 20 : 40} life each). The Juggernaut wins when all three have lost; the three win together when the Juggernaut loses.`;
  }
  if (mode === "2v2") return `2v2 Team Commander: ${teamWords(s[1])} vs ${teamWords(s[2])} (each player their own life and turn; teammates can't attack each other; a team wins when both its opponents have lost).`;
  return `Two-Headed Giant: ${teamWords(s[1])} vs ${teamWords(s[2])} (shared life, poison 15; each player takes their own turn, the team's back to back).`;
}

module.exports = { TEAM_COLORS, DEFAULT_TEAMS, TEAM_MODES, JUGG_DEFAULTS, setupOf, teamModeOf, juggOf, juggLife, juggTeams, juggPerks, juggWords,
  setupWords, teamsOf, teamWords, sides, teamsProblem, gameConfig, boardTeams, teamOf, withTeamDamage, teamsField, teamLifeTip,
  poisonLabel, teamWinWords };
