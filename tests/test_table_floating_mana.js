// Floating mana you can see at a glance (PLAN.md 2026-11-13; tools/engine-renderer.lua enginePoolChips,
// enginePoolTotal, engineUpdateCorner): each player's pool is a row of chips on their life counter, between the heart
// and their mat, one a colour that has mana (W U B R G C order, "G2"), hidden while the pool is empty, redrawn only
// when it changes, gone when the game's counters go; everyone's pool shows, an AI's too. The pass button says how much
// you have floating ("Next (3 floating)"). Boards are made up here (two players: Blue seated, White an AI), as the
// bridge sends them (bridge.js: a row's `pool` is { W = n, ... } without the empty colours, or null for another
// player's empty pool); the geometry check puts six chips on all four trackers of the save.
//   node tests/test_table_floating_mana.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const q = (lua, mark, frames) => ({ lua, mark, ...(frames != null ? { frames } : {}) });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const fxOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).fx || [];
const json = (r, mark) => { try { return JSON.parse(String(valueOf(r, mark))); } catch (e) { return null; } };

const TRACKER = { Blue: "395037", White: "23e485", Red: "448880", Yellow: "37e533" };
const cards = { bl1: { n: "Forest", f: "https://example.invalid/bl1.jpg", b: "", tl: "Land", ty: ["Land"] } };
// a board with Blue's and White's pools (undefined: {} for Blue, null for White, as the bridge sends an empty one)
function board(bluePool, whitePool, extra = {}) {
  const pl = (color, slot, pool) => ({
    color, slot, name: color === "White" ? "AI 1" : color, ai: color === "White", life: 40, status: "playing", pool, poison: 0, energy: 0,
    cmdDamage: {}, tax: [0, 0], library: 50, handCount: 0, hand: color === "Blue" ? [] : null,
    battlefield: color === "Blue" ? [{ s: 1, id: "bl1", ctl: color, dmg: 0, ctr: {} }] : [], graveyard: [], exile: [], command: [],
  });
  return { msg: { t: "table", json: JSON.stringify({ t: "table", turn: 3, step: "main1", active: "Blue", activeTurnNo: 2, priority: "Blue", gameOver: false,
    winner: null, players: [pl("Blue", "player-0", bluePool ?? {}), pl("White", "player-1", whitePool ?? null)], stack: [], cards, ...extra }) }, frames: 20 };
}
const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "Blue", "player-1": "White" }, names: { "player-0": "Blue", "player-1": "AI 1" }, ai: ["White"] });
const PRELUDE = 'engineAutoPace.Blue = false engineChat("mtg start ai 1", Player.Blue) return "ok"';
const ask = (p) => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", ...p }) }, frames: 5 });
const PRIO = (id, label = "Next") => ask({ promptId: id, kind: "priority", title: "Your priority", mode: "single", options: [{ id: "__pass", label }, { id: "__endturn", label: "End turn" }] });
// the chips on a seat's tracker: { label, tip, x, z, w, h, color } each, in button order
const CHIPS = (color, mark) => q(`local out = {} for _, b in ipairs(getObjectFromGUID("${TRACKER[color]}").getButtons() or {}) do if enginePoolIsChip(b) then local p = b.position or {} out[#out + 1] = { label = b.label, tip = b.tooltip, x = p[1] or p.x, z = p[3] or p.z, w = b.width, h = b.height, c = b.color } end end return JSON.encode(out)`, mark);
const BIG = (mark) => q('engineUpdateCorner("Blue", enginePrompts.Blue) return tostring(UI.getAttribute("eng_big_Blue", "text") or UI.getValue("eng_big_Blue"))', mark);
const run = (steps) => simulate({ save, steps: [q(PRELUDE, "prelude"), { msg: { t: "started", json: STARTED } }, ...steps] });
const labels = (list) => (Array.isArray(list) ? list.map((c) => c.label).join(" ") : "none read");

// the pools along a game, with Blue's pass button
{
  const r = run([
    board({}, null), { ...PRIO(901), mark: "ask empty" }, CHIPS("Blue", "blue empty"), CHIPS("White", "white empty"), BIG("big empty"),
    board({ G: 2 }, null), CHIPS("Blue", "blue green"), BIG("big green"),
    { ...board({ G: 2 }, null), mark: "same board" },
    board({ W: 1, U: 2, C: 3 }, null), CHIPS("Blue", "blue three"), BIG("big three"),
    board({}, { R: 2, B: 1 }), CHIPS("Blue", "blue theirs"), CHIPS("White", "white theirs"), BIG("big theirs"),
    board({ G: 1 }, { R: 2, B: 1 }), PRIO(902, "Resolve"), BIG("big resolve"),
    ask({ promptId: 903, kind: "cards", title: "Choose up to two creatures", mode: "multi", min: 0, max: 2, options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }), BIG("big multi"),
    ask({ promptId: 904, kind: "choice", title: "Pay {1}?", mode: "single", options: [{ id: "yes", label: "Pay" }, { id: "no", label: "Don't" }] }), BIG("big other"),
    board({}, null), PRIO(905), CHIPS("Blue", "blue emptied"), CHIPS("White", "white emptied"), BIG("big emptied"),
  ]);
  ok("pools: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("empty pool: no chips on Blue's counter", Array.isArray(json(r, "blue empty")) && json(r, "blue empty").length === 0, valueOf(r, "blue empty"));
  ok("empty pool: none on the AI's (its empty pool comes as null)", Array.isArray(json(r, "white empty")) && json(r, "white empty").length === 0, valueOf(r, "white empty"));
  ok("empty pool: the pass button says only Next", valueOf(r, "big empty") === "Next", valueOf(r, "big empty"));
  const green = json(r, "blue green") || [];
  ok("one colour: one chip, G2, green, centred on the heart", labels(green) === "G2" && green[0].x === 0 && green[0].z === 1.5 && green[0].c[1] > green[0].c[0] && green[0].c[1] > green[0].c[2], valueOf(r, "blue green"));
  ok("one colour: its hover text names the player and the mana", green[0] && green[0].tip.startsWith("Floating mana in Blue's pool: 2 green.") && /Everyone sees every pool/.test(green[0].tip), green[0] && green[0].tip);
  ok("one colour: the pass button says Next (2 floating)", valueOf(r, "big green") === "Next (2 floating)", valueOf(r, "big green"));
  const same = fxOf(r, "same board").filter((l) => /(create|edit|remove)Button/.test(l) && /\b[WUBRGC]\d+\b/.test(l));
  ok("unchanged pool: the next board draws no chip again", same.length === 0, same.slice(0, 3).join(" | "));
  const three = json(r, "blue three") || [];
  ok("several colours: W1 U2 C3, in W U B R G C order, left to right as their owner reads them", labels(three) === "W1 U2 C3" && three[0].x < three[1].x && three[1].x < three[2].x, valueOf(r, "blue three"));
  ok("several colours: the row is centred on the heart, the chips apart", three.length === 3 && Math.abs(three[0].x + three[2].x) < 1e-9 && three[1].x - three[0].x > three[0].w / 480, valueOf(r, "blue three"));
  ok("several colours: colourless is grey, white is light", three.length === 3 && Math.abs(three[2].c[0] - three[2].c[2]) < 0.1 && three[0].c[0] > 0.9, JSON.stringify(three.map((c) => c.c)));
  ok("several colours: the hover text lists each", three[0] && three[0].tip.startsWith("Floating mana in Blue's pool: 1 white, 2 blue, 3 colourless."), three[0] && three[0].tip);
  ok("several colours: the pass button counts them all, Next (6 floating)", valueOf(r, "big three") === "Next (6 floating)", valueOf(r, "big three"));
  ok("another player's pool: the AI's B1 R2 on its own counter", labels(json(r, "white theirs")) === "B1 R2", valueOf(r, "white theirs"));
  ok("another player's pool: its hover text names the AI", (json(r, "white theirs") || [])[0]?.tip.startsWith("Floating mana in AI 1's pool: 1 black, 2 red."), valueOf(r, "white theirs"));
  ok("another player's pool: Blue's own chips went when Blue's pool emptied", Array.isArray(json(r, "blue theirs")) && json(r, "blue theirs").length === 0, valueOf(r, "blue theirs"));
  ok("another player's pool: Blue's pass button counts only Blue's own", valueOf(r, "big theirs") === "Next", valueOf(r, "big theirs"));
  ok("pass button: Resolve says it too, Resolve (1 floating)", valueOf(r, "big resolve") === "Resolve (1 floating)", valueOf(r, "big resolve"));
  ok("other buttons: a pick's Done has no count", !/floating/.test(String(valueOf(r, "big multi"))), valueOf(r, "big multi"));
  ok("other buttons: a question's first answer has no count", valueOf(r, "big other") === "Pay", valueOf(r, "big other"));
  ok("pool emptied: Blue's chips are gone", Array.isArray(json(r, "blue emptied")) && json(r, "blue emptied").length === 0, valueOf(r, "blue emptied"));
  ok("pool emptied: the AI's are gone", Array.isArray(json(r, "white emptied")) && json(r, "white emptied").length === 0, valueOf(r, "white emptied"));
  ok("pool emptied: the pass button says Next again", valueOf(r, "big emptied") === "Next", valueOf(r, "big emptied"));
}

// a counter that lost its buttons (its own onload clears them) gets the chips back on the next board; the end of the
// game takes them away and leaves a button of the counter's own
{
  const r = run([
    board({ R: 1 }, null), q(`getObjectFromGUID("${TRACKER.Blue}").clearButtons() return "cleared"`, "cleared"),
    board({ R: 1 }, null), CHIPS("Blue", "back"),
    q(`getObjectFromGUID("${TRACKER.Blue}").createButton({ click_function = "engineNoop", function_owner = Global, label = "OWN" }) return "own"`, "own"),
    board({ R: 1, G: 4 }, null), CHIPS("Blue", "two"),
    q(`engineCountersReset() local n = {} for _, b in ipairs(getObjectFromGUID("${TRACKER.Blue}").getButtons() or {}) do n[#n + 1] = b.label end return table.concat(n, ",")`, "reset"),
    board({ R: 1 }, null), CHIPS("Blue", "after reset"),
  ]);
  ok("redraw: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("redraw: a counter that lost its buttons shows the chip again with the same pool", labels(json(r, "back")) === "R1", valueOf(r, "back"));
  ok("redraw: a second colour is added beside it", labels(json(r, "two")) === "R1 G4", valueOf(r, "two"));
  ok("game end: engineCountersReset takes the chips away and keeps the counter's own button", valueOf(r, "reset") === "OWN", valueOf(r, "reset"));
  ok("game end: the next game's first board draws them again", labels(json(r, "after reset")) === "R1", valueOf(r, "after reset"));
}

// Fit: six colours on all four trackers of the save, with the longest marks and an extra turn beside them. Each chip
// lies in the strip between its counter and its own mat (not on any mat), meets none of the counter's own buttons (read
// from its script, as test_table_claims "badge fit"; the life-change line at its shown size, engineLifeChange 760 x 440),
// no marks box, no extra-turn badge, no commander-damage icon, and no other chip, its own seat's or another's.
{
  const SEATS = Object.fromEntries(Object.entries(TRACKER).map(([c, g]) => [g, c]));
  const buttonBox = (t, b) => {
    const a = (t.ry * Math.PI) / 180, hw = (b.w * (b.scx ?? 1)) / 2 / 480, hh = (b.h * (b.scz ?? 1)) / 2 / 480;
    const xs = [], zs = [];
    for (const [lx, lz] of [[b.bx - hw, b.bz - hh], [b.bx + hw, b.bz - hh], [b.bx - hw, b.bz + hh], [b.bx + hw, b.bz + hh]]) {
      xs.push(t.x + t.sx * lx * -Math.cos(a) + t.sz * lz * Math.sin(a));
      zs.push(t.z + t.sx * lx * Math.sin(a) + t.sz * lz * Math.cos(a));
    }
    return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  };
  const meets = (a, b) => a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3];
  const icons = save.ObjectStates.filter((o) => o.Nickname === "Commander Damage").map((o) => ({ g: o.GUID, box: [o.Transform.posX - 0.6, o.Transform.posX + 0.6, o.Transform.posZ - 0.6, o.Transform.posZ + 0.6] }));
  const mats = save.ObjectStates.filter((o) => o.Name === "ScriptingTrigger" && o.Transform.scaleX > 30)
    .map((o) => { const t = o.Transform; return [t.posX - t.scaleX / 2, t.posX + t.scaleX / 2, t.posZ - t.scaleZ / 2, t.posZ + t.scaleZ / 2]; });
  ok("fit: precondition, the save's twelve commander-damage icons and four mat zones", icons.length === 12 && mats.length === 4, `${icons.length} icons, ${mats.length} mats`);
  const own = {};
  for (const g of Object.keys(SEATS)) {
    const src = String((save.ObjectStates.find((o) => o.GUID === g) || {}).LuaScript || "");
    const num = (re) => { const m = re.exec(src); return m ? m.slice(1).map(Number) : null; };
    const X = num(/^x=([-\d.]+)\s*$/m), Z = num(/^z=([-\d.]+)\s*$/m), SC = num(/^scale\s*=\s*\{([\d.]+),1,([\d.]+)\}/m), SC2 = num(/^scale2\s*=\s*\{([\d.]+),1,([\d.]+)\}/m);
    const MAIN = num(/-- the main button[\s\S]*?height=(\d+),\s*width=(\d+),[\s\S]*?position=\{0,y,z\}/);
    const CHANGE = num(/-- moved the change value[\s\S]*?position=\{0-([\d.]+),y,z\+([\d.]+)\}/);
    const SHOWN = num(/function engineLifeChange[\s\S]*?index = 1, width = (\d+), height = (\d+),/);
    const SIDE = num(/-- the side buttons[\s\S]*?height=(\d+),\s*width=(\d+),/);
    const SIDES = [...src.matchAll(/\{n=-?\d+,l='[^']*',p=\{(-?)x\*?([\d.]*),y,z([+-][\d.]+)\}\}/g)].map((m) => [(m[1] ? -1 : 1) * (m[2] === "" ? 1 : Number(m[2])), Number(m[3])]);
    const RST = num(/-- reset life to 40 button[\s\S]*?position=\{x\*([\d.]+),y,z-([\d.]+)\},\s*height=(\d+),\s*width=(\d+),/);
    const all = [X, Z, SC, SC2, MAIN, CHANGE, SHOWN, SIDE, RST];
    ok(`fit, ${SEATS[g]}: precondition, the counter's own buttons read from its script (four side buttons)`, all.every(Boolean) && SIDES.length === 4, JSON.stringify([...all, SIDES]));
    if (!all.every(Boolean)) continue;
    own[g] = {
      "the life number": { bx: 0, bz: Z[0], w: MAIN[1], h: MAIN[0], scx: SC[0], scz: SC[1] },
      "the life-change line": { bx: -CHANGE[0], bz: Z[0] + CHANGE[1], w: SHOWN[0], h: SHOWN[1], scx: SC[0], scz: SC[1] },
      "the [R]": { bx: X[0] * RST[0], bz: Z[0] - RST[1], w: RST[3], h: RST[2], scx: SC2[0], scz: SC2[1] },
    };
    SIDES.forEach(([mx, dz], i) => { own[g][`side button ${i + 1}`] = { bx: X[0] * mx, bz: Z[0] + dz, w: SIDE[1], h: SIDE[0], scx: SC2[0], scz: SC2[1] }; });
  }
  const MARKS = ["TURN RUN BY YELLOW", "RING TEMPTED 4", "SPEED 4 (MAX)", "MONARCH", "YOU CAN'T LOSE THE GAME"];
  const SIX = { W: 12, U: 3, B: 10, R: 99, G: 7, C: 20 };
  const four = `{ ${Object.values(TRACKER).map((g) => `"${g}"`).join(", ")} }`;
  const set = `for _, g in ipairs(${four}) do local o = getObjectFromGUID(g) enginePlayerCounters(o, JSON.decode([==[${JSON.stringify({ allMarks: MARKS })}]==])) engineExtraTurnBadge(o, { extraTurns = 10, name = "P" }) enginePoolChips(o, JSON.decode([==[${JSON.stringify({ name: "P", pool: SIX })}]==])) end return "set"`;
  const read = `local out = {} for _, g in ipairs(${four}) do local o = getObjectFromGUID(g) local p, r, s = o.getPosition(), o.getRotation(), o.getScale() local row = { g = g, x = p.x, z = p.z, ry = r.y, sx = s.x, sz = s.z, chips = {}, others = {} } for _, b in ipairs(o.getButtons() or {}) do local q = b.position or {} local e = { label = b.label, w = b.width, h = b.height, f = b.font_size, bx = q[1] or q.x, bz = q[3] or q.z } if enginePoolIsChip(b) then row.chips[#row.chips + 1] = e else row.others[#row.others + 1] = e end end out[#out + 1] = row end return JSON.encode(out)`;
  const r = simulate({ save, steps: [q(set, "set"), q(read, "read")] });
  ok("fit: precondition, no script error", !r.errors.length, r.errors.slice(0, 2).join(" | "));
  const rows = json(r, "read") || [];
  ok("fit: precondition, four trackers, each with six chips, five marks and a badge", rows.length === 4 && rows.every((t) => t.chips.length === 6 && t.others.length === 6), String(valueOf(r, "read")).slice(0, 300));
  const every = [];
  for (const t of rows) {
    const seat = SEATS[t.g], world = t.chips.map((c) => ({ who: `${seat} ${c.label}`, box: buttonBox(t, c) }));
    every.push(...world);
    ok(`fit, ${seat}: six chips in W U B R G C order with their amounts`, labels(t.chips) === "W12 U3 B10 R99 G7 C20", labels(t.chips));
    // (TTS's button text is about 0.583 of its font size a letter, as engineMarksWidth reckons it)
    const tight = t.chips.filter((c) => c.label.length * 0.583 * c.f > c.w);
    ok(`fit, ${seat}: each chip's label fits its width`, tight.length === 0, JSON.stringify(tight));
    const onMat = world.filter((w) => mats.some((m) => meets(w.box, m)));
    ok(`fit, ${seat}: no chip lies on a mat`, onMat.length === 0, onMat.map((w) => `${w.who} ${w.box.map((n) => n.toFixed(2))}`).join(" | "));
    const sideOf = world.filter((w) => Math.sign(w.box[2] + w.box[3]) !== Math.sign(t.z) || Math.abs(w.box[2] + w.box[3]) / 2 < Math.abs(t.z));
    ok(`fit, ${seat}: every chip lies between the counter and its own mat`, sideOf.length === 0, sideOf.map((w) => w.who).join(" "));
    for (const [what, o] of Object.entries(own[t.g] || {})) {
      const hit = world.filter((w) => meets(w.box, buttonBox(t, o)));
      ok(`fit, ${seat}: clear of ${what}`, hit.length === 0, hit.map((w) => w.who).join(" "));
    }
    const under = world.filter((w) => t.others.some((m) => meets(w.box, buttonBox(t, m))));
    ok(`fit, ${seat}: clear of every marks box and the extra-turn badge`, under.length === 0, under.map((w) => w.who).join(" "));
    const icon = world.filter((w) => icons.some((c) => meets(w.box, c.box)));
    ok(`fit, ${seat}: clear of every commander-damage icon`, icon.length === 0, icon.map((w) => w.who).join(" "));
  }
  const clash = [];
  for (let i = 0; i < every.length; i++) for (let j = i + 1; j < every.length; j++) if (meets(every[i].box, every[j].box)) clash.push(`${every[i].who} / ${every[j].who}`);
  ok("fit: no two chips meet on the table, one seat's or two seats'", every.length === 24 && clash.length === 0, clash.slice(0, 4).join(" | "));
}

console.log(`${failed ? failed + " failed, " : ""}${failed ? "" : "all "}${passed} passed`);
process.exit(failed ? 1 : 0);
