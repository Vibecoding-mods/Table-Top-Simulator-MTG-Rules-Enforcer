// Break-it for Revert update and the check line's "what changed" (docs/companion-app-spec.md §11.6; companion/src
// Update.cs, Updater.cs, WebUi.cs, WebPage.cs; companion-node logic.js and web.js).
// Each mutation changes one rule and needs the check it names to fail:
//  - companion/src/*.cs: the companion folder is copied to a temp folder, the copy is changed and built (build.cmd with
//    COMPANION_OUT), and tests/test_companion_update.js runs that exe (COMPANION_EXE) with COMPANION_UPDATE_ONLY=revert
//    (its --selftest --section revert, then the fake-GitHub revert runs). The real sources are never written.
//  - companion/src/WebPage.cs: the changed copy goes to tests/test_companion_page.js as its file argument.
//  - companion-node/*.js: changed in place for one run of companion-node/selftest.js, then the original bytes are written
//    back and checked by sha256 (never put back by an inverse replace).
// A mutation whose check doesn't fail is printed as SURVIVED. Windows only (build.cmd).
//   node tools/mutate-companion-revert.js [label pattern]
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const U = "companion/src/Update.cs", R = "companion/src/Updater.cs", W = "companion/src/WebUi.cs", P = "companion/src/WebPage.cs", C = "companion/src/Controller.cs";
const NL = "companion-node/logic.js", NW = "companion-node/web.js";
// [label, file, from, to, the check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  // what a release changes
  ["the table left out of the changes", U, "if (set.Contains(\"table\")) c.Add(\"table\");", "", "selftest: changes: the table, the app, the engine, each once and in that order"],
  ["the check line without what changed", U, "\": changes \" + ChangesWords(Changes(p.Fetch.Select(x => x.Name))) + \" (\"", "\" (\"", "selftest: check line: names what changed (the table and the app), then the parts and the size"],
  ["the old repository name", U, "public const string Repo = \"Vibecoding-mods/Table-Top-Simulator-MTG-Rules-Enforcer\";", "public const string Repo = \"Vibecoding-mods/Table-Top-Simulator-Mock-MTGA\";", "selftest: repo: the renamed repository (Table-Top-Simulator-MTG-Rules-Enforcer)"],
  // the skipped release
  ["the automatic check offers the skipped release", U, "if (manual || r == null || !r.Available || !IsSkipped(skipped, r.Manifest.Version)) return r;", "return r;", "selftest: skip: the automatic check doesn't offer the release reverted from"],
  ["a newer release skipped too", U, "|| !IsSkipped(skipped, r.Manifest.Version)) return r;", ") return r;", "selftest: skip: a newer release (another tag) is offered by the automatic check"],
  ["a manual check keeps the skip", R, "            if (manual) Remember(\"skipped\", null);\n", "", "skipped: the manual check cleared it"],
  ["a revert doesn't remember the skip", R, "            if (skip != null) Remember(\"skipped\", Updates.AddSkipped(skippedBefore, skip));\n", "", "selftest: disk: the release reverted from is remembered as skipped"],
  ["a failed revert keeps the skip", R, "if (skip != null && undo == null) Remember(\"skipped\", skippedBefore);", "", "selftest: failed: nothing skipped (an earlier skip stays as it was)"],
  ["a failed revert clears an earlier skip too", R, "Remember(\"skipped\", skippedBefore);", "Remember(\"skipped\", null);", "selftest: failed: nothing skipped (an earlier skip stays as it was)"],
  ["a second revert replaces the first skip", U, "return string.IsNullOrEmpty(skipped) ? version : skipped + \",\" + version;", "return version;", "selftest: skip list: a second revert adds its release, the first one stays"],
  ["a skip matched as part of a tag", U, "skipped.Split(',').Contains(version)", "skipped.Contains(version)", "selftest: skip list: a whole tag, never part of one"],
  // which backup, and the button
  ["no backup counted as possible", U, "if (backupDir == null) { r.Why = NoBackup; return r; }", "if (backupDir == null) { r.Why = NoBackup; r.Possible = true; return r; }", "selftest: plan: no backup: not possible, says no earlier version is kept"],
  ["a backup without the engine images put back", U, "if (!has(part == \"app\" ? \"bridge\" : Holds[part][0]))", "if (false)", "selftest: plan: the engine differs but the backup has no images: not possible, says why"],
  ["the old exe never swapped back", U, "&& has(BackupExe)) { r.Self = true;", "&& has(BackupExe)) { r.Self = false;", "selftest: plan: the app and the engine differ, both kept: possible, puts back the app and the engine, this app too"],
  ["the button enabled without a backup", W, "bool canRevert = rv != null && rv.Possible && !working", "bool canRevert = rv != null && !working", "selftest: button: no backup: disabled, its line says why, no question"],
  ["the button enabled while an update waits for the game", W, " && !updateWaits && !revertWaits;", " && !revertWaits;", "selftest: button: ready: disabled"],
  ["an update's wait read from the status only", W, "updateWaits = u.DeferredUntilGameEnds || u.Status == \"ready\"", "updateWaits = u.Status == \"ready\"", "selftest: button: an update waits under another status: Revert disabled"],
  ["a revert's wait read from the status only", W, "revertWaits = u.RevertWaiting || u.Status == \"revert-ready\"", "revertWaits = u.Status == \"revert-ready\"", "selftest: button: a revert waits under another status: Revert disabled, says it waits"],
  ["Update now enabled while a revert waits", W, "\"Update now\", !working && !revertWaits,", "\"Update now\", !working,", "selftest: button: a revert waits and a check found an update meanwhile: Update now disabled, says the revert waits"],
  // the Controller's wait
  ["Update now accepted while a revert waits", C, "            if (PendingRevert) return Updates.RevertWaitsText;", "            if (false) return Updates.RevertWaitsText;", "selftest: start: Update now is refused while the revert waits (it would be undone after the game)"],
  ["a waiting revert not restored at the start", C, "s.Status = \"revert-ready\"; s.RevertWaiting = true;", "s.Status = \"revert-ready\"; s.RevertWaiting = false;", "selftest: start: a revert that waited still waits (revert-ready)"],
  ["a wait without a backup kept at the start", C, "                    else upd.Remember(\"pendingRevert\", null);\n", "", "selftest: start without a backup: nothing waits, the wait dropped"],
  ["a wait that can't go back any more kept", R, "if (!early.Possible) { Remember(\"pendingRevert\", null); return", "if (!early.Possible) { return", "selftest: no backup any more: refused, the wait cleared"],
  // the doing
  ["a revert during a game goes ahead", R, "            if (fx.Locked())\n            {\n                Log.Write(\"revert: deferred, a game is on\");", "            if (false)\n            {\n                Log.Write(\"revert: deferred, a game is on\");", "selftest: game on: deferred, says it goes back after the game"],
  ["the earlier engine images not loaded", R, "PlacedThenEffects(j, fx, restore.Restore.Contains(\"images\"), ", "PlacedThenEffects(j, fx, false, ", "selftest: disk: bridge stopped, reloaded, the old images loaded, bridge started (no save: the table didn't change)"],
  ["the earlier table not installed", R, "restore.Restore.Contains(\"table\"), info.Self, \"earlier\"", "false, info.Self, \"earlier\"", "table revert failing: undone, exit 1, says why"],
  ["a part's added paths kept", U, "holds.Where(h => !always.Contains(h)).Any(inBackup)) s.Replaced.AddRange(holds);", "holds.Where(h => !always.Contains(h)).Any(inBackup)) s.Replaced.AddRange(holds.Where(inBackup));", "selftest: paths: an app backup: every app path replaced (one the update added goes), only the kept ones put back"],
  ["a placed path not journaled", R, "                    j.Placed.Add(new[] { rel, from });\n", "", "revert killed at place: every file as after the update (the backup whole)"],
  ["the journal forgets it is a revert", U, "{ \"kind\", Kind }, ", "", "selftest: journal: a revert's kind and source read back"],
  ["a finished revert leaves the newer files", R, "                        RevertCleanup(j);\n", "", "selftest: killed placed: the old bridge stays, the newer files and the backup gone"],
  ["version.json keeps the backup's app version", R, "            try { KeepAppVersion(L.VersionFile, current); }", "            try { }", "selftest: disk: version.json names this app's own version (no exe went back)"],
  ["a killed revert's version.json names the older app", R, "try { KeepAppVersion(Path.Combine(home, \"version.json\"),", "try { if (false) KeepAppVersion(Path.Combine(home, \"version.json\"),", "selftest: killed placed: version.json is v1's but names the app that still runs (c2: no older exe took over)"],
  ["the newer images not loaded again after a failed step", R, "            if (imagesLoaded) fx.LoadImages();\n            fx.StartBridge();\n            return undo;", "            fx.StartBridge();\n            return undo;", "selftest: failed: the newer images loaded again, the bridge started again"],
  ["the app being replaced starts the bridge", R, "restore.Restore.Contains(\"table\"), info.Self, \"earlier\"", "restore.Restore.Contains(\"table\"), false, \"earlier\"", "app revert: the bridge isn't started by the app being replaced (its loop would hold the exe)"],
  ["the backup deleted before the old exe is copied", R, "            string next = null, copyError = info.Self ? CopyOldExe(info, out next) : null;", "            RevertCleanup(j);\n            string next = null, copyError = info.Self ? CopyOldExe(info, out next) : null;", "app revert: went back, the older app takes over"],
  ["the journal deleted before the cleanup", R, "            Point(\"finishing\");", "            try { File.Delete(JournalPath(L.Home)); } catch { }\n            Point(\"finishing\");", "revert killed at finishing: died with a journal on disk"],
  ["an undo's unmovable older path not kept", R, "                    if (revert) stuck.Add(pair[0]);\n", "", "selftest: undo blocked: the only copy of the older version stays (bridge, tar), never deleted"],
  ["an undo deletes a path it couldn't move back", R, "                if (stuck.Contains(rel)) continue;\n                var p = full(rel);", "                var p = full(rel);", "selftest: undo blocked: the only copy of the older version stays (bridge, tar), never deleted"],
  ["the old exe not kept by an update", R, "            if (self) KeepExe(backup); // (so Revert can put this app back too)\n", "", "app revert: the old exe kept in backup\\v1\\companion"],
  // the page
  ["a disabled Revert says an update is busy", P, "upd && m.id !== 'update-revert' ? UPDATE_BUSY : lockText", "upd ? UPDATE_BUSY : lockText", "tip: a disabled Revert's 'right now' is its own reason, not 'an update is being checked'"],
  ["Revert without its icon", P, ", 'update-revert': 'untap' };", " };", "revert: the button's label, enabled, its icon"],
  // Linux and macOS
  ["the Linux/macOS line without the revert note", NW, "line: `${line} ${RevertNote}`", "line", "revert: no button on Linux/macOS, the page line says why"],
  ["the Linux/macOS check line without what changed", NL, "${m.version}: changes ${changesWords(changes(p.fetch.map((x) => x.name)))} (", "${m.version} (", "check line: names what changed (the table and the app)"],
  ["the Linux/macOS repository name", NL, "Repo: \"Vibecoding-mods/Table-Top-Simulator-MTG-Rules-Enforcer\",", "Repo: \"Vibecoding-mods/Table-Top-Simulator-Mock-MTGA\",", "repo: the renamed repository (Table-Top-Simulator-MTG-Rules-Enforcer)"],
];

const failsOf = (r, name) => {
  const failed = [];
  for (const line of String(r.stdout).split("\n")) if (/^FAIL /.test(line)) failed.push(line.slice(5).split("   got:")[0]);
  if (r.status !== 0 && !failed.length) failed.push(`${name} exit ${r.status} ${String(r.stderr).slice(0, 300)}`);
  return failed;
};
const runNode = (args, env = {}) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", timeout: 1800000, maxBuffer: 1 << 26, env: { ...process.env, ...env } });
const updateTest = (exe) => failsOf(runNode([path.join(ROOT, "tests", "test_companion_update.js")], { COMPANION_EXE: exe, COMPANION_UPDATE_ONLY: "revert" }), "test_companion_update");
const pageTest = (file) => failsOf(runNode([path.join(ROOT, "tests", "test_companion_page.js"), file]), "test_companion_page");
const nodeSelftest = () => failsOf(runNode([path.join(ROOT, "companion-node", "selftest.js")]), "companion-node/selftest");
function build(dir) {
  const out = path.join(dir, "out");
  fs.mkdirSync(out, { recursive: true });
  const r = spawnSync("cmd", ["/c", path.join(dir, "build.cmd")], { encoding: "utf8", timeout: 300000, env: { ...process.env, COMPANION_OUT: out } });
  return r.status === 0 ? { exe: path.join(out, "MTG Companion.exe") } : { why: `build.cmd: ${r.stdout}${r.stderr}` };
}

if (process.platform !== "win32") { console.log("Windows only: it builds the companion with build.cmd"); process.exit(1); }
const pattern = process.argv.slice(2).find((a) => !a.startsWith("--"));
const only = pattern ? new RegExp(pattern, "i") : null;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-revert-"));
const pristine = Object.fromEntries([...new Set(MUTATIONS.map((m) => m[1]))].map((f) => [f, sha(path.join(ROOT, f))]));
const checkPristine = () => {
  for (const [f, h] of Object.entries(pristine)) if (sha(path.join(ROOT, f)) !== h) { console.log(`REAL FILE CHANGED: ${f}`); process.exit(100); }
};
process.on("exit", () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

// the tests must pass on the real files first: a test that fails by itself proves nothing
{
  const dir = path.join(TMP, "base");
  fs.cpSync(path.join(ROOT, "companion"), dir, { recursive: true, filter: (p) => !p.includes(`${path.sep}bin`) });
  const b = build(dir);
  if (b.why) { console.log(`BASELINE DOESN'T BUILD: ${b.why.slice(0, 300)}`); process.exit(1); }
  for (const [name, fails] of [["update", updateTest(b.exe)], ["page", pageTest(path.join(ROOT, P))], ["node selftest", nodeSelftest()]])
    if (fails.length) { console.log(`BASELINE FAILS (${name}): ${fails.slice(0, 3).join(" | ")}`); process.exit(1); }
  fs.rmSync(dir, { recursive: true, force: true });
}
let survived = 0, caught = 0, n = 0;
for (const [label, file, from, to, want] of MUTATIONS) {
  if (only && !only.test(label)) continue;
  const real = path.join(ROOT, file), src = fs.readFileSync(real, "utf8");
  const count = src.split(from).length - 1;
  if (count !== 1) { console.log(`NOT APPLIED (${count} matches) ${label}`); survived++; continue; }
  const mutant = src.replace(from, () => to);
  let failed;
  if (file.startsWith("companion-node/")) {
    const original = fs.readFileSync(real);
    try { fs.writeFileSync(real, mutant); failed = nodeSelftest(); }
    finally { fs.writeFileSync(real, original); checkPristine(); }
  } else {
    const dir = path.join(TMP, `c${n++}`);
    fs.cpSync(path.join(ROOT, "companion"), dir, { recursive: true, filter: (p) => !p.includes(`${path.sep}bin`) });
    const copy = path.join(dir, path.relative(path.join(ROOT, "companion"), real));
    fs.writeFileSync(copy, mutant);
    if (file === P) failed = pageTest(copy);
    else {
      const b = build(dir);
      if (b.why) { console.log(`DOESN'T BUILD ${label}: ${b.why.slice(0, 300)}`); survived++; continue; }
      failed = updateTest(b.exe);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    checkPristine();
  }
  if (failed.some((f) => f.startsWith(want))) { caught++; console.log(`caught   ${label}: ${want}${failed.length > 1 ? ` (+${failed.length - 1})` : ""}`); }
  else { survived++; console.log(`SURVIVED ${label}${failed.length ? ` (failed instead: ${failed.slice(0, 2).join(" | ")})` : ""}`); }
}
console.log(`${caught} caught, ${survived} survived; the real files unchanged (sha256)`);
process.exit(survived ? 1 : 0);
