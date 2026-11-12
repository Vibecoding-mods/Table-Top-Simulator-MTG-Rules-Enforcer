// Holds bridge/table-map.js to the code, so the map can't quietly go stale.
//   node tests/test_table_map.js            prints the known gaps as well: --gaps
const fs = require("fs");
const path = require("path");
const { CARD_FACTS, TABLE_ONLY_KEYS, ZONES, GESTURES, PLAYER_FACTS } = require("../bridge/table-map");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
// (MTG_MANABREW: the manabrew tree the engine going out was built from, when the shared checkout is older than it;
// the protocol's fields are the engine's, so the map is held to that engine's)
const protocol = process.env.MTG_MANABREW
  ? fs.readFileSync(path.join(process.env.MTG_MANABREW, "manabrew-rs/crates/manabrew-protocol/src/game/mod.rs"), "utf8").replace(/\r\n/g, "\n")
  : read("manabrew/manabrew-rs/crates/manabrew-protocol/src/game/mod.rs");
const struct = (name) => {
  const at = protocol.indexOf(`pub struct ${name} `);
  return at < 0 ? "" : protocol.slice(at, protocol.indexOf("\n}\n", at));
};
const fields = [...struct("CardDto").matchAll(/pub ([a-z_0-9]+):/g)].map((m) => camel(m[1]));
ok("the protocol parsed: CardDto has its fields", fields.length > 40 && fields.includes("phasedOut"), `${fields.length} fields`);
for (const f of fields) ok(`CardDto.${f} is mapped`, !!CARD_FACTS[f], "add it to CARD_FACTS: shown, a gap, or why not");
for (const f of Object.keys(CARD_FACTS)) ok(`${f} is still a CardDto field`, fields.includes(f));

const bridge = read("bridge/bridge.js");
const lua = read("tools/engine-renderer.lua");
const check = lua.slice(lua.indexOf("function engineSelfCheck()"), lua.indexOf("function engineCheckRun()"));
const from = bridge.indexOf("function tableCard("), to = bridge.indexOf("// The cards haunting a creature");
const tableCard = bridge.slice(from, to).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
const mapped = new Set(Object.values(CARD_FACTS).flatMap((f) => f.to || []));
// the object keys of tableCard's two returned shapes (the words inside its helpers are not keys)
const sent = [...new Set([...tableCard.matchAll(/(?:\{ |, |^\s+|\.\.\.\(c\.\w+[^?]*\? \{ )([a-zA-Z]{1,6}): /gm)].map((m) => m[1]))];
ok("tableCard parsed: its keys were found", sent.includes("tap") && sent.includes("po") && sent.includes("ctr"), sent.join(" "));
const NOT_KEYS = new Set(["kw"]);
for (const k of sent) ok(`table key ${k} is mapped`, mapped.has(k) || TABLE_ONLY_KEYS[k] || NOT_KEYS.has(k), "add it to the fact it shows");
for (const [f, e] of Object.entries(CARD_FACTS)) for (const k of e.to || []) {
  if (k !== "playable") ok(`${f}: tableCard sends ${k}`, new RegExp(`\\b${k}: |\\b${k}\\b.*\\[`).test(tableCard), "the map names a key that is gone");
  ok(`${f}: the table reads ${k}`, new RegExp(`\\.${k}\\b`).test(lua), "sent, and nothing reads it: a gap, not a fact shown");
}
// a fact the map says is checked on the live table has its marked line in engineSelfCheck
ok("engineSelfCheck was found", check.length > 1000 && check.includes("-- map:present"), `${check.length} characters`);
for (const [f, e] of Object.entries(CARD_FACTS)) if (e.check) ok(`${f}: engineSelfCheck checks ${e.check}`, check.includes(`-- map:${e.check}`), `no "-- map:${e.check}" line`);

// every PlayerDto field is mapped, and a key it names is in sendTable's player row and read by the table
const playerFields = [...struct("PlayerDto").matchAll(/pub ([a-z_0-9]+):/g)].map((m) => camel(m[1]));
ok("the protocol parsed: PlayerDto has its fields", playerFields.length > 20 && playerFields.includes("ringLevel"), `${playerFields.length} fields`);
for (const f of playerFields) ok(`PlayerDto.${f} is mapped`, !!PLAYER_FACTS[f], "add it to PLAYER_FACTS: shown, a gap, or why not");
for (const f of Object.keys(PLAYER_FACTS)) ok(`${f} is still a PlayerDto field`, playerFields.includes(f));
const send = bridge.slice(bridge.indexOf("function sendTable("), bridge.indexOf("function sendTable(") + 6000);
const marksFn = bridge.slice(bridge.indexOf("function playerMarks("), bridge.indexOf("function cardIndex("));
// (a key playerMarks sends beside allMarks: a PLAYER_MARKS row's value under a row key of its own, its `row`, extraTurns;
// playerMarks sends every row's)
const marksKeys = new Set([...marksFn.matchAll(/\{ key: "\w+", row: "(\w+)"/g)].map((m) => m[1]));
ok("playerMarks: precondition, its own row keys were found (extraTurns), and it sends each row's", marksKeys.has("extraTurns") && /\.\.\.playerMarks\(p, pub\)/.test(send)
  && /for \(const m of PLAYER_MARKS\) if \(m\.row && markShown\(values\[m\.key\]\)\) out\[m\.row\] = values\[m\.key\];/.test(marksFn), [...marksKeys].join(" "));
for (const [f, e] of Object.entries(PLAYER_FACTS)) for (const k of e.to || []) {
  ok(`${f}: the player row sends ${k}`, k === "allMarks" ? /\.\.\.playerMarks\(p, pub\)/.test(send) && /\{ allMarks: labels \}/.test(marksFn)
    : new RegExp(`\\b${k}\\b`).test(send) || marksKeys.has(k), "the map names a key that is gone");
  ok(`${f}: the table reads ${k}`, new RegExp(`\\.${k}\\b|\\[k\\]`).test(lua), "sent, and nothing reads it");
  if (k === "allMarks") ok(`${f}: PLAYER_MARKS reads it`, new RegExp(`\\bp\\.${f}\\b|"${f.replace(/s$/, "")}"|playerCounter\\(p`).test(marksFn), "no PLAYER_MARKS row reads this field");
}
// (verifier finding 3, 2026-11-06) the other way round: every Forge player field a PLAYER_MARKS row reads is mapped to
// allMarks, not skipped or called a gap (p.<field>, and counters through playerCounter); id says which player
const marksRead = new Set([...marksFn.matchAll(/\bp\.([A-Za-z_]\w*)\b/g)].map((m) => m[1]));
if (/\bplayerCounter\(p\b/.test(marksFn)) marksRead.add("counters");
ok("PLAYER_MARKS reads: precondition, the rows' fields were found (counters, ringLevel, speed, controlledBy, isExtraTurn)",
  ["counters", "ringLevel", "speed", "controlledBy", "isExtraTurn"].every((f) => marksRead.has(f)) && marksRead.size >= 10, [...marksRead].join(" "));
for (const f of marksRead) {
  if (f === "id") { ok("PLAYER_MARKS reads id: mapped", !!PLAYER_FACTS.id?.to?.length, JSON.stringify(PLAYER_FACTS.id)); continue; }
  ok(`PLAYER_MARKS reads ${f}: PLAYER_FACTS maps it to allMarks or a row key playerMarks sends`,
    !!PLAYER_FACTS[f]?.to?.some((k) => k === "allMarks" || marksKeys.has(k)),
    `${JSON.stringify(PLAYER_FACTS[f])}: a mark is drawn from it, so it is no skip or gap`);
}
// (trackMarks step 6) the old mark fields are gone from the row and from the table: no player row key, no Lua reader
for (const k of ["marks", "poison", "energy", "monarch", "initiative", "blessed", "story"]) {
  ok(`old mark field ${k}: no PLAYER_FACTS entry maps to it`, !Object.values(PLAYER_FACTS).some((e) => (e.to || []).includes(k)), "the map names an old field");
  ok(`old mark field ${k}: playerMarks doesn't send it`, !new RegExp(`\\b${k}:`).test(marksFn.slice(0, marksFn.indexOf("\n}\n"))), "an old field is back on the row");
  ok(`old mark field ${k}: the table doesn't read it`, !new RegExp(`\\bpl\\.${k}\\b|\\bpl\\[k\\]`).test(lua), "the renderer reads an old field again");
}

const zones = [...(protocol.match(/pub enum ZoneKind \{[^}]*\}/)?.[0] || "").matchAll(/^\s+([A-Z][a-z]+),/gm)].map((m) => m[1]);
ok("the protocol parsed: ZoneKind has its zones", zones.includes("Exile"), zones.join(" "));
for (const z of zones) ok(`zone ${z} is mapped`, !!ZONES[z]);

const kinds = [...new Set([...lua.matchAll(/request\((?:color|c|chooser), "([a-z]+)"/g), ...lua.matchAll(/"intent", \{ color = \w+, kind = "([a-z]+)"/g)].map((m) => m[1]))];
ok("the renderer parsed: gestures were found", kinds.includes("play"), kinds.join(" "));
for (const k of kinds) ok(`gesture ${k} is mapped`, !!GESTURES[k]);
for (const k of Object.keys(GESTURES)) {
  ok(`gesture ${k}: the table sends it`, kinds.includes(k));
  ok(`gesture ${k}: the bridge reads it`, new RegExp(`\\b${k}\\b`).test(bridge.slice(bridge.indexOf("function onIntent("))));
}

if (process.argv.includes("--gaps")) {
  console.log("\nEngine facts the table doesn't show:");
  for (const [f, e] of Object.entries(CARD_FACTS)) if (e.gap) console.log(`  ${f}: ${e.gap}`);
  for (const [z, e] of Object.entries(ZONES)) if (e.gap) console.log(`  zone ${z}: ${e.gap}`);
}
console.log(failed ? `\n${failed} map checks failed (${passed} passed)` : `all ${passed} map checks pass`);
process.exit(failed ? 1 : 0);
