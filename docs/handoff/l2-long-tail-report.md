# Two-Headed Giant Level 2: the shared-turn long tail (plan §1.5 step 3)

Branch `cloud/l2-long-tail`, on top of `cloud/l2-team-choices` (ac0dae3, engine1126). Engine row:
`engine1127-longtail` in `docs/engine-changes.md`.

## What is covered now

New harness test `LongTailTest` (forge-harness, headless, no table), 17 checks, added to
`engine/checks/harness-tests.sh`. "Level 2" is shared team life plus shared team turns. "Team turns" is shared turns
with each player's own life, as in Archenemy's team. That is the only setup where one partner can leave alone.

| Area | Check | Setup |
|---|---|---|
| "until your next turn" | `cr805.4 untilYourNextTurnLastsUntilTheTeamsNextTurn`: Red's effect lasts through the other team's turn and ends when her team's turn begins | Level 2 |
| | `cr805.4 aPartnersUntilYourNextTurnEndsWhenTheTeamsTurnBegins`: Blue's (not the first seat) ends at her team's turn | Level 2 |
| | `cr800.4m aGonePartnersUntilYourNextTurnLastsToTheTeamsNextTurn`: Red leaves in her own team's turn; her effect lasts to her team's next turn | team turns |
| | `cr800.4m aGoneDefendersUntilYourNextTurnEndsAtItsTeamsTurn`: Blue leaves in the other team's turn; her effect ends when her team's turn begins | team turns |
| Delayed triggers | `cr805.4d theNextEndStepTriggersOnceForTheTeam`: "at the beginning of the next end step" fires once in the team's end step, and not again | Level 2 |
| | `cr805.4d yourNextUpkeepIsTheTeamsNextUpkeep`: White's and Red's "your next upkeep" each fire once in their team's next upkeep | Level 2 |
| | `cr805.4d theNextUpkeepTriggersOnceInTheOtherTeamsTurn`: "the next upkeep" fires once in the other team's upkeep | Level 2 |
| Extra combat | `cr805.8 aPartnersExtraCombatIsTheTeams`: Red's Relentless Assault gives the team two combats and two second main phases; both partners are asked to attack in each | Level 2 |
| Concede mid-turn | `cr800.4a theActiveTeamConcedingMidTurnPassesTheTurnOn`: at six seats (three teams of two), the active team concedes in its main phase; the game goes on and the turns go to the other two teams in order | Level 2, 3×2 |
| Partner leaving mid-turn | `cr800.4a aPartnerLeavingMidTurnLeavesTheTurnToTheOther`: Red leaves; White alone is active, priority goes White, Yellow, Blue, and later turns come back to White | team turns |
| | `cr800.4a theFirstSeatLeavingMidTurnLeavesTheTurnToThePartner`: White (the first seat) leaves; Red alone is active, may play a land, and the turns go on with Red | team turns |
| Three per team | `threes cr805.4 aTeamOfThreeUntapsAndDrawsTogether` | Level 2, 2×3 |
| | `threes cr805.4 theTurnAlternatesBetweenTeamsOfThree` | Level 2, 2×3 |
| | `threes cr805.4c eachOfThreeMayPlayALand` | Level 2, 2×3 |
| | `threes cr805.5b priorityGoesRoundAllThreeBeforeTheOtherTeam` | Level 2, 2×3 |
| | `threes cr805.10a allThreeDeclareAttacksInOneCombat` | Level 2, 2×3 |
| | `cr805.4 threeTeamsOfTwoTakeTurnsInOrder` | Level 2, 3×2 |

## Already covered (no new check)

- **A rewind inside a shared turn:**
  - `SharedTurnsPlayTest` `cr805.4 aRewindAfterThePartnerDeclaredKeepsTheTeamsAttack` and `cr805.5b aRewindToThePartnersPriorityPassesAsATeam`;
  - `TeamGameTest` `aRewindPutsTheTeamsLifeBackOnBothPartners`;
  - `CardStateRewindTest`'s two delayed-trigger rewind checks.
- **A concession ending a two-team game:**
  - `TeamGameTest` `concedingConcedesForTheTeam`;
  - `ThreeHeadedGiantTest` `cr810.8b aConcessionConcedesForAllThree`.
- **A player out between turns:** `ArchenemyTest` `cr904_2 aPlayerOutLeavesTheRestOfTheTeamItsTurn`.
- **An extra turn or step for a partner:** `SharedTurnsTest` `cr805.8 aPartnersExtraTurnIsTheTeams` and `aPartnersExtraStepIsTheTeams`.
- **Teams of three:** `ThreeHeadedGiantTest` covers life, poison, concession and the joint block of three. The new checks add the shared turn itself.

## Bugs found and fixed (Forge `PhaseHandler`, `engine/forge.patch`)

1. **CR 800.4m with shared team turns.** A player who leaves keeps their "until your next turn" effects until their
   turn would have begun. With shared turns, that is their team's next turn. `handleMultiplayerEffects` ended them as
   the turn order passed the player's seat:
   - a partner who left during her own team's turn lost them at the start of the other team's turn, one turn early;
   - a defender (not the first seat) who left kept them for a full turn past her team's turn.

   Now a gone player with a teammate still in the game is handled when that team's turn begins. With the whole team
   gone, the old seat walk stays. Without shared turns, nothing changes.

   Failing before the fix: `aGonePartnersUntilYourNextTurnLastsToTheTeamsNextTurn` and `aGoneDefendersUntilYourNextTurnEndsAtItsTeamsTurn`.
2. **CR 800.4a: the first seat leaving mid-turn.** `getActiveTeam` kept the gone first seat (the player whose turn
   Forge tracks) on the active team. Now it drops players who left; the turn goes on for the rest of the team.

   Failing before the fix: `theFirstSeatLeavingMidTurnLeavesTheTurnToThePartner`.

No protocol change and no Rust change.

## Break-it

`node tools/mutate-long-tail.js <engine tree>`: 14 of 14 caught by name, all files restored by sha256. Each mutation
lists the checks that must all fail. The script refuses to run if any `LongTailTest` check is named by no mutation.

| Mutation | Checks that fail by name |
|---|---|
| "until your next turn" ends for the first seat only | untilYourNextTurnLastsUntilTheTeamsNextTurn, aPartnersUntilYourNextTurnEndsWhenTheTeamsTurnBegins |
| "until your next turn" ends for every player each turn | untilYourNextTurnLastsUntilTheTeamsNextTurn |
| a gone partner's effects end as the turn passes her seat (fix 1 reverted, first half) | aGonePartnersUntilYourNextTurnLastsToTheTeamsNextTurn |
| a gone player's effects never wait for the team's turn (fix 1 reverted, second half) | aGonePartners…, aGoneDefendersUntilYourNextTurnEndsAtItsTeamsTurn |
| a step runs for the first seat only | yourNextUpkeepIsTheTeamsNextUpkeep |
| a delayed trigger kept after it fires | theNextEndStepTriggersOnceForTheTeam |
| a delayed step trigger fires on each member's run (team-run check off and trigger kept) | theNextEndStepTriggersOnceForTheTeam, theNextUpkeepTriggersOnceInTheOtherTeamsTurn |
| no extra phases | aPartnersExtraCombatIsTheTeams |
| only the first seat declares attacks | aPartnersExtraCombatIsTheTeams, allThreeDeclareAttacksInOneCombat |
| a gone player kept on the active team (fix 2 reverted) | theFirstSeatLeavingMidTurnLeavesTheTurnToThePartner |
| a gone partner kept on the active team (team walked over every seat, gone players not dropped) | aPartnerLeavingMidTurnLeavesTheTurnToTheOther, theFirstSeatLeaving… |
| the next turn goes to the next player, not the next team | theActiveTeamConcedingMidTurnPassesTheTurnOn, theTurnAlternatesBetweenTeamsOfThree, threeTeamsOfTwoTakeTurnsInOrder |
| a team is two players at most | aTeamOfThreeUntapsAndDrawsTogether, theTurnAlternatesBetweenTeamsOfThree, priorityGoesRoundAllThreeBeforeTheOtherTeam, allThreeDeclareAttacksInOneCombat |
| the partners' turn is not theirs | eachOfThreeMayPlayALand |

Some backups made a mutation survive, and the table pairs those edits instead:
- **Delayed triggers:** Forge removes a delayed trigger once it fires, and the team-run check (CR 805.4d) also stops a
  second fire. Either one alone keeps "the next upkeep" to one fire.
- **A gone partner in the priority round:** Forge's base player list already skips her, so switching off the
  in-game check alone changed nothing.

## Results

- Harness `--all`: 55 of 55 classes pass.
- `tools/mutate-team-choices.js` still catches 21 of 21.
- Gate output is the same as on `cloud/l2-team-choices`.
- Patches were regenerated with `engine/make-patches.sh`; `git apply --check` is clean on `fd16e2f` / `e7d2b93b`.

The rule text (CR 800.4m and 800.4a) was checked against rules mirrors found by search. The official CR could not be
fetched from the cloud session.
