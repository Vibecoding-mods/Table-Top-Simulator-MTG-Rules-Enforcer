// Two-Headed Giant's table pieces (docs/game-modes-spec.md §5.6, §5.9; tools/engine-renderer.lua engineTeamLooks): the
// team tint (a line round each partner's mat in the team's colour), the team life box between the partners' mats and,
// in Commander, the team's commander damage from each opposing commander. Each appears in a 2HG game with the board's
// numbers, follows a change, and is gone in a free-for-all game and once the game is cleared. Boards are made up here in
// the bridge's shape (bridge/teams.js teamsField, withTeamDamage): Yellow and Blue seated against two AIs.
//   node tests/test_table_team_looks.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };

const SIDES = [["White", "Red"], ["Yellow", "Blue"]];
// life: { colour: n }; rows: extra fields per colour; teams: the board's teams field (null: a free-for-all board)
function board({ life = {}, rows = {}, teams = { poison: 15, cmd: 42, sides: SIDES }, extra = {} } = {}) {
  const pl = (color, slot) => ({
    color, slot, name: color === "White" ? "AI 1" : color === "Red" ? "AI 2" : color, ai: color === "White" || color === "Red", life: life[color] ?? 80, status: "playing", pool: {},
    cmdDamage: {}, tax: [], library: 50, handCount: 0, hand: null, battlefield: [], graveyard: [], exile: [], command: [], ...(rows[color] || {}),
  });
  return JSON.stringify({ t: "table", turn: 2, step: "main1", active: "White", activeTurnNo: 1, priority: "White", gameOver: false, winner: null,
    players: [pl("White", "player-0"), pl("Red", "player-1"), pl("Yellow", "player-2"), pl("Blue", "player-3")], stack: [], cards: {},
    ...(teams ? { teams } : {}), ...extra });
}
const started = (mode) => JSON.stringify({ t: "started", colors: { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" },
  names: { "player-0": "AI 1", "player-1": "AI 2", "player-2": "Yellow", "player-3": "Blue" }, ai: ["White", "Red"], ...(mode ? { mode } : {}) });
const q = (code, mark, frames) => ({ lua: code, mark, ...(frames != null ? { frames } : {}) });
const valueOf = (r, mark) => r.steps.find((s) => s.step === mark)?.value;
const fxOf = (r, mark) => r.steps.find((s) => s.step === mark)?.fx || [];
const sim = (steps) => simulate({ save, seated: ["Yellow", "Blue"], host: "Blue", steps });
const prelude = q('engineAutoPace.Yellow = false engineAutoPace.Blue = false engineChat("mtg start ai 2", Player.Blue) return "ok"', "prelude");

// Each mat's team buttons, top to bottom: "Colour: label@x,z;label@x,z" (world spots, where real TTS draws them: a mat
// zone's button with its local x mirrored, seen live 2026-11-14), "|" between mats with any
const PANELS = 'local out = {} for _, c in ipairs({ "White", "Red", "Yellow", "Blue" }) do local mat = data[c].playmat local parts = {} ' +
  'for _, b in ipairs(mat.getButtons() or {}) do if b.click_function == "engineTeamNoop" then local w = mat.positionToWorld(Vector(-b.position.x, b.position.y, b.position.z)) ' +
  'parts[#parts + 1] = tostring(b.label) .. string.format("@%.2f,%.2f", w.x, w.z) end end ' +
  'if #parts > 0 then out[#out + 1] = c .. ": " .. table.concat(parts, ";") end end return #out == 0 and "none" or table.concat(out, " | ")';
// our lines: "r,g,b xmin..xmax zmin..zmax" each (thickness 0.3501), "|" between; the others' count after "#"
const LINES = 'local out, other = {}, 0 for _, l in ipairs(Global.getVectorLines() or {}) do if math.abs((l.thickness or 0) - 0.3501) < 0.00005 then ' +
  'local x0, x1, z0, z1 = 1e9, -1e9, 1e9, -1e9 for _, p in ipairs(l.points) do x0 = math.min(x0, p[1]) x1 = math.max(x1, p[1]) z0 = math.min(z0, p[3]) z1 = math.max(z1, p[3]) end ' +
  'out[#out + 1] = string.format("%.2f,%.2f,%.2f %.2f..%.2f %.2f..%.2f", l.color[1], l.color[2], l.color[3], x0, x1, z0, z1) else other = other + 1 end end ' +
  'return (#out == 0 and "none" or table.concat(out, " | ")) .. " #" .. other';
const labels = (panels, color) => (String(panels).split(" | ").find((p) => p.startsWith(color + ":")) || "").replace(/^\w+: /, "").split(";").filter(Boolean).map((x) => x.split("@")[0]);
const spots = (panels, color) => (String(panels).split(" | ").find((p) => p.startsWith(color + ":")) || "").replace(/^\w+: /, "").split(";").filter(Boolean).map((x) => x.split("@")[1].split(",").map(Number));
const madeOn = (r, mark) => fxOf(r, mark).filter((l) => /createButton/.test(l) && /TEAM|CMDR|\/42|\b\d+\b/.test(l)).length;

// ── a Commander 2HG game: appears, follows the numbers, goes with the game ──
{
  const r = sim([
    prelude,
    { msg: { t: "started", json: started() } },
    q('Global.setVectorLines({ { points = { { 0, 1, 0 }, { 5, 1, 5 } }, color = { 1, 1, 1 }, thickness = 0.1 } }) return "drawn"', "a player's line"),
    { msg: { t: "table", json: board({ rows: { Yellow: { cmdDamage: { White: 5 } }, Blue: { cmdDamage: { White: 5 } } } }) }, frames: 30 },
    q(PANELS, "panels"), q(LINES, "lines"),
    { msg: { t: "table", json: board({ life: { White: 72, Red: 72 }, rows: { Yellow: { cmdDamage: { White: 9 } }, Blue: { cmdDamage: { White: 9 } }, White: { cmdDamage: { Blue: 3 } }, Red: { cmdDamage: { Blue: 3 } } } }) }, frames: 30, mark: "changed" },
    q(PANELS, "panels 2"),
    // (partners: the bridge's cmdTip names each commander; one box each)
    { msg: { t: "table", json: board({ rows: { Yellow: { cmdDamage: { White: 9 }, cmdTip: { White: "Thrasios, Triton Hero: 4\nTymna the Weaver: 9" } }, Blue: { cmdDamage: { White: 9 }, cmdTip: { White: "Thrasios, Triton Hero: 4\nTymna the Weaver: 9" } } } }) }, frames: 30 },
    q(PANELS, "partners"),
    q('local n = 0 for _, b in ipairs(data.Yellow.playmat.getButtons()) do if b.click_function == "engineTeamNoop" and tostring(b.tooltip):find("Tymna the Weaver (AI 1\'s commander): 9 of 42", 1, true) then n = n + 1 end end return tostring(n)', "partner tip"),
    // (the setup redraw clears the mats' buttons: the next board puts them back)
    q('data.White.playmat.clearButtons() data.Yellow.playmat.clearButtons() return "cleared"', "wiped"),
    { msg: { t: "table", json: board() }, frames: 30 },
    q(PANELS, "healed"),
    { msg: { t: "table", json: board({ extra: { gameOver: true, winner: "Blue" }, life: { White: 0, Red: 0 }, teams: { poison: 15, cmd: 42, sides: SIDES, won: ["Yellow", "Blue"] } }) }, frames: 30 },
    q(PANELS, "game over"),
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 60 },
    q(PANELS, "cleared"), q(LINES, "lines cleared"),
  ]);
  ok("2hg: no errors", !r.errors.length, r.errors.join(" | "));
  const p = valueOf(r, "panels");
  ok("2hg: team life panel on each team's first mat, top to bottom", JSON.stringify(labels(p, "White")) === JSON.stringify(["TEAM", "80", "CMDR DMG", "0/42", "0/42"])
    && JSON.stringify(labels(p, "Yellow")) === JSON.stringify(["TEAM", "80", "CMDR DMG", "5/42", "0/42"]) && !/Red:|Blue:/.test(p), p);
  // between the partners' mats: the gap |x| < 0.9 (the marks boxes from 1.04), on the team's side past the mats' inner
  // edge (|z| > 5.03), clear of the life counters (|z| 2.62) and of the wood strip's buttons and the importer (x -47)
  const inGap = (list, sign) => list.length > 0 && list.every(([x, z]) => Math.abs(x) < 0.05 && sign * z > 5.5 && sign * z < 25.5);
  ok("2hg: the team panels lie in the gap between the partners' mats", inGap(spots(p, "White"), -1) && inGap(spots(p, "Yellow"), 1), p);
  const order = (list, sign) => list.every((s, i) => i === 0 || sign * s[1] > sign * list[i - 1][1]);
  ok("2hg: read from the team's side, TEAM nearest the middle", order(spots(p, "White"), -1) && order(spots(p, "Yellow"), 1), p);
  const l = String(valueOf(r, "lines"));
  const lines = l.split(" #")[0].split(" | ");
  const green = lines.filter((x) => x.startsWith("0.25,0.85,0.55")), violet = lines.filter((x) => x.startsWith("0.80,0.45,1.00"));
  // (the mats: centres x ±19.4, z ±15.4, 37 x 20.75; each line 0.15 inside)
  ok("2hg: team tint, a line round each partner's mat in the team's colour", lines.length === 4 && green.length === 2 && violet.length === 2
    && green.includes("0.25,0.85,0.55 1.05..37.75 -25.63..-5.17") && green.includes("0.25,0.85,0.55 -37.75..-1.05 -25.63..-5.17")
    && violet.includes("0.80,0.45,1.00 -37.75..-1.05 5.17..25.63") && violet.includes("0.80,0.45,1.00 1.05..37.75 5.17..25.63"), l);
  ok("2hg: a player's own line is kept", / #1$/.test(l), l);
  const p2 = valueOf(r, "panels 2");
  ok("2hg: the panels follow life and commander damage", JSON.stringify(labels(p2, "White")) === JSON.stringify(["TEAM", "72", "CMDR DMG", "0/42", "3/42"])
    && JSON.stringify(labels(p2, "Yellow")) === JSON.stringify(["TEAM", "80", "CMDR DMG", "9/42", "0/42"]), p2);
  ok("2hg: a change edits the buttons in place", madeOn(r, "changed") === 0 && fxOf(r, "changed").some((x) => /editButton/.test(x) && /72/.test(x)), fxOf(r, "changed").filter((x) => /Button/.test(x)).join(" / "));
  ok("2hg: the lines are not set again for a number", !fxOf(r, "changed").some((x) => /setVectorLines/.test(x)), "");
  const pp = valueOf(r, "partners");
  ok("2hg: partner commanders get a box each", JSON.stringify(labels(pp, "Yellow")) === JSON.stringify(["TEAM", "80", "CMDR DMG", "4/42", "9/42", "0/42"]) && inGap(spots(pp, "Yellow"), 1), pp);
  ok("2hg: a partner commander's box names it", valueOf(r, "partner tip") === "1", String(valueOf(r, "partner tip")));
  ok("2hg: wiped buttons come back on the next board", JSON.stringify(labels(valueOf(r, "healed"), "White")) === JSON.stringify(["TEAM", "80", "CMDR DMG", "0/42", "0/42"])
    && labels(valueOf(r, "healed"), "Yellow").length === 5, String(valueOf(r, "healed")));
  ok("2hg: the game-over board keeps the final numbers", labels(valueOf(r, "game over"), "White")[1] === "0", String(valueOf(r, "game over")));
  ok("2hg: gone after the game", valueOf(r, "cleared") === "none" && valueOf(r, "lines cleared") === "none #1", `${valueOf(r, "cleared")} ${valueOf(r, "lines cleared")}`);
}

// ── Standard 2HG (30 a team): the life panel and tint, no commander damage (even with a limit on the board) ──
{
  const r = sim([
    prelude,
    { msg: { t: "started", json: started("standard") } },
    { msg: { t: "table", json: board({ life: { White: 30, Red: 30, Yellow: 27, Blue: 27 }, teams: { poison: 15, cmd: 42, sides: SIDES } }) }, frames: 30 },
    q(PANELS, "panels"), q(LINES, "lines"),
  ]);
  ok("standard: no errors", !r.errors.length, r.errors.join(" | "));
  const p = valueOf(r, "panels");
  ok("standard: team life only", JSON.stringify(labels(p, "White")) === JSON.stringify(["TEAM", "30"]) && JSON.stringify(labels(p, "Yellow")) === JSON.stringify(["TEAM", "27"]), p);
  ok("standard: team tint", String(valueOf(r, "lines")).split(" | ").length === 4, String(valueOf(r, "lines")));
}

// ── a free-for-all game: nothing at all ──
{
  const r = sim([
    prelude,
    { msg: { t: "started", json: started() } },
    { msg: { t: "table", json: board({ teams: null, life: { White: 40, Red: 40, Yellow: 40, Blue: 40 } }) }, frames: 30, mark: "ffa board" },
    q(PANELS, "panels"), q(LINES, "lines"),
  ]);
  ok("ffa: no errors", !r.errors.length, r.errors.join(" | "));
  ok("ffa: no team panel", valueOf(r, "panels") === "none", String(valueOf(r, "panels")));
  ok("ffa: no team lines", /^none /.test(String(valueOf(r, "lines"))), String(valueOf(r, "lines")));
  ok("ffa: the board touches no vector lines", !fxOf(r, "ffa board").some((x) => /setVectorLines/.test(x) && /t0\.350/.test(x)), "");
}

// ── a table loaded with a saved 2HG game's lines: they go, a player's stay ──
{
  const r = sim([
    q('Global.setVectorLines({ { points = { { 0, 1, 0 }, { 5, 1, 5 } }, color = { 1, 1, 1 }, thickness = 0.1 }, { points = { { 1, 1, 1 }, { 2, 1, 2 } }, color = { 0.25, 0.85, 0.55 }, thickness = 0.3501 } }) ' +
      'engineTeamLooksLoad() return "loaded"', "load"),
    q(LINES, "lines"),
  ]);
  ok("load: no errors", !r.errors.length, r.errors.join(" | "));
  ok("load: a saved game's team lines go, a player's stay", valueOf(r, "lines") === "none #1", String(valueOf(r, "lines")));
}

console.log(`${failed ? "FAIL" : "PASS"} test_table_team_looks: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
