// The tie offer in the bridge (bridge.js tieState / tieNews / onTieVote / forcedTieEarned, bridge/accomplishments.js):
// the engine's gameView.tieOffer (TieOffer in the harness) as the table gets it, its chat (the offer, a no, a warning
// each round without progress, progress starting the count over, the lock broken, the draw), the votes as tieVote
// directives, a harmless bot accepting, the game's end words, and a forced tie's accomplishment kept by Steam ID, with
// gif-keys.json never read or written.
//   node tests/test_bridge_tie_offer.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const harness = require("./bridge-harness");
const A = require("../bridge/accomplishments");
const FIX = require("./golden/fixtures/2hg-level2-protocol.json");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const clone = (o) => JSON.parse(JSON.stringify(o));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tie-offer-"));
process.env.MTG_ACCOMPLISHMENTS = path.join(tmp, "accomplishments.json");
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const chats = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
const chatsTo = (h, color, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "chat" && e.tts.color === color).map((e) => e.tts.text);
const tables = (h) => h.effects.filter((e) => e.tts?.t === "table").map((e) => e.tts);
const directives = (h, from = 0) => h.effects.slice(from).map((e) => e.relay?.state).filter((s) => s?.kind === "directive").map((s) => ({ from: s.fromPlayer, ...s.directive }));
const logLines = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "gamelog").flatMap((e) => e.tts.lines);
const SLOTS = { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" };
const STEAM = { White: "76561190000000001", Red: "76561190000000002", Yellow: "not-a-steam-id" };

// a plain four-player board (the fixture's first, its team rules taken off), with a tie offer
function board(tie, over = false) {
  const b = clone(FIX.record.find((e) => e.board).board);
  delete b.gameView.teamRules; delete b.gameView.activeTeamIds; delete b.gameView.priorityTeamIds;
  for (const p of b.gameView.players) delete p.teamNumber;
  if (tie) b.gameView.tieOffer = tie;
  if (over) { b.gameView.gameOver = true; b.gameView.winnerId = null; }
  return b;
}
const offer = (status, extra = {}) => ({ voteId: 1, locks: [{ playerId: "player-0", reasons: ["cantLose"] }], awaitingPlayerIds: ["player-0", "player-1", "player-2", "player-3"],
  acceptedPlayerIds: [], status: { type: status, ...(extra.by ? { playerId: extra.by } : {}) }, roundsWithoutProgress: extra.rounds || 0, roundsToForce: 3, ...extra.more });

function setGame(h) {
  const seats = new Map();
  for (const [slot, color] of Object.entries(SLOTS)) {
    if (color === "Blue") continue;
    const s = new h.B.Seat(color, "neheb_minotaur_commander");
    s.slot = slot;
    s.heartbeat = () => {};
    s.send = (msg) => h.effects.push({ relay: msg });
    seats.set(color, s);
  }
  const bot = { slot: "player-3", directive: (d) => h.effects.push({ relay: { state: { kind: "directive", fromPlayer: "player-3", directive: d } } }) };
  h.B._setGame({ seats, bots: 1, total: 4, playerOrder: [...seats.values()].map((s) => s.username), slotNames: { ...SLOTS }, slotColor: { ...SLOTS },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, harmless: [bot], steam: h.B._steamIds(STEAM) });
  return { seats, bot };
}
async function show(h, seats, b) {
  for (const s of seats.values()) s.board = { state: clone(b), fingerprint: null };
  h.B._harmlessVotes(b.gameView);
  h.B.sendTable();
  await h.flush();
}

(async () => {
  // ── accomplishments.js on its own ──
  {
    const saved = [];
    const store = { read: () => ({ version: 1, players: { "76561190000000009": { "forced-tie": { count: 2, first: "2026-01-01", last: "2026-02-01" }, junk: { count: 1 } }, "color:Red": { "forced-tie": { count: 1 } } } }), write: (d) => saved.push(clone(d)) };
    const acc = A.createAccomplishments({ store, now: () => Date.parse("2026-11-16T12:00:00Z") });
    same("accomplishments: the file's entries kept, unknown ones and non-Steam keys dropped", acc.list("76561190000000009").map((e) => [e.id, e.count]), [["forced-tie", 2]]);
    same("accomplishments: a colour is no key", acc.earn("color:Red", "forced-tie"), null);
    same("accomplishments: an unknown accomplishment isn't kept", acc.earn("76561190000000009", "made-up"), null);
    const e = acc.earn("76561190000000009", "forced-tie");
    ok("accomplishments: one more Stalemate, dated", e && e.name === "Stalemate" && e.count === 3 && e.first === "2026-01-01" && e.last === "2026-11-16", JSON.stringify(e));
    const n = acc.earn("76561190000000010", "forced-tie");
    ok("accomplishments: a first one", n && n.count === 1 && n.first === "2026-11-16", JSON.stringify(n));
    ok("accomplishments: each earn saved, players by Steam ID", saved.length === 2 && saved[1].version === 1 && saved[1].players["76561190000000010"]["forced-tie"].count === 1 && !saved[1].players["color:Red"], JSON.stringify(saved.at(-1)));
    same("steamKey: digits only", [A.steamKey("76561190000000001"), A.steamKey("Red"), A.steamKey(""), A.steamKey(null)], ["76561190000000001", null, null, null]);
  }

  // ── the offer, the vote, the countdown, a forced tie ──
  const touched = [];
  const watch = ["readFileSync", "writeFileSync", "renameSync", "existsSync", "openSync", "unlinkSync"];
  const real = {};
  for (const k of watch) { real[k] = fs[k]; }
  await run(async (h) => {
    for (const k of watch) { const was = fs[k]; fs[k] = (p, ...a) => { touched.push(`${k} ${String(p)}`); return was.call(fs, p, ...a); }; }
    const { seats } = setGame(h);
    same("steamIds: only Steam IDs kept from the start message", h.B._getGame().steam, { White: STEAM.White, Red: STEAM.Red });

    let n = h.effects.length;
    await show(h, seats, board(offer("pending")));
    const t = tables(h).at(-1)?.tie;
    ok("table: the offer reaches the table", t && t.id === 1 && t.status === "pending", JSON.stringify(t));
    same("table: who is locked and why", t?.locked, [{ who: "White", color: "White", why: ["can't lose the game"] }]);
    same("table: the colours still to answer", t?.waiting, ["White", "Red", "Yellow", "Blue"]);
    same("table: the people by name (not the harmless bot)", t?.waitingNames, ["White", "Red", "Yellow"]);
    ok("chat: the offer said once, with how to answer", chats(h, n).filter((c) => /A tie is offered/.test(c)).length === 1 && chats(h, n).some((c) => /^\[MTG\] White can't lose the game, so the game may never end\. A tie is offered\. Waiting for White, Red and Yellow: press Tie or Keep playing \(or type  mtg tie yes \/ mtg tie no\)\./.test(c)), chats(h, n).join(" | "));
    ok("log: the offer in the game log", logLines(h, n).some((l) => /A tie is offered/.test(l)), logLines(h, n).join(" | "));
    same("bot: the harmless bot accepts at once", directives(h, n).filter((d) => d.from === "player-3"), [{ from: "player-3", type: "tieVote", voteId: 1, accept: true }]);
    n = h.effects.length;
    await show(h, seats, board(offer("pending")));
    ok("chat: the same offer again says nothing", !chats(h, n).some((c) => /tie/i.test(c)) && directives(h, n).length === 0, chats(h, n).join(" | "));

    n = h.effects.length;
    h.B.onTTS({ t: "tieVote", color: "Red", accept: true, steam: "76561190000000022" });
    await h.flush();
    same("vote: Red's yes is a tieVote directive", directives(h, n), [{ from: "player-1", type: "tieVote", voteId: 1, accept: true }]);
    same("vote: the Steam ID sent with a vote is kept", h.B._getGame().steam.Red, "76561190000000022");
    await show(h, seats, board(offer("pending", { more: { awaitingPlayerIds: ["player-0", "player-2"] } })));
    n = h.effects.length;
    h.B.onTTS({ t: "tieVote", color: "Red", accept: true });
    await h.flush();
    ok("vote: an answer not needed is refused", directives(h, n).length === 0 && chatsTo(h, "Red", n).some((c) => /Your answer isn't needed for this tie/.test(c)), chatsTo(h, "Red", n).join(" | "));

    n = h.effects.length;
    h.B.onTTS({ t: "tieVote", color: "Yellow", accept: false });
    await h.flush();
    same("vote: Yellow's no is a tieVote directive", directives(h, n), [{ from: "player-2", type: "tieVote", voteId: 1, accept: false }]);
    n = h.effects.length;
    await show(h, seats, board(offer("declined", { by: "player-2", more: { awaitingPlayerIds: [] } })));
    ok("chat: the no and the forced-tie rule", chats(h, n).some((c) => /^\[MTG\] Yellow declined the tie\. If nothing changes for 3 full rounds \(no life lost, no poison or commander damage, no permanent leaving the battlefield, no card milled, nobody losing\), the game ends in a forced tie\./.test(c)), chats(h, n).join(" | "));
    same("table: declined, by Yellow, 0 rounds", ((x) => x && [x.status, x.declinedBy, x.rounds, x.toForce])(tables(h).at(-1)?.tie), ["declined", "Yellow", 0, 3]);

    n = h.effects.length;
    await show(h, seats, board(offer("declined", { by: "player-2", rounds: 1, more: { awaitingPlayerIds: [] } })));
    ok("chat: round 1 warned", chats(h, n).some((c) => /^\[MTG\] Tie warning: 1 of 3 rounds without progress\. 2 more rounds like this and the game is a forced tie\./.test(c)), chats(h, n).join(" | "));
    n = h.effects.length;
    await show(h, seats, board(offer("declined", { by: "player-2", rounds: 2, more: { awaitingPlayerIds: [] } })));
    ok("chat: round 2 warned, one more", chats(h, n).some((c) => /Tie warning: 2 of 3 rounds without progress\. One more round like this/.test(c)), chats(h, n).join(" | "));
    n = h.effects.length;
    await show(h, seats, board(offer("declined", { by: "player-2", rounds: 0, more: { awaitingPlayerIds: [] } })));
    ok("chat: progress starts the count over", chats(h, n).some((c) => /^\[MTG\] Progress: the tie count starts over \(0 of 3 rounds\)\./.test(c)), chats(h, n).join(" | "));

    n = h.effects.length;
    await show(h, seats, board(offer("forced", { by: "player-2", rounds: 3, more: { awaitingPlayerIds: [] } }), true));
    ok("chat: the forced tie", chats(h, n).some((c) => /^\[MTG\] 3 rounds without progress: the game is a forced tie\./.test(c)), chats(h, n).join(" | "));
    ok("accomplishment: White earns Stalemate, told privately", chatsTo(h, "White", n).some((c) => /^\[MTG\] Accomplishment: Stalemate\. Played a game to a forced tie/.test(c)), chatsTo(h, "White", n).join(" | "));
    ok("accomplishment: Red earns it under the Steam ID from the vote", h.B._accomplishments.list("76561190000000022").some((e) => e.id === "forced-tie" && e.count === 1), JSON.stringify(h.B._accomplishments.list("76561190000000022")));
    ok("accomplishment: White's kept by Steam ID", h.B._accomplishments.list(STEAM.White).some((e) => e.id === "forced-tie" && e.count === 1), JSON.stringify(h.B._accomplishments.list(STEAM.White)));
    ok("accomplishment: Yellow, with no Steam ID, gets none", !chatsTo(h, "Yellow", n).some((c) => /Accomplishment/.test(c)), chatsTo(h, "Yellow", n).join(" | "));
    ok("accomplishment: the file written", h.effects.slice(n).some((e) => e.writeFileSync === "accomplishments.json.tmp"), JSON.stringify(h.effects.slice(n).filter((e) => e.writeFileSync)));
    same("end words: a forced tie", h.B.gameEndWords(board(offer("forced", { rounds: 3 }), true).gameView), "a forced tie: 3 rounds without progress");
    ok("table: the top bar says why", tables(h).at(-1)?.overWhy === "a forced tie: 3 rounds without progress", tables(h).at(-1)?.overWhy);
    n = h.effects.length;
    await show(h, seats, board(offer("forced", { by: "player-2", rounds: 3, more: { awaitingPlayerIds: [] } }), true));
    h.B.sendTable(); await h.flush();
    ok("accomplishment: once a game", !chats(h, n).some((c) => /Accomplishment/.test(c)), chats(h, n).join(" | "));
    // (a board that drops the offer and one that shows it again: still once)
    n = h.effects.length;
    await show(h, seats, board(null, true));
    await show(h, seats, board(offer("forced", { by: "player-2", rounds: 3, more: { awaitingPlayerIds: [] } }), true));
    ok("accomplishment: once a game, the offer shown again", !chats(h, n).some((c) => /Accomplishment/.test(c)) && h.B._accomplishments.list(STEAM.White)[0]?.count === 1, chats(h, n).join(" | "));
    n = h.effects.length;
    h.B.onTTS({ t: "accomplishments", color: "White", steam: STEAM.White });
    await h.flush();
    ok("mtg accomplishments: the list", chatsTo(h, "White", n).some((c) => /^\[MTG\] Your accomplishments: Stalemate \(1 time, last \d{4}-\d\d-\d\d\)\./.test(c)), chatsTo(h, "White", n).join(" | "));
    n = h.effects.length;
    h.B.onTTS({ t: "accomplishments", color: "Yellow", steam: "" });
    await h.flush();
    ok("mtg accomplishments: no Steam ID said", chatsTo(h, "Yellow", n).some((c) => /kept by Steam ID, and this seat has none/.test(c)), chatsTo(h, "Yellow", n).join(" | "));
  });
  for (const k of watch) fs[k] = real[k];
  ok("files: gif-keys.json never read or written", !touched.some((t) => /gif-keys/.test(t)), touched.filter((t) => /gif/.test(t)).join(" | "));

  // ── agreed, the lock broken, no offer ──
  await run(async (h) => {
    const { seats } = setGame(h);
    await show(h, seats, board(offer("pending")));
    let n = h.effects.length;
    await show(h, seats, board(null));
    ok("chat: the lock broken takes the offer off", chats(h, n).some((c) => /^\[MTG\] The lock is broken: the tie offer is off\./.test(c)) && tables(h).at(-1)?.tie === undefined, chats(h, n).join(" | "));
    n = h.effects.length;
    await show(h, seats, board(null));
    ok("chat: no offer says nothing", !chats(h, n).some((c) => /tie/i.test(c)), chats(h, n).join(" | "));
    await show(h, seats, board(offer("pending", { more: { voteId: 2 } })));
    n = h.effects.length;
    await show(h, seats, board(offer("agreed", { more: { voteId: 2, awaitingPlayerIds: [] } }), true));
    ok("chat: all yes is a draw", chats(h, n).some((c) => /^\[MTG\] Everyone accepted the tie: the game is a draw\./.test(c)), chats(h, n).join(" | "));
    ok("accomplishment: none for an agreed tie", !chats(h, n).some((c) => /Accomplishment/.test(c)), chats(h, n).join(" | "));
    same("end words: an agreed tie", h.B.gameEndWords(board(offer("agreed"), true).gameView), "a draw: everyone accepted the tie");
    n = h.effects.length;
    h.B.onTTS({ t: "tieVote", color: "White", accept: true });
    await h.flush();
    ok("vote: no open offer is said", chatsTo(h, "White", n).some((c) => /No tie offer is open/.test(c)) && directives(h, n).length === 0, chatsTo(h, "White", n).join(" | "));
    same("tieState: the reasons in words", h.B._tieState(board(offer("pending", { more: { locks: [{ playerId: "player-1", reasons: ["cantLoseLife", "cantLoseForZeroLife", "damagePrevented"] }] } })).gameView).locked[0].why,
      ["can't lose life", "doesn't lose at 0 life and can't get poison counters", "has all damage to them prevented"]);
    same("end words: a game without a tie offer is unchanged", h.B.gameEndWords({ ...board(null, true).gameView }), "a draw");
  });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${failed ? "FAIL" : "PASS"} test_bridge_tie_offer: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_bridge_tie_offer: ${e.stack}`); process.exit(1); });
