# Report: best of three's extras for Standard

Cloud session, 2026-11-17, branch `cloud/bo3-extras`, from `origin/cloud/treachery-bo3` (0ae6d1e).

- Bridge and table only: no engine change, and no new screen XML.
- Everything uses the existing prompt panel, banner and phase bar.
- Not tried on the real table or against a live engine.
- Spec: `docs/game-modes-spec.md` §3.6, now with a "Built" note.

## The four extras

**1. Game 1's first player, by a roll** (`matchRollFirst`).

- **The roll:** two d20, the human seats first, again on a tie, once a game. The winner goes first, sent as
  `gameConfig.firstPlayer`.
- **Where it shows:**
  - chat: "Game 1: a roll for who goes first: Blue 14, AI 1 7. Blue goes first.";
  - the log: "Roll for game 1: ...";
  - the table: the board's `matchRoll`, shown once on every seat's banner as "BLUE WINS THE ROLL (14–7)"
    (`engineMatchRollBanner`, the planar die's banner; a rewind or reload only records it).
- **When it doesn't apply:**
  - The table's own first player, and Treachery's Leader, still win over it.
  - Later games keep the loser's play-or-draw choice.
- **Different from the spec:** it says the roll's winner chooses. Here the winner simply plays, so the start isn't held
  for a question.

**2. "GAME 2 OF 3" in the phase bar** (`matchGameWords`, the board's `match`; the renderer's `engineMatchTag`).

- It sits after DAY or NIGHT.
- Once draws make the match longer it reads "GAME 4 OF 5".
- Outside a match there is nothing.

**3. Sideboarding between games** (`matchDeck`, `askSideboard`, `onSideboardAnswer`, `matchWaiting`).

- **Whose sideboard:** the deck's own 15, from a preset file or a pasted deck list. A deck read from the table has
  none (the Card Importer puts the sideboard in the Notebook), so that player isn't asked.
- **Who is asked:** after each game that doesn't end the match, every human player with a sideboard. The loser answers
  play or draw first.
- **The question** (on the prompt panel, `__match`): "Game 2: sideboard?" with **Keep deck**, **Swap cards**, **Reset
  to registered** (once the deck differs from game 1's) and **Concede match**.
- **Swap cards:** first "take out which cards of your main deck?" (pick any), then "bring in which sideboard cards?".
- **The bridge's check:** 60 or more in the main deck and at most 15 in the sideboard. Otherwise it says why ("That
  swap leaves 58 cards in your main deck: it needs 60 or more. Nothing was changed.") and asks again.
- **When it's done:** "Blue sideboarded for game 2: out Opt ×2; in Negate ×2 (main deck 60, sideboard 15)."
- **The decks:** game 1's deck is kept as registered. Each later game sends the deck as the last swap left it.
- **The next game waits:** New game is refused until everyone is done: "Not started: Blue is still sideboarding for
  game 3."

**4. "Concede match"** (`concedeMatch`).

- **During a game:** `mtg match concede`, twice within 15 seconds. The first says "Concede the match? AI 1 wins it."
- **Between games:** the Concede match option on the play-or-draw or sideboard question, then **Yes, concede the
  match** / **No** (No goes back to the question).
- **What it does:**
  - the game still running is conceded too;
  - "MATCH WON: AI 1 wins the match (Blue conceded the match)." in chat and the log;
  - the game's end that follows counts for nothing and asks nothing;
  - the next game is game 1 of a new match.
- **The table's chat** (`make-engine-copy.js`) lets any player type `mtg match concede`; the settings stay the host's.
  The help line names it.

## Lua rules

- **No new main-chunk locals:** `tools/lua-scan.js` gives 175 local names, unchanged. The new names are globals.
- **No `local` in a for-in loop body.**
- **Plain finds only:** the new Lua has no `find` or `sub` at all.
- **It parses:** the renderer with fengari, and the chat chunk with luaparse, before and after.

## Tests (written first, run red, then the code)

- **`tests/test_bridge_bo3_extras.js` (new): 42 of 42.**
  - **The roll:** the winner first, a tie rolled again, once a game, the table's own first player, no roll outside a
    match.
  - **The phase bar:** game 1, 2 and 3 of 3; game 4 of 5.
  - **Sideboarding:**
    - the loser's play or draw, then the sideboard question;
    - the winner asked too;
    - the counts;
    - a swap out then in;
    - the next game's deck;
    - refused swaps (main 58, sideboard 16) asked again;
    - a fine one (62/14);
    - Reset to registered;
    - New game refused while sideboarding;
    - a deck with no sideboard asks nothing.
  - **Concede match:**
    - the chat confirmation;
    - the game conceded;
    - MATCH WON;
    - the game's end after it;
    - a new match;
    - between games, Yes and No;
    - no match on.
- **`tests/test_table_bo3_extras_lua.js` (new): 9 of 9.**
  - `engineMatchTag` and `engineMatchRollBanner` in fengari: once, a jump board, called with the board, the tag on the
    bar.
  - The chat line and the help.
- **Both are in `tools/deploy.js` GATES.**
- **Updated: `test_bridge_match_bo3` 28 of 28.** Two of its checks follow the new behaviour: the play-or-draw question
  offers Concede match, and a new match's game 1 is rolled for. Its header says so.
- **Gates here:**
  - `test_bridge_golden`: 1084 of 1084.
  - `test_bridge_treachery_first`: 23 of 23.
  - Every gate that runs without the TTS save passes, with three exceptions that fail the same way without these
    changes:
    - `test_bridge_claims`: a live-files guard check;
    - `test_table_map`: "unbounded is still a CardDto field";
    - `test_editor_forward`: this container has no IPv6.
  - `test_ui_budget` and the other table gates need the TTS save and weren't run. No XML was changed.

## Break-its

`node tools/mutate-bo3-extras.js`: 29 mutations on copies of `bridge.js`, `engine-renderer.lua` and
`make-engine-copy.js`. **29 caught by name, 0 survived**, the real files checked by sha256.

- **The roll:** not rolled; a tie kept; the loser first; rolled again each time; not on the board.
- **The phase bar:** always "of 3"; not on the board; the tag not on the bar; the tag's words.
- **The banner:** shown on every board; on a jump board; never called.
- **Sideboarding:**
  - the swap not used next game;
  - either count unchecked;
  - only the loser sideboards;
  - a deck with none asked;
  - not asked after play or draw;
  - no Reset;
  - Reset not restoring;
  - a start while sideboarding.
- **Concede match:**
  - no confirmation;
  - the game not conceded;
  - the match not ended;
  - the game's end counted;
  - between games, no Yes / No, or No conceding too.
- **The table's chat:** the host-only concede; the help line.

**Fixed after the first run:** two checks were too weak, and they were made stronger, not dropped:
- "Rolled again each time" now also counts the roll's chat lines, which a second roll would repeat.
- The concede case moved to game 2, since in game 1 "the next game is game 1" held even with the match left running.

## Left

- A look on the real table:
  - the banner;
  - the phase bar's "GAME 2 OF 3";
  - the sideboard lists on the panel (a 60-card list pages 29 at a time, with its search box).
- A live match, with a preset deck that has a sideboard.
- Not built: a clock for sideboarding (the turn timer); a laid-out swap, Arena style.
