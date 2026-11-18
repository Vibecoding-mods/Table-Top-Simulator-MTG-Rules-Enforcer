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

function bridge(h) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.heartbeat = () => {};
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["Blue", "AI"], slotNames: { "player-0": "Blue", "player-1": "AI 1" },
    slotColor: { "player-0": "Blue", "player-1": "White" }, started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  return seat;
}
// one recorded question into the bridge: what it shows Blue and what it answers by itself
async function ask(h, seat, step) {
  seat.board = { state: JSON.parse(JSON.stringify(step.board)), fingerprint: null };
  const n0 = h.effects.length;
  h.B.onPrompt(seat, JSON.parse(JSON.stringify(step.prompt))); await h.flush();
  const shownMsg = h.effects.slice(n0).filter((e) => e.tts?.t === "prompt" && e.tts.color === "Blue" && e.tts.promptId != null).map((e) => e.tts).pop() || null;
  const sent = h.effects.slice(n0).map((e) => e.relay?.state).filter((x) => x?.kind === "response" && x.promptId === step.prompt.promptId).map((x) => x.action).pop() || null;
  return { shown: shownMsg ? { title: shownMsg.title, options: (shownMsg.options || []).map((o) => o.label) } : null, ids: (shownMsg?.options || []).map((o) => o.id), sent };
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

async function scenario(name, check) {
  const r = REC[name];
  if (!r) return ok(`${name}: recorded (tools/check-scenarios.js)`, false, "not in scenario-checks.json");
  same(`${name}: the scenario file is the one recorded`, JSON.parse(fs.readFileSync(path.join(ROOT, "scenarios", `${name}.json`), "utf8")), r.scenarioFile);
  same(`${name}: the engine game had no problems`, r.problems, []);
  const h = harness.load();
  try {
    const seat = bridge(h);
    const setup = r.steps.find((s) => s.kind === "setup");
    await ask(h, seat, setup);
    const n0 = h.effects.length;
    h.B.onTTS({ t: "debug", json: JSON.stringify({ color: "Blue", scenario: name }) }); await h.flush();
    const d = h.effects.slice(n0).map((e) => e.relay?.state?.directive).find((x) => x?.type === "applyState");
    same(`${name}: the bridge still makes the recorded changes from it`, d?.ops, r.ops);
    const applied = r.steps.find((s) => s.kind === "applied")?.board.gameView;
    ok(`${name}: the engine applied it`, applied?.stateFix?.applied === true, JSON.stringify(applied?.stateFix));
    await check(r, h, seat, applied);
  } finally { harness.restore(); }
}
// the recorded questions after the cast, replayed: the bridge must show and answer each as recorded
async function replay(name, r, h, seat) {
  const out = [];
  for (const st of r.steps.filter((s) => s.kind === "bridge")) {
    const got = await ask(h, seat, st);
    let sent = got.sent;
    if (st.click) {
      const n1 = h.effects.length;
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: st.prompt.promptId, choice: [st.click] }) }); await h.flush();
      sent = h.effects.slice(n1).map((e) => e.relay?.state).filter((x) => x?.kind === "response" && x.promptId === st.prompt.promptId).map((x) => x.action).pop() || null;
    }
    out.push({ st, shown: got.shown, sent });
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
  process.stdout.write(`${failed ? "FAIL" : "PASS"} test_bridge_scenario_checks: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL test_bridge_scenario_checks: ${e.stack}\n`); process.exit(1); });
