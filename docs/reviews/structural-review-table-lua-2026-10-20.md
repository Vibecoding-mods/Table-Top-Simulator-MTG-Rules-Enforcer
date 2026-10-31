# Structural Review: Table Lua (engine renderer + ENGINE MODE block)

**Reviewed:**
- `tools/engine-renderer.lua` (2,849 lines, read in full)
- The Lua template strings in `tools/make-engine-copy.js` (ENGINE MODE block lines 162-430, the `guard()` generator lines 130-155 and its 30 call sites lines 438-500, the `onChat` patch line 158-161)
- Cross-checked against `bridge/bridge.js` (where prompt titles are composed) and the original workshop Global script (`2296042369.json`: it defines `onObjectEnterContainer`, `onObjectSpawn` and `onChat`, and no `onPlayerAction`, `onObjectLeaveContainer`, `onObjectDestroy` or `tryObjectEnterContainer`)

**Date:** 2026-10-20
**Mode:** findings only. No file other than this report was changed.

| Severity | Count |
|---|---|
| CRITICAL | 2 |
| HIGH | 4 |
| MEDIUM | 7 |
| LOW | 4 |

"CRITICAL" here means the shape has already produced a divergence that code reading shows will surface in play. Neither CRITICAL item was reproduced in TTS. Each finding says how sure it is.

---

## Executive Summary

The renderer's card-drawing core is sound: `place()`, piles, the library deck and the trash deck form a reasonably general "draw the engine's board" mechanism, and the deliberate performance caches (`uiCache`, `pileIds`/`pileState`, `libraryState`, `engineBadge`) are named and explained. The strain is in two other places.

**1. The open question ("prompt") has no single model.** Each surface works out for itself what kind of question is open: the panel, the corner buttons, the card row, the hint line, the table glows, the context menus, the green hand frames, the auto-unhide rule and the pace arming. Most of them do it by pattern-matching the English titles that `bridge.js` built from a typed Forge input it already had. The per-player interaction state (selection, browse overlay, attacker or blocker waiting for its second click, search deck, pile choices, glows, menus) is spread over about 15 colour-keyed tables, and only some of them are reset on each exit path. Two consequences are already visible in the code:
- A player who hid the panel gets a two-option question such as "Tap X for which mana?" with only one option reachable.
- Ticking a choice in the panel doesn't update the table glows, although the file's own comment promises "the panel and the table always agree".

**2. Card bookkeeping and event handling grew by appended layers.**
- Each engine card's state lives in about 16 parallel id-keyed tables. It is "adopted" (an object taken over as the card's object) in four places, and each one updates a different subset of fields.
- `onPlayerAction`, `onObjectLeaveContainer`, `engineOnPrompt` and `setEngineMode` are each redefined two or three times. Which layer wins depends only on file order.
- ENGINE_MODE and `lastTable ~= nil` together encode three table modes plus one undesigned mid-game "engine off" hybrid.

Under the current shape, the next prompt type touches about 8 classification sites, the next gesture adds a fourth `onPlayerAction` layer, and the next per-card attribute is one more table that the reset and adoption sites must each remember.

---

## Findings by Category

### 1. State-Flag Proliferation

### Structural Finding 1.1: The per-player interaction state is one state machine spread over ~15 colour-keyed tables

**Category:** State-Flag Proliferation
**Location:** `engine-renderer.lua`. The tables that make up the state:
- Prompt and selection: `enginePrompts` 912, `engineSelected` 913, `engineFilter` 915, `engineVisible` 916.
- Browse overlay: `engineBrowse` 1106, `browseCards` 1107.
- Button maps: `engineCorner` 1128, `engineRowMap` 1410.
- Table effects: `glowing` 1806-1807, `menued` 1808.
- Two-click gestures: `pendingBlocker` 1809, `pendingAttacker` 1811.
- Library search: `engineSearch` 2166 (also created lazily at 1601-1603), `engineSearchIds` 2167.
- Pile choices: `engineChoosable` 2303 (also 1594-1599).
- Green hand frames: `playableShown` 2795.

The transitions are scattered across:
- `engineOnPrompt` 1583-1633 (enter)
- `engineAnswer` 1328-1336 (exit)
- `enginePhase2Prompt` 1870-1876 (resets)
- `onMtgBrowse` 1551-1559, plus the browse auto-exit at 1617-1620
- `clickGesture` 2032-2085 and `tapGesture` 1962-1968 (gesture sub-states)
- `unblock` 1930-1941
- `engineClear` 883-893

Player preferences sit next to these and are not part of the machine: `engineHidden` 914, `engineLogHidden` 1254, `engineAutoPace` 338, `engineStops` 1202, `engineGlowOff` 2794.
**Severity:** HIGH

**Current shape:** "What is this player doing right now" is spread across those tables, and each exit path clears a different subset:
- `engineAnswer` (1332-1334) clears the prompt, selection and filter. It leaves the glows, menus, `pendingAttacker`/`pendingBlocker`, `engineChoosable`, `engineSearch` and the green frames until the bridge's `promptId = nil` message arrives.
- `engineClear` (889) clears only `enginePrompts`. Selection, browse, choosable, search, `engineSearchIds`, `pendingAttacker`/`pendingBlocker`, `glowing`, `menued` and `playableShown` all survive into the next game.
- `enginePhase2Prompt` is called both when a prompt opens (from `engineOnPrompt` 1626) and as "redraw glows after a selection changed" (1939, 1966, 2003, 2022, 2037, 2042, 2061, 2080). Because of that double use, its reset at the top has to special-case one gesture sub-state: `pendingAttacker` survives only when the title still starts with "Declare attackers" (1875), while `pendingBlocker` is reset unconditionally (1873).

**What this is standing in for:** a per-colour `session[color]` with an explicit state and transitions:
- `Idle` (no prompt)
- `Prompt{kind, selection}`, with a gesture sub-state `None | AttackerAwaitingTarget(id) | BlockerAwaitingAttacker(id)`
- `Answered` (sent, waiting for the bridge)

`Browse` is an overlay flag on the session (see 4.2), and `search`/`choosable` are fields derived from the prompt. That gives three operations: `enter(prompt)`, `exit()` (clears everything prompt-scoped in one place) and `refresh()` (re-render without touching the sub-state).

**Signal that provoked this finding:**
- `pendingAttacker` and `pendingBlocker` are meaningful only together with a specific prompt kind. One is kept alive by a title check (1875), the other relies on `clickGesture` never calling `enginePhase2Prompt` between its two clicks (2070-2072 call `glowCard` directly for that reason).
- Three different reset lists (`engineAnswer`, `engineClear`, the top of `enginePhase2Prompt`) disagree about what is prompt-scoped.
- Representable states that mean nothing:
  - `pendingBlocker` set while `enginePrompts[color]` is nil (after `engineAnswer`)
  - `engineSearch[color]` set after `engineClear`
  - `engineSelected` entries for a prompt from the previous game

  How stale `engineSearch` affects the first library deck of the next game depends on whether the bridge sends `promptId = nil` before `clear`. Not verified.

**Cost of the next case, current shape vs. restructured:** a new two-click gesture (for example "choose a target for this equip", or damage assignment by clicking) today means:
- one more colour table;
- one more reset line in up to three places, plus a decision whether `enginePhase2Prompt` may reset it (with another title check);
- a check in `clickGesture`.

Restructured: one more gesture sub-state value. `exit()` and `enter()` already clear it, and `refresh()` never does.

**Suggested restructuring (not applied):**
- Introduce `session[color] = { prompt, selection, filter, browse, gesture = {kind, id}, search, choosable, view = {visible, corner, row}, glows, menus }`.
- `engineOnPrompt` calls `enterPrompt(color, m)`. `engineAnswer`, the bridge's null prompt and `engineClear` all call `exitPrompt(color)`, which is the one place that unglows, clears menus and frames, and drops the gesture.
- Split `enginePhase2Prompt` into `applyPromptEffects(color)` (idempotent: glows and menus from the current session) and the reset, which moves into `enterPrompt`/`exitPrompt`.
- Keep the preferences (`hidden`, `logHidden`, `autoPace`, `stops`, `glowOff`) in a separate `prefs[color]` so it's obvious they are not reset.

### Structural Finding 1.2: Each engine card's state is split across ~16 id-keyed tables, and "adopt this object as card X" is written four ways

**Category:** State-Flag Proliferation (with Shadow State)
**Location:** The per-card tables:
- `engineObjs` 25, `engineSpawning` 26, `enginePlanned` 27, `engineInHand` 28, `engineFace` 29, `engineMeta` 30, `engineManual` 31, `engineHeld` 32
- `engineBadge` 215, `engineFlipped` 258, `engineGroupOf` 444
- `engineStackGlow` 547, `engineBaseGlow` 548 (keyed by *object*, not id), `engineStatic` 555
- `engineManualLanded` 790, `engineSearchIds` 2167, `engineInPile` 2301

Writers that each update a different subset of fields:

| Writer | Lines | Fields it sets |
|---|---|---|
| `place` spawn callback | 288-297 | obj, face, badge, stackGlow |
| `engineTakeFromPiles`, taken card | 2385-2389 | obj, inPile, face |
| `engineTakeFromPiles`, remainder | 2394-2399 | obj, inPile, face |
| library-leave adoption | 2277-2281 | obj, held (not face, not inPile) |
| pile-leave adoption | 2522-2527 | obj, inPile, held (not face) |
| `addToPile` | 2312-2314, 2350-2352 | inPile, obj = nil, inHand only when single |
| `engineZonePile` rebuild | 2447-2457 | obj = nil, inPile (not inHand) |
| `groupTokens` | 463-467 | |

Resets are split as well: `engineClear` 885-886 resets 10 tables, `enginePileReset` 2491-2499 another 5. `engineBadge`, `engineFlipped`, `engineSearchIds`, `engineStatic` and `cardClickAt` are reset by neither.
**Severity:** HIGH (one probable drift already present)

**Current shape:** what the renderer knows about one card is the join of up to 16 tables. `engineDebugCard` (2780-2789) exists because nobody can see that join in one place. Adoption code (four copies) and removal code (`engineDispose` callers plus `engineObjs[id] = nil` in at least 10 places) each set the subset their author needed at the time.

**What this is standing in for:** a `CardView` record, `views[id] = { obj, spawning, planned, zone, color, inHand, inPile, held, manual, manualLanded, face, badge, flipped, group, baseGlow }`, with three lifecycle functions:
- `adopt(id, obj, face)`: sets obj and face, clears inPile, inHand and spawning
- `release(id)`: disposes the object and clears object-scoped fields
- `resetAll()`

**Signal that provoked this finding:**
- Only `engineTakeFromPiles` sets `engineFace` on adoption (2388, 2399). The library-search adoption (2278) and the pile-choice adoption (2523) don't.
- `place()` treats `engineFace[id] ~= c.f` as "the card changed identity" (278) and replaces the object. A tutored card that was never on the table (so `engineFace` is nil) would therefore have the object the player just pulled out disposed and respawned once it is placed again (after the 3 s `engineHeld` grace at 274). That defeats the "adopt it" comment at 2278 and 2523.
- Confidence: high by code reading. Not observed in TTS.
- The `engineZonePile` rebuild path (2447-2456) doesn't clear `engineInHand`, while `addToPile` (2350-2352) does. `engineFlipped` survives `engineClear`, although the comment at 887 says "ids repeat in the next game".

**Cost of the next case, current shape vs. restructured:** a new per-card attribute (for example a "revealed" marker or a per-card UI frame) today means one more table, plus remembering it in 4 adoption sites, 2 reset functions and `engineDebugCard`. Restructured: one field. `adopt`, `release` and `resetAll` already cover it.

**Suggested restructuring (not applied):**
- Collapse the id-keyed tables into `views[id]`, keeping the ones that are deliberate caches (`engineStatic`, `engineBadge`) as named fields.
- Replace every `engineObjs[x] = obj` with `adopt(x, obj, face)` and every `engineObjs[x] = nil` (after a dispose) with `release(x)`.
- Key `engineBaseGlow` by id like everything else.
- `engineDebugCard` then becomes a dump of one record.

### 2. Special-Case Bolt-Ons

### Structural Finding 2.1: Engine-mode guards are a hand-kept blacklist of ~70 function names, generated by a 6-option `guard()`

**Category:** Special-Case Bolt-On (with Config/Flag Combinatorics)
**Location:**
- `make-engine-copy.js` 130-155 (`guard`), 438-500 (30 calls covering ~70 function names), 158-161 (`onChat` patch), 465-467 (pirate-cannon patch)
- Template 177-185 (`setEngineMode`), 424-429 (enabler bag)
- `engine-renderer.lua` 2592-2620 (`TABLE_BUTTONS`, `engineTableButtons`, the `setEngineMode` override)

**Severity:** MEDIUM

**Current shape:** every manual tool on the base table gets its own `if ENGINE_MODE then ... return end` prepended. A function that isn't listed keeps working on engine-owned cards. `guard()` takes `silent`, `ret`, `global`, `min`, `exclude` and `call`, and the generated body has three forms. The combination `call` + `global: false` produces `if ENGINE_MODE then return engineTableButton(...) end` inside an *object* script, where `ENGINE_MODE` is always nil, so that guard would never fire. No current call uses that combination, but nothing prevents it.

On the renderer side, the `setEngineMode` override (2615-2619) now only calls `engineTableButtons(false)`, and nothing calls `engineTableButtons(true)` any more. `tmp/p40.js` changed it from `engineTableButtons(ENGINE_MODE)` to `false`, so the hide branch (2606-2608) is unreachable.

**What this is standing in for:** a fail-closed boundary. In engine mode the table's manual tools are either physically out of play (the copy already does this for clutter at 520-547 and for imported decks with `stashImported`), or every tool script's callbacks go through one wrapper declared once.

**Signal that provoked this finding:**
- 30 `guard` calls, each with its own marker string and `min` count.
- The build fails when a listed name disappears, but it can't notice a new tool added by a workshop update.
- One option combination is broken but representable.
- One renderer override is vestigial.

**Cost of the next case, current shape vs. restructured:** a new base-table tool (or a renamed callback) today needs someone to notice it, find a unique marker, and add a `guard` line with the right silent/ret/min. Until then it works on engine cards. Restructured (stash or one wrapper list per script): the tool is inert by default, and allowing it is the explicit act.

**Suggested restructuring (not applied):**
- Prefer moving guarded tool *objects* under the table in engine mode, as `stashObject` already does, and keep function guards only for scripts that live on cards (Easy Modules overlays) or in Global.
- For those, generate one prelude per script that wraps a named list from `_G` (a single `ENGINE_GUARDED = {...}` table per script) instead of regex-splicing each function head.
- Make the body form depend only on "Global or object", and make `call` imply Global (or reject the combination at build time).
- Delete the vestigial `setEngineMode` override and the `hide` branch, or restore their purpose deliberately.

### Structural Finding 2.2: `place()` collects zone-specific bolt-ons keyed by string zone names

**Category:** Special-Case Bolt-On
**Location:**
- `place` 261-325: flip 263-267, held wait 272-276, attached scale at both 296 and 301-302, hand join 303-307, hand jump-out 308-315, lock policy via `isFree` 206-209/316
- Callers that pass ad-hoc zones: `"heldmill"` 717, `"attached"` 705, `"stack"` 763/768, `"<zone>pile"` 2415, `"library"` 2199

**Severity:** LOW

**Current shape:** what a zone means physically (locked or free, scale, flippable, joins the hand) is answered inside `place` by string comparisons on `meta.zone`. Some of those zones are engine zones (`hand`, `battlefield`) and some are renderer-only locations (`heldmill`, `attached`, `graveyardpile`). `engineMeta` stores both kinds, so `onPlayerAction` (1680) and `onObjectDrop` (1713-1728) also compare against this mixed vocabulary.

**What this is standing in for:** a `ZONES` table, for example `{ battlefield = {free = true, flip = true, scale = 1}, attached = {scale = 0.5}, hand = {hand = true}, heldmill = {}, ... }`, with `meta = { zone = engineZone, spot = renderSpot }` kept apart.

**Signal that provoked this finding:** the attached scale is written twice (spawn and update), the flip and held checks sit at the top of the general path, and two vocabularies share one field.

**Cost of the next case, current shape vs. restructured:** a new visual zone (for example face-down exile or "on the stack, waiting") today means a new string plus checks in `place`, `isFree`, `onPlayerAction`, `onObjectDrop` and the `engineManual` sweep (793-797). Restructured: one row in `ZONES`.

**Suggested restructuring (not applied):** a `ZONES` descriptor table read by `place`, `isFree` and the gesture handlers, with the engine zone and the drawn spot as separate fields.

### 3. Parallel / Duplicate Control-Flow Paths

### Structural Finding 3.1 (CRITICAL): Prompt classification is re-derived at ~14 sites, mostly from English titles the bridge composed from a typed value

**Category:** Parallel / Duplicate Control-Flow Paths (with Leaky Abstraction across the bridge↔Lua contract)
**Location:** `engine-renderer.lua`:

| Site | Lines | What it re-derives |
|---|---|---|
| `promptKind` | 1813-1829 | title prefixes "Pay ", "Declare attackers", "Declare blockers", "Your priority"; option-id shapes `card\|`/`player\|`; whether `engineObjs[id]` exists |
| `optionColor` | 1089-1103 | title prefixes again; ids `__allattack`/`__noattack`/`__endturn`/`__resolve`; mode/index |
| `engineUpdateCorner` hint | 1144-1160 | kind plus `title:lower():find("bottom"/"top")`, plus "Your priority" |
| `engineUpdateCorner` big/small | 1176-1189 | mode plus ids `__endturn`/`__resolve`/`no`/`mull`/`__allattack`/`__noattack` |
| `engineRowUpdate` | 1419-1428 | mode, kind ~= "cards", `o.img`, `p.show`, `ROW_MAX`/`ROW_BTNS` |
| `engineOnPrompt` "handled" rule | 1611-1616 | |
| browse auto-exit | 1617 | title ~= "Your priority" |
| `pick` | 1373, 1382 | `__` prefix; title "Declare blockers" |
| `optimistic` | 1346-1354 | label prefixes "Play ", "Cast ", "Mana: tap " |
| `enginePhase2Prompt` | 1875 | |
| `clickGesture` | 1990, 2004 | the bottom/top substring test written twice more |
| phase-2 `onPlayerAction` | 2100 | |
| pace `engineOnPrompt` | 2698 | "Mulligan", "Put %d", "Dice" |
| `engineTableButton` | 2664, 2668 | `mull`; title contains "scry"/"reveal" |
| `enginePlayableGlow` | 2816-2819 | title == "Your priority"; label "Cast "/"Play " |
| hotkey | 2761 | `__pass` |

The source of these titles is `bridge/bridge.js` 1020, 1079, 1147, 1161, 1249, 1263, 1320, 1481 and the template-string titles. The bridge builds each one from the Forge input type it is translating.
**Severity:** CRITICAL (a divergence between two of these classifications is visible by code reading; not reproduced in TTS)

**Current shape:** no prompt carries its kind. Each consumer reverse-engineers it, with its own rules:
- `promptKind` is time-dependent. "cards" requires the option's card to *currently* have an object (1824), so the same prompt can be "cards" (glow path) on one render and nil (row or panel path) on another, depending on spawn timing, token grouping (`engineGroupOf`) or pile membership.
- The "bottom"/"top" substring test (1148, 1990, 2004) also matches card names that contain "top" (Treetop Village, Mountaintop..., Rooftop Storm) when the bridge prefixes a title with the card name (`${title}: select cards to put into …`).

**The concrete divergence (near-bug):**
- When the player has hidden the panel, `engineOnPrompt` keeps it hidden if the question looks "handled". It counts as handled if any of these holds (1613-1614):
  - `kind ~= nil`
  - `m.show ~= nil`
  - `mode == "single"` with ≤2 options
  - any option has `img`
- The surfaces that would actually handle it use different rules:
  - The corner shows the second option only when its id is one of `__endturn`/`__resolve`/`no`/`mull` (1180).
  - The row shows only when `#tiles <= 7` and other options `<= 4` (1428).
- So `Tap ${name} for which mana?` (bridge 1161/1481), a 2-option single prompt with plain colour ids and `cancel: true`, gets one corner button (the first colour). Its second colour and its Cancel are reachable only if the player knows to unhide the panel.
- A prompt with 8+ image options is also "handled" while the row refuses to draw it.

**What this is standing in for:** one `describePrompt(p)` evaluated once per prompt. Ideally it starts from a `kind` field (plus a `dest` such as `"library"`) that the bridge already knows. It returns a view descriptor `{ kind, hint, corner = {big, small}, row = {tiles, btns} | nil, glow = {...}, colorOf(i, picked), panelNeeded, armsPace }`. All the surfaces render from it, and `panelNeeded` is computed from the same descriptor as "some option is not reachable from corner, row or glow", so the hide rule can't drift from what is actually drawn.

**Signal that provoked this finding:**
- About 14 classification sites and 4 different string-match styles (prefix, exact, lowercase substring, label prefix).
- `enginePromptKind` is exported as a global (1831) only because `engineUpdateCorner` is defined earlier in the file and has to nil-check it (1145, 1420, 1612).
- The bridge's own structural review notes that prompt features are being added steadily, so new titles keep arriving.

**Cost of the next case, current shape vs. restructured:** a new prompt type (for example a modal "choose one", or damage assignment) today means:
- deciding its kind by title in `promptKind`;
- possibly a colour rule in `optionColor`, a hint branch, corner big/small ids, a row eligibility tweak, an auto-unhide exception and a pace-arming exception;
- and nothing fails if the bridge rewords a title. That is about 8 edits across 2 files with an implicit string contract.

Restructured: one `kind` value in the bridge and one case in `describePrompt`.

**Suggested restructuring (not applied):**
1. In `bridge.js`, add `kind` (`priority | mana | attack | block | target | cards | order | number | modal | mulligan | dice | ...`) and, where relevant, `dest`, to every prompt message.
2. In Lua, compute `p.view = describePrompt(p)` once in `engineOnPrompt`. Keep the one truly dynamic part ("does this option's card have an object right now") as a small function the glow path calls, not as part of the kind.
3. Point `optionColor`, `engineUpdateCorner`, `engineRowUpdate`, `enginePhase2Prompt`, `enginePlayableGlow`, the hide rule, pace arming and `engineTableButton` at `p.view`.
4. Remove the title matching.

### Structural Finding 3.2: TTS event handlers and engine hooks are layered by redefinition; precedence is file order

**Category:** Parallel / Duplicate Control-Flow Paths
**Location:**

| Hook | Definitions |
|---|---|
| `onPlayerAction` | 1674 (base), 2090-2106 (gestures, wraps 1674), 2674-2692 (pace, wraps 2091) |
| `onObjectLeaveContainer` | template 424-429 (enabler bag), 2270-2297 (library, wraps template), 2514-2537 (piles, wraps library) |
| `engineOnPrompt` | 1583-1633, then 2695-2715 (pace, wraps the profiled 1583) |
| `setEngineMode` | template 177-185, then 2615-2619 |
| wrappers of the original table's handlers | `onObjectEnterContainer` 1746-1798, `onObjectSpawn` 2118-2131, `onObjectDestroy` 2133-2137, `tryObjectEnterContainer` 2541-2550 |
| `_G` profiling wrappers | 2571-2587 |

Forward-reference nil-guards on functions defined later in the same file:
- 675 (`engineTakeFromPiles`), 806 (`engineRefreshBrowse`), 887 (`enginePileReset`), 1145/1420/1612 (`enginePromptKind`)
- 1215/1248 (`engineRowUpdate`), 1625 (`enginePhase2Prompt`), 1629 (`enginePlayableGlow`)
- 1992 (`engineConfirm`), 2339 (`engineRebuildPile`), 2763 (`engineCornerPress`), 637 (`panelReadyForPopup`)

**Severity:** HIGH

**Current shape:** each feature phase appended a new definition that captures the previous one and falls through to it. `tmp/p28.js` to `p79.js` (52 patch scripts) show the file grew this way. Each layer repeats its own `ENGINE_MODE`/`lastTable` check (1675, 2092, 2676). The rule "a click on a held mill or the library takes the held card *before* a card-choice prompt sees the click" exists only because the pace layer happens to be outermost.

The profiler wraps `engineOnPrompt` at 2587, *before* the pace layer redefines it at 2696. So the profile silently leaves out the pace work, and `onExternalMessage` calls the unprofiled outer layer.

**What this is standing in for:** one dispatcher per TTS event, with an ordered, named handler list, for example `ACTION_HANDLERS = { paceTakeHeld, promptGesture, ownCardsOnly }`. Each handler returns `handled, result`, and the order is data, not file position. Plus local forward declarations at the top of the file (`local engineRowUpdate, promptKind, ...`) in place of global-plus-nil-check.

**Signal that provoked this finding:**
- Three layers on `onPlayerAction`, three on `onObjectLeaveContainer`, two on `engineOnPrompt`.
- 11 `~= nil` guards on functions that always exist at runtime.
- A profiler that already measures the wrong layer.

**Cost of the next case, current shape vs. restructured:** the next table gesture today adds a fourth `onPlayerAction` layer. Its priority against the other three is set by where in the file it is pasted, and it needs its own mode check. Restructured: one entry in an ordered list, with its priority visible next to the others.

**Suggested restructuring (not applied):**
- Define each TTS event exactly once, near the bottom, as a loop over a handler list. Keep the original-table fallback (`tableEnterContainer`, `tableObjectSpawn`) as the last list entry.
- Move the `ENGINE_MODE`/game check into the dispatcher.
- Declare cross-section functions as file-top locals.
- Profile the dispatcher entries, not reassigned globals.

### Structural Finding 3.3: Card/deck JSON is built in six places, and the copies have already diverged

**Category:** Parallel / Duplicate Control-Flow Paths
**Location:**

| Builder | Lines |
|---|---|
| `engineCardData` | 177-187 |
| trash deck | 165-168 |
| `libraryDeckData` | 2176-2194 |
| library "add a card" | 2228-2229 |
| `engineZonePile` deck | 2462-2476 |
| `enginePreload` | 2736-2738 |

Related duplicates:
- `deckEntry` 106-108 vs `backDeckEntry` 2172-2174 (identical when face = back = ENGINE_BACK)
- the flat transform literal written 5 times (165, 183, 2171, 2471/2476, 2738)
- an unused `pile()` 492-496 (superseded by `engineZonePile`)

**Severity:** MEDIUM

**Current shape:** each spawn path writes its own card table. They already differ:
- Only `engineCardData` sets `Tags = {"engine"}` and `Locked`.
- The pile and library builders include `Description`, but the trash and preload builders don't.
- The hidden-face rule (`c.n == nil → back`) is repeated in `engineCardData` (179) and `engineZonePile` (2466) but not in `libraryDeckData` (2180). That is probably fine there, because search candidates are always known.

Nothing reads the tag today, so the divergence is harmless *for now*.

**What this is standing in for:** `cardJson(c, opts)` and `deckJson(cards, opts)` built on one `deckEntry` and one `FLAT`. Every spawn path calls them.

**Signal that provoked this finding:** six builders, with three fields (`Tags`, `Locked`, `Description`) inconsistent across them.

**Cost of the next case, current shape vs. restructured:** the next card-level field (for example a tag that `onObjectSpawn` uses to recognise engine cards in place of the GMNotes prefix, or a change to the GMNotes format) today means 6 edits, and a forgotten one gives cards that behave differently depending on which path spawned them. Restructured: 1 edit.

**Suggested restructuring (not applied):** extract `cardJson` and `deckJson` and route all six paths through them. Drop `backDeckEntry` and the unused `pile()`. Removing the dead code is `simplify`'s job; it's noted here only because it shows the duplication.

### Structural Finding 3.4: Object highlight has three writers and a priority rule split across five places

**Category:** Parallel / Duplicate Control-Flow Paths
**Location:**
- Base glow (stack / attacking / blocking): `engineRender` 773-789, `BASE_GLOW` 547-549
- Per-colour prompt glow: `glowObj` 1845-1850, `unglow` 1834-1843
- Direct blocker glow: `clickGesture` 2071
- Ownership check: `engineGlowOwned` 551-554, used at 785 and 1838
- Off on dispose: `engineDispose` 151
- Base glow keyed by object (`engineBaseGlow`) while the stack glow is keyed by id (`engineStackGlow`)
- The green hand frame is a separate mechanism (2791-2849), which is fine because it is a different resource.

**Severity:** MEDIUM

**Current shape:** a TTS highlight is one value per object, but three code paths write it. "A prompt glow beats the base glow" is enforced by `engineGlowOwned` checks in two writers and by `unglow` restoring `engineBaseGlow[o]`. When two colours' prompts glow the same object (possible for targets), the last writer wins and the colour shown depends on prompt arrival order. When an object is respawned, `engineStackGlow[id]` is reset (291) but `engineBaseGlow[oldObj]` lingers.

**What this is standing in for:** one function `applyHighlight(obj)` that computes the wanted colour from (any prompt glow for this object, by a defined priority) else (base glow) else off. Every writer then just marks the object dirty.

**Signal that provoked this finding:** two keyings of the same fact, and a priority rule that is implicit in check placement.

**Cost of the next case, current shape vs. restructured:** a fourth glow source (for example "can be sacrificed", or highlighting the source of a triggered ability) today needs its own table, a new `engineGlowOwned`-style check in each existing writer, and a restore path in `unglow`. Restructured: one more input to `applyHighlight`.

**Suggested restructuring (not applied):** keep `promptGlow[color][id] = rgb` and `baseGlow[id] = kind` as plain data, and have a single resolver set the highlight for the changed ids at the end of a render or a gesture.

### Structural Finding 3.5: Seat geometry is defined twice: once in the template, once in the renderer

**Category:** Parallel / Duplicate Control-Flow Paths
**Location:**
- `COMMAND_ZONES` (template 263) and `TAX_LABELS` (renderer 15) are the same GUID map.
- "A card near a command-zone anchor" (radius² 6.25, `y > a.y - 3`) is written in `commandersFor` (template 305-319) and `stashImported` (renderer 830-842).
- `dropArea` uses a different radius² for the command zone (2.25, line 1668).
- The exile spot `lib + libFwd * 4.16` is written in `engineRender` 722 and `dropArea` 1662. `seatGeometry` (40-53) doesn't own it.

**Severity:** LOW

**Current shape and what this is standing in for:** `seatGeometry` was meant to be the one owner of "where things are", but the exile spot, the command-zone anchors and the hit radii are re-derived beside it. The template's copy exists because it is appended before the renderer.

**Signal that provoked this finding:** the same GUID table twice, and two different radii for "on the command zone".

**Cost of the next case, current shape vs. restructured:** moving the exile pile or a command-zone label today means 2-3 edits in 2 files, and a forgotten one makes drops land in "elsewhere". Restructured: one edit.

**Suggested restructuring (not applied):** put the GUID maps and spots in one seat-layout table (in the template block, since it comes first). Have `seatGeometry` return `exile`, `command = {anchors, radius}`, and have `dropArea`, `stashImported` and `commandersFor` read it.

### 4. Leaky Abstractions

### Structural Finding 4.1 (CRITICAL): `pick()` doesn't own the table-side re-render, so gesture callers compensate and panel clicks don't

**Category:** Leaky Abstraction
**Location:**
- `pick` 1360-1392 (re-renders only the panel, 1391)
- Seven gesture callers re-run `enginePhase2Prompt` after `enginePick`: `unblock` 1935/1939, `tapGesture` 1965-1966, `clickGesture` 2001-2003, 2020-2022, 2034/2037, 2041-2042, 2058-2061, 2078-2080
- Callers that don't: `onMtgSlot` 1486-1490, `onMtgRow` 1464-1469, `onMtgRowOpt` 1470-1475, `cornerPress` 1520-1525, `onMtgClick` 1574-1581, the hotkey 2756-2765, `engineTableButton` 2665
- Design comment that states the intended invariant: 1801-1802 ("so the panel and the table always agree")

**Severity:** CRITICAL (by code reading; not reproduced in TTS)

**Current shape:** "the selection changed" is fully handled only when the caller remembers to call `enginePhase2Prompt`. Ticking an attacker, a blocker pair or a target in the panel (or on the card row) updates `engineSelected` and the panel, but the creature's glow stays white or orange instead of turning red or blue until a later gesture or the next prompt redraws it. In the other direction, gesture callers sometimes also call `engineConfirmIfComplete` (2021) and sometimes don't.

**What this is standing in for:** `select(color, i)` / `answer(color, choice)` on the session from Finding 1.1, which after any change runs the session's single `refresh()`: panel, corner, row, glows, menus, frames.

**Signal that provoked this finding:** seven call sites repeat the same compensating call, and every panel-side entry point lacks it, which contradicts the invariant the code comments claim.

**Cost of the next case, current shape vs. restructured:** each new way to pick (a hotkey, a row button, a new gesture) today has to know about `enginePhase2Prompt` (and sometimes `engineConfirmIfComplete`), and forgetting is silent. Restructured: zero, because `pick` refreshes everything.

**Suggested restructuring (not applied):** move the `enginePhase2Prompt` (renamed `applyPromptEffects`, see 1.1) call into `pick` after the selection changes, and delete the seven caller-side calls. Before that, check that `enginePhase2Prompt`'s reset of `pendingBlocker` doesn't break the two-click block flow. After the split proposed in 1.1 it no longer resets anything.

### Structural Finding 4.2: "Browse graveyards/exile" is a fake prompt that every consumer has to recognise

**Category:** Leaky Abstraction
**Location:**
- `browsePrompt` 1108-1124 builds `{mode = "browse"}`.
- Consumers that special-case it:
  - `updateOptions` 1205 (substitutes it) and 1221 (search box rule)
  - `engineUpdateCorner` 1176 (swaps it back for the real prompt)
  - `engineRowUpdate` 1419 (excludes it)
  - `pick` 1361-1369 (routes clicks to `browseCards`)
  - `engineOnPrompt` 1617-1620 (auto-exit unless "Your priority")
  - `engineRefreshBrowse` 1562-1565 (re-render on every board)
  - `onMtgBrowse` 1551-1559

**Severity:** MEDIUM

**Current shape:** browse reuses the prompt rendering by pretending to be a prompt. Every function that receives "the prompt" must then check whether it is real, and `engineUpdateCorner` even receives the fake one and swaps it back.

**What this is standing in for:** a panel *view mode* (`session.view = "choices" | "browse"`) that decides what the options list shows. Everything else (corner, row, glows, hint) always reads the real prompt.

**Signal that provoked this finding:** six consumers carry a browse special case. One of them (1176) undoes the substitution its caller just made.

**Cost of the next case, current shape vs. restructured:** another look-only list (for example "opponents' revealed hands", or "the stack in detail") today means a new fake mode and the same 6 special cases again. Restructured: one more view mode that only the options list renders.

**Suggested restructuring (not applied):** keep `browseOptions(color)` as a data source for the option list only. Pass the real prompt to corner, row and hint unconditionally, and let `pick` dispatch on `session.view`.

### 5. Config/Flag Combinatorics

### Structural Finding 5.1: `ENGINE_MODE` × `lastTable ~= nil` (× the host chat toggle) encodes three modes plus an undesigned hybrid

**Category:** Config/Flag Combinatorics
**Location:**
- Checks of both flags: 1675, 1707, 1757, 1783, 2092, 2120, 2135, 2676 (via `engineTable()`)
- `ENGINE_MODE` only: 2274, 2518, 2544, the template `onChat` 160, the enabler bag 425, and every `guard`-generated body
- Neither flag: `engineRender` 656, `engineOnPrompt` 1583
- Writers: template `setEngineMode` 177 / chat `mtg engine on|off` 193-199, `engineStarted` 906, `engineClear` 892, reload default `ENGINE_MODE = false` (template 166)

**Severity:** HIGH

**Current shape:** two independent flags with four combinations:

| ENGINE_MODE | lastTable | Meaning |
|---|---|---|
| off | nil | Normal table |
| on | nil | `mtg engine on` with no game, or the window between `started` and the first board. Table tools blocked, renderer hooks inert. |
| on | set | Engine game |
| off | set | **Undesigned.** The host typed `mtg engine off` mid-game. |

In the last row:
- the renderer keeps drawing every board, because `engineRender` doesn't check the mode;
- the table's tools come back on engine cards;
- `onObjectDrop` stops recording moves, so a dragged card stays where it is dropped;
- `tryObjectEnterContainer` lets physics merge cards into engine piles;
- the original table's `onObjectEnterContainer` runs on engine cards;
- yet the bridge still sends prompts and the panel still answers them.

Some handlers check both flags and some only one, so even the three designed modes are handled inconsistently. For example, the pile and library leave handlers act with no game loaded.

**What this is standing in for:** `TABLE_MODE = "normal" | "engineIdle" | "enginePlaying"`, set only by `engineStarted`, `engineClear` and the chat command. The chat command maps "off while playing" to `mtg reset` or a refusal. Handlers ask `isPlaying()`, and `guard()` bodies ask `TABLE_MODE ~= "normal"`.

**Signal that provoked this finding:** 11 handler sites use three different check shapes, two core entry points check nothing, and a host command produces a hybrid state nobody designed.

**Cost of the next case, current shape vs. restructured:** a fourth mode (for example "spectating a running game after a reload", or "paused while the bridge reconnects") today means another flag and an audit of all 11 checks plus the ~70 generated guards. Restructured: one enum value, and one place that decides what each handler does in it.

**Suggested restructuring (not applied):** replace the boolean with the enum (keep `ENGINE_MODE` as a derived global for the generated guards during migration). Route all handlers through one `isPlaying()`, which pairs naturally with the single dispatcher in 3.2. Make `mtg engine off` refuse, or reset, while a game is running.

### 6. Shadow State

### Structural Finding 6.1: `engineMeta` (and `engineInHand`) shadow `lastTable` and go stale for cards inside piles

**Category:** Shadow State
**Location:**
- `engineMeta` is written only in `place` (270), `engineLibraryDeck` (2199) and `engineZonePile` (2415, pile id only).
- The multi-card pile paths (2431-2457) and grouped tokens (462) mark cards `seen` without updating their meta.
- `engineInHand` (28) is a second copy of "zone == hand". It is set in `place` (286, 304) and cleared in `place` (310) and `addToPile` (2352), but not in the `engineZonePile` rebuild (2447-2456).
- Readers:
  - `engineManual` sweep 793-797
  - `onPlayerAction` 1678-1680, `onObjectDrop` 1709-1728
  - `engineRefused` 1739
  - phase-2 `onPlayerAction` 2096
  - `enginePlayableGlow` 2819, 2824-2826

**Severity:** MEDIUM

**Current shape:** "which zone is card X in" exists in `lastTable` (truth), `engineMeta` (written when drawn), `engineInHand` (hand only) and `paceSeen[color].hand` (340, a third hand copy, used for draw detection). A permanent the player arranged by hand (`engineManual` set) that dies into a graveyard that already has a card keeps `engineMeta.zone == "battlefield"`. The sweep at 794 then keeps its manual spot, so if it is reanimated it returns to the old dropped spot instead of the grid. Confidence: high by code reading, low impact.

**What this is standing in for:** an index rebuilt once per board, `zoneOf[id] = {zone, color}`, computed in `mergeStatic` (which already walks every zone). Draw locations (`heldmill`, `attached`, pile) live in the separate renderer field from 2.2.

**Signal that provoked this finding:** three copies of hand membership, plus one meta copy that only some render paths update.

**Cost of the next case, current shape vs. restructured:** each new render path (for example a face-down exile pile) today has to remember to update `engineMeta` and `engineInHand`, or gesture checks silently use the previous zone. Restructured: nothing, because the index comes from the board.

**Suggested restructuring (not applied):** derive the engine zone from a per-render index and delete `engineInHand` (use `index[id].zone == "hand"`). Keep only the *drawn-location* part of `engineMeta` as renderer state.

### Structural Finding 6.2: `engineSearchIds` is one global set for a per-colour fact; `engineSearch`/`engineChoosable` are stored copies of the prompt

**Category:** Shadow State
**Location:**
- `engineSearchIds` 2167, reset and refilled on *any* colour's library rebuild (2242-2243)
- Readers: `onObjectSpawn` 2123, library-leave 2277
- `engineSearch[color]` set from `m.librarySearch` (1600-1605); `engineChoosable[color]` from `m.pileChoices` (1594-1599)
- Neither is cleared by `engineAnswer` or `engineClear`.

**Severity:** MEDIUM

**Current shape:** while White has a search deck open, a rebuild of *Red's* library replaces `engineSearchIds` with Red's candidates (or with nothing). Red's library rebuilds when its key changes, when its count drops below 2, or after a non-search card leaves it. A card White then drags out of the search deck is no longer recognised:
- the library-leave handler tells White "the engine draws and shuffles your library" and rebuilds;
- `onObjectSpawn` may dispose of it.

This needs two libraries to change at once, so it is a latent case. Forge resolves searches one at a time, which makes it rarer still. Uncertain whether it can happen in practice.

**What this is standing in for:** candidates derived on demand from `session[color].prompt.librarySearch` (Finding 1.1), looked up per colour as `isSearchCandidate(color, id)`.

**Signal that provoked this finding:** a colour-scoped fact stored in a global table that every colour's rebuild resets, plus two prompt-derived copies with no exit-path reset.

**Cost of the next case, current shape vs. restructured:** another "pick from a hidden deck" mechanic (for example "look at the top N and pick") today means another stored set with its own reset rules. Restructured: another derived accessor on the session.

**Suggested restructuring (not applied):** make it `searchIds[color]`, or better, derive it from the session's prompt. Clear `engineSearch`/`engineChoosable` inside `exitPrompt` (1.1).

### Structural Finding 6.3: `engineStatic` is a cross-game cache keyed by per-game ids

**Category:** Shadow State
**Location:**
- `engineStatic` 555, `engineStoreStatic` 566-571: the old `tx` is carried over when the new entry has none (569)
- `engineOnTexts` 601-617
- Not reset in `engineClear` 883-893 or `enginePileReset` 2491-2499, although the comment at 887 states that ids repeat in the next game

**Severity:** MEDIUM (uncertain: depends on whether the bridge sends `tx` or a `texts` entry for every card in a new game)

**Current shape:** the card-details cache outlives the game whose ids it is keyed by. In the next game, card id N (a different card) is stored with `tx = nil` until its `texts` message arrives, and `engineStoreStatic` fills that gap with the *previous game's* rules text. If the bridge never sends a text for that card (a vanilla card, a token), the wrong text stays as its hover description.

**What this is standing in for:** a per-game `engineStatic`, reset with the rest of the game state, or a cache keyed by something stable (an oracle id or the picture URL).

**Signal that provoked this finding:** the code comment acknowledges id reuse across games right next to a reset list that omits this table.

**Cost of the next case, current shape vs. restructured:** any further field merged "keep old if new is missing" inherits the same cross-game leak. Restructured: no leak is possible.

**Suggested restructuring (not applied):** reset `engineStatic` in `engineClear`, or move it into the per-game state record (1.2's `resetAll`).

### Structural Finding 6.4: Small duplicated constants and names for "held"

**Category:** Shadow State (duplicated configuration)
**Location:**
- `AUTO_DELAY` 339 vs `AUTO_PACE_DELAY` 1255 (both 15, used by two separate timers at 422 and 1547), and the label "Auto: on (15 s)" (1293) hard-codes the value a third time.
- `heldIn` 435 vs `heldInList` 2626 (identical).
- "Held" means three different things:
  - `engineHeld` (a card waiting for the engine's answer to a drag, 32)
  - `enginePending` draws and mills (the moves waiting for the player, also called "held")
  - `engineHeldTapped` (a pending untap)
- `playableShown`/`playableBuilt` (2795, 2802) mirror object UI state and are refreshed only when a prompt arrives, so a card that leaves the hand keeps its frame until the next prompt.

**Severity:** LOW

**Signal, cost and suggestion:** each of these is a second copy of something one name could own. Changing the auto delay today takes 3 edits. Use one `AUTO_DELAY` constant (and build the label from it), one `heldIn`, and rename `engineHeld` to `engineAwaiting` so "held" means only the paced moves. Have `enginePlayableGlow` also run from `engineRender` for colours whose hand changed. The duplicate helpers are cleanup for `simplify`.

---

## Not findings (deliberate shapes, checked)

- `uiCache`, `whiteFlip` (920-933), `engineBadge`, `pileIds`/`pileState`, `libraryState`, `paceTable`: deliberate caches. The comments explain the measured cost each one avoids (≈1 ms per UI call, 360 ms per `destruct`, snapshot cost).
- `engineVisible`, `engineCorner` and `engineRowMap`: view maps from button slot to option index. Three are needed because there are three button sets. They become part of `session.view` under 1.1 but are not a problem on their own.
- The trash deck in place of `destruct()` (120-175) and the slim diff (`keep`, `s = 1`, `mergeStatic`) are clean, single-purpose mechanisms.

---

## Explicitly Out of Scope for This Report

This review only asked "is this the right shape". It did not check correctness, safety, concurrency or production-readiness (see `code-analysis-ruleset` for that), and it did not clean up redundant or dead code or apply any fixes (see `simplify`, which *does* apply fixes; this skill never does). The near-bugs named above (3.1, 4.1, 1.2, 6.1-6.3) come from code reading and were not reproduced in TTS. A clean structural report would not be a correctness or quality sign-off on its own.

## Recommended Next Steps

1. **3.1 Prompt descriptor.** Have the bridge send `kind`, and compute `describePrompt` once. This removes the most edit sites per new feature and fixes the hidden-panel / "Tap X for which mana?" divergence by construction. It needs a coordinated change in `bridge.js`.
2. **4.1 `pick()` refreshes the table side.** A small, local change that restores the "panel and table always agree" invariant. Do it together with splitting `enginePhase2Prompt` into enter/exit vs refresh (the core of 1.1).
3. **1.1 Per-colour session record** with `enterPrompt`/`exitPrompt`/`refresh`. That absorbs 4.2 (browse as a view mode) and 6.2 (derived search and choosable).
4. **1.2 Per-card record** with `adopt`/`release`/`resetAll`. That fixes the `engineFace` drift on adoption and absorbs 6.1 (`engineInHand`) and 6.3 (per-game `engineStatic`).
5. **5.1 + 3.2 Table-mode enum and one dispatcher per TTS event.** Do these together, since the dispatcher is where the mode check belongs.
6. **2.1, 3.3, 3.4, 3.5, 2.2, 6.4** as opportunistic cleanups when those areas are next touched.

Before any of these, capture a golden master of the renderer's outputs (UI attribute calls and `place` targets for a recorded sequence of bridge messages; `tests/golden/table-run.js` is a starting point). Most of the restructurings above move behaviour between functions.
