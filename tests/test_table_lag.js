// Lag-outs and lag spikes on the table (the user, 2026-11-15: "when someone lags out or lag spike the game bugs out").
// 1. What the table sends is numbered (make-engine-copy.js engineSend / enginePump): the web request carries the load's
//    sid and the message's number in its headers, and the 5 s watchdog's second copy (sendExternalMessage) carries the
//    same two, so the bridge can drop it (bridge.js seenFromTable; tests/test_bridge_lag.js). A late answer to the web
//    request sends nothing more.
// 2. A player out of their seat mid-game and back (tools/engine-renderer.lua engineSeatCheck / engineSeatBack): while
//    they are away a board leaves their hand out and the screen UI is built without their panel (as before); once they
//    sit down again their hand is back in their hand face up (the table's own onPlayerDisconnect turned it face down),
//    the screen UI has their panel again and their open question shows again. Everyone is told once when the seat
//    empties. "mtg refresh" does it for your own seat and asks the bridge for the game again (hello, again).
// Boards are made up here in the bridge's shape: Yellow and Blue seated, White and Red AIs.
//   node tests/test_table_lag.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 500)}` : ""}`); } };
const q = (lua, mark, frames) => ({ lua, mark, ...(frames != null ? { frames } : {}) });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const fxOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).fx || [];
const json = (r, mark) => { try { return JSON.parse(String(valueOf(r, mark))); } catch (e) { return null; } };
const said = (r, mark) => fxOf(r, mark).filter((l) => /broadcast/.test(l)).join(" | ");

// ── 1. numbered messages ──
{
  const r = simulate({ save, seated: ["Blue"], host: "Blue", steps: [
    q("return 'ok'", "settle", 30),
    q(`__ext = {} sendExternalMessage = function(t) __ext[#__ext + 1] = t end
      __sim.liveWeb = true __sim.webq = __sim.webq or {}
      engineSend("answer", { color = "Blue", promptId = 5, choice = { "a" } })
      local w = __sim.webq[#__sim.webq]
      return JSON.encode({ n = #__sim.webq, sid = w.headers["X-Mtg-Sid"], q = w.headers["X-Mtg-Seq"], body = w.body })`, "sent", 1),
    // the bridge doesn't answer for 5 s (a host frame hitch): the old way, with the same number
    { frames: 320 },
    q("return JSON.encode({ ext = __ext })", "watchdog", 1),
    // then the web request's late answer: nothing more is sent; the next message has the next number
    q(`__sim.webDone(__sim.webq[#__sim.webq].id, false) __sim.frames(2)
      local before = #__sim.webq
      engineSend("intent", { color = "Blue", kind = "play", id = "engine-card-1" })
      local w = __sim.webq[#__sim.webq]
      return JSON.encode({ ext = #__ext, more = #__sim.webq - before, q = w.headers["X-Mtg-Seq"], sid = w.headers["X-Mtg-Sid"] })`, "late", 2),
  ] });
  ok("numbered: no script errors", !r.errors.length, r.errors.slice(0, 2).join(" | "));
  const s = json(r, "sent") || {};
  ok("numbered: the web request carries the load's sid and the message's number in headers", typeof s.sid === "string" && s.sid.length > 3 && /^\d+$/.test(String(s.q)), valueOf(r, "sent"));
  ok("numbered: the body is still the message alone ({ t, json }, no number in it)", /^\{"json":/.test(String(s.body)) && !/X-Mtg|"q":|"sid":/.test(String(s.body)), s.body);
  const w = json(r, "watchdog") || {};
  const ext = (w.ext || [])[0] || {};
  ok("numbered: after 5 s without an answer the old way sends it once", (w.ext || []).length === 1 && ext.t === "answer", valueOf(r, "watchdog"));
  ok("numbered: that copy carries the same sid and number", ext.sid === s.sid && String(ext.q) === String(s.q), `${JSON.stringify(ext).slice(0, 200)} vs ${valueOf(r, "sent")}`);
  const l = json(r, "late") || {};
  ok("numbered: the late web answer sends nothing more", l.ext === 1 && l.more === 1, valueOf(r, "late"));
  ok("numbered: the next message has the next number, same sid", Number(l.q) === Number(s.q) + 1 && l.sid === s.sid, valueOf(r, "late"));
}

// ── 2. a seat left and taken again mid-game ──
const cards = {
  "engine-card-601": { n: "Llanowar Elves", f: "https://example.invalid/elves.jpg", b: "", tl: "Creature — Elf Druid", ty: ["Creature"] },
  "engine-card-602": { n: "Counterspell", f: "https://example.invalid/counter.jpg", b: "", tl: "Instant", ty: ["Instant"] },
  "engine-card-603": { n: "Forest", f: "https://example.invalid/forest.jpg", b: "", tl: "Basic Land — Forest", ty: ["Land"] },
};
function board(turn = 2) {
  const pl = (color, slot, hand) => ({
    color, slot, name: color === "White" ? "AI 1" : color === "Red" ? "AI 2" : color, ai: color === "White" || color === "Red", life: 40, status: "playing", pool: {},
    cmdDamage: {}, tax: [], library: 50, handCount: hand ? hand.length : 3, hand: hand ? hand.map((id) => ({ s: 1, id, ctl: color })) : null,
    battlefield: [], graveyard: [], exile: [], command: [],
  });
  return { msg: { t: "table", json: JSON.stringify({ t: "table", turn, step: "main1", active: "Yellow", activeTurnNo: 1, priority: "Yellow", gameOver: false, winner: null,
    players: [pl("White", "player-0"), pl("Red", "player-1"), pl("Yellow", "player-2", ["engine-card-601", "engine-card-602"]), pl("Blue", "player-3", ["engine-card-603"])],
    stack: [], cards }) }, frames: 60 };
}
const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "White", "player-1": "Red", "player-2": "Yellow", "player-3": "Blue" },
  names: { "player-0": "AI 1", "player-1": "AI 2", "player-2": "Yellow", "player-3": "Blue" }, ai: ["White", "Red"] });
const PRIO = { msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Yellow", promptId: 379, kind: "priority", title: "Your priority", mode: "single",
  options: [{ id: "__pass", label: "Next" }, { id: "__endturn", label: "End turn" }] }) }, frames: 10 };
const prelude = q('engineAutoPace.Yellow = false engineAutoPace.Blue = false engineChat("mtg start ai 2", Player.Blue) return "ok"', "prelude");
// Yellow's two hand cards: "<in Yellow's hand>/<face up>" each, "none" for one not on the table
const HAND = `local out = {} for _, id in ipairs({ "engine-card-601", "engine-card-602" }) do
  local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:" .. id then o = x end end
  if o == nil then out[#out + 1] = "none" else
    local inH = false for _, h in ipairs(Player.Yellow.getHandObjects(1)) do if h == o then inH = true end end
    local z = o.getRotation().z
    out[#out + 1] = (inH and "hand" or "out") .. "/" .. ((math.abs(((z + 180) % 360) - 180) > 90) and "down" or "up")
  end end return table.concat(out, " ")`;
// Yellow's corner button and whether the screen UI has Yellow's panel
const VIEW = `engineUpdateCorner("Yellow", enginePrompts.Yellow)
  return JSON.encode({ panel = (tostring(UI.getXml() or ""):find('id="eng_big_Yellow"', 1, true) ~= nil), big = tostring(UI.getAttribute("eng_big_Yellow", "text") or UI.getValue("eng_big_Yellow")),
    open = enginePrompts.Yellow and enginePrompts.Yellow.promptId or "none", active = tostring(UI.getAttribute("eng_big_Yellow", "active")) })`;
const setXml = (r, mark) => fxOf(r, mark).filter((l) => /UI\.setXml/.test(l)).length;
const sent = (r, mark) => fxOf(r, mark).filter((l) => /WebRequest\.custom/.test(l)).join(" ").split("\\").join("");

{
  const r = simulate({ save, seated: ["Yellow", "Blue"], host: "Blue", steps: [
    prelude, { msg: { t: "started", json: STARTED } }, board(), PRIO,
    q(HAND, "hand at first"), q(VIEW, "view at first"),
    // Yellow's TTS drops out: the table's own onPlayerDisconnect turns the hand face down, and the seat is empty
    q('onPlayerDisconnect(Player.Yellow) __sim.seated.Yellow = nil return "ok"', "away", 70),
    q(HAND, "hand flipped"),
    // the game goes on meanwhile (another board): Yellow's hand is left out, the screen UI drops Yellow's panel
    board(3), q(HAND, "hand while away"), q(VIEW, "view while away"),
    // Yellow is back in the seat
    q('__sim.seated.Yellow = true onPlayerChangeColor("Yellow") return "ok"', "back", 40),
    q(HAND, "hand back"), q(VIEW, "view back"),
    q("return 'ok'", "settle", 120),
  ] });
  ok("seat: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("seat: Yellow's hand is in Yellow's hand at first", valueOf(r, "hand at first") === "hand/up hand/up", valueOf(r, "hand at first"));
  const v0 = json(r, "view at first") || {};
  ok("seat: Yellow's question shows at first", v0.panel === true && v0.big === "Next" && v0.open === 379, valueOf(r, "view at first"));
  ok("seat: everyone is told once that Yellow is out of their seat", /Yellow is out of their seat: the game keeps it/.test(said(r, "away")) && (said(r, "away").match(/out of their seat/g) || []).length === 1, said(r, "away"));
  const tlogs = r.steps.flatMap((st) => (st.fx || []).filter((l) => /WebRequest\.custom/.test(l) && /tlog/.test(l))).join(" ").split("\\").join("");
  ok("seat: the table log has it", /Yellow left the seat mid-game/.test(tlogs), tlogs.slice(0, 400));
  ok("seat: (the table's own disconnect turns the hand face down)", valueOf(r, "hand flipped") === "hand/down hand/down", valueOf(r, "hand flipped"));
  ok("seat: (a board while Yellow is away leaves the hand out)", valueOf(r, "hand while away") === "none none", valueOf(r, "hand while away"));
  ok("seat: (and the screen UI has no panel for the empty seat)", (json(r, "view while away") || {}).panel === false, valueOf(r, "view while away"));
  ok("seat: back in the seat, Yellow's hand is back in the hand", /^hand\/\w+ hand\/\w+$/.test(String(valueOf(r, "hand back"))), valueOf(r, "hand back"));
  ok("seat: back in the seat, the hand is face up", valueOf(r, "hand back") === "hand/up hand/up", valueOf(r, "hand back"));
  const v1 = json(r, "view back") || {};
  ok("seat: back in the seat, the screen UI has Yellow's panel again", v1.panel === true, valueOf(r, "view back"));
  ok("seat: back in the seat, Yellow's open question shows again (#379, Next)", v1.open === 379 && v1.big === "Next" && v1.active !== "false", valueOf(r, "view back"));
  ok("seat: nobody is told again once Yellow is back", !/out of their seat/.test(said(r, "back") + said(r, "settle")), said(r, "back"));
}

// a seat left and taken again before any board came: the hand that the table's disconnect turned face down turns up
{
  const r = simulate({ save, seated: ["Yellow", "Blue"], host: "Blue", steps: [
    prelude, { msg: { t: "started", json: STARTED } }, board(), PRIO,
    q('onPlayerDisconnect(Player.Yellow) __sim.seated.Yellow = nil return "ok"', "away", 70),
    q('__sim.seated.Yellow = true onPlayerChangeColor("Yellow") return "ok"', "back", 40),
    q(HAND, "hand back"), q(VIEW, "view back"),
  ] });
  ok("quick return: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("quick return: the hand is face up in the hand again", valueOf(r, "hand back") === "hand/up hand/up", valueOf(r, "hand back"));
  ok("quick return: the screen UI is sent again (UI.setXml)", setXml(r, "back") >= 1, fxOf(r, "back").filter((l) => /UI\./.test(l)).slice(0, 3).join(" | "));
  ok("quick return: the question shows", (json(r, "view back") || {}).open === 379 && (json(r, "view back") || {}).big === "Next", valueOf(r, "view back"));
}

// "mtg refresh": your own seat drawn again and the game asked for again; not twice within 5 s; no game, no seat: said so
{
  const r = simulate({ save, seated: ["Yellow", "Blue"], host: "Blue", steps: [
    q('engineChat("mtg refresh", Player.Yellow) return "ok"', "no game"),
    prelude, { msg: { t: "started", json: STARTED } }, board(), PRIO,
    q('onPlayerDisconnect(Player.Yellow) return "ok"', "flip only", 5),
    q('engineChat("mtg refresh", Player.Yellow) return "ok"', "refresh", 20),
    q(HAND, "hand"), q(VIEW, "view"),
    q('engineChat("mtg refresh", Player.Yellow) return "ok"', "again"),
  ] });
  ok("refresh: no script errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  ok("refresh: with no game it says so", /you have no seat in a running engine game/.test(said(r, "no game")), said(r, "no game"));
  ok("refresh: it says it is drawing", /Drawing your view again/.test(said(r, "refresh")), said(r, "refresh"));
  ok("refresh: the hand is face up in the hand", valueOf(r, "hand") === "hand/up hand/up", valueOf(r, "hand"));
  ok("refresh: the question shows", (json(r, "view") || {}).open === 379, valueOf(r, "view"));
  const s = sent(r, "refresh");
  ok("refresh: the bridge is asked for the game again (hello, again)", /"again":true/.test(s) && /"t":"hello"/.test(s), s.slice(0, 300));
  ok("refresh: a second one within 5 s does nothing more", /done a moment ago/.test(said(r, "again")) && !/"t":"hello"/.test(sent(r, "again")), said(r, "again"));
}

console.log(failed ? `\n${failed} failed, ${passed} passed` : `PASSED: ${passed} passed, 0 failed`);
process.exit(failed ? 1 : 0);
