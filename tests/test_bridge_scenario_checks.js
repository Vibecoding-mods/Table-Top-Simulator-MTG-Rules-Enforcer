// The debug scenarios for live check 1's two unreached features, checked headlessly (scenarios/hand-overflow.json,
// repeat-yesno.json, repeat-yesno-pay.json). tools/check-scenarios.js played each on the real engine (a two-player
// Commander game, ManaBrewEngineAdapter, Blue against one Forge AI) with the sandboxed bridge in the loop: "mtg debug
// <name>" typed to the bridge, the bridge's own applyState applied by the engine, then the scenario's spell cast and
// every question after it answered through the bridge (a click on the table where the bridge shows one). Its recording
// (tests/golden/fixtures/scenario-checks.json) is replayed here through the same sandboxed bridge (tests/bridge-harness.js)
// and, for the hand, the table's own hand code on fengari (tools/engine-renderer.lua engineHandPlace, TTS stood in for):
//  - each scenario file is the one recorded, and the bridge still makes the same changes from it;
//  - hand-overflow: the engine's board after the setup has 45 cards in Blue's hand; the bridge sends all 45 with the
//    count; the table places 40 in the hand zone and one "+5 more in hand" card (its hover: 45 cards);
//  - repeat-yesno: the engine put three Soul's Attendant triggers on the stack; the first ask shows Yes, No, "No ×3",
//    "Yes ×3" and "How many…"; after "No ×3" the bridge answers the other two No itself, unseen, and passes the
//    priorities between; one chat line; Blue's life unchanged on the engine's last board, the stack empty;
//  - repeat-yesno-pay: Smothering Tithe's "Pay {2}?" three times on the stack; "Don't pay ×3" and "How many…", no
//    "Pay {2} ×3"; the same run.
// To record again (an engine tree with its harness jar): node tools/check-scenarios.js <tree>
//   node tests/test_bridge_scenario_checks.js
const fs = require("fs");
const path = require("path");
const harness = require("./bridge-harness");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

const ROOT = path.join(__dirname, "..");
const REC = require("./golden/fixtures/scenario-checks.json");
const SRC = fs.readFileSync(path.join(ROOT, "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
process.env.MTG_SCENARIO_DIR = path.join(ROOT, "scenarios");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const handOf = (gv) => (gv.zones || []).find((z) => z.zone === "hand" && z.ownerId === "player-0") || { cards: [], count: 0 };

// (t2: the Two-Headed Giant table of tools/check-scenarios.js: White, the host, and Red against Yellow and Blue)
const T2GAME = { playerOrder: ["White", "Red", "Yellow", "Blue"], bots: 3, total: 4,
  slotNames: { "player-0": "White", "player-1": "AI 1", "player-2": "AI 2", "player-3": "AI 3" }, slotColor: { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" },
  teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 }, teamMode: "2hg", teamTurns: "shared" };
// (arch4: an Archenemy game on four seats, White the archenemy, as tools/check-scenarios.js plays it)
const A4GAME = { ...T2GAME, teams: { White: 1, Red: 2, Yellow: 2, Blue: 2 }, teamMode: "archenemy", teamTurns: null, arch: { color: "White" } };
let HOST = "Blue";
function bridge(h, t2 = false) {
  HOST = t2 ? "White" : "Blue";
  const seat = new h.B.Seat(HOST, "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.heartbeat = () => {};
  h.B._setGame({ seats: new Map([[HOST, seat]]), bots: 1, total: 2, playerOrder: ["Blue", "AI"], slotNames: { "player-0": "Blue", "player-1": "AI 1" },
    slotColor: { "player-0": "Blue", "player-1": "White" }, ...(t2 === "arch4" ? A4GAME : t2 ? T2GAME : {}), started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  return seat;
}
// one recorded question into the bridge: what it shows Blue and what it answers by itself
async function ask(h, seat, step) {
  seat.board = { state: JSON.parse(JSON.stringify(step.board)), fingerprint: null };
  const n0 = h.effects.length;
  h.B.onPrompt(seat, JSON.parse(JSON.stringify(step.prompt))); await h.flush();
  const shownMsg = h.effects.slice(n0).filter((e) => e.tts?.t === "prompt" && e.tts.color === HOST && e.tts.promptId != null).map((e) => e.tts).pop() || null;
  const sent = h.effects.slice(n0).map((e) => e.relay?.state).filter((x) => x?.kind === "response" && x.promptId === step.prompt.promptId).map((x) => x.action).pop() || null;
  const chats = h.effects.slice(n0).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
  return { shown: shownMsg ? { title: shownMsg.title, options: (shownMsg.options || []).map((o) => o.label) } : null, ids: (shownMsg?.options || []).map((o) => o.id), sent, msg: shownMsg, chats };
}

// the table's hand code (engineHandPlace) on fengari: what it places for a hand of n cards
const fn = (name) => { const a = SRC.indexOf(`\nfunction ${name}(`); const b = SRC.indexOf("\nend\n", a); if (a < 0 || b < 0) throw new Error(`${name} is gone`); return SRC.slice(a, b + 5); };
const line = (start) => { const a = SRC.indexOf(start); if (a < 0) throw new Error(`"${start}" is gone`); return SRC.slice(a, SRC.indexOf("\n", a) + 1); };
function tableHand(hand) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const stubs = `
local vmt = {}
vmt.__add = function(a, b) return Vector(a.x + b.x, a.y + b.y, a.z + b.z) end
vmt.__mul = function(a, k) if type(a) == "number" then a, k = k, a end return Vector(a.x * k, a.y * k, a.z * k) end
function Vector(x, y, z) return setmetatable({ x = x, y = y, z = z }, vmt) end
function onTable(p, h) return p end
function heldIn(list, id) return false end
ENGINE_BACK = "https://back"
engineObjs, engineSpawning, lastTable = {}, {}, nil
Wait = { frames = function(f, n) end }
placed = {}
function place(c, pos, rot, seen, hand, meta) seen[c.id] = true placed[#placed + 1] = { id = c.id, n = c.n, tl = c.tl, zone = meta.zone } end
HAND = {}
`;
  const code = `${stubs}\n${line("ENGINE_HAND_SHOW = ")}${line("ENGINE_HAND_SPAWNS = ")}${line("engineHandRedrawDue = ")}${fn("engineHandPlace")}`;
  if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(L, -1));
  const ids = hand.map((c) => `{ id = ${JSON.stringify(String(c.id))}, n = ${JSON.stringify(String(c.n || ""))} }`).join(", ");
  // (a big hand spawns ENGINE_HAND_SPAWNS cards a frame, the rest on the frames after: frames are run until no new card
  // is placed, each frame's cards then on the table, engineObjs)
  const run = `HAND = { ${ids} } engineObjs = {}
    local g = { handPos = Vector(0, 1, -20), lib = Vector(10, 1, -18), right = Vector(1, 0, 0), rotY = 180 }
    local folded, inHand, more = 0, {}, ""
    for frame = 1, 20 do
      placed = {}
      folded = engineHandPlace("Blue", g, HAND, nil, {})
      for _, p in ipairs(placed) do
        if p.zone == "hand" then inHand[p.id] = true engineObjs[p.id] = true elseif p.zone == "handmore" then more = p.n .. "|" .. p.tl end
      end
    end
    local n = 0
    for _ in pairs(inHand) do n = n + 1 end
    return folded .. "|" .. n .. "|" .. more`;
  if (lauxlib.luaL_loadstring(L, to_luastring(run)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(L, -1));
  return lua.lua_tojsstring(L, -1);
}

async function scenario(name, check, t2 = false) {
  const r = REC[name];
  if (!r) return ok(`${name}: recorded (tools/check-scenarios.js)`, false, "not in scenario-checks.json");
  same(`${name}: the scenario file is the one recorded`, JSON.parse(fs.readFileSync(path.join(ROOT, "scenarios", `${name}.json`), "utf8")), r.scenarioFile);
  same(`${name}: the engine game had no problems`, r.problems, []);
  const h = harness.load();
  try {
    const seat = bridge(h, t2);
    const setup = r.steps.find((s) => s.kind === "setup");
    await ask(h, seat, setup);
    const n0 = h.effects.length;
    h.B.onTTS({ t: "debug", json: JSON.stringify({ color: HOST, scenario: name }) }); await h.flush();
    const d = h.effects.slice(n0).map((e) => e.relay?.state?.directive).find((x) => x?.type === "applyState");
    same(`${name}: the bridge still makes the recorded changes from it`, d?.ops, r.ops);
    const applied = r.steps.find((s) => s.kind === "applied")?.board.gameView;
    ok(`${name}: the engine applied it`, applied?.stateFix?.applied === true, JSON.stringify(applied?.stateFix));
    await check(r, h, seat, applied);
  } finally { harness.restore(); }
}
// the table message the bridge sends for board gv (the first one with the seat's zones), and its cards' statics
async function tableOf(h, seat, gv) {
  seat.board = { state: { gameView: JSON.parse(JSON.stringify(gv)) }, fingerprint: null };
  const n0 = h.effects.length;
  h.B.sendTable(); await h.flush(200000);
  const msgs = h.effects.slice(n0).filter((e) => e.tts?.t === "table" || e.tts?.t === "texts").map((e) => e.tts);
  const t = msgs.find((m) => m.t === "table") || null;
  return { t, me: t?.players.find((p) => p.slot === "player-0") || null, stat: Object.assign({}, ...msgs.map((m) => m.cards || {})), log: h.effects.slice(n0).filter((e) => e.tts?.t === "gamelog").flatMap((e) => e.tts.lines || []) };
}
const bfOf = (gv, slot = "player-0") => ((gv.zones || []).find((z) => z.zone === "battlefield" && z.ownerId === slot) || {}).cards || [];
// the recorded questions after the cast, replayed: the bridge must show and answer each as recorded
async function replay(name, r, h, seat) {
  const out = [];
  for (const st of r.steps.filter((s) => s.kind === "bridge")) {
    if (!st.board) { out.push({ st, shown: st.shown, sent: st.sent, msg: null, chats: [] }); continue; } // (a key recording's step without its board: as recorded)
    const got = await ask(h, seat, st);
    let sent = got.sent;
    if (st.click) {
      const n1 = h.effects.length;
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: HOST, promptId: st.prompt.promptId, choice: [st.click] }) }); await h.flush();
      sent = h.effects.slice(n1).map((e) => e.relay?.state).filter((x) => x?.kind === "response" && x.promptId === st.prompt.promptId).map((x) => x.action).pop() || null;
    }
    out.push({ st, shown: got.shown, sent, msg: got.msg, chats: got.chats });
  }
  const differ = out.filter((x) => JSON.stringify(x.sent || null) !== JSON.stringify(x.st.sent || null) || JSON.stringify(x.shown) !== JSON.stringify(x.st.shown));
  ok(`${name}: the bridge shows and answers every question as recorded`, !differ.length, differ.slice(0, 2).map((x) => `${x.st.prompt.input?.type}: shown ${JSON.stringify(x.shown)} sent ${JSON.stringify(x.sent)}, recorded ${JSON.stringify(x.st.shown)} ${JSON.stringify(x.st.sent)}`).join(" | "));
  return out;
}

(async () => {
  await scenario("hand-overflow", async (r, h, seat, applied) => {
    same("hand-overflow: the engine's board after the setup: 45 cards in Blue's hand", [handOf(applied).count, handOf(applied).cards.length], [45, 45]);
    seat.board = { state: { gameView: applied }, fingerprint: null };
    const n0 = h.effects.length;
    h.B.sendTable(); await h.flush();
    const me = h.effects.slice(n0).filter((e) => e.tts?.t === "table").map((e) => e.tts.players.find((p) => p.color === "Blue")).find((p) => p?.hand);
    same("hand-overflow: the bridge sends the table all 45, and the count", [me?.hand?.length, me?.handCount], [45, 45]);
    same("hand-overflow: the table places 40 in the hand zone and one \"+5 more in hand\" card for the rest", tableHand(me?.hand || []), "5|40|+5 more in hand|Blue's hand (45 cards)");
  });
  await scenario("repeat-yesno", async (r, h, seat) => {
    const out = await replay("repeat-yesno", r, h, seat);
    const asks = out.filter((x) => x.st.prompt.input?.type === "chooseBoolean");
    const stackAt = asks[0]?.st.board.gameView.stack || [];
    same("repeat-yesno: the engine had three Soul's Attendant triggers on the stack at the first ask", stackAt.filter((s) => /Soul's Attendant/.test(s.identity?.name || s.name || "") || /Soul's Attendant/.test(s.text || "")).length, 3);
    same("repeat-yesno: the first ask offers Yes, No, No ×3, Yes ×3 and How many…", asks[0]?.shown?.options, ["Yes", "No", "No ×3", "Yes ×3", "How many…"]);
    same("repeat-yesno: Blue clicks No ×3 once; the other two asks are answered No by the bridge, unseen", asks.map((x) => [x.st.click || null, x.shown ? "shown" : "unseen", x.sent?.output?.value]), [["__repeat:no", "shown", false], [null, "unseen", false], [null, "unseen", false]]);
    ok("repeat-yesno: one chat line says it", (r.chatsAfter || []).length === 1 && /You answered No to Soul's Attendant's .* 3 times\./.test(r.chatsAfter[0]), JSON.stringify(r.chatsAfter));
    const last = r.steps.filter((s) => s.board).at(-1).board.gameView;
    const life = (gv) => gv.players.find((p) => p.id === "player-0").life;
    same("repeat-yesno: on the engine's last board the stack is empty and Blue gained no life", [(last.stack || []).length, life(last)], [0, life(r.steps.find((s) => s.kind === "applied").board.gameView)]);
  });
  await scenario("repeat-yesno-pay", async (r, h, seat) => {
    const out = await replay("repeat-yesno-pay", r, h, seat);
    const asks = out.filter((x) => x.st.prompt.input?.type === "chooseBoolean");
    same("repeat-yesno-pay: the engine had three Smothering Tithe triggers on the stack at the first ask", (asks[0]?.st.board.gameView.stack || []).filter((s) => /Smothering Tithe/.test(s.identity?.name || s.name || "")).length, 3);
    same("repeat-yesno-pay: the first ask offers Pay {2}, Don't pay, Don't pay ×3 and How many… (no Pay ×3: Yes asks the payment)", asks[0]?.shown?.options, ["Pay {2}", "Don't pay", "Don't pay ×3", "How many…"]);
    same("repeat-yesno-pay: the other two are answered No by the bridge, unseen", asks.map((x) => [x.shown ? "shown" : "unseen", x.sent?.output?.value]), [["shown", false], ["unseen", false], ["unseen", false]]);
    ok("repeat-yesno-pay: one chat line says it", (r.chatsAfter || []).length === 1 && /You answered No to Smothering Tithe's "Pay \{2\}\?" 3 times\./.test(r.chatsAfter[0]), JSON.stringify(r.chatsAfter));
  });
  // the 2HG team block panel on the first AI team turn (scenarios/team-block-live.json): Two-Headed Giant at level 2,
  // White (the host) and Red (AI) at 8 life with three Walls of Wood, Yellow and Blue (AI) with four Craw Wurms
  await scenario("team-block-live", async (r, h, seat, applied) => {
    same("team-block-live: the setup: White's team at 8, three Walls of Wood for White and Red, four Craw Wurms for Yellow and Blue",
      [applied.players.map((p) => p.life), ["player-0", "player-1", "player-2", "player-3"].map((id) => ((applied.zones.find((z) => z.zone === "battlefield" && z.ownerId === id) || {}).cards || []).filter((c) => /^(Wall of Wood|Craw Wurm)$/.test(c.identity?.name)).map((c) => `${c.identity.name}${c.tapped ? " (tapped)" : ""}`))],
      [[8, 8, 80, 80], [["Wall of Wood"], ["Wall of Wood", "Wall of Wood"], ["Craw Wurm", "Craw Wurm"], ["Craw Wurm", "Craw Wurm"]]]);
    const out = await replay("team-block-live", r, h, seat);
    const blocks = out.filter((x) => x.st.prompt.input?.type === "chooseBlockers");
    const first = blocks[0];
    const gv = first?.st.board.gameView;
    const atk = first?.st.prompt.input?.attackers || [];
    same("team-block-live: the AI team declares an attack on White's team on its first turn (turn 2, Yellow's team): all four Wurms, at White or Red",
      [gv?.turn, gv?.activePlayerId, atk.length, atk.every((a) => { const c = gv.zones.flatMap((z) => z.cards || []).find((x) => x.id === a.attackerId); return c?.isAttacking === true && ["player-0", "player-1"].includes(c.attackTargetId); })],
      [2, "player-2", 4, true]);
    same("team-block-live: the block panel: \"Block with Red\", Agree first, the round told to the table", [first?.shown?.title, first?.shown?.options[0], first?.msg?.joint], ["Block with Red", "Agree", 0]);
    ok("team-block-live: the panel shows the team's block, one line per attacker", /The team's block:/.test(first?.msg?.text || "") && (first?.msg?.text.match(/Craw Wurm/g) || []).length >= 4, first?.msg?.text);
    same("team-block-live: Red's changes printed as chat lines, never asked", out.filter((x) => x.st.prompt.input?.type === "revealCards").map((x) => [x.shown ? "shown" : "printed", x.sent?.output?.type, x.chats.filter((c) => / now blocks /.test(c)).length]),
      [["printed", "revealCardsAcknowledged", 1], ["printed", "revealCardsAcknowledged", 1]]);
    same("team-block-live: White asked again after Red's change, the revise round naming Red", [blocks[1]?.shown?.title, blocks[1]?.shown?.options[0], blocks[1]?.msg?.joint], ["Red changed the blocks. Agree or change?", "Agree", 1]);
    same("team-block-live: White's Agree sends the team's blocks back as they were", blocks.map((x) => JSON.stringify(x.sent?.output?.assignments)), blocks.map((x) => JSON.stringify(x.st.prompt.input.currentAssignments || [])));
  }, true);
  // ── scenarios/LIVE-CHECKS.md: one scenario per live check ──
  // (a) rewind: the board changes on each of Blue's turns, and the engine's restore points reach the table's Undo
  await scenario("live-rewind", async (r, h, seat) => {
    const turns = [];
    for (const st of r.steps.filter((x) => x.board)) {
      const gv = st.board.gameView;
      if (gv.activePlayerId !== "player-0" || turns.some((t) => t.turn === gv.turn)) continue;
      const bf = bfOf(gv);
      turns.push({ turn: gv.turn, life: gv.players[0].life, faeries: bf.filter((c) => /^Faerie Rogue/.test(c.identity?.name || "")).length, counters: bf.reduce((n, c) => n + ((c.counters || {}).P1P1 || 0), 0) });
    }
    same("live-rewind: Blue's turns 2, 4, 6 and 8 seen", turns.map((t) => t.turn), [2, 4, 6, 8]);
    ok("live-rewind: each of Blue's turns changes the board: life down, a Faerie more, a +1/+1 counter more", turns.slice(2).every((t, i) => t.life < turns[i + 1].life && t.faeries > turns[i + 1].faeries && t.counters > turns[i + 1].counters), JSON.stringify(turns));
    const end = r.steps.filter((x) => x.board).at(-1).board.gameView;
    ok("live-rewind: the engine recorded restore points, past the first turns", (end.checkpoints || []).length >= 20, (end.checkpoints || []).length);
    const { t } = await tableOf(h, seat, end);
    const pts = t?.rewind?.points || [];
    ok("live-rewind: the table's Undo lists them, the newest first, named by turn and step", pts.length >= 8 && /^turn \d+, (Blue|AI 1)'s /.test(pts[0]?.label || "") && pts.some((x) => /^turn \d+, Blue's /.test(x.label)), JSON.stringify(pts.map((x) => x.label)));
  });
  // (b) Archenemy on four seats: White the archenemy, a scheme set in motion on turn 1
  await scenario("live-archenemy", async (r, h, seat, applied) => {
    const w = applied.players.find((p) => p.id === "player-0");
    same("live-archenemy: White the archenemy at 80, the others at 40, the scheme deck 20", [w.isArchenemy, applied.players.map((p) => p.life), w.schemeDeckCount], [true, [80, 40, 40, 40], 20]);
    const ev = (applied.events || []).find((e) => e.how === "setInMotion");
    ok("live-archenemy: the engine set a scheme in motion on turn 1, at White's first main phase", ev && applied.turn === 1, JSON.stringify(ev));
    const sb = (r.schemeBoards || [])[0]?.gameView;
    const { t, stat } = await tableOf(h, seat, sb || applied);
    ok("live-archenemy: the table gets it as the scheme set in motion (schemeNow, seq 1), the scheme the engine set in motion", t?.schemeNow?.seq === 1 && t.schemeNow.card?.id === ev?.cardId, JSON.stringify(t?.schemeNow).slice(0, 200));
    ok("live-archenemy: the table's teams name White the archenemy", t?.teams?.archenemy === "White", JSON.stringify(t?.teams));
    ok("live-archenemy: White's row says archenemy, with the scheme deck", t?.players.find((p) => p.color === "White")?.arch === true && typeof t.players.find((p) => p.color === "White").schemeDeck === "number");
    void stat;
  }, "arch4");
  // (c) art and effects: a double-faced card on the battlefield and in hand, a Treasure, and Raise the Alarm's two tokens
  await scenario("live-art", async (r, h, seat, applied) => {
    const dfc = applied.zones.flatMap((z) => (z.ownerId === "player-0" ? z.cards || [] : [])).filter((c) => c.isDoubleFaced).map((c) => c.identity.name).sort();
    same("live-art: two double-faced cards, Huntmaster of the Fells on the battlefield and Delver of Secrets in hand", dfc, ["Delver of Secrets", "Huntmaster of the Fells"]);
    const a = await tableOf(h, seat, applied);
    ok("live-art: the Treasure goes to the table as a token", (a.me?.battlefield || []).some((c) => a.stat[c.id]?.n === "Treasure Token" && a.stat[c.id]?.tok), JSON.stringify((a.me?.battlefield || []).map((c) => a.stat[c.id]?.n)));
    const end = r.steps.filter((x) => x.board).at(-1).board.gameView;
    same("live-art: Raise the Alarm resolved on the engine: two Soldier tokens", bfOf(end).filter((c) => c.identity?.isToken && /^Soldier/.test(c.identity.name)).length, 2);
    const e = await tableOf(h, seat, end);
    same("live-art: the table gets both Soldiers as tokens", (e.me?.battlefield || []).filter((c) => e.stat[c.id]?.n === "Soldier Token" && e.stat[c.id]?.tok).length, 2);
  });
  // (d) the runaway limit: Polyraptor and Marauding Raptor's loop
  await scenario("live-runaway", async (r, h, seat) => {
    same("live-runaway: the engine's limit asked three times, Keep going each time", (r.runaway || []).map((x) => [x.title, x.options, x.click]), Array(3).fill(["This turn passed the engine's limit", ["Keep going", "End in a draw"], "yes"]));
    same("live-runaway: each said to everyone", (r.chatsAll || []).filter((c) => c === "[MTG] Blue kept the turn going past the engine's limit.").length, 3);
    const first = r.steps.find((x) => x.firstUnbounded)?.board.gameView;
    ok("live-runaway: the engine stopped counting the pile: unbounded Polyraptors on the battlefield", first && bfOf(first).filter((c) => c.unbounded && c.identity?.name === "Polyraptor").length >= 100, first && bfOf(first).filter((c) => c.unbounded).length);
    const { me } = await tableOf(h, seat, first);
    ok("live-runaway: the table gets them marked inf (the x∞ pile)", (me?.battlefield || []).filter((c) => c.inf).length >= 100, (me?.battlefield || []).filter((c) => c.inf).length);
    const end = r.steps.at(-1).board?.gameView;
    same("live-runaway: the loop over, the stack empty", (end?.stack || []).length, 0);
  });
  // (e) the "also costs" hover: Dread Return's flashback and Uro's escape from the graveyard
  await scenario("live-also-costs", async (r, h, seat, applied) => {
    const { me, stat } = await tableOf(h, seat, applied);
    const row = (n) => (me?.playable || []).find((c) => stat[c.id]?.n === n);
    ok("live-also-costs: Dread Return in the playable row, FROM GRAVEYARD, its hover: flashback also costs three creatures", row("Dread Return")?.og === "graveyard" && (row("Dread Return").nt || []).includes("Flashback also costs: sacrifice three creatures."), JSON.stringify(row("Dread Return")));
    ok("live-also-costs: Uro in the playable row, FROM GRAVEYARD, its hover: escape also costs five other cards", row("Uro, Titan of Nature's Wrath")?.og === "graveyard" && (row("Uro, Titan of Nature's Wrath").nt || []).includes("Escape also costs: exile five other cards from your graveyard."), JSON.stringify(row("Uro, Titan of Nature's Wrath")));
  });
  process.stdout.write(`${failed ? "FAIL" : "PASS"} test_bridge_scenario_checks: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL test_bridge_scenario_checks: ${e.stack}\n`); process.exit(1); });
