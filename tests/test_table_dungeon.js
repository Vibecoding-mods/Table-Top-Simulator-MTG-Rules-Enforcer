// The dungeon card on the table (docs/planechase-dungeon-engine-spec.md D7, tools/engine-renderer.lua): it lies past the
// second tax label, clear of one commander and of two (a partner's spot was where it used to cover), and carries the
// bridge's room box (dg, its tooltip dgt). Boards are made up here (two players: Blue seated, White an AI).
//   node tests/test_table_dungeon.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };

const cards = {
  cmd1: { n: "Kenrith, the Returned King", f: "https://example.invalid/cmd1.jpg", b: "", tl: "Legendary Creature", ty: ["Legendary", "Creature"] },
  cmd2: { n: "Tymna the Weaver", f: "https://example.invalid/cmd2.jpg", b: "", tl: "Legendary Creature", ty: ["Legendary", "Creature"] },
  dun1: { n: "Lost Mine of Phandelver", f: "https://example.invalid/dun1.jpg", b: "", tl: "Dungeon", ty: ["Dungeon"] },
  bl1: { n: "Island", f: "https://example.invalid/bl1.jpg", b: "", tl: "Land", ty: ["Land"] },
};
const ROOM = "ROOM: Goblin Lair\nNEXT: Storeroom or Dark Pool\nCOMPLETED: 1";
function board(command) {
  const pl = (color, slot, cmd) => ({
    color, slot, name: color, ai: color === "White", life: 40, status: "playing", pool: {}, poison: 0, energy: 0,
    cmdDamage: {}, tax: [0, 0], library: 50, handCount: 0, hand: color === "Blue" ? [] : null,
    battlefield: color === "Blue" ? [{ s: 1, id: "bl1", ctl: color, dmg: 0, ctr: {} }] : [], graveyard: [], exile: [], command: cmd,
  });
  return JSON.stringify({ t: "table", turn: 3, step: "main1", active: "Blue", activeTurnNo: 2, priority: "Blue", gameOver: false,
    winner: null, players: [pl("Blue", "player-0", command), pl("White", "player-1", [])], stack: [], cards });
}
const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "Blue", "player-1": "White" }, names: { "player-0": "Blue", "player-1": "AI 1" }, ai: ["White"] });
const lua = (code, mark, frames) => ({ lua: code, mark, ...(frames != null ? { frames } : {}) });
const PRELUDE = 'engineAutoPace.Blue = false engineChat("mtg start ai 1", Player.Blue) return "ok"';
const POS = lua(`local out = {} for _, o in ipairs(getObjects()) do local id = string.match(o.getGMNotes() or "", "^engine:(.+)$") if id then local p = o.getPosition() local labels = {} for _, b in ipairs(o.getButtons() or {}) do labels[#labels + 1] = { label = b.label, tooltip = b.tooltip } end out[id] = { x = p.x, z = p.z, buttons = labels } end end local tax = {} for i, g in ipairs({ "0c0c5e", "3b2d18" }) do local a = getObjectFromGUID(g) if a then local p = a.getPosition() tax[i] = { x = p.x, z = p.z } end end out.__tax = tax return JSON.encode(out)`, "pos", 1);
function run(command) {
  const r = simulate({ save, steps: [lua(PRELUDE, "prelude"), { msg: { t: "started", json: STARTED } }, { msg: { t: "table", json: board(command) }, frames: 60 }, POS] });
  const step = r.steps.find((s) => s.step === "pos") || {};
  return { r, pos: JSON.parse(step.value || "{}") };
}
const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.z - b.z) : NaN);
const CARD_W = 2.2; // (a card on the table is about 2.2 wide and 3 long: closer than that, two cards overlap)

{
  const { r, pos } = run([{ s: 1, id: "cmd1", ctl: "Blue" }, { s: 1, id: "dun1", ctl: "Blue", dg: ROOM, dgt: "Goblin Lair — Create a Treasure token." }]);
  ok("one commander: the board drew without errors", !r.errors.length, r.errors.join(" | "));
  ok("one commander: both cards are on the table", pos.cmd1 && pos.dun1, JSON.stringify(Object.keys(pos)));
  ok("one commander: the commander lies on the first tax label", dist(pos.cmd1, pos.__tax?.[0]) < 0.5, `${dist(pos.cmd1, pos.__tax?.[0])}`);
  ok("one commander: the dungeon is clear of the commander", dist(pos.cmd1, pos.dun1) > CARD_W, `${dist(pos.cmd1, pos.dun1)}`);
  ok("one commander: the dungeon is clear of the second tax label (a partner's spot)", dist(pos.__tax?.[1], pos.dun1) > CARD_W, `${dist(pos.__tax?.[1], pos.dun1)}`);
  const b = (pos.dun1?.buttons || []).find((x) => /ROOM: Goblin Lair/.test(x.label));
  ok("room box: the dungeon card shows the room, where it leads and the dungeons completed", b && b.label === ROOM, JSON.stringify(pos.dun1?.buttons));
  ok("room box: its tooltip is the room's text", b && b.tooltip === "Goblin Lair — Create a Treasure token.", b && b.tooltip);
  ok("room box: a commander shows none", !(pos.cmd1?.buttons || []).some((x) => /ROOM/.test(x.label)), JSON.stringify(pos.cmd1?.buttons));
}
{
  const { r, pos } = run([{ s: 1, id: "cmd1", ctl: "Blue" }, { s: 1, id: "cmd2", ctl: "Blue" }, { s: 1, id: "dun1", ctl: "Blue", dg: ROOM }]);
  ok("two commanders: the board drew without errors", !r.errors.length, r.errors.join(" | "));
  ok("two commanders: the partner lies on the second tax label", dist(pos.cmd2, pos.__tax?.[1]) < 0.5, `${dist(pos.cmd2, pos.__tax?.[1])}`);
  ok("two commanders: the dungeon is clear of the first", dist(pos.cmd1, pos.dun1) > CARD_W, `${dist(pos.cmd1, pos.dun1)}`);
  ok("two commanders: the dungeon is clear of the partner", dist(pos.cmd2, pos.dun1) > CARD_W, `${dist(pos.cmd2, pos.dun1)}`);
  ok("two commanders: no room box without its tooltip text still shows the room", (pos.dun1?.buttons || []).some((x) => x.label === ROOM), JSON.stringify(pos.dun1?.buttons));
}
{
  // (the dungeon listed first, before the commander: the commander still gets the first label)
  const { pos } = run([{ s: 1, id: "dun1", ctl: "Blue" }, { s: 1, id: "cmd1", ctl: "Blue" }]);
  ok("dungeon first: the commander still lies on the first tax label", dist(pos.cmd1, pos.__tax?.[0]) < 0.5, `${dist(pos.cmd1, pos.__tax?.[0])}`);
  ok("dungeon first: no room box when the bridge sends none (an older engine)", !(pos.dun1?.buttons || []).some((x) => /ROOM/.test(x.label)), JSON.stringify(pos.dun1?.buttons));
}

console.log(failed ? `FAILED: ${failed} failed, ${passed} passed` : `PASSED: ${passed} passed, 0 failed`);
process.exit(failed ? 1 : 0);
