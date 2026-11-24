// Golden-master runner for bridge/accomplishments.js: steamKey on a grid (both sides of its 5..20 digit bound, numbers,
// spaces, null), and createAccomplishments sessions on a frozen clock with a recording store and log: the file read
// back and cleaned (bad Steam IDs, unknown ids, bad counts, prototype-named ids), earn and list, the day stamp at both
// sides of midnight UTC, the 2000-player cap, a store that throws. Every store read and write is recorded exactly.
// Shared by tools/capture_accomplishments_golden.js and tests/test_accomplishments_golden.js.
const path = require("path");
const crypto = require("crypto");
const { enc } = require("./teams-run");

const MOD = path.join(__dirname, "..", "..", "bridge", "accomplishments.js");
const T0 = Date.UTC(2026, 10, 24, 12, 0, 0);
const S1 = "76561198000000001", S2 = "76561198000000002";

const call = async (fn) => { try { return { result: enc(await fn()) }; } catch (e) { return { threw: { type: e?.constructor?.name, message: String(e?.message) } }; } };

function makeStore(rec, o = {}) {
  let saved = o.saved === undefined ? null : JSON.parse(JSON.stringify(o.saved));
  return {
    read() { rec.push({ read: 1 }); if (o.readThrows) throw Object.assign(new Error("EACCES secret path"), o.readThrows === "code" ? { code: "EACCES" } : {}); return saved; },
    write(obj) { rec.push({ write: enc(obj) }); if (o.writeThrows) throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); saved = JSON.parse(JSON.stringify(obj)); },
  };
}

async function runAll() {
  delete require.cache[require.resolve(MOD)];
  const A = require(MOD);
  const out = [{ name: "surface", result: enc(Object.keys(A).sort().map((k) => [k, typeof A[k], typeof A[k] === "function" ? A[k].length : A[k]])) }];
  for (const s of [S1, "1234", "12345", "1".repeat(20), "1".repeat(21), 76561198000000000, 12345, null, undefined, "", " 12345", "12345 ", "12a45", "-12345", "1e10", "00000"]) out.push({ name: `steamKey ${JSON.stringify(s) ?? "undefined"}`, ...(await call(() => A.steamKey(s))) });
  const sc = [];
  const add = (name, o, steps) => sc.push({ name, o, steps });
  const day = (ms) => (c) => { c.t = T0 + ms; return new Date(c.t).toISOString(); };
  add("memory only: earn, again, list", {}, [["earn", (c) => c.a.earn(S1, "forced-tie")], ["+1 day", day(86400000)], ["earn again", (c) => c.a.earn(S1, "forced-tie")], ["list", (c) => c.a.list(S1)], ["list other", (c) => c.a.list(S2)]]);
  add("refused: no Steam ID, unknown id, prototype ids", { store: {} }, [["colour", (c) => c.a.earn("color:Red", "forced-tie")], ["null steam", (c) => c.a.earn(null, "forced-tie")], ["unknown", (c) => c.a.earn(S1, "nope")],
    ["toString", (c) => c.a.earn(S1, "toString")], ["constructor", (c) => c.a.earn(S1, "constructor")], ["__proto__", (c) => c.a.earn(S1, "__proto__")], ["list", (c) => c.a.list(S1)], ["list bad steam", (c) => c.a.list("x")]]);
  add("the day stamp is UTC, at midnight", { store: {} }, [["23:59:59.999", day(12 * 3600000 - 1)], ["earn", (c) => c.a.earn(S1, "forced-tie")], ["00:00", day(12 * 3600000)], ["earn", (c) => c.a.earn(S1, "forced-tie")]]);
  add("file read back and cleaned", { store: { saved: { version: 1, players: {
    [S1]: { "forced-tie": { name: "Old name", text: "old", count: 3, first: "2026-01-01", last: "2026-02-02", extra: 1 } },
    [S2]: { "forced-tie": { count: 0 } }, "123": { "forced-tie": { count: 1 } }, "76561198000000003": { "forced-tie": { count: 1.5 } }, "76561198000000004": { "forced-tie": { count: "2" } },
    "76561198000000005": { nope: { count: 1 }, toString: { count: 1 }, constructor: { count: 2 } }, "76561198000000006": "x", "76561198000000007": { "forced-tie": { count: 2, first: 5, last: null } },
    "76561198000000008": { "forced-tie": null }, "76561198000000009": { "forced-tie": { count: 1, first: 0, last: false } } } } } },
  [["S1", (c) => c.a.list(S1)], ["S2 (count 0)", (c) => c.a.list(S2)], ["3 (1.5)", (c) => c.a.list("76561198000000003")], ["4 ('2')", (c) => c.a.list("76561198000000004")], ["5 (unknown / prototype ids)", (c) => c.a.list("76561198000000005")],
    ["7 (first/last not strings)", (c) => c.a.list("76561198000000007")], ["9 (first 0, last false: empty)", (c) => c.a.list("76561198000000009")], ["earn S1 keeps count and first, takes today's name", (c) => c.a.earn(S1, "forced-tie")]]);
  add("file: players missing or wrong", { store: { saved: { players: [1, 2] } } }, [["list", (c) => c.a.list(S1)]]);
  add("file: not an object", { store: { saved: "x" } }, [["list", (c) => c.a.list(S1)]]);
  add("read throws with a code (message not logged)", { store: { readThrows: "code" } }, [["list", (c) => c.a.list(S1)], ["earn works", (c) => c.a.earn(S1, "forced-tie")], ["list again (read once)", (c) => c.a.list(S1)]]);
  add("read throws without a code", { store: { readThrows: "plain" } }, [["list", (c) => c.a.list(S1)]]);
  add("write throws (logged, answer kept)", { store: { writeThrows: true } }, [["earn", (c) => c.a.earn(S1, "forced-tie")], ["list", (c) => c.a.list(S1)]]);
  add("order: who earned most recently is kept; past 2000 the oldest goes", { store: {} }, [
    ["bulk: 2001 players", (c) => { for (let i = 0; i < 2001; i++) c.a.earn(String(10000000 + i), "forced-tie"); return [c.a.list("10000000").length, c.a.list("10000001").length, c.a.list("10002000").length]; }],
    ["bulk: 10000001 again, then one more", (c) => { c.a.earn("10000001", "forced-tie"); c.a.earn("20000000", "forced-tie"); return [c.a.list("10000001")[0]?.count, c.a.list("10000002").length]; }]]);
  add("returned entries are copies", { store: {} }, [["earn and change it", (c) => { const e = c.a.earn(S1, "forced-tie"); e.count = 99; const l = c.a.list(S1); l[0].count = 98; return c.a.list(S1); }]]);
  for (const s of sc) {
    const rec = [];
    const c = { t: T0 };
    c.a = A.createAccomplishments({ store: s.o.store ? makeStore(rec, s.o.store) : undefined, now: () => c.t, log: (l) => rec.push({ log: l }) });
    for (const [label, fn] of s.steps) {
      const at = rec.length;
      const r = await call(() => fn(c));
      if (label.startsWith("bulk")) { const mine = rec.splice(at); rec.push({ bulk: mine.length, sha256: crypto.createHash("sha256").update(JSON.stringify(mine)).digest("hex") }); }
      rec.push({ step: label, ...r });
    }
    out.push({ name: `session: ${s.name}`, effects: rec });
  }
  out.push({ name: "ACCOMPLISHMENTS unchanged after every session", result: enc(A.ACCOMPLISHMENTS) });
  return out;
}

module.exports = { runAll };
