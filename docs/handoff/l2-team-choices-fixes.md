# Review fixes: l2-team-choices (engine1127-teamchoices)

Branch `cloud/l2-team-choices-fixes`, on `cloud/l2-team-choices` (ac0dae3). The review found the rules right (CR 805.9,
805.10c, 805.10e: the controller of the spell or ability chooses the active, attacking or defending player) and asked
for these before merging.

## The fixes (Forge)

- **(a) A null card in `AbilityUtils.defendingPlayerFor`.** It read `card.getGame()` before its early return. It now
  returns `null` for a null card before reading anything.
  - The review's premise doesn't hold: `getDefendingPlayerRelatedTo(null)` throws on its own (`source.isAura()`), so
    the old code didn't return `null` for a null card either.
  - Today no reference reaches it with a null card: `getDefinedPlayers` takes the game from the card, so it fails at
    `game.getCombat()` first. The fix makes the method safe for any caller.
- **(b)** `PhaseHandler.teamChoices` is `transient`, like `pPlayerPriority` and `teamStepPlayer` beside it (and
  `final transient` like `extraTurns`).
- **(c)** `AbilityUtils.resolve` opens a resolution's choices only with shared team turns (`ph.isSharedTeamTurns()`).
  Every other game opens nothing.
- **Only stack abilities ask.** A spell or ability that resolves asks its controller. A static ability, a replacement
  effect or a cost check reads the default silently. `getActivePlayerFor`'s comment says so.

## Archenemy, against what the review asked

`hasSharedTeamTurns()` is **true** in Archenemy with engine1125's `teamRules` "teamTurns" (cloud/archenemy-team-turns,
904.2's shared team turns with each player's own life), which this branch is built on. So Archenemy's team choices ask
the controller among the opponents' team, which is right: 904.2 uses the shared team turns option, 805.9 with it. With
`teamRules` "teams" (own turns) it is false. The new check pins both.

## The new checks (`TeamChoiceTest`, 18 -> 31)

Each fails by name under its mutation in `tools/mutate-team-choices.js`.

| Check | What it pins |
|---|---|
| `fix aDefendingReferenceWithNoCardIsNull` | with own turns and with shared turns |
| `fix teamChoicesIsTransient` | |
| `fix noTeamChoicesOutsideSharedTurns` | none opened with own turns, one with shared turns |
| `fix aSubAbilityOpensNoChoicesOfItsOwn` | `sa.getParent() == null` |
| `fix aFailedResolutionStillClosesItsChoices` | the `finally` |
| `fix aKeptChoiceNoLongerOfferedIsAskedAgain` | `candidates.contains(before)` |
| `fix anAnswerOffTheListKeepsTheDefault`, `fix aNullAnswerKeepsTheDefault` | `answer != null && candidates.contains(answer)` |
| `fix theActivePlayerIsTheActivatorsChoice`, `fix domainActivePlayerIsTheActivatorsChoice` | ActivePlayer and DomainActivePlayer read the activator, `player`, not the host card's controller: Yellow activates Blue's card |
| `fix threeHg aTeamOfThreeIsOffered` | a 3HG active team of three offered whole |
| `fix aStaticCauseGetsTheDefaultSilently` | |
| `fix archenemy sharedTurnsOnlyWithTeamTurns` | |

## Results

- `TeamChoiceTest` 31 of 31.
- `tools/mutate-team-choices.js` 34 of 34 caught by name: the 21 before, one of them updated for the changed
  `resolve` line, and 13 new.
- Harness `--all` 54 of 54.
- **Patches:** `engine/forge.patch` (`AbilityUtils`, `PhaseHandler`) and `engine/manabrew.patch` (`TeamChoiceTest`)
  regenerated. No comments in harness Java. `git apply --check` is clean on `fd16e2f` / `e7d2b93b`.
- **Docs:** `docs/engine-changes.md`'s row has the fixes. `open-after-1124.md` and `open-after-1121.md` say the
  controller chooses, not the team.
