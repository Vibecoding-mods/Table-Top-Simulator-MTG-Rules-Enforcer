// Debug scenarios ("mtg debug <name>", scenarios/<name>.json): the setup is a manual fix with its list made from the
// file, no editing. Boards are the golden's recorded dump2 (Blue, Neheb, the Worthy: B and R, vs AI White). The
// scenarios are written to a folder of the test's own, so a change to scenarios/ never changes these cases.
//   node tests/test_bridge_debug.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-scenarios-"));
const SCEN = {
  plain: { lands: 20, keepHand: true },
  bare: { keepHand: 1 },
  setup: { lands: { Island: 2 }, keepHand: false, hand: ["Opt", { name: "Lightning Bolt" }], graveyard: ["Grizzly Bears"], exile: ["Llanowar Elves"],
    library: ["Brainstorm"], battlefield: [{ name: "Goblin Guide", tapped: true }], tokens: ["treasure"], life: 7, mana: 2,
    opponents: { battlefield: ["Llanowar Elves"], hand: ["Shock"], lands: 1, life: 3 } },
  "per-seat": { lands: 0, keepHand: true, opponents: { life: 5 }, White: { life: 9 } },
  nolands: { lands: 0, keepHand: true, hand: ["Opt"] },
  badname: { lands: 0, keepHand: true, hand: [""] },
  badlands: { lands: "twenty" },
  "an-token": { lands: 0, keepHand: true, tokens: ["eldrazi spawn"] },
  badzone: { hand: "Opt" },
  badside: { lands: 0, opponents: 5 },
  defaults: { hand: ["Opt"] },
  "twenty-mid": { lands: 20 },
  // (docs/planechase-dungeon-engine-spec.md D4: a dungeon and its room, dungeons already completed, the initiative)
  "dungeon-branch": { lands: 0, keepHand: true, dungeon: { name: "Lost Mine of Phandelver", room: "Goblin Lair" }, completedDungeons: ["Tomb of Annihilation"],
    opponents: { dungeon: { name: "Dungeon of the Mad Mage" } } },
  "initiative-steal": { lands: 0, keepHand: true, initiative: "White" },
  "initiative-mine": { lands: 0, keepHand: true, initiative: "you" },
  // (Planechase, spec P7: walk to a plane from a planar deck, make chaos happen; for a game with Planechase on)
  "planes-walk": { lands: 0, keepHand: true, planeswalk: "Interplanar Tunnel" },
  "planes-chaos": { lands: 0, keepHand: true, chaos: true },
  badplaneswalk: { lands: 0, planeswalk: ["Akoum"] },
  baddungeon: { lands: 0, dungeon: "Lost Mine of Phandelver" },
  badcompleted: { lands: 0, completedDungeons: "Tomb of Annihilation" },
  badinitiative: { lands: 0, initiative: "Purple" },
};
for (const [n, s] of Object.entries(SCEN)) fs.writeFileSync(path.join(DIR, `${n}.json`), JSON.stringify(s));
fs.writeFileSync(path.join(DIR, "broken.json"), "{ not json");
fs.writeFileSync(path.join(DIR, "nullfile.json"), "null");
process.env.MTG_SCENARIO_DIR = DIR;

const clone = (x) => JSON.parse(JSON.stringify(x));
const D2 = require("./golden/fixtures/dump2.json");
const myMain = () => { const b = clone(D2.board); Object.assign(b.gameView, { activePlayerId: "player-0", step: "main1", priorityPlayerId: "player-0", stack: [] }); return b; };
const prompt = (type, input = {}, id = 900) => ({ promptId: id, decidingPlayerId: "player-0", input: { type, ...input } });
const PASS = { actions: [{ id: "pass", type: "pass" }] };
const HAND = ["engine-card-43", "engine-card-35", "engine-card-75", "engine-card-77", "engine-card-97", "engine-card-94", "engine-card-74"];

// one seat (Blue) vs AI White, or two people (Blue and Red) vs AI White
function setup(h, { started = true, red = false, board = myMain() } = {}) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: clone(board), fingerprint: null };
  const seats = new Map([["Blue", seat]]);
  const slotColor = { "player-0": "Blue", "player-1": "White" };
  if (red) {
    const r = new h.B.Seat("Red", "neheb_minotaur_commander");
    r.slot = "player-2";
    const rb = clone(board);
    rb.gameView.players.push({ ...clone(rb.gameView.players[1]), id: "player-2" });
    r.board = { state: rb, fingerprint: null };
    seat.board.state.gameView.players.push({ ...clone(board.gameView.players[1]), id: "player-2" });
    seats.set("Red", r);
    slotColor["player-2"] = "Red";
  }
  h.B._setGame({ seats, bots: 1, total: red ? 3 : 2, playerOrder: [], slotNames: { "player-0": "Blue", "player-1": "AI 1", "player-2": "Red" }, slotColor,
    started, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  return seat;
}
// (a crash is a named failure, not the end of the run)
const say = async (h, color, scenario) => {
  try { h.B.onTTS({ t: "debug", json: JSON.stringify({ color, scenario }) }); } catch (e) { ok(`"mtg debug ${scenario}" doesn't crash`, false, e.message); }
  await h.flush();
};
const chats = (h) => h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const applies = (h) => h.effects.filter((e) => e.relay?.state?.directive?.type === "applyState").map((e) => e.relay.state.directive);
const responses = (h) => h.effects.map((e) => e.relay).filter((r) => r && r.state?.kind === "response").map((r) => r.state.action);
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };

(async () => {
  // the list, and what is refused
  await run(async (h) => {
    setup(h, { started: false });
    await say(h, "Blue", "");
    await say(h, "Blue", "list");
    await say(h, "Blue", "nosuch");
    await say(h, "Blue", "../plain");
    await say(h, "Blue", "broken");
    const c = chats(h);
    same("list: every scenario by name", c[0], "[MTG] Debug scenarios: an-token, badcompleted, baddungeon, badinitiative, badlands, badname, badplaneswalk, badside, badzone, bare, broken, defaults, dungeon-branch, initiative-mine, initiative-steal, nolands, nullfile, per-seat, plain, planes-chaos, planes-walk, setup, twenty-mid. Use  mtg debug <name>  (mtg debug off).");
    same("list: 'list' says the same", c[1], c[0]);
    ok("unknown: refused with the list", /^\[MTG\] No debug scenario "nosuch"\. Scenarios: an-token, badcompleted, baddungeon/.test(c[2]), c[2]);
    ok("a path is no name", /^\[MTG\] No debug scenario "\.\.\/plain"/.test(c[3]), c[3]);
    ok("a file that isn't JSON: refused, saying so", /^\[MTG\] Scenario "broken" can't be read: /.test(c[4]), c[4]);
    same("nothing sent to the engine", applies(h).length, 0);
  });

  // during a game vs AI, with a priority question open and nothing on the stack: applied at once
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [{ id: "pass", type: "pass" }] })); await h.flush();
    await say(h, "Blue", "plain");
    const a = applies(h);
    same("during a game: one applyState", a.length, 1);
    const ops = a[0]?.ops || [];
    same("20 lands in the commander's colours, B then R in turn", ops.map((o) => o.name), Array.from({ length: 20 }, (_, k) => (k % 2 ? "Mountain" : "Swamp")));
    ok("every land: createCard on Blue's battlefield", ops.every((o) => o.op === "createCard" && o.player === "player-0" && o.zone === "battlefield" && !("tapped" in o)), JSON.stringify(ops[0]));
    same("the change list is said in chat, counted", chats(h).find((t) => t.startsWith("[MTG] Debug")), '[MTG] Debug "plain": Blue gets Swamp (battlefield) ×10; Blue gets Mountain (battlefield) ×10.');
    same("the fix is applying", h.B._getGame().fix?.state, "applying");
    // the engine's answer
    const b = myMain(); b.gameView.stateFix = { fixId: a[0]?.fixId, applied: true };
    seat.board.state = b; h.B._getGame().lastTableSig = null; h.B.sendTable(); await h.flush();
    same("applied: the fix is over", h.B._getGame().fix, null);
    ok("applied: said as the debug setup", chats(h).includes('[MTG] Debug setup "plain" applied: Blue gets Swamp (battlefield) ×10; Blue gets Mountain (battlefield) ×10.'), JSON.stringify(chats(h).slice(-2)));
  });

  // every part of a scenario, for both sides
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    await say(h, "Blue", "setup");
    const ops = applies(h)[0]?.ops || [];
    same("setup: the whole list, in order", ops, [
      { op: "createCard", name: "Island", player: "player-0", zone: "battlefield" },
      { op: "createCard", name: "Island", player: "player-0", zone: "battlefield" },
      ...HAND.map((card) => ({ op: "move", card, zone: "library", position: "bottom" })),
      { op: "createCard", name: "Goblin Guide", player: "player-0", zone: "battlefield", tapped: true },
      { op: "createCard", name: "Opt", player: "player-0", zone: "hand" },
      { op: "createCard", name: "Lightning Bolt", player: "player-0", zone: "hand" },
      { op: "createCard", name: "Brainstorm", player: "player-0", zone: "library" },
      { op: "createCard", name: "Grizzly Bears", player: "player-0", zone: "graveyard" },
      { op: "createCard", name: "Llanowar Elves", player: "player-0", zone: "exile" },
      { op: "createCard", name: "c_a_treasure_sac", player: "player-0", zone: "battlefield" },
      { op: "life", player: "player-0", n: 7 },
      { op: "mana", player: "player-0", mana: "W W U U B B R R G G C C" },
      // (the AI has no commander on this board: its one land is Wastes)
      { op: "createCard", name: "Wastes", player: "player-1", zone: "battlefield" },
      { op: "createCard", name: "Llanowar Elves", player: "player-1", zone: "battlefield" },
      { op: "createCard", name: "Shock", player: "player-1", zone: "hand" },
      { op: "life", player: "player-1", n: 3 },
    ]);
    const lines = h.B._getGame().fix?.lines || [];
    ok("setup: the dealt hand said once, counted", lines.includes("Blue's dealt hand: to the bottom of the library ×7"), JSON.stringify(lines));
    ok("setup: a token by what the file says, not its script", lines.includes("Blue gets a treasure token") && !lines.some((l) => l.includes("c_a_treasure_sac")), JSON.stringify(lines));
  });

  // no lands named and no keepHand, during a game: no lands and the hand kept (live check 2026-11-11: a mid-game
  // "mtg debug" bottomed the hand and added 20 lands, the defaults for a game's start)
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    await say(h, "Blue", "defaults");
    same("during a game: no lands, the hand kept, only the scenario's cards", applies(h)[0]?.ops, [{ op: "createCard", name: "Opt", player: "player-0", zone: "hand" }]);
  });
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    await say(h, "Blue", "twenty-mid");
    const ops = applies(h)[0]?.ops || [];
    same("during a game: lands the file names still come, the hand kept", [ops.length, ops.filter((o) => o.op === "createCard" && o.zone === "battlefield").length], [20, 20]);
  });
  // a dungeon in a room, a dungeon with no room yet, dungeons already completed, and the initiative (spec D4)
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    await say(h, "Blue", "dungeon-branch");
    same("dungeon: the dungeon in its room, the completed one, the opponent's dungeon with no room", applies(h)[0]?.ops, [
      { op: "dungeon", player: "player-0", name: "Lost Mine of Phandelver", room: "Goblin Lair" },
      { op: "completedDungeon", player: "player-0", name: "Tomb of Annihilation" },
      { op: "dungeon", player: "player-1", name: "Dungeon of the Mad Mage" },
    ]);
    same("dungeon: said in chat", chats(h).find((t) => t.startsWith("[MTG] Debug")),
      '[MTG] Debug "dungeon-branch": Blue is in Lost Mine of Phandelver, room Goblin Lair; Blue has completed Tomb of Annihilation; AI 1 is in Dungeon of the Mad Mage, no room yet.');
  });
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    await say(h, "Blue", "initiative-steal");
    same("initiative: a colour takes it", applies(h)[0]?.ops, [{ op: "initiative", player: "player-1" }]);
    same("initiative: said in chat", chats(h).find((t) => t.startsWith("[MTG] Debug")), '[MTG] Debug "initiative-steal": AI 1 takes the initiative.');
  });
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    await say(h, "Blue", "initiative-mine");
    same("initiative: \"you\" is the caller", applies(h)[0]?.ops, [{ op: "initiative", player: "player-0" }]);
  });
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    await say(h, "Blue", "planes-walk");
    await say(h, "Blue", "planes-chaos");
    same("planes: a planeswalk, then chaos, as the caller", applies(h).map((a) => a.ops), [[{ op: "planeswalk", player: "player-0", name: "Interplanar Tunnel" }]]);
    same("planes: said in chat", chats(h).filter((t) => t.startsWith("[MTG] Debug")).slice(0, 1), ['[MTG] Debug "planes-walk": Blue planeswalks to Interplanar Tunnel.']);
  });
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    await say(h, "Blue", "planes-chaos");
    same("planes: chaos for the caller", applies(h)[0]?.ops, [{ op: "chaos", player: "player-0" }]);
    same("planes: chaos said", chats(h).find((t) => t.startsWith("[MTG] Debug")), '[MTG] Debug "planes-chaos": Chaos ensues for Blue.');
  });
  // before a game: 20 lands for the caller and the dealt hand to the bottom, as before
  await run(async (h) => {
    setup(h, { started: false });
    await say(h, "Blue", "defaults");
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [] }, 903)); await h.flush();
    const ops = applies(h)[0]?.ops || [];
    same("before a game: 20 lands, the dealt hand to the bottom, then the scenario's cards",
      [ops.filter((o) => o.op === "createCard" && o.zone === "battlefield").length, ops.filter((o) => o.op === "move").map((o) => o.card), ops.at(-1)],
      [20, HAND, { op: "createCard", name: "Opt", player: "player-0", zone: "hand" }]);
  });
  // a truthy keepHand keeps the hand
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    await say(h, "Blue", "bare");
    same("keepHand 1 during a game: nothing at all to do", applies(h)[0]?.ops, undefined);
  });

  // a colour's own part goes before "opponents"
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    await say(h, "Blue", "per-seat");
    same("per seat: White's part, not the opponents'", applies(h)[0]?.ops, [{ op: "life", player: "player-1", n: 9 }]);
  });

  // the next game: the hand is kept by itself, and the first priority with nothing on the stack sets it up
  await run(async (h) => {
    setup(h, { started: false });
    await say(h, "Blue", "nolands");
    ok("before a game: waits for the next one", /^\[MTG\] Debug "nolands" is set up at your first priority on your own turn in the next game/.test(chats(h).at(-1)), chats(h).at(-1));
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("mulligan", { mulliganCount: 0 }, 901)); await h.flush();
    same("the opening hand is kept, nothing asked", responses(h), [{ type: "mulligan", output: { type: "mulliganDecision", keep: true } }]);
    same("no question open on the table", seat.prompt ? seat.prompt.type : null, null);
    const stacked = myMain(); stacked.gameView.stack = [{ id: "s1", controllerId: "player-1", identity: { name: "Shock" } }];
    const theirs = myMain(); theirs.gameView.activePlayerId = "player-1";
    seat.board.state = theirs;
    h.B.onPrompt(seat, prompt("chooseAction", PASS, 905)); await h.flush();
    same("the AI's turn: not yet, no fix opened", [applies(h).length, h.B._getGame().fix], [0, null]);
    seat.board.state = stacked;
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [] }, 902)); await h.flush();
    same("a spell on the stack: not yet, no fix opened", [applies(h).length, h.B._getGame().fix], [0, null]);
    seat.board.state = myMain();
    h.B.onPrompt(seat, prompt("chooseAction", { actions: [] }, 903)); await h.flush();
    same("first empty-stack priority: set up", applies(h).map((a) => a.ops), [[{ op: "createCard", name: "Opt", player: "player-0", zone: "hand" }]]);
    const b = myMain(); b.gameView.stateFix = { fixId: applies(h)[0]?.fixId, applied: true };
    seat.board.state = b; h.B._getGame().lastTableSig = null; h.B.sendTable(); await h.flush();
    // (the next game is a plain one again)
    const n = responses(h).length;
    h.B.onPrompt(seat, prompt("mulligan", { mulliganCount: 0 }, 904)); await h.flush();
    same("once only: the next mulligan is asked", [responses(h).length - n, seat.prompt?.type], [0, "mulligan"]);
  });

  await run(async (h) => {
    setup(h, { started: false });
    await say(h, "Blue", "nolands");
    await say(h, "Blue", "off");
    same("off: said", chats(h).at(-1), "[MTG] Debug setup off.");
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("mulligan", { mulliganCount: 0 }, 901)); await h.flush();
    same("off: the mulligan is asked again", [responses(h).length, seat.prompt?.type], [0, "mulligan"]);
  });

  // another person at the table: asked to pause, then to apply the list
  await run(async (h) => {
    const seat = setup(h, { red: true });
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    await say(h, "Blue", "nolands");
    const g = h.B._getGame();
    same("two people: the pause is voted on", [g.fix?.state, g.fix?.waiting], ["voting", ["Red"]]);
    h.B.onTTS({ t: "fix", json: JSON.stringify({ color: "Red", action: "vote", accept: true }) }); await h.flush();
    same("then the list is", [g.fix?.state, g.fix?.waiting, g.fix?.lines], ["review", ["Red"], ["Blue gets Opt (hand)"]]);
    same("nothing applied before the second yes", applies(h).length, 0);
    h.B.onTTS({ t: "fix", json: JSON.stringify({ color: "Red", action: "vote", accept: true }) }); await h.flush();
    same("after it: applied", applies(h).map((a) => a.ops.length), [1]);
  });

  // what the engine can't take is refused here; one already under way is not replaced
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    await say(h, "Blue", "badname");
    same("an empty card name: refused, no fix left open", [chats(h).at(-1), h.B._getGame().fix, applies(h).length], ['[MTG] Debug "badname": No card name "".', null, 0]);
    h.B.onTTS({ t: "fix", json: JSON.stringify({ color: "Blue", action: "call" }) }); await h.flush();
    await say(h, "Blue", "nolands");
    same("a fix under way: refused", chats(h).at(-1), "[MTG] A manual fix is already under way.");
  });

  // the manual fix itself takes the new op (the table's "Done" list)
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    h.B.onTTS({ t: "fix", json: JSON.stringify({ color: "Blue", action: "call" }) }); await h.flush();
    h.B.onTTS({ t: "fix", json: JSON.stringify({ color: "Blue", action: "done", ops: [{ op: "createCard", name: "Opt", player: "White", zone: "graveyard" }, { op: "createCard", name: "Opt", player: "Blue", zone: "nowhere" }] }) }); await h.flush();
    same("manual fix: a bad zone is refused", chats(h).at(-1), "[MTG] No zone nowhere.");
    h.B.onTTS({ t: "fix", json: JSON.stringify({ color: "Blue", action: "done", ops: [{ op: "createCard", name: "Opt", player: "White", zone: "graveyard", tapped: false, extra: 1, shown: "nothing to see" }] }) }); await h.flush();
    ok("manual fix: the table's list never words itself", h.B._getGame().fix?.lines?.[0] === "AI 1 gets Opt (graveyard)", JSON.stringify(h.B._getGame().fix?.lines));
    same("manual fix: createCard goes as the engine reads it", applies(h).map((a) => a.ops), [[{ op: "createCard", name: "Opt", player: "player-1", zone: "graveyard", tapped: false }]]);
  });

  // a scenario of the wrong shape: refused when typed, never half set up (a "null" file left the fix stuck at pausing)
  await run(async (h) => {
    setup(h, { started: false });
    for (const n of ["nullfile", "badlands", "badzone", "badside", "baddungeon", "badcompleted", "badinitiative", "badplaneswalk"]) await say(h, "Blue", n);
    same("wrong shapes: refused when typed, saying what", chats(h), [
      '[MTG] Scenario "nullfile": it must be one { ... } object.',
      '[MTG] Scenario "badlands": "lands" must be a number, a list of names, or counts by name.',
      '[MTG] Scenario "badzone": "hand" must be a list.',
      '[MTG] Scenario "badside": "opponents" must be a { ... } object.',
      '[MTG] Scenario "baddungeon": "dungeon" must be { "name": ..., "room": ... }.',
      '[MTG] Scenario "badcompleted": "completedDungeons" must be a list.',
      '[MTG] Scenario "badinitiative": "initiative" must be "you" or a colour.',
      '[MTG] Scenario "badplaneswalk": "planeswalk" must be the name of a plane.']);
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("mulligan", { mulliganCount: 0 }, 901)); await h.flush();
    same("wrong shapes: nothing waits for the next game", [responses(h).length, seat.prompt?.type], [0, "mulligan"]);
  });

  // a debug setup the engine refuses goes back to editing as an ordinary fix: what applies then is the table's list
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    await say(h, "Blue", "nolands");
    const g = h.B._getGame();
    const b = myMain(); b.gameView.stateFix = { fixId: applies(h)[0]?.fixId, applied: false, message: "no card named Opt" };
    seat.board.state = b; g.lastTableSig = null; h.B.sendTable(); await h.flush();
    same("refused: back to editing, no longer a debug setup", [g.fix?.state, g.fix?.debug ?? null], ["editing", null]);
    h.B.onTTS({ t: "fix", json: JSON.stringify({ color: "Blue", action: "done", ops: [{ op: "life", player: "Blue", n: 30 }] }) }); await h.flush();
    const b2 = myMain(); b2.gameView.stateFix = { fixId: applies(h)[1]?.fixId, applied: true };
    seat.board.state = b2; g.lastTableSig = null; h.B.sendTable(); await h.flush();
    same("then applied: said as a manual fix", chats(h).at(-1), "[MTG] Manual fix applied: Blue life → 30.");
  });

  // a debug setup waiting for a player who isn't in the next game is dropped then, not kept for a later one
  await run(async (h) => {
    h.B._setGame(null);
    h.B.onTTS({ t: "debug", json: JSON.stringify({ color: "Red", scenario: "nolands" }) }); await h.flush();
    h.B.onTTS({ t: "debug", json: JSON.stringify({ color: "Blue", scenario: "nolands" }) }); await h.flush();
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 1, fromTable: true }) }); await h.flush();
    ok("not seated: dropped, said", chats(h).includes(`[MTG] Debug "nolands" dropped: Red isn't in this game.`), JSON.stringify(chats(h)));
    ok("seated: kept, nothing said", !chats(h).some((c) => c.includes("dropped: Blue")), JSON.stringify(chats(h)));
    const blue = h.B._getGame()?.seats.get("Blue");
    blue.slot = "player-0"; blue.board = { state: myMain(), fingerprint: null };
    h.B.onPrompt(blue, prompt("mulligan", { mulliganCount: 0 }, 901)); await h.flush();
    same("seated: its opening hand is kept by itself", responses(h).length, 1);
    h.B._setGame(null);
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Red"], bots: 1, fromTable: true }) }); await h.flush();
    const r = h.B._getGame()?.seats.get("Red");
    r.slot = "player-0"; r.board = { state: myMain(), fingerprint: null };
    h.B.onPrompt(r, prompt("mulligan", { mulliganCount: 0 }, 901)); await h.flush();
    same("not seated: the game after asks the mulligan as usual", [responses(h).length, r.prompt?.type], [1, "mulligan"]);
  });

  // who may set one up during a game: as for the manual fix
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    seat.board.state.gameView.restoreVote = { status: { type: "pending" } };
    await say(h, "Blue", "nolands");
    seat.board.state.gameView.restoreVote = null;
    seat.board.state.gameView.gameOver = true;
    await say(h, "Blue", "nolands");
    seat.board.state.gameView.gameOver = false;
    seat.board.state.gameView.players.find((p) => p.id === "player-0").status = "lost";
    await say(h, "Blue", "nolands");
    same("refused: a rewind vote open, the game over, a player out", chats(h).slice(-3),
      ["[MTG] Finish the rewind vote first.", "[MTG] The game is over.", "[MTG] Players who are out can't change the game."]);
    same("refused: nothing opened or applied", [h.B._getGame().fix, applies(h).length], [null, 0]);
  });

  // a token said as the file says it, with its article
  await run(async (h) => {
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    await say(h, "Blue", "an-token");
    ok("a token starting with a vowel: \"an\"", chats(h).some((c) => c.includes("Blue gets an eldrazi spawn token")), JSON.stringify(chats(h)));
  });

  fs.rmSync(DIR, { recursive: true, force: true });
  process.stdout.write(failed ? `FAILED: ${passed} passed, ${failed} failed\n` : `PASSED: ${passed} passed, 0 failed\n`);
  process.exit(failed ? 1 : 0);
})();
