// Two-Headed Giant in the bridge (docs/game-modes-spec.md §5.5, Level 1; bridge/teams.js): the teams checked at start,
// the engine's gameConfig sent before StartGame (each relay username's team, in the seat order), and the board a team
// game sends the table: the partner's hand to the partner only (never shown to everyone as a revealed hand), the
// team's poison out of 15, both partners' commander damage the team's, the sides and the winning team, a team's end
// words and a team concede. Boards are the golden's recorded dump2 (Blue vs AI White) with the engine's team fields
// (teamRules, teamNumber) added the way forge-harness InteractiveSnapshotExtractor sends them.
//   node tests/test_bridge_teams.js
const harness = require("./bridge-harness");
const T = require("../bridge/teams");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const clone = (x) => JSON.parse(JSON.stringify(x));
const D2 = require("./golden/fixtures/dump2.json");
const chats = (h) => h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const relay = (h) => h.effects.map((e) => e.relay).filter(Boolean);
const tables = (h) => h.effects.filter((e) => e.tts?.t === "table").map((e) => e.tts);
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const frame = (ws, msg) => ws.emit("message", JSON.stringify(msg));
const TEAMS = { White: 1, Red: 1, Yellow: 2, Blue: 2 };

(async () => {
  // ── teams.js: the checks and the payload ──
  same("teamsOf: numbers or strings, a bad one is the default side", T.teamsOf({ White: "2", Red: 1, Yellow: 7 }), { White: 2, Red: 1, Yellow: 2, Blue: 2 });
  same("teamsOf: none is free-for-all", T.teamsOf(undefined), null);
  ok("teamsProblem: the default sides with four players start", T.teamsProblem(TEAMS, 4) === null);
  ok("teamsProblem: White + Blue are next to each other round the table", T.teamsProblem({ White: 1, Red: 2, Yellow: 2, Blue: 1 }, 4) === null);
  ok("teamsProblem: three players don't", /all four seats/.test(T.teamsProblem(TEAMS, 3)), T.teamsProblem(TEAMS, 3));
  ok("teamsProblem: three on a team don't", /two teams of two/.test(T.teamsProblem({ White: 1, Red: 1, Yellow: 1, Blue: 2 }, 4)), T.teamsProblem({ White: 1, Red: 1, Yellow: 1, Blue: 2 }, 4));
  ok("teamsProblem: partners across the table don't", /next to each other/.test(T.teamsProblem({ White: 1, Red: 2, Yellow: 1, Blue: 2 }, 4)), T.teamsProblem({ White: 1, Red: 2, Yellow: 1, Blue: 2 }, 4));
  same("gameConfig: each username's team by its seat's colour", T.gameConfig(TEAMS, ["u-w", "bot", "bot 2", "u-b"], ["White", "Red", "Yellow", "Blue"]),
    { type: "gameConfig", teamRules: "sharedLife", players: [{ username: "u-w", team: 1 }, { username: "bot", team: 1 }, { username: "bot 2", team: 2 }, { username: "u-b", team: 2 }] });

  // ── start: refused, said, and the gameConfig before StartGame ──
  await run(async (h) => {
    h.B.startGame(["Blue"], 2, false, true, [], 0, "commander", TEAMS);
    await h.flush();
    ok("start: three players are refused", h.B._getGame() == null && chats(h).some((c) => /Not started: Two-Headed Giant needs all four seats/.test(c)), chats(h).join(" | "));
  });
  await run(async (h) => {
    h.B.startGame(["Blue"], 3, false, true, [], 0, "commander", { White: 1, Red: 1, Yellow: 1, Blue: 2 });
    await h.flush();
    ok("start: three on a team are refused", h.B._getGame() == null && chats(h).some((c) => /Not started: Two-Headed Giant needs two teams of two/.test(c)), chats(h).join(" | "));
  });
  await run(async (h) => {
    h.B.startGame(["Blue"], 3, false, true, [], 0, "commander", { White: 1, Red: 2, Yellow: 1, Blue: 2 });
    await h.flush();
    ok("start: partners across the table are refused", h.B._getGame() == null && chats(h).some((c) => /Not started: Partners sit next to each other/.test(c)), chats(h).join(" | "));
  });
  await run(async (h) => {
    h.B.startGame(["Blue"], 3, false, true, [], 0, "commander", TEAMS);
    await h.flush();
    const g = h.B._getGame();
    same("start: the game keeps the teams", g?.teams, TEAMS);
    ok("start: the sides are said", chats(h).some((c) => c === "[MTG] Two-Headed Giant: White + Red vs Yellow + Blue (shared life, poison 15; each player takes their own turn, the team's back to back)."), chats(h).join(" | "));
    const blue = g.seats.get("Blue");
    blue.heartbeat = () => {};
    blue.ws.emit("open");
    frame(blue.ws, { type: "AuthResult", success: true });
    frame(blue.ws, { type: "RoomList", rooms: [{ room_id: "room-1", room_name: "tts-commander", status: "Lobby" }] });
    frame(blue.ws, { type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 4, players: [{ username: blue.username, ready: false, connected: true }] } });
    await h.flush();
    const bots = ["Forge AI", "Forge AI 2", "Forge AI 3"].map((u) => ({ username: u, ready: true, connected: true, is_bot: true }));
    frame(blue.ws, { type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 4, players: [{ username: blue.username, ready: true, connected: true }, ...bots] } });
    await h.flush();
    const out = relay(h);
    const cfgAt = out.findIndex((r) => r.type === "BroadcastState" && r.state?.payload?.type === "gameConfig");
    const startAt = out.findIndex((r) => r.type === "StartGame");
    ok("start: gameConfig goes before StartGame", cfgAt >= 0 && startAt > cfgAt, `${cfgAt} / ${startAt}: ${JSON.stringify(out.map((r) => r.type))}`);
    const cfg = out[cfgAt]?.state;
    ok("start: as the node's roomRelay message", cfg?.kind === "roomRelay" && cfg?.protocol === "self-hosted-node" && cfg?.roomId === "room-1", JSON.stringify(cfg));
    const order = out[startAt]?.seat_order || [];
    same("start: every seat's team, in StartGame's seat order (Blue at Blue, the AIs at White, Red, Yellow)", cfg?.payload,
      { type: "gameConfig", teamRules: "sharedLife", players: order.map((u) => ({ username: u, team: u === blue.username || u === "Forge AI 3" ? 2 : 1 })) });
    same("start: the seat order is round the table", order, ["Forge AI", "Forge AI 2", "Forge AI 3", blue.username]);
  });
  await run(async (h) => {
    // Two-Headed Giant in Standard (spec §12: 30 a team; the engine's default for a non-Commander game): the same teams,
    // and StartGame says Standard, so the node starts Forge's Constructed game
    h.B.startGame(["Blue"], 3, false, true, [], 0, "standard", TEAMS);
    await h.flush();
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
    const start = out.find((r) => r.type === "StartGame");
    ok("start: a Standard 2HG start says Standard, with the teams", start?.format === "Standard" && out.some((r) => r.state?.payload?.type === "gameConfig" && r.state.payload.teamRules === "sharedLife"),
      JSON.stringify({ format: start?.format, types: out.map((r) => r.state?.payload?.type || r.type) }));
  });
  await run(async (h) => {
    // the table's Start (make-engine-copy.js engineStartGame) carries the teams
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 3, teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 } }) });
    await h.flush();
    same("start message: the table's teams reach the game", h.B._getGame()?.teams, TEAMS);
  });
  await run(async (h) => {
    h.B.startGame(["Blue"], 3, false, true);
    const g = h.B._getGame();
    const blue = g.seats.get("Blue");
    blue.heartbeat = () => {};
    blue.ws.emit("open");
    frame(blue.ws, { type: "AuthResult", success: true });
    frame(blue.ws, { type: "RoomList", rooms: [{ room_id: "room-1", room_name: "tts-commander", status: "Lobby" }] });
    const bots = ["Forge AI", "Forge AI 2", "Forge AI 3"].map((u) => ({ username: u, ready: true, connected: true, is_bot: true }));
    frame(blue.ws, { type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 4, players: [{ username: blue.username, ready: true, connected: true }, ...bots] } });
    await h.flush();
    ok("free-for-all: no gameConfig", relay(h).some((r) => r.type === "StartGame") && !relay(h).some((r) => r.state?.payload?.type === "gameConfig"), JSON.stringify(relay(h).map((r) => r.type)));
  });

  // ── the board: Blue (player-0) and White (player-1) as seated partners ──
  const WHITE_HAND = [{ id: "engine-card-900", identity: { name: "Llanowar Elves" }, visibility: "visible", types: ["Creature"], ownerId: "player-1", controllerId: "player-1" }];
  function views({ shared = true, poison = 0, damage = {} } = {}) {
    const blueView = clone(D2.board);
    const whiteView = clone(D2.board);
    for (const v of [blueView, whiteView]) {
      const gv = v.gameView;
      if (shared) gv.teamRules = { rule: "sharedLife", poisonToLose: 15, commanderDamageToLose: 42 };
      for (const p of gv.players) {
        p.teamNumber = shared ? 1 : undefined;
        p.life = 74;
        if (poison) p.counters = { ...(p.counters || {}), poison };
      }
      Object.assign(gv.players[0].commanderDamage = gv.players[0].commanderDamage || {}, damage["player-0"] || {});
      Object.assign(gv.players[1].commanderDamage = gv.players[1].commanderDamage || {}, damage["player-1"] || {});
    }
    // White's own hand in White's view; Blue's view shows it only to a partner (the engine's sharesHandWith)
    const zone = (v, owner) => v.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === owner);
    zone(whiteView, "player-1").cards = clone(WHITE_HAND);
    zone(whiteView, "player-1").count = 1;
    zone(blueView, "player-1").cards = shared ? clone(WHITE_HAND) : [];
    zone(blueView, "player-1").count = 1;
    if (!shared) zone(whiteView, "player-0").cards = [];
    return { blueView, whiteView };
  }
  function setGame(h, v, extra = {}) {
    const blue = new h.B.Seat("Blue", "neheb_minotaur_commander");
    blue.slot = "player-0";
    blue.board = { state: v.blueView, fingerprint: null };
    const white = new h.B.Seat("White", "neheb_minotaur_commander");
    white.slot = "player-1";
    white.board = { state: v.whiteView, fingerprint: null };
    h.B._setGame({ seats: new Map([["Blue", blue], ["White", white]]), bots: 0, total: 2, playerOrder: [blue.username, white.username],
      slotNames: { "player-0": "Blue", "player-1": "White" }, slotColor: { "player-0": "Blue", "player-1": "White" },
      started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, ...extra });
    return { blue, white };
  }
  const rowOf = (msg, color) => msg?.players?.find((p) => p.color === color);
  // (every board sent: a zone unchanged since the last board is left out of the next one, "keep", so the last alone can't
  // show that a hand was never sent as revealed)
  const revealedRows = (h) => tables(h).flatMap((m) => (m.players || []).filter((p) => p.revealed).map((p) => `${p.color} ${p.revealed.length}`));
  const cmdId = D2.board.gameView.zones.find((z) => z.zone === "command" && z.ownerId === "player-0").cards[0].id;

  await run(async (h) => {
    setGame(h, views({ poison: 3, damage: { "player-0": { [cmdId]: 0 }, "player-1": { [cmdId]: 0 } } }));
    h.B.sendTable();
    await h.flush();
    const msg = tables(h).pop();
    const blueRow = rowOf(msg, "Blue"), whiteRow = rowOf(msg, "White");
    same("board: White's hand to Blue, look-only", { ids: (whiteRow?.teamHand || []).map((c) => c.id), by: whiteRow?.teamBy }, { ids: ["engine-card-900"], by: "Blue" });
    same("board: Blue's hand to White", { n: (blueRow?.teamHand || []).length, by: blueRow?.teamBy }, { n: 7, by: "White" });
    same("board: a partner's hand is not shown to everyone", revealedRows(h), []);
    same("board: the sides and the team's poison limit", msg?.teams, { poison: 15, cmd: 42, sides: [["Blue", "White"]] });
    ok("board: the life counter says it is the team's", /^Team life: Blue \+ White/.test(blueRow?.lifeTip || "") && /^Team life: Blue \+ White/.test(whiteRow?.lifeTip || ""), JSON.stringify([blueRow?.lifeTip, whiteRow?.lifeTip]));
    ok("board: poison is the team's out of 15", (blueRow?.allMarks || []).includes("POISON 3/15"), JSON.stringify(blueRow?.allMarks));
  });
  await run(async (h) => {
    // Neheb (Blue's commander) has dealt 12 to Blue's partner White and 9 to Blue: the team took 21 from it
    setGame(h, views({ damage: { "player-0": { [cmdId]: 9 }, "player-1": { [cmdId]: 12 } } }));
    h.B.sendTable();
    await h.flush();
    const msg = tables(h).pop();
    same("board: both partners' trackers show the team's commander damage", [rowOf(msg, "Blue")?.cmdDamage?.Blue, rowOf(msg, "White")?.cmdDamage?.Blue], [21, 21]);
    same("board: a partner's hand is not shown to everyone (a second board)", revealedRows(h), []);
  });
  await run(async (h) => {
    const v = views({ shared: false });
    setGame(h, v);
    h.B.sendTable();
    await h.flush();
    const msg = tables(h).pop();
    ok("free-for-all: no team life tip", !/Team life/.test(rowOf(msg, "Blue")?.lifeTip || ""), rowOf(msg, "Blue")?.lifeTip);
    ok("free-for-all: no teams, no partner's hand", !msg?.teams && !rowOf(msg, "White")?.teamHand && !rowOf(msg, "Blue")?.teamHand, JSON.stringify({ t: msg?.teams, w: rowOf(msg, "White")?.teamHand }));
  });
  await run(async (h) => {
    // a teams game without shared life (the engine sends teamRules "teams" too, spec §5.9): no 2HG board
    const v = views({ shared: false });
    for (const x of [v.blueView, v.whiteView]) {
      x.gameView.teamRules = { rule: "teams", poisonToLose: 10 };
      for (const p of x.gameView.players) p.teamNumber = 1;
    }
    setGame(h, v);
    h.B.sendTable();
    await h.flush();
    const msg = tables(h).pop();
    ok("teams without shared life: no 2HG sides or poison limit", !msg?.teams, JSON.stringify(msg?.teams));
  });
  await run(async (h) => {
    // the end: an engine win for Blue (player-0) is the team's
    const v = views();
    for (const x of [v.blueView, v.whiteView]) Object.assign(x.gameView, { gameOver: true, winnerId: "player-0" });
    setGame(h, v);
    h.B.sendTable();
    await h.flush();
    const msg = tables(h).pop();
    same("end: the winning team", msg?.teams?.won, ["Blue", "White"]);
    ok("end: the words name the team", h.B.gameEndWords(v.blueView.gameView) === "Blue + White win", h.B.gameEndWords(v.blueView.gameView));
  });
  await run(async (h) => {
    const v = views();
    setGame(h, v);
    h.B.onTTS({ t: "concede", json: JSON.stringify({ color: "Blue" }) });
    await h.flush();
    ok("concede: said for the team", chats(h).includes("[MTG] Blue conceded for the team (Blue + White)."), chats(h).join(" | "));
  });

  console.log(`${failed ? "FAIL" : "PASS"} test_bridge_teams: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_bridge_teams: ${e.stack}`); process.exit(1); });
