// Adversary pass for the table golden master (jr-programmer-suite §2b): plausible careless edits to the table's
// Global script (in a built copy, never the sources), one at a time; records whether tests/test_table_golden.js
// catches each.   node tools/mutate-table.js
// Grades (the record of each full run is tmp/mutate-table.json; a MUT_ONLY re-check writes tmp/mutate-table-only.json):
//   2026-11-24, after 41 stale edits were repaired: 162 edits, the golden alone let 8 through (4.9%, SOUND). Three
//   were equivalent programs (the lunge and target lines' playerSpot -> lifeSpot: playerSpot IS lifeSpot since the
//   life-counter aim; "long rows" > -> >=: at width == perRow both give step 1) and were replaced by live edits at the
//   same spots, which the golden catches but long rows (step 1). The five real escapes (fix pile drop x2, autoresolve
//   toggle, the not-chosen hint on a hand card, a concession's banner) and the new long-rows edit are closed by
//   tests/test_table_golden_gaps.js: golden + gaps 0 of 162 escape (0% by construction, not by a blind tool).
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { buildSave } = require("../tests/golden/table-run");

const ROOT = path.join(__dirname, "..");
const save = buildSave();
const pristine = save.LuaScript;
const FILE = path.join(ROOT, "tmp", "table-build", "mutant.json");

const M = [
  ["panel: a big choice list with a picture stays hidden","or (pictures == 0 and #opts > 0 and fits and","or (pictures == 0 and #opts > 0 and"],
  ["panel: a library search stays hidden","handled = (kind ~= nil and m.librarySearch == nil and engineAnswerPlace(m) ~= \"panel\")","handled = (kind ~= nil and engineAnswerPlace(m) ~= \"panel\")"],
  ["panel: more pictures than the row holds stay hidden","or (pictures > 0 and pictures <= ROW_MAX and","or (pictures > 0 and"],
  ["hint: life counter offered for card-only targets","players and \"\\nClick a player's life counter.\" or \"\\nClick a glowing card.\")","players and \"\\nClick a player's life counter.\" or \"\\nClick a glowing card or a life counter.\")"],
  ["done: Confirm again","big, bigLabel = \"confirm\", \"Done\"","big, bigLabel = \"confirm\", \"Confirm\""],
  ["cut: splits a character","if #cut - i + 1 < need then cut = cut:sub(1, i - 1) end",""],
  ["cut: drops a whole character","if #cut - i + 1 < need then","if #cut - i + 1 <= need then"],
  ["lunge: never fires","if not DAMAGE_STEPS[tostring(m.step)] or lunge.turn ~= turn or lunge.done == turn then return 0 end","do return 0 end"],
  ["lunge: fires on every board","or lunge.turn ~= turn or lunge.done == turn then return 0 end","or lunge.turn ~= turn then return 0 end"],
  ["lunge: a blocked attacker aims at the player (or swapped)","local to = (a.blocker and cardSpot(a.blocker)) or (a.atkT ~= nil and (LIFE_TRACKERS[a.atkT] ~= nil and playerSpot(a.atkT) or cardSpot(a.atkT))) or nil","local to = (a.atkT ~= nil and (LIFE_TRACKERS[a.atkT] ~= nil and playerSpot(a.atkT) or cardSpot(a.atkT))) or (a.blocker and cardSpot(a.blocker)) or nil"],
  ["lunge: blocker ignored","local to = (a.blocker and cardSpot(a.blocker)) or","local to ="],
  ["lunge: no way back","Wait.time(function() go(enginePlanned[id] or from) end, at + LUNGE_OUT)",""],
  ["lunge: board update fights the swing","if engineAnimUntil ~= nil and (engineAnimUntil[c.id] or 0) > os.clock() then updateBadge(o, c, meta and meta.zone) return end",""],
  ["lines: a player target aimed at a card spot (wrong helper)","if t.k == \"p\" then to = playerSpot(t.c) elseif","if t.k == \"p\" then to = cardSpot(t.c) elseif"],
  ["fix: board not held","    if m.fix == nil or not FIX_HOLD[m.fix.state] or lastTable == nil then return false end","    if true then return false end"],
  ["fix: review not held","FIX_HOLD = { editing = true, review = true, applying = true }","FIX_HOLD = { editing = true, applying = true }"],
  ["fix: kept zones not merged while held","    mergeStatic(m)\n    lastTable = m\n    local ok, err = pcall(engineFixUpdate, m.fix)","    lastTable = m\n    local ok, err = pcall(engineFixUpdate, m.fix)"],
  ["fix: delete allowed","      if not free then tell(player.color, \"During a manual fix cards can be moved, turned and flipped only.\") return false end\n",""],
  ["fix: pick-up not remembered","if action ~= A.Select then engineFixTouched[engineIdOf(o)] = true end",""],
  ["fix: drops answered while held","    if engineFix ~= nil and FIX_HOLD[engineFix.state] then return end\n",""],
  ["fix: untouched cards read","if id ~= nil and engineFixTouched[id] and before[id] ~= nil and o.type == \"Card\" then","if id ~= nil and before[id] ~= nil and o.type == \"Card\" then"],
  ["fix: no control op","if n.zone == \"battlefield\" and n.color ~= b.color then ops[#ops + 1]","if false then ops[#ops + 1]"],
  ["fix: tap read backwards","tapped = (rel > 45 and rel < 135) or (rel > 225 and rel < 315)","tapped = not ((rel > 45 and rel < 135) or (rel > 225 and rel < 315))"],
  ["fix: no move op","        if n.zone ~= b.zone or (n.zone == \"library\" and engineFixBottom[id]) then\n          local op","        if false then\n          local op"],
  ["fix: unplaced accepted","    if #unplaced > 0 then\n","    if false then\n"],
  ["fix: chat numbers dropped","for _, k in ipairs(keys) do ops[#ops + 1] = engineFixExtra[k] end",""],
  ["fix: done with nothing sent","    if #ops == 0 then\n      tell(color, kind == \"hand\"","    if false then\n      tell(color, kind == \"hand\""],
  ["fix: unknown colour taken","if who == nil or n == nil then tell(color, \"Use:  mtg fix \" .. what .. \" <colour> <number>\") return end","if n == nil then return end"],
  ["fix: no is cancel for voters","      if F.waitingFor(fix, c) then engineSend(\"fix\", { color = c, action = \"vote\", accept = false })\n      else","      if false then\n      else"],
  ["fix: done button votes","      elseif fix.state == \"editing\" then engineFixDone(c)\n",""],
  ["fix: voters get no yes button","return who .. \" asks to pause the game for a manual fix.\" .. waits, mine and \"Pause\" or nil","return who .. \" asks to pause the game for a manual fix.\" .. waits, nil"],
  ["fix: refusal not shown","local refused = fix.message and (\"\\nThe engine refused the last list: \" .. tostring(fix.message)) or \"\"","local refused = \"\""],
  ["fix: memory kept after the end","    if fix == nil then engineFixTouched, engineFixExtra = {}, {} end\n",""],
  ["fix: cards stay locked","          o.setLock(false)\n          for _, where","          for _, where"],
  ["fix: name lines kept","name = tostring(o.getName()):match(\"^[^\\n]*\"), kept = kept }","name = tostring(o.getName()), kept = kept }"],
  ["fix: put back counts as moved","        if kept then zone, color = before[id].zone, before[id].color end","        if false then zone, color = before[id].zone, before[id].color end"],
  ["fix: spectators may move cards","      if not engineColors[player.color] then\n        for _, o in ipairs(targets or {}) do if isEngineCard(o) then return false end end\n        return true\n      end\n",""],
  ["fix: pile keeps a dropped card","          container.takeObject({ guid = guid, position = container.getPosition() + Vector(0, 1.2, 0), smooth = false,","          container.takeObject({ guid = \"none\", position = container.getPosition() + Vector(0, 1.2, 0), smooth = false,"],
  ["fix: pile drop not remembered","      engineFixTouched[id] = true\n      Wait.frames(function()","      Wait.frames(function()"],
  ["fix: no attach by dropping","        if n.zone == \"battlefield\" and n.host ~= nil and n.host ~= b.att then ops[#ops + 1] = { op = \"attach\", card = id, to = n.host }","        if false then ops[#ops + 1] = { op = \"attach\", card = id, to = n.host }"],
  ["fix: never comes off","        elseif n.zone == \"battlefield\" and n.host == nil and b.att ~= nil and not n.kept then ops[#ops + 1] = { op = \"attach\", card = id } end","        end"],
  ["fix: host too far counts","local best, bestD = nil, 1.3 ^ 2","local best, bestD = nil, 100 ^ 2"],
  ["fix: library bottom lost","          if n.zone == \"library\" and engineFixBottom[id] then op.position = \"bottom\" end\n",""],
  ["fix: bottom menu marks top","              engineFixBottom[id] = where == \"bottom\" or nil","              engineFixBottom[id] = nil"],
  ["fix: no library menu","          for _, where in ipairs({ \"top\", \"bottom\" }) do","          for _, where in ipairs({}) do"],
  ["fix: life counter not read","      if life ~= nil and pl.life ~= nil and life ~= pl.life and life >= 0 and engineFixExtra[\"life:\" .. c] == nil then","      if false then"],
  ["fix: commander counter not read","        if v ~= nil and v >= 0 and v ~= ((pl.cmdDamage or {})[from] or 0) and engineColors[from] then","        if false then"],
  ["fix: counters stay open after the board edit (board -> any fix)","    ENGINE_FIX_EDIT = board","    ENGINE_FIX_EDIT = fix ~= nil"],
  ["fix: menus kept after the fix","      for _, o in ipairs(F.menued) do if o ~= nil and not o.isDestroyed() then o.clearContextMenu() end end\n",""],
  ["fix: token for the sender only","      if forWho ~= nil then\n        who = nil\n        for c in pairs(engineColors) do if c:lower() == forWho:lower() then who = c end end\n        if who == nil then tell(color, \"No player \"","      if false then\n        who = nil\n        for c in pairs(engineColors) do if c:lower() == forWho:lower() then who = c end end\n        if who == nil then tell(color, \"No player \""],
  ["fix: token never tapped","      local tapped = body:find(\"%f[%a]tapped%f[%A]\") ~= nil","      local tapped = false"],
  ["linger: row hides at once","  if not on and p == nil and engineLinger(color, function() engineRowUpdate(color) end) then return end\n",""],
  ["linger: corner hides at once","  if big == nil and small == nil and p == nil and not over and engineLinger(color, function() engineUpdateCorner(color, nil) end) then return end\n",""],
  ["linger: answer not timed","  engineAnsweredAt[color] = os.clock()\n",""],
  ["guard: thrown cards stay","    engineInHand[id] = true -- (out of a hand by a jump: TTS lays hand cards out again after a smooth move)\n    Wait.frames(function() if lastTable ~= nil then engineRender(lastTable) end end, 2)\n","    engineInHand[id] = true -- (out of a hand by a jump: TTS lays hand cards out again after a smooth move)\n"],
  ["guard: owner check off","    if (meta.zone == \"hand\" or meta.zone == \"playable\" or meta.hand2) and owner == meta.color then return end","    if (meta.zone == \"hand\" or meta.zone == \"playable\" or meta.hand2) then return end"],
  ["guard: no jump","    engineInHand[id] = true -- (out of a hand by a jump: TTS lays hand cards out again after a smooth move)\n",""],
  ["glow: commander not framed","      local mine = m and m.color == color and (m.zone == \"command\" or m.zone == \"playable\")\n","      local mine = false\n"],
  ["untap: gesture taps again","    if u ~= nil then enginePick(color, u) return true end\n    -- tapping a land while you have priority","    -- tapping a land while you have priority"],
  ["autoresolve: toggle never sent","  engineSend(\"autoresolve\", { color = c, on = on and true or false })\n",""],
  ["autoresolve: anyone toggles it","  if id ~= \"eng_autores_\" .. c then return end\n",""],
  ["exile: hand zone 2 ignored (cached list)","if hand == nil then hand = Player[color].getHandObjects(index or 1) or {} engineHandCache.lists[key] = hand end","if hand == nil then hand = Player[color].getHandObjects() or {} engineHandCache.lists[key] = hand end"],
  ["exile: linked full size","if zone == \"attached\" or zone == \"linked\" or zone == \"revealed\"","if zone == \"attached\" or zone == \"revealed\""],
  ["exile: playable cannot be dragged","meta.zone == \"command\" or meta.zone == \"playable\") and area == \"battlefield\" then","meta.zone == \"command\") and area == \"battlefield\" then"],
  ["exile: moving in hand 2 plays","if meta.zone == \"playable\" and isInHand(obj, color, 2) then return end",""],
  ["exile: piles keep special cards","engineZonePile(color, \"exile\", engineWithoutSpecial(pl.exile or {})","engineZonePile(color, \"exile\", (pl.exile or {})"],
  ["exile: unseated seats get a row","if pl.color ~= nil and Player[pl.color] ~= nil and Player[pl.color].seated then\n      for _, c in ipairs(pl.playable or {})","if pl.color ~= nil then\n      for _, c in ipairs(pl.playable or {})"],
  ["exile: link kept after host leaves","c.ew ~= nil and onField[c.ew] ~= nil then","c.ew ~= nil then"],
  ["exile: foretold shown face-up in the public row","        if faceDown[c.id] or c.fo or c.pv then","        if faceDown[c.id] or c.pv then"],
  ["exile: face-down shown in public row","        if faceDown[c.id] or c.fo or c.pv then","        if c.fo or c.pv then"],
  ["exile: no playable glow","or combat[id] or (engineSpecial[id] == \"playable\" and not onlyVia[id] and \"playable\" or nil)","or combat[id]"],
  ["exile: row gap zero","g.right * (lat + span / 2 - k * step)","g.right * (lat + span / 2)"],
  ["exile: linked cards not spread across the host","+ g.right * across + Vector(0, -0.02 * n, 0)","+ Vector(0, -0.02 * n, 0)"],
  ["mill: stand-ins never fly","if not held[c.id] and k < MILL_FLY and g ~= nil and not engineAnimOff then","if false then"],
  ["mill: held cards fly too","if not held[c.id] and k < MILL_FLY and g ~= nil and not engineAnimOff then","if k < MILL_FLY and g ~= nil and not engineAnimOff then"],
  ["mill: backs fly to the hand again","local quiet = k <= milled","local quiet = false"],
  ["slide-away: stand-ins stay on the table","  Wait.time(function() if obj ~= nil and not obj.isDestroyed() then engineDispose(obj) end end, after)",""],
  ["settings: anyone switches the table's animations","if player.color ~= idColor(id) or not player.host then return end","if player.color ~= idColor(id) then return end"],
  ["settings: animations off doesn't stop the swing","if engineCombatLunge ~= nil and not engineAnimOff then","if engineCombatLunge ~= nil then"],
  ["settings: animations off doesn't stop mills flying","and g ~= nil and not engineAnimOff then","and g ~= nil then"],
  ["settings: my effects off still shows the pop-up","if not enginePopClosed[c] and not engineEffectsOff[c] then","if not enginePopClosed[c] then"],
  ["settings: my effects off still shows the turn banner","if not first and not engineEffectsOff[color] then","if not first then"],
  ["settings: the tab lists the graveyards","  elseif tab == \"settings\" then\n    -- (the host's switch","  elseif false then\n    -- (the host's switch"],
  ["panel: opens for questions the table handles","engineShown[m.color] = (not handled) and \"ask\" or nil","engineShown[m.color] = handled and \"ask\" or nil"],
  ["panel: a pinned panel closes by itself","if engineShown[m.color] ~= \"pin\" and engineShown[m.color] ~= \"browse\" then","if engineShown[m.color] ~= \"browse\" then"],
  ["panel: shown by default","local open = inGame and (engineShown[color] ~= nil","local open = inGame and (engineShown[color] ~= \"ask\""],
  ["panel: the Choices tab never pins","if was == nil then engineShown[color] = not engineShown[color] and \"pin\" or nil","if was == nil then engineShown[color] = nil"],
  ["side tabs: don't open the panel","engineShown[color] = engineShown[color] or \"browse\"","engineShown[color] = engineShown[color]"],
  ["pop X: closes it for everyone","if not enginePopClosed[c] and not engineEffectsOff[c] then v[#v + 1] = c end","if not engineEffectsOff[c] then v[#v + 1] = c end"],
  ["pop: stays closed for the next card","enginePopClosed = {}\n    popVisibility()","popVisibility()"],
  ["pop: all closed shows it to everyone","if #v == 0 then","if false then"],
  ["card row: shown with no cards (> 0 -> >= 0)","local on = (#tiles > 0 and #tiles <= ROW_MAX","local on = (#tiles >= 0 and #tiles <= ROW_MAX"],
  ["corner label: never shortened", "if bigLabel and #bigLabel > 22 and bigLabel:find(\":\")", "if bigLabel and #bigLabel > 99 and bigLabel:find(\":\")"],
  ["pop-up picture: wrong proxy route", "cards.scryfall.io/normal/%1/%2/%3/%4.jpg", "cards.scryfall.io/normal/%1/%3/%2/%4.jpg"],
  ["pop-up closes while its spell is still on the stack","  for _, st in ipairs(m.stack or {}) do if st.id == shown.id then return end end\n  popShown = nil","  popShown = nil"],
  ["picked colour back to blue", "if picked then return \"#E53935\" end", "if picked then return \"#3742fa\" end"],
  ["green frame thinner", "string.format(PLAYABLE_BAR, 266, 13, \"UpperCenter\")", "string.format(PLAYABLE_BAR, 266, 7, \"UpperCenter\")"],
  ["glow: copies not framed", "if st and names[st.n] and meta", "if st and false and meta"],
  ["prompt kind: one card isn't a card choice (> 0 -> > 1)", "if cards > 0 then return \"cards\" end", "if cards > 1 then return \"cards\" end"],
  ["multi pick: one more than max (< -> <=)", "elseif count(engineSelected[color]) < (p.max or 99) then", "elseif count(engineSelected[color]) <= (p.max or 99) then"],
  ["confirm: the minimum refused (>= -> >)","return n >= (p.min or 0) and n <= (p.max or 99)","return n > (p.min or 0) and n <= (p.max or 99)"],
  ["thinking hint text", "hint = \"Thinking...\"", "hint = \"Working...\""],
  ["phase bar not refreshed on board updates", "else engineUpdateCorner(c, enginePrompts[c]) end", "end"],
  ["scoop box: not owner-only","'<Panel id=\"eng_scoopask_' .. c .. '\" visibility=\"' .. c .. '\" width=\"620\"","'<Panel id=\"eng_scoopask_' .. c .. '\" width=\"620\""],
  ["row tile picked colour", "and \"#E53935\" or \"#FFFFFF14\")", "and \"#FFFFFF14\" or \"#FFFFFF14\")"],
  ["hint: waiting line dropped","hint = engineTeamPriorityHint(t, color) or (\"Waiting for \" .. engineNameOf(t.priority) .. \"...\")","hint = engineTeamPriorityHint(t, color) or \"\""],
  ["row opt: first single option not orange", "(e.primary or (p.mode == \"single\" and k == 1))", "(e.primary)"],
  // second batch, on the older core (placement, tapping, piles, glows, deck keys, the base table's guards)
  ["grid: column step 2.4 -> 2.5", "local GRID = { colStep = 2.4,", "local GRID = { colStep = 2.5,"],
  ["rows: lands in the creature row", "local ROWS = { creature = 0, other = 2, land = 4.7 }", "local ROWS = { creature = 0, other = 2, land = 0 }"],
  ["long rows not squeezed","local step = width > GRID.perRow and GRID.perRow / width or 1","local step = 1"],
  ["tapped cards not turned", "g.rotY + ((c.tap or engineHeldTapped(c.id)) and 90 or 0), c.fd and 180 or 0)", "g.rotY + 0, c.fd and 180 or 0)"],
  ["face-down cards face up", "(c.tap or engineHeldTapped(c.id)) and 90 or 0), c.fd and 180 or 0)", "(c.tap or engineHeldTapped(c.id)) and 90 or 0), 0)"],
  ["attachments full size", "local ATTACH_SCALE = 0.5", "local ATTACH_SCALE = 1"],
  ["piles: oldest card on top (loop reversed)","for i = #cards, 1, -1 do -- newest first","for i = 1, #cards do -- newest first"],
  ["piles: a lone card's face up/down swapped","place(c, onTable(base), Vector(0, rotY, c.fd and 180 or 0)","place(c, onTable(base), Vector(0, rotY, c.fd and 0 or 180)"],
  ["card picture numbers start elsewhere", "local ENGINE_KEY_BASE = 3000", "local ENGINE_KEY_BASE = 3001"],
  ["attacker glow colour", "BASE_GLOW = { stack = {0.75, 0.35, 1}, atk = {1, 0.12, 0.08}", "BASE_GLOW = { stack = {0.75, 0.35, 1}, atk = {1, 0.5, 0.08}"],
  ["blocked-tool message says nothing", "broadcastToAll(\"[MTG] Engine mode is on: '\" .. tostring(what)", "print(\"[MTG] Engine mode is on: '\" .. tostring(what)"],
  ["stack pop-up text keeps the engine prefix", "if cut ~= nil then text = text:sub(cut + 1) end", "if false then text = text:sub(cut + 1) end"],
  // 2026-10-21 playtest fixes: Scoop on screen, the cannon and die hidden in engine mode, the "can't be chosen" hint
  ["pt3 scoop: shown for a player who lost", "if pl.color == c and pl.status == \"playing\" then show = true end", "if pl.color == c then show = true end"],
  ["pt3 scoop: shown outside a game", "if running and Player[c] ~= nil and Player[c].seated then", "if Player[c] ~= nil and Player[c].seated then"],
  ["pt3 scoop: anyone opens anyone's box", "if id == \"eng_scoop_\" .. player.color then engineUI.setAttribute", "if true then engineUI.setAttribute"],
  ["pt3 scoop: anyone concedes for anyone", "if id ~= \"eng_scoopyes_\" .. player.color then return end", "if false then return end"],
  ["pt3 scoop: box stays open after Scoop","  engineUI.setAttribute(\"eng_scoopask_\" .. player.color, \"active\", \"false\")\n  engineSend(\"concede\"","  engineSend(\"concede\""],
  ["pt3 scoop: Keep playing does nothing", "if id == \"eng_scoopno_\" .. player.color then engineUI.setAttribute(\"eng_scoopask_\" .. player.color, \"active\", \"false\") end", ""],
  ["pt3 scoop: not in the screen UI", "rewindXml(c) .. scoopXml(c)", "rewindXml(c)"],
  ["pt3 hide: the die stays out","local HIDE_IN_ENGINE_MODE = { \"540e21\", \"ee33ec\", \"9065aa\", \"e8e28d\" }","local HIDE_IN_ENGINE_MODE = { \"540e21\", \"9065aa\", \"e8e28d\" }"],
  ["pt3 hide: lock not restored", "o.setLock(locked == \"true\")", "o.setLock(false)"],
  ["pt3 hide: a second hide overwrites home", "if o ~= nil and on and home == nil then", "if o ~= nil and on then"],
  ["pt3 hide: engine mode doesn't hide","  engineHideForEngine(on)\n  if not on and engineStatusParkAll","  if not on and engineStatusParkAll"],
  ["pt3 hint: also for hand cards", "if id ~= nil and (engineMeta[id] or {}).zone == \"battlefield\" and firstClick(obj) then", "if id ~= nil and firstClick(obj) then"],
  ["pt3 scoop: not redrawn after the UI rebuild", "      if engineScoopRedraw ~= nil then engineScoopRedraw() end -- and with Scoop hidden", ""],
  ["sy held draws: never handed over", "for _, id in ipairs(list) do if wanted[id] then engineReleasePending(m.color, \"all\") break end end", "for _, id in ipairs(list) do if false then engineReleasePending(m.color, \"all\") break end end"],
  ["sy held draws: handed over for any question", "wanted[id:gsub(\"^card|\", \"\")] = true", "wanted[id:gsub(\"^card|\", \"\")] = true for _, x in ipairs(p.draw) do wanted[x] = true end"],
  ["sy race: drawn cards held while a question asks about them","if held[(tostring(o.cardId or o.id or \"\"):gsub(\"^card|\", \"\"))] then p.draw = {} break end","if false then p.draw = {} break end"],
  ["fx: deaths not counted","if now.bf[id] == nil and (now.gy[id] ~= nil or (x.tok and not exd[id] and now.ex[id] == nil and not away)) then","if false then"],
  ["fx: no xN on a board wipe","      if n > 1 then\n        target.createButton","      if n > 99 then\n        target.createButton"],
  ["fx: countered without the bridge naming it","if st.src ~= nil and ctrd[st.src] then countered[st.id] = true end","if st.src ~= nil then countered[st.id] = true end"],
  ["fx: COUNTERED never shown","if countered[st.id] and (st.spell or st.sp) and panelReadyForPopup() then","if false then"],
  ["fx: a concession gets no knock-out banner","if status ~= nil and status ~= \"playing\" and prev.status[c] == \"playing\" then","if status == \"lost\" and prev.status[c] == \"playing\" then"],
  ["fx: VICTORY for everyone","elseif engineWonBy(m, viewer) then result(viewer, \"VICTORY\"","elseif true then result(viewer, \"VICTORY\""],
  ["fx: one banner mark for all players","FX.resultMark[c] = (FX.resultMark[c] or 0) + 1\n    local mark = FX.resultMark[c]\n    Wait.time(function() if FX.resultMark[c] == mark","FX.resultMark.all = (FX.resultMark.all or 0) + 1\n    local mark = FX.resultMark.all\n    Wait.time(function() if FX.resultMark.all == mark"],
  ["fx: banners ignore 'mtg effects off'","if engineEffectsOff[c] or Player[c] == nil","if Player[c] == nil"],
  ["auto: off by default again","function engineAutoOn(color) return engineAutoPace[color] ~= false end","function engineAutoOn(color) return engineAutoPace[color] == true end"],
  ["auto: 15 s again","local AUTO_DELAY = 2","local AUTO_DELAY = 15"],
  ["clickable: never unlocked","if not wasClickable[id] and o ~= nil and not o.isDestroyed() and o.getLock() then o.setLock(false) end",""],
  ["clickable: never locked again","if not engineClickable[id] and o ~= nil and not o.isDestroyed() and not isFree(meta) and not inHand then o.setLock(true) end",""],
  ["clickable: render locks it anyway","local free = isFree(meta) or engineClickable[c.id] == true","local free = isFree(meta)"],
  ["group grows: no gold","color = (b[1] == \"grp\" and grew) and BADGE.grew or b[3]","color = b[3]"],
  // 2026-10-21 hand-play sweep fixes
  ["sw1 pay: first button again, not the best", "and (o.rank or 1) > best then i, best = k, (o.rank or 1) end", "and best < 0 then i, best = k, (o.rank or 1) end"],
  ["sw1 pay: a useless land still sends", "if i ~= nil and best == 0 then", "if false then"],
  ["sw2 control change: old spot kept","if was ~= nil and was.color ~= nil and was.color ~= owner then engineManual[c.id] = nil end",""],
  ["sw4 picked: not shown", "    if tostring(o.id) == tostring(id) and not engineSelectedFor(color, i) then", "    if false then"],
  // M5 step 2: badges and life changes
  ["m5 badge: lowered P/T not red","lower and BADGE.down or (known and BADGE.up or BADGE.black)","(known and BADGE.up or BADGE.black)"],
  ["m5 badge: damage not taken off toughness","engineCompact(t and (t - dmg) or c.t)","engineCompact(c.t)"],
  ["m5 badge: loyalty not shown", "elseif special ~= nil then parts[#parts + 1] = { \"pt\", special, BADGE.black } end", "end"],
  ["m5 badge: token count on a lone card (> 1 -> >= 1)","  if (c.groupN or 1) > 1 then\n    if c.groupInf","  if (c.groupN or 1) >= 1 then\n    if c.groupInf"],
  ["m5 badge: redrawn every board","  if engineBadge[c.id] == text .. \"#\" .. ab then return end\n",""],
  ["m5 life: changes don't add up", "if seen.at == nil or os.clock() - seen.at > 3 then seen.base = seen.life end", "seen.base = seen.life"],
  ["m5 life: no change shown", "if o.getVar(\"engineLifeChange\") ~= nil then", "if false then"],
  ["m5 life: first board of a game flashes", "  engineLifeSeen[color] = seen or { life = life }", "  engineLifeSeen[color] = seen or { life = 40 }"],
  ["pt3 hint: never said","      tell(color, what .. ((sorts.players","      print(what .. ((sorts.players"],
];

// Preflight, before any test runs: every edit must apply to today's script exactly once, change it, and leave a
// script that still parses (a mutant that no longer applies, or one that only breaks the syntax, is a broken tool,
// not a kill). Any failure stops the run with exit 2, loudly: the old tool skipped them as "NOT APPLIED" and 41 of
// its 162 edits went stale unseen (audit 2026-11-24).   node tools/mutate-table.js --check   (the preflight only)
const luaparse = require(path.join(ROOT, "tests", "lua", "node_modules", "luaparse"));
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const SOURCES = ["engine-renderer.lua"].map((f) => path.join(ROOT, "tools", f));
const sourceSha = () => SOURCES.map((f) => sha(fs.readFileSync(f))).join(",");
const only = process.env.MUT_ONLY ? new RegExp(process.env.MUT_ONLY) : null;
const chosen = M.filter(([n]) => !only || only.test(n));
const stale = [];
const names = new Set();
for (const [name, from, to] of M) {
  if (names.has(name)) stale.push(`${name}: the name is used twice`);
  names.add(name);
  const n = pristine.split(from).length - 1;
  if (n !== 1) { stale.push(`${name}: found ${n}x`); continue; }
  if (from === to) { stale.push(`${name}: changes nothing`); continue; }
  try { luaparse.parse(pristine.replace(from, to), { luaVersion: "5.2", comments: false }); }
  catch (e) { stale.push(`${name}: the mutant does not parse (${String(e.message).slice(0, 80)})`); }
}
if (stale.length) {
  console.log(`STALE: ${stale.length} of ${M.length} edits no longer apply to the table's script; repair them first:`);
  for (const s of stale) console.log(`  STALE  ${s}`);
  process.exit(2);
}
console.log(`preflight: all ${M.length} edits apply once and parse`);
if (process.argv.includes("--check")) process.exit(0);

// The oracle: the golden first (in its first-fail mode); an edit it misses then goes through the table tests that
// close the golden's gaps (tests/test_table_golden_gaps.js: one crafted input per edit the golden let through),
// stopping at the first that fails. Both counts are reported: the golden's alone and with those tests.
// MUT_TESTS=a,b: other TABLE_SAVE tests for that second stage ("none": the golden alone; the whole table suite per
// escape costs ~30 min on a busy machine, so it is not the default).
// MUT_SLOT=<slot runner>: each test run waits for a shared CPU slot (node <runner> node <test>); or run the whole tool
// under one (node slot.js node tools/mutate-table.js), which is quicker when the slots are contended.
const BACKUP = process.env.MUT_TESTS === "none" ? [] : (process.env.MUT_TESTS || "test_table_golden_gaps").split(",").map((s) => s.trim()).filter(Boolean);
function runTest(test) {
  const args = [path.join(ROOT, "tests", test + ".js")];
  const cmd = process.env.MUT_SLOT ? [process.env.MUT_SLOT, process.execPath, ...args] : args;
  const r = spawnSync(process.execPath, cmd, { env: { ...process.env, TABLE_SAVE: FILE, GOLDEN_FIRST_FAIL: "1" }, encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status === 0) return null;
  // a check fails by name; a crash (no FAIL line) is still a catch, but says so
  const out = String(r.stdout || "").split("\n");
  return out.find((l) => l.startsWith("FAIL")) || `crash (exit ${r.status}): ${(String(r.stderr || "").split("\n").find((l) => l.trim()) || "").slice(0, 120)}`;
}

// a test only counts as a catcher once it passes on the unmutated script (checked the first time it is needed)
const cleanOk = {};
function catches(test) {
  if (!(test in cleanOk)) {
    fs.writeFileSync(FILE, JSON.stringify(save));
    cleanOk[test] = runTest(test) === null;
    if (!cleanOk[test]) console.log(`  (${test} fails on the unmutated script: not used as a catcher)`);
  }
  return cleanOk[test];
}
if (!catches("test_table_golden")) { console.log("ABORT: the golden fails on the unmutated script"); process.exit(3); }
const before = sourceSha(), pristineSha = sha(pristine);
const results = [];
for (const [name, from, to] of chosen) {
  // (the sources are never touched: each mutant is a built copy; checked before every edit all the same)
  if (sourceSha() !== before || sha(pristine) !== pristineSha) { console.log("ABORT: the sources changed during the run"); process.exit(3); }
  const mutant = JSON.stringify({ ...save, LuaScript: pristine.replace(from, to) });
  fs.writeFileSync(FILE, mutant);
  let by = runTest("test_table_golden"), where = "golden";
  if (by === null) for (const t of BACKUP) {
    if (!catches(t)) continue;
    fs.writeFileSync(FILE, mutant);
    by = runTest(t);
    if (by !== null) { where = t; break; }
  }
  const result = by === null ? "ESCAPED" : where === "golden" ? "caught" : "caught (table tests)";
  results.push({ name, result, by: by && `${where}: ${by.slice(0, 160)}` });
  console.log(`${by === null ? "ESCAPED" : "caught "}  ${name}${by ? `   <- ${where}: ${by.slice(0, 110)}` : ""}`);
}
fs.rmSync(FILE, { force: true });
const grade = (k, n) => `${k} escaped (${(100 * k / (n || 1)).toFixed(1)}%) -> ${k === 0 ? "suspicious (0%: check the tool)" : k / n < 0.25 ? "SOUND" : "WEAK"}`;
const golden = results.filter((r) => r.result !== "caught").length;
const all = results.filter((r) => r.result === "ESCAPED").length;
const summary = { date: new Date().toISOString().slice(0, 10), mutations: results.length, goldenEscaped: golden, escaped: all,
  goldenGrade: grade(golden, results.length), grade: grade(all, results.length), only: only ? String(only) : undefined };
console.log(`\n${results.length} mutations. Golden alone: ${summary.goldenGrade}. Golden + table tests: ${summary.grade}`);
for (const r of results.filter((x) => x.result === "ESCAPED")) console.log(`  ESCAPED  ${r.name}`);
// (a MUT_ONLY re-check writes its own file: it overwrote the full record once, leaving a 2-entry stub)
fs.writeFileSync(path.join(ROOT, "tmp", only ? "mutate-table-only.json" : "mutate-table.json"), JSON.stringify({ summary, results }, null, 1));
process.exit(all ? 1 : 0);
