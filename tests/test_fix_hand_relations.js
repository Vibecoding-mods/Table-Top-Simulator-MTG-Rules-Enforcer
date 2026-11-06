// Metamorphic relations for "Fix from hand" (docs/m7-manual-fix-spec.md §12, tmp/fix-from-hand-table.md,
// tmp/fix-from-hand-protocol.md), bridge side, through tests/bridge-harness.js. Each relation runs two (or more) fixes
// that differ in one way and checks how their results must relate, with no recorded answer (jr-programmer-suite §2c).
// Every relation first checks that its base fix is accepted, so none can pass by having nothing to compare.
// A surprise (a crash, a fix that never reached editing) is a named failure, never the end of the run.
//   node tests/test_fix_hand_relations.js        (BRIDGE_PATH=<copy> to run against a copy of the bridge)
const fs = require("fs");
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const J = (x) => JSON.stringify(x);
const same = (name, got, want) => ok(name, J(got) === J(want), `got ${J(got)}, want ${J(want)}`);
const clone = (x) => JSON.parse(J(x));

// ───────── the board: the golden's dump2 (Blue = player-0, AI White = player-1) plus a second person, Red (player-2) ─────────
const D2 = require("./golden/fixtures/dump2.json");
const BASE_IDS = {};
for (const z of D2.board.gameView.zones) for (const c of z.cards) BASE_IDS[c.id] = c;
// Red's cards and one for the AI's hand, copied from dump2 cards under new ids and names
const EXTRA = [
  { from: "engine-card-97", id: "engine-card-301", name: "Red Debate", zone: "hand", owner: "player-2" },
  { from: "engine-card-64", id: "engine-card-302", name: "Red Mountain", zone: "hand", owner: "player-2" },
  { from: "engine-card-134", id: "engine-card-311", name: "Red Flamekin", zone: "battlefield", owner: "player-2" },
  // owned by Red, controlled by Blue: activated by its controller, cast by nobody
  { from: "engine-card-134", id: "engine-card-312", name: "Borrowed Flamekin", zone: "battlefield", owner: "player-2", ctl: "player-0" },
  { from: "engine-card-70", id: "engine-card-321", name: "Red Blow", zone: "graveyard", owner: "player-2" },
  { from: "engine-card-43", id: "engine-card-331", name: "White Fall", zone: "hand", owner: "player-1" },
];
function board(edit) {
  const b = clone(D2.board);
  const gv = b.gameView;
  Object.assign(gv, { activePlayerId: "player-0", step: "main1", priorityPlayerId: "player-0", stack: [] });
  gv.players.push({ ...clone(gv.players[1]), id: "player-2" });
  const zoneOf = (zone, owner) => {
    let z = gv.zones.find((q) => q.zone === zone && q.ownerId === owner);
    if (!z) { z = { zone, ownerId: owner, cards: [] }; gv.zones.push(z); }
    return z;
  };
  for (const e of EXTRA) {
    const src = BASE_IDS[e.from];
    zoneOf(e.zone, e.owner).cards.push({ ...clone(src), id: e.id, identity: { ...clone(src.identity), name: e.name }, ownerId: e.owner, controllerId: e.ctl || e.owner });
  }
  if (edit) edit(gv, zoneOf);
  return b;
}
// a card moved to another zone (and owner/controller) on a board: the input transform of the zone relations
const moveCard = (id, zone, owner, ctl) => (gv, zoneOf) => {
  let card = null;
  for (const z of gv.zones) { const i = z.cards.findIndex((c) => c.id === id); if (i >= 0) [card] = z.cards.splice(i, 1); }
  if (!card) throw new Error(`moveCard: no ${id}`);
  zoneOf(zone, owner).cards.push({ ...card, ownerId: owner, controllerId: ctl || owner });
};
const ALL_CARDS = (() => { const gv = board().gameView; return gv.zones.flatMap((z) => z.cards.map((c) => c.id)); })();
const zoneOfIn = (b, id) => b.gameView.zones.find((z) => z.cards.some((c) => c.id === id));
const COLOR_OF = { "player-0": "Blue", "player-1": "White", "player-2": "Red" };
const nameIn = (id) => { for (const z of board().gameView.zones) for (const c of z.cards) if (c.id === id) return c.identity.name; return null; };

const prompt = (type, input = {}, id = 900, who = "player-0") => ({ promptId: id, decidingPlayerId: who, input: { type, ...input } });
const PASS = { actions: [{ id: "pass", type: "pass" }] };

// Blue and Red at the table vs AI White (red: false: Blue alone vs AI, where every vote passes at once)
function setup(h, { red = true, b = board() } = {}) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: clone(b), fingerprint: null };
  const seats = new Map([["Blue", seat]]);
  const slotColor = { "player-0": "Blue", "player-1": "White" };
  if (red) {
    const r = new h.B.Seat("Red", "neheb_minotaur_commander");
    r.slot = "player-2";
    r.board = { state: clone(b), fingerprint: null };
    seats.set("Red", r);
    slotColor["player-2"] = "Red";
  }
  h.B._setGame({ seats, bots: 1, total: red ? 3 : 2, playerOrder: [], slotNames: { "player-0": "Blue", "player-1": "AI 1", "player-2": "Red" }, slotColor,
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  return seat;
}
let crashes = 0;
// (an awaited step that never comes leaves Node with nothing to do: it would exit silently, so that is a failure too)
let finished = false;
process.on("beforeExit", () => { if (!finished) { process.stdout.write("FAIL the run ended early: an awaited step never came\n"); process.exit(1); } });
async function fixMsg(h, color, m) {
  try { h.B.onTTS({ t: "fix", json: J({ color, ...m }) }); } catch (e) { crashes++; ok(`fix ${m.action} from ${color} doesn't crash`, false, e.message); }
  await h.flush();
}
const applies = (h, from = 0) => h.effects.slice(from).filter((e) => e.relay?.state?.directive?.type === "applyState").map((e) => e.relay.state.directive);
const chats = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const logs = (h, from = 0) => h.effects.slice(from).filter((e) => e.log != null || e.appendFile).map((e) => (e.log != null ? e.log : `${e.appendFile}: ${e.text}`));
const lastFixShown = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "table").map((e) => e.tts.fix).at(-1);

// Call a fix, get it to editing (Red votes yes), optionally pick a kind, press Done with `ops`, then everyone else
// votes (yes, or no when `decline`). Returns what reached the engine and what was said; { surprise } when the fix never
// got to editing (a named failure for the caller, not a crash).
async function runFix(h, { red = true, b, by = "Blue", ops, kind, notes, pick, decline = false, vote = true } = {}) {
  h.effects.length = 0;
  const seat = setup(h, { red, b });
  try { h.B.onPrompt(seat, prompt("chooseAction", PASS)); } catch (e) { return { surprise: `onPrompt crashed: ${e.message}` }; }
  await h.flush();
  await fixMsg(h, "Blue", { action: "call" });
  if (red) await fixMsg(h, "Red", { action: "vote", accept: true });
  const g = h.B._getGame();
  if (g.fix?.state !== "editing") return { surprise: `not editing after the pause vote: ${g.fix?.state}` };
  for (const p of [].concat(pick || [])) await fixMsg(h, p.color, { action: "kind", kind: p.kind });
  const mark = h.effects.length;
  const t0 = Date.now();
  await fixMsg(h, by, { action: "done", ops, ...(kind !== undefined ? { kind } : {}), ...(notes !== undefined ? { notes } : {}) });
  const f = g.fix;
  const out = { seat, g, t0, fixId: f?.id, lines: f?.lines ? [...f.lines] : null, stateAfterDone: f?.state };
  if (vote && f?.state === "review") for (const c of [...f.waiting]) await fixMsg(h, c, { action: "vote", accept: !decline });
  const a = applies(h, mark);
  out.count = a.length;
  out.sent = a.length ? a[0].ops : null;
  out.applyId = a.length ? a[0].fixId : null;
  out.accepted = f?.state === "review" || a.length > 0;
  out.state = g.fix?.state ?? null;
  out.chats = chats(h, mark);
  out.logs = logs(h, mark);
  out.refusal = !out.accepted ? out.chats.find((c) => c.startsWith("[MTG] ")) || null : null;
  return out;
}
const run = async (fn) => { const h = harness.load(); try { await fn(h); } catch (e) { crashes++; ok("relation group doesn't crash", false, e.stack?.split("\n").slice(0, 2).join(" | ")); } finally { harness.restore(); } };
const verdict = async (h, ops, o = {}) => { const r = await runFix(h, { ops, vote: false, ...o }); return r.surprise ? `surprise: ${r.surprise}` : r.accepted; };
const FREE = ["freeCast", "freeLand", "freeActivate"];
const COLOURS = ["Blue", "Red", "White", "Purple"];
const isFree = (o) => FREE.includes(o.op);

// lists used as bases: Blue's hand plays, Red's, a graveyard move, plain ops
const B_CAST = { op: "freeCast", card: "engine-card-43", player: "Blue" };
const B_LAND = { op: "freeLand", card: "engine-card-94", player: "Blue" };
const B_ACT_FIELD = { op: "freeActivate", card: "engine-card-22", player: "Blue" };
const B_ACT_BORROW = { op: "freeActivate", card: "engine-card-312", player: "Blue" };
const R_CAST = { op: "freeCast", card: "engine-card-301", player: "Red" };
const R_LAND = { op: "freeLand", card: "engine-card-302", player: "Red" };
const B_TO_GY = { op: "move", card: "engine-card-75", zone: "graveyard" };
const LIFE = { op: "life", player: "White", n: 12 };
const TAP = { op: "tap", card: "engine-card-64", tapped: true };
const MIXED = [B_TO_GY, B_CAST, LIFE, R_CAST, B_ACT_FIELD, TAP, R_LAND];

(async () => {
  // R1 freeCast and freeLand: the bridge checks only where the card is (whether it is a land is the engine's check),
  // so for every card and every colour the two verdicts agree
  await run(async (h) => {
    let acc = 0, ref = 0;
    for (const card of ALL_CARDS) for (const player of COLOURS) {
      const c = await verdict(h, [{ op: "freeCast", card, player }]);
      const l = await verdict(h, [{ op: "freeLand", card, player }]);
      if (c === true) acc++; else if (c === false) ref++;
      ok(`R1 freeCast and freeLand agree: ${card} for ${player}`, c === l, `freeCast ${c}, freeLand ${l}`);
    }
    ok("R1 precondition: some free casts accepted and some refused", acc > 0 && ref > 0, `${acc} accepted, ${ref} refused`);
  });

  // R2 Subset: freeActivate also takes a permanent its player controls, so whatever can be cast free can be activated
  // free, and anything playable for free can be moved to the graveyard; at least one card goes the other way
  await run(async (h) => {
    let wider = 0, base = 0;
    for (const card of ALL_CARDS) for (const player of COLOURS) {
      const c = await verdict(h, [{ op: "freeCast", card, player }]);
      const a = await verdict(h, [{ op: "freeActivate", card, player }]);
      const m = await verdict(h, [{ op: "move", card, zone: "graveyard" }]);
      if (c === true) base++;
      if (a === true && c !== true) wider++;
      ok(`R2 cast free => activate free: ${card} for ${player}`, c !== true || a === true, `freeCast ${c}, freeActivate ${a}`);
      ok(`R2 activate free => to graveyard: ${card} for ${player}`, a !== true || m === true, `freeActivate ${a}, move ${m}`);
    }
    ok("R2 precondition: some casts accepted, and activate takes some card cast refuses", base > 0 && wider > 0, `${base} casts, ${wider} activate-only`);
  });

  // R3 colours: a card is playable for free by at most one colour, a seated one: its owner while in hand, its
  // controller on the battlefield (White, the AI, and Purple, nobody, never)
  await run(async (h) => {
    let some = 0;
    for (const card of ALL_CARDS) for (const op of FREE) {
      const yes = [];
      for (const player of COLOURS) if ((await verdict(h, [{ op, card, player }])) === true) yes.push(player);
      if (yes.length) some++;
      const b = board();
      const c = b.gameView.zones.flatMap((z) => z.cards).find((x) => x.id === card);
      const zone = zoneOfIn(b, card).zone;
      const who = COLOR_OF[zone === "battlefield" ? c.controllerId ?? c.ownerId : c.ownerId];
      ok(`R3 ${op} ${card}: at most one colour, the ${zone === "battlefield" ? "controller" : "owner"}`, yes.length <= 1 && (!yes.length || yes[0] === who), `accepted for ${J(yes)}, the card's ${zone} player is ${who}`);
      ok(`R3 ${op} ${card}: never for an unseated colour`, !yes.includes("White") && !yes.includes("Purple"), J(yes));
    }
    ok("R3 precondition: some card is playable for free", some > 0, String(some));
  });

  // R4 zone relations: move a card the base accepts to another zone on the board, and the verdict changes as the zone
  // says: battlefield keeps activate only, graveyard or library refuses all three; a new owner moves the verdict with it
  await run(async (h) => {
    for (const [card, player, owner] of [["engine-card-43", "Blue", "player-0"], ["engine-card-301", "Red", "player-2"]]) {
      const pre = [];
      for (const op of FREE) pre.push(await verdict(h, [{ op, card, player }]));
      ok(`R4 precondition: ${card} in ${player}'s hand, all three accepted`, pre.every((v) => v === true), J(pre));
      const other = player === "Blue" ? "Red" : "Blue", otherSlot = owner === "player-0" ? "player-2" : "player-0";
      const cases = [
        ["on their battlefield", moveCard(card, "battlefield", owner), { freeCast: false, freeLand: false, freeActivate: true }, player],
        ["in their graveyard", moveCard(card, "graveyard", owner), { freeCast: false, freeLand: false, freeActivate: false }, player],
        ["in their library", moveCard(card, "library", owner), { freeCast: false, freeLand: false, freeActivate: false }, player],
        [`in ${other}'s hand, for ${player}`, moveCard(card, "hand", otherSlot), { freeCast: false, freeLand: false, freeActivate: false }, player],
        [`in ${other}'s hand, for ${other}`, moveCard(card, "hand", otherSlot), { freeCast: true, freeLand: true, freeActivate: true }, other],
        [`on the battlefield under ${other}'s control, for ${other}`, moveCard(card, "battlefield", owner, otherSlot), { freeCast: false, freeLand: false, freeActivate: true }, other],
      ];
      for (const [what, edit, want, who] of cases) {
        const got = {};
        for (const op of FREE) got[op] = await verdict(h, [{ op, card, player: who }], { b: board(edit) });
        same(`R4 ${card} moved ${what}`, got, want);
      }
    }
  });

  // R5 a note never changes what reaches the engine: the same ops for no note, one, several, and odd ones; a note from
  // nobody at the table, or an empty one, is no note at all; a note is trimmed and cut at 200 characters; each kept note
  // is one line more, and is logged with the fix id
  await run(async (h) => {
    const long = "x".repeat(150) + "y".repeat(150);
    for (const base of [[B_CAST], [R_LAND, B_TO_GY], MIXED]) {
      const plain = await runFix(h, { ops: base });
      ok(`R5 precondition: base ${base.length}-op list applied`, plain.count === 1, plain.surprise || plain.refusal);
      if (plain.count !== 1) continue;
      const variants = {
        one: [{ color: "Blue", text: "Teferi's Protection should have resolved first" }],
        two: [{ color: "Blue", text: "a" }, { color: "Red", text: "b" }],
        // (looks like an op: still only a line)
        opLike: [{ color: "Red", text: J({ op: "life", player: "Red", n: 1 }) }],
        long: [{ color: "Red", text: long }],
        nobody: [{ color: "Purple", text: "not at the table" }],
        ai: [{ color: "White", text: "the AI's seat" }],
        empty: [{ color: "Blue", text: "   " }],
        notText: [{ color: "Blue", text: 42 }, { color: "Blue" }, null],
      };
      const lineCount = {};
      for (const [k, notes] of Object.entries(variants)) {
        const r = await runFix(h, { ops: base, notes });
        same(`R5 note "${k}" leaves the ops sent alone (${base.length} ops)`, r.sent, plain.sent);
        lineCount[k] = (r.lines || []).length - (plain.lines || []).length;
        if (k === "one") ok(`R5 note "${k}" is logged with the fix id (${base.length} ops)`, r.logs.some((l) => l.includes(`fix #${r.fixId}`) && l.includes(notes[0].text)), J(r.logs.filter((l) => l.includes("note"))));
      }
      same(`R5 lines added per note (${base.length} ops)`, lineCount, { one: 1, two: 2, opLike: 1, long: 1, nobody: 0, ai: 0, empty: 0, notText: 0 });
      // trimming and the 200-character cut are relations between two notes
      const padded = await runFix(h, { ops: base, notes: [{ color: "Blue", text: "  phase out  " }] });
      const bare = await runFix(h, { ops: base, notes: [{ color: "Blue", text: "phase out" }] });
      same(`R5 a padded note says what the bare one says (${base.length} ops)`, padded.lines, bare.lines);
      const cut = await runFix(h, { ops: base, notes: [{ color: "Red", text: long.slice(0, 200) }] });
      const full = await runFix(h, { ops: base, notes: [{ color: "Red", text: long }] });
      same(`R5 a 300-character note says what its first 200 do (${base.length} ops)`, full.lines, cut.lines);
      const none = await runFix(h, { ops: base, notes: [{ color: "Purple", text: "x" }] });
      same(`R5 a note from nobody at the table: the same lines as none (${base.length} ops)`, none.lines, plain.lines);
    }
  });

  // R6 order: the bridge passes the list on in the players' order, so permuting the list permutes what is sent the same
  // way (plain ops and free plays alike; the engine puts the plain ops first itself, protocol step 1)
  await run(async (h) => {
    const base = await runFix(h, { ops: MIXED });
    ok("R6 precondition: the mixed list is applied", base.count === 1 && base.sent?.length === MIXED.length, base.surprise || base.refusal || J(base.sent));
    if (base.count === 1) {
      const perms = [];
      for (let k = 1; k < MIXED.length; k++) perms.push(MIXED.map((_, i) => (i + k) % MIXED.length)); // rotations
      perms.push([...MIXED.keys()].reverse());
      perms.push([1, 0, 2, 3, 4, 5, 6], [0, 1, 2, 4, 3, 5, 6], [6, 5, 4, 3, 2, 1, 0].map((i) => (i + 3) % 7));
      for (const p of perms) {
        const r = await runFix(h, { ops: p.map((i) => MIXED[i]) });
        same(`R6 order kept for permutation ${p.join("")}`, r.sent, p.map((i) => base.sent[i]));
      }
    }
  });

  // R7 adding plain ops before or after the free plays never changes the free plays sent or their order, and adding
  // free plays never changes the plain ops sent or their order
  await run(async (h) => {
    const free = [R_CAST, B_LAND, B_ACT_BORROW, B_CAST];
    const plain = [B_TO_GY, LIFE, TAP];
    const f = await runFix(h, { ops: free });
    const p = await runFix(h, { ops: plain });
    ok("R7 precondition: free-only and plain-only lists applied", f.count === 1 && p.count === 1, J([f.refusal, p.refusal]));
    if (f.count === 1 && p.count === 1) {
      for (const [what, list] of [["plain after", [...free, ...plain]], ["plain before", [...plain, ...free]], ["interleaved", [free[0], plain[0], free[1], plain[1], free[2], plain[2], free[3]]]]) {
        const r = await runFix(h, { ops: list });
        same(`R7 ${what}: the free plays as in the free-only list`, (r.sent || []).filter(isFree), f.sent);
        same(`R7 ${what}: the plain ops as in the plain-only list`, (r.sent || []).filter((o) => !isFree(o)), p.sent);
      }
    }
  });

  // R8 kind: hand, board, absent or picked on the table never changes the ops sent; it changes the words of exactly the
  // hand-to-graveyard moves; once a kind is picked, Done's own kind changes nothing; the table is shown the kind picked
  await run(async (h) => {
    const list = [B_TO_GY, { op: "move", card: "engine-card-22", zone: "graveyard" }, B_CAST, LIFE];
    const runs = {
      absent: await runFix(h, { ops: list }),
      board: await runFix(h, { ops: list, kind: "board" }),
      hand: await runFix(h, { ops: list, kind: "hand" }),
      junk: await runFix(h, { ops: list, kind: "sideways" }),
      pickedHand: await runFix(h, { ops: list, pick: { color: "Red", kind: "hand" } }),
      pickedHandDoneBoard: await runFix(h, { ops: list, kind: "board", pick: { color: "Red", kind: "hand" } }),
      pickedBoard: await runFix(h, { ops: list, pick: { color: "Blue", kind: "board" } }),
      pickedBoardDoneHand: await runFix(h, { ops: list, kind: "hand", pick: { color: "Blue", kind: "board" } }),
      pickedTwice: await runFix(h, { ops: list, pick: [{ color: "Blue", kind: "hand" }, { color: "Red", kind: "board" }, { color: "Red", kind: "hand" }] }),
    };
    ok("R8 precondition: the base list applied", runs.absent.count === 1, runs.absent.surprise || runs.absent.refusal);
    for (const [k, r] of Object.entries(runs)) same(`R8 kind ${k}: the same ops sent`, r.sent, runs.absent.sent);
    same("R8 absent and junk kinds: worded as board", [runs.absent.lines, runs.junk.lines], [runs.board.lines, runs.board.lines]);
    same("R8 picked hand: Done's kind changes nothing", runs.pickedHandDoneBoard.lines, runs.pickedHand.lines);
    same("R8 picked board: Done's kind changes nothing", runs.pickedBoardDoneHand.lines, runs.pickedBoard.lines);
    same("R8 the first pick counts", runs.pickedTwice.lines, runs.pickedHand.lines);
    same("R8 picked hand words as Done's hand", runs.pickedHand.lines, runs.hand.lines);
    const diff = (runs.hand.lines || []).map((l, i) => (l === runs.board.lines?.[i] ? null : i)).filter((i) => i != null);
    // (line 0 is the hand card to the graveyard; line 1 a land on the battlefield to the graveyard keeps its words)
    same("R8 hand vs board: only the hand-to-graveyard move is worded differently", [diff, runs.hand.lines?.length], [[0], runs.board.lines?.length]);
    // the table is told the kind once picked, and nothing before
    h.effects.length = 0;
    setup(h);
    h.B.onPrompt(h.B._getGame().seats.get("Blue"), prompt("chooseAction", PASS)); await h.flush();
    await fixMsg(h, "Blue", { action: "call" }); await fixMsg(h, "Red", { action: "vote", accept: true });
    const before = lastFixShown(h);
    const m = h.effects.length;
    await fixMsg(h, "Red", { action: "kind", kind: "hand" });
    const after = lastFixShown(h, m);
    const m2 = h.effects.length;
    await fixMsg(h, "Red", { action: "kind", kind: "hand" });
    same("R8 the table: no kind before a pick, the kind after", [before?.state, before?.kind ?? null, after?.kind ?? null], ["editing", null, "hand"]);
    same("R8 the same pick again says nothing more", chats(h, m2), []);
  });

  // R9 all or nothing: one bad op anywhere in an accepted list refuses the whole list, sends nothing, leaves the fix in
  // editing; then the good list alone is sent as if the bad one had never come
  await run(async (h) => {
    const good = [B_TO_GY, B_CAST, R_LAND];
    const base = await runFix(h, { ops: good });
    ok("R9 precondition: the good list applied", base.count === 1, base.surprise || base.refusal);
    const bads = {
      "freeCast of a battlefield card": { op: "freeCast", card: "engine-card-22", player: "Blue" },
      "freeLand of Red's card for Blue": { op: "freeLand", card: "engine-card-302", player: "Blue" },
      "freeCast for the AI": { op: "freeCast", card: "engine-card-331", player: "White" },
      "freeActivate of Red's own card on Blue's side": { op: "freeActivate", card: "engine-card-312", player: "Red" },
      "no such card": { op: "freeCast", card: "engine-card-9999", player: "Blue" },
      "card absent": { op: "freeCast", player: "Blue" },
      "player absent": { op: "freeLand", card: "engine-card-94" },
      "ability out of range": { op: "freeActivate", card: "engine-card-22", player: "Blue", ability: -1 },
      "unknown op": { op: "freeDraw", card: "engine-card-43", player: "Blue" },
    };
    for (const [what, bad] of Object.entries(bads)) {
      for (let at = 0; at <= good.length; at++) {
        h.effects.length = 0;
        const seat = setup(h);
        h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
        await fixMsg(h, "Blue", { action: "call" }); await fixMsg(h, "Red", { action: "vote", accept: true });
        const g = h.B._getGame();
        const list = [...good.slice(0, at), bad, ...good.slice(at)];
        await fixMsg(h, "Blue", { action: "done", ops: list });
        same(`R9 ${what} at ${at}: refused, nothing kept or sent`, [g.fix?.state, g.fix?.ops ?? null, applies(h).length], ["editing", null, 0]);
        if (at === 1) {
          await fixMsg(h, "Blue", { action: "done", ops: good });
          for (const c of [...(g.fix?.waiting || [])]) await fixMsg(h, c, { action: "vote", accept: true });
          same(`R9 ${what}: the good list after it is sent as alone`, applies(h).map((a) => a.ops), [base.sent]);
        }
      }
    }
    // the absence question (§2c): a malformed card or player is refused, so the field being absent is refused too
    for (const op of FREE) {
      const malCard = await verdict(h, [{ op, card: "engine-card-9999", player: "Blue" }]);
      const noCard = await verdict(h, [{ op, player: "Blue" }]);
      const malPlayer = await verdict(h, [{ op, card: "engine-card-43", player: "Purple" }]);
      const noPlayer = await verdict(h, [{ op, card: "engine-card-43" }]);
      same(`R9 absence ${op}: refused like the malformed field`, [malCard, noCard, malPlayer, noPlayer], [false, false, false, false]);
    }
  });

  // R10 a vote that fails sends nothing, whatever the list carries; the next list voted through is sent exactly, with
  // nothing of the declined one in it; a declined pause sends nothing ever
  await run(async (h) => {
    for (const [what, list] of [["free plays", [B_CAST, R_LAND]], ["plain", [LIFE, TAP]], ["mixed", MIXED], ["to graveyard", [B_TO_GY]]]) {
      const yes = await runFix(h, { ops: list });
      const no = await runFix(h, { ops: list, decline: true });
      ok(`R10 precondition (${what}): accepted for the vote`, yes.count === 1 && no.stateAfterDone === "review", J([yes.refusal, no.stateAfterDone]));
      same(`R10 ${what}: declined, nothing sent, back to editing`, [no.count, no.state], [0, "editing"]);
    }
    // a declined list then a new one, in one fix: only the new one is sent, exactly as it is sent alone
    for (const list of [[B_CAST, R_LAND], MIXED]) {
      const solo = await runFix(h, { ops: [R_CAST], by: "Red" });
      h.effects.length = 0;
      const seat = setup(h);
      h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
      await fixMsg(h, "Blue", { action: "call" }); await fixMsg(h, "Red", { action: "vote", accept: true });
      const g = h.B._getGame();
      await fixMsg(h, "Blue", { action: "done", ops: list });
      await fixMsg(h, "Red", { action: "vote", accept: false });
      same(`R10 declined ${list.length}-op list: nothing sent`, applies(h).length, 0);
      await fixMsg(h, "Red", { action: "done", ops: [R_CAST] });
      for (const c of [...(g.fix?.waiting || [])]) await fixMsg(h, c, { action: "vote", accept: true });
      same(`R10 declined ${list.length}-op list, then Red's list: only Red's list sent`, applies(h).map((a) => a.ops), [solo.sent]);
    }
    // the pause itself declined: nothing at all reaches the engine, whatever Done then says
    h.effects.length = 0;
    const seat = setup(h);
    h.B.onPrompt(seat, prompt("chooseAction", PASS)); await h.flush();
    await fixMsg(h, "Blue", { action: "call" }); await fixMsg(h, "Red", { action: "vote", accept: false });
    await fixMsg(h, "Blue", { action: "done", ops: MIXED });
    same("R10 the pause declined: no fix, nothing sent", [h.B._getGame().fix, applies(h).length], [null, 0]);
  });

  // R11 dropped plays: index i names the card and player of the i-th op SENT (plain ops count); the line is the same with
  // or without the engine's own `card`; an empty `dropped` says what an absent one says
  await run(async (h) => {
    const list = [B_TO_GY, B_CAST, LIFE, R_CAST, B_ACT_BORROW, R_LAND];
    const answer = async (stateFix) => {
      const r = await runFix(h, { ops: list });
      if (r.count !== 1) return { surprise: r.surprise || r.refusal || "not applied" };
      const b = board(); b.gameView.stateFix = { fixId: r.applyId, applied: true, ...stateFix };
      const m = h.effects.length;
      r.seat.board.state = b; r.g.lastTableSig = null;
      try { h.B.sendTable(); } catch (e) { return { surprise: `sendTable crashed: ${e.message}` }; }
      await h.flush();
      return { sent: r.sent, said: chats(h, m), fix: r.g.fix };
    };
    const plain = await answer({});
    ok("R11 precondition: an applied answer ends the fix", !plain.surprise && plain.fix === null, plain.surprise || J(plain.fix));
    const empty = await answer({ dropped: [] });
    same("R11 dropped: [] says what no dropped says", empty.said, plain.said);
    const reason = "not played: a choice was cancelled";
    for (const i of list.map((o, k) => (isFree(o) ? k : -1)).filter((k) => k >= 0)) {
      const withCard = await answer({ dropped: [{ index: i, card: list[i].card, reason }] });
      const noCard = await answer({ dropped: [{ index: i, reason }] });
      const extra = (withCard.said || []).filter((c) => !(plain.said || []).includes(c));
      ok(`R11 index ${i}: one more line than no drop, naming ${nameIn(list[i].card)} (${list[i].player})`,
        extra.length === 1 && extra[0].includes(nameIn(list[i].card)) && extra[0].includes(`(${list[i].player})`), J(extra));
      ok(`R11 index ${i}: names no other op's card`, !list.some((o, k) => k !== i && o.card && o.card !== list[i].card && extra.join(" ").includes(nameIn(o.card))), J(extra));
      same(`R11 index ${i}: the same line without the engine's card`, noCard.said, withCard.said);
    }
    // two drops: both lines, in the engine's order
    const one = await answer({ dropped: [{ index: 3, reason }] });
    const other = await answer({ dropped: [{ index: 5, reason }] });
    const both = await answer({ dropped: [{ index: 3, reason }, { index: 5, reason }] });
    const only = (s) => (s || []).filter((c) => !(plain.said || []).includes(c));
    same("R11 two drops: the two single lines, in order", only(both.said), [...only(one.said), ...only(other.said)]);
  });

  // R12 the watchdog: whether it fires depends only on the idle time since the last activity (the apply, a question,
  // an answer), never on when that was; while any question is open it never fires
  await run(async (h) => {
    // (the constant from the bridge being tested, as the harness picks it: not a literal of this file)
    const path = require("path");
    const src = fs.readFileSync(path.resolve(process.env.BRIDGE_PATH || path.join(__dirname, "..", "bridge", "bridge.js")), "utf8");
    const K = Number(src.match(/const FIX_ANSWER_MS = (\d+)/)?.[1]);
    ok("R12 precondition: FIX_ANSWER_MS read from the bridge", K > 1000, String(K));
    // runs a solo hand fix, then the events at their times (ms after the apply); returns the fix state seen at `checkAt`
    const at = (t, fn) => new Promise((resolve) => { const ms = t - Date.now(); global.setTimeout(() => { try { resolve(fn()); } catch (e) { resolve(`crash: ${e.message}`); } }, ms); });
    const scenario = async ({ askAt = null, answerAt = null, checkAfter, red = false, asker = "Blue" }) => {
      const r = await runFix(h, { red, ops: [B_CAST], kind: "hand" });
      if (r.count !== 1) return `surprise: ${r.surprise || r.refusal}`;
      const g = r.g, t0 = r.t0;
      const seat = g.seats.get(asker);
      let ref = t0, problem = null;
      if (askAt != null) {
        const p = at(t0 + askAt, () => h.B.onPrompt(seat, prompt("chooseNumber", { min: 0, max: 5, presentation: { title: "Choose X" } }, 950, seat.slot)));
        await h.flush(); await p;
        if (!seat.prompt) problem = "the question never opened";
        ref = t0 + askAt;
      }
      if (answerAt != null) {
        const p = at(t0 + answerAt, () => h.B.onTTS({ t: "answer", json: J({ color: asker, promptId: 950, choice: [String(seat.prompt?.ui?.min ?? 0)] }) }));
        await h.flush(); await p;
        if (seat.prompt) problem = "the question is still open after its answer";
        ref = t0 + answerAt;
      }
      const target = ref + checkAfter;
      const p = at(target, () => { const late = Date.now() - target; h.B.fixWatchdog(); return late ? `late by ${late} ms` : g.fix?.state; });
      await h.flush();
      const s = await p;
      return problem ? `surprise: ${problem}` : s;
    };
    const fires = (s) => s === "editing";
    ok("R12 precondition: fires long after an apply with nothing asked", fires(await scenario({ checkAfter: 5 * K })), "");
    ok("R12 precondition: not a second after the apply", (await scenario({ checkAfter: 1000 })) === "applying", "");
    for (const T of [1000, K - 1, K, K + 1, 3 * K]) {
      const base = await scenario({ checkAfter: T });
      same(`R12 idle ${T} ms after the apply: fires exactly at FIX_ANSWER_MS`, fires(base), T >= K);
      // a question asked and answered: counted from the answer, not the apply nor the question
      same(`R12 idle ${T} ms after an answer: as after the apply`, await scenario({ askAt: Math.round(K * 0.25), answerAt: Math.round(K * 0.75), checkAfter: T }), base);
      same(`R12 idle ${T} ms after a question asked and answered at once: as after the apply`, await scenario({ askAt: Math.round(K * 0.5), answerAt: Math.round(K * 0.5), checkAfter: T }), base);
    }
    for (const T of [K, 3 * K, 15 * K]) {
      same(`R12 a question open ${T} ms: never fires (the caster's)`, await scenario({ askAt: 1000, checkAfter: T }), "applying");
      same(`R12 a question open ${T} ms: never fires (another seat's)`, await scenario({ red: true, asker: "Red", askAt: 1000, checkAfter: T }), "applying");
    }
    // a question left open from an earlier apply (the engine was late, after the watchdog sent the fix back) is no sign
    // that the engine took the new list: the second apply is watched as if that question weren't there
    const retry = async (staleQuestion) => {
      const r = await runFix(h, { red: false, ops: [B_CAST], kind: "hand" });
      if (r.count !== 1) return `surprise: ${r.surprise || r.refusal}`;
      const g = r.g, seat = r.seat;
      const p1 = at(r.t0 + 1000, () => h.B.onPrompt(seat, prompt("chooseNumber", { min: 0, max: 5, presentation: { title: "Choose X" } }, 960, seat.slot)));
      await h.flush(); await p1;
      const p2 = at(Date.now() + 10, () => h.B.onTTS({ t: "answer", json: J({ color: "Blue", promptId: 960, choice: [String(seat.prompt?.ui?.min ?? 0)] }) }));
      await h.flush(); await p2;
      const p3 = at(Date.now() + 3 * K, () => { h.B.fixWatchdog(); return g.fix?.state; });
      await h.flush();
      const fired = await p3;
      if (fired !== "editing") return `surprise: the first apply wasn't sent back (${fired})`;
      if (staleQuestion) { h.B.onPrompt(seat, prompt("chooseNumber", { min: 0, max: 5, presentation: { title: "Choose X" } }, 961, seat.slot)); await h.flush(); }
      if (staleQuestion && !seat.prompt) return "surprise: the late question never opened";
      const t1 = Date.now();
      await fixMsg(h, "Blue", { action: "done", ops: [B_CAST], kind: "hand" });
      if (g.fix?.state !== "applying") return `surprise: the second Done wasn't applied (${g.fix?.state})`;
      const s = at(t1 + 3 * K, () => { h.B.fixWatchdog(); return g.fix?.state; });
      await h.flush();
      return await s;
    };
    const clean = await retry(false);
    ok("R12 precondition: a second apply with nothing asked is sent back", clean === "editing", clean);
    same("R12 a question left from the first apply: the second is watched as without it", await retry(true), clean);
  });

  // R13 field round trip: every field the table may send for a free play reaches the engine as given (an ability index of
  // 0 is an index, not a missing one), and nothing it did not send is added
  await run(async (h) => {
    for (const ability of [0, 1, 2, undefined]) {
      const op = { op: "freeActivate", card: "engine-card-22", player: "Blue", ...(ability !== undefined ? { ability } : {}) };
      const r = await runFix(h, { ops: [op] });
      ok(`R13 precondition: freeActivate with ability ${ability} applied`, r.count === 1, r.surprise || r.refusal);
      same(`R13 freeActivate ability ${ability}: the op as sent, the player as its slot`, r.sent, [{ ...op, player: "player-0" }]);
    }
    // the same play said by the colour of its player, whoever pressed Done
    for (const op of [B_CAST, R_CAST, B_ACT_BORROW]) {
      const byBlue = await runFix(h, { ops: [op], by: "Blue" });
      const byRed = await runFix(h, { ops: [op], by: "Red" });
      ok(`R13 precondition: ${op.op} ${op.card} applied`, byBlue.count === 1 && byRed.count === 1, J([byBlue.refusal, byRed.refusal]));
      same(`R13 ${op.op} ${op.card}: the same ops and lines whoever pressed Done`, [byRed.sent, byRed.lines], [byBlue.sent, byBlue.lines]);
      ok(`R13 ${op.op} ${op.card}: the line names its player, ${op.player}`, (byBlue.lines || [])[0]?.startsWith(`${op.player} `) && byBlue.lines[0].includes(nameIn(op.card)), J(byBlue.lines));
    }
  });

  finished = true;
  process.stdout.write(failed ? `FAILED: ${passed} passed, ${failed} failed${crashes ? ` (${crashes} crashes)` : ""}\n` : `PASSED: ${passed} passed, 0 failed\n`);
  process.exit(failed ? 1 : 0);
})();
