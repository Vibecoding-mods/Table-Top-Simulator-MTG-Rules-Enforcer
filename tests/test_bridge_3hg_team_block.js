// Three-Headed Giant's joint team block in the bridge, a team of three on the six-seat table (CR 805.10d, 805.2;
// docs/handoff/team-block-2-report.md). The engine's re-ask order for three, as forge-harness ThreeHeadedGiantTest
// "threes reasksAfterTwoChangesGoInTurnOrder" proves it (Green, Blue, Purple; Green after Purple; Blue after Green;
// Green after Blue; Purple after Blue), played through the bridge question by question with each change notice sent to
// all three defenders. Checked: each ask goes to its seat with the engine's title (round 1 names both partners, a revise
// round who changed), the joint round, the team's block with each partner's name in their seat colour, Agree sending
// currentAssignments back, a pick sent as picked; each notice printed as one chat line to each of the three,
// acknowledged at once and never shown as a question, and one game-log line for the team; the cap's notice the same.
//   node tests/test_bridge_3hg_team_block.js
const harness = require("./bridge-harness");
const T = require("../bridge/teams");
const L2 = require("./golden/fixtures/2hg-level2-protocol.json");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
const SLOTS = { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Green", "player-4": "Blue", "player-5": "Purple" };
const DEFENDERS = ["player-3", "player-4", "player-5"];
const ZONES = ["hand", "graveyard", "exile", "command", "library", "battlefield"];

// the six-seat board while the defending team of three blocks: the level 2 fixture's cards, two teams of three with
// shared life (3HG, sharedLife), White's Grizzly Bears (29) and Red's Juggernaut (30) attacking Green; Green's Grizzly
// Bears (31), Blue's Hill Giant (32) and Purple's Trained Armodon (33) to block
function blockBoard(assignments) {
  const src = L2.record[62].board;
  const b = clone(src);
  const gv = b.gameView;
  const base = gv.players[0];
  gv.players = Object.keys(SLOTS).map((id, i) => ({ ...clone(base), id, teamNumber: i < 3 ? 1 : 2, life: 45 }));
  gv.teamRules = { rule: "sharedLife", poisonToLose: 20 };
  delete gv.activeTeamIds; delete gv.priorityTeamIds;
  const card = (id) => clone(src.gameView.zones.flatMap((z) => z.cards || []).find((c) => c.id === id));
  const own = (c, p, name) => ({ ...c, controllerId: p, ownerId: p, ...(name ? { id: "engine-card-33", identity: { ...c.identity, name } } : {}) });
  const bf = { "player-0": [own(card("engine-card-29"), "player-0")], "player-1": [own(card("engine-card-30"), "player-1")],
    "player-3": [own(card("engine-card-31"), "player-3")], "player-4": [own(card("engine-card-32"), "player-4")], "player-5": [own(card("engine-card-32"), "player-5", "Trained Armodon")] };
  gv.zones = Object.keys(SLOTS).flatMap((p) => ZONES.map((zone) => { const cards = zone === "battlefield" ? bf[p] || [] : []; return { zone, ownerId: p, cards, count: cards.length }; }));
  gv.step = "combatDeclareBlockers";
  gv.activePlayerId = "player-0";
  gv.priorityPlayerId = "player-3";
  gv.combatAssignments = clone(assignments || []);
  return b;
}
function setGame(h) {
  const seats = new Map();
  for (const slot of DEFENDERS) {
    const s = new h.B.Seat(SLOTS[slot], "neheb_minotaur_commander");
    s.slot = slot;
    s.heartbeat = () => {};
    seats.set(slot, s);
  }
  h.B.onTTS({ t: "hello", json: JSON.stringify({ tableSeats: Object.values(SLOTS) }) });
  h.B._setGame({ seats: new Map([...seats.values()].map((s) => [s.color, s])), bots: 3, total: 6, playerOrder: Object.keys(SLOTS).map((slot) => seats.get(slot)?.username || `tts-${SLOTS[slot].toLowerCase()}-0000`),
    slotNames: { ...SLOTS }, slotColor: { ...SLOTS }, started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {},
    teams: { ...T.THREE_TEAMS }, teamMode: "3hg" });
  return seats;
}
const named = (x, seats) => JSON.parse(JSON.stringify(x).replace(/\{(Green|Blue|Purple)\}/g, (m, c) => [...seats.values()].find((s) => s.color === c).username));
const shownTo = (h, from, color) => h.effects.slice(from).filter((e) => e.tts?.t === "prompt" && e.tts.color === color).map((e) => e.tts).pop() || null;
const chatsTo = (h, from, color) => h.effects.slice(from).filter((e) => e.tts?.t === "chat" && e.tts.color === color).map((e) => e.tts.text);
const sentFor = (h, from, promptId) => h.effects.slice(from).map((e) => e.relay?.state).filter((s) => s?.kind === "response" && s.promptId === promptId).pop() || null;
const logLines = (h, from) => h.effects.slice(from).filter((e) => e.tts?.t === "gamelog").flatMap((e) => e.tts.lines || []);

const ATT = (validBlockerIds) => [
  { attackerId: "engine-card-29", validBlockerIds, minBlockers: 1, mustBeBlocked: false },
  { attackerId: "engine-card-30", validBlockerIds, minBlockers: 1, mustBeBlocked: false }];
const ask = (promptId, slot, title, round, current, lines) => ({ ask: { promptId, decidingPlayerId: slot, input: { type: "chooseBlockers", title,
  ...(round ? { reviseRound: round } : {}), currentAssignments: current, teamBlockLines: lines, attackers: ATT([{ "player-3": "engine-card-31", "player-4": "engine-card-32", "player-5": "engine-card-33" }[slot]]),
  availableBlockerIds: [{ "player-3": "engine-card-31", "player-4": "engine-card-32", "player-5": "engine-card-33" }[slot]] } }, combatAssignments: current });
const OX = { blockerId: "engine-card-33", attackerId: "engine-card-30" }, BEARS = { blockerId: "engine-card-31", attackerId: "engine-card-29" }, GIANT = { blockerId: "engine-card-32", attackerId: "engine-card-30" };
// the engine's order for three (ThreeHeadedGiantTest "threes reasksAfterTwoChangesGoInTurnOrder"), with its notices
const STEPS = [
  { ...ask(601, "player-3", "Block with {Blue} and {Purple}", 0, [], ["Grizzly Bears -> not blocked", "Juggernaut -> not blocked"]), answer: { agree: true } },
  { ...ask(602, "player-4", "Block with {Green} and {Purple}", 0, [], ["Grizzly Bears -> not blocked", "Juggernaut -> not blocked"]), answer: { agree: true } },
  { ...ask(603, "player-5", "Block with {Green} and {Blue}", 0, [], ["Grizzly Bears -> not blocked", "Juggernaut -> not blocked"]), answer: { pick: ["engine-card-33|engine-card-30"] } },
  { notice: { to: DEFENDERS, text: "{Purple}: Trained Armodon now blocks Juggernaut." } },
  { ...ask(604, "player-3", "{Purple} changed the blocks. Agree or change?", 1, [OX], ["Grizzly Bears -> not blocked", "Juggernaut -> {Purple}'s Trained Armodon"]), answer: { pick: ["engine-card-31|engine-card-29"] } },
  { notice: { to: DEFENDERS, text: "{Green}: Grizzly Bears now blocks Grizzly Bears." } },
  { ...ask(605, "player-4", "{Green} changed the blocks. Agree or change?", 2, [BEARS, OX], ["Grizzly Bears -> {Green}'s Grizzly Bears", "Juggernaut -> {Purple}'s Trained Armodon"]), answer: { pick: ["engine-card-32|engine-card-30"] } },
  { notice: { to: DEFENDERS, text: "{Blue}: Hill Giant now blocks Juggernaut." } },
  { ...ask(606, "player-3", "{Blue} changed the blocks. Agree or change?", 3, [BEARS, OX, GIANT], ["Grizzly Bears -> your Grizzly Bears", "Juggernaut -> {Purple}'s Trained Armodon + {Blue}'s Hill Giant"]), answer: { agree: true } },
  { ...ask(607, "player-5", "{Blue} changed the blocks. Agree or change?", 4, [BEARS, OX, GIANT], ["Grizzly Bears -> {Green}'s Grizzly Bears", "Juggernaut -> your Trained Armodon + {Blue}'s Hill Giant"]), answer: { agree: true } },
  { notice: { to: DEFENDERS, text: "{Green} settles the team's blocks (rule 805.2)" } },
];

async function play(h) {
  const seats = setGame(h);
  const out = [];
  for (const st of STEPS) {
    if (st.ask) {
      const seat = seats.get(st.ask.decidingPlayerId);
      seat.board = { state: blockBoard(st.combatAssignments), fingerprint: null };
      const n0 = h.effects.length;
      h.B.onPrompt(seat, named(st.ask, seats)); await h.flush();
      const shown = shownTo(h, n0, seat.color);
      const n1 = h.effects.length;
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: seat.color, promptId: st.ask.promptId, choice: st.answer.agree ? ["__agree"] : st.answer.pick }) }); await h.flush();
      out.push({ ask: st.ask, seat: seat.color, shown, sent: sentFor(h, n1, st.ask.promptId)?.action?.output || null });
    } else {
      const told = {};
      const n0 = h.effects.length;
      for (const slot of st.notice.to) {
        const seat = seats.get(slot);
        seat.board = { state: blockBoard([]), fingerprint: null };
        const m0 = h.effects.length;
        const promptId = 700 + out.length * 4 + st.notice.to.indexOf(slot);
        h.B.onPrompt(seat, named({ promptId, decidingPlayerId: slot, input: { type: "revealCards", cards: [], presentation: { title: st.notice.text } } }, seats)); await h.flush();
        told[seat.color] = { chats: chatsTo(h, m0, seat.color), acked: sentFor(h, m0, promptId)?.action?.output?.type === "revealCardsAcknowledged", shown: !!shownTo(h, m0, seat.color) };
      }
      out.push({ notice: st.notice, told, log: logLines(h, n0) });
    }
  }
  return out;
}

(async () => {
  const h = harness.load();
  let r;
  try { r = await play(h); } finally { harness.restore(); }
  const asks = r.filter((x) => x.ask), notices = r.filter((x) => x.notice);
  same("order: the asks go to the seats in the engine's order for three", asks.map((x) => `${x.seat}${x.ask.input.reviseRound ? `:${x.ask.input.reviseRound}` : ""}`),
    ["Green", "Blue", "Purple", "Green:1", "Blue:2", "Green:3", "Purple:4"]);
  same("title: round 1 names both partners", asks.slice(0, 3).map((x) => x.shown?.title), ["Block with Blue and Purple", "Block with Green and Purple", "Block with Green and Blue"]);
  same("title: each revise round names who changed", asks.slice(3).map((x) => x.shown?.title),
    ["Purple changed the blocks. Agree or change?", "Green changed the blocks. Agree or change?", "Blue changed the blocks. Agree or change?", "Blue changed the blocks. Agree or change?"]);
  same("joint: the table is told the round", asks.map((x) => x.shown?.joint), [0, 0, 0, 1, 2, 3, 4]);
  ok("lines: both partners named, each in their seat colour", (asks[5].shown?.text || "").includes(`<color=${T.SEAT_HEX.Purple}>Purple's</color> Trained Armodon + <color=${T.SEAT_HEX.Blue}>Blue's</color> Hill Giant`), asks[5].shown?.text);
  same("sent: Agree sends currentAssignments back, a pick as picked", asks.map((x) => x.sent?.assignments),
    [[], [], [OX], [BEARS], [GIANT], [BEARS, OX, GIANT], [BEARS, OX, GIANT]]);
  same("notice: each change one chat line to each of the three defenders", notices.slice(0, 3).map((x) => ["Green", "Blue", "Purple"].map((c) => x.told[c]?.chats)),
    [0, 1, 2].map((i) => ["Green", "Blue", "Purple"].map(() => [["[MTG] Purple: Trained Armodon now blocks Juggernaut.", "[MTG] Green: Grizzly Bears now blocks Grizzly Bears.", "[MTG] Blue: Hill Giant now blocks Juggernaut."][i]])));
  ok("notice: printed, never asked (acknowledged at once, nothing shown) to each of the three", notices.every((x) => ["Green", "Blue", "Purple"].every((c) => x.told[c]?.acked && !x.told[c]?.shown)), JSON.stringify(notices.map((x) => x.told)));
  same("notice: the game log has each change once for the team, not once per defender", notices.slice(0, 3).map((x) => x.log.filter((l) => /now blocks/.test(l)).length), [1, 1, 1]);
  same("cap: the primary's notice reads 'Green decides (team leader)' to all three", ["Green", "Blue", "Purple"].map((c) => notices[3].told[c]?.chats), [["[MTG] Green decides (team leader)"], ["[MTG] Green decides (team leader)"], ["[MTG] Green decides (team leader)"]]);
  process.stdout.write(`${failed ? "FAIL" : "PASS"} test_bridge_3hg_team_block: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL test_bridge_3hg_team_block: ${e.stack}\n`); process.exit(1); });
