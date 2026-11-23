// Seated players promoted, engine mode on or off (make-engine-copy.js enginePromoteSeated, called by setEngineMode, the
// table's load and, two frames later, onPlayerChangeColor), on the fake TTS, whose promote() toggles like TTS's: every
// seated player but the host promoted before any engine game (the original table's Auto Player Promoter, which the
// engine copy removes, did it; without it friends couldn't move or delete their own decks before a game, the user
// 2026-11-23); engine on twice doesn't toggle them back; engine off keeps them promoted; a player the host promoted stays
// promoted (and keeps the host-only commands) and isn't on the table's list; a player the table promoted who leaves
// their seat is demoted and promoted again when they sit back down; a table-promoted player does NOT get the host-only
// "mtg" commands; the list is saved with the game (onSave) as one text.
// (The user, 2026-11-14: "allow the other players the same privileges the host has when the engine is on".)
//   node tests/test_table_promote.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const q = (lua, mark) => ({ lua, mark });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const told = (r, mark) => ((r.steps.find((s) => s.step === mark) || {}).fx || []).filter((l) => /broadcast/.test(l)).join(" | ");
const state = (mark) => q(`local s = {} for _, c in ipairs({ "Blue", "White", "Red" }) do s[#s + 1] = c .. "=" .. tostring(Player[c].promoted) end return table.concat(s, ",")`, mark);

const r = simulate({ save: buildSave(), seated: ["Blue", "White", "Red"], host: "Blue", steps: [
  state("start"),
  // the table's pass with engine mode off (before any game, as at its load)
  q("ENGINE_MODE = false enginePromoteSeated() return 'ok'", "pre"), state("before a game"),
  // Red leaves their seat (demoted), the host promotes Red by hand, Red sits down again: Red is the host's, not the table's
  q("__sim.present = { Red = true } __sim.seated.Red = nil onPlayerChangeColor('Grey') __sim.frames(3) local was = Player.Red.promoted Player.Red.promote() __sim.seated.Red = true onPlayerChangeColor('Red') __sim.frames(3) return tostring(was)", "host red"),
  q("setEngineMode(true) return 'ok'", "on"), state("after on"),
  q("setEngineMode(true) return 'ok'", "on again"), state("after on again"),
  // a table-promoted player asks for a host-only command
  q("engineChat('mtg fx off', Player.White) return 'ok'", "white fx"),
  q("return JSON.decode(onSave()).enginePromoted", "saved"),
  q("setEngineMode(false) return 'ok'", "off"), state("after off"),
  q("engineChat('mtg fx off', Player.Red) return 'ok'", "red fx"),
  // White and Red leave their seats (onPlayerChangeColor runs its pass two frames later)
  q("__sim.present = { White = true, Red = true } __sim.seated.White = nil __sim.seated.Red = nil onPlayerChangeColor('Grey') __sim.frames(3) return 'ok'", "leaves"), state("after leaves"),
  // and sit down again
  q("__sim.seated.White = true __sim.seated.Red = true onPlayerChangeColor('White') __sim.frames(3) return 'ok'", "back"), state("after back"),
] });

ok("promote: the script ran", !r.errors.length, r.errors.slice(0, 2).join(" | "));
ok("promote: the table's load promotes the seated players (engine mode off)", valueOf(r, "start") === "Blue=false,White=true,Red=true", valueOf(r, "start"));
ok("promote: Red demoted on leaving, before the host promotes them", valueOf(r, "host red") === "false", valueOf(r, "host red"));
ok("promote: every seated player but the host promoted before any engine game", valueOf(r, "before a game") === "Blue=false,White=true,Red=true", valueOf(r, "before a game"));
ok("promote: engine on leaves them promoted", valueOf(r, "after on") === "Blue=false,White=true,Red=true", valueOf(r, "after on"));
ok("promote: engine on twice leaves them promoted (no toggle back)", valueOf(r, "after on again") === "Blue=false,White=true,Red=true", valueOf(r, "after on again"));
ok("promote: a player the table promoted gets no host-only command", /Only the host can change the table's particle effects/.test(told(r, "white fx")), told(r, "white fx"));
ok("promote: the table's list is saved with the game, as one text (not the host's own)", valueOf(r, "saved") === "sim-White", JSON.stringify(valueOf(r, "saved")));
ok("promote: engine off keeps them promoted", valueOf(r, "after off") === "Blue=false,White=true,Red=true", valueOf(r, "after off"));
ok("promote: a player the host promoted keeps the host-only commands", !/Only the host/.test(told(r, "red fx")), told(r, "red fx"));
ok("promote: a player the table promoted who leaves their seat is demoted; the host's stays", valueOf(r, "after leaves") === "Blue=false,White=false,Red=true", valueOf(r, "after leaves"));
ok("promote: and promoted again when they sit back down", valueOf(r, "after back") === "Blue=false,White=true,Red=true", valueOf(r, "after back"));

console.log(`${failed ? failed + " failed, " : ""}${failed ? "" : "all "}${passed} passed`);
process.exit(failed ? 1 : 0);
