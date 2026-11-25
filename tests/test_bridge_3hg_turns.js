// Three-Headed Giant with shared team turns in the bridge (docs/game-modes-spec.md §8.4, rule 810.11: 2HG's rules for
// a team of three; bridge/teams.js setupOf / gameConfig / setupWords / turnPartnersOf / teamAttackLines /
// teamBlockLines / teamTriggerWords / teamRefusalWords, bridge.js startGame and the team's trigger order): a 3HG start
// with teamTurns "shared" keeps it and asks the engine for "sharedTurns" (the engine plays it for teams of three:
// LongTailTest's "threes" checks); the team words name all three partners ("Red and Yellow pick theirs", "you, Blue and
// Purple can each block", "Red's and Yellow's too", "You are all asked again"), and Two-Headed Giant's words for two
// stay exactly as they were.
//   node tests/test_bridge_3hg_turns.js
const harness = require("./bridge-harness");
const T = require("../bridge/teams");
const FIX = require("./golden/fixtures/2hg-level2-protocol.json");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
const chats = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "chat").map((e) => e.tts);
const relay = (h) => h.effects.map((e) => e.relay).filter(Boolean);
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const frame = (ws, msg) => ws.emit("message", JSON.stringify(msg));
const shownTo = (h, from, color) => h.effects.slice(from).filter((e) => e.tts?.t === "prompt" && e.tts.color === color).map((e) => e.tts).pop() || null;
const SIX = ["White", "Red", "Yellow", "Green", "Blue", "Purple"];
const SLOTS = Object.fromEntries(SIX.map((c, i) => [`player-${i}`, c]));
const nameOf = (id) => SLOTS[id] || id;
const cname = (id) => `C(${id})`;

// a shared-turn board of six, two teams of three, White's turn (the protocol fixture's board, two seats added)
function board6(rule = "sharedTurns") {
  const b = clone(FIX.record[48].board);
  const p0 = b.gameView.players[0];
  b.gameView.players = SIX.map((c, i) => ({ ...clone(p0), id: `player-${i}`, name: c, teamNumber: i < 3 ? 1 : 2, life: 120 }));
  b.gameView.teamRules = { rule, poisonToLose: 20 };
  b.gameView.activePlayerId = "player-0";
  b.gameView.priorityPlayerId = "player-0";
  delete b.gameView.activeTeamIds; delete b.gameView.priorityTeamIds;
  const old = b.gameView.zones;
  b.gameView.zones = [];
  for (let i = 0; i < 6; i++) {
    for (const z of old.filter((x) => x.ownerId === "player-0")) b.gameView.zones.push({ ...clone(z), ownerId: `player-${i}`, cards: z.zone === "hand" || z.zone === "battlefield" ? [] : clone(z.cards || []) });
  }
  return b;
}
const pub6 = (rule = "sharedTurns") => board6(rule).gameView;

(async () => {
  // ── the setting: setupOf, gameConfig, the setup words ──
  same("setupOf: 3HG with teamTurns shared is Level 2", T.setupOf({ teamMode: "3hg", teamTurns: "shared" }).turns, "shared");
  same("setupOf: 3HG without teamTurns stays Level 1", T.setupOf({ teamMode: "3hg" }).turns, null);
  same("setupOf: 2v2 still ignores teamTurns", T.setupOf({ teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 }, teamMode: "2v2", teamTurns: "shared" }).turns, null);
  const users = ["a", "b", "c", "d", "e", "f"];
  same("gameConfig: 3HG shared turns ask the engine for sharedTurns", T.gameConfig(T.THREE_TEAMS, users, SIX, "3hg", null, false, "shared").teamRules, "sharedTurns");
  same("gameConfig: 3HG own turns stay sharedLife", T.gameConfig(T.THREE_TEAMS, users, SIX, "3hg", null, false, null).teamRules, "sharedLife");
  same("setup words: 3HG shared turns", T.setupWords("3hg", T.THREE_TEAMS, null, false, "shared"),
    "Three-Headed Giant: White + Red + Yellow vs Green + Blue + Purple (shared life: 120 a team, poison 20; each team takes one turn together, attacks together and blocks together).");

  // ── the start through the bridge on the six-seat table ──
  await run(async (h) => {
    h.B.onTTS({ t: "hello", json: JSON.stringify({ tableSeats: SIX }) });
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 5, teamMode: "3hg", teamTurns: "shared" }) });
    await h.flush();
    const g = h.B._getGame();
    same("start: the game keeps teamTurns shared for 3HG", g?.teamTurns, "shared");
    ok("start: the setup line says one turn for each team", chats(h).some((c) => c.text === "[MTG] Three-Headed Giant: White + Red + Yellow vs Green + Blue + Purple (shared life: 120 a team, poison 20; each team takes one turn together, attacks together and blocks together)."), chats(h).map((c) => c.text).join(" | "));
    const blue = g.seats.get("Blue");
    blue.heartbeat = () => {};
    blue.ws.emit("open");
    frame(blue.ws, { type: "AuthResult", success: true });
    frame(blue.ws, { type: "RoomList", rooms: [{ room_id: "room-1", room_name: "tts-commander", status: "Lobby" }] });
    frame(blue.ws, { type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 6, players: [{ username: blue.username, ready: false, connected: true }] } });
    await h.flush();
    const bots = ["Forge AI", "Forge AI 2", "Forge AI 3", "Forge AI 4", "Forge AI 5"].map((u) => ({ username: u, ready: true, connected: true, is_bot: true }));
    frame(blue.ws, { type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 6, players: [{ username: blue.username, ready: true, connected: true }, ...bots] } });
    await h.flush();
    const out = relay(h);
    const cfgAt = out.findIndex((r) => r.type === "BroadcastState" && r.state?.payload?.type === "gameConfig");
    const startAt = out.findIndex((r) => r.type === "StartGame");
    ok("start: gameConfig sharedTurns before StartGame", cfgAt >= 0 && startAt > cfgAt && out[cfgAt].state.payload.teamRules === "sharedTurns", `${cfgAt}/${startAt} ${out[cfgAt]?.state?.payload?.teamRules}`);
  });

  // ── the words with three partners ──
  const pub = pub6();
  same("partners: White's are Red and Yellow", T.turnPartnersOf(pub, "player-0"), ["player-1", "player-2"]);
  same("partners: none outside a shared-turn game", T.turnPartnersOf(pub6("sharedLife"), "player-0"), []);
  same("andWords: one, two, three", [T.andWords(["A"]), T.andWords(["A", "B"]), T.andWords(["A", "B", "C"])], ["A", "A and B", "A, B and C"]);
  same("attack: nothing declared yet, both partners named", T.teamAttackLines(pub, "player-0", [], cname, nameOf),
    ["Your team attacks together: you pick your creatures, Red and Yellow pick theirs."]);
  const cards = [{ id: "c1", isAttacking: true, attackTargetId: "player-3", controllerId: "player-1" }, { id: "c2", isAttacking: true, attackTargetId: "player-4", controllerId: "player-2" }];
  same("attack: each partner's attack said in turn", T.teamAttackLines(pub, "player-0", cards, cname, nameOf),
    ["Your team attacks together. Red attacks with C(c1) → C(player-3). Yellow attacks with C(c2) → C(player-4). Now pick yours."]);
  same("attack: one partner declared, only that one said", T.teamAttackLines(pub, "player-0", cards.slice(0, 1), cname, nameOf),
    ["Your team attacks together. Red attacks with C(c1) → C(player-3). Now pick yours."]);
  const ctl = { b1: "player-4", b2: "player-5", b3: "player-3" };
  same("block: the head names both partners, each partner's blocks a line", T.teamBlockLines(pub, "player-3", [{ blockerId: "b1", attackerId: "a1" }, { blockerId: "b2", attackerId: "a2" }, { blockerId: "b3", attackerId: "a1" }], (id) => ctl[id], cname, nameOf),
    ["Your team blocks together: you, Blue and Purple can each block any attacker, even one attacking one of your partners.", "Blue blocks: C(b1) blocks C(a1).", "Purple blocks: C(b2) blocks C(a2)."]);
  const items = [{ id: "t0", card: { controllerId: "player-0" } }, { id: "t1", card: { controllerId: "player-1" } }, { id: "t2", card: { controllerId: "player-2" } }];
  const trig = T.teamTriggerWords(pub, "player-0", items, nameOf);
  ok("triggers: both partners' triggers, the hint names both", trig && JSON.stringify(trig.partners) === '["player-1","player-2"]' && trig.whose.get("t1") === "player-1" && trig.whose.get("t2") === "player-2"
    && /^You order your team's triggers, Red's and Yellow's too \(you are the team leader\)\./.test(trig.hint), JSON.stringify(trig && { p: trig.partners, h: trig.hint }));
  const trig1 = T.teamTriggerWords(pub, "player-0", items.slice(0, 2), nameOf);
  ok("triggers: only the partner with a trigger there is named and told", trig1 && JSON.stringify(trig1.partners) === '["player-1"]' && /Red's too/.test(trig1.hint), JSON.stringify(trig1 && trig1.partners));
  ok("triggers: a third partner's trigger alone still counts (not only the first partner's)", T.teamTriggerWords(pub, "player-0", [items[2]], nameOf)?.partner === "player-2");
  same("refusal: you are all asked again", T.teamRefusalWords(pub, "player-3", "Block declaration invalid: Wall can't block", nameOf),
    "Your team's blocks together aren't legal. Wall can't block. You are all asked again, Green first.");

  // ── Two-Headed Giant's words for two, unchanged ──
  const b4 = clone(FIX.record[48].board).gameView;
  same("2HG: attack words for one partner unchanged", T.teamAttackLines(b4, "player-0", [], cname, nameOf), ["Your team attacks together: you pick your creatures, Red picks theirs."]);
  same("2HG: block head unchanged", T.teamBlockLines(b4, "player-2", [], () => null, cname, nameOf), ["Your team blocks together: you and Green can each block any attacker, even one attacking your partner."]); // (player-3, named by the six-seat names here)
  same("2HG: refusal still says both", T.teamRefusalWords(b4, "player-2", "Attack declaration invalid", nameOf), "Your team's attack together isn't legal. You are both asked again, Yellow first.");

  // ── the team's trigger order through the bridge: each partner told, each trigger named by its owner ──
  await run(async (h) => {
    const seats = new Map();
    for (const [slot, color] of Object.entries(SLOTS)) {
      const s = new h.B.Seat(color, "neheb_minotaur_commander");
      s.slot = slot;
      s.heartbeat = () => {};
      s.board = { state: board6(), fingerprint: null };
      seats.set(color, s);
    }
    h.B._setGame({ seats, bots: 0, total: 6, playerOrder: [...seats.values()].map((s) => s.username), slotNames: { ...SLOTS }, slotColor: { ...SLOTS },
      started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, teams: { ...T.THREE_TEAMS }, teamMode: "3hg", teamTurns: "shared" });
    const n0 = h.effects.length;
    h.B.onPrompt(seats.get("White"), { promptId: 960, decidingPlayerId: "player-0", input: { type: "reorder", presentation: { title: "Order triggered abilities", description: "Choose trigger resolution order" },
      items: [{ id: "sa-0", card: { id: "engine-card-3", identity: { name: "Grizzly Bears" }, controllerId: "player-0", ownerId: "player-0" }, oracle: "When this enters, you gain 1 life." },
        { id: "sa-1", card: { id: "engine-card-30", identity: { name: "Juggernaut" }, controllerId: "player-1", ownerId: "player-1" }, oracle: "When this enters, draw a card." },
        { id: "sa-2", card: { id: "engine-card-31", identity: { name: "Hill Giant" }, controllerId: "player-2", ownerId: "player-2" }, oracle: "When this enters, scry 1." }] } });
    await h.flush();
    const order = shownTo(h, n0, "White");
    const labels = (order?.options || []).map((o) => o.label);
    ok("trigger order: each partner's trigger named by its owner", labels.some((l) => /^Red's Juggernaut/.test(l)) && labels.some((l) => /^Yellow's Hill Giant/.test(l)), JSON.stringify(labels));
    ok("trigger order: the hint names both partners", /^You order your team's triggers, Red's and Yellow's too/.test(order?.text || ""), order?.text);
    const told = (c) => chats(h, n0).filter((m) => m.color === c && /White is putting your team's triggers in order/.test(m.text)).length;
    same("trigger order: Red and Yellow are each told, nobody else", SIX.map(told), [0, 1, 1, 0, 0, 0]);
  });

  console.log(`${failed ? "FAIL" : "PASS"} test_bridge_3hg_turns: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_bridge_3hg_turns: ${e.stack}`); process.exit(1); });
