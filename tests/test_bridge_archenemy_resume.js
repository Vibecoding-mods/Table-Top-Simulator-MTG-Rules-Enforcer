// Archenemy across a bridge restart (bridge.js schemeView, saveResume, resumeGame): the schemes the bridge has seen in
// the command zone (game.schemesSeen) and the one set in motion last (game.schemeNow { seq, card }) go into the resume
// file and come back from it. Without them a restarted bridge counted seq from 1 again over the schemes still in play:
// the table, which shows the "SET IN MOTION" banner once per seq (engine-renderer.lua engineSchemeSeen), showed an old
// scheme's banner again and then skipped the next scheme's. The resume file is also written as a new scheme arrives,
// so a restart right after one still knows it.
//   node tests/test_bridge_archenemy_resume.js
const fs = require("fs");
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const SLOTS = { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" };
const scheme = (n, name, o = {}) => ({ id: `engine-card-${n}`, identity: { name }, types: ["Scheme"], ...(o.ongoing ? { supertypes: ["Ongoing"] } : {}),
  controllerId: "player-3", ownerId: "player-3", text: `${name}: when you set this scheme in motion, something happens.` });
function board(schemes, deck = 17) {
  const gv = { turn: 3, step: "main1", activePlayerId: "player-3", priorityPlayerId: "player-3", stack: [], combatAssignments: [],
    players: Object.keys(SLOTS).map((id) => ({ id, life: id === "player-3" ? 40 : 20, manaPool: {}, status: "playing",
      isArchenemy: id === "player-3", schemeDeckCount: id === "player-3" ? deck : 0,
      ...(id === "player-3" && schemes.length ? { schemes: schemes.map((c) => ({ id: c.id, name: c.identity.name, ongoing: (c.supertypes || []).includes("Ongoing") })) } : {}) })),
    zones: Object.keys(SLOTS).flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) };
  const cmd = gv.zones.find((z) => z.zone === "command" && z.ownerId === "player-3");
  cmd.cards.push(...schemes);
  cmd.count = cmd.cards.length;
  return gv;
}
const SEAT = { color: "Blue", deckId: "neheb_minotaur_commander", username: "tts-Blue-ab12", slot: "player-3", roomId: "room-1" };
// the resume file's text as the bridge writes it (fs.writeFile of its .tmp, then a rename)
function capture() {
  const files = [];
  fs.writeFile = (p, d, ...rest) => { if (String(p) === `${process.env.MTG_RESUME_FILE}.tmp`) files.push(String(d)); const cb = rest.find((f) => typeof f === "function"); if (cb) cb(null); };
  return files;
}
async function send(h, seat, gv) {
  seat.board = { state: { gameView: gv }, fingerprint: null };
  const n0 = h.effects.length;
  h.B.sendTable(); await h.flush(100000);
  return h.effects.slice(n0).filter((e) => e.tts?.t === "table").map((e) => e.tts).at(-1);
}
const now = (m) => (m?.schemeNow ? [m.schemeNow.seq, m.schemeNow.card?.id] : null);

(async () => {
  const plot = scheme(500, "A Display of My Dark Power");
  const ongoing = scheme(501, "Nothing Can Stop Me Now", { ongoing: true });
  const later = scheme(502, "Behold the Power of Destruction");
  const next = scheme(503, "All in Good Time");
  // ── before the restart: three schemes set in motion; the first went back under the deck ──
  let saved = null;
  {
    const h = harness.load();
    const files = capture();
    const seat = new h.B.Seat("Blue", "neheb_minotaur_commander", SEAT);
    seat.respond = () => {};
    h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 3, total: 4, playerOrder: ["tts-Blue-ab12"], slotNames: { ...SLOTS }, slotColor: { ...SLOTS }, seatColors: ["White", "Blue"],
      started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10, roomId: "room-1", deckNames: new Set() });
    await send(h, seat, board([plot]));
    await send(h, seat, board([plot, ongoing]));
    const before = files.length;
    const m3 = await send(h, seat, board([ongoing, later], 15));
    same("before: the third scheme is seq 3", now(m3), [3, later.id]);
    ok("save: a new scheme writes the resume file", files.length > before, `${files.length} files, ${before} before`);
    saved = files.length ? JSON.parse(files.at(-1)) : null;
    same("save: the schemes seen in the command zone", saved?.game?.schemesSeen, [ongoing.id, later.id]);
    same("save: the seat colours in seat order", saved?.game?.seatColors, ["White", "Blue"]);
    same("save: the scheme set in motion last", saved?.game?.schemeNow ? [saved.game.schemeNow.seq, saved.game.schemeNow.card?.id] : null, [3, later.id]);
    // (a scheme only leaving: saved too, or one back from the deck after a restart would not be new)
    await send(h, seat, board([later], 15));
    const pruned = files.length ? JSON.parse(files.at(-1)) : null;
    same("save: a scheme gone back under the deck leaves the saved list", pruned?.game?.schemesSeen, [later.id]);
    harness.restore();
  }
  // ── a restarted bridge ──
  {
    const h = harness.load();
    await fs.promises.writeFile(process.env.MTG_RESUME_FILE, JSON.stringify({ ...saved, savedAt: Date.now() - 2000 }));
    ok("resume: (resumed)", h.B.resumeGame() === true);
    const g = h.B._getGame();
    same("resume: the saved seat colours come back (not re-derived from who sits where)", g?.seatColors, ["White", "Blue"]);
    ok("resume: the schemes seen come back as a set", g?.schemesSeen instanceof Set && [...g.schemesSeen].join() === [ongoing.id, later.id].join(), JSON.stringify(g && [...(g.schemesSeen || [])]));
    const seat = g.seats.get("Blue");
    seat.respond = () => {};
    const m4 = await send(h, seat, board([ongoing, later], 15));
    same("resume: the same schemes keep seq 3 (no banner again for an old scheme)", now(m4), [3, later.id]);
    const m5 = await send(h, seat, board([ongoing, later, next], 14));
    same("resume: the next scheme is seq 4 (its banner not skipped)", now(m5), [4, next.id]);
    for (const s of g.seats.values()) s.close();
    await h.flush();
    harness.restore();
  }
  // ── a save from before this change (no scheme fields) resumes as before ──
  {
    const h = harness.load();
    const old = { ...saved, savedAt: Date.now() - 2000, game: { ...saved.game } };
    delete old.game.schemesSeen; delete old.game.schemeNow;
    await fs.promises.writeFile(process.env.MTG_RESUME_FILE, JSON.stringify(old));
    delete old.game.seatColors;
    await fs.promises.writeFile(process.env.MTG_RESUME_FILE, JSON.stringify(old));
    ok("old save: resumes", h.B.resumeGame() === true);
    const g = h.B._getGame();
    same("old save: the seat colours from who sits where, as before", g?.seatColors, ["White", "Red", "Yellow", "Blue"]);
    const seat = g.seats.get("Blue");
    seat.respond = () => {};
    const m = await send(h, seat, board([ongoing], 15));
    same("old save: counts from 1 as before", now(m), [1, ongoing.id]);
    for (const s of g.seats.values()) s.close();
    await h.flush();
    harness.restore();
  }
  process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} archenemy resume checks pass\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL test_bridge_archenemy_resume: ${e.stack}\n`); process.exit(1); });
