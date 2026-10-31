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
    q('local x = UI.getXml() local d = x:match("<Defaults>.-</Defaults>") or "" return (d:find(" on%u%a*=") and "event" or "clean") .. " " .. tostring(select(2, x:gsub("eng_opt_Yellow_%d+", "")))', "defaults")] });
  ok("UI size: four seats under 60 KB", Number(valueOf(r, "size")) > 20000 && Number(valueOf(r, "size")) < 60000, valueOf(r, "size"));
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
// day and night show on the phase bar once it is one (2026-10-26)
{
  const bar = (mark) => q('engineUpdateCorner("Blue", nil) return tostring(UI.getValue("eng_phase_Blue"))', mark);
  const r = run([bar("neither"), q('engineTable().day = "day"', "make day"), bar("day"), q('engineTable().day = "night"', "make night"), bar("night")]);
  const v = (m) => String(valueOf(r, m));
  ok("day/night: nothing before it is day or night", !/DAY|NIGHT/.test(v("neither")), v("neither") + " " + r.errors.join(" | "));
  ok("day/night: DAY on the phase bar", /DAY/.test(v("day")) && !/NIGHT/.test(v("day")), v("day"));
  ok("day/night: NIGHT on the phase bar", /NIGHT/.test(v("night")), v("night"));
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
// the Engine / Graveyards / Log / Auto / Settings buttons are a row at the bottom left: at the top right they covered the
// first items of the cards' right-click menus (2026-10-26, #35). (The fake TTS keeps no layout: read from the XML text.)
{
  const lua = String(save.LuaScript || "");
  for (const id of ["eng_toggle_", "eng_browse_", "eng_logbtn_", "eng_pace_", "eng_set_", "eng_setpanel_"]) {
    const tag = (lua.match(new RegExp(`<(?:Button|Panel) id="${id}' \\.\\. c \\.\\. '"[^>]*>`)) || [""])[0];
    ok(`bottom-left row: ${id} sits at the bottom`, /rectAlignment="LowerCenter"/.test(tag) && /offsetXY="-\d+ \d+"/.test(tag), tag.slice(0, 200) || "not found");
  }
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
  const withPoison = (n, energy = 0, flags = {}) => { const t = JSON.parse(lastT.json); for (const p of t.players) if (p.color === "White") { p.poison = n; p.energy = energy; Object.assign(p, flags); } return { msg: { t: "table", json: JSON.stringify(t) } }; };
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
  const poisoned = JSON.parse(lastT.json); for (const p of poisoned.players) if (p.color === "White") p.poison = 3;
  const r3 = run([...more, { frames: 30 }, ask({ promptId: 978, title: "Your priority", mode: "single", options: [{ id: "__pass", label: "Next" }, scry] }), { frames: 30 },
    { msg: { t: "table", json: JSON.stringify(poisoned) } }, { frames: 10 },
    q(objOf + 'onObjectHover("Blue", o) return tostring(UI.getAttribute("eng_abp_Blue", "active"))', "hover"),
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 90 },
    q('local n = 0 for _ in pairs(engineAbilityWant) do n = n + 1 end local l = {} for _, b in ipairs(getObjectFromGUID("23e485").getButtons() or {}) do l[#l + 1] = tostring(b.label) end return tostring(UI.getAttribute("eng_abp_Blue", "active")) .. "|" .. n .. "|" .. table.concat(l, ",")', "cleared")]);
  const [panel, wants, tracker] = String(valueOf(r3, "cleared")).split("|");
  ok("stage 3: precondition: the panel and the poison label were up", valueOf(r3, "hover") === "true", String(valueOf(r3, "hover")) + " " + r3.errors.join(" | "));
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
// keywords another card gave a permanent show as a green badge on it (hp-07 #31: Skrelv's toxic 1 and hexproof from red
// on Kenrith showed nowhere)
{
  const lastK = [...s1.slice(0, 40)].reverse().find((m) => m.t === "table" && (JSON.parse(m.json).players.find((x) => x.color === "Blue") || {}).battlefield);
  const tk = JSON.parse(lastK.json);
  const bl = tk.players.find((x) => x.color === "Blue");
  const id = bl.battlefield[0].id;
  bl.battlefield[0] = { ...bl.battlefield[0], kw: ["Toxic 1", "Hexproof from red"] };
  const lbl = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end local out = {} for _, b in ipairs((o and o.getButtons()) or {}) do out[#out + 1] = tostring(b.label) end return table.concat(out, "|")`;
  const r = run([{ msg: { t: "table", json: JSON.stringify(tk) } }, { frames: 30 }, q(lbl, "kw")]);
  ok("granted keywords: shown on the card", String(valueOf(r, "kw")).split("|").includes("Toxic 1\nHexproof from red"), JSON.stringify(valueOf(r, "kw")) + " " + r.errors.join(" | "));
}
// a card whose text was changed shows the changed text in a box over its text box, the whole text in its tooltip and
// its hover text; a long text is cut to 6 lines there (hp-25 2026-10-27: Mind Bend's islandwalk showed nowhere)
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
  ok("changed text: a long text is cut to 6 lines on the card", label.split("\n").length === 6 && /point at it/.test(label), JSON.stringify(label.split("\n").length) + " " + label.slice(-60));
  ok("changed text: the whole long text in the box's tooltip", /more29/.test(box(btnsB).split("@@")[1] || ""), (box(btnsB).split("@@")[1] || "").slice(-60));
  ok("changed text: the printed name in the hover text", /Volrath's Shapeshifter/.test(descB), String(descB).slice(0, 120));
  // (a granted-keyword badge sits above the box, not over its first lines, suite review 2026-10-27)
  const tk3 = JSON.parse(JSON.stringify(tk));
  tk3.players.find((x) => x.color === "Blue").battlefield[0] = { ...base, ct: "Islandwalk", kw: ["Hexproof from red"] };
  const kwz = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${a}" then o = x end end for _, b in ipairs((o and o.getButtons()) or {}) do if b.label == "Hexproof from red" then return tostring(b.position.z or b.position[3]) end end return "none"`;
  const r3 = run([{ msg: { t: "table", json: JSON.stringify(tk3) } }, { frames: 30 }, q(kwz, "kwz")]);
  ok("changed text: a granted-keyword badge sits above the box", Number(valueOf(r3, "kwz")) < 0.45, String(valueOf(r3, "kwz")) + " " + r3.errors.join(" | "));
  // (both sides of the cut: 7 lines are cut to 6; and each wrapped line fits the box, 28 characters at most)
  const seven = Array.from({ length: 7 }, (_, k) => `line${k} abcde fghij klmno`).join("\n");
  const wide = Array.from({ length: 12 }, () => "wordy").join(" ");
  const boxOf = (ct) => { const t = JSON.parse(JSON.stringify(tk)); t.players.find((x) => x.color === "Blue").battlefield[0] = { ...base, ct }; return JSON.stringify(t); };
  const lbl = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${a}" then o = x end end for _, b in ipairs((o and o.getButtons()) or {}) do if tostring(b.tooltip):find("Text changed:", 1, true) then return tostring(b.label) end end return "none"`;
  const r4 = run([{ msg: { t: "table", json: boxOf(seven) } }, { frames: 30 }, q(lbl, "seven"), { msg: { t: "table", json: boxOf(wide) } }, { frames: 30 }, q(lbl, "wide")]);
  const sevenL = String(valueOf(r4, "seven")).split("\n");
  ok("changed text: 7 lines are cut to 6 too", sevenL.length === 6 && /point at it/.test(sevenL[5]), JSON.stringify(sevenL.length) + " " + r4.errors.join(" | "));
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
console.log(failed ? `\n${failed} table checks failed (${passed} passed)` : `all ${passed} table checks pass`);
process.exit(failed ? 1 : 0);
