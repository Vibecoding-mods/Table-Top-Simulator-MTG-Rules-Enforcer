// Two-Headed Giant's joint team block on the table (CR 805.10d and 805.2; tools/engine-renderer.lua engineOnPrompt's
// pre-fill and panel, engineJointUnchanged, the corner's Agree, engineTeamDeclaring; docs/game-modes-spec.md §5.12): the
// prompts the bridge makes from tests/golden/fixtures/2hg-team-block.json (tests/bridge-harness.js) played on the fake
// TTS (tests/lua/tts-sim.lua) with all four seats taken. Checked: the panel opens with the engine's title and the
// team's block line by line (the partner's name in their colour), the defender's own blocks are picked already, the
// corner's big button is Agree until a pick changes and Done after, Agree sends the Agree answer in one click, a change
// sends the new picks, the partner's corner says "Waiting for <partner>..." meanwhile, and a prompt without the fields
// is as before. Also: Two-Headed Giant's default is shared team turns.
//   node tests/test_table_2hg_team_block.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");
const harness = require("./bridge-harness");
const FIX = require("./golden/fixtures/2hg-team-block.json");
const L2 = require("./golden/fixtures/2hg-level2-protocol.json");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };
const clone = (x) => JSON.parse(JSON.stringify(x));
const SLOTS = { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" };

// What the bridge sends the table for the change-of-mind case: the board in the declare blockers step, and each ask's
// prompt message by its promptId (the old shape too: the first ask without the team fields, as 399)
async function bridgeMessages() {
  const h = harness.load();
  try {
    const seats = new Map();
    for (const [slot, color] of Object.entries(SLOTS)) {
      const s = new h.B.Seat(color, "neheb_minotaur_commander");
      s.slot = slot;
      s.heartbeat = () => {};
      seats.set(slot, s);
    }
    h.B._setGame({ seats: new Map([...seats.values()].map((s) => [s.color, s])), bots: 0, total: 4, playerOrder: [...seats.values()].map((s) => s.username),
      slotNames: { ...SLOTS }, slotColor: { ...SLOTS }, started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {},
      teams: { White: 1, Red: 1, Yellow: 2, Blue: 2 }, teamMode: "2hg", teamTurns: "shared" });
    const named = (x) => JSON.parse(JSON.stringify(x).replace(/\{(White|Red|Yellow|Blue)\}/g, (m, c) => [...seats.values()].find((s) => s.color === c).username));
    const board = clone(L2.record[62].board);
    board.gameView.step = "combatDeclareBlockers";
    for (const s of seats.values()) s.board = { state: clone(board), fingerprint: null };
    let n0 = h.effects.length;
    h.B.sendTable(); await h.flush();
    const table = h.effects.slice(n0).filter((e) => e.tts?.t === "table").map((e) => e.tts).pop();
    const prompts = {};
    const old = clone(FIX.cases.changeOfMind.steps[0]);
    for (const k of ["title", "reviseRound", "currentAssignments", "teamBlockLines"]) delete old.ask.input[k];
    old.ask.promptId = 399;
    for (const st of [...FIX.cases.changeOfMind.steps.filter((x) => x.ask), old]) {
      const seat = seats.get(st.ask.decidingPlayerId);
      n0 = h.effects.length;
      h.B.onPrompt(seat, named(st.ask)); await h.flush();
      prompts[st.ask.promptId] = h.effects.slice(n0).filter((e) => e.tts?.t === "prompt").map((e) => e.tts).pop();
      seat.prompt = null;
    }
    return { table, prompts };
  } finally { harness.restore(); }
}

const STARTED = JSON.stringify({ t: "started", colors: { ...SLOTS }, names: { ...SLOTS }, ai: [] });
const q = (code, mark, frames) => ({ lua: code, mark, ...(frames != null ? { frames } : {}) });
const valueOf = (r, mark) => r.steps.find((s) => s.step === mark)?.value;
const fxOf = (r, mark) => r.steps.find((s) => s.step === mark)?.fx || [];
const sentOf = (r, mark) => fxOf(r, mark).filter((l) => l.includes("WebRequest")).join(" ").split("\\").join("");
const sim = (steps) => simulate({ save, seated: ["White", "Red", "Yellow", "Blue"], host: "White", steps });
const prompt = (m) => ({ msg: { t: "prompt", json: JSON.stringify(m) }, frames: 10 });
// the panel and corner of a colour: panel open | title | text | corner's big button | its hint line
const look = (c) => `local a = function(id, k) return tostring(UI.getAttribute(id, k)) end return table.concat({ a("eng_panel_${c}", "active"), tostring(UI.getValue("eng_title_${c}")), `
  + `tostring(UI.getValue("eng_text_${c}")), tostring((engineCorner.${c} or {}).bigLabel), tostring(UI.getValue("eng_hint_${c}")) }, " ## ")`;
const parts = (r, mark) => String(valueOf(r, mark)).split(" ## ");
// the option index of an option id in a colour's open prompt, and whether it is picked
const picked = (c, id) => `local p = enginePrompts.${c} for i, o in ipairs(p.options) do if o.id == ${JSON.stringify(id)} then return tostring(engineSelectedFor("${c}", i)) end end return "none"`;
const pickId = (c, id) => `local p = enginePrompts.${c} for i, o in ipairs(p.options) do if o.id == ${JSON.stringify(id)} then enginePick("${c}", i) end end return "ok"`;

(async () => {
  const { table, prompts } = await bridgeMessages();
  ok("precondition: the bridge made the joint prompts", prompts[301]?.joint === 0 && prompts[303]?.joint === 1 && prompts[399] && prompts[399].joint === undefined, JSON.stringify(Object.keys(prompts)));
  const y2 = prompts[303];
  const steps = [
    q("engineAutoPace.White = false engineAutoPace.Red = false engineAutoPace.Yellow = false engineAutoPace.Blue = false return 'ok'", "prelude"),
    { msg: { t: "started", json: STARTED } },
    { msg: { t: "table", json: JSON.stringify(table) }, frames: 30 },
    prompt(y2),
    q(look("Yellow"), "revise"),
    q(picked("Yellow", "engine-card-31|engine-card-29"), "prefilled"),
    q(picked("Yellow", "engine-card-31|engine-card-30"), "not prefilled"),
    q('engineUpdateCorner("Blue", nil) return tostring(UI.getValue("eng_hint_Blue"))', "blue waits"),
    q('engineCornerPress("Yellow", "big") return "pressed"', "agree", 5),
    // (the same ask again, changed: the Bears moved to the Juggernaut, then Done)
    prompt({ ...y2, promptId: 305 }),
    q(pickId("Yellow", "engine-card-31|engine-card-30"), "change"),
    q(look("Yellow"), "changed"),
    q(picked("Yellow", "engine-card-31|engine-card-29"), "old pick dropped"),
    q('engineCornerPress("Yellow", "big") return "pressed"', "done", 5),
    // (a change taken back: Agree again)
    prompt({ ...y2, promptId: 306 }),
    q(pickId("Yellow", "engine-card-31|engine-card-30"), "back 1"),
    q(pickId("Yellow", "engine-card-31|engine-card-29"), "back 2"),
    q('return tostring((engineCorner.Yellow or {}).bigLabel)', "back"),
    q('enginePrompts.Yellow = nil engineOnPrompt({ t = "prompt", color = "Yellow" }) return "closed"', "close"),
    // (a round 1 ask: the panel too, nothing picked yet, Agree)
    prompt(prompts[301]),
    q(look("Yellow"), "round 1"),
    q('enginePrompts.Yellow = nil engineOnPrompt({ t = "prompt", color = "Yellow" }) return "closed"', "close 2"),
    // (the old prompt: as before)
    prompt(prompts[399]),
    q(look("Yellow"), "old"),
    q('engineUpdateCorner("Blue", nil) return tostring(UI.getValue("eng_hint_Blue"))', "blue old"),
  ];
  const r = sim(steps);
  ok("no errors", !r.errors.length, r.errors.join(" | "));
  const rv = parts(r, "revise");
  ok("panel: a joint block opens the panel", rv[0] === "true", rv.join(" | "));
  ok("panel: the engine's title", rv[1] === "Blue changed the blocks. Agree or change?", rv[1]);
  ok("panel: the team's block line by line, Blue's name in her colour", rv[2]?.includes("The team's block:\nGrizzly Bears → your Grizzly Bears + <color=#4DA3FF>Blue's</color> Hill Giant\nJuggernaut → not blocked"), rv[2]);
  ok("pre-fill: her own block is picked already", valueOf(r, "prefilled") === "true" && valueOf(r, "not prefilled") === "false", `${valueOf(r, "prefilled")} ${valueOf(r, "not prefilled")}`);
  ok("corner: the big button is Agree while nothing changed", rv[3] === "Agree", rv[3]);
  ok("corner: the hint says agree or change", /^Blue changed the blocks\. Agree or change\?\nAgree, or change: your creature, then the attacker it blocks, then Done\./.test(rv[4] || ""), rv[4]);
  ok("waiting: the partner's corner says Waiting for Yellow", valueOf(r, "blue waits") === "Waiting for PlayerYellow...", valueOf(r, "blue waits"));
  const agreeSent = sentOf(r, "agree");
  ok("agree: one click sends Agree", /"promptId":303/.test(agreeSent) && /"choice":\["__agree"\]/.test(agreeSent), agreeSent.slice(0, 400));
  const ch = parts(r, "changed");
  ok("change: a changed pick makes the big button Done", ch[3] === "Done", ch[3]);
  ok("change: picking another attacker for the same creature drops the pre-filled one", valueOf(r, "old pick dropped") === "false", valueOf(r, "old pick dropped"));
  const doneSent = sentOf(r, "done");
  ok("change: Done sends the new block", /"promptId":305/.test(doneSent) && /"choice":\["engine-card-31\|engine-card-30"\]/.test(doneSent), doneSent.slice(0, 400));
  ok("change: taken back, the big button is Agree again", valueOf(r, "back") === "Agree", valueOf(r, "back"));
  const r1 = parts(r, "round 1");
  ok("round 1: the panel with 'Block with Blue' and Agree", r1[0] === "true" && r1[1] === "Block with Blue" && r1[3] === "Agree", r1.join(" | "));
  const old = parts(r, "old");
  ok("old prompt: the old title, the panel not forced open, Done", old[1] === "Choose blockers" && old[0] !== "true" && old[3] === "Done", old.join(" | "));
  ok("old prompt: the partner's line is the Level 2 one, not Waiting", valueOf(r, "blue old") === "PlayerYellow is declaring blockers for your team...", valueOf(r, "blue old"));

  // ── Two-Headed Giant's default: each player's own turn (Level 1) until Level 2 is checked live ──
  const d = sim([
    q('return tostring(ENGINE_TEAM_TURNS)', "default"),
    q('engineChat("mtg mode 2hg", Player.White) engineStartSentAt = nil engineChat("mtg start", Player.White) return engineTeamsLabel()', "start", 10),
  ]);
  ok("default: no errors", !d.errors.length, d.errors.join(" | "));
  ok("default: Two-Headed Giant is each player's own turn", valueOf(d, "default") === "nil", valueOf(d, "default"));
  ok("default: its Start sends no teamTurns without a command", /teamMode/.test(sentOf(d, "start")) && !/teamTurns/.test(sentOf(d, "start")) && valueOf(d, "start") === "Teams\n2HG", `${valueOf(d, "start")} ${sentOf(d, "start").slice(0, 300)}`);
  ok("default: the mode's help says each player takes their own turn", fxOf(d, "start").some((l) => /each player takes their own turn\..*mtg 2hg turns shared/.test(l)), fxOf(d, "start").join(" ").slice(0, 400));

  console.log(`${failed ? "FAIL" : "PASS"} test_table_2hg_team_block: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_table_2hg_team_block: ${e.stack}`); process.exit(1); });
