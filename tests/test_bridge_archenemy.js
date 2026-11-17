// Archenemy in the bridge (docs/team-turns-archenemy-plan.md §2.7, step 8; bridge/teams.js archOf / gameConfig /
// teamsField, bridge.js onArchenemy / onSchemes / withArchenemy): the mode, the scheme deck (20 random from Forge's
// list, or the host's), the start's checks, the engine's gameConfig (the archenemy flag, the archenemy alone on team 1
// with twice the format's life, first, with the schemes; the others team 2), what is said, the board's archenemy, and
// Undo off in an Archenemy game. Two-Headed Giant, 2v2 and Juggernaut keep their own (tests/test_bridge_team_modes.js).
//   node tests/test_bridge_archenemy.js
const harness = require("./bridge-harness");
const T = require("../bridge/teams");
const SCHEMES = require("../bridge/forge-schemes.json");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const chats = (h) => h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const relay = (h) => h.effects.map((e) => e.relay).filter(Boolean);
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const frame = (ws, msg) => ws.emit("message", JSON.stringify(msg));
const COLORS = ["White", "Red", "Yellow", "Blue"];
const ALL = [...SCHEMES.schemes, ...SCHEMES.ongoing];
const TWENTY = ALL.slice(0, 20);

// Blue at the table, three Forge AIs on White, Red, Yellow: the start's relay messages up to StartGame
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
  return { blue, cfgAt, startAt, cfg: out[cfgAt]?.state?.payload };
}

(async () => {
  // ── the scheme list (tools/build-forge-scheme-list.js) ──
  ok("schemes: Forge's list has schemes and ongoing schemes, enough for a random 20", SCHEMES.schemes.length >= 20 && SCHEMES.ongoing.length > 0 && ALL.length >= 40, `${SCHEMES.schemes.length} / ${SCHEMES.ongoing.length}`);
  ok("schemes: no name twice", new Set(ALL).size === ALL.length);

  // ── teams.js ──
  same("TEAM_MODES: Archenemy is its own mode, teams rule, either game mode", T.TEAM_MODES.archenemy, { rule: "teams", name: "Archenemy", gameMode: null });
  ok("game mode: Archenemy in Commander and in Standard", T.teamModeProblem("archenemy", "commander") === null && T.teamModeProblem("archenemy", "standard") === null);
  ok("game mode: 2v2 still Standard only, Juggernaut still Commander only", /Standard only/.test(T.teamModeProblem("2v2", "commander") || "") && /Commander only/.test(T.teamModeProblem("juggernaut", "standard") || ""));
  same("setupOf: an Archenemy start's teams come from the archenemy, not the teams sent",
    T.setupOf({ teamMode: "archenemy", teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 }, archenemy: { color: "Yellow" } }),
    { teams: { White: 2, Red: 2, Yellow: 1, Blue: 2 }, mode: "archenemy", jugg: null, turns: null, arch: { color: "Yellow", schemes: null } });
  same("setupOf: 2HG, 2v2 and Juggernaut starts are as before (no arch)", ["2hg", "2v2", "juggernaut"].map((m) => Object.keys(T.setupOf({ teamMode: m, teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 } })).join(",")),
    ["teams,mode,jugg,turns", "teams,mode,jugg,turns", "teams,mode,jugg,turns"]);
  same("archOf: a bad colour is White, bad schemes none", T.archOf({ color: "Green", schemes: ["", 3] }), { color: "White", schemes: null });
  same("archOf: the host's schemes kept as names", T.archOf({ color: "Red", schemes: [" A ", "B"] }), { color: "Red", schemes: ["A", "B"] });
  ok("archLife: twice the format's: 80 in Commander, 40 in Standard", T.archLife(false) === 80 && T.archLife(true) === 40);
  ok("scheme deck: 20 different schemes are a deck", T.schemeDeckProblem(TWENTY) === null);
  ok("scheme deck: two of a scheme are allowed", T.schemeDeckProblem([...TWENTY.slice(0, 19), TWENTY[0]]) === null);
  same("scheme deck: 19 are refused, saying 20", T.schemeDeckProblem(TWENTY.slice(0, 19)), "a scheme deck needs at least 20 schemes; this one has 19");
  same("scheme deck: three of one are refused, naming it", T.schemeDeckProblem([...TWENTY, TWENTY[1], TWENTY[1]]), `a scheme deck holds at most 2 of each scheme: ${TWENTY[1]} (3)`);
  ok("teamsProblem: Archenemy with two to four players", [2, 3, 4].every((n) => T.teamsProblem(T.juggTeams("White"), n, "archenemy") === null));
  ok("teamsProblem: Archenemy alone is refused", /at least one other player/.test(T.teamsProblem(T.juggTeams("White"), 1, "archenemy") || ""));
  const users = ["u-w", "u-r", "u-y", "u-b"];
  const cfg = T.gameConfig(T.juggTeams("Blue"), users, COLORS, "archenemy", null, false, null, { color: "Blue", names: TWENTY });
  ok("gameConfig: the archenemy flag", cfg.archenemy === true && cfg.teamRules === "teams", JSON.stringify({ a: cfg.archenemy, r: cfg.teamRules }));
  same("gameConfig: the archenemy alone, 80 life, first, with the schemes", cfg.players[3], { username: "u-b", team: 1, startingLife: 80, goesFirst: true, schemes: TWENTY });
  same("gameConfig: the others team 2, nothing else", cfg.players.slice(0, 3), [{ username: "u-w", team: 2 }, { username: "u-r", team: 2 }, { username: "u-y", team: 2 }]);
  same("gameConfig: in Standard the archenemy has 40", T.gameConfig(T.juggTeams("White"), users, COLORS, "archenemy", null, true, null, { color: "White", names: TWENTY }).players[0].startingLife, 40);
  const SIX_C = ["White", "Red", "Yellow", "Green", "Blue", "Purple"];
  same("archOf: Purple is no seat on the 4-player table (the default)", T.archOf({ color: "Purple" }).color, "White");
  same("archOf: Purple is a seat on the six-seat table", T.archOf({ color: "Purple" }, SIX_C).color, "Purple");
  same("archTeams: the archenemy alone against the table's other seats", T.archTeams("Green", SIX_C), { White: 2, Red: 2, Yellow: 2, Green: 1, Blue: 2, Purple: 2 });
  same("setupOf: a six-seat table's Archenemy start covers its six seats", T.setupOf({ teamMode: "archenemy", archenemy: { color: "Purple" } }, SIX_C).teams, { White: 2, Red: 2, Yellow: 2, Green: 2, Blue: 2, Purple: 1 });
  same("setupOf: without the table's seats, the four as before", T.setupOf({ teamMode: "archenemy", archenemy: { color: "Blue" } }).teams, { White: 2, Red: 2, Yellow: 2, Blue: 1 });
  ok("setupWords: the five others named on six seats", /vs White \+ Red \+ Yellow \+ Green \+ Blue \(40 life each/.test(T.setupWords("archenemy", T.archTeams("Purple", SIX_C), null, false, null, { color: "Purple", schemes: null })),
    T.setupWords("archenemy", T.archTeams("Purple", SIX_C), null, false, null, { color: "Purple", schemes: null }));
  ok("gameConfig: no archenemy flag in the other modes", ["2hg", "2v2", "juggernaut"].every((m) => !("archenemy" in T.gameConfig(T.juggTeams("White"), users, COLORS, m, m === "juggernaut" ? T.juggOf({}) : null))));
  const slotColor = { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" };
  const pub = (over = {}) => ({ teamRules: { rule: "teams", poisonToLose: 10, commanderDamageToLose: 21 },
    players: [{ id: "player-0", teamNumber: 2 }, { id: "player-1", teamNumber: 2 }, { id: "player-2", teamNumber: 2 }, { id: "player-3" }], ...over });
  same("board: the archenemy named on the board's teams", T.teamsField(pub(), slotColor, "archenemy", "Blue").teams,
    { rule: "teams", mode: "archenemy", sides: [["White", "Red", "Yellow"], ["Blue"]], archenemy: "Blue" });
  same("board: the others won together", T.teamsField(pub({ gameOver: true, winnerId: "player-0" }), slotColor, "archenemy", "Blue").teams.won, ["White", "Red", "Yellow"]);
  ok("board: no archenemy named in a Juggernaut game", !("archenemy" in T.teamsField(pub(), slotColor, "juggernaut", "Blue").teams));
  ok("setup words: who, life, schemes, the win, and Undo off", /^Archenemy: Blue \(80 life, goes first, 20 random schemes\) vs White \+ Red \+ Yellow \(40 life each, their own turns\)\..*Undo is off in Archenemy games\.$/.test(T.setupWords("archenemy", T.juggTeams("Blue"), null, false, null, { color: "Blue", schemes: null })),
    T.setupWords("archenemy", T.juggTeams("Blue"), null, false, null, { color: "Blue", schemes: null }));

  // ── the host's chat commands (mtg archenemy, mtg schemes) ──
  await run(async (h) => {
    h.B._onArchenemy({ color: "Blue", text: "" }); await h.flush();
    ok("mtg archenemy: off at first, says how to set it", h.B._archenemy.on === false && /Archenemy is off\. The host sets it:  mtg archenemy <colour>/.test(chats(h).pop() || ""), chats(h).join(" | "));
    h.B._onArchenemy({ color: "Blue", text: "yellow" }); await h.flush();
    ok("mtg archenemy yellow: on, Yellow the archenemy, said with Undo off", h.B._archenemy.on && h.B._archenemy.color === "Yellow" && /Archenemy on for the next games: Yellow is the archenemy \(20 random schemes; .*Undo is off/.test(chats(h).pop() || ""), chats(h).join(" | "));
    h.B._onArchenemy({ color: "Blue", text: "green" }); await h.flush();
    ok("mtg archenemy green: refused with the colours", h.B._archenemy.color === "Yellow" && /Use:  mtg archenemy <colour>  \(White, Red, Yellow, Blue/.test(chats(h).pop() || ""), chats(h).join(" | "));
    h.B._onSchemes({ color: "Blue", text: `2 ${TWENTY[0]}; ${TWENTY.slice(1, 19).join("; ")}` }); await h.flush();
    ok("mtg schemes: a list of 20 with \"2 <name>\" is the deck", h.B._archenemy.names?.length === 20 && h.B._archenemy.names.filter((n) => n === TWENTY[0]).length === 2 && /Scheme deck: 20 chosen schemes\./.test(chats(h).pop() || ""), chats(h).join(" | "));
    h.B._onSchemes({ color: "Blue", text: TWENTY.map((n) => n.toUpperCase()).join(";") }); await h.flush();
    ok("mtg schemes: names in any case, as Forge spells them", JSON.stringify(h.B._archenemy.names) === JSON.stringify(TWENTY), JSON.stringify(h.B._archenemy.names?.slice(0, 2)));
    h.B._onSchemes({ color: "Blue", text: `${TWENTY.slice(0, 19).join("; ")}; Not A Scheme` }); await h.flush();
    ok("mtg schemes: an unknown name refused by name, the deck kept", /Not schemes Forge knows: Not A Scheme/.test(chats(h).pop() || "") && h.B._archenemy.names?.length === 20, chats(h).join(" | "));
    h.B._onSchemes({ color: "Blue", text: TWENTY.slice(0, 10).join("; ") }); await h.flush();
    ok("mtg schemes: ten refused, saying 20", /Not a scheme deck: a scheme deck needs at least 20 schemes; this one has 10/.test(chats(h).pop() || ""), chats(h).join(" | "));
    h.B._onSchemes({ color: "Blue", text: `3 ${TWENTY[0]}; ${TWENTY.slice(1).join("; ")}` }); await h.flush();
    ok("mtg schemes: three of one refused", /at most 2 of each scheme/.test(chats(h).pop() || ""), chats(h).join(" | "));
    h.B._onSchemes({ color: "Blue", text: "random" }); await h.flush();
    ok("mtg schemes random: back to 20 at random", h.B._archenemy.names === null && /Scheme deck: 20 random schemes\./.test(chats(h).pop() || ""), chats(h).join(" | "));
    h.B._onArchenemy({ color: "Blue", text: "off" }); await h.flush();
    ok("mtg archenemy off", h.B._archenemy.on === false && /Archenemy off/.test(chats(h).pop() || ""));
  });

  // ── withArchenemy: the bridge's switch at a start ──
  await run(async (h) => {
    same("switch off: a 2HG start is as sent", h.B._withArchenemy(T.setupOf({ teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 }, teamMode: "2hg" })).mode, "2hg");
    h.B._onArchenemy({ color: "Blue", text: "Red" }); await h.flush();
    same("switch on: a 2HG start becomes Archenemy with Red alone", h.B._withArchenemy(T.setupOf({ teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 }, teamMode: "2hg" })),
      { teams: { White: 2, Red: 1, Yellow: 2, Blue: 2 }, mode: "archenemy", jugg: null, turns: null, arch: { color: "Red", schemes: null, sticky: true } });
    same("switch on: a free-for-all start becomes Archenemy too", h.B._withArchenemy(T.setupOf({})).mode, "archenemy");
    h.B._onSchemes({ color: "Blue", text: TWENTY.join("; ") }); await h.flush();
    same("a table's Archenemy start keeps its archenemy and takes the host's list", h.B._withArchenemy(T.setupOf({ teamMode: "archenemy", archenemy: { color: "White" } })).arch, { color: "White", schemes: TWENTY });
  });

  // ── a start, to the engine's gameConfig ──
  await run(async (h) => {
    h.B._onArchenemy({ color: "Blue", text: "Blue" }); await h.flush();
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 3 }) });
    await h.flush();
    const g = h.B._getGame();
    same("start: Blue alone against the three", g?.teams, { White: 2, Red: 2, Yellow: 2, Blue: 1 });
    ok("start: the game is an Archenemy game with 20 different random schemes from Forge's list", g?.teamMode === "archenemy" && g.arch?.names?.length === 20 && new Set(g.arch.names).size === 20 && g.arch.names.every((n) => ALL.includes(n)), JSON.stringify(g?.arch));
    ok("start: the setup said", chats(h).some((c) => /^\[MTG\] Archenemy: Blue \(80 life, goes first, 20 random schemes\) vs White \+ Red \+ Yellow/.test(c)), chats(h).join(" | "));
    const f = await startFlow(h);
    ok("start: gameConfig before StartGame, with the archenemy flag", f.cfgAt >= 0 && f.startAt > f.cfgAt && f.cfg?.archenemy === true, `${f.cfgAt}/${f.startAt}`);
    same("start: the archenemy's settings by its relay username", f.cfg?.players?.find((p) => p.username === f.blue.username),
      { username: f.blue.username, team: 1, startingLife: 80, goesFirst: true, schemes: g.arch.names });
    same("start: the three are team 2 with nothing else", f.cfg?.players?.filter((p) => p.username !== f.blue.username), ["Forge AI", "Forge AI 2", "Forge AI 3"].map((u) => ({ username: u, team: 2 })));
  });
  await run(async (h) => {
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 3, mode: "standard", teamMode: "archenemy", archenemy: { color: "White", schemes: TWENTY } }) });
    await h.flush();
    const g = h.B._getGame();
    ok("Standard start from the table: an AI archenemy (White) with the table's schemes", g?.teamMode === "archenemy" && g.arch?.color === "White" && JSON.stringify(g.arch.names) === JSON.stringify(TWENTY), JSON.stringify(g?.arch));
    ok("Standard start: 40 life said", chats(h).some((c) => /Archenemy: White \(40 life, goes first, 20 chosen schemes\) vs Red \+ Yellow \+ Blue \(20 life each/.test(c)), chats(h).join(" | "));
  });
  await run(async (h) => {
    h.B._onArchenemy({ color: "White", text: "Blue" }); await h.flush();
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["White"], bots: 1 }) });
    await h.flush();
    ok("start: an archenemy colour not in the game is refused, saying how", h.B._getGame() == null && chats(h).some((c) => c.startsWith("[MTG] Not started: Archenemy: Blue isn't in this game") && /mtg ai Blue forge/.test(c)), chats(h).join(" | "));
  });
  await run(async (h) => {
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 3, teamMode: "archenemy", archenemy: { color: "Blue", schemes: TWENTY.slice(0, 5) } }) });
    await h.flush();
    ok("start: a table's short scheme list is refused before the engine", h.B._getGame() == null && chats(h).some((c) => c === "[MTG] Not started: Archenemy: a scheme deck needs at least 20 schemes; this one has 5."), chats(h).join(" | "));
  });
  await run(async (h) => {
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 3, teamMode: "2hg", teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 } }) });
    await h.flush();
    const f = await startFlow(h);
    ok("Two-Headed Giant start with the switch off: no Archenemy anywhere", h.B._getGame()?.teamMode === "2hg" && !h.B._getGame()?.arch && f.cfg?.teamRules === "sharedLife" && !("archenemy" in (f.cfg || {})), JSON.stringify(f.cfg));
  });

  // ── the six-seat table (cloud/archenemy-six): one archenemy against five ──
  const SIX = ["White", "Red", "Yellow", "Green", "Blue", "Purple"];
  const sixTable = (h) => h.B.onTTS({ t: "hello", json: JSON.stringify({ tableSeats: SIX }) });
  async function startFlowSix(h, seat) {
    const g = h.B._getGame();
    const me = g.seats.get(seat);
    me.heartbeat = () => {};
    me.ws.emit("open");
    frame(me.ws, { type: "AuthResult", success: true });
    frame(me.ws, { type: "RoomList", rooms: [{ room_id: "room-1", room_name: "tts-commander", status: "Lobby" }] });
    const bots = ["Forge AI", "Forge AI 2", "Forge AI 3", "Forge AI 4", "Forge AI 5"].map((u) => ({ username: u, ready: true, connected: true, is_bot: true }));
    frame(me.ws, { type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 6, players: [{ username: me.username, ready: true, connected: true }, ...bots] } });
    await h.flush();
    const out = relay(h);
    const cfgAt = out.findIndex((r) => r.type === "BroadcastState" && r.state?.payload?.type === "gameConfig");
    return { me, cfgAt, startAt: out.findIndex((r) => r.type === "StartGame"), cfg: out[cfgAt]?.state?.payload };
  }
  await run(async (h) => {
    sixTable(h);
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 5, teamMode: "archenemy", archenemy: { color: "Purple" } }) });
    await h.flush();
    const g = h.B._getGame();
    same("six seats: Purple, an AI seat, alone against the five", g?.teams, { White: 2, Red: 2, Yellow: 2, Green: 2, Blue: 2, Purple: 1 });
    ok("six seats: an Archenemy game with 20 random schemes", g?.teamMode === "archenemy" && g.arch?.color === "Purple" && g.arch?.names?.length === 20, JSON.stringify(g?.arch));
    ok("six seats: the setup said, double life, the five named", chats(h).some((c) => /^\[MTG\] Archenemy: Purple \(80 life, goes first, 20 random schemes\) vs White \+ Red \+ Yellow \+ Green \+ Blue \(40 life each/.test(c)), chats(h).join(" | "));
    const f = await startFlowSix(h, "Blue");
    ok("six seats: gameConfig before StartGame, with the archenemy flag", f.cfgAt >= 0 && f.startAt > f.cfgAt && f.cfg?.archenemy === true && f.cfg?.teamRules === "teams", `${f.cfgAt}/${f.startAt}`);
    const arch = (f.cfg?.players || []).filter((p) => p.team === 1);
    ok("six seats: one player on team 1, the archenemy, 80 life, first, with the schemes", arch.length === 1 && arch[0].startingLife === 80 && arch[0].goesFirst === true && JSON.stringify(arch[0].schemes) === JSON.stringify(g.arch.names), JSON.stringify(f.cfg?.players));
    ok("six seats: the five others team 2 with nothing else", (f.cfg?.players || []).filter((p) => p.team === 2).length === 5 && (f.cfg?.players || []).filter((p) => p.team === 2).every((p) => Object.keys(p).sort().join() === "team,username"), JSON.stringify(f.cfg?.players));
  });
  await run(async (h) => {
    sixTable(h);
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Green"], bots: 5, mode: "standard", teamMode: "archenemy", archenemy: { color: "Green", schemes: TWENTY } }) });
    await h.flush();
    ok("six seats, Standard: the seated Green the archenemy at 40, the five at 20", h.B._getGame()?.arch?.color === "Green" && chats(h).some((c) => /Archenemy: Green \(40 life, goes first, 20 chosen schemes\) vs White \+ Red \+ Yellow \+ Blue \+ Purple \(20 life each/.test(c)), chats(h).join(" | "));
  });
  await run(async (h) => {
    sixTable(h);
    h.B._onArchenemy({ color: "Blue", text: "purple" }); await h.flush();
    ok("six seats: mtg archenemy purple is a seat there", chats(h).some((c) => /Purple/.test(c) && !c.startsWith("[MTG] Use:")), chats(h).join(" | "));
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 5 }) });
    await h.flush();
    ok("six seats, the switch on: the start is Purple's Archenemy game", h.B._getGame()?.teamMode === "archenemy" && h.B._getGame()?.arch?.color === "Purple" && h.B._getGame()?.teams?.Purple === 1, JSON.stringify(h.B._getGame()?.teams));
  });
  await run(async (h) => {
    h.B._onArchenemy({ color: "Blue", text: "purple" }); await h.flush();
    ok("four seats: mtg archenemy purple isn't a seat there, the four named", chats(h).some((c) => c.startsWith("[MTG] Use:  mtg archenemy <colour>  (White, Red, Yellow, Blue:")), chats(h).join(" | "));
  });
  await run(async (h) => {
    sixTable(h);
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 2, teamMode: "archenemy", archenemy: { color: "Purple" } }) });
    await h.flush();
    ok("six seats: an archenemy colour not in the game is refused, saying to fill the six seats", h.B._getGame() == null && chats(h).some((c) => c.startsWith("[MTG] Not started: Archenemy: Purple isn't in this game") && c.includes("fill all six seats")), chats(h).join(" | "));
  });
  // (4) an AI player filling the archenemy's seat
  await run(async (h) => {
    h.B._onArchenemy({ color: "White", text: "Red" }); await h.flush();
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["White"], bots: 1 }) });
    await h.flush();
    const g = h.B._getGame();
    ok("an AI player takes the archenemy's seat (Red, the first free one): started, Red the archenemy", g?.teamMode === "archenemy" && g.arch?.color === "Red" && !chats(h).some((c) => c.startsWith("[MTG] Not started")), chats(h).join(" | "));
  });
  await run(async (h) => {
    h.B._onArchenemy({ color: "White", text: "Yellow" }); await h.flush();
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["White"], bots: 1 }) });
    await h.flush();
    ok("one AI player takes Red, not Yellow: an archenemy Yellow is still refused, with the switch's way off", h.B._getGame() == null && chats(h).some((c) => c.startsWith("[MTG] Not started: Archenemy: Yellow isn't in this game") && c.includes("mtg archenemy off")), chats(h).join(" | "));
  });
  await run(async (h) => {
    h.B._onArchenemy({ color: "White", text: "Blue" }); await h.flush();
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["White"], bots: 3 }) });
    await h.flush();
    ok("three AI players fill the table: an archenemy on the last free seat (Blue) starts", h.B._getGame()?.arch?.color === "Blue", chats(h).join(" | "));
  });
  // (5) the team info in a 2-player Archenemy game (the engine names no teams of one)
  const twoPub = (over = {}) => ({ players: [{ id: "player-0" }, { id: "player-3" }], ...over });
  same("2 players: the sides, the archenemy and the mode though the engine sends no teams", T.teamsField(twoPub(), slotColor, "archenemy", "Blue").teams,
    { rule: "teams", mode: "archenemy", sides: [["White"], ["Blue"]], archenemy: "Blue" });
  same("2 players: the archenemy's win", T.teamsField(twoPub({ gameOver: true, winnerId: "player-3" }), slotColor, "archenemy", "Blue").teams.won, ["Blue"]);
  same("2 players: the other player's win", T.teamsField(twoPub({ gameOver: true, winnerId: "player-0" }), slotColor, "archenemy", "Blue").teams.won, ["White"]);
  same("2 players, the archenemy first in turn order: their side first", T.teamsField(twoPub(), slotColor, "archenemy", "White").teams.sides, [["White"], ["Blue"]]);
  same("2 players outside Archenemy: still no teams", T.teamsField(twoPub(), slotColor, "juggernaut", "Blue"), {});
  await run(async (h) => {
    const blue = new h.B.Seat("Blue", "neheb_minotaur_commander");
    blue.slot = "player-3";
    blue.board = { state: { gameView: { players: [{ id: "player-0", status: "playing" }, { id: "player-3", status: "playing" }], gameOver: false, checkpoints: [] } }, fingerprint: null };
    h.B._setGame({ seats: new Map([["Blue", blue]]), bots: 1, total: 2, playerOrder: [blue.username], slotNames: { "player-3": "Blue" }, slotColor: { "player-0": "White", "player-3": "Blue" },
      started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, teamMode: "archenemy", arch: { color: "Blue", names: TWENTY } });
    h.B.sendTable(); await h.flush();
    const tbl = h.effects.filter((e) => e.tts?.t === "table").pop()?.tts;
    same("2 players: the table's board keeps the teams and names the archenemy", tbl?.teams, { rule: "teams", mode: "archenemy", sides: [["White"], ["Blue"]], archenemy: "Blue" });
  });

  // ── Undo off in an Archenemy game ──
  await run(async (h) => {
    const blue = new h.B.Seat("Blue", "neheb_minotaur_commander");
    blue.slot = "player-3";
    const gv = { ...pub(), players: pub().players.map((p) => ({ ...p, status: "playing" })), gameOver: false, checkpoints: [{ checkpointId: 1, turn: 2, activePlayerId: "player-3", step: "main1" }] };
    blue.board = { state: { gameView: gv }, fingerprint: null };
    const base = { seats: new Map([["Blue", blue]]), bots: 3, total: 4, playerOrder: [blue.username], slotNames: { "player-3": "Blue" }, slotColor, started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, teamMode: "archenemy" };
    h.B._setGame({ ...base, arch: { color: "Blue", names: TWENTY } });
    h.B.onTTS({ t: "rewind", json: JSON.stringify({ color: "Blue", checkpointId: 1 }) });
    await h.flush();
    ok("undo: refused in an Archenemy game, saying why", chats(h).includes(`[MTG] ${h.B.ARCH_NO_UNDO}`) && !relay(h).some((r) => JSON.stringify(r).includes("requestRestore")), chats(h).join(" | "));
    h.B.sendTable(); await h.flush();
    const tbl = h.effects.filter((e) => e.tts?.t === "table").pop()?.tts;
    same("undo: the board's rewind says why it is off", tbl?.rewind?.off, h.B.ARCH_NO_UNDO);
    same("board: the bridge's board names the archenemy", tbl?.teams?.archenemy, "Blue");
    h.B._setGame({ ...base, teamMode: "juggernaut" });
    h.B.onTTS({ t: "rewind", json: JSON.stringify({ color: "Blue", checkpointId: 1 }) });
    await h.flush();
    ok("undo: a Juggernaut game still rewinds (asked of the engine)", relay(h).some((r) => JSON.stringify(r).includes("requestRestore")), JSON.stringify(relay(h).slice(-2)));
  });

  console.log(`${failed ? "FAIL" : "PASS"} test_bridge_archenemy: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_bridge_archenemy: ${e.stack}`); process.exit(1); });
