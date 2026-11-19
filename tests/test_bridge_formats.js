// The deck check per format (docs/format-banlist-spec.md §3, §5, §6.3, §7, §12; piece B): bridge/format-rules.js (the
// formats, formatProblems and its words) and the bridge's side (the format, hello, decks and start messages, the alert
// per format, deckReport, a start refused for a deck checked under other rules, a refresh between READY and Start, the
// rules in the game and the resume file, sideboarding and AI decks under a format). The ban list data is a stub of
// bridge/legality.js's interface (piece A). An older table's messages (no format) are today's checks: the golden's
// (tests/test_bridge_golden.js) and test_bridge_standard.js's, unchanged.
//   node tests/test_bridge_formats.js            (UPDATE=1 rewrites tests/golden/bridge-format-alerts.json)
const fs = require("fs");
const path = require("path");
const harness = require("./bridge-harness");
// (FORMAT_RULES_PATH: a copy of format-rules.js, tools/mutate-format-rules.js)
const R = require(process.env.FORMAT_RULES_PATH ? path.resolve(process.env.FORMAT_RULES_PATH) : "../bridge/format-rules");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${String(why).slice(0, 700)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const run = async (fn, opts) => { const h = harness.load(opts); try { return await fn(h); } finally { harness.restore(); } };
const say = (h, t, m) => h.B.onTTS({ t, json: JSON.stringify(m) });
const chatsSince = (h, mark) => h.effects.slice(mark).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const reportsSince = (h, mark) => h.effects.slice(mark).filter((e) => e.tts?.t === "deckReport").map((e) => e.tts);

const pairs = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "decks", `${id}.json`), "utf8"));
const RAKDOS = pairs("standard_rakdos_ingris").cards.map((c) => [c.count, c.name]); // (60)
const RAKDOS_SB = pairs("standard_rakdos_ingris").sideboard.map((c) => [c.count, c.name]); // (15)
const KYKAR = pairs("kykar_winds_fury"); // (100, the commander among the cards)
const KYKAR_CMD = KYKAR.commander;
const KYKAR_99 = KYKAR.cards.filter((c) => c.name !== KYKAR_CMD).map((c) => [c.count, c.name]);
const cardsOf = (list) => list.flatMap(([k, n]) => Array.from({ length: k }, () => ({ n, f: null })));
const entry = (lib, commander = [], deckName = "Test deck", sideboard = []) => ({ deckName, commander: commander.map((n) => ({ n, f: null })), library: cardsOf(lib), sideboard: cardsOf(sideboard) });
// a list with some counts changed ({ name: count }; 0 takes it out), Mountains (or Islands) making up the difference
const withCards = (base, changes, filler, total) => {
  const out = base.map(([k, n]) => [n in changes ? changes[n] : k, n]);
  for (const n of Object.keys(changes)) if (!out.some(([, m]) => m === n)) out.push([changes[n], n]);
  const sum = out.reduce((a, [k]) => a + k, 0);
  return out.map(([k, n]) => [n === filler ? k - (sum - total) : k, n]).filter(([k]) => k > 0);
};

// the ban list data, as bridge/legality.js gives it (piece A's interface): status by format and name ("l" for a name
// not in `table`, null for one in `unknown`), the formats it has data for
function stub(table = {}, { hash = "h1", source = "Scryfall", date = "2026-11-18", unknown = [], formats = R.FORMATS.filter((f) => f.list).map((f) => f.key) } = {}) {
  return {
    source, date, hash,
    has: (f) => formats.includes(f),
    status: (f, n) => (unknown.includes(n) ? null : table[f]?.[n] ?? table["*"]?.[n] ?? "l"),
    list: (f) => ({ banned: Object.keys(table[f] || {}).filter((n) => table[f][n] === "b"), restricted: Object.keys(table[f] || {}).filter((n) => table[f][n] === "r") }),
  };
}
// Blue's deck checked: { said, ready, deck, report }
async function check(h, e, extra = {}) {
  const mark = h.effects.length;
  say(h, "decks", { seats: { Blue: e }, request: 7, ...extra });
  await h.flush();
  const rep = reportsSince(h, mark).pop();
  return { said: chatsSince(h, mark).join("\n"), ready: !!rep?.ready?.includes("Blue"), deck: h.B._readyDecks.Blue, report: rep };
}

(async () => {
  // ── bridge/format-rules.js ──
  same("formats: the 17, in the Format button's order", R.FORMATS.map((f) => f.key), ["casualcommander", "commander", "duel", "paupercommander", "predh", "casual60",
    "standard", "pioneer", "modern", "legacy", "vintage", "pauper", "premodern", "oldschool", "historic", "timeless", "alchemy"]);
  same("formats: the game mode of each", R.FORMATS.map((f) => f.mode).join(","), "commander,commander,commander,commander,commander,standard,standard,standard,standard,standard,standard,standard,standard,standard,standard,standard,standard");
  same("formats: the restricted kinds", R.FORMATS.filter((f) => f.restricted).map((f) => `${f.key}:${f.restricted}`), ["duel:commander", "vintage:copy", "oldschool:copy", "timeless:copy"]);
  same("formats: no list in the two Casual formats", R.FORMATS.filter((f) => !f.list).map((f) => f.key), ["casualcommander", "casual60"]);
  same("formats: the default is Casual Commander (§12.1)", R.DEFAULT_FORMAT, "casualcommander");
  same("formatKey: as typed or sent", [" Modern", "DUEL", "pauper commander", "old_school", "brawl", null].map(R.formatKey), ["modern", "duel", "paupercommander", "oldschool", null, null]);
  same("formatWords", ["duel", "paupercommander", "predh", "casual60", "oldschool", "nope"].map(R.formatWords), ["Duel Commander", "Pauper Commander", "PreDH", "Casual 60-card", "Old School", "Casual Commander"]);
  same("notLegalReason: §5.3's words", Object.fromEntries(R.FORMATS.map((f) => [f.key, R.notLegalReason(f.key)])), {
    casualcommander: null, commander: "not a tournament card", duel: "not a tournament card", paupercommander: "not printed at common", predh: "not from its sets",
    casual60: null, standard: "not from its sets", pioneer: "not from its sets", modern: "not from its sets", legacy: "not a tournament card", vintage: "not a tournament card",
    pauper: "not a common", premodern: "not from its sets", oldschool: "not from its sets", historic: "not on MTG Arena", timeless: "not on MTG Arena", alchemy: "not on MTG Arena" });
  same("few: 8 names, then how many more", R.few(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]), "a, b, c, d, e, f, g, h, and 2 more");

  const basic = (n) => ["Mountain", "Island", "Plains", "Swamp", "Forest"].includes(n);
  const fp = (key, opts, cards, cmd, side) => R.formatProblems(key, { isBasic: basic, source: "Scryfall", date: "2026-11-18", ...opts }, cards, cmd, side);
  const st = (t) => (f, n) => t[n] ?? "l";
  const n60 = (extra = []) => [...Array(60 - extra.length).fill("Mountain"), ...extra];
  {
    const cards = n60(["Brainstorm", "Brainstorm", "Brainstorm", "Brainstorm"]);
    let r = fp("vintage", { status: st({ Brainstorm: "r" }) }, cards);
    same("vintage: 4× a restricted card, Restricted on", r.problems, ["restricted in Vintage (1 copy each): 4× Brainstorm"]);
    same("vintage: the closing line names the data and the switch", r.footer, "Ban list: Scryfall, 2026-11-18. The host can turn restricted cards off (Restricted cards button).");
    r = fp("vintage", { status: st({ Brainstorm: "r" }), restricted: false }, cards);
    same("vintage: Restricted off, 4 is the normal limit", r.problems, []);
    r = fp("vintage", { status: st({ Brainstorm: "r" }), restricted: false }, [...cards, "Brainstorm"]);
    same("vintage: Restricted off, 5 is still over 4", r.problems, ["more than 4 copies of: 5× Brainstorm (basic lands excepted)"]);
    r = fp("vintage", { status: st({ Brainstorm: "r" }) }, n60(["Brainstorm", "Ponder", "Ponder", "Ponder"]));
    same("vintage: one copy of a restricted card is fine", r.problems, []);
    r = fp("vintage", { status: st({ Brainstorm: "r" }) }, [...cards, "Brainstorm"]);
    same("vintage: a restricted card is not also said as over 4", r.problems, ["restricted in Vintage (1 copy each): 5× Brainstorm"]);
    r = fp("legacy", { status: st({ Brainstorm: "r" }) }, cards);
    same("legacy: no restricted list, an 'r' is nothing", r.problems, []);
  }
  {
    const cmdr = ["Kykar, Wind's Fury"], deck = [...Array(99).fill("Island")];
    let r = fp("duel", { status: st({ "Kykar, Wind's Fury": "r" }) }, deck, cmdr);
    same("duel: a restricted card as the commander", r.problems, ["restricted in Duel Commander (not as your commander): Kykar, Wind's Fury"]);
    r = fp("duel", { status: st({ Ponder: "r" }) }, [...Array(98).fill("Island"), "Ponder"], cmdr);
    same("duel: a restricted card in the 99 is fine", r.problems, []);
    r = fp("duel", { status: st({ "Kykar, Wind's Fury": "r" }), restricted: false }, deck, cmdr);
    same("duel: Restricted off lets it be the commander", r.problems, []);
    r = fp("commander", { status: st({}) }, [...Array(98).fill("Island")], cmdr);
    same("commander: 99 cards is a problem (§12.3)", r.problems, ["99 cards: Commander decks are exactly 100 cards, the commander included"]);
    r = fp("commander", { status: st({}) }, [...Array(97).fill("Island"), "Sol Ring", "Sol Ring"], cmdr);
    same("commander: two of a non-basic card is a problem (§12.3)", r.problems, ["more than one copy of: 2× Sol Ring (Commander decks are singleton; basic lands excepted)"]);
    r = fp("commander", { status: st({}), limit: (n) => (n === "Relentless Rats" ? "any" : n === "Seven Dwarves" ? 7 : undefined) }, [...Array(85).fill("Island"), ...Array(7).fill("Relentless Rats"), ...Array(7).fill("Seven Dwarves")], cmdr);
    same("commander: a card's own limit (any number, 7)", r.problems, []);
    r = fp("commander", { status: st({ "Sol Ring": "b", "Black Lotus": "n" }) }, [...Array(97).fill("Island"), "Sol Ring", "Black Lotus"], cmdr);
    same("commander: banned, then not legal (§5.2's order)", r.problems, ["banned in Commander: Sol Ring", "not legal in Commander (not a tournament card): Black Lotus"]);
    r = fp("commander", { status: st({ "Sol Ring": "b", "Black Lotus": "n" }), banned: false }, [...Array(97).fill("Island"), "Sol Ring", "Black Lotus"], cmdr);
    same("commander: banned off lets only the banned card through (§12.2)", [r.problems, r.allowedBanned], [["not legal in Commander (not a tournament card): Black Lotus"], ["Sol Ring"]]);
    same("commander: no banned or restricted problem, no closing line", r.footer, "");
    r = fp("casualcommander", { status: st({ "Sol Ring": "b" }) }, [...Array(97).fill("Island"), "Sol Ring", "Sol Ring"], cmdr);
    same("casual commander: no list, no shape problem (today's warnings are checkDeck's)", [r.problems, r.warnings], [[], []]);
    r = fp("commander", { status: (f, n) => (n === "Mox Fake" ? null : "l") }, [...Array(98).fill("Island"), "Mox Fake"], cmdr);
    same("commander: a name with no data is a warning", [r.problems, r.warnings], [[], ["not in the Commander card data, so not checked: Mox Fake"]]);
    r = fp("modern", {}, n60(["Ponder"]));
    same("modern: no data at all is said, only the shape checked", [r.problems, r.warnings], [[], ["no ban list data for Modern yet: only the deck's shape was checked"]]);
  }
  {
    let r = fp("modern", { status: st({}) }, Array(56).fill("Mountain"), ["Kykar, Wind's Fury"]);
    same("modern: a commander and 56 cards", r.problems, ["Modern has no commander: take Kykar, Wind's Fury off your command zone (or put it in your deck)", "56 cards in your deck: Modern decks have at least 60"]);
    r = fp("modern", { status: st({}) }, n60(["Ponder", "Ponder", "Ponder", "Ponder"]), [], ["Ponder", ...Array(15).fill("Island")]);
    same("modern: 16 in the sideboard, 5 copies across both", r.problems, ["16 cards in the sideboard: at most 15", "more than 4 copies of: 5× Ponder (basic lands excepted)"]);
    const reasons = R.FORMATS.filter((f) => f.list && f.mode === "standard").map((f) => fp(f.key, { status: st({ Ponder: "n" }) }, n60(["Ponder"])).problems[0]);
    same("each 60-card format's not-legal line", reasons, ["not legal in Standard (not from its sets): Ponder", "not legal in Pioneer (not from its sets): Ponder", "not legal in Modern (not from its sets): Ponder",
      "not legal in Legacy (not a tournament card): Ponder", "not legal in Vintage (not a tournament card): Ponder", "not legal in Pauper (not a common): Ponder", "not legal in Premodern (not from its sets): Ponder",
      "not legal in Old School (not from its sets): Ponder", "not legal in Historic (not on MTG Arena): Ponder", "not legal in Timeless (not on MTG Arena): Ponder", "not legal in Alchemy (not on MTG Arena): Ponder"]);
    r = fp("casual60", { status: st({ Ponder: "b" }) }, n60(["Ponder"]));
    same("casual 60: the shape only, no list", [r.problems, r.warnings], [[], []]);
    r = fp("modern", { status: st({ Ponder: "b", Brainstorm: "b" }) }, n60(["Ponder", "Brainstorm"]));
    same("modern: the closing line for a banned problem", r.footer, "Ban list: Scryfall, 2026-11-18. The host can allow banned cards (Banned cards button).");
  }

  // ── review fixes (2026-11-18): the real copy limits, Pauper Commander's commander, a seat joining after a refresh ──
  await run(async (h) => {
    h.B._setLegality(stub({}));
    // (the limits are forge-formats.json's, every card's: they held only Standard's five, so these decks were refused;
    // "Nazgul" as a deck list may spell it, the limit under "Nazgûl")
    const rats = entry(withCards(KYKAR_99, { "Relentless Rats": 30, "Seven Dwarves": 7, Nazgul: 9 }, "Island", 99), [KYKAR_CMD], "Kykar rats");
    const r = await check(h, rats, { format: "commander" });
    ok("commander: 30 Relentless Rats, 7 Seven Dwarves and 9 Nazgul are not 'more than one copy'", !/more than one copy/.test(r.said), r.said);
    const over = entry(withCards(KYKAR_99, { "Seven Dwarves": 8 }, "Island", 99), [KYKAR_CMD], "Kykar dwarves");
    const o = await check(h, over, { format: "commander" });
    ok("commander: an 8th Seven Dwarves is still too many", /more than one copy of: 8× Seven Dwarves/.test(o.said), o.said);
    h.B._setLegality(stub({ paupercommander: { "Kykar, Wind's Fury": "n", "Arcane Signet": "n" } }));
    const p = await check(h, entry(KYKAR_99, [KYKAR_CMD], "Kykar"), { format: "paupercommander" });
    ok("pauper commander: an uncommon commander ('not legal' on Scryfall) is not a problem; a 99 card is",
      !/not legal in Pauper Commander[^\n]*Kykar/.test(p.said) && /not legal in Pauper Commander \(not printed at common\): Arcane Signet/.test(p.said), p.said);
  });
  await run(async (h) => {
    h.B._setLegality(stub({}, { hash: "old" }));
    say(h, "format", { color: "White", format: "commander", mode: "commander" });
    const r = await check(h, entry(KYKAR_99, [KYKAR_CMD], "Kykar"), { format: "commander" });
    ok("joining after a refresh: the deck is ready under the old hash", r.ready && /\|old$/.test(r.deck?.rules || ""), r.deck?.rules);
    h.B._onLegalityChanged(stub({}, { hash: "new" }));
    ok("joining after a refresh: a deck that still passes carries the new hash", /\|new$/.test(h.B._readyDecks.Blue?.rules || ""), h.B._readyDecks.Blue?.rules);
    same("joining after a refresh: a seat joining the game started under the old hash keeps its checked deck",
      h.B._readyForGame ? h.B._readyForGame("Blue", "commander|true|true|old") : "no _readyForGame hook", true);
  });

  // ── an older table: no format = today's checks, no rules recorded ──
  await run(async (h) => {
    h.B._setLegality(stub({ "*": { "Arcane Signet": "b" } }));
    const r = await check(h, entry(KYKAR_99, [KYKAR_CMD], "Kykar"));
    ok("older table: a Commander deck is checked as today (no list)", r.ready && /^\[MTG\] Blue \(Kykar\): ready\. 99 cards \+ commander Kykar, Wind's Fury; every card is known to the engine\./.test(r.said) && !r.deck?.rules && r.deck?.mode === "commander", r.said);
    same("older table: the game mode stays Casual Commander", { ...h.B._gameMode }, { mode: "commander", format: null, banned: true, restricted: true });
    const s = await check(h, entry(RAKDOS, [], "Rakdos"), { mode: "standard" });
    ok("older table: Standard by the mode alone is today's Standard check", s.ready && /ready for Standard\. 60 cards; every card is known to the engine and legal in Standard\./.test(s.said) && !s.deck?.rules && s.deck?.mode === "standard", s.said);
    const t = await check(h, entry(withCards(KYKAR_99, { "Arcane Signet": 2 }, "Island", 99), [KYKAR_CMD], "Kykar"), { format: "casualcommander" });
    ok("casual commander sent by name: today's warnings, not problems", t.ready && /Check: more than one copy of: 2× Arcane Signet/.test(t.said) && !t.deck?.rules, t.said);
  });

  // ── the format message and the switches ──
  await run(async (h) => {
    const G = h.B._gameMode;
    say(h, "format", { color: "White", format: "modern", mode: "standard", banned: true, restricted: true });
    same("format: Modern is a 60-card format", { ...G }, { mode: "standard", format: "modern", banned: true, restricted: true });
    say(h, "format", { color: "White", format: "vintage", mode: "standard", banned: false, restricted: false });
    same("format: the switches as sent", { ...G }, { mode: "standard", format: "vintage", banned: false, restricted: false });
    say(h, "format", { color: "White", format: "duel", mode: "commander" });
    same("format: Duel Commander, switches unsaid are on", { ...G }, { mode: "commander", format: "duel", banned: true, restricted: true });
    await h.flush();
    same("format: each change sends the table that format's banlist (its count, the formats with none)",
      h.effects.filter((e) => e.tts?.t === "banlist").map((e) => e.tts.format), ["modern", "vintage", "duel"]);
    say(h, "hello", { stamp: 1 });
    same("hello with no format: back to Casual Commander", { ...G }, { mode: "commander", format: null, banned: true, restricted: true });
    say(h, "hello", { stamp: 1, format: "pioneer", mode: "standard", banned: false });
    same("hello with a format takes it", { ...G }, { mode: "standard", format: "pioneer", banned: false, restricted: true });
    say(h, "format", { color: "White", format: "casualcommander", mode: "commander" });
    same("format Casual Commander: no format", { ...G }, { mode: "commander", format: null, banned: true, restricted: true });
    say(h, "format", { color: "White", format: "brawl", mode: "standard" });
    same("format: an unknown one is the mode alone", { ...G }, { mode: "standard", format: null, banned: true, restricted: true });
    h.B._setLegality(stub({}, { hash: "abc" }));
    say(h, "format", { format: "modern", banned: false });
    same("rulesKey: format, switches, the list's hash", h.B.rulesKey(), "modern|false|true|abc");
    same("rulesWords", ["modern|false|true|abc", "vintage|true|false|x", "duel|true|false|x", "commander", "standard", "casual60|true|true|"].map(h.B.rulesWords),
      ["Modern (banned cards allowed)", "Vintage (restricted cards at the normal limit)", "Duel Commander (restricted commanders allowed)", "Casual Commander", "Standard", "Casual 60-card"]);
  });

  // ── the alert per format, a golden (§5.2, §5.3) ──
  const GOLDEN = path.join(__dirname, "golden", "bridge-format-alerts.json");
  const alerts = {};
  await run(async (h) => {
    // one bad deck per shape: Rakdos with a banned, a restricted (4×), a not-legal and an unknown card; Kykar with two
    // of a card, 101 cards, a banned and a not-legal card, a restricted commander
    const sixtyTable = { "Hired Claw": "b", "Burst Lightning": "r", "Shock": "n", "Master of Barbs": "b" };
    const cmdTable = { "Arcane Signet": "b", "Akroma's Will": "n", [KYKAR_CMD]: "r" };
    const tables = Object.fromEntries(R.FORMATS.map((f) => [f.key, f.mode === "standard" ? sixtyTable : cmdTable]));
    h.B._setLegality(stub(tables, { unknown: ["Starting Town"] }));
    const sixty = entry(withCards(RAKDOS, { "Nova Hellkite": 5 }, "Mountain", 61), [], "Izzet Phoenix", RAKDOS_SB);
    const cmd = entry(withCards(KYKAR_99, { "Arcane Signet": 2 }, "Island", 100), [KYKAR_CMD], "Kykar");
    for (const f of R.FORMATS) {
      for (const sw of [{}, { banned: false, restricted: false }]) {
        const r = await check(h, f.mode === "standard" ? sixty : cmd, { format: f.key, mode: f.mode, ...sw });
        alerts[`${f.key}${sw.banned === false ? " (switches off)" : ""}`] = { ready: r.ready, said: r.said, report: r.report };
      }
    }
  });
  if (process.env.UPDATE) fs.writeFileSync(GOLDEN, `${JSON.stringify(alerts, null, 1)}\n`);
  const want = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, "utf8")) : {};
  for (const k of Object.keys(alerts)) same(`alert golden: ${k}`, alerts[k], want[k]);
  same("alert golden: no format missing", Object.keys(want).length, Object.keys(alerts).length);
  // the spec's example, said exactly
  const modern = alerts.modern.said;
  same("alert: Modern's lines, §5.2's order", modern.split("\n").slice(0, 6), [
    "[MTG] Blue (Izzet Phoenix): not ready for Modern.",
    "- more than 4 copies of: 5× Nova Hellkite (basic lands excepted)",
    "- banned in Modern: Hired Claw, Master of Barbs",
    "- not legal in Modern (not from its sets): Shock",
    "Ban list: Scryfall, 2026-11-18. The host can allow banned cards (Banned cards button).",
    "Also: not in the Modern card data, so not checked: Starting Town"]);
  ok("alert: Vintage says the restricted card", /- restricted in Vintage \(1 copy each\): 4× Burst Lightning/.test(alerts.vintage.said)
    && /The host can allow banned cards \(Banned cards button\), or turn restricted cards off \(Restricted cards button\)\./.test(alerts.vintage.said), alerts.vintage.said);
  ok("alert: Modern with the switches off still stops on the not-legal card (§12.2)", !alerts["modern (switches off)"].ready && /not legal in Modern/.test(alerts["modern (switches off)"].said)
    && !/banned in Modern/.test(alerts["modern (switches off)"].said) && !/Ban list:/.test(alerts["modern (switches off)"].said), alerts["modern (switches off)"].said);
  ok("alert: Duel Commander's commander, shape and lists", /^\[MTG\] Blue \(Kykar\): not ready for Duel Commander\.\n- 101 cards: Duel Commander decks are exactly 100 cards, the commander included\n- more than one copy of: 2× Arcane Signet \(Duel Commander decks are singleton; basic lands excepted\)\n- banned in Duel Commander: Arcane Signet\n- restricted in Duel Commander \(not as your commander\): Kykar, Wind's Fury\n- not legal in Duel Commander \(not a tournament card\): Akroma's Will\n/.test(alerts.duel.said), alerts.duel.said);
  ok("alert: Casual Commander keeps today's warnings and is ready", alerts.casualcommander.ready && /: ready\. 100 cards \+ commander/.test(alerts.casualcommander.said) && /Check: 101 cards \(Commander decks are 100 including the commander\); more than one copy of: 2× Arcane Signet/.test(alerts.casualcommander.said), alerts.casualcommander.said);
  ok("alert: Casual 60-card checks the shape only", !alerts.casual60.ready && /not ready for Casual 60-card\.\n- more than 4 copies of: 5× Nova Hellkite \(basic lands excepted\)$/.test(alerts.casual60.said), alerts.casual60.said);
  ok("deckReport: checked and not ready, the Ready button red", JSON.stringify(alerts.modern.report) === JSON.stringify({ t: "deckReport", request: 7, ready: [], checked: ["Blue"] }), JSON.stringify(alerts.modern.report));

  // ── ready under a format ──
  await run(async (h) => {
    h.B._setLegality(stub({ modern: { "Hired Claw": "b" } }, { hash: "h1" }));
    let r = await check(h, entry(RAKDOS, [], "Rakdos", RAKDOS_SB), { format: "modern", mode: "standard", banned: false });
    ok("ready: banned off names the banned card it let through", r.ready && /^\[MTG\] Blue \(Rakdos\): ready for Modern \(banned cards allowed by the host: Hired Claw\)\. 60 cards; every card is known to the engine and legal in Modern\. Sideboard: 15 cards/.test(r.said), r.said);
    same("ready: the deck's rules", r.deck?.rules, "modern|false|true|h1");
    same("deckReport: ready", r.report, { t: "deckReport", request: 7, ready: ["Blue"], checked: ["Blue"] });
    r = await check(h, entry(KYKAR_99, [KYKAR_CMD], "Kykar"), { format: "commander", mode: "commander" });
    ok("ready: a Commander deck under Commander", r.ready && /^\[MTG\] Blue \(Kykar\): ready for Commander\. 99 cards \+ commander Kykar, Wind's Fury; every card is known to the engine and legal in Commander\.$/.test(r.said) && r.deck?.rules === "commander|true|true|h1" && r.deck?.mode === "commander", r.said);
    h.B._setLegality(stub({}, { formats: [] }));
    r = await check(h, entry(KYKAR_99, [KYKAR_CMD], "Kykar"), { format: "predh", mode: "commander" });
    ok("ready: no data for the format is said, and not 'legal'", r.ready && /ready for PreDH\. 99 cards \+ commander Kykar, Wind's Fury; every card is known to the engine\.\nCheck: no ban list data for PreDH yet: only the deck's shape was checked/.test(r.said) && r.deck?.rules === "predh|true|true|", r.said);
    h.B._setLegality(null);
    r = await check(h, entry(RAKDOS, [], "Rakdos"), { format: "standard", mode: "standard" });
    ok("ready: Standard with no ban list data falls back to Forge's list", r.ready && /ready for Standard\. 60 cards; every card is known to the engine and legal in Standard\./.test(r.said) && r.deck?.rules === "standard|true|true|forge", r.said);
    r = await check(h, entry(withCards(RAKDOS, { "Up the Beanstalk": 1 }, "Mountain", 60), [], "Rakdos"), { format: "standard", mode: "standard" });
    ok("not ready: Forge's Standard ban list under the Standard format", !r.ready && /banned in Standard: Up the Beanstalk/.test(r.said) && /^Ban list: Forge\. The host can allow banned cards/m.test(r.said), r.said);
  });

  // ── the start: a deck checked under other rules ──
  const startMsg = (extra = {}) => ({ seats: ["Blue"], bots: 1, requireReady: true, fromTable: true, ...extra });
  await run(async (h) => {
    h.B._setLegality(stub({}, { hash: "h1" }));
    await check(h, entry(KYKAR_99, [KYKAR_CMD], "Kykar"), { format: "commander", mode: "commander" });
    let mark = h.effects.length;
    say(h, "start", startMsg({ format: "modern", mode: "standard" }));
    await h.flush();
    same("start: a deck checked for Commander, the format now Modern", chatsSince(h, mark), ["[MTG] Not started: Blue's deck was checked for Commander; the format is now Modern: press READY again."]);
    ok("start: no game", !h.B._getGame());
    mark = h.effects.length;
    say(h, "start", startMsg({ format: "commander", mode: "commander", banned: false }));
    await h.flush();
    same("start: the same format with a switch changed", chatsSince(h, mark), ["[MTG] Not started: Blue's deck was checked for Commander; the format is now Commander (banned cards allowed): press READY again."]);
    h.B._setLegality(stub({}, { hash: "h2" }));
    mark = h.effects.length;
    say(h, "start", startMsg({ format: "commander", mode: "commander" }));
    await h.flush();
    same("start: the same rules with an older list", chatsSince(h, mark), ["[MTG] Not started: Blue's deck was checked against an older Commander ban list; the format is now Commander: press READY again."]);
    mark = h.effects.length;
    say(h, "start", startMsg());
    await h.flush();
    same("start: a format's deck, the table now Casual Commander", chatsSince(h, mark), ["[MTG] Not started: Blue's deck was checked for Commander; the format is now Casual Commander: press READY again."]);
    delete h.B._readyDecks.Blue;
    mark = h.effects.length;
    say(h, "start", startMsg({ format: "pioneer", mode: "standard" }));
    await h.flush();
    same("start: no deck checked, the format's words", chatsSince(h, mark), ["[MTG] Not started: Blue still need \"mtg ready\" for Pioneer (import a deck of 60 or more Pioneer cards into your library zone; no commander)."]);
  });
  await run(async (h) => {
    // a Casual Commander deck, then a format: the deck is not ready for it
    await check(h, entry(KYKAR_99, [KYKAR_CMD], "Kykar"));
    const mark = h.effects.length;
    say(h, "start", startMsg({ format: "duel", mode: "commander" }));
    await h.flush();
    same("start: a Casual Commander deck, the format now Duel Commander", chatsSince(h, mark), ["[MTG] Not started: Blue's deck was checked for Casual Commander; the format is now Duel Commander: press READY again."]);
  });
  await run(async (h) => {
    // today's mode refusal is unchanged with no format
    await check(h, entry(KYKAR_99, [KYKAR_CMD], "Kykar"));
    const mark = h.effects.length;
    say(h, "start", startMsg({ mode: "standard" }));
    await h.flush();
    ok("start: with no format, today's Standard refusal", chatsSince(h, mark).join("\n").startsWith("[MTG] Not started: Blue still need \"mtg ready\" for Standard (import a deck of 60"), chatsSince(h, mark).join("\n"));
  });

  // ── a refresh between READY and Start (§6.3) ──
  await run(async (h) => {
    h.B._setLegality(stub({}, { hash: "h1" }));
    await check(h, entry(RAKDOS, [], "Rakdos"), { format: "modern", mode: "standard" });
    say(h, "decks", { seats: { Red: entry(withCards(RAKDOS, { "Hired Claw": 0 }, "Mountain", 60), [], "No Claw") }, request: 8, format: "modern", mode: "standard" });
    await h.flush();
    ok("refresh: both ready first", h.B._readyDecks.Blue?.rules === "modern|true|true|h1" && h.B._readyDecks.Red?.rules === "modern|true|true|h1");
    const mark = h.effects.length;
    h.B._onLegalityChanged(stub({ modern: { "Hired Claw": "b" } }, { hash: "h2", date: "2026-11-25" }));
    await h.flush();
    ok("refresh: the deck with the new ban is dropped", !h.B._readyDecks.Blue);
    same("refresh: the deck without it keeps its READY, under the new hash", h.B._readyDecks.Red?.rules, "modern|true|true|h2");
    same("refresh: the alert to its owner", h.effects.slice(mark).filter((e) => e.tts?.t === "chat").map((e) => [e.tts.text, e.tts.color ?? e.tts.to ?? null]),
      [["[MTG] Blue (Rakdos): not ready for Modern.\n- banned in Modern: Hired Claw\nBan list: Scryfall, 2026-11-25. The host can allow banned cards (Banned cards button).\nThe ban list was updated since your READY: change the deck and press READY again.", "Blue"]]);
    same("refresh: a red report for it", reportsSince(h, mark), [{ t: "deckReport", request: -1, ready: [], checked: ["Blue"] }]);
    const m2 = h.effects.length;
    say(h, "start", { seats: ["Blue", "Red"], bots: 0, requireReady: true, fromTable: true, format: "modern", mode: "standard" });
    await h.flush();
    same("refresh: the start then says who still needs READY", chatsSince(h, m2), ["[MTG] Not started: Blue still need \"mtg ready\" for Modern (import a deck of 60 or more Modern cards into your library zone; no commander)."]);
    const m3 = h.effects.length;
    h.B._onLegalityChanged(stub({ modern: { "Hired Claw": "b" } }, { hash: "h3" }));
    await h.flush();
    same("refresh: nothing dropped, nothing said", [chatsSince(h, m3), reportsSince(h, m3)], [[], []]);
  });
  await run(async (h) => {
    // a Casual deck is not touched by a refresh
    await check(h, entry(KYKAR_99, [KYKAR_CMD], "Kykar"));
    h.B._onLegalityChanged(stub({ "*": { "Arcane Signet": "b" } }, { hash: "h9" }));
    await h.flush();
    ok("refresh: a Casual Commander deck stays ready", h.B._readyDecks.Blue && !h.B._readyDecks.Blue.rules);
  });

  // ── the game keeps its rules: the start, the resume file, the game-over line, AI decks ──
  await run(async (h) => {
    h.B._setLegality(stub({}, { hash: "h1" }));
    await check(h, entry(RAKDOS, [], "Rakdos"), { format: "pioneer", mode: "standard", banned: false });
    const mark = h.effects.length;
    say(h, "start", startMsg({ format: "pioneer", mode: "standard", banned: false }));
    await h.flush();
    const g = h.B._getGame();
    same("game: its rules", g?.rules, "pioneer|false|true|h1");
    same("game: a Standard-mode game", g?.mode, "standard");
    ok("game: AI decks said not checked against the list, once", chatsSince(h, mark).filter((t) => t === "[MTG] AI decks are not checked against Pioneer's ban list.").length === 1, JSON.stringify(chatsSince(h, mark)));
    let snap = null;
    const prev = fs.writeFile;
    fs.writeFile = (p, d, ...rest) => { if (String(p).includes("mtg-bridge-game-test")) snap = JSON.parse(d); return prev(p, d, ...rest); };
    if (g) g.started = true;
    h.B.saveResume();
    fs.writeFile = prev;
    await h.flush();
    same("resume: the save has the rules", snap?.game?.rules, "pioneer|false|true|h1");
    h.B._setGame(null);
    await fs.promises.writeFile(process.env.MTG_RESUME_FILE, JSON.stringify({ ...snap, savedAt: Date.now() - 2000 }));
    ok("resume: resumed", h.B.resumeGame() === true);
    same("resume: a resumed game has them back", h.B._getGame()?.rules, "pioneer|false|true|h1");
  });
  await run(async (h) => {
    await check(h, entry(KYKAR_99, [KYKAR_CMD], "Kykar"));
    say(h, "start", startMsg());
    await h.flush();
    const g = h.B._getGame();
    ok("game: a Casual Commander game has no rules", g && !("rules" in g));
    ok("game: no AI line in Casual Commander", !h.effects.some((e) => /AI decks are not checked/.test(e.tts?.text || "")));
  });
  await run(async (h) => {
    h.B._setLegality(stub({}, { hash: "h1" }));
    h.B._setGame({ seats: new Map(), rules: "modern|true|true|h1", mode: "standard", slotColor: {}, slotNames: {} });
    same("game over: the game log's line names the format", h.B.gameOverLine("Blue won"), "Game over: Blue won (Modern)");
    h.B._setGame({ seats: new Map(), mode: "commander" });
    same("game over: a Casual Commander game's line as today", [h.B.gameOverLine("Blue won"), h.B.gameOverLine(null)], ["Game over: Blue won", "Game over"]);
  });

  // ── sideboarding in a format's best of three re-checks the new deck under game.rules (§7) ──
  for (const banned of [false, true]) {
    await run(async (h) => {
      h.B._setLegality(stub({ modern: banned ? { Duress: "b" } : {} }, { hash: "h1" }));
      h.B._setGame({ seats: new Map(), rules: "modern|true|true|h1", mode: "standard", slotColor: {}, slotNames: {}, started: false });
      const M = h.B._match, card = (name) => ({ identity: { name } });
      const main = [...Array(56).fill("Mountain"), "Shock", "Shock", "Shock", "Shock"].map(card), side = ["Duress", "Duress"].map(card);
      M.on = true;
      M.decks = { pair: null, by: { Blue: { deckName: "Rakdos", main, side, reg: { main: [...main], side: [...side] } } } };
      M.sb.Blue = { step: "in", out: [56] };
      M.waiting.add("Blue");
      const mark = h.effects.length;
      say(h, "answer", { color: "Blue", promptId: "__match", choice: ["in:0"] });
      await h.flush();
      const said = chatsSince(h, mark).join("\n");
      const d = M.decks.by.Blue;
      if (banned) ok("sideboarding: a swap bringing in a card banned since is refused", /That swap isn't legal in Modern: banned in Modern: Duress\. Nothing was changed\./.test(said) && d.main.length === 60 && d.main.filter((c) => c.identity.name === "Duress").length === 0, said);
      else ok("sideboarding: a legal swap goes through", !/isn't legal/.test(said) && d.main.filter((c) => c.identity.name === "Duress").length === 1, said);
    });
  }

  // ── AI deck lists and presets under a format (§3.3) ──
  await run(async (h) => {
    h.B._setLegality(stub({ modern: { "Hired Claw": "b" }, pioneer: {} }, { hash: "h1" }));
    say(h, "format", { format: "modern", mode: "standard" });
    const list = (main) => `Deck\n${main}`;
    const r1 = h.B.setAiSeat("Blue", "forge", { list: list("4 Hired Claw\n56 Mountain") });
    ok("ai list: checked under the format", !r1.ok && /not a Modern deck: banned in Modern: Hired Claw/.test(r1.message), r1.message);
    const r2 = h.B.setAiSeat("Blue", "forge", { list: list("4 Burst Lightning\n56 Mountain") });
    ok("ai list: a legal one is taken", r2.ok, r2.message);
    const presets = h.B.presetsFor("standard");
    ok("presets: the format's check filters them", !presets.includes("standard_rakdos_ingris") && presets.includes("standard_dimir_aggro"), presets.join(", "));
    say(h, "format", { format: "pioneer", mode: "standard" });
    ok("presets: another format, its own filter", h.B.presetsFor("standard").includes("standard_rakdos_ingris"));
    say(h, "format", { format: "commander", mode: "commander" });
    const cp = h.B.presetsFor("commander");
    ok("presets: Commander keeps the 100-card singleton presets only", cp.includes("kykar_winds_fury") && !cp.includes("test_mechanics_40"), cp.join(", "));
  });

  process.stdout.write(failed ? `FAILED: ${failed} failed, ${passed} passed\n` : `ok: ${passed} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`CRASH ${e.stack}\n`); process.exit(1); });
