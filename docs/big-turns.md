# Big turns: huge trigger and token turns

What happens when one turn makes hundreds of triggers or tokens, why it was slow, and what changed. Branch `big-turns`
(2026-11-16).

## 1. The case

Live 2026-11-15 ~23:06 (`bridge/game-log.txt` ~5340-5361, `tmp/table-log.log` ~25880-25990, `tmp/bridge-live.log`
~140641-140840). Blue had Scute Swarms and Adrix and Nev (Parallel Lives had gone to Boseiju), played an Island, then
cast Second Harvest.

- **The landfall run:** 75 Scute Swarm triggers took 73.5 s, about 0.98 s each. Every trigger cost two priority prompts
  (Blue's and Yellow's; White and Red were AI). The bridge answered each in about 0 ms. Blue's prompt took 270 ms at the
  start and 1,645 ms at the end (it includes the resolution). Yellow's prompt took 157 ms, growing to 720 ms (priority only).
- **Second Harvest:** 137 s inside Forge with no prompt at all, then "creates 12 Insect tokens / 448 Scute Swarm tokens /
  Game over: a draw". That was the runaway limit of that day's engine (5,000 triggers, 1,000 cards per turn; engine1117-cap
  put back Forge's 25,000). Nobody was asked.

## 2. Where the time goes (measured)

Forge alone, `BigTurnTimingTest` (AI-only board: 7 Forests, Adrix and Nev, N Scute Swarm tokens; one land played, then
Second Harvest), in `mtg-harness-test:l2-ai` with the big-turns overlay:

| Scute tokens | landfall triggers | resolve ms per trigger | snapshot ms (one viewer) | snapshot bytes | action list ms |
|---|---|---|---|---|---|
| 25 | 25 | 79 | 35-37 | 41 KB | 3.5-6.3 |
| 50 | 50 | 59 | 16-19 | 72 KB | 2.0-5.6 |
| 100 | 100 | 56 | 48-54 | 133 KB | 2.1-4.5 |
| 200 | 200 | 84 | 27-41 | 256 KB | 2.4-4.2 |
| 400 | 400 | 115 | 91 | 501 KB | 5.3-8.5 |

| Scute tokens | Second Harvest: tokens made | resolve | per new token |
|---|---|---|---|
| 25 | 50 | 0.09 s | 1.8 ms |
| 50 | 100 | 0.25 s | 2.5 ms |
| 100 | 200 | 0.74 s | 3.7 ms |
| 200 | 400 | 3.9 s | 9.7 ms |
| 400 | 800 | 23.7 s | 29.6 ms |

- **A landfall run** is per-prompt cost. One resolution in Forge is 56-115 ms. The live second per trigger was mostly the
  two human priority prompts: each builds the action list, a snapshot for every viewer (up to 500 KB each at 400 tokens),
  and a round trip through node, relay and bridge.
- **Second Harvest** is Forge's own cost, and it grows with the square of the board: each new token makes the engine
  recheck static abilities over everything on it. 800 tokens took 23.7 s; the live 137 s fits that curve with a bigger board
  and real players. Nothing below changes that (see section 6).
- **The bridge** (`tests/bench_big_board.js`): at 1,000 tokens one board costs 48-50 ms of log diff, about 120 ms of
  table message, and 170-215 KB to TTS. At 3,000 tokens it is 97-276 ms and 349-476 ms.
- **The table** (`tests/bench_big_table.js`, fake TTS): the token piles hold. 20, 100, 1,000 or 3,000 Scute tokens are
  one table object (147 objects in all every time). The message grows: 5 / 21 / 198 / 597 KB, and the fake TTS takes about
  2 s more per 3,000-token board.

## 3. What already existed

- **Bridge:** `stackGroups` sends a run of identical untargeted triggers as one stack item with a count; `countedTriggers`
  writes the log once with "×N"; the trigger-order question groups alike triggers (`triggerBlocks`); "Resolve all"
  (`RESOLVE_ALL_CAP` 200 passes, loop detection) and "Resolve N× name"; auto-resolve; `mtg skip`; "End turn"; `mtg hold`.
- **Table:** `groupTokens`, with identical tokens drawn as one object with an ×N badge (`ENGINE_GROUP_MIN` = 5,
  `docs/token-stacks-spec.md`).
- **Engine:** the protocol's `pass` already had `exhaustStack` (`ChooseActionOutput::Pass`). The harness controller already
  held such a pass: it passes without prompting until the stack is empty or something new goes on it. The bridge never sent it.
- **The limit:** Forge's per-turn guard (`Game.java`, "Endstep patch 24"): cards per turn, triggers per turn, tokens per
  effect (100). Over a limit, the game ended in a draw.

## 4. What changed

### 4.1 Identical triggers resolve back to back (bridge + engine)

- **Engine:** a held exhaust pass now also ends once 20 of its stack items have resolved
  (`PriorityFastForward.EXHAUST_RESOLUTIONS`). The holder is asked again every 20, so their table catches up and they get a
  chance to stop. Since 2026-11-25 (4.5) the pass covers the run on top of the stack only (`topRunIds`) and ends when the
  item under it is on top, and once the same run has been held for a minute (`LONG_RUN_SECONDS`) it is no longer cut at 20.
- **Bridge (`heldPass`):** when the bridge passes a priority by itself and the **top** of the stack is one run of at least
  `HELD_MIN` (5) of the same untargeted ability (`stackRun`; until 2026-11-25 the whole stack had to be the run), it sends `{ type: "pass", exhaustStack: true }`. That covers
  Arena-style passing, End turn, Resolve all, Resolve N×, auto-resolve and `mtg skip`. A plain "Resolve" press is still one
  pass. The opponent's half is held too: Yellow's prompts were the other half of the live cost. Nothing else changes:
  every trigger still resolves on its own in Forge, and any question (a "may", a target, an order) is still asked.
  "Resolve all" counts the triggers a held pass resolved (`heldResolved`), so its cap and "Resolve N×" stay right.
- **One chat line** for a run longer than 20: "75 Scute Swarm triggers resolve back to back; the table catches up every
  20, and after a minute only once the rest are done. Type "mtg stop" to stop at the next catch-up."
- **`mtg stop`** (chat; `stopchain` to the bridge): the seat's next priority with something on the stack is asked,
  whatever would have passed it. "Resolve all" and a "×N" yes/no run end at once. Because of the held pass it takes effect
  within 20 triggers.
- **Not held:** a spell or another ability on top of the run (a spell under it is fine since 2026-11-25), a targeted run, runs of fewer than 5
  (`tests/golden` stays unchanged, and a few prompts cost little), and a player this seat controls (Mindslaver).

Expected effect on the live case: about 2 × 75 prompts become about 2 × 4, so roughly 75 × (two prompt costs) is
saved. That is most of the 73.5 s. What remains is Forge's own 56-115 ms per resolution.

### 4.2 Token piles (table)

Confirmed on huge boards: one object per pile at any size (section 2). The remaining cost is the board message (about
85 bytes per token). With 4.1 there are about 20 times fewer boards in a run. Compacting the message (one entry with an id
list for identical tokens) was **not built**: it would change every golden board, and after 4.1 the per-board cost is no
longer the bottleneck. It is the next step if a 3,000-token board is still slow on real TTS.

### 4.3 The runaway limit asks (engine)

- At a limit Forge asks through `Game.RunawayChoice`. The harness session (`keepGoingPastCap`) asks the active person, or
  else the first person at the table. Title: "This turn passed the engine's limit". Body: "5,001 triggers have fired this
  turn, past the engine's limit of 5,000. Every one of them is real and the game is slower with each. Keep going allows as
  many again (2 more times this turn after this). End in a draw ends the game now: the rules' result when a loop can't
  be stopped." Buttons: "Keep going" and "End in a draw".
- "Keep going" raises that limit by its own size, at most `RUNAWAY_CONTINUES_PER_TURN` (3) times a turn. The fourth time
  in a turn it is a draw without asking. A new turn starts the count again.
- The card limit is asked at the next trigger or token request, not in the middle of making a card (`cardsCapPending`).
  Two card limits passed before that point are a draw.
- The token limit for one effect (100) asks once for that size: 128 copies from stacked doublers asks once, and the next
  effect that size goes through.
- A pass or a timeout is "End in a draw". With no person in the game (AI only), it is a draw as before.
- **Bridge:** the question is shown with the engine's words and buttons, with no "×N" buttons. After the answer, everyone
  is told: "Blue kept the turn going past the engine's limit." or "Blue ended the game in a draw at the engine's limit
  (too many triggers or tokens this turn)."
- **Rules:** CR 104.4b: a loop of mandatory actions that can't be stopped is a draw. That stays the answer for a real
  loop: a person who picks "Keep going" is at most asked 3 times, then the draw comes. A huge but finite turn (Second
  Harvest) now gets to finish if the players want it to.

### 4.4 Merge (engine): Forge's `StackMerge`, allowlist only

After a stack item resolves, the alike items below it resolve at once, as many as the gate allows (asked again after
every item; see 4.6 for the effects allowed since engine1131-batch). Each goes through the usual
`AbilityUtils.resolve` with its own source, and the game fires its usual events. What is skipped between them is the
priority round, the state-based-action check, the static-ability pass and the LKI copy. Those run once after the last.

**When (the gate):** only when every player still in the game is a person whose held exhaust pass covers the whole stack
(`ManaBrewInteractiveSession.heldByEveryone`), and only up to where the first of those passes ends. So no player loses a
decision they had not already passed. Any AI or Manabot seat turns merging off: the AI gets priority after each
resolution and could act on any of them. With no gate (AI-only games, the parity harness) nothing is merged.

**The allowlist (v1), with why each entry is safe:**

| Entry | Why it is safe | Not merged when |
|---|---|---|
| GainLife, untargeted, "you", a fixed number (Soul Warden, Soul's Attendant, Bloodfell Caves-style lands) | Gaining life never causes a state-based action (704.5a is life 0 or less). The amount is a number and does not read the board. Each item still calls `Player.gainLife` with its own source, so life gained this turn and the times gained count each one. | A LifeGained or AbilityResolves trigger is active or delayed (Ajani's Pridemate, a "whenever you gain life" emblem; in the usual order each one's trigger goes above the rest of the run). A GainLife replacement is anywhere (Boon Reflection, Rhox Faithmender; a replacement may ask which applies first). The trigger is optional (it asks), has an intervening "if" or a resolving check (`IsPresent`, `CheckSVar`, `ResolvingCheck`), conditions, an unless cost, remembering, a sub-ability or a controller change. A trigger is waiting to go on the stack. |

**Left out on purpose** (4.6 adds plain tokens, self +1/+1 counters, self pumps and mana, each only when nothing
watches them):

- **Token creation while anything watches it** (the Scute Swarm case is a token with its own trigger): a batch of
  tokens is one "one or more" event, and copies of a token differ by source. Merging changes what triggers and how often.
- **Life loss:** players can leave the game between items.
- **Damage:** each item has its own source, and lifelink, infect and damage watchers see each one.
- **Counters while anything replaces or watches them:** Hardened Scales-style replacements apply per event.
- **Drawing:** Alms Collector-style "two or more" replacements; an empty library is a state-based action.

So the merge does not touch the landfall case; 4.1 does. Merging is for Soul Warden swarms, where each trigger was a full
priority round.

### 4.5 Long chains: heap, trigger count, skip to the result (engine + bridge, 2026-11-25)

The Kykar stress runs (Kykar + Hullbreaker Horror + Third Path Iconoclast loop, and a Monastery Mentor variant with 150
prowess Monk tokens) were asked "keep going?" long before anything ran away, and long trigger chains took minutes.

- **Heap (Forge `Game.java`):** the heap share is read with garbage counted, so a read over `RUNAWAY_HEAP_LIMIT` (0.85)
  first frees unused memory (`System.gc()`, at most once every `HEAP_FREE_SECONDS`, 5 s) and reads again. Only a heap
  still over the limit ends the game. Tests swap the freer with `Game.setHeapFreer`.
- **Trigger count (Forge `TriggerHandler.java`):** the per-turn trigger limit counted every waiting event
  (`runWaitingTriggers` called `recordTriggerFired` once per `TriggerWaiting`), about 75 events a spell in the Kykar loop
  for 3-4 real triggers, so the 5,000 limit was hit after about 65 spells. It now counts the triggers that really ran
  (`runSingleTriggerInternal`: put on the stack, or a static trigger run). A real infinite loop of triggers still reaches
  the limit, and the 5,000/2,500/1,000 caps and the watchdog are unchanged.
- **Held pass on the top run (harness `PriorityFastForward.topRunIds`):** a held pass covers the run of alike abilities
  on top of the stack and ends when the item under it is on top. Before, the bridge held only when the whole stack was
  the run, so Mentor's prowess triggers above the spell that made them were passed one prompt at a time.
- **After a minute, the result (harness `ManaBrewInteractiveController.heldRunLong`):** once the same run (controller,
  source name, ability text) has been held for `LONG_RUN_SECONDS` (60), the hold is no longer cut every 20: the rest
  of the run resolves and the table sees the result. Every trigger still resolves in Forge, every player still gets
  priority after each one, any question is still asked, and a new object on the stack still stops it. A hold after a
  hold that ended at the 20 keeps the start time; any other answer starts it over.
- **Repeat ×N (bridge `loopStep`) is not skipped on the engine side:** each Kykar loop pass needs the player's own
  answers (cast, pay, order triggers), so there is no run of passes to hold; what it spends besides Forge is snapshots,
  relay hops and the table redraw.

**Measured** (headless, `tools/kykar-loop-bench.js`, harness-test image, `--cpus 2`, HotSpot):

| Case | Prompts a pass | Time a pass | Per prompt: game / snapshot |
|---|---|---|---|
| Kykar loop, 0 tokens | 23 | 1.92 s | 69.6 ms / 21.2 ms (2 builds) |
| Kykar loop, 150 Soldier tokens | 23 | 3.09 s | 114.6 ms / 52.7 ms |
| Mentor + 150 prowess Monks (about 300 triggers a pass), no hold | 324 | 30.6 s | 65.6 ms / 47.6 ms |
| same, held top run (cut every 20) | 38 | 18.1 s | |
| same, engine1130-ff, held top run (run back to back with the line above: 17.7 s) | 39.7 | 18.6 s | |
| same, engine1130-ff, no hold (what the bridge sent here before: the spell under the run blocked the hold) | 324 | 33.4 s | 53.2 s game, 32.8 s snapshots over 2 passes |
| Mentor + 900 Monks (about 1,800 triggers a pass, about 215 ms each), engine1129, held | 117 | 415 s | 385 s game, 30.3 s snapshots |
| same, engine1130-ff, held (the minute rule on) | 54 | 404 s | 387 s game, 16.4 s snapshots |

- So for the bridge, the top-run hold takes the Mentor case from 324 to 40 prompts a pass and from 33.4 s to 18.6 s
  (1.8x) headless. The one-minute rule halves the prompts again on a run longer than a minute (117 to 54 at 900
  tokens; 29 held passes instead of about 90) and halves the snapshot time, but the pass is only 3% faster headless:
  Forge's own resolution of each trigger (about 215 ms with 900 tokens on the board) is 95% of it and is not skipped.
  Live, each prompt saved is also about 4 snapshot builds in the node, a relay hop and a table redraw of the whole
  board, so the live saving is larger than the headless one; it was not measured on the live stack.

- In the 150-token Kykar loop the game thread spends about 38% in Forge (resolve, state effects), about 56% in the
  harness (the mana-payment snapshot, mana abilities, card-map sorting, action listing) and 6% in AI. The node builds
  about 4 snapshots a prompt (each human seat and the observer, on the revision and on the prompt).
- With Mentor, about 69% of what is left after holding is Forge's own resolution (`CardCopyService.getLKICopy`,
  `Card.getTempToughnessBoost`), plus AI 8% and the response probe 4%. That cannot be skipped and stay rules-correct.

### 4.6 Trigger batching (engine, engine1131-batch, 2026-11-25, not deployed)

A held run of identical simple triggers (Mentor's 600 prowess triggers) used to resolve one by one with a catch-up every
20. The merge (4.4) now takes more effects and is no longer stopped at 20 by the merge itself, so a held run resolves in
one engine step as far as the hold reaches, and the log says "N × <card> resolved at once: <ability>".

- **Still only while held:** the gate (`heldByEveryone`) is asked again after every merged item, so the batch ends
  exactly where the held pass would: at the 20 before a run has been held a minute, at the end of the run after it,
  and at once when a player gains a new possible response (the response probe runs per item). Any AI or Manabot seat
  turns it off. A new object on the stack (a waiting or simultaneous trigger) ends it.
- **Effects allowed** (untargeted, no sub-ability, not optional, no intervening "if" or resolving check, only the listed
  parameters, same controller and the same ability text as the item above):

| Effect | Not batched when |
|---|---|
| GainLife, a fixed number, you | a LifeGained trigger, a GainLife replacement |
| Pump Self by fixed +N/+N (prowess) | nothing extra (no trigger reads a pump) |
| PutCounter P1P1 on Self, a fixed number | the source has a -1/-1 counter (they annihilate as an SBA); a counter-added/removed trigger; an AddCounter/RemoveCounter replacement (Doubling Season, Hardened Scales) |
| Token, a fixed number, you, a plain token | a ChangesZone trigger other than a card's own "when this enters", TokenCreated triggers; CreateToken or Moved replacements (Anointed Procession, Doubling Season); a plain token is one script, not legendary/world/planeswalker, toughness 1 or more, no triggers, statics or replacements, keywords only from a short list (flying, prowess, haste, ...) |
| Mana, fixed colours and amount | a ManaAdded trigger, a ProduceMana replacement |

- For every effect: no AbilityResolves or Always trigger anywhere, and no continuous static that grants something on a
  condition or to cards picked by power, toughness, counters or life (those would change between items). Statics and
  replacements count only where they work (`zonesCheck`: a Doubling Season in a library does not stop a batch; the
  first build counted every card in the game and so never batched a real deck).
- **Counts:** every trigger is still counted when it fires and every token when it is made, so the runaway caps see a
  batch the same as one by one.
- **Not proved, guarded instead:** static abilities are not re-applied between batched items. The guard is the static
  check above, a list of words in `Affected` and the condition parameters; a static that changes on a batched effect in
  a way those words miss would see the board only at the end. Targeted triggers are not batched at all.

**Measured** (`tools/kykar-loop-bench.js --opponent person --held --token w_1_1_monk_prowess --cards "Monastery
Mentor"`, headless, both people holding, another job running alongside each run):

| Case | engine1130-ff | engine1131-batch |
|---|---|---|
| 150 Monks, a pass (3 passes) | 29.5 s (104 s game, 16.8 s snapshots in all), 72 prompts | 26.1 s (72 s game, 23.7 s snapshots), 72 prompts |
| 900 Monks, one pass | 894 s (863 s game, 30 s snapshots), 67 prompts | 341 s (292 s game, 49 s snapshots), 117 prompts |
| 300 prowess triggers in Forge (`TriggerBatchTest`) | 20.8 s one by one | 0.67 s batched |

The prompts stay: each person is still asked at every 20 before the minute. At 900 there are more of them because
each 20 now resolves quickly, so the run reaches the one-minute rule later; the owner can drop the 20-cut for
batchable runs (section 6, item 3).

### 4.7 The heap in a long turn (engine, engine1132-heap, 2026-11-26, not deployed)

A 40-minute Kykar + Mentor turn on engine1131-batch died of an OutOfMemoryError instead of a draw.

- **The heap is read between the limits:** at every trigger fired, ability resolved and replacement run, at most once
  every 50 ms (`HEAP_READ_MILLIS`). Over 85% after freeing (4.5) the game is a draw with `drawReason` "heap" and nobody
  is asked. Before, the heap was read only when a limit asked, and that turn reached one question in 40 minutes.
- **A card that left no longer keeps the board:** Forge's last-state copies all pointed at a zone copy listing the
  whole board, and a card that left the battlefield or graveyard keeps its copy for the turn, so each departure kept a
  whole board of copies. Old zone copies are now emptied when the next last state is made. Headless, the same loop
  grew 63 MB in 20 passes instead of 146 MB.
- **Still growing:** each spell cast keeps the battlefield as it was cast (Forge reads it for "as you cast" checks), so
  a very long turn of spells on a big board still fills the heap, more slowly; the heap draw is what ends it.


## 5. Tests

- **Engine** (`forge-harness/src/test/java/forge/harness/host/BigTurnsTest.java`, 21 checks): the held pass ends after
  20 resolutions and on a new item; at the trigger limit a yes goes on and a no is a draw; no choice is a draw; the fourth
  limit of a turn is a draw; a new turn asks again; the card limit is asked at the next trigger, and two before that are a
  draw; one huge token effect is asked once; the session asks the active person in plain words, its no is a draw, and an
  AI-only game draws. Merge: 20 at once, with every gain counted; no gate, nothing merged; the gate bounds it; Ajani's
  Pridemate and Boon Reflection each stop it (and get every trigger); another player's run below is not merged; an AI seat
  turns it off; it merges only while both people hold, up to where the first pass ends. Break-its (17 mutations, one
  container): 16 fail named checks. The one that does not: turning off the trigger check in `StackMerge.watched` (even
  together with the waiting-trigger check) still leaves Pridemate unmerged, because its trigger is already pending after
  the first gain and `hasSimultaneousStackEntries` stops the merge. The watcher check is a second guard, not the only one.
  Since then other changes grew the class to 39 checks; 4.5 added 9 (48 in all): only triggers that fire count, an event
  no trigger answers counts nothing, a heap the collector frees does not draw, the heap is freed at most once in 5 s, the
  held pass ends at the item under the run, a long held run is not cut at 20, a run held a minute goes on to the end, a
  catch-up keeps the minute, another answer starts it over. Break-its (7 mutations, copies only, originals checked by
  sha256): each fails named checks.
- **Trigger batching** (4.6, `TriggerBatchTest`, 33 checks): one by one and batched on the same board give the same
  digest (life, counters, mana pool, every card's zone, P/T, counters, keywords, the per-turn trigger and card counts,
  the log) for prowess, self counters, Soldier and Monk tokens, mana, life gain, a source gone mid-run and watchers sitting in a library; boards that
  must not batch say why (a "creature enters" watcher, Anointed Procession, Doubling Season, Hardened Scales, a -1/-1
  counter on the source, an optional trigger, a targeted trigger whose target is gone, a conditional static grant,
  damage, a token with a trigger, an intervening "if", an extra parameter, a shrinking pump); a 300-trigger run
  resolves in one step; the log line; the gate is asked after every item; two people holding batch 20 at a time and a
  run held a minute goes to the end; an AI seat stops it; a response the mana pays for ends it; the caps still count.
  `BigTurnsTest`'s "20 at once" check now expects the whole run. Break-its (18 mutations, copies only, originals checked
  by sha256): see engine-changes.md.
- **Timing** (`BigTurnTimingTest`, prints the tables in section 2; `ARGS=25,50,100,200,400`).
- **Bridge** (`tests/test_bridge_big_turns.js`, 44 checks): held pass, presses, `mtg stop`, the runaway question, the
  table's `mtg stop` and `mtg help`. Break-its: 10 mutations, each failing named checks; for 4.5, the old whole-stack
  rule fails "a run on top of the spell under it: held".
- **Unchanged:** `tests/test_bridge_golden.js` (1076 scenarios), `tests/test_table_golden.js` (6 games), bridge claims
  (1498), table claims (1393), trigger-group tests.

## 6. Open, for the owner to decide

1. **Hold size 20** (`EXHAUST_RESOLUTIONS` in the engine, `HELD_RESOLUTIONS` in the bridge; keep them equal). It sets how
   often the table catches up and how soon `mtg stop` lands. After a run has been held a minute (`LONG_RUN_SECONDS`,
   4.5) there is no catch-up until the run ends, so `mtg stop` lands only then.
2. **3 "Keep going" a turn**, and the active person is the one asked (the first person when the active player is an AI).
3. **Merging and trigger batching are off whenever an AI plays.** In games with AI seats only 4.1 helps. Batching
   also stops at every 20 before a run has been held a minute, because that is where the held pass gives each player
   priority back; batching through those would need the owner to accept that the 20-cut no longer exists. Letting the AI waive priority between
   merged life gains would need a rules call.
4. **The 100-token-per-effect limit** now asks at 101 or more. Stacked doublers make 128 or 256 from one effect.
5. **Second Harvest's quadratic cost inside Forge is not fixed.** 800 tokens is about 24 s in Forge itself. A fix means
   batching Forge's static-ability recheck while one effect makes many tokens, which is a Forge-wide change.
6. Token message compaction (4.2) if real TTS still struggles at thousands of tokens.
