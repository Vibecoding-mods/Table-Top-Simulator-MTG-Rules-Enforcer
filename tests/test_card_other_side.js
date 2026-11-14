// See and cast a card's other side (docs/card-other-side-spec.md). The bridge sends a two-faced card's other face (o2,
// the picture) and its name (n2), in a hand too, where the card's back is the plain Magic back; it marks each cast or
// play of such a card with the side it plays (side 1 the face it shows, 2 its other face); a drag carrying the side
// shown plays that side, or says it can't be. The table spawns the card with two TTS states (state 2 its other face,
// the plain back behind it in a hand), keeps the object a player turns to state 2, and sends the side shown with the
// drag. Engine strings as Forge's harness makes them: "Cast <face name>" / "Play <face name>" (ActionSpace
// actionBaseLabel + formatActionLabel), mode "normal" for both faces of a modal double-faced card; isDoubleFaced is
// false for one (Forge's Card.isDoubleFaced is transform or meld only).
//   node tests/test_card_other_side.js
const path = require("path");
const harness = require("./bridge-harness");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

let failed = 0, passed = 0;
// (stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const clone = (x) => JSON.parse(JSON.stringify(x));

// ───────── the bridge ─────────
const D2 = require(path.join(__dirname, "golden", "fixtures", "dump2.json"));
const VF = "https://img.example/valki.webp", VB = "https://img.example/tibalt.webp";
const VALKI = "Valki, God of Lies", TIBALT = "Tibalt, Cosmic Impostor";
const CACHE = {
  "valki, god of lies": { face: VF, back: VB, faces: [VALKI, TIBALT] },
  "tibalt, cosmic impostor": { face: VB, back: VF, faces: [TIBALT, VALKI] },
  "emeria's call": { face: "https://img.example/call.webp", back: "https://img.example/skyclave.webp", faces: ["Emeria's Call", "Emeria, Shattered Skyclave"] },
};
const ID = "engine-card-75"; // (D2's Hurloon Minotaur in Blue's hand, renamed below)
// D2 with card 75 named `name` and moved to `zone` (Blue's)
function board({ name = VALKI, zone = "hand", main = true, extra = {} } = {}) {
  const b = clone(D2.board);
  const gv = b.gameView;
  if (main) Object.assign(gv, { activePlayerId: "player-0", step: "main1", priorityPlayerId: "player-0", stack: [] });
  const hand = gv.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0");
  const c = hand.cards.splice(hand.cards.findIndex((x) => x.id === ID), 1)[0];
  c.identity.name = name;
  Object.assign(c, extra);
  let to = gv.zones.find((z) => z.zone === zone && z.ownerId === "player-0");
  if (!to) { to = { zone, ownerId: "player-0", cards: [] }; gv.zones.push(to); }
  to.cards.push(c);
  return b;
}
function game(h, b, more = {}) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: b, fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, ...more });
  return seat;
}
// the card's details in the table messages sent since effect `from`
const sentCard = (h, id, from = 0) => {
  const all = h.effects.slice(from).filter((e) => e.tts && e.tts.t === "table").map((e) => (e.tts.cards || {})[id]).filter(Boolean);
  return all.length ? all[all.length - 1] : null;
};
const pick = (st) => (st ? { b: st.b, o2: st.o2 ?? null, n2: st.n2 ?? null } : null);
const actsSent = (h) => h.effects.map((e) => e.relay).filter((r) => r && r.type === "BroadcastState" && r.state?.kind === "response").map((r) => r.state.action?.output || {});
const chats = (h) => h.effects.filter((e) => e.tts && e.tts.t === "chat").map((e) => e.tts.text);
const refused = (h) => h.effects.filter((e) => e.tts && e.tts.t === "refused").map((e) => e.tts.id);
const prompt = (actions) => ({ promptId: 900, decidingPlayerId: "player-0", input: { type: "chooseAction", actions } });
const cast = (id, label, cardId = ID, mode = { type: "normal" }) => ({ id, type: "cast", cardId, label, mode });
const BOTH = [cast("a-valki", `Cast ${VALKI}`), cast("a-tibalt", `Cast ${TIBALT}`)];
async function withBridge(opts, fn) {
  const h = harness.load(opts);
  try { return await fn(h); } finally { harness.restore(); }
}
const intent = (h, m) => h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "play", id: ID, ...m }) });

(async () => {
  // 1. what the table is sent
  await withBridge({ imageCache: CACHE }, async (h) => {
    game(h, board());
    h.B.sendTable(); await h.flush();
    same("table: a modal double-faced card in the hand: the plain back, its other face and that face's name", pick(sentCard(h, ID)), { b: "", o2: VB, n2: TIBALT });
    const plain = sentCard(h, "engine-card-35");
    ok("table: a card with one face has no other side", plain && plain.o2 === undefined && plain.n2 === undefined, JSON.stringify(plain));
  });
  await withBridge({ imageCache: CACHE }, async (h) => {
    game(h, board({ zone: "battlefield" }));
    h.B.sendTable(); await h.flush();
    same("table: on the battlefield its back is its other face, and o2 says so too", pick(sentCard(h, ID)), { b: VB, o2: VB, n2: TIBALT });
  });
  await withBridge({ imageCache: CACHE }, async (h) => {
    game(h, board({ name: TIBALT, zone: "battlefield" }));
    h.B.sendTable(); await h.flush();
    const st = sentCard(h, ID);
    same("table: cast as its back face, the face shown is that face and the other side is the front", { f: st && st.f, ...pick(st) }, { f: VB, b: VF, o2: VF, n2: VALKI });
  });
  await withBridge({ imageCache: CACHE }, async (h) => {
    game(h, board({ zone: "command" }));
    h.B.sendTable(); await h.flush();
    same("table: in the command zone too", pick(sentCard(h, ID)), { b: VB, o2: VB, n2: TIBALT });
  });
  await withBridge({ imageCache: CACHE }, async (h) => {
    game(h, board({ zone: "battlefield", extra: { isCopy: true } }));
    h.B.sendTable(); await h.flush();
    const st = sentCard(h, ID);
    ok("table: a copy of a double-faced card (Clone as Valki) has no other side of its own", st && st.o2 === undefined, JSON.stringify(st));
  });
  // a cache entry from before names were kept: the picture is known, its name asked of Scryfall once
  await withBridge({ imageCache: { "valki, god of lies": { face: VF, back: VB } }, cardFaces: { [VALKI]: [VALKI, TIBALT] } }, async (h) => {
    game(h, board());
    h.B.sendTable(); await h.flush();
    const asked = h.effects.filter((e) => e.fetch && e.fetch.includes("/cards/collection")).flatMap((e) => (e.body?.identifiers || []).map((i) => i.name));
    ok("names unknown: Scryfall is asked for the card's faces", asked.includes(VALKI), JSON.stringify(asked));
    const st = sentCard(h, ID);
    same("names unknown: once answered, the name goes out and the picture stays the one it had", st && { f: st.f, o2: st.o2, n2: st.n2 }, { f: VF, o2: VB, n2: TIBALT });
    const mark = h.effects.length;
    h.B.sendTable(); await h.flush();
    ok("names unknown: asked once", !h.effects.slice(mark).some((e) => e.fetch && e.fetch.includes("/cards/collection")));
  });

  // 2. the side each priority option plays
  await withBridge({ imageCache: CACHE }, async (h) => {
    const seat = game(h, board());
    h.B.onPrompt(seat, prompt([...BOTH, cast("a-plain", "Cast Venomous Changeling", "engine-card-35")])); await h.flush();
    const opts = (seat.prompt?.ui?.options || []).filter((o) => o.cardId).map((o) => [o.id, o.side ?? null]);
    same("priority: each way of a double-faced card names its side, a one-faced card's none", opts, [["a-valki", 1], ["a-tibalt", 2], ["a-plain", null]]);
  });
  await withBridge({ imageCache: CACHE }, async (h) => {
    const seat = game(h, board({ name: "Emeria's Call" }));
    h.B.onPrompt(seat, prompt([cast("a-call", "Cast Emeria's Call"), cast("a-land", "Play Emeria, Shattered Skyclave"), cast("a-back", "Cast Emeria's Call", ID, { type: "backFaceLand" })])); await h.flush();
    same("priority: a land back face (Play <back name>) and a backFaceLand mode are side 2", (seat.prompt?.ui?.options || []).filter((o) => o.cardId).map((o) => o.side ?? null), [1, 2, 2]);
  });

  // 3. a drag plays the side shown
  const drag = async (name, m, actions, want, extra = {}) => withBridge({ imageCache: CACHE }, async (h) => {
    const seat = game(h, board(extra));
    h.B.onPrompt(seat, prompt(actions)); await h.flush();
    intent(h, m); await h.flush();
    const got = { sent: actsSent(h).map((a) => a.actionId), asked: seat.prompt?.under ? (seat.prompt.ui.options || []).filter((o) => o.id !== "__back").map((o) => o.label) : null, refused: refused(h), said: chats(h).filter((t) => /can't be|other side/.test(t)) };
    for (const [k, v] of Object.entries(want)) {
      if (k === "said") ok(`${name}: said`, got.said.some((t) => v.test(t)), JSON.stringify(got.said));
      else same(`${name}: ${k}`, got[k], v);
    }
  });
  await drag("drag, back shown", { side: 2 }, BOTH, { sent: ["a-tibalt"], asked: null, refused: [] });
  await drag("drag, front shown", { side: 1 }, BOTH, { sent: ["a-valki"], asked: null, refused: [] });
  await drag("drag from an older table (no side)", {}, BOTH, { sent: [], asked: [`Cast ${VALKI}`, `Cast ${TIBALT}`] });
  await drag("drag, back shown, only the front castable", { side: 2 }, [BOTH[0]], { sent: [], refused: [ID], said: new RegExp(`^\\[MTG\\] ${TIBALT} can't be cast right now`) });
  await drag("drag, front shown, only the back castable", { side: 1 }, [BOTH[1]], { sent: [], refused: [ID], said: new RegExp(`^\\[MTG\\] ${VALKI} can't be cast right now`) });
  await drag("drag, land back shown", { side: 2 }, [cast("a-call", "Cast Emeria's Call"), cast("a-land", "Play Emeria, Shattered Skyclave")], { sent: ["a-land"], refused: [] }, { name: "Emeria's Call" });
  await drag("drag, front land card shown, only the land back playable", { side: 1 }, [cast("a-land", "Play Emeria, Shattered Skyclave")],
    { sent: [], refused: [ID], said: /^\[MTG\] Emeria's Call can't be cast right now/ }, { name: "Emeria's Call" });
  // (a way of no one side, cycling, stays with either side)
  await drag("drag, back shown, with an ability of no side", { side: 2 }, [...BOTH, { id: "a-cycle", type: "activateAbility", cardId: ID, description: "Cycling {2}" }],
    { sent: [], asked: [`Cast ${TIBALT}`, "Cycling {2}"] });
  // (a side sent for a card the bridge knows one face of: as before)
  await drag("drag of a one-faced card with a side", { side: 2 }, [cast("a-plain", "Cast Grizzly Bears")], { sent: ["a-plain"], refused: [] }, { name: "Grizzly Bears" });
  // dragged while it isn't this player's priority: kept, and cast as the side shown at the next priority
  await withBridge({ imageCache: CACHE }, async (h) => {
    const seat = game(h, board({ main: false }));
    intent(h, { side: 2 }); await h.flush();
    h.B.onPrompt(seat, prompt(BOTH)); await h.flush();
    same("queued drag, back shown: the back is cast at the next priority", actsSent(h).map((a) => a.actionId), ["a-tibalt"]);
  });

  // ───────── 4. every two-sided layout, from real card data ─────────
  // Scryfall's own answers (tests/golden/fixtures/scryfall-two-sided.json, fetched 2026-11-13: what the bridge asks and
  // reads) with an empty picture cache, and Forge's names and labels: an engine card is named after the face it shows
  // (Card.getName: "Neo Exdeath, Dimension's End" transformed, "Kenzo the Hardhearted" flipped, "Brisela, Voice of
  // Nightmares" melded, "Fire // Ice" whole, "Stomp" or "Fire" as the spell on the stack), and a way is labelled
  // "Cast|Play <the face's name>" plus " (<AlternativeCost>)" (ManaBrewInteractiveSession.formatActionLabel), with
  // " (Prototype)" for a prototype cast. The layouts are Forge's CardSplitType (docs/card-other-side-spec.md, the table).
  const SF = require(path.join(__dirname, "golden", "fixtures", "scryfall-two-sided.json")).data;
  const sf = (n) => SF.find((c) => c.name === n || (c.card_faces || []).some((f) => f.name === n));
  const kf = (n) => `kf${sf(n).id}`, kb = (n) => `kb${sf(n).id}`;
  const textOf = (n) => { const c = sf(n); return c.card_faces ? c.card_faces.find((f) => f.name === n).oracle_text : c.oracle_text; };
  const asked = (h, n) => h.effects.filter((e) => e.fetch && e.fetch.includes("/cards/collection")).flatMap((e) => (e.body?.identifiers || []).map((i) => i.name)).filter((x) => x === n).length;
  const DECK_PIC = "https://img.example/deck-printing.webp";
  // a board with card 75 as `name` in `zone`, shown `rounds` times (Scryfall answers in between); fn(h, seat)
  const real = (o, fn) => withBridge({ scryfallCards: SF }, async (h) => {
    const b = board({ name: o.name, zone: o.zone || "hand", extra: o.extra || {} });
    if (o.stack) b.gameView.stack = o.stack;
    const seat = game(h, b, o.pictures ? { pictures: { Blue: o.pictures } } : {});
    for (let k = 0; k < (o.rounds || 2); k++) { h.B.sendTable(); await h.flush(); }
    return fn(h, seat);
  });
  const detail = (st) => (st ? { f: st.f ?? null, b: st.b ?? null, o2: st.o2 ?? null, n2: st.n2 ?? null, t2: st.t2 ?? null } : null);
  const sides = async (h, seat, actions) => { h.B.onPrompt(seat, prompt(actions)); await h.flush(); return (seat.prompt?.ui?.options || []).filter((o) => o.cardId).map((o) => o.side ?? null); };
  const askedLabels = (seat) => (seat.prompt?.under ? (seat.prompt.ui.options || []).filter((o) => o.id !== "__back").map((o) => o.label) : null);
  const dragReal = async (h, seat, actions, m = {}) => {
    h.B.onPrompt(seat, prompt(actions)); await h.flush();
    intent(h, m); await h.flush();
    return { sent: actsSent(h).map((a) => a.actionId), asked: askedLabels(seat), refused: refused(h), said: chats(h).filter((t) => /can't be|other side/.test(t)) };
  };

  // Modal double-faced (Kaldheim's gods, Zendikar Rising's spell // land, the Pathways): both faces castable
  await real({ name: VALKI }, async (h) => {
    same("layout modal DFC (Valki): in a hand its other face, name and rules text, from Scryfall", detail(sentCard(h, ID)), { f: kf(VALKI), b: "", o2: kb(VALKI), n2: TIBALT, t2: textOf(TIBALT) });
  });
  await real({ name: "Shatterskull Smashing" }, async (h, seat) => {
    same("layout modal DFC, a land back (Shatterskull Smashing): the spell is side 1, Play <the land> side 2", await sides(h, seat,
      [cast("a1", "Cast Shatterskull Smashing"), cast("a2", "Play Shatterskull, the Hammer Pass")]), [1, 2]);
  });
  await real({ name: "Brightclimb Pathway" }, async (h, seat) => {
    same("layout modal DFC, two lands (Brightclimb // Grimclimb Pathway): each Play names its side", await sides(h, seat,
      [cast("a1", "Play Brightclimb Pathway"), cast("a2", "Play Grimclimb Pathway")]), [1, 2]);
  });
  await real({ name: "Brightclimb Pathway" }, async (h, seat) => {
    same("layout modal DFC, two lands: shown as the back, the drag plays the back land", (await dragReal(h, seat, [cast("a1", "Play Brightclimb Pathway"), cast("a2", "Play Grimclimb Pathway")], { side: 2 })).sent, ["a2"]);
  });

  // Transforming (Exdeath, Delver, werewolves, the flip sagas): the back is read, cast only by Disturb or More Than Meets the Eye
  await real({ name: "Exdeath, Void Warlock" }, async (h) => {
    same("layout transform (Exdeath) in a hand: its back face to read, with its rules text", detail(sentCard(h, ID)),
      { f: kf("Exdeath, Void Warlock"), b: "", o2: kb("Exdeath, Void Warlock"), n2: "Neo Exdeath, Dimension's End", t2: textOf("Neo Exdeath, Dimension's End") });
  });
  await real({ name: "Neo Exdeath, Dimension's End", zone: "battlefield" }, async (h) => {
    same("layout transform, transformed on the battlefield (Neo Exdeath): its picture is the back face, the front its other side", detail(sentCard(h, ID)),
      { f: kb("Neo Exdeath, Dimension's End"), b: kf("Neo Exdeath, Dimension's End"), o2: kf("Neo Exdeath, Dimension's End"), n2: "Exdeath, Void Warlock", t2: textOf("Exdeath, Void Warlock") });
  });
  await real({ name: "Fable of the Mirror-Breaker", zone: "battlefield" }, async (h) => {
    same("layout transform, a saga that flips (Fable of the Mirror-Breaker): its back to read", [sentCard(h, ID)?.o2, sentCard(h, ID)?.n2], [kb("Fable of the Mirror-Breaker"), "Reflection of Kiki-Jiki"]);
  });
  const MTMTE = [cast("a1", "Cast Starscream, Power Hungry"), cast("a2", "Cast Starscream, Seeker Leader (MTMtE)", ID, { type: "alternative", cost: "MORE_THAN_MEETS_THE_EYE" })];
  await real({ name: "Starscream, Power Hungry" }, async (h, seat) => {
    same("layout transform, More Than Meets the Eye (Starscream): the back face's cast is side 2", await sides(h, seat, MTMTE), [1, 2]);
  });
  await real({ name: "Starscream, Power Hungry" }, async (h, seat) => {
    same("layout transform, More Than Meets the Eye: shown as the back, the drag casts it for its MTMtE cost", (await dragReal(h, seat, MTMTE, { side: 2 })).sent, ["a2"]);
  });
  const DISTURB = [cast("a1", "Cast Generous Soul (Disturb)", ID, { type: "alternative", cost: "DISTURB" })];
  await real({ name: "Beloved Beggar", zone: "graveyard", extra: { mayPlay: true } }, async (h, seat) => {
    ok("layout transform, Disturb (Beloved Beggar) in the graveyard's playable row: its back face to show", sentCard(h, ID)?.o2 === kb("Beloved Beggar"), JSON.stringify(sentCard(h, ID)));
    same("layout transform, Disturb: the back face's cast from the graveyard is side 2", await sides(h, seat, DISTURB), [2]);
  });
  await real({ name: "Beloved Beggar", zone: "graveyard", extra: { mayPlay: true } }, async (h, seat) => {
    const d = await dragReal(h, seat, DISTURB, { side: 2 });
    same("layout transform, Disturb: shown as Generous Soul, the drag casts it", d.sent, ["a1"]);
  });

  // Meld (Gisela + Bruna = Brisela): a half's other side is the card it melds into; the melded card is that card
  await real({ name: "Gisela, the Broken Blade" }, async (h) => {
    same("layout meld, a half in a hand (Gisela): its other side is Brisela, picture, name and text", detail(sentCard(h, ID)),
      { f: kf("Gisela, the Broken Blade"), b: "", o2: kf("Brisela, Voice of Nightmares"), n2: "Brisela, Voice of Nightmares", t2: textOf("Brisela, Voice of Nightmares") });
  });
  await real({ name: "Bruna, the Fading Light", zone: "battlefield", extra: { text: "Flying, vigilance\n(Melds with Gisela, the Broken Blade.)" } }, async (h) => {
    same("layout meld, the half Forge's index knows one face of (Bruna, read by its meld text): Brisela too", [sentCard(h, ID)?.o2, sentCard(h, ID)?.n2], [kf("Brisela, Voice of Nightmares"), "Brisela, Voice of Nightmares"]);
  });
  await withBridge({ scryfallCards: SF, imageCache: { "bruna, the fading light": { face: "https://img.example/bruna-old.webp", back: null } } }, async (h) => {
    game(h, board({ name: "Bruna, the Fading Light", extra: { text: "Flying, vigilance\n(Melds with Gisela, the Broken Blade.)" } }));
    for (let k = 0; k < 3; k++) { h.B.sendTable(); await h.flush(); }
    same("layout meld, an old cache entry for Bruna (one face in Forge's index, no back): asked once by its meld text, Brisela its other side",
      [asked(h, "Bruna, the Fading Light"), sentCard(h, ID)?.n2], [1, "Brisela, Voice of Nightmares"]);
  });
  await real({ name: "Brisela, Voice of Nightmares", zone: "battlefield" }, async (h) => {
    same("layout meld, melded (Brisela): its own picture, no other side", detail(sentCard(h, ID)), { f: kf("Brisela, Voice of Nightmares"), b: "", o2: null, n2: null, t2: null });
  });

  // Flip (Kamigawa): one picture, the flipped half printed upside down on it
  await real({ name: "Bushi Tenderfoot" }, async (h) => {
    same("layout flip (Bushi Tenderfoot) in a hand: the flipped half's name and text, no second picture", detail(sentCard(h, ID)),
      { f: kf("Bushi Tenderfoot"), b: "", o2: null, n2: "Kenzo the Hardhearted", t2: textOf("Kenzo the Hardhearted") });
  });
  await real({ name: "Kenzo the Hardhearted", zone: "battlefield", pictures: { "Bushi Tenderfoot": [{ face: DECK_PIC, back: null }] }, rounds: 3 }, async (h) => {
    const st = sentCard(h, ID);
    same("layout flip, flipped on the battlefield (Kenzo): its deck's picture of the card, the unflipped half its other side", [st?.f, st?.n2, st?.o2 ?? null], [DECK_PIC, "Bushi Tenderfoot", null]);
    same("layout flip, flipped: its name is asked of Scryfall once, not on every board", asked(h, "Kenzo the Hardhearted"), 1);
  });

  // Adventure and omen: one picture, the creature and its spell; the drag asks which
  const ADV = [cast("a1", "Cast Bonecrusher Giant"), cast("a2", "Cast Stomp")];
  await real({ name: "Bonecrusher Giant" }, async (h, seat) => {
    same("layout adventure (Bonecrusher Giant) in a hand: Stomp's name and text, no second picture", detail(sentCard(h, ID)),
      { f: kf("Bonecrusher Giant"), b: "", o2: null, n2: "Stomp", t2: textOf("Stomp") });
    same("layout adventure: its ways name no side (one picture shows both)", await sides(h, seat, ADV), [null, null]);
  });
  await real({ name: "Bonecrusher Giant" }, async (h, seat) => {
    same("layout adventure: a drag asks which, the creature or the adventure", (await dragReal(h, seat, ADV, {})).asked, ["Cast Bonecrusher Giant", "Cast Stomp"]);
  });
  const STOMP = [{ id: "stack-1", sourceId: ID, controllerId: "player-0", ownerId: "player-0", identity: { name: "Stomp" }, text: "Stomp deals 2 damage to any target.", targets: [] }];
  await real({ name: "Bonecrusher Giant", zone: "exile", stack: STOMP, pictures: { "Bonecrusher Giant": [{ face: DECK_PIC, back: null }] }, rounds: 3 }, async (h) => {
    const msgs = h.effects.filter((e) => e.tts && e.tts.t === "table" && (e.tts.stack || []).length);
    const top = msgs.length ? msgs[msgs.length - 1].tts.stack[0] : null;
    same("layout adventure, Stomp on the stack: its deck's picture of Bonecrusher Giant", top && top.f, DECK_PIC);
    ok("layout adventure, Stomp on the stack: asked of Scryfall once at most, not on every board", asked(h, "Stomp") <= 1, String(asked(h, "Stomp")));
  });
  await real({ name: "Dirgur Island Dragon" }, async (h) => {
    same("layout omen (Dirgur Island Dragon) in a hand: the omen's name and text", [sentCard(h, ID)?.n2, sentCard(h, ID)?.t2, sentCard(h, ID)?.o2 ?? null], ["Skimming Strike", textOf("Skimming Strike"), null]);
  });

  // Split, fuse, aftermath, Room: one picture, the engine's name and text already both halves
  await real({ name: "Fire // Ice" }, async (h, seat) => {
    same("layout split (Fire // Ice) in a hand: its name is both halves, no other side", detail(sentCard(h, ID)), { f: kf("Fire"), b: "", o2: null, n2: null, t2: null });
    same("layout split: a drag asks which half", (await dragReal(h, seat, [cast("a1", "Cast Fire"), cast("a2", "Cast Ice")], {})).asked, ["Cast Fire", "Cast Ice"]);
  });
  await real({ name: "Fire // Ice" }, async (h, seat) => {
    // (Scryfall's batch lookup misses "Fire // Ice"; its exact-name answer names the halves, so Ice cast later is known)
    seat.board.state.gameView.stack = [{ id: "stack-1", sourceId: ID, controllerId: "player-0", ownerId: "player-0", identity: { name: "Ice" }, text: "Tap target permanent.", targets: [] }];
    h.B.sendTable(); await h.flush();
    same("layout split: its halves are known from Scryfall's answer for the whole card, Ice never asked for", asked(h, "Ice"), 0);
  });
  await withBridge({ scryfallCards: SF, imageCache: { "bonecrusher giant": { face: "https://img.example/old-entry.webp", back: null } } }, async (h) => {
    game(h, board({ name: "Bonecrusher Giant" }));
    for (let k = 0; k < 3; k++) { h.B.sendTable(); await h.flush(); }
    const st = sentCard(h, ID);
    same("a cache entry from before layouts were kept (an adventure, no back, Forge's two faces): asked once, its picture kept, Stomp's name and text added",
      [asked(h, "Bonecrusher Giant"), st?.f, st?.n2, st?.t2], [1, "https://img.example/old-entry.webp", "Stomp", textOf("Stomp")]);
  });
  await real({ name: "Ice", zone: "exile" }, async (h) => {
    same("layout split, a half by its own name (Ice): no other side (Scryfall's split layout)", [sentCard(h, ID)?.n2 ?? null, sentCard(h, ID)?.t2 ?? null], [null, null]);
  });
  const FIRE = [{ id: "stack-1", sourceId: ID, controllerId: "player-0", ownerId: "player-0", identity: { name: "Fire" }, text: "Fire deals 2 damage divided as you choose.", targets: [] }];
  await real({ name: "Fire // Ice", zone: "exile", stack: FIRE, pictures: { "Fire // Ice": [{ face: DECK_PIC, back: null }] }, rounds: 3 }, async (h) => {
    const msgs = h.effects.filter((e) => e.tts && e.tts.t === "table" && (e.tts.stack || []).length);
    same("layout split, Fire on the stack: its deck's picture of Fire // Ice", msgs.length ? msgs[msgs.length - 1].tts.stack[0].f : null, DECK_PIC);
  });
  await real({ name: "Wear // Tear" }, async (h, seat) => {
    same("layout fuse (Wear // Tear): a drag asks either half or both", (await dragReal(h, seat, [cast("a1", "Cast Wear"), cast("a2", "Cast Tear"), cast("a3", "Cast Wear // Tear")], {})).asked,
      ["Cast Wear", "Cast Tear", "Cast both halves (fuse)"]);
  });
  await real({ name: "Cut // Ribbons", zone: "graveyard", extra: { mayPlay: true } }, async (h, seat) => {
    const d = await dragReal(h, seat, [cast("a1", "Cast Ribbons")], {});
    same("layout aftermath (Cut // Ribbons) in the graveyard's playable row: no other side; the drag casts Ribbons", [sentCard(h, ID)?.n2 ?? null, d.sent], [null, ["a1"]]);
  });
  const RIBBONS = [{ id: "stack-1", sourceId: ID, controllerId: "player-0", ownerId: "player-0", identity: { name: "Ribbons" }, text: "Each opponent loses X life.", targets: [] }];
  await real({ name: "Cut // Ribbons", zone: "exile", stack: RIBBONS, rounds: 3 }, async (h) => {
    const msgs = h.effects.filter((e) => e.tts && e.tts.t === "table" && (e.tts.stack || []).length);
    same("layout aftermath, Ribbons (the right half) on the stack: the card's picture, asked of Scryfall once",
      [msgs.length ? msgs[msgs.length - 1].tts.stack[0].f : null, asked(h, "Ribbons")], [`https://img.klrmngr.com/display/front/${sf("Ribbons").id[0]}/${sf("Ribbons").id[1]}/${sf("Ribbons").id}.webp`, 1]);
  });
  await real({ name: "Unholy Annex // Ritual Chamber" }, async (h) => {
    same("layout Room (Unholy Annex // Ritual Chamber): both doors in its name, no other side", [sentCard(h, ID)?.n2 ?? null, sentCard(h, ID)?.o2 ?? null], [null, null]);
  });
  // Prototype: one face, two ways
  await real({ name: "Autonomous Assembler" }, async (h, seat) => {
    const d = await dragReal(h, seat, [cast("a1", "Cast Autonomous Assembler"), cast("a2", "Cast Autonomous Assembler (Prototype)")], {});
    same("layout prototype (Autonomous Assembler): no other side; a drag asks which way", [sentCard(h, ID)?.n2 ?? null, d.asked], [null, ["Cast Autonomous Assembler", "Cast Autonomous Assembler (Prototype)"]]);
  });

  // Transforming battles (Invasion of Zendikar // Awakened Skyclave): the front is cast, the back read
  await real({ name: "Invasion of Zendikar" }, async (h) => {
    same("layout transform, a battle (Invasion of Zendikar) in a hand: its back face to read, with its rules text", detail(sentCard(h, ID)),
      { f: kf("Invasion of Zendikar"), b: "", o2: kb("Invasion of Zendikar"), n2: "Awakened Skyclave", t2: textOf("Awakened Skyclave") });
  });
  // Prepare (Secrets of Strixhaven): one picture, the creature and the spell a prepared copy of it casts
  await real({ name: "Abigale, Poet Laureate" }, async (h, seat) => {
    same("layout prepare (Abigale, Poet Laureate) in a hand: its spell's name and text, no second picture", detail(sentCard(h, ID)),
      { f: kf("Abigale, Poet Laureate"), b: "", o2: null, n2: "Heroic Stanza", t2: textOf("Heroic Stanza") });
    same("layout prepare: its cast names no side", await sides(h, seat, [cast("a1", "Cast Abigale, Poet Laureate")]), [null]);
  });
  // (the prepared copy, a token named after the spell in its creature's controller's exile, notePrepared)
  const STANZA = { identity: { name: "Heroic Stanza", isToken: true, setCode: "SOS", cardNumber: "999" }, types: ["Sorcery"] };
  await real({ name: "Heroic Stanza", zone: "exile", extra: STANZA, pictures: { "Abigale, Poet Laureate": [{ face: DECK_PIC, back: null }] }, rounds: 3 }, async (h) => {
    same("layout prepare, the spell's copy in exile: its deck's picture of the creature's card, no other side", [sentCard(h, ID)?.f, sentCard(h, ID)?.n2 ?? null], [DECK_PIC, null]);
  });
  // (a prepare spell that is a classic card: Scryfall answers "Lightning Bolt" with Emeritus of Conflict // Lightning Bolt)
  const BOLT = SF.find((c) => c.name === "Lightning Bolt");
  await real({ name: "Emeritus of Conflict" }, async (h) => {
    same("layout prepare, a classic spell (Emeritus of Conflict // Lightning Bolt): Lightning Bolt its other side", [sentCard(h, ID)?.n2, sentCard(h, ID)?.t2], ["Lightning Bolt", textOf("Lightning Bolt")]);
  });
  await real({ name: "Lightning Bolt", rounds: 3 }, async (h) => {
    const named = h.effects.filter((e) => e.fetch && e.fetch.includes("/cards/named") && e.fetch.includes("Lightning")).length;
    same("Lightning Bolt itself (Scryfall's batch answer is Emeritus): its own picture by its exact name, asked once each, no other side",
      [sentCard(h, ID)?.f, sentCard(h, ID)?.n2 ?? null, sentCard(h, ID)?.t2 ?? null, asked(h, "Lightning Bolt"), named],
      [`kf${BOLT.id}`, null, null, 1, 1]);
  });
  await withBridge({ scryfallCards: SF }, async (h) => {
    const b = board({ name: "Lightning Bolt" });
    b.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0").cards.push({ ...clone(b.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0").cards.find((c) => c.id === ID)), id: "engine-card-76", identity: { name: "Emeritus of Conflict" } });
    game(h, b);
    for (let k = 0; k < 3; k++) { h.B.sendTable(); await h.flush(); }
    same("Lightning Bolt beside Emeritus of Conflict (both asked at once): still no other side, its own picture", [sentCard(h, ID)?.n2 ?? null, sentCard(h, ID)?.f], [null, `kf${BOLT.id}`]);
  });
  // (the exact-name lookup's answer caches nothing under the name asked: still asked once per bridge run, exactAsked)
  await withBridge({ scryfallCards: SF.filter((c) => c !== BOLT) }, async (h) => {
    game(h, board({ name: "Lightning Bolt" }));
    for (let k = 0; k < 3; k++) { h.B.sendTable(); await h.flush(); }
    const named = h.effects.filter((e) => e.fetch && e.fetch.includes("/cards/named") && e.fetch.includes("Lightning")).length;
    same("Lightning Bolt whose exact-name answer caches nothing under its name: the exact-name lookup asked once, not on every board", named, 1);
  });
  // Specialize (Alchemy, Alora, Rogue Companion): each specialized version a card of its own on Scryfall
  await real({ name: "Alora, Cheerful Thief", zone: "battlefield", pictures: { "Alora, Rogue Companion": [{ face: DECK_PIC, back: null }] }, rounds: 3 }, async (h) => {
    same("layout specialize, specialized (Alora, Cheerful Thief): Scryfall's picture of that version, no other side", detail(sentCard(h, ID)),
      { f: kf("Alora, Cheerful Thief"), b: "", o2: null, n2: null, t2: null });
  });

  // (OTHER_SIDE_BRIDGE_ONLY=1: the bridge's checks alone, seconds instead of the table's minute, for mutation runs)
  if (process.env.OTHER_SIDE_BRIDGE_ONLY) {
    console.log(failed ? `\n${failed} failed, ${passed} passed (bridge only)` : `PASSED: ${passed} passed, 0 failed (bridge only)`);
    process.exit(failed ? 1 : 0);
  }

  // ───────── the table ─────────
  const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
  const PLAIN = ""; // (the bridge's short form of the plain Magic back)
  const cards = {
    dfc1: { n: VALKI, n2: TIBALT, t2: textOf(TIBALT), f: VF, b: PLAIN, o2: VB, tl: "Legendary Creature — God", cmc: 3, ty: ["Creature"] },
    dfc2: { n: "Exdeath, Void Warlock", n2: "Neo Exdeath, Dimension's End", f: "https://img.example/exdeath.webp", b: "https://img.example/neo.webp", o2: "https://img.example/neo.webp", tl: "Legendary Creature — Spirit Warlock", cmc: 3, ty: ["Creature"] },
    dfc3: { n: "Emeria's Call", n2: "Emeria, Shattered Skyclave", f: "https://img.example/call.webp", b: "https://img.example/skyclave.webp", o2: "https://img.example/skyclave.webp", tl: "Sorcery", cmc: 7, ty: ["Sorcery"] },
    adv1: { n: "Bonecrusher Giant", n2: "Stomp", t2: textOf("Stomp"), f: "https://img.example/bonecrusher.webp", b: PLAIN, tx: textOf("Bonecrusher Giant"), tl: "Creature — Giant", cmc: 3, ty: ["Creature"] },
    p1: { n: "Grizzly Bears", f: "https://img.example/bears.webp", b: PLAIN, tl: "Creature — Bear", cmc: 2, ty: ["Creature"] },
  };
  const tbl = () => {
    const pl = (color, slot, s) => ({ color, slot, name: color, ai: color === "White", life: 40, status: "playing", pool: {}, cmdDamage: {}, tax: [0], library: 50,
      handCount: (s.hand || []).length, hand: color === "Blue" ? (s.hand || []).map((id) => ({ s: 1, id })) : null,
      battlefield: (s.bf || []).map((id) => ({ s: 1, id, ctl: color, p: 1, t: 1, bp: 1, bt: 1 })), graveyard: [], exile: [], command: (s.cmd || []).map((id) => ({ s: 1, id, ctl: color })) });
    return JSON.stringify({ t: "table", turn: 3, step: "main1", active: "Blue", activeTurnNo: 2, priority: "Blue", gameOver: false, winner: null,
      players: [pl("Blue", "player-0", { hand: ["dfc1", "p1", "adv1"], bf: ["dfc2"], cmd: ["dfc3"] }), pl("White", "player-1", {})], stack: [], cards });
  };
  const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "Blue", "player-1": "White" }, names: { "player-0": "Blue", "player-1": "AI 1" }, ai: ["White"] });
  const lua = (code, mark, frames) => ({ lua: code, mark, ...(frames != null ? { frames } : {}) });
  const objOf = (id) => `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end`;
  const PRELUDE = `engineAutoPace.Blue = false
engineChat("mtg start ai 1", Player.Blue)
__intents = {}
local send = engineSend
engineSend = function(t, p) if t == "intent" then __intents[#__intents + 1] = tostring(p.kind) .. " " .. tostring(p.id) .. " side=" .. tostring(p.side) end return send(t, p) end
return "ok"`;
  // a card's states as its object holds them: its own and each in States, face and back
  const statesOf = (id) => lua(`${objOf(id)} if o == nil then return "{}" end
    local function pics(d) for _, e in pairs(d.CustomDeck or {}) do return { face = e.FaceURL, back = e.BackURL } end return {} end
    local d = o.getData() local out = { state = o.getStateId(), name = o.getName(), desc = o.getDescription(), own = pics(d), others = {} }
    for k, s in pairs(d.States or {}) do local p = pics(s) out.others[tostring(k)] = { face = p.face, back = p.back, gm = s.GMNotes, name = s.Nickname, desc = s.Description, locked = s.Locked == true, tags = s.Tags and #s.Tags or 0 } end
    return JSON.encode(out)`, `states ${id}`, 1);
  const turn = (id, how) => lua(`${objOf(id)} if o == nil then return "no object" end local old = o.getGUID() local n = o.setState(2)
    ${how === "event" ? "onObjectStateChange(n, old)" : "onObjectSpawn(n) onObjectDestroy(o)"}
    return n.getGUID()`, `turn ${id} by ${how}`, 10);
  const debug = (id, mark) => lua(`${objOf(id)} return engineDebugCard("${id}") .. " state=" .. tostring(o and o.getStateId()) .. " guid=" .. tostring(o and o.getGUID())`, mark, 1);
  const dropOn = (id, mark) => lua(`${objOf(id)} if o == nil then return "no object" end __intents = {} o.setPosition(data.Blue.playmat.getPosition() + Vector(0, 1, 0)) onObjectDrop("Blue", o) __sim.frames(5) return table.concat(__intents, " | ")`, mark, 2);
  const menuOf = (id, mark) => lua(`${objOf(id)} if o == nil then return "no object" end local out = {} for _, m in ipairs(o.__d.menu) do out[#out + 1] = m.label end return table.concat(out, " | ")`, mark, 1);
  const ask = (opts) => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", promptId: 3001, kind: "priority", title: "Your priority", mode: "single", min: 1, max: 1, options: opts }) }, mark: "priority" });
  const OPTS = [{ id: "a-valki", cardId: "dfc1", label: `Cast ${VALKI}`, side: 1 }, { id: "a-tibalt", cardId: "dfc1", label: `Cast ${TIBALT}`, side: 2 },
    { id: "a-call", cardId: "dfc3", label: "Cast Emeria's Call", side: 1 }, { id: "a-land", cardId: "dfc3", label: "Play Emeria, Shattered Skyclave", side: 2 }, { id: "__pass", label: "Next" }];
  const steps = [lua(PRELUDE, "prelude"), { msg: { t: "started", json: STARTED } }, { msg: { t: "table", json: tbl() }, frames: 60, mark: "board" },
    statesOf("dfc1"), statesOf("dfc2"), statesOf("dfc3"), statesOf("p1"), statesOf("adv1"),
    ask(OPTS), menuOf("dfc1", "menu state 1"),
    dropOn("p1", "drop one-faced"),
    turn("dfc1", "event"), debug("dfc1", "after turning"),
    menuOf("dfc1", "menu state 2"),
    { msg: { t: "table", json: tbl() }, frames: 30, mark: "board again" }, debug("dfc1", "after the next board"),
    dropOn("dfc1", "drop state 2"),
    turn("dfc2", "spawn"), debug("dfc2", "after turning by spawn"), { msg: { t: "table", json: tbl() }, frames: 30, mark: "board again 2" }, debug("dfc2", "after the next board 2"),
    dropOn("dfc3", "drop command state 1"),
    lua(`engineFlipped["dfc3"] = true return "flipped"`, "flip dfc3"), dropOn("dfc3", "drop command flipped"),
  ];
  const r = simulate({ save, steps });
  const step = (mark) => r.steps.find((s) => s.step === mark) || {};
  const val = (mark) => step(mark).value;
  const json = (mark) => { try { return JSON.parse(val(mark) || "{}"); } catch { return {}; } };
  ok("table: the script ran", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  const ENGINE_BACK_RE = /^https:\/\/steamusercontent/;
  const h1 = json("states dfc1");
  ok("table: a double-faced hand card shows state 1, its front with the plain back", h1.state === 1 && h1.own?.face === VF && ENGINE_BACK_RE.test(h1.own?.back || ""), JSON.stringify(h1));
  const s2 = (h1.others || {})["2"] || {};
  ok("table: its state 2 is its other face, the plain back behind it too", s2.face === VB && s2.back === h1.own?.back, JSON.stringify(h1));
  ok("table: state 2 is the same engine card (GM notes, engine tag, locked as state 1 is)", s2.gm === "engine:dfc1" && s2.tags === 1, JSON.stringify(s2));
  ok("table: the name line names both faces, in both states", String(h1.name).split("\n")[0] === `${VALKI} // ${TIBALT}` && String(s2.name).split("\n")[0] === `${VALKI} // ${TIBALT}`, JSON.stringify([h1.name, s2.name]));
  const b1 = json("states dfc2");
  const nb = (b1.others || {})["2"] || {};
  ok("table: on the battlefield, state 1 is the engine's face (its back the other face, flipping as before), state 2 the other face over the engine's", b1.state === 1
    && b1.own?.face === cards.dfc2.f && b1.own?.back === cards.dfc2.o2 && nb.face === cards.dfc2.o2 && nb.back === cards.dfc2.f, JSON.stringify(b1));
  const c1 = json("states dfc3");
  ok("table: in the command zone too", c1.state === 1 && ((c1.others || {})["2"] || {}).face === cards.dfc3.o2, JSON.stringify(c1));
  const p1 = json("states p1");
  ok("table: a one-faced card has no states", p1.state === -1 && Object.keys(p1.others || {}).length === 0 && !String(p1.name).includes("//"), JSON.stringify(p1));
  const BACK_TEXT = `[b]${TIBALT}[/b]\n${textOf(TIBALT).replace(/"/g, "'")}`;
  ok("table: the other side's rules text is in the hover text of both states (Tibalt's on Valki, readable in a hand)", String(h1.desc).includes(BACK_TEXT) && String(s2.desc).includes(BACK_TEXT), JSON.stringify([h1.desc, s2.desc]));
  const a1 = json("states adv1");
  ok("table: an adventure card (one picture) has no states, names both parts and reads Stomp's text in its hover", a1.state === -1 && String(a1.name).split("\n")[0] === "Bonecrusher Giant // Stomp"
    && String(a1.desc).includes(`[b]Stomp[/b]\n${textOf("Stomp")}`) && String(a1.desc).startsWith(textOf("Bonecrusher Giant")), JSON.stringify(a1));
  same("table: the right-click list puts the side shown first (state 1: the front)", val("menu state 1"), `Cast ${VALKI} | Cast ${TIBALT}`);
  same("table: a drop of a one-faced card sends no side", val("drop one-faced"), "play p1 side=nil");
  const newGuid = val("turn dfc1 by event");
  ok("table: turned to state 2 (onObjectStateChange): the new object is the card's, one object", /obj=/.test(val("after turning") || "") && (val("after turning") || "").includes(`obj=${newGuid}@`)
    && (val("after turning") || "").includes("copies=1") && (val("after turning") || "").includes("state=2"), `${newGuid} ${val("after turning")}`);
  same("table: the right-click list follows the new object, the side shown first (state 2: the back)", val("menu state 2"), `Cast ${TIBALT} | Cast ${VALKI}`);
  ok("table: the next board keeps the card in state 2 (looking is not a change of the card)", (val("after the next board") || "").includes(`obj=${newGuid}@`) && (val("after the next board") || "").includes("state=2"), val("after the next board"));
  same("table: a drop of the hand card in state 2 casts the back", val("drop state 2"), "play dfc1 side=2");
  const g2 = val("turn dfc2 by spawn");
  ok("table: turned to state 2 seen only as a spawn and a destroy: kept too", (val("after the next board 2") || "").includes(`obj=${g2}@`) && (val("after the next board 2") || "").includes("state=2")
    && (val("after the next board 2") || "").includes("copies=1"), `${g2} ${val("after turning by spawn")} / ${val("after the next board 2")}`);
  same("table: a drop of the command-zone card in state 1 casts the front", val("drop command state 1"), "play dfc3 side=1");
  same("table: flipped over in the command zone (its back is its other face) casts the other side", val("drop command flipped"), "play dfc3 side=2");

  console.log(failed ? `\n${failed} failed, ${passed} passed` : `PASSED: ${passed} passed, 0 failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { harness.restore(); console.log(`FAIL crashed: ${e.stack}`); process.exit(1); });
