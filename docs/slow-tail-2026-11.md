# Slow tail: offline investigation (2026-11-11)

Question (PLAN.md "Open questions": "Slow tail in the engine: p95 ~90 ms"; "Investigations: the engine's p95 slow
tail"): where does the time go between a player's click and the next question on the table, especially in the slow
5%? Earlier work: `tmp/slow-tail/logs.md` and `tmp/slow-tail/measure.md` (2026-11-05, main checkout, not in git).

This round is offline only: recorded logs, the bridge on the golden harness, and the table's Lua on the fake TTS. No
connection to the live table, bridge, relay or engine (a game was being played while it ran). Scripts are in
`tmp/slow-tail/` of the worktree (not project files): `livelog.js`, `stream.js`, `bench-bridge.js`, `prof-top.js`,
`bench-table.js`, `bench-instr.js`, `golden-reorder-check.js`, `mutate-bridge.js`.

**Offline wall times are not trustworthy this round.** The PC (6 logical CPUs) was at 100% for hours: a live game plus
up to 11 agents running test suites. A queued re-run of the benchmarks late on 2026-11-11 (through the shared 2-slot
queue `tmp/slot.js`) still gave the bridge p50 160 ms per board (10.1 ms in the earlier run below) and the sim's
board handler p50 72-326 ms depending on the minute. Treat the wall times in sections 3 and 4 as one sample of a
busy PC. Only the shares inside one run and the instruction counts are load-proof. The live log numbers (sections 1
and 2) come from real games and are not affected.

Words: p50 is the typical value, p95 means 95% of samples were faster. A "trip" is one engine question and its answer.
A "reply" is a player's answer or gesture until the next question shown to that player.

## Verdict

1. **In live play the tail is engine time, multiplied by the number of trips per reply.** 84% of a reply's wall time
   is the engine's own clock (`engineMs`, which includes the Forge AI deciding before our next question). The slowest
   5% of replies average 7.2 trips against 3.0 for all replies, and 78% of them have more than one trip: the bridge
   passes each priority stop it doesn't show (Arena-style stops, End turn, auto-resolve, skip) one round trip at a
   time. Sure: high (5,889 replies, 18,412 engine questions).
2. **The engine's own time per question is 6-7 times the October test's.** Live p50 95 ms and p95 1,197 ms per engine
   question (2026-11-05 to 11-11) against p50 14 ms and p95 83 ms in test 2c (2026-10-17, no AI, 6 cores, quiet PC).
   Even paying mana (no AI decision in between, mostly) is p50 90 ms, p95 580 ms. Most of the difference is
   the Forge AI's time inside `engineMs` and the 2-core WSL limit on a busy PC (measure.md); restore points
   (2026-11-02) are a candidate that cannot be split out from the logs. Sure: medium.
3. **TTS taking messages one at a time adds a second, smaller tail after the bridge.** Per message TTS needs about 15
   ms (a log line) to 53-120 ms (a board), and a question that was queued behind earlier messages waited for them.
   Fixed cheaply: a question now goes ahead of waiting boards, log lines and rules texts (below).
4. **The bridge's own work is small.** About 10 ms per board on a 4-player board with 120 permanents (p95 20 ms), so
   ~10% of a 95 ms trip. Not worth changing now.
5. **The table's Lua asked TTS for the whole hand once per hand card per board.** Fixed (one list per hand per board).
   Its real-TTS effect is unknown: the fake TTS's version of that call is far slower than TTS's own.

## Numbers

### 1. Live bridge log (the engine's own time, the trips)

`tmp/bridge-live.log` (MTG_TRACE), every bridge run since the bridge logs `engineMs` per question (2026-11-05 night)
to 2026-11-11 22:00. The log's clock has 0.1 s steps, so reply times are only good to about 100 ms.

| Engine question type | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| all | 18,412 | 95 ms | 1,197 ms | 3,748 ms | 44 s |
| chooseAction (priority) | 13,963 | 96 | 1,397 | 4,213 | 44 s |
| payManaCost | 2,077 | 90 | 580 | 1,766 | 5.0 s |
| chooseBoardTargets | 554 | 102 | 1,684 | 3,145 | 4.5 s |
| chooseBoolean | 372 | 129 | 823 | 1,443 | 3.0 s |
| chooseAttackers | 255 | 60 | 393 | 1,343 | 2.1 s |

Replies under 60 s (longer ones are holds or an idle bridge): n 5,889, p50 300 ms, p95 3.7 s, p99 11.3 s.

| Trips in the reply | Share | Reply p50 | p95 | Engine time in it, p50 / p95 |
|---|---|---|---|---|
| 1 | 51.4% | 100 ms | 1.5 s | 112 / 1,302 ms |
| 2 | 14.5% | 300 ms | 3.7 s | 237 / 3,452 ms |
| 3 | 10.2% | 400 ms | 5.2 s | 318 / 4,020 ms |
| 4 | 7.3% | 500 ms | 4.6 s | 401 / 3,920 ms |
| 5 | 4.0% | 700 ms | 10.1 s | 503 / 7,991 ms |
| 6 or more | 12.7% | 1.2 s | 19.8 s | 929 / 9,352 ms |

- Engine questions the bridge answered itself inside multi-trip replies: chooseAction 10,154, payManaCost 1,428 (the
  auto-pay), others under 150 each.
- Wall time minus engine time: one-trip replies p50 36 ms, p95 158 ms (relay both ways, the bridge, the 0.1 s steps);
  multi-trip p50 120 ms, so roughly 40 ms per extra trip on top of the engine.

### 2. The TTS send queue (the recorded stream)

`tmp/tts-stream.jsonl` (MTG_RECORD), 42,716 messages from 2026-11-06 to 2026-11-11. The bridge opens one connection
per message and starts the next only when TTS closes the last (`pump`), so a gap between two messages the bridge
queued in the same tick is TTS's time for the first. `sendTable` queues the log lines, then the board, then a rules
text batch in one tick:

| Pair (same tick) | n | p10 | p50 | p95 |
|---|---|---|---|---|
| gamelog -> table (a log line) | 5,628 | 12 ms | 15 ms | 43 ms |
| table under 3 KB -> texts (a board) | 1,707 | 33 | 53 | 107 |
| table 3-8 KB -> texts | 384 | 54 | 76 | 174 |

- 12 ms is the floor: TTS takes at most one external message per frame.
- Gaps after a prompt close (`promptId: null`, ~45 bytes) read 104-151 ms, but that is the engine answering, not TTS:
  the next message only exists once the engine replies. On the fake TTS the close costs 6 ms of Lua.
- A question's time behind earlier messages of its burst (gaps under 250 ms): p50 143 ms, p95 832 ms, with p50 2 and
  p95 10 messages ahead. This is an upper bound (it includes engine gaps inside the burst). Ahead of the 6,200
  questions: 8,930 small boards, 4,071 closes, 3,280 log lines, 980 rules-text batches, 790 chat lines.

### 3. The bridge's own work (offline benchmark)

`bench-bridge.js`: the bridge on `tests/bridge-harness.js` (no network, virtual timers, wall time by `process.hrtime`),
the dump2 board grown to 4 players with 30 permanents, 7 hand cards and 20 graveyard cards each (181 KB of engine
JSON), 200 boards each with a small change (a tap, a life total, every 5th a card moved), each followed by a
priority question.

| Step | p50 | p95 | max |
|---|---|---|---|
| a board arrives (`onEnvelope`: kept, rewind check, `noteBoard`) | 0.08 ms | 0.27 ms | 0.9 ms |
| a priority question (`onPrompt`) | 0.23 | 0.93 | 5 |
| the timers after it (`sendTable` 40 ms later, the log) | 10.1 | 19.6 | 215 (first board) |

CPU profile of the run (`node --cpu-prof`, bridge functions, inclusive): `sendTable` 2,441 ms over 220 boards
(11 ms each). Inside it `updateLog` 1,192 ms (`logEvents` 655, `logSnapshot` 243), `slim` 574 (its
`JSON.stringify` of every card's details for the sent-once check), `tableCard` 375, `tributeCard` 150. Nothing
quadratic; a 4-player late game costs ~10 ms of bridge per board, about 10% of one trip.

### 4. The table's Lua (fake TTS)

`bench-table.js`: the recorded 4-player stream (`tests/golden/fixtures/table-stream-4p.json`, 304 messages) through the
table's Global (a save built from the sources) on fengari + `tests/lua/tts-sim.lua`. fengari is not MoonSharp and the
sim's world calls are not TTS's, so only the shares inside one run mean anything.

- Before: a board's handler p50 183 ms (723 ms under the profiler's hook). 85.5% of it (inclusive) was `isInHand`:
  `place` asked `Player[color].getHandObjects()` for every hand card, so a hand of n cards cost n lists of n.
- After the fix: the 159 board handlers run 23.6 million Lua instructions instead of 86.6 million (3.7 times fewer,
  counted by the profiler's count hook, `tmp/slow-tail/bench-instr.js`), and `isInHand` is 48% of that (one list per
  hand per board; the rest is the sim's own slow zone test inside that one call). Wall time could not confirm it: the
  PC was running a live game, and three back-to-back runs (after, before, after) gave board p50 444 / 246 / 481 ms,
  so the order flipped with the load; a queued re-run gave 180 / 326 / 72 ms. The instruction count does not depend on the load. In real TTS
  `getHandObjects` is C#, not Lua, so how much of this carries over needs the live check below.
- The other big items in a board's handler: `layoutRow` 12%, `engineSetupIntact` 7%, `seatGeometry` 5%.
- Log lines, rules texts, chat and closes cost the sim 0.4-6 ms each; a question 11 ms (p50).

## Fixes made (worktree commit, nothing deployed)

1. **A question goes ahead of waiting boards, log lines and rules texts** (`toTTS`, `QUESTION_PASSES`). It never passes
   another prompt (so a close and the next question keep their order), a chat line, a refusal, a clear or a start.
   Why it is safe: a question already reaches TTS before its own board (`scheduleTable` waits 40 ms), and a newer board
   that replaces a waiting one already lands after the question; the table handles a question before the board.
   Expected effect: a question waits for at most the one message TTS is taking, not for the whole line (live p95 of up
   to 832 ms behind 10 messages). Bridge golden: 8 of 1,061 cases changed, each only a close moved ahead of a log line
   (the friendly-mulligan lines), checked by `golden-reorder-check.js` (every other effect identical, prompts keep
   their own order and pass only boards, log lines and texts). New claims checks: the order rule on a crafted line
   of 13 messages, and that a newer board still replaces the waiting one behind the question.
2. **The table asks for each hand once per board** (`isInHand(o, color, index, seen)`, the cache keyed by the board's
   `seen` table in the global `engineHandCache`, so it can never outlive the board it was made for). A board places each
   card once, so no card's hand changes before it is asked about. No new main-chunk local. Table golden: unchanged.
3. **Measurement for the live questions** (no change in what the game does):
   - GET /stats (the debug channel) gains `wait` (per message kind, how long it waited in the outbox for TTS; the
     close apart from questions), `engine` (per engine question type, `engineMs`) and `trips` (engine questions per
     question shown after a player's answer or gesture). Each is `{ n, sum, max, hist }`, `hist` counting samples
     under 16, 50, 100, 250, 500, 1000, 3000 ms and over.
   - The MTG_RECORD stream's lines gain `q`: the ms that message waited in the outbox. With it a recording tells TTS's
     take time from the engine's reply time exactly (the pair method above needs same-tick pairs).
   - Claims checks for all three; 11 mutants of the bridge changes, 11 caught.

Not changed, on purpose:
- The trips themselves. The cure is the engine passing to the next stop by itself (Forge's own "pass until", already
  noted in PLAN.md under the first friends game): a harness and image change, not cheap, and not testable offline.
- `slim`'s sent-once check (one `JSON.stringify` per card per board, ~2.6 ms of a 4-player board): a shorter key would
  save 1-2 ms per board, not worth a change to the send-once rule.
- `scheduleTable`'s 40 ms: it is a floor on when the board follows a question, not a tail, and it merges bursts of
  patches that would each cost TTS 50-120 ms.

## Needs a live measurement

1. **The question-first order on the real table.** After a bridge restart between games (by the lead): a game against
   the AI with End turn and a few spells; watch that questions, boards and the log still agree (a target question's
   cards glow, the corner shows the right buttons). Then GET /stats: `wait.prompt` p95 should sit near one board's
   take time (under ~150 ms), against up to 832 ms behind a burst before.
2. **What the hand fix buys in real TTS.** `getHandObjects` in MoonSharp costs an unknown amount per call. With the
   table deployed, PresentMon (or the table's own check timing) on a 4-human game with full hands, compared with a
   game on today's table; or one `tts-exec` timing of `Player.Blue.getHandObjects()` x 100 (but `tts-exec` itself costs
   360 ms, see the TTS perf notes, so time inside the Lua).
3. **Where the engine's 95 ms goes.** GET /stats `engine` splits it by question type in any future game; to split AI
   time from the engine's, play a game against the harmless AI (lands only) and compare `engine.payManaCost` and
   `engine.chooseAction` with a Forge AI game. Restore points: a game with rewind off (if the harness allows it) or
   the node's checkpoint metric pushed to a local metrics sink, as measure.md did.
4. **Trips per reply.** GET /stats `trips` gives the distribution per game directly; it is the number a "pass until"
   engine change would cut.
5. **The quiet-PC re-measure** from measure.md (TTS closed, the duplicate BTC Alert loggers stopped, then 3 and 6 WSL
   cores) is still open: PLAN.md "Slow-tail re-measure on a quiet PC". Run `bench-bridge.js` and
   `bench-before-after.js` again then too: this round's offline wall times came from a PC at 100% (see the top).
