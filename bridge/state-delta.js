// Applies the engine's `stateDelta` patches, written from Manabrew's published protocol specification, "State
// patches" (https://docs.manabrew.app/protocol/game-view/, CC-BY-4.0, © the Manabrew authors). In short:
//   - a patch has the shape of the state it edits; objects merge key by key, keys the patch leaves out stay;
//   - anything that isn't a plain object (a number, string, null, an array) replaces the value as it is;
//   - {"$v": x} replaces the value with x (an object that must not be merged);
//   - "$d": [keys] removes those keys (from an object, or elements from a keyed array);
//   - "$k": {key: patch} edits elements of a keyed array (key = the element's `id`, or "<zone>/<ownerId>" for zone
//     entries); a key that isn't there is added at the end;
//   - "$o": [keys] is the new order of a keyed array.
// The client never trusts its own hash: it compares the patch's `base` with the fingerprint the engine sent with the
// state it holds (the bridge does that in Seat.onEnvelope). `fingerprint` below exists only for the latency test.

const LITERAL = "$v", REMOVE = "$d", KEYED = "$k", ORDER = "$o";

function isPlainObject(x) { return typeof x === "object" && x !== null && !Array.isArray(x); }

function keyOf(element) {
  if (!isPlainObject(element)) return null;
  if (typeof element.id === "string") return element.id;
  return typeof element.zone === "string" && typeof element.ownerId === "string" ? `${element.zone}/${element.ownerId}` : null;
}

// The new value of `current` after `patch` (`current` itself is never changed).
function apply(current, patch) {
  if (!isPlainObject(patch)) return patch;
  if (Object.prototype.hasOwnProperty.call(patch, LITERAL)) return patch[LITERAL];
  // (a list that only loses elements has "$d" alone: still a list edit, not an object merge)
  if (KEYED in patch || ORDER in patch || (Array.isArray(current) && REMOVE in patch)) return editKeyedArray(current, patch);
  const out = Object.assign({}, isPlainObject(current) ? current : {});
  for (const k of Array.isArray(patch[REMOVE]) ? patch[REMOVE] : []) delete out[k];
  for (const k of Object.keys(patch)) {
    if (k !== REMOVE) out[k] = apply(Object.prototype.hasOwnProperty.call(out, k) ? out[k] : null, patch[k]);
  }
  return out;
}

function editKeyedArray(current, patch) {
  const list = Array.isArray(current) ? current : [];
  let keys = list.map((el) => keyOf(el) ?? "");
  const byKey = new Map(list.map((el, i) => [keys[i], el]));
  const removed = new Set(Array.isArray(patch[REMOVE]) ? patch[REMOVE] : []);
  if (removed.size) keys = keys.filter((k) => !removed.has(k));
  for (const k of removed) byKey.delete(k);
  for (const [k, p] of Object.entries(isPlainObject(patch[KEYED]) ? patch[KEYED] : {})) {
    if (!byKey.has(k)) keys.push(k);
    byKey.set(k, apply(byKey.has(k) ? byKey.get(k) : null, p));
  }
  if (Array.isArray(patch[ORDER])) keys = patch[ORDER].filter((k) => typeof k === "string");
  return keys.filter((k) => byKey.has(k)).map((k) => byKey.get(k));
}

// 64-bit FNV-1a (a public-domain hash) over the state as JSON with object keys sorted, as 16 hex digits. Only the
// latency test (engine-test.js) uses it, to check that patching gave the engine's own result.
function sortedJson(x) {
  if (Array.isArray(x)) return "[" + x.map(sortedJson).join(",") + "]";
  if (isPlainObject(x)) return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + sortedJson(x[k])).join(",") + "}";
  return JSON.stringify(x);
}
const FNV_OFFSET = 0xcbf29ce484222325n, FNV_PRIME = 0x100000001b3n, MASK64 = (1n << 64n) - 1n;
function fingerprint(state) {
  let h = FNV_OFFSET;
  for (const byte of Buffer.from(sortedJson(state), "utf8")) h = ((h ^ BigInt(byte)) * FNV_PRIME) & MASK64;
  return h.toString(16).padStart(16, "0");
}

module.exports = { apply, fingerprint };
