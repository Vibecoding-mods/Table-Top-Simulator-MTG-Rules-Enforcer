// The extra-turn badge past 99 (docs/stress-catalog.md #21, tools/engine-renderer.lua engineExtraTurnBadge), the part
// that needs no TTS save: "EXTRA TURN nx" up to 99, then "EXTRA TURNS 99+" (at four digits "EXTRA TURN 1000x" was wider
// than the badge's room, x -2 to 0.55, at the smallest font, 120). The hover names the real count, and a count that
// changes past 99 edits the one button. Each function is taken from engine-renderer.lua as it is and run in fengari
// on a fake tracker; the placement against the tracker's own buttons is test_table_claims.js "badge fit" (the save).
//   node tests/test_table_extra_turns_lua.js
// (RENDERER_LUA=<a copy> reads a copy: tools/mutate-extra-turns.js breaks one so a check fails by name.)
const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

const SRC = fs.readFileSync(process.env.RENDERER_LUA || path.join(__dirname, "..", "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${why}` : ""}`); } };

function fn(name) {
  const start = SRC.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`no function ${name} in engine-renderer.lua`);
  const end = SRC.indexOf("\nend\n", start + 1);
  return SRC.slice(start + 1, end + 5);
}

// a fake tracker: its buttons, createButton / editButton / removeButton as TTS does them (0-based index)
const PRELUDE = `
  Global = {}
  JSON = {}
  function JSON.encode(v)
    if type(v) == "table" then
      local out = {}
      if #v > 0 then for _, x in ipairs(v) do out[#out + 1] = JSON.encode(x) end return "[" .. table.concat(out, ",") .. "]" end
      local keys = {}
      for k in pairs(v) do keys[#keys + 1] = k end
      table.sort(keys)
      for _, k in ipairs(keys) do out[#out + 1] = string.format("%q", k) .. ":" .. JSON.encode(v[k]) end
      return "{" .. table.concat(out, ",") .. "}"
    elseif type(v) == "string" then return string.format("%q", v)
    elseif v == nil then return "null"
    else return tostring(v) end
  end
  function fakeTracker()
    local o = { buttons = {} }
    function o.getButtons() local out = {} for i, b in ipairs(o.buttons) do local c = {} for k, x in pairs(b) do c[k] = x end c.index = i - 1 out[i] = c end return out end
    function o.createButton(t) local c = {} for k, x in pairs(t) do c[k] = x end o.buttons[#o.buttons + 1] = c end
    function o.editButton(t) local b = o.buttons[t.index + 1] for k, x in pairs(t) do if k ~= "index" then b[k] = x end end end
    function o.removeButton(i) table.remove(o.buttons, i + 1) end
    return o
  end
`;
const NAMES = ["engineMarksWidth", "engineExtraTurnTip", "engineExtraTurnBadge"];

function run(code) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const chunk = `${PRELUDE}\n${NAMES.map(fn).join("\n")}\n${code}`;
  if (lauxlib.luaL_loadstring(L, to_luastring(chunk)) !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(L, -1));
  if (lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) throw new Error(lua.lua_tojsstring(L, -1));
  return lua.lua_tojsstring(L, -1);
}
// the tracker's badges after each count in turn (one tracker throughout, as a game's counts change)
function badges(counts) {
  const steps = counts.map((n) => `engineExtraTurnBadge(o, { extraTurns = ${n === null ? "nil" : JSON.stringify(n)}, name = "AI 1" }) out[#out + 1] = engineBadgesNow(o)`).join("\n");
  return JSON.parse(run(`
    function engineBadgesNow(o)
      local list = {}
      for _, b in ipairs(o.getButtons()) do
        if engineExtraTurnTip(b.tooltip) then list[#list + 1] = { label = b.label, tip = b.tooltip, w = b.width, f = b.font_size, x = b.position[1], z = b.position[3] } end
      end
      return { n = #o.getButtons(), badges = list }
    end
    local o = fakeTracker()
    local out = {}
    ${steps}
    return JSON.encode(out)`));
}

const ROOM = (0.55 - -2) * 480;
const CASES = [[1, "EXTRA TURN", "1 extra turn"], [2, "EXTRA TURN 2x", "2 extra turns"], [10, "EXTRA TURN 10x", "10 extra turns"],
  [99, "EXTRA TURN 99x", "99 extra turns"], [100, "EXTRA TURNS 99+", "100 extra turns"], [999, "EXTRA TURNS 99+", "999 extra turns"],
  [1000, "EXTRA TURNS 99+", "1000 extra turns"], [123456, "EXTRA TURNS 99+", "123456 extra turns"], [2147483647, "EXTRA TURNS 99+", "2147483647 extra turns"]];
let got = [];
try { got = badges(CASES.map(([n]) => n)); } catch (e) { ok("extra turns lua: precondition, no Lua error", false, e.message); }
CASES.forEach(([n, label, words], i) => {
  const row = got[i] || {}, b = (row.badges || [])[0] || {};
  ok(`extra turns lua: ${n} reads "${label}"`, (row.badges || []).length === 1 && b.label === label, JSON.stringify(row));
  ok(`extra turns lua: ${n}, the hover names the real count, "AI 1 has ${words} coming"`, b.tip === `AI 1 has ${words} coming`, b.tip);
  const lx = b.x - b.w / 960, rx = b.x + b.w / 960;
  ok(`extra turns lua: ${n}, the badge fits x -2 to 0.55 at a font of at least 120, at z -1.45`,
    b.w <= ROOM && lx >= -2 - 1e-9 && Math.abs(rx - 0.55) < 1e-9 && b.f >= 120 && b.z === -1.45, `width ${b.w} of ${ROOM}, x ${lx}..${rx}, font ${b.f}, z ${b.z}`);
  ok(`extra turns lua: ${n}, one button on the tracker (edited, not added)`, row.n === 1, JSON.stringify(row));
});
// the font no smaller past 99 than at 99 (both 120), and the same for every count past 99; 175 for one
{
  const at = (n) => ((got[CASES.findIndex((c) => c[0] === n)] || {}).badges || [{}])[0].f;
  ok("extra turns lua: past 99 the font is 99's, the same for every count; one extra turn at 175", at(1) === 175 && at(100) === at(99) && [999, 1000, 123456, 2147483647].every((n) => at(n) === at(100)), `1: ${at(1)}, 99: ${at(99)}, 100: ${at(100)}, 1000: ${at(1000)}`);
}
// a count that drops back under 100, then to none, and the hover's count past 99 as it changes
{
  let seq = [];
  try { seq = badges([5000, 4999, 100, 99, 3, 0, null]); } catch (e) { ok("extra turns lua: precondition, the sequence runs", false, e.message); }
  const lab = (i) => ((seq[i] || {}).badges || []).map((b) => `${b.label} | ${b.tip}`).join(" || ");
  ok("extra turns lua: 5,000 then 4,999, the same label, the hover's count edited", lab(0) === "EXTRA TURNS 99+ | AI 1 has 5000 extra turns coming" && lab(1) === "EXTRA TURNS 99+ | AI 1 has 4999 extra turns coming", `${lab(0)} / ${lab(1)}`);
  ok("extra turns lua: 100 then 99, the number back", lab(2) === "EXTRA TURNS 99+ | AI 1 has 100 extra turns coming" && lab(3) === "EXTRA TURN 99x | AI 1 has 99 extra turns coming", `${lab(2)} / ${lab(3)}`);
  ok("extra turns lua: then 3, then none, then no count: the badge gone", lab(4) === "EXTRA TURN 3x | AI 1 has 3 extra turns coming" && (seq[5] || {}).n === 0 && (seq[6] || {}).n === 0, JSON.stringify(seq.slice(4)));
}
console.log(failed ? `${failed} failed (${passed} passed)` : `all ${passed} extra-turn badge checks pass`);
process.exit(failed ? 1 : 0);
