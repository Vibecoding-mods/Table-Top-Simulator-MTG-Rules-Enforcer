# Structural Review: hp-07 changes (bridge prompts and game log, table renderer)

**Reviewed:** the 2026-10-27 / hp-07 changes in `bridge/bridge.js` (Seat.respond, notePlay, logEvents,
isAbilityOnStack, targetTitle, chooseCards, chooseBoolean, payManaCost, chooseAttackers, diceRolled, GameAborted),
`tools/engine-renderer.lua` (enginePoisonShow, face-down row, engineUpdateCorner, ability panel, engineGlowLate,
engineHandCount, row offset) and `tools/make-engine-copy.js` ("Hand counter: the engine's count"). Each was read with
the code around it that touches the same mechanism. The earlier `structural-review-bridge-2026-10-20.md` was taken
into account (its findings #2 and #3 are not re-proposed).
**Date:** 2026-10-27
**Total Findings:** 13

| Severity | Count |
|---|---|
| CRITICAL | 1 |
| HIGH | 3 |
| MEDIUM | 4 |
| LOW | 5 |

`COST_PROMPTS` no longer exists. Nothing in this report was changed in the code.

---

## Executive Summary

The biggest strain is in the bridge. Each playtest fix teaches the bridge one more thing the player "just did", so the
next prompt can answer itself or the log can say it. This batch added three Seat memos (`activated` with a name,
`manaTapped`, `played`) and two game-level ones (`game.pendingPlays`, `game.searchedAt`). Including the older ones,
about ten records now share one shape: a card id, a timestamp and a time limit, checked by one later prompt or by the
log. Each one has its own time limit (20, 30 or 60 s, the turn number, or "the next prompt"), its own matching rule
(by card id, by name inside the title, or by `input.cardId`) and its own clearing rule. A Cancel already clears one of
them (`pendingPlays`) and leaves the others set. The game log has the same problem. It works out what happened from
board differences and now also reads these memos. It matches cards three ways (by stack key, by card id, by name), and
the discard step does not check the memo that says a card was just cast.

The table side has one real regression. The new global `onObjectHover` replaces the base table's handler instead of
chaining it, unlike the two other hooks the renderer chains. `hoveredObjs` is no longer filled, so `mtg commander` and
the hover fallback of the base hotkeys stop working. The other table findings are copies that have started to drift:
the glow of a card that appears late copies part of `enginePhase2Prompt`, ability labels are trimmed in two places
because the bridge puts the card name in front of them, and the rule "an exact number of picks answers itself" is
written in three places.

If the next few cases arrive with the code in this shape, each new auto-answer will need a new Seat field and its own
time limit, matching and clearing. Each new log fix will add one more lookup from the log into prompt state. Each new
loss reason will add another branch to the GameAborted handler.

---

## Findings by Category

### 1. State-Flag Proliferation

### Structural Finding: About ten separate "the player just did X" records, each with its own time limit, matching and clearing

**Category:** State-Flag Proliferation (with Shadow State)
**Location:** `bridge/bridge.js`:
- Written in `Seat.respond` 350-364: `this.activated` (356), `this.manaTapped` (358), `this.played` (360), `notePlay` → `game.pendingPlays` (361, 991-995); Cancel clears only `game.pendingPlays` (364)
- `played` also written in chooseBoolean's may-pay `toOutput` (1997)
- Read in chooseBoolean `justUsed` 1944-1956 (`activated`, `manaTapped`, 30 s), payManaCost `ownJustNow` 1850-1854 (`played`, 60 s), logEvents 1003-1017 (`pendingPlays`, 60 s)
- The same pattern, older: `seat.attachTo` (set by onIntent 2542, read by chooseBoardTargets 1903-1907, 30 s), `seat.queuedPlay` (1732-1747, `QUEUED_PLAY_MS` 1607), `seat.cardsDone` (2067, 1957, cleared by any other prompt type at 1704), `seat.tappedFor`/`autoPayCard` (1851-1861, 1896-1897), `game.searchedAt` (set in revealCards 2266, read in logEvents 1024-1025, 20 s)

**Severity:** HIGH

**Current shape:**
`Seat.respond` (the method that sends the answer) now looks the chosen action up again in `lastRawPrompt` and derives
three records from it, each with different reset rules:
- `activated` is cleared by any other action.
- `manaTapped` keeps its old value on any other action (`: this.manaTapped`).
- `played` is cleared by any other action, is set again by a "Pay" answer to a may-pay trigger (1997), and is cleared by payManaCost.

Every place that reads one of these records repeats the same three steps inline: check the time (`Date.now() - x.at <
N`), check that it is the same card (by `sourceCard.id`, by the card name inside the title, by `input.cardId`, or by
`att.to`), then set the record to null. Cancel clears `game.pendingPlays` but leaves `seat.played` and `seat.activated`
set. A cancelled ability therefore still counts as "own, just now" for 60 s in payManaCost. A later cost of that same
card (for example its own trigger asking for payment) would then be paid from the pool without asking. This was found
by reading the code, not by reproducing it.

`played` now means two different things: "the player started this cast or ability" and "the player said Pay to this
card's trigger". Only the second use explains why chooseBoolean writes it.

**What this is standing in for:**
A per-seat log of recent player intents with one interface. For example `seat.recent.note(kind, { id, name })` and
`seat.recent.take(kind, match, ttlMs)`, with kinds such as `activate`, `manaTap`, `startPlay`, `payAccepted`, `attach`
and `searchLibrary`. Each entry stays independent, so this does not merge them into one state enum (that is what
`structural-review-bridge-2026-10-20.md` #2 rejected for the auto-pay fields). What the entries share is one time-limit
rule, one id-or-name matching rule, one way of using an entry up, and one `seat.recent.forgetPlay(cardId)` for Cancel.
`game.pendingPlays` and `game.searchedAt` would read the same records instead of keeping their own copies.

**Signal that provoked this finding:**
This batch added three new records and two game-level copies. They have three different reset rules in four lines of
`respond`, and five different time limits: 20 s, 30 s, 60 s, `QUEUED_PLAY_MS` and "the next prompt". `seat.played` and
`game.pendingPlays` record the same event (a cast or ability started, from the same `act`). They are kept in two places
with two clearing rules, and they already disagree after a Cancel.

**Cost of the next case, current shape vs. restructured:**
The next "Forge asks again for a cost you already chose" case is likely: almost every playtest since 2026-10-26 added
one (Food, Clue, Evolving Wilds, Dauthi Voidwalker, Mana Confluence, Springheart Nantuko).
- Today: one new Seat field, one write in `respond` or a `toOutput` with its own reset rule, one inline time-and-card check, one clear, and a decision about whether Cancel should clear it (it usually won't be remembered).
- Restructured: one new kind, one `note` call and one `take` call. Cancel and the time limit are handled already.

**Suggested restructuring (not applied):**
1. Add a small recent-intent store on Seat with `note`, `take` (match, check the time, use it up), `peek` and `forgetPlay`.
2. Keep `respond` as the single place where actions are recorded, but take the action object from the prompt that is being answered (by `promptId`) rather than from `lastRawPrompt`.
3. Move `activated`, `manaTapped`, `played`, `attachTo` and `searchedAt` into the store first. Make `game.pendingPlays` a view of the store's unused `startPlay` entries rather than a second list.
4. Keep `autoPayFailedFor`, `endTurnAt` and `resolveStack` outside the store. The 2026-10-20 review found they are not "recently did" memos.

---

### 2. Special-Case Bolt-Ons

### Structural Finding: GameAborted works out the loss reason from scratch, one reason at a time

**Category:** Special-Case Bolt-On
**Location:** `bridge/bridge.js` 445-463 (`case "GameAborted"`); related: `case "gameOver"` 2358-2362 (says only "Game over."), `isPlaying` 2819 (`status`), the Lua knock-out banner `tools/engine-renderer.lua` ~1111-1116, the board's `cmdDamage` 1189-1193
**Severity:** HIGH

**Current shape:**
The abort handler first checked one reason (an empty library). This batch added a second branch in front of it: life
of 0 or less, or 10 or more poison counters, worked out from the board with hard-coded thresholds. Anything else is
reported as "had to draw from an empty library" if any player's library is empty. The normal `gameOver` prompt gives
no reason at all.

**What this is standing in for:**
One `lossReason(player, gv)` table: life ≤ 0 → "is at N life", poison ≥ 10 → "has N poison counters", commander damage
≥ 21 from one commander → "took 21 from X", conceded (`status`), and drawing from an empty library. It would apply to
players whose `status === "lost"` (or all players when the status is missing). GameAborted, the `gameOver` prompt and
the table's "IS OUT" text would all use it.

**Signal that provoked this finding:**
This shape has already produced a real wrong message: a 12-poison win was reported as "White drew from an empty
library" (the playtest of 2026-10-27). The fix added one more branch. Commander damage is the format's own extra way
to lose. The bridge already tracks it (`cmdDamage`), and with the code as it is now, a commander-damage loss that
aborts would be reported as an empty-library loss or as "Game aborted".

**Cost of the next case, current shape vs. restructured:**
- Today: one more threshold check and message inside GameAborted, and the `gameOver` path still says nothing.
- Restructured: one row in the reason table, and every end-of-game message gets it.

**Suggested restructuring (not applied):**
Pull the `lost` and `empty` logic into `lossReason`. Use `p.status` to decide who lost and the table only to say why.
Call it from both GameAborted and `gameOver`.

### Structural Finding: Poison is drawn as an extra button on the life counter, found again by its label; energy is already sent and shown nowhere

**Category:** Special-Case Bolt-On (and a second way to control the life counter)
**Location:** `tools/engine-renderer.lua` 646-653 (`updateTrackers`), 675-687 (`enginePoisonShow`); compare `setLife` 611-629, which goes through the counter's own patched script (`engineLifeChange`, `tools/make-engine-copy.js` 579-580); bridge board row `bridge/bridge.js` 1198-1199 (`poison`, `energy`)
**Severity:** MEDIUM

**Current shape:**
Life reaches the counter through a function patched into the counter's own script. Poison is added from Global by
calling `createButton`/`editButton`/`removeButton` on the same object, and the button is found again on every board
by searching for a label that starts with `"POISON "`. The board already carries `energy`, which nothing shows. The
table save also has Poison, Energy and Experience counter tokens (bag-spawned, so they cannot be relied on as fixed
per-seat trackers).

**What this is standing in for:**
A "player counters" display owned by the counter's script, for example `engineCounters({ poison = n, energy = m, ... })`
patched in the same way as `engineLifeChange`. It would draw one strip from a list, and only for the counters that
are not zero.

**Signal that provoked this finding:**
The life counter is now controlled two ways (a patched script function, and Global editing its buttons from
outside). The second way finds its button by text, because nothing else ties the button to poison. Energy,
experience and rad would each need the same handling again.

**Cost of the next case, current shape vs. restructured:**
- Today: another `engineXShow` with its own label prefix, its own position next to the poison button, and its own call in `updateTrackers`.
- Restructured: one more entry in the list that is passed in.

**Suggested restructuring (not applied):**
Move the poison button into the counter's script as a generic counter strip, patched by make-engine-copy. Have
`updateTrackers` pass `{ poison, energy }`.

### Structural Finding: targetTitle has two tables that turn Forge's AI hint words into verbs, plus an inline exception for "sacrifice"

**Category:** Special-Case Bolt-On
**Location:** `bridge/bridge.js` 1386-1402 (`TARGET_VERBS`, `targetTitle`'s `playerVerb` map, the `/^sacrifice$/` noun branch); caller 1914-1916 (works out `noun` from the candidates' types)
**Severity:** LOW

**Current shape:**
Card hints use `TARGET_VERBS`, player hints use an inline object literal (`buff`/`pump` appear in both, set to `""`),
and "sacrifice is a choice, not a target" is a regex test in the middle of the function. The caller works out a noun
that is used only on that path.

**What this is standing in for:**
One `AI_HINTS` table keyed by hint word: `{ cardVerb, playerVerb, choiceNotTarget }`.

**Signal that provoked this finding:**
Two of the three hint fixes on 2026-10-27 changed this function in two different places.

**Cost of the next case, current shape vs. restructured:** Today you have to decide which map to change, or whether it
is another inline exception. With one table, it is one row.

**Suggested restructuring (not applied):** Merge both maps into one table and let `choiceNotTarget` choose the noun.

---

### 3. Parallel / Duplicate Control-Flow Paths

### Structural Finding: The renderer's `onObjectHover` replaces the base table's handler instead of chaining it

**Category:** Parallel Control-Flow Paths (two definitions of one global event hook; the second silently wins)
**Location:** `tools/engine-renderer.lua` 5401-5405 (new `function onObjectHover`). It is added after the base
Global script by `tools/make-engine-copy.js` 552. The base Global (Workshop 2296042369) defines `hoveredObjs={}` and
`function onObjectHover(ply,obj) hoveredObjs[ply]=obj end`. Readers of `hoveredObjs` that are now never fed:
`engineMarkCommander` (`tools/make-engine-copy.js` 457, the `mtg commander` command), and the base table's
`move2grav`, `move2exile` and `move2botLib` hover fallback.
The project's own convention for this, which the new hook does not follow: `local tableEnterContainer =
onObjectEnterContainer` … `return tableEnterContainer(...)` (renderer 3018, 3069), and `local before =
onObjectEnterZone` (5038-5039).
**Severity:** CRITICAL

**Current shape:**
Global Lua functions with the same name are combined by concatenating the scripts, so the last definition wins. The
two older hooks keep the base handler and call it. The new hover hook does not keep or call it. The base handler only
records `hoveredObjs[ply] = obj`, so that table stops updating from the moment the engine copy loads, whether or not
`ENGINE_MODE` is on. The new hook also returns early when `ENGINE_MODE` is off.

**What this is standing in for:**
A single helper for attaching to TTS's global events, for example `engineHook("onObjectHover", fn)`. It would keep the
previous function and always call it first. Then every renderer hook chains, and none depends on remembering to.

**Signal that provoked this finding:**
This was found by comparing the global function names in the base Global with those in `engine-renderer.lua`. Three
names are defined in both: `onObjectEnterContainer`, `onObjectEnterZone` and `onObjectHover`. Two of them chain and
the new one does not. `mtg commander` now always answers "Keep your mouse over your commander card…", because
`hoveredObjs[pl.color]` stays nil. I did not test this live, but it follows directly from how Lua handles a second
global definition.

**Cost of the next case, current shape vs. restructured:**
- Today: every new global hook has to remember to chain by hand, and forgetting breaks base-table features without any error.
- With `engineHook`: no call site has to remember anything.

**Suggested restructuring (not applied):**
Short term: `local tableHover = onObjectHover` above the definition, and call `tableHover(color, obj)` first. Later:
an `engineHook` helper, plus a make-engine-copy check that fails the build when `engine-renderer.lua` defines a
global function that the base Global also defines without saving the base one.

### Structural Finding: The game log works out what happened in two ways that do not consult each other (board differences vs. records left by the prompt code)

**Category:** Parallel Control-Flow Paths (with Leaky Abstraction)
**Location:** `bridge/bridge.js` `logEvents` 997-1075: stack lines 1005-1008, the pending-plays loop 1009-1017, searched-vs-drawn 1021-1027, the discard group 1030-1040, "put into graveyard" 1057. Inputs: `logSnapshot` 965-971 (stack keyed by `sourceId|abilityText`, "a spell keeps changing ids"), `notePlay` 991-995 (keyed by `act.cardId`), `game.searchedAt` set in onPrompt revealCards 2266, `seat.lastRawPrompt.promptId` read at 1013.
**Severity:** HIGH

**Current shape:**
There are now two parallel sources for "X casts / uses Y":
1. **Board differences:** the stack grew.
2. **Records left by the prompt code:** `game.pendingPlays`, said when the card appears in a public zone or once that seat has been asked about priority again.

They reconcile through `said(id, kind)` by card id. The stack itself is keyed by `sourceId|text`, because ids are not
stable while a spell is being cast. The discard and "is put into graveyard" inference treats "came from the stack" as
"its *name* was on `prev.stack`" (1033, 1057). The log function also reads prompt-sequencing state: it compares
`seat.lastRawPrompt.promptId` with `e.promptId` (1013). `searchedAt` is another record of the same kind, kept with
its own 20 s window.

Three different ways of identifying a card (stack key, card id, name) in one function mean a fix in one place is not
seen by the others. Likely case (found by reading, not reproduced): an instant cast and resolved between two boards.
It never appears on a stack in any board, which is exactly the case `pendingPlays` was added for. It shows up in the
graveyard while its owner's hand count goes down. Because the discard group does not check `pendingPlays`, it logs
"White discards Lightning Bolt", while the pending loop logs "White casts Lightning Bolt". In the other direction: if
a stack `sourceId` differs from the hand `act.cardId`, `said()` never matches, the pending entry stays, and the spell
may be logged as cast a second time when it enters the battlefield. Stage 3 should check both cases with a real board
sequence.

**What this is standing in for:**
One list of what each player did, built in a single place. The prompt and answer code adds typed hints
(`startPlay`, `searchLibrary`; ideally the same records as the recent-intent store in finding 1). `logEvents` uses
each hint once, with one identity rule, before the board differences are turned into lines. The rule "this seat got
priority again" is decided where prompts arrive (onPrompt sees the next `chooseAction` for that seat and marks the
seat's pending abilities as resolved). The log does not compare prompt ids itself.

**Signal that provoked this finding:**
Three log fixes on 2026-10-27 (pending plays, searched-vs-drawn, grouped discards) each added a heuristic that does
not consult the others. `logEvents` now depends on `game.seats`, `lastRawPrompt` and timing windows, none of which
come from the two snapshots it is given.

**Cost of the next case, current shape vs. restructured:**
- Today: a new log fix (for example "returned to hand" vs "bounced", or a spell copied) means one more side list on `game`, one more time window, and checking all three identity rules for clashes by hand.
- Restructured: one new hint kind, used up in one place, which every inference that follows can see.

**Suggested restructuring (not applied):**
Pass `logEvents(prev, cur, hints)` explicitly, where `hints` comes from finding 1's store (or one `game.logHints`
queue). Put a single `consumedIds` set in front of every zone inference (the discard group, "put into graveyard",
"enters the battlefield"). Choose one card identity rule, preferably the stack's `sourceId` with a fallback to the
name, and use it everywhere.

### Structural Finding: `engineGlowLate` repeats the "cards" and "target" glow branches of `enginePhase2Prompt`; a card that appears late is handled three different ways

**Category:** Parallel Control-Flow Paths
**Location:** `tools/engine-renderer.lua` 3172-3181 (`engineGlowLate`) vs 3211-3213 (the same branches in `enginePhase2Prompt` 3182-3242); call 356 (spawn callback in `place`). Other ways a late card is handled: `engineStackGlow[c.id] = nil` "redrawn on the next board" (350), and ability buttons drawn from `engineAbilityWant` inside `updateBadge` (353, 5314 comment).
**Severity:** MEDIUM

**Current shape:**
`engineGlowLate` copies two `elseif` branches of the full prompt redraw so it can apply them to a single card id. The
copies have already diverged: the original "cards" branch requires `engineObjs[id] ~= nil`, while the copy has no such
check (the spawn callback stores the object first, so it holds today). Things the full redraw does for a card that the
late path does not do: the "action" right-click menu (3219-3238), the "Don't block with this" menu (3203-3210),
mana/attack/block glows. A card that arrives after its question is asked can glow but has no menu.

**What this is standing in for:**
A per-option function, `engineDecorateOption(color, p, kind, i, o)`. It would draw the glow and menu for one option.
`enginePhase2Prompt` would loop over every option with it, and the spawn callback would call it only for the options
that name the new card. The two paths would then be the same code with different filters.

**Signal that provoked this finding:**
The original and the copy already have one difference (the `engineObjs` check). Late arrival is now handled in three
different ways (cleared and redrawn on the next board, drawn from a want-table, replayed from the prompt).

**Cost of the next case, current shape vs. restructured:**
- Today: a late-arriving attacker, blocker, or card with a right-click action needs another branch copied into `engineGlowLate`.
- Restructured: nothing to add, because every option kind already goes through the per-option function.

**Suggested restructuring (not applied):**
Pull the loop body of `enginePhase2Prompt` out into `engineDecorateOption`. Have `engineGlowLate(id)` loop over the
open prompts and call it for the options whose card id is `id`.

### Structural Finding: The rule "an exact number of picks answers itself at the last click" is written in three places, and the corner button slot now holds a fake value meaning "not a button"

**Category:** Parallel Control-Flow Paths (minor Config/Flag smell)
**Location:** `tools/engine-renderer.lua` `engineConfirmIfComplete` 2476-2480 (`mode=="multi" and min==max and max>=1`), `engineUpdateCorner` 1979-1981 (the same test, inside the multi branch, minus attack prompts) and the hint 1898-1899 (the same test for `kind=="cards"`); `cornerPress` 2528 (`v == "count"` ignored)
**Severity:** LOW

**Current shape:**
`engineCorner[color].big` can hold an option index, `"confirm"`, `"cancel"`, and now `"count"`, a value whose only
meaning is "a label, not a button". `cornerPress` has to know to ignore it. Three places repeat the auto-answer
condition with small differences: attack prompts are excluded in one place, and the hint order makes `pileChoices`
and `toLibrary` take priority.

**What this is standing in for:**
A prompt "answer mode" decided once (for example in `describePrompt`: `autoAnswer = exactCount`). The confirm check,
the corner and the hint would all read it. The corner would also need a separate field for "show a label, take no
clicks", so that `big` only ever holds a button action.

**Signal that provoked this finding:** This batch added the "count" value and a third copy of the condition.

**Cost of the next case, current shape vs. restructured:** Changing the rule (for example to exclude target prompts)
means editing three conditions today, and one field after the change.

**Suggested restructuring (not applied):** Add `describePrompt(p).autoAnswers`. Give the corner state `{ big, bigLabel,
bigInert }` instead of an action value that does nothing.

### Structural Finding: The "End turn" auto-pass is checked separately in each prompt handler

**Category:** Parallel Control-Flow Paths
**Location:** `bridge/bridge.js` chooseAction 1750-1754 (checks `seat.endTurnAt === gv.turn`, clears it otherwise), chooseAttackers 2152-2155 (the same check, never clears it)
**Severity:** LOW

**Current shape:**
The condition for an auto-pass mode is copied into a second prompt case, and only one of the two copies clears the
field. This does not re-propose merging `endTurnAt` and `resolveStack` (the earlier review #3 rejected that).

**What this is standing in for:** A function `autoPassAnswer(seat, type, gv)` that returns an answer or null, called
once near the top of `onPrompt`. It would cover `endTurnAt` (pass / no attacks), `resolveStack` and `autoResolve`,
and would hold the rule for when each mode ends.

**Signal that provoked this finding:** hp-07 added a second copy of the check.

**Cost of the next case:** Another prompt type that "End turn" should skip (an optional trigger in your own end step?)
means a third copy today, and one more case in the function after the change.

**Suggested restructuring (not applied):** Pull the check out into `autoPassAnswer`. Keep both fields as they are.

---

### 4. Leaky Abstractions

### Structural Finding: The bridge puts the card name in front of ability labels, and two Lua places remove it again

**Category:** Leaky Abstraction compensated by caller-side special-casing
**Location:** The label is built at `bridge/bridge.js` 1826 (`${cname(a.cardId) || a.label}: ${a.description}`). It is removed in `tools/engine-renderer.lua` `enginePhase2Prompt` 3226-3228 and `engineAbilityBoxes` 5315-5319 (the same three lines: `own .. ": "` prefix, then `^Activate [^:]*: `). The option kind is also guessed from the label in `engineAbilityBoxes` 5311-5312 (`^Mana:`, `^Cast `, `^Play `, ids `tap:`/`untap:`).
**Severity:** MEDIUM

**Current shape:**
An option carries one display string. The answer list needs it with the card name in front. The card's own buttons,
menu and the new screen panel each need the ability text alone, so each trims the string with the same pattern. The
renderer also works out an option's kind (cast, play, mana, ability) by matching the label text.

**What this is standing in for:**
Structured option fields from the bridge: `act = "cast" | "play" | "ability" | "mana" | "undo"` and `abText` (the
ability without the card name or "Activate …:"). Lua then reads `o.abText` and `o.act`, and the label stays for
display only.

**Signal that provoked this finding:**
This batch fixed the context menu by copying the trimming already in `engineAbilityBoxes`. The panel shows the
trimmed text through `engineAbilityWant`. Any change to the bridge's label format (for example the `castLabel` "—
mode" suffix, or the "(option 2)" numbering) silently breaks every Lua copy that parses it.

**Cost of the next case, current shape vs. restructured:**
- Today: a third place that needs the ability text (a tooltip, or the popup) means a third copy of the trimming. A label format change means checking every copy.
- Restructured: read `o.abText`.

**Suggested restructuring (not applied):**
Add `act` and `abText` to the chooseAction options in the bridge (1825-1828). Replace both Lua trims and the
label-prefix kind guesses with these fields.

### Structural Finding: The engine's data does not say what the bridge needs, so it guesses: spell vs. ability on the stack, and the life amount of pay-life

**Category:** Leaky Abstraction
**Location:** `bridge/bridge.js` `isAbilityOnStack` 979-985 (a regex on the "When/Whenever/At/As" wording, plus "the source is still in a zone other than hand or library"); payManaCost `lifeN` 1884-1885 (tries `life`, `amount`, `lifeToPay` and `n` in turn); `StackObjectDto` in `docs/engine-interface-reference.md` 217 has no spell/ability flag
**Severity:** MEDIUM

**Current shape:**
Whether a stack item is a spell or an ability is worked out from wording and zone membership. Each wrong case so far
was fixed by narrowing the guess (Lightning Bolt logged as an ability, then a buyback spell still listed in hand). The
pay-life amount is read from whichever of four field names happens to be present.

**What this is standing in for:**
The project builds its own engine images (`mtg-forge-node:exile`). An `isAbility` (or `kind: spell|ability|trigger`)
field on `StackObjectDto`, and a fixed `life` field on the pay-life action, would make both guesses unnecessary. Until
that exists, each guess should live in one documented adapter function, next to the interface reference.

**Signal that provoked this finding:** `isAbilityOnStack` has been narrowed twice. `lifeN` was written without knowing
the field's name.

**Cost of the next case, current shape vs. restructured:**
- Today: the next misread (a spell cast from exile that stays listed in exile: foretell, adventure, plot) needs another zone exclusion.
- With the flag in the engine data: no work.

**Suggested restructuring (not applied):**
Add the field in the engine image, and keep the guess only as a fallback for old images. Pin the pay-life field
against a raw capture (`MTG_RAW=1`) and record it in `engine-interface-reference.md`.

### Structural Finding: `cardLabel(c, onBattlefield)` takes a true/false second parameter, which `.map` fills with the item's index

**Category:** Leaky Abstraction
**Location:** `bridge/bridge.js` `cardLabel` 1289; the fixed caller in revealCards 2258 (`.map((c) => cardLabel(c))`), and the same wrapping in scry 2171 and stateSummary 1466
**Severity:** LOW

**Current shape:**
Passed directly to `.map`, the second parameter receives the index, so every card after the first gets
battlefield-only text ("(sick)"). Every caller has to remember to wrap it.

**What this is standing in for:** An options object (`cardLabel(c, { onBattlefield: true })`) or a separate
`battlefieldLabel(c)`.

**Signal that provoked this finding:** An hp-07 fix was exactly this mistake.

**Suggested restructuring (not applied):** Split it into `cardLabel(c)` and `battlefieldLabel(c)`.

Also noted, not raised as a finding: a player's display name is now worked out in five places: `nameOf`,
`displayText`, `who()` in logEvents, `who()` in diceRolled (2281, which tries `slotNames`, then `displayText(label)`,
then `nameOf`), and `isMe` in the clash prompt. Merging them into one function (slot or engine username → table name)
would make sense if a sixth appears.

---

### 5. Config/Flag Combinatorics

None found beyond the corner `big` fake value already covered under §3.

---

### 6. Shadow State

### Structural Finding: Ability-panel clicks go through the card object's button index, not the list the panel shows

**Category:** Shadow State
**Location:** `tools/engine-renderer.lua` `onMtgAbPanel` 5393-5400 → `onMtgAbility` 5350-5372 → `engineAbilityIds[guid]` (5230, set only in `engineAbilityButtons` 5284 when the buttons are drawn on the object); the panel's content comes from `engineAbilityWant[id]` (5377-5391)
**Severity:** LOW

**Current shape:**
The panel shows `engineAbilityWant[id].list` (keyed by engine card id). A click builds the string `"ab|<guid>|k"` and
looks the option up in `engineAbilityIds[guid]`, a second copy of the same ids made when the buttons were drawn on
the card. If the card object's buttons have not been drawn yet (still spawning, or the badge is not refreshed yet),
the panel shows abilities that its clicks cannot find.

**What this is standing in for:** The panel resolving `engineAbilityWant[id].list[k].id` directly and calling
`enginePick` by option id. `engineAbilityIds` would stay only for the on-card buttons, or be derived from
`engineAbilityWant` by `engineIdOf(obj)`.

**Signal that provoked this finding:** A new reader (the panel) goes through the copy instead of the original list.

**Suggested restructuring (not applied):** In `onMtgAbPanel`, use `engineAbilityWant[engineAbPanelFor[c]].list[k].id`
and `findOption`.

Not raised as findings: the hand counter now reads the engine's `handCount` (`engineHandCount` 4226-4230 plus the
make-engine-copy patch 583-584) instead of counting objects in the hand. That removes a duplicate count rather than
adding one. `engineRowTall` (2399-2404) stores what the code last applied, on purpose, so that a panel the player
dragged keeps its position. The face-down row test `c.fd and c.p ~= nil` (1197) exists because the bridge leaves out
`ty` for face-down cards (`tableCard` 884-891), although "Creature" is public there. Sending `ty: ["Creature"]` for a
face-down permanent with power would remove the inference, but it has only one reader today.

---

## Explicitly Out of Scope for This Report
This review only asked "is this the right shape." It did not check correctness, safety, concurrency or production
readiness (see `code-analysis-ruleset` for that). It did not check for redundant or dead code or apply any fixes (see
`simplify`; that skill *does* apply fixes, this one never does). A clean structural report is not a correctness or
quality sign-off on its own. The CRITICAL hover finding and the possible double logging in the log finding are
correctness consequences found while reading for shape. Stage 3 should confirm them.

## Recommended Next Steps
1. **Fix the hover hook first** (§3, CRITICAL): chain the base `onObjectHover` so that `hoveredObjs` and `mtg
   commander` work again. Then consider an `engineHook` helper and a build-time check for unchained duplicates.
2. **The recent-intent store** (§1, HIGH): this is where the next playtest fix is most likely to land. Move
   `activated`, `manaTapped`, `played`, `attachTo` and `searchedAt` into it, and make Cancel clear the entries for
   that play.
3. **One list of hints for the game log** (§3, HIGH): build it on step 2. Have `logEvents` use hints once, with one
   card identity rule. Check the possible double line (cast + discard) for an instant that resolves between two boards.
4. **`lossReason`** (§2, HIGH): add it before commander damage first ends a game.
5. **Structured option fields `act` and `abText`** (§4, MEDIUM): this removes both Lua trims and the label-prefix
   guesses. Then extract `engineDecorateOption` (§3, MEDIUM) so that late-arriving cards get the full decoration.
6. The rest (the engine-data flags, a generic player-counter strip, the auto-answer mode, the `autoPassAnswer`
   check, the hint-word table, the panel click path, and the `cardLabel` split) can be done whenever their code is
   next changed.

---

## Applied (jr-programmer-suite stage 1, 2026-10-27)
1. onObjectHover chained to the table's own (do-block `before`); claim "hover: the table's own handler still runs".
2. Seat.note / justDid / forget ("activate", "manaTap", "start", "search") replace activated/manaTapped/played and
   game.searchedAt; Cancel forgets all of them. Scenario "pay: after a cancelled cast, a later cost of that card asks
   again". (The older auto-pay fields stay apart, per the 2026-10-20 review.)
3. Log: castNow keeps a just-logged cast out of the discards and the graveyard line; "priority came back" is
   seat.priorityPromptId, set in onPrompt. Scenario "a spell cast and resolved into the graveyard between boards is one
   cast line".
4. LOSS_REASONS + lossReasons(gv): life, poison, 21 commander damage; used by GameAborted and the gameOver prompt.
5. engineGlowOption: one per-option glow for enginePhase2Prompt and engineGlowLate.
6. The bridge sends `ab` (the ability alone) on priority options; engineAbilityText(o) is the one place the table
   reads it (falls back to cutting the name off for older messages).
7. NOT APPLIED: an isAbility flag on stack items and a fixed pay-life field need an engine image rebuild, which can't
   happen while the hp-07 test game is still wanted for the undo re-test. Deferred to the next engine build.
8. enginePlayerCounters: poison and energy in one label, found by its tooltip.
9. engineExactPick(p): one rule for the auto-confirm (multi only), the corner (label only, no fake action) and the hint.
10. endTurnHolds(seat, gv): one End-turn check for priority and attackers.
11. HINT_WORDS: one table of Forge's AI hint words for card and player targets.
12. engineUseAbility(color, optionId): one path for buttons and the panel; the panel reads engineAbilityWant.
13. cardLabel(c) takes one argument; battlefieldLabel(c) adds "(sick)".

## Simplify (jr-programmer-suite stage 2, 2026-10-27)
Four reviews (reuse, simplification, efficiency, altitude). Applied:
- Bridge: face-down cards send `ty` (the Lua special case went); pay-life reads `payLife.amount`; the legend rule reads
  Forge's description; one CONFIRMS loop (sacrifice, pay life) that also checks the ability's cost names that part;
  may-pay told by its "you may pay … . If you do" template; seatOfSlot, countWords, cardNameIn(…, fallback);
  pendingPlays made with the game and filtered once; fromStack; `ab` only on activateAbility; PLAYER_VERBS;
  LOSS_REASONS reads poison once.
- Table: the dead first ability box (XML on the card: engineAbilityXml / Escape / Build, enginePlayableXml / Forget,
  the frame's concat) removed; engineAbilityIds removed: nine shared click functions `engineAbBtn1..9` find the
  ability from the clicked card's id (the per-card globals were never freed); onMtgAbility goes the same way; the
  signature is kept on the engineAbilityWant entry; the render asks for ability boxes again only while an option's
  card is not yet a permanent on the table (`p.__abWait`); player counters redraw only on a change; the row offset
  goes through setAttr's own change check; panel buttons are buttons to setText; hover does nothing when no card has
  abilities or that card is already shown; a card that arrives after its question redraws that question on the next
  frame, once per frame (it now also gets its Cast/Play menu, which the late glow alone never gave).
Skipped: engineAbilityText's name-cutting fallback (recorded streams have no `ab`); the pcall guards around side
features (house rule: a side feature must not break the render); promptKind memoising and reusing inPile/c.zone (older
code, outside this diff); taking the buttons off the cards (a product decision, not a cleanup).

## Correctness (jr-programmer-suite stage 3, 2026-10-27)
Two reviews (code-analysis-ruleset), one per file. Every finding applied; each fix has a bridge scenario or a table
check that fails on the code before it (watched red, then restored by hash).

Bridge (15):
1. HIGH a land play is a "cast" in the protocol (Forge's AvailableAction_cast covers isLandAbility): it was logged
   "casts" and "plays". Not a play record any more. Scenario "log: a land play, sent as a cast, is one line: plays".
2. HIGH End turn (and resolve-stack, a queued play, an attach, the records) survived a rewind within the turn and
   passed the redone turn. checkRestored clears them. Scenario "rewind: End turn pressed before a rewind…".
3. MEDIUM a face-down card's real types (a foretold Instant, a manifested land) went to every table. Now only
   "Creature" for a face-down permanent. Scenario "table: a face-down card's real types are not sent".
4. MEDIUM may-pay labels read from the whole card's text could take another ability's "unless you pay" and swap Yes
   and No. The card's text stands in only when it has one "pay". Scenario "may pay: the card's other ability…".
5. MEDIUM an instant or sorcery from a hand into a graveyard between boards was called a discard (an AI's resolved
   Bolt). A discard only when its owner just answered Forge's "Discard" question. Scenarios "log: several cards…"
   (now answers a Discard question first) and "log: an instant into the graveyard with no discard asked…".
6. MEDIUM ninjutsu (an ability whose card is in the hand) was logged as a cast, and an ability logged before a board
   showed it was logged again when one did. The stack uses the player's own record; one record per stack item;
   game.saidEarly. Scenarios "log: an ability from the hand (ninjutsu)…", "log: the stack names an ability…".
7. MEDIUM the end-of-game reason named a player out since earlier (AI 2 at -3). noteOuts/outLast: only who lost
   last. Scenario "game over: a player who lost earlier is not named". (The reviewer's "say the empty library too"
   was not taken: at the end the library count is not to be trusted, which is why poison was read as an empty library
   in the playtest; a known reason still wins.)
8. LOW the same-name legendary shortcut overrode Forge's own description ("Choose a creature to exile"). Only without
   a description, and only your own permanents. Scenario "legend rule: not when Forge's description says otherwise".
9. LOW pendingPlays grew in games nothing logs. Pruned at 60 s in notePlay.
10. LOW Cancel dropped every pending play of the seat and every record. Only the cancelled play, "start" and
    "activate". Scenario "log: a cancelled cast leaves an earlier ability's line".
11. LOW (false comment) Pay on someone else's card's question let the next payment come from the pool unasked. Only
    your own card's. Scenario "pay: after Pay on another player's card's question, the payment still asks".
12. LOW the sacrifice / pay-life auto-yes read the effect's words too. The cost alone (act.cost, else the words before
    ":"). Scenario "sacrifice confirm: the effect's own sacrifice (not its cost) asks".
13. LOW a look at the library made the next turn's draw read "puts a card from their library". Forgotten at a new
    turn. Scenario "log: a draw on the turn after a look at the library is a draw". (A Top-style look and a draw by
    ability within the same turn still reads "puts": left, the window is the same turn.)
14. LOW payment shortcuts matched two missing card ids. A card id is required. Scenario "pay: a payment without a
    card…".
15. LOW "Constructor" read Object's prototype as a verb (Object.hasOwn); "offered first" comment; the pay-life
    option keeps its own id; the land line's prev.stack test was always true (by id now).
Also: the cases' seat options are copied per run (structuredClone): a record forgotten in one capture run changed
the case for the second, and the capture reported "not deterministic".

Table (12):
1. HIGH an exact pick of cards (legend rule, "Discard (1)") had no Done and the last click did not answer:
   the player was stuck. The last click answers (clickGesture, enginePickById), the tell and the library hint say so.
   Check "an exact pick of cards answers at the last click".
2. MEDIUM a question the table draws nothing for kept the last question's ability buttons, and a click on one sent an
   option of the same position id to the new question. The buttons go; a click carries the question it was drawn for
   (engineUseAbility refuses another). Checks "…takes the ability buttons away", "…does not answer the next one".
3. MEDIUM a reset left the ability panel up and the ability state. engineClear ends each question through
   engineExitPrompt and calls engineAbilityReset. Checks "a reset hides the ability panel", "…forgets the abilities".
4. LOW-MEDIUM the poison label outlived the game; the change check trusted a label the tracker's own onload could have
   cleared. engineCountersReset; the check also looks for the button. Check "a reset takes the poison label away".
5. LOW-MEDIUM a card bounced to the hand kept dead buttons: cleared when its want goes. (No check: escapes, see the
   mutation pass.)
6. LOW-MEDIUM "Untap X (mana back)" got a button. Excluded; with "ab" sent, only "ab" options are abilities. Check
   "an Untap (mana back) option gets no ability button".
7. LOW the signature held position ids and redrew every card's buttons when options shifted: by text now.
8. LOW __abWait: the comment now says what it does (kept: a card the table still has in a hand when the question
   comes is the case it exists for; the narrower rule failed "a card that arrives after its question").
9. LOW the late redraw was dropped when another question replaced the first: it redraws whatever is open.
10. LOW two colours naming one token stack: a colour change counts as a change.
11. LOW the panel after a UI rebuild: engineAbPanelFor reset where the panels are rebuilt.
12. LOW 9 card buttons vs 6 panel rows: ENGINE_AB_BUTTONS = ENGINE_AB_MAX. The hand counter showing the engine's count
    (one more while a drawn card is held on the library) is left: the engine's count is the hand size.
False comments corrected: the ability header ("only you see it", "beside it", "mana abilities left out"), the late
redraw ("once however many"), the waiting comment, engineCut's comment moved back above it. The others it listed
("dropped here and nowhere else", "while there are any", "goes when that card has no buttons", "the last click
answers") are true now that the code does what they say.
