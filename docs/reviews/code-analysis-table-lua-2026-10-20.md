# Code Analysis Report: the table's engine Lua

**Analyzed files:**
- `tools/engine-renderer.lua` (2,849 lines, SHA-256 `424667109836…`, unchanged by this review)
- The Lua that `tools/make-engine-copy.js` (563 lines, SHA-256 `7c0d342f28c6…`, unchanged) injects into the table's Global script: the ENGINE MODE block (mec:162–430) and the `guard()` / `patchScripts()` one-line insertions (mec:53–119, 130–501)

**Read for context (not under review):** `tests/lua/tts-sim.lua`, `tests/lua/run-sim.js`, `tests/golden/table-run.js`, `tests/test_table_golden.js`, `tools/lua-scan.js`, `tools/add-exported-objects.js` (key range), the original workshop Global (`2296042369.json`, to check which TTS event handlers the renderer overrides or chains), `bridge/bridge.js` (`tableCard`, `slimmer`, `flushTexts`, `resetGame`, `/msg`, number and option prompts), `SPEC.md` §10a, `docs/our-code-reference.md` §7, memory notes `tts-perf-facts` and `tts-json-encode-hang`.

**Ruleset:** code-analysis-ruleset v1.2 (findings only, no fixes applied)
**Date:** 2026-10-20 · **Runtime used for repros:** Node v24.15.0 + fengari 0.1.5 (Lua 5.3) with the fake TTS · **Golden test before:** `node tests/test_table_golden.js` → all 2 games match (676 steps) · **`node tools/lua-scan.js`:** 0 names used before a later `local`; 4 never-assigned globals, all expected (`Encoder`, `vector`, `fSize` in the original table code; `storeRewindState` is a TTS v14 API)

**Line numbers:** `er:N` = `tools/engine-renderer.lua`, `mec:N` = `tools/make-engine-copy.js`. In the built save the renderer starts at Global line 3070, so a TTS error at `Global:N` is `er:(N−3069)`.

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 2 |
| MEDIUM | 10 |
| LOW | 5 |

---

## Executive Summary

The biggest risk is hidden information. The bridge builds each board from the first human seat's view (bridge.js `sendTable`, `tableCard`), so that seat's own face-down cards arrive with their names and pictures. The single-card path honours `fd`, but the graveyard/exile pile builder and the "Graveyards / exile" browse list do not. A foretold or otherwise face-down exiled card is drawn **face up** on top of the exile pile and listed by name in every other player's panel (F1, reproduced). A related gap is that the library search deck can be opened by any player with TTS's Search, and pulling a card out answers the owner's search (F6). The second risk is performance at the end of a game. `mtg reset` and every reload destroy each engine object with `destruct()`. That is the ~360 ms-per-call operation the trash deck was built to avoid. A 40-card board took 42 `destruct()` calls in the simulator (~15 s of freezes). A late 4-player board would be about 35–55 s (F2).

The third group is state that outlives a game. Forge numbers cards `engine-card-N` from 1 again every game, and `engineClear` keeps several per-id tables. The next game's card with the same id can show the previous game's rules text, be drawn face down because the previous card was flipped, or have its library deck built from an old search (F4). Wait callbacks scheduled up to 0.6 s before a reset still spawn and trash objects afterwards. They leave an invisible `engine:trash` deck that makes `mtg start` refuse with "cards from the last engine game are still on the table" (F5). `onExternalMessage` has no error barrier. Four partial-message shapes abort a whole update, and one non-string log line breaks every later log update (F3). Other findings: number questions above min+59 can't be answered (F7), an enchanted token is grouped away so its aura floats in the wrong row (F8), and a double Select+PickUp event can undo an attack or an "up to N" target pick (F9, depends on TTS emitting both events). `mtg reset` has no local fallback when the bridge is down (F10). "Auto: on (15 s)" can release a held draw after about 5 s (F11), and an option without a label blanks that question's buttons (F12).

Domain/regulatory coverage: not applicable / not assessed. MTG rules correctness (e.g. whether the draw/mill/untap heuristics in `detectPending` match Forge) was **not** verified against Forge. Third-party semantics (TTS behaviour of Search on locked decks, Select/PickUp event pairs, `onObjectDestroy` on `putObject`, MoonSharp vs Lua 5.3 differences, Forge view contents for face-down cards) were inferred. Each is marked *Unsure* where a finding depends on it. Community sources (GitHub/Stack Overflow/Reddit) were not consulted: this session had no web research step. Evidence is the code, the project's own measurements, and simulator runs.

---

## Reading Audit Trail

| File | Lines read | Passes | Notes |
|---|---|---|---|
| tools/engine-renderer.lua | 1–2849 (100%) | 1 full + targeted re-reads | Re-read: 110–175 (trash), 196–325 (`place`), 332–428 (pace detection), 440–475 (grouping), 656–808 (render), 873–907 (clear/start), 1328–1404 (pick/confirm), 1583–1633 (prompt), 1674–1798 (gestures, containers), 1984–2106 (phase-2 clicks), 2139–2161 (reload), 2196–2297 (library), 2311–2550 (piles), 2625–2715 (pace release) |
| tools/make-engine-copy.js | 1–563 (100%) | 1 full + re-read of 162–430 | the template Lua (chat commands, outbox, `onExternalMessage`) and every `guard()` target |
| original workshop Global (2,804 lines) | handler inventory + 1–40, 990–1010, 1855–1885 | 1 | confirmed the renderer's `onSave`, `onUpdate`, `onPlayerAction`, `onObjectDrop`, `onObjectDestroy`, `onObjectLeaveContainer`, `tryObjectEnterContainer` overwrite nothing; `onObjectSpawn`/`onObjectEnterContainer` are chained |
| built Global in tmp/table-build/table.json | guarded function signatures | 1 | `playerColor`/`ply` parameter names match the `guard()` call bodies |
| tests/lua/tts-sim.lua, run-sim.js, golden/table-run.js | 100% | 1 | to know what the simulator models (no physics, no `onObjectDestroy`, spawn callbacks 1 frame later, locked decks refuse `putObject`) |
| bridge/bridge.js | 380–395, 589–604, 700–830, 886–895, 1192–1240, 1380, 1697–1720 | 1 | message shapes the table receives |

Repro script: session scratchpad `repro.js` (not in the repo). It loads `tests/lua/run-sim.js` `simulate()` read-only against the save `node tests/test_table_golden.js` builds. Repro IDs R1–R14 are cited per finding.

---

## Findings

### F1. HIGH · State/visibility: face-down exiled cards are drawn face up in the exile pile and named in every player's browse list

**Lines:** er:2463–2479 (pile deck: `face = (c.n ~= nil and c.f)`, `Nickname = nickname(c)`, deck spawned at rotation `Vector(0, rotY, 0)`, newest card on top), er:1108–1124 (`browsePrompt` lists every graveyard/exile card with `c.n ~= nil`, ignoring `c.fd`). Contrast er:2423, where the one-card path does honour `c.fd`.

**Mechanism:** `sendTable` builds every player's public zones from `seats[0]`'s game view (bridge.js `pub`). `tableCard` (bridge.js:590–597) hides a card only when the *viewer* can't see it. That seat's own face-down cards arrive with `n`, `f`, `tx` **and** `fd: true`. The renderer's pile deck and browse list use `n`/`f` and never look at `fd`.

**Reproduced (R13):** Blue's exile `[e1 Lightning Bolt, e2 Secret Plan fd:true]` with Blue and White seated. Result: `exile pile rotZ=0 holds engine:e2=Secret Plan, engine:e1=Lightning Bolt` (the face-down card is the face-up top card), and **White's** browse panel lists `Secret Plan (Blue's exile)`.

**Impact:** In a game with two or more humans, the first human seat's foretold, hideaway or "exile face down" cards are visible to the whole table. The name is also in the tooltip (`Nickname`) of the pile's cards, which anyone can Search.

**Unsure:** whether Forge's owner view really carries `identity` for every face-down exile mechanic. The table side is verified. The same mechanism probably reaches face-down **battlefield** cards (er:488 rotates them, but `Nickname`/`Description` carry the real name and text; whether TTS shows a face-down card's name on hover depends on `hide_when_face_down`, not verified) and a face-down **spell on the stack** (er:756–763 spawns it face up from `engineStatic`; the stack pop-up er:629–653 shows `newest.n` to everyone).

**Potential Fix Direction:** Treat `c.fd` as hidden everywhere the table builds a picture or a label: in the pile deck entry (back image, "Face-down card"), in `browsePrompt`, and on the stack/pop-up. Longer term, the bridge should send public zones from a neutral view (or strip identity when `isFaceDown`), so the table never receives what another seat must not see.

---

### F2. HIGH · CPU/performance: `mtg reset` and every reload destroy every engine object one by one (~360 ms each)

**Lines:** er:874–881 (`sweepEngineCards` calls `o.destruct()` per object), called from er:884 (`engineClear`), er:904 (`engineStarted` when `lastTable == nil`) and er:2158 (the load-time handler, 30 frames after every load or Save & Play). Also er:854 (`restoreStash` destructs stray `libcard`s).

**Promise broken:** The comment at er:120–125 explains that each `destruct()` costs ~360 ms and that 5 in a frame cost 1.8 s (measured 2026-10-19, memory `tts-perf-facts`: "Never call destruct() on engine cards"). It says cards are therefore merged into a trash deck and "the game's end clears the rest". The game's end instead destructs every live engine card individually.

**Reproduced (R9):** 40 battlefield cards plus library → **42 `destruct()` calls in the single `clear` step**. At the measured cost that is ~15 s of frozen frames for every player. A late 4-player commander board (≈100–150 engine objects: battlefields, hands, stack, single-card piles) extrapolates to ≈35–55 s. The same happens when the host reloads mid-game. The frame-30 sweep runs, then the bridge's `started` re-stashes and the board is rebuilt.

**Unsure:** the extrapolation assumes the measured cost is linear (5 → 1.8 s suggests it is). Destroying a big deck (the trash, library) was not measured separately.

**Potential Fix Direction:** Sweep through `engineDispose` (merge into the trash deck, which is free), then destruct only the trash deck(s) once. Alternatively, spread the sweep over frames and show a "clearing the table" message. The load-time sweep can do the same.

---

### F3. MEDIUM · Error handling: `onExternalMessage` has no error barrier; partial messages abort the whole update

**Lines:** mec:396–421 (no `pcall`; only pop-ups er:739, the prompt's panel/glow calls er:1623–1632 and the card row er:1249 are protected). Throw sites found:
- er:669 `engineStatusSeen[pl.color or pl.slot] = …`: a player entry with neither `color` nor `slot`.
- er:470 `engineGroupOf[c.id] = nil`: a battlefield card without `id` (er:262 `place` guards `c.id == nil`, so the author expected it).
- er:1593 / er:2699: `enginePrompts[m.color] = …` / `paceArmed[m.color] = true` on a prompt without `color`. This includes the `promptId: null` close message (`table index is nil`).
- er:1505: `table.concat` over `engineLog` when a log line isn't a string. The bad line stays in `engineLog` (er:1510), so **every later `gamelog` message also fails** until 200 newer lines push it out (er:1511).

**Reproduced (R8, R12):** each shape above raised `Global:3738/3539/4662/5768: table index is nil` or `Global:4574: invalid value (table) at index 1 in table for 'concat'` from `onExternalMessage`. Not raised: missing `id` on a stack item, missing `text` in chat, `started` without `colors`, `refused` without `id`, `texts` as a list.

**Impact:** For a `table` message, `lastTable = m` is already set (er:660) when layout starts. An error mid-render leaves part of the board drawn, with no trackers and no panel update. The next board then diffs against this half-applied one. The current bridge always sends `color`/`slot`/`id` and string log lines, so today these are latent. The bridge does send `color: null` for a sixth player (bridge.js:384), which the render path survives thanks to `pl.slot`.

**Potential Fix Direction:** Wrap the `onExternalMessage` dispatch in `pcall` and print `t` and the error (mirroring the bridge's `guarded()`). Validate `m.color` before indexing per-colour tables. Coerce log lines with `tostring` when storing them.

---

### F4. MEDIUM · State: per-card-id state survives `mtg reset`, and Forge reuses the same ids in the next game

**Lines:** `engineClear` er:883–893 and `enginePileReset` er:2491–2499 reset objects, piles, groups and glows. They do **not** reset `engineFlipped` (er:258), `engineStatic` (er:555), `engineSearch`/`engineSearchIds` (er:2166–2167), `engineChoosable` (er:2303), `libraryState` (er:2165), `enginePending` (er:337; reset later in `engineStarted`), `engineBadge`, `engineStatusSeen`, `engineBannerSeen` or `playableShown`. Card ids are `engine-card-N` and restart every Forge game (fixtures).

**Reproduced consequences:**
- **R1, flipped look carries over:** in game 1 Blue flips their commander `engine-card-1` "to look" (allowed, er:1681–1685) → `mtg reset` → game 2's commander (a different card, same id) spawns with **rotZ=180**, face down for everyone. `place` (er:263–267) clears the flag only when the card leaves the battlefield/command zone, so a commander that stays in the command zone stays flipped for the whole next game.
- **R2, wrong rules text:** game 1's `engine-card-7` Counterspell gets "Counter target spell." → reset → game 2's `engine-card-7` is Grizzly Bears. Its hover text is **"Counter target spell. / 2/2"**. Cause: `engineStoreStatic` (er:569) keeps the old `tx` whenever the new static has none. The bridge **never** puts `tx` in statics and only queues texts that are non-empty (bridge.js:739–746), so a vanilla card keeps the previous game's text for the whole game. The same text is shown in the browse list (er:1366).
- **R3, old search candidates:** a search open at reset → game 2's first library deck is built as a search deck holding **`engine:engine-card-50/Forest`** from game 1, until that colour's next prompt. This one is known: reference §7 #15 lists `engineSearch`. This repro shows its concrete effect.

**Potential Fix Direction:** Reset every per-id and per-colour game table in `engineClear`, and probably in `engineStarted` too, since a reload starts with fresh memory. Keep only true preferences across games (`engineAutoPace`, `engineGlowOff`, `engineStops`, `engineKeys`). In `engineStoreStatic`, keep the old `tx` only when the card's name is unchanged.

---

### F5. MEDIUM · State/Wait lifetime: callbacks scheduled before a reset spawn and trash objects after it; `mtg start` then refuses

**Lines:** er:2477–2486 (pile deck spawn delayed 0.5 s with `Wait.time`, not tied to the game), er:2218 and er:2454 (dispose 0.6 s later), er:157–174 (`engineDispose` spawns a **new** trash deck when `engineTrash` is nil, which `sweepEngineCards` set at er:880), mec:215–220 (`mtg start` refuses while any `^engine:` GM-note object exists).

**Reproduced (R6):** a 2-card graveyard is drawn, then `clear` arrives 2 frames later. 60 frames on, the table holds `engine:trash (Engine trash)`. That is a fresh trash deck, hidden from every colour via `setInvisibleTo` and not interactable. `mtg start` answers *"Cards from the last engine game are still on the table. Type mtg reset…"*. Nobody can see any card. The way out is another `mtg reset`, which restarts the Forge room.

**Related (code reading, not reproduced):** `place` and `engineLibraryDeck` spawn callbacks (er:288–297, er:2253–2266) write into the **new** `engineObjs` table if they finish after `engineClear`. A library deck in flight is kept (`libraryState` isn't reset, so `now == built`), and `keepOnly` adopts it.

**Potential Fix Direction:** Give each game a generation counter, incremented in `engineClear` and `engineStarted`. Every delayed closure and spawn callback captures it and does nothing (or disposes its object) when it's stale. Separately, have `mtg start` ignore `engine:trash`, or sweep it.

---

### F6. MEDIUM · Vulnerability/visibility (TTS semantics *unsure*): any player can Search the owner's library search deck, and a card pulled out answers the owner's search

**Lines:** er:2176–2194 (the search deck holds the candidates face-down, with names and pictures), er:2270–2282 (`onObjectLeaveContainer` sends `intent choose` with `color` taken from the **deck's** GM notes, not from the player who pulled the card), er:1674–1695 (`onPlayerAction` can block PickUp/FlipOver, but TTS has no `Player.Action` for Search).

**Issue:** SPEC §10a promises "Opponents' cards: look and zoom only" and "you can pick up only cards you control". During a tutor, the library deck holds exactly the cards the search may find. Those are hidden cards from the owner's library. If TTS lets a non-owner open Search on a locked deck (*not verified in TTS; nothing in the code prevents it*), opponents can read the list. Dragging one out sends the owner's answer. This is the library twin of reference §7 #22 (piles). Also related: §7 #23, one global `engineSearchIds`.

**Potential Fix Direction:** Answer only when the leaving card ends up with its owner. Check that the object lands in the owner's hand or area on the next frame, or use `onObjectPickUp`/`onObjectDrop`, which carry the player colour. If TTS allows it, mark the deck with `setHiddenFrom`/`setInvisibleTo` for other colours while it holds candidates.

---

### F7. MEDIUM · Output: number questions can't be answered above min+59

**Lines:** er:1078–1082 (`optionList` builds only `min … min + POOL − 1`), er:1222–1235 (the search filters that truncated list). Compare the comment at er:921: "the search box narrows longer lists".

**Reproduced (R14):** a `mode: "number"` prompt `0..100` shows 60 buttons ending at 59. Typing `99` in the search shows **no** buttons.

**Impact:** `chooseNumber` (bridge.js:1235–1236, e.g. "pay any amount of life" at 40 life) and damage assignment (bridge.js:992, `max: left`) can exceed 60 in commander games. Players can't pick the number they need, so they must choose a smaller one or cancel.

**Potential Fix Direction:** For number prompts, filter the full range and then cap at POOL. Or parse the search text as a number. Or offer −/+ and "type a number" controls.

---

### F8. MEDIUM · Output (comment promise): an enchanted or equipped token is grouped into another token, so its aura floats in the "other" row

**Lines:** comment er:440–443 ("Identical tokens (… nothing attached) are drawn as ONE card"). The code at er:448 checks only that the token isn't itself attached (`c.att == nil`), not that nothing is attached **to** it. Placement fallback is at er:702 (`enginePlanned[c.att] or gridPos(g, 0, ROWS.other)`).

**Reproduced (R4):** two identical Soldier tokens `t1`, `t2` with Pacifism attached to `t2`. Result: `t2` has no object (grouped under `t1`), and the aura sits at (28.2, 14.6), the start of the "other" row, while the token pile is at (30.1, 7.4).

**Impact:** The table no longer shows which token is enchanted. Targeting the enchanted token by clicking is impossible: `glowCard` (er:1904) finds no object for `t2`, and clicking the representative targets `t1`. The panel still works. This differs from reference §7 #16 (aura on another player's permanent).

**Potential Fix Direction:** Compute `hosts` before grouping, and leave any token in `hosts` out of the group key (or give it its own key).

---

### F9. MEDIUM · Gestures (TTS semantics *unsure*): a click that arrives as Select **and** PickUp undoes an attack or an "up to N" target

**Lines:** er:1997–2000 de-duplicates the two events only for the `cards` kind. The `target` (er:2008–2025), `attack` (er:2026–2045) and `attack` re-target branches toggle on every call. er:2091–2106 runs `clickGesture` for both `A.Select` and `A.PickUp`.

**Reproduced (R11, deterministic in the simulator):** with "Declare attackers", calling `onPlayerAction(Select)` then `onPlayerAction(PickUp)` on the creature gives `after Select: true, after PickUp: false`. A "choose 0–1 target(s)" prompt behaves the same way. Exact-count targets are unaffected because the first pick auto-confirms (er:2021).

**Unsure:** whether TTS really sends both events for one click on these objects. The comment at er:1997 says it can, for at least some clicks. Own creatures are unlocked in your area (`isFree`), which is the case most likely to produce PickUp. If it happens, click-to-attack never sticks.

**Potential Fix Direction:** Apply the same per-object 0.4 s de-duplication to every `clickGesture` branch, or handle only one of the two actions per kind.

---

### F10. MEDIUM · Cross-artifact (help text vs code): `mtg reset` depends entirely on the bridge; `mtg engine off` mid-game leaves a half-guarded table

**Lines:** mec:253–255 (`reset` only sends `engineSend("reset")`), mec:257 (help: "mtg reset (host) - end it and put the imported decks back"), mec:177–185 (`setEngineMode(false)` touches only the flag and `Turns.pass_turns`), mec:396–421 (board messages are applied whatever `ENGINE_MODE` is).

**Issue:** The decks go back and the cards are cleared only when the bridge answers with `clear` (bridge.js `resetGame`). If the bridge has crashed or isn't running, `mtg reset` silently does nothing locally. The imported decks stay locked 15 units under the table and ENGINE_MODE stays on. The only way out is a reload: the load-time handler (er:2151–2161) restores, at the F2 cost. `mtg engine off` during a game turns off every guard (`onPlayerAction`, `onObjectSpawn` clean-up, `tryObjectEnterContainer`) while engine cards stay. Players can then copy, delete or merge them into engine piles, and any later board message keeps drawing.

**Potential Fix Direction:** Have `mtg reset` call `engineClear()` locally (or after a short timeout without a `clear`), and treat the bridge's `clear` as idempotent. When `mtg engine off` runs with `lastTable ~= nil`, either refuse it or call `engineClear()`.

---

### F11. MEDIUM · Cross-artifact (button label vs code): "Auto: on (15 s)" releases held moves early, and timers pile up

**Lines:** comment er:333–336 ("they go by themselves after 15 seconds"), button label er:1293. er:419–423 schedules a new `Wait.time(…, 15)` on **every** board update that has something pending. Its guard `enginePending[color] == batch` is always true, because `pendingOf` (er:344–347) returns the same table for the whole game. er:1541–1548 adds another timer each time the toggle is switched on.

**Reproduced (R7):** a draw is held at t=1.0 and a second draw at t=11.2. Both are released at ≈t=16, so the second card waited ≈5 s, not 15. Every board update while something is held adds one more 15 s timer.

**Potential Fix Direction:** Store a release deadline per held item (or reset a single per-colour timer token when new items are held), and release only items whose own 15 s has passed.

---

### F12. MEDIUM · Error handling (label shape): an option without `label` breaks that question's panel

**Lines:** er:1226, er:1231 (`string.lower(o.label)`, `.. o.label`). The bridge can send it: `displayText(undefined)` returns `undefined` (bridge.js:887, 1380), so the key is dropped from the JSON.

**Reproduced (R5):** a single-choice prompt with `[{id:"a"}, {id:"b", label:"Second"}]` prints `[engine] panel error (Blue, Choose one): Global:4300: attempt to concatenate a nil value (field 'label')`. The title updates, but **no option buttons** are set and the card row (`engineRowUpdate`, after the error) isn't refreshed. The pcall at er:1623 keeps the rest of the message alive.

**Potential Fix Direction:** Use `tostring(o.label or o.id or "?")` in `optionList` (er:1084) so every consumer gets a string.

---

### F13. LOW · Error handling: the outbox has no timeout; one stuck request blocks every later message

**Lines:** mec:371–393. `engineSending` is cleared only in the `WebRequest.custom` callback. The queue `engineOutbox` grows without bound.

**Issue:** If a request never completes (a bridge process that accepts the connection but hangs; *unsure* whether TTS's `WebRequest` has a default timeout), every later answer, intent and `hello` waits forever, and only a reload recovers. Duplicate delivery through the `sendExternalMessage` fallback is unlikely today, because `/msg` replies `ok` before processing (bridge.js:1711). A 413 for an oversized body would still fall back to TCP.

**Potential Fix Direction:** Add a watchdog (`Wait.time` of a few seconds per send) that marks the request failed and falls back. Cap the queue and log when it's capped.

---

### F14. LOW · CPU: every engine card merged into a pile triggers an extra full re-render

**Lines:** er:2133–2137 (`onObjectDestroy` → `resyncSoon` for any object whose GM notes start `engine:`), er:2342–2348 (`addToPile` merges cards that still carry `engine:<id>`), er:2394–2401 (a pile deck reduced to one card is destroyed with its `engine:graveyard:…` notes). `engineDispose` avoids the same trap by renaming first (er:150).

**Issue:** If TTS fires `onObjectDestroy` for an object merged by `putObject` (*unsure*; the simulator doesn't model this event), each card going to a graveyard or exile pile causes a full `engineRender(lastTable)` 5 frames later on top of the bridge's own update. That is pure overhead on big boards (the render walks every card and makes ~6 TTS calls per card).

**Potential Fix Direction:** Rename the card (e.g. `enginepile:<id>`) before `putObject`, or skip the resync while the id is in `engineInPile`.

---

### F15. LOW · Memory: tables keyed by objects or GUIDs that are never cleared

**Lines and growth:**
- `playableBuilt` er:2802: one entry per hand-card object ever framed. Never cleared, not even by `engineClear`, so it holds dead object references for the whole session.
- `cardClickAt` er:1983: one entry per clicked GUID. Never cleared.
- `engineEntering` er:2306: an entry stays if a `putObject` never lands (er:2232, er:2345).
- `engineBaseGlow` er:548: keyed by object. Only cleared per game; an object destroyed while glowing keeps its entry.
- `glowing`/`menued` er:1806–1808: hold destroyed objects across games.
- `onUpdate` er:2558–2570: allocates two tables every frame, for the whole session, even with engine mode off.

**Impact:** Small (kilobytes per game), but it accumulates over a long evening of games without a reload.

**Potential Fix Direction:** Clear these in `engineClear`. Drop entries when `engineDispose` runs. Reuse the `recent`/`ops` tables instead of reallocating each frame.

---

### F16. LOW · Smells: comments and dead code that promise something the code doesn't do

- er:2168 `libraryAnimTo` "graveyard for a mill" is never assigned, so milled cards fly toward the **hand** (er:2214).
- er:2717–2750 `enginePreload` says "At the start of a game every deck's pictures are loaded once". The bridge no longer sends `preload` (bridge.js:388–389 explains why: each destroyed preload card cost ~370 ms). The code is still reachable from `onExternalMessage` (mec:419) and still `destruct()`s every preload card (R10: 20 pictures → 20 `destruct()` calls).
- er:2590–2591 says the table buttons "go under the table while it is on", but er:2618 keeps them up (the newer behaviour).
- mec:423–429 guards the Enablers bag `4f3387`. That bag is nested inside `2d3496` "Pie's MTG Enablers", which the same script removes (mec:541), so the guard is dead.
- er:79–93/er:81 claims "numbers already used by engine cards in this save keep their picture, so a reloaded game never shows a wrong one". On a reload the frame-30 sweep (er:2158) destroys every engine object before the first `engineDeckKey` call, so seeding always finds nothing and numbering restarts at 3000. *Unsure* whether TTS's per-number image cache survives a reload, i.e. whether this can actually show a wrong picture.
- Duplicate constants `AUTO_DELAY` (er:339) and `AUTO_PACE_DELAY` (er:1255). Unused `renderQueued`, `engineColors` (known §7 #26).

**Potential Fix Direction:** Delete the dead paths (`enginePreload`, the 4f3387 guard) and correct the comments. Implement the mill destination or remove `libraryAnimTo`.

---

### F17. LOW · Cross-artifact: "Off = the table behaves exactly like the original" is not quite true

**Lines:** mec:126–127 and mec:165 make the promise. Departures:
- er:2772–2776 throttles rewind snapshots to one per minute on every load, engine mode or not. This is deliberate (er:2769).
- er:533–535 turns `Turns.enable` on during an engine game, and `engineClear` doesn't restore it.
- `setEngineMode(false)` sets `Turns.pass_turns = true` (mec:179) whatever the original value was.
- er:2151–2161 sweeps `libcard`/`engine*` objects and sends `hello` on every load.
- The renderer's `onUpdate` profiler runs every frame.

**Potential Fix Direction:** Save and restore `Turns.enable`/`pass_turns`/`turn_color` around an engine game, and gate the rewind hold and the profiler on engine mode. Or reword the promise.

---

## Fail-safe direction audit (Layer 6), key defaults

| Location | Default | Direction |
|---|---|---|
| er:206–209 | `isFree(nil)` → card stays locked | safe |
| er:1678 | `engineMeta[id] or {}` → not yours → refused | safe |
| er:1656–1672 | `dropArea` → "elsewhere" → snap back | safe |
| er:1402, er:1239 | `p.min or 0`, `p.max or 99` | **open** on the client (any count accepted if the bridge omits min/max); the bridge validates answers now (§7 note), so acceptable |
| er:2521 | pile chooser = any colour holding the id | **open** (known §7 #22; library twin in F6) |
| er:569 | keep the old `tx` when the new static has none | **wrong across games** (F4/R2) |
| er:419–423 | auto-release timer | **early** (F11) |
| mec:376–377 | failed request → `sendExternalMessage` | duplicate only if the request was processed and still reported an error; unlikely today |
| er:391 | `paceArmed` nil → nothing held | safe (moves happen at once) |

## Overlap with `docs/our-code-reference.md` §7

Confirmed still open and not re-reported here: #15 (now with a concrete repro, folded into F4), #16, #18, #19 (glows/context menus visible to all), #20, #21, #22 (extended to the library in F6), #23, #24, #25, #26. New here: F1, F2, F3, F4 (`engineFlipped`, `engineStatic.tx`), F5, F7–F17.

## Validation Notes

- Every finding cites lines that were read. R1–R14 ran on the repo's simulator against the save `tests/test_table_golden.js` builds. The simulator doesn't model physics, `onObjectDestroy`, Search windows, the Select/PickUp event pair or real `destruct()` cost. Findings that depend on those are marked *Unsure*.
- fengari is Lua 5.3; TTS runs MoonSharp (5.2-ish). Assigning `t[nil]` raises in both. The `ty`-as-string case (`ipairs` on a string) passed in fengari and might not pass in MoonSharp; it was left out as unconfirmed.
- No community or web sources were consulted (see the operator note in the ruleset). Performance numbers come from the project's own PresentMon measurements (memory `tts-perf-facts`, er:120–125, bridge.js:388–389).

## Recommended Next Steps

1. F1: stop drawing or listing `fd` cards by name, and in the bridge, stop sending identities of face-down cards in public zones.
2. F2: sweep through the trash deck instead of `destruct()`.
3. F3 + F12: add a `pcall` barrier in `onExternalMessage` and coerce labels and log lines to strings.
4. F4 + F5: reset all per-game tables and add a game-generation guard to every delayed callback.
5. F7, F8, F9, F11: functional fixes, each small.
6. F6, F10: decide on owner-only search and a local reset fallback.
7. F13–F17: clean-up.
