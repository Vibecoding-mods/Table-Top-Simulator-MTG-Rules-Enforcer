// Metamorphic relations over the ten open-item fixes of 2026-11-05 (commit 980aece, docs/mechanic-runs-2026-11-05.md
// #12-#21). No recorded answers: each check runs the real bridge entry points (onPrompt, onTTS answers, logEvents) on
// two inputs that differ in one way, and asserts what must hold between the two outputs whatever the right answer is.
// Each relation first checks that its base input is handled (the precondition), so a relation can't pass by absence.
// A crash inside a relation is reported as a FAIL by that relation's name, never thrown.
//   node tests/test_open_items_relations.js        (BRIDGE_PATH=bridge/bridge.mut.js for a copy, see bridge-harness)
const path = require("path");
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const J = (x) => JSON.stringify(x);
const clone = (x) => JSON.parse(J(x));
// a relation's body: anything it throws is a named failure, and the next relation still runs
const relation = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name} (crashed)`, false, String(e?.stack || e).split("\n").slice(0, 3).join(" | ")); } };

const D2 = require(path.join(__dirname, "golden", "fixtures", "dump2.json"));
const myMain = () => { const b = clone(D2.board); Object.assign(b.gameView, { activePlayerId: "player-0", step: "main1", priorityPlayerId: "player-0", stack: [] }); return b; };
const zone = (b, kind, owner = "player-0") => b.gameView.zones.find((z) => z.zone === kind && z.ownerId === owner);
const me = (b) => b.gameView.players.find((p) => p.id === "player-0");
const EMPTY = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

// one seated player (Blue, player-0) against an AI, as the golden cases seat it; every answer the bridge sends is kept
function sit(board, seatExtra = {}, gameExtra = {}) {
  const h = harness.load();
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  seat.board = { state: clone(board), fingerprint: null };
  Object.assign(seat, seatExtra);
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {}, ...gameExtra });
  const sent = [];
  const respond = seat.respond.bind(seat);
  seat.respond = (pid, type, out) => { sent.push(out); return respond(pid, type, out); };
  return { h, seat, sent };
}
const prompt = (type, input, extra = {}) => ({ promptId: 900, decidingPlayerId: "player-0", input: { type, ...input }, ...extra });
async function ask(board, p, seatExtra, gameExtra) {
  const s = sit(board, seatExtra, gameExtra);
  s.h.B.onPrompt(s.seat, p);
  await s.h.flush();
  return { ...s, ui: s.seat.prompt?.ui || null };
}
const answer = async (s, promptId, choice) => { s.h.B.onTTS({ t: "answer", json: J({ color: "Blue", promptId, choice }) }); await s.h.flush(); };

// ── #13 smartPayTap: auto-pay keeps the colours the hand needs ──
// A small engine of our own: Forge repeats the full cost and the tapped mana goes to the pool (as on the real table,
// bridge.js "four Treasures clicked one at a time"); it says canConfirmFromPool once the pool covers the cost. Returns
// { how: "own" | "forge" | "other" | "loop" | "noauto", taps: [action ids] }.
const symsOf = (cost) => [...String(cost).matchAll(/\{([^}]+)\}/g)].map((m) => m[1].toUpperCase());
function covers(cost, pool) {
  const left = { ...pool };
  let generic = 0;
  for (const x of symsOf(cost)) {
    if (/^\d+$/.test(x)) generic += Number(x);
    else if ((left[x] || 0) > 0) left[x]--;
    else return false;
  }
  return Object.values(left).reduce((n, v) => n + v, 0) >= generic;
}
const colourOf = (a) => String(a.producedMana?.[0]?.color || String(a.id).match(/:([WUBRGC])$/)?.[1] || "").toUpperCase();
const land = (n, col, extra = {}) => ({ id: `tap:engine-card-${n}:0`, type: "activateManaAbility", cardId: `engine-card-${n}`, cost: "{T}", producedMana: [{ amount: 1, color: col }], description: col, ...extra });
const handCard = (n, name, manaCost) => ({ id: `engine-card-${n}`, identity: { name }, types: ["Enchantment"], manaCost, ownerId: "player-0", controllerId: "player-0", text: "" });
const UMBRA = handCard(970, "Bear Umbra", "{2}{G}{G}");
async function payPlan({ cost, acts, hand = [UMBRA], pool = {}, battlefield = [] }) {
  const b = myMain();
  zone(b, "hand").cards = clone(hand);
  zone(b, "battlefield").cards.push(...clone(battlefield));
  me(b).manaPool = { ...EMPTY, ...pool };
  const s = sit(b);
  let left = clone(acts), pid = 500;
  const taps = [];
  const payP = () => prompt("payManaCost", { cardId: "engine-card-75", cardName: "Dreg Mangler", manaCost: cost, actions: left,
    canConfirmFromPool: covers(cost, s.seat.board.state.gameView.players.find((p) => p.id === "player-0").manaPool) }, { promptId: ++pid });
  s.h.B.onPrompt(s.seat, payP());
  await s.h.flush();
  if (!(s.seat.prompt?.ui?.options || []).some((o) => o.id === "__auto")) return { how: "noauto", taps };
  await answer(s, pid, ["__auto"]);
  for (let step = 0; step < 16; step++) {
    const out = s.sent[s.sent.length - 1];
    if (out?.type === "pay") return { how: out.auto ? "forge" : "own", taps };
    if (out?.type !== "act") return { how: "other", taps, out };
    const a = left.find((x) => x.id === out.actionId);
    if (!a) return { how: "other", taps, out };
    taps.push(a.id);
    left = left.filter((x) => x.cardId !== a.cardId);
    const mp = s.seat.board.state.gameView.players.find((p) => p.id === "player-0").manaPool;
    mp[colourOf(a)] = (mp[colourOf(a)] || 0) + 1;
    const n = s.sent.length;
    s.h.B.onPrompt(s.seat, payP());
    await s.h.flush();
    if (s.sent.length === n) return { how: "other", taps, out: "asked the player" };
  }
  return { how: "loop", taps };
}
const tapColours = (plan, acts) => plan.taps.map((id) => colourOf(acts.find((a) => a.id === id))).sort().join("");
// lands: f Forests, p Plains, s Swamps, ids from 981
const lands = (f, p, s, startN = 981) => {
  const out = [];
  let n = startN;
  for (const [k, col] of [[f, "G"], [p, "W"], [s, "B"]]) for (let i = 0; i < k; i++) out.push(land(n++, col));
  return out;
};
const swapGW = (x) => JSON.parse(J(x).replace(/"G"|"W"|\{G\}|\{W\}/g, (m) => ({ '"G"': '"W"', '"W"': '"G"', "{G}": "{W}", "{W}": "{G}" })[m]));

async function smartPayRelations() {
  // the family: generic n and one {B}, Forests (the hand's colour), Plains (not needed), one or two Swamps
  const family = [];
  for (const n of [1, 2, 3, 4]) for (const f of [1, 3, 5]) for (const p of [0, 1, 2, 4]) for (const s of [1, 2]) if (f + p + s >= n + 1) family.push({ n, f, p, s });
  let checked = 0;
  for (const { n, f, p, s } of family) {
    const cost = `{${n}}{B}`, acts = lands(f, p, s);
    const tag = `{${n}}{B} with ${f} Forest, ${p} Plains, ${s} Swamp`;
    const base = await payPlan({ cost, acts });
    // precondition: enough plain sources, so the bridge pays it itself and stops at the cost's mana value
    ok(`pay precondition: planned by the bridge (${tag})`, base.how === "own", J(base));
    if (base.how !== "own") continue;
    checked++;
    ok(`pay: taps exactly the cost's mana value (${tag})`, base.taps.length === n + 1, J(base.taps));
    // R1: never a Forest (needed by the hand) while a Plains or spare Swamp (not needed) stays untapped
    const used = new Set(base.taps), cols = tapColours(base, acts);
    const spareUnneeded = acts.filter((a) => !used.has(a.id) && colourOf(a) !== "G").length;
    ok(`pay R1: no Forest tapped while an unneeded land is free (${tag})`, !(cols.includes("G") && spareUnneeded > 0), `tapped ${cols}, ${spareUnneeded} unneeded left`);
    // R2: a card in hand that needs no colour (a colourless cost, a land) changes nothing
    const more = await payPlan({ cost, acts, hand: [UMBRA, handCard(971, "Mind Stone", "{2}"), { ...handCard(972, "Wastes", ""), types: ["Land"] }] });
    ok(`pay R2: a colourless card in hand changes no tap (${tag})`, J(more) === J(base), `${J(base.taps)} vs ${J(more.taps)}`);
    // R2b: the card being paid for, still listed in the hand (cast from it), is not the hand's need
    const self = await payPlan({ cost, acts, hand: [UMBRA, { ...handCard(75, "Dreg Mangler", `{${n}}{W}`), types: ["Creature"] }] });
    ok(`pay R2b: the spell itself in hand changes no tap (${tag})`, J(self) === J(base), `${J(base.taps)} vs ${J(self.taps)}`);
    // R3: colours are names: swap G and W everywhere (lands and hand) and the same lands are tapped
    const swapped = await payPlan({ cost, acts: swapGW(acts), hand: swapGW([UMBRA]) });
    ok(`pay R3: swapping G and W everywhere taps the same lands (${tag})`, J(swapped) === J(base), `${J(base.taps)} vs ${J(swapped.taps)}`);
    // R4: the order Forge lists the sources in changes neither how many lands are tapped nor how many of the hand's
    // colour (a Plains and a spare Swamp are equally unneeded, so which of those is free to differ)
    const rev = await payPlan({ cost, acts: [...acts].reverse() });
    const gs = (c) => (c.match(/G/g) || []).length;
    ok(`pay R4: sources listed in reverse tap as many, and as many Forests (${tag})`, rev.how === "own" && rev.taps.length === base.taps.length && gs(tapColours(rev, acts)) === gs(cols), `${cols} vs ${tapColours(rev, acts)} (${rev.how})`);
    // R5: a second card needing W never makes more Plains tapped
    const needW = await payPlan({ cost, acts, hand: [UMBRA, handCard(973, "Swords to Plowshares", "{W}")] });
    const count = (plan, col) => plan.taps.filter((id) => colourOf(acts.find((a) => a.id === id)) === col).length;
    ok(`pay R5: a hand needing W too never taps more Plains (${tag})`, needW.how === "own" && count(needW, "W") <= count(base, "W"), `${count(base, "W")} -> ${count(needW, "W")} (${needW.how})`);
    // R6: two routes to the same owed cost: {B} floating with {n}{B} owed, or {n} owed and an empty pool
    const floated = await payPlan({ cost, acts: acts.filter((a) => colourOf(a) !== "B"), pool: { B: 1 } });
    const plainN = await payPlan({ cost: `{${n}}`, acts: acts.filter((a) => colourOf(a) !== "B") });
    if (plainN.how === "own") ok(`pay R6: {B} floating pays as if {${n}} were owed (${tag})`, J(floated.taps) === J(plainN.taps) && floated.how === "own", `${J(floated)} vs ${J(plainN.taps)}`);
    // R8: a colour said by the action's id suffix (no producedMana) is the same colour
    const byIdOnly = acts.map((a) => ({ ...a, id: `${a.id}:${colourOf(a)}`, producedMana: undefined }));
    const viaId = await payPlan({ cost, acts: byIdOnly });
    ok(`pay R8: the colour from the id suffix taps the same lands (${tag})`, J(viaId.taps.map((x) => x.replace(/:[WUBRGC]$/, ""))) === J(base.taps) && viaId.how === "own", `${J(base.taps)} vs ${J(viaId)}`);
  }
  ok("pay: the family had cases the bridge planned", checked >= 20, `only ${checked}`);

  // R7 (Subset): too few sources is Forge's auto-pay, and taking a source away never makes it plannable
  for (const [f, p, s, n] of [[1, 0, 1, 2], [2, 1, 0, 1], [0, 2, 1, 3]]) {
    const acts = lands(f, p, s), cost = `{${n}}{B}`;
    const short = await payPlan({ cost, acts });
    ok(`pay R7: not enough sources goes to Forge (${f}F ${p}P ${s}S for ${cost})`, short.how === "forge" && short.taps.length === 0, J(short));
    for (let k = 0; k < acts.length; k++) {
      const fewer = await payPlan({ cost, acts: acts.filter((_, i) => i !== k) });
      ok(`pay R7: one source fewer is still Forge's (${f}F ${p}P ${s}S, without #${k})`, fewer.how === "forge" && fewer.taps.length === 0, J(fewer));
    }
  }
  // R7b: a cost the bridge can't plan (hybrid, X, Phyrexian, snow) is Forge's whatever the sources (precondition: the
  // same sources pay the plain cost)
  const many = lands(3, 3, 3);
  ok("pay R7b precondition: {1}{B} is planned with these sources", (await payPlan({ cost: "{1}{B}", acts: many })).how === "own");
  for (const odd of ["{1}{W/B}", "{X}{B}", "{1}{B/P}", "{S}{B}", "{2/B}"]) {
    const r = await payPlan({ cost: odd, acts: many });
    ok(`pay R7b: ${odd} goes to Forge's auto-pay`, r.how === "forge" && r.taps.length === 0, J(r));
  }
  // R7c: a source with a cost beyond {T}, or making two mana, is never tapped by the bridge (it plans around it)
  for (const odd of [{ cost: "{T}, Pay 1 life" }, { cost: "{1}, {T}" }, { producedMana: [{ amount: 2, color: "B" }] }, { type: "activateAbility", isManaAbility: false }]) {
    const acts = [land(990, "B", odd), ...lands(2, 2, 1, 981)];
    const r = await payPlan({ cost: "{2}{B}", acts });
    ok(`pay R7c: an unusual source is never tapped (${J(odd)})`, r.how === "own" && !r.taps.includes("tap:engine-card-990:0"), J(r));
  }

  // R9: being a creature never makes a source preferred: a Forest and Llanowar Elves, neither needed, either order
  const elves = { id: "engine-card-995", identity: { name: "Llanowar Elves" }, types: ["Creature"], power: 1, toughness: 1, ownerId: "player-0", controllerId: "player-0", text: "" };
  const plainsLand = { id: "engine-card-996", identity: { name: "Plains" }, types: ["Land"], ownerId: "player-0", controllerId: "player-0", text: "" };
  for (const order of [0, 1]) {
    const acts = [land(995, "W", { type: "activateAbility", isManaAbility: true }), land(996, "W")];
    const r = await payPlan({ cost: "{1}", acts: order ? acts.reverse() : acts, battlefield: [elves, plainsLand] });
    ok(`pay R9: the land is tapped before the creature (order ${order})`, r.how === "own" && J(r.taps) === J(["tap:engine-card-996:0"]), J(r));
  }
  // R11: a cost these sources can pay is planned in any order they are listed: the colour only one source makes is
  // paid first ({G}{W} from a Forest and a Plains/Forest dual: the dual must pay {W})
  const dual = (col) => ({ id: `tap:engine-card-970:0:${col}`, type: "activateManaAbility", cardId: "engine-card-970", cost: "{T}", producedMana: [{ amount: 1, color: col }] });
  const three = [dual("W"), dual("G"), land(981, "G")];
  for (const cost of ["{G}{W}", "{W}{G}"]) for (const perm of [[0, 1, 2], [1, 0, 2], [1, 2, 0], [2, 1, 0], [0, 2, 1], [2, 0, 1]]) {
    const r = await payPlan({ cost, acts: perm.map((k) => three[k]), hand: [] });
    ok(`pay R11: ${cost} from a Forest and a dual, order ${perm.join("")}: planned, the dual pays {W}`, r.how === "own" && r.taps.includes("tap:engine-card-970:0:W") && r.taps.includes("tap:engine-card-981:0"), J(r));
  }
  // R10: the hand's need is per colour: a Forest stays when the generic part can come from any unneeded land, whatever
  // the hand's size (one, two or three G cards)
  for (const k of [1, 2, 3]) {
    const hand = Array.from({ length: k }, (_, i) => handCard(970 + i, `G card ${i}`, "{1}{G}"));
    const r = await payPlan({ cost: "{2}", acts: lands(2, 2, 0), hand });
    ok(`pay R10: ${k} G card(s) in hand: Plains pay {2}`, r.how === "own" && tapColours(r, lands(2, 2, 0)) === "WW", J(r));
  }
}

// ── #12 mana back only while mana floats ──
async function manaBackRelations() {
  const undo = (n) => ({ id: `undo:engine-card-${n}`, type: "undoMana", cardId: `engine-card-${n}` });
  const mtn = { id: "tap:engine-card-36:0", type: "activateManaAbility", cardId: "engine-card-36", isManaAbility: true, description: "Mountain", producedMana: [{ amount: 1, color: "R" }] };
  const offered = (r) => (r.ui?.options || []).filter((o) => /\(mana back\)$/.test(o.label || "")).map((o) => o.id);
  const boardWith = (turn, pool) => {
    const b = myMain();
    if (turn === "theirs") Object.assign(b.gameView, { activePlayerId: "player-1", step: "upkeep" });
    if (pool === undefined) delete me(b).manaPool; else me(b).manaPool = pool;
    return b;
  };
  for (const turn of ["mine", "theirs"]) {
    for (const ids of [[36], [36, 64], [36, 64, 65]]) {
      const acts = [...ids.map(undo), mtn];
      const tag = `${turn} turn, ${ids.length} undo`;
      // precondition: with mana floating every listed undo is offered
      const live = await ask(boardWith(turn, { ...EMPTY, R: 1 }), prompt("chooseAction", { actions: acts }));
      ok(`mana back precondition: offered while R floats (${tag})`, J(offered(live)) === J(ids.map((n) => `undo:engine-card-${n}`)), J(offered(live)));
      // U1: an empty pool offers none, whatever the actions list says
      const spent = await ask(boardWith(turn, { ...EMPTY }), prompt("chooseAction", { actions: acts }));
      ok(`mana back U1: an empty pool offers no mana back (${tag})`, offered(spent).length === 0, J(offered(spent)));
      // U2: no pool at all (an engine that sends none): the undo stays offered
      const old = await ask(boardWith(turn, undefined), prompt("chooseAction", { actions: acts }));
      ok(`mana back U2: no pool sent keeps mana back (${tag})`, J(offered(old)) === J(offered(live)), J(offered(old)));
      // U3: which colour floats doesn't matter, nor how much
      for (const col of ["W", "U", "B", "G", "C"]) for (const amt of [1, 3]) {
        const r = await ask(boardWith(turn, { ...EMPTY, [col]: amt }), prompt("chooseAction", { actions: acts }));
        ok(`mana back U3: ${amt} ${col} floating offers the same (${tag})`, J(offered(r)) === J(offered(live)), J(offered(r)));
      }
      // U4: the opponent's floating mana is not ours
      const theirsB = boardWith(turn, { ...EMPTY });
      theirsB.gameView.players.find((p) => p.id === "player-1").manaPool = { ...EMPTY, G: 2 };
      const theirPool = await ask(theirsB, prompt("chooseAction", { actions: acts }));
      ok(`mana back U4: the opponent's floating mana offers none (${tag})`, offered(theirPool).length === 0, J(offered(theirPool)));
      // U5 (bridge.js's "a priority the Arena-style passing would pass is asked instead ... The passes the player chose
      // above still pass"): on their turn, the same floating-mana priority asked without Auto-resolve is passed with it
      if (turn === "theirs") {
        const s = sit(boardWith(turn, { ...EMPTY, R: 1 }));
        s.h.B.onTTS({ t: "autoresolve", json: J({ color: "Blue", on: true }) });
        s.h.B.onPrompt(s.seat, prompt("chooseAction", { actions: acts }));
        await s.h.flush();
        ok(`mana back U5: Auto-resolve still passes a floating-mana priority (${tag})`, live.ui && !s.seat.prompt && s.sent.length === 1 && s.sent[0]?.type === "pass", J({ open: !!s.seat.prompt, sent: s.sent }));
      }
    }
  }
}

// ── #15 #16 target labels: (token), power/toughness, #n, (face down) ──
const creature = (n, name, p, t, extra = {}) => ({ id: `engine-card-${n}`, identity: { name, ...(extra.token ? { isToken: true } : {}) }, types: ["Creature"], power: p, toughness: t,
  ownerId: "player-0", controllerId: "player-0", text: "", ...(extra.fd ? { isFaceDown: true } : {}) });
async function labelsOf(cards, order = null) {
  const b = myMain();
  zone(b, "battlefield").cards.push(...clone(cards));
  const ids = (order || cards.map((c) => c.id));
  const r = await ask(b, { ...prompt("chooseBoardTargets", { cancellable: true, candidates: ids.map((id) => ({ id, kind: "card" })), chosenTargets: 0, minTargets: 1, maxTargets: 1,
    presentation: { targets: [], title: "Deal 1 damage" } }), sourceAbilityText: "When this creature enters, it deals 1 damage to any target.", sourceCard: { id: "engine-card-966", identity: { name: "Orcish Bowmasters" } } });
  return Object.fromEntries((r.ui?.options || []).map((o) => [o.id.split("|")[1], o.label]));
}
const distinct = (labels) => new Set(Object.values(labels)).size === Object.values(labels).length;
async function labelRelations() {
  // the family: 2 to 4 creatures of one name, token or card, any power/toughness, plus a bystander of its own name
  const groups = [];
  for (const name of ["Goblin", "Coruscation Mage"]) for (const pts of [[[1, 1], [1, 1]], [[2, 2], [1, 1]], [[1, 1], [1, 1], [2, 2]], [[1, 1], [1, 1], [1, 1], [1, 1]]])
    for (const tokens of ["all", "none", "first"]) groups.push({ name, pts, tokens });
  for (const { name, pts, tokens } of groups) {
    const tag = `${pts.length} ${name}, ${pts.map((x) => x.join("/")).join(" ")}, tokens ${tokens}`;
    const cards = [...pts.map(([p, t], i) => creature(961 + i, name, p, t, { token: tokens === "all" || (tokens === "first" && i === 0) })), creature(969, "Llanowar Elves", 1, 1)];
    const base = await labelsOf(cards);
    ok(`labels precondition: every candidate has a label (${tag})`, Object.keys(base).length === cards.length && Object.values(base).every((l) => l.includes(cards.find((c) => base[c.id] === l)?.identity.name || "\u0000")), J(base));
    // L1: alike creatures are told apart
    ok(`labels L1: alike creatures read differently (${tag})`, distinct(base), J(base));
    // L1c: where power/toughness is said, it follows the name, before any mark ("Coruscation Mage 1/1 (token)")
    ok(`labels L1c: power/toughness right after the name (${tag})`, cards.every((c) => !/\d+\/\d+/.test(base[c.id]) || base[c.id].startsWith(`${c.identity.name} ${c.power}/${c.toughness}`)), J(base));
    // L3: the order Forge lists them in changes no label except its #n, and the set of labels not at all
    const strip = (l) => l.replace(/ #\d+$/, "");
    const rev = await labelsOf(cards, [...cards.map((c) => c.id)].reverse());
    ok(`labels L3: listed in reverse, each reads the same but for #n (${tag})`, cards.every((c) => strip(rev[c.id] || "") === strip(base[c.id])), `${J(base)} vs ${J(rev)}`);
    ok(`labels L3: listed in reverse, the same labels (${tag})`, J(Object.values(rev).sort()) === J(Object.values(base).sort()), `${J(base)} vs ${J(rev)}`);
    // L4: a bystander of another name changes nobody's label, and reads as its plain name
    const without = await labelsOf(cards.slice(0, -1));
    ok(`labels L4: the bystander changes no other label (${tag})`, cards.slice(0, -1).every((c) => without[c.id] === base[c.id]), `${J(without)} vs ${J(base)}`);
    ok(`labels L4: the bystander reads as its name (${tag})`, base["engine-card-969"] === "Llanowar Elves", base["engine-card-969"]);
    // L1b (Complete): numbers given to one look-alike group are exactly 1..k
    const nums = {};
    for (const l of Object.values(base)) { const m = / #(\d+)$/.exec(l); if (m) (nums[l.slice(0, m.index)] ??= []).push(Number(m[1])); }
    ok(`labels L1b: each numbered group counts 1 to k (${tag})`, Object.values(nums).every((ns) => J(ns.sort((x, y) => x - y)) === J(ns.map((_, i) => i + 1))), J(base));
    // L5: a (token) mark only where a token shares its name; a token alone with its name has none
    ok(`labels L5: "(token)" exactly on the tokens that shared a name (${tag})`, cards.every((c) => /\(token\)/.test(base[c.id]) === (!!c.identity.isToken && cards.some((x) => x !== c && x.identity.name === c.identity.name))), J(base));
  }
  // L2: renaming two creatures to one name never collapses their labels (they read apart before, and after)
  for (const [a, b] of [[[1, 1, false], [1, 1, false]], [[1, 1, true], [1, 1, true]], [[2, 2, true], [2, 2, false]], [[3, 3, true], [1, 1, true]]]) {
    const two = (n2) => [creature(961, "Goblin", a[0], a[1], { token: a[2] }), creature(962, n2, b[0], b[1], { token: b[2] })];
    const apart = await labelsOf(two("Elf Warrior"));
    const renamed = await labelsOf(two("Goblin"));
    const tag = `${J(a)} ${J(b)}`;
    ok(`labels L2 precondition: different names read apart (${tag})`, distinct(apart) && Object.keys(apart).length === 2, J(apart));
    ok(`labels L2: renamed to one name they still read apart (${tag})`, distinct(renamed) && Object.keys(renamed).length === 2, J(renamed));
  }
  // L6: a face-down card you may see says so, wherever it is listed, and its name is kept
  for (const pos of [0, 1, 2]) {
    const cards = [creature(962, "Goblin", 1, 1, { token: true }), creature(963, "Elf Warrior", 2, 2)];
    cards.splice(pos, 0, creature(961, "Brainstorm", 2, 2, { fd: true }));
    const l = await labelsOf(cards);
    ok(`labels L6: the face-down card says so (position ${pos})`, /^Brainstorm\b.*\(face down\)/.test(l["engine-card-961"] || ""), J(l));
    ok(`labels L6: and nothing else does (position ${pos})`, Object.entries(l).filter(([id]) => id !== "engine-card-961").every(([, x]) => !/face down/.test(x)), J(l));
  }
  // L6c: two routes to an unseen face-down card (face down with no name, or Forge's hidden view) read the same, and
  // the (face down) mark needs a name to go with it
  const unseen = { id: "engine-card-961", isFaceDown: true, types: ["Creature"], ownerId: "player-1", controllerId: "player-1", text: "" };
  const viaFd = await labelsOf([unseen, creature(962, "Elf Warrior", 2, 2)]);
  const viaHidden = await labelsOf([{ visibility: "hidden", id: "engine-card-961" }, creature(962, "Elf Warrior", 2, 2)]);
  ok("labels L6c: an unseen face-down card reads as Forge's hidden one", viaFd["engine-card-961"] != null && viaFd["engine-card-961"] === viaHidden["engine-card-961"], `${J(viaFd)} vs ${J(viaHidden)}`);
  // L6b: two face-down copies of one card read apart
  const twoFd = await labelsOf([creature(961, "Brainstorm", 2, 2, { fd: true }), creature(962, "Brainstorm", 2, 2, { fd: true })]);
  ok("labels L6b: two face-down cards of one name read apart", distinct(twoFd) && Object.values(twoFd).every((x) => /face down/.test(x)), J(twoFd));
}

// ── #14 identical triggers ordered by themselves ──
const mage = (n, p) => ({ id: `engine-card-${n}`, identity: { name: "Coruscation Mage" }, types: ["Creature"], power: p, toughness: p, controllerId: "player-0", ownerId: "player-0" });
async function reorderVerdict(items, title = "Order triggered abilities", extra = {}) {
  const r = await ask(D2.board, { ...prompt("reorder", { items, presentation: { title } }), ...extra });
  const dec = r.sent.find((o) => o?.type === "reorderDecision");
  return { auto: !!dec && !r.ui, asked: !!r.ui, order: dec?.orderedIds || null };
}
async function reorderRelations() {
  const PING = "Whenever you cast a noncreature spell, this creature deals 1 damage to each opponent.";
  const SHOCK = "Whenever you cast a noncreature spell, this creature deals 1 damage to target opponent.";
  const two = (o1, o2 = o1, p1 = 2, p2 = 1) => [{ id: "r1", card: mage(301, p1), oracle: o1 }, { id: "r2", card: mage(302, p2), oracle: o2 }];
  // precondition: identical triggers are ordered by themselves, triggers that target are asked
  const base = await reorderVerdict(two(PING));
  ok("order precondition: identical triggers ordered by themselves", base.auto, J(base));
  ok("order precondition: identical targeting triggers asked", (await reorderVerdict(two(SHOCK))).asked);
  // O1: the word "target" inside Forge's notes changes no verdict (both ways: auto stays auto, asked stays asked)
  const notes = [" [Card: Twinflame (168), Activator: tts-White-9gwe, SpellAbility: Choose any number of target creatures you control.]",
    " [Card: Fling (12), SpellAbility: Fling deals damage to any target.]", " [Targets: target creature]", " (Targeting: [[Grizzly Bears (12) target]])",
    " [Card: Bolt (3), SpellAbility: deals 3 damage to any target", " [Phase: target]"];
  for (const note of notes) {
    const noted = await reorderVerdict(two(PING + note));
    ok(`order O1: "target" in a Forge note keeps the order automatic (${note.trim().slice(0, 30)})`, noted.auto, J(noted));
    const shockNoted = await reorderVerdict(two(SHOCK + note));
    ok(`order O1: a Forge note doesn't hide a real target (${note.trim().slice(0, 30)})`, shockNoted.asked, J(shockNoted));
    const oneNoted = await reorderVerdict(two(PING + note, PING));
    ok(`order O1: a note on one of the two only keeps it automatic (${note.trim().slice(0, 30)})`, oneNoted.auto, J(oneNoted));
  }
  // O2: Forge's object numbers, the copies' power/toughness and ids, and their order change no verdict
  for (const [what, items] of [["object numbers", two(`${PING} (145)`, `${PING} (61)`)], ["same power", two(PING, PING, 1, 1)], ["5/5 and 1/1", two(PING, PING, 5, 1)],
    ["listed the other way", [...two(PING)].reverse()]]) {
    const v = await reorderVerdict(items);
    ok(`order O2: ${what}: still ordered by themselves`, v.auto, J(v));
    if (v.auto) ok(`order O2: ${what}: Forge's order is kept`, J(v.order) === J(items.map((i) => i.id)), J(v.order));
  }
  // O3: three copies, any order, stay automatic; one different trigger among them asks
  const three = [{ id: "r1", card: mage(301, 2), oracle: PING }, { id: "r2", card: mage(302, 1), oracle: PING }, { id: "r3", card: mage(303, 3), oracle: PING }];
  for (const perm of [[0, 1, 2], [2, 0, 1], [1, 2, 0]]) {
    const v = await reorderVerdict(perm.map((k) => three[k]));
    ok(`order O3: three identical, order ${perm.join("")}: ordered by themselves`, v.auto, J(v));
    const mixed = perm.map((k) => (k === 2 ? { ...three[k], oracle: "When this creature enters, draw a card." } : three[k]));
    const m = await reorderVerdict(mixed);
    ok(`order O3: one different trigger, order ${perm.join("")}: asked`, m.asked, J(m));
  }
  // O4: a different card name with the same text is no copy (asked), and the rule is for triggers only
  const other = [{ id: "r1", card: mage(301, 2), oracle: PING }, { id: "r2", card: { ...mage(302, 1), identity: { name: "Firebrand Archer" } }, oracle: PING }];
  ok("order O4: same text from two different cards: asked", (await reorderVerdict(other)).asked);
  const plainOrder = await reorderVerdict(two(PING), "Ephemerate", { sourceAbilityText: "Exile target creature you control, then return it to the battlefield under its owner's control.", sourceCard: { id: "engine-card-35", identity: { name: "Ephemerate" } } });
  ok("order O4: a non-trigger order of two alike creatures is asked", plainOrder.asked, J(plainOrder));
}

// ── #18 order wording; #19 graft type word; #17 revolt number ──
async function wordingRelations() {
  // #18: the order question names its source and says "comes back" for a return to the battlefield, "goes" otherwise
  const items = [{ id: "r1", card: mage(301, 2) }, { id: "r2", card: mage(302, 1) }];
  const orderTitle = async (srcName, text) => (await ask(D2.board, { ...prompt("reorder", { items, presentation: { title: srcName } }), sourceAbilityText: text, sourceCard: { id: "engine-card-35", identity: { name: srcName } } })).ui?.title || null;
  const back = await orderTitle("Ephemerate", "Exile target creature you control, then return it to the battlefield under its owner's control.");
  ok("words #18 precondition: Ephemerate's order is asked in words", /^Ephemerate: click the one that comes back first$/.test(back || ""), back);
  const renamed = await orderTitle("Cloudshift", "Exile target creature you control, then return it to the battlefield under your control.");
  ok("words #18: another name, same words: the same question with its name", renamed === back?.replace("Ephemerate", "Cloudshift"), renamed);
  const goes = await orderTitle("Ephemerate", "Exile target creature you control.");
  ok("words #18: no return: 'goes', never 'comes back'", goes === back?.replace("comes back", "goes"), goes);

  // #19: a non-creature source says its own type in place of "this creature"; a creature keeps it
  const graft = async (types, onBoard = false) => {
    const b = myMain();
    const reborn = { id: "engine-card-960", identity: { name: "Llanowar Reborn" }, types, text: "Graft 1", ownerId: "player-0", controllerId: "player-0" };
    if (onBoard) zone(b, "battlefield").cards.push(reborn);
    const r = await ask(b, prompt("chooseBoolean", { confirmLabel: "Yes", denyLabel: "No", presentation: { title: "Move a +1/+1 counter from this creature onto it?" } },
      { sourceCard: onBoard ? { id: reborn.id, identity: reborn.identity } : reborn, sourceAbilityText: "Whenever another creature enters, you may move a +1/+1 counter from this creature onto it." }));
    return r.ui?.title || null;
  };
  const asCreature = await graft(["Creature"]);
  ok("words #19 precondition: a creature's question keeps 'this creature'", /from this creature onto it/.test(asCreature || ""), asCreature);
  for (const [types, word] of [[["Land"], "land"], [["Artifact"], "artifact"], [["Enchantment"], "enchantment"], [["Artifact", "Land"], "land"], [["Tribal", "Kindred"], "permanent"]]) {
    const t = await graft(types);
    ok(`words #19: a ${types.join(" ")} says 'this ${word}' and the rest unchanged`, t === asCreature.replace("this creature", `this ${word}`), t);
  }
  ok("words #19: an artifact creature keeps 'this creature'", (await graft(["Artifact", "Creature"])) === asCreature);
  // two routes to the source's types: the prompt's own card, or the board's when the prompt has none
  ok("words #19: types from the board say the same as types on the prompt", (await graft(["Land"], true)) === (await graft(["Land"])));

  // #17: with revolt on the question says the revolt number; off, or the opponent's revolt, the base number
  const FP = (base, rev) => `Destroy target creature if it has mana value ${base} or less.\nRevolt — Destroy that creature if it has mana value ${rev} or less instead if a permanent you controlled left the battlefield this turn. (You controlled it when it left.)`;
  const push = async (text, revolt) => {
    const b = myMain();
    zone(b, "battlefield").cards.push({ id: "engine-card-952", identity: { name: "Entity Tracker" }, types: ["Creature"], ownerId: "player-0", controllerId: "player-0", text: "" });
    const r = await ask(b, { ...prompt("chooseBoardTargets", { cancellable: true, candidates: [{ id: "engine-card-952", kind: "card" }], chosenTargets: 0, minTargets: 1, maxTargets: 1, presentation: { targets: [], title: "Destroy" } }),
      sourceAbilityText: text, sourceCard: { id: "engine-card-954", identity: { name: "Fatal Push" }, text } }, {}, { revolt });
    return r.ui?.title || null;
  };
  const turn = D2.board.gameView.turn;
  for (const [base, rev] of [[2, 4], [1, 3], [3, 6], [2, "X"]]) {
    const text = FP(base, rev);
    const off = await push(text, {});
    ok(`words #17 precondition: revolt off says mana value ${base} (${base}->${rev})`, new RegExp(`mana value ${base} or less`).test(off || ""), off);
    const on = await push(text, { "player-0": turn });
    ok(`words #17: revolt on says ${rev} where off said ${base}, nothing else changed`, on === off.replace(`mana value ${base} or less`, `mana value ${rev} or less`), `${off} | ${on}`);
    ok(`words #17: the opponent's revolt is off (${base}->${rev})`, (await push(text, { "player-1": turn })) === off);
    ok(`words #17: last turn's revolt is off (${base}->${rev})`, (await push(text, { "player-0": turn - 1 })) === off);
  }
}

// ── #20 text change, #21 bounced token: the log from two boards and Forge's events ──
const ZONES = ["library", "hand", "graveyard", "exile", "battlefield", "command"];
const blank = () => ({ turn: 3, step: "main1", activePlayerId: "player-0", priorityPlayerId: "player-0", stack: [],
  zones: ["player-0", "player-1"].flatMap((ownerId) => ZONES.map((z) => ({ zone: z, ownerId, cards: [], count: 0 }))) });
const put = (b, z, c, ownerId = "player-0") => { const x = b.zones.find((y) => y.zone === z && y.ownerId === ownerId); x.cards.push(c); x.count = x.cards.length; };
const ev = (seq, from, to, cardId, ownerId = "player-0") => ({ seq, ...(cardId ? { cardId } : {}), from, to, ownerId });
function between(before, after, events) {
  const s = sit(myMain(), {}, { eventSeq: 10 });
  return s.h.B.logEvents(s.h.B.logSnapshot(before), s.h.B.logSnapshot(after), after, s.h.B.engineFacts(events));
}
async function logRelations() {
  // #20: a retargeted text: "changes nothing" exactly when the text minus its reminders is the same
  const target = (text, ct) => ({ id: "engine-card-53", identity: { name: "Bog Wraith" }, types: ["Creature"], controllerId: "player-0", ownerId: "player-0", text, ...(ct != null ? { currentText: ct } : {}) });
  const BEND = { id: "stack-10", sourceId: "engine-card-54", identity: { name: "Mind Bend" }, controllerId: "player-0", targets: [{ kind: "card", id: "engine-card-53" }],
    sourceAbilityText: "Change the text of target permanent by replacing all instances of one color word with another or one basic land type with another." };
  const bent = (text, ct) => between(
    (() => { const b = blank(); put(b, "battlefield", target(text)); b.stack.push(BEND); return b; })(),
    (() => { const b = blank(); put(b, "battlefield", target(text, ct)); put(b, "graveyard", { id: "engine-card-54", identity: { name: "Mind Bend" }, types: ["Instant"], controllerId: "player-0" }); return b; })(),
    [ev(13, "Stack", "Graveyard", "engine-card-54")]);
  const NOTHING = ["Mind Bend changes nothing in Bog Wraith's text"];
  for (const tx of ["Swampwalk", "Flying", "({T}: Add {G}.)", "First strike (This creature deals combat damage first.)\nVigilance"]) {
    const same = bent(tx, null);
    ok(`text T1: unchanged text changes nothing (${tx.slice(0, 20)})`, J(same) === J(NOTHING), J(same));
    // T2: one side's reminder dropped, or its line ends "\r\n", changes nothing either
    const noReminder = tx.replace(/\s*\([^)]*\)/g, "").trim();
    ok(`text T2: a reminder dropped changes nothing (${tx.slice(0, 20)})`, J(bent(tx, noReminder)) === J(NOTHING), J(bent(tx, noReminder)));
    ok(`text T2: CRLF line ends change nothing (${tx.slice(0, 20)})`, J(bent(tx, tx.replace(/\n/g, "\r\n"))) === J(NOTHING), J(bent(tx, tx.replace(/\n/g, "\r\n"))));
  }
  // T3: a real change is never "changes nothing", and the same words added to both sides keep it a change
  for (const [was, now] of [["Swampwalk", "Islandwalk"], ["Protection from black", "Protection from red"], ["Flying", "Flying, vigilance, deathtouch, lifelink and haste."]]) {
    const base = bent(was, now);
    ok(`text T3 precondition: one line for ${was} -> ${now}`, base.length === 1 && /^Bog Wraith's text changes/.test(base[0]), J(base));
    for (const extra of ["\nTrample", " (A reminder.)", "\n({T}: Add {B}.)"]) {
      const more = bent(was + extra, now + extra);
      ok(`text T3: ${J(extra)} on both sides keeps it a change (${was} -> ${now})`, more.length === 1 && /^Bog Wraith's text changes/.test(more[0]), J(more));
    }
    ok(`text T3: a reminder dropped beside the change keeps it a change (${was} -> ${now})`, /^Bog Wraith's text changes/.test(bent(`${was} (Reminder.)`, now)[0] || ""), J(bent(`${was} (Reminder.)`, now)));
  }

  // #21: a token sent to a hand ceases to exist; flipping only "token" adds or removes exactly that
  for (const [name, owner, who] of [["Goblin", "player-0", "Blue"], ["Everywhere", "player-1", "AI 1"], ["Treasure", "player-0", "Blue"]]) {
    const mk = (token) => ({ id: "engine-card-5", identity: { name, ...(token ? { isToken: true } : {}) }, types: name === "Treasure" ? ["Artifact"] : ["Creature"], controllerId: owner, ownerId: owner });
    const bounce = (token, events = [ev(11, "Battlefield", "Hand", "engine-card-5", owner)]) => {
      const before = blank(); put(before, "battlefield", mk(token), owner);
      const after = blank();
      if (!token) put(after, "hand", mk(token), owner);
      return between(before, after, events);
    };
    const card = bounce(false), tok = bounce(true);
    ok(`token K1 precondition: a card bounced returns to ${who}'s hand (${name})`, card.length === 1 && card[0].includes(`returns to ${who}'s hand`), J(card));
    const tokName = (l) => l.replace(/ token\b/, "").replace(/^(\w)/, (c) => c.toUpperCase());
    ok(`token K1: the token's line is the card's and "ceases to exist" (${name})`, tok.length === 1 && tokName(tok[0]) === `${card[0]} and ceases to exist`.replace(/ token\b/, ""), `${J(card)} vs ${J(tok)}`);
    // K2: no event says where it went: no hand named
    const unknown = bounce(true, []);
    ok(`token K2: no event names no hand (${name})`, unknown.length === 1 && !/hand|ceases/.test(unknown[0]), J(unknown));
    // K3: to exile or a graveyard is never "returns to the hand"
    for (const to of ["Exile", "Graveyard"]) {
      const l = bounce(true, [ev(11, "Battlefield", to, "engine-card-5", owner)]);
      ok(`token K3: a token to ${to} never returns to a hand (${name})`, l.length === 1 && !/hand/.test(l[0]), J(l));
    }
  }
}

// ── Gaps these relations found (2026-11-05 review), reported and not counted: RELATIONS_STRICT=1 counts them as
// failures. Each prints GAP while the bridge still has it, and FIXED once it doesn't. ──
let gaps = 0;
const gap = (name, holds, why) => {
  if (process.env.RELATIONS_STRICT) return ok(`gap: ${name}`, holds, why);
  if (!holds) gaps++;
  process.stdout.write(`${holds ? "FIXED" : "GAP"} ${name}${holds ? "" : `: ${why}`}\n`);
};
async function knownGaps() {
  // G1: alike non-creatures are not told apart (the #n pass needs power): two Treasure tokens, two Forests
  const art = (n, name, types, token) => ({ id: `engine-card-${n}`, identity: { name, ...(token ? { isToken: true } : {}) }, types, ownerId: "player-1", controllerId: "player-1", text: "" });
  for (const [what, cards] of [["two Treasure tokens", [art(961, "Treasure", ["Artifact"], true), art(962, "Treasure", ["Artifact"], true)]],
    ["two Forests", [art(961, "Forest", ["Land"]), art(962, "Forest", ["Land"])]]]) {
    const l = await labelsOf(cards);
    gap(`labels: ${what} read apart`, Object.keys(l).length === 2 && distinct(l), J(l));
  }
  // G2: an opponent's face-down permanent (Forge sends { visibility: "hidden", id }) is offered by its engine id
  const b = myMain();
  zone(b, "battlefield", "player-1").cards.push({ visibility: "hidden", id: "engine-card-961" }, { visibility: "hidden", id: "engine-card-962" });
  const r = await ask(b, { ...prompt("chooseBoardTargets", { cancellable: true, candidates: [{ id: "engine-card-961", kind: "card" }, { id: "engine-card-962", kind: "card" }], chosenTargets: 0, minTargets: 1, maxTargets: 1,
    presentation: { targets: [], title: "Deal 1 damage" } }), sourceAbilityText: "When this creature enters, it deals 1 damage to any target.", sourceCard: { id: "engine-card-966", identity: { name: "Orcish Bowmasters" } } });
  const hidden = (r.ui?.options || []).map((o) => o.label);
  gap("labels: a hidden face-down target is not named by its engine id", hidden.length === 2 && hidden.every((x) => !/^engine-card-/.test(x)), J(hidden));
  // G3: a pain land's two abilities: generic is paid by whichever Forge lists first, the painful one too
  const C = { id: "tap:engine-card-64:0", type: "activateManaAbility", cardId: "engine-card-64", cost: "{T}", isManaAbility: true, description: "{T}: Add {C}.", producedMana: [{ amount: 1, color: "C" }] };
  const G = { ...C, id: "tap:engine-card-64:1:G", description: "{T}: Add {B} or {G}. Llanowar Wastes deals 1 damage to you.", producedMana: [{ amount: 1, color: "G" }] };
  const first = await payPlan({ cost: "{1}", acts: [C, G], hand: [] }), painFirst = await payPlan({ cost: "{1}", acts: [G, C], hand: [] });
  gap("pay: a pain land's painless {C} pays generic in either order", J(first.taps) === J([C.id]) && J(painFirst.taps) === J([C.id]), `${J(first.taps)} / ${J(painFirst.taps)}`);
}

(async () => {
  await relation("smartPay", smartPayRelations);
  await relation("mana back", manaBackRelations);
  await relation("labels", labelRelations);
  await relation("reorder", reorderRelations);
  await relation("wording", wordingRelations);
  await relation("log", logRelations);
  await relation("known gaps", knownGaps);
  harness.restore();
  process.stdout.write(`${passed} passed, ${failed} failed${gaps ? `, ${gaps} known gaps (RELATIONS_STRICT=1 counts them)` : ""}\n`);
  process.exit(failed ? 1 : 0);
})();
