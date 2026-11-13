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
    ...(st.rewind ? { rewind: st.rewind } : {}), ...(st.jump ? { jump: true } : {}), ...(st.overWhy ? { overWhy: st.overWhy } : {}), ...(st.exd ? { exd: st.exd } : {}),
    ...(st.ctrd ? { ctrd: st.ctrd } : {}), ...(st.rsv ? { rsv: st.rsv } : {}), ...(st.lv ? { lv: st.lv } : {}), ...(st.hits ? { hits: st.hits } : {}) });
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
MusicPlayer.repeat_track = false
MusicPlayer.pause = function() MusicPlayer.player_status = "Pause" __sim.fx("MusicPlayer.pause", MusicPlayer.clip.url) end
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
    // (no effect bundle: the shipped fx link's rigs would make AssetBundle calls of their own at each death)
    lua(`engineFxBundle = { fx = nil, sounds = nil } engineSounds.death = "https://example.invalid/poof.mp3" return "set"`, "pick"),
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
// 6). One sound per board, the first kind with a pick (the order, with the 2026-11-12 kinds: the block after the bursts).
{
  const doc = require("fs").readFileSync(require("path").join(__dirname, "..", "docs", "sounds.md"), "utf8");
  const docLinks = {};
  for (const m of doc.matchAll(/^\| mtg-\w+\.mp3 \|[^|]*\(`(\w+)`[^|]*\|.*\| (https:\/\/\S+) \|$/gm)) docLinks[m[1]] = m[2];
  const PICKS = `for _, k in ipairs({ "death", "wipe", "damage", "exile", "instant", "lifegain" }) do engineSounds[k] = "https://example.invalid/" .. k .. ".mp3" end return "set"`;
  const SHOCK = (id, src, ctl = "Blue") => ({ id, n: "Shock", tx: "Shock deals 2 damage to any target.", ctl, src, spell: false, ins: true, tg: [] });
  const s0 = base(); s0.Blue.bf.push("tok1"); s0.Blue.hc = 5; s0.White.hc = 5;
  const step = (from, edit) => { const x = clone(from); delete x.exd; delete x.jump; delete x.rsv; edit(x); return x; };
  const RSV = (id, k = "ins") => ({ id, k }); // (the bridge's rsv: an instant or a sorcery that resolved since the last board)
  const exile = step(s0, (x) => { x.Blue.bf = x.Blue.bf.filter((c) => c !== "b1"); x.Blue.ex = ["b1"]; });
  const tokEx = step(exile, (x) => { x.Blue.bf = x.Blue.bf.filter((c) => c !== "tok1"); x.exd = ["tok1"]; });
  const back = step(tokEx, (x) => { x.Blue.bf.push("tok1"); }); // (a new token under the same id, for the next board)
  const tokGone = step(back, (x) => { x.Blue.bf = x.Blue.bf.filter((c) => c !== "tok1"); });
  const wipe = step(tokGone, (x) => { x.Blue.bf = x.Blue.bf.filter((c) => c !== "b2" && c !== "b3"); x.Blue.gy = ["b2", "b3"]; x.White.bf = x.White.bf.filter((c) => c !== "w1"); x.White.gy = ["w1"]; });
  const two = step(wipe, (x) => { x.Blue.bf = x.Blue.bf.filter((c) => c !== "b4" && c !== "b5"); x.Blue.gy.push("b4", "b5"); });
  const gain = step(two, (x) => { x.White.life = 43; });
  const loss = step(gain, (x) => { x.White.life = 41; });
  // (since 2026-11-12 the instant sound is the resolve's, by the bridge's rsv alone: a cast plays nothing)
  const cast = step(loss, (x) => { x.stack = [SHOCK("engine-stack-1", "i1")]; x.Blue.hc = 4; });
  const still = step(cast, (x) => { x.stack = []; x.rsv = [RSV("i1")]; x.Blue.hc = 3; });
  const copy = step(still, (x) => { x.stack = [SHOCK("engine-stack-2", "i2")]; }); // (a copy on the stack, then gone with no rsv)
  const again = step(copy, (x) => { x.stack = []; x.rsv = [RSV("i3")]; x.White.hc = 4; }); // (another player's, cast and resolved between two boards)
  const sorcery = step(again, (x) => { x.stack = []; x.rsv = [RSV("s1", "sor")]; x.Blue.hc = 3; });
  const ability = step(sorcery, (x) => { x.stack = [{ id: "engine-stack-5", n: "Fury", tx: "When Fury enters, it deals 4 damage divided as you choose", ctl: "Blue", src: "b6", spell: false, tg: [] }]; });
  const mixed = step(ability, (x) => { x.stack = []; x.rsv = [RSV("i4")]; x.Blue.hc = 2; x.White.life = 45; x.White.bf = x.White.bf.filter((c) => c !== "w2"); x.White.ex = ["w2"]; x.Blue.life = 38; });
  const quiet = step(mixed, (x) => { x.rsv = [RSV("i5")]; x.Blue.hc = 1; x.White.life = 50; x.White.bf = x.White.bf.filter((c) => c !== "w3"); x.White.ex.push("w3"); x.jump = true; });
  const gainCast = step(quiet, (x) => { x.rsv = [RSV("i6")]; x.Blue.hc = 0; x.White.life = 52; });
  const t = run([
    lua(`return JSON.encode(engineSoundsShipped)`, "shipped"),
    lua(PICKS, "picks"),
    send(s0, "first board"),
    send(exile, "exiled", 30), LAST, send(tokEx, "token exiled", 30), LAST, send(back, "token back", 30), send(tokGone, "token gone", 30), LAST,
    send(wipe, "three die", 30), LAST, send(two, "two die", 30), LAST,
    send(gain, "life up", 30), LAST, lua(`engineSounds.damage = nil return "x"`, "no damage pick"), send(loss, "life down", 30), LAST,
    lua(`engineSounds.damage = "https://example.invalid/damage.mp3" return "x"`, "damage pick again"),
    send(cast, "instant cast", 30), LAST, send(still, "instant resolved", 30), LAST, send(copy, "a copy", 30), LAST, send(again, "another's resolved", 30), LAST,
    send(sorcery, "a sorcery", 30), LAST, send(ability, "an ability", 30), LAST,
    send(mixed, "exile, damage, lifegain and instant", 30), LAST, send(quiet, "a jump board", 30), LAST,
    lua(`engineSounds.lifegain = nil return "x"`, "no lifegain pick"), send(gainCast, "lifegain without a pick", 30), LAST,
    lua(`engineChat("mtg sounds test exile", Player.Blue) engineChat("mtg sounds test instant", Player.Blue) engineChat("mtg sounds test boom", Player.Blue) return "t"`, "tests", 30), LAST,
  ]);
  ok("new sounds: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const shipped = t.value("shipped");
  ok("the user's sounds: the 14 links of docs/sounds.md are the shipped picks", Object.keys(docLinks).length === 14
    && Object.entries(docLinks).every(([k, url]) => shipped[k] === url), JSON.stringify({ docLinks, shipped }));
  ok("the user's sounds: counter and knockout are the doc's links (uploaded 2026-11-12)", /^https:/.test(docLinks.counter || "") && /^https:/.test(docLinks.knockout || "")
    && shipped.counter === docLinks.counter && shipped.knockout === docLinks.knockout, JSON.stringify([shipped.counter, shipped.knockout]));
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
  ok("instant: an instant cast (on the stack) plays nothing", said(7) === "[]", said(7));
  ok("instant: an instant resolved (the bridge's rsv) plays instant once", said(8) === '["instant music"]', said(8));
  ok("instant: a copy (on the stack, then gone with no rsv) plays nothing", said(9) === "[]", said(9));
  ok("instant: another player's, cast and resolved between two boards, plays instant", said(10) === '["instant music"]', said(10));
  ok("instant: not for a sorcery", said(11) === "[]", said(11));
  ok("instant: not for an ability", said(12) === "[]", said(12));
  ok("order: exile beats damage, lifegain and instant on one board", said(13) === '["exile music"]', said(13));
  ok("jump: a jump board plays none of the new sounds", said(14) === "[]" && vals[14].jump === true, JSON.stringify(vals[14]));
  ok("order: with no lifegain pick, the instant under it plays", said(15) === '["instant music"]', said(15));
  ok("mtg sounds test: the new kinds play", said(16) === '["exile music","instant music"]', said(16));
  ok("mtg sounds test: an unknown kind lists the kinds", t.fx("tests").some((l) => l.includes("The sounds are: knockout, wipe, bighit, death, exile, countered, playerhit, damage, lifegain, treasure, treasurespend, sorcery, instant, counter.")), JSON.stringify(t.fx("tests").filter((l) => l.includes("broadcast"))));
}

// the music player (verifier, 2026-11-11): a sound plays once the player holds its own clip and has loaded it (loaded
// can still be the last clip's), a newer sound replacing it first wins, and a clip of the players' own is never
// replaced while it plays; paused (as TTS loads a save's track, live check 2026-11-11) or stopped, the sound plays
{
  const s0 = base();
  const s1 = clone(s0); s1.Blue.bf = s1.Blue.bf.filter((c) => c !== "b1"); s1.Blue.gy = ["b1"]; // death
  const s2 = clone(s1); s2.White.life = 45; // lifegain
  const s3 = clone(s2); s3.Blue.bf = s3.Blue.bf.filter((c) => c !== "b2"); s3.Blue.ex = ["b2"]; // exile, 0.2 s later
  const s4 = clone(s3); s4.Blue.bf = s4.Blue.bf.filter((c) => c !== "b3"); s4.Blue.gy.push("b3"); // death
  const s5 = clone(s4); s5.Blue.bf = s5.Blue.bf.filter((c) => c !== "b4"); s5.Blue.gy.push("b4"); // death
  const s6 = clone(s5); s6.Blue.bf = s6.Blue.bf.filter((c) => c !== "b5"); s6.Blue.gy.push("b5"); // death
  const L = (k) => `https://example.invalid/${k}.mp3`;
  const t = run([
    lua(`engineSounds.death = "${L("death")}" engineSounds.lifegain = "${L("lifegain")}" engineSounds.exile = "${L("exile")}" MusicPlayer.delay = 5 return "slow"`, "slow"),
    send(s0, "first board"), send(s1, "slow clip", 30),
    lua(`MusicPlayer.delay = 30 return "slower"`, "slower"), send(s2, "replaced", 12), send(s3, "newer sound", 60),
    lua(`MusicPlayer.delay = 0 MusicPlayer.player_status = "Play" MusicPlayer.clip = { title = "Song", url = "https://example.invalid/song.mp3" } return "playing"`, "playing"),
    send(s4, "their track playing", 30),
    lua(`MusicPlayer.player_status = "Pause" return "paused"`, "paused"), send(s5, "their track paused", 30),
    lua(`MusicPlayer.player_status = "Stop" MusicPlayer.clip = { title = "Song", url = "https://example.invalid/song.mp3" } return "stopped"`, "stopped"), send(s6, "their track stopped", 30),
  ]);
  ok("music player: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const plays = (marks) => marks.flatMap((m) => t.fx(m)).filter((l) => l.includes('"MusicPlayer.play"'));
  const slow = plays(["slow clip"]);
  ok("music player: a slow clip plays once it has arrived, as itself (not the last clip)", slow.length === 1 && slow[0].includes(`"${L("death")}"`), JSON.stringify(slow));
  const two = plays(["replaced", "newer sound"]);
  ok("music player: two sounds 0.2 s apart: only the newer plays, its own clip", two.length === 1 && two[0].includes(`"${L("exile")}"`), JSON.stringify(two));
  const playing = t.fx("their track playing").filter((l) => l.includes("MusicPlayer."));
  ok("music player: a playing track of theirs is never replaced", playing.length === 0, JSON.stringify(playing));
  const paused = t.fx("their track paused");
  ok("music player: their track paused (as a save loads it): the sound plays", paused.some((l) => l.includes('"MusicPlayer.setCurrentAudioclip"')) && plays(["their track paused"]).length === 1, JSON.stringify(paused.filter((l) => l.includes("Music"))));
  const stopped = t.fx("their track stopped");
  ok("music player: their track stopped: the sound plays", stopped.some((l) => l.includes('"MusicPlayer.setCurrentAudioclip"')) && plays(["their track stopped"]).length === 1, JSON.stringify(stopped.filter((l) => l.includes("Music"))));
}

// a clip's end (live check 2026-11-11): when a clip ends TTS goes on to the players' next track and plays it, so ours
// plays with repeat on and is paused just before its length (engineSoundLen, else 2 s) runs out; the players' repeat
// setting comes back after; a clip loaded more than 2 s late isn't played, and is paused once TTS starts it by itself
{
  const s0 = base();
  const s1 = clone(s0); s1.Blue.bf = s1.Blue.bf.filter((c) => c !== "b1"); s1.Blue.gy = ["b1"]; // death
  const s2 = clone(s1); s2.Blue.bf = s2.Blue.bf.filter((c) => c !== "b2"); s2.Blue.ex = ["b2"]; // exile
  const s3 = clone(s2); s3.Blue.bf = s3.Blue.bf.filter((c) => c !== "b3"); s3.Blue.gy.push("b3"); // death
  const s4 = clone(s3); s4.White.life = 45; // lifegain
  const L = (k) => `https://example.invalid/${k}.mp3`;
  const t = run([
    lua(`engineSounds.death = "${L("death")}" engineSounds.exile = "${L("exile")}" engineSounds.lifegain = "${L("lifegain")}" engineSoundLen.exile = 3 MusicPlayer.repeat_track = false return "picks"`, "picks"),
    send(s0, "first board"),
    send(s1, "plays", 30), lua(`return tostring(MusicPlayer.repeat_track) .. " " .. MusicPlayer.player_status`, "during", 150),
    lua(`return tostring(MusicPlayer.repeat_track) .. " " .. MusicPlayer.player_status`, "after"),
    send(s2, "longer clip", 220),
    lua(`MusicPlayer.repeat_track = true return "x"`, "repeat set"), send(s3, "repeat kept", 150),
    lua(`return tostring(MusicPlayer.repeat_track)`, "repeat after"),
    lua(`MusicPlayer.delay = 150 return "x"`, "slow"), send(s4, "late", 200),
    lua(`MusicPlayer.player_status = "Play" return tostring(MusicPlayer.repeat_track)`, "tts starts it", 5),
    lua(`return MusicPlayer.player_status .. " " .. tostring(MusicPlayer.repeat_track)`, "late after"),
  ]);
  ok("clip end: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const at = (mark, call) => t.fx(mark).filter((l) => l.includes(`"MusicPlayer.${call}"`)).map((l) => Number(/^f(\d+)/.exec(l)?.[1]));
  const v = (mark) => String(t.step(mark).value);
  const [play1] = at("plays", "play"), [pause1] = at("during", "pause");
  ok("clip end: repeat is on while ours plays", v("during").startsWith("true Play"), v("during"));
  ok("clip end: ours is paused 1.75 s after it starts (a 2 s clip)", play1 > 0 && pause1 - play1 >= 103 && pause1 - play1 <= 107, JSON.stringify([play1, pause1]));
  ok("clip end: then repeat is off again, as the players had it, and the player paused", v("after") === "false Pause", v("after"));
  const [play2] = at("longer clip", "play"), [pause2] = at("longer clip", "pause");
  ok("clip end: a 3 s clip (engineSoundLen) is paused 2.75 s after it starts", play2 > 0 && pause2 - play2 >= 163 && pause2 - play2 <= 167, JSON.stringify([play2, pause2]));
  ok("clip end: the players' repeat on comes back on", v("repeat after") === "true" && at("repeat kept", "pause").length === 1, JSON.stringify([v("repeat after"), at("repeat kept", "pause")]));
  ok("clip end: a clip loaded more than 2 s late isn't played", at("late", "play").length === 0 && at("late", "setCurrentAudioclip").length === 1, JSON.stringify(t.fx("late").filter((l) => l.includes("Music"))));
  ok("clip end: once TTS starts the late clip itself, it is paused and repeat given back", at("tts starts it", "pause").length === 1 && v("late after") === "Pause true", JSON.stringify([at("tts starts it", "pause"), v("late after")]));
}
// (verifier 2026-11-11) a set that throws still gives repeat back; a newer sound mid-play keeps the players' setting and
// is the one paused; a clip still loading after the 30 s wait is paused once TTS starts it
{
  const s0 = base();
  const s1 = clone(s0); s1.Blue.bf = s1.Blue.bf.filter((c) => c !== "b1"); s1.Blue.gy = ["b1"]; // death
  const s2 = clone(s1); s2.White.life = 45; // lifegain, 1 s into the death sound
  const s3 = clone(s2); s3.Blue.bf = s3.Blue.bf.filter((c) => c !== "b2"); s3.Blue.ex = ["b2"]; // exile
  const s4 = clone(s3); s4.Blue.bf = s4.Blue.bf.filter((c) => c !== "b3"); s4.Blue.gy.push("b3"); // death
  const L = (k) => `https://example.invalid/${k}.mp3`;
  const t = run([
    lua(`engineSounds.death = "${L("death")}" engineSounds.exile = "${L("exile")}" engineSounds.lifegain = "${L("lifegain")}" MusicPlayer.repeat_track = false return "picks"`, "picks"),
    send(s0, "first board"),
    send(s1, "older", 60), send(s2, "newer", 200),
    lua(`return tostring(MusicPlayer.repeat_track) .. " " .. MusicPlayer.player_status`, "both done"),
    lua(`MusicPlayer.realSet = MusicPlayer.setCurrentAudioclip MusicPlayer.setCurrentAudioclip = function() error("no player") end return "x"`, "broken"),
    send(s3, "set throws", 30),
    lua(`MusicPlayer.setCurrentAudioclip = MusicPlayer.realSet return tostring(MusicPlayer.repeat_track)`, "after throw"),
    lua(`MusicPlayer.delay = 2000 return "x"`, "very slow"), send(s4, "still loading", 2100),
    lua(`MusicPlayer.player_status = "Play" return tostring(MusicPlayer.repeat_track)`, "starts at last", 5),
    lua(`return MusicPlayer.player_status .. " " .. tostring(MusicPlayer.repeat_track)`, "very late after"),
  ]);
  ok("clip end+: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const calls = (marks, call) => marks.flatMap((m) => t.fx(m)).filter((l) => l.includes(`"MusicPlayer.${call}"`));
  const v = (mark) => String(t.step(mark).value);
  const paused = calls(["older", "newer"], "pause");
  ok("clip end+: a newer sound mid-play: only it is paused, once, on its own clip", paused.length === 1 && paused[0].includes(L("lifegain")), JSON.stringify(paused));
  ok("clip end+: a newer sound mid-play: the players' repeat off comes back", v("both done") === "false Pause", v("both done"));
  ok("clip end+: a set that throws gives repeat back", v("after throw") === "false", v("after throw"));
  ok("clip end+: a clip still loading after 30 s is paused once TTS starts it, repeat given back", calls(["starts at last"], "pause").length === 1 && v("very late after") === "Pause false" && calls(["still loading"], "play").length === 0, JSON.stringify([calls(["starts at last"], "pause"), v("very late after"), calls(["still loading"], "play")]));
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
  // the shipped links: the 34 of docs/sounds.md
  const shipped = JSON.parse(run([lua(`return JSON.encode(engineSoundsShipped)`, "shipped")]).step("shipped").value || "{}");
  const keys = Object.keys(burstDoc);
  ok("bursts: the 44 links of docs/sounds.md are the shipped bursts", keys.length === 44 && keys.every((k) => shipped[k] === burstDoc[k])
    && Object.keys(shipped).filter((k) => k.includes("_x")).length === 44 && !shipped.wipe_x2, JSON.stringify(keys.filter((k) => shipped[k] !== burstDoc[k])));
}

// the kinds added 2026-11-12 (docs/sounds.md, design section 6): countered, sorcery, playerhit (1 to 5 damage to a
// player) and bighit (one hit of more than 5, a player or a creature); damage keeps the creatures' hits of 5 or less and
// stays the fallback of both. Order: knockout > wipe > bighit > death > exile > countered > playerhit > damage >
// lifegain > (treasure > treasurespend, 2026-11-13: the block after this one) > sorcery > instant > counter.
{
  const ORDER = ["knockout", "wipe", "bighit", "death", "exile", "countered", "playerhit", "damage", "lifegain", "treasure", "treasurespend", "sorcery", "instant", "counter"];
  const PICKS = (kinds) => `for _, k in ipairs({ "${kinds.join('", "')}" }) do engineSounds[k] = "https://example.invalid/" .. k .. ".mp3"
      for _, b in ipairs({ 2, 3, 4, 6, 8 }) do engineSounds[k .. "_x" .. b] = "https://example.invalid/" .. k .. "_x" .. b .. ".mp3" end end return "set"`;
  const ALL = ORDER.filter((k) => k !== "knockout");
  const SORC = (id, src, ctl = "Blue") => ({ id, n: "Farseek", tx: "Search your library for a land card.", ctl, src, spell: false, sp: true, sor: true, tg: [] });
  const SHOCK = (id, src, ctl = "Blue") => ({ id, n: "Shock", tx: "Shock deals 2 damage to any target.", ctl, src, spell: false, sp: true, ins: true, tg: [] });
  const s0 = base(); s0.Blue.hc = 5; s0.White.hc = 5;
  const step = (from, edit) => { const x = clone(from); delete x.ctrd; delete x.rsv; edit(x); return x; };
  const RSV = (id, k) => ({ id, k }); // (the bridge's rsv: resolved since the last board)
  const ping = step(s0, (x) => { x.White.life = 37; }); // 3 to a player
  const five = step(ping, (x) => { x.White.life = 32; }); // 5: still a playerhit
  const six = step(five, (x) => { x.White.life = 26; }); // 6: a big hit
  const small = step(six, (x) => { x.White.more.w1 = { dmg: 5 }; }); // 5 to a creature: damage
  const bigC = step(small, (x) => { x.White.more.w2 = { dmg: 6 }; }); // 6 to a creature: a big hit
  const twoP = step(bigC, (x) => { x.White.life = 24; x.Blue.life = 38; }); // two players hit, 2 each: playerhit_x2
  const bigs = step(twoP, (x) => { x.White.more.w3 = { dmg: 7 }; x.White.more.w4 = { dmg: 9 }; x.Blue.life = 30; }); // three hits over 5: bighit_x3
  const bigDeath = step(bigs, (x) => { x.Blue.bf = x.Blue.bf.filter((c) => c !== "b1"); x.Blue.gy = ["b1"]; x.White.life = 10; }); // a death and a big hit
  const deathP = step(bigDeath, (x) => { x.Blue.bf = x.Blue.bf.filter((c) => c !== "b2"); x.Blue.gy.push("b2"); x.White.life = 8; }); // a death and a ping
  // (the sorcery and instant sounds play on the resolve, the bridge's rsv, since 2026-11-12)
  const sorc = step(deathP, (x) => { x.stack = [SORC("engine-stack-40", "s40")]; x.Blue.hc = 4; });
  const still = step(sorc, (x) => { x.stack = [SORC("engine-stack-41", "s41")]; x.rsv = [RSV("s40", "sor")]; }); // (storm's copy left on the stack)
  const copy = step(still, (x) => { x.stack = []; }); // (the copy resolved: the bridge names no copy)
  const inst = step(copy, (x) => { x.rsv = [RSV("i42", "ins")]; x.Blue.hc = 3; });
  const both = step(inst, (x) => { x.rsv = [RSV("s43", "sor"), RSV("i44", "ins")]; x.Blue.hc = 2; x.White.hc = 4; });
  const cast = step(both, (x) => { x.stack = [SHOCK("engine-stack-45", "i45", "White")]; x.White.hc = 3; });
  const ctrd = step(cast, (x) => { x.stack = []; x.ctrd = ["i45"]; });
  const ctrdPing = step(ctrd, (x) => { x.stack = [SORC("engine-stack-46", "s46")]; x.Blue.hc = 1; });
  const ctrd2 = step(ctrdPing, (x) => { x.stack = []; x.ctrd = ["s46"]; x.White.life = 6; }); // a countered sorcery and a ping
  const t = run([
    lua(`return JSON.encode({ kinds = engineSoundKinds, shipped = engineSoundsShipped, len = engineSoundLen })`, "shipped"),
    lua(PICKS(ALL), "picks"),
    send(s0, "first board"),
    send(ping, "ping", 30), LAST, send(five, "five", 30), LAST, send(six, "six", 30), LAST, send(small, "creature 5", 30), LAST, send(bigC, "creature 6", 30), LAST,
    send(twoP, "two players", 30), LAST, send(bigs, "three big", 30), LAST, send(bigDeath, "big and death", 30), LAST, send(deathP, "death and ping", 30), LAST,
    send(sorc, "sorcery", 30), LAST, send(still, "sorcery resolved", 30), LAST, send(copy, "sorcery copy", 30), LAST, send(inst, "instant", 30), LAST,
    send(both, "sorcery and instant", 30), LAST, send(cast, "instant to counter", 30), LAST, send(ctrd, "countered", 30), LAST,
    send(ctrdPing, "sorcery to counter", 30), LAST, send(ctrd2, "countered and ping", 30), LAST,
    lua(`engineChat("mtg sounds test boom", Player.Blue) return "t"`, "tests", 30),
  ]);
  ok("2026-11-12 kinds: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const sh = t.value("shipped");
  ok("2026-11-12 kinds: the order", JSON.stringify(sh.kinds) === JSON.stringify(ORDER), JSON.stringify(sh.kinds));
  // (uploaded 2026-11-12: the doc's links, plain and bursts; only playerhit and bighit have bursts)
  const doc = require("fs").readFileSync(require("path").join(__dirname, "..", "docs", "sounds.md"), "utf8");
  const docAll = {};
  for (const m of doc.matchAll(/^\| mtg-\w+\.mp3 \|[^|]*\(`(\w+)`[^|]*\|.*\| (https:\/\/\S+) \|$/gm)) docAll[m[1]] = m[2];
  for (const m of doc.matchAll(/^\| mtg-(\w+)-x(\d+)\.mp3 \| (\w+) \| (\d+) \| (https:\/\/\S+) \|$/gm)) if (m[1] === m[3] && m[2] === m[4]) docAll[`${m[1]}_x${m[2]}`] = m[5];
  const NEW = ["countered", "sorcery", "playerhit", "bighit", "counter"];
  const newKeys = Object.keys(sh.shipped).filter((x) => NEW.some((k) => x === k || x.startsWith(k + "_x")));
  ok("2026-11-12 kinds: the doc's links are shipped (countered, sorcery, playerhit, bighit, counter, and the playerhit / bighit bursts)",
    newKeys.length === 15 && NEW.every((k) => /^https:/.test(sh.shipped[k] || "")) && newKeys.every((x) => sh.shipped[x] === docAll[x])
    && ["playerhit", "bighit"].every((k) => [2, 3, 4, 6, 8].every((b) => sh.shipped[`${k}_x${b}`] === docAll[`${k}_x${b}`])), JSON.stringify(newKeys.filter((x) => sh.shipped[x] !== docAll[x])));
  // (bighit-x8 is 1.94 s of sound in a 2.2 s file: paused at 1.95 s, after it, not at 1.75 s inside it)
  ok("2026-11-12 kinds: bighit_x8 is 2.2 s long (engineSoundLen)", sh.len.bighit_x8 === 2.2, JSON.stringify(sh.len));
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  const news = vals.map((v, i) => (v.snd || []).slice(i === 0 ? 0 : (vals[i - 1].snd || []).length));
  const said = (i) => JSON.stringify(news[i]);
  ok("playerhit: 3 damage to a player", said(0) === '["playerhit music"]', said(0));
  ok("playerhit: 5 to a player is still a playerhit", said(1) === '["playerhit music"]', said(1));
  ok("bighit: 6 to a player", said(2) === '["bighit music"]', said(2));
  ok("damage: 5 to a creature keeps the damage hit", said(3) === '["damage music"]', said(3));
  ok("bighit: 6 to a creature", said(4) === '["bighit music"]', said(4));
  ok("playerhit: two players hit on one board plays its x2", said(5) === '["playerhit_x2 music"]', said(5));
  ok("bighit: three hits over 5 (two creatures, a player) plays its x3", said(6) === '["bighit_x3 music"]', said(6));
  ok("order: bighit beats death", said(7) === '["bighit music"]', said(7));
  ok("order: death beats playerhit", said(8) === '["death music"]', said(8));
  ok("sorcery: a sorcery cast (on the stack) plays nothing", said(9) === "[]", said(9));
  ok("sorcery: a sorcery resolved plays sorcery once", said(10) === '["sorcery music"]', said(10));
  ok("sorcery: a copy resolved (no rsv) plays nothing", said(11) === "[]", said(11));
  ok("instant: an instant plays instant, not sorcery", said(12) === '["instant music"]', said(12));
  ok("order: sorcery beats instant", said(13) === '["sorcery music"]', said(13));
  ok("countered: an instant countered plays countered", said(15) === '["countered music"]', said(15));
  ok("order: countered beats playerhit", said(17) === '["countered music"]', said(17));
  ok("mtg sounds test: an unknown kind lists the 2026-11-12 kinds", t.fx("tests").some((l) => l.includes(`The sounds are: ${ORDER.join(", ")}.`)), JSON.stringify(t.fx("tests").filter((l) => l.includes("broadcast"))));

  // the fallback: with no playerhit or bighit pick, every hit is damage again (the table before 2026-11-12), and a
  // countered spell with no countered pick plays nothing
  const f = run([lua(PICKS(["damage", "death"]), "picks"), send(s0, "first board"), send(ping, "ping", 30), LAST, send(six, "six", 30), LAST, send(bigC, "creature 6", 30), LAST,
    send(cast, "instant to counter", 30), LAST, send(ctrd, "countered", 30), LAST]);
  const fv = f.all("last").map((s) => JSON.parse(s.value || "{}").snd || []);
  const fn = fv.map((v, i) => JSON.stringify(v.slice(i === 0 ? 0 : fv[i - 1].length)));
  ok("fallback: a ping with no playerhit pick plays damage", fn[0] === '["damage music"]', fn[0]);
  ok("fallback: a big hit to a player with no bighit pick plays damage", fn[1] === '["damage music"]', fn[1]);
  ok("fallback: a big hit to a creature with no bighit pick plays damage (its x2: the 5 and the 6)", fn[2] === '["damage_x2 music"]', fn[2]);
  ok("fallback: a countered spell with no countered pick plays nothing", fn[4] === "[]", fn[4]);

  // timing: the player's hit sound waits for the swing's hit, as damage did (playerhit; damage as its fallback)
  const atk = clone(base()); atk.step = "combatDeclareBlockers"; atk.Blue.more = { b1: { atk: true, atkT: "White" } };
  const dmg = clone(atk); dmg.step = "combatDamage"; dmg.White.life = 38;
  const big = clone(dmg); big.White.life = 34; big.White.more = { w1: { dmg: 1 } }; // (6 to the player, 1 to a creature)
  for (const kinds of [["playerhit", "damage"], ["damage"], ["bighit", "damage"]]) {
    const c = run([lua(PICKS(kinds), "picks"), send(base(), "first board"), send(atk, "attackers"), send(kinds[0] === "bighit" ? big : dmg, "combat damage", 1), LAST, lua(`return "x"`, "after", 30), LAST]);
    const [now, later] = c.all("last").map((s) => JSON.parse(s.value || "{}").snd || []);
    ok(`timing (${kinds[0]}): no sound at once`, JSON.stringify(now) === "[]", JSON.stringify(now));
    ok(`timing (${kinds[0]}): the sound with the hit`, JSON.stringify(later) === `["${kinds[0]} music"]`, JSON.stringify(later));
  }
}

// the Treasure sounds (2026-11-13, docs/sounds.md "Treasure"): Treasure tokens new on the battlefield play treasure, and
// those that left it the way a death does (sacrificed for mana, mostly) play treasurespend in place of death and wipe,
// never counted in them; both with bursts. A Treasure is a token with the Treasure subtype in its type line (a renamed
// one counts, a token merely named Treasure doesn't). Order: lifegain > treasure > treasurespend > sorcery
{
  const tr = (id, name = "Treasure Token", tl = "Artifact — Treasure") => { cards[id] = { n: name, f: "https://example.invalid/" + id + ".jpg", b: "", tl, ty: tl.startsWith("Creature") ? ["Creature"] : ["Artifact"], tok: true }; return id; };
  for (const id of ["tr1", "tr2", "tr3", "tr4", "tr5", "tr6", "tr7"]) tr(id);
  tr("gold1", "Gold Hoard"); // (a Treasure by its type line, under another name)
  tr("fake1", "Treasure Token", "Creature — Goblin"); // (a creature token that is no Treasure, whatever its name)
  const KINDS = ["death", "wipe", "treasure", "treasurespend", "lifegain", "sorcery"];
  const PICKS = `for _, k in ipairs({ "${KINDS.join('", "')}" }) do engineSounds[k] = "https://example.invalid/" .. k .. ".mp3"
      for _, b in ipairs({ 2, 3, 4, 6, 8 }) do if not (k == "wipe" and b == 2) then engineSounds[k .. "_x" .. b] = "https://example.invalid/" .. k .. "_x" .. b .. ".mp3" end end end
    engineFxBundle = { fx = nil, sounds = nil } return "set"`;
  const UNPICK = `for _, k in ipairs({ "treasure", "treasurespend" }) do engineSounds[k] = nil for _, b in ipairs({ 2, 3, 4, 6, 8 }) do engineSounds[k .. "_x" .. b] = nil end end return "x"`;
  const step = (from, edit) => { const x = clone(from); for (const k of ["ctrd", "rsv", "jump", "exd", "lv"]) delete x[k]; edit(x); return x; };
  const add = (who, ...ids) => (x) => { x[who].bf.push(...ids); };
  const drop = (who, ...ids) => (x) => { x[who].bf = x[who].bf.filter((c) => !ids.includes(c)); };
  const s0 = base(); s0.Blue.bf.push("tok1");
  const make1 = step(s0, add("Blue", "tr1"));
  const make3 = step(make1, add("Blue", "tr2", "tr3", "gold1"));
  const spend1 = step(make3, drop("Blue", "tr1"));
  const tokDies = step(spend1, drop("Blue", "tok1"));
  const spend3 = step(tokDies, drop("Blue", "tr2", "tr3", "gold1")); // (3 at once: would be a wipe if they were deaths)
  const make2 = step(spend3, (x) => { add("Blue", "tr4")(x); add("White", "tr5")(x); });
  const mixed = step(make2, (x) => { drop("Blue", "tr4", "b1")(x); x.Blue.gy = ["b1"]; }); // (a creature dies and a Treasure goes)
  const fakeIn = step(mixed, add("White", "fake1"));
  const fakeOut = step(fakeIn, drop("White", "fake1"));
  const gainMake = step(fakeOut, (x) => { add("Blue", "tr6")(x); x.White.life = 45; x.rsv = [{ id: "s70", k: "sor" }]; x.Blue.hc = 2; });
  const sorcMake = step(gainMake, (x) => { add("Blue", "tr7")(x); x.rsv = [{ id: "s71", k: "sor" }]; x.Blue.hc = 1; });
  // (then no links: the shipped table until the upload)
  const quietMake = step(sorcMake, (x) => { x.Blue.bf.push("tr1"); });
  const quietSpend = step(quietMake, (x) => { drop("Blue", "tr1")(x); drop("White", "tr5")(x); });
  const t = run([
    lua(`return JSON.encode({ kinds = engineSoundKinds, shipped = engineSoundsShipped, len = engineSoundLen })`, "shipped"),
    lua(PICKS, "picks"), send(s0, "first board"),
    send(make1, "one made", 30), LAST, send(make3, "three made", 30), LAST, send(spend1, "one spent", 30), LAST,
    send(tokDies, "a token dies", 30), LAST, send(spend3, "three spent", 30), LAST, send(make2, "two made, two seats", 30), LAST,
    send(mixed, "a death and a spend", 30), LAST, send(fakeIn, "a fake enters", 30), LAST, send(fakeOut, "a fake dies", 30), LAST,
    send(gainMake, "lifegain, treasure, sorcery", 30), LAST, send(sorcMake, "treasure and sorcery", 30), LAST,
    lua(UNPICK, "no links"), send(quietMake, "made, no link", 30), LAST, send(quietSpend, "spent, no link", 30), LAST,
  ]);
  ok("treasure: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  const news = vals.map((v, i) => (v.snd || []).slice(i === 0 ? 0 : (vals[i - 1].snd || []).length));
  const said = (i) => JSON.stringify(news[i]);
  ok("treasure: one Treasure created plays treasure", said(0) === '["treasure music"]', said(0));
  ok("treasure: three created on one board (one renamed, by its type line) play the x3 burst", said(1) === '["treasure_x3 music"]', said(1));
  ok("treasurespend: one Treasure sacrificed plays treasurespend, not death", said(2) === '["treasurespend music"]', said(2));
  ok("treasurespend: a token that is no Treasure still plays death", said(3) === '["death music"]', said(3));
  ok("treasurespend: three spent on one board play its x3, not a wipe", said(4) === '["treasurespend_x3 music"]', said(4));
  ok("treasure: two made on two seats play its x2", said(5) === '["treasure_x2 music"]', said(5));
  ok("order: a creature death beats a Treasure spent, and the Treasure isn't one of its deaths (death, not death_x2)", said(6) === '["death music"]', said(6));
  ok("treasure: a creature token named Treasure Token is no Treasure (entering: nothing)", said(7) === "[]", said(7));
  ok("treasurespend: ... and it dies as a death", said(8) === '["death music"]', said(8));
  ok("order: lifegain beats treasure", said(9) === '["lifegain music"]', said(9));
  ok("order: treasure beats sorcery (a spell that makes Treasures plays the jingle)", said(10) === '["treasure music"]', said(10));
  ok("treasure: no link (the shipped table until the upload): a Treasure made plays nothing", said(11) === "[]", said(11));
  ok("treasurespend: no link: two Treasures spent play nothing, not death", said(12) === "[]", said(12));
  const sh = t.value("shipped");
  // (uploaded 2026-11-13: the 12 links are the shipped ones; the plain two and the ten bursts are also checked against the
  // doc's tables by the 14-link and 44-burst checks)
  const tKeys = Object.keys(sh.shipped || {}).filter((k) => k.startsWith("treasure")).sort();
  ok("treasure: the shipped table has the 12 Treasure links (uploaded 2026-11-13)", tKeys.length === 12 && tKeys.every((k) => String(sh.shipped[k]).startsWith("https://steamusercontent-a.akamaihd.net/ugc/")), JSON.stringify(tKeys));
  // the clips' lengths: each file of the doc's Treasure table longer than 2 s has its length in engineSoundLen
  const doc = require("fs").readFileSync(require("path").join(__dirname, "..", "docs", "sounds.md"), "utf8");
  const files = [...doc.matchAll(/^\| mtg3-(treasure)(?:-x(\d+))?\.mp3 \| [\d.]+ s \| ([\d.]+) s \(/gm)].map((m) => ({ key: m[1] + (m[2] ? "_x" + m[2] : ""), len: Number(m[3]) }));
  ok("treasure: the doc's Treasure table lists the 6 Sack of Gold files", files.length === 6 && new Set(files.map((f) => f.key)).size === 6, JSON.stringify(files));
  ok("treasure: each file over 2 s has its length in engineSoundLen, the others none", files.every((f) => (f.len > 2 ? sh.len[f.key] === f.len : sh.len[f.key] === undefined)), JSON.stringify({ files, len: sh.len }));
  // (the user's pick, 2026-11-13: Treasure spent plays the death sound, so its plain link and bursts are death's)
  const spendKeys = ["", "_x2", "_x3", "_x4", "_x6", "_x8"];
  ok("treasurespend: its 6 links are death's own", spendKeys.every((x) => sh.shipped["treasurespend" + x] && sh.shipped["treasurespend" + x] === sh.shipped["death" + x]) && spendKeys.every((x) => sh.len["treasurespend" + x] === undefined),
    JSON.stringify(spendKeys.map((x) => [sh.shipped["treasurespend" + x], sh.shipped["death" + x]])));
}

// the instant and sorcery sounds play on the resolve, not the cast (2026-11-12, the user: "only play if not countered"):
// the bridge's rsv names each instant or sorcery that resolved since the last board (it alone can tell: a spell
// countered, fizzled, exiled from the stack or a copy leaves the stack as one that resolved does; resolvedSpells). The
// table plays instant / sorcery for an rsv entry only, one at most per board, never for one ctrd names, never on a jump
{
  const SHOCK = (id, src, ctl = "Blue") => ({ id, n: "Shock", tx: "Shock deals 2 damage to any target.", ctl, src, spell: false, sp: true, ins: true, tg: [] });
  const PICKS = (kinds) => `for _, k in ipairs({ "${kinds.join('", "')}" }) do engineSounds[k] = "https://example.invalid/" .. k .. ".mp3" end return "set"`;
  const s0 = base();
  const step = (from, edit) => { const x = clone(from); for (const k of ["ctrd", "rsv", "jump", "exd"]) delete x[k]; edit(x); return x; };
  const cast = step(s0, (x) => { x.stack = [SHOCK("engine-stack-60", "c60")]; });
  const resolved = step(cast, (x) => { x.stack = []; x.rsv = [{ id: "c60", k: "ins" }]; });
  const cast2 = step(resolved, (x) => { x.stack = [SHOCK("engine-stack-61", "c61")]; });
  const countered = step(cast2, (x) => { x.stack = []; x.ctrd = ["c61"]; }); // (countered: ctrd, no rsv)
  const cast3 = step(countered, (x) => { x.stack = [SHOCK("engine-stack-62", "c62")]; });
  const fizzled = step(cast3, (x) => { x.stack = []; }); // (fizzled or exiled from the stack: the bridge sends no rsv)
  const cast4 = step(fizzled, (x) => { x.stack = [SHOCK("engine-stack-63", "c63"), SHOCK("engine-stack-64", "c64")]; }); // (the second a copy)
  const copyGone = step(cast4, (x) => { x.stack = [SHOCK("engine-stack-63", "c63")]; }); // (the copy resolved: no rsv)
  const both = step(copyGone, (x) => { x.stack = []; x.rsv = [{ id: "c63", k: "ins" }, { id: "c65", k: "ins" }]; }); // (two resolved on one board)
  const unseen = step(both, (x) => { x.rsv = [{ id: "c66", k: "ins" }]; }); // (cast and resolved between two boards)
  const both2 = step(unseen, (x) => { x.ctrd = ["c67"]; x.rsv = [{ id: "c67", k: "ins" }]; }); // (an rsv that ctrd names too: countered)
  const jumped = step(both2, (x) => { x.rsv = [{ id: "c68", k: "ins" }]; x.jump = true; });
  const back = step(jumped, (x) => { x.turn = 2; x.rsv = [{ id: "c69", k: "ins" }]; }); // (the turn going down: a rewind)
  const after = step(back, (x) => { x.rsv = [{ id: "c70", k: "sor" }]; });
  const t = run([lua(PICKS(["instant", "sorcery", "countered"]), "picks"), send(s0, "first board"),
    send(cast, "cast", 30), LAST, send(resolved, "resolved", 30), LAST, send(cast2, "cast 2", 30), LAST, send(countered, "countered", 30), LAST,
    send(cast3, "cast 3", 30), LAST, send(fizzled, "fizzled", 30), LAST, send(cast4, "cast 4", 30), LAST, send(copyGone, "copy gone", 30), LAST,
    send(both, "two resolved", 30), LAST, send(unseen, "unseen", 30), LAST,
    lua(`engineSounds.countered = nil return "x"`, "no countered pick"), send(both2, "rsv and ctrd", 30), LAST,
    send(jumped, "jump", 30), LAST, send(back, "turn down", 30), LAST,
    lua(`engineChat("mtg fx off", Player.Blue) return "x"`, "fx off"), send(after, "fx off", 30), LAST]);
  ok("resolve: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  const news = vals.map((v, i) => JSON.stringify((v.snd || []).slice(i === 0 ? 0 : (vals[i - 1].snd || []).length)));
  ok("resolve: the cast plays nothing", news[0] === "[]", news[0]);
  ok("resolve: resolved (rsv) plays instant", news[1] === '["instant music"]', news[1]);
  ok("resolve: countered plays countered, never instant", news[2] === "[]" && news[3] === '["countered music"]', JSON.stringify([news[2], news[3]]));
  ok("resolve: fizzled / exiled from the stack (gone, no rsv) plays nothing", news[4] === "[]" && news[5] === "[]", JSON.stringify([news[4], news[5]]));
  ok("resolve: a copy cast and gone (no rsv) plays nothing", news[6] === "[]" && news[7] === "[]", JSON.stringify([news[6], news[7]]));
  ok("resolve: two resolved on one board play one instant (no burst)", news[8] === '["instant music"]', news[8]);
  ok("resolve: one cast and resolved between two boards plays instant", news[9] === '["instant music"]', news[9]);
  ok("resolve: an rsv ctrd names too plays no instant", news[10] === "[]", news[10]);
  ok("resolve: a jump board (bridge's jump) plays nothing", news[11] === "[]" && vals[11].jump === true, JSON.stringify([news[11], vals[11].jump]));
  ok("resolve: a rewind (the turn going down) plays nothing", news[12] === "[]" && vals[12].jump === true, JSON.stringify([news[12], vals[12].jump]));
  ok("resolve: mtg fx off keeps the sorcery sound", news[13] === '["sorcery music"]', news[13]);
  // (sounds off: nothing)
  const m = run([lua(PICKS(["instant"]), "picks"), send(s0, "first board"), lua(`engineChat("mtg sounds off", Player.Blue) return "x"`, "off"),
    send(resolved, "resolved, sounds off", 30), LAST]);
  ok("resolve: sounds off plays nothing", JSON.stringify(m.all("last").map((s) => JSON.parse(s.value || "{}").snd || [])[0]) === "[]", JSON.stringify(m.all("last").map((s) => s.value)));
}

// the COUNTERED pop-up (2026-11-11): an instant or a sorcery countered shows it too. The bridge's `spell` is false for
// any spell with spell text, so it marks those `sp`; before, the pop-up asked for `spell` alone and never showed for them
{
  const BOLT = { id: "engine-stack-30", n: "Lightning Bolt", tx: "Lightning Bolt deals 3 damage to any target.", ctl: "White", src: "c30", spell: false, sp: true, ins: true, tg: [{ k: "p", c: "Blue" }] };
  const RAMP = { id: "engine-stack-32", n: "Farseek", tx: "Search your library for a land card.", ctl: "White", src: "c32", spell: false, sp: true, tg: [] };
  const COUNTER = (id, target) => ({ id, n: "Counterspell", tx: "Counter target spell.", ctl: "Blue", src: id + "c", spell: false, sp: true, ins: true, tg: [{ k: "s", id: target }] });
  const CYCLE = { id: "engine-stack-34", n: "Censor", tx: "Cycling {U}", ctl: "White", src: "c34", spell: false, tg: [] };
  // (the countered spell is told by the bridge's ctrd, its card: see the next block)
  const s0 = base();
  const a1 = clone(s0); a1.stack = [BOLT, COUNTER("engine-stack-31", BOLT.id)];
  const a2 = clone(s0); a2.ctrd = [BOLT.src];
  const b1 = clone(s0); b1.stack = [RAMP, COUNTER("engine-stack-33", RAMP.id)];
  const b2 = clone(s0); b2.ctrd = [RAMP.src];
  const c1 = clone(s0); c1.stack = [CYCLE, COUNTER("engine-stack-35", CYCLE.id)];
  const c2 = clone(s0); c2.ctrd = [CYCLE.src];
  const t = run([send(s0, "first"), send(a1, "bolt cast", 30), send(a2, "bolt countered", 30), send(b1, "farseek cast", 30), send(b2, "farseek countered", 30),
    send(c1, "an ability", 30), send(c2, "an ability countered", 30)]);
  ok("countered: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const pop = (m) => t.fx(m).filter((l) => l.includes('"eng_pop_who"') && l.includes("COUNTERED"));
  ok("countered: an instant countered shows COUNTERED: Lightning Bolt", pop("bolt countered").some((l) => l.includes("COUNTERED: Lightning Bolt")), JSON.stringify(t.fx("bolt countered").filter((l) => l.includes("eng_pop"))));
  ok("countered: a sorcery countered shows COUNTERED: Farseek", pop("farseek countered").some((l) => l.includes("COUNTERED: Farseek")), JSON.stringify(t.fx("farseek countered").filter((l) => l.includes("eng_pop"))));
  ok("countered: an ability (no sp, no spell) countered shows none", pop("an ability countered").length === 0, JSON.stringify(pop("an ability countered")));
}

// the COUNTERED pop-up in the engine's own shape (bug B, live check 2026-11-12): the stack items as the bridge sent them
// (Forge's stack words "Counter Fury." / "Counter Tibalt, Cosmic Impostor.", no "counter target", and no targets), then
// a board with both gone and the bridge's ctrd naming the countered spell's card. The pop-up never fired live.
{
  const FURY = { id: "engine-stack-22", n: "Fury", tx: "Fury (Evoked)", ctl: "White", src: "c194", spell: true, tg: [] };
  const TIBALT = { id: "engine-stack-3", n: "Tibalt, Cosmic Impostor", tx: "Tibalt, Cosmic Impostor", ctl: "White", src: "c167", spell: true, tg: [] };
  const CS = (id, src, on) => ({ id, n: "Counterspell", tx: `Counter ${on}.`, ctl: "Blue", src, spell: false, sp: true, ins: true, tg: [] });
  const s0 = base();
  const f1 = clone(s0); f1.stack = [FURY, CS("engine-stack-26", "c195", "Fury")];
  const f2 = clone(s0); f2.ctrd = [FURY.src];
  const t1 = clone(s0); t1.stack = [TIBALT, CS("engine-stack-7", "c179", TIBALT.n)];
  const t2 = clone(s0); t2.ctrd = [TIBALT.src];
  const r1 = clone(s0); r1.stack = [FURY];
  const r2 = clone(s0); r2.ctrd = ["c999"]; // (a card the last stack didn't show: nothing to pop up)
  const t = run([send(s0, "first"), send(f1, "fury cast", 30), send(f2, "fury countered", 150), send(t1, "tibalt cast", 30), send(t2, "tibalt countered", 150),
    send(r1, "fury again", 30), send(r2, "fury resolves", 30)]);
  ok("countered live: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const pop = (m) => t.fx(m).filter((l) => l.includes('"eng_pop_who"') && l.includes("COUNTERED"));
  ok("countered live: COUNTERED: Fury", pop("fury countered").some((l) => l.includes("COUNTERED: Fury")), JSON.stringify(t.fx("fury countered").filter((l) => l.includes("eng_pop"))));
  ok("countered live: COUNTERED: Tibalt, Cosmic Impostor (the face cast)", pop("tibalt countered").some((l) => l.includes("COUNTERED: Tibalt, Cosmic Impostor")), JSON.stringify(t.fx("tibalt countered").filter((l) => l.includes("eng_pop"))));
  ok("countered live: a spell that left with no ctrd for it shows none", pop("fury resolves").length === 0, JSON.stringify(pop("fury resolves")));
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

// ───────── the effect bundle (M5 step 4, docs/m5-assetbundle-build.md) ─────────
// Particle rigs: copies of one AssetBundle whose GM notes are "engine:fx", parked under the table. One is moved to where
// something happened and plays the trigger effect of that name (AssetBundle.playTriggerEffect, index from
// getTriggerEffects), then goes back under the table. No rig, or no effect of that name: today's Object UI slot.
// (rigs: n of them and no fx link, so the shipped link doesn't top the pool up to FX.RIGS; the top-up has its own checks)
const RIG_NAMES = ["death", "death_wipe", "exile", "countered", "damage", "player_hit", "counter", "counter_minus", "lifegain", "knockout"];
const rigs = (n, names, extra = "") => lua(`for i = 1, ${n} do __sim.makeObj({ Name = "Custom_Assetbundle", GUID = "rig00" .. i, GMNotes = "engine:fx", Locked = true,
  Transform = { posX = 20 + i, posY = -30, posZ = 0 }, CustomAssetbundle = { AssetbundleURL = "https://example.invalid/fx.unity3d", SimTriggerEffects = { "${names.join('", "')}" } } }) end
  engineFxBundle.fx = nil ${extra} return "rigs"`, "rigs");
// every rig: where it is now, the trigger effects it played (index, frame, where it was then), who it is invisible to
const RIGQ = lua(`local out = {} for _, o in ipairs(getObjects()) do if o.getGMNotes() == "engine:fx" then local p = o.getPosition() local pl = {}
  for _, x in ipairs(o.__d.played or {}) do pl[#pl + 1] = { i = x.index, f = x.frame, x = x.pos.x, y = x.pos.y, z = x.pos.z } end
  out[#out + 1] = { g = o.getGUID(), x = p.x, y = p.y, z = p.z, played = pl, inv = table.concat(o.__d.invisibleTo or {}, "|") } end end return JSON.encode(out)`, "rigq", 1);
const arr = (x) => (Array.isArray(x) ? x : []);
// the trigger effects played between two RIGQ answers, oldest first: { name, x, y, z, f }
const playedSince = (before, after, names) => {
  const out = [];
  for (const r of arr(after)) {
    const was = arr(arr(before).find((b) => b.g === r.g)?.played).length;
    for (const p of arr(r.played).slice(was)) out.push({ name: names[p.i], x: p.x, y: p.y, z: p.z, f: p.f, g: r.g });
  }
  return out.sort((a, b) => a.f - b.f);
};
const abLines = (lines) => lines.filter((l) => l.includes('"AssetBundle.'));

// no bundle on the table: nothing new happens (no AssetBundle call, the slots as before, exile / lifegain / countered
// have no effect of their own). The table ships the mtg-fx link (2026-11-12), so the test clears it first; the shipped
// link must be the one docs/m5-assetbundle-build.md section 1 names.
{
  const s0 = base();
  const d = clone(s0); d.Blue.bf = d.Blue.bf.filter((c) => c !== "b1"); d.Blue.gy = ["b1"];
  const ex = clone(d); ex.Blue.bf = ex.Blue.bf.filter((c) => c !== "b2"); ex.Blue.ex = ["b2"];
  const gain = clone(ex); gain.White.life = 44;
  const t = run([lua(`return JSON.encode({ fx = engineFxBundle.fx or "", sounds = engineFxBundle.sounds or "" })`, "shipped bundle"),
    lua(`engineFxBundle = { fx = nil, sounds = nil } return "x"`, "no links"),
    send(s0, "first board"), send(d, "death", 60), LAST, send(ex, "exile", 60), LAST, send(gain, "lifegain", 60), LAST]);
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  const bdoc = require("fs").readFileSync(require("path").join(__dirname, "..", "docs", "m5-assetbundle-build.md"), "utf8");
  const fxDoc = (bdoc.match(/^- `engineFxBundle\.fx` \(shipped[^\n]*`mtg-fx\.unity3d`[^\n]*?: (https:\/\/\S+\/)$/m) || [])[1];
  const sb = t.value("shipped bundle");
  ok("fx bundle: the shipped engineFxBundle.fx is the mtg-fx link of docs/m5-assetbundle-build.md", /^https:\/\/steamusercontent/.test(fxDoc || "")
    && sb.fx === fxDoc && sb.sounds === "", JSON.stringify({ fxDoc, sb }));
  ok("no bundle: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  ok("no bundle: no AssetBundle call at all", t.r.steps.every((s) => abLines(s.fx || []).length === 0));
  ok("no bundle: a death takes a slot, as before", (vals[0].fx || []).length === 1 && vals[0].fx[0].slot === 1 && vals[0].fx[0].rig === undefined && activeOn(t.fx("death")).length === 1, JSON.stringify(vals[0]));
  ok("no bundle: an exile and a life gain show nothing", (vals[1].fx || []).length === 0 && (vals[2].fx || []).length === 0 && objUI(t.fx("exile")).length === 0, JSON.stringify([vals[1], vals[2]]));
  ok("no bundle: no link set, nothing spawned", !t.r.steps.some((s) => (s.fx || []).some((l) => l.includes('"spawnObjectData" "Custom_Assetbundle"'))));
}

// the links (engineFxBundle): with no rig and no sound object on the table, a game's first board spawns 6 rigs and one
// sound object, parked under the table and locked; they play; the next game spawns no more
{
  const s0 = base();
  const d = clone(s0); d.Blue.bf = d.Blue.bf.filter((c) => c !== "b1"); d.Blue.gy = ["b1"];
  const FXL = "https://example.invalid/mtg-fx.unity3d", SNDL = "https://example.invalid/mtg-sounds.unity3d";
  const t = run([
    lua(`__sim.bundleEffects = { ["${FXL}"] = { "${RIG_NAMES.join('", "')}" }, ["${SNDL}"] = { "death", "wipe" } }
      engineFxBundle = { fx = "${FXL}", sounds = "${SNDL}" } engineSounds.death = "death" return "x"`, "links"),
    send(s0, "first board", 5), RIGQ,
    lua(`local s = nil for _, o in ipairs(getObjects()) do if o.getGMNotes() == "engine:sounds" then s = o end end
      return s and JSON.encode({ y = s.getPosition().y, lock = s.getLock() }) or "{}"`, "sound object", 1),
    lua(`local out = {} for _, o in ipairs(getObjects()) do local d = o.__d.data
      if d ~= nil and d.Name == "Custom_Assetbundle" and (d.GMNotes == "engine:fx" or d.GMNotes == "engine:sounds") then local tr = d.Transform or {} out[#out + 1] = { y = tr.posY, s = tr.scaleX } end end
      return JSON.encode(out)`, "transforms", 1),
    send(d, "death", 150), RIGQ, LAST,
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 30, mark: "clear" },
    { msg: { t: "started", json: STARTED }, mark: "started 2" }, send(s0, "second game's first board", 5), RIGQ,
  ]);
  ok("links: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const q = t.all("rigq").map((s) => JSON.parse(s.value || "[]"));
  const spawns = (m) => t.fx(m).filter((l) => l.includes('"spawnObjectData" "Custom_Assetbundle"'));
  ok("links: 7 bundle objects spawned at the first board (6 rigs, 1 sound object)", spawns("first board").length === 7, JSON.stringify(spawns("first board")));
  // (the fake calls onObjectSpawn as TTS does; the stray-card watcher there deleted every rig a frame after its spawn,
  // live check batch 2 2026-11-12, bug A2)
  ok("links: the spawned bundle objects survive onObjectSpawn's stray-card watcher", q[0].length === 6 && t.value("sound object").lock === true, JSON.stringify(q[0].length));
  ok("links: the 6 rigs parked under the table",q[0].length === 6 && q[0].every((r) => near(r.y, -30)), JSON.stringify(q[0]));
  const so = t.value("sound object");
  ok("links: the sound object parked under the table, locked", near(so.y, -30) && so.lock === true, JSON.stringify(so));
  ok("links: a spawned rig plays the death", JSON.stringify(playedSince(q[0], q[1], RIG_NAMES).map((p) => p.name)) === '["death"]', JSON.stringify(q[1]));
  const v = t.value("last");
  ok("links: the death sound through the spawned sound object (index 0)", JSON.stringify(v.snd) === '["death bundle"]' && abLines(t.fx("death")).some((l) => /"AssetBundle.playTriggerEffect" obj:\S+ 0$/.test(l)), JSON.stringify([v.snd, abLines(t.fx("death"))]));
  ok("links: the next game spawns none, and finds all 6", spawns("second game's first board").length === 0 && q[2].length === 6, JSON.stringify(q[2].length));
  // (the fake raises on an AssetBundle spawned with no Transform, as real TTS does: live check 2026-11-12, bug A)
  const tf = t.value("transforms");
  ok("links: every bundle's spawn data has a Transform at its park spot", Array.isArray(tf) && tf.length === 7 && tf.every((x) => near(x.y, -30) && x.s === 1), JSON.stringify(tf));
}

// a bundle spawn that fails (bug A, live 2026-11-12: the spawn raised and FX.built was already set, so the life
// counter's effect pool was never built): no script error, the pool is built anyway and a death takes a slot, and the
// next game tries the spawn again
{
  const s0 = base();
  const d = clone(s0); d.Blue.bf = d.Blue.bf.filter((c) => c !== "b1"); d.Blue.gy = ["b1"];
  const FXL = "https://example.invalid/mtg-fx.unity3d";
  const t = run([
    lua(`__sim.bundleEffects = { ["${FXL}"] = { "${RIG_NAMES.join('", "')}" } } __sim.spawnFail = function(d) return d.Name == "Custom_Assetbundle" end
      engineFxBundle = { fx = "${FXL}" } return "x"`, "links"),
    send(s0, "first board", 5),
    lua(`return getObjectFromGUID("${CARRIER}").UI.getXml()`, "pool xml", 1),
    send(d, "death", 60), LAST,
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 30, mark: "clear" },
    lua(`__sim.spawnFail = nil return "x"`, "spawns work again"),
    { msg: { t: "started", json: STARTED }, mark: "started 2" }, send(s0, "second game's first board", 5), RIGQ,
  ]);
  ok("spawn fails: the script ran (the failure is caught)", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const printed = t.r.steps.flatMap((s) => (s.fx || []).filter((l) => /spawn failed|table effects|pop-up/i.test(l)));
  ok("spawn fails: nothing raised on the way (no error printed)", printed.length === 0, JSON.stringify(printed.slice(0, 3)));
  ok("spawn fails: the life counter's pool is built at the first board", String(t.step("pool xml").value || "").includes('id="eng_fx_pool_'), String(t.step("pool xml").value || "").slice(0, 120));
  const v = t.value("last");
  ok("spawn fails: the death still takes an Object UI slot (the pool was built)", (v.fx || []).length === 1 && v.fx[0].slot === 1 && activeOn(t.fx("death")).length === 1, JSON.stringify(v));
  const q = t.all("rigq").map((s) => JSON.parse(s.value || "[]"));
  ok("spawn fails: the next game spawns the 6 rigs", q[0] && q[0].length === 6, JSON.stringify(q));
}

// a full bundle, 3 rigs: each event plays its own trigger effect at its spot, and the rig goes back under the table
{
  const s0 = base(); s0.Blue.gy = [];
  const d = clone(s0); d.Blue.bf = d.Blue.bf.filter((c) => c !== "b1"); d.Blue.gy = ["b1"];
  const ex = clone(d); ex.Blue.bf = ex.Blue.bf.filter((c) => c !== "b2"); ex.Blue.ex = ["b2"];
  const gain = clone(ex); gain.White.life = 44;
  const m1 = clone(gain); m1.Blue.more.b3 = { ctr: { M1M1: 1 } };
  const p1 = clone(m1); p1.Blue.more.b4 = { ctr: { P1P1: 1 } };
  const hurt = clone(p1); hurt.White.life = 40;
  const crd = clone(hurt); crd.White.more.w1 = { dmg: 2 };
  const BOLT = { id: "engine-stack-30", n: "Lightning Bolt", tx: "Lightning Bolt deals 3 damage to any target.", ctl: "White", src: "c30", spell: false, sp: true, ins: true, tg: [{ k: "p", c: "Blue" }] };
  const CS = { id: "engine-stack-31", n: "Counterspell", tx: "Counter target spell.", ctl: "Blue", src: "c31", spell: false, sp: true, ins: true, tg: [{ k: "s", id: BOLT.id }] };
  const cast = clone(crd); cast.stack = [BOLT, CS];
  const gone = clone(crd); gone.ctrd = [BOLT.src]; // (the bridge names the countered spell's card)
  const wipe = clone(crd); wipe.Blue.bf = ["b8", "bl1"].filter((c) => wipe.Blue.bf.includes(c)); wipe.Blue.gy = ["b1", "b3", "b4", "b5", "b6", "b7"];
  const ko = clone(wipe); ko.White.status = "lost";
  const jumped = clone(ko); jumped.White.bf = jumped.White.bf.filter((c) => c !== "w2"); jumped.White.gy = ["w2"]; jumped.jump = true;
  const t = run([
    rigs(3, RIG_NAMES),
    send(s0, "first board"), RIGQ, posOf(["b1", "b2", "b3", "b4", "w1"]), lua(`local p = getObjectFromGUID("23e485").getPosition() return JSON.encode({ x = p.x, y = p.y, z = p.z })`, "life", 1),
    send(d, "death", 3), RIGQ, LAST, lua(`return "x"`, "death later", 150), RIGQ, posOf(["b2"]),
    send(ex, "exile", 150), RIGQ, LAST,
    send(gain, "lifegain", 150), RIGQ, LAST, posOf(["b3", "b4"]),
    send(m1, "minus counter", 150), RIGQ, LAST,
    send(p1, "plus counter", 150), RIGQ, LAST,
    send(hurt, "player hit", 150), RIGQ, LAST,
    send(crd, "creature hit", 150), RIGQ, LAST,
    send(cast, "cast", 10), lua(`local p = engineFxStackSpot and engineFxStackSpot["${BOLT.id}"] return p and JSON.encode({ x = p.x, z = p.z }) or "{}"`, "stack spot", 1),
    send(gone, "countered", 150), RIGQ, LAST,
    send(wipe, "wipe", 150), RIGQ, LAST,
    send(ko, "knock-out", 20), RIGQ, LAST, lua(`return "x"`, "knock-out later", 130), RIGQ,
    send(jumped, "jump", 150), RIGQ, LAST,
    lua(`return engineFxTest("exile", "w3")`, "fx test", 10), RIGQ,
  ]);
  ok("rigs: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const q = t.all("rigq").map((s) => JSON.parse(s.value || "[]"));
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  const [pos, pos2, pos3] = t.all("pos").map((s) => JSON.parse(s.value || "{}")), life = t.value("life"); // (the cards close up after a death: each spot as it was just before)
  const since = (i) => playedSince(q[i - 1], q[i], RIG_NAMES);
  ok("rigs: three found, all under the table, none played at the first board", q[0].length === 3 && q[0].every((r) => near(r.y, -30) && arr(r.played).length === 0), JSON.stringify(q[0]));
  ok("rigs: the trigger effects' names are asked for", t.r.steps.some((s) => (s.fx || []).some((l) => l.includes('"AssetBundle.getTriggerEffects"'))));
  // death (q[1]: 4 frames after the board, q[2]: 2.5 s later)
  const dp = playedSince(q[0], q[2], RIG_NAMES);
  ok("rig death: one \"death\" trigger effect", dp.length === 1 && dp[0].name === "death", JSON.stringify(dp));
  ok("rig death: at the card's spot, a little above the table", dp[0] && near(dp[0].x, pos.b1.x) && near(dp[0].z, pos.b1.z) && dp[0].y > -5, JSON.stringify({ dp, b1: pos.b1 }));
  const moved = t.fx("death").find((l) => /"setPosition" obj:rig00\d/.test(l));
  ok("rig death: moved there at once, triggered later (other players get the spot first)", moved !== undefined && q[1].some((r) => r.y > -5)
    && playedSince(q[0], q[1], RIG_NAMES).length === 0 && dp[0] && dp[0].f > Number(moved.split(" ")[0].slice(1)), JSON.stringify({ moved, dp }));
  ok("rig death: no Object UI slot for it", activeOn(t.fx("death").concat(t.fx("death later"))).length === 0, JSON.stringify(activeOn(t.fx("death"))));
  ok("rig death: engineFxLast says which effect", (vals[0].fx || []).length === 1 && vals[0].fx[0].rig === "death" && vals[0].fx[0].slot === undefined, JSON.stringify(vals[0]));
  ok("rig death: back under the table once it is over", q[2].every((r) => near(r.y, -30)), JSON.stringify(q[2].map((r) => [r.g, r.x, r.y])));
  ok("rig death: the graveyard flash as before", vals[0].died && vals[0].died.Blue === 1, JSON.stringify(vals[0].died));
  // exile, lifegain, counters, damage
  const one = (i) => since(i).map((p) => p.name);
  ok("rig exile: an \"exile\" effect at the card's spot (with the bundle, exile has a look)", JSON.stringify(one(3)) === '["exile"]' && near(since(3)[0].x, pos2.b2.x) && near(since(3)[0].z, pos2.b2.z), JSON.stringify({ p: since(3), b2: pos2.b2 }));
  ok("rig lifegain: a \"lifegain\" effect at White's life counter", JSON.stringify(one(4)) === '["lifegain"]' && near(since(4)[0].x, life.x) && near(since(4)[0].z, life.z), JSON.stringify({ p: since(4), life }));
  ok("rig counters: a -1/-1 counter plays \"counter_minus\"", JSON.stringify(one(5)) === '["counter_minus"]' && near(since(5)[0].x, pos3.b3.x), JSON.stringify(since(5)));
  ok("rig counters: a +1/+1 counter plays \"counter\"", JSON.stringify(one(6)) === '["counter"]' && near(since(6)[0].x, pos3.b4.x), JSON.stringify(since(6)));
  ok("rig player hit: \"player_hit\", and the life counter still flashes red", JSON.stringify(one(7)) === '["player_hit"]' && t.fx("player hit").some((l) => l.includes('"highlightOn" obj:23e485')), JSON.stringify(since(7)));
  ok("rig creature hit: \"damage\" at the creature", JSON.stringify(one(8)) === '["damage"]' && near(since(8)[0].x, pos.w1.x) && near(since(8)[0].z, pos.w1.z), JSON.stringify(since(8)));
  // countered: at the countered spell's spot on the stack (the board before), the pop-up as before
  const spot = t.value("stack spot");
  ok("rig countered: a \"countered\" effect where the spell was on the stack", JSON.stringify(one(9)) === '["countered"]' && spot.x !== undefined && near(since(9)[0].x, spot.x) && near(since(9)[0].z, spot.z), JSON.stringify({ p: since(9), spot }));
  ok("rig countered: the COUNTERED pop-up as before", t.fx("countered").some((l) => l.includes("COUNTERED: Lightning Bolt")));
  // a wipe: one bigger cloud
  ok("rig wipe: one \"death_wipe\" for 5 deaths on one battlefield", JSON.stringify(one(10)) === '["death_wipe"]', JSON.stringify(since(10)));
  // knock-out: 0.6 s in, as its slot burst and its sound
  ok("rig knock-out: not at once", since(11).length === 0, JSON.stringify(since(11)));
  ok("rig knock-out: \"knockout\" 0.6 s in, at the life counter", JSON.stringify(one(12)) === '["knockout"]' && near(since(12)[0].x, life.x), JSON.stringify(since(12)));
  ok("rig jump: a jump board plays nothing", since(13).length === 0 && (vals[10].fx || []).length === 0, JSON.stringify(since(13)));
  ok("rig engineFxTest: plays the named effect on a rig", t.step("fx test").value === "shown" && JSON.stringify(one(14)) === '["exile"]', JSON.stringify([t.step("fx test").value, since(14)]));
}

// a bundle with only "death": the rest fall back (a wipe plays "death"; a counter takes a slot; an exile shows nothing)
{
  const s0 = base();
  const wipe = clone(s0); wipe.Blue.bf = ["b6", "b7", "bl1"]; wipe.Blue.gy = ["b1", "b2", "b3", "b4", "b5"];
  const ctr = clone(wipe); ctr.Blue.more.b6 = { ctr: { P1P1: 1 } };
  const ex = clone(ctr); ex.Blue.bf = ex.Blue.bf.filter((c) => c !== "b7"); ex.Blue.ex = ["b7"];
  const t = run([rigs(2, ["death"]), send(s0, "first board"), RIGQ, send(wipe, "wipe", 150), RIGQ, LAST, send(ctr, "counter", 60), RIGQ, LAST, send(ex, "exile", 60), RIGQ, LAST]);
  ok("death only: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const q = t.all("rigq").map((s) => JSON.parse(s.value || "[]"));
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  const names = ["death"];
  ok("death only: a wipe plays \"death\" (no death_wipe in the bundle)", JSON.stringify(playedSince(q[0], q[1], names).map((p) => p.name)) === '["death"]' && vals[0].fx[0].rig === "death", JSON.stringify(vals[0]));
  ok("death only: a counter takes a slot as before", playedSince(q[1], q[2], names).length === 0 && vals[1].fx.length === 1 && vals[1].fx[0].slot !== undefined && activeOn(t.fx("counter")).length === 1, JSON.stringify(vals[1]));
  ok("death only: an exile shows nothing", playedSince(q[2], q[3], names).length === 0 && (vals[2].fx || []).length === 0, JSON.stringify(vals[2]));
}

// one rig, a death and an exile on one board: the death takes the rig; the exile, a bundle-only kind, is dropped
// rather than shown in a slot (it has no slot look)
{
  const s0 = base();
  const both = clone(s0); both.Blue.bf = both.Blue.bf.filter((c) => c !== "b1" && c !== "b2"); both.Blue.gy = ["b1"]; both.Blue.ex = ["b2"];
  const t = run([rigs(1, RIG_NAMES), send(s0, "first board"), send(both, "death and exile", 60), LAST]);
  ok("bundle-only kinds: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const v = t.value("last");
  ok("bundle-only kinds: the death on the rig, the exile dropped, no slot", (v.fx || []).length === 1 && v.fx[0].rig === "death" && v.dropped === 1 && activeOn(t.fx("death and exile")).length === 0, JSON.stringify(v));
}

// the pool: 2 rigs and 4 creatures hit at once: 2 on rigs, 2 in slots; a rig is never reused before its effect ends
{
  const s0 = base();
  const many = clone(s0); many.White.more = { w1: { dmg: 1 }, w2: { dmg: 2 }, w3: { dmg: 3 }, w4: { dmg: 4 } };
  const more = clone(many); more.Blue.more.b1 = { dmg: 1 };
  const t = run([rigs(2, RIG_NAMES), send(s0, "first board"), RIGQ, send(many, "four hits", 2), LAST, send(more, "one more at once", 2), LAST, RIGQ]);
  ok("pool: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  const fx = vals[0].fx || [];
  ok("pool: 2 on rigs, 2 in slots", fx.length === 4 && fx.filter((e) => e.rig === "damage").length === 2 && fx.filter((e) => e.slot !== undefined).length === 2, JSON.stringify(fx));
  ok("pool: the next one while both rigs are busy takes a slot", (vals[1].fx || []).length === 1 && vals[1].fx[0].slot !== undefined && vals[1].fx[0].rig === undefined, JSON.stringify(vals[1]));
}

// the switches: "mtg effects off" makes the rigs invisible to that player; "mtg animations off" (host) stops them
{
  const s0 = base();
  const k1 = clone(s0); k1.Blue.bf = k1.Blue.bf.filter((x) => x !== "b1"); k1.Blue.gy = ["b1"];
  const k2 = clone(k1); k2.Blue.bf = k2.Blue.bf.filter((x) => x !== "b2"); k2.Blue.gy.push("b2");
  const k3 = clone(k2); k3.Blue.bf = k3.Blue.bf.filter((x) => x !== "b3"); k3.Blue.gy.push("b3");
  const t = run([
    lua(`__sim.seated.White = true return "x"`, "seat"), rigs(1, RIG_NAMES), send(s0, "first board"), RIGQ,
    lua(`engineChat("mtg effects off", Player.Blue) return "off"`, "blue off"), send(k1, "blue has effects off", 150), RIGQ,
    lua(`engineChat("mtg effects on", Player.Blue) engineChat("mtg animations off", Player.Blue) return "anim"`, "anim off"), send(k2, "animations off", 150), RIGQ,
    lua(`engineChat("mtg animations on", Player.Blue) return "on"`, "anim on"), send(k3, "all on again", 150), RIGQ,
  ]);
  ok("rig switches: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const q = t.all("rigq").map((s) => JSON.parse(s.value || "[]"));
  const p1 = playedSince(q[0], q[1], RIG_NAMES);
  ok("effects off: the rig plays, invisible to Blue only", p1.length === 1 && q[1][0].inv === "Blue", JSON.stringify(q[1]));
  ok("animations off: no rig moves and none plays", playedSince(q[1], q[2], RIG_NAMES).length === 0 && !t.fx("animations off").some((l) => l.includes("obj:rig00")), JSON.stringify(t.fx("animations off").filter((l) => l.includes("rig00"))));
  ok("effects on again: the rig is seen by everyone again", playedSince(q[2], q[3], RIG_NAMES).length === 1 && q[3][0].inv === "", JSON.stringify(q[3]));
}

// a bundle still loading (getTriggerEffects answers {}): slots meanwhile, the rigs once it has loaded
{
  const s0 = base();
  const k1 = clone(s0); k1.Blue.bf = k1.Blue.bf.filter((x) => x !== "b1"); k1.Blue.gy = ["b1"];
  const k2 = clone(k1); k2.Blue.bf = k2.Blue.bf.filter((x) => x !== "b2"); k2.Blue.gy.push("b2");
  const loaded = (b) => `for _, o in ipairs(getObjects()) do if o.getGMNotes() == "engine:fx" then o.__d.bundleLoaded = ${b} end end`;
  const t = run([rigs(2, RIG_NAMES, loaded("false")), send(s0, "first board"), RIGQ, send(k1, "still loading", 150), RIGQ, LAST,
    lua(`${loaded("true")} return "x"`, "loaded"), send(k2, "loaded now", 150), RIGQ, LAST]);
  ok("loading: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const q = t.all("rigq").map((s) => JSON.parse(s.value || "[]"));
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  ok("loading: a slot while the bundle can't say its effects", playedSince(q[0], q[1], RIG_NAMES).length === 0 && vals[0].fx[0].slot !== undefined, JSON.stringify(vals[0]));
  ok("loading: the rig once it can", JSON.stringify(playedSince(q[1], q[2], RIG_NAMES).map((p) => p.name)) === '["death"]', JSON.stringify(vals[1]));
}

// the bundle objects are the table's, not a game's: a new game (the sweep of engine objects) and the table's own check
// leave the rigs and the sound object alone; an effect still playing at a reset goes back under the table
{
  const s0 = base();
  const k1 = clone(s0); k1.Blue.bf = k1.Blue.bf.filter((x) => x !== "b1"); k1.Blue.gy = ["b1"];
  const t = run([
    rigs(2, RIG_NAMES, `__sim.makeObj({ Name = "Custom_Assetbundle", GUID = "snd001", GMNotes = "engine:sounds", Transform = { posY = -30 }, CustomAssetbundle = { SimTriggerEffects = { "death" } } })`),
    send(s0, "first board"), lua(`local r = engineSelfCheck() return JSON.encode(r.problems or {})`, "self check", 1),
    send(k1, "death", 3), RIGQ,
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 30, mark: "clear" }, RIGQ,
    { msg: { t: "started", json: STARTED }, mark: "started 2" }, send(s0, "second game's first board", 10), RIGQ,
    lua(`local n = 0 for _, o in ipairs(getObjects()) do if o.getGMNotes() == "engine:sounds" then n = n + 1 end end return tostring(n)`, "sound object", 1),
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 30, mark: "clear 2" },
    lua(`engineChat("mtg start ai 1", Player.Blue) return "x"`, "mtg start again", 120),
  ]);
  ok("kept: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const q = t.all("rigq").map((s) => JSON.parse(s.value || "[]"));
  const probs = t.step("self check").value || "";
  ok("kept: the table's check doesn't call the bundle objects leftovers or duplicates", !/\[fx\]|\[sounds\]|object for fx|object for sounds/.test(probs), probs);
  ok("kept: a rig was out playing the death", q[0].some((r) => r.y > -5), JSON.stringify(q[0]));
  ok("kept: the reset puts it back under the table", q[1].length === 2 && q[1].every((r) => near(r.y, -30)), JSON.stringify(q[1]));
  ok("kept: a new game's sweep leaves both rigs", q[2].length === 2 && !t.r.steps.some((s) => (s.fx || []).some((l) => /"destruct" obj:(rig00|snd001)/.test(l))), JSON.stringify(q[2]));
  ok("kept: and the sound object", t.step("sound object").value === "1", t.step("sound object").value);
  ok("kept: \"mtg start\" doesn't take them for the last game's cards", !t.fx("mtg start again").some((l) => l.includes("Cards from the last engine game")), JSON.stringify(t.fx("mtg start again").filter((l) => l.includes("broadcast")).slice(0, 3)));
}

// route B sounds: a sound bundle still loading isn't asked once and forgotten: the next sound finds its effects
{
  const s0 = base();
  const k1 = clone(s0); k1.Blue.bf = k1.Blue.bf.filter((x) => x !== "b1"); k1.Blue.gy = ["b1"];
  const k2 = clone(k1); k2.Blue.bf = k2.Blue.bf.filter((x) => x !== "b2"); k2.Blue.gy.push("b2");
  const t = run([
    lua(`local o = __sim.makeObj({ Name = "Custom_Assetbundle", GUID = "snd001", GMNotes = "engine:sounds", Transform = { posY = -30 }, CustomAssetbundle = { SimTriggerEffects = { "poof", "death" } } })
      o.__d.bundleLoaded = false engineSounds.death = "death" return "x"`, "sound bundle"),
    send(s0, "first board"), send(k1, "still loading", 60), LAST,
    lua(`getObjectFromGUID("snd001").__d.bundleLoaded = true return "x"`, "loaded"), send(k2, "loaded now", 60), LAST,
  ]);
  ok("route B loading: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const vals = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  ok("route B loading: nothing while it loads", (vals[0].snd || []).length === 0 && !abLines(t.fx("still loading")).some((l) => l.includes("playTriggerEffect")), JSON.stringify(vals[0].snd));
  ok("route B loading: the death sound once it has loaded (index 1)", JSON.stringify(vals[1].snd) === '["death bundle"]' && abLines(t.fx("loaded now")).some((l) => l.includes('"AssetBundle.playTriggerEffect" obj:snd001 1')), JSON.stringify(abLines(t.fx("loaded now"))));
}

// ───────── the particle effects, full build (docs/particle-fx-spec.md) ─────────
// The mtg-fx bundle's 20 trigger effects and the mtg-bolt bundle's 8, in their index order (assets/fx/EFFECTS.md), on
// rigs "engine:fx" and "engine:bolt"; the bridge's cl (a card's colour letters), lv (battlefield departures: to, how, by,
// q) and hits (damage dealt by an effect: src, to, n, q, combat).
const FX_NAMES = [...RIG_NAMES, "death_burn", "exile_neutral", "wipe_wave", ..."WUBRGCM".split("").map((k) => `death_wipe_${k}`)];
const BOLT_NAMES = ["bolt", "bolt_W", "bolt_U", "bolt_B", "bolt_R", "bolt_G", "bolt_trail", "bolt_impact"];
const pools = (nFx, nBolt, extra = "") => lua(`for i = 1, ${nFx} do __sim.makeObj({ Name = "Custom_Assetbundle", GUID = string.format("rig%03d", i), GMNotes = "engine:fx", Locked = true,
  Transform = { posX = 20 + i, posY = -30, posZ = 0 }, CustomAssetbundle = { AssetbundleURL = "https://example.invalid/fx.unity3d", SimTriggerEffects = { "${FX_NAMES.join('", "')}" } } }) end
  for i = 1, ${nBolt} do __sim.makeObj({ Name = "Custom_Assetbundle", GUID = string.format("blt%03d", i), GMNotes = "engine:bolt", Locked = true,
  Transform = { posX = 20 + i, posY = -30, posZ = 2 }, CustomAssetbundle = { AssetbundleURL = "https://example.invalid/bolt.unity3d", SimTriggerEffects = { "${BOLT_NAMES.join('", "')}" } } }) end
  engineFxBundle.fx = nil engineFxBundle.bolt = nil ${extra} return "pools"`, "pools"); // (no links: the pools as given, see rigs)
// every rig of both pools: where it is, its scale and tint now, and each trigger effect it played (frame, spot, turn,
// scale, tint then)
const POOLQ = lua(`local out = {} for _, o in ipairs(getObjects()) do local gm = o.getGMNotes() if gm == "engine:fx" or gm == "engine:bolt" then local p = o.getPosition() local pl = {}
  for _, x in ipairs(o.__d.played or {}) do local t = x.tint or { 1, 1, 1 } pl[#pl + 1] = { i = x.index, f = x.frame, x = x.pos.x, y = x.pos.y, z = x.pos.z, rx = x.rot.x, ry = x.rot.y, s = x.scale.x, tr = t.r or t[1], tg = t.g or t[2], tb = t.b or t[3] } end
  local t = o.__d.tint or { 1, 1, 1 }
  out[#out + 1] = { g = o.getGUID(), b = gm == "engine:bolt", x = p.x, y = p.y, z = p.z, s = o.__d.scale.x, tr = t.r or t[1], tg = t.g or t[2], tb = t.b or t[3], played = pl } end end return JSON.encode(out)`, "poolq", 1);
const fxPlayed = (before, after) => {
  const out = [];
  for (const r of arr(after)) {
    const was = arr(arr(before).find((b) => b.g === r.g)?.played).length;
    for (const p of arr(r.played).slice(was)) out.push({ ...p, name: (r.b ? BOLT_NAMES : FX_NAMES)[p.i], bolt: r.b, g: r.g });
  }
  return out.sort((a, b) => a.f - b.f || (a.g < b.g ? -1 : 1));
};
const LASTB = lua(`return JSON.encode(engineFxLast and engineFxLast.bolts or {})`, "lastb", 1);
const LIVES = lua(`local out = {} for c, g in pairs({ White = "23e485", Blue = "395037" }) do local p = getObjectFromGUID(g).getPosition() out[c] = { x = p.x, z = p.z } end return JSON.encode(out)`, "lives", 1);
const ang = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// a rig aimed from where it played at `to` (local +z at it: yaw and pitch) and scaled to the distance
const aimOf = (from, to) => { const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, d = Math.hypot(dx, dy, dz); return { yaw: Math.atan2(dx, dz) * 180 / Math.PI, pitch: -Math.asin(dy / d) * 180 / Math.PI, d }; };
const aimed = (b, to) => { const a = aimOf(b, to); return !!b && ang(b.ry, a.yaw) < 0.5 && ang(b.rx, a.pitch) < 0.5 && Math.abs(b.s - a.d) < 0.05; };
const clCard = (id, name, ty, cl) => { card(id, name, ty); cards[id].cl = cl; return id; };
clCard("c40", "Wrath of God", ["Sorcery"], "W"); clCard("c41", "Supreme Verdict", ["Sorcery"], "WU"); clCard("c42", "Nevinyrral's Disk", ["Artifact"], "C");
clCard("c50", "Pyroclasm", ["Sorcery"], "R"); clCard("c30", "Lightning Bolt", ["Instant"], "R"); clCard("c60", "Kozilek's Return", ["Instant"], "C");
cards.w2.cl = "G"; cards.w4.cl = "BR"; // (an ability's source: green; a multicoloured one)
const stackOf = (src, n, ctl, cl, extra = {}) => ({ id: `engine-stack-${src}`, n, tx: "", ctl, src, spell: false, sp: true, cl, ...extra });
const ALL = [...blueC.slice(0, 7), ...whiteC];
// s with ids gone to their owners' graveyards, the stack emptied; by: lv's cause for each (a card id, or id -> one)
const wiped = (s, ids, by, extra = {}) => {
  const w = clone(s);
  for (const c of ["Blue", "White"]) { const mine = w[c].bf.filter((id) => ids.includes(id)); w[c].bf = w[c].bf.filter((id) => !ids.includes(id)); w[c].gy = [...(w[c].gy || []), ...mine]; }
  w.stack = [];
  if (by) w.lv = ids.map((id, i) => ({ id, to: "g", how: "d", by: typeof by === "function" ? by(id) : by, q: i + 1 }));
  return Object.assign(w, extra);
};

// the wipe: one wave from the caster's side in the cause's colour (baked death_wipe_<C>), aimed across the board at
// scale 2, then the cards' own deaths in the order the wave reaches them, 0.12 s apart, 8 at most; its cause flies no bolt
{
  const s0 = base(); s0.stack = [stackOf("c40", "Wrath of God", "White", "W", { sor: true })];
  const w = wiped(s0, ALL, "c40");
  const t = run([pools(12, 4), send(s0, "first board"), posOf(ALL), LIVES, POOLQ, send(w, "wipe", 200), POOLQ, LAST, LASTB]);
  ok("wave: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const q = t.all("poolq").map((s) => JSON.parse(s.value || "[]"));
  const p = fxPlayed(q[0], q[1]), pos = t.value("pos"), lives = t.value("lives");
  const wave = p[0];
  ok("wave: a wipe by a white spell plays the baked death_wipe_W first", wave && wave.name === "death_wipe_W" && !wave.bolt, JSON.stringify(p.map((x) => x.name)));
  ok("wave: from the caster's side (White's), not the active player's", wave && d2(wave, lives.White) < d2(wave, lives.Blue), JSON.stringify({ wave, lives }));
  ok("wave: aimed across the board (local +z at the table's centre), level, at scale 2", wave && ang(wave.ry, Math.atan2(-wave.x, -wave.z) * 180 / Math.PI) < 0.5 && Math.abs(wave.rx) < 0.01 && near(wave.s, 2), JSON.stringify(wave));
  const each = p.slice(1);
  ok("wave: then 8 of the 11 cards' own deaths (the cap), each at a card", each.length === 8 && each.every((x) => x.name === "death" && ALL.some((id) => near(x.x, pos[id].x) && near(x.z, pos[id].z))), JSON.stringify(each.map((x) => [x.name, x.x, x.z])));
  const gaps = each.map((x, i) => x.f - (i ? each[i - 1].f : wave.f));
  ok("wave: the first card 0.15 s after the wave, the rest 0.12 s apart", gaps.length === 8 && gaps[0] >= 8 && gaps[0] <= 10 && gaps.slice(1).every((g) => g >= 6 && g <= 8), JSON.stringify(gaps));
  const len = wave ? Math.hypot(wave.x, wave.z) : 1;
  const along = (x) => (x.x - wave.x) * (-wave.x / len) + (x.z - wave.z) * (-wave.z / len);
  ok("wave: the cards in the order the wave reaches them", each.every((x, i) => i === 0 || along(x) >= along(each[i - 1]) - 0.01), JSON.stringify(each.map(along)));
  const v = t.value("last");
  const wv = (v.fx || []).filter((e) => e.kind === "wave");
  ok("wave: engineFxLast has one wave in W, no old cloud and no slot", wv.length === 1 && wv[0].key === "W" && wv[0].rig === "death_wipe_W" && !(v.fx || []).some((e) => e.rig === "death_wipe" || e.slot !== undefined), JSON.stringify(v.fx));
  ok("wave: its cause flies no bolt", p.every((x) => !x.bolt) && arr(t.value("lastb")).length === 0, JSON.stringify(t.value("lastb")));
  ok("wave: every rig back under the table at scale 1 once it is over", q[1].every((r) => near(r.y, -30) && near(r.s, 1)), JSON.stringify(q[1].filter((r) => !near(r.y, -30) || !near(r.s, 1))));
}

// 6 rigs: the wave takes one, the cards' own deaths the other 5; the rest dropped (the wave stands for them)
{
  const s0 = base(); s0.stack = [stackOf("c40", "Wrath of God", "White", "W", { sor: true })];
  const t = run([pools(6, 0), send(s0, "first board"), POOLQ, send(wiped(s0, ALL, "c40"), "wipe", 150), POOLQ, LAST]);
  ok("wave, 6 rigs: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const q = t.all("poolq").map((s) => JSON.parse(s.value || "[]"));
  const p = fxPlayed(q[0], q[1]), v = t.value("last");
  ok("wave, 6 rigs: the wave and 5 deaths, 3 dropped", p.length === 6 && p[0].name === "death_wipe_W" && p.slice(1).every((x) => x.name === "death") && v.dropped === 3, JSON.stringify([p.map((x) => x.name), v.dropped]));
}

// the wave's colour and side: two colours or more gold (M), colourless C, none known B from the active player's side, a
// sweep's damage (hits) its source's colour with each card a burn, the commonest cause's colour, a spell gone from the
// stack when nothing names a cause
{
  const s0 = base();
  const three = ["b1", "b2", "b3"];
  const cases = [
    { name: "two colours", pre: [stackOf("c41", "Supreme Verdict", "White", "WU")], by: "c41", want: "death_wipe_M", side: "White", each: "death" },
    { name: "colourless", pre: [stackOf("c42", "Nevinyrral's Disk", "White", "C", { sp: false })], by: "c42", want: "death_wipe_C", side: "White", each: "death" },
    { name: "no cause known", pre: [], by: null, want: "death_wipe_B", side: "Blue", each: "death" },
    { name: "a sweep's damage", pre: [stackOf("c50", "Pyroclasm", "White", "R")], by: null, hits: three.map((id, i) => ({ src: "c50", to: id, n: 2, q: i + 1 })), want: "death_wipe_R", side: "White", each: "death_burn" },
    // (an ability's, its card on the battlefield and nothing on the stack: only the hits say whose)
    { name: "an ability's damage", pre: [], by: null, hits: three.map((id, i) => ({ src: "w2", to: id, n: 2, q: i + 1 })), want: "death_wipe_G", side: "White", each: "death_burn" },
    { name: "the commonest cause", pre: [stackOf("c40", "Wrath of God", "White", "W"), stackOf("c50", "Pyroclasm", "White", "R")], by: (id) => (id === "b3" ? "c50" : "c40"), want: "death_wipe_W", side: "White", each: "death" },
    { name: "a spell gone from the stack", pre: [stackOf("c50", "Pyroclasm", "White", "R")], by: null, want: "death_wipe_R", side: "White", each: "death" },
  ];
  const steps = [pools(12, 4), send(s0, "first board"), LIVES];
  for (const c of cases) {
    const pre = clone(s0); pre.stack = c.pre;
    steps.push(send(pre, `pre ${c.name}`, 10), POOLQ, send(wiped(pre, three, c.by, c.hits ? { hits: c.hits } : {}), c.name, 150), POOLQ, send(s0, `back ${c.name}`, 30));
  }
  const t = run(steps);
  ok("wave colours: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const q = t.all("poolq").map((s) => JSON.parse(s.value || "[]")), lives = t.value("lives");
  cases.forEach((c, i) => {
    const p = fxPlayed(q[2 * i], q[2 * i + 1]);
    const other = c.side === "White" ? "Blue" : "White";
    ok(`wave colours, ${c.name}: ${c.want} from ${c.side}'s side, then each card's ${c.each}`, p.length === 4 && p[0].name === c.want && d2(p[0], lives[c.side]) < d2(p[0], lives[other])
      && p.slice(1).every((x) => x.name === c.each && !x.bolt), JSON.stringify(p.map((x) => x.name)));
  });
}

// engineFxTint (the host's flag for the live tint check): the neutral wipe_wave tinted in the cause's colour, and the
// neutral exile in its exiler's; scale and tint back to 1 and white when a rig is parked
{
  const s0 = base(); s0.stack = [stackOf("c40", "Wrath of God", "White", "W", { sor: true })];
  const back = base();
  const ex = clone(back); ex.Blue.bf = ex.Blue.bf.filter((c) => c !== "b1"); ex.Blue.ex = ["b1"]; ex.lv = [{ id: "b1", to: "e", by: "w2", q: 1 }];
  const t = run([pools(6, 4, "engineFxTint = true"), send(s0, "first board"), POOLQ, send(wiped(s0, ALL, "c40"), "wipe", 150), POOLQ,
    send(back, "back", 30), POOLQ, send(ex, "exile", 150), POOLQ]);
  ok("tint: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const q = t.all("poolq").map((s) => JSON.parse(s.value || "[]"));
  const near3 = (x, rgb) => !!x && near(x.tr, rgb[0]) && near(x.tg, rgb[1]) && near(x.tb, rgb[2]);
  const p = fxPlayed(q[0], q[1]);
  ok("tint: the wipe plays the neutral wipe_wave tinted white's gold-white", p[0] && p[0].name === "wipe_wave" && near3(p[0], [0.95, 0.82, 0.48]) && near(p[0].s, 2), JSON.stringify(p[0]));
  ok("tint: the cards' own deaths untinted", p.slice(1).length === 5 && p.slice(1).every((x) => x.name === "death" && near3(x, [1, 1, 1])), JSON.stringify(p.slice(1).map((x) => [x.name, x.tr])));
  ok("tint: parked rigs are back at scale 1 and white", q[1].every((r) => near(r.y, -30) && near(r.s, 1) && near3(r, [1, 1, 1])), JSON.stringify(q[1].filter((r) => !near(r.s, 1) || !near3(r, [1, 1, 1]))));
  const e = fxPlayed(q[2], q[3]).filter((x) => !x.bolt);
  ok("tint: an exile by a green card plays exile_neutral tinted green", e.length === 1 && e[0].name === "exile_neutral" && near3(e[0], [0.56, 0.89, 0.42]), JSON.stringify(e));
}

// "mtg fx low" (the host's): a wipe's wave without its cards' own effects, no bolts, single effects as on; only the
// host may set it, and it is saved with the game
{
  const s0 = base(); s0.stack = [stackOf("c40", "Wrath of God", "White", "W", { sor: true })];
  const back = base(); back.stack = [stackOf("c30", "Lightning Bolt", "White", "R", { ins: true })];
  const hit = base(); hit.White.more.w1 = { dmg: 3 }; hit.hits = [{ src: "c30", to: "w1", n: 3, q: 1 }];
  const healed = base();
  const die = clone(healed); die.Blue.bf = die.Blue.bf.filter((c) => c !== "b1"); die.Blue.gy = ["b1"]; die.lv = [{ id: "b1", to: "g", how: "d", by: "w2", q: 1 }];
  const ex = clone(die); ex.Blue.bf = ex.Blue.bf.filter((c) => c !== "b2"); ex.Blue.ex = ["b2"]; ex.lv = [{ id: "b2", to: "e", by: "w2", q: 1 }];
  const t = run([lua(`__sim.seated.White = true return "x"`, "seat"), pools(6, 4),
    lua(`engineChat("mtg fx low", Player.White) local a = engineFxMode engineChat("mtg fx low", Player.Blue) return JSON.encode({ guest = a, host = engineFxMode, saved = JSON.decode(onSave()).engineFx })`, "modes", 1),
    send(s0, "first board"), POOLQ, send(wiped(s0, ALL, "c40"), "wipe", 150), POOLQ, send(back, "back", 30), POOLQ, send(hit, "hit", 150), POOLQ, LASTB,
    send(healed, "healed", 30), POOLQ, send(die, "death", 150), POOLQ, send(ex, "exile", 150), POOLQ]);
  ok("low: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const m = t.value("modes");
  ok("low: a guest can't set it, the host can, and it is in the save", m.guest === "on" && m.host === "low" && m.saved === "low", JSON.stringify(m));
  ok("low: the guest is told only the host can", t.fx("modes").some((l) => l.includes("Only the host can change the table's particle effects")), JSON.stringify(t.fx("modes").filter((l) => l.includes("broadcast"))));
  const q = t.all("poolq").map((s) => JSON.parse(s.value || "[]"));
  ok("low: a wipe plays its wave only", JSON.stringify(fxPlayed(q[0], q[1]).map((x) => x.name)) === '["death_wipe_W"]', JSON.stringify(fxPlayed(q[0], q[1]).map((x) => x.name)));
  const h = fxPlayed(q[2], q[3]);
  ok("low: a bolt's hit flies no bolt, its damage at once", JSON.stringify(h.map((x) => x.name)) === '["damage"]' && arr(t.value("lastb")).length === 0, JSON.stringify(h.map((x) => [x.name, x.f])));
  ok("low: a single death and a single exile as on (no exile light)", JSON.stringify(fxPlayed(q[4], q[5]).map((x) => x.name)) === '["death"]' && JSON.stringify(fxPlayed(q[5], q[6]).map((x) => x.name)) === '["exile"]',
    JSON.stringify([fxPlayed(q[4], q[5]).map((x) => x.name), fxPlayed(q[5], q[6]).map((x) => x.name)]));
}

// the saved "mtg fx" comes back with the save
{
  const r = simulate({ save, prelude: `rawset(Global, "script_state", '{"engineStash":{},"engineFx":"off"}')`, steps: [lua(`return tostring(engineFxMode)`, "mode", 1)] });
  const bad = simulate({ save, prelude: `rawset(Global, "script_state", '{"engineFx":"loud"}')`, steps: [lua(`return tostring(engineFxMode)`, "mode", 1)] });
  ok("fx mode saved: restored from the save", r.steps.find((s) => s.step === "mode")?.value === "off", JSON.stringify(r.errors.slice(0, 2)));
  ok("fx mode saved: a word it doesn't know leaves it on", bad.steps.find((s) => s.step === "mode")?.value === "on", JSON.stringify(bad.errors.slice(0, 2)));
}

// "mtg fx off" = the table without the bundle: with both pools and both links on the table, every board does exactly
// what it does with no rig and no link (the same calls, the same engineFxLast), no AssetBundle call, nothing spawned
{
  const s0 = base(); s0.stack = [stackOf("c40", "Wrath of God", "White", "W", { sor: true })];
  const back = base(); back.stack = [stackOf("c30", "Lightning Bolt", "White", "R", { ins: true })];
  const hit = base(); hit.White.more.w1 = { dmg: 3 }; hit.hits = [{ src: "c30", to: "w1", n: 3, q: 1 }];
  const healed = base();
  const die = clone(healed); die.Blue.bf = die.Blue.bf.filter((c) => c !== "b1"); die.Blue.gy = ["b1"]; die.lv = [{ id: "b1", to: "g", how: "d", by: "w2", q: 1 }];
  const ex = clone(die); ex.Blue.bf = ex.Blue.bf.filter((c) => c !== "b2"); ex.Blue.ex = ["b2"]; ex.lv = [{ id: "b2", to: "e", by: "w2", q: 1 }];
  const boards = [send(s0, "first board"), send(wiped(s0, ALL, "c40"), "wipe", 150), LAST, send(back, "back", 30), send(hit, "hit", 150), LAST,
    send(healed, "healed", 30), send(die, "death", 150), LAST, send(ex, "exile", 150), LAST];
  // (pools short of FX.RIGS and FX.BOLTS, with links: "on" would top them up)
  const off = run([pools(4, 2, `engineFxBundle = { fx = "https://example.invalid/fx2.unity3d", bolt = "https://example.invalid/bolt2.unity3d" }`), lua(`engineChat("mtg fx off", Player.Blue) return engineFxMode`, "off", 1), ...boards]);
  const none = run([lua(`return "pad"`, "pad"), lua(`engineFxBundle = { fx = nil, sounds = nil, bolt = nil } return "off"`, "off", 1), ...boards]); // (pad: the frames the pools took)
  ok("fx off: the scripts ran", !off.r.errors.length && !none.r.errors.length && off.step("off").value === "off", [...off.r.errors, ...none.r.errors].slice(0, 2).join(" | "));
  ok("fx off: no AssetBundle call, nothing spawned", off.r.steps.every((s) => abLines(s.fx || []).length === 0 && !(s.fx || []).some((l) => l.includes('"spawnObjectData" "Custom_Assetbundle"'))),
    JSON.stringify(off.r.steps.flatMap((s) => abLines(s.fx || [])).slice(0, 3)));
  const marks = ["wipe", "back", "hit", "healed", "death", "exile"];
  const diff = marks.filter((mk) => JSON.stringify(off.fx(mk)) !== JSON.stringify(none.fx(mk)));
  ok("fx off: every board's calls the same as with no bundle", diff.length === 0, diff.map((mk) => {
    const a = off.fx(mk), b = none.fx(mk); const i = a.findIndex((l, k) => l !== b[k]); return `${mk}: ${a[i]} vs ${b[i]}`; }).join(" | "));
  ok("fx off: engineFxLast the same each board", JSON.stringify(off.all("last").map((s) => s.value)) === JSON.stringify(none.all("last").map((s) => s.value)),
    JSON.stringify([off.all("last").map((s) => s.value), none.all("last").map((s) => s.value)]).slice(0, 400));
  ok("fx off: the rigs never leave the park", !off.r.steps.some((s) => (s.fx || []).some((l) => /"setPosition" obj:(rig|blt)\d/.test(l))));
}
// "mtg fx off" reads no lv: a token the engine says went to a hand, and one it says was exiled (no exd, not in an
// exile zone), die as they did on the table before lv; with effects on, neither is a death (the boards tell apart)
{
  const s0 = base(); s0.Blue.bf.push("tok1");
  const home = base(); home.lv = [{ id: "tok1", to: "h", q: 1 }];
  const gone = base(); gone.lv = [{ id: "tok1", to: "e", q: 1 }];
  const boards = (lv) => [send(s0, "first board"), send(lv ? home : { ...home, lv: undefined }, "home", 60), LAST, send(s0, "back", 30), send(lv ? gone : { ...gone, lv: undefined }, "gone", 60), LAST];
  const noLinks = lua(`engineFxBundle = { fx = nil, sounds = nil, bolt = nil } return "x"`, "links", 1);
  const off = run([noLinks, lua(`engineChat("mtg fx off", Player.Blue) return engineFxMode`, "off", 1), ...boards(true)]);
  const today = run([noLinks, lua(`return "pad"`, "off", 1), ...boards(false)]);
  const on = run([noLinks, lua(`return "pad"`, "off", 1), ...boards(true)]);
  const died = (t) => t.all("last").map((s) => JSON.parse(s.value || "{}").died || {});
  ok("fx off, lv: the scripts ran", !off.r.errors.length && !today.r.errors.length && !on.r.errors.length, [...off.r.errors, ...today.r.errors, ...on.r.errors].slice(0, 2).join(" | "));
  ok("fx off, lv: the token home and the token exiled each die, as before lv", JSON.stringify(died(off)) === '[{"Blue":1},{"Blue":1}]' && JSON.stringify(died(off)) === JSON.stringify(died(today)),
    JSON.stringify([died(off), died(today)]));
  ok("fx off, lv: the same calls as the table before lv", ["home", "gone"].every((mk) => JSON.stringify(off.fx(mk)) === JSON.stringify(today.fx(mk))), ["home", "gone"].map((mk) => off.fx(mk).length + "/" + today.fx(mk).length).join(" "));
  ok("fx off, lv: effects on, neither is a death", died(on).length === 2 && died(on).every((d) => Object.keys(d).length === 0), JSON.stringify(died(on)));
}

// the bolts: from where a spell stood on the stack (an ability: its card) to its target, aimed (local +z at it) and
// scaled to the distance, in the source's colour (bolt_<C>; colourless, two colours or unknown: the red-orange bolt);
// the target's effect at the impact, 0.25 s after the bolt; 4 a board at most (the rest: their effects at once); a
// sweep (a source with more than 4 hits), combat damage and a board without hits fly none; an exile's light to its
// exiler; a token that went back to a hand is no death
{
  const L = { life: 37 }; // (Blue's life stays down after the player hit: a gain would play its own effect)
  const plain = (st = {}) => { const b = base(); b.Blue.life = st.life ?? 40; if (st.stack) b.stack = st.stack; return b; };
  const dmg = (b, map) => { for (const [id, n] of Object.entries(map)) { const c = id.startsWith("w") ? "White" : "Blue"; b[c].more[id] = { dmg: n }; } return b; };
  const hitsOf = (list) => list.map(([src, to, n], i) => ({ src, to, n, q: i + 1 }));
  const pre1 = plain({ stack: [stackOf("c30", "Lightning Bolt", "White", "R", { ins: true })] });
  const hit1 = Object.assign(dmg(plain(), { w1: 3 }), { hits: hitsOf([["c30", "w1", 3]]) });
  const hit2 = Object.assign(plain(L), { hits: hitsOf([["w2", "Blue", 3]]) });
  const die3 = Object.assign(plain(L), { hits: hitsOf([["w2", "b1", 2]]), lv: [{ id: "b1", to: "g", how: "d", by: "w2", q: 2 }] }); die3.Blue.bf = die3.Blue.bf.filter((c) => c !== "b1"); die3.Blue.gy = ["b1"];
  const cap = Object.assign(dmg(plain(L), { b2: 1, b3: 1, b4: 1, b5: 1, b6: 5, b7: 5 }), { hits: hitsOf([["w2", "b2", 1], ["w2", "b3", 1], ["w2", "b4", 1], ["w3", "b5", 1], ["w3", "b6", 5], ["w3", "b7", 5]]) });
  const sweep = Object.assign(dmg(plain(L), { b2: 1, b3: 1, b4: 1, b5: 1, b6: 1 }), { hits: hitsOf([["w2", "b2", 1], ["w2", "b3", 1], ["w2", "b4", 1], ["w2", "b5", 1], ["w2", "b6", 1]]) });
  const multi = Object.assign(dmg(plain(L), { b2: 2 }), { hits: hitsOf([["w4", "b2", 2]]) });
  const preC = plain({ life: 37, stack: [stackOf("c60", "Kozilek's Return", "White", "C", { ins: true })] });
  const colourless = Object.assign(dmg(plain(L), { b3: 2 }), { hits: hitsOf([["c60", "b3", 2]]) });
  const combat = Object.assign(dmg(plain(L), { b4: 2 }), { hits: [{ src: "w1", to: "b4", n: 2, q: 1, combat: true }] });
  const noHits = dmg(plain(L), { b5: 2 });
  const exile = plain(L); exile.Blue.bf = exile.Blue.bf.filter((c) => c !== "b2"); exile.Blue.ex = ["b2"]; exile.lv = [{ id: "b2", to: "e", by: "w2", q: 1 }];
  const withTok = plain(L); withTok.Blue.bf.push("tok1");
  const tokHome = plain(L); tokHome.lv = [{ id: "tok1", to: "h", q: 1 }];
  const tokGone = plain(L);
  // (a face-down creature's ability: its card's colour, green, known from when it was face up, is not told)
  const fdPre = plain(L); fdPre.White.more.w2 = { fd: true };
  const fdHit = Object.assign(dmg(plain(L), { b3: 1 }), { hits: hitsOf([["w2", "b3", 1]]) }); fdHit.White.more.w2 = { fd: true };
  const t = run([pools(6, 6),
    send(pre1, "first board", 10), send(pre1, "bolt on the stack", 10), POOLQ, posOf(["w1", "w2", "w3", "b1", "b2", "b3", "b6", "b7"]),
    lua(`local p = engineFxStackSpot["engine-stack-c30"] return p and JSON.encode({ x = p.x, y = p.y, z = p.z }) or "{}"`, "stack spot", 1),
    send(hit1, "spell hit", 150), POOLQ, LASTB, send(plain(), "c1", 30), POOLQ,
    send(hit2, "player hit", 150), POOLQ, send(plain(L), "c2", 30), POOLQ,
    send(die3, "burn", 150), POOLQ, send(plain(L), "c3", 30), POOLQ,
    send(cap, "cap", 150), POOLQ, LASTB, send(plain(L), "c4", 30), POOLQ,
    send(sweep, "sweep", 150), POOLQ, send(plain(L), "c5", 30), POOLQ,
    send(multi, "multicoloured", 150), POOLQ, send(preC, "c6", 30), POOLQ,
    send(colourless, "colourless", 150), POOLQ, send(plain(L), "c7", 30), POOLQ,
    send(combat, "combat", 150), POOLQ, send(plain(L), "c8", 30), POOLQ,
    send(noHits, "no hits", 150), POOLQ, send(plain(L), "c9", 30), POOLQ,
    send(exile, "exile", 150), POOLQ, send(withTok, "c10", 30), POOLQ,
    send(tokHome, "token home", 150), POOLQ, LAST, send(withTok, "c11", 30), POOLQ, send(tokGone, "token gone", 150), POOLQ, LAST,
    send(fdPre, "c12", 30), POOLQ, send(fdHit, "face down", 150), POOLQ,
  ]);
  ok("bolts: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const q = t.all("poolq").map((s) => JSON.parse(s.value || "[]"));
  const at = (k) => fxPlayed(q[k], q[k + 1]); // (board k's: between POOLQ k and k + 1)
  const pos = t.value("pos"), spot = t.value("stack spot"), lb = t.all("lastb").map((s) => arr(JSON.parse(s.value || "[]")));
  // a spell's bolt
  const p1 = at(0), b1 = p1.find((x) => x.bolt), d1 = p1.find((x) => x.name === "damage");
  ok("bolt, a spell: bolt_R (a red source) on a bolt rig", p1.filter((x) => x.bolt).length === 1 && b1.name === "bolt_R", JSON.stringify(p1.map((x) => x.name)));
  ok("bolt, a spell: from its spot on the stack", b1 && spot.x !== undefined && near(b1.x, spot.x) && near(b1.z, spot.z) && near(b1.y, spot.y + 0.3), JSON.stringify({ b1, spot }));
  ok("bolt, a spell: the target's damage at its card", d1 && near(d1.x, pos.w1.x) && near(d1.z, pos.w1.z), JSON.stringify({ d1, w1: pos.w1 }));
  ok("bolt, a spell: aimed at the target and scaled to the distance", aimed(b1, d1), JSON.stringify({ b1, d1, want: d1 && b1 && aimOf(b1, d1) }));
  ok("bolt, a spell: the damage 0.25 s after the bolt (the impact)", b1 && d1 && d1.f - b1.f >= 14 && d1.f - b1.f <= 16, JSON.stringify([b1 && b1.f, d1 && d1.f]));
  ok("bolt, a spell: engineFxLast.bolts says so", lb[0].length === 1 && lb[0][0].name === "bolt_R" && lb[0][0].tgt === "w1" && b1 && Math.abs(lb[0][0].d - b1.s) < 0.01, JSON.stringify(lb[0]));
  ok("bolt: the rig parked again at scale 1", q[1].every((r) => near(r.y, -30) && near(r.s, 1)), JSON.stringify(q[1].filter((r) => !near(r.s, 1))));
  // an ability's bolt at a player
  const p2 = at(2), b2 = p2.find((x) => x.bolt), h2 = p2.find((x) => x.name === "player_hit");
  ok("bolt, an ability at a player: bolt_G from its green source card to the player's spot", b2 && b2.name === "bolt_G" && near(b2.x, pos.w2.x) && near(b2.z, pos.w2.z) && aimed(b2, h2), JSON.stringify({ b2, h2, w2: pos.w2 }));
  ok("bolt, an ability at a player: player_hit at the impact", b2 && h2 && h2.f - b2.f >= 14 && h2.f - b2.f <= 16, JSON.stringify([b2 && b2.f, h2 && h2.f]));
  // a death by a bolt
  const p3 = at(4), b3 = p3.find((x) => x.bolt), k3 = p3.find((x) => !x.bolt);
  ok("bolt, a death from it: death_burn at the card, at the impact", b3 && k3 && k3.name === "death_burn" && near(k3.x, pos.b1.x) && k3.f - b3.f >= 14, JSON.stringify(p3.map((x) => [x.name, x.f])));
  // the cap
  const p4 = at(6), bolts4 = p4.filter((x) => x.bolt), dm4 = p4.filter((x) => !x.bolt);
  ok("bolt cap: 4 bolts of 6 hits, in Forge's order (3 green, then the colourless source's red-orange)", JSON.stringify(bolts4.map((x) => x.name)) === '["bolt_G","bolt_G","bolt_G","bolt"]' && lb[1].length === 4, JSON.stringify([bolts4.map((x) => x.name), lb[1].length]));
  ok("bolt cap: 0.15 s apart", bolts4.length === 4 && bolts4.every((x, i) => i === 0 || (x.f - bolts4[i - 1].f >= 8 && x.f - bolts4[i - 1].f <= 10)), JSON.stringify(bolts4.map((x) => x.f)));
  const atCard = (id) => dm4.find((x) => near(x.x, pos[id].x) && near(x.z, pos[id].z));
  ok("bolt cap: the hits past the cap have their effect at once (no bolt to wait for)", atCard("b6") && atCard("b7") && bolts4[0] && atCard("b6").f <= bolts4[0].f + 1 && atCard("b7").f <= bolts4[0].f + 1, JSON.stringify(dm4.map((x) => [x.x, x.f])));
  ok("bolt cap: a bolted card's effect waits for its impact", atCard("b2") && bolts4[0] && atCard("b2").f - bolts4[0].f >= 14, JSON.stringify(dm4.map((x) => [x.x, x.f])));
  ok("bolt sweep: a source with 5 hits flies none", at(8).filter((x) => x.bolt).length === 0 && at(8).length > 0, JSON.stringify(at(8).map((x) => x.name)));
  ok("bolt, a source of two colours: the red-orange bolt", JSON.stringify(at(10).filter((x) => x.bolt).map((x) => x.name)) === '["bolt"]', JSON.stringify(at(10).map((x) => x.name)));
  ok("bolt, a colourless spell: the red-orange bolt", JSON.stringify(at(12).filter((x) => x.bolt).map((x) => x.name)) === '["bolt"]', JSON.stringify(at(12).map((x) => x.name)));
  ok("bolt, combat damage: none (the swing shows it)", at(14).filter((x) => x.bolt).length === 0 && at(14).some((x) => x.name === "damage"), JSON.stringify(at(14).map((x) => x.name)));
  ok("bolt, a board with no hits (an older engine): none, the damage as before", JSON.stringify(at(16).map((x) => x.name)) === '["damage"]', JSON.stringify(at(16).map((x) => x.name)));
  const p9 = at(18), ex9 = p9.find((x) => x.name === "exile"), fl9 = p9.find((x) => x.bolt);
  ok("exile light: exile at the card, then bolt_G (its green exiler's colour) flies to the exiler", ex9 && fl9 && fl9.name === "bolt_G" && near(fl9.x, pos.b2.x) && near(fl9.z, pos.b2.z)
    && ang(fl9.ry, Math.atan2(pos.w2.x - fl9.x, pos.w2.z - fl9.z) * 180 / Math.PI) < 0.5 && Math.abs(fl9.s - d2(fl9, pos.w2)) < 0.2,
    JSON.stringify({ p9, w2: pos.w2 }));
  ok("exile light: 0.7 s after the exile", ex9 && fl9 && fl9.f - ex9.f >= 40 && fl9.f - ex9.f <= 44, JSON.stringify([ex9 && ex9.f, fl9 && fl9.f]));
  const lasts = t.all("last").map((s) => JSON.parse(s.value || "{}"));
  ok("token home: a token the engine says went to a hand is no death", at(20).length === 0 && Object.keys(lasts[0].died || {}).length === 0, JSON.stringify([at(20), lasts[0]]));
  ok("token gone: one that just left the battlefield still dies", at(22).some((x) => x.name === "death") && (lasts[1].died || {}).Blue === 1, JSON.stringify([at(22), lasts[1]]));
  ok("bolt, a face-down source: the red-orange bolt, not its card's green", JSON.stringify(at(24).filter((x) => x.bolt).map((x) => x.name)) === '["bolt"]', JSON.stringify(at(24).map((x) => x.name)));
}

// engineFxBoltMove (the fallback, should the bundle's flight not play): bolt_trail at scale 1, the rig moved to the
// target one frame at a time (15), then bolt_impact there
{
  const pre = base(); pre.stack = [stackOf("c30", "Lightning Bolt", "White", "R", { ins: true })];
  const hit = base(); hit.White.more.w1 = { dmg: 3 }; hit.hits = [{ src: "c30", to: "w1", n: 3, q: 1 }];
  const t = run([pools(2, 2, "engineFxBoltMove = true"), send(pre, "first board", 10), send(pre, "again", 10), POOLQ, posOf(["w1"]), send(hit, "hit", 150), POOLQ]);
  ok("bolt fallback: the script ran", !t.r.errors.length, t.r.errors.slice(0, 2).join(" | "));
  const q = t.all("poolq").map((s) => JSON.parse(s.value || "[]"));
  const p = fxPlayed(q[0], q[1]), tr = p.find((x) => x.name === "bolt_trail"), im = p.find((x) => x.name === "bolt_impact"), w1 = t.value("pos").w1;
  const g = tr && tr.g;
  const moves = t.fx("hit").filter((l) => g && l.includes(`"setPosition" obj:${g} `));
  ok("bolt fallback: bolt_trail at scale 1, then bolt_impact at the target", tr && im && near(tr.s, 1) && im.g === g && near(im.x, w1.x) && near(im.z, w1.z), JSON.stringify(p));
  ok("bolt fallback: moved over 15 frames (one setPosition a frame), the impact after", moves.length >= 16 && im && im.f - tr.f >= 15 && im.f - tr.f <= 17, JSON.stringify([moves.length, tr && tr.f, im && im.f]));
}

// the links: with no bolt link (not uploaded yet) no bolt rig is spawned and a bolt's hit has its effect at once; with
// it, the missing bolt rigs (4) are spawned once, a row behind the fx rigs, and fly; 4 fx rigs on the table are topped
// up to 6
{
  const FXL = "https://example.invalid/mtg-fx.unity3d", BL = "https://example.invalid/mtg-bolt.unity3d";
  const pre = base(); pre.stack = [stackOf("c30", "Lightning Bolt", "White", "R", { ins: true })];
  const hit = base(); hit.White.more.w1 = { dmg: 3 }; hit.hits = [{ src: "c30", to: "w1", n: 3, q: 1 }];
  const count = lua(`local out = { fx = 0, bolt = 0, boltZ = {} } for _, o in ipairs(getObjects()) do local gm = o.getGMNotes()
    if gm == "engine:fx" then out.fx = out.fx + 1 elseif gm == "engine:bolt" then out.bolt = out.bolt + 1 out.boltZ[#out.boltZ + 1] = o.getPosition().z end end return JSON.encode(out)`, "count", 1);
  const bundles = `__sim.bundleEffects = { ["${FXL}"] = { "${FX_NAMES.join('", "')}" }, ["${BL}"] = { "${BOLT_NAMES.join('", "')}" } }`;
  const nil = run([lua(`${bundles} engineFxBundle = { fx = "${FXL}", sounds = nil, bolt = nil } return "x"`, "links"), send(pre, "first board", 10), count, POOLQ, send(hit, "hit", 150), POOLQ, LASTB]);
  ok("no bolt link: the script ran", !nil.r.errors.length, nil.r.errors.slice(0, 2).join(" | "));
  const c0 = nil.value("count");
  ok("no bolt link: 6 fx rigs spawned, no bolt rig", c0.fx === 6 && c0.bolt === 0, JSON.stringify(c0));
  const q0 = nil.all("poolq").map((s) => JSON.parse(s.value || "[]"));
  ok("no bolt link: the hit's damage at once, no bolt", JSON.stringify(fxPlayed(q0[0], q0[1]).map((x) => x.name)) === '["damage"]' && arr(nil.value("lastb")).every((b) => b.name == null),
    JSON.stringify([fxPlayed(q0[0], q0[1]).map((x) => x.name), nil.value("lastb")]));
  // (rigs of this very link, its memo: else they would be an older bundle's, replaced; see the next block)
  const up = run([pools(4, 0, `for _, o in ipairs(getObjects()) do if o.getGMNotes() == "engine:fx" then o.memo = "${FXL}" end end`), lua(`${bundles} engineFxBundle = { fx = "${FXL}", sounds = nil, bolt = "${BL}" } return "x"`, "links"), send(pre, "first board", 10), count, POOLQ, send(hit, "hit", 150), POOLQ,
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 30, mark: "clear" }, { msg: { t: "started", json: STARTED }, mark: "started 2" }, send(pre, "second game", 10), count]);
  ok("bolt link: the script ran", !up.r.errors.length, up.r.errors.slice(0, 2).join(" | "));
  const [c1, c2] = up.all("count").map((s) => JSON.parse(s.value || "{}"));
  ok("bolt link: 4 fx rigs topped up to 6, 4 bolt rigs spawned a row behind", c1.fx === 6 && c1.bolt === 4 && arr(c1.boltZ).every((z) => near(z, 32)), JSON.stringify(c1));
  const q1 = up.all("poolq").map((s) => JSON.parse(s.value || "[]"));
  ok("bolt link: a spawned bolt rig flies bolt_R", fxPlayed(q1[0], q1[1]).some((x) => x.bolt && x.name === "bolt_R"), JSON.stringify(fxPlayed(q1[0], q1[1]).map((x) => x.name)));
  ok("bolt link: the next game spawns none", c2.fx === 6 && c2.bolt === 4, JSON.stringify(c2));
}

// a save holding rigs of an older bundle (the user's: 6 "engine:fx" rigs spawned before the memo, from the shipped
// link, so with none): a new fx link replaces them on load, one destroyed every 30 frames (a destruct costs ~360 ms in
// real TTS) and 6 spawned with the link in their memo; a game after that and the next load (the new rigs saved) touch
// none. The shipped link, no link or "mtg fx off" touch none either.
{
  const LEGACY = (save.LuaScript.match(/FX\.LEGACY = \{ fx = "([^"]+)" \}/) || [])[1];
  const NEW = "https://example.invalid/mtg-fx-2.unity3d";
  const withRigs = (memo) => {
    const s = clone(save);
    for (let i = 1; i <= 6; i++) s.ObjectStates.push({ Name: "Custom_Assetbundle", GUID: `old00${i}`, Nickname: "", GMNotes: "engine:fx", Locked: true, ...(memo ? { Memo: memo } : {}),
      Transform: { posX: -40 + 1.5 * i, posY: -30, posZ: 30, rotX: 0, rotY: 0, rotZ: 0, scaleX: 1, scaleY: 1, scaleZ: 1 },
      CustomAssetbundle: { AssetbundleURL: memo || LEGACY, SimTriggerEffects: FX_NAMES } });
    return s;
  };
  const Q = (mark) => lua(`local out = { alive = {}, died = {} } for _, o in ipairs(getObjects()) do if o.getGMNotes() == "engine:fx" then out.alive[#out.alive + 1] = { g = o.getGUID(), memo = o.memo or "" } end end
    for i = 1, 6 do local o = __sim.objects["old00" .. i] out.died[i] = (o and o.__d.diedAt) or 0 end return JSON.encode(out)`, mark, 1);
  const go = (s, prelude) => {
    const r = simulate({ save: s, prelude: `__sim.bundleEffects = { ["${NEW}"] = { "${FX_NAMES.join('", "')}" } } ${prelude}`,
      steps: [Q("q0"), { frames: 300 }, Q("q1"), lua(PRELUDE, "prelude"), { msg: { t: "started", json: STARTED } }, send(base(), "first board", 10), { frames: 250 }, Q("q2")] }); // (250: a destruct the game's look scheduled has come)
    const val = (mark) => JSON.parse(r.steps.find((x) => x.step === mark)?.value || "{}");
    const spawns = r.steps.map((x) => (x.fx || []).filter((l) => l.includes('"spawnObjectData" "Custom_Assetbundle"')).length);
    return { r, q0: val("q0"), q1: val("q1"), q2: val("q2"), spawns, gameSpawns: spawns[r.steps.findIndex((x) => x.step === "first board")] };
  };
  ok("stale rigs: the legacy link is a steamusercontent link", /^https:\/\/steamusercontent/.test(LEGACY || ""), LEGACY);
  const a = go(withRigs(null), `engineFxBundle = { fx = "${NEW}" }`);
  ok("stale rigs: the script ran", !a.r.errors.length, a.r.errors.slice(0, 2).join(" | "));
  const died = arr(a.q1.died).slice().sort((x, y) => x - y);
  ok("stale rigs, a new link: the 6 old rigs destroyed on load", died.length === 6 && died.every((f) => f > 0) && arr(a.q1.alive).every((x) => !x.g.startsWith("old")), JSON.stringify(a.q1));
  ok("stale rigs, a new link: one destroyed every 30 frames, none at once", died.every((f, i) => i === 0 || f - died[i - 1] >= 30) && arr(a.q0.alive).filter((x) => x.g.startsWith("old")).length >= 5,
    JSON.stringify({ died, q0: arr(a.q0.alive).length }));
  ok("stale rigs, a new link: 6 rigs spawned in their place, marked with the link", a.spawns.reduce((x, y) => x + y, 0) === 6 && arr(a.q1.alive).length === 6 && arr(a.q1.alive).every((x) => x.memo === NEW),
    JSON.stringify({ spawns: a.spawns, alive: a.q1.alive }));
  ok("stale rigs, a new link: the game after that spawns and destroys none", a.gameSpawns === 0 && JSON.stringify(a.q2.alive) === JSON.stringify(a.q1.alive) && JSON.stringify(a.q2.died) === JSON.stringify(a.q1.died),
    JSON.stringify({ g: a.gameSpawns, q2: a.q2 }));
  const none = (name, s, prelude) => {
    const x = go(s, prelude);
    ok(`stale rigs, ${name}: none destroyed, none spawned, on load or at the game`, !x.r.errors.length && x.spawns.every((n) => n === 0) && arr(x.q2.died).every((f) => f === 0) && arr(x.q2.alive).length === 6,
      JSON.stringify({ e: x.r.errors.slice(0, 1), spawns: x.spawns, q2: x.q2 }));
  };
  none("the next load (the new rigs saved with their memo)", withRigs(NEW), `engineFxBundle = { fx = "${NEW}" }`);
  none("the legacy link (rigs with no memo are its own)", withRigs(null), `engineFxBundle = { fx = "${LEGACY}" }`);
  // since 2026-11-12 night the shipped fx link is mtg-fx2's, not the legacy one: the user's memo-less rigs are renewed
  const shippedFx = (save.LuaScript.match(/engineFxBundle = engineFxBundle or \{ fx = "([^"]+)"/) || [])[1];
  ok("stale rigs: the shipped fx link is not the legacy one (the old rigs in a save are renewed)", /^https:\/\/steamusercontent/.test(shippedFx || "") && shippedFx !== LEGACY, JSON.stringify({ shippedFx, LEGACY }));
  none("no link", withRigs(null), `engineFxBundle = { fx = "" }`);
  none("mtg fx off", withRigs(null), `engineFxBundle = { fx = "${NEW}" } rawset(Global, "script_state", '{"engineStash":{},"engineFx":"off"}')`);
}

// the host's Lua per board (fengari's own clock, docs/particle-fx-spec.md section 5: under 5 ms): engineEffects and
// every Wait it schedules, for a 20-creature wipe and a board of 4 bolts, effects on and off
{
  const xs = Array.from({ length: 8 }, (_, i) => card(`x${i + 1}`, `Elk ${i + 1}`, ["Creature"]));
  const big = () => { const b = base(); b.Blue.bf = [...blueC, xs[0], xs[1], "bl1"]; b.White.bf = [...whiteC, ...xs.slice(2), "wl1"]; return b; };
  const twenty = [...blueC, xs[0], xs[1], ...whiteC, ...xs.slice(2)];
  const s0 = big(); s0.stack = [stackOf("c40", "Wrath of God", "White", "W", { sor: true })];
  const w = wiped(s0, twenty, "c40");
  const pre = big(); pre.stack = [stackOf("c30", "Lightning Bolt", "White", "R", { ins: true })];
  const four = big(); four.hits = [["c30", "b1"], ["w2", "b2"], ["w2", "b3"], ["w3", "b4"]].map(([src, to], i) => ({ src, to, n: 1, q: i + 1 }));
  for (const id of ["b1", "b2", "b3", "b4"]) four.Blue.more[id] = { dmg: 1 };
  // (all: engineEffects and every Wait it schedules; fx: engineFxBoard and its Waits, the effects' own share)
  const TIMED = lua(`__fxT = { all = 0, fx = 0 } local active = {}
    local function timed(fn, keys) return function(...)
      local mine = {} for k in pairs(keys) do if not active[k] then mine[k] = true active[k] = true end end
      local t = __realclock() local a, b, c = fn(...) local d = (__realclock() - t) * 1000
      for k in pairs(mine) do __fxT[k] = __fxT[k] + d active[k] = nil end return a, b, c end end
    local function cur() local s = {} for k in pairs(active) do s[k] = true end return s end
    local wt, wf = Wait.time, Wait.frames
    Wait.time = function(fn, s, r) if next(active) ~= nil then fn = timed(fn, cur()) end return wt(fn, s, r) end
    Wait.frames = function(fn, n) if next(active) ~= nil then fn = timed(fn, cur()) end return wf(fn, n) end
    engineEffects, engineFxBoard = timed(engineEffects, { all = true }), timed(engineFxBoard, { fx = true })
    __sim.quiet = true -- (the fake's record of each call, string building that real TTS doesn't do, left out)
    return "timed"`, "timed", 1);
  const ZERO = lua(`__fxT.all, __fxT.fx = 0, 0 return "0"`, "zero", 1), READ = lua(`return JSON.encode(__fxT)`, "ms", 1);
  const REPS = 7;
  const steps = (mode) => [pools(6, 4), lua(`engineChat("mtg fx ${mode}", Player.Blue) return "x"`, "mode", 1), TIMED, send(s0, "first board", 10), send(s0, "again", 10),
    ...Array.from({ length: REPS }, () => [ZERO, send(w, "wipe", 200), READ, send(s0, "back", 30)]).flat(),
    send(pre, "bolt on the stack", 30), POOLQ,
    ...Array.from({ length: REPS }, () => [ZERO, send(four, "bolts", 150), READ, send(pre, "back 2", 30)]).flat(), POOLQ];
  const on = run(steps("on")), off = run(steps("off"));
  ok("timing: the scripts ran", !on.r.errors.length && !off.r.errors.length, [...on.r.errors, ...off.r.errors].slice(0, 2).join(" | "));
  // (the fastest of the runs: a garbage collection or another process on the CPU only ever adds time; in the full test
  // file, with its earlier games' garbage, a median still came out 12 ms apart on and off)
  const ms = (t, i0, key) => Math.min(...t.all("ms").slice(i0, i0 + REPS).map((s) => JSON.parse(s.value)[key]));
  const m = { wipeAll: [ms(on, 0, "all"), ms(off, 0, "all")], wipeFx: [ms(on, 0, "fx"), ms(off, 0, "fx")], boltAll: [ms(on, REPS, "all"), ms(off, REPS, "all")], boltFx: [ms(on, REPS, "fx"), ms(off, REPS, "fx")] };
  const [q0, q1] = on.all("poolq").map((s) => JSON.parse(s.value || "[]"));
  const played = fxPlayed(q0, q1);
  ok("timing: the measured boards played their bolts", played.filter((x) => x.bolt).length === 4 * REPS && q0.some((r) => arr(r.played).some((p) => FX_NAMES[p.i] === "death_wipe_W")), JSON.stringify(played.map((x) => x.name)));
  const f = ([a, b]) => `${a.toFixed(2)} on / ${b.toFixed(2)} off`;
  console.log(`timing (fengari, fastest of ${REPS}, ms of host Lua a board): 20-creature wipe: engineEffects ${f(m.wipeAll)}, engineFxBoard ${f(m.wipeFx)}; 4 bolts: engineEffects ${f(m.boltAll)}, engineFxBoard ${f(m.boltFx)}`);
  // (what the build adds to a board, over the same board with "mtg fx off", today's path: fengari's clock on a busy
  // machine wanders by a millisecond or two, so the bound is on the difference, not on the total)
  ok("timing: the rig effects add under 5 ms of the host's Lua a board", m.wipeAll[0] - m.wipeAll[1] < 5 && m.boltAll[0] - m.boltAll[1] < 5, JSON.stringify(m));
}

console.log(failed ? `\n${failed} failed, ${passed} passed` : `all ${passed} passed`);
process.exit(failed ? 1 : 0);
