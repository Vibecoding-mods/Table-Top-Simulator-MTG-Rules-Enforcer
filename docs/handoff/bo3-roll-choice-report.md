# Report: best of three, game 1's roll winner chooses play or draw

Cloud session, 2026-11-17, branch `cloud/bo3-roll-choice` from `origin/main` f4f614d. Bridge only. No engine change
(the engine already takes `gameConfig.firstPlayer`, as `FirstPlayerTest` covers), no protocol change, no Lua and no
screen XML. Not tried on the real table or against a live engine. No permission prompt is pending.

## What changed (`bridge/bridge.js`)

Before, game 1's roll winner simply played. The bo3-extras code said why: the roll ran inside `startConfig`, as the
start went out, so a choice there would have held the start.

- **When:** the roll still happens once per game, when the room is ready to start (the start block in
  `onRoomUpdate`).
- **An AI winner** plays at once, said as before ("… White 12. White goes first.").
- **A person winner** is asked on the table's prompt panel, with the match's question and the same `MATCH_PROMPT`
  (as the loser's play or draw after a game):
  - "Game 1: you won the roll (14–7). Play or draw?", with Play / Draw;
  - the text says what each means and that they play if they don't choose within 30 seconds.
- **The start waits** (`matchRollWaits`, `holdStartForRoll`). The start block is now a function, `send`, run at once
  or kept on `game.matchRoll.held`. The answer (`rollChoice`, through `onMatchAnswer`) closes the question, says the
  choice in chat and the log, and runs it: the gameConfig with `firstPlayer`, then StartGame.
- **No answer within `ROLL_CHOICE_SECONDS` (30):** the winner plays, said in chat.
- **What can't start twice:**
  - a late answer;
  - a second answer;
  - another room update while waiting;
  - the clock after an answer;
  - the clock after a reset (it checks the game is still the same one).
- **Words:**
  - chat: "Game 1: a roll for who goes first: Blue 14, White 7. Blue wins the roll and chooses to play or draw.", then
    "Blue chooses to draw: White goes first in game 1.";
  - the log has the same two lines.
  - Before the game starts, the AI is named by its colour (the bridge names it "AI 1" only once the relay starts the
    game).
- **Unchanged:**
  - the table's own first player and Treachery's Leader still come first, with no roll;
  - later games' loser's choice, sideboarding and Concede match;
  - the roll's banner (`matchRoll`, "BLUE WINS THE ROLL (14–7)").
- **Docs:** `docs/game-modes-spec.md` §3.6 has a "Game 1's choice" entry. The old "not the winner chooses" note now
  points to it.

## Tests

- **`node tests/test_bridge_bo3_roll_choice.js`: 24 of 24, in GATES.** Written first: 15 failed before the code.
  - It drives the real start: a ready room, then `onRoomUpdate`, then the question, then the answer, then the
    gameConfig and StartGame the seat sends.
  - A human win: no start while asked; the question's options and title; chat and the log; another room update starting
    and asking nothing.
  - Draw: the AI first, gameConfig before StartGame, said, logged, question closed, a second answer and the clock after
    it doing nothing.
  - Play: Blue first.
  - The clock: Blue plays, said, closed, and a late answer changes nothing.
  - An AI win: it plays at once, with no question.
  - The table's first player: no roll and no question.
  - Best of one: nothing.
  - A reset while waiting: the clock starts nothing.
- **`test_bridge_bo3_extras`: 49 of 49.**
  - Its first block pinned the old rule (the human roll winner going first at once, by calling `startConfig`
    directly). It now goes through the real start and answers Play. The same checks (both numbers in chat and the log,
    one roll per game, the banner, "GAME 1 OF 3") follow the new wording.
  - The rest of the file is unchanged: the AI-wins and tie cases keep their words.
- **`tools/mutate-bo3-extras.js`:** its two roll mutations now name the renamed check and the new `winner` line. The
  roll's 8 are caught.
- **Break-it: `node tools/mutate-bo3-roll-choice.js`: 13 of 13 caught by name**, every file restored by sha256. The
  mutations:
  - the start not held;
  - a person's win taken as the AI's;
  - the AI asked;
  - draw making the winner go first;
  - the held start never sent;
  - no clock;
  - the answer ignored;
  - play and draw swapped;
  - the question left open;
  - the choice unsaid, or not logged;
  - the table's first player ignored;
  - the roll unsaid.
- **Also passing:** `test_bridge_match_bo3` 28, `test_table_bo3_extras_lua` 9, `test_bridge_treachery_first` 28.
- **Regression:** the GATES against `origin/main` f4f614d, both trees run here. The only differences are the new
  gate (`test_bridge_bo3_roll_choice`, 24 of 24) and the trees' paths in two error lines. 58 gates pass on both;
  the other 39 fail or SKIP the same on both, below.

## Gates not run here

39 gates build from the Workshop table save (2296042369), which isn't in the cloud session. They fail at
`make-engine-copy.js` with ENOENT (or SKIP), identically on `origin/main` and this branch:

- `test_table_golden`, `test_ui_budget`, `test_table_profile`, `test_table_six` (SKIP) and `test_table_golden_six` (SKIP);
- `test_table_claims`, `test_table_check` and the other `test_table_*` gates;
- `test_alignment`, `test_engine_json`, `test_editor_forward`, `test_moonsharp_loop_locals`, `test_rejoin_prompt` and
  `test_bridge_big_turns`;
- `test_card_other_side` (line 389), which fails the same on both trees.

None of them touches this change: there is no Lua, and the question uses the existing panel. Run them where the save is.

## For the real table

- The question shows on the roll winner's panel before game 1 starts, and Play / Draw starts the game with the right
  first player.
- With no answer, the game starts after 30 seconds with the winner first.
