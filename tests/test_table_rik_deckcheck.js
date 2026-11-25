// DeckCheck links in rikrassen's MTG importer (docs/deckcheck-spec.md, "rikrassen's importer"), on the fake TTS:
// its engine-copy script (tools/make-engine-copy.js + tools/deckcheck.lua + tools/deckcheck-rik.lua) alone, its real
// M.deck driven with WebRequest stubbed. A deckcheck.co link: ONE GET to DeckCheck's /deck endpoint by id, then the
// usual POST to rikrassen's /build with the deck as a decklist (commanders under "Commander") and no url; an error
// said in plain words with nothing posted; every other link posted to the server unchanged. Then the deploy's
// importerScripts (tools/patch-save.js) gives the save's importer this script. Web answers come from the hand-made
// fixture tests/golden/fixtures/deckcheck-deck.json, never a recorded DeckCheck response.
//   node tests/test_table_rik_deckcheck.js
const fs = require("fs");
const path = require("path");
const { runDeck } = require("./lua/rik-run");
const { buildSave } = require("./golden/table-run");
const { importerScripts } = require("../tools/patch-save");

const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "deckcheck-deck.json"), "utf8"));
const API = "https://deckcheck.co/api/external/deck?deck_id=";
const BUILD_URL = "https://importer.rikrassen.com/build";
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) { passed++; console.log(`ok   ${name}`); } else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 600)}` : ""}`); } };

const rik = (save.ObjectStates || []).find((o) => o.GUID === "ddf5de");
ok("the engine copy has rikrassen's importer (ddf5de) with the DeckCheck code", rik && rik.LuaScript.includes("function deckcheckRikDeck(") && rik.LuaScript.includes("function deckcheckId("));

const answer = (status, body) => ({ is_done: true, response_code: status, is_error: status >= 400, error: status >= 400 ? `HTTP/1.1 ${status}` : "", text: typeof body === "string" ? body : JSON.stringify(body) });
const form = (url, text = "") => ({ url, data: text, lang: "en", useStates: true, preferOriginalPrinting: false, backURL: "" });
const said = (r) => (r.said || []).join(" | ");
const script = rik ? rik.LuaScript : "";

// ───────── a DeckCheck link becomes a decklist POST ─────────
{
  const id = "abcDEF_12";
  const r = runDeck(script, form(`https://deckcheck.co/app/builder/${id}`), { answers: { [API + id]: answer(200, FIX.partners) } });
  ok("deckcheck link: runs", !r.error, r.error);
  ok("deckcheck link: one GET, to DeckCheck's /deck endpoint by id, no key", r.gets && r.gets.length === 1 && r.gets[0] === API + id, JSON.stringify(r.gets));
  const post = (r.posts || [])[0];
  ok("deckcheck link: one POST, to rikrassen's /build", r.posts && r.posts.length === 1 && post.url === BUILD_URL && post.method === "POST", JSON.stringify(r.posts && r.posts.map((p) => p.url)));
  ok("deckcheck link: posted with no url (the server never sees the DeckCheck link)", post && post.body.url === "", post && JSON.stringify(post.body.url));
  const text = post ? String(post.body.data) : "";
  const lines = text.split("\n");
  ok("deckcheck link: the decklist starts with the commanders under 'Commander'",
    lines[0] === "Commander" && lines[1] === "1 Thrasios, Triton Hero (c16) 46" && lines[2] === "1 Tymna the Weaver (c16) 48" && lines[3] === "" && lines[4] === "Deck", JSON.stringify(lines.slice(0, 5)));
  const deck = lines.slice(5);
  ok("deckcheck link: the rest under 'Deck', each card with its count and printing",
    deck.includes("40 Plains (unf) 235") && deck.includes("1 Sol Ring (c21) 263") && deck.reduce((s, l) => s + Number(l.split(" ")[0]), 0) === 98 && !deck.some((l) => /Thrasios|Tymna/.test(l)), JSON.stringify(deck));
  ok("deckcheck link: the seat's hand and the settings still go with it", post && post.body.hand && post.body.hand.position.z === -30 && post.body.useStates === true, post && JSON.stringify(post.body.hand));
  ok("deckcheck link: no error said", !/DeckCheck|issue/.test(said(r)), said(r));
}
{
  // a deck with no commander: the "Deck" part only
  const r = runDeck(script, form("https://www.deckcheck.co/app/deckview/Zz9-x?tab=stats"), { answers: { [API + "Zz9-x"]: answer(200, FIX.standard) } });
  const text = r.posts && r.posts[0] ? r.posts[0].body.data : "";
  ok("deckcheck link without a commander: 'Deck' part only, every link variant read", r.gets && r.gets.join() === API + "Zz9-x" && text.startsWith("Deck\n") && !text.includes("Commander"), JSON.stringify(r.gets) + " " + JSON.stringify(text));
}

// ───────── errors: said in plain words, nothing posted ─────────
{
  const r = runDeck(script, form("https://deckcheck.co/app/deckview/Err1"), { answers: { [API + "Err1"]: answer(404, { error: "Deck not found" }) } });
  ok("404: said in plain words to the player", /"broadcastToColor" "White" "DeckCheck has no deck at that link\. Check the link and try again\."/.test(said(r)), said(r));
  ok("404: nothing posted, one GET, the importer window kept open", r.posts && r.posts.length === 0 && r.gets.length === 1 && r.next === false, JSON.stringify([r.posts, r.gets, r.next]));
  const cases = [
    [403, { error: "Deck is private" }, /That DeckCheck deck is private: make it public or unlisted on DeckCheck and try again\./],
    [429, { error: "Too many requests" }, /DeckCheck is busy/],
    [500, { error: "Internal" }, /DeckCheck had a problem on its side/],
  ];
  for (const [status, body, want] of cases) {
    const e = runDeck(script, form("https://deckcheck.co/app/deckview/Err2"), { answers: { [API + "Err2"]: answer(status, body) } });
    ok(`${status}: said in plain words, nothing posted`, want.test(said(e)) && e.posts.length === 0, said(e));
  }
  const none = runDeck(script, form("https://deckcheck.co/app/deckview/Err3"));
  ok("no answer: couldn't reach DeckCheck, nothing posted", /Couldn't reach DeckCheck/.test(said(none)) && none.posts.length === 0, said(none));
  const notDeck = runDeck(script, form("https://deckcheck.co/app/home"));
  ok("a deckcheck.co link that isn't a deck: said, no GET, nothing posted", /doesn't look like a DeckCheck deck link/.test(said(notDeck)) && notDeck.gets.length === 0 && notDeck.posts.length === 0, said(notDeck) + JSON.stringify(notDeck.gets));
  const html = runDeck(script, form("https://deckcheck.co/app/deckview/Err4"), { answers: { [API + "Err4"]: answer(200, "<!DOCTYPE html><html></html>") } });
  ok("a 200 that isn't JSON: said, nothing posted", /DeckCheck had a problem on its side/.test(said(html)) && html.posts.length === 0, said(html));
  const huge = JSON.parse(JSON.stringify(FIX.standard));
  huge.boards.mainboard.cards["dc-s2"].quantity = 100000;
  const big = runDeck(script, form("https://deckcheck.co/app/deckview/Err5"), { answers: { [API + "Err5"]: answer(200, huge) } });
  ok("an answer with too many cards: refused, nothing posted", /importer takes at most 250/.test(said(big)) && big.posts.length === 0, said(big));
  const seatless = runDeck(script, form("https://deckcheck.co/app/deckview/Err6"), { color: "Grey" });
  ok("no seat: the importer's own message, and no GET to DeckCheck", /take a seat/.test(said(seatless)) && seatless.gets.length === 0 && seatless.posts.length === 0, said(seatless) + JSON.stringify(seatless.gets));
}

// ───────── the deck the server builds from a DeckCheck link carries the bracket tag ─────────
// (the bracket and threat label reads it from the GM notes of the deck on the library spot: engine-renderer.lua; the
// server only ever saw a plain list, so without this the label never showed, live 2026-11-24)
{
  const build = [JSON.stringify({ Name: "Deck", Nickname: "Library" }), JSON.stringify({ Name: "Card", Nickname: "Thrasios" }),
    JSON.stringify({ Name: "Deck", Nickname: "Tokens", GMNotes: "made by the server" })].join("\n");
  const id = "Tag_1";
  const r = runDeck(script, form(`https://deckcheck.co/app/builder/${id}`), { answers: { [API + id]: answer(200, FIX.partners) }, build });
  const sp = r.spawned || [];
  const decks = sp.filter((o) => o.type === "Deck");
  const card = sp.find((o) => o.type === "Card");
  const tag = decks[0] && decks[0].gm;
  ok("deckcheck build: runs, the server's three objects spawned", !r.error && sp.length === 3 && decks.length === 2 && card, r.error || JSON.stringify(sp));
  ok("deckcheck build: the deck's GM notes hold the DeckCheck tag with its id, bracket and threat",
    typeof tag === "string" && tag.includes("id=" + id) && /bracket=\d/.test(tag) && /threat=\d+\/\d+/.test(tag), JSON.stringify(tag));
  ok("deckcheck build: a deck that came with notes keeps them, the tag on the next line",
    decks[1] && decks[1].gm === "made by the server\n" + tag, JSON.stringify(decks[1] && decks[1].gm));
  ok("deckcheck build: the commander card gets no tag", card && (card.gm || "") === "", JSON.stringify(card));
  const other = runDeck(script, form("https://www.moxfield.com/decks/abc123"), { build });
  const od = (other.spawned || []).filter((o) => o.type === "Deck");
  ok("other link's build: its decks get no tag", !other.error && od.length === 2 && (od[0].gm || "") === "" && od[1].gm === "made by the server", other.error || JSON.stringify(other.spawned));
  // the same seat imports a DeckCheck deck, then a Moxfield one: the second deck must not carry the first one's tag
  const after = runDeck(script, form("https://www.moxfield.com/decks/abc123"), { answers: { [API + id]: answer(200, FIX.partners) }, build,
    first: form(`https://deckcheck.co/app/builder/${id}`) });
  const all = (after.spawned || []).filter((o) => o.type === "Deck");
  ok("a DeckCheck import then another link: the first deck tagged, the second deck not",
    !after.error && all.length === 4 && all[0].gm === tag && (all[2].gm || "") === "" && all[3].gm === "made by the server", after.error || JSON.stringify(after.spawned));
  // (stage 3 review 2026-11-24) the DeckCheck import still waiting for DeckCheck's answer when the same seat imports a
  // Moxfield deck: the late answer must not put its tag on the Moxfield deck (only the seat's latest import may tag)
  const race = runDeck(script, form("https://www.moxfield.com/decks/abc123"), { answers: { [API + id]: answer(200, FIX.partners) }, build,
    first: form(`https://deckcheck.co/app/builder/${id}`), overlap: true });
  const rd = (race.spawned || []).filter((o) => o.type === "Deck");
  ok("a DeckCheck import answered after a later import: no deck carries the DeckCheck tag",
    !race.error && rd.length >= 2 && rd.every((o) => !String(o.gm || "").includes("id=" + id)), race.error || JSON.stringify(race.spawned));
}

// ───────── every other link, and a pasted list: to the server unchanged ─────────
{
  const url = "https://www.moxfield.com/decks/abc123";
  const r = runDeck(script, form(url));
  ok("other link: no GET to DeckCheck", r.gets && r.gets.length === 0, JSON.stringify(r.gets));
  ok("other link: posted to /build unchanged (its url, no decklist)", r.posts && r.posts.length === 1 && r.posts[0].url === BUILD_URL && r.posts[0].body.url === url && r.posts[0].body.data === "", JSON.stringify(r.posts));
  const list = "1 Storm Crow\n1 Island";
  const p = runDeck(script, form("", list));
  ok("pasted decklist: posted unchanged, no GET", p.gets && p.gets.length === 0 && p.posts.length === 1 && p.posts[0].body.data === list && p.posts[0].body.url === "", JSON.stringify(p.posts));
}

// ───────── the Deck tab's help names DeckCheck ─────────
ok("the Deck tab's list of sites names deckcheck.co", script.includes("  - archidekt.com\n  - deckcheck.co\n  - decks.tcgplayer.com\n"));

// ───────── the deploy gives the save's rikrassen importer this script (tools/patch-save.js importerScripts) ─────────
{
  const src = process.env.MTG_TABLE_JSON || path.join(process.env.USERPROFILE || process.env.HOME || "", "Documents", "My Games", "Tabletop Simulator", "Mods", "Workshop", "2296042369.json");
  const work = JSON.parse(fs.readFileSync(src, "utf8"));
  const orig = (work.ObjectStates || []).find((o) => o.GUID === "ddf5de");
  const raw = JSON.stringify({ SaveName: "mine", ObjectStates: [{ GUID: "ddf5de", Nickname: orig && orig.Nickname, LuaScript: orig && orig.LuaScript }, { GUID: "deck01", Name: "Deck", LuaScript: "x" }], LuaScript: "g" }, null, 2);
  let r;
  try { r = importerScripts(raw, save); } catch (e) { r = { raw, updated: [], skipped: [], threw: e.message }; }
  const back = JSON.parse(r.raw);
  ok("deploy: the save's rikrassen importer gets the built script with the DeckCheck links", !r.threw && orig && back.ObjectStates[0].LuaScript === rik.LuaScript && r.updated.some((u) => u.includes("ddf5de")), r.threw || JSON.stringify(r.updated));
  ok("deploy: another object's script stays", back.ObjectStates[1].LuaScript === "x");
}

process.stdout.write(failed ? `\n${failed} rikrassen DeckCheck checks failed (${passed} passed)\n` : `all ${passed} rikrassen DeckCheck checks pass\n`);
process.exit(failed ? 1 : 0);
