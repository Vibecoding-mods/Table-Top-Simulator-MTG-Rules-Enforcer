// Best of three's extras on the table (tools/engine-renderer.lua; the bridge's half is tests/test_bridge_bo3_extras.js):
// the phase bar's game number (engineMatchTag, the board's match: "GAME 2 OF 3"), and game 1's roll on everyone's
// banner once (engineMatchRollBanner, the board's matchRoll). Each function is taken from engine-renderer.lua as it is
// and run in fengari with stubs; the full table tests need the TTS save. Also the chat line: any player may type
// mtg match concede, only the host the settings (tools/make-engine-copy.js, read as text).
//   node tests/test_table_bo3_extras_lua.js
// (RENDERER_LUA=<a copy>, ENGINE_COPY_JS=<a copy> read copies instead: tools/mutate-bo3-extras.js)
const fs = require("fs");
const path = require("path");
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

const SRC = fs.readFileSync(process.env.RENDERER_LUA || path.join(__dirname, "..", "tools", "engine-renderer.lua"), "utf8").replace(/\r\n/g, "\n");
const COPY = fs.readFileSync(process.env.ENGINE_COPY_JS || path.join(__dirname, "..", "tools", "make-engine-copy.js"), "utf8");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}`); } };
function fn(name) {
  const start = SRC.indexOf(`\nfunction ${name}(`);
  if (start < 0) throw new Error(`no function ${name} in engine-renderer.lua`);
  return SRC.slice(start + 1, SRC.indexOf("\nend\n", start + 1) + 5);
}
function run(code, names) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const prelude = `
    Player = { Blue = {}, White = {} }
    sets = {}
    function getSeatedPlayers() return { "Blue", "White" } end
    function setText(id, t) sets[#sets + 1] = id .. "=" .. tostring(t) end
    function setAttr(id, k, v) if k == "active" then sets[#sets + 1] = id .. "." .. k .. "=" .. tostring(v) end end
    Wait = {} function Wait.time(f, s) end
    engineMatchRollSeen = nil
  `;
  const all = prelude + names.map(fn).join("\n") + `\nlocal function body() ${code} end return tostring(body())`;
  if (lauxlib.luaL_dostring(L, to_luastring(all)) !== 0) throw new Error(lua.lua_tojsstring(L, -1));
  return lua.lua_tojsstring(L, -1);
}
const check = (name, f) => { let got; try { got = f(); } catch (e) { return ok(name, false, `threw ${e.message}`); } return ok(name, got.pass, got.why); };

const TAG = ["engineMatchTag"];
check("phase bar: the game number after the turn", () => { const t = run(`return engineMatchTag({ match = "GAME 2 OF 3" })`, TAG); return { pass: t === "      <b><color=#FFD27A>GAME 2 OF 3</color></b>", why: t }; });
check("phase bar: nothing outside a match", () => { const t = run(`return engineMatchTag({}) .. "|" .. engineMatchTag(nil)`, TAG); return { pass: t === "|", why: t }; });
check("phase bar: the tag is put on the bar", () => ({ pass: /day = day \.\. engineMatchTag\(t\)/.test(SRC.slice(SRC.indexOf("function engineUpdateCorner("), SRC.indexOf("function engineUpdateCorner(") + 6000)), why: "engineUpdateCorner" }));
const ROLL = ["engineMatchRollBanner"];
check("roll: on every seat's banner", () => {
  const t = run(`engineMatchRollBanner({ matchRoll = { seq = 1, text = "BLUE WINS THE ROLL (14–7)" } }) return table.concat(sets, ",")`, ROLL);
  return { pass: t.includes("eng_banner_Blue=BLUE WINS THE ROLL (14–7)") && t.includes("eng_banner_White=BLUE WINS THE ROLL (14–7)") && t.includes("eng_banner_Blue.active=true"), why: t };
});
check("roll: once (the next board with the same roll shows nothing)", () => {
  const t = run(`engineMatchRollBanner({ matchRoll = { seq = 1, text = "X" } }) sets = {} engineMatchRollBanner({ matchRoll = { seq = 1, text = "X" } }) return #sets`, ROLL);
  return { pass: t === "0", why: t };
});
check("roll: a jump board (a rewind, a reload) only records it", () => { const t = run(`engineMatchRollBanner({ jump = true, matchRoll = { seq = 2, text = "X" } }) return #sets .. "|" .. tostring(engineMatchRollSeen)`, ROLL); return { pass: t === "0|2", why: t }; });
check("roll: called with the board", () => ({ pass: /pcall\(engineMatchRollBanner, m\)/.test(SRC), why: "engineRender" }));
// the chat: mtg match concede for anyone, the settings for the host
const branch = COPY.slice(COPY.indexOf('elseif cmd == "match" then'), COPY.indexOf('elseif cmd == "treachery" then'));
ok("chat: anyone may type mtg match concede, the settings stay the host's", /if not isHost and rest ~= "" and rest ~= "concede" then pl\.broadcast\("\[MTG\] Only the host can set best of three\."\)/.test(branch), branch.slice(0, 300));
ok("chat: the help line names mtg match concede", /mtg match concede - give up the match/.test(COPY));

console.log(`${failed ? "FAIL" : "PASS"} test_table_bo3_extras_lua: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
