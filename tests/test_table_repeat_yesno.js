// A repeated yes/no on the table (the bridge's offerRepeat: "No ×3" and "How many…" beside Yes and No when the same
// question waits several times, Smothering Tithe's "Pay {2}?"; the user, 2026-11-15). tools/engine-renderer.lua:
// engineUpdateCorner gives "No ×N" (__repeat:no) the corner's third button, as "Resolve N×" (__group); its press answers
// __repeat:no. The centre row shows every option as a button. "How many…" is a number question with a default
// (engineRowUpdate: the picker starts at p.default when it is in range, else at the minimum as before).
//   node tests/test_table_repeat_yesno.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const q = (lua, mark) => ({ lua, mark });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const fxOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).fx || [];
// what the table sent the bridge in a step (the answer's JSON, unescaped: it is escaped twice on the way out)
const sentOf = (r, mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");

const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "Blue", "player-1": "White" }, names: { "player-0": "Blue", "player-1": "AI 1" }, ai: ["White"] });
const PRELUDE = 'engineAutoPace.Blue = false engineChat("mtg start ai 1", Player.Blue) return "ok"';
const ask = (p) => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", ...p }) }, frames: 5 });
const run = (steps) => simulate({ save, steps: [q(PRELUDE, "prelude"), { msg: { t: "started", json: STARTED } }, ...steps] });
const SHOW = [{ n: "Smothering Tithe", img: "kf1b4bab87-4000-461d-8b58-d34928fee305" }];
// the bridge's question, as offerRepeat sends it
const TITHE = (id, extra = []) => ask({ promptId: id, kind: "yesno", title: "Smothering Tithe: pay {2}?", mode: "single", show: SHOW, text: "3 of these are waiting (Smothering Tithe).",
  options: [{ id: "yes", label: "Pay {2}" }, { id: "no", label: "No: AI 1 creates a Treasure token" }, ...extra] });
const REPEAT = [{ id: "__repeat:no", label: "No ×3" }, { id: "__repeat:some", label: "How many…" }];
const corner = (mark) => q('local g = function(id, a) return tostring(UI.getAttribute(id, a)) end return g("eng_big_Blue", "text") .. "|" .. g("eng_big2_Blue", "text") .. "|" .. g("eng_big3_Blue", "active") .. "|" .. g("eng_big3_Blue", "text")', mark);
const row = (mark) => q('local out = {} for k = 1, ROW_BTNS do local id = "eng_rowopt_Blue_" .. k if UI.getAttribute(id, "active") == "true" then out[#out + 1] = tostring(UI.getAttribute(id, "text")) end end return table.concat(out, "|") .. "#" .. tostring(UI.getValue("eng_rowsub_Blue") or UI.getAttribute("eng_rowsub_Blue", "text"))', mark);
const NUMBER = (id, extra) => ask({ promptId: id, step: 4242, kind: "number", title: "Smothering Tithe: answer No to how many of these 3?", mode: "number", min: 1, max: 3, show: SHOW, ...extra });

{
  const r = run([
    TITHE(700), { frames: 60 }, corner("plain"),
    TITHE(701, REPEAT), { frames: 60 }, corner("repeat"), row("row"),
    q('onMtgBig3(Player.Blue, nil, "eng_big3_Blue") return "clicked"', "press"),
    TITHE(702, REPEAT), { frames: 60 }, q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_4") return "clicked"', "row how many"),
    NUMBER(702, { default: 3 }), row("number"),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_5") return "clicked"', "ok default"),
    NUMBER(703, { default: 3 }), q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_1") onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_5") return "clicked"', "minus ok"),
    NUMBER(704, { default: 9 }), row("out of range"),
    NUMBER(705, {}), row("no default"),
  ]);
  const v = (m) => String(valueOf(r, m)).split("|");
  ok("repeat: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("plain yes/no: no third corner button", v("plain")[0] === "Pay {2}" && v("plain")[2] !== "true", String(valueOf(r, "plain")));
  ok("repeated: the corner's third button is No ×3, beside Pay and No", v("repeat")[0] === "Pay {2}" && v("repeat")[1].startsWith("No") && v("repeat")[2] === "true" && v("repeat")[3] === "No ×3", String(valueOf(r, "repeat")));
  ok("repeated: pressing it answers __repeat:no", sentOf(r, "press").includes('"choice":["__repeat:no"]'), sentOf(r, "press").slice(0, 300));
  const btns = String(valueOf(r, "row")).split("#")[0].split("|");
  ok("repeated: the row shows all four answers", btns.length === 4 && btns[2] === "No ×3" && btns[3] === "How many…", String(valueOf(r, "row")));
  ok("repeated: the row's How many… answers __repeat:some", sentOf(r, "row how many").includes('"choice":["__repeat:some"]'), sentOf(r, "row how many").slice(0, 300));
  ok("how many: the picker starts at its default, 3 of 1 to 3", /^-\|\+\|Min\|Max\|OK: 3#Number: 3 {3}\(1 to 3\)/.test(String(valueOf(r, "number"))), String(valueOf(r, "number")));
  ok("how many: OK answers the default", sentOf(r, "ok default").includes('"choice":[3]'), sentOf(r, "ok default").slice(0, 300));
  ok("how many: - then OK answers 2", sentOf(r, "minus ok").includes('"choice":[2]'), sentOf(r, "minus ok").slice(0, 300));
  ok("how many: a default out of range starts at the minimum", /OK: 1#Number: 1 /.test(String(valueOf(r, "out of range"))), String(valueOf(r, "out of range")));
  ok("number: without a default it starts at the minimum, as before", /OK: 1#Number: 1 /.test(String(valueOf(r, "no default"))), String(valueOf(r, "no default")));
}

console.log(`${failed ? failed + " failed, " : ""}${failed ? "" : "all "}${passed} passed`);
process.exit(failed ? 1 : 0);
