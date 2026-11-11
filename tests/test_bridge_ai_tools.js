// AI seats and debug tools (docs/next-features-2026-11-09.md items 17, 18, 20, 21): the deck-list reader, the AI seat
// choices ("mtg ai", POST /tools), the harmless bot's answers, a game set up with a harmless bot and a Forge AI seat
// (who sits where, which deck each plays), and the debug tools as manual-fix changes. Boards are the golden's recorded
// dump2 (Blue, Neheb, the Worthy: B and R, vs AI White).
//   node tests/test_bridge_ai_tools.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const clone = (x) => JSON.parse(JSON.stringify(x));
const D2 = require("./golden/fixtures/dump2.json");
const myMain = () => { const b = clone(D2.board); Object.assign(b.gameView, { activePlayerId: "player-0", step: "main1", priorityPlayerId: "player-0", stack: [] }); return b; };
const prompt = (type, input = {}, id = 900) => ({ promptId: id, decidingPlayerId: "player-0", input: { type, ...input } });
const PASS = { actions: [{ id: "pass", type: "pass" }] };
const chats = (h) => h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const relay = (h) => h.effects.map((e) => e.relay).filter(Boolean);
const applies = (h) => relay(h).filter((r) => r.state?.directive?.type === "applyState").map((r) => r.state.directive);
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const frame = (ws, msg) => ws.emit("message", JSON.stringify(msg));
const LIST = "Commander\n1 Neheb, the Worthy\n\nDeck\n1x Lightning Bolt (M10) 146 *F*\n2 Mountain\n1 Sol Ring [Ramp] #ramp\n// a comment\nSideboard\n1 Counterspell";

(async () => {
  // ── the deck-list reader ──
  await run(async (h) => {
    const P = h.B.parseDeckList;
    same("list: the commander part, the deck, counts, printings and tags gone, sideboard skipped", P(LIST),
      { cards: ["Lightning Bolt", "Mountain", "Mountain", "Sol Ring"], commanders: ["Neheb, the Worthy"] });
    same("list: a *CMDR* mark makes a commander", P("1 Neheb, the Worthy *CMDR*\n1 Shock"), { cards: ["Shock"], commanders: ["Neheb, the Worthy"] });
    same("list: a line without a count is one card", P("Shock\n# note\nOpt"), { cards: ["Shock", "Opt"], commanders: [] });
    same("list: Maybeboard and Companion parts aren't played; Deck starts the deck again", P("Maybeboard\n1 Opt\nCompanion\n1 Lurrus of the Dream-Den\nMainboard\n1 Shock"), { cards: ["Shock"], commanders: [] });
    same("list: nothing in, nothing out", P(""), { cards: [], commanders: [] });
  });

  // ── AI seat choices ──
  await run(async (h) => {
    const S = h.B.setAiSeat, C = h.B._aiSeatChoice;
    const r1 = S("red", "harmless");
    ok("harmless, no deck named: the lands-only deck", r1.ok && C.Red?.kind === "harmless" && C.Red.deck.deckName === "Passive AI (lands only)" && C.Red.source === "ai_passive_lands", JSON.stringify(r1));
    same("harmless: the message", r1.message, "Red: Harmless bot playing Passive AI (lands only).");
    const r2 = S("Yellow", "forge", { list: LIST, name: "My Neheb" });
    ok("forge from a list: set, named as given", r2.ok && C.Yellow?.kind === "forge" && C.Yellow.deck.deckName === "My Neheb" && C.Yellow.source === "list", JSON.stringify(r2));
    same("forge from a list: the engine's deck, commander apart", { cards: C.Yellow.deck.deck.cards.map((c) => c.identity.name), commanders: C.Yellow.deck.deck.commanders.map((c) => c.identity.name), cmd: C.Yellow.deck.commanderName },
      { cards: ["Lightning Bolt", "Mountain", "Mountain", "Sol Ring"], commanders: ["Neheb, the Worthy"], cmd: "Neheb, the Worthy" });
    const r3 = S("Yellow", "forge", { list: "Commander\n1 Neheb, the Worthy\n1 Lightning Bolt\n1 Notacard Atall" });
    ok("a list with an unknown card is refused, naming it, and the seat keeps its deck", !r3.ok && /doesn't know 1 card\(s\): Notacard Atall/.test(r3.message) && C.Yellow.deck.deckName === "My Neheb", JSON.stringify(r3));
    const r4 = S("Blue", "forge", { list: "1 Lightning Bolt\n1 Shock" });
    ok("a list with no commander is refused", !r4.ok && /no commander/.test(r4.message) && !C.Blue, JSON.stringify(r4));
    const r5 = S("Blue", "forge", { list: "Commander\n1 Neheb, the Worthy" });
    ok("a list of only a commander is refused", !r5.ok && /no cards besides the commander/.test(r5.message), JSON.stringify(r5));
    const r6 = S("Blue", "forge", { preset: "../decks/x" });
    ok("an unknown preset is refused", !r6.ok && /no Commander deck/.test(r6.message) && !C.Blue, JSON.stringify(r6));
    const r7 = S("Blue", "forge", {});
    ok("forge with no deck is refused", !r7.ok && /choose a deck or give a deck list/.test(r7.message), JSON.stringify(r7));
    ok("no such seat", !S("Green", "forge", { preset: "ai_passive_lands" }).ok);
    ok("no such kind", !S("Blue", "nasty", { preset: "ai_passive_lands" }).ok && !C.Blue);
    const r8 = S("Red", "off");
    ok("off: the seat is cleared", r8.ok && !C.Red, JSON.stringify(r8));
    // the chat command
    h.B.onTTS({ t: "aiseat", json: JSON.stringify({ text: "white forge" }) });
    h.B.onTTS({ t: "aiseat", json: JSON.stringify({ text: "white forge ai_passive_lands" }) });
    h.B.onTTS({ t: "aiseat", json: JSON.stringify({ text: "" }) });
    h.B.onTTS({ t: "aiseat", json: JSON.stringify({ text: "clear" }) });
    await h.flush();
    const c = chats(h);
    ok("mtg ai <colour> forge with no deck: asks for one", /^\[MTG\] Name the Forge AI's deck:  mtg ai white forge <deck>/.test(c[0] || ""), c[0]);
    same("mtg ai <colour> forge <deck>: set", c[1], "[MTG] White: Forge AI playing Passive AI (lands only).");
    ok("mtg ai: lists the seats set", /^\[MTG\] AI seats: White: Forge AI \(Passive AI \(lands only\)\); Yellow: Forge AI \(My Neheb\)\./.test(c[2] || ""), c[2]);
    ok("mtg ai clear: none left", c[3] === "[MTG] AI seats cleared." && !Object.keys(C).length, c[3]);
  });

  // ── the harmless bot's answers ──
  await run(async (h) => {
    const A = h.B.harmlessAnswer;
    same("mulligan: keep", A({ type: "mulligan" }), { type: "mulliganDecision", keep: true });
    same("put back: the first ones", A({ type: "mulliganPutBack", count: 1, handCardIds: ["a", "b"] }), { type: "mulliganPutBackDecision", cardIds: ["a"] });
    same("priority: pass", A({ type: "chooseAction", actions: [{ id: "x", type: "cast" }] }), { type: "pass" });
    same("a cost: cancelled", A({ type: "payManaCost" }), { type: "cancel" });
    same("targets: only as many as it must", A({ type: "chooseBoardTargets", minTargets: 2, chosenTargets: 1, candidates: [{ kind: "card", id: "c1", label: "x" }, { kind: "player", id: "player-1" }] }), { type: "boardTargets", chosen: [{ kind: "card", id: "c1" }] });
    same("targets: none when none are needed", A({ type: "chooseBoardTargets", minTargets: 0, candidates: [{ kind: "card", id: "c1" }] }), { type: "boardTargets", chosen: [] });
    same("a may: no", A({ type: "chooseBoolean" }), { type: "decision", value: false });
    same("cards: the fewest", A({ type: "chooseCards", min: 1, cards: [{ id: "a" }, { id: "b" }] }), { type: "chooseCardsDecision", chosenCardIds: ["a"] });
    same("a number: the least", A({ type: "chooseNumber", min: 2, max: 9 }), { type: "numberDecision", chosenNumber: 2 });
    same("a selection: the first ones it must", A({ type: "chooseFromSelection", minTotal: 1, options: [{ label: "a" }, { label: "b" }] }), { type: "selectionDecision", chosenIndices: [0] });
    same("attackers: only those that must", A({ type: "chooseAttackers", attackers: [{ attackerId: "a1", validTargetIds: ["player-0"] }, { attackerId: "a2", mustAttack: true, validTargetIds: ["player-1", "player-0"] }] }),
      { type: "declareAttackers", assignments: [{ attackerId: "a2", targetId: "player-1" }] });
    same("blockers: none", A({ type: "chooseBlockers", attackers: [{ attackerId: "a1", validBlockerIds: ["b1"], mustBeBlocked: true }] }), { type: "declareBlockers", assignments: [] });
    same("blockers refused for one that must be blocked: blocks it", A({ type: "chooseBlockers", error: "x must be blocked", attackers: [{ attackerId: "a1", validBlockerIds: ["b1"], mustBeBlocked: true }, { attackerId: "a2", validBlockerIds: ["b2"] }] }),
      { type: "declareBlockers", assignments: [{ blockerId: "b1", attackerId: "a1" }] });
    same("scry: all kept on top", A({ type: "scry", zones: ["libraryBottom", "libraryTop"], cards: [{ id: "a" }, { id: "b" }] }), { type: "scryDecision", zoneCardIds: [[], ["a", "b"]] });
    same("a colour: the first", A({ type: "chooseColor", validColors: ["red", "green"], amount: 1 }), { type: "colorDecision", chosenColors: { red: 1 } });
    same("a reveal: seen", A({ type: "revealCards" }), { type: "revealCardsAcknowledged" });
    same("dice: seen", A({ type: "diceRolled" }), { type: "diceRolledAcknowledged" });
    same("an order: as given", A({ type: "reorder", items: [{ id: "x" }, { id: "y" }] }), { type: "reorderDecision", orderedIds: ["x", "y"] });
    same("blocker order: as given", A({ type: "chooseDamageAssignmentOrder", blockerIds: ["b2", "b1"] }), { type: "damageAssignmentOrderDecision", orderedBlockerIds: ["b2", "b1"] });
    same("combat damage: all to the first blocker", A({ type: "chooseCombatDamageAssignment", blockerIds: ["b1", "b2"], totalDamage: 3 }), { type: "combatDamageAssignmentDecision", assignments: [{ assigneeId: "b1", damage: 3 }] });
    same("an unknown question: no answer", A({ type: "somethingNew" }), null);
  });

  // ── a game with a harmless bot (Red) and a Forge AI seat (Yellow): Blue alone at the table ──
  await run(async (h) => {
    h.B.setAiSeat("Red", "harmless");
    h.B.setAiSeat("Yellow", "forge", { list: LIST, name: "My Neheb" });
    h.B.startGame(["Blue"], 0, false, true);
    await h.flush();
    const g = h.B._getGame();
    same("start: the AI seats count as AI players", { bots: g.bots, total: g.total }, { bots: 2, total: 3 });
    ok("start: said, by kind", chats(h).includes("[MTG] Setting up: Blue + 1 Forge AI + 1 harmless bot...") && chats(h).includes("[MTG] AI seats: Red Harmless bot (Passive AI (lands only)), Yellow Forge AI (My Neheb)."), JSON.stringify(chats(h)));
    const blue = g.seats.get("Blue");
    ok("only the person's seat logs in first", h.sockets.length === 1 && !g.harmless, String(h.sockets.length));
    blue.heartbeat = () => {}; // (flush runs the clock on: no 45 s silence check here)
    blue.ws.emit("open");
    frame(blue.ws, { type: "AuthResult", success: true });
    frame(blue.ws, { type: "RoomList", rooms: [{ room_id: "room-1", room_name: "tts-commander", status: "Lobby" }] });
    const lobby = (players) => ({ type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 4, players } });
    frame(blue.ws, lobby([{ username: blue.username, ready: false, connected: true }]));
    await h.flush();
    const red = g.harmless?.[0];
    ok("the harmless bot logs in once Blue is in the room", red && red.color === "Red" && h.sockets.length === 2 && !g.seats.has("Red"), JSON.stringify(g.harmless?.map((s) => s.color)));
    const spawn = relay(h).find((r) => r.state?.payload?.type === "spawnBot");
    same("one Forge bot asked for, with the Yellow seat's deck first", (spawn?.state.payload.decks || []).map((d) => d.deckName), ["My Neheb"]);
    red.heartbeat = () => {};
    red.ws.emit("open");
    frame(red.ws, { type: "AuthResult", success: true });
    frame(red.ws, { type: "RoomList", rooms: [{ room_id: "room-1", room_name: "tts-commander", status: "Lobby" }] });
    const bot = "self-hosted-node-bot";
    const players = [{ username: blue.username, ready: true, connected: true }, { username: bot, ready: true, connected: true, is_bot: true }, { username: red.username, ready: true, connected: true }];
    frame(red.ws, lobby(players));
    await h.flush();
    const sel = relay(h).filter((r) => r.type === "SetDeckSelection").map((r) => r.deck_name);
    ok("the harmless bot sends its own deck", sel.includes("Passive AI (lands only)"), JSON.stringify(sel));
    ok("said as a harmless bot", chats(h).some((t) => t === "[MTG] Red (harmless bot) joined with Passive AI (lands only)."), JSON.stringify(chats(h)));
    frame(blue.ws, lobby(players));
    await h.flush();
    const start = relay(h).find((r) => r.type === "StartGame");
    same("seats in turn order: the harmless bot at Red, the Forge bot at Yellow", start?.seat_order, [red.username, bot, blue.username]);
    frame(blue.ws, { type: "GameStarted", player_order: start.seat_order, game_id: "g1", starting_life: 40 });
    frame(red.ws, { type: "GameStarted", player_order: start.seat_order, game_id: "g1", starting_life: 40 });
    await h.flush();
    same("colours: each AI where it was set", g.slotColor, { "player-0": "Red", "player-1": "Yellow", "player-2": "Blue" });
    same("names: both are AI players to the table", g.slotNames, { "player-0": "AI 1", "player-1": "AI 2", "player-2": "Blue" });
    same("the bot's slot", red.slot, "player-0");
    // it answers its own questions, and only its own
    const before = relay(h).length;
    frame(red.ws, { type: "StateUpdate", state: { kind: "prompt", forPlayer: "player-0", prompt: { promptId: 4, input: { type: "mulligan", mulliganCount: 0 } } } });
    frame(red.ws, { type: "StateUpdate", state: { kind: "prompt", forPlayer: "player-0", prompt: { kind: "priority", promptId: 5, input: { type: "chooseAction" } } } });
    frame(red.ws, { type: "StateUpdate", state: { kind: "prompt", forPlayer: "player-2", prompt: { promptId: 6, input: { type: "mulligan" } } } });
    frame(red.ws, { type: "StateUpdate", state: { kind: "prompt", forPlayer: "player-0", prompt: { promptId: 7, input: { type: "gameOver" } } } });
    await h.flush();
    same("its answers: keep, pass; none for another seat's question or the game's end", relay(h).slice(before).filter((r) => r.state?.kind === "response").map((r) => [r.state.fromPlayer, r.state.promptId, r.state.action.type, r.state.action.output]),
      [["player-0", 4, "mulligan", { type: "mulliganDecision", keep: true }], ["player-0", 0, "chooseAction", { type: "pass" }]]);
    ok("its questions never reach the table", !h.effects.some((e) => e.tts?.t === "prompt"), "a prompt went to the table");
    // pictures: the Forge bot is still bot 0 with a harmless bot in the game (its deck from a table seat shows that seat's pictures)
    h.B._readyDecks.White = { images: { Forest: [{ face: "f.jpg" }] } };
    g.botDeckColors = ["White"];
    same("pictures: the Forge bot's deck by its index, the harmless bot not counted as one", h.B.gamePictures(start.seat_order), { Yellow: { Forest: [{ face: "f.jpg" }] } });
    delete h.B._readyDecks.White;
    // the resume file has it, and a reset closes it
    const fs = require("fs");
    const fake = fs.writeFile;
    let saved = null;
    fs.writeFile = (p, d, cb) => { saved = String(d); if (cb) cb(null); };
    try { h.B.saveResume(); await h.flush(); } finally { fs.writeFile = fake; }
    same("saved for a restart: the harmless bot as it logged in", JSON.parse(saved || "{}").harmless, [{ color: "Red", username: red.username, slot: "player-0", roomId: "room-1" }]);
    h.B.onTTS({ t: "reset", json: "{}" });
    await h.flush();
    ok("reset: the harmless bot's link is closed too", red.closed === true);
    // a restarted bridge logs it back in as the same player, and it answers again
    h.B._setGame(null);
    await fs.promises.writeFile(process.env.MTG_RESUME_FILE, saved);
    ok("resumed", h.B.resumeGame() === true);
    const back = h.B._getGame().harmless?.[0];
    ok("resumed: the harmless bot is back, same name and slot", back instanceof h.B.HarmlessSeat && back.username === red.username && back.slot === "player-0" && !h.B._getGame().seats.has("Red"), JSON.stringify(back && { u: back.username, s: back.slot }));
    back.heartbeat = () => {};
    const n0 = relay(h).length;
    back.ws.emit("open");
    frame(back.ws, { type: "AuthResult", success: true, reconnected: true });
    frame(back.ws, { type: "StateUpdate", state: { kind: "prompt", forPlayer: "player-0", prompt: { promptId: 8, input: { type: "chooseBoolean" } } } });
    await h.flush(1);
    same("resumed: logs in as itself, asks for the game, answers", relay(h).slice(n0).map((r) => r.type === "Authenticate" ? `auth ${r.username === red.username}` : r.state?.kind === "response" ? `answer ${r.state.promptId} ${r.state.action.output.value}` : r.type),
      ["auth true", "RequestResync", "answer 8 false"]);
    await fs.promises.unlink(process.env.MTG_RESUME_FILE).catch(() => {});
  });

  // ── without AI seats the colours are given as before (nothing stored) ──
  await run(async (h) => {
    h.B.startGame(["Blue"], 1, false, true);
    const g = h.B._getGame();
    const blue = g.seats.get("Blue");
    blue.joined = true; blue.roomId = "room-1";
    h.B.onRoomUpdate(blue, { room_id: "room-1", status: "Lobby", max_players: 4, players: [{ username: blue.username, ready: true, connected: true }, { username: "x-bot", ready: true, connected: true, is_bot: true }] });
    await h.flush();
    const start = relay(h).find((r) => r.type === "StartGame");
    same("no AI seats: the AI takes the first free colour", start?.seat_order, ["x-bot", blue.username]);
    same("no AI seats: no colour map kept", g.colorOfUser, undefined);
    same("no AI seats: no harmless bots", g.harmless, undefined);
  });

  // ── a person sitting at an AI seat's colour plays it ──
  await run(async (h) => {
    h.B.setAiSeat("Blue", "harmless");
    h.B.startGame(["Blue"], 1, false, true);
    const g = h.B._getGame();
    same("a seated colour isn't an AI seat", { bots: g.bots, harmless: g.harmlessWanted.length, forge: g.forgeSeats.length }, { bots: 1, harmless: 0, forge: 0 });
  });

  // ── debug tools ──
  const setup = (h) => {
    const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
    seat.slot = "player-0";
    seat.board = { state: myMain(), fingerprint: null };
    h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: [], slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
      started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
    h.B.onPrompt(seat, prompt("chooseAction", PASS));
    return seat;
  };
  const tool = async (h, m) => { const r = h.B.onToolsPost({ kind: "debug", ...m }); await h.flush(); return r; };
  const endFix = async (h, seat) => { const a = applies(h).pop(); const b = myMain(); b.gameView.stateFix = { fixId: a?.fixId, applied: true }; seat.board.state = b; h.B._getGame().lastTableSig = null; h.B.sendTable(); await h.flush(); };
  await run(async (h) => {
    const seat = setup(h);
    await h.flush();
    const r0 = await tool(h, { tool: "mana", color: "Blue", n: 3, mana: "R" });
    ok("off: refused, nothing sent", !r0.ok && /Debug tools are off/.test(r0.message) && !applies(h).length, JSON.stringify(r0));
    same("GET: the state says off", h.B.toolsState().debug.on, false);
    const on = h.B.onToolsPost({ kind: "debug-mode", on: true });
    await h.flush();
    ok("on: said to the whole table", on.ok && chats(h).some((t) => /^\[MTG\] The host switched debug tools on/.test(t)), JSON.stringify(on));
    const r1 = await tool(h, { tool: "mana", color: "Blue", n: 3, mana: "r" });
    ok("mana: started", r1.ok && r1.message === "Debug tool: add 3 R mana to Blue's pool.", JSON.stringify(r1));
    same("mana: one applyState with the mana op", applies(h).map((a) => a.ops), [[{ op: "mana", player: "player-0", mana: "R R R" }]]);
    const busy = await tool(h, { tool: "life", color: "Blue", n: 5 });
    ok("while a fix is under way: refused", !busy.ok && /already under way/.test(busy.message), JSON.stringify(busy));
    await endFix(h, seat);
    same("applied: the fix is over", h.B._getGame().fix, null);
    h.B.onPrompt(seat, prompt("chooseAction", PASS, 901)); await h.flush();
    await tool(h, { tool: "hand", color: "Blue", name: "lightning bolt" });
    same("hand: createCard by the engine's own name", applies(h).pop()?.ops, [{ op: "createCard", name: "Lightning Bolt", player: "player-0", zone: "hand" }]);
    await endFix(h, seat); h.B.onPrompt(seat, prompt("chooseAction", PASS, 902)); await h.flush();
    await tool(h, { tool: "battlefield", color: "White", name: "treasure" });
    same("battlefield: a token by its words, for the AI", applies(h).pop()?.ops, [{ op: "createCard", name: "c_a_treasure_sac", player: "player-1", zone: "battlefield" }]);
    await endFix(h, seat); h.B.onPrompt(seat, prompt("chooseAction", PASS, 903)); await h.flush();
    await tool(h, { tool: "life", color: "White", n: 7 });
    same("life: the life op", applies(h).pop()?.ops, [{ op: "life", player: "player-1", n: 7 }]);
    await endFix(h, seat); h.B.onPrompt(seat, prompt("chooseAction", PASS, 904)); await h.flush();
    const nothing = await tool(h, { tool: "untap", color: "Blue" });
    ok("untap with nothing tapped: refused", !nothing.ok && nothing.message === "Blue has nothing tapped.", JSON.stringify(nothing));
    const gv = seat.board.state.gameView;
    const bf = gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0");
    bf.cards[0].tapped = true; bf.cards[2].tapped = true;
    gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1").cards[0].tapped = true;
    await tool(h, { tool: "untap", color: "Blue" });
    same("untap: every tapped permanent Blue controls, only those", applies(h).pop()?.ops, [{ op: "tap", card: bf.cards[0].id, tapped: false }, { op: "tap", card: bf.cards[2].id, tapped: false }]);
    await endFix(h, seat); h.B.onPrompt(seat, prompt("chooseAction", PASS, 905)); await h.flush();
    const n0 = applies(h).length;
    const bad = [await tool(h, { tool: "hand", color: "Blue", name: "Notacard Atall" }), await tool(h, { tool: "hand", color: "Blue", name: "" }),
      await tool(h, { tool: "mana", color: "Blue", n: 0, mana: "R" }), await tool(h, { tool: "mana", color: "Blue", n: 3, mana: "X" }),
      await tool(h, { tool: "life", color: "Blue", n: 1000 }), await tool(h, { tool: "life", color: "Red", n: 5 }), await tool(h, { tool: "draw", color: "Blue", n: 1 })];
    same("refusals: each with its reason", bad.map((r) => r.ok ? "ok" : r.message), ['The engine has no card called "Notacard Atall".', "Name a card.", "Say 1 to 99 mana.",
      "Pick a mana colour: W, U, B, R, G or C.", "Say a life total from 0 to 999.", "Red isn't in this game.", 'No debug tool "draw".']);
    same("refusals: nothing sent", applies(h).length, n0);
    const st = h.B.toolsState();
    same("GET: players and tools", { on: st.debug.on, game: st.debug.game, players: st.debug.players, tools: st.tools }, { on: true, game: true, players: [{ color: "Blue", name: "Blue" }, { color: "White", name: "AI 1" }], tools: ["mana", "hand", "battlefield", "life", "untap"] });
    same("GET: four seats", st.seats.map((s) => [s.color, s.person, s.ai]), [["White", false, null], ["Red", false, null], ["Yellow", false, null], ["Blue", true, null]]);
    h.B.onToolsPost({ kind: "debug-mode", on: false });
    const off = await tool(h, { tool: "life", color: "Blue", n: 5 });
    ok("off again: refused", !off.ok && /off/.test(off.message));
    ok("an unknown kind is refused", !h.B.onToolsPost({ kind: "nope" }).ok && !h.B.onToolsPost(null).ok && !h.B.onToolsPost([1]).ok);
    const ai = h.B.onToolsPost({ kind: "ai-seat", color: "Red", seat: "forge", preset: "ai_passive_lands" });
    await h.flush();
    ok("ai-seat: set, said to the table", ai.ok && chats(h).includes("[MTG] AI seat (companion page): Red: Forge AI playing Passive AI (lands only) (from the next game)."), JSON.stringify(chats(h).slice(-2)));
    same("GET: the seat shows it", h.B.toolsState().seats[1].ai, { kind: "forge", kindLabel: "Forge AI", deckName: "Passive AI (lands only)", source: "ai_passive_lands" });
  });
  // a person at the table is asked, as for any fix
  const two = (h) => {
    const seat = setup(h);
    const red = new h.B.Seat("Red", "neheb_minotaur_commander");
    red.slot = "player-2";
    const g = h.B._getGame();
    g.seats.set("Red", red); g.slotColor["player-2"] = "Red"; g.slotNames["player-2"] = "Red";
    seat.board.state.gameView.players.push({ ...clone(seat.board.state.gameView.players[1]), id: "player-2" });
    red.board = clone(seat.board);
    h.B.setDebugTools(true);
    return g;
  };
  await run(async (h) => {
    const g = two(h);
    await h.flush();
    const r = await tool(h, { tool: "life", color: "White", n: 9 });
    ok("for an AI: asked in the first person's name, nothing applied yet", r.ok && !applies(h).length && g.fix?.state === "voting" && JSON.stringify(g.fix.waiting) === '["Red"]', JSON.stringify(g.fix));
    ok("the vote says it is a debug tool", chats(h).some((t) => t === '[MTG] Blue asks to pause the game for the debug tool "set White\'s life to 9". Waiting for Red: vote in the pop-up (or type  mtg fix yes / mtg fix no).'), JSON.stringify(chats(h).slice(-3)));
    h.B.onTTS({ t: "fix", json: JSON.stringify({ color: "Red", action: "vote", accept: true }) });
    await h.flush();
    ok("paused: the change goes to the vote, worded as a debug tool", g.fix?.state === "review" && chats(h).some((t) => t === '[MTG] Blue wants to use the debug tool "set White\'s life to 9". Waiting for Red: vote in the pop-up (or type  mtg fix yes / mtg fix no).'), JSON.stringify(chats(h).slice(-3)));
    h.B.onTTS({ t: "fix", json: JSON.stringify({ color: "Red", action: "vote", accept: true }) });
    await h.flush();
    same("agreed: applied", applies(h).map((a) => a.ops), [[{ op: "life", player: "player-1", n: 9 }]]);
  });
  await run(async (h) => {
    const g = two(h);
    await h.flush();
    await tool(h, { tool: "life", color: "Red", n: 9 });
    ok("for a person: asked in that person's name, the others vote", g.fix?.by === "Red" && JSON.stringify(g.fix.waiting) === '["Blue"]', JSON.stringify(g.fix));
  });

  // ── the HTTP routes on the debug port, over a real socket ──
  {
    process.env.MTG_DEBUG_PORT = "48992";
    process.env.MTG_TTS_OUT = "48993"; // (the chat that debug-mode says goes nowhere: never to a running TTS)
    const h = harness.load();
    harness.restore(); // (real network for the requests below)
    await new Promise((r) => h.B.debugServer.listen(48992, "127.0.0.1", r));
    const http = require("http");
    const call = (method, body, headers = {}) => new Promise((resolve) => {
      const r = http.request({ host: "127.0.0.1", port: 48992, path: "/tools", method, headers: { "Content-Type": "application/json", ...headers } }, (res) => {
        let t = ""; res.setEncoding("utf8"); res.on("data", (d) => { t += d; }); res.on("end", () => resolve({ status: res.statusCode, body: t }));
      });
      r.on("error", (e) => resolve({ status: 0, body: e.message })); if (body != null) r.write(body); r.end();
    });
    try {
      const g = await call("GET");
      const st = JSON.parse(g.body || "{}");
      ok("GET /tools: 200, the four seats and the presets", g.status === 200 && st.seats?.length === 4 && st.presets?.includes("ai_passive_lands"), g.body.slice(0, 200));
      const on = await call("POST", JSON.stringify({ kind: "debug-mode", on: true }));
      same("POST /tools: an answer, 200 with ok", [on.status, JSON.parse(on.body || "{}").ok], [200, true]);
      const no = await call("POST", JSON.stringify({ kind: "debug", tool: "life", color: "Blue", n: 3 }));
      same("POST /tools: a refusal is 200 with ok false and why", [no.status, JSON.parse(no.body || "{}")], [200, { ok: false, message: "No table game is running." }]);
      const bad = await call("POST", "{ not json");
      same("POST /tools: a body that isn't JSON", [bad.status, JSON.parse(bad.body || "{}")], [200, { ok: false, message: "The body isn't JSON." }]);
      ok("a browser's request (Origin) is refused, as on every route", (await call("POST", JSON.stringify({ kind: "debug-mode", on: false }), { Origin: "https://evil.example" })).status === 403 && h.B.toolsState().debug.on === true);
    } finally {
      h.B.debugServer.close();
      delete process.env.MTG_DEBUG_PORT;
      delete process.env.MTG_TTS_OUT;
    }
  }

  process.stdout.write(failed ? `FAILED: ${failed} failed, ${passed} passed\n` : `PASSED: ${passed} passed, 0 failed\n`);
  process.exit(failed ? 1 : 0);
})();
