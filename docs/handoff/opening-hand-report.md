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

## After review (same branch)

**MEDIUM: a name Forge didn't match the same way.**
- **The bug:** a pick written as one half of a split card ("Fire" for "Fire // Ice"), the back face of a double-faced
  card ("Insectile Aberration"), or in another case made `stackOpeningCards` create a second copy. The bridge then saw
  an unmet pick at the mulligan question: it kept the hand for the player and swapped cards in again at the first
  priority.
- **Shown red first:** `OpeningHandTest`'s new split and double-faced checks failed (2 Fire // Ice, 2 Delvers).
- **Forge fix:** `stackOpeningCards` reads a name as the card database does: `CardDb.getRules(name, true)`, so any
  case, either face, either half or the whole name. It matches the library by those rules, taking the deck's own
  copy, and creates by the full name. A name the database doesn't know is skipped, and that slot is dealt at random.
- **Bridge fix:** `handOps` compares the hand's names with the picks the same way (`sameCardName`, through
  forge-cards.json's index), so a hand shown with either half's or the whole name counts as dealt.
- **How the bridge tells the engine supports it:** the hand at the first mulligan question holds every pick. Then the
  pick is used up, the question is the player's, and there is no first-priority swap.
  - The bridge accepts only names in that same index, and the engine places every name its database knows. So on an
    engine with `openingCards` every pick is in the hand.
  - On an old engine whose random deal happens to hold every pick, there is nothing to swap either.
  - **What isn't covered:** a name in the bridge's index that the engine's database lacks (an index built from
    another Forge). Then the bridge falls back to the old path.
  - An explicit flag would close that, but needs a protocol field: the mulligan prompt's `MulliganInput` is shared
    by the relay and the node, has three Rust literals, and would need both images rebuilt. I didn't add one; say if
    you want it.

**LOW: the created card is in the game's tracking.** `aCreatedCardIsInTheGamesCardTracking`: `findById` finds it, it
is in `getCardsInGame` and the hand, and it has White as owner and the hand as its zone.

**Tests now:**
- `OpeningHandTest` 12 checks: a split picked as "Fire // Ice", "Fire", "ice" and "FIRE // ICE"; a double-faced card
  by either face; an unknown name; the created card's tracking.
- `test_bridge_opening_hand` 23 checks: a half and a back face kept as the engine's cards when set; an unknown name
  refused; dealt with the whole name, shown by its half, picked by its half, double-faced, and by its back face.
  6 of the new ones failed without the bridge change.
- `test_bridge_hand` 46.

**Break-it:** 22 of 22 caught by name. The new mutations:
- names compared as typed in Forge, and in the bridge;
- no face or half names;
- an unknown name not skipped.

"No face or half names" is caught by the split check: a back face's name resolves even without face names allowed.
