// Break-it for follow-ups 2 in the bridge (tests/test_bridge_archenemy_resume.js, tests/test_bridge_planar_order.js,
// tests/test_bridge_planar_owners.js): each mutation switches one piece off (bridge/bridge.js saveResume / resumeGame /
// schemeView, the reorder question's planar deck words, logSnapshot / logEvents' plane owners), runs the three tests
// and requires the named check to fail, then puts the file back and checks it by sha256. The engine's part:
// tools/mutate-planar-owners-engine.js.
//   node tools/mutate-followups-2.js [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_bridge_archenemy_resume.js", "tests/test_bridge_planar_order.js", "tests/test_bridge_planar_owners.js"];
const B = "bridge/bridge.js", R = "tools/engine-renderer.lua";

// [label, file, from, to, check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["resume: the schemes seen not saved", B, "      ...(game.schemesSeen?.size ? { schemesSeen: [...game.schemesSeen] } : {}),\n", "", "save: the schemes seen in the command zone"],
  ["resume: the scheme set in motion not saved", B, "      ...(game.schemeNow ? { schemeNow: game.schemeNow } : {}),\n", "", "resume: the next scheme is seq 4 (its banner not skipped)"],
  ["resume: the schemes seen not restored as a set", B, "    schemesSeen: new Set(Array.isArray(snap.game.schemesSeen) ? snap.game.schemesSeen : []), seats: new Map()", "    seats: new Map()", "resume: the schemes seen come back as a set"],
  ["resume: no save when a scheme arrives", B, "  if (fresh) saveResume();", "", "save: a new scheme writes the resume file"],
  ["resume: no save when a scheme only leaves", B, "if (!here.has(id)) { game.schemesSeen.delete(id); fresh = true; }", "if (!here.has(id)) { game.schemesSeen.delete(id); }", "save: a scheme gone back under the deck leaves the saved list"],
  ["resume: saved before the schemes gone are dropped", B, "  // (one gone back under the deck may come out again later: it is a new one then)\n  const here = new Set(schemeCards.map((c) => c.id));\n  for (const id of [...game.schemesSeen]) if (!here.has(id)) { game.schemesSeen.delete(id); fresh = true; }\n  // (and saved at once, after either: a restart right after a scheme still knows it, and one that went back under the\n  // deck is new again when it comes out, saveResume)\n  if (fresh) saveResume();", "  if (fresh) saveResume();\n  const here = new Set(schemeCards.map((c) => c.id));\n  for (const id of [...game.schemesSeen]) if (!here.has(id)) { game.schemesSeen.delete(id); fresh = true; }", "save: the schemes seen in the command zone"],
  ["planar order: the planar deck not told", B, "      const planarBottom = /\\bbottom of (?:your|their) planar deck\\b/i.test(what) && input.items.length > 0", "      const planarBottom = false && input.items.length > 0", "seedcore: the question says the planar deck's bottom and which comes up first"],
  ["planar order: kept without asking as a library's bottom", B, "bottom = !planarBottom && /bottom of", "bottom = /bottom of", "pools: the planar deck's order is asked"],
  ["planar order: any card list taken as a planar deck's", B, "        && input.items.every((i) => (i.card?.types || []).some((t) => t === \"Plane\" || t === \"Phenomenon\"));", "        && true;", "pools: the hand to the library's bottom is kept without asking, as before"],
  ["planar order: phenomena not counted", B, "(i.card?.types || []).some((t) => t === \"Plane\" || t === \"Phenomenon\"));", "(i.card?.types || []).some((t) => t === \"Plane\"));", "seedcore: the question says the planar deck's bottom and which comes up first"],
  ["planar order: next said as first", B, "click the one that comes up ${n ? \"next\" : \"first\"}`", "click the one that comes up first`", "seedcore: the next pick says next"],
  ["planar order: the answer turned round", B, "orderedIds: unblock(onTop ? [...ids].reverse() : ids)", "orderedIds: unblock(onTop || planarBottom ? [...ids].reverse() : ids)", "seedcore: the answer in the order clicked (the first nearest the top)"],
  ["planar owners: the engine's not kept in the snapshot", B, "    ...(pub.planar.ownerIds && typeof pub.planar.ownerIds === \"object\" ? { owners: { ...pub.planar.ownerIds } } : {}) } : null;", "    } : null;", "snapshot: the planar block keeps ownerIds"],
  ["planar owners: the tracking over the engine", B, "  const ownerOf = (id) => cur.planar?.owners?.[id] || prev.planar?.owners?.[id] || planeOwners.get(id);", "  const ownerOf = (id) => planeOwners.get(id) || cur.planar?.owners?.[id] || prev.planar?.owners?.[id];", "engine owner: a plane Blue walked to from AI 1's deck leaves with AI 1"],
  ["planar owners: not from the board before", B, "  const ownerOf = (id) => cur.planar?.owners?.[id] || prev.planar?.owners?.[id] || planeOwners.get(id);", "  const ownerOf = (id) => cur.planar?.owners?.[id] || planeOwners.get(id);", "engine owner: from the board the plane was last on"],
  ["planar owners: no fallback", B, "  const ownerOf = (id) => cur.planar?.owners?.[id] || prev.planar?.owners?.[id] || planeOwners.get(id);", "  const ownerOf = (id) => cur.planar?.owners?.[id] || prev.planar?.owners?.[id];", "older engine: the tracking (who planeswalked to it)"],
];

const NAMES = [...new Set(MUTATIONS.map((m) => m[4]))];
function runTest() {
  let out = "", status = 0;
  for (const t of TESTS) { const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: "utf8", timeout: 600000 }); out += `${r.stdout || ""}${r.stderr || ""}\n`; status ||= r.status; }
  const r = { status };
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
