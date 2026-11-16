// The 6-player table's commander damage, clutter, backdrop and west-strip buttons (M6 steps 12-13,
// docs/m6-six-seat-spec.md §2.3.2-2.3.3):
//  1. The profile's made trackers: 30, each victim x its 5 attackers once, a row of five 1.4 apart centred on the
//     victim's life tracker at z +-3, the next seat clockwise on the player's left, turned as the victim's mat, GUIDs
//     sha1 of "victim:attacker" and on neither table; cmdDamage read back from them in the renderer's order rule.
//  2. make-engine-copy with the host's 4-player file: the 30 objects are copies of the 4-player tracker (script sha1
//     0fdc193a, attacker = Description, locked, at 0), gated as the 4-player ones; nothing of the table's lies on their
//     spots; no clutter box takes them. Without the 4-player file, with another table as it, or with a changed tracker
//     script: FAIL by name, nothing written.
//  3. The clutter boxes take the 12 commander-damage bags, both Drop-On-Card Counters (whose bag tokens c1ae57 and b8b5d4
//     carried the only ungated onNumberTyped on this table), both Turn Order cards and the dice / keyword / mana / counter
//     columns, and keep the importers, the playmat enabler and the status pieces. No ungated onNumberTyped is left in
//     either table's build.
//  4. The backdrop: the 4-player table's Lighting and Sky, the skybox, the 6-player table's own surface.
//  5. On the fake TTS: the board's commander damage on all 30, a manual fix reads a turned one, Standard puts all 30
//     away and Commander brings them back; the renderer's buttons on the life trackers (marks, badges, chips) clear
//     every tracker; the west-strip buttons at the profile's spots, in the cleared strip, clear of Green's column and
//     its row and of each other. The 4-player table keeps its spots (-47).
// The Workshop tables are read, never written. Without them the test says SKIP.
//   node tests/test_table_six.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { simulate } = require("./lua/run-sim");

const ROOT = path.join(__dirname, "..");
const WS = process.env.MTG_WORKSHOP_DIR || path.join(process.env.USERPROFILE || process.env.HOME || "", "Documents", "My Games", "Tabletop Simulator", "Mods", "Workshop");
const FOUR = path.join(WS, "2296042369.json"), SIX = path.join(WS, "2293586471.json");
// (the tools under test: a break-it points these at a changed copy)
const TOOLS = process.env.PROFILE_TOOLS || path.join(ROOT, "tools");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}`); } };
const same = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
const q = (lua, mark, frames) => ({ lua, mark, ...(frames != null ? { frames } : {}) });
const valueOf = (r, mark) => (r.steps.find((s) => s.step === mark) || {}).value;
const tp = require(path.join(TOOLS, "table-profile.js"));

if (!fs.existsSync(FOUR) || !fs.existsSync(SIX)) {
  console.log(`SKIP: the Workshop tables aren't in ${WS} (subscribe to 2296042369 and 2293586471, or set MTG_WORKSHOP_DIR)`);
  process.exit(0);
}
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const sha1 = (s) => crypto.createHash("sha1").update(String(s)).digest("hex");
const before = [sha(FOUR), sha(SIX)];
const fourSave = JSON.parse(fs.readFileSync(FOUR, "utf8")), sixSave = JSON.parse(fs.readFileSync(SIX, "utf8"));
function* allObjects(list) {
  for (const o of list || []) { yield o; yield* allObjects(o.ContainedObjects); yield* allObjects(Object.values(o.States || {})); }
}
const nameOf = (o) => String(o.Nickname || "").replace(/\[\/?[a-z0-9]*\]/gi, "").split("\n")[0].trim();
const SEATS = ["White", "Red", "Yellow", "Green", "Blue", "Purple"];
const p6 = tp.extract(sixSave).profile, p4 = tp.extract(fourSave).profile;

// ───────── 1. the profile's made trackers ─────────
const made = (p6 && p6.cmdDamageMade) || [];
{
  ok("profile: complete, nothing missing", p6 && p6.notFound.length === 0, p6 && JSON.stringify(p6.notFound));
  ok("profile: 30 made trackers, each victim with each other seat once", made.length === 30
    && SEATS.every((v) => SEATS.filter((a) => a !== v).every((a) => made.filter((t) => t.victim === v && t.attacker === a).length === 1)), made.length);
  const guids = made.map((t) => t.guid);
  const both = new Set([...allObjects(sixSave.ObjectStates), ...allObjects(fourSave.ObjectStates)].map((o) => o.GUID));
  ok("profile: GUIDs sha1 of victim:attacker, unique, on neither table", new Set(guids).size === 30 && made.every((t) => t.guid === sha1(`${t.victim}:${t.attacker}`).slice(0, 6) && !both.has(t.guid)),
    made.filter((t) => both.has(t.guid)).map((t) => t.guid).join(" "));
  for (const v of SEATS) {
    const s = p6.seat[v], row = made.filter((t) => t.victim === v);
    // left to right as the victim sees it: along the hand zone's right, (cos yaw, -sin yaw)
    const yaw = (s.hand.rotY * Math.PI) / 180, rx = Math.cos(yaw);
    const order = [...row].sort((a, b) => (a.x - b.x) * Math.sign(rx));
    const i = SEATS.indexOf(v), next = [...SEATS.slice(i + 1), ...SEATS.slice(0, i)];
    same(`profile: ${v}'s row left to right is the turn order from the next seat (${next[0]} on the left)`, order.map((t) => t.attacker), next);
    ok(`profile: ${v}'s row 1.4 apart, centred on its life tracker's x, at z ${Math.sign(s.lifeTracker.z) * 3}`,
      order.every((t, k) => Math.abs(t.x - (s.lifeTracker.x + (k - 2) * 1.4 * Math.sign(rx))) < 0.002 && t.z === Math.sign(s.lifeTracker.z) * 3), JSON.stringify(order.map((t) => [t.x, t.z])));
    ok(`profile: ${v}'s trackers turned as its mat (${s.playmat.rotY})`, row.every((t) => t.rotY === s.playmat.rotY));
  }
  // the renderer's order rule: victims from White then anticlockwise, attackers nearest the middle first
  const want = {};
  for (const v of ["White", "Purple", "Blue", "Green", "Yellow", "Red"]) {
    want[v] = Object.fromEntries(made.filter((t) => t.victim === v).sort((a, b) => (a.x ** 2 + a.z ** 2) - (b.x ** 2 + b.z ** 2)).map((t) => [t.attacker, t.guid]));
  }
  same("profile: cmdDamage is the made trackers, in the renderer's order", JSON.stringify(p6.cmdDamage), JSON.stringify(want));
  same("profile: the 6-player clutter boxes (the end columns from |x| 45)", p6.clutterBoxes, [{ x: [-56, -45], z: [-8.5, 33] }, { x: [45, 56], z: [-33, 8.5] }]);
  same("profile: the 6-player west-strip spots", p6.spots, { mode: [-49, 1.1, -2.5], friendly: [-49, 1.1, 7.5], teams: [-49, 1.1, 17.5] });
  same("profile: the 4-player table makes none and keeps its spots", [p4.cmdDamageMade, p4.spots], [null, { mode: [-47, 1.1, -2.5], friendly: [-47, 1.1, 7.5], teams: [-47, 1.1, 17.5] }]);
  // a tracker that would lie nearer another seat's life tracker is an error, not a quiet re-assignment
  const near = tp.TABLES.find((t) => t.id === "2293586471");
  const keep = near.makeCmdDamage;
  near.makeCmdDamage = { step: 15, z: 3 };
  const far = tp.extract(sixSave);
  near.makeCmdDamage = keep;
  ok("profile: a made tracker nearer another seat's life tracker is an error by name", far.profile === null && far.errors.some((e) => /^cmdDamage: the tracker made for \w+ \(\w+, [0-9a-f]{6}\) lies nearest \w+'s life tracker/.test(e)), far.errors.slice(0, 2).join("; "));
}

// ───────── 2-4. the build ─────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-six-"));
const copy = (src, out, extra = []) => spawnSync(process.execPath, [path.join(TOOLS, "make-engine-copy.js"), src, out, ...extra], { encoding: "utf8", maxBuffer: 1 << 26 });
const fails = (r) => r.stdout.split("\n").filter((l) => /^FAIL/.test(l)).join(" | ") || r.stderr;
let six = null, four = null;
const ungated = (save) => {
  const out = [];
  for (const o of [save, ...allObjects(save.ObjectStates)]) {
    for (const m of String(o.LuaScript || "").matchAll(/function\s+onNumberTyped\s*\([^)]*\)(.{0,40})/g)) {
      if (!/^\s*if Global\.getVar\('ENGINE_MODE'\)/.test(m[1])) out.push(`${o.GUID || "Global"} ${nameOf(o)}`);
    }
  }
  return out;
};
try {
  const r6 = copy(SIX, path.join(tmp, "six.json"), ["--profile", tp.profilePath("2293586471"), "--tracker-source", FOUR]);
  ok("build: the 6-player table builds with the 4-player file as its tracker source", r6.status === 0, fails(r6));
  const lines = r6.stdout.split("\n");
  ok("build: says the 30 trackers and the backdrop", lines.includes("OK   commander damage trackers made from the 4-player table's (b748df, script 0fdc193a): 30")
    && lines.includes("OK   backdrop: the 4-player table's Lighting and Sky (the skybox below; the table's own surface)"), lines.filter((l) => /tracker|backdrop/.test(l)).join(" | "));
  same("build: still only the two SKIPs, no FAIL", lines.filter((l) => /^(SKIP|FAIL)/.test(l)),
    ["SKIP gate Get basic land: deckRampWa (this table has no Wastes button)", "SKIP gate Treachery identity token buttons (x2) (this table has no Treachery cards)"]);
  if (r6.status === 0) six = JSON.parse(fs.readFileSync(path.join(tmp, "six.json"), "utf8"));
  const r4 = copy(FOUR, path.join(tmp, "four.json"));
  ok("build: the 4-player table builds as before", r4.status === 0, fails(r4));
  if (r4.status === 0) four = JSON.parse(fs.readFileSync(path.join(tmp, "four.json"), "utf8"));
  same("build: the 4-player build reads no tracker source and says nothing of trackers or backdrop", r4.stdout.split("\n").filter((l) => /commander damage trackers made|backdrop|tracker source/.test(l)), []);

  if (six) {
    const byGuid = new Map(six.ObjectStates.map((o) => [o.GUID, o]));
    const src = fourSave.ObjectStates.find((o) => o.GUID === "b748df");
    const objs = made.map((t) => [t, byGuid.get(t.guid)]);
    ok("trackers: all 30 on the table, top level", objs.every(([, o]) => o));
    const bad = objs.filter(([t, o]) => !o || o.Name !== src.Name || nameOf(o) !== "Commander Damage" || o.Description !== t.attacker || o.Locked !== true
      || o.LuaScriptState !== "[0]" || o.Transform.posX !== t.x || o.Transform.posZ !== t.z || o.Transform.rotY !== t.rotY
      || o.Transform.posY !== src.Transform.posY || o.Transform.scaleX !== src.Transform.scaleX || JSON.stringify(o.CustomImage) !== JSON.stringify(src.CustomImage));
    ok("trackers: copies of the 4-player tracker, Description = attacker, locked, at 0, at their spots", bad.length === 0, bad.map(([t]) => t.guid).join(" "));
    // (the gated script: the source's with the gates the 4-player trackers get, nothing else)
    const fourTracker = four && four.ObjectStates.find((o) => o.GUID === "b748df");
    ok("trackers: their script is the 4-player trackers' built script, gates and all", fourTracker && objs.every(([, o]) => o && o.LuaScript === fourTracker.LuaScript)
      && sha1(src.LuaScript).slice(0, 8) === "0fdc193a" && /function add_subtract\([^)]*\) if Global\.getVar\('ENGINE_MODE'\) and not Global\.getVar\('ENGINE_FIX_EDIT'\)/.test(fourTracker.LuaScript));
    const tint = { White: [1, 1, 1], Red: [0.856, 0.1, 0.094], Yellow: [0.905, 0.898, 0.172], Green: [0.192, 0.701, 0.168], Blue: [0.118, 0.53, 1], Purple: [0.627, 0.125, 0.941] };
    ok("trackers: tinted their attacker's colour (as the 4-player ones' ColorDiffuse)", objs.every(([t, o]) => o && JSON.stringify([o.ColorDiffuse.r, o.ColorDiffuse.g, o.ColorDiffuse.b]) === JSON.stringify(tint[t.attacker])));
    const tableLine = six.LuaScript.split("\n").find((l) => l.startsWith("  cmdDamage = "));
    ok("trackers: TABLE_PROFILE.cmdDamage names the 30, in the profile's order", tableLine === `  cmdDamage = { ${Object.entries(p6.cmdDamage).map(([v, row]) => `${v} = { ${Object.entries(row).map(([a, g]) => `${a} = "${g}"`).join(", ")} }`).join(", ")} },`, tableLine);
    // their spots are free: nothing else of the table's on the surface within 0.9 of one (the bags' tokens were 0.46)
    const surface = six.ObjectStates.filter((o) => o.Transform.posY > -1 && !made.some((t) => t.guid === o.GUID) && o.Name !== "HandTrigger" && !(o.Name === "ScriptingTrigger" && o.Transform.scaleX > 20));
    const crowded = made.flatMap((t) => surface.filter((o) => Math.abs(o.Transform.posX - t.x) < 0.9 && Math.abs(o.Transform.posZ - t.z) < 0.9).map((o) => `${t.guid}/${o.GUID} ${nameOf(o) || o.Name}`));
    ok("trackers: nothing else of the table's lies on their spots", crowded.length === 0, crowded.join(" | "));
    const boxed = made.filter((t) => p6.clutterBoxes.some((b) => t.x >= b.x[0] && t.x <= b.x[1] && t.z >= b.z[0] && t.z <= b.z[1]));
    ok("trackers: no clutter box takes one", boxed.length === 0, boxed.map((t) => t.guid).join(" "));

    // 3. clutter
    const left = [...allObjects(six.ObjectStates)];
    const named = (re) => left.filter((o) => re.test(nameOf(o)));
    same("clutter: the 12 commander-damage bags and their tokens gone", named(/^\w+ Commander Damage$/).map((o) => o.GUID), []);
    same("clutter: both Drop-On-Card Counters gone, the bag tokens c1ae57 and b8b5d4 too", named(/Drop-On-Card/).map((o) => o.GUID).concat(left.filter((o) => o.GUID === "c1ae57" || o.GUID === "b8b5d4").map((o) => o.GUID)), []);
    same("clutter: both Turn Order cards gone", named(/^Turn Order$/).map((o) => o.GUID), []);
    const cols = six.ObjectStates.filter((o) => o.Transform.posY > -1 && Math.abs(o.Transform.posX) > 45 && Math.abs(o.Transform.posX) < 56 && Math.abs(o.Transform.posZ) < 8.5);
    same("clutter: the dice, keyword, mana and counter columns (45 < |x| < 56, |z| < 8.5) empty", cols.map((o) => `${o.GUID} ${nameOf(o)}`), []);
    const kept = ["ddf5de", "11415b", "0ae315", "540e21", "8963ec", "197ab6", "2db63a", "cb418b", "d9fcbc", "94b67a", "da1b48", "576ccd", "4e8c7b"];
    same("clutter: the west importers, the playmat enabler, the cannon and the status pieces kept", kept.filter((g) => !byGuid.has(g)), []);
    same("clutter: no ungated onNumberTyped left on the 6-player table", ungated(six), []);
    ok("clutter: none on the 4-player table either", four && ungated(four).length === 0, four && ungated(four).join(", "));
    const plain = JSON.parse(JSON.stringify(sixSave));
    ok("clutter: precondition, in the 6-player table's own save the two bag tokens' onNumberTyped is ungated (the check sees one)", ["c1ae57", "b8b5d4"].every((g) => ungated(plain).some((l) => l.startsWith(g + " "))), ungated(plain).filter((l) => /Drop/.test(l)).join(", "));

    // 4. backdrop
    same("backdrop: the 4-player table's Lighting", six.Lighting, fourSave.Lighting);
    ok("backdrop: the 4-player table's Sky and the engine skybox (the 4-player build's)", six.Sky === fourSave.Sky && four && six.SkyURL === four.SkyURL && /^https:\/\/steamusercontent/.test(six.SkyURL), six.SkyURL);
    ok("backdrop: the 6-player table's own surface", six.Table === sixSave.Table && six.TableURL === sixSave.TableURL);
    ok("backdrop: precondition, the two tables' Lighting differ (so the copy shows)", JSON.stringify(sixSave.Lighting) !== JSON.stringify(fourSave.Lighting));
  }

  // without the 4-player file, another table as it, or a changed tracker script: refused by name, nothing written
  const refused = (name, extra, re) => {
    const out = path.join(tmp, `refused-${name}.json`);
    const r = copy(SIX, out, extra);
    ok(`refused, ${name}: FAIL by name, nothing written`, r.status === 1 && re.test(r.stdout) && !fs.existsSync(out), fails(r));
  };
  refused("no tracker source", ["--tracker-source", path.join(tmp, "nope.json")], /^FAIL tracker source: .*nope\.json isn't there \(the host's 4-player Workshop file, 2296042369: --tracker-source <file>\)$/m);
  refused("the 6-player table as the source", ["--tracker-source", SIX], /^FAIL tracker source: .*2293586471\.json isn't the 4-player table with its commander-damage trackers$/m);
  const changed = JSON.parse(JSON.stringify(fourSave));
  for (const o of changed.ObjectStates) if (o.GUID === "b748df") o.LuaScript += "\n-- changed";
  fs.writeFileSync(path.join(tmp, "changed.json"), JSON.stringify(changed));
  refused("a changed tracker script", ["--tracker-source", path.join(tmp, "changed.json")], /^FAIL commander damage trackers: the 4-player table's trackers' script is [0-9a-f, ]+, not 0fdc193a$/m);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

// ───────── 5. on the fake TTS ─────────
// A button b (local bx, bz; w, h in button units; its own scale scx, scz) on an object t (x, z, ry, sx, sz), in world
// [x0, x1, z0, z1]: TTS draws a button's +x on its reader's right, world (-cos ry, sin ry), and its +z at world
// (sin ry, cos ry); 480 button units to a local unit (tests/test_table_claims.js, measured on the live crop).
const buttonBox = (t, b) => {
  const a = (t.ry * Math.PI) / 180, hw = (b.w * (b.scx ?? 1)) / 2 / 480, hh = (b.h * (b.scz ?? 1)) / 2 / 480;
  const xs = [], zs = [];
  for (const [lx, lz] of [[b.bx - hw, b.bz - hh], [b.bx + hw, b.bz - hh], [b.bx - hw, b.bz + hh], [b.bx + hw, b.bz + hh]]) {
    xs.push(t.x + t.sx * lx * -Math.cos(a) + t.sz * lz * Math.sin(a));
    zs.push(t.z + t.sx * lx * Math.sin(a) + t.sz * lz * Math.cos(a));
  }
  return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
};
const meets = (a, b) => a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3];
const ICON = 0.6; // (a tracker's half size: tests/test_table_claims.js marks fit)
if (six) {
  const players = SEATS.map((color, i) => ({ color, slot: `player-${i}`, name: color, ai: false, life: 40, status: "playing", pool: { W: 2, U: 1, B: 1, R: 1, G: 1, C: 3 },
    allMarks: ["TURN RUN BY YELLOW", "RING TEMPTED 4", "SPEED 4 (MAX)", "MONARCH", "INITIATIVE", "POISON 9", "CITY'S BLESSING", "ENERGY 12", "EXPERIENCE 5", "YOU CAN'T LOSE THE GAME"],
    extraTurns: 2, cmdDamage: Object.fromEntries(SEATS.filter((a) => a !== color).map((a) => [a, 1 + i * 6 + SEATS.indexOf(a)])),
    tax: [0, 0], library: 50, handCount: 0, hand: null, battlefield: [], graveyard: [], exile: [], command: [] }));
  const board = JSON.stringify({ t: "table", turn: 2, step: "main1", active: "White", activeTurnNo: 1, priority: "White", gameOver: false, winner: null, players, stack: [], cards: {} });
  const started = JSON.stringify({ t: "started", colors: Object.fromEntries(players.map((p) => [p.slot, p.color])), names: Object.fromEntries(players.map((p) => [p.slot, p.color])), ai: [] });
  const each = 'local out = {} for v, row in pairs(TABLE_PROFILE.cmdDamage) do for a, g in pairs(row) do local o = getObjectFromGUID(g) out[#out + 1] = v .. ":" .. a .. "=" .. (o and (BODY) or "none") end end table.sort(out) return table.concat(out, "|")';
  const vals = (mark) => q(each.replace("BODY", 'tostring(o.getVar("val"))'), mark);
  const where = (mark) => q(each.replace("BODY", 'string.format("%.1f,%.1f,%.1f", o.getPosition().x, o.getPosition().y, o.getPosition().z) .. "#" .. tostring(o.memo) .. "#" .. tostring(#(o.__d.invisibleTo or {})) .. "#" .. tostring(o.getLock())'), mark);
  // every button the renderer drew on the life trackers, with the tracker's place
  const geo = 'local out = {} for _, c in ipairs(TABLE_PROFILE.seats) do local o = getObjectFromGUID(TABLE_PROFILE.life[c]) local p, r, s = o.getPosition(), o.getRotation(), o.getScale() local row = { c = c, x = p.x, z = p.z, ry = r.y, sx = s.x, sz = s.z, b = {} } for _, b in ipairs(o.getButtons() or {}) do local sc = b.scale or {} row.b[#row.b + 1] = { label = b.label, w = b.width or 0, h = b.height or 0, bx = b.position[1] or b.position.x, bz = b.position[3] or b.position.z, scx = sc[1] or sc.x, scz = sc[3] or sc.z } end out[#out + 1] = row end return JSON.encode(out)';
  const spots = 'local out = {} for _, k in ipairs({ "MODE_SPOT", "FRIENDLY_SPOT", "TEAMS_SPOT" }) do local v = _G[k] out[#out + 1] = string.format("%s=%.2f,%.2f,%.2f", k, v.x, v.y, v.z) end local t = nil for _, o in ipairs(getObjects()) do if o.getGMNotes() == "mtgsetup" then t = o end end for _, b in ipairs((t and t.getButtons()) or {}) do if b.click_function == "onMtgSetupMode" or b.click_function == "onMtgSetupFriendly" or b.click_function == "onMtgSetupTeams" then local r = b.rotation or {} out[#out + 1] = b.click_function .. "=" .. b.width .. "x" .. b.height .. "@" .. tostring(r.y or r[2]) end end return table.concat(out, "|")';
  const r = simulate({ save: six, seated: SEATS, host: "White", steps: [
    q('engineChat("mtg engine on", Player.White) return "on"', "on", 150),
    where("at load"), q(spots, "spots"),
    q('engineChat("mtg mode standard", Player.White) return tostring(ENGINE_GAME_MODE)', "set standard", 30), where("standard"),
    q('engineChat("mtg mode commander", Player.White) return tostring(ENGINE_GAME_MODE)', "set commander", 30), where("commander"),
    { msg: { t: "started", json: started } },
    { msg: { t: "table", json: board }, frames: 150 },
    vals("values"), q(geo, "geo"),
    // a player turns Purple's tracker for Green's commander to 9 while fixing; the fix reads it at Done
    q('getObjectFromGUID(TABLE_PROFILE.cmdDamage.Purple.Green).setVar("val", 9) local ops = engineFixRead() local out = {} for _, op in ipairs(ops or {}) do if op.op == "commanderDamage" then out[#out + 1] = op.player .. ":" .. op.from .. "=" .. op.n end end return table.concat(out, ",")', "fix"),
  ] });
  ok("sim: the 6-player table runs without errors", r.errors.length === 0, r.errors.slice(0, 3).join(" | "));
  const rows = (mark) => String(valueOf(r, mark) || "").split("|").filter(Boolean);
  const want = SEATS.flatMap((v, i) => SEATS.filter((a) => a !== v).map((a) => `${v}:${a}=${1 + i * 6 + SEATS.indexOf(a)}`)).sort();
  same("sim: the board's commander damage on all 30 trackers", rows("values"), want);
  same("sim: a manual fix reads a turned tracker (Purple's for Green's commander, 9)", valueOf(r, "fix"), "Purple:Green=9");
  const at = (mark) => Object.fromEntries(rows(mark).map((l) => l.split("=")));
  const load = at("at load"), std = at("standard"), back = at("commander");
  ok("sim: at load every tracker at its made spot, locked, not hidden", Object.keys(load).length === 30 && made.every((t) => load[`${t.victim}:${t.attacker}`] === `${t.x.toFixed(1)},0.9,${t.z.toFixed(1)}#nil#0#true`), JSON.stringify(load).slice(0, 300));
  const memo = /^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+#enginemode:-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,true#[1-9]\d*#true$/;
  ok("sim: Standard puts all 30 under the table, hidden, locked, their spot on them", Object.keys(std).length === 30 && Object.values(std).every((v) => memo.test(v) && Number(v.split(",")[1]) < -10), JSON.stringify(std).slice(0, 300));
  same("sim: Commander brings all 30 back where they were", back, load);

  // the renderer's buttons on the life trackers clear every commander-damage tracker
  let geoRows = [];
  try { geoRows = JSON.parse(String(valueOf(r, "geo"))); } catch (e) { /* checked below */ }
  ok("sim: precondition, six life trackers with the renderer's buttons (marks, badge, chips)", geoRows.length === 6 && geoRows.every((t) => t.b.filter((b) => b.w > 0).length >= 5), String(valueOf(r, "geo")).slice(0, 200));
  const icons = made.map((t) => ({ g: `${t.victim}:${t.attacker}`, box: [t.x - ICON, t.x + ICON, t.z - ICON, t.z + ICON] }));
  for (const t of geoRows) {
    const hit = t.b.filter((b) => b.w > 0 && b.h > 0).flatMap((b) => icons.filter((c) => meets(buttonBox(t, b), c.box)).map((c) => `${String(b.label).replace(/\n/g, " ")} on ${c.g}`));
    ok(`sim: ${t.c}'s life-tracker buttons clear every commander-damage tracker`, hit.length === 0, hit.slice(0, 4).join(" | "));
  }

  // the west-strip buttons
  const sp = String(valueOf(r, "spots") || "").split("|");
  same("sim: the west-strip spots are the profile's", sp.slice(0, 3), ["MODE_SPOT=-49.00,1.10,-2.50", "FRIENDLY_SPOT=-49.00,1.10,7.50", "TEAMS_SPOT=-49.00,1.10,17.50"]);
  const btn = Object.fromEntries(sp.slice(3).map((l) => l.split("=")));
  ok("sim: the three west-strip buttons on the tile, a quarter turned, 1700 x 620", ["onMtgSetupMode", "onMtgSetupFriendly", "onMtgSetupTeams"].every((k) => btn[k] === "1700x620@90"), JSON.stringify(btn));
  // (a quarter-turned button: its width runs along z, its height along x; world size = units x SETUP.size (2.5) / 480)
  const boxes = p6 && Object.entries(p6.spots).map(([k, [x, , z]]) => ({ k, box: [x - (620 * 2.5) / 960, x + (620 * 2.5) / 960, z - (1700 * 2.5) / 960, z + (1700 * 2.5) / 960] }));
  ok("sim: the west-strip buttons lie in the cleared west strip (x -56..-45)", boxes.every((b) => b.box[0] >= -56 && b.box[1] <= -45), JSON.stringify(boxes));
  const green = ["0c1b22", "206ce5", "2fa3e2", "c04462", "8fb941"].map((g) => six.ObjectStates.find((o) => o.GUID === g)).map((o) => ({ g: o.GUID, box: [o.Transform.posX - 1.6, o.Transform.posX + 1.6, o.Transform.posZ - 1.6, o.Transform.posZ + 1.6] }));
  const clash = boxes.flatMap((b) => [...icons, ...green].filter((c) => meets(b.box, c.box)).map((c) => `${b.k}/${c.g}`))
    .concat(boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => meets(a.box, b.box)).map((b) => `${a.k}/${b.k}`)));
  ok("sim: the west-strip buttons clear Green's column, its tracker row and each other", clash.length === 0, clash.join(" "));
}
if (four) {
  ok("4p: TABLE_PROFILE keeps the west-strip spots at -47", four.LuaScript.includes("  spots = { mode = { -47, 1.1, -2.5 }, friendly = { -47, 1.1, 7.5 }, teams = { -47, 1.1, 17.5 } },\n"));
  ok("4p: the renderer reads them from TABLE_PROFILE", four.LuaScript.includes("\nMODE_SPOT = Vector(TABLE_PROFILE.spots.mode[1], TABLE_PROFILE.spots.mode[2], TABLE_PROFILE.spots.mode[3])"));
}

same("the Workshop tables only read, never written", [sha(FOUR), sha(SIX)], before);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
