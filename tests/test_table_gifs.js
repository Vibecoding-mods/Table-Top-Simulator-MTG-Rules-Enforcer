// GIF frames on the table (docs/gif-frames-spec.md; the "GIF FRAMES" block of tools/engine-renderer.lua), run on the
// fake TTS: one frame per seated player on their own mat once the bridge says it has a key, the owner's search panel
// (Object UI), chat commands, who may move a frame, hide-for-me, the host's switch and rating, the save and a reload.
// The bridge's answers here are made up in the shape bridge/gifs.js sends (tests/test_bridge_gifs.js covers that side).
//   node tests/test_table_gifs.js
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(require("fs").readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${typeof why === "string" ? why : JSON.stringify(why)}` : ""}`); } };

const ENGINE_BACK = "https://steamusercontent-a.akamaihd.net/ugc/1647720103762682461/35EF6E87970E2A5D6581E7D96A99F8A575B7A15F/";
const item = (id, w, h, title = `GIF ${id}`) => ({ id, title, mp4: `https://media.giphy.com/media/${id}/giphy.mp4`, still: `https://media.giphy.com/media/${id}/480w_s.jpg`,
  thumb: `https://wsrv.nl/?url=media.giphy.com/media/${id}/200w_s.gif&w=160&h=160&fit=inside&output=jpg`, w, h });
const ITEMS = [item("wideOne", 400, 200, "Wide <one>"), item("tallTwo", 200, 400), item("square3", 300, 300)];
const msg = (t, body, frames) => ({ msg: { t, json: JSON.stringify({ t, ...body }) }, ...(frames != null ? { frames } : {}) });
const lua = (code, mark, frames) => ({ lua: code, mark, ...(frames != null ? { frames } : {}) });
// what the table sent the bridge (engineSend), from here on
const SPY = lua("__sent = {} local prev = engineSend engineSend = function(t, p) __sent[#__sent + 1] = { t = t, p = p } return prev(t, p) end return 'ok'", "spy");
const SENT = (mark) => lua("local s = __sent or {} __sent = {} return JSON.encode({ list = s })", mark, 1);
// every frame on the table, as data
const FRAMES = (mark, frames) => lua(`local out = {}
  for _, o in ipairs(getObjects()) do
    local gm = tostring(o.getGMNotes())
    if gm:sub(1, 7) == "mtggif:" then
      local c = gm:sub(8) local d = o.getData() local p = o.getPosition()
      local l = data[c] and data[c].playmat and data[c].playmat.positionToLocal(p)
      local assets = {} for _, a in ipairs(o.UI.getCustomAssets() or {}) do assets[#assets + 1] = a.name .. "=" .. a.url end
      -- (what each asset name really shows on real TTS: its first link on this object, BLANK once it was given another)
      local blank = rawget(o, "__d").uiBlank or {} for n in pairs(rawget(o, "__d").uiDup or {}) do blank[n] = true end local shown = {} for n, u in pairs(rawget(o, "__d").uiLoaded or {}) do shown[n] = (u and not blank[n]) and u or "BLANK" end
      local inv = rawget(o, "__d").invisibleTo or {}
      out[#out + 1] = { c = c, guid = o.getGUID(), x = p.x, z = p.z, ry = o.getRotation().y, sx = d.Transform and d.Transform.scaleX, sz = d.Transform and d.Transform.scaleZ,
        img = d.CustomImage and d.CustomImage.ImageURL, stretch = d.CustomImage and d.CustomImage.CustomTile and d.CustomImage.CustomTile.Stretch,
        name = o.getName(), memo = o.memo or "", xml = o.UI.getXml(), assets = assets, shown = shown, hold = o.UI.getAttribute("gifhold_" .. c, "active") or tostring(o.UI.getXml()):match('id="gifhold_' .. c .. '"[^>]-active="(%a+)"'),
        onMat = l ~= nil and math.abs(l.x) <= 0.5 and math.abs(l.z) <= 0.5, inv = table.concat(inv, ","), handRot = Player[c].getHandTransform() and Player[c].getHandTransform().rotation.y }
    end
  end
  table.sort(out, function(a, b) return a.c < b.c end)
  return JSON.encode({ list = out })`, mark, frames ?? 1);
const val = (r, mark) => { const s = r.steps.find((x) => x.step === mark); return s && s.value ? JSON.parse(s.value) : null; };
const raw = (r, mark) => (r.steps.find((x) => x.step === mark) || {}).value;
const fxOf = (r, mark) => (r.steps.find((x) => x.step === mark) || {}).fx || [];
const byC = (v, c) => (v?.list || []).find((f) => f.c === c);
const CHAT = (who, text, mark) => lua(`return tostring(engineChat(${JSON.stringify(text)}, Player.${who}))`, mark);
const CLICK = (who, id, mark) => lua(`engineGifUiClick(Player.${who}, "-1", ${JSON.stringify(id)}) return "ok"`, mark);
const ACT = (who, action, c, mark) => lua(`local f = engineGif.frames.${c} return tostring(onPlayerAction(Player.${who}, Player.Action.${action}, { f }))`, mark);
const CONFIG = (on) => msg("gif_config", { on, credit: "Powered By GIPHY", why: on ? "" : "No GIPHY key yet: get one at developers.giphy.com" });
const SEATED = ["White", "Blue"];

// ── a plain load: nothing new (the golden master's loads stay as they were)
{
  const r = simulate({ save, seated: SEATED, steps: [SPY, { frames: 120 }, SENT("sent"), FRAMES("frames")] });
  ok("plain load: no errors", !r.errors.length, r.errors.join(" | "));
  ok("plain load: no frames without the bridge's word", (val(r, "frames")?.list || []).length === 0, val(r, "frames"));
  ok("plain load: nothing GIF said to the bridge", (val(r, "sent")?.list || []).length === 0 && !JSON.stringify(r.steps).includes("gif_"), val(r, "sent"));
}

// ── the main run: frames appear, a chat search, the panel, who may touch, hold and replay
{
  const r = simulate({ save, seated: SEATED, host: "Blue", steps: [
    SPY,
    CHAT("White", "mtg gif cats", "chat while off"), SENT("sent off"),
    CONFIG(true), { frames: 10 }, FRAMES("frames on"),
    CHAT("White", "mtg gif dancing cats", "chat search"), SENT("sent search"),
    msg("gif_results", { color: "White", req: 1, first: true, q: "dancing cats", page: 0, items: ITEMS, total: 3, error: null }, 10), FRAMES("after pick"), SENT("sent pick"),
    msg("gif_results", { color: "White", req: 0, first: true, q: "old", page: 0, items: [ITEMS[2]], total: 1, error: null }, 10), FRAMES("after stale"),
    { frames: 12 * 60 + 10 }, FRAMES("after 12 s"),
    ACT("Blue", "Select", "White", "blue clicks"), FRAMES("replaying"),
    ACT("Blue", "PickUp", "White", "blue picks up"), ACT("White", "PickUp", "White", "white picks up"), ACT("White", "Delete", "White", "white deletes"),
    ACT("White", "FlipOver", "White", "white flips"), ACT("Blue", "Copy", "White", "blue copies"),
    lua("local f = engineGif.frames.White f.setPosition(Vector(0, 1.3, 0)) onObjectDrop('White', f) return 'ok'", "dropped off mat", 2),
    lua("local f = engineGif.frames.White local p = f.getPosition() return JSON.encode({ x = p.x, z = p.z })", "after drop", 1),
    lua("local f = engineGif.frames.White local m = data.White.playmat.getPosition() f.setPosition(Vector(m.x - 5, 1.3, m.z + 2)) onObjectDrop('White', f) local p = f.getPosition() return JSON.encode({ x = p.x, z = p.z })", "dropped on mat", 2),
    // the panel
    CLICK("Blue", "gifpick_White", "blue opens white's panel"), FRAMES("after blue's click"),
    CLICK("White", "gifpick_White", "white opens"), FRAMES("panel open"),
    lua('engineGifUiSearch(Player.White, "  happy dog ", "gifq_White") return "ok"', "panel search"), SENT("sent panel search"), FRAMES("searching"),
    msg("gif_results", { color: "White", req: 2, first: false, q: "happy dog", page: 0, items: ITEMS, total: 30, error: null }, 4), { frames: 130 }, FRAMES("results"),
    CLICK("Blue", "gifr2_White", "blue picks white's result"), FRAMES("after blue's pick"),
    CLICK("White", "gifmore_White", "more"), SENT("sent more"),
    msg("gif_results", { color: "White", req: 3, first: false, q: "happy dog", page: 1, items: [ITEMS[1], ITEMS[2]], total: 30, error: null }, 4), { frames: 130 }, FRAMES("page 2"),
    CLICK("White", "gifmore_White", "more again"),
    msg("gif_results", { color: "White", req: 4, first: false, q: "happy dog", page: 2, items: [], total: null, error: "One GIF search at a time, please: try again in a moment." }, 4), { frames: 130 }, FRAMES("more refused"),
    CLICK("White", "gifr1_White", "white picks"), { frames: 10 }, FRAMES("after panel pick"), SENT("sent panel pick"),
    msg("gif_results", { color: "White", req: 5, first: false, q: "x", page: 0, items: [], total: 0, error: "GIF search is resting for 12 minutes." }, 4),
    CLICK("White", "gifclear_White", "clear"), { frames: 10 }, FRAMES("cleared"),
    CHAT("Grey", "mtg gif cats", "spectator"),
  ] });
  ok("main: no errors", !r.errors.length, r.errors.join(" | "));
  // (an error inside a timer: real TTS shows it in red in everyone's chat; live 2026-11-14 every pick raised "Object reference
  // not set", the new frame's first XML and an attribute in one frame)
  const waitErrs = r.steps.flatMap((s) => (s.fx || []).filter((l) => /ERROR/.test(l)));
  ok("main: no error in a timer (a pick, the new frame's first draw)", waitErrs.length === 0, waitErrs.slice(0, 3).join(" | "));
  // before the bridge's word
  const sentOff = val(r, "sent off")?.list || [];
  ok("off: mtg gif is answered, the line hidden", raw(r, "chat while off") === "false");
  ok("off: the player is told the frames are off", fxOf(r, "chat while off").some((f) => f.includes("Player.broadcast") && f.includes("GIF frames are off")), fxOf(r, "chat while off"));
  ok("off: the table asks the bridge again (gif_hello)", sentOff.length === 1 && sentOff[0].t === "gif_hello", sentOff);
  // frames
  const on = val(r, "frames on");
  ok("config on: one frame per seated player", (on?.list || []).map((f) => f.c).join() === "Blue,White", on);
  for (const c of SEATED) {
    const f = byC(on, c) || {};
    ok(`config on: ${c}'s frame lies on ${c}'s own mat`, f.onMat === true, f);
    ok(`config on: ${c}'s frame is square, as tall as a card (scale 1.53)`, f.sx === 1.53 && f.sz === 1.53, f);
    ok(`config on: ${c}'s frame turned to read from ${c}'s seat`, Math.abs(((f.ry - (f.handRot + 180)) % 360 + 360) % 360) < 0.01, f);
    ok(`config on: ${c}'s empty frame shows the card back, not stretched`, f.img === ENGINE_BACK && f.stretch === false, f);
    ok(`config on: ${c}'s frame is named and empty`, f.name === `GIF frame (${c})` && f.memo === "", f);
    ok(`config on: ${c}'s GIF... button is ${c}'s alone`, f.xml.includes(`id="gifpick_${c}" visibility="${c}"`), f.xml);
    ok(`config on: ${c}'s empty frame has no Replay`, !f.xml.includes("gifplay_"), f.xml);
  }
  const w0 = byC(on, "White"), b0 = byC(on, "Blue");
  ok("config on: the two frames are apart", w0 && b0 && Math.hypot(w0.x - b0.x, w0.z - b0.z) > 10, [w0?.x, w0?.z, b0?.x, b0?.z]);
  // chat search
  const s1 = (val(r, "sent search")?.list || [])[0];
  ok("chat: mtg gif <words> searches for the first match", s1 && s1.t === "gif_search" && s1.p.color === "White" && s1.p.q === "dancing cats" && s1.p.first === true && s1.p.page === 0 && s1.p.req === 1, s1);
  ok("chat: with the default rating, pg-13", s1 && s1.p.rating === "pg-13", s1);
  ok("chat: the search line is hidden", raw(r, "chat search") === "false");
  const p = val(r, "after pick"), w1 = byC(p, "White");
  ok("pick: White's frame plays the first result's mp4, stretched", w1 && w1.img === ITEMS[0].mp4 && w1.stretch === true, w1);
  ok("pick: a 2:1 GIF fits inside the square (scale 1.53 / 2)", w1 && Math.abs(w1.sx - 0.765) < 0.001 && Math.abs(w1.sz - 0.765) < 0.001, w1);
  ok("pick: a new object where the old one lay", w1 && w1.guid !== w0.guid && Math.hypot(w1.x - w0.x, w1.z - w0.z) < 0.01, [w0?.guid, w1?.guid]);
  ok("pick: the old frame is gone (still one per colour)", (p?.list || []).filter((f) => f.c === "White").length === 1, p);
  ok("pick: the memo keeps the GIF (for a save)", w1 && JSON.parse(w1.memo || "{}").mp4 === ITEMS[0].mp4, w1?.memo);
  ok("pick: the title loses what breaks XML", w1 && JSON.parse(w1.memo || "{}").title === "Wide one", w1?.memo);
  ok("pick: the still is the frame's picture asset", w1 && w1.assets.includes(`still=${ITEMS[0].still}`), w1?.assets);
  ok("pick: it plays (the still is off) and has a Replay for everyone", w1 && w1.xml.includes('id="gifhold_White"') && w1.xml.includes('active="false"') && /id="gifplay_White" position/.test(w1.xml), w1?.xml);
  ok("pick: the UI is scaled back up on the smaller tile", w1 && w1.xml.includes('scale="2.000 2.000 1"'), w1?.xml);
  const sp = (val(r, "sent pick")?.list || []);
  ok("pick: the bridge is told (one table-log line)", sp.length === 1 && sp[0].t === "gif_pick" && sp[0].p.color === "White" && sp[0].p.id === "wideOne", sp);
  ok("pick: Blue's frame unchanged", byC(p, "Blue")?.guid === b0.guid);
  ok("stale answer: an older search's answer changes nothing", byC(val(r, "after stale"), "White")?.guid === w1.guid);
  ok("hold: after 12 s the still covers it", byC(val(r, "after 12 s"), "White")?.hold === "true", byC(val(r, "after 12 s"), "White")?.hold);
  ok("replay: anyone's click plays it again", byC(val(r, "replaying"), "White")?.hold === "false");
  ok("replay: another player's click (a select) isn't refused: moving is", raw(r, "blue clicks") === "true", raw(r, "blue clicks"));
  ok("touch: another player can't pick up White's frame", raw(r, "blue picks up") === "false");
  ok("touch: White can pick up (move) their own", raw(r, "white picks up") === "true");
  ok("touch: not even White deletes, flips; nobody copies", raw(r, "white deletes") === "false" && raw(r, "white flips") === "false" && raw(r, "blue copies") === "false");
  ok("touch: the refusal is said to who tried", fxOf(r, "blue picks up").some((f) => f.includes('"broadcastToColor" "Blue"') && f.includes("only White can move it")), fxOf(r, "blue picks up"));
  const back = val(r, "after drop");
  ok("drop: dropped off the owner's mat it goes back", back && Math.hypot(back.x - w1.x, back.z - w1.z) < 0.01, back);
  const onMat = val(r, "dropped on mat");
  ok("drop: dropped on the owner's mat it stays", onMat && Math.hypot(onMat.x - w1.x, onMat.z - w1.z) > 3, onMat);
  // panel
  ok("panel: another player's click on the owner's button does nothing", !byC(val(r, "after blue's click"), "White")?.xml.includes("gifpanel_"));
  const po = byC(val(r, "panel open"), "White");
  ok("panel: the owner's click opens it, the owner's alone", po && po.xml.includes('id="gifpanel_White" visibility="White"'), po?.xml);
  ok("panel: it has the box, Clear, Close and GIPHY's credit", po && po.xml.includes('id="gifq_White"') && po.xml.includes('onEndEdit="Global/engineGifUiSearch"') && po.xml.includes('id="gifclear_White"') && po.xml.includes('id="gifclose_White"') && po.xml.includes("Powered By GIPHY"), po?.xml);
  const ps = (val(r, "sent panel search")?.list || []).find((m) => m.t === "gif_search");
  ok("panel: Enter searches the trimmed words, a page of results (not the first match)", ps && ps.t === "gif_search" && ps.p.q === "happy dog" && ps.p.first === false && ps.p.req === 2, ps);
  ok("panel: it says it's searching", byC(val(r, "searching"), "White")?.xml.includes("Searching..."));
  const res = byC(val(r, "results"), "White");
  // every thumbnail the panel's XML names, and the picture real TTS shows for it (fake TTS: uiLoaded)
  const thumbs = (f) => [...(f?.xml || "").matchAll(/<Button id="gifr(\d)_White"[^>]*><Image image="([^"]+)"/g)].map((m) => [Number(m[1]), m[2], (f.shown || {})[m[2]]]);
  const showsAll = (f, items) => f && thumbs(f).length === items.length && thumbs(f).every(([i, , u]) => u === items[i - 1].thumb);
  ok("panel: the results as still pictures (a thumb asset each)", showsAll(res, ITEMS), [thumbs(res), res?.assets]);
  const pg2 = byC(val(r, "page 2"), "White");
  ok("panel: page 2's thumbnails load (not under page 1's asset names, which TTS never reloads)", showsAll(pg2, [ITEMS[1], ITEMS[2]]), [thumbs(pg2), pg2?.assets]);
  ok("panel: page 2 says so", pg2 && pg2.xml.includes("Page 2: click one to show it"), pg2?.xml);
  const mr = byC(val(r, "more refused"), "White");
  ok("panel: a refused More keeps the page shown and its More, and says why", showsAll(mr, [ITEMS[1], ITEMS[2]]) && mr.xml.includes('id="gifmore_White"') && mr.xml.includes("One GIF search at a time"), [thumbs(mr), mr?.xml]);
  ok("panel: a button per result, and More", res && [1, 2, 3].every((i) => res.xml.includes(`id="gifr${i}_White"`)) && !res.xml.includes("gifr4_") && res.xml.includes('id="gifmore_White"'), res?.xml);
  ok("panel: a result's title is its tooltip, cleaned", res && res.xml.includes('tooltip="Wide one"'), res?.xml);
  ok("panel: the typed words stay in the box", res && res.xml.includes('text="happy dog"'), res?.xml);
  ok("panel: another player can't pick from it", byC(val(r, "after blue's pick"), "White")?.img === ITEMS[0].mp4);
  const more = (val(r, "sent more")?.list || []).find((m) => m.t === "gif_search");
  ok("panel: More asks for the next page", more && more.p.page === 1 && more.p.q === "happy dog" && more.p.first === false, more);
  const pp = byC(val(r, "after panel pick"), "White");
  ok("panel: picking a result shows it (a tall one keeps scale 1.53)", pp && pp.img === ITEMS[1].mp4 && pp.sx === 1.53, pp);
  ok("panel: picking closes the panel", pp && !pp.xml.includes("gifpanel_"), pp?.xml);
  ok("panel: the pick is told to the bridge", (val(r, "sent panel pick")?.list || []).some((m) => m.t === "gif_pick" && m.p.id === "tallTwo"));
  const cl = byC(val(r, "cleared"), "White");
  ok("clear: the frame is empty again", cl && cl.img === ENGINE_BACK && cl.memo === "" && cl.stretch === false && cl.sx === 1.53, cl);
  ok("spectator: has no frame to set", fxOf(r, "spectator").some((f) => f.includes("Only seated players")), fxOf(r, "spectator"));
}

// ── hide for me, the host's switch and rating, clearing another's frame, the save
{
  const pickWhite = msg("gif_results", { color: "White", req: 1, first: true, q: "cats", page: 0, items: ITEMS, total: 3, error: null }, 10);
  const r = simulate({ save, seated: SEATED, host: "Blue", steps: [
    SPY, CONFIG(true), { frames: 10 },
    CHAT("White", "mtg gif cats", "w search"), pickWhite,
    CHAT("Blue", "mtg gifs hide", "blue hides"), FRAMES("hidden"),
    CHAT("Blue", "mtg gifs show", "blue shows"), FRAMES("shown"),
    CHAT("White", "mtg gifs off", "white tries off"), FRAMES("still on"),
    CHAT("White", "mtg gifs rating g", "white tries rating"),
    CHAT("Blue", "mtg gifs rating g", "host rating"), CHAT("Blue", "mtg gif x", "blue search"), SENT("sent rated"),
    lua("return onSave()", "save rated"),
    CHAT("White", "mtg gif clear blue", "white clears blue"),
    CHAT("Blue", "mtg gif clear white", "host clears white"), { frames: 10 }, FRAMES("white cleared"),
    CHAT("Blue", "mtg gifs off", "host off"), { frames: 120 }, FRAMES("off"),
    lua("return onSave()", "save off"),
    CHAT("White", "mtg gif cats", "white while off"),
    CHAT("Blue", "mtg gifs on", "host on"), { frames: 10 }, FRAMES("on again"),
    CONFIG(false), { frames: 120 }, FRAMES("key removed"),
  ] });
  ok("host: no errors", !r.errors.length, r.errors.join(" | "));
  const hid = val(r, "hidden");
  ok("hide: every frame is invisible to Blue only", (hid?.list || []).length === 2 && hid.list.every((f) => f.inv === "Blue"), hid);
  ok("hide: the frames' UI leaves Blue out", (hid?.list || []).every((f) => /visibility="White\|Brown\|Red\|Orange\|Yellow\|Green\|Teal\|Purple\|Pink\|Grey\|Black"/.test(f.xml)), byC(hid, "White")?.xml);
  ok("hide: told it's on their screen only", fxOf(r, "blue hides").some((f) => f.includes('"Player.broadcast" "Blue"') && f.includes("the others still see them")));
  const sh = val(r, "shown");
  ok("show: back for Blue", (sh?.list || []).every((f) => f.inv === "" && !/<Panel position="0 0 -11"[^>]*visibility=/.test(f.xml)), sh);
  ok("host only: White can't switch the frames off", raw(r, "white tries off") === "false" && (val(r, "still on")?.list || []).length === 2 && fxOf(r, "white tries off").some((f) => f.includes("Only the host")));
  ok("host only: White can't change the rating", fxOf(r, "white tries rating").some((f) => f.includes("Only the host can change the GIF rating")));
  ok("rating: the host's g goes with every search", ((val(r, "sent rated")?.list || []).filter((m) => m.t === "gif_search").pop() || {}).p?.rating === "g", val(r, "sent rated"));
  ok("rating: told to everyone", fxOf(r, "host rating").some((f) => f.includes("broadcastToAll") && f.includes("rated G")));
  const saved = r.steps.find((s) => s.step === "save rated")?.value || "";
  ok("save: the rating is saved beside the table's own state", (() => { try { const j = JSON.parse(saved); return j.engineGif?.rating === "g" && "engineStash" in j; } catch { return false; } })(), saved);
  ok("clear: only the host empties another's frame", fxOf(r, "white clears blue").some((f) => f.includes("Only the host can empty")));
  ok("clear: the host empties White's", byC(val(r, "white cleared"), "White")?.img === ENGINE_BACK && fxOf(r, "host clears white").some((f) => f.includes("emptied White")));
  ok("host off: every frame goes", (val(r, "off")?.list || []).length === 0, val(r, "off"));
  ok("host off: saved", (() => { try { return JSON.parse(r.steps.find((s) => s.step === "save off")?.value || "").engineGif?.off === true; } catch { return false; } })());
  ok("host off: mtg gif says so", fxOf(r, "white while off").some((f) => f.includes("turned the GIF frames off")));
  ok("host on: the frames come back", (val(r, "on again")?.list || []).length === 2, val(r, "on again"));
  ok("key removed (gif_config off): every frame goes", (val(r, "key removed")?.list || []).length === 0, val(r, "key removed"));
}

// ── favourites: the tab, the stars, paging, a pick; asked of the bridge (gif_favs / gif_star), never a search
{
  const FAVS = Array.from({ length: 9 }, (_, i) => item(`fav${i + 1}`, 300, 300, `Fav ${i + 1}`));
  const favs = (req, page, items, ids, total) => msg("gif_favs", { color: "White", req, page, items, ids, total, max: 48, error: null }, 4);
  const r = simulate({ save, seated: SEATED, host: "Blue", steps: [
    SPY, CONFIG(true), { frames: 10 },
    CLICK("White", "gifpick_White", "open"), SENT("sent open"),
    favs(1, 0, [], [], 0),
    lua('engineGifUiSearch(Player.White, "dogs", "gifq_White") return "ok"', "search"),
    msg("gif_results", { color: "White", req: 1, first: false, q: "dogs", page: 0, items: ITEMS, total: 30, error: null }, 4), { frames: 130 }, FRAMES("results"), SENT("sent search"),
    CLICK("Blue", "gifst2_White", "blue stars"), SENT("sent blue star"),
    CLICK("White", "gifst2_White", "star"), SENT("sent star"),
    favs(2, 0, [ITEMS[1]], [ITEMS[1].id], 1), { frames: 130 }, FRAMES("starred"),
    CLICK("White", "giftabf_White", "fav tab"), SENT("sent fav tab"),
    favs(3, 0, [ITEMS[1]], [ITEMS[1].id], 1), { frames: 130 }, FRAMES("fav tab shown"),
    CLICK("White", "gifst1_White", "unstar"), SENT("sent unstar"),
    favs(4, 0, [], [], 0), FRAMES("fav empty"),
    favs(4, 0, FAVS.slice(0, 8), FAVS.map((x) => x.id), 9), { frames: 130 }, FRAMES("nine"),
    CLICK("White", "gifmore_White", "fav more"), SENT("sent fav more"),
    favs(5, 1, FAVS.slice(8), FAVS.map((x) => x.id), 9), { frames: 130 }, FRAMES("fav page 2"),
    favs(3, 0, [ITEMS[0]], [ITEMS[0].id], 1), FRAMES("stale favs"),
    CLICK("White", "giftabs_White", "search tab"), SENT("sent search tab"), FRAMES("back to search"),
    CLICK("White", "giftabf_White", "fav tab again"), favs(6, 1, FAVS.slice(8), FAVS.map((x) => x.id), 9),
    CLICK("White", "gifr1_White", "fav pick"), { frames: 10 }, FRAMES("fav picked"), SENT("sent fav pick"),
  ] });
  const stars = (f) => Object.fromEntries([...(f?.xml || "").matchAll(/<Button id="gifst(\d)_White"[^>]*textColor="(#[0-9A-F]+)"/g)].map((m) => [m[1], m[2] === "#FFD24A"]));
  const thumbs = (f) => [...(f?.xml || "").matchAll(/<Button id="gifr(\d)_White"[^>]*><Image image="([^"]+)"/g)].map((m) => [Number(m[1]), (f.shown || {})[m[2]]]);
  const sends = (mark) => val(r, mark)?.list || [];
  ok("favs: no errors", !r.errors.length, r.errors.join(" | "));
  const o1 = sends("sent open").find((m) => m.t === "gif_favs");
  ok("favs: opening the panel asks for the player's favourites once, with their Steam ID", o1 && o1.p.color === "White" && o1.p.steam === "sim-White" && o1.p.page === 0 && o1.p.req === 1, sends("sent open"));
  const res = byC(val(r, "results"), "White");
  ok("favs: each result has a star, none gold yet", JSON.stringify(stars(res)) === JSON.stringify({ 1: false, 2: false, 3: false }), stars(res));
  ok("favs: the panel has the Search and Favourites tabs", res && res.xml.includes('id="giftabs_White"') && res.xml.includes('id="giftabf_White"') && res.xml.includes("Favourites (0)"), res?.xml);
  ok("favs: another player's star click does nothing", sends("sent blue star").length === 0, sends("sent blue star"));
  const st = sends("sent star").find((m) => m.t === "gif_star");
  ok("favs: a star sends that GIF to the bridge (on), no search", st && st.p.on === true && st.p.item.id === "tallTwo" && st.p.item.mp4 === ITEMS[1].mp4 && st.p.item.thumb === ITEMS[1].thumb && st.p.steam === "sim-White" && !sends("sent star").some((m) => m.t === "gif_search"), sends("sent star"));
  const sd = byC(val(r, "starred"), "White");
  ok("favs: the bridge's answer turns that star gold and counts it", JSON.stringify(stars(sd)) === JSON.stringify({ 1: false, 2: true, 3: false }) && sd.xml.includes("Favourites (1)"), [stars(sd)]);
  ok("favs: the results stay shown after a star", thumbs(sd).length === 3 && thumbs(sd).every(([i, u]) => u === ITEMS[i - 1].thumb), thumbs(sd));
  const ft = sends("sent fav tab");
  ok("favs: the Favourites tab asks the bridge, never GIPHY", ft.length === 1 && ft[0].t === "gif_favs" && ft[0].p.req === 3, ft);
  const fs1 = byC(val(r, "fav tab shown"), "White");
  ok("favs: the tab shows the favourites, loaded, starred, without the search box or More", fs1 && thumbs(fs1).length === 1 && thumbs(fs1)[0][1] === ITEMS[1].thumb && stars(fs1)[1] === true && !fs1.xml.includes('id="gifq_White"') && !fs1.xml.includes("gifmore_") && fs1.xml.includes("Favourites 1 of 1"), [thumbs(fs1), fs1?.xml]);
  const un = sends("sent unstar").find((m) => m.t === "gif_star");
  ok("favs: a gold star unstars it", un && un.p.on === false && un.p.item.id === "tallTwo", un);
  const fe = byC(val(r, "fav empty"), "White");
  ok("favs: an empty list says how to add one", fe && fe.xml.includes("No favourites yet") && !fe.xml.includes('id="gifr1_White"'), fe?.xml);
  const nine = byC(val(r, "nine"), "White");
  ok("favs: past 8, a More pages them", nine && thumbs(nine).length === 8 && nine.xml.includes('id="gifmore_White"') && nine.xml.includes("Favourites 1 of 2"), nine?.xml);
  const fm = sends("sent fav more").filter((m) => m.t !== "hello"); // (a periodic hello may fall in the wait before it)
  ok("favs: More on the tab asks the bridge for the next page, no search", fm.length === 1 && fm[0].t === "gif_favs" && fm[0].p.page === 1, fm);
  const p2 = byC(val(r, "fav page 2"), "White");
  ok("favs: page 2 of the favourites loads its thumbnail", p2 && thumbs(p2).length === 1 && thumbs(p2)[0][1] === FAVS[8].thumb && p2.xml.includes("Favourites 2 of 2"), [thumbs(p2), p2?.assets]);
  ok("favs: an older ask's answer changes nothing", byC(val(r, "stale favs"), "White")?.xml === p2?.xml);
  const bs = byC(val(r, "back to search"), "White");
  ok("favs: the Search tab brings the results back, still loaded", bs && thumbs(bs).length === 3 && thumbs(bs).every(([i, u]) => u === ITEMS[i - 1].thumb) && bs.xml.includes('id="gifq_White"') && sends("sent search tab").length === 0, [thumbs(bs), sends("sent search tab")]);
  const fp = byC(val(r, "fav picked"), "White");
  ok("favs: a favourite's click shows it in the frame", fp && fp.img === FAVS[8].mp4 && !fp.xml.includes("gifpanel_"), fp);
  ok("favs: and is told to the bridge like a pick, no search", sends("sent fav pick").some((m) => m.t === "gif_pick" && m.p.id === "fav9") && !sends("sent fav pick").some((m) => m.t === "gif_search"), sends("sent fav pick"));
}

// ── seats change: a frame for a new player, none for one who left
{
  const r = simulate({ save, seated: SEATED, host: "Blue", steps: [
    CONFIG(true), { frames: 10 },
    lua("__sim.seated.Red = true onPlayerChangeColor('Red') return 'ok'", "red sits", 150), FRAMES("red seated"),
    lua("__sim.seated.White = nil onPlayerChangeColor('Grey') return 'ok'", "white leaves", 150), FRAMES("white gone"),
    lua("__gifBlue = engineGif.frames.Blue.getGUID() local f = engineGif.frames.Blue f.destruct() onObjectDestroy(f) return 'ok'", "blue frame deleted", 150), FRAMES("blue back"), lua("return __gifBlue", "old blue"),
  ] });
  ok("seats: no errors", !r.errors.length, r.errors.join(" | "));
  ok("seats: a player who sits down gets a frame", (val(r, "red seated")?.list || []).map((f) => f.c).join() === "Blue,Red,White", val(r, "red seated"));
  const bb = byC(val(r, "blue back"), "Blue");
  ok("seats: a frame deleted some other way comes back", bb && bb.guid !== raw(r, "old blue"), [bb?.guid, raw(r, "old blue")]);
  ok("seats: a player who leaves loses theirs", (val(r, "white gone")?.list || []).map((f) => f.c).join() === "Blue,Red", val(r, "white gone"));
}

// ── the break-it review's cases (2026-11-13): a box selection, the search box's blur, a spawn that never calls back, a
// picture TTS refuses, and hide-for-me when its player leaves
{
  const pickWhite = msg("gif_results", { color: "White", req: 1, first: true, q: "cats", page: 0, items: ITEMS, total: 3, error: null }, 10);
  const NO_CALLBACK = lua("__realSpawn = __realSpawn or spawnObjectData spawnObjectData = function(t) t.callback_function = nil return __realSpawn(t) end return 'ok'", "no callback");
  const CALLBACK = lua("spawnObjectData = __realSpawn return 'ok'", "callback again");
  const SEARCH = (text, mark) => lua(`engineGifUiSearch(Player.White, ${JSON.stringify(text)}, "gifq_White") return "ok"`, mark);
  const WHITES = (v) => (v?.list || []).filter((f) => f.c === "White");
  const r = simulate({ save, seated: SEATED, host: "Blue", steps: [
    SPY, CONFIG(true), { frames: 10 },
    CHAT("White", "mtg gif cats", "w search"), pickWhite, { frames: 12 * 60 + 10 }, FRAMES("held"),
    lua("return tostring(onPlayerAction(Player.Blue, Player.Action.Select, { engineGif.frames.White, engineGif.frames.Blue }))", "box select"), FRAMES("after box"),
    // the search box: Enter, then the same words again on losing focus (as the box shows them: & dropped)
    CLICK("White", "gifpick_White", "open"), SEARCH("AT&T  news", "enter"), SENT("sent enter"),
    msg("gif_results", { color: "White", req: 2, first: false, q: "AT&T news", page: 0, items: ITEMS, total: 3, error: null }, 4), FRAMES("box text"),
    SEARCH("ATT  news", "blur"), SEARCH("AT&T  news", "enter again"), SENT("sent blur"),
    // a spawn whose callback never comes, with a clear waiting behind it
    NO_CALLBACK, CLICK("White", "gifr1_White", "pick stuck"), { frames: 30 }, CHAT("White", "mtg gif off", "clear while stuck"), { frames: 30 },
    CALLBACK, { frames: 11 * 60 }, FRAMES("after give up"),
    // a picture TTS refuses: its import dialog's X deletes the frame before any callback
    NO_CALLBACK, CLICK("White", "gifpick_White", "open 2"), CLICK("White", "gifr2_White", "pick refused"), { frames: 30 },
    lua("local f = engineGif.frames.White f.destruct() onObjectDestroy(f) return 'ok'", "dialog X", 1), CALLBACK, { frames: 180 }, FRAMES("after refused"),
    // a failed search's words may be tried again
    SEARCH("dogs", "dogs"), msg("gif_results", { color: "White", req: 3, first: false, q: "dogs", page: 0, items: [], total: 0, error: "GIF search is resting for 3 minutes." }, 4),
    SEARCH("dogs", "dogs again"), SENT("sent after error"),
    // hide-for-me leaves with its player
    CHAT("White", "mtg gifs hide", "white hides"), CHAT("Grey", "mtg gifs hide", "grey hides"),
    lua("__sim.seated.White = nil onPlayerChangeColor('Grey') return 'ok'", "white leaves", 180),
    lua("return JSON.encode({ white = engineGif.hidden.White == true, grey = engineGif.hidden.Grey == true })", "hidden after"),
  ] });
  ok("review: no errors", !r.errors.length, r.errors.join(" | "));
  ok("box select: not refused, and it doesn't replay the frames in it", raw(r, "box select") !== "false" && byC(val(r, "after box"), "White")?.hold === "true", [raw(r, "box select"), byC(val(r, "after box"), "White")?.hold]);
  ok("search box: Enter searches", (val(r, "sent enter")?.list || []).some((m) => m.t === "gif_search" && m.p.q === "AT&T  news" && m.p.req === 2), val(r, "sent enter"));
  ok("search box: its text drops what breaks XML", /text="ATT  news"/.test(byC(val(r, "box text"), "White")?.xml || ""), byC(val(r, "box text"), "White")?.xml);
  ok("search box: the same words on blur (as shown, or as typed) cost no search", (val(r, "sent blur")?.list || []).filter((m) => m.t === "gif_search").length === 0, val(r, "sent blur"));
  ok("search box: the same words after a failed search do search again", (val(r, "sent after error")?.list || []).filter((m) => m.t === "gif_search" && m.p.q === "dogs").length === 2, val(r, "sent after error"));
  const g = WHITES(val(r, "after give up"));
  ok("stuck spawn: given up after 10 s, then the waiting clear lands: one empty White frame", g.length === 1 && g[0].img === ENGINE_BACK && g[0].memo === "", g.map((f) => [f.img, f.memo]));
  const rf = WHITES(val(r, "after refused"));
  ok("refused picture: the frame comes back empty, not with the same link", rf.length === 1 && rf[0].img === ENGINE_BACK && rf[0].memo === "", rf.map((f) => [f.img, f.memo]));
  ok("refused picture: the owner is told", fxOf(r, "dialog X").concat(r.steps.flatMap((s) => s.fx || [])).some((f) => f.includes("couldn't be loaded")));
  const h = val(r, "hidden after");
  ok("hide: a player's hide goes when they leave; a spectator's stays", h && h.white === false && h.grey === true, h);
}

// ── a video that never loads while its frame lies there (live 2026-11-15: TTS said "Format: MP4" in chat and left a
// white tile for a good GIPHY video): one more try with the same video, then the still picture, said to the owner;
// a new pick tries the video again, and a picture that does load is never tried again
{
  const NO_CALLBACK = lua("__realSpawn = __realSpawn or spawnObjectData spawnObjectData = function(t) t.callback_function = nil return __realSpawn(t) end return 'ok'", "no callback");
  const CALLBACK = lua("spawnObjectData = __realSpawn return 'ok'", "callback again");
  const W = (r, mark) => (val(r, mark)?.list || []).filter((f) => f.c === "White");
  const r = simulate({ save, seated: SEATED, host: "Blue", steps: [
    SPY, CONFIG(true), { frames: 10 },
    CHAT("White", "mtg gif cats", "w search"), NO_CALLBACK,
    msg("gif_results", { color: "White", req: 1, first: true, q: "cats", page: 0, items: ITEMS, total: 3, error: null }, 30), FRAMES("first try"),
    { frames: 10 * 60 }, FRAMES("retry"), CALLBACK,
    { frames: 10 * 60 }, FRAMES("still"),
    { frames: 11 * 60 }, FRAMES("rests"),
    CLICK("White", "gifcol_White", "hide"), { frames: 30 }, CLICK("White", "gifcol_White", "show"), { frames: 30 }, FRAMES("shown again"),
    CHAT("White", "mtg gif dogs", "w search 2"),
    msg("gif_results", { color: "White", req: 2, first: true, q: "dogs", page: 0, items: ITEMS.slice(1), total: 2, error: null }, 30), FRAMES("repick"),
    { frames: 11 * 60 }, FRAMES("loaded stays"),
  ] });
  ok("retry: no errors", !r.errors.length, r.errors.join(" | "));
  const [a, b, s, rest, rp, ls] = ["first try", "retry", "still", "rests", "repick", "loaded stays"].map((m) => W(r, m));
  const one = (l) => l.length === 1;
  ok("retry: the first try shows the video", one(a) && a[0].img === ITEMS[0].mp4, a.map((f) => f.img));
  ok("retry: a video that never arrives is tried once more, in a new frame", one(b) && b[0].img === ITEMS[0].mp4 && b[0].guid !== a[0].guid, [a, b].map((l) => l.map((f) => [f.guid, f.img])));
  ok("retry: then the still picture shows instead, the GIF kept", one(s) && s[0].img === ITEMS[0].still && s[0].guid !== b[0].guid && JSON.parse(s[0].memo || "{}").mp4 === ITEMS[0].mp4, s.map((f) => [f.img, f.memo]));
  ok("retry: the owner is told", r.steps.flatMap((x) => x.fx || []).some((f) => f.includes('"White"') && f.includes("video wouldn't load")), r.steps.flatMap((x) => x.fx || []).filter((f) => f.includes("GIF")));
  ok("retry: no third try", one(rest) && rest[0].guid === s[0].guid && rest[0].img === ITEMS[0].still, rest.map((f) => [f.guid, f.img]));
  const sh = W(r, "shown again");
  ok("retry: Hide and Show after the still loaded try the video again", one(sh) && sh[0].img === ITEMS[0].mp4, sh.map((f) => f.img));
  ok("retry: a new pick tries the video again", one(rp) && rp[0].img === ITEMS[1].mp4, rp.map((f) => f.img));
  ok("retry: a picture that loads is never tried again", one(ls) && ls[0].guid === rp[0].guid && ls[0].img === ITEMS[1].mp4, [rp, ls].map((l) => l.map((f) => [f.guid, f.img])));
  // (the still never loading either, then a new pick: its video, not its still)
  const r2 = simulate({ save, seated: SEATED, host: "Blue", steps: [
    SPY, CONFIG(true), { frames: 10 }, CHAT("White", "mtg gif cats", "w search"), NO_CALLBACK,
    msg("gif_results", { color: "White", req: 1, first: true, q: "cats", page: 0, items: ITEMS, total: 3, error: null }, 31 * 60), FRAMES("both failed"),
    CALLBACK, CHAT("White", "mtg gif dogs", "w search 2"),
    msg("gif_results", { color: "White", req: 2, first: true, q: "dogs", page: 0, items: ITEMS.slice(1), total: 2, error: null }, 30), FRAMES("new pick"),
  ] });
  const bf = W(r2, "both failed"), np = W(r2, "new pick");
  ok("retry: after the still failed too, a new pick shows its video", !r2.errors.length && one(bf) && bf[0].img === ITEMS[0].still && one(np) && np[0].img === ITEMS[1].mp4, [bf, np].map((l) => l.map((f) => f.img)).concat(r2.errors));
}

// ── a whole engine game leaves the frames alone (spec §4: the sweep, the stray watcher and mtg start leave them; an
// Undo leaves them as they are): the recorded 1v1 (Blue and White, tests/golden/fixtures/table-stream-1v1.json) from
// mtg start to the bridge's clear (mtg reset), with both frames up and White's showing a GIF
{
  const s1 = require("./golden/fixtures/table-stream-1v1.json");
  const pickWhite = msg("gif_results", { color: "White", req: 1, first: true, q: "cats", page: 0, items: ITEMS, total: 3, error: null }, 10);
  const r = simulate({ save, seated: SEATED, host: "Blue", steps: [
    CONFIG(true), { frames: 10 }, CHAT("White", "mtg gif cats", "w search"), pickWhite, { frames: 130 }, FRAMES("before game"),
    lua('engineAutoPace.Blue = false engineChat("mtg start ai 1", Player.Blue) return "ok"', "mtg start"),
    ...s1.map((m) => ({ msg: { t: m.t, json: m.json } })), FRAMES("in game"),
    { msg: { t: "clear", json: JSON.stringify({ t: "clear" }) }, frames: 90, mark: "clear (mtg reset)" }, { frames: 180 }, FRAMES("after game"),
  ] });
  ok("game: no errors", !r.errors.length, r.errors.slice(0, 3).join(" | "));
  const keep = (v) => (v?.list || []).map((f) => [f.c, f.guid, f.img, f.memo].join("|")).join(" ; ");
  const before = val(r, "before game");
  ok("game: both frames up before it, White's with its GIF", (before?.list || []).map((f) => f.c).join() === "Blue,White" && byC(before, "White")?.img === ITEMS[0].mp4, before);
  ok("game: the frames are the same objects, GIF and memo through the game", keep(val(r, "in game")) === keep(before), [keep(before), keep(val(r, "in game"))]);
  ok("game: and after mtg reset's clear", keep(val(r, "after game")) === keep(before), [keep(before), keep(val(r, "after game"))]);
  ok("game: each frame still on its owner's mat", (val(r, "after game")?.list || []).every((f) => f.onMat === true), val(r, "after game"));
}

// ── mtg help lists the GIF commands (the GIF block passes "mtg help" on to the table's own chat)
{
  const r = simulate({ save, seated: SEATED, host: "Blue", steps: [CHAT("White", "mtg help", "help")] });
  ok("help: no errors", !r.errors.length, r.errors.join(" | "));
  const said = fxOf(r, "help").join("\n");
  ok("help: mtg help lists mtg gif, mtg gif off, mtg gifs hide/show and mtg gif help", /mtg gif <words> \/ mtg gif off - your GIF frame/.test(said) && /mtg gifs hide\/show/.test(said) && /mtg gifs still - a GIF is a white square/.test(said) && /mtg gif help - every GIF command/.test(said), said.slice(-400));
}

// ── a reload: the save's frames are adopted (with their GIF), not doubled, and the bridge is asked about its key
{
  const st = { id: "square3", mp4: ITEMS[2].mp4, still: ITEMS[2].still, title: "Square", w: 300, h: 300 };
  const frame = (c, extra = {}) => ({ GUID: `gif${c.slice(0, 3)}`, Name: "Custom_Tile", Nickname: `GIF frame (${c})`, GMNotes: `mtggif:${c}`, Memo: JSON.stringify(st),
    Transform: { posX: 5, posY: 1.3, posZ: -20, rotX: 0, rotY: 180, rotZ: 0, scaleX: 1.53, scaleY: 1, scaleZ: 1.53 },
    CustomImage: { ImageURL: st.mp4, CustomTile: { Type: 0, Stretch: true } }, ...extra });
  const saved = { ...save, ObjectStates: [...save.ObjectStates, frame("White"), frame("White", { GUID: "gifdup" })],
    LuaScriptState: JSON.stringify({ engineStash: {}, engineGif: { off: false, rating: "pg" } }) };
  const r = simulate({ save: saved, seated: SEATED, host: "Blue", prelude: "", steps: [
    lua(`rawset(Global, "script_state", ${JSON.stringify(saved.LuaScriptState)}) return "ok"`, "state", 0),
    SPY, { frames: 60 }, SENT("sent at load"), FRAMES("loaded"),
    CONFIG(true), { frames: 10 }, FRAMES("config"), CHAT("White", "mtg gif dogs", "search"), SENT("sent search"),
  ] });
  ok("reload: no errors", !r.errors.length, r.errors.join(" | "));
  const l = val(r, "loaded");
  ok("reload: one White frame (the duplicate removed)", (l?.list || []).length === 1 && l.list[0].c === "White", l);
  ok("reload: it keeps its GIF and holds on the still", l?.list?.[0]?.img === st.mp4 && l.list[0].assets.includes(`still=${st.still}`) && /id="gifhold_White"[^>]*active="true"/.test(l.list[0].xml), l?.list?.[0]);
  ok("reload: the bridge is asked whether it has a key", (val(r, "sent at load")?.list || []).some((m) => m.t === "gif_hello"), val(r, "sent at load"));
  const c = val(r, "config");
  ok("reload: the adopted frame is kept, Blue gets one", (c?.list || []).map((f) => f.c).join() === "Blue,White" && byC(c, "White")?.guid === l?.list?.[0]?.guid, c);
  ok("reload: the saved rating is used", ((val(r, "sent search")?.list || []).find((m) => m.t === "gif_search") || {}).p?.rating === "pg", val(r, "sent search"));
}

// ── collapse: the owner's Hide makes the frame a small plain tile for everyone, keeping the GIF; Show brings it back
{
  const r = simulate({ save, seated: SEATED, host: "Blue", steps: [
    SPY, CONFIG(true), { frames: 10 },
    CHAT("White", "mtg gif cats", "search"), msg("gif_results", { color: "White", req: 1, first: true, q: "cats", page: 0, items: ITEMS, total: 3, error: null }, 10), FRAMES("shown"),
    CLICK("White", "gifpick_White", "open panel"),
    CLICK("Blue", "gifcol_White", "blue hides"), { frames: 10 }, FRAMES("after blue"),
    CLICK("White", "gifcol_White", "hide"), { frames: 10 }, FRAMES("collapsed"),
    ACT("Blue", "Select", "White", "blue clicks it"), lua("return tostring(engineGif.playing.White)", "playing while collapsed"),
    lua("engineGif.adopted = false engineGif.frames = {} engineGif.state.White = nil engineGif.adopt() local st = engineGif.state.White return JSON.encode({ c = st and st.collapsed, mp4 = st and st.mp4 })", "adopted"),
    CLICK("White", "gifcol_White", "show"), { frames: 10 }, FRAMES("expanded"),
  ] });
  ok("collapse: no errors", !r.errors.length, r.errors.join(" | "));
  const sh = byC(val(r, "shown"), "White");
  ok("collapse: a shown GIF has the owner's Hide beside GIF... and Replay", sh && /<Button id="gifcol_White" visibility="White"[^>]*>Hide<\/Button>/.test(sh.xml) && sh.xml.includes('id="gifplay_White"') && sh.xml.includes('id="gifpick_White"'), sh?.xml);
  ok("collapse: another player's click does nothing", byC(val(r, "after blue"), "White")?.img === ITEMS[0].mp4);
  const co = byC(val(r, "collapsed"), "White");
  const memo = (() => { try { return JSON.parse(co?.memo || ""); } catch { return {}; } })();
  ok("collapse: the frame becomes a small plain tile (for everyone: it is the tile itself)", co && co.img === ENGINE_BACK && co.stretch === false && Math.abs(co.sx - 1.53 / 2.5) < 0.001 && co.inv === "", co && [co.img, co.stretch, co.sx]);
  ok("collapse: the GIF stays chosen, in the frame's memo with collapsed", memo.mp4 === ITEMS[0].mp4 && memo.collapsed === true, memo);
  ok("collapse: the collapsed UI: no still, the owner's Show, the panel closed", co && !co.xml.includes("gifhold_") && /<Button id="gifcol_White" visibility="White"[^>]*>Show<\/Button>/.test(co.xml) && !co.xml.includes("gifpanel_"), co?.xml);
  ok("collapse: a click on the collapsed frame doesn't play it", raw(r, "playing while collapsed") === "nil", raw(r, "playing while collapsed"));
  ok("collapse: a reload keeps it collapsed (the memo)", (() => { try { const j = JSON.parse(raw(r, "adopted")); return j.c === true && j.mp4 === ITEMS[0].mp4; } catch { return false; } })(), raw(r, "adopted"));
  const ex = byC(val(r, "expanded"), "White");
  ok("collapse: Show brings the same GIF back, playing, at full size", ex && ex.img === ITEMS[0].mp4 && ex.stretch === true && Math.abs(ex.sx - 0.765) < 0.001 && ex.hold === "false" && !JSON.parse(ex.memo || "{}").collapsed, ex && [ex.img, ex.sx, ex.hold, ex.memo]);
}

// ── stills only (live 2026-11-15: a friend's TTS drew every GIPHY .mp4 tile blank white): mtg gifs still covers every
// frame with its still picture all the time on that player's screen only; mtg gifs video undoes it; hide wins; it
// goes with its player; one hint to everyone at the first video shown
{
  // what colour c sees of a frame's UI: the still over the video (gifstill, always on), the timed still (gifhold), or
  // nothing over the video. An element shows to the colours in its visibility (none: everyone), inside its root's
  const sees = (f, c) => {
    if (!f) return "no frame";
    const vis = (tag) => { const m = tag.match(/visibility="([^"]*)"/); return !m || m[1].split("|").includes(c); };
    const root = (f.xml.match(/^<Panel position="0 0 -11"[^>]*>/) || [""])[0];
    if (!vis(root) || f.inv.split(",").includes(c)) return "hidden";
    const still = (f.xml.match(/<Image id="gifstill_[^"]*"[^>]*>/) || [null])[0];
    if (still && vis(still) && /image="still"/.test(still) && !/active="false"/.test(still) && f.assets.some((a) => a.startsWith("still="))) return "still";
    if (f.hold === "true") return "held";
    return "video";
  };
  const pick = (req, items) => msg("gif_results", { color: "White", req, first: true, q: "cats", page: 0, items, total: items.length, error: null }, 10);
  const r = simulate({ save, seated: [...SEATED, "Red"], host: "Blue", steps: [
    SPY, CONFIG(true), { frames: 10 },
    CHAT("White", "mtg gif cats", "w search"), pick(1, ITEMS), { frames: 10 }, FRAMES("playing"),
    CHAT("Blue", "mtg gifs still", "blue still"), FRAMES("blue still view"),
    { frames: 12 * 60 + 10 }, FRAMES("held"),
    ACT("Red", "Select", "White", "red replays"), FRAMES("replay"),
    CHAT("White", "mtg gif dogs", "w search 2"), pick(2, ITEMS.slice(1)), { frames: 7 * 60 }, FRAMES("repick"),
    CHAT("Blue", "mtg gifs hide", "blue hides"), FRAMES("blue hides view"),
    CHAT("Blue", "mtg gifs show", "blue shows"), FRAMES("blue shows view"),
    CLICK("White", "gifcol_White", "collapse"), { frames: 10 }, FRAMES("collapsed"),
    CLICK("White", "gifcol_White", "expand"), { frames: 10 }, FRAMES("expanded"),
    CHAT("Blue", "mtg gifs video", "blue video"), FRAMES("blue video view"),
    CHAT("Blue", "mtg gifs still", "blue still again"), lua("return 'ok'", "after toggle", 7 * 60), CHAT("Grey", "mtg gifs still", "grey still"),
    lua("__sim.seated.Blue = nil onPlayerChangeColor('Grey') return 'ok'", "blue leaves", 180), FRAMES("blue gone"),
    lua("return JSON.encode({ blue = engineGif.stills.Blue == true, grey = engineGif.stills.Grey == true })", "stills after"),
    CHAT("White", "mtg gifs", "state"),
  ] });
  ok("stills: no errors", !r.errors.length, r.errors.join(" | "));
  const W = (mark) => byC(val(r, mark), "White");
  const view = (mark) => Object.fromEntries(["White", "Blue", "Red"].map((c) => [c, sees(W(mark), c)]));
  const eq = (mark, want) => JSON.stringify(view(mark)) === JSON.stringify(want);
  ok("stills: before, everyone sees the video playing", eq("playing", { White: "video", Blue: "video", Red: "video" }), view("playing"));
  ok("stills: mtg gifs still: Blue sees the still at once, while it plays; the others the video", eq("blue still view", { White: "video", Blue: "still", Red: "video" }), view("blue still view"));
  ok("stills: the still is Blue's alone (visibility Blue), over the whole frame", /<Image id="gifstill_White" image="still" visibility="Blue" width="200" height="100"/.test(W("blue still view")?.xml || ""), W("blue still view")?.xml);
  ok("stills: an empty frame (Blue's) gets no still", !(byC(val(r, "blue still view"), "Blue")?.xml || "gifstill_").includes("gifstill_"), byC(val(r, "blue still view"), "Blue")?.xml);
  ok("stills: told in plain words, Blue only", fxOf(r, "blue still").some((f) => f.includes('"Player.broadcast" "Blue"') && f.includes("still picture instead of the moving GIF") && f.includes("mtg gifs video")), fxOf(r, "blue still"));
  const reset = r.steps.filter((x) => x.step === "after toggle").flatMap((x) => x.fx || []).filter((f) => f.includes('"objUI.setXml"'));
  ok("stills: the toggle sets every frame's XML again later (a picture loading shows white on real TTS)", (() => { const n = {}; for (const f of reset) { const o = (f.match(/obj:(\S+)/) || [])[1]; n[o] = (n[o] || 0) + 1; } return Object.values(n).filter((k) => k >= 2).length === 3; })(), reset);
  ok("stills: after 12 s the others get the timed still, Blue keeps the always-on one", eq("held", { White: "held", Blue: "still", Red: "held" }), view("held"));
  ok("stills: a Replay plays for the others only", eq("replay", { White: "video", Blue: "still", Red: "video" }), view("replay"));
  const rp = W("repick");
  ok("stills: a new pick keeps Blue on its new still (asset set, XML set again after it loads)", eq("repick", { White: "video", Blue: "still", Red: "video" }) && rp.assets.includes(`still=${ITEMS[1].still}`) && rp.shown.still === ITEMS[1].still, [view("repick"), rp?.assets, rp?.shown]);
  ok("stills: hide wins (no still element left for Blue, the frame hidden)", eq("blue hides view", { White: "video", Blue: "hidden", Red: "video" }) && !(W("blue hides view")?.xml || "").includes("gifstill_"), [view("blue hides view"), W("blue hides view")?.xml]);
  ok("stills: show brings Blue's still back", eq("blue shows view", { White: "video", Blue: "still", Red: "video" }), view("blue shows view"));
  ok("stills: a collapsed frame is unchanged (no still)", !(W("collapsed")?.xml || "").includes("gifstill_") && !(W("collapsed")?.xml || "").includes("gifhold_"), W("collapsed")?.xml);
  ok("stills: expanded again, Blue's still is back", sees(W("expanded"), "Blue") === "still", view("expanded"));
  ok("stills: mtg gifs video undoes it", eq("blue video view", { White: "video", Blue: "video", Red: "video" }) && !(W("blue video view")?.xml || "").includes("gifstill_") && fxOf(r, "blue video").some((f) => f.includes("move again")), [view("blue video view"), fxOf(r, "blue video")]);
  const st = val(r, "stills after");
  ok("stills: it goes with its player; a spectator's stays", st && st.blue === false && st.grey === true && /<Image id="gifstill_White" image="still" visibility="Grey"/.test(W("blue gone")?.xml || ""), [st, W("blue gone")?.xml]);
  const hints = r.steps.flatMap((x) => x.fx || []).filter((f) => f.includes("broadcastToAll") && f.includes("white square"));
  ok("stills: one hint to everyone at the first video, not again", hints.length === 1 && hints[0].includes("broadcastToAll") && hints[0].includes("(Steam Deck, Mac or Linux)? Type  mtg gifs still"), hints);
  ok("stills: the mtg gifs help line names it", fxOf(r, "state").some((f) => f.includes("mtg gifs still") && f.includes("white square")), fxOf(r, "state"));
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
