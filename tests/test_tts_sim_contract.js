// The fake TTS (tests/lua/tts-sim.lua, on fengari) against what real TTS was seen to do. Every table test trusts the
// fake, and it drifted from real TTS several times (zone buttons mirrored, a see-through button hiding its label, a
// Button ignoring UI.setValue, MoonSharp's loop locals, patterns, goto, error and select). Each known behaviour is a
// named check here, so a change to the fake that loses one fails by name. Measured on live TTS on the dates given;
// nothing here drives the real TTS.
//   node tests/test_tts_sim_contract.js        (TABLE_SAVE=<save.json> to test a given save's Global script)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { simulate } = require("./lua/run-sim");
const luaparse = require("./lua/node_modules/luaparse");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };
const step = (r, mark) => r.steps.find((s) => s.step === mark) || {};
const value = (r, mark) => { try { return JSON.parse(step(r, mark).value); } catch (e) { return { error: step(r, mark).error || String(e) }; } };

// a small world: a playmat-sized scripting zone, a plain block and a screen XML with a Button and a Text
const T = (x, z, rotY, sx, sz) => ({ posX: x, posY: 1, posZ: z, rotX: 0, rotY, rotZ: 0, scaleX: sx, scaleY: 1, scaleZ: sz });
const tiny = {
  ObjectStates: [
    { GUID: "zone01", Name: "ScriptingTrigger", Transform: T(19.4, 15.4, 0, 37, 20.75) },
    { GUID: "zone02", Name: "ScriptingTrigger", Transform: T(-19.4, -15.4, 180, 37, 20.75) },
    { GUID: "tile01", Name: "BlockSquare", GMNotes: "mtgsetup", Transform: T(0, 0, 0, 2.2, 1.5) },
    { GUID: "block1", Name: "BlockSquare", Transform: T(5, 5, 0, 1, 1) },
  ],
  XmlUI: '<Button id="btn1">Old</Button><Text id="txt1">Old</Text>',
  LuaScript: "",
};
const run = (steps, save = tiny) => simulate({ save, seated: ["Blue"], host: "Blue", steps });
const q = (lua, mark) => ({ lua, mark });

// ── 1. zone buttons draw x mirrored (live 2026-11-10 on the middle tile, 2026-11-14 on a playmat zone) ──
{
  const r = run([q(`
    local out = {}
    for _, g in ipairs({ "zone01", "zone02", "tile01", "block1" }) do
      local o = getObjectFromGUID(g)
      o.createButton({ click_function = "x", function_owner = Global, label = "B", position = { 0.3, 0.1, 0.2 }, width = 100, height = 100 })
      local asked = o.positionToWorld(Vector(0.3, 0.1, 0.2))
      local drawn = __sim.buttonDrawnAt(o, 1)
      local mirror = o.positionToWorld(Vector(-0.3, 0.1, 0.2))
      out[g] = { mirrored = math.abs(drawn.x - mirror.x) + math.abs(drawn.z - mirror.z) < 1e-6,
        asIs = math.abs(drawn.x - asked.x) + math.abs(drawn.z - asked.z) < 1e-6 }
    end
    return JSON.encode(out)`, "mirror")]);
  const v = value(r, "mirror");
  ok("zone buttons draw x mirrored: a playmat zone", v.zone01 && v.zone01.mirrored && !v.zone01.asIs, JSON.stringify(v.zone01));
  ok("zone buttons draw x mirrored: a playmat zone turned half a turn", v.zone02 && v.zone02.mirrored && !v.zone02.asIs, JSON.stringify(v.zone02));
  ok("zone buttons draw x mirrored: the middle tile (GM notes mtgsetup)", v.tile01 && v.tile01.mirrored && !v.tile01.asIs, JSON.stringify(v.tile01));
  ok("zone buttons draw x mirrored: not on an ordinary object", v.block1 && v.block1.asIs && !v.block1.mirrored, JSON.stringify(v.block1));
}

// ── 2. a see-through button background hides its label (live 2026-11-24, the mana counters) ──
{
  const r = run([q(`
    local o = getObjectFromGUID("block1")
    local mk = function(label, color, w) o.createButton({ click_function = "x", function_owner = Global, label = label, color = color, width = w, height = 100 }) end
    mk("clear", { 0, 0, 0, 0 }, 300)
    mk("faint", { 0, 0, 0, 0.01 }, 300)
    mk("named", { r = 1, g = 1, b = 1, a = 0 }, 300)
    mk("solid", { 0, 0, 0, 1 }, 300)
    mk("nocolor", nil, 300)
    mk("nobg", { 0, 0, 0, 0 }, 0)
    mk("", { 0, 0, 0, 0 }, 300)
    mk("opaque", { 0, 0, 0, 1 }, 300) -- (never edited: the opaque-shows-its-label half, 2026-11-27)
    o.editButton({ index = 3, color = { 0, 0, 0, 0 } })
    local hidden = {}
    for _, h in ipairs(__sim.hiddenLabels) do hidden[#hidden + 1] = h.label end
    __sim.hiddenLabels = {}
    return JSON.encode({ hidden = table.concat(hidden, ","), shown = { __sim.labelShown(o, 4), __sim.labelShown(o, 5), __sim.labelShown(o, 6), __sim.labelShown(o, 8) } })`, "alpha")]);
  const v = value(r, "alpha");
  ok("a see-through button background hides its label (alpha 0, alpha 0.01, an r/g/b/a table, one edited to clear)",
    v.hidden === "clear,faint,named,solid", JSON.stringify(v));
  ok("a see-through button background hides its label: an opaque one, one with no colour and one with no background (width 0) show it",
    JSON.stringify(v.shown) === "[false,true,true,true]", JSON.stringify(v));
  // and run-sim makes any hidden label a script error, so every table test refuses one
  const r2 = run([q('getObjectFromGUID("block1").createButton({ click_function = "x", function_owner = Global, label = "Pool", color = { 0, 0, 0, 0 }, width = 200, height = 80 }) return "made"', "made")]);
  ok("a see-through button background hides its label: run-sim reports it as an error of the step", r2.errors.some((e) => /label .*Pool.* see-through/.test(e)), JSON.stringify(r2.errors));
}

// ── 3. UI.setValue on a Button is ignored by real TTS (it draws the text attribute; live 2026-11-02) ──
{
  const r = run([q('UI.setValue("btn1", "New") UI.setValue("txt1", "New") return JSON.encode({ b = UI.getValue("btn1") or "nil", t = UI.getValue("txt1") or "nil" })', "values")]);
  const v = value(r, "values");
  ok("UI.setValue on a Button is ignored: the Button keeps its value", v.b !== "New", JSON.stringify(v));
  ok("UI.setValue on a Button is ignored: a Text takes it", v.t === "New", JSON.stringify(v));
  ok("UI.setValue on a Button is ignored: run-sim reports it as an error of the step", r.errors.some((e) => /setValue on a Button.*btn1/.test(e)), JSON.stringify(r.errors));
  const r2 = run([q('UI.setAttribute("btn1", "text", "New") return UI.getAttribute("btn1", "text")', "attr")]);
  ok("UI.setValue on a Button is ignored: its text attribute is the way (no error)", step(r2, "attr").value === "New" && r2.errors.length === 0, JSON.stringify(r2.errors));
}

// ── 4. MoonSharp: a bare `local x` in a for-in body holds the looped table (live 2026-11-11) ──
// Not emulated at run time: fengari gives nil. It is refused statically instead (tests/test_moonsharp_loop_locals.js,
// a deploy gate), which is stricter than an emulation: no such local reaches the Global script at all.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sim-contract-"));
  const lint = (src) => {
    const f = path.join(dir, "x.lua");
    fs.writeFileSync(f, src);
    try { execFileSync(process.execPath, [path.join(__dirname, "test_moonsharp_loop_locals.js"), f], { stdio: "pipe" }); return "pass"; }
    catch (e) { return String(e.stdout); }
  };
  const bad = lint("for _, w in ipairs({ 1 }) do local x if w then x = w end end");
  const deep = lint("for k in pairs({ a = 1 }) do if k then local hit print(hit) end end");
  const good = lint("for _, w in ipairs({ 1 }) do local x = nil if w then x = w end end\nfor i = 1, 2 do local y end\nlocal function f() local z end");
  ok("a bare local in a for-in loop body holds the looped table: the gate refuses one", /FAIL/.test(bad) && /local x/.test(bad), bad);
  ok("a bare local in a for-in loop body holds the looped table: the gate refuses one inside an if", /FAIL/.test(deep) && /local hit/.test(deep), deep);
  ok("a bare local in a for-in loop body holds the looped table: `= nil`, numeric for and function locals pass", good === "pass", good);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── 5. MoonSharp: ~99 failed backtracks in a pattern capture raise "pattern too complex" (live 2026-11-06) ──
// Emulated (tests/lua/moonsharp-patterns.js patches fengari); calibrated shape by shape in test_moonsharp_patterns.js.
{
  const r = run([q(`
    local a = pcall(string.match, string.rep("a", 99), "^([^:]*):")
    local b = pcall(string.match, string.rep("a", 60), "^([^:]*):")
    local c, e = pcall(string.match, string.rep("a", 120), "^([^:]*):")
    return JSON.encode({ at99 = a, at60 = b, msg = tostring(e) })`, "pattern")]);
  const v = value(r, "pattern");
  ok('~99 failed backtracks in a pattern capture raise "pattern too complex": 99 letters raise', v.at99 === false, JSON.stringify(v));
  ok('~99 failed backtracks in a pattern capture raise "pattern too complex": 60 do not', v.at60 === true, JSON.stringify(v));
  ok('~99 failed backtracks in a pattern capture raise "pattern too complex": the message says so', /too complex/.test(v.msg || ""), JSON.stringify(v));
}

// ── 6. MoonSharp: a goto out of a nested block (with locals, in a loop) crashes the VM, uncatchably (live 2026-11-02) ──
// Not emulated (fengari runs it). Refused statically: no goto in the Global script at all.
const gotos = (src) => {
  const found = [];
  const walk = (n) => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.type === "GotoStatement") found.push(`line ${n.loc.start.line}: goto ${n.label.name}`);
    for (const [k, v] of Object.entries(n)) if (k !== "loc" && k !== "range") walk(v);
  };
  walk(luaparse.parse(src, { locations: true, luaVersion: "5.2", comments: false }));
  return found;
};
{
  ok("goto out of a nested block crashes MoonSharp: the scan finds a planted one",
    gotos("for i = 1, 3 do do local x = i if x then goto done end end ::done:: end").length === 1);
  const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : require("./golden/table-run").buildSave();
  const found = gotos(save.LuaScript);
  ok("goto out of a nested block crashes MoonSharp: none in the Global script (use repeat ... until true with break)", found.length === 0, found.slice(0, 3).join("; "));
}

// ── 7. MoonSharp: error(table) arrives as a string (live 2026-11-02) ──
{
  const r = run([q(`
    local ok1, e1 = pcall(error, { code = 7 })
    local ok2, e2 = pcall(function() error({ code = 7 }) end)
    local ok3, e3 = pcall(function() error("plain", 0) end)
    local ok4, e4 = pcall(function() error("where") end)
    return JSON.encode({ t1 = type(e1), t2 = type(e2), s3 = e3, s4 = tostring(e4) })`, "error")]);
  const v = value(r, "error");
  ok("error(table) becomes a string: thrown straight to pcall", v.t1 === "string", JSON.stringify(v));
  ok("error(table) becomes a string: thrown from a function", v.t2 === "string", JSON.stringify(v));
  ok("error(table) becomes a string: a string error is unchanged (level 0: no position)", v.s3 === "plain", JSON.stringify(v));
  ok("error(table) becomes a string: a string error keeps its caller's position (level 1)", /^step:\d+: where$/.test(v.s4 || ""), JSON.stringify(v));
}

// ── 8. MoonSharp: select("#") with no arguments is 1 (live 2026-11-02) ──
{
  const r = run([q(`
    local n = function(...) return select("#", ...) end
    return JSON.encode({ none = n(), one = n(nil), two = n(1, 2), second = select(2, "a", "b") })`, "select")]);
  const v = value(r, "select");
  ok('select("#") with no args is 1', v.none === 1, JSON.stringify(v));
  ok('select("#") with no args is 1: one nil is 1, two are 2', v.one === 1 && v.two === 2, JSON.stringify(v));
  ok('select("#") with no args is 1: select(n, ...) is unchanged', v.second === "b", JSON.stringify(v));
}

// ── the table itself, under the model: its tile buttons are drawn where it means them ──
{
  const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : require("./golden/table-run").buildSave();
  const r = simulate({ save, seated: ["White", "Red", "Yellow", "Blue"], host: "Blue", steps: [{ frames: 60 }, { lua: "setEngineMode(true)", frames: 120 }, q(`
    local tile = nil
    for _, o in ipairs(getObjects()) do if o.getGMNotes() == "mtgsetup" then tile = o end end
    if tile == nil then return JSON.encode({ tile = false }) end
    local out = { tile = true, spots = {} }
    for i, b in ipairs(tile.getButtons() or {}) do
      local want = (b.click_function == "onMtgSetupFriendly" and FRIENDLY_SPOT) or (b.click_function == "onMtgSetupMode" and MODE_SPOT) or nil
      if want ~= nil then
        local d = __sim.buttonDrawnAt(tile, i)
        out.spots[#out.spots + 1] = { fn = b.click_function, off = math.sqrt((d.x - want.x) ^ 2 + (d.z - want.z) ^ 2) }
      end
    end
    return JSON.encode(out)`, "tile")] });
  const v = value(r, "tile");
  ok("zone buttons draw x mirrored: the table's tile buttons (Free mulligans, Game mode) are drawn on their spots",
    v.tile && v.spots.length === 2 && v.spots.every((s) => s.off < 0.05), JSON.stringify(v));
  ok("the table's setup draws no hidden label and sets no Button by value", r.errors.length === 0, JSON.stringify(r.errors.slice(0, 2)));
}

console.log(failed ? `\n${failed} failed, ${passed} passed` : `all ${passed} passed`);
process.exit(failed ? 1 : 0);
