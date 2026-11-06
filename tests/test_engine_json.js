// engineJsonDecode (tools/engine-json.lua), the table's decoder for the bridge's messages, on fengari with the fake TTS:
// - real captured messages (golden/fixtures/json-messages.json: every message type, escapes, bullets, 1-12 KB boards)
//   and edge cases give the same values as JSON.parse (types, values, every key both ways; null is a hole / no key);
// - again with TTS's pattern trap emulated (a pattern sees each character's low byte, so U+2022 counts as '"'), which
//   sends the bullet messages through the decoder's restart path;
// - bad JSON raises an error; the documented leniency ([1,] decodes) and \u above 127 (one character) hold;
// - the built table decodes with it (engine-json.lua appended before the renderer) and falls back to JSON.decode when
//   it errors or is missing.
//   node tests/test_engine_json.js     (ENGINE_JSON=<file.lua> tests another copy of the decoder: the break-it runs)
const fs = require("fs");
const path = require("path");
require("./lua/moonsharp-patterns"); // (fails on the patterns TTS fails on)
const { lua, lauxlib, lualib, to_luastring } = require("./lua/node_modules/fengari");

const ROOT = path.join(__dirname, "..");
const DECODER = process.env.ENGINE_JSON || path.join(ROOT, "tools", "engine-json.lua");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${String(why).slice(0, 400)}` : ""}`); } };

// a Lua state: the fake TTS (for JSON.decode, the decoder's fallback for non-container text), the check helpers, and
// the decoder; lowByte: TTS's pattern trap emulated first
function state(lowByte) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const run = (code, name) => {
    if (lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name)) !== lua.LUA_OK || lua.lua_pcall(L, 0, 1, 0) !== lua.LUA_OK) {
      const e = lua.lua_tojsstring(L, -1); lua.lua_pop(L, 1); throw new Error(`${name}: ${e}`);
    }
    const v = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : null;
    lua.lua_pop(L, 1);
    return v;
  };
  run(fs.readFileSync(path.join(__dirname, "lua", "tts-sim.lua"), "utf8"), "=tts-sim");
  run(fs.readFileSync(path.join(__dirname, "lua", "engine-json-check.lua"), "utf8"), "=check");
  if (lowByte) run("__lowByteOn()", "=lowbyte");
  run(fs.readFileSync(DECODER, "utf8"), "=engine-json");
  const decode = (text) => {
    lua.lua_pushstring(L, to_luastring(text)); lua.lua_setglobal(L, to_luastring("__text"));
    const out = run("return __decodeText()", "=decode");
    const nl = out.indexOf("\n");
    return out.slice(0, nl) === "ok" ? { rows: norm(out.slice(nl + 1)) } : { error: out.slice(nl + 1) };
  };
  return { run, decode };
}
// Lua writes numbers with %.17g; compare them as JS numbers
const norm = (text) => (text === "" ? [] : text.split("\n")).map((r) => {
  const t = r.indexOf("\t");
  return r[t + 1] === "n" ? `${r.slice(0, t)}\tn${String(Number(r.slice(t + 2)))}` : r;
}).sort();
// the same rows from JSON.parse: arrays from 1, null left out (a hole, an absent key), keys as text
function reference(text) {
  const rows = [];
  const hex = (s) => Buffer.from(s, "utf8").toString("hex");
  const walk = (x, p) => {
    if (x === null) return;
    if (Array.isArray(x)) { rows.push(`${p}\t{}`); x.forEach((y, i) => walk(y, `${p}/n${i + 1}`)); }
    else if (typeof x === "object") { rows.push(`${p}\t{}`); for (const [k, y] of Object.entries(x)) walk(y, `${p}/s${hex(k)}`); }
    else if (typeof x === "string") rows.push(`${p}\ts${hex(x)}`);
    else if (typeof x === "number") rows.push(`${p}\tn${String(x)}`);
    else rows.push(`${p}\tb${x}`);
  };
  walk(JSON.parse(text), "");
  return rows.sort();
}
const diff = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `row ${i}: got ${a[i]} want ${b[i]}`; return null; };

const messages = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "json-messages.json"), "utf8"));
// edge cases (tmp/json-decode/sem2.lua's, as JSON text: String.raw keeps every backslash)
const R = String.raw;
const edge = [
  "[1,null,3]", "[null]", "[1,2,null]", R`{"a":null,"b":1}`, "[]", "{}", R`{"a":[],"b":{}}`, R`{"1":"x","2":"y"}`,
  R`["\u0000z","\u001f","a\/b","q\"q","b\\s","t\tn\nr\r","\\\"","x\\","\"","\b\f"]`,
  R`{"k\"ey":"v\\","k2":["\"",{"\\":"\\\\"}]}`,
  "[1.5e3,-0,12345678901234567890,0.1,-2.5E-2,1E2]", R`{ "a" : [ 1 , 2 ] , "b" : true }`, R`{"a":1,"a":2}`,
  ' {\n "a": [ ],\n "b": { }, "c" : null , "d":false\n} ', R`[[[[[[[[[["deep"]]]]]]]]]]`, "[1,2,3,4,5,6,7,8,9,10]",
  R`[{"a":{"b":[[1],[2,{"c":false}]]}}]`, R`{"s":"a,b:c{d}[e]"}`, R`["",""]`, R`{"":""}`,
  R`[true,false,null,"null",0]`, R`{"a":"Lim-Dûl Æther — ","b":["Jötun","Séance"]}`,
  `{"x":"a","ids":[${"1,".repeat(400)}2]}`, `[${"1,".repeat(400)}2]`,
  `{"t":"${"long ".repeat(200)}\\\\","u":"${"q\\\"".repeat(300)}"}`,
  R`{"t":"named \"Sol Ring\" and \"Æther\"","n":[1,{"a":"\"\"\""}]}`,
  R`{"tx":"Choose one —\n• All creatures get -1/-1.\n• Destroy.","n":2,"k•":["•","™ĢŜŻŝ",3]}`,
  R`["•\"•","x•","•"]`, R`{"a•":"•","•b":{"c":"d•\\"}}`, R`["\"•\\","\\•\"",{"•":"•"}]`,
];
const bad = [R`{"a":`, R`{"x":tru}`, "[1", R`{"a":1}}`, "[1]]", R`["abc`, R`{"a":"b`, "[1,2", R`{"a":[1,{"b":2]}`, R`["a\x"]`];

const plain = state(false), low = state(true);
for (const [label, st] of [["plain", plain], ["TTS low-byte", low]]) {
  let same = 0;
  messages.forEach((m, i) => {
    const got = st.decode(m.json);
    const want = reference(m.json);
    const d = got.error ? `error ${got.error}` : diff(got.rows, want);
    if (d) ok(`${label}: message ${i} (${m.t}, ${m.json.length} bytes) decodes as JSON.parse`, false, d);
    else same++;
  });
  ok(`${label}: all ${messages.length} real messages decode as JSON.parse`, same === messages.length, `${same} of ${messages.length}`);
  same = 0;
  edge.forEach((text, i) => {
    const got = st.decode(text);
    const d = got.error ? `error ${got.error}` : diff(got.rows, reference(text));
    if (d) ok(`${label}: edge case ${i} ${JSON.stringify(text.slice(0, 60))}`, false, d);
    else same++;
  });
  ok(`${label}: all ${edge.length} edge cases decode as JSON.parse`, same === edge.length, `${same} of ${edge.length}`);
  for (const text of bad) ok(`${label}: bad JSON ${JSON.stringify(text)} raises an error`, st.decode(text).error !== undefined, JSON.stringify(st.decode(text)));
  // (documented leniency: commas and colons aren't checked)
  const lenient = st.decode("[1,]");
  ok(`${label}: [1,] decodes to [1] (lenient, as documented)`, !lenient.error && !diff(lenient.rows, reference("[1]")), JSON.stringify(lenient));
  // non-container text goes to JSON.decode (the fake TTS's)
  for (const [text, want] of [["true", "\tbtrue"], ["5", "\tn5"], [R`"x"`, "\ts78"]]) {
    const got = st.decode(text);
    ok(`${label}: ${text} goes to JSON.decode`, !got.error && got.rows.join() === want, JSON.stringify(got));
  }
}
// the real messages with bullets went through the restart path under the emulation (else the second pass proves nothing)
ok("TTS low-byte: the emulation saw the bullet messages", Number(low.run("return tostring(__lowByteHits)", "=hits")) >= messages.filter((m) => m.json.includes("\u2022")).length,
  `${low.run("return tostring(__lowByteHits)", "=hits")} hits`);
// \u above 127: one character (fengari: one byte; in TTS, whose strings are UTF-16, that character), JSON.decode's
// mojibake avoided; \u0000-\u001f the same as JSON.parse (above)
ok("\\u00e9 becomes one character 233", plain.run(R`local ok, t = pcall(engineJsonDecode, '["\\u00e9"]') return ok and (#t[1] .. " " .. string.byte(t[1])) or tostring(t)`, "=u") === "1 233",
  plain.run(R`local ok, t = pcall(engineJsonDecode, '["\\u00e9"]') return tostring(ok) .. " " .. tostring(ok and #t[1] or t)`, "=u2"));
// the decoder adds one global and no other
ok("one global: engineJsonDecode", plain.run(`local n = {} for k in pairs(_G) do if k:find("^engine") then n[#n + 1] = k end end table.sort(n) return table.concat(n, ",")`, "=g") === "engineJsonDecode",
  plain.run(`local n = {} for k in pairs(_G) do if k:find("^engine") then n[#n + 1] = k end end return table.concat(n, ",")`, "=g2"));

// ── the built table ──
if (!process.env.ENGINE_JSON) {
  const { simulate } = require("./lua/run-sim");
  const { buildSave } = require("./golden/table-run");
  const save = buildSave();
  const script = save.LuaScript;
  const at = script.indexOf("engineJsonDecode = (function()");
  ok("build: engine-json.lua is in the Global once", at > 0 && script.indexOf("engineJsonDecode = (function()", at + 1) < 0, at);
  ok("build: before the renderer", at < script.indexOf("-- ───────── manual fix by vote (PLAN M7"), `${at} / ${script.indexOf("manual fix by vote")}`);
  const chat = (text) => ({ msg: { t: "chat", json: JSON.stringify({ t: "chat", text, color: null }) } });
  const q = (luaCode, mark) => ({ lua: luaCode, mark });
  const r = simulate({ save, steps: [
    q("__jd = 0 local real = engineJsonDecode engineJsonDecode = function(s) __jd = __jd + 1 return real(s) end", "wrap"),
    { ...chat("[MTG] one • two"), mark: "fast" }, q("return tostring(__jd)", "count"),
    q('engineJsonDecode = function() error("boom") end', "break"), { ...chat("[MTG] second"), mark: "errors" },
    q("engineJsonDecode = nil", "remove"), { ...chat("[MTG] third"), mark: "missing" },
    q('engineJsonDecode = function() return "not a table" end', "odd"), { ...chat("[MTG] fourth"), mark: "not a table" }] });
  const fx = (mark) => (r.steps.find((s) => s.step === mark) || {}).fx || [];
  const said = (mark, text) => fx(mark).some((l) => l.includes("broadcastToAll") && l.includes(text));
  const warned = (mark) => fx(mark).some((l) => l.includes("print") && l.includes("fast JSON decode failed"));
  ok("table: no script errors", r.errors.length === 0, r.errors.join(" | "));
  ok("table: a message is decoded by engineJsonDecode", (r.steps.find((s) => s.step === "count") || {}).value === "1" && said("fast", "one • two") && !warned("fast"),
    `${(r.steps.find((s) => s.step === "count") || {}).value} ${JSON.stringify(fx("fast"))}`);
  ok("table: an error falls back to JSON.decode, and says so", said("errors", "[MTG] second") && warned("errors") && fx("errors").some((l) => l.includes("boom")), JSON.stringify(fx("errors")));
  ok("table: no decoder at all falls back too", said("missing", "[MTG] third") && warned("missing"), JSON.stringify(fx("missing")));
  ok("table: a non-table result falls back too", said("not a table", "[MTG] fourth") && warned("not a table"), JSON.stringify(fx("not a table")));
}

console.log(failed ? `\n${failed} failed, ${passed} passed` : `all ${passed} checks passed`);
process.exit(failed ? 1 : 0);
