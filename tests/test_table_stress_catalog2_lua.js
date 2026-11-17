// The stress catalog's second batch, the table's items that need no TTS save (tools/engine-renderer.lua; the peer list
// of 2026-11-17):
//  C. A scry's quick buttons ("All on top", the bridge's scryAllOptions) are no cards: engineScryCard, engineScryHeld.
//  F. The number search (optionList): at most 100,000 numbers looked at, the number typed first when it is in range.
//  D. Big hands: the first 40 hand cards laid out (engineHandPlace), the rest one "+N more in hand" card that opens
//     the Engine panel (engineHandMoreClick); a big draw spawns at most 12 new hand cards a frame, the rest on the
//     frames after; the hand counter keeps the engine's count (engineHandCount).
// Each function is taken from engine-renderer.lua as it is and run in fengari with stubs for what it calls; the full
// table tests need the TTS save.
//   node tests/test_table_stress_catalog2_lua.js
// (RENDERER_LUA=<a copy> reads a copy instead: tools/mutate-stress-catalog2.js breaks one so a check fails by name.)
const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

const SRC = fs.readFileSync(process.env.RENDERER_LUA || path.join(__dirname, "..", "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const BUDGET = 30000000;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}`); } };
const check = (name, f) => { let got; try { got = f(); } catch (e) { return ok(name, false, `threw ${e.message}`); } return ok(name, got.pass, got.why); };

// a top-level function's text, from "function name(" to the first "end" at the start of a line
// (a main-chunk local one, "local function optionList(", is given as a global here)
function fn(name) {
  let start = SRC.indexOf(`\nfunction ${name}(`);
  const local = start < 0 ? SRC.indexOf(`\nlocal function ${name}(`) : -1;
  if (start < 0 && local < 0) throw new Error(`no function ${name} in engine-renderer.lua`);
  if (start < 0) start = local;
  const end = SRC.indexOf("\nend\n", start + 1);
  return SRC.slice(start + 1, end + 5).replace(/^local function /, "function ");
}
// a top-level assignment line's value ("ENGINE_HAND_SHOW = 40")
const constant = (name) => { const m = new RegExp(`\\n${name} = ([^\\n]+)`).exec(SRC); if (!m) throw new Error(`no ${name}`); return `${name} = ${m[1]}`; };

function run(code, names, consts = []) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const prelude = `
    JSONish = function(t) local out = {} for k, v in pairs(t) do out[#out + 1] = tostring(k) .. "=" .. tostring(v) end table.sort(out) return table.concat(out, ",") end
    Vector = setmetatable({}, { __call = function(_, x, y, z) return { x = x, y = y, z = z } end })
    Player = { Blue = { seated = true }, White = { seated = true } }
    engineObjs, engineSpawning, placed, waits = {}, {}, {}, 0
    lastTable = nil
    Wait = {}
    function Wait.frames(f, n) waits = waits + 1 end
    function onTable(v, lift) return v end
    function heldIn(list, id) for _, x in ipairs(list or {}) do if x == id then return true end end return false end
    function place(c, pos, rot, seen, handColor, meta) seen[c.id] = true placed[#placed + 1] = { id = c.id, n = c.n, zone = meta and meta.zone, hand = handColor } end
    ENGINE_BACK = "back"
    engineColors = { Blue = true }
    panelReady = true
    engineBrowse, engineShown, enginePrompts, engineScry = {}, {}, {}, {}
    panelCalls = {}
    function updatePanel(c) panelCalls[#panelCalls + 1] = "panel:" .. c end
    function updateOptions(c) panelCalls[#panelCalls + 1] = "options:" .. c end
    G = { lib = { x = 0, y = 0, z = 0 }, right = { x = 1, y = 0, z = 0 }, handPos = { x = 0, y = 0, z = -20 }, rotY = 0 }
    setmetatable(G.lib, { __add = function(a, b) return { x = a.x + b.x, y = a.y + b.y, z = a.z + b.z } end })
    setmetatable(G.right, { __mul = function(a, k) return { x = a.x * k, y = a.y * k, z = a.z * k } end })
    setmetatable(G.handPos, { __add = function(a, b) return { x = a.x + b.x, y = a.y + b.y, z = a.z + b.z } end })
    function hand(n, from) local out = {} for i = 1, n do out[i] = { id = "engine-card-" .. ((from or 0) + i), n = "Card " .. i } end return out end
  `;
  const all = prelude + "\n" + consts.map(constant).join("\n") + "\n" + names.map(fn).join("\n") + "\n" + `local function body() ${code} end return tostring(body())`;
  // (a budget of Lua instructions: a search that looks at too many numbers fails its check instead of running for hours)
  lua.lua_sethook(L, (L2) => lauxlib.luaL_error(L2, to_luastring("ran past its budget of Lua instructions")), lua.LUA_MASKCOUNT, BUDGET);
  if (lauxlib.luaL_dostring(L, to_luastring(all)) !== 0) throw new Error(lua.lua_tojsstring(L, -1));
  return lua.lua_tojsstring(L, -1);
}
const HAND = ["engineHandPlace"], HAND_K = ["ENGINE_HAND_SHOW", "ENGINE_HAND_SPAWNS", "engineHandRedrawDue"];
// (objects for every card already there: only the layout counts)
const HAVE = (n) => `for _, c in ipairs(hand(${n})) do engineObjs[c.id] = {} end`;
const SUMMARY = `local inHand, more, moreName = 0, 0, "" for _, p in ipairs(placed) do if p.zone == "hand" then inHand = inHand + 1 elseif p.zone == "handmore" then more = more + 1 moreName = p.n end end`;

// ── D. big hands ──
check("D 60 cards: 40 laid out in the hand, one +20 more card", () => {
  const got = run(`${HAVE(60)} local seen = {} local folded = engineHandPlace("Blue", G, hand(60), nil, seen) ${SUMMARY} return inHand .. "|" .. more .. "|" .. moreName .. "|" .. folded`, HAND, HAND_K);
  return { pass: got === "40|1|+20 more in hand|20", why: got };
});
check("D 60 cards: the hand's first 40 by the engine's order", () => {
  const got = run(`${HAVE(60)} local seen = {} engineHandPlace("Blue", G, hand(60), nil, seen) return tostring(seen["engine-card-40"]) .. "|" .. tostring(seen["engine-card-41"])`, HAND, HAND_K);
  return { pass: got === "true|nil", why: got };
});
check("D 40 cards: all laid out, no more card", () => {
  const got = run(`${HAVE(40)} local seen = {} local folded = engineHandPlace("Blue", G, hand(40), nil, seen) ${SUMMARY} return inHand .. "|" .. more .. "|" .. folded`, HAND, HAND_K);
  return { pass: got === "40|0|0", why: got };
});
check("D the more card is no hand card (it sits beside the library)", () => {
  const got = run(`${HAVE(45)} local seen = {} engineHandPlace("Blue", G, hand(45), nil, seen) for _, p in ipairs(placed) do if p.zone == "handmore" then return tostring(p.hand) end end return "none"`, HAND, HAND_K);
  return { pass: got === "nil", why: got };
});
check("D a big draw: 12 new hand cards spawned this frame, one redraw asked", () => {
  const got = run(`local seen = {} engineHandPlace("Blue", G, hand(30), nil, seen) ${SUMMARY} return inHand .. "|" .. waits`, HAND, HAND_K);
  return { pass: got === "12|1", why: got };
});
check("D a big draw: the next frame spawns the next 12", () => {
  const got = run(`for i = 1, 12 do engineObjs["engine-card-" .. i] = {} end local seen = {} engineHandPlace("Blue", G, hand(30), nil, seen) local fresh = 0 for _, p in ipairs(placed) do if p.zone == "hand" and tonumber(p.id:match("%d+$")) > 12 then fresh = fresh + 1 end end return fresh`, HAND, HAND_K);
  return { pass: got === "12", why: got };
});
check("D a draw of 12 or fewer: all at once, no redraw", () => {
  const got = run(`local seen = {} engineHandPlace("Blue", G, hand(12), nil, seen) ${SUMMARY} return inHand .. "|" .. waits`, HAND, HAND_K);
  return { pass: got === "12|0", why: got };
});
check("D held draws stay on the library, counted in no layout", () => {
  const got = run(`${HAVE(3)} local seen = {} engineHandPlace("Blue", G, hand(3), { draw = { "engine-card-3" } }, seen) ${SUMMARY} return inHand .. "|" .. tostring(seen["engine-card-3"])`, HAND, HAND_K);
  return { pass: got === "2|true", why: got };
});
check("D the more card opens the Engine panel on its answers", () => {
  const got = run(`engineBrowse.Blue = "browse" engineHandMoreClick(nil, "Blue") return tostring(engineShown.Blue) .. "|" .. tostring(engineBrowse.Blue) .. "|" .. table.concat(panelCalls, ",")`, ["engineHandMoreClick"]);
  return { pass: got === "pin|nil|panel:Blue,options:Blue", why: got };
});
check("D the hand counter keeps the engine's count", () => {
  const got = run(`ENGINE_MODE = true lastTable = { players = { { color = "Blue", handCount = 60, hand = hand(60) } } } return tostring(engineHandCount({ color = "Blue" }))`, ["engineHandCount"]);
  return { pass: got === "60", why: got };
});

// ── F. the number search ──
const NUM = ["optionList"], NUM_K = ["ENGINE_NUMBER_SCAN"];
const search = (min, max, filter) => run(`local l = optionList({ mode = "number", min = ${min}, max = ${max} }, "${filter}") local out = {} for i = 1, math.min(#l, 3) do out[i] = l[i].label end return #l .. "|" .. table.concat(out, ",")`, NUM, NUM_K);
check("F a number typed in a huge range comes first", () => { const got = search(0, 1073741824, "500000"); return { pass: got.split("|")[1].split(",")[0] === "500000", why: got }; });
// (0 to 300,000 with "2000": the 2000s up to 100,000 and the typed 2000 first; past the limit 120,000, 200,000... aren't)
check("F past 100,000 numbers nothing more is looked at", () => {
  const want = 1 + Array.from({ length: 100001 }, (_, n) => n).filter((n) => n !== 2000 && String(n).includes("2000")).length;
  const got = search(0, 300000, "2000");
  return { pass: got.startsWith(`${want}|2000,`), why: `${got}, want ${want}` };
});
check("F a number out of range isn't offered", () => { const got = search(0, 20, "99"); return { pass: got === "0|", why: got }; });
check("F a small range as before: every number that matches", () => { const got = search(0, 100, "9"); return { pass: got.startsWith("19|9,19,29"), why: got }; });
check("F no search: the first 1000 numbers", () => { const got = search(0, 5000, ""); return { pass: got === "1000|0,1,2", why: got }; });
check("F the typed number isn't listed twice", () => { const got = search(0, 100, "50"); return { pass: got === "1|50", why: got }; });

// ── C. the scry's quick buttons are no cards ──
const SCRY = ["engineScryCard", "engineScryOpen", "engineScryHeld"];
check("C a quick button is no scry card", () => {
  const got = run(`return tostring(engineScryCard({ id = "__allin:libraryTop" })) .. "|" .. tostring(engineScryCard({ id = "engine-card-5" }))`, SCRY);
  return { pass: got === "false|true", why: got };
});
check("C the hand zone holds the cards, not the quick buttons", () => {
  const got = run(`enginePrompts.Blue = { promptId = 3, scry = { move = "libraryBottom" }, options = { { id = "__allin:libraryTop" }, { id = "__allin:libraryBottom" }, { id = "engine-card-5" }, { id = "engine-card-6" } } }
    return JSONish(engineScryHeld())`, SCRY);
  return { pass: got === "engine-card-5=true,engine-card-6=true", why: got };
});

console.log(`${failed ? "FAIL" : "PASS"} test_table_stress_catalog2_lua: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
