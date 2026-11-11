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
    cmdDamage: {}, tax: [0], library: 50, handCount: s.hc ?? 0, hand: color === "Blue" ? [] : null,
    battlefield: s.bf.map((id) => ({ s: 1, id, ctl: color, p: "2", t: "2", dmg: 0, ctr: {}, ...(id === "tok1" ? { tok: true } : {}), ...((s.more || {})[id] || {}) })),
    graveyard: (s.gy || []).map((id) => ({ s: 1, id, ctl: color })), exile: (s.ex || []).map((id) => ({ s: 1, id, ctl: color })), command: [],
  });
  return JSON.stringify({ t: "table", turn: st.turn ?? 3, step: st.step || "main1", active: "Blue", activeTurnNo: 2, priority: "Blue", gameOver: !!st.gameOver,
    winner: st.winner || null, players: [pl("Blue", "player-0", st.Blue), pl("White", "player-1", st.White)], stack: st.stack || [], cards,
    ...(st.rewind ? { rewind: st.rewind } : {}), ...(st.jump ? { jump: true } : {}), ...(st.overWhy ? { overWhy: st.overWhy } : {}), ...(st.exd ? { exd: st.exd } : {}) });
}
const base = () => ({ Blue: { bf: [...blueC.slice(0, 7), "bl1"], gy: [], more: {} }, White: { bf: [...whiteC, "wl1"], gy: [], more: {} } });
const clone = (x) => JSON.parse(JSON.stringify(x));

// the fake TTS has no music player, no Object UI show/hide and no AssetBundle: stand-ins that record their calls
// (the user's own picks are kept aside in engineSoundsShipped; each scenario sets the picks it needs)
const PRELUDE = `
engineSoundsShipped = engineSounds
engineSounds = {}
MusicPlayer = { player_status = "Stop", loaded = true, clip = { title = "", url = "" }, delay = 0, loadDelay = 0 }
-- (delay > 0: the new clip takes that many frames to arrive, and until then the player still holds the last clip with
-- loaded still true, as a slow download would leave it; loadDelay > 0: once there, it is loaded that many frames later)
MusicPlayer.setCurrentAudioclip = function(t)
  __sim.fx("MusicPlayer.setCurrentAudioclip", t.url, t.title)
  local function arrive()
    MusicPlayer.clip = t
    if MusicPlayer.loadDelay > 0 then
      MusicPlayer.loaded = false
      Wait.frames(function() if MusicPlayer.clip == t then MusicPlayer.loaded = true end end, MusicPlayer.loadDelay)
    else MusicPlayer.loaded = true end
  end
  if MusicPlayer.delay > 0 then Wait.frames(arrive, MusicPlayer.delay) else arrive() end
end
-- (respell: the player hands the link back spelled another way, the title as set)
MusicPlayer.getCurrentAudioclip = function()
  if MusicPlayer.respell and (MusicPlayer.clip.url or "") ~= "" then return { url = MusicPlayer.clip.url .. "?respelled", title = MusicPlayer.clip.title } end
  return MusicPlayer.clip
end
MusicPlayer.play = function() MusicPlayer.player_status = "Play" __sim.fx("MusicPlayer.play", MusicPlayer.clip.url) end
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
  ok("kykar #16: the GAME OVER broadcast says why", said.length === 1 && said[0].includes('"[MTG] GAME OVER - AI 1 drew from an empty library. Blue wins."'), JSON.stringify(said));
  // (once: the why names the winner, so the winner isn't said again before it, review 2026-11-09)
  ok("kykar #16: the broadcast names the winner once", said.length === 1 && said[0].split("Blue wins").length === 2, JSON.stringify(said));
}
// (a bridge that sends no why: the winner, else a draw)
// (engineNameOf's name for Blue in the fake table is its player's, "PlayerBlue")
for (const [winner, want] of [["Blue", "[MTG] GAME OVER - PlayerBlue wins!"], [null, "[MTG] GAME OVER - draw."]]) {
  const s0 = base();
  const over = clone(s0); over.gameOver = true; over.winner = winner; over.White.status = "lost";
  const t = run([send(s0, "first board"), send(over, "over", 30)]);
  const said = t.fx("over").filter((l) => l.includes('"broadcastToAll"') && l.includes("GAME OVER"));
  ok(`kykar #16: with no why, the broadcast says ${winner ? "the winner" : "a draw"}`, said.length === 1 && said[0].includes(`"${want}"`), JSON.stringify(said));
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

// "a wipe's [sound] with the first death": three blockers dying in combat, the wipe sound at the first hit, not at once
{
  const s0 = base();
  const atk = clone(s0); atk.step = "combatDeclareBlockers";
  atk.Blue.more = { b1: { atk: true, atkT: "White" }, b2: { atk: true, atkT: "White" }, b3: { atk: true, atkT: "White" } };
  atk.White.more = { w1: { blkOf: ["b1"] }, w2: { blkOf: ["b2"] }, w3: { blkOf: ["b3"] } };
  const dmg = clone(atk); dmg.step = "combatDamage"; dmg.White.bf = ["w4", "wl1"]; dmg.White.gy = ["w1", "w2", "w3"]; dmg.White.more = {};
  const t = run([lua(`engineSounds.wipe = "https://example.invalid/wipe.mp3" engineSounds.death = "https://example.invalid/death.mp3" return "x"`, "picks"),
    send(s0, "first board"), send(atk, "attackers"), send(dmg, "combat damage", 1), LAST, lua(`return "x"`, "after", 30), LAST]);
  ok("combat wipe: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const [now, later] = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  const first = Math.min(...(now.fx || []).filter((e) => e.kind === "death").map((e) => e.at));
  ok("combat wipe: the first death starts at a hit, not at once", first > 0.1 && first < 0.3, JSON.stringify(now.fx));
  ok("combat wipe: no sound at once", JSON.stringify(now.snd) === "[]", JSON.stringify(now.snd));
  ok("combat wipe: the wipe sound with the first death", JSON.stringify(later.snd) === '["wipe music"]', JSON.stringify(later.snd));
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

// the user's sounds (docs/sounds.md) and the four kinds added 2026-11-11: wipe, exile, instant, lifegain (design section
// 6). One sound per board, the first of knockout > wipe > death > exile > damage > lifegain > instant > counter with a pick.
{
  const doc = require("fs").readFileSync(require("path").join(__dirname, "..", "docs", "sounds.md"), "utf8");
  const docLinks = {};
  for (const m of doc.matchAll(/^\| mtg-\w+\.mp3 \|[^|]*\(`(\w+)`[^|]*\|.*\| (https:\/\/\S+) \|$/gm)) docLinks[m[1]] = m[2];
  const PICKS = `for _, k in ipairs({ "death", "wipe", "damage", "exile", "instant", "lifegain" }) do engineSounds[k] = "https://example.invalid/" .. k .. ".mp3" end return "set"`;
  const SHOCK = (id, src, ctl = "Blue") => ({ id, n: "Shock", tx: "Shock deals 2 damage to any target.", ctl, src, spell: false, ins: true, tg: [] });
  const s0 = base(); s0.Blue.bf.push("tok1"); s0.Blue.hc = 5; s0.White.hc = 5;
  const step = (from, edit) => { const x = clone(from); delete x.exd; delete x.jump; edit(x); return x; };
  const exile = step(s0, (x) => { x.Blue.bf = x.Blue.bf.filter((c) => c !== "b1"); x.Blue.ex = ["b1"]; });
  const tokEx = step(exile, (x) => { x.Blue.bf = x.Blue.bf.filter((c) => c !== "tok1"); x.exd = ["tok1"]; });
  const back = step(tokEx, (x) => { x.Blue.bf.push("tok1"); }); // (a new token under the same id, for the next board)
  const tokGone = step(back, (x) => { x.Blue.bf = x.Blue.bf.filter((c) => c !== "tok1"); });
  const wipe = step(tokGone, (x) => { x.Blue.bf = x.Blue.bf.filter((c) => c !== "b2" && c !== "b3"); x.Blue.gy = ["b2", "b3"]; x.White.bf = x.White.bf.filter((c) => c !== "w1"); x.White.gy = ["w1"]; });
  const two = step(wipe, (x) => { x.Blue.bf = x.Blue.bf.filter((c) => c !== "b4" && c !== "b5"); x.Blue.gy.push("b4", "b5"); });
  const gain = step(two, (x) => { x.White.life = 43; });
  const loss = step(gain, (x) => { x.White.life = 41; });
  const cast = step(loss, (x) => { x.stack = [SHOCK("engine-stack-1", "i1")]; x.Blue.hc = 4; });
  const still = step(cast, (x) => { x.step = "main2"; x.Blue.hc = 3; }); // (its hand shrinks for something else: a Flash creature)
  const copy = step(still, (x) => { x.stack.push(SHOCK("engine-stack-2", "i2")); });
  const again = step(copy, (x) => { x.stack.push(SHOCK("engine-stack-3", "i3", "White")); x.White.hc = 4; });
  const sorcery = step(again, (x) => { x.stack = [{ id: "engine-stack-4", n: "Farseek", tx: "Farseek - search for a land", ctl: "Blue", src: "s1", spell: false, tg: [] }]; x.Blue.hc = 3; });
  const ability = step(sorcery, (x) => { x.stack.push({ id: "engine-stack-5", n: "Fury", tx: "When Fury enters, it deals 4 damage divided as you choose", ctl: "Blue", src: "b6", spell: false, tg: [] }); });
  const mixed = step(ability, (x) => { x.stack = [SHOCK("engine-stack-6", "i4")]; x.Blue.hc = 2; x.White.life = 45; x.White.bf = x.White.bf.filter((c) => c !== "w2"); x.White.ex = ["w2"]; x.Blue.life = 38; });
  const quiet = step(mixed, (x) => { x.stack = [SHOCK("engine-stack-7", "i5")]; x.Blue.hc = 1; x.White.life = 50; x.White.bf = x.White.bf.filter((c) => c !== "w3"); x.White.ex.push("w3"); x.jump = true; });
  const gainCast = step(quiet, (x) => { x.stack = [SHOCK("engine-stack-8", "i6")]; x.Blue.hc = 0; x.White.life = 52; });
  const t = run([
    lua(`return JSON.encode(engineSoundsShipped)`, "shipped"),
    lua(PICKS, "picks"),
    send(s0, "first board"),
    send(exile, "exiled", 30), LAST, send(tokEx, "token exiled", 30), LAST, send(back, "token back", 30), send(tokGone, "token gone", 30), LAST,
    send(wipe, "three die", 30), LAST, send(two, "two die", 30), LAST,
    send(gain, "life up", 30), LAST, lua(`engineSounds.damage = nil return "x"`, "no damage pick"), send(loss, "life down", 30), LAST,
    lua(`engineSounds.damage = "https://example.invalid/damage.mp3" return "x"`, "damage pick again"),
    send(cast, "instant cast", 30), LAST, send(still, "instant still there", 30), LAST, send(copy, "a copy", 30), LAST, send(again, "the same name from a hand", 30), LAST,
    send(sorcery, "a sorcery", 30), LAST, send(ability, "an ability", 30), LAST,
    send(mixed, "exile, damage, lifegain and instant", 30), LAST, send(quiet, "a jump board", 30), LAST,
    lua(`engineSounds.lifegain = nil return "x"`, "no lifegain pick"), send(gainCast, "lifegain without a pick", 30), LAST,
    lua(`engineChat("mtg sounds test exile", Player.Blue) engineChat("mtg sounds test instant", Player.Blue) engineChat("mtg sounds test boom", Player.Blue) return "t"`, "tests", 30), LAST,
  ]);
  ok("new sounds: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const shipped = t.value("shipped");
  ok("the user's sounds: the six links of docs/sounds.md are the shipped picks", Object.keys(docLinks).length === 6
    && Object.entries(docLinks).every(([k, url]) => shipped[k] === url), JSON.stringify({ docLinks, shipped }));
  ok("the user's sounds: counter and knockout stay silent", shipped.counter == null && shipped.knockout == null, JSON.stringify(shipped));
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  // each board's new log lines
  const news = vals.map((v, i) => (v.snd || []).slice(i === 0 ? 0 : (vals[i - 1].snd || []).length));
  const said = (i) => JSON.stringify(news[i]);
  ok("exile: a permanent exiled from the battlefield plays exile once", said(0) === '["exile music"]', said(0));
  ok("exile: sound only, no effect slot, no death", (vals[0].fx || []).length === 0 && JSON.stringify(vals[0].died) === "[]", JSON.stringify(vals[0]));
  ok("exile: a token exiled (the bridge's exd) plays exile, not death", said(1) === '["exile music"]' && JSON.stringify(vals[1].died) === "[]", JSON.stringify([news[1], vals[1].died]));
  ok("exile: a token gone with no exd is still a death", said(2) === '["death music"]', said(2));
  ok("wipe: 3 to graveyards on one board (two seats) plays wipe, once, not death", said(3) === '["wipe music"]', said(3));
  ok("wipe: 2 to the graveyard is a death", said(4) === '["death music"]', said(4));
  ok("lifegain: a player's life going up plays lifegain once", said(5) === '["lifegain music"]', said(5));
  ok("lifegain: not for a life loss (with no damage pick, nothing plays)", said(6) === "[]", said(6));
  ok("instant: an instant on the stack plays instant once", said(7) === '["instant music"]', said(7));
  ok("instant: the same instant still on the stack plays nothing", said(8) === "[]", said(8));
  ok("instant: a copy (same name on the stack, no card from a hand) plays nothing", said(9) === "[]", said(9));
  ok("instant: the same name cast from another hand plays again", said(10) === '["instant music"]', said(10));
  ok("instant: not for a sorcery", said(11) === "[]", said(11));
  ok("instant: not for an ability", said(12) === "[]", said(12));
  ok("order: exile beats damage, lifegain and instant on one board", said(13) === '["exile music"]', said(13));
  ok("jump: a jump board plays none of the new sounds", said(14) === "[]" && vals[14].jump === true, JSON.stringify(vals[14]));
  ok("order: with no lifegain pick, the instant under it plays", said(15) === '["instant music"]', said(15));
  ok("mtg sounds test: the new kinds play", said(16) === '["exile music","instant music"]', said(16));
  ok("mtg sounds test: an unknown kind lists the kinds", t.fx("tests").some((l) => l.includes("The sounds are: knockout, wipe, death, exile, damage, lifegain, instant, counter.")), JSON.stringify(t.fx("tests").filter((l) => l.includes("broadcast"))));
}

// the music player (verifier, 2026-11-11): a sound plays once the player holds its own clip and has loaded it (loaded
// can still be the last clip's), a newer sound replacing it first wins, and a clip of the players' own, paused or
// playing, is never replaced
{
  const s0 = base();
  const s1 = clone(s0); s1.Blue.bf = s1.Blue.bf.filter((c) => c !== "b1"); s1.Blue.gy = ["b1"]; // death
  const s2 = clone(s1); s2.White.life = 45; // lifegain
  const s3 = clone(s2); s3.Blue.bf = s3.Blue.bf.filter((c) => c !== "b2"); s3.Blue.ex = ["b2"]; // exile, 0.2 s later
  const s4 = clone(s3); s4.Blue.bf = s4.Blue.bf.filter((c) => c !== "b3"); s4.Blue.gy.push("b3"); // death
  const s5 = clone(s4); s5.Blue.bf = s5.Blue.bf.filter((c) => c !== "b4"); s5.Blue.gy.push("b4"); // death
  const L = (k) => `https://example.invalid/${k}.mp3`;
  const t = run([
    lua(`engineSounds.death = "${L("death")}" engineSounds.lifegain = "${L("lifegain")}" engineSounds.exile = "${L("exile")}" MusicPlayer.delay = 5 return "slow"`, "slow"),
    send(s0, "first board"), send(s1, "slow clip", 30),
    lua(`MusicPlayer.delay = 30 return "slower"`, "slower"), send(s2, "replaced", 12), send(s3, "newer sound", 60),
    lua(`MusicPlayer.delay = 0 MusicPlayer.player_status = "Pause" MusicPlayer.clip = { title = "Song", url = "https://example.invalid/song.mp3" } return "paused"`, "paused"),
    send(s4, "their track paused", 30),
    lua(`MusicPlayer.player_status = "Stop" return "stopped"`, "stopped"), send(s5, "their track stopped", 30),
  ]);
  ok("music player: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const plays = (marks) => marks.flatMap((m) => t.fx(m)).filter((l) => l.includes('"MusicPlayer.play"'));
  const slow = plays(["slow clip"]);
  ok("music player: a slow clip plays once it has arrived, as itself (not the last clip)", slow.length === 1 && slow[0].includes(`"${L("death")}"`), JSON.stringify(slow));
  const two = plays(["replaced", "newer sound"]);
  ok("music player: two sounds 0.2 s apart: only the newer plays, its own clip", two.length === 1 && two[0].includes(`"${L("exile")}"`), JSON.stringify(two));
  const paused = t.fx("their track paused").filter((l) => l.includes("MusicPlayer."));
  ok("music player: a paused track of theirs is never replaced", paused.length === 0, JSON.stringify(paused));
  const stopped = t.fx("their track stopped");
  ok("music player: their track stopped: the sound plays", stopped.some((l) => l.includes('"MusicPlayer.setCurrentAudioclip"')) && plays(["their track stopped"]).length === 1, JSON.stringify(stopped.filter((l) => l.includes("Music"))));
}

// the bursts (2026-11-11, docs/sounds.md "Bursts", design section 6): n of a kind on one board plays the largest
// <kind>_x<N> at or under n (x2 x3 x4 x6 x8; wipe from x3), capped at x8; 1 plays the plain sound; still one clip per board
{
  const doc = require("fs").readFileSync(require("path").join(__dirname, "..", "docs", "sounds.md"), "utf8");
  const burstDoc = {};
  for (const m of doc.matchAll(/^\| mtg-(\w+)-x(\d+)\.mp3 \| (\w+) \| (\d+) \| (https:\/\/\S+) \|$/gm)) if (m[1] === m[3] && m[2] === m[4]) burstDoc[`${m[1]}_x${m[2]}`] = m[5];
  const COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 50];
  const xs = Array.from({ length: 50 }, (_, i) => card(`x${i + 1}`, `Saproling ${i + 1}`, ["Creature"]));
  // every kind and burst with a made-up link, and an x16 the cap must never reach (FX.BURST_MAX = 8)
  const PICKS = (noWipe) => `for _, k in ipairs({ "death", "wipe", "damage", "exile", "lifegain", "instant" }) do
      engineSounds[k] = "https://example.invalid/" .. k .. ".mp3"
      for _, b in ipairs({ 2, 3, 4, 6, 8, 16 }) do if k ~= "instant" and not (k == "wipe" and b == 2) then engineSounds[k .. "_x" .. b] = "https://example.invalid/" .. k .. "_x" .. b .. ".mp3" end end
    end
    ${noWipe ? "engineSounds.wipe = nil" : ""} return "set"`;
  const bucket = (n, from = 2) => { const top = Math.min(n, 8); const b = [8, 6, 4, 3, 2].find((x) => x <= top && x >= from); return b; };
  const want = (kind, n, from) => { const b = bucket(n, from); return b ? `${kind}_x${b} music` : `${kind} music`; };
  // a kind's run: for each count, a board with n Saprolings on Blue's battlefield, then one where they all went (edit)
  const runKind = (picks, edit, setup) => {
    const steps = [lua(picks, "picks")];
    let cur = base();
    for (const n of COUNTS) {
      const before = clone(cur); before.Blue.bf = [...base().Blue.bf, ...xs.slice(0, n)]; before.Blue.gy = []; before.Blue.ex = []; before.Blue.more = {}; setup?.(before, n); delete before.exd;
      const after = clone(before); edit(after, xs.slice(0, n));
      steps.push(send(before, `before ${n}`, 30), LAST, send(after, `after ${n}`, 30), LAST);
      cur = after;
    }
    const t = run(steps);
    const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
    const news = vals.map((v, i) => (v.snd || []).slice(i === 0 ? 0 : (vals[i - 1].snd || []).length));
    return { t, said: (n) => news[2 * COUNTS.indexOf(n) + 1] || [], before: (n) => news[2 * COUNTS.indexOf(n)] || [] };
  };
  const gone = (to) => (x, ids) => { x.Blue.bf = x.Blue.bf.filter((c) => !ids.includes(c)); x.Blue[to] = [...(x.Blue[to] || []), ...ids]; };
  const deaths = runKind(PICKS(true), gone("gy"));
  ok("bursts (death): the script ran", !deaths.t.r.errors.length, deaths.t.r.errors.slice(0, 2).join(" | "));
  for (const n of COUNTS) ok(`bursts (death, no wipe pick): ${n} to the graveyard plays ${want("death", n)}`, JSON.stringify(deaths.said(n)) === JSON.stringify([want("death", n)]), JSON.stringify(deaths.said(n)));
  ok("bursts: the cap: 50 at once plays x8, never the x16 link", JSON.stringify(deaths.said(50)) === '["death_x8 music"]', JSON.stringify(deaths.said(50)));
  const huge = deaths.t.fx("after 50").filter((l) => l.includes('"MusicPlayer.setCurrentAudioclip"') || l.includes('"MusicPlayer.play"'));
  ok("bursts: 50 at once is one clip, set and played once", huge.length === 2 && huge.every((l) => l.includes("death_x8.mp3")), JSON.stringify(huge));
  ok("bursts: the boards between (cards back from the graveyard) play nothing", COUNTS.every((n) => deaths.before(n).length === 0), JSON.stringify(COUNTS.map((n) => deaths.before(n))));
  const wipes = runKind(PICKS(false), gone("gy"));
  for (const n of COUNTS) {
    const w = n >= 3 ? want("wipe", n, 3) : want("death", n);
    ok(`bursts (wipe): ${n} to the graveyard plays ${w}`, JSON.stringify(wipes.said(n)) === JSON.stringify([w]), JSON.stringify(wipes.said(n)));
  }
  const exiles = runKind(PICKS(false), gone("ex"));
  for (const n of COUNTS) ok(`bursts (exile): ${n} exiled plays ${want("exile", n)}`, JSON.stringify(exiles.said(n)) === JSON.stringify([want("exile", n)]), JSON.stringify(exiles.said(n)));
  // damage: n Saprolings hit (more than the 4 bursts shown), and with White's life down too, n + 1
  const hurt = (x, ids) => { for (const id of ids) x.Blue.more[id] = { dmg: 1 }; };
  const hits = runKind(PICKS(false), hurt);
  for (const n of COUNTS) ok(`bursts (damage): ${n} creatures hit plays ${want("damage", n)}`, JSON.stringify(hits.said(n)) === JSON.stringify([want("damage", n)]), JSON.stringify(hits.said(n)));
  const both = runKind(PICKS(false), (x, ids) => { hurt(x, ids); x.White.life = 39; }, (x) => { x.White.life = 40; });
  for (const n of [1, 2, 3, 5, 7]) ok(`bursts (damage): ${n} creatures and a player hit plays ${want("damage", n + 1)}`, JSON.stringify(both.said(n)) === JSON.stringify([want("damage", n + 1)]), JSON.stringify(both.said(n)));
  // lifegain: the players whose life went up (two seats here), and every bucket through mtg sounds test <kind> N
  const s0 = base(), one = clone(s0), two = clone(one); one.White.life = 42; two.White.life = 43; two.Blue.life = 41;
  const tests = COUNTS.map((n) => `engineChat("mtg sounds test lifegain ${n}", Player.Blue)`).join(" ");
  const g = run([lua(PICKS(false), "picks"), send(s0, "first"), send(one, "one gains", 30), LAST, send(two, "two gain", 30), LAST,
    lua(`${tests} return "t"`, "tests", 30), LAST, lua(`engineChat("mtg sounds test death 5", Player.Blue) return "t"`, "death 5", 30)]);
  const gv = g.all("last").map((s) => JSON.parse(s.value || "{}").snd || []);
  ok("bursts (lifegain): one player gaining plays the plain sound", JSON.stringify(gv[0]) === '["lifegain music"]', JSON.stringify(gv[0]));
  ok("bursts (lifegain): two players gaining on one board plays x2", JSON.stringify(gv[1].slice(gv[0].length)) === '["lifegain_x2 music"]', JSON.stringify(gv[1]));
  const testSaid = gv[2].slice(gv[1].length);
  ok("bursts: mtg sounds test lifegain N plays each count's bucket", JSON.stringify(testSaid) === JSON.stringify(COUNTS.map((n) => want("lifegain", n))), JSON.stringify(testSaid));
  ok("bursts: mtg sounds test says the count", g.fx("death 5").some((l) => l.includes("Playing the death sound for 5 at once.")), JSON.stringify(g.fx("death 5").filter((l) => l.includes("broadcast"))));
  ok("bursts: the clip's title names the burst", g.fx("death 5").some((l) => l.includes('"MusicPlayer.setCurrentAudioclip"') && l.includes('"MTG effect: death_x4"')), JSON.stringify(g.fx("death 5").filter((l) => l.includes("Music"))));
  // the spacing is the kind's: a death_x2 0.2 s after a death plays nothing
  const k0 = base(), k1 = clone(k0), k2 = clone(k1);
  gone("gy")(k1, ["b1"]); gone("gy")(k2, ["b2", "b3"]);
  const sp = run([lua(PICKS(true), "picks"), send(k0, "first"), send(k1, "a death", 12), send(k2, "two more, 0.2 s later", 30), LAST]);
  const spSaid = sp.all("last").map((s) => JSON.parse(s.value || "{}").snd || [])[0];
  ok("bursts: a burst keeps its kind's 0.3 s spacing", JSON.stringify(spSaid) === '["death music"]', JSON.stringify(spSaid));
  // the shipped links: the 24 of docs/sounds.md
  const shipped = JSON.parse(run([lua(`return JSON.encode(engineSoundsShipped)`, "shipped")]).step("shipped").value || "{}");
  const keys = Object.keys(burstDoc);
  ok("bursts: the 24 links of docs/sounds.md are the shipped bursts", keys.length === 24 && keys.every((k) => shipped[k] === burstDoc[k])
    && Object.keys(shipped).filter((k) => k.includes("_x")).length === 24 && !shipped.wipe_x2, JSON.stringify(keys.filter((k) => shipped[k] !== burstDoc[k])));
}

// the COUNTERED pop-up (2026-11-11): an instant or a sorcery countered shows it too. The bridge's `spell` is false for
// any spell with spell text, so it marks those `sp`; before, the pop-up asked for `spell` alone and never showed for them
{
  const BOLT = { id: "engine-stack-30", n: "Lightning Bolt", tx: "Lightning Bolt deals 3 damage to any target.", ctl: "White", src: "c30", spell: false, sp: true, ins: true, tg: [{ k: "p", c: "Blue" }] };
  const RAMP = { id: "engine-stack-32", n: "Farseek", tx: "Search your library for a land card.", ctl: "White", src: "c32", spell: false, sp: true, tg: [] };
  const COUNTER = (id, target) => ({ id, n: "Counterspell", tx: "Counter target spell.", ctl: "Blue", src: id + "c", spell: false, sp: true, ins: true, tg: [{ k: "s", id: target }] });
  const CYCLE = { id: "engine-stack-34", n: "Censor", tx: "Cycling {U}", ctl: "White", src: "c34", spell: false, tg: [] };
  const s0 = base();
  const a1 = clone(s0); a1.stack = [BOLT, COUNTER("engine-stack-31", BOLT.id)];
  const a2 = clone(s0);
  const b1 = clone(s0); b1.stack = [RAMP, COUNTER("engine-stack-33", RAMP.id)];
  const b2 = clone(s0);
  const c1 = clone(s0); c1.stack = [CYCLE, COUNTER("engine-stack-35", CYCLE.id)];
  const c2 = clone(s0);
  const t = run([send(s0, "first"), send(a1, "bolt cast", 30), send(a2, "bolt countered", 30), send(b1, "farseek cast", 30), send(b2, "farseek countered", 30),
    send(c1, "an ability", 30), send(c2, "an ability countered", 30)]);
  ok("countered: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const pop = (m) => t.fx(m).filter((l) => l.includes('"eng_pop_who"') && l.includes("COUNTERED"));
  ok("countered: an instant countered shows COUNTERED: Lightning Bolt", pop("bolt countered").some((l) => l.includes("COUNTERED: Lightning Bolt")), JSON.stringify(t.fx("bolt countered").filter((l) => l.includes("eng_pop"))));
  ok("countered: a sorcery countered shows COUNTERED: Farseek", pop("farseek countered").some((l) => l.includes("COUNTERED: Farseek")), JSON.stringify(t.fx("farseek countered").filter((l) => l.includes("eng_pop"))));
  ok("countered: an ability (no sp, no spell) countered shows none", pop("an ability countered").length === 0, JSON.stringify(pop("an ability countered")));
}

// claims audit (jr-programmer-suite, 2026-11-11): promises of design section 6 that the blocks above don't pin
{
  const s0 = base(); s0.Blue.gy = ["b8"];
  // "a knock-out with no knockout pick plays the damage that did it", at the damage's start (not the knock-out's 0.6 s)
  const ko = clone(s0); ko.White.status = "lost"; ko.White.life = 0;
  // "a flicker that is back on the battlefield by the next board doesn't" play exile, though the engine's exd names it
  const flick = clone(ko); flick.exd = ["b1"];
  // "a card exiled from a hand, a library or a graveyard doesn't"
  const gyEx = clone(ko); gyEx.Blue.gy = []; gyEx.Blue.ex = ["b8"];
  // an empty pick is silent: it doesn't take the board's sound from the kind under it (a death and an exile, death "")
  const both = clone(gyEx); both.Blue.bf = both.Blue.bf.filter((c) => c !== "b2" && c !== "b3"); both.Blue.gy = ["b2"]; both.Blue.ex.push("b3");
  // "any two sounds at least 0.15 s apart": a damage 0.1 s after an exile plays nothing
  const ex2 = clone(both); ex2.Blue.bf = ex2.Blue.bf.filter((c) => c !== "b4"); ex2.Blue.ex.push("b4");
  const hit = clone(ex2); hit.Blue.life = 39;
  // counter, the last kind: a counter put on a permanent plays it once it has a pick
  const ctr = clone(hit); ctr.Blue.more.b5 = { ctr: { P1P1: 1 } };
  const t = run([
    lua(`for _, k in ipairs({ "death", "damage", "exile" }) do engineSounds[k] = "https://example.invalid/" .. k .. ".mp3" end return "set"`, "picks"),
    send(s0, "first board"), send(ko, "knock-out, no pick", 4), LAST, lua(`return "x"`, "later", 60), LAST,
    send(flick, "flicker", 30), LAST, send(gyEx, "graveyard to exile", 30), LAST,
    lua(`engineSounds.death = "" return "x"`, "empty death pick"), send(both, "death and exile", 30), LAST,
    send(ex2, "exile again", 6), LAST, send(hit, "damage 0.1 s later", 30), LAST,
    lua(`engineSounds.counter = "https://example.invalid/counter.mp3" return "x"`, "counter pick"), send(ctr, "a counter", 30), LAST,
  ]);
  ok("claims: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  const news = vals.map((v, i) => (v.snd || []).slice(i === 0 ? 0 : (vals[i - 1].snd || []).length));
  const said = (i) => JSON.stringify(news[i]);
  ok("knock-out with no pick: the damage that did it plays, at once (not 0.6 s in)", said(0) === '["damage music"]', said(0));
  ok("knock-out with no pick: once", said(1) === "[]", said(1));
  ok("exile: a flicker (exd names a card still on the battlefield) plays nothing", said(2) === "[]", said(2));
  ok("exile: a card exiled from a graveyard plays nothing", said(3) === "[]", said(3));
  ok("an empty pick is silent: the exile under the death plays", said(4) === '["exile music"]', said(4));
  ok("spacing: an exile plays (0.5 s after the last)", said(5) === '["exile music"]', said(5));
  ok("spacing: a damage 0.1 s after it plays nothing (any two 0.15 s apart)", said(6) === "[]", said(6));
  ok("counter: a counter put on a permanent plays counter once picked", said(7) === '["counter music"]', said(7));
  // "knock-out 600 ms" in: with a knockout pick, its sound waits for the burst
  const k = run([lua(`engineSounds.knockout = "https://example.invalid/knockout.mp3" engineSounds.damage = "https://example.invalid/damage.mp3" return "x"`, "picks"),
    send(s0, "first board"), send(ko, "knock-out", 4), LAST, lua(`return "x"`, "later", 60), LAST]);
  const kv = k.all("last").map((s) => JSON.parse(s.value || "{}").snd || []);
  ok("knock-out: its sound not at once", JSON.stringify(kv[0]) === "[]", JSON.stringify(kv[0]));
  ok("knock-out: its sound 0.6 s in, once, not the damage's", JSON.stringify(kv[1]) === '["knockout music"]', JSON.stringify(kv[1]));
}

// the music player loading (claims audit 2026-11-11): "plays once the player holds this very clip and loaded is true",
// and "a newer sound set before it plays wins; the older one never plays" while the older clip is there but loading
{
  const L = (k) => `https://example.invalid/${k}.mp3`;
  const s0 = base();
  const s1 = clone(s0); s1.Blue.bf = s1.Blue.bf.filter((c) => c !== "b1"); s1.Blue.gy = ["b1"]; // death
  // (an exile: not the clip the player already holds, which would be there and loaded at once)
  const s3 = clone(s1); s3.Blue.bf = s3.Blue.bf.filter((c) => c !== "b2"); s3.Blue.ex = ["b2"];
  const s4 = clone(s3); s4.White.life = 47; // lifegain, 0.5 s later
  const t = run([
    lua(`engineSounds.death = "${L("death")}" engineSounds.exile = "${L("exile")}" engineSounds.lifegain = "${L("lifegain")}" MusicPlayer.loadDelay = 20 return "x"`, "loading"),
    send(s0, "first board"), send(s1, "still loading", 10), lua(`return "x"`, "loaded", 30),
    lua(`MusicPlayer.delay = 20 MusicPlayer.loadDelay = 30 return "x"`, "slow"), send(s3, "older", 30), send(s4, "newer", 90),
  ]);
  ok("music loading: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const plays = (marks) => marks.flatMap((m) => t.fx(m)).filter((l) => l.includes('"MusicPlayer.play"'));
  ok("music loading: not played while its clip is still loading", plays(["still loading"]).length === 0, JSON.stringify(plays(["still loading"])));
  ok("music loading: played once loaded, as itself", plays(["loaded"]).length === 1 && plays(["loaded"])[0].includes(L("death")), JSON.stringify(plays(["loaded"])));
  const two = plays(["older", "newer"]);
  ok("music loading: an older clip there but loading when a newer sound comes never plays; the newer does", two.length === 1 && two[0].includes(L("lifegain")), JSON.stringify(two));
}

// "the players' own music is never cut ... unless the player is stopped or holds no clip": a player holding no clip
// takes a sound whatever its status, and our own clip, once played (the player then says "Play"), is never theirs
{
  const L = (k) => `https://example.invalid/${k}.mp3`;
  const s0 = base();
  const s1 = clone(s0); s1.Blue.bf = s1.Blue.bf.filter((c) => c !== "b1"); s1.Blue.gy = ["b1"]; // death
  const s2 = clone(s1); s2.Blue.bf = s2.Blue.bf.filter((c) => c !== "b2"); s2.Blue.ex = ["b2"]; // exile, 0.5 s later
  const s3 = clone(s2); s3.White.life = 44; // lifegain
  const t = run([
    lua(`engineSounds.death = "${L("death")}" engineSounds.exile = "${L("exile")}" engineSounds.lifegain = "${L("lifegain")}" MusicPlayer.player_status = "Pause" MusicPlayer.clip = { title = "", url = "" } return "x"`, "empty"),
    send(s0, "first board"), send(s1, "an empty player", 30), send(s2, "after our own clip", 30),
    lua(`MusicPlayer.respell = true return "x"`, "respell"), send(s3, "link spelled another way", 30),
  ]);
  ok("music player (empty): the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const played = (m) => t.fx(m).filter((l) => l.includes('"MusicPlayer.play"'));
  ok("music player: a player holding no clip (paused) takes the sound", played("an empty player").length === 1 && played("an empty player")[0].includes(L("death")), JSON.stringify(t.fx("an empty player").filter((l) => l.includes("Music"))));
  ok("music player: our own clip, played, isn't the players' music", played("after our own clip").length === 1 && played("after our own clip")[0].includes(L("exile")), JSON.stringify(t.fx("after our own clip").filter((l) => l.includes("Music"))));
  ok("music player: a clip handed back with its link spelled another way is still ours, by its title", played("link spelled another way").length === 1 && played("link spelled another way")[0].includes(L("lifegain")), JSON.stringify(t.fx("link spelled another way").filter((l) => l.includes("Music"))));
}

console.log(failed ? `\n${failed} failed, ${passed} passed` : `all ${passed} passed`);
process.exit(failed ? 1 : 0);
