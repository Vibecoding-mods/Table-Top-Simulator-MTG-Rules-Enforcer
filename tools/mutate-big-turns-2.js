// Break-it for big turns 2 in the bridge and on the table (tests/test_bridge_unbounded_tokens.js,
// tests/test_table_trigger_groups.js, tests/test_bridge_big_turns.js): each mutation switches one piece off
// (bridge/bridge.js, tools/engine-renderer.lua), runs the tests, lists the checks that failed by name, then puts the file
// back and checks it by sha256. A mutation no check catches is printed as SURVIVED. The engine's pieces:
// tools/mutate-engine-docker.js.
//   node tools/mutate-big-turns-2.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_bridge_unbounded_tokens.js", "tests/test_table_trigger_groups.js", "tests/test_bridge_big_turns.js"];
const B = "bridge/bridge.js", R = "tools/engine-renderer.lua";

// [label, file, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["bridge: inf never sent to the table", B, "    ...(c.unbounded ? { inf: true } : {}),\n    // (a battle's protector", "    ...{},\n    // (a battle's protector"],
  ["bridge: inf sent for every token", B, "    ...(c.unbounded ? { inf: true } : {}),\n    // (a battle's protector", "    ...(c.identity.isToken ? { inf: true } : {}),\n    // (a battle's protector"],
  ["bridge: the log's cards lose inf", B, "        ...(c.unbounded ? { inf: true } : {}),\n", ""],
  ["bridge: one inf token doesn't make the pile infinite", B, "        if (c.inf) made.inf = true;\n", ""],
  ["bridge: the infinite line never said", B, "        out[made.at] = made.inf ? ", "        out[made.at] = false ? "],
  ["bridge: the cap not 500", B, "const ENGINE_TOKEN_CAP = 500;", "const ENGINE_TOKEN_CAP = 1000;"],
  ["bridge: the draw reason never read", B, "  if (limit) return limit;\n", ""],
  ["bridge: a draw reason over a winner", B, "  const limit = gv?.gameOver && !gv.winnerId ? DRAW_REASON_WORDS[gv.drawReason] : null;", "  const limit = gv?.gameOver ? DRAW_REASON_WORDS[gv.drawReason] : null;"],
  ["bridge: a draw reason before the game is over", B, "  const limit = gv?.gameOver && !gv.winnerId ? DRAW_REASON_WORDS[gv.drawReason] : null;", "  const limit = !gv?.winnerId ? DRAW_REASON_WORDS[gv?.drawReason] : null;"],
  ["bridge: the stuck loop's words lost", B, "  stuckLoop: \"a draw: a loop the engine couldn't stop, and nobody answered\",\n", ""],
  ["bridge: the heap's words lost", B, "  heap: \"a draw: the engine was running out of memory\",\n", ""],
  ["bridge: the unanswered words lost", B, "  unanswered: \"a draw: the engine's limit question went unanswered twice this turn\",\n", ""],
  ["bridge: the timer answers the runaway question", B, "  if (seat.prompt.ui?.title === RUNAWAY_TITLE) return chat(", "  if (false) return chat("],
  ["bridge: the timer leaves every question unanswered", B, "  if (seat.prompt.ui?.title === RUNAWAY_TITLE) return chat(", "  if (true) return chat("],
  ["bridge: the runaway's End in a draw unsaid", B, "ended the game in a draw at the engine's limit (a loop it couldn't see the end of).", "ended it."],
  ["table: inf never shown", R, "    if c.groupInf then parts[#parts + 1]", "    if false then parts[#parts + 1]"],
  ["table: no tooltip for inf", R, "ENGINE_INF_BADGE, BADGE.black, \"Infinitely many (the engine keeps \" .. ENGINE_TOKEN_CAP .. \" real tokens)\" }", "ENGINE_INF_BADGE, BADGE.black }"],
  ["table: the stack's own inf forgotten", R, "        c.groupInf = c.inf == true\n", "        c.groupInf = false\n"],
  ["table: a member's inf ignored", R, "        if c.inf then rep.groupInf = true end\n", ""],
  ["table: the badge says INF", R, "ENGINE_INF_BADGE = \"x∞\"", "ENGINE_INF_BADGE = \"xINF\""],
  ["table: inf splits the stack", R, "tostring(c.fd), tostring(c.po), table.concat(c.kw or {}, \",\") }, \"|\")", "tostring(c.fd), tostring(c.po), tostring(c.inf), table.concat(c.kw or {}, \",\") }, \"|\")"],
];

function runTests() {
  const failed = [];
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
    const out = (r.stdout || "") + (r.stderr || "");
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*FAIL[: ]\s*(.+)$/);
      if (m && !/^test_/.test(m[1])) failed.push(m[1].slice(0, 90));
    }
    if (r.status !== 0 && !failed.length) failed.push(`${t} exit ${r.status}: ${out.split("\n").slice(-3).join(" ").slice(0, 160)}`);
  }
  return failed;
}

const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null; // (a label pattern: just those mutations)
const base = runTests();
console.log(base.length ? `BASELINE FAILS: ${base.join(" | ")}` : "baseline: green");
if (base.length) process.exit(1);
let survived = 0;
const list = MUTATIONS.filter(([label]) => !only || only.test(label));
for (const [label, rel, from, to] of list) {
  const file = path.join(ROOT, rel);
  const before = sha(file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) { console.log(`?? ${label}: the code to break is not there once`); survived++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let failed;
  try { failed = runTests(); } finally { fs.writeFileSync(file, text); }
  const ok = sha(file) === before;
  if (!failed.length) survived++;
  console.log(`${failed.length ? "caught" : "SURVIVED"}: ${label}${failed.length ? ` -> ${failed.slice(0, 3).join(" | ")}` : ""}${ok ? "" : "  RESTORE MISMATCH"}`);
}
console.log(survived ? `${survived} of ${list.length} survived` : `all ${list.length} caught, every file restored`);
process.exit(survived ? 1 : 0);
