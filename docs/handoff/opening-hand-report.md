# Report: the picked starting hand dealt as the opening hand

Cloud session, 2026-11-17, branch `cloud/opening-hand` from `origin/cloud/ai-budgets` (0bb4d3d). The engine change is
`engine1122-openinghand` in `docs/engine-changes.md`.
- Not built into an image, not tried on the table or against a live engine. No permission prompt is pending.
- **No name `openingCards` existed before this branch.** The open item is the picked hand from `mtg hand` and the
  companion page's Starting hand (`handChoice` → `game.handPick` in the bridge). Today the bridge keeps the dealt hand
  at the mulligan question and swaps the picked cards in at the first priority, as a debug fix.
- **`openingCards` is the new field's name,** as the task called it.

## What changed

**Forge (`forge.patch`):**
- `RegisteredPlayer.get/setOpeningCards`.
- `GameAction.stackOpeningCards`, called in `startGame` for each player just before the deal:
  - the named cards go on top of the shuffled library, in order;
  - the deck's own copy is taken where it has one; otherwise the card is created there (as `Match` creates library
    cards), and the deck grows by it;
  - only the first starting-hand-size names count.
- **What follows from that:**
  - the deal makes them the opening hand, and the rest of the hand is dealt at random;
  - the keep-or-mulligan question shows them;
  - the London mulligan shuffles them back and deals again, as any hand;
  - other players are dealt as usual.

**The node (`java_backend.rs`, in `manabrew.patch`):**
- `GameConfigPlayer.opening_cards` → `PlayerConfig.opening_cards`, the names through `java_card_name` as schemes'.
  The field is left out of the JSON when empty.
- **Every literal:**
  - `PlayerConfig::new` gets `opening_cards: Vec::new()`;
  - the two `GameConfigPlayer { .. }` literals in tests use `..Default::default()`, so they needed nothing;
  - no other literal of either struct exists (grep).
- The node already `take()`s the `gameConfig`, so a picked hand is for one game.
- **The relay passes `gameConfig` through unchanged** (`connection.rs` checks only the type and that the controller
  sent it), so it needn't be rebuilt. No `CardDto` or other protocol DTO changed.

**The harness (`ManaBrewEngineAdapter`, no comments):** the start request's `openingCards` per player
(`PlayerConfig.withOpeningCards`), set on the `RegisteredPlayer` by `configurePlayer`, the one place the real start
configures players.

**The bridge (`bridge.js`):**
- `startConfig` adds `{ username, openingCards }` for each picked hand (`openingCardsConfig`):
  - a game with only a picked hand now sends a `gameConfig`; it had none before;
  - with a first player, both go in the one `gameConfig`;
  - in a team game the cards go on the player's own team entry.
- **`handPrompt` at the mulligan question:**
  - when the hand already is the picked one (nothing for `handOps` to change), the bridge says "Blue's picked hand was
    dealt as the opening hand: keep it or take a mulligan as usual.", the pick is used up, and the question is the
    player's;
  - otherwise (an engine without this change), it does as before: keeps the hand, then applies the debug fix at the
    first priority.
- `HAND_WHEN` (the chat line when a hand is picked or a game takes it) says the engine deals them before the question.
  The section's comment says how.

**Checked unchanged:**
- **The debug and hand-test flows:** `test_bridge_hand` passes, 46 of 46, with its two wording checks updated to the
  new sentence. `test_fix_hand_relations`, `test_table_fix_hand` and `test_table_hand_chat` are below.
- **AI seats:** dealt as usual (`theOtherSeatIsDealtAsUsual`). The bridge sends `openingCards` only for the person
  with a pick.
- **Rewind to turn 1:** the checkpoint has the hand (`aRewindToTurnOneKeepsThePickedHand`).

## Tests

**`OpeningHandTest`, 8 checks:**
- Written first: its first run was a compile failure on the missing `getOpeningCards`.
- Real Forge games: two AI seats with 20 Plains, a Grizzly Bears and a Lightning Bolt each. A controller records the
  hand at each keep-or-mulligan question, and the start hook stops the game at turn 1.
- **The checks:**
  - the start request carries each player's names, and the registered player gets them;
  - the picked cards are the hand at the question, and after keeping;
  - the deck's own Bears and Bolt aren't doubled, and the Mountain the deck hasn't got is created: 23 cards;
  - the other seat has its 22 cards and a random hand (6 games);
  - a mulligan deals again: no extra cards, and the picked hand didn't come back in all 5 games;
  - with 9 names only the first 7 count: no Shock or Counterspell created;
  - without `openingCards` the deal is random;
  - a rewind to turn 1 brings the picked hand back after the hand was emptied.
- **One correction to my own test:** Forge's second keep question shows 6 cards, so that check now takes 6 or 7.

**Rust: `a_game_config_seat_gives_its_player_opening_cards`.** No `openingCards` without the field. With it, the
names reach Java once. `cargo test -p self-hosted-node --lib game_config`: 4 of 4 pass.

**`tests/test_bridge_opening_hand.js`, 11 checks, in GATES.** Written before the bridge change: 6 failed without it.
- the start's `gameConfig` with the picked cards, before StartGame;
- no `gameConfig` without a pick;
- with a first player, the two together;
- 2HG: on Blue's own entry, with no entry added;
- dealt: the question is Blue's, it is said, the pick is used up, and nothing happens at the first priority;
- not dealt: kept, then one fix, as before.

**Break-it: `node tools/mutate-opening-hand.js <tree>`.** It covers Forge, the harness, the node and the bridge: 18
mutations, each caught by name, every file restored by sha256.
- **On the first run "names past the hand used" wasn't caught.** My test's extra names were cards the deck has, so
  using them created nothing. They are now cards it hasn't got.
- Final result: **18 of 18 caught by name**, after the fix above.

## Gates

- **Harness:** `engine/test-harness-local.sh --all`: **47 of 47 classes pass**, `OpeningHandTest` included, after the last change. Both patches `git apply --check` clean on fresh `fd16e2f` / `e7d2b93b` worktrees and reproduce every edited file.
- **Repo GATES**, against the previous run on followups-3 (same container): **identical apart from the new `test_bridge_opening_hand`** (11 of 11).
- **The 39 gates that need the Workshop save** (2296042369) still can't run here. They fail with ENOENT or SKIP, as
  before.

## Not done

- No image, no live game.
- On the table: pick a hand (companion page, Starting hand), start against the AI, and see the picked cards at the
  keep-or-mulligan question; then a mulligan and a rewind to turn 1.
