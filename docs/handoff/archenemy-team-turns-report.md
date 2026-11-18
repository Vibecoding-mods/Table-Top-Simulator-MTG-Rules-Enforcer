# Report: Archenemy's team turns (CR 904.2)

Cloud session, 2026-11-18, branch `cloud/archenemy-team-turns`, from `origin/cloud/archenemy-six` (`792d6f2`). Engine
tag `engine1121-archenemyteamturns`, on top of `engine1121-archenemyaudit`. Not built as an image.

**The rule.** 904.2: an Archenemy game is Team vs. Team with the attack multiple players option and the shared team
turns option (805). So the archenemy's opponents take one turn together, as a Two-Headed Giant team does, but each keeps
their own life (805 has no life rule; shared life is 810's, Two-Headed Giant's). 805.1: the shared team turns option
needs each team's players in adjacent seats, which one archenemy against everyone else always gives.

**Before:** each opponent took their own turn, on four and six seats (`docs/handoff/archenemy-audit-report.md`, "left
open"). The setup words said "their own turns".

**Now:** Purple, then the five together, then Purple (six seats); Blue, then White + Red + Yellow, then Blue (four).

## How: the shared-turn machinery we have, no new path

**Engine.** Forge's shared team turns (`GameRules.sharedTeamTurns`, the 2HG Level 2 work: `PhaseHandler`'s team turn,
priority, combined attack and joint block, triggers, extra turns) already work for teams of any size: the turn passes
to the next team's first seat (`GameAction.teamLead`), and the team in turn order is everyone not an opponent. Only the
adapter tied it to shared life. So:

- **`teamRules` "teamTurns"** (`ManaBrewEngineAdapter.configureTeamRules`): shared team turns, no shared life.
  - Teams of any size, so one against three or five.
  - Each team's players must sit next to each other (805.1), the same check `sharedLife` already makes, now in
    `teamsSitTogether`. Otherwise: "teamTurns needs each team's players next to each other in seat order".
  - `sharedLife` and `sharedTurns` are unchanged.
- **Archenemy** accepts "teamTurns" (and "teams", own turns, still). It still refuses `sharedLife` and `sharedTurns`, now
  with "Archenemy plays with each player's own life, not …".
- **The board** (`InteractiveSnapshotExtractor.teamRules`) says `rule: "teamTurns"` for shared turns without shared life.
- **CR 805.10d under shared team turns.** Defenders may block creatures attacking any player on their team. That is a
  shared-turns rule, but Forge's checks read shared life (Level 1's team block). `GameRules.hasTeamBlocks()` is shared
  life or shared turns, and these now read it:
  - `CombatUtil.canBeBlocked`: Red may block the archenemy's creature attacking Blue;
  - the AI: `ComputerUtilCombat.blockingTeam` (in `AiBlockController`'s block order) and
    `AiAttackController.getOpponentCreatures`, so the AI blocks for a teammate and counts a teammate's blockers when it
    attacks.
  - With shared life the answers are as before (`hasTeamBlocks` is true there too). Life itself still follows shared
    life only (`sharedLifeTeam`), so an Archenemy opponent's "life in danger" is their own.
- **Kept as it was**, and correct here: 103.8's first draw. The 2HG skip needs shared life, and in Archenemy no one skips.
  The archenemy goes first (904.6).

**Bridge** (`bridge/teams.js`, `bridge/bridge.js`):

- Archenemy's `TEAM_MODES` rule is "teamTurns", so `gameConfig` asks for it in every Archenemy game.
- `sharesTurns(pub)` is true for "sharedTurns" and "teamTurns". Every shared-turn piece reads it as it reads 2HG
  Level 2, with no new code:
  - whose turn ("your team's", "White + Red + Yellow's");
  - the team's attack and block notes;
  - team triggers;
  - the table's `activeTeam`.
- `sharesLife` stays shared life only. The board's teams (`boardTeams`, `teamsField`) treat "teamTurns" as "teams" (the
  engine's own sides, each player's life) plus `turns: "shared"`.
- **The table's `activeTeam`** is sent only when the turn's team has two or more players. On the archenemy's own turn,
  a team of one, the table says "PURPLE'S TURN", not "TEAM PURPLE'S TURN".
- **The setup words:** "(40 life each, one turn together)".

**Table** (`tools/engine-renderer.lua`): no change. It already reads the board's `activeTeam` (the banner, attacking
and blocking, untapping, the priority line).

## Tests

**`ArchenemyTest`** (harness): 29 of 29. The fixture now applies the request's team rules. 12 new checks:

- `cr904_2 theOpponentsTakeOneTurnTogether`: four seats. After White (the archenemy), turn 2 is Blue + Red + Yellow
  together. Each is active, the archenemy isn't, and turn 3 is White's. With "teams", Blue alone.
- `cr904_2 sixSeats theFiveTakeOneTurnTogether`: the same with five.
- `cr904_2 eachOpponentKeepsTheirOwnLife`: shared turns without shared life. Blue loses 5: 15, 20, 40.
- `cr904_2 aPlayerOutLeavesTheRestOfTheTeamItsTurn`: Blue out, the game goes on and the team's turn is Red + Yellow.
- `cr904_2 theSchemeIsSetInMotionOnlyOnTheArchenemysTurn`: none on the team's main phase, one on the archenemy's next.
- `cr904_2 eachOpponentDrawsOnTheTeamsDrawStep` (805.4b): one card each for the three, none for the archenemy.
- `cr805_10d aDefenderMayBlockForATeammate`: Red may block a creature attacking Blue, and not with own turns.
- `cr805_10d theAiBlocksForATeammate`: Red's AI blocks the Grizzly Bears attacking Blue with its Hill Giant.
- `cr805_10d theAiCountsATeammatesBlockers`: the AI attacking Blue counts Red's Hill Giant, and not with own turns.
- `teamTurns aTeamThatDoesNotSitTogetherIsRefused`: teams 1, 2, 1, 2 refused by name; two seats accepted.
- `teamTurns theBoardSaysTeamTurns`, and "teams" with own turns.
- `teamTurns archenemyWithSharedTurnsIsRefused`.
- One existing check's expected text changed with the refusal's words ("own life", not "own life and turns").

**Headless** (`tools/headless-six.js`, now with `--seats 4`; the Archenemy game asks for "teamTurns"): real Commander
games through `ManaBrewEngineAdapter`.

- **The turn order check is team-aware:** after a turn, the next team's first seat; with own turns the old check, so
  own turns would now be a "seat order" problem.
- **Six seats** (`--archenemy --turns 7`):
  - 1:Purple, 2:White+Red+Yellow+Green+Blue, 3:Purple, 4:the five, … to turn 8;
  - no problems, no stall;
  - Purple attacked: Yellow at 11.
- **Four seats** (`--archenemy --seats 4 --games 2 --turns 9`), no problems:
  - game 1: 1:Blue, 2:White+Red+Yellow, 3:Blue, 4:Blue (an extra turn from a card), 5:the three, … to turn 10;
  - game 2: alternating to turn 10;
  - Red's and Yellow's AI seats played lands and spells, so they act on the team's turn, not only White.

**Goldens:**

- **Re-recorded** from the six-seat headless game (turns 1–7): `six-seat-relay-archenemy.json` and
  `table-stream-6p-archenemy.json`.
- **New** from the four-seat game 1 (turns 1–9): `four-seat-relay-archenemy.json` and `table-stream-4p-archenemy.json`.
  `tools/m6-stream.js --seats 4` replays a four-seat recording.
- **`tests/test_bridge_six_golden.js`:** 30 of 30. The Archenemy part's turn check now wants Purple, then the five
  together, and the teams' `turns: "shared"`.
- **`tests/test_bridge_archenemy_team_turns.js`** (new, in GATES): 14 of 14. The four-seat game, message by message
  against its recording, and:
  - the engine asked for teamTurns;
  - the setup words;
  - Blue at 80, the three at 40;
  - the teams with `turns: "shared"`;
  - the turns, with Blue's extra turn;
  - White the active player on the three's turns;
  - all three in every team board's `activeTeam`, and none on Blue's;
  - each keeping their own life;
  - schemes set in motion on Blue's turns only.
- **`tests/test_bridge_archenemy.js`:** 87 of 87. The rule, gameConfig and setup-words checks now want teamTurns. New
  unit checks on a "teamTurns" board:
  - the teams;
  - the winners;
  - `turnPlayerIds` on each side's turn;
  - partners, never the archenemy;
  - `turnWhose`;
  - own life.
- **`test_bridge_golden`:** 1084 scenarios, re-recorded. Only the 3 Archenemy starts changed: `teamRules` "teamTurns"
  and the setup words.

## Break-it (each fails by name, files restored by sha256)

- `node tools/mutate-archenemy-team-turns.js <tree>`: **11 of 11.**
  - teamTurns without shared turns;
  - teamTurns with shared life too;
  - teams not sitting together accepted;
  - Archenemy with shared life or turns accepted;
  - the board saying "teams";
  - the next turn the next player's, not the next team's;
  - `hasTeamBlocks` shared life only;
  - the block check back to shared life;
  - the AI's blocking team only itself;
  - the AI's block order leaving a teammate's attackers out;
  - the AI's attack counting no teammate's blockers.
- `node tools/mutate-archenemy-team-turns-bridge.js`: **7 of 7.**
  - Archenemy asking for own turns;
  - "teamTurns" not a shared-turn board;
  - the archenemy's turn sent as a team of one;
  - "teamTurns" boards without teams;
  - the teams not saying shared turns;
  - the setup words saying own turns;
  - "teamTurns" read as shared life.

## Gates

- **The full harness suite** (`engine/test-harness-local.sh --all`, on this branch's tree): 46 classes, all passed,
  `SharedTurnsTest`, `SharedTurnsPlayTest`, `SharedCombatTest`, `ThreeHeadedGiantTest`, `TeamGameTest` and
  `BigBoardFixesTest` among them. The 2HG / 3HG paths are unchanged by `hasTeamBlocks`.
- **Other break-its rerun:**
  - `tools/mutate-archenemy-audit.js`: 4 of 4.
  - `tools/mutate-archenemy-six.js`: 13 of 13.
  - `tools/mutate-archenemy.js`: 39 caught, 0 survived. Six of its mutations no longer applied, five of them already on
    the base (archenemy-six changed the code they aim at, which its report missed), and one more after this change
    (the rule). They now aim at the current code:
    - the six-seat refusal's mutation is dropped, since that refusal is gone (`mutate-archenemy-six.js` has "the six-seat
      refusal back");
    - its one survivor, "polish 1: the way off said for a table's own start too", has a new check: a table's own
      Archenemy start with the archenemy not in the game is refused without "mtg archenemy off".
- **Deploy GATES:** 63 of 101 pass, the new `test_bridge_archenemy_team_turns` among them. The other 38:
  - 36 need the TTS Workshop save;
  - `test_bridge_claims`, whose live files guard fails on the base too;
  - `test_editor_forward`, for want of IPv6.
- **Not run, they need the save:**
  - `tools/mutate-teams.js` and `tools/mutate-team-modes.js`, whose baselines include table tests;
  - the six-seat table golden (`test_table_golden_six`).
- **Patches:**
  - `engine/forge.patch` differs from archenemy-six's only in `GameRules`, `CombatUtil`, `ComputerUtilCombat`,
    `AiBlockController` and `AiAttackController`;
  - `engine/manabrew.patch` only in `ManaBrewEngineAdapter`, `Archenemy`, `InteractiveSnapshotExtractor` and
    `ArchenemyTest`;
  - no comments in harness Java;
  - `git apply --check` is clean on `fd16e2f` / `e7d2b93b`.

## Deploying: the bridge and the engine go together

- **An older engine refuses "teamTurns"** ("unknown team rules: teamTurns"). So this bridge's Archenemy start needs
  this engine (`engine1121-archenemyteamturns` or later), and an older bridge on this engine still gets own turns
  ("teams").
- **Protocol:** one new `teamRules` value and one new board `teamRules.rule` value, both Node-side. No relay change.

## Docs

- `docs/team-turns-archenemy-plan.md`: §2.4's open item and §2.7's audit note say 904.2 is built.
- `docs/engine-changes.md` has the row.

## Not done

- No image was built, and no live Archenemy game was played on a real table.
- **On a real table, look at:**
  - the banner on the team's turn ("YOUR TEAM'S TURN", or "TEAM WHITE + RED + YELLOW'S TURN" to the archenemy);
  - the archenemy's own turn ("BLUE'S TURN");
  - the team's priority line.
- **The AI's own life:** an Archenemy opponent's AI judges "life in danger" by their own life only. It blocks for a
  teammate when the block is good for it (a trade or a free kill), not to save the teammate's life.
- **The house rule, if wanted:** own turns stay reachable on the engine ("teams"). The bridge offers no switch back.
