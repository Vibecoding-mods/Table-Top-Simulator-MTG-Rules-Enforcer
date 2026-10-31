// After tools/run-coverage.sh on the keyword decks: which keyword cards actually got played (cast, played, entered,
// ability used, attacked) in the games, and any engine errors or table mismatches that mention them.
//   node tools/keyword-report.js <startEpochMs>  -> docs/keyword-test-results.md
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const since = Number(process.argv[2] || 0);
const picks = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp", "kwdecks", "keyword-cards.json"), "utf8"));
const lines = [];
// STREAM=<file>: another recording of what the bridge sent (the headless bridge records to its own file)
for (const l of fs.readFileSync(process.env.STREAM || path.join(ROOT, "tmp", "tts-stream.jsonl"), "utf8").split("\n")) {
  if (!l) continue;
  let m; try { m = JSON.parse(l); } catch { continue; }
  if (m.at < since || m.msg.t !== "gamelog") continue;
  for (const s of JSON.parse(m.msg.json).lines || []) lines.push(s);
}
const results = {};
// "node keyword-report.js <since> only-new <out.md>": only games played after <since> (to re-check flagged keywords)
const onlyNew = process.argv[3] === "only-new";
for (const f of fs.readdirSync(path.join(ROOT, "tmp", "coverage")).filter((f) => /^result-(kw\d+|r\d+-\d+|r2old-\d+)\.json$/.test(f))) {
  const fp = path.join(ROOT, "tmp", "coverage", f);
  if (onlyNew && fs.statSync(fp).mtimeMs < since) continue;
  results[f] = JSON.parse(fs.readFileSync(fp, "utf8"));
}
const problems = Object.values(results).flatMap((r) => [...(r.tableProblems || []), ...(r.engineErrors || []), ...(r.ttsErrors || []), ...(r.unsupported || [])]);
const rows = [];
for (const [kw, p] of Object.entries(picks)) {
  if (!p) { rows.push({ kw, card: "-", status: "no card Forge knows" }); continue; }
  const name = p.card;
  const mine = lines.filter((s) => s.includes(name) && /^White /.test(s));
  const any = lines.filter((s) => s.includes(name));
  const used = mine.find((s) => / (casts|plays|uses|activates|attacks with)/.test(s)) || any.find((s) => /enters the battlefield \(White\)/.test(s));
  const probs = problems.filter((s) => s.includes(name));
  rows.push({ kw, card: name, status: probs.length ? "PROBLEM" : used ? "played" : any.length ? "seen" : "not drawn", note: probs[0] || used || any[0] || "" });
}
const order = { PROBLEM: 0, played: 1, seen: 2, "not drawn": 3, "no card Forge knows": 4 };
rows.sort((a, b) => order[a.status] - order[b.status] || a.kw.localeCompare(b.kw));
const count = (s) => rows.filter((r) => r.status === s).length;
const out = ["# Keyword test results", "",
  `Games: ${Object.keys(results).length} keyword decks (tools/make-keyword-decks.js), White on the bug-hunting autoplay vs 1 Forge AI, checked against the engine every step.`, "",
  `Played: ${count("played")} · Seen but not played by White: ${count("seen")} · Not drawn: ${count("not drawn")} · Problems: ${count("PROBLEM")} · No card: ${count("no card Forge knows")}`, "",
  "| Keyword | Test card | Result | Evidence |", "|---|---|---|---|",
  ...rows.map((r) => `| ${r.kw} | ${r.card} | ${r.status} | ${String(r.note).replace(/\|/g, "/").slice(0, 120)} |`)];
fs.writeFileSync(onlyNew ? path.resolve(process.argv[4] || path.join(ROOT, "tmp", "keyword-recheck.md")) : path.join(ROOT, "docs", "keyword-test-results.md"), out.join("\n") + "\n");
console.log(out.slice(0, 6).join("\n"));
