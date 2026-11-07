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
  // trackMarks: "a "0", true or -1 is 0, so the label and the log see the same value" (PLAYER_MARKS header). For every
  // pair of poison values: the label shows POISON n exactly when n, the value read as a positive number or 0, is above
  // 0, and the log says a poison line exactly when n changed. The row has none of the old mark fields (step 6).
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
    const pos = (v) => (typeof v === "number" && v > 0 ? v : 0);
    const rowFor = new Map();
    for (const v of VALUES) rowFor.set(v, await rowOf(v));
    ok("marks: precondition, every value made a row", VALUES.every((v) => rowFor.get(v)));
    ok("marks: precondition, some values are above 0 and some are not", VALUES.some((v) => pos(v) > 0) && VALUES.some((v) => pos(v) === 0));
    const h = harness.load();
    setup(h, at(0));
    let pairs = 0, said = 0;
    for (const v of VALUES) {
      const r = rowFor.get(v);
      if (!r) continue;
      const old = ["poison", "energy", "monarch", "initiative", "blessed", "story", "marks"].filter((k) => k in r);
      ok(`marks: poison ${JSON.stringify(v)}, the row has none of the old mark fields`, !old.length, old.join(" "));
      const shown = (r.allMarks || []).filter((m) => m.startsWith("POISON"));
      ok(`marks: poison ${JSON.stringify(v)}, the label shows it exactly when it is above 0, with that number`,
        pos(v) > 0 ? shown.length === 1 && shown[0] === `POISON ${pos(v)}` : shown.length === 0, JSON.stringify(r));
      for (const w of VALUES) {
        const rb = rowFor.get(w);
        if (!rb) continue;
        const b = at(w).gameView;
        const lines = h.B.logEvents(h.B.logSnapshot(at(v).gameView), h.B.logSnapshot(b), b).filter((l) => /poison/.test(l));
        pairs++; if (lines.length) said++;
        ok(`marks: poison ${JSON.stringify(v)} -> ${JSON.stringify(w)}, the log says it exactly when it changed`,
          (pos(v) !== pos(w)) === (lines.length === 1), `${pos(v)} -> ${pos(w)}: ${JSON.stringify(lines)}`);
      }
    }
    ok("marks: precondition, every pair was logged, some with a poison line and some without", pairs === VALUES.length ** 2 && said > 0 && said < pairs, `${said} of ${pairs}`);
    await h.flush();
    harness.restore();
  }
  // trackMarks step 7 (2026-11-06): "Only Forge's flag" (extraTurn): the header says "(extra turn)" exactly when the
  // new active player's isExtraTurn is true, whatever the turn order, the other players' flags or a flag that isn't
  // true (1, "true") say
  {
    const h = harness.load();
    setup(h, F.board);
    const g = h.B._getGame();
    let n = 0, extra = 0;
    for (const mine of [true, false, undefined, 1, "true"]) for (const other of [true, false]) for (const ownBefore of [true, false]) {
      g.turnOwners = { 1: "player-0", 2: ownBefore ? "player-1" : "player-0", 3: "player-1" };
      const at = (turn, active, flag) => {
        const b = clone(F.board.gameView);
        Object.assign(b, { turn, activePlayerId: active, priorityPlayerId: active, step: "upkeep", stack: [] });
        for (const p of b.players) { const f = p.id === active ? flag : other; if (f === undefined) delete p.isExtraTurn; else p.isExtraTurn = f; }
        return b;
      };
      const b = at(3, "player-1", mine);
      const head = h.B.logEvents(h.B.logSnapshot(at(2, ownBefore ? "player-1" : "player-0", false)), h.B.logSnapshot(b), b).find((l) => l.startsWith("---")) || "";
      n++; if (head.includes("(extra turn)")) extra++;
      ok(`extra turn: active flag ${JSON.stringify(mine)}, the other's ${other}, turn order ${ownBefore ? "its own before" : "another's before"}: "(extra turn)" exactly when the flag is true`,
        head.startsWith("--- AI 1's turn") && head.includes("(extra turn)") === (mine === true), head);
    }
    ok("extra turn: precondition, 20 headers, some extra and some not", n === 20 && extra > 0 && extra < n, `${extra} of ${n}`);
    // (jr suite 2026-11-06) "so the label and the header agree on a flag that isn't true" (PLAYER_MARKS extraTurn): the
    // EXTRA TURN label on the active player exactly when its flag is true, as the header
    let shownN = 0;
    for (const flag of [true, false, undefined, 1, "true"]) {
      Object.assign(g, { logPrev: null, lastTableSig: null, sentZones: {} });
      const b = clone(F.board);
      const ai = b.gameView.players.find((p) => p.id === "player-1");
      if (flag === undefined) delete ai.isExtraTurn; else ai.isExtraTurn = flag;
      ai.life += 7 + shownN; // (each board differs from the last)
      g.seats.get("Blue").board = { state: b, fingerprint: null };
      const before = h.effects.length;
      h.B.sendTable(); await h.flush();
      const row = h.effects.slice(before).filter((e) => e.tts && e.tts.t === "table").pop()?.tts.players.find((p) => p.slot === "player-1");
      shownN++;
      ok(`extra turn label: AI 1's flag ${JSON.stringify(flag)} on its turn: EXTRA TURN exactly when the flag is true, as the header`,
        !!row && (row.allMarks || []).includes("EXTRA TURN") === (flag === true), JSON.stringify(row?.allMarks));
    }
    ok("extra turn label: precondition, 5 boards sent, AI 1 active", shownN === 5 && F.board.gameView.activePlayerId === "player-1");
    harness.restore();
  }
  // trackMarks step 7: the Ring, speed and control lines (PLAYER_MARKS' say): for every pair of values, a line exactly
  // when the rule says, with the new value in it
  {
    const mark = (field, v) => { const b = clone(F.board); const p = b.gameView.players.find((x) => x.id === "player-0"); if (v === undefined) delete p[field]; else p[field] = v; return b.gameView; };
    const linesOf = (h, field, v, w, re) => h.B.logEvents(h.B.logSnapshot(mark(field, v)), h.B.logSnapshot(mark(field, w)), mark(field, w)).filter((l) => re.test(l));
    const pos = (v) => (typeof v === "number" && v > 0 ? v : 0);
    const h = harness.load();
    setup(h, F.board);
    let said = 0, pairs = 0;
    const RING = [0, 1, 2, 3, 5, "2", -1, true];
    for (const v of RING) for (const w of RING) {
      const lines = linesOf(h, "ringLevel", v, w, /Ring/);
      const up = pos(w) - pos(v);
      pairs++; if (lines.length) said++;
      ok(`ring ${JSON.stringify(v)} -> ${JSON.stringify(w)}: a line exactly when the count goes up, naming the new count`,
        up > 0 ? lines.length === 1 && lines[0] === `Blue is tempted by the Ring${up > 1 ? ` ${up} times` : ""} (${pos(w)})` : lines.length === 0, JSON.stringify(lines));
    }
    const SPEED = [0, 1, 2, 3, 4, "3", -1];
    for (const v of SPEED) for (const w of SPEED) {
      const lines = linesOf(h, "speed", v, w, /speed/);
      const a = pos(v), b = pos(w);
      pairs++; if (lines.length) said++;
      const want = b > a ? `${a ? `Blue's speed goes up to ${b}` : `Blue starts their engines (speed ${b})`}${b === 4 ? " (max speed)" : ""}` : b < a && b ? `Blue's speed goes down to ${b}` : null;
      ok(`speed ${JSON.stringify(v)} -> ${JSON.stringify(w)}: ${want ? `"${want}"` : "no line"}`, want ? lines.length === 1 && lines[0] === want : lines.length === 0, JSON.stringify(lines));
    }
    ok("ring, speed: precondition, every pair was logged, some with a line and some without", pairs === RING.length ** 2 + SPEED.length ** 2 && said > 0 && said < pairs, `${said} of ${pairs}`);
    await h.flush();
    harness.restore();
  }
  // extra-turn counter (docs/extra-turn-counter-spec.md, 2026-11-06): the row's extraTurns is Forge's extraTurnCount
  // read as a positive number, left out at 0 and when the engine doesn't send it (an engine from before); the log says
  // "will take an extra turn (n coming)" exactly when the count goes up, with the count after it, and nothing when it
  // goes down (a turn taken, a rewind past Time Walk). The rule is stated here from the spec, not read from the code
  {
    const COUNTS = [undefined, 0, 1, 2, 3, "2", -1, true];
    const pos = (v) => (typeof v === "number" && v > 0 ? v : 0);
    const at = (v) => { const b = clone(F.board); const p = b.gameView.players.find((x) => x.id === "player-0"); if (v === undefined) delete p.extraTurnCount; else p.extraTurnCount = v; return b; };
    let rows = 0, shown = 0;
    for (const v of COUNTS) {
      const h = harness.load();
      setup(h, at(v));
      h.B.sendTable(); await h.flush();
      const r = sent(h, "table").pop()?.players.find((p) => p.color === "Blue");
      harness.restore();
      if (!r) continue;
      rows++; if ("extraTurns" in r) shown++;
      ok(`extra turns ${JSON.stringify(v)}: the row's extraTurns is the count when above 0, and absent otherwise`,
        pos(v) > 0 ? r.extraTurns === pos(v) : !("extraTurns" in r), JSON.stringify(r.extraTurns));
      ok(`extra turns ${JSON.stringify(v)}: no label for it under the life total`, !(r.allMarks || []).some((m) => /EXTRA TURNS?\b.*\d|COMING/.test(m)), JSON.stringify(r.allMarks));
    }
    ok("extra turns: precondition, every count made a row, some with the field and some without", rows === COUNTS.length && shown > 0 && shown < rows, `${shown} of ${rows}`);
    const h = harness.load();
    setup(h, F.board);
    let pairs = 0, said = 0;
    for (const v of COUNTS) for (const w of COUNTS) {
      const lines = h.B.logEvents(h.B.logSnapshot(at(v).gameView), h.B.logSnapshot(at(w).gameView), at(w).gameView).filter((l) => /extra turn/.test(l));
      const up = pos(w) - pos(v);
      pairs++; if (lines.length) said++;
      const want = up > 0 ? `Blue will take ${up > 1 ? `${up} extra turns` : "an extra turn"} (${pos(w)} coming)` : null;
      ok(`extra turns ${JSON.stringify(v)} -> ${JSON.stringify(w)}: ${want ? `"${want}"` : "no line"}`, want ? lines.length === 1 && lines[0] === want : lines.length === 0, JSON.stringify(lines));
    }
    ok("extra turns: precondition, every pair was logged, some with a line and some without", pairs === COUNTS.length ** 2 && said > 0 && said < pairs, `${said} of ${pairs}`);
    await h.flush();
    harness.restore();
  }
  // turnRuns and controlledBy's say (verifier finding 1, 2026-11-06): "a control is a turn's once a board shows it on
  // the active player with an empty stack, and stays one while the same player keeps it"; the line says "turn" exactly
  // for a turn's control (Mindslaver), plainly otherwise (Opposition Agent's search, on either player's turn). Every
  // chain of three boards: the controller on each (none, AI 1, an unknown id), whose turn it is, and whether an ability
  // is on the stack. The rule is stated here from the sentence, not read from the code
  {
    const h = harness.load();
    setup(h, F.board);
    const ITEM = { id: "stack-agent-1", sourceId: "engine-card-975", controllerId: "player-1", ownerId: "player-1", identity: { name: "Polluted Delta" },
      text: "Search your library for an Island or Swamp card.", sourceAbilityText: "{T}, Sacrifice Polluted Delta: Search your library for an Island or Swamp card.", isTrigger: false, targets: [] };
    const board = (ctl, active, stacked, prio = active) => {
      const b = clone(F.board.gameView);
      Object.assign(b, { activePlayerId: active, priorityPlayerId: prio, stack: stacked ? [clone(ITEM)] : [] });
      const p = b.players.find((x) => x.id === "player-0");
      if (ctl === undefined) delete p.controlledBy; else p.controlledBy = ctl;
      return b;
    };
    const CTL = [undefined, null, "player-1", "player-7"];
    // ([active player, an ability on the stack, who has priority]: priority is not whose turn it is)
    const SHAPES = [];
    for (const a of ["player-0", "player-1"]) for (const st of [false, true]) for (const pr of ["player-0", "player-1"]) SHAPES.push([a, st, pr]);
    const name = (id) => ({ "player-1": "AI 1" })[id] || id;
    const cap = (s) => s && s[0].toUpperCase() + s.slice(1);
    // (the sentence as a rule: the board before's turn's controller, and this board)
    const turnOf = (before, by, [active, stacked]) => (by && (before === by || (active === "player-0" && !stacked)) ? by : undefined);
    let n = 0, turnSaid = 0, plainSaid = 0, none = 0, bad = 0;
    for (const u of CTL) for (const v of CTL) for (const w of CTL) for (const s0 of SHAPES) for (const s1 of SHAPES) for (const s2 of SHAPES) {
      const g0 = board(u, ...s0), g1 = board(v, ...s1), g2 = board(w, ...s2);
      const a = h.B.logSnapshot(g0), b = h.B.logSnapshot(g1, a), c = h.B.logSnapshot(g2, b);
      const t1 = turnOf(turnOf(undefined, u, s0), v, s1), t2 = turnOf(t1, w, s2);
      const lines = h.B.logEvents(b, c, g2).filter((l) => /control/.test(l));
      const want = cap((v || null) === (w || null) ? null : w ? (t2 === w ? `${name(w)} takes control of Blue's turn` : `${name(w)} controls Blue for now`)
        : t1 === v ? `${name(v)}'s control of Blue's turn ends` : `${name(v)} no longer controls Blue`);
      n++;
      if (!want) none++; else if (/turn/.test(want)) turnSaid++; else plainSaid++;
      const okRun = (c.turnRun["player-0"] ?? undefined) === t2;
      const okLine = want ? lines.length === 1 && lines[0] === want : lines.length === 0;
      // (the first few wrong chains by name; the count below says how many)
      if ((!okRun || !okLine) && bad++ < 6) process.stdout.write(`  control ${JSON.stringify([u, v, w])} on ${JSON.stringify([s0, s1, s2])}: want turnRun ${JSON.stringify(t2)}, ${want ? `"${want}"` : "no line"}; got turnRun ${JSON.stringify(c.turnRun)}, lines ${JSON.stringify(lines)}\n`);
    }
    ok(`control: every chain of three boards gives the turn's controller and the line the rule says`, bad === 0, `${bad} of ${n} chains wrong`);
    // "a name that isn't text must not throw" (controlledBy), for the log line too: a controller of 5 comes and goes
    for (const [v, w, want] of [[undefined, 5, "5 controls Blue for now"], [5, undefined, "5 no longer controls Blue"], [5, "player-1", "AI 1 controls Blue for now"]]) {
      const g1 = board(v, "player-1", true), g2 = board(w, "player-1", true);
      let lines;
      try { lines = h.B.logEvents(h.B.logSnapshot(g1), h.B.logSnapshot(g2, h.B.logSnapshot(g1)), g2).filter((l) => /control/.test(l)); } catch (e) { lines = [`THREW ${e.constructor.name}: ${e.message}`]; }
      ok(`control ${JSON.stringify(v)} -> ${JSON.stringify(w)}: "${want}", no throw`, lines.length === 1 && lines[0] === want, JSON.stringify(lines));
    }
    ok("control: precondition, 32768 chains, some say a turn's control, some a plain one, some nothing", n === 32768 && turnSaid > 0 && plainSaid > 0 && none > 0, `${turnSaid} turn, ${plainSaid} plain, ${none} none of ${n}`);
    // the label says the same as the line, read from the board the log just read (playerMarks reads game.logPrev): a
    // turn's control "TURN RUN BY AI 1", any other "CONTROLLED BY AI 1"
    let labels = 0;
    for (const s1 of SHAPES) for (const s2 of SHAPES) for (const ownBefore of [true, false]) {
      const g = h.B._getGame();
      g.logPrev = null; g.lastTableSig = null; g.sentZones = {};
      const seat = g.seats.get("Blue");
      const send = async (gv) => { seat.board = { state: { ...clone(F.board), gameView: gv }, fingerprint: null }; h.B.sendTable(); await h.flush(); };
      await send(board(ownBefore ? "player-1" : undefined, ...s1));
      const before = h.effects.length;
      // (AI 1 a life down, so the second board is never the first one again, which the table is not sent twice)
      const g2 = board("player-1", ...s2); g2.players.find((x) => x.id === "player-1").life--;
      await send(g2);
      const row = h.effects.slice(before).filter((e) => e.tts && e.tts.t === "table").pop()?.tts.players.find((p) => p.slot === "player-0");
      const turn = turnOf(turnOf(undefined, ownBefore ? "player-1" : undefined, s1), "player-1", s2) === "player-1";
      const shown = (row?.allMarks || []).filter((m) => /BY AI 1$/.test(m));
      labels++;
      ok(`control label: AI 1 before ${ownBefore}, ${JSON.stringify([s1, s2])}: ${turn ? "TURN RUN BY AI 1" : "CONTROLLED BY AI 1"}`,
        shown.length === 1 && shown[0] === (turn ? "TURN RUN BY AI 1" : "CONTROLLED BY AI 1"), JSON.stringify(row?.allMarks));
    }
    ok("control label: precondition, 128 boards sent", labels === 128);
    await h.flush();
    harness.restore();
  }
  // bridge fix batch 2026-11-07 (live checks tmp/live-checks/RESULTS.md, keyword sweep tmp/kw-runs/SUMMARY.md)
  {
    const chats = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts && e.tts.t === "chat").map((e) => [e.tts.text, e.tts.color]);
    const logged = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines || []);
    const fresh = (gvExtra = {}, extra = {}) => {
      const h = harness.load();
      const b = clone(F.board);
      Object.assign(b.gameView, { activePlayerId: "player-0", priorityPlayerId: "player-0", step: "main1", stack: [] }, gvExtra);
      const seat = setup(h, b, extra);
      return { h, seat, b };
    };
    const asked = (h, seat, input, more = {}) => { h.B.onPrompt(seat, { promptId: 900, decidingPlayerId: "player-0", input, ...more }); return h.flush(); };
    // a skip ended at a step says it in the table's words, not Forge's (live check 12: "Skip ended: combatBegin, AI 1's
    // turn.", "Skip ended: endOfTurn, your turn.")
    for (const [step, active, want] of [["combatBegin", "player-1", "[MTG] Skip ended: beginning of combat, AI 1's turn."], ["endOfTurn", "player-0", "[MTG] Skip ended: end step, your turn."]]) {
      const { h, seat } = fresh({ step, activePlayerId: active, turn: 9 });
      seat.skipTo = { phase: step === "combatBegin" ? "combat" : "end", turn: 8, step: "main1" };
      await asked(h, seat, { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" }] });
      const said = chats(h).map(([t]) => t).filter((t) => /Skip ended/.test(t));
      ok(`skip ended at ${step}: "${want}"`, said.length === 1 && said[0] === want, JSON.stringify(said));
      harness.restore();
    }
    // game over said once: the question, then the relay's abort right after it (live check 12: said twice, 25 ms apart),
    // and the question twice
    {
      const { h, seat, b } = fresh();
      b.gameView.players.find((p) => p.id === "player-1").life = 0;
      seat.board = { state: b, fingerprint: null };
      await asked(h, seat, { type: "gameOver" });
      h.B.onPrompt(seat, { promptId: 901, decidingPlayerId: "player-0", input: { type: "gameOver" } }); await h.flush();
      seat.onRelay({ type: "GameAborted" }); await h.flush();
      const said = chats(h).map(([t]) => t).filter((t) => /Game over/.test(t));
      ok("game over: said once, though the question comes twice and the relay aborts after it", said.length === 1 && said[0] === "[MTG] Game over: AI 1 is at 0 life.", JSON.stringify(said));
      // (jr suite 2026-11-07) "once to each player": a second seat's own question tells that seat too
      const white = new h.B.Seat("White", "neheb_minotaur_commander");
      white.slot = "player-1"; white.board = { state: clone(b), fingerprint: null };
      h.B._getGame().seats.set("White", white);
      h.B.onPrompt(white, { promptId: 903, decidingPlayerId: "player-1", input: { type: "gameOver" } }); await h.flush();
      const byColor = chats(h).filter(([t]) => /Game over/.test(t)).map(([, c]) => c);
      ok("game over: once to each player", JSON.stringify(byColor) === '["Blue","White"]', JSON.stringify(byColor));
      harness.restore();
    }
    // the timer warning goes only to the player asked (live check 1: "all told: [MTG] White: 15 seconds left to answer.")
    {
      const { h, seat } = fresh();
      h.B._getGame().timer = { on: true, seconds: 30 };
      seat.timeBank = 0;
      await asked(h, seat, { type: "mulligan", mulliganCount: 0 });
      const warn = chats(h).filter(([t]) => /seconds left to answer/.test(t));
      ok("timer warning: to the player asked only", warn.length === 1 && warn[0][1] === "Blue", JSON.stringify(warn));
      h.B._stopTimer(seat, true);
      harness.restore();
    }
    // the second AI is "AI 2" everywhere: its account name is the first's plus " 2" (kw-15: "Mob Verdict: choose one ::
    // AI 1 / AI 1 2")
    {
      const h = harness.load();
      setup(h, clone(F.board), { playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot", "self-hosted-node-77-bot 2"], slotNames: { "player-0": "Blue", "player-1": "AI 1", "player-2": "AI 2" } });
      const got = h.B.displayText("self-hosted-node-77-bot 2 voted for self-hosted-node-77-bot. Self-hosted-node-77-bot picked tts-Blue-ab12");
      ok("names: the second AI is AI 2, not AI 1 2", got === "AI 2 voted for AI 1. AI 1 picked Blue", got);
      // (jr suite 2026-11-07) "made once per player list": a new list is read anew, not the first one's names
      h.B._getGame().playerOrder = ["tts-Blue-ab12", "other-node-bot"];
      const again = h.B.displayText("other-node-bot picked self-hosted-node-77-bot");
      ok("names: a changed player list is matched by its own names", again === "AI 1 picked self-hosted-node-77-bot", again);
      harness.restore();
    }
    // the Ring-bearer question says what it is (live check 9: "Claim the Precious: choose a card"; Forge's description is
    // its lblChooseRingBearer, "Choose your Ring-bearer")
    {
      const { h, seat, b } = fresh();
      const bf = b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards;
      bf.push({ id: "engine-card-950", identity: { name: "Grizzly Bears" }, types: ["Creature"], power: 2, toughness: 2, controllerId: "player-0" },
        { id: "engine-card-951", identity: { name: "Hill Giant" }, types: ["Creature"], power: 3, toughness: 3, controllerId: "player-0" });
      await asked(h, seat, { type: "chooseCards", min: 1, max: 1, cards: bf.slice(-2).map((c) => ({ ...c, zone: "battlefield" })), presentation: { title: "Claim the Precious", description: "Choose your Ring-bearer" } },
        { sourceCard: { id: "engine-card-952", identity: { name: "Claim the Precious" }, text: "Destroy target creature. The Ring tempts you." }, sourceAbilityText: "Destroy target creature. The Ring tempts you." });
      ok("ring-bearer: the question names it", seat.prompt?.ui?.title === "The Ring: choose your Ring-bearer", seat.prompt?.ui?.title);
      harness.restore();
    }
    // halflingcycling's search by its own reminder, not the card's first ability (kw-23: "Hobbit Hole: search your library
    // for which basic land card?")
    {
      const { h, seat } = fresh();
      await asked(h, seat, { type: "chooseCards", min: 0, max: 1, cards: [{ id: "engine-card-953", identity: { name: "Delighted Halfling" }, types: ["Creature"], subtypes: ["Halfling", "Citizen"], power: 1, toughness: 2, zone: "library", ownerId: "player-0" }],
        presentation: { title: "Hobbit Hole", description: "Choose a card" } },
        { sourceCard: { id: "engine-card-954", identity: { name: "Hobbit Hole" }, text: "{T}, Sacrifice this land: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\nHalflingcycling {4} ({4}, Discard this card: Search your library for a Halfling card, reveal it, put it into your hand, then shuffle.)" },
          sourceAbilityText: "Halflingcycling {4} ({4}, Discard this card: Search your library for a Halfling card, reveal it, put it into your hand, then shuffle.)" });
      ok("halflingcycling: its own search", seat.prompt?.ui?.title === "Hobbit Hole: search your library for which Halfling card?", seat.prompt?.ui?.title);
      harness.restore();
    }
    // entwine's player target: no bullet, no second card name (kw-06: "Barbed Lightning: • Barbed Lightning deals 3
    // damage to which player or planeswalker?")
    {
      const { h, seat } = fresh();
      const text = "Choose one —\n• Barbed Lightning deals 3 damage to target creature.\n• Barbed Lightning deals 3 damage to target player or planeswalker.\nEntwine {2} (Choose both if you pay the entwine cost.)";
      await asked(h, seat, { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, candidates: [{ kind: "player", id: "player-1" }, { kind: "player", id: "player-0" }], presentation: { title: "Choose a player to damage" } },
        { sourceCard: { id: "engine-card-955", identity: { name: "Barbed Lightning" }, text }, sourceAbilityText: text });
      ok("entwine: the player target's question is plain", seat.prompt?.ui?.title === "Barbed Lightning: deals 3 damage to which player or planeswalker?", seat.prompt?.ui?.title);
      harness.restore();
    }
    // kinship's "Reveal it" says the card (kw-05: only "White looked at a card (their library)")
    {
      const { h, seat } = fresh({ step: "upkeep" });
      const elder = { id: "engine-card-956", identity: { name: "Leaf-Crowned Elder" }, text: "Kinship — At the beginning of your upkeep, you may look at the top card of your library. If it shares a creature type with Leaf-Crowned Elder, you may reveal it. If you do, you may play that card without paying its mana cost." };
      const kin = "Kinship — At the beginning of your upkeep, you may look at the top card of your library. If it shares a creature type with Leaf-Crowned Elder, you may reveal it. If you do, you may play that card without paying its mana cost.";
      await asked(h, seat, { type: "revealCards", zone: "library", ownerPlayerId: "player-0", cards: [{ id: "engine-card-957", identity: { name: "Elvish Visionary" }, types: ["Creature"] }], presentation: { title: "Look at these cards" } }, { sourceCard: elder, sourceAbilityText: kin });
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["ok"] }) }); await h.flush();
      const mark = h.effects.length;
      h.B.onPrompt(seat, { promptId: 902, decidingPlayerId: "player-0", sourceCard: elder, sourceAbilityText: kin, input: { type: "chooseBoolean", confirmLabel: "Yes", denyLabel: "No", presentation: { title: "Reveal cards to other players?" } } }); await h.flush();
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 902, choice: ["yes"] }) }); await h.flush(5);
      ok("kinship: the revealed card is said", logged(h, mark).includes("Blue reveals Elvish Visionary (Leaf-Crowned Elder)"), JSON.stringify(logged(h, mark)));
      harness.restore();
    }
    // fateseal's bottom card is said, as scry's is (kw-18: nothing after "White looked at a card (AI 1's library)")
    {
      const { h, seat } = fresh();
      const sliver = { id: "engine-card-958", identity: { name: "Mesmeric Sliver" }, text: "All Slivers have \"When this permanent enters, fateseal 1.\"" };
      await asked(h, seat, { type: "chooseCards", min: 0, max: 1, cards: [{ id: "engine-card-959", identity: { name: "Plains" }, types: ["Land"], zone: "library", ownerId: "player-1" }],
        presentation: { title: "Mesmeric Sliver", description: "Choose card(s) to put on the bottom of AI 1 library" } }, { sourceCard: sliver, sourceAbilityText: "When this permanent enters, fateseal 1." });
      const mark = h.effects.length;
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["engine-card-959"] }) }); await h.flush(5);
      ok("fateseal: the bottom card is said", logged(h, mark).includes("Blue puts a card on the bottom of AI 1's library (Mesmeric Sliver)"), JSON.stringify(logged(h, mark)));
      harness.restore();
    }
    // cipher's encode is said (kw-17: only "Last Thoughts is exiled")
    {
      const { h, seat, b } = fresh();
      const bear = { id: "engine-card-960", identity: { name: "Grizzly Bears" }, types: ["Creature"], power: 2, toughness: 2, controllerId: "player-0", zone: "battlefield" };
      b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push(bear, { ...bear, id: "engine-card-962", identity: { name: "Hill Giant" } });
      await asked(h, seat, { type: "chooseCards", min: 0, max: 1, cards: [bear, { ...bear, id: "engine-card-962", identity: { name: "Hill Giant" } }], presentation: { title: "Last Thoughts", description: "Choose a creature you control to encode" } },
        { sourceCard: { id: "engine-card-961", identity: { name: "Last Thoughts" }, text: "Draw a card.\nCipher (...)" }, sourceAbilityText: "Draw a card." });
      const mark = h.effects.length;
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["engine-card-960"] }) }); await h.flush(5);
      ok("cipher: the encode is said", logged(h, mark).includes("Blue encodes Last Thoughts onto Grizzly Bears"), JSON.stringify(logged(h, mark)));
      harness.restore();
    }
    // a trigger-order label without Forge's object number (kw-13: "First Day of Class (225)'s Effect: Whenever ...")
    {
      const { h, seat } = fresh();
      await asked(h, seat, { type: "reorder", items: [
        { id: "t1", card: { id: "engine-card-963", identity: { name: "First Day of Class (225)'s Effect" } }, oracle: "Whenever a creature you control enters this turn, put a +1/+1 counter on it." },
        { id: "t2", card: { id: "engine-card-964", identity: { name: "Soul Warden" } }, oracle: "Whenever another creature enters, you gain 1 life." }], presentation: { title: "Order triggered abilities" } });
      const labels = (seat.prompt?.ui?.options || []).map((o) => o.label).join(" / ");
      ok("trigger order: no object number in a label", labels.includes("First Day of Class' effect:") && !/\(\d+\)/.test(labels), labels);
      harness.restore();
    }
    // a whole library revealed is counted, not listed card by card (kw-22/kw-25: "Island, Island, Island, ...")
    {
      const { h, seat } = fresh();
      const isl = (n) => ({ id: `engine-card-${970 + n}`, identity: { name: "Island" }, types: ["Land"] });
      await asked(h, seat, { type: "revealCards", zone: "library", ownerPlayerId: "player-0", cards: [...Array(9)].map((_, n) => isl(n)), presentation: { title: "Look at these cards" } },
        { sourceCard: { id: "engine-card-990", identity: { name: "Improvisation Capstone" } }, sourceAbilityText: "Exile cards from the top of your library until you exile cards with total mana value 4 or greater. You may cast any number of spells from among them without paying their mana costs." });
      await h.flush(5);
      const lines = logged(h);
      ok("whole library: the cards counted", lines.some((l) => /Island ×9/.test(l)) && !lines.some((l) => /Island, Island/.test(l)), JSON.stringify(lines));
      harness.restore();
    }
    // checker round 2026-11-07: a reveal of more than 6 keeps the library's order, only a run of one card counted
    // ("Island, Opt, Island, Swamp, Island, Opt, Forest" read "Island ×3, Opt ×2, Swamp, Forest")
    for (const [names, want] of [[["Island", "Opt", "Island", "Swamp", "Island", "Opt", "Forest"], "Blue reveals Island, Opt, Island, Swamp, Island, Opt, Forest from their library (Fathom Trawl)"],
      [["Island", "Island", "Island", "Opt", "Swamp", "Island", "Forest", "Forest"], "Blue reveals Island ×3, Opt, Swamp, Island, Forest ×2 from their library (Fathom Trawl)"]]) {
      const { h, seat } = fresh();
      await asked(h, seat, { type: "revealCards", zone: "library", ownerPlayerId: "player-0", cards: names.map((n, k) => ({ id: `engine-card-${1000 + k}`, identity: { name: n }, types: [/^(?:Island|Swamp|Forest)$/.test(n) ? "Land" : "Instant"] })),
        presentation: { title: "Fathom Trawl - Revealing cards from" } },
        { sourceCard: { id: "engine-card-1020", identity: { name: "Fathom Trawl" } }, sourceAbilityText: "Reveal cards from the top of your library until you reveal three nonland cards. Put the nonland cards revealed this way into your hand, then put the rest of the revealed cards on the bottom of your library in any order." });
      await h.flush(5);
      ok(`reveal in order: "${want}"`, logged(h).includes(want), JSON.stringify(logged(h)));
      harness.restore();
    }
    // fateseal declined: the card stays on top, said as scry's is (fix 10's other half)
    {
      const { h, seat } = fresh();
      const sliver = { id: "engine-card-1021", identity: { name: "Mesmeric Sliver" }, text: "All Slivers have \"When this permanent enters, fateseal 1.\"" };
      await asked(h, seat, { type: "chooseCards", min: 0, max: 1, cards: [{ id: "engine-card-1022", identity: { name: "Plains" }, types: ["Land"], zone: "library", ownerId: "player-1" }],
        presentation: { title: "Mesmeric Sliver", description: "Choose card(s) to put on the bottom of AI 1 library" } }, { sourceCard: sliver, sourceAbilityText: "When this permanent enters, fateseal 1." });
      const mark = h.effects.length;
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: [] }) }); await h.flush(5);
      ok("fateseal declined: the card left on top is said", logged(h, mark).includes("Blue leaves the card on top of AI 1's library (Mesmeric Sliver)"), JSON.stringify(logged(h, mark)));
      ok("fateseal declined: nothing put on the bottom", !logged(h, mark).some((l) => /on the bottom/.test(l)), JSON.stringify(logged(h, mark)));
      harness.restore();
    }
    // (jr suite 2026-11-07) Forge names the library's player by the engine's name: the player's own is "their library",
    // another's by its table name ("AI 1's", the engine's "self-hosted-node-77-bot")
    for (const [engineName, want] of [["tts-Blue-ab12", "Blue puts a card on the bottom of their library (Mesmeric Sliver)"], ["self-hosted-node-77-bot", "Blue puts a card on the bottom of AI 1's library (Mesmeric Sliver)"]]) {
      const { h, seat } = fresh();
      await asked(h, seat, { type: "chooseCards", min: 0, max: 1, cards: [{ id: "engine-card-1026", identity: { name: "Plains" }, types: ["Land"], zone: "library", ownerId: "player-1" }],
        presentation: { title: "Mesmeric Sliver", description: `Choose card(s) to put on the bottom of ${engineName} library` } }, { sourceCard: { id: "engine-card-1027", identity: { name: "Mesmeric Sliver" } }, sourceAbilityText: "When this permanent enters, fateseal 1." });
      const mark = h.effects.length;
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["engine-card-1026"] }) }); await h.flush(5);
      ok(`bottom of ${engineName}'s library: "${want}"`, logged(h, mark).includes(want), JSON.stringify(logged(h, mark)));
      harness.restore();
    }
    // the player's own "detain up to two target" trigger, picked before any board shows it: both detained once it is gone
    // (Azorius Justiciar's TriggerDescription, CARDNAME as Forge writes it)
    {
      const { h, seat, b } = fresh();
      const opp = b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1").cards;
      opp.push({ id: "engine-card-1023", identity: { name: "Wall of Omens" }, types: ["Creature"], power: 0, toughness: 4, controllerId: "player-1" },
        { id: "engine-card-1024", identity: { name: "Hill Giant" }, types: ["Creature"], power: 3, toughness: 3, controllerId: "player-1" });
      seat.board = { state: b, fingerprint: null };
      const text = "When Azorius Justiciar enters, detain up to two target creatures your opponents control. (Until your next turn, those creatures can't attack or block and their activated abilities can't be activated.)";
      await asked(h, seat, { type: "chooseBoardTargets", minTargets: 0, maxTargets: 2, candidates: [{ kind: "card", id: "engine-card-1023" }, { kind: "card", id: "engine-card-1024" }], presentation: { title: "Choose targets" } },
        { sourceCard: { id: "engine-card-1025", identity: { name: "Azorius Justiciar" }, text }, sourceAbilityText: text });
      h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["card|engine-card-1023", "card|engine-card-1024"] }) }); await h.flush(5);
      const gv = b.gameView;
      const lines = h.B.logEvents(h.B.logSnapshot(gv), h.B.logSnapshot(gv), gv, null);
      ok("detain up to two (own trigger): both said", lines.includes("Wall of Omens, Hill Giant are detained: until Blue's next turn they can't attack or block, and their activated abilities can't be activated"), JSON.stringify(lines));
      harness.restore();
    }
  }
  // Kykar UI batch 2026-11-07 (docs/HAND-TEST-KYKAR.md; the engine's words from the ability probe, Kykar probe 2026-11-07)
  {
    const chats = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts && e.tts.t === "chat").map((e) => e.tts.text);
    const fresh = (edit, gvExtra = {}) => {
      const h = harness.load();
      const b = clone(F.board);
      Object.assign(b.gameView, { activePlayerId: "player-0", priorityPlayerId: "player-0", step: "main1", stack: [] }, gvExtra);
      if (edit) edit(b.gameView);
      const seat = setup(h, b);
      return { h, seat, b };
    };
    const asked = (h, seat, input, more = {}) => { h.B.onPrompt(seat, { promptId: 900, decidingPlayerId: "player-0", input, ...more }); return h.flush(); };
    const mine = (gv) => gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards;
    const labels = (seat) => (seat.prompt?.ui?.options || []).map((o) => o.label);
    const one = (id, name, extra = {}) => ({ id, identity: { name }, types: ["Creature"], power: 1, toughness: 1, controllerId: "player-0", ...extra });
    // #1: a mana ability's button says "tap" only when its cost has {T}; Lotus Petal's says it is sacrificed (probe extra)
    {
      const { h, seat } = fresh((gv) => mine(gv).push(
        one("engine-card-1209", "Kykar, Wind's Fury", { power: 3, toughness: 3, text: "Flying\nWhenever you cast a noncreature spell, create a 1/1 white Spirit creature token with flying.\nSacrifice a Spirit: Add {R}." }),
        { id: "engine-card-1213", identity: { name: "Ashnod's Altar" }, types: ["Artifact"], controllerId: "player-0", text: "Sacrifice a creature: Add {C}{C}." },
        { id: "engine-card-1214", identity: { name: "Lotus Petal" }, types: ["Artifact"], controllerId: "player-0", text: "{T}, Sacrifice Lotus Petal: Add one mana of any color." }));
      await asked(h, seat, { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" },
        { id: "tap:engine-card-1209:9", type: "activateAbility", cardId: "engine-card-1209", abilityIndex: 9, isManaAbility: true, description: "Sacrifice a Spirit: Add {R}.", cost: "Sacrifice a Spirit", producedMana: [{ amount: 1, color: "R" }] },
        { id: "tap:engine-card-1213:10", type: "activateAbility", cardId: "engine-card-1213", abilityIndex: 10, isManaAbility: true, description: "Sacrifice a creature: Add {C}{C}.", cost: "Sacrifice a creature", producedMana: [{ amount: 2, color: "C" }] },
        { id: "tap:engine-card-1214:11:W", type: "activateAbility", cardId: "engine-card-1214", abilityIndex: 11, isManaAbility: true, description: "{T}, Sacrifice Lotus Petal: Add one mana of any color.", cost: "{T}, Sacrifice CARDNAME", producedMana: [{ amount: 1, color: "W" }] }] });
      const got = labels(seat);
      ok("kykar #1: a sacrifice-only mana ability isn't 'tap'", got.includes("Mana: Kykar, Wind's Fury (sacrifice a Spirit)") && got.includes("Mana: Ashnod's Altar (sacrifice a creature)"), JSON.stringify(got));
      ok("kykar probe: Lotus Petal's button says it is sacrificed", got.includes("Mana: tap Lotus Petal (also sacrifice it)"), JSON.stringify(got));
      harness.restore();
    }
    // #4: a painland's and Ancient Tomb's pay labels say the damage, only for the colours that deal it
    {
      const { h, seat } = fresh((gv) => mine(gv).push(
        { id: "engine-card-1301", identity: { name: "Adarkar Wastes" }, types: ["Land"], controllerId: "player-0", text: "{T}: Add {C}.\n{T}: Add {W} or {U}. Adarkar Wastes deals 1 damage to you." },
        { id: "engine-card-1203", identity: { name: "Ancient Tomb" }, types: ["Land"], controllerId: "player-0", text: "{T}: Add {C}{C}. Ancient Tomb deals 2 damage to you." }));
      await asked(h, seat, { type: "payManaCost", manaCost: "{1}{W}", presentation: { title: "Pay {1}{W}" }, actions: [
        { id: "tap:engine-card-1301:0", cardId: "engine-card-1301", abilityIndex: 0, description: "Adarkar Wastes", cost: "{T}", producedMana: [{ amount: 1, color: "C" }] },
        { id: "tap:engine-card-1301:1:W", cardId: "engine-card-1301", abilityIndex: 1, description: "Adarkar Wastes", cost: "{T}", producedMana: [{ amount: 1, color: "W" }] },
        { id: "tap:engine-card-1203:2", cardId: "engine-card-1203", abilityIndex: 2, description: "Ancient Tomb", cost: "{T}", producedMana: [{ amount: 2, color: "C" }] }] },
        { sourceCard: { id: "engine-card-43", identity: { name: "Vraska's Fall" } } });
      const got = labels(seat);
      ok("kykar #4: a painland's coloured mana says its damage, its {C} doesn't", got.includes("Tap Adarkar Wastes for {W} (1 damage to you)") && got.includes("Tap Adarkar Wastes for {C}"), JSON.stringify(got));
      ok("kykar #4: Ancient Tomb says its damage", got.includes("Tap Ancient Tomb for {C}{C} (2 damage to you)"), JSON.stringify(got));
      harness.restore();
    }
    // #5 #24: Forge's separator rows are never options, a source choice says "choose a source", a commander says its zone
    {
      const { h, seat } = fresh((gv) => {
        mine(gv).push(one("engine-card-1805", "Rograkh, Son of Rohgahh", { power: 0 }));
        gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1").cards.push(one("engine-card-1804", "Serra Angel", { power: 4, toughness: 4, controllerId: "player-1" }));
      });
      const text = "The next time a source of your choice would deal damage to you this turn, prevent that damage. If damage is prevented this way, Deflecting Palm deals that much damage to that source's controller.";
      await asked(h, seat, { type: "chooseCards", min: 1, max: 1, presentation: { title: "Deflecting Palm", description: "Choose a source " },
        cards: [{ id: "engine-card-1801", identity: { name: "--CARDS IN THE COMMAND ZONE:--", setCode: "???" } }, { id: "engine-card-1802", identity: { name: "--PERMANENTS:--", setCode: "???" } },
          { id: "engine-card-1803", identity: { name: "--SPELLS ON THE STACK:--", setCode: "???" } }, { ...one("engine-card-1804", "Serra Angel", { power: 4, toughness: 4, controllerId: "player-1" }), zone: "battlefield", ownerId: "player-1" },
          { ...one("engine-card-1806", "Rograkh, Son of Rohgahh", { power: 0 }), zone: "command", ownerId: "player-0" }] },
        { sourceCard: { id: "engine-card-1807", identity: { name: "Deflecting Palm" }, text }, sourceAbilityText: text });
      const got = labels(seat);
      ok("kykar #5 #24: no separator row is an option", got.length === 2 && !got.some((l) => /--/.test(l)), JSON.stringify(got));
      ok("kykar #5 #24: a source choice says so", seat.prompt?.ui?.title === "Deflecting Palm: choose a source", seat.prompt?.ui?.title);
      ok("kykar #5 #24: a source outside the battlefield says where it is", got.includes("Rograkh, Son of Rohgahh 0/1 (command zone)"), JSON.stringify(got));
      ok("kykar #5 #24: a source choice has no library-search hint", !/library/.test(seat.prompt?.ui?.text || ""), seat.prompt?.ui?.text);
      harness.restore();
    }
    // (a source that is only a spell on the stack, in no zone the table shows: no "right-click your library" hint either)
    {
      const { h, seat } = fresh();
      await asked(h, seat, { type: "chooseCards", min: 1, max: 1, presentation: { title: "Deflecting Palm", description: "Choose a source " },
        cards: [{ id: "engine-card-1808", identity: { name: "--SPELLS ON THE STACK:--", setCode: "???" } }, { id: "engine-card-1809", identity: { name: "Lightning Bolt" }, types: ["Instant"], controllerId: "player-1", ownerId: "player-1", zone: "stack" }] },
        { sourceCard: { id: "engine-card-1807", identity: { name: "Deflecting Palm" } }, sourceAbilityText: "The next time a source of your choice would deal damage to you this turn, prevent that damage." });
      ok("kykar #5 #24: a spell as a source has no library-search hint", !/library/.test(seat.prompt?.ui?.text || "") && labels(seat).includes("Lightning Bolt (on the stack)"), JSON.stringify([seat.prompt?.ui?.text, labels(seat)]));
      harness.restore();
    }
    // INV-6: two cards that read alike are told apart by whose they are
    {
      const { h, seat } = fresh();
      await asked(h, seat, { type: "chooseCards", min: 1, max: 1, presentation: { title: "Circle of Protection: Red", description: "Choose a source " },
        cards: [{ ...one("engine-card-1850", "Rograkh, Son of Rohgahh", { power: 0 }), zone: "command", ownerId: "player-0" }, { ...one("engine-card-1851", "Rograkh, Son of Rohgahh", { power: 0, controllerId: "player-1" }), zone: "command", ownerId: "player-1" }] },
        { sourceCard: { id: "engine-card-1852", identity: { name: "Circle of Protection: Red" } }, sourceAbilityText: "{1}: The next time a red source of your choice would deal damage to you this turn, prevent that damage." });
      const got = labels(seat);
      ok("kykar INV-6: alike options say whose", got.includes("Rograkh, Son of Rohgahh 0/1 (command zone, yours)") && got.includes("Rograkh, Son of Rohgahh 0/1 (command zone, AI 1's)"), JSON.stringify(got));
      harness.restore();
    }
    // #9: "#n" labels sort as numbers (#9 before #10)
    {
      const { h, seat } = fresh();
      const toks = Array.from({ length: 11 }, (_, k) => ({ ...one(`engine-card-${1820 + k}`, "Spirit Token", { identity: { name: "Spirit Token", isToken: true } }), zone: "battlefield" }));
      await asked(h, seat, { type: "chooseCards", min: 0, max: 11, presentation: { title: "Choose cards", description: "Choose cards" }, cards: toks }, { sourceCard: { id: "engine-card-1840", identity: { name: "Some Card" } } });
      const got = labels(seat);
      ok("kykar #9: #9 comes before #10", got.indexOf("Spirit Token 1/1 #9") >= 0 && got.indexOf("Spirit Token 1/1 #9") < got.indexOf("Spirit Token 1/1 #10") && got.indexOf("Spirit Token 1/1 #2") < got.indexOf("Spirit Token 1/1 #10"), JSON.stringify(got));
      harness.restore();
    }
    // #18: Forge's doubled plural is undone (Mondrak's live cost "creatureses")
    {
      const h = harness.load();
      setup(h, clone(F.board));
      const got = h.B.displayText("{1}{W/P}{W/P}, Sacrifice two other artifacts and/or creatureses: Put an indestructible counter on Mondrak, Glory Dominus.");
      ok("kykar #18: 'creatureses' reads 'creatures'", got === "{1}{W/P}{W/P}, Sacrifice two other artifacts and/or creatures: Put an indestructible counter on Mondrak, Glory Dominus.", got);
      ok("kykar #18: a real word in -ses stays", h.B.displayText("Each player chooses. Its horses gain haste.") === "Each player chooses. Its horses gain haste.", h.B.displayText("Each player chooses. Its horses gain haste."));
      harness.restore();
    }
    // #22: a free cast says it is free, and why ("If you control a commander", Flawless Maneuver's text)
    {
      const { h, seat } = fresh((gv) => gv.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0").cards.push({ id: "engine-card-1860", identity: { name: "Flawless Maneuver" }, types: ["Instant"], text: "If you control a commander, you may cast this spell without paying its mana cost.\nCreatures you control gain indestructible until end of turn." }));
      await asked(h, seat, { type: "chooseAction", actions: [{ id: "a1", type: "cast", cardId: "engine-card-1860", label: "Cast Flawless Maneuver", mode: { type: "normal" } }, { id: "a2", type: "cast", cardId: "engine-card-1860", label: "Cast Flawless Maneuver", mode: { type: "staticAlternative" } }] });
      const got = labels(seat);
      ok("kykar #22: the free cast is 'without paying its mana cost'", got.includes("Cast Flawless Maneuver without paying its mana cost (you control a commander)") && !got.some((l) => /alternative cost/.test(l)), JSON.stringify(got));
      harness.restore();
    }
    // probe extra: Esper Sentinel's "Pay {X}?" says X; its No says the other player's draw as it is
    {
      const { h, seat } = fresh();
      const text = "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is Esper Sentinel's power.";
      await asked(h, seat, { type: "chooseBoolean", confirmLabel: "Pay", denyLabel: "Decline", presentation: { title: "Pay {X}?", text: "otherwise: \"AI 1 draws a card.\"" } },
        { sourceAbilityText: text, sourceCard: { id: "engine-card-1244", identity: { name: "Esper Sentinel" }, power: "1", toughness: "1", controllerId: "player-1", text } });
      const u = seat.prompt?.ui;
      ok("kykar probe: Esper Sentinel's X is said", u?.title === "Esper Sentinel: pay {1}?" && /^X is Esper Sentinel's power: 1\./.test(u?.text || "") && labels(seat)[0] === "Pay {1}", JSON.stringify([u?.title, u?.text, labels(seat)]));
      ok("kykar probe: another player's line in No keeps its name", labels(seat).includes("No: AI 1 draws a card"), JSON.stringify(labels(seat)));
      harness.restore();
    }
    // probe extra: Thriving Isle's colour question, titled by its own sentence
    {
      const { h, seat } = fresh();
      await asked(h, seat, { type: "chooseColor", amount: 1, repeatAllowed: false, validColors: ["Black", "Red", "Green", "White"], presentation: { title: "Thriving Isle" } },
        { sourceAbilityText: "Play land", sourceCard: { id: "engine-card-1264", identity: { name: "Thriving Isle" }, types: ["Land"], text: "Thriving Isle enters tapped.\nAs Thriving Isle enters, choose a color other than blue.\n{T}: Add {U} or one mana of the chosen color." } });
      ok("kykar probe: Thriving Isle asks 'choose a color other than blue'", seat.prompt?.ui?.title === "Thriving Isle: choose a color other than blue", seat.prompt?.ui?.title);
      harness.restore();
    }
    // #17: the order of two replacement effects says so, each by its card
    {
      const AP = "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.";
      const MO = "If one or more tokens would be created under your control, twice that many of those tokens are created instead.";
      const { h, seat } = fresh((gv) => mine(gv).push({ id: "engine-card-1870", identity: { name: "Anointed Procession" }, types: ["Enchantment"], controllerId: "player-0", text: AP },
        { id: "engine-card-1871", identity: { name: "Mondrak, Glory Dominus" }, types: ["Artifact", "Creature"], controllerId: "player-0", text: `Flying\n${MO}\n{1}{W/P}{W/P}, Sacrifice two other artifacts and/or creatures: Put an indestructible counter on Mondrak, Glory Dominus.` }));
      await asked(h, seat, { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, presentation: { title: "Choose", targets: [] }, options: [{ label: AP, weight: 1, canRepeat: false }, { label: MO, weight: 1, canRepeat: false }] },
        { sourceCard: { id: "engine-card-1209", identity: { name: "Kykar, Wind's Fury" } }, sourceAbilityText: "Whenever you cast a noncreature spell, create a 1/1 white Spirit creature token with flying." });
      ok("kykar #17: titled 'which applies first?'", seat.prompt?.ui?.title === "Kykar, Wind's Fury: which applies first?", seat.prompt?.ui?.title);
      ok("kykar #17: each option by its card", JSON.stringify(labels(seat)) === JSON.stringify([`Anointed Procession: ${AP}`, `Mondrak, Glory Dominus: ${MO}`]), JSON.stringify(labels(seat)));
      harness.restore();
    }
    // #16: an engine-ended draw says why, the board carries it for the top bar, and a rewind after it says the game ended
    {
      const { h, seat } = fresh(null, { gameOver: true, winnerId: null });
      await asked(h, seat, { type: "gameOver" });
      const said = chats(h).filter((t) => /Game over/.test(t));
      ok("kykar #16: an engine-ended draw says it was a draw and why", said.length === 1 && /^\[MTG\] Game over: a draw\. .*runaway-game cap/.test(said[0]), JSON.stringify(said));
      h.B.sendTable(); await h.flush();
      const t = sent(h, "table").at(-1);
      ok("kykar #16: the table message carries why it ended", t?.gameOver && /^a draw\./.test(t?.overWhy || ""), JSON.stringify(t && [t.gameOver, t.overWhy]));
      const mark = h.effects.length;
      h.B.onTTS({ t: "rewind", json: JSON.stringify({ color: "Blue", checkpointId: 1 }) }); await h.flush();
      const refused = chats(h, mark);
      ok("kykar #16: a rewind after the end says the game has ended", refused.length === 1 && /^\[MTG\] The game has ended \(a draw\./.test(refused[0]), JSON.stringify(refused));
      harness.restore();
    }
    // #14: a copy's target question is worded like its original's (Twincast on Explosion, the probe's stack: the copy's
    // card in no zone, Forge's resolved line as "text", the rules text as sourceAbilityText)
    {
      const stack = [{ id: "engine-stack-2", sourceId: "engine-card-1919", controllerId: "player-0", identity: { name: "Explosion" }, isPermanentSpell: false, sourceAbilityText: "Explosion deals X damage to any target. Target player draws X cards.",
        targets: [{ id: "player-1", kind: "player" }], text: "Explosion (220) - Explosion (220) deals 0 damage to AI 1. AI 1 draws zero cards. (X=0)" },
        { id: "engine-stack-4", sourceId: "engine-card-1920", controllerId: "player-0", identity: { name: "Twincast" }, isPermanentSpell: false, sourceAbilityText: "Copy target instant or sorcery spell. You may choose new targets for the copy.", targets: [], text: "Twincast (221) - Copy Explosion (220)." }];
      const { h, seat } = fresh(null, { stack });
      await asked(h, seat, { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, chosenTargets: 0, intent: "draw", candidates: [{ kind: "player", id: "player-0" }, { kind: "player", id: "player-1" }], presentation: { title: "Choose player to draw", targets: [] } });
      ok("kykar #14: a copy asks in its original's words", seat.prompt?.ui?.title === "Copy of Explosion: which player draws X cards?", seat.prompt?.ui?.title);
      harness.restore();
    }
    // #20: fused Wear // Tear asks each half's target under that half's name (the probe's live shape: ability text the Fuse
    // reminder, card text "(Wear) Destroy target artifact. ..."), and its copy the same way
    {
      const FUSE = "Fuse (You may cast one or both halves of this card from your hand.)";
      const text = `(Wear) Destroy target artifact.\n${FUSE}\r\n\r\n(Tear) Destroy target enchantment.\n${FUSE}`;
      const { h, seat, b } = fresh((gv) => gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1").cards.push(
        { id: "engine-card-1950", identity: { name: "Ornithopter" }, types: ["Artifact", "Creature"], power: 0, toughness: 2, controllerId: "player-1" },
        { id: "engine-card-1951", identity: { name: "Glorious Anthem" }, types: ["Enchantment"], controllerId: "player-1" }));
      const wt = { id: "engine-card-1952", identity: { name: "Wear // Tear" }, text };
      await asked(h, seat, { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, chosenTargets: 0, intent: "destroy", candidates: [{ kind: "card", id: "engine-card-1950" }], presentation: { title: "Destroy", targets: [] } }, { sourceCard: wt, sourceAbilityText: FUSE });
      const first = seat.prompt?.ui;
      ok("kykar #20: Wear's target under its own name", first?.title === "Wear: destroy which artifact?", first?.title);
      ok("kykar #20: the half's text, not the Fuse reminder", first?.text === "Destroy target artifact.", first?.text);
      h.B.onPrompt(seat, { promptId: 901, decidingPlayerId: "player-0", input: { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, chosenTargets: 0, intent: "destroy", candidates: [{ kind: "card", id: "engine-card-1951" }], presentation: { title: "Destroy", targets: [] } }, sourceCard: wt, sourceAbilityText: FUSE });
      await h.flush();
      ok("kykar #20: Tear's target under its own name", seat.prompt?.ui?.title === "Tear: destroy which enchantment?", seat.prompt?.ui?.title);
      // (the copy: no asking card, the spell on the stack with the Fuse reminder as its text)
      b.gameView.stack = [{ id: "engine-stack-9", sourceId: "engine-card-1953", controllerId: "player-0", identity: { name: "Wear // Tear" }, isPermanentSpell: false, sourceAbilityText: FUSE, targets: [], text: "Wear // Tear (207) - Destroy target artifact. Destroy target enchantment." }];
      seat.board = { state: b, fingerprint: null };
      h.B.onPrompt(seat, { promptId: 902, decidingPlayerId: "player-0", input: { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, chosenTargets: 0, intent: "destroy", candidates: [{ kind: "card", id: "engine-card-1950" }], presentation: { title: "Destroy", targets: [] } } });
      await h.flush();
      ok("kykar #20: the copy's half too", seat.prompt?.ui?.title === "Copy of Wear: destroy which artifact?", seat.prompt?.ui?.title);
      harness.restore();
    }
    // #23: several targets say what they are for (Guardian of Faith: no ability text, the card's; Clever Concealment's)
    {
      const text = "Flash\nFlying\nWhen Guardian of Faith enters, any number of other target creatures you control phase out. (Treat them and anything attached to them as though they don't exist until your next turn.)";
      const { h, seat } = fresh((gv) => mine(gv).push(one("engine-card-1930", "Grizzly Bears", { power: 2, toughness: 2 }), one("engine-card-1931", "Ornithopter", { power: 0, toughness: 2 })));
      await asked(h, seat, { type: "chooseBoardTargets", minTargets: 0, maxTargets: 11, chosenTargets: 0, intent: "hostile", candidates: [{ kind: "card", id: "engine-card-1930" }, { kind: "card", id: "engine-card-1931" }], presentation: { title: "Hostile", targets: [] } },
        { sourceCard: { id: "engine-card-1932", identity: { name: "Guardian of Faith" }, text } });
      ok("kykar #23: Guardian of Faith asks which creatures phase out", seat.prompt?.ui?.title === "Guardian of Faith: which other creatures you control phase out?", seat.prompt?.ui?.title);
      harness.restore();
    }
    {
      const text = "Any number of target nonland permanents you control phase out. (Treat them and anything attached to them as though they don't exist until your next turn.)";
      const { h, seat } = fresh((gv) => mine(gv).push(one("engine-card-1933", "Grizzly Bears", { power: 2, toughness: 2 }), one("engine-card-1934", "Ornithopter", { power: 0, toughness: 2 })));
      await asked(h, seat, { type: "chooseBoardTargets", minTargets: 0, maxTargets: 2, chosenTargets: 0, intent: "hostile", candidates: [{ kind: "card", id: "engine-card-1933" }, { kind: "card", id: "engine-card-1934" }], presentation: { title: "Hostile", targets: [] } },
        { sourceCard: { id: "engine-card-1935", identity: { name: "Clever Concealment" }, text: `Convoke\n${text}` }, sourceAbilityText: text });
      ok("kykar #23: Clever Concealment asks which permanents phase out", seat.prompt?.ui?.title === "Clever Concealment: which nonland permanents you control phase out?", seat.prompt?.ui?.title);
      harness.restore();
    }
    // #23: proliferate's own step (Forge's lblChooseProliferateTarget) under a card whose text has another "put"
    {
      const text = "Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order. Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)";
      const { h, seat } = fresh((gv) => mine(gv).push(one("engine-card-1936", "Grizzly Bears", { power: 3, toughness: 3, counters: { P1P1: 1 } })));
      await asked(h, seat, { type: "chooseCards", min: 0, max: 1, presentation: { title: "Experimental Augury", description: "Choose any number of permanents and/or players for proliferate" },
        cards: [{ ...one("engine-card-1936", "Grizzly Bears", { power: 3, toughness: 3, counters: { P1P1: 1 } }), zone: "battlefield", ownerId: "player-0" }] },
        { sourceCard: { id: "engine-card-1937", identity: { name: "Experimental Augury" }, text }, sourceAbilityText: text });
      ok("kykar #23: proliferate says it", seat.prompt?.ui?.title === "Experimental Augury: give which another counter (proliferate)?", seat.prompt?.ui?.title);
      harness.restore();
    }
    // #27: Arcane Bombardment's copies are cast, the exiled cards stay: no drag-out hint (its live trigger text, Forge's
    // lblSelectCardToPlay)
    {
      const { h, seat } = fresh((gv) => gv.zones.find((z) => z.zone === "exile" && z.ownerId === "player-0").cards.push({ id: "engine-card-1940", identity: { name: "Opt" }, types: ["Instant"], text: "Scry 1.\nDraw a card." }));
      await asked(h, seat, { type: "chooseCards", min: 0, max: 1, presentation: { title: "Arcane Bombardment", description: "Select a card to play" },
        cards: [{ id: "engine-card-1940", identity: { name: "Opt" }, types: ["Instant"], zone: "exile", ownerId: "player-0" }] },
        { sourceCard: { id: "engine-card-1941", identity: { name: "Arcane Bombardment" } },
          sourceAbilityText: "Whenever you cast your first instant or sorcery spell each turn, exile an instant or sorcery card at random from your graveyard. Then copy each card exiled with Arcane Bombardment. You may cast any number of the copies without paying their mana costs." });
      const u = seat.prompt?.ui;
      ok("kykar #27: copies: no drag-out from the pile", u?.copies === true && u?.pileChoices === undefined && !/drag/i.test(u?.text || ""), JSON.stringify(u && [u.copies, u.pileChoices, u.text]));
      ok("kykar #27: copies: the title says a copy is cast", u?.title === "Arcane Bombardment: cast which copy?", u?.title);
      harness.restore();
    }
    // #16: a win names the winner and the loser's reason
    {
      const { h, seat, b } = fresh(null, { gameOver: true, winnerId: "player-0" });
      b.gameView.players.find((p) => p.id === "player-1").life = 0;
      seat.board = { state: b, fingerprint: null };
      await asked(h, seat, { type: "gameOver" });
      const said = chats(h).filter((t) => /Game over/.test(t));
      ok("kykar #16: a win says who won", said[0] === "[MTG] Game over: AI 1 is at 0 life. Blue wins.", JSON.stringify(said));
      harness.restore();
    }
  }
  console.log(failed ? `\n${failed} claim checks failed (${passed} passed)` : `all ${passed} claim checks pass`);
  process.exit(failed ? 1 : 0);
})();
