# Report: 2HG house rules, Team draws (toggle) and Team effects

Cloud session, 2026-11-15, branch `cloud/team-draws`. Every step of `docs/handoff/team-draws.md` is done, except building
and tagging a Docker image (there is no Docker here).

## Results

- **Harness:** all 19 classes pass with the new engine. That is the 18 classes of `engine/checks/harness-tests.sh` plus
  the new `TeamHouseRulesTest`. `TeamGameTest`, which holds the `teamLifeEvents` house-rule checks, passes all of its checks.
  Before the change, the same 18 classes passed.
- **SharedTurnsTest:** not on this branch. It exists only on `cloud/l2-tests` (level 2), and this branch is `main`, so
  it couldn't be run here.
- **Node:** `cargo build -p self-hosted-node` builds. The two new tests in `java_backend.rs` (`game_config_tests`)
  pass.
- **Bridge:**
  - With the engine's preset decks (`manabrew/public/preset_decks`) linked in, `tests/test_bridge_teams.js` passes
    49 of 49 and `tests/test_bridge_team_modes.js` passes 38 of 38.
  - Without them (this checkout has no `manabrew/`), the tests that drive a start through the relay stall after
    JoinRoom. That is 6 failures in the teams file and 5 in the modes file. Without the change the same relay tests
    fail too: 5 in each file. The teams file's sixth failure is the new start-to-relay test, which needs the same
    decks.
- **Patches:** regenerated with `engine/make-patches.sh` against a clean tree at the pinned commits.
  - `forge.patch` now has 456 files. The new ones are the 9 Forge files below; `GameRules.java` was already in it.
  - `manabrew.patch` now has 59 files. The new one is `TeamHouseRulesTest.java`; the harness adapter, its AGENTS.md
    and the node's `java_backend.rs` were already in it.
  - Both patches apply cleanly to fresh trees at the pinned commits.

## What was built

| Part | Change |
| --- | --- |
| Forge | `GameRules.teamDraws` and `teamEffects`, each counting only with shared team life.<br>`SpellAbilityEffect.withTeamPartners` and `withTeamPartnersCounted` add each named player's partners once, after the named players, and a player already named keeps their own count.<br>Team draws hooks: Draw, Scry, Surveil, Dig (library only, and the partner chooses from their own cards).<br>Team effects hooks: Discard, Mill, Sacrifice (the player branch only; "sacrifice this", echo and upkeep costs are untouched), Token (every token owner), PutCounter on players (not poison, not divided counters). |
| Harness | `StartGameRequest.teamDraws` accepts only a JSON boolean, so `"yes"` and `1` count as false.<br>`configureTeamRules` turns `setTeamEffects(true)` on in every shared-life game and sets `setTeamDraws(request.isTeamDraws())`. AGENTS.md is updated. |
| Node | `GameConfig.team_draws` (serde `teamDraws`, default false) is copied in `apply_game_config` and sent in `StartGameRequest` only when true. |
| Bridge | `teams.setupOf` reads the start message's `teamDraws` (only exactly `true` counts) for 2HG starts.<br>`startGame` stores it as `game.teamDraws`, and `gameConfig` adds `teamDraws` when `teamRules` is `"sharedLife"`.<br>2v2, Juggernaut and free-for-all payloads are unchanged. |

## Tests: `TeamHouseRulesTest`, 17 checks

Each category check runs three cases: shared life with Team draws ON, shared life with Team draws OFF, and a
free-for-all with no shared life, where nothing is shared. The game rules come from a real start request parsed by the
adapter and passed through `configureTeamRules`.

**Categories:**

| Check | Card | What it shows |
| --- | --- | --- |
| `drawIsSharedWithTeamDraws` | Divination | |
| `scryIsSharedWithTeamDraws` | Opt | |
| `surveilIsSharedWithTeamDraws` | Consider | |
| `lookingAtTheTopIsSharedWithTeamDraws` | Impulse | Red picks from Red's own cards. |
| `discardIsTheTeams` | Mind Rot | |
| `millIsTheTeams` | Thought Scour | |
| `eachOpponentSacrificesOnceEach` | Vona's Hunger | Each opponent sacrifices once, not twice. |
| `targetPlayerSacrificeIsTheTeams` | Diabolic Edict | |
| `youSacrificeIsTheTeams` | Ruinous Minotaur's "sacrifice a land" | |
| `youCreateTokensIsTheTeams` | Raise the Alarm | |
| `energyIsTheTeams` | Aether Hub's "you get {E}" | |

**Separate checks:**

| Check | What it shows |
| --- | --- |
| `requestReadsTeamDraws` | The request field is read strictly, and the rules stay off in free-for-all. |
| `theDrawStepIsNotShared` | |
| `costsAreNotShared` | Phyrexian Ghoul's sacrifice cost and Wild Mongrel's discard cost. |
| `manaIsNotShared` | Llanowar Elves. |
| `poisonIsCountedOnce` | Prologue to Phyresis, and a poison counter put on Yellow and on each opponent, each compared with a game without the house rules. |
| `aSharedDrawNeverSharesAgain` | Team draws ON with two Consecrated Sphinxes: White and Red each draw 2, and each Sphinx triggers 4 times. |

## Mutation table (`node tools/l2-mutate.js --local <tree> --set house`)

Each mutation must make its listed checks fail by name, and every file is restored and checked by sha256.

| Mutation | Result |
| --- | --- |
| none | ok, nothing fails |
| draw-not-shared | caught |
| scry-not-shared | caught |
| surveil-not-shared | caught |
| look-not-shared | caught |
| look-chosen-by-the-caster | caught (escaped on the first run; fixed, see below) |
| discard-not-shared | caught |
| mill-not-shared | caught |
| sacrifice-not-shared | caught |
| sacrifice-twice-for-each-opponent | caught |
| tokens-not-shared | caught |
| counters-not-shared | caught |
| poison-shared | caught |
| team-draws-ignores-the-toggle | caught |
| shared-copy-shares-again | caught (replaced after the first run; see below) |
| team-effects-off (harness) | caught |
| request-ignores-teamDraws (harness) | caught |
| request-teamDraws-any-truthy (harness) | caught |

**17 of 17 caught, 0 escaped** on the final run. The first run had two escapes:

- `look-chosen-by-the-caster`: the Impulse check only counted cards in hand, so it couldn't see that White was choosing
  from Red's library. The check now records who chooses from whose cards.
- `shared-copy-shares-again`: the first version of this mutation changed nothing, because another line still held the
  guard. I replaced it with a real break, where Red's shared draw shares back to White.

The costs, mana and draw-step checks have no hook to break. They guard against a future hook placed in the wrong spot.

## What the table must send

The TTS `t:"start"` message body (the JSON it already sends, with `teams`, `teamMode` and `juggernaut`) needs one more
boolean field:

```
{ ..., "teams": { ... }, "teamMode": "2hg", "teamDraws": true }
```

- Send it from the Team draws setup button's state. The default is false, and leaving the field out also means false.
- Only exactly `true` turns Team draws on. A string, a number or anything else counts as false.
- It is read only for 2HG. In 2v2, Juggernaut and free-for-all it is ignored.
- Where it would go: the start message is built in `tools/make-engine-copy.js`, around line 268 next to
  `engineTeamModeSent()` and `engineJuggSent()`. The setting would sit beside `ENGINE_TEAM_MODE` and `ENGINE_JUGG` in
  `tools/engine-renderer.lua`. Neither file was touched, since the button stays on the owner's PC.

## Open

- **Optional effects:** for "you may draw" (Rhystic Study) and optional scry or surveil, the partner is asked on their
  own. Their choice doesn't follow the first player's yes or no.
- **Effects not hooked:** these create tokens or give counters through their own effect classes, not `TokenEffect` or
  `CountersPutEffect`, so they are not shared:
  - Investigate, Amass and other effects with their own class;
  - energy from effects that don't use `PutCounter`;
  - poison from `DB$ Poison`, which is already the team's.
  - No Forge card script uses `PutCounter` with POISON on a player, so the two poison-counter cases in
    `poisonIsCountedOnce` use a hand-written ability line.
- **Wide "look at the top" sharing:** with Team draws ON, every `Dig` of a player's library is shared, including effects
  like Blightwing Bandit's.
- **Not updated:** HOW-TO-PLAY and `docs/game-modes-spec.md` don't describe the two house rules yet.
- **No image:** none was built or tagged. Building `engine1117-teamdraws` needs `engine/build-images.sh` on the owner's
  PC.
