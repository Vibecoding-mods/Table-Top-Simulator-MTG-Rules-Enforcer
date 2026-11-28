// An effect from a card another seat can't see (effectMark): engine1135 sends it as "Effect" with no text, no
// sourceCardId and no duration, and it reads "RULES EFFECT" with no hover, as engine1134c's hidden-source effect did.
// An open effect and an emblem keep their names (2026-11-28). No TTS, no ports.
//   node tests/test_bridge_hidden_effects.js
const harness = require("./bridge-harness");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 300)}` : ""}\n`); } };
const h = harness.load();
try {
  const marks = (effects) => h.B._effectMarks({ effects }, { zones: [] });
  let m = marks([{ id: 1, name: "Effect", text: "", emblem: false, untilEndOfTurn: false }]);
  ok("an engine-hidden effect reads RULES EFFECT", m[0] === "RULES EFFECT\t", JSON.stringify(m));
  m = marks([{ id: 2, name: "Teferi's Protection's Effect", text: "You have protection from everything.", emblem: false, untilEndOfTurn: false, duration: "UntilYourNextTurn" }]);
  ok("an open effect with no source id keeps its name", /^TEFERI'S PROTECTION UNTIL YOUR NEXT TURN\t.*protection from everything/.test(m[0] || ""), JSON.stringify(m));
  m = marks([{ id: 3, name: "Effect", text: "Creatures you control get +1/+1.", emblem: false, untilEndOfTurn: true }]);
  ok("a plain 'Effect' with text stays open", /^EFFECT THIS TURN\t.*\+1\/\+1/.test(m[0] || ""), JSON.stringify(m));
  m = marks([{ id: 4, name: "Emblem - Gideon", text: "", emblem: true, untilEndOfTurn: false }]);
  ok("an emblem with no text keeps its label", /^EMBLEM: GIDEON\t/.test(m[0] || ""), JSON.stringify(m));
} finally { harness.restore(); }
process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} hidden effect checks pass\n`);
process.exit(failed ? 1 : 0);
