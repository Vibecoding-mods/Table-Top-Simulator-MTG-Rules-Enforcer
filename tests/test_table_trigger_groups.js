// Triggers alike grouped on the table (the owner, 2026-11-15: "if 20 pop up at once, cut it down to 2"; the bridge's
// stackGroups sends a run of one trigger as one stack item, x its count and srcs its other sources).
// tools/engine-renderer.lua, on the fake TTS:
//  - the pop-up: one for the run, "Soul Warden ×18 - Blue"; the run resolving from the top keeps its id, and the pop-up
//    says the new count with no new pop-up
//  - sources on the table: each glows, no stack card is spawned
//  - sources off the table: one stack card for the run, "On the stack (×3)" and its "x3" badge; one, not three
//  - tokens folded into a token stack (ENGINE_GROUP_MIN or more alike): their triggers light the token stack's card,
//    no stack card each (Second Harvest's 112 tokens: a stack card a trigger before)
//  - the status line's stack list names the run once, counted
//  - a token stack of a pile the engine stopped counting (inf, docs/big-turns-2-spec.md 1.6): "x∞" with a tooltip that
//    says so; one member with inf is enough; the same stack without inf keeps its count; inf doesn't split a stack
//   node tests/test_table_trigger_groups.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };

const SW = "Whenever another creature enters, you gain 1 life.";
const cards = {};
const card = (id, name, ty) => { cards[id] = { n: name, f: "https://example.invalid/" + id + ".jpg", b: "", tl: ty.join(" "), ty }; return id; };
const wardens = ["sw1", "sw2", "sw3"].map((id) => card(id, "Soul Warden", ["Creature"]));
const goblins = Array.from({ length: 6 }, (_, k) => card(`gob${k + 1}`, "Goblin", ["Creature"]));
card("bl1", "Island", ["Land"]);
// the bridge's table message: Blue's battlefield, White's empty, the stack given (inf on the ids in infinite)
let infinite = new Set();
function board(bf, stack) {
  const pl = (color, slot, ids) => ({
    color, slot, name: color, ai: color === "White", life: 40, status: "playing", pool: {}, poison: 0, energy: 0, cmdDamage: {}, tax: [0], library: 50, handCount: 0,
    hand: color === "Blue" ? [] : null, graveyard: [], exile: [], command: [],
    battlefield: ids.map((id) => ({ s: 1, id, ctl: color, p: "1", t: "1", dmg: 0, ctr: {}, ...(/^gob/.test(id) ? { tok: true } : {}), ...(infinite.has(id) ? { inf: true } : {}) })),
  });
  return JSON.stringify({ t: "table", turn: 3, step: "main1", active: "Blue", activeTurnNo: 2, priority: "Blue", gameOver: false, winner: null,
    players: [pl("Blue", "player-0", bf), pl("White", "player-1", [])], stack, cards });
}
// a run of one trigger as stackGroups sends it
const run = (id, src, x, srcs, n = "Soul Warden", tx = SW) => ({ id, n, tx, ctl: "Blue", src, spell: false, tg: [], f: "https://example.invalid/sw1.jpg", ...(x > 1 ? { x } : {}), ...(srcs ? { srcs } : {}) });
const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "Blue", "player-1": "White" }, names: { "player-0": "Blue", "player-1": "AI 1" }, ai: ["White"] });
const PRELUDE = 'engineAutoPace.Blue = false engineChat("mtg start ai 1", Player.Blue) return "ok"';
const send = (bf, stack, mark) => ({ msg: { t: "table", json: board(bf, stack) }, frames: 60, ...(mark ? { mark } : {}) });
// the pop-up's line and the status line as the board's step set them (the fake TTS records UI.setValue)
const fxOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).fx || [];
const setTo = (r, mark, id) => fxOf(r, mark).filter((l) => l.includes(`"${id}"`) && /setValue/.test(l));
const q = (lua, mark) => ({ lua, mark });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const sim = (steps) => simulate({ save, steps: [q(PRELUDE, "prelude"), { msg: { t: "started", json: STARTED } }, ...steps] });
// what the table shows: the pop-up's line and token, the stack cards (name, badge), the glows, the status line
const LOOK = (mark) => q(`
  local stackObjs = {}
  for _, o in ipairs(getObjects()) do
    local gm = tostring(o.getGMNotes())
    if gm:sub(1, 13) == "engine:stack:" then stackObjs[#stackObjs + 1] = gm:sub(8) .. "=" .. o.getName():gsub("\\n", "/") .. "=" .. tostring(engineBadge[gm:sub(8)] or "") end
  end
  table.sort(stackObjs)
  local glows = {}
  for id, g in pairs(engineStackGlow) do if g == "stack" then glows[#glows + 1] = id end end
  table.sort(glows)
  return JSON.encode({ token = popShown and popShown.token or 0, stack = stackObjs, glows = glows })`, mark);
const look = (r, mark) => JSON.parse(valueOf(r, mark) || "{}");

{
  const r = sim([
    // 18 Soul Warden triggers from the three on the table (the run's sources)
    send(["bl1", ...wardens], []), // (the Soul Wardens on the table first)
    send(["bl1", ...wardens], [run("engine-stack-1", "sw1", 18, ["sw2", "sw3"])], "board 18"), LOOK("on table"),
    // the top resolves: the same run, 17
    send(["bl1", ...wardens], [run("engine-stack-1", "sw1", 17, ["sw2", "sw3"])], "board 17"), LOOK("resolving"),
    // sources the table has no card of (in no zone it draws: died and gone, a token ceased to exist): one stack card for
    // the run of 3
    send(["bl1"], []),
    send(["bl1"], [run("engine-stack-2", "gone1", 3, ["gone2", "gone3"])]), LOOK("off table"),
    // and down to one: the same card, its count gone
    send(["bl1"], [run("engine-stack-2", "gone1", 1, null)]), LOOK("down to one"),
    send(["bl1"], []), { frames: 200 }, send(["bl1", ...goblins], []),
    // six Goblin tokens, one token stack, each with a trigger: one run
    send(["bl1", ...goblins], [run("engine-stack-9", "gob1", 6, ["gob2", "gob3", "gob4", "gob5", "gob6"], "Goblin", "Whenever this creature enters, it deals 1 damage to each opponent.")]), LOOK("tokens"),
  ]);
  ok("no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  const a = look(r, "on table"), b = look(r, "resolving"), c = look(r, "off table"), d = look(r, "down to one"), t = look(r, "tokens");
  const who18 = setTo(r, "board 18", "eng_pop_who"), who17 = setTo(r, "board 17", "eng_pop_who");
  ok("pop-up: one for the run, counted", who18.length === 1 && who18[0].includes("Soul Warden ×18 - Blue"), JSON.stringify(who18));
  ok("sources on the table: each glows", JSON.stringify(a.glows) === JSON.stringify(["sw1", "sw2", "sw3"]), JSON.stringify(a.glows));
  ok("sources on the table: no stack card", a.stack.length === 0, JSON.stringify(a.stack));
  const status = setTo(r, "board 18", "eng_status_Blue").join(" ");
  ok("status line: the run once, counted", status.includes("Stack (top first): Soul Warden ×18") && !status.includes("Soul Warden, Soul Warden"), status);
  ok("resolving: the pop-up says 17, no new pop-up", who17.length === 1 && who17[0].includes("Soul Warden ×17 - Blue") && b.token === a.token && a.token > 0, `${JSON.stringify(who17)} ${a.token} ${b.token}`);
  ok("off the table: one stack card for the run, its count in its name and badge", c.stack.length === 1 && /^stack:engine-stack-2=Soul Warden\/On the stack \(×3\)\/.*=grp=x3=/.test(c.stack[0]), JSON.stringify(c.stack));
  ok("down to one: the same card, no count", d.stack.length === 1 && /^stack:engine-stack-2=Soul Warden\/On the stack\/[^=]*=#$/.test(d.stack[0]), JSON.stringify(d.stack));
  ok("tokens: no stack card a trigger", t.stack.length === 0, JSON.stringify(t.stack));
  ok("tokens: the token stack's card lights", t.glows.length === 1 && /^gob/.test(t.glows[0]), JSON.stringify(t.glows));
}

{
  // the badge of a token stack and its tooltip, as drawn (the fake TTS keeps the buttons)
  const BADGE = (mark) => q(`
    local rep = nil
    for _, id in ipairs({ "gob1", "gob2", "gob3", "gob4", "gob5", "gob6" }) do if engineGroupList[id] ~= nil then rep = id end end
    local o = nil
    for _, x in ipairs(getObjects()) do if rep ~= nil and tostring(x.getGMNotes()) == "engine:" .. rep then o = x end end
    local grp = {}
    for _, b in ipairs(o and o.getButtons() or {}) do if tostring(b.label):sub(1, 1) == "x" then grp[#grp + 1] = { label = b.label, tip = b.tooltip } end end
    return JSON.encode({ rep = tostring(rep), n = rep and #engineGroupList[rep] or 0, badge = rep and tostring(engineBadge[rep] or "") or "", grp = grp })`, mark);
  const all = new Set(goblins), one = new Set(["gob4"]);
  infinite = new Set();
  const r1 = sim([send(["bl1", ...goblins], []), BADGE("plain")]);
  infinite = all;
  const r2 = sim([send(["bl1", ...goblins], []), BADGE("all inf")]);
  infinite = one;
  const r3 = sim([send(["bl1", ...goblins], []), BADGE("one inf")]);
  infinite = new Set();
  for (const r of [r1, r2, r3]) ok("inf: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  const plain = look(r1, "plain"), inf = look(r2, "all inf"), part = look(r3, "one inf");
  ok("inf: a plain stack of 6 says x6", plain.n === 6 && plain.grp.some((b) => b.label === "x6"), JSON.stringify(plain));
  ok("inf: a stack of infinitely many says x∞", inf.n === 6 && inf.grp.some((b) => b.label === "x∞") && !inf.grp.some((b) => b.label === "x6"), JSON.stringify(inf));
  ok("inf: its tooltip says the engine keeps 500", inf.grp.some((b) => b.tip === "Infinitely many (the engine keeps 500 real tokens)"), JSON.stringify(inf.grp));
  ok("inf: the badge string changes with it", inf.badge.includes("grp=x∞=") && plain.badge.includes("grp=x6="), `${inf.badge} | ${plain.badge}`);
  ok("inf: one member with inf is enough, and inf doesn't split the stack", part.n === 6 && part.grp.some((b) => b.label === "x∞"), JSON.stringify(part));
}

console.log(`${failed ? failed + " failed, " : ""}${failed ? "" : "all "}${passed} passed`);
process.exit(failed ? 1 : 0);
