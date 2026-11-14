// Two-Headed Giant for the bridge (docs/game-modes-spec.md §4, §5.5, Level 1): the table's teams, checked at start,
// the engine's gameConfig, and what a team game adds to the table's board. The table keeps the choice (ENGINE_TEAMS in
// engine-renderer.lua: "mtg mode 2hg", "mtg team <colour> <1|2>") and sends it with every start, as it sends free
// mulligans, so a restarted bridge needs nothing kept here. Kept out of bridge.js so the other game modes' work there
// (Standard's MODES) and this one meet only at their call sites.
//
// Level 1: partners share life (30 a team, 80 in Commander), poison (15) and a commander's damage (42 in Commander),
// lose together, block for each other and see each other's hands; each player still takes their own turn, the team's
// back to back, and the starting team skips its first draws. The engine does all of that once the node's gameConfig
// says teamRules "sharedLife" (engine/forge.patch, forge-harness ManaBrewEngineAdapter.configureTeamRules); the bridge
// only says who is on which team.

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

// colour list -> "White + Red"
const teamWords = (colors) => colors.join(" + ");
// the colours of each team, in turn order: { 1: [...], 2: [...] }
function sides(teams) {
  const out = { 1: [], 2: [] };
  for (const c of TEAM_COLORS) out[teams[c]].push(c);
  return out;
}

// Why these teams can't start a Level 1 game of `total` players (null when they can): two teams of two, every seat
// filled (AI players take the empty ones), and partners next to each other in turn order, round the table (the team
// plays its turns back to back, and the engine's first-draw skip counts the starting team's first turns).
function teamsProblem(teams, total) {
  if (total !== 4) return `Two-Headed Giant needs all four seats filled (seated players + AI players), not ${total}. Add AI players with  mtg start ai N  or  mtg ai <colour> forge.`;
  const s = sides(teams);
  if (s[1].length !== 2 || s[2].length !== 2) return `Two-Headed Giant needs two teams of two (now team 1: ${teamWords(s[1]) || "nobody"}, team 2: ${teamWords(s[2]) || "nobody"}). Use  mtg team <colour> <1|2>.`;
  const at = (c) => TEAM_COLORS.indexOf(c);
  const nextTo = (a, b) => Math.abs(at(a) - at(b)) === 1 || Math.abs(at(a) - at(b)) === TEAM_COLORS.length - 1;
  // (team 1 side by side among four seats leaves team 2 side by side too, so one test covers both)
  if (!nextTo(...s[1])) return `Partners sit next to each other in turn order (White, Red, Yellow, Blue): ${teamWords(s[1])} and ${teamWords(s[2])} don't. Use  mtg team <colour> <1|2>.`;
  return null;
}

// The node's gameConfig payload (self-hosted-node host.rs, java_backend GameConfig): teamRules and each player's team
// by relay username. usernames: the StartGame seat order; colors: each one's table colour, in the same order. Life,
// poison and commander damage are left to the engine's 2HG defaults (30 / 80, 15, 42).
function gameConfig(teams, usernames, colors) {
  return { type: "gameConfig", teamRules: "sharedLife", players: usernames.map((u, i) => ({ username: u, team: teams[colors[i]] })) };
}

// A board's teams, from the engine's own fields (teamRules, each player's teamNumber): null unless the game shares
// life. slotColor: slot -> colour.
function boardTeams(pub, slotColor) {
  const rules = pub?.teamRules;
  if (!rules || rules.rule !== "sharedLife") return null;
  const byTeam = new Map();
  for (const p of pub.players || []) {
    if (p.teamNumber == null) continue;
    if (!byTeam.has(p.teamNumber)) byTeam.set(p.teamNumber, []);
    byTeam.get(p.teamNumber).push(slotColor[p.id] || p.id);
  }
  return { poison: rules.poisonToLose, cmd: rules.commanderDamageToLose ?? null, byTeam };
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

// The board's `teams` field for the table: { poison, cmd, sides: [[colours], ...], won } in a shared-life game, else
// nothing. won: the winning team's colours once the game is over with a winner.
function teamsField(pub, slotColor) {
  const t = boardTeams(pub, slotColor);
  if (!t) return {};
  const winner = pub.winnerId && (pub.players || []).find((p) => p.id === pub.winnerId);
  const won = winner && winner.teamNumber != null ? t.byTeam.get(winner.teamNumber) || null : null;
  return { teams: { poison: t.poison, ...(t.cmd != null ? { cmd: t.cmd } : {}), sides: [...t.byTeam.values()], ...(pub.gameOver && won ? { won } : {}) } };
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

// The game's end in words, a team game's way: "White + Red win" for the winning team. won: from teamsField.
const teamWinWords = (won, nameOf) => `${teamWords(won.map(nameOf))} win`;

module.exports = { TEAM_COLORS, DEFAULT_TEAMS, teamsOf, teamWords, sides, teamsProblem, gameConfig, boardTeams, teamOf, withTeamDamage, teamsField, teamLifeTip, poisonLabel, teamWinWords };
