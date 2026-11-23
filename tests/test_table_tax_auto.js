// The Taxes button on the table (tools/engine-renderer.lua engineTaxDraw, onMtgTax; the bridge's taxAuto,
// tests/test_bridge_tax_auto.js; the user, 2026-11-22: "Add auto yes or no to tax question in the top left ui"):
//  - shown in a game, right of Fix, reading "Taxes: ask"; hidden with no game
//  - a click goes ask -> always pay -> never pay -> ask, each sent to the bridge as "taxauto" { color, mode }
//  - the label and colour follow; the next hello carries the setting (a restarted bridge takes it up), none while ask
//  - panels rebuilt (someone sits down): the button is drawn again
//   node tests/test_table_tax_auto.js
const fs = require("fs");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const q = (lua, mark) => ({ lua, mark });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const fxOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).fx || [];
// every table call from step a up to (not including) step b: UI changes go out a frame later (engineUI batches them)
const fxBetween = (r, a, b) => { const i = r.steps.findIndex((x) => x.step === a), j = r.steps.findIndex((x) => x.step === b); return r.steps.slice(i, j < 0 ? undefined : j).flatMap((x) => x.fx || []); };
const sentOf = (r, mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");

const path = require("path");
const s1 = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "table-stream-1v1.json"), "utf8"));
const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "Blue", "player-1": "White" }, names: { "player-0": "Blue", "player-1": "AI 1" }, ai: ["White"] });
const button = (mark) => q('local g = function(a) return tostring(UI.getAttribute("eng_tax_Blue", a)) end return g("active") .. "|" .. g("text") .. "|" .. g("color")', mark);
const click = (mark) => q('onMtgTax(Player.Blue, nil, "eng_tax_Blue") return "clicked"', mark);

{
  const r = simulate({ save, steps: [
    button("before"),
    q('engineChat("mtg start ai 1", Player.Blue) return "ok"', "prelude"), ...s1.slice(0, 40).map((m) => ({ msg: { t: m.t, json: m.json } })), { frames: 30 },
    button("in game"),
    click("click 1"), button("after 1"),
    q('engineHello() return "hello"', "hello pay"),
    click("click 2"), button("after 2"),
    click("click 3"), button("after 3"),
    q('engineHello() return "hello"', "hello ask"),
    click("click 4"), q('ENGINE_TIE_UI = not ENGINE_TIE_UI engineRenderPanels() return "rebuilt"', "rebuilt"), { frames: 30 }, button("after rebuild"), q('engineAutoResolveDraw("Blue") return "again"', "unchanged"), { frames: 10 }, q('return "end"', "unchanged end"),
    q('engineAutoResolveDraw("Blue", true) return "over"', "over"), { frames: 10 }, button("after over"),
    q('onMtgTax(Player.White, nil, "eng_tax_Blue") return "wrong seat"', "other seat"), button("after other"),
  ] });
  const v = (m) => String(valueOf(r, m)).split("|");
  // (a UI call on the button: the fake TTS records it by its long id)
  const touches = (l) => l.includes('"eng_tax_Blue"');
  ok("no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("no game: the button is hidden", v("before")[0] !== "true", String(valueOf(r, "before")));
  ok("in a game: shown, reading Taxes: ask", v("in game")[0] === "true" && v("in game")[1] === "Taxes: ask", String(valueOf(r, "in game")));
  ok("first click: always pay, sent to the bridge", v("after 1")[1] === "Taxes: always pay" && /"t":"taxauto"/.test(sentOf(r, "click 1")) && /"mode":"pay"/.test(sentOf(r, "click 1")), sentOf(r, "click 1").slice(0, 300));
  ok("always pay: green", v("after 1")[2] === "#2e7d32", String(valueOf(r, "after 1")));
  ok("hello carries the setting", /"tax":\{"Blue":"pay"\}/.test(sentOf(r, "hello pay")), sentOf(r, "hello pay").slice(0, 400));
  ok("second click: never pay, sent", v("after 2")[1] === "Taxes: never pay" && /"mode":"no"/.test(sentOf(r, "click 2")), sentOf(r, "click 2").slice(0, 300));
  ok("never pay: red", v("after 2")[2] === "#8e2a2a", String(valueOf(r, "after 2")));
  ok("third click: back to ask, sent", v("after 3")[1] === "Taxes: ask" && /"mode":"ask"/.test(sentOf(r, "click 3")), sentOf(r, "click 3").slice(0, 300));
  ok("hello with ask: no tax field", /"t":"hello"/.test(sentOf(r, "hello ask")) && !/"tax"/.test(sentOf(r, "hello ask")), sentOf(r, "hello ask").slice(0, 400));
  ok("panels rebuilt: drawn again", v("after rebuild")[0] === "true" && v("after rebuild")[1] === "Taxes: always pay" && fxBetween(r, "rebuilt", "after rebuild").some(touches),
    fxBetween(r, "rebuilt", "after rebuild").filter(touches).join(" ").slice(0, 300));
  ok("game over: hidden", v("after over")[0] === "false", String(valueOf(r, "after over")));
  ok("nothing changed: not drawn again", !fxBetween(r, "unchanged", "unchanged end").some(touches), fxBetween(r, "unchanged", "unchanged end").filter(touches).join(" ").slice(0, 300));
  ok("another seat's click on Blue's button does nothing", v("after other")[1] === "Taxes: always pay" && !/taxauto/.test(sentOf(r, "other seat")), sentOf(r, "other seat").slice(0, 300));
}

console.log(`${failed ? failed + " failed, " : ""}${failed ? "" : "all "}${passed} passed`);
process.exit(failed ? 1 : 0);
