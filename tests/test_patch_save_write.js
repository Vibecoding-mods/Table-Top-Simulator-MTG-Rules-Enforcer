// tools/patch-save.js main(): the part that writes the player's save, run on a COPY in a temp folder (never the save in
// Documents/My Games: MTG_SAVE points into the temp folder before the module loads, and every call names its file).
// A dry run writes nothing; TTS running refuses before any byte is written; a write leaves the new save and both
// backups, with the script stamped and every other part of the file as it was; a script it can't find once stops it.
//   node tests/test_patch_save_write.js
require("./no-live-ports");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patch-save-write-"));
process.env.MTG_SAVE = path.join(tmp, "not-a-real-save.json"); // (the module's default file, should anything fall back to it)
const ps = require("../tools/patch-save");
const { sha8 } = require("../bridge/versions");
const { buildSave } = require("./golden/table-run");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${typeof why === "string" ? why : JSON.stringify(why)}` : ""}\n`); } };
const threw = (f) => { try { f(); return null; } catch (e) { return e.message; } };
const quiet = (f) => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };

ok("setup: the module's own save path is the temp folder's", ps.SAVE.startsWith(tmp), ps.SAVE);

// the fixture: the table built from source, its script made "older" (a stamp from another deploy and one line the
// source no longer has), saved the way TTS saves (indented)
const built = buildSave();
const OLD_LINE = "-- a line an older table script had (test_patch_save_write)";
const old = JSON.parse(JSON.stringify(built));
const lines = old.LuaScript.split("\n");
lines.splice(1, 0, OLD_LINE);
old.LuaScript = lines.join("\n").replace('function engineStamp() return "dev" end', 'function engineStamp() return "0ld5tamp" end');
ok("setup: the fixture's script differs from the build's", old.LuaScript !== built.LuaScript && old.LuaScript.includes("0ld5tamp"));
const RAW = JSON.stringify(old, null, 2);

let n = 0;
const fresh = (raw = RAW) => {
  const dir = path.join(tmp, `case-${++n}`);
  fs.mkdirSync(dir);
  const save = path.join(dir, "TS_Save_1.json"), backupDir = path.join(dir, "backup");
  fs.writeFileSync(save, raw);
  return { save, backupDir };
};

// ── a dry run writes nothing
{
  const c = fresh();
  const r = quiet(() => ps.main(false, { ...c, ttsRunning: () => { throw new Error("a dry run asked whether TTS runs"); } }));
  ok("dry run: returns the patched file as a trial", typeof r.trial === "string" && JSON.parse(r.trial).LuaScript.includes("engineStamp"));
  ok("dry run: the save is byte for byte as it was", fs.readFileSync(c.save, "utf8") === RAW);
  ok("dry run: no backup written", !fs.existsSync(c.backupDir));
}

// ── TTS running: refused before any byte is written
{
  const c = fresh();
  const why = threw(() => quiet(() => ps.main(true, { ...c, ttsRunning: () => true })));
  ok("TTS running: the write is refused", /TTS is running/.test(why || ""), why);
  ok("TTS running: the save is byte for byte as it was", fs.readFileSync(c.save, "utf8") === RAW);
  ok("TTS running: no backup written", !fs.existsSync(c.backupDir));
}

// ── the write
let written = null;
{
  const c = fresh();
  const r = quiet(() => ps.main(true, { ...c, ttsRunning: () => false }));
  const out = fs.readFileSync(c.save, "utf8");
  const saved = JSON.parse(out);
  const want = ps.stamped(built.LuaScript.replace(/\r\n/g, "\n"));
  ok("write: the save's script is the build's, stamped", saved.LuaScript.replace(/\r\n/g, "\n") === want.script, `${saved.LuaScript.length} vs ${want.script.length}`);
  ok("write: the script keeps the save's own line endings", saved.LuaScript.includes("\r\n") === old.LuaScript.includes("\r\n"));
  ok("write: the old line is gone and the old stamp with it", !saved.LuaScript.includes(OLD_LINE) && !saved.LuaScript.includes("0ld5tamp"));
  ok("write: it returns the stamp it wrote and the new save's hash", r.stamp === want.stamp && r.save === sha8(out), r);
  ok("write: everything but the script is as it was", JSON.stringify({ ...saved, LuaScript: null }) === JSON.stringify({ ...old, LuaScript: null }));
  ok("write: the old save is backed up byte for byte", fs.existsSync(path.join(c.backupDir, `TS_Save_1.${sha8(RAW)}.json`)) && fs.readFileSync(path.join(c.backupDir, `TS_Save_1.${sha8(RAW)}.json`), "utf8") === RAW);
  ok("write: the new save is backed up too (a save deleted in TTS is restored from it)", fs.existsSync(path.join(c.backupDir, `TS_Save_1.${r.save}.json`)) && fs.readFileSync(path.join(c.backupDir, `TS_Save_1.${r.save}.json`), "utf8") === out);
  ok("write: the save keeps its own layout (indented as TTS wrote it)", out.startsWith("{\n  \""));
  written = { c, out, r };
}

// ── run again on the written save: in step, the same bytes
if (written) {
  const r2 = quiet(() => ps.main(true, { ...written.c, ttsRunning: () => false }));
  ok("again: an up-to-date save is written the same, byte for byte", fs.readFileSync(written.c.save, "utf8") === written.out && r2.save === written.r.save && r2.stamp === written.r.stamp, r2);
}

// ── a script it can't find once in the file: stopped, nothing written
{
  const twice = JSON.parse(RAW);
  twice.Note = twice.LuaScript; // (the same text elsewhere in the file: replacing it would hit the wrong place)
  const raw = JSON.stringify(twice, null, 2);
  const c = fresh(raw);
  const why = threw(() => quiet(() => ps.main(true, { ...c, ttsRunning: () => false })));
  ok("script twice in the file: stopped", /nothing changed/.test(why || ""), why);
  ok("script twice in the file: the save is byte for byte as it was, no backup", fs.readFileSync(c.save, "utf8") === raw && !fs.existsSync(c.backupDir));
}

// ── a save that doesn't parse: stopped, nothing written
{
  const c = fresh(RAW.slice(0, -10));
  const why = threw(() => quiet(() => ps.main(true, { ...c, ttsRunning: () => false })));
  ok("a cut save: stopped", !!why, why);
  ok("a cut save: left as it was, no backup", fs.readFileSync(c.save, "utf8") === RAW.slice(0, -10) && !fs.existsSync(c.backupDir));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
