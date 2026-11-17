# Report: Treachery's Leader goes first, and best of three for Standard

Cloud session, 2026-11-17, branch `cloud/treachery-bo3` from `origin/main` f63de76. Bridge and table only; no engine
change. Not tried on the real table or against a live engine. No permission prompt is pending.

## 1. Treachery: the Leader goes first

The engine already takes `gameConfig.firstPlayer`, a seat index (`docs/handoff/first-player-report.md`). The bridge
never sent it, and PLAN.md M4.6 still said it wasn't possible.

- **The table (`engine-renderer.lua` `engineTreacheryLeader`).**
  - Treachery identity cards carry their role in their TTS name, even face down ("Identity — Leader",
    `table-review/notes-variants.md`). So the start message now says who holds the Leader's card: `treachery: { leader:
    <colour> }`.
  - The holder is the seat whose hand holds the card, else the seat whose playmat lies nearest it (its command zone).
  - `{}` when there are identity cards but none is the Leader's; absent with no identity cards (no Treachery game).
  - Names only, plain finds; the cards are never touched.
  - Called from `make-engine-copy.js` `engineStartGame`.
- **The bridge (`noteFirstPlayer`, `firstColorOf`, `startConfig`).** The first player, in this order:
  1. the table's own choice, the start's `firstPlayer` (a colour);
  2. Treachery's Leader;
  3. best of three's choice (below).
  - The colour's seat in the StartGame order goes out as `gameConfig.firstPlayer`.
  - Outside a team game that is a `gameConfig` of `firstPlayer` alone (`players: []`; the node's fields all default).
  - In a team game it is added to the team mode's `gameConfig` unless that already names a first player (`goesFirst`:
    the Juggernaut, the archenemy). The engine would refuse the two disagreeing.
  - Said in chat: "Treachery: Yellow is the Leader and goes first.", or that no Leader's card was found.
- **`mtg treachery` (host).**
  - `on` (the default) takes the Leader from the table's cards.
  - `off` leaves the first player to the engine's roll.
  - `leader <colour>` names the Leader.
  - `mtg treachery` alone says the setting.
- **PLAN.md M4.6** is updated: the Leader goes first; unveil costs and identity powers stay honour-system.

## 2. Best of three (Standard 1v1, `docs/game-modes-spec.md` §3.6)

- **Turning it on:** `mtg match bo3` / `mtg match bo1` (host). It is refused unless the game mode is Standard. A match
  game is a Standard game of exactly two seats; any other game is a plain single game.
- **The match** lives in the bridge between engine games: the two seats' colours, the wins per seat, the games played.
  A game of another pair of seats starts a new match.
- **After each game** (the engine's game-over question, once a game):
  - **The result and score:** in the log, "AI 1 wins game 1 (Blue conceded. AI 1 wins). Match: AI 1 1–0 Blue.", and in
    chat. A draw: "Game 3 is a draw." It counts for neither.
  - **2 wins:** "MATCH WON: Blue wins the match 2–1.", and the next game starts a new match.
  - **After 5 games:** the score decides ("The match ends after 5 games: Blue wins the match 1–0.", or drawn).
  - **Otherwise the loser chooses play or draw.** A question on the table's own prompt panel, "Game 2: play or draw?"
    with Play / Draw. It is answered under `__match`, as the Repeat ×N panel's Stop is: no new UI.
    - An AI loser plays. After a draw the last chooser chooses again.
    - "Blue chooses to draw: AI 1 goes first in game 2. Press New game when you're ready."
    - The choice goes with the next start as `gameConfig.firstPlayer` (`matchFirst`).
- **The status:** each player's existing mark boxes under the life total read MATCH 1–0 (their wins, then the other's)
  and GAME 2. No new UI element.
- **The next game** is started with the table's own New game button, as any game.
- **Not built (the spec's §3.6, later):**
  - sideboarding between games;
  - "Concede match";
  - game 1's random pick and the winner's choice: game 1 keeps the engine's own roll;
  - "Game 2 of 3" in the phase bar: the marks say GAME 2.

## UI and Lua

- **No new XML.** The question uses the existing prompt panel and the score uses the existing mark boxes, so
  `test_ui_budget` is not made worse. It can't run here: it needs the save.
- **Lua rules:**
  - main-chunk locals: 91, unchanged;
  - the new renderer functions declare no `local` in a for-in loop body (per-card work in `engineIdentityNote`);
  - plain finds only;
  - no new buttons.
- **The chat** (`make-engine-copy.js`): `mtg treachery` and `mtg match` reach the bridge, host only to change them,
  with help lines. Both chat functions parse (luaparse).

## Tests (written first, run red, then the code)

- **`node tests/test_bridge_treachery_first.js`: 23 of 23** (first run: 12 failed, before the code).
  - Bridge checks:
    - the full start → RoomUpdate → `gameConfig` → StartGame path: the Leader's seat as `firstPlayer`, no team rules,
      the chat;
    - no Treachery, no `gameConfig`;
    - no Leader found, said;
    - the table's own first player wins;
    - `mtg treachery off`, `on`, `leader red`;
    - a Juggernaut game keeps `goesFirst` with no `firstPlayer`;
    - the chat setting and its usage line.
  - Table checks (the Leader search on fengari):
    - no identity cards;
    - nearest mat;
    - in a hand;
    - identity cards with no Leader's;
    - "Pack Leader" isn't an identity card;
    - the start message and the chat carry it.
- **`node tests/test_bridge_match_bo3.js`: 28 of 28** (first run: failed, before the code).
  - Setting checks: Commander refused, Standard on, `mtg match` says it.
  - Game checks:
    - game 1's log and chat lines and the loser's Play/Draw question;
    - the marks;
    - Draw making the other seat first;
    - the question closing;
    - a second answer ignored;
    - `firstPlayer` for game 2;
    - game 2's 1–1;
    - an AI loser playing;
    - a draw counting for neither, and its chooser;
    - MATCH WON at 2–1, no question after it, and the next game being game 1 of a new match;
    - five games decided by the score.
  - Not a match game: best of one, Commander, three players, another pair (a new match), `mtg match bo1`.
- **Both tests are in `tools/deploy.js` GATES.**
- **Break-it: `node tools/mutate-treachery-bo3.js`: 30 of 30 caught by name**, every file restored by sha256.
  - Treachery: 14 mutations (the Leader not read, the order, off, the host's Leader, goesFirst overruled, no config
    without teams, the wrong seat, no word, a hand not looked in, the farthest mat, any card named Leader, any identity
    card the Leader's, the start, the chat).
  - Match: 16 mutations (Standard only, the winner choosing, play and draw swapped, an AI asked, three wins, the draw's
    chooser, no end after five, the choice not sent, no status score, the game number, a second answer, another pair,
    any seat count, the question left open, the log line, the chat).
- **Regression:** the 75 GATES against `origin/main` f63de76, both trees run here: the same result for every one (the gates that need the Workshop save fail to build on both), and the two new tests pass.

## For the real table

1. **Identity card names:** their real TTS names should be checked to contain "Identity" and "Leader" as
   `table-review/notes-variants.md` says, and to be dealt within reach of each seat's mat.
2. **Play/Draw question:** check that it shows after the game-over board and is answered from the panel.
