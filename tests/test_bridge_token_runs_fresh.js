// tokenRuns reports `fresh` (the caller then sends the battlefield whole) only when a run member's details changed, not on
// every board that holds a run: the run's members are taken out of sentStatic each board, so slim added their details
// again and every board was fresh (2026-11-27). No TTS, no ports.
//   node tests/test_bridge_token_runs_fresh.js
const harness = require("./bridge-harness");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 300)}` : ""}\n`); } };
const h = harness.load();
try {
  const game = { sentStatic: {} };
  h.B._setGame(game);
  const board = (pic = "p1") => {
    const { slim, statics } = h.B._slimmer(game);
    const list = [1, 2, 3].map((i) => slim({ id: `engine-card-${i}`, n: "Goblin", f: pic, tok: true, tapped: false }));
    const r = h.B._tokenRunsOf(list, statics);
    return { fresh: r.fresh, entries: r.list.length };
  };
  const a = board();
  ok("board 1 is one entry", a.entries === 1, JSON.stringify(a));
  const b = board(), c = board();
  ok("boards 2 and 3 (nothing changed) are not fresh", !b.fresh && !c.fresh, JSON.stringify([b, c]));
  const d = board("p2");
  ok("a member's picture changed: fresh", d.fresh === true, JSON.stringify(d));
  const e = board("p2");
  ok("and not fresh again once counted", !e.fresh, JSON.stringify(e));
  // runSent keeps only the ids in a run on this board, across the seats (the caller's `seen`): a token that left stays no longer
  ok("runSent: the run's other tokens are kept", ["engine-card-2", "engine-card-3"].every((id) => id in game.runSent), JSON.stringify(Object.keys(game.runSent || {})));
  h.B._forgetRunSent(new Set(["engine-card-2"]));
  ok("runSent: a token not in a run on this board is dropped", Object.keys(game.runSent).join() === "engine-card-2", JSON.stringify(Object.keys(game.runSent)));
  // shortUrl: the table rebuilds a klrmngr link's directories from the uuid's first two characters (engineExpandUrl), so only such a link is shortened
  const U = "a1b2c3d4-0000-4000-8000-000000000000";
  ok("shortUrl: a link whose directories are the uuid's first two characters is shortened", h.B.shortUrl(`https://img.klrmngr.com/display/front/a/1/${U}.webp`) === `kf${U}`, h.B.shortUrl(`https://img.klrmngr.com/display/front/a/1/${U}.webp`));
  const odd = `https://img.klrmngr.com/display/back/0/0/${U}.webp`;
  ok("shortUrl: any other directories go whole", h.B.shortUrl(odd) === odd, h.B.shortUrl(odd));
} finally { harness.restore(); }
process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} token run fresh checks pass\n`);
process.exit(failed ? 1 : 0);
