// The table's caps for a big game (docs/stress-catalog.md, top 10, the table's items; tools/engine-renderer.lua):
//  1. Compact numbers (#10): engineCompact "12.3K", "1.2M", "∞" at 2^30; the life counter's number compact past 9,999,
//     its font smaller from 4 letters, clear of the commander-damage icons on all four trackers, the exact number in
//     its hover; a counter badge "+12.3K/+12.3K".
//  2. The mana pool (#6): the panel's "G×150" past 6, a chip "G999+" past 999 that fits its width, the hover exact.
//  3. The stack (#3): at most 8 objects a caster plus one "+N more on the stack" card, every one on the caster's mat,
//     its hover naming the folded ones; 8 or fewer as before; the status line "... and N more" past 8.
//  4. Fans (#5): 30 auras on one creature within 6 units of it, 30 linked exiled cards within 4.5; 6 auras and 8 linked
//     as before (1.0 and 0.35 apart).
//  5. The number row (#1): a 0..999 question's - and + by a step (Step cycles 1, 10, 100), Max then Min; a 0..5 one as
//     before.
// Boards are made up here (two players: Blue seated, White an AI), as the bridge sends them.
//   node tests/test_table_stress_caps.js
// (RENDERER_LUA=<a copy> builds the table from a copy: tools/mutate-stress-caps.js breaks one so a check fails by name.)
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

function saveWith() {
  const save = buildSave();
  if (!process.env.RENDERER_LUA) return save;
  // (the built Global is the table's own script, then the renderer, then make-engine-copy's tables after it)
  const real = fs.readFileSync(path.join(__dirname, "..", "tools", "engine-renderer.lua"), "utf8");
  const copy = fs.readFileSync(process.env.RENDERER_LUA, "utf8");
  if (!save.LuaScript.includes(real)) throw new Error("the built table doesn't hold tools/engine-renderer.lua as is");
  save.LuaScript = save.LuaScript.split(real).join(copy);
  return save;
}
const save = saveWith();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const q = (lua, mark, frames) => ({ lua, mark, ...(frames != null ? { frames } : {}) });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const json = (r, mark) => { try { return JSON.parse(String(valueOf(r, mark))); } catch (e) { return null; } };

const TRACKER = { Blue: "395037", White: "23e485", Red: "448880", Yellow: "37e533" };
const ART = (id) => `https://example.invalid/${id}.jpg`;
function board({ blue = {}, white = {}, stack = [], cards = {} } = {}) {
  const pl = (color, slot, extra) => ({
    color, slot, name: color === "White" ? "AI 1" : color, ai: color === "White", life: 40, status: "playing", pool: null, poison: 0, energy: 0,
    cmdDamage: {}, tax: [0, 0], library: 50, handCount: 0, hand: color === "Blue" ? [] : null, battlefield: [], graveyard: [], exile: [], command: [], ...extra,
  });
  return { msg: { t: "table", json: JSON.stringify({ t: "table", turn: 3, step: "main1", active: "Blue", activeTurnNo: 2, priority: "Blue", gameOver: false,
    winner: null, players: [pl("White", "player-1", white), pl("Blue", "player-0", blue)], stack, cards }) }, frames: 40 };
}
const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "Blue", "player-1": "White" }, names: { "player-0": "Blue", "player-1": "AI 1" }, ai: ["White"] });
const PRELUDE = 'engineAutoPace.Blue = false engineChat("mtg start ai 1", Player.Blue) return "ok"';
const run = (steps) => simulate({ save, steps: [q(PRELUDE, "prelude"), { msg: { t: "started", json: STARTED } }, ...steps] });
const ask = (p) => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", ...p }) }, frames: 5 });
// every engine object: { id, name, desc, x, z, buttons }
const OBJECTS = (mark) => q(`local out = {} for _, o in ipairs(getObjects()) do local n = tostring(o.getGMNotes()) if n:find("^engine:") then local p = o.getPosition() local b = {} for _, x in ipairs(o.getButtons() or {}) do b[#b + 1] = tostring(x.label) end out[#out + 1] = { id = n:sub(8), name = o.getName(), desc = o.getDescription(), x = p.x, z = p.z, buttons = b } end end return JSON.encode(out)`, mark);
const byId = (list, id) => (list || []).find((o) => o.id === id);
// Blue's mat zone (the save's big scripting zones, the one at Blue's side)
const mats = save.ObjectStates.filter((o) => o.Name === "ScriptingTrigger" && o.Transform.scaleX > 30).map((o) => { const t = o.Transform; return { x0: t.posX - t.scaleX / 2, x1: t.posX + t.scaleX / 2, z0: t.posZ - t.scaleZ / 2, z1: t.posZ + t.scaleZ / 2 }; });
const inMat = (o) => mats.some((m) => o.x >= m.x0 && o.x <= m.x1 && o.z >= m.z0 && o.z <= m.z1);

// ───────── 1. compact numbers ─────────
{
  const CASES = [[0, "0"], [40, "40"], [9999, "9999"], [-9999, "-9999"], [10000, "10K"], [12345, "12.3K"], [45000, "45K"], [99999, "99.9K"], [100000, "100K"],
    [999999, "999K"], [1234567, "1.2M"], [2300000, "2.3M"], [45678901, "45.6M"], [1000000000, "1B"], [1073741823, "1B"], [1073741824, "∞"], [2147483647, "∞"],
    [-12345, "-12.3K"], [-1073741824, "-∞"], ["*", "*"]];
  const lua = `local out = {} for i, c in ipairs(JSON.decode([==[${JSON.stringify(CASES.map((c) => c[0]))}]==])) do out[i] = engineCompact(c) end return JSON.encode(out)`;
  const r = simulate({ save, steps: [q(lua, "compact")] });
  const got = json(r, "compact") || [];
  CASES.forEach(([n, want], i) => ok(`compact: ${n} reads ${want}`, got[i] === want, got[i]));
  const names = (k) => Array.from({ length: k }, (_, i) => `N${i + 1}`);
  const r2 = simulate({ save, steps: [q(`return engineFewNames(JSON.decode([==[${JSON.stringify(names(8))}]==]))`, "eight"), q(`return engineFewNames(JSON.decode([==[${JSON.stringify(names(9))}]==]))`, "nine")] });
  ok("names: 8 read in full", valueOf(r2, "eight") === names(8).join(", "), valueOf(r2, "eight"));
  ok("names: 9 read 8 ... and 1 more", valueOf(r2, "nine") === `${names(8).join(", ")} ... and 1 more`, valueOf(r2, "nine"));
}
// the life counter: Blue's counter is given its own button first (the counter's script doesn't run on the fake TTS), as
// the real counter makes it (Amuzet's LifeTracker: click function option, font 1000, 950 wide)
{
  const OWN = `local o = getObjectFromGUID("${TRACKER.Blue}") o.clearButtons() o.createButton({ click_function = "option", function_owner = o, label = "40", tooltip = "Click to increase\\nRight click to decrease", width = 950, height = 750, font_size = 1000, position = { 0, 0.05, -0.3 } }) return "own"`;
  const MAIN = (mark) => q(`local b = getObjectFromGUID("${TRACKER.Blue}").getButtons()[1] return JSON.encode({ label = tostring(b.label), font = b.font_size, tip = b.tooltip })`, mark);
  const r = run([q(OWN, "own"), board({ blue: { life: 40 } }), MAIN("40"), board({ blue: { life: 12345 } }), MAIN("12345"),
    board({ blue: { life: 1073741824 } }), MAIN("cap"), board({ blue: { life: 2500000 } }), MAIN("2.5M"), board({ blue: { life: 500 } }), MAIN("500")]);
  ok("life: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  const at = (m) => json(r, m) || {};
  ok("life: 40 stays the counter's own, font 1000, its own hover", at("40").label === "40" && at("40").font === 1000 && !/^Life:/.test(at("40").tip || ""), JSON.stringify(at("40")));
  ok("life: 12345 reads 12.3K", at("12345").label === "12.3K", JSON.stringify(at("12345")));
  ok("life: 12.3K in a smaller font (5 letters: 600)", at("12345").font === 600, JSON.stringify(at("12345")));
  ok("life: the hover says the exact life", (at("12345").tip || "").startsWith("Life: 12345\n"), JSON.stringify(at("12345")));
  ok("life: the engine's cap reads ∞ at the counter's own font", at("cap").label === "∞" && at("cap").font === 1000, JSON.stringify(at("cap")));
  ok("life: 2.5M at 750 (4 letters)", at("2.5M").label === "2.5M" && at("2.5M").font === 750, JSON.stringify(at("2.5M")));
  ok("life: back to 500, the counter's own font again", at("500").font === 1000 && !/^Life:/.test(at("500").tip || ""), JSON.stringify(at("500")));
}
// fit: each label the counter can show, at its font, on all four trackers of the save, clear of every commander-damage
// icon (TTS's text is about 0.583 of its font a letter, 480 button units to a local unit)
{
  const LABELS = ["40", "999", "-999", "9999", "-9999", "12.3K", "-12.3K", "999K", "1.2M", "∞", "-∞"];
  const lua = `local out = {} for i, l in ipairs(JSON.decode([==[${JSON.stringify(LABELS)}]==])) do local n = ({ ["12.3K"] = 12345, ["-12.3K"] = -12345, ["999K"] = 999999, ["1.2M"] = 1234567, ["∞"] = 2147483647, ["-∞"] = -2147483647 })[l] or tonumber(l) local k = engineLifeLook(n) out[i] = { label = k.label, font = k.font, letters = k.letters } end return JSON.encode(out)`;
  const r = simulate({ save, steps: [q(lua, "looks")] });
  const looks = json(r, "looks") || [];
  ok("life fit: precondition, every label read back as itself", looks.length === LABELS.length && looks.every((k, i) => k.label === LABELS[i]), JSON.stringify(looks));
  const icons = save.ObjectStates.filter((o) => o.Nickname === "Commander Damage").map((o) => ({ x: o.Transform.posX, z: o.Transform.posZ }));
  ok("life fit: precondition, the save's twelve commander-damage icons", icons.length === 12, icons.length);
  for (const [color, guid] of Object.entries(TRACKER)) {
    const t = save.ObjectStates.find((o) => o.GUID === guid).Transform;
    for (const k of looks) {
      // the number's half-width on the table, centred on the counter (its button at x 0), its height the font's
      const half = (k.letters * 0.583 * k.font) / 2 / 480 * t.scaleX, halfZ = k.font / 2 / 480 * t.scaleZ;
      const cz = t.posZ + (t.rotY > 90 ? 0.3 : -0.3) * t.scaleZ;
      const hit = icons.filter((c) => Math.abs(c.x - t.posX) < half + 0.6 && Math.abs(c.z - cz) < halfZ + 0.6);
      ok(`life fit, ${color}: "${k.label}" at ${k.font} clear of the commander-damage icons`, hit.length === 0, JSON.stringify({ half, hit }));
    }
  }
  ok("life fit: no label wider than 3 letters at the counter's 1000", looks.every((k) => k.letters * k.font <= 3000), JSON.stringify(looks));
}
// a counter badge
{
  const cards = { cr1: { n: "Hydra", f: ART("cr1"), b: "", tl: "Creature", ty: ["Creature"], p: 0, t: 0, bp: 0, bt: 0 } };
  const r = run([board({ blue: { battlefield: [{ s: 1, id: "cr1", ctl: "Blue", dmg: 0, ctr: { P1P1: 12345 }, p: 12345, t: 12345 }] }, cards }), OBJECTS("objs")]);
  ok("badge: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  const hydra = byId(json(r, "objs"), "cr1");
  ok("badge: +12.3K/+12.3K on the counters badge", hydra && hydra.buttons.includes("+12.3K/+12.3K"), JSON.stringify(hydra && hydra.buttons));
  ok("badge: the power/toughness badge 12.3K/12.3K", hydra && hydra.buttons.includes("12.3K/12.3K"), JSON.stringify(hydra && hydra.buttons));
}

// ───────── 2. the mana pool ─────────
{
  const CHIPS = (mark) => q(`local out = {} for _, b in ipairs(getObjectFromGUID("${TRACKER.Blue}").getButtons() or {}) do if enginePoolIsChip(b) then out[#out + 1] = { label = b.label, tip = b.tooltip, w = b.width, f = b.font_size } end end return JSON.encode(out)`, mark);
  const STATUS = (mark) => q('return tostring(UI.getValue("eng_status_Blue"))', mark);
  const PRIO = ask({ promptId: 901, kind: "priority", title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }, { id: "__endturn", label: "End turn" }] });
  const r = run([board({ blue: { pool: { G: 150, R: 6 } } }), PRIO, q('onMtgToggle(Player.Blue, nil, "eng_toggle_Blue") return "open"', "open"), CHIPS("150"), STATUS("status 150"),
    board({ blue: { pool: { G: 5000 } } }), CHIPS("5000"), board({ blue: { pool: { G: 99 } } }), CHIPS("99"),
    board({ blue: { pool: { G: 999 } } }), CHIPS("999"), board({ blue: { pool: { G: 1000 } } }), CHIPS("1000")]);
  ok("pool: 999 is G999 (the most said as is)", ((json(r, "999") || [])[0] || {}).label === "G999", valueOf(r, "999"));
  ok("pool: 1000 is G999+", ((json(r, "1000") || [])[0] || {}).label === "G999+", valueOf(r, "1000"));
  ok("pool: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  const c150 = json(r, "150") || [];
  ok("pool: G150 on its chip, R6 beside it", c150.map((c) => c.label).join(" ") === "R6 G150", JSON.stringify(c150));
  ok("pool: G150 fits its chip (a smaller font)", c150.length === 2 && c150.every((c) => c.label.length * 0.583 * c.f <= c.w), JSON.stringify(c150));
  const st = String(valueOf(r, "status 150"));
  ok("pool: the panel says RRRRRR G×150", st.includes("Your mana pool: RRRRRR G×150"), st);
  const c5000 = json(r, "5000") || [];
  ok("pool: 5000 reads G999+ on its chip", c5000.length === 1 && c5000[0].label === "G999+", JSON.stringify(c5000));
  ok("pool: G999+ fits its chip", c5000.length === 1 && c5000[0].label.length * 0.583 * c5000[0].f <= c5000[0].w, JSON.stringify(c5000));
  ok("pool: the hover says 5000 green", c5000.length === 1 && c5000[0].tip.includes("5000 green"), JSON.stringify(c5000));
  const c99 = json(r, "99") || [];
  ok("pool: G99 as before (font 160)", c99.length === 1 && c99[0].label === "G99" && c99[0].f === 160, JSON.stringify(c99));
}

// ───────── 3. the stack ─────────
{
  // abilities with no source on the table: each is a card of its own (as storm copies and dead creatures' triggers)
  const item = (n, ctl = "Blue") => ({ id: n, n: `Grapeshot copy ${n}`, ctl, tx: "Grapeshot deals 1 damage to any target.", f: ART("gs") });
  const stack30 = Array.from({ length: 30 }, (_, i) => item(i + 1));
  const stack8 = stack30.slice(0, 8);
  const STATUS = (mark) => q('return tostring(UI.getValue("eng_status_Blue"))', mark);
  const PRIO = ask({ promptId: 902, kind: "priority", title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Resolve" }, { id: "__endturn", label: "End turn" }] });
  const r = run([board({ stack: stack8 }), OBJECTS("eight"), board({ stack: [...stack30, item(31, "White")] }), PRIO, q('onMtgToggle(Player.Blue, nil, "eng_toggle_Blue") return "open"', "open"),
    OBJECTS("thirty"), STATUS("status"), board({ stack: stack8 }), OBJECTS("back")]);
  ok("stack: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  const stackOf = (list, color) => (list || []).filter((o) => o.id.startsWith("stack:") && (color === "White" ? /31$/.test(o.id) || o.id === "stack:more:White" : !/^stack:31$/.test(o.id) && o.id !== "stack:more:White"));
  const eight = stackOf(json(r, "eight"), "Blue");
  ok("stack: 8 from one caster are 8 cards, no fold", eight.length === 8 && !eight.some((o) => o.id === "stack:more:Blue"), eight.map((o) => o.id).join(" "));
  // as before: spot n at 1.4 (n - 1) - 2 along the mat's right, 1.4 apart
  const xs = eight.sort((a, b) => Number(a.id.slice(6)) - Number(b.id.slice(6))).map((o) => o.x);
  ok("stack: 8 lie 1.4 apart, as before", xs.length === 8 && xs.every((x, i) => i === 0 || Math.abs(Math.abs(x - xs[i - 1]) - 1.4) < 1e-6), JSON.stringify(xs));
  const thirty = stackOf(json(r, "thirty"), "Blue");
  const more = thirty.find((o) => o.id === "stack:more:Blue");
  ok("stack: 30 from one caster are 9 objects, 8 and the fold", thirty.length === 9 && !!more, thirty.map((o) => o.id).join(" "));
  ok("stack: the top 8 are drawn (23 to 30)", thirty.filter((o) => o !== more).map((o) => Number(o.id.slice(6))).sort((a, b) => a - b).join(",") === "23,24,25,26,27,28,29,30", thirty.map((o) => o.id).join(" "));
  ok("stack: the fold reads +22 more on the stack", more && more.name.startsWith("+22 more on the stack"), more && more.name);
  ok("stack: the fold's hover names the folded ones, top first, 20 then ... and 2 more", more && more.desc.includes("top first: Grapeshot copy 22, Grapeshot copy 21") && more.desc.includes("... and 2 more"), more && more.desc);
  ok("stack: the fold has the count badge x22", more && more.buttons.includes("x22"), more && JSON.stringify(more.buttons));
  const off = thirty.filter((o) => !inMat(o));
  ok("stack: every one of the 9 lies on a mat", mats.length === 4 && off.length === 0, off.map((o) => `${o.id} ${o.x.toFixed(1)},${o.z.toFixed(1)}`).join(" | "));
  const spread = Math.max(...thirty.map((o) => o.x)) - Math.min(...thirty.map((o) => o.x));
  ok("stack: the 9 span 8 steps of 1.4", Math.abs(spread - 8 * 1.4) < 1e-6, spread);
  const white = stackOf(json(r, "thirty"), "White");
  ok("stack: the other caster's one card is its own, no fold", white.length === 1 && white[0].id === "stack:31", white.map((o) => o.id).join(" "));
  const st = String(valueOf(r, "status"));
  ok("stack: the status line names the top 8, then ... and 23 more", /Stack \(top first\): Grapeshot copy 31, Grapeshot copy 30, .* \.\.\. and 23 more/.test(st) && (st.match(/Grapeshot copy/g) || []).length === 8, st);
  const back = stackOf(json(r, "back"), "Blue");
  ok("stack: back to 8, the fold is gone", back.length === 8 && !back.some((o) => o.id === "stack:more:Blue"), back.map((o) => o.id).join(" "));
}

// ───────── 4. fans ─────────
{
  const cards = { host: { n: "Sram", f: ART("host"), b: "", tl: "Creature", ty: ["Creature"] }, gonti: { n: "Gonti", f: ART("gonti"), b: "", tl: "Creature", ty: ["Creature"] } };
  for (let i = 1; i <= 30; i++) { cards[`au${i}`] = { n: `Aura ${i}`, f: ART(`au${i}`), b: "", tl: "Enchantment - Aura", ty: ["Enchantment"] }; cards[`ex${i}`] = { n: `Exiled ${i}`, f: ART(`ex${i}`), b: "", tl: "Sorcery", ty: ["Sorcery"] }; }
  const bf = (auras) => [{ s: 1, id: "host", ctl: "Blue", dmg: 0, ctr: {} }, { s: 1, id: "gonti", ctl: "Blue", dmg: 0, ctr: {} },
    ...Array.from({ length: auras }, (_, i) => ({ s: 1, id: `au${i + 1}`, ctl: "Blue", dmg: 0, ctr: {}, att: "host" }))];
  const ex = (k) => Array.from({ length: k }, (_, i) => ({ id: `ex${i + 1}`, ew: "gonti" }));
  const r = run([board({ blue: { battlefield: bf(30), exile: ex(30) }, cards }), OBJECTS("thirty"), board({ blue: { battlefield: bf(6), exile: ex(8) }, cards }), OBJECTS("few")]);
  ok("fans: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  const far = (list, host, prefix, k) => { const h = byId(list, host); const fan = (list || []).filter((o) => o.id.startsWith(prefix)); return { n: fan.length, d: h ? Math.max(...fan.map((o) => Math.hypot(o.x - h.x, o.z - h.z))) : NaN, fan, h }; };
  const a30 = far(json(r, "thirty"), "host", "au", 30), l30 = far(json(r, "thirty"), "gonti", "ex", 30);
  ok("fans: 30 auras all drawn", a30.n === 30, a30.n);
  ok("fans: 30 auras within 6 units of their host (the 30th was 28 away)", a30.d <= 6, a30.d);
  ok("fans: 30 linked cards all drawn", l30.n === 30, l30.n);
  ok("fans: 30 linked cards within 4.5 of their host (they reached 11)", l30.d <= 4.5, l30.d);
  const a6 = far(json(r, "few"), "host", "au", 6), l8 = far(json(r, "few"), "gonti", "ex", 8);
  const steps = (fan) => fan.map((o) => o).sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2))).map((o, i, all) => (i ? Math.hypot(o.x - all[i - 1].x, o.z - all[i - 1].z) : null)).slice(1);
  ok("fans: 6 auras 1.0 apart, as before", a6.n === 6 && steps(a6.fan).every((d) => Math.abs(d - 1.0) < 1e-6), JSON.stringify(steps(a6.fan)));
  ok("fans: 8 linked cards 0.35 apart on each axis, as before", l8.n === 8 && steps(l8.fan).every((d) => Math.abs(d - 0.35 * Math.SQRT2) < 1e-6), JSON.stringify(steps(l8.fan)));
}

// ───────── 5. the number row ─────────
{
  const BTNS = (mark) => q('local out = {} for k = 1, ROW_BTNS do out[k] = tostring(UI.getAttribute("eng_rowopt_Blue_" .. k, "text") or UI.getValue("eng_rowopt_Blue_" .. k)) end return table.concat(out, "|")', mark);
  const press = (k) => `onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_${k}")`;
  const VALUE = (mark) => q("return tostring(engineNumber.Blue and engineNumber.Blue.value)", mark);
  const SUB = (mark) => q('return tostring(UI.getValue("eng_rowsub_Blue"))', mark);
  const r = run([board(), ask({ promptId: 903, kind: "number", title: "Torment of Hailfire: choose X", mode: "number", min: 0, max: 999, text: "999 is the most the table offers." }), BTNS("wide"), SUB("sub"),
    q(press(2), "+1"), VALUE("v1"), q(press(3), "step"), BTNS("step 10"), q(`${press(2)} ${press(2)}`, "+10 +10"), VALUE("v21"), q(press(3), "step 100"), q(press(2), "+100"), VALUE("v121"),
    q(press(1), "-100"), VALUE("v21b"), q(press(4), "max"), VALUE("v999"), BTNS("at max"), q(press(4), "min"), VALUE("v0"), q(press(3), "back to 1"), BTNS("step 1"),
    // (the line's "type the number in the Engine panel's search": 150 typed there lists 150 first)
    q('onMtgToggle(Player.Blue, nil, "eng_toggle_Blue") onMtgSearch(Player.Blue, "150", "eng_search_Blue") return tostring(UI.getAttribute("eng_opt_Blue_1", "text") or UI.getValue("eng_opt_Blue_1"))', "search"),
    ask({ promptId: 904, kind: "number", title: "Choose X", mode: "number", min: 0, max: 5 }), BTNS("narrow"), q(`${press(2)} ${press(2)}`, "narrow +2"), VALUE("n2")]);
  ok("number row: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("number row: 0..999 shows -1 +1 Step 10 Max OK: 0", valueOf(r, "wide") === "-1|+1|Step 10|Max|OK: 0", valueOf(r, "wide"));
  ok("number row: its line says the step and the search", /Step 1; or type the number in the Engine panel's search/.test(String(valueOf(r, "sub"))), valueOf(r, "sub"));
  ok("number row: +1 makes 1", valueOf(r, "v1") === "1", valueOf(r, "v1"));
  ok("number row: Step turns it to 10 (-10 +10 Step 100)", valueOf(r, "step 10") === "-10|+10|Step 100|Max|OK: 1", valueOf(r, "step 10"));
  ok("number row: +10 twice makes 21", valueOf(r, "v21") === "21", valueOf(r, "v21"));
  ok("number row: step 100, +100 makes 121", valueOf(r, "v121") === "121", valueOf(r, "v121"));
  ok("number row: -100 makes 21", valueOf(r, "v21b") === "21", valueOf(r, "v21b"));
  ok("number row: Max makes 999", valueOf(r, "v999") === "999", valueOf(r, "v999"));
  ok("number row: at 999, Max turns to Min", String(valueOf(r, "at max")).split("|")[3] === "Min", valueOf(r, "at max"));
  ok("number row: Min makes 0", valueOf(r, "v0") === "0", valueOf(r, "v0"));
  ok("number row: Step past 100 goes back to 1", String(valueOf(r, "step 1")).startsWith("-1|+1|Step 10|"), valueOf(r, "step 1"));
  ok("number row: 150 typed in the Engine panel's search lists 150 first", valueOf(r, "search") === "150", valueOf(r, "search"));
  ok("number row: 0..5 as before, - + Min Max", valueOf(r, "narrow") === "-|+|Min|Max|OK: 0", valueOf(r, "narrow"));
  ok("number row: 0..5's + goes by 1", valueOf(r, "n2") === "2", valueOf(r, "n2"));
}

console.log(`${failed ? failed + " failed, " : ""}${failed ? "" : "all "}${passed} passed`);
process.exit(failed ? 1 : 0);
