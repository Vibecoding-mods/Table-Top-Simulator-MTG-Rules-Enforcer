// tools/mutate-golden-lib.js graded(): the one rule the test-file graders share (2026-11-27): a "CRASH: " entry is no
// check catching a mutant; any named failure is.
//   node tests/test_mutate_graded.js
const { graded } = require("../tools/mutate-golden-lib");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${JSON.stringify(why)}` : ""}\n`); } };
ok("graded: nothing failed is not caught", graded([]) === false);
ok("graded: a crash alone is not caught", graded(["CRASH: tests/x.js exit 1: boom"]) === false);
ok("graded: a named failure is caught", graded(["a check"]) === true);
ok("graded: a crash beside a named failure is caught", graded(["CRASH: tests/x.js exit 1", "a check"]) === true);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
