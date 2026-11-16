// The table profile (M6 step 9, docs/m6-six-seat-spec.md §2.2): what our code needs to know about one Workshop table,
// read from its save: the seats in clockwise order, each seat's objects (GUIDs and where they lie), the life trackers,
// the commander zones and commander-damage trackers, the Start tile's spot, the objects the engine copy removes, and
// which of the table's optional tools it has. make-engine-copy.js builds the engine table from it, and writes it into
// the Global script as TABLE_PROFILE for tools/engine-renderer.lua.
//   node tools/table-profile.js <workshop.json> [--out <file>]   writes tools/profiles/<workshop id>.json
//   node tools/table-profile.js <workshop.json> --check          exit 1 when the file there differs from the save's
// The Workshop file is only read. The profile holds GUIDs, positions, colours and our own choices, never the table's
// scripts, names or assets: the repo is public and the table is someone else's work.
// A field it can't find is an error (exit 1, nothing written), never a guess; the one exception is cmdDamage, which a
// table may not have, and is then null and listed in notFound, unless the table's choices make the trackers (the
// 6-player table has bags, not trackers: M6 step 12 gives it the 4-player table's, cmdDamageMade).
"use strict";
const fs = require("fs");
const path = require("path");

// Global's per-seat registry: data["<colour>"]["<role>"] = getObjectFromGUID("<guid>")
const ROLES = ["playmat", "libraryZone", "graveyard", "mulliganButton", "untapButton", "drawButton", "scryButton", "millButton", "revealButton"];

// Our own choices per table (not facts of the save). Matched by facts that tell the tables apart (the seat count and
// White's playmat: the same GUID is another seat's mat on the other table). A table with no entry here is refused.
//   clutterBoxes: the side columns the engine copy clears (the user's red boxes on the 4-player table, 2026-10-18).
//     The 6-player table's (M6 step 13) are the 4-player ones' shape on its own end columns: the dice, keyword, mana
//     and counter columns, both Drop-On-Card Counters, the 12 commander-damage bags, both Turn Order cards, the dungeon
//     and reminder cards and Planechase; not the west importers or the playmat enabler (0ae315) at z -12..-18, which
//     stay as on the 4-player table. They start at |x| 45, not 44: White's and Green's made tracker rows reach 44.6;
//     nothing of the table's lies between 44 and 45.3.
//   spots: the Game mode, Free mulligans and Teams buttons (MODE_SPOT, FRIENDLY_SPOT, TEAMS_SPOT in the renderer),
//     world x, y, z on the west strip. On the 6-player table 2 further out than on the 4-player one: a button there is
//     3.2 deep across the strip, and Green's column (x -41.8) and its tracker row (to -45.2) come nearer the end.
//   makeCmdDamage: a table without commander-damage trackers gets the 4-player table's (make-engine-copy.js copies
//     them from the host's 4-player Workshop file at build time; the 6-player table's own bags hold an older script):
//     each victim's row of one per attacker, `step` apart along the victim's own left-to-right, centred on its life
//     tracker's x, at z = `z` on its side of the middle strip (the turn timers' strip, empty once they are gone). Left to
//     right the attackers in turn order from the next seat on, so the next seat's is the one on the player's left.
const TABLES = [
  { id: "2296042369", seats: 4, whitePlaymat: "8b3401",
    clutterBoxes: [{ x: [-56, -44], z: [-8.5, 32] }, { x: [44, 56], z: [-26, 8.5] }],
    spots: { mode: [-47, 1.1, -2.5], friendly: [-47, 1.1, 7.5], teams: [-47, 1.1, 17.5] } },
  { id: "2293586471", seats: 6, whitePlaymat: "7cffe1",
    clutterBoxes: [{ x: [-56, -45], z: [-8.5, 33] }, { x: [45, 56], z: [-33, 8.5] }],
    spots: { mode: [-49, 1.1, -2.5], friendly: [-49, 1.1, 7.5], teams: [-49, 1.1, 17.5] },
    makeCmdDamage: { step: 1.4, z: 3 } },
];

// The objects the engine copy removes, by what they are (make-engine-copy.js used to name the 4-player table's GUIDs):
// Encoder modules nothing in engine mode uses (they lengthen Unity's clean-up pauses; the Encoder, πScry, πMenu and
// "Is it a token?" stay: the table's own script calls them), the turn timers, the 3D background bundles under the
// table, the Bruh Button, a second copy of rikrassen's importer (the west one stays), and the Drafting tools and
// Pie's MTG Enablers bags (user request, 2026-10-18).
const ENCODER_MODULES = [/Easy Modules Unified/, /^πKeywords$/, /^Morphin' Time$/, /^πNotepad$/, /^Auto Player Promoter$/,
  /^Sticker Encoder$/, /^Color Module$/, /^πCounter$/, /^Phasing$/];
const BAGS = [/^Drafting tools$/, /^Pie's MTG Enablers$/];

const nameOf = (o) => String(o.Nickname || "").replace(/\[\/?[a-z0-9]*\]/gi, "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
const r3 = (n) => { const v = Math.round(Number(n) * 1000) / 1000; return Object.is(v, -0) ? 0 : v; };
const r1 = (n) => { const v = Math.round(Number(n) * 10) / 10; return Object.is(v, -0) ? 0 : v; };
const spot = (o) => ({ guid: o.GUID, x: r3(o.Transform.posX), z: r3(o.Transform.posZ) });
const colourOf = (o) => String(o.Description || "").trim();

// save (a parsed TTS save) -> { profile, errors } (profile null when anything required is missing)
function extract(save) {
  const errors = [];
  const top = save.ObjectStates || [];
  const byGuid = new Map(top.map((o) => [o.GUID, o]));
  const global = String(save.LuaScript || "");

  // 1. the registry: each seat's role -> GUID, every GUID a top-level object
  const reg = {};
  for (const m of global.matchAll(/data\["(\w+)"\]\["(\w+)"\]\s*=\s*getObjectFromGUID\("([0-9a-f]{6})"\)/g)) {
    if (!ROLES.includes(m[2])) continue;
    (reg[m[1]] = reg[m[1]] || {})[m[2]] = m[3];
  }
  const colours = Object.keys(reg);
  if (colours.length < 2) errors.push(`Global: ${colours.length} seat(s) in the data["<colour>"] registry`);
  const seat = {};
  for (const c of colours) {
    seat[c] = {};
    for (const role of ROLES) {
      const g = reg[c][role];
      const o = g && byGuid.get(g);
      if (!g) errors.push(`${c}.${role}: not in Global's registry`);
      else if (!o) errors.push(`${c}.${role}: ${g} is in Global's registry but not on the table`);
      else seat[c][role] = role === "playmat" ? { ...spot(o), rotY: r3(o.Transform.rotY) } : spot(o);
    }
  }

  // 2. clockwise from above, starting at White: the mats by falling angle atan2(z, x) (the rule that makes the
  // 4-player order White -> Red -> Yellow -> Blue)
  const ang = (c) => Math.atan2(seat[c].playmat.z, seat[c].playmat.x);
  // (a seat without its mat is already an error: the rest are still ordered and read, so every missing field is named)
  let seats = [];
  if (!colours.includes("White") || !seat.White.playmat) errors.push("no White playmat to start the clockwise order at");
  else {
    const a0 = ang("White");
    const turn = (c) => ((a0 - ang(c)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); // (0 for White, rising clockwise)
    seats = colours.filter((c) => seat[c].playmat).sort((a, b) => turn(a) - turn(b));
  }

  // 3. per-seat objects found by what they are, the colour in their Description (hand zones: FogColor)
  const one = (c, label, list) => {
    if (list.length !== 1) { errors.push(`${c}.${label}: ${list.length} found (want 1)`); return null; }
    return list[0];
  };
  const named = (re) => top.filter((o) => re.test(nameOf(o)));
  for (const c of seats) {
    const s = seat[c];
    const hands = top.filter((o) => o.Name === "HandTrigger" && o.FogColor === c)
      .sort((a, b) => b.Transform.scaleX * b.Transform.scaleZ - a.Transform.scaleX * a.Transform.scaleZ);
    if (!hands.length) errors.push(`${c}.hand: no hand zone`);
    else s.hand = { ...spot(hands[0]), rotY: r3(hands[0].Transform.rotY) };
    const life = one(c, "lifeTracker", named(/^Life Tracker$/).filter((o) => colourOf(o) === c));
    if (life) {
      s.lifeTracker = spot(life);
      // (on the seat's own half of the table: the same side as its mat)
      if (s.playmat && Math.sign(s.lifeTracker.z) !== Math.sign(s.playmat.z)) errors.push(`${c}.lifeTracker: ${life.GUID} is on the other half of the table from ${c}'s mat`);
    }
    const timer = one(c, "timer", named(/^Timer$/).filter((o) => colourOf(o) === c));
    if (timer) s.timer = spot(timer);
    // the two commander zones, left to right as the player sees them (along the seat's right); level ones (the
    // 6-player table's lie one behind the other) nearest the player first
    const zones = named(/^Commander Zone$/).filter((o) => colourOf(o) === c).map(spot);
    if (zones.length !== 2) errors.push(`${c}.commandZones: ${zones.length} found (want 2)`);
    else if (s.hand) {
      // (the way the player faces: the hand zone's forward, as seatGeometry reads the hand's rotation)
      const yaw = (s.hand.rotY * Math.PI) / 180;
      const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      const along = (p) => p.x * right.x + p.z * right.z;
      const near = (p) => (p.x - s.hand.x) ** 2 + (p.z - s.hand.z) ** 2;
      zones.sort((a, b) => (Math.abs(along(a) - along(b)) > 0.5 ? along(a) - along(b) : near(a) - near(b)));
      s.commandZones = zones;
    }
  }

  // our choices for this table (step 8 below says when there are none)
  const white = seat.White && seat.White.playmat && seat.White.playmat.guid;
  const choice = TABLES.find((t) => t.seats === seats.length && t.whitePlaymat === white);

  // 4. commander damage: one tracker per (victim, attacker); the attacker is its Description, the victim the seat
  // whose life tracker is nearest. Victims from the first seat, then anticlockwise; each victim's attackers nearest the
  // table's middle first (the order the renderer's CMD_DAMAGE has always had: Lua's pairs follows it). A table without
  // trackers whose choices make them (makeCmdDamage) gets them as made (cmdDamageMade), read by the same rule.
  const notFound = [];
  let cmdDamage = null, cmdDamageMade = null;
  let trackers = named(/^Commander Damage$/).map((o) => ({ guid: o.GUID, attacker: colourOf(o), p: spot(o) })); // (the bags are "<colour> Commander Damage")
  if (!trackers.length && choice && choice.makeCmdDamage && seats.every((c) => seat[c].lifeTracker && seat[c].hand && seat[c].playmat)) {
    cmdDamageMade = makeTrackers(seats, seat, choice.makeCmdDamage, new Set([...allObjects(top)].map((o) => o.GUID)));
    trackers = cmdDamageMade.map((t) => ({ guid: t.guid, attacker: t.attacker, p: { guid: t.guid, x: t.x, z: t.z }, made: t.victim }));
  }
  if (!trackers.length) notFound.push("cmdDamage: no Commander Damage trackers on the table, and none to make (TABLES makeCmdDamage)");
  else if (seats.every((c) => seat[c].lifeTracker)) {
    const rows = {};
    for (const t of trackers) {
      const p = t.p, attacker = t.attacker;
      let victim = null, best = Infinity;
      for (const c of seats) {
        const d = (seat[c].lifeTracker.x - p.x) ** 2 + (seat[c].lifeTracker.z - p.z) ** 2;
        if (d < best) { best = d; victim = c; }
      }
      if (!seats.includes(attacker)) { errors.push(`cmdDamage: ${t.guid}'s attacker "${attacker}" is no seat`); continue; }
      if (attacker === victim) { errors.push(`cmdDamage: ${t.guid} (${attacker}) lies by its own colour's life tracker`); continue; }
      // (a made one is read back by the same rule as a table's own: it must land on the victim it was made for)
      if (t.made && t.made !== victim) { errors.push(`cmdDamage: the tracker made for ${t.made} (${attacker}, ${t.guid}) lies nearest ${victim}'s life tracker`); continue; }
      (rows[victim] = rows[victim] || []).push({ attacker, p });
    }
    cmdDamage = {};
    for (const v of [seats[0], ...seats.slice(1).reverse()]) {
      const list = (rows[v] || []).sort((a, b) => (a.p.x ** 2 + a.p.z ** 2) - (b.p.x ** 2 + b.p.z ** 2));
      const from = list.map((t) => t.attacker);
      const want = seats.filter((c) => c !== v);
      if (from.length !== want.length || want.some((c) => !from.includes(c))) errors.push(`cmdDamage.${v}: trackers for ${from.join(", ") || "nobody"} (want one each for ${want.join(", ")})`);
      cmdDamage[v] = Object.fromEntries(list.map((t) => [t.attacker, t.p.guid]));
    }
  }

  // 5. the Start tile: between the life trackers (their middle), on the table top
  const lives = seats.map((c) => seat[c].lifeTracker).filter(Boolean);
  const start = lives.length ? [r1(lives.reduce((a, l) => a + l.x, 0) / lives.length), 0.95, r1(lives.reduce((a, l) => a + l.z, 0) / lives.length)] : null;

  // 6. what the engine copy removes (see ENCODER_MODULES above)
  const remove = [];
  const under = top.filter((o) => o.Transform.posY < 0);
  for (const re of ENCODER_MODULES) {
    const hit = under.filter((o) => /^PiecePack_/.test(o.Name) && re.test(nameOf(o)));
    if (!hit.length) errors.push(`remove: no Encoder module matching ${re}`);
    remove.push(...hit.map((o) => o.GUID));
  }
  const importers = named(/^rikrassen's MTG Deck\/Draft\/Cube Importer$/).sort((a, b) => a.Transform.posX - b.Transform.posX);
  if (!importers.length) errors.push("remove: no rikrassen importer tile");
  remove.push(...importers.slice(1).map((o) => o.GUID));
  remove.push(...named(/^Bruh Button$/).map((o) => o.GUID));
  const timers = seats.map((c) => seat[c].timer && seat[c].timer.guid).filter(Boolean);
  remove.push(...timers);
  const bundles = top.filter((o) => o.Name === "Custom_Assetbundle" && o.Transform.posY < -40);
  if (!bundles.length) errors.push("remove: no 3D background bundles under the table");
  remove.push(...bundles.map((o) => o.GUID));
  const bags = [];
  for (const re of BAGS) {
    const hit = named(re).filter((o) => /Bag/.test(o.Name));
    if (!hit.length) errors.push(`remove: no bag matching ${re}`);
    bags.push(...hit.map((o) => o.GUID));
  }

  // 7. the optional tools the table has (make-engine-copy guards them only where they are)
  const scripts = [...allObjects(top)].map((o) => String(o.LuaScript || ""));
  const features = {
    wastes: /\bfunction deckRampWa\b/.test(global),
    treachery: scripts.some((s) => /\bfunction getToken\b/.test(s)),
  };

  // 8. our choices for this table (found above, before the commander damage that may need them)
  if (!choice) errors.push(`no choices for this table (${seats.length} seats, White's playmat ${white}): add it to TABLES in tools/table-profile.js`);
  const saveName = String(save.SaveName || "");
  if (!/ - scripted$/.test(saveName)) errors.push(`SaveName "${saveName}" doesn't end in " - scripted"`);

  if (errors.length) return { profile: null, errors };
  return {
    errors,
    profile: {
      note: "Generated by tools/table-profile.js from the Workshop table's save: GUIDs, positions, colours and our choices only. Do not edit by hand.",
      id: choice.id,
      saveName: saveName.replace(/ - scripted$/, " - ENGINE MODE"),
      seats,
      seat: Object.fromEntries(seats.map((c) => [c, seat[c]])),
      cmdDamage,
      cmdDamageMade,
      start,
      spots: choice.spots,
      remove: [...bags, ...remove],
      clutterBoxes: choice.clutterBoxes,
      features,
      notFound,
    },
  };
}

// The commander-damage trackers a table without them gets (TABLES makeCmdDamage), as { guid, victim, attacker, x, z,
// rotY }: victims in seat order, each one's attackers left to right as the victim sees them (along the hand zone's
// right, as seatGeometry reads it), in turn order from the next seat on; turned as the victim's playmat (the 4-player
// table's trackers are: 180 on the south side, 0 on the north). GUIDs as the status-piece copies' (make-engine-copy.js):
// sha1 of "victim:attacker", salted past any GUID in `taken` (the table's own; make-engine-copy checks the 4-player
// table's too).
function makeTrackers(seats, seat, rule, taken) {
  const out = [];
  const guidFor = (key) => {
    for (let salt = 0; salt < 50; salt++) {
      const g = require("crypto").createHash("sha1").update(`${key}${salt ? `:${salt}` : ""}`).digest("hex").slice(0, 6);
      if (!taken.has(g)) { taken.add(g); return g; }
    }
    throw new Error(`no free GUID for the ${key} commander-damage tracker`);
  };
  seats.forEach((v, i) => {
    const s = seat[v];
    const yaw = (s.hand.rotY * Math.PI) / 180;
    const right = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const from = [...seats.slice(i + 1), ...seats.slice(0, i)];
    const z0 = Math.sign(s.lifeTracker.z) * rule.z;
    from.forEach((a, k) => {
      const off = (k - (from.length - 1) / 2) * rule.step;
      out.push({ guid: guidFor(`${v}:${a}`), victim: v, attacker: a, x: r3(s.lifeTracker.x + off * right.x), z: r3(z0 + off * right.z), rotY: r3(s.playmat.rotY) });
    });
  });
  return out;
}

function* allObjects(list) {
  for (const o of list || []) {
    yield o;
    yield* allObjects(o.ContainedObjects);
    yield* allObjects(Object.values(o.States || {}));
  }
}

const profileText = (p) => JSON.stringify(p, null, 1) + "\n";
const profilePath = (id) => path.join(__dirname, "profiles", `${id}.json`);

function main(argv) {
  const src = argv.find((a) => !a.startsWith("--"));
  const at = argv.indexOf("--out");
  if (!src) { console.log("usage: node tools/table-profile.js <workshop.json> [--out <file>] [--check]"); return 2; }
  const { profile, errors } = extract(JSON.parse(fs.readFileSync(src, "utf8")));
  if (!profile) { console.log(`Not written: ${errors.length} field(s) not found\n${errors.map((e) => `  ${e}`).join("\n")}`); return 1; }
  const out = at >= 0 ? argv[at + 1] : profilePath(profile.id);
  const text = profileText(profile);
  for (const n of profile.notFound) console.log(`not on this table: ${n}`);
  if (argv.includes("--check")) {
    const same = fs.existsSync(out) && fs.readFileSync(out, "utf8") === text;
    console.log(same ? `${out} matches the save` : `${out} differs from the save: run without --check to write it`);
    return same ? 0 : 1;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log(`${profile.seats.length} seats, clockwise: ${profile.seats.join(" -> ")}\nwrote ${out}`);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { extract, profileText, profilePath, ROLES, TABLES };
