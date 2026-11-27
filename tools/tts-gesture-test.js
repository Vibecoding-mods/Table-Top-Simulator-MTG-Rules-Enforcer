// Plays White in a running engine game through the table's own click handling (onPlayerAction), the way a player
// clicks: attack = click creature then a life counter; targets = click the glowing card / life counter. Checks what
// the engine received after each click, plus combat glows and how attachments are laid out.
//   node tools/tts-gesture-test.js [seconds=300]
const http = require("http");
const exec = (lua) => new Promise((res) => {
  const req = http.request({ host: "127.0.0.1", port: 48787, path: "/exec", method: "POST" }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => { try { res(JSON.parse(d).value); } catch { res(null); } }); });
  req.on("error", () => res(null)); req.end(lua);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SECS = Number(process.argv[2] || 300);
const results = { attackClick: [], attackTarget: [], targetClick: [], playerTarget: [], combatGlow: [], attachments: [], errors: [] };
(async () => {
  await exec(`engineGuidOf = engineGuidOf or function(id) for _, o in ipairs(getObjects()) do if o.getGMNotes() == "engine:" .. id then return o.getGUID() end end end
  gtSel = function(color) local p = enginePrompts[color] local out = {} for i, o in ipairs((p and p.options) or {}) do if engineSelectedFor(color, i) then out[#out + 1] = tostring(o.id) end end return table.concat(out, ",") end return "ok"`);
  const t0 = Date.now();
  while (Date.now() - t0 < SECS * 1000) {
    const info = JSON.parse(await exec(`local p = enginePrompts.White local t = engineTable()
      if t and t.gameOver then return JSON.encode({ over = true }) end
      if p == nil then return JSON.encode({ none = true }) end
      local ids = {} for i, o in ipairs(p.options or {}) do ids[#ids + 1] = tostring(o.id) end
      return JSON.encode({ title = tostring(p.title), mode = p.mode, ids = ids, min = p.min, max = p.max })`) || "{}");
    if (info.over) { console.log("game over"); break; }
    if (info.none) { await sleep(700); continue; }
    // (an /exec that timed out or answered nothing: {} has no ids, and info.ids.find threw away every result so far)
    if (!Array.isArray(info.ids)) { results.errors.push("an exec timed out or said nothing"); await sleep(700); continue; }
    const title = info.title || "";
    if (/^Declare attackers/.test(title)) {
      const att = (info.ids.find((x) => x.includes("|")) || "").split("|")[0];
      if (att) {
        const r1 = await exec(`local obj = getObjectFromGUID(engineGuidOf("${att}") or "")
          if obj == nil then return "no object" end
          onPlayerAction(Player.White, Player.Action.Select, { obj }) return gtSel("White")`);
        results.attackClick.push({ attacker: att, selectedAfterClick: r1 });
        // then a life counter of an opponent
        const r2 = await exec(`local t = engineTable() local opp
          for _, pl in ipairs(t.players) do if pl.color ~= "White" and pl.status ~= "lost" then opp = pl end end
          local g = ({ White = "23e485", Red = "448880", Yellow = "37e533", Blue = "395037" })[opp.color]
          onPlayerAction(Player.White, Player.Action.Select, { getObjectFromGUID(g) })
          return opp.slot .. " -> " .. gtSel("White")`);
        results.attackTarget.push(r2);
      }
      await exec(`onMtgClick(Player.White, nil, "confirm|White") return "ok"`);
    } else if (info.ids.some((x) => x.startsWith("card|") || x.startsWith("player|"))) {
      const card = info.ids.find((x) => x.startsWith("card|"));
      const player = info.ids.find((x) => x.startsWith("player|"));
      if (card) {
        const r = await exec(`local obj = getObjectFromGUID(engineGuidOf("${card.slice(5)}") or "")
          if obj == nil then return "no object for ${card}" end
          local before = gtSel("White") onPlayerAction(Player.White, Player.Action.Select, { obj })
          return "${title.replace(/"/g, "'")}: picked " .. tostring(gtSel("White")) .. " (prompt now " .. tostring(enginePrompts.White and enginePrompts.White.title) .. ")"`);
        results.targetClick.push(r);
      } else if (player) {
        const r = await exec(`local slot = "${player.slice(7)}" local t = engineTable() local col
          for _, pl in ipairs(t.players) do if pl.slot == slot then col = pl.color end end
          local g = ({ White = "23e485", Red = "448880", Yellow = "37e533", Blue = "395037" })[col]
          onPlayerAction(Player.White, Player.Action.Select, { getObjectFromGUID(g or "") })
          return "${title.replace(/"/g, "'")}: life counter of " .. tostring(col) .. " -> " .. tostring(gtSel("White")) .. " (prompt now " .. tostring(enginePrompts.White and enginePrompts.White.title) .. ")"`);
        results.playerTarget.push(r);
      }
      await sleep(400);
      await exec(`local p = enginePrompts.White if p and p.mode == "multi" then onMtgClick(Player.White, nil, "confirm|White") end return "ok"`);
    } else {
      // anything else: like the autopilot (play a land, cast something, else the first option)
      await exec(`local p = enginePrompts.White if p == nil then return "" end
        if p.mode == "multi" then for i = 1, (p.min or 0) do onMtgClick(Player.White, nil, "o|White|" .. i) end onMtgClick(Player.White, nil, "confirm|White") return "m" end
        local pick = 1 for i, o in ipairs(p.options or {}) do local l = tostring(o.label) if l:find("^Play ") then pick = i break end if l:find("^Cast ") and pick == 1 then pick = i end end
        onMtgClick(Player.White, nil, "o|White|" .. pick) return "s"`);
    }
    // combat glow + attachments snapshot
    const snap = await exec(`local a, b = 0, 0 for id, v in pairs(engineStackGlow) do if v == "atk" then a = a + 1 elseif v == "blk" then b = b + 1 end end
      local att = {} local t = engineTable()
      for _, pl in ipairs(t.players) do for _, c in ipairs(pl.battlefield or {}) do if c.att then
        local o, h = getObjectFromGUID(engineGuidOf(c.id) or ""), getObjectFromGUID(engineGuidOf(c.att) or "")
        if o and h then local p, q = o.getPosition(), h.getPosition() att[#att + 1] = string.format("%s on %s: scale %.2f, offset (%.1f,%.1f)", tostring(c.n), tostring(c.att), o.getScale().x, p.x - q.x, p.z - q.z) end
      end end end
      return t.step .. "|" .. a .. "|" .. b .. "|" .. table.concat(att, "; ")`);
    if (snap) {
      const [step, a, b, att] = snap.split("|");
      if (+a || +b) results.combatGlow.push(`${step}: ${a} attacking, ${b} blocking glow`);
      if (att) results.attachments.push(att);
    }
    await sleep(500);
  }
  const uniq = (l) => [...new Set(l)];
  for (const k of Object.keys(results)) results[k] = uniq(results[k].map((x) => (typeof x === "string" ? x : JSON.stringify(x)))).slice(0, 12);
  console.log(JSON.stringify(results, null, 1));
})();
