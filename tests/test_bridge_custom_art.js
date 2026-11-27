// Player-made card art in the bridge, the plain-cards slice (docs/custom-art-spec.md): a deck line
// "1 Sol Ring #https://..." reaches "mtg ready" as the card's face. One picture per card name per owner (the first link;
// basic lands keep mixing), only links that pass the checks (https, png/jpg/jpeg/webp, 500 characters, no quotes or
// spaces), the "mtg ready" lines naming the cards, the host's "mtg art off|on" (kept in the resume file), the picture in
// every zone, and a known owner using only its own deck's pictures. Boards are the golden's dump2 (Blue player-0 vs AI
// White player-1).
//   node tests/test_bridge_custom_art.js
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const clone = (x) => JSON.parse(JSON.stringify(x));
const D2 = require("./golden/fixtures/dump2.json");
const chats = (h) => h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const tables = (h) => h.effects.filter((e) => e.tts?.t === "table").map((e) => e.tts);

const klr = (n) => `https://img.klrmngr.com/display/front/${n}/${n}/${String(n).repeat(8)}-0000-0000-0000-00000000000${n}.webp`;
const CMD = klr(4);
const SOL = "https://i.imgur.com/MySolRing.png";
const SOL2 = "https://i.imgur.com/OtherSolRing.jpg";
const RAT0 = klr(5), RAT1 = "https://raw.githubusercontent.com/me/art/main/rats-one.webp", RAT2 = "https://i.imgur.com/rats-two.jpeg";
const P1 = klr(6), P2 = "https://i.imgur.com/plains-a.png", P3 = "https://i.imgur.com/plains-b.png";
const WHITE_SOL = klr(7);
const BAD_HTTP = "http://i.imgur.com/farseek.png";

function game(h, board) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: board, fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  return seat;
}
const blueDeck = () => ({ deckName: "Art", commander: [{ n: "Neheb, the Eternal", f: CMD }],
  library: [{ n: "Sol Ring", f: SOL }, { n: "Relentless Rats", f: RAT0 }, { n: "Relentless Rats", f: RAT1 }, { n: "Relentless Rats", f: RAT2 },
    { n: "Plains", f: P1 }, { n: "Plains", f: P2 }, { n: "Plains", f: P3 }, { n: "Plains", f: P1 }, { n: "Farseek", f: BAD_HTTP }] });
const whiteDeck = () => ({ deckName: "W", commander: [{ n: "Neheb, the Eternal", f: CMD }], library: [{ n: "Sol Ring", f: WHITE_SOL }] });
const ready = async (h, seats) => { h.B.onTTS({ t: "decks", json: JSON.stringify({ seats }) }); await h.flush(); };
const card = (id, name, owner, extra = {}) => ({ id, identity: { name }, types: ["Artifact"], controllerId: owner, ownerId: owner, ...extra });
const face = (h, id, name, owner) => h.B.tableCard(card(id, name, owner)).f;
const ids = (k, from) => Array.from({ length: k }, (_, i) => `engine-card-${from + i}`);

(async () => {
  // ── the link checks (spec "Import syntax" and "Safety"): https only, a picture file, 500 characters, nothing that
  // breaks the JSON or the table's Lua tables
  {
    const h = harness.load();
    const p = h.B.artProblem;
    ok("check: a plain https png passes", p("https://i.imgur.com/a.png") === null, p("https://i.imgur.com/a.png"));
    ok("check: .jpg, .jpeg, .webp and capitals pass", ["a.jpg", "a.jpeg", "a.webp", "A.PNG"].every((f) => p(`https://x.example/${f}`) === null));
    ok("check: a query string after the file name passes", p("https://x.example/a.png?v=2") === null, p("https://x.example/a.png?v=2"));
    ok("check: http is refused", /https/.test(p("http://x.example/a.png") || ""), p("http://x.example/a.png"));
    ok("check: a quote is refused", /quote/.test(p('https://x.example/a".png') || "") && /quote/.test(p("https://x.example/a'.png") || ""));
    ok("check: a backslash is refused", /backslash/.test(p("https://x.example/a\\b.png") || ""), p("https://x.example/a\\b.png"));
    ok("check: a space is refused", /space/.test(p("https://x.example/a b.png") || ""), p("https://x.example/a b.png"));
    ok("check: angle brackets are refused", /angle/.test(p("https://x.example/<a>.png") || ""));
    ok("check: a control character is refused", p("https://x.example/a\u0001.png") !== null);
    ok("check: another file type is refused", /\.png/.test(p("https://x.example/a.gif") || "") && p("https://x.example/page") !== null);
    ok("check: a Steam Cloud link passes with no extension", [
      "https://steamusercontent-a.akamaihd.net/ugc/11698913979615550185/7F13F2B39D7065CE85AC235B6369A0747F6F712E/",
      "https://images.steamusercontent.com/ugc/1647720103762682461/35EF6E87970E2A5D6581E7D96A99F8A575B7A15F/"].every((u) => p(u) === null));
    ok("check: a look-alike of a Steam Cloud link is refused", [
      "http://steamusercontent-a.akamaihd.net/ugc/1/AB/", "https://steamusercontent-a.akamaihd.net.evil.example/ugc/1/AB/",
      "https://steamusercontent-a.akamaihd.net/other/1/AB/", "https://evil.example/steamusercontent.com/ugc/1/AB/"].every((u) => p(u) !== null));
    ok("check: 500 characters pass, 501 are refused", p(`https://x.example/${"a".repeat(500 - 22)}.png`) === null && /500/.test(p(`https://x.example/${"a".repeat(501 - 22)}.png`) || ""),
      [p(`https://x.example/${"a".repeat(500 - 22)}.png`), `https://x.example/${"a".repeat(500 - 22)}.png`.length]);
    ok("custom: the importer's own pictures and the card back are not a player's", ![CMD, "https://cards.scryfall.io/normal/front/a/b/ab.jpg",
      "https://wsrv.nl/?url=cards.scryfall.io/x.jpg", "https://steamusercontent-a.akamaihd.net/ugc/1647720103762682461/35EF6E87970E2A5D6581E7D96A99F8A575B7A15F/", null, ""].some(h.B.isCustomArt));
    ok("custom: any other host is a player's", [SOL, RAT1, BAD_HTTP].every(h.B.isCustomArt));
    ok("custom: wsrv.nl proxying another site is a player's", ["https://wsrv.nl/?url=evil.example/x.png",
      "https://wsrv.nl/x.png"].every(h.B.isCustomArt));
    ok("custom: a normal host's link with a quote or angle bracket is a player's, so artProblem sees it", ['https://img.klrmngr.com/x"<.webp', "https://cards.scryfall.io/a b.jpg", 'https://wsrv.nl/?url=cards.scryfall.io/x"y.jpg'].every(h.B.isCustomArt));
    harness.restore();
  }

  // ── "mtg ready": one picture per name, the first link; basics mix; a bad link falls back; the chat says which
  {
    const h = harness.load();
    game(h, clone(D2.board));
    await ready(h, { Blue: blueDeck(), White: whiteDeck() });
    const said = chats(h).find((t) => /Blue \(Art\): ready/.test(t)) || "";
    ok("ready: the deck is ready", !!said, JSON.stringify(chats(h)));
    ok("ready: the chat names a card with the player's picture", said.includes("Sol Ring: your picture on all 1 copies"), said);
    ok("ready: the chat counts every copy", said.includes("Relentless Rats: your picture on all 3 copies"), said);
    ok("ready: two links for one name are warned about", /Relentless Rats: 2 different picture links; every copy wears the first/.test(said), said);
    ok("ready: a bad link is named with why, and the normal picture is said", /Farseek: the picture link was not used \(the link must start with https:\/\/\); it shows its normal picture/.test(said), said);
    ok("ready: basics are said to mix", /Plains: your 2 pictures among its 4 copies/.test(said), said);
    ok("ready: a deck without a player's picture says nothing about art", !/card art/.test(chats(h).find((t) => /White \(W\): ready/.test(t)) || "x"), JSON.stringify(chats(h)));

    const sol = face(h, "engine-card-500", "Sol Ring", "player-0");
    ok("rule: the card wears the player's link exactly as given", sol === SOL, sol);
    const rats = ids(6, 510).map((id) => face(h, id, "Relentless Rats", "player-0"));
    ok("rule: every copy of a non-basic wears the FIRST link (not the deck's normal printing, not the second link)", rats.every((f) => f === RAT1), JSON.stringify(rats));
    const plains = ids(8, 520).map((id) => face(h, id, "Plains", "player-0"));
    ok("rule: basic lands keep mixing the deck's printings, the player's among them", new Set(plains).size === 3 && [P1, P2, P3].every((f) => plains.includes(f)), JSON.stringify(plains));
    const far = face(h, "engine-card-530", "Farseek", "player-0");
    ok("rule: a bad link is never shown; the card falls back to the normal picture", far !== BAD_HTTP, far);
    // (the known-owner rule, PLAN.md: a known owner uses only its own deck's pictures)
    ok("owner: White's Sol Ring wears White's deck's picture, not Blue's", face(h, "engine-card-540", "Sol Ring", "player-1") === WHITE_SOL, face(h, "engine-card-540", "Sol Ring", "player-1"));
    ok("owner: White's Rats (not in White's deck) never wear Blue's picture", ![RAT0, RAT1, RAT2].includes(face(h, "engine-card-541", "Relentless Rats", "player-1")), face(h, "engine-card-541", "Relentless Rats", "player-1"));
    ok("owner: a card stolen from Blue keeps Blue's picture", h.B.tableCard(card("engine-card-542", "Sol Ring", "player-0", { controllerId: "player-1" })).f === SOL);
    ok("owner: a token copy of Blue's card wears Blue's picture", h.B.tableCard(card("engine-card-543", "Sol Ring", "player-0", { identity: { name: "Sol Ring", isToken: true } })).f === SOL);
    harness.restore();
  }

  // ── the picture in every zone the table draws: hand, battlefield, stack, graveyard, exile, command zone
  {
    const h = harness.load();
    const b = clone(D2.board);
    const gv = b.gameView;
    const zone = (z, o) => gv.zones.find((x) => x.zone === z && x.ownerId === o);
    const where = { hand: "engine-card-601", battlefield: "engine-card-602", graveyard: "engine-card-603", exile: "engine-card-604", command: "engine-card-605" };
    for (const [z, id] of Object.entries(where)) {
      const list = zone(z, "player-0");
      list.cards.push(card(id, "Sol Ring", "player-0", { types: ["Artifact"], visibility: "visible" }));
      if (list.count != null) list.count = list.cards.length;
    }
    gv.stack = [{ id: "engine-stack-9", sourceId: "engine-card-606", ownerId: "player-0", controllerId: "player-0", identity: { name: "Sol Ring" }, text: "", targets: [] }];
    game(h, b);
    await ready(h, { Blue: blueDeck() });
    h.B.sendTable(); await h.flush();
    // (a card's details go out once, with the first board that has it; later boards say "as sent before")
    const statics = Object.assign({}, ...tables(h).map((t) => t.cards || {}));
    const shown = (id) => tables(h).flatMap((t) => (t.players || []).filter((p) => p.color === "Blue")
      .flatMap((p) => ["hand", "battlefield", "graveyard", "exile", "command"].flatMap((z) => (Array.isArray(p[z]) ? p[z] : []).map((c) => [z, c.id])))).filter(([, i]) => i === id).map(([z]) => z);
    for (const [z, id] of Object.entries(where)) {
      ok(`zones: precondition, the card is drawn in the ${z}`, shown(id).includes(z), JSON.stringify(shown(id)));
      ok(`zones: the player's picture in the ${z}`, statics[id]?.f === SOL, JSON.stringify(statics[id]));
    }
    const stackF = tables(h).map((t) => t.stack?.[0]?.f).filter(Boolean);
    ok("zones: the player's picture on the stack", stackF.length > 0 && stackF.every((f) => f === SOL), JSON.stringify(stackF));
    ok("zones: a question's picture is the player's too", h.B.imgOf(card("engine-card-601", "Sol Ring", "player-0")) === SOL);
    harness.restore();
  }

  // ── the host's switch: off, every card shows the normal picture; on again, the player's; kept over a bridge restart
  {
    const h = harness.load();
    game(h, clone(D2.board));
    await ready(h, { Blue: blueDeck() });
    h.B._getGame().pictures = { Blue: h.B._readyDecks.Blue.images }; // (as onGameStarted keeps them for the game, gamePictures)
    h.B.onTTS({ t: "art", json: JSON.stringify({ color: "Blue", on: false }) }); await h.flush();
    ok("switch: off is said to everyone", chats(h).some((t) => /Custom card art off/.test(t)) && h.effects.some((e) => e.tts?.t === "chat" && /art off/.test(e.tts.text) && e.tts.color === null), JSON.stringify(chats(h).slice(-2)));
    const sol = face(h, "engine-card-500", "Sol Ring", "player-0");
    ok("switch off: no player's picture on a card", sol !== SOL, sol);
    const rats = ids(4, 510).map((id) => face(h, id, "Relentless Rats", "player-0"));
    ok("switch off: a card with a normal printing in the deck shows that printing", rats.every((f) => f === RAT0), JSON.stringify(rats));
    const plains = ids(8, 520).map((id) => face(h, id, "Plains", "player-0"));
    ok("switch off: basics show only the deck's normal printings", plains.every((f) => f === P1), JSON.stringify(plains));
    // (a restarted bridge keeps it: the resume file)
    const fsm = require("fs");
    const w0 = fsm.writeFile;
    let snapText = null;
    fsm.writeFile = (p, d, ...rest) => { if (/mtg-bridge-game-test\.json\.tmp$/.test(String(p))) snapText = String(d); return w0(p, d, ...rest); };
    h.B.saveResume();
    fsm.writeFile = w0;
    ok("switch: the resume file holds it", !!snapText && JSON.parse(snapText).game.artOff === true, String(snapText).slice(0, 120));
    h.B.onTTS({ t: "art", json: JSON.stringify({ color: "Blue", on: true }) }); await h.flush();
    ok("switch on: the player's picture is back", face(h, "engine-card-500", "Sol Ring", "player-0") === SOL);
    ok("switch: on is said to everyone", chats(h).some((t) => /Custom card art on/.test(t)));
    harness.restore();
    const h2 = harness.load();
    await fsm.promises.writeFile(process.env.MTG_RESUME_FILE, snapText);
    const resumed = h2.B.resumeGame();
    await fsm.promises.unlink(process.env.MTG_RESUME_FILE).catch(() => {});
    ok("switch: after a bridge restart art is still off", resumed && h2.B._customArt.off === true && face(h2, "engine-card-500", "Sol Ring", "player-0") !== SOL,
      JSON.stringify([resumed, h2.B._customArt, face(h2, "engine-card-500", "Sol Ring", "player-0")]));
    ok("switch: after a restart the pictures are still the game's (art on again shows the player's)",
      (h2.B.onTTS({ t: "art", json: JSON.stringify({ on: true }) }), face(h2, "engine-card-500", "Sol Ring", "player-0") === SOL));
    harness.restore();
    // (a fresh bridge: on)
    const h3 = harness.load();
    ok("switch: a fresh bridge has art on", h3.B._customArt.off === false);
    harness.restore();
  }

  // ── "mtg ready" while art is off says so
  {
    const h = harness.load();
    game(h, clone(D2.board));
    h.B.onTTS({ t: "art", json: JSON.stringify({ on: false }) }); await h.flush();
    await ready(h, { Blue: blueDeck() });
    const said = chats(h).find((t) => /Blue \(Art\): ready/.test(t)) || "";
    ok("ready with art off: the player is told everyone sees the normal pictures", /custom art off/.test(said), said);
    harness.restore();
  }

  console.log(failed ? `FAILED: ${failed} failed, ${passed} passed` : `PASSED: ${passed} passed, 0 failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { harness.restore(); console.log(e.stack); process.exit(1); });
