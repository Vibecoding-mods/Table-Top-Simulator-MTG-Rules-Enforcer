# Game modes spec: Standard, 2v2 (Team Commander and Two-Headed Giant), Juggernaut, six seats, Three-Headed Giant

Status: spec, first written 2026-10-21 (milestone **M8**), **rewritten 2026-11-13** as the one current spec for every
game mode. Nothing in §3–§9 is built. The Ready / Start buttons (§10) are built and live since 2026-10-21.

**What changed on 2026-11-13** (each change is marked "(2026-11-13)" where it lands):
- The "engine spike" of the old phase 2 is done on paper: Forge's real team code is read and quoted in §2, with file:line.
- Two-Headed Giant is now a full mode (§5), checked against the current Comprehensive Rules (effective 2026-11-06).
  The old "option B" (one line) is replaced.
- Standard now also covers free-for-all games, and its legality check uses Forge's own format files (§3).
- The six-seat table (§7) and Three-Headed Giant (§8) are new. The six-seat build plan stays in
  [m6-six-seat-spec.md](m6-six-seat-spec.md); §7 says what changes in it.
- **Correction (2026-11-13):** Three-Headed Giant is in the official rules after all: rule 810.11 (§8).
- Line numbers of the old text are refreshed. Juggernaut (§6) and best of three (§3.6) are kept word for word.

## 0. Sources and what "verified" means here

- **Rules:** Magic: The Gathering Comprehensive Rules, "effective as of November 6, 2026" (the file's header, line 3),
  from magic.wizards.com/en/rules, file `MagicCompRules 20261106.txt`. Rule numbers below are from that file.
- **Wizards' format page** for Two-Headed Giant: magic.wizards.com/en/content/two-headed-giant-format (read 2026-11-13).
  It is the only Wizards source for the Commander version of 2HG.
- **Forge:** `C:\Users\you\mtg-tts\manabrew\forge`, commit `e7d2b93`, with our `engine/forge.patch` applied in the
  working tree (63 files). All Forge line numbers are in that tree. Paths are shortened:
  `forge-game/.../game/` = `forge-game/src/main/java/forge/game/`.
- **Manabrew:** `C:\Users\you\mtg-tts\manabrew`, branch `tts-engine`, tip `6186d11` (2026-11-09). The newest harness
  work is in `C:\Users\you\mtg-tts\tmp\mb-pc` (engine-changes.md §1); its adapter lines are a few lines lower (e.g. `forVariants` at 122, not 115).
- **Ours:** `bridge/bridge.js`, `tools/engine-renderer.lua`, `tools/make-engine-copy.js` in the working tree on main
  (HEAD `1b131b2`), read 2026-11-13. Other agents edit these files too, so lines may move.
- **Verified** = I read the code or rule text. **Measured** = I ran it. **Not verified** = a plan, a guess or a
  community source; it says so each time. Hours are estimates and include updating tests.

## 1. What exists today

| Piece | Today | Where |
|---|---|---|
| Game type | room format → Forge variant: Commander, Brawl, Oathbreaker; Standard, Pioneer, Modern, Legacy, Vintage, Pauper, Premodern, Draft, Sealed → `Constructed` | node `java_game_variant` (`self-hosted-node/src/host.rs:1576-1592`); harness `resolveGameType` (`ManaBrewEngineAdapter.java:360-381`) |
| Format sent | the bridge always sends `format: "Commander"` with `StartGame` | `bridge.js:1452`; the relay takes it when the room has none (`manabrew-server/src/lobby.rs:674-678`) |
| Starting life | relay: Commander 40, Brawl 25, everything else 20 (`lobby.rs:695-708`). **But the harness never applies it** (2026-11-13): it parses `startingLife` (`ManaBrewEngineAdapter.java:387`) and then builds every player with `RegisteredPlayer.forVariants` (`ManaBrewEngineAdapter.java:115-116`), which gives 20, +20 for Commander, +5/+10 for Brawl (`forge-game/.../player/RegisteredPlayer.java:25, 141-182`) | |
| Players | every seat built the same way; no team, no per-player life or hand | `ManaBrewEngineAdapter.java:110-124` |
| Teams | the snapshot already sends `teamNumber` when a player has a teammate (`InteractiveSnapshotExtractor.java:361-363, 402-405`; protocol `team_number`, `manabrew-protocol/src/game/mod.rs:315`). Nothing ever sets a team, so Forge gives every player its own (`Game.java:328-368`) | |
| Formats the relay knows | `Any Standard Pioneer Modern Legacy Vintage Pauper Premodern Commander Brawl Oathbreaker Draft Sealed` | `manabrew-protocol/src/game/mod.rs:627-641` |
| Our table | Commander free-for-all, 2–4 seats, decks with a commander | bridge `startGame`, `mtg start` |

So **Standard needs no engine change** (verified, §3.2). **Every team mode needs the engine to set teams**, and the
team modes with shared life need Forge changes (§2).

## 2. What Forge supports for teams and Two-Headed Giant (verified 2026-11-13)

Searched: `grep -i "two-headed\|twoheaded\|2HG"` over all Forge Java. Six hits; four are in rules or input code, and
none is a 2HG mode (the other two are the card name "Two-Headed Giant of Foriys Avatar" in
`forge-gui/.../gui/download/GuiDownloadPicturesHQ.java:335` and a set-code string in a desktop test):
- `forge-game/.../game/GameRules.java:10`: `poisonCountersToLose = 10; // ... turns into 15 for 2HG`.
- `forge-game/.../game/player/Player.java:2065`: a comment quoting rule 704.6b.
- `forge-game/.../game/combat/Combat.java:697`: "should be updated when two-headed-giant is done".
- `forge-gui/.../gamemodes/match/input/InputBlock.java:50`: about the card Two-Headed Dragon, not the format.

There is **no Two-Headed Giant game type**: `GameType.java:20-71` lists Sealed, Draft, Winston, Gauntlet, Tournament,
CommanderGauntlet, Quest, QuestCommander, QuestDraft, PlanarConquest, Adventure, AdventureEvent, Puzzle, Constructed,
DeckManager, Vanguard, Commander, Oathbreaker, TinyLeaders, Brawl, Planeswalker, Planechase, Archenemy,
ArchenemyRumble, MomirBasic, MoJhoSto.

What Forge **does** have, and is generic for any team size:

| Feature | Code | Team size |
|---|---|---|
| Team numbers per player | `RegisteredPlayer.setTeamNumber` (`RegisteredPlayer.java:130`; −1 = free-for-all, line 38) → `Player.setTeam` (`Game.java:360-367`) | any |
| Who is an opponent | `isOpponentOf`: another player with a different team, or no team (`Player.java:396-398`); `sameTeam` (`Player.java:3745-3753`) | any |
| Teammates can't be attacked | attack targets are `getOpponents()` and their planeswalkers (`combat/CombatUtil.java:59-63`) | any |
| "Your team" on cards | `getYourTeam()` (`Player.java:371-373`), used by Defined player lists (`ability/AbilityUtils.java:460`) and surge (`Player.java:2137-2140`) | any |
| Team life gain seen by teammates | `addLifeGainedByTeamThisTurn` for each teammate (`Player.java:475-478`) | any |
| Game over by team | a team wins when the players not yet lost are all on one team (`GameAction.java:2025-2042`, `AllOpposingTeamsLost`) | any |
| AI | the AI's board score averages its own team's life (`forge-ai/.../simulation/GameStateEvaluator.java:124-157`); targeting uses `isOpponentOf` throughout `forge-ai` | any |
| Starting life and hand per player | `setStartingLife` (`RegisteredPlayer.java:62`), `setStartingHand` (`:103`), applied in `Game.java:348-354` | any |

What Forge **does not** have (each is new engine work):

| 2HG rule | Forge today | Where |
|---|---|---|
| Shared life (810.4, 810.9) | each player has an own `life` field | `Player.java:81`; `setLife` `:410`, `getLife` `:436` |
| Shared poison, 15 to lose (810.10, 704.6b) | own counters; the loss check hard-codes **10** and never reads `GameRules.getPoisonCountersToLose()` | `Player.java:2066`; the getter and setter exist (`GameRules.java:57-62`), but only the view (`GameView.java:51`), the AI (`forge-ai/.../ComputerUtilCombat.java:492`) and GUI damage dialogs read it |
| A team loses when one player loses (810.8a) | only that player loses; the partner plays on | `GameAction.java:2007-2021` |
| Shared team turns (805) | one active player: `isPlayerTurn` is `player.equals(playerTurn)` | `phase/PhaseHandler.java:117-119`; next turn = next player (`:866`) |
| Combat as a team (805.10) | one attacking player per combat (`Combat.java:76-80`, created with `playerTurn` at `PhaseHandler.java:303`); attackers are that player's creatures only (`combat/AttackConstraints.java:40`, with `// TODO extend for "SharedTurnModes"` at `:45`) | |
| Teammates block for each other (805.10d) | a defender may only block creatures attacking **that** player (rule 802.4a) | `CombatUtil.java:526-530` |
| Both players of the starting team skip the first draw (103.8b) | only in a 2-player game: `turn == 1 && game.getPlayers().size() == 2` | `PhaseHandler.java:225` |
| Commander damage by team (2HG Commander) | per player, 21 from one commander | `Player.java:2070-2076` |

Already right for 2HG with no change: the free first mulligan of a multiplayer game (rule 103.5c), because Forge gives
it whenever there are more than 2 players (`mulligan/MulliganService.java:37`); priority passes player by player in turn
order, and the stack resolves when everyone has passed in a row (`PhaseHandler.java:1125-1140`), which is close to
"all teams pass in succession" (805.5b).

**So:** Forge's team code is generic and has no "2" in it. Everything 2HG-specific is missing, so we write it, and we
write it for any team size (§8).

Forge Java changes go in `engine/forge.patch`, as earlier ones did (PhaseHandler and Player are already patched there;
engine-changes.md §1). Manabrew's rule holds for the harness: no comments in its Java.

## 3. Standard (60-card constructed), 1v1 and free-for-all

### 3.1 Rules
- 20 life each (103.4), 60+ card main deck, up to 15 sideboard, at most 4 of a card except basic lands, no commander,
  no commander tax or damage.
- **1v1:** the starting player skips their first draw (103.8a). Best of one by default; best of three is §3.6.
- **Free-for-all, 3 to the seat count (2026-11-13):** nobody skips the first draw (103.8c); the first mulligan is free
  (103.5c); last player standing wins. Up to 4 on today's table, 6 on the six-seat table (§7).

### 3.2 Engine: none (verified by reading, not run yet)
The chain, each link read 2026-11-13:
1. The bridge sends `StartGame` with `format: "Standard"` instead of `"Commander"` (`bridge.js:1452`).
2. The relay stores it as the room's format (`lobby.rs:674-678`) and picks 20 life (`lobby.rs:695-708`).
3. The node maps Standard to `"Constructed"` (`host.rs:1576-1592`).
4. The harness maps `"Constructed"` to `GameType.Constructed` (`ManaBrewEngineAdapter.java:370-371`).
5. `forVariants` with no Commander variant leaves life at the default 20 (`RegisteredPlayer.java:25, 141-182`).
6. First draw: skipped only in a 2-player game (`PhaseHandler.java:225`). Free first mulligan only with 3+ players
   (`MulliganService.java:37`). Both match the rules above.

To check in the first headless run: a 4-player Constructed game starts (the default-variant code at
`ManaBrewEngineAdapter.java:376-380` would call 3+ players Commander, but the node always sends a variant, so it should
not matter); the sideboard reaches Forge (`ManaBrewEngineAdapter.java:416-418` parses it).

### 3.3 Legality from Forge's own format data (verified 2026-11-13)
Forge ships the formats as text files in `forge-gui/res/formats/`:
- `Sanctioned/Standard.txt`: `Sets:` 20 set codes — WOE, LCI, MKM, OTJ, BIG, BLB, DSK, FDN, DFT, TDM, FIN, EOE, SPM,
  TLA, ECL, TMT, SOS, MSH, HOB, FRA — and `Banned:` 13 cards (Abuelo's Awakening; Badgermole Cub; Cori-Steel Cutter;
  Gran-Gran; Heartfire Hero; Hopeless Nightmare; Monstrous Rage; Proft's Eidetic Memory; Screaming Nemesis;
  Stormchaser's Talent; This Town Ain't Big Enough; Up the Beanstalk; Vivi Ornitier). No `Effective:` line.
- `Archived/Standard/`: 155 dated files (plus a `China/` folder), the newest `2026-10-02.txt` ("Standard (FRA)", `Effective:2026-10-02`, the same
  sets and bans).
- The same folder has Pioneer, Modern, Pauper, Legacy, Vintage (with `Restricted:`), Historic (with `Additional:`), Extended.
- Each set's card list is in `forge-gui/res/editions/<Set name>.txt`: a `Code=` line (e.g. `Code=WOE` in
  `Wilds of Eldraine.txt`) and a `[cards]` section, one card per line (`1 R Archon of the Wild Rose @Chris Rahn`).

What Forge's own checker does with them:
- `GameFormat.getDeckConformanceProblem` (`forge-game/.../game/GameFormat.java:308-313` → `getPoolLegalityProblem`,
  `:263-299`): every card must pass the format's filter (a printing in an allowed set, not banned), and restricted cards
  at most one copy.
- `DeckFormat.Constructed` (`forge-core/src/main/java/forge/deck/DeckFormat.java:45`): main deck 60 or more,
  sideboard 0–15, at most 4 copies of a non-basic card; checked by `DeckFormat.getDeckConformanceProblem` (`:256`).
- Neither runs in the harness today (no format code in `forge-harness`), so nothing stops an illegal deck.

**So these checks are possible from Forge's data:** set legality, the ban list, Vintage's restricted list, 60/15/4.
**Not possible from it:** rarity rules (Pauper's "commons only" is in Forge's file as a rarity filter, not checked here),
and anything newer than the Forge checkout: the list is as fresh as `e7d2b93`. A Forge update refreshes it
(forge-update-2026-11.md). Not verified: that the list matches Wizards' Standard today.

**Plan (no engine change):** `tools/build-forge-card-index.js` already reads Forge's cardsfolder into
`bridge/forge-cards.json`. Add to it: per format file in `Sanctioned/`, the legal card names (from the listed sets'
`[cards]` sections) and the banned and restricted names. The bridge's `checkDeck` (`bridge.js:620`) uses that. A
Forge-side check (call `GameFormat` in the harness) is the alternative; it needs an engine build for no gain.

### 3.4 Bridge and table
- `mtg mode standard` (host), plus a mode button by the Start button (§10). Shown to everyone; "Standard, 1v1" or
  "Standard, free-for-all (3)".
- `checkDeck` (`bridge.js:620-685`) in Standard: no commander needed; 60+ main, at most 15 side, at most 4 of a
  non-basic; every card in Standard's list; no banned card. Problems turn READY red, as today.
- The bridge sends `format: "Standard"` (`bridge.js:1452`) and the sideboard.
- AI decks: `DEFAULT_DECKS` (`bridge.js:26`) are four Commander decks. Standard needs 60-card AI decks
  (question 3). Forge has generator data (`forge-gui/res/deckgendecks/Standard.lda.dat`), not ready decks.
- Table: hide the commander tax labels and commander damage trackers and the "commander" hints; life counters already
  follow the engine's life.

### 3.5 Tests
- Golden (bridge): the `StartGame` sent per mode; deck check cases: 59 cards, 16 sideboard, 5 copies, 5 basics allowed,
  a card from a set not in the list, a banned card, a deck with a commander line.
- Break-it proofs: each deck-check rule mutated off in turn must fail a case (the mutation runner, as for earlier work).
- Headless (`engine-test.js`): Standard 1v1 (20 life, the first player skips the draw), Standard 4-player (20 life,
  nobody skips, mulligan free). Prepared 2026-11-13, not run yet (it joins the live relay's room):
  `node bridge/engine-test.js --format standard --seats 2 --turns 8` and `... --seats 4 --turns 8`. With
  `--format standard` it logs each player's life and library at every turn (53 = no draw yet after the opening 7).
- Live: host vs 1 Forge AI on the real table to the end, with the log.

### 3.6 Best of three (optional, requested by the user 2026-11-06; kept as written)
An option on Standard (and the other 1v1 constructed formats): `mtg match bo3`, or a "Best of 3" toggle beside the
mode buttons (§10). Best of one stays the default.
- **Match:** the first to win 2 games wins the match. A draw counts for neither player; the match is then decided in
  at most 5 games, or by the score after the last game.
- **Play or draw:** game 1, a random pick (shown in the log), and the winner of the pick chooses. Later games, the
  loser of the previous game chooses (a question to that player: "Play" / "Draw").
- **Sideboard:** the 15-card sideboard is used, no longer ignored. Between games each player gets a sideboarding step:
  their main deck and sideboard laid out (or a list in a panel) to swap cards one for one, keeping 60+ main and at
  most 15 side; "Done" when ready, and the next game starts when both are done (with the turn timer, if on, a clock
  for it). Game 1 always uses the registered main deck; each game after starts from the deck as left after the last
  swap (as on Arena); "Reset to registered" puts it back.
- **Between games:** the engine game ends and a new one is started with each player's current 60; life, zones,
  counters and marks reset; the bridge carries the match state (score, who chooses, decks) between games, since each
  game is a new engine game. Rewind and Undo never cross a game boundary.
- **Table:** a match score by each player ("Games 1–0"), the game number in the phase bar ("Game 2 of 3"), the
  result line per game in the log ("Host wins game 1 (Opponent conceded)") and "MATCH WON" at the end.
  Conceding a game is not conceding the match; a separate "Concede match" asks to confirm.
- **Engine:** none expected: each game is an ordinary Constructed game. To check: whether Forge's mulligan rule for a
  game 2/3 needs anything (it doesn't in paper rules), and that the sideboard is sent with the deck.
- **Tests:** golden cases for the match state (score, who chooses play/draw, a draw game, a concede), the sideboard
  swap keeping 60/15, and a headless run of a full 3-game match.
- **Not in scope:** Commander has no best of three; 2v2 and Juggernaut stay single games.

### 3.7 Hours (Standard without best of three)

| Work | Hours |
|---|---|
| Mode state, `mtg mode`, format sent | 1.5 |
| Legality data in the card index, deck check | 4 |
| AI Standard decks (once the user answers question 3) | 2 |
| Table: hide commander pieces in Standard | 2.5 |
| Tests (golden, break-it, headless 1v1 and 4-player) | 3 |
| Live check | 1.5 |
| **Total** | **14.5** |

## 4. Team plumbing (every team mode needs it)

Shared by 2v2 Team Commander, Two-Headed Giant, Three-Headed Giant and Juggernaut. All additive; with no `gameConfig`
the game is today's.

1. **Protocol** (`manabrew-protocol`, then the three regens `manabrew-rs/AGENTS.md` names):
   - `PlayerConfig` gains optional `team`, `startingLife`, `startingHand`, `perks` (Forge card-script lines);
   - a game-level `teamRules`: `none` (today), `teams` (Team Commander, Juggernaut), `sharedLife` (2HG, 3HG). The
     node's Java request (`self-hosted-node/src/engine_backend/java_backend.rs:3037-3057`) carries them.
2. **Node:** a room-controller message `roomRelay {protocol: "self-hosted-node", payload: {type: "gameConfig", ...}}`,
   stored and applied when the game starts (`maybe_start_hosted_engine`, `host.rs:1594`).
3. **Relay:** the self-hosted-node allow-list passes only `gameOver`, `heartbeat`, `spawnBot`, `removeBot`
   (`manabrew-server/src/connection.rs:157-180`). Add `gameConfig` from the room controller. Rebuild `mtg-relay`.
4. **Harness** (`ManaBrewEngineAdapter.startGame`, `:80-140`): per player after `forVariants`, `setTeamNumber`,
   `setStartingLife`, `setStartingHand`; set the new rules flag on `GameRules`; after `match.createGame()`, each perk
   as an effect card in that player's command zone.
5. **Snapshot:** `teamNumber` is already sent (§1). Add the game's `teamRules` so the bridge knows life is shared.

| Work | Hours |
|---|---|
| Protocol + regens | 3 |
| Node `gameConfig` | 4 |
| Relay allow-list + image | 1.5 |
| Harness setters and flag | 2 |
| Harness tests (teams set, life and hand applied, FFA unchanged) | 3 |
| Build both images, live-check, deploy | 2 |
| **Total** | **15.5** |

### 4.1 2v2 Team Commander (the old option A, kept)
Each player has their own life (40), turns go around the table as usual, teammates can't attack each other (verified:
`CombatUtil.java:59-63` uses `getOpponents()`), spells can still target a teammate, a team loses when both its players
have lost (verified: `GameAction.java:2025-2042`). Engine work: §4 only. Bridge and table: team choice, team tint, "TEAM
WINS" (about 8 hours on top of §4; not verified).

## 5. 2v2 Two-Headed Giant

### 5.1 Rules (Comprehensive Rules, effective 2026-11-06; verified by reading)
- **Teams:** two teams of two (810.1). Each team sits together on one side (810.3).
- **Life:** one shared life total per team, starting at **30** (810.4, 103.4a). Damage, life loss and life gain happen
  to each player and are applied to the team total (810.9). An effect that reads "your life" reads the team total
  (810.9a). "Can't gain life" / "can't lose life" covers the whole team (810.9g, 810.9h). Paying life together can't
  exceed the team total (810.9b, 119.4a). Swapping life with a teammate does nothing (810.9e).
- **Poison:** shared by the team; **15** loses (810.8d, 810.10, 704.6b).
- **Winning and losing:** as a team. If either player loses, the team loses; if either wins, the team wins (810.8a).
  A concession is the whole team's (810.8b).
- **Turn:** the shared team turns option (810.2, 805): the team takes one turn together; each player draws in the
  team's draw step (805.4b) and may play a land (805.4c); teams, not players, have priority (805.5).
- **First turn:** the starting team skips the draw step of its first turn (810.6, 103.8b).
- **Mulligans:** each player on the starting team declares, then the other team; teammates may consult; all mulligans
  at once (805.3a, 103.5d). It is a multiplayer game, so the first mulligan is free (103.5c).
- **Combat:** the active team attacks as a group, one combined attack (805.10a-b); each attacker picks which defending
  player or planeswalker it attacks; the defending team blocks as a group, and a defender may block a creature attacking
  **either** defending player (805.10d).
- **Who decides:** if teammates can't agree, the **primary player** decides: the one in the team's rightmost seat from
  the team's view (805.2).
- **Resources:** nothing else is shared; teammates may look at each other's hands and talk, but not handle each other's
  cards (810.5).
- **Changed in the current rules:** 810.7 now says 2HG "uses the combat rules for the shared team turns option ... This
  is a change from previous rules."

**Two-Headed Giant Commander** (not in the Comprehensive Rules: rule 903 has no 2HG text). Wizards' format page says:
99 cards + a commander; "Each team starts with 60 life."; "A team loses when they take 21 or more damage from a single
commander OR have 15 or more poison counters." The page doesn't say "combat" damage; rule 903.10a for normal Commander
counts combat damage only. Read it as 21 combat damage from one commander to the team (not verified: needs the user's
call, question 2). Forge has no 2HG Commander: with today's code each player would start at 40 (`RegisteredPlayer.java:155-158`).

### 5.2 Two levels of 2HG

Forge has no shared turn (§2). Making one is the biggest single engine job in this spec. So 2HG comes in two levels:

| | Level 1: own turns, back to back | Level 2: shared team turns (the real rules) |
|---|---|---|
| Life, poison, losing as a team | yes | yes |
| Teammates block for each other | yes | yes |
| Turns | each player takes their own turn; a team's two turns come one after the other | one turn for the team |
| Attacks | each player attacks on their own turn | one combined attack |
| "Until end of turn", sorcery timing, untap | per player | per team |
| Engine work | small Forge changes (§5.3) | §5.3 plus a new turn and combat structure (§5.4) |
| Hours | about 48 (§5.8) | about 63–83 more on top of Level 1 (§5.8) |

Level 1 is a house version, not the official rules. It keeps everything 2HG players notice most (one life total, 30,
team blocks, poison 15, losing together) and costs a fraction. Level 2 reuses all of Level 1's code. Recommended: build
Level 1, play it, then decide on Level 2 (question 1).

**Turn order in Level 1:** the 4-player table seats White and Red on the south side and Yellow and Blue on the north
(mat zones at x = +19.4 / −19.4, z = −15.4 and +15.4 in Workshop 2296042369, read 2026-11-13). The bridge's clockwise
order is White → Red → Yellow → Blue (`bridge.js:1456-1482`). So the teams **White + Red** and **Yellow + Blue** already
sit side by side and take their turns in pairs, if the starting player is the first of a team in that order (White or
Yellow). A start on Red or Blue would give one team a single turn first: the bridge picks only White or Yellow.

**Primary player:** White for the south team and Yellow for the north, if TTS's +x is a seated player's right (Unity's
axes; not verified on the table).

### 5.3 Engine work for Level 1 (Forge, via `engine/forge.patch`; plan, not verified)
1. **A rules flag:** `GameRules` gets `sharedTeamLife` (set by the harness from `teamRules`, §4).
2. **Shared life by mirroring:** every change to one player's life (`setLife` 410, `gainLife` 440, `loseLife` 495,
   `payLife` 558 in `Player.java`) is applied to that player as today (so "whenever you lose life" triggers fire for the right
   player, 810.9), and then the same new total is copied to the teammates without triggers. Each teammate then always
   holds the team total, so "your life" reads it (810.9a), the life-0 loss check is the team's (810.8c), and the AI's
   averaged team life is right (`GameStateEvaluator.java:157`). Starting life 30 each = team 30.
   `canGainLife` (`Player.java:491`) and the can't-lose-life check look at the whole team (810.9g, 810.9h). Paying life
   checks the team total (810.9b). A life swap between teammates does nothing (810.9e).
3. **Shared poison:** the same mirroring for poison counters; the loss check reads `getPoisonCountersToLose()` instead of
   the hard-coded 10 (`Player.java:2066`); the harness sets 15.
4. **Lose as a team:** when a player loses for any reason (decking, a card, concession), the teammates lose too
   (810.8a, 810.8b), next to `game.onPlayerLost` (`GameAction.java:2019-2021`). "Can't lose" on one player protects the
   team (810.8a's Platinum Angel example).
5. **Team blocks:** in `canBeBlocked` (`CombatUtil.java:526-530`), allow a blocker whose controller is on the same team
   as the attacked player (805.10d). Each defender still declares blocks one after the other
   (`PhaseHandler.java:659-675`), not as one combined block: a small difference, written down.
6. **First draw:** `PhaseHandler.java:225` also skips the first draw of each player of the starting team in a
   shared-life game (103.8b).
7. **2HG Commander damage:** with the flag, the 21 check (`Player.java:2070-2076`) adds up one commander's damage to all
   players of the team (Wizards' page).
8. **Rare rules left out (written down, not built):** 810.9d (an effect setting each player's life: the team picks one
   member), 810.9f (redistributing), 701.34b (proliferate gives a team one poison). These change only a handful of cards.

### 5.4 Engine work for Level 2 (shared team turns; plan, not verified)
On top of §5.3:
1. **The team's turn:** `isPlayerTurn` (`PhaseHandler.java:117-119`) is true for every player of the active team (805.4,
   805.9). That one change reaches the 28 calls in `forge-game` (not counting the definition) and 122 in `forge-ai` (grep
   counts 2026-11-13). The next
   turn goes to the next team, not the next player (`PhaseHandler.java:866, 906`). Extra turns and skipped turns are the
   team's (805.8).
2. **Untap, upkeep, draw for the team:** the untap step reads one active player (`phase/Untap.java:73, 87`); the draw
   step draws for `playerTurn` only (`PhaseHandler.java:275`). Both loop over the team, active team first (805.6a).
3. **Combined attack:** `Combat` takes one attacking player (`Combat.java:76-80`, `PhaseHandler.java:303`) and its
   creatures (`AttackConstraints.java:40`). It becomes the team; each player declares their own creatures' attacks, and
   the attack is checked as a whole (805.10b). `declareAttackersTurnBasedAction` (`PhaseHandler.java:537-550`) asks each
   teammate in turn.
4. **Triggers:** the active team's triggers go on the stack first, in an order the team picks (805.7).
5. **"Attacking player" / "defending player"** on cards: one specific player, chosen per creature (805.10c, 805.10e):
   check `getAttackingPlayer()` (14 calls in `forge-game`, 8 in `forge-ai`) and `getDefendingPlayer` (9 and 6).
6. **AI:** Forge's attack and block AI plan for one attacking player. A Forge AI teammate in a shared turn is the
   largest unknown here. Fallback: Level 2 only with two humans per team, AI only on its own team.
7. **Day and night** use the team rule (502.2a).

### 5.5 Harness and bridge: whose answer counts
- Forge asks one player at a time, and today each question goes to the player it names. That stays: **only the player
  the engine asks can answer**, even in a shared turn. Their partner sees the question read-only ("Red is deciding").
- **Team questions** (Level 2: the order of the team's triggers, 810.9d's member pick) go to the primary player
  (805.2). The partner can say what they want in chat; there is no vote.
- **Priority:** Forge gives priority to each player in turn order (§2). The team has passed when both have passed. The
  table shows "Team White + Red has priority: White" so the partner knows they're next.
- **Attacks in Level 2:** each player declares their own creatures; then the primary player confirms the whole attack
  or sends it back. In Level 1 there's no team attack.
- **Concede:** in 2HG it concedes the team (810.8b). The Concede box says so: "Concede for your team?".
- **Mulligans:** our friendly mulligans (SPEC "Friendly mulligans") keep working per player; the order of declarations
  (805.3a) doesn't change what anyone can do.
- **Team setup:** `mtg mode 2hg` (host); default teams by side (White + Red, Yellow + Blue); `mtg team <colour> <1|2>`
  to change; AI seats fill empty seats on either team. The bridge sends `gameConfig` (§4): teams, life 30 (or 60 in
  Commander), poison 15, `teamRules: sharedLife`.
- **Hidden hands:** partners may see each other's hands (810.5). Today each player's snapshot hides other hands. Showing
  the partner's hand is optional (question 5).

### 5.6 Table work
- **Team life tracker:** one life number per team, between the partners' mats; the two seat life trackers show the
  same number (they already follow the engine, which mirrors it). "TEAM 30" style label.
- **Poison:** the label under the life counter shows the team's count out of 15.
- **Commander damage (2HG Commander):** per team, one tracker per opposing commander (2, or 4 with partners), not
  per seat (`CMD_DAMAGE`, `engine-renderer.lua:9-14`).
- **Team tint** on each playmat border; partners side by side (they are, §5.2).
- **Priority and turn:** the phase bar says the team ("White + Red's turn") and whose question is open.
- **End:** "TEAM WHITE + RED WINS"; both partners' marks show the loss.

### 5.7 Tests
- **Real engine data first:** read Forge's real prompt and life fields for a 4-player team game (GET /state) before
  writing any scenario (the "live engine text" rule).
- **Headless (harness tests and `engine-test.js`), each with a break-it proof** (switch the change off and see the test
  fail):
  - start at 30 each = team 30; one 3-damage hit to White → White and Red both 27;
  - "each player loses 4" (a Flame Rift-style card) → team down 8 (810.9 example);
  - lifelink on Red raises White's number too, and "whenever you gain life" fires for Red only;
  - poison: 14 doesn't lose, 15 does, counted across the team;
  - decking: White draws from an empty library → White and Red both lose (810.8a example);
  - Platinum Angel on Red: the team can't lose at 0 life;
  - a defender blocks a creature attacking their partner (805.10d); a creature still can't attack a teammate;
  - both players of the starting team skip their first draw; the other team draws;
  - first mulligan free; free-for-all and Team Commander unchanged (the rules flag off).
- **Golden (bridge):** `gameConfig` per mode; team setup commands; concede = team concede; game-over text.
- **Live:** host + 3 Forge AI, a full 2HG game with the log; then with a friend on one team.

### 5.8 Hours (estimates)

| Work | Level 1 | Level 2 (extra) |
|---|---|---|
| Forge: life, poison, team loss, blocks, draw skip, commander damage (§5.3) | 16.5 | |
| Forge: team turn, untap/draw, next turn, extra turns (§5.4.1-2) | | 10 |
| Forge: combined attack and checks (§5.4.3, 5.4.5) | | 14 |
| Forge: team trigger order, day/night (§5.4.4, 5.4.7) | | 3 |
| Forge AI in a shared turn (§5.4.6) | | 10–30 (unknown) |
| Harness: flag, snapshot `teamRules`, team questions to the primary | 1.5 | 8 |
| Headless tests with break-it proofs | 6 | 10 |
| Bridge (§5.5) | 8 | 4 |
| Table (§5.6) | 10 | 4 |
| Live checks | 4 | — |
| Images, patch regen, deploy | 2 | — |
| **Total** | **48** | **63–83** |

Plus §4 (15.5) if not done already. Level 1 with §4: **63.5**.

### 5.9 Level 1 as built (2026-11-13, branch `2hg`, image tag `2hg`, not deployed)

What exists (details and proofs: `docs/engine-changes.md`, "2026-11-13 2hg"):
- **§4 plumbing:** `gameConfig` roomRelay from the room controller (relay allow-list, node `HostSnapshot.game_config`,
  taken by the next game that starts); `StartGameRequest.teamRules` (`none`, `teams`, `sharedLife`), `poisonToLose`,
  `commanderDamageToLose`, per player `team`, `startingLife`, `startingHand`; `GameViewDto.teamRules`. Perks were not
  built (no mode needs them yet).
- **§5.3 engine:** items 1-7 as planned, in Forge behind `GameRules.sharedTeamLife`; defaults by team size from the harness
  (2 heads: 30 life, 80 in Commander; poison 15; 42 commander damage, §12). Also: an alternate win ("you win the game")
  is the team's, and the first-player roll is offered to each team's first seat only (`GameAction.teamLead`), so a team's
  turns are back to back (Power Play, too, starts the team at its first seat). The harness refuses a `sharedLife` request
  whose partners aren't next to each other in seat order, give partners different starting life, or set a poison or
  commander-damage limit below 1. Left out, as planned: 810.9d, 810.9f, 701.34b.
- **Hands (§12.5):** a teammate's hand is sent to the viewer in a `sharedLife` game; the bridge keeps it out of the
  "revealed to everyone" rows and the table lays it look-only in the partner's second hand zone.
- **§5.5 bridge (`bridge/teams.js`):** the table's teams come with every Start; the bridge refuses a start that is not
  four seats in two teams of two side by side in turn order, sends `gameConfig` before `StartGame`, says the teams; the
  board gets `teams` (sides, poison limit, winners), poison as "POISON n/15", both partners' commander damage as the
  team's, a "Team life: White + Red" hover line; the end words name the team; a concede is said for the team. Works in
  both formats (Standard 2HG: 30 a team).
- **§5.6 table:** `mtg mode 2hg|ffa` and `mtg team <colour> 1|2` (host; beside main's `mtg mode standard|commander`), the
  partner's hand stand-ins, the phase bar's "(YOUR TEAM)" / "(TEAM ...)" tag, VICTORY for both partners and "WHITE + RED
  WIN THE GAME", "Concede for your team?". **Not built:** a separate team life tracker between the mats (each seat's
  tracker shows the team number already), team tint on the mat borders, per-team commander-damage trackers (each seat's
  tracker shows the team's total instead).

Known limits (Level 1):
- The Forge AI blocks only creatures attacking itself (`AiBlockController.sortPotentialAttackers` reads
  `combat.getAttackersOf` the AI's own player and planeswalkers), so an AI partner doesn't block for a human partner. Its
  board score already reads the team's life (mirrored).
- Each defender still declares blocks one after the other (§5.3 item 5).
- A `gameConfig` stays with the node until a game starts: one sent before a StartGame that never led to a game would
  apply to the next game started in that room without a restart (the bridge sends one only right before StartGame).
- Poison is mirrored where Forge adds or removes counters one kind at a time; `clearCounters` and the bulk
  `setCounters(Multiset)` set each partner on their own, and the mirrored copy fires no counter events. The callers are
  Karn Liberated's restart (clears every player alike), the debug state loader and game copies (`GameSnapshot`), which copy
  each player's own, already mirrored, counters.
- `GameViewDto.teamRules` is also sent in a `teams` game without `sharedLife` (no mode uses one yet).
- The Rust engine backend has no team rules: the node warns and starts such a game without its `gameConfig`.

### 5.10 Seams left for Level 2 (not built)

- Forge: `sharedTeamLife` is only the life/poison/loss/block flag; the shared turn gets its own flag (e.g.
  `sharedTeamTurns`) so Level 1 stays as is. `GameAction.teamLead` is the team's first seat in turn order, i.e. where a team
  turn would start; `PhaseHandler.isStartingTeamsFirstDraw` counts the starting team's first turns, which becomes "the
  team's first turn" once a turn is the team's (805.4b, 103.8b).
- Harness: questions still go to the player Forge asks (§5.5); the primary player (805.2) is `teamLead`'s mirror image
  (rightmost seat) and is not computed yet.
- Bridge: `teams.teamsProblem`'s side-by-side rule exists only because Level 1 plays the team's turns back to back.
  `gameConfig` would carry the new rule (`teamRules: "sharedTurns"` or a separate field).
- Table: the phase bar's team tag already names the team on either partner's turn.

## 6. Juggernaut (3v1; kept as written)
One strong player against a team of three.

| Setting (host chooses) | Default |
|---|---|
| Juggernaut starting life | 80 (the three: 40 each) |
| Juggernaut opening hand | 10 cards |
| Extra cards drawn per turn | +1 |
| Extra land plays per turn | +0 (option +1) |
| Commander damage that knocks the Juggernaut out | 21 per commander (option: 42) |
| Turn order | Juggernaut, then each challenger (default); option "Juggernaut after every challenger" |
| Win | the Juggernaut wins when all three have lost; the three win together when the Juggernaut loses |

- **Engine work:**
  - **Teams:** {Juggernaut} vs {the three}, as 2v2 option A.
  - **Per-player starting life and hand size:** Forge's `RegisteredPlayer` has setters for both (`setStartingLife`, `setStartingHand`; **verify** names in the submodule).
  - **Extra draw / extra land per turn:** an emblem-like effect given to the Juggernaut at game start, written as a Forge card script, e.g. "At the beginning of your draw step, draw an additional card." Forge's dev mode and Vanguard avatars already apply effects this way.
- **Alternative: Forge's Archenemy variant.** It is close: one player at 40 against a team, plus scheme cards. It could be reused if the group wants schemes; otherwise the setup above is simpler.

(Note 2026-11-13: the setter names are now verified, `RegisteredPlayer.java:62` and `:103`; the text above is unchanged
on purpose. Its team and per-player parts are §4.)

## 7. The six-seat table ("just copy everything and make sure it works with two more people")

### 7.1 What the user means, and the danger
Everything the 4-player table does (engine mode, buttons, Undo, rewind vote, manual fix, sounds, marks, art) on a table
with six seats. The danger is in [m6-six-seat-spec.md](m6-six-seat-spec.md): **never paste the 4-player Global (or
the 4-player engine copy) over the 6-player Workshop table.** The two tables use some GUIDs for **different seats**
(mat 8b3401 is White on the 4-player table and Yellow on the 6-player one; 56cd9d Blue / Green; 129eaa Yellow / Blue).
A paste puts one seat's cards on another seat's mat, with no error.

### 7.2 Two ways to build it

What the two Workshop files hold (read 2026-11-13):

| | 4-player (2296042369) | 6-player (2293586471) |
|---|---|---|
| Top-level objects | 250 | 282 |
| Mat zones (ScriptingTrigger) | 37 × 20.8 at x = ±19.4 | 24.8 × 22 at x = ±31.5 / ±27.3, ±2.1 |
| Hand zones | 8 (2 per seat) | 12 (2 per seat) |
| Table surface image (`TableURL`) | its own | a different one |
| Global script | 92,937 characters | 93,375 characters |
| Saved XmlUI | 13,963 characters | 13,963 characters |

- **Way 1, grow our 4-player table:** clone one seat's objects twice with new GUIDs for Green and Purple, and move all
  six seats to new places. But the 4-player mats are 37 wide and three of them don't fit on a side; the seat kits would
  have to be re-laid at the 6-player table's narrower spacing, every object placed by hand-made rules, and the table
  image changed anyway. That is re-doing the author's six-seat layout.
- **Way 2 (recommended), the 6-player table's layout with our code on it:** take the 6-player file's objects and
  places (the author already laid out six seats), and put **our** code on it: Global built from our sources with a
  **table profile** instead of the 4-player numbers (m6 spec §2.2-2.3), and every object script **replaced by our
  4-player version of the same object** (the "script transplant", new 2026-11-13). The transplant answers the m6 risk
  that 16 of the 97 object scripts are older versions (Card Importer 6.4, Encoder, Hand Counters): after it, both tables
  run the same scripts, so every feature carries over. GUIDs come from the 6-player file's own profile, so nothing
  collides.
- The seat code becomes **seat-count generic** in both cases: one seat list from the profile, nothing hard-coded to four.

### 7.3 Every place that assumes four seats (grep, 2026-11-13)
**14 hard-coded seat lists in our code, plus 4 seat caps in the engine stack:**

| File | Line | What |
|---|---|---|
| `bridge/bridge.js` | 1545 | `TABLE_COLORS = ["White", "Red", "Yellow", "Blue"]` (drives the player limit at 1371, the clockwise order at 1464-1482, AI colours) |
| `bridge/bridge.js` | 26, 1436-1437 | `DEFAULT_DECKS`: 4 decks; the AI get only the unused ones, so 1 human + 5 AI gets 3 decks |
| `tools/engine-renderer.lua` | 7 | `LIFE_TRACKERS` (4 GUIDs) |
| `tools/engine-renderer.lua` | 9-14 | `CMD_DAMAGE` (4 victims × 3 attackers; six seats need 6 × 5 = 30) |
| `tools/engine-renderer.lua` | 15 | `TAX_LABELS` |
| `tools/engine-renderer.lua` | 1915 | `FX`'s `TRACK` (effect-panel carrier) |
| `tools/engine-renderer.lua` | 1918 | its four-colour loop |
| `tools/engine-renderer.lua` | 7462 | `seatOfButton`'s four-colour loop |
| `tools/engine-renderer.lua` | 7907 | `SETUP.seats`, and the Start tile "between the four life counters" |
| `tools/make-engine-copy.js` | 224 | AI decks from empty seats: four-colour loop |
| `tools/make-engine-copy.js` | 343 | `mtg winner white\|red\|yellow\|blue` |
| `tools/make-engine-copy.js` | 421 | `COMMAND_ZONES` |
| `tools/make-engine-copy.js` | 733-734 | `CLUTTER_BOXES` "beside Yellow/Red", "beside White/Blue" |
| `tools/make-engine-copy.js` | 744 | `STATUS_SEATS` |
| relay | `manabrew-server/src/lobby.rs:640` | `SetMaxPlayers` clamped to 4 |
| relay | `manabrew-server/src/room.rs:158` | room reset to 4 seats after a game |
| stack | `stack/compose.yml:42` | `SEATS` default 4 |
| node | `self-hosted-node/src/host.rs:1023` | at most `max_players − 1` AI |

Lines naming "Yellow" elsewhere in `bridge.js` (2772, 5345, 5554, 5596, 7740, 7944, 10291-10292) are comments only.
The rest of the bridge already loops over `TABLE_COLORS` (e.g. 788-798, 1366, 1478, 1503, 10819-10827, 10974, 11012),
so it follows the list. The table's own Global holds the seat GUIDs as `data["<colour>"][...]` lines: that is what the
profile replaces.

### 7.4 Known limits, with today's numbers
- **Screen UI (measured 2026-11-13):** built from today's sources on the fake TTS (a scratch copy of
  `tests/golden/table-run.js`'s build): 1 seat 25,607 bytes, 2 seats 37,239, 3 seats 46,669, **4 seats 56,546**. About
  10,000 per seat, so six seats would be about **76,000** (an estimate: the 4-player table has no Green or Purple data,
  so 5 and 6 seats measure the same as 4). The guard is 60,000 (`engine-renderer.lua:4597`): above it, the second
  player's buttons stopped working once (about 64 KB, 2026-10-23, cause not proven; m6-ui-size.md §1). The shrink plan
  (m6-ui-size.md §4, m6 spec steps 1-6) takes six seats to about 45,600, under a 50,000 budget. Only seated **humans**
  get panels: 2 humans + 4 AI is about 37,000 today.
- **Main-chunk locals:** MoonSharp allows 200. `engine-renderer.lua` has 103 top-level `local` names and 92 top-level
  `local function`s today (195; my count 2026-11-13; earlier docs said 194). **No new main-chunk local:** the profile goes
  in one global table (`TABLE_PROFILE`), and the existing locals (`LIFE_TRACKERS`, `CMD_DAMAGE`, `TAX_LABELS`) get their
  values from it.
- **Loaded objects and GPU resets:** a fresh load of the 4-player save is about 69,000 loaded objects; the first engine
  game adds about 11,000; NVIDIA driver resets (TDR) crashed TTS at about 81,700–84,000, idle or after a full redraw
  (memory notes 2026-10-28 and 2026-11-06). The 6-player table has 32 more top-level objects, and six decks and boards
  instead of four: it will start higher. **Not measured.** Step: load the 6-player engine save, read
  `Loaded Objects now:` in Player.log before and after one 6-seat game. If it passes about 78,000, a six-seat game may
  not finish; then cut objects first (fewer pictures loaded, card backs for libraries) before any live game.
- **CPU:** the PC has 6 logical CPUs; the engine runs on 2 WSL cores (`%USERPROFILE%\.wslconfig`, `processors=2`, since
  2026-11-05). The six-seat headless run (1 test seat + 5 Forge AI, 12 turns in 24 s, p95 356 ms, "mostly the 5 AIs
  thinking") was on 2026-10-20, when WSL still had 3 cores. **Not re-measured on 2 cores.** Each Forge AI seat thinks
  on the engine's cores, so 4 or 5 AI seats will make the human wait longer.

### 7.5 Steps (the m6 spec, revised 2026-11-13)
The 16 steps and 44.5 hours of m6-six-seat-spec.md §1 stand. Changes:

| Change | Hours |
|---|---|
| New step 9b: script transplant (each 6-player object script replaced by our 4-player one of the same object, matched by name and script; any object with no match is listed, never guessed) | +3 |
| New step 15a: loaded-object count on the 6-player engine save (before step 15's live games) | +1.5 |
| New step 15b: headless 6 seats on today's 2 WSL cores (timings, p95) | +1 |
| Step 1 starts from today's 56,546 bytes at four seats (not 58,530) | 0 |
| **Total** | **50** |

Tests are m6 spec §6 (the UI budget test, the two-player probe, headless twice without a node restart, host + 5 AI
live, a game with a friend), plus the two new checks above. Break-it proof for the profile: a profile with one GUID
swapped between two seats must fail the table check, and make-engine-copy must refuse a profile with a missing field.

**M6 is parked** (the user, 2026-11-06: no work until the 4-player table is polished). This section is the plan for
when it un-parks (question 4).

## 8. 3v3 Three-Headed Giant

### 8.1 Rules
- **Official after all (2026-11-13):** rule 810.11: "The Two-Headed Giant variant can also be played with equally sized
  teams of more than two players. For each player a team has beyond the second, that team's starting life total is
  increased by 15 and the number of poison counters required for the team to lose is increased by five. (These variants
  are called Three-Headed Giant, ...)" So 3HG constructed: **45 life** per team, **20 poison** loses, and every other
  2HG rule (shared turns, combat as a team, losing as a team). Verified by reading.
- **Seats:** each team on one side. On the 6-player table, south White, Red, Yellow and north Green, Blue, Purple (m6
  spec §2.1). Primary player: White and Green, if +x is a seated player's right (not verified).
- **3HG Commander: no official numbers.** Wizards' format page doesn't mention 3HG. Community practice is mixed and old:
  - a 2019 Magic Judges forum answer (apps.magicjudges.org/forum/topic/51629): no official rule for combining 2HG and
    Commander; the playgroup agrees on a life total;
  - a 2015 TappedOut thread (tappedout.net, "Is there such a thing as official rules for EDH two-headed giant at 6
    players+"): one group played three teams of two at 60 life per team, 10 poison, 21 from any one commander;
  - one store's 2HG Commander event (Green Gate Hobbies, 2025-08-30) used 40 life per team, 10 poison, 21 commander
    damage.
  - Two ways to scale Wizards' 60: **90** (30 per head, as 60 is for two heads) or **75** (60 + 15, as rule 810.11 adds
    for constructed). Both not verified as anyone's standard. Poison: 20 by 810.11. Commander damage: 21 from one
    commander to the team, as Wizards' 2HG page. The user picks (question 2).

### 8.2 Is Forge's team code ready for three?
Yes for what exists: `isOpponentOf`, `sameTeam`, `getYourTeam`, attack targets and the team game-over check have no
team size in them (§2 table). The only "2" in the area is the first-draw rule, `game.getPlayers().size() == 2`
(`PhaseHandler.java:225`), which §5.3.6 replaces. Everything new in §5.3-5.4 is written for any team size: life
`30 + 15 × (size − 2)`, poison `15 + 5 × (size − 2)`, mirroring to every teammate, the starting team's every player
skipping the first draw.

### 8.3 Work on top of 2HG and the six-seat table

| Work | Hours |
|---|---|
| Engine: team size 3 in the formulas; a check that teams are equal size (810.11) | 2 |
| Headless tests: 45 life, 20 poison, a 3-player team losing together, blocks for either partner, with break-it proofs | 3 |
| Bridge: `mtg mode 3hg`, teams by side on the six-seat table | 2 |
| Table: team life tracker for three mats per side, priority line with three names | 3 |
| Live: host + 5 AI 3HG to the end (2 WSL cores: expect slow AI turns) | 4 |
| **Total** | **14** |

Needs: §4, §5 Level 1 (or 2), and §7 (the six-seat table). In Level 1, three back-to-back turns per team.

## 9. Order of work and hours

| # | Step | Hours | Needs |
|---|---|---|---|
| 1 | Standard, 1v1 and free-for-all (§3) | 14.5 | user's answer on AI decks |
| 2 | Best of three (§3.6) | not estimated (kept as written) | 1 |
| 3 | Team plumbing (§4) | 15.5 | |
| 4 | 2v2 Team Commander (§4.1) | about 8 | 3 |
| 5 | 2HG Level 1 (§5) | 48 | 3 |
| 6 | Juggernaut (§6) | not estimated (kept as written) | 3 |
| 7 | Six-seat table (§7) | 50 | M6 un-parked, a second save |
| 8 | 3HG (§8) | 14 | 5, 7 |
| 9 | 2HG/3HG Level 2: shared team turns (§5.4) | 63–83 | 5; user's go-ahead |
| | **Total (1, 3, 4, 5, 7, 8)** | **150** | |

Each engine step: harness tests and break-it proofs, an entry in `docs/engine-changes.md`, `engine/forge.patch` and
`engine/manabrew.patch` regenerated, both images rebuilt, deploy with TTS closed. Each table step: screenshot after
each UI change (`tools/tts-shot.ps1`), the table gates, one live game.

Old phases, for the record: "Standard 1v1" is step 1; the "engine spike" is done on paper (§2); "teams + per-player
life/hand" is step 3; "Juggernaut" step 6; "later: Two-Headed Giant" is now steps 5 and 9.

## 10. Ready and Start buttons (requested 2026-10-21; no engine change; built)

The chat commands as buttons, so nobody has to type:
- **Ready, one per seat** on that player's playmat edge:
  - **Shows:** "Ready?" in yellow until the player's deck has been checked, then "Ready ✓" in green.
  - **Click (by that seat's player):** does exactly `mtg ready` (reads the imported deck and commander, checks every card with the engine).
  - **Problems** (unknown cards, no commander): the button turns red, and the chat says why, as today.
- **Start, one in the middle of the table:**
  - **Shows:** yellow "Waiting for players (2/4 ready)", then green "Start game" once every seated player is ready.
  - **Click:** anyone can, when green. Does exactly `mtg start`, with AI players for the empty seats if the host turned that on.
  - Hidden while a game runs. After the game, a "New game" button does `mtg reset`.
- **Who can press what:**
  - only a seat's own player readies that seat;
  - "Start" by anyone, once all are ready;
  - "New game" by the host only (as `mtg reset` today).
- The buttons only exist in engine mode.
- (2026-11-13) The mode buttons of §3.4 and §5.5 go beside Start, host only, hidden during a game.

## 11. Planechase and dungeons (pointer, 2026-11-05)

Spec: [planechase-dungeon-engine-spec.md](planechase-dungeon-engine-spec.md).
- Planechase is a setting on top of any mode here (a planar deck per player, `Deck.planes` already in the protocol).
  The node and harness drop it today; no `gameConfig` message is needed for it.
- Dungeons and the initiative already run in the engine; the work is state fields, the bridge and the table.

## 12. Decisions (the user, 2026-11-13)

1. **Two-Headed Giant: the real shared turn (Level 2)**, changed the same day (the user: "Actually let's do shared
   turn"). Level 1 (shared life, poison and blocks) is still built first as the foundation, then Level 2 on top
   (§5.2, §5.4): one turn for the team, a combined attack, and the Forge AI in a shared turn (the 10-30 h unknown).
2. **Commander numbers:** 2HG Commander starts at **80 life per team**, and a team loses at **42 damage from one
   commander** (our house rule, not Wizards' 60/21). **3v3 is Commander.** Its life and commander damage were not given;
   scaled from the 2HG numbers by team size: **120 life and 63 commander damage** (the user confirmed, 2026-11-13).
3. **Standard AI decks:** Claude picks four current Standard decks (from Forge's own Standard list, §3.3).
4. **Six seats:** stays parked (the 2026-11-06 decision holds). 3v3 waits with it.
5. **Partners' hands:** yes, partners see each other's hands in 2HG and 3HG.

The questions as asked:

1. **Two-Headed Giant:** is the cheaper version OK first, where partners share life and block for each other but still
   take their own turns one after the other? The real shared turn is about 63–83 more hours of engine work.
2. **Starting life:** 2HG Commander at 60 per team (Wizards' page)? And for 3v3 Commander, 90 or 75 per team? Is 3v3
   Commander or 60-card?
3. **Standard AI decks:** shall I pick four current Standard decks for the AI, or will you give me lists?
4. **Six seats:** do you want M6 un-parked now, and may it become a second table save ("Mock MTGA 6 player")? (The m6
   spec's commander damage question, A or B, comes with it.)
5. **Partners' hands:** in 2HG and 3HG, should partners see each other's hands on the table? The rules allow it.

## Sources

- Comprehensive Rules, effective 2026-11-06: https://media.wizards.com/2026/downloads/MagicCompRules%2020261106.txt (from https://magic.wizards.com/en/rules). Rules used: 103.4, 103.5, 103.8, 119.4a, 502.2a, 701.34b, 704.5c, 704.6, 802.4a, 805, 810, 903.7, 903.10a.
- Wizards, Two-Headed Giant format page: https://magic.wizards.com/en/content/two-headed-giant-format
- Magic Judges forum, 2HG + Commander life (2019): https://apps.magicjudges.org/forum/topic/51629
- TappedOut, EDH 2HG at 6+ players (2015): https://tappedout.net/mtg-questions/is-there-such-a-thing-as-official-rules-for-edh-two-headed-giant-at-6-players/
- Green Gate Hobbies, 2-Headed Giant Commander event: https://greengatehobbies.com/events/VRdgC-2-headed-giant-commander-bracket-3-kaiju-rules-no-infinites-no-instant-wins
