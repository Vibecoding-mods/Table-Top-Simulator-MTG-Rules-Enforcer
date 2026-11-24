// The Linux/macOS companion's own checks as a deploy gate: companion-node/companion.js --selftest (every decision
// against canned inputs) and companion-node/breakit.js (each of its cases breaks one rule in a COPY of logic.js or
// platform.js and requires its named check to go red; the originals' sha256 is compared after). The companion ships in
// the friend packages and reads the bridge and the deploy record, so a change there is caught at deploy, not by a friend.
//   node tests/test_companion_node.js
const path = require("path");
const { spawnSync } = require("child_process");

const C = path.join(__dirname, "..", "companion-node");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const tail = (s, n = 8) => String(s || "").trim().split("\n").slice(-n).join("\n  ");

function part(name, args, timeout) {
  const t = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: C, encoding: "utf8", timeout, maxBuffer: 1 << 26 });
  const secs = Math.round((Date.now() - t) / 1000);
  return { ...r, secs, name };
}

// the selftest: exit code is the failure count; a run that printed no PASS line didn't run
{
  const r = part("selftest", [path.join(C, "companion.js"), "--selftest"], 120000);
  const fails = (r.stdout.match(/^FAIL .*/gm) || []);
  ok("companion-node selftest: exit 0, no FAIL line", r.status === 0 && fails.length === 0, `exit ${r.status}${r.error ? ` (${r.error.message})` : ""}\n  ${fails.slice(0, 10).join("\n  ") || tail(r.stdout + r.stderr)}`);
  ok("companion-node selftest: it ran (PASS lines)", /^PASS /m.test(r.stdout), tail(r.stdout + r.stderr));
  console.log(`selftest: ${(r.stdout.match(/^PASS /gm) || []).length} passed in ${r.secs} s`);
}

// the break-its: exit code is the cases that didn't go red, plus 100 if an original changed
{
  const r = part("breakit", [path.join(C, "breakit.js")], 600000);
  const m = /(\d+) of (\d+) breaks turned their check red/.exec(r.stdout);
  ok("companion-node breakit: exit 0", r.status === 0, `exit ${r.status}${r.error ? ` (${r.error.message})` : ""}\n  ${tail(r.stdout + r.stderr, 15)}`);
  ok("companion-node breakit: every break turned its check red", !!m && m[1] === m[2] && Number(m[2]) > 0, m ? m[0] : tail(r.stdout));
  ok("companion-node breakit: the originals untouched", /originals untouched/.test(r.stdout), tail(r.stdout));
  console.log(`breakit: ${m ? m[0] : "no summary"} in ${r.secs} s`);
}

console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
