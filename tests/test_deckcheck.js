// tools/deckcheck.lua, headless (docs/deckcheck-spec.md): DeckCheck links, the /deck response → spawn entries, error
// messages, the GM-notes tag and the bracket/threat label. Runs on fengari with TTS's JSON and pattern limits.
// The fixture is hand-made (tests/golden/fixtures/deckcheck-deck.json): never a recorded DeckCheck response.
//   node tests/test_deckcheck.js
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const load = require("./lua/deckcheck-run");
const { shapeProblems } = load;

const LUA_FILE = process.env.DECKCHECK_LUA || path.join(__dirname, "..", "tools", "deckcheck.lua");
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "deckcheck-deck.json"), "utf8"));
const dc = load(LUA_FILE);
const DOT = "|";

let failed = 0, n = 0;
function check(name, fn) {
  n++;
  let why = null;
  try { why = fn(); } catch (e) { why = `threw: ${e.message.split("\n")[0]}`; }
  if (why === true || why === undefined) console.log(`ok   ${name}`);
  else { failed++; console.log(`FAIL ${name}: ${why}`); }
}
// (keys sorted: Lua tables have no key order)
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const eq = (got, want) => canon(got) === canon(want) ? true : `got ${canon(got)}, want ${canon(want)}`;
const deck = (k) => JSON.stringify(FIX[k]);
const withJson = (k, edit) => { const d = JSON.parse(deck(k)); edit(d); return JSON.stringify(d); };
const ids = (list) => list.map((e) => e.scryfall_id.slice(-2));
const total = (info) => info.entries.reduce((s, e) => s + e.count, 0);

// ───────── the fixture keeps the documented shape ─────────
for (const k of ["partners", "standard", "emptyMainboard"]) {
  check(`fixture ${k} has the documented shape`, () => { const p = shapeProblems(FIX[k], dc.entries(deck(k))); return p.length ? p.join("; ") : true; });
}

// ───────── deckcheckEntries ─────────
const partners = dc.entries(deck("partners"));
check("partners: name", () => eq(partners.name, "Test Partners Pile"));
check("partners: two commanders, by name", () => eq(partners.commanders.map((c) => c.name), ["Thrasios, Triton Hero", "Tymna the Weaver"]));
check("partners: entries start with the commanders", () => eq(ids(partners.entries.slice(0, 2)), ["c1", "c2"]));
check("partners: mainboard by name, then scryfallId", () => eq(ids(partners.entries.slice(2)), ["a2", "a6", "b1", "b2", "a5", "a1", "a7"]));
check("partners: basic land quantities kept", () => eq(partners.entries.filter((e) => e.name === "Island" || e.name === "Plains").map((e) => e.count), [15, 20, 40]));
check("partners: 100 cards in all", () => eq(total(partners), 100));
check("partners: entry fields", () => eq(partners.entries[0], { count: 1, name: "Thrasios, Triton Hero", number: "46", scryfall_id: "00000000-0000-4000-8000-0000000000c1", set: "c16" }));
check("printing: kept only when both codes are plain", () => eq(["c16|46", "c16|", "|46", "c 16|46", "c16|4)6", "c16|" + "1".repeat(17), "PLST|ZEN-23"].map((sn) => {
  const [set, num] = sn.split("|");
  const e = dc.entries(withJson("standard", (d) => { const c = d.boards.mainboard.cards["dc-s1"].card; c.setCode = set; c.collectorNumber = num; })).entries[0];
  return e.set === undefined ? null : `${e.set} ${e.number}`;
}), ["c16 46", null, null, null, null, null, "PLST ZEN-23"]));
check("partners: bracket and threat", () => eq([partners.bracket, partners.threatIndex, partners.maxThreat], [3, 54, 96]));
check("partners: key order doesn't change the result", () => {
  const d = FIX.partners;
  const rev = (o) => Object.fromEntries(Object.entries(o).reverse());
  const flipped = { ...d, boards: { mainboard: { cards: rev(d.boards.mainboard.cards) }, commanders: { cards: rev(d.boards.commanders.cards) } } };
  return eq(dc.entries(JSON.stringify(flipped)), partners);
});

const std = dc.entries(deck("standard"));
check("non-Commander: null bracket and threat read as missing", () => eq([std.bracket, std.threatIndex], [undefined, undefined]));
check("non-Commander: no commanders, mainboard only", () => eq([std.commanders.length, std.entries.map((e) => e.name)], [0, ["Lightning Strike", "Mountain"]]));
check("non-Commander: quantities kept", () => eq(total(std), 28));
check("non-Commander: no label", () => eq(dc.enc(`deckcheckLabel(deckcheckEntries(JSON.decode([[${deck("standard")}]])))`), null));

const empty = dc.entries(deck("emptyMainboard"));
check("empty mainboard: the commander alone", () => eq(empty.entries.map((e) => e.name), ["Atraxa, Praetors' Voice"]));
check("empty mainboard: threat 0 is kept (not missing)", () => eq([empty.bracket, empty.threatIndex], [1, 0]));

check("missing boards: no entries, no error", () => eq(dc.entries(withJson("partners", (d) => { delete d.boards; })).entries, []));
check("missing commanders board: mainboard only", () => eq(dc.entries(withJson("partners", (d) => { delete d.boards.commanders; })).entries.length, 7));
check("board without cards: skipped", () => eq(dc.entries(withJson("partners", (d) => { d.boards.mainboard = {}; })).entries.length, 2));
check("missing name: a default name", () => eq(dc.entries(withJson("partners", (d) => { delete d.name; })).name, "DeckCheck deck"));
check("not an object: nil", () => eq([dc.enc("deckcheckEntries(nil)"), dc.enc('deckcheckEntries("x")')], [null, null]));
check("card with no scryfallId: left out", () => eq(dc.entries(withJson("standard", (d) => { delete d.boards.mainboard.cards["dc-s1"].card.scryfallId; })).entries.map((e) => e.name), ["Mountain"]));
check("entry with no card: left out", () => eq(dc.entries(withJson("standard", (d) => { delete d.boards.mainboard.cards["dc-s1"].card; })).entries.length, 1));
check("quantity 0: left out", () => eq(dc.entries(withJson("standard", (d) => { d.boards.mainboard.cards["dc-s1"].quantity = 0; })).entries.length, 1));
check("missing quantity: one copy", () => eq(dc.entries(withJson("standard", (d) => { delete d.boards.mainboard.cards["dc-s1"].quantity; })).entries[0].count, 1));
check("the same scryfallId twice: merged", () => eq(dc.entries(withJson("standard", (d) => { d.boards.mainboard.cards["dc-s3"] = JSON.parse(JSON.stringify(d.boards.mainboard.cards["dc-s1"])); })).entries.map((e) => e.count), [8, 24]));
check("threatIndex missing: read from dti.score", () => eq(dc.entries(withJson("partners", (d) => { delete d.threatIndex; d.dti.score = 61; })).threatIndex, 61));
check("dti.maxScore: used as the maximum", () => eq(dc.entries(withJson("partners", (d) => { d.dti.maxScore = 100; })).maxThreat, 100));
check("cards as a list instead of an object: still read", () => eq(dc.entries(withJson("standard", (d) => { d.boards.mainboard.cards = Object.values(d.boards.mainboard.cards); })).entries.map((e) => e.count), [4, 24]));
check("bracket/threat that aren't whole numbers read as missing", () => { const i = dc.entries(withJson("partners", (d) => { d.bracket = 2.5; d.threatIndex = "high"; delete d.dti; })); return eq([i.bracket, i.threatIndex], [undefined, undefined]); });
check("whole-number floats (TTS JSON gives 3.0)", () => eq(dc.enc(`deckcheckEntries({ bracket = 3.0, threatIndex = 54.0, boards = { mainboard = { cards = { x = { quantity = 2.0, card = { name = "Forest", scryfallId = "f" } } } } } })`),
  { bracket: 3, commanders: [], entries: [{ count: 2, name: "Forest", scryfall_id: "f" }], maxThreat: 96, name: "DeckCheck deck", threatIndex: 54 }));

// ───────── deckcheckError ─────────
const ERR = {
  400: "That doesn't look like a DeckCheck deck link. Copy the link from the deck's page on deckcheck.co and try again.",
  403: "That DeckCheck deck is private: make it public or unlisted on DeckCheck and try again.",
  404: "DeckCheck has no deck at that link. Check the link and try again.",
  429: "DeckCheck is busy (too many requests). Wait a few seconds and try again.",
  500: "DeckCheck had a problem on its side. Try again in a minute.",
};
for (const [s, want] of Object.entries(ERR)) check(`error ${s}`, () => eq(dc.error(Number(s), '{"error":"anything"}'), want));
check("error 503: the server message", () => eq(dc.error(503, '{"error":"down"}'), ERR[500]));
check("error 0 / nil: can't reach", () => eq([dc.error(0), dc.error(null)], ["Couldn't reach DeckCheck. Check the internet connection and try again.", "Couldn't reach DeckCheck. Check the internet connection and try again."]));
check("status 200: no error", () => eq([dc.error(200, "{}"), dc.error(204)], [null, null]));
check("other status: its number and DeckCheck's words", () => eq(dc.error(418, '{"error":"teapot"}'), "DeckCheck didn't send the deck (error 418): teapot."));
check("other status, no body: its number", () => eq(dc.error(401), "DeckCheck didn't send the deck (error 401)."));
check("error messages differ from each other", () => new Set(Object.values(ERR)).size === 5 || "two statuses share a message");

// ───────── deckcheckStatus, deckcheckTooBig, deckcheckDecklist (rikrassen's importer: tools/deckcheck-rik.lua) ─────────
const status = (lua) => dc.enc(`deckcheckStatus(${lua})`);
check("status: response_code, else the error's HTTP status, else 200 with text, else 0", () => eq(
  [status("{ response_code = 404 }"), status('{ is_error = true, error = "HTTP/1.1 403 Forbidden" }'), status('{ text = "{}" }'), status('{ is_error = true, error = "Cannot connect", text = "" }'), status("nil")],
  [404, 403, 200, 0, 0]));
check("too big: nil at 250 cards, the plain refusal above", () => eq([dc.enc("deckcheckTooBig({ entries = { { count = 250 } } })"), dc.enc("deckcheckTooBig({ entries = { { count = 200 }, { count = 51 } } })")],
  [null, "That DeckCheck deck has 251 cards; the importer takes at most 250."]));
const list = (k) => { dc.str("__in", deck(k)); return dc.enc("deckcheckDecklist(deckcheckEntries(JSON.decode(__in)))"); };
check("decklist: commanders under Commander, the rest under Deck, a blank line between", () => {
  const l = list("partners").split("\n");
  return eq([l.slice(0, 5), l.length, l.slice(5).reduce((n, x) => n + Number(x.split(" ")[0]), 0)],
    [["Commander", "1 Thrasios, Triton Hero (c16) 46", "1 Tymna the Weaver (c16) 48", "", "Deck"], 12, 98]);
});
check("decklist: a line is count, name, (set) number", () => eq(list("partners").split("\n").includes("40 Plains (unf) 235"), true));
check("decklist: no commander, the Deck part only", () => eq(list("standard").split("\n")[0], "Deck"));
check("decklist: an empty mainboard, the Commander part only", () => eq(list("emptyMainboard").split("\n").filter((x) => x === "Deck" || x === "").length, 0));
check("decklist: no printing, the name alone", () => eq(dc.enc('deckcheckDecklist({ commanders = {}, entries = { { name = "Forest", count = 2 } } })'), "Deck\n2 Forest"));
check("decklist: a line break in a name can't add a line", () => eq(dc.enc('deckcheckDecklist({ commanders = {}, entries = { { name = " Evil\\nCommander\\r\\n1 X ", count = 1 } } })'), "Deck\n1 Evil Commander  1 X"));
check("decklist: nameless cards left out; none at all, nil", () => eq([dc.enc('deckcheckDecklist({ commanders = {}, entries = { { name = "", count = 1 }, { name = "Forest", count = 1 } } })'), dc.enc('deckcheckDecklist({ commanders = {}, entries = { { name = "  ", count = 1 } } })'), dc.enc("deckcheckDecklist(nil)")], ["Deck\n1 Forest", null, null]));

// ───────── deckcheckId ─────────
const ID = "sBid_JEUQZ4D";
const good = [
  `https://deckcheck.co/app/deckview/${ID}`,
  `https://deckcheck.co/app/decklist/${ID}`,
  `https://deckcheck.co/app/builder/${ID}`,
  `https://www.deckcheck.co/app/deckview/${ID}`,
  `http://deckcheck.co/app/deckview/${ID}`,
  `deckcheck.co/app/deckview/${ID}`,
  `www.deckcheck.co/app/decklist/${ID}`,
  `https://deckcheck.co/app/deckview/${ID}/`,
  `https://deckcheck.co/app/deckview/${ID}?tab=stats&x=1`,
  `https://deckcheck.co/app/deckview/${ID}/?ref=a`,
  `https://deckcheck.co/app/deckview/${ID}#top`,
  `https://deckcheck.co/app/builder/${ID}/edit`,
  `https://DeckCheck.CO/app/deckview/${ID}`,
  `HTTPS://WWW.DECKCHECK.CO/app/deckview/${ID}`,
  `  <https://deckcheck.co/app/deckview/${ID}>  `,
];
for (const u of good) check(`link accepted: ${JSON.stringify(u)}`, () => eq(dc.id(u), ID));
check("link id keeps its case", () => eq(dc.id("https://deckcheck.co/app/deckview/AbC-d_9"), "AbC-d_9"));
const bad = [
  "https://moxfield.com/decks/sBid_JEUQZ4D",
  "https://notdeckcheck.co/app/deckview/sBid_JEUQZ4D",
  "https://deckcheck.co.evil.com/app/deckview/sBid_JEUQZ4D",
  "https://evil.com/deckcheck.co/app/deckview/sBid_JEUQZ4D",
  "https://deckcheck.co@evil.com/app/deckview/sBid_JEUQZ4D",
  "https://deckcheck.co/app/home",
  "https://deckcheck.co/app/home/sBid_JEUQZ4D",
  "https://deckcheck.co/app/deckview/",
  "https://deckcheck.co/app/deckview",
  "https://deckcheck.co/app/deckview/?id=sBid_JEUQZ4D",
  "https://deckcheck.co/app/deckview//sBid_JEUQZ4D",
  "https://deckcheck.co/deckview/sBid_JEUQZ4D",
  "https://deckcheck.co/api/external/deck?deck_id=sBid_JEUQZ4D",
  "https://deckcheck.co/app/deckview/sBid.JEUQZ4D",
  "https://deckcheck.co/app/deckview/sBid%20JEUQZ4D",
  "https://deckcheck.co/app/deckview/" + "a".repeat(65),
  "ftp://deckcheck.co/app/deckview/sBid_JEUQZ4D",
  "",
];
for (const u of bad) check(`link rejected: ${JSON.stringify(u.length > 80 ? u.slice(0, 60) + "..." : u)}`, () => eq(dc.id(u), null));
check("link rejected: nil and a number", () => eq([dc.enc("deckcheckId(nil)"), dc.enc("deckcheckId(42)")], [null, null]));
check("a 64-character id is accepted", () => eq(dc.id("https://deckcheck.co/app/deckview/" + "b".repeat(64)), "b".repeat(64)));
check("long junk text: no 'pattern too complex'", () => eq(dc.id("https://deckcheck.co/app/deckview/" + "x".repeat(5000) + "!"), null));

// ───────── deckcheckTag / deckcheckReadTag ─────────
const tag = (lua) => dc.enc(`deckcheckTag(${lua})`);
const read = (s) => { dc.str("__notes", s); return dc.enc("deckcheckReadTag(__notes)"); };
check("tag: all fields", () => eq(tag(`{ id = "${ID}", bracket = 3, threatIndex = 54, maxThreat = 96 }`), `[deckcheck] id=${ID} bracket=3 threat=54/96`));
check("tag: from deckcheckEntries plus the id", () => eq(dc.enc(`(function() local i = deckcheckEntries(JSON.decode([[${deck("partners")}]])) i.id = "${ID}" return deckcheckTag(i) end)()`), `[deckcheck] id=${ID} bracket=3 threat=54/96`));
check("tag: bracket only", () => eq(tag(`{ id = "${ID}", bracket = 2 }`), `[deckcheck] id=${ID} bracket=2`));
check("tag: threat only, default maximum", () => eq(tag(`{ id = "${ID}", threatIndex = 7 }`), `[deckcheck] id=${ID} threat=7/96`));
check("tag: threat 0 and bracket 0 kept", () => eq(tag(`{ id = "${ID}", bracket = 0, threatIndex = 0 }`), `[deckcheck] id=${ID} bracket=0 threat=0/96`));
check("tag: no id or a bad id gives nil", () => eq([tag("{ bracket = 3 }"), tag('{ id = "a b" }'), tag("nil")], [null, null, null]));
const full = { source: "deckcheck", id: ID, bracket: 3, threatIndex: 54, maxThreat: 96 };
check("read: the tag alone", () => eq(read(`[deckcheck] id=${ID} bracket=3 threat=54/96`), full));
check("read: round trip through deckcheckTag", () => eq(dc.enc(`deckcheckReadTag(deckcheckTag({ id = "${ID}", bracket = 4, threatIndex = 88, maxThreat = 100 }))`), { ...full, bracket: 4, threatIndex: 88, maxThreat: 100 }));
check("read: among other lines", () => eq(read(`imported from deckcheck.co\n[deckcheck] id=${ID} bracket=3 threat=54/96\nsome other note`), full));
check("read: CRLF lines and leading spaces", () => eq(read(`first\r\n   [deckcheck] id=${ID} bracket=3 threat=54/96\r\nlast`), full));
check("read: CRLF right after the id", () => eq(read(`[deckcheck] id=${ID}\r\nnext`), { source: "deckcheck", id: ID }));
check("read: the tag on the last line, no newline", () => eq(read(`a\nb\n[deckcheck] id=${ID} bracket=3 threat=54/96`), full));
check("read: bracket only", () => eq(read(`[deckcheck] id=${ID} bracket=2`), { source: "deckcheck", id: ID, bracket: 2 }));
check("read: threat with no maximum gets 96", () => eq(read(`[deckcheck] id=${ID} threat=12`), { source: "deckcheck", id: ID, threatIndex: 12, maxThreat: 96 }));
check("read: no tag", () => eq([read("just some notes\nabout the deck"), read(""), dc.enc("deckcheckReadTag(nil)")], [null, null, null]));
check("read: a tag with no id is no tag", () => eq(read("[deckcheck] bracket=3 threat=54/96"), null));
check("read: the tag must start its line", () => eq(read(`note: [deckcheck] id=${ID} bracket=3`), null));
check("read: junk values are ignored", () => eq(read(`[deckcheck] id=${ID} bracket=high threat=x/y foo=bar`), { source: "deckcheck", id: ID }));
check("read: the first tag wins", () => eq(read(`[deckcheck] id=first1 bracket=1\n[deckcheck] id=second2 bracket=5`).id, "first1"));
check("read: a long line before the tag", () => eq(read("z".repeat(6000) + `\n[deckcheck] id=${ID}`), { source: "deckcheck", id: ID }));

// ───────── deckcheckLabel ─────────
const label = (lua) => dc.enc(`deckcheckLabel(${lua})`);
check("label: both", () => eq(label("{ bracket = 3, threatIndex = 54, maxThreat = 96 }"), `Bracket 3 ${DOT} Threat 54 (32-51)`));
check("label: bracket only", () => eq(label("{ bracket = 3 }"), "Bracket 3"));
check("label: threat only", () => eq(label("{ threatIndex = 54 }"), "Threat 54/96"));
check("label: bracket 0", () => eq(label("{ bracket = 0 }"), "Bracket 0"));
check("label: threat 0",() => eq(label("{ bracket = 1, threatIndex = 0 }"), `Bracket 1 ${DOT} Threat 0 (0-15)`));
check("label: another maximum", () => eq(label("{ threatIndex = 50, maxThreat = 100 }"), "Threat 50/100"));
check("label: every bracket shows its range", () => eq([1, 2, 3, 4, 5].map((b) => label(`{ bracket = ${b}, threatIndex = 45 }`)), [`Bracket 1 ${DOT} Threat 45 (0-15)`, `Bracket 2 ${DOT} Threat 45 (16-31)`, `Bracket 3 ${DOT} Threat 45 (32-51)`, `Bracket 4 ${DOT} Threat 45 (52-67)`, `Bracket 5 ${DOT} Threat 45 (68-96)`]));
check("label: a bracket with no range keeps the maximum", () => eq(label("{ bracket = 0, threatIndex = 7 }"), `Bracket 0 ${DOT} Threat 7/96`));
check("label: neither, or no info", () => eq([label("{}"), label("nil"), label('{ id = "x" }')], [null, null, null]));
// real TTS shows a Lua string a byte to a letter, so a UTF-8 dot came out as "Â·" (live 2026-11-28): bytes only below 128
check("label: plain ASCII, as real TTS draws it", () => eq([0, 1, 2, 3, 4, 5, 6].map((b) => label(`{ bracket = ${b}, threatIndex = 45 }`)).concat([label("{ threatIndex = 7 }")]).filter((s) => typeof s !== "string" || /[^\x20-\x7e]/.test(s)), []));
check("label: from a read tag",() => eq(dc.enc(`deckcheckLabel(deckcheckReadTag("x\\n[deckcheck] id=${ID} bracket=3 threat=54/96"))`), `Bracket 3 ${DOT} Threat 54 (32-51)`));

// ───────── MoonSharp traps (static) ─────────
const src = fs.readFileSync(LUA_FILE, "utf8");
check("no goto", () => !/\bgoto\b/.test(src.replace(/--[^\n]*/g, "")) || "goto found");
check("no TTS API calls", () => {
  const hit = src.replace(/--[^\n]*/g, "").match(/\b(WebRequest|broadcastToAll|printToAll|getObjectFromGUID|spawnObject\w*|Wait|JSON|UI|Player|self)\b\s*[.:(]/);
  return hit ? `uses ${hit[1]}` : true;
});
check("no local without a value in a for-in body", () => {
  try { execFileSync(process.execPath, [path.join(__dirname, "test_moonsharp_loop_locals.js"), LUA_FILE], { encoding: "utf8" }); return true; }
  catch (e) { return String(e.stdout || e.message).trim().split("\n").slice(0, 3).join(" | "); }
});

console.log(failed ? `FAILED: ${failed} of ${n}` : `PASSED: ${n} of ${n} checks`);
process.exit(failed ? 1 : 0);
