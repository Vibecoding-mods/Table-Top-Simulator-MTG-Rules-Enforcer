// "mtg hand" in the table's chat (tools/make-engine-copy.js engineChat): the text after the command goes to the bridge
// as it was typed (lower case, as chat is read), with the player's colour, for the bridge's onHandChat to split and
// check; "off" and nothing at all go the same way. The chat line is hidden (engineChat answers false).
//   node tests/test_table_hand_chat.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };

const say = (text, mark) => ({ lua: `local sent = {} local was = engineSend engineSend = function(t, p) sent[#sent + 1] = { t = t, p = p } end local v = engineChat(${JSON.stringify(text)}, Player.Blue) engineSend = was return JSON.encode({ v = tostring(v), sent = sent })`, mark });
const r = simulate({ save, steps: [say("mtg hand Lightning Bolt, Neheb, the Worthy", "set"), say("mtg hand off", "off"), say("mtg hand", "ask"), say("mtg help", "help")] });
const step = (m) => r.steps.find((s) => s.step === m) || {};
// what a step returned: { v: engineChat's answer, sent: [{ t, p }] } (engineSend swapped for a recorder)
const got = (m) => { try { return JSON.parse(step(m).value); } catch { return { v: null, sent: [] }; } };
const sent = (m) => (got(m).sent || []).map((x) => ({ t: x.t, body: x.p }));

ok("the script loaded without errors", !r.errors.length, r.errors.slice(0, 2).join(" | "));
const set = sent("set").filter((x) => x.t === "hand");
ok("mtg hand <names>: one 'hand' message with the colour and the text, lower case as chat is read",
  set.length === 1 && set[0].body?.color === "Blue" && set[0].body?.text === "lightning bolt, neheb, the worthy", JSON.stringify(got("set")));
ok("mtg hand <names>: the chat line is hidden", got("set").v === "false", got("set").v);
const off = sent("off").filter((x) => x.t === "hand");
ok("mtg hand off: sent as the text off", off.length === 1 && off[0].body?.text === "off", JSON.stringify(off.map((x) => x.body)));
const ask = sent("ask").filter((x) => x.t === "hand");
ok("mtg hand: sent with no text (the bridge says what is waiting)", ask.length === 1 && ask[0].body?.text === "", JSON.stringify(ask.map((x) => x.body)));
ok("mtg help lists mtg hand", (step("help").fx || []).some((l) => /mtg hand <card>, <card> \.\.\. \(debug tools on, against the AI\)/.test(l)), (step("help").fx || []).join(" | ").slice(0, 300));

console.log(`${failed ? "FAILED" : "PASSED"}: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
