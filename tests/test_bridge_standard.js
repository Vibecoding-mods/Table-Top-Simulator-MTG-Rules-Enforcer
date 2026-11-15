// Standard mode in the bridge (docs/game-modes-spec.md §3): Forge's own Standard data (bridge/forge-formats.json), the
// deck check (60+, 15 sideboard, 4 copies with basic lands and "any number" cards excepted, banned cards, cards from
// sets outside the list, no commander), the mode the table sends (mode, hello, decks, start), the start in Standard
// (StartGame's format, the decks sent with no commander and with their sideboard, the AI's Standard decks, "Standard,
// 1v1" / "free-for-all (N)"), AI seats and "mtg aideck" in either mode, the mode in the resume file, and the four AI
// Standard decks themselves. Commander games are the golden's (tests/test_bridge_golden.js), unchanged.
//   node tests/test_bridge_standard.js
const fs = require("fs");
const path = require("path");
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${String(why).slice(0, 600)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const FORMATS = require("../bridge/forge-formats.json");
const chats = (h) => h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const reports = (h) => h.effects.filter((e) => e.tts?.t === "deckReport").map((e) => e.tts);
const relay = (h) => h.effects.map((e) => e.relay).filter(Boolean);
const run = async (fn, opts) => { const h = harness.load(opts); try { return await fn(h); } finally { harness.restore(); } };
const frame = (ws, msg) => ws.emit("message", JSON.stringify(msg));
const say = (h, t, m) => h.B.onTTS({ t, json: JSON.stringify(m) });

// a table deck entry ({ n, f } cards, as engineSendDecks sends them) from "count name" pairs
const entry = (pairs, commander = [], deckName = "Test deck") => ({
  deckName, commander: commander.map((n) => ({ n, f: null })),
  library: pairs.flatMap(([k, n]) => Array.from({ length: k }, () => ({ n, f: null }))),
});
const deckPairs = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "decks", `${id}.json`), "utf8")).cards.map((c) => [c.count, c.name]);
const RAKDOS = deckPairs("standard_rakdos_ingris"); // (60, all legal)
// RAKDOS with some counts changed ({ name: count }), Mountains making up the difference (60 + extra cards)
const withCards = (changes, extra = 0) => {
  const out = RAKDOS.map(([k, n]) => [n in changes ? changes[n] : k, n]);
  for (const n of Object.keys(changes)) if (!out.some(([, m]) => m === n)) out.push([changes[n], n]);
  const total = out.reduce((a, [k]) => a + k, 0);
  return out.map(([k, n]) => [n === "Mountain" ? k - (total - 60 - extra) : k, n]).filter(([k]) => k > 0);
};
// the deck check of one entry for Blue in `mode` (undefined: no mode sent, i.e. Commander): { said, ready, deck }
async function check(h, e, mode) {
  const mark = h.effects.length;
  say(h, "decks", { seats: { Blue: e }, request: 7, ...(mode ? { mode } : {}) });
  await h.flush();
  const said = h.effects.slice(mark).filter((x) => x.tts?.t === "chat").map((x) => x.tts.text).join("\n");
  const rep = h.effects.slice(mark).filter((x) => x.tts?.t === "deckReport").pop()?.tts;
  return { said, ready: !!rep?.ready?.includes("Blue"), deck: h.B._readyDecks.Blue };
}

(async () => {
  // ── Forge's own Standard data ──
  const S = FORMATS.formats.Standard;
  same("data: Standard's 20 sets, as Forge's Sanctioned/Standard.txt lists them", S.sets,
    ["WOE", "LCI", "MKM", "OTJ", "BIG", "BLB", "DSK", "FDN", "DFT", "TDM", "FIN", "EOE", "SPM", "TLA", "ECL", "TMT", "SOS", "MSH", "HOB", "FRA"]);
  same("data: the 13 banned cards", S.banned, ["Abuelo's Awakening", "Badgermole Cub", "Cori-Steel Cutter", "Gran-Gran", "Heartfire Hero", "Hopeless Nightmare",
    "Monstrous Rage", "Proft's Eidetic Memory", "Screaming Nemesis", "Stormchaser's Talent", "This Town Ain't Big Enough", "Up the Beanstalk", "Vivi Ornitier"]);
  const L = new Set(S.legal);
  ok("data: every set has an edition file", S.missingSets.length === 0, S.missingSets);
  ok("data: legal cards in, old and banned ones out", L.has("Llanowar Elves") && L.has("Burst Lightning") && L.has("Plains") && !L.has("Sol Ring") && !L.has("Lightning Bolt") && !L.has("Heartfire Hero") && !L.has("Snow-Covered Forest"),
    `${S.legal.length} legal`);
  ok("data: Hare Apparent may be in a deck any number of times", FORMATS.copyLimits["Hare Apparent"] === "any", JSON.stringify(FORMATS.copyLimits));

  // ── the deck check (spec §3.5's cases) ──
  await run(async (h) => {
    let r = await check(h, entry(RAKDOS, [], "Rakdos"), "standard");
    ok("check: a legal 60-card deck is ready for Standard", r.ready && /Blue \(Rakdos\): ready for Standard\. 60 cards; every card is known to the engine and legal in Standard\./.test(r.said) && r.deck.mode === "standard", r.said);
    r = await check(h, entry(withCards({}, -1)), "standard");
    ok("check: 59 cards is not a Standard deck", !r.ready && /59 cards in your deck: Standard decks have at least 60/.test(r.said) && !h.B._readyDecks.Blue, r.said);
    r = await check(h, entry(withCards({ "Hired Claw": 5 })), "standard");
    ok("check: 5 copies of a card are refused", !r.ready && /more than 4 copies of: 5× Hired Claw \(basic lands excepted\)/.test(r.said), r.said);
    r = await check(h, entry([[30, "Mountain"], [26, "Swamp"], [4, "Hired Claw"]]), "standard");
    ok("check: any number of basic lands", r.ready, r.said);
    r = await check(h, entry([[8, "Hare Apparent"], [52, "Plains"]]), "standard");
    ok("check: a card that says any number may have more than 4", r.ready, r.said);
    r = await check(h, entry(withCards({ Shock: 0, "Sol Ring": 1 })), "standard");
    ok("check: a card from a set not in Standard's list is refused, by name", !r.ready && /not in Standard's sets \(WOE LCI .* FRA\): Sol Ring/.test(r.said), r.said);
    r = await check(h, entry(withCards({ Shock: 0, "Heartfire Hero": 1 })), "standard");
    ok("check: a banned card is refused, said as banned", !r.ready && /banned in Standard: Heartfire Hero/.test(r.said) && !/not in Standard's sets/.test(r.said), r.said);
    r = await check(h, entry(withCards({ "Snow-Covered Mountain": 1 })), "standard");
    ok("check: a basic land Standard's sets don't print is refused", !r.ready && /not in Standard's sets .*: Snow-Covered Mountain/.test(r.said), r.said);
    r = await check(h, entry(RAKDOS, ["Ingris Stingerquill"]), "standard");
    ok("check: a card on the command zone (a commander line) is refused in Standard", !r.ready && /Standard has no commander: take Ingris Stingerquill off your command zone/.test(r.said), r.said);
    r = await check(h, entry(RAKDOS, ["Ingris Stingerquill"]));
    ok("check: no mode sent is Commander: the same deck with a commander passes Commander's check", r.ready && r.deck.mode === "commander" && /ready\. \d+ cards \+ commander Ingris Stingerquill/.test(r.said), r.said);
    r = await check(h, entry(RAKDOS), "standard");
    ok("check: no commander needed in Standard", r.ready, r.said);
    r = await check(h, entry([[60, "Notacard Atall"]]), "standard");
    ok("check: unknown cards are still said in Standard", !r.ready && /doesn't know 60 card\(s\)/.test(r.said), r.said);
  });
  // the format data missing: no deck passes (fail closed), and the chat says how to build it
  await run(async (h) => {
    const prev = fs.readFileSync;
    fs.readFileSync = (p, ...a) => { if (String(p).endsWith("forge-formats.json")) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; } return prev(p, ...a); };
    try {
      const r = await check(h, entry(RAKDOS), "standard");
      ok("check: without forge-formats.json nothing is ready for Standard", !r.ready && /no Standard card list .*build-forge-card-index\.js --formats/.test(r.said), r.said);
    } finally { fs.readFileSync = prev; }
  });
  // a card's own number (K:DeckLimit:N, as Seven Dwarves; none is in Standard today, so Hired Claw is given 7 here):
  // Forge counts it in the main deck only, where the 4 counts main deck and sideboard together
  await run(async (h) => {
    const prev = fs.readFileSync;
    const data = JSON.stringify({ ...FORMATS, copyLimits: { ...FORMATS.copyLimits, "Hired Claw": 7 } });
    fs.readFileSync = (p, ...a) => (String(p).endsWith("forge-formats.json") ? data : prev(p, ...a));
    try {
      const names = (pairs) => pairs.flatMap(([k, n]) => Array.from({ length: k }, () => n));
      const side = names([[4, "Duress"], [1, "Hired Claw"]]);
      const seven = h.B.standardProblems(names(withCards({ "Hired Claw": 7 })), [], side);
      const eight = h.B.standardProblems(names(withCards({ "Hired Claw": 8 })), [], []);
      ok("check: a card's own number (DeckLimit) counts the main deck only", seven.length === 0 && eight.some((p) => /8× Hired Claw/.test(p)), `${seven.join("; ")} / ${eight.join("; ")}`);
    } finally { fs.readFileSync = prev; }
  });

  // ── the mode the table sends ──
  await run(async (h) => {
    const G = h.B._gameMode;
    say(h, "mode", { color: "Blue", mode: "standard" });
    ok("mode: the table's mtg mode standard is taken", G.mode === "standard");
    say(h, "mode", { color: "Blue", mode: "vintage" });
    await h.flush();
    ok("mode: an unknown mode is refused, the mode kept", G.mode === "standard" && chats(h).some((t) => /Use:  mtg mode standard  or  mtg mode commander/.test(t)), JSON.stringify(chats(h)));
    say(h, "hello", { stamp: null, mode: "standard" });
    ok("mode: hello with Standard keeps it", G.mode === "standard");
    say(h, "hello", { stamp: null, again: true });
    ok("mode: hello without a mode is Commander (a reloaded table)", G.mode === "commander");
    say(h, "aideck", { deck: "" });
    say(h, "mode", { mode: "standard" });
    say(h, "aideck", { deck: "" });
    say(h, "aideck", { deck: "neheb_minotaur_commander" });
    say(h, "aideck", { deck: "standard_dimir_aggro standard_mono_green_landfall" });
    await h.flush();
    const c = chats(h);
    ok("mode: mtg aideck lists Commander decks in Commander", c.some((t) => /^\[MTG\] Commander decks: .*neheb_minotaur_commander/.test(t) && !t.includes("standard_")), JSON.stringify(c));
    // (the engine's own Standard presets that are still legal too: starter_deck_esper_pixie, whose two-sided Aang is
    // named by both faces; ironsmith_standard_* and the other starter decks hold rotated or banned cards)
    ok("mode: mtg aideck lists the legal Standard decks in Standard, and only those",
      c.some((t) => t === "[MTG] Standard decks: standard_dimir_aggro, standard_mono_green_landfall, standard_orzhov_soul_sisters, standard_rakdos_ingris, starter_deck_esper_pixie"), JSON.stringify(c.filter((t) => /Standard decks/.test(t))));
    ok("mode: a Commander deck can't be the AI's in Standard; Standard decks can", c.filter((t) => /^\[MTG\] Standard decks:/.test(t)).length === 2 && c.includes("[MTG] AI decks: standard_dimir_aggro, standard_mono_green_landfall (before any deck lying in an empty seat)."), JSON.stringify(c));
  });

  // ── AI seats in Standard ──
  await run(async (h) => {
    const C = h.B._aiSeatChoice, G = h.B._gameMode;
    ok("ai seat: a Commander deck set in Commander", h.B.setAiSeat("Yellow", "forge", { preset: "neheb_minotaur_commander" }).ok);
    say(h, "mode", { mode: "standard" });
    await h.flush();
    ok("ai seat: switching to Standard says the Commander-deck seat plays a built-in Standard deck",
      chats(h).includes("[MTG] In Standard the AI seat Yellow set with a Commander deck plays a built-in Standard deck instead (mtg ai <colour> forge <deck> to choose)."), JSON.stringify(chats(h)));
    const r1 = h.B.setAiSeat("Red", "forge", { preset: "neheb_minotaur_commander" });
    ok("ai seat: in Standard a Commander preset is refused", !r1.ok && /no Standard deck "neheb_minotaur_commander"/.test(r1.message), r1.message);
    const r2 = h.B.setAiSeat("Red", "forge", { preset: "standard_orzhov_soul_sisters" });
    ok("ai seat: in Standard a Standard preset is taken", r2.ok && C.Red.deck.deck.format === "standard" && C.Red.deck.deck.cards.length === 60 && C.Red.deck.deck.sideboard.length === 15, r2.message);
    const list = (main, side = "") => `Deck\n${main}${side ? `\nSideboard\n${side}` : ""}`;
    const main60 = "4 Hired Claw\n4 Burst Lightning\n26 Mountain\n26 Swamp";
    const r3 = h.B.setAiSeat("Blue", "forge", { list: list(main60, "4 Duress\n12 Swamp"), name: "Big side" });
    ok("ai seat: a Standard list with 16 sideboard cards is refused", !r3.ok && /16 cards in the sideboard: at most 15/.test(r3.message), r3.message);
    const r4 = h.B.setAiSeat("Blue", "forge", { list: list(main60, "1 Hired Claw") });
    ok("ai seat: 4 in the deck + 1 in the sideboard is 5 copies", !r4.ok && /5× Hired Claw/.test(r4.message), r4.message);
    const r5 = h.B.setAiSeat("Blue", "forge", { list: `Commander\n1 Ingris Stingerquill\n${list(main60)}` });
    ok("ai seat: a Standard list with a Commander line is refused", !r5.ok && /Standard has no commander/.test(r5.message), r5.message);
    const r0 = h.B.setAiSeat("Red", "forge", { preset: "ironsmith_standard_264531" });
    ok("ai seat: an old Standard preset that has rotated out is refused", !r0.ok && /no Standard deck "ironsmith_standard_264531"/.test(r0.message), r0.message);
    const r6 = h.B.setAiSeat("Blue", "forge", { list: list(main60, "4 Duress\n2 Shock"), name: "Burn" });
    ok("ai seat: a legal Standard list is taken with its sideboard and no commander", r6.ok && C.Blue.deck.deck.format === "standard" && C.Blue.deck.deck.cards.length === 60
      && C.Blue.deck.deck.sideboard.map((c) => c.identity.name).join(",") === "Duress,Duress,Duress,Duress,Shock,Shock" && C.Blue.deck.deck.commanders.length === 0 && C.Blue.deck.commanderName === null, r6.message);
    const r7 = h.B.setAiSeat("White", "harmless");
    ok("ai seat: a harmless bot with no deck named still gets its lands deck in Standard", r7.ok && C.White.source === "ai_passive_lands", r7.message);
    G.mode = "commander";
    const r8 = h.B.setAiSeat("White", "forge", { preset: "standard_dimir_aggro" });
    ok("ai seat: in Commander a Standard preset is refused as before", !r8.ok && /no Commander deck/.test(r8.message), r8.message);
  });

  // ── a Standard game set up: Blue (a ready Standard deck) vs 1 Forge AI ──
  const startStandard = async (h, bots, mode = "standard", extra = () => {}) => {
    await check(h, entry(RAKDOS, mode === "standard" ? [] : ["Ingris Stingerquill"], "My Rakdos"), mode === "standard" ? mode : undefined);
    extra();
    say(h, "start", { seats: ["Blue"], bots, requireReady: true, fromTable: true, ...(mode === "standard" ? { mode } : {}) });
    await h.flush();
    const g = h.B._getGame();
    const blue = g?.seats.get("Blue");
    if (!blue) return { g };
    blue.heartbeat = () => {};
    blue.ws.emit("open");
    frame(blue.ws, { type: "AuthResult", success: true });
    frame(blue.ws, { type: "RoomList", rooms: [{ room_id: "room-1", room_name: "tts-commander", status: "Lobby" }] });
    const lobby = (players) => ({ type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 4, players } });
    frame(blue.ws, lobby([{ username: blue.username, ready: false, connected: true }]));
    await h.flush();
    const players = [{ username: blue.username, ready: true, connected: true }, ...Array.from({ length: bots }, (_, i) => ({ username: `self-hosted-node-bot${i ? ` ${i + 1}` : ""}`, ready: true, connected: true, is_bot: true }))];
    frame(blue.ws, lobby(players));
    await h.flush();
    const start = relay(h).find((r) => r.type === "StartGame");
    if (start) frame(blue.ws, { type: "GameStarted", player_order: start.seat_order, game_id: "g1", starting_life: 20 });
    await h.flush();
    return { g, blue, start };
  };
  await run(async (h) => {
    const { g, start } = await startStandard(h, 1);
    ok("start 1v1: said as Standard, 1v1", chats(h).includes("[MTG] Setting up Standard, 1v1: Blue + 1 Forge AI..."), JSON.stringify(chats(h)));
    ok("start 1v1: the game is a Standard game", g.mode === "standard");
    const sel = relay(h).find((r) => r.type === "SetDeckSelection");
    ok("start 1v1: Blue's deck goes as a Standard deck, no commander", sel && sel.deck.format === "standard" && sel.deck.cards.length === 60 && sel.deck.commanders.length === 0 && sel.commander_name === null && sel.deck_name === "My Rakdos",
      JSON.stringify({ ...sel, deck: { ...sel?.deck, cards: sel?.deck?.cards?.length } }));
    const spawn = relay(h).find((r) => r.state?.payload?.type === "spawnBot")?.state.payload;
    // (Blue's seat holds the first built-in deck, as in Commander: the AI gets the next one)
    ok("start 1v1: the Forge AI plays the next built-in Standard deck, with its sideboard", spawn && spawn.decks.length === 1 && spawn.decks[0].deckName === "Standard: Mono-Green Landfall"
      && spawn.decks[0].deck.format === "standard" && spawn.decks[0].deck.cards.length === 60 && spawn.decks[0].deck.sideboard.length === 15 && !spawn.decks[0].deck.commanders && spawn.decks[0].commanderName === null,
      JSON.stringify(spawn?.decks?.map((d) => d.deckName)));
    same("start 1v1: StartGame asks for Standard (the relay's 20 life; Forge's Constructed)", start?.format, "Standard");
    const started = h.effects.map((e) => e.tts).find((t) => t?.t === "started");
    ok("start 1v1: the table is told it is a Standard game", started?.mode === "standard", JSON.stringify(started));
    // the resume file keeps it
    let snap = null;
    const prev = fs.writeFile;
    fs.writeFile = (p, d, ...rest) => { if (String(p).includes("mtg-bridge-game-test")) snap = JSON.parse(d); return prev(p, d, ...rest); };
    h.B.saveResume();
    await h.flush();
    ok("resume: a Standard game's save says Standard", snap?.game?.mode === "standard", JSON.stringify(snap?.game || null).slice(0, 200));
  });
  await run(async (h) => {
    const { start } = await startStandard(h, 3);
    ok("start 4 players: said as Standard, free-for-all (4)", chats(h).includes("[MTG] Setting up Standard, free-for-all (4): Blue + 3 Forge AI..."), JSON.stringify(chats(h)));
    const spawn = relay(h).find((r) => r.state?.payload?.type === "spawnBot")?.state.payload;
    same("start 4 players: three different built-in Standard decks", spawn?.decks.map((d) => d.deckName), ["Standard: Mono-Green Landfall", "Standard: Orzhov Soul Sisters", "Standard: Dimir Aggro"]);
    same("start 4 players: StartGame asks for Standard", start?.format, "Standard");
  });
  await run(async (h) => {
    // "mtg aideck" decks of the other mode are skipped; an AI seat with a Commander deck plays a built-in Standard one
    const { start } = await startStandard(h, 2, "standard", () => {
      h.B._gameMode.mode = "commander";
      say(h, "aideck", { deck: "neheb_minotaur_commander" });
      h.B.setAiSeat("Yellow", "forge", { preset: "ashling_limitless_commander" });
    });
    const spawn = relay(h).find((r) => r.state?.payload?.type === "spawnBot")?.state.payload;
    same("start with Commander AI choices in Standard: built-in Standard decks instead", spawn?.decks.map((d) => d.deckName), ["Standard: Rakdos Ingris aggro", "Standard: Mono-Green Landfall"]);
    same("start with Commander AI choices in Standard: still a Standard game", start?.format, "Standard");
  });
  await run(async (h) => {
    // a deck readied for Commander isn't ready for a Standard start
    await check(h, entry(RAKDOS, ["Ingris Stingerquill"]));
    say(h, "start", { seats: ["Blue"], bots: 1, requireReady: true, fromTable: true, mode: "standard" });
    await h.flush();
    ok("start: a deck checked for Commander must be readied again for Standard", !h.B._getGame() && chats(h).some((t) => /Not started: Blue still need "mtg ready" for Standard/.test(t)), JSON.stringify(chats(h)));
  });
  await run(async (h) => {
    const { start, g } = await startStandard(h, 1, "commander");
    same("start in Commander: StartGame still asks for Commander", start?.format, "Commander");
    const started = h.effects.map((e) => e.tts).find((t) => t?.t === "started");
    ok("start in Commander: the table's started message has no mode", started && !("mode" in started) && g.mode === "commander", JSON.stringify(started));
  });
  // ── the room's own format (headless 2026-11-15): the relay takes StartGame's format only in an "Any" room, and a room
  // fresh from the node is Commander until its first game ends, so a Standard start there got 40 life ──
  const formatStart = async (h, mode, roomFormat) => {
    await check(h, entry(RAKDOS, mode === "standard" ? [] : ["Ingris Stingerquill"], "My Rakdos"), mode === "standard" ? mode : undefined);
    say(h, "start", { seats: ["Blue"], bots: 1, requireReady: true, fromTable: true, ...(mode === "standard" ? { mode } : {}) });
    await h.flush();
    const blue = h.B._getGame()?.seats.get("Blue");
    blue.heartbeat = () => {};
    blue.ws.emit("open");
    frame(blue.ws, { type: "AuthResult", success: true });
    frame(blue.ws, { type: "RoomList", rooms: [{ room_id: "room-1", room_name: "tts-commander", status: "Lobby" }] });
    const bot = { username: "self-hosted-node-bot", ready: true, connected: true, is_bot: true };
    const update = async (format, ready) => {
      frame(blue.ws, { type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 4, format, players: [{ username: blue.username, ready, connected: true }, bot] } });
      await h.flush();
    };
    return { blue, update };
  };
  await run(async (h) => {
    const { update } = await formatStart(h, "standard", "Commander");
    await update("Commander", true); // (Blue joined and is ready, the room still Commander)
    const sets = () => relay(h).filter((r) => r.type === "SetFormat");
    same("room format: a Standard start in a Commander room sets the room to Standard first", sets().map((r) => r.format), ["Standard"]);
    ok("room format: no StartGame while the room is still Commander", !relay(h).some((r) => r.type === "StartGame"), JSON.stringify(relay(h).map((r) => r.type)));
    await update("Commander", true);
    same("room format: SetFormat is sent once", sets().length, 1);
    const readies = () => relay(h).filter((r) => r.type === "SetReady").length;
    const before = readies();
    await update("Standard", false); // (the relay un-readies the people when the format changes)
    same("room format: un-readied by the format change, Blue says ready again", readies(), before + 1);
    await update("Standard", false);
    same("room format: ready is said again only once", readies(), before + 1);
    await update("Standard", true);
    same("room format: once the room is Standard and everyone is ready, StartGame goes", relay(h).find((r) => r.type === "StartGame")?.format, "Standard");
  });
  for (const [mode, roomFormat] of [["standard", "Any"], ["standard", "Standard"], ["commander", "Commander"], ["commander", "Any"]]) await run(async (h) => {
    const { update } = await formatStart(h, mode, roomFormat);
    await update(roomFormat, true);
    const want = mode === "standard" ? "Standard" : "Commander";
    ok(`room format: ${mode} in a${roomFormat === "Any" ? "n" : ""} ${roomFormat} room: no SetFormat, StartGame ${want}`,
      !relay(h).some((r) => r.type === "SetFormat") && relay(h).find((r) => r.type === "StartGame")?.format === want, JSON.stringify(relay(h).map((r) => r.type + (r.format ? " " + r.format : ""))));
  });
  await run(async (h) => {
    const { update } = await formatStart(h, "commander", "Standard");
    await update("Standard", true); // (a room left on Standard by someone else)
    same("room format: a Commander start in a Standard room sets it to Commander", relay(h).filter((r) => r.type === "SetFormat").map((r) => r.format), ["Commander"]);
    ok("room format: no Commander StartGame in a Standard room", !relay(h).some((r) => r.type === "StartGame"));
  });
  await run(async (h) => {
    // "mtg deck" (a seat's preset, used when it has no table deck) chosen in Standard: a Commander game gives that
    // seat a Commander deck instead
    say(h, "mode", { mode: "standard" });
    say(h, "deck", { color: "Blue", deck: "standard_dimir_aggro" });
    const { g } = await startStandard(h, 1, "commander");
    same("start in Commander: a Standard deck chosen with mtg deck gives way to a Commander one", g?.seats.get("Blue")?.deckId, "neheb_minotaur_commander");
  });

  // ── the four AI Standard decks ──
  await run(async (h) => {
    for (const id of h.B.STANDARD_DECKS) {
      const p = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "decks", `${id}.json`), "utf8"));
      const d = h.B.loadPreset(id).deck;
      const names = (list) => list.map((c) => c.identity.name);
      const probs = h.B.standardProblems(names(d.cards), [], names(d.sideboard));
      ok(`deck ${id}: a legal Standard deck (60, 15 sideboard, every card in Forge's list)`, p.format === "standard" && d.cards.length === 60 && d.sideboard.length === 15 && probs.length === 0 && !p.commander, probs.join("; "));
      ok(`deck ${id}: says where it is from and why it was picked`, /draftsim\.com/.test(p.source || "") && String(p.reasoning || "").length > 40);
    }
  });

  console.log(failed ? `FAILED: ${failed} failed, ${passed} passed` : `PASSED: ${passed} passed, 0 failed`);
  process.exit(failed ? 1 : 0);
})();
