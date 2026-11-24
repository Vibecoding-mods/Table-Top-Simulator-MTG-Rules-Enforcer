// Floating mana on the original table's mana counters (2026-11-24; tools/make-engine-copy.js ENGINE_MANA_PIECES,
// tools/engine-renderer.lua engineManaCounters): the user asked for the original's W U B R G C counters in place of the
// chips. The built table keeps one counter per seat per colour, parked under the table, locked, faded, without its
// script; a board puts a seat's six in the chips' row on its life counter, one fixed slot a colour, each scaled to fit
// its slot; a colour with mana shows (alpha 1) with its number, above 99 a black box with the real amount instead; a
// colour at 0 is at opacity 0 with no number; they are never interactable; nothing changes on an unchanged board; the
// game's end and engine mode off park them again, and so does a load. Boards are made up (Blue seated, White an AI),
// as tests/test_table_floating_mana.js makes them.
//   node tests/test_table_mana_counters.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const q = (lua, mark, frames) => ({ lua, mark, ...(frames != null ? { frames } : {}) });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const fxOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).fx || [];
const json = (r, mark) => { try { return JSON.parse(String(valueOf(r, mark))); } catch (e) { return null; } };

const ORDER = ["W", "U", "B", "R", "G", "C"];
const TRACKER = { Blue: "395037", White: "23e485", Red: "448880", Yellow: "37e533" };
const SEATS = Object.keys(TRACKER);

// ───────── the built table ─────────
const script = save.LuaScript || "";
const at = script.indexOf("ENGINE_MANA_PIECES = {");
const block = at < 0 ? "" : script.slice(at, script.indexOf("\n}\n", at));
const entries = {};
for (const k of ORDER) {
  const m = new RegExp(`\\n  ${k} = \\{ scale = ([\\d.]+), y = (-?[\\d.]+),\\n    objs = \\{ (.*) \\} \\},`).exec(block);
  entries[k] = m ? { scale: Number(m[1]), y: Number(m[2]), objs: [...m[3].matchAll(/\{ g = "(\w+)", x = (-?[\d.]+), z = (-?[\d.]+), seat = "(\w+)" \}/g)].map((x) => ({ g: x[1], x: Number(x[2]), z: Number(x[3]), seat: x[4] })) } : null;
}
ok("build: the Global script has ENGINE_MANA_PIECES with all six colours", ORDER.every((k) => entries[k]), block.slice(0, 200));
const all = ORDER.flatMap((k) => (entries[k] ? entries[k].objs.map((e) => ({ ...e, k })) : []));
ok("build: one counter per seat per colour (four seats)", ORDER.every((k) => entries[k] && entries[k].objs.map((e) => e.seat).sort().join() === [...SEATS].sort().join()), JSON.stringify(ORDER.map((k) => entries[k] && entries[k].objs.length)));
const NAMES = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless" };
const objs = all.map((e) => ({ e, o: save.ObjectStates.find((o) => o.GUID === e.g) }));
const bad = objs.filter(({ e, o }) => !o || o.Nickname !== `${NAMES[e.k]} Mana Counter` || o.Name !== "Custom_Model" || !(o.CustomMesh && /steamusercontent/.test(o.CustomMesh.MeshURL)));
ok("build: every one is the original's counter model of its colour, in the table", all.length === 24 && bad.length === 0, bad.map(({ e }) => `${e.k} ${e.seat} ${e.g}`).join(" "));
const unparked = objs.filter(({ e, o }) => o && !(o.Transform.posY === -30 && o.Locked === true && o.ColorDiffuse && o.ColorDiffuse.a === 0 && o.LuaScript === "" && o.DragSelectable === false
  && Math.abs(o.Transform.posX - e.x) < 1e-3 && Math.abs(o.Transform.posZ - e.z) < 1e-3));
ok("build: each parked under the table at its listed spot, locked, faded (alpha 0), no script, out of drag-select", unparked.length === 0, unparked.map(({ e }) => `${e.k} ${e.seat}`).join(" "));
const guids = save.ObjectStates.map((o) => o.GUID);
ok("build: no GUID twice in the table", new Set(guids).size === guids.length, guids.length - new Set(guids).size);
ok("build: no mana-counter bag left (the counters came out of them)", !save.ObjectStates.some((o) => /Mana Counter/.test(o.Nickname || "") && o.Name === "Custom_Model_Infinite_Bag"));
ok("build: the Suspend counter is no mana counter (left out)", !save.ObjectStates.some((o) => /Suspend/.test(o.Nickname || "") && o.Transform.posY === -30));

// ───────── on the table ─────────
const cards = { bl1: { n: "Forest", f: "https://example.invalid/bl1.jpg", b: "", tl: "Land", ty: ["Land"] } };
function board(bluePool, whitePool) {
  const pl = (color, slot, pool) => ({
    color, slot, name: color === "White" ? "AI 1" : color, ai: color === "White", life: 40, status: "playing", pool, poison: 0, energy: 0,
    cmdDamage: {}, tax: [0, 0], library: 50, handCount: 0, hand: color === "Blue" ? [] : null,
    battlefield: color === "Blue" ? [{ s: 1, id: "bl1", ctl: color, dmg: 0, ctr: {} }] : [], graveyard: [], exile: [], command: [],
  });
  return { msg: { t: "table", json: JSON.stringify({ t: "table", turn: 3, step: "main1", active: "Blue", activeTurnNo: 2, priority: "Blue", gameOver: false,
    winner: null, players: [pl("White", "player-1", whitePool ?? null), pl("Blue", "player-0", bluePool ?? {})], stack: [], cards }) }, frames: 20 };
}
const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "Blue", "player-1": "White" }, names: { "player-0": "Blue", "player-1": "AI 1" }, ai: ["White"] });
const PRELUDE = 'engineAutoPace.Blue = false engineChat("mtg start ai 1", Player.Blue) return "ok"';
const run = (steps, s = save) => simulate({ save: s, steps: [q(PRELUDE, "prelude"), { msg: { t: "started", json: STARTED } }, ...steps] });
// a seat's six counters, in W U B R G C order: where, how big, alpha, hidden, interactable, locked, buttons
const COUNTERS = (color, mark) => q(`local out = {} for _, k in ipairs({ "W", "U", "B", "R", "G", "C" }) do local e = engineManaObj(k, "${color}") local o = e and getObjectFromGUID(e.g)
  if o ~= nil then local p, s, t = o.getPosition(), o.getScale(), o.getColorTint() local b = {} for _, x in ipairs(o.getButtons() or {}) do local bp = x.position or {}
  b[#b + 1] = { label = x.label, tip = x.tooltip, w = x.width, h = x.height, f = x.font_size, c = x.color, fc = x.font_color, z = bp[3] or bp.z } end
  out[#out + 1] = { k = k, g = e.g, x = p.x, y = p.y, z = p.z, s = s.x, a = t.a or 1, hidden = #(o.__d.invisibleTo or {}), inter = o.interactable, lock = o.getLock(), ry = o.getRotation().y, b = b } end end return JSON.encode(out)`, mark);
const CHIPS = (color, mark) => q(`local n = 0 for _, b in ipairs(getObjectFromGUID("${TRACKER[color]}").getButtons() or {}) do if enginePoolIsChip(b) then n = n + 1 end end return n`, mark);
const byK = (list, k) => (list || []).find((c) => c.k === k) || {};
// (the labels drawn: the hover's empty see-through button left out)
const labelsOf = (c) => (c.b || []).filter((b) => b.label !== "").map((b) => b.label).join(",");
// (the hover's button: the empty one with the tooltip)
const hoverOf = (c) => (c.b || []).find((b) => b.label === "" && b.tip) || {};

// the chips' world spots (the table without the counters: ENGINE_MANA_PIECES nil), each chip's centre
const chipSpots = (() => {
  const r = simulate({ save, steps: [q('ENGINE_MANA_PIECES = nil return "x"', "nil"), q(`local o = getObjectFromGUID("${TRACKER.Blue}") enginePoolChips(o, { name = "P", color = "Blue", pool = { W = 1, U = 1, B = 1, R = 1, G = 1, C = 1 } })
    local p, r, s = o.getPosition(), o.getRotation(), o.getScale() local a = math.rad(r.y) local out = {} for _, b in ipairs(o.getButtons() or {}) do if enginePoolIsChip(b) then local bp = b.position
    out[#out + 1] = { k = b.label:sub(1, 1), x = p.x + s.x * bp[1] * -math.cos(a) + s.z * bp[3] * math.sin(a), z = p.z + s.x * bp[1] * math.sin(a) + s.z * bp[3] * math.cos(a), w = b.width / 480 * s.x } end end return JSON.encode(out)`, "chips")] });
  return json(r, "chips") || [];
})();
ok("precondition: the chips' six spots on Blue's counter, read with the counters off", chipSpots.length === 6 && chipSpots.map((c) => c.k).join("") === ORDER.join(""), JSON.stringify(chipSpots));

{
  const r = run([
    board({ G: 2 }, null), COUNTERS("Blue", "green"), CHIPS("Blue", "chips green"), COUNTERS("White", "white none"),
    { ...board({ G: 2 }, null), mark: "same board" },
    { ...board({ G: 2, R: 1 }, null), mark: "add red" }, { ...board({ G: 2 }, null), mark: "red gone" },
    board({ W: 1, G: 2, C: 99 }, { R: 3 }), COUNTERS("Blue", "three"), COUNTERS("White", "white red"),
    board({ G: 150 }, { R: 3 }), COUNTERS("Blue", "150"),
    board({ G: 99 }, { R: 3 }), COUNTERS("Blue", "99 again"),
    board({}, null), COUNTERS("Blue", "emptied"), COUNTERS("White", "white emptied"),
    board({ U: 4 }, null), q("engineCountersReset() return 'reset'", "reset"), COUNTERS("Blue", "after reset"),
    board({ U: 4 }, null), COUNTERS("Blue", "next game"),
    q("setEngineMode(false) return 'off'", "off"), COUNTERS("Blue", "mode off"),
  ]);
  ok("table: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  const green = json(r, "green") || [];
  const g = byK(green, "G");
  ok("one colour: Blue has six counters", green.length === 6, valueOf(r, "green"));
  ok("one colour: its green counter shows (alpha 1, seen by all) with 2 on it as the original draws it (a shadow, the number)", g.a === 1 && g.hidden === 0 && labelsOf(g) === "2,2" && g.b.every((b) => b.f === 800), JSON.stringify(g));
  ok("one colour: the number reads light on a dark shadow", g.b && g.b[1].fc[0] > 0.8 && g.b[0].fc[0] < 0.2, JSON.stringify(g.b));
  ok("one colour: its hover names the player and the mana, and that the pool empties", String(hoverOf(g).tip).startsWith("Floating mana in Blue's pool: 2 green.") && /empties at the end of each step/.test(hoverOf(g).tip) && hoverOf(g).w > 0, JSON.stringify(hoverOf(g)));
  // (TTS fades a button's label with its background's alpha: a number on a see-through background never showed, live
  // 2026-11-24; the numbers have no background, w 0 and no colour)
  ok("one colour: the numbers have no background, so TTS draws them", (g.b || []).filter((b) => b.label !== "").every((b) => b.w === 0 && b.c == null), JSON.stringify(g.b));
  const others = green.filter((c) => c.k !== "G");
  ok("one colour: the other five are at opacity 0 (alpha 0, hidden from all) with no number", others.length === 5 && others.every((c) => c.a === 0 && c.hidden > 0 && c.b.length === 0), JSON.stringify(others.map((c) => [c.k, c.a, c.hidden, c.b.length])));
  ok("one colour: none of the six can be picked up or clicked (not interactable, locked)", green.every((c) => c.inter === false && c.lock === true), JSON.stringify(green.map((c) => [c.k, c.inter, c.lock])));
  ok("one colour: no chips on the life counter (the counters show the pool)", Number(valueOf(r, "chips green")) === 0, valueOf(r, "chips green"));
  const slotMiss = green.filter((c) => { const s = chipSpots.find((x) => x.k === c.k); return !s || Math.abs(s.x - c.x) > 1e-6 || Math.abs(s.z - c.z) > 1e-6; });
  ok("slots: every counter sits on its colour's chip spot, W U B R G C, whether it has mana or not", green.length === 6 && slotMiss.length === 0, slotMiss.map((c) => `${c.k} ${c.x.toFixed(3)},${c.z.toFixed(3)}`).join(" | "));
  // (the sim's model is 2 x 2 at scale 1, getBoundsNormalized)
  const wide = green.filter((c) => 2 * c.s > chipSpots[0].w + 1e-9);
  ok("slots: each counter scaled down to fit its slot (no wider than a chip)", green.length === 6 && wide.length === 0, JSON.stringify(green.map((c) => [c.k, c.s])));
  ok("slots: turned with the tracker, as the chips read", green.every((c) => Math.abs(c.ry - 0) < 1e-6), JSON.stringify(green.map((c) => c.ry)));
  const tracker = save.ObjectStates.find((o) => o.GUID === TRACKER.Blue).Transform;
  ok("slots: lying on the tracker's top face, not under the table", green.every((c) => c.y > tracker.posY && c.y < tracker.posY + 1), JSON.stringify(green.map((c) => c.y)));
  ok("another seat: the AI's counters are out too, all at opacity 0 with its empty pool", (json(r, "white none") || []).length === 6 && (json(r, "white none") || []).every((c) => c.a === 0 && c.b.length === 0), valueOf(r, "white none"));

  const same = fxOf(r, "same board").filter((l) => green.some((c) => l.includes(c.g)));
  ok("unchanged pool: the next board changes no counter at all", same.length === 0, same.slice(0, 3).join(" | "));
  // (a red added: the red counter shows, the green one's hover changes; the four empty ones stay as they are, and no
  // counter moves)
  const quiet = green.filter((c) => !["R", "G"].includes(c.k));
  const touched = fxOf(r, "add red").filter((l) => quiet.some((c) => l.includes(c.g)));
  ok("one colour more: the empty counters are left alone", quiet.length === 4 && touched.length === 0, touched.slice(0, 3).join(" | "));
  const moved = fxOf(r, "add red").filter((l) => green.some((c) => l.includes(c.g)) && /"set(Position|Scale|Rotation)/.test(l));
  ok("one colour more: no counter moves (fixed slots)", moved.length === 0, moved.slice(0, 3).join(" | "));
  const gone = fxOf(r, "red gone").filter((l) => l.includes(`obj:${byK(green, "R").g}`));
  ok("one colour less: the red counter goes to opacity 0 in place", gone.some((l) => /"setColorTint"/.test(l)) && !gone.some((l) => /"set(Position|Scale|Rotation)/.test(l)), gone.join(" | "));

  const three = json(r, "three") || [];
  ok("several colours: W 1, G 2, C 99 shown with their numbers, U B R at opacity 0", labelsOf(byK(three, "W")) === "1,1" && labelsOf(byK(three, "G")) === "2,2" && labelsOf(byK(three, "C")) === "99,99"
    && ["U", "B", "R"].every((k) => byK(three, k).a === 0 && byK(three, k).b.length === 0) && ["W", "G", "C"].every((k) => byK(three, k).a === 1), JSON.stringify(three.map((c) => [c.k, c.a, labelsOf(c)])));
  ok("several colours: the hover lists each", String(hoverOf(byK(three, "W")).tip).startsWith("Floating mana in Blue's pool: 1 white, 2 green, 99 colourless."), hoverOf(byK(three, "W")).tip);
  ok("several colours: the counters did not move (fixed slots)", three.every((c) => { const o = byK(green, c.k); return o.x === c.x && o.z === c.z; }));
  const wr = json(r, "white red") || [];
  ok("another seat: the AI's red counter shows 3, its hover names the AI", labelsOf(byK(wr, "R")) === "3,3" && String(hoverOf(byK(wr, "R")).tip).startsWith("Floating mana in AI 1's pool: 3 red."), JSON.stringify(byK(wr, "R")));

  const big = json(r, "150") || [];
  const bg = byK(big, "G");
  ok("above 99: the counter's own number is gone, one button left", bg.b && bg.b.length === 1, JSON.stringify(bg.b));
  const box = (bg.b || [])[0] || {};
  ok("above 99: that button is a black box with the real number, 150, in white", box.label === "150" && box.c && box.c[0] === 0 && box.c[1] === 0 && box.c[2] === 0 && box.c[3] === 1 && box.fc && box.fc[0] === 1 && box.w > 0 && box.h > 0, JSON.stringify(box));
  ok("above 99: the box sits on the counter's lower half (below its number)", box.z > 0.065, box.z);
  // (TTS's button text is about 0.583 of its font size a letter, as engineMarksWidth reckons it)
  ok("above 99: the number fits its box", box.label && box.label.length * 0.583 * box.f <= box.w && box.f <= box.h, JSON.stringify(box));
  ok("above 99: its hover says 150 green", box.tip && box.tip.includes("150 green"), box.tip);
  ok("above 99: still shown (alpha 1)", bg.a === 1 && bg.hidden === 0, JSON.stringify(bg));
  ok("back to 99: the box goes and the counter's number comes back", labelsOf(byK(json(r, "99 again"), "G")) === "99,99", JSON.stringify(byK(json(r, "99 again"), "G").b));

  const emptied = json(r, "emptied") || [];
  ok("pool emptied: every counter at opacity 0 with no number, left in its slot", emptied.length === 6 && emptied.every((c) => c.a === 0 && c.hidden > 0 && c.b.length === 0 && c.x === byK(green, c.k).x && c.z === byK(green, c.k).z), JSON.stringify(emptied.map((c) => [c.k, c.a, c.b.length])));
  ok("pool emptied: the AI's red counter too", byK(json(r, "white emptied"), "R").a === 0 && byK(json(r, "white emptied"), "R").b.length === 0, JSON.stringify(byK(json(r, "white emptied"), "R")));

  const reset = json(r, "after reset") || [];
  const blueEntries = ORDER.map((k) => entries[k] && entries[k].objs.find((e) => e.seat === "Blue"));
  ok("game end: engineCountersReset parks them under the table at their own spots, own scale, faded, no number", reset.length === 6 && reset.every((c, i) => blueEntries[i] && c.y === -30 && c.x === blueEntries[i].x && c.z === blueEntries[i].z
    && Math.abs(c.s - entries[c.k].scale) < 1e-9 && c.a === 0 && c.hidden > 0 && c.b.length === 0 && c.inter === false), JSON.stringify(reset.map((c) => [c.k, c.y, c.s, c.a, c.b.length])));
  ok("game end: the next game's first board puts them out again (the same pool as before the reset)", labelsOf(byK(json(r, "next game"), "U")) === "4,4" && byK(json(r, "next game"), "U").y > 0, JSON.stringify(byK(json(r, "next game"), "U")));
  ok("engine mode off: they go back under the table", (json(r, "mode off") || []).length === 6 && (json(r, "mode off") || []).every((c) => c.y === -30 && c.a === 0 && c.b.length === 0), JSON.stringify((json(r, "mode off") || []).map((c) => [c.k, c.y])));
}

// a save made while one showed (a counter on the tracker at alpha 1): the load parks it before any board
{
  const s = JSON.parse(JSON.stringify(save));
  const e = entries.R && entries.R.objs.find((x) => x.seat === "Blue");
  const o = e && s.ObjectStates.find((x) => x.GUID === e.g);
  if (o) { o.Transform.posY = 1.2; o.Transform.posX = 3; o.ColorDiffuse.a = 1; }
  const r = simulate({ save: s, steps: [q("return 'loaded'", "loaded", 40), COUNTERS("Blue", "after load")] });
  const red = byK(json(r, "after load"), "R");
  ok("load: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("load: a counter saved out on the table is parked under it again, faded, not interactable", !!o && red.y === -30 && red.x === e.x && red.a === 0 && red.inter === false, JSON.stringify(red));
}

// a table without the counters (an older save): the chips as before, and nothing else
{
  const r = run([q('ENGINE_MANA_PIECES = nil return "x"', "nil"), board({ G: 2 }, null), CHIPS("Blue", "chips")]);
  ok("older table: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("older table: without ENGINE_MANA_PIECES the pool shows as chips again", Number(valueOf(r, "chips")) === 1, valueOf(r, "chips"));
}

console.log(`${failed ? failed + " failed, " : ""}${failed ? "" : "all "}${passed} passed`);
process.exit(failed ? 1 : 0);
