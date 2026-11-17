# Report: Archenemy rules audit

Cloud session, 2026-11-17, branch `cloud/archenemy-audit`, from `origin/cloud/table-polish` (`8c9255b`, on
owner-decisions-1117). Engine tag `engine1121-archenemyaudit`, on top of `engine1121-ownerdecisions`. Not built as an
image.

**Source:** the Comprehensive Rules of November 6, 2026, from `https://media.wizards.com/2026/downloads/MagicCompRules
20261106.txt`, found through `magic.wizards.com/en/rules`. This session's network didn't allow those hosts at first.
The user approved a new environment for this repo that allows `magic.wizards.com` and `media.wizards.com`, and the
file was read from there. Rules read: 904 (all), 314, 701.32, 701.33, 103.1, 103.8 and 808.1.

## Each rule against what we do

| Rule | The rules' text, in short | Bridge / engine / table | |
|---|---|---|---|
| 904.2 | Team vs. Team, two teams; the attack multiple players option **and the shared team turns option (805)** are used; no other multiplayer options | Two teams; attacking several players. **Each opposing player takes their own turn** (no shared team turns). Shared life refused | **Not as written** (see below) |
| 904.2a-b | One team is exactly one player, the archenemy; the other any number | `juggTeams(arch.color)`; the engine refuses no archenemy or two | ✓ |
| 904.3 | A scheme deck of at least 20; at most 2 of a name | Bridge `schemeDeckProblem` and the engine's `Archenemy.schemeDecks`: 20, 2 of a name. The random 20 are distinct | ✓ |
| 904.4, 314.2 | Schemes stay in the command zone, in the deck and face up | Forge's `SchemeDeck` zone is part of the command zone | ✓ |
| 904.5 | The archenemy starts at 40, the others at 20 | Standard: 40 and 20. Commander: 80 and 40 each | ✓ in Standard; Commander is the owner's house rule (plan §2.7, 3) |
| 904.6, 103.1b | The archenemy takes the first turn | `goesFirst` in gameConfig | ✓ |
| 103.8 | First draw skipped in a two-player game only; in other multiplayer games no one skips | Forge's `isSkippingPhase`: turn 1 with 2 players | ✓ |
| 904.7, 314.5 | A scheme's owner is the player who started with it; its controller is its owner | Forge | ✓ |
| 904.8, 314.4 | A face-up scheme's abilities work from the command zone | Forge (`ArchenemyTest`: Look Skyward and Despair, Roots of All Evil, I Am Untouchable) | ✓ |
| 904.9 | Right after the archenemy's precombat main phase begins, each of their turns: the top scheme set in motion, no stack | Forge `PhaseHandler`, `MAIN1` | ✓ |
| 701.32c | Schemes set in motion one at a time | Forge `SetInMotion` with `RepeatNum` (tested) | ✓ |
| **904.10, 314.6** | A face-up non-ongoing scheme goes back under the deck when **no triggered ability of any scheme** is on the stack or waiting to be put on it (state-based) | Forge looked only at **the scheme's own** abilities | **Fixed** |
| 904.11, 701.33 | An ongoing scheme stays until abandoned; abandoning puts it on the bottom | Forge (tested) | ✓ |
| 808 | Teams win and lose together | The bridge's win words; the engine's team game | ✓ |
| 904.12 | Supervillain Rumble option | Not offered | — |
| 904.13 | Archenemy Commander option: 60 against a shared 60, at least 10 all-different schemes, poison not shared | Not used. The Commander game is the 904 game with Commander decks and the owner's life; the 904.3 deck rule applies | House rule, noted |

## The fix: CR 904.10

**The problem.** Forge's `GameAction.stateBasedAction_Scheme` sent a face-up non-ongoing scheme back as soon as none of
its own triggered abilities was on the stack or waiting. The rule asks that no scheme's triggered ability be there.

For example, with two schemes set in motion in a row (a scheme that sets another in motion, or two in one turn), the
second one's trigger resolves first. That scheme then went under the deck while the first one's trigger was still on
the stack.

**The fix.** `MagicStack.hasSchemeTrigger()` is true while a triggered ability whose source is a scheme is on the
stack or waiting to be put on it. `stateBasedAction_Scheme` moves the scheme only when it is false.

**Tests** (`ArchenemyTest`, both written first and failing by name):

- `cr904_10 aSchemeStaysWhileAnotherSchemesTriggerIsOnTheStack`:
  - Look Skyward and Despair is set in motion and its trigger put on the stack.
  - Roots of All Evil is set in motion on top of it.
  - Roots's trigger resolves, then the state-based actions run.
  - Both schemes must still be face up. Before the fix Roots was already under the deck.
  - After everything resolves, both are back.
- `cr904_10 aSchemeStaysWhileAnotherSchemesTriggerWaits`: Skyward's trigger resolved and Roots's trigger waiting.
  Skyward must stay.
- The other 15 `ArchenemyTest` checks pass, including `aNonOngoingSchemeReturnsToTheBottom`.

**Break-it:** `node tools/mutate-archenemy-audit.js <tree>`, **4 of 4 caught by name**, restored by sha256:

- only the scheme's own triggers, as before;
- the waiting triggers not looked at;
- the stack not looked at;
- a scheme that never goes back.

**The full harness suite** (`engine/test-harness-local.sh --all`): 46 classes, all passed.

## Not as the rules say, left open: 904.2's shared team turns

**What the rule says.** The default Archenemy game uses the shared team turns option: the archenemy's opponents take
one turn together (805).

**What we do.** Each of them takes their own turn, which the bridge's setup words say ("their own turns"). The plan's
§2.7 took "rule 904 as written" as a default, but about the turn order (the archenemy first), not this.

**Why it isn't fixed here.**

- The engine's shared team turns exist only as Two-Headed Giant Level 2.
- `ManaBrewEngineAdapter` sets `sharedTeamTurns` only together with shared life, and refuses teams of different sizes
  there.
- Archenemy needs shared turns with each player's own life, and teams of one and N.
- That is engine work, in the phase handler, priority, combat and the AI, not an audit fix.

**What it needs:** an owner's decision (keep own turns as a house rule, or build 904.2's shared turns), then the engine
work.

## Also noted, not changed

- **Life (904.5, 904.13b):** the owner's double-the-format house rule stays. Standard is the rules' own 40 / 20.
- **The Commander option's deck (904.13d):** at least 10, all different. Not used, because the Commander option as a
  whole (shared 60 life) isn't. The 904.3 deck rule applies, as the bridge and engine check it.
- **Wording:** the bridge and the table say "at each of their first main phases" for 904.9's "precombat main phase".
  That is the same phase.

## Patches and docs

- `engine/forge.patch`: `GameAction.java` and `MagicStack.java` differ from owner-decisions'.
- `engine/manabrew.patch`: `ArchenemyTest.java` only. No comments in harness Java.
- No protocol change.
- `git apply --check` is clean on `fd16e2f` / `e7d2b93b`.
- `docs/team-turns-archenemy-plan.md`: the "rules not checked" paragraph is now this audit's summary, and §2.7 notes
  904.2.
- `docs/engine-changes.md` has the row.

## Not run

- No bridge or table code changed, so their gates weren't rerun.
- No image was built and no live game was played.
