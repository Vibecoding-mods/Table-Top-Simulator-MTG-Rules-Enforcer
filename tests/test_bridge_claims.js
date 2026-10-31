// Checks for promises the bridge's comments make that the golden master doesn't pin by itself
// (jr-programmer-suite stage 3b, 2026-10-20). Each check names the claim and the line that makes it.
//   node tests/test_bridge_claims.js
const path = require("path");
const harness = require("./bridge-harness");

const F = require("./golden/fixtures/dump2.json");
const clone = (x) => JSON.parse(JSON.stringify(x));
let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}
`); } };

function setup(h, board, extra = {}) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: clone(board), fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, ...extra });
  return seat;
}
const sent = (h, t) => h.effects.filter((e) => e.tts && e.tts.t === t).map((e) => e.tts);

(async () => {
  // "each hand only from its own player's view, so hidden cards never reach other players" (sendTable header)
  {
    const h = harness.load();
    const b = clone(F.board);
    // the opponent's hand, as the engine would show it to the opponent: named cards
    b.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-1").cards = [{ id: "engine-card-901", identity: { name: "SecretCard" }, types: ["Instant"] }];
    setup(h, b);
    h.B.sendTable(); await h.flush();
    const table = sent(h, "table")[0];
    const ai = table && table.players.find((p) => p.slot === "player-1");
    ok("precondition: a board was sent", !!table);
    ok("hidden: a hand without its own seat's view isn't sent", ai && ai.hand === null, JSON.stringify(ai && ai.hand));
    ok("hidden: the hidden card's name appears nowhere in what TTS got", !JSON.stringify(h.effects.filter((e) => e.tts)).includes("SecretCard"));
  }
  // face-down cards travel without name, picture or text (tableCard), even from a view that may see them
  {
    const h = harness.load();
    const b = clone(F.board);
    b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-903", identity: { name: "SecretMorph" }, isFaceDown: true, types: ["Creature"], power: 2, toughness: 2, text: "Morph {3}" });
    b.gameView.zones.find((z) => z.zone === "exile" && z.ownerId === "player-0").cards.push({ id: "engine-card-904", identity: { name: "SecretForetold" }, isFaceDown: true, types: ["Instant"] });
    setup(h, b);
    h.B.sendTable(); await h.flush();
    const out = JSON.stringify(h.effects.filter((e) => e.tts));
    const bf = (sent(h, "table")[0] || { players: [] }).players.find((p) => p.slot === "player-0");
    ok("precondition: the face-down card is on the board sent", out.includes("engine-card-903") && out.includes("engine-card-904"));
    ok("face-down: no name, picture or text reaches the table", !/SecretMorph|SecretForetold|Morph \{3\}/.test(out));
    ok("face-down: its public 2/2 still does", bf && bf.battlefield.some((c) => c.id === "engine-card-903" && c.fd && c.p === 2 && c.t === 2), JSON.stringify(bf && bf.battlefield.find((c) => c.id === "engine-card-903")));
  }
  // "Hidden cards are never named" in the game log (logSnapshot / logEvents)
  {
    const h = harness.load();
    setup(h, F.board);
    const before = clone(F.board.gameView), after = clone(F.board.gameView);
    const zone = (gv, kind) => gv.zones.find((z) => z.zone === kind && z.ownerId === "player-1");
    zone(before, "hand").cards = []; zone(before, "hand").count = 0; zone(before, "library").count = 50;
    zone(after, "hand").cards = [{ id: "engine-card-902", identity: { name: "SecretDraw" } }]; zone(after, "hand").count = 1; zone(after, "library").count = 49;
    const lines = h.B.logEvents(h.B.logSnapshot(before), h.B.logSnapshot(after), after);
    ok("precondition: the draw is in the log", lines.some((l) => /draws/.test(l)), JSON.stringify(lines));
    ok("log: a card drawn into a hand isn't named", !lines.join(" ").includes("SecretDraw"), JSON.stringify(lines));
  }
  // "the older one's card details are kept, since they are only sent once" (toTTS outbox merge)
  {
    const h = harness.load();
    setup(h, F.board);
    h.B.toTTS({ t: "chat", text: "first" }); // in flight
    h.B.toTTS({ t: "table", players: [], cards: { a: { n: "A" } } });
    h.B.toTTS({ t: "table", players: [], cards: { b: { n: "B" } } }); // replaces the waiting one
    await h.flush();
    const tables = sent(h, "table");
    ok("outbox: a waiting board is replaced, not sent twice", tables.length === 1, `${tables.length} boards`);
    ok("outbox: the replaced board's card details are kept", tables[0] && tables[0].cards.a && tables[0].cards.b, JSON.stringify(tables[0] && tables[0].cards));
  }
  // "exactly one pick for a single choice" (answerProblem)
  {
    const h = harness.load();
    const ui = { mode: "single", options: [{ id: "a" }, { id: "b" }] };
    ok("answer: a single choice with no pick is refused", h.B.answerProblem(ui, []) !== null);
    ok("answer: a single choice with two picks is refused", h.B.answerProblem(ui, ["a", "b"]) !== null);
    ok("answer: a single choice with one pick passes", h.B.answerProblem(ui, ["b"]) === null);
    ok("answer: cancel is allowed where the question allows it", h.B.answerProblem({ ...ui, cancel: true }, ["__cancel"]) === null);
  }
  // "One writer for the cache file, at most every 2 s" (saveImageCache)
  {
    const h = harness.load();
    setup(h, F.board);
    const fs = require("fs");
    const stubWrite = fs.writeFile, times = [];
    fs.writeFile = (p, ...rest) => { if (/image-cache/.test(String(p))) times.push(Date.now()); return stubWrite(p, ...rest); };
    // five Scryfall rounds 300 ms apart (virtual time): each finished round used to write the 4 MB file at once
    ["Forest", "Island", "Swamp", "Plains", "Mountain"].forEach((n, i) => setTimeout(() => h.B.imgOf({ identity: { name: n } }), 300 * i));
    await h.flush();
    fs.writeFile = stubWrite;
    const rounds = h.effects.filter((e) => e.fetch).length;
    const writes = h.effects.filter((e) => e.writeFile && /image-cache/.test(e.writeFile));
    ok("precondition: several Scryfall rounds ran", rounds >= 3, `${rounds} rounds`);
    ok("cache: written to a temp file, then renamed into place", writes.length > 0 && writes.every((w) => /\.tmp$/.test(w.writeFile)) && h.effects.filter((e) => e.rename).length === writes.length, JSON.stringify(writes));
    ok("cache: fewer writes than rounds", writes.length < rounds, `${writes.length} writes for ${rounds} rounds`);
    ok("cache: writes at least 2 s apart", times.every((t, i) => i === 0 || t - times[i - 1] >= 2000), JSON.stringify(times));
  }
  harness.restore();
  // "Refuses browser requests (Origin) and foreign Host headers" (debug channel) — the real HTTP server
  {
    process.env.MTG_DEBUG_PORT = "48991";
    const h = harness.load();
    harness.restore(); // real network for the requests below
    await new Promise((r) => h.B.debugServer.listen(48991, "127.0.0.1", r));
    const req = (headers) => new Promise((resolve) => {
      const r = require("http").request({ host: "127.0.0.1", port: 48991, path: "/stats", method: "GET", headers }, (res) => { res.resume(); resolve(res.statusCode); });
      r.on("error", () => resolve(0)); r.end();
    });
    ok("debug port: TTS/curl request (no Origin, local Host) works", (await req({})) === 200);
    ok("debug port: a browser request (Origin header) is refused", (await req({ Origin: "https://evil.example" })) === 403);
    ok("debug port: a foreign Host (DNS rebinding) is refused", (await req({ Host: "evil.example:48991" })) === 403);
    h.B.debugServer.close();
    delete process.env.MTG_DEBUG_PORT;
  }
  // "An id found in both is ours" (bridge/presets.js): the same id in decks/ and in Manabrew's preset_decks
  {
    const fs = require("fs");
    const P = require("../bridge/presets");
    const id = "__claim_check_preset";
    // the folders named here, not taken from presets.js (a check reading the module's own order can't see it swapped)
    const files = [path.join(__dirname, "..", "decks", `${id}.json`), path.join(__dirname, "..", "manabrew", "public", "preset_decks", `${id}.json`)];
    const label = () => { try { return P.readPreset(id).label; } catch (e) { return `threw ${e.code || e.message}`; } };
    try {
      files.forEach((f, i) => fs.writeFileSync(f, JSON.stringify({ label: i === 0 ? "ours" : "manabrew's", format: "commander", cards: [] })));
      ok("presets: an id in both folders reads ours (decks/)", label() === "ours", `read ${label()}`);
      ok("presets: an id in both folders is listed once", P.presetIds().filter((x) => x === id).length === 1);
      fs.unlinkSync(files[0]);
      ok("presets: Manabrew's copy is used when ours is absent", label() === "manabrew's", `read ${label()}`);
    } finally { for (const f of files) try { fs.unlinkSync(f); } catch {} }
  }
  console.log(failed ? `\n${failed} claim checks failed (${passed} passed)` : `all ${passed} claim checks pass`);
  process.exit(failed ? 1 : 0);
})();
