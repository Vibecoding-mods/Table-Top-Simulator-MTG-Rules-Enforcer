// Break-it for custom card art past plain cards (tests/test_bridge_custom_art_2.js): each mutation switches one piece
// off (bridge/bridge.js: the other face, tokens, "mtg art token|back", the AI's pasted lists; tools/make-engine-copy.js:
// the second state and the chat), runs the test, lists the checks that failed by name, then puts the file back and
// checks it by sha256. A mutation no check catches is printed as SURVIVED.
//   node tools/mutate-custom-art-2.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_bridge_custom_art_2.js"];
const B = "bridge/bridge.js", C = "tools/make-engine-copy.js";

// [label, file, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["dfc: the deck's other face not read", B, "  const f2 = c.f2 || null;\n", "  const f2 = null;\n"],
  ["dfc: Scryfall's back first", B, "b: back2 || imageCache[normName(name)]?.back || img?.back || DEFAULT_BACK,", "b: imageCache[normName(name)]?.back || back2 || img?.back || DEFAULT_BACK,"],
  ["dfc: the hand's other side Scryfall's", B, "    ...(back2 && !c.identity.isToken ? { o2: back2 } : {}),\n", ""],
  ["dfc: the transformed side not filed", B, "  if (!other?.name || !front) return;", "  if (true) return;"],
  ["dfc: no transformed side by Scryfall's faces", B, "      if (i) return { face: i.face2, back: null, face2: i.face };", "      if (false) return null;"],
  ["dfc: the back face named as the whole card", B, "  const backName = indexed && normName(indexed) !== normName(name) ? indexed : c.n2 ? String(c.n2) : null;", "  const backName = indexed || (c.n2 ? String(c.n2) : null);"],
  ["dfc: a player's back not checked", B, "  const why = artProblem(f2);\n  if (why) { a.badBack ??= why; return null; }", "  const why = null;\n  if (why) { a.badBack ??= why; return null; }"],
  ["dfc: art off keeps a player's back", B, "  const face2 = (i) => (i.face2 && !deadImages.has(i.face2) && !(i.custom2 && customArt.off) ? { face2: i.face2 } : {});", "  const face2 = (i) => (i.face2 && !deadImages.has(i.face2) ? { face2: i.face2 } : {});"],
  ["dfc: the back not said", B, "    if (a.back) lines.push(`${name}: your back picture${a.backName ? ` (${a.backName})` : \"\"}`);\n", ""],
  ["dfc: a bad back not said", B, "    if (a.badBack) lines.push(`${name}: the back picture link was not used (${a.badBack}); its back shows its normal picture`);\n", ""],
  ["token: a player's picture not used", B, "  const tok = c.identity.isToken ? (myToken ? pictureEntry(myToken) : tokenImage(c)) : null;", "  const tok = c.identity.isToken ? tokenImage(c) : null;"],
  ["token: anyone's tokens", B, "  const mine = playerArtOf(game.slotColor?.[c.ownerId] || null);", "  const mine = playerArtOf(Object.keys(playerArt)[0] || null);"],
  ["token: on a card that isn't a token", B, "  const myToken = c.identity.isToken ? mine?.tokens[normName(name)] || null : null;\n  const tok = c.identity.isToken ?", "  const myToken = mine?.tokens[normName(name)] || null;\n  const tok = myToken || c.identity.isToken ?"],
  ["token: a link not checked", B, "  const why = artProblem(link);\n  if (why) return chat(`[MTG] That picture link can't be used: ${why}.`, color);", "  const why = null;\n  if (why) return chat(`[MTG] That picture link can't be used: ${why}.`, color);"],
  ["token: clear clears nothing", B, "    for (const k of Object.keys(list)) delete list[k];\n", ""],
  ["art off: a player's own pictures stay", B, "  if (!color || customArt.off) return null;", "  if (!color) return null;"],
  ["back: any name", B, "  if (!engine) return chat(`[MTG] The engine doesn't know a card named", "  if (false) return chat(`[MTG] The engine doesn't know a card named"],
  ["back: transformed not shown", B, "  const myFlip = !c.identity.isToken && !myBack && mine ? flippedArt(name, mine, game.slotColor?.[c.ownerId] || null) : null;", "  const myFlip = null;"],
  ["back: not the back", B, "  const back2 = myBack || img?.face2 || null;", "  const back2 = img?.face2 || null;"],
  ["list: links not kept", B, "    if (links.length && !art[name]) art[name] = { front: links[0], back: links[1] || null };\n", ""],
  ["list: the second link not the back", B, "art[name] = { front: links[0], back: links[1] || null };", "art[name] = { front: links[0], back: null };"],
  ["ai: the pictures not kept", B, "  aiSeatChoice[c] = { kind, deck: r.deck, source: r.source, images: pics.images };", "  aiSeatChoice[c] = { kind, deck: r.deck, source: r.source, images: {} };"],
  ["ai: the game doesn't use them", B, "    else if (color && !seat && aiSeatChoice[color]?.images && Object.keys(aiSeatChoice[color].images).length) pictures[color] = aiSeatChoice[color].images;\n", ""],
  ["ai: a bad link not said", B, "    ...Object.entries(art).filter(([, a]) => a.bad).map(([n, a]) => `${n}: the picture link was not used (${a.bad})`),\n", ""],
  ["ai: a bad link used", B, "    const why = artProblem(l.front);\n    if (why) { a.bad = why; continue; }", "    const why = artProblem(l.front);\n    if (why) { a.bad = why; }"],
  ["table: the second state not read", C, "  local s2 = d.States and (d.States[\"2\"] or d.States[2]) or nil", "  local s2 = nil"],
  ["table: the second state's deck picture not read", C, "      if cd2 ~= nil then f2 = cd2.FaceURL end", "      if cd2 ~= nil then f2 = nil end"],
  ["table: the chat sends the lower-cased text", C, "      engineSend(\"artset\", { color = pl.color, text = message:sub(restAt) })", "      engineSend(\"artset\", { color = pl.color, text = rest })"],
];

function runTests() {
  const failed = [];
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: "utf8", timeout: 900000 });
    const out = (r.stdout || "") + (r.stderr || "");
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*FAIL[: ]\s*(.+)$/);
      if (m && !/^test_/.test(m[1])) failed.push(m[1].split(": ").slice(0, 2).join(": ").slice(0, 100));
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
for (const [label, rel, from, to] of list) {
  const file = path.join(ROOT, rel);
  const before = sha(file);
  const text = fs.readFileSync(file, "utf8");
  if (text.split(from).length !== 2) { console.log(`?? ${label}: the code to break is not there once`); survived++; continue; }
  fs.writeFileSync(file, text.replace(from, () => to));
  let failed;
  try { failed = runTests(); } finally { fs.writeFileSync(file, text); }
  const ok = sha(file) === before;
  if (!failed.length) survived++;
  console.log(`${failed.length ? "caught" : "SURVIVED"}: ${label}${failed.length ? ` -> ${[...new Set(failed)].slice(0, 2).join(" | ")}` : ""}${ok ? "" : "  RESTORE MISMATCH"}`);
}
console.log(survived ? `${survived} of ${list.length} survived` : `all ${list.length} caught, every file restored`);
process.exit(survived ? 1 : 0);
