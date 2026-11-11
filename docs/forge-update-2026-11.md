# Forge update for Star Trek (TRK / TRC), 2026-11

Star Trek (TRK) and Star Trek Commander (TRC) release 2026-11-13. Our engine's Forge is the Manabrew fork
(witchesofthehill/forge `e7d2b93`, 2026-09-21) plus `engine/forge.patch`. This note is the plan, written before any
change, and the record of what came in.

## Where we start (measured 2026-11-06)

- The fork's last sync with Card-Forge is upstream `4b69361` (2026-09-21, "Detect attack-punisher enchantments by
  trigger instead of by name"), the merge base of `e7d2b93` and Card-Forge `master`. The fork adds 56 commits on top
  (48 Java files, perf and harness-facing fixes we rely on).
- Card-Forge `master` checked: `6d4a175` (2026-11-07 +0800, "FlatMC Trix and Channel update"). It is 1071 commits
  past the merge base, with 882 Java files changed (+75k/-9k lines; most of it the new FlatMC AI) and 2023 res files.
- Our tree: TRK edition file lists 91 cards and 92 TRK cards have a script; TRC lists 40. Upstream's TRK lists 311
  cards, all 311 scripted; TRC 337, all scripted (199 of them reprints we already have).
- So we lack 219 TRK and 138 TRC scripts, 10 of our TRK/TRC scripts are older than upstream's, and 8 token scripts
  are missing. Borg Queen, Perfection Manifest and the assimilate cards are among them.

## Options

1. **Card data + the Java those cards need.** Copy the missing/changed TRK/TRC card scripts, their token scripts, the
   two edition files and the creature types they use; port only the Java that the new scripts call and our Java lacks.
2. **Merge Card-Forge `master` into `e7d2b93` wholesale.** Everything upstream, including the 882 changed Java files.

Weighing them:

- `forge-harness` compiles against Forge's Java (`ManaBrewInteractiveController` / `DeterministicController`
  override `PlayerController`; `HarnessPlayPlumbing`, `ActionSpace`, `AutoPay` reach into `ComputerUtilMana`,
  `CostAdjustment`, `GameActionUtil`). Two months of upstream Java (the FlatMC AI rework touches `ComputerUtilMana`,
  `AiController`, `ComputerUtilAbility`) would very likely break it and change behaviour the table has been
  hand-tested against (27 decks, mechanic runs).
- `engine/forge.patch` (TriggerHandler plus 29 card fixes) must still apply. Option 2 conflicts in the fork's 56
  commits and in our patch; option 1 touches neither file set except where noted below.
- Option 2 would also have to be re-reviewed against the fork's own changes (lazy card loading, static caches), and a
  merge of that size is not something we could re-test in a day.

**Choice: option 1**, the smallest change that gives both full sets with working scripts.

## How the needed Java was found

- Every commit since the merge base that touched an imported card file was listed (423 commits); those with Java in
  them were read one by one.
- A vocabulary check (`vocab.js`, kept in the session scratchpad): every word in the imported scripts (ability
  parameters, `Count$` names, counter types, properties) that upstream's Java knows, as a string literal or enum
  constant, and ours doesn't. Hits: `Assimilate`, `PEACE`, `KeywordSource`, `SharesCardTypes`,
  `YouFaceDilemmaThisTurn`, `YourExtraTurns` (plus three false hits: `GE12`, `nonartifact`, `treasure`).
- Every `K:` keyword the imported scripts use exists in our `Keyword` enum (`Beam me up` was already there) or is an
  old-style keyword we already handle.

## What came in (pinned: Card-Forge/forge `6d4a175d9ef265ebe9a63eb60d73c312a5f1ae34`)

Data, copied byte for byte from that commit (file list in `engine/forge-trek-files.txt`):

- 357 new card scripts (219 TRK, 138 TRC), at upstream's path (356 in `cardsfolder/upcoming/`).
- 10 updated scripts, written over our copy in place (we keep our path, mostly `upcoming/`, where upstream has since
  moved some to letter folders; Forge finds a card by its `Name:` in any folder).
- 8 token scripts: murf, porthos, rg_2_2_worm_noblock, c_1_1_a_borg, c_3_3_a_illusion, neuroflux_heirloom,
  w_1_1_tribble_noblock, c_4_3_a_spacecraft_illusion_flying.
- `editions/Star Trek.txt`, `editions/Star Trek Commander.txt`, `editions/Stardates.txt` (SDS: TRK boosters draw from
  its sheet).
- `lists/TypeLists.txt` (upstream's is ours plus 32 types, additions only: Bajoran, Cardassian, Ferengi, Tribble, ...).
- `languages/en-US.properties`: one key, `lblDoYouWantEndCombat` (EndCombatPhase's new Optional question).

Java, ported by hand from these upstream commits (only the parts the cards need; nothing removed):

| upstream | what | files |
|---|---|---|
| 85888fd (+ master's versions of the new files) | `Assimilate` effect and its AI | ApiType, AssimilateEffect (new), SpellApiToAi, AssimilateAi (new) |
| 75b52d5 | `PEACE` counter (Peace in Our Time) | CounterEnumType |
| 434b1ef | Scotty: `KeywordSource` SA property, Beam me up `ValidSA`, cost reminder for a granted keyword | SpellAbilityProperty, StaticAbilityCantBeBeamedUp, CardProperty, KeywordWithCost, GameActionUtil |
| 0880b05 | `SharesCardTypes` count over a list (All Good Things . . .); the old `RememberedWithSharedCardType` is kept | AbilityUtils |
| 5c99e43 | `YouFaceDilemmaThisTurn` (Benjamin Sisko, The Caretaker) | Player, CharmEffect, AbilityUtils, GameSnapshot, GameCopier |
| 8fe7033 | `YourExtraTurns` (H.M.S. Bounty) | Player, PlayerStatistics, PhaseHandler, AbilityUtils |
| 3c3ef55 | TapPowerValue `Value$` as an amount (Sulu, Heroic Helmsman) | StaticAbilityTapPowerValue |
| baf062e | `Optional` on EndCombatPhase (review fixes for 5 TRK cards) | EndCombatPhaseEffect |

Left out on purpose: upstream AI commits that touched these cards only in passing (8c4a3ee, f9ba9b8), the
`formats/` files (the node never checks format legality), other languages' strings.

## How it is reproduced

`engine/forge.patch` is made by `engine/make-patches.sh` from the working tree as before, so it now also carries the
imported data and Java; `engine/build-images.sh` is unchanged (same fork commit + patches). The file list and the
pinned upstream commit above say where every imported file came from.

## Checks

- Every TRK/TRC card in the new edition files has a script: see the results below.
- A harness check loads every TRK/TRC card and its token scripts through Forge (`Card.fromPaperCard` parses every
  ability, trigger, static and replacement; an unknown API or mode throws).
- Live checks on the built images.

## Results

- Scripts: TRK 311 of 311 listed cards scripted (was 92), TRC 337 of 337 (was 199 of the 337, and 40 listed); none
  missing. Tokens: every token the two edition files list, and every `TokenScript$` the imported cards name, exists.
- `engine/checks/TrekCardsLoadCheck.java` (run in the `mtg-harness-test:trek` java-builder image against the built
  harness jar): `TRK: 311 of 311 cards loaded and parsed, 27 of 27 token entries`, `TRC: 337 of 337 ...,
  12 of 12`, `PASS`. Its non-enum keyword list is only Forge's old-style ones (`Chapter`, `ETBReplacement`,
  `etbCounter`, `AlternateAdditionalCost`, "CARDNAME can't attack alone.", "You may choose not to untap ..."), all
  used by older cards too.
- Forge prints `Upcoming set Star Trek (TRK) dated in the future`: until 2026-11-13 Forge files the set as upcoming,
  which is fine (the `upcoming/` folder is read because the harness reports a development build). Confirmed in the
  native node image: the node's log prints that line, and `tests/live_mindslaver_check.js` makes Borg Queen,
  Perfection Manifest (an `upcoming/` script) by name, casts it, and its assimilate puts an opponent's Grizzly Bears
  onto the battlefield under the Queen's controller as a Borg artifact creature (no longer a Bear) with a +1/+1
  counter.
- The harness compiled unchanged against the new Java; `OptionalCardChoiceTest`, `ManaBrewEngineAdapterTest`,
  `MindslaverControlTest`, `ExtraTurnRewindTest` pass. How to run them: `engine/README.md`, "Testing a build"
  (`engine/checks/harness-tests.sh` in a `--rm` container). `mtg-harness-test:trek` was built before `ExtraTurnState`
  and `ExtraTurnRewindTest` existed, so running the tests baked into that image does not reproduce this line; the
  script compiles the mounted tree's harness and tests against the image's Forge jar instead (an independent re-check
  did the same, 2026-11-09).
- Images (2026-11-07): `mtg-forge-node:trek` `d2b8b59eda17`, `mtg-relay:trek` `dbfe69213fff` (relay sources
  unchanged, so it came from cache). Live checks on them: `live_events_check` 51 of 51 (it needs a long timeout:
  three 120 s and one 360 s run timed out before Think Twice and Darkblast met in one hand; the deployed `forage` engine
  needed turn 48 for the same step), `live_phasing_check` 29 of 29, `live_mindslaver_check` 16 of 16,
  `live_extra_turn_check` 10 of 10; `rules-check --game dungeon` 10 of 10 (rewinds); `rules-check --game filter`
  passed what it reached (Skycloud Expanse's only change is a dropped `AI:RemoveDeck:All`).

## Review of our harness code (2026-11-09)

The review suite went over our own code in this batch only (the Forge ports stay copies of upstream):
`ExtraTurnState`, its place in rewind, `controllingSeat`, `extraTurnCount`, `reflect-config.json`, the tests and
`tools/live-check.sh`. What changed:

- **Rewind state in one place.** The four things a Forge snapshot misses (zone order, phased-out cards, dungeon progress,
  the extra-turn queue) were passed side by side through the checkpoint, its recording, `applyState` and two copies of the
  restore sequence. They are now one `SavedState` (`saveState` / `restoreState`), shared by a rewind and a refused fix.
- **Control is followed up the chain.** `controllingSeat` resolved one level: with A controlling B and B controlling C,
  C's questions went to B. It now follows the chain (A answers, since A makes every decision B would make), stops below a
  Forge AI (an AI cannot answer a prompt, so the last interactive seat keeps it) and stops at a seat it has already
  visited (two players controlling each other). `MindslaverControlTest` gained the nested, AI-topped, looping and
  no-player cases, and now checks the seat the answer is awaited from, not only the seat the prompt names.
- **`ExtraTurnRewindTest`** gained a rewind into an extra turn in progress, the only case where a saved extra-turn
  flag, played count or Forge count is not 0.
- **`tools/live-check.sh`:** the room wait is time-based (`LIVE_ROOM_WAIT`, default 60 s; it was 45 tries) and fails
  with the node's log tail instead of going ahead; only "room not found" is dealt again (a timeout or any other stop is
  now the check's result, so a check that depends on the deal needs a long `LIVE_TIMEOUT`, as `live_events_check`
  does); the relay defaults to `mtg-relay:<node tag>` and must be named when there is none; the script exits with the
  check's status.
- **The test recipe** above did not reproduce: see "Testing a build" in `engine/README.md`.

Checked after the review: a mutation pass (25 plausible careless edits to `ExtraTurnState`, the rewind hook,
`extraTurnCount` and `controllingSeat`) first let 9 through; the new test cases catch all but 2, both equivalent
programs (the extra-turn restore moved before the snapshot restore, which touches none of those fields; and always
re-formatting the seat id, which gives the same string for every id the session makes). The harness tests pass
(`harness-tests.sh` on a clean tree with both patches applied). `mtg-forge-node:trek` rebuilt from that tree:
`ef61822078a0` (the 2026-11-07 image is kept as `mtg-forge-node:trek-prev`). Live on it, with `mtg-relay:trek`:
`live_mindslaver_check` 16 of 16, `live_extra_turn_check` 10 of 10, `live_phasing_check` 29 of 29, `live_events_check`
51 of 51 on its second deal (the first timed out at 900 s with only `dredge` not yet seen, the deal dependence noted
above; it is no longer dealt again automatically).

Known and not fixed here:

- The AI always accepts the new Optional `EndCombatPhase` question (upstream Forge does the same).
- `isExtraTurn` stays true on a player until that player's next turn begins (stock Forge); the bridge reads it only for
  the active player.
- `PhaseHandler.extraPhases` (an extra combat added by an effect) is not kept by a restore point.
- An extra turn's delayed triggers (`ExtraTurn.getDelayedTriggers`) come back with the queue as the same objects; whether
  Forge's snapshot also unregisters ones that already fired after the point was not checked.

## Top-up from Card-Forge `2549d11` (2026-11-10)

Card-Forge `master` checked again: `2549d11cbc299960af3b9e942328839aca0c85f6` (2026-11-10, 81 commits past `6d4a175`).
The Star Trek edition files, tokens and `TypeLists.txt` are unchanged since `6d4a175`; most TRK/TRC script changes
are moves out of `upcoming/` with the same bytes. Four scripts got real fixes, each one line and no new Java; they are
copied byte for byte from `2549d11` over our copy in place (still in `upcoming/`, listed in `forge-trek-files.txt` with
upstream's new path):

| card | fix | upstream |
|---|---|---|
| Kirk, Commanding Officer | the destroy ability costs `2 Sac<...>` (ours had no {2}) | 723b215 |
| Dr. McCoy, Surly Surgeon | `ActiveZones$ Battlefield` on its replacement | 77e54cf |
| Cantankerous Captain | the pump targets `Creature.YouCtrl` (ours: any creature) | 311dd77 |
| Starfleet Communicator | `AttachedBy Valid Communicator` in its count | 9056e0c |

Left out on purpose: Spock, Always Your Friend and Rutherford, Upgraded Ensign (they only drop
`ForceRevealToController` after a DigEffect change, 45cd35c; ours still reveal), and Fevered Visions (a reprint, changed
for Two-Headed Giant, 54353f6).

Built `mtg-forge-node:trek2` (`7d14533e3b79`) from a clean tree with both patches; no protocol change, so the relay
stays `mtg-relay:exile`. Every file under `/build` in it matches `mtg-forge-node:exile` (`a8c9de3ee222`, the
2026-11-09 build) except the four scripts, which are upstream's. `TrekCardsLoadCheck` (in `mtg-harness-test:trek2`):
TRK 311 of 311, 27 of 27 tokens, TRC 337 of 337, 12 of 12, `PASS`; `harness-tests.sh`: all five classes pass.
