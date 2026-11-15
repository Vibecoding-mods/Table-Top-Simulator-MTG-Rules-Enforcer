// Live smoke check of the DeckCheck API shape (docs/deckcheck-spec.md). Hand-run only, never a gate.
//   node tools/deckcheck-smoke.js <deckcheck link or id>
// One GET, no API key, nothing saved: DeckCheck's terms forbid storing or redistributing their data. It prints the
// response's skeleton (keys and types, no values beyond counts) and runs it through tools/deckcheck.lua and the same
// shape check the tests use, to catch API drift.
const path = require("path");
const load = require(path.join(__dirname, "..", "tests", "lua", "deckcheck-run"));
const { shapeProblems } = load;

const arg = process.argv[2];
if (!arg) { console.error("usage: node tools/deckcheck-smoke.js <deckcheck link or id>"); process.exit(2); }
const dc = load();
const id = /^[\w-]+$/.test(arg) ? arg : dc.id(arg);
if (!id) { console.error(`FAIL: not a DeckCheck deck link: ${arg}`); process.exit(1); }

// keys and types only; objects keyed by ids show one sample entry
function skeleton(v, depth = 0) {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? `[${skeleton(v[0], depth + 1)} x${v.length}]` : "[]";
  if (typeof v !== "object") return typeof v;
  const keys = Object.keys(v);
  if (depth > 0 && keys.length > 3 && keys.every((k) => !/^[a-z][A-Za-z]*$/.test(k))) return `{<id>: ${skeleton(v[keys[0]], depth + 1)} x${keys.length}}`;
  return `{ ${keys.map((k) => `${k}: ${skeleton(v[k], depth + 1)}`).join(", ")} }`;
}

(async () => {
  const res = await fetch(`https://deckcheck.co/api/external/deck?deck_id=${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } });
  const text = await res.text();
  let raw = null;
  try { raw = JSON.parse(text); } catch (e) { console.error(`FAIL: status ${res.status}, not JSON (${text.length} bytes)`); process.exit(1); }
  if (!res.ok) { console.log(`status ${res.status}: ${dc.error(res.status, text)}`); process.exit(1); }
  console.log(`status ${res.status}, ${text.length} bytes`);
  console.log("skeleton:", skeleton(raw));
  const info = dc.entries(text);
  const problems = shapeProblems(raw, info);
  if (info) {
    const n = info.entries.reduce((s, e) => s + e.count, 0);
    console.log(`deckcheckEntries: ${info.commanders.length} commander(s), ${info.entries.length} entries, ${n} cards, label ${JSON.stringify(dc.enc(`deckcheckLabel(JSON.decode(${JSON.stringify(JSON.stringify({ bracket: info.bracket, threatIndex: info.threatIndex, maxThreat: info.maxThreat }))}))`))}`);
  }
  if (problems.length) { console.log(`FAILED: ${problems.length} shape problem(s)`); for (const p of problems.slice(0, 30)) console.log("  " + p); process.exit(1); }
  console.log("PASSED: the live response matches the documented shape");
})().catch((e) => { console.error(`FAIL: ${e.message}`); process.exit(1); });
