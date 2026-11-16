// Brings the installed save's table script up to the source, without rebuilding the save: a rebuild would bring back
// everything the save holds out on purpose, and a push wipes the table. It compares the save's script with a fresh build
// line by line and takes every difference except those tools/deploy-holds.json keeps out, then stamps the script's version.
// Only the script's text in the file is replaced: a script it can't find there as one exact string stops it. The one
// other change: the status pieces the built script moves (addPieces) are added when the save hasn't got them. TTS must
// be closed (a running TTS saves over the file).
//   node tools/patch-save.js              what would change
//   node tools/patch-save.js --write      change it (a copy goes to tmp/backup first)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { sha8 } = require("../bridge/versions");

const ROOT = path.join(__dirname, "..");
const SAVE = process.env.MTG_SAVE || path.join(process.env.USERPROFILE || "", "Documents/My Games/Tabletop Simulator/Saves/TS_Save_1.json");
const DEV_STAMP = 'function engineStamp() return "dev" end';
const lf = (s) => s.replace(/\r\n/g, "\n");

// The differences from a to b as hunks: { at: first line of a (from 0), gone: lines, added: lines }
function hunks(a, b) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-save-"));
  const fa = path.join(dir, "a"), fb = path.join(dir, "b");
  fs.writeFileSync(fa, a);
  fs.writeFileSync(fb, b);
  let out = "";
  try { execFileSync("git", ["diff", "--no-index", "--no-color", "-U0", "--inter-hunk-context=0", fa, fb], { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }); }
  catch (e) { if (e.status !== 1) throw e; out = e.stdout; } // (git diff exits 1 when they differ)
  fs.rmSync(dir, { recursive: true });
  const list = [];
  let cur = null;
  for (const line of out.split("\n")) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(line);
    if (m) {
      const count = m[2] === undefined ? 1 : Number(m[2]);
      cur = { at: count === 0 ? Number(m[1]) : Number(m[1]) - 1, gone: [], added: [] };
      list.push(cur);
    } else if (cur && line.startsWith("-") ) cur.gone.push(line.slice(1));
    else if (cur && line.startsWith("+")) cur.added.push(line.slice(1));
  }
  return list;
}

// The hold a hunk falls under, by what it takes out or puts in, or null
function heldBy(hunk, holds) {
  const text = [...hunk.gone, ...hunk.added].join("\n");
  return Object.keys(holds).find((name) => new RegExp(holds[name]).test(text)) || null;
}

// What a held hunk also drops: its lines the hold doesn't name. A hunk is held whole, so a fix beside held code goes with it.
const unheld = (hunk, holds) => [...hunk.gone, ...hunk.added].filter((l) => l.trim() && !new RegExp(holds[hunk.by]).test(l));

// Applied last to first, so each hunk's line numbers still hold
function apply(script, list) {
  const lines = script.split("\n");
  for (const h of [...list].sort((x, y) => y.at - x.at)) lines.splice(h.at, h.gone.length, ...h.added);
  return lines.join("\n");
}

// The script's version: a hash of it with the stamp left at "dev", so the same script always has the same version
function stamped(script) {
  if (script.split(DEV_STAMP).length !== 2) throw new Error("engineStamp isn't in the script once");
  const stamp = sha8(script);
  return { stamp, script: script.replace(DEV_STAMP, `function engineStamp() return "${stamp}" end`) };
}

const ttsRunning = () => /Tabletop Simulator\.exe/i.test(execFileSync("tasklist", ["/FI", "IMAGENAME eq Tabletop Simulator.exe"], { encoding: "utf8" }));

// oldScript -> the new one and what happened to each hunk. Pure: the tests drive this.
function patch(oldScript, built, holds) {
  const was = lf(oldScript).replace(/function engineStamp\(\) return "[^"]*" end/, DEV_STAMP);
  const all = hunks(was, lf(built));
  const whole = (t) => t.replace(/\n+$/, "");
  if (whole(apply(was, all)) !== whole(lf(built))) throw new Error("the diff doesn't rebuild the script: nothing changed");
  const taken = [], held = [];
  for (const h of all) { const by = heldBy(h, holds); if (by) held.push({ ...h, by }); else taken.push(h); }
  return { ...stamped(apply(was, taken)), taken, held };
}

// The save's file with its script replaced, and every other byte as it was. The script keeps its own line endings.
function rewrite(raw, script) {
  const old = JSON.parse(raw).LuaScript;
  const oldJson = JSON.stringify(old);
  if (raw.split(oldJson).length !== 2) throw new Error("the script isn't in the save's file as JSON.stringify writes it: nothing changed");
  return raw.split(oldJson).join(JSON.stringify(old.includes("\r\n") ? script.replace(/\n/g, "\r\n") : script));
}

// The status pieces (docs/status-objects-spec.md) the save lacks, from the built table: the objects the built script's
// ENGINE_STATUS_PIECES and ENGINE_DAY_NIGHT name (make-engine-copy writes both). A save from before them has none, and
// the script alone would move nothing. Each is put at the front of ObjectStates as text, every other byte as it was;
// one the save already has is left alone, and a GUID the save uses for anything else stops it. Pure: the tests drive it.
function statusGuids(script) {
  const at = script.indexOf("ENGINE_STATUS_PIECES = {");
  if (at < 0) return [];
  const block = script.slice(at, script.indexOf("\n}\n", at));
  const day = /ENGINE_DAY_NIGHT = \{ states = \{ "(\w+)"/.exec(script.slice(at));
  return [...[...block.matchAll(/\bg = "(\w+)"/g)].map((m) => m[1]), ...(day ? [day[1]] : [])];
}
function addPieces(raw, built) {
  const save = JSON.parse(raw);
  const guidsIn = (list, out = new Set()) => { for (const o of list || []) { out.add(o.GUID); guidsIn(o.ContainedObjects, out); guidsIn(Object.values(o.States || {}), out); } return out; };
  const top = new Set((save.ObjectStates || []).map((o) => o.GUID));
  const everywhere = guidsIn(save.ObjectStates);
  const add = [];
  for (const g of statusGuids(built.LuaScript || "")) {
    if (top.has(g)) continue;
    const o = built.ObjectStates.find((x) => x.GUID === g);
    if (!o) throw new Error(`the built table lists status piece ${g} but hasn't got it: nothing changed`);
    // (a piece with states is there when any state is: a table saved at night has Night on top, Day in its States)
    const own = [...guidsIn([o])];
    if (own.some((x) => top.has(x))) continue;
    const clash = own.filter((x) => everywhere.has(x));
    if (clash.length) throw new Error(`the save uses GUID ${clash.join(", ")} for something else: nothing changed`);
    add.push(o);
  }
  if (!add.length) return { raw, added: [] };
  const m = /("ObjectStates":\s*\[)(\s*)(\]?)/.exec(raw);
  if (!m || raw.split(m[1]).length !== 2) throw new Error("ObjectStates isn't in the save's file once: nothing changed");
  const text = add.map((o) => JSON.stringify(o, null, 2)).join(",\n");
  const out = raw.slice(0, m.index) + m[1] + "\n" + text + (m[3] ? "\n" : ",") + raw.slice(m.index + m[1].length);
  const back = JSON.parse(out);
  if (JSON.stringify(back.ObjectStates.slice(add.length)) !== JSON.stringify(save.ObjectStates) || JSON.stringify({ ...back, ObjectStates: null }) !== JSON.stringify({ ...save, ObjectStates: null }))
    throw new Error("adding the status pieces changed something else: nothing changed");
  return { raw: out, added: add.map((o) => `${String(o.Nickname || o.Name).split("\n")[0]} (${o.GUID})`) };
}

// The Card Importer's DeckCheck links (docs/deckcheck-spec.md) live in the importer's own object script, which the
// Global patch above never touches. Each top-level object whose built script has the DeckCheck code and whose saved
// script hasn't gets the built script, as text, every other byte as it was. One that can't be found exactly once is
// left alone and named. Pure: the tests drive it.
function importerScripts(raw, built) {
  const save = JSON.parse(raw);
  const has = (s) => typeof s === "string" && s.includes("function deckcheckId(");
  let out = raw;
  const done = [], skipped = [], want = new Map();
  for (const o of save.ObjectStates || []) {
    const b = (built.ObjectStates || []).find((x) => x.GUID === o.GUID);
    if (!b || !has(b.LuaScript) || has(o.LuaScript) || typeof o.LuaScript !== "string" || o.LuaScript === "") continue;
    const old = JSON.stringify(o.LuaScript);
    if (out.split(old).length !== 2) { skipped.push(o.GUID); continue; }
    out = out.replace(old, () => JSON.stringify(b.LuaScript));
    want.set(o.GUID, b.LuaScript);
    done.push(`${String(o.Nickname || o.Name).split("\n")[0]} (${o.GUID})`);
  }
  if (!done.length) return { raw, updated: [], skipped };
  const expected = { ...save, ObjectStates: save.ObjectStates.map((o) => (want.has(o.GUID) ? { ...o, LuaScript: want.get(o.GUID) } : o)) };
  if (JSON.stringify(JSON.parse(out)) !== JSON.stringify(expected))
    throw new Error("updating the Card Importer's script changed something else: nothing changed");
  return { raw: out, updated: done, skipped };
}

function main(write) {
  const raw = fs.readFileSync(SAVE, "utf8");
  const save = JSON.parse(raw);
  const { buildSave } = require("../tests/golden/table-run");
  const holds = JSON.parse(fs.readFileSync(path.join(__dirname, "deploy-holds.json"), "utf8"));
  const built = buildSave();
  const { script, stamp, taken, held } = patch(save.LuaScript, built.LuaScript, holds);

  for (const h of taken) console.log(`take  line ${h.at + 1}: -${h.gone.length} +${h.added.length}  ${(h.added[0] || h.gone[0] || "").trim().slice(0, 90)}`);
  for (const h of held) {
    const also = unheld(h, holds);
    console.log(`hold  line ${h.at + 1}: -${h.gone.length} +${h.added.length}  [${h.by}]${also.length ? `  and ${also.length} lines it doesn't name: ${also[0].trim().slice(0, 70)}` : ""}`);
  }

  const pieces = addPieces(rewrite(raw, script), built);
  if (pieces.added.length) console.log(`add   ${pieces.added.length} status pieces, parked under the table: ${pieces.added.join(", ")}`);
  const imp = importerScripts(pieces.raw, built);
  const out = imp.raw;
  if (imp.updated.length) console.log(`script ${imp.updated.join(", ")}: DeckCheck links added`);
  for (const g of imp.skipped) console.log(`skip  ${g}: its script isn't in the save's file once, so its DeckCheck links weren't added`);

  // what comes out has to load and start: a held hunk can leave something the taken ones need. This sees no board:
  // tools/deploy.js plays real ones on the file a dry run returns.
  const { simulate } = require("../tests/lua/run-sim");
  const trial = simulate({ save: { ...JSON.parse(out) }, steps: [{ lua: "return engineStamp()", mark: "stamp" }] });
  if (trial.errors.length) throw new Error(`the patched script doesn't run: ${trial.errors[0]}`);
  const said = trial.steps.find((s) => s.step === "stamp")?.value;
  if (said !== stamp) throw new Error(`the patched script says version ${said}, not ${stamp}`);

  console.log(`${taken.length} taken, ${held.length} held, version ${stamp}, save ${sha8(raw)} -> ${sha8(out)}`);
  if (!write) { console.log("dry run: nothing written"); return { trial: out }; }
  if (ttsRunning()) throw new Error("TTS is running: close it first, it would save over this");
  fs.mkdirSync(path.join(ROOT, "tmp", "backup"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "tmp", "backup", `TS_Save_1.${sha8(raw)}.json`), raw);
  // the new save too: a save deleted in TTS (2026-11-13, twice) is restored by copying this, with no rebuild
  fs.writeFileSync(path.join(ROOT, "tmp", "backup", `TS_Save_1.${sha8(out)}.json`), out);
  fs.writeFileSync(SAVE, out);
  console.log(`written; copies of the old and new saves are at tmp/backup/TS_Save_1.${sha8(raw)}.json and TS_Save_1.${sha8(out)}.json`);
  return { stamp, save: sha8(out) };
}

if (require.main === module) main(process.argv.includes("--write"));
module.exports = { patch, hunks, heldBy, unheld, apply, stamped, rewrite, statusGuids, addPieces, importerScripts, ttsRunning, main, SAVE };
