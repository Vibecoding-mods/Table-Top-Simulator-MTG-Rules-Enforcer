// Planechase in the bridge (docs/planechase-dungeon-engine-spec.md P1, P8): the host's switch and the planar pool, the
// pool in the first seated player's deck, the planes taken out of the command zones into the board's own list with
// the planar block, and the planar die's action once, on the plane, with its cost. Boards are the golden's recorded
// dump2 (Blue vs AI White) with planes added the way our Forge build sends them; the names are Forge's own
// (bridge/forge-planes.json, from the card scripts).
//   node tests/test_bridge_planar.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const clone = (x) => JSON.parse(JSON.stringify(x));
const D2 = require("./golden/fixtures/dump2.json");
const LIST = require("../bridge/forge-planes.json");
const myMain = () => { const b = clone(D2.board); Object.assign(b.gameView, { activePlayerId: "player-0", step: "main1", priorityPlayerId: "player-0", stack: [] }); return b; };
const chats = (h) => h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const relay = (h) => h.effects.map((e) => e.relay).filter(Boolean);
const tables = (h) => h.effects.filter((e) => e.tts?.t === "table").map((e) => e.tts);
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const say = (h, t, m) => h.B.onTTS({ t, json: JSON.stringify({ color: "Blue", ...m }) });
const frame = (ws, msg) => ws.emit("message", JSON.stringify(msg));

// a game the table draws: Blue seated (player-0), AI White (player-1)
function game(h, board) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: board, fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  return seat;
}
const PLANE = (n, name, owner, types = ["Plane"]) => ({ id: `engine-card-${n}`, identity: { name }, types, ownerId: owner, controllerId: owner, text: `${name}'s text\nWhenever chaos ensues, something happens.` });
function withPlane(board, owner = "player-1", planar = {}) {
  const gv = board.gameView;
  let cz = gv.zones.find((z) => z.zone === "command" && z.ownerId === owner);
  if (!cz) gv.zones.push(cz = { zone: "command", ownerId: owner, cards: [], count: 0 });
  cz.cards.push(PLANE(400, "Akoum", owner));
  cz.count = cz.cards.length;
  gv.planar = { controllerId: owner, planeIds: ["engine-card-400"], dieRollsThisTurn: 0, deckCounts: { "player-0": 9, "player-1": 8 }, ...planar };
  return board;
}

(async () => {
  ok("the plane list: Forge's planes and phenomena", LIST.planes.includes("Akoum") && LIST.planes.includes("Turri Island") && LIST.phenomena.includes("Interplanar Tunnel") && !LIST.planes.includes("Interplanar Tunnel"),
    `${LIST.planes.length} planes, ${LIST.phenomena.length} phenomena`);

  // ── the host's switch and the pool ──
  await run(async (h) => {
    say(h, "planechase", { on: true });
    say(h, "planes", { text: "akoum; turri island ; interplanar tunnel" });
    say(h, "planes", { text: "akoum; nowhere at all" });
    say(h, "planes", { text: "random 31" });
    say(h, "planechase", { on: false });
    await h.flush();
    same("switch and names: said, names as Forge spells them, unknown names refused", chats(h), [
      "[MTG] Planechase on for the next games (10 random planes and phenomena a player; mtg planes to choose).",
      "[MTG] Planar decks: Akoum, Turri Island, Interplanar Tunnel.",
      "[MTG] Not planes Forge knows: nowhere at all. Separate names with ;",
      "[MTG] Use:  mtg planes random [1-30]  (planes and phenomena a player)",
      "[MTG] Planechase off."]);
  });
  // a game started with Planechase on: the pool in Blue's deck only, at random 10 a player, no repeats, 2 phenomena in 10
  await run(async (h) => {
    say(h, "planes", { text: "random" });
    say(h, "planechase", { on: true });
    h.B.startGame(["Blue"], 1, false, true);
    const g = h.B._getGame();
    ok("start: a pool of 10 a player", g.planes?.length === 20, JSON.stringify(g.planes));
    ok("start: no plane twice", new Set(g.planes || []).size === (g.planes || []).length);
    same("start: 4 phenomena in 20", (g.planes || []).filter((n) => LIST.phenomena.includes(n)).length, 4);
    const blue = g.seats.get("Blue");
    blue.heartbeat = () => {};
    blue.ws.emit("open");
    frame(blue.ws, { type: "AuthResult", success: true });
    frame(blue.ws, { type: "RoomList", rooms: [{ room_id: "room-1", room_name: "tts-commander", status: "Lobby" }] });
    frame(blue.ws, { type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 4, players: [{ username: blue.username, ready: false, connected: true }] } });
    await h.flush();
    const sel = relay(h).find((r) => r.type === "SetDeckSelection");
    same("deck: the pool as the deck's planes, by name, typed", (sel?.deck?.planes || []).map((c) => [c.identity.name, c.types[0]]),
      (g.planes || []).map((n) => [n, LIST.phenomena.includes(n) ? "Phenomenon" : "Plane"]));
    ok("deck: said", chats(h).includes("[MTG] Planechase: 20 planes and phenomena dealt to the planar decks."), JSON.stringify(chats(h).slice(-3)));
  });
  // the host's own list, too few planes for the players: not started
  await run(async (h) => {
    say(h, "planechase", { on: true });
    say(h, "planes", { text: "akoum; interplanar tunnel" });
    h.B.startGame(["Blue"], 1, false, true);
    await h.flush();
    same("too few planes: not started", [h.B._getGame(), chats(h).at(-1)],
      [null, "[MTG] Not started: Planechase needs a plane for every player: the list has 1 for 2 players (mtg planes random, or name more)."]);
  });
  // off: no planes in the deck (today's game)
  await run(async (h) => {
    h.B.startGame(["Blue"], 1, false, true);
    same("off: no pool", h.B._getGame().planes, null);
  });

  // ── the board ──
  await run(async (h) => {
    game(h, withPlane(myMain(), "player-1", { lastRoll: { playerId: "player-0", result: "chaos", seq: 3 } }));
    h.B.sendTable(); await h.flush();
    const t = tables(h).find((x) => x.players.every((p) => p.command || (p.keep || []).includes("command")));
    same("table: the plane in the board's planes, controlled by the planar controller", (t?.planes || []).map((c) => [c.id, c.ctl]), [["engine-card-400", "White"]]);
    ok("table: the plane's details with the board's cards", t?.cards?.["engine-card-400"]?.n === "Akoum", JSON.stringify(t?.cards?.["engine-card-400"]));
    ok("table: out of White's command zone", !(t?.players.find((p) => p.color === "White")?.command || []).some((c) => c.id === "engine-card-400"), JSON.stringify(t?.players.find((p) => p.color === "White")?.command));
    same("table: the planar block", t?.planar, { controller: "White", rollCost: 0, deckCount: 8, last: { who: "Blue", result: "chaos", seq: 3 } });
  });
  await run(async (h) => {
    game(h, myMain());
    h.B.sendTable(); await h.flush();
    const t = tables(h)[0];
    ok("table: a game without Planechase has neither", t && !("planes" in t) && !("planar" in t), JSON.stringify(Object.keys(t || {})));
  });

  // ── the planar die in the priority panel ──
  const ROLL = (id) => ({ id, type: "activateAbility", cardId: `engine-card-${id === "r1" ? 901 : 902}`, description: "{X}: Roll the planar dice. X is equal to the number of times you have previously taken this action this turn." });
  for (const [n, want, ab] of [[0, "Roll the planar die (free)", "Planar die: free"], [2, "Roll the planar die ({2})", "Planar die: {2}"]]) {
    await run(async (h) => {
      const seat = game(h, withPlane(myMain(), "player-0", { dieRollsThisTurn: n }));
      h.B.onPrompt(seat, { promptId: 900, decidingPlayerId: "player-0", input: { type: "chooseAction", actions: [{ id: "pass", type: "pass" }, ROLL("r1"), ROLL("r2")] } });
      await h.flush();
      const rolls = (seat.prompt?.ui?.options || []).filter((o) => /planar/i.test(o.label));
      same(`roll after ${n} rolls: once, on the plane, with its cost`, rolls.map((o) => [o.id, o.cardId, o.label, o.ab]), [["r1", "engine-card-400", want, ab]]);
    });
  }

  // ── the leftovers of 2026-11-13: chaos on the stack, the planar questions in Forge's words, pictures ahead ──
  // (Akoum's script: "T:Mode$ ChaosEnsues | ... | TriggerDescription$ Whenever chaos ensues, destroy target creature that
  // isn't enchanted." with "TgtPrompt$ Select target creature that isn't enchanted"; the harness sends the trigger's words
  // as sourceAbilityText and Forge's stack line, "<card> (<n>) - <words>", as text)
  const CHAOS_WORDS = "Whenever chaos ensues, destroy target creature that isn't enchanted.";
  const CHAOS = { id: "engine-stack-9", sourceId: "engine-card-400", controllerId: "player-0", ownerId: "player-0", identity: { name: "Akoum" },
    text: `Akoum (400) - ${CHAOS_WORDS}`, sourceAbilityText: CHAOS_WORDS, isTrigger: true, targets: [] };
  await run(async (h) => {
    const b = withPlane(myMain(), "player-0");
    b.gameView.stack = [CHAOS];
    game(h, b);
    h.B.sendTable(); await h.flush();
    same("chaos on the stack: said as chaos, Forge's card number gone", tables(h).at(-1)?.stack?.map((s) => [s.n, s.tx]), [["Akoum", "Chaos — destroy target creature that isn't enchanted."]]);
  });
  await run(async (h) => {
    const b = withPlane(myMain(), "player-0");
    b.gameView.stack = [{ ...CHAOS, text: "Akoum (400) - Destroy target creature that isn't enchanted. (Targeting: Evolving Wilds (41))" }];
    game(h, b);
    h.B.sendTable(); await h.flush();
    same("chaos on the stack: a stack line in other words still says chaos", tables(h).at(-1)?.stack?.map((s) => s.tx), ["Chaos — Destroy target creature that isn't enchanted. (Targeting: Evolving Wilds)"]);
  });
  await run(async (h) => {
    const b = withPlane(myMain(), "player-0");
    const bear = b.gameView.zones.find((z) => z.zone === "battlefield" && z.cards.length).cards[0];
    const seat = game(h, b);
    h.B.onPrompt(seat, { promptId: 901, decidingPlayerId: "player-0", sourceCard: { id: "engine-card-400", identity: { name: "Akoum" } }, sourceAbilityText: CHAOS_WORDS,
      input: { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, candidates: [{ kind: "card", id: bear.id }], presentation: { title: "Select target creature that isn't enchanted" } } });
    await h.flush();
    same("chaos target: the plane's question, as chaos", seat.prompt?.ui?.title, "Akoum (chaos): destroy which creature that isn't enchanted?");
  });
  // (Forge's PlaneswalkEffect with Optional$ asks confirmAction "Would you like to planeswalk?" (lblWouldYouLikeToPlaneswalk):
  // Start the TARDIS, the TARDIS)
  await run(async (h) => {
    const seat = game(h, withPlane(myMain(), "player-0"));
    h.B.onPrompt(seat, { promptId: 902, decidingPlayerId: "player-0", sourceCard: { id: "engine-card-77", identity: { name: "Start the TARDIS" } },
      input: { type: "chooseBoolean", presentation: { title: "Would you like to planeswalk?" } } });
    await h.flush();
    same("planeswalk now: the card's question", [seat.prompt?.ui?.title, (seat.prompt?.ui?.options || []).map((o) => o.label)], ["Start the TARDIS: planeswalk now?", ["Yes", "No"]]);
    ok("planeswalk now: the question maps its answer", typeof seat.prompt?.toOutput === "function"); // (the check below was skipped silently without it; 2026-11-27)
    same("planeswalk now: Yes is a yes", seat.prompt?.toOutput?.(["yes"]), { type: "decision", value: true });
  });
  // (Interplanar Tunnel's script: DigUntil five planes, then "ChangeZone | ChangeType$ Card.IsImprinted | Origin$ PlanarDeck |
  // Destination$ PlanarDeck | LibraryPosition$ 0": Forge asks chooseSingleCardForZoneChange with lblSelectCardFromPlayerZone,
  // "Select a card from your planar deck", optional; the harness titles it with the source's name)
  const TUNNEL_WORDS = "When you encounter Interplanar Tunnel, reveal cards from the top of your planar deck until you reveal five plane cards. Put a plane card from among them on top of your planar deck, then put the rest of the revealed cards on the bottom in a random order. (Then planeswalk away from this phenomenon.)";
  const FIVE = ["Turri Island", "Naya", "Krosa", "Murasa", "Feeding Grounds"];
  const PICS = Object.fromEntries(FIVE.map((n) => [n.toLowerCase(), { face: `https://img.example/${n.replace(/ /g, "-")}.webp`, back: null }]));
  {
    const h = harness.load({ imageCache: PICS });
    try {
      const seat = game(h, withPlane(myMain(), "player-0"));
      h.B.onPrompt(seat, { promptId: 903, decidingPlayerId: "player-0", sourceCard: { id: "engine-card-401", identity: { name: "Interplanar Tunnel" }, types: ["Phenomenon"] }, sourceAbilityText: TUNNEL_WORDS,
        input: { type: "chooseCards", min: 0, max: 1, cards: FIVE.map((n, i) => ({ id: `engine-card-${500 + i}`, identity: { name: n }, types: ["Plane"], ownerId: "player-0" })),
          presentation: { title: "Interplanar Tunnel", description: "Select a card from your planar deck" } } });
      await h.flush();
      const ui = seat.prompt?.ui;
      same("Interplanar Tunnel: its own question", ui?.title, "Interplanar Tunnel: put which plane on top of your planar deck?");
      same("Interplanar Tunnel: one must go on top (the card's rule)", [ui?.min, ui?.max], [1, 1]);
      ok("Interplanar Tunnel: the rest's way said, no library search", String(ui?.text || "").startsWith("The others go to the bottom of your planar deck in a random order.") && !/Search/.test(String(ui?.text || "")), JSON.stringify(ui?.text));
      same("Interplanar Tunnel: the five planes as pictures, the ones fetched ahead", (ui?.options || []).map((o) => [o.label, !!o.img]), [...FIVE].sort().map((n) => [n, true]));
    } finally { harness.restore(); }
  }
  // the planes' pictures asked for ahead: when the host names them, and for a random pool when the game is set up, before
  // any seat joins (a plane is in no table deck; its first look was a card back)
  const asked = (h) => h.effects.filter((e) => /api\.scryfall\.com\/cards\/collection/.test(e.fetch || "")).flatMap((e) => (e.body?.identifiers || []).map((x) => x.name));
  await run(async (h) => {
    say(h, "planes", { text: "akoum; turri island" });
    await h.flush();
    same("pictures ahead: the host's planes asked for at once", asked(h).filter((n) => ["Akoum", "Turri Island"].includes(n)).sort(), ["Akoum", "Turri Island"]);
  });
  await run(async (h) => {
    say(h, "planes", { text: "random 3" });
    say(h, "planechase", { on: true });
    h.B.startGame(["Blue"], 1, false, true);
    await h.flush();
    const pool = h.B._getGame().planes || [];
    ok("pictures ahead: a random pool asked for as the game is set up", pool.length === 6 && pool.every((n) => asked(h).includes(n)), `pool ${JSON.stringify(pool)}, asked ${JSON.stringify(asked(h))}`);
  });

  console.log(failed ? `FAILED: ${failed} failed, ${passed} passed` : `PASSED: ${passed} passed, 0 failed`);
  process.exit(failed ? 1 : 0);
})();
