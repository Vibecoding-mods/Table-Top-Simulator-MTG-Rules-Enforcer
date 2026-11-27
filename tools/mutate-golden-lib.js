// The mutation loop the tools/mutate-*-golden.js graders share: each mutation is a change a careless edit or a refactor
// could plausibly make; the module's golden test must go red on it, by name. Prints CAUGHT / ESCAPED per mutation and
// the escape rate. The pristine file is held in memory, every mutation starts from it, and the file is put back and
// checked by sha256 after each one (and on exit or Ctrl+C). A mutation whose `from` text is not found exactly once is
// reported as SKIP, not run. Exit 1 on any escape or skip.
//   mutations: [label, from, to, equivalent?]; equivalent: argued to change no outcome (reported apart, not graded)
const fs = require("fs");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function runMutations(file, test, mutations, pattern) {
  const pristine = fs.readFileSync(file, "utf8");
  const want = sha(pristine);
  const restore = () => {
    fs.writeFileSync(file, pristine);
    if (sha(fs.readFileSync(file, "utf8")) !== want) { console.error(`RESTORE FAILED: ${file} does not match its pristine sha256`); process.exit(2); }
  };
  process.on("exit", () => { if (sha(fs.readFileSync(file, "utf8")) !== want) fs.writeFileSync(file, pristine); });
  process.on("SIGINT", () => { restore(); process.exit(130); });

  // the gate itself must be green on the pristine file, or every "caught" below means nothing
  const base = spawnSync(process.execPath, [test], { encoding: "utf8" });
  if (base.status !== 0) { console.error(`the golden fails on the pristine file:\n${base.stdout.slice(0, 2000)}`); process.exit(2); }

  const pat = pattern ? new RegExp(pattern, "i") : null;
  let caught = 0, escaped = 0, equiv = 0, skipped = 0;
  // a file with CRLF line ends (bridge/state-delta.js in a Windows checkout) is matched with the rows' "\n" written \r\n
  // (2026-11-27: three multi-line rows found 0 times there and every run exited 1 on the skips)
  const crlf = pristine.includes("\r\n");
  const eol = (s) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  for (const [label, from0, to0, equivalent] of mutations) {
    if (pat && !pat.test(label)) continue;
    const from = eol(from0), to = eol(to0);
    const n = pristine.split(from).length - 1;
    if (n !== 1) { skipped++; console.log(`SKIP  ${label}: 'from' found ${n} times`); continue; }
    fs.writeFileSync(file, pristine.replace(from, () => to));
    const r = spawnSync(process.execPath, [test], { encoding: "utf8" });
    restore();
    const fails = r.stdout.match(/^FAIL .*/gm) || [];
    if (equivalent) { equiv++; console.log(`${r.status === 0 ? "EQUIV (escaped, as argued)" : "EQUIV but caught: the argument is wrong"}  ${label}${r.status ? `: ${fails[0]}` : ""}`); continue; }
    if (r.status !== 0 && fails.length) { caught++; console.log(`CAUGHT  ${label}: ${fails.length} failed, e.g. ${fails[0].slice(0, 160)}`); }
    // (a crash or timeout with no FAIL line is no check catching the mutant: it counts as escaped, 2026-11-27)
    else if (r.status !== 0) { escaped++; console.log(`ESCAPED (no named FAIL line: the test crashed, status ${r.status}, so no check caught it)  ${label}: ${(r.stderr || "").slice(0, 200)}`); }
    else { escaped++; console.log(`ESCAPED  ${label}`); }
  }
  const graded = caught + escaped;
  const rate = graded ? (100 * escaped) / graded : 0;
  console.log(`\n${caught} caught, ${escaped} escaped of ${graded} (escape rate ${rate.toFixed(1)}%: ${rate === 0 ? "0%, check the mutants vary in kind" : rate < 25 ? "SOUND" : "WEAK"}); ${equiv} equivalent, ${skipped} skipped`);
  process.exit(escaped || skipped ? 1 : 0);
}

module.exports = { runMutations };
