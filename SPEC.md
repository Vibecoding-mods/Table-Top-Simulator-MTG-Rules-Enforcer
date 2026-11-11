# Spec: Rules-enforced MTG Commander in Tabletop Simulator

Status: v0.3, 2026-11-05 (v0.2 2026-10-20, v0.1 draft 2026-10-17). M0–M4.5 and M7 built, M5 steps 1–2 built; see the
milestone table in §10.
Background: the original hand-off notes (private)
Progress tracking (done / to do): [PLAN.md](PLAN.md)

## 1. Goal

Play Magic: The Gathering Commander in Tabletop Simulator (TTS) with full rules enforcement and MTG Arena-style automation: automatic triggers, a visible stack, priority passing, and damage and life alerts. Effects are a later layer (M5).

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
| **manabrew-server** | Manabrew, our build (`mtg-relay:exile`) | Relay, lobby and rooms. |
| **self-hosted-node** | Manabrew and its Forge harness, our build (`mtg-forge-node:exile`; patches in `engine/`) | Hosts the room and runs Forge, which is the authority on game state. |

Everything runs on the host's PC. The other players only need TTS and join the host's TTS server as normal. TTS copies objects and UI to them, and their button clicks run in the host's Lua.

### Why the External Editor API and not WebRequest
- `WebRequest` is HTTP only and can't receive pushed messages, so the engine's updates would need polling.
- The External Editor API pushes: the bridge sends `{"messageID": 2, "customMessage": {...}}` to `localhost:39999`, and TTS calls `onExternalMessage(table)` in Global Lua. Lua calls `sendExternalMessage(table)`, which arrives at the bridge listening on `localhost:39998` as `messageID 4`.
- Port 39998 can only be held by one program. While the bridge is running, the VSCode/Atom TTS plugin can't connect (see §8).
- **Fallback:** if the External Editor API turns out unreliable, the bridge also serves HTTP on `localhost:8787` and Lua long-polls it with `WebRequest`.

## 3. Bridge ↔ engine (Manabrew relay protocol)

- Connect to `ws://127.0.0.1:9443` with the server key, once per TTS seat (each with a username such as `tts-White`).
- Join the node's room. Every session readies up. The bridge's controller seat (the first human seated) sends
  `StartGame`: the node's own auto-start can't start a hosted room (engine-interface-reference §11, #7).
- From the engine, per seat:
  - `StateUpdate`: either a full `gameView` or a patch. The bridge applies patches and keeps the full state.
  - `AgentPrompt`: a decision for a player.
  - `DisplayEvent`.
  - `ProtocolError`.
- To the engine: `{kind: "response", promptId, action}`, sent exactly once per prompt and echoing the most recent `promptId`. Also directives: `concede`, `requestRestore` and `restoreVote` (rewind, M4.5),
  and our own `applyState` (manual fix, M7).
- **Reference client:** `manabrew-rs/crates/manabot`, a headless bot that joins rooms over the relay. Copy its connection flow: `JoinRoom`, ready, and `RequestResync` on reconnect.
- **The working flow** (first verified in `bridge/engine-test.js`), step by step with every message:
  [docs/engine-interface-reference.md](docs/engine-interface-reference.md) §2.5.
- The message definitions live in `manabrew-rs/crates/manabrew-relay-protocol/src/lib.rs` and `manabrew-agent-interface`. The public spec is https://docs.manabrew.app/protocol/.

## 4. Bridge ↔ TTS message format

Every message is a Lua table (TTS ignores anything else). Below is the first design (2026-10-17). The messages as
built (`table`, `prompt`, `answer`, `intent` and the rest) are listed in
[docs/our-code-reference.md](docs/our-code-reference.md), "TTS → bridge" and "Bridge → TTS". The first design's fields:

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

The stretch of work on this rule agreed 2026-11-03 (PLAN "The next 1½–2 days") is done, built 2026-11-03 and live
since 2026-11-04 (`0cf0e21`):
- **Causes for costs and special actions.** The harness names a move made by paying a cost or taking a special
  action: cycling's discard, delve's and escape's exile, a sacrifice as a cost, and foretell, plot and suspend.
- **Every zone move on one pattern.** Exile, hand and leave-the-battlefield moves have a kind function and a wording
  table (`EXILE_WORDS`, `HAND_WORDS`, `LEAVE_WORDS`), as moves out of a library have.
- **A keyword sweep.** Test cards are chosen from Forge's cardsfolder by keyword and run on two test stacks. A keyword
  whose log line is wrong is fixed through its cause and label, never with its own path.

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

**Locking.** ~~All engine-owned objects get `setLock(true)` and `interactable = false`. Players can't drag them.~~
Changed 2026-10-17: players drag their own cards and the engine checks every move (§10a).

**Prompts** are UI XML panels, made visible only to the deciding seat with the `visibility` attribute. One generic widget per prompt shape:

| Widget | Covers Manabrew prompts |
|---|---|
| Button list | `chooseAction` (including Pass), yes/no, modes |
| Card picker (click highlighted cards on the table, then Confirm) | `chooseCards`, `chooseBoardTargets` |
| Number picker | `chooseNumber`, X costs |
| Attack/block assignment (click a creature, then a player or attacker) | `chooseAttackers`, `chooseBlockers` |
| Mana payment (auto-pay button plus manual) | `payManaCost` |

Unknown prompt kinds fall back to a button list built from the bridge's `options`, so new prompt types never stall a game.

**Effects (M5):** the plan is [docs/m5-plan.md](docs/m5-plan.md). Camera shake was dropped there: Arena has none.

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

The test tools log one CSV row per sample: `bridge/echo-bridge.js` to `bridge/latency-echo.csv`, `bridge/engine-test.js` to
`bridge/latency-engine-<seats>p.csv`. The game bridge (`bridge/bridge.js`) writes no latency CSV. To keep clocks honest, the bridge and Lua sync their clocks with `ping` messages at startup (NTP-style midpoint).

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
1. **Echo test** (needs only TTS and the bridge, no Manabrew). Send 1,000 pings from Lua and record p50/p95/p99. This shows whether the External Editor channel's one-connection-per-message design is fast enough. **Done** (test 1).
2. **Engine round trip.** A bot game in a 2-seat Forge room: the bridge answers prompts automatically. This measures the engine alone. **Done** (tests 2 to 2c).
3. **Full path, 4 seats.** Scripted Commander games with 4 bot-controlled seats driven through TTS. Measure render time on a large board. **Done 2026-10-20:** 125 permanents, board update 36 ms on average, worst 152 ms (PLAN M4, test 3).
4. Compare the WebRequest fallback against the External Editor API on the same tests. Not needed: test 1 passed.

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

**v1 targets 4 players.** M6 is the stretch goal, cut from 5–8 to 4–6 players on 2026-11-05. The node's env var does make a bigger room: `SEATS=6` seated all 6 and played 12 turns headless (2026-10-20, PLAN M6). The relay resets the room to 4 seats after every game (engine-interface-reference §10), so the bridge's controller seat sends `SetMaxPlayers` when a game needs more. That message is capped at 4 (`lobby.rs:640`, unchanged in our relay build), so a second 5–6 player game without a node restart would need a relay change. On the table, the bridge refuses more than the 4 colours in `TABLE_COLORS`, so 5–6 players need the 6-player table below.

### The 6-player table (added 2026-10-31, not started)

**The build plan is now `docs/m6-six-seat-spec.md` (2026-11-05)**: port steps, UI shrink order, the relay change (`lobby.rs:640` to 8, plus the node's AI cap of `SEATS − 1` and the stack's default of 4), bridge seats and tests. It supersedes the numbers below; the UI measurements are in `docs/m6-ui-size.md`.

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
- With nothing set up, while the bridge runs the host can't use the VSCode/Atom plugin's live features (Get Scripts, Save & Play, console output in the editor).
- This only matters to whoever is developing the mod. Players never notice.

**Built 2026-11-05 (bridge/editor-forward.js, wired into bridge.js; off unless a port is set).** The bridge keeps 39998 and passes the plugin its share:
- TTS → bridge (39998) → plugin (a second port, `MTG_EDITOR_FORWARD_PORT`). Which messages go where (by TTS's message ID):
  - Prints (2), errors (3), "game loaded" (1) and unknown IDs: both the plugin and the bridge.
  - "Game loaded" that answers the plugin's own Get Scripts (within 5 s): the plugin only, so the table is not redrawn.
  - Object pushed (0), game saved (6), object created (7): the plugin only.
  - Custom messages (4): our table's (a string `t`) to the bridge only; any other to the plugin only.
  - Lua return values (5): numbers from 1,000,000,000 up are the bridge's own Execute Lua (it now numbers them from there); lower ones the plugin's.
- Plugin → bridge (a third port, `MTG_EDITOR_COMMAND_PORT`) → TTS (39999): Get Scripts, custom messages and Execute Lua go through as sent.
- **Save & Play from the plugin goes through only when it can't wipe the table.** In this order: no game is running; the table check (the same one as tools/tts-push-global.js) answered within 10 s and found none of the player's own cards or decks; the save file (`MTG_TTS_SAVE`, default `Saves/TS_Save_1.json`) was copied to `tmp/backup/`. Otherwise the plugin's console shows `[MTG bridge] Save & Play blocked: <reason>`, and the bridge logs it.
- Sends to the plugin never hold up the bridge: one at a time, a 1 s timeout, and when the plugin isn't listening its messages are dropped for 5 s at a time.
- Tests: tests/test_editor_forward.js (the module), tests/test_bridge_claims.js (the wiring: off by default, offer first, the bridge's Execute Lua numbers).

**The developer's setup (once):**
1. Install "Tabletop Simulator Lua" (rolandostar, 1.1.3) in VSCode.
2. Close VSCode. In `%USERPROFILE%\.vscode\extensions\rolandostar.tabletopsimulator-lua-1.1.3\dist\extension.js`, change `39998` to `39996` and `39999` to `39997` (each should appear once; count first).
3. Start the bridge with `MTG_EDITOR_FORWARD_PORT=39996` and `MTG_EDITOR_COMMAND_PORT=39997` (or `--editor-forward-port 39996 --editor-command-port 39997`). Then start VSCode.
4. After any extension update, redo step 2.
- Without the 39999 edit the plugin still gets prints, errors and scripts, but its Save & Play goes straight to TTS and the bridge can't stop it. Then never use Save & Play with a game or the player's decks on the table.
- A risk with or without this: the unedited plugin retries 39998 every second. If it is open while the bridge restarts, it takes the port and the new bridge exits with "Port 39998 is taken". The step 2 edit removes this; until then close VSCode's TTS plugin before restarting the bridge.
- Not checked live yet: that TTS returns a returnID this big unchanged (it is under the 32-bit limit, 2,147,483,647). Check once with `POST /exec` (`return 1`) after the next bridge restart.

## 9. Licensing

- Manabrew is AGPL-3.0-or-later, and Forge is GPL-3.0. We run **our own modified builds** of both as separate
  programs (`mtg-relay:exile`, `mtg-forge-node:exile`; the stock images can't run this table).
- Our changes to them stay under their licences, and their source is published: `engine/manabrew.patch` and
  `engine/forge.patch` against pinned upstream commits, built by `engine/build-images.sh` ([engine/README.md](engine/README.md)).
  The AGPL also covers a modified engine offered to people over a network, such as a server for friends.
- Our own code (the bridge, the table script, the tools) is public domain under the Unlicense (`LICENSE`). It talks to
  Manabrew over the published protocol (CC-BY-4.0, which invites independent implementations).
  `bridge/state-delta.js` was rewritten from that protocol spec, so no Manabrew code is left in it.
- Details: README.md "Credits and legal", THIRD-PARTY-NOTICES.md, [docs/publishing-checklist.md](docs/publishing-checklist.md).
  Before publishing the mod on the Workshop, review this again.
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
| M4.5 | Rewind by vote | "Undo…" lists engine checkpoints; restore vote panel; uses existing `requestRestore`/`restoreVote` directives (§10c Tier A). **Built 2026-10-20**; the rewind race fixed and a "Rewind to <point>" button added 2026-11-01 to 11-03. Left: a 2-person vote test |
| M5 | Arena feel | Effects: glows, target lines, turn banners, life changes, badges, sounds, particles. Steps 1–2 **built** 2026-10-21/22; the sync test, particles and sounds are open. Plan: [docs/m5-plan.md](docs/m5-plan.md) |
| M6 | 4–6 players (was 5–8, cut 2026-11-05) | §7: 6 seats work headless (2026-10-20); the 6-player table is not started |
| M8 | Game modes | Standard 1v1, 2v2 teams, Juggernaut 3v1 (one player with more life, cards and draws). Needs teams and per-player life/hand/perks in the engine (fork). Only the Ready / Start buttons are built (2026-10-21). Spec: [docs/game-modes-spec.md](docs/game-modes-spec.md) |
| M7 | Manual fix mode by vote | Vote → pause → hand-edit in TTS → change list → confirm vote → engine applies via new `applyState` directive (§10c Tier B). **Built 2026-10-23** on our own engine builds; `mtg debug` sets up its boards through it (2026-11-04). Left: a 2-person live test; "fix from hand" is spec only. Spec: [docs/m7-manual-fix-spec.md](docs/m7-manual-fix-spec.md) |

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

**Phases** (PLAN M4 "interactive"; P1–P3 built 2026-10-17/18, P4 moved to M5):
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
4. **P4:** Arena-style feel (highlights, sounds): moved to M5, [docs/m5-plan.md](docs/m5-plan.md).

## 10b. Companion app (.exe), added 2026-10-17

A small Windows app that the TTS host runs instead of terminal commands: self-host (Docker on the host's PC) or the
engine on a server. Spec only, not built. **Full spec (rewritten 2026-11-05): [docs/companion-app-spec.md](docs/companion-app-spec.md)**
(a small C# tray app; Home mode first, with a status light for each failure we have hit; Own server and Cloud Forge
later). The server side: [docs/server-setup-spec.md](docs/server-setup-spec.md).

**Why the bridge always stays on the host's PC:** TTS only talks to `localhost` through the External Editor API (§2). So
with a server, only the engine moves off the PC; the bridge connects to the remote relay instead of `ws://127.0.0.1:9443`.

## 10c. Feature: manual fix mode by vote (added 2026-10-17; Tier A built as M4.5, Tier B built as M7)

**Goal:** if the engine gets something wrong (a bug, a misclick, an interaction Forge doesn't handle), the players can vote to pause enforcement and fix the board by hand in TTS. The engine then accepts the corrected board and carries on enforcing from there.

There are two tiers. Tier A covers most mistakes and already exists in the engine.

### Tier A: rewind by vote (already in Manabrew's Forge backend)
Manabrew's Forge engine already records restore points and runs a restore vote:
- `gameView.snapshotRecording` is on, and `gameView.checkpoints` lists the restore points (`CheckpointDto`).
- **To request a restore:** send `directive: {type: "requestRestore", checkpointId}`. The engine opens `gameView.restoreVote` (`voteId`, `checkpoint`, `requestedByPlayerId`, `awaitingPlayerIds`, `status`: pending, approved, declined or unavailable).
- **To vote:** each awaited seat sends `directive: {type: "restoreVote", voteId, accept}`.
- The self-hosted node already passes these directives on to Forge (`self-hosted-node/src/host.rs`, `route_seat_envelope`).

**TTS work** (built 2026-10-20, PLAN M4.5):
- An **"Undo…"** button lists the checkpoints by turn and step.
- A vote panel appears for every awaited player, showing Accept and Decline plus who asked.
- The result goes to chat.
- No engine changes were needed at first. Our engine build later added a lock against the rewind race (2026-11-01 to 11-03).

### Tier B: hand-edit the board, then hand it back to the engine (new engine work)

The players vote to pause enforcement, fix the board by hand in TTS, review the change list and vote again; the bridge
sends the list as one `applyState` directive, and the engine records a restore point, applies it and carries on. Built
2026-10-23 as M7 on our own engine builds (§9); a 2-person live test is left, and "fix from hand" is spec only.
**Full spec, as built, limits and engine work: [docs/m7-manual-fix-spec.md](docs/m7-manual-fix-spec.md).**

## 11. Open questions

- ~~Does Manabrew's Forge backend handle every Commander rule correctly?~~ Answered 2026-10-20 (M0.5): the rules checklist passes headless.
- How far does the External Editor API scale? Large states are big JSON; check whether TTS truncates them and whether the bridge needs to split them into chunks.
- ~~How fast can TTS move or spawn ~150 objects in one update?~~ Answered 2026-10-20: a 125-permanent board updates in 36 ms on average (worst 152 ms).
- ~~How do decks get from TTS to Forge?~~ Answered (PLAN M4, deck intake): decks are imported with the table's Card
  Importer as before, and `mtg ready` (or READY) reads the deck objects, checks every name against Forge's card list and
  sends them with `SetDeckSelection`.

## Turn timer and AFK votes (added 2026-10-19)

Status: a turn timer is built (2026-10-30, `mtg timer`), but not this one: it times each decision and takes the safest
answer at zero, with no vote ([docs/m5-plan.md](docs/m5-plan.md), "Player requests"). The skip vote and the AFK vote
below are not built.

- **Turn timer:** an optional per-turn timer. When it runs out the turn is **not** skipped automatically: the other players get a vote ("Skip their turn?"). With a majority, the bridge answers the stalled player's open prompt with its default (pass, no attack, no block) until their turn ends.
- **AFK vote:** any player can start a vote to mark someone away. With a majority, that player's turns pass automatically (or a Forge AI covers the seat, chosen by the vote) until they press "I'm back" in their panel.
- Both would use the same vote panel as the rewind and manual-fix votes (§10c).

## Friendly mulligans (built 2026-10-31, restored 2026-11-05, one shared count 2026-11-10)

Built on 2026-10-31, taken out on 2026-11-01 while the user chased a choppy PC, and put back on 2026-11-05 at the user's request ("the way it was before"). If the stutter comes back with it, that is looked at then.

The table sets how many free mulligans each player gets: normal rules, 1 or 2. A free mulligan is a new 7 with nothing put on the bottom. When a player has used theirs, the game says so and that player's mulligans cost a card again.

### How it plays

- **One count for everyone** (2026-11-10, the user: "one button be the answer for everyone and anyone can click it"): ONE button **Free mulligans / None** (then **1**, **2**; the user 2026-11-11: "should say None, 1, or 2 not normal") on the left rim where the Pirate Cannon sits when engine mode is off (the cannon is hidden in engine mode), turned a quarter left from White (the user: "turn it 90 left away from the camera, have it sit where the cannon would be"). Anyone, seated or not, clicks it for **1**, **2**, back to **None**. `mtg friendly 0|1|2` does the same. Each change is told to everyone: `[MTG] <name> set free mulligans for everyone: 2 each (the rules' free one in a 3+ player game included).` It can change until Start. (Before 2026-11-10 each player voted on their own mat and the most votes won.)
- **The count is the free mulligans in all** (the user's option (a), 2026-11-10): with 3 or more players the rules' free one is one of them, so "1" is the normal rules there and "2" is two free, not three.
- **Announced at the start:** `[MTG] Free mulligans this game: 2 each (the rules' free one included).` (the bracket only with 3 or more players). Nothing is said when the count is normal.
- **Each free mulligan:** `[MTG] White took a free mulligan (1 of 2).`
- **Going back to normal:** `[MTG] That was White's last free mulligan: their next one costs a card.` When the first turn starts, after a game with friendly mulligans: `[MTG] Friendly mulligans are over: normal rules from here.`
- **On the question:** the button reads **Mulligan (free)** while the next one is free, and the panel says how many are left. When keeping costs cards it says how many go on the bottom. With no friendly mulligans voted the question reads as it always did.
- **Counted per player**, not per table: White taking two doesn't use up Blue's.
- **With 3 or more players**, the rules already make the first mulligan free, and Forge does this by itself. The count includes it: the engine is asked only for the rest (`freeCards` = count − 1).
- **AI players** take normal mulligans. Forge's AI doesn't go through our controller.

### How the engine stays involved

- Forge's `London` mulligan is the default rule, and `MulliganService` asks the controller `mulliganKeepHand(firstPlayer, cardsToReturn)` once per decision. Our harness controller (`ManaBrewInteractiveController`), not Forge, puts the cards back when the player keeps, and its `tuckCardsViaMulligan` returns nothing.
- So this needs **no change to `forge/`**, which stays read-only. The old PLAN note saying it needs a Forge change is out of date. The bridge can't do it alone, because `mulliganPutBack` must be answered with exactly N cards.
- **The number travels with the Keep answer**, as a new optional field. Sending it through `StartGame` was the other option: that touches the relay protocol, `connection.rs`, `lobby.rs`, the node and all four `StartGame` senders, to carry one number only the bridge uses. The answer route is five small edits.

### Engine changes (`manabrew/`, no comments, the node image rebuilt)

| File | Change |
|---|---|
| `manabrew-rs/crates/manabrew-protocol/src/prompts/mulligan.rs` | `MulliganDecision { keep: bool, free_cards: Option<u32> }` (`freeCards` in JSON, optional, left out when none, so Manabrew's web client needs no change) |
| `manabot/src/agent/simple_ai.rs:1225`, `manabrew-agent-interface/src/agent_impl/choices.rs:171`, `self-hosted-node/src/engine_backend/java_backend.rs:2096,2128,2132` | Patterns get `..`, constructors get `free_cards: None` |
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

Only the node image needs the rebuild. The relay checks an answer by reading it into its own types, which ignore a field they don't know, and then forwards the original text, so `freeCards` passes through today's relay unchanged (`manabrew-server/src/connection.rs`, `authorize_game_message`). The node reads the answer into `PromptOutput` (`self-hosted-node/src/host.rs`), so it needs the new field. The relay takes the field on trust from the client. That's fine for a private table, where the bridge is the only client. `Math.max` keeps a wrong number harmless.

### Bridge changes (`bridge/bridge.js`)

- `case "start"`: passes `m.friendly` to `startGame` inside the `go` closure, so a Start that only resumes a running game changes nothing.
- `startGame`: `game.friendly = friendlyCount(n)` (1 or 2, anything else is 0). The crash-recovery snapshot lists its fields by hand, so `friendly` and `friendlyOver` are in its `game` part.
- `Seat`: new `mullsTaken`, counted in `Seat.respond` (every answer goes through it, the timer's too), and added to the snapshot's seat list the same way. `input.mulliganCount` can't be used for this: it's the cards owed, so it stays 0 after the free one in a 4-player game.
- `rulesFreeMulligans()`: `game.total > 2 ? 1 : 0`. All free = `max(game.friendly, rulesFree)`. `friendlyFreeLeft(seat)`: `max(0, all - taken)`. `friendlyText(seat)`: the free ones left, or owed = `max(0, taken - all)`. `friendlyExtra()`: `max(0, game.friendly - rulesFree)`, what the engine adds.
- `case "mulligan"` in `onPrompt`: the label and text above. Keep the option ids `keep` and `mull`, because the Mulligan tiles look for `mull`.
- `toOutput`: add `freeCards: friendlyExtra()` when it's above 0. The timer's automatic answer goes through the same `toOutput`, so it's covered.
- Chat and game-log lines above: the start line in `startGame`'s announcement, the per-mulligan lines where `mullsTaken` goes up, the "over" line on the first turn.

### Table changes (`tools/engine-renderer.lua`, `tools/make-engine-copy.js`)

- `engineFriendly = 0` (0, 1 or 2) and `FRIENDLY_SPOTS` (x ±17.5, read from White's and Yellow's side), globals: the main chunk has no locals to spare.
- In the setup draw, after the middle tile's own button: one `setupButton(tile, "onMtgSetupFriendly", engineFriendlyLabel(), ...)` per spot. `engineSetupIntact` redraws when they're missing. A tile button adds nothing to the 60 KB screen UI.
- `onMtgSetupFriendly(obj, playerColor)`: anyone; the next count, told to everyone (`engineSetFriendly(n, pl)`), and a redraw.
- `make-engine-copy.js`: `mtg friendly 0|1|2` in the chat commands and `mtg help` (anyone); `friendly = engineFriendly` in the `start` message.
- The count carries over to the next game, so a rematch needs no clicks. A table reload clears it.

### Tests and rollout

- **Bridge goldens:** the result for each vote mix (ties, missing votes, a bad value); 2 players with 1 free; 4 players with 1 free; the last-free line; a timer's automatic Keep; a bridge restart between mulligans.
- **Table claims:** the button cycles, another player's click is refused, Start sends the votes, a resumed game starts no vote.
- **Engine, headless, on a second container** (room `tts-test`, the running table isn't touched): with 2 free, two mulligans keep 7; with 1 free, two mulligans put 1 on the bottom; a game with 3 players; `freeCards` absent behaves as today.
- **Break it on purpose** (`jr-programmer-suite` §2b), then one real game with two people.
- **Rollout:** convert `.sh` to LF, build `mtg-forge-node:<tag>` (about 20 minutes, most of it the native step), then `node tools/deploy.js --image <tag>` with TTS closed: it runs the gates and the live checks, retags the node as `:exile` and recreates the containers. The relay stays as it is. Only between games: never swap images mid-game, and the table push needs the decks off the table. Then HOW-TO-PLAY.md, README.md and the PLAN note.

## Player marks and status objects on the mat (added 2026-11-10)

- **Marks boxes (built in source 2026-11-10):** a player's marks (monarch, initiative, poison, the Ring, speed, an
  extra turn, a turn run by another player, ...) show as small green boxes, one a mark, stacked down the inner corner
  of their own mat right under their heart (the user: "corner of your playmat under your heart"; "you can add multiple
  boxes if need be instead of cramming everything in one box"). They keep to the strip the battlefield grid leaves free
  at the inner end of every row, so cards never land on them. Past ten marks the tenth box says "+n MORE".
- **Status objects (built in source 2026-11-11, not yet seen live):** the original table's pieces for those statuses come back: the Monarch crown, the
  initiative's Undercity, City's Blessing, the Ring, Day // Night and the poison / energy / experience tokens. They wait
  under the table, locked and unseen (opacity 0), and the one for a status moves onto the holder's mat just under its
  box when the box says so, e.g. "if the box says monarch the crown spawns in on their mat". Full spec:
  [docs/status-objects-spec.md](docs/status-objects-spec.md).

## Green glow on permanents with a usable ability (added 2026-11-11, built in source 2026-11-11, not yet seen live)

The user: "have creatures, permanents and Planeswalkers on the battlefield highlight green when an ability can be
used. Also have it only highlight for its controller if possible."

**What it does.** When you have priority, each permanent you control whose ability you can activate right now gets the
same green frame as a castable card in your hand. This covers creatures, planeswalkers (a loyalty ability not yet used
this turn, at sorcery speed), artifacts, enchantments, battles and lands with a non-mana ability. The frame goes when
the question changes (you pass, you use the ability, a target or payment question opens) and comes back at your next
priority.

**Only its controller sees it: possible, and already done for the hand.** A TTS highlight (`highlightOn`) is seen by
everyone, so the glow is not a highlight. It is the green frame already drawn for playable hand cards
(`enginePlayableGlow`, "playable cards glow green in your hand"): four bars in the card's own UI, with `visibility` set
to one player's colour. On a battlefield card the colour is the card's **controller** (not its owner: a stolen
creature glows for whoever has it). The frame belongs to the card, so a tapped card's frame turns with it.

**Where the list comes from.** Only from the engine. The frame is shown exactly for the cards behind the priority
question's ability options, the same list the on-card ability buttons and the ability panel use
(`engineAbilityWant`). The table never decides on its own that an ability is usable.

**Left out on purpose:**
- **Mana abilities only.** A land or Sol Ring whose only usable ability makes mana does not glow at priority, or nearly
  every land would glow every time. Mana sources keep glowing while you pay, as today. A permanent with a mana
  ability *and* another usable ability glows.
- **Other questions.** While you pick targets, attackers or blockers, or pay a cost, the existing table-wide glows
  (green = pickable, gold = chosen) are the only ones shown, so the two never mix on one card.
- **Phased-out cards** never glow (the engine offers nothing for them).

**Details:**
- A token stack glows when any token in it has a usable ability.
- `mtg glow` (the existing switch) turns this glow off together with the hand glow, for that player only.
- The card's UI may already hold other parts (the effects pool). The frame is added beside them, never by replacing
  the card's whole UI. Like the hand glow, it is built once per card and then only shown or hidden. First builds are
  spread over frames on a big board, so a 40-permanent turn doesn't stutter.

**Checks** (`tests/test_table_claims.js`, on recorded boards with real Forge option text):
- the frame's `visibility` is the controller's colour, and the other seats get none;
- a stolen creature glows for its controller, not its owner;
- a mana-only land has no frame at priority but glows when paying; a land with a non-mana ability does;
- a planeswalker glows before its loyalty ability is used and not after;
- the frame goes on pass, on use and when a target question opens, and comes back at the next priority;
- a tapped card and a token stack get it;
- `mtg glow` turns it off.

Live check: two seats on the real table, through exec. The frame is seen on the controller's own creature, and its
`visibility` names only that colour.

**As built (2026-11-11, tools/engine-renderer.lua).** `enginePermanentGlowIds` adds to `enginePlayableGlow`'s list the
cards of `engineAbilityWant` drawn for the open priority question (entries made for an attack, block or target
question, the stacks' Split boxes, never count); `engineAbilityBoxes` redraws the frames each time it runs, so they
follow every question and board, and go at once when the question is answered. Decisions where the spec was silent:
- A token folded into a stack has no object: its ability is filed under the stack's card (`engineGroupOf`), which
  glows; the ability buttons read whose it is from that card too.
- First builds wait in `engineFrameQueue` and go `ENGINE_FRAME_BUILDS` (4) a frame; showing or hiding a built frame is
  one call at once. A hand card's first frame waits a frame now as well. A frame hidden before its build is never
  built, and a card whose UI can't be built is skipped (said in the log) without stopping the queue.
- The frame is added to whatever the card's UI holds; a rebuild for another colour (a stolen permanent) cuts out only
  the `eng_play` panel (found by counting its Panels, so bars that come back written out in full go with it).
- A permanent that changes controller while its old controller's question is open stops glowing for them at the next
  board (`engineMeta` is read again, not only when the question came).
- A face-down permanent gets the same frame, built for a face-up card; whether it shows on a card lying face down is
  not checked (no face-down permanent has an ability option today: turning one up is a special action).
- The `mtg glow` reply now says "Green glow on playable cards and usable permanents: on/off".
- Tests: tests/test_table_claims.js "permanent glow" (each check of the list above, plus "beside the card's other UI",
  "at most 4 a frame" and "a card you don't control never glows for you, even with an ability offered on it") and
  "frame queue" (a card that can't take UI, a change of sides, frames hidden before their build, rebuilds).
