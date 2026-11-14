// Seated players promoted while engine mode is on (make-engine-copy.js enginePromoteSeated, called by setEngineMode and,
// two frames later, onPlayerChangeColor), on the fake TTS, whose promote() toggles like TTS's: engine on promotes every
// seated player but the host; engine on twice doesn't toggle them back; engine off demotes only the ones the table
// promoted; a player the host promoted stays promoted (and keeps the host-only commands); a player who leaves their
// seat is demoted and promoted again when they sit back down; a table-promoted player does NOT get the host-only "mtg"
// commands; the list is saved with the game (onSave) as one text.
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
  q("setEngineMode(true) return 'ok'", "on"), state("after on"),
  q("setEngineMode(true) return 'ok'", "on again"), state("after on again"),
  // a table-promoted player asks for a host-only command
  q("engineChat('mtg fx off', Player.White) return 'ok'", "white fx"),
  q("return JSON.decode(onSave()).enginePromoted", "saved"),
  q("setEngineMode(false) return 'ok'", "off"), state("after off"),
  // the host promotes Red by hand while engine mode is off; engine on, then off: Red keeps it, and the host commands
  q("Player.Red.promote() setEngineMode(true) setEngineMode(false) return 'ok'", "host's own"), state("after host's own"),
  q("engineChat('mtg fx off', Player.Red) return 'ok'", "red fx"),
  // White leaves their seat while engine mode is on (onPlayerChangeColor runs its pass two frames later)
  q("Player.Red.promote() setEngineMode(true) __sim.present = { White = true } __sim.seated.White = nil onPlayerChangeColor('Grey') __sim.frames(3) return 'ok'", "leaves"), state("after leaves"),
  // and sits down again
  q("__sim.seated.White = true onPlayerChangeColor('White') __sim.frames(3) return 'ok'", "back"), state("after back"),
] });

ok("promote: the script ran", !r.errors.length, r.errors.slice(0, 2).join(" | "));
ok("promote: nobody promoted with engine mode off", valueOf(r, "start") === "Blue=false,White=false,Red=false", valueOf(r, "start"));
ok("promote: engine on promotes every seated player but the host", valueOf(r, "after on") === "Blue=false,White=true,Red=true", valueOf(r, "after on"));
ok("promote: engine on twice leaves them promoted (no toggle back)", valueOf(r, "after on again") === "Blue=false,White=true,Red=true", valueOf(r, "after on again"));
ok("promote: a player the table promoted gets no host-only command", /Only the host can change the table's particle effects/.test(told(r, "white fx")), told(r, "white fx"));
ok("promote: the table's list is saved with the game, as one text", typeof valueOf(r, "saved") === "string" && valueOf(r, "saved").split(",").sort().join(",") === "sim-Red,sim-White", JSON.stringify(valueOf(r, "saved")));
ok("promote: engine off demotes the ones the table promoted", valueOf(r, "after off") === "Blue=false,White=false,Red=false", valueOf(r, "after off"));
ok("promote: a player the host promoted stays promoted after engine off", valueOf(r, "after host's own") === "Blue=false,White=false,Red=true", valueOf(r, "after host's own"));
ok("promote: and keeps the host-only commands", !/Only the host/.test(told(r, "red fx")), told(r, "red fx"));
ok("promote: a player who leaves their seat is demoted", /White=false/.test(valueOf(r, "after leaves") || "") && /Red=true/.test(valueOf(r, "after leaves") || ""), valueOf(r, "after leaves"));
ok("promote: and promoted again when they sit back down", /White=true/.test(valueOf(r, "after back") || ""), valueOf(r, "after back"));

console.log(`${failed ? failed + " failed, " : ""}${failed ? "" : "all "}${passed} passed`);
process.exit(failed ? 1 : 0);
