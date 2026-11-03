// Keeping the bridge, table and engine aligned: the version compare (bridge/versions.js), the save patcher's choices
// (tools/patch-save.js), the logs of the table's own check and of the bridge's guesses, and the status box lines.
//   node tests/test_alignment.js
const harness = require("./bridge-harness");
const versions = require("../bridge/versions");
const { patch, heldBy, unheld, stamped, rewrite } = require("../tools/patch-save");
const holds = require("../tools/deploy-holds.json");
const { livePassed, GATES } = require("../tools/deploy");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// the compare, one thing out of step at a time
{
  const deployed = { bridge: "b1", table: "t1", node: "n1", relay: "r1" };
  const now = { bridge: "b1", table: "t1", node: "n1", relay: "r1" };
  const one = (name, change, word) => {
    const said = versions.outOfStep({ ...now, ...change }, deployed);
    ok(`out of step: ${name}`, said.length === 1 && said[0].includes(word), JSON.stringify(said));
  };
  same("in step: nothing to say", versions.outOfStep(now, deployed), []);
  same("in step: the table hasn't said hello yet", versions.outOfStep({ ...now, table: undefined }, deployed), []);
  one("another bridge", { bridge: "b2" }, "bridge");
  one("another table", { table: "t2" }, "isn't the deployed one");
  one("a table from before stamps", { table: null }, "no version");
  one("a table built from source", { table: "dev" }, "built from source");
  one("another engine", { node: "n2" }, "engine");
  one("another relay", { relay: "r2" }, "relay");
  one("Docker down", { node: null, relay: null }, "Docker");
  same("no deploy on record says only that", versions.outOfStep({ ...now, bridge: "other" }, null).length, 1);
}

// the save patcher: what it takes, what it holds, and the version
{
  const stampLine = 'function engineStamp() return "dev" end';
  const hold = { "the list": "engineAutoList" };
  const save = ["a", "b", "c", "d", stampLine].join("\n");
  const built = ["a", "B", "c", "engineAutoList()", "d", "e", stampLine].join("\n");
  const r = patch(save, built, hold);
  ok("patch: a plain change is taken", r.script.split("\n")[1] === "B", r.script);
  ok("patch: a hunk with held text stays out", !r.script.includes("engineAutoList"), r.script);
  ok("patch: a hold is reported by name", r.held.length === 1 && r.held[0].by === "the list", JSON.stringify(r.held));
  ok("patch: a new line is taken", r.script.split("\n").includes("e"), r.script);
  ok("patch: the script says its version", r.script.includes(`return "${r.stamp}" end`), r.script);
  same("patch: run again on its own output, nothing more to take", patch(r.script, built, hold).taken.length, 0);
  same("patch: run again, the same version", patch(r.script, built, hold).stamp, r.stamp);
  ok("patch: another script, another version", stamped(`x\n${stampLine}`).stamp !== stamped(`y\n${stampLine}`).stamp);
  // (a hunk that changes the line count, ahead of another: applied in the wrong order the later one lands on the wrong line)
  const grown = patch(["a", "b", "c", "d", stampLine].join("\n"), ["a", "new 1", "new 2", "b", "c", "D", stampLine].join("\n"), {}).script.split("\n");
  same("patch: an earlier insert doesn't move a later change", grown.slice(0, 6), ["a", "new 1", "new 2", "b", "c", "D"]);
  const lost = { by: "the list", gone: ["engineAutoList()", "  "], added: ["a fix beside it"] };
  same("patch: a held hunk says what else goes with it", unheld(lost, hold), ["a fix beside it"]);
  // (git calls a file with a NUL in it binary and gives no hunks: nothing could be patched, and it must say so)
  let binary = null;
  try { patch(["a\0", stampLine].join("\n"), ["b", stampLine].join("\n"), {}); } catch (e) { binary = e.message; }
  same("patch: a diff that can't rebuild the script stops it", binary, "the diff doesn't rebuild the script: nothing changed");
  same("patch: a script with no newline at the end", patch(["a", stampLine].join("\n"), ["a", "b", stampLine, ""].join("\n"), {}).script.split("\n").slice(0, 2), ["a", "b"]);
  const dropdown = (t) => heldBy({ gone: [], added: [t] }, holds);
  ok("the real holds keep the dropdown out", !!dropdown("function engineAutoListXml()") && !!dropdown('  elseif m.t == "autostate" then engineOnAutoState(m)'));
  // (engineToolCoverXml moves in the same change: taking its removal alone would lose it)
  ok("the real holds keep the tool cover where it is", !!dropdown("function engineToolCoverXml()"));
  ok("the real holds let the rest through", dropdown("function engineSelfCheck()") === null);
}

// the save's file: the script's text replaced, every other byte as TTS wrote it
{
  const raw = (script) => `{\n  "SaveName": "x",\n  "Note":   "spaced \\u00e9",\n  "LuaScript": ${JSON.stringify(script)},\n  "ObjectStates": [ 1.50 ]\n}\n`;
  const out = rewrite(raw("old\nscript"), "new\nscript");
  same("rewrite: only the script's text moves", out, raw("new\nscript"));
  same("rewrite: a script with CRLF keeps it", JSON.parse(rewrite(raw("a\r\nb"), "c\nd")).LuaScript, "c\r\nd");
  const refuses = (text) => { try { rewrite(text, "new"); return false; } catch (e) { return e.message.includes("nothing changed"); } };
  ok("rewrite: a script written another way stops it", refuses(raw("caf\u00e9").replace("caf\u00e9", "caf\\u00e9")));
  ok("rewrite: the same text twice stops it", refuses(`{"Note": "same", "LuaScript": "same"}`));
}

// deploy: only a line saying it passed is a pass, and every table and bridge gate on disk is in the list
{
  ok("deploy: a passed live test counts", livePassed("pass: x\nPASSED: 3 of 3 checks\n"));
  ok("deploy: a failed live test doesn't", !livePassed("FAILED: 2 of 3 checks\n"));
  ok("deploy: an empty log doesn't", !livePassed(""));
  ok("deploy: a crash doesn't", !livePassed("Error: socket hang up\n"));
  const onDisk = require("fs").readdirSync(__dirname).filter((n) => /^test_(bridge|table|state|alignment)/.test(n)).map((n) => n.replace(/\.js$/, ""));
  same("deploy: no gate left out", onDisk.filter((n) => !GATES.includes(n)), []);
}

// the bridge's version covers all our code in it
{
  const fs = require("fs"), path = require("path");
  const local = new Set(versions.BRIDGE_FILES.map((f) => path.basename(f)));
  for (const f of versions.BRIDGE_FILES) for (const m of fs.readFileSync(f, "utf8").matchAll(/require\("\.\/([\w-]+)"\)/g)) ok(`version: ${path.basename(f)} loads ${m[1]}, which it covers`, local.has(`${m[1]}.js`));
  ok("version: a change in any file moves it", versions.BRIDGE_FILES.length >= 4 && !!versions.bridgeHash());
}

// the version the table says reaches the compare, by whichever message comes first
{
  const real = versions.containerImages;
  versions.containerImages = (done) => done({ node: "n", relay: "r" });
  const stampOf = (h) => { let t; h.B.versionsNow((now) => { t = now.table; }); return t; };
  let h = harness.load();
  same("stamp: nothing said yet", stampOf(h), undefined);
  h.B.onTTS({ t: "check", turn: 1, step: "main1", ms: 1, problems: "", stamp: "from-check" });
  same("stamp: a check says it", stampOf(h), "from-check");
  harness.restore();
  h = harness.load();
  h.B.onTTS({ t: "hello", stamp: "from-hello" });
  same("stamp: a hello says it", stampOf(h), "from-hello");
  h.B.onTTS({ t: "check", turn: 1, step: "main1", ms: 1, problems: "" });
  same("stamp: a message without one leaves it", stampOf(h), "from-hello");
  harness.restore();
  h = harness.load();
  h.B.onTTS({ t: "hello" });
  same("stamp: a hello with none is a table older than stamps", stampOf(h), null);
  const before = h.effects.length;
  h.B.warnOutOfStep({ bridge: "b", table: "old", node: "n", relay: "r" }, { bridge: "b", table: "new", node: "n", relay: "r" });
  ok("stamp: a table out of step is said in chat", JSON.stringify(h.effects.slice(before)).includes("deployed one"), JSON.stringify(h.effects.slice(before)));
  harness.restore();
  versions.containerImages = real;
}

// the table's check: counted, and nothing goes to the table
{
  const h = harness.load();
  const before = h.effects.length;
  h.B.onTTS({ t: "check", turn: 3, step: "main1", ms: 12, problems: "one is wrong\ntwo is wrong" });
  h.B.onTTS({ t: "check", turn: 4, step: "main1", ms: 5, problems: "" });
  same("check: runs counted", h.B.alignment.checks, 2);
  same("check: problems counted", h.B.alignment.problems, 2);
  same("check: the slowest run kept", h.B.alignment.slowestMs, 12);
  same("check: nothing reached the table", h.effects.slice(before).filter((e) => e.tts), []);
  harness.restore();
}

// the guesses: only where the feed is on and didn't cover it
{
  const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
  const blank = () => ({ turn: 3, step: "main1", activePlayerId: "player-0", stack: [], zones: ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((zone) => ({ zone, ownerId, cards: [], count: 0 }))) });
  const put = (b, zone, id, name) => b.zones.find((x) => x.zone === zone && x.ownerId === "player-0").cards.push({ id, identity: { name }, types: ["Creature"], controllerId: "player-0" });
  const setup = (h, seq = 10) => {
    const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
    seat.slot = "player-0";
    h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: [], slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
      started: true, fromTable: true, sentStatic: {}, sentZones: {}, eventSeq: seq });
  };
  const between = (events) => {
    const h = harness.load();
    setup(h);
    const a = blank(), b = blank();
    put(a, "battlefield", "gone-1", "Grizzly Bears");
    put(b, "battlefield", "new-1", "Hill Giant");
    const facts = h.B.engineFacts(events);
    const lines = h.B.logEvents(h.B.logSnapshot(a), h.B.logSnapshot(b), b, facts);
    const g = { ...h.B.alignment.guesses };
    harness.restore();
    return { g, lines };
  };
  const ev = (seq, cardId, from, to) => ({ seq, cardId, from, to, ownerId: "player-0" });
  same("guess: a feed that covers both moves guesses nothing", between([ev(11, "gone-1", "Battlefield", "Graveyard"), ev(12, "new-1", "Hand", "Battlefield")]).g, {});
  same("guess: an arrival the feed didn't say", between([ev(11, "gone-1", "Battlefield", "Graveyard")]).g, { arrival: 1 });
  same("guess: a departure the feed didn't say", between([ev(11, "new-1", "Hand", "Battlefield")]).g, { departure: 1 });
  same("guess: a gap in the feed", between([ev(13, "gone-1", "Battlefield", "Graveyard")]).g, { "feed gap": 1 });
  same("guess: one event missed is a gap", between([ev(12, "gone-1", "Battlefield", "Graveyard")]).g, { "feed gap": 1 });
  same("guess: a board with no events at all isn't a guess", between([]).g, {});
  const none = between(undefined);
  same("guess: no feed is said once for the game", none.g, { "no feed": 1 });
  {
    const h = harness.load();
    setup(h);
    h.B.engineFacts(undefined); h.B.engineFacts(undefined);
    same("guess: no feed, twice, is one note", h.B.alignment.guesses, { "no feed": 1 });
    harness.restore();
  }
}

// the status box: what Forge knows that the table didn't show
{
  const h = harness.load();
  h.B._setGame({ seats: new Map(), slotColor: { "player-0": "Blue" }, sentStatic: {} });
  const bear = { id: "c1", identity: { name: "Grizzly Bears" }, types: ["Creature"], controllerId: "player-0" };
  const kw = (extra, active = null) => h.B.tableCard({ ...bear, ...extra }, null, active).kw || [];
  same("box: sick on its controller's turn", kw({ summoningSick: true }, "player-0"), ["Summoning sick"]);
  same("box: sick on another player's turn says nothing", kw({ summoningSick: true }, "player-1"), []);
  same("box: not sick says nothing", kw({}, "player-0"), []);
  same("box: a card off the battlefield says nothing (no active turn passed)", kw({ summoningSick: true }), []);
  same("box: a sick artifact says nothing", h.B.tableCard({ ...bear, types: ["Artifact"], summoningSick: true }, null, "player-0").kw || [], []);
  same("box: crewed", kw({ isCrewed: true }), ["Crewed"]);
  same("box: bestowed", kw({ isBestowed: true }), ["Bestowed"]);
  same("box: Ring-bearer", kw({ isRingBearer: true }), ["Ring-bearer"]);
  same("box: a Saga's chapter", kw({ finalChapter: 3, counters: { LORE: 2 } }), ["Chapter 2 of 3"]);
  same("box: a Saga's chapter, the counter named in lower case", kw({ finalChapter: 3, counters: { lore: 1 } }), ["Chapter 1 of 3"]);
  same("box: a Class's level", kw({ classLevel: 2 }), ["Level 2"]);
  same("box: level 0 of a card that isn't a Class", kw({ classLevel: 0 }), []);
  harness.restore();
}

process.stdout.write(failed ? `\n${failed} alignment checks failed (${passed} passed)\n` : `all ${passed} alignment checks pass\n`);
process.exit(failed ? 1 : 0);
