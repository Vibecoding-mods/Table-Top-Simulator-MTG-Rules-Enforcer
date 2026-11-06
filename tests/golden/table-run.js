// Golden-master scenarios for the table's Global script (engine-renderer.lua + the patched table scripts), run on
// fengari with the fake TTS (tests/lua/tts-sim.lua). Input: two games the bridge really sent (fixtures/table-stream-*),
// plus a player's clicks at the questions in the 1v1. Output: everything the script did to the world, per step.
// The script comes from a save built from the current sources (buildSave) or from a given save file.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { simulate } = require("../lua/run-sim");

const ROOT = path.join(__dirname, "..", "..");
const BUILD = path.join(ROOT, "tmp", "table-build");

// engine-mode copy of the workshop table, plus the exported decks in fixtures/table-export (same as the real save, built
// into tmp/). The table isn't in this repo: subscribe to it on the Workshop, or point MTG_TABLE_JSON at your copy.
function buildSave() {
  fs.mkdirSync(BUILD, { recursive: true });
  const src = process.env.MTG_TABLE_JSON || path.join(process.env.USERPROFILE || process.env.HOME || "", "Documents", "My Games", "Tabletop Simulator", "Mods", "Workshop", "2296042369.json");
  execFileSync(process.execPath, [path.join(ROOT, "tools", "make-engine-copy.js"), src, path.join(BUILD, "engine.json")], { stdio: "pipe" });
  execFileSync(process.execPath, [path.join(ROOT, "tools", "add-exported-objects.js"), path.join(BUILD, "engine.json"), path.join(__dirname, "fixtures", "table-export"), path.join(BUILD, "table.json")], { stdio: "pipe" });
  return JSON.parse(fs.readFileSync(path.join(BUILD, "table.json"), "utf8"));
}

const stream = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `table-stream-${name}.json`), "utf8"));
const click = (lua) => ({ lua, mark: `click: ${lua}` });

function scenarios() {
  const s4 = stream("4p");
  // (Auto off: these recordings are what tests the held draws, mills and untaps; Auto is on by default since 2026-10-22)
  const four = [click("engineAutoPace.Blue = false"), click('engineChat("mtg start ai 3 builtin", Player.Blue)'), ...s4.map((m) => ({ msg: { t: m.t, json: m.json } })),
    // the original table's own tools, blocked while the engine runs the game
    click("revealStack()"), click("deckRampG()"),
    // the game ends ("mtg reset"): the bridge's clear, then a second to let the merges and the one throw-away land
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 90, mark: "clear (mtg reset)" }];
  const s1 = stream("1v1");
  const one = [click("engineAutoPace.Blue = false"), click('engineChat("mtg start ai 1", Player.Blue)')];
  let hidden = false, clicks = 0;
  for (const m of s1) {
    one.push({ msg: { t: m.t, json: m.json } });
    if (m.t !== "prompt") continue;
    const p = JSON.parse(m.json);
    if (p.promptId == null || p.color !== "Blue") continue;
    const title = String(p.title || "");
    // a player's answers, at the kinds of question the table draws differently
    if (!hidden && title === "Your priority") { hidden = true; one.push(click('onMtgToggle(Player.Blue, nil, "eng_toggle_Blue")')); }
    if (/^Scry: select/.test(title) && clicks < 6) { clicks++; one.push(click('onMtgRow(Player.Blue, nil, "eng_rowbtn_Blue_1")'), click('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_1")')); }
    else if (/pick #\d/.test(title) && clicks < 12) { clicks++; one.push(click('onMtgRow(Player.Blue, nil, "eng_rowbtn_Blue_1")')); }
    else if (/^Look at these/.test(title)) one.push(click('onMtgRowOpt(Player.Blue, nil, "eng_rowopt_Blue_1")'));
    else if (/^Declare attackers/.test(title)) one.push(click('engineCornerPress("Blue", "small")'));
    else if (/^Apply replacement/.test(title)) one.push(click('engineCornerPress("Blue", "big")'));
    else if (/^Pay /.test(title) && clicks < 14) { clicks++; one.push(click('engineCornerPress("Blue", "big")')); }
  }
  one.push(click('return tostring(engineToggleGlow("Blue"))'), click('return tostring(engineToggleGlow("Blue"))'));
  // crafted questions the recorded games never asked (added after the first grading: each closes an edit that escaped)
  const blueBf = [];
  for (const m of s1) if (m.t === "table") { const pl = JSON.parse(m.json).players.find((x) => x.color === "Blue"); if (pl && pl.battlefield) blueBf.splice(0, blueBf.length, ...pl.battlefield.map((c) => c.id)); }
  const ask = (p) => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", ...p }) } });
  one.push(
    ask({ promptId: 991, title: "Put these in order: pick #1", mode: "single", min: 1, max: 1,
      options: [{ id: "__keep", label: "Keep this order: Island, Forest, Swamp" }, { id: "a", label: "Island" }, { id: "b", label: "Forest" }] }),
    ask({ promptId: 992, title: "Choose (1)", mode: "multi", min: 1, max: 1, options: [{ id: blueBf[0], label: "one card" }] }),
    ask({ promptId: 993, title: "Choose (1)", mode: "multi", min: 1, max: 1, options: [{ id: blueBf[0], label: "first" }, { id: blueBf[1], label: "second" }] }),
    click('enginePick("Blue", 1) enginePick("Blue", 2)'),
    ask({ promptId: null }),
    // cards that go to the library: the hint says so, and clicking the library confirms
    ask({ promptId: 994, title: "Put 1 card(s) on the bottom", mode: "multi", min: 1, max: 1, options: [{ id: blueBf[0], label: "a card" }] }),
    click('enginePick("Blue", 1)'),
    click('local lib for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:library:Blue" then lib = x end end if lib then onPlayerAction(Player.Blue, Player.Action.Select, { lib }) end'),
  );
  // 2026-10-22 playtest ("Engine keeps popping up"): the panel is hidden unless the player pins it (Engine: show) or a
  // question the table can't answer is open; such a question opens it and the next one the table answers closes it.
  // The stack pop-up's X closes it for that player only, until the next card pops up.
  const panel = click('return tostring(UI.getAttribute("eng_panel_Blue", "active")) .. " " .. tostring(UI.getAttribute("eng_toggle_Blue", "text"))');
  const prio = (id) => ask({ promptId: id, kind: "priority", title: "Your priority", mode: "single", min: 1, max: 1, options: [{ id: "__pass", label: "Pass priority" }] });
  one.push(click('onMtgToggle(Player.Blue, nil, "eng_toggle_Blue")'), panel, // pinned by the click above: unpinned
    ask({ promptId: 1201, title: "Choose modes", mode: "multi", min: 1, max: 2, options: [{ id: "m1", label: "Mode A" }, { id: "m2", label: "Mode B" }, { id: "m3", label: "Mode C" }] }),
    panel, prio(1202), panel, // opened for the modes, closed for priority
    ask({ promptId: 1203, title: "Choose modes", mode: "multi", min: 1, max: 2, options: [{ id: "m1", label: "Mode A" }, { id: "m2", label: "Mode B" }, { id: "m3", label: "Mode C" }] }),
    ask({ promptId: null }), panel, // closed when the question goes away
    click('onMtgToggle(Player.Blue, nil, "eng_toggle_Blue")'), prio(1204), panel, // pinned: stays for priority
    click('onMtgToggle(Player.Blue, nil, "eng_toggle_Blue")'), panel,
    click('onMtgBrowse(Player.Blue, nil, "eng_browse_Blue")'), panel, click('onMtgBrowse(Player.Blue, nil, "eng_browse_Blue")'), panel,
    // (2026-10-22 review) the damage split shows in the card row: no panel; a 30-way list with the card's picture
    // doesn't fit the row: panel; a library search is picked from the panel's list: panel
    click('return engineCut("abc", 5) .. "|" .. engineCut("ab\u{2014}cd", 4) .. "|" .. engineCut("ab\u{2014}cd", 5) .. "|" .. engineCut("ab\u{2014}cd", 6)'), // whole characters only
    ask({ promptId: 1205, kind: "damage", title: "Kenrith: assign 5 combat damage", mode: "single", min: 1, max: 1, options: [{ id: "auto", label: "Auto-assign" }, { id: "hand", label: "Assign it myself" }] }), panel,
    ask({ promptId: 1206, kind: "modal", title: "Choose a creature type", mode: "multi", min: 1, max: 1, show: [{ n: "Pestilence", img: "x" }],
      options: Array.from({ length: 30 }, (_, i) => ({ id: String(i), label: `Type ${i}` })) }), panel,
    ask({ promptId: 1208, kind: "choice", title: "Pick a card", mode: "single", min: 1, max: 1,
      options: Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, label: `Card ${i}`, img: "x" })) }), panel, // 9 pictures: more than the row's 7
    ask({ promptId: 1207, kind: "cards", title: "Demonic Tutor: choose a card", mode: "multi", min: 0, max: 1, librarySearch: [],
      options: [{ id: blueBf[0], label: "Island" }, { id: blueBf[1], label: "Forest" }] }), panel,
    ask({ promptId: null }),
    click('enginePopOpen() onMtgPopClose(Player.Blue) onMtgPopClose(Player.Red) return tostring(UI.getAttribute("eng_pop", "visibility"))'),
    click('enginePopOpen() return tostring(UI.getAttribute("eng_pop", "visibility")) .. " " .. tostring(UI.getAttribute("eng_pop", "active"))'),
    click('for _, c in ipairs({ "White", "Brown", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink", "Grey", "Black" }) do onMtgPopClose({ color = c }) end return tostring(UI.getAttribute("eng_pop", "active"))'),
    ask({ promptId: null }));
  // a face-down card on Blue's battlefield (morph/manifest): the last board again with its first card face down
  const lastTable = JSON.parse([...s1].reverse().find((m) => m.t === "table").json);
  const blue = lastTable.players.find((x) => x.color === "Blue");
  let bf = null;
  for (const m of s1) if (m.t === "table") { const pl = JSON.parse(m.json).players.find((x) => x.color === "Blue"); if (pl && pl.battlefield) bf = pl.battlefield; }
  blue.battlefield = bf.map((c, i) => (i === 0 ? { ...c, fd: true } : c));
  blue.keep = (blue.keep || []).filter((z) => z !== "battlefield");
  one.push({ msg: { t: "table", json: JSON.stringify(lastTable) }, mark: "face-down card" });
  // M5 step 2: badges (raised P/T + a +1/+1 counter, a damaged creature, loyalty + stun, four identical tokens) and
  // life changes on the counters (two hits within 3 s add up; a gain later stands alone)
  {
    const badges = JSON.parse(JSON.stringify(lastTable));
    const bb = badges.players.find((x) => x.color === "Blue");
    bb.battlefield = bf.map((c, i) => (i === 1 ? { ...c, p: 3, t: 3, bp: 2, bt: 2, ctr: { P1P1: 1 } }
      : i === 2 ? { ...c, p: 2, t: 2, bp: 2, bt: 2, dmg: 1 }
      : i === 3 ? { ...c, ctr: { LOYALTY: 4, STUN: 1 } } : c));
    const soldier = (n) => ({ id: `engine-card-${n}`, n: "Soldier", tok: true, ctl: "Blue", p: 1, t: 1, bp: 1, bt: 1 });
    bb.battlefield.push(soldier(901), soldier(902), soldier(903), soldier(904));
    bb.keep = (bb.keep || []).filter((z) => z !== "battlefield");
    const life = (n) => { const t = JSON.parse(JSON.stringify(badges)); t.players.find((x) => x.color === "Blue").life = n; return t; };
    const soldiers = (k) => { const t = life(31); for (let n = 905; n < 901 + k; n++) t.players.find((x) => x.color === "Blue").battlefield.push(soldier(n)); return t; };
    one.push(click('getObjectFromGUID("395037").setVar("engineLifeChange", true) return "patched"'),
      { msg: { t: "table", json: JSON.stringify(life(34)) }, mark: "badges" },
      { msg: { t: "table", json: JSON.stringify(life(31)) }, mark: "life -3" },
      { msg: { t: "table", json: JSON.stringify(life(29)) }, mark: "life -2 more within 3 s: -5" },
      { msg: { t: "table", json: JSON.stringify(life(29)) }, frames: 240, mark: "4 s later" },
      { msg: { t: "table", json: JSON.stringify(life(31)) }, mark: "life +2 on its own" },
      { msg: { t: "table", json: JSON.stringify(life(31)) }, mark: "badges unchanged: no redraw" },
      // (four Soldiers lie side by side; 2026-10-25: tokens stack from five) a fifth makes the stack, a sixth joins it:
      // its count shows in gold, then black again
      { msg: { t: "table", json: JSON.stringify(soldiers(5)) }, frames: 60, mark: "a fifth token: the five stack" },
      { msg: { t: "table", json: JSON.stringify(soldiers(6)) }, frames: 120, mark: "a token joins the group" });
    // an attack question: clicking the stack sends all six, the life counter aims all six, Split lays them out to be
    // picked one by one, and they stack again when the question closes
    const white = lastTable.players.find((x) => x.color === "White").slot;
    const ids = [901, 902, 903, 904, 905, 906].map((n) => `engine-card-${n}`);
    const objOf = (id) => `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end`;
    const picked = `local n = 0 for k = 1, 12 do if engineSelectedFor("Blue", k) then n = n + 1 end end`;
    const soldiersOnTable = `local c = 0 for _, x in ipairs(getObjects()) do if tostring(x.getGMNotes()):match("^engine:engine%-card%-90[1-6]$") then c = c + 1 end end`;
    one.push(ask({ promptId: 1500, kind: "attack", title: "Declare attackers", mode: "multi", min: 0, max: 12,
        options: ids.flatMap((id) => [{ id: `${id}|player-9`, label: "Soldier attacks AI" }, { id: `${id}|${white}`, label: "Soldier attacks White" }]) }),
      click(`${objOf(ids[0])} onPlayerAction(Player.Blue, Player.Action.Select, { o }) ${picked} return n`),
      click(`__sim.frames(30) onPlayerAction(Player.Blue, Player.Action.Select, { getObjectFromGUID("23e485") }) ${picked} local w = 0 for k = 2, 12, 2 do if engineSelectedFor("Blue", k) then w = w + 1 end end return n .. " picked, " .. w .. " at White"`),
      click(`local out = {} for id, w in pairs(engineAbilityWant) do out[#out + 1] = tostring(w.list[1].id) end table.sort(out) return table.concat(out, ",")`),
      click(`local g for id, w in pairs(engineAbilityWant) do if tostring(w.list[1].id):find("^__split:") then for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:" .. id then g = x.getGUID() end end end end if g == nil then return "no split box" end onMtgAbility(Player.Blue, nil, "ab|" .. g .. "|1") __sim.frames(90) ${soldiersOnTable} return c`),
      click(`__sim.frames(30) ${objOf(ids[3])} onPlayerAction(Player.Blue, Player.Action.Select, { o }) __sim.frames(30) onPlayerAction(Player.Blue, Player.Action.Select, { o }) ${picked} return n`), // (a second click takes one token out)
      ask({ promptId: null }),
      click(`__sim.frames(90) ${soldiersOnTable} return c`));
  }
  // 2026-10-25: a double-faced card shows the plain back in a hand (TTS shows the other players a hand card's back)
  // and its other face as the back once on the battlefield: the card is replaced when it lands
  {
    const delver = { id: "engine-card-950", n: "Delver of Secrets", f: "https://img.example/delver-front.jpg", tl: "Creature — Human Wizard",
      ty: ["Creature"], cmc: 1, p: 1, t: 1, bp: 1, bt: 1, ctl: "Blue" };
    const board = (zone, back) => {
      const t = JSON.parse(JSON.stringify(lastTable));
      const pl = t.players.find((x) => x.color === "Blue");
      pl[zone] = [...(pl[zone] || []), { ...delver, b: back }];
      pl.keep = (pl.keep || []).filter((z) => z !== "hand" && z !== "battlefield");
      return t;
    };
    const backOf = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:engine-card-950" then o = x end end if o == nil then return "none" end local d = o.getData() for _, e in pairs(d.CustomDeck or {}) do return e.BackURL end`;
    one.push({ msg: { t: "table", json: JSON.stringify(board("hand", "")) }, frames: 60, mark: "a double-faced card in the hand" },
      click(backOf),
      { msg: { t: "table", json: JSON.stringify(board("battlefield", "https://img.example/delver-back.jpg")) }, frames: 60, mark: "the double-faced card cast" },
      click(backOf));
  }
  // M5 lines: a spell on the stack targeting Blue and one of Blue's cards, a blocker; a player's own drawing stays
  {
    const white = lastTable.players.find((x) => x.color === "White");
    const whiteBf = [];
    for (const m of s1) if (m.t === "table") { const pl = JSON.parse(m.json).players.find((x) => x.color === "White"); if (pl && pl.battlefield) whiteBf.splice(0, whiteBf.length, ...pl.battlefield.map((c) => c.id)); }
    const withLines = JSON.parse(JSON.stringify(lastTable));
    withLines.stack = [
      { id: "stack-89", n: "Opt", tx: "Scry 1. Draw a card.", ctl: "Blue", src: null, spell: true, tg: [] },
      { id: "stack-90", n: "Shock", tx: "Shock deals 2 damage to any target.", ctl: "White", src: null, spell: true,
        tg: [{ k: "p", c: "Blue" }, { k: "c", id: bf[1].id }, { k: "s", id: "stack-89" }] },
      // an ability: its line starts at its source card on the battlefield
      { id: "stack-91", n: "Ability", tx: "deals 1 damage to target player.", ctl: "Blue", src: bf[0].id, spell: false, tg: [{ k: "p", c: "White" }] }];
    const wl = withLines.players.find((x) => x.color === "Blue");
    wl.battlefield = bf.map((c, i) => (i === 2 && whiteBf[0] ? { ...c, blk: true, blkOf: [whiteBf[0]] } : c));
    wl.keep = (wl.keep || []).filter((z) => z !== "battlefield");
    void white;
    one.push(click('Global.setVectorLines({ { points = { {0, 2, 0}, {1, 2, 1} }, color = {1, 1, 1}, thickness = 0.5 } })'),
      { msg: { t: "table", json: JSON.stringify(withLines) }, mark: "lines: target and block" },
      { msg: { t: "table", json: JSON.stringify(withLines) }, mark: "lines: the same board again (no redraw)" },
      { msg: { t: "table", json: JSON.stringify({ ...lastTable, stack: [] }) }, frames: 200, mark: "lines: stack resolved (pop-up closes)" },
      click('return tostring(#Global.getVectorLines()) .. " " .. tostring(Global.getVectorLines()[1] and Global.getVectorLines()[1].thickness)'),
      // a "choose a target" question: clicking a life counter's own button picks that player (as clicking the object)
      ask({ promptId: 996, kind: "target", title: "Choose target", mode: "single", min: 1, max: 1,
        options: [{ id: `player|${lastTable.players.find((x) => x.color === "White").slot}`, label: "White" }] }),
      click('engineLifeTrackerClick({ guid = "23e485", color = "Blue" })'),
      // a permanent that isn't one of the choices: the player is told so
      ask({ promptId: 997, kind: "target", title: "Choose target", mode: "single", min: 1, max: 1,
        options: [{ id: `card|${bf[1].id}`, label: "a creature" }] }),
      click(`local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${bf[0].id}" then o = x end end if o then onPlayerAction(Player.Blue, Player.Action.Select, { o }) end`),
      // a card in your hand (looking at it): no hint
      click(`__sim.frames(200) local o for _, x in ipairs(getObjects()) do local id = tostring(x.getGMNotes()):match("^engine:(engine%-card%-%d+)$") if id and x.getPosition().z > 20 then o = x end end if o then onPlayerAction(Player.Blue, Player.Action.Select, { o }) return o.getGMNotes() end return "no hand card"`));
  }
  // 2026-10-21 sweep fixes
  {
    const objOf = (id) => `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end`;
    // turning a five-colour land while paying {B}: the button the cost can use (rank 2), not the land's first one
    one.push(ask({ promptId: 1001, kind: "mana", title: "Pay {B} for Feed the Swarm", mode: "single", min: 1, max: 1,
      options: [{ id: "__auto", label: "Auto-pay" }, { id: `tap:${bf[1].id}:0`, cardId: bf[1].id, label: "Tap City of Brass for {W}", rank: 0 },
        { id: `tap:${bf[1].id}:2`, cardId: bf[1].id, label: "Tap City of Brass for {B}", rank: 2 }, { id: "__cancel", label: "Cancel" }] }),
      click(`${objOf(bf[1].id)} if o then onPlayerAction(Player.Blue, Player.Action.RotateIncrementalRight, { o }) end`),
      // no button that helps: says so, nothing is sent
      ask({ promptId: 1002, kind: "mana", title: "Pay {G} for Llanowar Elves", mode: "single", min: 1, max: 1,
        options: [{ id: "__auto", label: "Auto-pay" }, { id: `tap:${bf[1].id}:0`, cardId: bf[1].id, label: "Tap for {W}", rank: 0 }, { id: "__cancel", label: "Cancel" }] }),
      click(`__sim.frames(30) ${objOf(bf[1].id)} if o then onPlayerAction(Player.Blue, Player.Action.RotateIncrementalRight, { o }) end`),
      // a discard of 2 by dragging: the bridge says the first is chosen, the table marks it
      ask({ promptId: 1003, title: "Discard (2)", mode: "multi", min: 2, max: 2, options: [{ id: bf[0].id, label: "one" }, { id: bf[2].id, label: "two" }] }),
      { msg: { t: "picked", json: JSON.stringify({ t: "picked", color: "Blue", id: bf[2].id }) }, mark: "picked by drag" },
      click('local t = {} for i = 1, 2 do t[#t + 1] = tostring(engineSelectedFor("Blue", i)) end return table.concat(t, ",")'),
      ask({ promptId: null }));
    // a permanent Blue arranged by hand changes controller: it goes to White's side, not the spot Blue chose
    const moved = JSON.parse(JSON.stringify(lastTable));
    const mb = moved.players.find((x) => x.color === "Blue"), mw = moved.players.find((x) => x.color === "White");
    mb.battlefield = bf.filter((c, i) => i !== 3);
    mw.battlefield = [...(mw.battlefield || []), bf[3]];
    mb.keep = (mb.keep || []).filter((z) => z !== "battlefield"); mw.keep = (mw.keep || []).filter((z) => z !== "battlefield");
    one.push(click(`${objOf(bf[3].id)} if o then local p = data.Blue.playmat.getPosition() o.setPosition(Vector(p.x + 3, 1.5, p.z)) onObjectDrop("Blue", o) end`),
      { msg: { t: "table", json: JSON.stringify(lastTable) }, mark: "arranged by hand" },
      { msg: { t: "table", json: JSON.stringify(moved) }, mark: "control changed to White" },
      click(`${objOf(bf[3].id)} local p = o and o.getPosition() return p and string.format("%.1f %.1f", p.x, p.z) or "none"`));
  }
  // a question about a card still waiting on top of the library (Sylvan Library's drawn cards) hands the draws over;
  // one about other cards leaves them waiting
  {
    const held = blueBf[2];
    one.push(click(`engineAutoPace.Blue = false enginePending.Blue = { draw = { "${held}" }, mill = {}, untap = {} } return "held"`),
      ask({ promptId: 1101, title: "Choose (1)", mode: "multi", min: 1, max: 1, options: [{ id: blueBf[0], label: "not held" }] }),
      click('return tostring(#enginePending.Blue.draw)'),
      ask({ promptId: 1102, title: "Sylvan Library: choose 1 card from your hand", mode: "multi", min: 1, max: 1, options: [{ id: held, label: "held" }] }),
      click('return tostring(#enginePending.Blue.draw)'),
      ask({ promptId: null }));
  }
  // the engine asks about drawn cards ~50 ms before the board that draws them (Sylvan Library): those draws aren't held
  // back on the library; a draw no question is about still is
  {
    // (the last full hand: a board leaves out zones that didn't change)
    let blueHand = [];
    for (const m of s1) if (m.t === "table") { const pl = JSON.parse(m.json).players.find((x) => x.color === "Blue"); if (pl && pl.hand) blueHand = pl.hand; }
    const drawn = (t, ids) => {
      const x = JSON.parse(JSON.stringify(t));
      const b = x.players.find((pl) => pl.color === "Blue");
      b.hand = [...(b.hand || blueHand), ...ids.map((id) => ({ id, n: "Island", ctl: "Blue" }))];
      b.handCount = b.hand.length;
      b.library = (b.library || 40) - ids.length;
      b.keep = (b.keep || []).filter((z) => z !== "hand");
      return x;
    };
    const t1 = drawn(lastTable, ["engine-card-951"]);
    const t2 = drawn(t1, ["engine-card-952"]);
    one.push(click("engineAutoPace.Blue = false enginePending.Blue = nil return 'reset'"),
      { msg: { t: "table", json: JSON.stringify(lastTable) }, mark: "before the draws" },
      ask({ promptId: 1201, title: "Choose (1)", mode: "single", min: 1, max: 1, options: [{ id: blueBf[0], label: "not drawn" }] }),
      { msg: { t: "table", json: JSON.stringify(t1) }, mark: "a draw no question is about" },
      click("return tostring(#enginePending.Blue.draw)"),
      click("engineReleasePending('Blue', 'all') return 'taken'"),
      ask({ promptId: 1202, title: "Sylvan Library: choose 1 card from your hand", mode: "multi", min: 1, max: 1, options: [{ id: "engine-card-952", label: "drawn" }] }),
      { msg: { t: "table", json: JSON.stringify(t2) }, mark: "the board drawing the card the question is about" },
      click("return tostring(#enginePending.Blue.draw)"),
      ask({ promptId: null }));
  }
  // M5 effects: a Counterspell aimed at Opt (COUNTERED), a board wipe (Blue's graveyard flashes once, "x3")
  {
    const withStack = JSON.parse(JSON.stringify(lastTable));
    withStack.stack = [
      { id: "stack-70", n: "Opt", tx: "Scry 1. Draw a card.", ctl: "Blue", src: null, spell: true, tg: [] },
      { id: "stack-71", n: "Counterspell", tx: "Counter target spell.", ctl: "White", src: null, spell: true, tg: [{ k: "s", id: "stack-70" }] }];
    const wiped = JSON.parse(JSON.stringify(lastTable));
    const wb = wiped.players.find((x) => x.color === "Blue");
    wb.battlefield = bf.slice(3);
    wb.graveyard = [...(wb.graveyard || []), ...bf.slice(0, 3).map((c) => ({ id: c.id, ctl: "Blue" }))];
    wb.keep = (wb.keep || []).filter((z) => z !== "battlefield" && z !== "graveyard");
    const full = JSON.parse(JSON.stringify(lastTable));
    const fb = full.players.find((x) => x.color === "Blue");
    fb.battlefield = bf;
    fb.keep = (fb.keep || []).filter((z) => z !== "battlefield");
    one.push({ msg: { t: "table", json: JSON.stringify(full) }, mark: "fx: before" },
      { msg: { t: "table", json: JSON.stringify(withStack) }, mark: "fx: Counterspell on Opt" },
      { msg: { t: "table", json: JSON.stringify({ ...full, stack: [] }) }, frames: 130, mark: "fx: both gone (countered)" },
      { msg: { t: "table", json: JSON.stringify(wiped) }, frames: 100, mark: "fx: three die at once" },
      { msg: { t: "table", json: JSON.stringify({ ...full, stack: [withStack.stack[0], withStack.stack[1],
        { id: "stack-72", n: "Negate", tx: "Counter target noncreature spell.", ctl: "Blue", src: null, spell: true, tg: [{ k: "s", id: "stack-71" }] }] }) }, mark: "fx: Negate on the Counterspell" },
      { msg: { t: "table", json: JSON.stringify({ ...full, stack: [withStack.stack[0]] }) }, frames: 130, mark: "fx: Counterspell countered, Opt stays" },
      { msg: { t: "table", json: JSON.stringify({ ...full, stack: [] }) }, frames: 130, mark: "fx: Opt resolves" },
      click("return tostring(engineFxLast and engineFxLast.died and engineFxLast.died.Blue) .. ' ' .. tostring(engineFxFlashed)"));
  }
  // the default (Auto on): a held draw finishes by itself 2 s later
  {
    let blueHand2 = [];
    for (const m of s1) if (m.t === "table") { const pl = JSON.parse(m.json).players.find((x) => x.color === "Blue"); if (pl && pl.hand) blueHand2 = pl.hand; }
    const drew = JSON.parse(JSON.stringify(lastTable));
    const db = drew.players.find((x) => x.color === "Blue");
    // (the hand as the previous test left it: it drew engine-card-951 and -952)
    const base = [...blueHand2, { id: "engine-card-951", n: "Island", ctl: "Blue" }, { id: "engine-card-952", n: "Island", ctl: "Blue" }];
    db.hand = [...base, { id: "engine-card-961", n: "Island", ctl: "Blue" }];
    db.handCount = db.hand.length; db.library = (db.library || 40) - 3;
    const before = JSON.parse(JSON.stringify(drew)); const bb2 = before.players.find((x) => x.color === "Blue");
    bb2.hand = base; bb2.handCount = base.length; bb2.library = db.library + 1;
    db.keep = (db.keep || []).filter((z) => z !== "hand");
    one.push(click("engineAutoPace.Blue = nil enginePending.Blue = nil return 'auto on'"),
      { msg: { t: "table", json: JSON.stringify(before) }, mark: "auto: before the draw" },
      ask({ promptId: 1301, title: "Choose (1)", mode: "single", min: 1, max: 1, options: [{ id: blueBf[0], label: "x" }] }),
      { msg: { t: "table", json: JSON.stringify(drew) }, frames: 30, mark: "auto: a draw (held for now)" },
      click("return tostring(#enginePending.Blue.draw)"),
      { msg: { t: "table", json: JSON.stringify(drew) }, frames: 150, mark: "auto: 2 s later" },
      click("return tostring(#enginePending.Blue.draw)"),
      click("engineAutoPace.Blue = false return 'auto off again'"),
      ask({ promptId: null }));
  }
  // a target question naming the AI's (White's) creature unlocks it, so a click on it reaches the table; it locks again after
  {
    const whiteCard = (() => { let bfW = []; for (const m of s1) if (m.t === "table") { const pl = JSON.parse(m.json).players.find((x) => x.color === "White"); if (pl && pl.battlefield) bfW = pl.battlefield; } return bfW[0] && bfW[0].id; })();
    const lockOf = `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${whiteCard}" then o = x end end return o and tostring(o.getLock()) or "none"`;
    // (White's whole battlefield again: a test above left only one card there)
    let bfW = []; for (const m of s1) if (m.t === "table") { const pl = JSON.parse(m.json).players.find((x) => x.color === "White"); if (pl && pl.battlefield) bfW = pl.battlefield; }
    const withW = JSON.parse(JSON.stringify(lastTable)); const ww = withW.players.find((x) => x.color === "White");
    ww.battlefield = bfW; ww.keep = (ww.keep || []).filter((z) => z !== "battlefield");
    one.push({ msg: { t: "table", json: JSON.stringify(withW) }, mark: "White's battlefield" }, click(lockOf),
      ask({ promptId: 1302, kind: "target", title: "Destroy: choose 1 target(s)", mode: "multi", min: 1, max: 1, options: [{ id: `card|${whiteCard}`, label: "the AI's creature" }] }),
      click(lockOf),
      ask({ promptId: null }),
      click(lockOf));
    // (2026-10-22) mills: White (an AI seat) mills 3: three face-up stand-ins fly from its library to its graveyard and
    // go; Blue (seated) mills 2: held face up beside the library, then let go: they slide into the graveyard
    const fxCount = click('local n = 0 for _, x in ipairs(getObjects()) do if x.getGMNotes() == "enginefx" then n = n + 1 end end return tostring(n)');
    const heldCount = click('return tostring(#((enginePending.Blue or {}).mill or {}))');
    const milled = JSON.parse(JSON.stringify(withW));
    const mw = milled.players.find((x) => x.color === "White"), mb = milled.players.find((x) => x.color === "Blue");
    mw.library = (mw.library || 40) - 3; mb.library = (mb.library || 40) - 2;
    mw.graveyard = [...(mw.graveyard || []), ...bfW.slice(0, 3).map((c, i) => ({ ...c, id: `engine-card-981${i}`, tap: false, atk: false }))];
    mb.graveyard = [...(mb.graveyard || []), ...bf.slice(0, 2).map((c, i) => ({ ...c, id: `engine-card-982${i}`, tap: false, atk: false }))];
    for (const p of [mw, mb]) p.keep = (p.keep || []).filter((z) => z !== "graveyard");
    one.push(click("engineAutoPace.Blue = false paceArmed = paceArmed or {} return 'manual'"),
      { msg: { t: "table", json: JSON.stringify(milled) }, frames: 10, mark: "mill: White mills 3, Blue mills 2" }, fxCount, heldCount,
      click("__sim.frames(120) return 'later'"), fxCount,
      click("engineReleasePending('Blue', 'mill') return 'released'"),
      { msg: { t: "table", json: JSON.stringify(milled) }, frames: 10, mark: "mill: Blue's held mills let go" }, heldCount,
      click("__sim.frames(120) return 'later'"), fxCount);
    // (2026-10-22) the attack lunge into a blocker: Blue's creature attacks White, White's creature blocks it; at the
    // damage step the attacker swings onto the blocker (not at the player), once
    const fight = (step) => {
      const b = JSON.parse(JSON.stringify(withW));
      b.step = step; b.active = "Blue";
      const pb = b.players.find((x) => x.color === "Blue"), pw = b.players.find((x) => x.color === "White");
      pb.battlefield = bf.map((c, i) => (i === 0 ? { ...c, atk: true, atkT: "White", tap: true } : c));
      pw.battlefield = bfW.map((c, i) => (i === 0 ? { ...c, blk: true, blkOf: [bf[0].id] } : c));
      for (const p of [pb, pw]) p.keep = (p.keep || []).filter((z) => z !== "battlefield");
      return { msg: { t: "table", json: JSON.stringify(b) }, frames: 4, mark: `lunge: Blue attacks, White blocks (${step})` };
    };
    const where = click(`local o = nil for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${bf[0].id}" then o = x end end return o and string.format("%.1f %.1f", o.getPosition().x, o.getPosition().z) or "none"`);
    one.push(fight("combatDeclareBlockers"), where, fight("combatDamage"), click("__sim.frames(15) return 'mid-swing'"), where,
      fight("combatDamage"), click("__sim.frames(120) return 'back'"), where);
    // (2026-10-22) Settings: My effects hides the stack pop-up for that player only; Table animations (host) off: the
    // next combat doesn't swing; a player who isn't the host can't switch it
    const nextTurn = (step) => { const st = fight(step); const b = JSON.parse(st.msg.json); b.turn = (b.turn || 0) + 1; return { ...st, msg: { t: "table", json: JSON.stringify(b) }, mark: st.mark + " next turn" }; };
    const setState = click('return tostring(UI.getAttribute("eng_setpanel_Blue", "active")) .. " | " .. tostring(UI.getAttribute("eng_fx_Blue", "text")) .. " | " .. tostring(UI.getAttribute("eng_anim_Blue", "text")) .. " | anim off: " .. tostring(engineAnimOff)');
    one.push(click('onMtgSettings(Player.Blue, nil, "eng_set_Blue")'), setState,
      click('onMtgFx(Player.Blue, nil, "eng_fx_Blue") enginePopOpen() return tostring(UI.getAttribute("eng_pop", "visibility"))'), setState,
      click('onMtgFx(Player.Blue, nil, "eng_fx_Blue") return "settings: open, effects back on"'),
      click('onMtgAnim(Player.Red, nil, "eng_anim_Red")'), setState, // not the host: nothing
      click('onMtgAnim(Player.Blue, nil, "eng_anim_Blue")'), setState, // the host: off
      nextTurn("combatDeclareBlockers"), nextTurn("combatDamage"), click("__sim.frames(15) return 'no swing?'"), where,
      // (still switched off, and Blue's own effects off too) White's turn begins and White mills a card: no turn banner
      // for Blue, no card flying
      click('onMtgFx(Player.Blue, nil, "eng_fx_Blue") return "effects off"'),
      (() => {
        const b = JSON.parse(JSON.stringify(milled));
        b.turn = (b.turn || 0) + 5; b.active = "White"; b.step = "upkeep";
        const w = b.players.find((x) => x.color === "White");
        w.library = (w.library || 40) - 1;
        w.graveyard = [...(w.graveyard || []), { ...bfW[1], id: "engine-card-9830", tap: false }];
        w.keep = (w.keep || []).filter((z) => z !== "graveyard");
        return { msg: { t: "table", json: JSON.stringify(b) }, frames: 20, mark: "White's turn, a mill, all switched off" };
      })(),
      fxCount, click('onMtgFx(Player.Blue, nil, "eng_fx_Blue") return "effects on"'),
      click('onMtgAnim(Player.Blue, nil, "eng_anim_Blue") onMtgSettings(Player.Blue, nil, "eng_set_Blue")'), setState);
    // (2026-10-23, our Forge build) linked and playable exile: White's card exiled by Blue's permanent until it leaves
    // lies half-size under it; a face-up card Blue may play sits in Blue's public row (glowing); Blue's foretold card
    // goes into Blue's second hand zone; none of them in a pile. Then the permanent leaves: the card is back in its pile
    {
      const ex = JSON.parse(JSON.stringify(withW));
      const pb = ex.players.find((x) => x.color === "Blue"), pw = ex.players.find((x) => x.color === "White");
      const host = bf[1].id;
      const linked = { ...bfW[2], id: "engine-card-9901", ew: host, rl: true, tap: false };
      const open = { ...bfW[3] || bfW[2], id: "engine-card-9902", tap: false };
      // (9903 foretold: private by the flag alone; 9906 face-down in exile (Gonti): private by that alone; 9907 a
      // flashback card in Blue's graveyard: the second card of the public row; 9905 White's, but White isn't seated)
      const foretold = { id: "engine-card-9903" };
      const linked2 = { ...bfW[2], id: "engine-card-9904", ew: host, tap: false };
      const gonti = { id: "engine-card-9906", fd: true };
      const flashback = { ...bfW[2], id: "engine-card-9907", tap: false };
      const whiteOwn = { ...bfW[2], id: "engine-card-9905", tap: false };
      pw.exile = [...(pw.exile || []), linked, linked2, open, whiteOwn];
      pw.playable = [whiteOwn];
      pb.exile = [...(pb.exile || []), foretold, gonti];
      pb.graveyard = [...(pb.graveyard || []), flashback];
      pb.playable = [open, { ...bf[0], id: "engine-card-9903", fo: true, tap: false }, { ...bf[0], id: "engine-card-9906", tap: false }, flashback];
      for (const p of [pb, pw]) p.keep = (p.keep || []).filter((z) => z !== "exile" && z !== "playable" && z !== "graveyard");
      const objOf = (id) => `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end`;
      const report = click(`local out = {} for _, id in ipairs({ "engine-card-9901", "engine-card-9904", "engine-card-9902", "engine-card-9903", "engine-card-9905", "engine-card-9906", "engine-card-9907" }) do local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:" .. id then o = x end end if o then local inHand2 = false for _, h in ipairs(Player.Blue.getHandObjects(2)) do if h == o then inHand2 = true end end local p = o.getPosition() out[#out + 1] = string.format("%s %.1f %.1f s%.1f%s", id:sub(-4), p.x, p.z, o.getScale().x, inHand2 and " hand2" or "") else out[#out + 1] = id:sub(-4) .. " none" end end return table.concat(out, " | ")`);
      const gone = JSON.parse(JSON.stringify(ex));
      const gb = gone.players.find((x) => x.color === "Blue");
      gb.battlefield = gb.battlefield.filter((c) => c.id !== host);
      gb.keep = (gb.keep || []).filter((z) => z !== "battlefield");
      one.push({ msg: { t: "table", json: JSON.stringify(ex) }, frames: 10, mark: "exile: playable and linked" }, report,
        click(`${objOf("engine-card-9902")} if o then local p = data.Blue.playmat.getPosition() o.setPosition(Vector(p.x + 3, 1.5, p.z)) onObjectDrop("Blue", o) return "dropped" end return "none"`),
        click(`${objOf("engine-card-9903")} if o then o.setPosition(o.getPosition() + Vector(0.5, 0, 0)) onObjectDrop("Blue", o) return "moved in hand2" end return "none"`),
        // (a manual fix, M7) a playable card in hand zone 2 and a linked card under its permanent, picked up and left
        // where they lie: no change; a spectator can't pick anything up
        { msg: { t: "table", json: JSON.stringify({ ...ex, fix: { id: 9, state: "editing", kind: "board", by: "Blue", waiting: [] } }) }, frames: 4, mark: "exile: a manual fix touches them" },
        click(`${objOf("engine-card-9903")} ${objOf("engine-card-9901").replace("local o", "local l")} return tostring(onPlayerAction(Player.Blue, Player.Action.PickUp, { o })) .. " " .. tostring(onPlayerAction(Player.Blue, Player.Action.PickUp, { l })) .. " grey " .. tostring(onPlayerAction(Player.Grey, Player.Action.PickUp, { o }))`),
        click('local ops, un = engineFixRead() local out = {} for _, o in ipairs(ops) do out[#out + 1] = o.op .. ":" .. tostring(o.card) end return #ops .. " ops " .. table.concat(out, " ") .. " | unplaced " .. #un'),
        { msg: { t: "table", json: JSON.stringify(ex) }, frames: 6, mark: "exile: the fix is cancelled" },
        { msg: { t: "table", json: JSON.stringify(gone) }, frames: 10, mark: "exile: the permanent left" }, report);
    }
    // (2026-10-23) manual fix by vote (M7): the panel in each state; while editing the board holds (a new board
    // message moves nothing), engine cards can be moved, turned and flipped (not deleted), Done reads the touched
    // cards (moved to the graveyard, tapped, put on another player's mat, one left nowhere) plus the chat numbers;
    // then review, applying, and the end: the board is drawn as the engine has it again
    {
      const objOf = (id) => `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end`;
      const withFix = (fix) => { const b = JSON.parse(JSON.stringify(withW)); b.fix = fix; return b; };
      const panel = click('local t, y, n = engineFixPanel(engineFix, "Blue") return t .. " | " .. tostring(y) .. " | " .. tostring(n)');
      const read = click('local ops, un = engineFixRead() local out = {} for _, o in ipairs(ops) do out[#out + 1] = o.op .. ":" .. tostring(o.card or o.player) .. ":" .. tostring(o.zone or o.n or o.value or o.player) .. (o.op == "tap" and (":" .. tostring(o.tapped)) or "") end return table.concat(out, " ") .. " | unplaced: " .. table.concat(un, ",")');
      const pos = (id) => click(`${objOf(id)} if not o then return "none" end local p = o.getPosition() return string.format("%.1f %.1f r%.0f", p.x, p.z, o.getRotation().y)`);
      const pick = (id) => click(`${objOf(id)} if o then return tostring(onPlayerAction(Player.Blue, Player.Action.PickUp, { o })) end return "none"`);
      const msg = (fix, mark) => ({ msg: { t: "table", json: JSON.stringify(withFix(fix)) }, frames: 6, mark });
      one.push(
        msg({ id: 1, state: "voting", by: "White", waiting: ["Blue"] }, "fix: voting"), panel,
        click('onMtgFix(Player.Blue, nil, "eng_fixbno_Blue")'),
        msg({ id: 1, state: "pausing", by: "Blue", waiting: [] }, "fix: pausing"), panel,
        msg({ id: 1, state: "editing", kind: "board", by: "Blue", waiting: [] }, "fix: editing"), panel,
        click('onMtgFix(Player.Blue, nil, "eng_fixbyes_Blue")'),
        pick(bf[0].id), click(`${objOf(bf[0].id)} if o then o.setPosition(data.Blue.graveyard.getPosition() + Vector(0, 1, 0)) onObjectDrop("Blue", o) end`),
        click(`${objOf(bf[2].id)} if o then onPlayerAction(Player.Blue, Player.Action.RotateIncrementalRight, { o }) o.setRotation(o.getRotation() + Vector(0, 90, 0)) end`),
        pick(bfW[0].id), click(`${objOf(bfW[0].id)} if o then local p = data.Blue.playmat.getPosition() o.setPosition(Vector(p.x - 4, 1.5, p.z)) onObjectDrop("Blue", o) end`),
        click(`${objOf(bf[3].id)} if o then return tostring(onPlayerAction(Player.Blue, Player.Action.Delete, { o })) end return "none"`),
        click('engineFixSet("Blue", "life white 31") engineFixSet("Blue", "poison purple 2") engineFixSet("Blue", "dance blue 2")'),
        // a card dropped onto a pile lies on it (so its spot says where it went): the fake TTS asks tryObjectEnterContainer,
        // which keeps it out of an engine pile, then the drop is reported (picked up first, as a player does)
        click(`local deck for _, x in ipairs(getObjects()) do if tostring(x.getGMNotes()):find("^engine:%a+:%a+$") and x.type == "Deck" and not tostring(x.getGMNotes()):find("library") then deck = x end end
          ${objOf(bf[1].id)} if not deck or not o then return "no pile or card" end
          onPlayerAction(Player.Blue, Player.Action.PickUp, { o }) deck.setLock(false) o.setPosition(deck.getPosition() + Vector(0, 1, 0)) deck.putObject(o) onObjectDrop("Blue", o) __sim.frames(3)
          local n, loose = 0, nil for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${bf[1].id}" then n = n + 1 loose = x end end
          local p = loose and loose.getPosition() return "pops back out: " .. n .. (loose and string.format(" at %.1f %.1f, %s", p.x, p.z, tostring(engineFixTouched["${bf[1].id}"])) or "")`),
        msg({ id: 1, state: "editing", kind: "board", by: "Blue", waiting: [] }, "fix: the board holds while editing"), pos(bf[0].id), pos(bf[2].id), pos(bfW[0].id), read,
        pick(bf[1].id), click(`${objOf(bf[1].id)} if o then o.setPosition(Vector(0, 1.5, 0)) end`), read,
        click('onMtgFix(Player.Blue, nil, "eng_fixbyes_Blue")'),
        click(`${objOf(bf[1].id)} if o then local p = data.Blue.playmat.getPosition() o.setPosition(Vector(p.x + 4, 1.5, p.z)) end`),
        click('onMtgFix(Player.Blue, nil, "eng_fixbyes_Blue")'),
        msg({ id: 1, state: "editing", kind: "board", by: "Blue", waiting: [], message: "no card engine-card-1" }, "fix: refused, back to editing"), panel,
        msg({ id: 1, state: "review", by: "Blue", waiting: ["Blue"], lines: ["Mountain: Blue's battlefield → Blue's graveyard", "White life → 31"] }, "fix: review"), panel,
        click(`${objOf(bf[3].id)} if o then return tostring(onPlayerAction(Player.Blue, Player.Action.PickUp, { o })) end return "none"`),
        click('onMtgFix(Player.Blue, nil, "eng_fixbyes_Blue") onMtgFix(Player.Blue, nil, "eng_fixbno_Blue")'),
        msg({ id: 1, state: "applying", by: "Blue", waiting: [], lines: ["White life → 31"] }, "fix: applying"), panel,
        { msg: { t: "table", json: JSON.stringify(withW) }, frames: 10, mark: "fix: over, the engine's board again" },
        pos(bf[0].id), pos(bf[2].id), pos(bfW[0].id), click('return tostring(engineFix) .. " " .. tostring(next(engineFixTouched))'));
    }
    // (2026-10-23, M7 from the table) an equipment dropped onto another permanent attaches to it; one already attached
    // and put down on its own comes off; right-click: the bottom of the library; the life and commander-damage counters
    // work while editing and are read at Done; tokens by chat; after the fix the counters show the engine's numbers
    {
      const objOf = (id) => `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end`;
      const base = JSON.parse(JSON.stringify(withW));
      const bb = base.players.find((x) => x.color === "Blue");
      bb.battlefield = bb.battlefield.map((c) => (c.id === bf[3].id ? { ...c, att: bf[2].id } : c));
      bb.keep = (bb.keep || []).filter((z) => z !== "battlefield");
      const at = (fix, mark) => ({ msg: { t: "table", json: JSON.stringify({ ...base, fix }) }, frames: 6, mark });
      const pick = (id) => click(`${objOf(id)} if o then return tostring(onPlayerAction(Player.Blue, Player.Action.PickUp, { o })) end return "none"`);
      const read = click('local ops, un = engineFixRead() local out = {} for _, o in ipairs(ops) do out[#out + 1] = o.op .. ":" .. tostring(o.card or o.player) .. ":" .. tostring(o.to or o.zone or o.from or o.script) .. ":" .. tostring(o.position or o.n or o.tapped) end return table.concat(out, " ") .. " | unplaced: " .. table.concat(un, ",")');
      const editing = { id: 2, state: "editing", kind: "board", by: "Blue", waiting: [] };
      one.push({ msg: { t: "table", json: JSON.stringify(base) }, frames: 8, mark: "fix2: an attached card" },
        at(editing, "fix2: editing"), click('return tostring(ENGINE_FIX_EDIT)'),
        pick(bf[1].id), click(`${objOf(bf[1].id)} local h for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${bf[0].id}" then h = x end end if o and h then o.setPosition(h.getPosition() + Vector(0.3, 0.5, 0.2)) return "on its host" end return "none"`),
        pick(bf[3].id), click(`${objOf(bf[3].id)} if o then local p = data.Blue.playmat.getPosition() o.setPosition(Vector(p.x - 7, 1.5, p.z + 1)) return "off" end return "none"`),
        click(`${objOf(bf[2].id)} if not o then return "none" end local n = 0 for _, m in ipairs(o.__d.menu) do n = n + 1 if m.label == "Fix: bottom of its library" then m.fn("Blue") end end
          local p, l = o.getPosition(), data.Blue.libraryZone.getPosition() return n .. " menu items, on the library: " .. tostring(math.abs(p.x - l.x) < 0.5 and math.abs(p.z - l.z) < 0.5)`),
        click('getObjectFromGUID("395037").setVar("count", 25) getObjectFromGUID("bfcf4a").setVar("val", 5) return "counters turned"'),
        click('engineFixSet("Blue", "token 1/1 green saproling for white tapped") engineFixSet("Blue", "token treasure") engineFixSet("Blue", "token zombie for purple") engineFixSet("Blue", "token ")'),
        // (2026-10-26) mana that stays until spent: n of each colour; 1-99 only, for a seated colour
        click('engineFixSet("Blue", "mana 99") engineFixSet("Blue", "mana 2 for white") engineFixSet("Blue", "mana 0") engineFixSet("Blue", "mana 100") engineFixSet("Blue", "mana lots") engineFixSet("Blue", "mana 3 for purple") local m = engineFixExtra["mana:Blue"] local w = engineFixExtra["mana:White"] return (m and #m.mana or 0) .. " " .. (w and w.mana or "none")'),
        read,
        at({ id: 2, state: "review", by: "Blue", waiting: ["White"] }, "fix2: review"), click('return tostring(ENGINE_FIX_EDIT)'),
        { msg: { t: "table", json: JSON.stringify(base) }, frames: 8, mark: "fix2: over" },
        click(`${objOf(bf[2].id)} return tostring(ENGINE_FIX_EDIT) .. " life counter " .. tostring(getObjectFromGUID("395037").getVar("count")) .. " menus " .. (o and #o.__d.menu or -1) .. " bottom " .. tostring(next(engineFixBottom))`));
    }
    // (playtest 2026-10-23) a card thrown or flicked into another player's hand goes back to its owner's hand; a
    // battlefield card thrown into a hand goes back to the battlefield. And the commander glows when it can be cast.
    {
      const blue = lastTable.players.find((x) => x.color === "Blue");
      const handId = (blue.hand || [])[0] && blue.hand[0].id;
      const cmdId = (blue.command || [])[0] && blue.command[0].id;
      const into = (id, color) => click(`local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end
        if "${id}" == "hand" then o = (Player.Blue.getHandObjects(1) or {})[1] end
        local zone for _, x in ipairs(getObjects()) do if x.type == "Hand" then local t = Player.${color}.getHandTransform(1) local p = x.getPosition() if t and (t.position.x - p.x) ^ 2 + (t.position.z - p.z) ^ 2 < 1 then zone = x end end end
        if not o or not zone then return "no card or zone" end
        o.setPosition(zone.getPosition()) onObjectEnterZone(zone, o) __sim.frames(4)
        local inBlue = false for _, h in ipairs(Player.Blue.getHandObjects(1)) do if h == o then inBlue = true end end
        local p = o.getPosition() return string.format("%.1f %.1f in Blue's hand: %s", p.x, p.z, tostring(inBlue))`);
      one.push({ msg: { t: "table", json: JSON.stringify(lastTable) }, frames: 6, mark: "hand guard: Blue's card into White's hand" },
        into("hand", "White"), into(bf[0].id, "White"), into("hand", "Blue"),
        click('onMtgAutoResolve(Player.Blue, nil, "eng_autores_Blue") local on = tostring(engineAutoListOpen.Blue) onMtgAutoResolve(Player.Red, nil, "eng_autores_Blue") onMtgAutoResolve(Player.Blue, nil, "eng_autores_Blue") return on .. " then " .. tostring(engineAutoListOpen.Blue)'),
        ask({ promptId: 1401, kind: "priority", title: "Your priority", mode: "single", min: 1, max: 1,
          options: [{ id: "a-cmd", label: "Cast the commander", cardId: cmdId }, { id: "__pass", label: "Pass priority" }, { id: `untap:${bf[2].id}`, cardId: bf[2].id, label: "Untap it (mana back)" }] }),
        click(`local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${bf[2].id}" then o = x end end if not o then return "none" end return tostring(onPlayerAction(Player.Blue, Player.Action.RotateIncrementalRight, { o }))`),
        click(`local n = 0 for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${cmdId}" then n = n + 1 return "commander framed: " .. tostring(x.UI.getXml() ~= nil and x.UI.getXml():find("eng_play") ~= nil) end end return "no commander"`),
        ask({ promptId: null }));
    }
  }
  // M4.5 rewind by vote: restore points and an open vote come with the board; Undo..., a pick, the vote buttons, chat
  const points = [{ id: 84, label: "turn 11, White's upkeep" }, { id: 82, label: "turn 10, Blue's second main phase" }, { id: 76, label: "turn 10, Blue's upkeep" }];
  const withRw = (vote, gameOver = false) => ({ msg: { t: "table", json: JSON.stringify({ ...lastTable, gameOver, rewind: { points, vote } }) }, mark: `rewind ${vote ? vote.status : "points"}` });
  one.push(click('engineChat("mtg undo", Player.Blue)'), // no restore points yet
    withRw(null),
    click('onMtgUndo(Player.Blue, nil, "eng_undo_Blue")'), click('onMtgUndo(Player.Blue, nil, "eng_undo_Blue")'), // open, close
    click('onMtgUndo(Player.Red, nil, "eng_undo_Blue")'), // someone else's button: nothing
    click('onMtgUndo(Player.Blue, nil, "eng_undo_Blue")'), click('onMtgUndoPick(Player.Blue, nil, "eng_undopt_Blue_2")'),
    click('onMtgUndoPick(Player.Blue, nil, "eng_undopt_Blue_9")'), click('onMtgUndoPick(Player.Red, nil, "eng_undopt_Blue_1")'),
    click('engineChat("mtg undo", Player.Blue)'), click('engineChat("mtg undo 3", Player.Blue)'), click('engineChat("mtg undo 7", Player.Blue)'), click('engineChat("mtg undo 12", Player.Blue)'),
    withRw({ id: 5, to: "turn 10, Blue's upkeep", by: "White", waiting: ["Blue"], status: "pending" }),
    click('onMtgVote(Player.Blue, nil, "eng_voteyes_Blue")'), click('onMtgVote(Player.Blue, nil, "eng_voteno_Blue")'),
    click('engineChat("mtg vote yes", Player.Blue)'), click('engineChat("mtg vote no", Player.Blue)'), click('engineChat("mtg vote maybe", Player.Blue)'),
    withRw({ id: 5, to: "turn 10, Blue's upkeep", by: "Blue", waiting: ["White"], status: "pending" }),
    withRw({ id: 5, to: "turn 10, Blue's upkeep", by: "White", waiting: [], status: "declined" }),
    withRw(null, true),
    // M4.6: concede asks once more; the winner is the host's call
    click('engineChat("mtg concede", Player.Blue)'), click('engineChat("mtg concede", Player.Blue)'), click('engineChat("mtg concede", Player.Blue)'),
    click('engineChat("mtg winner red", Player.Blue)'), click('engineChat("mtg winner blue", Player.Blue)'), click('engineChat("mtg winner purple", Player.Blue)'),
    click('local p = Player.Blue local h, a, pr = p.host, p.admin, p.promoted p.host, p.admin, p.promoted = false, false, false local r = engineChat("mtg winner red", p) p.host, p.admin, p.promoted = h, a, pr return tostring(r)'),
    // the game ends with a vote open: "mtg reset" (the bridge's clear) hides the Undo button and the vote
    withRw({ id: 6, to: "turn 10, Blue's upkeep", by: "White", waiting: ["Blue"], status: "pending" }),
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 90, mark: "clear with rewind UI showing" });
  // (2026-11-03, table-map gaps) the bridge's notes on graveyard and exile cards (nt) go in a lone card's hover text and
  // on a pile deck, newest card first, set again when only the notes change; the player's marks join the label under
  // the life total. Blue's cards are copies of its battlefield's under new ids.
  {
    let bfB = [];
    for (const m of s1) if (m.t === "table") { const pl = JSON.parse(m.json).players.find((x) => x.color === "Blue"); if (pl && pl.battlefield) bfB = pl.battlefield; }
    // (with their names and pictures, as the bridge sends a card's fixed details the first time)
    const statics = {};
    for (const m of s1) if (m.t === "table") Object.assign(statics, JSON.parse(m.json).cards || {});
    const noted = JSON.parse(JSON.stringify(lastTable));
    noted.cards = {};
    const as = (c, id, nt) => { noted.cards[id] = statics[c.id]; return { ...c, id, tap: false, atk: false, ...(nt ? { nt } : {}) }; };
    const nb = noted.players.find((x) => x.color === "Blue");
    nb.graveyard = [as(bfB[0], "engine-card-9841", ["Flashback {1}{U}", "Has flashback \"twice\""]), as(bfB[1], "engine-card-9842"), as(bfB[2], "engine-card-9843", ["Flashback {2}{R}"])];
    nb.exile = [as(bfB[3] || bfB[0], "engine-card-9844", ["Plotted: its owner may cast it without paying its mana cost on a later turn, as a sorcery", "3 time counters"])];
    // (allMarks since trackMarks step 6: the table reads only that)
    nb.allMarks = ["RING TEMPTED 2", "YOU CAN'T LOSE THE GAME"];
    nb.keep = (nb.keep || []).filter((z) => z !== "graveyard" && z !== "exile");
    const later = JSON.parse(JSON.stringify(noted));
    later.cards = {};
    const lb = later.players.find((x) => x.color === "Blue");
    lb.graveyard[2].nt = ["Flashback {1}{R}"];
    lb.exile[0].nt = ["2 time counters"];
    delete lb.allMarks;
    const pileText = click('for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:graveyard:Blue" then return x.type .. ": " .. x.getDescription() end end return "no pile"');
    const loneText = click('for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:engine-card-9844" then return x.getDescription() end end return "none"');
    const marksLabel = click('local o = getObjectFromGUID("395037") for _, b in ipairs((o and o.getButtons()) or {}) do if b.tooltip == ENGINE_COUNTERS_TIP then return b.label .. " @" .. tostring(b.width) end end return "no label"');
    one.push({ msg: { t: "table", json: JSON.stringify(noted) }, frames: 200, mark: "notes: flashback in the graveyard, plotted in exile, player marks" },
      pileText, loneText, marksLabel,
      // (its rules text arriving after it keeps the notes)
      { msg: { t: "texts", json: JSON.stringify({ t: "texts", texts: { "engine-card-9844": "Suspend 4—{U}" } }) }, mark: "notes: rules text arrives" }, loneText,
      { msg: { t: "table", json: JSON.stringify(later) }, frames: 200, mark: "notes: only the notes changed" },
      pileText, loneText, marksLabel);
    // (2026-11-06, docs/core-moves-cleanup-plan.md "2. trackMarks" step 1) every mark the table worded itself (poison,
    // energy, monarch, initiative, blessing, story) with the bridge's marks after them: the label and its width under
    // Blue's and White's life counters, then a board with none (the label goes). Since step 6 these old fields draw
    // nothing
    const marked = JSON.parse(JSON.stringify(later));
    const mb = marked.players.find((x) => x.color === "Blue"), mw = marked.players.find((x) => x.color === "White");
    Object.assign(mb, { poison: 3, energy: 2, monarch: true, initiative: true, blessed: true, story: true, marks: ["RING TEMPTED 2", "YOU CAN'T LOSE THE GAME"] });
    Object.assign(mw, { poison: 1, energy: 0, story: true, marks: ["SPEED 1"] });
    const bothLabels = click('local out = {} for _, g in ipairs({ "395037", "23e485" }) do local o, l = getObjectFromGUID(g), "no label" for _, b in ipairs((o and o.getButtons()) or {}) do if b.tooltip == ENGINE_COUNTERS_TIP then l = b.label .. " @" .. tostring(b.width) end end out[#out + 1] = g .. ": " .. l end return table.concat(out, " | ")');
    one.push({ msg: { t: "table", json: JSON.stringify(marked) }, frames: 30, mark: "marks: every mark the table words, then the bridge's" }, bothLabels,
      { msg: { t: "table", json: JSON.stringify(later) }, frames: 30, mark: "marks: none" }, bothLabels);
    // (step 4) the same marks as the bridge sends them since: the old fields and allMarks, the whole label (the same
    // label and width); then allMarks alone, as the bridge will send them once the old fields go (step 6)
    const allOf = { Blue: ["POISON 3", "ENERGY 2", "MONARCH", "INITIATIVE", "CITY'S BLESSING", "ENDURING STORY", "RING TEMPTED 2", "YOU CAN'T LOSE THE GAME"], White: ["POISON 1", "ENDURING STORY", "SPEED 1"] };
    const both = JSON.parse(JSON.stringify(marked));
    for (const p of both.players) if (allOf[p.color]) p.allMarks = allOf[p.color];
    const alone = JSON.parse(JSON.stringify(later));
    for (const p of alone.players) {
      for (const k of ["poison", "energy", "monarch", "initiative", "blessed", "story", "marks"]) delete p[k];
      if (allOf[p.color]) p.allMarks = allOf[p.color];
    }
    one.push({ msg: { t: "table", json: JSON.stringify(both) }, frames: 30, mark: "marks: old fields and allMarks" }, bothLabels,
      { msg: { t: "table", json: JSON.stringify(later) }, frames: 30, mark: "marks: none again" }, bothLabels,
      { msg: { t: "table", json: JSON.stringify(alone) }, frames: 30, mark: "marks: allMarks alone" }, bothLabels);
  }
  // Ready / Start buttons (docs/game-modes-spec.md §6): two seated players, the bridge's deck reports, clicks
  const tile = 'local t for _, o in ipairs(getObjects()) do if o.getGMNotes() == "mtgsetup" then t = o end end';
  const report = (ready, checked) => ({ msg: { t: "deckReport", json: JSON.stringify({ t: "deckReport", request: -1, ready, checked }) }, mark: `deckReport ready=${ready} checked=${checked}` });
  const firstTable = JSON.parse(s1.find((m) => m.t === "table").json);
  // (Blue starts this game at 38, so its first board differs from the counter's 40: that first board must not flash "-2")
  for (const pl of firstTable.players) if (pl.color === "Blue") pl.life = 38;
  const setup = [
    click(`${tile} return t and t.getButtons()[1].label or "no tile"`), // on load: the engine switch, "Engine: off"
    click(`${tile} onMtgSetupEngine(t, "White")`), // not the host but seated: turns it on (2026-10-25; was refused)
    click("setEngineMode(true)"),
    report([], ["Blue"]), // Blue's deck has a problem: red
    report(["Blue"], ["Blue"]), // fixed: green, 1 of 2 ready
    click('onMtgSetupReady(data.Blue.playmat, "White")'), // someone else's button
    click('onMtgSetupReady(data.White.playmat, "White")'), // White checks their deck (as "mtg ready")
    click(`${tile} onMtgSetupStart(t, "White")`), // not everyone is ready yet
    report(["White"], ["White"]), // both ready: START GAME
    click(`${tile} onMtgSetupStart(t, "White")`), // anyone may start (as "mtg start", without the host check)
    click('getObjectFromGUID("395037").setVar("engineLifeChange", true) return "patched"'),
    { msg: { t: "table", json: JSON.stringify(firstTable) }, mark: "game running: buttons hidden" },
    // Scoop beside each player's name (screen UI): someone else's does nothing; it opens the big box; Keep playing closes it; Scoop concedes
    { msg: { t: "table", json: JSON.stringify({ ...firstTable, players: firstTable.players.map((p) => ({ ...p, status: "playing" })) }) }, mark: "game running: Scoop buttons" },
    click('onMtgScoopAsk(Player.White, nil, "eng_scoop_Blue")'),
    click('onMtgScoopAsk(Player.Blue, nil, "eng_scoop_Blue")'),
    click('onMtgScoopNo(Player.Blue, nil, "eng_scoopno_Blue")'),
    click('onMtgScoopAsk(Player.Blue, nil, "eng_scoop_Blue")'),
    click('onMtgScoopYes(Player.White, nil, "eng_scoopyes_Blue")'),
    click('onMtgScoopYes(Player.Blue, nil, "eng_scoopyes_Blue")'),
    // a life counter's own button, clicked when nothing is being chosen
    click('engineLifeTrackerClick({ guid = "23e485", color = "Blue" })'),
    // a player who is out gets no Scoop button
    click('engineChat("mtg effects off", Player.White)'),
    { msg: { t: "table", json: JSON.stringify({ ...firstTable, players: firstTable.players.map((p) => ({ ...p, status: p.color === "Blue" ? "lost" : "playing" })) }) }, frames: 200, mark: "game running: Blue is out, no Scoop for Blue" },
    click('engineChat("mtg effects on", Player.White)'),
    { msg: { t: "table", json: JSON.stringify({ ...firstTable, gameOver: true, winner: "Blue" }) }, frames: 420, mark: "game over: NEW GAME" },
    click(`${tile} onMtgSetupStart(t, "White")`), // "mtg reset" is the host's
    click(`${tile} onMtgSetupStart(t, "Blue")`),
    click('local c, d = getObjectFromGUID("540e21"), getObjectFromGUID("ee33ec") return (c and tostring(c.getPosition().y < -5) or "no cannon") .. " " .. (d and tostring(d.getPosition().y < -5) or "no die")'),
    click('engineHideForEngine(true)'), // hidden twice: still goes back to where it stood
    click("setEngineMode(false)"), // the buttons go, the tile goes under the table
    click('local c, d = getObjectFromGUID("540e21"), getObjectFromGUID("ee33ec") return (c and tostring(c.getPosition().y < -5) or "no cannon") .. " " .. (d and tostring(d.getPosition().y < -5) or "no die")'),
    click("setEngineMode(true)"), // a new game checks decks again: both buttons are yellow
    click(`${tile} onMtgSetupEngine(t, "Blue")`), // the host turns engine mode off from the middle button
  ];
  // one player alone: Start plays against one Forge AI
  const solo = [click("setEngineMode(true)"), report(["Blue"], ["Blue"]),
    click('onMtgSetupReady(data.Blue.playmat, "Blue")'), // pressed again: not ready, the table buttons come back, no Start
    click(`${tile} onMtgSetupStart(t, "Blue")`), // (nothing: Start is gone)
    report(["Blue"], ["Blue"]), click(`${tile} onMtgSetupStart(t, "Blue")`)];
  return [{ name: "4-player game vs 3 AI (recorded)", steps: four }, { name: "1v1 with a player's clicks (recorded)", steps: one },
    { name: "setup buttons (Ready / Start)", steps: setup, seated: ["Blue", "White"] },
    { name: "setup buttons: one player starts against an AI", steps: solo, seated: ["Blue"] },
    { name: "card entry: every way a card object is made", steps: cardEntry(s1) }];
}

// (2026-11-06, docs/core-moves-cleanup-plan.md §3) every way an object becomes an engine card's object, on crafted boards
// after the 1v1's first one: creatures with a status box, a P/T box under an anthem and abilities die into a 2-card
// graveyard and come back (engineTakeFromPiles); a searched double-faced card pulled from the library and played; a
// graveyard card picked for a question; "mtg reset" one frame after a board starts spawning.
function cardEntry(s1) {
  const first = s1.findIndex((m) => m.t === "table");
  const steps = [click("engineAutoPace.Blue = false"), click('engineChat("mtg start ai 1", Player.Blue)'),
    ...s1.slice(0, first + 1).map((m) => ({ msg: { t: m.t, json: m.json } }))];
  const base = JSON.parse(s1[first].json);
  delete base.cards;
  const back = "https://steamusercontent-a.akamaihd.net/ugc/2442730426865822027/35EF6E87970E2A5D6581E7D96A99F8A575B7A15F/";
  const id = (n) => `engine-card-${n}`;
  const statics = {
    [id(7001)]: { n: "Serra Angel", f: "https://img.example/serra.jpg", b: back, tl: "Creature — Angel", cmc: 5, ty: ["Creature"], bp: 4, bt: 4 },
    [id(7002)]: { n: "Grizzly Bears", f: "https://img.example/bears.jpg", b: back, tl: "Creature — Bear", cmc: 2, ty: ["Creature"], bp: 2, bt: 2 },
    [id(7003)]: { n: "Glorious Anthem", f: "https://img.example/anthem.jpg", b: back, tl: "Enchantment", cmc: 3, ty: ["Enchantment"] },
    [id(7004)]: { n: "Prodigal Sorcerer", f: "https://img.example/tim.jpg", b: back, tl: "Creature — Human Wizard", cmc: 3, ty: ["Creature"], bp: 1, bt: 1 },
    [id(7005)]: { n: "Royal Assassin", f: "https://img.example/assassin.jpg", b: back, tl: "Creature — Human Assassin", cmc: 3, ty: ["Creature"], bp: 1, bt: 1 },
    [id(7010)]: { n: "Island", f: "https://img.example/island.jpg", b: back, tl: "Basic Land — Island", cmc: 0, ty: ["Land"] },
    [id(7011)]: { n: "Swamp", f: "https://img.example/swamp.jpg", b: back, tl: "Basic Land — Swamp", cmc: 0, ty: ["Land"] },
  };
  const angel = { s: 1, id: id(7001), p: 4, t: 4, ctl: "Blue", kw: ["Hexproof"], ow: ["Flying", "Vigilance"] };
  const bears = { s: 1, id: id(7002), p: 3, t: 3, ctl: "Blue" }; // (2/2, raised by the anthem)
  const anthem = { s: 1, id: id(7003), ctl: "Blue" };
  const tim = { s: 1, id: id(7004), p: 1, t: 1, ctl: "Blue" };
  const assassin = { s: 1, id: id(7005), p: 1, t: 1, ctl: "Blue" };
  const gy = (n) => ({ s: 1, id: id(n), ctl: "Blue" });
  const board = (blue, extra = {}) => {
    const t = JSON.parse(JSON.stringify(base));
    Object.assign(t, extra);
    Object.assign(t.players.find((p) => p.color === "Blue"), blue);
    return { t: "table", json: JSON.stringify(t) };
  };
  const ask = (p) => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", ...p }) } });
  const pass = { id: "__pass", label: "Pass priority" };
  const ability = (n, text) => ({ id: `a-${n}`, cardId: id(n), label: `${statics[id(n)].n}: ${text}`, ab: text });
  const objOf = (cid) => `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${cid}" then o = x end end`;
  // (a report tests/test_table_claims.js reads by its name)
  const rep = (name, lua) => ({ lua, mark: `ce: ${name}` });
  // the members of a pile or library deck the table built: Locked or Tags set on any (none should have either), and
  // whether the deck's DeckIDs are its members' CardIDs in order (TTS shows each member by its DeckIDs entry)
  const members = (name, gm) => rep(name, `local d for _, x in ipairs(getObjects()) do if x.getGMNotes() == "${gm}" then d = x end end if d == nil then return "no deck" end
    local data = d.getData() local list, ids = data.ContainedObjects or {}, data.DeckIDs or {} local match = #ids == #list
    local out, plain, flags = {}, 0, 0 for i, e in ipairs(list) do if ids[i] ~= e.CardID then match = false end
      if e.GMNotes == "libcard" then plain = plain + 1 if e.Locked or e.Tags then flags = flags + 1 end
      else out[#out + 1] = tostring(e.GMNotes):gsub("^engine:engine%-card%-", "") .. (e.Locked and " Locked" or "") .. (e.Tags and " Tags" or "") end end
    return table.concat(out, ", ") .. " + " .. plain .. " plain backs (" .. flags .. " with Locked or Tags) | DeckIDs " .. (match and "match" or "differ") .. " (" .. #ids .. ")"`);
  // each card's object and the labels of the buttons on it (the badges and the ability buttons)
  const buttons = (name, ns) => rep(name, `local out = {} for _, n in ipairs({ ${ns.join(", ")} }) do local cid = "engine-card-" .. n local o
    for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:" .. cid then o = x end end
    local labels = {} if o then for _, b in ipairs(o.getButtons() or {}) do labels[#labels + 1] = (tostring(b.label):gsub("\\n", "/")) end end
    out[#out + 1] = n .. (o and (" [" .. table.concat(labels, "; ") .. "]") or " none") end return table.concat(out, " | ")`);
  const debug = (name, ns) => rep(name, `local out = {} for _, n in ipairs({ ${ns.join(", ")} }) do out[#out + 1] = n .. " " .. engineDebugCard("engine-card-" .. n) end return table.concat(out, " | ")`);
  const badges = (name, ns) => rep(name, `local out = {} for _, n in ipairs({ ${ns.join(", ")} }) do out[#out + 1] = n .. " " .. tostring(engineBadge["engine-card-" .. n]) end return table.concat(out, " | ")`);
  const backOf = (name, n) => rep(name, `${objOf(id(n))} if o == nil then return "none" end for _, e in pairs(o.getData().CustomDeck or {}) do return e.BackURL end return "no deck"`);
  const all = [7001, 7002, 7004, 7005];
  steps.push(ask({ promptId: null }),
    // 1. the creatures on the battlefield, two cards already in the graveyard (a pile deck)
    { msg: board({ battlefield: [angel, bears, anthem, tim, assassin], graveyard: [gy(7010), gy(7011)] }, { cards: statics }), frames: 60, mark: "entry: the board" },
    buttons("buttons on the board", all), members("graveyard members", "engine:graveyard:Blue"),
    // (the Assassin's ability on screen when it dies; the Sorcerer's not)
    ask({ promptId: 2001, kind: "priority", title: "Your priority", mode: "single", min: 1, max: 1, options: [ability(7005, "{T}: Destroy target tapped creature."), pass] }),
    buttons("buttons at the first priority", all),
    { msg: board({ battlefield: [anthem], graveyard: [gy(7010), gy(7011), gy(7001), gy(7002), gy(7004), gy(7005)] }), frames: 60, mark: "entry: four die into the 2-card graveyard" },
    ask({ promptId: 2002, kind: "priority", title: "Your priority", mode: "single", min: 1, max: 1, options: [pass] }),
    ask({ promptId: null }),
    debug("in the pile", all), badges("badges kept in the pile", all),
    // 2. all four come back (taken out of the pile deck): the status box, the P/T box, then the abilities at priority
    { msg: board({ battlefield: [angel, bears, anthem, tim, assassin], graveyard: [gy(7010), gy(7011)] }), frames: 60, mark: "entry: the four return from the graveyard" },
    debug("back from the pile", all), buttons("buttons back from the pile", all),
    ask({ promptId: 2003, kind: "priority", title: "Your priority", mode: "single", min: 1, max: 1,
      options: [ability(7004, "{T}: Prodigal Sorcerer deals 1 damage to any target."), ability(7005, "{T}: Destroy target tapped creature."), pass] }),
    buttons("buttons at priority after the return", all),
    ask({ promptId: null }));
  // 3. a library search: the double-faced card pulled out of the library deck (its plain back there), then played
  const delver = { n: "Delver of Secrets", f: "https://img.example/delver.jpg", b: "https://img.example/insectile.jpg", tl: "Creature — Human Wizard", cmc: 1, ty: ["Creature"], bp: 1, bt: 1 };
  const opt = { n: "Opt", f: "https://img.example/opt.jpg", b: back, tl: "Instant", cmc: 1, ty: ["Instant"] };
  const field = [angel, bears, anthem, tim, assassin];
  steps.push(ask({ promptId: 2004, kind: "cards", title: "Demonic Tutor: choose a card", mode: "multi", min: 0, max: 1,
      cards: { [id(7020)]: delver, [id(7021)]: opt }, librarySearch: [{ s: 1, id: id(7020) }, { s: 1, id: id(7021) }],
      options: [{ id: id(7020), label: "Delver of Secrets" }, { id: id(7021), label: "Opt" }] }),
    members("library members during the search", "engine:library:Blue"),
    rep("the searched card pulled out", `local lib for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:library:Blue" then lib = x end end
      if lib == nil then return "no library" end
      local at for _, e in ipairs(lib.getObjects()) do if e.gm_notes == "engine:${id(7020)}" then at = e.index end end
      if at == nil then return "not in the library" end
      local o = lib.takeObject({ index = at, position = lib.getPosition() + Vector(0, 2, 0), smooth = false })
      local bk = "none" for _, e in pairs(o.getData().CustomDeck or {}) do bk = e.BackURL end
      return tostring(o.getGMNotes()) .. " back " .. bk .. " | " .. engineDebugCard("${id(7020)}")`),
    // (the board before the question closes: a close first redraws the old board, which throws the loose card away)
    { msg: board({ battlefield: [...field, { s: 1, id: id(7020), p: 1, t: 1, ctl: "Blue" }], graveyard: [gy(7010), gy(7011)], library: 91 }), frames: 60, mark: "entry: the searched card played" },
    backOf("back of the searched card", 7020), debug("the searched card", [7020]),
    ask({ promptId: null }),
    // (a double-faced card turned over by its owner: the table shows the back it recorded)
    { msg: board({ battlefield: [...field, { s: 1, id: id(7020), p: 1, t: 1, ctl: "Blue" }], graveyard: [gy(7010), gy(7011)], library: 91 }), frames: 10, mark: "entry: the searched card, next board" },
    backOf("back of the searched card, next board", 7020), debug("the searched card, next board", [7020]));
  // 4. a graveyard card picked for a question (pulled out of the pile deck), then put in the hand
  const field2 = [...field, { s: 1, id: id(7020), p: 1, t: 1, ctl: "Blue" }];
  const hand = base.players.find((p) => p.color === "Blue").hand;
  steps.push(ask({ promptId: 2005, kind: "cards", title: "Choose a land card in your graveyard", mode: "multi", min: 1, max: 1,
      pileChoices: [id(7010), id(7011)], options: [{ id: id(7010), label: "Island" }, { id: id(7011), label: "Swamp" }] }),
    rep("the picked card pulled out", `local pile for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:graveyard:Blue" then pile = x end end
      if pile == nil then return "no pile" end
      local at for _, e in ipairs(pile.getObjects()) do if e.gm_notes == "engine:${id(7010)}" then at = e.index end end
      if at == nil then return "not in the pile" end
      pile.takeObject({ index = at, position = pile.getPosition() + Vector(0, 2, 0), smooth = false })
      return engineDebugCard("${id(7010)}")`),
    ask({ promptId: null }),
    { msg: board({ battlefield: field2, graveyard: [gy(7011)], hand: [...hand, gy(7010)], handCount: hand.length + 1, library: 91 }), frames: 200, mark: "entry: the picked card goes to the hand" },
    { msg: board({ battlefield: field2, graveyard: [gy(7011)], hand: [...hand, gy(7010)], handCount: hand.length + 1, library: 91 }), frames: 10, mark: "entry: the same board again" },
    debug("the picked card in the hand", [7010, 7011]));
  // 4b. a card spawned on its own is in no pile; a pile that takes the card in while it still spawns keeps it marked
  // in the pile when the late spawn callback comes (review round 2)
  const more = { [id(7040)]: { ...statics[id(7010)], n: "Forest", f: "https://img.example/forest.jpg" }, [id(7041)]: { ...statics[id(7010)], n: "Mountain", f: "https://img.example/mountain.jpg" },
    [id(7042)]: { ...statics[id(7002)], n: "Wild Mongrel", f: "https://img.example/mongrel.jpg" } };
  const rest = { hand: [...hand, gy(7010)], handCount: hand.length + 1, library: 91 };
  const field3 = [...field2, gy(7040)];
  const late = 'local d for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:graveyard:Blue" then d = x end end if d == nil then return "no pile" end'
    + ` local loose = 0 for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id(7042)}" then loose = loose + 1 end end`
    + ` for _, e in ipairs(d.getData().ContainedObjects or {}) do if e.GMNotes == "engine:${id(7042)}" then return "in the pile" .. (e.Locked and " Locked" or "") .. (e.Tags and " Tags" or "") .. ", loose objects " .. loose end end`
    + ' return "not in the pile, loose objects " .. loose';
  steps.push({ msg: board({ battlefield: field2, graveyard: [gy(7011), gy(7040), gy(7041)], ...rest }, { cards: more }), frames: 60, mark: "entry: three cards in the graveyard" },
    // (Forest leaves and the other two change order: the pile is rebuilt, and Forest is spawned on its own)
    { msg: board({ battlefield: field3, graveyard: [gy(7041), gy(7011)], ...rest }), frames: 60, mark: "entry: one leaves, the pile is rebuilt" },
    debug("the card that left the rebuilt pile", [7040]),
    { msg: board({ battlefield: [...field3, { s: 1, id: id(7042), p: 2, t: 2, ctl: "Blue" }], graveyard: [gy(7041), gy(7011)], ...rest }), frames: 0, mark: "entry: a creature starts spawning" },
    { ...debug("the creature spawning", [7042]), frames: 0 },
    // (it dies before its object arrives: the pile takes it in, then the late callback comes)
    { msg: board({ battlefield: field3, graveyard: [gy(7041), gy(7011), gy(7042)], ...rest }), frames: 60, mark: "entry: it dies while spawning" },
    debug("the creature in the pile after its late callback", [7042]), rep("the late creature in the pile", late),
    { msg: board({ battlefield: field3, graveyard: [gy(7041), gy(7011), gy(7042)], ...rest }), frames: 60, mark: "entry: the same board again (late creature)" },
    debug("the late creature, next board", [7042]), rep("the late creature in the pile, next board", late));
  // 5. "mtg reset" one frame after a board starts spawning: which objects the late spawn callbacks register, and what
  // they do to them (they were swept into the trash by then); the library deck too, rebuilt as a search closed
  const fresh = { [id(7030)]: { ...statics[id(7002)], n: "Llanowar Elves" }, [id(7031)]: { ...statics[id(7002)], n: "Elvish Mystic" }, [id(7032)]: { ...statics[id(7002)], n: "Fyndhorn Elves" } };
  steps.push(ask({ promptId: 2006, kind: "cards", title: "Search your library for an instant", mode: "multi", min: 0, max: 1,
      cards: { [id(7021)]: opt }, librarySearch: [{ s: 1, id: id(7021) }], options: [{ id: id(7021), label: "Opt" }] }),
    { ...ask({ promptId: null }), frames: 0 },
    { msg: board({ battlefield: [...field3, ...[7030, 7031, 7032].map((n) => ({ s: 1, id: id(n), p: 1, t: 1, ctl: "Blue" }))], graveyard: [gy(7041), gy(7011), gy(7042)], ...rest },
      { cards: fresh }), frames: 0, mark: "reset: a board starts spawning" },
    // (the spawning objects note every call made on them once they are destroyed: in TTS each such call is an error)
    { ...rep("the spawning objects", `__ceCalls = {} local n = 0 for _, x in ipairs(getObjects()) do local gm = tostring(x.getGMNotes()) if gm:find("^engine:engine%-card%-703") or gm == "engine:library:Blue" then n = n + 1
        for _, name in ipairs({ "getGMNotes", "setLock", "setScale", "setPosition", "setPositionSmooth", "setRotation", "setRotationSmooth", "createButton", "clearButtons", "editButton", "setColorTint", "highlightOn", "highlightOff", "addContextMenuItem", "UI" }) do
          local orig = x[name] if type(orig) == "function" then rawset(x, name, function(...) if x.isDestroyed() then __ceCalls[#__ceCalls + 1] = gm:sub(-4) .. "." .. name end return orig(...) end) end end end end
      return n .. " spawning"`), frames: 0 },
    // (and one the reset's sweep doesn't see, as if TTS listed it a frame late: Fyndhorn Elves)
    { ...rep("hidden from the sweep", `for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id(7032)}" then x.setGMNotes("ce-unlisted") return "hidden" end end return "none"`), frames: 0 },
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 0, mark: "reset: mtg reset one frame later" },
    { ...rep("listed again", `for _, x in ipairs(getObjects()) do if x.getGMNotes() == "ce-unlisted" then x.setGMNotes("engine:${id(7032)}") return "listed" end end return "none"`), frames: 0 },
    rep("after the reset", `__sim.frames(120) local out = {} for _, n in ipairs({ 7030, 7031, 7032 }) do out[#out + 1] = n .. " " .. engineDebugCard("engine-card-" .. n) end
      local live = 0 for _, x in ipairs(getObjects()) do if tostring(x.getGMNotes()):find("^engine:engine") then live = live + 1 end end
      return table.concat(out, " | ") .. " | library " .. engineDebugCard("library:Blue") .. " | engine cards on the table: " .. live .. " | calls on destroyed objects: " .. (#__ceCalls > 0 and table.concat(__ceCalls, " ") or "none")`));
  // 6. (2026-11-06, real table) a library growing by several plain cards at once (the debug setup's dealt hand put on
  // the bottom, a London mulligan's bottom cards): the cards must end up IN the library deck, nothing lying on it; a
  // library destroyed meanwhile leaves nothing behind; "mtg reset" sweeps a deck of plain backs TTS formed by itself
  // (the library deck: its size, its plain backs and how many pictures they use; plain cards and decks of nothing but
  // plain backs lying anywhere else; the one mixed deck the case lays down)
  const lib = (name) => rep(name, `local lib, loose, decks, mixed = nil, 0, 0, "no" for _, x in ipairs(getObjects()) do local gm = tostring(x.getGMNotes())
      if gm == "engine:library:Blue" then lib = x elseif gm == "libcard" and x.type == "Card" then loose = loose + 1
      elseif x.getName() == "ce-mixed" then mixed = "yes " .. x.getQuantity()
      elseif x.type == "Deck" and not gm:find("^engine") then local all, n = true, 0 for _, e in ipairs(x.getObjects()) do n = n + 1 if e.gm_notes ~= "libcard" then all = false end end if all and n > 0 then decks = decks + 1 end end end
    local plain, pics = 0, {} if lib then for _, e in ipairs(lib.getObjects()) do if e.gm_notes == "libcard" then plain = plain + 1 end end
      for _, e in ipairs(lib.getData().ContainedObjects or {}) do pics[tostring(e.CardID)] = true end end
    local np = 0 for _ in pairs(pics) do np = np + 1 end
    return "library " .. (lib and (lib.type .. " " .. lib.getQuantity() .. " (" .. plain .. " plain backs, " .. np .. " picture)") or "none") .. " | loose plain cards " .. loose .. " | decks of plain backs off the library " .. decks .. " | mixed deck " .. mixed`);
  const libBoard = (n, mark, frames = 60) => ({ msg: board({ library: n }), frames, mark });
  // ("started" first, as a real game sends it: engine mode is on, so the table's refusals of puts into its own decks apply)
  const started = s1.find((m) => m.t === "started");
  steps.push(click('engineChat("mtg start ai 1", Player.Blue)'), { msg: { t: started.t, json: started.json } },
    { msg: { t: s1[first].t, json: s1[first].json }, mark: "library: a new game" },
    rep("engine mode in the library part", "return tostring(ENGINE_MODE)"),
    libBoard(92, "library: the first board again"), lib("library at the start"),
    libBoard(93, "library: one card put on the bottom"), lib("library after one card"),
    libBoard(100, "library: seven cards put on the bottom at once"), lib("library after seven at once"),
    // (the library deck destroyed before the added cards arrive: they go, and the next board builds the library again)
    libBoard(103, "library: three more, the library destroyed meanwhile", 0),
    // (what the three are spawned as, before they arrive: one object, the library's plain backs, not a second library)
    { ...rep("the added cards on their way", `local out = {} for _, x in ipairs(getObjects()) do if x.getName() == "Library card" then local gms = {} for _, e in ipairs(x.type == "Deck" and x.getObjects() or {}) do gms[e.gm_notes] = (gms[e.gm_notes] or 0) + 1 end
        local inside = {} for g, n in pairs(gms) do inside[#inside + 1] = n .. " " .. g end
        out[#out + 1] = x.type .. " " .. tostring(x.getGMNotes()) .. " locked=" .. tostring(x.getLock()) .. (#inside > 0 and (" of " .. table.concat(inside, ", ")) or "") end end return table.concat(out, " | ")`), frames: 0 },
    { ...rep("the library destroyed", `for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:library:Blue" then x.destruct() return "destroyed" end end return "no library"`), frames: 60 },
    lib("library destroyed while cards were added"),
    libBoard(103, "library: the next board"), lib("library on the next board"),
    // (jr-programmer-suite) a double-faced card put into the hand: the bridge sends a hand card with the plain back
    // while its details have its other face as the back. The face recorded is the one the object shows (the board's),
    // so the next board keeps the object instead of replacing it
    { msg: board({ library: 103, hand: [...hand, { s: 1, id: id(7050), b: back }], handCount: hand.length + 1 }, { cards: { [id(7050)]: { ...delver, n: "Huntmaster of the Fells" } } }), frames: 60, mark: "entry: a double-faced card put into the hand" },
    debug("the drawn double-faced card", [7050]),
    { msg: board({ library: 103, hand: [...hand, { s: 1, id: id(7050), b: back }], handCount: hand.length + 1 }), frames: 60, mark: "entry: the same board again (double-faced card)" },
    debug("the drawn double-faced card, next board", [7050]),
    // (a stray deck of seven plain backs with no GM notes on the library, as TTS formed one on the real table)
    rep("a stray deck of plain backs", `local l for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:library:Blue" then l = x end end if l == nil then return "no library" end
      local d = l.getData() local m = d.ContainedObjects[1] local objs, ids = {}, {}
      for i = 1, 7 do objs[i] = { Name = "Card", Nickname = m.Nickname, GMNotes = m.GMNotes, CardID = m.CardID, CustomDeck = m.CustomDeck } ids[i] = m.CardID end
      spawnObjectData({ data = { Name = "Deck", Nickname = "", GMNotes = "", DeckIDs = ids, CustomDeck = d.CustomDeck, ContainedObjects = objs }, position = l.getPosition() + Vector(0, 1, 0) })
      -- (and a deck that is not only plain backs, a player's own card among them: the reset must leave it alone)
      local mixed = {} for i = 1, 6 do mixed[i] = objs[i] end mixed[7] = { Name = "Card", Nickname = "a player's card", GMNotes = "", CardID = m.CardID, CustomDeck = m.CustomDeck }
      spawnObjectData({ data = { Name = "Deck", Nickname = "ce-mixed", GMNotes = "", DeckIDs = ids, CustomDeck = d.CustomDeck, ContainedObjects = mixed }, position = Vector(0, 1, 0) })
      return "spawned " .. tostring(m.GMNotes)`),
    lib("library with the stray deck"),
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 90, mark: "library: mtg reset" },
    lib("library after the reset"));
  return steps;
}


function runAll(save = buildSave()) {
  return scenarios().map((sc) => {
    const r = simulate({ save, steps: sc.steps, ...(sc.seated ? { seated: sc.seated } : {}) });
    return { name: sc.name, errors: r.errors, steps: r.steps };
  });
}

module.exports = { runAll, buildSave, scenarios };
