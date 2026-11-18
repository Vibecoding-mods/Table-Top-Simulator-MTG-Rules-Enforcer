// Break-it for a Standard sideboard on a deck imported on the table (tests/test_bridge_sideboard_imported.js,
// tests/test_table_sideboard_imported.js): each mutation switches one piece off, runs both tests, and must make the
// check it names fail by name; then the file is put back and checked by sha256. A mutation whose named check still
// passes is printed as SURVIVED.
//   node tools/mutate-sideboard-imported.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_bridge_sideboard_imported.js", "tests/test_table_sideboard_imported.js"];
const B = "bridge/bridge.js", C = "tools/make-engine-copy.js", R = "tools/engine-renderer.lua";

// [label, file, from, to, the check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["the bridge reads no sideboard", B, "  if (std) for (const c of asList(entry.sideboard)) { const n = resolve(c); if (n) sideboard.push(n); }", "  if (false) for (const c of asList(entry.sideboard)) { const n = resolve(c); if (n) sideboard.push(n); }",
    "ready: a 60-card deck with the 15 on the graveyard spot is ready for Standard, the sideboard counted"],
  ["the sideboard not checked with the deck", B, "problems.push(...standardProblems(cards, commanders, sideboard));", "problems.push(...standardProblems(cards, commanders));",
    "checked: a 16-card sideboard is refused (at most 15)"],
  ["the sideboard not kept with the ready deck", B, "images, mode, ...(std ? { sideboard } : {}) };", "images, mode };",
    "ready: the bridge keeps the sideboard with the deck"],
  ["the ready line to everyone", B, "chat(`[MTG] ${label}: ready for Standard. ${cards.length} cards; every card is known to the engine and legal in Standard.${sb}${foreign}${artSaid}`, color);", "chat(`[MTG] ${label}: ready for Standard. ${cards.length} cards; every card is known to the engine and legal in Standard.${sb}${foreign}${artSaid}`);",
    "private: the sideboard is said to Blue only, never to the table"],
  ["the log names the sideboard's cards", B, "${sideboard.length ? `, sideboard ${sideboard.length}` : \"\"}", "${sideboard.length ? `, sideboard ${sideboard.join(\", \")}` : \"\"}",
    "private: the log counts it and names no sideboard card"],
  ["a Commander deck keeps a sideboard too", B, "images, mode, ...(std ? { sideboard } : {}) };", "images, mode, sideboard };",
    "commander: a deck on the graveyard spot is left alone (ready as before, no sideboard)"],
  ["foreign sideboard names not looked up", B, "...asList(entry?.library), ...asList(entry?.sideboard)]) {", "...asList(entry?.library)]) {",
    "foreign: a sideboard card the engine doesn't know by name is looked up on Scryfall first"],
  ["the table reads no sideboard", C, "    local side = gy and getDeckFromZone(gy)\n", "    local side = nil\n",
    "sideboard: a deck on the graveyard spot goes as the seat's sideboard, with the cards' pictures"],
  ["one card there not read", C, "      if side.type == \"Card\" then entry.sideboard[1] = cardInfo(sd)", "      if false then entry.sideboard[1] = cardInfo(sd)",
    "sideboard: one card there is a sideboard of one"],
  ["stand-ins and engine cards sent", C, "          if c.GMNotes ~= \"libcard\" and tostring(c.GMNotes or \"\"):sub(1, 6) ~= \"engine\" then", "          if true then",
    "sideboard: the table's library stand-ins and engine cards in it are never sent"],
  ["an engine deck on the spot taken for a sideboard", C, "    if side ~= nil and tostring(side.getGMNotes()):sub(1, 6) ~= \"engine\" then", "    if side ~= nil then",
    "sideboard: an engine deck on the spot is not a sideboard"],
  ["the sideboard left on the table at the start", R, "    stashObject(engineSideboardObject(color))\n", "",
    "stash: a game start puts the sideboard away with the deck (below the table, hidden from everyone), the end back"],
  ["mtg clear deck leaves the sideboard", R, "  take(engineSideboardObject(color)) -- (its sideboard on the graveyard spot too)\n", "",
    "clear deck: mtg clear deck removes the sideboard with the deck"],
  ["an Identity card taken for a sideboard", R, " or tostring(o.getName()):find(\"Identity\", 1, true) ~= nil then return nil end", " then return nil end",
    "sideboard: engineSideboardObject, the deck or card there, never the engine's or an Identity card"],
  ["the engine's own taken for a sideboard", R, "(o.type ~= \"Deck\" and o.type ~= \"Card\") or tostring(o.getGMNotes()):sub(1, 6) == \"engine\" or", "(o.type ~= \"Deck\" and o.type ~= \"Card\") or",
    "sideboard: engineSideboardObject, the deck or card there, never the engine's or an Identity card"],
];
function runTests() {
  const failed = [];
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
    const out = (r.stdout || "") + (r.stderr || "");
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*FAIL[: ]\s*(.+)$/);
      if (m && !/^test_/.test(m[1])) failed.push(m[1]);
    }
    if (r.status !== 0 && !failed.length) failed.push(`${t} exit ${r.status}: ${out.split("\n").slice(-3).join(" ").slice(0, 160)}`);
  }
  return failed;
}

const only = process.argv[2] ? new RegExp(process.argv[2], "i") : null; // (a label pattern: just those mutations)
const base = runTests();
console.log(base.length ? `BASELINE FAILS: ${base.join(" | ")}` : "baseline: green");
if (base.length) process.exit(1);
let survived = 0;
const list = MUTATIONS.filter(([label]) => !only || only.test(label));
for (const [label, rel, from, to, want] of list) {
  const file = path.join(ROOT, rel);
  const before = sha(file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) { console.log(`?? ${label}: the code to break is not there once`); survived++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let failed;
  try { failed = runTests(); } finally { fs.writeFileSync(file, text); }
  const restored = sha(file) === before;
  const named = failed.some((f) => f === want || f.startsWith(`${want}:`));
  if (!named || !restored) survived++;
  console.log(`${named ? "caught" : "SURVIVED"}: ${label} -> ${named ? want : `(wanted "${want}") ${failed.map((f) => f.slice(0, 90)).join(" | ") || "nothing failed"}`}${restored ? "" : "  RESTORE MISMATCH"}`);
}
console.log(survived ? `${survived} of ${list.length} survived` : `all ${list.length} caught by their named check, every file restored by sha256`);
process.exit(survived ? 1 : 0);
