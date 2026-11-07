# Game modes spec: Standard, 2v2, Juggernaut (3v1), and what the engine needs

Status: spec, 2026-10-21. Milestone **M8**. Includes the "ready / start buttons" request (§6), which needs no
engine change: built 2026-10-21 and checked live (PLAN M8). The game modes themselves are not started.

## 1. What exists today

| Piece | Today | Where |
|---|---|---|
| Game type | room format → Forge variant: Commander, Brawl, Oathbreaker; anything else → Constructed | node `java_game_variant` (host:1576-1592); harness `resolveGameType` (`ManaBrewEngineAdapter.java:360-381`) |
| Starting life | one number for everyone, from the format (Commander 40, Brawl 25, else 20) | relay `start_game_sync` (lobby:694-711) → `StartGameRequest.startingLife` |
| Players | every seat built the same way: `RegisteredPlayer.forVariants(playerCount, variants, deck, ...)`; no team, no per-player life or hand | `ManaBrewEngineAdapter.java:108-123` |
| Teams | `PlayerDto.teamNumber` is already *read out* of Forge (`InteractiveSnapshotExtractor.java:310-351`), but nothing ever *sets* a team | — |
| Formats the relay knows | `Any Standard Pioneer Modern Legacy Vintage Pauper Premodern Commander Brawl Oathbreaker Draft Sealed` | `manabrew-protocol` `GameFormat` |
| Our table | Commander free-for-all, 2–4 seats, decks with a commander | bridge `startGame`, `mtg start` |

So **Standard 1v1 needs no engine change** (Constructed already exists). **2v2 and Juggernaut need team and
per-player settings in the engine.**

## 2. The modes

### 2.1 Commander free-for-all (today)
2–4 players, 40 life, commander damage 21, last player standing wins.

### 2.2 Standard (or any 60-card constructed) 1v1
- **Rules:** 20 life, 60-card decks (15-card sideboard ignored), no commander, no commander tax or damage; best of one.
- **Engine:** none. Room format `Standard` → variant `Constructed`, `startingLife` 20 (already the relay's default).
- **Our side:**
  - `mtg ready` accepts a deck without a commander when the mode is Standard;
  - the bridge sends format `Standard` instead of `Commander`;
  - the table hides commander tax and commander damage;
  - life counters start at 20 (they follow the engine's life already).
- Other constructed formats (Pioneer, Modern, Pauper...) are the same with a different legality check.
  - **Legality:** Forge doesn't enforce format legality in this path; the deck check (`mtg ready`) would warn using Scryfall legalities.

#### 2.2a Best of three (optional, requested by the user 2026-11-06)
An option on Standard (and the other 1v1 constructed formats): `mtg match bo3`, or a "Best of 3" toggle beside the
mode buttons (§6). Best of one stays the default.
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

### 2.3 2v2 teams
Two ways to play it; both need **teams** in the engine.

| Option | Rules | Engine work |
|---|---|---|
| **A. Team Commander** (recommended first) | each player has their own life (40), turns go around the table as usual, teammates don't attack each other (Forge's attack targets for a team game leave teammates out: **verify**), spells can still target a teammate, a team loses when both its players have lost | teams only: `RegisteredPlayer.setTeamNumber`; Forge's game-over check is team-aware (**verify**) |
| **B. Two-Headed Giant** | the team shares one life total (60 in Commander 2HG, 30 in constructed), teammates take their turn *together*, attack as a team | Forge's 2HG support (shared life, shared turn, combat by team) must be verified first; much more engine work if it's missing |

- Seating: teammates sit **opposite** each other (White + Yellow vs Red + Blue) or **side by side**, a host choice.
- Option A is mostly "who are my opponents". It's cheap and covers what most groups play.

### 2.4 Juggernaut (3v1)
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

## 3. Engine changes (the Manabrew/Forge side)

All three are additive and default to today's behaviour.

1. **Protocol** (`manabrew-protocol`, then the generated TS/Java DTOs):
   - `PlayerConfig` gains optional `team: u8`, `startingLife: i32`, `startingHand: u8`, `perks: Vec<String>` (Forge card-script lines for extra effects);
   - `StartGameRequest.variant` accepts the new names (`Constructed` already works).
2. **Forge harness** (`ManaBrewEngineAdapter.startGame`):
   - per player, after `forVariants(...)`: `setTeamNumber(team)`, `setStartingLife(life)`, `setStartingHand(n)`;
   - after `match.createGame()`: create each perk as an effect card in that player's command zone.

   Then check:
   - the game-over check with teams;
   - that the AI respects teams (Forge AI does in its own team games: **verify**).
3. **Node** (`self-hosted-node`):
   - Today the game setup comes only from the room: format, seats, decks.
   - Add a room-controller message, `roomRelay {protocol:"self-hosted-node", payload:{type:"gameConfig", teams, life, hand, perks, turnOrder}}`, stored and applied when the game starts (`maybe_start_hosted_engine`).
4. **Relay** (`manabrew-server`): its `self-hosted-node` roomRelay allow-list must let `gameConfig` through from the room controller (today only `gameOver`, `heartbeat`, `spawnBot`, `removeBot`).
5. **Turn order option** (Juggernaut "after every challenger"): Forge takes turns in seat order. Repeating a player needs extra-turn effects, e.g. a perk "At the end of each challenger's turn, Juggernaut takes an extra turn". Mark it as a later option.

**Running it:**
- We'd build our own node image from a fork: `witchesofthehill/manabrew` + `forge`.
- Or upstream it as a PR. Teams and per-player life are generally useful, so a PR is reasonable.
- The fork stays AGPL as Manabrew is; our repo stays public domain (it only talks to the engine).

## 4. Our side (bridge + table)

| Piece | Work |
|---|---|
| Mode choice | `mtg mode commander|standard|2v2|juggernaut <colour>`, plus the buttons in §6; shown to everyone |
| Bridge | sends format + `gameConfig` (teams, lives, hand, perks) before `StartGame`; maps teams to colours |
| Table | team tint on each playmat border; life counters start from the engine's numbers; "TEAM WINS" / "JUGGERNAUT WINS" announcements; commander tax and damage hidden in Standard |
| Deck check | Standard: 60+ cards, no commander, Scryfall legality warning; Commander as today |
| Tests | golden cases for the config sent per mode; headless engine checks per mode (teams: a teammate can't win alone; Juggernaut: life 80, hand 10, the extra draw; Standard: 20 life, no commander) |

## 5. Phases

1. **Standard 1v1:** our side only. Small.
2. **Engine spike:** check out the `forge` submodule and confirm `setTeamNumber`, `setStartingLife`, `setStartingHand`, the team game-over check and the 2HG status. One day.
3. **Teams + per-player life/hand** through the protocol, harness and node (fork), then 2v2 option A.
4. **Juggernaut:** perks (emblems), settings, our UI.
5. **Later:** Two-Headed Giant, the Juggernaut turn-order option, Archenemy schemes.

## 6. Ready and Start buttons (requested 2026-10-21; no engine change)

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

## 7. Planechase and dungeons (pointer, 2026-11-05)

Spec: [planechase-dungeon-engine-spec.md](planechase-dungeon-engine-spec.md).
- Planechase is a setting on top of any mode here (a planar deck per player, `Deck.planes` already in the protocol).
  The node and harness drop it today; no `gameConfig` message is needed for it.
- Dungeons and the initiative already run in the engine; the work is state fields, the bridge and the table.
