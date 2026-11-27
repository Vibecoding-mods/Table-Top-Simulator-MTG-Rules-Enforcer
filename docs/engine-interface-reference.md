# Engine interface reference (TTS bridge ↔ Manabrew relay ↔ Forge)

Reference for the rules-engine side of the TTS project, written from a line-by-line
read of the Manabrew clone at `manabrew` (no `forge/`
submodule). Paths are relative to `manabrew/manabrew-rs/crates/` unless they start
with `manabrew/`, `bridge/`, `stack/` or a top-level project file.

Short names: **RP** = `manabrew-relay-protocol/src/lib.rs`; **SD** =
`manabrew-relay-protocol/src/state_delta.rs`; **AI** = `manabrew-agent-interface/src/`;
**MP** = `manabrew-protocol/src/`; **conn** = `manabrew-server/src/connection.rs`;
**lobby**/**room**/**replay**/**cleanup** = `manabrew-server/src/<name>.rs`;
**host** = `self-hosted-node/src/host.rs`; **jb** =
`self-hosted-node/src/engine_backend/java_backend.rs`; **cfg** =
`self-hosted-node/src/config.rs`.

Section 11 lists every bug and oddity found, in one place.

**Status, 2026-11-05.** This is a read of **stock** Manabrew at `fd16e2f` (2026-10-16). It is still right for the relay and
node code it cites. Three things have moved since it was written:
- **We run our own builds** (`mtg-relay:exile`, `mtg-forge-node:exile`, manabrew branch `tts-engine`, commit `b7a42c8`;
  patches and build script in `engine/`). They add, among other things: the `applyState` directive and
  `gameView.stateFix` (M7, `createCard` for `mtg debug`), Forge's event feed in `gameView.events` (the harness's
  `EngineEventLog`: zone moves with `how` and `cause`), exile links, a snapshot/game lock for rewinds, stack trigger
  marks, and `seat_order` on `StartGame`. Most of it is listed in docs/changes-2026-10-31-to-11-05.md, "Engine".
- **`bridge.js` line numbers** (`bridge.js:NNN`) date from before rewind by vote (2026-10-20). The bridge is about 6,300
  lines now: search by name. §6, §9, §10 and §11 note what changed.
- **The bridge's own messages and functions** are in docs/our-code-reference.md, not here.

---

## 1. Components and how they connect

```
TTS Global Lua ⇄ (localhost 39999/39998) ⇄ bridge/bridge.js
      one WebSocket per TTS seat ⇄ relay (ws://127.0.0.1:9443)
                                      ⇄ node (one WebSocket; creates the room; sits in it as an observer)
                                           ⇄ Forge harness (in-process GraalVM isolate, polled by jb)
                                      ⇄ manabot bot seats (WebSockets spawned by the node)
```

| Component | Role | Source |
|---|---|---|
| Relay | Auth, lobby, rooms, envelope routing, replay cache, reconnect windows. Runs no rules. Trust boundary: only the room host may emit engine output; seat input goes only to the host after slot check (`manabrew/docs/agents/RELAY.md:7`). | `manabrew-server/` |
| Node | Creates a hosted room, owns one engine session per game, turns engine output into `BroadcastState`, routes seat `response`/`directive` into the engine. | `self-hosted-node/` (`manabrew/docs/agents/SELF_HOSTED_NODE.md`) |
| Forge | Rules engine. The published `manabrew-node` image uses `graal-forge`: the harness is a native shared library called in-process, no JVM (SELF_HOSTED_NODE.md:9). Host-side Java: `manabrew/forge-harness/src/main/java/forge/harness/host/`. | selected by `SELF_HOSTED_NODE_ENGINE_BACKEND=forge` |
| Bots | `manabot` relay clients (`service:true`, `as_bot:true`) spawned by the node. With `forgeAi` the engine's own Forge AI plays those seats, but the manabot connections still exist. | `manabot/src/state.rs`, `manabot/src/native.rs` |

Game identity: the relay generates `game_id` at `StartGame` (lobby:713); the node aborts its engine session whenever the relay contradicts it (room back in Lobby, or `GameStarted` for another game) (SELF_HOSTED_NODE.md:5; host:1276-1277, 1332). WebRTC direct play exists (`manabrew/docs/TRANSPORT.md`) but a headless node offers no plane (SELF_HOSTED_NODE.md:21-24), so all traffic here goes through the relay.

### 1.1 Docker stack (`stack/compose.yml`)

| Service | Lines | Image | Settings |
|---|---|---|---|
| `relay` | 8-18 | `mtg-relay:exile` (our build; stock was `ghcr.io/witchesofthehill/manabrew-server:latest`) | `MANABREW_SERVER_KEY=${MANABREW_SERVER_KEY:-tts-local}`, `RUST_LOG=manabrew_server=info`, port `127.0.0.1:9443`. Relay reads `FORGE_HOST` (default 0.0.0.0), `FORGE_PORT` (default 9443), `FORGE_MAX_ROOMS`, `MANABREW_SERVER_KEY` (`manabrew-server/src/config.rs:88-102`). |
| `web` | 20-29 | `manabrew-web`, pinned by digest | browser client at `127.0.0.1:8080`, `RELAY_PASSWORD` = server key. |
| `forge-room` | 31-46 | `mtg-forge-node:exile` (our build; stock was `manabrew-node:latest`) | `SELF_HOSTED_NODE_RELAY_URL=ws://relay:9443`, `_SERVER_KEY`, `_ROOM_NAME=tts-commander`, `_ENGINE_BACKEND=forge`, `_FORMAT=commander`, `_MAX_PLAYERS=${SEATS:-6}`, `_AUTO_START=true`, `RUST_LOG=self_hosted_node=info`. `STATE_DELTA` unset → on. |

~~All images are `:latest`, so a `docker compose pull` can change the wire protocol under the bridge.~~ Fixed: the relay
and node are our local builds and the web client is pinned by digest, so a pull changes nothing. The bridge restarts the
node for "mtg reset" via `docker compose -f stack/compose.yml restart -t 3 forge-room` (`roomRestarting` in `bridge/bridge.js`).

---

## 2. Relay wire protocol (RP)

JSON text frames, `#[serde(tag="type")]`, snake_case fields (RP:206-209, 375-377). `PROTOCOL_VERSION` = crate major version, computed by `major_of` (RP:15-26). Any frame that fails to parse as `ClientMessage` gets `Error{code:"parse_error", message}` and the socket stays open (conn:1121-1138). A `BroadcastState` whose inner player envelope fails `EngineInput` parsing is **silently dropped** (conn:71-75, 2196-2199; RELAY.md:9).

### 2.1 ClientMessage (RP:209-373) and relay handling (conn `handle_client_message`, 1521-2580)

Every handler first resolves the sender's `room_id` from its session; most return `not_in_room` if absent.

| Variant | Fields | Relay behaviour (branches, replies, side effects) |
|---|---|---|
| `Authenticate` (210-230) | `username` (legacy; only used when the identity proof gives no name), `password`, `service`, `identity?` {`token?`,`device?`} (RP:46-51), `client_platform` (RP:56-63), `client_version?`, `engine_gate` (RP:71-80) | Must be the first frame within 10 s, else `AuthTimeout` (conn:1200-1206); a non-text first frame → `AuthFailed` (1208-1213); any other first message → `AuthResult{success:false,"First message must be Authenticate"}` (1377-1390). Steps (1219-1376): build `ClientBuild` (1228); wrong key → failure reply + close (1229-1240); resolve identity; expired token → failure (1246-1257); name = token handle or `username` (1262); empty → failure (1264-1275); existing session with that name: reclaim if it is disconnected, its sender is closed, the identity matches, or the new name is verified and the old is not; otherwise "Username '…' is already taken" (1277-1294); a live session being taken over is `evict`ed (1296-1314) and `reclaim_session` runs (1316-1330). New session: random `player_id`, inserted with `is_service=service` (1333-1359), `AuthResult{success:true, reconnected:false, features, art_base_url}` (1361-1369), lobby chat history unless service (1370-1372), `PlayerList` to everyone (1373). Re-sending `Authenticate` later → `Error{already_authenticated}` (1529-1541). |
| `Ping` (232) | – | `Pong` (1543). Separately the relay sends WebSocket pings every 25 s and drops a socket idle for 90 s (conn:38-39, 1046-1062, 1069, 1092-1095). |
| `ListRooms` (234) | – | `RoomList` of every room's `to_room_info` (1545-1553). |
| `ListPlayers` (236) | – | `PlayerList` of non-service sessions (1567-1575; `player_list` 505-527). |
| `SetLocalGame` (241-244) | `kind?` | Updates session; re-broadcasts `PlayerList` only on change (1555-1565). |
| `CreateRoom` (246-268) | `room_name`, `max_players`, `format`, `protocol_version`, `hosted`, `engine`, `draft_config?`, `sealed_config?`, `official_key?`, `password?`, `reconnect_timeout_s?`, `table_style?` | `lobby::create_room_sync` (lobby:21-131): draft/sealed config checks (37-74); already in a room → `already_in_room` (76-84); room count ≥ `max_rooms` → `room_full` (86-88); `official` iff key matches (95-98); `Room::new` with `host_plays = !hosted`, timeout default 60 clamped 10-90 (100-121); creator's `room_id` set (126-128). Reply `RoomCreated{room_id, room_name, room, resume_token}` to creator only (1618-1633). |
| `JoinRoom` (270-278) | `room_id`, `observe`, `as_bot`, `password?` | `lobby::join_room_sync` (lobby:323-394): already in a room → `already_in_room`; unknown room → `room_not_found`; password mismatch → `incorrect_password`; room `InGame`: observers refused, others must match an existing **disconnected** seat with same username and same `is_bot` (else `game_already_started`) and take it over (rejoin) (358-370); Lobby: `add_observer` or `add_player` (`room_full` if full) (371-384). Handler: analytics `SeatJoined` unless rejoin (1656-1664); rejoin → `PlayerConnected` to others (1665-1677); new non-observer → `PlayerJoined` to all (1678-1690); always `RoomUpdate` to all + transport roster + room chat history unless service (1691-1696). |
| `ResumeRoom` (280; struct RP:540-574) | room settings + `resume_token`, `player_order`, `player_decks`, `starting_life`, `bot_players`, `game_id` | `lobby::resume_room_sync` (lobby:138-283): sender in another room → `already_in_room` (150-158). Known room: token mismatch or child limited room → `invalid_resume_token` (161-163); becomes host (178-180); hosted → swap observer entry (181-184), else retake seat (185-192); old host session removed (199-201). Unknown room (relay restarted): recreated `InGame` with seats from `player_order` as `pending-rejoin-<uuid>` disconnected ids (`resumed_slots` 285-313), forfeit timers armed for each (267-277). Reply `RoomResumed` to sender, draft-clock replay, `RoomUpdate` to others (1714-1737). |
| `LeaveRoom` (282) | – | `lobby::leave_room_sync` (lobby:396-461): `remove_participant`; if the room is now empty or nobody connected → room removed; **if seats are now empty but someone (the node) remains, `reset_lobby_settings` sets format `Any` and `max_players` 4** (437-439). Handler: analytics, `PlayerLeft` + `RoomUpdate` to the room (1745-1786); `NotInRoom` is silent (1778-1780). |
| `SetReady` (284-286) | `ready` | `lobby::set_ready_sync` (463-497): not Lobby → `game_already_started`; ready while format ≠ `Any` and no deck → `deck_not_selected` (486-489); unknown seat → `not_in_room`. Broadcast `ReadyStateChanged` + `RoomUpdate` (1788-1815). |
| `SetDeckSelection` (288-296) | `deck_name`, `deck`, `published_deck_id?`, `commander_name?`, `avatar_url?` | `lobby::set_deck_selection_sync` (519-563): playmat colour strings ≤32 chars (501-507), published id sanitised (509-517), not Lobby → `game_already_started`, then `Room::set_deck_selection` which **also sets `ready=false`** (room:276-296). No deck legality check. Analytics `DeckSelected`; `RoomUpdate` (1817-1880). |
| `SetFormat` (298-300) | `format` | Controller only (`not_host`), Lobby only; on change un-readies human seats (lobby:574-610). |
| `SetMaxPlayers` (302-304) | `max_players` | Controller only, Lobby only, clamped to `[max(seats,2), 4]` (lobby:612-644). |
| `StartGame` (306-309) | `format?` | `lobby::start_game_sync` (646-735): **controller only** (`not_host`, 665-667), Lobby only, format `Any` requires a non-`Any` `format` (`format_not_chosen`, 670-675), `all_ready` (`players_not_ready`), every seat has a deck (`deck_not_selected`). Sets `InGame`, `starting_life` (Commander 40, Brawl 25, else 20; 694-711), `player_order` = seat usernames in join order (707), new `game_id` (uuid) and replay cache. Handler: `RoomUpdate` then `GameStarted` to everyone (1924-1988). |
| `EndGame` (311-313) | `game_id` | `lobby::end_game_sync` (737-768): host only, `InGame` only, `game_id` must match. `reset_room_to_lobby` (770-839): emits game-ended analytics, status Lobby, **clears all seats**, format `Any`, max 4, clears seat sessions' `room_id` (sessions already disconnected are deleted). Handler: `RoomUpdate` + `GameAborted` to cleared seats except sender (1990-2007). Errors are only logged at debug, nothing is sent back (2004-2006). |
| `ReportEngineStats` (315-319) | `game_id?`, `stats` | Analytics only; implausible reports dropped (2010-2076). |
| `ReportGameOutcome` (324-327; RP:731-741) | `game_id`, `outcome` {`game_over`, `winner_slot?`, `conceded_slots[]`, `fatal_message?`, `turns?`} | Recorded only if sender is host and `game_id` matches (2078-2101; `replay::record_outcome` truncates slots and 500-char message, replay:120-135). |
| `RequestResync` (329) | – | Room must be `InGame` with a replay cache, else `Error{game_not_in_progress}`. Sends `GameStarted`, then the seat's last folded state (or the observer state), then its pending prompt, each as `StateUpdate{from_player: host}` (2103-2151). |
| `BroadcastState` (331-336) | `state` (StateEnvelope §3), `target_player?` (username; `None` = room minus sender) | conn:2153-2373, see §2.4. |
| `TurnChange` (338-341) | `new_active_player`, `turn_number` | Host + `InGame` only (`not_host`), forwards `TurnChanged` (2544-2578). Legacy. |
| `ReportTransport`, `AnnounceTransport`, `SignalPeer`, `ReportPlaneQuality` (343-363) | – | WebRTC plane; host/participant checks; silent refusals (2375-2528). Unused here. |
| `SendChat` (365-368) | `scope`, `text` | ≤500 chars, 400 ms rate limit, lobby needs verified account (`send_chat` 627-701). Unused. |
| `InviteToRoom` (370-372) | `username` | Lobby, not full, target connected non-service and not in game (`invite_to_room` 747-784). Unused. |

### 2.2 ServerMessage (RP:377-509)

| Variant | Fields | Sent when |
|---|---|---|
| `Pong` (378) | – | reply to `Ping`. |
| `AuthResult` (380-395) | `success`, `player_id?`, `reconnected?`, `error?`, `features[]`, `art_base_url?` | after `Authenticate`. `features` = RP:709-720 minus `room_transport`/`peer_signal` unless `MANABREW_DIRECT_TRANSPORT` (conn:554-564). |
| `SessionTakenOver` (397) | – | to a displaced socket, then Close (`evict`, conn:1394-1399). |
| `RoomList` (399) | `rooms: RoomInfo[]` | `ListRooms`. |
| `PlayerList` (403) | `players: PlayerInfo[]` (RP:666-686) | on auth, disconnect, `ListPlayers`, `SetLocalGame`; non-service sessions only. |
| `RoomCreated` (407-413) | `room_id`, `room_name`, `room`, `resume_token?` | creator. |
| `RoomResumed` (415) | `room` | `ResumeRoom` sender. |
| `PlayerJoined`/`PlayerLeft` (419-427) | `room_id`, `username` | join (non-observer), leave, forfeit (cleanup:318-325). |
| `PlayerConnected`/`PlayerDisconnected` (429-435) | `username` | session reclaim / disconnect in game. |
| `ReadyStateChanged` (437) | `username`, `ready` | `SetReady`. |
| `RoomUpdate` (442) | `room` | after nearly every lobby change. |
| `GameStarted` (446-452) | `room_id`, `game_id`, `player_order[]`, `player_decks[]` (RP:30-43), `starting_life` | `StartGame`, and first message of a resync. Slot of a username = `player-<index>` (replay:144-149). |
| `StateUpdate` (454) | `from_player` (sender username), `state` | every forwarded envelope. |
| `TurnChanged` (459) | `from_player`, `new_active_player`, `turn_number` | legacy. |
| `GameAborted` (465) | `room_id` | `EndGame`, humanless sweep, host never resumed, engine-holding seat lost. |
| `Error` (469) | `code`, `message` | `code` from `ServerError::code` (`manabrew-server/src/error.rs:63-87`): `auth_failed`, `auth_timeout`, `room_not_found`, `room_full`, `incorrect_password`, `not_in_room`, `not_host`, `players_not_ready`, `deck_not_selected`, `game_already_started`, `game_not_in_progress`, `format_not_chosen`, `invalid_draft_config`, `invalid_resume_token`, `already_in_room`, `duplicate_username`, `player_not_found`, `player_in_game`, `invalid_chat_message`, `chat_rate_limited`, `account_required`, `websocket_error`, `parse_error`; plus literal `already_authenticated` (conn:1537). |
| `ServerShuttingDown` (474) | `reconnect_in_s` | relay restart. |
| `RoomTransport`, `PeerSignal`, `ChatMessage`, `ChatHistory`, `RoomInvite` (478-508) | – | unused here. |

`RoomInfo` (RP:577-603): `room_id`, `room_name`, `host` (host **username**, the node), `protocol_version`, `hosted`, `official`, `password_protected`, `players[]` (RoomPlayerInfo RP:655-663: `username`, `ready`, `connected`, `is_bot`, `selected_deck_name?`; the node observer is not listed), `max_players`, `format`, `status` (`Lobby|InGame`, RP:763-766), `engine`, `reconnect_timeout_s` (default 60, RP:605-609), `table_style?`, `draft_config?`, `sealed_config?`. Built by `Room::to_room_info` (room:390-419).

### 2.3 Rooms (room.rs)

- `Room::new` (room:66-138): `max_players.clamp(2, 8)` (83). `host_plays=false` (hosted) puts the creator in `observers`, not `players` (84-108). New `resume_token` uuid (129).
- `is_full` (140-142): seats ≥ `max_players` (observers do not count).
- `reset_lobby_settings` (155-160): if no draft/sealed config, `format = Any`, `max_players = 4`. Called from `reset_room_to_lobby` (lobby:797), `leave_room_sync` (lobby:438) and the lobby-disconnect path (cleanup:534-536).
- `all_ready` (162-171): ≥2 seats (1 for limited) and every seat **except the controller** ready.
- `add_player` (173-201): refuses full, non-Lobby, duplicate; new seat `ready:false, connected:true`.
- `add_observer` (203-214), `remove_player` (216-229; host handoff only matters for host-plays rooms), `remove_observer` (231-236), `remove_participant` (238-241), `set_connected` (243-251), `all_disconnected` (255-257), `has_connected_human` (259-265: connected non-bot seat, or connected observer other than a hosted room's host).
- `set_ready` (267-274), `set_deck_selection` (276-296, resets ready), `has_selected_deck` (298-304), `player_decks` (306-323, seats without a deck are skipped).
- `is_host` (325-327: `host_player_id`), `controller_id` (334-340: **first non-bot seat**, else first seat), `is_controller` (342-344), `host_connected` (356-365), `connected_player_ids` (376-388: connected seats + connected observers).
- `participant_id_by_username` (427-432) and transport helpers (442-495) are WebRTC-only.

### 2.4 `BroadcastState` routing (conn:2153-2373)

1. Room = sender's room (limited-session protocols have their own room selection, 2159-2191).
2. `authorize_game_message` (conn:56-184) classifies `state.kind`:
   - `response`/`directive`: `fromPlayer` must equal the sender's slot from the replay cache; the envelope minus `fromPlayer` must parse as `EngineInput`; → `Player` (63-76).
   - `state|stateDelta|display|prompt|error|log|snapshot|fatal`: sender must be the host → `Engine` (77-79).
   - `roomRelay`: `draft-v1`/`limited-session-v1` checks (81-152); other protocols than `self-hosted-node` pass through (153-155); for `self-hosted-node` only `payload.type` `gameOver` (host + matching `gameId`), `heartbeat` (host) and `spawnBot`/`removeBot` (**room controller**) are allowed (156-180).
   - anything else → rejected. Rejection = warn log, no reply (2196-2199).
3. Non-`roomRelay` messages are dropped unless the room is `InGame` (2263-2265).
4. Player messages are re-targeted to the host username (2268-2272) and delivered only if the host is connected (2273); otherwise they are kept in `queued_inputs` and flushed when the host session is reclaimed (replay:157-176; conn:1490-1514). Engine messages clear the host's queue (`acknowledge_inputs`, 2275-2277).
5. `replay.observe` (replay:60-110) caches: `state` per `forPlayer` slot or as observer state; `stateDelta` folded into the cached full state with `state_delta::apply`, fingerprint updated (no base check); `prompt` per slot; `response` clears that slot's prompt.
6. Capture to `MANABREW_GAME_CAPTURE_DIR` if enabled (2301-2318).
7. Delivery: a targeted message goes to `send_to_room_player` (922-942) which resolves the username via `room_player_id_in` (837-846: the host if connected, else a **connected seat**; observers other than the host cannot be targeted; unresolved = dropped with a debug log). Untargeted goes to every connected seat and observer except the sender.
8. **Patch downgrade by client version**: for `stateDelta`, `seats_needing_full_state` (860-884) lists recipients that are not services and whose `client_version` < 3.17.0 or missing (`ClientBuild::applies_state_patches`, `manabrew-server/src/client_build.rs:16-20, 73-78`); those get the folded full state from `replay.state_after` (replay:137-142; conn:2293-2299) instead, via `broadcast_state_split` (888-920) or the targeted branch (2341-2347). If the relay has no folded state, the patch is sent anyway (2339-2340).

### 2.5 Session lifecycle as the bridge runs it

1. Per seat: open socket, `Authenticate{username:"tts-<color>-<4 chars>", password:KEY, service:false, client_platform:"unknown", engine_gate:"unknown", client_version:"3.56.0"}` (bridge.js:182, 188-192). No identity proof, so the pre-identity duplicate-name rules apply (RELAY.md:59).
2. `AuthResult` ok → `ListRooms` → room with `room_name == ROOM` that is `Lobby` (bridge.js:203-215).
3. `JoinRoom{observe:false, as_bot:false}` (bridge.js:214).
4. First `RoomUpdate` listing the seat → `SetDeckSelection` then `SetReady{true}` (bridge.js:279-286). Order matters because a deck change un-readies (room:291).
5. All bridge seats joined and bots wanted → seat 0 sends `BroadcastState{kind:"roomRelay", protocol:"self-hosted-node", version:1, messageId, roomId, payload:{type:"spawnBot", deck, decks, forgeAi:true}}` (bridge.js:289-298). Relay requires seat 0 to be the controller (conn:176-178).
6. Ready+connected seats ≥ total → seat 0 sends `StartGame{format:"Commander"}` (bridge.js:299-303). Also controller-only.
7. `RoomUpdate(InGame)` + `GameStarted`; bridge sets `slot = player-<index>` (bridge.js:220-222).
8. Engine traffic in `StateUpdate`; answers as `BroadcastState{state:{kind:"response", fromPlayer:slot, promptId, action:{type, output}}}` (bridge.js:198-200).
9. Game over → node sends `EndGame`; relay clears all seats and resets the room to `Any`/4 (§2.1). Bridge reset sends `LeaveRoom` and closes (bridge.js:263, 469-474).

### 2.6 Disconnects and timers (cleanup.rs)

- `handle_connection` end → `mark_disconnected` (conn:1167-1191; cleanup:347-350). Stale generations are ignored (cleanup:355-361).
- In game, a seat: marked disconnected, `PlayerDisconnected` + `RoomUpdate`, and `schedule_seat_forfeit` (cleanup:466-485). After `reconnect_timeout_s + 5 s`, if still gone and still seated, `forfeit_seat` removes the seat and broadcasts `PlayerLeft` + `RoomUpdate` (cleanup:244-327); the node then concedes that seat (host:1310-1322).
- In game, the hosted node: room kept, `PlayerDisconnected`, `schedule_host_resume_abort` (cleanup:399-426). If not back (reclaim or `ResumeRoom`) after timeout + 5 s → `GameAborted` and the room is removed (cleanup:143-189).
- In Lobby, the hosted node disconnecting **removes the room** (cleanup:516-528). A seat disconnecting in Lobby is a leave; if no seats remain, settings reset (cleanup:530-545).
- Sweep every 60 s (cleanup:18-85): sessions silent 180 s are marked disconnected; an `InGame` room with no connected human (bots and the hosted node excluded) for `reconnect_timeout_s + 5 s` is reset to Lobby with `GameAborted` (`abort_humanless_room` 123-141); Lobby rooms with everyone disconnected are removed; in-game rooms fully disconnected for 1 h are removed (329-345).
- Session reclaim (conn:1402-1519): bumps generation, swaps sender, `AuthResult{reconnected:true}`, marks connected in the room, `PlayerConnected` to others, `RoomUpdate`, flushes queued engine inputs if the reclaimer is the host.

---

## 3. StateEnvelope (AI/protocol.rs:17-137)

Carried inside `BroadcastState.state` / `StateUpdate.state`; `#[serde(tag="kind", rename_all="camelCase")]`. `forPlayer`/`fromPlayer` are engine slots (`player-N`); `target_player` on the transport is a username (RELAY.md:13).

| `kind` | Fields | Producer / consumer |
|---|---|---|
| `state` (18-44) | `forPlayer?`, `state` (= `StateUpdate{gameView}`, MP/transport/mod.rs:17-22, `deny_unknown_fields`), `engineMs?`, `emitMs?`, `fingerprint?` | Node. Per seat: `forPlayer` set, targeted. Observer: no `forPlayer`, untargeted, all hands hidden (manabot/src/state.rs:241-243). `fingerprint` only when deltas are on (host:2433-2436). |
| `stateDelta` (49-61) | `forPlayer?`, `base`, `fingerprint`, `patch`, `engineMs?`, `emitMs?` | Node, when deltas on and a previous state was sent to that seat (host:2294-2316). |
| `display` (62-64) | `event`: `DisplayEvent` tagged `kind`: `cardPlayed{cardId,cardName,setCode,playerId}`, `turnChanged{activePlayerId,activePlayerName,turnNumber}` (MP/display/mod.rs:4-23) | Node, untargeted; consecutive duplicates suppressed (host:2446-2447). |
| `prompt` (68-77) | `forPlayer`, `prompt` (`AgentPrompt`, MP/transport/mod.rs:78-92: `promptId`, `decidingPlayerId` (omitted when empty), `sourceCard?`, `sourceAbilityText?`, `input`), `engineMs?`, `emitMs?` | Node → deciding seat (targeted). |
| `response` (79-85) | `fromPlayer`, `promptId` (default 0), `action` (`PromptOutput`) | Seat → node. |
| `directive` (86-90) | `fromPlayer`, `directive` (`DirectiveInput`) | Seat → node. |
| `log` (92-96) | `fromPlayer`, `entry` (`GameLogEntryDto`, AI/game_log_event.rs:6-21: `entryType` ∈ `info|action|stack|priority|rule|warning` (23-32), `message`, `timestampMs`, `playerId?`, `cardId?` (= card ∨ source ∨ target), `sourceCardId?`, `targetCardId?`; built by `from_message` 34-44 / `from_event` 46-60) | Accepted from host only (conn:77). Not emitted by the node (§11). |
| `snapshot` (98-102) | `fromPlayer`, `entry` | Host only. Not emitted by the node. |
| `fatal` (103-105) | `message` | Node on engine error/panic, untargeted (host:2035-2040). |
| `error` (108-112) | `forPlayer`, `error` (`ProtocolError` MP/transport/mod.rs:67-76: `code` ∈ `stalePrompt|wrongPlayer|wrongPromptType|unknownActionId|cancelNotAllowed|invalidShape` (55-65), `message`, `promptId?`) | Node → that seat; followed by a re-sent prompt when one is reopened (jb:1941-1960). |
| `roomRelay` (116-136) | `protocol`, `version`, `messageId`, `fromPlayer?`, `targetPlayer?`, `roomId?`, `payload` | Out of band. Node heartbeat every 30 s `{type:"heartbeat", node, capacity}` with `fromPlayer` = node username (host:1170-1178, 2789-2808); node `gameOver{gameId}` (host:2629-2648); client `spawnBot`/`removeBot`. |

`StateEnvelope::for_agent_message` (139-142) / `for_agent_message_timed` (146-174) map `AgentMessage::{State,Display,Prompt,Error}` (MP/transport/mod.rs:8-15) to envelopes; `State` always gets `forPlayer: Some(slot)`, `fingerprint: None`, `emitMs: None`.

`engineMs` = ms since the last seat response reached the node, `None` once the next prompt went out (`EngineClock`, host:2254-2292). `emitMs` = ms spent serialising/fingerprinting/diffing, stamped last (host:2234-2245). See `manabrew/docs/agents/LATENCY_ANALYSIS.md`:24-57.

### 3.1 Patch format and fingerprint (SD)

| Function | Lines | Behaviour |
|---|---|---|
| constants | 3-6 | `$v` literal, `$k` keyed changes, `$d` removed, `$o` order. |
| `element_key(value)` | 11-23 | Object with string `id` → that id; else string `zone` + `ownerId` → `"zone/ownerId"`; else `None`. |
| `keyed_elements(values)` | 25-35 | Keys for every element, or `None` if any element has no key or keys are not unique. |
| `find(entries, key)` | 37-39 | Linear lookup. |
| `diff(prev, next)` | 45-84 | `None` if equal. Both objects → per-key recursion, new keys as `literal`, removed keys listed in `$d`. Both arrays → keyed diff if both sides are fully and uniquely keyed, else `literal(next)`. Any other type change → `literal(next)`. |
| `keyed_diff(before, after)` | 86-129 | `$k` = changed/added elements (added as literal), `$d` = removed keys, `$o` = full new key order only when order changed; if nothing else, `{"$k":{}}`. O(n²) lookups. |
| `literal(value)` | 132-141 | Objects wrapped as `{"$v":obj}`; scalars, arrays, null returned as is. |
| `is_keyed_patch` | 143-145 | Has `$k` or `$o`. |
| `apply(prev, patch)` | 148-172 | Non-object patch → replacement; `$v` → replacement; keyed → `apply_keyed`; else merge: start from `prev` object (or `{}`), drop `$d` keys, apply each other key recursively against the old value (or `null`). |
| `apply_keyed(prev, fields)` | 174-215 | Rebuilds the array: remove `$d`, patch or append `$k` entries, reorder by `$o` if present; elements with no key get key `""`. |
| `fingerprint(state)` | 220-229 | FNV-1a 64 (offset `0xcbf29ce484222325`, prime `0x100000001b3`) over `write_canonical`, printed as 16 hex digits. |
| `write_canonical` | 231-259 | Objects with keys sorted, no whitespace; keys and scalars in serde_json formatting. |

Receivers never compute the fingerprint to trust it: they compare `base` to the fingerprint they hold and on mismatch send `RequestResync` (AI/protocol.rs:38-48). The relay's replay cache folds patches so a resync returns a full board. The bridge's JS port is `bridge/state-delta.js`.

---

## 4. GameViewDto (MP/game/mod.rs)

camelCase JSON. With the Forge backend the Java harness produces it (`state_via_handle` parses `engine.get_snapshot(session, viewer)` into `GameViewDto`, jb:1986-1995; Java builder `InteractiveSnapshotExtractor.java`, e.g. 226-228). The Rust-engine builder is `GameViewDtoExt::from_engine` (AI/game_view_dto.rs:806-1068), not used by this stack.

**GameViewDto** (135-158): `gameId`; `turn` (counts every player's turns); `step` (StepKind 79-94: `untap upkeep draw main1 combatBegin combatDeclareAttackers combatDeclareBlockers combatFirstStrikeDamage combatDamage combatEnd main2 endOfTurn cleanup`); `combatAssignments[]` {`blockerId`,`attackerId`} (198-201); `activePlayerId`; `priorityPlayerId`; `players[]`; `zones[]`; `stack[]`; `gameOver`; `winnerId` (null if none); `monarchId`; `initiativeHolderId`; `dayTime` (`neither|day|night`, 99-104); `activePlaneNames?`; `checkpoints[]` (default `[]`); `restoreVote` (default null); `snapshotRecording` (default false).

**PlayerDto** (224-269): `id` (`player-N`); `name` (relay username); `status` (`playing|lost|conceded`, 206-211); `isHuman`; `life`; `maxHandSize`; `unlimitedHandSize`; `landsPlayedThisTurn`; `maxLandPlaysPerTurn`; `unlimitedLandPlays`; `cardsDrawnThisTurn`; `damagePrevention`; `isExtraTurn`; `extraTurnCount`; `controlledBy?`; `playerKeywords[]`; `commanderCasts` {cardId: n}; `dungeonState?` {`name`,`room`} (216-219); `activeSchemeNames?`; `teamNumber?`; `counters` {`poison|energy|experience|radiation|ticket`: n} (53-59; zero counters omitted by the Rust builder, game_view_dto.rs:899-908); `manaPool` {`W|U|B|R|G|C`: n} (10-23; zero colours omitted, game_view_dto.rs:232-247); `commanderDamage` {commanderCardId: damage}; `hasCityBlessing`; `hasEnduringStory`; `ringLevel`; `speed`.

**ZoneDto** (119-130): `zone` (`battlefield hand library graveyard exile command attractions junkyard sideboard`, 64-74), `ownerId`, `cards[]` (top-first where public), `count` (can exceed `cards.length` for hidden cards). Battlefield entries are bucketed by **controller**, not owner (comment 119; Rust builder 954-980).

**CardView** (106-117): internally tagged `visibility`: `{"visibility":"visible", …CardDto}` or `{"visibility":"hidden","id"}`.

**CardDto** (303-400; all fields default when missing): `id` (`card-N`); `identity` (274-282: `name`, `setCode`, `cardNumber`, `isToken`, `tokenScript?`); `color`; `manaCost`; `cmc`; `types[]`; `subtypes[]`; `supertypes[]`; `power`/`toughness` (strings or null); `basePower?`; `baseToughness?`; `finalChapter?`; `classLevel?`; `classLevels[]` (ClassLevelDto 287-293); `sagaChapters[]` (SagaChapterDto 298-301); `text`; `choices[]` (CardChoiceDto 32-40, tagged `kind`: `color{colors}`, `type{values}`, `namedCard{names}`, `chosenCard{count}`, `number{value}`, `mode{value}`, `player{playerId,name}`); `controllerId`; `ownerId`; `tapped`; `isCrewed`; `isAttacking`; `attackingPlayerId?`; `attackTargetId?`; `keywords[]`; `counters` {name: n} (canonical engine names, e.g. `P1P1`, `Loyalty`; comment 348-349); `damage`; `summoningSick`; `isCopy`; `isDoubleFaced`; `isTransformed`; `isFaceDown`; `isBestowed`; `phasedOut`; `exerted`; `isRingBearer`; `attachedTo?`; `attachmentIds[]`; `mergedCardIds[]`; `flashbackCost?`; `kickerCost?`; `effectiveManaCost?`; `commanderTax?`; `madnessCost?`; `isMadnessExiled`; `isPlotted`; `isWarpExiled`; `foil`; `wouldDieInCombat` (Forge only, comment game_view_dto.rs:788-790); `zone?`. Booleans marked `skip_serializing_if Not::not` are absent when false.

**StackObjectDto** (402-420): `id` (`stack-N`), `sourceId`, `controllerId`, `ownerId`, `identity`, `text`, `sourceAbilityText?`, `isPermanentSpell`, `isCasting`, `isDoubleFaced`, `faceIndex`, `targets[]` (TargetRef MP/prompts/common.rs:232-244: `kind` `player|card|spell` (223-230), `id`, `intent?`, `oracle?`).

**Checkpoints and restore vote**: `CheckpointDto` (185-193) {`checkpointId`,`turn`,`step`,`activePlayerId`}; `RestoreVoteDto` (160-169) {`voteId`,`checkpoint`,`requestedByPlayerId`,`awaitingPlayerIds[]`,`status`}; `RestoreVoteStatus` (171-183) tagged `type`: `pending`, `approved`, `declined{playerId}`, `unavailable`. Populated by Forge (`ManaBrewInteractiveSession.java:2103-2154`); empty in the Rust builder (game_view_dto.rs:1064-1066).

Other enums: `TargetingIntent` (467-499), `GameFormat` (540-556: `Any Standard Pioneer Modern Legacy Vintage Pauper Premodern Commander Brawl Oathbreaker Draft Sealed`, serialised with capital first letter), `EngineKind` (558-565: `Manabrew` default, `Forge`, `Ironsmith`).

### 4.1 Rust-engine builder helpers (AI/game_view_dto.rs) — reference only

| Function | Lines | Notes |
|---|---|---|
| `targeting_intent_of` | 18-61 | ApiType → intent; unknown/no api → `hostile`. |
| `classify_change_zone` | 64-88 | from graveyard/exile to hand/library/battlefield → `friendly`; from library → `fetch`; to exile → `exile`; to hand/library → `bounce`; to graveyard → `destroy`; to battlefield → `friendly`; else `hostile`. |
| `classify_put_counter` | 93-106 | `M1M1` (or text "-1/-1") → `debuff`, else `buff`. |
| `intent_is_hostile`, `is_hostile_api` | 108-132 | hostile set listed at 111-124. |
| `collect_stack_targets` | 134-171 | Walks the sub-ability chain; card, player and stack targets each become a TargetRef with intent and oracle. |
| `stack_source_ability_text` | 173-219 | Trigger description (with `ABILITY` substitution) or spell description; `None` for a permanent spell that is not a trigger; replaces `CARDNAME`/`NICKNAME`/`ORIGINALHOST`. |
| `stack_target_oracle` | 221-230 | stack description, else description. |
| `mana_pool_to_map`, `mana_color_from_name` | 232-265 | zero entries omitted; names or letters accepted. |
| `card_choices` | 267-333 | Empty for face-down; chosen type/number/player hidden from non-controllers unless revealed. |
| `phase_to_step`, `step_to_phase`, `zone_kind_of` | 335-382 | `zone_kind_of` maps unknown zones to `library`. |
| `target_ref_card/_player/_spell` | 384-409 | TargetRef without intent. |
| `day_time_of`, `should_show_command_zone_card` | 411-429 | Command-zone "Effect" cards (no core types) are hidden. |
| saga/class helpers, `roman_value`, `append_oracle` | 431-567 | Parse oracle text into chapters/levels. |
| `card_to_dto`, `card_to_dto_for_viewer` | 569-793 | Face-down battlefield cards become a nameless 2/2 "Face-down creature"; `summoningSick` false with haste; `commanderTax` uses owner, `effectiveManaCost` uses controller and only in the command zone. |
| `from_engine` | 806-1068 | Hand, graveyard, exile, command (visible), library (count only) per player; battlefield by controller; stack; **every hand is `visible` regardless of viewer** (815-830, 876). |
| `all_zone_cards` | 1070-1077 | visible cards only. |

---

## 5. Prompts (MP/prompts/)

`PromptInput` (mod.rs:56-81) is tagged `type`. `PromptOutput` (mod.rs:83-107) is **adjacently tagged**: `{"type":"<promptType>","output":{...}}`, and each inner output is itself tagged `type`. Common `presentation` = PromptPresentation {`title`, `description?`, `text?`, `targets[]`} (common.rs:6-19).

**`validate_response`** (mod.rs:116-163): `(chooseAction, act)` → `actionId` must be in `input.actions[].id`, else `UnknownActionId`; `(payManaCost, act)` → same against payment actions; `(chooseBoardTargets, cancel)` → `CancelNotAllowed` unless `cancellable`; every other matching pair → OK; mismatched families → `WrongPromptType`. Counts, membership of chosen ids, and `gameOver` (no output variant, so any response to it is `WrongPromptType`) are not checked here.

How the node applies it (jb:1637-1733): for `promptId ≠ 0`, the response must match the currently open prompt (`StalePrompt` otherwise, with the seat's own open prompt re-sent), be from its deciding seat (`WrongPlayer`), and pass `validate_response` (prompt re-sent with the error). **`promptId 0` skips all of this** and is submitted straight to Forge (1656-1658). `diceRolledAcknowledged` from any seat skips validation and only decrements a counter (1640-1654).

| `type` | Input (file:lines) | Output `output` | Notes |
|---|---|---|---|
| `mulligan` | `handCardIds[]`, `mulliganCount` (mulligan.rs:4-10) | `{type:"mulliganDecision", keep}` (12-21) | |
| `mulliganPutBack` | `handCardIds[]`, `cards[]`, `count` (mulligan_put_back.rs:6-13) | `{type:"mulliganPutBackDecision", cardIds[]}` (15-24) | |
| `chooseAction` | `actions[]` (choose_action.rs:7-12). `AvailableAction` = `id` + flattened kind tagged `type` (common.rs:96-122): `cast{cardId, mode, label}` (mode = PlayCardMode 59-75: `normal`, `backFaceLand`, `roomRightSplit`, `alternative{cost}` with AlternativeCostKind 21-57, `staticAlternative`, `foretellExile`, `unlockDoor`), `activateAbility{cardId, abilityIndex, description, isManaAbility, isClassLevelUp?, cost?, producedMana?}` (77-94), `undoMana{cardId}` | `{type:"pass", until?:{playerId, phase, throughCombat?}, exhaustStack?}` or `{type:"act", actionId}` (14-42) | Priority prompt. |
| `chooseAttackers` | `attackers[]` {`attackerId`, `validTargetIds[]`, `mustAttack`}, `attackTargets[]` {`id`,`label`,`kind` `player|planeswalker|battle`} (choose_attackers.rs:6-21; common.rs:168-184) | `{type:"declareAttackers", assignments[{attackerId,targetId}]}` (23-32) | |
| `chooseBlockers` | `attackers[]` {`attackerId`, `validBlockerIds[]`, `minBlockers`, `maxBlockers?`, `mustBeBlocked`}, `availableBlockerIds[]`, `error?` (choose_blockers.rs:6-29) | `{type:"declareBlockers", assignments[{blockerId,attackerId}]}` (31-40) | `error` explains why a previous declaration was refused. |
| `chooseBoardTargets` | `presentation`, `candidates[]` (TargetRef), `hostile` (default false), `intent`, `minTargets`, `maxTargets`, `chosenTargets`, `cancellable` (choose_board_targets.rs:7-20) | `{type:"boardTargets", chosen:[TargetRef]}` or `{type:"cancel"}` (22-32) | |
| `chooseBoolean` | `presentation`, `confirmLabel`, `denyLabel` (choose_boolean.rs:6-13) | `{type:"decision", value}` (15-24) | |
| `chooseFromSelection` | `presentation`, `options[]` {`label`,`weight`,`canRepeat`}, `minTotal`, `maxTotal` (choose_from_selection.rs:6-23) | `{type:"selectionDecision", chosenIndices[]}` (25-34) | Indices into `options`; repeats allowed only for `canRepeat`. |
| `gameOver` | `{}` (game_over.rs:4-6) | none | Node sends it to every seat with `promptId 4294967295`, `decidingPlayerId player-0` (jb:1879-1882, 1976-1984). |
| `revealCards` | `presentation`, `cards[]`, `zone`, `ownerPlayerId` (reveal.rs:7-15) | `{type:"revealCardsAcknowledged"}` (17-26) | |
| `scry` | `presentation`, `cards[]`, `zones[]` (`libraryTop libraryBottom graveyard exile hand`) (scry.rs:7-25) | `{type:"scryDecision", zoneCardIds:[[ids]…]}`, one list per entry of `zones`, same order (27-36) | |
| `chooseColor` | `presentation`, `validColors[]`, `amount`, `repeatAllowed` (choose_color.rs:8-16) | `{type:"colorDecision", chosenColors:{color: count}}` (18-29) | |
| `chooseNumber` | `presentation`, `min`, `max` (choose_number.rs:6-13) | `{type:"numberDecision", chosenNumber}` (number or null) (15-24) | |
| `chooseDamageAssignmentOrder` | `attackerId`, `blockerIds[]`, `blockerCards[]` (choose_damage_assignment_order.rs:6-13) | `{type:"damageAssignmentOrderDecision", orderedBlockerIds[]}` (15-24) | |
| `chooseCombatDamageAssignment` | `attackerId`, `blockerIds[]`, `defenderId?`, `totalDamage`, `attackerHasDeathtouch` (choose_combat_damage_assignment.rs:6-17) | `{type:"combatDamageAssignmentDecision", assignments[{assigneeId,damage}]}` (19-30; common.rs:202-208) | |
| `payManaCost` | `presentation`, `cardId`, `cardName`, `manaCost`, `canConfirmFromPool`, `actions[]` (pay_mana_cost.rs:6-16). `PaymentAction` = `id` + kind (common.rs:134-166): `activateManaAbility{…ActivatableAbilityInfo}`, `undoMana{cardId}`, `useResource{cardId, resource}`, `releaseResource{cardId, resource}` (resource `convoke|improvise|delve|waterbend`, 124-132), `payLife{amount}` | `{type:"act", actionId}`, `{type:"pay", auto}` (`auto` default false), `{type:"cancel"}` (18-34) | `pay{auto:true}` auto-taps; when the pool then covers the cost Forge re-prompts with `canConfirmFromPool:true` and waits for `pay{auto:false}` (TESTING.md:181). |
| `chooseCards` | `presentation`, `cards[]` (CardDto), `min`, `max` (choose_cards.rs:7-15) | `{type:"chooseCardsDecision", chosenCardIds[]}` (17-26) | |
| `reorder` | `presentation`, `items[]` {`id`, `card`, `oracle?`} (reorder.rs:7-24) | `{type:"reorderDecision", orderedIds[]}` (26-35) | |
| `diceRolled` | `presentation`, `sides`, `rolls[]` {`label?`, `playerId?`, `round`, `naturalResults[]`, `finalResults[]`, `ignoredRolls[]`, `highlighted`} (dice_rolled.rs:6-32) | `{type:"diceRolledAcknowledged"}` (34-43) | Sent to **every** remote seat; Forge continues only after as many acks as there are remote seats (jb:1805-1829). |

Other shared types in common.rs: `AttackAssignment` (194-200), `BlockAssignment` (186-192), `TargetAnyChoice` (210-221, unused by these prompts).

---

## 6. Directives (MP/transport/mod.rs:24-36)

Wire: `{kind:"directive", fromPlayer:"player-N", directive:{type, …}}`, `DirectiveInput` tagged `type`, camelCase fields. Node path: `route_seat_envelope` → `route_remote_directive` (host:2159-2192) → slot check (`authenticated_player_index` 2194-2219). Forge receives `{"type":"directive","directive":…,"player":N}` (`directive_json`, jb:2247-2250), translated by `ManabrewProtocolAdapter.translateDirective` (Java 200-224).

| `type` | Fields | What happens |
|---|---|---|
| `concede` | – | `concede_seat` (host:1937-1945) → engine; Forge concedes the player and checks game over (`ManaBrewInteractiveSession.java:~1995-2006`; already-lost players ignored). The node also concedes automatically on `PlayerLeft` mid-game (host:1310-1322) and after a resume for seats missing from the room (host:1915-1935). |
| `requestRestore` | `checkpointId` | Forwarded. Forge ignores it if a vote is pending or the requester has lost; opens a vote whose voters are other live, non-bot, human seats (`ManaBrewInteractiveSession.java:2103-2124`). With no voters it applies on the next check. |
| `restoreVote` | `voteId`, `accept` | Forwarded. Ignored unless the vote is pending, ids match and the voter is awaited; `accept:false` → `declined{playerId}`; when nobody is awaited (lost players drop out) the game restores, or `unavailable` if the checkpoint was evicted (Java 2009-2023, 2044-2051, 2126-2137). Shown in `gameView.restoreVote`. |
| `setSnapshotRecording` | `enabled` | **Refused from seats** with a warning (host:2188-2190). Disabling clears checkpoints (Java 2032-2038). |

~~The bridge sends no directives today.~~ Since 2026-10-20 the bridge sends `concede`, `requestRestore` and `restoreVote`
(rewind, M4.5), and, on our builds only, `applyState {fixId, ops}` (manual fix, M7; also `mtg debug`'s `createCard` ops),
answered in `gameView.stateFix`. The stock relay drops `applyState` as an unauthorized envelope, which is why the relay is
our build too.

---

## 7. The self-hosted node

### 7.1 Configuration (cfg)

`Config` (cfg:12-45), built by `Config::from_env` (70-155). `env_first(primary, fallback)` (368-370) reads the first var set; `env_bool` (386-394) accepts `1/true/yes/on` and `0/false/no/off` (case-insensitive), anything else → default; `arg_value` (372-384) reads `--flag=value` or `--flag value`; `parse_format` (396-402) capitalises the first letter and lowercases the rest, then parses `GameFormat` (so `commander` → `Commander`, `Any` default on failure).

| Var (legacy alias) | Default | Lines |
|---|---|---|
| `SELF_HOSTED_NODE_ENGINE_BACKEND` (`FORGE_ROOM_ENGINE_BACKEND`) | `manabrew`; `forge` selects Java; unknown → `manabrew` | engine_backend.rs:18-32 |
| `SELF_HOSTED_NODE_RELAY_URL` (`FORGE_RELAY_URL`) | `ws://127.0.0.1:9443` | 95-96 |
| `SELF_HOSTED_NODE_SERVER_KEY` (`MANABREW_SERVER_KEY`) | `forge` | 98-99 |
| `SELF_HOSTED_NODE_ROOM_ID` (`FORGE_ROOM_ID`) | none → create room; set → join it (as observer unless host plays) | 86-88 |
| `SELF_HOSTED_NODE_ROOM_NAME` (`FORGE_ROOM_NAME`) | `Self-Hosted Node` | 101-102 |
| `SELF_HOSTED_NODE_MAX_PLAYERS` (`FORGE_ROOM_MAX_PLAYERS`) | 4 (unparsable → 4) | 103-105 |
| `SELF_HOSTED_NODE_STATE_DELTA` (`FORGE_ROOM_STATE_DELTA`) | true | 106-113 |
| `SELF_HOSTED_NODE_MAX_GAMES` (`FORGE_ROOM_MAX_GAMES`) | 1 (values <1 ignored). >1 hosts that many rooms named `<name> (n)` with **format forced to `Any`** (host:444-468) | 114-117 |
| `SELF_HOSTED_NODE_FORMAT` (`FORGE_ROOM_FORMAT`) | `Any` | 90-92 |
| `SELF_HOSTED_NODE_AUTO_START` (`FORGE_ROOM_AUTO_START`) | false | 119-123 |
| `SELF_HOSTED_NODE_ENGINE_ENABLED` (`FORGE_ROOM_ENGINE_ENABLED`) | true iff no room id | 124-128 |
| `SELF_HOSTED_NODE_HOST_PLAYS` (`FORGE_ROOM_NODE_HOST_PLAYS`) | false | 129-133 |
| `--official` / `SELF_HOSTED_NODE_OFFICIAL_KEY` (`SECRET_MANABREW_KEY`) | none | 134-136 |
| `--password` / `SELF_HOSTED_NODE_ROOM_PASSWORD` (`FORGE_ROOM_PASSWORD`) | none | 137-139 |
| `SELF_HOSTED_NODE_BOT_ENABLED` (`FORGE_ROOM_BOT_ENABLED`) | false (spawn bots at startup) | 140-144 |
| `SELF_HOSTED_NODE_BOT_USERNAME` (`FORGE_ROOM_BOT_USERNAME`) | `<node username>-bot` | 73-74 |
| `SELF_HOSTED_NODE_FORGE_AI` (`FORGE_ROOM_FORGE_AI`) | false | 146 |
| `SELF_HOSTED_NODE_BOT_LOCAL_ANSWERS` | true | 148 |
| `SELF_HOSTED_NODE_RECONNECT_TIMEOUT_S` | none (relay default 60, clamp 10-90, lobby:16-18) | 149-150 |
| `SELF_HOSTED_NODE_DECK` / `_BOT_DECK` (`FORGE_ROOM_NODE_DECK` / `FORGE_ROOM_BOT_DECK`) | `ashling_limitless_commander` / `neheb_minotaur_commander` | 75-78 |
| `SELF_HOSTED_NODE_COMMANDER` / `_BOT_COMMANDER` | inferred by `infer_commander_name` (356-366); empty string ignored | 79-84 |
| `PRESET_DECKS_DIR` | `<workspace>/public/preset_decks` (`workspace_root` 278-284 is compile-time `CARGO_MANIFEST_DIR`/../../..) | 328-332 |
| `SELF_HOSTED_NODE_SELF_PLAY_*` | self-play test mode (`SelfPlayConfig::from_env` 210-246) | |

Node username: `self-hosted-node-<uuid v4>` (cfg:72), new on every process start. Deck loading: `load_deck_selection` (286-294) → `load_preset_deck` (296-326; reads `label`, `commander`, `cards[{name,count,set}]`, collector number empty) or, on any error, `synthetic_deck` = 60 × Mountain M20 (334-354) with a warning. `for_hosted_room` (162-200) is the desktop-embedded variant (deltas off). Other runtime vars are documented in SELF_HOSTED_NODE.md (`SHARED_ISOLATE`, `FORGE_MAX_HEAP`, `LOGS_PUSH_URL`, `HEAP_DUMP_DIR`, `SHUTDOWN_ON_STALE`, `JAVA_*`), and `cli_entry` has test modes (`SELF_HOSTED_NODE_JAVA_SMOKE`, `_GRAAL_SMOKE`, `_JAVA_CONCEDE_SMOKE`, `_JAVA_SCENARIO`, `_JAVA_SELF_PLAY`, `_JAVA_CONCURRENT_GAMES`, `_RUST_SELF_PLAY`) that run instead of hosting (host:217-319).

### 7.2 Process and room lifecycle (host.rs)

| Function | Lines | Behaviour |
|---|---|---|
| `cli_entry` | 202-326 | Tracing (`RUST_LOG`, default `self_hosted_node=info`), metrics, test modes, then `run(Config::from_env())`; exits 1 on error. |
| `ensure_engine_ready` | 331-340 | Initialises Java/Graal once when engine enabled + backend supported + Forge. |
| `host_room`, `host_room_bridged` | 344-367 | Library entry points (desktop). |
| `run` | 369-469 | One room if `room_id` set or `max_games ≤ 1`, else N rooms (format forced `Any`). Spawns stale-version monitor, SIGTERM/Ctrl-C → cancel all rooms; SIGUSR1 → drain (no new games, close idle rooms); SIGUSR2 (graal) → heap dump. |
| `notify_all`, `wait_for_shutdown_signal` | 471-498 | |
| `registry_idle`, `draining` | 150-165 | idle = every engine session slot empty. |
| `host_one_room` | 500-650 | Label suffixes, `HostSnapshot` (178-186: `room_info`, `resume_token`, `game`, `last_state`, `last_state_by_slot`, `pending_prompts`, `pending_end_game`), engine session slot, bot list, outbound channel. `RelayClient::connect` → `establish_room`; optional startup bots (`BOT_ENABLED`); then `run_client_loop` forever. On `Disconnected`: backoff 1,2,4,8,15,30 s (190) reconnect + `reestablish_room`; if the room id changed, bots respawn. On `Cancelled`: stop bots, close socket. |
| `establish_room` | 695-741 | With `room_id`: `JoinRoom{observe: !host_plays}`. Else `CreateRoom{max_players, format, protocol_version, hosted: !host_plays, engine: Forge/Manabrew (834-840), official_key, password, reconnect_timeout_s, table_style}` then `wait_for_host_room`. If host plays: `seat_client`. |
| `wait_for_host_room` | 1070-1106 | Waits for `RoomCreated` (stores token + info) or a `RoomUpdate` where `host == node`; failed `AuthResult` or any `Error` aborts. |
| `seat_client` | 1108-1131 | `SetDeckSelection` + `SetReady{true}`. |
| `reestablish_room` | 743-832 | If a game is active and a token/game/room are cached: `ResumeRoom` (built by `resume_room_request` 842-873, `bot_players` = `is_bot` seats) → `wait_for_room_resumed`; on success re-sends observer state, every seat state and pending prompt (targeted), and a pending `EndGame`. On refusal, aborts the engine. Otherwise `establish_room` (a fresh room). |
| `wait_for_room_resumed` | 875-937 | `RoomResumed`: Lobby → abort stale session, else concede seats missing from the room. `RoomUpdate`: same plus cache. Responses/directives arriving meanwhile are routed. `Error` → `None`. |
| `run_client_loop` | 1133-1249 | `select!` over: cancel → cancel engine, `Cancelled`; 5 s drain tick (draining + idle → `Cancelled`); 30 s heartbeat roomRelay; outbound queue (targeted envelopes go to the webview bridge first when present); webview commands; relay messages → `handle_server_message`. Any send failure → `Disconnected`. `forge_ai` starts as `config.forge_ai` per loop (1151). |
| `handle_server_message` | 1251-1394 | `RoomUpdate`: cache room, recompute bot usernames from `is_bot`, log; Lobby → `abort_stale_engine_session`; InGame → `end_game_without_humans`; then `maybe_auto_start_room`. `StateUpdate` → `handle_state_update`. `PlayerLeft` of a still-active seat → concede. `GameStarted`: abort any stale session, store `GameStart`, clear cached states/prompts/pending end, freeze webview seats, `maybe_start_hosted_engine`. `PeerSignal`, `RoomTransport`, `ReadyStateChanged`, `PlayerJoined`, `ServerShuttingDown`, `Error` → log only. |
| `handle_state_update` | 1396-1469 | Unparseable envelope → debug, ignored. `response`/`directive` → `route_seat_envelope` with the relay-attested sender. `roomRelay` with protocol `self-hosted-node`: `removeBot` → `stop_bots`; `spawnBot` → if `roomId` absent or equal: `forge_ai = config.forge_ai || payload.forgeAi`, decks from payload, `spawn_bots`; other rooms ignored. Everything else ignored. |
| `bot_decks_from_payload`, `deck_selection_from_payload` | 1471-1507 | `decks` (non-empty) wins, else `deck`, else configured bot deck. Payload deck = `{deckName, deck, commanderName?}` (`SpawnBotDeckPayload` 138-145); commander falls back to `deck.commanders[0].identity.name`. An unparseable payload silently uses the configured deck. |
| `spawn_bots` | 1014-1051 | `stop_bots` first; at most `max_players - 1` decks; usernames `<bot_username>`, `<bot_username> 2`, …; each runs `manabot::run_bot` with agent `config.bot_agent` (`AgentKind::Simple`, manabot/src/agent/mod.rs:30-44). |
| `stop_bots` | 1053-1068 | Notifies each bot, aborts after 5 s (195). |
| `maybe_auto_start_room` | 1509-1541 | Only if auto-start, not draining, format ≠ `Any`, node is `room.host`, Lobby, seats ≥ `max_players`, all connected+ready+deck → `StartGame{format:None}`. See §11 (#7). |
| `end_game_without_humans` | 986-1012 | During a game, if every seat is a bot: abort session, clear snapshot, `EndGame`. |
| `cancel_engine`, `abort_engine_session`, `abort_stale_engine_session`, `clear_game_snapshot`, `clear_engine_session` | 939-984, 1868-1873 | Cancel flag for Forge; dropping response channels ends the engine thread; snapshot cleared only if it is for that game. |

### 7.3 Starting and running a game

`maybe_start_hosted_engine` (host:1594-1866): returns early (with a log) if engine disabled, backend unsupported, host-plays but node not in `player_order`, a session already exists, fewer than 2 players, or any player lacks a deck. Seat `i` = `player_order[i]`. Bot seats (`is_bot` usernames) go to `ai_player_indices` when `forge_ai`, else `bot_player_indices` (1683-1689). Room format → `commander_variant` (`is_commander_variant` 1557-1572: `Any`, Commander, Brawl, Oathbreaker) and Forge variant name (`java_game_variant` 1576-1592: `""`, `Commander`, `Brawl`, `Oathbreaker`, else `Constructed`). Creates one response channel per non-local seat (**including Forge-AI seats**), stores `EngineSession::Forge{game_id, remote_response_txs, cancel, engine_clock, local_bot_answers}` (56-70), starts `spawn_remote_prompt_forwarder` and `spawn_game_over_forwarder`, then a 64 MB-stack thread (`spawn_engine_thread` 1543-1553) running `java_backend::run_hosted_engine_game` under `catch_unwind`, finished by `finish_hosted_engine`.

`run_hosted_engine_game_inner` (jb:1546-1898):
- Builds `PlayerConfig` per seat (jb:3048-3056): deck = `cards` + `commanders` identities, sideboard, attractions; names reduced to the front face before `" // "` (`java_card_name` 3139-3143); commander names from `deck.commanders`, else `commander_name` (2007-2021), only for commander variants. `ai`/`bot` flags. `StartGameRequest{gameId, variant, startingLife, seed: random, players, checkpointMetrics:true}`. A `SessionGuard` aborts the Java session if the loop exits early.
- Loop: cancel flag → return. Drain each seat's channel: dice ack bookkeeping; responses validated as in §5 and submitted; directives submitted as `directive_json`. If `state_revision` changed: send a fresh per-seat `State` to every remote seat, then the observer state (`send_observer_state` 1916-1930, seat `OBSERVER_SEAT = usize::MAX`, host:193). If a new prompt id appears: metrics, slow-decision warning ≥1.5 s (1478-1479, 1789-1799), remember it; `diceRolled` → states + prompt to every seat, wait for acks; prompt for the local seat → `auto_action` passes `chooseAction` (1962-1973); otherwise states for every seat, observer state, then the prompt to the deciding seat. Game over: final per-seat and observer states, a `gameOver` prompt to every seat, `HostedGameOver` to the forwarder, `end_game`. Sleep 2 ms for 500 ms after activity, else 10 ms (1493-1497, 1894-1898).
- `player_index("player-N")` (1933-1939) returns **0** for anything unparseable.

`spawn_remote_prompt_forwarder` (host:2386-2504), one thread per game: stops when the session is gone or belongs to another game. For each `(seat, message)`: `per_seat` = not observer; `engineMs` from the clock, cleared on a prompt; envelope built; deltas on → `stamp_fingerprint` (2221-2232); duplicate suppression (same per-seat state, same observer state, same display) **compares the whole envelope including `engineMs`**; cache to `HostSnapshot`; local bot answer if any; deltas on → `patch_against_last` (falls back to the full state when it returns `None`); target = seat username for state/prompt/error of a seat (missing name → warn, dropped); `stamp_emit_ms`; `BroadcastState`.

`patch_against_last` (host:2294-2316): stores the new full state as the seat's base, returns `None` the first time, when the envelope lacks `state`/`fingerprint`, or when `diff` finds no change.

`spawn_game_over_forwarder` (host:2526-2665): ignores stale sessions; marks `pending_end_game`; outcome = last `State` in the batch (`outcome_report` 2506-2519: `game_over`, `winner_id`, conceded ids, `turn`), else cached state if it says game over (`cached_outcome_report` 2521-2524); sends the batch **as full states** (no fingerprint, no delta), roomRelay `gameOver`, `ReportGameOutcome` (if any), `EndGame`.

`finish_hosted_engine` (host:1982-2048): records metrics; on error or panic, if this session still owns the slot: `pending_end_game`, `ReportGameOutcome{fatal_message}`, untargeted `fatal`, `EndGame`. A clean finish sends nothing (the game-over forwarder already did). Note the session slot is not cleared here.

Seat input routing:
- `route_seat_envelope` (2050-2073): `response` → `route_remote_response`; `directive` → `route_remote_directive`; else debug.
- `route_remote_response` (2075-2157): re-parse; slot check; `action` must parse as `PromptOutput` (else warn, dropped); no session → dropped; duplicate of a locally answered bot prompt → dropped (`is_local_bot_duplicate` 112-121: `promptId ≠ 0` and ≤ last local answer); `mark_response`; send to the seat channel; clear the cached pending prompt.
- `authenticated_player_index` (2194-2219): sender username must be in `player_order` and its slot must equal the claimed slot.
- `send_seat_message` (1947-1980), `seat_index_of` (1909-1913), `active_player_usernames` (1875-1907: players with `status` other than `playing` in the last **observer** state are excluded), `concede_missing_active_seats` (1915-1935).
- `local_bot_seats` / `answer_bot_locally` (2318-2384): only with `bot_enabled && bot_local_answers && !config.forge_ai`.

`RelayClient` (host:45-50, 2691-2809): `connect` sends `Authenticate{service:true, identity token self-minted as "node:<username>" (2683-2689), client_version:None}` and waits for `AuthResult` (2726-2742); `send`/`enqueue` go through a writer task (`relay_writer` 2667-2681); `recv` answers pings, returns `None` on Close, and **errors on any text frame that does not parse as `ServerMessage`** (2757-2776); `close` drains 3 s; `broadcast_room_message` wraps a payload in a roomRelay with `fromPlayer` = node username. `log_room_update` (2811-2833) logs seats as `name[:ready][:offline]`.

---

## 8. Bots (manabot)

`run_bot` (manabot/src/native.rs:27-54): loops `run_bot_session` with backoff 1,2,4,8,15,30 s (19), reset after a clean disconnect; exits on shutdown. `run_bot_session` (56-116): connect, `on_open`, feed every text frame to `on_server_message`, send replies (optional `answer_delay_ms` before each `BroadcastState`), pong pings, stop with an error when `failure()` is set. **A text frame that does not parse as `ServerMessage` ends the session with an error** (92-93). `close` (118-126), `send` (128-134).

`BotState` (manabot/src/state.rs:71-78; `BotConfig` 34-51; phases 53-61):

| Function | Lines | Behaviour |
|---|---|---|
| `on_open` | 127-144 | Once: `Authenticate{service:true, unsigned token "bot:<username>", client_version:None}`. |
| `on_server_message` | 146-228 | `AuthResult` ok + `reconnected` → `RequestResync`; ok → `JoinRoom{as_bot:true}`; failure → `fail`. `RoomUpdate` listing the bot: InGame → `RequestResync`, else `SetDeckSelection` + `SetReady`. `Error` while joining → fail. `GameStarted` → slot from `player_order` (absent → fail), clears board. `StateUpdate` while playing → `handle_envelope`. All else ignored. |
| `accepts_board` | 244-257 | Own slot → addressed; other slot → ignore; untargeted → only until an addressed board exists. |
| `observe_board` | 259-272 | Feeds `gameView` to the agent, stores state + fingerprint. |
| `request_resync` | 274-293 | One `RequestResync` until the next full state (`resync_pending`). |
| `handle_envelope` | 295-417 | `state` → store; `stateDelta` → apply if `base` matches, else resync; `prompt` for own slot → raw `{kind:"priority"}` answered `{kind:"pass"}` with id 0 (366-369), else parse `AgentPrompt`, `agent.decide`, send `response` untargeted. |

---

## 9. What the bridge uses (bridge/bridge.js)

As read before 2026-10-20; the line numbers no longer match. Changed since: the bridge also sends `SetMaxPlayers`
(controller seat, when a game needs more than the room's seats) and the directives in §6; `log` envelopes are read by
the lead seat; the game log comes from `gameView.events` (`engineFacts`), with board comparison only as the fallback.

- Wire: `Authenticate`, `ListRooms`, `JoinRoom`, `SetDeckSelection`, `SetReady`, `BroadcastState` (roomRelay `spawnBot`, `response`), `StartGame`, `RequestResync`, `LeaveRoom`. Handles `AuthResult`, `RoomList`, `RoomUpdate`, `GameStarted`, `StateUpdate`, `Error`, `GameAborted` (bridge.js:201-235).
- Envelopes handled (236-262): `state` (own, or observer as first board), `stateDelta` (own only; base mismatch → `RequestResync`), `prompt` (own), `error` (own, chat), `log` (first seat only), `fatal`. Ignores `display`, `snapshot`, `roomRelay`.
- Decks: presets from `decks/` then `manabrew/public/preset_decks` (bridge/presets.js) with the commander moved into `deck.commanders` (75-92), or table decks as names only (161-168).
- Prompt handling (572-767): every `PromptInput` type mapped; `reorder`, `chooseDamageAssignmentOrder`, `chooseCombatDamageAssignment` auto-answered; `revealCards` titled "AI can't play…" auto-acked; `gameOver` → chat only; unknown types → chat.
- Library-search detection (657-669): for `chooseCards`, if every offered id is missing from every zone in the seat's view → `ui.librarySearch`; if every offered id is in a graveyard/exile zone → `ui.pileChoices`.
- Auto-pay (619-641; since 2026-11-05 the bridge taps for plain costs itself, keeping the colours the hand needs, and
  sends Forge's auto-pay only for hybrid, X, Phyrexian and similar costs, docs/mechanic-runs-2026-11-05.md #13): `pay{auto:true}` once per card; if the next prompt for that card has `canConfirmFromPool`, auto-confirm with `pay{auto:false}`; if auto-pay already ran and the engine asks again without the pool flag, Auto-pay is no longer offered.
- Player names in engine text are replaced case-insensitively with colours/"AI n" (`displayText` 503-518).

---

## 10. Player-count limits (summary)

- `CreateRoom` `max_players` clamped 2-8 (room:83); the hosted node is an observer and does not count (room:84-108).
- `SetMaxPlayers` clamps to ≤4 upstream (lobby:640); our relay patch clamps to ≤8 (2026-11-16).
- After every game, and whenever the last seat leaves a Lobby room the node still observes, `max_players` → 4 and format → `Any` (room:155-160; lobby:437-439, 797; cleanup:534-536). So `SEATS` 5-8 only holds for the first game after the node starts.
- Bridge accepts 2 to `TABLE_COLORS.length` (4 on the 4-player table, up to 6 on the 6-player one) players total
  (`startGame` in bridge.js). Before a bigger game it sends `SetMaxPlayers`, which our relay build clamps to 8 (upstream: 4).
- `JoinRoom` → `room_full` at seats ≥ `max_players` (room:140-142, 173-182).
- Node spawns at most `max_players - 1` bots (host:1023-1024).
- `diceRolled` waits for one ack per remote seat, including Forge-AI seats (jb:1818).

---

## 11. Bugs, oddities and quirks

Project findings (from testing):

1. **Hybrid generic costs (`{2/B}`)**: Forge sometimes never sets `canConfirmFromPool` even with enough mana floating, so auto-pay loops (TESTING.md:222, 242). Workaround: Cancel, tap sources manually; the bridge stops offering Auto-pay after one failure (bridge.js:626-638).
2. **Game log only to spectators** (TESTING.md:243). **Moot since 2026-11-01 to 11-03:** our harness sends Forge's own
   event feed in `gameView.events`, which drives the log. Code reading did not confirm the mechanism: the relay accepts `log` only from the host (conn:77), `AgentMessage` has no log variant (MP/transport/mod.rs:8-15), and neither the node nor the harness `host/` package emits a `kind:"log"` envelope. So a spectator connection may not help either; check a capture before building one.
3. **Player names in prompt text** are relay usernames, sometimes capitalised ("Self-hosted-node-…-bot"); bot usernames come from host:1025-1029 and cfg:72-74. The bridge rewrites them (bridge.js:503-518; PLAN.md:115).

Found while reading the code:

4. **Bridge error filter never matches**: `bridge.js:229` hides `code === "NotHost"`, but the relay sends `not_host` (error.rs:71). **Fixed:** the bridge now hides both.
5. **`StartGame`/`spawnBot` from `seats[0]`**: both are controller-only (lobby:665-667; conn:176-178; controller = first non-bot seat to join, room:334-340). Bridge seats connect concurrently, so if another seat joined first, `StartGame` returns `not_host` and `spawnBot` is dropped with only a relay warning (bridge.js:294, 302; conn:2196-2199). **Fixed 2026-10-31:** `controllerOf` sends them (and `SetMaxPlayers`) from the first human seated.
6. **Room settings reset**: format → `Any` and `max_players` → 4 after each game and after the last seat leaves (§10). The bridge's `StartGame{format:"Commander"}` covers the format.
7. **Node auto-start cannot work in a hosted room**: `maybe_auto_start_room` sends `StartGame` from the node (host:1509-1541), but the node is an observer, never the controller, so the relay answers `not_host` (lobby:665-667). It also needs seats ≥ `max_players` and a non-`Any` format.
8. **Redundant full states before each prompt (likely)**: the Java loop re-sends every seat's state before each prompt (jb:1837-1848). The forwarder's duplicate check compares the envelope including `engineMs` (host:2415, 2437-2443), so an unchanged board with a different `engineMs` is not suppressed; `patch_against_last` then finds no diff and returns `None`, and the caller sends the **full** state (host:2294-2306, 2465-2476). Confirm with a capture.
9. **`promptId 0` bypasses validation** (jb:1656-1658). The bridge sends 0 when a prompt has no id (`promptId ?? 0`, bridge.js:199) and for raw priority prompts (bridge.js:574), so those answers reach Forge unchecked.
10. **manabot's raw-priority answer is malformed for the node**: `{kind:"pass"}` (manabot/src/state.rs:369) is not a `PromptOutput`, so `route_remote_response` drops it (host:2102-2108).
11. **Dice acks are not tied to a prompt or a seat**: any `diceRolledAcknowledged` decrements the counter, so one seat acking twice can release the roll early (jb:1640-1654). The counter includes Forge-AI seats, whose manabot connections must still answer (jb:1818), or the game waits.
12. **`player_index` defaults to seat 0** for an unparseable `decidingPlayerId` (jb:1933-1939).
13. **Split-card names**: `java_card_name` keeps only the part before `" // "` (jb:3139-3143), so a split card like "Fire // Ice" reaches Forge as "Fire". Check whether Forge resolves it.
14. **Unparseable `ServerMessage` breaks node and bot sockets**: both treat it as a connection error (host:2767; manabot/src/native.rs:92-93), so a newer relay variant makes them reconnect in a loop. ~~Images are `:latest`.~~ Our relay and node are local builds now (§1.1), so this needs a deliberate rebuild to happen.
15. **Replay folding does not check `base`** (replay:71-95), and the folded envelope keeps the old `engineMs`/`emitMs` while taking the new fingerprint.
16. **`active_player_usernames` reads only the observer state** (`snap.last_state`, host:1883-1887); with per-seat states that is the untargeted observer view, which the Java loop does send (jb:1762), so it works for Forge.
17. **Rust-engine builder shows every hand** (`from_engine` 815-830, 876); not used with `forge`, but it means `SELF_HOSTED_NODE_ENGINE_BACKEND=manabrew` would leak hands.
18. **Game-over batch is sent as full states without fingerprints** (host:2578-2586); a delta-applying client must accept a full `state` at any time.
19. **`setSnapshotRecording` from a seat is refused** (host:2188-2190), so seats cannot turn checkpoints off.
20. **Bridge `RoomUpdate` after reset**: `onRoomUpdate` dereferences `game.seats` (bridge.js:288) but `resetGame` sets `game = null` (471) before seat sockets finish closing, so a late `RoomUpdate` on a closing seat would throw. **Fixed:** `onRoomUpdate` returns when `game` is null or closing.
21. **Bridge resync spam**: unlike manabot, the bridge has no `resync_pending` guard, so every mismatching patch sends another `RequestResync` (bridge.js:245). Still true (`onEnvelope`, `stateDelta`).
22. **Bridge answer approximations**: `chooseBlockers` can express only one attacker per blocker and `chooseAttackers` one target per attacker (later picks win, bridge.js:680-702); `chooseColor` puts the whole `amount` on one colour (713-715); `chooseFromSelection` ignores `canRepeat` (676-678); `scry` with more than two destinations leaves the extras empty (704-711).
23. **`turn` counts all players' turns** (turn 10 = your 5th in two-player); the bridge counts per player (bridge.js:407-413).
24. **Resync after a bad base must replace the board**, never partially apply (AI/protocol.rs:45-48); the relay-folded state from `RequestResync` carries the node's fingerprint, so later patches apply to it.
