// Holds bridge/table-map.js to the code, so the map can't quietly go stale.
//   node tests/test_table_map.js            prints the known gaps as well: --gaps
const fs = require("fs");
const path = require("path");
const { CARD_FACTS, TABLE_ONLY_KEYS, ZONES, GESTURES } = require("../bridge/table-map");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const protocol = read("manabrew/manabrew-rs/crates/manabrew-protocol/src/game/mod.rs");
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
