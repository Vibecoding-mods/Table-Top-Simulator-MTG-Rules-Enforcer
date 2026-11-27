// A table message can name an op, a card id or a drag kind the lists don't hold: "constructor", "toString", "__proto__"
// are not ops (a plain-object lookup found a function there). Own keys only, 2026-11-27. No TTS, no ports.
//   node tests/test_bridge_fixops_keys.js
const harness = require("./bridge-harness");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 300)}` : ""}\n`); } };
const h = harness.load();
try {
  const pub = { zones: [{ zone: "battlefield", ownerId: "player-0", cards: [{ id: "c1", identity: { name: "Bear" }, ownerId: "player-0", controllerId: "player-0" }] }] };
  for (const op of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    let r;
    try { r = h.B.fixOps([{ op }], pub); } catch (e) { r = { threw: String(e) }; }
    ok(`fix op "${op}" is refused as unreadable`, /^Can't read the change/.test(r.error || ""), JSON.stringify(r));
  }
  let r;
  try { r = h.B.fixOps([{ op: "tap", card: "constructor", tapped: true }], pub); } catch (e) { r = { threw: String(e) }; }
  ok("a card id of \"constructor\" is no card", !!r.error && !r.threw, JSON.stringify(r));
  try { r = h.B.fixOps([{ op: "tap", card: "c1", tapped: true }], pub); } catch (e) { r = { threw: String(e) }; }
  ok("a real card still passes", !r.error && !r.threw, JSON.stringify(r));
} finally { harness.restore(); }
process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} fix-op key checks pass\n`);
process.exit(failed ? 1 : 0);
