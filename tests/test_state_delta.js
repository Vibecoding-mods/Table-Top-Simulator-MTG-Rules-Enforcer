// Tests for bridge/state-delta.js against the rules of Manabrew's protocol specification, "State patches"
// (docs.manabrew.app/protocol/game-view, CC-BY-4.0), including its worked example. Each check names the rule.
//   node tests/test_state_delta.js
const delta = require("../bridge/state-delta");
// a throw is a named failure, never a crash that hides the later checks
const apply = (state, patch) => { try { return delta.apply(state, patch); } catch (e) { return `threw ${e.constructor.name}: ${e.message}`; } };
const fingerprint = (x) => { try { return delta.fingerprint(x); } catch (e) { return `threw ${e.message}`; } };

let failed = 0, passed = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) passed++; else { failed++; console.log(`FAIL ${name}\n    want ${w}\n    got  ${g}`); }
};

// objects merge: keys the patch leaves out are untouched
eq("merge: untouched keys stay", apply({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 9 } }), { a: 1, b: { c: 9, d: 3 } });
eq("merge: a new key is added", apply({ a: 1 }, { z: 2 }), { a: 1, z: 2 });
// scalars and arrays appear as themselves: null is a value, not a deletion; other arrays are replaced whole
eq("null is a value, not a deletion", apply({ a: 1, b: 2 }, { a: null }), { a: null, b: 2 });
eq("an unkeyed array is replaced whole", apply({ a: [1, 2, 3] }, { a: [9] }), { a: [9] });
eq("a scalar replaces", apply({ a: { deep: 1 } }, { a: 5 }), { a: 5 });
// $v: literal replacement (an object that must replace instead of merge)
eq("$v replaces instead of merging", apply({ a: { x: 1, y: 2 } }, { a: { $v: { x: 3 } } }), { a: { x: 3 } });
eq("$v of null", apply({ a: { x: 1 } }, { a: { $v: null } }), { a: null });
// $d: removal (object keys)
eq("$d removes object keys", apply({ a: 1, b: 2, c: 3 }, { $d: ["a", "c"] }), { b: 2 });
eq("$d and an edit together", apply({ a: 1, b: 2 }, { $d: ["a"], b: 5 }), { b: 5 });
// $k: keyed array edits; the key is the element's id; zone entries use "<zone>/<ownerId>"
const cards = [{ id: "c1", n: 1 }, { id: "c2", n: 2 }, { id: "c3", n: 3 }];
eq("$k edits an element by id", apply(cards, { $k: { c2: { n: 20 } } }), [{ id: "c1", n: 1 }, { id: "c2", n: 20 }, { id: "c3", n: 3 }]);
eq("$k on a missing key inserts at the end", apply(cards, { $k: { c9: { $v: { id: "c9", n: 9 } } } }), [...cards, { id: "c9", n: 9 }]);
eq("$d removes array elements by key", apply(cards, { $d: ["c1", "c3"] }), [{ id: "c2", n: 2 }]);
eq("$o is the new order", apply(cards, { $o: ["c3", "c1", "c2"] }), [cards[2], cards[0], cards[1]]);
eq("$o alone still edits as a keyed array", apply(cards, { $o: ["c2"] }), [cards[1]]);
eq("$d then $k of the same key: removed, then added at the end once", apply(cards, { $d: ["c1"], $k: { c1: { $v: { id: "c1", n: 9 } } } }), [cards[1], cards[2], { id: "c1", n: 9 }]);
eq("$o naming an unknown key ignores it", apply(cards, { $o: ["c3", "zz", "c1", "c2"] }), [cards[2], cards[0], cards[1]]);
eq("$o: [] empties the array", apply(cards, { $d: ["c1", "c2", "c3"], $o: [] }), []);
const zones = [{ zone: "hand", ownerId: "player-0", count: 7 }, { zone: "hand", ownerId: "player-1", count: 6 }];
eq("zone entries are keyed zone/ownerId", apply(zones, { $k: { "hand/player-1": { count: 5 } } }), [zones[0], { zone: "hand", ownerId: "player-1", count: 5 }]);
eq("an id is a string; a numeric id is no key", apply([{ id: 1, n: 1 }], { $k: { 1: { n: 2 } } }), [{ id: 1, n: 1 }, { n: 2 }]);
// the state passed in is never changed
{
  const before = { a: { b: 1 }, list: [{ id: "x", v: 1 }] };
  const copy = JSON.stringify(before);
  apply(before, { a: { b: 2 }, list: { $k: { x: { v: 2 } } } });
  eq("the input state is not changed", JSON.stringify(before), copy);
}

// the specification's worked example: Lightning Bolt (card-7) resolves against player 0
{
  const state = { gameView: { priorityPlayerId: "player-1",
    players: [{ id: "player-0", life: 20 }, { id: "player-1", life: 20 }],
    zones: [{ zone: "graveyard", ownerId: "player-1", count: 1, cards: [{ id: "card-3" }] }],
    stack: [{ id: "card-7" }] } };
  const patch = { gameView: { priorityPlayerId: "player-0",
    players: { $k: { "player-0": { life: 17 } } },
    zones: { $k: { "graveyard/player-1": { count: 2, cards: { $k: { "card-7": { $v: { visibility: "visible", id: "card-7" } } }, $o: ["card-7", "card-3"] } } } },
    stack: { $d: ["card-7"], $o: [] } } };
  eq("spec example: Lightning Bolt resolves", apply(state, patch), { gameView: { priorityPlayerId: "player-0",
    players: [{ id: "player-0", life: 17 }, { id: "player-1", life: 20 }],
    zones: [{ zone: "graveyard", ownerId: "player-1", count: 2, cards: [{ visibility: "visible", id: "card-7" }, { id: "card-3" }] }],
    stack: [] } });
}

// fingerprint (latency test only): 64-bit FNV-1a over key-sorted JSON; values recorded from the engine-matching version
eq("fingerprint of {}", fingerprint({}), "08f44b07b5901a25");
eq("fingerprint: known value", fingerprint({ gameView: { turn: 3, players: [{ id: "p", life: 40 }] } }), "52f02547d556e19f");
eq("fingerprint: key order doesn't matter", fingerprint({ b: 1, a: [null, "é"] }), fingerprint({ a: [null, "é"], b: 1 }));
eq("fingerprint: known value with unicode", fingerprint({ b: 1, a: [null, "é"] }), "918e799b4a97f70c");
eq("fingerprint: 16 hex digits", /^[0-9a-f]{16}$/.test(fingerprint({ x: 1 })), true);

console.log(failed ? `\n${failed} state-delta checks failed (${passed} passed)` : `all ${passed} state-delta checks pass`);
process.exit(failed ? 1 : 0);
