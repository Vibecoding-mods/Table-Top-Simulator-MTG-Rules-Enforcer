// Break-it for token runs (tests/test_table_token_entries.js): each mutation switches one piece off (bridge/bridge.js
// tokenRuns and its send, tools/engine-renderer.lua engineExpandRuns and its hello), runs the test, lists the checks
// that failed by name, then puts the file back and checks it by sha256. A mutation no check catches is printed as
// SURVIVED.
//   node tools/mutate-token-entries.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_table_token_entries.js"];
const B = "bridge/bridge.js", R = "tools/engine-renderer.lua";

// [label, file, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["bridge: no runs sent", B, "  if (tableTokenRuns) {\n    for (const pl of players) {", "  if (false) {\n    for (const pl of players) {"],
  ["bridge: runs to a table that doesn't read them", B, "      tableTokenRuns = m.tokenRuns === true;", "      tableTokenRuns = true;"],
  ["bridge: the details not compared", B, "const key = st && st.includes('\"tok\":true') ? `${JSON.stringify({ ...c, id: null })}|${st}` : null;", "const key = st && st.includes('\"tok\":true') ? `${JSON.stringify({ ...c, id: null })}` : null;"],
  ["bridge: any token joins the run", B, "    if (key && run && run.key === key) {", "    if (key && run) {"],
  ["bridge: a range one short", B, "    if (n != null && Array.isArray(last) && last[0] + last[1] === n) last[1]++;", "    if (n != null && Array.isArray(last) && last[0] + last[1] === n) void 0;"],
  ["bridge: ids out of a row as one range", B, "    if (n != null && Array.isArray(last) && last[0] + last[1] === n) last[1]++;", "    if (n != null && Array.isArray(last)) last[1]++;"],
  ["bridge: changed details kept, not resent", B, "      if (r.fresh) delete game.sentZones?.[pl.color + \"|battlefield\"];\n", ""],
  ["bridge: the others count as sent", B, "      delete game.sentStatic[c.id];\n      continue;", "      continue;"],
  ["bridge: the others' details still sent", B, "      if (statics[c.id]) { fresh = true; delete statics[c.id]; game.textQueue?.delete(c.id); }", "      if (statics[c.id]) { fresh = true; game.textQueue?.delete(c.id); }"],
  ["table: runs not laid out", R, "  if not engineHasRuns(list) then return list end", "  if true then return list end"],
  ["table: a range starts one late", R, "  for k = 0, (tonumber(v[2]) or 0) - 1 do", "  for k = 1, (tonumber(v[2]) or 0) do"],
  ["table: a plain id dropped", R, "  if type(v) ~= \"table\" then out[#out + 1] = engineCopyCard(c, v) return end", "  if type(v) ~= \"table\" then return end"],
  ["table: the others' details not set", R, "  engineStatic[id] = engineStatic[c.id]\n  return d", "  return d"],
  ["table: runs laid out before the details are stored", R, "  local fresh = {}\n  for id, st in pairs(m.cards or {}) do engineStoreStatic(id, st) fresh[id] = true end\n  m.cards = nil\n  -- (a run of identical tokens came as one entry: one entry per token again, its others with the first one's details,\n  -- engineExpandRuns)\n  for _, pl in ipairs(m.players or {}) do\n    if pl.battlefield ~= nil then pl.battlefield = engineExpandRuns(pl.battlefield) end\n  end\n",
    "  for _, pl in ipairs(m.players or {}) do\n    if pl.battlefield ~= nil then pl.battlefield = engineExpandRuns(pl.battlefield) end\n  end\n  local fresh = {}\n  for id, st in pairs(m.cards or {}) do engineStoreStatic(id, st) fresh[id] = true end\n  m.cards = nil\n"],
  ["table: the run's marker kept on the first", R, "  local ids = c.gi\n  c.gi = nil\n", "  local ids = c.gi\n"],
  ["table: hello without tokenRuns", R, "    m = { again = true, stamp = engineStamp(), keepRewind = true, tokenRuns = true,", "    m = { again = true, stamp = engineStamp(), keepRewind = true,"],
];

function runTests() {
  const failed = [];
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: "utf8", timeout: 900000 });
    const out = (r.stdout || "") + (r.stderr || "");
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*FAIL[: ]\s*(.+)$/);
      if (m && !/^test_/.test(m[1])) failed.push(m[1].split(": ").slice(0, 2).join(": ").slice(0, 110));
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
  console.log(`${failed.length ? "caught" : "SURVIVED"}: ${label}${failed.length ? ` -> ${[...new Set(failed)].slice(0, 3).join(" | ")}` : ""}${ok ? "" : "  RESTORE MISMATCH"}`);
}
console.log(survived ? `${survived} of ${list.length} survived` : `all ${list.length} caught, every file restored`);
process.exit(survived ? 1 : 0);
