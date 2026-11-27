// The table's own check (engineSelfCheck, tools/engine-renderer.lua), on the fake TTS: quiet on every 10th board of two
// games the bridge really sent, and naming each thing when the table is broken on purpose. A check that has only ever
// passed proves nothing, so each "map:" line in the check has a case here that breaks what it reads (COVERED, below).
// Smooth moves are instant here, so what a move looks like half way is tested only by saying a card is moving.
//   node tests/test_table_check.js
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
const stream = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", `table-stream-${name}.json`), "utf8"));
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };
const start = (ai) => [{ lua: "engineAutoPace.Blue = false" }, { lua: `engineChat("mtg start ai ${ai}", Player.Blue)` }];
const send = (m) => ({ msg: { t: m.t, json: m.json } });
const check = (mark) => ({ lua: "return JSON.encode(engineSelfCheck())", mark });
const valueOf = (r, mark) => JSON.parse(r.steps.find((s) => s.step === mark)?.value || "{}");
const fxOf = (r) => r.steps.flatMap((s) => s.fx);
const sends = (r) => fxOf(r).map((l) => l.replace(/\\/g, "")).filter((l) => l.includes('"t":"check"'));

// quiet on the real games: a false alarm every turn would hide a real one
for (const [name, ai, every] of [["1v1", "1", 10], ["4p", "3 builtin", 10]]) {
  const steps = start(ai);
  let tables = 0;
  for (const m of stream(name)) {
    steps.push(send(m));
    if (m.t === "table" && ++tables % every === 0) steps.push({ frames: 200 }, check(`board ${tables}`));
  }
  const r = simulate({ save, steps });
  ok(`${name}: the game ran`, !r.errors.length, r.errors.slice(0, 2).join(" | "));
  const seen = r.steps.filter((s) => s.step.startsWith("board ")).map((s) => JSON.parse(s.value));
  ok(`${name}: the check ran on real boards`, seen.length >= 10 && seen.some((v) => Object.values(v.counts || {}).some((c) => c.bf > 3)), `${seen.length} runs`);
  for (const v of seen) ok(`${name}: quiet on turn ${v.turn} ${v.step}`, !v.problems.length, v.problems.slice(0, 3).join(" | "));
}

// a board from the 1v1 with attackers on it, badges to read, and Blue's cards on the table
const s1 = stream("1v1");
const boardAt = s1.findIndex((m) => m.t === "table" && JSON.parse(m.json).players.some((p) => (p.battlefield || []).some((c) => c.atk && c.atkT)));
ok("the 1v1 has a board with an attacker", boardAt > 0, String(boardAt));
const prefix = [...start("1"), ...s1.slice(0, boardAt + 1).map(send), { frames: 200 }];
const first = "local o, id = nil, nil for _, x in ipairs(getObjects()) do local g = tostring(x.getGMNotes()) if g:find('^engine:engine%-card') and engineStackGlow[g:sub(8)] == nil and lastCheckBf(g:sub(8)) then o, id = x, g:sub(8) end end";
const helpers = `function lastCheckBf(id) for _, p in ipairs(engineTable().players) do for _, c in ipairs(p.battlefield or {}) do if c.id == id and not c.att and not c.fd then return c end end end end
function attackerObject() for _, x in ipairs(getObjects()) do local g = tostring(x.getGMNotes()) local c = g:find('^engine:') and lastCheckBf(g:sub(8)) if c and c.atk and c.atkT then return x, c end end end`;
const broken = (name, lua, word, more = []) => {
  const r = simulate({ save, steps: [...prefix, { lua: helpers }, check("before"), { lua }, ...more, check("after")] });
  ok(`${name}: the table was fine before`, !valueOf(r, "before").problems?.length, (valueOf(r, "before").problems || []).slice(0, 2).join(" | "));
  const after = valueOf(r, "after").problems || [];
  ok(`${name}: the check says so`, after.some((p) => p.includes(word)), r.errors.join(" | ") || after.join(" | ") || "it said nothing");
};
// held work and the rest of play: what the check must not call a fault
const quiet = (name, lua, word, more = []) => {
  const r = simulate({ save, steps: [...prefix, { lua: helpers }, { lua }, ...more, check("after")] });
  const after = valueOf(r, "after").problems;
  // (no errors either, 2026-11-27: a setup that threw left nothing to alarm about and passed)
  ok(`${name}: no alarm`, !r.errors.length && Array.isArray(after) && !after.some((p) => p.includes(word)), r.errors.join(" | ") || JSON.stringify(after));
};
quiet("an untap waiting for its player", "local o, c = attackerObject() c.tap = false enginePending.Blue = { untap = { [c.id] = true }, draw = {}, mill = {} }", "should be untapped");
quiet("a card still moving", `${first} o.isSmoothMoving = function() return true end o.setPosition(Vector(90, 2, 90))`, "wrong place");
quiet("a card in a player's hand", `${first} o.held_by_color = "Blue" o.setPosition(Vector(90, 2, 90))`, "wrong place");
quiet("an attached card with counters", "local o, c = attackerObject() c.att = c.id c.ctr = { charge = 3 }", "shows badges");
// (a face-down permanent's badges are drawn on its back since 2026-11-09, and checked: quiet once drawn, an alarm when not)
quiet("a face-down card with counters, drawn", "local o, c = attackerObject() c.fd = true c.ctr = { charge = 3 } engineRender(engineTable())", "shows badges", [{ frames: 200 }]);
quiet("a scry's cards", "engineScryOpen = function() return { gone = {}, menu = {} }, { options = { { id = 'engine-card-99998', label = 'Looked at', img = '' } }, scry = { move = 'graveyard' } } end enginePrompts.Blue = {} engineScryPlace({}) enginePrompts.Blue = nil", "leftover object");

// (the cost badge on Blue's first hand card, docs/cost-badge-spec.md: drawn, quiet; the engine's cost changed with no
// redraw, or a counter the engine never asked for, an alarm)
const costOn = 'local t = engineTable() for _, p in ipairs(t.players) do if p.color == "Blue" and p.hand and p.hand[1] then p.hand[1].mc = "{2}{R}" p.hand[1].ec = "{3}{R}" end end';
const handObj = 'local o for _, p in ipairs(engineTable().players) do if p.color == "Blue" and p.hand and p.hand[1] then for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:" .. p.hand[1].id then o = x end end end end';
quiet("a cost badge drawn", `${costOn} engineRender(t)`, "cost badge", [{ frames: 200 }]);
broken("a cost badge gone", costOn, "the engine's cost says [ | 3]");
broken("a cost badge that shouldn't be there", `${handObj} o.createButton({ click_function = "engineNoop", function_owner = Global, label = "5" })`, "shows cost badge [5]");
broken("hover name", `${first} o.setName("Wrong name")`, "is named [Wrong name]");
broken("hover text", `${first} o.setDescription("wrong")`, "wrong hover text");
broken("a badge that shouldn't be there", `${first} o.createButton({ click_function = "engineNoop", function_owner = Global, label = "9/9" })`, "shows badges [9/9");
broken("a badge gone", `local o, c = attackerObject() c.p, c.bp = "9", "1"`, "the engine says [9/");
broken("attacker with no glow", "local o, c = attackerObject() engineStackGlow[c.id] = nil", "doesn't glow");
broken("glow on a card that isn't attacking", `${first} engineStackGlow[id] = "atk"`, "glows as an attacker");
broken("attacker with no line", "Global.setVectorLines({})", "with no attack line");
broken("a line that isn't an attack line", "local l = Global.getVectorLines() for _, x in ipairs(l) do x.thickness = 0.3001 end Global.setVectorLines(l)", "with no attack line");
broken("tapped", `local o, c = attackerObject() c.tap = not c.tap`, "should be");
broken("wrong place", `${first} o.setPosition(Vector(90, 2, 90))`, "wrong place");
broken("leftover object", "local o = spawnObject({ type = 'Card' }) o.setGMNotes('engine:engine-card-99999')", "leftover object");
broken("a card that isn't there", `${first} o.destruct()`, "missing object:", [{ frames: 30 }]);
broken("two objects for one card", `${first} local n = spawnObject({ type = 'Card' }) n.setGMNotes(o.getGMNotes())`, "duplicate object for");
broken("phased out, and not shown", "local o, c = attackerObject() c.po = true", "is phased out, and the table doesn't show it");
broken("shown phased out, and isn't", `${first} o.createButton({ click_function = "engineNoop", function_owner = Global, label = "PHASED OUT" }) o.setColorTint({ r = 0.3, g = 0.3, b = 0.3 })`, "shows as phased out, and isn't");
broken("face up and should be down", "local o, c = attackerObject() c.fd = true", "should be face down");
broken("face down and should be up", `${first} o.flip()`, "should be face up", [{ frames: 120 }]);
broken("attached to nothing", "local o, c = attackerObject() c.att = 'engine-card-99999'", "attached to a card the table doesn't have");
broken("attached, far from its card", `${first} local other = nil for _, x in ipairs(getObjects()) do local g = tostring(x.getGMNotes()) if g:find('^engine:engine%-card') and x ~= o and lastCheckBf(g:sub(8)) then other = g:sub(8) end end
  lastCheckBf(id).att = other o.setPosition(Vector(90, 2, 90))`, "is attached, and lies away from its card");
broken("a counter not shown", "local o, c = attackerObject() c.ctr = { lore = 77 }", "77 Lore");
broken("a face-down card's counter not shown", "local o, c = attackerObject() c.fd = true c.ctr = { charge = 3 }", "the engine says [3 Charge]");
broken("the life tracker", "getObjectFromGUID('395037').setVar('count', 12345)", "life tracker shows 12345");

// a card exiled with a permanent and coming back: the only place a player can read that
{
  const board = JSON.parse(s1[boardAt].json);
  const blue = board.players.find((p) => (p.battlefield || []).some((c) => !c.att));
  const host = blue.battlefield.find((c) => !c.att);
  // (a zone named in keep is "as it was": a board has to say it changed)
  const linked = (rl) => {
    const b = JSON.parse(JSON.stringify(board)), p = b.players.find((x) => x.color === blue.color);
    p.exile = [{ id: "engine-card-9001", n: "Taken Card", tl: "Creature", cmc: 2, tx: "A card.", ty: ["Creature"], ew: host.id, rl, ctl: blue.color }];
    p.keep = (p.keep || []).filter((z) => z !== "exile");
    return { t: "table", json: JSON.stringify(b) };
  };
  const steps = (rl, more = []) => [...prefix, send(linked(rl)), { frames: 200 }, ...more, check("after"), { lua: `for _, x in ipairs(getObjects()) do if x.getGMNotes() == 'engine:engine-card-9001' then return x.getDescription() end end`, mark: "text" }];
  const r = simulate({ save, steps: steps(true) });
  const text = r.steps.find((s) => s.step === "text")?.value || "";
  ok("linked: the hover text says it comes back", text.includes("Comes back when the card that exiled it leaves."), text);
  const quiet = valueOf(r, "after").problems || [];
  ok("linked: quiet when it says so", !quiet.length, quiet.join(" | "));
  const plain = simulate({ save, steps: steps(false) });
  ok("linked: a card that stays exiled doesn't say it", !(plain.steps.find((s) => s.step === "text")?.value || "").includes("Comes back"));
  const wiped = simulate({ save, steps: steps(true, [{ lua: `for _, x in ipairs(getObjects()) do if x.getGMNotes() == 'engine:engine-card-9001' then x.setDescription("A card.") end end` }]) });
  ok("linked: the check sees it gone", (valueOf(wiped, "after").problems || []).some((p) => p.includes("wrong hover text")), JSON.stringify(valueOf(wiped, "after").problems));
  const moved = simulate({ save, steps: steps(true, [{ lua: `for _, x in ipairs(getObjects()) do if x.getGMNotes() == 'engine:engine-card-9001' then x.setPosition(Vector(90, 2, 90)) end end` }]) });
  ok("linked: the check sees it away from its card", (valueOf(moved, "after").problems || []).some((p) => p.includes("wrong place: Taken Card")), JSON.stringify(valueOf(moved, "after").problems));
}

// a suspended card (face up in exile with time counters, readability audit B5): beside the exile pile with its badge
{
  const board = JSON.parse(s1[boardAt].json);
  const suspended = () => {
    const b = JSON.parse(JSON.stringify(board)), p = b.players.find((x) => x.color === "Blue");
    p.exile = [{ id: "engine-card-9003", n: "Suspended Card", tl: "Sorcery", cmc: 1, tx: "A card.", ty: ["Sorcery"], ctr: { TIME: 2 } }];
    p.keep = (p.keep || []).filter((z) => z !== "exile");
    return { t: "table", json: JSON.stringify(b) };
  };
  const steps = (more = []) => [...prefix, send(suspended()), { frames: 200 }, ...more, check("after")];
  const quiet = valueOf(simulate({ save, steps: steps() }), "after").problems || [];
  ok("suspended: quiet beside its exile pile", !quiet.length, quiet.join(" | "));
  const obj = "for _, x in ipairs(getObjects()) do if x.getGMNotes() == 'engine:engine-card-9003' then ";
  const moved = valueOf(simulate({ save, steps: steps([{ lua: `${obj}x.setPosition(Vector(90, 2, 90)) end end` }]) }), "after").problems || [];
  ok("suspended: the check sees it away from its spot", moved.some((p) => p.includes("wrong place: Suspended Card")), moved.join(" | "));
  const wiped = valueOf(simulate({ save, steps: steps([{ lua: `${obj}x.clearButtons() end end` }]) }), "after").problems || [];
  ok("suspended: the check sees its time counters gone", wiped.some((p) => p.includes("Suspended Card") && p.includes("(suspended) shows badges")), wiped.join(" | "));
}

// a card playable from exile: it lies in the player's row or second hand, and the pile is not where it belongs
{
  const board = JSON.parse(s1[boardAt].json);
  const mine = board.players.find((p) => p.color === "Blue");
  const playable = () => {
    const b = JSON.parse(JSON.stringify(board)), p = b.players.find((x) => x.color === "Blue");
    const card = { id: "engine-card-9002", n: "Impulse Card", tl: "Creature", cmc: 2, tx: "A card.", ty: ["Creature"], ctl: "Blue" };
    p.exile = [card];
    p.playable = [card];
    p.keep = (p.keep || []).filter((z) => z !== "exile");
    return { t: "table", json: JSON.stringify(b) };
  };
  ok("playable: Blue is on the board", !!mine);
  const steps = (more = []) => [...prefix, send(playable()), { frames: 200 }, ...more, check("after")];
  const quiet = valueOf(simulate({ save, steps: steps() }), "after").problems || [];
  ok("playable: quiet in its row", !quiet.length, quiet.join(" | "));
  const moved = valueOf(simulate({ save, steps: steps([{ lua: `for _, x in ipairs(getObjects()) do if x.getGMNotes() == 'engine:engine-card-9002' then x.setPosition(Vector(90, 2, 90)) end end` }]) }), "after").problems || [];
  ok("playable: the check sees it out of its row", moved.some((p) => p.includes("wrong place: Impulse Card")), moved.join(" | "));
  // (played from a library's top: in no zone of the board. A foretold card a second seat may play: its name is that seat's)
  const b = JSON.parse(JSON.stringify(board)), p = b.players.find((x) => x.color === "Blue");
  p.playable = [{ id: "engine-card-9003", n: "Top Card", tl: "Creature", cmc: 2, tx: "A card.", ty: ["Creature"], ctl: "Blue" }];
  const top = valueOf(simulate({ save, steps: [...prefix, send({ t: "table", json: JSON.stringify(b) }), { frames: 200 }, check("after")] }), "after").problems || [];
  ok("playable from a library's top: no alarm", !top.some((x) => x.includes("leftover object")), top.join(" | "));
  const c = JSON.parse(JSON.stringify(board)), q = c.players.find((x) => x.color === "Blue");
  q.exile = [{ id: "engine-card-9004", fd: true, n: "Foretold card", tl: "", cmc: 0, ty: [], ctl: "Blue" }];
  q.playable = [{ id: "engine-card-9004", n: "Real Name", tl: "Creature", cmc: 2, tx: "A card.", ty: ["Creature"], ctl: "Blue" }];
  q.keep = (q.keep || []).filter((z) => z !== "exile");
  const told = valueOf(simulate({ save, steps: [...prefix, send({ t: "table", json: JSON.stringify(c) }), { frames: 200 }, check("after")] }), "after").problems || [];
  ok("a foretold card its owner may play: no alarm, and no name in the log", !told.some((x) => x.includes("is named") || x.includes("hover text")), told.join(" | "));
}

// A flashback card in its owner's graveyard, in the row: its hover text is the graveyard entry's, notes and all. The
// bridge sent the row's copy without its "Flashback {cost}" note, and the check called the hover text wrong all game
// (Lingering Souls, Faithless Looting, 2026-11-08/09 game, tmp/table-check.log): the bridge's half is in
// test_bridge_claims ("flashback: ..."); this is the table's half, quiet when both say the same.
{
  const board = JSON.parse(s1[boardAt].json);
  const looting = (nt) => ({ id: "engine-card-9006", n: "Faithless Looting", tl: "Sorcery", cmc: 1, tx: "Draw two cards, then discard two cards.", ty: ["Sorcery"], ctl: "Blue", ...(nt ? { nt } : {}) });
  const steps = (rowNt) => {
    const b = JSON.parse(JSON.stringify(board)), p = b.players.find((x) => x.color === "Blue");
    p.graveyard = [looting(["Flashback {2}{R}"])];
    p.playable = [looting(rowNt)];
    p.keep = (p.keep || []).filter((z) => z !== "graveyard");
    return [...prefix, send({ t: "table", json: JSON.stringify(b) }), { frames: 200 }, check("after")];
  };
  const same = valueOf(simulate({ save, steps: steps(["Flashback {2}{R}"]) }), "after").problems || [];
  ok("flashback in the row: quiet when the row's entry has its note", !same.length, same.join(" | "));
  const without = valueOf(simulate({ save, steps: steps(null) }), "after").problems || [];
  ok("flashback in the row: the old board (no note on the row's entry) is what raised the alarm", without.some((x) => x.includes("Faithless Looting (Blue graveyard) has the wrong hover text")), without.join(" | "));
}

// A hand card discarded into a pile while its object stays on the table (a put TTS made into the deck and the object
// still there: Rancor, discarded while Blue was dragging it, lay beside Blue's graveyard for 48 minutes as "wrong place",
// and its drags read as a hand card's, 2026-11-08 23:39 to 00:27, tmp/table-check.log). The fake TTS always takes the
// object in, so the put here keeps it, as that one did.
{
  const board = JSON.parse(s1[boardAt].json);
  const gy = (n) => ({ id: `engine-card-${9010 + n}`, n: `Old Card ${n}`, tl: "Creature", cmc: 2, tx: "A card.", ty: ["Creature"], ctl: "Blue" });
  const rancor = { id: "engine-card-9019", n: "Rancor", tl: "Enchantment — Aura", cmc: 1, tx: "Enchant creature", ty: ["Enchantment"], ctl: "Blue" };
  const b1 = JSON.parse(JSON.stringify(board)), p1 = b1.players.find((x) => x.color === "Blue");
  p1.hand = [...(p1.hand || []), rancor];
  p1.graveyard = [gy(1), gy(2)];
  p1.keep = (p1.keep || []).filter((z) => z !== "graveyard" && z !== "hand");
  const b2 = JSON.parse(JSON.stringify(b1)), p2 = b2.players.find((x) => x.color === "Blue");
  p2.hand = p2.hand.filter((c) => c.id !== rancor.id);
  p2.graveyard = [gy(1), gy(2), rancor];
  const keepObject = "enginePutInDeck = function(deck, obj) local d = {} for k, v in pairs(obj.getData()) do d[k] = v end d.Name = 'Card' table.insert(deck.__d.contained, 1, d) end";
  const find = `local o = nil for _, x in ipairs(getObjects()) do if x.getGMNotes() == 'engine:${rancor.id}' then o = x end end`;
  const r = simulate({ save, steps: [...prefix, send({ t: "table", json: JSON.stringify(b1) }), { frames: 200 }, { lua: keepObject }, send({ t: "table", json: JSON.stringify(b2) }), { frames: 200 },
    { lua: `${find} if o then o.setPosition(Vector(90, 2, 90)) end return tostring(o ~= nil)`, mark: "left" }, check("after"),
    { lua: `return engineDebugCard('${rancor.id}')`, mark: "meta" }] });
  const after = valueOf(r, "after").problems || [];
  ok("stray: no copy of the discarded card is left on the table", (r.steps.find((s) => s.step === "left") || {}).value === "false", r.errors.join(" | ") || (r.steps.find((s) => s.step === "left") || {}).value);
  ok("stray: and no alarm", !after.some((x) => x.includes(rancor.n)), after.join(" | "));
  ok("stray: the card reads as a graveyard card, not a hand card", / zone=graveyard /.test((r.steps.find((s) => s.step === "meta") || {}).value || ""), (r.steps.find((s) => s.step === "meta") || {}).value);

  // pileStray (addToPile's verify) disposes only an object provably left behind, never the card the put took in: every
  // pile add runs it, and a reference real TTS kept alive to the merged card would otherwise be disposed with the card
  // already in the deck (verifier 2026-11-11). Counted at engineDispose, by the card's GM notes.
  const countDisposed = `strayDisposed = 0 local d0 = engineDispose engineDispose = function(o) if o ~= nil and not o.isDestroyed() and o.getGMNotes() == 'engine:${rancor.id}' then strayDisposed = strayDisposed + 1 end return d0(o) end`;
  const inDeck = `local n = 0 for _, d in ipairs(getObjects()) do if d.getGMNotes() == 'engine:graveyard:Blue' and d.type == 'Deck' then for _, e in ipairs(d.getObjects()) do if e.gm_notes == 'engine:${rancor.id}' then n = n + 1 end end end end`;
  const tally = (mark) => ({ lua: `${inDeck} return tostring(strayDisposed) .. ' ' .. n`, mark });
  const stray = (between, after = []) => simulate({ save, steps: [...prefix, send({ t: "table", json: JSON.stringify(b1) }), { frames: 200 }, { lua: countDisposed }, ...between,
    send({ t: "table", json: JSON.stringify(b2) }), ...after, { frames: 200 }, tally("end")] });
  const told = (r, mark) => `${(r.steps.find((s) => s.step === mark) || {}).value} ${r.errors.join(" | ")}`.trim();
  const plain = stray([]);
  ok("pileStray: a put the table took in disposes nothing, and the card is in the pile once", told(plain, "end") === "0 1", told(plain, "end"));
  // (the put's object still alive with its card's notes, but inside the deck: getObjectFromGUID finds nothing for it)
  const merged = stray([{ lua: keepObject }, { lua: `local g0 = getObjectFromGUID getObjectFromGUID = function(g) local o = g0(g) if o ~= nil and o.getGMNotes() == 'engine:${rancor.id}' then return nil end return o end` }]);
  ok("pileStray: an object of the card's that isn't loose on the table is never disposed", told(merged, "end") === "0 1", told(merged, "end"));
  // (left behind while held: looked at again, disposed once it is let go)
  const held = stray([{ lua: keepObject }], [{ frames: 2 }, { lua: `${find} if o then o.held_by_color = 'Blue' end return tostring(o ~= nil)`, mark: "grab" },
    { frames: 70 }, tally("held"), { lua: `${find} if o then o.held_by_color = nil end return tostring(o ~= nil)`, mark: "let go" }]);
  ok("pileStray: a left-behind object in a player's grip isn't disposed", told(held, "grab") === "true" && told(held, "held") === "0 1", `${told(held, "grab")} / ${told(held, "held")}`);
  ok("pileStray: and is once it is let go", told(held, "end") === "1 1", told(held, "end"));
  // (the object made that card's own again before the second check, as a pick out of the pile does: kept)
  const retaken = stray([{ lua: keepObject }], [{ frames: 2 }, { lua: `${find} if o then engineCardEntry('${rancor.id}', o) end return tostring(o ~= nil)`, mark: "taken" }]);
  ok("pileStray: an object that is its card's own again is never disposed", told(retaken, "taken") === "true" && told(retaken, "end").startsWith("0 "), `${told(retaken, "taken")} / ${told(retaken, "end")}`);
  const loose = stray([{ lua: keepObject }]);
  ok("pileStray: a left-behind object loose on the table is disposed once", told(loose, "end") === "1 1", told(loose, "end"));
}

// Another player's card this seat may play lies in this seat's row, never its owner's (Thief of Sanity's face-down card
// in the caster's second hand zone, Mnemonic Betrayal's on the caster's mat). The check read the owner's mat and hand,
// and called such a card out of place once it wasn't on its exact spot (found by reading the code, 2026-11-11).
{
  const board = JSON.parse(s1[boardAt].json);
  const run = (card, move) => {
    const b = JSON.parse(JSON.stringify(board)), white = b.players.find((x) => x.color === "White"), blue = b.players.find((x) => x.color === "Blue");
    white[card.zone] = [card.c];
    white.keep = (white.keep || []).filter((z) => z !== card.zone);
    blue.playable = [card.row || card.c];
    return valueOf(simulate({ save, steps: [...prefix, send({ t: "table", json: JSON.stringify(b) }), { frames: 200 }, { lua: `for _, x in ipairs(getObjects()) do if x.getGMNotes() == 'engine:${card.c.id}' then ${move} end end` }, check("after")] }), "after").problems || [];
  };
  // (Thief of Sanity: White's card exiled face down, Blue may look at it and cast it; the row's copy shows its face)
  const thief = { zone: "exile", c: { id: "engine-card-9007", fd: true, n: "Face-down card", tl: "", cmc: 0, ty: [], ctl: "White" },
    row: { id: "engine-card-9007", n: "Counterspell", tl: "Instant", cmc: 2, tx: "Counter target spell.", ty: ["Instant"], ctl: "White" } };
  const hand2 = "local h = Player.Blue.getHandTransform(2) x.setPosition(h.position + Vector(2.5, 0, 0))";
  const t1 = run(thief, hand2);
  ok("Thief of Sanity's card in its caster's second hand zone: no alarm", !t1.some((x) => x.includes("wrong place")), t1.join(" | "));
  const t0 = run(thief, "x.setPosition(Vector(90, 2, 90))");
  ok("Thief of Sanity's card off its row: the check says so", t0.some((x) => x.includes("wrong place: Face-down card (White exile)")), t0.join(" | "));
  // (Mnemonic Betrayal: White's graveyard card, face up, castable by Blue, nudged on Blue's mat as a player may)
  const betrayal = { zone: "graveyard", c: { id: "engine-card-9008", n: "Lightning Bolt", tl: "Instant", cmc: 1, tx: "Lightning Bolt deals 3 damage to any target.", ty: ["Instant"], ctl: "White" } };
  const nudge = "local g = seatGeometry('Blue') x.setPosition(Vector(g.mat.x + 1, 1.1, g.mat.z))";
  const m1 = run(betrayal, nudge);
  ok("Mnemonic Betrayal's card moved on its caster's mat: no alarm", !m1.some((x) => x.includes("wrong place")), m1.join(" | "));
}

// a held mill lies on its fan, not in the graveyard
{
  const b = JSON.parse(JSON.stringify(JSON.parse(s1[boardAt].json))), p = b.players.find((x) => x.color === "Blue");
  p.graveyard = [{ id: "engine-card-9005", n: "Milled", tl: "Creature", cmc: 2, tx: "A card.", ty: ["Creature"], ctl: "Blue" }];
  p.keep = (p.keep || []).filter((z) => z !== "graveyard");
  const r = simulate({ save, steps: [...prefix, send({ t: "table", json: JSON.stringify(b) }), { frames: 200 },
    { lua: "enginePending.Blue = { untap = {}, draw = {}, mill = { 'engine-card-9005' } } for _, x in ipairs(getObjects()) do if x.getGMNotes() == 'engine:engine-card-9005' then x.setPosition(Vector(90, 2, 90)) end end" }, check("after")] });
  const said = valueOf(r, "after").problems;
  ok("a held mill: no alarm", Array.isArray(said) && !said.some((x) => x.includes("wrong place: Milled")), JSON.stringify(said));
}

// a stack of tokens: one with a status of its own doesn't join it
{
  const r = simulate({ save, steps: [{ lua: "return tostring(engineTokenKey({ n = 'Goblin', kw = { 'Summoning sick' } }) ~= engineTokenKey({ n = 'Goblin' }))", mark: "keys" }] });
  ok("a token's status keeps it out of the stack", r.steps.find((x) => x.step === "keys")?.value === "true", String(r.steps.find((x) => x.step === "keys")?.value));
}

// exiled cards gathered in their pile: inside a deck, so not on the table as objects, and not missing
{
  const board = JSON.parse(s1[boardAt].json);
  const b = JSON.parse(JSON.stringify(board)), p = b.players.find((x) => x.color === "Blue");
  p.exile = [1, 2, 3].map((i) => ({ id: `engine-card-910${i}`, n: `Exiled ${i}`, tl: "Creature", cmc: 2, tx: "A card.", ty: ["Creature"], ctl: "Blue" }));
  p.keep = (p.keep || []).filter((z) => z !== "exile");
  const r = simulate({ save, steps: [...prefix, send({ t: "table", json: JSON.stringify(b) }), { frames: 300 },
    { lua: "local n = 0 for _, x in ipairs(getObjects()) do if x.type == 'Deck' and tostring(x.getGMNotes()):find('^engine:exile:') then n = n + 1 end end return n", mark: "piles" }, check("after")] });
  ok("exile pile: the cards are in a deck", Number(r.steps.find((s) => s.step === "piles")?.value) === 1, r.steps.find((s) => s.step === "piles")?.value);
  const said = valueOf(r, "after").problems || [];
  ok("exile pile: quiet", !said.length, said.join(" | "));
}

// a player turning their own card over to look isn't a fault
{
  const r = simulate({ save, steps: [...prefix, { lua: helpers }, { lua: `${first} engineFlipped[id] = true o.flip()` }, { frames: 120 }, check("after")] });
  ok("a card a player turned over: no alarm", !(valueOf(r, "after").problems || []).some((p) => p.includes("should be face")), JSON.stringify(valueOf(r, "after").problems));
}

// when it runs, and what reaches the bridge
{
  const steps = start("1");
  for (const m of s1) steps.push(send(m), { frames: 12 });
  // (asked once as a turn starts and once at attackers; a run reports the newest board's turn, so count what asked)
  const spy = { lua: "checkAsks = {} local due = engineCheckDue engineCheckDue = function(m) local was = engineCheckedAt due(m) if engineCheckedAt ~= was then checkAsks[#checkAsks + 1] = m.turn end end" };
  const r = simulate({ save, steps: [spy, ...steps, { frames: 400 }, { lua: "return JSON.encode(checkAsks)", mark: "asks" }] });
  const turns = new Set(s1.filter((m) => m.t === "table").map((m) => JSON.parse(m.json).turn));
  const said = sends(r).length;
  const perTurn = {};
  for (const t of JSON.parse(r.steps.find((x) => x.step === "asks")?.value || "[]")) perTurn[t] = (perTurn[t] || 0) + 1;
  ok("runs: at most twice a turn", Object.values(perTurn).every((n) => n <= 2), JSON.stringify(perTurn));
  ok("runs: on every turn", Object.keys(perTurn).length === turns.size, `${said} runs over ${turns.size} turns: ${JSON.stringify(perTurn)}`);
  ok("runs: every run is quiet on this game", sends(r).every((l) => l.includes('"problems":""')), sends(r).find((l) => !l.includes('"problems":""')));
}
{
  const r = simulate({ save, steps: [...prefix, { lua: helpers }, { lua: `${first} o.setName("Wrong name") engineCheckRun()` }, { frames: 200 }] });
  ok("a problem still there 2 s later is sent", sends(r).some((l) => l.includes("Wrong name")), sends(r).join(" | "));
  const gone = simulate({ save, steps: [...prefix, { lua: helpers }, { lua: `${first} heldObject = o heldName = o.getName() o.setName("Wrong name") engineCheckRun()` }, { frames: 30 },
    { lua: "heldObject.setName(heldName)" }, { frames: 200 }] });
  ok("a problem gone 2 s later isn't sent", !sends(gone).some((l) => l.includes("Wrong name")), sends(gone).join(" | "));
  // (the second look keeps what both looks saw: a fault new to the second is judged next time)
  const late = simulate({ save, steps: [...prefix, { lua: helpers }, { lua: `${first} heldObject = o heldName = o.getName() o.setName("Wrong name") engineCheckRun()` }, { frames: 30 },
    { lua: 'heldObject.setName(heldName) heldObject.setDescription("late fault")' }, { frames: 200 }] });
  ok("a problem first seen on the second look isn't sent", !sends(late).some((l) => l.includes("wrong hover text")), sends(late).join(" | "));
  const crash = simulate({ save, steps: [...prefix, { lua: "engineStackGlow = nil engineCheckRun()" }, { frames: 30 }] });
  ok("a check that fails says so, rather than going quiet", sends(crash).some((l) => l.includes("the check itself failed")), sends(crash).join(" | "));
  const late2 = simulate({ save, steps: [...prefix, { lua: helpers }, { lua: `${first} o.setName("Wrong name") engineCheckRun()` }, { frames: 30 }, { lua: "engineStackGlow = nil" }, { frames: 200 }] });
  ok("a check that fails on the second look says so", sends(late2).some((l) => l.includes("the check itself failed")), sends(late2).join(" | "));
  ok("a check that fails says which turn", sends(crash).some((l) => l.includes("the check itself failed") && /"turn":\d/.test(l)), sends(crash).join(" | "));
  // (the bridge compares this with the last deploy: a report without it can't say the table is out of step)
  const plain = simulate({ save, steps: [...prefix, { lua: "engineCheckRun()" }, { frames: 30 }] });
  ok("a check says which build ran it", sends(plain).length > 0 && sends(plain).every((l) => /"stamp":"/.test(l)), sends(plain).join(" | "));
  ok("a failed check says which build ran it", sends(crash).length > 0 && sends(crash).every((l) => /"stamp":"/.test(l)), sends(crash).join(" | "));
}
// a game that is over isn't checked: its board is being cleared
{
  const last = JSON.parse(s1[boardAt].json);
  const over = { t: "table", json: JSON.stringify({ ...last, turn: 77, gameOver: true }) };
  const r = simulate({ save, steps: [...prefix, send(over), { frames: 400 }] });
  ok("a finished game isn't checked", !sends(r).some((l) => l.includes('"turn":77')), sends(r).join(" | "));
  // (a check already waiting when the game ended: its board's lines are gone, and that isn't a fault)
  const waiting = simulate({ save, steps: [...prefix, send(over), { frames: 120 }, { lua: "engineCheckRun()" }, { frames: 30 }] });
  ok("a check due after the game ended says nothing", !sends(waiting).some((l) => l.includes('"turn":77')), sends(waiting).join(" | "));
  const secondLook = simulate({ save, steps: [...prefix, { lua: helpers }, { lua: `${first} o.setName("Wrong name") engineCheckRun()` }, { frames: 30 }, send(over), { frames: 370 }] });
  ok("a second look due when the game ends says nothing", sends(secondLook).length === sends(r).length, sends(secondLook).join(" | "));
}
// every "map:" line in the check has its case here, and a new one fails until it does
{
  const COVERED = { badges: "a badge gone", attack: "attacker with no glow", attackLine: "attacker with no line", phased: "phased out, and not shown", faceDown: "face up and should be down", attached: "attached to nothing",
    counters: "a counter not shown", present: "a card that isn't there", playable: "playable: the check sees it out of its row", linked: "linked: the check sees it away from its card", suspended: "suspended: the check sees it away from its spot", place: "wrong place", tapped: "tapped", hoverName: "hover name", hoverText: "hover text", cost: "a cost badge gone" };
  const lua = fs.readFileSync(path.join(__dirname, "..", "tools", "engine-renderer.lua"), "utf8");
  const tags = [...lua.slice(lua.indexOf("function engineSelfCheck()"), lua.indexOf("function engineCheckRun()")).matchAll(/map:(\w+)/g)].map((m) => m[1]);
  ok("each map: line has a case", tags.length > 10 && tags.every((t) => COVERED[t]), tags.filter((t) => !COVERED[t]).join(" "));
}
console.log(failed ? `\n${failed} table check tests failed (${passed} passed)` : `all ${passed} table check tests pass`);
process.exit(failed ? 1 : 0);
