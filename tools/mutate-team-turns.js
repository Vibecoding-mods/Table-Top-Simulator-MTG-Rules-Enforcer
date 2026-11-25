// Break-it for the Team turns button, Three-Headed Giant's shared turns and the removed partner-hand copies
// (tests/test_table_team_turns.js, tests/test_bridge_3hg_turns.js, tests/test_table_teams.js, tests/test_bridge_teams.js):
// each mutation breaks one piece, runs its test and must make the named check fail; the file is then written back from
// the bytes read before and checked by sha256.
//   node tools/mutate-team-turns.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const R = "tools/engine-renderer.lua", TJ = "bridge/teams.js", BJ = "bridge/bridge.js", MC = "tools/make-engine-copy.js";
const TT = "tests/test_table_team_turns.js", B3 = "tests/test_bridge_3hg_turns.js";

// [label, file, from, to, test, the check that must fail]; `from` must occur exactly once
const MUTATIONS = [
  ["button: never drawn", R, "      if SETUP.drawn.turns then\n", "      if false then\n", TT, "4-player: in 2HG the button on the setup tile, label Own, a quarter turned, 1700 x 620"],
  ["button: drawn in every mode", R, "      SETUP.drawn.turns = engineTeamTurnsLabel ~= nil and engineTeamTurnsMode() or nil", "      SETUP.drawn.turns = engineTeamTurnsLabel ~= nil or nil", TT, "4-player: no Team turns button in free-for-all"],
  ["button: shown during a game", R, "      -- (and Team turns beside it, Two-Headed and Three-Headed Giant only: onMtgSetupTeamTurns; yellow when shared)\n",
    "    end\n    if tile ~= nil and engineTeamTurnsMode() and running then setupButton(tile, \"onMtgSetupTeamTurns\", engineTeamTurnsLabel(), SETUP.color.idle, engineTeamTurnsSpot(), nil, 1700, 620, 90) end\n    if true then\n", TT, "4-player: hidden during a game"],
  ["button: at the Teams spot", R, "  return Vector(TEAMS_SPOT.x - 4, TEAMS_SPOT.y, TEAMS_SPOT.z)", "  return Vector(TEAMS_SPOT.x, TEAMS_SPOT.y, TEAMS_SPOT.z)", TT, "spot: 4 out from Teams on the west strip"],
  ["button: x not mirrored", R, "  pos.x = -pos.x\n  -- (the playmats and the tile are stretched objects", "  -- (the playmats and the tile are stretched objects", TT, "4-player: drawn at its spot, x mirrored as every tile button"],
  ["click: always shared", R, "\" turns \" .. (ENGINE_TEAM_TURNS == \"shared\" and \"own\" or \"shared\"), pl)", "\" turns shared\", pl)", TT, "click (2HG, shared): exactly  mtg 2hg turns own"],
  ["click: always 2hg", R, "engineChat(\"mtg \" .. (ENGINE_TEAM_MODE == \"3hg\" and \"3hg\" or \"2hg\") .. \" turns \"", "engineChat(\"mtg 2hg turns \"", TT, "click (3HG): exactly  mtg 3hg turns shared"],
  ["click: skips the chat (no host check)", R, "function onMtgSetupTeamTurns(obj, playerColor)\n  local pl = Player[playerColor]\n  if pl == nil then return end\n",
    "function onMtgSetupTeamTurns(obj, playerColor)\n  local pl = Player[playerColor]\n  if pl == nil then return end\n  if true then ENGINE_TEAM_TURNS = ENGINE_TEAM_TURNS == nil and \"shared\" or nil return end\n", TT, "click: not the host, refused, nothing changes"],
  ["label: always Own", R, "(ENGINE_TEAM_TURNS == \"shared\" and \"Shared\" or \"Own\")", "\"Own\"", TT, "click: the label says Shared"],
  ["table: 3HG sends no team turns", R, "(ENGINE_TEAM_MODE == \"2hg\" or ENGINE_TEAM_MODE == \"3hg\")) end", "ENGINE_TEAM_MODE == \"2hg\") end", TT, "3HG: Start sends teamTurns shared (no longer ignored)"],
  ["table: mtg 3hg turns not a command", R, "(rest:sub(1, 3) == \"2hg\" or rest:sub(1, 3) == \"3hg\")", "rest:sub(1, 3) == \"2hg\"", TT, "3HG: mtg 3hg turns says the setting and how"],
  ["table: said as Two-Headed Giant in 3HG", R, "local three = (engineTeamTurnsMode() and ENGINE_TEAM_MODE or word) == \"3hg\"", "local three = word == \"3hg\"", TT, "3HG: the one setting, typed as 2hg too, named by the mode set"],
  ["table: Teams label without 3HG team turns", R, "m == \"3hg\" and (ENGINE_TEAM_TURNS == \"shared\" and \"3HG team turns\" or \"3HG\")", "m == \"3hg\" and \"3HG\"", TT, "3HG: the Teams button says 3HG team turns"],
  ["concede: both for three", MC, "(#team > 2 and \"all\" or \"both\")", "\"both\"", TT, "six-seat: a 3HG concede is for all three"],
  ["bridge: 3HG shared turns dropped", TJ, "turns: m?.teamTurns === \"shared\" ? \"shared\" : null };", "turns: null };", B3, "setupOf: 3HG with teamTurns shared is Level 2"],
  ["bridge: 3HG gameConfig sharedLife", TJ, "(mode === \"2hg\" || mode === \"3hg\") && turns === \"shared\" ? \"sharedTurns\"", "mode === \"2hg\" && turns === \"shared\" ? \"sharedTurns\"", B3, "gameConfig: 3HG shared turns ask the engine for sharedTurns"],
  ["bridge: the game drops 3HG teamTurns", BJ, "((teamMode === \"2hg\" || teamMode === \"3hg\") && turns === \"shared\" ? { teamTurns: \"shared\" } : {})", "(teamMode === \"2hg\" && turns === \"shared\" ? { teamTurns: \"shared\" } : {})", B3, "start: the game keeps teamTurns shared for 3HG"],
  ["bridge: 3HG setup words own turns", TJ, "${turns === \"shared\"\n      ? \"each team takes one turn together", "${false\n      ? \"each team takes one turn together", B3, "setup words: 3HG shared turns"],
  ["bridge: one partner only", TJ, "const turnPartnersOf = (pub, id) => (sharesTurns(pub) ? (pub.players || []).filter((p) => turnPartners(pub, id, p.id)).map((p) => p.id) : []);",
    "const turnPartnersOf = (pub, id) => (sharesTurns(pub) ? (pub.players || []).filter((p) => turnPartners(pub, id, p.id)).map((p) => p.id).slice(0, 1) : []);", B3, "attack: nothing declared yet, both partners named"],
  ["bridge: andWords joins with +", TJ, "`${names.slice(0, -1).join(\", \")} and ${names[names.length - 1]}`", "names.join(\" + \")", B3, "andWords: one, two, three"],
  ["bridge: attack words always 'picks'", TJ, "${partners.length === 1 ? \"picks\" : \"pick\"} theirs.", "picks theirs.", B3, "attack: nothing declared yet, both partners named"],
  ["bridge: block head for two only", TJ, "  const lines = partners.length === 1\n", "  const lines = true\n", B3, "block: the head names both partners, each partner's blocks a line"],
  ["bridge: trigger whose = first partner", TJ, "    if (all.includes(ctl)) whose.set(i.id, ctl);", "    if (all.includes(ctl)) whose.set(i.id, all[0]);", B3, "triggers: both partners' triggers, the hint names both"],
  ["bridge: refusal always both", TJ, "You are ${team.length > 2 ? \"all\" : \"both\"} asked again", "You are both asked again", B3, "refusal: you are all asked again"],
  ["bridge: only the first partner told", BJ, "      for (const p of teamTrig?.partners || []) {", "      for (const p of (teamTrig?.partners || []).slice(0, 1)) {", B3, "trigger order: Red and Yellow are each told, nobody else"],
  ["bridge: trigger label by the first partner", BJ, "`${nameOf(teamTrig.whose.get(i.id))}'s `", "`${nameOf(teamTrig.partner)}'s `", B3, "trigger order: each partner's trigger named by its owner"],
  // (the partner's hand copies, removed: putting one back must fail by name)
  ["stand-ins back: the bridge sends teamHand", BJ, "    // team, engine-renderer.lua engineTtsTeams; revealedOf above keeps it out of the rows shown to everyone)\n    return row;",
    "    // team, engine-renderer.lua engineTtsTeams; revealedOf above keeps it out of the rows shown to everyone)\n    if (teams2hg.teamOf(p, pub).length > 1) { row.teamHand = []; row.teamBy = \"Blue\"; }\n    return row;", "tests/test_bridge_teams.js", "board: no copy of a partner's hand is sent (no teamHand / teamBy, any board)"],
  ["stand-ins back: the table lays them", R, "  okCtl, errCtl = pcall(engineTtsTeams, m)\n",
    "  okCtl, errCtl = pcall(engineTtsTeams, m)\n  for _, pl in ipairs(m.players or {}) do for _, c in ipairs(pl.teamHand or {}) do local g = seatGeometry(pl.teamBy) local s = Player[pl.teamBy].getHandTransform(2) place(engineStandIn(c, \"team:\" .. pl.teamBy .. \":\" .. c.id, \"look only\"), s.position + Vector(0, 1, 0), Vector(0, g.rotY, 0), seen, pl.teamBy, { zone = \"partner\", color = pl.teamBy, hand2 = true }) end end\n",
    "tests/test_table_teams.js", "hands: no copy of a partner's hand is made (no engine:team: stand-in, nothing in a second hand zone)"],
  ["bridge: a partner's hand shown to everyone", BJ, "s.slot !== by && !mates.has(s.slot));", "s.slot !== by);", "tests/test_bridge_teams.js", "board: a partner's hand is not shown to everyone"],
];

const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
const list = MUTATIONS.filter(([label]) => !only || only.test(label));
const run = (t) => { const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: "utf8", timeout: 900000, maxBuffer: 1 << 28 }); return (r.stdout || "") + (r.stderr || ""); };
const failsBy = (out, name) => out.split("\n").some((l) => l.startsWith(`FAIL ${name}`));
let bad = 0;
for (const t of [...new Set(list.map((m) => m[4]))]) {
  const out = run(t);
  if (/^FAIL /m.test(out)) { console.log(`BASELINE FAILS: ${t}: ${out.split("\n").filter((l) => /^FAIL/.test(l)).slice(0, 3).join(" | ")}`); process.exit(1); }
}
console.log("baseline: green");
for (const [label, rel, from, to, test, check] of list) {
  const file = path.join(ROOT, rel);
  const bytes = fs.readFileSync(file);
  const before = sha(file);
  const text = bytes.toString("utf8");
  if (text.split(from).length !== 2) { console.log(`?? ${label}: the code to break is not there once`); bad++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let out;
  try { out = run(test); } finally { fs.writeFileSync(file, bytes); }
  const restored = sha(file) === before;
  const caught = failsBy(out, check);
  if (!caught || !restored) bad++;
  console.log(`${caught ? "caught" : "SURVIVED"}: ${label} -> ${caught ? check : out.split("\n").filter((l) => /^FAIL/.test(l)).slice(0, 2).join(" | ") || "(nothing failed)"}${restored ? "" : "  RESTORE MISMATCH"}`);
}
console.log(bad ? `${bad} of ${list.length} not caught by name (or not restored)` : `all ${list.length} caught by name, every file restored by sha256`);
process.exit(bad ? 1 : 0);
