// Grades tests/test_state_delta_golden.js (the bridge/state-delta.js golden master) with tools/mutate-golden-lib.js:
// each mutation below is a plausible careless change to the patch rules; the golden must go red on it by name.
//   node tools/mutate-state-delta-golden.js [label pattern]
// First pass 2026-11-24: 22 of 24 caught (8.3%, SOUND). Both escapes are argued equivalent below and marked so.
const path = require("path");
const { runMutations } = require("./mutate-golden-lib");

const ROOT = path.join(__dirname, "..");

// [label, from, to, equivalent?]: `from` must occur exactly once in state-delta.js
const MUTATIONS = [
  ["isPlainObject: arrays count as objects", "typeof x === \"object\" && x !== null && !Array.isArray(x)", "typeof x === \"object\" && x !== null"],
  ["isPlainObject: null counts as an object", "typeof x === \"object\" && x !== null && !Array.isArray(x)", "typeof x === \"object\" && !Array.isArray(x)"],
  ["keyOf: a numeric id counts", "if (typeof element.id === \"string\") return element.id;", "if (element.id != null) return element.id;"],
  ["keyOf: zone key without the owner", "? `${element.zone}/${element.ownerId}` : null;", "? element.zone : null;"],
  ["keyOf: zone key without the ownerId check", "typeof element.zone === \"string\" && typeof element.ownerId === \"string\" ?", "typeof element.zone === \"string\" ?"],
  ["apply: $v by `in` (a prototype hit)", "if (Object.prototype.hasOwnProperty.call(patch, LITERAL)) return patch[LITERAL];", "if (patch[LITERAL] !== undefined) return patch[LITERAL];"],
  ["apply: a lone $d on a list merges as an object", "(Array.isArray(current) && REMOVE in patch)", "(false && REMOVE in patch)"],
  ["apply: $o alone not a list edit", "if (KEYED in patch || ORDER in patch ||", "if (KEYED in patch ||"],
  ["apply: current changed in place", "const out = Object.assign({}, isPlainObject(current) ? current : {});", "const out = isPlainObject(current) ? current : {};"],
  ["apply: $d not an array still read", "for (const k of Array.isArray(patch[REMOVE]) ? patch[REMOVE] : []) delete out[k];", "for (const k of [].concat(patch[REMOVE] || [])) delete out[k];"],
  ["apply: removes after the merge (order)", "  for (const k of Array.isArray(patch[REMOVE]) ? patch[REMOVE] : []) delete out[k];\n  for (const k of Object.keys(patch)) {\n    if (k !== REMOVE) out[k] = apply(Object.prototype.hasOwnProperty.call(out, k) ? out[k] : null, patch[k]);\n  }", "  for (const k of Object.keys(patch)) {\n    if (k !== REMOVE) out[k] = apply(Object.prototype.hasOwnProperty.call(out, k) ? out[k] : null, patch[k]);\n  }\n  for (const k of Array.isArray(patch[REMOVE]) ? patch[REMOVE] : []) delete out[k];"],
  ["apply: the $d key itself merged in", "if (k !== REMOVE) out[k] =", "out[k] ="],
  // (EQUIVALENT: apply() reads undefined and null alike, neither a plain object nor an array; a prototype hit such as
  // "toString" or "__proto__" gives a function or Object.prototype, and Object.assign copies no own keys from either)
  ["apply: a new key's base is undefined, not null (EQUIVALENT)", "Object.prototype.hasOwnProperty.call(out, k) ? out[k] : null, patch[k]", "out[k], patch[k]", true],
  ["editKeyedArray: a keyless element keyed by index", "let keys = list.map((el) => keyOf(el) ?? \"\");", "let keys = list.map((el, i) => keyOf(el) ?? `#${i}`);"],
  ["editKeyedArray: removed keys stay in the order", "  if (removed.size) keys = keys.filter((k) => !removed.has(k));\n", ""],
  ["editKeyedArray: a new key not added at the end", "    if (!byKey.has(k)) keys.push(k);\n", ""],
  ["editKeyedArray: a new key added at the front", "    if (!byKey.has(k)) keys.push(k);", "    if (!byKey.has(k)) keys.unshift(k);"],
  // (EQUIVALENT: every key in byKey is a string, from keyOf, "" or Object.entries, and Map.has never coerces, so the
  // last filter drops a non-string $o key either way)
  ["editKeyedArray: $o non-strings kept (EQUIVALENT)", "keys = patch[ORDER].filter((k) => typeof k === \"string\");", "keys = patch[ORDER].slice();", true],
  ["editKeyedArray: unknown $o keys kept as null", "return keys.filter((k) => byKey.has(k)).map((k) => byKey.get(k));", "return keys.map((k) => byKey.get(k) ?? null);"],
  ["editKeyedArray: $k not an object still read", "Object.entries(isPlainObject(patch[KEYED]) ? patch[KEYED] : {})", "Object.entries(patch[KEYED] || {})"],
  ["sortedJson: keys not sorted", "Object.keys(x).sort().map(", "Object.keys(x).map("],
  ["fingerprint: no padding", "return h.toString(16).padStart(16, \"0\");", "return h.toString(16);"],
  ["fingerprint: 32-bit mask", "MASK64 = (1n << 64n) - 1n;", "MASK64 = (1n << 32n) - 1n;"],
  ["fingerprint: multiply before xor (FNV-1 not 1a)", "h = ((h ^ BigInt(byte)) * FNV_PRIME) & MASK64;", "h = ((h * FNV_PRIME) ^ BigInt(byte)) & MASK64;"],
];

runMutations(path.join(ROOT, "bridge", "state-delta.js"), path.join(ROOT, "tests", "test_state_delta_golden.js"), MUTATIONS, process.argv[2]);
