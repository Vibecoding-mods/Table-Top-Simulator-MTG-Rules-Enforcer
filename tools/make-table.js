// Makes the engine table from the host's own Steam Workshop copy of the group's table, on the host's PC. The friend
// package ships this file and the patcher it runs (make-engine-copy.js, engine-json.lua, engine-renderer.lua) but no
// table: Steam's Subscriber Agreement lets a subscriber use a Workshop item, not hand out copies of it. So the host
// subscribes to the table, TTS downloads it, and the companion runs this on the downloaded file.
//   node make-table.js <workshop.json> <out.json> [--table 4p]
// It prints one line of JSON: { ok: true, table, stamp, save, workshop } (save and workshop: sha8 of the file written
// and of the Workshop file read), or { ok: false, missing?, error }. Exit 0 when written, 3 when the Workshop file isn't
// there, 1 when the patcher refused it (the Workshop table changed so that a patch no longer applies). Nothing is
// written then. The Workshop file is only read.
//
// What it writes is what the repo's own tools make of the same input: make-engine-copy.js's ENGINE MODE save, its
// table script stamped and its line endings set as tools/patch-save.js does when a deploy brings a save up to that
// script, and the save renamed as the friend package always named it (tests/test_friend_package.js proves the two
// byte for byte). Only Node's own modules: the friend's PC has nothing else.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const workshopUrl = (id) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
// The tables a package can make. patcher: the script that turns the Workshop file into the engine save (beside this
// file), null while there is none: the 6-player table's profile is being built (docs/m6-six-seat-spec.md); when it
// lands, its patcher goes here and the package lists the table in version.json "tables" (optional: a host who hasn't
// subscribed to it still gets the 4-player one).
const TABLES = {
  "4p": { id: "2296042369", players: 4, saveName: "MTG Table (rules engine)", file: "MTG Table.json", patcher: "make-engine-copy.js", optional: false },
  "6p": { id: "2293586471", players: 6, saveName: "MTG Table 6 players (rules engine)", file: "MTG Table 6p.json", patcher: null, optional: true },
};
for (const t of Object.values(TABLES)) t.url = workshopUrl(t.id);
// The package's version.json "tables": every table, the ones without a patcher listed (optional, makeable false) so
// the host sees its Workshop link, but never made
const versionTables = () => Object.entries(TABLES).map(([key, t]) => ({ key, id: t.id, url: t.url, saveName: t.saveName, file: t.file, optional: t.optional, makeable: !!t.patcher }));
// what the patcher needs beside it (make-engine-copy.js appends the Lua files to the table's scripts and reads the
// table's profile with table-profile.js)
const PATCHER_FILES = ["make-table.js", "make-engine-copy.js", "table-profile.js", "engine-json.lua", "engine-renderer.lua", "deckcheck.lua", "deckcheck-import.lua"];

const DEV_STAMP = 'function engineStamp() return "dev" end';
const sha8 = (data) => crypto.createHash("sha256").update(data).digest("hex").slice(0, 8);
const lf = (s) => s.replace(/\r\n/g, "\n");

// The table script's version: a hash of it (LF line endings, the stamp at "dev"), as tools/patch-save.js stamped()
function stamped(script) {
  if (script.split(DEV_STAMP).length !== 2) throw new Error("engineStamp isn't in the table script once");
  const stamp = sha8(script);
  return { stamp, script: script.replace(DEV_STAMP, `function engineStamp() return "${stamp}" end`) };
}

// The save with its top-level SaveName replaced and every other byte kept (TTS lists a save by this name)
function renameSave(raw, name) {
  const re = /^(\s*"SaveName":\s*)"(?:[^"\\]|\\.)*"/m; // (the first key of a TTS save; nested objects have no SaveName)
  if (!re.test(raw)) throw new Error("no SaveName in the save");
  const out = raw.replace(re, (_, lead) => `${lead}${JSON.stringify(name)}`);
  if (JSON.parse(out).SaveName !== name) throw new Error("SaveName didn't change");
  return out;
}

// The ENGINE MODE save's text -> the table's: the script stamped (CRLF throughout when the script has any, as a
// deploy's tools/patch-save.js rewrite() leaves it), every other byte kept, then renamed. Pure: the tests drive it.
function finish(engineRaw, saveName) {
  const old = JSON.parse(engineRaw).LuaScript;
  if (typeof old !== "string") throw new Error("the engine save has no table script");
  const { stamp, script } = stamped(lf(old));
  const oldJson = JSON.stringify(old);
  if (engineRaw.split(oldJson).length !== 2) throw new Error("the table script isn't in the engine save once");
  const out = engineRaw.split(oldJson).join(JSON.stringify(old.includes("\r\n") ? script.replace(/\n/g, "\r\n") : script));
  return { text: renameSave(out, saveName), stamp };
}

// The Workshop file -> { bytes, stamp, save, workshop, png } (png: the Workshop picture's path, or null). Throws
// { missing: true } when the file isn't there, an Error with the patcher's FAIL lines when it refused it.
function build(workshopFile, { table = "4p", dir = __dirname, node = process.execPath } = {}) {
  const t = TABLES[table];
  if (!t) throw new Error(`no table ${table}: one of ${Object.keys(TABLES).join(", ")}`);
  if (!t.patcher) throw new Error(`the ${t.players}-player table can't be made yet (no patcher in this package)`);
  if (!fs.existsSync(workshopFile)) throw Object.assign(new Error(`${workshopFile} isn't there`), { missing: true });
  const input = fs.readFileSync(workshopFile);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-make-table-"));
  try {
    const engine = path.join(tmp, "engine.json");
    // (a copy of the input: the patcher also copies a .png beside its source to beside its output, here into tmp)
    const src = path.join(tmp, "workshop.json");
    fs.writeFileSync(src, input);
    let said = "";
    try { said = execFileSync(node, [path.join(dir, t.patcher), src, engine], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000, maxBuffer: 1 << 26 }); }
    catch (e) {
      const fails = String(e.stdout || "").split(/\r?\n/).filter((l) => /^FAIL/.test(l));
      throw new Error(fails.length ? `a patch didn't apply to this Workshop copy: ${fails.join("; ").replace(/\s+/g, " ")}` : `the patcher failed: ${String(e.stderr || e.message).trim().split(/\r?\n/).slice(-1)[0]}`);
    }
    if (!fs.existsSync(engine)) throw new Error(`the patcher wrote nothing: ${said.trim().split(/\r?\n/).slice(-1)[0]}`);
    const { text, stamp } = finish(fs.readFileSync(engine, "utf8"), t.saveName);
    const bytes = Buffer.from(text, "utf8");
    const png = workshopFile.replace(/\.json$/i, ".png");
    return { bytes, stamp, save: sha8(bytes), workshop: sha8(input), table, png: fs.existsSync(png) ? png : null };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// out written whole or not at all (a temp file beside it, then a rename); the Workshop picture beside it as .png
function writeTable(built, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = `${out}.part`;
  fs.writeFileSync(tmp, built.bytes);
  fs.renameSync(tmp, out);
  const png = out.replace(/\.json$/i, ".png");
  if (built.png) fs.copyFileSync(built.png, png);
  else fs.rmSync(png, { force: true });
}

function main(argv) {
  const at = argv.indexOf("--table");
  const table = at >= 0 ? argv[at + 1] : "4p";
  const [src, out] = argv.filter((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1));
  const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  if (!src || !out) { say({ ok: false, error: "usage: node make-table.js <workshop.json> <out.json> [--table 4p]" }); return 2; }
  try {
    const b = build(path.resolve(src), { table });
    writeTable(b, path.resolve(out));
    say({ ok: true, table, stamp: b.stamp, save: b.save, workshop: b.workshop });
    return 0;
  } catch (e) {
    say({ ok: false, missing: !!e.missing, error: e.message });
    return e.missing ? 3 : 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { TABLES, PATCHER_FILES, versionTables, workshopUrl, stamped, renameSave, finish, build, writeTable, main, sha8 };
