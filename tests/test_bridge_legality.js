// The ban list data (docs/format-banlist-spec.md §4, §6.3, test 1 of §8; pure, no network): reduceOracleLine on a
// hand-made oracle_cards sample (tests/golden/fixtures/oracle-sample.jsonl: names real, statuses written by hand, no
// Scryfall data) against the reduced golden (tests/golden/legality-cache.json), the names a card is found by (each
// face of a double-faced card, both halves of a split card, an adventure's front, "A-" Alchemy names), the status
// letters, loadLegality's source order (the cache, else Forge's bridge/forge-legality.json, else nothing; a corrupt or
// wrong-shaped cache falls back and is logged), the content hash, the source words, the table's "banlist" and
// "banlistNames" messages, Forge's own file, and the bridge's "banlist" message handling and hello.
//   node tests/test_bridge_legality.js [--record]
const fs = require("fs");
const os = require("os");
const path = require("path");
const L = require("../bridge/legality.js");
const realImmediate = setImmediate; // (the harness freezes timers while a bridge is loaded)
const realWrite = fs.writeFileSync; // (and records file writes instead of making them)

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 600)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const FIXTURE = path.join(__dirname, "golden", "fixtures", "oracle-sample.jsonl");
const GOLDEN = path.join(__dirname, "golden", "legality-cache.json");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "legality-test-"));
const reduceLines = (lines, updatedAt = "2026-11-18T10:01:54.000+00:00") => {
  const out = L.newReduction();
  for (const line of lines) L.reduceOracleLine(line, out);
  return L.finishReduction(out, { updatedAt });
};
const lines = fs.readFileSync(FIXTURE, "utf8").split("\n");
const cache = reduceLines(lines);
const logs = [];
const use = (o = {}) => { L._reset(); L.configure({ cacheFile: path.join(dir, "none.json"), forgeFile: path.join(dir, "none-forge.json"), log: (s) => logs.push(s), now: () => Date.parse("2026-11-19T12:00:00Z"), ...o }); };
const write = (name, data) => { const f = path.join(dir, name); realWrite(f, typeof data === "string" ? data : JSON.stringify(data)); return f; };

(async () => {
  try {
    // ── the reduction ──
    if (process.argv.includes("--record")) { fs.writeFileSync(GOLDEN, JSON.stringify(cache, null, 1) + "\n"); console.log(`recorded ${GOLDEN}`); }
    const golden = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
    same("reduce: the sample reduces to the golden cache", cache, golden);
    same("reduce: lines read, cards kept, lines skipped (a line that isn't JSON, a card with no legalities; a token is no card, not a skip)",
      cache.stats, { read: 19, kept: 16, skipped: 2 });
    same("reduce: the keys are Scryfall's, in the fixed order", cache.keys, L.KEYS);
    ok("reduce: no token among the cards", !("soldier" in cache.cards));
    same("reduce: a double-faced card under its full name and each face", ["delver of secrets // insectile aberration", "delver of secrets", "insectile aberration"].map((n) => n in cache.cards), [true, true, true]);
    same("reduce: a split card under 'A // B' and each half", ["fire // ice", "fire", "ice"].map((n) => n in cache.cards), [true, true, true]);
    same("reduce: an adventure under its full name and each part", ["bonecrusher giant // stomp", "bonecrusher giant", "stomp"].map((n) => n in cache.cards), [true, true, true]);
    ok("reduce: an Alchemy 'A-' card stays under its own name, apart from the card it rebalances",
      cache.cards["a-alrund's epiphany"] && cache.cards["alrund's epiphany"] && cache.cards["a-alrund's epiphany"] !== cache.cards["alrund's epiphany"], JSON.stringify([cache.cards["a-alrund's epiphany"], cache.cards["alrund's epiphany"]]));
    const legal = (o = {}) => Object.fromEntries(L.KEYS.map((k) => [k, o[k] || "legal"]));
    const pair = reduceLines([JSON.stringify({ name: "Grizzly Bears", layout: "normal", legalities: legal() }),
      JSON.stringify({ name: "Bear Cub // Grizzly Bears", layout: "transform", card_faces: [{ name: "Bear Cub" }, { name: "Grizzly Bears" }], legalities: legal({ modern: "banned" }) })]);
    ok("reduce: a full name is never overwritten by another card's face", pair.cards["grizzly bears"] === "l".repeat(L.KEYS.length), pair.cards["grizzly bears"]);
    const partial = reduceLines([JSON.stringify({ name: "Grizzly Bears", layout: "normal", legalities: { modern: "legal" } })]);
    same("reduce: a key missing from a card's legalities is not legal", partial.cards["grizzly bears"]?.[L.KEYS.indexOf("legacy")], "n");
    const split = reduceLines([JSON.stringify({ name: "Fire // Ice", layout: "split", card_faces: [{ name: "Fire" }, { name: "Ice" }], legalities: legal({ modern: "banned" }) })]);
    same("reduce: a banned split card is listed as 'A // B'", split.formats.modern.banned, ["Fire // Ice"]);
    same("reduce: Vintage's restricted list", cache.formats.vintage.restricted, ["Black Lotus", "Brainstorm", "Mana Crypt", "Sol Ring"]);
    same("reduce: a banned list keeps an adventure's and a DFC's front face, a split card's both halves", cache.formats.pauper.banned, ["Delver of Secrets"]);
    same("reduce: Commander's banned list", cache.formats.commander.banned, ["Black Lotus", "Emrakul, the Aeons Torn", "Mana Crypt"]);
    same("reduce: the colour identity kept", [cache.identity["fire // ice"], cache.identity["black lotus"]], ["UR", ""]);
    same("reduce: Scryfall's array file (download_uri: '[', a card a line with a comma, ']') reads the same",
      reduceLines(["[", ...lines.filter(Boolean).map((l) => `${l},`), "]"]).hash, cache.hash);

    // ── the hash ──
    same("hash: the same cards in another order hash the same", reduceLines(lines.slice().reverse()).hash, cache.hash);
    same("hash: the date is not in the hash", reduceLines(lines, "2026-11-20T10:00:00Z").hash, cache.hash);
    const changed = lines.map((l) => (l.includes('"Grizzly Bears"') ? l.replace('"modern":"legal"', '"modern":"not_legal"') : l));
    ok("hash: one card's status changed (no list changed) changes the hash", changed.join() !== lines.join() && reduceLines(changed).hash !== cache.hash);

    // ── loading: the source order ──
    const forge = { source: "forge", date: "2026-09-21", keys: ["commander", "modern"], formats: { commander: { banned: ["Mana Crypt"], restricted: [] }, modern: { banned: ["Up the Beanstalk"], restricted: [] } },
      cards: { "mana crypt": "bn", "up the beanstalk": "lb", "lightning bolt": "ll" } };
    forge.hash = L.hashOf(forge.keys, forge.formats, forge.cards);
    const forgeFile = write("forge.json", forge);
    const cacheFile = write("cache.json", cache);
    use({ cacheFile, forgeFile });
    let l = L.loadLegality();
    same("load: the cache first", [l.source, l.date, l.hash], ["scryfall", "2026-11-18", cache.hash]);
    use({ forgeFile });
    l = L.loadLegality();
    same("load: no cache: Forge's file", [l.source, l.date], ["forge", "2026-09-21"]);
    same("load: Forge's file has only its formats", [l.has("modern"), l.has("duel"), l.missing().length], [true, false, 12]);
    use();
    l = L.loadLegality();
    same("load: neither: no source, every status null", [l.source, l.date, l.status("modern", "Lightning Bolt"), l.has("modern")], [null, null, null, false]);
    same("load: neither: every format missing", l.missing(), L.KEYS);
    logs.length = 0;
    use({ cacheFile: write("corrupt.json", "{\"source\":\"scryfall\",\"keys\":[\"comm"), forgeFile });
    l = L.loadLegality();
    ok("load: a corrupt cache falls back to Forge's file", l.source === "forge", l.source);
    ok("load: the corrupt cache is logged", logs.some((s) => /corrupt\.json unreadable/.test(s)), logs.join(" | "));
    logs.length = 0;
    use({ cacheFile: write("shape.json", { ...cache, cards: { "lightning bolt": "ll" } }), forgeFile });
    l = L.loadLegality();
    ok("load: a cache whose status strings don't fit its keys falls back", l.source === "forge" && logs.some((s) => /wrong shape/.test(s)), `${l.source} ${logs.join(" | ")}`);
    use({ cacheFile, forgeFile });
    ok("load: read once, then kept", L.loadLegality() === L.loadLegality());

    // ── status, list, has ──
    l = L.loadLegality();
    same("status: legal, banned, restricted, not legal", [l.status("modern", "Lightning Bolt"), l.status("legacy", "Black Lotus"), l.status("vintage", "Black Lotus"), l.status("standard", "Lightning Bolt")], ["l", "b", "r", "n"]);
    same("status: case and spacing don't matter", [l.status("modern", "lightning  BOLT"), l.status("modern", " Lightning Bolt ")], ["l", "l"]);
    same("status: accents and curly quotes are the bridge's normName", [l.status("legacy", "Jotun Grunt"), l.status("commander", "Thassa’s Oracle")], ["l", "l"]);
    same("status: a split card by 'A // B', a half, or 'A // something'", [l.status("modern", "Fire // Ice"), l.status("modern", "Ice"), l.status("modern", "Fire // Anything")], ["l", "l", "l"]);
    same("status: a DFC by its front face (the engine's name) or its back", [l.status("pauper", "Delver of Secrets"), l.status("pauper", "Insectile Aberration")], ["b", "b"]);
    same("status: a split card as Arena writes it ('A /// B'), or 'A/B', or 'A / B'", [l.status("modern", "Fire /// Ice"), l.status("modern", "Fire/Ice"), l.status("modern", "Fire / Ice")], ["l", "l", "l"]);
    {
      const vial = reduceLines([JSON.stringify({ name: "Aether Vial", layout: "normal", legalities: legal({ pauper: "not_legal" }) })]);
      use({ cacheFile: write("vial.json", vial) });
      const v = L.loadLegality();
      same("status: an 'Æ' name is found by Scryfall's 'Ae' spelling", [v.status("modern", "Æther Vial"), v.status("modern", "æther vial"), v.status("pauper", "Æther Vial")], ["l", "l", "n"]);
      use({ cacheFile, forgeFile });
    }
    same("status: an adventure by its front", l.status("pauper", "Bonecrusher Giant"), "n");
    same("status: an un-card is not legal in Commander", l.status("commander", "Mox Lotus"), "n");
    same("status: an unknown card is null (not checked, not 'not legal')", l.status("modern", "Some Card Printed Tomorrow"), null);
    same("status: an unknown format, or one with no list, is null", [l.status("casualcommander", "Sol Ring"), l.status("casual60", "Sol Ring"), l.status("nope", "Sol Ring")], [null, null, null]);
    same("has: the 15 formats yes, the casual ones no", [L.KEYS.every((k) => l.has(k)), l.has("casualcommander"), l.has("casual60")], [true, false, false]);
    same("list: a format's names", l.list("duel"), { banned: ["Black Lotus", "Emrakul, the Aeons Torn", "Mana Crypt", "Sol Ring"], restricted: [] });
    same("list: none for a format with no list", l.list("casualcommander"), { banned: [], restricted: [] });
    l.list("duel").banned.push("Grizzly Bears");
    same("list: a copy (the caller can't change the data)", l.list("duel").banned.length, 4);

    // ── the words, old data ──
    same("words: Scryfall and the day", L.sourceWords(l), "Scryfall, 2026-11-18");
    use({ cacheFile, forgeFile, now: () => Date.parse("2026-11-27T12:00:00Z") });
    same("words: older than 7 days says so", L.sourceWords(), "Scryfall, 2026-11-18 (old: offline?)");
    use({ forgeFile });
    same("words: Forge", L.sourceWords(), "Forge, 2026-09-21");
    use();
    same("words: nothing", L.sourceWords(), "none");

    // ── the change summary ──
    use({ cacheFile, forgeFile });
    const before = L.loadLegality();
    const moreBans = JSON.parse(JSON.stringify(cache));
    moreBans.formats.modern.banned.push("Grizzly Bears", "Lightning Bolt");
    moreBans.formats.vintage.restricted = moreBans.formats.vintage.restricted.filter((n) => n !== "Brainstorm");
    moreBans.formats.commander.banned = moreBans.formats.commander.banned.filter((n) => n !== "Mana Crypt");
    moreBans.hash = "x";
    use({ cacheFile: write("more.json", moreBans), forgeFile });
    same("summary: counts per changed format", L.changeSummary(before, L.loadLegality()), "Ban lists updated (Scryfall, 2026-11-18): Commander -1 banned, Modern +2 banned, Vintage -1 restricted.");

    // ── the table's messages ──
    use({ cacheFile, forgeFile });
    same("message: banlist", L.banlistMessage("vintage"), { t: "banlist", format: "vintage", source: "scryfall", date: "2026-11-18", counts: { banned: 0, restricted: 4 }, missing: [] });
    same("message: banlistNames", L.banlistNamesMessage("commander"), { t: "banlistNames", format: "commander", source: "scryfall", date: "2026-11-18", banned: ["Black Lotus", "Emrakul, the Aeons Torn", "Mana Crypt"], restricted: [] });
    use({ forgeFile });
    same("message: banlist from Forge's file says which formats have no list", L.banlistMessage("modern").missing, L.KEYS.filter((k) => k !== "commander" && k !== "modern"));

    // ── Forge's own file (bridge/forge-legality.json, tools/build-forge-card-index.js --legality) ──
    use({ forgeFile: path.join(__dirname, "..", "bridge", "forge-legality.json") });
    l = L.loadLegality();
    same("forge file: loads as Forge's", l.source, "forge");
    same("forge file: Duel Commander and Pauper Commander need Scryfall", l.missing(), ["duel", "paupercommander"]);
    same("forge file: statuses", [l.status("vintage", "Black Lotus"), l.status("legacy", "Black Lotus"), l.status("modern", "Lightning Bolt"), l.status("pauper", "Black Lotus"), l.status("standard", "Lightning Bolt"), l.status("commander", "Sol Ring")],
      ["r", "b", "l", "n", "n", "l"]);
    same("forge file: a split card and a DFC face", [l.status("modern", "Fire // Ice"), l.status("modern", "Insectile Aberration")], ["l", "l"]);

    // ── the bridge: the table's "banlist" messages and hello ──
    const harness = require("./bridge-harness");
    const run = async (fn) => { const h = harness.load(); try { return await fn(h); } finally { harness.restore(); } };
    const sent = (h, t) => h.effects.filter((e) => e.tts?.t === t).map((e) => e.tts);
    const say = (h, t, m) => h.B.onTTS({ t, json: JSON.stringify(m) });
    await run(async (h) => {
      h.B._legality._reset();
      h.B._legality.configure({ cacheFile, forgeFile, log: () => {} });
      say(h, "banlist", { t: "banlist", color: "White", format: "vintage" });
      await h.flush();
      same("bridge: {format} answers banlistNames", sent(h, "banlistNames"), [L.banlistNamesMessage("vintage")]);
      say(h, "banlist", { t: "banlist", color: "White", format: "casualcommander" });
      await h.flush();
      same("bridge: a format with no list answers banlist (counts 0, the missing formats)", sent(h, "banlist").map((m) => [m.format, m.counts]), [["casualcommander", { banned: 0, restricted: 0 }]]);
      const mark = h.effects.length;
      say(h, "hello", { t: "hello", color: "White", format: "modern" });
      await h.flush();
      same("bridge: hello with a format sends banlist once", h.effects.slice(mark).filter((e) => e.tts?.t === "banlist").map((e) => e.tts), [L.banlistMessage("modern")]);
      const mark2 = h.effects.length;
      say(h, "hello", { t: "hello", color: "White" });
      say(h, "hello", { t: "hello", color: "White", format: "modern", again: true });
      await h.flush();
      same("bridge: an older table's hello (no format) and a repeat hello send none", h.effects.slice(mark2).filter((e) => e.tts?.t === "banlist").length, 0);
    });
    // the host's refresh: the check, the answer to the host, banlist again; a change is said to everyone
    const zlib = require("zlib");
    const refreshWorld = (h, updatedAt, edit) => {
      const old = JSON.parse(JSON.stringify(cache));
      if (edit) { edit(old); old.hash = L.hashOf(old.keys, old.formats, old.cards); }
      const file = write(`refresh-${updatedAt.replace(/[^0-9A-Za-z-]/g, "_")}.json`, old); // (no ":" in a Windows file name)
      const stub = async (url) => (String(url) === L.META_URL ? { ok: true, status: 200, json: async () => ({ updated_at: updatedAt, jsonl_download_uri: "https://data.example/cards.jsonl.gz" }) }
        : new Response(zlib.gzipSync(fs.readFileSync(FIXTURE)), { status: 200 }));
      h.B._legality._reset();
      h.B._legality.onLegalityChanged(h.B._onBanlistChanged); // (this bridge copy's own, as the bridge registers it at load)
      // (the worker's own download is test 3's: here the reduction is written with the real fs the harness hides)
      const runWorker = async (job) => { const red = reduceLines(lines, job.updatedAt); realWrite(job.outFile, JSON.stringify(red)); return { ok: true, hash: red.hash }; };
      h.B._legality.configure({ cacheFile: file, forgeFile, minCards: 1, log: () => {}, busy: () => false, now: () => Date.parse("2026-11-19T12:00:00Z"), fetch: stub, runWorker });
    };
    const settle = async (h) => { for (let i = 0; i < 20; i++) { await new Promise((r) => realImmediate(r)); await h.flush(); } };
    await run(async (h) => {
      refreshWorld(h, cache.updatedAt);
      say(h, "banlist", { t: "banlist", color: "White", refresh: true, format: "modern" });
      await settle(h);
      const chats = h.effects.filter((e) => e.tts?.t === "chat").map((e) => [e.tts.color, e.tts.text]);
      ok("bridge: refresh tells the host it checks, then that the lists are up to date",
        chats.some(([c, t]) => c === "White" && /checking Scryfall/.test(t)) && chats.some(([c, t]) => c === "White" && /up to date \(Scryfall, 2026-11-18\)/.test(t)), JSON.stringify(chats));
      same("bridge: refresh answers with banlist for the format", sent(h, "banlist").map((m) => m.format), ["modern"]);
    });
    await run(async (h) => {
      refreshWorld(h, "2026-11-19T10:00:00Z", (c) => { c.formats.modern.banned = []; });
      say(h, "banlist", { t: "banlist", color: "White", refresh: true, format: "modern" });
      await settle(h);
      const chats = h.effects.filter((e) => e.tts?.t === "chat").map((e) => [e.tts.color || null, e.tts.text]);
      ok("bridge: a refresh that changed the lists says so to everyone",
        chats.some(([c, t]) => !c && t === "[MTG] Ban lists updated (Scryfall, 2026-11-19): Modern +1 banned."), JSON.stringify(chats));
      same("bridge: a changed refresh sends an older table (no format in its hello) only the answer", sent(h, "banlist").length, 1);
    });
    await run(async (h) => {
      say(h, "hello", { t: "hello", color: "White", format: "modern" });
      refreshWorld(h, "2026-11-19T10:00:00Z", (c) => { c.formats.modern.banned = []; });
      say(h, "banlist", { t: "banlist", color: "White", refresh: true, format: "modern" });
      await settle(h);
      same("bridge: a refresh that changed the lists resends banlist to a table that knows formats (hello, resend, answer)", sent(h, "banlist").length, 3);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `FAIL test_bridge_legality: ${failed} failed, ${passed} passed` : `PASS test_bridge_legality: ${passed} passed, 0 failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_bridge_legality: crashed: ${e.stack}`); process.exit(1); });
