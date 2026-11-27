// Three-Headed Giant in the bridge (docs/game-modes-spec.md §8, rule 810.11; bridge/teams.js THREE_TEAMS, setupOf,
// teamsProblem, gameConfig, setupWords; bridge.js startGame's six-seat check): 3v3 on the six-seat table, the teams the
// table's sides (White + Red + Yellow vs Green + Blue + Purple), Level 1 turns, shared life and poison left to the
// engine's numbers for three (45 / 20; 120 in Commander), the board's sides and limits, the joint block panel with two
// partners named, and the refusals (a four-seat table, seats not all filled). 2HG, 2v2 and Juggernaut keep their own
// (tests/test_bridge_teams.js, tests/test_bridge_team_modes.js).
//   node tests/test_bridge_3hg.js
const harness = require("./bridge-harness");
const T = require("../bridge/teams");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const chats = (h) => h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const relay = (h) => h.effects.map((e) => e.relay).filter(Boolean);
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const frame = (ws, msg) => ws.emit("message", JSON.stringify(msg));
const SIX = ["White", "Red", "Yellow", "Green", "Blue", "Purple"];
const sixTable = (h) => h.B.onTTS({ t: "hello", json: JSON.stringify({ tableSeats: SIX }) });

// Blue at the table, five Forge AIs: the start's relay messages up to StartGame, and each colour's team in gameConfig
async function startFlow(h) {
  const g = h.B._getGame();
  const blue = g.seats.get("Blue");
  blue.heartbeat = () => {};
  blue.ws.emit("open");
  frame(blue.ws, { type: "AuthResult", success: true });
  frame(blue.ws, { type: "RoomList", rooms: [{ room_id: "room-1", room_name: "tts-commander", status: "Lobby" }] });
  const bots = ["Forge AI", "Forge AI 2", "Forge AI 3", "Forge AI 4", "Forge AI 5"].map((u) => ({ username: u, ready: true, connected: true, is_bot: true }));
  frame(blue.ws, { type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 6, players: [{ username: blue.username, ready: true, connected: true }, ...bots] } });
  await h.flush();
  const out = relay(h);
  const cfgAt = out.findIndex((r) => r.type === "BroadcastState" && r.state?.payload?.type === "gameConfig");
  const startAt = out.findIndex((r) => r.type === "StartGame");
  const cfg = out[cfgAt]?.state?.payload;
  const order = out[startAt]?.seat_order || [];
  const byColor = {};
  (g.seatColors || []).forEach((c, i) => { byColor[c] = cfg?.players?.find((p) => p.username === order[i])?.team ?? null; });
  return { cfgAt, startAt, cfg, byColor };
}

(async () => {
  // ── teams.js ──
  same("TEAM_MODES: Three-Headed Giant shares life, either game mode, six seats", T.TEAM_MODES["3hg"], { rule: "sharedLife", name: "Three-Headed Giant", gameMode: null, seats: 6 });
  ok("game mode: 3HG in Commander and in Standard", T.teamModeProblem("3hg", "commander") === null && T.teamModeProblem("3hg", "standard") === null);
  ok("game mode: 2HG still Commander only", /Commander only/.test(T.teamModeProblem("2hg", "standard") || ""));
  same("setupOf: the teams are the six-seat table's sides, whatever teams were sent",
    T.setupOf({ teamMode: "3hg", teams: { White: 2, Red: 1 } }), { teams: { White: 1, Red: 1, Yellow: 1, Green: 2, Blue: 2, Purple: 2 }, mode: "3hg", jugg: null, turns: null });
  same("setupOf: shared turns asked for 3HG are kept (Level 2 for three, as 2HG)", T.setupOf({ teamMode: "3hg", teamTurns: "shared" }).turns, "shared");
  ok("sides: each team is three seats next to each other in turn order", SIX.slice(0, 3).every((c) => T.THREE_TEAMS[c] === 1) && SIX.slice(3).every((c) => T.THREE_TEAMS[c] === 2));
  ok("teamsProblem: six players start", T.teamsProblem(T.THREE_TEAMS, 6, "3hg") === null);
  same("teamsProblem: five players don't, saying six", T.teamsProblem(T.THREE_TEAMS, 5, "3hg"), "Three-Headed Giant needs all six seats filled (seated players + AI players), not 5. Add AI players with  mtg start ai N  or  mtg ai <colour> forge.");
  const users = ["u-w", "u-r", "u-y", "u-g", "u-b", "u-p"];
  same("gameConfig: sharedLife, each player's team, no life (the engine's numbers for three)", T.gameConfig(T.THREE_TEAMS, users, SIX, "3hg"),
    { type: "gameConfig", teamRules: "sharedLife", players: users.map((u, i) => ({ username: u, team: i < 3 ? 1 : 2 })) });
  same("setup words: Commander's 120 a team", T.setupWords("3hg", T.THREE_TEAMS, null, false),
    "Three-Headed Giant: White + Red + Yellow vs Green + Blue + Purple (shared life: 120 a team, poison 20; each player takes their own turn, the team's back to back; the team blocks together).");
  ok("setup words: Standard's 45 a team (810.11)", T.setupWords("3hg", T.THREE_TEAMS, null, true).includes("shared life: 45 a team, poison 20"));
  const slotColor = Object.fromEntries(SIX.map((c, i) => [`player-${i}`, c]));
  const pub = { teamRules: { rule: "sharedLife", poisonToLose: 20, commanderDamageToLose: 63 }, players: SIX.map((c, i) => ({ id: `player-${i}`, teamNumber: i < 3 ? 1 : 2, life: 120 })) };
  same("board: two sides of three, the team's poison limit and commander damage", T.teamsField(pub, slotColor, "3hg").teams, { poison: 20, cmd: 63, sides: [["White", "Red", "Yellow"], ["Green", "Blue", "Purple"]] });
  same("board: the life tip names the three", T.teamLifeTip(pub.players[4], pub, slotColor), "Team life: Green + Blue + Purple");
  same("board: poison is out of the team's 20", T.poisonLabel("POISON 7", pub), "POISON 7/20");
  same("board: the three won together", T.teamsField({ ...pub, gameOver: true, winnerId: "player-1" }, slotColor, "3hg").teams.won, ["White", "Red", "Yellow"]);
  // (the joint block panel: the engine's lines name both partners; each in their seat colour)
  const lines = T.jointBlockLines(["Grizzly Bears -> Green's Wall of Wood + Purple's Trained Armodon", "Hill Giant -> your Centaur Courser"], [{ name: "Green", color: "Green" }, { name: "Purple", color: "Purple" }]);
  ok("joint block: both partners named in their colours", lines[0].includes(`<color=${T.SEAT_HEX.Green}>Green's</color> Wall of Wood`) && lines[0].includes(`<color=${T.SEAT_HEX.Purple}>Purple's</color> Trained Armodon`) && lines[0].includes(" → "), lines[0]);
  same("joint block: the revise round of a team of three names the one who changed", T.jointBlock({ title: "Purple changed the blocks. Agree or change?", reviseRound: 2, currentAssignments: [], teamBlockLines: [] }).title, "Purple changed the blocks. Agree or change?");
  same("joint block: the third partner's settle notice", T.teamBlockNotice("Green decides (team leader)"), { kind: "settle", line: "Green decides (team leader)" });

  // ── starts ──
  await run(async (h) => {
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 3, teamMode: "3hg" }) });
    await h.flush();
    ok("start on the four-seat table: refused, saying the six-seat table", h.B._getGame() == null && chats(h).includes("[MTG] Not started: Three-Headed Giant is played on the 6-seat table (this table has 4 seats)."), chats(h).join(" | "));
  });
  await run(async (h) => {
    sixTable(h);
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 3, teamMode: "3hg" }) });
    await h.flush();
    ok("start with four of six seats: refused, saying all six", h.B._getGame() == null && chats(h).some((c) => c.startsWith("[MTG] Not started: Three-Headed Giant needs all six seats filled")), chats(h).join(" | "));
  });
  await run(async (h) => {
    sixTable(h);
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 5, teamMode: "3hg" }) });
    await h.flush();
    const g = h.B._getGame();
    ok("start: a Three-Headed Giant game on the six-seat table", g?.teamMode === "3hg" && JSON.stringify(g.teams) === JSON.stringify(T.THREE_TEAMS), JSON.stringify(g && { m: g.teamMode, t: g.teams }));
    ok("start: the setup said", chats(h).includes("[MTG] Three-Headed Giant: White + Red + Yellow vs Green + Blue + Purple (shared life: 120 a team, poison 20; each player takes their own turn, the team's back to back; the team blocks together)."), chats(h).join(" | "));
    const f = await startFlow(h);
    ok("start: gameConfig before StartGame, sharedLife", f.cfgAt >= 0 && f.startAt > f.cfgAt && f.cfg?.teamRules === "sharedLife", `${f.cfgAt}/${f.startAt} ${f.cfg?.teamRules}`);
    same("start: each seat's team by colour, the sides", f.byColor, { White: 1, Red: 1, Yellow: 1, Green: 2, Blue: 2, Purple: 2 });
    ok("start: no life or limits sent (the engine's numbers for three)", (f.cfg?.players || []).every((p) => Object.keys(p).join(",") === "username,team") && !("poisonToLose" in (f.cfg || {})), JSON.stringify(f.cfg));
  });
  await run(async (h) => {
    sixTable(h);
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 3, teamMode: "2hg", teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 } }) });
    await h.flush();
    // (by its own rule, positively: refused as 2HG, the 4-seat table; the old check was only that no line said six, which a dropped start also satisfied; 2026-11-27)
    ok("a 2HG start on the six-seat table is checked as before (not the six-seat rule)", h.B._getGame() == null && chats(h).includes("[MTG] Not started: Two-Headed Giant is played on the 4-seat table (this table has 6 seats).") && !chats(h).some((c) => /six|Three-Headed/.test(c)), chats(h).join(" | "));
  });

  console.log(`${failed ? "FAIL" : "PASS"} test_bridge_3hg: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_bridge_3hg: ${e.stack}`); process.exit(1); });
