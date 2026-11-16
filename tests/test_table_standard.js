// Standard mode on the table (docs/game-modes-spec.md §3; tools/engine-renderer.lua + make-engine-copy.js), on the fake
// TTS: "mtg mode standard|commander" is the host's (refused to others, a bad word gets the usage), the Game mode button
// on the setup tile says the mode, Standard is sent to the bridge (the "mode" message, and with every deck check and
// start; Commander is sent as no mode), the commander pieces leave the table in Standard (the commander damage trackers
// under it, hidden and locked with their spot on them; the tax labels blank) and come back as they were, and the life
// counters show the next game's starting life (20 / 40). In a game, the game's own mode ("started") decides the pieces.
//   node tests/test_table_standard.js        (TABLE_SAVE=<save.json> to test a given save)
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
const s1 = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "table-stream-1v1.json"), "utf8"));
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const q = (lua, mark) => ({ lua, mark });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const fxOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).fx || [];

// Lua probes
const sentLog = 'local real = engineSend __sent = {} engineSend = function(t, p) __sent[#__sent + 1] = t .. " " .. JSON.encode(p or {}) return real(t, p) end';
const sent = (mark) => q('local s = table.concat(__sent, "\\n") __sent = {} return s', mark);
const mode = (mark) => q("return tostring(ENGINE_GAME_MODE) .. '|' .. tostring(engineModeNow())", mark);
const tile = (mark) => q('local t = {} for _, o in ipairs(getObjects()) do if o.getGMNotes() == "mtgsetup" then for _, b in ipairs(o.getButtons() or {}) do t[#t + 1] = b.label end end end return table.concat(t, ",")', mark);
// the pieces' GUIDs, from the 4-player table's profile (M6 step 11: the renderer reads TABLE_PROFILE, built from it)
const PROFILE = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tools", "profiles", "2296042369.json"), "utf8"));
const FROM_PROFILE = {
  CMD_DAMAGE: Object.values(PROFILE.cmdDamage || {}).flatMap((row) => Object.values(row)),
  TAX_LABELS: PROFILE.seats.flatMap((c) => PROFILE.seat[c].commandZones.map((z) => z.guid)),
  LIFE_TRACKERS: PROFILE.seats.map((c) => PROFILE.seat[c].lifeTracker.guid),
};
const guids = (name) => FROM_PROFILE[name];
const luaList = (name) => `{ ${guids(name).map((g) => `"${g}"`).join(", ")} }`;
// every commander damage tracker: "y#memo#invisible-to count#locked"; the tax labels' first button labels; the life counters
const pieces = (mark) => q(`local out = {}
  for _, g in ipairs(${luaList("CMD_DAMAGE")}) do local o = getObjectFromGUID(g)
    if o ~= nil then out[#out + 1] = string.format("%.1f", o.getPosition().y) .. "#" .. tostring(o.memo) .. "#" .. tostring(#(o.__d.invisibleTo or {})) .. "#" .. tostring(o.getLock()) end end
  local labels = {}
  for _, g in ipairs(${luaList("TAX_LABELS")}) do local o = getObjectFromGUID(g) if o ~= nil then local b = (o.getButtons() or {})[1] labels[#labels + 1] = b and tostring(b.label) or "none" end end
  local life = {}
  for _, g in ipairs(${luaList("LIFE_TRACKERS")}) do local o = getObjectFromGUID(g) if o ~= nil then life[#life + 1] = tostring(o.getVar("count")) end end
  return table.concat(out, ";") .. "|" .. table.concat(labels, ",") .. "|" .. table.concat(life, ",")`, mark);
const told = (r, mark) => fxOf(r, mark).filter((l) => /broadcast/.test(l)).join(" | ");

const r = simulate({ save, seated: ["Blue", "White"], host: "Blue", steps: [{ lua: "setEngineMode(true)", frames: 120 },
  q(sentLog, "wrap"), mode("at load"), tile("tile at load"), pieces("pieces at load"),
  // the mode button and the mode word
  q('engineChat("mtg mode", Player.White)', "asked"),
  q('engineChat("mtg mode standard", Player.White)', "white sets"), mode("after white"), sent("white sent"),
  q('engineChat("mtg mode vintage", Player.Blue)', "bad word"), mode("after bad word"),
  q('engineChat("mtg mode standard", Player.Blue)', "blue sets"), mode("after blue"), sent("blue sent"), tile("tile standard"), pieces("pieces standard"),
  q('engineChat("mtg mode standard", Player.Blue)', "again"), sent("again sent"), pieces("pieces again"),
  // a deck check and a start in Standard say so
  q('engineSendDecks({ "Blue" }, "Blue")', "decks"), sent("decks sent"),
  q('engineChat("mtg start ai 1", Player.Blue)', "start"), sent("start sent"),
  // back to Commander: the pieces back where they were
  q('engineStartSentAt = nil onMtgSetupMode(nil, "Blue")', "button back"), mode("after button"), sent("button sent"), tile("tile commander"), pieces("pieces back"),
  q('engineSendDecks({ "Blue" }, "Blue")', "decks c"), sent("decks c sent"),
  // a game started in Standard (the bridge's "started" with mode): the pieces leave while it runs, though the next
  // games are set to Commander
  { msg: { t: s1[0].t, json: s1[0].json } }, { msg: { t: "started", json: JSON.stringify({ ...JSON.parse(s1[3].json), mode: "standard" }) } },
  ...s1.slice(4, 12).map((m) => ({ msg: { t: m.t, json: m.json } })),
  mode("in game"), pieces("pieces in game"),
  // the mode changed while the game runs: for the next game; the game's READYs stay
  q('engineReadyState.Blue = "ready" engineChat("mtg mode standard", Player.Blue) return tostring(engineReadyState.Blue)', "mid-game switch"),
  q('engineChat("mtg mode commander", Player.Blue)', "switch back"),
  q("engineClear()", "cleared"), { frames: 30 }, mode("after game"), pieces("pieces after game"),
] });

ok("no Lua errors", r.errors.length === 0, r.errors.join(" / "));
ok("load: Commander, the button says so", valueOf(r, "at load") === "commander|commander" && /,Game mode\nCommander(,|$)/.test(String(valueOf(r, "tile at load"))), `${valueOf(r, "at load")} ${valueOf(r, "tile at load")}`);
const atLoad = String(valueOf(r, "pieces at load")).split("|");
ok("load: the 12 commander damage trackers on the table", atLoad[0].split(";").length === 12 && atLoad[0].split(";").every((p) => /^[0-9.]+#nil#0#/.test(p)), valueOf(r, "pieces at load"));
ok("mtg mode: says the mode", /Game mode: Commander\. The host changes it/.test(told(r, "asked")), told(r, "asked"));
ok("mtg mode: only the host changes it", valueOf(r, "after white") === "commander|commander" && /Only the host can change the game mode/.test(told(r, "white sets")) && !/^mode /.test(String(valueOf(r, "white sent"))), told(r, "white sets"));
ok("mtg mode: another word gets the usage", valueOf(r, "after bad word") === "commander|commander" && /Use:  mtg mode standard/.test(told(r, "bad word")), told(r, "bad word"));
ok("mtg mode standard: the host sets it", valueOf(r, "after blue") === "standard|standard" && /set the game mode: Standard/.test(told(r, "blue sets")), told(r, "blue sets"));
ok("mtg mode standard: sent to the bridge", /^mode \{.*"mode":"standard"/.test(String(valueOf(r, "blue sent"))) && /"color":"Blue"/.test(String(valueOf(r, "blue sent"))), valueOf(r, "blue sent"));
ok("mode button: says Standard", /,Game mode\nStandard(,|$)/.test(String(valueOf(r, "tile standard"))), valueOf(r, "tile standard"));
const std = String(valueOf(r, "pieces standard")).split("|");
const memo = /^enginemode:-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,(true|false)$/;
ok("Standard: every commander damage tracker under the table, hidden, locked, its spot on it", std[0].split(";").length === 12
  && std[0].split(";").every((p) => { const [y, m, inv, lock] = p.split("#"); return Number(y) < -10 && memo.test(m) && Number(inv) > 0 && lock === "true"; }), valueOf(r, "pieces standard"));
// (the tax labels' buttons are their own scripts', not in the fake TTS: what the renderer sets on them is in the record)
const taxSet = (mark) => guids("TAX_LABELS").map((g) => fxOf(r, mark).filter((l) => l.includes("editButton") && l.includes(`obj:${g} 0 `)).map((l) => l.slice(l.indexOf(` 0 `) + 3)).join("/"));
ok("Standard: the tax labels blank", taxSet("blue sets").every((l) => l === '""'), taxSet("blue sets"));
ok("load: the tax labels left alone (no change of mode)", taxSet("0 lua").concat(taxSet("wrap")).every((l) => l === ""), taxSet("0 lua"));
ok("Standard: the life counters at 20", std[2] && std[2].split(",").every((v) => v === "20"), std[2]);
ok("mtg mode standard again: already Standard, nothing sent or moved", /already Standard/.test(told(r, "again")) && valueOf(r, "again sent") === undefined && valueOf(r, "pieces again") === valueOf(r, "pieces standard"),
  `${told(r, "again")} / ${valueOf(r, "again sent")}`);
ok("Standard: the deck check says Standard", /^decks \{.*"mode":"standard"/.test(String(valueOf(r, "decks sent"))), String(valueOf(r, "decks sent")).slice(0, 300));
ok("Standard: the start says Standard", /^start \{.*"mode":"standard"/m.test(String(valueOf(r, "start sent"))), String(valueOf(r, "start sent")).slice(0, 300));
ok("mode button: back to Commander, sent", valueOf(r, "after button") === "commander|commander" && /^mode \{.*"mode":"commander"/.test(String(valueOf(r, "button sent"))) && /,Game mode\nCommander(,|$)/.test(String(valueOf(r, "tile commander"))), `${valueOf(r, "button sent")} ${valueOf(r, "tile commander")}`);
const back = String(valueOf(r, "pieces back")).split("|");
ok("Commander again: the trackers back where they were, shown, with their own lock", back[0] === atLoad[0], `${back[0]}\nwant ${atLoad[0]}`);
ok("Commander again: the tax labels show their number again", taxSet("button back").every((l) => l === '"0"'), taxSet("button back"));
ok("Commander again: the life counters at 40", back[2].split(",").every((v) => v === "40"), back[2]);
ok("Commander: the deck check sends no mode", /^decks \{/.test(String(valueOf(r, "decks c sent"))) && !/"mode"/.test(String(valueOf(r, "decks c sent"))), String(valueOf(r, "decks c sent")).slice(0, 300));
ok("a Standard game running: the game's mode decides", valueOf(r, "in game") === "commander|standard", valueOf(r, "in game"));
ok("a Standard game running: the trackers leave the table", String(valueOf(r, "pieces in game")).split("|")[0].split(";").every((p) => Number(p.split("#")[0]) < -10), valueOf(r, "pieces in game"));
ok("mode changed in a game: for the next one, the game's READYs kept", valueOf(r, "mid-game switch") === "ready" && /set the game mode for the next game: Standard.*READY again after this game./.test(told(r, "mid-game switch")), `${valueOf(r, "mid-game switch")} ${told(r, "mid-game switch")}`);
ok("the game cleared: back to the next games' Commander, the trackers back", valueOf(r, "after game") === "commander|commander" && String(valueOf(r, "pieces after game")).split("|")[0] === atLoad[0], `${valueOf(r, "after game")} ${valueOf(r, "pieces after game")}`);

console.log(failed ? `FAILED: ${failed} failed, ${passed} passed` : `PASSED: ${passed} passed, 0 failed`);
process.exit(failed ? 1 : 0);
