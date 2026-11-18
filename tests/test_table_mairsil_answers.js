// The Mairsil hand test's answer and panel bugs on the table (docs/HAND-TEST-MAIRSIL.md, "Answers and panels" 16, 14,
// 13, 10, 4), on fengari with the fake TTS (tests/lua/tts-sim.lua), the prompts as the live bridge sent them:
//  16/14. A line picked in the Engine panel's list answers an exact pick at that click (onMtgSlot ->
//     engineConfirmIfComplete), as the card row and the table's cards do: Reanimate's target and Volrath's
//     Shapeshifter's discard cost waited for Done, which sits beside Cancel. A full exact pick left unanswered turns the
//     corner's "1 of 1 chosen" into a Done that sends it (engineUpdateCorner); it did nothing when pressed.
//  13. The search box is emptied for the next question (onMtgSearch keeps uiCache in step with what was typed).
//  10. Graveyard targets partly in a pile, more pictures than the card row holds: the Engine panel opens and the hint
//     says so (engineAnswerPlace), not "Click a glowing card".
//  4. A card choice partly in a graveyard pile (the bridge's pileChoices for those only): the hint gives both ways.
//   node tests/test_table_mairsil_answers.js        (TABLE_SAVE=<save.json> to test a given save)
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
const s1 = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "table-stream-1v1.json"), "utf8"));
const prefix = [{ lua: 'engineChat("mtg start ai 1", Player.Blue)' }, ...s1.slice(0, 40).map((m) => ({ msg: { t: m.t, json: m.json } }))];
const ask = (p) => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", ...p }) }, frames: 10 });
const q = (lua, mark) => ({ lua, mark });
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}`); } };
const run = (steps) => simulate({ save, steps: [...prefix, ...steps] });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const fxOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).fx || [];
// what the table sent the bridge in a step (the answer's JSON, unescaped: it is escaped twice on the way out)
const sentOf = (r, mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
const answered = (r, mark) => sentOf(r, mark).includes('"t":"answer"');
// Blue's last battlefield in the prefix: cards with objects on the table (a choice's card that isn't in a pile)
const blueBf = [];
for (const m of s1.slice(0, 40)) if (m.t === "table") { const pl = JSON.parse(m.json).players.find((x) => x.color === "Blue"); if (pl && pl.battlefield) blueBf.splice(0, blueBf.length, ...pl.battlefield.map((c) => c.id)); }

const img = "http://127.0.0.1:48787/img/x.jpg";
const inPile = (ids) => q(`for _, id in ipairs({ ${ids.map((i) => `"${i}"`).join(", ")} }) do engineInPile[id] = true end return "in pile"`, "pile");
const attr = (id, a) => `tostring(UI.getAttribute("${id}", "${a}"))`;
// Reanimate as the live bridge asked it (tmp/tts-stream.jsonl #237, names kept, pictures one link): 11 graveyard
// targets, cancellable
const REANIMATE = ["Agitator Ant", "Bazaar Trader", "Hill Giant 3/3 (AI 1's)", "Hill Giant 3/3 (AI 2's)", "Hill Giant 3/3 (AI 3's)", "Kiki-Jiki, Mirror Breaker",
  "Lazav, the Multifarious", "Pestermite 2/1 #1", "Pestermite 2/1 #2", "Serra Angel 4/4 (AI 1's)", "Serra Angel 4/4 (AI 3's)"]
  .map((label, k) => ({ id: `card|engine-card-${960 + k}`, label, img }));
const reanimate = (promptId) => ask({ promptId, kind: "target", title: "Reanimate: put which creature card from a graveyard onto the battlefield under your control?",
  mode: "multi", min: 1, max: 1, cancel: true, options: REANIMATE, text: "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value." });
// Volrath's Shapeshifter's discard cost (#229): hand cards, an exact pick of one, not cancellable
const HAND = ["Animate Dead", "Buried Alive", "Crawlspace", "Insurrection", "Lazav, the Multifarious 1/3", "Perplexing Chimera 3/3", "Reanimate"]
  .map((label, k) => ({ id: `engine-card-${470 + k}`, label, img }));
const volrath = (promptId) => ask({ promptId, kind: "cards", title: "Volrath's Shapeshifter: discard a card", mode: "multi", min: 1, max: 1, cancel: false,
  options: HAND, text: "{2}: Discard a card." });

// ── 16: Reanimate's target picked in the Engine panel's list ──
{
  const r = run([inPile(REANIMATE.map((o) => o.id.slice(5))), reanimate(990),
    q(`return ${attr("eng_panel_Blue", "active")} .. "|" .. ${attr("eng_opt_Blue_2", "text")}`, "open"),
    q('onMtgSlot(Player.Blue, nil, "eng_opt_Blue_2") __sim.frames(30) return tostring(enginePrompts.Blue and enginePrompts.Blue.promptId)', "list pick")]);
  ok("16 reanimate: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("16 reanimate: precondition, the Engine panel is open on the targets", valueOf(r, "open") === "true|[  ] Bazaar Trader", valueOf(r, "open"));
  ok("16 reanimate: a line picked in the list answers the exact pick with that target (no Done, no Cancel)",
    sentOf(r, "list pick").includes('"choice":["card|engine-card-961"]') && sentOf(r, "list pick").includes('"promptId":990'), sentOf(r, "list pick").slice(0, 300));
  ok("16 reanimate: the question is closed on the table once answered", valueOf(r, "list pick") === "nil", valueOf(r, "list pick"));
  ok("16 reanimate: it never sends Cancel", !sentOf(r, "list pick").includes("__cancel"), sentOf(r, "list pick").slice(0, 300));
}
// a pick of several still waits for Done (only an exact pick of one answers at the click)
{
  const r = run([inPile(REANIMATE.map((o) => o.id.slice(5))), ask({ promptId: 991, kind: "target", title: "Choose up to two target creature cards", mode: "multi", min: 0, max: 2, options: REANIMATE }),
    q('onMtgSlot(Player.Blue, nil, "eng_opt_Blue_1") __sim.frames(10) return "picked"', "one of two"),
    q('onMtgConfirm(Player.Blue, nil, "eng_confirm_Blue") __sim.frames(10) return "done"', "done")]);
  ok("16 list: a pick of up to two doesn't answer at the first click", !answered(r, "one of two"), sentOf(r, "one of two").slice(0, 300));
  ok("16 list: Done sends it", sentOf(r, "done").includes('"choice":["card|engine-card-960"]'), sentOf(r, "done").slice(0, 300) + " " + r.errors.join(" | "));
}
// ── 14: Volrath's Shapeshifter's discard cost from the Choices list ──
{
  const r = run([volrath(229),
    q('onMtgToggle(Player.Blue, nil, "eng_toggle_Blue") __sim.frames(5) return ' + `${attr("eng_panel_Blue", "active")} .. "|" .. ${attr("eng_opt_Blue_5", "text")}`, "choices"),
    q('onMtgSlot(Player.Blue, nil, "eng_opt_Blue_5") __sim.frames(30) return "picked"', "list pick")]);
  ok("14 volrath: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("14 volrath: precondition, Choices lists the hand", valueOf(r, "choices") === "true|[  ] Lazav, the Multifarious 1/3", valueOf(r, "choices"));
  ok("14 volrath: the discard picked in the list is sent at that click", sentOf(r, "list pick").includes('"choice":["engine-card-474"]') && sentOf(r, "list pick").includes('"promptId":229'), sentOf(r, "list pick").slice(0, 300));
}
// a full exact pick still open (made where no click answers it): the corner says Done and sends it
{
  const r = run([volrath(230),
    q(`enginePick("Blue", 5) __sim.frames(5) return ${attr("eng_big_Blue", "text")} .. "|" .. ${attr("eng_big_Blue", "active")}`, "picked"),
    q('onMtgBig(Player.Blue, nil, "eng_big_Blue") __sim.frames(10) return "pressed"', "corner")]);
  ok("14 corner: a complete exact pick's corner button reads Done", valueOf(r, "picked") === "Done (1 of 1 chosen)|true", valueOf(r, "picked"));
  ok("14 corner: pressing it answers the pick", sentOf(r, "corner").includes('"choice":["engine-card-474"]') && sentOf(r, "corner").includes('"promptId":230'), sentOf(r, "corner").slice(0, 300) + " " + r.errors.join(" | "));
}
{
  const r = run([volrath(231), q(`return ${attr("eng_big_Blue", "text")}`, "none picked"),
    q('onMtgBig(Player.Blue, nil, "eng_big_Blue") __sim.frames(10) return "pressed"', "press")]);
  ok("14 corner: with nothing picked it still only counts, and a press sends nothing", valueOf(r, "none picked") === "0 of 1 chosen" && !answered(r, "press"), `${valueOf(r, "none picked")} ${sentOf(r, "press").slice(0, 200)}`);
}
// ── 13: the search box is emptied for the next question ──
{
  const r = run([reanimate(992),
    q('engineUI.setValue("eng_search_Blue", "Serra") onMtgSearch(Player.Blue, "Serra", "eng_search_Blue") __sim.frames(5) return tostring(UI.getValue("eng_search_Blue")) .. "|" .. ' + attr("eng_opt_Blue_1", "text"), "typed"),
    volrath(232),
    q(`return tostring(UI.getValue("eng_search_Blue")) .. "|" .. ${attr("eng_opt_Blue_1", "text")}`, "next")]);
  ok("13 search: precondition, the typed search filters the list", valueOf(r, "typed") === "Serra|[  ] Serra Angel 4/4 (AI 1's)", valueOf(r, "typed"));
  ok("13 search: the next question's box is empty, as its list is unfiltered", valueOf(r, "next") === "|[  ] Animate Dead", valueOf(r, "next") + " " + r.errors.join(" | "));
}
// ── 10: Dimir Doppelganger's graveyard targets, 6 in a pile and 3 lone cards ──
{
  const DIMIR = REANIMATE.slice(0, 9);
  const r = run([inPile(DIMIR.slice(0, 6).map((o) => o.id.slice(5))),
    ask({ promptId: 993, kind: "target", title: "Dimir Doppelganger: exile which creature card from a graveyard?", mode: "multi", min: 1, max: 1, cancel: true, options: DIMIR }),
    q(`return ${attr("eng_panel_Blue", "active")} .. "|" .. tostring(UI.getValue("eng_hint_Blue"))`, "asked")]);
  const [panel, hint] = String(valueOf(r, "asked")).split("|");
  ok("10 dimir: the Engine panel opens (the card row can't show 9 pictures)", panel === "true", valueOf(r, "asked") + " " + r.errors.join(" | "));
  ok("10 dimir: the hint says to pick in the Engine panel, not 'Click a glowing card'", String(hint).includes("Engine panel") && !String(hint).includes("glowing"), hint);
}
{
  // (all of them lone cards on the table: no pile, the cards glow, no panel as before)
  const r = run([ask({ promptId: 994, kind: "target", title: "Dimir Doppelganger: exile which creature card from a graveyard?", mode: "multi", min: 1, max: 1, cancel: true, options: REANIMATE.slice(0, 9) }),
    q(`return ${attr("eng_panel_Blue", "active")} .. "|" .. tostring(UI.getValue("eng_hint_Blue"))`, "asked")]);
  ok("10 dimir: with no card in a pile the panel stays shut", String(valueOf(r, "asked")).split("|")[0] !== "true", valueOf(r, "asked"));
}
// ── 4: Mairsil's cage choice, hand and graveyard cards (the bridge's pileChoices names the graveyard ones) ──
{
  const MAIRSIL = [{ id: "engine-card-421", label: "Agitator Ant 2/2", img }, { id: "engine-card-422", label: "Helm of the Host", img },
    { id: blueBf[0], label: "Mirage Mirror", img }];
  const r = run([inPile(["engine-card-421", "engine-card-422"]),
    ask({ promptId: 995, kind: "cards", title: "Mairsil, the Pretender: exile which artifact or creature card from your hand or graveyard?", mode: "multi", min: 0, max: 1, cancel: false,
      options: MAIRSIL, pileChoices: ["engine-card-421", "engine-card-422"] }),
    q(`return tostring(UI.getValue("eng_hint_Blue")) .. "|" .. tostring(engineChoosable.Blue and engineChoosable.Blue["engine-card-421"]) .. "|" .. tostring(engineChoosable.Blue and engineChoosable.Blue["${blueBf[0]}"])`, "asked")]);
  ok("4 mairsil: precondition, a card of the choice is on the table", blueBf.length > 0);
  const [hint, pileCard, handCard] = String(valueOf(r, "asked")).split("|");
  ok("4 mairsil: the hint gives both ways, a glowing card or a drag out of the pile", hint.includes("Click a glowing card, or right-click") && hint.includes("drag the card out"), hint + " " + r.errors.join(" | "));
  ok("4 mairsil: the graveyard card can be dragged out of its pile to choose it, the hand card isn't a pile choice", pileCard === "true" && handCard === "nil", valueOf(r, "asked"));
}
{
  // (every card in a pile: the hint as before)
  const r = run([inPile(["engine-card-421"]), ask({ promptId: 996, kind: "cards", title: "Mairsil, the Pretender: exile which artifact or creature card from your hand or graveyard?", mode: "multi", min: 0, max: 1,
    options: [{ id: "engine-card-421", label: "Agitator Ant 2/2", img }, { id: "engine-card-422", label: "Helm of the Host", img }], pileChoices: ["engine-card-421", "engine-card-422"] }), q('return tostring(UI.getValue("eng_hint_Blue"))', "asked")]);
  ok("4 mairsil: all in a pile, the pile hint as before", String(valueOf(r, "asked")).includes("\nRight-click that graveyard or exile pile -> Search, and drag the card out."), valueOf(r, "asked"));
}

console.log(`${failed ? failed + " failed, " : ""}${failed ? "" : "all "}${passed} passed`);
process.exit(failed ? 1 : 0);
