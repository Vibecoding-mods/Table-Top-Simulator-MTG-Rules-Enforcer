// 2v2 Team Commander and Juggernaut in the bridge (docs/game-modes-spec.md §4.1, §6; bridge/teams.js): the start
// message's team setup, the checks at start, the engine's gameConfig (teamRules "teams"; the Juggernaut's life, hand,
// perks, own commander limit and first turn), what is said, and the board's sides, Juggernaut and winners.
//   node tests/test_bridge_team_modes.js
const harness = require("./bridge-harness");
const T = require("../bridge/teams");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const chats = (h) => h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const relay = (h) => h.effects.map((e) => e.relay).filter(Boolean);
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const frame = (ws, msg) => ws.emit("message", JSON.stringify(msg));
const COLORS = ["White", "Red", "Yellow", "Blue"];

// The perk lines forge-harness PlayerRulesTest proves in the engine (DRAW, LAND, AFTER_EACH there): the bridge must
// send exactly these.
const DRAW = ["T:Mode$ Phase | Phase$ Draw | ValidPlayer$ You | TriggerZones$ Command | Static$ True | Execute$ JuggDraw | TriggerDescription$ At the beginning of your draw step, draw 1 additional card.",
  "SVar:JuggDraw:DB$ Draw | Defined$ You | NumCards$ 1"];
const LAND = ["S:Mode$ Continuous | Affected$ You | AdjustLandPlays$ 1 | EffectZone$ Command | Description$ You may play 1 additional land on each of your turns."];
const AFTER_EACH = ["T:Mode$ Phase | Phase$ Upkeep | ValidPlayer$ Opponent | TriggerZones$ Command | Static$ True | Execute$ JuggTurn | TriggerDescription$ At the beginning of each opponent's upkeep, take an extra turn after this one.",
  "SVar:JuggTurn:DB$ AddTurn | Defined$ You | NumTurns$ 1",
  "R:Event$ BeginTurn | ActiveZones$ Command | ValidPlayer$ You | ExtraTurn$ False | Skip$ True | Description$ You skip your turns that aren't extra turns."];

// Blue at the table (relay username in the seat order the bridge asks for), three Forge AIs on White, Red, Yellow:
// the start's relay messages up to StartGame.
async function startFlow(h) {
  const g = h.B._getGame();
  const blue = g.seats.get("Blue");
  blue.heartbeat = () => {};
  blue.ws.emit("open");
  frame(blue.ws, { type: "AuthResult", success: true });
  frame(blue.ws, { type: "RoomList", rooms: [{ room_id: "room-1", room_name: "tts-commander", status: "Lobby" }] });
  const bots = ["Forge AI", "Forge AI 2", "Forge AI 3"].map((u) => ({ username: u, ready: true, connected: true, is_bot: true }));
  frame(blue.ws, { type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 4, players: [{ username: blue.username, ready: true, connected: true }, ...bots] } });
  await h.flush();
  const out = relay(h);
  const cfgAt = out.findIndex((r) => r.type === "BroadcastState" && r.state?.payload?.type === "gameConfig");
  const startAt = out.findIndex((r) => r.type === "StartGame");
  return { blue, cfgAt, startAt, cfg: out[cfgAt]?.state?.payload, order: out[startAt]?.seat_order || [] };
}

(async () => {
  // ── setupOf: what the table's start message says ──
  same("setupOf: teams with no teamMode are Two-Headed Giant (the table before 2v2)", T.setupOf({ teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 } }).mode, "2hg");
  same("setupOf: 2v2 keeps the teams sent", T.setupOf({ teamMode: "2v2", teams: { White: 1, Red: 2, Yellow: 1, Blue: 2 } }), { teams: { White: 1, Red: 2, Yellow: 1, Blue: 2 }, mode: "2v2", jugg: null, turns: null });
  same("setupOf: a Juggernaut start's teams come from the Juggernaut, not the teams sent", T.setupOf({ teamMode: "juggernaut", teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 }, juggernaut: { color: "Yellow" } }).teams, { White: 2, Red: 2, Yellow: 1, Blue: 2 });
  same("setupOf: nothing is free-for-all", T.setupOf({}), { teams: null, mode: null, jugg: null, turns: null });
  same("juggOf: the defaults (spec §6)", T.juggOf(undefined), { color: "White", life: null, hand: 10, draw: 1, land: 0, cmd: 21, order: "first" });
  same("juggOf: a colour that is not a seat is White", T.juggOf({ color: "Purple" }).color, "White");
  same("juggOf: a seat's colour in lower case is White too (the table sends White, Red, ...)", T.juggOf({ color: "red" }).color, "White");
  same("juggOf: good values kept, bad ones the defaults", T.juggOf({ color: "Blue", life: "60", hand: 99, draw: -1, land: 1, cmd: 42, order: "after" }),
    { color: "Blue", life: 60, hand: 10, draw: 1, land: 1, cmd: 42, order: "after" });

  // ── the checks ──
  ok("2v2: two and two across the table start", T.teamsProblem({ White: 1, Red: 2, Yellow: 1, Blue: 2 }, 4, "2v2") === null);
  ok("2v2: the sides start", T.teamsProblem(T.DEFAULT_TEAMS, 4, "2v2") === null);
  ok("2v2: three against one don't", /2v2 needs two teams of two/.test(T.teamsProblem({ White: 1, Red: 1, Yellow: 1, Blue: 2 }, 4, "2v2") || ""), T.teamsProblem({ White: 1, Red: 1, Yellow: 1, Blue: 2 }, 4, "2v2"));
  ok("2v2: three players don't", /2v2 needs all four seats/.test(T.teamsProblem(T.DEFAULT_TEAMS, 3, "2v2") || ""));
  ok("juggernaut: four players start", T.teamsProblem(T.juggTeams("White"), 4, "juggernaut") === null);
  ok("juggernaut: three players don't", /Juggernaut is one against three/.test(T.teamsProblem(T.juggTeams("White"), 3, "juggernaut") || ""));

  // ── gameConfig ──
  const users = ["u-w", "bot", "bot 2", "u-b"];
  same("gameConfig 2v2: teamRules teams, each username's team, nothing else", T.gameConfig({ White: 1, Red: 2, Yellow: 1, Blue: 2 }, users, COLORS, "2v2"),
    { type: "gameConfig", teamRules: "teams", players: [{ username: "u-w", team: 1 }, { username: "bot", team: 2 }, { username: "bot 2", team: 1 }, { username: "u-b", team: 2 }] });
  same("gameConfig juggernaut (defaults): 80 life, 10 cards, the draw perk, goes first; Forge's 21 left out", T.gameConfig(T.juggTeams("Red"), users, COLORS, "juggernaut", T.juggOf({ color: "Red" })),
    { type: "gameConfig", teamRules: "teams", players: [{ username: "u-w", team: 2 },
      { username: "bot", team: 1, startingLife: 80, startingHand: 10, perks: ["Name:Juggernaut", ...DRAW], goesFirst: true },
      { username: "bot 2", team: 2 }, { username: "u-b", team: 2 }] });
  const all = T.gameConfig(T.juggTeams("Blue"), users, COLORS, "juggernaut", T.juggOf({ color: "Blue", land: 1, cmd: 42, order: "after", life: 70 }), true).players[3];
  same("gameConfig juggernaut (every option): the host's life, all perks, the 42 limit", all,
    { username: "u-b", team: 1, startingLife: 70, startingHand: 10, perks: ["Name:Juggernaut", ...DRAW, ...LAND, ...AFTER_EACH], commanderDamageToLose: 42, goesFirst: true });
  same("gameConfig juggernaut in Standard: 40 life (twice 20)", T.gameConfig(T.juggTeams("White"), users, COLORS, "juggernaut", T.juggOf({}), true).players[0].startingLife, 40);
  ok("gameConfig juggernaut with no perks: no perks field", !("perks" in T.gameConfig(T.juggTeams("White"), users, COLORS, "juggernaut", T.juggOf({ draw: 0 })).players[0]));

  // ── a start through the bridge ──
  await run(async (h) => {
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 3, teamMode: "2v2", teams: { White: 1, Red: 2, Yellow: 1, Blue: 2 } }) });
    await h.flush();
    const g = h.B._getGame();
    same("2v2 start: the game keeps the teams and the mode", [g?.teams, g?.teamMode], [{ White: 1, Red: 2, Yellow: 1, Blue: 2 }, "2v2"]);
    ok("2v2 start: said", chats(h).includes("[MTG] 2v2 Team Commander: White + Yellow vs Red + Blue (each player their own life and turn; teammates can't attack each other; a team wins when both its opponents have lost)."), chats(h).join(" | "));
    const f = await startFlow(h);
    ok("2v2 start: gameConfig before StartGame", f.cfgAt >= 0 && f.startAt > f.cfgAt, `${f.cfgAt}/${f.startAt}`);
    same("2v2 start: teamRules teams, each seat's team in the seat order", f.cfg,
      { type: "gameConfig", teamRules: "teams", players: f.order.map((u, i) => ({ username: u, team: [1, 2, 1, 2][i] })) });
  });
  await run(async (h) => {
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 2, teamMode: "2v2", teams: { White: 1, Red: 2, Yellow: 1, Blue: 2 } }) });
    await h.flush();
    ok("2v2 start: three players are refused", h.B._getGame() == null && chats(h).some((c) => /Not started: 2v2 needs all four seats/.test(c)), chats(h).join(" | "));
  });
  await run(async (h) => {
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 3, teamMode: "juggernaut", juggernaut: { color: "Blue", cmd: 42 } }) });
    await h.flush();
    const g = h.B._getGame();
    same("juggernaut start: Blue alone against the three", g?.teams, { White: 2, Red: 2, Yellow: 2, Blue: 1 });
    ok("juggernaut start: the settings said", chats(h).includes("[MTG] Juggernaut: Blue (80 life, 10 cards, 1 extra card each draw step, 0 extra land plays, out at 42 commander damage, goes first) vs White + Red + Yellow (40 life each). The Juggernaut wins when all three have lost; the three win together when the Juggernaut loses."), chats(h).join(" | "));
    const f = await startFlow(h);
    ok("juggernaut start: gameConfig before StartGame", f.cfgAt >= 0 && f.startAt > f.cfgAt, `${f.cfgAt}/${f.startAt}`);
    same("juggernaut start: the Juggernaut's own settings, by its relay username", f.cfg?.players?.find((p) => p.username === f.blue.username),
      { username: f.blue.username, team: 1, startingLife: 80, startingHand: 10, perks: ["Name:Juggernaut", ...DRAW], commanderDamageToLose: 42, goesFirst: true });
    same("juggernaut start: the three are team 2 with nothing else", f.cfg?.players?.filter((p) => p.username !== f.blue.username), ["Forge AI", "Forge AI 2", "Forge AI 3"].map((u) => ({ username: u, team: 2 })));
  });
  await run(async (h) => {
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 1, teamMode: "juggernaut" }) });
    await h.flush();
    ok("juggernaut start: two players are refused", h.B._getGame() == null && chats(h).some((c) => /Not started: Juggernaut is one against three/.test(c)), chats(h).join(" | "));
  });

  // ── the board ──
  const slotColor = { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" };
  const pub = (over = {}) => ({ teamRules: { rule: "teams", poisonToLose: 10, commanderDamageToLose: 21 },
    players: [{ id: "player-0" }, { id: "player-1", teamNumber: 2 }, { id: "player-2", teamNumber: 2 }, { id: "player-3", teamNumber: 2 }], ...over });
  same("board juggernaut: the lone side is the Juggernaut", T.teamsField(pub(), slotColor, "juggernaut").teams,
    { rule: "teams", mode: "juggernaut", sides: [["White"], ["Red", "Yellow", "Blue"]], juggernaut: "White" });
  same("board juggernaut: the Juggernaut won", T.teamsField(pub({ gameOver: true, winnerId: "player-0" }), slotColor, "juggernaut").teams.won, ["White"]);
  same("board juggernaut: the three won", T.teamsField(pub({ gameOver: true, winnerId: "player-2" }), slotColor, "juggernaut").teams.won, ["Red", "Yellow", "Blue"]);
  same("end words: a lone winner wins", T.teamWinWords(["White"], (c) => c), "White wins");
  same("end words: the three win", T.teamWinWords(["Red", "Yellow", "Blue"], (c) => c), "Red + Yellow + Blue win");
  const pub2 = { teamRules: { rule: "teams", poisonToLose: 10 }, players: [{ id: "player-0", teamNumber: 1 }, { id: "player-1", teamNumber: 2 }, { id: "player-2", teamNumber: 1 }, { id: "player-3", teamNumber: 2 }] };
  same("board: a free-for-all rule (none) has no teams, whatever the team numbers", T.boardTeams({ ...pub2, teamRules: { rule: "none", poisonToLose: 10 } }, slotColor), null);
  same("board 2v2: the two sides, no Juggernaut", T.teamsField(pub2, slotColor, "2v2").teams, { rule: "teams", mode: "2v2", sides: [["White", "Yellow"], ["Red", "Blue"]] });
  await run(async (h) => {
    // a concede in 2v2 is the player's own (the team plays on), not a team concede as in Two-Headed Giant
    const blue = new h.B.Seat("Blue", "neheb_minotaur_commander");
    blue.slot = "player-3";
    blue.board = { state: { gameView: { ...pub2, players: pub2.players.map((p) => ({ ...p, status: "playing" })), gameOver: false } }, fingerprint: null };
    h.B._setGame({ seats: new Map([["Blue", blue]]), bots: 3, total: 4, playerOrder: [blue.username], slotNames: { "player-3": "Blue" },
      slotColor, started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, teamMode: "2v2" });
    h.B.onTTS({ t: "concede", json: JSON.stringify({ color: "Blue" }) });
    await h.flush();
    ok("2v2 concede: said for the player alone", chats(h).includes("[MTG] Blue conceded."), chats(h).join(" | "));
  });

  console.log(`${failed ? "FAIL" : "PASS"} test_bridge_team_modes: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_bridge_team_modes: ${e.stack}`); process.exit(1); });
