// Golden-master runner for bridge/state-delta.js: apply() on a grid of current states and patches (each spec rule,
// the ugly end: null, arrays, primitives, "$v" of every kind, "$d" on objects and keyed arrays, "$k" adds and edits,
// "$o" with unknown and non-string keys, zone/owner keys, elements with no key, nested patches, prototype-named keys),
// recording the result, a throw, and whether `current` or `patch` changed (apply promises `current` never does).
// fingerprint() on a grid of states, including key order and unicode. Shared by tools/capture_state_delta_golden.js and
// tests/test_state_delta_golden.js.
const path = require("path");
const { enc } = require("./teams-run");

const MOD = path.join(__dirname, "..", "..", "bridge", "state-delta.js");
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

function runAll() {
  delete require.cache[require.resolve(MOD)];
  const D = require(MOD);
  const out = [{ name: "surface", result: Object.keys(D).sort().map((k) => [k, typeof D[k], D[k].length]) }];
  const cards = [{ id: "a", n: 1 }, { id: "b", n: 2 }, { id: "c", n: 3 }];
  const zones = [{ zone: "hand", ownerId: "p1", ids: [1] }, { zone: "hand", ownerId: "p2", ids: [] }, { zone: "lib", ownerId: "p1", ids: [9] }];
  const mixed = [{ id: "a" }, { name: "nokey" }, 5, null, { zone: "z" }, { id: 7 }, { id: "b" }];
  const currents = { undef: undefined, null: null, num: 5, str: "s", arr: [1, 2], empty: {}, obj: { a: 1, b: { c: 2, d: [1] }, e: null }, cards, zones, mixed,
    nested: { players: [{ id: "p1", life: 20, counters: { poison: 1 } }, { id: "p2", life: 18 }], turn: 3 }, protoKeys: { toString: 1, constructor: { x: 1 } } };
  const patches = {
    undef: undefined, null: null, num: 7, zero: 0, false: false, emptyStr: "", str: "x", arr: [9], emptyArr: [], emptyObj: {},
    lit: { $v: { a: 1 } }, litNull: { $v: null }, litUndef: { $v: undefined }, litArr: { $v: [1] }, litWithOthers: { $v: 1, a: 2 }, litNested: { a: { $v: { z: 1 } } },
    merge: { a: 2, f: 3 }, mergeDeep: { b: { c: 9 } }, mergeNullKeeps: { b: null }, deleteKeys: { $d: ["a", "zz"] }, deleteNotArray: { $d: "a" }, deleteAndSet: { $d: ["a"], a: 5 },
    deleteNested: { b: { $d: ["c"] } }, keyedEdit: { $k: { b: { n: 20 } } }, keyedAdd: { $k: { z: { id: "z", n: 26 } } }, keyedAddNoId: { $k: { q: { n: 1 } } }, keyedNotObj: { $k: [1] },
    keyedLit: { $k: { a: { $v: { id: "a", fresh: true } } } }, keyedNullPatch: { $k: { a: null } }, removeOnly: { $d: ["b"] }, removeAll: { $d: ["a", "b", "c"] }, removeUnknown: { $d: ["x"] },
    order: { $o: ["c", "a", "b"] }, orderPartial: { $o: ["c"] }, orderUnknown: { $o: ["x", "a"] }, orderNonString: { $o: ["a", 2, null, "b"] }, orderDup: { $o: ["a", "a"] }, orderNotArray: { $o: "abc" },
    keyedAndOrder: { $k: { z: { id: "z" } }, $o: ["z", "a"] }, removeAndKeyedSame: { $d: ["a"], $k: { a: { n: 100 } } }, zoneEdit: { $k: { "hand/p1": { ids: [1, 2] } } }, zoneRemove: { $d: ["lib/p1"] },
    emptyKeyRemove: { $d: [""] }, emptyKeyEdit: { $k: { "": { x: 1 } } }, nestedPlayers: { players: { $k: { p1: { life: 19, counters: { poison: 2 } } } }, turn: 4 },
    nestedPlayersAdd: { players: { $k: { p3: { id: "p3", life: 20 } }, $o: ["p3", "p1", "p2"] } }, protoPatch: { toString: 2, constructor: { y: 2 } }, protoProto: JSON.parse("{\"__proto__\": {\"polluted\": 1}}"),
    dollarOther: { $x: 1 }, removeInList: { $d: ["a"], other: 1 },
  };
  for (const [ck, cur] of Object.entries(currents)) {
    for (const [pk, p] of Object.entries(patches)) {
      const c0 = JSON.stringify(enc(cur)), p0 = JSON.stringify(enc(p));
      const row = { name: `apply ${ck} <- ${pk}` };
      try {
        const r = D.apply(cur, p);
        row.result = enc(r);
        if (r !== null && typeof r === "object" && r === cur) row.sameObjectAsCurrent = true;
        if (({}).polluted !== undefined) { row.prototypePolluted = true; delete Object.prototype.polluted; }
      } catch (e) { row.threw = { type: e?.constructor?.name, message: e?.message }; }
      if (JSON.stringify(enc(cur)) !== c0) row.currentChanged = enc(cur);
      if (JSON.stringify(enc(p)) !== p0) row.patchChanged = enc(p);
      out.push(row);
    }
  }
  // a sequence, as the bridge applies them: each result the next one's current
  {
    let s = clone(currents.nested);
    const seq = [{ turn: 5 }, { players: { $k: { p2: { life: 10 } } } }, { players: { $d: ["p1"] } }, { players: { $k: { p1: { id: "p1", life: 1 } } } }, { $d: ["turn"] }, { $v: { reset: true } }];
    const steps = [];
    for (const p of seq) { s = D.apply(s, p); steps.push(enc(s)); }
    out.push({ name: "apply: a sequence", result: steps });
  }
  // fingerprint
  const fps = { undef: undefined, null: null, zero: 0, negZero: -0, num: 1.5, str: "s", unicode: "ünï 🎉", emptyObj: {}, emptyArr: [], objAB: { a: 1, b: 2 }, objBA: { b: 2, a: 1 },
    nested: currents.nested, arrOrder: [1, 2], arrOrder2: [2, 1], undefInObj: { a: undefined, b: 1 }, undefInArr: [undefined, 1], nan: NaN, bigNested: { z: { y: { x: [{ w: "v" }] } } }, date: new Date(0) };
  for (const [k, v] of Object.entries(fps)) {
    const row = { name: `fingerprint ${k}` };
    try { row.result = D.fingerprint(v); } catch (e) { row.threw = { type: e?.constructor?.name, message: e?.message }; }
    out.push(row);
  }
  return out;
}

module.exports = { runAll };
