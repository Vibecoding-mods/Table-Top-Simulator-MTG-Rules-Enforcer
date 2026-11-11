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
  // "only a card it could be cast from where it lies" is kept for the next priority (onIntent's play): Rancor, discarded
  // a moment before, was dragged out of priority and queued (2026-11-08 23:39, table-session.log); a hand card still is
  {
    const drag = async (zoneKind, extra = {}) => {
      const h = harness.load();
      const b = clone(F.board);
      Object.assign(b.gameView, { activePlayerId: "player-1", priorityPlayerId: "player-1", step: "main1", stack: [] });
      const from = b.gameView.zones.find((z) => (z.cards || []).some((c) => c.id === "engine-card-36"));
      const card = from.cards.find((c) => c.id === "engine-card-36");
      from.cards = from.cards.filter((c) => c !== card);
      Object.assign(card, { identity: { name: "Rancor" }, types: ["Enchantment"], subtypes: ["Aura"], text: "Enchant creature\nEnchanted creature gets +2/+0 and has trample.", ...extra });
      let to = b.gameView.zones.find((z) => z.zone === zoneKind && z.ownerId === "player-0");
      if (!to) { to = { zone: zoneKind, ownerId: "player-0", cards: [], count: 0 }; b.gameView.zones.push(to); }
      to.cards.push(card);
      const seat = setup(h, b);
      h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "play", id: "engine-card-36" }) }); await h.flush();
      const out = { queued: seat.queuedPlay, told: h.effects.filter((e) => e.tts && e.tts.t === "chat").map((e) => e.tts.text).join(" | ") };
      harness.restore();
      return out;
    };
    const gy = await drag("graveyard");
    ok("queued play: a graveyard card nothing lets you cast isn't kept", !gy.queued, JSON.stringify(gy));
    ok("queued play: and the player is told where it is", gy.told.includes("Rancor is in your graveyard: it can be cast from there only if"), gy.told);
    const hand = await drag("hand");
    ok("queued play: a hand card still is kept", hand.queued && hand.queued.id === "engine-card-36", JSON.stringify(hand));
    const fb = await drag("graveyard", { mayPlay: true });
    ok("queued play: a graveyard card the engine lets you cast is kept", fb.queued && fb.queued.id === "engine-card-36", JSON.stringify(fb));
    // (a permanent dragged out of priority, to equip it on an opponent's turn: kept for the next priority as before,
    // not refused with "none of its abilities can be used", verifier 2026-11-11)
    const sword = await drag("battlefield", { identity: { name: "Sword of Fire and Ice" }, types: ["Artifact"], subtypes: ["Equipment"], text: "Equipped creature gets +2/+2.\nEquip {2}" });
    ok("queued play: an equipment on the battlefield is kept for the next priority", sword.queued && sword.queued.id === "engine-card-36" && !sword.told.includes("none of its abilities"), JSON.stringify(sword));
    const exiled = await drag("exile");
    ok("queued play: an exiled card nothing lets you cast isn't kept, and says where", !exiled.queued && exiled.told.includes("Rancor is in your exile"), JSON.stringify(exiled));
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
    // ("Until <phase>" stays on and stops at that phase each turn, said once per stop; "Until my turn" ends, item 3
    // 2026-11-10)
    for (const [step, active, want] of [["combatBegin", "player-1", "[MTG] Stopped: beginning of combat, AI 1's turn. \"Until combat\" stays on."], ["endOfTurn", "player-0", "[MTG] Stopped: end step, your turn. \"Until end step\" stays on."]]) {
      const { h, seat } = fresh({ step, activePlayerId: active, turn: 9 });
      seat.skipTo = { phase: step === "combatBegin" ? "combat" : "end", turn: 8, step: "main1" };
      await asked(h, seat, { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" }] });
      const asks = !!seat.prompt;
      if (seat.prompt) seat.prompt = null;
      h.B.onPrompt(seat, { promptId: 901, decidingPlayerId: "player-0", input: { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" }] } }); await h.flush();
      const said = chats(h).map(([t]) => t).filter((t) => /Stopped|Skip ended/.test(t));
      ok(`skip stops at ${step}: "${want}"`, said[0] === want && asks, JSON.stringify(said));
      ok(`skip stops at ${step}: said once for two priorities in that step, and it stays on`, said.length === 1 && seat.skipTo?.phase === (step === "combatBegin" ? "combat" : "end") && !!seat.prompt, JSON.stringify([said, seat.skipTo]));
      harness.restore();
    }
    {
      // passed outside the phase, also on another player's turn, and stopped there again the next turn
      const pass = { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" }] };
      const { h, seat } = fresh({ step: "main2", activePlayerId: "player-1", turn: 9 });
      seat.skipTo = { phase: "combat", turn: 8, step: "main1" };
      const from = h.effects.length;
      await asked(h, seat, pass);
      const passed = h.effects.slice(from).some((e) => e.relay && /"pass"/.test(JSON.stringify(e.relay)));
      ok("skip: priority outside the phase is passed on another player's turn", passed && !seat.prompt, JSON.stringify(h.effects.slice(from).filter((e) => e.relay)).slice(0, 200));
      const b2 = seat.board.state.gameView;
      Object.assign(b2, { step: "combatDeclareAttackers", activePlayerId: "player-0", turn: 10 });
      h.B.onPrompt(seat, { promptId: 902, decidingPlayerId: "player-0", input: pass }); await h.flush();
      ok("skip: it stops at the phase again the next turn", !!seat.prompt && seat.skipTo?.phase === "combat", JSON.stringify(seat.skipTo));
      harness.restore();
    }
    {
      // "Until my turn" is one stop
      const { h, seat } = fresh({ step: "upkeep", activePlayerId: "player-0", turn: 9 });
      seat.skipTo = { phase: "mine", turn: 8, step: "main1" };
      await asked(h, seat, { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" }] });
      ok("skip: 'Until my turn' ends when it is reached", seat.skipTo == null && chats(h).some(([t]) => t === "[MTG] Skip ended: upkeep, your turn."), JSON.stringify(chats(h)));
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
      // (and kept for the attack question's "can't attack" list until Blue's next turn, attackReminder)
      const det = h.B._getGame().detained;
      ok("detain: both kept as detained by Blue", det?.get("engine-card-1023")?.by === "player-0" && det?.get("engine-card-1024")?.by === "player-0", JSON.stringify([...(det || [])]));
      // gone at Blue's next turn; until then another player's turn keeps it
      const later = (active, dt) => { const g2 = { ...gv, activePlayerId: active, turn: (gv.turn || 1) + dt }; h.B.logEvents(h.B.logSnapshot(g2), h.B.logSnapshot(g2), g2, null); };
      later("player-1", 1);
      ok("detain: kept through AI 1's turn", det.has("engine-card-1023") && det.has("engine-card-1024"), JSON.stringify([...det]));
      later("player-0", 2);
      ok("detain: over at Blue's next turn", det.size === 0, JSON.stringify([...det]));
      harness.restore();
    }
  }
  // sweep and live-check batch, checked 2026-11-10 (PLAN "Small sweep bugs" / "Live-check bugs"): the log fixes the
  // events test pinned alone, pinned here too, and the two gaps left (a rewind's step, a clash's result)
  {
    const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
    const blank = () => ({ turn: 3, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
      zones: ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) });
    const board = (fill) => { const b = blank(); fill(b); return b; };
    const zoneOf = (b, zone, ownerId) => b.zones.find((x) => x.zone === zone && x.ownerId === ownerId);
    const put = (b, zone, c, ownerId = "player-0") => { const z = zoneOf(b, zone, ownerId); z.cards.push(c); z.count = z.cards.length; };
    const counts = (b, hand, library, ownerId = "player-0") => { zoneOf(b, "hand", ownerId).count = hand; zoneOf(b, "library", ownerId).count = library; };
    const card = (n, name, types, extra = {}) => ({ id: `engine-card-${n}`, identity: { name }, types, controllerId: "player-0", ...extra });
    const ev = (seq, from, to, cardId, how, ownerId = "player-0", cause = {}) => ({ seq, ...(cardId ? { cardId } : {}), ...(from ? { from } : {}), to, ownerId, ...(how ? { how } : {}), ...cause });
    // two boards and Forge's events between them, as updateLog feeds logEvents
    const between = (before, after, events) => {
      const h = harness.load();
      setup(h, clone(F.board), { eventSeq: 10 });
      const lines = h.B.logEvents(h.B.logSnapshot(before), h.B.logSnapshot(after), after, h.B.engineFacts(events));
      harness.restore();
      return lines;
    };
    const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    // persist's -1/-1 counter on its return line (kw-10: "Kitchen Finks returns to the battlefield from White's graveyard
    // (White)"; undying's line names its +1/+1)
    const FINKS = card(1100, "Kitchen Finks", ["Creature"]);
    same("sweep: persist's return names its -1/-1 counter",
      between(board((b) => put(b, "graveyard", FINKS)), board((b) => put(b, "battlefield", { ...FINKS, counters: { M1M1: 1 } })), [ev(11, "Graveyard", "Battlefield", FINKS.id)]),
      ["Kitchen Finks returns to the battlefield from Blue's graveyard with a -1/-1 counter (Blue)"]);
    // the turn's header kept after the last turn's cleanup discard (live check 2026-11-07: "White discards Blasphemous
    // Act", "", "AI 1 draws a card"), with and without an attack on the same board
    const BEAR = card(1101, "Grizzly Bears", ["Creature"]);
    const atk = card(1102, "Hill Giant", ["Creature"], { controllerId: "player-1" });
    const nextTurn = (b, step) => Object.assign(b, { turn: 4, step, activePlayerId: "player-1", priorityPlayerId: "player-1" });
    const cleanup = [ev(11, "Hand", "Graveyard", BEAR.id, "discard"), ev(12, "Library", "Hand", null, "draw", "player-1")];
    same("live check: a cleanup discard on the next turn's board keeps that turn's header",
      between(board((b) => { counts(b, 8, 50); counts(b, 3, 50, "player-1"); put(b, "hand", BEAR); }),
        board((b) => { nextTurn(b, "draw"); counts(b, 7, 50); counts(b, 4, 49, "player-1"); put(b, "graveyard", BEAR); }), cleanup),
      ["Blue discards Grizzly Bears", "--- AI 1's turn 1 ---", "AI 1 draws a card"]);
    same("live check: a cleanup discard and an attack on the next turn's board keep the header and the attack",
      between(board((b) => { counts(b, 8, 50); counts(b, 3, 50, "player-1"); put(b, "hand", BEAR); put(b, "battlefield", atk, "player-1"); }),
        board((b) => { nextTurn(b, "declareAttackers"); counts(b, 7, 50); counts(b, 4, 49, "player-1"); put(b, "graveyard", BEAR); put(b, "battlefield", { ...atk, isAttacking: true, tapped: true }, "player-1"); }), cleanup),
      ["Blue discards Grizzly Bears", "--- AI 1's turn 1 ---", "AI 1 attacks with Hill Giant", "AI 1 draws a card"]);
    // forage's exile, its cost, before the draw it paid for, the card named once (live check 11: "White draws a card",
    // then "Island, Island, Island are exiled from White's graveyard (to pay for Treetop Sentries) with Treetop Sentries").
    // The cause is the harness's for a cost, "Cost:<part>", Forage's CostForage.
    const SENTRIES = card(1103, "Treetop Sentries", ["Creature"]);
    const ISLES = [1104, 1105, 1106].map((n) => card(n, "Island", ["Land"]));
    const forage = { cause: "Cost:Forage", causeName: "Treetop Sentries", causeCardId: SENTRIES.id };
    same("live check: forage's exile goes before its draw and names Treetop Sentries once",
      between(board((b) => { counts(b, 3, 50); put(b, "battlefield", SENTRIES); for (const c of ISLES) put(b, "graveyard", c); }),
        board((b) => { counts(b, 4, 49); put(b, "battlefield", SENTRIES); for (const c of ISLES) put(b, "exile", { ...c, exiledWith: SENTRIES.id }); }),
        [...ISLES.map((c, k) => ev(11 + k, "Graveyard", "Exile", c.id, null, "player-0", forage)), ev(14, "Library", "Hand", null, "draw")]),
      ["Island, Island, Island are exiled from Blue's graveyard (to pay for Treetop Sentries)", "Blue draws a card"]);
    // a rewind to a step the list doesn't offer says it in the table's words: onRewind takes any checkpoint's id, and the
    // chat read Forge's step name ("combatBegin"), the gap "Skip ended: combatBegin" had (live check 12)
    {
      const h = harness.load();
      const b = clone(F.board);
      Object.assign(b.gameView, { turn: 6, step: "main2", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [], checkpoints: [{ checkpointId: 40, turn: 6, step: "main1", activePlayerId: "player-0" }] });
      const seat = setup(h, b);
      seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: clone(b), fingerprint: "r1" }); await h.flush();
      const back = clone(b);
      Object.assign(back.gameView, { turn: 5, step: "combatBegin", activePlayerId: "player-1", priorityPlayerId: "player-1", checkpoints: [{ checkpointId: 30, turn: 5, step: "combatBegin", activePlayerId: "player-1" }] });
      const from = h.effects.length;
      seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: back, fingerprint: "r2" }); await h.flush();
      const said = h.effects.slice(from).filter((e) => e.tts && e.tts.t === "chat").map((e) => e.tts.text).filter((t) => /Rewound/.test(t));
      const logLines = h.effects.slice(from).filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines || []).filter((l) => /Rewound/.test(l));
      ok("rewind: a step outside the list is said in the table's words in the chat", JSON.stringify(said) === JSON.stringify(["[MTG] Rewound to turn 5 (beginning of combat)."]), JSON.stringify(said));
      ok("rewind: and in the log's line", JSON.stringify(logLines) === JSON.stringify(["--- Rewound to AI 1's turn (beginning of combat) ---"]), JSON.stringify(logLines));
      harness.restore();
    }
    // (and the vote's point, which the chat names to everyone: checkpointLabel)
    {
      const h = harness.load();
      const b = clone(F.board);
      Object.assign(b.gameView, { turn: 6, step: "main2", stack: [], checkpoints: [{ checkpointId: 30, turn: 5, step: "combatBegin", activePlayerId: "player-1" }],
        restoreVote: { voteId: 3, checkpoint: { checkpointId: 30, turn: 5, step: "combatBegin", activePlayerId: "player-1" }, requestedByPlayerId: "player-0", awaitingPlayerIds: [], status: { type: "pending" } } });
      setup(h, b);
      h.B.sendTable(); await h.flush();
      // (nobody left to ask, so Forge's vote is agreed at once: "Rewind to <point>: Agreed: rewinding...")
      const said = h.effects.filter((e) => e.tts && e.tts.t === "chat").map((e) => e.tts.text).filter((t) => /Rewind to/.test(t));
      ok("rewind: the vote names a step outside the list in the table's words", said.length === 1 && said[0].startsWith("[MTG] Rewind to turn 5, White's beginning of combat:"), JSON.stringify(said));
      harness.restore();
    }
    // a clash's cards and winner in the game log, once for the table (kw-07: no line named them). Forge's own words,
    // ClashEffect: "<player> reveals: <card>. Mana Value= <n>" a line each (lblReveals, lblCMC), then "<player> wins
    // clash." (lblWinsClash) or "No Winner!" (lblNoWinner); players by their engine names.
    {
      const h = harness.load();
      const seat = setup(h, clone(F.board));
      const white = new h.B.Seat("White", "neheb_minotaur_commander");
      white.slot = "player-1"; white.board = { state: clone(F.board), fingerprint: null };
      h.B._getGame().seats.set("White", white);
      const clash = (s, n, title) => { h.B.onPrompt(s, { promptId: n, decidingPlayerId: s.slot, sourceCard: { id: "engine-card-1107", identity: { name: "Lash Out" } },
        input: { type: "revealCards", zone: "library", ownerPlayerId: "player-0", cards: [card(1108, "Craw Wurm", ["Creature"])], presentation: { title } } }); return h.flush(); };
      const won = "tts-Blue-ab12 reveals: Craw Wurm. Mana Value= 6\nself-hosted-node-77-bot reveals: Forest. Mana Value= 0\ntts-Blue-ab12 wins clash.";
      await clash(seat, 910, won);
      const blueText = seat.prompt?.ui?.text;
      // (Forge asks each player in turn, ClashEffect -> GameAction.revealTo's loop: White's comes once Blue said OK, here
      // 10 s later)
      h.B._getGame().lastClash.at -= 10000;
      await clash(white, 911, won);
      const logged = () => h.effects.filter((e) => e.tts && e.tts.t === "gamelog").flatMap((e) => e.tts.lines || []).filter((l) => /^Clash/.test(l));
      const WON = "Clash (Lash Out): Blue reveals Craw Wurm (mana value 6), AI 1 reveals Forest (mana value 0). Blue wins.";
      ok("clash: the cards and the winner are logged, once for two seats asked 10 s apart", JSON.stringify(logged()) === JSON.stringify([WON]), JSON.stringify(logged()));
      ok("clash: the question still says it to the player as \"You\"", blueText === "You: Craw Wurm (6), AI 1: Forest (0). You win.", blueText);
      // (the second seat sits in slot player-1, whose table name here is "AI 1")
      ok("clash: and to the other player, the winner by name", white.prompt?.ui?.text === "Blue: Craw Wurm (6), You: Forest (0). Blue wins.", white.prompt?.ui?.text);
      // (a seat shown the same clash again: a new clash, the card kept on top revealed once more)
      await clash(seat, 913, won);
      ok("clash: the same cards again for the same seat are a new clash, logged", JSON.stringify(logged()) === JSON.stringify([WON, WON]), JSON.stringify(logged()));
      await clash(seat, 912, "tts-Blue-ab12 reveals: Island. Mana Value= 0\nself-hosted-node-77-bot reveals: Forest. Mana Value= 0\nNo Winner!");
      ok("clash: a tie says nobody wins", logged()[2] === "Clash (Lash Out): Blue reveals Island (mana value 0), AI 1 reveals Forest (mana value 0). Nobody wins.", JSON.stringify(logged()));
      // (the newest clash is the one remembered: White shown that tie next is the same clash, not logged again)
      await clash(white, 914, "tts-Blue-ab12 reveals: Island. Mana Value= 0\nself-hosted-node-77-bot reveals: Forest. Mana Value= 0\nNo Winner!");
      ok("clash: the newest clash is remembered for the next seat", logged().length === 3, JSON.stringify(logged()));
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
    // token attackers with their size, numbered when they still read the same, #9 before #10: "Spirit Token → Blue" four
    // times in the attack list, 2026-11-08/09 game (table-session.log)
    {
      const toks = Array.from({ length: 11 }, (_, k) => one(`engine-card-${1850 + k}`, "Spirit Token", { identity: { name: "Spirit Token", isToken: true } }));
      const { h, seat } = fresh((gv) => mine(gv).push(...toks, one("engine-card-1849", "Grizzly Bears", { power: 2, toughness: 2, counters: { P1P1: 1 } })));
      await asked(h, seat, { type: "chooseAttackers", attackers: [...toks, { id: "engine-card-1849" }].map((t) => ({ attackerId: t.id, validTargetIds: ["player-1"], mustAttack: false })) });
      const got = labels(seat);
      ok("attackers: a token says its size", got.includes("Spirit Token 1/1 #1 → AI 1"), JSON.stringify(got));
      ok("attackers: #9 comes before #10", got.indexOf("Spirit Token 1/1 #9 → AI 1") >= 0 && got.indexOf("Spirit Token 1/1 #9 → AI 1") < got.indexOf("Spirit Token 1/1 #10 → AI 1"), JSON.stringify(got));
      ok("attackers: a creature alone has no number, and its counters", got.includes("Grizzly Bears 2/2 [1 +1/+1 counter] → AI 1"), JSON.stringify(got));
      harness.restore();
    }
    // blockers numbered as the attackers (combat clarity 2026-11-11): two Spirit tokens blocking two Goblin tokens read
    // "Spirit Token 1/1 blocks Goblin Token" four times, and the table's confirmation of each read the same
    {
      const spirits = [0, 1].map((k) => one(`engine-card-${1870 + k}`, "Spirit Token", { identity: { name: "Spirit Token", isToken: true } }));
      const goblins = [0, 1].map((k) => one(`engine-card-${1875 + k}`, "Goblin Token", { identity: { name: "Goblin Token", isToken: true } }));
      const { h, seat } = fresh((gv) => mine(gv).push(...spirits, ...goblins, one("engine-card-1879", "Hill Giant", { power: 3, toughness: 3 })));
      await asked(h, seat, { type: "chooseBlockers", error: "", attackers: [...goblins.map((g) => ({ attackerId: g.id, validBlockerIds: spirits.map((s) => s.id), minBlockers: 0, mustBeBlocked: false })),
        { attackerId: "engine-card-1879", validBlockerIds: [spirits[0].id], minBlockers: 0, mustBeBlocked: false }] });
      const got = labels(seat);
      ok("blockers: same-named tokens are numbered on both sides, with their size", got.includes("Spirit Token 1/1 #1 blocks Goblin Token 1/1 #1") && got.includes("Spirit Token 1/1 #2 blocks Goblin Token 1/1 #2") && got.includes("Spirit Token 1/1 #2 blocks Goblin Token 1/1 #1"), JSON.stringify(got));
      ok("blockers: a creature alone has no number", got.includes("Spirit Token 1/1 #1 blocks Hill Giant 3/3"), JSON.stringify(got));
      ok("blockers: every line reads apart", new Set(got).size === got.length, JSON.stringify(got));
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
      // (verify 2026-11-07: no guessed reason; the engine's runaway cap doesn't reach the bridge)
      ok("kykar #16: an engine-ended draw says a draw, no guessed reason", said.length === 1 && said[0] === "[MTG] Game over: a draw.", JSON.stringify(said));
      h.B.sendTable(); await h.flush();
      const t = sent(h, "table").at(-1);
      ok("kykar #16: the table message carries how it ended", t?.gameOver && t?.overWhy === "a draw", JSON.stringify(t && [t.gameOver, t.overWhy]));
      const mark = h.effects.length;
      h.B.onTTS({ t: "rewind", json: JSON.stringify({ color: "Blue", checkpointId: 1 }) }); await h.flush();
      const refused = chats(h, mark);
      ok("kykar #16: a rewind after the end says the game has ended", refused.length === 1 && refused[0] === "[MTG] The game has ended (a draw), so it can't be rewound. Start a new game.", JSON.stringify(refused));
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
    // ── the independent check of the batch (verify 2026-11-07): a wrong name or reason is worse than none ──
    const emptyLibrary = (b, who) => { for (const z of b.gameView.zones) if (z.zone === "library" && who.includes(z.ownerId)) { z.cards = []; z.count = 0; } };
    // #16: two players out with empty libraries at once, the libraries the end board shows only (no earlier board had
    // them empty: verify 2026-11-09, a multiplayer loser's cards leave with them): no guessed reason, "a draw"
    {
      const { h, seat, b } = fresh(null, { gameOver: true, winnerId: null });
      for (const p of b.gameView.players) p.status = "lost";
      emptyLibrary(b, ["player-0", "player-1"]);
      seat.board = { state: b, fingerprint: null };
      await asked(h, seat, { type: "gameOver" });
      const said = chats(h).filter((t) => /Game over/.test(t));
      ok("verify #16: two libraries empty only at the end are no reason: a draw", said.length === 1 && said[0] === "[MTG] Game over: a draw.", JSON.stringify(said));
      harness.restore();
    }
    // a decked loser beside a winner (the library already empty on an earlier board, out in their own draw step,
    // noteOuts' record): the gameOver question, the top bar and a refused rewind all say it
    {
      const { h, seat, b } = fresh(null, { gameOver: true, winnerId: "player-1", step: "draw", activePlayerId: "player-0" });
      b.gameView.players.find((p) => p.id === "player-0").status = "lost";
      emptyLibrary(b, ["player-0"]);
      h.B._getGame().inLibrary = { "player-0": 0 };
      // (first seen empty in the upkeep, before the draw step it lost in: noteOuts' emptyAt)
      h.B._getGame().emptyAt = { "player-0": { turn: 1, step: "upkeep" } };
      seat.board = { state: b, fingerprint: null };
      await asked(h, seat, { type: "gameOver" });
      const said = chats(h).filter((t) => /Game over/.test(t));
      ok("verify #16: a decked loser beside the winner", said[0] === "[MTG] Game over: Blue drew from an empty library. AI 1 wins.", JSON.stringify(said));
      h.B.sendTable(); await h.flush();
      ok("verify #16: the top bar says the empty library too", sent(h, "table").at(-1)?.overWhy === "Blue drew from an empty library. AI 1 wins", JSON.stringify(sent(h, "table").at(-1)?.overWhy));
      const mark = h.effects.length;
      h.B.onTTS({ t: "rewind", json: JSON.stringify({ color: "Blue", checkpointId: 1 }) }); await h.flush();
      ok("verify #16: a refused rewind says the empty library", chats(h, mark)[0] === "[MTG] The game has ended (Blue drew from an empty library. AI 1 wins), so it can't be rewound. Start a new game.", JSON.stringify(chats(h, mark)));
      harness.restore();
    }
    // (a player still playing with an empty library once the game is over hasn't lost to it: a plain draw)
    {
      const { h, seat, b } = fresh(null, { gameOver: true, winnerId: null });
      for (const p of b.gameView.players) p.status = "playing";
      emptyLibrary(b, ["player-1"]);
      seat.board = { state: b, fingerprint: null };
      await asked(h, seat, { type: "gameOver" });
      ok("verify #16: an empty library of a player still playing isn't a reason", chats(h).filter((t) => /Game over/.test(t))[0] === "[MTG] Game over: a draw.", JSON.stringify(chats(h)));
      harness.restore();
    }
    // (a winner with an empty library won with it: Laboratory Maniac, Thassa's Oracle)
    {
      const { h, seat, b } = fresh(null, { gameOver: true, winnerId: "player-0" });
      b.gameView.players.find((p) => p.id === "player-0").status = "won";
      b.gameView.players.find((p) => p.id === "player-1").status = "lost";
      emptyLibrary(b, ["player-0"]);
      seat.board = { state: b, fingerprint: null };
      await asked(h, seat, { type: "gameOver" });
      ok("verify #16: the winner's empty library is no loss", chats(h).filter((t) => /Game over/.test(t))[0] === "[MTG] Game over: Blue wins.", JSON.stringify(chats(h)));
      harness.restore();
    }
    // (a concession is a reason, said by concededPlayers: LOSS_REASONS has none for it)
    {
      const { h, seat, b } = fresh(null, { gameOver: true, winnerId: "player-0" });
      b.gameView.players.find((p) => p.id === "player-1").status = "conceded";
      seat.board = { state: b, fingerprint: null };
      await asked(h, seat, { type: "gameOver" });
      ok("verify #16: a concession says so", chats(h).filter((t) => /Game over/.test(t))[0] === "[MTG] Game over: AI 1 conceded. Blue wins.", JSON.stringify(chats(h)));
      harness.restore();
    }
    // (the relay's abort of a board the engine says is over, with nothing to tell: "a draw", not "Game aborted.")
    {
      const { h, seat, b } = fresh(null, { gameOver: true, winnerId: null });
      seat.board = { state: b, fingerprint: null };
      seat.onRelay({ type: "GameAborted" }); await h.flush();
      ok("verify #16: an abort after the engine's end says it is over", JSON.stringify(chats(h).filter((t) => /^\[MTG\] Game/.test(t))) === JSON.stringify(["[MTG] Game over: a draw."]), JSON.stringify(chats(h)));
      harness.restore();
    }
    // #17: options whose sentence two cards share keep it bare (Parallel Lives and Anointed Procession print the same
    // one; Doubling Season's has it too); one only Mondrak has is named
    {
      const AP = "If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead.";
      const MO = "If one or more tokens would be created under your control, twice that many of those tokens are created instead.";
      const DS = `${AP}\nIf an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead.`;
      const ask17 = async (cards, options) => {
        const { h, seat } = fresh((gv) => mine(gv).push(...cards));
        await asked(h, seat, { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, presentation: { title: "Choose", targets: [] }, options: options.map((label) => ({ label, weight: 1, canRepeat: false })) },
          { sourceCard: { id: "engine-card-1209", identity: { name: "Kykar, Wind's Fury" } } });
        const got = labels(seat); harness.restore(); return got;
      };
      const ench = (id, name, text) => ({ id, identity: { name }, types: ["Enchantment"], controllerId: "player-0", text });
      const two = await ask17([ench("engine-card-1872", "Parallel Lives", AP), ench("engine-card-1870", "Anointed Procession", AP)], [AP, AP]);
      ok("verify #17: Parallel Lives + Anointed Procession: neither option is given a name", JSON.stringify(two) === JSON.stringify([AP, AP]), JSON.stringify(two));
      const three = await ask17([ench("engine-card-1873", "Doubling Season", DS), ench("engine-card-1870", "Anointed Procession", AP),
        { id: "engine-card-1871", identity: { name: "Mondrak, Glory Dominus" }, types: ["Artifact", "Creature"], controllerId: "player-0", text: `Flying\n${MO}` }], [MO, AP, AP]);
      ok("verify #17: Doubling Season + Anointed Procession + Mondrak: only Mondrak's is named", JSON.stringify(three) === JSON.stringify([`Mondrak, Glory Dominus: ${MO}`, AP, AP]), JSON.stringify(three));
      // (two of one card are one name: both named)
      const twins = await ask17([ench("engine-card-1870", "Anointed Procession", AP), ench("engine-card-1874", "Anointed Procession", AP)], [AP, AP]);
      ok("verify #17: two Anointed Processions are still one name", JSON.stringify(twins) === JSON.stringify([`Anointed Procession: ${AP}`, `Anointed Procession: ${AP}`]), JSON.stringify(twins));
      // (a card off the battlefield with the sentence doesn't count: an Anointed Procession in the hand names no option)
      const { h, seat } = fresh((gv) => gv.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0").cards.push(ench("engine-card-1875", "Anointed Procession", AP)));
      await asked(h, seat, { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, presentation: { title: "Choose", targets: [] }, options: [{ label: AP, weight: 1 }, { label: MO, weight: 1 }] },
        { sourceCard: { id: "engine-card-1209", identity: { name: "Kykar, Wind's Fury" } } });
      ok("verify #17: a card in a hand names no option", JSON.stringify(labels(seat)) === JSON.stringify([AP, MO]), JSON.stringify(labels(seat)));
      harness.restore();
      // (one option that isn't a replacement: not this question)
      const mixed = fresh();
      await asked(mixed.h, mixed.seat, { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, presentation: { title: "Choose", targets: [] }, options: [{ label: AP, weight: 1 }, { label: "Draw a card", weight: 1 }] },
        { sourceCard: { id: "engine-card-1209", identity: { name: "Kykar, Wind's Fury" } } });
      ok("verify #17: every option must be a replacement for 'which applies first?'", mixed.seat.prompt?.ui?.title !== "Kykar, Wind's Fury: which applies first?", mixed.seat.prompt?.ui?.title);
      harness.restore();
    }
    // #4: City of Brass's tap trigger is its damage; Tomb of Urami's conditional damage says nothing; another card's
    // "becomes tapped" isn't this one's (Arcane Spyglass is made up: the guard is for a sentence about any creature);
    // Tarnished Citadel's {C} never takes its any-colour line's damage, whatever its ability number (Forge's mana-ability
    // index, which needn't follow the text's lines). Card texts from Forge's cardsfolder.
    {
      const land = (id, name, text) => ({ id, identity: { name }, types: ["Land"], controllerId: "player-0", text });
      const { h, seat } = fresh((gv) => mine(gv).push(
        land("engine-card-1401", "City of Brass", "Whenever City of Brass becomes tapped, it deals 1 damage to you.\n{T}: Add one mana of any color."),
        land("engine-card-1402", "Tomb of Urami", "{T}: Add {B}. Tomb of Urami deals 1 damage to you if you don't control an Ogre.\n{2}{B}{B}, {T}, Sacrifice all lands you control: Create Urami, a legendary 5/5 black Demon Spirit creature token with flying."),
        land("engine-card-1403", "Tarnished Citadel", "{T}: Add {C}.\n{T}: Add one mana of any color. Tarnished Citadel deals 3 damage to you."),
        { id: "engine-card-1404", identity: { name: "Arcane Spyglass" }, types: ["Artifact"], controllerId: "player-0", text: "{T}: Add {U}.\nWhenever a creature becomes tapped, it deals 1 damage to you." }));
      await asked(h, seat, { type: "payManaCost", manaCost: "{3}{B}", presentation: { title: "Pay {3}{B}" }, actions: [
        { id: "tap:engine-card-1401:0:W", cardId: "engine-card-1401", abilityIndex: 0, description: "City of Brass", cost: "{T}", producedMana: [{ amount: 1, color: "W" }] },
        { id: "tap:engine-card-1402:0", cardId: "engine-card-1402", abilityIndex: 0, description: "Tomb of Urami", cost: "{T}", producedMana: [{ amount: 1, color: "B" }] },
        { id: "tap:engine-card-1403:1", cardId: "engine-card-1403", abilityIndex: 1, description: "Tarnished Citadel", cost: "{T}", producedMana: [{ amount: 1, color: "C" }] },
        { id: "tap:engine-card-1404:0", cardId: "engine-card-1404", abilityIndex: 0, description: "Arcane Spyglass", cost: "{T}", producedMana: [{ amount: 1, color: "U" }] }] },
        { sourceCard: { id: "engine-card-43", identity: { name: "Vraska's Fall" } } });
      const got = labels(seat);
      ok("verify #4: City of Brass says its tap damage", got.includes("Tap City of Brass for {W} (1 damage to you)"), JSON.stringify(got));
      ok("verify #4: Tomb of Urami's damage under a condition says nothing", got.includes("Tap Tomb of Urami for {B}"), JSON.stringify(got));
      ok("verify #4: Tarnished Citadel's {C} has no damage, whatever its ability number", got.includes("Tap Tarnished Citadel for {C}"), JSON.stringify(got));
      ok("verify #4: another card's 'a creature becomes tapped' isn't this card's", got.includes("Tap Arcane Spyglass for {U}"), JSON.stringify(got));
      harness.restore();
    }
    // a tap that can pay none of what is owed isn't offered: Viscera Seer's {B} offered only "Tap Mountain for {R}" after
    // Auto-pay, and Yellow tapped and undid it in a loop until Cancel (2026-11-09 00:51, table-session.log #695-#699);
    // Treasure for {W} was offered for it too (#701). Real action shapes (dump2's fixtures).
    {
      const land = (id, name, text) => ({ id, identity: { name }, types: ["Land"], controllerId: "player-0", text });
      const tap = (id, color, extra = {}) => ({ id: `tap:${id}:0${extra.suffix || ""}`, type: "activateManaAbility", isManaAbility: true, cardId: id, abilityIndex: 0, description: extra.name || "Mountain", cost: extra.cost || "{T}", producedMana: [{ amount: 1, color }] });
      const pay = async (manaCost, actions, extra = {}) => {
        const { h, seat } = fresh((gv) => mine(gv).push(land("engine-card-1460", "Mountain", "{T}: Add {R}."),
          { id: "engine-card-1461", identity: { name: "Treasure", isToken: true }, types: ["Artifact"], controllerId: "player-0", text: "{T}, Sacrifice this artifact: Add one mana of any color." },
          land("engine-card-1462", "Snow-Covered Mountain", "{T}: Add {R}.")));
        seat.autoPayCard = extra.autoRan ? "engine-card-1470" : null;
        await asked(h, seat, { type: "payManaCost", cardId: "engine-card-1470", cardName: "Viscera Seer", manaCost, canConfirmFromPool: false, actions },
          { sourceCard: { id: "engine-card-1470", identity: { name: "Viscera Seer" } } });
        const out = { got: labels(seat), text: seat.prompt?.ui?.text || "" };
        harness.restore();
        return out;
      };
      const mountain = tap("engine-card-1460", "R");
      let r = await pay("{B}", [mountain], { autoRan: true });
      ok("useless tap: Mountain's {R} isn't offered for {B}", !r.got.some((l) => /Mountain/.test(l)) && r.got.includes("Cancel"), JSON.stringify(r.got));
      ok("useless tap: and the player is told why", r.text === "Nothing here can pay {B}: Mountain can't make that mana. Cancel to take it back.", r.text);
      const treasure = ["W", "B"].map((c) => tap("engine-card-1461", c, { name: "Treasure", cost: "{T}, Sacrifice this artifact", suffix: `:${c}` }));
      r = await pay("{B}", [mountain, ...treasure]);
      ok("useless tap: Treasure for {W} isn't offered for {B}, its {B} is", !r.got.some((l) => /for \{W\}/.test(l)) && r.got.some((l) => /Treasure for \{B\}/.test(l)), JSON.stringify(r.got));
      ok("useless tap: nothing said while something can pay", !r.text.startsWith("Nothing here"), r.text);
      r = await pay("{1}{B}", [mountain]);
      ok("useless tap: a generic part keeps it", r.got.some((l) => /Mountain/.test(l)), JSON.stringify(r.got));
      r = await pay("{S}", [tap("engine-card-1462", "R", { name: "Snow-Covered Mountain" })]);
      ok("useless tap: a snow cost keeps every tap", r.got.some((l) => /Snow-Covered Mountain/.test(l)), JSON.stringify(r.got));
      r = await pay("{R/W}", [mountain]);
      ok("useless tap: a hybrid half it makes keeps it", r.got.some((l) => /Mountain/.test(l)), JSON.stringify(r.got));
    }
    // #18: "halflingses" against Saradoc's "Halflings"; a singular in -us ("Fungus") keeps its plural "Funguses"; a -ses
    // word the card's own text has stays (no printed card has both forms, Forge's cardsfolder: a made-up card for the guard)
    {
      const ab = async (name, text, description) => {
        const { h, seat } = fresh((gv) => mine(gv).push({ id: "engine-card-1450", identity: { name }, types: ["Artifact"], controllerId: "player-0", text }));
        await asked(h, seat, { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" }, { id: "a1", type: "activateAbility", cardId: "engine-card-1450", abilityIndex: 1, isManaAbility: false, description, cost: "{1}" }] });
        const got = labels(seat).find((l) => l.startsWith(`${name}:`)); harness.restore(); return got;
      };
      const half = await ab("Saradoc, Master of Buckland", "Whenever Saradoc, Master of Buckland or another nontoken creature you control with power 2 or less enters, create a 1/1 white Halfling creature token.\nTap two other untapped Halflings you control: Saradoc gets +2/+0 and gains lifelink until end of turn. Activate only once each turn.",
        "Tap two other untapped halflingses you control: Saradoc gets +2/+0 and gains lifelink until end of turn.");
      ok("verify #18: the doubled plural is undone whatever its case", /Tap two other untapped halflings you control/.test(half || ""), half);
      const fungus = await ab("Fungal Bloom", "{G}{G}: Put a spore counter on target Fungus.", "{G}{G}: Put a spore counter on each of two target Funguses.");
      ok("verify #18: a singular in -us keeps its plural", /two target Funguses/.test(fungus || ""), fungus);
      const lens = await ab("Lens Keeper", "{1}, Tap two untapped Lenses you control: Lens Keeper deals 1 damage to any target.", "{1}, Tap two untapped Lenses you control: Lens Keeper deals 1 damage to any target.");
      ok("verify #18: a -ses word the card's own text has stays", /Tap two untapped Lenses you control/.test(lens || ""), lens);
    }
    // #23: "one or two target" and "one, two, or three target" aren't rewritten into "one or which"
    {
      for (const [name, text] of [["Armament Corps", "When Armament Corps enters, distribute two +1/+1 counters among one or two target creatures you control."],
        ["Aberrant Return", "Put one, two, or three target creature cards from graveyards onto the battlefield under your control. Each of them enters with an additional -1/-1 counter on it."]]) {
        const { h, seat } = fresh((gv) => mine(gv).push(one("engine-card-1460", "Grizzly Bears", { power: 2, toughness: 2 })));
        await asked(h, seat, { type: "chooseBoardTargets", minTargets: 1, maxTargets: 2, chosenTargets: 0, intent: "pump", candidates: [{ kind: "card", id: "engine-card-1460" }], presentation: { title: "Pump", targets: [] } },
          { sourceCard: { id: "engine-card-1461", identity: { name }, text }, sourceAbilityText: text });
        ok(`verify #23: ${name}'s range isn't garbled`, !/\bor which\b|, which\b/.test(seat.prompt?.ui?.title || ""), seat.prompt?.ui?.title);
        harness.restore();
      }
    }
    // #5 #24: one real source left once Forge's headings are gone is picked, and the chat says it is the source
    {
      const { h, seat } = fresh((gv) => mine(gv).push(one("engine-card-1470", "Grizzly Bears", { power: 2, toughness: 2 })));
      await asked(h, seat, { type: "chooseCards", min: 1, max: 1, presentation: { title: "Deflecting Palm", description: "Choose a source " },
        cards: [{ id: "engine-card-1471", identity: { name: "--PERMANENTS:--", setCode: "???" } }, { ...one("engine-card-1470", "Grizzly Bears", { power: 2, toughness: 2 }), zone: "battlefield", ownerId: "player-0" }] },
        { sourceCard: { id: "engine-card-1807", identity: { name: "Deflecting Palm" } }, sourceAbilityText: "The next time a source of your choice would deal damage to you this turn, prevent that damage." });
      const said = chats(h).filter((t) => /only choice/.test(t));
      ok("verify #5 #24: the one real source is picked and the chat names it as the source", said.length === 1 && said[0] === "[MTG] Deflecting Palm: the source is Grizzly Bears 2/2 (the only choice)", JSON.stringify(said));
      harness.restore();
    }
    // #5: a real choice that starts with dashes is no heading (Forge's two piles read "-- Pile 1 (2 cards) --"), and a
    // heading among a selection's labels is never an option
    {
      const { h, seat } = fresh();
      await asked(h, seat, { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, presentation: { title: "Fact or Fiction", targets: [] }, options: [{ label: "-- Pile 1 (2 cards) --", weight: 1 }, { label: "-- Pile 2 (3 cards) --", weight: 1 }] },
        { sourceCard: { id: "engine-card-1480", identity: { name: "Fact or Fiction" } } });
      ok("verify #5: dashes alone are no heading", labels(seat).length === 2, JSON.stringify(labels(seat)));
      harness.restore();
    }
    {
      const { h, seat } = fresh();
      await asked(h, seat, { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, presentation: { title: "Choose", targets: [] }, options: [{ label: "--CARDS ON BATTLEFIELD:--", weight: 1 }, { label: "Grizzly Bears", weight: 1 }, { label: "Serra Angel", weight: 1 }] },
        { sourceCard: { id: "engine-card-1481", identity: { name: "Some Card" } } });
      ok("verify #5: a heading among a selection's labels is no option", JSON.stringify(labels(seat).filter((l) => /--/.test(l))) === "[]" && labels(seat).length === 2, JSON.stringify(labels(seat)));
      harness.restore();
    }
    // INV-6: two alike cards in two players' graveyards say whose
    {
      const { h, seat } = fresh();
      await asked(h, seat, { type: "chooseCards", min: 1, max: 1, presentation: { title: "Choose a card", description: "Choose a card" },
        cards: [{ id: "engine-card-1490", identity: { name: "Lightning Bolt" }, types: ["Instant"], zone: "graveyard", ownerId: "player-0" }, { id: "engine-card-1491", identity: { name: "Lightning Bolt" }, types: ["Instant"], zone: "graveyard", ownerId: "player-1" }] },
        { sourceCard: { id: "engine-card-1492", identity: { name: "Some Card" } } });
      const got = labels(seat);
      ok("verify INV-6: alike cards in two graveyards say whose", got.some((l) => /yours/.test(l)) && got.some((l) => /AI 1's/.test(l)), JSON.stringify(got));
      harness.restore();
    }
    // probe extra: X is the power (an Esper Sentinel made 3/1 by an equipment), not the toughness
    {
      const { h, seat } = fresh();
      const text = "Whenever an opponent casts their first noncreature spell each turn, draw a card unless that player pays {X}, where X is Esper Sentinel's power.";
      await asked(h, seat, { type: "chooseBoolean", confirmLabel: "Pay", denyLabel: "Decline", presentation: { title: "Pay {X}?", text: "otherwise: \"AI 1 draws a card.\"" } },
        { sourceAbilityText: text, sourceCard: { id: "engine-card-1244", identity: { name: "Esper Sentinel" }, power: "3", toughness: "1", controllerId: "player-1", text } });
      ok("verify probe: X is Esper Sentinel's power, not its toughness", seat.prompt?.ui?.title === "Esper Sentinel: pay {3}?", seat.prompt?.ui?.title);
      harness.restore();
    }
    // #20: a candidate both halves could target (an artifact enchantment) names no half
    {
      const FUSE = "Fuse (You may cast one or both halves of this card from your hand.)";
      const text = `(Wear) Destroy target artifact.\n${FUSE}\r\n\r\n(Tear) Destroy target enchantment.\n${FUSE}`;
      const { h, seat } = fresh((gv) => gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1").cards.push(
        { id: "engine-card-1955", identity: { name: "Chief of the Foundry's Shrine" }, types: ["Artifact", "Enchantment"], controllerId: "player-1" }));
      await asked(h, seat, { type: "chooseBoardTargets", minTargets: 1, maxTargets: 1, chosenTargets: 0, intent: "destroy", candidates: [{ kind: "card", id: "engine-card-1955" }], presentation: { title: "Destroy", targets: [] } },
        { sourceCard: { id: "engine-card-1956", identity: { name: "Wear // Tear" }, text }, sourceAbilityText: FUSE });
      ok("verify #20: a target both halves fit names no half", !/^(?:Wear|Tear):/.test(seat.prompt?.ui?.title || ""), seat.prompt?.ui?.title);
      harness.restore();
    }
  }
  // ── live reports 2026-11-08 (an X/X token with no badge, every player's Plains in one printing, a concession read as
  // an empty library) and the verifier's 2026-11-09 findings (multiplayer losers read as decked, "two Lens") ──
  {
    const bfOf = (b, owner = "player-0") => b.gameView.zones.find((z) => z.zone === "battlefield" && z.ownerId === owner).cards;
    const W = "https://img.klrmngr.com/display/front/9/d/9d447365-3aca-4996-9098-efcbe6f28f57.webp";
    const token = (extra = {}) => ({ id: "engine-card-950", identity: { name: "Dinosaur Beast Token", isToken: true }, types: ["Creature"], color: "G",
      power: "6", toughness: "6", basePower: 6, baseToughness: 6, printedPower: null, printedToughness: null, controllerId: "player-0", ownerId: "player-0", ...extra });
    // bug 1: bp/bt are the picture's numbers, null when it shows none
    {
      // (a picture found by name only: Scryfall's */* Dinosaur Beast, the same for the 4/4, 6/6 and 18/18)
      const h = harness.load({ imageCache: { "token:Dinosaur Beast|6/6|g": { face: W, back: null, pow: null, tou: null } } });
      setup(h, F.board);
      const c = h.B.tableCard(token());
      ok("live bug 1: an X/X token whose picture was found by name has no base (bp/bt null)", c.f === W && c.bp === null && c.bt === null, JSON.stringify([c.f, c.bp, c.bt]));
      harness.restore();
    }
    {
      const h = harness.load({ imageCache: { "token:Dinosaur Beast|6/6|g": { face: W, back: null, pow: "6", tou: "6" },
        "token:Kelp|0/1|u": { face: W, back: null, pow: "0", tou: "1" }, "token:Ooze|3/3|g": { face: W, back: null, pow: "*", tou: "*" } } });
      setup(h, F.board);
      const c = h.B.tableCard(token());
      ok("live bug 1: a picture found by its P/T says it (bp/bt 6/6)", c.bp === 6 && c.bt === 6, JSON.stringify([c.bp, c.bt]));
      const kelp = h.B.tableCard(token({ identity: { name: "Kelp Token", isToken: true }, color: "U", power: "0", toughness: "1", basePower: 0, baseToughness: 1 }));
      ok("live bug 1: a 0/1 picture is a base of 0/1, not none", kelp.bp === 0 && kelp.bt === 1, JSON.stringify([kelp.bp, kelp.bt]));
      const ooze = h.B.tableCard(token({ identity: { name: "Ooze Token", isToken: true }, power: "3", toughness: "3", basePower: null, baseToughness: null }));
      ok("live bug 1: a picture printed */* is no base", ooze.f === W && ooze.bp === null && ooze.bt === null, JSON.stringify([ooze.f, ooze.bp, ooze.bt]));
      harness.restore();
    }
    {
      // (an entry from before the P/T was kept is looked up again; with no picture there is no base)
      const h = harness.load({ imageCache: { "token:Dinosaur Beast|6/6|g": { face: W, back: null } } });
      setup(h, F.board);
      const c = h.B.tableCard(token());
      ok("live bug 1: an old cache entry is asked for again, and no picture is no base", c.f === null && c.bp === null && c.bt === null, JSON.stringify([c.f, c.bp, c.bt]));
      await h.flush();
      ok("live bug 1: the old entry was searched for again", h.effects.some((e) => e.fetch && e.fetch.includes("/cards/search") && e.fetch.includes("Dinosaur")), "no search");
      // (a token with no picture yet shows a card back: its printed numbers aren't on it)
      const back = h.B.tableCard(token({ identity: { name: "Soldier Token", isToken: true }, color: "W", power: "1", toughness: "1", basePower: 1, baseToughness: 1, printedPower: 1, printedToughness: 1 }));
      ok("live bug 1: a token with no picture has no base, whatever Forge printed", back.f === null && back.bp === null && back.bt === null, JSON.stringify([back.f, back.bp, back.bt]));
      harness.restore();
    }
    {
      // the search: the P/T is kept from the search that asked for it, never from a name-only one
      for (const [label, exactHits, want] of [["the P/T search", true, ["6", "6"]], ["a name-only search", false, [null, null]]]) {
        const h = harness.load();
        setup(h, F.board);
        const f0 = global.fetch;
        global.fetch = async (u, o) => {
          if (!String(u).includes("/cards/search")) return f0(u, o);
          const exact = String(u).includes(encodeURIComponent("pow=6"));
          const data = exact ? (exactHits ? [{ id: "aaaaaaaa-0000-0000-0000-000000000001", power: "6", toughness: "6" }] : [])
            : [{ id: "bbbbbbbb-0000-0000-0000-000000000002", power: "4", toughness: "4" }];
          return { ok: data.length > 0, status: data.length ? 200 : 404, json: async () => ({ data }) };
        };
        h.B.tableCard(token()); await h.flush();
        const c = h.B.tableCard(token());
        ok(`live bug 1: a picture from ${label} has base ${JSON.stringify(want)}`, c.f && JSON.stringify([c.bp, c.bt]) === JSON.stringify(want.map((x) => (x == null ? null : Number(x)))), JSON.stringify([c.f, c.bp, c.bt]));
        harness.restore();
      }
    }
    {
      const h = harness.load();
      setup(h, F.board);
      const card = (extra) => h.B.tableCard({ id: "engine-card-951", identity: { name: "Grizzly Bears" }, types: ["Creature"], power: "2", toughness: "2", controllerId: "player-0", ownerId: "player-0", ...extra });
      const bears = card({ basePower: 2, baseToughness: 2, printedPower: 2, printedToughness: 2 });
      ok("live bug 1: a card's base is its printed P/T", bears.bp === 2 && bears.bt === 2, JSON.stringify([bears.bp, bears.bt]));
      const goyf = card({ identity: { name: "Tarmogoyf" }, power: "3", toughness: "4", basePower: 0, baseToughness: 1 });
      ok("live bug 1: a card with no numeric printed P/T has no base (not Forge's base 0/1)", goyf.bp === null && goyf.bt === null, JSON.stringify([goyf.bp, goyf.bt]));
      const roots = card({ identity: { name: "Wall of Roots" }, power: "0", toughness: "5", basePower: 0, baseToughness: 5, printedPower: 0, printedToughness: 5 });
      ok("live bug 1: a printed 0 is a base of 0", roots.bp === 0 && roots.bt === 5, JSON.stringify([roots.bp, roots.bt]));
      const morph = h.B.tableCard({ id: "engine-card-952", identity: { name: "Secret" }, isFaceDown: true, types: ["Creature"], power: 2, toughness: 2, controllerId: "player-0" });
      ok("live bug 1: a face-down permanent's base is the rules' 2/2", morph.fd && morph.bp === 2 && morph.bt === 2, JSON.stringify(morph));
      const foretold = h.B.tableCard({ id: "engine-card-953", identity: { name: "Secret" }, isFaceDown: true, types: ["Instant"], controllerId: "player-0" });
      ok("live bug 1: a face-down card with no P/T has no base", foretold.bp === undefined && foretold.bt === undefined, JSON.stringify(foretold));
      harness.restore();
    }
    // bug 2: each deck's own printings, by owner, the same face for an engine card every time
    {
      const W1 = "https://img.klrmngr.com/display/front/1/1/11111111-0000-0000-0000-00000000000a.webp";
      const B1 = "https://img.klrmngr.com/display/front/2/2/22222222-0000-0000-0000-00000000000b.webp";
      const B2 = "https://img.klrmngr.com/display/front/3/3/33333333-0000-0000-0000-00000000000c.webp";
      const cmd = "https://img.klrmngr.com/display/front/4/4/44444444-0000-0000-0000-00000000000d.webp";
      const decks = { White: { deckName: "W", commander: [{ n: "Neheb, the Eternal", f: cmd }], library: [{ n: "Plains", f: W1 }, { n: "Plains", f: W1 }] },
        Blue: { deckName: "B", commander: [{ n: "Neheb, the Eternal", f: cmd }], library: [{ n: "Plains", f: B1 }, { n: "Plains", f: B2 }, { n: "Plains", f: B1 }, { n: "Island", f: B2 }] } };
      const plains = (id, ownerId, extra = {}) => ({ id, identity: { name: "Plains" }, types: ["Land"], supertypes: ["Basic"], controllerId: ownerId, ownerId, ...extra });
      const h = harness.load();
      // (slotColor: player-0 Blue, player-1 White)
      setup(h, F.board);
      // (White readied first: it was White's printing everyone got)
      h.B.onTTS({ t: "decks", json: JSON.stringify({ seats: decks }) }); await h.flush();
      const faces = (ids, owner, extra) => ids.map((id) => h.B.tableCard(plains(id, owner, extra)).f);
      const blue = faces(["engine-card-10", "engine-card-11", "engine-card-12", "engine-card-13"], "player-0");
      ok("live bug 2: a Blue-owned Plains never shows White's printing", blue.every((f) => f === B1 || f === B2), JSON.stringify(blue));
      ok("live bug 2: two Blue Plains show B1 and B2", new Set(blue.slice(0, 2)).size === 2, JSON.stringify(blue));
      ok("live bug 2: a White Plains shows White's", faces(["engine-card-20", "engine-card-21"], "player-1").every((f) => f === W1));
      const again = faces(["engine-card-10", "engine-card-11", "engine-card-12", "engine-card-13"], "player-0");
      ok("live bug 2: every Plains keeps its face on every board", JSON.stringify(again) === JSON.stringify(blue), JSON.stringify([blue, again]));
      // (stolen: controlled by White, owned by Blue; a token copy goes by its owner too)
      const stolen = h.B.tableCard(plains("engine-card-10", "player-0", { controllerId: "player-1" })).f;
      ok("live bug 2: a stolen card keeps its owner's printing", stolen === blue[0], JSON.stringify([stolen, blue[0]]));
      const copy = h.B.tableCard(plains("engine-card-30", "player-1", { identity: { name: "Plains", isToken: true } })).f;
      ok("live bug 2: a token copy shows its owner's printing", copy === W1, copy);
      // (an owner's deck without the card falls back to another deck's)
      const neheb = h.B.tableCard({ id: "engine-card-40", identity: { name: "Neheb, the Eternal" }, types: ["Creature"], controllerId: "player-1", ownerId: "player-1" }).f;
      ok("live bug 2: a card in the owner's deck only, from the owner's deck", neheb === cmd, neheb);
      const fall = h.B.tableCard({ id: "engine-card-41", identity: { name: "Plains" }, types: ["Land"], controllerId: "player-2", ownerId: "player-2" }).f;
      ok("live bug 2: an owner with no deck of it falls back to a deck that has it", fall === W1 || fall === B1 || fall === B2, fall);
      // (White's deck has no Island; Blue's does)
      const island = h.B.tableCard({ id: "engine-card-42", identity: { name: "Island" }, types: ["Land"], controllerId: "player-1", ownerId: "player-1" }).f;
      ok("live bug 2: a card the owner's deck lacks comes from another deck", island === B2, island);
      // (a question shows the card as the table does)
      ok("live bug 2: a question's picture is the table's printing", h.B.imgOf(plains("engine-card-11", "player-0")) === blue[1], h.B.imgOf(plains("engine-card-11", "player-0")));
      // (and a spell on the stack shows its card's: Blue's engine-card-11, not the first deck's; the stack item's own id
      // is another number, as the engine's engine-stack-N beside engine-card-N, and would pick the other printing)
      {
        const gv = h.B._getGame().seats.get("Blue").board.state.gameView;
        gv.stack = [{ id: "engine-stack-2", sourceId: "engine-card-11", ownerId: "player-0", controllerId: "player-0", identity: { name: "Plains" }, text: "", targets: [] }];
        h.B.sendTable(); await h.flush();
        const st = sent(h, "table").at(-1)?.stack?.[0]?.f;
        ok("live bug 2: a spell on the stack shows its card's printing", st === blue[1] || st === h.B.shortUrl(blue[1]), st);
        gv.stack = [];
      }
      // a restarted bridge: the game's pictures come back with the resume file, and every Plains keeps its face
      const fsm = require("fs");
      const w0 = fsm.writeFile;
      let snapText = null;
      fsm.writeFile = (p, d, ...rest) => { if (/mtg-bridge-game-test\.json\.tmp$/.test(String(p))) snapText = String(d); return w0(p, d, ...rest); };
      const g = h.B._getGame();
      g.started = false;
      const seat = g.seats.get("Blue");
      h.B.onGameStarted({ player_order: [seat.username, "self-hosted-node-77-bot"], starting_life: 40, game_id: "g1" }); await h.flush();
      fsm.writeFile = w0;
      ok("live bug 2: the resume file holds the decks' pictures", !!snapText && JSON.parse(snapText).game.pictures?.Blue?.Plains?.length === 2, String(snapText).slice(0, 200));
      harness.restore();
      const h2 = harness.load();
      await require("fs").promises.writeFile(process.env.MTG_RESUME_FILE, snapText);
      const resumed = h2.B.resumeGame();
      const after = ["engine-card-10", "engine-card-11", "engine-card-12", "engine-card-13"].map((id) => h2.B.tableCard(plains(id, "player-0")).f);
      await require("fs").promises.unlink(process.env.MTG_RESUME_FILE).catch(() => {});
      ok("live bug 2: after a bridge restart every Plains shows the face it had", resumed && JSON.stringify(after) === JSON.stringify(blue), JSON.stringify([resumed, after, blue]));
      harness.restore();
    }
    // verifier 2026-11-09 #3: a printing whose link turns out dead mid-game moves only the cards that showed it
    {
      const P1 = "https://img.klrmngr.com/display/front/6/6/66666666-0000-0000-0000-00000000000e.webp";
      const PX = "https://img.klrmngr.com/display/front/7/7/dead7777-gone.webp";
      const P3 = "https://img.klrmngr.com/display/front/8/8/88888888-0000-0000-0000-00000000000f.webp";
      const cmd = "https://img.klrmngr.com/display/front/4/4/44444444-0000-0000-0000-00000000000d.webp";
      const h = harness.load();
      setup(h, F.board);
      h.B.onTTS({ t: "decks", json: JSON.stringify({ seats: { Blue: { deckName: "B", commander: [{ n: "Neheb, the Eternal", f: cmd }],
        library: [{ n: "Plains", f: P1 }, { n: "Plains", f: PX }, { n: "Plains", f: P3 }] } } }) });
      const ids = ["engine-card-9", "engine-card-10", "engine-card-11", "engine-card-12", "engine-card-13", "engine-card-14"];
      const faces = () => ids.map((id) => h.B.tableCard({ id, identity: { name: "Plains" }, types: ["Land"], controllerId: "player-0", ownerId: "player-0" }).f);
      // (before the image host has answered the deck's check, the dead link is still in use)
      const before = faces();
      await h.flush();
      const after = faces();
      ok("verify #3: precondition, the link was in use before the image host said it was dead", before.includes(PX) && before.includes(P1) && before.includes(P3), JSON.stringify(before));
      ok("verify #3: a card whose printing is still there keeps it when another printing's link dies", before.every((f, i) => f === PX || after[i] === f), JSON.stringify([before, after]));
      ok("verify #3: a card that showed the dead link shows the next printing in the deck's list", before.every((f, i) => f !== PX || after[i] === P3), JSON.stringify([before, after]));
      ok("verify #3: the dead link isn't shown", !after.includes(PX), JSON.stringify(after));
      harness.restore();
    }
    // verifier 2026-11-09 #2: an AI plays the table deck from Yellow's seat; the bots join in either order, and the one
    // given that deck (the node's first bot, "<name>") sits at Red or at Yellow. Its cards show that deck's printing, not
    // White's (the first deck by table colour) nor the deck lying unused in Red's seat. White and Blue are players.
    // (third case: an "mtg aideck" preset comes first, so Yellow's deck is the second bot's, "<name> 2")
    for (const [label, joined, aideck] of [["sits at Red", ["self-hosted-node-77-bot", "self-hosted-node-77-bot 2"]], ["sits at Yellow", ["self-hosted-node-77-bot 2", "self-hosted-node-77-bot"]],
      ["sits at Red behind a preset", ["self-hosted-node-77-bot 2", "self-hosted-node-77-bot"], true]]) {
      const pic = (n) => `https://img.klrmngr.com/display/front/${n}/${n}/${String(n).repeat(8)}-0000-0000-0000-000000000001.webp`;
      const [W1, B1, Y1, R1, cmd] = [1, 2, 3, 5, 4].map(pic);
      const deck = (name, plains) => ({ deckName: name, commander: [{ n: "Neheb, the Eternal", f: cmd }], library: [{ n: "Plains", f: plains }] });
      const h = harness.load();
      const white = new h.B.Seat("White", "neheb_minotaur_commander"), blue = new h.B.Seat("Blue", "neheb_minotaur_commander");
      for (const s of [white, blue]) { s.joined = true; s.roomId = "room-1"; }
      h.B.onTTS({ t: "decks", json: JSON.stringify({ seats: { White: deck("W", W1), Blue: deck("B", B1), Yellow: deck("Y", Y1), Red: deck("R", R1) } }) }); await h.flush();
      const ready = h.B._readyDecks;
      h.B._setGame({ seats: new Map([["White", white], ["Blue", blue]]), bots: 2, total: 4, playerOrder: [], slotNames: {}, slotColor: {}, started: false, closing: false,
        fromTable: true, sentStatic: {}, sentZones: {}, maxSet: true, startSent: true, botsRequested: false, pendingPlays: [],
        aiTableDecks: [{ deckName: ready.Yellow.deckName, deck: { cards: [], commanders: [] }, commanderName: null }], aiTableColors: ["Yellow"] });
      if (aideck) { h.B.onTTS({ t: "aideck", json: JSON.stringify({ deck: "ai_passive_lands" }) }); await h.flush(); }
      h.B.onRoomUpdate(white, { room_id: "room-1", host: white.username, status: "Lobby", max_players: 4,
        players: [white.username, blue.username, ...joined].map((username) => ({ username, ready: true, connected: true, is_bot: /bot/.test(username) })) });
      await h.flush();
      if (aideck) { h.B.onTTS({ t: "aideck", json: JSON.stringify({ deck: "clear" }) }); await h.flush(); }
      // (clockwiseOrder: the bots take Red then Yellow in the order they joined)
      const order = [white.username, joined[0], joined[1], blue.username];
      h.B.onGameStarted({ player_order: order, starting_life: 40, game_id: "g-ai" }); await h.flush();
      await require("fs").promises.unlink(process.env.MTG_RESUME_FILE).catch(() => {});
      const g = h.B._getGame();
      const slotOf = (u) => `player-${order.indexOf(u)}`;
      const face = (owner) => h.B.tableCard({ id: "engine-card-70", identity: { name: "Plains" }, types: ["Land"], controllerId: owner, ownerId: owner }).f;
      const yellowsDeck = slotOf(aideck ? "self-hosted-node-77-bot 2" : "self-hosted-node-77-bot"), preset = slotOf(aideck ? "self-hosted-node-77-bot" : "self-hosted-node-77-bot 2");
      ok(`verify #2: precondition, the AI with Yellow's deck ${label}`, g.slotColor[yellowsDeck] === (label.includes("Red") ? "Red" : "Yellow"), JSON.stringify(g.slotColor));
      ok(`verify #2: the AI that ${label} with Yellow's deck shows its printing`, face(yellowsDeck) === Y1, face(yellowsDeck));
      ok(`verify #2: the AI with a built-in deck shows neither Yellow's nor the unused Red deck's (${label})`, ![Y1, R1].includes(face(preset)), face(preset));
      ok(`verify #2: the players keep their own (${label})`, face(slotOf(white.username)) === W1 && face(slotOf(blue.username)) === B1, JSON.stringify([face(slotOf(white.username)), face(slotOf(blue.username))]));
      ok(`verify #2: no pictures for a deck nobody plays (${label})`, Object.values(g.pictures || {}).every((d) => d.Plains?.[0]?.face !== R1) && Object.keys(g.pictures || {}).length === 3, JSON.stringify(Object.keys(g.pictures || {})));
      harness.restore();
    }
    // verifier 2026-11-09 #1: a copy (Clone as Grizzly Bears, whose paper is Clone's) gets no printed P/T from the engine;
    // it shows the Bears' picture, so its base is the printed P/T the engine sent for a Grizzly Bears, from any board,
    // even one where the copy is drawn first and after the original is gone. A name the engine never sent numbers for,
    // and one only a token had (token names aren't unique), stay without a base.
    {
      const h = harness.load();
      const card = (id, name, extra = {}) => ({ id, identity: { name }, types: ["Creature"], power: "2", toughness: "2", basePower: 2, baseToughness: 2, controllerId: "player-0", ownerId: "player-0", ...extra });
      const b = clone(F.board);
      const bf = bfOf(b);
      bf.unshift(card("engine-card-961", "Grizzly Bears", { isCopy: true, power: "3", toughness: "3" }), card("engine-card-962", "Soldier", { isCopy: true }), card("engine-card-963", "Tarmogoyf", { isCopy: true }));
      bf.push(card("engine-card-960", "Grizzly Bears", { printedPower: 2, printedToughness: 2 }),
        card("engine-card-964", "Soldier", { identity: { name: "Soldier", isToken: true }, power: "1", toughness: "1", basePower: 1, baseToughness: 1, printedPower: 1, printedToughness: 1 }));
      const seat = setup(h, F.board);
      seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: clone(b), fingerprint: "c1" }); await h.flush();
      const statOf = (id) => { for (const t of sent(h, "table").reverse()) { const st = t.cards?.[id]; if (st) return [st.bp, st.bt]; } return "not sent"; };
      ok("verify #1: a copy drawn before its original has the original's printed P/T as its base", JSON.stringify(statOf("engine-card-961")) === "[2,2]", JSON.stringify(statOf("engine-card-961")));
      ok("verify #1: a name only a token printed has no base", JSON.stringify(statOf("engine-card-962")) === "[null,null]", JSON.stringify(statOf("engine-card-962")));
      ok("verify #1: a name never printed has no base", JSON.stringify(statOf("engine-card-963")) === "[null,null]", JSON.stringify(statOf("engine-card-963")));
      const gone = clone(b);
      bfOf(gone).splice(bfOf(gone).findIndex((c) => c.id === "engine-card-960"), 1);
      seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: gone, fingerprint: "c2" }); await h.flush();
      const copy = h.B.tableCard(bfOf(gone).find((c) => c.id === "engine-card-961"));
      ok("verify #1: the copy keeps that base once the original is gone", copy.bp === 2 && copy.bt === 2, JSON.stringify([copy.bp, copy.bt]));
      // (a card's own printed P/T still comes first)
      const own = h.B.tableCard(card("engine-card-965", "Grizzly Bears", { printedPower: 5, printedToughness: 5 }));
      ok("verify #1: a card's own printed P/T comes before its name's", own.bp === 5 && own.bt === 5, JSON.stringify([own.bp, own.bt]));
      // (kept in the resume file, so a restarted bridge draws the copy as before)
      const fsm = require("fs");
      const w0 = fsm.writeFile;
      let snapText = null;
      fsm.writeFile = (p, d, ...rest) => { if (/mtg-bridge-game-test\.json\.tmp$/.test(String(p))) snapText = String(d); return w0(p, d, ...rest); };
      h.B.saveResume(); await h.flush();
      fsm.writeFile = w0;
      await fsm.promises.unlink(process.env.MTG_RESUME_FILE).catch(() => {});
      ok("verify #1: the resume file keeps the printed P/T seen", JSON.stringify(JSON.parse(snapText || "{}").game?.printedPT?.["Grizzly Bears"]) === "[2,2]", String(snapText).slice(0, 200));
      harness.restore();
    }
    // bug 3 and verifier finding 1: why the game ended. Players: player-0 Blue (the seat), player-1 White, player-2 Yellow,
    // player-3 Red; boards come in one by one as the engine sends them (noteOuts reads each)
    {
      const chatsOf = (h) => h.effects.filter((e) => e.tts && e.tts.t === "chat").map((e) => e.tts.text);
      const names = ["Blue", "White", "Yellow", "Red"];
      const play = async (n, boards) => {
        const h = harness.load();
        const base = clone(F.board);
        const gv0 = base.gameView;
        for (let i = 2; i < n; i++) {
          const p = clone(gv0.players.find((x) => x.id === "player-1")); p.id = `player-${i}`; gv0.players.push(p);
          gv0.zones.push({ zone: "library", ownerId: p.id, count: 50, cards: [] }, { zone: "battlefield", ownerId: p.id, count: 0, cards: [] });
        }
        const slot = Object.fromEntries(names.slice(0, n).map((c, i) => [`player-${i}`, c]));
        const seat = setup(h, base, { total: n, bots: n - 1, slotNames: slot, slotColor: slot });
        let k = 0, last = null;
        for (const edit of boards) {
          const b = clone(last || base);
          b.gameView.events = undefined;
          edit(b.gameView);
          last = b;
          seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: clone(b), fingerprint: `f${++k}` }); await h.flush();
        }
        return { h, seat, last };
      };
      const P = (gv, id) => gv.players.find((p) => p.id === id);
      const lib = (gv, id, n) => { const z = gv.zones.find((x) => x.zone === "library" && x.ownerId === id); z.count = n; z.cards = []; };
      const over = (winnerId) => (gv) => { gv.gameOver = true; gv.winnerId = winnerId; };
      const gameOverSaid = async (r) => {
        r.seat.board = { state: clone(r.last), fingerprint: null };
        await asked(r.h, r.seat, { type: "gameOver" });
        const said = chatsOf(r.h).filter((t) => /Game over/.test(t));
        harness.restore();
        return said[0];
      };
      const asked = (h, seat, input) => { h.B.onPrompt(seat, { promptId: 900, decidingPlayerId: "player-0", input }); return h.flush(); };
      // the live game: White conceded (a conceded player's library reads 0), then Yellow, and Blue won
      let said = await gameOverSaid(await play(3, [() => {}, (gv) => { P(gv, "player-1").status = "conceded"; lib(gv, "player-1", 0); },
        (gv) => { gv.turn++; }, (gv) => { P(gv, "player-2").status = "conceded"; over("player-0")(gv); }]));
      ok("live bug 3: two concessions name both and the winner, no empty library", said === "[MTG] Game over: White and Yellow conceded. Blue wins.", said);
      // (an early concession before a later loss of another kind isn't how it ended)
      said = await gameOverSaid(await play(3, [() => {}, (gv) => { P(gv, "player-1").status = "conceded"; lib(gv, "player-1", 0); },
        (gv) => { P(gv, "player-2").status = "lost"; P(gv, "player-2").life = 0; over("player-0")(gv); }]));
      ok("live bug 3: a concession long before the last loss isn't named", said === "[MTG] Game over: Yellow is at 0 life. Blue wins.", said);
      // (three at once, as the host's "winner" concedes everyone else; one conceded at 0 life, in response, conceded)
      said = await gameOverSaid(await play(4, [() => {}, (gv) => { for (const id of ["player-1", "player-2", "player-3"]) P(gv, id).status = "conceded"; P(gv, "player-3").life = 0; over("player-0")(gv); }]));
      ok("live bug 3: three concessions, one of them at 0 life", said === "[MTG] Game over: White, Yellow and Red conceded. Blue wins.", said);
      // (a multiplayer loser's cards leave the game: one out in their own draw step with cards in their library, Phage
      // in the draw step, is no deck-out though the board then reads 0)
      said = await gameOverSaid(await play(3, [() => {}, (gv) => { gv.step = "draw"; gv.activePlayerId = "player-1"; P(gv, "player-1").status = "lost"; lib(gv, "player-1", 0); },
        (gv) => { gv.turn++; gv.step = "main1"; gv.activePlayerId = "player-2"; }, (gv) => { P(gv, "player-2").status = "conceded"; over("player-0")(gv); }]));
      ok("verify 1: a loser whose library emptied as they left isn't decked", said === "[MTG] Game over: Yellow conceded. Blue wins.", said);
      said = await gameOverSaid(await play(3, [() => {}, (gv) => { gv.step = "draw"; gv.activePlayerId = "player-1"; P(gv, "player-1").status = "lost"; lib(gv, "player-1", 0); over("player-0")(gv); }]));
      ok("verify 1: a loser in their own draw step whose library had cards isn't decked", said === "[MTG] Game over: Blue wins.", said);
      // a real deck-out: the library already empty while White was playing, out in White's own draw step
      said = await gameOverSaid(await play(3, [() => {}, (gv) => { lib(gv, "player-1", 0); },
        (gv) => { gv.step = "draw"; gv.activePlayerId = "player-1"; P(gv, "player-1").status = "lost"; over("player-0")(gv); }]));
      ok("live bug 3: a real deck-out still says so", said === "[MTG] Game over: White drew from an empty library. Blue wins.", said);
      // (a known reason is said instead: at 0 life in that draw step too)
      said = await gameOverSaid(await play(3, [() => {}, (gv) => { lib(gv, "player-1", 0); },
        (gv) => { gv.step = "draw"; gv.activePlayerId = "player-1"; P(gv, "player-1").status = "lost"; P(gv, "player-1").life = 0; over("player-0")(gv); }]));
      ok("live bug 3: a known reason, not also the empty library", said === "[MTG] Game over: White is at 0 life. Blue wins.", said);
      // a deck-out and a concession on one board, and a mix of all three kinds in four players
      said = await gameOverSaid(await play(3, [() => {}, (gv) => { lib(gv, "player-1", 0); },
        (gv) => { gv.step = "draw"; gv.activePlayerId = "player-1"; P(gv, "player-1").status = "lost"; P(gv, "player-2").status = "conceded"; lib(gv, "player-2", 0); over("player-0")(gv); }]));
      ok("live bug 3: a deck-out and a concession together", said === "[MTG] Game over: White drew from an empty library, Yellow conceded. Blue wins.", said);
      said = await gameOverSaid(await play(4, [() => {}, (gv) => { lib(gv, "player-1", 0); },
        (gv) => { gv.step = "draw"; gv.activePlayerId = "player-1"; P(gv, "player-1").status = "lost"; P(gv, "player-2").status = "conceded"; P(gv, "player-3").status = "lost"; P(gv, "player-3").life = -2; for (const id of ["player-2", "player-3"]) lib(gv, id, 0); over("player-0")(gv); }]));
      ok("verify 1: concede, deck-out and life loss at once", said === "[MTG] Game over: Red is at -2 life, White drew from an empty library, Yellow conceded. Blue wins.", said);
      // a player who lost earlier isn't named for the end (outLast)
      said = await gameOverSaid(await play(3, [() => {}, (gv) => { P(gv, "player-1").status = "lost"; P(gv, "player-1").life = -3; lib(gv, "player-1", 0); },
        (gv) => { gv.turn++; }, (gv) => { P(gv, "player-2").status = "lost"; lib(gv, "player-2", 0); over("player-0")(gv); }]));
      ok("verify 1: a player out earlier isn't how the game ended", said === "[MTG] Game over: Blue wins.", said);
      // Thassa's Oracle in 3 and 4 players: every loser's cards leave the game with them, libraries 0
      for (const n of [3, 4]) {
        said = await gameOverSaid(await play(n, [() => {}, (gv) => { for (let i = 1; i < n; i++) { P(gv, `player-${i}`).status = "lost"; lib(gv, `player-${i}`, 0); } lib(gv, "player-0", 0); over("player-0")(gv); }]));
        ok(`verify 1: a Thassa's Oracle win in ${n} players blames no library`, said === "[MTG] Game over: Blue wins.", said);
      }
      // a 4-player draw (everyone lost at once, the runaway cap): no guessed reason
      said = await gameOverSaid(await play(4, [() => {}, (gv) => { for (let i = 0; i < 4; i++) { P(gv, `player-${i}`).status = "lost"; lib(gv, `player-${i}`, 0); } over(null)(gv); }]));
      ok("verify 1: a 4-player draw says a draw", said === "[MTG] Game over: a draw.", said);
      // 2 players: a loser whose library was empty, out on the other player's turn (Phage), isn't called decked
      said = await gameOverSaid(await play(2, [() => {}, (gv) => { lib(gv, "player-1", 0); },
        (gv) => { gv.step = "main1"; gv.activePlayerId = "player-0"; P(gv, "player-1").status = "lost"; over("player-0")(gv); }]));
      ok("verify 1: an empty library and a loss outside its draw isn't a deck-out", said === "[MTG] Game over: Blue wins.", said);
      // (nor in its own turn's main phase, nor in another player's draw step)
      for (const [step, active] of [["main1", "player-1"], ["draw", "player-0"]]) {
        said = await gameOverSaid(await play(2, [() => {}, (gv) => { lib(gv, "player-1", 0); },
          (gv) => { gv.step = step; gv.activePlayerId = active; P(gv, "player-1").status = "lost"; over("player-0")(gv); }]));
        ok(`verify 1: an empty library and a loss in ${step} of ${active}'s turn isn't a deck-out`, said === "[MTG] Game over: Blue wins.", said);
      }
      // (once the game is over, a player still playing with an empty library in their own draw step hasn't drawn yet)
      said = await gameOverSaid(await play(3, [() => {}, (gv) => { lib(gv, "player-2", 0); },
        (gv) => { gv.step = "draw"; gv.activePlayerId = "player-2"; P(gv, "player-1").status = "lost"; P(gv, "player-1").life = 0; over("player-0")(gv); }]));
      ok("verify 2026-11-09: a player still playing at the game's end isn't decked", said === "[MTG] Game over: White is at 0 life. Blue wins.", said);
      // (the step is the one on the board that first showed the player out: the game's last board may have moved on)
      const deckOut = [() => {}, (gv) => { lib(gv, "player-1", 0); }, (gv) => { gv.step = "draw"; gv.activePlayerId = "player-1"; P(gv, "player-1").status = "lost"; }];
      const moveOn = (gv) => { gv.step = "main1"; gv.activePlayerId = "player-0"; gv.turn++; over("player-0")(gv); };
      said = await gameOverSaid(await play(2, [...deckOut, (gv) => { gv.step = "upkeep"; }, moveOn]));
      ok("verify 2026-11-09: a deck-out is read where the player went out, not on a later board", said === "[MTG] Game over: White drew from an empty library. Blue wins.", said);
      // (and a bridge restart in between keeps that record: the resume file)
      {
        const r = await play(2, deckOut);
        const fsm = require("fs");
        const w0 = fsm.writeFile;
        let snapText = null;
        fsm.writeFile = (p, d, ...rest) => { if (/mtg-bridge-game-test\.json\.tmp$/.test(String(p))) snapText = String(d); return w0(p, d, ...rest); };
        r.h.B.saveResume(); await r.h.flush();
        fsm.writeFile = w0;
        const last = r.last;
        harness.restore();
        const h2 = harness.load();
        await fsm.promises.writeFile(process.env.MTG_RESUME_FILE, snapText || "{}");
        const resumed = h2.B.resumeGame();
        await fsm.promises.unlink(process.env.MTG_RESUME_FILE).catch(() => {});
        const seat2 = h2.B._getGame()?.seats.get("Blue");
        const b = clone(last);
        moveOn(b.gameView);
        seat2?.onEnvelope({ kind: "state", forPlayer: "player-0", state: clone(b), fingerprint: "after-restart" }); await h2.flush();
        seat2 && (seat2.board = { state: clone(b), fingerprint: null });
        if (seat2) await asked(h2, seat2, { type: "gameOver" });
        const s = chatsOf(h2).filter((t) => /Game over/.test(t));
        ok("verify 2026-11-09: a deck-out is still said after a bridge restart", resumed && s[0] === "[MTG] Game over: White drew from an empty library. Blue wins.", JSON.stringify([resumed, s]));
        harness.restore();
      }
      // (suite review 2026-11-09, B #2: a library first seen empty in the draw step it lost in was that draw's last card,
      // drawn: White drew it, then lost to something LOSS_REASONS doesn't know, a Laboratory Maniac's)
      said = await gameOverSaid(await play(2, [(gv) => { lib(gv, "player-1", 1); gv.step = "upkeep"; gv.activePlayerId = "player-1"; },
        (gv) => { lib(gv, "player-1", 0); gv.step = "draw"; }, (gv) => { P(gv, "player-1").status = "lost"; over("player-0")(gv); }]));
      ok("suite: a player who drew their last card and then lost isn't decked", said === "[MTG] Game over: Blue wins.", said);
      // (and the same draw step a turn later, the library empty since the turn before: decked)
      said = await gameOverSaid(await play(2, [(gv) => { lib(gv, "player-1", 0); gv.step = "draw"; gv.activePlayerId = "player-1"; },
        (gv) => { gv.turn++; gv.step = "upkeep"; }, (gv) => { gv.step = "draw"; }, (gv) => { P(gv, "player-1").status = "lost"; over("player-0")(gv); }]));
      ok("suite: one empty since an earlier turn's draw step is decked in the next", said === "[MTG] Game over: White drew from an empty library. Blue wins.", said);
      // (B #3: a rewind undoes the answers kept for the log, and how a player it brought back went out)
      {
        const r = await play(2, [(gv) => { gv.turn = 6; lib(gv, "player-1", 0); gv.step = "main1"; }, (gv) => { gv.step = "draw"; gv.activePlayerId = "player-1"; P(gv, "player-1").status = "lost"; }]);
        const g = r.h.B._getGame();
        const recorded = g.outWhere?.["player-1"]?.step === "draw";
        g.picked = new Map([["engine-card-1", { ids: [], text: "", at: Date.now() }]]); g.answers = new Map([["engine-card-1", [{ at: Date.now() }]]]);
        g.sourceShields = [{ id: "engine-card-2" }]; g.painTaps = [{ id: "engine-card-3", at: Date.now() }]; g.declaredBlocks = { turn: 6, ids: new Set(["engine-card-2"]) };
        g.owedCombat = { turn: 6, step: "combatDamage", list: [{ p: "player-1", n: 3 }] }; g.lifePays = [{ slot: "player-0", n: 2, card: "engine-card-4", at: Date.now() }];
        g.chosenSources = [{ by: "Deflecting Palm", how: "", turn: 6, slot: "player-0" }]; g.orderAnswer = { turn: 6, step: "combatDamage" };
        const back = clone(r.last); back.gameView.turn = 5; back.gameView.step = "main1"; back.gameView.activePlayerId = "player-0"; P(back.gameView, "player-1").status = "playing";
        r.seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: clone(back), fingerprint: "rewound" }); await r.h.flush();
        ok("suite: a rewind forgets the picks, answers, shields, pain taps and blocks kept for the log",
          recorded && g.picked.size === 0 && g.answers.size === 0 && !g.sourceShields.length && !g.painTaps.length && g.declaredBlocks === null,
          JSON.stringify([recorded, g.picked.size, g.answers.size, g.sourceShields, g.painTaps, g.declaredBlocks]));
        ok("verify: and what is owed in combat, life paid, sources chosen and the order answer",
          g.owedCombat === null && !g.lifePays.length && !g.chosenSources.length && g.orderAnswer === null,
          JSON.stringify([g.owedCombat, g.lifePays, g.chosenSources, g.orderAnswer]));
        // (White, back in the game, then out in Blue's main phase with that empty library: no deck-out)
        const out = clone(back); out.gameView.turn = 6; P(out.gameView, "player-1").status = "lost"; out.gameView.gameOver = true; out.gameView.winnerId = "player-0";
        r.seat.onEnvelope({ kind: "state", forPlayer: "player-0", state: clone(out), fingerprint: "out-again" }); await r.h.flush();
        r.seat.board = { state: clone(out), fingerprint: null };
        await asked(r.h, r.seat, { type: "gameOver" });
        const s = chatsOf(r.h).filter((t) => /Game over/.test(t));
        ok("suite: a player the rewind brought back is read by how they went out again", s[0] === "[MTG] Game over: Blue wins.", JSON.stringify(s));
        harness.restore();
      }
      // the relay's abort, on a board not over: a conceded player with library 0 is never decked; nothing known says no "aborted"
      {
        // (White's library empty while still playing, the concession in White's own draw step: all a deck-out would show)
        const r = await play(3, [() => {}, (gv) => { lib(gv, "player-1", 0); }, (gv) => { P(gv, "player-1").status = "conceded"; gv.step = "draw"; gv.activePlayerId = "player-1"; }]);
        r.seat.onRelay({ type: "GameAborted" }); await r.h.flush();
        const s = chatsOf(r.h).filter((t) => /^\[MTG\] (Game|The game)/.test(t));
        ok("live bug 3: the relay's abort after a concession names it, no empty library", JSON.stringify(s) === JSON.stringify(["[MTG] Game over: White conceded."]), JSON.stringify(s));
        harness.restore();
      }
      {
        const r = await play(2, [() => {}]);
        r.seat.onRelay({ type: "GameAborted" }); await r.h.flush();
        const s = chatsOf(r.h).filter((t) => /^\[MTG\] (Game|The game)/.test(t));
        ok("live bug 3: the relay's end with nothing known says the game ended, not aborted", JSON.stringify(s) === JSON.stringify(["[MTG] The game has ended."]), JSON.stringify(s));
        harness.restore();
      }
      {
        // (the engine stopped at a deck-out, 2026-10-22: the player still playing, library 0, in their own draw step;
        // empty already in the upkeep before it)
        const r = await play(2, [() => {}, (gv) => { lib(gv, "player-0", 0); gv.step = "upkeep"; gv.activePlayerId = "player-0"; },
          (gv) => { gv.step = "draw"; }]);
        r.seat.onRelay({ type: "GameAborted" }); await r.h.flush();
        const s = chatsOf(r.h).filter((t) => /^\[MTG\] (Game|The game)/.test(t));
        ok("live bug 3: the engine stopping at a deck-out still says so", JSON.stringify(s) === JSON.stringify(["[MTG] Game over: Blue drew from an empty library."]), JSON.stringify(s));
        harness.restore();
      }
    }
    // verifier finding 2: a singular in "ns" or "as" keeps its "-ses" plural; Forge's doubled plurals in "ns"/"as" are still undone
    {
      const mineBf = (gv) => gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards;
      const ab = async (name, text, description) => {
        const h = harness.load();
        const b = clone(F.board);
        Object.assign(b.gameView, { activePlayerId: "player-0", priorityPlayerId: "player-0", step: "main1", stack: [] });
        mineBf(b.gameView).push({ id: "engine-card-1450", identity: { name }, types: ["Artifact"], controllerId: "player-0", text });
        const seat = setup(h, b);
        h.B.onPrompt(seat, { promptId: 900, decidingPlayerId: "player-0", input: { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" },
          { id: "a1", type: "activateAbility", cardId: "engine-card-1450", abilityIndex: 1, isManaAbility: false, description, cost: "{1}" }] } });
        await h.flush();
        const got = (seat.prompt?.ui?.options || []).map((o) => o.label).find((l) => l.startsWith(`${name}:`)); harness.restore(); return got;
      };
      const lens = await ab("Lens Keeper", "{1}: Lens Keeper deals 1 damage to any target.", "{1}, Tap two untapped Lenses you control: Lens Keeper deals 1 damage to any target.");
      ok("verify 2: two Lenses beside Lens Keeper stay Lenses", /two untapped Lenses you control/.test(lens || ""), lens);
      const gas = await ab("Gas Main", "{1}: Gas Main deals 1 damage to you.", "{1}: Exile two Gases.");
      ok("verify 2: Gases beside Gas stay Gases", /two Gases/.test(gas || ""), gas);
      const gob = await ab("Goblin Warren", "Sacrifice two Goblins: Goblin Warren deals 2 damage to any target.", "Sacrifice two Goblinses: Goblin Warren deals 2 damage to any target.");
      ok("verify 2: a doubled plural in -ns is still undone (Goblinses)", /Sacrifice two Goblins:/.test(gob || ""), gob);
      const hyd = await ab("Hydra Den", "Sacrifice two Hydras: draw a card.", "Sacrifice two Hydrases: draw a card.");
      ok("verify 2: a doubled plural in -as is still undone (Hydrases)", /Sacrifice two Hydras:/.test(hyd || ""), hyd);
    }
  }
  // ── playable rows and revealed hands (scry glitch and revealed hands, 2026-11-09) ──
  // Real card shape (dump2's Vraska's Fall), renamed; the games: 2026-11-08 20:23 (Blue's Sythis with Courser of Kruphix
  // against White's Kykar, both human), 17:21 (Revelation), 19:09 (White's Sen Triplets on AI Red).
  {
    const shape = F.board.gameView.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0").cards[0];
    const C = (id, name, owner, extra = {}) => ({ ...clone(shape), id, identity: { ...shape.identity, name }, ownerId: owner, controllerId: owner, ...extra });
    const zone = (gv, kind, owner) => {
      let z = gv.zones.find((x) => x.zone === kind && x.ownerId === owner);
      if (!z) { z = { zone: kind, ownerId: owner, cards: [], count: 0 }; gv.zones.push(z); }
      return z;
    };
    const blueHand = clone(zone(F.board.gameView, "hand", "player-0").cards);
    const whiteHand = [C("engine-card-801", "Swords to Plowshares", "player-1", { types: ["Instant"] }), C("engine-card-802", "Plains", "player-1", { types: ["Land"] })];
    // a seat's view: its own hand in full, another's only the cards listed in `shows` (Forge leaves out what it can't see)
    const view = (slot, shows = {}) => {
      const b = clone(F.board);
      const hands = { "player-0": blueHand, "player-1": whiteHand };
      for (const [owner, cards] of Object.entries(hands)) {
        const z = zone(b.gameView, "hand", owner);
        z.cards = owner === slot ? clone(cards) : clone(cards.filter((c) => (shows[owner] || []).includes(c.id))).map((c) => ({ ...c, ...(shows.mayPlay ? { mayPlay: true } : {}) }));
        z.count = cards.length;
      }
      return b;
    };
    // both players seated (the Courser game), each with its own view
    const setup2 = (h, blueView, whiteView) => {
      const mk = (color, slot, board) => { const s = new h.B.Seat(color, "deck"); s.slot = slot; s.board = { state: clone(board), fingerprint: null }; return s; };
      h.B._setGame({ seats: new Map([["Blue", mk("Blue", "player-0", blueView)], ["White", mk("White", "player-1", whiteView)]]), bots: 0, total: 2,
        playerOrder: ["tts-Blue-ab12", "tts-White-cd34"], slotNames: { "player-0": "Blue", "player-1": "White" }, slotColor: { "player-0": "Blue", "player-1": "White" },
        started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
    };
    const rowOf = (table, color) => (table && table.players.find((p) => p.color === color)) || {};
    const ids = (list) => (list || []).map((c) => c.id);
    const board = async (blueView, whiteView) => {
      const h = harness.load();
      if (whiteView) setup2(h, blueView, whiteView); else setup(h, blueView);
      h.B.sendTable(); await h.flush();
      const t = sent(h, "table")[0];
      harness.restore();
      return t;
    };

    // Courser of Kruphix: Blue's revealed top card (Jugan, nonland). Our new Forge build marks it playable for nobody; an
    // older one marked it for both (a look counted). Neither seat's row may take it from the other's library.
    {
      const jugan = (mayPlay) => C("engine-card-160", "Jugan Defends the Temple", "player-0", { types: ["Enchantment"], subtypes: ["Saga"], mayPlay, visibility: "visible" });
      const bv = view("player-0"), wv = view("player-1");
      zone(bv.gameView, "library", "player-0").cards = [jugan(false)];
      zone(wv.gameView, "library", "player-0").cards = [jugan(true)];
      const t = await board(bv, wv);
      ok("Courser: precondition, a board was sent", !!t);
      ok("Courser: the look-only top card isn't in the opponent's row", !ids(rowOf(t, "White").playable).includes("engine-card-160"), JSON.stringify(rowOf(t, "White").playable));
      ok("Courser: nor in its owner's (the engine says it can't be played)", !ids(rowOf(t, "Blue").playable).includes("engine-card-160"), JSON.stringify(rowOf(t, "Blue").playable));
      // its land on top: playable for Blue (Courser's MayPlay), never for White even when an older build marks the look
      const plains = (mayPlay) => C("engine-card-106", "Plains", "player-0", { types: ["Land"], mayPlay, visibility: "visible" });
      const bv2 = view("player-0"), wv2 = view("player-1");
      zone(bv2.gameView, "library", "player-0").cards = [plains(true)];
      zone(wv2.gameView, "library", "player-0").cards = [plains(true)];
      const t2 = await board(bv2, wv2);
      ok("Courser: its land on top is in its owner's row", ids(rowOf(t2, "Blue").playable).includes("engine-card-106"), JSON.stringify(rowOf(t2, "Blue").playable));
      ok("Courser: and only there (one row per card)", !ids(rowOf(t2, "White").playable).includes("engine-card-106"), JSON.stringify(rowOf(t2, "White").playable));
    }
    // Thief of Sanity: Blue exiled White's card face down and may cast it; White sees only a hidden card
    {
      const bv = view("player-0"), wv = view("player-1");
      zone(bv.gameView, "exile", "player-1").cards = [C("engine-card-950", "Counterspell", "player-1", { types: ["Instant"], isFaceDown: true, mayPlay: true, exiledWith: "engine-card-22", visibility: "visible" })];
      zone(wv.gameView, "exile", "player-1").cards = [{ visibility: "hidden", id: "engine-card-950" }];
      for (const v of [bv, wv]) zone(v.gameView, "exile", "player-1").count = 1;
      const t = await board(bv, wv);
      ok("Thief of Sanity: the exiled card is in its caster's row", ids(rowOf(t, "Blue").playable).includes("engine-card-950"), JSON.stringify(rowOf(t, "Blue").playable));
      ok("Thief of Sanity: not in its owner's", !ids(rowOf(t, "White").playable).includes("engine-card-950"), JSON.stringify(rowOf(t, "White").playable));
      ok("Thief of Sanity: its name doesn't reach the table", !JSON.stringify(t).includes("Counterspell"));
    }
    // Faithless Looting in its owner's graveyard, castable by flashback: its playable entry says "Flashback {2}{R}" as its
    // graveyard entry does (it said nothing, and the table's self-check called its hover text wrong all game: Lingering
    // Souls and Faithless Looting, 2026-11-08/09 game, tmp/table-check.log)
    {
      const looting = () => C("engine-card-1201", "Faithless Looting", "player-0", { types: ["Sorcery"], mayPlay: true, visibility: "visible",
        text: "Draw two cards, then discard two cards.\nFlashback {2}{R} (You may cast this card from your graveyard for its flashback cost. Then exile it.)", flashbackCost: "2 R" });
      const bv = view("player-0"), wv = view("player-1");
      for (const v of [bv, wv]) { zone(v.gameView, "graveyard", "player-0").cards = [looting()]; zone(v.gameView, "graveyard", "player-0").count = 1; }
      zone(wv.gameView, "graveyard", "player-0").cards[0].mayPlay = false;
      const t = await board(bv, wv);
      const gy = (rowOf(t, "Blue").graveyard || []).find((c) => c.id === "engine-card-1201");
      const row = (rowOf(t, "Blue").playable || []).find((c) => c.id === "engine-card-1201");
      ok("flashback: precondition, the card is in the graveyard and the row", !!gy && !!row, JSON.stringify([gy, row]));
      ok("flashback: the graveyard entry says its cost", JSON.stringify(gy && gy.nt) === JSON.stringify(["Flashback {2}{R}"]), JSON.stringify(gy));
      ok("flashback: the playable entry says the same", JSON.stringify(row && row.nt) === JSON.stringify(gy && gy.nt), JSON.stringify(row));
    }
    // Revelation, both seated: each hand is shown to the other seat, so each goes into its owner's revealed list
    {
      const t = await board(view("player-0", { "player-1": ["engine-card-801", "engine-card-802"] }), view("player-1", { "player-0": blueHand.map((c) => c.id) }));
      ok("Revelation: White's hand is revealed", JSON.stringify(ids(rowOf(t, "White").revealed)) === JSON.stringify(["engine-card-801", "engine-card-802"]), JSON.stringify(rowOf(t, "White").revealed));
      ok("Revelation: Blue's hand is revealed", JSON.stringify(ids(rowOf(t, "Blue").revealed)) === JSON.stringify(blueHand.map((c) => c.id)), JSON.stringify(ids(rowOf(t, "Blue").revealed)));
      ok("Revelation: a shown card isn't playable for the other seat", !ids(rowOf(t, "Blue").playable).includes("engine-card-801") && !ids(rowOf(t, "White").playable).length, JSON.stringify([rowOf(t, "Blue").playable, rowOf(t, "White").playable]));
      ok("Revelation: the revealed card comes with its name and picture", (t && t.cards && t.cards["engine-card-801"] && t.cards["engine-card-801"].n) === "Swords to Plowshares", JSON.stringify(t && t.cards && t.cards["engine-card-801"]));
    }
    // a seat's own hand is its hand, never its playable row, even marked mayPlay; a shown card the view gives no name
    // (no identity) isn't revealed
    {
      const bv = view("player-0", { "player-1": ["engine-card-801", "engine-card-802"] }), wv = view("player-1", { "player-0": blueHand.map((c) => c.id) });
      for (const c of zone(bv.gameView, "hand", "player-0").cards) c.mayPlay = true;
      for (const v of [bv]) delete zone(v.gameView, "hand", "player-1").cards[1].identity;
      const t = await board(bv, wv);
      ok("own hand: not in its own playable row", !ids(rowOf(t, "Blue").playable).some((id) => blueHand.some((c) => c.id === id)), JSON.stringify(ids(rowOf(t, "Blue").playable)));
      ok("revealed: a card shown without a name isn't revealed", JSON.stringify(ids(rowOf(t, "White").revealed)) === JSON.stringify(["engine-card-801"]), JSON.stringify(ids(rowOf(t, "White").revealed)));
    }
    // Mindslaver with two humans: Blue controls White's turn and so sees White's hand; that look isn't public
    {
      const bv = view("player-0", { "player-1": ["engine-card-801", "engine-card-802"] }), wv = view("player-1");
      for (const v of [bv, wv]) v.gameView.players.find((x) => x.id === "player-1").controlledBy = "player-0";
      const t = await board(bv, wv);
      ok("Mindslaver: the controller's look at the hand isn't revealed", !rowOf(t, "White").revealed, JSON.stringify(ids(rowOf(t, "White").revealed)));
      const bv2 = view("player-0", { "player-1": ["engine-card-801", "engine-card-802"] }), wv2 = view("player-1", { "player-0": blueHand.map((c) => c.id) });
      for (const v of [bv2, wv2]) v.gameView.players.find((x) => x.id === "player-1").controlledBy = "player-0";
      const t2 = await board(bv2, wv2);
      ok("Mindslaver: the controlling player's own hand, shown to the other seat, still is", JSON.stringify(ids(rowOf(t2, "Blue").revealed)) === JSON.stringify(blueHand.map((c) => c.id)), JSON.stringify(ids(rowOf(t2, "Blue").revealed)));
    }
    // a hand nobody else sees isn't revealed (Blue sees only its own)
    {
      const t = await board(view("player-0"), view("player-1"));
      ok("no reveal: no revealed list", !rowOf(t, "White").revealed && !rowOf(t, "Blue").revealed, JSON.stringify([rowOf(t, "White").revealed, rowOf(t, "Blue").revealed]));
    }
    // Sen Triplets on an AI: White is the AI here (dump2's 1v1), its hand shown to Blue, who may cast from it
    {
      const b = view("player-0", { "player-1": ["engine-card-801", "engine-card-802"], mayPlay: true });
      const t = await board(b);
      ok("Sen Triplets: the AI's hand is revealed", JSON.stringify(ids(rowOf(t, "White").revealed)) === JSON.stringify(["engine-card-801", "engine-card-802"]), JSON.stringify(rowOf(t, "White").revealed));
      ok("Sen Triplets: its cards are in Blue's row", JSON.stringify(ids(rowOf(t, "Blue").playable)) === JSON.stringify(["engine-card-801", "engine-card-802"]), JSON.stringify(rowOf(t, "Blue").playable));
      ok("Sen Triplets: the AI's hand itself stays unsent", rowOf(t, "White").hand === null, JSON.stringify(rowOf(t, "White").hand));
      ok("Sen Triplets: the only seat's own hand isn't revealed (nobody else sees it)", !rowOf(t, "Blue").revealed, JSON.stringify(ids(rowOf(t, "Blue").revealed)));
    }
    // the same board once the game is over: nothing is playable (the stand-ins glowed under GAME OVER, real-table check
    // 2026-11-10); the reveal strip stays, it is the last board
    {
      const b = view("player-0", { "player-1": ["engine-card-801", "engine-card-802"], mayPlay: true });
      b.gameView.gameOver = true;
      const t = await board(b);
      ok("game over: precondition, the table says GAME OVER", t && t.gameOver === true, JSON.stringify(t && t.gameOver));
      ok("game over: no playable row (Sen Triplets' cards aren't castable any more)", !rowOf(t, "Blue").playable, JSON.stringify(rowOf(t, "Blue").playable));
      ok("game over: the revealed hand stays shown", JSON.stringify(ids(rowOf(t, "White").revealed)) === JSON.stringify(["engine-card-801", "engine-card-802"]), JSON.stringify(rowOf(t, "White").revealed));
    }
    // a revealed double-faced card keeps the plain card back, as a hand card does: its other face stays hidden under it
    {
      const h = harness.load({ imageCache: { "swords to plowshares": { face: "https://example.test/front.jpg", back: "https://example.test/other-face.jpg" } } });
      setup(h, view("player-0", { "player-1": ["engine-card-801"] }));
      h.B.sendTable(); await h.flush();
      const t = sent(h, "table")[0];
      harness.restore();
      const r = (rowOf(t, "White").revealed || [])[0] || {};
      const back = r.b ?? (t && t.cards && t.cards["engine-card-801"] || {}).b;
      ok("revealed DFC: the plain card back (sent as \"\"), not its other face", back === "", JSON.stringify([r, t && t.cards && t.cards["engine-card-801"]]));
    }
    // a private look (Mindslaver's controller sees the hand): with a second human seat that doesn't, nothing is public
    {
      const h = harness.load();
      const b3 = (slot, shows) => {
        const b = view(slot, shows);
        const p2 = { ...clone(b.gameView.players[1]), id: "player-2" };
        b.gameView.players.push(p2);
        b.gameView.zones.push({ zone: "hand", ownerId: "player-2", cards: [], count: 3 }, { zone: "library", ownerId: "player-2", cards: [], count: 80 });
        return b;
      };
      const mk = (color, slot, board) => { const s = new h.B.Seat(color, "deck"); s.slot = slot; s.board = { state: board, fingerprint: null }; return s; };
      h.B._setGame({ seats: new Map([["Blue", mk("Blue", "player-0", b3("player-0", { "player-1": ["engine-card-801"] }))], ["Yellow", mk("Yellow", "player-2", b3("player-2"))]]), bots: 1, total: 3,
        playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot", "tts-Yellow-ef56"], slotNames: { "player-0": "Blue", "player-1": "AI 1", "player-2": "Yellow" },
        slotColor: { "player-0": "Blue", "player-1": "White", "player-2": "Yellow" }, started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
      h.B.sendTable(); await h.flush();
      const t = sent(h, "table")[0];
      harness.restore();
      ok("private look: precondition, three players on the board", t && t.players.length === 3, JSON.stringify(t && t.players.map((p) => p.color)));
      ok("private look: a card one seat of two sees isn't revealed", !rowOf(t, "White").revealed, JSON.stringify(rowOf(t, "White").revealed));
    }
    // the strip goes when the hand is hidden again; an unchanged reveal is kept, not sent again
    {
      const h = harness.load();
      const seat = setup(h, view("player-0", { "player-1": ["engine-card-801"] }));
      // (each send's first board: a flush may send the same board again, all kept)
      const next = async () => { const n = sent(h, "table").length; h.B.sendTable(); await h.flush(); return sent(h, "table")[n]; };
      const shown = await next();
      // (a change elsewhere, so the board goes out again)
      const same = view("player-0", { "player-1": ["engine-card-801"] });
      same.gameView.players[0].life = 39;
      seat.board = { state: same, fingerprint: null };
      const kept = await next();
      seat.board = { state: view("player-0"), fingerprint: null };
      const gone = await next();
      harness.restore();
      ok("strip: shown", JSON.stringify(ids(rowOf(shown, "White").revealed)) === JSON.stringify(["engine-card-801"]), JSON.stringify(rowOf(shown, "White")));
      ok("strip: unchanged, it is kept", (rowOf(kept, "White").keep || []).includes("revealed") && !rowOf(kept, "White").revealed, JSON.stringify(rowOf(kept, "White")));
      ok("strip: hidden again, the list is gone and not kept", gone !== kept && !rowOf(gone, "White").revealed && !(rowOf(gone, "White").keep || []).includes("revealed"), JSON.stringify(rowOf(gone, "White")));
    }
    // a one-time reveal shows every card's picture (7 left out Animist's Awakening's 8th, 2026-10-30)
    {
      const h = harness.load();
      const seat = setup(h, F.board);
      const cards = Array.from({ length: 9 }, (_, i) => C(`engine-card-${700 + i}`, `Revealed Card ${i + 1}`, "player-0"));
      h.B.onPrompt(seat, { promptId: 990, decidingPlayerId: "player-0", input: { type: "revealCards", presentation: { title: "Animist's Awakening: revealed" }, ownerPlayerId: "player-0", zone: "library", cards } });
      await h.flush();
      const p = sent(h, "prompt").pop();
      harness.restore();
      ok("reveal pictures: all 9 go to the table", p && (p.show || []).length === 9, JSON.stringify(p && p.show && p.show.length));
    }
  }
  // Release check 2026-11-10: on the turn White ran for AI 1 (Mindslaver), White's own priority in the blockers step and
  // with AI 1's Shock on the stack passed by itself. Live boards and prompts from tests/live_mindslaver_ai_check.js on
  // the engine (2026-11-11): the engine asks the controlling seat its own priority there, with Reflect Damage when it
  // can be paid, and then the bridge stops (the defender's combat stop, the opponent's spell). In the release check
  // White's lands were Islands and Mountains and the {W} was debug mana gone at cleanup, so Reflect Damage
  // ({3}{R}{W}) was not offered and passing was right.
  {
    const LIVE = require("./golden/fixtures/mindslaver-ai-live.json");
    const rec = (id) => LIVE.find((x) => x.prompt.promptId === id);
    const live = async (id, edit) => {
      const h = harness.load();
      const r = clone(rec(id));
      if (edit) edit(r);
      const seat = setup(h, r.board);
      h.B.onPrompt(seat, r.prompt);
      await h.flush();
      const relayed = h.effects.filter((e) => e.relay).length;
      const out = { title: seat.prompt?.ui?.title ?? null, options: (seat.prompt?.ui?.options || []).map((o) => o.label), relayed };
      harness.restore();
      return out;
    };
    const noReflect = (r) => { r.prompt.input.actions = r.prompt.input.actions.filter((a) => a.type !== "cast"); };
    const blockers = await live(35);
    ok("Mindslaver live: precondition, the engine asks White's own priority in the blockers step of AI 1's controlled turn",
      rec(35).board.gameView.step === "combatDeclareBlockers" && rec(35).board.gameView.priorityPlayerId === "player-0"
      && rec(35).board.gameView.players.find((p) => p.id === "player-1").controlledBy === "player-0");
    ok("Mindslaver live: there White is asked, as itself, with Reflect Damage", blockers.title === "Your priority" && blockers.options.includes("Cast Reflect Damage"), JSON.stringify(blockers));
    const onShock = await live(45);
    ok("Mindslaver live: precondition, AI 1's Shock is on the stack at White's own priority", (rec(45).board.gameView.stack || []).some((s) => s.controllerId === "player-1" && /^Shock/.test(s.text || "")));
    ok("Mindslaver live: with AI 1's Shock on the stack White is asked, with Reflect Damage", onShock.title === "Your priority" && onShock.options.includes("Cast Reflect Damage"), JSON.stringify(onShock));
    const blockersDry = await live(35, noReflect);
    const shockDry = await live(45, noReflect);
    ok("Mindslaver live: with nothing castable (the release check's lands) both pass by themselves",
      blockersDry.title === null && shockDry.title === null && blockersDry.relayed > 0 && shockDry.relayed > 0, JSON.stringify({ blockersDry, shockDry }));
  }
  // Kykar re-test 2026-11-09 (docs/HAND-TEST-KYKAR.md "Re-test", new bugs 1, 2, 4, 5, 8, 10): the questions
  {
    const fresh = (edit, gvExtra = {}) => {
      const h = harness.load();
      const b = clone(F.board);
      Object.assign(b.gameView, { activePlayerId: "player-0", priorityPlayerId: "player-0", step: "main1", stack: [] }, gvExtra);
      if (edit) edit(b.gameView);
      const seat = setup(h, b);
      return { h, seat, b };
    };
    const asked = (h, seat, input, more = {}) => { h.B.onPrompt(seat, { promptId: 900, decidingPlayerId: "player-0", input, ...more }); return h.flush(); };
    const answer = async (h, choice, promptId = 900) => { h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId, choice }) }); await h.flush(5); };
    const zone = (gv, z, p) => gv.zones.find((x) => x.zone === z && x.ownerId === p);
    const P = (gv, id) => gv.players.find((p) => p.id === id);
    const prompts = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts && e.tts.t === "prompt").map((e) => e.tts);
    // new bug 1: Mindslaver's turn, AI 1's main-phase priority routed to Blue (Forge's harness: decidingPlayerId the
    // controller, the board's priority AI 1's)
    const FOREST = { id: "engine-card-1601", identity: { name: "Forest" }, types: ["Land"], controllerId: "player-1", ownerId: "player-1" };
    const BOLT = { id: "engine-card-1602", identity: { name: "Lightning Bolt" }, types: ["Instant"], controllerId: "player-1", ownerId: "player-1", text: "Lightning Bolt deals 3 damage to any target." };
    const slaved = (gv) => { P(gv, "player-1").controlledBy = "player-0"; zone(gv, "hand", "player-1").cards = [FOREST, BOLT]; zone(gv, "hand", "player-1").count = 2; };
    const AI_MAIN = { activePlayerId: "player-1", priorityPlayerId: "player-1", step: "main1" };
    const AI_ACTIONS = { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" },
      { id: "play:1601", type: "playLand", cardId: "engine-card-1601", label: "Play Forest" }, { id: "cast:1602", type: "cast", cardId: "engine-card-1602", label: "Cast Lightning Bolt", mode: { type: "normal" } }] };
    {
      const { h, seat } = fresh(slaved, AI_MAIN);
      await asked(h, seat, AI_ACTIONS);
      ok("re-test bug 1: AI 1's main-phase priority under Mindslaver is shown to its controller", seat.prompt?.ui?.title === "AI 1's priority (you control)", JSON.stringify(seat.prompt?.ui?.title ?? null));
      ok("re-test bug 1: with AI 1's land and spell to play", (seat.prompt?.ui?.options || []).some((o) => o.id === "play:1601") && (seat.prompt?.ui?.options || []).some((o) => o.id === "cast:1602"), JSON.stringify(seat.prompt?.ui?.options));
      await answer(h, ["cast:1602"]);
      await asked(h, seat, { type: "chooseBoardTargets", candidates: [{ kind: "player", id: "player-0" }, { kind: "player", id: "player-1" }], minTargets: 1, maxTargets: 1, chosenTargets: 0,
        presentation: { title: "Choose a target to deal damage to" } }, { promptId: 901, sourceCard: BOLT, sourceAbilityText: BOLT.text });
      ok("re-test bug 1: and the target question of AI 1's spell says it is AI 1's", /^AI 1 \(you control\): /.test(seat.prompt?.ui?.title || ""), JSON.stringify(seat.prompt?.ui?.title ?? null));
      harness.restore();
    }
    {
      // (Blue's own priority on AI 1's turn, the board's priority Blue's: Arena-style passing as before)
      const { h, seat } = fresh(slaved, { ...AI_MAIN, priorityPlayerId: "player-0" });
      await asked(h, seat, { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" }, { id: "cast:1700", type: "cast", cardId: "engine-card-1700", label: "Cast Opt" }] });
      ok("re-test bug 1: Blue's own priority on AI 1's controlled turn still passes by itself", seat.prompt == null, JSON.stringify(seat.prompt?.ui?.title ?? null));
      harness.restore();
    }
    {
      // (suite review 2026-11-10) Blue's own priority that stops (AI 1's spell on the stack) on AI 1's controlled turn is
      // Blue's own question: titled "Your priority", not as a controlled player's
      const { h, seat } = fresh(slaved, { ...AI_MAIN, priorityPlayerId: "player-0", stack: [{ id: "s1", controllerId: "player-1", sourceId: "engine-card-1602", identity: { name: "Lightning Bolt" } }] });
      await asked(h, seat, { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" }, { id: "cast:1700", type: "cast", cardId: "engine-card-1700", label: "Cast Opt" }] });
      ok("verify: Blue's own priority on AI 1's controlled turn is titled as Blue's own", seat.prompt?.ui?.title === "Your priority", JSON.stringify(seat.prompt?.ui?.title ?? null));
      harness.restore();
    }
    {
      // (and without control, AI 1's main is no stop of Blue's)
      const { h, seat } = fresh((gv) => { zone(gv, "hand", "player-1").cards = [FOREST]; }, AI_MAIN);
      await asked(h, seat, AI_ACTIONS);
      ok("re-test bug 1: no control, no stop", seat.prompt == null, JSON.stringify(seat.prompt?.ui?.title ?? null));
      harness.restore();
    }
    {
      // the controlled hand goes to the controller only, for their second hand zone
      const { h } = fresh(slaved, AI_MAIN);
      h.B.sendTable(); await h.flush();
      // (the first board in full: the next, the same, keeps its zones)
      const t0 = sent(h, "table")[0];
      const row = t0?.players.find((p) => p.slot === "player-1");
      ok("re-test bug 1: the controlled player's hand is sent for its controller", row?.ctlBy === "Blue" && (row?.ctlHand || []).map((c) => c.id).join(",") === "engine-card-1601,engine-card-1602", JSON.stringify(row && { ctlBy: row.ctlBy, ctlHand: row.ctlHand }));
      ok("re-test bug 1: and not as AI 1's own hand", row?.hand == null, JSON.stringify(row?.hand));
      // (suite review 2026-11-10: slimmed as every zone list, ZONE_KEYS: its details once in the board's cards)
      ok("merge: the controlled hand goes slim, its details in the board's cards", (row?.ctlHand || []).length === 2 && row.ctlHand.every((c) => c.s === 1 && c.n == null) && t0?.cards?.["engine-card-1601"]?.n === "Forest",
        JSON.stringify([row?.ctlHand, t0?.cards?.["engine-card-1601"]]));
      harness.restore();
      // (a player Forge names as controlled by itself is no one else's: no controlled hand, suite review 2026-11-10)
      const { h: h3 } = fresh((gv) => { slaved(gv); P(gv, "player-0").controlledBy = "player-0"; }, AI_MAIN);
      h3.B.sendTable(); await h3.flush();
      const blue3 = sent(h3, "table")[0]?.players.find((p) => p.slot === "player-0");
      ok("verify: a player controlled by itself sends no controlled hand", blue3 && blue3.ctlHand == null && blue3.ctlBy == null, JSON.stringify(blue3 && { ctlBy: blue3.ctlBy, ctlHand: blue3.ctlHand }));
      harness.restore();
      const { h: h2 } = fresh((gv) => { zone(gv, "hand", "player-1").cards = [FOREST]; }, AI_MAIN);
      h2.B.sendTable(); await h2.flush();
      const row2 = sent(h2, "table")[0]?.players.find((p) => p.slot === "player-1");
      ok("re-test bug 1: no control, no controlled hand", row2 && row2.ctlHand == null && row2.ctlBy == null, JSON.stringify(row2 && { ctlBy: row2.ctlBy, ctlHand: row2.ctlHand }));
      harness.restore();
    }
    {
      // (suite review 2026-11-10) a card cast for the controlled player in that player's own main phase is cast at a
      // sorcery's time (sorceryTime, by the open question's player): Necromancy isn't questioned there; with a spell on the
      // stack it is (the precondition)
      const NECRO = { id: "engine-card-1603", identity: { name: "Necromancy" }, types: ["Enchantment"], controllerId: "player-1", ownerId: "player-1",
        text: "You may cast Necromancy as though it had flash. If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step." };
      const withNecro = (gv) => { slaved(gv); zone(gv, "hand", "player-1").cards.push(NECRO); zone(gv, "hand", "player-1").count = 3; };
      const ACTS = { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" }, { id: "cast:1603", type: "cast", cardId: "engine-card-1603", label: "Cast Necromancy", mode: { type: "normal" } }] };
      const drag = async (gvExtra) => {
        const { h, seat } = fresh(withNecro, { ...AI_MAIN, ...gvExtra });
        await asked(h, seat, ACTS);
        const open = seat.prompt?.ui?.title ?? null;
        h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "play", id: "engine-card-1603" }) }); await h.flush();
        const after = seat.prompt?.ui?.title ?? null;
        harness.restore();
        return [open, after];
      };
      const [openMain, inMain] = await drag({});
      const [, onStack] = await drag({ stack: [{ id: "s1", controllerId: "player-0", identity: { name: "Shock" } }] });
      ok("verify: precondition, the controlled player's priority is open", openMain === "AI 1's priority (you control)", JSON.stringify(openMain));
      ok("verify: precondition, outside a sorcery's time a Necromancy cast for AI 1 asks first", /cast it now\?/.test(String(onStack)), JSON.stringify(onStack));
      ok("verify: in the controlled player's own main phase it is cast without asking", !/cast it now\?/.test(String(inMain)), JSON.stringify(inMain));
    }
    {
      // (suite review 2026-11-10) the game over closes every seat's open question, not only the seat it came to
      const h = harness.load();
      const mk = (color, slot) => { const s = new h.B.Seat(color, "deck"); s.slot = slot; s.board = { state: clone(F.board), fingerprint: null }; return s; };
      const blue = mk("Blue", "player-0"), white = mk("White", "player-1");
      h.B._setGame({ seats: new Map([["Blue", blue], ["White", white]]), bots: 0, total: 2, playerOrder: ["tts-Blue-ab12", "tts-White-cd34"],
        slotNames: { "player-0": "Blue", "player-1": "White" }, slotColor: { "player-0": "Blue", "player-1": "White" }, started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
      h.B.onPrompt(blue, { promptId: 920, decidingPlayerId: "player-0", input: { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, options: [{ label: "One" }, { label: "Two" }], presentation: { title: "Choose" } } });
      await h.flush();
      const before = !!blue.prompt;
      h.B.onPrompt(white, { promptId: 921, decidingPlayerId: "player-1", input: { type: "gameOver" } });
      await h.flush();
      const after = blue.prompt;
      harness.restore();
      ok("verify: precondition, Blue's question is open", before);
      ok("verify: the game over at White's seat closes Blue's question too", after == null, JSON.stringify(after?.ui?.title ?? null));
    }
    {
      // (a land of AI 1's dragged at Blue's own priority: why not, in AI 1's terms)
      const { h, seat } = fresh(slaved, { ...AI_MAIN, priorityPlayerId: "player-0" });
      const said = h.B.whyNot(seat, "engine-card-1601");
      ok("re-test bug 1: a controlled player's land waits for that player's priority", said === "Forest: wait, it isn't AI 1's priority.", said);
      harness.restore();
    }
    // (verify 2026-11-09: whose each question of a controlled turn is)
    const TARGETS = { type: "chooseBoardTargets", candidates: [{ kind: "player", id: "player-0" }, { kind: "player", id: "player-1" }], minTargets: 1, maxTargets: 1, chosenTargets: 0,
      presentation: { title: "Choose a target to deal damage to" } };
    const MIND_ROT = { id: "engine-card-1607", identity: { name: "Mind Rot" }, types: ["Sorcery"], controllerId: "player-1", ownerId: "player-1", text: "Target player discards two cards." };
    const castFor = async (h, seat, cardId = "engine-card-1602") => {
      await asked(h, seat, { ...AI_ACTIONS, actions: [...AI_ACTIONS.actions, { id: "cast:1607", type: "cast", cardId: "engine-card-1607", label: "Cast Mind Rot", mode: { type: "normal" } }] });
      await answer(h, [cardId === "engine-card-1602" ? "cast:1602" : "cast:1607"]);
    };
    const slaved2 = (gv) => { slaved(gv); zone(gv, "hand", "player-1").cards.push(MIND_ROT); };
    const youControl = (seat) => /^AI 1 \(you control\): /.test(seat.prompt?.ui?.title || "");
    {
      const { h, seat } = fresh((gv) => { slaved(gv); zone(gv, "battlefield", "player-1").cards.push({ id: "engine-card-1604", identity: { name: "Hill Giant" }, types: ["Creature"], power: 3, toughness: 3, controllerId: "player-1", ownerId: "player-1" }); },
        { ...AI_MAIN, step: "combatDeclareAttackers" });
      await asked(h, seat, { type: "chooseAttackers", attackers: [{ attackerId: "engine-card-1604", validTargetIds: ["player-0"] }] });
      ok("verify: the controlled player's attack says whose it is", seat.prompt?.ui?.title === "AI 1 (you control): Choose attackers", JSON.stringify(seat.prompt?.ui?.title ?? null));
      harness.restore();
    }
    {
      // (a priority question in between ends what the last one played)
      const { h, seat } = fresh(slaved, AI_MAIN);
      await castFor(h, seat);
      await asked(h, seat, AI_ACTIONS, { promptId: 902 });
      await asked(h, seat, TARGETS, { promptId: 903, sourceCard: BOLT, sourceAbilityText: BOLT.text });
      ok("verify: after a priority question, the card played before asks as nobody's", !youControl(seat), JSON.stringify(seat.prompt?.ui?.title ?? null));
      harness.restore();
    }
    {
      // (only that card's questions: another card's is the seat's own)
      const { h, seat } = fresh(slaved, AI_MAIN);
      await castFor(h, seat);
      await asked(h, seat, TARGETS, { promptId: 903, sourceCard: { id: "engine-card-1690", identity: { name: "Shock" }, text: "Shock deals 2 damage to any target." } });
      ok("verify: another card's question is not the controlled player's", !youControl(seat), JSON.stringify(seat.prompt?.ui?.title ?? null));
      harness.restore();
    }
    {
      // (AI 1's Mind Rot at Blue: Blue's own discard, the cards Blue's own hand; at AI 1, AI 1's)
      const ISLAND = { id: "engine-card-1608", identity: { name: "Island" }, types: ["Land"], controllerId: "player-0", ownerId: "player-0" };
      const DISCARD = (c) => ({ type: "chooseCards", cards: [c], min: 1, max: 1, presentation: { title: "Discard", description: "Choose a card to discard" } });
      const { h, seat } = fresh((gv) => { slaved2(gv); zone(gv, "hand", "player-0").cards = [ISLAND]; }, AI_MAIN);
      await castFor(h, seat, "engine-card-1607");
      await asked(h, seat, DISCARD(ISLAND), { promptId: 904, sourceCard: MIND_ROT, sourceAbilityText: MIND_ROT.text });
      ok("verify: a discard from the seat's own hand to the controlled player's spell is the seat's own (slave-own-discard-src)", !youControl(seat), JSON.stringify(seat.prompt?.ui?.title ?? null));
      await asked(h, seat, DISCARD(FOREST), { promptId: 905, sourceCard: MIND_ROT, sourceAbilityText: MIND_ROT.text });
      ok("verify: and one from the controlled player's hand is theirs", youControl(seat), JSON.stringify(seat.prompt?.ui?.title ?? null));
      harness.restore();
    }
    {
      // (verify round 2: cards from both hands are no one hand's, the card played decides; Blue's own Mind Rot at AI 1, all
      // in AI 1's hand, is AI 1's discard)
      const ISLAND = { id: "engine-card-1608", identity: { name: "Island" }, types: ["Land"], controllerId: "player-0", ownerId: "player-0" };
      const { h, seat } = fresh((gv) => { slaved2(gv); zone(gv, "hand", "player-0").cards = [ISLAND]; }, AI_MAIN);
      await castFor(h, seat, "engine-card-1607");
      await asked(h, seat, { type: "chooseCards", cards: [ISLAND, FOREST], min: 1, max: 1, presentation: { title: "Choose", description: "Choose a card" } },
        { promptId: 909, sourceCard: MIND_ROT, sourceAbilityText: MIND_ROT.text });
      ok("verify r2: cards from the seat's own hand and another are not its own choice (r2-hand-some)", youControl(seat), JSON.stringify(seat.prompt?.ui?.title ?? null));
      harness.restore();
      const BLUE_ROT = { ...MIND_ROT, id: "engine-card-1612", controllerId: "player-0", ownerId: "player-0" };
      const r = fresh(slaved, AI_MAIN);
      await asked(r.h, r.seat, { type: "chooseCards", cards: [FOREST, BOLT], min: 1, max: 1, presentation: { title: "Discard", description: "Choose a card to discard" } },
        { promptId: 910, sourceCard: BLUE_ROT, sourceAbilityText: BLUE_ROT.text });
      ok("verify r2: a choice among the controlled player's hand cards is that player's", youControl(r.seat), JSON.stringify(r.seat.prompt?.ui?.title ?? null));
      harness.restore();
    }
    {
      // (a card dragged for the controlled player: what it asks next is that player's, r2-stamp-intent)
      const { h, seat } = fresh(slaved, AI_MAIN);
      await asked(h, seat, AI_ACTIONS);
      h.B.onTTS({ t: "intent", json: JSON.stringify({ color: "Blue", kind: "play", id: "engine-card-1602" }) }); await h.flush();
      await asked(h, seat, TARGETS, { promptId: 911, sourceCard: BOLT, sourceAbilityText: BOLT.text });
      ok("verify r2: a dragged card of the controlled player asks as that player", youControl(seat), JSON.stringify([seat.prompt?.ui?.title ?? null, seat.actingFor]));
      harness.restore();
    }
    {
      // (what was played lasts that turn, and that control: a question of the card on the next turn, or with the control
      // ended, is the seat's own, and it is forgotten)
      const { h, seat } = fresh(slaved, AI_MAIN);
      await castFor(h, seat);
      seat.board.state.gameView.turn = (seat.board.state.gameView.turn ?? 0) + 1;
      await asked(h, seat, TARGETS, { promptId: 906, sourceCard: BOLT, sourceAbilityText: BOLT.text });
      ok("verify: the card played for a controlled player last turn asks as nobody's", !youControl(seat) && seat.actingFor == null, JSON.stringify([seat.prompt?.ui?.title ?? null, seat.actingFor]));
      harness.restore();
      const r = fresh(slaved, AI_MAIN);
      await castFor(r.h, r.seat);
      delete P(r.seat.board.state.gameView, "player-1").controlledBy;
      await asked(r.h, r.seat, TARGETS, { promptId: 907, sourceCard: BOLT, sourceAbilityText: BOLT.text });
      ok("verify: and with the control over, it is forgotten", !youControl(r.seat) && r.seat.actingFor == null, JSON.stringify([r.seat.prompt?.ui?.title ?? null, r.seat.actingFor]));
      harness.restore();
    }
    {
      // (the controlled player pays from their own lands keeping their own hand's colours: Giant Growth's {G} in AI 1's
      // hand keeps the Forest, Blue's own blue card is not AI 1's)
      const land = (n, name) => ({ id: `engine-card-${n}`, identity: { name }, types: ["Land"], controllerId: "player-1", ownerId: "player-1" });
      const { h, seat } = fresh((gv) => {
        slaved(gv);
        zone(gv, "hand", "player-1").cards.push({ id: "engine-card-1609", identity: { name: "Giant Growth" }, types: ["Instant"], manaCost: "{G}", controllerId: "player-1", ownerId: "player-1" });
        zone(gv, "hand", "player-0").cards = [{ id: "engine-card-1610", identity: { name: "Opt" }, types: ["Instant"], manaCost: "{U}", controllerId: "player-0", ownerId: "player-0" }];
        zone(gv, "battlefield", "player-1").cards.push(land(1605, "Forest"), land(1606, "Island"));
      }, AI_MAIN);
      await castFor(h, seat);
      await asked(h, seat, { type: "payManaCost", cardId: "engine-card-1602", cardName: "Lightning Bolt", manaCost: "{1}", canConfirmFromPool: false, actions: [
        { id: "tap:engine-card-1605:G", type: "activateManaAbility", cardId: "engine-card-1605", isManaAbility: true, cost: "{T}", producedMana: [{ color: "G", amount: 1 }] },
        { id: "tap:engine-card-1606:U", type: "activateManaAbility", cardId: "engine-card-1606", isManaAbility: true, cost: "{T}", producedMana: [{ color: "U", amount: 1 }] }] },
        { promptId: 908, sourceCard: BOLT });
      const opts = seat.prompt?.ui?.options?.map((o) => o.id), from = h.effects.length;
      await answer(h, ["__auto"], 908);
      const sentActs = h.effects.slice(from).map((e) => e.relay?.state).filter((s) => s?.kind === "response").map((s) => s.action?.output?.actionId);
      ok("verify: the controlled player's auto-pay keeps the colours of that player's hand", JSON.stringify(sentActs) === JSON.stringify(["tap:engine-card-1606:U"]), JSON.stringify([opts, sentActs]));
      harness.restore();
    }
    {
      // (a card of the controlled hand the controller's view doesn't name is not sent)
      const { h } = fresh((gv) => { slaved(gv); zone(gv, "hand", "player-1").cards.push({ id: "engine-card-1611" }); zone(gv, "hand", "player-1").count = 3; }, AI_MAIN);
      h.B.sendTable(); await h.flush();
      const row = sent(h, "table")[0]?.players.find((p) => p.slot === "player-1");
      ok("verify: the controlled hand holds only the cards the controller sees", (row?.ctlHand || []).map((c) => c.id).join(",") === "engine-card-1601,engine-card-1602", JSON.stringify(row?.ctlHand?.map((c) => c.id)));
      harness.restore();
    }
    // new bug 2: three shields on one combat's damage, Forge's "Choose" over their sentences (the live game's words)
    {
      const { h, seat } = fresh();
      const pick = (n, cardN, name, text, pickId) => {
        seat.lastRawPrompt = { decidingPlayerId: "player-0", promptId: n, sourceAbilityText: text, sourceCard: { id: `engine-card-${cardN}`, identity: { name }, text },
          input: { cancellable: false, cards: [{ id: pickId, identity: { name: "Hill Giant" } }], max: 1, min: 1, presentation: { description: "Choose a source ", targets: [], title: name }, type: "chooseCards" } };
        seat.respond(n, "chooseCards", { type: "chooseCardsDecision", chosenCardIds: [pickId] });
      };
      pick(61, 231, "Reflect Damage", "The next time a source of your choice would deal damage this turn, that damage is dealt to that source's controller instead.", "engine-card-229");
      pick(62, 237, "Circle of Protection: Red", "{1}: The next time a red source of your choice would deal damage to you this turn, prevent that damage.", "engine-card-238");
      pick(63, 260, "Deflecting Palm", "The next time a source of your choice would deal damage to you this turn, prevent that damage. If damage is prevented this way, Deflecting Palm deals that much damage to that source's controller.", "engine-card-1");
      await asked(h, seat, { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, options: [
        { label: "The next time a source of your choice would deal damage this turn, that damage is dealt to that source's controller instead." },
        { label: "The next time the chosen red source deals damage to you, prevent that damage." },
        { label: "The next time the chosen source deals damage to you, prevent that damage." }] });
      ok("re-test bug 2: the shields' order question says what it is", seat.prompt?.ui?.title === "Which applies first?", JSON.stringify(seat.prompt?.ui?.title ?? null));
      const labels = (seat.prompt?.ui?.options || []).map((o) => o.label.split(":").slice(0, /^Circle/.test(o.label) ? 2 : 1).join(":"));
      ok("re-test bug 2: each shield by its card", JSON.stringify(labels) === JSON.stringify(["Reflect Damage", "Circle of Protection: Red", "Deflecting Palm"]), JSON.stringify(seat.prompt?.ui?.options));
      harness.restore();
    }
    {
      // (no source chosen this turn: the sentences stay bare)
      const { h, seat } = fresh();
      await asked(h, seat, { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, options: [
        { label: "The next time the chosen red source deals damage to you, prevent that damage." }, { label: "The next time the chosen source deals damage to you, prevent that damage." }] });
      ok("re-test bug 2: with no source chosen, the options are Forge's words", JSON.stringify((seat.prompt?.ui?.options || []).map((o) => o.label)) === JSON.stringify(["The next time the chosen red source deals damage to you, prevent that damage.", "The next time the chosen source deals damage to you, prevent that damage."]), JSON.stringify(seat.prompt?.ui?.options));
      harness.restore();
    }
    // (verify 2026-11-09: a source is named only when it was chosen this turn, by this seat, and is the one such choice)
    {
      const PALM_T = "The next time a source of your choice would deal damage to you this turn, prevent that damage. If damage is prevented this way, Deflecting Palm deals that much damage to that source's controller.";
      const REVERSE_T = "The next time a source of your choice would deal damage to you this turn, prevent that damage. You gain life equal to the damage prevented this way.";
      const pickBy = (s, n, cardN, name, text) => {
        s.lastRawPrompt = { decidingPlayerId: s.slot, promptId: n, sourceAbilityText: text, sourceCard: { id: `engine-card-${cardN}`, identity: { name }, text },
          input: { cancellable: false, cards: [{ id: "engine-card-229", identity: { name: "Hill Giant" } }], max: 1, min: 1, presentation: { description: "Choose a source ", targets: [], title: name }, type: "chooseCards" } };
        s.respond(n, "chooseCards", { type: "chooseCardsDecision", chosenCardIds: ["engine-card-229"] });
      };
      const SHIELDQ = { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, options: [
        { label: "The next time the chosen red source deals damage to you, prevent that damage." }, { label: "The next time the chosen source deals damage to you, prevent that damage." }] };
      const named = (seat) => (seat.prompt?.ui?.options || []).map((o) => o.label).filter((l) => /^(?:Deflecting Palm|Reverse Damage):/.test(l));
      {
        const { h, seat } = fresh();
        const turn = seat.board.state.gameView.turn;
        seat.board.state.gameView.turn = turn - 1;
        pickBy(seat, 64, 260, "Deflecting Palm", PALM_T);
        seat.board.state.gameView.turn = turn;
        await asked(h, seat, SHIELDQ);
        ok("verify: a source chosen last turn names no option (shield-earlier-turn)", !named(seat).length, JSON.stringify(seat.prompt?.ui?.options));
        harness.restore();
      }
      {
        const { h, seat } = fresh();
        pickBy(seat, 64, 260, "Deflecting Palm", PALM_T);
        await asked(h, seat, SHIELDQ);
        ok("verify: one chosen this turn names it (precondition)", JSON.stringify(named(seat)) === JSON.stringify(["Deflecting Palm: The next time the chosen source deals damage to you, prevent that damage."]), JSON.stringify(seat.prompt?.ui?.options));
        harness.restore();
      }
      {
        const { h, seat } = fresh();
        pickBy(seat, 64, 260, "Deflecting Palm", PALM_T);
        pickBy(seat, 65, 261, "Reverse Damage", REVERSE_T);
        await asked(h, seat, SHIELDQ);
        ok("verify: two chosen with the same words name neither (shield-two-same-words)", !named(seat).length, JSON.stringify(seat.prompt?.ui?.options));
        harness.restore();
      }
      {
        const { h, seat } = fresh();
        const w = new h.B.Seat("White", "neheb_minotaur_commander");
        w.slot = "player-1"; w.board = seat.board;
        h.B._getGame().seats.set("White", w);
        pickBy(w, 64, 260, "Deflecting Palm", PALM_T);
        await asked(h, seat, SHIELDQ);
        ok("verify: another seat's chosen source names none of this seat's options (shield-other-seat)", !named(seat).length, JSON.stringify(seat.prompt?.ui?.options));
        harness.restore();
      }
    }
    // new bug 4: two Serra Angels told apart by whose they are
    {
      const ANGEL = (n, ctl) => ({ id: `engine-card-${n}`, identity: { name: "Serra Angel" }, types: ["Creature"], power: 4, toughness: 4, controllerId: ctl, ownerId: ctl });
      const { h, seat } = fresh((gv) => { zone(gv, "battlefield", "player-0").cards.push(ANGEL(1611, "player-0")); zone(gv, "battlefield", "player-1").cards.push(ANGEL(1612, "player-1")); });
      const CM = { id: "engine-card-1613", identity: { name: "Control Magic" }, text: "Enchant creature\nYou control enchanted creature." };
      await asked(h, seat, { type: "chooseBoardTargets", candidates: [{ kind: "card", id: "engine-card-1611" }, { kind: "card", id: "engine-card-1612" }], minTargets: 1, maxTargets: 1, chosenTargets: 0 }, { sourceCard: CM });
      const got = (seat.prompt?.ui?.options || []).map((o) => o.label).sort();
      ok("re-test bug 4: two Serra Angels by their controllers", JSON.stringify(got) === JSON.stringify(["Serra Angel 4/4 (AI 1's)", "Serra Angel 4/4 (yours)"]), JSON.stringify(got));
      harness.restore();
      // (both Blue's now, Control Magic on AI 1's: by their owners, Forge's battlefield card naming its controller)
      const { h: h2, seat: s2 } = fresh((gv) => { zone(gv, "battlefield", "player-0").cards.push(ANGEL(1611, "player-0"), ANGEL(1612, "player-0")); });
      h2.B._getGame().owners = new Map([["engine-card-1612", "player-1"]]);
      const WARP = { id: "engine-card-1614", identity: { name: "Chaos Warp" }, text: "The owner of target permanent shuffles it into their library, then reveals the top card of their library." };
      await asked(h2, s2, { type: "chooseBoardTargets", candidates: [{ kind: "card", id: "engine-card-1611" }, { kind: "card", id: "engine-card-1612" }], minTargets: 1, maxTargets: 1, chosenTargets: 0 }, { sourceCard: WARP });
      const got2 = (s2.prompt?.ui?.options || []).map((o) => o.label).sort();
      ok("re-test bug 4: and by their owners when both are yours", JSON.stringify(got2) === JSON.stringify(["Serra Angel 4/4 (owned by AI 1)", "Serra Angel 4/4 (owned by you)"]), JSON.stringify(got2));
      harness.restore();
    }
    // new bug 5: Arc Trail's two questions, each with its amount (Forge's script: "Select any target (2 damage)" /
    // "Select any other target (1 damage)", the harness sends neither)
    {
      const ARC = { id: "engine-card-1621", identity: { name: "Arc Trail" }, text: "Arc Trail deals 2 damage to any target and 1 damage to any other target." };
      const C = (n) => ({ kind: "card", id: `engine-card-${n}` });
      const { h, seat } = fresh();
      const tq = (candidates, promptId) => asked(h, seat, { type: "chooseBoardTargets", candidates, minTargets: 1, maxTargets: 1, chosenTargets: 0, presentation: { title: "Choose a target to deal damage to" } },
        { promptId, sourceCard: ARC, sourceAbilityText: ARC.text });
      await tq([C(1), C(2), { kind: "player", id: "player-1" }], 910);
      const first = seat.prompt?.ui?.title;
      await tq([C(1), C(2), { kind: "player", id: "player-1" }], 911);
      const again = seat.prompt?.ui?.title;
      await tq([C(2), { kind: "player", id: "player-1" }], 912);
      const second = seat.prompt?.ui?.title;
      ok("re-test bug 5: Arc Trail's first target is for 2 damage", first === "Arc Trail: deal 2 damage to which target?", first);
      ok("re-test bug 5: the same question again is still the first", again === first, again);
      ok("re-test bug 5: the second for 1 damage, another target", second === "Arc Trail: deal 1 damage to which other target?", second);
      await asked(h, seat, { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" }] }, { promptId: 913 });
      await tq([C(1), C(2)], 914);
      ok("re-test bug 5: a new casting starts at the first again", seat.prompt?.ui?.title === first, seat.prompt?.ui?.title);
      harness.restore();
    }
    // new bug 8: the game over closes the open question
    {
      const { h, seat } = fresh((gv) => zone(gv, "hand", "player-0").cards.push({ id: "engine-card-1631", identity: { name: "Opt" }, types: ["Instant"] }));
      await asked(h, seat, { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" }, { id: "cast:1631", type: "cast", cardId: "engine-card-1631", label: "Cast Opt" }] });
      ok("re-test bug 8: precondition, priority open", seat.prompt?.ui?.title === "Your priority", JSON.stringify(seat.prompt?.ui?.title ?? null));
      const from = h.effects.length;
      await asked(h, seat, { type: "gameOver" }, { promptId: 4294967295 });
      ok("re-test bug 8: game over closes it", seat.prompt == null && prompts(h, from).some((p) => p.color === "Blue" && p.promptId == null), JSON.stringify(prompts(h, from)));
      harness.restore();
    }
    // new bug 10: life paid for a Phyrexian symbol named in the life line
    // (Mondrak on the stack while it is cast, as Forge's board shows it during the payment; the lines of a board pair)
    const MONDRAK = (casting) => ({ id: "engine-stack-1641", sourceId: "engine-card-1641", identity: { name: "Mondrak, Glory Dominus" }, controllerId: "player-0", ownerId: "player-0",
      isPermanentSpell: true, ...(casting ? { isCasting: true } : {}), text: "Mondrak, Glory Dominus" });
    const lifeLines = (h, a, c) => h.B.logEvents(h.B.logSnapshot(a), h.B.logSnapshot(c), c, null).filter((l) => /life/.test(l));
    const phyrexian = async () => {
      const r = fresh((gv) => { gv.stack = [MONDRAK(true)]; });
      await asked(r.h, r.seat, { type: "payManaCost", cardId: "engine-card-1641", cardName: "Mondrak, Glory Dominus", manaCost: "{1}{W/P}{W/P}", canConfirmFromPool: false,
        actions: [{ id: "pay-life", type: "payLife", amount: 2 }] });
      await answer(r.h, ["pay-life"]);
      const step = (from, edit) => { const x = clone(from); edit(x); return x; };
      return { ...r, step, L: (gv) => P(gv, "player-0").life };
    };
    {
      const { h, b, step, L } = await phyrexian();
      const before = clone(b.gameView), after = step(before, (x) => { P(x, "player-0").life -= 2; });
      const lines = lifeLines(h, before, after);
      ok("re-test bug 10: the life paid says what for", JSON.stringify(lines) === JSON.stringify([`Blue: ${L(before)} -> ${L(after)} life (-2, paid for Mondrak, Glory Dominus)`]), JSON.stringify(lines));
      // (and once only: the next loss is bare)
      const later = step(after, (x) => { P(x, "player-0").life -= 2; });
      const more = lifeLines(h, after, later);
      ok("re-test bug 10: a later loss is not that payment", JSON.stringify(more) === JSON.stringify([`Blue: ${L(after)} -> ${L(later)} life (-2)`]), JSON.stringify(more));
      harness.restore();
    }
    {
      // (the cast cancelled, Mondrak back in hand: a later loss in the 10 s is not that payment, verify phy-leak-bare)
      const { h, b, step, L } = await phyrexian();
      const before = step(b.gameView, (x) => { x.stack = []; }), after = step(before, (x) => { P(x, "player-0").life -= 2; });
      const lines = lifeLines(h, before, after);
      ok("verify: a payment whose cast is not on the board names no loss", JSON.stringify(lines) === JSON.stringify([`Blue: ${L(before)} -> ${L(after)} life (-2)`]), JSON.stringify(lines));
      const back = step(after, (x) => { x.stack = [MONDRAK(true)]; P(x, "player-0").life -= 2; });
      const again = lifeLines(h, after, back);
      ok("verify: and it is gone with that board", JSON.stringify(again) === JSON.stringify([`Blue: ${L(after)} -> ${L(back)} life (-2)`]), JSON.stringify(again));
      harness.restore();
    }
    {
      // (a gain first, the payment's board after it: still the payment's)
      const { h, b, step, L } = await phyrexian();
      const before = clone(b.gameView), up = step(before, (x) => { P(x, "player-0").life += 1; }), down = step(up, (x) => { P(x, "player-0").life -= 2; });
      lifeLines(h, before, up);
      const lines = lifeLines(h, up, down);
      ok("verify: a gain on the cast's board leaves the payment for its loss", JSON.stringify(lines) === JSON.stringify([`Blue: ${L(up)} -> ${L(down)} life (-2, paid for Mondrak, Glory Dominus)`]), JSON.stringify(lines));
      harness.restore();
    }
    {
      // (Mondrak cast, then the board that shows the loss is the one it resolved on: just gone from the stack before)
      const { h, b, step, L } = await phyrexian();
      const before = step(b.gameView, (x) => { x.stack = [MONDRAK(false)]; });
      const after = step(before, (x) => { x.stack = []; P(x, "player-0").life -= 2; zone(x, "battlefield", "player-0").cards.push({ id: "engine-card-1641", identity: { name: "Mondrak, Glory Dominus" }, types: ["Creature"], controllerId: "player-0", ownerId: "player-0" }); });
      const lines = lifeLines(h, before, after);
      ok("verify: the board it resolved on is still the cast's", JSON.stringify(lines) === JSON.stringify([`Blue: ${L(before)} -> ${L(after)} life (-2, paid for Mondrak, Glory Dominus)`]), JSON.stringify(lines));
      harness.restore();
    }
    {
      // (another spell on the stack is not that cast's, r2-pay-stackany)
      const OPT = { id: "engine-stack-1642", sourceId: "engine-card-1642", identity: { name: "Opt" }, controllerId: "player-0", ownerId: "player-0", isPermanentSpell: false, isCasting: true, text: "Opt" };
      const { h, b, step, L } = await phyrexian();
      const before = step(b.gameView, (x) => { x.stack = [OPT]; }), after = step(before, (x) => { P(x, "player-0").life -= 2; });
      const lines = lifeLines(h, before, after);
      ok("verify r2: a payment names no loss on a board with only another spell on the stack", JSON.stringify(lines) === JSON.stringify([`Blue: ${L(before)} -> ${L(after)} life (-2)`]), JSON.stringify(lines));
      harness.restore();
    }
    {
      // (10 s at most)
      const { h, b, step, L } = await phyrexian();
      for (const x of h.B._getGame().lifePays) x.at -= 11000;
      const before = clone(b.gameView), after = step(before, (x) => { P(x, "player-0").life -= 2; });
      const lines = lifeLines(h, before, after);
      ok("verify: a payment over 10 s old names nothing", JSON.stringify(lines) === JSON.stringify([`Blue: ${L(before)} -> ${L(after)} life (-2)`]), JSON.stringify(lines));
      harness.restore();
    }
  }
  // a refused attack names the limit it broke (attackRefusalReason; live game 2026-11-10: Crawlspace allowed White 2
  // attackers, Blue sent 3 eight times and heard only "Something on the table limits who can attack")
  {
    const attackers = ["engine-card-22", "engine-card-64", "engine-card-65"];
    const refusal = async (opts) => {
      const h = harness.load();
      const b = clone(F.board);
      const all = b.gameView.zones.flatMap((z) => z.cards || []);
      for (const id of attackers) Object.assign(all.find((c) => c.id === id), { identity: { name: `Bear ${id.slice(-2)}` }, types: ["Creature"], text: "" });
      if (opts.limiter) Object.assign(all.find((c) => c.id === "engine-card-126"), { identity: { name: opts.limiter[0] }, types: ["Enchantment"], text: opts.limiter[1] });
      if (opts.faceDown) all.find((c) => c.id === "engine-card-126").isFaceDown = true;
      if (opts.many) {
        const bf = b.gameView.zones.filter((z) => z.zone === "battlefield").flatMap((z) => z.cards || []).filter((c) => !attackers.includes(c.id));
        bf.slice(0, opts.many).forEach((c, i) => Object.assign(c, { identity: { name: `Lim${i}` }, isFaceDown: false, text: "CARDNAME can't attack." }));
        r_many = bf.length;
      }
      if (opts.selfText) all.find((c) => c.id === attackers[0]).text = opts.selfText;
      if (opts.tweak) opts.tweak(all.find((c) => c.id === "engine-card-126"));
      const seat = setup(h, b);
      const ask = { type: "chooseAttackers", attackers: attackers.map((id) => ({ attackerId: id, validTargetIds: ["player-1"], mustAttack: id === opts.must })) };
      h.B.onPrompt(seat, { promptId: 900, decidingPlayerId: "player-0", input: ask }); await h.flush();
      const sent = seat.prompt.toOutput(opts.pick || attackers.map((id) => `${id}|player-1`));
      if (sent && sent.__next) { harness.restore(); return { stopped: sent.__next.ui, sent }; }
      const from = h.effects.length;
      h.B.onPrompt(seat, { promptId: 901, decidingPlayerId: "player-0", input: { type: "revealCards", presentation: { title: "Attack declaration invalid" }, cards: [] } }); await h.flush();
      const chat = h.effects.slice(from).filter((e) => e.tts && e.tts.t === "chat").map((e) => e.tts.text).join(" | ");
      h.B.onPrompt(seat, { promptId: 902, decidingPlayerId: "player-0", input: ask }); await h.flush();
      const again = { ...seat.prompt.ui };
      seat.prompt.toOutput(["__noattack"]);
      const out = { chat, note: again.note, text: again.text, after: seat.attackRefused };
      harness.restore();
      return out;
    };
    let r_many = 0;
    const crawl = ["Crawlspace", "No more than two creatures can attack you each combat."];
    let r = await refusal({ limiter: crawl });
    ok("refusal: Crawlspace is named with its limit and the count", r.chat === "[MTG] That attack isn't legal. Crawlspace (AI 1): no more than 2 creatures can attack AI 1 each combat. You chose 3.", r.chat);
    // (the text goes on with the reminder of the limit, attackReminder)
    ok("refusal: the next attack question keeps the reason as its note and text", r.note === "That attack isn't legal. Crawlspace (AI 1): no more than 2 creatures can attack AI 1 each combat. You chose 3." && r.text === `${r.note}\nCrawlspace (AI 1): at most 2 creatures can attack AI 1.`, JSON.stringify([r.note, r.text]));
    ok("refusal: answering the question forgets the reason", r.after == null, String(r.after));
    r = await refusal({ limiter: ["Silent Arbiter", "No more than one creature can attack each combat.\nNo more than one creature can block each combat."], pick: ["engine-card-22|player-1", "engine-card-64|player-1"] });
    ok("refusal: a limit on every attack counts them all", r.chat === "[MTG] That attack isn't legal. Silent Arbiter (AI 1): no more than 1 creature can attack each combat. You chose 2.", r.chat);
    r = await refusal({ limiter: crawl, pick: ["engine-card-22|player-1", "engine-card-64|player-1"] });
    ok("refusal: a limit not broken isn't claimed; the card is listed", r.chat === "[MTG] That attack isn't legal. Something on the table limits who can attack, or who they can attack. Cards on the table that limit attacks: Crawlspace.", r.chat);
    ok("refusal: nothing found broken says no refusal on the question (only the limit's reminder)", !/isn't legal/.test(r.note || "") && r.text === "Crawlspace (AI 1): at most 2 creatures can attack AI 1.", JSON.stringify([r.note, r.text]));
    r = await refusal({ selfText: "Bear 22 can't attack or block alone.", pick: ["engine-card-22|player-1"] });
    ok("refusal: a creature that can't attack alone is named", r.chat === "[MTG] That attack isn't legal. Bear 22 can't attack alone.", r.chat);
    r = await refusal({ limiter: crawl, pick: ["engine-card-22|player-1", "engine-card-64|player-1", "engine-card-65|engine-card-200"] });
    ok("refusal: Crawlspace counts only attacks at its controller, not at their planeswalker", !/You chose/.test(r.chat), r.chat);
    r = await refusal({ selfText: "Bear 22 can't attack or block alone." });
    ok("refusal: 'can't attack alone' isn't claimed when others attack too", !/can't attack alone/.test(r.chat), r.chat);
    r = await refusal({ limiter: crawl, must: "engine-card-65" });
    ok("refusal: the limit and who must attack are both said", r.chat.startsWith("[MTG] That attack isn't legal. Crawlspace (AI 1): no more than 2 creatures can attack AI 1 each combat. You chose 3. Must attack: Bear 65.") && r.text === `${r.note} Must attack: Bear 65.\nCrawlspace (AI 1): at most 2 creatures can attack AI 1.`, JSON.stringify(r));
    r = await refusal({ limiter: crawl, faceDown: true });
    ok("refusal: a face-down card's text is not read", r.chat === "[MTG] That attack isn't legal. Something on the table limits who can attack, or who they can attack.", r.chat);
    r = await refusal({ many: 8 });
    ok("refusal: the list of limiting cards is cut at six with an ellipsis", r_many >= 8 && / Cards on the table that limit attacks: (Lim\d, ){5}Lim\d, \.\.\.\.$/.test(r.chat), `${r_many} ${r.chat}`);
    r = await refusal({ many: 2 });
    ok("refusal: two limiting cards are listed without an ellipsis", / Cards on the table that limit attacks: Lim0, Lim1\.$/.test(r.chat), `${r_many} ${r.chat}`);
    // (Oracle wordings from Forge's cardsfolder, checked 2026-11-10)
    const OLD = "[MTG] That attack isn't legal. Something on the table limits who can attack, or who they can attack.";
    r = await refusal({ limiter: ["Wall of Omens", "Defender (This creature can't attack.)\nWhen Wall of Omens enters, draw a card."] });
    ok("refusal: Defender's reminder text isn't a limit", r.chat === OLD, r.chat);
    r = await refusal({ limiter: ["Akrasan Squire", "Exalted (Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.)"] });
    ok("refusal: exalted's reminder text isn't a limit", r.chat === OLD, r.chat);
    r = await refusal({ limiter: ["Rafiq of the Many", "Exalted\nWhenever a creature you control attacks alone, it gains double strike until end of turn."] });
    ok("refusal: an 'attacks alone' trigger isn't a limit", r.chat === OLD, r.chat);
    const wanderer = ["The Eternal Wanderer", "No more than one creature can attack The Eternal Wanderer each combat."];
    r = await refusal({ limiter: wanderer, pick: ["engine-card-22|player-1", "engine-card-64|player-1"] });
    ok("refusal: The Eternal Wanderer's limit isn't claimed for attacks at its controller", !/You chose/.test(r.chat), r.chat);
    r = await refusal({ limiter: wanderer, pick: ["engine-card-22|engine-card-126", "engine-card-64|engine-card-126"] });
    ok("refusal: The Eternal Wanderer's limit counts attacks at it", r.chat === "[MTG] That attack isn't legal. The Eternal Wanderer (AI 1): no more than 1 creature can attack The Eternal Wanderer each combat. You chose 2.", r.chat);
    const mirri = ["Mirri, Weatherlight Duelist", "First strike\nWhenever Mirri, Weatherlight Duelist attacks, each opponent can't block with more than one creature this combat.\nAs long as Mirri, Weatherlight Duelist is tapped, no more than one creature can attack you each combat."];
    r = await refusal({ limiter: mirri, pick: ["engine-card-22|player-1", "engine-card-64|player-1"] });
    ok("refusal: Mirri's limit isn't claimed while she is untapped", !/You chose/.test(r.chat), r.chat);
    r = await refusal({ limiter: mirri, tweak: (c) => { c.tapped = true; }, pick: ["engine-card-22|player-1", "engine-card-64|player-1"] });
    ok("refusal: Mirri's limit is named while she is tapped", /Mirri, Weatherlight Duelist \(AI 1\): no more than 1 creature can attack AI 1 each combat\. You chose 2\./.test(r.chat), r.chat);
    r = await refusal({ selfText: "First strike, deathtouch\nBear 22 can only attack alone.", pick: ["engine-card-22|player-1", "engine-card-64|player-1"] });
    ok("refusal: a creature that can only attack alone is named when others attack", r.chat === "[MTG] That attack isn't legal. Bear 22 can only attack alone.", r.chat);
    r = await refusal({ selfText: "Bear 22 can only attack alone.", pick: ["engine-card-22|player-1"] });
    ok("refusal: 'can only attack alone' isn't claimed when it attacks alone", !/can only attack alone/.test(r.chat), r.chat);
    r = await refusal({ limiter: ["Errantry", "Enchant creature\nEnchanted creature gets +3/+0 and can only attack alone."], tweak: (c) => { c.attachedTo = "engine-card-64"; } });
    ok("refusal: Errantry's enchanted creature is named", r.chat === "[MTG] That attack isn't legal. Bear 64 can only attack alone.", r.chat);
    r = await refusal({});
    ok("refusal: with nothing on the table the old line is unchanged", r.chat === "[MTG] That attack isn't legal. Something on the table limits who can attack, or who they can attack.", r.chat);
    // "All attack" over a limit the table can read is stopped before Forge sees it (the user's pick (a), 2026-11-10)
    const allAttack = async (opts) => {
      const h = harness.load();
      const b = clone(F.board);
      const all = b.gameView.zones.flatMap((z) => z.cards || []);
      for (const id of attackers) Object.assign(all.find((c) => c.id === id), { identity: { name: `Bear ${id.slice(-2)}` }, types: ["Creature"], text: "" });
      if (opts.limiter) Object.assign(all.find((c) => c.id === "engine-card-126"), { identity: { name: opts.limiter[0] }, types: ["Enchantment"], text: opts.limiter[1] });
      if (opts.selfText) all.find((c) => c.id === attackers[0]).text = opts.selfText;
      if (opts.faceDown) all.find((c) => c.id === "engine-card-126").isFaceDown = true;
      if (opts.tweak) opts.tweak(all.find((c) => c.id === "engine-card-126"));
      const seat = setup(h, b);
      const ask = { type: "chooseAttackers", attackers: attackers.map((id) => ({ attackerId: id, validTargetIds: opts.targets || ["player-1"], mustAttack: id === opts.must })) };
      h.B.onPrompt(seat, { promptId: 900, decidingPlayerId: "player-0", input: ask }); await h.flush();
      const first = seat.prompt.ui;
      const from = h.effects.length;
      const sent = seat.prompt.toOutput(["__allattack"]);
      await h.flush();
      const chat = h.effects.slice(from).filter((e) => e.tts && e.tts.t === "chat").map((e) => e.tts.text).join(" | ");
      const chatColors = h.effects.slice(from).filter((e) => e.tts && e.tts.t === "chat").map((e) => e.tts.color);
      const lastAfterStop = seat.lastAttack;
      const then = sent && sent.__next && opts.then ? sent.__next.toOutput(opts.then) : null;
      harness.restore();
      return { first, sent, chat, chatColors, then, lastAttack: lastAfterStop, seatColor: seat.color };
    };
    const STOP = "\"All attack\" would break a limit, so nothing was sent. Crawlspace (AI 1): no more than 2 creatures can attack AI 1 each combat. You chose 3. Pick the attackers yourself.";
    r = await allAttack({ limiter: crawl, then: ["engine-card-22|player-1", "engine-card-64|player-1"] });
    const r_stop = r;
    ok("all attack: over Crawlspace's limit nothing is sent, the question is asked again", !!r.sent?.__next && r.sent.type === undefined, JSON.stringify(r.sent).slice(0, 200));
    const LIMIT = "\nCrawlspace (AI 1): at most 2 creatures can attack AI 1.";
    ok("all attack: the re-asked question says the limit as its note and text", r.sent?.__next?.ui.note === STOP && r.sent.__next.ui.text === STOP + LIMIT, JSON.stringify(r.sent?.__next?.ui && [r.sent.__next.ui.note, r.sent.__next.ui.text]));
    ok("all attack: the limit is said in chat too", r.chat === `[MTG] ${STOP}`, r.chat);
    ok("all attack: the re-asked question keeps every option, All attack included", JSON.stringify(r.sent?.__next?.ui.options) === JSON.stringify(r.first.options), JSON.stringify(r.sent?.__next?.ui.options));
    ok("all attack: picking two after the stop sends those two", r.then?.type === "declareAttackers" && JSON.stringify(r.then.assignments.map((x) => x.attackerId)) === JSON.stringify(["engine-card-22", "engine-card-64"]), JSON.stringify(r.then));
    r = await allAttack({ limiter: crawl, must: "engine-card-65" });
    ok("all attack: the stop keeps who must attack in its text", r.sent?.__next?.ui.text === `${STOP} Must attack: Bear 65.${LIMIT}` &&r.sent.__next.ui.note === STOP, JSON.stringify(r.sent?.__next?.ui.text));
    ok("all attack: the stop is said in the player's own chat color", r_stop.chatColors.length === 1 && !!r_stop.seatColor && r_stop.chatColors[0] === r_stop.seatColor, JSON.stringify([r_stop.chatColors, r_stop.seatColor]));
    ok("all attack: a stopped declaration is not remembered as the last attack", r_stop.lastAttack == null, JSON.stringify(r_stop.lastAttack));
    r = await allAttack({ limiter: crawl, selfText: "Bear 22 can only attack alone." });
    ok("all attack: every limit it breaks is said, not just the first", r.chat === `[MTG] "All attack" would break a limit, so nothing was sent. Crawlspace (AI 1): no more than 2 creatures can attack AI 1 each combat. You chose 3. Bear 22 can only attack alone. Pick the attackers yourself.`, r.chat);
    // (no false stop: a Crawlspace its own controller holds limits attacks at that controller, not the ones they send out; an
    // All attack whose first targets are a planeswalker isn't counted against a limit on attacks at the player; a face-down card has no text)
    r = await allAttack({ limiter: crawl, tweak: (c) => { c.controllerId = "player-0"; } });
    ok("all attack: a Crawlspace the attacker controls doesn't stop their own attack", r.sent?.type === "declareAttackers" && r.sent.assignments.length === 3 && !r.chat, JSON.stringify(r.sent).slice(0, 160));
    // (two targets each: whom is asked first, item 25; the planeswalker picked)
    r = await allAttack({ limiter: crawl, targets: ["engine-card-200", "player-1"], then: ["card|engine-card-200"] });
    ok("all attack: attackers sent at a planeswalker aren't counted against a limit on the player", r.then?.type === "declareAttackers" && r.then.assignments.length === 3 && r.then.assignments.every((x) => x.targetId === "engine-card-200"), JSON.stringify(r.then ?? r.sent).slice(0, 160));
    r = await allAttack({ limiter: crawl, targets: ["engine-card-200", "player-1"], then: ["player|player-1"] });
    ok("all attack: whom picked first, then the limit is checked: three at Crawlspace's player are stopped", !!r.then?.__next && r.then.__next.ui.note === STOP, JSON.stringify(r.then).slice(0, 200));
    r = await allAttack({ limiter: crawl, faceDown: true });
    ok("all attack: a face-down limiter doesn't stop it", r.sent?.type === "declareAttackers" && r.sent.assignments.length === 3, JSON.stringify(r.sent).slice(0, 160));
    r = await allAttack({});
    ok("all attack: with no limit it is sent as before", r.sent?.type === "declareAttackers" && r.sent.assignments.length === 3 && !r.chat, JSON.stringify(r.sent));
    r = await allAttack({ limiter: crawl, then: null });
    const again = r.sent?.__next;
    ok("all attack: All attack again after the stop is stopped again", !!again && !!again.toOutput(["__allattack"])?.__next, "sent");
    r = await allAttack({ limiter: ["The Eternal Wanderer", "No more than one creature can attack The Eternal Wanderer each combat."] });
    ok("all attack: a limit it doesn't break doesn't stop it", r.sent?.type === "declareAttackers" && r.sent.assignments.length === 3, JSON.stringify(r.sent));
  }
  // the attack question's reminders (attackReminder, docs/attack-reminder-spec.md part 2; the user 2026-11-10: "if there's
  // a pay to attack or multiple creatures can't attack, a prompt should pop up to remind players") and whom each attacker
  // attacks (attackWhom, item 25: "Attack" and "All attack" ask which player or planeswalker). Oracle text from Forge's
  // cardsfolder, 2026-11-11. A four-player board: Blue (player-0) against AI 1, AI 2, AI 3; `cards` adds permanents.
  {
    const four = (cards, game = {}) => {
      const h = harness.load();
      const b = clone(F.board);
      const gv = b.gameView;
      const ai = gv.players.find((p) => p.id === "player-1");
      gv.players.push({ ...clone(ai), id: "player-2" }, { ...clone(ai), id: "player-3" });
      for (const id of ["player-2", "player-3"]) gv.zones.push({ zone: "battlefield", ownerId: id, cards: [], count: 0 });
      // (only these cards on the battlefield, so the fixture's own permanents say nothing)
      for (const z of gv.zones) if (z.zone === "battlefield") z.cards = [];
      Object.assign(gv, { activePlayerId: "player-0", priorityPlayerId: "player-0", step: "combatDeclareAttackers", stack: [] });
      for (const [o, id, name, types, text, extra] of cards) {
        gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === o).cards.push({ id, identity: { name, isToken: !!extra?.token }, types, text, controllerId: o, ownerId: o, keywords: [], tapped: false, summoningSick: false, ...(extra || {}) });
      }
      const seat = setup(h, b, { bots: 3, total: 4, playerOrder: ["tts-Blue-ab12", "bot-1", "bot-2", "bot-3"],
        slotNames: { "player-0": "Blue", "player-1": "AI 1", "player-2": "AI 2", "player-3": "AI 3" }, slotColor: { "player-0": "Blue", "player-1": "White", "player-2": "Red", "player-3": "Yellow" }, ...game });
      return { h, seat, gv };
    };
    const ask = async (s, attackers, targets) => {
      const input = { type: "chooseAttackers", attackers: attackers.map(([id, valid, must]) => ({ attackerId: id, validTargetIds: valid, mustAttack: !!must })),
        ...(targets ? { attackTargets: targets.map((id) => ({ id, label: id, kind: id.startsWith("player-") ? "player" : "planeswalker" })) } : {}) };
      s.h.B.onPrompt(s.seat, { promptId: 900, decidingPlayerId: "player-0", input }); await s.h.flush();
      return s.seat.prompt.ui;
    };
    const PROP = "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.";
    const ANNEX = "({W/P} can be paid with either {W} or 2 life.)\nCreatures can't attack you or planeswalkers you control unless their controller pays {W/P} for each of those creatures.";
    const BEAR = ["player-0", "engine-card-601", "Grizzly Bears", ["Creature"], "", { color: "G" }];
    const ANGEL = ["player-0", "engine-card-602", "Serra Angel", ["Creature"], "Flying, vigilance", { keywords: ["Flying", "Vigilance"], color: "W" }];
    const TEFERI = ["player-3", "engine-card-504", "Teferi, Hero of Dominaria", ["Planeswalker"], "+1: Draw a card."];
    const ALL = ["player-1", "player-2", "player-3", "engine-card-504"];
    // taxes, per defender
    let s = four([["player-1", "engine-card-501", "Propaganda", ["Enchantment"], PROP], BEAR]);
    let ui = await ask(s, [["engine-card-601", ["player-1"]]], ["player-1", "player-2", "player-3"]);
    ok("remind: Propaganda's tax is named with its player and cost", ui.text.split("\n")[0] === "Propaganda (AI 1): {2} for each creature attacking AI 1.", ui.text);
    ok("remind: the corner note says the tax per player", ui.note === "Attack tax: AI 1 {2} each.", ui.note);
    ok("remind: the mana open and the tap-first order are said with a tax", /\nYou have about \d+ mana open\. Attackers tap before you pay, so an attacking mana creature can't help pay\./.test(ui.text), ui.text);
    harness.restore();
    s = four([["player-2", "engine-card-502", "Ghostly Prison", ["Enchantment"], PROP], ["player-2", "engine-card-503", "Norn's Annex", ["Artifact"], ANNEX],
      ["player-2", "engine-card-505", "Jace Beleren", ["Planeswalker"], "+2: Each player draws a card."], BEAR]);
    ui = await ask(s, [["engine-card-601", ["player-2", "engine-card-505"]]], ["player-1", "player-2", "player-3", "engine-card-505"]);
    ok("remind: two taxes on one player are added into one cost, a planeswalker's own share said", ui.text.split("\n")[0] === "Ghostly Prison + Norn's Annex (AI 2): {2}{W/P} for each creature attacking AI 2; {W/P} for each attacking their planeswalkers.", ui.text);
    harness.restore();
    // (mutation pass: two generic taxes are added, {2} + {2} = {4}, not the last one)
    s = four([["player-1", "engine-card-501", "Propaganda", ["Enchantment"], PROP], ["player-1", "engine-card-502", "Ghostly Prison", ["Enchantment"], PROP], BEAR]);
    ui = await ask(s, [["engine-card-601", ["player-1"]]], ["player-1"]);
    ok("remind: two generic taxes are added, {2} + {2} = {4}", ui.text.split("\n")[0] === "Propaganda + Ghostly Prison (AI 1): {4} for each creature attacking AI 1." && ui.note === "Attack tax: AI 1 {4} each.", JSON.stringify([ui.text, ui.note]));
    harness.restore();
    // a player who can't be attacked here but whose planeswalker can: only the taxes that cover planeswalkers are said
    // (mutation pass: the player's tax went unsaid, or Propaganda was said for a planeswalker it doesn't cover)
    s = four([["player-3", "engine-card-501", "Propaganda", ["Enchantment"], PROP], ["player-3", "engine-card-503", "Norn's Annex", ["Artifact"], ANNEX], TEFERI, BEAR]);
    ui = await ask(s, [["engine-card-601", ["player-1", "engine-card-504"]]], ["player-1", "engine-card-504"]);
    ok("remind: only the planeswalker share is said when only the planeswalker can be attacked", ui.text.split("\n")[0] === "Norn's Annex (AI 3): {W/P} for each creature attacking their planeswalkers." && ui.note === "Attack tax: AI 3's planeswalkers {W/P} each.", JSON.stringify([ui.text, ui.note]));
    harness.restore();
    s = four([["player-3", "engine-card-501", "Propaganda", ["Enchantment"], PROP], TEFERI, BEAR]);
    ui = await ask(s, [["engine-card-601", ["player-1", "engine-card-504"]]], ["player-1", "engine-card-504"]);
    ok("remind: a player-only tax isn't said for their planeswalker", !/Propaganda/.test(ui.text || "") && !ui.note, JSON.stringify([ui.text, ui.note]));
    harness.restore();
    s = four([["player-1", "engine-card-501", "Sphere of Safety", ["Enchantment"], "Creatures can't attack you or planeswalkers you control unless their controller pays {X} for each of those creatures, where X is the number of enchantments you control."],
      ["player-1", "engine-card-506", "Ench A", ["Enchantment"], ""], ["player-1", "engine-card-507", "Ench B", ["Enchantment"], ""],
      // (a land and a creature of theirs aren't counted, mutation pass)
      ["player-1", "engine-card-508", "Plains", ["Land"], ""], ["player-1", "engine-card-509", "Savannah Lions", ["Creature"], ""], BEAR]);
    ui = await ask(s, [["engine-card-601", ["player-1"]]], ["player-1"]);
    ok("remind: Sphere of Safety's X is worked out from its controller's enchantments", /^Sphere of Safety \(AI 1\): \{3\} for each creature attacking AI 1\./.test(ui.text), ui.text);
    harness.restore();
    const TITHES = "Flying\nAs long as Archangel of Tithes is untapped, creatures can't attack you or planeswalkers you control unless their controller pays {1} for each of those creatures.\nAs long as Archangel of Tithes is attacking, creatures can't block unless their controller pays {1} for each of those creatures.";
    s = four([["player-1", "engine-card-501", "Archangel of Tithes", ["Creature"], TITHES, { tapped: true }], BEAR]);
    ui = await ask(s, [["engine-card-601", ["player-1"]]], ["player-1"]);
    ok("remind: Archangel of Tithes taxes nothing while tapped", !/Archangel/.test(ui.text || "") && !ui.note, JSON.stringify([ui.text, ui.note]));
    harness.restore();
    s = four([["player-1", "engine-card-501", "Archangel of Tithes", ["Creature"], TITHES], BEAR]);
    ui = await ask(s, [["engine-card-601", ["player-1"]]], ["player-1"]);
    ok("remind: Archangel of Tithes taxes {1} while untapped", /^Archangel of Tithes \(AI 1\): \{1\} for each creature attacking AI 1\./.test(ui.text), ui.text);
    harness.restore();
    s = four([["player-1", "engine-card-501", "Propaganda", ["Enchantment"], PROP], BEAR]);
    ui = await ask(s, [["engine-card-601", ["player-2"]]], ["player-2"]);
    ok("remind: a tax on a player who can't be attacked here isn't said", !ui.text && !ui.note, JSON.stringify([ui.text, ui.note]));
    harness.restore();
    // creatures that can't attack, with the reason
    s = four([BEAR, ["player-0", "engine-card-603", "Hill Giant", ["Creature"], "", { summoningSick: true }],
      ["player-0", "engine-card-604", "Wall of Omens", ["Creature"], "Defender\nWhen Wall of Omens enters, draw a card.", { keywords: ["Defender"] }],
      ["player-0", "engine-card-605", "Pacifism", ["Enchantment"], "Enchant creature\nEnchanted creature can't attack or block.", { attachedTo: "engine-card-606" }],
      // (sick too, but haste: said by its other reason, mutation pass)
      ["player-0", "engine-card-606", "Raging Goblin", ["Creature"], "Haste", { keywords: ["Haste"], summoningSick: true }],
      ["player-0", "engine-card-607", "Llanowar Elves", ["Creature"], "{T}: Add {G}.", { tapped: true }],
      ["player-0", "engine-card-608", "Raging Goblin", ["Creature"], "Haste", { keywords: ["Haste"], summoningSick: true }]]);
    ui = await ask(s, [["engine-card-601", ["player-1"]], ["engine-card-608", ["player-1"]]], ["player-1"]);
    ok("remind: the can't-attack list names each reason (sick, defender, the aura), not a tapped one or a sick one with haste", ui.text === "Can't attack: Hill Giant (summoning sick), Wall of Omens (defender), Raging Goblin (Pacifism).", ui.text);
    ok("remind: Q/E's reasons go to the table by card id", JSON.stringify(ui.cantAttack) === JSON.stringify({ "engine-card-603": "Hill Giant can't attack: summoning sick.", "engine-card-604": "Wall of Omens can't attack: defender.", "engine-card-606": "Raging Goblin can't attack: Pacifism." }), JSON.stringify(ui.cantAttack));
    ok("remind: a reason other than sickness is in the corner note", ui.note === `Can't attack: Hill Giant (summoning sick), Wall of Omens (defender), Raging Goblin (Pacifism).`, ui.note);
    harness.restore();
    s = four([BEAR, ...[1, 2, 3].map((i) => ["player-0", `engine-card-61${i}`, "Goblin Token", ["Creature"], "", { summoningSick: true, token: true }])]);
    ui = await ask(s, [["engine-card-601", ["player-1"]]], ["player-1"]);
    ok("remind: tokens of one kind are grouped", ui.text === "Can't attack: 3 Goblin tokens (summoning sick).", ui.text);
    ok("remind: summoning sickness alone stays out of the corner", !ui.note, ui.note);
    harness.restore();
    s = four([["player-1", "engine-card-501", "Moat", ["Enchantment"], "Creatures without flying can't attack."], BEAR, ANGEL]);
    ui = await ask(s, [["engine-card-602", ["player-1"]]], ["player-1"]);
    ok("remind: Moat is named for the creature without flying", ui.text === "Can't attack: Grizzly Bears (Moat).", ui.text);
    harness.restore();
    s = four([BEAR]);
    s.h.B._getGame().detained = new Map([["engine-card-601", { by: "player-1", turn: 1 }]]);
    ui = await ask(s, [], ["player-1"]);
    ok("remind: a detained creature says so", ui.text === "Can't attack: Grizzly Bears (detained).", ui.text);
    harness.restore();
    s = four([["player-0", "engine-card-601", "Grizzly Bears", ["Creature"], ""], ["player-0", "engine-card-609", "Stuck", ["Creature"], ""]]);
    ui = await ask(s, [["engine-card-601", ["player-1"]]], ["player-1"]);
    ok("remind: no reason on the board reads 'an effect on the table'", ui.text === "Can't attack: Stuck (an effect on the table).", ui.text);
    harness.restore();
    // who an offered creature can't attack
    s = four([BEAR, ANGEL]);
    s.h.B._getGame().goaded = new Map([["engine-card-601", { by: "player-1", turn: 1 }]]);
    ui = await ask(s, [["engine-card-601", ["player-2", "player-3"]], ["engine-card-602", ["player-1", "player-2", "player-3"]]], ["player-1", "player-2", "player-3"]);
    ok("remind: a goaded creature can't attack the player who goaded it", ui.text === "Can't attack AI 1: Grizzly Bears (goaded by AI 1).", ui.text);
    harness.restore();
    // (mutation pass: goaded by another player is no reason for this one)
    s = four([BEAR, ANGEL, ["player-0", "engine-card-610", "Hill Giant", ["Creature"], ""]]);
    s.h.B._getGame().goaded = new Map([["engine-card-601", { by: "player-1", turn: 1 }], ["engine-card-610", { by: "player-2", turn: 1 }]]);
    ui = await ask(s, [["engine-card-601", ["player-2", "player-3"]], ["engine-card-602", ["player-1", "player-2", "player-3"]], ["engine-card-610", ["player-2", "player-3"]]], ["player-1", "player-2", "player-3"]);
    ok("remind: goaded by someone else gives no reason", ui.text === "Can't attack AI 1: Grizzly Bears (goaded by AI 1), Hill Giant.", ui.text);
    harness.restore();
    // Elephant Grass's "Black creatures can't attack you.": the black one is said, the green one has no reason shown
    // (mutation pass: the colour test inverted)
    s = four([BEAR, ANGEL, ["player-0", "engine-card-610", "Vampire Bats", ["Creature"], "Flying", { color: "B" }],
      ["player-1", "engine-card-511", "Elephant Grass", ["Enchantment"], "Cumulative upkeep {1}\nBlack creatures can't attack you."]]);
    ui = await ask(s, [["engine-card-601", ["player-2"]], ["engine-card-602", ["player-1", "player-2"]], ["engine-card-610", ["player-2"]]], ["player-1", "player-2"]);
    ok("remind: Elephant Grass is the reason for the black creature only", ui.text === "Can't attack AI 1: Grizzly Bears, Vampire Bats (Elephant Grass).", ui.text);
    harness.restore();
    s = four([["player-1", "engine-card-501", "Blazing Archon", ["Creature"], "Flying\nCreatures can't attack you."], BEAR, ANGEL]);
    ui = await ask(s, [["engine-card-601", ["player-2"]], ["engine-card-602", ["player-2"]]], ["player-1", "player-2"]);
    ok("remind: nobody can attack Blazing Archon's player, said once", ui.text === "No creature of yours can attack AI 1 (Blazing Archon).", ui.text);
    harness.restore();
    // a creature's own price
    s = four([BEAR, ["player-1", "engine-card-510", "Brainwash", ["Enchantment"], "Enchant creature\nEnchanted creature can't attack unless its controller pays {3}.", { attachedTo: "engine-card-601" }],
      ["player-0", "engine-card-611", "Qal Sisma Behemoth", ["Creature"], "Qal Sisma Behemoth can't attack or block unless you pay {2}."]]);
    ui = await ask(s, [["engine-card-601", ["player-1"]], ["engine-card-611", ["player-1"]]], ["player-1"]);
    ok("remind: an aura's price on the creature it enchants is said", ui.text.split("\n").includes("Brainwash: Grizzly Bears can attack only if you pay {3}."), ui.text);
    ok("remind: a creature's own price is said", ui.text.split("\n").includes("Qal Sisma Behemoth can attack only if you pay {2}."), ui.text);
    harness.restore();
    s = four([BEAR, ["player-1", "engine-card-512", "Reclamation", ["Enchantment"], "Black creatures can't attack unless their controller sacrifices a land for each black creature they control that's attacking. (This cost is paid as attackers are declared.)"]]);
    ui = await ask(s, [["engine-card-601", ["player-1"]]], ["player-1"]);
    ok("remind: an attack cost the bridge can't count is said as written", ui.text === "Reclamation (AI 1): Black creatures can't attack unless their controller sacrifices a land for each black creature they control that's attacking.", ui.text);
    harness.restore();
    s = four([BEAR, ["player-1", "engine-card-513", "Crawlspace", ["Artifact"], "No more than two creatures can attack you each combat."]]);
    ui = await ask(s, [["engine-card-601", ["player-1"]]], ["player-1"]);
    ok("remind: a limit at a player is said before the attack", ui.text === "Crawlspace (AI 1): at most 2 creatures can attack AI 1." && ui.note === "At most 2 can attack AI 1 (Crawlspace).", JSON.stringify([ui.text, ui.note]));
    harness.restore();
    s = four([BEAR, ["player-1", "engine-card-513", "Crawlspace", ["Artifact"], "No more than two creatures can attack you each combat."]]);
    ui = await ask(s, [["engine-card-601", ["player-2"]]], ["player-2"]);
    ok("remind: a limit at a player who can't be attacked here isn't said", !ui.text && !ui.note, JSON.stringify([ui.text, ui.note]));
    harness.restore();
    // an aura the board shows on nothing: its price said as written, not lost (mutation pass)
    s = four([BEAR, ["player-1", "engine-card-510", "Brainwash", ["Enchantment"], "Enchant creature\nEnchanted creature can't attack unless its controller pays {3}."]]);
    ui = await ask(s, [["engine-card-601", ["player-1"]]], ["player-1"]);
    ok("remind: an aura on nothing the board shows is said as written", ui.text === "Brainwash (AI 1): Enchanted creature can't attack unless its controller pays {3}.", ui.text);
    harness.restore();
    // the tax payment names the tax, and Cancel what it does
    const pay = async (s, cardId, extra = {}) => {
      s.h.B.onPrompt(s.seat, { promptId: 910, decidingPlayerId: "player-0", input: { type: "payManaCost", cardId, cardName: "Grizzly Bears", manaCost: "{2}", actions: [], canConfirmFromPool: false, ...extra } }); await s.h.flush();
      return s.seat.prompt.ui;
    };
    s = four([["player-1", "engine-card-501", "Propaganda", ["Enchantment"], PROP], BEAR]);
    await ask(s, [["engine-card-601", ["player-1"]]], ["player-1"]);
    s.seat.prompt.toOutput(["engine-card-601|player-1"]);
    ui = await pay(s, "engine-card-601");
    ok("tax payment: the title names the tax and the attacker", ui.title === "Propaganda (AI 1): pay {2} to attack with Grizzly Bears?", ui.title);
    ok("tax payment: Cancel says it leaves the creature out", ui.options.at(-1).label === "Don't attack with Grizzly Bears" && ui.note === "Cancel: Grizzly Bears doesn't attack.", JSON.stringify([ui.options.at(-1), ui.note]));
    s.seat.board.state.gameView.step = "main2";
    ui = await pay(s, "engine-card-601");
    ok("tax payment: a payment outside the attack is the plain one", ui.title === "Pay {2} for Grizzly Bears" && ui.options.at(-1).label === "Cancel", JSON.stringify([ui.title, ui.options.at(-1)]));
    harness.restore();
    // (nothing left can pay the tax: the note names the button as it reads, not "Cancel", verifier 2026-11-11)
    {
      const mountainTap = { id: "tap:engine-card-602:0", type: "activateManaAbility", isManaAbility: true, cardId: "engine-card-602", abilityIndex: 0, description: "Mountain", cost: "{T}", producedMana: [{ amount: 1, color: "R" }] };
      const undoTap = { id: "undo:engine-card-603", type: "undoMana", cardId: "engine-card-603" };
      for (const [undo, said] of [[false, `Choose "Don't attack with Grizzly Bears" to leave it out of the attack.`], [true, `Undo a tap, or choose "Don't attack with Grizzly Bears".`]]) {
        s = four([["player-1", "engine-card-501", "Propaganda", ["Enchantment"], PROP], BEAR, ["player-0", "engine-card-602", "Mountain", ["Land"], "{T}: Add {R}."]]);
        await ask(s, [["engine-card-601", ["player-1"]]], ["player-1"]);
        s.seat.prompt.toOutput(["engine-card-601|player-1"]);
        s.seat.autoPayCard = "engine-card-601";
        ui = await pay(s, "engine-card-601", { manaCost: "{W}", actions: undo ? [mountainTap, undoTap] : [mountainTap] });
        ok(`tax payment: nothing can pay it, said with its button's words${undo ? " (with an undo)" : ""}`, ui.text === `Nothing here can pay {W}: Mountain can't make that mana. ${said}` && ui.options.at(-1).label === "Don't attack with Grizzly Bears", JSON.stringify([ui.text, ui.options.at(-1)]));
        harness.restore();
      }
    }
    // (review 2026-11-11: the declaration's attack was kept forever, so a pump on an attacker after priority, still in
    // declare attackers, or an ability of it a turn later read "Propaganda (AI 1): pay ... to attack with ...")
    const priority = async (s) => { s.h.B.onPrompt(s.seat, { promptId: 911, decidingPlayerId: "player-0", input: { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" }] } }); await s.h.flush(); };
    s = four([["player-1", "engine-card-501", "Propaganda", ["Enchantment"], PROP], BEAR]);
    await ask(s, [["engine-card-601", ["player-1"]]], ["player-1"]);
    s.seat.prompt.toOutput(["engine-card-601|player-1"]);
    ui = await pay(s, "engine-card-601");
    ok("tax payment: the declaration's payment names the tax (precondition)", ui.title === "Propaganda (AI 1): pay {2} to attack with Grizzly Bears?", ui.title);
    await priority(s);
    ui = await pay(s, "engine-card-601", { manaCost: "{1}{G}" });
    ok("tax payment: a pump on the attacker after priority, same step, is the plain payment", ui.title === "Pay {1}{G} for Grizzly Bears" && ui.options.at(-1).label === "Cancel" && !ui.note, JSON.stringify([ui.title, ui.options.at(-1), ui.note]));
    s.seat.board.state.gameView.turn = (s.seat.board.state.gameView.turn || 1) + 4;
    ui = await pay(s, "engine-card-601", { manaCost: "{1}{G}" });
    ok("tax payment: its ability in a later turn's declare attackers is the plain payment", ui.title === "Pay {1}{G} for Grizzly Bears" && ui.options.at(-1).label === "Cancel", JSON.stringify([ui.title, ui.options.at(-1)]));
    ok("tax payment: priority forgets the declared attack", s.seat.lastAttack == null, JSON.stringify(s.seat.lastAttack));
    harness.restore();
    // whom to attack (item 25)
    s = four([BEAR, ANGEL, TEFERI, ["player-0", "engine-card-614", "Goblin Guide", ["Creature"], "Haste"]]);
    ui = await ask(s, [["engine-card-601", ALL], ["engine-card-602", ALL], ["engine-card-614", ["player-1"]]], ALL);
    const ids = ui.options.map((o) => o.id);
    ok("whom: a creature with several targets has 'whom?' first of its options", ids.indexOf("engine-card-601|?") === ids.findIndex((x) => x.startsWith("engine-card-601|")) && ids.indexOf("engine-card-602|?") === ids.findIndex((x) => x.startsWith("engine-card-602|")), JSON.stringify(ids));
    ok("whom: a creature with one target has no 'whom?'", !ids.includes("engine-card-614|?") && ids.includes("engine-card-614|player-1"), JSON.stringify(ids));
    let step = s.seat.prompt.toOutput(["__allattack"]);
    const whom = step?.__next?.ui;
    ok("whom: All attack asks whom the creatures with several targets attack", whom?.title === "Attack whom with 2 creatures?" && whom.kind === "choice" && whom.mode === "single", JSON.stringify(whom).slice(0, 200));
    ok("whom: one option per player and planeswalker, then One by one and Back", JSON.stringify(whom?.options.map((o) => o.id)) === JSON.stringify(["player|player-1", "player|player-2", "player|player-3", "card|engine-card-504", "__each", "__back"]), JSON.stringify(whom?.options));
    ok("whom: a planeswalker says whose it is", whom?.options[3].label === "Teferi, Hero of Dominaria (AI 3's planeswalker)", whom?.options[3].label);
    ok("whom: a timed-out pick is Forge's first target, not Back", whom?.onTimeout === "player|player-1", whom?.onTimeout);
    let out = step.__next.toOutput(["card|engine-card-504"]);
    ok("whom: the pick sends both at it; the one with a single target at its own", out?.type === "declareAttackers" && out.assignments.length === 3 && out.assignments.every((x) => x.targetId === (x.attackerId === "engine-card-614" ? "player-1" : "engine-card-504")), JSON.stringify(out));
    ok("whom: the declaration is remembered for a refusal", s.seat.lastAttack?.length === 3, JSON.stringify(s.seat.lastAttack));
    out = s.seat.prompt.toOutput(["__allattack"]).__next.toOutput(["__back"]);
    ok("whom: Back asks the attack question again", out?.__next?.ui.title === "Choose attackers" && JSON.stringify(out.__next.ui.options) === JSON.stringify(ui.options), JSON.stringify(out?.__next?.ui.title));
    out = s.seat.prompt.toOutput(["__allattack"]).__next.toOutput(["__each"]);
    ok("whom: One by one asks each creature by name", out?.__next?.ui.title === "Attack whom with Grizzly Bears?" && !out.__next.ui.options.some((o) => o.id === "__each"), JSON.stringify(out?.__next?.ui.title));
    out = out.__next.toOutput(["player|player-2"]);
    ok("whom: then the next one", out?.__next?.ui.title === "Attack whom with Serra Angel?", JSON.stringify(out?.__next?.ui.title));
    out = out.__next.toOutput(["player|player-3"]);
    ok("whom: one by one, each at its own pick", out?.type === "declareAttackers" && out.assignments.find((x) => x.attackerId === "engine-card-601")?.targetId === "player-2" && out.assignments.find((x) => x.attackerId === "engine-card-602")?.targetId === "player-3", JSON.stringify(out));
    out = s.seat.prompt.toOutput(["engine-card-601|?", "engine-card-602|player-1"]);
    ok("whom: Attack (n) asks only for the creatures picked with 'whom?'", out?.__next?.ui.title === "Attack whom with Grizzly Bears?", JSON.stringify(out?.__next?.ui.title));
    out = out.__next.toOutput(["player|player-3"]);
    ok("whom: a target clicked on the table is kept", out?.type === "declareAttackers" && out.assignments.length === 2 && out.assignments.find((x) => x.attackerId === "engine-card-602")?.targetId === "player-1", JSON.stringify(out));
    out = s.seat.prompt.toOutput(["engine-card-601|player-2", "engine-card-601|?"]);
    ok("whom: a target picked wins over 'whom?' for the same creature", out?.type === "declareAttackers" && out.assignments[0].targetId === "player-2", JSON.stringify(out));
    out = s.seat.prompt.toOutput(["engine-card-601|?", "engine-card-601|player-2"]);
    ok("whom: a target picked wins over 'whom?' picked before it too", out?.type === "declareAttackers" && out.assignments[0].targetId === "player-2", JSON.stringify(out));
    harness.restore();
    // a creature that can't attack the pick is asked again
    s = four([BEAR, ANGEL, TEFERI]);
    await ask(s, [["engine-card-601", ["player-1", "player-2"]], ["engine-card-602", ["player-2", "engine-card-504"]]], ALL);
    step = s.seat.prompt.toOutput(["__allattack"]);
    ok("whom: the targets of all of them are offered, and the ones that differ said", JSON.stringify(step.__next.ui.options.map((o) => o.id)) === JSON.stringify(["player|player-1", "player|player-2", "card|engine-card-504", "__each", "__back"]) && /One that can't attack your pick is asked again\./.test(step.__next.ui.text), JSON.stringify(step.__next.ui));
    out = step.__next.toOutput(["player|player-1"]);
    ok("whom: one that can't attack the pick is asked again", out?.__next?.ui.title === "Attack whom with Serra Angel?" && JSON.stringify(out.__next.ui.options.map((o) => o.id)) === JSON.stringify(["player|player-2", "card|engine-card-504", "__back"]), JSON.stringify(out?.__next?.ui));
    out = out.__next.toOutput(["card|engine-card-504"]);
    ok("whom: and then both go", out?.type === "declareAttackers" && out.assignments.find((x) => x.attackerId === "engine-card-601")?.targetId === "player-1" && out.assignments.find((x) => x.attackerId === "engine-card-602")?.targetId === "engine-card-504", JSON.stringify(out));
    harness.restore();
    // tokens of one name: sized and numbered in "whom?" and in the question after; two sizes don't interleave (merge of
    // the attack-label fix with item 25, 2026-11-11)
    {
      const spirit = (k, p) => ["player-0", `engine-card-62${k}`, "Spirit Token", ["Creature"], "Flying", { token: true, power: p, toughness: p }];
      s = four([spirit(1, 1), spirit(2, 3), spirit(3, 1), TEFERI]);
      ui = await ask(s, [1, 2, 3].map((k) => [`engine-card-62${k}`, ALL]), ALL);
      const got = ui.options.map((o) => o.label);
      const whomOf = got.filter((l) => / → whom\? \(asked next\)$/.test(l));
      ok("whom: tokens of one name are sized and numbered in 'whom?'", JSON.stringify(whomOf) === JSON.stringify(["Spirit Token 1/1 #1 → whom? (asked next)", "Spirit Token 1/1 #2 → whom? (asked next)", "Spirit Token 3/3 → whom? (asked next)"]), JSON.stringify(whomOf));
      ok("whom: and in their targets, the 1/1s together", got.indexOf("Spirit Token 1/1 #2 → AI 1") >= 0 && got.indexOf("Spirit Token 1/1 #2 → AI 1") < got.indexOf("Spirit Token 3/3 → whom? (asked next)"), JSON.stringify(got));
      out = s.seat.prompt.toOutput(["__allattack"]);
      ok("whom: the question after names them so", /^Attacking: Spirit Token 1\/1 #1, Spirit Token 3\/3, Spirit Token 1\/1 #2\./.test(out?.__next?.ui.text || ""), out?.__next?.ui.text);
      out = out.__next.toOutput(["__each"]);
      ok("whom: one by one, by its number", out?.__next?.ui.title === "Attack whom with Spirit Token 1/1 #1?", out?.__next?.ui.title);
      harness.restore();
    }
    // must attack: No attacks keeps Forge's first target, a pick asks
    s = four([BEAR, ANGEL]);
    await ask(s, [["engine-card-601", ["player-2", "player-1"], true], ["engine-card-602", ["player-1"]]], ["player-1", "player-2"]);
    out = s.seat.prompt.toOutput(["__noattack"]);
    ok("whom: No attacks sends a must-attack creature at its first target, asking nothing", out?.type === "declareAttackers" && JSON.stringify(out.assignments) === JSON.stringify([{ attackerId: "engine-card-601", targetId: "player-2" }]), JSON.stringify(out));
    out = s.seat.prompt.toOutput(["engine-card-602|player-1"]);
    ok("whom: with other attackers picked, whom a must-attack creature attacks is asked", out?.__next?.ui.title === "Attack whom with Grizzly Bears?", JSON.stringify(out?.__next?.ui?.title ?? out));
    harness.restore();
    // the whom step's tax words and the answer through the table's own path
    s = four([["player-1", "engine-card-501", "Propaganda", ["Enchantment"], PROP], BEAR]);
    await ask(s, [["engine-card-601", ["player-1", "player-2"]]], ["player-1", "player-2"]);
    s.h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["__allattack"] }) }); await s.h.flush();
    ok("whom: a taxed player's button says the tax", s.seat.prompt.ui.options[0].label === "AI 1 (tax {2} each)" && s.seat.prompt.ui.title === "Attack whom with Grizzly Bears?", JSON.stringify(s.seat.prompt.ui.options[0]));
    s.h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["player|player-2"] }) }); await s.h.flush();
    const relayed = s.h.effects.filter((e) => e.relay).map((e) => e.relay.state?.action?.output).filter(Boolean).at(-1);
    ok("whom: the step's answer from the table goes to Forge", relayed?.type === "declareAttackers" && relayed.assignments[0]?.targetId === "player-2" && !s.seat.prompt, JSON.stringify(relayed));
    harness.restore();
  }
  // why a play was refused names the rule on the table, the zone, a missing target or the mana (whyNot, restrictionLines,
  // missingTarget, manaAvailable; the user 2026-11-10: "you can't cast while not your turn, you can't cast from anywhere
  // except your hand")
  {
    // Blue (player-0) tries card `card` in `zone`; `theirs` are permanents of AI 1's, `mine` Blue's; `g` tweaks the board
    const why = (o) => {
      const h = harness.load();
      const b = clone(F.board);
      const gv = b.gameView;
      Object.assign(gv, { activePlayerId: "player-0", priorityPlayerId: "player-0", step: "main1", stack: [] }, o.g || {});
      const zoneOf = (kind, owner) => gv.zones.find((z) => z.zone === kind && z.ownerId === owner);
      const card = { id: "engine-card-990", identity: { name: "Test Spell" }, types: ["Instant"], cmc: 1, manaCost: "{U}", color: "U", text: "Draw a card.", keywords: [], ...o.card };
      zoneOf(o.zone || "hand", o.owner || "player-0").cards.push(card);
      (o.theirs || []).forEach(([name, text, extra], i) => zoneOf("battlefield", "player-1").cards.push({ id: `engine-card-97${i}`, identity: { name }, types: ["Creature"], text, controllerId: "player-1", keywords: [], ...extra }));
      (o.mine || []).forEach(([name, text, extra], i) => zoneOf("battlefield", "player-0").cards.push({ id: `engine-card-98${i}`, identity: { name }, types: ["Creature"], text, controllerId: "player-0", keywords: [], ...extra }));
      if (o.tweak) o.tweak(gv);
      const seat = setup(h, b);
      const said = h.B.whyNot(seat, card.id);
      harness.restore();
      return said;
    };
    const abolisher = ["Grand Abolisher", "During your turn, your opponents can't cast spells or activate abilities of artifacts, creatures, enchantments, or planeswalkers."];
    const abolisher2 = ["Grand Abolisher", "Your opponents can't cast spells during your turn."];
    let s = why({ theirs: [abolisher2], g: { activePlayerId: "player-1", step: "combat_declare_attackers" } });
    ok("why: an opponent's restriction on their turn is quoted with its card", s === "Test Spell can't be cast right now. On the table: Grand Abolisher (AI 1): \"Your opponents can't cast spells during your turn.\".", s);
    s = why({ theirs: [abolisher2] });
    ok("why: 'during your turn' isn't quoted on another player's turn", !/Grand Abolisher/.test(s), s);
    s = why({ mine: [abolisher2], g: { activePlayerId: "player-0", step: "combat_declare_attackers" } });
    ok("why: a restriction on opponents isn't quoted to its own controller", !/Grand Abolisher/.test(s), s);
    s = why({ theirs: [["Teferi, Time Raveler", "Each opponent can cast spells only any time they could cast a sorcery."]], g: { activePlayerId: "player-1", step: "upkeep" } });
    ok("why: Teferi's sorcery-time rule is quoted off your main phase", /^Test Spell can't be cast right now\. On the table: Teferi, Time Raveler \(AI 1\): "Each opponent can cast spells only any time they could cast a sorcery\."\.$/.test(s), s);
    s = why({ theirs: [["Teferi, Time Raveler", "Each opponent can cast spells only any time they could cast a sorcery."]] });
    ok("why: Teferi's rule isn't quoted in your own main phase with an empty stack", !/Teferi/.test(s), s);
    const drannith = ["Drannith Magistrate", "Your opponents can't cast spells from anywhere other than their hands."];
    s = why({ theirs: [drannith], zone: "graveyard", card: { text: "Draw a card.\nFlashback {2}{U}" } });
    ok("why: Drannith Magistrate is named for a flashback card in the graveyard", s === "Test Spell can't be cast from there. On the table: Drannith Magistrate (AI 1): \"Your opponents can't cast spells from anywhere other than their hands.\".", s);
    s = why({ theirs: [drannith] });
    ok("why: Drannith Magistrate isn't named for a card in the hand", !/Drannith/.test(s), s);
    s = why({ theirs: [["Grafdigger's Cage", "Creature cards in graveyards and libraries can't enter the battlefield.\nPlayers can't cast spells from graveyards or libraries.", { types: ["Artifact"] }]], zone: "graveyard", card: { text: "Draw a card.\nFlashback {2}{U}" } });
    ok("why: a 'from graveyards' rule is named for a graveyard card", /On the table: Grafdigger's Cage \(AI 1\): "Players can't cast spells from graveyards or libraries\."/.test(s), s);
    s = why({ theirs: [["Grafdigger's Cage", "Players can't cast spells from graveyards or libraries."]], zone: "exile" });
    ok("why: a 'from graveyards' rule isn't named for an exiled card", !/Grafdigger/.test(s), s);
    s = why({ zone: "graveyard" });
    ok("why: a card in your graveyard with no way to cast it says so", s === "Test Spell is in your graveyard: it can be cast from there only if something lets you (flashback, escape, unearth or a card's effect).", s);
    s = why({ zone: "exile", owner: "player-1" });
    ok("why: another player's exiled card says whose", s === "Test Spell is in AI 1's exile: it can be cast from there only if a card's effect lets you.", s);
    s = why({ zone: "graveyard", card: { text: "Draw a card.\nFlashback {2}{U}" } });
    ok("why: a flashback card in the graveyard isn't told it needs permission", !/only if something lets you/.test(s), s);
    const winnower = ["Void Winnower", "Your opponents can't cast spells with even mana values.\nYour opponents can't block with creatures with even mana values."];
    s = why({ theirs: [winnower], card: { cmc: 2, manaCost: "{1}{U}" } });
    ok("why: Void Winnower is named for an even mana value", /On the table: Void Winnower \(AI 1\): "Your opponents can't cast spells with even mana values\."\.$/.test(s), s);
    s = why({ theirs: [winnower], card: { cmc: 3, manaCost: "{2}{U}" } });
    ok("why: Void Winnower isn't named for an odd mana value", !/Void Winnower/.test(s), s);
    const teeg = ["Gaddock Teeg", "Noncreature spells with mana value 4 or greater can't be cast.\nNoncreature spells with {X} in their mana costs can't be cast."];
    s = why({ theirs: [teeg], card: { cmc: 4, manaCost: "{3}{U}" } });
    ok("why: Gaddock Teeg is named for a noncreature spell of mana value 4", /Gaddock Teeg \(AI 1\): "Noncreature spells with mana value 4 or greater can't be cast\."/.test(s), s);
    s = why({ theirs: [teeg], card: { cmc: 3, manaCost: "{2}{U}" } });
    ok("why: Gaddock Teeg's mana value rule isn't named under 4", !/mana value 4 or greater/.test(s), s);
    s = why({ theirs: [teeg], card: { types: ["Creature"], keywords: ["Flash"], cmc: 5, manaCost: "{4}{U}" } });
    ok("why: Gaddock Teeg isn't named for a creature spell", !/Gaddock/.test(s), s);
    s = why({ theirs: [["Rule of Law", "Each player can't cast more than one spell each turn."]] });
    ok("why: a rule the table can't check (spells cast this turn) is still named", /On the table: Rule of Law \(AI 1\): "Each player can't cast more than one spell each turn\."/.test(s), s);
    s = why({ theirs: [["Abolisher Tap", "{T}: Target player can't cast spells this turn."], ["Silencer", "When Silencer enters, your opponents can't cast spells this turn."]] });
    ok("why: abilities and one-turn effects aren't quoted as rules", !/On the table/.test(s), s);
    s = why({ theirs: [["Reminder", "Flash (You can't cast this spell any time you could cast an instant.)"]] });
    ok("why: reminder text isn't quoted", !/On the table/.test(s), s);
    s = why({ theirs: [["Lim", "Your opponents can't cast spells during your turn."], ["Lim2", "Your opponents can't cast spells during your turn."], ["Lim3", "Your opponents can't cast spells during your turn."], ["Lim4", "Your opponents can't cast spells during your turn."]], g: { activePlayerId: "player-1", step: "upkeep" } });
    ok("why: more than three rules are cut with an ellipsis", / Lim3 \(AI 1\): "[^"]*"; \.\.\.\.$/.test(s), s);
    // the battlefield: activation bans and summoning sickness
    const rock = { types: ["Artifact"], cmc: 1, manaCost: "{1}", text: "{2}, {T}: Draw a card." };
    s = why({ zone: "battlefield", card: rock, theirs: [["Null Rod", "Activated abilities of artifacts can't be activated.", { types: ["Artifact"] }]] });
    ok("why: Null Rod is named for an artifact's ability", s === "Test Spell: its abilities can't be used. On the table: Null Rod (AI 1): \"Activated abilities of artifacts can't be activated.\".", s);
    s = why({ zone: "battlefield", card: { ...rock, types: ["Creature"] }, theirs: [["Null Rod", "Activated abilities of artifacts can't be activated.", { types: ["Artifact"] }]] });
    ok("why: Null Rod isn't named for a creature's ability", !/Null Rod/.test(s), s);
    s = why({ zone: "battlefield", card: rock, theirs: [["Pithing Needle", "As Pithing Needle enters, choose a card name.\nActivated abilities of sources with the chosen name can't be activated unless they're mana abilities.", { choices: [{ kind: "name", values: ["Test Spell"] }] }]] });
    ok("why: Pithing Needle naming the card is quoted", /Pithing Needle \(AI 1\): "Activated abilities of sources with the chosen name can't be activated unless they're mana abilities\."/.test(s), s);
    s = why({ zone: "battlefield", card: rock, theirs: [["Pithing Needle", "Activated abilities of sources with the chosen name can't be activated unless they're mana abilities.", { choices: [{ kind: "name", values: ["Sol Ring"] }] }]] });
    ok("why: Pithing Needle naming another card isn't quoted", !/Pithing/.test(s), s);
    s = why({ zone: "battlefield", card: rock, theirs: [["Arrest", "Enchant creature\nEnchanted creature can't attack or block, and its activated abilities can't be activated.", { types: ["Enchantment"], attachedTo: "engine-card-990" }]] });
    ok("why: an Aura's ban on the enchanted card is quoted", /Arrest \(AI 1\): "Enchanted creature can't attack or block, and its activated abilities can't be activated\."/.test(s), s);
    s = why({ zone: "battlefield", card: rock, theirs: [["Arrest", "Enchanted creature can't attack or block, and its activated abilities can't be activated.", { types: ["Enchantment"], attachedTo: "engine-card-1" }]] });
    ok("why: an Aura on another card isn't quoted", !/Arrest/.test(s), s);
    s = why({ zone: "battlefield", card: { types: ["Creature"], summoningSick: true, text: "{T}: Add {G}." } });
    ok("why: a summoning-sick creature's {T} ability says so", s === "Test Spell has summoning sickness: its {T} abilities work from your next turn (it came under your control this turn).", s);
    s = why({ zone: "battlefield", card: { types: ["Creature"], summoningSick: true, keywords: ["Haste"], text: "{T}: Add {G}." } });
    ok("why: haste is no summoning sickness", !/summoning sickness/.test(s), s);
    // targets
    s = why({ card: { text: "Counter target spell.", manaCost: "{U}{U}", cmc: 2 } });
    ok("why: a counterspell with an empty stack says it has nothing to target", s === "Test Spell needs a spell on the stack to target, and there is none.", s);
    const doom = { text: "Destroy target creature an opponent controls.", types: ["Instant"] };
    s = why({ card: doom, tweak: (gv) => { for (const z of gv.zones) if (z.zone === "battlefield" && z.ownerId === "player-1") z.cards = z.cards.filter((c) => !(c.types || []).includes("Creature")); } });
    ok("why: no creature to target is said", s === "Test Spell needs a target (target creature an opponent controls), and there is none on the table.", s);
    s = why({ card: doom, theirs: [["Hexproof Bear", "", { keywords: ["Hexproof"] }]], tweak: (gv) => { for (const z of gv.zones) if (z.zone === "battlefield" && z.ownerId === "player-1") z.cards = z.cards.filter((c) => !(c.types || []).includes("Creature") || c.identity.name === "Hexproof Bear"); } });
    ok("why: only hexproof creatures to target is said", s === "Test Spell needs a target (target creature an opponent controls), and there is none it can target: they have hexproof or shroud.", s);
    s = why({ card: { text: "Destroy up to one target creature an opponent controls." }, tweak: (gv) => { for (const z of gv.zones) if (z.zone === "battlefield") z.cards = z.cards.filter((c) => !(c.types || []).includes("Creature")); } });
    ok("why: an 'up to one' target is never missing", !/needs a target/.test(s), s);
    // mana
    s = why({ card: { types: ["Sorcery"], cmc: 9, manaCost: "{7}{U}{U}" } });
    ok("why: a spell costing more than the mana sources says so", /^Test Spell: probably not enough mana\. It costs \{7\}\{U\}\{U\} \(9\), and you have about \d+ available\.$/.test(s), s);
    const avail = Number(s.match(/about (\d+)/)?.[1]);
    s = why({ card: { types: ["Sorcery"], cmc: 9, manaCost: "{7}{U}{U}" }, mine: [["Sol Ring", "{T}: Add {C}{C}.", { types: ["Artifact"] }]] });
    ok("why: Sol Ring counts as two mana", Number(s.match(/about (\d+)/)?.[1]) === avail + 2, `${avail} ${s}`);
    s = why({ card: { types: ["Sorcery"], cmc: 9, manaCost: "{7}{U}{U}" }, mine: [["Elf", "{T}: Add {G}.", { summoningSick: true }]] });
    ok("why: a summoning-sick mana creature isn't counted", Number(s.match(/about (\d+)/)?.[1]) === avail, `${avail} ${s}`);
    s = why({ zone: "command", card: { types: ["Creature"], cmc: 1, manaCost: "{U}" }, tweak: (gv) => { gv.players[0].commanderCasts = { "engine-card-990": 5 }; } });
    ok("why: commander tax counts toward the cost", /plus \{10\} commander tax, and you have about/.test(s), s);
  }
  // a counterspell's target that can't be countered (cantBeCounteredWhy: the target list and the game log)
  {
    const shepherd = { id: "engine-card-975", identity: { name: "Allosaurus Shepherd" }, types: ["Creature"], controllerId: "player-1", text: "This spell can't be countered.\nGreen spells you control can't be countered." };
    const spinnerAll = { id: "engine-card-976", identity: { name: "Spell Shield" }, types: ["Enchantment"], controllerId: "player-1", text: "Spells you control can't be countered." };
    const targets = async (perm, stackText) => {
      const h = harness.load();
      const b = clone(F.board);
      const gv = b.gameView;
      if (perm) gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-1").cards.push(perm);
      gv.stack = [{ id: "engine-stack-50", sourceId: "engine-card-950", identity: { name: "Carnage Tyrant" }, controllerId: "player-1", ownerId: "player-1", text: stackText || "Carnage Tyrant", isPermanentSpell: true }];
      const seat = setup(h, b);
      h.B.onPrompt(seat, { promptId: 930, decidingPlayerId: "player-0", sourceCard: { id: "engine-card-43", text: "Counter target spell." }, sourceAbilityText: "Counter target spell.",
        input: { type: "chooseBoardTargets", candidates: [{ kind: "spell", id: "engine-stack-50" }], minTargets: 1, maxTargets: 1, chosenTargets: 0, presentation: { title: "Choose a target to counter" } } });
      await h.flush();
      const ui = seat.prompt?.ui;
      harness.restore();
      return ui;
    };
    let ui = await targets(null, "Carnage Tyrant - This spell can't be countered.");
    ok("counter: a spell whose words say it can't be countered is marked", /\(can't be countered\)$/.test(ui?.options?.[0]?.label || "") && /^Countering does nothing to a spell that can't be countered\. Carnage Tyrant: it can't be countered\.(\n|$)/.test(ui.text || ""), JSON.stringify([ui?.options, ui?.text]));
    ui = await targets(spinnerAll);
    ok("counter: 'Spells you control can't be countered' marks it for sure", /\(can't be countered\)$/.test(ui?.options?.[0]?.label || "") && /Spell Shield \(AI 1\): "Spells you control can't be countered\."/.test(ui.text || ""), JSON.stringify([ui?.options, ui?.text]));
    ui = await targets(shepherd);
    ok("counter: a coloured rule marks it as maybe", /\(maybe can't be countered: Allosaurus Shepherd\)$/.test(ui?.options?.[0]?.label || ""), JSON.stringify(ui?.options));
    ui = await targets(null);
    ok("counter: an ordinary spell isn't marked", !/countered/.test(ui?.options?.[0]?.label || "") && !/Countering/.test(ui?.text || ""), JSON.stringify([ui?.options, ui?.text]));
    ui = await targets({ ...spinnerAll, controllerId: "player-0" });
    ok("counter: another player's rule doesn't protect the spell", !/countered/.test(ui?.options?.[0]?.label || ""), JSON.stringify(ui?.options));
    // the log: the counterspell resolved, its target still on the stack
    const h = harness.load();
    setup(h, F.board);
    h.B._getGame().counterTargets = new Set(["engine-stack-50"]);
    const tyrant = { id: "engine-stack-50", sourceId: "engine-card-950", identity: { name: "Carnage Tyrant" }, controllerId: "player-1", ownerId: "player-1", text: "Carnage Tyrant", isPermanentSpell: true };
    const counter = { id: "engine-stack-51", sourceId: "engine-card-43", identity: { name: "Counterspell" }, controllerId: "player-0", ownerId: "player-0", text: "Counterspell", sourceAbilityText: "Counter target spell." };
    const before = clone(F.board.gameView), after = clone(F.board.gameView);
    before.stack = [tyrant, counter]; after.stack = [tyrant];
    h.B._getGame().counterTurn = after.turn;
    const lines = h.B.logEvents(h.B.logSnapshot(before), h.B.logSnapshot(after), after);
    ok("counter: a counterspell that did nothing says the spell can't be countered", lines.includes("Carnage Tyrant can't be countered: Counterspell did nothing to it"), JSON.stringify(lines));
    after.stack = [];
    const lines2 = h.B.logEvents(h.B.logSnapshot(before), h.B.logSnapshot(after), after);
    ok("counter: a spell that left the stack isn't called uncounterable", !lines2.some((l) => /can't be countered/.test(l)), JSON.stringify(lines2));
    harness.restore();
  }
  // a look at the top cards that a pick from among them follows isn't asked (item 5, doubled prompts)
  {
    const DIG = "Look at the top three cards of your library. You may reveal an instant card from among them and put it into your hand. Put the rest on the bottom of your library in any order.";
    const cards = [{ id: "engine-card-601", identity: { name: "Opt" }, types: ["Instant"] }, { id: "engine-card-602", identity: { name: "Island" }, types: ["Land"] }, { id: "engine-card-603", identity: { name: "Bear" }, types: ["Creature"] }];
    const run = async (text, next) => {
      const h = harness.load();
      const seat = setup(h, F.board);
      const from = h.effects.length;
      h.B.onPrompt(seat, { promptId: 940, decidingPlayerId: "player-0", sourceAbilityText: text, sourceCard: { id: "engine-card-600", identity: { name: "Dig Spell" }, text },
        input: { type: "revealCards", presentation: { title: "Look at these cards" }, ownerPlayerId: "player-view-0", zone: "library", cards } });
      await h.flush();
      const askedLook = seat.prompt?.type === "revealCards";
      const acked = h.effects.slice(from).some((e) => e.relay && /revealCardsAcknowledged/.test(JSON.stringify(e.relay)));
      const log = h.effects.slice(from).filter((e) => e.tts?.t === "gamelog").flatMap((e) => e.tts.lines);
      if (askedLook) seat.prompt = null;
      const mark = h.effects.length;
      if (next) { h.B.onPrompt(seat, { promptId: 941, decidingPlayerId: "player-0", input: next }); await h.flush(); }
      const chat = h.effects.slice(mark).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);
      harness.restore();
      return { askedLook, acked, log, chat, held: seat.heldLook };
    };
    const pick = { type: "chooseCards", cards: [cards[0]], min: 0, max: 1, presentation: { title: "Choose an instant card" } };
    let r = await run(DIG, pick);
    ok("dig look: not asked, answered for the player", !r.askedLook && r.acked, JSON.stringify(r));
    ok("dig look: the log still says a look happened, no names", JSON.stringify(r.log) === JSON.stringify(["Blue looked at 3 cards (their library)"]), JSON.stringify(r.log));
    ok("dig look: a pick from those cards says nothing more", !r.chat.some((t) => /looked at the top/.test(t)) && r.held == null, JSON.stringify(r.chat));
    r = await run(DIG, { type: "chooseAction", actions: [{ id: "pass", type: "pass", label: "Pass priority" }] });
    ok("dig look: with no pick next, what was seen is said in chat", r.chat.includes("[MTG] You looked at the top 3 cards of your library: Opt, Island, Bear. None of them could be chosen."), JSON.stringify(r.chat));
    r = await run("Look at the top three cards of your library, then put them back in any order.", null);
    ok("dig look: Ponder's look (no pick from among them) is still asked", r.askedLook && !r.acked, JSON.stringify(r));
    r = await run("Reveal the top card of your library and put that card into your hand.", null);
    ok("dig look: a reveal isn't skipped", r.askedLook, JSON.stringify(r));
  }
  // the table's sounds (docs/m5-effects-design.md section 6): "ins" on an instant spell only (isInstantCast: not an
  // ability, not a sorcery, not one still being cast), and "exd" for battlefield -> exile by the engine's word, once
  {
    const h = harness.load();
    const seat = setup(h, F.board);
    const gv = seat.board.state.gameView;
    const hand = gv.zones.find((z) => z.zone === "hand" && z.ownerId === "player-0");
    const inst = (id, name, types, text) => ({ id, identity: { name }, types, text, controllerId: "player-0", ownerId: "player-0" });
    hand.cards.push(inst("engine-card-901", "Shock", ["Instant"], "Shock deals 2 damage to any target."), inst("engine-card-902", "Farseek", ["Sorcery"], "Search your library for a land."),
      inst("engine-card-903", "Opt", ["Instant"], "Scry 1. Draw a card."));
    gv.events = [];
    h.B.sendTable(); await h.flush(); // (seen in Blue's hand)
    hand.cards = hand.cards.filter((c) => !/^engine-card-90[123]$/.test(c.id));
    const gy = gv.zones.find((z) => z.zone === "graveyard" && z.ownerId === "player-0");
    gy.cards.push(inst("engine-card-904", "Censor", ["Instant"], "Counter target spell unless its controller pays {1}.\nCycling {U}"));
    const item = (id, src, name, extra) => ({ id, sourceId: src, controllerId: "player-0", ownerId: "player-0", identity: { name }, isPermanentSpell: false, isCasting: false, targets: [], text: name, ...extra });
    gv.stack = [
      item("engine-stack-1", "engine-card-901", "Shock", { sourceAbilityText: "Shock deals 2 damage to any target." }),
      item("engine-stack-2", "engine-card-902", "Farseek", { sourceAbilityText: "Search your library for a Plains, Island, Swamp, or Mountain card." }),
      item("engine-stack-3", "engine-card-904", "Censor", { sourceAbilityText: "Cycling {U} ({U}, Discard this card: Draw a card.)" }),
      item("casting-77", "engine-card-903", "Opt", { sourceAbilityText: "Scry 1. Draw a card.", isCasting: true }),
      item("engine-stack-4", "engine-card-905", "Shock", { sourceAbilityText: "Shock deals 2 damage to any target." }), // (a copy: by name; the table tells it)
      item("engine-stack-5", "engine-card-906", "Fury", { sourceAbilityText: "When Fury enters, it deals 4 damage divided as you choose among any number of target creatures." }),
      item("engine-stack-6", "engine-card-907", "Grizzly Bears", { isPermanentSpell: true }),
    ];
    gv.events = [{ seq: 1, id: "event-1", cardId: "engine-card-950", from: "Battlefield", to: "Exile", ownerId: "player-1" },
      { seq: 2, id: "event-2", cardId: "engine-card-951", from: "Graveyard", to: "Exile", ownerId: "player-1" }];
    const mark = sent(h, "table").length;
    h.B.sendTable(); await h.flush();
    // (the board this sendTable sent: a picture arriving during the flush sends another after it)
    const tb = sent(h, "table")[mark] || {};
    const ins = Object.fromEntries((tb.stack || []).map((s) => [s.id, !!s.ins]));
    ok("sounds: an instant spell on the stack is marked ins", ins["engine-stack-1"] === true, JSON.stringify(ins));
    ok("sounds: a sorcery is not", ins["engine-stack-2"] === false, JSON.stringify(ins));
    ok("sounds: an instant's ability (cycling) is not", ins["engine-stack-3"] === false, JSON.stringify(ins));
    ok("sounds: an instant still being cast is not", ins["casting-77"] === false, JSON.stringify(ins));
    ok("sounds: an unseen card by an instant's name is marked (copies are the table's to tell)", ins["engine-stack-4"] === true, JSON.stringify(ins));
    // (sp, 2026-11-11: the table's COUNTERED pop-up took only `spell`, false for any spell with spell text)
    const sp = Object.fromEntries((tb.stack || []).map((s) => [s.id, [!!s.spell, !!s.sp]]));
    ok("countered: an instant and a sorcery are marked sp (spell false)", JSON.stringify([sp["engine-stack-1"], sp["engine-stack-2"], sp["engine-stack-4"]]) === "[[false,true],[false,true],[false,true]]", JSON.stringify(sp));
    ok("countered: an activated ability (cycling) and a trigger are not", JSON.stringify([sp["engine-stack-3"], sp["engine-stack-5"]]) === "[[false,false],[false,false]]", JSON.stringify(sp));
    ok("countered: a permanent spell stays spell, with no sp", JSON.stringify(sp["engine-stack-6"]) === "[true,false]", JSON.stringify(sp));
    ok("sounds: exd names the battlefield -> exile move only", JSON.stringify(tb.exd) === '["engine-card-950"]', JSON.stringify(tb.exd));
    gv.players.find((p) => p.id === "player-0").life -= 1;
    h.B.sendTable(); await h.flush();
    const later = sent(h, "table").slice(mark + 1);
    ok("sounds: exd goes once", later.length > 0 && later.every((t) => t.exd === undefined), JSON.stringify(later.map((t) => t.exd)));
    harness.restore();
  }
  // whom Hero of Bladehold's attacking tokens attack, asked over Forge's labels (entityChoiceIds, entityWords; live check
  // 2026-11-11: a dead Jace Beleren in a graveyard left the live one unmapped, and the list came as "Hero of Bladehold:
  // choose one" over "self-hosted-node-77-bot", "Jace Beleren (201)")
  {
    const HERO = "Battle cry (Whenever this creature attacks, each other attacking creature gets +1/+0 until end of turn.)\nWhenever Hero of Bladehold attacks, create two 1/1 white Soldier creature tokens that are tapped and attacking.";
    const JACE = (id) => ({ id, identity: { name: "Jace Beleren" }, types: ["Planeswalker"], controllerId: "player-1", ownerId: "player-1", loyalty: 3, text: "+2: Each player draws a card." });
    const HERO_TRIGGER = "Whenever Hero of Bladehold attacks, create two 1/1 white Soldier creature tokens that are tapped and attacking.";
    const hero = async (edit, labels = ["self-hosted-node-77-bot", "Jace Beleren (201)"], text = HERO_TRIGGER) => {
      const h = harness.load();
      const b = clone(F.board);
      const gv = b.gameView;
      for (const z of gv.zones) if (z.zone === "battlefield") z.cards = [];
      Object.assign(gv, { activePlayerId: "player-0", priorityPlayerId: "player-0", step: "combatDeclareAttackers", stack: [] });
      gv.zones.find((z) => z.zone === "battlefield" && z.ownerId === "player-0").cards.push({ id: "engine-card-1301", identity: { name: "Hero of Bladehold" }, types: ["Creature"], power: 3, toughness: 4, controllerId: "player-0", ownerId: "player-0", text: HERO, isAttacking: true });
      edit(gv);
      const seat = setup(h, b);
      h.B.onPrompt(seat, { promptId: 900, decidingPlayerId: "player-0", sourceAbilityText: text,
        sourceCard: { id: "engine-card-1301", identity: { name: "Hero of Bladehold" } },
        input: { type: "chooseFromSelection", minTotal: 1, maxTotal: 1, presentation: { title: "Choose which defender to attack with Soldier Token", targets: [] }, options: labels.map((label) => ({ label, weight: 1 })) } });
      await h.flush();
      return { h, seat };
    };
    const theirs = (gv, z) => gv.zones.find((x) => x.zone === z && x.ownerId === "player-1");
    const relayed = (h) => h.effects.filter((e) => e.relay && /selectionDecision/.test(JSON.stringify(e.relay))).map((e) => JSON.stringify(e.relay));
    // the one on the battlefield, another in the graveyard: the target question, the planeswalker clicked
    let { h, seat } = await hero((gv) => { theirs(gv, "battlefield").cards.push(JACE("engine-card-1302")); theirs(gv, "graveyard").cards.push(JACE("engine-card-1303")); });
    const ui = seat.prompt?.ui || {};
    ok("hero: a dead Jace in the graveyard leaves the live one mapped", ui.kind === "target" && JSON.stringify((ui.options || []).map((o) => o.id)) === JSON.stringify(["player|player-1", "card|engine-card-1302"]), JSON.stringify(ui));
    ok("hero: the mapped question says what it is for", ui.title === "Hero of Bladehold: attack which player or planeswalker?", ui.title);
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: ["card|engine-card-1302"] }) }); await h.flush(5);
    ok("hero: the clicked planeswalker goes back as its option's number", relayed(h).some((r) => /"chosenIndices":\[1\]/.test(r)), JSON.stringify(relayed(h)));
    harness.restore();
    // two on the battlefield: asked in words, no Forge numbers, whose they are said, the two numbered
    ({ h, seat } = await hero((gv) => theirs(gv, "battlefield").cards.push(JACE("engine-card-1302"), JACE("engine-card-1304"))));
    const words = seat.prompt?.ui || {};
    const said = (words.options || []).map((o) => o.label);
    ok("hero: two Jaces: the question says the token attacks", words.title === "Hero of Bladehold: the token attacks whom?", words.title);
    ok("hero: two Jaces: the player by table name, the Jace by whose it is, never \"(201)\"", JSON.stringify(said) === JSON.stringify(["AI 1", "Jace Beleren (AI 1's planeswalker)"]), JSON.stringify(said));
    h.B.onTTS({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 900, choice: [String((words.options || [])[1]?.id)] }) }); await h.flush(5);
    ok("hero: two Jaces: the answer goes back as the option's number", relayed(h).some((r) => /"chosenIndices":\[1\]/.test(r)), JSON.stringify(relayed(h)));
    harness.restore();
    // (both offered: numbered apart)
    ({ h, seat } = await hero((gv) => theirs(gv, "battlefield").cards.push(JACE("engine-card-1302"), JACE("engine-card-1304")), ["self-hosted-node-77-bot", "Jace Beleren (201)", "Jace Beleren (204)"]));
    const both = (seat.prompt?.ui?.options || []).map((o) => o.label);
    ok("hero: two Jaces offered are numbered apart", JSON.stringify(both) === JSON.stringify(["AI 1", "Jace Beleren (AI 1's planeswalker) #1", "Jace Beleren (AI 1's planeswalker) #2"]), JSON.stringify(both));
    harness.restore();
    // "whom it attacks" only for a defender's choice: what can be attacked (a battle too), from a card that puts creatures
    // onto the battlefield attacking. "attacking" alone, or a list of creatures, is no such choice (verify 2026-11-11)
    const askedUi = async (edit, labels, text) => { const r = await hero(edit, labels, text); const ui = r.seat.prompt?.ui || {}; harness.restore(); return ui; };
    const titled = async (edit, labels, text) => (await askedUi(edit, labels, text)).title;
    const BATTLE = (id) => ({ id, identity: { name: "Invasion of Zendikar" }, types: ["Battle"], controllerId: "player-1", ownerId: "player-1", text: "" });
    const BEARS = (id) => ({ id, identity: { name: "Grizzly Bears" }, types: ["Creature"], controllerId: "player-1", ownerId: "player-1", text: "" });
    const twoJaces = (gv) => theirs(gv, "battlefield").cards.push(JACE("engine-card-1302"), JACE("engine-card-1304"));
    const battles = await askedUi((gv) => theirs(gv, "battlefield").cards.push(BATTLE("engine-card-1305"), BATTLE("engine-card-1306")), ["self-hosted-node-77-bot", "Invasion of Zendikar (205)"]);
    ok("hero: two battles: the token attacks whom", battles.title === "Hero of Bladehold: the token attacks whom?", battles.title);
    ok("hero: two battles: a battle said as one", JSON.stringify((battles.options || []).map((o) => o.label)) === JSON.stringify(["AI 1", "Invasion of Zendikar (AI 1's battle)"]), JSON.stringify(battles.options));
    const noPlayer = await titled(twoJaces, ["Jace Beleren (201)", "Jace Beleren (204)"]);
    ok("hero: no player among them is no defender's choice", noPlayer === "Hero of Bladehold: choose which planeswalker?", noPlayer);
    // (a face-down permanent of that name is no click: Forge's number may mean it, and the table can't show it)
    const hidden = await askedUi((gv) => theirs(gv, "battlefield").cards.push({ ...JACE("engine-card-1302"), isFaceDown: true }));
    ok("hero: a face-down one of that name is not clicked", hidden.kind !== "target" && hidden.title === "Hero of Bladehold: choose which player or card?", JSON.stringify(hidden));
    const bears = await titled((gv) => theirs(gv, "battlefield").cards.push(BEARS("engine-card-1307"), BEARS("engine-card-1308")), ["self-hosted-node-77-bot", "Grizzly Bears (207)"]);
    ok("hero: a list of creatures is no defender's choice", bears === "Hero of Bladehold: choose which player or permanent?", bears);
    const dealt = await titled(twoJaces, undefined, "Each attacking creature you control deals 1 damage to a player or planeswalker of your choice.");
    ok("hero: \"attacking\" with nothing put onto the battlefield is no defender's choice", dealt === "Hero of Bladehold: choose which player or planeswalker?", dealt);
    const put = await titled(twoJaces, undefined, "Put a creature card from your hand onto the battlefield tapped and attacking.");
    ok("hero: a card put onto the battlefield attacking: attack whom", put === "Hero of Bladehold: attack whom?", put);
  }
  console.log(failed ? `\n${failed} claim checks failed (${passed} passed)` : `all ${passed} claim checks pass`);
  process.exit(failed ? 1 : 0);
})();
