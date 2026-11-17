# Report: M6 headless six-seat games and the six-seat golden

Cloud session, 2026-11-17, branch `cloud/m6-headless` from `origin/main` f63de76. No engine change and no new screen
XML. The real six-seat table in TTS was not touched or tried. No permission prompt is pending. The details are in
`docs/m6-six-seat-spec.md` §6.3.1, and steps 14 and 15 are updated.

## 1. Headless six-seat games

- **How:** `bridge/engine-test.js --seats 6` needs the relay and node images. This session has no Docker daemon, and the
  node needs its GraalVM native build. So the harness equivalent:
  - `tools/headless-six.js <engine tree>` plays through `ManaBrewEngineAdapter`, the node's own engine entry. A small
    stdin wrapper, `engine/checks/HeadlessGameServer.java`, sits beside the other headless checks there.
  - Each game has White as the host (engine-test.js's answers, with a seeded random choice) and five Forge AI seats. It is Commander at 40
    life, with the built-in decks Neheb, Ashling, Ramses, Teval, Hearthhull and Ironsmith.
- **Checked each game:**
  - engine errors;
  - stuck priority: no new state and no question for 120 s, reported with the turn, step and priority seat;
  - seat order: each turn's active seat must be the next seat after the previous turn's. Players out are skipped and
    an extra turn is allowed.
- **Results on main's engine:**

  | Run | End | Problems |
  |---|---|---|
  | 2 games, to turn 15 (the ask) | stopped at turn 16; the order went round the six seats | none |
  | 2 games, to the end | Purple won on turn 45; Green won on turn 56. The order skipped the players out | none |
  | a third game to the end (seed 11 again) | Green won on turn 51: a different game from the first seed-11 run, because the AI works to time limits, so a seed doesn't fix the game | none |

- **Driver details found and fixed:** the harness's state revision stays 0 without snapshot recording, so the view is
  read at each question and every half second. The host also kept a hand with no lands, so it now mulligans a hand of
  fewer than 2 or more than 5 lands, twice at most.

## 2. Bugs found and fixed (test first)

- **`bridge/engine-test.js` with `--seats 6`:** its end-of-game report coloured the seats from the four-seat list. The
  fourth seat was called Blue (it is Green on the six-seat table) and the last two were "seat4" and "seat5".
  - Fix: `teams.seatColorsFor(n)` gives the four-seat table's colours up to four seats and the six-seat table's from
    five.
  - Its four checks in `test_bridge_six_golden` failed first.
- **The bridge on six seats** showed no bug. It got:
  - the table's hello with six seats, and White's start with 5 AI;
  - a seat order of White → AI 1 … AI 5;
  - the colours White, Red, Yellow, Green, Blue, Purple, clockwise;
  - five AI decks: the four built-in ones, cycled as spec §5 says.

  It logged no errors. In the 45-turn game, every card's controller had a six-seat colour (25,003 cards in 963 boards).
  Commander damage was keyed by colour. The last board said game over, with Purple the winner. The bridge's end words
  weren't seen: they go with the game-over question, which the node sends and the harness doesn't publish. The driver
  now keeps the final board when the engine says the game is over.
- **The harness on six seats:** no bug found.

## 3. The six-seat golden

- **`tools/m6-stream.js`** plays a recorded game through a sandboxed bridge, as the six-seat table's game, and writes:
  - `tests/golden/fixtures/six-seat-relay.json` (504 KB): the relay's side for turns 1–15, with the states packed as
    changes and White's questions;
  - `tests/golden/fixtures/table-stream-6p.json` (395 KB): what the bridge sends the table, 334 messages (166 boards, 73
    questions, the log, chat).
- **`node tests/test_bridge_six_golden.js`: 18 of 18, in GATES.** Under a second.
  - The stream message by message. A failure names the message's index and type, and shows where the two differ.
  - The six-seat facts:
    - the seat order, the colours and the AI names;
    - every player, card controller and active seat at a six-seat colour;
    - the six players on the first board;
    - the turns going round the six in order, for turns 1 to 15;
    - the log naming AI 1 to AI 5;
    - no bridge error.
  - engine-test.js's colours.
  - `--record` re-records the stream after a deliberate bridge change.
  - Like other bridge tests, it reads the built-in decks under `manabrew/`.
- **Break-it: `node tools/mutate-six-golden.js`: 10 of 10 caught by name.** Every file is restored by sha256. The
  mutations:
  - the four colours for six seats;
  - all six colours for five seats;
  - engine-test's old list;
  - the six table seats not taken;
  - at most four seats;
  - free colours taken from the end;
  - every AI named AI 1;
  - a controller or the active seat by name instead of colour;
  - the step left out of the table message.
- **The table's golden, `tests/test_table_golden_six.js`: written, not run.**
  - It builds the six-seat Workshop table in engine mode, as `test_table_six.js` does (profile, and the 4-player file as
    the tracker source).
  - It replays the stream on the fake TTS, with White starting `mtg start ai 5 builtin`. It fails on a script error, a
    refused put, or a step that differs from `tests/golden/table_golden_6p.json`.
  - The Workshop tables aren't in this repository or this session, so here it says SKIP.
  - **Not in GATES yet.** Its golden has to be recorded first (`--record`, after reading what it draws) on a machine
    that has the tables. Until then it would fail there with "no recording yet". That makes the renderer's six-seat
    path pinned only once it is recorded.

## Regression

- The GATES against `origin/main`, both trees run here: the same result for every gate. The new
  `test_bridge_six_golden` passes. The gates that need the Workshop save fail to build on both trees.
- **Lua:** no Lua was changed.
- **UI:** no XML was changed, so `test_ui_budget` is not affected. It can't run here.

## Next

1. Record `tests/golden/table_golden_6p.json` with the Workshop tables, then add `test_table_golden_six` to GATES.
2. Run step 15's real-TTS game, host + 5 AI on the six-seat engine save, once the user allows the new save.
3. Run `engine-test.js --seats 6 --turns 12` twice on the rebuilt relay, which still waits for the image.
