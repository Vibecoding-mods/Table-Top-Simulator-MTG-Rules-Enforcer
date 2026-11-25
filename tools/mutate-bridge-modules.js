// Adversary pass for the bridge's own modules (jr-programmer-suite §2b), beside their per-feature break-its
// (tools/mutate-teams.js, mutate-team-modes.js, mutate-legality.js, mutate-format-rules.js, which all report 100%): new
// mutants of the kinds those lists lacked (a boundary moved, truthiness for != null, && for ||, a default moved, a
// dropped toLowerCase/normalize, args swapped, a cache not cleared), each run against every gated test that loads the
// module. Caught = some test fails (by name, or crashes); a mutant no test fails is ESCAPED.
// Each mutant is written over the module from the pristine copy held aside (tmp/mutate-modules-pristine/), the module is
// restored by overwriting it from that copy, and its sha256 is checked after every restore and before every mutant.
// A mutation whose text is not found exactly once is a failure of this tool (exit 2, nothing run).
//   node tools/mutate-bridge-modules.js [module pattern] [label pattern]     --check: only check they apply
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const t = (...names) => names.map((n) => `tests/${n}.js`);

const MODULES = {
  "bridge/teams.js": {
    tests: t("test_bridge_teams", "test_bridge_team_modes", "test_table_teams", "test_table_team_modes", "test_bridge_2hg_level2", "test_bridge_2hg_team_block",
      "test_bridge_3hg", "test_bridge_3hg_team_block", "test_bridge_archenemy", "test_bridge_archenemy_resume", "test_bridge_archenemy_team_turns",
      "test_bridge_team_life_log", "test_table_2hg_level2", "test_table_2hg_team_block", "test_table_3hg", "test_table_archenemy_lua",
      "test_table_archenemy_view", "test_table_six", "test_table_team_looks", "test_bridge_six_golden"),
    mutants: [
      ["teamsOf: team 3 kept (=== 1 || === 2 → >= 1)", "out[c] = n === 1 || n === 2 ? n : DEFAULT_TEAMS[c];", "out[c] = n >= 1 ? n : DEFAULT_TEAMS[c];"],
      ["seatColorsFor: four players get the six seats (> → >=)", "(Number(n) > TEAM_COLORS.length ? SIX_COLORS", "(Number(n) >= TEAM_COLORS.length ? SIX_COLORS"],
      ["setupOf: shared turns outside 2HG", "turns: mode === \"2hg\" && m?.teamTurns === \"shared\" ? \"shared\" : null", "turns: m?.teamTurns === \"shared\" ? \"shared\" : null"],
      ["teamModeOf: inherited keys taken (hasOwnProperty → truthiness) [equivalent: the table sends only the five mode names or nothing; \"toString\" never comes]", "(Object.prototype.hasOwnProperty.call(TEAM_MODES, raw) ? raw : \"2hg\")", "(TEAM_MODES[raw] ? raw : \"2hg\")"],
      ["teamModeProblem: == null → truthiness [equivalent: gameMode is null or a non-empty string]", "if (t.gameMode == null) return null;", "if (!t.gameMode) return null;"],
      ["juggOf: the low limit refused (>= lo → > lo)", "Number.isInteger(n) && n >= lo && n <= hi", "Number.isInteger(n) && n > lo && n <= hi"],
      ["juggOf: 0 dropped (!= null → truthiness)", "if (r[k] != null && Number.isInteger(n)", "if (r[k] && Number.isInteger(n)"],
      ["juggOf: the high limit refused (<= hi → < hi)", "n >= lo && n <= hi) out[k] = n;", "n >= lo && n < hi) out[k] = n;"],
      ["juggPerks: no extra land still a perk (> 0 → >= 0)", "if (jugg.land > 0) lines.push(", "if (jugg.land >= 0) lines.push("],
      ["juggPerks: the bare name sent as perks", "return lines.length > 1 ? lines : [];", "return lines;"],
      ["archOf: the first colour refused (>= 0 → > 0)", "if (colors.indexOf(r.color) >= 0) out.color = r.color;", "if (colors.indexOf(r.color) > 0) out.color = r.color;"],
      ["schemeDeckProblem: exactly 20 refused (< → <=)", "if (names.length < ARCH_SCHEMES) return", "if (names.length <= ARCH_SCHEMES) return"],
      ["schemeDeckProblem: 2 copies refused (> → >=)", ".filter(([, k]) => k > ARCH_COPIES)", ".filter(([, k]) => k >= ARCH_COPIES)"],
      ["teamsProblem: Archenemy 1v1 refused (>= 2 → > 2)", "return total >= 2 ? null : `Archenemy needs", "return total > 2 ? null : `Archenemy needs"],
      ["teamsProblem: wrap-round off by one", "Math.abs(at(a) - at(b)) === TEAM_COLORS.length - 1;", "Math.abs(at(a) - at(b)) === TEAM_COLORS.length;"],
      ["gameConfig: commander damage 21 sent anyway", "...(jugg.cmd !== 21 ? { commanderDamageToLose: jugg.cmd } : {})", "...({ commanderDamageToLose: jugg.cmd })"],
      ["sharesLife: shared turns don't share life", "const sharesLife = (pub) => pub?.teamRules?.rule === \"sharedLife\" || pub?.teamRules?.rule === \"sharedTurns\";", "const sharesLife = (pub) => pub?.teamRules?.rule === \"sharedLife\";"],
      ["withTeamDamage: Number() dropped (text added as text)", "total[cid] = (total[cid] || 0) + (Number(n) || 0);", "total[cid] = (total[cid] || 0) + n;"],
      ["teamsField: winners before the game is over", "sides: sideList, ...(t.rule === \"sharedTurns\" ? { turns: \"shared\" } : {}),\n    ...(pub.gameOver && won ? { won } : {}) } };", "sides: sideList, ...(t.rule === \"sharedTurns\" ? { turns: \"shared\" } : {}),\n    ...(won ? { won } : {}) } };"],
      ["archTeamsField: the archenemy always first", "const sideList = colors[0] === archColor ? [[archColor], others] : [others, [archColor]];", "const sideList = [[archColor], others];"],
      ["teamWinWords: wins / win swapped", "${won.length === 1 ? \"wins\" : \"win\"}", "${won.length === 1 ? \"win\" : \"wins\"}"],
      ["turnPartners: a player is its own partner", "if (!sharesTurns(pub) || a == null || b == null || a === b) return false;", "if (!sharesTurns(pub) || a == null || b == null) return false;"],
      ["turnPlayerIds: == null → truthiness [equivalent: team numbers are 1 and 2, never 0]", "if (lead?.teamNumber == null) return [a];", "if (!lead?.teamNumber) return [a];"],
      ["setupWords: 3HG life by the other mode (args swapped)", "(shared life: ${std ? 45 : 120} a team", "(shared life: ${std ? 120 : 45} a team"],
    ],
  },
  "bridge/format-rules.js": {
    tests: t("test_bridge_formats", "test_bridge_legality", "test_bridge_standard", "test_bridge_sideboard_imported", "test_bridge_match_bo3", "test_bridge_bo3_extras"),
    mutants: [
      ["formatKey: case not folded", "const formatKey = (x) => { const k = String(x ?? \"\").trim().toLowerCase().replace(", "const formatKey = (x) => { const k = String(x ?? \"\").trim().replace("],
      ["formatKey: _ and - kept", ".replace(/[\\s_-]+/g, \"\"); return BY_KEY.has(k)", ".replace(/\\s+/g, \"\"); return BY_KEY.has(k)"],
      ["formatOf: default moved to Commander", "BY_KEY.get(formatKey(key) || DEFAULT_FORMAT)", "BY_KEY.get(formatKey(key) || \"commander\")"],
      ["copyRestricted: !== false → truthiness (absent = off)", "const copyRestricted = f.restricted === \"copy\" && opts.restricted !== false && status;", "const copyRestricted = f.restricted === \"copy\" && opts.restricted && status;"],
      ["singleton: basic lands counted", "const extra = names.filter((n) => !isBasic(n) && limit(n) !== \"any\"", "const extra = names.filter((n) => limit(n) !== \"any\""],
      ["commander: the commander not counted in the 100", "const total = cards.length + commanders.length;", "const total = cards.length;"],
      ["sixty: 4 copies refused (> → >=)", "return k > (own ? limit(n) : 4) ?", "return k >= (own ? limit(n) : 4) ?"],
      ["sixty: a restricted card also counted for 4", "!isBasic(n) && limit(n) !== \"any\" && !restrictedHere(n)).map(", "!isBasic(n) && limit(n) !== \"any\").map("],
      ["sixty: a card's own limit counts the sideboard", "const k = own ? inMain.get(n) || 0 : counts.get(n);", "const k = counts.get(n);"],
      ["banned: !== false → truthiness (absent = allowed)", "if (banned.length && opts.banned !== false) problems.push(", "if (banned.length && opts.banned) problems.push("],
      ["restricted copy: one copy refused (> 1 → >= 1)", "st.get(n) === \"r\" && counts.get(n) > 1);", "st.get(n) === \"r\" && counts.get(n) >= 1);"],
      ["restricted commander: the deck checked, not the commander", "const asCommander = [...new Set(commanders)]", "const asCommander = [...new Set(cards)]"],
      ["pauper commander: a commander also in the deck skipped", "new Set(commanders.filter((n) => !cards.includes(n)))", "new Set(commanders)"],
      ["unknown: == null → === null (undefined missed)", "const unknown = names.filter((n) => st.get(n) == null);", "const unknown = names.filter((n) => st.get(n) === null);"],
      ["footer: date before source (args swapped)", "const from = [opts.source, opts.date].filter(Boolean).join(\", \");", "const from = [opts.date, opts.source].filter(Boolean).join(\", \");"],
      ["no-data warning for a casual format too", "if (f.list && !status) warnings.push(", "if (!status) warnings.push("],
      ["few: eight names cut (> 8 → >= 8)", "${list.length > 8 ? `, and ${list.length - 8} more` : \"\"}", "${list.length >= 8 ? `, and ${list.length - 8} more` : \"\"}"],
      ["status: a casual format checked against a list", "const status = f.list && typeof opts.status === \"function\"", "const status = typeof opts.status === \"function\""],
    ],
  },
  "bridge/legality.js": {
    tests: t("test_bridge_legality", "test_bridge_legality_refresh", "test_bridge_formats"),
    mutants: [
      ["reduce: a line's trailing comma kept", "  if (text.endsWith(\",\")) text = text.slice(0, -1);\n", ""],
      ["reduce: a split card listed by its front face", "const listName = BOTH_HALVES.has(card.layout) ? card.name : frontFace(card.name);", "const listName = frontFace(card.name);"],
      ["reduce: a double-faced card listed by its full name", "const listName = BOTH_HALVES.has(card.layout) ? card.name : frontFace(card.name);", "const listName = card.name;"],
      ["normName: case not folded", ".replace(/\\s+/g, \" \").trim().toLowerCase(); // (Æ", ".replace(/\\s+/g, \" \").trim(); // (Æ"],
      ["normName: accents kept (normalize dropped)", "const normName = (s) => String(s || \"\").normalize(\"NFKD\").replace(", "const normName = (s) => String(s || \"\").replace("],
      ["view.has: a format the data lacks counted", "const has = (k) => !!data && KEYS.includes(k) && keys.includes(k) && !!data.formats[k];", "const has = (k) => !!data && KEYS.includes(k) && !!data.formats[k];"],
      ["view.old: a week exactly is old (> → >=)", "settings().now() - Date.parse(data.updatedAt) > OLD_MS", "settings().now() - Date.parse(data.updatedAt) >= OLD_MS"],
      ["status: only the first name form tried", "        if (s) return s[i];\n      }\n      return null;", "        return s ? s[i] : null;\n      }\n      return null;"],
      ["checkOnce: a day exactly counts as today (< → <=)", "s.now() - lastCheck < DAY_MS) return", "s.now() - lastCheck <= DAY_MS) return"],
      ["checkOnce: force ignored", "if (!force && lastCheck && s.now() - lastCheck < DAY_MS)", "if (lastCheck && s.now() - lastCheck < DAY_MS)"],
      ["fail: the day's check kept after a failure", "    lastCheck = 0; // (tried again at the next hourly tick, not a day later)\n", ""],
      ["fail: retry time not from now", "retryAt = s.now() + (waitMs || 0);", "retryAt = waitMs || 0;"],
      ["429: a 0 Retry-After taken (> 0 → >= 0)", "Number.isFinite(sec) && sec > 0 ? sec * 1000", "Number.isFinite(sec) && sec >= 0 ? sec * 1000"],
      ["size: any shrink refused (* 0.8 dropped)", "kept < before.cardCount * 0.8", "kept < before.cardCount"],
      ["size: the minimum in place of the setting (?? args)", "kept < (s.minCards ?? MIN_CARDS)", "kept < (MIN_CARDS ?? s.minCards)"],
      ["game started: the day's check kept", "if (s.busy()) { drop(); lastCheck = 0; return", "if (s.busy()) { drop(); return"],
      ["rename: the old view kept (cache not cleared)", "  current = null;\n  const after = loadLegality();", "  const after = loadLegality();"],
      ["download: the plain file before the jsonl one (|| args swapped)", "meta.jsonl_download_uri || meta.download_uri", "meta.download_uri || meta.jsonl_download_uri"],
      ["refresh: two at once", "  if (running) return running;\n  running = checkOnce", "  running = checkOnce"],
      ["worker failure: a 429's wait dropped", "e.status === 429 ? e.waitMs || 3600 * 1000 : 0", "0"],
    ],
  },
};

const onlyMod = process.argv[2] && !process.argv[2].startsWith("--") ? new RegExp(process.argv[2], "i") : null;
const onlyLabel = process.argv[3] ? new RegExp(process.argv[3], "i") : null;
const ASIDE = path.join(ROOT, "tmp", "mutate-modules-pristine");
fs.mkdirSync(ASIDE, { recursive: true });

// every mutation must apply exactly once, on the module as it is now
let bad = 0;
for (const [rel, m] of Object.entries(MODULES)) {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  for (const [label, from, to] of m.mutants) {
    const n = text.split(from).length - 1;
    if (n !== 1 || from === to) { bad++; console.log(`STALE  ${rel}: ${label} (${from === to ? "changes nothing" : `found ${n}x`})`); }
  }
}
if (bad) { console.log(`\n${bad} mutations can't be run as written: repair them`); process.exit(2); }
if (process.argv.includes("--check")) { console.log("every mutation applies exactly once"); process.exit(0); }

function runTests(tests) {
  for (const f of tests) {
    const r = spawnSync(process.execPath, [f], { cwd: ROOT, encoding: "utf8", timeout: 600000, maxBuffer: 256 * 1024 * 1024 });
    if (r.status === 0) continue;
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    const line = out.split("\n").find((l) => /^\s*FAIL\b/.test(l)) || (r.signal ? `killed (${r.signal})` : out.split("\n").filter(Boolean).slice(-1)[0] || `exit ${r.status}`);
    return `${path.basename(f, ".js")}: ${line.trim().slice(0, 140)}`;
  }
  return null;
}

const summary = [];
for (const [rel, m] of Object.entries(MODULES)) {
  if (onlyMod && !onlyMod.test(rel)) continue;
  const file = path.join(ROOT, rel), aside = path.join(ASIDE, path.basename(rel));
  const pristine = fs.readFileSync(file, "utf8"), H = sha(pristine);
  fs.writeFileSync(aside, pristine);
  if (sha(fs.readFileSync(aside, "utf8")) !== H) throw new Error(`the pristine copy of ${rel} was not written as read`);
  const base = runTests(m.tests);
  if (base) { console.log(`BASELINE FAILS for ${rel}: ${base}`); process.exit(1); }
  let ran = 0, escaped = [], equiv = [];
  for (const [label, from, to] of m.mutants) {
    if (onlyLabel && !onlyLabel.test(label)) continue;
    if (sha(fs.readFileSync(file, "utf8")) !== H) throw new Error(`${rel} is not pristine before "${label}": stop and look`);
    const src = fs.readFileSync(aside, "utf8");
    let by;
    try {
      fs.writeFileSync(file, src.replace(from, () => to));
      by = runTests(m.tests);
    } finally {
      fs.writeFileSync(file, fs.readFileSync(aside, "utf8"));
      if (sha(fs.readFileSync(file, "utf8")) !== H) { console.log(`RESTORE FAILED: ${rel}`); process.exit(100); }
    }
    ran++;
    const eq = /\[equivalent\b/i.test(label);
    if (!by) (eq ? equiv : escaped).push(label);
    console.log(`${by ? "caught " : eq ? "equiv. " : "ESCAPED"}  ${rel}: ${label}${by ? `   <- ${by}` : ""}`);
  }
  const counted = ran - equiv.length;
  const rate = counted ? escaped.length / counted : 0;
  summary.push(`${rel}: ${escaped.length} of ${counted} escaped (${(rate * 100).toFixed(1)}%) -> ${rate === 0 ? "suspicious (0%)" : rate < 0.25 ? "SOUND" : "WEAK"}${equiv.length ? `; ${equiv.length} equivalent not counted` : ""}`);
}
console.log(`\n${summary.join("\n")}`);
