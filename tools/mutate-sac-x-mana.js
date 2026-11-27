// Break-it for "Sacrifice X for mana" (tests/test_bridge_sac_x_mana.js): each mutation switches one piece of bridge.js
// off, runs the test, and must make the check it names fail by name; then the file is put back and checked by sha256.
// A mutation whose named check still passes is printed as SURVIVED, and a check of the test that no mutation names is
// printed as UNCOVERED.
//   node tools/mutate-sac-x-mana.js [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TEST = "tests/test_bridge_sac_x_mana.js";
const B = "bridge/bridge.js";

// [label, from, to, the check that must fail]: `from` must occur exactly once in bridge.js (a list of them: each
// replaced by the `to` at its place)
const MUTATIONS = [
  // (two guards keep a lone Treasure out of a payment, the group's size and the cap: both off)
  ["a lone source offered while paying", ["      if (cards.length < 2) continue;", "          if (most < 2) continue;"], ["      if (cards.length < 1) continue;", "          if (most < 1) continue;"], "none: one Treasure"],
  ["the same lone source at priority", "      if (cards.length < 2) continue;", "      if (cards.length < 1) continue;", "priority: one Treasure left: no Sacrifice X"],
  ["the payment option worded otherwise", "label: `Sacrifice X ${g.name} for mana (1 to ${most})`", "label: `Sacrifice ${g.name}s for mana`", "paying: one Sacrifice X option for the three"],
  ["the payment option last", "        ui.options.splice(at < 0 ? ui.options.length - 1 : at, 0, ...sacOffers.map((x) => x.opt));", "        ui.options.splice(ui.options.length - 1, 0, ...sacOffers.map((x) => x.opt));",
    "paying: it comes after Auto-pay and before the taps"],
  ["the payment option on the last card", "sacOffers.push({ g, caps, opt: { id: `${SACX}g${k}`, cardId: g.cards[0],", "sacOffers.push({ g, caps, opt: { id: `${SACX}g${k}`, cardId: g.cards[g.cards.length - 1],",
    "paying: it sits on the first Treasure on the board"],
  ["the payment option unranked", "rank: Math.max(...g.colours.map((c) => (caps[c] > 0 ? rankOf(g.act(g.cards[0], c)) : 0))) } });", "rank: 1 } });", "paying: it ranks as a needed colour"],
  ["the grouped cards' own taps dropped", "        ui.options.splice(at < 0 ? ui.options.length - 1 : at, 0, ...sacOffers.map((x) => x.opt));",
    "        ui.options = ui.options.filter((o) => !sacOffers.some((x) => x.g.cards.includes(o.cardId) && String(o.id).startsWith(\"tap:\")));\n        ui.options.splice(ui.options.findIndex((o) => o.id === \"__cancel\"), 0, ...sacOffers.map((x) => x.opt));",
    "paying: the Treasures' own taps are still offered"],
  ["the needed colour not first", "  const sorted = [...cols].sort((x, y) => (named(y) ? 1 : 0) - (named(x) ? 1 : 0));", "  const sorted = [...cols];", "colour: asked once, the cost's colour first and marked"],
  ["the colour asked with no way back", "  return askUnder(seat, { title: `${g.name}: sacrifice them for which mana?`", "  return next({ title: `${g.name}: sacrifice them for which mana?`", "colour: every colour the Treasures make, then Back"],
  ["the colour asked with no way back (Back)", "  return askUnder(seat, { title: `${g.name}: sacrifice them for which mana?`", "  return next({ title: `${g.name}: sacrifice them for which mana?`", "back: from the colour to the payment"],
  ["the cost still owed not said", "  const still = ctx.owed ? `${ctx.owed} still to pay. ` : \"\";", "  const still = \"\";", "colour: it says what is still owed"],
  ["the cost said with none", "  const still = ctx.owed ? `${ctx.owed} still to pay. ` : \"\";", "  const still = `${ctx.owed} still to pay. `;", "priority: no cost to name"],
  ["no questions: the first sacrificed at once", "  if (cols.length === 1) return count(cols[0], false);", "  return sacStart(seat, g, cols[0], 99, ctx);", "colour: nothing answered yet"],
  ["how many skipped for three", "    if (cap <= 1) return sacStart(seat, g, c, 1, ctx);", "    if (cap <= 3) return sacStart(seat, g, c, cap, ctx);", "how many: nothing answered yet"],
  ["the all button unmarked", "label: n === g.cards.length ? `×${n} (all)` : `×${n}` }", "label: `×${n}` }", "how many: 1 to 3 (all three), and Back"],
  ["how many titled otherwise", "    const ui = { title: `${g.name}: sacrifice how many for ${sym(c)}?`, mode: \"single\"", "    const ui = { title: \"How many?\", mode: \"single\"", "how many: titled by the card and the colour"],
  ["the run starts at the second card", "  return { type: \"act\", actionId: g.act(cards[0], col).id };", "  return { type: \"act\", actionId: g.act(cards[cards.length - 1], col).id };", "run: the first Treasure on the board is sacrificed for {B}"],
  ["the run starts at the second card (Spawn)", "  return { type: \"act\", actionId: g.act(cards[0], col).id };", "  return { type: \"act\", actionId: g.act(cards[cards.length - 1], col).id };", "Spawn: the first for {C}"],
  ["the run starts at the second card (priority)", "  return { type: \"act\", actionId: g.act(cards[0], col).id };", "  return { type: \"act\", actionId: g.act(cards[cards.length - 1], col).id };", "priority: the first for {R}"],
  ["the run keeps one too few", "colour: col, name: g.name, left: cards.slice(1), last: cards[0]", "colour: col, name: g.name, left: cards.slice(2), last: cards[0]", "run: two are left"],
  ["the run keeps none", "colour: col, name: g.name, left: cards.slice(1), last: cards[0]", "colour: col, name: g.name, left: [], last: cards[0]", "rewind: (the run is on)"],
  ["the run's sacrifice refused", "      seat.respond(prompt.promptId, type, { type: \"decision\", value: true });\n      return true;", "      seat.respond(prompt.promptId, type, { type: \"decision\", value: false });\n      return true;", "run: Forge's Sacrifice Treasure Token? is answered yes"],
  ["the run's sacrifice refused (priority)", "      seat.respond(prompt.promptId, type, { type: \"decision\", value: true });\n      return true;", "      seat.respond(prompt.promptId, type, { type: \"decision\", value: false });\n      return true;", "priority: its sacrifice answered"],
  ["the run never goes on", "  if (sacRunStep(seat, prompt, type, input, gv)) return;", "", "run: the second, unseen, on the next payment"],
  ["the run never goes on (third)", "  if (sacRunStep(seat, prompt, type, input, gv)) return;", "", "run: and the third"],
  ["the run never goes on (shown)", "  if (sacRunStep(seat, prompt, type, input, gv)) return;", "", "run: none of the run's questions was shown"],
  ["the run never goes on (priority)", "  if (sacRunStep(seat, prompt, type, input, gv)) return;", "", "priority: the second on the next priority, by its new position"],
  ["the pool doesn't pay after a run", "  if (run.kind === \"pay\") seat.tappedFor = run.card;", "  if (run.kind === \"pay\") seat.tappedFor = null;", "run: the pool pays the cost once it is covered"],
  ["a run never ends", "  seat.sacRun = null;\n  return false;\n}", "  return false;\n}", "run: over"],
  ["a run never ends (gone)", "  seat.sacRun = null;\n  return false;\n}", "  return false;\n}", "gone: the run is over"],
  ["a run never ends (other question)", "  seat.sacRun = null;\n  return false;\n}", "  return false;\n}", "other question: the run ends"],
  ["no cap while paying", "caps[c] = Math.min(g.cards.length, Math.ceil(sacUseful(owed, c, plainOwed) / g.amount));", "caps[c] = g.cards.length;", "cap: no more than the cost takes"],
  ["no cap while paying ({B})", "caps[c] = Math.min(g.cards.length, Math.ceil(sacUseful(owed, c, plainOwed) / g.amount));", "caps[c] = g.cards.length;", "cap: {B} asks 1 or 2"],
  ["no cap while paying (one mana)", "caps[c] = Math.min(g.cards.length, Math.ceil(sacUseful(owed, c, plainOwed) / g.amount));", "caps[c] = g.cards.length;", "none: a cost of one mana"],
  ["any colour counts for every symbol", "    else if (!plain || col.length !== 1 || parts.some((x) => x === col || x === \"X\" || /^\\d+$/.test(x))) n += 1;", "    else n += 1;",
    "cap: {W} can pay only the {1}: one sacrificed at once"],
  ["one is asked how many too", "    if (cap <= 1) return sacStart(seat, g, c, 1, ctx);\n", "", "cap: nothing left to run"],
  ["Back from how many goes nowhere", "      if (b[0] === \"__back\") return backUnder(seat);\n", "", "cap: Back from how many goes back to the payment"],
  ["names not told apart", "    const key = [name, a.cost, a.type, a.type === \"activateManaAbility\" ? a.abilityIndex : a.description, byId[a.cardId].text || \"\"].join(\"|\");",
    "    const key = a.type;", "none: Treasure and Gold"],
  ["another card's sacrifice counted", "  return String(a.cost || \"\").split(/,\\s*/).some((p) => /^Sacrifice (?:this [a-z]+|CARDNAME)$/i.test(p)", "  return String(a.cost || \"\").split(/,\\s*/).some((p) => /^Sacrifice /i.test(p)",
    "none: another card's sacrifice (Ashnod's Altar)"],
  ["only tokens counted", "/^Sacrifice (?:this [a-z]+|CARDNAME)$/i.test(p)", "/^Sacrifice (?:this token|CARDNAME)$/i.test(p)", "Gold: grouped"],
  ["one colour asked as a colour", "  if (cols.length === 1) return count(cols[0], false);\n", "", "Spawn: one colour, so only how many"],
  ["a card gone swallows the payment", "  if (!act) return sacStop(", "  if (!act) return !sacStop(", "gone: the payment is asked"],
  ["a card gone not said", "  if (n > 0) chat(", "  if (false) chat(", "gone: said once"],
  ["the priority option worded otherwise", "label: `Mana: sacrifice X ${g.name} (1 to ${g.cards.length})` })));", "label: `Sacrifice X ${g.name} (1 to ${g.cards.length})` })));", "priority: Mana: sacrifice X Treasure Token (1 to 3)"],
  ["the priority option last", "        ui.options.splice(at < 0 ? ui.options.length : at, 0, ...sacPrio.map(", "        ui.options.splice(ui.options.length, 0, ...sacPrio.map(", "priority: before the cards' own Mana: buttons"],
  ["the board's order ignored", "      cards.sort((x, y) => (order[x] ?? 1e9) - (order[y] ?? 1e9));\n", "", "priority: on the first Treasure on the board"],
  ["every colour marked needed", "  const named = (c) => c.length === 1 && need.has(COLOR_NAMES[c]);", "  const named = (c) => c.length === 1;", "priority: the colour, in the engine's order, none marked needed"],
  ["the run takes one more", "  const cards = g.cards.slice(0, Math.max(1, n));", "  const cards = g.cards.slice(0, n + 1);", "priority: after the run the priority is asked"],
  ["the run takes one more (eight)", "  const cards = g.cards.slice(0, Math.max(1, n));", "  const cards = g.cards.slice(0, n + 1);", "eight: 7 starts the run"],
  ["eight buttons", "const SACX_BUTTONS = 6;", "const SACX_BUTTONS = 8;", "eight: ×1 to ×5, ×8 (all), How many…, Back"],
  ["How many… starts at one", "min: 1, max: cap, default: cap,", "min: 1, max: cap, default: 1,", "eight: a number from 1 to 8, starting at 8"],
  ["How many… takes one too many", "min: 1, max: cap, default: cap,", "min: 1, max: cap + 1, default: cap,", "eight: 9 is refused"],
  ["a colour question not answered", "      seat.respond(prompt.promptId, type, { type: \"colorDecision\", chosenColors: { [colour]: input.amount } });\n      return true;", "      return false;", "colour question: the run's colour"],
  ["an unanswered question leaves the run on (a nameless Sacrifice question)", "    return sacStop(seat, run, run.left.length, \"another question came first\");", "    return false;", "unanswered (a nameless Sacrifice question): the run ends, said once"],
  ["an unanswered question leaves the run on (a nameless Sacrifice question, next payment)", "    return sacStop(seat, run, run.left.length, \"another question came first\");", "    return false;", "unanswered (a nameless Sacrifice question): after the player's answer the next payment is asked, nothing sacrificed"],
  ["an unanswered question leaves the run on (another card's colour question)", "    return sacStop(seat, run, run.left.length, \"another question came first\");", "    return false;", "unanswered (another card's colour question): the run ends, said once"],
  ["an unanswered question leaves the run on (another card's colour question, next payment)", "    return sacStop(seat, run, run.left.length, \"another question came first\");", "    return false;", "unanswered (another card's colour question): after the player's answer the next payment is asked, nothing sacrificed"],
  ["a nameless Sacrifice question taken as the run's", "    const mine = prompt.sourceCard?.id ? prompt.sourceCard.id === run.last : title.toLowerCase().includes(run.name.toLowerCase());", "    const mine = prompt.sourceCard?.id ? prompt.sourceCard.id === run.last : true;", "unanswered (a nameless Sacrifice question): it is the player's"],
  ["another card's colour question taken as the run's", "    if (type === \"chooseColor\" && mine && colour", "    if (type === \"chooseColor\" && colour", "unanswered (another card's colour question): it is the player's"],
  ["every Sacrifice question of the card answered", "mine && !run.confirmed && /^Sacrifice", "mine && /^Sacrifice", "a second Sacrifice question for the same card is the player's, the run ends"],
  ["the tap left for CONFIRMS to answer again", "      seat.forget(\"manaTap\"); // (answered here: CONFIRMS must not take a second one as this tap's too)\n", "", "a second Sacrifice question for the same card is the player's, the run ends"],
  ["a refused activation goes on with the next", "  if (same && (input.actions || []).some((a) => usable(a, run.last))) return sacStop(seat, run, run.left.length + 1, \"the engine didn't take the last one\");", "", "refused: the payment back with the first still offered is asked, nothing sacrificed"],
  ["a refused activation goes on with the next (priority)", "  if (same && (input.actions || []).some((a) => usable(a, run.last))) return sacStop(seat, run, run.left.length + 1, \"the engine didn't take the last one\");", "", "refused at priority: the priority back with the first still offered is asked"],
  ["a refused activation not counted", "  if (same && (input.actions || []).some((a) => usable(a, run.last))) return sacStop(seat, run, run.left.length + 1, \"the engine didn't take the last one\");", "  if (same && (input.actions || []).some((a) => usable(a, run.last))) return sacStop(seat, run, run.left.length, \"the engine didn't take the last one\");", "refused: the run ends, said once"],
  ["a rewind keeps the run", "\"loop\", \"loopLog\", \"loopOffer\", \"loopQuiet\", \"keepTargets\", \"sacRun\"];", "\"loop\", \"loopLog\", \"loopOffer\", \"loopQuiet\", \"keepTargets\"];", "rewind: clearFollowUps forgets it"],
];
// the test's checks, by name (a check named in a loop, "none: ${what}", by each of its names)
const UNANSWERED = ["a nameless Sacrifice question", "another card's colour question"];
const LOOPED = { "none: ${what}": ["none: one Treasure", "none: a cost of one mana", "none: Treasure and Gold", "none: another card's sacrifice (Ashnod's Altar)"],
  "unanswered (${what}): it is the player's": UNANSWERED.map((w) => `unanswered (${w}): it is the player's`),
  "unanswered (${what}): the run ends, said once": UNANSWERED.map((w) => `unanswered (${w}): the run ends, said once`),
  "unanswered (${what}): after the player's answer the next payment is asked, nothing sacrificed": UNANSWERED.map((w) => `unanswered (${w}): after the player's answer the next payment is asked, nothing sacrificed`) };
function checkNames() {
  const src = fs.readFileSync(path.join(ROOT, TEST), "utf8");
  return [...src.matchAll(/\bok\((?:"([^"]+)"|`([^`]+)`)/g)].flatMap((m) => (m[1] ? [m[1]] : LOOPED[m[2]] || [m[2]]));
}
function runTest() {
  const failed = [];
  const r = spawnSync(process.execPath, [TEST], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
  const out = (r.stdout || "") + (r.stderr || "");
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*FAIL[: ]\s*(.+)$/);
    if (m) failed.push(m[1]);
  }
  if (r.status !== 0 && !failed.length) failed.push(`${TEST} exit ${r.status}: ${out.split("\n").slice(-3).join(" ").slice(0, 160)}`);
  return failed;
}

const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null; // (a label pattern: just those mutations)
const uncovered = checkNames().filter((n) => !MUTATIONS.some((m) => m[3] === n));
for (const n of uncovered) console.log(`UNCOVERED: no mutation names "${n}"`);
const base = runTest();
console.log(base.length ? `BASELINE FAILS: ${base.join(" | ")}` : "baseline: green");
if (base.length) process.exit(1);
let survived = 0;
const list = MUTATIONS.filter(([label]) => !only || only.test(label));
const file = path.join(ROOT, B);
const pristine = fs.readFileSync(file, "utf8"), pristineSha = sha(file);
for (const [label, from, to, want] of list) {
  const froms = [].concat(from), tos = [].concat(to);
  if (froms.some((f) => pristine.split(f).length !== 2)) { console.log(`?? ${label}: the code to break is not there once`); survived++; continue; }
  fs.writeFileSync(file, froms.reduce((s, f, i) => s.replace(f, () => tos[i]), pristine));
  let failed;
  try { failed = runTest(); } finally { fs.writeFileSync(file, pristine); }
  const restored = sha(file) === pristineSha;
  const named = failed.some((f) => f === want || f.startsWith(`${want}:`));
  if (!named || !restored) survived++;
  console.log(`${named ? "caught" : "SURVIVED"}: ${label} -> ${named ? want : `(wanted "${want}") ${failed.map((f) => f.slice(0, 90)).join(" | ") || "nothing failed"}`}${restored ? "" : "  RESTORE MISMATCH"}`);
}
console.log(`bridge.js sha256 ${sha(file) === pristineSha ? "matches" : "DOES NOT MATCH"} the pristine copy (${pristineSha.slice(0, 16)})`);
console.log(survived || uncovered.length ? `${survived} of ${list.length} survived, ${uncovered.length} checks uncovered` : `all ${list.length} caught by their named check, every check named, bridge.js restored by sha256`);
process.exit(survived || uncovered.length || sha(file) !== pristineSha ? 1 : 0);
