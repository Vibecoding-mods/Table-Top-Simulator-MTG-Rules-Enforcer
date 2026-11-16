// The table profile (M6 steps 9-11, docs/m6-six-seat-spec.md §2.2-2.3): tools/table-profile.js reads a Workshop table's
// seats and objects from its save, make-engine-copy.js builds the engine table from that profile and writes it into
// the Global script as TABLE_PROFILE, and tools/engine-renderer.lua draws from it instead of the 4-player tables.
//  1. The 4-player profile is exactly what the code hard-coded before (the values below, copied from it), in the same
//     order where Lua's pairs or a loop sees the order. The checked-in profiles are what the saves give today.
//  2. The 6-player profile: six seats clockwise, each seat's own objects (the GUID traps of spec §2.1), commander
//     damage from the trackers the build makes (tests/test_table_six.js checks them), and a missing object is an error
//     by name.
//  3. make-engine-copy: the right profile builds both tables; a profile of the other table is refused; the 6-player
//     table's patches all apply, except the two for tools it hasn't got (said as SKIP).
//  4. The renderer on the fake TTS with the 6-player table: six READY buttons, six life counters, marks and tax labels,
//     and the Start tile at the profile's spot.
// The Workshop tables are read, never written. Without them the test says SKIP for what needs them.
//   node tests/test_table_profile.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { profilePath } = require("../tools/table-profile");
const { simulate } = require("./lua/run-sim");

const ROOT = path.join(__dirname, "..");
const WS = process.env.MTG_WORKSHOP_DIR || path.join(process.env.USERPROFILE || process.env.HOME || "", "Documents", "My Games", "Tabletop Simulator", "Mods", "Workshop");
const FOUR = path.join(WS, "2296042369.json"), SIX = path.join(WS, "2293586471.json");
// (the tools under test: a break-it points these at a changed copy)
const TOOLS = process.env.PROFILE_TOOLS || path.join(ROOT, "tools");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}`); } };
const same = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
const q = (lua, mark, frames) => ({ lua, mark, ...(frames != null ? { frames } : {}) });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const tp = require(path.join(TOOLS, "table-profile.js"));

if (!fs.existsSync(FOUR) || !fs.existsSync(SIX)) {
  console.log(`SKIP: the Workshop tables aren't in ${WS} (subscribe to 2296042369 and 2293586471, or set MTG_WORKSHOP_DIR)`);
  process.exit(0);
}
const sha = (f) => require("crypto").createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const before = [sha(FOUR), sha(SIX)];
const four = tp.extract(JSON.parse(fs.readFileSync(FOUR, "utf8")));
const sixSave = JSON.parse(fs.readFileSync(SIX, "utf8"));
const six = tp.extract(sixSave);

// ───────── 1. the 4-player profile = the values the code hard-coded before ─────────
{
  const p = four.profile;
  ok("4p: the profile is complete", p && four.errors.length === 0, four.errors.join("; "));
  if (p) {
    same("4p: seats clockwise (TABLE_COLORS, SETUP.seats, STATUS_SEATS)", p.seats, ["White", "Red", "Yellow", "Blue"]);
    const life = Object.fromEntries(p.seats.map((c) => [c, p.seat[c].lifeTracker.guid]));
    same("4p: LIFE_TRACKERS (and the effects' TRACK), in its order", Object.entries(life), Object.entries({ White: "23e485", Red: "448880", Yellow: "37e533", Blue: "395037" }));
    // (victims and each victim's attackers in CMD_DAMAGE's order: pairs follows it)
    same("4p: CMD_DAMAGE, victims and attackers in its order", JSON.stringify(p.cmdDamage), JSON.stringify({
      White: { Blue: "b748df", Yellow: "0f6598", Red: "6b6e1f" },
      Blue: { White: "bfcf4a", Red: "8d172a", Yellow: "f43e61" },
      Yellow: { Red: "906d4b", White: "484c38", Blue: "45331a" },
      Red: { Yellow: "d5907a", Blue: "95eb63", White: "4bfa09" },
    }));
    same("4p: TAX_LABELS and COMMAND_ZONES, in their order", Object.entries(Object.fromEntries(p.seats.map((c) => [c, p.seat[c].commandZones.map((z) => z.guid)]))),
      Object.entries({ White: ["908f60", "ce8ea5"], Red: ["9d380e", "16aed3"], Yellow: ["baffa9", "dc9c6d"], Blue: ["0c0c5e", "3b2d18"] }));
    same("4p: the Start tile where it always was", p.start, [0, 0.95, 0]);
    same("4p: the remove list = SLIM and the three bags", [...p.remove].sort(), ["5c8648", "098c38", "2d3496",
      "b93b40", "ae12d3", "ad044a", "7a0067", "cd83de", "c5ea55", "b8b8df", "def0af", "c2df33", "222541", "5a7db4",
      "809133", "29f427", "57b8f3", "9df6a3", "eb479b", "a3e6a8", "a7a029", "4c02f8", "9c553c", "cb1610"].sort());
    same("4p: CLUTTER_BOXES", p.clutterBoxes, [{ x: [-56, -44], z: [-8.5, 32] }, { x: [44, 56], z: [-26, 8.5] }]);
    same("4p: Wastes and Treachery are on it (their gates apply)", p.features, { wastes: true, treachery: true });
    same("4p: the registry's mats (8b3401 is White's here, Yellow's on the 6-player table)", p.seats.map((c) => p.seat[c].playmat.guid), ["8b3401", "c20e3f", "129eaa", "56cd9d"]);
    same("4p: nothing missing", p.notFound, []);
    same("4p: the engine save's name", p.saveName, "MTG 4 player table - ENGINE MODE");
  }
  for (const [name, r, file] of [["4p", four, FOUR], ["6p", six, SIX]]) {
    const at = profilePath(r.profile ? r.profile.id : "x");
    ok(`${name}: the checked-in ${path.basename(at)} is what the save gives today`, r.profile && fs.existsSync(at) && fs.readFileSync(at, "utf8").replace(/\r\n/g, "\n") === tp.profileText(r.profile),
      `node tools/table-profile.js "${file}" writes it`);
    // only GUIDs, positions, colours and our choices: no names, scripts or links of the table's
    const text = r.profile ? tp.profileText(r.profile) : "";
    ok(`${name}: the profile holds no script, link or object name of the table`, text && !/LuaScript|https?:|Nickname|Life Tracker|Commander Zone|rikrassen/.test(text) && text.length < 20000, text.length);
  }
}

// ───────── 2. the 6-player profile ─────────
{
  const p = six.profile;
  ok("6p: the profile is complete", p && six.errors.length === 0, six.errors.join("; "));
  if (p) {
    same("6p: seats clockwise from White", p.seats, ["White", "Red", "Yellow", "Green", "Blue", "Purple"]);
    // spec §2.1's seat table (and m6-compare-objects.md §4): mats, hand zones, life trackers
    same("6p: each seat's playmat (the GUID traps: 8b3401 Yellow, 56cd9d Green, 129eaa Blue)", p.seats.map((c) => p.seat[c].playmat.guid), ["7cffe1", "c20e3f", "8b3401", "56cd9d", "129eaa", "d2aff5"]);
    same("6p: each seat's library zone (166036 Yellow, c04462 Green, 033b34 Blue)", p.seats.map((c) => p.seat[c].libraryZone.guid), ["409503", "2365d0", "166036", "c04462", "033b34", "60bfe2"]);
    same("6p: each seat's life tracker (White's is c2e905 here)", p.seats.map((c) => p.seat[c].lifeTracker.guid), ["c2e905", "448880", "37e533", "0c1b22", "395037", "2ee5fb"]);
    same("6p: each seat's main hand zone", p.seats.map((c) => p.seat[c].hand.guid), ["541bb1", "c029b6", "3d19e1", "fa1564", "e3dba4", "ce0263"]);
    // (two zones one behind the other: the one nearest the player first, the rule for level zones)
    same("6p: each seat's commander zones, nearest the player first (9d380e is White's here)", p.seats.map((c) => p.seat[c].commandZones.map((z) => z.guid).join(" ")),
      ["9d380e 40584f", "f9be00 9cb4b6", "ba751d 48daef", "206ce5 2fa3e2", "144ccc 399da3", "2af6c5 47e079"]);
    ok("6p: no commander damage trackers of its own: 30 made (M6 step 12), cmdDamage from them, nothing missing", p.cmdDamageMade && p.cmdDamageMade.length === 30 && p.cmdDamage != null && Object.keys(p.cmdDamage).length === 6 && p.notFound.length === 0, JSON.stringify(p.notFound));
    same("6p: the Start tile between the life counters", p.start, [0, 0.95, 0]);
    same("6p: no Wastes, no Treachery", p.features, { wastes: false, treachery: false });
    // the silent misses of the 4-player lists (m6-compare-objects.md §6.1): all six timers, both πKeywords, all eight bundles
    ok("6p: all six timers removed", ["809133", "37dd7e", "252e18", "8a13cc", "cbb976", "ab15d9"].every((g) => p.remove.includes(g)), p.remove.join(" "));
    ok("6p: both πKeywords removed (ae12d3 and the current ddd349)", p.remove.includes("ae12d3") && p.remove.includes("ddd349"), p.remove.join(" "));
    ok("6p: all eight 3D bundles under the table removed", ["eb479b", "cb1610", "a3e6a8", "c42075", "06d2e0", "f72932", "3da261", "5f75f7"].every((g) => p.remove.includes(g)), p.remove.join(" "));
    same("6p: its own clutter boxes, the end columns (M6 step 13)", p.clutterBoxes, [{ x: [-56, -45], z: [-8.5, 33] }, { x: [45, 56], z: [-33, 8.5] }]);
    same("6p: the engine save's name", p.saveName, "MTG 6 player table - ENGINE MODE");
  }
  // a missing object is an error by name: Green's life tracker and Purple's playmat taken out of a copy
  const broken = JSON.parse(JSON.stringify(sixSave));
  broken.ObjectStates = broken.ObjectStates.filter((o) => o.GUID !== "0c1b22" && o.GUID !== "d2aff5");
  const b = tp.extract(broken);
  ok("6p, objects missing: no profile", b.profile === null);
  ok("6p, objects missing: Green's life tracker named", b.errors.some((e) => /^Green\.lifeTracker: 0 found/.test(e)), b.errors.join("; "));
  ok("6p, objects missing: Purple's playmat named", b.errors.some((e) => /^Purple\.playmat: d2aff5 is in Global's registry but not on the table/.test(e)), b.errors.join("; "));
}

// ───────── 3. make-engine-copy with a profile ─────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-profile-"));
// (the 6-player table reads the 4-player one for its commander-damage trackers and backdrop: --tracker-source)
const copy = (src, out, profile) => spawnSync(process.execPath, [path.join(TOOLS, "make-engine-copy.js"), src, out, ...(profile ? ["--profile", profile] : []), "--tracker-source", FOUR], { encoding: "utf8", maxBuffer: 1 << 26 });
let sixBuilt = null;
try {
  const r6 = copy(SIX, path.join(tmp, "six.json"), profilePath("2293586471"));
  ok("6p: make-engine-copy builds it with its profile", r6.status === 0 && fs.existsSync(path.join(tmp, "six.json")), r6.stdout.split("\n").filter((l) => /^FAIL/.test(l)).join(" | ") || r6.stderr);
  const lines = r6.stdout.split("\n");
  same("6p: the patches that don't apply are the two tools it hasn't got, said as SKIP", lines.filter((l) => /^(SKIP|FAIL)/.test(l)),
    ["SKIP gate Get basic land: deckRampWa (this table has no Wastes button)", "SKIP gate Treachery identity token buttons (x2) (this table has no Treachery cards)"]);
  ok("6p: the per-seat patches count six seats (life counters, hand counters x2)", lines.includes("OK   Life counter: engineLifeChange (6 scripts)")
    && lines.includes("OK   Hand counter: the engine's count (12 scripts)") && lines.includes("OK   hand counters relabel only on change (12)"), lines.filter((l) => /counter/i.test(l)).join(" | "));
  if (r6.status === 0) sixBuilt = JSON.parse(fs.readFileSync(path.join(tmp, "six.json"), "utf8"));
  ok("6p: the engine save is named for six players", sixBuilt && sixBuilt.SaveName === "MTG 6 player table - ENGINE MODE", sixBuilt && sixBuilt.SaveName);
  ok("6p: TABLE_PROFILE in its Global script, six seats", sixBuilt && sixBuilt.LuaScript.includes('  seats = { "White", "Red", "Yellow", "Green", "Blue", "Purple" },\n'));
  ok("6p: the table tells the bridge its six seats (ENGINE_TABLE_SEATS from the profile)", sixBuilt && sixBuilt.LuaScript.includes("\nENGINE_TABLE_SEATS = TABLE_PROFILE.seats"));

  const wrong = copy(SIX, path.join(tmp, "wrong.json"), profilePath("2296042369"));
  ok("profile of the other table: refused, nothing written", wrong.status === 1 && /FAIL table profile: .*2296042369\.json is not this table's/.test(wrong.stdout) && !fs.existsSync(path.join(tmp, "wrong.json")), wrong.stdout.slice(0, 300));
  const missing = copy(FOUR, path.join(tmp, "missing.json"), path.join(tmp, "nope.json"));
  ok("a --profile file that isn't there: refused", missing.status === 1 && !fs.existsSync(path.join(tmp, "missing.json")), missing.stdout.slice(0, 200));
  const r4 = copy(FOUR, path.join(tmp, "four.json"), profilePath("2296042369"));
  const r4plain = copy(FOUR, path.join(tmp, "four-plain.json"), null);
  ok("4p: built with its profile = built without one (the profile is read from the table either way)", r4.status === 0 && r4plain.status === 0
    && fs.readFileSync(path.join(tmp, "four.json"), "utf8") === fs.readFileSync(path.join(tmp, "four-plain.json"), "utf8"), r4.stdout.split("\n").filter((l) => /^FAIL/.test(l)).join(" | "));
  const four4 = r4.status === 0 ? JSON.parse(fs.readFileSync(path.join(tmp, "four.json"), "utf8")) : { LuaScript: "" };
  // (the renderer's per-seat button lists in the order they had: engineTableButtons moves them in it)
  ok("4p: the table buttons in the order the renderer listed them", four4.LuaScript.includes('  buttons = { "86e447", "1f3e4a", "18fb5d", "e2f7ae", "59ab68", "0ad181", "c489e1", "d67eb4", "885f49", "305c12", "26775a", "b49d50", "67b4a5", "da5d0d", "d06889", "57914a", "ffa67c", "8a4c8b", "614515", "4e19c8", "c53ac6", "47645d", "3b07ae", "e0a3bc" },\n')
    && four4.LuaScript.includes('  draw = { "885f49", "305c12", "26775a", "b49d50" },\n'));
  ok("4p: the seat list is left to the bridge's default (no ENGINE_TABLE_SEATS)", four4.LuaScript.length > 0 && !four4.LuaScript.includes("ENGINE_TABLE_SEATS ="));
  same("4p: no SKIP or FAIL", r4.stdout.split("\n").filter((l) => /^(SKIP|FAIL)/.test(l)), []);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

// ───────── 4. the renderer on the 6-player table (fake TTS) ─────────
if (sixBuilt) {
  const SEATS = ["White", "Red", "Yellow", "Green", "Blue", "Purple"];
  const players = SEATS.map((color, i) => ({ color, slot: `player-${i}`, name: color, ai: false, life: 31 + i, status: "playing", pool: {},
    allMarks: [`POISON ${i + 1}`], cmdDamage: {}, tax: [i + 1, 0], library: 50, handCount: 0, hand: null, battlefield: [], graveyard: [], exile: [], command: [] }));
  const board = JSON.stringify({ t: "table", turn: 2, step: "main1", active: "White", activeTurnNo: 1, priority: "White", gameOver: false, winner: null, players, stack: [], cards: {} });
  const started = JSON.stringify({ t: "started", colors: Object.fromEntries(players.map((p) => [p.slot, p.color])), names: Object.fromEntries(players.map((p) => [p.slot, p.color])), ai: [] });
  const each = (body) => `local out = {} for _, c in ipairs(TABLE_PROFILE.seats) do ${body} end return table.concat(out, "|")`;
  const r = simulate({ save: sixBuilt, seated: SEATS, host: "White", steps: [
    q('return table.concat(TABLE_PROFILE.seats, ",")', "seats"),
    // (the mats where the fake TTS has them, by Global's own data table: angle from the middle, seen from above)
    q(each('local p = data[c].playmat.getPosition() out[#out + 1] = string.format("%.4f", (math.atan2 or math.atan)(p.z, p.x))'), "angles"),
    q('engineChat("mtg engine on", Player.White) return "on"', "on", 150),
    q(each('local n = 0 for _, b in ipairs(data[c].playmat.getButtons() or {}) do if b.click_function == "onMtgSetupReady" then n = n + 1 end end out[#out + 1] = c .. "=" .. n'), "ready"),
    q('for _, o in ipairs(getObjects()) do if o.getGMNotes() == "mtgsetup" then local p = o.getPosition() return string.format("%.2f,%.2f,%.2f", p.x, p.y, p.z) end end return "none"', "tile"),
    { msg: { t: "started", json: started } },
    { msg: { t: "table", json: board }, frames: 150 },
    q(each('local o = getObjectFromGUID(TABLE_PROFILE.life[c]) out[#out + 1] = c .. "=" .. tostring(o and o.getVar("count"))'), "life"),
    q(each('local o = getObjectFromGUID(TABLE_PROFILE.life[c]) local n = {} for _, b in ipairs((o and o.getButtons()) or {}) do if engineMarksIsBox(b) then n[#n + 1] = b.label end end out[#out + 1] = c .. "=" .. table.concat(n, ",")'), "marks"),
    q(each('local o = getObjectFromGUID(TABLE_PROFILE.tax[c][1]) out[#out + 1] = c .. "=" .. tostring(o and o.getVar("val"))'), "tax"),
  ] });
  ok("6p sim: the table runs without errors", r.errors.length === 0, r.errors.slice(0, 3).join(" | "));
  same("6p sim: TABLE_PROFILE.seats in the running script", valueOf(r, "seats"), SEATS.join(","));
  // clockwise from above = the angle falls from each seat to the next (once round, from White)
  const ang = String(valueOf(r, "angles")).split("|").map(Number);
  const turns = ang.map((a, i) => ((ang[0] - a) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI));
  ok("6p sim: the seats go clockwise round the table, each after the last", ang.length === 6 && turns.every((t, i) => i === 0 || t > turns[i - 1]), valueOf(r, "angles"));
  same("6p sim: a READY button on each of the six mats", valueOf(r, "ready"), SEATS.map((c) => `${c}=1`).join("|"));
  same("6p sim: the Start tile at the profile's spot", valueOf(r, "tile"), "0.00,0.95,0.00");
  same("6p sim: each seat's own life counter shows its life", valueOf(r, "life"), SEATS.map((c, i) => `${c}=${31 + i}`).join("|"));
  same("6p sim: each seat's life counter shows its marks", valueOf(r, "marks"), SEATS.map((c, i) => `${c}=POISON ${i + 1}`).join("|"));
  same("6p sim: each seat's first commander zone shows its tax", valueOf(r, "tax"), SEATS.map((c, i) => `${c}=${i + 1}`).join("|"));
}

same("the Workshop tables only read, never written", [sha(FOUR), sha(SIX)], before);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
