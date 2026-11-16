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
  chance to stop.
- **Bridge (`heldPass`):** when the bridge passes a priority by itself and the **whole** stack is one run of at least
  `HELD_MIN` (5) of the same untargeted ability (`stackRun`), it sends `{ type: "pass", exhaustStack: true }`. That covers
  Arena-style passing, End turn, Resolve all, Resolve N×, auto-resolve and `mtg skip`. A plain "Resolve" press is still one
  pass. The opponent's half is held too: Yellow's prompts were the other half of the live cost. Nothing else changes:
  every trigger still resolves on its own in Forge, and any question (a "may", a target, an order) is still asked.
  "Resolve all" counts the triggers a held pass resolved (`heldResolved`), so its cap and "Resolve N×" stay right.
- **One chat line** for a run longer than 20: "75 Scute Swarm triggers resolve back to back; the table catches up every
  20. Type "mtg stop" to stop at the next one."
- **`mtg stop`** (chat; `stopchain` to the bridge): the seat's next priority with something on the stack is asked,
  whatever would have passed it. "Resolve all" and a "×N" yes/no run end at once. Because of the held pass it takes effect
  within 20 triggers.
- **Not held:** a stack with anything else on it (a spell, another trigger, a targeted ability), runs of fewer than 5
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

After a stack item resolves, up to 19 more alike items below it resolve at once. Each goes through the usual
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

**Left out on purpose:**

- **Token creation** (the Scute Swarm case): a batch of tokens is one "one or more" event, and copies of a token differ by
  source. Merging changes what triggers and how often.
- **Life loss:** players can leave the game between items.
- **Damage:** each item has its own source, and lifelink, infect and damage watchers see each one.
- **Counters:** Hardened Scales-style replacements apply per event.
- **Drawing:** Alms Collector-style "two or more" replacements; an empty library is a state-based action.

So the merge does not touch the landfall case; 4.1 does. Merging is for Soul Warden swarms, where each trigger was a full
priority round.

## 5. Tests

- **Engine** (`forge-harness/src/test/java/forge/harness/host/BigTurnsTest.java`, 21 checks): the held pass ends after
  20 resolutions and on a new item; at the trigger limit a yes goes on and a no is a draw; no choice is a draw; the fourth
  limit of a turn is a draw; a new turn asks again; the card limit is asked at the next trigger, and two before that are a
  draw; one huge token effect is asked once; the session asks the active person in plain words, its no is a draw, and an
  AI-only game draws. Merge: 20 at once, with every gain counted; no gate, nothing merged; the gate bounds it; Ajani's
  Pridemate and Boon Reflection each stop it (and get every trigger); another effect below ends it; an AI seat turns it
  off; it merges only while both people hold, up to where the first pass ends. Break-its: one mutation per rule, each failing named checks
  (see the commit).
- **Timing** (`BigTurnTimingTest`, prints the tables in section 2; `ARGS=25,50,100,200,400`).
- **Bridge** (`tests/test_bridge_big_turns.js`, 36 checks): held pass, presses, `mtg stop`, the runaway question, the
  table's `mtg stop` and `mtg help`. Break-its: 10 mutations, each failing named checks.
- **Unchanged:** `tests/test_bridge_golden.js` (1076 scenarios), `tests/test_table_golden.js` (6 games), bridge claims
  (1498), table claims (1393), trigger-group tests.

## 6. Open, for the owner to decide

1. **Hold size 20** (`EXHAUST_RESOLUTIONS` in the engine, `HELD_RESOLUTIONS` in the bridge; keep them equal). It sets how
   often the table catches up and how soon `mtg stop` lands.
2. **3 "Keep going" a turn**, and the active person is the one asked (the first person when the active player is an AI).
3. **Merging is off whenever an AI plays.** In games with AI seats only 4.1 helps. Letting the AI waive priority between
   merged life gains would need a rules call.
4. **The 100-token-per-effect limit** now asks at 101 or more. Stacked doublers make 128 or 256 from one effect.
5. **Second Harvest's quadratic cost inside Forge is not fixed.** 800 tokens is about 24 s in Forge itself. A fix means
   batching Forge's static-ability recheck while one effect makes many tokens, which is a Forge-wide change.
6. Token message compaction (4.2) if real TTS still struggles at thousands of tokens.
