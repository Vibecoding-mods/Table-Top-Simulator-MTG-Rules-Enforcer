# Spec: Rules-enforced MTG Commander in Tabletop Simulator

Status: v0.2, 2026-10-20 (v0.1 draft 2026-10-17). M0–M4 built and tested; see the milestone table in §10.
Background: the original hand-off notes (private)
Progress tracking (done / to do): [PLAN.md](PLAN.md)

## 1. Goal

Play Magic: The Gathering Commander in Tabletop Simulator (TTS) with full rules enforcement and MTG Arena-style automation: automatic triggers, a visible stack, priority passing, and damage and life alerts. Effects and screen shake are a later layer.

**Hard constraint:** TTS is the only front end. Players see and play the game in TTS.

### Non-goals (v1)
- Writing any rules logic. All rules come from Forge.
- ~~Free drag-and-drop play~~: changed 2026-10-17. Players drag cards as usual and the engine checks every move (§10a).
- Deck building inside TTS. Decks are imported as text lists.
- Publishing to the Steam Workshop (decide later; see §9 Licensing).

## 2. Architecture

```
 Other players' TTS ──(TTS's own multiplayer)──┐
                                               │
 HOST PC                                       ▼
 ┌──────────────┐  localhost TCP  ┌──────────────┐  WebSocket   ┌────────────────┐     ┌──────────────────┐
 │ TTS (host)   │ 39999 ◄──────── │   Bridge     │ ───────────► │ manabrew-server│ ◄── │ self-hosted-node │
 │ Global Lua   │ ───────► 39998  │  (Node.js)   │ one session  │ (relay, :9443) │     │ ENGINE_BACKEND=  │
 │ + UI XML     │  External Editor│              │  per seat    └────────────────┘     │ forge → Java     │
 └──────────────┘       API       └──────────────┘                                    │ Forge            │
                                                                                      └──────────────────┘
```

| Component | Built by | Job |
|---|---|---|
| **TTS mod** (Global Lua + UI XML) | us | Renders the engine's state, shows prompts as UI and sends player choices. Holds no game rules. |
| **Bridge** (Node.js) | us | Translates between TTS's External Editor messages and Manabrew's relay protocol. Opens one relay session per seated player. Stamps timestamps for latency measurement. |
| **manabrew-server** | Manabrew (unchanged) | Relay, lobby and rooms. |
| **self-hosted-node** | Manabrew (unchanged) | Hosts the room and runs Forge, which is the authority on game state. |

Everything runs on the host's PC. The other players only need TTS and join the host's TTS server as normal. TTS copies objects and UI to them, and their button clicks run in the host's Lua.

### Why the External Editor API and not WebRequest
- `WebRequest` is HTTP only and can't receive pushed messages, so the engine's updates would need polling.
- The External Editor API pushes: the bridge sends `{"messageID": 2, "customMessage": {...}}` to `localhost:39999`, and TTS calls `onExternalMessage(table)` in Global Lua. Lua calls `sendExternalMessage(table)`, which arrives at the bridge listening on `localhost:39998` as `messageID 4`.
- Port 39998 can only be held by one program. While the bridge is running, the VSCode/Atom TTS plugin can't connect (see §8).
- **Fallback:** if the External Editor API turns out unreliable, the bridge also serves HTTP on `localhost:8787` and Lua long-polls it with `WebRequest`.

## 3. Bridge ↔ engine (Manabrew relay protocol)

- Connect to `ws://127.0.0.1:9443` with the server key, once per TTS seat (each with a username such as `tts-White`).
- Join the node's room. Every session readies up. Set `SELF_HOSTED_NODE_AUTO_START=true` so the game starts when the room fills.
- From the engine, per seat:
  - `StateUpdate`: either a full `gameView` or a patch. The bridge applies patches and keeps the full state.
  - `AgentPrompt`: a decision for a player.
  - `DisplayEvent`.
  - `ProtocolError`.
- To the engine: `{kind: "response", promptId, action}`, sent exactly once per prompt and echoing the most recent `promptId`. Also `directive: concede`.
- **Reference client:** `manabrew-rs/crates/manabot`, a headless bot that joins rooms over the relay. Copy its connection flow: `JoinRoom`, ready, and `RequestResync` on reconnect.
- **The working flow, verified in `bridge/engine-test.js`:**
  1. `Authenticate {username, password: <server key>}`, then `ListRooms`, then `JoinRoom {room_id}`.
  2. Once a `RoomUpdate` lists us: `SetDeckSelection {deck_name, deck, commander_name}`, then `SetReady`.
  3. To fill seats with AI players: `BroadcastState {state: {kind: "roomRelay", protocol: "self-hosted-node", version: 1, messageId, roomId, payload: {type: "spawnBot", decks: [...], forgeAi: true}}}`.
  4. `StartGame {format: "Commander"}`, then `GameStarted` arrives with `player_order`; our seat ID is `player-<index>`.
  5. Engine traffic arrives as `StateUpdate.state` envelopes (`kind`: `state`, `stateDelta`, `prompt`, `error`, `display`, `log`, `fatal`).
  6. To answer a prompt: `BroadcastState {state: {kind: "response", fromPlayer: "player-N", promptId, action: {type: <prompt input type>, output: {...}}}}`.
- The message definitions live in `manabrew-rs/crates/manabrew-relay-protocol/src/lib.rs` and `manabrew-agent-interface`. The public spec is https://docs.manabrew.app/protocol/.

## 4. Bridge ↔ TTS message format

Every message is a Lua table (TTS ignores anything else). The fields are:

```jsonc
// bridge → TTS
{ "t": "state",  "seq": 42, "view": { ... } }  // simplified view the bridge builds per §5
{ "t": "prompt", "seat": "Red", "promptId": "p17", "kind": "chooseAction",
  "text": "Cast a spell or pass priority", "options": [ {"id":"a3","label":"Cast Sol Ring"}, ... ],
  "ts": { "engine": 1792217000123, "bridge": 1792217000125 } }
{ "t": "fx", "kind": "damage", "target": "Blue", "amount": 7 }   // later: drives effects
{ "t": "error", "msg": "..." }

// TTS → bridge
{ "t": "respond", "seat": "Red", "promptId": "p17", "choice": {...}, "ts": {"click": <os.time ms>} }
{ "t": "hello", "seats": ["White","Red","Blue","Green"], "decks": { "White": "<decklist>", ... } }
{ "t": "ping", "id": 9, "ts": {...} }   // latency test, see §6
```

The bridge turns Manabrew's typed prompt `input` into this simple `options` list. TTS only needs a small set of generic UI widgets (§5).

### 4a. Rule for every mechanic: build it from the core moves (decided 2026-11-03)

Every mechanic is made of a few core moves: a card moves from one zone to another (draw, mill, discard, exile,
return, sacrifice), a counter changes, a player's life changes. The bridge and the table handle each core move once.
A mechanic does not get its own handling. It gets a label on the core moves it makes.

Example: dredge 3 is "mill 3, then move this card from the graveyard to the hand, instead of a draw". The log line
comes from the mill wording plus a dredge label ("White dredges Darkblast instead of drawing (dredge 3), milling …").
The table moves the cards the way it moves any milled card.

How this works:
- **The engine names the cause.** Forge's zone-change event carries no cause, so the harness reads it at the moment
  of the move (`EngineEventLog`):
  - `how` comes from Forge's own flags: `mill`, `draw`, `discard`, `surveil`, `sacrificed`, `destroyed`, `played`,
    and for a special action's exile `foretell`, `plot`, `suspend`.
  - `cause` is the replacement that made the move (`Darkblast - Dredge 3`), or the cost being paid (`Cost:Cycling`,
    `Cost:Delve`, `Cost:Escape`, `Cost:Sacrifice`), or the API of the resolving ability (`Explore`, `Mill`,
    `Surveil`, `Dig`, `ChangeZone`).
  - `causeName` and `causeCardId` name the card behind it.
- **The bridge keeps one list of moves.** It builds it from that feed (`engineFacts`), or from the two boards when an
  engine sends no feed. Each move gets a kind (`libraryKind` for moves out of a library). One wording table
  (`LIBRARY_WORDS`) says each kind once, with the cause as its label.
- **The table moves cards the same way, whatever the mechanic.** Animations, piles and hover text key on the zone
  move, never on a mechanic's name.

What a new mechanic needs:
1. Check that the harness already sends its moves with the right `how` and `cause`. If the cause is missing, fix that
   in the harness, not in the bridge.
2. If it needs to be named, add a label (or one row in the wording table).
3. Add a test in `tests/test_bridge_events.js` that feeds the events and checks the line.

Never add a second code path that recognises a mechanic by guessing from the board, its card text or its prompt
title when the engine can say it. Board guesses stay only as the fallback for an engine with no feed. When they are
used, `tmp/guess-log.log` records it.

The next stretch of work on this rule (1½–2 days, agreed 2026-11-03; the list is in PLAN "The next 1½–2 days"):
- **Causes for costs and special actions.** The harness names a move made by paying a cost or taking a special
  action: cycling's discard, delve's and escape's exile, a sacrifice as a cost, and foretell, plot and suspend.
- **Every zone move on one pattern.** Exile, graveyard and the other moves get a kind function and a wording table,
  as moves out of a library have.
- **A keyword sweep.** Test cards are chosen from Forge's cardsfolder by keyword and run on two test stacks against
  one engine rebuild. A keyword whose log line is wrong is fixed through its cause and label, never with its own path.

None of this needs TTS. The table's own Lua cleanup and the prompt and keyword registries come later.

## 5. TTS mod

> **Decided 2026-10-17:** the face is the group's existing table, "MTG 4 player table - scripted" (workshop 2296042369), running in a new "engine mode". The M3 text board below remains the fallback and debug view.
>
> - The renderer is appended to that table's Global script.
> - Cards are spawned in its Card Importer's format, at its `data[color]` zones.
> - Its trackers and Encoder overlays are fed engine data.
> - Its manual rules helpers are switched off by an `ENGINE_MODE` flag.
>
> The full per-script map is in [table-review/COMPATIBILITY.md](table-review/COMPATIBILITY.md).

**State rendering.** Whenever `state` arrives, the mod makes the table match it:
- Battlefield, hand, graveyard, exile and command zone for each player.
- Library count.
- Stack, shown as a column in the middle of the table, newest on top.
- Life, poison and commander damage.
- Phase/turn bar showing whose turn it is and who has priority.

Card images come from Scryfall by name or ID through TTS custom card assets. Spawned objects are cached by engine card ID and moved, not respawned.

**Hands are private.** Each seat's hand is placed in its TTS hand zone, so TTS hides it from the other players.

**Locking.** All engine-owned objects get `setLock(true)` and `interactable = false`. Players can't drag them.

**Prompts** are UI XML panels, made visible only to the deciding seat with the `visibility` attribute. One generic widget per prompt shape:

| Widget | Covers Manabrew prompts |
|---|---|
| Button list | `chooseAction` (including Pass), yes/no, modes |
| Card picker (click highlighted cards on the table, then Confirm) | `chooseCards`, `chooseBoardTargets` |
| Number picker | `chooseNumber`, X costs |
| Attack/block assignment (click a creature, then a player or attacker) | `chooseAttackers`, `chooseBlockers` |
| Mana payment (auto-pay button plus manual) | `payManaCost` |

Unknown prompt kinds fall back to a button list built from the bridge's `options`, so new prompt types never stall a game.

**Effects (phase 4):** camera shake, which is a short sequence of `Player.lookAt` offsets, applied only for players who opt in. Also sounds through custom assets, particle effects as custom AssetBundles, and damage numbers. All of these are driven by `fx` messages that the bridge derives from state diffs and `DisplayEvent`.

## 6. Latency (first priority once a game runs)

**Targets.** These budgets cover the system only; time spent waiting on a player or the AI doesn't count.

| Path | Target | Unplayable if over |
|---|---|---|
| TTS → bridge → TTS echo | < 30 ms | 100 ms |
| Click → engine accepts the response | < 80 ms | 250 ms |
| Click → the resulting state is shown in TTS | < 150 ms | 400 ms |
| Large state (Commander board, 4 players, 100+ permanents) rendered | < 300 ms | 1 s |

**Method.** Each hop stamps a timestamp:
- `click`: Lua (`os.clock` plus a sync offset)
- `bridge_in`
- `relay_out`
- `engine_state`: when the `StateUpdate` arrives back
- `tts_out`
- `rendered`: Lua, after it finishes moving objects

The bridge logs one CSV row per action to `latency.csv`. To keep clocks honest, the bridge and Lua sync their clocks with `ping` messages at startup (NTP-style midpoint).

**Results:**
- **Test 1, echo (2026-10-17):** 500 pings, TTS host, real TTS. p50 10.4 ms, p95 12.8 ms, p99 13.7 ms, max 17.0 ms. **Passes** the target of < 30 ms. Wall-clock time agrees: 500 pings took about 5 s in the chat timestamps, so `os.clock` is measuring real elapsed time. Of that, the bridge accounts for about 2–3 ms; the rest is TTS handling the message on its main thread, roughly one frame. **Conclusion:** the External Editor API is fast enough, so the WebRequest fallback isn't needed for speed.

- **Test 2, engine round trip (2026-10-17):** `bridge/engine-test.js`. Our seat is an auto-player against Forge AI bots in the local Forge room. Each sample is the time from our response to the next engine message addressed to our seat. A "direct" reply is an answer the engine acts on immediately (mana payment, targets, reveals). A `chooseAction` sample is usually a priority pass, so it also includes the time every AI player takes to decide.

  | Seats | Direct reply p50 / p95 | chooseAction (incl. AI) p50 / p95 | State size | Game |
  |---|---|---|---|---|
  | 2 | **13 / 33 ms** | 26 / 45 ms | ~13 KB | 7 turns in 2.8 s, 0 rejected responses |
  | 4 | **40 / 91 ms** | 86 / 142 ms | ~20 KB (max 29) | 13 turns in 13.5 s, 0 rejected responses |

  Forge's own processing (`engineMs`) is about 7 ms; nearly all of the remaining time is the relay round trip and serializing the state. The 4-seat p50 is within the 80 ms target, but its p95 is a little over. **Optimisation to try next:** the test client doesn't announce a `client_version`, so the relay may be sending it the full state each time instead of only the changes (deltas). Supporting deltas would make each message much smaller. Also worth measuring: how much of the cost is the Docker VM on this Ryzen 5 3500. **Estimated click-to-render for 4 players:** about 10 ms (TTS hop) + about 40 ms (engine) + TTS render time (test 3).

- **Test 2b, change-only patches (2026-10-17):** the client now announces `client_version 3.56.0` and applies `stateDelta` patches itself (`bridge/state-delta.js`). Every rebuilt state is checked against the engine's FNV-1a fingerprint. Two runs per mode, 4 seats, 12 turns each:

  | | Change-only patches | Full states |
  |---|---|---|
  | Message size, avg / max | **~2 KB / 8 KB** | ~19 KB / 26 KB |
  | Relay hop (round trip − engine time) | **p50 ~4 ms, p95 ~7–13 ms** | up to 50–90 ms |
  | Total, direct reply p50 | ~29 ms | ~30 ms |
  | Total, chooseAction p50 | ~60 ms | ~55–63 ms |
  | Correctness | 283 patches, **0 fingerprint mismatches, 0 resyncs**, apply ≈ 0.05 ms | — |

  **What this shows:**
  - Patches eliminate the relay hop cost: messages are about 9× smaller and the hop is about 4 ms.
  - The total time barely changed, because **the remaining time is spent inside the engine host**. With patches, `engineMs` is reported accurately (p50 23 ms for direct replies, 55 ms for priority passes).
  - The earlier test-2 conclusion that "the hop dominates" was wrong. In full-state mode, the `engineMs` on states the relay expanded wasn't meaningful.
  - The engine host's time includes the three in-engine Forge AI players deciding on priority, so a priority-pass sample measures AI thinking more than the system.
  - **Next test:** fill all 4 seats with auto-player clients and no Forge AI, to measure pure engine time.
  - **Decision:** the bridge uses patches (`client_version` ≥ 3.17.0) from now on. This also suits TTS: the bridge can forward only what changed.

- **Test 2c, four test clients and no AI (2026-10-17):** four `engine-test.js` processes, one per seat (`--bots 0`), all using change-only patches. One shared 12-turn game, 500 responses. The engine sent 494 patches to each seat, with 0 fingerprint mismatches and 0 resyncs.

  | | p50 | p95 | p99 | max |
  |---|---|---|---|---|
  | **Total: response → next engine message** | **21.5 ms** | 91 ms | 162 ms | 359 ms |
  | Engine time (`engineMs`) | 14 ms | 83 ms | 159 ms | 353 ms |
  | Relay hop | 4 ms | 16 ms | 37 ms | 94 ms |
  | Direct replies only (mana, targets, cards) | 34 ms | 119 ms | — | 131 ms |

  - Messages average about 0.9 KB.
  - 56 of the 500 samples took over 60 ms of engine time: 43 after a `chooseAction`, spread across all turns. These are most likely spells resolving and turn-step processing (untap, draw, triggers).
  - The test machine also ran the 4 Node clients alongside Docker on a 6-core Ryzen 5 3500, so some of the tail may come from CPU contention.
  - **Verdict:** for the typical action, the pure engine plus relay is fast (about 22 ms). The p95 is about 90 ms, which goes slightly over the 80 ms target for "engine accepts", and the cost is inside Forge, not the network.
  - **Estimated 4-human click-to-update before TTS rendering:** about 10 ms (TTS hop) + about 22 ms, so about 32 ms typical and about 105 ms p95.

**Test order:**
1. **Echo test** (needs only TTS and the bridge, no Manabrew; can run today). Send 1,000 pings from Lua and record p50/p95/p99. This shows whether the External Editor channel's one-connection-per-message design is fast enough.
2. **Engine round trip.** A bot game in a 2-seat Forge room: the bridge answers prompts automatically. This measures the engine alone.
3. **Full path, 4 seats.** Scripted Commander games with 4 bot-controlled seats driven through TTS. Measure render time on a large board.
4. Compare the WebRequest fallback against the External Editor API on the same tests.

## 7. Player count

| Layer | Limit | Source |
|---|---|---|
| TTS | 10 seated colors | TTS |
| Manabrew relay, room creation | clamped to 2–8 | `manabrew-server/src/room.rs:83` |
| Manabrew relay, in-lobby "set max players" | clamped to 4 | `manabrew-server/src/lobby.rs:640` |
| Manabrew relay, lobby reset | resets to 4 | `room.rs:158` |
| Self-hosted node | `SELF_HOSTED_NODE_MAX_PLAYERS` (u8, no own cap) | `self-hosted-node/src/config.rs:103` |
| Forge | up to 8 (its own network play) | Forge wiki Network-Play |
| Manabrew docs | "commander up to 4 players" | docs.manabrew.app |

**v1 targets 4 players.** 5–8 players is a stretch goal. The node's env var probably creates a room with up to 8 seats, but this is untested. The bridge sets the seat count itself and never calls `SetMaxPlayers`, so the 4-seat lobby cap shouldn't apply. Test 5 and 6 players after the 4-player tests pass.

### The 6-player table (added 2026-10-31, not started)

Goal: bring **"MTG 6 player table - scripted"** to the same state as the 4-player engine table: our scripts on it, the background objects removed, the table buttons added. Workshop 2293586471, by the same author, is on the host's PC at `Mods/Workshop/2293586471.json` (v14.2.1, 282 objects, 592 with contents). The engine side already works with 6 seats (`SEATS=6`, M6).

**Compared with the 4-player table (read-only, 2026-10-31):**
- The UI XML is identical. Global is about 97% the same: 2,800 lines against 2,804, 83 lines only in the 6-player table, 65 only in the 4-player.
- Those lines are what make it a different table: seat lists (White, Red, Yellow, Green, Blue, Purple), every seat's zone GUIDs, and the layout numbers (`revealUp`, `exileRot`, `gravFor`).
- 81 of its 97 distinct object scripts are identical to the 4-player table's. The rest include older versions: Card Importer 6.4 (6.6 on the 4-player table), the Encoder and the Hand Counters.
- It carries the same hard-coded Steam IDs, so `tools/make-engine-copy.js`'s security patches are needed here too.

**So don't copy the 4-player script over it.** Pasting it would point at GUIDs that don't exist on this table and lose Green and Purple. Run the same patches against this table's own scripts instead:

1. `tools/make-engine-copy.js`: take a table profile (source file, seats, GUID maps, layout) instead of assuming the 4-player one. Its find-and-replace patterns must be re-checked against this table's older scripts, and it must report any that don't match.
2. `tools/engine-renderer.lua`: move its hard-coded tables into per-table data. `CMD_DAMAGE` and `TAX_LABELS` name GUIDs for four colours, and `TABLE_COLORS` in the bridge lists four. Commander damage needs five attackers per seat. The main chunk is at about 194 of 200 locals, so this data can't add locals.
3. Remove the background objects by this table's own list: its GUIDs differ.
4. Add the table buttons (Ready, Start, Scoop and the rest) at positions for six mats.
5. Turn order: extend the clockwise seat order to six colours.

**Blocker: the UI size limit.** The screen UI grows about 10.5 KB per seat: 25 KB for one seat, 56.5 KB for four, so **about 77.5 KB for six**. The limit is 60 KB, because past about 64 KB the second player's buttons stopped working. Six seats need about 18 KB cut, or a different layout: one shared panel across seats, or building each panel only for the player using it. Do this first, and confirm with two real players that buttons still work at the new size.

**Testing:** a separate golden recording for this table, and a 6-player game (host plus AI seats) on the real table before calling it done.

## 8. The External Editor port conflict

TTS sends all of its editor traffic to one port, 39998: script contents, `print()` output, errors, "game saved". Whichever program is listening there gets it. The VSCode and Atom TTS plugins listen on that port so you can edit scripts live. Two programs can't hold the same port, so:
- While the bridge runs, the host can't use the VSCode/Atom plugin's live features (Get Scripts, Save & Play, console output in the editor).
- This only matters to whoever is developing the mod. Players never notice.
- Mitigation (phase 2): the bridge forwards any non-custom messages (IDs 0–3, 5–7) to a second port, and the editor plugin is pointed there. Until then, edit scripts in TTS's built-in editor or stop the bridge while editing.

## 9. Licensing

- Manabrew is AGPL-3.0, and Forge is GPL-3.0. We run them **unmodified** as separate processes.
- The bridge and the TTS mod are new code that talks to Manabrew over the published protocol (CC-BY-4.0, which invites independent implementations). We don't copy any Manabrew source.
- For private play with friends, nothing is triggered either way. Before publishing the mod on the Workshop, review this again.
- Card images come from Scryfall under its usage guidelines. Card text and art belong to Wizards of the Coast; this is a non-commercial fan project.

## 10. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Stack runs | The relay and node run with a Forge room, and a 4-player Commander game completes in Manabrew's own web client. **Done**: the stack runs via `stack/compose.yml` (2026-10-17); 4-player games have been played to the end headless and in TTS. |
| M0.5 | Rules check | A checklist passes: commander tax, commander damage 21, command zone return, priority order across 4 players, player elimination, turn order after elimination. **Done 2026-10-20**, headless against Forge (`tools/rules-check.sh`, `bridge/priority-check.js`) |
| M1 | Echo + latency harness | §6 test 1 passes the target. **Done 2026-10-17: p50 10.4 ms, p99 13.7 ms** |
| M2 | Bridge ↔ engine | Bridge plays a 2-seat bot game headless and logs latencies (§6 test 2). **Done 2026-10-17, for both 2 and 4 seats; see §6** |
| M3 | Minimal TTS render | Text-only board plus button prompts; a 2-player game is playable end to end in TTS. **Done**: built 2026-10-17, played in real TTS against Forge AI and as a 1v1 with a friend over TTS multiplayer (2026-10-19). |
| M4 | Real table | Card objects, zones, stack column, hidden hands, all prompt widgets, 4 players. **Built** on the group's table (ENGINE MODE); 4-player games vs 3 AIs played to turn 100+ (125 permanents: 127 fps, reset under 1 s). Left: hand privacy checked by a second person, 4 humans |
| M4.5 | Rewind by vote | "Undo…" lists engine checkpoints; restore vote panel; uses existing `requestRestore`/`restoreVote` directives (§10c Tier A) |
| M5 | Arena feel | `fx` layer: shake, sounds, damage popups, turn banners |
| M6 | 5–8 players | §7 stretch tests |
| M8 | Game modes | Standard 1v1, 2v2 teams, Juggernaut 3v1 (one player with more life, cards and draws). Needs teams and per-player life/hand/perks in the engine (fork). Spec: [docs/game-modes-spec.md](docs/game-modes-spec.md) |
| M7 | Manual fix mode by vote | Vote → pause → hand-edit in TTS → change list → confirm vote → engine applies via new `applyState` directive (§10c Tier B; needs a Manabrew/forge-harness fork or upstream PR) |

## 10a. Interactive play: tabletop freedom, Arena rules (decided 2026-10-17)

**What the user wants.** Players use the table the way they always have: dragging cards, right-clicking the deck, and using the table's own buttons. The engine watches every move and decides whether it's allowed, the way MTG Arena does. Each player can only touch their own colour's area.

The current build feels like "a pocket universe inside the game": the engine draws its own copy of the game and players answer it through a panel. That gets inverted:

> **Every physical action is a request.** The bridge turns it into the matching engine action. The engine accepts it, and the card stays where it was put, or refuses it, and the card snaps back with a one-line reason ("Sorceries can only be cast in your main phase").
>
> The engine stays the only source of truth; the table is how you talk to it.

| Player does (on their own colour's area) | Engine action | If not allowed |
|---|---|---|
| Drag a card from hand onto the battlefield / land area | Play the land or cast the spell (`chooseAction` act for that card) | Snap back + reason |
| Drag the commander from the command zone to the battlefield | Cast the commander (tax included) | Snap back |
| Rearrange your own permanents inside your area | Nothing; it's cosmetic. The position is remembered while the card stays on the battlefield | Moves outside your area snap back |
| Tap a land / mana source while paying (rotate, or click) | Activate its mana ability | Snap back to untapped |
| Tap creatures / drag them forward during declare attackers; drag a blocker onto an attacker | Attack / block assignments | Illegal attacker or blocker snaps back |
| Click a highlighted card or player while choosing targets | That target | Only legal targets are highlighted |
| Drag a hand card to the graveyard when asked to discard; to the library when putting cards on the bottom | That choice | Anything else snaps back |
| Right-click your deck → Search, when a tutor asks you to search | The searchable deck holds exactly the cards the engine allows; taking one out is the choice | — |
| Right-click a permanent | Its activated abilities as menu items, which the engine lists | — |
| Table buttons: Mulligan, Untap, Draw, Scry, Mill | Mapped to the engine wherever a decision exists (Mulligan answers the mulligan prompt; Scry opens the πScry top/bottom/graveyard buttons for an engine scry). Steps the engine does itself (untap, draw) animate on their own | Button explains why it can't act now |
| Nothing to do | Passing priority is automatic when you have no playable actions, as on Arena | — |

**Restrictions:**
- **Your own area only:** you can pick up only cards you control on your playmat, in your hand, or in your command zone.
- **Opponents' cards:** look and zoom only. You can still click them as targets.
- **The panel:** stays for decisions that have no natural gesture, such as modal choices, numbers, "may" yes/no, and stack responses. It also shows status and "Pass".

**Phases** (PLAN M4 "interactive"):
1. **P1:**
   - Fix the turn-message spam.
   - Own-area restriction.
   - Drag from hand or command zone onto the battlefield to play or cast, snapping back with a reason when it's not allowed.
   - Rearranging your own permanents.
   - Discard / put-back by dragging.
   - Automatic pass when nothing is playable.
   - A game log in chat (draws, casts, tutors) so plays can be followed.
2. **P2:** tap to pay; tap/drag to attack and block; click to target, with legal targets highlighted; right-click ability menus.
3. **P3:**
   - Library as a real face-down deck: tutor searches with right-click → Search; draws animate from it.
   - Table buttons mapped (Mulligan, Scry via πScry, Draw, Untap).
   - Mill and reveal animations.
4. **P4:** Arena-style feel (§5 effects: highlights, sounds, shake).

## 10b. Companion app (.exe), added 2026-10-17

**Full spec (2026-10-20): [docs/companion-app-spec.md](docs/companion-app-spec.md)** (Tauri shell + the bridge as a sidecar; Home / Cloud Forge / Own server modes; one-click game night with the cloud server created and deleted automatically). The notes below are the original idea.

A small Windows app that the TTS host runs instead of terminal commands. On launch it asks for one choice:

| Mode | What runs on the host's PC | What runs elsewhere |
|---|---|---|
| **Self-host** | Bridge, plus the relay and Forge room (Docker stack started and stopped by the app) | — |
| **Dedicated server** | Bridge only | Relay and Forge room on a server; the app asks for its address (`wss://…`) and server key |

**Why the bridge always stays on the host's PC:** TTS only talks to `localhost` through the External Editor API (§2). So in dedicated mode, only the engine moves off the PC; the bridge connects to the remote relay instead of `ws://127.0.0.1:9443`.

**App features:**
- A status light for each part (Docker, relay, Forge room, TTS connected), plus a "Restart room" button.
- A latency readout, using the same timing as the test harness.
- Remembers the last mode and server.
- Shows a port 39998 warning if the VSCode TTS plugin is holding it.

**How it could be built:** wrap the Node bridge in a single exe (Node SEA or `pkg`) with a small UI, either a tray app or a local web page. A Tauri or Electron shell is also possible but heavier. Self-host mode needs Docker Desktop installed; the app can check for it and link to setup steps (virtualization in BIOS, WSL2).

**Dedicated server to-dos:**
- Make the relay reachable through TLS (Caddy, as in Manabrew's `hosting-full-stack` docs).
- Choose a strong server key.
- Measure the added delay: the internet round trip is added to every action. Manabrew's measured relay round trip between two home connections was about 62 ms.

## 10c. Feature: manual fix mode by vote (added 2026-10-17, not scheduled yet)

**Goal:** if the engine gets something wrong (a bug, a misclick, an interaction Forge doesn't handle), the players can vote to pause enforcement and fix the board by hand in TTS. The engine then accepts the corrected board and carries on enforcing from there.

There are two tiers. Tier A covers most mistakes and already exists in the engine.

### Tier A: rewind by vote (already in Manabrew's Forge backend)
Manabrew's Forge engine already records restore points and runs a restore vote:
- `gameView.snapshotRecording` is on, and `gameView.checkpoints` lists the restore points (`CheckpointDto`).
- **To request a restore:** send `directive: {type: "requestRestore", checkpointId}`. The engine opens `gameView.restoreVote` (`voteId`, `checkpoint`, `requestedByPlayerId`, `awaitingPlayerIds`, `status`: pending, approved, declined or unavailable).
- **To vote:** each awaited seat sends `directive: {type: "restoreVote", voteId, accept}`.
- The self-hosted node already passes these directives on to Forge (`self-hosted-node/src/host.rs`, `route_seat_envelope`).

**TTS work:**
- An **"Undo…"** button lists the checkpoints by turn and step.
- A vote panel appears for every awaited player, showing Accept and Decline plus who asked.
- The result goes to chat.
- No engine changes are needed. This can ship with M4, or even on the M3 text board.

### Tier B: hand-edit the board, then hand it back to the engine (new engine work)

**Full spec (2026-10-20): [docs/m7-manual-fix-spec.md](docs/m7-manual-fix-spec.md)**: cards are placed on snap points the table adds to every playmat during fix mode, so each spot maps to exactly one zone of one player; the change list becomes one `applyState` directive. Tier A (rewind by vote) is built (M4.5).
1. **Call the vote.** Any player presses **"Manual fix"**. Everyone else gets Accept/Decline. The rule is configurable: unanimous by default, majority as an option. Only allowed when the stack is empty and no prompt is mid-resolution.
2. **Pause.** The bridge stops forwarding prompts and holds the engine, and TTS shows "MANUAL MODE" to everyone.
   - **On the physical board (M4):** engine-owned objects are unlocked so players can drag cards between zones, tap and untap, and add or remove counters.
   - **On the text board (M3):** the same edits are made through buttons: move a card to a zone, tap/untap, counters ±, life/poison/commander damage ±.
3. **Review.** When someone presses **"Done"**, the bridge compares the TTS board with the engine's last state. It shows everyone a change list, for example: *"Llanowar Elves: graveyard → battlefield"* or *"White life 31 → 34"*.
4. **Confirm vote.** Everyone accepts the change list, using the same rule as step 1.
5. **Apply.**
   - The bridge sends a new directive, `applyState {changes}`, to the engine host.
   - The engine host records a checkpoint first, so the fix itself can be rewound with Tier A.
   - It then applies the changes to the live Forge game, checks state-based actions, and resumes.
   - The engine's next `state` resyncs every TTS seat.
6. **Log.** Chat and the bridge log record who called it, who voted, and the exact changes.

**What Tier B can change:**
- Move existing cards between zones, attach and detach.
- Tap and untap; counters; life, poison and commander damage.
- Create tokens by name.

**What it can't change:** cards can't be invented or turned into other cards. Effects that aren't board state can't be edited: "until end of turn" continuous effects, delayed triggers, copy effects, the stack. For those, use Tier A and replay.

**Engine changes needed:** this goes beyond Manabrew's current protocol.
- **Protocol:** a new `DirectiveInput` variant in `manabrew-protocol`, plus the TS/Java DTO regeneration (`yarn gen:types`, `yarn build:harness`).
- **Engine host:** a handler in the Java `forge-harness` that applies the changes through Forge's game-state tools. Forge's puzzle/"Setup Game State" dev feature (`forge-ai` `GameState`) already applies zones, tapped status, counters and life to a running game. **To verify** once the `forge/` submodule is checked out.
- **Running it:** we'd run a modified node image built from our fork, or upstream it as a PR to Manabrew. Licensing: private use is fine. If a modified relay or node is offered to other people over the network, AGPL requires offering them its source.

**Depends on:**
- Tier A: M3 or M4.
- Tier B: M4 (physical cards) for drag editing; the button version could come earlier.

Planned as milestone **M4.5** (Tier A) and **M7** (Tier B).

## 11. Open questions

- Does Manabrew's Forge backend handle every Commander rule correctly? (M0.5 answers this.)
- How far does the External Editor API scale? Large states are big JSON; check whether TTS truncates them and whether the bridge needs to split them into chunks.
- ~~How fast can TTS move or spawn ~150 objects in one update?~~ Answered 2026-10-20: a 125-permanent board updates in 36 ms on average (worst 152 ms).
- How do decks get from TTS to Forge? The `hello` message carries the deck lists; the bridge needs to map them onto Manabrew's deck submission.

## Turn timer and AFK votes (added 2026-10-19)
- **Turn timer:** an optional per-turn timer. When it runs out the turn is **not** skipped automatically: the other players get a vote ("Skip their turn?"). With a majority, the bridge answers the stalled player's open prompt with its default (pass, no attack, no block) until their turn ends.
- **AFK vote:** any player can start a vote to mark someone away. With a majority, that player's turns pass automatically (or a Forge AI covers the seat, chosen by the vote) until they press "I'm back" in their panel.
- Both use the same vote panel as the planned rewind and manual-fix votes (SPEC §10c).

## Friendly mulligans by vote (added 2026-10-31, not scheduled)

Built on 2026-10-31 and taken out on 2026-11-01 at the user's request, while they chased a choppy PC. The built code is kept in `tmp/backup/update-2026-10-31/`, not in the source.

The table votes on how many free mulligans each player gets: none, 1 or 2. A free mulligan is a new 7 with nothing put on the bottom. When a player has used theirs, the game says so and that player's mulligans cost a card again.

### How it plays

- **Vote:** a small button under each player's READY, on their own mat: **Friendly: none**, click for **1**, click for **2**, click for none. `mtg friendly 0|1|2` does the same. The vote can change until Start. AI seats don't vote.
- **Result:** at Start, the count with the most votes wins, and a tie goes to the lower count. No vote counts as none, so with two players the lower of the two votes wins.
- **Announced at the start:** `[MTG] Friendly mulligans this game: 1 each (White voted 1, Blue voted 2).` Nothing is said when the result is none.
- **Each free mulligan:** `[MTG] White took a friendly mulligan (1 of 2).`
- **Going back to normal:** `[MTG] That was White's last friendly mulligan: their next one costs a card.` When the first turn starts, after a game with friendly mulligans: `[MTG] Friendly mulligans are over: normal rules from here.`
- **On the question:** the button reads **Mulligan (free)** while the next one is free, and the panel says how many are left. When keeping costs cards it says how many go on the bottom.
- **Counted per player**, not per table: White taking two doesn't use up Blue's.
- **With 3 or more players**, the rules already make the first mulligan free, and Forge does this by itself. The vote adds to it: "none" is the normal rules, "1" means two free in a 4-player game. Friendly mulligans are spent after the rules' free one.
- **AI players** take normal mulligans. Forge's AI doesn't go through our controller.

### How the engine stays involved

- Forge's `London` mulligan is the default rule, and `MulliganService` asks the controller `mulliganKeepHand(firstPlayer, cardsToReturn)` once per decision. Our harness controller (`ManaBrewInteractiveController`), not Forge, puts the cards back when the player keeps, and its `tuckCardsViaMulligan` returns nothing.
- So this needs **no change to `forge/`**, which stays read-only. The old PLAN note saying it needs a Forge change is out of date. The bridge can't do it alone, because `mulliganPutBack` must be answered with exactly N cards.
- **The number travels with the Keep answer**, as a new optional field. Sending it through `StartGame` was the other option: that touches the relay protocol, `connection.rs`, `lobby.rs`, the node and all four `StartGame` senders, to carry one number only the bridge uses. The answer route is five small edits. Both routes need both images rebuilt.

### Engine changes (`manabrew/`, no comments, both images rebuilt)

| File | Change |
|---|---|
| `manabrew-rs/crates/manabrew-protocol/src/prompts/mulligan.rs` | `MulliganDecision { keep: bool, #[serde(default)] free_cards: u32 }` (`freeCards` in JSON, the enum is camelCase). Regenerate the ts-rs type |
| `manabot/src/agent/simple_ai.rs:1225`, `manabrew-agent-interface/src/agent_impl/choices.rs:171`, `self-hosted-node/src/engine_backend/java_backend.rs:2096,2128,2132` | Patterns get `..`, constructors get `free_cards: 0`. If the node rebuilds the answer at `:2096`, it must carry the field on |
| `forge-harness/.../host/ManabrewProtocolAdapter.java` (`case "mulligan"`) | Copy `freeCards` into the flat action as `free_cards` |
| `forge-harness/.../host/ManaBrewInteractiveSession.java` (`awaitMulliganDecision`) | Remember the action's `free_cards` in a field, read back with `takeMulliganFree()`, which resets it to 0 |
| `forge-harness/.../host/ManaBrewInteractiveController.java` (`mulliganKeepHand`) | See below |

```java
final boolean keep = session.awaitMulliganDecision(me(), cardsToReturn);
final int owed = Math.max(0, cardsToReturn - session.takeMulliganFree());
if (keep && owed > 0) {
    final CardCollection hand = new CardCollection(player.getCardsIn(ZoneType.Hand));
    final CardCollection selected = session.awaitMulliganPutBack(me(), hand, owed);
    ...
```

The relay takes the field on trust from the client. That's fine for a private table, where the bridge is the only client. `Math.max` keeps a wrong number harmless.

### Bridge changes (`bridge/bridge.js`)

- `case "start"`: read `m.friendlyVotes`, work out the result with a new `friendlyCount(votes, humans)` (most votes, tie goes lower, a missing vote is 0, anything but 0/1/2 is 0), and pass it to `startGame`. Goes in the `go` closure, so a Start that only resumes a running game changes nothing.
- `startGame`: `game.friendly = n`. The crash-recovery snapshot lists its fields by hand, so add `friendly` to its `game` part or a bridge restart would lose it.
- `Seat`: new `mullsTaken`, counted when a Mulligan is answered, and added to the snapshot's seat list the same way. `input.mulliganCount` can't be used for this: it's the cards owed, so it stays 0 after the free one in a 4-player game.
- `mulliganCost(seat)`: `rulesFree = game.total > 2 ? 1 : 0`, owed = `max(0, taken - rulesFree - game.friendly)`.
- `case "mulligan"` in `onPrompt`: the label and text above. Keep the option ids `keep` and `mull`, because the Mulligan tiles look for `mull`.
- `toOutput`: add `freeCards: game.friendly` when it's above 0. The timer's automatic answer goes through the same `toOutput`, so it's covered.
- Chat and game-log lines above: the start line in `startGame`'s announcement, the per-mulligan lines where `mullsTaken` goes up, the "over" line on the first turn.

### Table changes (`tools/engine-renderer.lua`, `tools/make-engine-copy.js`)

- `engineFriendlyVote = {}` (colour -> 0, 1 or 2), a global: the main chunk has no locals to spare.
- In the setup draw, beside the READY button: `setupButton(mat, "onMtgSetupFriendly", "Friendly: " .. label, SETUP.color.wait, spot, c)`, moved further along the same line from the Draw button. A mat button adds nothing to the 60 KB screen UI.
- `onMtgSetupFriendly(obj, playerColor)`: finds the mat's colour as `onMtgSetupReady` does, refuses another player's click with the same message, moves to the next count and redraws.
- `make-engine-copy.js`: `mtg friendly 0|1|2` in the chat commands and `mtg help`; `friendlyVotes = engineFriendlyVote` in the `start` message.
- The vote carries over to the next game, so a rematch needs no clicks. A table reload clears it.

### Tests and rollout

- **Bridge goldens:** the result for each vote mix (ties, missing votes, a bad value); 2 players with 1 free; 4 players with 1 free; the last-free line; a timer's automatic Keep; a bridge restart between mulligans.
- **Table claims:** the button cycles, another player's click is refused, Start sends the votes, a resumed game starts no vote.
- **Engine, headless, on a second container** (room `tts-test`, the running table isn't touched): with 2 free, two mulligans keep 7; with 1 free, two mulligans put 1 on the bottom; a game with 3 players; `freeCards` absent behaves as today.
- **Break it on purpose** (`jr-programmer-suite` §2b), then one real game with two people.
- **Rollout:** tag the current images for rollback, convert `.sh` to LF, build `mtg-relay:friendly` and `mtg-forge-node:friendly` (about 20 minutes for the node, most of it the native step), update `stack/compose.yml`. Only between games: never swap images mid-game, and the table push needs the decks off the table. Then HOW-TO-PLAY.md, README.md and the PLAN note.
