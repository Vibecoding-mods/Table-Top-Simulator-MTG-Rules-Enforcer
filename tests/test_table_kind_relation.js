// Relation check for the question description (describePrompt): the recorded games replayed as they were sent
// (no `kind`: the table works it out from titles) and replayed with `kind`/`dest` added the way the bridge now sends
// them must make the table do exactly the same. Needs no recorded answer: a difference is a bug on one side.
//   node tests/test_table_kind_relation.js
const { simulate } = require("./lua/run-sim");
const { scenarios, buildSave } = require("./golden/table-run");

// the bridge's kinds, recovered from the recorded titles/options (what the bridge would have sent)
function kindOf(p) {
  const t = String(p.title || "");
  const ids = (p.options || []).map((o) => String(o.id));
  if (t === "Your priority") return { kind: "priority" };
  if (/^Pay /.test(t) && ids.includes("__cancel")) return { kind: "mana" };
  if (/^Declare attackers/.test(t)) return { kind: "attack" };
  if (/^Declare blockers/.test(t)) return { kind: "block" };
  if (/^Mulligan/.test(t)) return { kind: "mulligan" };
  if (/^Put \d/.test(t)) return { kind: "mulliganPutBack", dest: "library" };
  if (/^Dice/.test(t)) return { kind: "dice" };
  if (/: pick #\d/.test(t)) return { kind: "order" };
  if (/^Tap .* for which mana\?/.test(t)) return { kind: "choice" };
  if (ids.some((i) => i.startsWith("card|") || i.startsWith("player|"))) return { kind: "target" };
  if (ids.length === 2 && ids.includes("yes") && ids.includes("no")) return { kind: "yesno" };
  if (ids.length === 1 && ids[0] === "ok") return { kind: "reveal" };
  return { kind: "cards", ...(/\b(bottom|top)\b/i.test(t) ? { dest: "library" } : {}) };
}
const annotate = (steps) => steps.map((s) => {
  if (!s.msg || s.msg.t !== "prompt") return s;
  const p = JSON.parse(s.msg.json);
  if (p.promptId == null || p.kind) return s;
  return { ...s, msg: { t: "prompt", json: JSON.stringify({ ...p, ...kindOf(p) }) } };
});

const save = buildSave();
let failed = 0;
for (const sc of scenarios()) {
  const plain = simulate({ save, steps: sc.steps });
  const tagged = simulate({ save, steps: annotate(sc.steps) });
  const n = sc.steps.filter((s) => s.msg && s.msg.t === "prompt").length;
  if (plain.errors.length || tagged.errors.length) { failed++; console.log(`FAIL ${sc.name}: errors ${JSON.stringify([...plain.errors, ...tagged.errors].slice(0, 2))}`); continue; }
  const i = plain.steps.findIndex((st, k) => JSON.stringify(st) !== JSON.stringify(tagged.steps[k]));
  if (i < 0) { console.log(`ok   ${sc.name}: ${n} questions, same table actions with and without kind`); continue; }
  failed++;
  const a = plain.steps[i].fx, b = tagged.steps[i].fx;
  let k = 0;
  while (k < Math.max(a.length, b.length) && a[k] === b[k]) k++;
  console.log(`FAIL ${sc.name}: step ${plain.steps[i].step}, action #${k}\n    without kind: ${a[k]}\n    with kind:    ${b[k]}`);
}
process.exit(failed ? 1 : 0);
