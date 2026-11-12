// Adversary pass for the bridge golden master (jr-programmer-suite §2b): applies plausible careless edits to a
// COPY of bridge/bridge.js, one at a time, and records whether tests/test_bridge_golden.js catches each.
// The live bridge file is never touched; each mutant is written fresh from the pristine text (checked by hash).
//   node tools/mutate-bridge.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "bridge", "bridge.js");
// the mutant sits next to the real bridge (its paths to presets and card data must resolve the same way); the
// running bridge only ever loads bridge.js
const MUTANT = path.join(ROOT, "bridge", "bridge.mutant.js");
const pristine = fs.readFileSync(SRC, "utf8");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
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
  ["resume: not treated as a reconnect","this.joined = true; this.lostAt = Date.now(); this.tries = 0; }","this.joined = true; this.tries = 0; }"],
  ["resume: the slot is forgotten","this.slot = resume?.slot || null;","this.slot = null;"],
  ["save: kept after a reset","  clearResume(); // (a reset game is never rejoined)",""],
  ["save: not saved when the game starts","  saveResume();\n}","}"],
  ["labels: same mana told apart dropped","if (count[b] < 2) return b;","return b;"],
  ["pay: the colour only one land makes not preferred","? 3 : 2;","? 2 : 2;"],
  ["save: a finished game is kept","      clearResume(); // (a finished game is never rejoined)",""],
  ["aideck: a deck in an empty seat wins again","const botDecks = [...aiDeckChoice.map(loadPreset), ...game.aiTableDecks,","const botDecks = [...game.aiTableDecks, ...aiDeckChoice.map(loadPreset),"],
  // 2026-10-22 playtest: plain questions, the colour a cost needs
  ["pq colour: needed not first","(need.has(b) ? 1 : 0) - (need.has(a) ? 1 : 0)","0"],
  ["pq colour: (needed) not said","label: need.has(c) ? `${c} (needed)` : c","label: c"],
  ["pq colour: the cost forgotten before the colour","else if (type !== \"chooseColor\") seat.payingCost = null;","else seat.payingCost = null;"],
  ["pq colour: the cost kept after another question","else if (type !== \"chooseColor\") seat.payingCost = null;",""],
  ["pq colour: hybrid only first half","for (const x of sym.toUpperCase().split(\"/\")) if","for (const x of sym.toUpperCase().split(\"/\").slice(0, 1)) if"],
  ["pq title: triggered ability kept","t = t.replace(/^(.*?)Use triggered ability of (.+?)\\?$/i, \"$1Use $2?\")","t = t"],
  ["pq title: replacement kept",".replace(/^(.*?)Apply replacement effect of (.+?)\\?$/i, \"$1Use $2?\")",""],
  ["pq title: second line kept in the title","if (nl >= 0) { more","if (false) { more"],
  ["pq range: 0 not up-to","lo === \"0\" ? `up to ${hi}`","false ? `up to ${hi}`"],
  ["pq text: ability said twice","prompt.sourceAbilityText && !String(ui.text || \"\").includes(String(prompt.sourceAbilityText).slice(0, 60))","prompt.sourceAbilityText"],
  ["pq text: ability not shortened","? shorten(String(prompt.sourceAbilityText), 160) : null;","? String(prompt.sourceAbilityText) : null;"],
  ["ro top: not turned round","orderedIds: onTop ? [...ids].reverse() : ids","orderedIds: ids"],
  ["ro top: shown in the engine's order","onTop ? [...items].reverse() : items,","items,"],
  ["ro triggers: plain words lost","const trig = /^Order triggered abilities/i.test(title)","const trig = false"],
  ["ro bottom: not recognised","bottom = /bottom of [^.]*library in any order/i.test(what)","bottom = false"],
  ["ro top: any card's order counts","!!src && /library/i.test(what)","!!src"],
  ["ro top: a trigger order counts","const onTop = !trig && !bottom","const onTop = !bottom"],
  ["ab abort: said for each seat","if (game?.abortSaid) break;",""],
  ["ab abort: any library counts as empty","&& !zoneOf(gv, \"library\", p.id).count)","&& true)"],
  ["ab abort: the empty library never named","chat(empty.length ? `","chat(false ? `"],
  // 2026-10-22 Arena wording
  ["aw count: one as a number","return max === 1 ? `${/^[aeiou]/i.test(noun) ? \"an\" : \"a\"} ${noun}` : many(max);","return many(max);"],
  ["aw count: up-to lost","return min === 0 ? `up to ${many(max)}`","return min === 0 ? many(max)"],
  ["aw priority: Next/Resolve swapped","label: stackIds.length ? \"Resolve\" : \"Next\" }","label: stackIds.length ? \"Next\" : \"Resolve\" }"],
  ["aw target: hint word shown","/^[A-Z][a-z]+$/.test(t) ? TARGET_VERBS[t.toLowerCase()] ?? \"\" : null;","null;"],
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
  ["aw reveal: your library named as a player","=== seat.slot ? \"your\" :","=== \"x\" ? \"your\" :"],
  ["aw mulligan: count in the title","ui = { title: \"Keep this hand?\", mode: \"single\"","ui = { title: `Keep this hand? (${input.mulliganCount})`, mode: \"single\""],
  ["aw play: blank button for an ability","label: a.label || a.description || (a.type === \"cast\" ? `Cast ${name}` : \"Use its ability\") }","label: a.label }"],
  // 2026-10-22 review of the sweep's questions
  ["rv title: no card name in front",".includes(ui.kind)) ui.title = `${src}: ${ui.title}`;",".includes(ui.kind)) ui.title = ui.title;"],
  ["rv title: capital after the card name","ui.title = `${src}: ${rest[0].toLowerCase()}${rest.slice(1)}`;","ui.title = `${src}: ${rest}`;"],
  ["rv bottom: asked again","if (bottom) { seat.respond(prompt.promptId, type, { type: \"reorderDecision\", orderedIds: input.items.map((i) => i.id) }); return; }",""],
  ["rv search zones: Forge's words kept","q = `Look in your ${m[1]} for a card?`;","q = `Search your ${m[1]}?`;"],
  ["rv cancel search: asked after Done","if (/^Cancel Search\\?/i.test(title) && seat.cardsDone && seat.cardsDone.src === src) {","if (false) {"],
  ["rv cancel search: any card's Done counts","&& seat.cardsDone.src === src) {",") {"],
  ["rv cancel search: Done remembered past the next question","seat.cardsDone = null;\n        seat.respond(prompt.promptId, type, { type: \"decision\", value: true });","seat.respond(prompt.promptId, type, { type: \"decision\", value: true });"],
  ["rv sylvan count above the total","${u && u.k <= u.n ? ` (${u.k} of ${u.n})` : \"\"}","${u ? ` (${u.k} of ${u.n})` : \"\"}"],
  ["rv title: a second heading","!/^[^:]{1,40}: /.test(String(ui.title)) && ",""],
  ["rv clash: Forge's lines kept","if (/ reveals: .*Mana Value=/i.test(title)) {","if (false) {"],
  ["rv clash: nobody-wins kept as Forge says","/no winner/i.test(end) ? \"Nobody wins.\" :","false ? \"Nobody wins.\" :"],
  ["rv clash: you named as a player","${isMe(p) ? \"You\" : p}: ${c} (${v})","${p}: ${c} (${v})"],
  ["rv clash top/bottom: Yes/No","yes = \"Top\"; no = \"Bottom\";",""],
  ["rv free cast: Forge's sentence","q = `Cast ${m[1]} for free?`; yes = \"Cast it\"; no = \"Put in hand\";",""],
  ["rv sacrifice this token: not named","src && /^(this( token| permanent| creature)?|it)?$/i.test(m[1]) ? src :","false ? src :"],
  ["rv payment: no card name","${input.cardName || src ? ` for ${input.cardName || src}` : \"\"}"," for ${input.cardName}"],
  ["fc forced selection asked","if (input.options.length === 1 && (input.minTotal ?? 0) >= 1) {","if (false) {"],
  ["fc optional single answered","&& (input.minTotal ?? 0) >= 1) {",") {"],
  ["fc forced colour asked","if ((input.validColors || []).length === 1) {","if (false) {"],
  ["nm offspring stays a number","if (input.min === 0 && input.max === 1 && pay) {","if (false) {"],
  ["nm no cap on the number","max: Math.min(input.max, Math.max(input.min, 20)) };","max: input.max };"],
  ["nm multikicker title kept","ui = { title: times ? `${src ? `${src}: ` : \"\"}pay ${times[2]} how many times? (${times[1]})` :","ui = { title: false ? \"\" :"],
  ["nm a non-mana cost read as mana","ui = /^\\{/.test(pay[2])","ui = true"],
  ["nt notice asked","if (!(input.cards || []).length) {","if (false) {"],
  ["nt notice not in chat","chat(`[MTG] ${toMe}`, seat.color);",""],
  ["nt mode labels not trimmed",".replace(/\\s*\\([^()]{12,}\\)/g, \"\").trim() || `Choice",".replace(/\\s*\\([^()]{12,}\\)/g, \"\") || `Choice"],
  ["nt no plain default title","const title = input.presentation?.title || {","const title = input.presentation?.title || type || {"],
  ["nt your own name kept","const toMe = said.split(`${me} `).join(\"You \")","const toMe = said"],
  ["wd ward not recognised","&& /^Ward\\b/i.test(String(input.abilityText || input.presentation?.text || \"\"))) {","&& false) {"],
  ["wd reminder text kept",".replace(/\\s*\\([^()]{12,}\\)/g, \"\")",""],
  ["wd votes keep engine ids",".replace(/ \\(\\d+\\)/g, \"\")",""],
  ["wd X said as a number","? \"X\" : \"a number\"}","? \"a number\" : \"a number\"}"],
  ["wd Don't pay said No","if (no === \"Decline\" || no === \"No\") no = \"Don't pay\";","if (no === \"Decline\") no = \"Don't pay\";"],
  ["py pool ignored","const owed = costLeft(input.manaCost, pool);","const owed = input.manaCost;"],
  ["py exact colour not taken from the pool","for (const x of syms) if (!(/^[WUBRGC]$/.test(x) && take(x))) keep.push(x);","for (const x of syms) keep.push(x);"],
  ["py generic not reduced","const n = Math.max(0, Number(x) - spare);","const n = Number(x);"],
  ["cl clash: you named by username","const isMe = (p) => p === me || p === seat.username;","const isMe = (p) => p === me;"],
  ["cl clash: winner kept as the engine says","won ? (isMe(won[1]) ? \"You win.\" : `${won[1]} wins.`) :","won ? `${won[1]} wins.` :"],
  ["fix: stack not checked before holding","  if (!f || (gv.stack || []).length) return false;\n  f.held = { seat, prompt };","  if (!f) return false;\n  f.held = { seat, prompt };"],
  ["fix: question not held","      if (holdForFix(seat, prompt, gv)) return;\n",""],
  ["fix: table prompt left open","  f.spent = null;\n  if (seat.prompt) closePrompt(seat);","  f.spent = null;"],
  ["fix: caller votes too","s.color !== except && isPlaying(pub, s.slot)","isPlaying(pub, s.slot)"],
  ["fix: players who are out vote","s.color !== except && isPlaying(pub, s.slot)","s.color !== except"],
  ["fix: decline at the start ignored","if (f.state === \"voting\") { chat(`[MTG] Manual fix declined by ${color}.`); endFix(); return; }",""],
  ["fix: decline of the list applies anyway","        fixBackToEditing(f, null, `[MTG] ${color} declined the changes. Back to editing.`);","        fixApply(f, pub);"],
  ["fix: one yes is enough","      if (f.waiting.length) break;\n",""],
  ["fix: done while not paused","if (!f || f.state !== \"editing\") return chat(\"[MTG] The game isn't paused for a fix.\", color);","if (!f) return chat(\"[MTG] The game isn't paused for a fix.\", color);"],
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
  ["fix: rewind vote not checked","      if (pub.restoreVote?.status?.type === \"pending\") return chat(\"[MTG] Finish the rewind vote first.\", color);\n",""],
  ["fix: out players may call","  if (!isPlaying(pub, seat.slot)) return chat(\"[MTG] Players who are out can't change the game.\", color);\n",""],
  ["fix: optional fields required","if (kind.endsWith(\"?\")) continue;",""],
  ["fix: booleans as text pass","  bool: (v, k) => typeof v !== \"boolean\" && `${k} must be true or false.`,","  bool: () => false,"],
  ["fix: any library position","  position: (v) => v !== \"top\" && v !== \"bottom\" && `No library position ${v}.`,","  position: () => false,"],
  ["fix: any counter kind","  kind: (v) => !(typeof v === \"string\" && /^[A-Z][A-Z0-9_]*$/.test(v)) && `No counter kind ${v}.`,","  kind: () => false,"],
  ["fix: extra fields passed on","const op = { op: raw.op };","const op = { ...raw };"],
  ["fix: watchdog never fires","if (!f || f.state !== \"applying\" || Date.now() - f.appliedAt < FIX_ANSWER_MS) return;","return;"],
  ["fix: watchdog fires at once","if (!f || f.state !== \"applying\" || Date.now() - f.appliedAt < FIX_ANSWER_MS) return;","if (!f || f.state !== \"applying\") return;"],
  ["fix: watchdog off the tick","guarded(\"fix watchdog\", fixWatchdog); ",""],
  ["fix: an older question kept","  if (!f || (gv.stack || []).length) return false;\n  f.held = { seat, prompt };","  if (!f || (gv.stack || []).length || f.held) return false;\n  f.held = { seat, prompt };"],
  ["fix: spent question forgotten","  if (!f.held && f.spent) f.held = f.spent;\n",""],
  ["fix: rewind under a fix","  if (game.fix) return chat(\"[MTG] Finish the manual fix first (or cancel it).\", color);\n",""],
  ["fix: call after the game","  if (pub.gameOver) return chat(\"[MTG] The game is over.\", color);\n",""],
  ["fix: anything attaches","      if (!(c.subtypes || []).some((t) => /^(Aura|Equipment|Fortification)$/.test(t))) return","      if (false) return"],
  ["fix: token text sent as it is","kind === \"token\" ? tokenScript(v) : v;","v;"],
  ["fix: token colour ignored","    if (colours && parts[0] !== colours) continue;\n",""],
  ["fix: token size ignored","    if (pt && `${parts[1]}_${parts[2]}` !== pt) continue;\n",""],
  ["fix: token with the most words","parts.length < best.parts","parts.length > best.parts"],
  ["fix: token words not all needed","if (!rest.every((w) => parts.includes(w))) continue;","if (!rest.some((w) => parts.includes(w)) && rest.length) continue;"],
  ["fix: unknown tokens pass","  token: (v) => !tokenScript(v) && `No token called","  token: (v) => false && `No token called"],
  ["fix: commander colour not resolved","    if (op.op === \"commanderDamage\" && !byId[op.from]) {","    if (false) {"],
  ["fix: partner damage not taken off","      op.n = Math.max(0, op.n - others);\n",""],
  ["untap: never asked for floating mana","        || undos.length > 0;","        || false;"],
  ["untap: no Untap button","...undos.map((a) => ({ id: a.id, cardId: a.cardId, label: `Untap ${cname(a.cardId)} (mana back)` }))]","]"],
  ["dice: asked instead of told","      seat.respond(prompt.promptId, type, { type: \"diceRolledAcknowledged\" });\n      return;\n    }","      break;\n    }"],
  ["restart: finished game restarts anyway","        if (finished) { resetGame(\"Starting a new game...\"); go(); return; }\n",""],
  ["restart: aborted game not counted as finished","(game.abortSaid || [...game.seats.values()]","([...game.seats.values()]"],
  ["autoresolve: own turn passes too","      if (autoResolve[seat.color] && gv.activePlayerId !== seat.slot) {","      if (autoResolve[seat.color]) {"],
  ["autoresolve: ignored","      if (autoResolve[seat.color] && gv.activePlayerId !== seat.slot) {","      if (false) {"],
  ["autoresolve: waiting Resolve kept","      if (m.on && seat?.prompt?.type === \"chooseAction\" && gv && gv.activePlayerId !== seat.slot) {","      if (false) {"],
  ["resume: Start resets a live game","        if (live && !roomRestarting) {","        if (false) {"],
  ["resume: dead room counted live","[...game.seats.values()].every((st) => st.roomId && st.board?.state && !st.closed)","true"],
  ["resume: bridge restart doesn't redraw","  setTimeout(() => guarded(\"resend after resume\", resendToTable), 3000);\n",""],
  ["ex link: exiled-with dropped","...(c.exiledWith ? { ew: c.exiledWith, rl: !!c.returnsWhenHostLeaves } : {}),",""],
  ["ex link: returns flag always false","rl: !!c.returnsWhenHostLeaves","rl: false"],
  ["ex foretold dropped","...(c.isForetold ? { fo: true } : {}),",""],
  ["ex playable: command zone counts","if (z.zone !== \"exile\" && z.zone !== \"graveyard\") continue;","if (z.zone === \"hand\") continue;"],
  ["ex playable: never sent","    if (playable.length) row.playable = playable;\n",""],
  ["ex playable: emptied list reused","if (pl[z] == null) { delete game.sentZones[pl.color + \"|\" + z]; continue; }","if (pl[z] == null) { continue; }"],
  // 2026-10-21 hand-play sweep fixes
  ["sw1 rank: hybrid only checks the first half", "if (parts.some((x) => made.has(x))) needed = true;", "if (made.has(parts[0])) needed = true;"],
  ["sw1 rank: generic ignored", "return needed ? 2 : generic ? 1 : 0;", "return needed ? 2 : 0;"],
  ["sw1 rank: undo buttons ranked too", "...(a.type === \"undoMana\" ? {} : { rank:", "...(false ? {} : { rank:"],
  ["sw3 targets: <= instead of <", "if (input.candidates.length < (input.minTargets || 0)) {", "if (input.candidates.length <= (input.minTargets || 0)) {"],
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
  ["attack: must-attack target overwritten (??= → =) [equivalent]", "byAttacker[at.attackerId] ??= at.validTargetIds[0]", "byAttacker[at.attackerId] = at.validTargetIds[0]"],
  ["block label: > 1 → >= 1", "at.minBlockers > 1 ?", "at.minBlockers >= 1 ?"],
  ["scry: || → &&", "if (input.zones.length > 2 || input.cards.length === 1) {", "if (input.zones.length > 2 && input.cards.length === 1) {"],
  ["order: one item no longer automatic (<= 1 → < 1)", "if (items.length <= 1) return { auto:", "if (items.length < 1) return { auto:"],
  ["damage auto: no min with what is left", "const dmg = last ? left : Math.min(left, a.lethal);", "const dmg = last ? left : a.lethal;"],
  ["deathtouch lethal 1 → 0", "return input.attackerHasDeathtouch ? 1 :", "return input.attackerHasDeathtouch ? 0 :"],
  ["cardLabel: hidden cards named", `if (c.visibility === "hidden" || !c.identity) return "(face-down)";`, `if (!c.identity) return "(face-down)";`],
  ["whyNot: >= → > on land count", "me.landsPlayedThisTurn >= (me.maxLandPlaysPerTurn || 1)", "me.landsPlayedThisTurn > (me.maxLandPlaysPerTurn || 1)"],
  ["imgOf: face-down cards get pictures", `const name = c && c.visibility !== "hidden" ? c.identity?.name : null;`, `const name = c ? c.identity?.name : null;`],
  ["multi options no longer sorted A-Z", `.sort((x, y) => String(x.label ?? "").localeCompare(String(y.label ?? "")))];`, "];"],
  ["AI warning regex typo", "if (/^AI can't play/i.test(title))", "if (/^AI cannot play/i.test(title))"],
  ["ninjutsu stop: combatDamage dropped", `["combatDeclareBlockers", "combatFirstStrikeDamage", "combatDamage"].includes(gv.step)`, `["combatDeclareBlockers", "combatFirstStrikeDamage"].includes(gv.step)`],
  ["displayText: case-sensitive", "const needle = username.toLowerCase();", "const needle = username;"],
  ["reveal: no game-log line", `toTTS({ t: "gamelog", lines: [line] });`, "/* removed */"],
  ["discard drags: need min instead of max(1,min)", "Math.max(1, input.min || 0)", "(input.min || 0)"],
  ["hello: open prompts not shown again", "for (const st of game.seats.values()) if (st.prompt?.ui) toTTS(", "for (const st of game.seats.values()) if (false) toTTS("],
  // (the rest of Resolve all, Resolve N× and the top-only own-spell stop: test_bridge_claims.js "Big stacks, 2026-11-12", each
  // one red with its fix taken out)
  ["resolve all: another player's new item never stops it", "const theirs = stack.find((x) => !rs.ids.has(x.id) && x.controllerId !== seat.slot && x.controllerId !== rs.by);", "const theirs = null;"],
  ["combat stop: never","const combatStop = gv.activePlayerId !== seat.slot && attacking &&","const combatStop = false &&"],
  ["combat stop: in every step","&& [\"combatDeclareAttackers\", \"combatDeclareBlockers\"].includes(gv.step);","&& true;"],
  ["queued play: never cast","        if (act) {\n          seat.queuedPlay = null;\n          log(","        if (false) {\n          seat.queuedPlay = null;\n          log("],
  ["queued play: lands kept too","if (card && !(card.types || []).includes(\"Land\")) {","if (card) {"],
  ["cost cards: Cancel never offered", "        cancel: input.cancellable,", "        cancel: false,"],
  ["cost cards: Cancel answers as a choice", "        if (a[0] === \"__cancel\") return { type: \"cancel\" };\n", ""],
];

const results = [];
for (const [name, from, to] of M.filter(([n]) => !process.env.MUT_ONLY || new RegExp(process.env.MUT_ONLY).test(n))) {
  const count = pristine.split(from).length - 1;
  if (count !== 1) { results.push({ name, result: `NOT APPLIED (pattern found ${count}x)` }); continue; }
  const mutant = pristine.replace(from, to);
  fs.writeFileSync(MUTANT, mutant);
  let caught = false, first = "";
  try {
    execFileSync(process.execPath, [path.join(ROOT, "tests", "test_bridge_golden.js")], { env: { ...process.env, BRIDGE_PATH: MUTANT }, stdio: "pipe" });
  } catch (e) {
    caught = true;
    first = String(e.stdout).split("\n").find((l) => l.startsWith("FAIL")) || String(e.stderr).split("\n")[0];
  }
  fs.writeFileSync(MUTANT, pristine);
  if (sha(fs.readFileSync(MUTANT, "utf8")) !== PRISTINE_SHA) throw new Error("restore failed");
  results.push({ name, result: caught ? "caught" : "ESCAPED", by: first.slice(0, 140) });
  console.log(`${caught ? "caught " : "ESCAPED"}  ${name}${caught ? `   <- ${first.slice(0, 110)}` : ""}`);
}
fs.unlinkSync(MUTANT);
if (sha(fs.readFileSync(SRC, "utf8")) !== PRISTINE_SHA) throw new Error("the live bridge changed during the run");
const applied = results.filter((r) => !r.result.startsWith("NOT"));
const escaped = applied.filter((r) => r.result === "ESCAPED");
for (const r of results.filter((r) => r.result.startsWith("NOT"))) console.log(`${r.result}  ${r.name}`);
const rate = escaped.length / applied.length;
console.log(`\n${applied.length} mutations, ${escaped.length} escaped (${(rate * 100).toFixed(0)}%) -> ${rate === 0 ? "suspicious" : rate < 0.25 ? "SOUND" : "WEAK"}`);
fs.writeFileSync(path.join(ROOT, "tmp", "mutate-bridge.json"), JSON.stringify(results, null, 1));
