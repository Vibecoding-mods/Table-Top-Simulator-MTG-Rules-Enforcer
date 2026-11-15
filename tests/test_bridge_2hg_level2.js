// Two-Headed Giant Level 2 in the bridge (shared team turns, CR 805 + 810; docs/game-modes-spec.md §5.4-5.5; bridge/teams.js
// turnPlayerIds / isTurnOf / teamAttackLines / teamBlockLines, bridge.js turnOf / notOurs): the engine's protocol
// fixture (tests/golden/fixtures/2hg-level2-protocol.json: three turns, four human seats, teamRules "sharedTurns")
// replayed through the bridge. Checked: the level switch reaches gameConfig ("sharedTurns"), the board tells the table
// the whole active team, the partner of the active player is on their own turn too (main-phase stop, land plays,
// "Until my turn", a partner's spell is no opponent's), the attack and block questions say the team declares together
// and what the partner already declared, and every one of these is off in a Level 1 ("sharedLife") game.
//   node tests/test_bridge_2hg_level2.js
const harness = require("./bridge-harness");
const T = require("../bridge/teams");
const FIX = require("./golden/fixtures/2hg-level2-protocol.json");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const chats = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const tables = (h) => h.effects.filter((e) => e.tts?.t === "table").map((e) => e.tts);
const shownTo = (h, from, color) => h.effects.slice(from).filter((e) => e.tts?.t === "prompt" && e.tts.color === color).map((e) => e.tts).pop() || null;

const SLOTS = { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" };
const COLOR_SLOT = Object.fromEntries(Object.entries(SLOTS).map(([s, c]) => [c, s]));
// Level 1 contrast: the same boards as a "sharedLife" game (no shared turn): every Level 2 piece must be off
const asLevel1 = (board) => {
  const b = clone(board);
  b.gameView.teamRules = { ...b.gameView.teamRules, rule: "sharedLife" };
  delete b.gameView.activeTeamIds; delete b.gameView.priorityTeamIds;
  return b;
};

function setGame(h) {
  const seats = new Map();
  for (const [slot, color] of Object.entries(SLOTS)) {
    const s = new h.B.Seat(color, "neheb_minotaur_commander");
    s.slot = slot;
    s.heartbeat = () => {};
    seats.set(color, s);
  }
  h.B._setGame({ seats, bots: 0, total: 4, playerOrder: [...seats.values()].map((s) => s.username), slotNames: { ...SLOTS }, slotColor: { ...SLOTS },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 }, teamMode: "2hg", teamTurns: "shared" });
  return seats;
}
// Replays the fixture: each board to its seats, each question to its player through onPrompt (what the table is shown
// kept by promptId), each recorded answer given the way the table gives it (onTTS answer) when the question is open.
// level1: the boards as a Level 1 game. hook(e, i): run before each entry (a test's own extra steps).
async function replay(h, { level1 = false, hook = null } = {}) {
  const seats = setGame(h);
  const bySlot = (slot) => [...seats.values()].find((s) => s.slot === slot);
  const shown = {}, autoPassed = {};
  for (let i = 0; i < FIX.record.length; i++) {
    const e = FIX.record[i];
    if (hook) await hook(e, i, seats);
    if (e.board) {
      for (const slot of e.seats) bySlot(slot).board = { state: level1 ? asLevel1(e.board) : clone(e.board), fingerprint: null };
      if (e.seats.includes("player-3")) { h.B.sendTable(); await h.flush(); }
      continue;
    }
    if (e.prompt) {
      const seat = bySlot(e.prompt.decidingPlayerId);
      const n0 = h.effects.length;
      h.B.onPrompt(seat, clone(e.prompt)); await h.flush();
      shown[e.prompt.promptId] = shownTo(h, n0, seat.color);
      autoPassed[e.prompt.promptId] = !seat.prompt || seat.prompt.promptId !== e.prompt.promptId;
      continue;
    }
    if (e.answer) {
      const seat = bySlot(e.seat);
      const q = shown[e.answer.promptId];
      if (!q || seat.prompt?.promptId !== e.answer.promptId) continue; // (answered by the bridge itself: passed, Arena-style)
      const out = e.answer.output;
      let choice = null;
      if (out.type === "declareAttackers") choice = out.assignments.map((a) => `${a.attackerId}|${a.targetId}`);
      else if (out.type === "declareBlockers") choice = out.assignments.map((a) => `${a.blockerId}|${a.attackerId}`);
      else if (out.type === "pass") choice = ["__pass"];
      else if (out.type === "act") choice = [out.actionId];
      if (choice) { h.B.onTTS({ t: "answer", json: JSON.stringify({ color: seat.color, promptId: e.answer.promptId, choice }) }); await h.flush(); }
    }
  }
  return { seats, shown, autoPassed };
}
// The team's trigger order (805.7, track B: the first seat orders both partners' triggers) and a refused team block
// (track C: a notice with no cards to each defender): what White is shown and told, what Red and Yellow are told.
async function teamExtras(h, seats, board) {
  const white = seats.get("White"), yellow = seats.get("Yellow");
  white.board = { state: clone(board), fingerprint: null };
  yellow.board = { state: clone(board), fingerprint: null };
  const n0 = h.effects.length;
  h.B.onPrompt(white, { promptId: 950, decidingPlayerId: "player-0", input: { type: "reorder", presentation: { title: "Order triggered abilities", description: "Choose trigger resolution order" },
    items: [{ id: "sa-0", card: { id: "engine-card-3", identity: { name: "Grizzly Bears" }, controllerId: "player-0", ownerId: "player-0" }, oracle: "When this enters, you gain 1 life." },
      { id: "sa-1", card: { id: "engine-card-30", identity: { name: "Juggernaut" }, controllerId: "player-1", ownerId: "player-1" }, oracle: "When this enters, draw a card." }] } });
  await h.flush();
  const order = shownTo(h, n0, "White");
  const toRed = h.effects.slice(n0).filter((e) => e.tts?.t === "chat" && e.tts.color === "Red").map((e) => e.tts.text);
  const n1 = h.effects.length;
  h.B.onPrompt(yellow, { promptId: 951, decidingPlayerId: "player-2", input: { type: "revealCards", cards: [], presentation: { title: "Block declaration invalid: Hill Giant can't block alone" } } });
  await h.flush();
  return { order, toRed, refused: chats(h, n1) };
}
const fixPrompt = (id) => FIX.record.find((e) => e.prompt?.promptId === id).prompt;
const fixBoard = (i) => FIX.record[i].board;

(async () => {
  ok("precondition: the fixture is the shared-turn protocol, four seats", FIX.record.some((e) => e.board?.gameView?.teamRules?.rule === "sharedTurns") && FIX.seats.length === 4);

  // ── the level switch: setupOf, gameConfig, the start message ──
  same("setupOf: teamTurns shared is Level 2", T.setupOf({ teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 }, teamMode: "2hg", teamTurns: "shared" }).turns, "shared");
  same("setupOf: no teamTurns is Level 1", T.setupOf({ teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 }, teamMode: "2hg" }).turns, null);
  same("setupOf: shared turns are Two-Headed Giant's only (2v2 stays own turns)", T.setupOf({ teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 }, teamMode: "2v2", teamTurns: "shared" }).turns, null);
  same("gameConfig: Level 2 sends teamRules sharedTurns", T.gameConfig({ White: 1, Red: 1, Yellow: 2, Blue: 2 }, ["a", "b", "c", "d"], ["White", "Red", "Yellow", "Blue"], "2hg", null, false, "shared").teamRules, "sharedTurns");
  same("gameConfig: Level 1 still sends sharedLife", T.gameConfig({ White: 1, Red: 1, Yellow: 2, Blue: 2 }, ["a", "b", "c", "d"], ["White", "Red", "Yellow", "Blue"], "2hg").teamRules, "sharedLife");
  await run(async (h) => {
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 3, teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 }, teamMode: "2hg", teamTurns: "shared" }) });
    await h.flush();
    const g = h.B._getGame();
    same("start message: the table's teamTurns reaches the game", g?.teamTurns, "shared");
    ok("start message: the setup says one turn for each team", chats(h).some((c) => /each team takes one turn together, attacks together and blocks together/.test(c)), chats(h).join(" | "));
    const blue = g.seats.get("Blue");
    blue.heartbeat = () => {};
    blue.ws.emit("open");
    const frame = (msg) => blue.ws.emit("message", JSON.stringify(msg));
    frame({ type: "AuthResult", success: true });
    frame({ type: "RoomList", rooms: [{ room_id: "room-1", room_name: "tts-commander", status: "Lobby" }] });
    const bots = ["Forge AI", "Forge AI 2", "Forge AI 3"].map((u) => ({ username: u, ready: true, connected: true, is_bot: true }));
    frame({ type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 4, players: [{ username: blue.username, ready: true, connected: true }, ...bots] } });
    await h.flush();
    const cfg = h.effects.map((e) => e.relay).filter(Boolean).find((r) => r.state?.payload?.type === "gameConfig");
    same("start: the gameConfig before StartGame says sharedTurns", cfg?.state?.payload?.teamRules, "sharedTurns");
  });

  // ── the whole fixture, Level 2 ──
  await run(async (h) => {
    let skipChat = null, redLand = null, partnerSpell = null, comboBlock = null, laterBlock = null;
    const r = await replay(h, { hook: async (e, i, seats) => {
      // (before White's first question: Red asks to skip until her turn, which is the team's turn already)
      if (e.prompt?.promptId === 3) {
        const red = seats.get("Red");
        red.skipTo = { phase: "mine", turn: 0, step: "untap" }; // (set at turn 0: the game's first turn is a later one)
        skipChat = h.effects.length;
      }
      // (Red, on White's priority in the team's main phase: why can't her land be played? Not "not your turn")
      if (i === 9) redLand = h.B.whyNot(seats.get("Red"), "engine-card-8", { anyPriority: true });
      if (e.prompt?.promptId === 26) {
        // (one player declaring for the team: the partner's creature is named as the partner's)
        const yellow = seats.get("Yellow");
        const n0 = h.effects.length;
        h.B.onPrompt(yellow, { promptId: 901, decidingPlayerId: "player-2", input: { type: "chooseBlockers", availableBlockerIds: ["engine-card-31", "engine-card-32"],
          attackers: [{ attackerId: "engine-card-29", minBlockers: 1, validBlockerIds: ["engine-card-31", "engine-card-32"] }] } });
        await h.flush();
        comboBlock = shownTo(h, n0, "Yellow");
        h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Yellow", promptId: 901, choice: [] }) }); await h.flush();
      }
    } });
    const firstTable = tables(h).find((m) => m.turn === 1);
    same("board: the table gets the whole active team, the active player first", firstTable?.activeTeam, ["White", "Red"]);
    same("board: the teams say the turns are shared", firstTable?.teams?.turns, "shared");
    same("board: turn 2's active team is Yellow + Blue", tables(h).find((m) => m.turn === 2)?.activeTeam, ["Yellow", "Blue"]);
    ok("board: the team life tip and poison limit still work with shared turns", /^Team life: Yellow \+ Blue/.test(tables(h).pop()?.players?.find((p) => p.color === "Blue")?.lifeTip || ""),
      JSON.stringify(tables(h).pop()?.players?.find((p) => p.color === "Blue")?.lifeTip));
    ok("priority: Red's main phase on the team's turn waits for her (she has a land to play)", !!r.shown[3] && !r.autoPassed[3], JSON.stringify({ shown: !!r.shown[3], auto: r.autoPassed[3] }));
    ok("skip: 'Until my turn' ends on the team's turn for the partner's slot", chats(h, skipChat ?? 0).some((c) => /Skip ended: main phase, your team's turn\./.test(c)), chats(h, skipChat ?? 0).join(" | "));
    ok("land: the partner's land on the team's turn is not 'only on your turn'", redLand && !/only be played on your turn/.test(redLand), String(redLand));
    const whiteAtk = r.shown[19], redAtk = r.shown[20];
    ok("attack: White's question says the team attacks together", /Your team attacks together: you pick your creatures, Red picks theirs\./.test(whiteAtk?.text || ""), whiteAtk?.text);
    ok("attack: Red's question names White's attackers already declared", /White attacks with Grizzly Bears → Yellow\. Now pick yours\./.test(redAtk?.text || ""), redAtk?.text);
    ok("attack: the team line is on the corner too (note)", /White attacks with Grizzly Bears/.test(redAtk?.note || ""), redAtk?.note);
    ok("attack: Red still sees her own must-attack Juggernaut", /Must attack: Juggernaut/.test(redAtk?.text || ""), redAtk?.text);
    const yellowBlk = r.shown[25], blueBlk = r.shown[26];
    ok("block: Yellow's question says the team blocks together, either attacker", /Your team blocks together: you and Blue can each block any attacker, even one attacking your partner\./.test(yellowBlk?.text || ""), yellowBlk?.text);
    ok("block: Blue's question too", /you and Yellow can each block any attacker/.test(blueBlk?.text || ""), blueBlk?.text);
    ok("block: a partner's blocker in one question is named as the partner's", (comboBlock?.options || []).some((o) => /^Blue's Hill Giant [^ ]* ?blocks Grizzly Bears/.test(o.label)) &&
      (comboBlock?.options || []).some((o) => /^Grizzly Bears [^ ]* ?blocks Grizzly Bears/.test(o.label)), JSON.stringify(comboBlock?.options));
    // (Yellow asked again after Blue's block: the partner's block is said)
    const yellow = r.seats.get("Yellow");
    yellow.board = { state: clone(fixBoard(62)), fingerprint: null };
    const n0 = h.effects.length;
    h.B.onPrompt(yellow, { ...clone(fixPrompt(25)), promptId: 902 }); await h.flush();
    laterBlock = shownTo(h, n0, "Yellow");
    ok("block: the partner's block already made is said", /Blue blocks: Hill Giant blocks Grizzly Bears\./.test(laterBlock?.text || ""), laterBlock?.text);
    // (a partner's spell is the team's own: Red's "Until end step" goes on past White's spell; Yellow's stops)
    const red = r.seats.get("Red");
    const b = clone(fixBoard(47));
    b.gameView.stack = [{ id: "stack-1", sourceId: "engine-card-3", controllerId: "player-0", ownerId: "player-0", identity: { name: "Grizzly Bears" }, text: "Grizzly Bears", targets: [] }];
    b.gameView.priorityPlayerId = "player-1";
    red.board = { state: b, fingerprint: null };
    red.skipTo = { phase: "end", turn: 3, step: "main1" };
    const n1 = h.effects.length;
    h.B.onPrompt(red, { promptId: 903, decidingPlayerId: "player-1", input: { type: "chooseAction", actions: [] } }); await h.flush();
    partnerSpell = { shown: !!shownTo(h, n1, "Red"), chat: chats(h, n1) };
    ok("skip: a partner's spell doesn't stop the partner's skip", !partnerSpell.shown && !partnerSpell.chat.some((c) => /is on the stack/.test(c)), JSON.stringify(partnerSpell));
    const yel = r.seats.get("Yellow");
    const b2 = clone(b); b2.gameView.priorityPlayerId = "player-2";
    yel.board = { state: b2, fingerprint: null };
    yel.skipTo = { phase: "end", turn: 3, step: "main1" };
    const n2 = h.effects.length;
    h.B.onPrompt(yel, { promptId: 904, decidingPlayerId: "player-2", input: { type: "chooseAction", actions: [] } }); await h.flush();
    ok("skip: an opponent's spell still stops it", chats(h, n2).some((c) => /Grizzly Bears \(White\) is on the stack/.test(c)), chats(h, n2).join(" | "));
    const ex = await teamExtras(h, r.seats, fixBoard(48));
    ok("triggers: the first seat orders the team's triggers, the partner's named", /^Your team's triggers/.test(ex.order?.title || "") && (ex.order?.options || []).some((o) => /^Red's Juggernaut/.test(o.label)), JSON.stringify(ex.order && { t: ex.order.title, o: ex.order.options }));
    ok("triggers: the partner is told who orders them", ex.toRed.some((c) => /White is putting your team's triggers in order, yours too \(the team leader does\)/.test(c)), ex.toRed.join(" | "));
    ok("triggers: the primary player is told she orders them as the team leader", /^You order your team's triggers, Red's too \(you are the team leader\)\./.test(ex.order?.text || ""), ex.order?.text);
    ok("refusal: a refused team block is the team's, and who is asked first", ex.refused.some((c) => c === "[MTG] Your team's blocks together aren't legal. Hill Giant can't block alone. You are both asked again, Yellow first."), ex.refused.join(" | "));
  });

  // ── the same fixture as a Level 1 game: none of it ──
  await run(async (h) => {
    let skipChat = 0, redLand = null;
    const r = await replay(h, { level1: true, hook: async (e, i, seats) => {
      if (e.prompt?.promptId === 3) { seats.get("Red").skipTo = { phase: "mine", turn: 0, step: "untap" }; skipChat = h.effects.length; }
      if (i === 9) redLand = h.B.whyNot(seats.get("Red"), "engine-card-8", { anyPriority: true });
    } });
    ok("level 1: no activeTeam on the board", tables(h).every((m) => m.activeTeam === undefined && m.teams?.turns === undefined), JSON.stringify(tables(h)[0]?.activeTeam));
    ok("level 1: 'Until my turn' does not end on the partner's turn", !chats(h, skipChat).some((c) => /Skip ended/.test(c)), chats(h, skipChat).join(" | "));
    ok("level 1: the partner's land waits for her own turn", /only be played on your turn/.test(String(redLand)), String(redLand));
    ok("level 1: no team attack words", !/Your team attacks together/.test(r.shown[19]?.text || "") && !/Your team attacks together/.test(r.shown[20]?.text || ""), `${r.shown[19]?.text} || ${r.shown[20]?.text}`);
    ok("level 1: no team block words", !/Your team blocks together/.test(r.shown[25]?.text || ""), r.shown[25]?.text);
    const ex = await teamExtras(h, r.seats, asLevel1(fixBoard(48)));
    ok("level 1: trigger order is the player's own", /^Your triggers/.test(ex.order?.title || "") && !(ex.order?.options || []).some((o) => /^Red's/.test(o.label)) && !ex.toRed.length, JSON.stringify(ex.order?.title));
    ok("level 1: no team refusal words", !ex.refused.some((c) => /Your team's blocks/.test(c)), ex.refused.join(" | "));
  });

  console.log(`${failed ? "FAIL" : "PASS"} test_bridge_2hg_level2: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_bridge_2hg_level2: ${e.stack}`); process.exit(1); });
