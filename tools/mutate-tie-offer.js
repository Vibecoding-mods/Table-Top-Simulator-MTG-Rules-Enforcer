// Break-it for the tie offer in the bridge and on the table (tests/test_bridge_tie_offer.js, tests/test_table_tie_offer.js):
// each mutation switches one piece off (bridge/bridge.js, bridge/accomplishments.js, tools/engine-renderer.lua,
// tools/make-engine-copy.js), runs both tests, lists the checks that failed by name, then puts the file back and checks
// it by sha256. A mutation no check catches is printed as SURVIVED. The engine's pieces: tools/mutate-tie-offer-engine.js.
//   node tools/mutate-tie-offer.js [label pattern]
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const TESTS = ["tests/test_bridge_tie_offer.js", "tests/test_table_tie_offer.js"];
const B = "bridge/bridge.js", A = "bridge/accomplishments.js", R = "tools/engine-renderer.lua", C = "tools/make-engine-copy.js";

// [label, file, from, to]: `from` must occur exactly once
const MUTATIONS = [
  ["bridge: the offer not sent to the table", B, "    ...(tie ? { tie } : {}), // (a tie offer", "    ...{}, // (a tie offer"],
  ["bridge: the reasons not in words", B, "why: (l.reasons || []).map((r) => TIE_REASONS[r] || r) })", "why: (l.reasons || []) })"],
  ["bridge: the harmless bot named as awaited", B, "waitingNames: awaiting.filter((id) => !bots.has(id)).map(nameOf),\n    declinedBy", "waitingNames: awaiting.map(nameOf),\n    declinedBy"],
  ["bridge: the offer unsaid", B, "  if (s.status === \"pending\" && !same) {", "  if (false) {"],
  ["bridge: the no unsaid", B, "  } else if (s.status === \"declined\" && !(same && was.status === \"declined\")) {", "  } else if (false) {"],
  ["bridge: no warning each round", B, "  } else if (s.status === \"declined\" && s.rounds > was.rounds) {", "  } else if (false) {"],
  ["bridge: progress unsaid", B, "  } else if (s.status === \"declined\" && s.rounds < was.rounds) {", "  } else if (false) {"],
  ["bridge: the broken lock unsaid", B, "    if (was && (was.status === \"pending\" || was.status === \"declined\")) say(", "    if (false) say("],
  ["bridge: the agreed draw unsaid", B, "    say(\"Everyone accepted the tie: the game is a draw.\");", "    void 0;"],
  ["bridge: no accomplishment for a forced tie", B, "    forcedTieEarned(s);\n", ""],
  ["bridge: an accomplishment for an agreed tie", B, "    say(\"Everyone accepted the tie: the game is a draw.\");", "    say(\"Everyone accepted the tie: the game is a draw.\"); forcedTieEarned(s);"],
  ["bridge: Stalemate not for everyone by default", B, "const STALEMATE_EARNED_BY = \"everyone\";", "const STALEMATE_EARNED_BY = \"locked\";"],
  ["bridge: the earners ignored", B, "    if (!earners.has(seat.color)) continue;\n", ""],
  ["bridge: only the locked rule broken", B, "  if (by === \"locked\") return all.filter((c) => s.locked.some((l) => l.color === c));", "  if (by === \"locked\") return all;"],
  ["bridge: only the decliners rule broken", B, "  if (by === \"decliners\") return all.filter((c) => c === s.declinedColor);", "  if (by === \"decliners\") return all;"],
  ["bridge: the decliner's colour lost", B, " declinedColor: game.slotColor[t.status?.playerId] || null,", " declinedColor: null,"],
  ["bridge: the accomplishment on every board", B, "  if (!game || game.tieEarned) return;\n", "  if (!game) return;\n"],
  ["bridge: any seat may vote", B, "  if (!(t.awaitingPlayerIds || []).includes(seat.slot)) return chat(\"[MTG] Your answer isn't needed for this tie.\", color);\n", ""],
  ["bridge: the vote sent as a rewind vote", B, "  seat.directive({ type: \"tieVote\", voteId: t.voteId, accept: !!accept });", "  seat.directive({ type: \"restoreVote\", voteId: t.voteId, accept: !!accept });"],
  ["bridge: a vote with no offer sent on", B, "  if (!t || t.status?.type !== \"pending\") return chat(\"[MTG] No tie offer is open.\", color);", "  if (!t) return chat(\"[MTG] No tie offer is open.\", color);"],
  ["bridge: a vote's Steam ID not kept", B, "  if (game && color && accomplishLib.steamKey(steam)) (game.steam ??= {})[color] = String(steam);", "  void 0;"],
  ["bridge: the start's Steam IDs unchecked", B, "if (accomplishLib.steamKey(id)) out[c] = String(id);", "out[c] = String(id);"],
  ["bridge: the harmless bot doesn't accept", B, "      h.directive({ type: \"tieVote\", voteId: t.voteId, accept: true });", "      void 0;"],
  ["bridge: the end words leave the forced tie out", B, "  if (tie === \"forced\") return `a forced tie", "  if (false) return `a forced tie"],
  ["bridge: the end words leave the agreed tie out", B, "  if (tie === \"agreed\") return \"a draw: everyone accepted the tie\";", "  if (false) return \"\";"],
  ["bridge: the store beside gif-keys.json", B, "const ACCOMPLISH_FILE = process.env.MTG_ACCOMPLISHMENTS\n", "const ACCOMPLISH_FILE = (process.env.MTG_ACCOMPLISHMENTS && path.join(path.dirname(process.env.MTG_ACCOMPLISHMENTS), \"gif-keys.json\"))\n"],
  ["accomplishments: the count never goes up", A, "count: got[id].count + 1, last: day", "count: got[id].count, last: day"],
  ["accomplishments: a colour is a key", A, "  return /^\\d{5,20}$/.test(s) ? s : null;", "  return s || null;"],
  ["accomplishments: unknown ones kept", A, "if (ACCOMPLISHMENTS[id] && okEntry(e)) kept[id]", "if (okEntry(e)) kept[id]"],
  ["accomplishments: never saved", A, "      save();\n      return { id, ...e };", "      return { id, ...e };"],
  ["table: buttons for everyone", R, "t.status == \"pending\" and Player[c] ~= nil and Player[c].seated and engineTieWaits(t, c) then", "t.status == \"pending\" and Player[c] ~= nil and Player[c].seated then"],
  ["table: the pop-up shuts after a no", R, "(t.status == \"pending\" or t.status == \"declined\")", "(t.status == \"pending\")"],
  ["table: the pop-up stays at game over", R, "  local open = t ~= nil and not gameOver and", "  local open = t ~= nil and"],
  ["table: the count not shown", R, "Rounds without progress: \" .. tostring(t.rounds or 0)", "Rounds without progress: \" .. \"?\""],
  ["table: Tie sends a rewind vote", R, "  if id == \"eng_tieyes\" then engineSend(\"tieVote\"", "  if id == \"eng_tieyes\" then engineSend(\"rewindVote\""],
  ["table: no Steam ID with a vote", R, "engineSend(\"tieVote\", { color = c, accept = true, steam = engineSteamOf(c) })", "engineSend(\"tieVote\", { color = c, accept = true })"],
  ["table: a seat that isn't asked counts", R, "  if (ENGINE_TIE_ASKED or \"\"):find(\"|\" .. c .. \"|\", 1, true) == nil then return end", "  if false then return end"],
  ["table: the board doesn't draw the pop-up", R, "  local okTie, errTie = pcall(engineTieUpdate, m.tie, m.gameOver)", "  local okTie, errTie = true, nil"],
  ["table: no pop-up in the XML", R, "'<Button id=\"eng_tieyes\" onClick=\"onMtgTie\"", "'<Button id=\"eng_tieyes\" onClick=\"onMtgVote\""],
  ["chat: mtg tie always yes", C, "accept = rest == \"yes\", steam = engineSteamOf", "accept = true, steam = engineSteamOf"],
  ["chat: the start without Steam IDs", C, "  if engineSteamIds ~= nil then start.steam = engineSteamIds(seats) end\n", ""],
];

function runTests() {
  const failed = [];
  for (const t of TESTS) {
    const r = spawnSync(process.execPath, [t], { cwd: ROOT, encoding: "utf8", timeout: 600000 });
    const out = (r.stdout || "") + (r.stderr || "");
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*FAIL[: ]\s*(.+)$/);
      if (m && !/^test_/.test(m[1])) failed.push(m[1].slice(0, 90));
    }
    if (r.status !== 0 && !/^\s*FAIL/m.test(out)) failed.push(`CRASH: ${t} exit ${r.status}: ${out.split("\n").slice(-3).join(" ").slice(0, 160)}`);
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
  const caught = failed.some((f) => !f.startsWith("CRASH: ")); // (a test that crashed or timed out is no check catching it)
  if (!caught) survived++;
  console.log(`${caught ? "caught" : "SURVIVED"}: ${label}${failed.length ? ` -> ${failed.slice(0, 3).join(" | ")}` : ""}${ok ? "" : "  RESTORE MISMATCH"}`);
}
console.log(survived ? `${survived} of ${list.length} survived` : `all ${list.length} caught, every file restored`);
process.exit(survived ? 1 : 0);
