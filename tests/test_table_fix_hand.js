// Manual fix, "fix from hand" (docs/m7-manual-fix-spec.md §12; table side, tools/engine-renderer.lua), on the fake TTS:
// the kind question once paused (cards stay locked until "Edit the board"), each player's Engine panel listing their
// own hand and permanents with Cast free / Activate free / Play land / To graveyard, picks in one ordered list (move up,
// down, take out; one per card; only by their owner), notes (box and chat), Done's message (tmp/fix-from-hand-table.md),
// a refusal keeping the picks, applying not holding the board, and a fresh list per fix.
//   node tests/test_table_fix_hand.js        (TABLE_SAVE=<save.json> to test a given save)
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
const s1 = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "table-stream-1v1.json"), "utf8"));
const prefix = [{ lua: 'engineChat("mtg start ai 1", Player.Blue)' }, ...s1.slice(0, 40).map((m) => ({ msg: { t: m.t, json: m.json } }))];
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const q = (lua, mark) => ({ lua, mark });

// a board with crafted cards (full details, no statics needed): Blue's hand and permanents, White's hand
const card = (id, n, ty, tx, more = {}) => ({ id: `engine-card-${id}`, n, ty, tx, tl: ty.join(" "), cmc: 1, ctl: more.ctl || "Blue", ...more });
const H = {
  teferi: card(9801, "Teferi's Protection", ["Instant"], "Until your next turn, your life total can't change ..."),
  forest: card(9802, "Forest", ["Land"], "({T}: Add {G}.)"),
  cycler: card(9803, "Cycler Beast", ["Creature"], "Cycling {2} ({2}, Discard this card: Draw a card.)", { p: 3, t: 3 }),
  boseiju: card(9804, "Boseiju, Who Endures", ["Land"], "{T}: Add {G}.\nChannel — {1}{G}, Discard Boseiju, Who Endures: Destroy target artifact."),
};
const B = {
  mana: card(9811, "Llanowar Elves", ["Creature"], "{T}: Add {G}.", { p: 1, t: 1 }),
  draw: card(9812, "Arcane Engine", ["Artifact"], "{2}, {T}: Draw a card."),
  walker: card(9813, "Test Walker", ["Planeswalker"], "+1: Draw a card.\n−3: Destroy target creature."),
  sword: card(9814, "Test Sword", ["Artifact"], "Equipped creature gets +1/+1.\nEquip {2}"),
  vanilla: card(9815, "Grizzly Bears", ["Creature"], "", { p: 2, t: 2 }),
  stolen: card(9816, "Borrowed Engine", ["Artifact"], "{1}, {T}: Draw a card.", { ctl: "White" }), // (Blue's, White controls it)
};
const W = { bolt: card(9821, "Lightning Bolt", ["Instant"], "Lightning Bolt deals 3 damage to any target.", { ctl: "White" }) };
const WB = card(9822, "Hill Giant", ["Creature"], "", { ctl: "White", p: 3, t: 3 }); // (an opponent's permanent: locked in play)
const base = JSON.parse(s1[38].json);
const board = (fix, edit) => {
  const b = JSON.parse(JSON.stringify(base));
  for (const p of b.players) {
    if (p.color === "Blue") { p.hand = Object.values(H); p.battlefield = Object.values(B); p.keep = ["graveyard", "exile", "command"]; }
    if (p.color === "White") { p.hand = Object.values(W); p.battlefield = [WB]; p.keep = ["graveyard", "exile", "command"]; }
  }
  if (edit) edit(b);
  if (fix) b.fix = fix;
  return { msg: { t: "table", json: JSON.stringify(b) }, frames: 6 };
};
const id = (c) => c.id;

// Lua probes
const sentLog = 'local real = engineSend __sent = {} engineSend = function(t, p) if t == "fix" then __sent[#__sent + 1] = JSON.encode(p) end return real(t, p) end';
const lastSent = q("local s = __sent[#__sent] __sent = {} return s or 'none'", "sent");
const rows = (c, mark) => q(`local out = {} for k = 1, 30 do if UI.getAttribute("eng_opt_${c}_" .. k, "active") == "true" then out[#out + 1] = k .. "=" .. tostring(UI.getAttribute("eng_opt_${c}_" .. k, "text")) end end return table.concat(out, "|")`, mark);
const panel = (c, mark) => q(`local t, y, n, a = engineFixPanel(engineFix, "${c}") return t .. " #yes=" .. tostring(y) .. " #no=" .. tostring(n) .. " #alt=" .. tostring(a)`, mark);
// the board-editing tools on a card: its "Fix: top / bottom of its library" menu items (added when the cards unlock)
const lockOf = (cid, mark) => q(`for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${cid}" then local n = 0 for _, m in ipairs(x.__d.menu or {}) do if tostring(m.label):find("^Fix:") then n = n + 1 end end return tostring(n) end end return "none"`, mark);
// a pick-up of an engine card counts as a board edit (engineFixTouched) only while editing the board
const touch = (cid, mark) => q(`for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${cid}" then onPlayerAction(Player.Blue, Player.Action.PickUp, { x }) return tostring(engineFixTouched["${cid}"]) end end return "none"`, mark);
const attr = (idv, k, mark) => q(`return tostring(UI.getAttribute("${idv}", "${k}"))`, mark);
const value = (idv, mark) => q(`return tostring(UI.getValue("${idv}"))`, mark);
const slotOf = (c, text) => `(function() for k = 1, 30 do if UI.getAttribute("eng_opt_${c}_" .. k, "active") == "true" and tostring(UI.getAttribute("eng_opt_${c}_" .. k, "text")):find(${JSON.stringify(text)}, 1, true) then return k end end return 0 end)()`;
const click = (c, text, mark) => q(`local k = ${slotOf(c, text)} if k == 0 then return "no row ${text.replace(/"/g, "")}" end onMtgSlot(Player.${c}, nil, "eng_opt_${c}_" .. k) __sim.frames(2) return "clicked " .. k`, mark);
const told = (r, mark) => ((r.steps.find((s) => s.step === mark) || {}).fx || []).filter((l) => l.includes("broadcastToColor")).join(" | ");

const fix5 = { id: 5, state: "editing", by: "Blue", waiting: [] };
const r = simulate({ save, seated: ["Blue", "White"], steps: [...prefix,
  q(sentLog, "wrap"), board(null), q("return 'drawn'", "drawn"),
  // the pause: the kind question
  { ...board(fix5), mark: "paused" }, panel("Blue", "kind panel"), attr("eng_fixbk_Blue", "active", "kind alt shown"),
  q("return tostring(ENGINE_FIX_EDIT)", "edit before"), lockOf(id(WB), "lock before"), touch(id(B.vanilla), "touch before"),
  q('onMtgFix(Player.Blue, nil, "eng_fixbyes_Blue")', "choose hand"), lastSent,
  panel("Blue", "hand panel"), attr("eng_fixbk_Blue", "active", "alt after"), q("return tostring(ENGINE_FIX_EDIT)", "edit after"),
  lockOf(id(WB), "lock after"), touch(id(B.vanilla), "touch after"), attr("eng_panel_Blue", "active", "engine panel"), value("eng_title_Blue", "title"),
  attr("eng_search_Blue", "placeholder", "placeholder"), rows("Blue", "blue rows"), rows("White", "white rows"),
  // nothing picked: Done says so and sends nothing
  q('onMtgConfirm(Player.Blue, nil, "eng_confirm_Blue")', "empty done"), lastSent,
  // picks
  click("Blue", "Cast free: Teferi's Protection", "pick teferi"), click("Blue", "Play land: Forest", "pick forest"),
  click("Blue", "To graveyard: Cycler Beast", "pick cycler"), click("Blue", "Activate free: Arcane Engine", "pick engine"),
  click("White", "Cast free: Lightning Bolt", "white picks"), rows("Blue", "rows after picks"), lastSent,
  // Blue can't move White's line; Blue moves the cycler up and takes Teferi out, then puts it back (last)
  click("Blue", "5. AI 1 casts", "blue clicks white's line"),
  click("Blue", "3. Blue puts Cycler Beast", "select cycler"), rows("Blue", "selected rows"), click("Blue", "Move up", "move up"),
  click("Blue", "1. Blue casts Teferi", "select teferi"), click("Blue", "Take it out", "take out"), rows("Blue", "after take out"),
  click("Blue", "Cast free: Teferi's Protection", "pick teferi again"),
  // notes: chat (case kept), then White's box
  q('engineChat("mtg fix note Teferi SHOULD have phased out", Player.Blue)', "chat note"),
  q('onMtgSearch(Player.White, "Bolt was countered wrongly ", "eng_search_White")', "box note"),
  value("eng_fixtext_Blue", "list text"),
  q('onMtgConfirm(Player.Blue, nil, "eng_confirm_Blue")', "done"), lastSent,
  // review: the hand list goes away, the panel is the questions' panel again
  { ...board({ id: 5, state: "review", by: "Blue", waiting: ["White"], lines: ["Blue casts Teferi's Protection for free"] }), mark: "review" },
  attr("eng_panel_Blue", "active", "panel in review"), value("eng_title_Blue", "title in review"), attr("eng_search_Blue", "placeholder", "placeholder in review"),
  // refused: back to editing (same fix id, the bridge sends no kind), the picks are kept
  { ...board({ id: 5, state: "editing", by: "Blue", waiting: [], message: "Arcane Engine has no ability to activate" }), mark: "refused" },
  panel("Blue", "refused panel"), rows("Blue", "refused rows"),
  // a pick whose card left the hand is taken out at Done
  { ...board({ id: 5, state: "editing", by: "Blue", waiting: [] }, (b) => { b.players.find((p) => p.color === "Blue").hand = [H.forest, H.cycler, H.boseiju]; }), mark: "teferi gone" },
  q('onMtgFix(Player.Blue, nil, "eng_fixbyes_Blue")', "done again"), lastSent,
  // applying a hand fix: the board is drawn (the Forest goes onto the battlefield); then the fix ends
  q(`local p = engineContainHome("${id(H.forest)}") return p and string.format("%.1f %.1f", p.x, p.z) or "none"`, "forest spot before"),
  { ...board({ id: 5, state: "applying", by: "Blue", waiting: [] }, (b) => { const p = b.players.find((x) => x.color === "Blue"); p.hand = [H.cycler, H.boseiju]; p.battlefield = [...Object.values(B), H.forest]; }), mark: "applying" },
  q(`local p = engineContainHome("${id(H.forest)}") return p and string.format("%.1f %.1f", p.x, p.z) or "none"`, "forest spot"),
  board(null), q("return tostring(engineFix)", "over"),
  // a new fix: asked again, empty list
  { ...board({ id: 6, state: "editing", by: "White", waiting: [] }), mark: "fix 6" }, panel("Blue", "fix 6 panel"),
  q('onMtgFix(Player.White, nil, "eng_fixbyes_White")', "white chooses hand"), lastSent, rows("Blue", "fix 6 rows"), panel("Blue", "fix 6 list"),
  q('engineChat("mtg fix note", Player.Blue)', "note off"),
  // the bridge's kind wins: board -> cards unlock, the hand list goes
  { ...board({ id: 6, state: "editing", kind: "board", by: "White", waiting: [] }), mark: "bridge says board" },
  q("return tostring(ENGINE_FIX_EDIT)", "edit board"), lockOf(id(WB), "lock board"), touch(id(B.vanilla), "touch board"), attr("eng_panel_Blue", "active", "panel board"),
  board(null),
  // a third fix: Edit the board from the kind question
  { ...board({ id: 7, state: "editing", by: "Blue", waiting: [] }), mark: "fix 7" },
  q('onMtgFix(Player.Blue, nil, "eng_fixbk_Blue")', "choose board"), lastSent, q("return tostring(ENGINE_FIX_EDIT)", "edit 7"), lockOf(id(WB), "lock 7"),
  board(null),
  // many cards page with More...
  { ...board({ id: 8, state: "editing", kind: "hand", by: "Blue", waiting: [] }, (b) => {
    b.players.find((p) => p.color === "Blue").hand = Array.from({ length: 20 }, (_, i) => card(9850 + i, `Spell ${i + 1}`, ["Sorcery"], "Draw a card."));
  }), mark: "many" }, rows("Blue", "page 1"), click("Blue", "More...", "more"), rows("Blue", "page 2"),
] });

// a fix from hand in a later game: fix ids start at 1 again, and the kind picked for fix 9 of the last game isn't this
// one's; a land creature in hand is played, never cast
const arbor = card(9831, "Dryad Arbor", ["Land", "Creature"], "(Dryad Arbor isn't a spell.)", { p: 1, t: 1 });
// card lines of 99+ characters with no colon: "^([^:]*):" on them raised "pattern too complex" in TTS and the hand list
// never drew (live 2026-11-06, Flare of Duplication; tmp/pattern-trap/rule.md)
const flare = card(9832, "Flare of Duplication", ["Instant"], "If you control a nontoken red creature, you may sacrifice that creature rather than pay this spell's mana cost.\nCopy target instant or sorcery spell you control. You may choose new targets for the copy.");
const longEngine = card(9833, "Long Engine", ["Artifact"], `${"This artifact has a very long first line of rules text with no colon in it at all ".repeat(2)}\n{2}, {T}: Draw a card.`);
const r2 = simulate({ save, seated: ["Blue", "White"], steps: [...prefix,
  q(sentLog, "wrap"), board(null),
  { ...board({ id: 9, state: "editing", by: "Blue", waiting: [] }, (b) => { const p = b.players.find((x) => x.color === "Blue"); p.hand.push(arbor, flare); p.battlefield.unshift(longEngine); }), mark: "fix 9" },
  q('onMtgFix(Player.Blue, nil, "eng_fixbyes_Blue")', "choose hand 9"), rows("Blue", "arbor rows"),
  // a chat note longer than 200 characters is cut to 200
  q(`engineChat("mtg fix note ${"Long ".repeat(50)}end", Player.Blue)`, "long note"), click("Blue", "Play land: Dryad Arbor", "pick arbor"),
  q('onMtgConfirm(Player.Blue, nil, "eng_confirm_Blue")', "done 9"), lastSent,
  board(null),
  { ...board({ id: 9, state: "editing", by: "Blue", waiting: [] }), mark: "next game fix 9" }, panel("Blue", "next game panel"),
] });

// keepRewind (tmp/bridge-batch/lua-hunks.md): a board that leaves its unchanged restore points out keeps the last
// board's, the Undo button and an open rewind vote included, on the drawn path and through a board held by a fix; a
// board with neither (control) hides them, so the probes can see the difference
const pts = [{ id: 84, label: "turn 11, White's upkeep" }, { id: 82, label: "turn 10, Blue's second main phase" }];
const rvote = { id: 5, to: "turn 10, Blue's second main phase", by: "White", waiting: ["Blue"], status: "pending" };
const rwBoard = (extra, fix) => board(fix, (b) => { delete b.rewind; delete b.keepRewind; Object.assign(b, extra); });
const rwProbe = (mark) => q('local pts = (engineRewind and engineRewind.points) or {} return table.concat({ tostring(UI.getAttribute("eng_undo_Blue", "active")), tostring(UI.getAttribute("eng_vote_Blue", "active")), tostring(UI.getValue("eng_votetext_Blue")), tostring(#pts), tostring(pts[1] and pts[1].label) }, " | ")', mark);
const r3 = simulate({ save, seated: ["Blue", "White"], steps: [...prefix,
  rwBoard({ rewind: { points: pts, vote: rvote } }), rwProbe("rw full"),
  rwBoard({ keepRewind: true }), rwProbe("rw kept"),
  rwBoard({ keepRewind: true }, { id: 3, state: "review", by: "Blue", waiting: ["White"], lines: ["x"] }),
  rwBoard({ keepRewind: true }), rwProbe("rw kept after a held board"),
  rwBoard({}), rwProbe("rw control: none"),
] });

const v = (mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const vs = (mark) => r.steps.filter((s) => s.step === mark).map((s) => s.value);
const sent = vs("sent"); // in order: choose hand, empty done, after picks, done, done again, white chooses, choose board
ok("no script errors", r.errors.length === 0, r.errors.join(" | "));
// the kind question
ok("kind: the panel asks which kind", /Which kind of fix\?/.test(v("kind panel")) && /#yes=Fix from hand #no=Cancel #alt=Edit the board$/.test(v("kind panel")), v("kind panel"));
ok("kind: Edit the board shows", v("kind alt shown") === "true", v("kind alt shown"));
ok("kind: cards stay locked before a pick", v("edit before") === "false" && v("lock before") === "0", `${v("edit before")} ${v("lock before")}`);
ok("kind: the pick goes to the bridge", sent[0] === JSON.stringify({ action: "kind", color: "Blue", kind: "hand" }), sent[0]);
ok("hand: the panel says fix from hand, with Done / Cancel", /^FIX FROM HAND/.test(v("hand panel")) && /#yes=Done #no=Cancel #alt=nil$/.test(v("hand panel")) && /The list is empty/.test(v("hand panel")), v("hand panel"));
ok("hand: Edit the board goes away", v("alt after") === "false", v("alt after"));
ok("hand: cards stay locked, the board isn't editable", v("edit after") === "false" && v("lock after") === "0", `${v("edit after")} ${v("lock after")}`);
ok("hand: the Engine panel opens with the list", v("engine panel") === "true" && v("title") === "Fix from hand" && /^Note:/.test(v("placeholder")), `${v("engine panel")} ${v("title")} ${v("placeholder")}`);
const br = String(v("blue rows"));
const has = (s, t) => s.includes(`=${t}|`) || s.endsWith(`=${t}`);
for (const t of ["Cast free: Teferi's Protection", "To graveyard: Teferi's Protection", "Play land: Forest", "To graveyard: Forest",
  "Cast free: Cycler Beast", "Activate free: Cycler Beast", "To graveyard: Cycler Beast", "Activate free: Boseiju, Who Endures",
  "Play land: Boseiju, Who Endures", "Activate free: Arcane Engine (on the battlefield)", "Activate free: Test Walker (on the battlefield)",
  "Activate free: Test Sword (on the battlefield)"]) ok(`hand list: "${t}"`, has(br, t), br);
for (const t of ["Cast free: Forest", "Activate free: Teferi's Protection", "Play land: Teferi's Protection", "Cast free: Boseiju, Who Endures",
  "Activate free: Forest", "Llanowar Elves", "Grizzly Bears", "Lightning Bolt"]) ok(`hand list: no "${t}"`, !br.includes(t), br);
ok("a pick-up is no board edit before a kind is picked, nor in a fix from hand; it is in Edit the board", v("touch before") === "nil" && v("touch after") === "nil" && v("touch board") === "true", `${v("touch before")} ${v("touch after")} ${v("touch board")}`);
ok("a permanent you own but another player controls is theirs to activate", !br.includes("Borrowed Engine") && String(v("white rows")).includes("Activate free: Borrowed Engine (on the battlefield)"), `${br} || ${v("white rows")}`);
ok("hand list: only your own hand (White sees the Bolt, not Blue's cards)", String(v("white rows")).includes("Cast free: Lightning Bolt") && !String(v("white rows")).includes("Teferi"), v("white rows"));
ok("Done with nothing picked: told, nothing sent", sent[1] === "none" && /Nothing picked yet/.test(told(r, "empty done")), `${sent[1]} ${told(r, "empty done")}`);
// picks
const ap = String(v("rows after picks"));
ok("picks: the list in order, first", /^1=1\. Blue casts Teferi's Protection for free\|2=2\. Blue plays Forest for free \(the land drop stays unused\)\|3=3\. Blue puts Cycler Beast into their graveyard \(no effect\)\|4=4\. Blue activates Arcane Engine's ability for free\|5=5\. AI 1 casts Lightning Bolt for free\|/.test(ap), ap);
ok("picks: a picked card's buttons go (one pick per card)", !ap.includes("Cast free: Teferi's Protection") && !ap.includes("Activate free: Cycler Beast") && ap.includes("Activate free: Boseiju"), ap);
ok("picks: nothing is sent before Done", sent[2] === "none", sent[2]);
ok("picks: only the owner changes a line", /Only (White|AI 1) can move or take out that line/.test(told(r, "blue clicks white's line")), told(r, "blue clicks white's line"));
ok("picks: a selected line shows Move up / Move down / Take it out", /3=> 3\. Blue puts Cycler Beast[^|]*\|4= +Move up\|5= +Move down\|6= +Take it out of the list\|/.test(String(v("selected rows"))), v("selected rows"));
const at = String(v("after take out"));
ok("picks: moved up and taken out", /^1=1\. Blue puts Cycler Beast[^|]*\|2=2\. Blue plays Forest[^|]*\|3=3\. Blue activates Arcane Engine[^|]*\|4=4\. AI 1 casts Lightning Bolt/.test(at) && at.includes("Cast free: Teferi's Protection"), at);
ok("note: the chat note keeps its case", /Note: Teferi SHOULD have phased out/.test(told(r, "chat note")), told(r, "chat note"));
ok("note: the fix panel lists picks and notes", String(v("list text")).endsWith("The list:\n1. Blue puts Cycler Beast into their graveyard (no effect)\n2. Blue plays Forest for free (the land drop stays unused)\n3. Blue activates Arcane Engine's ability for free\n4. AI 1 casts Lightning Bolt for free\n5. Blue casts Teferi's Protection for free\nNote (Blue): Teferi SHOULD have phased out\nNote (AI 1): Bolt was countered wrongly"), v("list text"));
let done = null; try { done = JSON.parse(sent[3]); } catch { /* reported below */ }
ok("Done: the message", done && done.action === "done" && done.color === "Blue" && done.kind === "hand", sent[3]);
ok("Done: the ops in list order, colours as players", done && JSON.stringify(done.ops) === JSON.stringify([
  { card: id(H.cycler), op: "move", zone: "graveyard" }, { card: id(H.forest), op: "freeLand", player: "Blue" },
  { card: id(B.draw), op: "freeActivate", player: "Blue" }, { card: id(W.bolt), op: "freeCast", player: "White" },
  { card: id(H.teferi), op: "freeCast", player: "Blue" }]), done && JSON.stringify(done.ops));
ok("Done: the notes beside the ops, trimmed", done && JSON.stringify(done.notes) === JSON.stringify([{ color: "Blue", text: "Teferi SHOULD have phased out" }, { color: "White", text: "Bolt was countered wrongly" }]), done && JSON.stringify(done.notes));
// review / refusal
ok("review: the Engine panel closes and is the questions' panel again", v("panel in review") === "false" && v("title in review") !== "Fix from hand" && v("placeholder in review") === "Search...", `${v("panel in review")} ${v("title in review")} ${v("placeholder in review")}`);
ok("refused: the reason shows, still a fix from hand", /^FIX FROM HAND/.test(String(v("refused panel"))) && /The engine refused the last list: Arcane Engine has no ability to activate/.test(String(v("refused panel"))), v("refused panel"));
ok("refused: the picks are kept", /^1=1\. Blue puts Cycler Beast/.test(String(v("refused rows"))) && /5=5\. Blue casts Teferi's Protection/.test(String(v("refused rows"))), v("refused rows"));
let again = null; try { again = JSON.parse(sent[4]); } catch { /* reported below */ }
ok("Done: a pick whose card left the hand is taken out, its owner told", again && !again.ops.some((o) => o.card === id(H.teferi)) && again.ops.length === 4 && /Teferi's Protection isn't where it was/.test(told(r, "done again")), `${sent[4]} | ${told(r, "done again")}`);
ok("applying a hand fix: the board isn't held (the Forest gets its battlefield spot)", v("forest spot") !== "none" && v("forest spot") !== v("forest spot before"), `${v("forest spot before")} -> ${v("forest spot")}`);
ok("the fix ends", v("over") === "nil", v("over"));
ok("a new fix asks the kind again", /Which kind of fix\?/.test(String(v("fix 6 panel"))), v("fix 6 panel"));
ok("a new fix: White's pick is sent as White's", sent[5] === JSON.stringify({ action: "kind", color: "White", kind: "hand" }), sent[5]);
ok("a new fix starts with an empty list", /^1=Cast free: Teferi's Protection\|/.test(String(v("fix 6 rows"))), v("fix 6 rows"));
ok("mtg fix note alone takes the note out", /Note taken out/.test(told(r, "note off")), told(r, "note off"));
ok("the bridge's kind wins: board unlocks, the list goes", v("edit board") === "true" && v("lock board") === "2" && v("panel board") === "false", `${v("edit board")} ${v("lock board")} ${v("panel board")}`);
ok("Edit the board: sent, cards unlock", sent[6] === JSON.stringify({ action: "kind", color: "Blue", kind: "board" }) && v("edit 7") === "true" && v("lock 7") === "2", `${sent[6]} ${v("edit 7")} ${v("lock 7")}`);
const p1 = String(v("page 1")), p2 = String(v("page 2"));
ok("paging: 43 rows (40 for the hand, 3 permanents) page with More...", /\|30=More\.\.\. \(1-29 of 43\)$/.test(p1) && /^1=To graveyard: Spell 15\|/.test(p2) && /More\.\.\. \(30-43 of 43\)$/.test(p2), `${p1.slice(-80)} || ${p2.slice(0, 80)}`);

const v2 = (mark) => (r2.steps.find((s) => s.step === mark) || {}).value;
ok("later game: no script errors", r2.errors.length === 0, r2.errors.join(" | "));
const ar = String(v2("arbor rows"));
ok("a land creature: Play land, never Cast free", has(ar, "Play land: Dryad Arbor") && !ar.includes("Cast free: Dryad Arbor"), ar);
ok("long card lines: the hand list draws (Flare of Duplication), an ability after a long line is found", has(ar, "Cast free: Flare of Duplication") && ar.includes("=Activate free: Long Engine (on the battlefield)"), ar);
let d9 = null; try { d9 = JSON.parse((r2.steps.filter((s) => s.step === "sent").pop() || {}).value); } catch { /* reported below */ }
ok("note: cut to 200 characters", d9 && d9.notes && d9.notes.length === 1 && d9.notes[0].text === "Long ".repeat(40).trim(), d9 && JSON.stringify(d9.notes));
ok("a land creature: its pick is a free land play", d9 && JSON.stringify(d9.ops) === JSON.stringify([{ card: id(arbor), op: "freeLand", player: "Blue" }]), d9 && JSON.stringify(d9.ops));
ok("a new fix has no notes from the last one", /The list is empty\.$/.test(String(v("fix 6 list")).replace(/ #yes=.*$/, "")), v("fix 6 list"));
ok("a later game's fix with the same id asks the kind again", /Which kind of fix\?/.test(String(v2("next game panel"))), v2("next game panel"));
const v3 = (mark) => (r3.steps.find((s) => s.step === mark) || {}).value;
ok("keepRewind: no script errors", r3.errors.length === 0, r3.errors.join(" | "));
const full = String(v3("rw full"));
ok("keepRewind: precondition, the full board shows Undo and the vote", /^true \| true \| White asks to rewind/.test(full) && / \| 2 \| turn 11, White's upkeep$/.test(full), full);
ok("keepRewind: a board without rewind keeps the Undo button and the vote panel", v3("rw kept") === full, `${v3("rw kept")} (want ${full})`);
ok("keepRewind: also after a board held by a fix", v3("rw kept after a held board") === full, `${v3("rw kept after a held board")} (want ${full})`);
ok("keepRewind control: a board with neither hides them", /^false \| false \| .* \| 0 \| nil$/.test(String(v3("rw control: none"))), v3("rw control: none"));

console.log(failed ? `\n${failed} failed, ${passed} passed` : `all ${passed} fix-from-hand checks pass`);
process.exit(failed ? 1 : 0);
