# Report: a tie offer when a player can't lose

Cloud session, 2026-11-16, branch `cloud/tie-offer` from `origin/cloud/three-headed-giant` b9d3c34. This is the design the
user approved. Not tried against a live engine or the real table. No permission prompt is pending.

## Engine (`engine/manabrew.patch`; `forge.patch` unchanged)

- **Detection:** a new harness class, `forge-harness/.../host/TieOffer.java`.
  - It is rechecked before every priority question (`ManaBrewInteractiveSession.awaitPriorityAction`), so after each
    resolution.
  - A player is locked when one of Forge's own checks holds:
    - `Player.cantLose()`: Platinum Angel, Angel's Grace, the Gideon emblem;
    - `canLoseLife()` false: Platinum Emperion, Teferi's Protection;
    - `cantLoseForZeroOrLessLife()` (Phyrexian Unlife), when the player can't get poison counters (Solemnity:
      `canReceiveCounters(POISON)` false) and no other player in the game has a commander;
    - all damage to them prevented: a `DamageDone` replacement with `Prevent$ True` whose `ValidTarget` matches the
      player and that has no other condition. Glacial Chasm counts. Personal Sanctuary's "during your turn" and
      noncombat-only prevention don't.
- **The offer** is `gameView.tieOffer`:
  - the locks with their reasons;
  - the people still to answer;
  - who accepted (an AI seat accepts at once);
  - the status: pending, declined (by whom), agreed or forced;
  - the rounds without progress, and the 3 rounds needed.
- **The vote** is the `tieVote` directive, modelled on the rewind vote.
  - All yes is a draw: `intentionalDraw` for each player, then `GameEndReason.Draw`, as Forge's `GameDrawEffect` does.
  - A vote for an old offer, or from a seat not asked, is ignored.
- **The forced tie.**
  - After a no, the count runs while the lock holds. A round ends when the turn comes back to the player whose turn it
    was at the no.
  - Progress starts the count over. Progress is any of:
    - a life total going down;
    - poison;
    - commander damage;
    - a permanent leaving the battlefield;
    - a card going from a library to a graveyard (a mill);
    - a player losing.
  - A life gain is not progress.
  - At 3 rounds the same draw is made, with status `forced`.
  - A broken lock clears the offer, and a new lock makes a new offer.
- **Protocol** (every new field optional):
  - `GameViewDto.tie_offer: Option<TieOfferDto>`, with `serde(default, skip_serializing_if = "Option::is_none")`.
  - `TieOfferDto`, `TieLockDto` and the `TieOfferStatus` enum. Every list and count in them is `serde(default)`.
  - `DirectiveInput::TieVote { vote_id, accept }`:
    - routed to the seat like `RestoreVote` (`self-hosted-node/src/host.rs`, `manabrew-agent-interface`);
    - mapped to `tie_vote` by `ManabrewProtocolAdapter`.
  - The relay parses directives against the protocol, so **the relay must be rebuilt with the node**.
- **No comments** were added to the harness Java or the Rust.
- **Patches:**
  - Both were regenerated with `engine/make-patches.sh` against a clean `fd16e2f` / `e7d2b93b` tree with
    `core.autocrlf=false`.
  - `git apply --check` is clean for both.
  - Applied to fresh worktrees of the pinned commits, they give the same files as the working tree.
- **`docs/engine-changes.md`:** a new row and section, "engine1117-tie".
- **`engine/checks/harness-tests.sh`:** its default list now includes `ThreeHeadedGiantTest` and `TieOfferTest`.

## Bridge

- **`bridge.js` tie section:**
  - `tieState` sends the offer to the table as the board's `tie`: who is locked and why in words, the colours still to
    answer, the people by name (not a harmless bot), the state and the rounds.
  - `tieNews` says each change once in chat and in the game log:
    - the offer, and how to answer it;
    - a no, with the forced-tie rule;
    - a warning each round ("Tie warning: 2 of 3 rounds without progress...");
    - progress starting the count over;
    - the lock broken;
    - the agreed draw;
    - the forced tie.
  - The table's `tieVote` and `mtg tie yes/no` become the directive. A seat not asked, or no open offer, is told so.
  - A harmless bot accepts at once (`harmlessVotes`). A Forge AI accepts in the engine.
  - The game's end words read "a draw: everyone accepted the tie" or "a forced tie: 3 rounds without progress".
- **The accomplishment:**
  - Kept in the new `bridge/accomplishments.js`, in `%APPDATA%/MTG-TTS/accomplishments.json`, or `MTG_ACCOMPLISHMENTS`,
    keyed by Steam ID. The pattern is the GIF favourites': write a temp file, then rename.
  - A forced tie gives each person at the table "Stalemate" once a game, with a count and first and last dates, and
    tells them privately.
  - Steam IDs come from the start message (`steam`, new) and from each vote. A seat without one gets nothing kept.
  - `mtg accomplishments` lists yours.
  - The module reads and writes only its own file. A test watches the file calls and checks that `gif-keys.json` is
    never read or written.

## Table

- **The Tie pop-up:**
  - It is in the rewind vote's style, under it, and built in `rewindXml`'s string, so no new local.
  - Tie and Keep playing are shown to a player still to answer, and the words say who it waits for.
  - After a no it stays up with "Rounds without progress: N of 3", and shuts at game over or when the lock breaks.
  - The new functions are all globals: `engineTieUpdate`, `engineTieDraw`, `engineTieWaits`, `engineTieWords`,
    `engineSteamOf`, `engineSteamIds` and `onMtgTie`.
- **Chat:** `mtg tie yes`, `mtg tie no` and `mtg accomplishments`, plus a help line. The start message carries the
  seated players' Steam IDs.
- **Lua rules:**
  - main-chunk locals: 91, unchanged;
  - local names: 175, unchanged;
  - no `local` in a for-in loop body;
  - no patterns.
  - The renderer, `engineChat` and `engineStartGame` parse (luaparse).

## Tests

- **`TieOfferTest`:** 22 of 22 (harness, `engine/test-harness-local.sh TieOfferTest`). It checks:
  - each lock card, Unlife alone, Unlife against a commander, and a conditional prevention;
  - the offer and the AI's acceptance;
  - the draw outcome, an old vote, and a broken lock;
  - the forced tie, each kind of progress, and a life gain not counting;
  - the session's priority recheck, the snapshot's `tieOffer`, and `tieVote` directives ending the game.
- **The whole harness suite** (`--all`, 29 classes) passes.
- **Rust:** `cargo test -p manabrew-protocol -p manabrew-agent-interface` passes. `cargo build` of the node, the relay,
  loadgen and networking-tests is clean.
- **`node tests/test_bridge_tie_offer.js`:** 46 of 46.
- **`node tests/test_table_tie_offer.js`:** 24 of 24 (fengari, no save).
- **Regression:**
  - `test_bridge_3hg` 26.
  - `test_bridge_team_modes` 49.
  - `test_bridge_teams` 35.
  - `test_bridge_2hg_level2` 47.
  - `test_bridge_2hg_team_block` 56.
  - `test_table_map` 619. It needs the engine tree linked at `manabrew/`, which isn't committed.
  - `test_bridge_golden`: all 1079 match. No golden scenario has a tie offer, so none changed.

## Break-its

- **`node tools/mutate-tie-offer-engine.js <engine tree>`:** 24 of 24 caught by name, every file restored by sha256.
  - Each lock check.
  - The threats.
  - The prevention's conditions.
  - The AI asked.
  - One accept.
  - The vote id.
  - The broken lock.
  - Four rounds.
  - No draw outcome.
  - Each kind of progress.
  - A life gain counted as progress.
  - The priority recheck.
  - The snapshot.
  - The session and the adapter.
  - On the first run, "a loss is no progress" survived: Red's concession also took Red's Forest off the battlefield,
    which counted as progress. The progress checks now start without that Forest.
- **`node tools/mutate-tie-offer.js`:** 36 of 36 caught by name, every file restored by sha256.
  - It covers the bridge, `accomplishments.js`, the renderer and the chat, including "the store beside gif-keys.json".
  - One mutation was dropped as equivalent: removing the "same board" guard. The offer is already said only when its id
    changes.
  - Two survivors from the first run were closed with new checks:
    - the accomplishment kept once even when a board drops the offer and shows it again;
    - the pop-up shutting at game over with an offer still open.

## Questions for the user

1. **Who earns Stalemate?** I gave it to every person at the table in a forced tie. Should it go only to the locked
   player, or only to those who declined?
2. **One lock among four players.** The offer is made whenever anyone can't lose, as designed. In a four-player game the
   other three can still knock each other out, though. Should the offer wait until the locked player's opponents are
   all that is left?
3. **Decking.** A Phyrexian Unlife + Solemnity player can still lose to an empty library, and that isn't checked as a
   threat (the design lists poison and commander damage). Add it?
4. **The table.** Should the pop-up after a no be closable? It stays up showing the count.

## Not done

- A live game and the real table. The table tests that need the TTS save weren't run.
- No golden scenario was added. The new tests cover the flow.
