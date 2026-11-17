// Two-Headed Giant's joint team block in the bridge (CR 805.10d and 805.2; the engine's team-block protocol:
// docs/game-modes-spec.md §5.12; bridge/teams.js jointBlock / jointBlockLines / teamBlockNotice, bridge.js chooseBlockers
// and the no-card revealCards notices). Driven by tests/golden/fixtures/2hg-team-block.json, shaped as the engine's
// report gives the prompts and notices, with its decidingPlayerId sequences as scripted cases: a change of mind,
// agreement, no change, the cap, a refusal, and a free-for-all block. Checked for each ask: the engine's title, the
// team's block one line per attacker with the partner's name in their seat colour, every creature attacking the team
// offered, the defender's own blocks pre-filled, Agree sending currentAssignments back unchanged, a change sent as
// picked; each notice one chat line ("<Primary> decides (team leader)" for the cap); a prompt without the fields as
// before.
//   node tests/test_bridge_2hg_team_block.js
const harness = require("./bridge-harness");
const T = require("../bridge/teams");
const FIX = require("./golden/fixtures/2hg-team-block.json");
const L2 = require("./golden/fixtures/2hg-level2-protocol.json");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
const SLOTS = { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" };
const BLUE_HEX = T.SEAT_HEX.Blue, YELLOW_HEX = T.SEAT_HEX.Yellow;

// the board while the defending team blocks: the level 2 fixture's combat board, in the declare blockers step
function blockBoard(assignments, level1 = false) {
  const b = clone(L2.record[62].board);
  b.gameView.step = "combatDeclareBlockers";
  b.gameView.combatAssignments = clone(assignments || []);
  if (level1) { b.gameView.teamRules = { ...b.gameView.teamRules, rule: "sharedLife" }; delete b.gameView.activeTeamIds; }
  return b;
}
function setGame(h, { ffa = false } = {}) {
  const seats = new Map();
  for (const [slot, color] of Object.entries(SLOTS)) {
    const s = new h.B.Seat(color, "neheb_minotaur_commander");
    s.slot = slot;
    s.heartbeat = () => {};
    seats.set(slot, s);
  }
  h.B._setGame({ seats: new Map([...seats.values()].map((s) => [s.color, s])), bots: 0, total: 4, playerOrder: [...seats.values()].map((s) => s.username),
    slotNames: { ...SLOTS }, slotColor: { ...SLOTS }, started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {},
    ...(ffa ? {} : { teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 }, teamMode: "2hg", teamTurns: "shared" }) });
  return seats;
}
// the fixture's {Yellow} / {Blue}: the players' engine names (their relay usernames, which the bridge names by colour)
const named = (x, seats) => JSON.parse(JSON.stringify(x).replace(/\{(White|Red|Yellow|Blue)\}/g, (m, c) => [...seats.values()].find((s) => s.color === c).username));
const shownTo = (h, from, color) => h.effects.slice(from).filter((e) => e.tts?.t === "prompt" && e.tts.color === color).map((e) => e.tts).pop() || null;
const chatsTo = (h, from, color) => h.effects.slice(from).filter((e) => e.tts?.t === "chat" && (!color || e.tts.color === color)).map((e) => e.tts.text);
const sentFor = (h, from, promptId) => h.effects.slice(from).map((e) => e.relay?.state).filter((s) => s?.kind === "response" && s.promptId === promptId).pop() || null;

// Plays one case: each ask to its seat (on its board), answered as the table answers it (Agree, or the picks then
// Done); each notice to each seat it goes to. What each seat was shown, sent and told, by step.
async function play(h, steps, { level1 = false, ffa = false } = {}) {
  const seats = setGame(h, { ffa });
  const out = [];
  for (const st of steps) {
    if (st.ask) {
      const seat = seats.get(st.ask.decidingPlayerId);
      seat.board = { state: blockBoard(st.combatAssignments, level1), fingerprint: null };
      if (ffa) { delete seat.board.state.gameView.teamRules; for (const p of seat.board.state.gameView.players || []) delete p.teamNumber; }
      const n0 = h.effects.length;
      h.B.onPrompt(seat, named(st.ask, seats)); await h.flush();
      const shown = shownTo(h, n0, seat.color);
      const choice = st.answer.agree ? ["__agree"] : st.answer.pick;
      const n1 = h.effects.length;
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: seat.color, promptId: st.ask.promptId, choice }) }); await h.flush();
      out.push({ ask: st.ask, seat: seat.color, shown, sent: sentFor(h, n1, st.ask.promptId)?.action?.output || null, want: st.sent });
    } else if (st.notice) {
      const told = {};
      for (const slot of st.notice.to) {
        const seat = seats.get(slot);
        seat.board = { state: blockBoard([], level1), fingerprint: null };
        const n0 = h.effects.length;
        const promptId = 400 + out.length * 4 + st.notice.to.indexOf(slot);
        h.B.onPrompt(seat, named({ promptId, decidingPlayerId: slot, input: { type: "revealCards", cards: [], presentation: { title: st.notice.text } } }, seats)); await h.flush();
        told[seat.color] = { chats: chatsTo(h, n0, seat.color), acked: sentFor(h, n0, promptId)?.action?.output?.type === "revealCardsAcknowledged", shown: !!shownTo(h, n0, seat.color) };
      }
      out.push({ notice: st.notice, told });
    }
  }
  return out;
}
const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
const asks = (r) => r.filter((x) => x.ask);
const seq = (r) => asks(r).map((x) => `${x.ask.decidingPlayerId}${x.ask.input.reviseRound ? `:${x.ask.input.reviseRound}` : ""}`);
const optIds = (s) => (s?.options || []).map((o) => o.id);
const onIds = (s) => (s?.options || []).filter((o) => o.on).map((o) => o.id);

(async () => {
  ok("precondition: the fixture has the six cases", ["changeOfMind", "agreement", "noChange", "cap", "refusal", "freeForAll"].every((k) => FIX.cases[k]?.steps?.length));

  // ── a change of mind: the report's player-2, player-3, player-2 (1), player-3 (2) ──
  await run(async (h) => {
    const r = await play(h, FIX.cases.changeOfMind.steps);
    same("change of mind: the asks are the report's", seq(r), ["player-2", "player-3", "player-2:1", "player-3:2"]);
    const [y1, b1, y2, b2] = asks(r);
    same("title: round 1 is the engine's 'Block with <partner>'", [y1.shown?.title, b1.shown?.title], ["Block with Blue", "Block with Yellow"]);
    same("title: a revise round says who changed what", [y2.shown?.title, b2.shown?.title], ["Blue changed the blocks. Agree or change?", "Yellow changed the blocks. Agree or change?"]);
    ok("lines: the team's block, one line per attacker", /The team's block:\nGrizzly Bears → not blocked\nJuggernaut → not blocked/.test(y1.shown?.text || ""), y1.shown?.text);
    ok("lines: the partner's name in their seat colour", (y2.shown?.text || "").includes(`Grizzly Bears → your Grizzly Bears + <color=${BLUE_HEX}>Blue's</color> Hill Giant`)
      && (b2.shown?.text || "").includes(`Juggernaut → <color=${YELLOW_HEX}>Yellow's</color> Grizzly Bears`), `${y2.shown?.text} || ${b2.shown?.text}`);
    ok("lines: the corner's note has them plain", y2.shown?.note === "Grizzly Bears → your Grizzly Bears + Blue's Hill Giant; Juggernaut → not blocked", y2.shown?.note);
    ok("every attacker: Yellow may block the Juggernaut attacking Blue, Blue the Bears attacking Yellow",
      optIds(y1.shown).includes("engine-card-31|engine-card-30") && optIds(y1.shown).includes("engine-card-31|engine-card-29")
      && optIds(b1.shown).includes("engine-card-32|engine-card-29") && optIds(b1.shown).includes("engine-card-32|engine-card-30"), `${optIds(y1.shown)} || ${optIds(b1.shown)}`);
    same("agree: one Agree, first, on every ask that has currentAssignments", r.filter((x) => x.ask).map((x) => optIds(x.shown)[0]), ["__agree", "__agree", "__agree", "__agree"]);
    same("pre-fill: round 1 has nothing of her own yet", onIds(y1.shown), []);
    same("pre-fill: Yellow's revise round has her Bears on the Bears", onIds(y2.shown), ["engine-card-31|engine-card-29"]);
    same("pre-fill: Blue's revise round has her Hill Giant on the Bears", onIds(b2.shown), ["engine-card-32|engine-card-29"]);
    ok("joint: the table is told it is a joint block, with the round", y1.shown?.joint === 0 && y2.shown?.joint === 1 && b2.shown?.joint === 2, JSON.stringify([y1.shown?.joint, y2.shown?.joint, b2.shown?.joint]));
    for (const x of asks(r)) same(`sent: ${x.seat} #${x.ask.promptId} gets the engine its declareBlockers`, x.sent, { type: "declareBlockers", assignments: x.want });
    same("agree: Blue's Agree sends currentAssignments back unchanged", b2.sent?.assignments, b2.ask.input.currentAssignments);
    ok("agree: out of time is Agree too", b2.shown?.onTimeout === "__agree", b2.shown?.onTimeout);
    const n = r.filter((x) => x.notice);
    same("notice: each change is one chat line to each defender", n.map((x) => [x.told.Yellow.chats, x.told.Blue.chats]),
      [[["[MTG] Blue: Hill Giant now blocks Grizzly Bears."], ["[MTG] Blue: Hill Giant now blocks Grizzly Bears."]],
        [["[MTG] Yellow: Grizzly Bears now blocks Juggernaut."], ["[MTG] Yellow: Grizzly Bears now blocks Juggernaut."]]]);
    ok("notice: printed, never asked (acknowledged, nothing shown)", n.every((x) => Object.values(x.told).every((t) => t.acked && !t.shown)), JSON.stringify(n.map((x) => x.told)));
    const logged = h.effects.filter((e) => e.tts?.t === "gamelog").flatMap((e) => e.tts.lines);
    same("notice: the game log has each change once, not once per defender", logged.filter((l) => /now blocks/.test(l)),
      ["Blue: Hill Giant now blocks Grizzly Bears.", "Yellow: Grizzly Bears now blocks Juggernaut."]);
  });

  // ── agreement: player-2, player-3, player-2 (1) ──
  await run(async (h) => {
    const r = await play(h, FIX.cases.agreement.steps);
    same("agreement: the asks are the report's", seq(r), ["player-2", "player-3", "player-2:1"]);
    const y2 = asks(r)[2];
    same("agreement: Yellow's Agree sends her Bears on the Bears, unchanged", y2.sent, { type: "declareBlockers", assignments: [{ blockerId: "engine-card-31", attackerId: "engine-card-29" }] });
    ok("agreement: her revise round names Blue's Hill Giant on the Juggernaut", (y2.shown?.text || "").includes(`Juggernaut → <color=${BLUE_HEX}>Blue's</color> Hill Giant`), y2.shown?.text);
  });

  // ── no change: player-2, player-3; Blue agrees with nothing of her own ──
  await run(async (h) => {
    const r = await play(h, FIX.cases.noChange.steps);
    same("no change: the asks are the report's", seq(r), ["player-2", "player-3"]);
    same("no change: Blue's round 1 Agree sends no blocks", asks(r)[1].sent, { type: "declareBlockers", assignments: [] });
    ok("no change: Blue sees Yellow's block in round 1", (asks(r)[1].shown?.text || "").includes(`Grizzly Bears → <color=${YELLOW_HEX}>Yellow's</color> Grizzly Bears`), asks(r)[1].shown?.text);
  });

  // ── the cap: rounds 1-4, then the 805.2 notice ──
  await run(async (h) => {
    const r = await play(h, FIX.cases.cap.steps);
    same("cap: the asks are the report's", seq(r), ["player-2", "player-3", "player-2:1", "player-3:2", "player-2:3", "player-3:4"]);
    for (const x of asks(r)) same(`cap: ${x.seat} #${x.ask.promptId} sent as picked`, x.sent, { type: "declareBlockers", assignments: x.want });
    same("cap: a revise round 3 pre-fills the Bears on the Juggernaut", onIds(asks(r)[4].shown), ["engine-card-31|engine-card-30"]);
    const last = r[r.length - 1];
    same("cap: the 805.2 notice reads '<Primary> decides (team leader)', to both", [last.told.Yellow.chats, last.told.Blue.chats], [["[MTG] Yellow decides (team leader)"], ["[MTG] Yellow decides (team leader)"]]);
    ok("cap: a 'no longer blocks' notice is one line too", r.some((x) => x.notice && x.told.Blue.chats.join() === "[MTG] Yellow: Grizzly Bears no longer blocks."), JSON.stringify(r.filter((x) => x.notice).map((x) => x.told.Blue.chats)));
  });

  // ── a refusal: round 1 again, the defender's blocks from before pre-filled ──
  await run(async (h) => {
    const r = await play(h, FIX.cases.refusal.steps);
    same("refusal: the asks are the report's (round 1 again after the refusal)", seq(r), ["player-2", "player-3", "player-2", "player-3"]);
    const refused = r.find((x) => x.notice);
    ok("refusal: the reason is said to both defenders", ["Yellow", "Blue"].every((c) => refused.told[c].chats.some((t) => /Hill Giant must block each combat if able/.test(t))), JSON.stringify(refused.told));
    const y = asks(r)[2];
    same("refusal: round 1 again pre-fills her earlier block", onIds(y.shown), ["engine-card-31|engine-card-29"]);
    same("refusal: and Agree keeps it", y.sent, { type: "declareBlockers", assignments: [{ blockerId: "engine-card-31", attackerId: "engine-card-29" }] });
    same("refusal: round 1 again has the plain title", y.shown?.title, "Block with Blue");
  });

  // ── level 1 (shared life, own turns): the joint block reads the same ──
  await run(async (h) => {
    const r = await play(h, FIX.cases.changeOfMind.steps, { level1: true });
    const [y1, , y2, b2] = asks(r);
    same("level 1: the same titles", [y1.shown?.title, y2.shown?.title], ["Block with Blue", "Blue changed the blocks. Agree or change?"]);
    same("level 1: the same pre-fill and Agree", [optIds(y2.shown)[0], onIds(y2.shown)], ["__agree", ["engine-card-31|engine-card-29"]]);
    same("level 1: Agree sends currentAssignments", b2.sent?.assignments, b2.ask.input.currentAssignments);
  });

  // ── a prompt without the fields: as before ──
  await run(async (h) => {
    const r = await play(h, FIX.cases.freeForAll.steps, { ffa: true });
    const s = asks(r)[0].shown;
    same("free-for-all: the old title", s?.title, "Choose blockers");
    ok("free-for-all: no Agree, no pre-fill, no joint, no timeout answer", !optIds(s).includes("__agree") && !onIds(s).length && s?.joint === undefined && s?.onTimeout === undefined, JSON.stringify(s));
    same("free-for-all: the one option, as before", (s?.options || []).map((o) => o.label), ["Grizzly Bears 2/2 blocks Grizzly Bears 2/2"]);
    same("free-for-all: Done sends the picks", asks(r)[0].sent, { type: "declareBlockers", assignments: [{ blockerId: "engine-card-31", attackerId: "engine-card-29" }] });
  });
  await run(async (h) => {
    // (the same team prompt without the fields, in a Two-Headed Giant game: the level 2 words, no Agree)
    const steps = clone(FIX.cases.changeOfMind.steps.slice(0, 1));
    for (const k of ["title", "reviseRound", "currentAssignments", "teamBlockLines"]) delete steps[0].ask.input[k];
    const r = await play(h, steps);
    const s = asks(r)[0].shown;
    ok("old prompt: the old title and the team's words, no Agree", s?.title === "Choose blockers" && /Your team blocks together/.test(s?.text || "") && !optIds(s).includes("__agree") && s?.joint === undefined, JSON.stringify(s));
    same("old prompt: sent as picked", asks(r)[0].sent, { type: "declareBlockers", assignments: [{ blockerId: "engine-card-31", attackerId: "engine-card-29" }] });
  });

  // ── the helpers ──
  same("teamBlockNotice: a change is said as it is", T.teamBlockNotice("Blue: Centaur Courser no longer blocks."), { kind: "change", line: "Blue: Centaur Courser no longer blocks." });
  same("teamBlockNotice: the cap", T.teamBlockNotice("White decides (team leader)"), { kind: "settle", line: "White decides (team leader)" });
  same("teamBlockNotice: an older engine's cap reads the same", T.teamBlockNotice("White settles the team's blocks (rule 805.2)"), { kind: "settle", line: "White decides (team leader)" });
  same("teamBlockNotice: 'decides' alone is not the cap", [T.teamBlockNotice("White decides"), T.teamBlockNotice("White decides (team leader) to attack")], [null, null]);
  same("teamBlockNotice: any other notice is not one", [T.teamBlockNotice("White picked AI 1"), T.teamBlockNotice("Block declaration invalid: x")], [null, null]);
  same("jointBlock: a prompt without the fields is none", T.jointBlock({ type: "chooseBlockers", attackers: [] }), null);

  console.log(`${failed ? "FAIL" : "PASS"} test_bridge_2hg_team_block: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_bridge_2hg_team_block: ${e.stack}`); process.exit(1); });
