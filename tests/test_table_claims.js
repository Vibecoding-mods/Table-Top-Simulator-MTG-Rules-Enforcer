// Checks for table-script fixes the recorded games don't reach (jr-programmer-suite on engine-renderer.lua,
// 2026-10-20). Each runs a short real game prefix on the fake TTS, then crafted messages/clicks, and asks the script.
//   node tests/test_table_claims.js        (TABLE_SAVE=<save.json> to test a given save)
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
const s1 = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "table-stream-1v1.json"), "utf8"));
const prefix = [{ lua: 'engineChat("mtg start ai 1", Player.Blue)' }, ...s1.slice(0, 40).map((m) => ({ msg: { t: m.t, json: m.json } }))];
const ask = (p) => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", ...p }) } });
const q = (lua, mark) => ({ lua, mark });
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };
const run = (steps) => simulate({ save, steps: [...prefix, ...steps] });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const fxOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).fx || [];

// latest Blue battlefield ids in the prefix
const blueBf = [];
for (const m of s1.slice(0, 40)) if (m.t === "table") { const pl = JSON.parse(m.json).players.find((x) => x.color === "Blue"); if (pl && pl.battlefield) blueBf.splice(0, blueBf.length, ...pl.battlefield.map((c) => c.id)); }

// F7: a number question can be answered above min+59 (the search finds 99 in 0..100)
{
  const r = run([ask({ promptId: 801, title: "Choose X", mode: "number", min: 0, max: 100 }),
    q('onMtgSearch(Player.Blue, "99", "eng_search_Blue")', "search 99"),
    q('return tostring(UI.getAttribute("eng_opt_Blue_1", "text"))', "first button")]);
  ok("precondition: the number question opened", !r.errors.length, r.errors.join(" | "));
  ok("F7 numbers: searching 99 in 0-100 offers 99", /99/.test(String(valueOf(r, "first button"))) || fxOf(r, "search 99").some((l) => /eng_opt_Blue_1/.test(l) && /99/.test(l)), JSON.stringify(fxOf(r, "search 99").slice(0, 3)));
}
// F3: a message that would break the update (prompt without colour) is caught and printed; the next works
{
  const r = run([{ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", promptId: 802, title: "x", mode: "single", options: [{ id: "a", label: "A" }] }) }, mark: "bad prompt" },
    ask({ promptId: 803, title: "Pick", mode: "single", options: [{ id: "a", label: "A" }] }),
    q('return enginePrompts["Blue"] and tostring(enginePrompts["Blue"].promptId) or "none"', "after")]);
  ok("F3 barrier: the bad message raised no error out of onExternalMessage", !r.errors.some((e) => /bad prompt|msg/.test(e)) && r.errors.length === 0, r.errors.join(" | "));
  ok("F3 barrier: it was reported", fxOf(r, "bad prompt").some((l) => /table update failed/.test(l)), JSON.stringify(fxOf(r, "bad prompt").slice(0, 2)));
  ok("F3 barrier: the next message works", valueOf(r, "after") === "803", valueOf(r, "after"));
}
// F9: a click that arrives as "select" and "pick up" picks once
{
  // a target question (the kind whose clicks weren't de-duplicated): "up to one target"
  const r = run([ask({ promptId: 804, title: "Target: choose 0-1 target(s)", mode: "multi", min: 0, max: 1, options: [{ id: `card|${blueBf[0]}`, label: "a card" }] }),
    q(`local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${blueBf[0]}" then o = x end end onPlayerAction(Player.Blue, Player.Action.Select, { o }) onPlayerAction(Player.Blue, Player.Action.PickUp, { o })`, "double event"),
    q('return tostring(engineSelectedFor("Blue", 1))', "selected")]);
  ok("precondition: the card is on the table", blueBf.length > 0);
  ok("F9 clicks: select + pick up of one click leaves the card chosen", valueOf(r, "selected") === "true", `selected=${valueOf(r, "selected")} errors=${r.errors.join(" | ")}`);
}
// F2 + F4: the end of a game merges the cards away with one throw-away, and forgets the game's cards
{
  const r = run([{ msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 90, mark: "clear" },
    q('local n = 0 for _ in pairs(engineStatic) do n = n + 1 end return tostring(n)', "static left")]);
  const d = fxOf(r, "clear").filter((l) => /"destruct"/.test(l)).length;
  const merged = fxOf(r, "clear").filter((l) => /"putObject"/.test(l)).length;
  ok("precondition: there were cards to clear", merged > 3, `${merged} merged`);
  ok("F2 reset: at most two objects destroyed one by one (the trash decks)", d <= 2, `${d} destruct calls`);
  ok("F4 reset: the game's card details are forgotten", valueOf(r, "static left") === "0", valueOf(r, "static left"));
}
// F8: a token something is attached to keeps its own card even when an identical token exists
{
  const last = JSON.parse([...s1.slice(0, 40)].reverse().find((m) => m.t === "table").json);
  const blue = last.players.find((x) => x.color === "Blue");
  const tok = (id) => ({ id, s: 1 });
  const cards = { "tok-1": { n: "Insect", tok: true, ty: ["Creature"] }, "tok-2": { n: "Insect", tok: true, ty: ["Creature"] }, "aura-1": { n: "Pacifism", ty: ["Enchantment"] } };
  blue.battlefield = [...(blue.battlefield || []), tok("tok-1"), tok("tok-2"), { id: "aura-1", s: 1, att: "tok-2" }];
  blue.keep = (blue.keep || []).filter((z) => z !== "battlefield");
  last.cards = { ...(last.cards || {}), ...cards };
  const r = run([{ msg: { t: "table", json: JSON.stringify(last) }, frames: 30, mark: "tokens" },
    q('return tostring(engineGroupOf["tok-2"]) .. "," .. tostring(engineGroupOf["tok-1"])', "groups")]);
  ok("F8 tokens: the enchanted token isn't folded into the other one", valueOf(r, "groups") === "nil,nil", `${valueOf(r, "groups")} ${r.errors.join(" | ")}`);
}
// by hand: questions with no card to click are answered with buttons in the centre row
{
  // what the table sent the bridge in a step (the answer's JSON, unescaped once)
  const sentIn = (r, mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join(""); // (the JSON is escaped twice on the way out)
  const r = run([
    ask({ promptId: 811, kind: "number", title: "Choose X", mode: "number", min: 0, max: 7, show: [{ n: "Fireball", img: "kf1b4bab87-4000-461d-8b58-d34928fee305" }] }),
    q('return tostring(UI.getAttribute("eng_row_Blue", "active"))', "number row"),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_2") onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_2") onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_1")', "+ + -"),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_5")', "ok number"),
    ask({ promptId: 812, kind: "color", title: "Choose a color", mode: "single", options: [{ id: "R", label: "R" }, { id: "G", label: "G" }] }),
    q('return tostring(UI.getAttribute("eng_rowopt_Blue_2", "color"))', "green button"),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_2")', "pick green"),
    ask({ promptId: 813, kind: "modal", title: "Choose two", mode: "multi", min: 2, max: 2, options: [{ id: "0", label: "Draw a card" }, { id: "1", label: "Gain 3 life" }, { id: "2", label: "Scry 2" }] }),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_1") onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_3")', "two modes"),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_4")', "confirm modes"),
  ]);
  ok("by hand: a number question shows the row", valueOf(r, "number row") === "true", valueOf(r, "number row"));
  ok("by hand: +, +, - then OK answers 1", sentIn(r, "ok number").includes('"choice":[1]'), sentIn(r, "ok number").slice(0, 200));
  ok("by hand: a colour button is tinted", String(valueOf(r, "green button")).toLowerCase() === "#2e8b57", valueOf(r, "green button"));
  ok("by hand: the colour button answers", sentIn(r, "pick green").includes('"choice":["G"]'), sentIn(r, "pick green").slice(0, 200));
  // (choose two keeps Done: only a single pick answers at the click, suite review 2026-10-27)
  ok("by hand: two modes picked, then Confirm answers both", sentIn(r, "confirm modes").includes('"choice":["0","2"]') && !sentIn(r, "two modes").includes('"choice"'), sentIn(r, "confirm modes").slice(0, 200));
}
// the board-update timers (engineProfile.sect, engineRender's sect marks) name every section after a board update
{
  const names = ["status", "takeFromPiles", "keepStashed", "battlefield", "attached", "piles", "commandHand", "library", "popups", "stack", "glow", "dispose", "trackers", "browse", "panels"];
  const r = run([q(`local miss = {} for _, n in ipairs({ "${names.join('", "')}" }) do if engineProfile.sect[n] == nil then miss[#miss + 1] = n end end return "missing:" .. table.concat(miss, ",")`, "sections")]);
  // (a marker, not an empty string: the sim drops empty return values)
  ok("profiler: every engineRender section is timed", valueOf(r, "sections") === "missing:", String(valueOf(r, "sections")));
}
// a list longer than the answer buttons pages with its last button (2026-10-23: 30 buttons, was 60 and cut off)
{
  const sent = (r, mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  const opts = Array.from({ length: 70 }, (_, i) => ({ id: `o${i + 1}`, label: `Opt ${i + 1}` }));
  const text = (k, mark) => q(`return tostring(UI.getAttribute("eng_opt_Blue_${k}", "text"))`, mark);
  const more = (mark) => q('onMtgSlot(Player.Blue, nil, "eng_opt_Blue_30")', mark);
  const r = run([ask({ promptId: 820, title: "Choose one", mode: "single", options: opts }),
    text(30, "more label"), text(1, "page 1 first"),
    more("more 1"), text(1, "page 2 first"),
    more("more 2"), text(1, "page 3 first"), text(12, "page 3 last"), q('return tostring(UI.getAttribute("eng_opt_Blue_13", "active"))', "page 3 after last"),
    more("more 3"), text(1, "wrapped first"),
    more("more 4"), q('onMtgSlot(Player.Blue, nil, "eng_opt_Blue_2")', "pick")]);
  ok("paging: the last button says More", valueOf(r, "more label") === "More... (1-29 of 70)", valueOf(r, "more label"));
  ok("paging: page one starts at the first option", valueOf(r, "page 1 first") === "Opt 1", valueOf(r, "page 1 first"));
  ok("paging: More shows the next 29", valueOf(r, "page 2 first") === "Opt 30", valueOf(r, "page 2 first"));
  ok("paging: the last page ends at the last option", valueOf(r, "page 3 first") === "Opt 59" && valueOf(r, "page 3 last") === "Opt 70" && valueOf(r, "page 3 after last") === "false", [valueOf(r, "page 3 first"), valueOf(r, "page 3 last"), valueOf(r, "page 3 after last")].join(" / "));
  ok("paging: More on the last page goes back to the first", valueOf(r, "wrapped first") === "Opt 1", valueOf(r, "wrapped first"));
  ok("paging: a button on page two answers that page's option", sent(r, "pick").includes('"choice":["o31"]'), sent(r, "pick").slice(0, 200));
  ok("paging: More answers nothing", !sent(r, "more 1").includes("choice"), sent(r, "more 1").slice(0, 200));
}
// four players' screen UI stays under 60 KB (two players at 64 KB lost the second player's buttons), and no event
// attribute moves into <Defaults> (TTS was checked to honour "active" there, not onClick)
{
  const seated = ["Blue", "White", "Red", "Yellow"];
  const r = simulate({ save, seated, steps: [...prefix, q("return tostring(engineXmlSize)", "size"),
    q('local x = UI.getXml() return ((x:find("SearchPanel", 1, true) or x:find("ListPanel", 1, true)) and "there" or "gone") .. " " .. ((x:find("<Defaults>", 1, true) and x:find("eng_opt_Blue_1", 1, true)) and "kept" or "lost")', "dead panels"),
    q('local x = UI.getXml() local a = x:find("<Defaults>", 1, true) local b = a and x:find("</Defaults>", a, true) local d = b and x:sub(a, b) or "" return (d:find(" on%u%a*=") and "event" or "clean") .. " " .. tostring(select(2, x:gsub("eng_opt_Yellow_%d+", "")))', "defaults")] });
  ok("UI size: four seats under 60 KB", Number(valueOf(r, "size")) > 20000 && Number(valueOf(r, "size")) < 60000, valueOf(r, "size"));
  ok("UI size: the dead Scryfall panels are left out, the rest kept", valueOf(r, "dead panels") === "gone kept", valueOf(r, "dead panels"));
  ok("UI size: every seat built, no events in <Defaults>", valueOf(r, "defaults") === "clean 30", valueOf(r, "defaults"));
}
// flick containment: a movable card nobody holds that ends up off its owner's mat goes back (2026-10-23)
{
  const id = blueBf[0];
  const find = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end`;
  const where = (mark) => q(find + ' local p = o.getPosition() local h = engineContainHome("' + id + '") return string.format("%.1f %.1f home %.1f %.1f", p.x, p.z, h.x, h.z)', mark);
  const atHome = (v) => { const m = /^(\S+) (\S+) home (\S+) (\S+)$/.exec(String(v)); return !!m && m[1] === m[3] && m[2] === m[4]; };
  // off the table's middle (no one's mat), moving
  const fling = (extra) => q(find + ' o.setPosition(Vector(0, 3, 0)) o.setVelocity(Vector(8, 0, 3)) ' + (extra || ""), "fling");
  {
    const r = run([where("before"), fling(), { frames: 20 }, where("after"), q('return tostring(engineContain.back)', "count")]);
    ok("precondition: the card is on Blue's battlefield, unlocked", atHome(valueOf(r, "before")), valueOf(r, "before"));
    ok("containment: a flung card comes back to where it lay", atHome(valueOf(r, "after")), valueOf(r, "after"));
    ok("containment: it is stopped first", r.steps.some((st) => (st.fx || []).some((l) => /"setVelocity" .* V\(0,0,0\)/.test(l))), "no setVelocity(0)");
    ok("containment: counted once", valueOf(r, "count") === "1", valueOf(r, "count"));
  }
  {
    const r = run([fling(' o.held_by_color = "Blue"'), { frames: 20 }, where("held")]);
    ok("containment: a card a player holds is left alone", /^0\.0 0\.0 /.test(String(valueOf(r, "held"))), valueOf(r, "held"));
  }
  {
    const r = run([q('engineFix = { id = 1, state = "editing" }', "fix"), fling(), { frames: 20 }, where("fixing")]);
    ok("containment: off while a manual fix is under way", /^0\.0 0\.0 /.test(String(valueOf(r, "fixing"))), valueOf(r, "fixing"));
  }
  {
    // moved on its own mat (away from where it was put), rested; then flung: it comes back to the new spot
    const r = run([q(find + ' local m = data.Blue.playmat.getPosition() local h = engineContainHome("' + id + '") local p = Vector(m.x + (h.x > m.x and -4 or 4), h.y, m.z) o.setPosition(p) return string.format("%.1f %.1f", p.x, p.z)', "moved"),
      { frames: 20 }, where("rested"), fling(), { frames: 20 }, where("after")]);
    ok("containment: moving it on your own mat is free", String(valueOf(r, "rested")).startsWith(String(valueOf(r, "moved")) + " "), `${valueOf(r, "moved")} -> ${valueOf(r, "rested")}`);
    ok("containment: flung after that, it goes back to where it rested", String(valueOf(r, "after")).startsWith(String(valueOf(r, "moved")) + " "), `${valueOf(r, "moved")} -> ${valueOf(r, "after")}`);
  }
  {
    // still sliding across your own mat when the check comes: not a resting place, so a fling then goes back home
    const r = run([q(find + ' local m = data.Blue.playmat.getPosition() local h = engineContainHome("' + id + '") o.setPosition(Vector(m.x + (h.x > m.x and -4 or 4), h.y, m.z)) o.setVelocity(Vector(6, 0, 0)) return string.format("%.1f %.1f", h.x, h.z)', "sliding"),
      { frames: 20 }, fling(), { frames: 20 }, where("after")]);
    const home0 = String(valueOf(r, "sliding"));
    ok("containment: a spot it only slid through is not where it goes back to", String(valueOf(r, "after")).startsWith(home0 + " "), `home before ${home0}, after ${valueOf(r, "after")}`);
  }
}
// a cost question with Cancel offers it in the corner (2026-10-23 suite: it was only in the hidden panel)
{
  const sent = (r, mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  const r = run([ask({ promptId: 830, title: "Discard a card", mode: "multi", min: 1, max: 1, cancel: true, options: [{ id: "engine-card-1", label: "A" }, { id: "engine-card-2", label: "B" }] }),
    q('return tostring(UI.getAttribute("eng_big2_Blue", "text")) .. "|" .. tostring(UI.getAttribute("eng_big2_Blue", "active"))', "corner"),
    q('onMtgBig2(Player.Blue, nil, "eng_big2_Blue")', "press"),
    ask({ promptId: 831, title: "Discard a card", mode: "multi", min: 1, max: 1, options: [{ id: "engine-card-1", label: "A" }, { id: "engine-card-2", label: "B" }] }),
    q('return tostring(UI.getAttribute("eng_big2_Blue", "active"))', "no cancel")]);
  ok("cost cancel: the corner's second button says Cancel", valueOf(r, "corner") === "Cancel|true", valueOf(r, "corner"));
  ok("cost cancel: pressing it answers Cancel", sent(r, "press").includes('"choice":["__cancel"]'), sent(r, "press").slice(0, 200));
  ok("cost cancel: a question without Cancel shows no second button", valueOf(r, "no cancel") === "false", valueOf(r, "no cancel"));
}
// the page belongs to the question as shown: a later step of the same prompt (same id, another title) starts at page one
{
  const opts = (n) => Array.from({ length: n }, (_, i) => ({ id: `o${i + 1}`, label: `Opt ${i + 1}` }));
  const r = run([ask({ promptId: 840, title: "Step one", mode: "single", options: opts(70) }),
    q('onMtgSlot(Player.Blue, nil, "eng_opt_Blue_30")', "more"),
    ask({ promptId: 840, title: "Step two", mode: "single", options: opts(70) }),
    q('return tostring(UI.getAttribute("eng_opt_Blue_1", "text"))', "first")]);
  ok("paging: the next step of a question starts at page one", valueOf(r, "first") === "Opt 1", valueOf(r, "first"));
}
// a commander dragged out to be cast lies on the battlefield until the engine answers: containment leaves it there
{
  const r = run([q('local id for _, pl in ipairs(engineTable().players) do if pl.color == "Blue" and pl.command and pl.command[1] then id = pl.command[1].id end end local o for _, x in ipairs(getObjects()) do if id and x.getGMNotes() == "engine:" .. id then o = x end end '
      + 'if not o then return "no commander" end local m = data.Blue.playmat.getPosition() o.setPosition(Vector(m.x, 1.5, m.z)) onObjectDrop("Blue", o) return "dropped"', "drop"),
    { frames: 30 },
    q('local id for _, pl in ipairs(engineTable().players) do if pl.color == "Blue" and pl.command and pl.command[1] then id = pl.command[1].id end end local o for _, x in ipairs(getObjects()) do if id and x.getGMNotes() == "engine:" .. id then o = x end end '
      + 'local m, p = data.Blue.playmat.getPosition(), o.getPosition() return string.format("%.1f", math.sqrt((p.x - m.x) ^ 2 + (p.z - m.z) ^ 2))', "after")]);
  ok("precondition: Blue's commander is in the command zone", valueOf(r, "drop") === "dropped", valueOf(r, "drop"));
  ok("containment: a commander dragged out to be cast stays where it was dropped", valueOf(r, "after") === "0.0", valueOf(r, "after"));
}
// a card that is only movable because a question asks for it (here: its owner is no longer seated) is never
// rearranged where it rests: it slides back to where the board put it
{
  const id = blueBf[0];
  const find = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end`;
  const r = run([ask({ promptId: 850, title: "Target: choose 1 target", mode: "multi", min: 1, max: 1, options: [{ id: `card|${id}`, label: "it" }] }),
    q(find + ' __sim.seated.Blue = nil local m = data.Blue.playmat.getPosition() local h = engineContainHome("' + id + '") o.setPosition(Vector(m.x + (h.x > m.x and -4 or 4), h.y, m.z)) o.setVelocity(Vector(0, 0, 0)) return string.format("%.1f %.1f", h.x, h.z)', "moved"),
    { frames: 20 },
    q(find + ' local p = o.getPosition() return string.format("%.1f %.1f", p.x, p.z)', "after")]);
  ok("containment: a card movable only for a question goes back, not rearranged", valueOf(r, "after") === valueOf(r, "moved") && valueOf(r, "moved") !== undefined, `home ${valueOf(r, "moved")}, after ${valueOf(r, "after")}`);
}
// engineXmlCompact: a shared look becomes a class; ids, events and an element's own class stay on the element
{
  const xml = '<Button id="a" onClick="f" color="#111" fontSize="9">A</Button><Button id="b" onClick="f" color="#111" fontSize="9">B</Button>'
    + '<Text class="own" color="#222">x</Text><Text class="own" color="#222">y</Text><Image id="c" color="#333"></Image>';
  const r = run([q("local x, d = engineXmlCompact('" + xml + "') return x .. '##' .. d", "compact")]);
  const [out, defs] = String(valueOf(r, "compact")).split("##");
  ok("compact: a shared look becomes one class", /<Button id="a" onClick="f" class="m1">A<\/Button><Button id="b" onClick="f" class="m1">B<\/Button>/.test(out) && defs === '<Button class="m1" color="#111" fontSize="9"/>', `${out} || ${defs}`);
  ok("compact: a look only one element has stays on it (a class would only add bytes)", out.includes('<Image id="c" color="#333"></Image>'), out);
  ok("compact: an element with its own class is left as written", out.includes('<Text class="own" color="#222">x</Text><Text class="own" color="#222">y</Text>'), out);
}
// blocking by clicks: each click arrives as select + pick up. The second half must neither take the block back nor say
// "You can only touch your own cards" about the attacker (playtest 2026-10-24: blocking looked broken)
{
  const blocker = blueBf[0];
  const objOf = (id) => `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:" .. ${id} then o = x end end`;
  const theirs = 'local id for _, pl in ipairs(engineTable().players) do if pl.color == "White" and pl.command and pl.command[1] then id = pl.command[1].id end end ';
  const click = (idExpr, mark) => q((idExpr.startsWith("local") ? idExpr + objOf("id") : objOf(JSON.stringify(idExpr))) + ' onPlayerAction(Player.Blue, Player.Action.Select, { o }) onPlayerAction(Player.Blue, Player.Action.PickUp, { o })', mark);
  const r = run([q(theirs + 'return id or "none"', "attacker id")]);
  const attacker = String(valueOf(r, "attacker id"));
  const r2 = run([ask({ promptId: 860, kind: "block", title: "Declare blockers", mode: "multi", min: 0, max: 1, options: [{ id: `${blocker}|${attacker}`, label: "block" }] }),
    click(blocker, "click blocker"), click(theirs, "click attacker"),
    q('return tostring(engineSelectedFor("Blue", 1))', "selected")]);
  const msgs = (mark) => fxOf(r2, mark).filter((l) => l.includes("broadcastToColor")).join(" | ");
  ok("precondition: White's commander is an engine card", /^engine-card-\d+$/.test(attacker), attacker);
  ok("blocking: click your creature, then the attacker: the block is chosen", valueOf(r2, "selected") === "true", `selected=${valueOf(r2, "selected")} msgs=${msgs("click attacker")}`);
  ok("blocking: the attacker's click says the block, not \"only touch your own cards\"", /blocks/.test(msgs("click attacker")) && !/only touch your own/.test(msgs("click attacker")), msgs("click attacker"));
}
// a target pick that waits for Done says so in the chat, and a second click says it was taken back (hp-12 re-test
// 2026-10-27: "up to 1 target to fight" took clicks silently, and the second click undid the first)
{
  const id = blueBf[0];
  const click = (mark) => q(`local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end onPlayerAction(Player.Blue, Player.Action.Select, { o }) onPlayerAction(Player.Blue, Player.Action.PickUp, { o }) __sim.frames(30)`, mark);
  const r = run([ask({ promptId: 861, kind: "target", title: "Apex Altisaur: choose up to 1 target to fight", mode: "multi", min: 0, max: 1, options: [{ id: `card|${id}`, label: "Angel Token" }] }),
    click("first"), click("second")]);
  const said = (mark) => fxOf(r, mark).filter((l) => l.includes("broadcastToColor")).join(" | ");
  ok("target pick: a click that waits for Done says it was chosen", /Chosen\. Click it again to undo/.test(said("first")), said("first") + " " + r.errors.join(" | "));
  ok("target pick: a second click says it was taken back", /Taken back/.test(said("second")), said("second"));
  // (a single target answers at the click: no "Taken back" after it; a card pick's second click takes it back, not
  // "Chosen", suite review 2026-10-27)
  const r2 = run([ask({ promptId: 862, kind: "target", title: "Choose target creature", mode: "single", options: [{ id: `card|${id}`, label: "Angel Token" }] }), click("single")]);
  const said2 = (mark) => fxOf(r2, mark).filter((l) => l.includes("broadcastToColor")).join(" | ");
  ok("target pick: a single target's click says no 'Taken back'", !/Taken back|Chosen\./.test(said2("single")) && fxOf(r2, "single").some((l) => l.includes("answer") && l.includes("862")), said2("single") + " || " + fxOf(r2, "single").filter((l) => /answer/.test(l)).join(" ").slice(0, 200));
  const r3 = run([ask({ promptId: 863, kind: "cards", title: "Choose up to two creatures", mode: "multi", min: 0, max: 2, options: [{ id, label: "Card" }, { id: "engine-card-99999", label: "Other" }] }),
    click("card first"), click("card second")]);
  const said3 = (mark) => fxOf(r3, mark).filter((l) => l.includes("broadcastToColor")).join(" | ");
  ok("card pick: the first click says chosen", /Chosen\. Click it again/.test(said3("card first")), said3("card first"));
  ok("card pick: a second click says taken back, not chosen", /Taken back/.test(said3("card second")) && !/Chosen\./.test(said3("card second")), said3("card second"));
}
// a rewind everyone agreed to, waiting for a player who is answering something else: the banner names them
{
  const r = run([q('engineRewindUpdate({ points = {}, vote = { id = 5, to = "turn 10", by = "Blue", waiting = {}, status = "pending", note = "Agreed: it happens when Yellow answers choose a creature type." } }, false) return tostring(UI.getAttribute("eng_vote_Blue", "active"))', "vote")]);
  const txt = fxOf(r, "vote").filter((l) => l.includes("eng_votetext_Blue")).join(" ");
  ok("rewind agreed: the banner says who it waits for", /when Yellow answers choose a creature type/.test(txt) && valueOf(r, "vote") === "true", txt + " / " + valueOf(r, "vote"));
}
// the attack corner, as Arena: nothing chosen: No attacks / All attack; one chosen: Attack (1) / No attacks
// (playtest 2026-10-24: "it says All attack but no No attacks")
{
  const corner = (mark) => q('return tostring(UI.getAttribute("eng_big_Blue", "text")) .. "|" .. tostring(UI.getAttribute("eng_big2_Blue", "text"))', mark);
  const r = run([ask({ promptId: 870, kind: "attack", title: "Declare attackers", mode: "multi", min: 0, max: 3, options: [
      { id: "__allattack", label: "All attack" }, { id: "__noattack", label: "No attacks" }, { id: "engine-card-1|player-1", label: "A attacks White" }] }),
    corner("none chosen"), q('engineCornerPress("Blue", "small")', "press all"),
    ask({ promptId: 871, kind: "attack", title: "Declare attackers", mode: "multi", min: 0, max: 3, options: [
      { id: "__allattack", label: "All attack" }, { id: "__noattack", label: "No attacks" }, { id: "engine-card-1|player-1", label: "A attacks White" }] }),
    q('enginePickById("Blue", "engine-card-1|player-1")', "choose one"), corner("one chosen"), q('engineCornerPress("Blue", "big")', "press attack")]);
  const sent = (mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  ok("attack corner: nothing chosen says No attacks / All attack", valueOf(r, "none chosen") === "No attacks|All attack", valueOf(r, "none chosen"));
  ok("attack corner: the second button attacks with everything", sent("press all").includes('"choice":["__allattack"]'), sent("press all").slice(0, 200));
  ok("attack corner: one chosen says Attack (1) / No attacks", valueOf(r, "one chosen") === "Attack (1)|No attacks", valueOf(r, "one chosen"));
  ok("attack corner: Attack sends the chosen attacker", sent("press attack").includes('"choice":["engine-card-1|player-1"]'), sent("press attack").slice(0, 200));
}
// scry the table's way (2026-10-24): the cards go into the second hand zone; dragged onto the library they stay on top,
// the last one dragged on top; clicked, a card goes to the bottom; the last one out of the zone answers
{
  const IMG = "https://img.klrmngr.com/display/front/0/0/00a87f71-8dbe-44e1-b69b-a03f6ab62055.webp";
  const scryAsk = (pid, ids) => ask({ promptId: pid, kind: "cards", title: "Scry " + ids.length + ": choose cards to put on the bottom", mode: "multi", min: 0, max: ids.length,
    dest: "library", scry: { move: "libraryBottom", keep: "libraryTop" }, options: ids.map((id) => ({ id, label: "Card " + id, img: IMG })) });
  const objOf = (id) => `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end`;
  const inZone = (id, mark) => q(objOf(id) + ' if not o then return "none" end local inH = false for _, h in ipairs(Player.Blue.getHandObjects(2)) do if h == o then inH = true end end return (inH and not o.getLock()) and "hand2" or "elsewhere"', mark);
  const toLibrary = (id, mark) => q(objOf(id) + ' o.setPosition(data.Blue.libraryZone.getPosition()) onObjectDrop("Blue", o)', mark);
  const sent = (r, mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest") && l.includes("answer")).join(" ").split("\\").join("");
  const r = run([scryAsk(880, ["engine-card-9001", "engine-card-9002"]), inZone("engine-card-9001", "zone 1"), inZone("engine-card-9002", "zone 2"),
    toLibrary("engine-card-9002", "drag 2"), { frames: 6 }, toLibrary("engine-card-9001", "drag 1"), { frames: 6, mark: "after drags" }]);
  ok("scry: the cards are in the second hand zone", valueOf(r, "zone 1") === "hand2" && valueOf(r, "zone 2") === "hand2", `${valueOf(r, "zone 1")} / ${valueOf(r, "zone 2")}`);
  const all = r.steps.map((st) => (st.fx || []).filter((l) => l.includes("WebRequest") && l.includes("answer")).join(" ")).join(" ").split("\\").join("");
  ok("scry: the last card dragged out answers, the last dragged on top", all.includes('"choice":["__tts","top:engine-card-9001","top:engine-card-9002"]'), all.slice(0, 300));
  const r2 = run([scryAsk(881, ["engine-card-9003", "engine-card-9004"]),
    q(objOf("engine-card-9003") + ' onPlayerAction(Player.Blue, Player.Action.Select, { o }) onPlayerAction(Player.Blue, Player.Action.PickUp, { o })', "click 3"),
    q('engineConfirm("Blue")', "done")]);
  ok("scry: a clicked card goes to the bottom, Done sends it", sent(r2, "done").includes('"choice":["__tts","move:engine-card-9003"]'), sent(r2, "done").slice(0, 300));
}
// ability boxes (2026-10-24; buttons like the counter badges since 2026-10-26): at your priority, each of your permanents
// with an ability shows a grey box beside it, one button per ability as the engine words it; clicking one uses it (its
// owner's click only). Mana abilities get none.
{
  const id = blueBf[0];
  const objOf = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end`;
  const prio = (pid, extra) => ask({ promptId: pid, kind: "priority", title: "Your priority", mode: "single", options: [
    { id: "__pass", label: "Next" }, ...extra] });
  const buttons = 'local out = {} for _, b in ipairs(o.getButtons() or {}) do out[#out + 1] = b.label end return table.concat(out, "||")';
  const r = run([q(objOf + ' return o.getName():match("^[^\\n]*")', "name")]);
  const name = String(valueOf(r, "name"));
  const r2 = run([prio(890, [{ id: "prompt-action-3", cardId: id, label: name + ": {1}, {T}: Draw a card." }, { id: `tap:${id}:0`, cardId: id, label: "Tap " + name + " for {G}" }]),
    q(objOf + ' __sim.frames(3) ' + buttons, "xml"),
    q(objOf + ' onMtgAbility(Player.White, nil, "ab|" .. o.getGUID() .. "|1")', "white click"),
    q(objOf + ' onMtgAbility(Player.Blue, nil, "ab|" .. o.getGUID() .. "|1")', "click"),
    prio(891, [{ id: "__x", label: "Cast Something" }]),
    q(objOf + ' __sim.frames(3) ' + buttons, "xml after")]);
  const xml = String(valueOf(r2, "xml"));
  const sent = fxOf(r2, "click").filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  const whiteSent = fxOf(r2, "white click").filter((l) => l.includes("WebRequest")).join(" ");
  ok("ability box: the card shows its ability as a button", xml.includes("{1}, {T}: Draw a card.") && !xml.includes(name + ": {1}"), name + " :: " + xml.slice(-260) + " " + r2.errors.join(" | "));
  ok("ability box: mana abilities get no button", !xml.includes("for {G}"), xml.slice(-300));
  ok("ability box: another player's click does nothing", whiteSent === "", whiteSent.slice(0, 200));
  ok("ability box: clicking the button uses the ability", sent.includes('"choice":["prompt-action-3"]'), sent.slice(0, 200));
  ok("ability box: gone when the next question has no ability for the card", !String(valueOf(r2, "xml after")).includes("Draw a card"), String(valueOf(r2, "xml after")).slice(0, 200));
}
// two engine cards don't stack into a TTS deck (2026-10-24: a land dropped onto a land made both vanish)
{
  const s1b = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "table-stream-1v1.json"), "utf8"));
  let b; for (const m of s1b.slice(0, 40)) if (m.t === "table") { const pl = JSON.parse(m.json).players.find((x) => x.color === "Blue"); if (pl && pl.command && pl.command[0]) b = pl.command[0].id; }
  const a = blueBf[0];
  const objOf = (id, v) => `local ${v} for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then ${v} = x end end`;
  const r = run([q(objOf(a, "o1") + " " + objOf(b, "o2") + ' if not (o1 and o2) then return "missing" end return tostring(tryObjectEnterContainer(o2, o1))', "card on card"),
    q(objOf(a, "o1") + ' local plain = spawnObject({ type = "Card" }) return tostring(tryObjectEnterContainer(plain, o1))', "card on a non-engine card")]);
  ok("precondition: two of Blue's permanents on the table", b !== undefined && valueOf(r, "card on card") !== "missing", String(valueOf(r, "card on card")));
  ok("stacking: an engine card dropped on another engine card doesn't merge", valueOf(r, "card on card") === "false", String(valueOf(r, "card on card")));
  ok("stacking: other containers are left to TTS", valueOf(r, "card on a non-engine card") === "true", String(valueOf(r, "card on a non-engine card")));
}
// READY / Start come back by themselves when something wipes them (2026-10-24: after a game ended they stayed gone)
{
  const labels = 'local m = {} for _, b in ipairs(data.Blue.playmat.getButtons() or {}) do m[#m + 1] = b.label end local t = {} for _, o in ipairs(getObjects()) do if o.getGMNotes() == "mtgsetup" then for _, b in ipairs(o.getButtons() or {}) do t[#t + 1] = b.label end end end return table.concat(m, ",") .. "|" .. table.concat(t, ",")';
  const r = simulate({ save, steps: [{ lua: 'setEngineMode(true)', frames: 120 }, q(labels, "drawn"),
    q('data.Blue.playmat.clearButtons() for _, o in ipairs(getObjects()) do if o.getGMNotes() == "mtgsetup" then o.clearButtons() o.createButton({ click_function = "engineNoop", function_owner = Global, label = "Engine: off" }) end end', "wiped"),
    { frames: 200 }, q(labels, "after"),
    q('for _, o in ipairs(getObjects()) do if o.getGMNotes() == "mtgsetup" then o.clearButtons() o.createButton({ click_function = "engineNoop", function_owner = Global, label = "Engine: off" }) end end', "tile only"),
    { frames: 200 }, q(labels, "after tile")] });
  ok("precondition: READY? on Blue's mat and the tile drawn", /READY\?/.test(String(valueOf(r, "drawn"))) && /\|Engine: on$/.test(String(valueOf(r, "drawn"))), String(valueOf(r, "drawn")));
  ok("setup buttons: a stale middle tile alone is drawn again", valueOf(r, "after tile") === valueOf(r, "drawn"), String(valueOf(r, "after tile")));
  ok("setup buttons: wiped or stale, they are drawn again within 2 s", valueOf(r, "after") === valueOf(r, "drawn"), `${valueOf(r, "drawn")} -> ${valueOf(r, "after")}`);
}
// "Waiting for X..." flashes rainbow colours after 5 s of waiting, and goes back to normal when the wait ends
{
  const col = (mark) => q('return tostring(UI.getAttribute("eng_hint_Blue", "color")) .. "|" .. tostring(engineWaiting.Blue and engineWaiting.Blue.who)', mark);
  const waitFor = (who) => q('local t = engineTable() t.priority = "' + who + '" t.gameOver = false enginePrompts.Blue = nil engineUpdateCorner("Blue", nil)', "wait " + who);
  const r = run([waitFor("White"), { frames: 120 }, col("at 2 s"), { frames: 240 }, col("at 6 s"), { frames: 20 }, col("at 6.3 s"),
    q('local t = engineTable() t.priority = "Blue" engineUpdateCorner("Blue", nil)', "my turn"), col("after")]);
  const c = (m) => String(valueOf(r, m)).split("|")[0];
  const rainbow = ["#FF3B30", "#FF9500", "#FFCC00", "#34C759", "#00C7BE", "#007AFF", "#AF52DE"];
  ok("precondition: the hint says it waits for White", /|White$/.test(String(valueOf(r, "at 2 s"))), String(valueOf(r, "at 2 s")));
  ok("waiting flash: plain before 5 s", c("at 2 s") === "#F2F2F2", c("at 2 s"));
  ok("waiting flash: a rainbow colour after 5 s, and it changes", rainbow.includes(c("at 6 s")) && rainbow.includes(c("at 6.3 s")) && c("at 6 s") !== c("at 6.3 s"), c("at 6 s") + " / " + c("at 6.3 s"));
  ok("waiting flash: back to normal when the wait ends", c("after") === "#F2F2F2", c("after"));
}
// anyone seated switches engine mode, starts a game and clears a finished one; nobody unseated does; ending a game
// that is still going stays the host's (2026-10-25: "allow non host to turn the engine on and off and to start games")
{
  const mode = (mark) => q("return tostring(ENGINE_MODE)", mark);
  const sent = (r, mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  const r = simulate({ save, seated: ["Blue", "White"], host: "Blue", steps: [{ lua: "setEngineMode(true)", frames: 60 }, mode("on"),
    q('engineChat("mtg engine off", Player.White)', "White off"), mode("after White off"),
    q('engineChat("mtg engine on", Player.Red)', "Red on"), mode("after Red on"),
    q('engineChat("mtg engine on", Player.White)', "White on"), mode("after White on"),
    q('engineChat("mtg start ai 1", Player.White)', "White start"),
    q('engineStartSentAt = nil engineChat("mtg start ai 1", Player.Red)', "Red start"),
    q('engineTable = function() return { gameOver = false } end engineChat("mtg reset", Player.White)', "White reset mid-game"),
    q('engineTable = function() return { gameOver = true } end engineChat("mtg reset", Player.White)', "White reset after"),
    q('engineTable = function() return { gameOver = true } end engineChat("mtg reset", Player.Red)', "Red reset after")] });
  ok("precondition: engine mode on", valueOf(r, "on") === "true", String(valueOf(r, "on")));
  ok("non-host: seated White turns engine mode off", valueOf(r, "after White off") === "false", String(valueOf(r, "after White off")));
  ok("non-host: unseated Red can't turn it on", valueOf(r, "after Red on") === "false" && fxOf(r, "Red on").some((l) => /Sit at a colour/.test(l)), String(valueOf(r, "after Red on")));
  ok("non-host: seated White turns it on again", valueOf(r, "after White on") === "true", String(valueOf(r, "after White on")));
  ok("non-host: seated White starts a game", /"start"|start/.test(sent(r, "White start")) && /seats/.test(sent(r, "White start")), sent(r, "White start").slice(0, 200));
  ok("non-host: unseated Red can't start", !/seats/.test(sent(r, "Red start")) && fxOf(r, "Red start").some((l) => /Sit at a colour/.test(l)), sent(r, "Red start").slice(0, 200));
  ok("non-host: White can't end a game that is still going", !/reset/.test(sent(r, "White reset mid-game")) && fxOf(r, "White reset mid-game").some((l) => /still going/.test(l)), sent(r, "White reset mid-game").slice(0, 200));
  ok("non-host: White clears a finished game", /reset/.test(sent(r, "White reset after")), JSON.stringify(fxOf(r, "White reset after").slice(0, 3)));
  ok("non-host: unseated Red can't clear it", !/reset/.test(sent(r, "Red reset after")), sent(r, "Red reset after").slice(0, 200));
}
// a question closing leaves its hand cards unlocked: a locked card drops out of its hand zone and shows to everyone
// until the next redraw (Nicol Bolas, the Ravager, each opponent discards: the hands of the players who had answered lay
// open until the last one did, game 2026-11-01). A card that isn't in a hand locks again as before.
{
  let hand = [];
  for (const m of s1.slice(0, 40)) if (m.t === "table") { const pl = JSON.parse(m.json).players.find((x) => x.color === "Blue"); if (pl && pl.hand) hand = pl.hand.map((c) => c.id); }
  let whiteCard;
  for (const m of s1.slice(0, 40)) if (m.t === "table") { const pl = JSON.parse(m.json).players.find((x) => x.color !== "Blue"); if (pl && pl.battlefield && pl.battlefield[0]) whiteCard = pl.battlefield[0].id; }
  const lockOf = (id, mark) => q(`local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end return o and tostring(o.getLock()) or "none"`, mark);
  const r = run([ask({ promptId: 960, kind: "cards", title: "Nicol Bolas, the Ravager: discard a card", mode: "multi", min: 1, max: 1, options: [{ id: hand[0], label: "A" }, { id: hand[1], label: "B" }] }),
    lockOf(hand[0], "asked"), ask({}), lockOf(hand[0], "answered"), lockOf(hand[1], "answered 2"),
    ask({ promptId: 961, kind: "priority", title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }, { id: "prompt-action-1", cardId: hand[0], label: "Cast A" }] }),
    ask({}), lockOf(hand[0], "cast gone"),
    ask({ promptId: 962, title: "Target: choose a target", mode: "single", options: [{ id: `card|${whiteCard}`, label: "a card" }] }),
    lockOf(whiteCard, "target open"), ask({}), lockOf(whiteCard, "target closed")]);
  ok("precondition: Blue holds two cards and White has a permanent", hand.length >= 2 && whiteCard !== undefined, `${hand.length} / ${whiteCard}`);
  ok("hand cards: unlocked while the discard is asked", valueOf(r, "asked") === "false", valueOf(r, "asked"));
  ok("hand cards: a closed discard question leaves them unlocked", valueOf(r, "answered") === "false" && valueOf(r, "answered 2") === "false", `${valueOf(r, "answered")} / ${valueOf(r, "answered 2")}`);
  ok("hand cards: a Cast option going away leaves the card unlocked", valueOf(r, "cast gone") === "false", valueOf(r, "cast gone"));
  ok("hand cards: an opponent's permanent still locks again", valueOf(r, "target open") === "false" && valueOf(r, "target closed") === "true", `${valueOf(r, "target open")} / ${valueOf(r, "target closed")}`);
}
// Friendly mulligans: the vote button under READY, "mtg friendly", and Start sending the votes
{
  const vote = (mark) => q('return tostring(engineFriendlyVote.Blue) .. "|" .. tostring(engineFriendlyVote.White)', mark);
  const click = (who, mark) => q(`onMtgSetupFriendly(data.Blue.playmat, "${who}")`, mark);
  const label = (r, mark) => fxOf(r, mark).filter((l) => /createButton/.test(l) && /Friendly:/.test(l)).map((l) => l.match(/"Friendly: [^"]*"/)[0]).join(" ");
  const sent = (r, mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  const r = simulate({ save, seated: ["Blue", "White"], host: "Blue", steps: [{ lua: "setEngineMode(true)", frames: 60 }, q('SETUP_probe = 1', "drawn"),
    click("Blue", "one"), vote("after one"), click("White", "stranger"), vote("after stranger"), click("Blue", "two"), click("Blue", "back"), vote("after back"),
    q('engineChat("mtg friendly 2", Player.White)', "typed"), vote("after typed"), q('engineChat("mtg friendly 5", Player.White)', "typed bad"), vote("after bad"),
    q('engineChat("mtg friendly", Player.White)', "typed nothing"), vote("after nothing"),
    q('engineChat("mtg friendly 1", Player.Red)', "unseated"), q('return tostring(engineFriendlyVote.Red)', "red vote"),
    q('engineChat("mtg friendly 0", Player.Blue)', "typed none"), vote("after none"),
    q('engineSetFriendly("Blue", 1)', "blue 1"),
    q('engineChat("mtg start ai 1", Player.White)', "start"),
    q('engineClear()', "cleared"), vote("after clear")] });
  ok("friendly: no errors", r.errors.length === 0, r.errors.join(" | "));
  ok("friendly: a click votes 1 and the button says so", valueOf(r, "after one") === "1|nil" && label(r, "one").includes('"Friendly: 1"'), `${valueOf(r, "after one")} ${label(r, "one")}`);
  ok("friendly: another player's click is refused", valueOf(r, "after stranger") === "1|nil" && fxOf(r, "stranger").some((l) => /Blue's vote/.test(l)), JSON.stringify(fxOf(r, "stranger").slice(0, 2)));
  ok("friendly: 2, then back to none", label(r, "two").includes('"Friendly: 2"') && label(r, "back").includes('"Friendly: none"') && valueOf(r, "after back").startsWith("0|"), `${label(r, "two")} ${label(r, "back")} ${valueOf(r, "after back")}`);
  ok("friendly: typed vote", valueOf(r, "after typed") === "0|2" && fxOf(r, "typed").some((l) => /vote: 2/.test(l)), `${valueOf(r, "after typed")} ${JSON.stringify(fxOf(r, "typed").slice(0, 3))}`);
  ok("friendly: a bad number changes nothing and says how", valueOf(r, "after bad") === "0|2" && fxOf(r, "typed bad").some((l) => /Use: mtg friendly/.test(l)), valueOf(r, "after bad"));
  ok("friendly: no number changes nothing", valueOf(r, "after nothing") === "0|2" && fxOf(r, "typed nothing").some((l) => /Use: mtg friendly/.test(l)), valueOf(r, "after nothing"));
  ok("friendly: typed none reads none", fxOf(r, "typed none").some((l) => /vote: none/.test(l)) && valueOf(r, "after none") === "0|2", `${valueOf(r, "after none")} ${JSON.stringify(fxOf(r, "typed none").slice(0, 3))}`);
  ok("friendly: someone not seated can't vote", valueOf(r, "red vote") === "nil" && fxOf(r, "unseated").some((l) => /Sit at a colour/.test(l)), String(valueOf(r, "red vote")));
  ok("friendly: Start sends the votes", /"friendlyVotes":\{/.test(sent(r, "start")) && /"Blue":1/.test(sent(r, "start")) && /"White":2/.test(sent(r, "start")), sent(r, "start").slice(0, 300));
  ok("friendly: a rematch keeps the votes", valueOf(r, "after clear") === "1|2", valueOf(r, "after clear"));
}
// "mtg mana <n>": the manual fix in one line (call; once the game is paused for its caller, the mana and Done);
// 1-99 only; a pause that comes long after the call (someone else's fix later) adds nothing
{
  const sent = (r, mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  const editing = (by) => q(`engineFixUpdate({ id = 1, state = "editing", by = "${by}", waiting = {} }) __sim.frames(10)`, `editing ${by}`);
  const r = run([q('engineChat("mtg mana 99", Player.Blue)', "mana 99"), editing("Blue"),
    q('engineFixUpdate(nil) engineChat("mtg mana 0", Player.Blue)', "mana 0"),
    q('engineChat("mtg mana 100", Player.Blue)', "mana 100"),
    q('engineChat("mtg mana 5", Player.Blue) engineAutoMana.Blue.at = os.clock() - 60', "mana 5 late"), editing("Blue"),
    q('engineFixUpdate(nil) engineChat("mtg mana 7", Player.Blue)', "mana 7 for someone else's fix"), editing("White")]);
  const done = (m) => /"action":"done"/.test(sent(r, m)) && /"op":"mana"/.test(sent(r, m));
  ok("mtg mana: asks for a fix", /"action":"call"/.test(sent(r, "mana 99")), sent(r, "mana 99").slice(0, 200));
  ok("mtg mana: once paused, adds 99 of each and presses Done", done("editing Blue") && (sent(r, "editing Blue").match(/W W/g) || []).length > 40
    && (sent(r, "editing Blue").split("C").length - 1) >= 99, sent(r, "editing Blue").slice(0, 160));
  ok("mtg mana: 0 and 100 are refused", !/"action"/.test(sent(r, "mana 0") + sent(r, "mana 100")) && fxOf(r, "mana 100").some((l) => /1-99/.test(l)), sent(r, "mana 0"));
  const late = r.steps.filter((s) => s.step === "editing Blue")[1];
  ok("mtg mana: a pause long after the call adds nothing", late && !(late.fx || []).some((l) => l.includes("WebRequest") && l.includes("mana")), JSON.stringify((late && late.fx || []).slice(0, 2)));
  ok("mtg mana: someone else's pause doesn't take it", !/"op":"mana"/.test(sent(r, "editing White")), sent(r, "editing White").slice(0, 160));
}
// a manual fix names the other seat as the game log does ("AI 1 gets 5 of each colour", not "White"; bug h's leftover,
// real table 2026-11-05)
{
  const rename = 'for _, p in ipairs(engineTable().players) do if p.color == "White" then p.name = "AI 1" end end';
  const r = run([q(rename, "rename"), q('engineFixUpdate({ id = 1, state = "editing", by = "Blue", waiting = {} }) __sim.frames(10)', "editing"),
    q('engineChat("mtg fix mana 5 for white", Player.Blue)', "mana for"), q('engineChat("mtg fix life white 30", Player.Blue)', "life for"),
    q('engineChat("mtg fix token treasure for white", Player.Blue)', "token for"),
    // (99+ characters: "^(.-)%s+for..." raised "pattern too complex" in TTS, tmp/pattern-trap/audit.md)
    q('engineChat("mtg fix token ' + "big ".repeat(30) + ' saproling for white", Player.Blue)', "long token for"),
    q('return engineAbilityShort("{1}{G}: Put a +1/+1 counter on target creature.", 20) .. " | " .. engineAbilityShort(string.rep("word ", 40), 20) .. " | " .. engineAbilityShort("{T}:", 20)', "ability short")]);
  const said = (m) => fxOf(r, m).filter((l) => !l.includes("WebRequest")).join(" | ");
  ok("fix names: mana for a seat says its log name", /AI 1 gets 5 of each colour/.test(said("mana for")) && !/White gets/.test(said("mana for")), said("mana for").slice(0, 200));
  ok("fix names: life for a seat says its log name", /AI 1's life will be 30/.test(said("life for")), said("life for").slice(0, 200));
  ok("fix names: a token for a seat says its log name", /New token for AI 1/.test(said("token for")), said("token for").slice(0, 200));
  ok("long text: a 120-character token name for a seat", /New token for AI 1/.test(said("long token for")) && r.errors.length === 0, said("long token for").slice(0, 200) + " " + r.errors.join(" | "));
  ok("long text: ability labels split at the colon, a long one with none is cut", valueOf(r, "ability short") === "{1}{G}: Put a +1/+1 counter… | word word word word… | {T}:", valueOf(r, "ability short"));
}
// a card played by dragging it onto the mat lands in its row, not where it was dropped; a permanent the player moved
// on their own mat stays there (2026-10-26: lands stayed in the middle of the battlefield)
{
  const setup = 'local t = engineTable() local pl for _, p in ipairs(t.players) do if p.color == "Blue" then pl = p end end ' +
    'local c = pl.hand[1] __playId = c.id local function objOf(id) for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:" .. id then return x end end end local o = objOf(c.id) local m = data.Blue.playmat.getPosition() ' +
    '__dropAt = Vector(m.x, 1.5, m.z) o.setPosition(__dropAt) onObjectDrop("Blue", o) __sim.frames(5) ' +
    'return tostring(engineManualPlay[c.id])';
  const land = 'local t = engineTable() local pl for _, p in ipairs(t.players) do if p.color == "Blue" then pl = p end end ' +
    'local idx for i, c in ipairs(pl.hand) do if c.id == __playId then idx = i end end local c = table.remove(pl.hand, idx) ' +
    'table.insert(pl.battlefield, c) pl.keep = {} engineRender(t) __sim.frames(60) local function objOf(id) for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:" .. id then return x end end end local o = objOf(__playId) local p = o.getPosition() ' +
    'return string.format("%.1f", math.sqrt((p.x - __dropAt.x) ^ 2 + (p.z - __dropAt.z) ^ 2)) .. " " .. tostring(engineManualPlay[__playId] == nil)';
  const moveOwn = 'local function objOf(id) for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:" .. id then return x end end end local o = objOf(__playId) local m = data.Blue.playmat.getPosition() __ownAt = Vector(m.x + 2, 1.5, m.z - 1) ' +
    'o.setPosition(__ownAt) onObjectDrop("Blue", o) __sim.frames(5) engineRender(engineTable()) __sim.frames(60) local p = o.getPosition() ' +
    'return string.format("%.1f", math.sqrt((p.x - __ownAt.x) ^ 2 + (p.z - __ownAt.z) ^ 2))';
  const r = run([q(setup, "dropped"), q(land, "landed"), q(moveOwn, "moved own")]);
  ok("precondition: the drop is held as a play", String(valueOf(r, "dropped")) === "true", String(valueOf(r, "dropped")) + " " + r.errors.join(" | "));
  const [dist, cleared] = String(valueOf(r, "landed")).split(" ");
  ok("played by drag: on the battlefield it goes to its row, not the drop spot", Number(dist) > 1 && cleared === "true", String(valueOf(r, "landed")));
  ok("moved by the player on their mat: it stays there", Number(valueOf(r, "moved own")) < 0.5, String(valueOf(r, "moved own")));
}
// a card you may play from a graveyard shows its face in the playable row (2026-10-26: they lay as card backs)
{
  const setup = 'local t = engineTable() local pl for _, p in ipairs(t.players) do if p.color == "Blue" then pl = p end end ' +
    'engineStoreStatic("engine-card-777", { n = "Lunarch Veteran", f = "https://img.example/lunarch.jpg", ty = { "Creature" } }) ' +
    'pl.graveyard = pl.graveyard or {} table.insert(pl.graveyard, { s = 1, id = "engine-card-777" }) pl.playable = { { s = 1, id = "engine-card-777", z = "graveyard" } } pl.keep = {} ' +
    'engineRender(t) __sim.frames(90) local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:engine-card-777" then o = x end end ' +
    'if o == nil then return "no object" end local face for _, d in pairs(o.getData().CustomDeck or {}) do face = d.FaceURL end return tostring(face)';
  // (on the near strip of your own mat, past the land row; under the big buttons it was half hidden, 2026-10-26)
  const objOf = 'local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:engine-card-777" then o = x end end ';
  const where = objOf + 'local p, m, f = o.getPosition(), data.Blue.playmat.getPosition(), data.Blue.playmat.getTransformForward() ' +
    'return string.format("%.1f", (p - m):dot(f))';
  const sent = (mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  const r = run([q(setup, "playable"), q(where, "where"),
    q(objOf + 'o.setPosition(o.getPosition() + Vector(0.6, 1, 0.4)) onObjectDrop("Blue", o) __sim.frames(90) return "put back"', "put back"),
    q(objOf + 'local m = data.Blue.playmat.getPosition() o.setPosition(Vector(m.x, 1.5, m.z)) onObjectDrop("Blue", o) __sim.frames(90) return "dragged in"', "dragged in")]);
  ok("playable row: the card shows its picture, not a card back", String(valueOf(r, "playable")) === "https://img.example/lunarch.jpg", String(valueOf(r, "playable")) + " " + r.errors.join(" | "));
  // (rows lie along the mat's forward axis: the land row 3 at 1.6, the playable row 4.25 at 5.6)
  ok("playable row: on your mat, past the land row", Number(valueOf(r, "where")) > 4 && Number(valueOf(r, "where")) < 7, String(valueOf(r, "where")));
  ok("playable row: put down where it lies, it isn't played", !sent("put back").includes('"kind":"play"'), sent("put back").slice(0, 200));
  ok("playable row: dragged into the battlefield, it is played", sent("dragged in").split("\\").join("").includes('"kind":"play"'), sent("dragged in").slice(0, 200));
}
// a panel picture shows the card back until the new card's picture is set, and only the newest one is set
// (2026-10-26: a slow or dead picture left the previous card's showing)
{
  const r = run([q('engineSetImage("eng_pop_img", "https://img.example/a.jpg") local first = UI.getAttribute("eng_pop_img", "image") __sim.frames(5) return tostring(first) .. "|" .. tostring(UI.getAttribute("eng_pop_img", "image"))', "one"),
    q('engineSetImage("eng_pop_img", "https://img.example/b.jpg") engineSetImage("eng_pop_img", "https://img.example/c.jpg") __sim.frames(5) return tostring(UI.getAttribute("eng_pop_img", "image"))', "two")]);
  const [first, after] = String(valueOf(r, "one")).split("|");
  ok("panel picture: the card back first", /steamusercontent/.test(first), first + " " + r.errors.join(" | "));
  ok("panel picture: then the card's picture", after === "https://img.example/a.jpg", after);
  ok("panel picture: two in a row end on the newest", String(valueOf(r, "two")) === "https://img.example/c.jpg", String(valueOf(r, "two")));
  // (TTS draws whichever download ends last: an earlier picture still loading replaced the newest, hp-12 re-test
  // 2026-10-27. The simulator has no downloads; the late picture is written straight to the attribute here)
  const r2 = run([q('engineSetImage("eng_pop_img", "https://img.example/d.jpg") __sim.frames(10) UI.setAttribute("eng_pop_img", "image", "https://img.example/late.jpg") __sim.frames(600) return tostring(UI.getAttribute("eng_pop_img", "image"))', "late")]);
  ok("panel picture: a late earlier picture is replaced by the newest again", String(valueOf(r2, "late")) === "https://img.example/d.jpg", String(valueOf(r2, "late")) + " " + r2.errors.join(" | "));
  // (each re-assert pinned: a load landing in the first seconds is replaced within about 3 s, one landing later within 8 s)
  const lateAt = (landFrame, checkFrame, mark) => q(`engineSetImage("eng_pop_img", "https://img.example/${mark}.jpg") __sim.frames(${landFrame}) UI.setAttribute("eng_pop_img", "image", "https://img.example/late.jpg") __sim.frames(${checkFrame - landFrame}) return tostring(UI.getAttribute("eng_pop_img", "image"))`, mark);
  const r4 = run([lateAt(10, 200, "early"), lateAt(240, 500, "later")]);
  ok("panel picture: a late load in the first seconds is replaced within about 3 s", String(valueOf(r4, "early")) === "https://img.example/early.jpg", String(valueOf(r4, "early")));
  ok("panel picture: a late load after that is replaced within 8 s", String(valueOf(r4, "later")) === "https://img.example/later.jpg", String(valueOf(r4, "later")));
}
// a token's picture found after it was drawn (a card back): the next board keeps the battlefield (unchanged) and sends
// only the picture; the token is drawn again with it (hp-12 re-test 2026-10-27: two Angel tokens stayed card backs)
{
  const base = JSON.parse([...s1.slice(0, 40)].reverse().find((m) => m.t === "table").json);
  const one = structuredClone(base), two = structuredClone(base);
  const b1 = one.players.find((x) => x.color === "Blue");
  one.cards = { "tok-a": { n: "Angel Token", tok: true, ty: ["Creature"] } };
  b1.battlefield = [...(b1.battlefield || []), { id: "tok-a", s: 1, p: 4, t: 4 }];
  b1.keep = (b1.keep || []).filter((z) => z !== "battlefield");
  const b2 = two.players.find((x) => x.color === "Blue");
  two.cards = { "tok-a": { n: "Angel Token", tok: true, ty: ["Creature"], f: "https://img.example/angel.jpg" } };
  delete b2.battlefield;
  b2.keep = [...new Set([...(b2.keep || []), "battlefield"])];
  const r = run([{ msg: { t: "table", json: JSON.stringify(one) }, frames: 60, mark: "back" },
    { msg: { t: "table", json: JSON.stringify(two) }, frames: 60, mark: "pic" },
    q('local f = {} for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:tok-a" then for _, d in pairs((x.__d.data or {}).CustomDeck or {}) do f[#f + 1] = tostring(d.FaceURL) end end end return table.concat(f, ",")', "face")]);
  ok("token picture found later: the token is drawn with it", /img\.example\/angel\.jpg/.test(String(valueOf(r, "face"))), String(valueOf(r, "face")) + " " + r.errors.join(" | "));
}
// the step banner: shown when you are asked in a step (your priority), once per step, never with Auto-resolve on and
// never for other questions; the game-over banner names the winner (2026-10-26)
{
  const banner = (mark) => q('return tostring(UI.getAttribute("eng_banner_Blue", "active")) .. "|" .. tostring(UI.getValue("eng_banner_Blue"))', mark);
  const setStep = (step, turn) => `local t = engineTable() t.step = "${step}" t.turn = ${turn} t.active = "Blue" t.priority = "Blue" engineBannerAt = {} engineBannerSeen = engineBannerSeen or {} engineBannerSeen.Blue = "Blue|${turn}" `;
  const prio = (id) => ask({ promptId: id, title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }] });
  const r = run([
    q(setStep("main1", 41) + 'engineStepSeen = {} engineAutoResolve.Blue = nil', "set main1"), prio(901), { frames: 3 }, banner("main1 priority"),
    { frames: 120 }, q(setStep("main1", 41), "same step"), prio(902), { frames: 3 }, banner("main1 again"),
    q(setStep("draw", 42) + 'engineAutoResolve.Blue = true', "auto on"), prio(903), { frames: 3 }, banner("draw with auto"),
    q(setStep("main2", 42) + 'engineAutoResolve.Blue = nil', "main2"), ask({ promptId: 904, kind: "target", title: "Choose target", mode: "single", min: 1, max: 1, options: [{ id: "player|player-1", label: "White" }] }), { frames: 3 }, banner("main2 target"),
    q(setStep("cleanup", 42), "cleanup"), ask({ promptId: 905, title: "Discard 2 cards (hand size)", mode: "multi", min: 2, max: 2, options: [{ id: "card|x1", label: "A" }, { id: "card|x2", label: "B" }, { id: "card|x3", label: "C" }] }), { frames: 3 }, banner("cleanup discard"),
    q('return tostring(UI.getValue("eng_phase_Blue"))', "cleanup bar"),
    q('engineGameOverBanner({ winner = "Blue" }) return "over"', "game over"), banner("victory")]);
  const b = (m) => String(valueOf(r, m));
  ok("step banner: a priority question in main 1 shows MAIN PHASE 1", b("main1 priority") === "true|MAIN PHASE 1", b("main1 priority") + " " + r.errors.join(" | "));
  ok("step banner: a second question in the same step shows nothing new", b("main1 again").startsWith("false"), b("main1 again"));
  ok("step banner: never with Auto-resolve on", !/DRAW/.test(b("draw with auto")) || b("draw with auto").startsWith("false"), b("draw with auto"));
  ok("step banner: not for a target question", !/MAIN PHASE 2/.test(b("main2 target")), b("main2 target"));
  ok("step banner: the cleanup discard question shows CLEANUP", b("cleanup discard") === "true|CLEANUP", b("cleanup discard"));
  ok("step banner: the phase bar names cleanup", /CLEANUP/.test(b("cleanup bar")) && !/>END</.test(b("cleanup bar")), b("cleanup bar"));
  ok("game over: VICTORY for the winner", b("victory") === "true|VICTORY", b("victory"));
}
// the big button ignores clicks for 0.6 s after a new question changed its words (Resolve -> Next under the pointer
// passed a main phase, playtest 2026-10-26); your own picks changing it are covered by "attack corner" above
{
  const prio = (id, label) => ask({ promptId: id, title: "Your priority", mode: "single", options: [{ id: "__x" + id, label }, { id: "__endturn", label: "End turn" }] });
  const click = (mark) => q('engineCornerPress("Blue", "big") return "clicked"', mark);
  const sentOf = (r, m) => fxOf(r, m).filter((l) => l.includes("WebRequest")).join(" ");
  const r = run([prio(951, "Resolve"), { frames: 60 }, prio(952, "Next"), { frames: 2 }, click("at once"), { frames: 40 }, click("later"),
    prio(953, "Next"), { frames: 60 }, prio(954, "Next"), { frames: 2 }, click("same words"),
    prio(955, "Next"), { frames: 60 }, click("answer 955"), ask({ promptId: 956, kind: "mana", title: "Pay {1}", mode: "single", options: [{ id: "__auto", label: "Auto-pay" }, { id: "__cancel", label: "Cancel" }] }), { frames: 2 }, click("after acting")]);
  ok("main button: a click just after its words changed is ignored", !sentOf(r, "at once").includes("answer"), sentOf(r, "at once").slice(0, 200) + " " + r.errors.join(" | "));
  ok("main button: the same click 0.7 s later answers", sentOf(r, "later").includes("__x952"), sentOf(r, "later").slice(0, 200));
  ok("main button: after your own answer the next question's button answers at once", sentOf(r, "after acting").includes("__auto"), sentOf(r, "after acting").slice(0, 200));
  ok("main button: a new question with the same words answers at once", sentOf(r, "same words").includes("__x954"), sentOf(r, "same words").slice(0, 200));
}
// a copy (Phantasmal Image as Kenrith) carries a COPY badge; the card it copies doesn't (legend rule, 2026-10-26)
{
  const last = [...s1.slice(0, 40)].reverse().find((m) => m.t === "table" && (JSON.parse(m.json).players.find((x) => x.color === "Blue") || {}).battlefield);
  const tbl = JSON.parse(last.json);
  const pl = tbl.players.find((x) => x.color === "Blue");
  pl.battlefield = pl.battlefield.map((c) => (c.id === blueBf[0] ? { ...c, cp: true } : c));
  const labels = 'local out = {} for _, b in ipairs(o.getButtons() or {}) do out[#out + 1] = b.label end return table.concat(out, "|")';
  const objOf = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${blueBf[0]}" then o = x end end `;
  const r = run([{ frames: 30 }, q(objOf + labels, "before"), { msg: { t: "table", json: JSON.stringify(tbl) } }, { frames: 30 }, q(objOf + labels, "after")]);
  ok("copy badge: none before it is a copy", !String(valueOf(r, "before")).includes("COPY"), String(valueOf(r, "before")) + " " + r.errors.join(" | "));
  ok("copy badge: a copy shows COPY", String(valueOf(r, "after")).split("|").includes("COPY"), String(valueOf(r, "after")) + " " + r.errors.join(" | "));
}
// the power/toughness badge (live 2026-11-08: a 6/6 X/X Dinosaur Beast showed no number): shown whenever the card's
// numbers differ from its picture's (bp/bt), and always when the picture shows none (bp nil), in black; a face-down
// permanent's on its back, against the rules' 2/2
{
  const pick = 'local t = engineTable() local c for _, p in ipairs(t.players) do for _, x in ipairs(p.battlefield or {}) do if c == nil and x.id and x.att == nil and not x.fd then c = x end end end __ptId = c and c.id return tostring(__ptId)';
  const set = (fields, mark) => q(`local t = engineTable() for _, p in ipairs(t.players) do for _, x in ipairs(p.battlefield or {}) do if x.id == __ptId then x.dmg = 0 x.ctr = {} ${fields} end end end engineRender(t) __sim.frames(30)`, `set: ${mark}`);
  const pt = (mark) => q('local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:" .. tostring(__ptId) then o = x end end if o == nil then return "no card" end local out = {} ' +
    'for _, b in ipairs(o.getButtons() or {}) do if string.find(tostring(b.label), "^%-?%d+/%-?%d+$") then local col, pos = b.color or {}, b.position or {} ' +
    'out[#out + 1] = b.label .. "@" .. string.format("%.2f,%.2f,%.2f", col[1] or col.r or -1, col[2] or col.g or -1, col[3] or col.b or -1) .. "@y" .. string.format("%.1f", pos.y or pos[2] or 0) .. "@x" .. string.format("%.2f", pos.x or pos[1] or 0) .. "@rz" .. tostring((b.rotation or {})[3] or (b.rotation or {}).z or 0) end end return #out == 0 and "none" or table.concat(out, "|")', mark);
  // (the badge's position along the card's length)
  const ptZ = (mark) => q('local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:" .. tostring(__ptId) then o = x end end if o == nil then return "no card" end ' +
    'for _, b in ipairs(o.getButtons() or {}) do if string.find(tostring(b.label), "^%-?%d+/%-?%d+$") then local pos = b.position or {} return string.format("%.2f", pos.z or pos[3] or 0) end end return "none"', `${mark} z`);
  const r = run([{ frames: 30 }, q(pick, "pick"),
    set('x.p = "6" x.t = "6" x.bp = nil x.bt = nil', "6/6 no base"), pt("6/6 no base"),
    set('x.bp = 6 x.bt = 6', "6/6 base 6/6"), pt("6/6 base 6/6"),
    set('x.p = "2" x.t = "2" x.bp = 2 x.bt = 2', "2/2"), pt("2/2"),
    set('x.p = "3" x.t = "3"', "3/3 over 2/2"), pt("3/3 over 2/2"), ptZ("3/3 over 2/2"),
    set('x.p = "1" x.t = "1"', "1/1 under 2/2"), pt("1/1 under 2/2"),
    set('x.p = "6" x.t = "6" x.bp = nil x.bt = nil x.dmg = 1', "damaged no base"), pt("damaged no base"),
    set('x.p = "0" x.t = "1" x.bp = 0 x.bt = 1', "kelp"), pt("kelp"),
    set('x.p = "2" x.t = "2" x.bp = 2 x.bt = nil', "half known"), pt("half known"),
    set('x.p = "3" x.t = "3" x.bp = 2 x.bt = 2 engineFlipped[x.id] = true', "flipped over"), pt("flipped over"), ptZ("flipped over"), set('engineFlipped[x.id] = nil', "flipped back"),
    set('x.p = 2 x.t = 2 x.bp = 2 x.bt = 2 x.fd = true', "morph"), pt("morph"),
    set('x.p = 3 x.t = 3 x.bp = 2 x.bt = 2 x.fd = true', "pumped morph"), pt("pumped morph"), ptZ("pumped morph")]);
  const v = (m) => String(valueOf(r, m));
  const BLACK = "0.00,0.00,0.00", UP = "0.10,0.35,0.80", DOWN = "0.62,0.08,0.08";
  ok("pt badge: precondition, a card on the battlefield (given a P/T here)", v("pick") !== "nil", v("pick") + " " + r.errors.join(" | "));
  ok("pt badge: a picture with no numbers (bp nil) shows the P/T, black", v("6/6 no base") === `6/6@${BLACK}@y0.3@x0.62@rz0`, v("6/6 no base"));
  ok("pt badge: the picture's own 6/6 shows none", v("6/6 base 6/6") === "none", v("6/6 base 6/6"));
  ok("pt badge: an ordinary 2/2 shows none", v("2/2") === "none", v("2/2"));
  ok("pt badge: bigger than the picture, the up colour", v("3/3 over 2/2") === `3/3@${UP}@y0.3@x0.62@rz0`, v("3/3 over 2/2"));
  ok("pt badge: smaller than the picture, the down colour", v("1/1 under 2/2") === `1/1@${DOWN}@y0.3@x0.62@rz0`, v("1/1 under 2/2"));
  ok("pt badge: damage with no base is down, toughness left", v("damaged no base") === `6/5@${DOWN}@y0.3@x0.62@rz0`, v("damaged no base"));
  ok("pt badge: a 0/1 over a 0/1 picture shows none", v("kelp") === "none", v("kelp"));
  ok("pt badge: a base only half known shows, black", v("half known") === `2/2@${BLACK}@y0.3@x0.62@rz0`, v("half known"));
  ok("pt badge: a face-up card its owner turned over has it on its back", v("flipped over") === `3/3@${UP}@y-0.3@x-0.62@rz180`, v("flipped over"));
  ok("pt badge: a plain face-down 2/2 shows none", v("morph") === "none", v("morph") + " " + r.errors.join(" | "));
  ok("pt badge: a pumped face-down one shows on its back, at the same corner", v("pumped morph") === `3/3@${UP}@y-0.3@x-0.62@rz180`, v("pumped morph"));
  // (the position's third number too: the mirror of a card turned over is across its width, not its length)
  ok("pt badge: on the back it keeps its distance from the card's top", v("flipped over z") === v("3/3 over 2/2 z") && v("pumped morph z") === v("3/3 over 2/2 z") && v("3/3 over 2/2 z") !== "0.00",
    [v("3/3 over 2/2 z"), v("flipped over z"), v("pumped morph z")].join(" "));
}
// the status box reads the right way up from the card's controller's seat, as the card lies: tapped, turned over by its
// owner (on its back, "=under"), or both (verifier 2026-11-09: tapped and turned over, its rotation {0,-90,180} read
// upside down). Checked as TTS draws it: the object's rotation, then the button's, both Unity's Euler order (z, x, y).
{
  const pick = 'local t = engineTable() local c for _, p in ipairs(t.players) do for _, x in ipairs(p.battlefield or {}) do if c == nil and x.id and x.att == nil and not x.fd then c = x end end end __kwId = c and c.id return tostring(__kwId)';
  const set = (fields, mark) => q(`local t = engineTable() for _, p in ipairs(t.players) do for _, x in ipairs(p.battlefield or {}) do if x.id == __kwId then x.kw = { "Hexproof" } x.tap = false engineFlipped[x.id] = nil ${fields} end end end engineRender(t) __sim.frames(30)`, `set: ${mark}`);
  const v3 = (name) => `string.format("%.4f,%.4f,%.4f", ${name}.x or ${name}[1] or 0, ${name}.y or ${name}[2] or 0, ${name}.z or ${name}[3] or 0)`;
  const box = (mark) => q('local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:" .. tostring(__kwId) then o = x end end if o == nil then return "no card" end ' +
    'for _, b in ipairs(o.getButtons() or {}) do if b.label == "Hexproof" then local r, br, bp = o.getRotation(), b.rotation or {}, b.position or {} ' +
    `return ${v3("r")} .. "|" .. ${v3("br")} .. "|" .. ${v3("bp")} end end return "no box"`, mark);
  const r = run([{ frames: 30 }, q(pick, "pick"), set("", "plain"), box("plain"), set("x.tap = true", "tapped"), box("tapped"),
    set("engineFlipped[x.id] = true", "turned over"), box("turned over"), set("x.tap = true engineFlipped[x.id] = true", "tapped, turned over"), box("tapped, turned over"),
    set("", "back")]);
  const rad = Math.PI / 180;
  const mul = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
  const euler = ([x, y, z]) => {
    const [cx, sx, cy, sy, cz, sz] = [Math.cos(x * rad), Math.sin(x * rad), Math.cos(y * rad), Math.sin(y * rad), Math.cos(z * rad), Math.sin(z * rad)];
    return mul(mul([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]], [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]), [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]);
  };
  // (the box's orientation and its offset from the card's centre, on the table)
  const world = (mark) => {
    const parts = String(valueOf(r, mark)).split("|").map((s) => s.split(",").map(Number));
    if (parts.length !== 3 || parts.flat().some((n) => !Number.isFinite(n))) return null;
    const [obj, btn, pos] = parts;
    const o = euler(obj);
    return { turn: mul(o, euler(btn)), at: o.map((row) => row[0] * pos[0] + row[1] * pos[1] + row[2] * pos[2]) };
  };
  const near = (a, b) => a.flat().every((x, i) => Math.abs(x - b.flat()[i]) < 1e-6);
  const plain = world("plain");
  ok("status box: precondition, a card with a status box", String(valueOf(r, "pick")) !== "nil" && !!plain, String(valueOf(r, "plain")) + " " + r.errors.join(" | "));
  for (const mark of ["tapped", "turned over", "tapped, turned over"]) {
    const w = world(mark);
    ok(`status box: ${mark}, it reads the way it does on an untapped card`, !!plain && !!w && near(w.turn, plain.turn), String(valueOf(r, mark)));
    // (and lies face up, on the side that faces up)
    ok(`status box: ${mark}, its face is up`, !!w && w.turn[1][1] > 0.99, String(valueOf(r, mark)));
  }
  // (on its back it sits where it does face up: tapped or not, at the same place on the table)
  const at = (mark) => world(mark)?.at.map((n) => (Math.abs(n) < 5e-4 ? 0 : n).toFixed(3)).join(",");
  ok("status box: turned over, at the same place as face up", at("turned over") === at("plain"), `${at("turned over")} / ${at("plain")}`);
  ok("status box: tapped and turned over, at the same place as tapped face up", at("tapped, turned over") === at("tapped"), `${at("tapped, turned over")} / ${at("tapped")}`);
}
// a phased-out card stays where it was, dimmed and marked, and comes back as it was (2026-11-02: it used to vanish)
{
  const last = [...s1.slice(0, 40)].reverse().find((m) => m.t === "table" && (JSON.parse(m.json).players.find((x) => x.color === "Blue") || {}).battlefield);
  const tbl = JSON.parse(last.json);
  const pl = tbl.players.find((x) => x.color === "Blue");
  const back = JSON.stringify(tbl);
  pl.battlefield = pl.battlefield.map((c) => (c.id === blueBf[0] ? { ...c, po: true } : c));
  const objOf = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${blueBf[0]}" then o = x end end `;
  const look = objOf + 'local out = {} for _, b in ipairs(o.getButtons() or {}) do out[#out + 1] = b.label end local p = o.getPosition() return table.concat(out, "|") .. " tint " .. string.format("%.2f", o.getColorTint().r) .. string.format(" at %.1f,%.1f", p.x, p.z)';
  const r = run([{ frames: 30 }, q(look, "before"), { msg: { t: "table", json: JSON.stringify(tbl) } }, { frames: 30 }, q(look, "phased"), { msg: { t: "table", json: back } }, { frames: 30 }, q(look, "back")]);
  const where = (m) => String(valueOf(r, m)).replace(/^.* at /, "");
  ok("phased: not marked before", !String(valueOf(r, "before")).includes("PHASED OUT") && /tint 1\.00/.test(valueOf(r, "before")), String(valueOf(r, "before")) + " " + r.errors.join(" | "));
  ok("phased: marked PHASED OUT and dimmed", String(valueOf(r, "phased")).includes("PHASED OUT") && /tint 0\.38/.test(valueOf(r, "phased")), String(valueOf(r, "phased")) + " " + r.errors.join(" | "));
  ok("phased: the card stays where it was", where("phased") === where("before"), `${where("before")} -> ${where("phased")}`);
  ok("phased: back to normal when it phases in", !String(valueOf(r, "back")).includes("PHASED OUT") && /tint 1\.00/.test(valueOf(r, "back")), String(valueOf(r, "back")) + " " + r.errors.join(" | "));
}
// a phased-out token is no longer one of a group of tokens like it: the group's key tells them apart
{
  const r = run([q('local c = { n = "Soldier", ctl = "Blue", tap = false, p = 1, t = 1 } local a = engineTokenKey(c) c.po = true return tostring(a ~= engineTokenKey(c))', "key")]);
  ok("phased: a phased-out token leaves its group", valueOf(r, "key") === "true", String(valueOf(r, "key")) + " " + r.errors.join(" | "));
}
// an agreed rewind with a question open: a button that says where to, for everyone, and it sends rewindGo
{
  const r = run([q('engineRewindUpdate({ points = {}, vote = { id = 5, to = "turn 10, Red\'s main phase", by = "Blue", waiting = {}, status = "pending", go = true, note = "Everyone agreed." } }, false) return tostring(UI.getAttribute("eng_votego_Blue", "active")) .. "|" .. tostring(UI.getAttribute("eng_voteyes_Blue", "active"))', "shown"),
    q('onMtgVote(Player.Blue, nil, "eng_votego_Blue")', "press"),
    q('engineRewindUpdate({ points = {}, vote = { id = 5, to = "turn 10", by = "Blue", waiting = { "Red" }, status = "pending" } }, false) return tostring(UI.getAttribute("eng_votego_Blue", "active"))', "waiting")]);
  const text = fxOf(r, "shown").filter((l) => l.includes("eng_votego_Blue")).join(" ");
  ok("rewind go: the button shows, the vote buttons don't", valueOf(r, "shown") === "true|false", String(valueOf(r, "shown")) + " " + r.errors.join(" | "));
  // (a Button draws its text attribute: real TTS ignores UI.setValue on one, the simulator doesn't, and the button stayed "Rewind")
  const label = fxOf(r, "shown").filter((l) => l.includes("UI.setAttributes") && l.includes("eng_votego_Blue")).join(" ");
  ok("rewind go: it says where to, in the attribute a Button draws", label.includes("Rewind to turn 10, Red's main phase"), text.slice(0, 300));
  ok("rewind go: pressing it sends rewindGo", fxOf(r, "press").join(" ").split("\\").join("").includes("rewindGo"), fxOf(r, "press").join(" ").slice(0, 200));
  ok("rewind go: hidden while a vote is still open", valueOf(r, "waiting") === "false", String(valueOf(r, "waiting")));
}
// TTS's own rewind arrows and spare tools are covered while a game runs, under the table's buttons, for those whose bars they fit
{
  const cover = (mark) => q('return tostring(UI.getAttribute("eng_cover_1", "active")) .. tostring(UI.getAttribute("eng_cover_2", "active")) .. tostring(UI.getAttribute("eng_cover_3", "active"))', mark);
  const r = run([q('engineScoopRedraw()', "draw"), cover("running"), q('engineTable().gameOver = true engineScoopRedraw()', "end it"), cover("over"),
    q('engineTable().gameOver = false engineScoopRedraw()', "restart"), cover("again"), q('return tostring(engineToolCoverXml():find("^<Panel id=\\"eng_cover_1\\" visibility=\\"Admin\\"") ~= nil)', "xml")]);
  ok("covers: on while a game runs", valueOf(r, "running") === "truetruetrue", String(valueOf(r, "running")) + " " + r.errors.join(" | "));
  ok("covers: off when it ends", valueOf(r, "over") === "falsefalsefalse", String(valueOf(r, "over")));
  ok("covers: back on with a game", valueOf(r, "again") === "truetruetrue", String(valueOf(r, "again")));
  ok("covers: for the host and promoted players only", valueOf(r, "xml") === "true", String(valueOf(r, "xml")));
  // TTS scales the top bar from the screen's centre, so the arrows' cover has to hang from there (1920x1009 left the forward arrow bare)
  const a = run([q('return tostring(engineToolCoverXml():find(\'id="eng_cover_3" visibility="Admin" width="136" height="66" rectAlignment="UpperCenter" offsetXY="-505 -1"\', 1, true) ~= nil)', "arrows xml")]);
  ok("covers: the arrows' cover is anchored to the screen's centre", valueOf(a, "arrows xml") === "true", String(valueOf(a, "arrows xml")) + " " + a.errors.join(" | "));
}
// a deck stashed for a game is invisible to everyone while it is under the table, and visible again when it comes back
{
  const r = run([q(`stashTestDeck = spawnObject({ type = "Deck" }) stashTestDeck.setPosition(Vector(40, 2, 10))
      local real = getDeckFromZone getDeckFromZone = function() return stashTestDeck end
      engineStarted({ colors = { "White" } }) getDeckFromZone = real
      return tostring(stashTestDeck.getPosition().y)`, "stash deck"),
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 90, mark: "stash back" },
    q('return tostring(stashTestDeck.getPosition().y)', "stash home"), q('return stashTestDeck.getGUID()', "stash guid")]);
  const mine = (mark) => fxOf(r, mark).filter((l) => l.includes('"setInvisibleTo" obj:' + valueOf(r, "stash guid") + " "));
  const hides = mine("stash deck"), shows = mine("stash back");
  ok("stash: the deck went under the table", Number(valueOf(r, "stash deck")) < -5, String(valueOf(r, "stash deck")) + " " + r.errors.join(" | "));
  ok("stash: invisible to every seat and to spectators", hides.length === 1 && ["White", "Grey", "Black"].every((c) => hides[0].includes(c)), hides.join(" ; "));
  ok("stash: the deck is back on the table", Number(valueOf(r, "stash home")) === 2, String(valueOf(r, "stash home")));
  ok("stash: visible again once it is back", shows.length === 1 && !/White|Grey|Black/.test(shows[0]), shows.join(" ; "));
}
// every Button that setText names is one isButton knows: real TTS ignores UI.setValue on a Button, so a label set that way never shows
{
  const src = fs.readFileSync(path.join(__dirname, "..", "tools", "engine-renderer.lua"), "utf8");
  const known = [...src.slice(src.indexOf("local function isButton"), src.indexOf("-- Applies only the attributes that changed")).matchAll(/\^(eng_[a-z0-9_]+)/g)].map((m) => m[1]);
  const buttons = [...src.matchAll(/<Button id="(eng_[a-z0-9_]+)/g)].map((m) => m[1]);
  const named = [...src.matchAll(/setText\("(eng_[a-z0-9_]+)"/g)].map((m) => m[1]);
  const missing = [...new Set(named)].filter((id) => buttons.includes(id) && !known.some((k) => id.startsWith(k)));
  ok("setText: every Button it names sets the text attribute", named.length > 5 && buttons.length > 5 && known.length > 5 && missing.length === 0, missing.join(", "));
}
// day and night show on the phase bar once it is one (2026-10-26)
{
  const bar = (mark) => q('engineUpdateCorner("Blue", nil) return tostring(UI.getValue("eng_phase_Blue"))', mark);
  const r = run([bar("neither"), q('engineTable().day = "day"', "make day"), bar("day"), q('engineTable().day = "night"', "make night"), bar("night")]);
  const v = (m) => String(valueOf(r, m));
  ok("day/night: nothing before it is day or night", !/DAY|NIGHT/.test(v("neither")), v("neither") + " " + r.errors.join(" | "));
  ok("day/night: DAY on the phase bar", /DAY/.test(v("day")) && !/NIGHT/.test(v("day")), v("day"));
  ok("day/night: NIGHT on the phase bar", /NIGHT/.test(v("night")), v("night"));
}
// a changed text box covers the printed text box only: under the type line, above the power/toughness, at most 4 lines
// (Llanowar Elves' "(no text)" hid "Creature - Elf Druid", real table 2026-11-05)
{
  const pick = 'local t = engineTable() local c for _, p in ipairs(t.players) do for _, x in ipairs(p.battlefield or {}) do if c == nil and x.id then c = x end end end __tbId = c and c.id return tostring(__tbId)';
  const setCt = (ct, mark) => q(`local t = engineTable() for _, p in ipairs(t.players) do for _, x in ipairs(p.battlefield or {}) do if x.id == __tbId then x.ct = ${JSON.stringify(ct)} end end end engineRender(t) __sim.frames(30)`, mark);
  const box = (mark) => q('local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:" .. tostring(__tbId) then o = x end end if o == nil then return "no card" end ' +
    'for _, b in ipairs(o.getButtons() or {}) do if string.find(tostring(b.tooltip), "Text changed", 1, true) then return b.label .. "@h" .. tostring(b.height) .. "@z" .. tostring(b.position.z or b.position[3]) end end return "no box"', mark);
  const long = "Flying, first strike, vigilance, trample, haste. Whenever this creature attacks, each opponent loses 2 life and you gain 2 life. At the beginning of your upkeep, draw a card.";
  const r = run([q(pick, "pick"), setCt("(no text)", "set empty"), box("empty"), setCt(long, "set long"), box("long")]);
  const e = String(valueOf(r, "empty")), l = String(valueOf(r, "long"));
  const num = (s, k) => Number((s.match(new RegExp("@" + k + "([-0-9.]+)")) || [])[1]);
  ok("text box: precondition, a battlefield card", valueOf(r, "pick") !== "nil", String(valueOf(r, "pick")) + " " + r.errors.join(" | "));
  ok("text box: (no text) shows", e.startsWith("(no text)@"), e);
  // (top edge = z - h/1000 in the card's units: at 0.35 or below it the type line shows, measured on the real table)
  const top = (s) => num(s, "z") - num(s, "h") / 1000, bottom = (s) => num(s, "z") + num(s, "h") / 1000;
  ok("text box: it stops under the type line", top(e) >= 0.34 && top(l) >= 0.34, `${top(e)} / ${top(l)}`);
  ok("text box: it stops above the power/toughness", bottom(e) <= 1.14 && bottom(l) <= 1.14, `${bottom(e)} / ${bottom(l)}`);
  ok("text box: a long text is cut to 4 lines", l.split("@")[0].split("\n").length === 4 && /point at it for the rest/.test(l), l);
}
// a question that names a card's ability before that card is on the table (after a reload the question came first)
// gets the button once the board brings the card (2026-10-26)
{
  const more = s1.slice(40, 44).filter((m) => m.t !== "prompt").map((m) => ({ msg: { t: m.t, json: m.json } }));
  const labels = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:engine-card-1" then o = x end end if o == nil then return "no card" end local out = {} for _, b in ipairs(o.getButtons() or {}) do out[#out + 1] = b.label end return table.concat(out, "|")`;
  const long = "{4}{B}: Put target creature card from a graveyard onto the battlefield under its owner's control.";
  const geo = labels.replace("b.label end", 'b.label .. "@" .. tostring(b.position.x or b.position[1]) .. "#" .. tostring(b.tooltip) end');
  const r = run([ask({ promptId: 960, title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }, { id: "prompt-action-0", cardId: "engine-card-1", label: "Activate Thing: {2}: Scry 1." },
    { id: "prompt-action-1", cardId: "engine-card-1", label: "Activate Thing: " + long }] }),
    { frames: 5 }, ...more, { frames: 30 }, q(labels, "after board"), q(geo, "geometry")]);
  const v = String(valueOf(r, "after board"));
  ok("ability buttons: a card that arrives after its question gets them", v.includes("Scry 1."), v + " " + r.errors.join(" | "));
  // on the card, one short line each, the whole text as the tooltip (beside the card they covered the next one)
  const gv = String(valueOf(r, "geometry")).split("|").find((x) => x.startsWith("{4}{B}")) || String(valueOf(r, "geometry"));
  ok("ability buttons: a long ability is one short line", gv.startsWith("{4}{B}: Put target…@"), gv);
  ok("ability buttons: they sit on the card", /@0#/.test(gv), gv);
  ok("ability buttons: the tooltip has the whole text", gv.endsWith("#" + long), gv);
}
// the Engine / Graveyards / Log / Auto / Settings buttons are a row at the top left, under TTS's own menu (2026-10-31): at
// the top right they covered the first items of the cards' right-click menus (2026-10-26, #35). (The fake TTS keeps no
// layout: read from the XML text.)
{
  const lua = String(save.LuaScript || "");
  for (const id of ["eng_toggle_", "eng_browse_", "eng_logbtn_", "eng_pace_", "eng_set_", "eng_setpanel_", "eng_autores_", "eng_fixcall_", "eng_undo_", "eng_undolist_"]) {
    const tag = (lua.match(new RegExp(`<(?:Button|Panel) id="${id}' \\.\\. c \\.\\. '"[^>]*>`)) || [""])[0];
    ok(`top-left row: ${id} sits at the top left`, /rectAlignment="UpperLeft"/.test(tag) && /offsetXY="\d+ -\d+"/.test(tag), tag.slice(0, 200) || "not found");
  }
}
// the Auto-resolve button opens one list shared by every seat (2026-10-31): only the players who opened it see it, a pick
// goes to the bridge, and the button shows what the bridge says, which ends a skip by itself. One choice at a time.
{
  const list = (mark) => q('return tostring(UI.getAttribute("eng_autolist", "active")) .. "|" .. tostring(UI.getAttribute("eng_autolist", "visibility"))', mark);
  const btn = (mark) => q('return tostring(UI.getAttribute("eng_autores_Blue", "text")) .. "|" .. tostring(UI.getAttribute("eng_autores_Blue", "color")) .. "|" .. tostring(engineAutoResolve.Blue)', mark);
  const open = (who, mark) => q(`onMtgAutoResolve(Player.${who}, nil, "eng_autores_${who}")`, mark);
  const pick = (who, id, mark) => q(`onMtgAutoPick(Player.${who}, nil, "eng_auto_${id}")`, mark);
  const state = (phase, on, mark) => ({ msg: { t: "autostate", json: JSON.stringify({ t: "autostate", color: "Blue", phase, on }) }, mark });
  const sent = (r, mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  const banner = (mark) => q('return tostring(UI.getAttribute("eng_banner_Blue", "active")) .. "|" .. tostring(UI.getValue("eng_banner_Blue"))', mark);
  const setStep = (step, turn, mark) => q(`local t = engineTable() t.step = "${step}" t.turn = ${turn} t.active = "Blue" t.priority = "Blue" engineBannerAt = {} engineBannerSeen = engineBannerSeen or {} engineBannerSeen.Blue = "Blue|${turn}"`, mark);
  const prio = (id) => ask({ promptId: id, title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }] });
  const r = simulate({ save, seated: ["Blue", "White"], steps: [...prefix, { frames: 10 }, q('engineAutoResolveDraw("Blue")', "first draw"), btn("start"), list("closed"),
    open("Blue", "open"), list("Blue open"), open("White", "open 2"), list("both open"),
    q('onMtgAutoResolve(Player.Red, nil, "eng_autores_Blue")', "not yours"), list("after a stranger"),
    open("White", "close 2"), list("White closed"),
    pick("White", "end", "pick with it shut"),
    pick("Blue", "end", "pick end"), list("after pick"), btn("sent only"),
    state("end", false, "bridge says end"), btn("skipping"),
    setStep("draw", 60, "set draw"), prio(960), { frames: 3 }, banner("banner skipping"),
    open("Blue", "open again"), pick("Blue", "off", "pick off"), state("", false, "bridge says off"), btn("off again"),
    setStep("main2", 60, "set main2"), prio(961), { frames: 3 }, banner("banner after"), { frames: 120 },
    open("Blue", "open others"), pick("Blue", "others", "pick others"), btn("others"),
    state("combat", false, "typed skip"), btn("typed"),
    state("", false, "skip ended"), btn("ended"),
    open("Blue", "open last"), pick("Blue", "others", "others again"),
    open("Blue", "open off"), pick("Blue", "off", "off from others"), btn("button after off"),
    state("mine", false, "bridge says mine"), btn("mine"), open("Blue", "open at game over"),
    q('engineTable().gameOver = true engineAutoResolveDraw("Blue") engineTable().gameOver = nil engineAutoResolveDraw("Blue")', "game over"), list("after game over"), open("Blue", "open at clear"),
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 30, mark: "clear" }, list("after clear"), q('return tostring(engineSkipTo.Blue)', "skip after clear")] });
  const v = (m) => String(valueOf(r, m));
  ok("auto list: no errors", r.errors.length === 0, r.errors.join(" | "));
  ok("auto list: the button says off and hints at a list", v("start").startsWith("Auto-resolve: off...|#3a3f4b"), v("start"));
  ok("auto list: shut at the start", v("closed").startsWith("false"), v("closed"));
  ok("auto list: only the player who opened it sees it", v("Blue open") === "true|Blue", v("Blue open"));
  ok("auto list: a second player joins the first", v("both open") === "true|Blue|White", v("both open"));
  ok("auto list: another colour's click changes nothing", v("after a stranger") === "true|Blue|White", v("after a stranger"));
  ok("auto list: one closing leaves the other's open", v("White closed") === "true|Blue", v("White closed"));
  ok("auto list: a pick with the list shut sends nothing", !sent(r, "pick with it shut").includes("skipto"), sent(r, "pick with it shut").slice(0, 200));
  ok("auto list: a pick asks the bridge for that phase", sent(r, "pick end").includes('"phase":"end"') && sent(r, "pick end").includes("skipto"), sent(r, "pick end").slice(0, 200));
  ok("auto list: a pick closes the list", v("after pick").startsWith("false"), v("after pick"));
  ok("auto list: the label waits for the bridge", v("sent only").startsWith("Auto-resolve: off..."), v("sent only"));
  ok("auto list: the button names the phase, green", v("skipping").startsWith("Until end step...|#2e7d32"), v("skipping"));
  ok("auto list: no step banners while skipping", !/DRAW/.test(v("banner skipping")) || v("banner skipping").startsWith("false"), v("banner skipping"));
  ok("auto list: step banners come back after", v("banner after") === "true|MAIN PHASE 2", v("banner after"));
  ok("auto list: game over shuts it", v("after game over").startsWith("false"), v("after game over"));
  ok("auto list: Off ends the skip at the bridge", sent(r, "pick off").includes('"phase":"off"'), sent(r, "pick off").slice(0, 200));
  ok("auto list: back to off, grey", v("off again").startsWith("Auto-resolve: off...|#3a3f4b"), v("off again"));
  ok("auto list: Other players' turns is the old auto-resolve", v("others").startsWith("Auto-resolve: on...|#2e7d32|true") && sent(r, "pick others").includes('"on":true'), v("others"));
  ok("auto list: a skip typed in the chat shows, and takes over from auto-resolve", v("typed").startsWith("Until combat...|#2e7d32|nil"), v("typed"));
  ok("auto list: the skip ending by itself puts the button back", v("ended").startsWith("Auto-resolve: off...|#3a3f4b|nil"), v("ended"));
  ok("auto list: Off turns auto-resolve off", sent(r, "off from others").includes('"on":false') && v("button after off").startsWith("Auto-resolve: off..."), sent(r, "off from others").slice(0, 200));
  ok("auto list: Off sends no skip message with no skip on", !sent(r, "off from others").includes("skipto"), sent(r, "off from others").slice(0, 200));
  ok("auto list: my next turn fits a short label", v("mine").startsWith("Until my turn..."), v("mine"));
  ok("auto list: a game's end shuts it", v("after clear").startsWith("false"), v("after clear"));
  ok("auto list: a game's end forgets the skip", v("skip after clear") === "nil", v("skip after clear"));
  // (the list's words are the bridge's: a word it doesn't know would answer "Skip to which phase?" in the chat)
  const words = [...String(save.LuaScript || "").matchAll(/\{ "(\w+)", "Until [^"]+" \}/g)].map((m) => m[1]).sort();
  const bridge = /const SKIP_PHASES = \{([\s\S]*?)\};/.exec(fs.readFileSync(path.join(__dirname, "..", "bridge", "bridge.js"), "utf8"))[1];
  const known = [...bridge.matchAll(/(\w+):\s*\[/g)].map((m) => m[1]).sort();
  ok("auto list: every phase the bridge knows, and only those", words.length === 9 && words.join() === known.join(), `${words} vs ${known}`);
}
// pointing at your card with abilities shows them on the screen as big buttons; clicking one uses it; a right-click on
// the card's own button does nothing (hp-07 2026-10-27: the buttons on cards were too small, the menu went under the bars)
{
  const more = s1.slice(40, 44).filter((m) => m.t !== "prompt").map((m) => ({ msg: { t: m.t, json: m.json } }));
  const objOf = 'local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:engine-card-1" then o = x end end ';
  const r = run([...more, { frames: 30 }, { ...ask({ promptId: 975, title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }, { id: "prompt-action-0", cardId: "engine-card-1", label: "Activate Thing: {2}: Scry 1." }] }), mark: "asked" },
    { frames: 30 },
    q(objOf + 'onObjectHover("Blue", o) return tostring(UI.getAttribute("eng_abp_Blue", "active")) .. "|" .. tostring(UI.getAttribute("eng_abp_Blue_1", "text")) .. "|" .. tostring(UI.getAttribute("eng_abp_Blue_2", "active"))', "hover"),
    q(objOf + 'return tostring(hoveredObjs ~= nil and hoveredObjs["Blue"] == o)', "table hover"),
    q(objOf + 'local b = o.getButtons()[1] _G[b.click_function](o, "Blue", true) __sim.frames(30) return "right"', "right click"),
    q('onMtgAbPanel(Player.White, nil, "eng_abp_Blue_1") __sim.frames(30) return "white"', "white click"),
    q('onMtgAbPanel(Player.Blue, nil, "eng_abp_Blue_1") __sim.frames(30) return "clicked"', "panel click")]);
  const sent = (m) => fxOf(r, m).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  const [active, first, second] = String(valueOf(r, "hover")).split("|");
  ok("ability panel: pointing at your card shows its ability", active === "true" && first.includes("Scry 1") && second === "false", String(valueOf(r, "hover")) + " " + r.errors.join(" | "));
  ok("hover: the table's own handler still runs (hoveredObjs, for mtg commander and the hover hotkeys)", String(valueOf(r, "table hover")) === "true", String(valueOf(r, "table hover")));
  ok("ability panel: a right-click on the card's button does nothing", !sent("right click").includes("prompt-action-0"), sent("right click").slice(0, 200));
  ok("ability panel: another player's click does nothing", !sent("white click").includes("prompt-action-0"), sent("white click").slice(0, 200));
  const menus = fxOf(r, "asked").filter((l) => l.includes("menu+")).join(" ");
  ok("card menu: the ability without the card's name in front", menus.includes('"{2}: Scry 1."') && !menus.includes("Activate Thing"), menus.slice(0, 300));
  ok("ability panel: clicking it uses the ability", sent("panel click").includes('"choice":["prompt-action-0"]'), sent("panel click").slice(0, 200));
}
// a card whose object arrives after the question that names it glows too (the legend rule's token didn't, hp-07)
{
  const more = s1.slice(40, 44).filter((m) => m.t !== "prompt").map((m) => ({ msg: { t: m.t, json: m.json } }));
  const lit = 'local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:engine-card-1" then o = x end end if o == nil then return "no card" end return tostring(o.__d.highlight ~= nil)';
  const r = run([ask({ promptId: 980, title: "Legend rule: which Thing stays?", mode: "multi", min: 1, max: 1, options: [{ id: "engine-card-1", label: "Thing" }, { id: "engine-card-6", label: "Thing" }] }),
    { frames: 5 }, ...more, { frames: 60 }, q(lit, "lit")]);
  ok("late card: glows for the open question once it is on the table", String(valueOf(r, "lit")) === "true", String(valueOf(r, "lit")) + " " + r.errors.join(" | "));
}
// the hand counters show the engine's count during a game (they counted objects being re-laid out, hp-07)
{
  const lastT = [...s1.slice(0, 40)].reverse().find((m) => m.t === "table");
  const want = JSON.parse(lastT.json).players.find((x) => x.color === "Blue").handCount;
  const r = run([q('return tostring(engineHandCount({ color = "Blue" }))', "count")]);
  ok("hand counter: the engine's hand count", String(valueOf(r, "count")) === String(want) && want != null, String(valueOf(r, "count")) + " vs " + want + " " + r.errors.join(" | "));
  const built = save.ObjectStates.map((o) => o.LuaScript || "").join(" ");
  ok("hand counter: the table's counters ask the engine", (built.match(/Global\.call\('engineHandCount'/g) || []).length >= 8, String((built.match(/Global\.call\('engineHandCount'/g) || []).length));
}
// the ability's own words come from the bridge's "ab" field when it is there (structural review 2026-10-27)
{
  const more = s1.slice(40, 44).filter((m) => m.t !== "prompt").map((m) => ({ msg: { t: m.t, json: m.json } }));
  const labels = 'local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:engine-card-1" then o = x end end if o == nil then return "no card" end local out = {} for _, b in ipairs(o.getButtons() or {}) do out[#out + 1] = b.label end return table.concat(out, "|")';
  const r = run([...more, { frames: 30 }, ask({ promptId: 985, title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }, { id: "prompt-action-0", cardId: "engine-card-1", label: "Somebody Else: {2}: Scry 1.", ab: "{3}: Gain 3." }] }),
    { frames: 30 }, q(labels, "buttons")]);
  const v = String(valueOf(r, "buttons"));
  ok("ability text: the bridge's ab field, not the label", v.includes("{3}: Gain 3.") && !v.includes("Scry"), v + " " + r.errors.join(" | "));
}
// an exact number to pick answers at the last click: the corner counts instead of offering Done (pressing Done after
// the click had answered passed the next question, hp-07 2026-10-27)
{
  const big = 'return tostring(UI.getAttribute("eng_big_Blue", "text") or UI.getValue("eng_big_Blue"))';
  const r = run([ask({ promptId: 970, kind: "target", title: "Choose a player to draw", mode: "multi", min: 1, max: 1, options: [{ id: "player|player-0", label: "Blue" }, { id: "player|player-1", label: "AI 1" }] }),
    { frames: 5 }, q(big, "big"), q('engineCornerPress("Blue", "big") __sim.frames(30) return "pressed"', "press"),
    ask({ promptId: 971, title: "Discard (2)", mode: "multi", min: 0, max: 2, options: [{ id: "card|x1", label: "A" }, { id: "card|x2", label: "B" }] }), { frames: 5 }, q(big, "big up to")]);
  const sent = fxOf(r, "press").filter((l) => l.includes("WebRequest")).join(" ");
  ok("exact pick: the corner counts, no Done", /0 of 1 chosen/.test(String(valueOf(r, "big"))), String(valueOf(r, "big")) + " " + r.errors.join(" | "));
  ok("exact pick: pressing the count sends nothing", !sent.includes("answer"), sent.slice(0, 200));
  ok("up to N: Done stays", /Done/.test(String(valueOf(r, "big up to"))), String(valueOf(r, "big up to")));
}
// poison counters show as a label under the life counter while there are any; a face-down 2/2 lies with the creatures
// (hp-07 hand test, 2026-10-27)
{
  const lastT = [...s1.slice(0, 40)].reverse().find((m) => m.t === "table" && (JSON.parse(m.json).players.find((x) => x.color === "Blue") || {}).battlefield);
  // (as the bridge sends them since trackMarks step 6: allMarks only, left out when there is none)
  const withPoison = (n, energy = 0, flags = {}) => {
    const t = JSON.parse(lastT.json);
    const all = [n > 0 && `POISON ${n}`, energy > 0 && `ENERGY ${energy}`, flags.monarch && "MONARCH", flags.initiative && "INITIATIVE", flags.blessed && "CITY'S BLESSING", flags.story && "ENDURING STORY"].filter(Boolean);
    for (const p of t.players) if (p.color === "White") { delete p.allMarks; if (all.length) p.allMarks = all; }
    return { msg: { t: "table", json: JSON.stringify(t) } };
  };
  const labels = 'local out = {} for _, b in ipairs(getObjectFromGUID("23e485").getButtons() or {}) do out[#out + 1] = tostring(b.label) end return table.concat(out, "|")';
  const r = run([withPoison(3), { frames: 10 }, q(labels, "poison 3"), withPoison(4), { frames: 10 }, q(labels, "poison 4"), withPoison(4, 2), { frames: 10 }, q(labels, "energy 2"), withPoison(0, 0, { monarch: true, initiative: true }), { frames: 10 }, q(labels, "monarch"), withPoison(0, 0, { blessed: true, story: true }), { frames: 10 }, q(labels, "story"), withPoison(0), { frames: 10 }, q(labels, "poison 0")]);
  const v = (m) => String(valueOf(r, m));
  ok("poison: shown under the life counter", v("poison 3").split("|").includes("POISON 3"), v("poison 3") + " " + r.errors.join(" | "));
  ok("poison: the label follows the count (one label)", v("poison 4").split("|").filter((x) => x.startsWith("POISON")).join() === "POISON 4", v("poison 4"));
  ok("counters: energy joins the same label", v("energy 2").split("|").filter((x) => /POISON|ENERGY/.test(x)).join() === "POISON 4   ENERGY 2", v("energy 2"));
  // (hp-17 gap: the monarch and the initiative in the same label; gone with the flags)
  ok("counters: the monarch and the initiative shown", v("monarch").split("|").includes("MONARCH   INITIATIVE"), v("monarch"));
  // (hp-21 gap: the city's blessing and an enduring story too)
  ok("counters: the city's blessing and an enduring story shown", v("story").split("|").includes("CITY'S BLESSING   ENDURING STORY"), v("story"));
  ok("poison: gone at 0", !v("poison 0").includes("POISON") && !v("poison 0").includes("ENERGY") && !v("poison 0").includes("MONARCH"), v("poison 0"));
  const fdT = JSON.parse(lastT.json);
  const blue = fdT.players.find((x) => x.color === "Blue");
  blue.battlefield = [...blue.battlefield, { s: 1, id: "engine-card-880", fd: true, p: 2, t: 2, ty: ["Creature"] }];
  const rowOf = (id) => `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end if o == nil then return "none" end local p, m, f = o.getPosition(), data.Blue.playmat.getPosition(), data.Blue.playmat.getTransformForward() return string.format("%.1f", (p - m):dot(f))`;
  const r2 = run([{ msg: { t: "table", json: JSON.stringify(fdT) } }, { frames: 60 }, q(rowOf("engine-card-880"), "face-down row")]);
  ok("face-down 2/2: laid out with the creatures (row 0, -8 along the mat)", Math.abs(Number(valueOf(r2, "face-down row")) + 8) < 1, String(valueOf(r2, "face-down row")) + " " + r2.errors.join(" | "));
}
// equipment dropped onto your creature asks to attach it there; dropped on empty mat it is only moved (2026-10-26)
{
  // (two Blue permanents: the prefix plus the messages up to the second one, s1[40..43])
  const more = s1.slice(40, 44).map((m) => ({ msg: { t: m.t, json: m.json } }));
  const [eq, cr] = ["engine-card-6", "engine-card-1"];
  const find = (id) => `(function() for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then return x end end end)()`;
  const setup = `local se, sc = engineStatic["${eq}"], engineStatic["${cr}"] se.tl = "Artifact — Equipment" sc.ty = { "Creature" } `;
  const r = run([...more, q(setup + `local o, t = ${find(eq)}, ${find(cr)} o.setPosition(t.getPosition() + Vector(0.2, 0.5, 0.1)) onObjectDrop("Blue", o) __sim.frames(5) return "dropped"`, "on creature"),
    q(`local o = ${find(eq)} local m = data.Blue.playmat.getPosition() o.setPosition(Vector(m.x - 4, 1.5, m.z + 2)) onObjectDrop("Blue", o) __sim.frames(5) return "moved"`, "on empty mat")]);
  const sent = (m) => fxOf(r, m).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  ok("equip by drop: on your creature asks to attach it there", sent("on creature").includes('"kind":"attach"') && sent("on creature").includes(`"to":"${cr}"`), sent("on creature").slice(0, 240) + " " + r.errors.join(" | "));
  ok("equip by drop: on the empty mat it is only moved", !sent("on empty mat").includes('"kind":"attach"'), sent("on empty mat").slice(0, 200));
}
// stage 3 review 2026-10-27 (jr-programmer-suite on the hp-07 changes)
{
  const more = s1.slice(40, 44).filter((m) => m.t !== "prompt").map((m) => ({ msg: { t: m.t, json: m.json } }));
  const objOf = 'local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:engine-card-1" then o = x end end ';
  const labels = objOf + 'if o == nil then return "no card" end local out = {} for _, b in ipairs(o.getButtons() or {}) do out[#out + 1] = tostring(b.label) end return table.concat(out, "|")';
  const sent = (r, m) => fxOf(r, m).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  const scry = { id: "prompt-action-0", cardId: "engine-card-1", label: "Activate Thing: {2}: Scry 1." };
  // a question the table draws nothing for takes the last question's ability buttons away, and an old button's click
  // never answers it (ids are positions: "prompt-action-0" was an option of the new question too)
  const r = run([...more, { frames: 30 }, ask({ promptId: 975, title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }, scry] }), { frames: 30 },
    q(labels, "before"), q(objOf + 'return tostring(o and o.getButtons() and o.getButtons()[1] and o.getButtons()[1].click_function)', "fn"),
    ask({ promptId: 976, title: "Choose a mode", mode: "single", options: [{ id: "prompt-action-0", label: "Mode A" }, { id: "prompt-action-1", label: "Mode B" }] }), { frames: 30 },
    q(labels, "after"), q('engineUseAbility("Blue", "prompt-action-0", 975) __sim.frames(30) return "old"', "old click")]);
  ok("stage 3: a priority question draws the ability button", String(valueOf(r, "before")).includes("Scry"), String(valueOf(r, "before")) + " " + r.errors.join(" | "));
  ok("stage 3: a question the table draws nothing for takes the ability buttons away", !String(valueOf(r, "after")).includes("Scry"), String(valueOf(r, "after")));
  ok("stage 3: a click drawn for an earlier question does not answer the next one", !sent(r, "old click").includes("prompt-action-0"), sent(r, "old click").slice(0, 200));
  // "Untap X (mana back)" is no ability: no button
  const r2 = run([...more, { frames: 30 }, ask({ promptId: 977, title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }, { id: "undo-1", cardId: "engine-card-1", label: "Untap Thing (mana back)" }] }), { frames: 30 }, q(labels, "untap")]);
  ok("stage 3: an Untap (mana back) option gets no ability button", !String(valueOf(r2, "untap")).includes("Untap"), String(valueOf(r2, "untap")) + " " + r2.errors.join(" | "));
  // a reset takes the panel, the ability state and the poison label away
  const lastT = [...s1.slice(0, 44)].reverse().find((m) => m.t === "table" && (JSON.parse(m.json).players.find((x) => x.color === "Blue") || {}).battlefield);
  // (the label as the bridge sends it since trackMarks step 6, allMarks: the old `poison = 3` drew nothing, so the
  // check passed with the reset leaving the label on, verifier finding 2, 2026-11-06)
  const poisoned = JSON.parse(lastT.json); for (const p of poisoned.players) if (p.color === "White") p.allMarks = ["POISON 3"];
  const whiteLabels = 'local l = {} for _, b in ipairs(getObjectFromGUID("23e485").getButtons() or {}) do l[#l + 1] = tostring(b.label) end return table.concat(l, ",")';
  const r3 = run([...more, { frames: 30 }, ask({ promptId: 978, title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }, scry] }), { frames: 30 },
    { msg: { t: "table", json: JSON.stringify(poisoned) } }, { frames: 10 },
    q(whiteLabels, "poison up"),
    q(objOf + 'onObjectHover("Blue", o) return tostring(UI.getAttribute("eng_abp_Blue", "active"))', "hover"),
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 90 },
    q('local n = 0 for _ in pairs(engineAbilityWant) do n = n + 1 end local l = {} for _, b in ipairs(getObjectFromGUID("23e485").getButtons() or {}) do l[#l + 1] = tostring(b.label) end return tostring(UI.getAttribute("eng_abp_Blue", "active")) .. "|" .. n .. "|" .. table.concat(l, ",")', "cleared")]);
  const [panel, wants, tracker] = String(valueOf(r3, "cleared")).split("|");
  ok("stage 3: precondition: the panel was up", valueOf(r3, "hover") === "true", String(valueOf(r3, "hover")) + " " + r3.errors.join(" | "));
  ok("stage 3: precondition: the poison label was up", String(valueOf(r3, "poison up")).includes("POISON 3"), String(valueOf(r3, "poison up")) + " " + r3.errors.join(" | "));
  ok("stage 3: a reset hides the ability panel", panel === "false", String(valueOf(r3, "cleared")));
  ok("stage 3: a reset forgets the abilities", wants === "0", String(valueOf(r3, "cleared")));
  ok("stage 3: a reset takes the poison label away", !String(tracker).includes("POISON"), String(valueOf(r3, "cleared")));
  // a card bounced to the hand loses its ability buttons with the next question (the same object moved to the hand:
  // a redraw of the table's own board, as the stage 3 reviewer reproduced it)
  {
    const move = 'local t = JSON.decode(JSON.encode(engineTable())) for _, pl in ipairs(t.players) do if pl.color == "Blue" then local bf = {} pl.hand = pl.hand or {} for _, c in ipairs(pl.battlefield or {}) do if c.id ~= "engine-card-1" then bf[#bf + 1] = c else c.tap = nil table.insert(pl.hand, c) end end pl.battlefield = bf end end engineRender(t) __sim.frames(30) return "moved"';
    const r5 = run([...more, { frames: 30 }, ask({ promptId: 980, title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }, scry] }), { frames: 30 }, q(labels, "on bf"),
      q(move, "moved"), ask({ promptId: 981, title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }] }), { frames: 30 }, q(labels, "in hand")]);
    ok("stage 3: precondition: the ability button was on the card", String(valueOf(r5, "on bf")).includes("Scry"), String(valueOf(r5, "on bf")) + " " + r5.errors.join(" | "));
    ok("stage 3: a card bounced to the hand loses its ability buttons", !String(valueOf(r5, "in hand")).includes("Scry"), String(valueOf(r5, "in hand")) + " " + r5.errors.join(" | "));
  }
  // as many buttons on the card as the screen panel has rows (a 7th was on the card only)
  {
    const seven = Array.from({ length: 7 }, (_, k) => ({ id: "prompt-action-" + k, cardId: "engine-card-1", label: "Activate Thing: {" + (k + 1) + "}: Scry " + (k + 1) + "." }));
    const r6 = run([...more, { frames: 30 }, ask({ promptId: 982, title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }, ...seven] }), { frames: 30 }, q(labels, "seven")]);
    const n = String(valueOf(r6, "seven")).split("|").filter((x) => /Scry/.test(x)).length;
    ok("stage 3: at most as many ability buttons as panel rows (6)", n === 6, n + " " + String(valueOf(r6, "seven")).slice(0, 200) + " " + r6.errors.join(" | "));
  }
  // an exact pick of cards answers at its last click (the corner has no Done for it)
  const pickIds = blueBf.slice(0, 2);
  const objId = (id) => `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end `;
  const r4 = run([ask({ promptId: 979, title: "Legend rule: which stays?", mode: "multi", min: 1, max: 1, options: pickIds.map((id) => ({ id, label: id })) }), { frames: 10 },
    q(objId(pickIds[0]) + 'onPlayerAction(Player.Blue, Player.Action.Select, { o }) __sim.frames(30) return "clicked"', "pick")]);
  ok("stage 3: an exact pick of cards answers at the last click", sent(r4, "pick").includes(`"choice":["${pickIds[0]}"]`), sent(r4, "pick").slice(0, 240) + " " + r4.errors.join(" | "));
}
// a Phyrexian cost: "Pay 2 life" is a button in the row with Auto-pay and Cancel (it was only in the Engine panel; hp-07
// #30 re-test 2026-10-27); the lands still glow to tap
{
  const r = run([ask({ promptId: 990, kind: "mana", title: "Pay {W/P} for Skrelv, Defector Mite", mode: "single", options: [{ id: "__auto", label: "Auto-pay" },
    { id: "pay-life", label: "Pay 2 life" }, { id: "tap:engine-card-14:0", cardId: "engine-card-14", label: "Tap Swamp for {B}" }, { id: "__cancel", label: "Cancel" }] }), { frames: 10 },
    q('local out = {} for k = 1, 5 do if UI.getAttribute("eng_rowopt_Blue_" .. k, "active") == "true" then out[#out + 1] = tostring(UI.getAttribute("eng_rowopt_Blue_" .. k, "text")) end end return tostring(UI.getAttribute("eng_row_Blue", "active")) .. "|" .. table.concat(out, ",") .. "|" .. tostring(UI.getValue("eng_hint_Blue"))', "row")]);
  const [on, btns, hint] = String(valueOf(r, "row")).split("|");
  ok("life pay: the row is up", on === "true", String(valueOf(r, "row")) + " " + r.errors.join(" | "));
  ok("life pay: Pay 2 life is a button, the taps are not", btns.split(",").includes("Pay 2 life") && !btns.includes("Tap Swamp"), btns);
  ok("life pay: the hint says it", String(hint).includes("Pay 2 life"), hint);
}
// keywords another card gave a permanent show in its status box (hp-07 #31: Skrelv's toxic 1 and hexproof from red
// on Kenrith showed nowhere)
{
  const lastK = [...s1.slice(0, 40)].reverse().find((m) => m.t === "table" && (JSON.parse(m.json).players.find((x) => x.color === "Blue") || {}).battlefield);
  const tk = JSON.parse(lastK.json);
  const bl = tk.players.find((x) => x.color === "Blue");
  const id = bl.battlefield[0].id;
  bl.battlefield[0] = { ...bl.battlefield[0], kw: ["Toxic 1", "Hexproof from red"] };
  const lbl = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end local out = {} for _, b in ipairs((o and o.getButtons()) or {}) do out[#out + 1] = tostring(b.label) end return table.concat(out, "|")`;
  const r = run([{ msg: { t: "table", json: JSON.stringify(tk) } }, { frames: 30 }, q(lbl, "kw")]);
  ok("granted keywords: shown on the card", String(valueOf(r, "kw")).split("|").includes("Toxic 1,\nHexproof from red"), JSON.stringify(valueOf(r, "kw")) + " " + r.errors.join(" | "));
  // the status box: every status shows, none behind "+5 more"; no card-wide line is longer than the box; it never reaches
  // the text box; a tapped card turns it back; phased out is in the same box (2026-11-02, the Ur-Dragon game)
  const six = { ...bl.battlefield[0], kw: ["Haste", "Vigilance", "Hexproof", "Lifelink"], ow: ["Flying", "Protection from multicolored"] };
  const boxOf = (card) => { bl.battlefield[0] = card; return JSON.stringify(tk); };
  const geo = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end for _, b in ipairs((o and o.getButtons()) or {}) do if tostring(b.tooltip):find("Haste", 1, true) or tostring(b.label):find("PHASED", 1, true) then local p = b.position return table.concat({ tostring(b.label), tostring(b.tooltip), p.x or p[1], p.z or p[3], b.height, (b.rotation and (b.rotation.y or b.rotation[2])) or 0 }, "@@") end end return "none"`;
  const r2 = run([{ msg: { t: "table", json: boxOf(six) } }, { frames: 30 }, q(geo, "six"),
    { msg: { t: "table", json: boxOf({ ...six, tap: true }) } }, { frames: 30 }, q(geo, "tapped"),
    { msg: { t: "table", json: boxOf({ ...six, po: true }) } }, { frames: 30 }, q(geo, "phased")]);
  const parse = (m) => { const [label, tip, x, z, h, rot] = String(valueOf(r2, m)).split("@@"); return { label: String(label), tip: String(tip), x: Number(x), z: Number(z), h: Number(h), rot: Number(rot) }; };
  const a = parse("six"), t = parse("tapped"), p = parse("phased");
  ok("status box: every status on the card", ["Haste", "Vigilance", "Hexproof", "Lifelink", "Flying", "Protection", "multicolored"].every((w) => a.label.includes(w)) && !/more/i.test(a.label), JSON.stringify(a.label) + " " + r2.errors.join(" | "));
  ok("status box: no line over 20 characters", a.label.split("\n").every((l) => l.length <= 20), JSON.stringify(a.label));
  ok("status box: its bottom edge stays above the type line", Math.abs(a.z + a.h / 2000 - 0.1) < 1e-6, `${a.z} ${a.h}`);
  ok("status box: the whole list in its tooltip", a.tip === "Haste, Vigilance, Hexproof, Lifelink, Flying, Protection from multicolored", a.tip);
  ok("status box: a tapped card turns it back", t.label === a.label && Math.abs(t.x + a.z) < 1e-6 && t.z === 0 && Math.abs(Math.abs(t.rot) - (360 - Math.abs(t.rot) < 180 ? 270 : 90)) < 1e-6, JSON.stringify(t));
  ok("status box: phased out is in the same box, first", p.label.startsWith("PHASED OUT\n") && p.label.includes("Haste"), JSON.stringify(p.label));
  // "above this one where they meet": a click where the two overlap means the ability
  const heights = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end __sim.frames(3) local ab, st = "none", "none" for _, b in ipairs((o and o.getButtons()) or {}) do local y = b.position.y or b.position[2] if tostring(b.click_function):find("engineAbBtn", 1, true) then ab = y elseif tostring(b.tooltip):find("Haste", 1, true) then st = y end end return tostring(ab) .. "@@" .. tostring(st)`;
  const r4 = run([{ msg: { t: "table", json: boxOf(six) } }, { frames: 30 }, ask({ promptId: 895, kind: "priority", title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }, { id: "prompt-action-3", cardId: id, label: "X: {1}, {T}: Draw a card." }] }), q(heights, "heights")]);
  const [abY, stY] = String(valueOf(r4, "heights")).split("@@").map(Number);
  ok("status box: an ability button lies above it", abY > stY, String(valueOf(r4, "heights")) + " " + r4.errors.join(" | "));
  // "Attached cards sit beside the card, clear of it": the host is 1 either side of its centre, an attached card half that
  const hostId = id, onIt = "engine-card-9911";
  bl.battlefield[0] = six;
  bl.battlefield.push({ ...six, id: onIt, kw: undefined, ow: undefined, att: hostId });
  if (tk.cards) tk.cards[onIt] = tk.cards[hostId];
  const pos = (card) => `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${card}" then o = x end end local p = o.getPosition() return string.format("%.3f,%.3f,%.3f", p.x, p.z, o.getScale().x)`;
  const r3 = run([{ msg: { t: "table", json: JSON.stringify(tk) } }, { frames: 30 }, q(pos(hostId), "host"), q(pos(onIt), "attached")]);
  const [hx, hz] = String(valueOf(r3, "host")).split(",").map(Number), [ax, az, as] = String(valueOf(r3, "attached")).split(",").map(Number);
  ok("status box: an attached card is half size", as === 0.5, String(valueOf(r3, "attached")) + " " + r3.errors.join(" | "));
  ok("status box: an attached card lies clear of the card's width", Math.hypot(hx - ax, hz - az) >= 1 + as && Math.abs(hx - ax) >= 1 + as, `${valueOf(r3, "host")} ${valueOf(r3, "attached")}`);
}
// a card whose text was changed shows the changed text in a box over its text box, the whole text in its tooltip and
// its hover text; a long text is cut to 4 lines there (hp-25 2026-10-27: Mind Bend's islandwalk showed nowhere)
{
  const lastK = [...s1.slice(0, 40)].reverse().find((m) => m.t === "table" && (JSON.parse(m.json).players.find((x) => x.color === "Blue") || {}).battlefield);
  const tk = JSON.parse(lastK.json);
  const bl = tk.players.find((x) => x.color === "Blue");
  const a = bl.battlefield[0].id;
  const long = Array.from({ length: 30 }, (_, k) => `word${k}`).join(" ") + "\n" + Array.from({ length: 30 }, (_, k) => `more${k}`).join(" ");
  const base = bl.battlefield[0];
  const tk2 = JSON.parse(JSON.stringify(tk));
  bl.battlefield[0] = { ...base, ct: "Islandwalk (This creature can't be blocked as long as defending player controls an Island (was Swamp).)" };
  tk2.players.find((x) => x.color === "Blue").battlefield[0] = { ...base, ct: long, pn: "Volrath's Shapeshifter" };
  const look = (id) => `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end local out = {} for _, b in ipairs((o and o.getButtons()) or {}) do out[#out + 1] = tostring(b.label) .. "@@" .. tostring(b.tooltip) end return table.concat(out, "||") .. "##" .. tostring(o and o.getDescription())`;
  const r = run([{ msg: { t: "table", json: JSON.stringify(tk) } }, { frames: 30 }, q(look(a), "short"), { msg: { t: "table", json: JSON.stringify(tk2) } }, { frames: 30 }, q(look(a), "long")]);
  const [btnsA, descA] = String(valueOf(r, "short")).split("##");
  const [btnsB, descB] = String(valueOf(r, "long")).split("##");
  const box = (s) => s.split("||").find((x) => /Text changed:/.test(x.split("@@")[1] || "")) || "";
  ok("changed text: a box on the card with the new words", /Islandwalk \(This creature/.test(box(btnsA).split("@@")[0]), btnsA.slice(0, 300) + " " + r.errors.join(" | "));
  ok("changed text: the hover text says it changed", /Text changed:/.test(descA) && /Island \(was Swamp\)/.test(descA), String(descA).slice(0, 200));
  const label = box(btnsB).split("@@")[0];
  ok("changed text: a long text is cut to 4 lines on the card", label.split("\n").length === 4 && /point at it/.test(label), JSON.stringify(label.split("\n").length) + " " + label.slice(-60));
  ok("changed text: the whole long text in the box's tooltip", /more29/.test(box(btnsB).split("@@")[1] || ""), (box(btnsB).split("@@")[1] || "").slice(-60));
  ok("changed text: the printed name in the hover text", /Volrath's Shapeshifter/.test(descB), String(descB).slice(0, 120));
  // (the status box sits above the changed text, not over its first lines, suite review 2026-10-27)
  const tk3 = JSON.parse(JSON.stringify(tk));
  tk3.players.find((x) => x.color === "Blue").battlefield[0] = { ...base, ct: "Islandwalk", kw: ["Hexproof from red"] };
  const kwz = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${a}" then o = x end end for _, b in ipairs((o and o.getButtons()) or {}) do if b.label == "Hexproof from red" then return tostring(b.position.z or b.position[3]) end end return "none"`;
  const r3 = run([{ msg: { t: "table", json: JSON.stringify(tk3) } }, { frames: 30 }, q(kwz, "kwz")]);
  ok("changed text: a granted-keyword badge sits above the box", Number(valueOf(r3, "kwz")) < 0.45, String(valueOf(r3, "kwz")) + " " + r3.errors.join(" | "));
  // (both sides of the cut: 5 lines are cut to 4, 4 stay whole; and each wrapped line fits the box, 28 characters at most)
  const five = Array.from({ length: 5 }, (_, k) => `line${k} abcde fghij klmno`).join("\n");
  const four = Array.from({ length: 4 }, (_, k) => `line${k} abcde fghij klmno`).join("\n");
  const wide = Array.from({ length: 12 }, () => "wordy").join(" ");
  const boxOf = (ct) => { const t = JSON.parse(JSON.stringify(tk)); t.players.find((x) => x.color === "Blue").battlefield[0] = { ...base, ct }; return JSON.stringify(t); };
  const lbl = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${a}" then o = x end end for _, b in ipairs((o and o.getButtons()) or {}) do if tostring(b.tooltip):find("Text changed:", 1, true) then return tostring(b.label) end end return "none"`;
  const r4 = run([{ msg: { t: "table", json: boxOf(five) } }, { frames: 30 }, q(lbl, "five"), { msg: { t: "table", json: boxOf(four) } }, { frames: 30 }, q(lbl, "four"), { msg: { t: "table", json: boxOf(wide) } }, { frames: 30 }, q(lbl, "wide")]);
  const fiveL = String(valueOf(r4, "five")).split("\n"), fourL = String(valueOf(r4, "four")).split("\n");
  ok("changed text: 5 lines are cut to 4 too", fiveL.length === 4 && /point at it/.test(fiveL[3]), JSON.stringify(fiveL.length) + " " + r4.errors.join(" | "));
  ok("changed text: 4 lines stay whole", fourL.length === 4 && !/point at it/.test(fourL.join(" ")), JSON.stringify(fourL));
  const wideL = String(valueOf(r4, "wide")).split("\n");
  ok("changed text: each wrapped line is 28 characters at most", wideL.length >= 2 && wideL.every((l) => l.length <= 28), JSON.stringify(wideL));
}
// a picture in the card row answers an exact pick at the last click, like a card on the table (hp-07 #33 re-test)
{
  const img = "http://127.0.0.1:48787/img/x.jpg";
  const r = run([ask({ promptId: 991, title: "Dauthi Voidwalker: choose a card", mode: "multi", min: 1, max: 1,
    options: [{ id: "engine-card-951", label: "Island [1 Void]", img }, { id: "engine-card-952", label: "Plains [1 Void]", img }] }), { frames: 10 },
    q('onMtgRow(Player.Blue, nil, "eng_rowbtn_Blue_1") __sim.frames(30) return "picked"', "row pick")]);
  const sent = fxOf(r, "row pick").filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  ok("row: an exact pick answers at the last click", sent.includes('"choice":["engine-card-951"]'), sent.slice(0, 200) + " " + r.errors.join(" | "));
}
// more graveyard/exile targets than the card row holds: the Engine panel opens and the hint says so (hp-07 #41)
{
  const img = "http://127.0.0.1:48787/img/x.jpg";
  const opts = Array.from({ length: 8 }, (_, k) => ({ id: "card|engine-card-96" + k, label: "Creature " + k, img }));
  const r = run([q('for k = 0, 7 do engineInPile["engine-card-96" .. k] = true end return "in pile"', "pile"), ask({ promptId: 992, kind: "target", title: "Kenrith, the Returned King: choose a target", mode: "multi", min: 1, max: 1, options: opts }), { frames: 10 },
    q('return tostring(UI.getAttribute("eng_panel_Blue", "active")) .. "|" .. tostring(UI.getValue("eng_hint_Blue"))', "many")]);
  const [shown, hint] = String(valueOf(r, "many")).split("|");
  ok("many pile targets: the Engine panel opens", shown === "true", String(valueOf(r, "many")) + " " + r.errors.join(" | "));
  ok("many pile targets: the hint says where to pick", String(hint).includes("Engine panel"), hint);
}
// a few graveyard targets: pictures in the card row, and the hint says so (not "Click a glowing card")
{
  const img = "http://127.0.0.1:48787/img/x.jpg";
  const opts = Array.from({ length: 3 }, (_, k) => ({ id: "card|engine-card-96" + k, label: "Creature " + k, img }));
  const r = run([q('for k = 0, 2 do engineInPile["engine-card-96" .. k] = true end return "in pile"', "pile"), ask({ promptId: 993, kind: "target", title: "Kenrith, the Returned King: choose a target", mode: "multi", min: 1, max: 1, options: opts }), { frames: 10 },
    q('return tostring(UI.getValue("eng_hint_Blue"))', "few")]);
  ok("few pile targets: the hint points at the card row", String(valueOf(r, "few")).includes("card row"), String(valueOf(r, "few")) + " " + r.errors.join(" | "));
}
// a card the engine moves out of a graveyard pile (Kenrith returning a creature) is the table's own take: no "Look
// only" told (hp-07 #42 2026-10-27; TTS calls onObjectLeaveContainer for the table's takeObject too). A player's own
// take still is told, and during a manual fix it is not (that is how a fix moves a card out of a pile).
{
  const leave = (mark, setup) => q(`local pile = spawnObject({ type = "Deck" }) pile.setGMNotes("engine:graveyard:Blue")
    local card = spawnObject({ type = "Card" }) card.setGMNotes("engine:engine-card-1") ${setup} onObjectLeaveContainer(pile, card) __sim.frames(5) return "left"`, mark);
  // (one run each: a repeated identical tell is dropped, which hid the third case; a step that errors fails by name)
  const one = (mark, setup) => run([...s1.slice(40, 44).filter((m) => m.t !== "prompt").map((m) => ({ msg: { t: m.t, json: m.json } })), { frames: 30 }, leave(mark, setup)]);
  const check = (name, mark, setup, wantTold) => {
    const r = one(mark, setup);
    const told = fxOf(r, mark).some((l) => /Look only/.test(l));
    const ran = valueOf(r, mark) === "left";
    ok(name, ran && told === wantTold, (ran ? "" : "step did not run: ") + fxOf(r, mark).slice(0, 3).join(" ") + " " + r.errors.join(" | "));
  };
  check("pile: the table's own take is not told 'Look only'", "table take", "engineTakingOut['engine-card-1'] = true", false);
  check("pile: a player's take is still told 'Look only'", "player take", "", true);
  check("pile: during a manual fix a take is not thrown back", "fix take", "ENGINE_FIX_EDIT = true", false);
}
// the card row's line for an exact pick says the last click answers, not "then Done" (hp-07 re-test 2026-10-27)
{
  const img = "http://127.0.0.1:48787/img/x.jpg";
  const r = run([ask({ promptId: 994, title: "Choose", mode: "multi", min: 1, max: 1, options: [{ id: "engine-card-951", label: "A", img }, { id: "engine-card-952", label: "B", img }] }), { frames: 10 },
    q('return tostring(UI.getValue("eng_rowsub_Blue"))', "sub")]);
  ok("row: an exact pick's line says the last click answers", /last click answers/.test(String(valueOf(r, "sub"))) && !/then Done/.test(String(valueOf(r, "sub"))), String(valueOf(r, "sub")) + " " + r.errors.join(" | "));
}
// a row BUTTON of an exact pick answers at the click (hp-12 #7: Power Depot's "choose one" waited for Done)
{
  const r = run([ask({ promptId: 995, kind: "modal", title: "Power Depot: choose one", mode: "multi", min: 1, max: 1, options: [{ id: 0, label: "Modular 1" }, { id: 1, label: "Power Depot enters tapped." }] }), { frames: 10 },
    q('local m = engineRowMap and engineRowMap.Blue local n = m and #(m.btns or {}) or 0 onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_2") __sim.frames(30) return "btns=" .. n', "row button")]);
  const sentRow = fxOf(r, "row button").filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  ok("row: an exact pick's button answers at the click", /"choice":\[1\]/.test(sentRow), String(valueOf(r, "row button")) + " " + sentRow.slice(0, 200) + " " + r.errors.join(" | "));
}
// suite review 2026-10-27: cards that have no object but are not in a pile (a token folded into its group) don't open
// the panel; the table's own take of a card leaving a pile is its own (end to end, no "Look only", no mark left)
{
  const img = "http://127.0.0.1:48787/img/x.jpg";
  // (9 Insect tokens on the table, 8 folded into their group, so they have no objects: the reviewer's repro A)
  const last = JSON.parse([...s1.slice(0, 40)].reverse().find((m) => m.t === "table").json);
  const bl = last.players.find((x) => x.color === "Blue");
  const ids = Array.from({ length: 9 }, (_, k) => "tok-" + k);
  last.cards = { ...(last.cards || {}) };
  for (const id of ids) last.cards[id] = { n: "Insect", tok: true, ty: ["Creature"], p: 1, t: 1 };
  bl.battlefield = [...(bl.battlefield || []), ...ids.map((id) => ({ id, s: 1 }))];
  bl.keep = (bl.keep || []).filter((z) => z !== "battlefield");
  const r = run([{ msg: { t: "table", json: JSON.stringify(last) }, frames: 30 },
    ask({ promptId: 996, kind: "cards", title: "Sacrifice a creature", mode: "multi", min: 1, max: 1, options: ids.map((id) => ({ id, label: "Insect", img })) }), { frames: 10 },
    q('return tostring(UI.getAttribute("eng_panel_Blue", "active"))', "panel")]);
  ok("no object but not in a pile: the panel stays shut", String(valueOf(r, "panel")) !== "true", String(valueOf(r, "panel")) + " " + r.errors.join(" | "));
  const lastK = [...s1.slice(0, 40)].reverse().find((m) => m.t === "table" && (JSON.parse(m.json).players.find((x) => x.color === "Blue") || {}).battlefield);
  const mk = (gy, extraBf) => { const tk = JSON.parse(lastK.json); const blue = tk.players.find((x) => x.color === "Blue");
    tk.cards = { ...(tk.cards || {}), "gy-1": { n: "Swamp", ty: ["Land"] }, "gy-2": { n: "Hero", ty: ["Creature"] }, "gy-3": { n: "Plains", ty: ["Land"] } };
    blue.graveyard = gy.map((id) => ({ id })); blue.battlefield = [...blue.battlefield, ...extraBf.map((id) => ({ id, s: 1 }))];
    blue.keep = (blue.keep || []).filter((z) => z !== "graveyard" && z !== "battlefield"); return JSON.stringify(tk); };
  const r2 = run([{ msg: { t: "table", json: mk(["gy-1", "gy-2", "gy-3"], []) }, frames: 120, mark: "gy" },
    { msg: { t: "table", json: mk(["gy-1", "gy-3"], ["gy-2"]) }, frames: 60, mark: "back" },
    q('local n = 0 for _ in pairs(engineTakingOut) do n = n + 1 end local g for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:gy-2" then g = x end end return "marks=" .. n .. " hero=" .. tostring(g ~= nil)', "after")]);
  const back = fxOf(r2, "back");
  ok("pile take end to end: the card leaves the pile by the table's take", back.some((l) => /"takeObject"/.test(l)), back.slice(0, 3).join(" ") + " " + r2.errors.join(" | "));
  ok("pile take end to end: nobody is told 'Look only'", !back.some((l) => /Look only/.test(l)), back.filter((l) => /Look only/.test(l)).join(" ").slice(0, 200));
  ok("pile take end to end: the card is adopted and no mark is left", String(valueOf(r2, "after")) === "marks=0 hero=true", String(valueOf(r2, "after")));
}
// hp-08 #4: the table's own card in its owner's second hand zone (a scry's card laid there) is no "another player's
// hand"; a battlefield card there still goes back, with the message
{
  const IMG = "https://img.klrmngr.com/display/front/0/0/00a87f71-8dbe-44e1-b69b-a03f6ab62055.webp";
  const scry = ask({ promptId: 881, kind: "cards", title: "Scry 1: choose cards to put on the bottom", mode: "multi", min: 0, max: 1,
    dest: "library", scry: { move: "libraryBottom", keep: "libraryTop" }, options: [{ id: "engine-card-9011", label: "Card 9011", img: IMG }] });
  // (the table's own hand-zone event, on the zone the card is in: Blue's second hand zone)
  const enter = (id, mark) => q(`local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end
    local t = Player.Blue.getHandTransform(2) local z
    for _, x in ipairs(getObjects()) do if x.type == "Hand" and (x.getPosition() - t.position):magnitude() < 1 then z = x end end
    if not o or not z then return "missing " .. tostring(o) .. " " .. tostring(z) end
    onObjectEnterZone(z, o) return "entered"`, mark);
  const r = run([scry, { frames: 6 }, enter("engine-card-9011", "scry card"), { frames: 5 }, enter(blueBf[0], "battlefield card"), { frames: 5 }]);
  const told = (mark) => fxOf(r, mark).filter((l) => /another player's hand/.test(l));
  ok("hand guard: the table's scry card in its owner's second hand zone stays", valueOf(r, "scry card") === "entered" && told("scry card").length === 0, `${valueOf(r, "scry card")} ${told("scry card").join(" ").slice(0, 200)} ${r.errors.join(" | ")}`);
  ok("hand guard: a battlefield card in that zone goes back, said", valueOf(r, "battlefield card") === "entered" && told("battlefield card").length === 1, `${valueOf(r, "battlefield card")} ${fxOf(r, "battlefield card").join(" ").slice(0, 300)} ${r.errors.join(" | ")}`);
}
// hp-09 gap (2026-10-29): a kit with two commanders (a Background pair) loads them as two cards side by side on the
// command spot, each within its reach; one commander stays where it always went
{
  const card = (name) => `{ Name = "Card", GMNotes = "testcard", Nickname = "${name}", CardID = 100, CustomDeck = { [1] = { FaceURL = "x", BackURL = "x", NumWidth = 1, NumHeight = 1 } } }`;
  const kitLua = (cmds) => `local data = { Name = "Bag", GMNotes = "testkit", Nickname = "Kit", ContainedObjects = { { Name = "Deck", GMNotes = "testcard", Nickname = "Test deck k", ContainedObjects = { ${card("Forest")} } }${cmds.map((n) => `, ${card(n)}`).join("")} } }
    local kit = spawnObjectData({ data = data, position = Vector(4, 6, -28) })
    engineLoadTestKit({ guid = kit.getGUID(), color = "White" })
    local ps, names = {}, {}
    for _, o in ipairs(getObjects()) do if o.type == "Card" and tostring(o.getGMNotes()) == "testcard" and o.getName() ~= "Forest" then ps[#ps + 1] = o.getPosition() names[#names + 1] = o.getName() end end
    table.sort(names)
    if #ps ~= 2 then return #ps .. " cards: " .. table.concat(names, ",") end
    return table.concat(names, ",") .. string.format(" %.1f apart", math.sqrt((ps[1].x - ps[2].x) ^ 2 + (ps[1].z - ps[2].z) ^ 2))`;
  // (no game running: the loader refuses during one)
  const r = simulate({ save, steps: [{ frames: 5 }, q(kitLua(["Jaheira", "Raised by Giants"]), "two"), { frames: 5 }] });
  ok("kit loader: two commanders, two cards side by side", valueOf(r, "two") === "Jaheira,Raised by Giants 1.4 apart", `${valueOf(r, "two")} ${r.errors.join(" | ")}`);
}
// engineCardEntry (docs/core-moves-cleanup-plan.md §3, 2026-11-06): the one way an object becomes an engine card's
// object. Plays the golden's "card entry" game (tests/golden/table-run.js) and reads its named reports ("ce: ..."): a
// card taken back out of a pile gets its badges again, a reset while a board spawns leaves no late object behind, the
// pile and library members the table builds are neither locked nor tagged.
{
  const sc = require("./golden/table-run").scenarios().find((s) => s.name.startsWith("card entry"));
  const r = simulate({ save, steps: sc.steps });
  const value = (name) => String((r.steps.find((s) => s.step === `ce: ${name}`) || {}).value);
  // one card's part of a report ("7001 [a; b] | 7002 ...")
  const part = (name, n) => (value(name).split(" | ").find((x) => x.startsWith(`${n} `)) || "");
  ok("precondition: the scenario ran without a script error", r.errors.length === 0, r.errors.slice(0, 2).join(" | "));
  ok("precondition: the creatures had their boxes before they died", /Hexproof/.test(part("buttons on the board", 7001)) && /\[3\/3\]/.test(part("buttons on the board", 7002)), value("buttons on the board"));
  ok("precondition: the four went into the pile deck", value("in the pile").split(" | ").every((x) => /obj=nil .*inPile=true/.test(x)), value("in the pile"));

  // finding 1: engineAdopt kept the old badge text, so updateBadge drew nothing on the new object
  ok("entry: a creature taken back out of a 2-card graveyard shows its status box", /Hexproof, Flying,\/Vigilance/.test(part("buttons back from the pile", 7001)), part("buttons back from the pile", 7001));
  ok("entry: one under an anthem shows its P/T box", /\[3\/3\]/.test(part("buttons back from the pile", 7002)), part("buttons back from the pile", 7002));
  ok("entry: at the next priority both ability creatures have their buttons", /Prodigal/.test(part("buttons at priority after the return", 7004)) && /Destroy target/.test(part("buttons at priority after the return", 7005)), value("buttons at priority after the return"));
  ok("entry: and the status box is still there with them", /Hexproof/.test(part("buttons at priority after the return", 7001)), part("buttons at priority after the return", 7001));
  // the take-over keeps the taken object (no throw-away and respawn)
  const guidOf = (s) => (s.match(/obj=(\w+)@/) || [])[1];
  ok("entry: the cards back from the pile are the objects taken out of it", value("back from the pile").split(" | ").every((x) => /obj=s\d+@.*inPile=nil.*copies=1/.test(x)), value("back from the pile"));
  ok("entry: the searched card pulled out is its object, held for the engine's answer", /obj=s\d+@.*inPile=nil held=[\d.]+ .*copies=1/.test(value("the searched card pulled out")), value("the searched card pulled out"));
  ok("entry: the searched card is not replaced when it is played", guidOf(value("the searched card pulled out")) !== undefined && guidOf(value("the searched card pulled out")) === guidOf(value("the searched card, next board")), `${value("the searched card pulled out")} / ${value("the searched card, next board")}`);
  ok("entry: the picked graveyard card is its object, out of the pile, held", /obj=s\d+@.*inPile=nil held=[\d.]+ .*copies=1/.test(value("the picked card pulled out")), value("the picked card pulled out"));
  ok("entry: the picked card is not replaced in the hand", guidOf(value("the picked card pulled out")) !== undefined && guidOf(value("the picked card pulled out")) === guidOf(part("the picked card in the hand", 7010)), `${value("the picked card pulled out")} / ${part("the picked card in the hand", 7010)}`);

  // finding 2: a spawn callback from before "mtg reset" registered a trashed object and called setLock on it
  // round 2: engineInPile on the spawn path
  ok("entry: a card spawned on its own, out of a rebuilt pile, is in no pile", /^7040 obj=s\d+@.*inPile=nil .*copies=1$/.test(value("the card that left the rebuilt pile")), value("the card that left the rebuilt pile"));
  ok("precondition: the creature was still spawning when it died", /^7042 obj=nil spawning=true inPile=nil /.test(value("the creature spawning")), value("the creature spawning"));
  ok("entry: a pile that took a spawning card in keeps it in the pile after the late callback", /inPile=true/.test(value("the creature in the pile after its late callback")) && /^in the pile/.test(value("the late creature in the pile")), `${value("the creature in the pile after its late callback")} / ${value("the late creature in the pile")}`);
  ok("entry: and on the next board too, the late object gone from the table", /^7042 obj=nil .*inPile=true .*copies=0$/.test(value("the late creature, next board")) && /loose objects 0$/.test(value("the late creature in the pile, next board")), `${value("the late creature, next board")} / ${value("the late creature in the pile, next board")}`);
  ok("data: a card spawned to join a pile deck has no Locked and no Tags", /^in the pile, loose objects/.test(value("the late creature in the pile")), value("the late creature in the pile"));

  ok("precondition: the reset came while three cards and the library deck were spawning", value("the spawning objects") === "4 spawning", value("the spawning objects"));
  ok("entry: after a reset mid-spawn the late library deck is not the library's object", /\| library obj=nil .*copies=0 \|/.test(value("after the reset")), value("after the reset"));
  ok("entry: after a reset mid-spawn no late object is the card's object", [7030, 7031, 7032].every((n) => /obj=nil /.test(part("after the reset", n))), value("after the reset"));
  ok("entry: nothing is called on the destroyed late objects", /calls on destroyed objects: none$/.test(value("after the reset")), value("after the reset"));
  ok("precondition: one late object was hidden from the reset's sweep", value("hidden from the sweep") === "hidden" && value("listed again") === "listed", `${value("hidden from the sweep")} / ${value("listed again")}`);
  ok("entry: a late object the sweep missed is thrown away, not left on the table", /engine cards on the table: 0 /.test(value("after the reset")), value("after the reset"));

  // one data builder: what goes inside a pile or the library has no Locked and no Tags
  for (const name of ["graveyard members", "library members during the search"]) {
    ok(`data: ${name} have no Locked and no Tags`, !/Locked|Tags/.test(value(name).split(" + ")[0]) && / \(0 with Locked or Tags\) \| /.test(value(name)), value(name));
    ok(`data: ${name}: the deck's DeckIDs are its members' CardIDs`, / \| DeckIDs match \(\d+\)$/.test(value(name)), value(name));
  }
  ok("precondition: the members were read", /^7011, 7010 \+ 0 plain/.test(value("graveyard members")) && /^7020, 7021 \+ 90 plain/.test(value("library members during the search")), `${value("graveyard members")} / ${value("library members during the search")}`);

  // the face recorded for a spawned card is the board's (a hand card shows the plain back, its details its other face)
  ok("precondition: the double-faced card is in the hand, one object", /^7050 obj=s\d+@.* zone=hand .*copies=1$/.test(value("the drawn double-faced card")), value("the drawn double-faced card"));
  ok("entry: a double-faced card in the hand is not replaced on the next board", guidOf(value("the drawn double-faced card")) === guidOf(value("the drawn double-faced card, next board")) && /copies=1$/.test(value("the drawn double-faced card, next board")), `${value("the drawn double-faced card")} / ${value("the drawn double-faced card, next board")}`);

  // (2026-11-06, real table) cards added to a library together: they go IN as one object; a stray deck of plain backs
  // (TTS made one of 7 cards spawned on one spot, lying on the library) goes at "mtg reset". The fake TTS puts each card
  // in fine, so the one-object rule is read from what was spawned and put.
  {
    const fx = (mark) => (r.steps.find((s) => s.step === mark) || {}).fx || [];
    const libId = ((fx("library: a new game").find((l) => /"spawnObjectData" "Deck" obj:\S+ "Library" V\(40\.762/.test(l)) || "").match(/obj:(\S+) "Library"/) || [])[1];
    const added = (mark) => {
      const spawns = fx(mark).filter((l) => /"spawnObjectData" "(Card|Deck)" obj:\S+ "Library card"/.test(l));
      const ids = spawns.map((l) => l.match(/obj:(\S+) "Library card"/)[1]);
      const puts = fx(mark).filter((l) => /"putObject" /.test(l) && ids.some((x) => l.endsWith(`obj:${x}`)));
      return { spawns, puts, into: puts.every((l) => l.includes(`"putObject" obj:${libId} `)) };
    };
    const lib = (n) => `library Deck ${n} (${n} plain backs, 1 picture) | loose plain cards 0 | decks of plain backs off the library 0 | mixed deck no`;
    ok("precondition: libAdd: the library deck was found and starts at 92", libId !== undefined && value("library at the start") === lib(92), `${libId} / ${value("library at the start")}`);
    ok("libAdd: one card added goes into the library", value("library after one card") === lib(93), value("library after one card"));
    const one = added("library: one card put on the bottom");
    ok("libAdd: one card added is one plain card, put into the library", one.spawns.length === 1 && /"Card" obj:\S+ "Library card" .* 0 \d+ "\d+"$/.test(one.spawns[0]) && one.puts.length === 1 && one.into, JSON.stringify(one));
    ok("libAdd: seven added at once go into the library, nothing lies on it", value("library after seven at once") === lib(100), value("library after seven at once"));
    const seven = added("library: seven cards put on the bottom at once");
    ok("libAdd: seven added at once are ONE deck of 7, put into the library once", seven.spawns.length === 1 && /"Deck" obj:\S+ "Library card" V\([^)]*\) 7 0 "\d+"$/.test(seven.spawns[0]) && seven.puts.length === 1 && seven.into, JSON.stringify(seven));
    ok("libAdd: cards on their way are one unlocked deck of the library's plain backs, not a second library", value("the added cards on their way") === "Deck libcard locked=false of 3 libcard", value("the added cards on their way"));
    ok("precondition: libAdd: the library was destroyed while three were on their way", value("the library destroyed") === "destroyed" && added("library: three more, the library destroyed meanwhile").spawns.length === 1, value("the library destroyed"));
    ok("libAdd: cards added to a library destroyed meanwhile go to the trash, nothing left", value("library destroyed while cards were added") === "library none | loose plain cards 0 | decks of plain backs off the library 0 | mixed deck no"
      && fx("ce: the library destroyed").some((l) => { const id = (added("library: three more, the library destroyed meanwhile").spawns[0] || "").match(/obj:(\S+) "Library card"/); return id && l.endsWith(`"setGMNotes" obj:${id[1]} "enginetrash"`); }), value("library destroyed while cards were added"));
    ok("libAdd: the next board builds the whole library again", value("library on the next board") === lib(103), value("library on the next board"));
    ok("precondition: sweep: a stray deck of plain backs and a mixed deck lie on the table", /decks of plain backs off the library 1 \| mixed deck yes 7$/.test(value("library with the stray deck")), value("library with the stray deck"));
    ok("sweep: mtg reset throws away a deck of nothing but plain backs", /decks of plain backs off the library 0 \|/.test(value("library after the reset")), value("library after the reset"));
    ok("sweep: and leaves a deck with any other card in it alone", /\| mixed deck yes 7$/.test(value("library after the reset")), value("library after the reset"));
    // (breakit 2026-11-06) the library part plays with engine mode on, as a real game: the table refuses puts into its
    // own decks then, so a libAdd that forgot engineEntering is refused and its cards lie on the library
    ok("precondition: libAdd: engine mode is on in the library part", value("engine mode in the library part") === "true", value("engine mode in the library part"));
  }
  // (breakit 2026-11-06) every put the table makes is let in: the fake TTS asks tryObjectEnterContainer as TTS does, and
  // the table refuses its own puts unless it marked them (engineEntering)
  {
    const refused = r.steps.flatMap((s) => (s.fx || []).filter((l) => /"putObject refused/.test(l)).map((l) => `${s.step}: ${l}`));
    ok("puts: no put the table made in the card-entry game was refused", refused.length === 0, refused.slice(0, 3).join(" || "));
  }

  // round 2: a card picked out of a 2-card pile. TTS turns the deck into its last card (deck.remainder) and destroys
  // the deck; the fake table has no remainder, so the pick is played as TTS would: the remainder set on the deck
  // before the take, the deck destroyed after it. The card left must become that card's object, not a stray copy.
  const at = sc.steps.findIndex((s) => s.mark === "ce: the picked card pulled out");
  const upto = sc.steps.findIndex((s) => s.mark === "ce: the picked card in the hand");
  const pick = { mark: "ce: the picked card pulled out", lua: `local pile for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:graveyard:Blue" then pile = x end end
    if pile == nil then return "no pile" end
    local at, rest for _, e in ipairs(pile.getObjects()) do if e.gm_notes == "engine:engine-card-7010" then at = e.index end end
    for _, e in ipairs(pile.getData().ContainedObjects or {}) do if e.GMNotes == "engine:engine-card-7011" then rest = e end end
    if at == nil or rest == nil then return "not in the pile" end
    local left = spawnObjectData({ data = rest, position = pile.getPosition() })
    rawset(pile, "remainder", left)
    pile.takeObject({ index = at, position = pile.getPosition() + Vector(0, 2, 0), smooth = false })
    pile.destruct()
    return left.getGUID()` };
  const r2 = simulate({ save, steps: [...sc.steps.slice(0, at), pick, ...sc.steps.slice(at + 1, upto + 1)] });
  const v2 = (name) => String((r2.steps.find((s) => s.step === `ce: ${name}`) || {}).value);
  const left = (v2("the picked card in the hand").split(" | ").find((x) => x.startsWith("7011 ")) || "");
  ok("precondition: the remainder pick ran without a script error", at > 0 && upto > at && r2.errors.length === 0 && /^s\d+$/.test(v2("the picked card pulled out")), `${v2("the picked card pulled out")} ${r2.errors.slice(0, 2).join(" | ")}`);
  ok("entry: the card left in a 2-card pile after a pick is that pile's remainder object, no stray copy", left.startsWith(`7011 obj=${v2("the picked card pulled out")}@`) && /copies=1$/.test(left), `${v2("the picked card pulled out")} / ${left}`);

  // (jr-programmer-suite 2026-11-06) the same for the table's own take (engineTakeFromPiles): a land returns from a
  // 2-card graveyard. The pile deck is played as TTS has it: after the take, the card left is its remainder and the
  // deck is gone. That card must become the card's object, on this board and the next, with no copy spawned.
  const boardAt = sc.steps.findIndex((s) => s.mark === "entry: the board");
  const t0 = JSON.parse(sc.steps[boardAt].msg.json);
  const blue0 = t0.players.find((p) => p.color === "Blue");
  blue0.battlefield = [...blue0.battlefield, { s: 1, id: "engine-card-7010", ctl: "Blue" }];
  blue0.graveyard = [{ s: 1, id: "engine-card-7011", ctl: "Blue" }];
  const took = { msg: { t: "table", json: JSON.stringify(t0) }, frames: 60 };
  const cards = 'local out = {} for _, n in ipairs({ 7010, 7011 }) do out[#out + 1] = n .. " " .. engineDebugCard("engine-card-" .. n) end return table.concat(out, " | ") .. " | pile " .. engineDebugCard("graveyard:Blue")';
  const r3 = simulate({ save, steps: [...sc.steps.slice(0, boardAt + 1),
    { mark: "ce: remainder take patched", lua: `local pile for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:graveyard:Blue" then pile = x end end
      if pile == nil then return "no pile" end
      local take = pile.takeObject
      rawset(pile, "takeObject", function(p) local o = take(p) local rest = pile.getData().ContainedObjects
        if #rest == 1 then local left = spawnObjectData({ data = rest[1], position = pile.getPosition() }) rawset(pile, "remainder", left) pile.destruct() __ceLeft = left.getGUID() end
        return o end)
      return "patched " .. #pile.getObjects()` },
    { ...took, mark: "ce: a land returns from the 2-card graveyard" }, { mark: "ce: remainder take", lua: cards },
    { ...took, frames: 10, mark: "ce: the same board again" }, { mark: "ce: remainder take, next board", lua: `return tostring(__ceLeft) .. " | " .. (function() ${cards} end)()` },
    // (a pile whose last card is not an engine card, one a player dropped in: it is no card's object)
    { mark: "ce: a foreign remainder", lua: `local x = spawnObjectData({ data = { Name = "Card", Nickname = "a player's card", GMNotes = "" }, position = Vector(0, 1, 0) })
      local done = enginePileRemainder("graveyard:White", { remainder = x })
      return tostring(done) .. " | " .. engineDebugCard("") .. " | pile " .. engineDebugCard("graveyard:White")` }] });
  const v3 = (name) => String((r3.steps.find((s) => s.step === `ce: ${name}`) || {}).value);
  const left3 = (v3("remainder take, next board").split(" | ")[0]);
  ok("precondition: the table's own take from a 2-card pile ran, the remainder played as TTS does", boardAt > 0 && r3.errors.length === 0 && v3("remainder take patched") === "patched 2" && /^s\d+$/.test(left3), `${v3("remainder take patched")} ${left3} ${r3.errors.slice(0, 2).join(" | ")}`);
  for (const name of ["remainder take", "remainder take, next board"]) {
    const part3 = (n) => v3(name).split(" | ").find((x) => x.startsWith(`${n} `)) || "";
    ok(`entry: ${name}: the card left in the pile is the deck's remainder object, one copy`, part3(7011).startsWith(`7011 obj=${left3}@`) && /copies=1$/.test(part3(7011)), `${left3} / ${v3(name)}`);
    ok(`entry: ${name}: the land taken out is its object, one copy`, /^7010 obj=s\d+@.*inPile=nil .*copies=1$/.test(part3(7010)), v3(name));
  }
  ok("entry: a pile's remainder that is not an engine card is no card's object, and the pile is no deck", /^true \| obj=nil .* \| pile obj=nil /.test(v3("a foreign remainder")), v3("a foreign remainder"));
}
// The one way an object becomes an engine card's object (engineCardEntry) and the one builder of its data
// (engineCardData), as their comments say: no other place in the renderer registers an object for a card id or writes
// a card's "engine:<id>" GM notes. (Read from the source: a new way added elsewhere fails here by name.
// RENDERER_LUA=<a copy> reads a copy instead, to see it fail without touching the real file.)
{
  const src = fs.readFileSync(process.env.RENDERER_LUA || path.join(__dirname, "..", "tools", "engine-renderer.lua"), "utf8");
  const sets = src.split("\n").filter((l) => /engineObjs\[[^\]]+\]\s*=\s*(?!nil\b)[^=\s]/.test(l)).map((l) => l.trim());
  ok("one way: only engineCardEntry and the library and pile decks register an object in engineObjs", sets.length === 3 && sets[0] === "engineObjs[id] = obj" && sets.filter((l) => l === "engineObjs[id] = obj").length === 3, JSON.stringify(sets));
  const entry = src.slice(src.indexOf("function engineCardEntry("), src.indexOf("\nend\n", src.indexOf("function engineCardEntry(")));
  ok("one way: engineCardEntry is the card-id one", /\n  engineObjs\[id\] = obj\n/.test(entry), entry.slice(0, 120));
  const builders = src.split("\n").filter((l) => /GMNotes = "engine:" \.\./.test(l)).map((l) => l.trim());
  ok("one builder: a card's engine GM notes are written only by engineCardData (and a pile deck's own)", builders.length === 2 && /tostring\(c\.id\)/.test(builders[0]) && /GMNotes = "engine:" \.\. id,/.test(builders[1]), JSON.stringify(builders));
}
// trackMarks (2026-11-06, docs/core-moves-cleanup-plan.md "2. trackMarks" steps 4 and 6): the label under a life counter
// is the bridge's allMarks, whatever the old fields say; since step 6 the old fields alone (a bridge from before) draw
// nothing, and neither does an allMarks that isn't a list
{
  const lastT = [...s1.slice(0, 40)].reverse().find((m) => m.t === "table" && (JSON.parse(m.json).players.find((x) => x.color === "Blue") || {}).battlefield);
  const white = (fields) => { const t = JSON.parse(lastT.json); for (const p of t.players) if (p.color === "White") Object.assign(p, fields); return { msg: { t: "table", json: JSON.stringify(t) } }; };
  const label = 'local l = "no label" for _, b in ipairs(getObjectFromGUID("23e485").getButtons() or {}) do if b.tooltip == ENGINE_COUNTERS_TIP then l = b.label .. " @" .. tostring(b.width) end end return l';
  const OLD = { poison: 3, energy: 2, monarch: true, initiative: true, blessed: true, story: true, marks: ["SPEED 1"] };
  const r = run([
    white({ allMarks: ["POISON 3", "ENERGY 2", "MONARCH", "SPEED 1"] }), { frames: 10 }, q(label, "allMarks"),
    white(OLD), { frames: 10 }, q(label, "old fields"),
    white({ poison: 0, energy: 0 }), { frames: 10 }, q(label, "none"),
    white({ ...OLD, allMarks: ["POISON 3", "ENERGY 2", "MONARCH", "SPEED 1"] }), { frames: 10 }, q(label, "both"),
    white({ ...OLD, allMarks: ["POISON 5", "SPEED 1"] }), { frames: 10 }, q(label, "allMarks wins"),
    white({ allMarks: ["CITY'S BLESSING", "RING TEMPTED 1"] }), { frames: 10 }, q(label, "allMarks alone"),
    white({ poison: 2 }), { frames: 10 }, q(label, "back to old fields"),
    white({ allMarks: ["POISON 2"] }), { frames: 10 }, q(label, "drawn again"),
    white({ poison: 2, allMarks: [] }), { frames: 10 }, q(label, "empty allMarks"),
    white({ allMarks: ["POISON 2"] }), { frames: 10 }, q(label, "drawn before the broken one"),
    // (not a list: a broken bridge message; the type test draws nothing instead of an error)
    white({ poison: 2, marks: ["POISON 2"], allMarks: "POISON 9" }), { frames: 10 }, q(label, "allMarks not a list"),
    // (a number: without the type test ipairs throws, the caller's pcall swallows it and the last label stays)
    white({ allMarks: ["POISON 2"] }), { frames: 10 }, q(label, "drawn before the number"),
    white({ allMarks: 7 }), { frames: 10 }, q(label, "allMarks a number")]);
  const v = (m) => String(valueOf(r, m));
  ok("trackMarks: precondition: allMarks drew its label", v("allMarks") === "POISON 3   ENERGY 2   MONARCH   SPEED 1 @7125", v("allMarks") + " " + r.errors.join(" | "));
  ok("trackMarks: the old fields alone draw nothing (step 6)", v("old fields") === "no label", v("old fields"));
  ok("trackMarks: precondition: no marks, no label", v("none") === "no label", v("none"));
  ok("trackMarks: allMarks with the old fields: allMarks' label and width, once", v("both") === v("allMarks"), v("both"));
  ok("trackMarks: allMarks is the label, not the old fields", v("allMarks wins") === "POISON 5   SPEED 1 @3450", v("allMarks wins"));
  ok("trackMarks: allMarks alone is drawn", v("allMarks alone") === "CITY'S BLESSING   RING TEMPTED 1 @5900", v("allMarks alone"));
  ok("trackMarks: a row without allMarks takes the label away (step 6)", v("back to old fields") === "no label", v("back to old fields"));
  ok("trackMarks: precondition: allMarks drew a label before the empty one", v("drawn again") === "POISON 2 @1700", v("drawn again"));
  ok("trackMarks: an empty allMarks is no label", v("empty allMarks") === "no label", v("empty allMarks"));
  ok("trackMarks: precondition: allMarks drew a label before the broken one", v("drawn before the broken one") === "POISON 2 @1700", v("drawn before the broken one"));
  // (breakit 2026-11-06) the tracker's own onload clears its buttons: the same marks on the next board draw the label again
  const r2 = run([white({ allMarks: ["POISON 3", "MONARCH"] }), { frames: 10 }, q(label, "before the reload"),
    q('getObjectFromGUID("23e485").clearButtons() return "cleared"', "tracker reloaded"),
    white({ allMarks: ["POISON 3", "MONARCH"] }), { frames: 10 }, q(label, "same marks after the reload")]);
  ok("trackMarks: precondition: the label was drawn before the tracker reloaded", String(valueOf(r2, "before the reload")) === "POISON 3   MONARCH @3450", String(valueOf(r2, "before the reload")));
  ok("trackMarks: a tracker that lost its buttons gets the same label back", String(valueOf(r2, "same marks after the reload")) === String(valueOf(r2, "before the reload")), String(valueOf(r2, "same marks after the reload")));
  ok("trackMarks: precondition: allMarks drew a label before the number", v("drawn before the number") === "POISON 2 @1700", v("drawn before the number"));
  ok("trackMarks: an allMarks that is a number takes the label away", v("allMarks a number") === "no label", v("allMarks a number"));
  ok("trackMarks: an allMarks that is not a list draws nothing (not the old fields), with no error", v("allMarks not a list") === "no label" && !r.errors.length, v("allMarks not a list") + " " + r.errors.slice(0, 1).join(""));
}
// World boxes [x0, x1, z0, z1] for the marks-label and extra-turn-badge checks below. A button b (local bx, bz; w, h in
// button units; its own scale scx, scz) on a tracker t (x, z, ry, sx, sz): TTS draws a button's +x on its reader's
// right, world (-cos ry, sin ry), and its +z at world (sin ry, cos ry); 480 button units to a local unit.
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
// the save's commander-damage icons (by their name, not the renderer's CMD_DAMAGE), a box `half` either side of each
const cmdIcons = (half) => save.ObjectStates.filter((o) => o.Nickname === "Commander Damage")
  .map((o) => ({ g: o.GUID, box: [o.Transform.posX - half, o.Transform.posX + half, o.Transform.posZ - half, o.Transform.posZ + half] }));
// the save's four playmat zones (the scripting zones the size of a mat, 37 x 20.75)
const matZones = () => save.ObjectStates.filter((o) => o.Name === "ScriptingTrigger" && o.Transform.scaleX > 30)
  .map((o) => { const t = o.Transform; return { g: o.GUID, box: [t.posX - t.scaleX / 2, t.posX + t.scaleX / 2, t.posZ - t.scaleZ / 2, t.posZ + t.scaleZ / 2] }; });
// Marks label fit (live check 9, 2026-11-06: Red's "TURN RUN BY WHITE" ran into White's "RING TEMPTED 2   SPEED 3"
// between the two life counters). For all four seats' trackers, as they lie in the save, and long realistic marks: each
// label stays on its own seat's half of the table (off the middle line, so never on the next seat's label) and inside
// the mats' strip, in at most two lines, every mark in order; a short label stays as it was. The geometry is TTS's as
// measured on the live crop: a button's +x is on its reader's right; 480 button units to a local unit.
// (checker, 2026-11-07) No label's box meets a commander-damage icon's (the bottom icon of each column sat in the label's
// row: "SPE0D 3" on the live crop 9-crop-label-overlap) or a mat (two lines at font 300 ran 0.8 into it), and past what
// two lines hold the label is cut to two (marks in order, "+n MORE"). The icons and the mats' zones are read from the
// save, not from the renderer's own list; an icon's box is 1.2 a side (1.16 on the live shot 9-ring-speed).
{
  const SEATS = { "23e485": "White", "448880": "Red", "37e533": "Yellow", "395037": "Blue" };
  const PER = 480, ICON = 0.6;
  const geo = 'local out = {} for _, g in ipairs({ "23e485", "448880", "37e533", "395037" }) do local o = getObjectFromGUID(g) local p, r, s = o.getPosition(), o.getRotation(), o.getScale() local row = { g = g, x = p.x, z = p.z, ry = r.y, sx = s.x, sz = s.z } for _, b in ipairs(o.getButtons() or {}) do if b.tooltip == ENGINE_COUNTERS_TIP then row.label, row.w, row.h, row.f, row.bx, row.bz = b.label, b.width, b.height, b.font_size, b.position[1] or b.position.x, b.position[3] or b.position.z end end out[#out + 1] = row end return JSON.encode(out)';
  const setAll = (marks) => `for _, g in ipairs({ "23e485", "448880", "37e533", "395037" }) do enginePlayerCounters(getObjectFromGUID(g), JSON.decode([==[${JSON.stringify({ allMarks: marks })}]==])) end return "set"`;
  const marksBox = (t) => buttonBox(t, { bx: t.bx, bz: t.bz, w: t.w, h: t.h });
  // the label's world x span
  const span = (t) => { const b = marksBox(t); return [b[0], b[1]]; };
  const icons = cmdIcons(ICON), mats = matZones();
  ok("marks fit: precondition, the save's twelve commander-damage icons and four mat zones (top edges at |z| 5.03)",
    icons.length === 12 && mats.length === 4 && mats.every((m) => Math.abs(Math.min(Math.abs(m.box[2]), Math.abs(m.box[3])) - 5.025) < 0.01),
    `${icons.length} icons, mats ${JSON.stringify(mats.map((m) => m.box.map((n) => n.toFixed(2))))}`);
  // (the longest real labels: every PLAYER_MARKS row at once, keywords cut to 32 letters by the bridge; past two lines)
  const EVERY = ["TURN RUN BY YELLOW", "RING TEMPTED 4", "SPEED 4 (MAX)", "EXTRA TURN", "MONARCH", "INITIATIVE", "POISON 9", "ENERGY 12",
    "EXPERIENCE 5", "RAD 7", "TICKETS 3", "CITY'S BLESSING", "ENDURING STORY", "PREVENT 3", "NO MAX HAND SIZE", "YOU CAN'T LOSE THE GAME",
    "YOUR OPPONENTS CAN'T WIN THE GA…", "HEXPROOF", "SHROUD", "PROTECTION FROM EVERYTHING"];
  const COMBOS = {
    "Mindslaver (live check 9)": ["TURN RUN BY WHITE"],
    "Ring and speed (live check 9)": ["RING TEMPTED 2", "SPEED 3"],
    "every mark at once": ["TURN RUN BY WHITE", "RING TEMPTED 4", "SPEED 4 (MAX)", "EXTRA TURN", "MONARCH", "INITIATIVE", "POISON 9", "CITY'S BLESSING"],
    "long keywords": ["YOU CAN'T LOSE THE GAME", "HEXPROOF", "CONTROLLED BY YELLOW", "RING TEMPTED 4"],
    "just fits before the icons": ["TICKETS 10"],
    "two lines at font 300": ["TURN RUN BY YELLOW", "RING TEMPTED 4", "SPEED 4 (MAX)", "MONARCH", "INITIATIVE", "CITY'S BLESSING", "YOU CAN'T LOSE THE GAME"],
    "every player mark (past two lines)": EVERY,
    "one mark longer than a line": ["THIS PLAYER CAN'T BE THE TARGET OF SPELLS OR ABILITIES YOUR OPPONENTS CONTROL AND CAN'T LOSE"],
    "short": ["POISON 2"],
    // (jr suite 2026-11-07) two-byte letters, so the cut at 71 bytes falls inside one: "not inside a character"
    "one accented mark longer than a line": ["É".repeat(60)],
  };
  const CUT = new Set(["every player mark (past two lines)", "one mark longer than a line", "one accented mark longer than a line"]);
  const steps = [];
  for (const [name, marks] of Object.entries(COMBOS)) steps.push(q(setAll(marks), `set ${name}`), q(geo, `geo ${name}`));
  const r = run(steps);
  ok("marks fit: precondition, no script error", !r.errors.length, r.errors.slice(0, 2).join(" | "));
  for (const [name, marks] of Object.entries(COMBOS)) {
    let rows = [];
    try { rows = JSON.parse(String(valueOf(r, `geo ${name}`))); } catch (e) { /* checked below */ }
    ok(`marks fit, ${name}: precondition, four trackers, each with its label`, rows.length === 4 && rows.every((t) => typeof t.label === "string" && t.w > 0), String(valueOf(r, `geo ${name}`)).slice(0, 200));
    for (const t of rows) {
      const seat = `${name}, ${SEATS[t.g]}`;
      const box = marksBox(t);
      const [lo, hi] = [box[0], box[1]];
      // (the middle line is x = 0; the trackers of a side are 7 apart, so 0.25 off it leaves the next label 0.5 away)
      ok(`marks fit, ${seat}: the label stays on its own half of the table`, t.x < 0 ? hi <= -0.25 : lo >= 0.25, `x ${lo.toFixed(2)}..${hi.toFixed(2)}, tracker at ${t.x}`);
      ok(`marks fit, ${seat}: the label stays inside the mats' strip (commander zones at 39.5)`, Math.max(Math.abs(lo), Math.abs(hi)) <= 30, `x ${lo.toFixed(2)}..${hi.toFixed(2)}`);
      const lines = String(t.label).split("\n");
      if (!CUT.has(name)) ok(`marks fit, ${seat}: at most two lines, every mark in order`, lines.length <= 2 && lines.join("   ") === marks.join("   "), JSON.stringify(t.label));
      else {
        // (cut: the marks kept, in order, a mark too long for a line ending "..."; then "+n MORE" for the n left out)
        const items = lines.join("   ").split("   ");
        const more = /^\+(\d+) MORE$/.exec(items[items.length - 1]);
        const kept = more ? items.slice(0, -1) : items;
        const same = kept.every((k, i) => k === marks[i] || (k.endsWith("...") && k.length > 3 && marks[i].startsWith(k.slice(0, -3))));
        ok(`marks fit, ${seat}: cut to two lines, the marks kept in order and "+n MORE" for the rest`, lines.length <= 2 && kept.length >= 1 && same
          && kept.length + (more ? Number(more[1]) : 0) === marks.length, JSON.stringify(t.label));
        ok(`marks fit, ${seat}: cut at a whole character (no broken UTF-8)`, !String(t.label).includes("�") && Buffer.from(String(t.label), "utf8").toString("utf8") === String(t.label), JSON.stringify(t.label));
      }
      ok(`marks fit, ${seat}: no line wider than 8000`, t.w <= 8000, `width ${t.w}`);
      ok(`marks fit, ${seat}: a readable font, and its bottom edge where a one-line label's is`, t.f >= 180 && Math.abs(t.bz + t.h / 2 / PER - (1.45 + 380 / 2 / PER)) < 1e-6, `font ${t.f}, z ${t.bz}, height ${t.h}`);
      const hit = icons.filter((c) => meets(box, c.box)).map((c) => c.g);
      ok(`marks fit, ${seat}: no commander-damage icon under the label`, hit.length === 0, `label x ${lo.toFixed(2)}..${hi.toFixed(2)} z ${box[2].toFixed(2)}..${box[3].toFixed(2)} meets ${hit.join(" ")}`);
      const onMat = mats.filter((m) => meets(box, m.box)).map((m) => m.g);
      ok(`marks fit, ${seat}: the label stays off every mat`, onMat.length === 0, `label z ${box[2].toFixed(2)}..${box[3].toFixed(2)} meets the mat zone ${onMat.join(" ")}`);
    }
    // (a label that fits between the counter and its icon column stays there, by the counter; 2050 wide: 0.73..6.10)
    if (name === "just fits before the icons") ok("marks fit, just fits before the icons: it stays between the middle and its icon column on every seat",
      rows.length === 4 && rows.every((t) => { const b = marksBox(t); return Math.max(Math.abs(b[0]), Math.abs(b[1])) <= 6.79 - ICON; }), JSON.stringify(rows.map((t) => span(t).map((n) => +n.toFixed(2)))));
    if (name === "short") ok("marks fit, short: a short label is as it was, centred under its counter, one line at font 300", rows.every((t) => t.label === "POISON 2" && t.w === 1700 && t.h === 380 && t.f === 300 && t.bx === 0 && t.bz === 1.45), JSON.stringify(rows.map((t) => [t.w, t.h, t.f, t.bx, t.bz])));
  }
  // (the live case end to end: Red's and White's labels as two table boards send them, the White row's own)
  const lastT = [...s1.slice(0, 40)].reverse().find((m) => m.t === "table" && (JSON.parse(m.json).players.find((x) => x.color === "Blue") || {}).battlefield);
  const board = (marks) => { const t = JSON.parse(lastT.json); for (const p of t.players) if (p.color === "White") p.allMarks = marks; return { msg: { t: "table", json: JSON.stringify(t) }, frames: 10 }; };
  const r2 = run([board(["RING TEMPTED 2", "SPEED 3"]), q(geo, "board long"), board(["POISON 2"]), q(geo, "board short")]);
  const white = (m) => { try { return JSON.parse(String(valueOf(r2, m))).find((t) => t.g === "23e485"); } catch (e) { return null; } };
  const wl = white("board long"), ws = white("board short");
  ok("marks fit, table board: White's long label is pushed off the middle and past its icons", !!wl && wl.label === "RING TEMPTED 2   SPEED 3" && span(wl)[0] >= 0.25
    && !icons.some((c) => meets(marksBox(wl), c.box)), JSON.stringify(wl));
  ok("marks fit, table board: the next, short label goes back under the counter (the button is edited, not left where it was)", !!ws && ws.label === "POISON 2" && ws.bx === 0 && ws.w === 1700 && ws.h === 380, JSON.stringify(ws));
}
// Extra-turn counter (docs/extra-turn-counter-spec.md, 2026-11-06): the row's extraTurns as a number beside the life
// counter, the count + 1 (one extra turn shows 2), hover text "<name> has n extra turn(s) coming", none at 0, with no
// count (an engine from before) or a count that isn't a number; one button, edited as the count changes; gone with the
// game (engineCountersReset) and back after the tracker's own onload clears its buttons
{
  const lastT = [...s1.slice(0, 40)].reverse().find((m) => m.t === "table" && (JSON.parse(m.json).players.find((x) => x.color === "Blue") || {}).battlefield);
  const whiteName = (JSON.parse(lastT.json).players.find((p) => p.color === "White") || {}).name;
  const board = (fields) => { const t = JSON.parse(lastT.json); for (const p of t.players) if (p.color === "White") { delete p.extraTurns; Object.assign(p, fields); } return { msg: { t: "table", json: JSON.stringify(t) }, frames: 10 }; };
  const badge = 'local out = {} for _, b in ipairs(getObjectFromGUID("23e485").getButtons() or {}) do if engineExtraTurnTip(b.tooltip) then local p = b.position or {} out[#out + 1] = tostring(b.label) .. " | " .. tostring(b.tooltip) .. " @" .. tostring(p[1] or p.x) .. "," .. tostring(p[3] or p.z) end end return #out == 0 and "no badge" or table.concat(out, " || ")';
  const r = run([
    board({}), q(badge, "missing"),
    board({ extraTurns: 1 }), q(badge, "one"),
    board({ extraTurns: 2, allMarks: ["RING TEMPTED 2"] }), q(badge, "two"),
    board({ extraTurns: 2 }), q(badge, "two again"),
    board({ extraTurns: 1 }), q(badge, "one taken"),
    board({ extraTurns: 0 }), q(badge, "zero"),
    board({ extraTurns: 3 }), q('getObjectFromGUID("23e485").clearButtons() return "cleared"', "tracker reloaded"),
    board({ extraTurns: 3 }), q(badge, "after the reload"),
    board({ extraTurns: "2" }), q(badge, "a string"),
    board({ extraTurns: 1 }), { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 30 }, q(badge, "after the reset")]);
  const v = (m) => String(valueOf(r, m));
  const at = (s) => (s.match(/@(.*)$/) || [])[1];
  ok("extra turns: precondition, no script error, and White has a name", !r.errors.length && !!whiteName, `${whiteName} ${r.errors.slice(0, 2).join(" | ")}`);
  ok("extra turns: no count (an engine from before), no badge", v("missing") === "no badge", v("missing"));
  ok("extra turns: one extra turn shows 2, \"has 1 extra turn coming\"", v("one").startsWith(`2 | ${whiteName} has 1 extra turn coming @`), v("one"));
  ok("extra turns: two show 3, \"has 2 extra turns coming\", one button", v("two").startsWith(`3 | ${whiteName} has 2 extra turns coming @`) && !v("two").includes("||"), v("two"));
  ok("extra turns: unchanged, the same one button", v("two again") === v("two"), v("two again"));
  ok("extra turns: a turn taken lowers it", v("one taken") === v("one"), v("one taken"));
  ok("extra turns: none left, no badge", v("zero") === "no badge", v("zero"));
  ok("extra turns: a tracker that lost its buttons gets it back", v("after the reload").startsWith(`4 | ${whiteName} has 3 extra turns coming @`), v("after the reload"));
  ok("extra turns: a count that isn't a number shows nothing", v("a string") === "no badge", v("a string"));
  ok("extra turns: the end of the game takes it away", v("after the reset") === "no badge", v("after the reset"));
  // (beside the life counter, on its own half: the counter's top-left lobe, off the marks label under it)
  const [bx, bz] = String(at(v("one")) || "").split(",").map(Number);
  ok("extra turns: the badge sits on the counter, above the marks label", Math.abs(bx) <= 1.2 && bz < 0 && bz > -1.6, `at ${at(v("one"))}`);
}
// Extra-turn badge fit (checker, 2026-11-07: moving it from local x -1 to +1, onto the [R] lobe, passed every test). On
// all four trackers, with one digit ("2") and two ("10"), beside a short label and a two-line one: the badge is at local
// (-1, -1.45), and its box meets none of the tracker's own life number, -20 or [R] buttons (read from the tracker's
// script in the save), its marks label, or a commander-damage icon (as the marks fit above)
{
  const SEATS = { "23e485": "White", "448880": "Red", "37e533": "Yellow", "395037": "Blue" };
  const icons = cmdIcons(0.6);
  // the tracker's own buttons, as its script makes them (onload; the fake TTS runs no object scripts)
  const own = {};
  for (const g of Object.keys(SEATS)) {
    const src = String((save.ObjectStates.find((o) => o.GUID === g) || {}).LuaScript || "");
    const num = (re) => { const m = re.exec(src); return m ? m.slice(1).map(Number) : null; };
    const X = num(/^x=([-\d.]+)\s*$/m), Z = num(/^z=([-\d.]+)\s*$/m), SC = num(/^scale\s*=\s*\{([\d.]+),1,([\d.]+)\}/m), SC2 = num(/^scale2\s*=\s*\{([\d.]+),1,([\d.]+)\}/m);
    const MAIN = num(/-- the main button[\s\S]*?height=(\d+),\s*width=(\d+),[\s\S]*?position=\{0,y,z\}/);
    const SIDE = num(/-- the side buttons[\s\S]*?height=(\d+),\s*width=(\d+),/);
    const M20 = num(/\{n=-20,l='-20',p=\{-x\*([\d.]+),y,z-([\d.]+)\}\}/);
    const RST = num(/-- reset life to 40 button[\s\S]*?position=\{x\*([\d.]+),y,z-([\d.]+)\},\s*height=(\d+),\s*width=(\d+),/);
    const all = [X, Z, SC, SC2, MAIN, SIDE, M20, RST];
    ok(`badge fit, ${SEATS[g]}: precondition, the tracker's life number, -20 and [R] buttons read from its script`, all.every(Boolean), JSON.stringify(all));
    if (!all.every(Boolean)) continue;
    own[g] = {
      "the life number": { bx: 0, bz: Z[0], w: MAIN[1], h: MAIN[0], scx: SC[0], scz: SC[1] },
      "the -20": { bx: -X[0] * M20[0], bz: Z[0] - M20[1], w: SIDE[1], h: SIDE[0], scx: SC2[0], scz: SC2[1] },
      "the [R]": { bx: X[0] * RST[0], bz: Z[0] - RST[1], w: RST[3], h: RST[2], scx: SC2[0], scz: SC2[1] },
    };
  }
  const four = '{ "23e485", "448880", "37e533", "395037" }';
  const set = (marks, n) => `for _, g in ipairs(${four}) do local o = getObjectFromGUID(g) enginePlayerCounters(o, JSON.decode([==[${JSON.stringify({ allMarks: marks })}]==])) engineExtraTurnBadge(o, { extraTurns = ${n}, name = "P" }) end return "set"`;
  const btns = `local out = {} for _, g in ipairs(${four}) do local o = getObjectFromGUID(g) local p, r, s = o.getPosition(), o.getRotation(), o.getScale() local row = { g = g, x = p.x, z = p.z, ry = r.y, sx = s.x, sz = s.z, marks = {}, badges = {} } for _, b in ipairs(o.getButtons() or {}) do local q = b.position or {} local e = { label = b.label, w = b.width, h = b.height, bx = q[1] or q.x, bz = q[3] or q.z } if b.tooltip == ENGINE_COUNTERS_TIP then row.marks[#row.marks + 1] = e elseif engineExtraTurnTip(b.tooltip) then row.badges[#row.badges + 1] = e end end out[#out + 1] = row end return JSON.encode(out)`;
  const CASES = {
    "one digit, a short label": [["POISON 2"], 1, "2"],
    "two digits, a two-line label": [["TURN RUN BY YELLOW", "RING TEMPTED 4", "SPEED 4 (MAX)", "MONARCH", "INITIATIVE", "CITY'S BLESSING", "YOU CAN'T LOSE THE GAME"], 9, "10"],
  };
  const steps = [];
  for (const [name, [marks, n]] of Object.entries(CASES)) steps.push(q(set(marks, n), `set ${name}`), q(btns, `buttons ${name}`));
  const r = run(steps);
  ok("badge fit: precondition, no script error", !r.errors.length, r.errors.slice(0, 2).join(" | "));
  const list = (v) => (Array.isArray(v) ? v : []);
  for (const [name, [, , digits]] of Object.entries(CASES)) {
    let rows = [];
    try { rows = JSON.parse(String(valueOf(r, `buttons ${name}`))); } catch (e) { /* checked below */ }
    ok(`badge fit, ${name}: precondition, four trackers, each with one badge "${digits}" and one label`,
      rows.length === 4 && rows.every((t) => list(t.badges).length === 1 && list(t.badges)[0].label === digits && list(t.marks).length === 1), String(valueOf(r, `buttons ${name}`)).slice(0, 300));
    for (const t of rows) {
      const seat = `${name}, ${SEATS[t.g]}`, b = list(t.badges)[0], m = list(t.marks)[0];
      if (!b || !m || !own[t.g]) continue;
      ok(`badge fit, ${seat}: at local (-1, -1.45), the counter's top-left lobe`, b.bx === -1 && b.bz === -1.45, `at ${b.bx}, ${b.bz}`);
      const box = buttonBox(t, b);
      for (const [what, o] of Object.entries(own[t.g])) ok(`badge fit, ${seat}: clear of ${what}`, !meets(box, buttonBox(t, o)), `badge ${JSON.stringify(box.map((n) => +n.toFixed(2)))} ${what} ${JSON.stringify(buttonBox(t, o).map((n) => +n.toFixed(2)))}`);
      ok(`badge fit, ${seat}: clear of the marks label`, !meets(box, buttonBox(t, m)), `badge ${JSON.stringify(box.map((n) => +n.toFixed(2)))} label ${JSON.stringify(buttonBox(t, m).map((n) => +n.toFixed(2)))}`);
      const hit = icons.filter((c) => meets(box, c.box)).map((c) => c.g);
      ok(`badge fit, ${seat}: clear of every commander-damage icon`, hit.length === 0, `meets ${hit.join(" ")}`);
    }
  }
}
// (jr suite 2026-11-07) "from the last button down, as a removal moves the ones after it" (engineCountersReset): a
// tracker with both its marks label and its extra-turn badge loses both at the end of the game, and a button of its own
// put before them stays (removing from the first up skipped the badge, which moved into the label's place)
{
  const count = 'local o = getObjectFromGUID("23e485") local n, own = 0, 0 for _, b in ipairs(o.getButtons() or {}) do if b.tooltip == ENGINE_COUNTERS_TIP or engineExtraTurnTip(b.tooltip) then n = n + 1 elseif b.label == "OWN" then own = own + 1 end end return tostring(n) .. " engine, " .. tostring(own) .. " own"';
  const r = run([
    q('local o = getObjectFromGUID("23e485") o.createButton({ click_function = "engineNoop", function_owner = Global, label = "OWN" }) enginePlayerCounters(o, { allMarks = { "POISON 2" } }) engineExtraTurnBadge(o, { extraTurns = 1, name = "P" }) return "set"', "set"),
    q(count, "before"), q("engineCountersReset() return 'reset'", "reset"), q(count, "after")]);
  ok("reset: precondition, the label and the badge are on the tracker beside its own button", String(valueOf(r, "before")) === "2 engine, 1 own" && !r.errors.length, `${valueOf(r, "before")} ${r.errors.slice(0, 1).join("")}`);
  ok("reset: the label and the badge both go, the tracker's own button stays", String(valueOf(r, "after")) === "0 engine, 1 own", String(valueOf(r, "after")));
}
// (breakit 2026-11-06) a slow library spawn from before "mtg reset" arrives while the next game's library is still on
// its way (a 100-card deck takes TTS several frames): the late one must leave the new one's "spawning" mark alone, or
// the next board spawns a second library beside it. The fake TTS's spawnDelay makes library spawns slow: the search's
// library 1 frame, the old game's last one 3, the next game's 10.
{
  const lastT = [...s1.slice(0, 40)].reverse().find((m) => m.t === "table" && (JSON.parse(m.json).players.find((x) => x.color === "Blue") || {}).battlefield);
  const libBoard = (n) => { const t = JSON.parse(lastT.json); t.players.find((p) => p.color === "Blue").library = n; return { msg: { t: "table", json: JSON.stringify(t) }, frames: 1 }; };
  const started = s1.find((m) => m.t === "started");
  const opt = { n: "Opt", f: "https://img.example/opt.jpg", tl: "Instant", cmc: 1, ty: ["Instant"] };
  const libs = 'local n = 0 for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:library:Blue" then n = n + 1 end end return n .. " library objects, " .. tostring(__bkLibN) .. " library spawns"';
  const r = run([
    { lua: '__sim.spawnDelay = function(d) if d.GMNotes == "engine:library:Blue" then __bkLibN = (__bkLibN or 0) + 1 return __bkLibN == 1 and 1 or __bkLibN == 2 and 3 or 10 end end return "slow libraries"', frames: 0 },
    ask({ promptId: 9001, kind: "cards", title: "Search your library", mode: "multi", min: 0, max: 1, cards: { "engine-card-9001": opt },
      librarySearch: [{ s: 1, id: "engine-card-9001" }], options: [{ id: "engine-card-9001", label: "Opt" }] }),
    { ...ask({ promptId: null }), frames: 1 }, // (the search closes: the library is rebuilt, slowly)
    { lua: libs, frames: 0, mark: "race: the old library on its way" },
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 0 },
    { lua: 'engineChat("mtg start ai 1", Player.Blue)', frames: 0 }, { msg: { t: started.t, json: started.json }, frames: 0 },
    libBoard(50), { lua: libs, frames: 0, mark: "race: the new library on its way" },
    { frames: 5 }, libBoard(51), { lua: libs, frames: 0, mark: "race: a board while the new one is still on its way" }]);
  const v = (m) => String(valueOf(r, m));
  ok("precondition: race: the old game's library was spawning (slowly)", v("race: the old library on its way") === "1 library objects, 2 library spawns", v("race: the old library on its way") + " " + r.errors.slice(0, 1).join(""));
  ok("precondition: race: the new game's library is on its way after the reset", v("race: the new library on its way") === "1 library objects, 3 library spawns", v("race: the new library on its way"));
  // (the old library was thrown away by the reset and is gone when its callback comes: the fake TTS raises on any call
  // to a destroyed object but isDestroyed, as TTS does, and an error in a callback is recorded as "ERROR wait")
  const errs = r.steps.flatMap((s) => (s.fx || []).filter((l) => /"ERROR/.test(l)));
  ok("spawn: the late library callback calls nothing on its destroyed object", errs.length === 0 && r.errors.length === 0, errs.concat(r.errors).slice(0, 2).join(" || "));
  ok("spawn: a late library from before a reset leaves the next game's spawning library alone (one library, no second spawn)", v("race: a board while the new one is still on its way") === "1 library objects, 3 library spawns", v("race: a board while the new one is still on its way"));
}
// Done with too few cards picked tells the player how many, as the bridge's own refusal does (live check 11: forage's
// "Done (1)" of 3 did nothing and said nothing), on the row's Done and the panel's, and sends nothing
{
  const sentIn = (r, mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ");
  const said = (r, mark) => fxOf(r, mark).filter((l) => l.includes("broadcastToColor")).join(" | ");
  const r = run([
    ask({ promptId: 821, kind: "modal", title: "Choose two", mode: "multi", min: 2, max: 2, options: [{ id: "0", label: "Draw a card" }, { id: "1", label: "Gain 3 life" }, { id: "2", label: "Scry 2" }] }),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_1")', "one mode"),
    q('return tostring(UI.getAttribute("eng_rowopt_Blue_4", "interactable"))', "row done clickable"),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_4")', "row done"),
    q('return tostring(UI.getAttribute("eng_confirm_Blue", "interactable"))', "panel done clickable"),
    q('return tostring(UI.getAttribute("eng_rowopt_Blue_4", "color"))', "row done colour short"),
    q('engineConfirm("Blue")', "panel done"),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_2")', "second mode"),
    q('return tostring(UI.getAttribute("eng_rowopt_Blue_4", "color"))', "row done colour ready"),
    // (a question with a min and no max: its bounds as engineCountOk reads them, "2-99", not "2-nil")
    ask({ promptId: 822, kind: "modal", title: "Choose two or more", mode: "multi", min: 2, options: [{ id: "0", label: "Draw a card" }, { id: "1", label: "Gain 3 life" }, { id: "2", label: "Scry 2" }] }),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_1")', "open max one"),
    q('engineConfirm("Blue")', "open max done"),
  ]);
  ok("too few: the row's Done can be pressed", valueOf(r, "row done clickable") === "true", valueOf(r, "row done clickable"));
  ok("too few: the row's Done says how many, and sends nothing", /Choose 2 \(you chose 1\)\./.test(said(r, "row done")) && !sentIn(r, "row done").includes('"choice"'), `${said(r, "row done")} ${sentIn(r, "row done").slice(0, 200)}`);
  ok("too few: the panel's Done can be pressed", valueOf(r, "panel done clickable") === "true", valueOf(r, "panel done clickable"));
  // (jr suite 2026-11-07: "the panel's Done says it too" passed on the row's message alone. The panel's press right after
  // the row's says nothing, tell's 3 s repeat guard, and sends nothing; its own message is checked in a run below)
  ok("too few: the panel's Done right after the row's sends nothing", !sentIn(r, "panel done").includes('"choice"'), sentIn(r, "panel done").slice(0, 200));
  // ("only its colour says it isn't ready": grey below its count, the primary orange once the count is met, the colour
  // engineCountOk gives the row's Done)
  ok("too few: the row's Done is grey below its count and orange once it is met", valueOf(r, "row done colour short") === "#2e3a59" && valueOf(r, "row done colour ready") === "#e8711a",
    `${valueOf(r, "row done colour short")} -> ${valueOf(r, "row done colour ready")}`);
  ok("too few: a question with no max says its bounds as 2-99", /Choose 2-99 \(you chose 1\)\./.test(said(r, "open max done")) && !sentIn(r, "open max done").includes('"choice"'), said(r, "open max done"));
  // (the panel's own press, in a run of its own: tell says the same words to a player once in 3 s, so the panel's press
  // right after the row's said nothing, by design)
  const r2 = run([
    ask({ promptId: 823, kind: "modal", title: "Choose two", mode: "multi", min: 2, max: 2, options: [{ id: "0", label: "Draw a card" }, { id: "1", label: "Gain 3 life" }, { id: "2", label: "Scry 2" }] }),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_1")', "one mode"),
    q('engineConfirm("Blue")', "panel done alone"),
  ]);
  ok("too few: the panel's Done says it on its own, and sends nothing", /Choose 2 \(you chose 1\)\./.test(said(r2, "panel done alone")) && !sentIn(r2, "panel done alone").includes('"choice"'), `${said(r2, "panel done alone")} ${sentIn(r2, "panel done alone").slice(0, 200)}`);
}
// Kykar hand test #16: a finished game's top bar shows GAME OVER and why, no turn or step
{
  const r = run([q('local t = engineTable() t.gameOver = false engineUpdateCorner("Blue", nil) return tostring(UI.getValue("eng_phase_Blue"))', "playing"),
    q('local t = engineTable() t.gameOver = true t.overWhy = "Blue and AI 1 drew from an empty library" engineUpdateCorner("Blue", nil) return tostring(UI.getValue("eng_phase_Blue"))', "over")]);
  const bar = String(valueOf(r, "over"));
  ok("precondition: a running game's bar shows the turn", /TURN/.test(String(valueOf(r, "playing"))), String(valueOf(r, "playing")) + " " + r.errors.join(" | "));
  ok("kykar #16: a finished game's bar says GAME OVER and why, no turn", /GAME OVER/.test(bar) && bar.includes("Blue and AI 1 drew from an empty library") && !/TURN|Main 1|MAIN 1/.test(bar), bar);
}
// Kykar hand test #27: copies of cards in a pile (Arcane Bombardment) are cast, not dragged out: the hint says where to pick
{
  const r = run([q('engineInPile["engine-card-1940"] = true return "in pile"', "pile"),
    ask({ promptId: 993, kind: "cards", title: "Arcane Bombardment: cast which copy?", text: "The copy is cast; the card stays where it is.", mode: "multi", min: 0, max: 1, copies: true, options: [{ id: "engine-card-1940", label: "Opt" }] }), { frames: 10 },
    q('return tostring(UI.getValue("eng_hint_Blue"))', "hint")]);
  const hint = String(valueOf(r, "hint"));
  ok("kykar #27: copies' hint says the card row or the Engine panel, no drag", hint.includes("Pick it in the card row or the Engine panel.") && !/drag/i.test(hint), hint + " " + r.errors.join(" | "));
}
// ── the scry glitch and revealed hands (2026-11-09) ──
// The 2026-11-08 20:23 game's own messages: Courser of Kruphix's revealed top card in both seated players' rows, and
// Blue's scry of it (prompt #1003 as the bridge sent it).
{
  const { simulate } = require("./lua/run-sim");
  const both = (steps) => simulate({ save, seated: ["Blue", "White"], steps: [...prefix, ...steps] });
  const scry1003 = { t: "prompt", color: "Blue", promptId: 1003, title: "Scry 1: choose cards to put on the bottom", mode: "multi", min: 0, max: 1, dest: "library", kind: "cards",
    scry: { move: "libraryBottom", keep: "libraryTop" }, text: "They are in your second hand zone.",
    options: [{ id: "engine-card-160", label: "Jugan Defends the Temple", img: "https://img.klrmngr.com/display/front/d/0/d07659ac-f4d2-4198-af81-44bc9e677c0b.webp" }] };
  const rows = 'local t = engineTable() local blue, white for _, p in ipairs(t.players) do if p.color == "Blue" then blue = p elseif p.color == "White" then white = p end end ' +
    'engineStoreStatic("engine-card-160", { n = "Jugan Defends the Temple", f = "https://img.example/jugan.jpg", ty = { "Enchantment" } }) ' +
    'white.playable = { { s = 1, id = "engine-card-160", sick = true, ctl = "Blue" } } blue.playable = { { s = 1, id = "engine-card-160", sick = true, ctl = "Blue" } } ';
  // where the card lies: the mat it is on (by distance), and how many objects carry it
  const where = 'local n, o = 0, nil for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:engine-card-160" then n = n + 1 o = x end end ' +
    'if o == nil then return "none" end local p = o.getPosition() local h2 = Player.Blue.getHandTransform(2) ' +
    'local function d(v) return math.sqrt((p.x - v.x) ^ 2 + (p.z - v.z) ^ 2) end ' +
    'local mat = d(data.Blue.playmat.getPosition()) < d(data.White.playmat.getPosition()) and "Blue" or "White" ' +
    'return n .. " " .. mat .. " " .. ((h2 ~= nil and d(h2.position) < 0.5) and "hand2" or "row")';
  const r = both([
    q(rows + 'engineRender(t) __sim.frames(90) return tostring(enginePlayableRows(t)["engine-card-160"])', "no scry"), q(where, "where before"),
    { msg: { t: "prompt", json: JSON.stringify(scry1003) }, frames: 10 },
    q('local t = engineTable() engineRender(t) __sim.frames(90) return tostring(enginePlayableRows(t)["engine-card-160"])', "scry"), q(where, "where scry"),
    q('engineRender(engineTable()) __sim.frames(90) return "again"', "again"), q(where, "where again"),
    q('return tostring(Player.Blue.getHandTransform(2) ~= nil)', "hand2"),
    // a card dragged out of the zone (onto the library) is no longer held; an unseated player's scry has no zone to hold it in
    q('engineScry.Blue.gone["engine-card-160"] = "top" local h = engineScryHeld() engineScry.Blue.gone["engine-card-160"] = nil return tostring(h["engine-card-160"])', "gone"),
    q('enginePrompts.Yellow = { promptId = 4242, scry = { move = "libraryBottom", keep = "libraryTop" }, options = { { id = "engine-card-161" } } } ' +
      'local h = engineScryHeld() enginePrompts.Yellow = nil engineScry.Yellow = nil return tostring(h["engine-card-161"]) .. " " .. tostring(Player.Yellow.seated)', "unseated"),
  ]);
  ok("scry glitch: precondition, Blue has a second hand zone", valueOf(r, "hand2") === "true", r.errors.join(" | "));
  ok("scry glitch: a card in two rows goes to its controller's row only", valueOf(r, "no scry") === "Blue", String(valueOf(r, "no scry")));
  ok("scry glitch: placed once, on Blue's mat", valueOf(r, "where before") === "1 Blue row", String(valueOf(r, "where before")));
  ok("scry glitch: a card the scry holds is in no row", valueOf(r, "scry") === "nil", String(valueOf(r, "scry")));
  ok("scry glitch: it stays in Blue's second hand zone", valueOf(r, "where scry") === "1 Blue hand2", String(valueOf(r, "where scry")) + " " + r.errors.join(" | "));
  ok("scry glitch: and the next board leaves it there", valueOf(r, "where again") === "1 Blue hand2", String(valueOf(r, "where again")));
  ok("scry glitch: a card dragged out of the zone isn't held any more", valueOf(r, "gone") === "nil", String(valueOf(r, "gone")) + " " + r.errors.join(" | "));
  ok("scry glitch: an unseated player's scry holds nothing", valueOf(r, "unseated") === "nil false", String(valueOf(r, "unseated")) + " " + r.errors.join(" | "));
  // Thief of Sanity's card (controlled by its owner, White) listed only in its caster's row goes there
  // (Yellow isn't seated: its row isn't drawn, so its listing gives no row)
  const r2 = both([q('local m = { players = { { color = "White", playable = { { id = "x", ctl = "Blue" } } }, { color = "Blue", playable = { { id = "x", ctl = "Blue" }, { id = "y", ctl = "White" } } }, ' +
    '{ color = "Yellow", playable = { { id = "z", ctl = "Yellow" } } } } } ' +
    'local rows = enginePlayableRows(m) return tostring(rows.x) .. " " .. tostring(rows.y) .. " " .. tostring(rows.z)', "rows")]);
  ok("one row: the controller's row wins, a caster's card goes to the caster", /^Blue Blue /.test(String(valueOf(r2, "rows"))), String(valueOf(r2, "rows")) + " " + r2.errors.join(" | "));
  ok("one row: an unseated player's listing gives no row", / nil$/.test(String(valueOf(r2, "rows"))), String(valueOf(r2, "rows")));
}
// Sen Triplets on a seated human: Blue's hand card is in White's (the caster's) playable list. The real card stays in
// Blue's hand on every board; White's row gets a stand-in (cast:White:<id>) that casts the real card when dragged; the
// table check agrees. (The verifier's probe, 2026-11-09: the real card jumped onto White's mat from the second board.)
{
  const { simulate } = require("./lua/run-sim");
  const both = (steps) => simulate({ save, seated: ["Blue", "White"], steps: [...prefix, ...steps] });
  const setup = (revealed) => 'local t = engineTable() local blue, white for _, p in ipairs(t.players) do if p.color == "Blue" then blue = p elseif p.color == "White" then white = p end end ' +
    'engineStoreStatic("engine-card-900", { n = "Lightning Bolt", f = "https://img.example/bolt.jpg", ty = { "Instant" } }) ' +
    'blue.hand = blue.hand or {} table.insert(blue.hand, { s = 1, id = "engine-card-900", ctl = "Blue" }) blue.handCount = #blue.hand ' +
    'white.playable = { { s = 1, id = "engine-card-900", ctl = "Blue" } } ' + (revealed ? 'blue.revealed = { { s = 1, id = "engine-card-900", ctl = "Blue" } } ' : 'blue.revealed = nil ') +
    'SEN = t engineRender(SEN) __sim.frames(90) return "drawn"';
  // where an object lies: how many carry the id, the nearer mat, and whether it is in a hand zone (1 or 2) of that colour
  const where = (id) => `local n, o = 0, nil for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then n = n + 1 o = x end end ` +
    'if o == nil then return "none" end local p = o.getPosition() local function d(v) return math.sqrt((p.x - v.x) ^ 2 + (p.z - v.z) ^ 2) end ' +
    'local mat = d(data.Blue.playmat.getPosition()) < d(data.White.playmat.getPosition()) and "Blue" or "White" ' +
    'local h1, h2 = Player[mat].getHandTransform(1), Player[mat].getHandTransform(2) ' +
    'return n .. " " .. mat .. " " .. ((h1 ~= nil and d(h1.position) < 3) and "hand" or (h2 ~= nil and d(h2.position) < 0.5) and "hand2" or "row")';
  const check = 'local out = {} for _, pr in ipairs(engineSelfCheck().problems or {}) do if tostring(pr):find("Lightning Bolt", 1, true) then out[#out + 1] = tostring(pr) end end return #out == 0 and "none" or table.concat(out, " || ")';
  const drop = 'local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:cast:White:engine-card-900" then o = x end end if o == nil then return "no stand-in" end ' +
    'local m = data.White.playmat.getPosition() o.setPosition(Vector(m.x, 1.5, m.z)) onObjectDrop("White", o) __sim.frames(5) return "dropped"';
  const r = both([q(setup(true), "drawn"), q(where("engine-card-900"), "real 1"),
    q('engineRender(SEN) __sim.frames(90) return "again"', "again"), q(where("engine-card-900"), "real 2"), q(where("cast:White:engine-card-900"), "stand-in"),
    q(check, "check"), q(drop, "drop"),
    q(setup(false), "private"), q(where("cast:White:engine-card-900"), "stand-in private"), q(where("engine-card-900"), "real private"),
    // (a seat's own hand card in its own playable list, which the bridge never sends: the hand keeps it, no stand-in)
    q('for _, p in ipairs(SEN.players) do if p.color == "White" then p.playable = nil elseif p.color == "Blue" then p.playable = { { s = 1, id = "engine-card-900", ctl = "Blue" } } end end engineRender(SEN) __sim.frames(90) return "own"', "own"),
    q(where("engine-card-900"), "real own"), q(check, "check own"), q(where("cast:Blue:engine-card-900"), "stand-in own")]);
  const sentAt = (mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  ok("Sen Triplets: the target's card lies in its owner's hand", valueOf(r, "real 1") === "1 Blue hand", String(valueOf(r, "real 1")) + " " + r.errors.join(" | "));
  ok("Sen Triplets: and stays there on the next board", valueOf(r, "real 2") === "1 Blue hand", String(valueOf(r, "real 2")));
  ok("Sen Triplets: the caster's row has a stand-in for it", valueOf(r, "stand-in") === "1 White row", String(valueOf(r, "stand-in")));
  ok("Sen Triplets: the table check agrees", valueOf(r, "check") === "none", String(valueOf(r, "check")));
  ok("Sen Triplets: dragging the stand-in onto the caster's mat casts the real card", /"kind":"play"/.test(sentAt("drop")) && sentAt("drop").includes('"id":"engine-card-900"'), sentAt("drop").slice(0, 300));
  ok("Sen Triplets: a hand nobody else sees gives a stand-in in the caster's second hand zone", valueOf(r, "stand-in private") === "1 White hand2", String(valueOf(r, "stand-in private")) + " " + r.errors.join(" | "));
  ok("Sen Triplets: the real card still in its owner's hand", valueOf(r, "real private") === "1 Blue hand", String(valueOf(r, "real private")));
  ok("own hand card listed as playable: it stays in the hand, and the table check agrees", valueOf(r, "real own") === "1 Blue hand" && valueOf(r, "check own") === "none", `${valueOf(r, "real own")} / ${valueOf(r, "check own")}`);
  ok("own hand card listed as playable: no stand-in of it in its own seat's row (suite review 2026-11-10)", valueOf(r, "stand-in own") === "none", String(valueOf(r, "stand-in own")));
}
// a revealed hand (White is the AI here, as Sen Triplets' target was): face up at White's seat as objects of their own,
// the real hand left alone; gone when the reveal ends; the table check expects them
{
  const setup = 'local t = engineTable() local white for _, p in ipairs(t.players) do if p.color == "White" then white = p end end ' +
    'engineStoreStatic("engine-card-801", { n = "Swords to Plowshares", f = "https://img.example/stp.jpg", ty = { "Instant" } }) ' +
    'engineStoreStatic("engine-card-802", { n = "Plains", f = "https://img.example/plains.jpg", ty = { "Land" } }) ' +
    'white.revealed = { { s = 1, id = "engine-card-801" }, { s = 1, id = "engine-card-802" } } engineRender(t) __sim.frames(90) return "shown"';
  const objOf = (id) => `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end `;
  const look = objOf("reveal:engine-card-801") + 'if o == nil then return "none" end local p, m, f = o.getPosition(), data.White.playmat.getPosition(), data.White.playmat.getTransformForward() ' +
    'local face for _, d in pairs(o.getData().CustomDeck or {}) do face = d.FaceURL end ' +
    'return string.format("%.1f|%.2f|%s|%s|%s", (p - m):dot(f), o.getScale().x, tostring(o.getLock()), tostring(face), tostring(o.getDescription():find("Revealed: in", 1, true) ~= nil))';
  const real = objOf("engine-card-801") + 'return tostring(o ~= nil)';
  const check = 'local n = 0 for _, pr in ipairs(engineSelfCheck().problems or {}) do if tostring(pr):find("reveal:", 1, true) then n = n + 1 end end return tostring(n)';
  // (drawn twice: the second board finds the objects there and must keep them as they are)
  const r = run([q(setup, "shown"), q(look, "look first"), q('engineRender(engineTable()) __sim.frames(30) return "again"', "again"), q(look, "look"), q(real, "real"), q(objOf("reveal:engine-card-802") + 'return tostring(o ~= nil)', "second"), q(check, "check"),
    q('local t = engineTable() for _, p in ipairs(t.players) do if p.color == "White" then p.revealed = nil end end engineRender(t) __sim.frames(90) return "hidden"', "hidden"),
    q(objOf("reveal:engine-card-801") + 'return tostring(o ~= nil)', "after")]);
  const [fwd, scale, lock, face, said] = String(valueOf(r, "look")).split("|");
  ok("revealed strip: the card is shown face up with its picture", face === "https://img.example/stp.jpg", String(valueOf(r, "look")) + " " + r.errors.join(" | "));
  // (rows lie along the mat's forward axis: row 0 at -8, the strip's row 1 at -4.8, the other permanents' row 2 at -1.6)
  ok("revealed strip: in the row between the creatures and the other permanents", Math.abs(Number(fwd) + 4.8) < 0.3, fwd);
  ok("revealed strip: half size and locked", Number(scale) === 0.5 && lock === "true", `${scale} ${lock}`);
  ok("revealed strip: half size from the first board on", String(valueOf(r, "look first")).split("|")[1] === "0.50", String(valueOf(r, "look first")));
  ok("revealed strip: its hover text says it is revealed from the hand", said === "true", said);
  ok("revealed strip: every revealed card", valueOf(r, "second") === "true", String(valueOf(r, "second")));
  ok("revealed strip: the real hand card isn't put on the table", valueOf(r, "real") === "false", String(valueOf(r, "real")));
  ok("revealed strip: the table check expects it", valueOf(r, "check") === "0", String(valueOf(r, "check")));
  ok("revealed strip: gone when the reveal ends", valueOf(r, "after") === "false", String(valueOf(r, "after")));
  // a long revealed hand (22 cards) is squeezed to the battlefield rows' width: 9 column steps of 2.4
  const long = 'local t = engineTable() local white for _, p in ipairs(t.players) do if p.color == "White" then white = p end end white.revealed = {} ' +
    'for k = 1, 22 do local id = "engine-card-" .. (850 + k) engineStoreStatic(id, { n = "Card " .. k, f = "https://img.example/c" .. k .. ".jpg", ty = { "Instant" } }) white.revealed[k] = { s = 1, id = id } end ' +
    'engineRender(t) __sim.frames(90) local m, rt = data.White.playmat.getPosition(), data.White.playmat.getTransformRight() local lo, hi, n = 1e9, -1e9, 0 ' +
    'for _, x in ipairs(getObjects()) do if tostring(x.getGMNotes()):find("^engine:reveal:engine%-card%-8") then local a = (x.getPosition() - m):dot(rt) n = n + 1 lo = math.min(lo, a) hi = math.max(hi, a) end end ' +
    'return string.format("%d|%.2f", n, hi - lo)';
  const r3 = run([q(long, "long")]);
  const [n22, spread] = String(valueOf(r3, "long")).split("|");
  ok("revealed strip: a 22-card hand, every card", n22 === "22", String(valueOf(r3, "long")) + " " + r3.errors.join(" | "));
  ok("revealed strip: squeezed to the rows' width", Number(spread) <= 9 * 2.4 + 0.05 && Number(spread) > 20, spread);
}
// a reveal of more cards than the row holds pages through them (7 left out Animist's Awakening's 8th, 2026-10-30)
{
  const show = Array.from({ length: 9 }, (_, i) => ({ n: `Card ${i + 1}`, img: `https://img.example/c${i + 1}.jpg` }));
  const slots = 'local s = "" for k = 1, ROW_MAX do s = s .. (UI.getAttribute("eng_rowslot_Blue_" .. k, "active") == "true" and "1" or "0") end return s';
  const r = run([ask({ promptId: 995, kind: "reveal", title: "Revealed (your library)", mode: "single", options: [{ id: "ok", label: "OK" }], show }), { frames: 10 },
    q(slots, "page 1"), q('return tostring(UI.getAttribute("eng_rowopt_Blue_3", "text")) .. "|" .. tostring(UI.getAttribute("eng_rowopt_Blue_2", "interactable"))', "buttons"),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_3") ' + slots, "page 2"), q('return tostring(UI.getValue("eng_rowsub_Blue"))', "sub"),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_2") ' + slots, "back"),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_2") ' + slots, "back on page 1"),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_3") return tostring(UI.getAttribute("eng_rowopt_Blue_3", "interactable"))', "more on last"),
    // (the same question sent again, as a new message: it keeps its page)
    ask({ promptId: 995, kind: "reveal", title: "Revealed (your library)", mode: "single", options: [{ id: "ok", label: "OK" }], show }), { frames: 10 }, q(slots, "resent"),
    q('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_3") onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_3") ' + slots, "twice")]);
  ok("reveal pages: the first 7 pictures", valueOf(r, "page 1") === "1111111", String(valueOf(r, "page 1")) + " " + r.errors.join(" | "));
  ok("reveal pages: More, with Back not pressable on the first page", valueOf(r, "buttons") === "More >|false", String(valueOf(r, "buttons")));
  ok("reveal pages: More shows the last 2", valueOf(r, "page 2") === "1100000", String(valueOf(r, "page 2")));
  ok("reveal pages: the line says which cards", /Cards 8-9 of 9/.test(String(valueOf(r, "sub"))), String(valueOf(r, "sub")));
  ok("reveal pages: Back shows the first 7 again", valueOf(r, "back") === "1111111", String(valueOf(r, "back")));
  ok("reveal pages: More pressed twice stops at the last page", valueOf(r, "twice") === "1100000", String(valueOf(r, "twice")));
  ok("reveal pages: Back pressed on the first page stays there", valueOf(r, "back on page 1") === "1111111", String(valueOf(r, "back on page 1")));
  ok("reveal pages: More not pressable on the last page", valueOf(r, "more on last") === "false", String(valueOf(r, "more on last")));
  ok("reveal pages: the same question sent again keeps its page", valueOf(r, "resent") === "1100000", String(valueOf(r, "resent")));
}
// Kykar re-test new bug 1: a player another seat controls (Mindslaver): its hand, the bridge's ctlHand, lies in the
// controller's second hand zone, and a card dragged from there onto the battlefield is played by the controller
{
  const setup = 'local t = engineTable() local pl for _, p in ipairs(t.players) do if p.color ~= "Blue" then pl = p end end ' +
    'engineStoreStatic("engine-card-778", { n = "Forest", f = "https://img.example/forest.jpg", ty = { "Land" } }) ' +
    'pl.ctlHand = { { s = 1, id = "engine-card-778" } } pl.ctlBy = "Blue" pl.keep = {} ' +
    'engineRender(t) __sim.frames(90) return "laid"';
  const objOf = 'local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:engine-card-778" then o = x end end ';
  const where = objOf + 'if o == nil then return "none" end local inH = false for _, h in ipairs(Player.Blue.getHandObjects(2)) do if h == o then inH = true end end ' +
    'return inH and "hand2" or "elsewhere"';
  const sent = (mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  // (merge 2026-11-09: the bridge slims ctlHand as every zone list, so the table fills its details in as for the others;
  // and the table check expects the cards)
  const check = 'local out = {} for _, pr in ipairs(engineSelfCheck().problems or {}) do if tostring(pr):find("778", 1, true) or tostring(pr):find("Forest", 1, true) then out[#out + 1] = tostring(pr) end end return #out == 0 and "none" or table.concat(out, " || ")';
  const r = run([q(setup, "laid"), q(where, "where"), q(objOf + 'return tostring(o and o.getName():match("^[^\\n]*"))', "name"), q(check, "check"),
    q(objOf + 'local m = data.Blue.playmat.getPosition() o.setPosition(Vector(m.x, 1.5, m.z)) onObjectDrop("Blue", o) __sim.frames(90) return "dragged in"', "dragged in"),
    q('local t = engineTable() for _, p in ipairs(t.players) do if p.color ~= "Blue" then p.ctlHand = nil p.ctlBy = nil end end engineRender(t) __sim.frames(90) ' +
      objOf + 'return tostring(o ~= nil and not o.isDestroyed())', "control over")]);
  ok("re-test bug 1: the controlled hand lies in the controller's second hand zone", valueOf(r, "where") === "hand2", String(valueOf(r, "where")) + " " + r.errors.join(" | "));
  ok("merge: a controlled hand card sent slim (s = 1) shows its name", valueOf(r, "name") === "Forest", String(valueOf(r, "name")));
  ok("merge: the table check expects a controlled hand's cards", valueOf(r, "check") === "none", String(valueOf(r, "check")));
  ok("re-test bug 1: dragged onto the battlefield, the controller plays it", /"kind":"play"/.test(sent("dragged in")) && /"color":"Blue"/.test(sent("dragged in")), sent("dragged in").slice(0, 200));
  ok("re-test bug 1: control over, the hand is gone from the table", valueOf(r, "control over") === "false", String(valueOf(r, "control over")));
}
// (merge 2026-11-09) Mindslaver on a seated human: White controls Blue. Blue's hand card stays in Blue's hand on every
// board (Sen Triplets' rule, enginePlayableRows); White's second hand zone gets a stand-in, cast:White:<id>, that plays
// the real card when dragged; one stand-in also when White's playable list has the card too; the table check agrees.
{
  const { simulate } = require("./lua/run-sim");
  const both = (steps) => simulate({ save, seated: ["Blue", "White"], steps: [...prefix, ...steps] });
  const setup = (alsoPlayable) => 'local t = engineTable() local blue, white for _, p in ipairs(t.players) do if p.color == "Blue" then blue = p elseif p.color == "White" then white = p end end ' +
    'engineStoreStatic("engine-card-905", { n = "Mind Rot", f = "https://img.example/mindrot.jpg", ty = { "Sorcery" } }) ' +
    'blue.hand = blue.hand or {} table.insert(blue.hand, { s = 1, id = "engine-card-905", ctl = "Blue" }) blue.handCount = #blue.hand ' +
    'blue.ctlHand = { { s = 1, id = "engine-card-905", ctl = "Blue" } } blue.ctlBy = "White" ' +
    (alsoPlayable ? 'white.playable = { { s = 1, id = "engine-card-905", ctl = "Blue" } } ' : 'white.playable = nil ') +
    'SLV = t engineRender(SLV) __sim.frames(90) return "drawn"';
  const count = (id) => `local n = 0 for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then n = n + 1 end end return tostring(n)`;
  const where = (id) => `local n, o = 0, nil for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then n = n + 1 o = x end end ` +
    'if o == nil then return "none" end local p = o.getPosition() local function d(v) return math.sqrt((p.x - v.x) ^ 2 + (p.z - v.z) ^ 2) end ' +
    'local mat = d(data.Blue.playmat.getPosition()) < d(data.White.playmat.getPosition()) and "Blue" or "White" ' +
    'local h1, h2 = Player[mat].getHandTransform(1), Player[mat].getHandTransform(2) ' +
    'return n .. " " .. mat .. " " .. ((h1 ~= nil and d(h1.position) < 3) and "hand" or (h2 ~= nil and d(h2.position) < 0.5) and "hand2" or "row")';
  const check = 'local out = {} for _, pr in ipairs(engineSelfCheck().problems or {}) do if tostring(pr):find("Mind Rot", 1, true) or tostring(pr):find("905", 1, true) then out[#out + 1] = tostring(pr) end end return #out == 0 and "none" or table.concat(out, " || ")';
  const drop = 'local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:cast:White:engine-card-905" then o = x end end if o == nil then return "no stand-in" end ' +
    'local m = data.White.playmat.getPosition() o.setPosition(Vector(m.x, 1.5, m.z)) onObjectDrop("White", o) __sim.frames(5) return "dropped"';
  const r = both([q(setup(false), "drawn"), q(where("engine-card-905"), "real 1"),
    q('engineRender(SLV) __sim.frames(90) return "again"', "again"), q(where("engine-card-905"), "real 2"), q(where("cast:White:engine-card-905"), "stand-in"),
    q(check, "check"), q(drop, "drop"),
    q(setup(true), "both"), q(count("cast:White:engine-card-905"), "stand-ins both"), q(where("engine-card-905"), "real both"), q(check, "check both")]);
  const sentAt = (mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  ok("merge: a seated controlled player's hand card stays in their hand", valueOf(r, "real 1") === "1 Blue hand", String(valueOf(r, "real 1")) + " " + r.errors.join(" | "));
  ok("merge: and on the next board", valueOf(r, "real 2") === "1 Blue hand", String(valueOf(r, "real 2")));
  ok("merge: the controller gets a stand-in in their second hand zone", valueOf(r, "stand-in") === "1 White hand2", String(valueOf(r, "stand-in")));
  ok("merge: the table check agrees", valueOf(r, "check") === "none", String(valueOf(r, "check")));
  ok("merge: dragging the stand-in plays the real card", /"kind":"play"/.test(sentAt("drop")) && sentAt("drop").includes('"id":"engine-card-905"') && /"color":"White"/.test(sentAt("drop")), sentAt("drop").slice(0, 300));
  ok("merge: one stand-in when the controller's playable list has the card too", valueOf(r, "stand-ins both") === "1" && valueOf(r, "real both") === "1 Blue hand", `${valueOf(r, "stand-ins both")} / ${valueOf(r, "real both")}`);
  ok("merge: and the table check agrees then too", valueOf(r, "check both") === "none", String(valueOf(r, "check both")));
}
// Kykar re-test new bug 8: a finished game closes the open question, and the corner shows no Next or End turn
{
  const corner = (mark) => q('return tostring(UI.getAttribute("eng_big_Blue", "active")) .. "|" .. tostring(UI.getAttribute("eng_big2_Blue", "active"))', mark);
  const r = run([ask({ promptId: 491, kind: "priority", title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }, { id: "__endturn", label: "End turn" }] }), { frames: 4 },
    corner("asked"), q('local t = engineTable() t.gameOver = true t.overWhy = "White conceded" engineRender(t) __sim.frames(30) return tostring(enginePrompts.Blue == nil)', "over"), { frames: 30 }, corner("after")]);
  ok("precondition: priority shows Next and End turn", valueOf(r, "asked") === "true|true", String(valueOf(r, "asked")) + " " + r.errors.join(" | "));
  ok("re-test bug 8: the game over closes the question", valueOf(r, "over") === "true", String(valueOf(r, "over")) + " " + r.errors.join(" | "));
  ok("re-test bug 8: and the corner's buttons go", valueOf(r, "after") === "false|false", String(valueOf(r, "after")));
  // (and a question still handed to the corner after the end shows no buttons either)
  const r2 = run([q('local t = engineTable() t.gameOver = true engineUpdateCorner("Blue", { promptId = 492, kind = "priority", title = "Your priority", mode = "single", options = { { id = "__pass", label = "Next" }, { id = "__endturn", label = "End turn" } } }) ' +
    'return tostring(UI.getAttribute("eng_big_Blue", "active")) .. "|" .. tostring(UI.getAttribute("eng_big2_Blue", "active"))', "late")]);
  ok("re-test bug 8: a question shown after the game over gets no buttons", valueOf(r2, "late") === "false|false", String(valueOf(r2, "late")) + " " + r2.errors.join(" | "));
}
// (suite review 2026-11-10) A stand-in's priority frame and hover text, for Sen Triplets (White may cast Blue's hand card)
// and for Mindslaver over a seated human (White controls Blue): the caster's "Cast" frames the caster's stand-in, never
// the real card in the other player's hand; the hand's owner's own "Cast" frames the real card. Each stand-in says
// whose hand the card is in.
{
  const { simulate } = require("./lua/run-sim");
  const both = (steps) => simulate({ save, seated: ["Blue", "White"], steps: [...prefix, ...steps] });
  const card = (id, name) => `engineStoreStatic("${id}", { n = "${name}", f = "https://img.example/${id}.jpg", ty = { "Instant" } }) `;
  const players = 'local t = engineTable() local blue, white for _, p in ipairs(t.players) do if p.color == "Blue" then blue = p elseif p.color == "White" then white = p end end ';
  const inBlueHand = (id) => `blue.hand = blue.hand or {} table.insert(blue.hand, { s = 1, id = "${id}", ctl = "Blue" }) blue.handCount = #blue.hand `;
  // Sen Triplets: Blue's hand card in White's playable list, shown to everyone (the stand-in lies face up on White's mat)
  const sen = players + card("engine-card-910", "Lightning Bolt") + inBlueHand("engine-card-910") +
    'white.playable = { { s = 1, id = "engine-card-910", ctl = "Blue" } } blue.revealed = { { s = 1, id = "engine-card-910", ctl = "Blue" } } engineRender(t) __sim.frames(90) return "drawn"';
  // Mindslaver: White controls seated Blue, whose hand the bridge sends again as ctlHand
  const slv = players + card("engine-card-911", "Shock") + inBlueHand("engine-card-911") +
    'blue.ctlHand = { { s = 1, id = "engine-card-911", ctl = "Blue" } } blue.ctlBy = "White" white.playable = nil SLV3 = t engineRender(t) __sim.frames(90) return "drawn"';
  // (TTS lays a hand out itself: the stand-in shifted a little inside White's second hand zone, as TTS does, and the next
  // board must leave it there, a hand card, not pull it back to its planned spot)
  const relaid = 'local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:cast:White:engine-card-911" then o = x end end if o == nil then return "none" end ' +
    'local p = o.getPosition() o.setPosition(Vector(p.x + 0.3, p.y, p.z)) __sim.frames(2) local inH = false for _, h in ipairs(Player.White.getHandObjects(2)) do if h == o then inH = true end end ' +
    'if not inH then return "left the zone" end __fx = {} engineRender(SLV3) __sim.frames(30) local n = 0 for _, l in ipairs(__fx) do if l:find("obj:" .. o.getGUID() .. " ", 1, true) and l:find("setPosition", 1, true) then n = n + 1 end end return tostring(n)';
  const cast = (color, pid, id, name) => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color, promptId: pid, kind: "priority", title: "Your priority", mode: "single",
    options: [{ id: "__pass", label: "Next" }, { id: `prompt-action-${pid}`, cardId: id, label: `Cast ${name}` }] }) }, frames: 10 });
  // whether an object carries a frame for that colour, switched on: "true", "false", or "none" (no such object)
  const lit = (id, color, mark) => q(`local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end if o == nil then return "none" end ` +
    `local x = o.UI.getXml() or "" if not x:find('id="eng_play" visibility="${color}"', 1, true) then return "false" end ` +
    'local a = o.UI.getAttribute("eng_play", "active") if a ~= nil then return a end return x:find(\'active="true"\', 1, true) and "true" or "false"', mark);
  const hover = (id, mark) => q(`local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end return o and o.getDescription() or "none"`, mark);
  const r = both([q(sen, "sen"), hover("cast:White:engine-card-910", "sen hover"), cast("White", 1301, "engine-card-910", "Lightning Bolt"),
    lit("cast:White:engine-card-910", "White", "sen stand-in lit"), lit("engine-card-910", "White", "sen real lit for White")]);
  const r2 = both([q(sen, "sen"), cast("Blue", 1302, "engine-card-910", "Lightning Bolt"), lit("engine-card-910", "Blue", "own real lit"), lit("cast:White:engine-card-910", "Blue", "own stand-in lit")]);
  const inHand2 = (id, color, mark) => q(`local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end if o == nil then return "none" end ` +
    `for _, h in ipairs(Player.${color}.getHandObjects(2)) do if h == o then return "true" end end return "false"`, mark);
  const r3 = both([q(slv, "slv"), hover("cast:White:engine-card-911", "slv hover"), inHand2("cast:White:engine-card-911", "White", "slv in hand2"), q(relaid, "slv relaid"), cast("White", 1303, "engine-card-911", "Shock"),
    lit("cast:White:engine-card-911", "White", "slv stand-in lit"), lit("engine-card-911", "White", "slv real lit for White")]);
  // Mindslaver and Sen Triplets at once, the hand shown to everyone: one stand-in, laid by the playable row alone (face up on
  // White's mat), which a board with nothing new leaves where it is (laid by both, it went to the second hand zone and
  // back to the mat on every board)
  const slvShown = players + card("engine-card-913", "Opt") + inBlueHand("engine-card-913") +
    'blue.ctlHand = { { s = 1, id = "engine-card-913", ctl = "Blue" } } blue.ctlBy = "White" white.playable = { { s = 1, id = "engine-card-913", ctl = "Blue" } } ' +
    'blue.revealed = { { s = 1, id = "engine-card-913", ctl = "Blue" } } SLV2 = t engineRender(SLV2) __sim.frames(90) ' +
    'for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:cast:White:engine-card-913" then return x.getGUID() end end return "none"';
  const r4 = both([q(slvShown, "guid"), { frames: 30 }, q('engineRender(SLV2) __sim.frames(30) return "again"', "again")]);
  const guid = String(valueOf(r4, "guid"));
  const churn = fxOf(r4, "again").filter((l) => l.includes(`obj:${guid} `) && /setPosition|setDescription|setRotation/.test(l));
  ok("one stand-in, one place: precondition, it is on the table", guid !== "none" && guid !== "undefined", guid + " " + r4.errors.join(" | "));
  ok("one stand-in, one place: a board with nothing new doesn't move it", churn.length === 0, churn.slice(0, 3).join(" || "));
  const v = (res, mark) => String(valueOf(res, mark));
  ok("stand-in frame: precondition, the Sen Triplets stand-in is on the table", v(r, "sen hover") !== "none", v(r, "sen hover") + " " + r.errors.join(" | "));
  ok("stand-in frame: the caster's Cast frames its stand-in (Sen Triplets)", v(r, "sen stand-in lit") === "true", v(r, "sen stand-in lit") + " " + r.errors.join(" | "));
  ok("stand-in frame: and not the real card in the other player's hand (Sen Triplets)", v(r, "sen real lit for White") === "false", v(r, "sen real lit for White"));
  ok("stand-in frame: the hand's owner's own Cast frames the real card", v(r2, "own real lit") === "true", v(r2, "own real lit") + " " + r2.errors.join(" | "));
  ok("stand-in frame: and no stand-in for the owner", v(r2, "own stand-in lit") === "false", v(r2, "own stand-in lit"));
  ok("stand-in hover: Sen Triplets' stand-in says whose hand it is in", v(r, "sen hover").includes("Blue's hand: drag it onto the battlefield to cast it"), v(r, "sen hover")); // (by Blue's seated player's name: "PlayerBlue" here)
  ok("stand-in frame: precondition, the Mindslaver stand-in is on the table", v(r3, "slv hover") !== "none", v(r3, "slv hover") + " " + r3.errors.join(" | "));
  ok("stand-in frame: the controller's Cast frames its stand-in (Mindslaver, seated)", v(r3, "slv stand-in lit") === "true", v(r3, "slv stand-in lit") + " " + r3.errors.join(" | "));
  ok("stand-in frame: and not the controlled player's real card (Mindslaver, seated)", v(r3, "slv real lit for White") === "false", v(r3, "slv real lit for White"));
  ok("stand-in place: the Mindslaver stand-in is a card in the controller's second hand (only they see it), not one lying there", v(r3, "slv in hand2") === "true", v(r3, "slv in hand2"));
  ok("stand-in place: laid out by TTS inside that hand, the next board leaves it there (a hand card)", v(r3, "slv relaid") === "0", v(r3, "slv relaid") + " " + r3.errors.join(" | "));
  ok("stand-in hover: Mindslaver's stand-in says whose hand and that you control them", v(r3, "slv hover").includes("Blue's hand (you control them): drag it onto the battlefield to play it"), v(r3, "slv hover"));
}
// (suite review 2026-11-10) a controlled AI's hand card put down again inside the controller's second hand zone is only
// rearranged there: no request, and no redraw to snap it back (onObjectDrop reads that zone, not the first hand)
{
  const setup = 'local t = engineTable() local pl for _, p in ipairs(t.players) do if p.color ~= "Blue" then pl = p end end ' +
    'engineStoreStatic("engine-card-779", { n = "Island", f = "https://img.example/island.jpg", ty = { "Land" } }) ' +
    'pl.ctlHand = { { s = 1, id = "engine-card-779" } } pl.ctlBy = "Blue" engineRender(t) __sim.frames(90) return "laid"';
  const drop = 'local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:engine-card-779" then o = x end end if o == nil then return "none" end ' +
    'local inH = false for _, h in ipairs(Player.Blue.getHandObjects(2)) do if h == o then inH = true end end if not inH then return "not in hand2" end ' +
    'local n, real = 0, engineRender engineRender = function(m) n = n + 1 return real(m) end onObjectDrop("Blue", o) __sim.frames(5) engineRender = real return tostring(n)';
  const r = run([q(setup, "laid"), q(drop, "drop")]);
  const sentAt = fxOf(r, "drop").filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
  ok("controlled hand: precondition, the card is in Blue's second hand zone", /^\d+$/.test(String(valueOf(r, "drop"))), String(valueOf(r, "drop")) + " " + r.errors.join(" | "));
  ok("controlled hand: put down inside the second hand zone, it is only rearranged (no redraw)", valueOf(r, "drop") === "0", String(valueOf(r, "drop")));
  ok("controlled hand: and nothing is asked of the engine", !/"kind":/.test(sentAt), sentAt.slice(0, 200));
}
// (suite review 2026-11-10) a pick of several with 3 buttons and 9 pictures: Back and More don't fit beside its buttons
// and its Done, so it shows the first 7 pictures unpaged and keeps Done (counted without Done, More took Done's place)
{
  const show = Array.from({ length: 9 }, (_, i) => ({ n: `Card ${i + 1}`, img: `https://img.example/m${i + 1}.jpg` }));
  const btns = 'local s = {} for k = 1, ROW_BTNS do if UI.getAttribute("eng_rowopt_Blue_" .. k, "active") == "true" then s[#s + 1] = tostring(UI.getAttribute("eng_rowopt_Blue_" .. k, "text")) end end return table.concat(s, "|")';
  const r = run([ask({ promptId: 997, title: "Choose one or two", mode: "multi", min: 1, max: 2, options: [{ id: "a", label: "Alpha" }, { id: "b", label: "Beta" }, { id: "c", label: "Gamma" }], show }), { frames: 10 },
    q(btns, "buttons"), q('return tostring(UI.getAttribute("eng_row_Blue", "active"))', "row")]);
  ok("reveal pages: precondition, the row is up", valueOf(r, "row") === "true", String(valueOf(r, "row")) + " " + r.errors.join(" | "));
  ok("reveal pages: a pick of several keeps its Done when Back and More don't fit", /\|Done \(0\)$/.test(String(valueOf(r, "buttons"))) && !/More/.test(String(valueOf(r, "buttons"))), String(valueOf(r, "buttons")));
}
// (suite review 2026-11-10) a controlled hand counts as laid only when its controller is seated (engineSeatHands): with
// Red (the controller) away from the table nothing lays AI White's hand, so a card of it Blue may cast goes to Blue's row
// as the real card, not as a stand-in "in Red's hand"; and nothing is laid for Red
{
  const r = run([q('local m = { players = { { color = "White", ctlHand = { { id = "x" } }, ctlBy = "Red" }, { color = "Blue", playable = { { id = "x" } } } } } ' +
    'local rows, castOf, inHand = enginePlayableRows(m) return tostring(rows.x) .. " " .. tostring(castOf["cast:Blue:x"]) .. " " .. tostring(inHand.x) .. " " .. tostring(Player.Red.seated)', "away"),
    q('engineStoreStatic("engine-card-912", { n = "Opt", f = "https://img.example/opt.jpg", ty = { "Instant" } }) local t = engineTable() ' +
      'for _, p in ipairs(t.players) do if p.color == "White" then p.ctlHand = { { s = 1, id = "engine-card-912" } } p.ctlBy = "Red" end end engineRender(t) __sim.frames(90) ' +
      'local n = 0 for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:engine-card-912" or x.getGMNotes() == "engine:cast:Red:engine-card-912" then n = n + 1 end end return tostring(n)', "laid")]);
  ok("controller away: precondition, Red isn't seated", / false$/.test(String(valueOf(r, "away"))), String(valueOf(r, "away")) + " " + r.errors.join(" | "));
  ok("controller away: the card Blue may cast is Blue's row's own, no stand-in", /^Blue nil nil /.test(String(valueOf(r, "away"))), String(valueOf(r, "away")));
  ok("controller away: nothing of the controlled hand is laid", valueOf(r, "laid") === "0", String(valueOf(r, "laid")) + " " + r.errors.join(" | "));
}
// (suite review 2026-11-10) the bridge slims every list in its ZONE_KEYS, and the table's mergeStatic fills in exactly
// those lists (each says so of the other): a list on one side only arrives as bare ids, or is filled for nothing
{
  const bridgeSrc = fs.readFileSync(path.join(__dirname, "..", "bridge", "bridge.js"), "utf8");
  const luaSrc = save.LuaScript; // (the script under test, built from tools/engine-renderer.lua)
  const keys = (/const ZONE_KEYS = \[([^\]]*)\]/.exec(bridgeSrc) || [])[1];
  const merge = luaSrc.slice(luaSrc.indexOf("local function mergeStatic(m)"));
  const lists = (/for _, z in ipairs\(\{([^}]*)\}\) do/.exec(merge.slice(0, 2000)) || [])[1];
  const names = (s) => [...String(s || "").matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]).sort().join(",");
  ok("zone lists: precondition, both lists found", !!keys && !!lists, `${keys} / ${lists}`);
  ok("zone lists: the table's mergeStatic fills in exactly the bridge's ZONE_KEYS", names(keys) === names(lists), `bridge ${names(keys)} / table ${names(lists)}`);
}
console.log(failed ? `\n${failed} table checks failed (${passed} passed)` : `all ${passed} table checks pass`);
process.exit(failed ? 1 : 0);
