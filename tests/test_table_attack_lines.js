// Planned attack lines on the table (the user 2026-11-16: "add targeting lines used for defenders to show who you're
// targeting before attacks"). tools/engine-renderer.lua: enginePlannedAttacks reads the turn player's open attack
// question's picks, an answered one's held picks and the bridge's plan on the steps after it (p.plan,
// test_bridge_attack_lines.js); engineDrawLines draws each as one solid line like a block line (thickness 0.1651, the user 2026-11-19; before it ten dashes at 0.2601, and before live check 1 five at 0.1201) in a light shade of the
// attacker's seat colour, one per stack and target, until the board has them attacking. The checks:
//  - the attack question open, nothing picked: no planned lines
//  - a creature picked at a player: one solid line, light blue, its end on the player's life counter
//  - the answer's picks stay drawn until the board; the bridge's plan on the "whom?" step splits the token stack per
//    defender (two stacks) with a line each
//  - the board with them attacking: no planned lines, the attack lines instead
//  - a question withdrawn unanswered: its planned lines go
//  - not the turn player's: nothing drawn
//  - the lines are set once per change (no setVectorLines for a redraw that changes nothing)
//   node tests/test_table_attack_lines.js
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
const s1 = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "table-stream-1v1.json"), "utf8"));
const prefix = [{ lua: 'engineChat("mtg start ai 1", Player.Blue)' }, ...s1.slice(0, 40).map((m) => ({ msg: { t: m.t, json: m.json } }))];
const ask = (p, color = "Blue") => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color, ...p }) }, frames: 10 });
const q = (lua, mark) => ({ lua, mark });
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const run = (steps) => simulate({ save, steps: [...prefix, ...steps] });
const valueOf = (r, mark) => String((r.steps.find((s) => s.step === mark) || {}).value);
const fxOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).fx || [];

const C = (n) => `engine-card-${n}`;
const seatOf = (who, color) => `local ${who} for _, p in ipairs(t.players) do if p.color == "${color}" then ${who} = p end end `;
const statics = (from, to, name, pt, ty = "Creature", tok = true) => `for n = ${from}, ${to} do engineStoreStatic("engine-card-" .. n, { n = "${name}", f = "https://img.example/${from}.jpg", ty = { "${ty}" }, tok = ${tok}, p = ${pt}, t = ${pt} }) end `;
// Blue: six Zombie tokens (3001..3006) and Serra Angel (3010); White: a planeswalker (3020). Blue's turn, declare attackers.
const BOARD = (active, attacking = false, extra = "") => q('local t = engineTable() local m = {} for k, v in pairs(t) do m[k] = v end t = m ' + seatOf("blue", "Blue") + seatOf("white", "White") +
  statics(3001, 3006, "Zombie Token", 2) + statics(3010, 3010, "Serra Angel", 4, "Creature", false) + statics(3020, 3020, "Jace Beleren", 0, "Planeswalker", false) +
  'local keep = {} for _, c in ipairs(blue.battlefield) do if tostring(c.id):sub(1, 14) ~= "engine-card-30" then keep[#keep + 1] = c end end blue.battlefield = keep ' +
  `for n = 3001, 3006 do table.insert(blue.battlefield, { s = 1, id = "engine-card-" .. n, ctl = "Blue"${attacking ? ', atk = true, atkT = "White"' : ""} }) end ` +
  `table.insert(blue.battlefield, { s = 1, id = "engine-card-3010", ctl = "Blue"${attacking ? ', atk = true, atkT = "White"' : ""} }) ` +
  'local wk = {} for _, c in ipairs(white.battlefield) do if c.id ~= "engine-card-3020" then wk[#wk + 1] = c end end white.battlefield = wk ' +
  'table.insert(white.battlefield, { s = 1, id = "engine-card-3020", ctl = "White" }) ' +
  `t.active = "${active}" t.priority = "${active}" t.step = "combatDeclareAttackers" ${extra} engineRender(t) __sim.frames(60) return "board"`, `board ${active}${attacking ? " attacking" : ""}`);
const quick = [{ id: "__allattack", label: "All attack" }, { id: "__noattack", label: "No attacks" }];
const ATTACK = (pid) => ask({ promptId: pid, kind: "attack", title: "Choose attackers", mode: "multi", min: 0, max: 8, keepOrder: true,
  options: [...quick, { id: `${C(3010)}|player-1`, label: "Serra Angel 4/4 → AI 1" }, { id: `${C(3010)}|${C(3020)}`, label: "Serra Angel 4/4 → Jace Beleren" },
    ...[3001, 3002, 3003, 3004, 3005, 3006].map((n, k) => ({ id: `${C(n)}|?`, label: `Zombie Token 2/2 #${k + 1} → whom? (asked next)` }))] });
// the bridge's "whom?" step after it (attackWhom), with its plan: the stack split 3 at White, 3 at Jace, the Angel at White
const PLAN = [`${C(3001)}|player-1`, `${C(3002)}|player-1`, `${C(3003)}|player-1`, `${C(3004)}|${C(3020)}`, `${C(3005)}|${C(3020)}`, `${C(3006)}|${C(3020)}`, `${C(3010)}|player-1`].sort();
const WHOM = (pid, color = "Blue") => ask({ promptId: pid, kind: "choice", title: "Attack whom with Grizzly Bears?", mode: "single",
  options: [{ id: "player|player-1", label: "AI 1" }, { id: `card|${C(3020)}`, label: "Jace Beleren" }, { id: "__back", label: "Back" }], plan: PLAN }, color);
// the planned lines: how many lines, and the colours seen
const PLANNED = (mark) => q('local n, col = 0, {} for _, l in ipairs(Global.getVectorLines() or {}) do if math.abs((tonumber(l.thickness) or 0) - 0.1651) < 0.00005 then n = n + 1 ' +
  'col[string.format("%.2f,%.2f,%.2f", l.color[1], l.color[2], l.color[3])] = true end end local cs = {} for k in pairs(col) do cs[#cs + 1] = k end table.sort(cs) return n .. " " .. table.concat(cs, ";")', mark);
const ATTACKS = (mark) => q('local n = 0 for _, l in ipairs(Global.getVectorLines() or {}) do if math.abs((tonumber(l.thickness) or 0) - 0.2201) < 0.00005 then n = n + 1 end end return tostring(n)', mark);
// a planned line ending on White's life counter
const AT_WHITE = (mark) => q('local h = enginePlayerSpot("White") for _, l in ipairs(Global.getVectorLines() or {}) do local e = l.points[#l.points] ' +
  'if math.abs((tonumber(l.thickness) or 0) - 0.1651) < 0.00005 and math.abs(e[1] - h.x) < 0.01 and math.abs(e[3] - h.z) < 0.01 then return "yes" end end return "no"', mark);
const objs = (from, to, mark) => q(`local n, shown = 0, {} for _, x in ipairs(getObjects()) do local id = tostring(x.getGMNotes()):match("^engine:engine%-card%-(%d+)$") ` +
  `if id ~= nil and tonumber(id) >= ${from} and tonumber(id) <= ${to} then n = n + 1 shown[#shown + 1] = tostring(engineGroupShown["engine-card-" .. id] or 1) end end ` +
  'table.sort(shown) return n .. ":" .. table.concat(shown, ",")', mark);
const LIGHT_BLUE = "0.34,0.65,1.00"; // (Blue a quarter towards white, live check 1; it was halfway, 0.56,0.77,1.00)
const sets = (r, mark) => fxOf(r, mark).filter((l) => /setVectorLines/.test(l)).length;

{
  const r = run([BOARD("Blue"), objs(3001, 3006, "one stack"), ATTACK(2001), PLANNED("open"),
    q('enginePick("Blue", 3) enginePhase2Prompt("Blue") return "picked"', "pick"), { frames: 10 }, PLANNED("picked"), AT_WHITE("at white"),
    q('enginePhase2Prompt("Blue") return "again"', "redraw same"),
    q('engineConfirm("Blue") return "answered"', "answer"), { frames: 30 }, PLANNED("held"),
    WHOM(2002), { frames: 60 }, PLANNED("plan"), objs(3001, 3006, "plan stacks"),
    { msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", promptId: null }) }, frames: 10 },
    BOARD("Blue", true), PLANNED("declared"), ATTACKS("attack lines")]);
  ok("precondition: no errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("precondition: the six Zombies are one stack", valueOf(r, "one stack") === "1:6", valueOf(r, "one stack"));
  ok("open: the attack question with nothing picked draws no planned line", valueOf(r, "open").startsWith("0"), valueOf(r, "open"));
  ok("picked: a creature picked at a player is one solid line, light blue", valueOf(r, "picked") === `1 ${LIGHT_BLUE}`, valueOf(r, "picked"));
  ok("picked: its end is on the player's life counter", valueOf(r, "at white") === "yes", valueOf(r, "at white"));
  ok("cheap: a redraw that changes nothing sets no lines", sets(r, "redraw same") === 0, sets(r, "redraw same"));
  ok("held: the answer's pick stays drawn until the board", valueOf(r, "held") === `1 ${LIGHT_BLUE}`, valueOf(r, "held"));
  ok("plan: the bridge's plan on the whom? step: the stack split in two, a line each, and the Angel's (3 lines)", valueOf(r, "plan") === `3 ${LIGHT_BLUE}`, valueOf(r, "plan"));
  ok("plan: the split stack is drawn as one stack per defender, with its count", valueOf(r, "plan stacks") === "2:3,3", valueOf(r, "plan stacks"));
  ok("declared: the board with them attacking has no planned lines", valueOf(r, "declared").startsWith("0"), valueOf(r, "declared"));
  ok("declared: the attack lines instead", Number(valueOf(r, "attack lines")) > 0, valueOf(r, "attack lines"));
}
{
  const r = run([BOARD("Blue"), ATTACK(2101), q('enginePick("Blue", 4) enginePhase2Prompt("Blue") return "picked"', "pick"), { frames: 10 }, PLANNED("picked pw"),
    { msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", promptId: null }) }, frames: 10, mark: "withdrawn" }, PLANNED("after withdraw"),
    WHOM(2102), { frames: 30 }, PLANNED("plan again"), q('enginePrompts.Blue = nil engineExitPrompt("Blue") return "exit"', "exit"), { frames: 10 }, PLANNED("after exit")]);
  ok("precondition: no errors (withdraw)", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("planeswalker: a creature picked at a planeswalker is drawn too", valueOf(r, "picked pw").startsWith("1 "), valueOf(r, "picked pw"));
  ok("withdrawn: a question withdrawn unanswered takes its planned lines", valueOf(r, "after withdraw").startsWith("0"), valueOf(r, "after withdraw"));
  ok("withdrawn: a plan step's lines go with it too", valueOf(r, "plan again").startsWith("3 ") && valueOf(r, "after exit").startsWith("0"), `${valueOf(r, "plan again")} / ${valueOf(r, "after exit")}`);
}
{
  const r = run([BOARD("White"), WHOM(2201), { frames: 30 }, PLANNED("not turn")]);
  ok("precondition: no errors (not the turn player)", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("turn: a plan from a player whose turn it isn't draws nothing", valueOf(r, "not turn").startsWith("0"), valueOf(r, "not turn"));
}
{
  // (a shared turn: White's turn, Blue White's partner; Blue's own question's plan is drawn)
  const r = run([BOARD("White", false, 't.activeTeam = { "White", "Blue" } t.teams = { sides = { { "White", "Blue" } } }'), WHOM(2401), { frames: 30 }, PLANNED("partner")]);
  ok("precondition: no errors (shared turn)", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("partner: in a shared turn the turn player's partner's plan is drawn", valueOf(r, "partner").startsWith("3 "), valueOf(r, "partner"));
}
{
  // (Mindslaver: Blue's seat answers White's attack question, forColor White; the lines are White's, in White's shade)
  const r = run([BOARD("White"), ask({ promptId: 2301, kind: "choice", title: "Attack whom with Serra Angel?", mode: "single", forColor: "White",
    options: [{ id: "player|player-0", label: "Blue" }, { id: "__back", label: "Back" }], plan: [`${C(3010)}|player-0`] }), { frames: 30 }, PLANNED("for white")]);
  ok("precondition: no errors (answering for another player)", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("for another: a question answered for the turn player draws their plan, in their colour", valueOf(r, "for white") === "1 1.00,1.00,1.00", valueOf(r, "for white"));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
