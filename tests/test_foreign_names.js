// Decks with cards printed in another language, and non-ASCII names on the way in and out (2026-11-12: a deck's
// Japanese "アクローマの意志" and "嵐の伝導者、ラル" were "unknown to the engine", shown in the chat as
// "ã¢ã¯ã­ã¼ãã®æå¿", and the deck counted 98).
// - names: the English name from Scryfall, by the printing's id in the face picture link (/cards/collection), else by a
//   search on the printed name in any language; asked once (foreign-names.json), the deck checked once they answer
// - text: a name that arrives as its UTF-8 bytes one character each (as TTS sent it) is read as that UTF-8, through both
//   of the bridge's ports; what goes back to TTS is that text UTF-8 encoded once
// Scryfall is a fake here: no request leaves this process.
//   node tests/test_foreign_names.js
const fs = require("fs");
const net = require("net");
const { PassThrough } = require("stream");
const { EventEmitter } = require("events");
const harness = require("./bridge-harness");
const realImmediate = setImmediate; // (the harness runs setImmediate on its own clock)

let failed = 0, passed = 0;
// (stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };

const AKROMA = "アクローマの意志", RAL = "嵐の伝導者、ラル";
// what the bridge was handed live: each UTF-8 byte of the name as one character (tmp/table-log.log, 2026-11-12)
const asBytes = (s) => Buffer.from(s, "utf8").toString("latin1");
const AKROMA_ID = "03166c80-3b42-4e87-9210-e737cb8d33f9", RAL_ID = "3aaf86e6-c171-4c9a-a64b-d01a42883928";
const pic = (id) => `https://img.klrmngr.com/display/front/${id[0]}/${id[1]}/${id}.webp`;
const NEHEB = { n: "Neheb, the Eternal", f: "https://img.klrmngr.com/display/front/4/4/44444444-0000-4000-8000-00000000000d.webp" };
const deck = (library, deckName = "JP") => ({ deckName, commander: [NEHEB], library });

// Scryfall as it answered on 2026-11-12 (read-only probes): /cards/collection by id gives the English `name`;
// /cards/search?q=!"<printed>" lang:any finds the printing, 404 when nothing matches
const ENGLISH = { [AKROMA_ID]: "Akroma's Will", [RAL_ID]: "Ral, Storm Conduit" };
const PRINTED = { [AKROMA]: "Akroma's Will", [RAL]: "Ral, Storm Conduit", "Voluntad de Akroma": "Akroma's Will" };
function fakeScryfall(h, mode = "up") {
  const calls = [];
  global.fetch = async (url, o = {}) => {
    const u = String(url);
    calls.push({ url: u, method: o.method || "GET", body: o.body ? JSON.parse(o.body) : null, at: Date.now(), ua: o.headers?.["User-Agent"] });
    if (mode === "down") throw new TypeError("fetch failed");
    const json = (status, data) => ({ ok: status === 200, status, json: async () => data });
    if (u.startsWith("https://api.scryfall.com/cards/collection")) {
      const ids = JSON.parse(o.body).identifiers.map((i) => i.id);
      return json(200, { data: ids.filter((id) => ENGLISH[id]).map((id) => ({ id, lang: "ja", name: ENGLISH[id] })), not_found: ids.filter((id) => !ENGLISH[id]).map((id) => ({ id })) });
    }
    if (u.startsWith("https://api.scryfall.com/cards/search")) {
      const q = new URL(u).searchParams.get("q") || "";
      const printed = /^!"(.*)" lang:any$/.exec(q)?.[1];
      return PRINTED[printed] ? json(200, { data: [{ id: "x", name: PRINTED[printed], printed_name: printed }] }) : json(404, { object: "error", code: "not_found" });
    }
    if (u.includes("img.klrmngr.com")) return json(200, {}); // (the deck picture check)
    return json(404, {});
  };
  return calls;
}
// the frames sent to TTS, as written to the socket (the harness records only their decoded messages)
function framesToTTS() {
  const frames = [];
  const inner = net.connect;
  net.connect = (...a) => { const s = inner(...a); const end = s.end; s.end = (d) => { frames.push(d); return end.call(s, d); }; return s; };
  return frames;
}
// with no foreign-names.json on disk (or this one)
function cacheOnDisk(content = null) {
  const inner = fs.readFileSync;
  fs.readFileSync = (p, ...a) => {
    if (String(p).endsWith("foreign-names.json")) { if (content == null) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; } return JSON.stringify(content); }
    return inner(p, ...a);
  };
}
const toTTS = (h) => h.effects.filter((e) => e.tts).map((e) => e.tts);
const chats = (h) => toTTS(h).filter((m) => m.t === "chat").map((m) => m.text);
const reports = (h) => toTTS(h).filter((m) => m.t === "deckReport");

(async () => {
  // 1. The live case through the table's web port (/msg, readBody): names as UTF-8 bytes one character each, face links
  // naming the Japanese printings. The English names come by id, the deck is ready, the chat says what was translated
  // and shows the Japanese as it is (not mojibake), and the frame to TTS holds the name's UTF-8 bytes once.
  {
    const h = harness.load();
    cacheOnDisk();
    const calls = fakeScryfall(h);
    const frames = framesToTTS();
    const m = { t: "decks", json: JSON.stringify({ request: 7, seats: { White: deck([{ n: asBytes(AKROMA), f: pic(AKROMA_ID) }, { n: asBytes(RAL), f: pic(RAL_ID) }, { n: "Plains", f: null }]) } }) };
    // (the body as TTS put it on the wire: that text, UTF-8 encoded; cut inside a character, as a chunk edge can be)
    const bytes = Buffer.from(JSON.stringify(m), "utf8");
    const req = new PassThrough();
    let body = null;
    h.B._readBody(req, { writeHead() {}, end() {} }, (b) => { body = b; });
    const cut = bytes.indexOf(0xc2) + 1;
    req.write(bytes.subarray(0, cut)); req.end(bytes.subarray(cut));
    await new Promise((r) => realImmediate(r)); await new Promise((r) => realImmediate(r));
    ok("precondition: the body arrived", typeof body === "string" && body.includes("decks"));
    h.B.onTTS(JSON.parse(body));
    await h.flush();
    const said = chats(h);
    const first = reports(h)[0], last = reports(h).slice(-1)[0];
    ok("the table is answered at once (its request), before the lookup", first && first.request === 7 && first.ready.length === 0 && first.checked.length === 0, JSON.stringify(reports(h)));
    ok("then the deck is checked again: ready", last && last.request === -1 && last.ready.includes("White") && last.checked.includes("White"), JSON.stringify(last));
    ok("chat: the lookup is said", said.some((t) => /Looking up 2 card name\(s\)/.test(t)), JSON.stringify(said));
    const ready = said.find((t) => /White \(JP\): ready/.test(t)) || "";
    ok("chat: ready, every card known", /every card is known to the engine/.test(ready), JSON.stringify(said));
    ok("chat: the translations are named", ready.includes(`${AKROMA} → Akroma's Will`) && ready.includes(`${RAL} → Ral, Storm Conduit`), ready);
    ok("chat: no mojibake", !said.some((t) => /[Â-ô][\u0080-¿]/.test(t)), JSON.stringify(said));
    const deckNow = h.B._readyDecks.White;
    ok("the engine deck holds the English names", deckNow && deckNow.cards.includes("Akroma's Will") && deckNow.cards.includes("Ral, Storm Conduit") && deckNow.cards.length === 3, JSON.stringify(deckNow?.cards));
    ok("the printing's own picture is kept", deckNow?.images["Akroma's Will"]?.[0]?.face === pic(AKROMA_ID), JSON.stringify(deckNow?.images));
    const sf = calls.filter((c) => c.url.includes("api.scryfall.com"));
    ok("Scryfall: one request, by id, for both cards", sf.length === 1 && sf[0].url.endsWith("/cards/collection") && JSON.stringify(sf[0].body) === JSON.stringify({ identifiers: [{ id: AKROMA_ID }, { id: RAL_ID }] }), JSON.stringify(sf));
    ok("Scryfall: a plain User-Agent", sf.every((c) => c.ua === "mtg-tts-bridge"), JSON.stringify(sf.map((c) => c.ua)));
    const wire = frames.map((f) => Buffer.from(f, "utf8"));
    const chatFrame = wire.find((b) => b.includes(Buffer.from("Foreign names", "utf8")));
    ok("to TTS: the name's UTF-8 bytes, once", chatFrame && chatFrame.includes(Buffer.from(AKROMA, "utf8")), chatFrame && chatFrame.toString("utf8").slice(0, 300));
    ok("to TTS: never the bytes encoded twice", !wire.some((b) => b.includes(Buffer.from(asBytes(AKROMA), "utf8"))));
    const saved = h.effects.filter((e) => e.writeFile === "foreign-names.json.tmp");
    ok("cache: written once, to a temp file renamed into place", saved.length === 1 && h.effects.some((e) => e.rename && e.rename[1] === "foreign-names.json"), JSON.stringify(h.effects.filter((e) => e.writeFile || e.rename)));
    // the same deck again: no request, ready at once, still named
    calls.length = 0;
    h.B.onTTS(m); await h.flush();
    ok("again: nothing asked of Scryfall", !calls.some((c) => c.url.includes("api.scryfall.com")), JSON.stringify(calls));
    ok("again: ready at once, on the table's own request", reports(h).slice(-1)[0].request === 7 && reports(h).slice(-1)[0].ready.includes("White"));
    harness.restore();
  }
  // 2. The TTS socket (sendExternalMessage's port): the same bytes, in two chunks cut inside a character
  {
    const h = harness.load();
    cacheOnDisk({ [`id:${AKROMA_ID}`]: "Akroma's Will" }); // (found before: on disk)
    const calls = fakeScryfall(h);
    const sock = new EventEmitter();
    h.B._ttsServer.emit("connection", sock);
    const frame = { messageID: 4, customMessage: { t: "decks", json: JSON.stringify({ request: 3, seats: { Blue: deck([{ n: asBytes(AKROMA), f: pic(AKROMA_ID) }]) } }) } };
    const bytes = Buffer.from(JSON.stringify(frame), "utf8");
    const cut = bytes.indexOf(0xc3) + 1;
    sock.emit("data", bytes.subarray(0, cut)); sock.emit("data", bytes.subarray(cut)); sock.emit("end");
    await h.flush();
    const said = chats(h);
    ok("socket: ready, the name read from disk, nothing asked", said.some((t) => /Blue \(JP\): ready/.test(t) && t.includes(`${AKROMA} → Akroma's Will`)) && !calls.some((c) => c.url.includes("api.scryfall.com")), JSON.stringify([said, calls]));
    ok("socket: no lookup said", !said.some((t) => /Looking up/.test(t)), JSON.stringify(said));
    harness.restore();
  }
  // 3. No network: today's message, with the names shown as they are printed (not mojibake), and asked again next time
  {
    const h = harness.load();
    cacheOnDisk();
    const calls = fakeScryfall(h, "down");
    const m = { t: "decks", json: JSON.stringify({ request: 4, seats: { White: deck([{ n: asBytes(AKROMA), f: pic(AKROMA_ID) }, { n: asBytes(RAL), f: null }]) } }) };
    h.B.onTTS(m); await h.flush();
    const said = chats(h);
    const notReady = said.find((t) => /not ready/.test(t)) || "";
    ok("down: the engine doesn't know 2 cards, named as printed", notReady.includes(`the engine doesn't know 2 card(s): ${AKROMA}, ${RAL}`), JSON.stringify(said));
    ok("down: no translation claimed", !/Foreign names/.test(notReady), notReady);
    ok("down: the Ready button is told (not ready)", reports(h).slice(-1)[0].checked.includes("White") && !reports(h).slice(-1)[0].ready.includes("White"), JSON.stringify(reports(h)));
    ok("down: the lookup stopped at its first failure", calls.filter((c) => c.url.includes("api.scryfall.com")).length === 1, JSON.stringify(calls));
    ok("down: nothing written", !h.effects.some((e) => e.writeFile === "foreign-names.json.tmp"));
    calls.length = 0;
    h.B.onTTS(m); await h.flush();
    ok("down: the next Ready asks again", calls.some((c) => c.url.includes("api.scryfall.com")), JSON.stringify(calls));
    harness.restore();
  }
  // 4. A picture link with no printing id: the printed name is searched in every language (one request per name, the
  // name exact); a name nothing matches is asked once per run; requests ~8 a second at most
  {
    const h = harness.load();
    cacheOnDisk();
    const calls = fakeScryfall(h);
    const steam = "https://steamusercontent-a.akamaihd.net/ugc/1/ABC/";
    const lib = [{ n: "Voluntad de Akroma", f: steam }, { n: RAL, f: steam }, { n: RAL, f: steam }, { n: "Notacard Atall", f: steam }];
    h.B.onTTS({ t: "decks", json: JSON.stringify({ request: 5, seats: { Red: deck(lib, "ES") } }) }); await h.flush();
    const sf = calls.filter((c) => c.url.includes("api.scryfall.com"));
    const qs = sf.map((c) => new URL(c.url).searchParams.get("q"));
    ok("search: each name once, exact, any language", JSON.stringify(qs) === JSON.stringify([`!"Voluntad de Akroma" lang:any`, `!"${RAL}" lang:any`, `!"Notacard Atall" lang:any`]), JSON.stringify(qs));
    ok("search: foreign printings included", sf.every((c) => new URL(c.url).searchParams.get("include_multilingual") === "true"));
    ok("search: at least 100 ms apart", sf.every((c, i) => i === 0 || c.at - sf[i - 1].at >= 100), JSON.stringify(sf.map((c) => c.at)));
    const said = chats(h).find((t) => /Red \(ES\)/.test(t)) || "";
    ok("search: the found ones translated, the unknown one still unknown", said.includes("Voluntad de Akroma → Akroma's Will") && said.includes(`${RAL} → Ral, Storm Conduit`) && said.includes("the engine doesn't know 1 card(s): Notacard Atall"), said);
    calls.length = 0;
    h.B.onTTS({ t: "decks", json: JSON.stringify({ request: 6, seats: { Red: deck(lib, "ES") } }) }); await h.flush();
    ok("search: a name Scryfall doesn't have is not asked again this run", !calls.some((c) => c.url.includes("api.scryfall.com")), JSON.stringify(calls));
    ok("search: the second check answers the table's request at once", reports(h).slice(-1)[0].request === 6, JSON.stringify(reports(h).slice(-1)));
    harness.restore();
  }
  // 5. Text that is not UTF-8 bytes stays as it is: a Latin-1 name, a name already right, the engine's own names
  {
    const h = harness.load();
    cacheOnDisk();
    const calls = fakeScryfall(h);
    const lib = [{ n: "Séance", f: null }, { n: "Lórien Revealed", f: null }, { n: AKROMA, f: pic(AKROMA_ID) }];
    h.B.onTTS({ t: "decks", json: JSON.stringify({ request: 8, seats: { Yellow: deck(lib, "Mixed") } }) }); await h.flush();
    const r = h.B._readyDecks.Yellow;
    ok("latin-1: accented names known as they are", r && ["Séance", "Lórien Revealed", "Akroma's Will"].every((n) => r.cards.includes(n)), JSON.stringify(r?.cards));
    ok("latin-1: only the Japanese one asked", calls.filter((c) => c.url.includes("api.scryfall.com")).length === 1, JSON.stringify(calls));
    // (a deck name as UTF-8 bytes is read as UTF-8 too: every string of the table's message)
    h.B.onTTS({ t: "decks", json: JSON.stringify({ request: 9, seats: { Yellow: deck(lib, asBytes("日本語デッキ")) } }) }); await h.flush();
    ok("deck name: read as UTF-8", chats(h).some((t) => t.startsWith("[MTG] Yellow (日本語デッキ): ready")), JSON.stringify(chats(h).slice(-2)));
    harness.restore();
  }
  // 6. A check waiting on Scryfall never puts back a deck that was swapped (another deck readied meanwhile) or reset
  // (verifier 2026-11-12: deck A's late re-check overwrote deck B, and Start would have played A)
  {
    const h = harness.load();
    cacheOnDisk();
    fakeScryfall(h);
    const A = { t: "decks", json: JSON.stringify({ request: 10, seats: { White: deck([{ n: AKROMA, f: pic(AKROMA_ID) }], "A") } }) };
    const B = { t: "decks", json: JSON.stringify({ request: 11, seats: { White: deck([{ n: "Plains", f: null }, { n: "Island", f: null }], "B") } }) };
    h.B.onTTS(A); h.B.onTTS(B); // (B before A's lookup answers)
    await h.flush();
    ok("swap: the deck on the table (B) stays the ready one", h.B._readyDecks.White?.deckName === "B", JSON.stringify(h.B._readyDecks.White?.deckName));
    ok("swap: A's late check says nothing", !chats(h).some((t) => /White \(A\): ready/.test(t)), JSON.stringify(chats(h)));
    ok("swap: the last report is B's", reports(h).slice(-1)[0].request === 11, JSON.stringify(reports(h)));
    harness.restore();
  }
  {
    const h = harness.load();
    cacheOnDisk();
    fakeScryfall(h);
    h.B.onTTS({ t: "decks", json: JSON.stringify({ request: 12, seats: { White: deck([{ n: AKROMA, f: pic(AKROMA_ID) }], "A") } }) });
    h.B.onTTS({ t: "reset" });
    await h.flush();
    ok("reset: a check waiting on Scryfall doesn't ready the deck again", !h.B._readyDecks.White, JSON.stringify(h.B._readyDecks.White?.deckName));
    harness.restore();
  }
  // 7. Two seats in one message, one needing a lookup: both checked once, after it, in one report
  {
    const h = harness.load();
    cacheOnDisk();
    fakeScryfall(h);
    h.B.onTTS({ t: "decks", json: JSON.stringify({ request: 13, seats: { White: deck([{ n: AKROMA, f: pic(AKROMA_ID) }], "A"), Blue: deck([{ n: "Island", f: null }], "C") } }) });
    await h.flush();
    const last = reports(h).slice(-1)[0];
    ok("two seats: both ready in the last report", last.request === -1 && ["White", "Blue"].every((c) => last.ready.includes(c)), JSON.stringify(reports(h)));
    ok("two seats: each said ready once", chats(h).filter((t) => /: ready\./.test(t)).length === 2, JSON.stringify(chats(h)));
    harness.restore();
  }
  process.stdout.write(`${failed ? "FAILED" : "ok"}: ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL crashed: ${e.stack}\n`); process.exit(1); });
