// M5 step 4, the table effects (tools/engine-renderer.lua, engineFxBoard and its helpers; docs/m5-effects-design.md
// section 9) on the fake TTS: deaths, counters, damage, knock-outs, the jump rule, the caps, the switches and the
// sound hooks. Boards are made up here (two players: Blue seated, White an AI), one fake game per run.
//   node tests/test_table_effects.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why ? `: ${why}` : ""}`); } };
const CARRIER = "23e485"; // White's life counter

// ───────── made-up boards ─────────
const cards = {};
const card = (id, name, ty) => { cards[id] = { n: name, f: "https://example.invalid/" + id + ".jpg", b: "", tl: ty.join(" "), ty }; return id; };
const blueC = Array.from({ length: 8 }, (_, i) => card(`b${i + 1}`, `Bear ${i + 1}`, ["Creature"]));
const whiteC = Array.from({ length: 4 }, (_, i) => card(`w${i + 1}`, `Wolf ${i + 1}`, ["Creature"]));
card("bl1", "Island", ["Land"]);
card("wl1", "Plains", ["Land"]);
card("tok1", "Goblin", ["Creature"]);
// state: { Blue: { bf: [ids], gy: [ids], life, status, more: { id: {...} } }, White: {...}, turn, step }
function board(st) {
  const pl = (color, slot, s) => ({
    color, slot, name: color, ai: color === "White", life: s.life ?? 40, status: s.status || "playing", pool: {}, poison: 0, energy: 0,
    cmdDamage: {}, tax: [0], library: 50, handCount: 0, hand: color === "Blue" ? [] : null,
    battlefield: s.bf.map((id) => ({ s: 1, id, ctl: color, p: "2", t: "2", dmg: 0, ctr: {}, ...(id === "tok1" ? { tok: true } : {}), ...((s.more || {})[id] || {}) })),
    graveyard: (s.gy || []).map((id) => ({ s: 1, id, ctl: color })), exile: [], command: [],
  });
  return JSON.stringify({ t: "table", turn: st.turn ?? 3, step: st.step || "main1", active: "Blue", activeTurnNo: 2, priority: "Blue", gameOver: !!st.gameOver,
    winner: st.winner || null, players: [pl("Blue", "player-0", st.Blue), pl("White", "player-1", st.White)], stack: [], cards,
    ...(st.rewind ? { rewind: st.rewind } : {}), ...(st.jump ? { jump: true } : {}), ...(st.overWhy ? { overWhy: st.overWhy } : {}) });
}
const base = () => ({ Blue: { bf: [...blueC.slice(0, 7), "bl1"], gy: [], more: {} }, White: { bf: [...whiteC, "wl1"], gy: [], more: {} } });
const clone = (x) => JSON.parse(JSON.stringify(x));

// the fake TTS has no music player, no Object UI show/hide and no AssetBundle: stand-ins that record their calls
const PRELUDE = `
MusicPlayer = { player_status = "Stop", loaded = true, clip = { title = "", url = "" } }
MusicPlayer.setCurrentAudioclip = function(t) MusicPlayer.clip = t __sim.fx("MusicPlayer.setCurrentAudioclip", t.url, t.title) end
MusicPlayer.getCurrentAudioclip = function() return MusicPlayer.clip end
MusicPlayer.play = function() __sim.fx("MusicPlayer.play") end
local car = getObjectFromGUID("${CARRIER}")
car.UI.show = function(id) __sim.fx("objUI.show", id) end
car.UI.hide = function(id) __sim.fx("objUI.hide", id) end
car.UI.setCustomAssets = function(t) __sim.fx("objUI.setCustomAssets", #t) end
engineAutoPace.Blue = false
engineChat("mtg start ai 1", Player.Blue)
return "ok"`;
const STARTED = JSON.stringify({ t: "started", colors: { "player-0": "Blue", "player-1": "White" }, names: { "player-0": "Blue", "player-1": "AI 1" }, ai: ["White"] });
const send = (st, mark, frames) => ({ msg: { t: "table", json: board(st) }, mark, ...(frames != null ? { frames } : {}) });
const lua = (code, mark, frames) => ({ lua: code, mark, ...(frames != null ? { frames } : {}) });
const LAST = lua(`return JSON.encode({ fx = engineFxLast and engineFxLast.fx or {}, dropped = engineFxLast and engineFxLast.dropped, jump = engineFxLast and engineFxLast.jump, died = engineFxLast and engineFxLast.died, snd = engineSoundLog or {} })`, "last", 1);
const posOf = (ids) => lua(`local out = {} for _, o in ipairs(getObjects()) do for _, id in ipairs({ "${ids.join('", "')}" }) do if o.getGMNotes() == "engine:" .. id then local p = o.getPosition() out[id] = { x = p.x, z = p.z } end end end return JSON.encode(out)`, "pos", 1);

function run(steps) {
  const r = simulate({ save, steps: [lua(PRELUDE, "prelude"), { msg: { t: "started", json: STARTED } }, ...steps] });
  const step = (mark) => r.steps.find((s) => s.step === mark) || { fx: [] };
  const all = (mark) => r.steps.filter((s) => s.step === mark);
  return { r, step, value: (mark) => JSON.parse(step(mark).value || "{}"), fx: (mark) => step(mark).fx, all };
}
const objUI = (lines) => lines.filter((l) => l.includes('"objUI.'));
const onCarrier = (lines) => objUI(lines).filter((l) => l.includes(`obj:${CARRIER}`));
const activeOn = (lines) => onCarrier(lines).filter((l) => /"objUI.setAttributes" obj:\S+ "eng_fx_[^"_]+" .*active="true"/.test(l));
const near = (a, b) => Math.abs(a - b) < 0.01;

// 1, 2, 7: build once, a death, nothing changed; 4: counters; 5: damage; 11: sounds
{
  const s0 = base();
  const s1 = clone(s0); s1.Blue.bf = s1.Blue.bf.filter((id) => id !== "b1"); s1.Blue.gy = ["b1"];
  const s2 = clone(s1); s2.Blue.more.b2 = { ctr: { P1P1: 1 } }; // a counter on a creature already there
  const s3 = clone(s2); s3.Blue.bf.push("b8"); s3.Blue.more.b8 = { ctr: { P1P1: 2 } }; // one entering with counters
  const s4 = clone(s3); for (const id of ["b3", "b4", "b5", "b6", "b7", "b8"]) s4.Blue.more[id] = { ctr: { P1P1: 3 } }; s4.White.more.w1 = { ctr: { P1P1: 1 } }; // 7 grow at once
  const s5 = clone(s4); s5.White.more.w2 = { dmg: 3 }; // damage to a creature
  const s6 = clone(s5); s6.White.life = 33; // damage to a player
  const s7 = clone(s6); s7.White.more.w2 = { dmg: 0 }; // cleanup: damage gone
  const s8 = clone(s7); s8.White.more.w3 = { ctr: { M1M1: 1 } }; // a -1/-1 counter
  const t = run([
    send(s0, "first board"), lua(`return getObjectFromGUID("${CARRIER}").UI.getXml()`, "xml", 1), send(s0, "same board again"), posOf(["b1"]),
    send(s1, "death", 60), LAST,
    lua(`engineSounds.death = "https://example.invalid/poof.mp3" return "set"`, "pick"),
    send(s2, "counter"), LAST,
    send(s3, "entered with counters"), LAST,
    send(s4, "seven counters", 40), LAST,
    send(s5, "creature damage", 40), LAST,
    send(s6, "player damage"), LAST,
    send(s7, "damage cleared"), LAST,
    send(s8, "minus counter", 60), LAST,
    lua(`engineRender(nil) return "x"`, "noop"),
  ]);
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  ok("the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const xmls = (m) => onCarrier(t.fx(m)).filter((l) => l.includes('"objUI.setXml"'));
  ok("build: the first board puts the pool on White's life counter once", xmls("first board").length === 1, JSON.stringify(objUI(t.fx("first board"))));
  const xml = t.step("xml").value || "";
  ok("build: the pool's XML has the 6 slots, the knock-out slot and the dot stand-in", [1, 2, 3, 4, 5, 6, "ko"].every((k) => xml.includes(`id="eng_fx_${k}"`))
    && !xml.includes('id="eng_fx_7"') && xml.includes("●") && !xml.includes("<Image") && xml.includes('id="eng_fx_pool_dots"'), xml.slice(0, 300));
  ok("nothing changed: the same board again makes no Object UI call and no highlight", objUI(t.fx("same board again")).length === 0
    && !t.fx("same board again").some((l) => l.includes('"highlightOn"')), JSON.stringify(t.fx("same board again").slice(0, 5)));
  const pos = t.value("pos").b1 || {};
  const d = vals[0];
  const deaths = (d.fx || []).filter((e) => e.kind === "death");
  ok("death: one death effect", deaths.length === 1, JSON.stringify(d));
  ok("death: at the card's spot on the board before", deaths[0] && near(deaths[0].x, pos.x) && near(deaths[0].z, pos.z), JSON.stringify({ deaths, pos }));
  ok("death: the graveyard flash as before (died.Blue = 1)", d.died && d.died.Blue === 1, JSON.stringify(d.died));
  const deathFx = t.fx("death");
  ok("death: the slot goes on, then off by 0.9 s", activeOn(deathFx).length === 1 && onCarrier(deathFx).some((l) => /"objUI.setAttribute" obj:\S+ "eng_fx_1" "active" "false"/.test(l)), JSON.stringify(onCarrier(deathFx)));
  ok("death: white flash, then purple-black smoke", onCarrier(deathFx).some((l) => l.includes('"eng_fx_1_img"') && l.includes("#FFFFFFE6")) && onCarrier(deathFx).some((l) => l.includes('"eng_fx_1_img"') && l.includes("#3D1A5CDD")), JSON.stringify(onCarrier(deathFx)));
  ok("death: no sound while nothing is picked", (d.snd || []).length === 0 && !deathFx.some((l) => l.includes("MusicPlayer")), JSON.stringify(d.snd));
  const c1 = vals[1];
  ok("counter: one ring on the creature that got it", (c1.fx || []).length === 1 && c1.fx[0].kind === "counter", JSON.stringify(c1));
  ok("counter: pale blue", onCarrier(t.fx("counter")).some((l) => l.includes("#A8D8FFE6")), JSON.stringify(onCarrier(t.fx("counter"))));
  ok("counter: no sound for a counter (none picked), the death pick is not played for it", !(c1.snd || []).some((x) => x.startsWith("counter")), JSON.stringify(c1.snd));
  ok("counter: a creature entering with counters gets none", (vals[2].fx || []).length === 0, JSON.stringify(vals[2]));
  ok("counter: 7 at once give 4 rings", (vals[3].fx || []).filter((e) => e.kind === "counter").length === 4, JSON.stringify(vals[3]));
  const cd = vals[4];
  ok("creature damage: one burst with \"−3\"", (cd.fx || []).length === 1 && cd.fx[0].kind === "damage" && cd.fx[0].n === 3
    && onCarrier(t.fx("creature damage")).some((l) => l.includes("−3")), JSON.stringify(cd));
  const pd = vals[5];
  ok("player damage: one burst for White, n = 7", (pd.fx || []).length === 1 && pd.fx[0].kind === "player" && pd.fx[0].seat === "White" && pd.fx[0].n === 7, JSON.stringify(pd));
  ok("player damage: White's life counter flashes red", t.fx("player damage").some((l) => l.includes('"highlightOn" obj:448880') === false && l.includes('"highlightOn" obj:23e485')), JSON.stringify(t.fx("player damage").filter((l) => l.includes("highlight"))));
  ok("damage back to 0 at cleanup: nothing", (vals[6].fx || []).length === 0 && objUI(t.fx("damage cleared")).length === 0, JSON.stringify(vals[6]));
  ok("a -1/-1 counter: violet-grey ring", (vals[7].fx || []).length === 1 && onCarrier(t.fx("minus counter")).some((l) => l.includes("#9A7ACCE6")), JSON.stringify(vals[7]));
  ok("the dots stand in while no pictures are set", t.fx("first board").some((l) => l.includes('"objUI.setXml"')) && !t.fx("first board").some((l) => l.includes("setCustomAssets")));
}

// sounds (11): a link plays through the music player; the players' own music is never cut; a name plays the bundle
{
  const s0 = base();
  const kill = (s, id, color) => { const x = clone(s); x[color].bf = x[color].bf.filter((c) => c !== id); x[color].gy.push(id); return x; };
  const s1 = kill(s0, "b1", "Blue"), s2 = kill(s1, "b2", "Blue"), s3 = kill(s2, "b3", "Blue"), s4 = kill(s3, "b4", "Blue");
  const t = run([
    lua(`engineSounds.death = "https://example.invalid/poof.mp3" return "set"`, "pick"),
    send(s0, "first board"), send(s1, "death with a link", 30), LAST,
    lua(`MusicPlayer.player_status = "Play" MusicPlayer.clip = { title = "Song", url = "x" } return "busy"`, "music busy"),
    send(s2, "death while music plays", 30), LAST,
    lua(`MusicPlayer.player_status = "Stop"
      local o = __sim.makeObj({ Name = "Custom_Assetbundle", GMNotes = "engine:sounds" })
      rawset(o, "AssetBundle", { getTriggerEffects = function() return { { index = 0, name = "poof" }, { index = 1, name = "hit" } } end,
        playTriggerEffect = function(i) __sim.fx("AssetBundle.playTriggerEffect", i) end })
      engineSounds.death = "hit" return "bundle"`, "bundle"),
    send(s3, "death with a bundle name", 30), LAST,
    lua(`engineSounds.death = nil return "nil"`, "unset"),
    send(s4, "death with no pick", 30), LAST,
  ]);
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  ok("sounds: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const fx1 = t.fx("death with a link");
  ok("sound: a link sets the music player's clip and plays it", fx1.some((l) => l.includes('"MusicPlayer.setCurrentAudioclip" "https://example.invalid/poof.mp3" "MTG effect: death"')) && fx1.some((l) => l.includes('"MusicPlayer.play"')), JSON.stringify(fx1.filter((l) => l.includes("Music"))));
  ok("sound: the log says death through the music player", JSON.stringify(vals[0].snd) === JSON.stringify(["death music"]), JSON.stringify(vals[0].snd));
  ok("sound: never over the players' own music", !t.fx("death while music plays").some((l) => l.includes("MusicPlayer")) && vals[1].snd.length === 1, JSON.stringify(vals[1].snd));
  ok("sound: a name plays the sound object's trigger effect with that index", t.fx("death with a bundle name").some((l) => l.includes('"AssetBundle.playTriggerEffect" 1')), JSON.stringify(t.fx("death with a bundle name").filter((l) => l.includes("Asset"))));
  ok("sound: nil plays nothing", vals[3].snd.length === vals[2].snd.length && !t.fx("death with no pick").some((l) => l.includes("MusicPlayer") || l.includes("AssetBundle")), JSON.stringify(vals[3].snd));
}

// 3: a board wipe; 9: caps; 6: knock-outs (lost)
{
  const s0 = base();
  const wipe = clone(s0); wipe.Blue.bf = ["b6", "b7", "bl1"]; wipe.Blue.gy = ["b1", "b2", "b3", "b4", "b5"];
  // 10 events in one board: White out, 3 White deaths, Blue's life down, 4 creatures damaged, 1 counter
  const ten = clone(wipe);
  ten.White.status = "lost"; ten.Blue.life = 30; ten.White.bf = ["wl1"]; ten.White.gy = ["w1", "w2", "w3"];
  ten.Blue.more = { b6: { dmg: 1 }, b7: { dmg: 2, ctr: { P1P1: 1 } } };
  ten.Blue.bf = ["b6", "b7", "b8", "tok1", "bl1"];
  const prevTen = clone(wipe); prevTen.Blue.bf = ["b6", "b7", "b8", "tok1", "bl1"]; prevTen.Blue.more = {};
  ten.Blue.more.b8 = { dmg: 3 }; ten.Blue.more.tok1 = { dmg: 1 }; // (1 + 3 + 1 + 4 + 1 = 10)
  const t = run([
    lua(`engineSounds.death = "https://example.invalid/poof.mp3" engineSounds.knockout = "https://example.invalid/boom.mp3" return "set"`, "pick"),
    send(s0, "first board"), send(wipe, "wipe", 70), LAST,
    send(prevTen, "before ten", 70), send(ten, "ten events", 5), LAST,
    lua(`return "x"`, "later", 120), LAST,
  ]);
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  ok("caps: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const w = vals[0];
  ok("wipe: one effect with n = 5", (w.fx || []).length === 1 && w.fx[0].kind === "death" && w.fx[0].n === 5, JSON.stringify(w));
  ok("wipe: \"×5\" in the slot's text", onCarrier(t.fx("wipe")).some((l) => l.includes("×5")), JSON.stringify(onCarrier(t.fx("wipe"))));
  ok("wipe: one death sound", JSON.stringify(w.snd) === JSON.stringify(["death music"]), JSON.stringify(w.snd));
  const ten2 = vals[1];
  const kinds = (ten2.fx || []).map((e) => e.kind);
  ok("caps: 10 events give 6 effects and 4 dropped", kinds.length === 6 && ten2.dropped === 4, JSON.stringify(ten2));
  ok("caps: in priority order (knock-out, deaths, damage to players, then creatures)", JSON.stringify(kinds) === JSON.stringify(["knockout", "death", "death", "death", "player", "damage"]), JSON.stringify(kinds));
  ok("deaths: each one 80 ms after the one before", JSON.stringify(ten2.fx.filter((e) => e.kind === "death").map((e) => Math.round(e.at * 100))) === "[0,8,16]", JSON.stringify(ten2.fx));
  ok("knock-out: it gets its own slot", ten2.fx[0] && ten2.fx[0].slot === "ko", JSON.stringify(ten2.fx[0]));
  ok("knock-out: the counter glows at once", t.fx("ten events").some((l) => l.includes('"highlightOn" obj:23e485')), JSON.stringify(t.fx("ten events").filter((l) => l.includes("highlight"))));
  ok("knock-out: the ko slot is not on yet at the board", !activeOn(t.fx("ten events")).some((l) => l.includes('"eng_fx_ko"')));
  ok("knock-out: the ko slot comes on 0.6 s later", activeOn(t.fx("last").concat(t.fx("later"))).some((l) => l.includes('"eng_fx_ko"')) || activeOn(t.all("later").flatMap((s) => s.fx)).some((l) => l.includes('"eng_fx_ko"')), JSON.stringify(onCarrier(t.fx("later")).slice(0, 4)));
  ok("knock-out: the IS OUT banner for Blue", t.fx("ten events").some((l) => l.includes('"UI.setValue" "eng_result_Blue" "WHITE IS OUT"')), JSON.stringify(t.fx("ten events").filter((l) => l.includes("eng_result"))));
  ok("one sound per board: the knock-out's, 0.6 s in (not the deaths')", JSON.stringify(vals[2].snd) === JSON.stringify(["death music", "knockout music"]), JSON.stringify(vals[2].snd));
}
// a second burst while all 6 slots are busy is dropped, no slot reused early
{
  const s0 = base();
  const many = clone(s0); many.White.more = { w1: { dmg: 1 }, w2: { dmg: 2 }, w3: { dmg: 3 }, w4: { dmg: 4 } }; many.Blue.more = { b2: { dmg: 1 }, b3: { dmg: 1 } };
  many.Blue.life = 39; many.White.life = 39;
  const more = clone(many); more.Blue.life = 35;
  const t = run([send(s0, "first board"), send(many, "six", 2), LAST, send(more, "seventh", 2), LAST]);
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  ok("busy: 6 started", (vals[0].fx || []).length === 6, JSON.stringify(vals[0]));
  ok("busy: the next one while all 6 are busy is dropped", (vals[1].fx || []).length === 0 && vals[1].dropped === 1, JSON.stringify(vals[1]));
}

// 6: a concession is a knock-out too
{
  const s0 = base();
  const conc = clone(s0); conc.Blue.status = "conceded";
  const t = run([send(s0, "first board"), send(conc, "Blue concedes", 60), LAST]);
  const v = t.value("last");
  ok("concession: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  ok("concession: a knock-out effect for Blue", (v.fx || []).some((e) => e.kind === "knockout" && e.seat === "Blue"), JSON.stringify(v));
  ok("concession: DEFEAT for Blue (the banner the old check missed)", t.fx("Blue concedes").some((l) => l.includes('"UI.setValue" "eng_result_Blue" "DEFEAT"')), JSON.stringify(t.fx("Blue concedes").filter((l) => l.includes("eng_result"))));
  ok("concession: everyone is told", t.fx("Blue concedes").some((l) => l.includes('"broadcastToAll" "[MTG] Blue has conceded."')));
  ok("concession: Blue's life counter goes dark", t.fx("Blue concedes").some((l) => l.includes('"setColorTint" obj:395037')));
}

// Kykar hand test #16 (verify 2026-11-07): the GAME OVER broadcast says how it ended, as the bridge's overWhy tells it
{
  const s0 = base();
  const over = clone(s0); over.gameOver = true; over.winner = "Blue"; over.White.status = "lost"; over.overWhy = "AI 1 drew from an empty library. Blue wins";
  const t = run([send(s0, "first board"), send(over, "over", 30)]);
  const said = t.fx("over").filter((l) => l.includes('"broadcastToAll"') && l.includes("GAME OVER"));
  ok("kykar #16: the GAME OVER broadcast says why", said.length === 1 && said[0].includes("(AI 1 drew from an empty library. Blue wins)"), JSON.stringify(said));
}

// 5: combat: the bursts land with the swing
{
  const s0 = base();
  const atk = clone(s0); atk.step = "combatDeclareBlockers"; atk.Blue.more = { b1: { atk: true, atkT: "White" }, b2: { atk: true, atkT: "White" } };
  const dmg = clone(atk); dmg.step = "combatDamage"; dmg.White.life = 36;
  const t = run([send(s0, "first board"), send(atk, "attackers"), send(dmg, "combat damage", 1), LAST, lua(`return "x"`, "after", 30)]);
  const v = t.value("last");
  ok("combat: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const p = (v.fx || []).find((e) => e.kind === "player");
  ok("combat: the player burst starts at the first swing's hit (about 0.15 s), not at once", p && p.at > 0.1 && p.at < 0.2, JSON.stringify(v));
  ok("combat: its slot is not on in the board's frame", !activeOn(t.fx("combat damage")).length && activeOn(t.fx("after")).length >= 1, JSON.stringify(onCarrier(t.fx("after")).slice(0, 3)));
}

// 8: jumps are not plays
{
  const s0 = base(); s0.Blue.bf.push("tok1"); s0.turn = 5;
  const lost = clone(s0); lost.Blue.bf = ["b3", "b4", "b5", "b6", "b7", "bl1"]; lost.Blue.gy = ["b1", "b2"]; lost.jump = true;
  const back = clone(s0); back.turn = 4; back.Blue.bf = ["b5", "b6", "b7", "bl1"]; back.Blue.gy = ["b1", "b2", "b3", "b4"];
  const pts = (id) => ({ points: [{ id, label: "x" }], vote: null });
  const p1 = clone(s0); p1.rewind = pts(50);
  const p2 = clone(p1); p2.rewind = pts(40); p2.Blue.bf = p2.Blue.bf.filter((x) => x !== "b7"); p2.Blue.gy = ["b7"];
  const v1 = clone(s0); v1.rewind = { points: [], vote: { id: 9, status: "approved" } }; v1.Blue.life = 20;
  // (after a resend's "started": a board that would be a plain play otherwise, same turn and the same vote)
  const afterStart = clone(v1); afterStart.Blue.bf = afterStart.Blue.bf.filter((x) => x !== "b7"); afterStart.Blue.gy = ["b7"]; afterStart.Blue.life = 15;
  const t = run([
    lua(`engineSounds.death = "https://example.invalid/poof.mp3" return "set"`, "pick"),
    send(s0, "first board"), send(lost, "jump board", 60), LAST,
    send(s0, "back again"), send(back, "turn went down", 60), LAST,
    send(p1, "points 50"), send(p2, "points 40", 60), LAST,
    send(s0, "plain"), send(v1, "vote approved", 60), LAST,
    { msg: { t: "started", json: STARTED }, mark: "started again" }, send(afterStart, "after started", 60), LAST,
  ]);
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  ok("jump: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const quiet = (mark, v) => (v.fx || []).length === 0 && v.jump === true && objUI(t.fx(mark)).length === 0 && !t.fx(mark).some((l) => l.includes("MusicPlayer")) && !t.fx(mark).some((l) => l.includes('"highlightOn"'));
  ok("jump: jump = true: no effect, no graveyard flash, no sound", quiet("jump board", vals[0]) && JSON.stringify(vals[0].died) === "[]", JSON.stringify(vals[0]));
  ok("jump: the turn going down is a jump too (no bridge flag)", quiet("turn went down", vals[1]), JSON.stringify(vals[1]));
  ok("jump: the newest restore point going down is a jump", quiet("points 40", vals[2]), JSON.stringify(vals[2]));
  ok("jump: a newly approved rewind vote is a jump", quiet("vote approved", vals[3]), JSON.stringify(vals[3]));
  ok("jump: the first board after \"started\" (a resend) is a jump", quiet("after started", vals[4]), JSON.stringify(vals[4]));
}

// 10: switches
{
  const s0 = base();
  const k1 = clone(s0); k1.Blue.bf = k1.Blue.bf.filter((x) => x !== "b1"); k1.Blue.gy = ["b1"];
  const k2 = clone(k1); k2.Blue.bf = k2.Blue.bf.filter((x) => x !== "b2"); k2.Blue.gy.push("b2"); k2.White.life = 30;
  const k3 = clone(k2); k3.Blue.bf = k3.Blue.bf.filter((x) => x !== "b3"); k3.Blue.gy.push("b3");
  const k4 = clone(k3); k4.Blue.bf = k4.Blue.bf.filter((x) => x !== "b4"); k4.Blue.gy.push("b4");
  const t = run([
    lua(`__sim.seated.White = true engineSounds.death = "https://example.invalid/poof.mp3" return "set"`, "pick"),
    send(s0, "first board"),
    lua(`engineChat("mtg effects off", Player.Blue) return "off"`, "blue off"), send(k1, "blue has effects off", 60),
    lua(`engineChat("mtg effects on", Player.Blue) engineChat("mtg animations off", Player.Blue) return "anim"`, "anim off"), send(k2, "animations off", 60), LAST,
    lua(`engineChat("mtg animations on", Player.Blue) engineChat("mtg sounds off", Player.Blue) return "snd"`, "sounds off"), send(k3, "sounds off", 60), LAST,
    lua(`engineChat("mtg sounds on", Player.Blue) engineChat("mtg sounds off", Player.White) return tostring(engineSoundsMuted)`, "white asks"), send(k4, "white asked", 60), LAST,
    lua(`engineChat("mtg sounds test death", Player.Blue) return "t"`, "test sound", 10),
  ]);
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  ok("switches: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const vis = activeOn(t.fx("blue has effects off"))[0] || "";
  const m = vis.match(/visibility="([^"]*)"/);
  ok("effects off: the slot's visibility leaves out Blue, keeps White", m && !m[1].split("|").includes("Blue") && m[1].split("|").includes("White"), vis);
  ok("animations off: no slot call and no highlight from step 4", objUI(t.fx("animations off")).length === 0 && !t.fx("animations off").some((l) => l.includes('"highlightOn" obj:23e485')), JSON.stringify(objUI(t.fx("animations off"))));
  ok("animations off: the sound still plays", vals[0].snd.length === 2, JSON.stringify(vals[0].snd)); // (one from the effects-off board, one here)
  ok("sounds off (host): no sound", vals[1].snd.length === 2 && !t.fx("sounds off").some((l) => l.includes("MusicPlayer.setCurrentAudioclip")), JSON.stringify(vals[1].snd));
  ok("sounds off from White: no change, a reply", t.value("white asks") === false || t.step("white asks").value === "false", t.step("white asks").value);
  ok("sounds off from White: told the sounds are shared", t.fx("white asks").some((l) => l.includes('"Player.broadcast" "White"') && l.includes("Table sounds are shared")), JSON.stringify(t.fx("white asks").filter((l) => l.includes("broadcast"))));
  ok("sounds off from White: the next death still has its sound", vals[2].snd.length === 3, JSON.stringify(vals[2].snd));
  ok("mtg sounds test death plays it now", t.fx("test sound").some((l) => l.includes('"MusicPlayer.setCurrentAudioclip"')), JSON.stringify(t.fx("test sound").filter((l) => l.includes("Music") || l.includes("broadcast"))));
}

// a redraw of the same board object does nothing (engineBoardNew), and a new game builds no second pool
{
  const s0 = base();
  const t = run([
    send(s0, "first board"),
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 30, mark: "clear" },
    { msg: { t: "started", json: STARTED }, mark: "started 2" },
    send(s0, "second game's first board"),
  ]);
  ok("second game: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  ok("second game: the pool is already there, no second setXml", !t.fx("second game's first board").some((l) => l.includes('"objUI.setXml"')), JSON.stringify(objUI(t.fx("second game's first board"))));
}
// placement and the dot's size, as measured on the real table 2026-11-06: an effect's panel sits at the carrier-local
// spot (Object UI x = +local x; with -1 an effect at Red's seat drew on White's mat), and the "●" font fits its box
// (TTS draws no text taller than its box: at 1.3x the dot never showed)
{
  const t = run([lua('local r = engineFxTest("burst", "Red") local o = getObjectFromGUID("23e485") local l = o.positionToLocal(enginePlayerSpot("Red")) '
    + 'return JSON.encode({ r = r, x = math.floor(l.x * 100 + 0.5), z = math.floor(l.z * 100 + 0.5) })', "test burst")]);
  const v = t.value("test burst");
  const pos = (onCarrier(t.fx("test burst")).find((l) => /"eng_fx_1" \{.*position=/.test(l)) || "").match(/position="(-?\d+) (-?\d+) /);
  ok("placement: the effect's panel is at the spot's carrier-local x and z", v.r === "shown" && pos && Math.abs(Number(pos[1]) - v.x) <= 1 && Math.abs(Number(pos[2]) - v.z) <= 1
    && v.x !== 0, JSON.stringify({ v, pos: pos && pos.slice(1) }));
  const dot = onCarrier(t.fx("test burst")).find((l) => l.includes('"eng_fx_1_img"') && l.includes("fontSize"));
  const m = dot && dot.match(/fontSize=(\d+).*height=(\d+)|height=(\d+).*fontSize=(\d+)/);
  const [font, height] = m ? (m[1] ? [Number(m[1]), Number(m[2])] : [Number(m[4]), Number(m[3])]) : [NaN, NaN];
  ok("dot: the stand-in's font fits its box", font > 0 && font <= height, dot);
}

console.log(failed ? `\n${failed} failed, ${passed} passed` : `all ${passed} passed`);
process.exit(failed ? 1 : 0);
