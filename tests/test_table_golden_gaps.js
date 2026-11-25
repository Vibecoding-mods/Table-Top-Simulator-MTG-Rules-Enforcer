// Inputs the table golden (tests/test_table_golden.js) never gives, one per edit that tools/mutate-table.js found
// escaping it (whole-golden grading 2026-11-24: 162 edits, 8 escaped, 3 of them equivalent programs). Each check is
// named after the edit it catches; the tool runs this file as its second stage (MUT_TESTS).
//   node tests/test_table_golden_gaps.js        (TABLE_SAVE=<save.json> to test a given save)
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
const s1 = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "table-stream-1v1.json"), "utf8"));
const prefix = [{ lua: "engineAutoPace.Blue = false" }, { lua: 'engineChat("mtg start ai 1", Player.Blue)' }, ...s1.slice(0, 40).map((m) => ({ msg: { t: m.t, json: m.json } }))];
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}`); } };
const q = (lua, mark, frames) => ({ lua, mark, ...(frames != null ? { frames } : {}) });
const step = (r, mark) => r.steps.find((s) => s.step === mark) || {};
const valueOf = (r, mark) => step(r, mark).value;
const fxOf = (r, mark) => step(r, mark).fx || [];
const said = (r, mark) => fxOf(r, mark).filter((l) => l.includes("broadcastToColor")).join(" | ");
const objOf = (id) => `local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${id}" then o = x end end`;
const run = (steps) => simulate({ save, seated: ["Blue"], host: "Blue", steps: [...prefix, ...steps] });

// a crafted board on the 1v1's last board before message 40: Blue's hand and battlefield, White an AI
const card = (id, n, ty, more = {}) => ({ id: `engine-card-${id}`, n, ty, tl: ty.join(" "), cmc: 1, ctl: more.ctl || "Blue", f: `https://example.invalid/${id}.jpg`, ...more });
const HAND = card(9901, "Opt", ["Instant"]);
const BEAR = card(9911, "Grizzly Bears", ["Creature"], { p: 2, t: 2 });
const WOLF = card(9921, "Timber Wolves", ["Creature"], { ctl: "White", p: 1, t: 1 });
const base = JSON.parse([...s1.slice(0, 40)].reverse().find((m) => m.t === "table").json);
const board = (edit, mark) => {
  const b = JSON.parse(JSON.stringify(base));
  for (const p of b.players) {
    p.keep = ["graveyard", "exile", "command"];
    if (p.color === "Blue") { p.hand = [HAND]; p.handCount = 1; p.battlefield = [BEAR]; p.status = "playing"; }
    if (p.color === "White") { p.battlefield = [WOLF]; p.status = "playing"; }
  }
  b.gameOver = false; b.winner = null; b.stack = [];
  if (edit) edit(b);
  return { msg: { t: "table", json: JSON.stringify(b) }, frames: 30, ...(mark ? { mark } : {}) };
};
const ask = (p, mark) => ({ msg: { t: "prompt", json: JSON.stringify({ t: "prompt", color: "Blue", ...p }) }, frames: 10, ...(mark ? { mark } : {}) });
const sentLog = q('local real = engineSend __sent = {} engineSend = function(t, p) __sent[#__sent + 1] = t .. " " .. JSON.encode(p) return real(t, p) end return "wrapped"', "wrap");
const sent = (mark) => q('local s = table.concat(__sent, " || ") __sent = {} return s', mark);

// ── fix: an engine card put into a container that is no engine pile while the board is being edited ──
// (tryObjectEnterContainer refuses the engine's own piles, so the golden's drop never reaches onObjectEnterContainer;
// a player's own deck or a bag lets it in)
{
  const editing = (b) => { b.fix = { id: 41, state: "editing", kind: "board", by: "Blue", waiting: [] }; };
  const spawnBox = (kind) => `local p = data.Blue.playmat.getPosition() spawnObjectData({ data = { Name = "${kind}", Nickname = "a player's ${kind}", GMNotes = "",
      DeckIDs = { 100, 101 }, CustomDeck = { ["1"] = { FaceURL = "f", BackURL = "b", NumWidth = 1, NumHeight = 1 } },
      ContainedObjects = { { Name = "Card", Nickname = "x", CardID = 100, GMNotes = "" }, { Name = "Card", Nickname = "y", CardID = 101, GMNotes = "" } } },
      position = Vector(p.x + 12, 1.5, p.z) }) return "spawned"`;
  const put = (kind) => `local box for _, x in ipairs(getObjects()) do if x.getName() == "a player's ${kind}" then box = x end end ${objOf(BEAR.id)}
      if not box or not o then return "no box or card" end box.setLock(false) box.putObject(o) return "put"`;
  const after = (kind) => `local box for _, x in ipairs(getObjects()) do if x.getName() == "a player's ${kind}" then box = x end end
      local inside = 0 for _, e in ipairs(box and box.getObjects() or {}) do if e.gm_notes == "engine:${BEAR.id}" then inside = inside + 1 end end
      local loose, locked = 0, nil for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:${BEAR.id}" then loose = loose + 1 locked = x.getLock() end end
      local ops, un = engineFixRead()
      return JSON.encode({ inside = inside, loose = loose, locked = tostring(locked), touched = engineFixTouched["${BEAR.id}"] == true, unplaced = table.concat(un, ",") })`;
  const r = run([board(null), board(editing, "editing"), q(spawnBox("Deck"), "deck", 10), q(put("Deck"), "put", 10), q(after("Deck"), "after deck"),
    board(null, "fix over"), board(editing, "editing 2"), q(spawnBox("Bag"), "bag", 10), q(put("Bag"), "put bag", 10), q(after("Bag"), "after bag")]);
  const d = JSON.parse(valueOf(r, "after deck") || "{}"), g = JSON.parse(valueOf(r, "after bag") || "{}");
  ok("fix pile: precondition, the card went into the player's deck", valueOf(r, "put") === "put", `${valueOf(r, "put")} ${r.errors.slice(0, 2).join(" | ")}`);
  ok("fix: pile keeps a dropped card / the card comes back out of a player's deck, one loose card, unlocked", d.inside === 0 && d.loose === 1 && d.locked === "false", JSON.stringify(d));
  // (a bag keeps it: no take-out, so no onObjectLeaveContainer marks it; only the drop's own mark makes Done read it)
  ok("fix: pile drop not remembered / a card put into a bag counts as touched (Done reads it)", g.inside === 1 && g.touched === true, JSON.stringify(g));
  ok("fix pile: no script error", r.errors.length === 0, r.errors.slice(0, 2).join(" | "));
}

// ── autoresolve: the bridge is told when a player turns Auto-resolve on and off from the list ──
{
  const r = run([board(null), sentLog,
    q('onMtgAutoResolve(Player.Blue, nil, "eng_autores_Blue") onMtgAutoPick(Player.Blue, nil, "eng_auto_others")', "on"), sent("sent on"),
    q('onMtgAutoResolve(Player.Blue, nil, "eng_autores_Blue") onMtgAutoPick(Player.Blue, nil, "eng_auto_off")', "off"), sent("sent off")]);
  ok("autoresolve: toggle never sent / turning it on sends it to the bridge", /autoresolve \{[^}]*"on":true/.test(valueOf(r, "sent on") || ""), valueOf(r, "sent on"));
  ok("autoresolve: toggle never sent / turning it off sends it to the bridge", /autoresolve \{[^}]*"on":false/.test(valueOf(r, "sent off") || ""), valueOf(r, "sent off"));
}

// ── pt3 hint: a click on your own hand card during a target question it isn't offered for says nothing ──
// (the "can't be chosen" line is for permanents; a hand card is picked up to be played, not chosen)
{
  const target = ask({ promptId: 9931, kind: "target", title: "Lightning Bolt: deal 3 damage to which target?", mode: "single",
    options: [{ id: "player|player-1", label: "AI 1" }, { id: `card|${WOLF.id}`, label: "Timber Wolves" }] });
  const click = (id, mark) => q(`${objOf(id)} if not o then return "none" end onPlayerAction(Player.Blue, Player.Action.Select, { o }) onPlayerAction(Player.Blue, Player.Action.PickUp, { o }) __sim.frames(30) return "clicked"`, mark);
  const r = run([board(null), target, click(HAND.id, "hand"), click(BEAR.id, "bear")]);
  ok("pt3 hint: precondition, the hand card was clicked", valueOf(r, "hand") === "clicked", valueOf(r, "hand"));
  ok("pt3 hint: also for hand cards / a hand card's click says nothing", !/can't be chosen/.test(said(r, "hand")), said(r, "hand"));
  ok("pt3 hint: a permanent not offered still says it can't be chosen", /That card can't be chosen for this/.test(said(r, "bear")), said(r, "bear"));
}

// ── fx: a player who concedes gets the knock-out banner, as one who loses does (the golden's games only lose) ──
{
  const r = run([board(null), board(null, "playing"), board((b) => { b.players.find((p) => p.color === "White").status = "conceded"; }, "conceded")]);
  const banner = fxOf(r, "conceded").filter((l) => l.includes("eng_result_Blue"));
  ok("fx: a concession gets no knock-out banner / WHITE IS OUT for Blue when White concedes", banner.some((l) => l.includes('"UI.setValue" "eng_result_Blue" "WHITE IS OUT"')), JSON.stringify(banner));
  ok("fx concession: no script error", r.errors.length === 0, r.errors.slice(0, 2).join(" | "));
}

// ── long rows: twelve different creatures in one row are squeezed into the width of ten (the golden's rows are shorter) ──
{
  const many = Array.from({ length: 12 }, (_, i) => card(9940 + i, `Test Creature ${i + 1}`, ["Creature"], { p: 1, t: 1 }));
  const r = run([board((b) => { b.players.find((p) => p.color === "Blue").battlefield = many; }, "twelve"),
    q(`local out = {} for _, c in ipairs({ ${many.map((c) => JSON.stringify(c.id)).join(", ")} }) do local o for _, x in ipairs(getObjects()) do if x.getGMNotes() == "engine:" .. c then o = x end end
      if o then local p = o.getPosition() out[#out + 1] = { x = p.x, z = p.z } end end return JSON.encode(out)`, "spots")]);
  const spots = JSON.parse(valueOf(r, "spots") || "[]");
  // (one row runs along the seat's side: the coordinate that varies most is the row's)
  const span = (k) => Math.max(...spots.map((s) => s[k])) - Math.min(...spots.map((s) => s[k]));
  const along = span("x") > span("z") ? "x" : "z";
  const xs = spots.map((s) => s[along]).sort((a, b) => a - b);
  const gaps = xs.slice(1).map((v, i) => v - xs[i]);
  ok("long rows: precondition, all twelve on the table", spots.length === 12, `${spots.length} ${r.errors.slice(0, 2).join(" | ")}`);
  // (squeezed: 12 columns into the room of 10, 11 x 2.4 x 10/12 = 22.0 between the end centres; unsqueezed 26.4)
  ok("long rows not squeezed / twelve in a row stay within ten columns' room (10 x 2.4)", span(along) <= 10 * 2.4 + 0.05, `span ${span(along).toFixed(2)}`);
  ok("long rows not squeezed / each one closer than the full step", gaps.length === 11 && Math.max(...gaps) < 2.3, JSON.stringify(gaps.map((g) => +g.toFixed(2))));
}

console.log(failed ? `\n${failed} failed, ${passed} passed` : `all ${passed} passed`);
process.exit(failed ? 1 : 0);
