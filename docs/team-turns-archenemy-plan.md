# Build plan: real shared team turns (2HG/3HG level 2) and Archenemy schemes

Written 2026-11-16. Research only. No code was changed, TTS and Docker were not touched.

How "verified" is used here:
- **Read** means I read the code or doc named. Paths are under `tmp/eb-1117b` unless said otherwise. That tree is the
  newest engine source (Forge in `forge/`, our harness in `forge-harness/`, the Rust node and protocol in `manabrew-rs/`).
- **Not run** means nothing here was executed. No tests were run for this plan.
- Hours are estimates and include tests and break-it proofs.

## 0. Summary

1. **Feature 1 is mostly built already.** The brief says partners take back-to-back turns today. That is the live
   deployed engine (`engine1116-teams3`). The newer source in `tmp/eb-1117b` already has the shared team turn in Forge, the
   joint team block, and bridge and table code. None of it is built into an image, deployed or live-checked.
   What is left is build, prove, play, fix, deploy. About 30 to 45 hours, mostly live work.
2. **Feature 2 is a fresh build, but Forge does the hard part.** Forge has schemes, set in motion, ongoing schemes,
   abandon, the scheme deck zone and the Archenemy first-turn rule. Our harness, protocol path, bridge and table
   carry none of it. About 45 to 60 hours.
3. **Order:** finish and deploy Level 2 first. Then Archenemy. Reasons are in section 3.

## 1. Feature 1: real shared team turns (CR 805)

### 1.1 What Forge already does

All of this is in the `eb-1117b` tree (also in the published `engine/forge.patch`, regenerated 2026-11-16 01:42, 30 mentions of
`sharedTeamTurns`). Read, not run.

- **A rules flag.** `GameRules.sharedTeamTurns` (`GameRules.java:15, 95-98`). The harness sets it from
  `teamRules: "sharedTurns"` (`ManaBrewEngineAdapter.configureTeamRules`, line 415). It sits on top of `sharedTeamLife`.
- **The team's turn.** `PhaseHandler.isPlayerTurn` is true for every member of the active team (`PhaseHandler.java:124-125`).
  `getActiveTeam()` (line 134) is the member list. Untap, upkeep, draw, discard, cleanup, and the other steps loop over
  the team (38 uses in `PhaseHandler`, plus `Untap`, `Combat`, `CombatUtil`, `Trigger`, `MagicStack`, `Game`,
  `CardProperty`, `SpellAbilityEffect`).
- **Next turn goes to the next team.** Extra turns, skipped turns and skipped steps are the team's (805.8).
- **First draw.** Only turn one of the starting team skips the draw (line 365: `turn - extraTurns <= (shared ? 1 : team size)`).
- **Priority and trigger order.** The team passes once both members pass. The active team orders all its triggers first.
  The primary player (`GameAction.teamLead`) orders them (805.5, 805.7).
- **Combined attack and block.** Each member declares their own attackers. The team's attack is checked as a whole.
  The defending team blocks together (805.10). A defender may block a creature attacking a partner.
  Joint block: each defender is asked in turn, asked again after the partner changes the block, stops at "no change",
  and after 4 revise rounds the primary player's answer stands (`docs/handoff/team-block.md`, 805.2).
- **Mulligans and pregame actions** go to the starting team first.
- **Tests that exist:** `SharedTurnsTest` (about 28 checks, 1131 lines) and `SharedCombatTest` (about 20 checks, 783
  lines) in `forge-harness/src/test/java/forge/harness/host/`. They cover untap, draw, discard, next turn, extra turns,
  skipped turns, team triggers, must-attack, team block, damage order, priority, trigger order, mulligans, defending
  player, and the life house rule inside a shared turn. No test run is recorded in `docs/engine-changes.md` for them.
- **AI:** one Forge AI file is changed, `AiBlockController` (it leaves an attacker its partner already blocks). The
  attack AI is not touched. `SharedCombatTest` has `anAiSecondAttackerKeepsItsPartnersTaxedAttacker` and
  `twoAiPartnersAgreeWithinTheCap`. A full AI-played shared-turn game is not recorded anywhere I read.
- **Still not in Forge:** 3HG numbers beyond the formulas (life `30 + 15 x (n-2)`, poison `15 + 5 x (n-2)`, these exist in the
  harness); disagreements by 805.2 other than the block cap; a team mulligan consult; day/night by team (502.2a) was not
  checked.

### 1.2 What the other layers have

| Layer | State (all read) |
|---|---|
| Harness | `TEAM_RULES_SHARED_TURNS`, validation, snapshot `teamRules.rule = "sharedTurns"` (`InteractiveSnapshotExtractor.java:486`), `PriorityFastForward` knows the team turn (2 uses). |
| Joint block prompt fields | `title`, `reviseRound`, `currentAssignments`, `teamBlockLines` on the existing `chooseBlockers` prompt (spec §5.12). |
| Protocol and node | `gameConfig` already carries `teamRules` as a free string. The relay allow-list already passes `gameConfig`. No protocol change was needed for `sharedTurns`. Not run on a built image. |
| Bridge | `bridge/teams.js` has `sharesTurns`, `turnPlayerIds`, `isTurnOf`, joint block, trigger-order words. `gameConfig` sends `sharedTurns` when teamMode is 2hg and turns is "shared". Spec §5.11 says "shared" is now the default (`mtg 2hg turns own` goes back to Level 1). |
| Table | `engineMyTurn`, team-turn phase bar, both partners attack, the Agree/Done corner button, `engineTeamDeclaring`. Built against the fake TTS only. |
| Tests | `tests/test_bridge_2hg_level2.js`, `test_bridge_2hg_team_block.js`, `test_table_2hg_level2.js`, `test_table_2hg_team_block.js`, `tools/mutate-team-block.js`. They run on **hand-built fixtures**, not recorded engine output (`tests/golden/fixtures/2hg-level2-protocol.json`, `2hg-team-block.json`). `tests/live_2hg_check.js` is Level 1 only (it sends `sharedLife`). |

### 1.3 What is missing

1. **No image.** `engine1117-cap` in the changes log says "not built yet". It stacks: Level 2, the joint block, the
   25,000 runaway cap, the rewind draw-count fix, and the turn-counter rewind fix. All in one pending image.
2. **No live proof.** No `live_2hg_level2_check.js`. The engine's real field names (`activeTeamIds`, `priorityTeamIds`)
   are guessed by the bridge, which falls back to the `teamNumber` of the active player. Recorded fixtures do not exist.
3. **No full game.** Nobody has played a shared-turn game to the end with Forge AI partners, or with a human partner.
4. **Rewind (Undo).** The session saves extra-turn state by reflection (`ExtraTurnState`). The new per-step fields
   (`teamStepPlayer`, the team's draw loop state) are not in that list that I read. Rewind in a shared turn is untested.
   The same goes for Mindslaver and fast-forward holds in a team turn.
5. **Forge AI as a partner in a shared turn.** The attack AI plans for one player. The spec (§5.4 item 6) called this
   the biggest unknown (10 to 30 hours). Only block-side tweaks and two unit tests exist.
6. **Real TTS look.** The table work was seen on the fake TTS only.
7. **Rules gaps left out on purpose:** 805.2 disagreements other than blocks, team mulligan consult (805.3a),
   810.9d member picks. All were written down as "not built".
8. **3HG.** Needs the six-seat table (spec §7, un-parked 2026-11-15). Engine formulas are done. Table and bridge are not.

### 1.4 Risks

- **Default flip.** `ENGINE_TEAM_TURNS` defaults to "shared". The moment `engine1117` is deployed, every 2HG start is
  Level 2. If Level 2 has a bug, all 2HG games hit it. Fix: deploy only after the live check, and keep
  `mtg 2hg turns own` as the escape (check it still works on the new image).
- **Turn-state spread.** 38 `PhaseHandler` call sites plus the AI's 122 `isPlayerTurn` uses (counted in the spec on
  2026-11-13). A call site that still thinks "one active player" gives wrong behaviour only in odd cards (extra combat,
  "each opponent's upkeep", delayed triggers, "your next turn"). Tests cover the common ones, not the long tail.
- **Delayed and "until your next turn" effects** in a shared turn. Not covered by a named test I read.
- **A stuck priority loop.** A change like this can leave priority going round for ever (the Planechase bug looked like
  this, `docs/engine-changes.md` section 2). The runaway cap is the only net. Watch for the "5001 triggers" draw.
- **Hidden regressions in Level 1 and free-for-all.** The flag gates it, but the same functions are used. Run the whole
  harness suite, not only the two new classes.
- **Stacked image.** One image carries five changes. If the live check fails, finding which change broke it is harder.
- **Hand-built fixtures can lie.** Tests that pass on guessed field names can fail on the first real game.
- **Forge AI partner.** It may declare attackers that ignore its partner's attackers (bad plays, not rule breaks).

### 1.5 Build plan (step by step)

Each step names its test and its break-it point.

| # | Step | Test | Break it | Hours |
|---|---|---|---|---|
| 1 | Read the pending patches against `eb-1117b`. Confirm `engine/*.patch` match the tree (hash check). Build the node image with a new tag (~20 min, one docker build at a time). Rebuild the relay only if protocol files changed (the log says node-only). | Image builds; `engine/checks/harness-tests.sh` compiles. | n/a | 3 |
| 2 | Run the whole harness suite in the `mtg-harness-test` container: `SharedTurnsTest`, `SharedCombatTest`, `TeamGameTest`, `PlayerRulesTest`, and every other class. | All green. | Remove one hunk at a time (turn loop, draw loop, `isPlayerTurn`, joint-block cap, first-draw rule); the named test must fail. The cap loop needs a timeout so it reports a name, not a hang. | 4 |
| 3 | Add checks for the long tail: "until your next turn", delayed triggers, extra combat, a rewind inside a shared turn, a concede mid-turn, a partner leaving mid-turn, and 3 per team (a 6-player test needs no table). | New tests. | Revert the matching fix; the test fails by name. | 6 |
| 4 | Rewind: put the shared-turn fields into `SavedState` (like `ExtraTurnState`), list them in `reflect-config.json`. | `RejoinRewindTest`-style test: rewind after the partner declared. | Remove the copy; test fails. | 3 |
| 5 | Write `tests/live_2hg_level2_check.js` from `live_2hg_check.js` (4 seats, `sharedTurns`). Check: both partners untap/draw once, both declare attacks, one block round, trigger-order question goes to the team lead, turn passes to the other team. Run it with `tools/live-check.sh <tag>`. | 100% of checks. | Send `sharedLife` instead; the check must fail (Level 1 contrast). | 5 |
| 6 | Record real prompts and views from step 5 as fixtures. Replace the hand-built ones. Fix the bridge's `activeTeamIds` / `priorityTeamIds` guesses. Re-run the 4 bridge/table tests and `mutate-team-block.js`. | Goldens pass on real data. | Existing mutation scripts. | 4 |
| 7 | One full game: host + 3 Forge AI, with the game log. Then a second with one AI team. Fix AI problems. Fallback if the AI is bad: a human-only partner rule in the bridge (AI on its own team, two humans per team). | Game ends. No stuck prompt. No "5001 triggers" draw. | n/a | 6 to 15 |
| 8 | Deploy with `node tools/deploy.js --image <tag>` (TTS closed, no game running). Keep `engine1116-teams3` as rollback. Log the entry in `docs/engine-changes.md`. | Deploy gates pass. | Roll back once to prove the rollback works. | 2 |
| 9 | Real TTS table check (screenshots with `tools/tts-shot.ps1`): team phase bar, both partners' attack lines, Agree/Done button, trigger-order panel, panel height with 3+ attackers (§5.12 "needs a live check"). | Screenshot after every UI edit. | n/a | 4 |
| 10 | A real game with a friend on one team. | Played to the end. | n/a | 3 |

**Total to ship Level 2: about 40 hours** (range 30 to 45 hours, mostly step 7).

Add-on, not part of the ship: **3HG** (spec §8.3): 14 hours on top, but it needs the six-seat table (spec §7, about 50 hours).

### 1.6 Open questions for the user

1. Is `engine1117-cap` allowed to ship as one image, or should Level 2 be its own image first? One image is faster.
   Two images give a cleaner rollback.
2. If the Forge AI plays shared turns badly, do you accept "AI only on its own team, two humans per team" for
   Level 2, or must it work with an AI partner?
3. Should `mtg 2hg turns own` stay as a host switch after Level 2 ships?
4. 3HG: wait for the six-seat table, as the spec says?
5. Who is the primary player (805.2)? The spec says the rightmost seat from the team's view (White and Yellow by
   default). It was never checked on the real table. Please look when you test.

## 2. Feature 2: Archenemy schemes

### 2.1 What Forge already does

All read in `forge/forge-game` unless said otherwise. Not run.

- **Game types.** `GameType.Archenemy` and `ArchenemyRumble` (`GameType.java:42-43`). Deck section `Schemes`
  (`GameType.java:162`). `ZoneType.SchemeDeck` is part of the command zone (`ZoneType.java:26, 38`).
- **The scheme deck.** `RegisteredPlayer.forVariants(..., schemes, playerIsArchenemy, ...)` gives the Archenemy 40 life and the scheme
  list (`RegisteredPlayer.java:151-161`). `Player` builds and shuffles the `SchemeDeck` zone (`Player.java:3211-3221`).
  Only a player with a non-empty scheme deck counts as the archenemy (`Player.isArchenemy`, line 272).
- **Set in motion each turn.** At the start of the precombat main phase, the active archenemy sets the top scheme in motion
  (`PhaseHandler.java:441-443`). `Player.setSchemeInMotion` (line 276) runs the `SetInMotion` replacement, moves the
  scheme to the command zone, and fires the `SetInMotion` trigger (`TriggerSetInMotion`). Cards can also set schemes in
  motion (`SetInMotionEffect`). "Can't set schemes in motion" for an extra turn exists (`ExtraTurn.java:42-109`).
- **Non-ongoing schemes leave.** A state-based action puts a non-ongoing scheme back on the bottom of the scheme deck
  when it is not on the stack (`GameAction.stateBasedAction_Scheme`, line 1806).
- **Ongoing schemes stay and can be abandoned.** `AbandonEffect` moves the scheme to the scheme deck and fires the
  `Abandoned` trigger (`TriggerAbandoned`).
- **Archenemy goes first** (`GameAction.java:2475`, rule 904.6). Our `goesFirst` house setting already does it too.
- **Teams in Forge's own lobby:** archenemy on team 0, everyone else on team 1, own turns, own life
  (`GameLobby.java:141, 341-343`). Team code is generic, so 2 to 5 opponents work.
- **Card scripts.** Scheme cards are scripts in `forge-gui/res/cardsfolder` (`Types:Scheme` and `Types:Ongoing Scheme`,
  for example `y/your_fate_is_thrice_sealed.txt`). I did not get a full card count: the search timed out. There are
  well over a hundred scheme cards across the Archenemy products.
- **AI.** `AiController` has logic that stops the AI wasting an abandoned scheme (line 2179). I found no other
  scheme-specific AI code. An AI archenemy sets schemes in motion because that is a turn-based action, not an AI choice.

### 2.2 What is missing, layer by layer

| Layer | Missing |
|---|---|
| Harness (`ManaBrewEngineAdapter`) | `startGame` calls `forVariants(playerCount, variants, deck, null, false, planes, null)`. Schemes (the `null`) and `playerIsArchenemy` (`false`) are never passed. `variants` has no `GameType.Archenemy`. `resolveGameType` only knows Commander, Oathbreaker, Brawl, Constructed. `PlayerConfig` has `planes` but no `schemes`. `buildDeck` ignores a schemes section. A `Schemes` helper like `Planechase.planarDecks` is needed (look up scheme cards by name, check the deck). |
| Harness view | `activeSchemeNames` is sent today (`InteractiveSnapshotExtractor.java:435, 464`) as names only. Missing: card ids and card DTOs for the schemes in motion and ongoing ones, the scheme deck size, the abandoned pile, "the last scheme set in motion" (for a banner). The controller's `SchemeDeck` handling at line 1520 is only for ordering. |
| Harness rewind | `GameSnapshot` copies neither `Game.activePlanes` nor plane lists (so Planechase turns restore points off). Whether it copies the scheme zones is not checked. Assume it does not, and plan to test it. |
| Node (`java_backend.rs`) | `PlayerConfig` (line 3081) has `planes`, no `schemes`. `with_deck_sections` (line 3195) copies planes but not `deck.schemes`. The protocol `Deck` already has `schemes` (`deck_dto.rs:445`) and the game view already has `active_scheme_names` (`protocol/game/mod.rs:437`, `game_view_dto.rs:888`). So no protocol change is needed for the deck. A `variant: "Archenemy"` string or a `gameConfig` field is needed to switch the game type on. |
| Relay | The deck passes as part of the room's player deck (the Planechase spec marked this hop "not traced", section 4). It must be traced for schemes too. Rebuild only if `gameConfig` needs a new allowed field (it passes `teamRules`, `players[]`, and extra optional fields are node-side). |
| Bridge | No scheme anywhere in `bridge/*.js`. Needed: a mode or team mode, setup chat commands, the scheme card list (like `forge-planes.json`), the deck choice and check, board fields, scheme prompts (set in motion may ask the archenemy to choose targets), and the game-over words. |
| Table | Nothing for schemes. Needed: where a scheme in motion sits (centre, large, like the plane), an "ongoing" row, a scheme deck pile with a count on the Archenemy's mat, a "SET IN MOTION" banner, card images for scheme cards. |

### 2.3 Design choice: build it on the Juggernaut path

Juggernaut already sends per-player `startingLife`, `startingHand`, `goesFirst`, `perks` and teams (1 vs many) through
`gameConfig` (spec §6.1, `bridge/teams.js` `juggOf`, `gameConfig`). An Archenemy game is that shape plus a scheme deck:
the Archenemy alone on team 1 with 40 life and goes first, everyone else on team 2 with own life and own turns.
The Juggernaut's extra draw and extra land are not part of Archenemy, so the Archenemy's perks list is empty.
Recommended: a fourth team mode `archenemy` in `TEAM_MODES`, with `rule: "teams"`.

Alternative: make Archenemy an option inside Juggernaut ("Juggernaut with schemes"). It is smaller but mixes two modes
that have different rules (the Juggernaut's 80 life and 10 cards versus the Archenemy's 40 and 7). Not recommended.

Alternative engine path: set `GameType.Archenemy` in `variants` and pass `playerIsArchenemy = true` for the Archenemy only.
`forVariants` then sets 40 life and the scheme list. Note: with Commander also in `variants` the life becomes 60
(`start.getStartingLife() + 20`). Override through the existing per-player `startingLife`, which is applied afterwards
(`configurePlayer`). Needs a test.

### 2.4 Risks

- **`isArchenemy()` depends on the scheme deck size** (`Player.java:272`). If every scheme is on the table (a small
  deck with ongoing schemes), `getZone(SchemeDeck).size() == 0` and the Archenemy stops setting schemes in motion.
  Forge's normal flow shuffles abandoned schemes back, so it is rare, but a 20-card test deck with many ongoing
  schemes could hit it. Fix is a small Forge change: remember the Archenemy flag on the player. Test it.
- **Scheme card images.** Scheme cards are oversized landscape-ish cards. Image source, aspect ratio, and the card
  back for the scheme deck need checking. The table already draws planes at 1.5 scale (`engine-renderer.lua:596`), so
  there is a pattern, but images for schemes are not in `bridge/forge-cards.json` (I did not check; the plane list had to
  be built separately by a tool).
- **Table space.** The centre is used by planes, the stack and attack lines. A scheme plus ongoing schemes need
  somewhere that does not cover them.
- **Rewind.** Probably not covered, like Planechase. If so, restore points go off in a scheme game (as Planechase does).
  The user may not like losing Undo.
- **Card scripts that need choices** (target a player, choose a creature, reveal cards). Each is an engine prompt the
  bridge and table already handle for other cards, but some scheme effects are unusual (set another scheme in
  motion, abandon, rolling dice, draw from another player's deck). A spike must play many schemes.
- **Rules not checked by me.** I did not have the Comprehensive Rules file open for rule 904. These are from memory and
  must be read before building: the Archenemy's starting life (40), who goes first, whether the Archenemy skips their
  first draw, how the opposing team takes turns (Forge's own lobby uses own turns), what happens when the scheme deck
  empties, and the scheme deck size and copy limits. The spec's way of working is to read the CR file first (spec §0).
  Rule 904 was not in the spec's "rules used" list (spec "Sources").
- **Win and loss.** With `teams`, a team wins when the others have lost. Check the 904 text for "the archenemy's
  teammates" and for the Archenemy conceding.
- **AI quality.** An AI Archenemy is fine for turn-based set-in-motion. An AI opponent facing ongoing schemes is not
  specially handled (not a rules risk).
- **Interaction with Juggernaut, 2HG and Planechase.** Keep Archenemy as its own mode. Do not combine with 2HG. Planechase
  plus schemes should work (both are command-zone decks) but needs one test.
- **Public repo.** If scheme art or card lists come from a new source, check the licence note in the repo's release
  checklist.

### 2.5 Build plan (step by step)

| # | Step | Test | Break it | Hours |
|---|---|---|---|---|
| 0 | Read CR 904 from the current Comprehensive Rules file and write down the real rules in this doc. | Decisions list matches the text. | n/a | 1 |
| 1 | Node: add `schemes` to `PlayerConfig` and `with_deck_sections` (one block, like planes). Add `archenemy` to `GameConfigPlayer` or send `variant: "Archenemy"`. Rust unit test. | `cargo test` for the node crate. | Drop the copy; test fails. | 3 |
| 2 | Harness: `Schemes.schemeDecks(...)` (lookup, deck rules), `variants` gains `Archenemy`, pass `playerIsArchenemy` and schemes into `forVariants`, `resolveGameType` unchanged. Refuse a start with no Archenemy, two Archenemies, or an invalid scheme deck. | New `ArchenemyTest`: 40 life, first turn, scheme in motion at main 1 each turn, non-ongoing goes to the bottom, ongoing stays, abandon, trigger fires, team wins and loses. | Remove each of: variant, flag, scheme list; each test fails. | 8 |
| 3 | Forge patch: make `isArchenemy` stable when the scheme deck is empty. | Test with all ongoing. | Revert; test fails. | 2 |
| 4 | Harness view: per player `schemeDeckSize`, scheme card DTOs (in motion and ongoing, with ids), `lastSchemeSetInMotion` with a sequence number (like `planar.last`). Typed output as the AGENTS rules require; regenerate protocol types (the three regens). | `InteractiveSnapshotExtractorTest` plus a new case. | Remove field; test fails. | 4 |
| 5 | Spike (`tests/live_archenemy_check.js`, from `live_planechase_check.js`): play every scheme card Forge knows, in batches, with AI and a debug-set top card. Fix what breaks (card lookup, prompts, AI). | Spike passes. | n/a | 8 |
| 6 | Rewind check: does `GameSnapshot` restore scheme zones? If not, either copy them (Forge patch) or turn restore points off like Planechase. | Test or a refusal test. | n/a | 3 |
| 7 | Build the image (new tag), run the whole suite, deploy later with section 3's order. | As in 1.5 steps 1, 2. | n/a | 3 |
| 8 | Bridge: `archenemy` in `TEAM_MODES` (Commander or Standard per answer 1), `mtg mode archenemy`, `mtg archenemy <colour>`, `mtg schemes random [N] | <name>; ...` (a `forge-schemes.json` from a tool like the plane list), a scheme deck check, `gameConfig` entry for the Archenemy (40 life, `goesFirst`, team 1), game-over words, the board's `archenemy` block, scheme prompts. Goldens and mutants in `tools/mutate-team-modes.js` style. | `test_bridge_golden`, new `test_bridge_archenemy.js`. | Mutation script. | 10 |
| 9 | Table: scheme in motion at the centre (large, turned to the Archenemy), ongoing row near the Archenemy's mat, scheme deck pile with a count, "SET IN MOTION: <name>" banner, button on the setup tile. Screenshot after every UI edit. | `test_table_archenemy.js` on the fake TTS, then real TTS shots. | Mutation script. | 12 |
| 10 | Card images for schemes (source, size, back). | A card shows on the table. | n/a | 3 |
| 11 | Live game: host + 3 AI, Archenemy deck, play 10 turns. Then with friends. | Game logs, no stuck prompt. | n/a | 5 |

**Total: about 60 hours** (range 45 to 60 hours). Steps 1 to 4 are about 20 hours and give a headless engine. Steps 8 to 10
are the table, about 25 hours.

### 2.6 Open questions for the user

1. **Game mode:** Archenemy in Commander (40-card commander decks) or in Standard/60-card decks? Wizards' Archenemy is
   60-card. The Juggernaut is Commander only.
2. **Where do scheme decks come from?** Random from Forge's list (like `mtg planes random`), a pasted deck list, or the
   Archenemy preconstructed decks? Who owns the scheme deck: only the Archenemy's player?
3. **Life:** the Archenemy at the CR's 40, with the others at the format's life? Commander gives 40 each; do you want the
   Archenemy higher (for example 80, as the Juggernaut)? A house rule, like the 2HG numbers.
4. **Rewind:** is it fine if Undo is off in scheme games until scheme zones are made rewind-safe?
5. **Archenemy and Juggernaut together:** keep them as two separate modes? (Recommended.)
6. **AI Archenemy:** should an AI be allowed to be the Archenemy? (Fine for the engine; a spike must check it.)
7. **Card images for the scheme cards:** same image source as the rest of the project?
8. **Rule 904 differences:** if the rules text says something you dislike (turn order of the team, the archenemy's first
   draw), keep the rules or use house rules?

### 2.7 The user's answers (2026-11-16)

1. **Game mode: both.** Archenemy works in Commander and in Standard/60-card decks.
2. **Scheme decks:** random 20 from Forge's scheme cards by default (like `mtg planes random`), or the Archenemy pastes their own list. Only the Archenemy's player has a scheme deck.
3. **Life: house rule, double the format's life:** 80 in Commander, 40 in Standard (40 is also the rules' number there). The others play at the format's life.
4. **Rewind: off in scheme games at first.** Undo says it is not available in Archenemy games until the scheme zones are rewind-safe.
5-8. **Not asked; defaults taken:** a separate mode from Juggernaut; an AI may be the Archenemy (a spike checks it first); scheme images from the same source as the rest; rule 904 as written (turn order, the Archenemy goes first).

## 3. Recommended order and why

1. **Finish Level 2 first (about 40 hours).** The code exists. It is the larger risk because it is a default flip.
   It also blocks other things: 3HG waits on it.
2. **Archenemy second (about 60 hours).** It needs its own engine image and a lot of table work. It does not depend on
   Level 2, except that both touch `bridge/teams.js` and `TEAM_MODES`. Doing it second avoids merge pain in that file
   and keeps `engine1117` as the one thing being proved.
3. **Optional overlap:** steps 0 to 4 of Feature 2 are headless and low risk. They can run while Level 2 is in the
   live-check stage, but do not build both into one image until Level 2 has passed its live check. Build the Archenemy
   image on top of the Level 2 image, so the table never has to roll back across both.
4. Total for both: about 100 hours (range 75 to 105).

Shared setup for both: a new image tag per change, a rollback tag, one docker build at a time, an entry in
`docs/engine-changes.md`, patches regenerated with `engine/make-patches.sh`, deploy with TTS closed, no Java comments in
Manabrew code (`AGENTS.md`).

## 4. Files read

- `docs/game-modes-spec.md` (§1 to §6.1, §8, §9, §12), `docs/engine-changes.md` (§1 to §3, headers), `docs/handoff/team-block.md`,
  `docs/planechase-dungeon-engine-spec.md` §3.5 and §4.
- `engine/forge.patch`, `engine/manabrew.patch` (grep for structure only).
- Forge: `GameRules`, `GameType`, `PhaseHandler`, `Player`, `RegisteredPlayer`, `GameAction`, `AbandonEffect`,
  `SetInMotionEffect`, `ExtraTurn`, `ZoneType`, `AiBlockController`, `AiController` (grep), `GameLobby` (grep), scheme card
  script `your_fate_is_thrice_sealed.txt`.
- Harness: `ManaBrewEngineAdapter` (startGame, team rules, game type), `Planechase` (template), `InteractiveSnapshotExtractor`
  (scheme names), test class names in `SharedTurnsTest`, `SharedCombatTest`, and the harness `AGENTS.md`.
- Node: `java_backend.rs` (`GameConfig`, `PlayerConfig`, `with_deck_sections`). Protocol: `deck_dto.rs`.
- Bridge: `bridge/teams.js` (`TEAM_MODES`, Juggernaut helpers), Planechase setup in `bridge/bridge.js`. Table:
  `tools/engine-renderer.lua` plane drawing (grep).

Not read in depth: the Rust engine crates (they are not the live engine), the table's Level 2 code, and the Forge attack AI.
