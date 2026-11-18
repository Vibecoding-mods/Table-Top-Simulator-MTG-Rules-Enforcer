// The prompt shapes the ability sweep never drove end to end (docs/handoff/prompt-shapes-report.md), each a question the
// real engine asked: tools/prompt-shapes-probe.js played the cards on the harness (three people, White's questions
// through the real bridge) and kept each question with White's view of the board (tests/golden/fixtures/prompt-shapes.json,
// a library's cards left out). Per question: what the table shows (the title and the options, pinned to the live text)
// and that the table's answer reaches the engine as it did in the probe.
//   ChooseNumber (Menacing Ogre), GenericChoice and an unless cost an opponent pays (Remorseless Punishment), ChoosePlayer
//   (Black Vise), Fortify (Darksteel Garrison), Reconfigure (Lizard Blades), Bestow (Boon Satyr), ChooseColor (Painter's
//   Servant), ChooseType (Cavern of Souls), ChooseCardName (Pithing Needle), vote (Council's Judgment), a Charm on a dies
//   trigger (Vindictive Lich), a tempting offer's search (Tempt with Discovery).
// Fixed here: Black Vise's opponent read "choose one"; Remorseless Punishment's "pay Discard two cards?"; Pithing
// Needle's "Name a card".
//   node tests/test_bridge_prompt_shapes.js
const harness = require("./bridge-harness");
const SHAPES = require("./golden/fixtures/prompt-shapes.json");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

function setup(h) {
  const seat = new h.B.Seat("White", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.respond = function respond(promptId, type, output) { this.sentOut = { type, output }; };
  h.B._setGame({ seats: new Map([["White", seat]]), bots: 2, total: 3, playerOrder: ["tts-White-002k", "self-hosted-node-77-bot", "self-hosted-node-77-bot 2"],
    slotNames: { "player-0": "White", "player-1": "AI 1", "player-2": "AI 2" }, slotColor: { "player-0": "White", "player-1": "Red", "player-2": "Yellow" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: 10 });
  return seat;
}
// the question as the table shows it, and the bridge's answer to the options at these indexes
function ask(rec, picks) {
  const h = harness.load();
  try {
    const seat = setup(h);
    seat.board = { state: { gameView: rec.view }, fingerprint: null };
    h.B.onPrompt(seat, JSON.parse(JSON.stringify(rec.prompt)));
    const ui = seat.prompt?.ui;
    const shown = ui ? { title: ui.title, options: (ui.options || []).map((o) => o.label), mode: ui.mode } : null;
    let sent = null;
    if (ui && picks) {
      const choice = ui.mode === "number" ? picks.map(String) : picks.map((i) => ui.options[i].id);
      h.B.onTTS({ t: "answer", color: "White", promptId: seat.prompt.promptId, choice });
      sent = seat.sentOut || null;
    }
    return { shown, sent };
  } finally { harness.restore(); }
}
const rec = (shape, type, title = "") => SHAPES.find((r) => r.shape.startsWith(shape) && r.type === type && String(r.prompt.input?.presentation?.title || "").includes(title));

// [shape, engine type, title, options (null: not pinned, a count instead), the answer's indexes (or a number)]
const CASES = [
  ["ChooseNumber", "chooseNumber", "Menacing Ogre: choose a number", [], [3]],
  ["GenericChoice", "chooseFromSelection", "Remorseless Punishment: choose one",
    ["you lose 5 life unless you discard two cards.", "you lose 5 life unless you sacrifice a creature or planeswalker."], [0]],
  ["GenericChoice", "chooseBoolean", "Remorseless Punishment: discard two cards?", ["Discard two cards", "No: lose 5 life"], [0]],
  ["GenericChoice", "chooseCards", "Remorseless Punishment: discard which cards? (choose 2)", { count: 10 }, [0, 1]],
  ["ChoosePlayer", "chooseFromSelection", "Black Vise: choose an opponent", ["AI 1", "AI 2"], [0]],
  ["Fortify", "chooseBoardTargets", "Darksteel Garrison: attach to which land you control?", ["Plains #1", "Plains #2", "Plains #3", "Plains #4", "Plains #5"], [0]],
  ["Reconfigure", "chooseBoardTargets", "Lizard Blades: choose a target to attach it to", ["Grizzly Bears"], [0]],
  ["Bestow", "chooseBoardTargets", "Boon Satyr: choose a target to attach it to", ["Grizzly Bears"], [0]],
  ["ChooseColor", "chooseColor", "Painter's Servant: choose a color", ["White", "Blue", "Black", "Red", "Green"], [0]],
  ["ChooseType", "chooseFromSelection", "Cavern of Souls: choose a creature type", { count: null, first: "Advisor" }, [0]],
  ["ChooseCardName", "chooseFromSelection", "Pithing Needle: name a card", ["Island", "Llanowar Elves", "Mountain", "Pithing Needle", "Plains"], [0]],
  ["Vote", "chooseFromSelection", "Council's Judgment: vote for which nonland permanent you don't control?", ["Grizzly Bears", "Hill Giant"], [0]],
  ["Charm on a trigger", "chooseFromSelection", "Vindictive Lich: choose 1 to 2",
    ["Target opponent discards two cards.", "Target opponent loses 5 life.", "Target opponent sacrifices a creature."], [0]],
  ["Charm on a trigger", "chooseBoardTargets", "Vindictive Lich: choose a player to discard", ["AI 1", "AI 2"], [0], "discard"],
  ["Tempting offer", "chooseCards", "Tempt with Discovery: search your library for which land card?", { count: null, first: "Forest" }, [0]],
];

for (const [shape, type, title, options, picks, engineTitle = ""] of CASES) {
  const r = rec(shape, type, engineTitle);
  if (!r) { ok(`${shape} ${type}: in the fixture`, false, "no such question recorded"); continue; }
  const { shown, sent } = ask(r, picks);
  same(`${shape} ${type}: the title`, shown?.title, title);
  if (Array.isArray(options)) same(`${shape} ${type}: the options`, shown?.options, options);
  else {
    if (options.count != null) same(`${shape} ${type}: the options' count`, shown?.options?.length, options.count);
    if (options.first) same(`${shape} ${type}: the first option`, shown?.options?.[0], options.first);
  }
  ok(`${shape} ${type}: no raw id shown`, !/engine-card-\d|player-\d|prompt-action-|self-hosted-node|tts-\w+-/.test(JSON.stringify(shown)), JSON.stringify(shown).slice(0, 300));
  // the answer the table gives reaches the engine as the probe's did (the same options, so the same output)
  same(`${shape} ${type}: the answer sent`, sent, r.sent);
}

// a list of players only, without the engine's "Choose ..." description: "which opponent", or "which player" when the
// chooser is one of them
{
  const r = rec("ChoosePlayer", "chooseFromSelection");
  const bare = JSON.parse(JSON.stringify(r));
  delete bare.prompt.input.presentation.description;
  same("ChoosePlayer, no description: which opponent", ask(bare, null).shown?.title, "Black Vise: choose which opponent?");
  bare.prompt.input.options = [{ label: "tts-White-002k" }, ...bare.prompt.input.options];
  const { shown } = ask(bare, null);
  same("ChoosePlayer, no description, the chooser among them: which player", [shown?.title, [...(shown?.options || [])].sort()], ["Black Vise: choose which player?", ["AI 1", "AI 2", "White"]]);
}

process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} prompt shape checks pass\n`);
process.exit(failed ? 1 : 0);
