// A picked starting hand dealt as the opening hand (engine1122-openinghand; bridge startConfig, openingCardsConfig,
// handPrompt): the start's gameConfig names each picked hand's cards for its player (openingCards), so the engine deals
// them before the keep-or-mulligan question; that question is then the player's, as in any game, and said; nothing is
// changed at the first priority. With no picked hand the start is as before (no gameConfig in a plain game). An engine
// that dealt at random anyway still gets the first-priority fix (test_bridge_hand). No TTS save needed.
//   node tests/test_bridge_opening_hand.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const chats = (h) => h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const relay = (h) => h.effects.map((e) => e.relay).filter(Boolean);
const applies = (h) => relay(h).filter((r) => r.state?.directive?.type === "applyState");
const responses = (h) => relay(h).filter((r) => r.state?.kind === "response").map((r) => r.state.action?.output ?? r.state.action);

// ── the start: a Standard 1v1 being set up, Blue seated against a Forge AI (as test_bridge_bo3_roll_choice's)
const card = (name) => ({ identity: { name, setCode: "", cardNumber: "" }, uris: {} });
const DECK = () => ({ deckName: "Dimir test", commanderName: null,
  deck: { name: "Dimir test", format: "standard", commanders: [], cards: Array.from({ length: 60 }, (_, i) => card(i % 2 ? "Island" : "Swamp")), sideboard: [] } });
function newGame(h, { pick = null, tableFirst = null } = {}) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-1";
  seat.heartbeat = () => {};
  seat.respond = () => {};
  seat.sent = [];
  seat.send = (m) => seat.sent.push(m);
  seat.deck = DECK();
  seat.joined = true;
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: [], slotNames: {}, slotColor: {}, seatColors: ["White", "Blue"],
    started: false, closing: false, fromTable: true, mode: "standard", sentStatic: {}, sentZones: {}, aiTableDecks: [], aiTableColors: [], forgeSeats: [],
    botsRequested: true, maxSet: true, ...(pick ? { handPick: { Blue: { names: pick } } } : {}), ...(tableFirst ? { tableFirst } : {}) });
  return seat;
}
const ready = (h, seat) => h.B.onRoomUpdate(seat, { room_id: "room-1", status: "Lobby", max_players: 2,
  players: [{ username: seat.username, ready: true, connected: true }, { username: "Forge AI", ready: true, connected: true, is_bot: true }] });
const configs = (seat) => seat.sent.filter((m) => m.state?.payload?.type === "gameConfig").map((m) => m.state.payload);
const startAt = (seat) => seat.sent.findIndex((m) => m.type === "StartGame");
const configAt = (seat) => seat.sent.findIndex((m) => m.state?.payload?.type === "gameConfig");

// ── in the game: the golden's dump2 board and mulligan question (Blue's hand: Vraska's Fall, Venomous Changeling,
// Hurloon Minotaur, Pestilence, Heated Debate, Simian Spirit Guide, Fire-Belly Changeling), as test_bridge_hand's
const D2 = require("./golden/fixtures/dump2.json");
const HAND = ["engine-card-43", "engine-card-35", "engine-card-75", "engine-card-77", "engine-card-97", "engine-card-94", "engine-card-74"];
const mulligan = () => { const p = clone(D2.prompts.mulligan); p.input.handCardIds = HAND.slice(); return p; };
const PASS = { actions: [{ id: "pass", type: "pass" }] };
const prompt = (type, input = {}, id = 900) => ({ promptId: id, decidingPlayerId: "player-0", input: { type, ...input } });
function started(h, pick, rename = {}) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: clone(D2.board), fingerprint: null };
  Object.assign(seat.board.state.gameView, { stack: [] });
  // (a dealt card shown under another name: the engine's split or double-faced card)
  for (const c of seat.board.state.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0").cards) if (rename[c.id]) c.identity = { ...c.identity, name: rename[c.id] };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: [], slotNames: { "player-0": "Blue", "player-1": "AI 1" },
    slotColor: { "player-0": "Blue", "player-1": "White" }, started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {},
    handPick: { Blue: { names: pick } } });
  return seat;
}

(async () => {
  await run(async (h) => {
    h.B._gameMode.mode = "standard";
    const seat = newGame(h, { pick: ["Island", "Island", "Counterspell"] });
    ready(h, seat);
    await h.settle();
    same("start: the gameConfig names Blue's picked cards for the engine to deal", configs(seat), [{ type: "gameConfig", players: [{ username: seat.username, openingCards: ["Island", "Island", "Counterspell"] }] }]);
    ok("start: the gameConfig before StartGame", configAt(seat) >= 0 && configAt(seat) < startAt(seat), JSON.stringify(seat.sent.map((m) => m.type)));
  });
  await run(async (h) => {
    h.B._gameMode.mode = "standard";
    const seat = newGame(h);
    ready(h, seat);
    await h.settle();
    same("start without a picked hand: no gameConfig, as before", [configs(seat).length, startAt(seat) >= 0], [0, true]);
  });
  await run(async (h) => {
    h.B._gameMode.mode = "standard";
    const seat = newGame(h, { pick: ["Counterspell"], tableFirst: "White" });
    ready(h, seat);
    await h.settle();
    same("start with a first player too: both in the one gameConfig", configs(seat), [{ type: "gameConfig", firstPlayer: 0, players: [{ username: seat.username, openingCards: ["Counterspell"] }] }]);
  });

  // a team game (Two-Headed Giant, Blue with an AI partner against two AI): on Blue's own entry, the others untouched
  await run(async (h) => {
    const seat = newGame(h, { pick: ["Counterspell"] });
    Object.assign(h.B._getGame(), { teams: { White: 1, Blue: 1, Red: 2, Yellow: 2 }, startOrder: ["Forge AI", seat.username, "Forge AI 2", "Forge AI 3"],
      seatColors: ["White", "Blue", "Red", "Yellow"], teamMode: "2hg", total: 4, bots: 3 });
    const cfg = h.B._startConfig();
    same("teams: the openingCards on Blue's own team entry, no entry added", [cfg?.players?.length, (cfg?.players || []).map((p) => p.openingCards || null)], [4, [null, ["Counterspell"], null, null]]);
  });

  // the engine dealt the picked hand: the mulligan question is Blue's, said; nothing at the first priority
  await run(async (h) => {
    h.B.setDebugTools(true);
    const seat = started(h, ["Pestilence", "Vraska's Fall"]);
    h.B.onPrompt(seat, mulligan()); await h.flush();
    same("dealt: the mulligan question is Blue's, not answered for them", [responses(h).length, seat.prompt?.ui?.title], [0, "Keep this hand?"]);
    ok("dealt: said", chats(h).includes("[MTG] Blue's picked hand was dealt as the opening hand: keep it or take a mulligan as usual."), JSON.stringify(chats(h).slice(-3)));
    same("dealt: the pick is used up", h.B._getGame().handPick, {});
    h.B.onPrompt(seat, prompt("chooseAction", PASS, 901)); await h.flush();
    same("dealt: no change at the first priority", applies(h).length, 0);
  });
  // a split and a double-faced card: picked by one half or the other face, read as the engine's card
  await run(async (h) => {
    h.B.setDebugTools(true);
    const r1 = h.B.onToolsPost({ kind: "hand", color: "Blue", names: ["Fire", "insectile aberration"] });
    same("set: a half and a back face are kept as the engine's cards", [r1.ok, h.B.toolsState().hand.seats.find((x) => x.color === "Blue").waiting], [true, ["Fire // Ice", "Delver of Secrets"]]);
    same("set: a name the engine doesn't know is refused", h.B.onToolsPost({ kind: "hand", color: "Blue", names: ["Fire", "No Such Card Anywhere"] }).message, 'The engine has no card called "No Such Card Anywhere".');
  });
  for (const [label, pick, shown] of [["whole", "Fire // Ice", "Fire // Ice"], ["shown by its half", "Fire // Ice", "Fire"], ["picked by its half", "Fire", "Fire // Ice"], ["double-faced", "Delver of Secrets", "Delver of Secrets"], ["double-faced, its back", "Insectile Aberration", "Delver of Secrets"]]) {
    await run(async (h) => {
      h.B.setDebugTools(true);
      const seat = started(h, [pick, "Pestilence"], { "engine-card-43": shown });
      h.B.onPrompt(seat, mulligan()); await h.flush();
      same(`dealt, ${label}: the mulligan question is Blue's, nothing at the first priority`, [responses(h).length, seat.prompt?.ui?.title, h.B._getGame().handPick], [0, "Keep this hand?", {}]);
      h.B.onPrompt(seat, prompt("chooseAction", PASS, 901)); await h.flush();
      same(`dealt, ${label}: no change at the first priority`, applies(h).length, 0);
    });
  }

  // an engine that dealt at random: kept, and the fix at the first priority, as before
  await run(async (h) => {
    h.B.setDebugTools(true);
    const seat = started(h, ["Pestilence", "Counterspell"]);
    h.B.onPrompt(seat, mulligan()); await h.flush();
    same("not dealt: kept by itself, as before", [responses(h).at(-1), seat.prompt], [{ type: "mulliganDecision", keep: true }, null]);
    h.B.onPrompt(seat, prompt("chooseAction", PASS, 901)); await h.flush();
    same("not dealt: one fix at the first priority", applies(h).length, 1);
  });

  process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} opening hand checks pass\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL test_bridge_opening_hand: ${e.stack}\n`); process.exit(1); });
