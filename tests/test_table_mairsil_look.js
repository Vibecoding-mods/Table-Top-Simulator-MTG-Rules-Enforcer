// The Mairsil hand test's table findings (docs/HAND-TEST-MAIRSIL.md, "Placement and look" and two panel ones), on the
// fake TTS: a short real 1v1 game prefix (Blue vs White), then crafted boards and questions.
//   node tests/test_table_mairsil_look.js
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = buildSave();
const s1 = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "table-stream-1v1.json"), "utf8"));
const prefix = [{ lua: 'engineChat("mtg start ai 1", Player.Blue)' }, ...s1.slice(0, 40).map((m) => ({ msg: { t: m.t, json: m.json } }))];
const q = (lua, mark) => ({ lua, mark });
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const run = (steps, opts) => simulate({ save, ...(opts || {}), steps: [...prefix, ...steps] });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const lastBoard = () => JSON.parse([...s1.slice(0, 40)].reverse().find((m) => m.t === "table").json);
const board = (m, mark) => ({ msg: { t: "table", json: JSON.stringify(m) }, frames: 30, mark });
// a board with these battlefields (colour -> list of { id, s, att? }) and card details
const withBattlefields = (bfs, cards) => {
  const m = lastBoard();
  for (const pl of m.players) {
    if (bfs[pl.color] === undefined) continue;
    pl.battlefield = bfs[pl.color];
    pl.keep = (pl.keep || []).filter((z) => z !== "battlefield");
  }
  m.cards = { ...(m.cards || {}), ...cards };
  return m;
};
const planned = (id) => `local p = engineContainHome("${id}") return p and string.format("%.2f %.2f", p.x, p.z) or "none"`;
const xz = (v) => { const m = /^(-?[\d.]+) (-?[\d.]+)$/.exec(String(v)); return m ? [Number(m[1]), Number(m[2])] : null; };
const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : Infinity);

// 25: an Aura one player controls on another player's creature lies with that creature, on the creature's seat, and
// stays its controller's card (AI 3's Coercive Impetus on AI 1's Craw Wurm, White's Mark of the Rani on AI 2's)
{
  const cards = {
    "w-crawl": { n: "Craw Wurm", ty: ["Creature"], p: 6, t: 4 }, "w-other": { n: "Universal Automaton", ty: ["Artifact", "Creature"], p: 1, t: 1 },
    "b-crawl": { n: "Craw Wurm", ty: ["Creature"], p: 6, t: 4 }, "b-other": { n: "Grizzly Bears", ty: ["Creature"], p: 2, t: 2 },
    "b-aura": { n: "Coercive Impetus", ty: ["Enchantment"] }, "b-own": { n: "Pacifism", ty: ["Enchantment"] }, "w-aura": { n: "Mark of the Rani", ty: ["Enchantment"], tok: true },
  };
  const m = withBattlefields({
    Blue: [{ id: "b-other", s: 1 }, { id: "b-crawl", s: 1 }, { id: "b-aura", s: 1, att: "w-crawl" }, { id: "b-own", s: 1, att: "b-other" }],
    White: [{ id: "w-other", s: 1 }, { id: "w-crawl", s: 1 }, { id: "w-aura", s: 1, att: "b-crawl" }],
  }, cards);
  const r = run([board(m, "board"),
    q(planned("w-crawl"), "w host"), q(planned("b-aura"), "b aura"), q(planned("b-crawl"), "b host"), q(planned("w-aura"), "w aura"),
    q(planned("w-other"), "w other"), q(planned("b-other"), "b other"), q(planned("b-own"), "b own"),
    q('return tostring(engineMetaColor("b-aura")) .. " " .. tostring(engineMetaColor("w-aura"))', "colors")]);
  ok("precondition 25: the board drew with no error", !r.errors.length, r.errors.join(" | "));
  const d1 = dist(xz(valueOf(r, "w host")), xz(valueOf(r, "b aura")));
  const d2 = dist(xz(valueOf(r, "b host")), xz(valueOf(r, "w aura")));
  ok("25 aura: Blue's aura on White's creature lies beside it", d1 < 2.5, `${d1.toFixed(2)} from its host (${valueOf(r, "b aura")} vs ${valueOf(r, "w host")})`);
  ok("25 aura: White's aura on Blue's creature lies beside it", d2 < 2.5, `${d2.toFixed(2)} from its host (${valueOf(r, "w aura")} vs ${valueOf(r, "b host")})`);
  ok("25 aura: the host's neighbour is not covered", dist(xz(valueOf(r, "w other")), xz(valueOf(r, "b aura"))) > 1.5, `${valueOf(r, "w other")} vs ${valueOf(r, "b aura")}`);
  // (lying the way the host's own seat lays its auras: beside Blue's creature as Blue's own Pacifism lies beside its)
  const off = (a, h) => { const A = xz(valueOf(r, a)), H = xz(valueOf(r, h)); return A && H ? [A[0] - H[0], A[1] - H[1]] : null; };
  ok("25 aura: White's aura on Blue's creature lies the way Blue's own aura does", dist(off("w aura", "b host"), off("b own", "b other")) < 0.1, `${JSON.stringify(off("w aura", "b host"))} vs ${JSON.stringify(off("b own", "b other"))}`);
  ok("25 aura: each aura stays its controller's card", valueOf(r, "colors") === "Blue White", valueOf(r, "colors"));
}

// 5: two cards tucked under one permanent (Kiki-Jiki and Red Death caged by Mairsil) lie side by side across its width,
// each one's name in sight (they lay 0.35 apart, one over the other's name); three are spread too; past that the fan
// is as it was (tests/test_table_stress_caps.js)
// 6: a caged card no permanent lies over is out of the exile pile beside it, its cage counter on its badge
{
  const cards = {
    "b-mairsil": { n: "Mairsil, the Pretender", ty: ["Creature"], p: 4, t: 4 },
    "x-kiki": { n: "Kiki-Jiki, Mirror Breaker", ty: ["Creature"] }, "x-red": { n: "Red Death, Shipwrecker", ty: ["Creature"] },
    "x-lone": { n: "Pestermite", ty: ["Creature"] }, "x-pile": { n: "Grizzly Bears", ty: ["Creature"] },
  };
  const m = withBattlefields({ Blue: [{ id: "b-mairsil", s: 1 }] }, cards);
  const blue = m.players.find((p) => p.color === "Blue");
  blue.exile = [{ id: "x-kiki", s: 1, ew: "b-mairsil", ctr: { CAGE: 1 } }, { id: "x-red", s: 1, ew: "b-mairsil", ctr: { CAGE: 1 } },
    { id: "x-lone", s: 1, ew: "gone-card", ctr: { CAGE: 1 } }, { id: "x-pile", s: 1 }];
  blue.keep = (blue.keep || []).filter((z) => z !== "exile");
  const r = run([board(m, "board"), q(planned("b-mairsil"), "host"), q(planned("x-kiki"), "kiki"), q(planned("x-red"), "red"),
    q('return tostring(engineSpecial["x-kiki"]) .. " " .. tostring(engineSpecial["x-lone"]) .. " " .. tostring(engineSpecial["x-pile"])', "special")]);
  ok("precondition 5: the board drew with no error", !r.errors.length, r.errors.join(" | "));
  const h = xz(valueOf(r, "host")), a = xz(valueOf(r, "kiki")), b = xz(valueOf(r, "red"));
  ok("5 linked: two tucked cards lie a half card's width apart", dist(a, b) >= 1.05, `${dist(a, b).toFixed(2)} apart (${valueOf(r, "kiki")} / ${valueOf(r, "red")})`);
  ok("5 linked: both still under their host", dist(a, h) < 2 && dist(b, h) < 2, `${dist(a, h).toFixed(2)}, ${dist(b, h).toFixed(2)} from it`);
  ok("5 linked: centred on the host", h && a && b && Math.abs(dist(a, h) - dist(b, h)) < 0.01, `${dist(a, h).toFixed(3)} vs ${dist(b, h).toFixed(3)}`);
  same("6 caged: a caged card with no permanent over it lies beside the pile (a plain one stays in it)", valueOf(r, "special"), "linked suspended nil");
}

// 1: a label on a card (its status box: Mairsil's "At end step: sacrifice Pestermite") takes the click from the card
// under it; clicked while the card is a target, it chooses the card, as a click on the card does
{
  const cards = { "b-mairsil": { n: "Mairsil, the Pretender", ty: ["Creature"], p: 4, t: 4 } };
  const m = withBattlefields({ Blue: [{ id: "b-mairsil", s: 1, kw: ["At end step: sacrifice Pestermite"] }] }, cards);
  const ask = (p) => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", ...p }) } });
  const find = 'local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:b-mairsil" then o = x end end ';
  const r = run([board(m, "board"),
    q(find + 'local n = 0 for _, b in ipairs(o.getButtons() or {}) do if tostring(b.label):find("Pestermite", 1, true) then n = n + 1 end end return tostring(n)', "labels"),
    ask({ promptId: 901, title: "Target: choose 0-1 target(s)", mode: "multi", min: 0, max: 1, options: [{ id: "card|b-mairsil", label: "Mairsil, the Pretender" }] }),
    // (TTS calls a button's click_function with the object and the clicking colour)
    q(find + 'for _, b in ipairs(o.getButtons() or {}) do if tostring(b.label):find("Pestermite", 1, true) then _G[b.click_function](o, "Blue", false) end end return "clicked"', "click label"),
    q('return tostring(engineSelectedFor("Blue", 1))', "selected")]);
  ok("precondition 1: the status box is drawn on the card", valueOf(r, "labels") === "1", `${valueOf(r, "labels")} ${r.errors.join(" | ")}`);
  ok("1 label click: clicking the status box of a target card chooses the card", valueOf(r, "selected") === "true", `selected=${valueOf(r, "selected")} ${r.errors.join(" | ")}`);
}

// 26: the corner buttons' long words go on two lines at a smaller font, the whole label in the tooltip ("Sacrifice a
// nonland p...", "Pay Reveal a Swamp or..." were cut at one line); short ones stay one line at the usual font
{
  const ask = (p) => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", ...p }) } });
  const corner = (mark) => q('return tostring(UI.getAttribute("eng_big_Blue", "text")) .. "#" .. tostring(UI.getAttribute("eng_big_Blue", "fontSize")) .. "#" .. tostring(UI.getAttribute("eng_big_Blue", "tooltip"))'
    + ' .. "#" .. tostring(UI.getAttribute("eng_big2_Blue", "text")) .. "#" .. tostring(UI.getAttribute("eng_big2_Blue", "fontSize")) .. "#" .. tostring(UI.getAttribute("eng_big2_Blue", "tooltip"))', mark);
  const r = run([
    ask({ promptId: 960, kind: "yesno", title: "Foreboding Ruins: reveal?", mode: "single", options: [{ id: "yes", label: "Sacrifice a nonland permanent" }, { id: "no", label: "Enter tapped instead of revealing a card from your hand" }] }), corner("long"),
    ask({ promptId: 961, kind: "yesno", title: "Foreboding Ruins: reveal?", mode: "single", options: [{ id: "yes", label: "Pay Reveal a Swamp or Mountain card from your hand" }, { id: "no", label: "No" }] }), corner("longer"),
    ask({ promptId: 962, kind: "yesno", title: "Draw a card?", mode: "single", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] }), corner("short")]);
  const [bt, bf, btip, st, sf, stip] = String(valueOf(r, "long")).split("#");
  ok("precondition 26: the question reached the corner", !r.errors.length && bt !== "undefined", `${valueOf(r, "long")} ${r.errors.join(" | ")}`);
  same("26 corner: a long big label on two lines, nothing cut", [bt, bf, btip], ["Sacrifice a nonland\npermanent", "17", "Sacrifice a nonland permanent"]);
  same("26 corner: a long small label on two lines, nothing cut", [st, sf, stip], ["Enter tapped instead of revealing\na card from your hand", "14", "Enter tapped instead of revealing a card from your hand"]);
  const [lt, , ltip] = String(valueOf(r, "longer")).split("#");
  ok("26 corner: past two lines it is cut at a word, the whole in the tooltip", lt === "Pay Reveal a Swamp or\nMountain card from your…" && ltip === "Pay Reveal a Swamp or Mountain card from your hand", JSON.stringify([lt, ltip]));
  const [, sbf, sbtip, , ssf] = String(valueOf(r, "short")).split("#");
  same("26 corner: a short label is one line at the usual fonts, no tooltip", [sbf, sbtip, ssf], ["26", "", "18"]);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
