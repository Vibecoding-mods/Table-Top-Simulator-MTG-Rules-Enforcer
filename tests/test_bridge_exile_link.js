// Which exiled cards the table lays with the card that exiled them (the bridge's ew). Forge's exiledWith names the
// source of every exile, so The Wandering Emperor's "-2: Exile target tapped creature" was laid beside her as if linked,
// though it is exiled for good: it belongs in the exile pile (the user, 2026-11-24). Linked: it comes back when that
// card leaves, it may be played through it, or the card's text speaks of what it exiled.
//   node tests/test_bridge_exile_link.js
// (BRIDGE_PATH: a copy, as tests/bridge-harness.js takes it: a break-it pass edits a copy, never the bridge)
const bridge = require(process.env.BRIDGE_PATH ? require("path").resolve(process.env.BRIDGE_PATH) : "../bridge/bridge.js");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) { passed++; console.log(`ok   ${name}`); } else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}`); } };

const HOSTS = {
  emperor: ["The Wandering Emperor", "Flash\nAs long as The Wandering Emperor entered this turn, you may activate her loyalty abilities any time you could cast an instant.\n+1: Put a +1/+1 counter on up to one target creature. It gains first strike until end of turn.\n−1: Create a 2/2 white Samurai creature token with vigilance.\n−2: Exile target tapped creature. You gain 2 life."],
  swords: ["Path Keeper", "When this creature enters, exile target creature an opponent controls."],
  oring: ["Oblivion Ring", "When Oblivion Ring enters, exile another target nonland permanent.\nWhen Oblivion Ring leaves the battlefield, return the exiled card to the battlefield under its owner's control."],
  banish: ["Banishing Light", "When Banishing Light enters, exile target nonland permanent an opponent controls until Banishing Light leaves the battlefield."],
  tibalt: ["Tibalt, Cosmic Impostor", "As Tibalt enters, you get an emblem with \"Whenever you cast a spell, exile the top card of your library.\"\n−3: Exile target artifact or creature.\n−8: Exile all cards from all graveyards. Add {R}{R}{R}.\nYou may play cards exiled with Tibalt, and you may spend mana as though it were mana of any color to cast those spells."],
  bombard: ["Arcane Bombardment", "Whenever you cast your first instant or sorcery spell each turn, exile an instant or sorcery card at random from your graveyard. Then copy each card exiled with Arcane Bombardment. You may cast any number of the copies."],
  hideaway: ["Mosswort Bridge", "Hideaway 4\nMosswort Bridge enters tapped.\n{T}: Add {G}.\n{G}, {T}: You may play the exiled card without paying its mana cost if creatures you control have total power 10 or greater."],
  chrome: ["Chrome Mox", "Imprint — When Chrome Mox enters, you may exile a nonartifact, nonland card from your hand.\n{T}: Add one mana of any of the exiled card's colors."],
  gonti: ["Gonti, Lord of Luxury", "Deathtouch\nWhen Gonti enters, look at the top four cards of target opponent's library, exile one of them face down, then put the rest on the bottom of that library in a random order. For as long as that card remains exiled, you may look at it, you may cast it, and you may spend mana as though it were mana of any type to cast that spell."],
};
const ids = Object.keys(HOSTS);
const byId = {};
ids.forEach((k, i) => { byId[`engine-card-${700 + i}`] = { id: `engine-card-${700 + i}`, identity: { name: HOSTS[k][0] }, text: HOSTS[k][1] }; });
byId["engine-card-799"] = { id: "engine-card-799", isFaceDown: true, text: "" };
const hostOf = (k) => `engine-card-${700 + ids.indexOf(k)}`;
bridge._setGame({ tableCtx: { byId, field: new Set(Object.keys(byId)) }, cardText: {}, slotColor: { "player-0": "White", "player-1": "Blue" } });
const ex = (host, more = {}) => ({ id: "engine-card-650", identity: { name: "Grizzly Bears" }, types: ["Creature"], exiledWith: host, ownerId: "player-1", ...more });
const linked = (c) => bridge._exileLinkMatters(c);

ok("The Wandering Emperor's -2: exiled for good, no link", linked(ex(hostOf("emperor"))) === false);
ok("an enters trigger that just exiles: no link", linked(ex(hostOf("swords"))) === false);
ok("Oblivion Ring (its leaves trigger returns the exiled card): linked", linked(ex(hostOf("oring"))) === true);
ok("Banishing Light (until it leaves the battlefield): linked by its text", linked(ex(hostOf("banish"))) === true);
ok("returns when its card leaves (Forge's flag): linked whatever the text", linked(ex(hostOf("emperor"), { returnsWhenHostLeaves: true })) === true);
ok("Tibalt (cards exiled with Tibalt may be played): linked", linked(ex(hostOf("tibalt"))) === true);
ok("Arcane Bombardment (each card exiled with it): linked", linked(ex(hostOf("bombard"))) === true);
ok("a hideaway land: linked", linked(ex(hostOf("hideaway"))) === true);
ok("Chrome Mox (imprint, the exiled card's colours): linked", linked(ex(hostOf("chrome"))) === true);
ok("Gonti (for as long as that card remains exiled): linked", linked(ex(hostOf("gonti"))) === true);
ok("a card that may be played through it: linked whatever the text", linked(ex(hostOf("emperor"), { mayPlay: true })) === true);
ok("a host whose text isn't known (face down): the link is kept", linked(ex("engine-card-799")) === true);
ok("no exiledWith: no link", linked(ex(null)) === false);

// what the table gets: no ew for the Emperor's exile, ew for Oblivion Ring's
const emperorCard = bridge.tableCard(ex(hostOf("emperor")), { zone: "exile" });
const oringCard = bridge.tableCard(ex(hostOf("oring")), { zone: "exile" });
ok("tableCard: the Emperor's exile has no ew (the table puts it in the exile pile)", emperorCard && emperorCard.ew === undefined, JSON.stringify(emperorCard));
ok("tableCard: Oblivion Ring's exile keeps its ew", oringCard && oringCard.ew === hostOf("oring"), JSON.stringify(oringCard));

process.stdout.write(failed ? `\n${failed} exile link checks failed (${passed} passed)\n` : `all ${passed} exile link checks pass\n`);
process.exit(failed ? 1 : 0);
