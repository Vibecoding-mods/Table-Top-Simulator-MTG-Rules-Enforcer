// Break-it for the engine build a deploy records (tests/test_engine_build_record.js; the owner's decision 2026-11-17):
// each mutation switches one piece off (bridge/versions.js containerBuild, tools/deploy.js, tools/make-friend-package.js,
// engine/build-images.sh), runs the test and requires the named check to fail, then puts the file back and checks it by
// sha256. The companions' side: tools/mutate-companion-own-server.js, companion-node/breakit.js and
// tests/test_companion_server.js --breakit.
//   node tools/mutate-engine-build-record.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TEST = "tests/test_engine_build_record.js";
const V = "bridge/versions.js", D = "tools/deploy.js", K = "tools/make-friend-package.js", I = "engine/build-images.sh";
const J = "tools/engine-build-id.js", H = "engine/engine-build-id.sh";

// [label, file, from, to, check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["the build read from the wrong variable", V, "l.startsWith(\"SELF_HOSTED_NODE_ENGINE_BUILD=\")", "l.startsWith(\"ENGINE_BUILD=\")", "containerBuild: the node's build from its environment"],
  ["an empty build recorded", V, "done(err || !build ? null : build);", "done(err ? null : build);", "containerBuild: an empty build (an image built without a tag): null"],
  ["a Docker error not noticed", V, "done(err || !build ? null : build);", "done(!build ? null : build);", "containerBuild: Docker failing after printing a build: null (not trusted)"],
  ["deploy doesn't record it", D, "...images, engineBuild, at:", "...images, at:", "deploy: records this tree's id as engineBuild, refuses a running engine of another"],
  ["version.json without it", K, "    engineBuild: deployed.engineBuild || null,\n", "", "package: version.json carries engineBuild"],
  ["the node image told its tag again", I, "--build-arg ENGINE_BUILD=\"$build_id\"", "--build-arg ENGINE_BUILD=\"$tag\"", "build-images: the node image is told the build id, never its tag"],
  ["deploy doesn't refuse another running engine", D, "if (running && running !== engineBuild) stop(", "if (false) stop(", "deploy: records this tree's id as engineBuild, refuses a running engine of another"],
  ["the JS id keeps carriage returns", J, ".toString(\"latin1\").replace(/\\r/g, \"\");", ".toString(\"latin1\");", "id: a Windows checkout (CRLF patches): the same id"],
  ["the bash id keeps carriage returns", H, "tr -d '\\r' < \"$dir/manabrew.patch\"", "cat \"$dir/manabrew.patch\"", "id: a Windows checkout (CRLF patches): the same id"],
  ["the JS id leaves the pins out", J, "  h.update(`manabrew ${pin(\"MANABREW_COMMIT\")}\\nforge ${pin(\"FORGE_COMMIT\")}\\n`, \"latin1\");\n", "", "id: another pin: another id"],
  ["the JS id leaves forge.patch out", J, "  h.update(patch(\"forge.patch\"), \"latin1\");\n", "", "id: one byte of a patch changed: another id (the warning)"],
  ["the bash id doesn't separate the patches", H, "printf '\\0'; ", "", "id: the bash recipe (build-images.sh's) and the JS one (deploy's) agree"],
];

const NAMES = [...new Set(MUTATIONS.map((m) => m[4]))];
function runTest() {
  const r = spawnSync(process.execPath, [TEST], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const failed = out.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => NAMES.find((n) => l.startsWith(`FAIL ${n}:`)) || l.slice(5, 90));
  if (r.status !== 0 && !failed.length) failed.push(`exit ${r.status}: ${out.split("\n").slice(-3).join(" ").slice(0, 160)}`);
  return failed;
}

const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
const base = runTest();
console.log(base.length ? `BASELINE FAILS: ${base.join(" | ")}` : "baseline: green");
if (base.length) process.exit(1);
let missed = 0;
const list = MUTATIONS.filter(([label]) => !only || only.test(label));
for (const [label, rel, from, to, name] of list) {
  const file = path.join(ROOT, rel);
  const before = sha(file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) { console.log(`NOT APPLIED ${label}: the code to break is not there once`); missed++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let failed;
  try { failed = runTest(); } finally { fs.writeFileSync(file, text); }
  if (sha(file) !== before) { console.log(`RESTORE FAILED: ${rel}`); process.exit(100); }
  const hit = failed.includes(name);
  if (!hit) missed++;
  console.log(`${hit ? "caught  " : "MISSED  "} ${label}: ${failed.slice(0, 3).join(" | ") || "nothing failed"}`);
}
console.log(`${list.length - missed} of ${list.length} caught by name; files restored by sha256`);
process.exit(missed ? 1 : 0);
