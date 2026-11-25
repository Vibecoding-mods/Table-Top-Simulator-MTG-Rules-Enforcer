# The engine harness, in plain English

The rules engine is Forge (a Java program that knows the rules of Magic) wrapped in a thin layer called the
harness. The harness is what the table talks to: it turns the table's messages into Forge's questions and answers,
and turns Forge's game into the picture of the board each player is sent. Our changes to it live only as two patch
files in this repo (`engine/manabrew.patch` and `engine/forge.patch`); `docs/engine-changes.md` is the technical log.

## The parts that matter most

- **The protocol adapter** reads each message from the table ("I pass", "I tap this land for green", "I vote to
  rewind") and turns it into the short instruction the game thread acts on. If a message is malformed, it is
  refused here, before it reaches the game.
- **The session** runs one game. It owns the restore points (the rewind feature), the tie offer, the runaway-turn
  limits and the "fix the board" tool, and it hands each player their picture of the board.
- **The controller** is one seat's stand-in inside Forge. When Forge asks the seat a question, the controller asks
  the table and waits. It also remembers a "held pass" (pass until a chosen step, or pass until the stack is empty)
  so the player is not asked again and again.
- **The snapshot extractor** builds the board picture for one viewer. It decides what that viewer may see: your own
  hand, not your opponent's; a face-down card only to its controller; and for a spectator, only what is public.

## The photographs (added 2026-11-24)

Three new test classes record what the harness does today, so a later change that alters it by accident fails by
name:

- `ProtocolGoldenTest` feeds about 110 table messages (good ones and broken ones) through the adapter and records
  the result of each, plus the game-start checks (team rules, perks, starting life), the rewind point limits, the
  runaway-limit wording and the held-pass rules.
- `SnapshotGoldenTest` builds fourteen small boards (combat, hidden cards, counters and flags, emblems, a spell on
  the stack, cards moving, secret choices, a dozen tokens, a player who conceded, delayed triggers, broken fixes)
  and records the board picture each of four viewers gets: the three players and a spectator.
- `GoldenFileTest` tests the recorder itself.

The recorded answers are in `forge-harness/src/test/resources/golden`. When a change is meant to alter behaviour,
the files are re-recorded on purpose and the difference is read before it is kept.

To show the photographs can actually catch mistakes, 37 plausible small mistakes were made in copies of the code,
one at a time. The tests caught 36, each by name. One early miss showed that an older held-pass test set up its
hold by hand instead of through the real code; it now goes through the real code. The one still missed changes nothing a player could ever see (Forge already lets a
card's controller see their own face-down permanent, so removing our extra check for it gives the same result).

## What changed on 2026-11-24

- **A colour answer with a zero in it.** When the table answered "which colour?" with a list such as red 0, green 1,
  the engine took red, the first one listed, even though red was picked zero times. It now takes the first colour
  picked at least once. A single colour with a zero count (the way the table sends a plain colour pick) still means
  that colour.
- **A board fix with no list of changes.** A "fix the board" message without its list of changes used to reach the
  game and crash it there, which could stop the game. It is now refused as soon as it arrives, and if one ever does
  reach the game, the game says "the fix has no ops array" and carries on.
- **A spectator and delayed triggers.** A spectator could not read the text of a delayed trigger whose card is on
  the battlefield (for example Sneak Attack's "sacrifice it at the end step"), because Forge keeps a frozen copy of
  that card and the copy does not say which zone it is in. The spectator now reads the zone the card was last in,
  so public triggers show their text to everyone, as they already did for the players.
- **Tidying with no change in behaviour.** The held-pass bookkeeping in the controller is now set and cleared in one
  place each; two test switches are now safe to flip from another thread; an unused copy of the snapshot entry
  point was removed.
- **The harness guide** (`forge-harness/.../AGENTS.md`) now lists all five team rules and says correctly which of
  them read the game-wide poison and commander-damage limits.
