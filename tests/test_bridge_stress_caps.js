// The bridge's caps for a big game (docs/stress-catalog.md, top 10, the bridge's items):
//  1. Number pickers (#1): Forge's "no limit" (2147483647) and any max over 999 offer 0..999 and say 999 is the most
//     the table offers; a real max up to 999 (an X of 40) is offered in full and says nothing; a max of 20 or less is
//     as before. (The harness's own X <= 99 is the engine's, not checked here.)
//  2. Name lists (#11): fewNames names 8, then "... and N more"; the game log's mill, discard, exile-from-graveyard and
//     "puts ... into their hand" lines use it; 8 or fewer read as before.
//  3. The effects hover (#15): past the 3 marks the "+N MORE EFFECTS" box's hover lists 20 texts (stress catalog 2's E,
//     was 8), then "... and N more".
//   node tests/test_bridge_stress_caps.js
// (BRIDGE_PATH=<a copy> loads a copy instead: tools/mutate-stress-caps.js breaks one so a check fails by name.)
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

function setup(h) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: { gameView: { turn: 4, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [], zones: [], players: [{ id: "player-0", manaPool: {} }, { id: "player-1", manaPool: {} }] } }, fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
  return seat;
}
const shown = (h) => h.effects.filter((e) => e.tts?.t === "prompt" && e.tts.promptId != null).map((e) => e.tts);
const TORMENT = { id: "engine-card-40", controllerId: "player-0", identity: { name: "Torment of Hailfire" }, text: "Repeat the following process X times. Each opponent loses 3 life unless that player sacrifices a nonland permanent or discards a card." };
const numberAsk = (id, min, max, title = "Choose a number", card = null) => ({ promptId: id, decidingPlayerId: "player-0", ...(card ? { sourceCard: card, sourceAbilityText: card.text } : {}),
  input: { type: "chooseNumber", min, max, presentation: { title } } });
async function ask(p) {
  const h = harness.load();
  const seat = setup(h);
  h.B.onPrompt(seat, p); await h.flush();
  const got = shown(h).pop();
  harness.restore();
  return got;
}

(async () => {
  // 1. number pickers
  {
    const B = harness.load().B; const cap = B.NUMBER_PICK_MAX; harness.restore();
    ok("number: the table's most is 999", cap === 999, cap);
    const nolimit = await ask(numberAsk(700, 0, 2147483647));
    ok("number: Forge's no limit offers 0 to 999", nolimit?.mode === "number" && nolimit.min === 0 && nolimit.max === 999, JSON.stringify(nolimit));
    ok("number: Forge's no limit says 999 is the most the table offers", /999 is the most the table offers\./.test(nolimit?.text || "") && /999 is the most/.test(nolimit?.note || ""), JSON.stringify(nolimit));
    const x40 = await ask(numberAsk(701, 0, 40, "Choose a value for X", TORMENT));
    ok("number: a real X of 40 is offered in full (it stopped at 20)", x40?.mode === "number" && x40.max === 40, JSON.stringify(x40));
    ok("number: a real X of 40 says nothing of a limit", !/most the table offers/.test(`${x40?.text || ""} ${x40?.note || ""}`), JSON.stringify(x40));
    ok("number: Torment's X keeps its title", x40?.title === "Torment of Hailfire: choose X", x40?.title);
    const big = await ask(numberAsk(702, 0, 1500));
    ok("number: a max of 1500 stops at 999 and says so", big?.max === 999 && /999 is the most/.test(big?.text || ""), JSON.stringify(big));
    const at = await ask(numberAsk(703, 0, 999));
    ok("number: a max of exactly 999 is the real one, nothing said", at?.max === 999 && !/most the table/.test(at?.text || ""), JSON.stringify(at));
    const small = await ask(numberAsk(704, 0, 5, "Choose X"));
    same("number: a small range as before", { mode: small?.mode, min: small?.min, max: small?.max, text: small?.text || "" }, { mode: "number", min: 0, max: 5, text: "" });
    const high = await ask(numberAsk(705, 1200, 2147483647));
    ok("number: a min over 999 is kept (min to min, never below it)", high?.min === 1200 && high.max === 1200, JSON.stringify(high));
  }

  // 2. name lists
  {
    const h = harness.load(); const { fewNames, FEW_NAMES } = h.B; harness.restore();
    const ten = Array.from({ length: 10 }, (_, i) => `Card ${i + 1}`);
    ok("names: FEW_NAMES is 8", FEW_NAMES === 8, FEW_NAMES);
    same("names: 8 read in full", fewNames(ten.slice(0, 8)), ten.slice(0, 8).join(", "));
    same("names: 10 read 8 ... and 2 more", fewNames(ten), `${ten.slice(0, 8).join(", ")} ... and 2 more`);
    same("names: none is empty", fewNames([]), "");
  }
  {
    const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
    const blank = () => ({ turn: 3, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
      zones: ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) });
    const zone = (b, z) => b.zones.find((x) => x.zone === z && x.ownerId === "player-0");
    const put = (b, z, c) => { zone(b, z).cards.push(c); zone(b, z).count = zone(b, z).cards.length; };
    const card = (n) => ({ id: `engine-card-${n}`, identity: { name: `Spell ${n}` }, types: ["Instant"], controllerId: "player-0" });
    const ev = (seq, from, to, n, how) => ({ seq, cardId: `engine-card-${n}`, from, to, ownerId: "player-0", ...(how ? { how } : {}) });
    const between = (before, after, events) => { const h = harness.load(); setup(h); const out = h.B.logEvents(h.B.logSnapshot(before), h.B.logSnapshot(after), after, h.B.engineFacts(events)); harness.restore(); return out; };
    const many = (k) => Array.from({ length: k }, (_, i) => i + 1);
    const names = (k) => many(k).map((n) => `Spell ${n}`);
    // discards: 12 from the hand
    {
      const b0 = blank(), b1 = blank();
      for (const n of many(12)) { put(b0, "hand", card(n)); put(b1, "graveyard", card(n)); }
      const out = between(b0, b1, many(12).map((n) => ev(10 + n, "Hand", "Graveyard", n, "discard")));
      same("log: 12 discards name 8 ... and 4 more", out, [`Blue discards ${names(8).join(", ")} ... and 4 more`]);
      const b2 = blank(), b3 = blank();
      for (const n of many(3)) { put(b2, "hand", card(n)); put(b3, "graveyard", card(n)); }
      same("log: 3 discards as before", between(b2, b3, many(3).map((n) => ev(10 + n, "Hand", "Graveyard", n, "discard"))), [`Blue discards ${names(3).join(", ")}`]);
    }
    // a mill of 30 distinct cards
    {
      const b0 = blank(), b1 = blank();
      zone(b0, "library").count = 60; zone(b1, "library").count = 30;
      for (const n of many(30)) put(b1, "graveyard", card(n));
      const out = between(b0, b1, many(30).map((n) => ev(10 + n, "Library", "Graveyard", n, "mill")));
      same("log: a mill of 30 names 8 ... and 22 more", out, [`Blue mills 30 cards: ${names(8).join(", ")} ... and 22 more`]);
    }
    // 20 cards exiled from a graveyard at once
    {
      const b0 = blank(), b1 = blank();
      for (const n of many(20)) { put(b0, "graveyard", card(n)); put(b1, "exile", card(n)); }
      const out = between(b0, b1, many(20).map((n) => ev(10 + n, "Graveyard", "Exile", n)));
      ok("log: 20 exiled from a graveyard name 8 ... and 12 more", out.length === 1 && out[0].startsWith(`${names(8).join(", ")} ... and 12 more are exiled from Blue's graveyard`), JSON.stringify(out));
    }
  }

  // 3. the effects hover
  {
    const h = harness.load();
    const effects = Array.from({ length: 30 }, (_, i) => ({ id: `effect-${i}`, name: `Effect ${i + 1}`, text: `Text ${i + 1}.`, emblem: false, untilEndOfTurn: false }));
    const marks = h.B._effectMarks({ effects }, { zones: [] });
    const few = h.B._effectMarks({ effects: effects.slice(0, 6) }, { zones: [] });
    harness.restore();
    ok("effects: 3 marks and one +27 MORE EFFECTS box", marks.length === 4 && marks[3].startsWith("+27 MORE EFFECTS\t"), JSON.stringify(marks));
    const tip = (marks[3] || "").split("\t")[1] || "";
    const lines = tip.split("\n");
    ok("effects: the box's hover lists 20 texts, then ... and 7 more", lines.length === 21 && lines[0] === "Effect 4: Text 4." && lines[19] === "Effect 23: Text 23." && lines[20] === "... and 7 more", JSON.stringify(lines));
    const fewTip = (few[3] || "").split("\t")[1] || "";
    ok("effects: 3 in the hover list in full, nothing more said", fewTip.split("\n").length === 3 && !/more$/.test(fewTip), JSON.stringify(few));
  }

  console.log(`${failed ? failed + " failed, " : ""}${failed ? "" : "all "}${passed} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_bridge_stress_caps: ${e.stack}`); process.exit(1); });
