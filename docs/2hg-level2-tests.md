# Two-Headed Giant level 2: test plan

Level 2 is Two-Headed Giant with real shared team turns (CR 805, the shared team turns option, and CR 810, the variant itself). The engine gate is `GameRules.sharedTeamTurns`. The harness turns it on with `teamRules: "sharedTurns"` in the start request, and that also turns on level 1's shared life. Level 1 (`sharedLife`: shared life and poison, team wins and losses, blocking for a teammate) is covered by `TeamGameTest`, and none of it changes here.

Tracks: **A** tests (this plan), **B** Forge turn structure and priority, **C** Forge combat, **D** bridge and table.

## Where the tests live

| What | Where | How to run |
| --- | --- | --- |
| Engine checks | `forge-harness/src/test/java/forge/harness/host/SharedTurnsTest.java` in the engine tree (branch `l2-tests`) | the level 2 dev loop: `node tmp/slot.js sh <engine>/tmp/l2-tests-run.sh SharedTurnsTest`. It compiles the changed Forge files over the jar in `mtg-harness-test:engine1116-teams2`. Pass check names as extra args to run only those. |
| Known-failing list | `docs/2hg-level2-known-failing.txt` | Names of checks that fail until their track lands, with the owning track. Take a name off once it passes. |
| Mutation proof | `tools/l2-mutate.js` + `tools/l2-mutate.sh` | `node tmp/slot.js node tools/l2-mutate.js --engine <engine tree>` breaks one rule at a time in the engine source and requires the named checks to fail. The unmutated run may fail only names on the known-failing list. |
| Protocol fixture for D | `tests/golden/fixtures/2hg-level2-protocol.json`, built by `tests/make_2hg_level2_fixture.js` | `node tests/make_2hg_level2_fixture.js` rewrites it, and `--check` fails if it is stale. Its status is `"expected"`: it is hand-built and has not been recorded yet. |

Every engine check runs a level 1 contrast: the same setup with the flag off, which must keep the old behaviour (or keep free-for-all behaviour, where level 1 already shares the rule). That way a check can't pass just because the flag is ignored, and level 1 can't regress unnoticed. Check names are printed as `cr<rule> <name>`.

## Rules to tests

Status is measured against the WIP engine (forge `7d586b47`, harness `8ed302a`). "passes" means it passes there and the mutation listed under it makes it fail. "FAILS" means it is a target for the owning track.

| CR | Rule (short) | Check(s) in SharedTurnsTest | Track | Status |
| --- | --- | --- | --- | --- |
| 810.2, 810.4 | 2HG uses shared team turns, and `sharedTurns` also means shared life | `sharedTurnsSetsBothFlags` | B | passes |
| 805.4a | the active team: both partners' turn | `isPlayerTurnCoversThePartner` (isPlayerTurn, getActiveTeam, sorcery timing) | B | passes; mutations `isPlayerTurn-player-only`, `active-team-is-first-seat` |
| 805.4c | each partner may play a land | `eachPartnerMayPlayALand` | B | passes; `isPlayerTurn-player-only` |
| 805.4, 502 | the team untaps together | `theTeamUntapsTogether` | B | passes; `untap-first-seat-only` |
| 805.4b | each partner draws in the team's draw step | `theTeamDrawsTogether` | B | passes; `draw-first-seat-only` |
| 805.6a | "each player draws": the active team first, then the other team | `eachPlayerDrawsActiveTeamFirst` | B | passes, and also passes at level 1 (regression guard, no mutation) |
| 514.1, 805.4 | the team discards to hand size together | `theTeamDiscardsToHandSize` | B | passes; `discard-first-seat-only` |
| 810.6 | the starting team skips only its turn 1 draw | `startingTeamSkipsOnlyTurnOnesDraw` | B | passes; `starting-team-draws` |
| 805.4 | the next turn goes to the other team | `nextTurnGoesToTheOtherTeam` | B | passes; `next-turn-next-seat` |
| 805.8 | a partner's extra turn is the team's | `aPartnersExtraTurnIsTheTeams` | B | passes; `extra-turn-one-member` |
| 805.8 | a partner skipping a turn skips the team's | `aPartnerSkippingATurnSkipsTheTeams` | B | passes; `skip-turn-one-member` |
| 805.8 | a partner skipping a step (Necropotence) skips the team's | `aPartnerSkippingAStepSkipsTheTeams` | B | passes; `skip-step-one-member` |
| 805.4d | "each player's upkeep" fires per partner (Blood Clock) | `eachPlayersUpkeepTriggersForEachMember` | B | passes; `phase-trigger-first-seat-only` |
| 805.4d | "each player's draw step" fires per partner (Howling Mine) | `eachPlayersDrawStepTriggersForEachMember` | B | passes; `phase-trigger-first-seat-only` |
| 805.4d | "each upkeep" fires once (Awakening) | `eachUpkeepTriggersOnce` | B | passes; `each-upkeep-fires-per-member` |
| 805.4 | "your upkeep" fires for the partner (Phyrexian Arena) | `yourUpkeepTriggersForThePartner` | B | passes; `phase-trigger-first-seat-only` |
| 805.10a | both partners' creatures attack, and each partner is asked for their own | `bothPartnersCreaturesAttackTogether` | C | passes; `partner-not-asked-to-attack` |
| 805.10b | one combined attack, legal as a whole (a partner's Juggernaut) | `aPartnersMustAttackBindsTheCombinedAttack` | C | passes; `must-attack-first-seat-only` |
| 805.10c | an attacker's attacking player is its controller | `attackingPlayerOfACreatureIsItsController` | C | passes; `attacking-player-is-first-seat` |
| 805.10a, 805.10c | "when you attack" (Ainok Strike Leader) for the partner | `whenYouAttackTriggersForThePartner` | C | passes; `when-you-attack-first-seat-only`, `partner-not-asked-to-attack` |
| 805.10d | the defending team blocks together, any defender can block any attacker at the team | `theDefendingTeamBlocksTogether` | C | passes; `partner-not-asked-to-block` |
| 805.10d | one combined block, legal as a whole (two partners double-block a menace attacker) | `theCombinedBlockIsLegalAsAWhole` | C | passes, and also passes at level 1 (regression guard) |
| 805.10f | the attacking team assigns combat damage first, each attacker by its controller | `attackingTeamAssignsDamageFirst` | C | passes; `attacking-player-is-first-seat` |
| 805.5b | the team passes once both partners pass: after Red acts, White passes before Yellow's team | `theTeamPassesOnceBothMembersPass` | B | **FAILS** (known-failing): passes go Red, Yellow, Blue, White |
| 805.5b | after resolving, the active team gets priority | `theActiveTeamGetsPriorityAfterResolving` | B | passes (the level 1 order already gives this) |
| 805.4a | a pass-until stops in the team's turn for the partner's slot | `fastForwardStopsOnThePartnersSlot` | B (harness) | passes; `active-team-is-first-seat` |

Not tested yet (choices or rare cases, to add when B or C reach them): 805.2 the primary player settles a team disagreement; 805.3a/b team mulligans and pregame actions; 805.7 the active team orders all its triggers before the other team; 805.9 "the active player" means one chosen player; 805.10e "defending player" for an attacker; the 805.8 extra phase or step.

## Protocol fixture (track D)

`tests/golden/fixtures/2hg-level2-protocol.json` follows the shape of `battle-live.json`, with a seat added to each entry:

- `{ note }`: a script marker.
- `{ seats: [a, b], step, board: { gameView } }`: one board per team. Partners see each other's hands (CR 810.5), so both seats of a team get the same view.
- `{ seat, step, prompt: { decidingPlayerId, input, promptId } }` and `{ seat, answer: { promptId, type, output } }`.

The script covers three turns:

1. Team 1 (White and Red) is the starting team. It has no draw step (810.6), and each partner plays a land, so White is asked again after Red acts. Both of team 2 then pass.
2. Team 2 gets the next turn (805.4) and both partners draw (805.4b).
3. Team 1 again, with both drawing:
   - White declares her Bears at Yellow, and Red declares her Juggernaut (`mustAttack: true`) at Blue: one combined attack.
   - Yellow and Blue are each asked to block, and each may block either attacker. Blue's Hill Giant blocks the Bears that are attacking Yellow.
   - Juggernaut's damage comes off team 2's shared 30.

The fixture proposes two `gameView` fields. They are not yet written by `InteractiveSnapshotExtractor`, and B's or D's work decides them:

- `activeTeamIds`: the active team's seats, first seat first. `activePlayerId` stays the first seat.
- `priorityTeamIds`: the team that has priority. `priorityPlayerId` is the member being asked.

`teamRules.rule` is `"sharedTurns"`, and the extractor already writes that.

Once B and C land, record a real game over the same script (a live check in the style of `tests/live_battle_check.js`, four seats) and replace the hand-built file, keeping its shape and changing `status` to `"recorded"`.
