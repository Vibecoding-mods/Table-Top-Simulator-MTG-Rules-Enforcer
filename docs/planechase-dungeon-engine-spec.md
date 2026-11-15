# Planechase and dungeons driven by the engine

Status: spec, 2026-11-05, reviewed the same day (see "Review 2026-11-05" at the end). Built 2026-11-12/13 and deployed in the engine since engine1114-rejoin; checked live on engine1115b 2026-11-15 (PLAN.md, "Planechase and dungeons"). Sections 1-3 describe the code as it was before.
Read-only research of the code as it is today. PLAN.md item "Later (decided 2026-10-17): Planechase and dungeons".

Words used here:
- **Harness**: our Java layer on Forge (`manabrew/forge-harness`). It builds the game and writes the state JSON.
- **Node**: the Rust `self-hosted-node` that runs the harness and starts games (`manabrew-rs/crates/self-hosted-node`).
- **Relay**: the Rust server between the node and the bridge (`manabrew-server`). It passes game views through.
- **Planar controller**: the player whose turn it is; they control the current plane.
- **Phenomenon**: a planar card that does one thing when you reach it, then you planeswalk away.

## 1. What exists today (from the code)

### 1.1 Dungeons: the engine already runs them

| Layer | Today | Where |
|---|---|---|
| Forge | Full rules: venture, choosing a dungeon, branching room choice, room triggers, completing a dungeon (state-based), the initiative, Undercity | `VentureEffect.java` (dungeon pick `chooseSingleCardFace`, room pick `chooseSingleSpellForEffect`), `GameAction.completeDungeon`, `Player.getCompletedDungeons`, `TakeInitiativeEffect` |
| Forge dungeons | 4: Lost Mine of Phandelver, Dungeon of the Mad Mage, Tomb of Annihilation, Undercity. **Baldur's Gate Wilderness (Alchemy) is not in Forge.** | `forge-gui/res/tokenscripts/*.txt` |
| Harness state | per player `dungeonState {name, room}` (room = Forge's `getCurrentRoom`); `initiativeHolderId`; `monarchId`. **No completed-dungeon list. No room list.** | `InteractiveSnapshotExtractor.dungeonState`, `toPlayer`, `gameView` |
| Harness zones | the dungeon card is in the owner's `command` zone (game piece type DUNGEON, so it is not filtered out) | `InteractiveSnapshotExtractor` command zone loop (`!card.isImmutable()`) |
| Wire | `PlayerDto.dungeonState`, `GameViewDto.initiativeHolderId` exist in the protocol and reach the bridge. **The node parses the view into the Rust `GameViewDto`**, so any field missing from the Rust structs is dropped there; the relay passes the view on as raw JSON | `manabrew-protocol/src/game/mod.rs:271` (`DungeonStateDto`, `name` + `room` only), `java_backend.rs:1992` (`state_via_handle`), `manabrew-relay-protocol/src/lib.rs:456` (`StateUpdate { state: Value }`) |
| Prompts | dungeon choice arrives as "Name a card"; next room as a choose-one with "Room — effect" labels | bridge `chooseFromSelection` (hp-08) |
| Bridge | **never reads `dungeonState`.** The room is guessed from text: a `[Room: X]` note on the card (Forge writes none) or the room's ability on the stack ("… (Leads to: …)"), fix #3 of 2026-11-05. Initiative and monarch: a log line on change and a `initiative: true` flag on the player row. Dungeon pictures fetched ahead (`DUNGEON_NAMES`). | `bridge.js` `tableCard` (room regex), stack `room`, `logEvents` "ventures into", `sendTable` player row |
| Table | the dungeon is drawn as a plain command-zone card on a commander-tax label spot (`labels[i] or labels[1]`, 2 labels per colour: with one commander it takes the second label; with partner commanders it lands **on top of** the first commander; when the commander is cast the dungeon moves to the first label). No room marker, no next rooms, no completed count. "INITIATIVE" in the green label under the life counter. | `engine-renderer.lua:15` (`TAX_LABELS`), `:1704-1709` (command loop), `:803` |
| Rewind | **Room and completed list are not rolled back** (read, not run). Restore is in place: the live dungeon card keeps the room it reached after the checkpoint (`setCardInCopiedGame` copies tap, face, state, never `currentRoom`). A dungeon entered after the checkpoint is removed. A dungeon completed after it comes back with no room (`CardCopyService` never copies `currentRoom`), while `completedDungeons` still lists it (the snapshot never touches the list). The initiative is copied. | `ManaBrewInteractiveSession.java:2351-2355`, `GameSnapshot.java:304-306`, `:324-326`, `:355-363`, `:451-485`, `Player.java:183` |

### 1.2 Planechase: Forge has it, nothing above Forge does

| Layer | Today | Where |
|---|---|---|
| Forge | `GameType.Planechase`; each player has their own planar deck (`ZoneType.PlanarDeck`); first plane at game start; planeswalk; phenomena; chaos triggers; the planar die as a sorcery-speed special action costing {X} (X = rolls already made this turn); the AI rolls by each plane's `AIRollPlanarDieParams` | `GameAction` start (`initPlane`, `createPlanechaseEffects`), `Player.planeswalk/planeswalkTo/leaveCurrentPlane`, `PlanarDice.roll`, `RollPlanarDiceEffect`, `PhaseHandler` (plane control moves to the active player each turn) |
| Forge die | the roll button lives on a hidden effect card, "Planar Dice", in each player's command zone. Its ability says `Activator$ Player` (any player) and the harness offers abilities from **every** command zone, so the active player is probably offered one roll per seat (4 in a 4-player game; read, not run). The die uses `MyRandom`, which the harness seeds with the session rng. The result is told to **every** player with `notifyOfValue` ("Planar dice result: {0}") | `Player.java:3259-3285`, `ActionSpace.java:125`, `PlanarDice.java` (`MyRandom.getRandom()`), `ManaBrewInteractiveSession.java:194`, `GameAction.java:2324-2333` |
| Forge plane moves | each turn the plane's control passes to the active player, and Forge moves the card into **that player's command zone** | `PhaseHandler.java:850-856`, `GameAction.controllerChangeZoneCorrection` (`:994`) |
| Forge players leaving | 901.6 (controller leaves: next player controls) and 901.10 (owner leaves: their plane goes, the planar controller planeswalks from **their own** deck) are both coded | `Game.java:999-1029` |
| Forge start | only the **starting player** turns up a first plane; phenomena are skipped to the bottom. A starting deck of phenomena only loops forever (by reading) | `GameAction.java:2418-2423`, `Player.initPlane` (`:2691-2710`) |
| Protocol | `Deck.planes` already exists; `GameViewDto.activePlaneNames` already exists. The relay reads the whole protocol `Deck` on `SetDeckSelection`, so `planes` survives that hop (by reading) | `deck_dto.rs:448`, `game/mod.rs:151`, `manabrew-relay-protocol/src/lib.rs:288-290` |
| Node | **drops `deck.planes`**: `PlayerConfig` (Java request) has no planes; `with_deck_sections` copies sideboard and attractions only. Variant is "Commander" | `java_backend.rs:3048-3120`; `host.rs:1576` (`java_game_variant`) |
| Harness start | **passes `planes = null`** to `RegisteredPlayer.forVariants`, and the variant set is one type only (`EnumSet.of(gameType)`), never Planechase | `ManaBrewEngineAdapter.java:87-116`, `:420` (`attractions` parse), `:260` (`buildDeck`) |
| Card lookup | planes live in Forge's variant database; `CardPool.add` searches Common, then Variant. The debug op `createCard` reads Common only, so it can't make a plane | `StaticData.java:554-558`, `CardPool.java:76-86`, `ManaBrewInteractiveSession.java:2670` |
| Harness state | `activePlaneNames` (names only). The plane card itself shows in the planeswalker's `command` zone. Nothing on the planar controller, the die cost, or planar deck sizes. The "Planar Dice" effect is hidden (immutable). | `InteractiveSnapshotExtractor.activePlaneNames` |
| Harness die result | arrives at each human seat as a no-card `revealCards` notice (the bridge says it in chat and answers it) | `ManaBrewInteractiveController.notifyOfValue` → `awaitNotifyAcknowledgement` |
| Bridge | never reads `activePlaneNames`; always starts Commander; sends no planes | `bridge.js` `startGame`, `SetDeckSelection` |
| Table | nothing. The live save ("Mock MTGA 4 player", 103 objects) has **no Eternities Map, no Planechase bag, no dungeon tiles** (checked in `TS_Save_1.json`). Only Global's name filter that skips decks named "planechase". | — |
| Rewind | Forge's `GameSnapshot` does not copy the game's active-plane list or each player's current planes (read, not run). The restore moves the plane cards back to their zones (planar decks are copied), but the lists still name the plane walked to **after** the checkpoint, now back in a planar deck. Planar deck order rests on the snapshot's own position code: the harness re-sorts library, hand and graveyard only. | `Game.java:82`, `Player.java:162` (private), `ZoneType.java:38`, `ManaBrewInteractiveSession.java:2202` |

So the "table's own scripted helpers" (the workshop table's dungeon tiles and Eternities Map, `table-review/notes-variants.md`)
are not on the live table at all. Nothing needs turning off there. If the 6-player port brings them back, keep the
engine-mode guards PLAN M4 already lists (dungeon token spawns, Eternities Map moves).

## 2. Dungeons: gaps and changes

### 2.1 Gaps, layer by layer

| # | Layer | Gap |
|---|---|---|
| D1 | Harness | no completed dungeons in the state |
| D2 | Harness | no list of the dungeon's rooms and where each leads (the table can't show "next: A or B") |
| D3 | Harness | rewind loses the current room and the completed list |
| D4 | Harness | debug mode can't set a dungeon, a room, the initiative or a completed dungeon |
| D5 | Bridge | ignores `dungeonState`; room is guessed from text |
| D6 | Bridge | no "completes the dungeon" line; no completed count |
| D7 | Table | dungeon card can cover a commander; no room shown on the table |

Node and relay: no change. `dungeonState` is an open field on the protocol `PlayerDto`; the new fields ride inside it
(the Rust struct must gain them, see D1).

### 2.2 Changes

**D1 + D2. Harness `InteractiveSnapshotExtractor`**
- `dungeonState(player)`: add `cardId` (the dungeon card's id), `rooms` and `completed`.
  - `rooms`: from the dungeon's triggers, as `VentureEffect.chooseNextRoom` reads them: each trigger's overriding
    ability gives `RoomName`, `NextRoomName` (comma list) and its `SpellDescription`.
  - Emit `dungeonState` also when the player has completed a dungeon but is in none now (`name` "" then).
- `toPlayer`: `completedDungeons: [names]` from `player.getCompletedDungeons()`.
- **Protocol** `manabrew-protocol/src/game/mod.rs` `DungeonStateDto`: add `#[serde(default)] card_id: Option<String>`,
  `rooms: Vec<DungeonRoomDto>`; `PlayerDto`: `#[serde(default)] completed_dungeons: Vec<String>`. Required, not
  optional: the node reads the view into these Rust structs (`java_backend.rs:1992`) and drops unknown fields. The
  relay passes raw JSON, so it needs no change. Also fill the new fields in the Rust engine's struct literals
  (`manabrew-agent-interface/src/game_view_dto.rs:864`, `:947`, `:1074`) or the node build fails. Then the generated
  TS/Java DTOs.

**D3. Harness rewind (`ManaBrewInteractiveSession`, checkpoint take and restore, near line 2188)**
- At checkpoint (and at the point `applyState` records before its ops): for every registered player, record each
  dungeon card's id → current room, a copy of the completed dungeon list (the cards, not names; a copy because the
  restore clears the live list before re-adding), and `venturedThisTurn` (Keen-Eared Sentry reads it).
- After restore (and after a refused fix): `setCurrentRoom` on the matching card (also `""` for a card that had no
  room); `resetCompletedDungeons` then re-add the recorded cards; `resetVenturedThisTurn` then count back up.
- Done 2026-11-06 (manabrew ebed03e; venturedThisTurn and all registered players in 29d4c5c; node image `mtg-forge-node:dungeon2`). Proof: `rules-check --game dungeon`,
  four rewinds (a venture, a first venture, a completion after the point; a completion before applyState's own point)
  plus the Sentry pair (a rewound venture must not count). Not covered: the refused-fix path (no op ventures while
  triggers are suppressed, so nothing can change the progress before a refusal), and two players in one dungeon.
- Left alone (Forge's `GameSnapshot`, not D3): rewinding to before anyone had the initiative (or was monarch) leaves the
  holder in place, because `copyGameState` only sets them when non-null; and an initiative effect card made after the
  point leaves the command zone while `Player.initiativeEffect` still points at it, so no Undercity venture at upkeep
  until the initiative is taken again (which re-adds the same card).
- First prove the bug (step 0 of §2.5). It needs no new field: `dungeonState.room` is in the view today. If Forge
  already rolls the room back, drop D3.

**D4. Harness `applyStateOp` (debug / manual fix ops)**
- `dungeon {playerId, name, room}`: make the dungeon token the way `VentureEffect.getDungeonCard` does
  (`getAllTokens().getToken`, `setGamePieceType(DUNGEON)`, `moveToCommand`), then `setCurrentRoom(room)`. No triggers
  (matches debug mode's "no triggers"). The existing `createCard` op already makes a token by script name
  (`getAllTokens().getToken`), but as a TOKEN piece with no room, and the bridge's `DEBUG_ZONES` has no "command"
  (`bridge.js:6009`), so a new op is still needed.
- `initiative {playerId}`: `game.setHasInitiative(player)`. No venture.
- `completedDungeon {playerId, name}`: make the token, `addCompletedDungeon`, no zone.

**D5 + D6. Bridge**
- `tableCard` / stack: keep the text guess as a fallback only.
- `logEvents`: compare each player's `dungeonState` between boards:
  - room changed: "White ventures into Goblin Lair (Lost Mine of Phandelver)" (said once even if the stack's room
    ability also says it; today's dedupe already handles a second source);
  - `completedDungeons` grew: "White completes Lost Mine of Phandelver (1 dungeon completed)".
- `sendTable` player row: `dungeon: {id, name, room, next: [room names], text}` and `dungeonsDone: n`.
- `playerMarks`: `DUNGEONS n` when n > 0 (shows in the existing green label, no table change).
- Room prompt: title "Lost Mine of Phandelver: which room next?" exists; add each option's own room text from
  `rooms` when Forge's label is cut short.

**D7. Table `engine-renderer.lua`** (no new main-chunk locals: put state in `engineStatic` or a do-block)
- Command loop: a card of type Dungeon goes to its own spot beside the second tax label (`g.right` offset, measured
  with `tools/tts-shot.ps1`), never `labels[1]`.
- On the dungeon card, a button label (same style as the counters label):
  `ROOM: Goblin Lair` / `NEXT: Storeroom or Dark Pool` / `COMPLETED: 1`. Tooltip: the room's text.
- Later (optional, 3 h): a glowing marker on the room's box on the picture, and clicking a box answers "which room
  next?". Needs room boxes per dungeon measured on the Scryfall pictures (about 30 rooms). The workshop tiles'
  `positions` tables are for their own pictures, not Scryfall's: reuse the room order only.

What a player must see:
- each player's dungeon card, the room they are in, the rooms it leads to, their completed count;
- who has the initiative ("INITIATIVE" label, kept), and the log line when it moves;
- the dungeon and room questions in the prompt panel (exist).

### 2.3 Wire (new and existing fields)

```json
"players": [{
  "id": "player-0",
  "completedDungeons": ["Tomb of Annihilation"],
  "dungeonState": {
    "name": "Lost Mine of Phandelver", "room": "Goblin Lair", "cardId": "c-812",
    "rooms": [
      { "name": "Cave Entrance", "next": ["Goblin Lair", "Mine Tunnels"], "text": "Scry 1." },
      { "name": "Goblin Lair", "next": ["Storeroom", "Dark Pool"], "text": "Create a 1/1 red Goblin creature token." }
    ]
  }
}],
"initiativeHolderId": "player-0"
```
Bridge → table player row: `"dungeon": {"id":"c-812","name":"Lost Mine of Phandelver","room":"Goblin Lair","next":["Storeroom","Dark Pool"],"text":"..."}, "dungeonsDone": 1`.

### 2.4 Tests

- **Golden (`tests/golden/bridge-cases.js`), each with mutants via `tools/mutate-bridge.js`:**
  - room from `dungeonState` alone, no stack text → the venture line;
  - room in both `dungeonState` and on the stack → said once;
  - completion → the completes line, `dungeonsDone` 1, `DUNGEONS 1` mark;
  - dungeon gone and a new one entered the same board (venture after the last room) → completes, then ventures;
  - the player row's `next` list from `rooms`.
- **`test_bridge_events`:** the 8 existing "venture" checks stay green.
- **`test_table_golden` / `test_table_board_diff`:** dungeon card spot with 1 and with 2 commanders (no overlap); the
  room label text.
- **Rules check (`bridge/rules-check.js --game dungeon`, `bash tools/rules-check.sh dungeon`):** a deck of venture
  and initiative cards (candidates: Nadaar, Selfless Paladin; Cloister Gargoyle; Acererak the Archlich; Seasoned
  Dungeoneer; White Plume Adventurer; Gloom Stalker; check every name and prompt with `GET /card` first, live text,
  not guessed). Checks: first venture → `room` = first room; a branch asks for the next room; the last room
  completes → `dungeonState` gone, `completedDungeons` has it; the initiative → Undercity "Secret Entrance"; the
  holder's upkeep ventures again; combat damage to the holder moves it.
- **Rewind proof (step 0, today's image):** reuse the `rewind` game's steps (`rules-check.js:403-412`, which go back
  two turns) in the dungeon game. Three cases, each read from `dungeonState` and `completedDungeons` before and after:
  a venture after the checkpoint (room must go back); a first venture after it (the dungeon must go); a completion
  after it (the dungeon must come back in its room, and leave the completed list). Today only the first two can be
  read; the third needs D1.
- **`mtg debug` scenarios (`scenarios/*.json`, new fields in the debug parser and `test_bridge_debug`):**
  - `dungeon-branch`: `"dungeon": {"name":"Lost Mine of Phandelver","room":"Goblin Lair"}` + a venture card in hand →
    the room question, then the table label;
  - `dungeon-last-room`: room "Temple of Dumathoin" + venture → completes, then a new dungeon question;
  - `initiative-steal`: `"initiative": "Red"`, your attacker vs Red → you take it, Undercity starts.

### 2.5 Order and hours (dungeons)

| Step | Work | Hours |
|---|---|---|
| 0 | `rules-check dungeon` deck and checks, run on **today's** image, with the rewind proof (decides D3 before any build) | 2 |
| 1 | Harness D1 + D2 + D3 (if step 0 shows the loss) + protocol fields and the Rust struct literals | 3.5 (2 without D3) |
| 2 | Harness D4 debug ops | 1.5 |
| 3 | Build the node image once (harness jar and node binary), per `mtg-own-engine-images` steps; re-run step 0 | 1 |
| 4 | Bridge D5 + D6 with goldens and mutants (the room part needs no new image and can start at step 0) | 2.5 |
| 5 | Debug scenario fields + 3 scenarios | 1 |
| 6 | Table D7 spot and label, screenshots | 2 |
| | **Total** | **13.5** (12 without D3) |
| later | Room boxes on the picture, click to choose | 3 |

Why this order: one image build, not two. The old order built the image (step 3) before the rules check that
decides D3 (step 4), so a D3 fix meant a second build.

## 3. Planechase: gaps and changes

### 3.1 Gaps, layer by layer

| # | Layer | Gap |
|---|---|---|
| P1 | Bridge | no way to turn Planechase on or choose planes; the deck sent has no `planes` |
| P2 | Node | `deck.planes` dropped before the Java request |
| P3 | Harness | no `planes` in the start request; `planes = null`; Planechase never in the variant set |
| P4 | Harness | shared planar deck: Forge gives each player their own deck. AI seats bring none. A player with an empty planar deck who planeswalks hits `getZone(PlanarDeck).get(0)` on an empty zone (`Player.java:2641-2643`, a crash, by reading). The same call runs when a plane's owner leaves the game (`Game.java:1029`). A starting player with no deck means no first plane; one with phenomena only hangs the game start (`Player.java:2699-2707`) |
| P5 | Harness | state has plane names only: no planar controller, no plane card ids, no die cost, no planar deck sizes |
| P6 | Harness | rewind leaves the current-plane lists stale |
| P7 | Harness | debug can't planeswalk or make chaos happen (the die can't be rigged: `RollPlanarDiceEffect` passes no rigged result) |
| P8 | Bridge | plane cards would be drawn as command cards on a tax label; the die action's card is hidden; the die result is a raw chat line per seat |
| P9 | Table | nowhere to show the plane, its text, the die button and its cost |

Relay: no change expected (`Deck.planes` is in the protocol; verify the relay keeps it on `SetDeckSelection`).

### 3.2 Changes

**P1. Bridge setup**
- Host chat: `mtg planechase on|off` (default off, shown to everyone like the mode in `game-modes-spec.md` §4),
  `mtg planes random [N]` (default) or `mtg planes <name; name; ...>`.
- Random pool: N = 10 per seat, no duplicates, at most 2 phenomena per 10 (the official deck rule). Plane names
  from Forge: extend `tools/build-forge-card-index.js` to also write the names whose type line is Plane or
  Phenomenon.
- Send the pool in the host's `SetDeckSelection` deck as `planes: [DeckCard]`. AI decks (`spawnBot`) send none.
- `mtg ready`: check plane names like any card.

**P2. Node `engine_backend/java_backend.rs`**
- `PlayerConfig`: add `planes: Vec<CardIdentityForJava>`; `with_deck_sections`: copy `deck.planes`.
- Variant stays "Commander". The harness adds Planechase when it sees planes (no protocol or relay change).

**P3 + P4. Harness `ManaBrewEngineAdapter`**
- `parseStartGameRequest` / `PlayerConfig`: read `planes` (as `attractions`).
- `buildDeck`: `DeckSection.Planes` pool (as attractions). Verify plane cards resolve through
  `CardPool.add` (they live in Forge's variant card database).
- `startGame`: if any player has planes, `variants = EnumSet.of(gameType, GameType.Planechase)`.
- Shared deck: if some player has no planes, pool all planes, shuffle with the session `rng`, deal round-robin so
  every player gets a planar deck. Forge has no single shared deck, so this stands in for the "single planar deck"
  option. If every player brought planes, each keeps their own (the standard rules).
- Deal rule: deal the plane cards first, then the phenomena, so every deck holds at least one plane (a deck of
  phenomena only hangs `initPlane`). Refuse to start if the pool has fewer planes than players.
- `forVariants(..., planes, null)`: pass the player's dealt list.

**P5. Harness `InteractiveSnapshotExtractor.gameView`**, a new `planar` block, only in Planechase games:
- `controllerId`: the active player (Forge moves plane control to them each turn);
- `planeIds`: ids of `game.getActivePlanes()` (the cards are already in a command zone with their text);
- `dieRollsThisTurn`: `game.getPhaseHandler().getPlanarDiceSpecialActionThisTurn()` (the next roll costs that much);
- `deckCounts`: `{player-N: planar deck size}` (order stays hidden);
- `lastRoll`: `{playerId, result: "planeswalk"|"chaos"|"blank", seq}`, recorded in `ManaBrewInteractiveController.notifyOfValue`
  when `saSource.getApi() == ApiType.RollPlanarDice` (the session notes it once; every human controller gets the
  call, so the AI's rolls are seen too). With it, the harness can skip the blocking notice for that roll.
- Protocol: `GameViewDto` gains `#[serde(default)] planar: Option<PlanarStateDto>`.

**P6. Harness rewind.** v1: refuse a rewind in a Planechase game with a clear message (the bridge already words
refusals). Later: after restore, rebuild the plane lists (`game.setActivePlanes` from Plane cards in command zones;
`Player.currentPlanes` is private, so it needs reflection or a Forge change upstream). 0.5 h for the refusal.

**P7. Harness `applyStateOp`**
- `planeswalk {playerId, name}`: everyone `leaveCurrentPlane`, then `planeswalkTo` the named card from any planar
  deck (runs the plane's "when you planeswalk to" triggers; that is the point of the op). Verify a null ability is
  accepted.
- `chaos {playerId}`: run `TriggerType.ChaosEnsues` for that player as `PlanarDice.roll` does on a chaos result.
- Both must run in the **second pass**, the one `freeCast` uses: `applyState` turns every trigger off while it applies
  ops (`ManaBrewInteractiveSession.java:2387`) and only the free-play ops run after triggers are back on
  (`FREE_PLAY_OPS`, `:85`, `:2424-2437`). In the first pass, Akoum's chaos trigger would never fire.

**P8. Bridge**
- `sendTable`: take Plane and Phenomenon cards out of every player's `command` list into a top-level
  `planes: [tableCard...]`, and add `planar: {controller: colour, rollCost: n, deckCount: n, last: {...}}`.
- Find planes by type in **every** player's `command` list: Forge moves the plane into the active player's command
  zone each turn, so its zone owner changes every turn. That is not a move: no log line, and the table spot must not
  follow it.
- Priority panel: the "Planar Dice" ability → label `Roll the planar die (free)` / `Roll the planar die ({2})`, and
  its `cardId` set to the current plane's id, so the table's card buttons and click menu offer it on the plane. If the
  spike shows one roll per seat (see §1.2), keep only the one on the active player's own "Planar Dice" card.
- A plane's owner leaves the game (901.10): "Akoum leaves the game with White; Red planeswalks to Naya".
- Die result: from `planar.lastRoll` (or the no-card notice "Planar dice result: X" until P5 ships), said once for all
  seats: "White rolls the planar die: chaos" / "…: planeswalk" / "…: blank". Don't repeat it per seat.
- Planeswalk line from `planeIds` changing: "White planeswalks to Akoum (from Turri Island)"; phenomenon: "White
  encounters Interplanar Tunnel".
- Chaos triggers are stack items sourced by the plane: label "Akoum: chaos — destroy target creature that isn't
  enchanted".
- Picture: fetch plane pictures ahead when Planechase is on (as `DUNGEON_NAMES`).

**P9. Table `engine-renderer.lua`**
- Plane spot: table centre, landscape (planes are wide cards: turned 90°), raised and large enough to read; the stack
  keeps its spot over each caster's playmat. Placed with `zone = "command"` and the planar controller's colour, so
  the controller's click opens its ability menu (the roll) with the existing card-click path.
- On the plane, a button `ROLL PLANAR DIE (free)` / `({2})` while the roll is offered to the viewer; hidden otherwise.
- Corner bar (`engineUpdateCorner`): `PLANE: Akoum` after DAY/NIGHT.
- On a roll: the existing 4 s banner (`eng_banner_`) shows `CHAOS`, `PLANESWALK` or `BLANK`.
- Tooltip on the plane: its full text (plane text and chaos ability).

What a player must see:
- the current plane (or planes), its text, who controls it;
- the planar die button with its cost, only on their own turn when Forge offers it;
- each roll's result, chaos triggers on the stack, planeswalks in the log;
- the planar deck size (tooltip).

### 3.3 Wire (new and existing fields)

Bridge → relay deck (existing protocol field):
```json
{ "type": "SetDeckSelection", "deck_name": "...", "commander_name": "...",
  "deck": { "cards": [...], "planes": [{ "identity": { "name": "Akoum", "setCode": "", "cardNumber": "" } }] } }
```
Node → harness start request: `"players": [{ "name": "...", "deck": [...], "planes": [{ "name": "Akoum" }] }]`.

Harness → game view:
```json
"activePlaneNames": ["Akoum"],
"planar": {
  "controllerId": "player-1", "planeIds": ["c-903"], "dieRollsThisTurn": 1,
  "deckCounts": { "player-0": 10, "player-1": 10 },
  "lastRoll": { "playerId": "player-1", "result": "chaos", "seq": 4 }
}
```
Bridge → table: `"planes": [{ "id": "c-903", "n": "Akoum", ... }], "planar": { "controller": "Red", "rollCost": 1, "deckCount": 10, "last": { "who": "Red", "result": "chaos" } }`.

Prompts: no new prompt kinds. The roll is a `chooseAction` `activateAbility` on the hidden "Planar Dice" card, then
`payManaCost` for {X} (check that a {0} roll skips payment); Interplanar Tunnel's pick and "Would you like to
planeswalk?" come as existing `chooseCards` / `chooseBoolean` prompts.

How they should read (Arena has no Planechase, so this follows the Arena style the panel already uses):
- the roll: a button on the plane and a row in the priority panel, `Roll the planar die ({1})`, never a pop-up;
- the result: no pop-up, one log line and the 4 s banner;
- chaos: the trigger's target question titled by the plane, "Akoum (chaos): destroy which creature that isn't
  enchanted?";
- Interplanar Tunnel: "Interplanar Tunnel: put which plane on top of your planar deck?" with the 5 planes as pictures;
- "Would you like to planeswalk?" (Forge's `lblWouldYouLikeToPlaneswalk`): "<card>: planeswalk now?" with Yes / No.

### 3.4 Tests

- **Spike first (`bridge/rules-check.js --game planechase`, `bash tools/rules-check.sh planechase`):** 2 seats, the
  human deck with 10 known planes, the passive AI with none. Checks:
  - the game starts; `activePlaneNames` has 1 name; the plane card is in a command zone;
  - both players got a planar deck (`deckCounts`), so the AI's planeswalk does not crash;
  - the roll is offered in the main phase with an empty stack, not at instant speed; 1st free, 2nd {1}, 3rd {2};
  - a planeswalk result changes the plane; a chaos result puts the plane's chaos trigger on the stack;
  - plane control moves to the next active player, and the plane card moves to their command zone;
  - how many roll actions the active player is offered (1, or 1 per seat);
  - the AI concedes or dies while it owns the current plane (901.10): the human planeswalks, no crash;
  - a rewind is refused (v1). For the later full fix, the proof: rewind across a planeswalk, then `activePlaneNames`,
    the plane card's zone and the next planeswalk's card must all match the checkpoint.
- **Golden (`bridge-cases.js`) with mutants:** planes split out of `command`; roll relabel and `cardId` remap; cost
  from `dieRollsThisTurn`; one result line from two seats' notices; planeswalk and phenomenon lines; chaos label.
- **`test_table_golden`:** plane at the centre spot, turned 90°, button text by cost; corner bar text.
- **`mtg debug` scenarios** (planechase is a pre-game setting: a scenario with `"planechase"` can only be typed before
  a game, the parser refuses it during one). Today a pre-game `mtg debug` is only read at the caller's first priority
  (`debugChoice`, `bridge.js:6008`, `:6100-6106`); `startGame` must also read it, to turn Planechase on and send the
  scenario's planes in `SetDeckSelection` (`bridge.js:699`):
  - `planes-chaos`: `"planechase": {"planes": ["Akoum", ...], "current": "Akoum"}`, then the `chaos` op → Akoum's
    trigger asks for a creature that isn't enchanted;
  - `planes-walk`: current "Turri Island", `planeswalk` op to "Interplanar Tunnel" → its pick of 5 planes;
  - `planes-cost`: roll three times → buttons read free, {1}, {2}.

### 3.5 Order and hours (Planechase)

| Step | Work | Hours |
|---|---|---|
| 1 | Node P2 + harness P3/P4 (with the deal rule) + protocol, then one node image build | 4.5 |
| 2 | Spike: `rules-check planechase`; fix what it shows (card lookup, special action, {0} cost, rolls per seat, AI, 901.10) | 3 |
| 3 | Harness P5 state block + `lastRoll` | 2 |
| 4 | Harness P6 refusal + P7 debug ops (second pass), then the second node image build (spike fixes + steps 3-4) and a spike re-run | 3 |
| 5 | Bridge P1 setup commands, plane list in the index, deck `planes` | 2.5 |
| 6 | Bridge P8 with goldens and mutants (plus the roll dedupe and the 901.10 line) | 4.5 |
| 7 | Debug scenario fields + 3 scenarios + the pre-game hook in `startGame` | 1.5 |
| 8 | Table P9, screenshots after each edit | 3.5 |
| 9 | One live game on the real table | 1 |
| | **Total** | **25.5** |
| later | rewind that keeps planes (P6 full) | 2 |

Two image builds, both budgeted: step 1 (so the spike can run) and step 4 (the spike's fixes plus P5-P7). The old
table had only the first, though steps 2-4 all change the harness.

Do dungeons first: the engine and wire already carry most of it (13.5 h). Planechase second (25.5 h).

## 4. Risks

- **Card lookup:** plane cards sit in Forge's variant database; `CardPool.add` searches it after Common
  (`StaticData.java:554-558`), so by reading it finds them. Not run yet: the spike (§3.5 step 2) settles it.
- **Empty planar deck crash** (P4): a planeswalk by a player with no planar deck reads past an empty zone, on a roll
  and when a plane's owner leaves. Dealing every player a deck with at least one plane avoids it and the start hang;
  the rules check must include an AI planeswalk and a plane owner leaving.
- **Rewind** (D3, P6): Forge's snapshot skips current rooms, completed dungeons and the plane lists (by reading).
  Undo in these games would keep the later room or name the later plane until fixed.
- **Rolls per seat:** the active player may see one roll per player. Harmless for the rules (one shared per-turn
  count, `PhaseHandler.java:526`, `:1248-1253`), confusing on the panel.
- **Notice prompts:** every die roll asks every human to acknowledge a notice (Forge notifies all players). The bridge
  already answers no-card notices by itself; P5's `lastRoll` lets the harness skip them.
- **Auto-pass:** a free roll is offered every main phase; check that "nothing to do" skipping still skips, or the
  player gets stopped in every main phase.
- **Shared deck is an approximation:** dealt per-player decks, not one deck. With 4 players and a small pool each deck
  is short; Interplanar Tunnel and Spatial Merging look at your own deck only.
- **Table space:** a landscape plane at the centre must not cover the stack or attack lines; measure with screenshots.
- **Baldur's Gate Wilderness** isn't in Forge: a deck asking for it can't venture there.
- **Engine image rebuilds** are needed for both (harness jar, node binary): follow the image notes; never during a game.
- **Unverified (read, not run):** that the relay passes `deck.planes` on to the node at game start (it reads the
  whole `Deck`, but the lobby-to-node hop was not traced); that Forge's 901.10 code works with per-player plane
  lists (it removes the plane from the planar controller's list, while the game's list may be another player's).

## Review 2026-11-05

Second agent, adversarial read of every claim above against the code. Nothing was run: no games, no builds.
`GET /state` answered (the bridge reports a started game, White at turn 4 upkeep), but it is a summary with no
command zones or `dungeonState`, so it proves nothing here.

Confirmed (14):
1. Forge runs venture, room choice, completion, the initiative and Undercity (`VentureEffect.java:36-131`,
   `GameAction.java:2844-2850`, `:1798`).
2. 4 dungeons in `tokenscripts`; no Baldur's Gate Wilderness.
3. Harness sends `dungeonState {name, room}`, `initiativeHolderId`, `monarchId`; no completed list, no room list
   (`InteractiveSnapshotExtractor.java:261-268`, `:325-328`, `:351-362`).
4. The dungeon card is not filtered from `command` (only EFFECT pieces are: `Card.java:1073`, extractor `:168-171`).
5. The bridge never reads `dungeonState`; the room comes from text (`bridge.js:1238`, `:1310`, `:2242`).
6. Partner commanders: the dungeon lands on the first commander (`engine-renderer.lua:15`, `:1704`).
7. Protocol `Deck.planes` exists and the node drops it (`deck_dto.rs:448`, `java_backend.rs:3048-3120`).
8. Harness passes `planes = null` and never adds Planechase (`ManaBrewEngineAdapter.java:87-116`).
9. Empty planar deck on planeswalk reads `get(0)` of an empty zone (`Player.java:2641-2643`).
10. AI seats bring no planes (no planes are sent at all).
11. The initiative is copied by the snapshot; room, completed list and plane lists are not.
12. The die cost is {X}, X = rolls this turn, sorcery speed (`Player.java:3277-3281`).
13. Die result goes to every player and arrives as a no-card notice the bridge answers (`GameAction.java:2330-2333`,
    `ManaBrewInteractiveController.java:2569-2575`, `bridge.js:4738-4760`).
14. Both totals added up (12.5 h and 23 h); the live save has no Eternities Map or dungeon tiles (only 3
    "planechase" strings in `TS_Save_1.json`).

Corrected (9):
1. Rewind is worse than "not copied": restore is in place, so the room is not rolled back, a completed dungeon comes
   back with no room and stays in the completed list, and the plane lists name the later plane (§1.1, §1.2).
2. Which hop drops unknown fields: the node (`java_backend.rs:1992`), so the Rust structs are required, plus the
   Rust engine's struct literals; the relay needs nothing.
3. P7 debug ops would never fire triggers: `applyState` suppresses them; they must run in the free-play pass.
4. Missed: the plane card moves to the active player's command zone every turn.
5. Missed: one roll offered per seat (likely), from `Activator$ Player` and the all-zones action list.
6. Missed: no first plane if the starting player has no deck; a phenomena-only deck hangs the start. Deal rule added.
7. 901.6 and 901.10 are coded in Forge (was "unverified"); 901.10 planeswalks from the controller's own deck, a second
   crash path.
8. Dungeon order: the rules check that decides D3 ran after the build; moved to step 0 on today's image (13.5 h).
9. Planechase order: steps 2-4 change the harness after the only build; a second build is now budgeted, plus the
   roll dedupe and the pre-game debug hook (25.5 h). Also wrong line refs (renderer ~1399 is 1704; D3's "step 5").

Still unproven (6):
1. Any of it live: every finding above is from reading.
2. That planes resolve through `CardPool.add` at game start, and that `RegisteredPlayer` puts them in the planar deck.
3. How many roll actions the active player gets, and whether a {0} roll asks for payment.
4. Whether auto-pass still skips main phases with a free roll on offer.
5. Planar deck order after a rewind.
6. The relay-to-node hop for `deck.planes`, and 901.10 with per-player plane lists.
