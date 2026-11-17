// Break-it for the Archenemy view (tests/test_table_archenemy_view.js): each mutation switches one piece off
// (bridge/bridge.js schemeView and the player row, tools/engine-renderer.lua engineSchemes and the rest,
// tools/make-engine-copy.js's chat), runs the test, lists the checks that failed by name, then puts the file back and
// checks it by sha256. A mutation no check catches is printed as SURVIVED.
//   node tools/mutate-archenemy-view.js [label pattern]
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_table_archenemy_view.js"];
const B = "bridge/bridge.js", R = "tools/engine-renderer.lua", C = "tools/make-engine-copy.js";

// [label, file, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["bridge: schemes left in the command row", B, "  for (const c of schemeCards) planeIds.add(c.id);\n", ""],
  ["bridge: ongoing not marked", B, "...(isOngoing(c) ? { ong: true } : {})", "...{}"],
  ["bridge: the archenemy's row unmarked", B, "      ...(p.isArchenemy ? { arch: true } : {}),\n", ""],
  ["bridge: everyone's scheme deck", B, "      ...(p.isArchenemy && Number.isInteger(p.schemeDeckCount) ? { schemeDeck: p.schemeDeckCount } : {}),", "      ...(Number.isInteger(p.schemeDeckCount) ? { schemeDeck: p.schemeDeckCount } : {}),"],
  ["bridge: no new seq", B, "game.schemeNow = { seq: (game.schemeNow?.seq || 0) + 1, card: entry(c) };", "game.schemeNow = { seq: 1, card: entry(c) };"],
  ["bridge: a scheme back from the deck is not new", B, "  for (const id of [...game.schemesSeen]) if (!here.has(id)) game.schemesSeen.delete(id);\n", ""],
  ["bridge: the scheme set in motion forgotten once it leaves", B, "slim(here.has(game.schemeNow.card.id) ? entry(schemeCards.find((c) => c.id === game.schemeNow.card.id)) : game.schemeNow.card) } : null;", "slim(entry(schemeCards.find((c) => c.id === game.schemeNow.card.id) || {})) } : null;"],
  ["bridge: schemes sent in any game", B, "    ...(schemes.length ? { schemes } : {}), ...(schemeNow ? { schemeNow } : {}),", "    schemes, ...(schemeNow ? { schemeNow } : {}),"],
  ["table: the scheme set in motion not drawn", R, "  if nowCard ~= nil then place(nowCard, engineSchemeSpot(g, 0), rot, seen, nil, { zone = \"schemenow\", color = color }) end\n", ""],
  ["table: the scheme set in motion in the row too", R, "    if nowCard == nil or c.id ~= nowCard.id then\n", "    if true then\n"],
  ["table: one scheme says SCHEMES", R, "(n == 1 and \" SCHEME\" or \" SCHEMES\")", "\" SCHEMES\""],
  ["table: the board's teams not read", R, "  return m.teams and m.teams.archenemy or nil\n", "  return nil\n"],
  ["table: not turned to the archenemy's seat", R, "  local rot = Vector(0, g.rotY, 0)\n  local nowCard", "  local rot = Vector(0, 0, 0)\n  local nowCard"],
  ["table: the spot at the centre", R, "ENGINE_SCHEME = { toward = 0.42,", "ENGINE_SCHEME = { toward = 0,"],
  ["table: the deck on the row's side", R, "  local side = k == 0 and 0 or (k < 0 and ENGINE_SCHEME.deck or", "  local side = k == 0 and 0 or (k < 0 and -ENGINE_SCHEME.deck or"],
  ["table: the deck not drawn", R, "  if deck ~= nil then place(deck, engineSchemeSpot(g, -1), rot, seen, nil, { zone = \"schemedeck\", color = color }) end\n", ""],
  ["table: the banner every board", R, "  if now == nil or now.seq == nil or now.seq == engineSchemeSeen then return end", "  if now == nil or now.seq == nil then return end"],
  ["table: the banner on a jump board", R, "  engineSchemeSeen = now.seq\n  if m.jump then return end\n", "  engineSchemeSeen = now.seq\n"],
  ["table: the banner never put away", R, "      Wait.time(function() if engineSchemeSeen == now.seq then setAttr(\"eng_banner_\" .. c, \"active\", \"false\") end end, 4)\n", ""],
  ["table: the banner not gold", R, "      setAttr(\"eng_banner_\" .. c, \"color\", \"#FFD27A\")\n      setAttr(\"eng_banner_\" .. c, \"outline\", \"#101010E0\")\n      setAttr(\"eng_banner_\" .. c, \"active\", \"true\")\n      Wait.time(function() if engineSchemeSeen", "      setAttr(\"eng_banner_\" .. c, \"color\", \"#FFFFFF\")\n      setAttr(\"eng_banner_\" .. c, \"outline\", \"#101010E0\")\n      setAttr(\"eng_banner_\" .. c, \"active\", \"true\")\n      Wait.time(function() if engineSchemeSeen"],
  ["table: the button skips a seat", R, "  for i, c in ipairs(ENGINE_ARCH_SEATS) do if c == cur then return ENGINE_ARCH_SEATS[i + 1] end end", "  for i, c in ipairs(ENGINE_ARCH_SEATS) do if c == cur then return ENGINE_ARCH_SEATS[i + 2] end end"],
  ["table: the button not told of mtg archenemy", R, "  for _, c in ipairs(ENGINE_ARCH_SEATS) do if string.lower(c) == t then ENGINE_ARCH_SETUP = c end end", "  for _, c in ipairs(ENGINE_ARCH_SEATS) do if false then ENGINE_ARCH_SETUP = c end end"],
  ["table: the button not drawn", R, "        setupButton(tile, \"onMtgSetupArch\", engineArchLabel(), SETUP.color.idle, ENGINE_ARCH_SPOT, nil, 1700, 620, 90)\n", ""],
  ["table: the button's change doesn't redraw", R, "engineArchLabel ~= nil and engineArchLabel() or \"\", dcKey", "dcKey"],
  ["table: the button not counted", R, " + (SETUP.drawn.arch and 1 or 0) then return false end", " then return false end"],
  ["chat: mtg archenemy doesn't set the button", C, "      if engineArchNoted ~= nil then engineArchNoted(rest) engineSetupButtons() end\n", ""],
  ["table: the schemes' details not filled in", R, "  for _, c in ipairs(m.schemes or {}) do engineFillStatic(c) end\n", ""],
  ["table: a slim entry not filled", R, "  for k, v in pairs(engineStatic[c.id] or {}) do if c[k] == nil then c[k] = v end end\n  c.s = nil\nend", "  c.s = nil\nend"],
  ["table: rules texts never reach a scheme", R, "  if c == nil or t[c.id] == nil or c.n == nil or c.fd then return end\n  c.tx = t[c.id]", "  if true then return end\n  c.tx = t[c.id]"],
  ["table: the scheme set in motion drawn small", R, "(meta.zone == \"plane\" or meta.zone == \"schemenow\")", "(meta.zone == \"plane\")"],
  ["table: a new game's schemes keep counting", R, "  engineSchemeSeen = nil -- (and its schemes set in motion)\n", ""],
  ["table: no scheme drawn at all", R, "  local okSch, errSch = pcall(engineSchemes, m, seen)", "  local okSch, errSch = true, nil"],
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
