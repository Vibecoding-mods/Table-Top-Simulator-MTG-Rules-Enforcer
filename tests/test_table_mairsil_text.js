// The Mairsil hand test's table text bugs (docs/HAND-TEST-MAIRSIL.md, "Text and log", 2026-11-18), on the fake TTS:
//   #3  clicking another player's card that the open question offers (a target) answered it, and its pick-up half also
//       printed "[MTG] You can only touch your own cards."; a card the question doesn't offer still says it
//   #23 the Engine panel's status line named the turn by seat colour ("Red's 4th turn") while the top bar said "AI 1'S
//       TURN": it names players as the top bar does
//   node tests/test_table_mairsil_text.js        (TABLE_SAVE=<save.json> to test a given save)
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
const s1 = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "table-stream-1v1.json"), "utf8"));
const prefix = [{ lua: 'engineChat("mtg start ai 1", Player.Blue)' }, ...s1.slice(0, 40).map((m) => ({ msg: { t: m.t, json: m.json } }))];
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const q = (lua, mark) => ({ lua, mark });

const GIANT = { id: "engine-card-9822", n: "Hill Giant", ty: ["Creature"], tx: "", tl: "Creature", cmc: 4, ctl: "White", p: 3, t: 3 };
const BEAR = { id: "engine-card-9823", n: "Grizzly Bears", ty: ["Creature"], tx: "", tl: "Creature", cmc: 2, ctl: "White", p: 2, t: 2 };
const MINE = { id: "engine-card-9824", n: "Savannah Lions", ty: ["Creature"], tx: "", tl: "Creature", cmc: 1, ctl: "Blue", p: 2, t: 1 };
const base = JSON.parse(s1[38].json);
const board = (edit) => {
  const b = JSON.parse(JSON.stringify(base));
  for (const p of b.players) if (p.color === "White") { p.battlefield = [GIANT, BEAR]; p.keep = ["hand", "graveyard", "exile", "command"]; }
  for (const p of b.players) if (p.color === "Blue") { p.battlefield = [MINE]; p.keep = ["hand", "graveyard", "exile", "command"]; }
  if (edit) edit(b);
  return { msg: { t: "table", json: JSON.stringify(b) }, frames: 6 };
};
// a target question for Blue offering White's Hill Giant only
const PROMPT = { t: "prompt", color: "Blue", promptId: 9901, title: "Murder: destroy which creature?", mode: "single", kind: "target", min: 1, max: 1,
  options: [{ id: `card|${GIANT.id}`, label: "Hill Giant 3/3" }, { id: `card|${MINE.id}`, label: "Savannah Lions 2/1" }] };
// Blue picks a card up alone (no click before it): what onPlayerAction returns
const pickUp = (cid, mark) => q(`for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${cid}" then return tostring(onPlayerAction(Player.Blue, Player.Action.PickUp, { x })) end end return "none"`, mark);
// one click as TTS sends it, a select then a pick-up: what the pick-up returns, and the answer the select sent
const click = (cid, mark) => q(`local real = engineSend local sent = "none" engineSend = function(t, p) if t == "answer" then sent = JSON.encode(p) end return real(t, p) end
  local out = "none" for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${cid}" then onPlayerAction(Player.Blue, Player.Action.Select, { x }) out = tostring(onPlayerAction(Player.Blue, Player.Action.PickUp, { x })) end end
  engineSend = real return out .. " " .. sent`, mark);
// the same with another action on the card: what onPlayerAction returns
const act = (cid, action, mark) => q(`for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${cid}" then return tostring(onPlayerAction(Player.Blue, Player.Action.${action}, { x })) end end return "none"`, mark);
const glows = (cid, mark) => q(`for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${cid}" then return tostring((engineGlowing.Blue or {})[x] == true) end end return "none"`, mark);
const status = (mark) => q('return tostring(UI.getValue("eng_status_Blue"))', mark);

const r = simulate({ save, seated: ["Blue"], steps: [...prefix,
  board(), { frames: 4 },
  { msg: { t: "prompt", json: JSON.stringify(PROMPT) }, frames: 6 },
  glows(GIANT.id, "giant glows"),
  click(GIANT.id, "click the offered card"),
  pickUp(BEAR.id, "pick up a card not offered"),
  // (what is told the same twice within 3 s is told once: time passes between the ones that are told)
  { frames: 400 },
  { msg: { t: "prompt", json: JSON.stringify({ ...PROMPT, promptId: 9902 }) }, frames: 6 },
  pickUp(GIANT.id, "pick up a glowing card alone"),
  pickUp(MINE.id, "pick up my glowing card"),
  act(GIANT.id, "Rotate", "rotate a glowing card"),
  { frames: 400 },
  act(MINE.id, "Rotate", "rotate my glowing card"),
  board((b) => { b.active = "White"; b.priority = "White"; b.activeTurnNo = 4; }), { frames: 4 },
  status("status on AI 1's turn"),
] });
const v = (mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const told = (mark) => ((r.steps.find((s) => s.step === mark) || {}).fx || []).filter((l) => l.includes("broadcastToColor")).join(" | ");

ok("no script errors", r.errors.length === 0, r.errors.join(" | "));
ok("precondition: the offered card glows for Blue", v("giant glows") === "true", v("giant glows"));
const clicked = String(v("click the offered card"));
ok("#3 precondition: a click (select, then pick-up) on another player's offered card answers the question", /^false .*9901/.test(clicked) && clicked.includes(GIANT.id), clicked);
ok("#3 a click on another player's card the question offers: its pick-up half refused without a word", !/only touch your own cards/.test(told("click the offered card")), told("click the offered card"));
ok("#3 another player's card the question doesn't offer: still told", v("pick up a card not offered") === "false" && /You can only touch your own cards/.test(told("pick up a card not offered")),
  `${v("pick up a card not offered")} | ${told("pick up a card not offered")}`);
// (a glowing card is offered whole: a pick-up of it, alone, is the question's own; any other action on it, or on a card of Blue's own, is the usual rule)
ok("#3 a card the question offers, picked up alone: refused without a word", v("pick up a glowing card alone") === "false" && told("pick up a glowing card alone") === "", `${v("pick up a glowing card alone")} | ${told("pick up a glowing card alone")}`);
ok("#3 a card the question offers, rotated: still told it isn't Blue's", v("rotate a glowing card") === "false" && /You can only touch your own cards/.test(told("rotate a glowing card")), `${v("rotate a glowing card")} | ${told("rotate a glowing card")}`);
ok("#3 Blue's own card the question offers: picked up as always", v("pick up my glowing card") === "true" && told("pick up my glowing card") === "", `${v("pick up my glowing card")} | ${told("pick up my glowing card")}`);
ok("#3 Blue's own card the question offers: rotating is still the engine's", v("rotate my glowing card") === "false" && /The engine handles that/.test(told("rotate my glowing card")), `${v("rotate my glowing card")} | ${told("rotate my glowing card")}`);
const st = String(v("status on AI 1's turn"));
ok("#23 the status line names the AI's turn and priority as the top bar does", /^AI 1's 4th turn \(game turn \d+\) - [^\n]* - priority: AI 1/.test(st) && !/White's 4th turn/.test(st), st);

console.log(failed ? `\n${failed} failed, ${passed} passed` : `all ${passed} Mairsil table checks pass`);
process.exit(failed ? 1 : 0);
