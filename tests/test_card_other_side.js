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
function game(h, b) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: b, fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
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

  // ───────── the table ─────────
  const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
  const PLAIN = ""; // (the bridge's short form of the plain Magic back)
  const cards = {
    dfc1: { n: VALKI, n2: TIBALT, f: VF, b: PLAIN, o2: VB, tl: "Legendary Creature — God", cmc: 3, ty: ["Creature"] },
    dfc2: { n: "Exdeath, Void Warlock", n2: "Neo Exdeath, Dimension's End", f: "https://img.example/exdeath.webp", b: "https://img.example/neo.webp", o2: "https://img.example/neo.webp", tl: "Legendary Creature — Spirit Warlock", cmc: 3, ty: ["Creature"] },
    dfc3: { n: "Emeria's Call", n2: "Emeria, Shattered Skyclave", f: "https://img.example/call.webp", b: "https://img.example/skyclave.webp", o2: "https://img.example/skyclave.webp", tl: "Sorcery", cmc: 7, ty: ["Sorcery"] },
    p1: { n: "Grizzly Bears", f: "https://img.example/bears.webp", b: PLAIN, tl: "Creature — Bear", cmc: 2, ty: ["Creature"] },
  };
  const tbl = () => {
    const pl = (color, slot, s) => ({ color, slot, name: color, ai: color === "White", life: 40, status: "playing", pool: {}, cmdDamage: {}, tax: [0], library: 50,
      handCount: (s.hand || []).length, hand: color === "Blue" ? (s.hand || []).map((id) => ({ s: 1, id })) : null,
      battlefield: (s.bf || []).map((id) => ({ s: 1, id, ctl: color, p: 1, t: 1, bp: 1, bt: 1 })), graveyard: [], exile: [], command: (s.cmd || []).map((id) => ({ s: 1, id, ctl: color })) });
    return JSON.stringify({ t: "table", turn: 3, step: "main1", active: "Blue", activeTurnNo: 2, priority: "Blue", gameOver: false, winner: null,
      players: [pl("Blue", "player-0", { hand: ["dfc1", "p1"], bf: ["dfc2"], cmd: ["dfc3"] }), pl("White", "player-1", {})], stack: [], cards });
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
    local d = o.getData() local out = { state = o.getStateId(), name = o.getName(), own = pics(d), others = {} }
    for k, s in pairs(d.States or {}) do local p = pics(s) out.others[tostring(k)] = { face = p.face, back = p.back, gm = s.GMNotes, name = s.Nickname, locked = s.Locked == true, tags = s.Tags and #s.Tags or 0 } end
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
    statesOf("dfc1"), statesOf("dfc2"), statesOf("dfc3"), statesOf("p1"),
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
