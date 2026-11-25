// Adversary pass for the bridge (jr-programmer-suite §2b): applies plausible careless edits to a COPY of
// bridge/bridge.js, one at a time, and records which gate catches each: the golden master first (the comparison of
// tests/test_bridge_golden.js, stopped at the first scenario that differs), then, for a mutant the golden lets
// through, the other bridge gates (GATES below, cheapest first) until one fails.
// The live bridge file is never touched: each mutant is written to bridge/bridge.mutant.js from the pristine text and
// overwritten with the pristine text after; the copy's hash and the live file's are checked before and after each one.
// A mutation whose text is not found exactly once in bridge.js is a FAILURE of this tool (exit 2, nothing run): the
// list is stale and must be repaired, never skipped (45 of 207 had gone stale unseen by 2026-11-24).
//   node tools/mutate-bridge.js              every mutant
//   node tools/mutate-bridge.js --check      only check that every mutation applies, run nothing
//   node tools/mutate-bridge.js --summary    only the grade from tmp/mutate-bridge.json
//   env MUT_ONLY=<regex>   MUT_PART=k/n (the k-th of n slices, 1-based)   MUT_GOLDEN_ONLY=1 (the golden alone)
// Results merge by mutation into tmp/mutate-bridge.json (an entry counts only while its mutation text and bridge.js
// are the ones it was run on); the summary grades the current list from it. A name tagged "[equivalent: why]" is a
// mutant argued to change no behaviour: it still runs, and is left out of the escape rate only if it escapes.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "bridge", "bridge.js");
// the mutant sits next to the real bridge (its paths to presets and card data must resolve the same way); the
// running bridge only ever loads bridge.js
const MUTANT = path.join(ROOT, "bridge", "bridge.mutant.js");
const GOLDEN = path.join(ROOT, "tests", "golden", "bridge_golden.json");
const OUT = path.join(ROOT, "tmp", "mutate-bridge.json");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

// --golden-child: the golden comparison of tests/test_bridge_golden.js on the bridge BRIDGE_PATH names, stopped at the
// first scenario that differs (same cases, same order, same fresh harness per case, same programming-error rule)
if (process.argv[2] === "--golden-child") {
  // (written synchronously: a piped stdout is cut short by process.exit on Windows)
  const say = (l) => fs.writeSync(1, `${l}\n`);
  const harness = require(path.join(ROOT, "tests", "bridge-harness"));
  const { codeErrors } = require(path.join(ROOT, "tests", "golden", "bridge-run"));
  const cases = require(path.join(ROOT, "tests", "golden", "bridge-cases"));
  const want = new Map(JSON.parse(fs.readFileSync(GOLDEN, "utf8")).map((w) => [w.name, JSON.stringify(w)]));
  (async () => {
    const seen = new Set();
    for (const c of cases) {
      const h = harness.load(c.harness || {});
      let result;
      try { result = await c.run(h); } catch (e) { result = { threw: `${e.constructor.name}: ${e.message}` }; }
      const g = { name: c.name, effects: JSON.parse(JSON.stringify(h.effects)), result: result === undefined ? null : JSON.parse(JSON.stringify(result)) };
      seen.add(c.name);
      const bad = codeErrors([g])[0];
      if (bad) { say(`FAIL ${bad} (a programming error)`); process.exit(1); }
      if (!want.has(c.name)) { say(`FAIL ${c.name}: new scenario not in the golden file`); process.exit(1); }
      if (want.get(c.name) !== JSON.stringify(g)) { say(`FAIL ${c.name}`); process.exit(1); }
    }
    for (const n of want.keys()) if (!seen.has(n)) { say(`FAIL ${n}: scenario missing`); process.exit(1); }
    harness.restore();
    say(`all ${want.size} scenarios match`);
    process.exit(0);
  })();
  return;
}

const pristine = fs.readFileSync(SRC, "utf8");
const PRISTINE_SHA = sha(pristine);

const M = [
  ["copies of a card: no fallback action", "if (!acts.length) {\n      // the engine offers one", "if (false) {\n      // the engine offers one"],
  // 2026-10-21 playtest fixes: turning a card with no mana ability uses its {T} abilities
  ["sy unless: No says nothing","{ id: \"no\", label: `No: ${otherwise}` }","{ id: \"no\", label: \"No\" }"],
  ["sy {LIFE} left as a symbol","s.replace(/\\{LIFE\\}/g, \"life\")","s"],
  ["sy verb left as 'puts'","/s$/i.test(w) ? w.slice(0, -1) : w","w"],
  ["sy boolean: source not named [equivalent: every question gets the asking card in front later]","const named = src && !title.toLowerCase()","const named = false && !title.toLowerCase()"],
  ["sy chooseCards: 'from your hand' title dropped","const fromHand = input.cards.length > 0 &&","const fromHand = false &&"],
  ["sy count (1 of 2) not kept","if (u) u.k += 1;",""],
  ["sy reorder of the chosen cards asked again","if (u && input.items.length === u.ids.length","if (false && u && input.items.length === u.ids.length"],
  ["sy follow-up after a drag not answered","if (back) { done(back);","if (false) { done(back);"],
  ["sy drag doesn't say which card goes back","if (p.ui.otherwiseDo === \"library\" && seat.unless) { seat.unless.awaitingPick = true; seat.unless.putBack = m.id; }",""],
  ["sy a fresh choice taken for a follow-up","input.cards.some((c) => seat.unless.ids.includes(c.id))","true"],
  ["sy a card put back stays chosen","u.ids = u.ids.filter((x) => x !== id);",""],
  ["sy drag: any card counts","p.ui?.aboutCards?.includes(m.id) && p.ui.otherwiseDo &&","p.ui?.aboutCards && p.ui.otherwiseDo &&"],
  ["sy drag: any gesture counts","p.ui.otherwiseDo === { bottom: \"library\", sacrifice: \"sacrifice\" }[m.kind]) {\n    // (Sylvan","true) {\n    // (Sylvan"],
  ["sy chosen cards not pictured","...(u ? { show: u.ids.filter(","...(false ? { show: u.ids.filter("],
  ["sy a new trigger keeps the last round","if (src && seat.unless?.src === src && !u) seat.unless = null;",""],
  ["sy a two-card choice taken for a follow-up","seat.unless.awaitingPick && input.max === 1","seat.unless.awaitingPick"],
  ["resume: a stale save is rejoined","|| age > RESUME_MAX_AGE_MS) {","|| age > 9e9) {"],
  ["resume: logs in under a new name","this.username = resume?.username || `tts-","this.username = `tts-"],
  ["resume: not treated as a reconnect","this.joined = true; this.lostAt = Date.now(); this.tries = 0; this.rejoining = this.lostAt; }","this.joined = true; this.tries = 0; this.rejoining = Date.now(); }"],
  ["resume: the slot is forgotten","this.slot = resume?.slot || null;","this.slot = null;"],
  ["save: kept after a reset","  clearResume(); // (a reset game is never rejoined)",""],
  ["save: not saved when the game starts","  saveResume();\n}","}"],
  ["labels: same mana told apart dropped","if (count[b] < 2) return b;","return b;"],
  ["pay: the colour only one land makes not preferred","? 3 : 2;","? 2 : 2;"],
  ["save: a finished game is kept","      clearResume(); // (a finished game is never rejoined)",""],
  ["aideck: a deck in an empty seat wins again","...chosen.map((d) => [d, null]), ...game.aiTableDecks.map((d, i) => [d, game.aiTableColors?.[i] ?? null])];","...game.aiTableDecks.map((d, i) => [d, game.aiTableColors?.[i] ?? null]), ...chosen.map((d) => [d, null])];"],
  // 2026-10-22 playtest: plain questions, the colour a cost needs
  ["pq colour: needed not first","(need.has(b) ? 1 : 0) - (need.has(a) ? 1 : 0)","0"],
  ["pq colour: (needed) not said","${need.has(c) ? \" (needed)\" : \"\"}","${\"\"}"],
  ["pq colour: the cost forgotten before the colour","else if (type !== \"chooseColor\") seat.payingCost = null;","else seat.payingCost = null;"],
  ["pq colour: the cost kept after another question","else if (type !== \"chooseColor\") seat.payingCost = null;",""],
  ["pq colour: hybrid only first half","for (const x of sym.toUpperCase().split(\"/\")) if","for (const x of sym.toUpperCase().split(\"/\").slice(0, 1)) if"],
  ["pq title: triggered ability kept","t = t.replace(/^(.*?)Use triggered ability of (.+?)\\?$/i, \"$1Use $2?\")","t = t"],
  ["pq title: replacement kept",".replace(/^(.*?)Apply replacement effect of (.+?)\\?$/i, \"$1Use $2?\")",""],
  ["pq title: second line kept in the title","if (nl >= 0) { more","if (false) { more"],
  ["pq range: 0 not up-to","lo === \"0\" ? `up to ${hi}`","false ? `up to ${hi}`"],
  ["pq text: ability said twice","prompt.sourceAbilityText && !String(ui.text || \"\").includes(String(prompt.sourceAbilityText).slice(0, 60))","prompt.sourceAbilityText"],
  ["pq text: ability not shortened","? shorten(String(prompt.sourceAbilityText), 160) : null;","? String(prompt.sourceAbilityText) : null;"],
  ["ro top: not turned round","orderedIds: unblock(onTop ? [...ids].reverse() : ids)","orderedIds: unblock(ids)"],
  // (2026-11-24: the list is shown in Forge's order now and only the answer is turned round; turning both round was the
  // Ponder bug, Mairsil hand test #28)
  ["ro top: shown turned round too (the Ponder bug)","const step = orderSteps(words, hint, items,","const step = orderSteps(words, hint, onTop ? [...items].reverse() : items,"],
  ["ro triggers: plain words lost","const trig = /^Order triggered abilities/i.test(title)","const trig = false"],
  ["ro bottom: not recognised","bottom = !planarBottom && /bottom of [^.]*library in any order","bottom = false && /bottom of [^.]*library in any order"],
  ["ro top: any card's order counts","!!src && /library/i.test(what)","!!src"],
  ["ro top: a trigger order counts","const onTop = !trig && !bottom","const onTop = !bottom"],
  ["ab abort: said for each seat","if (game?.abortSaid || game?.over) break;","if (game?.over) break;"],
  ["ab empty library: a full library recorded as empty","if (n > 0) delete game.emptyAt[p.id]; else game.emptyAt[p.id] ??= { turn: gv.turn, step: gv.step };","game.emptyAt[p.id] ??= { turn: gv.turn, step: gv.step };"],
  ["ab abort: the reason never said","chat(why ? `[MTG] Game over: ${why}.` : \"[MTG] The game has ended.\");","chat(\"[MTG] The game has ended.\");"],
  // 2026-10-22 Arena wording
  ["aw count: one as a number","return max === 1 ? `${/^[aeiou]/i.test(noun) ? \"an\" : \"a\"} ${noun}` : many(max);","return many(max);"],
  ["aw count: up-to lost","return min === 0 ? `up to ${many(max)}`","return min === 0 ? many(max)"],
  ["aw priority: Next/Resolve swapped","label: stackIds.length ? \"Resolve\" : \"Next\" }","label: stackIds.length ? \"Next\" : \"Resolve\" }"],
  ["aw target: hint word shown","? (Object.hasOwn(TARGET_VERBS, t.toLowerCase()) ? TARGET_VERBS[t.toLowerCase()] : \"\") : null;","? null : null;"],
  ["aw target: player wording lost","const player = t.match(/^Choose (?:a )?player to (\\w+)/i);","const player = null;"],
  ["aw cards: bare verb gets no count",": bare ? `${title} ${cards}` :",": false ? `${title} ${cards}` :"],
  ["aw cards: search without for",": /^Search\\b/i.test(title) && !counted ? `${title} for ${cards}`",": false ? `${title} for ${cards}`"],
  ["aw cards: counted title gets a count again",": counted ? title :",": false ? title :"],
  ["aw modes: counters not named","const counters = input.options.length > 0 && input.options.every((o) => counterWords(String(o.label ?? \"\")));","const counters = false;"],
  ["aw modes: card-name title kept","(t === src || t === \"Choose\") && src ? `${src}: choose ${how}` : t,","t,"],
  ["aw yesno: Accept kept","const own = (x, d) => (x && x !== \"Accept\" && x !== \"Decline\" ? x : d);","const own = (x, d) => (x || d);"],
  ["aw yesno: pay buttons plain","yes = own(input.confirmLabel, `Pay ${m[1]}`); if (yes === \"Pay\") yes = `Pay ${m[1]}`;","yes = \"Yes\";"],
  ["aw yesno: sacrifice buttons plain","yes = \"Sacrifice\"; no = \"Keep it\";",""],
  ["aw yesno: cancel search kept","q = \"Stop searching?\";",""],
  ["aw yesno: no question mark","    q = `${q[0] ? q[0].toUpperCase() + q.slice(1).replace(/\\bCards\\b/g, \"cards\") : q}?`;","    q = q;"],
  ["aw last pass: CARDNAME left",".replace(/CARDNAME/g, src || \"this card\")",""],
  ["aw last pass: player-view left",".replace(/player-view-(\\d+)/g,",".replace(/player-viewX-(\\d+)/g,"],
  ["aw reveal: your library named as a player","String(input.ownerPlayerId).replace(\"-view\", \"\") === seat.slot ? \"your\" :","String(input.ownerPlayerId).replace(\"-view\", \"\") === \"x\" ? \"your\" :"],
  ["aw mulligan: count in the title","ui = { title: \"Keep this hand?\", mode: \"single\"","ui = { title: `Keep this hand? (${input.mulliganCount})`, mode: \"single\""],
  ["aw play: blank button for an ability","const l = String(a.label || a.description || (a.type === \"cast\" ? `Cast ${name}` : \"Use its ability\"))","const l = String(a.label)"],
  // 2026-10-22 review of the sweep's questions
  ["rv title: no card name in front",".includes(ui.kind)) ui.title = `${src}: ${ui.title}`;",".includes(ui.kind)) ui.title = ui.title;"],
  ["rv title: capital after the card name","ui.title = `${src}: ${rest[0].toLowerCase()}${rest.slice(1)}`;","ui.title = `${src}: ${rest}`;"],
  ["rv bottom: asked again","if (bottom || exileAll || allSame || landsDown) { seat.respond(","if (exileAll || allSame || landsDown) { seat.respond("],
  ["rv search zones: Forge's words kept",": `Look in your ${m[1]} for a card?`",": `Search your ${m[1]}?`"],
  ["rv cancel search: asked after Done","if (/^Cancel Search\\?/i.test(title) && seat.cardsDone && seat.cardsDone.src === src) {","if (false) {"],
  ["rv cancel search: any card's Done counts","&& seat.cardsDone.src === src) {",") {"],
  ["rv cancel search: Done remembered past the next question","seat.cardsDone = null;\n        seat.respond(prompt.promptId, type, { type: \"decision\", value: true });","seat.respond(prompt.promptId, type, { type: \"decision\", value: true });"],
  ["rv sylvan count above the total","${u && u.k <= u.n ? ` (${u.k} of ${u.n})` : \"\"}","${u ? ` (${u.k} of ${u.n})` : \"\"}"],
  ["rv title: a second heading","!/^[^:]{1,40}: /.test(String(ui.title)) && ",""],
  ["rv clash: Forge's lines kept","if (/ reveals: .*Mana Value=/i.test(title)) {","if (false) {"],
  ["rv clash: nobody-wins kept as Forge says","/no winner/i.test(end) ? \"Nobody wins.\" :","false ? \"Nobody wins.\" :"],
  ["rv clash: you named as a player","${p === me ? \"You\" : p}: ${c} (${v})","${p}: ${c} (${v})"],
  ["rv clash top/bottom: Yes/No","yes = \"Top\"; no = \"Bottom\";",""],
  ["rv free cast: Forge's sentence","q = `Cast ${m[1]} for free?`; yes = \"Cast it\"; no = \"Put in hand\";",""],
  ["rv sacrifice this token: not named","src && /^(this( token| permanent| creature)?|it)?$/i.test(m[1]) ? src :","false ? src :"],
  ["rv payment: no card name","${input.cardName || src ? ` for ${input.cardName || src}` : \"\"}"," for ${input.cardName}"],
  ["fc forced selection asked","if (input.options.length === 1 && (input.minTotal ?? 0) >= 1) {","if (false) {"],
  ["fc optional single answered","&& (input.minTotal ?? 0) >= 1) {",") {"],
  ["fc forced colour asked","if ((input.validColors || []).length === 1) {","if (false) {"],
  ["nm offspring stays a number","if (input.min === 0 && input.max === 1 && pay) {","if (false) {"],
  ["nm no cap on the number","max: Math.min(input.max, Math.max(input.min, NUMBER_PICK_MAX)) };","max: input.max };"],
  ["nm multikicker title kept","ui = { title: times ? `${src ? `${src}: ` : \"\"}pay ${times[2]} how many times? (${times[1]})` :","ui = { title: false ? \"\" :"],
  ["nm a non-mana cost read as mana","ui = /^\\{/.test(pay[2])","ui = true"],
  ["nt notice asked","      if (!(input.cards || []).length) {\n        const me = nameOf(seat.slot);","      if (false) {\n        const me = nameOf(seat.slot);"],
  ["nt notice not in chat","chat(`[MTG] ${toMe}`, seat.color);",""],
  ["nt mode labels not trimmed",".replace(/\\s*\\([^()]{12,}\\)/g, \"\").trim() || `Choice",".replace(/\\s*\\([^()]{12,}\\)/g, \"\") || `Choice"],
  ["nt no plain default title","const title = input.presentation?.title || {","const title = input.presentation?.title || type || {"],
  ["nt your own name kept","const toMe = plain.split(`${me} `).join(\"You \").replace(/: You /, \": you \");","const toMe = plain;"],
  ["wd ward not recognised","&& /^Ward\\b/i.test(String(input.abilityText || input.presentation?.text || \"\"))) {","&& false) {"],
  ["wd reminder text kept",".replace(/\\s*\\([^()]{12,}\\)/g, \"\")",""],
  ["wd votes keep engine ids","const plain = said.replace(/ \\(\\d+\\)/g, \"\").replace(","const plain = said.replace("],
  ["wd X said as a number","? \"X\" : \"a number\"}","? \"a number\" : \"a number\"}"],
  ["wd Don't pay said No","if (no === \"Decline\" || no === \"No\") no = \"Don't pay\";","if (no === \"Decline\") no = \"Don't pay\";"],
  ["py pool ignored","const owed = costLeft(input.manaCost, pool);","const owed = input.manaCost;"],
  ["py exact colour not taken from the pool","for (const x of syms) if (!(/^[WUBRGC]$/.test(x) && take(x))) keep.push(x);","for (const x of syms) keep.push(x);"],
  ["py generic not reduced","const n = Math.max(0, Number(x) - spare);","const n = Number(x);"],
  ["cl clash: you named by username","const named = (p) => (p === seat.username ? me : p);","const named = (p) => p;"],
  ["cl clash: winner kept as the engine says","winner ? (you && named(winner) === me ? \"You win.\" : `${named(winner)} wins.`)","winner ? `${named(winner)} wins.`"],
  ["fix: stack not checked before holding","  if (!f || (gv.stack || []).length) return false;\n  f.held = { seat, prompt };","  if (!f) return false;\n  f.held = { seat, prompt };"],
  ["fix: question not held","      if (holdForFix(seat, prompt, gv)) return;\n",""],
  ["fix: table prompt left open","  f.spent = null;\n  if (seat.prompt) closePrompt(seat);","  f.spent = null;"],
  ["fix: caller votes too","s.color !== except && isPlaying(pub, s.slot)","isPlaying(pub, s.slot)"],
  ["fix: players who are out vote","s.color !== except && isPlaying(pub, s.slot)","s.color !== except"],
  ["fix: decline at the start ignored","if (f.state === \"voting\") { chat(`[MTG] Manual fix declined by ${color}.`); endFix(); return; }",""],
  ["fix: decline of the list applies anyway","        fixBackToEditing(f, null, `[MTG] ${color} declined the changes. Back to editing.`);","        fixApply(f, pub);"],
  ["fix: one yes is enough","      if (f.waiting.length) break;\n",""],
  ["fix: done while not paused","    case \"done\": {\n      if (!f || f.state !== \"editing\")","    case \"done\": {\n      if (!f)"],
  ["fix: kind picked while not paused","    case \"kind\": {\n      if (!f || f.state !== \"editing\")","    case \"kind\": {\n      if (!f)"],
  ["fix: cancel while applying","      if (f.state === \"applying\") return chat(\"[MTG] Too late: the engine is applying it.\", color);\n",""],
  ["fix: held question dropped at the end","  if (held) guarded(","  if (false) guarded("],
  ["fix: apply id reused","f.applyId = game.fixApplies = Math.max(game.fixApplies || 0, pub.stateFix?.fixId || 0) + 1;","f.applyId = f.id;"],
  ["fix: stale engine answer read","!r || r.fixId !== f.applyId) return;","!r) return;"],
  ["fix: refusal ends the fix","    fixBackToEditing(f, why, `[MTG] The engine refused the fix (${why}). Back to editing.`);","    endFix();"],
  ["fix: colours not turned into slots","op[k] = kind === \"player\" ? slotOfColor(v) : kind === \"token\" ? tokenScript(v) : v;","op[k] = kind === \"token\" ? tokenScript(v) : v;"],
  ["fix: unknown cards pass","  card: (v, k, byId) => (typeof v !== \"string\" || !byId[v]) && `No such card: ${v}.`,","  card: () => false,"],
  ["fix: any zone","  zone: (v) => !FIX_ZONES.includes(v) && `No zone ${v}.`,","  zone: () => false,"],
  ["fix: negative numbers pass","  count: (v) => !(Number.isInteger(v) && v >= 0 && v <= 999)","  count: (v) => !(Number.isInteger(v) && v <= 999)"],
  ["fix: no upper bound","  count: (v) => !(Number.isInteger(v) && v >= 0 && v <= 999)","  count: (v) => !(Number.isInteger(v) && v >= 0)"],
  ["fix: fractions pass","  count: (v) => !(Number.isInteger(v) && v >= 0 && v <= 999)","  count: (v) => !(v >= 0 && v <= 999)"],
  ["fix: missing fields pass","        return { error: `Can't read the change ${JSON.stringify(raw)}.` };\n      }\n      const bad","        continue;\n      }\n      const bad"],
  ["fix: not on the board update","    ...(game.fix ? { fix: fixState() } : {}), // (a manual fix under way, PLAN M7)\n",""],
  ["fix: engine answer never read","  fixNews(pub);\n",""],
  ["fix: bottom shown as top","(op.position === \"bottom\" ? \" (bottom)\" : \" (top)\")","\" (top)\""],
  ["fix: rewind vote not checked","  if (pub.restoreVote?.status?.type === \"pending\") return \"Finish the rewind vote first.\";\n",""],
  ["fix: out players may call","  if (!isPlaying(pub, seat.slot)) return \"[MTG] Players who are out can't change the game.\";\n",""],
  ["fix: optional fields required","if (kind.endsWith(\"?\")) continue;",""],
  ["fix: booleans as text pass","  bool: (v, k) => typeof v !== \"boolean\" && `${k} must be true or false.`,","  bool: () => false,"],
  ["fix: any library position","  position: (v) => v !== \"top\" && v !== \"bottom\" && `No library position ${v}.`,","  position: () => false,"],
  ["fix: any counter kind","  kind: (v) => !(typeof v === \"string\" && /^[A-Z][A-Z0-9_]*$/.test(v)) && `No counter kind ${v}.`,","  kind: () => false,"],
  ["fix: extra fields passed on","const op = { op: raw.op };","const op = { ...raw };"],
  ["fix: watchdog never fires","  if (Date.now() - Math.max(f.appliedAt, f.activeAt || 0) < FIX_ANSWER_MS) return;","  return;"],
  ["fix: watchdog fires at once","  if (Date.now() - Math.max(f.appliedAt, f.activeAt || 0) < FIX_ANSWER_MS) return;\n",""],
  ["fix: watchdog counts from the apply, not the last question","Date.now() - Math.max(f.appliedAt, f.activeAt || 0) < FIX_ANSWER_MS","Date.now() - f.appliedAt < FIX_ANSWER_MS"],
  ["fix: watchdog fires while a free play's question is open","  if (f.activeAt && [...game.seats.values()].some((st) => st.prompt)) return;\n",""],
  ["fix: watchdog off the tick","guarded(\"fix watchdog\", fixWatchdog); ",""],
  ["fix: an older question kept","  if (!f || (gv.stack || []).length) return false;\n  f.held = { seat, prompt };","  if (!f || (gv.stack || []).length || f.held) return false;\n  f.held = { seat, prompt };"],
  ["fix: spent question forgotten","  if (!f.held && f.spent) f.held = f.spent;\n",""],
  ["fix: rewind under a fix","  if (game.fix) return chat(\"[MTG] Finish the manual fix first (or cancel it).\", color);\n",""],
  ["fix: call after the game","  if (pub.gameOver) return \"[MTG] The game is over.\";\n",""],
  ["fix: anything attaches","      if (!(c.subtypes || []).some((t) => /^(Aura|Equipment|Fortification)$/.test(t))) return","      if (false) return"],
  ["fix: token text sent as it is","kind === \"token\" ? tokenScript(v) : v;","v;"],
  ["fix: token colour ignored","    if (colours && parts[0] !== colours) continue;\n",""],
  ["fix: token size ignored","    if (pt && `${parts[1]}_${parts[2]}` !== pt) continue;\n",""],
  ["fix: token with the most words","parts.length < best.parts","parts.length > best.parts"],
  ["fix: token words not all needed","if (!rest.every((w) => parts.includes(w))) continue;","if (!rest.some((w) => parts.includes(w)) && rest.length) continue;"],
  ["fix: unknown tokens pass","  token: (v) => !tokenScript(v) && `No token called","  token: (v) => false && `No token called"],
  ["fix: commander colour not resolved","    if (op.op === \"commanderDamage\" && !byId[op.from]) {","    if (false) {"],
  ["fix: partner damage not lowered with it","for (const id of ids) if (id !== op.from && dealt(id) > op.n) lowered.push(","for (const id of ids) if (false) lowered.push("],
  ["fix: partner at the same damage lowered too (> → >=)","for (const id of ids) if (id !== op.from && dealt(id) > op.n) lowered.push(","for (const id of ids) if (id !== op.from && dealt(id) >= op.n) lowered.push("],
  ["fix: partner commander: the first, not the most damage","op.from = ids.reduce((best, id) => (dealt(id) > dealt(best) ? id : best), ids[0]);","op.from = ids[0];"],
  ["untap: never asked for floating mana","|| undos.length > 0 || skipStop","|| false || skipStop"],
  ["untap: no Untap button","...undos.map((a) => ({ id: a.id, cardId: a.cardId, label: `Untap ${cname(a.cardId)} (mana back)` }))]","]"],
  ["dice: asked instead of told","      seat.respond(prompt.promptId, type, { type: \"diceRolledAcknowledged\" });\n      return;\n    }","      break;\n    }"],
  ["restart: finished game restarts anyway","        if (finished) { resetGame(\"Starting a new game...\"); go(); return; }\n",""],
  ["restart: aborted game not counted as finished","(game.abortSaid || [...game.seats.values()]","([...game.seats.values()]"],
  ["autoresolve: own turn passes too","if (!stopNow && autoResolve[seat.color] && !turnOf(gv, who)) {","if (!stopNow && autoResolve[seat.color]) {"],
  ["autoresolve: ignored","if (!stopNow && autoResolve[seat.color] && !turnOf(gv, who)) {","if (false) {"],
  ["autoresolve: waiting Resolve kept","if (m.on && seat?.prompt?.type === \"chooseAction\" && gv && !turnOf(gv, seat.slot)) {","if (false) {"],
  ["resume: Start resets a live game","        if (live && !roomRestarting) {","        if (false) {"],
  ["resume: dead room counted live","[...game.seats.values()].every((st) => st.roomId && st.board?.state && !st.closed)","true"],
  ["resume: bridge restart doesn't redraw","    guarded(\"resend after resume\", resendToTable);\n  }, 3000);","  }, 3000);"],
  ["resume: every seat back doesn't redraw at once","      game.resumeSent = true;\n      guarded(\"resend after resume\", resendToTable);","      game.resumeSent = true;"],
  ["ex link: exiled-with dropped","...(c.exiledWith ? { ew: c.exiledWith, rl: !!c.returnsWhenHostLeaves } : {}),",""],
  ["ex link: returns flag always false","    ...(exileLinkMatters(c) ? { ew: c.exiledWith, rl: !!c.returnsWhenHostLeaves } : {}),\n    // a cipher","    ...(exileLinkMatters(c) ? { ew: c.exiledWith, rl: false } : {}),\n    // a cipher"],
  ["ex foretold dropped","    ...(c.isForetold ? { fo: true } : {}),\n    ...(c.isCopy","    ...(c.isCopy"],
  ["ex playable: another player's library top counts","!(z.zone === \"library\" && mine)","!(z.zone === \"library\")"],
  ["ex playable: own hand counts as a second hand","!(z.zone === \"hand\" && !mine)) continue;","!(z.zone === \"hand\")) continue;"],
  ["ex playable: never sent","    if (playable.length) row.playable = playable;\n",""],
  ["ex playable: emptied list reused","if (pl[z] == null) { delete game.sentZones[pl.color + \"|\" + z]; continue; }","if (pl[z] == null) { continue; }"],
  // 2026-10-21 hand-play sweep fixes
  ["sw1 rank: hybrid only checks the first half", "if (parts.some((x) => made.has(x))) needed = true;", "if (made.has(parts[0])) needed = true;"],
  ["sw1 rank: generic ignored", "return needed ? 2 : generic ? 1 : 0;", "return needed ? 2 : 0;"],
  ["sw1 rank: undo buttons ranked too", "...(a.type === \"undoMana\" ? {} : { rank:", "...(false ? {} : { rank:"],
  ["sw3 targets: <= instead of <", "if (input.candidates.length < minLeft) {", "if (input.candidates.length <= minLeft) {"],
  ["sw4 picked: not sent", "toTTS({ t: \"picked\", color: seat.color, id: m.id });", ""],
  ["sw5 pile target: exile only", "(z.zone === \"graveyard\" || z.zone === \"exile\") && z.cards.some((x) => x.id === c.id)", "(z.zone === \"exile\") && z.cards.some((x) => x.id === c.id)"],
  ["pt3 tap: one {T} ability asks instead of acting", "if (taps.length === 1) return act(taps[0]);", ""],
  ["pt3 tap: any ability counts, not just {T}", "/\\{T\\}/.test(`${a.cost", "/\\{/.test(`${a.cost"],
  ["pt3 tap: casting counts as a tap ability", "&& a.type !== \"cast\" && !/^play /i", "&& !/^play /i"],
  ["pt3 tap: cost field ignored", "/.test(`${a.cost || \"\"} ${a.label", "/.test(`${\"\"} ${a.label"],
  ["pt3 tap: no {T} ability is not refused", "if (!taps.length) return refuse(seat, m.id, `${name} can't be tapped for anything right now.`);", "if (!taps.length) return;"],
  ["multi answer: too few allowed (< → <=)", "picks.length < ui.min || picks.length > ui.max", "picks.length <= ui.min || picks.length > ui.max"],
  ["end turn: != null → truthiness", "if (seat.endTurnAt != null && seat.endTurnAt === gv.turn)", "if (seat.endTurnAt && seat.endTurnAt === gv.turn)"],
  ["pay: no 'pay from pool' button", `...(input.canConfirmFromPool ? [{ id: "__pool", label: "Pay from mana pool" }] : autoFailed`, `...(false ? [{ id: "__pool", label: "Pay from mana pool" }] : autoFailed`],
  ["shortUrl: front/back swapped", `(m[1] === "front" ? "kf" : "kb")`, `(m[1] === "front" ? "kb" : "kf")`],
  // EQUIVALENT: byAttacker only holds must-attack entries here, set to validTargetIds[0], the same value "=" writes
  ["attack: must-attack target overwritten by All attack (??= → =) [equivalent: only a must-attack entry is set before it, to the same value, since All is not chosen when one must attack]", "byAttacker[at.attackerId] ??= many(at) ? \"?\" : at.validTargetIds[0];", "byAttacker[at.attackerId] = many(at) ? \"?\" : at.validTargetIds[0];"],
  ["block label: > 1 → >= 1", "at.minBlockers > 1 ?", "at.minBlockers >= 1 ?"],
  ["scry: > 2 → >= 2 (a plain scry placed card by card)", "      if (input.zones.length > 2) {\n        // each card gets its own destination", "      if (input.zones.length >= 2) {\n        // each card gets its own destination"],
  ["order: one item no longer automatic (<= 1 → < 1)", "if (items.length <= 1) return { auto:", "if (items.length < 1) return { auto:"],
  ["damage auto: no min with what is left", "const dmg = last ? left : Math.min(left, a.lethal);", "const dmg = last ? left : a.lethal;"],
  ["deathtouch lethal 1 → 0", "return input.attackerHasDeathtouch ? 1 :", "return input.attackerHasDeathtouch ? 0 :"],
  ["cardLabel: hidden cards named", `if (c.visibility === "hidden" || !c.identity) return "(face-down)";`, `if (!c.identity) return "(face-down)";`],
  ["whyNot: >= → > on land count", "me.landsPlayedThisTurn >= (me.maxLandPlaysPerTurn || 1)", "me.landsPlayedThisTurn > (me.maxLandPlaysPerTurn || 1)"],
  ["imgOf: face-down cards get pictures", `const name = c && c.visibility !== "hidden" ? c.identity?.name : null;`, `const name = c ? c.identity?.name : null;`],
  ["multi options no longer sorted A-Z", `.sort((x, y) => String(x.label ?? "").localeCompare(String(y.label ?? ""), undefined, { numeric: true }))];`, "];"],
  ["multi options: numbers sorted as text (#1, #10, #2)", `localeCompare(String(y.label ?? ""), undefined, { numeric: true }))];`, `localeCompare(String(y.label ?? "")))];`],
  ["multi options: the bridge's own buttons sorted in too", "    ui.options = [...quick, ...ui.options.filter((o) => !String(o.id).startsWith(\"__\")).sort(", "    ui.options = [...ui.options.sort("],
  ["AI warning regex typo", "if (/^AI can't play/i.test(title))", "if (/^AI cannot play/i.test(title))"],
  ["ninjutsu stop: combatDamage dropped", `["combatDeclareBlockers", "combatFirstStrikeDamage", "combatDamage"].includes(gv.step)`, `["combatDeclareBlockers", "combatFirstStrikeDamage"].includes(gv.step)`],
  ["tableNames: case-sensitive lookup (toLowerCase dropped)", "nameOf(`player-${slotOf.get(m.toLowerCase())}`)", "nameOf(`player-${slotOf.get(m)}`)"],
  ["tableNames: case-sensitive match (i flag dropped)", ".join(\"|\")})(?![\\\\w-])`, \"gi\")", ".join(\"|\")})(?![\\\\w-])`, \"g\")"],
  ["tableNames: shortest name first", ".sort((a, b) => b[0].length - a[0].length);\n    game.nameMatch", ".sort((a, b) => a[0].length - b[0].length);\n    game.nameMatch"],
  ["reveal: no game-log line", `toTTS({ t: "gamelog", lines: [line] });`, "/* removed */"],
  ["discard drags: need min instead of max(1,min)", "const need = p.type === \"mulliganPutBack\" ? input.count : Math.max(1, input.min || 0);", "const need = p.type === \"mulliganPutBack\" ? input.count : (input.min || 0);"],
  ["hello: open prompts not shown again", "for (const st of game.seats.values()) if (st.prompt?.ui) showPrompt(", "for (const st of game.seats.values()) if (false) showPrompt("],
  // (the rest of Resolve all, Resolve N× and the top-only own-spell stop: test_bridge_claims.js "Big stacks, 2026-11-12", each
  // one red with its fix taken out)
  ["resolve all: another player's new item never stops it", "const theirs = stack.find((x) => !rs.ids.has(x.id) && x.controllerId !== seat.slot && x.controllerId !== rs.by);", "const theirs = null;"],
  ["combat stop: never","const combatStop = !turnOf(gv, who) && attacking &&","const combatStop = false &&"],
  ["combat stop: in every step","&& [\"combatDeclareAttackers\", \"combatDeclareBlockers\"].includes(gv.step);","&& true;"],
  ["queued play: never cast","        if (act) {\n          seat.queuedPlay = null;\n          log(","        if (false) {\n          seat.queuedPlay = null;\n          log("],
  ["queued play: lands kept too","if (card && !(card.types || []).includes(\"Land\")) {","if (card) {"],
  ["cost cards: Cancel never offered", "        cancel: input.cancellable,", "        cancel: false,"],
  // ── 2026-11-24 additions: code since 2026-11-18 that had no mutant (formats, trigger loop, Repeat xN, Taxes, exile link)
  // formats and ban lists (format-banlist-spec)
  ["fm noteMode: banned switch read by truthiness (absent = off)", "const banned = !f || m.banned !== false,", "const banned = !f || !!m.banned,"],
  ["fm noteMode: restricted switch read by truthiness (absent = off)", "restricted = !f || m.restricted !== false;", "restricted = !f || !!m.restricted;"],
  ["fm noteMode: Casual Commander kept as a format", "const f = fk && fk !== formatRules.DEFAULT_FORMAT ? fk : null;", "const f = fk || null;"],
  ["fm modeOf: case not folded", "const modeOf = (x) => { const k = String(x ?? \"\").trim().toLowerCase();", "const modeOf = (x) => { const k = String(x ?? \"\").trim();"],
  ["fm modeWords: one player called 1v1 (=== 2 → <= 2)", "return players === 2 ? \"Standard, 1v1\"", "return players <= 2 ? \"Standard, 1v1\""],
  ["fm Standard: 60 cards refused (< → <=)", "if (cards.length < 60) problems.push(", "if (cards.length <= 60) problems.push("],
  ["fm Standard: 15-card sideboard refused (> → >=)", "if (sideboard.length > 15) problems.push(", "if (sideboard.length >= 15) problems.push("],
  ["fm Standard: 4 copies refused (> → >=)", "return (own ? inMain[n] || 0 : k) > lim ?", "return (own ? inMain[n] || 0 : k) >= lim ?"],
  ["fm Standard: basic lands counted for the 4", "if (basic(n) || lim === \"any\") return null;", "if (lim === \"any\") return null;"],
  ["fm Standard: sideboard not counted with the main deck", "for (const n of [...cards, ...sideboard]) counts[n] = (counts[n] || 0) + 1;", "for (const n of cards) counts[n] = (counts[n] || 0) + 1;"],
  ["fm Standard: a banned card also said outside the sets", "const outside = names.filter((n) => !f.banned.has(n) && !f.legal.has(n));", "const outside = names.filter((n) => !f.legal.has(n));"],
  ["fm listFor: legality data without the format used (&& → ||)", "if (l && l.has(f.key)) {", "if (l || l.has(f.key)) {"],
  ["fm readyFor: no Commander default for an old deck", "(readyDecks[c].rules || readyDecks[c].mode || \"commander\") === rules;", "(readyDecks[c].rules || readyDecks[c].mode) === rules;"],
  ["fm readyForGame: list hash compared too", "noHash(readyDecks[c].rules || readyDecks[c].mode || \"commander\") === noHash(rules);", "(readyDecks[c].rules || readyDecks[c].mode || \"commander\") === rules;"],
  ["fm refresh: a deck that still passes keeps the old hash", "if (!fc.problems.length) { d.rules = `${r.format}|${r.banned}|${r.restricted}|${fc.hash}`; continue; }", "if (!fc.problems.length) continue;"],
  ["fm refresh: Standard cache kept [equivalent: every format cache key carries the list's hash, and the no-format Standard path reads no legality data]", "  legalStandard.clear();\n  const dropped = [];", "  const dropped = [];"],
  ["fm onFormat: AI seats said off-mode at every format change", "  if (gameMode.mode !== before) aiSeatsOffMode(gameMode.mode);", "  aiSeatsOffMode(gameMode.mode);"],
  ["fm onFormat: the table not marked as having formats", "  tableHasFormats = true;\n", ""],
  ["fm aiSeatsOffMode: a deck without format read as Standard", "(aiSeatChoice[c].deck.deck.format || \"commander\") !== MODES[k].deck", "(aiSeatChoice[c].deck.deck.format || \"standard\") !== MODES[k].deck"],
  ["fm deck check: a newer check's colours kept from an older one (=== → >=)", "filter(([c]) => deckGen[c] === looked[c])", "filter(([c]) => deckGen[c] >= looked[c])"],
  ["fm reset: a check waiting on Scryfall kept", "      for (const c of Object.keys(deckGen)) deckGen[c]++;", "      for (const c of Object.keys(deckGen)) void c;"],
  // the trigger-loop shortcut (tloop, 2026-11-23/24)
  ["tl TLOOP_AT 3 → 4", "const TLOOP_AT = 3;", "const TLOOP_AT = 4;"],
  ["tl a trigger told by its flag only (|| → &&)", "const tloopIsTrig = (s) => !!s && (s.isTrigger || ", "const tloopIsTrig = (s) => !!s && (s.isTrigger && "],
  ["tl batch: any trigger a batch (> 1 → >= 1)", "for (const [k, n] of onStack) if (n > 1) seen.batch.add(k);", "for (const [k, n] of onStack) if (n >= 1) seen.batch.add(k);"],
  ["tl batch: never a batch", "for (const [k, n] of onStack) if (n > 1) seen.batch.add(k);", ""],
  ["tl a cast during a run resets its count", "    if (game.tloop) continue; // (a run under way keeps its count", "    // (a run under way keeps its count"],
  ["tl a cast resets the other players' counts (=== → !==)", "for (const [k, c] of seen.ctl) if (c === s.controllerId) seen.counts.delete(k);", "for (const [k, c] of seen.ctl) if (c !== s.controllerId) seen.counts.delete(k);"],
  ["tl a cast resets nothing", "for (const [k, c] of seen.ctl) if (c === s.controllerId) seen.counts.delete(k);", ""],
  ["tl passes done off by one", "if (tl) tl.done = (seen.counts.get(tl.lead) || 0) - tl.at;", "if (tl) tl.done = (seen.counts.get(tl.lead) || 0) - tl.at + 1;"],
  ["tl companions need the full count", "const many = [...seen.counts].filter(([, n]) => n >= TLOOP_AT - 1);", "const many = [...seen.counts].filter(([, n]) => n >= TLOOP_AT);"],
  ["tl a batch counts as a loop", "const lead = many.filter(([k, n]) => n >= TLOOP_AT && !seen.batch.has(k))", "const lead = many.filter(([k, n]) => n >= TLOOP_AT)"],
  ["tl lead: the fewest, not the most (args swapped)", ".sort((a, b) => b[1] - a[1])[0];\n  if (!lead) return null;", ".sort((a, b) => a[1] - b[1])[0];\n  if (!lead) return null;"],
  ["tl another player's triggers in the loop", "const sigs = many.map(([k]) => k).filter((k) => seen.ctl.get(k) === ctl);", "const sigs = many.map(([k]) => k);"],
  ["tl a No (0) counts as accepted (> 0 → >= 0)", "return Math.min(tl.total, ...Object.values(tl.acc).filter((n) => n > 0));", "return Math.min(tl.total, ...Object.values(tl.acc).filter((n) => n >= 0));"],
  ["tl run stops a pass early (> → >=)", "if (tl.done > tloopLimit(tl)) return \"\";", "if (tl.done >= tloopLimit(tl)) return \"\";"],
  ["tl a response of the loop's own card ends it (&& → ||)", "const other = (gv.stack || []).find((s) => !tl.stackAt.has(s.id) && !tl.sigs.has(tloopSig(s)));", "const other = (gv.stack || []).find((s) => !tl.stackAt.has(s.id) || !tl.sigs.has(tloopSig(s)));"],
  ["tl a response never ends it", "  if (other) return `${other.identity?.name || \"something\"} (${nameOf(other.controllerId)}) went on the stack`;\n", ""],
  ["tl end: the passes said uncapped", "const done = Math.min(tl.done, tloopLimit(tl));", "const done = tl.done;"],
  ["tl end: offered again in the same step", "  game.tloopNo = tloopNoKey(tl, tl.lead); // (not offered again in this step)\n", ""],
  ["tl end: panels left up", "  for (const s of game.seats.values()) tloopPanel(s);\n}\n// A run starts", "}\n// A run starts"],
  ["tl accept: more than the total kept", "  n = Math.min(n, tl.total);\n  tl.acc[seat.color] = n;", "  tl.acc[seat.color] = n;"],
  ["tl accept: '(of Infinity)' said for All", "${tl.total !== Infinity && n < tl.total ? ` (of ${tl.total})` : \"\"}", "${n < tl.total ? ` (of ${tl.total})` : \"\"}"],
  ["tl pick: a blank or 0 answer read as No (> 0 → >= 0)", "Number(v) > 0 ? Number(v) : null;", "Number(v) >= 0 ? Number(v) : null;"],
  ["tl panel: shown again after a No (in → truthiness)", "tl.proposed && !(seat.color in tl.acc);", "tl.proposed && !tl.acc[seat.color];"],
  ["tl panel: the controller asked to accept its own loop", "const want = tl && seat.slot !== tl.ctl && tl.proposed", "const want = tl && tl.proposed"],
  ["tl panel number: NaN kept [equivalent: every reader of acc tests > 0 or membership, so NaN and negatives act as 0, and the chat says the same]", "const n = Math.max(0, Math.floor(Number(asList(choice)[0])) || 0);", "const n = Math.floor(Number(asList(choice)[0]));"],
  ["tl offer: another player's question offers the run", "if (!found || found.ctl !== seat.slot || !found.srcs.has(prompt.sourceCard.id)) return { ui, toOutput };", "if (!found || !found.srcs.has(prompt.sourceCard.id)) return { ui, toOutput };"],
  ["tl offer: offered again after Answer as usual", "  if (game.tloopNo === tloopNoKey(gv, found.lead)) return { ui, toOutput };\n", ""],
  ["tl offer: How many 1 refused (>= 1 → > 1)", "if (n >= 1) return start(n); game.tloopNo", "if (n > 1) return start(n); game.tloopNo"],
  ["tl own: a kept answer used when only some options are there (every → some)", "if (ids && ids.every((id) => have.has(String(id)))) {", "if (ids && ids.some((id) => have.has(String(id)))) {"],
  ["tl own: a changed question asked inside the run", "  if (ids) { tloopEnd(\"its question changed\"); return { answered: false, toOutput }; }\n", ""],
  ["tl keep: the bridge's own buttons kept as the answer", "if (tl && !String(a[0] ?? \"\").startsWith(\"__\")) tl.answers.set(key, [...a]);", "if (tl) tl.answers.set(key, [...a]);"],
  ["tl passes: one pass short for an accepting seat (<= → <)", "return acc > 0 && tl.done <= acc;", "return acc > 0 && tl.done < acc;"],
  ["tl passes: a No seat passed too (> 0 → >= 0)", "return acc > 0 && tl.done <= acc;", "return acc >= 0 && tl.done <= acc;"],
  ["tl passes: the controller's own priority asked", "  if (seat.slot === tl.ctl) return true;\n  const acc = tl.acc[seat.color];", "  const acc = tl.acc[seat.color];"],
  ["tl passes: any item on top passes", "  if (!top || !tl.sigs.has(tloopSig(top))) return false;\n", "  if (!top) return false;\n"],
  ["tl game end: the run not said", "        tloopEnd(\"the game ended\"); // (a loop of triggers that ended it", "        // (a loop of triggers that ended it"],
  // Repeat ×N (loopStep / loopPicker)
  ["rp a pass's end: one pass too many (>= → >)", "if (lp.done >= lp.total) return stop(\"\");", "if (lp.done > lp.total) return stop(\"\");"],
  ["rp a pass's end: the board not compared", "    if (loopSig(gv, seat.slot) !== lp.sig) return stop(\"the board isn't the one the pass started from\");\n", ""],
  ["rp step: the step change missed (|| → &&)", "if (gv.turn !== lp.turn || gv.step !== lp.step) return stop(\"the step changed\");", "if (gv.turn !== lp.turn && gv.step !== lp.step) return stop(\"the step changed\");"],
  ["rp their trigger stops it (|| → &&)", "s.controllerId !== seat.slot && !(s.isTrigger || /^(When|Whenever|At)", "s.controllerId !== seat.slot && !(s.isTrigger && /^(When|Whenever|At)"],
  ["rp How many: 0 starts a run (>= 1 → >= 0)", "return n >= 1 ? loopBegin(seat, offer, n) : backUnder(seat);", "return n >= 0 ? loopBegin(seat, offer, n) : backUnder(seat);"],
  ["rp a manual fix doesn't stop it", "  if (game?.fix) return stop(\"a manual fix is under way\");\n", ""],
  // Taxes (2026-11-22/23)
  ["tx any mode taken (only pay/no)", "taxAuto[color] = mode === \"pay\" || mode === \"no\" ? mode : undefined;", "taxAuto[color] = mode !== \"ask\" ? mode : undefined;"],
  ["tx Pay and No swapped", "o.id === (mode === \"pay\" ? \"yes\" : \"no\")", "o.id === (mode === \"pay\" ? \"no\" : \"yes\")"],
  ["tx No still auto-pays the next payment", "seat.taxPay = mode === \"pay\" ? tax : null;", "seat.taxPay = tax;"],
  ["tx a question for a controlled player answered", "if (tax && !forP && taxAuto[seat.color] && taxAnswer(", "if (tax && taxAuto[seat.color] && taxAnswer("],
  ["tx the payment matched by card AND name (|| → &&)", "(input.cardId === taxPay.card || (input.cardName || src) === taxPay.name)", "(input.cardId === taxPay.card && (input.cardName || src) === taxPay.name)"],
  ["tx the pending payment kept past the next question", "  const taxPay = seat.taxPay;\n  seat.taxPay = null;\n", "  const taxPay = seat.taxPay;\n"],
  ["tx button: no 'ask' default in the words", "const mode = taxAuto[m.color] || \"ask\";", "const mode = taxAuto[m.color];"],
  ["tx button: the open question closed as not answered [equivalent: closePrompt's answered flag only gives back an askUnder card, and a tax question is never one]", "taxAnswer(seat, p.promptId, p.type, p.ui, p.toOutput, p.tax)) closePrompt(seat, true);", "taxAnswer(seat, p.promptId, p.type, p.ui, p.toOutput, p.tax)) closePrompt(seat);"],
  ["tx own card's tax answered too", "taxCtl != null && taxCtl !== seat.slot) tax =", "taxCtl != null) tax ="],
  ["tx a pay-for ('If you do') counted as a tax", "if (!u && !paysFor && prompt.sourceCard?.id && taxCtl != null", "if (!u && prompt.sourceCard?.id && taxCtl != null"],
  ["tx != null → truthiness on the controller [equivalent: controller ids are always 'player-N' strings, never '' or 0]", "prompt.sourceCard?.id && taxCtl != null && taxCtl !== seat.slot", "prompt.sourceCard?.id && taxCtl && taxCtl !== seat.slot"],
  ["tx controller from the prompt first (?? args swapped)", "const taxCtl = byId[prompt.sourceCard?.id]?.controllerId ?? prompt.sourceCard?.controllerId;", "const taxCtl = prompt.sourceCard?.controllerId ?? byId[prompt.sourceCard?.id]?.controllerId;"],
  // the exile link (exileLinkMatters, EXILE_LINK_WORDS, exiledWithNote; 2026-11-24)
  ["el a card playable through its host not linked", "if (host === c.id || c.returnsWhenHostLeaves || c.mayPlay) return true;", "if (host === c.id || c.returnsWhenHostLeaves) return true;"],
  ["el an until-leaves card not linked by its flag", "if (host === c.id || c.returnsWhenHostLeaves || c.mayPlay) return true;", "if (host === c.id || c.mayPlay) return true;"],
  ["el a face-down host's card unlinked", "return text === \"\" || EXILE_LINK_WORDS.test(text);", "return EXILE_LINK_WORDS.test(text);"],
  ["el every exile linked (the Wandering Emperor bug)", "return text === \"\" || EXILE_LINK_WORDS.test(text);", "return true;"],
  ["el words: case-sensitive (i flag dropped)", "|\\bremains? exiled\\b/i;", "|\\bremains? exiled\\b/;"],
  ["el words: imprint dropped", "|\\bimprint(?:ed)?\\b|", "|"],
  ["el words: hideaway dropped", "|\\bhideaway\\b|", "|"],
  ["el words: cage counters dropped", "|\\bcage counters?\\b|", "|"],
  ["el words: until-leaves dropped", "|\\buntil [^.]*\\bleaves the battlefield\\b|", "|"],
  ["el words: remains exiled dropped", "|\\bremains? exiled\\b/i;", "/i;"],
  ["el words: exiled with dropped", "const EXILE_LINK_WORDS = /\\bexiled with\\b|", "const EXILE_LINK_WORDS = /"],
  ["el host text: the seen card text not used", "return h?.isFaceDown ? \"\" : String(h?.text || game?.cardText?.[id] || \"\");", "return h?.isFaceDown ? \"\" : String(h?.text || \"\");"],
  ["el host text: a face-down host's text read", "return h?.isFaceDown ? \"\" : String(h?.text || game?.cardText?.[id] || \"\");", "return String(h?.text || game?.cardText?.[id] || \"\");"],
  ["el note: host off the battlefield still named", "if (!host || host === c.id || !game?.tableCtx?.field?.has(host) || !exileLinkMatters(c)) return [];", "if (!host || host === c.id || !exileLinkMatters(c)) return [];"],
  ["el note: an unlinked exile named", "if (!host || host === c.id || !game?.tableCtx?.field?.has(host) || !exileLinkMatters(c)) return [];", "if (!host || host === c.id || !game?.tableCtx?.field?.has(host)) return [];"],
  ["el note: a card exiled by itself named", "if (!host || host === c.id || !game?.tableCtx?.field?.has(host) || !exileLinkMatters(c)) return [];", "if (!host || !game?.tableCtx?.field?.has(host) || !exileLinkMatters(c)) return [];"],
  ["el note: an until-leaves card said returned by a trigger", "if (!c.returnsWhenHostLeaves && /\\bleaves the battlefield, return the exiled cards?\\b/i.test(boardText(host))) {", "if (/\\bleaves the battlefield, return the exiled cards?\\b/i.test(boardText(host))) {"],
  ["el board: a cipher card overrides a real link", "...(c.encodedOn && !exileLinkMatters(c) ? { ew: c.encodedOn, enc: true } : {}),", "...(c.encodedOn ? { ew: c.encodedOn, enc: true } : {}),"],
  ["el board: a prepared copy overrides a real link", "...(!exileLinkMatters(c) && !c.encodedOn && game?.prepared?.has(c.id) ?", "...(!c.encodedOn && game?.prepared?.has(c.id) ?"],
  ["el face-down: link sent for every exile", "...(c.isForetold ? { fo: true } : {}), ...(exileLinkMatters(c) ? { ew: c.exiledWith,", "...(c.isForetold ? { fo: true } : {}), ...(c.exiledWith ? { ew: c.exiledWith,"],
  ["el face-down: the note outside exile too", "...(zone === \"exile\" ? notesOf(exiledWithNote(c)) : {}) };", "...notesOf(exiledWithNote(c)) };"],
  ["cost cards: Cancel answers as a choice", "      toOutput = (a) => {\n        if (a[0] === \"__cancel\") return { type: \"cancel\" };\n        if (game && src && bottomOf)", "      toOutput = (a) => {\n        if (game && src && bottomOf)"],
  ["targets: Cancel answers as a target", "        if (a[0] === \"__cancel\") return { type: \"cancel\" };\n        // (all of them, counted from the first", "        // (all of them, counted from the first"],
];


// The other bridge gates (all in tools/deploy.js GATES), cheapest first: run only for a mutant the golden lets through.
// Each loads the bridge through tests/bridge-harness.js (or BRIDGE_PATH itself), so it tests the mutant.
const GATES = [
  "test_bridge_lag", "test_bridge_exile_link", "test_bridge_3hg", "test_bridge_planar_owners", "test_bridge_3hg_team_block",
  "test_bridge_bo3_roll_choice", "test_bridge_attack_lines", "test_bridge_rejoin", "test_bridge_match_bo3", "test_bridge_scenario_checks",
  "test_bridge_team_modes", "test_bridge_gifs", "test_bridge_team_life_log", "test_bridge_unbounded_tokens", "test_bridge_legality",
  "test_bridge_2hg_team_block", "test_bridge_cost_badge_3", "test_bridge_bo3_extras", "test_bridge_stress_caps",
  "test_bridge_attack_tax_lethal", "test_bridge_cost_badge_4", "test_bridge_loop_quiet", "test_bridge_trigger_loop",
  "test_bridge_stack_split", "test_bridge_hand_land_question", "test_bridge_archenemy", "test_bridge_tie_offer",
  "test_bridge_planar_order", "test_bridge_library_order", "test_bridge_ability_sweep2", "test_bridge_sac_x_mana",
  "test_bridge_2hg_level2", "test_bridge_repeat_loop", "test_bridge_custom_art", "test_bridge_tax_auto",
  "test_bridge_archenemy_resume", "test_bridge_sideboard_imported", "test_bridge_mairsil_answers",
  "test_bridge_trigger_groups", "test_bridge_teams", "test_bridge_mairsil_look", "test_bridge_art_owner", "test_bridge_planar",
  "test_bridge_prompt_shapes", "test_bridge_archenemy_team_turns", "test_bridge_stress_catalog2", "test_bridge_formats",
  "test_bridge_mairsil_text", "test_bridge_repeat_yesno", "test_bridge_opening_hand", "test_bridge_hand", "test_bridge_standard",
  "test_bridge_ai_tools", "test_bridge_debug", "test_bridge_events", "test_bridge_big_turns", "test_bridge_custom_art_2",
  "test_bridge_cost_badge_2", "test_bridge_treachery_first", "test_foreign_names", "test_table_archenemy_view",
  "test_table_live_check_1", "test_table_2hg_team_block", "test_fix_hand_relations", "test_table_2hg_level2",
  "test_open_items_relations", "test_card_other_side", "test_rejoin_prompt", "test_bridge_six_golden", "test_bridge_claims",
  "test_table_token_entries",
];
const keyOf = (from, to) => sha(`${from}\u0000${to}`).slice(0, 16);
const equivalent = (name) => /\[equivalent\b/i.test(name);

// every mutation must apply exactly once: a stale one is the tool's failure, never a skip
const stale = M.map(([name, from, to]) => ({ name, count: pristine.split(from).length - 1, same: from === to })).filter((x) => x.count !== 1 || x.same);
const dupNames = M.map(([n]) => n).filter((n, i, a) => a.indexOf(n) !== i);
if (stale.length || dupNames.length) {
  for (const x of stale) console.log(`STALE  ${x.name}: ${x.same ? "the mutation changes nothing" : `its text is found ${x.count}x in bridge.js (must be 1)`}`);
  for (const n of dupNames) console.log(`DUPLICATE NAME  ${n}`);
  console.log(`\nmutate-bridge: ${stale.length + dupNames.length} of ${M.length} mutations can't be run as written: repair them`);
  process.exit(2);
}
if (process.argv.includes("--check")) { console.log(`all ${M.length} mutations apply exactly once`); process.exit(0); }

let list = M.filter(([n]) => !process.env.MUT_ONLY || new RegExp(process.env.MUT_ONLY).test(n));
const part = /^(\d+)\/(\d+)$/.exec(process.env.MUT_PART || "");
if (process.argv.includes("--summary")) list = [];
if (part) { const k = Number(part[1]), n = Number(part[2]); list = list.filter((_, i) => i % n === k - 1); }

let saved = {};
try { saved = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { saved = {}; }
if (Array.isArray(saved)) saved = {}; // (the old format: a list without mutation keys, not comparable)
const save = () => fs.writeFileSync(OUT, JSON.stringify(saved, null, 1));

// a gate run: null when it passes, else its first failing line (by name), "timeout", or the crash's first line
function gate(args, label) {
  try {
    execFileSync(process.execPath, args, { cwd: ROOT, env: { ...process.env, BRIDGE_PATH: MUTANT }, stdio: "pipe", timeout: 600000, maxBuffer: 256 * 1024 * 1024 });
    return null;
  } catch (e) {
    if (e.code === "ETIMEDOUT" || e.signal === "SIGTERM") return `${label}: timeout`;
    const out = String(e.stdout || "");
    const line = out.split("\n").find((l) => /^\s*FAIL\b/.test(l)) || String(e.stderr || "").split("\n").find((l) => l.trim()) || `exit ${e.status}`;
    return `${label}: ${line.trim()}`;
  }
}
const checkLive = () => { if (sha(fs.readFileSync(SRC, "utf8")) !== PRISTINE_SHA) throw new Error("the live bridge.js changed during the run: stop and look"); };
const cleanup = () => { try { fs.unlinkSync(MUTANT); } catch { /* gone already */ } };
process.on("SIGINT", () => { cleanup(); process.exit(130); });

for (const [name, from, to] of list) {
  checkLive();
  const key = keyOf(from, to);
  // (a result for this very mutation on this very bridge.js is kept: MUT_RERUN=1 runs it again)
  if (!process.env.MUT_RERUN && saved[name]?.key === key && saved[name].bridge === PRISTINE_SHA.slice(0, 16) && !saved[name].goldenOnly === !process.env.MUT_GOLDEN_ONLY) continue;
  const mutant = pristine.replace(from, to);
  fs.writeFileSync(MUTANT, mutant);
  if (sha(fs.readFileSync(MUTANT, "utf8")) !== sha(mutant)) throw new Error("the mutant was not written as made");
  const t0 = Date.now();
  let by = gate([__filename, "--golden-child"], "golden");
  let where = by ? "golden" : null;
  if (!by && !process.env.MUT_GOLDEN_ONLY) {
    for (const g of GATES) {
      by = gate([path.join(ROOT, "tests", `${g}.js`)], g);
      if (by) { where = g; break; }
    }
  }
  fs.writeFileSync(MUTANT, pristine);
  if (sha(fs.readFileSync(MUTANT, "utf8")) !== PRISTINE_SHA) throw new Error("restore of the mutant copy failed");
  checkLive();
  const result = by ? "caught" : "ESCAPED";
  saved[name] = { key, bridge: PRISTINE_SHA.slice(0, 16), result, where, by: by ? by.slice(0, 200) : null, goldenOnly: !!process.env.MUT_GOLDEN_ONLY, s: Math.round((Date.now() - t0) / 1000) };
  save();
  console.log(`${by ? "caught " : "ESCAPED"}  ${name}${by ? `   <- ${by.slice(0, 120)}` : ""}`);
}
cleanup();

// the grade, over the current list's entries run on this bridge.js
const cur = M.map(([name, from, to]) => ({ name, r: saved[name] })).filter(({ name, r }) => r && r.key === keyOf(...M.find(([n]) => n === name).slice(1)) && r.bridge === PRISTINE_SHA.slice(0, 16));
const notRun = M.length - cur.length;
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
const grade = (rate) => (rate === 0 ? "suspicious (0%: check the mutants vary)" : rate < 0.25 ? "SOUND" : "WEAK");
const counted = cur.filter(({ name, r }) => !(equivalent(name) && r.result === "ESCAPED"));
const esc = counted.filter(({ r }) => r.result === "ESCAPED");
const goldenEsc = counted.filter(({ r }) => r.where !== "golden");
console.log(`\n${cur.length} of ${M.length} mutations have a result on this bridge.js${notRun ? ` (${notRun} not run yet)` : ""}`);
console.log(`golden master alone: ${goldenEsc.length} of ${counted.length} escaped (${pct(goldenEsc.length, counted.length)})${counted.length ? ` -> ${grade(goldenEsc.length / counted.length)}` : ""}`);
if (!cur.some(({ r }) => r.goldenOnly)) console.log(`all bridge gates: ${esc.length} of ${counted.length} escaped (${pct(esc.length, counted.length)})${counted.length ? ` -> ${grade(esc.length / counted.length)}` : ""}`);
for (const { name } of cur.filter(({ name, r }) => equivalent(name) && r.result === "ESCAPED")) console.log(`equivalent (not counted)  ${name}`);
for (const { name, r } of esc) console.log(`ESCAPED  ${name}`);
