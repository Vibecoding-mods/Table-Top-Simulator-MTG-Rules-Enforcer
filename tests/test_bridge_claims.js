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
  // "its text as changed": an emptied text box is a change (Exchange of Words, real table 2026-11-05)
  {
    const h = harness.load();
    const b = clone(F.board);
    b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push(
      { id: "engine-card-905", identity: { name: "Llanowar Elves" }, types: ["Creature"], power: 1, toughness: 1, text: "{T}: Add {G}.", currentText: "" },
      { id: "engine-card-906", identity: { name: "Grizzly Bears" }, types: ["Creature"], power: 2, toughness: 2, text: "" });
    setup(h, b);
    h.B.sendTable(); await h.flush();
    const bf = (sent(h, "table")[0] || { players: [] }).players.find((p) => p.slot === "player-0");
    const at = (id) => bf && bf.battlefield.find((c) => c.id === id);
    ok("changed text: an emptied text box shows as (no text)", at("engine-card-905")?.ct === "(no text)", JSON.stringify(at("engine-card-905")));
    ok("changed text: a card never changed has no box", !!at("engine-card-906") && at("engine-card-906").ct === undefined, JSON.stringify(at("engine-card-906")));
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
  // "A character split across two chunks is held until its other bytes arrive" (readBody): a real stream, the é of an
  // accented card name cut between two chunks, as a large /msg body is
  {
    const h = harness.load();
    harness.restore(); // real timers: the stream's chunks arrive one turn apart
    const { PassThrough } = require("stream");
    const req = new PassThrough();
    const res = { writeHead() {}, end() {} };
    const text = JSON.stringify({ t: "decks", name: "Séance" });
    const bytes = Buffer.from(text, "utf8"), cut = bytes.indexOf(0xc3) + 1;
    let body = null, chunks = 0;
    h.B._readBody(req, res, (b) => { body = b; });
    req.on("data", () => { chunks++; });
    const turn = () => new Promise((r) => setImmediate(r));
    req.write(bytes.subarray(0, cut)); await turn();
    req.end(bytes.subarray(cut)); await turn(); await turn();
    ok("precondition: readBody got the body in two chunks", chunks === 2, `${chunks} chunks`);
    ok("readBody: a character split between chunks arrives whole", body === text, JSON.stringify(body));
  }
  // SPEC.md §8, the editor plugin sharing TTS's port (bridge/editor-forward.js wired in): off unless
  // MTG_EDITOR_FORWARD_PORT is set; every TTS message is offered first and the plugin's alone are not handled; the
  // bridge's own Execute Lua numbers start at 1,000,000,000, so an answer under that is the plugin's
  {
    const realConnect = require("net").connect, realTimeout = setTimeout;
    delete process.env.MTG_EDITOR_FORWARD_PORT;
    const off = harness.load();
    ok("editor forward: off with no port set", off.B._editorForward.enabled === false);
    harness.restore();
    process.env.MTG_EDITOR_FORWARD_PORT = "45991";
    const onH = harness.load();
    ok("editor forward: on with MTG_EDITOR_FORWARD_PORT, at that port", onH.B._editorForward.enabled === true && onH.B._editorForward.forwardPort === 45991);
    harness.restore();
    delete process.env.MTG_EDITOR_FORWARD_PORT;
    // the TTS port's handler asks offer() first: a message it keeps for the plugin is not handled
    const h = harness.load();
    setup(h, F.board);
    const offered = [];
    let keep = false;
    h.B._editorForward.offer = (msg) => { offered.push(msg.messageID); return !keep; };
    await new Promise((r) => h.B._ttsServer.listen(0, "127.0.0.1", r));
    const port = h.B._ttsServer.address().port;
    const sendTTS = (obj) => new Promise((r) => { const s = realConnect(port, "127.0.0.1", () => s.end(JSON.stringify(obj))); s.on("close", () => realTimeout(r, 50)); });
    const hello = { messageID: 4, customMessage: { t: "hello", json: JSON.stringify({ t: "hello", again: true }) } };
    keep = true; await sendTTS(hello); await h.flush();
    const whenKept = h.effects.filter((e) => e.tts).length;
    keep = false; await sendTTS(hello); await h.flush();
    const whenNot = h.effects.filter((e) => e.tts).length;
    h.B._ttsServer.close();
    ok("editor forward: each TTS message is offered first", JSON.stringify(offered) === "[4,4]", JSON.stringify(offered));
    ok("editor forward: a message offer() keeps for the plugin is not handled by the bridge", whenKept === 0, `${whenKept} messages to TTS`);
    ok("precondition: the same message, not kept, is handled", whenNot > 0, `${whenNot} messages to TTS`);
    // the bridge's Execute Lua returnID, and an answer under the base not taken for it
    const net = require("net"), mock = net.connect;
    let sent = null;
    net.connect = (p, host, cb) => { const s = { on() { return s; }, end(d) { sent = JSON.parse(d); } }; queueMicrotask(cb); return s; };
    const answer = h.B._execInTTS("return 1", 60000);
    await Promise.resolve();
    net.connect = mock;
    ok("exec: the bridge's returnID is 1,000,000,000 or more", sent && sent.returnID >= 1000000000, JSON.stringify(sent));
    let done = null;
    answer.then((r) => { done = r; });
    h.B.onTTSDebug({ messageID: 5, returnID: sent.returnID - 1000000000, returnValue: "plugin's" });
    await Promise.resolve();
    ok("exec: an answer with a plugin's number is not the bridge's", done === null, JSON.stringify(done));
    h.B.onTTSDebug({ messageID: 5, returnID: sent.returnID, returnValue: 1 });
    await answer;
    ok("exec: the bridge's own answer arrives", done && done.value === 1, JSON.stringify(done));
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
    // "a game is running" stops a deploy: a game that has ended isn't one
    const started = () => new Promise((resolve) => require("http").get({ host: "127.0.0.1", port: 48991, path: "/state" }, (res) => { let t = ""; res.on("data", (d) => { t += d; }); res.on("end", () => resolve(JSON.parse(t).started)); }));
    h.B._setGame({ seats: new Map(), started: true });
    ok("/state: a game in play is running", (await started()) === true);
    h.B._setGame({ seats: new Map(), started: true, over: true });
    ok("/state: a finished game isn't", (await started()) === false);
    h.B._setGame(null);
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
  // "A card nothing changed has no box, so ow goes only with a box" (statusLists), "those that are always on" (cardKeywords)
  {
    const look = async (keywords, extra = {}) => {
      const h = harness.load();
      const b = clone(F.board);
      const c = b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards[0];
      Object.assign(c, { text: "Flying, trample\nEquip {2}\nCycling {1}", keywords, ...extra });
      setup(h, b);
      h.B.sendTable(); await h.flush();
      return sent(h, "table")[0].players.flatMap((p) => p.battlefield || []).find((x) => x.id === c.id);
    };
    const own = ["Flying", "Trample", "Equip:2", "Cycling:1"];
    const plain = await look(own);
    ok("status: a card with only its own keywords has no box", !!plain && plain.kw === undefined && plain.ow === undefined, JSON.stringify(plain?.ow));
    const given = await look([...own, "Hexproof"]);
    ok("status: a grant lists it as changed", JSON.stringify(given?.kw) === '["Hexproof"]', JSON.stringify(given?.kw));
    ok("status: with a box, its own always-on keywords go too, no Equip or Cycling", JSON.stringify(given?.ow) === '["Flying","Trample"]', JSON.stringify(given?.ow));
    const phased = await look(own, { phasedOut: true });
    ok("status: phased out is a box, so its own keywords go too", phased?.po === true && JSON.stringify(phased?.ow) === '["Flying","Trample"]', JSON.stringify(phased?.ow));
    const junk = await look(["Chapter:3:DBSacrifice,DBDiscard,DBChangeZone", "MayFlashSac", "AlternateAdditionalCost:1:Sac", "Class:2:Foo", "Visit:Bar"]);
    ok("status: Forge's internal names are no status", junk?.kw === undefined, JSON.stringify(junk?.kw));
    harness.restore();
  }
  // "a click on a mana rock or creature at priority taps it, as its Mana: tap button does" (the play intent)
  {
    const click = async (actions) => {
      const h = harness.load();
      const b = clone(F.board);
      Object.assign(b.gameView, { activePlayerId: "player-0", priorityPlayerId: "player-0", step: "main1", stack: [] });
      // (a mana rock: lands have no Mana button, they tap while paying)
      Object.assign(b.gameView.zones.flatMap((z) => z.cards || []).find((c) => c.id === "engine-card-36"),
        { identity: { name: "Arcane Signet" }, types: ["Artifact"], text: "{T}: Add one mana of any color in your commander's color identity." });
      const seat = setup(h, b);
      h.B.onPrompt(seat, { promptId: 900, decidingPlayerId: "player-0", input: { type: "chooseAction", actions } }); await h.flush();
      h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "play", id: "engine-card-36" }) }); await h.flush();
      const out = { relay: JSON.stringify(h.effects.filter((e) => e.relay)), told: JSON.stringify(h.effects.filter((e) => e.tts && e.tts.t === "chat")) + JSON.stringify(h.effects.filter((e) => e.tts)) };
      harness.restore();
      return out;
    };
    const tap = { id: "tap:engine-card-36:0", type: "activateManaAbility", cardId: "engine-card-36", isManaAbility: true, description: "Add {R}", producedMana: [{ amount: 1, color: "R" }] };
    const rock = await click([tap, { id: "pass", type: "pass", label: "Pass priority" }]);
    ok("mana click: a mana source clicked at priority is tapped", rock.relay.includes("tap:engine-card-36:0"), rock.relay.slice(-300));
    ok("mana click: and not refused", !rock.told.includes("none of its abilities"), rock.told.slice(0, 300));
    const none = await click([{ id: "pass", type: "pass", label: "Pass priority" }]);
    ok("mana click: with no mana button it is still refused with why", none.told.includes("none of its abilities") && !none.relay.includes("tap:engine-card-36"), none.told.slice(0, 300));
  }
  // "a token beside a card of its name says so" (chooseBoardTargets)
  {
    const h = harness.load();
    const b = clone(F.board);
    const all = b.gameView.zones.flatMap((z) => z.cards || []);
    Object.assign(all.find((c) => c.id === "engine-card-36"), { identity: { name: "Galadhrim Brigade" }, types: ["Creature"] });
    Object.assign(all.find((c) => c.id === "engine-card-22"), { identity: { name: "Galadhrim Brigade", isToken: true }, types: ["Creature"] });
    const seat = setup(h, b);
    h.B.onPrompt(seat, { promptId: 900, decidingPlayerId: "player-0", input: { type: "chooseBoardTargets", min: 1, max: 1,
      candidates: [{ kind: "card", id: "engine-card-36" }, { kind: "card", id: "engine-card-22" }, { kind: "card", id: "engine-card-64" }], presentation: { title: "choose a creature to sacrifice" } } });
    await h.flush();
    const labels = (seat.prompt?.ui?.options || []).map((o) => o.label);
    ok("token label: the token says token", labels.includes("Galadhrim Brigade (token)"), JSON.stringify(labels));
    ok("token label: the card keeps its name", labels.includes("Galadhrim Brigade"), JSON.stringify(labels));
    ok("token label: a name seen once is unchanged", labels.includes("Mountain"), JSON.stringify(labels));
    harness.restore();
  }
  // askUnder (jr suite 2026-11-06). The sub-questions A-E on one priority question (#900), as the golden's askUnder
  // photographs ask them.
  {
    const subActs = [
      { id: "a-cast1", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur", mode: { type: "normal" } },
      { id: "a-cast2", type: "cast", cardId: "engine-card-75", label: "Cast Hurloon Minotaur (WebSlinging)", mode: { type: "alternative", cost: "webSlinging" } },
      { id: "tap:engine-card-35:0", type: "activateAbility", cardId: "engine-card-35", isManaAbility: true, description: "Add {G}", producedMana: [{ amount: 1, color: "G" }] },
      { id: "tap:engine-card-35:1", type: "activateAbility", cardId: "engine-card-35", isManaAbility: true, description: "Add {B}", producedMana: [{ amount: 1, color: "B" }] },
      { id: "ab-fetch1", type: "activateAbility", cardId: "engine-card-64", description: "{T}, Pay 1 life, Sacrifice: Search for a Swamp or Forest card." },
      { id: "ab-fetch3", type: "activateAbility", cardId: "engine-card-64", cost: "{T}", description: "Exile target card from a graveyard." },
      { id: "a-necro", type: "cast", cardId: "engine-card-43", label: "Cast Necromancy", mode: { type: "normal" } },
    ];
    const myMain = (necro) => {
      const b = clone(F.board);
      Object.assign(b.gameView, { activePlayerId: "player-0", step: "main1", priorityPlayerId: "player-0", stack: [] });
      if (necro) {
        // (Necromancy outside a sorcery's time: an opponent's Shock on the stack)
        b.gameView.stack = [{ id: "s1", controllerId: "player-1", identity: { name: "Shock" } }];
        for (const z of b.gameView.zones) for (const c of z.cards || []) if (c.id === "engine-card-43") {
          c.identity.name = "Necromancy"; c.types = ["Enchantment"];
          c.text = "You may cast Necromancy as though it had flash. If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.";
        }
      }
      return b;
    };
    const open = async (site) => {
      const h = harness.load();
      const seat = setup(h, myMain(site === "B"));
      h.B.onPrompt(seat, { promptId: 900, decidingPlayerId: "player-0", input: { type: "chooseAction", actions: subActs } }); await h.flush();
      const first = clone(sent(h, "prompt").find((m) => m.promptId === 900));
      const gesture = { A: { kind: "play", id: "engine-card-75" }, B: { kind: "play", id: "engine-card-43" }, C: { kind: "tapmana", id: "engine-card-64" },
        D: { kind: "tapmana", id: "engine-card-35" } }[site];
      if (gesture) h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", ...gesture }) });
      else h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["__mana:engine-card-35"] }) });
      await h.flush();
      return { h, seat, first, card: gesture?.id ?? "engine-card-35" };
    };
    // "Back re-sends it as it was first sent (its ui, its step: none for the engine's question)" (askUnder header):
    // an Equality relation, the message after Back against the first one, whatever either says
    for (const site of ["A", "B", "C", "D", "E"]) {
      const { h, seat, first } = await open(site);
      ok(`askUnder ${site}: precondition, the sub-question is open`, !!seat.prompt?.under && seat.prompt.ui.title !== first.title, seat.prompt?.ui?.title);
      const n0 = h.effects.length;
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["__back"] }) }); await h.flush();
      const again = h.effects.slice(n0).filter((e) => e.tts?.t === "prompt").map((e) => e.tts);
      ok(`askUnder ${site}: Back re-sends one question`, again.length === 1, JSON.stringify(again).slice(0, 200));
      ok(`askUnder ${site}: Back re-sends the question underneath exactly as it was first sent`, JSON.stringify(again[0]) === JSON.stringify(first),
        `${JSON.stringify(first).slice(0, 160)} -> ${JSON.stringify(again[0]).slice(0, 160)}`);
      ok(`askUnder ${site}: and that question is the open one again`, seat.prompt?.under === null && seat.prompt.ui.title === first.title);
      h.B._stopTimer(seat, true);
      harness.restore();
    }
    // the same, every time (round 4, the break-it pass's escape A03: Back stored a new step but sent the old one, so a
    // second sub-question saved that step and its Back re-sent a step the question never had): open, Back, open, Back
    for (const site of ["A", "E"]) {
      const { h, seat, first } = await open(site);
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["__back"] }) }); await h.flush();
      if (site === "A") h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "play", id: "engine-card-75" }) });
      else h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["__mana:engine-card-35"] }) });
      await h.flush();
      ok(`askUnder ${site}: precondition, the second sub-question is open`, !!seat.prompt?.under);
      const n0 = h.effects.length;
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["__back"] }) }); await h.flush();
      const again = h.effects.slice(n0).filter((e) => e.tts?.t === "prompt").map((e) => e.tts);
      ok(`askUnder ${site}: a second Back re-sends the question underneath exactly as first sent`, again.length === 1 && JSON.stringify(again[0]) === JSON.stringify(first),
        `${JSON.stringify(first).slice(0, 120)} -> ${JSON.stringify(again[0]).slice(0, 120)}`);
      h.B._stopTimer(seat, true);
      harness.restore();
    }
    // "onIntent refuses every gesture while one is open" (askUnder header, onIntent): every gesture the table sends
    // (bridge/table-map.js GESTURES, the list test_table_map checks against the renderer), with A open
    const { GESTURES } = require("../bridge/table-map");
    ok("askUnder: precondition, the gesture list is read", Object.keys(GESTURES).length >= 7, Object.keys(GESTURES).join(" "));
    for (const kind of Object.keys(GESTURES)) {
      const { h, seat } = await open("A");
      const ui = seat.prompt?.ui;
      ok(`askUnder: precondition for ${kind}, A is open`, !!seat.prompt?.under);
      const n0 = h.effects.length;
      h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind, id: "engine-card-43", to: "engine-card-65" }) }); await h.flush();
      const fx = h.effects.slice(n0);
      ok(`askUnder: a ${kind} gesture while A is open is refused`, fx.some((e) => e.tts?.t === "refused" && e.tts.id === "engine-card-43")
        && fx.some((e) => e.tts?.t === "chat" && /stays: answer "Hurloon Minotaur: how do you play it\?" first \(or Back\)/.test(e.tts.text)), JSON.stringify(fx).slice(0, 300));
      ok(`askUnder: a ${kind} gesture while A is open asks the engine nothing`, !fx.some((e) => e.relay), JSON.stringify(fx.filter((e) => e.relay)).slice(0, 200));
      ok(`askUnder: a ${kind} gesture while A is open leaves A open, its card out`, seat.prompt?.ui === ui && !fx.some((e) => e.tts?.t === "refused" && e.tts.id === "engine-card-75"));
      h.B._stopTimer(seat, true);
      harness.restore();
    }
  }
  // the text board (a game the table does not draw, sendView) reads poison through the same row (round 4, the break-it
  // pass's escape T21: sendView reading playerCounter raw passed everything): a positive number or 0
  for (const v of ["0", "3", true, -1, 2]) {
    const h = harness.load();
    const b = clone(F.board);
    b.gameView.players.find((p) => p.id === "player-0").counters = { POISON: v };
    const seat = setup(h, b, { fromTable: false });
    seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: clone(b), fingerprint: "f1" });
    await h.flush();
    const mine = h.effects.filter((e) => e.tts?.t === "view").pop()?.tts.view?.players.find((p) => p.you);
    ok(`text board poison ${JSON.stringify(v)}: precondition, a text board was sent`, !!mine);
    ok(`text board poison ${JSON.stringify(v)}: a positive number or 0, as the table row`, mine && mine.poison === (typeof v === "number" && v > 0 ? v : 0), JSON.stringify(mine?.poison));
    harness.restore();
  }
  // trackMarks: "a "0", true or -1 is 0, so the label, the log and the old row fields all see the same value"
  // (PLAYER_MARKS header). For every pair of poison values: the label shows POISON n exactly when the old field n > 0,
  // and the log says a poison line exactly when the old field changed.
  {
    const VALUES = [3, "3", "0", true, -1, "x", null, 0, 2];
    const at = (v) => { const b = clone(F.board); b.gameView.players.find((p) => p.id === "player-0").counters = { POISON: v }; return b; };
    // (each row from a bridge of its own: the first board it sends, so no "unchanged board" skip can hand back another's)
    const rowOf = async (v) => {
      const h = harness.load();
      setup(h, at(v));
      h.B.sendTable(); await h.flush();
      const r = sent(h, "table").pop()?.players.find((p) => p.color === "Blue");
      harness.restore();
      return r;
    };
    const rowFor = new Map();
    for (const v of VALUES) rowFor.set(v, await rowOf(v));
    ok("marks: precondition, every value made a row", VALUES.every((v) => rowFor.get(v)));
    ok("marks: precondition, some rows show poison and some do not", VALUES.some((v) => rowFor.get(v)?.poison > 0) && VALUES.some((v) => rowFor.get(v)?.poison === 0));
    const h = harness.load();
    setup(h, at(0));
    let pairs = 0, said = 0;
    for (const v of VALUES) {
      const r = rowFor.get(v);
      if (!r) continue;
      ok(`marks: poison ${JSON.stringify(v)}, the old field is a number`, typeof r.poison === "number", JSON.stringify(r.poison));
      const shown = (r.allMarks || []).filter((m) => m.startsWith("POISON"));
      ok(`marks: poison ${JSON.stringify(v)}, the label shows it exactly when the old field is above 0, with that number`,
        r.poison > 0 ? shown.length === 1 && shown[0] === `POISON ${r.poison}` : shown.length === 0, JSON.stringify(r));
      for (const w of VALUES) {
        const rb = rowFor.get(w);
        if (!rb) continue;
        const b = at(w).gameView;
        const lines = h.B.logEvents(h.B.logSnapshot(at(v).gameView), h.B.logSnapshot(b), b).filter((l) => /poison/.test(l));
        pairs++; if (lines.length) said++;
        ok(`marks: poison ${JSON.stringify(v)} -> ${JSON.stringify(w)}, the log says it exactly when the old field changed`,
          (r.poison !== rb.poison) === (lines.length === 1), `${r.poison} -> ${rb.poison}: ${JSON.stringify(lines)}`);
      }
    }
    ok("marks: precondition, every pair was logged, some with a poison line and some without", pairs === VALUES.length ** 2 && said > 0 && said < pairs, `${said} of ${pairs}`);
    await h.flush();
    harness.restore();
  }
  console.log(failed ? `\n${failed} claim checks failed (${passed} passed)` : `all ${passed} claim checks pass`);
  process.exit(failed ? 1 : 0);
})();
