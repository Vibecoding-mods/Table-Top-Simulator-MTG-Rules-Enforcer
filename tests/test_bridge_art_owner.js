// A player's own token and back pictures ("mtg art token|back", bridge.js onArtSet / playerArtOf) belong to the player,
// not to the seat colour they typed them at: another player who later sits at that colour doesn't inherit them, and
// the player keeps them at another colour. The player is their Steam ID, which the table sends with "mtg art" and with
// the start (and the votes, noteSteam). Pictures set where no Steam ID came are the colour's until a Steam ID is seen
// there: the first is taken as the same player's (their pictures go with it), a different one is a new player (the
// colour's pictures are dropped). Also the table sending the Steam ID with "mtg art token|back".
//   node tests/test_bridge_art_owner.js
const fs = require("fs");
const path = require("path");
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const clone = (x) => JSON.parse(JSON.stringify(x));
const D2 = require("./golden/fixtures/dump2.json");
const chats = (h, from = 0) => h.effects.slice(from).filter((e) => e.tts?.t === "chat").map((e) => e.tts.text);

const SOLDIER = "https://i.imgur.com/a-soldier.png", BACK = "https://i.imgur.com/a-insectile.png";
const ANNE = "76561190000000001", BEN = "76561190000000002", CARA = "76561190000000003", DAN = "76561190000000004";
const CACHE = { "delver of secrets": { face: "https://cards.scryfall.io/normal/front/a/b/d.jpg", back: "https://cards.scryfall.io/normal/back/a/b/i.jpg", faces: ["Delver of Secrets", "Insectile Aberration"] } };

// a running game: Blue is player-0 and Red player-1
function game(h) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: clone(D2.board), fingerprint: null };
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "Red" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
}
const card = (id, name, owner, extra = {}) => ({ id, identity: { name }, types: ["Creature"], power: 1, toughness: 1, controllerId: owner, ownerId: owner, ...extra });
const token = (id, owner) => card(id, "Soldier", owner, { identity: { name: "Soldier", isToken: true }, subtypes: ["Soldier"], colors: ["W"] });
const art = async (h, color, text, steam) => { h.B.onTTS({ t: "artset", color, text, ...(steam ? { steam } : {}) }); await h.flush(); };
const blueToken = (h, n) => h.B.tableCard(token(`engine-card-${800 + n}`, "player-0")).f;
const redToken = (h, n) => h.B.tableCard(token(`engine-card-${850 + n}`, "player-1")).f;
const run = async (opts, fn) => { const h = harness.load(opts); try { return await fn(h); } finally { harness.restore(); } };

(async () => {
  // ── a player with a Steam ID: the pictures are theirs ──
  await run({}, async (h) => {
    game(h);
    await art(h, "Blue", `token Soldier ${SOLDIER}`, ANNE);
    same("precondition: Anne's Soldier tokens at Blue wear her picture", blueToken(h, 1), SOLDIER);
    // Ben sits down at Blue and asks for his list
    const n = h.effects.length;
    await art(h, "Blue", "token", BEN);
    ok("another player at the colour: his list is empty", chats(h, n).some((c) => c === "[MTG] You have no token pictures set."), chats(h, n).join(" | "));
    ok("another player at the colour: his tokens don't wear the last player's picture", blueToken(h, 2) !== SOLDIER, blueToken(h, 2));
    // Anne at Red now
    const m = h.effects.length;
    await art(h, "Red", "token", ANNE);
    ok("the player at another colour: her list has her picture", chats(h, m).some((c) => c === "[MTG] Your token pictures: Soldier."), chats(h, m).join(" | "));
    same("the player at another colour: her tokens there wear it", redToken(h, 1), SOLDIER);
    // Ben clearing his (empty) list doesn't clear Anne's
    await art(h, "Blue", "token clear", BEN);
    same("another player's clear: hers kept", redToken(h, 2), SOLDIER);
  });
  // ── a new occupant seen at the start (the start's Steam IDs) ──
  await run({}, async (h) => {
    game(h);
    await art(h, "Blue", `token Soldier ${SOLDIER}`, ANNE);
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 1, steam: { Blue: BEN } }) });
    await h.flush();
    game(h);
    ok("start: Blue is Ben's now, and Anne's picture isn't on Blue's tokens", blueToken(h, 3) !== SOLDIER, blueToken(h, 3));
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 1, steam: { Blue: ANNE } }) });
    await h.flush();
    game(h);
    same("start: Anne back at Blue, her picture back", blueToken(h, 4), SOLDIER);
  });
  // ── pictures set with no Steam ID (a table that sends none): the colour's, until a Steam ID is seen there ──
  await run({}, async (h) => {
    game(h);
    await art(h, "Blue", `token Soldier ${SOLDIER}`);
    same("no Steam ID: the colour's tokens wear it", blueToken(h, 5), SOLDIER);
    await art(h, "Blue", "token", CARA);
    same("no Steam ID: the first Steam ID seen at the colour is taken as the same player's, and keeps them", blueToken(h, 6), SOLDIER);
    await art(h, "Blue", "token", DAN);
    ok("no Steam ID: a different Steam ID at the colour is a new player, who doesn't inherit them", blueToken(h, 7) !== SOLDIER, blueToken(h, 7));
    await art(h, "Red", "token", CARA);
    same("no Steam ID: and the first player keeps them at another colour", redToken(h, 3), SOLDIER);
  });
  await run({}, async (h) => {
    game(h);
    await art(h, "Blue", `token Soldier ${SOLDIER}`);
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 1, steam: { Blue: BEN } }) });
    await h.flush();
    h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["Blue"], bots: 1, steam: { Blue: DAN } }) });
    await h.flush();
    game(h);
    ok("no Steam ID: a new player at the start doesn't inherit them either", blueToken(h, 8) !== SOLDIER, blueToken(h, 8));
  });
  // a value that isn't a Steam ID (a hotseat player's, "not-a-steam-id") is no player: the pictures stay the colour's
  await run({}, async (h) => {
    game(h);
    await art(h, "Blue", `token Soldier ${SOLDIER}`, "not-a-steam-id");
    await art(h, "Blue", "token", CARA);
    same("not a Steam ID: the pictures stay the colour's, and go with the first real one seen there", blueToken(h, 9), SOLDIER);
  });
  // ── back pictures follow the player too ──
  await run({ imageCache: CACHE }, async (h) => {
    game(h);
    await art(h, "Blue", `back Delver of Secrets ${BACK}`, ANNE);
    same("back: precondition, Anne's Delver at Blue has her back", h.B.tableCard(card("engine-card-900", "Delver of Secrets", "player-0")).b, BACK);
    await art(h, "Blue", "back", BEN);
    ok("back: Ben at Blue doesn't inherit it", h.B.tableCard(card("engine-card-901", "Delver of Secrets", "player-0")).b !== BACK);
    await art(h, "Red", "back", ANNE);
    same("back: Anne's at Red", h.B.tableCard(card("engine-card-902", "Delver of Secrets", "player-1")).b, BACK);
  });
  // ── the table sends the player's Steam ID with "mtg art token|back" ──
  const COPY = fs.readFileSync(path.join(__dirname, "..", "tools", "make-engine-copy.js"), "utf8");
  ok("table: mtg art token and back carry the player's Steam ID", /engineSend\("artset", \{ color = pl\.color, steam = pl\.steam_id, text = message:sub\(restAt\) \}\)/.test(COPY), "make-engine-copy.js engineChat's artset");

  process.stdout.write(failed ? `${failed} failed (${passed} passed)\n` : `all ${passed} art owner checks pass\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { process.stdout.write(`FAIL test_bridge_art_owner: ${e.stack}\n`); process.exit(1); });
