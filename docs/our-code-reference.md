# Our code: function reference

Scope: the code this project wrote. Manabrew, Forge and the group's table scripts are only covered where our code hooks into them.
Line numbers match the files as read on 2026-10-17 at about 21:35 (both files were being edited during the review; re-check line numbers after later edits): `bridge/bridge.js` (955 lines), `bridge/state-delta.js` (84), `tools/engine-renderer.lua` (1207, including the phase 2 section), `tools/make-engine-copy.js` (448).
Design context: [SPEC.md](../SPEC.md) §2–§6 and §10a. Status: [PLAN.md](../PLAN.md).

Abbreviations: **br** = `bridge/bridge.js`, **sd** = `bridge/state-delta.js`, **er** = `tools/engine-renderer.lua`, **mec** = `tools/make-engine-copy.js`. "Bug?" marks something that looks wrong or fragile. It is an observation, not a confirmed defect.

Contents:
1. Architecture and message flows
2. Message protocol, Global ⇄ bridge
3. `bridge/bridge.js` and `bridge/state-delta.js`
4. Global Lua: the injected ENGINE MODE block and `engine-renderer.lua`
5. `make-engine-copy.js`: patches, guards, rebuild
6. Tools and tests
7. Bugs and oddities, all in one list

---

## 1. Architecture

```
  Other players' TTS clients ──(TTS multiplayer: objects + UI copied; their clicks run on the host)──┐
                                                                                                    │
 HOST PC                                                                                            ▼
 ┌───────────────────────────────┐  TCP 127.0.0.1:39999  {messageID:2, customMessage:{t,json}}  ┌──────────────────────┐
 │ TTS host, engine-mode table   │ ◄─────────────────────────────────────────────────────────────│ bridge/bridge.js     │
 │  Global script =              │                                                               │  Node 22, no deps    │
 │   table's own Global (patched)│  TCP 127.0.0.1:39998  {messageID:4, customMessage:{t,json}}   │  one Seat (WebSocket │
 │   + ENGINE MODE block (mec)   │ ─────────────────────────────────────────────────────────────►│  session) per seated │
 │   + engine-renderer.lua (er)  │  also messageID 1/2/3/5 (load, print, error, Lua return value)│  TTS colour          │
 │  object scripts: + guards     │                                                               └───┬─────────┬───────┘
 └───────────────────────────────┘                                                                   │ ws:9443 │ HTTP 127.0.0.1:48787
                                                                                                     ▼         ▼  (debug: /exec /state /log)
                                                                         ┌─────────────────────────────┐   tools/tts-*.js, curl
                                                                         │ manabrew-server (relay)     │
                                                                         └──────────────┬──────────────┘
                                                                                        ▼
                                                                         ┌─────────────────────────────┐
                                                                         │ self-hosted-node + Forge    │ Docker stack/compose.yml,
                                                                         │ room "tts-commander"        │ service "forge-room"
                                                                         └─────────────────────────────┘
 Bridge side channels: Scryfall /cards/collection (image lookup), `docker compose restart forge-room` (mtg reset).
```

Every Global⇄bridge payload travels as `{ t, json }`: `t` is the type and `json` is the whole payload as a JSON string. TTS turns nested tables into unusable objects or drops them (br:31-34, mec:324-329).

### Flow: `mtg ready`
1. Player types `mtg ready` (host: `mtg ready all`). The table's `onChat` runs the inserted hook, which calls `engineChat` first (mec:154-157, 196-204).
2. `engineSendDecks(colors, requester)` (mec:282) reads, per colour: the deck in `data[color].libraryZone`, imported cards in the hand (`handCards`), and the commander (`commandersFor`). Each card becomes `{ n, f, b }`.
3. Global sends `decks { seats, request }` and starts a 4 s "No answer from the bridge" timer (mec:298-304).
4. Bridge `onTTS` → `onDecks` (br:151) → `checkDeck` per colour (br:111). A good deck is stored in `readyDecks[color]`. Each colour gets a chat line: ready, or not ready with reasons.
5. Bridge sends `deckReport { request, ready }`. Global increments `readyRequest`, which cancels the timer (mec:345-346).

### Flow: `mtg start [ai N]`
1. Host types `mtg start ai 1`. `engineChat` sends `start { seats, bots, requireReady = true }` (mec:207-212).
2. `startGame` (br:266) checks that there is no game yet, that every seat is in `readyDecks`, and that there are 2–4 players. It creates `game` (with `fromTable = true`) and one `Seat` per colour.
3. Each Seat opens a WebSocket: `Authenticate` → `AuthResult` → `ListRooms` → `RoomList` → `JoinRoom` (br:189-215).
4. `RoomUpdate` → `onRoomUpdate` (br:279): `SetDeckSelection` + `SetReady`. Once every seat has joined, it requests the bots (`spawnBot`). Once enough players are ready, it sends `StartGame`.
5. `GameStarted` → `onGameStarted` (br:306) maps slots to colours and sends `started`.
6. `engineStarted` (er:341) sweeps old engine cards, stashes the imported decks under the table, and turns engine mode on.

### Flow: a table update
1. Relay `StateUpdate` → `Seat.onEnvelope` (br:236). `state` replaces the board; `stateDelta` is applied with `sd.apply` if `env.base` equals the stored fingerprint, otherwise the seat sends `RequestResync`.
2. `scheduleView` (br:478) → `scheduleTable` (br:382), which waits 15 ms to merge bursts → `sendTable` (br:425).
3. `sendTable` builds the whole-table model. Public zones come from the first seat's view. Each hand comes only from its own seat's view; AI hands are counts only.
4. `onExternalMessage` → `engineRender` (er:227): place/move/spawn cards, keep the decks in sync, destroy cards that left, update trackers and status lines.

### Flow: a prompt and its answer
1. `prompt` envelope → `onPrompt` (br:572). It either answers automatically, or builds `ui` + `toOutput` and sends `prompt`.
2. `engineOnPrompt` (er:596) stores it, sets pile/library choices, updates the panel and calls `enginePhase2Prompt` (glows and right-click menus).
3. Panel click (`onMtgSlot`/`onMtgConfirm`/`onMtgCancel`) or a phase-2 gesture → `pick`/`confirm` → `engineAnswer` → `answer`.
4. `onAnswer` (br:841) runs `toOutput`, sends the engine `response`, and closes the panel with `prompt { promptId = null }`.

### Flow: drag gesture → intent
1. `onPlayerAction` (phase 2 wrapper er:900, then phase 1 er:657) only lets a player pick up their own hand, battlefield or command-zone engine cards.
2. `onObjectDrop` (er:683) waits 2 frames. `dropArea` decides where the card landed. Hand/command → battlefield sends `intent play`; hand → graveyard sends `discard`; hand → library sends `bottom`. A battlefield → battlefield move is cosmetic. Anything else snaps back.
3. `onIntent` (br:802) answers the open prompt, or calls `refuse` → `refused` → `engineRefused` (er:711) → re-render (snap back).

### Flow: phase 2 gestures (er:740-913)
- Q/E (rotate) on your own card while a "Pay …" prompt is open: picks that card's `tap:` mana action, or its `untap:` action to undo. After the last tap, the bridge finishes the payment itself (`tappedFor`). While "Declare attackers" is open: toggles that creature's first attack option.
- Click (select or pick up) while a target prompt is open: toggles that card's `card|<id>` option, or `player|<slot>` when clicking a life tracker. A prompt with a fixed target count is answered as soon as that many are chosen.
- Click during "Declare blockers": click your blocker, then the attacker.
- While "Your priority" is open, every card with an action gets a right-click menu entry that picks the action.

### Flow: library search
1. `onPrompt` `chooseCards` adds `librarySearch` when every card is outside what the seat can see (br:669-672).
2. `engineOnPrompt` stores `engineSearch[color]` and re-renders after 1 frame (er:604-609).
3. `engineLibraryDeck` (er:1000) rebuilds the library deck with key `search:N`: candidate cards first, then `libcard` fillers.
4. A candidate dragged out → library `onObjectLeaveContainer` (er:1059) → `intent choose` → `onIntent` → `chooseCardsDecision`. When the prompt closes, the plain library is rebuilt.
- Graveyard/exile picks use `pileChoices` → `engineChoosable` → pile `onObjectLeaveContainer` (er:1173).

### Flow: reload
1. TTS reruns Global. `ENGINE_MODE = false` (mec:162) and all renderer state is empty.
2. Load block (er:958-968), 30 frames later: restore the saved stash, sweep `engine:` objects, send `hello`.
3. Bridge `hello` (br:856): for a running table game it resends `started`, schedules a `table`, and replays each seat's last raw prompt.
4. `engineStarted` re-stashes the decks and turns engine mode on; `table` redraws everything.
- Undo/paste safety: `onObjectSpawn` (er:926) and `onObjectDestroy` (er:941).

---

## 2. Message protocol, Global ⇄ bridge

Bridge → TTS: one TCP connection per message to 39999, body `{"messageID":2,"customMessage":{t,json}}`; TTS calls Global `onExternalMessage`. TTS → bridge: `sendExternalMessage({t,json})` arrives on 39998 as `{"messageID":4,"customMessage":{t,json}}`. Both sides decode `json` and keep `t` (br:854, mec:334-338).

### TTS → bridge

| `t` | Fields | Sender | Bridge handler |
|---|---|---|---|
| `hello` | — | er:967 (load block); `tts/mtg-board.lua` `onLoad` | br:856 |
| `start` | `seats` (colours), `bots`, `requireReady` | `engineChat` mec:212 (`requireReady=true`); mtg-board (no `requireReady`) | `startGame` br:266 |
| `reset` | — | mec:215; mtg-board | br:870-874 |
| `decks` | `seats: {[color]: {deckName, library:[{n,f,b}], commander:[{n,f,b}]}}`, `request` | `engineSendDecks` mec:298 | `onDecks` br:151 |
| `deck` | `color`, `deck` (preset id or nil) | mtg-board only | br:875-878 |
| `answer` | `color`, `promptId`, `choice` (ids, `{"__cancel"}`, or `{number}`) | `engineAnswer` er:525; mtg-board | `onAnswer` br:841 |
| `intent` | `color`, `kind` (`play`/`discard`/`bottom`/`choose`), `id` | `request` er:680; er:1068; er:1184 | `onIntent` br:802 |
| `rewind` | `color`, `checkpointId` | `engineAskRewind` (Undo... list, `mtg undo N`) | `onRewind` |
| `rewindVote` | `color`, `accept` (bool) | `onMtgVote`, `mtg vote yes/no` | `onRewindVote` |
| `concede` | `color` | `mtg concede` (second time within 15 s) | `onConcede` |
| `winner` | `color` (the winner), `by` (the host's colour) | `mtg winner <colour>` (host only, checked in Lua) | `onWinner` |
| `fix` | `color`, `action` (`call` / `vote` + `accept` / `done` + `ops` / `cancel`) | Fix... button and panel (`onMtgFix`), `engineFixDone`, `mtg fix ...` | `onFix` (M7) |

### Bridge → TTS

| `t` | Fields | Sent at | Global handler |
|---|---|---|---|
| `chat` | `text`, `color` (null = everyone) | `chat` br:45 | mec:339-344 |
| `deckReport` | `request`, `ready` (colours) | br:156 | mec:345-346 |
| `started` | `colors` (slot→colour), `names` (slot→name), `ai` (AI colours) | br:318, br:860 | `engineStarted` |
| `table` | below | br:461 | `engineRender` |
| `prompt` | `color`, `promptId` (null = close), `title`, `text`, `mode` (`single`/`multi`/`number`), `options [{id, label, cardId?}]`, `min`, `max`, `cancel`, `pileChoices?`, `librarySearch?` | br:769; closes at br:610, 814, 828, 849 | `engineOnPrompt` |
| `refused` | `color`, `id` | br:777 | `engineRefused` |
| `log` | `text` | br:838 | grey `broadcastToAll` (mec:352) |
| `clear` | — | br:472 | `engineClear` |
| `view` | `color`, `view` | br:547 (only when `!game.fromTable`) | ignored by the table; used by mtg-board and the headless tests |

`table` (br:461-466): `turn`, `step`, `active` (colour), `activeTurnNo`, `priority` (colour), `gameOver`, `winner`, `rewind {points [{id, label}] (newest first, at most 12, only upkeep / main / attacks / second main), vote {id, to, by, waiting [colours], status (pending/approved/declined/unavailable), declinedBy} | null}` (M4.5), `stack [{id, n, tx, ctl, f}]`, `players [{color, slot, name, ai, life, status, poison, energy, cmdDamage{fromColour:n}, tax[], library, handCount, hand|null, battlefield[], graveyard[], exile[], command[]}]`. `slot` (the engine player id, e.g. `player-1`) was added for phase-2 player targeting (br:442).

Card model (`tableCard`, br:393): `id, n, f, b, tl, cmc, tx, ty, tap, fd, p, t, ctr, dmg, att, tok, sick, ctl`. A hidden card is `{id, fd:true}`.
With our Forge build (`mtg-forge-node:exile`, 2026-10-23) also `ew` (the card that exiled it), `rl` (it comes back when that card leaves), `fo` (foretold); each player row may carry `playable` (cards that seat may play from its exile or graveyard, from its own view) and the board `fix` (a manual fix under way: `{id, state, by, waiting, lines, message}`).

Option ids the Lua side parses (phase 2): `tap:<cardId>:<n>` (mana abilities, set by the engine; e.g. `tap:engine-card-36:0` in `tmp/dump.json`), `untap:…` (undo a tap; the prefix is assumed by er:804/836, not seen in a sample), `card|<id>` / `player|<slot>` (targets, br:648), `<attacker>|<target>` (br:685), `<blocker>|<attacker>` (br:698), and `cardId` on chooseAction/payManaCost options (br:614, 636).

Echo test only (plain tables, not `{t,json}`): TTS → `hello`, `ping{id}`, `results{ms}`; bridge → `pong{id}`.

---

## 3. bridge/bridge.js

Run: `node bridge/bridge.js [--relay URL] [--key K] [--room NAME] [--tts-in 39998] [--tts-out 39999] [--debug-port 48787]`. Every option can also come from env `MTG_<NAME uppercased>`. `MTG_TRACE` logs each TTS message.

### Module state

| Name | Line | Meaning / writers |
|---|---|---|
| `net, fs, path, execFile, delta` | 5-9 | requires |
| `RELAY, KEY, ROOM` | 15-17 | relay URL, server key, room name |
| `CLIENT_VERSION` | 18 | `"3.56.0"` (≥ 3.17.0 means patches) |
| `TTS_IN, TTS_OUT` | 19-20 | listen port, TTS port |
| `PRESETS, COMPOSE, DEFAULT_DECKS` | 21-23 | preset folder, compose file, 4 preset ids |
| `t0` | 25 | start time for `log` |
| `outbox` / `sending` | 29 / 30 | queue to TTS / pump busy. Written by `toTTS`, `pump` |
| `server` | 47 | TCP server for TTS |
| `game` | 72 | `null` or `{seats Map, bots, total, playerOrder, slotNames, slotColor, started, closing, fromTable, roomId, botsRequested, startSent, turnsTaken, lastTurnSeen}`. Set by `startGame`, cleared by `resetGame` |
| `deckChoice` | 73 | colour → preset id. Written by `onTTS` `deck` |
| `forgeCards` | 96 | lazy Forge name index |
| `BASICS` | 106 | basic land names |
| `readyDecks` | 108 | colour → `{deckName, cards, commanders, images}`. Written by `checkDeck`. Never cleared by `resetGame` |
| `TABLE_COLORS` | 327 | `White, Red, Yellow, Blue` |
| `DEFAULT_BACK` | 328 | back image URL |
| `IMAGE_CACHE_FILE`, `imageCache` | 331-333 | disk cache; loaded at startup, errors ignored |
| `imageWanted`, `imageFetching` | 334-335 | lookup queue, loop flag |
| `tableQueued` | 380 | `sendTable` timer pending |
| `pending` | 477 | seats with `sendView` pending |
| `GAME_LOG` | 832 | `bridge/game-log.txt` |
| `http, DEBUG_PORT, CONSOLE_LOG, consoleLines, execSeq, execWaiters` | 895-900 | debug channel |

Seat fields: `color, deckId, username, slot, board{state,fingerprint}, prompt{promptId,type,toOutput,input,sentAt,picks}, joined, ready, ws, roomId, lastRawPrompt, autoPayCard, autoPayFailedFor, tappedFor, endTurnAt, prevHand`. `tappedFor` (br:624, 643) = the card being paid for after the player chose a `tap:` action by hand.

### Functions

#### `arg(name, def)` — br:11
- Returns the value after `--name`, else env `MTG_${name.toUpperCase()}`, else `def`.
- Branch: `i > 0` (index 0 can't be a flag).
- Called at module init (15-20, 896).
- Bug?: the env names for `tts-in`/`tts-out`/`debug-port` contain hyphens (`MTG_TTS-IN`), which most shells can't set.

#### `log(...a)` — br:26
- Console log with seconds since `t0`. No return.

#### `toTTS(customMessage)` — br:33
- Pushes `{t, json: JSON.stringify(customMessage)}` onto `outbox`. If `!sending`, calls `pump()`.
- Reads/writes `outbox`, `sending`. Called by everything that talks to TTS.

#### `pump()` — br:37
- Shifts one message. If none: `sending = false` and returns.
- Else `sending = true`; opens TCP to `TTS_OUT`, writes `{messageID:2, customMessage}` and ends. On `close`, calls `pump` again (one message at a time, in order). On `error` with `ECONNREFUSED`, logs "TTS not reachable".
- Notes: a message that fails to send is dropped; the queue moves on because `close` follows `error`. If TTS is down, every message logs one line.

#### `chat(text, color)` — br:45
- `toTTS({t:"chat", text, color: color || null})`.

#### TCP server handler — br:47-64
- Collects chunks. On `end`: trims, returns if empty; `JSON.parse` (on failure logs the size plus first/last characters and returns). `messageID === 4 && customMessage` → optional trace log → `onTTS(customMessage)`. Anything else → `onTTSDebug(msg)`. Socket errors are ignored.
- `server.on("error")` (br:65): `EADDRINUSE` prints a port hint; any error exits the process with code 1.

#### `loadPreset(id)` — br:75
- Reads `PRESETS/<id>.json` (throws if missing). `toCard` maps an entry to the engine's card shape with set code and number. The first entry named `p.commander` becomes the commander (one copy); other entries are repeated `count` times.
- Returns `{deckName: p.label, deck: {name, cards, sideboard: [], format, commanders?}, commanderName}`.
- Called by `onRoomUpdate` (seat fallback at br:283, bots at br:292).
- Note: if the commander entry has `count > 1`, the extra copies are dropped.

#### `forgeIndex()` — br:97
- Lazy-loads `forge-cards.json`.index into `forgeCards`. On error: `{}` and a log line (every name then counts as unknown).
- Called by `checkDeck`.

#### `normName(s)` — br:104
- NFKD; strips combining accents (U+0300–036F); curly quotes and backtick → `'`; collapses spaces; trims; lowercases. Same as `build-forge-card-index.js:20`.

#### `asList(x)` — br:109
- Array → itself; object → `Object.values`; else `[]`. Covers Lua arrays that arrive as objects.

#### `checkDeck(color, entry)` — br:111
- Params: `entry = {deckName, library, commander}` from the table.
- `resolve(c)` (117): looks up `index[normName(c.n)]`. Unknown → pushes `c.n` onto `unknown` and returns null. Otherwise stores the first image seen for that name in `images[name]` and returns the engine name.
- Resolves commanders, then library cards. Removes one library copy of each commander (125). Counts duplicates other than basics → `extras`. `total` = cards + commanders.
- Problems (each makes the deck not ready): empty library (132); no commander (133); unknown cards, first 8 listed (134).
- Warnings: total ≠ 100 when a library exists (136); extra copies, first 5 (137).
- With problems: deletes `readyDecks[color]`, chats "not ready" with the list, returns false. Without: sets `readyDecks[color]`, chats "ready …", logs, returns true.
- Called by `onDecks`.
- Note: duplicates of the commander beyond one remain in the library and are only flagged as extra copies.

#### `onDecks(m)` — br:151
- `seats` = `m.seats` if it is an object. Runs `checkDeck` per colour and collects the ready ones in `ok`. If more than one colour, adds a summary chat. Always sends `deckReport {request: m.request, ready: ok}`.
- Called by `onTTS` `decks`.

#### `engineDeckFromTable(r)` — br:161
- Names-only cards (`setCode ""`, `cardNumber ""`). Returns `{deckName, deck{..., commanders}, commanderName: first commander or null}`.
- Called by `onRoomUpdate`.

#### `listCommanderPresets()` — br:170
- Preset files other than `index.json` whose JSON has `format === "commander"`. A file that fails to parse is skipped. If the folder can't be read, returns `DEFAULT_DECKS`.
- Called by `onTTS` `deck`.

#### `class Seat` — br:178

##### `constructor(color, deckId)` — br:179
- Sets fields; username `tts-<color>-<4 random chars>`. Opens `new WebSocket(RELAY)`.
- `open` → sends `Authenticate {username, password: KEY, service: false, client_platform, engine_gate, client_version}`.
- `message` → `onRelay(JSON.parse(text))`.
- `close` → if a game exists and isn't closing: log and chat "<color> lost the engine connection".
- `error` → ignored.
- Comment at 185 says `{promptId, ui, toOutput}`; the real shape is set at br:768.
- `ready` (187) is never used.
- Bug?: a `JSON.parse` throw inside the listener is not caught.

##### `send(msg)` — br:197
- Sends JSON only when `readyState === 1` (open). Otherwise the message is silently dropped.

##### `respond(promptId, type, output)` — br:198
- Sends `BroadcastState {state: {kind: "response", fromPlayer: slot, promptId: promptId ?? 0, action: {type, output}}}`.

##### `onRelay(msg)` — br:201
- `AuthResult`: on failure chats and returns; on success sends `ListRooms`.
- `RoomList`: ignored if `roomId` is already set. Finds the room named `ROOM`. Not found → chat. Status not `Lobby` → chat "busy". Otherwise sets `this.roomId` and `game.roomId` and sends `JoinRoom {observe: false, as_bot: false}`.
- `RoomUpdate` for our room → `onRoomUpdate(this, room)`.
- `GameStarted` → `slot = player-<index of username>` → `onGameStarted(msg)`.
- `StateUpdate` → `onEnvelope(msg.state)`.
- `Error` → log; chat unless the code is `NotHost`.
- `GameAborted` → chat.
- Bug?: `game.roomId` (213) and `onRoomUpdate` read `game`. After a reset `game` is null, and a late relay message would throw.
- Note: "Room not found" or "busy" is chatted once per seat.

##### `onEnvelope(env)` — br:236
- Returns if there is no `env` or no `slot` yet. `forUs = env.forPlayer === slot`.
- `state`: accepted when it is for us, or when we have no board and the state is unaddressed → `board = {state, fingerprint}` → `scheduleView`.
- `stateDelta`: only for us. No board, or `fingerprint !== env.base` → `RequestResync`. Else `board = {apply(state, patch), env.fingerprint}` → `scheduleView`. The result is not re-hashed here (engine-test.js does that).
- `prompt` for our slot → `onPrompt(this, env.prompt)`.
- `error` for us → log + chat "Engine rejected that answer".
- `log` → only the first seat calls `onGameLog(env.entry)`. Reads `game` without a null check.
- `fatal` → chat.

##### `close()` — br:263
- Sends `LeaveRoom` and closes the socket; any throw is swallowed.

#### `startGame(seatList, bots, requireReady = false)` — br:266
- Early returns, each with a chat line: a game already exists (267); `requireReady` and some colour is not in `readyDecks` (268-269); no seats (271); total outside 2–4 (272).
- Sets `game` with `fromTable: requireReady`. Creates one Seat per colour with deck `deckChoice[color]` or `DEFAULT_DECKS[i % 4]`. Chats "Setting up…" and logs.
- Called by `onTTS` `start`.

#### `onRoomUpdate(seat, room)` — br:279
- If this seat appears in `room.players` and hasn't joined yet: `joined = true`. The deck is `engineDeckFromTable(readyDecks[color])` if one exists, else `loadPreset(deckId)`. Sends `SetDeckSelection`, `SetReady`; chats "<color> joined with <deck>".
- Once (`botsRequested`), when `bots > 0` and all seats have joined: bot decks = `DEFAULT_DECKS` minus the seats' `deckId`s, first `bots`. Prefetches their images (`cachedImage` per card). Seat 0 sends `BroadcastState roomRelay` `spawnBot {deck: first, decks, forgeAi: true}` with `roomId: seat.roomId`.
- Once (`startSent`), when the room is in `Lobby` and ready+connected players ≥ `game.total`: seat 0 sends `StartGame {format: "Commander"}`.
- Note: `used` contains the human seats' default `deckId` even when they play their own table deck, so those presets are never given to bots. With 4 presets and at most 3 bots there is always enough.

#### `onGameStarted(msg)` — br:306
- Runs once (`game.started`). Stores `playerOrder`. `freeColors` = table colours without a human seat. Per slot: a human → their colour as name and colour; otherwise `AI n` and the next free colour (or null when none are left).
- Sends `started {colors, names, ai}`. `ai` = slots whose name isn't a table colour. Chats the turn order and starting life; logs.
- Bug?: an AI with a null colour is never drawn (`engineRender` skips players without geometry). A human on a non-table colour would be listed in `ai`.

#### `stripQuery(u)` — br:336
- Removes `?…` from a URL. Never called.

#### `cachedImage(name)` — br:338
- Returns `imageCache[normName(name)]` if present, including the `{face:null}` stored for not-found names. Otherwise, if a name was given, adds it to `imageWanted`, schedules `fetchImages` with `setImmediate`, and returns null.
- Callers: `tableCard`, `sendTable` (stack), `onRoomUpdate`.

#### `fetchImages()` — br:345 (async)
- Returns if already running or nothing is wanted. Loop: takes up to 75 names, POSTs Scryfall `/cards/collection`. HTTP error → log and `break` (the rest stay queued). For each card: face URL `img.klrmngr.com/large/front/<id0>/<id1>/<id>.jpg`; back URL only when the second face has its own `image_uris`. Stores under the card name and the first face name. `not_found` names get `{face:null, back:null}`. Writes the cache file asynchronously and waits 120 ms between requests.
- Exceptions are logged. Finally `imageFetching = false` and `scheduleTable()`.

#### `scheduleTable()` — br:382
- If none is pending: `tableQueued = true` and a 15 ms timer → `sendTable()`.
- Callers: `scheduleView`, `fetchImages`, `hello`.

#### `imagesFor(name)` — br:388
- The first ready deck holding images for that engine name, else null.

#### `tableCard(c)` — br:393
- Hidden (no card, `visibility === "hidden"`, or no identity) → `{id, fd: true}`.
- Otherwise builds the card model. Face: table image, then cached Scryfall image, then null. Back: table image, then `DEFAULT_BACK`. Type line "Super Types — Subtypes". Counters with value 0 are dropped. `ctl` = controller colour.
- Reads `game.slotColor`. May queue an image lookup.

#### `trackTurns(pub, seats)` — br:408
- Initialises `game.turnsTaken`. When `pub.turn` changes and there is an active player, increments that player's own turn count.
- For each human seat: compares hand ids with `prevHand`. 1–3 new named cards → chat "Into your hand: …" to that colour. Stores `prevHand`.
- Note: cards bounced back to the hand are also reported. The opening hand (7 cards) is not.

#### `sendTable()` — br:425
- Returns unless the game has started and at least one seat has a board. `pub` = first such seat's `gameView`. Calls `trackTurns`.
- Per engine player: `own` = that player's own view, if it is a human seat. `cmdDamage` is summed per attacking colour via the commander card's `ownerId`. `tax` = 2 × casts, in `commanderCasts` value order. `hand` comes only from `own`, else null. Other zones come from `pub`.
- Stack entries: `{id, n, tx, ctl, f}`.
- Sends `table`. `activeTurnNo` falls back to 1.
- Bug?: `tax` follows the object order of `commanderCasts`, which may not match the order of the cards in the command zone (the Lua side pairs tax `i` with label `i`).

#### `resetGame(reason)` — br:469
- If a game exists: `closing = true` and every seat `close()`s. Then `game = null`, sends `clear`, chats the reason.
- Leaves `readyDecks`, `deckChoice` and the image cache untouched.

#### `scheduleView(seat)` — br:478
- Always `scheduleTable()`. Once per tick per seat: `setImmediate(sendView)`.

#### `cardLabel(c, onBattlefield = false)` — br:485
- `"?"` for no card; `"(face-down)"` for hidden. Otherwise the name plus P/T, counters, damage, and "(sick)" for summoning-sick creatures on the battlefield.

#### `cardIndex(gv)` — br:497
- id → card over every zone of a view.

#### `displayText(text)` — br:504
- Without a game or text, returns the input. Replaces every case-insensitive occurrence of a relay username with `nameOf(player-i)` in one pass, the longest name first (the second AI's "<node>-bot 2" holds the first's "<node>-bot"; name by name it read "AI 1 2", keyword sweep kw-15). The pattern is built once per player list and kept on `game.nameMatch`, rebuilt when `game.playerOrder` changes.

#### `nameOf(slot)` — br:520
- `game.slotNames[slot]`, else the slot itself.

#### `sendView(seat)` — br:522
- Returns at once for table games (`fromTable`) or when there is no view. Otherwise builds the M3 text view: per player name, you, life, status, poison, zone counts, command labels, commander-damage lines, permanents with "(T) ", land summary, active, priority; the stack as text; your hand labels. Sends `view`.

#### `summarizeLands(lands)` — br:558
- Groups lands by name as "Name untapped/total".

#### `onPrompt(seat, prompt)` — br:572
- Writes `seat.lastRawPrompt`. A priority-kind prompt → respond `chooseAction pass` with promptId 0, return.
- Locals: `input`, `type`, `gv`, `byId`, `cname(id)` (card name, or player name for `player-*`, or the id), `baseText` (source card + ability text), `title` (`presentation.title` or the type). Any type other than `payManaCost` clears `autoPayFailedFor`. `opts` turns options into `{id, label}` with index ids.
- Per type:
  - `mulligan`: single Keep/Mulligan → `mulliganDecision {keep}`. With `friendlyExtra()` above 0 (the shared count minus the rules' multiplayer free one) the answer also carries `freeCards`, the Mulligan button reads "Mulligan (free)" while `friendlyFreeLeft(seat)` is above 0, and the text comes from `friendlyText(seat)`.
  - `mulliganPutBack`: multi with min = max = `count` → `mulliganPutBackDecision {cardIds}`.
  - `chooseAction`: actions = not `undoMana` and not mana abilities. If `endTurnAt === gv.turn`: pass and return. Otherwise `endTurnAt = null`. No actions and not your own main phase: pass, close any open panel, return. Otherwise a single prompt "Your priority" with `__pass`, `__endturn`, then each action `{id, cardId, label}`. `toOutput`: pass / set `endTurnAt` and pass / `act {actionId}`.
  - `payManaCost`: four seat fields, kept apart on purpose: `autoPayCard` (Forge's auto-pay asked for this card), `tappedFor` (a source tapped by hand for it), `autoPayFailedFor` (auto-pay already failed for it), `smartPay` (our own auto-pay under way: `{ card, sent }`, the card and the taps already sent).
    - Finish by itself: when `autoPayCard`, `smartPay.card` or `tappedFor` is this card (or the player just started this spell while mana floats), the pool covers the cost and no life can pay part of it → clear them, `pay {auto: false}`. As on Arena.
    - Our auto-pay (`smartPayTap(owed, actions, otherHandCards, byId)`), only for a payment that names its card (`input.cardId`): `__auto` plans the whole cost from plain `{T}` sources making one mana each and sends the first tap; each next question for that card sends the next planned tap. A tap already in `smartPay.sent` that is offered again was not taken: then Forge's own auto-pay (`pay {auto: true}`) does the rest, never the same tap twice. A cost with hybrid, X or Phyrexian symbols, or one that can't be planned, goes to Forge's auto-pay at once.
    - The plan: each coloured symbol from a source of that colour, the scarcest colour first; then the generic part. Among sources, the one the rest of the hand needs least goes first (a creature counts half a card more); a tie: a painless ability before one that deals damage to you (a pain land's coloured ability pays last), then the card making fewer colours (a basic before a dual land, colours read over all its actions).
    - `smartPay` is cleared by any other question, when the payment ends, and on a rewind (`checkRestored`).
    - Options: `__pool` when payable from the pool, else `__auto` unless auto-pay already failed; every engine action `{id, cardId, label}`; `__cancel`. `toOutput`: `__auto` → our first tap (sets `smartPay`) or `pay {auto: true}` (sets `autoPayCard`); `__pool` → `pay {auto: false}`; `__cancel` → `cancel`; else `act {actionId}`, and `tappedFor` = this card when the id starts `tap:`, else null.
  - `chooseBoardTargets`: multi with min/max targets, `cancel` if cancellable; ids `kind|id`. → `boardTargets {chosen: [{kind, id}]}`, or `cancel` when the first pick is `__cancel`.
  - `chooseBoolean`: Yes/No (engine labels) → `decision {value}`.
  - `chooseCards`: multi min/max → `chooseCardsDecision`. Adds `pileChoices` when every card is in a graveyard/exile zone, and `librarySearch` (card models) when no card is visible to the seat; each sets a hint text.
  - `chooseNumber`: number mode → `numberDecision`.
  - `chooseFromSelection`: multi by index → `selectionDecision {chosenIndices}`.
    - A choice of players and permanents that is no target (Forge's `chooseSingleEntityForEffect` over a mixed list, which the harness's `chooseSingleEntityGeneric` asks as labels: a player by its engine name, a card as `CardView.toString` "<name> (<Forge's number>)", titled only by the card's name): `entityChoiceIds(options, gv)` maps each label to `player|player-<n>` (`game.playerOrder`, any case) or `card|<id>` (when the one card of that name the board shows, in any zone or on the stack, is a face-up battlefield permanent), with a card among them, else null. Mapped → `kind: "target"`, title "<card>: choose which player or permanent?" ("planeswalker" when every card is one; "attack which player or planeswalker?" when the ability's text says "attacking": a creature put onto the battlefield attacking, CR 506.3b), the answer back as the options' numbers. Two cards of one name (a second one in a graveyard too), or an unknown label: the list as before (item 24, 2026-11-11).
  - `chooseAttackers`: one option per attacker×target, plus `attacker|?` ("→ whom? (asked next)") first for a creature with more than one target (item 25). Min 0. `keepOrder`: A-Z by creature, each creature's `?` before its targets (the table's click takes a creature's first option). `toOutput`: must-attack creatures at their first target when the answer is only No attacks (and End turn), else at `?` when they have several; All attack adds every other creature (`?` or its one target); then the picks (a picked target wins over `?`). Creatures left at `?` go to `attackWhom`; then `declare` checks All attack against `attackRefusalReason` (stop and re-ask) and sets `seat.lastAttack`. `text`: the refusal and Must attack line, then `attackReminder`'s lines; `note`: the refusal, else the reminder's note; `cantAttack` for the table's Q/E.
  - `attackRules(gv)`: the battlefield's attack rules from their text (reminder text stripped, face-down cards skipped): `limits` (Silent Arbiter, Crawlspace, The Eternal Wanderer, Mirri while tapped), `taxes` (Propaganda's "{2} for each creature attacking you", `pw` for "or planeswalkers you control", Archangel of Tithes only while untapped, `{X}` worked out by `attackXWorked` for Sphere of Safety and Collective Restraint), `costs` (Brainwash on its creature, Qal Sisma Behemoth's own), `cants` (Blazing Archon at its controller, Moat's "without flying"), `others` (any other "can't attack ... unless" sentence, said as written), `limiters`, `ctlOf(card, zone)`. `attackTaxesAt(R, ctl, defenderId)`: the taxes on one defender (at a planeswalker only the "or planeswalkers" ones). Used by `attackRefusalReason` (part 1), `attackReminder` and `attackTaxWords`.
  - `attackReminder(gv, input, slot)` (attack reminder spec part 2): `lines` for the panel (taxes per defender summed by `attackCostSum`, planeswalkers' share; for a player who can't be attacked here but whose planeswalker can, only the taxes that cover planeswalkers; each creature's own price; other costs; "about N mana open" with the tap-first warning when anything costs; limits; "Can't attack: X (reason)" for the player's untapped creatures not offered, tokens grouped, reasons in Forge's order: phased out, summoning sick without haste, detained (`game.detained`, set in `logEvents` where a detain is said, dropped at the detaining player's next turn or when the card leaves the battlefield), defender, an enchanting aura, its own text, a `cants` rule, else "an effect on the table"; "Can't attack <defender>: X (goaded by ...)" / "No creature of yours can attack ..." for defenders missing from `validTargetIds`), `note` for the corner (taxes, else limits, plus the can't-attack list unless every reason is summoning sickness), `cantAttack` ({ cardId: sentence }) and `taxAt(defender)`. `defenderWords` names a planeswalker or battle with whose it is.
  - `attackWhom(o, each)` (item 25): one `next()` step "Attack whom with ...?" for every creature left at `?` (kind `choice`; options `player|<slot>` / `card|<id>`, so the table's target surface answers by a life counter or planeswalker click; each label with its tax; `__each` One by one; `__back` Back to the attack question; `onTimeout` the first target). A creature that can't attack the pick is asked again with the rest; `done(byAttacker)` once none is left.
  - Attack tax payment (in `payManaCost`): in `combatDeclareAttackers`, before priority comes back (`onPrompt` clears `seat.lastAttack` at any `chooseAction` or priority prompt, so a pump on an attacker or a later turn's ability is a plain payment), for a card in `seat.lastAttack` that `attackTaxWords` finds taxed: title "Propaganda (AI 1): pay {2} to attack with Grizzly Bears?", Cancel labelled "Don't attack with Grizzly Bears", note "Cancel: Grizzly Bears doesn't attack."
  - `chooseBlockers`: blocker×attacker options; `text` = `input.error`. One attacker per blocker (the last pick wins).
  - `scry`: keep zone = `libraryTop` if offered; move zone = the other one. The selected cards go to the move zone; the rest stay in the keep zone.
  - `chooseColor`: single per colour → `{[color]: amount}`. While paying (`seat.payingCost`, set by `payManaCost`, kept only through the colour question), the colours the cost asks for (`colorsNeeded`, hybrid halves too) come first, labelled "(needed)"; the title gets the source's name ("Command Tower: Choose a color").
  - `revealCards`: auto-acknowledged when the title starts "AI can't play"; otherwise OK with the card list.
  - `diceRolled`: OK with the roll text.
  - `reorder`, `chooseDamageAssignmentOrder`: answered automatically in the given order.
  - `chooseCombatDamageAssignment`: automatic. Each blocker gets lethal damage (1 with deathtouch, else toughness − damage, at least 1) in order. The last blocker takes the rest when there is no defender; leftover damage goes to the defender (or the first blocker).
  - `gameOver`: chat, return. Default: log + chat "Unsupported prompt", return (the prompt stays unanswered).
- After the switch (762-769): text and title go through `displayText`; option labels too (ids and `cardId` kept). `min`/`max` default to 1. Multi options are sorted A–Z by label unless the question sets `keepOrder`. Sets `seat.prompt` (with `picks: []`) and sends `prompt`.
- Callers: `onEnvelope`, `onTTS` `hello` replay.
- Bug?: `scry` with only one zone makes keep zone = move zone, so unselected cards are left out of the answer.
- Bug?: `tappedFor` is not cleared by `__auto`, `__pool` or `__cancel`. After a cancel, a later payment for the same card that can be paid from the pool is confirmed without asking.
- Bug?: `const autoFailed` (629) is declared directly in a `case` without braces. It works, but lint rules flag it.
- Note: `prompt.kind === "priority"` answers with promptId 0, not the prompt's id.

#### `refuse(seat, cardId, reason)` — br:775
- Chats the reason to the seat and sends `refused {color, id}`.

#### `cardNameIn(seat, cardId)` — br:780
- The card name in the seat's view, else "That card".

#### `whyNot(seat, cardId)` — br:784
- The first matching reason: not your priority; land on another player's turn; land already played (`landsPlayedThisTurn >= maxLandPlaysPerTurn || 1`); other land case → "main phase with an empty stack"; not instant/flash and not your main phase with an empty stack → "only at sorcery speed"; else a generic "can't be cast right now".

#### `onIntent(m)` — br:802
- Returns unless the seat exists and the game has started.
- `play`: refuses with `whyNot` unless a `chooseAction` prompt is open and it has a non-mana, non-undo action for this card. Picks the action whose `mode.type` is `normal`, else the first. Clears `seat.prompt`, closes the panel, responds `act`.
- `discard` (chooseCards), `bottom` (mulliganPutBack or chooseCards), `choose` (chooseCards): refuses if the open prompt type doesn't match, or if the card isn't allowed. Adds it to `p.picks` (no duplicates). Below `need` (count, or max(1, min)) → chat "n/N chosen" and return. Else responds with the first `need` picks and closes the panel.
- Notes: any `chooseCards` prompt accepts a discard drag, whatever the prompt is for. Drag picks are not shown in the panel's selection. The colour in the message isn't checked against the player; the Lua side does that.

#### `onGameLog(entry)` — br:833
- Ignores entries without a message. Appends `[HH:MM:SS] type: text` to `game-log.txt`. `action`/`stack` entries also go to TTS as `log`.

#### `onAnswer(color, promptId, choice)` — br:841
- Returns unless the seat has an open prompt with the same numeric id. Clears `seat.prompt`. Turns `choice` into an array (an object becomes its values; anything else is wrapped), stringifies each pick, runs `toOutput`, responds, and sends `prompt {color, promptId: null}`.

#### `onTTS(m)` — br:853
- Decodes `m.json` (logs and returns on bad JSON). Dispatch:
  - `hello`: log. For a started table game: resend `started`, `scheduleTable()`, and `onPrompt(seat, lastRawPrompt)` for every seat that has one. Chat "Bridge connected". `scheduleView` for every seat.
  - `start` → `startGame(asList(seats), Number(bots) || 0, !!requireReady)`.
  - `reset` → `resetGame(...)`, then `docker compose -f COMPOSE restart forge-room`; chat the result.
  - `deck`: a valid preset sets `deckChoice` (chat); otherwise lists the presets to that colour.
  - `decks` → `onDecks`. `intent` → `onIntent`. `answer` → `onAnswer`.
- Bug?: the `hello` replay re-runs the last raw prompt even if it was already answered. Automatic types (priority, reorder, damage order) would then send a second response with an old promptId, and an answered prompt reappears in the panel.

#### `onTTSDebug(msg)` — br:902
- `messageID 2` → "print: …"; `3` → "ERROR guid: …" (also logged to the console); `1` → "TTS: game loaded"; `5` → resolves the waiter with that `returnID` and returns. Other ids are ignored. Lines get a timestamp, go into `consoleLines` (max 500) and are appended to `tts-console.log`.

#### `execInTTS(script, timeoutMs = 8000)` — br:919
- New `returnID`. Promise: on timeout resolves `{timeout: true}`. The waiter resolves `{value}`. Sends `{messageID: 3, returnID, guid: "-1", script}` to TTS. A socket error resolves `{error}`.

#### Debug HTTP server — br:929-952
- `POST /exec`: reads the body as Lua; notes the console position; `execInTTS`; waits 150 ms; returns JSON `{value|timeout|error, console: [new lines]}`.
- `/state` (any method): `{started, seats: [{color, slot, turn, step, battlefield: [{owner, cards: ["Name(T)"]}], manaPool, rawPrompt}]}` or `seats: null`.
- `/log`: the last 500 console lines as plain text. Anything else: 404.
- Listens on 127.0.0.1 only; a listen error is logged, not fatal.
- Note: there is no authentication, so any local process can run Lua in the open game.

#### Startup and SIGINT — br:954-955
- Listens for TTS. The log line still says "Load tts/mtg-board.lua", which is out of date for the engine table.
- SIGINT: marks the game closing, closes the seats, exits after 200 ms.

### Relay link recovery (added 2026-10-20)

| Function / constant | Details |
|---|---|
| `RECONNECT_DELAYS`, `RECONNECT_GIVE_UP_MS`, `PING_EVERY_MS`, `SILENT_DEAD_MS` | retry after 1, 2, 4, 8, 8... s; give up 55 s after the drop (the last try starts by ~63 s; the relay forfeits a seat at reconnect_timeout_s + 5 = 65 s); a Ping every 20 s; nothing heard for 45 s = a dead link |
| `Seat.connect()` | opens a relay socket; on open logs in (same username) and starts the heartbeat; events of a replaced or dead socket are ignored |
| `Seat.heartbeat(ws)` | Ping every 20 s; if nothing at all was heard for 45 s the socket is marked dead, closed and treated as dropped |
| `Seat.onClosed()` | after `mtg reset` (`closed`) or for a seat no longer in the game: nothing. Before the game starts: chat "type mtg reset, then mtg start". Mid-game: chat once, retry with backoff, give up after `RECONNECT_GIVE_UP_MS` with a chat line |
| `AuthResult` while reconnecting | refused → close and retry; kept session (`reconnected:true`) → `RequestResync`; relay restarted (`reconnected:false`) → `JoinRoom` (retakes the disconnected seat) + `RequestResync`, and a `room_not_found` / `not_in_room` / `game_not_in_progress` refusal is retried every 2 s (one retry at a time, `rejoinPending`) until a `StateUpdate` arrives or the window ends |
| `Seat.send` (changed) | while the link is down a `BroadcastState` is logged as "not sent"; the engine asks the open question again after the resync |
| `Seat.close()` (changed) | sets `closed` and stops the heartbeat, reconnect and rejoin timers |

Tested: golden cases "reconnect: ..." (drop and resync, relay restart, backoff and give-up, refused login, silent link, reset); live: `docker compose restart relay` mid-game in a headless game (tools/headless-coverage.sh): the seat was back in 3 s ("seat retaken") and the game went on to its last turn with 0 errors.

### Rewind by vote and conceding (M4.5, M4.6; added 2026-10-20)

| Function | Details |
|---|---|
| `Seat.directive(d)` | sends `{kind: "directive", fromPlayer: slot, directive: d}` to the relay (engine-interface-reference §6) |
| `leadSeat()` | the first seat: its view stands for the table (game log, public board, one-time announcements) |
| `isPlaying(gv, slot)` | that player's `status === "playing"` (not lost, not conceded) |
| `REWIND_STEPS` | the steps offered as restore points, with their names: upkeep, main phase, attacks, second main phase |
| `checkpointLabel(c)` | "turn 10, Blue's upkeep" |
| `rewindState(gv)` | `{points, vote}` for the table: the last 12 offered checkpoints newest first; the vote with colours (status defaults to pending) |
| `rewindNews(pub)` | `rewindState` plus one chat line per vote change (pending → who asks and who must vote; declined; unavailable), keyed by `voteId|status` in `game.lastVoteKey` |
| `onRewind(color, checkpointId)` | refuses: no game / not a player, a point no longer kept (ids compared as strings), an open vote, a player who is out; else `requestRestore` |
| `onRewindVote(color, accept)` | refuses: no pending vote, a vote not awaiting this seat; else `restoreVote {voteId, accept: !!accept}` |
| `checkRestored(seat)` | on every state/stateDelta: a rewind is detected when the turn number goes down or the newest checkpoint id goes down (a restore drops the later points; `rules-check --game rewind` checks it). Then the seat's open question is closed (an answer to it crashed Forge), and the lead seat announces it and resends every zone. The step going back is not used: extra combat phases do that |
| `onConcede(color)` | a playing seat sends the `concede` directive and it is announced; others are refused |
| `onWinner(color, by)` | every other playing human seat concedes; AI seats can't be conceded (named in chat, with "mtg reset"); a colour not in the game is refused |
| `trackTurns` (changed) | `game.turnOwners[turn] = active`; turns above the current one are forgotten, so after a rewind "your turn N" goes back; `turnsTaken` is derived from it |

### bridge/presets.js (added 2026-10-20)

| Function | Details |
|---|---|
| `presetFile(id)` | `decks/<id>.json` if it exists, else `manabrew/public/preset_decks/<id>.json`; a missing id gives the `decks/` path (reading it fails with ENOENT) |
| `readPreset(id)` | parsed JSON of `presetFile(id)` |
| `presetIds()` | every id in both folders, once each, sorted; `index.json` skipped |

Used by `bridge.js` (`loadPreset`, `listCommanderPresets`), `engine-test.js`, `priority-check.js`, `rules-check.js`, `test-mtg-ready.js`, `tools/make-test-deck-lua.js`. Checked by `tests/test_bridge_claims.js` (an id in both folders reads ours and is listed once).

### bridge/state-delta.js

| Function | Line | Details |
|---|---|---|
| constants | 12-15 | `$v` literal, `$k` keyed changes, `$d` removed, `$o` order |
| `isObject(v)` | 17 | non-null, non-array object |
| `elementKey(value)` | 19 | string `id`, else `zone/ownerId`, else null |
| `apply(previous, patch)` | 26 | Non-object → returns `patch`. `$v` → returns the literal. `$k` or `$o` → `applyKeyed`. Else a merge: copies `previous` (or `{}`), deletes the `$d` keys, applies each other field recursively (missing key → `apply(null, inner)`). Returns new objects; `previous` is not mutated |
| `applyKeyed(previous, patch)` | 39 | Builds key → element and the order list from `previous` (no key → `""`). Removes `$d` keys. For `$k`: patches existing elements, adds new ones at the end. `$o` replaces the order (strings only). Returns the elements in order, skipping missing keys. Bug?: several keyless elements all map to `""` and collapse into one |
| `canonical(value)` | 63 | JSON with sorted keys, recursive |
| `fingerprint(state)` | 69 | FNV-1a 64-bit over UTF-8 `canonical`, as two 32-bit halves (prime 2^40 + 0x1b3). Returns 16 hex chars |
| exports | 84 | `apply`, `fingerprint` |

---

## 4. Global Lua

The engine copy's Global is: the table's patched Global, then the ENGINE MODE block (mec:158-363), then `engine-renderer.lua` (appended at mec:366). Later definitions with the same name replace earlier ones; the wrappers capture the earlier function first.

### 4.1 TTS events and wrapped handlers

| Event | Final definition | Chain (first called → last) | Behaviour |
|---|---|---|---|
| `onChat(message, pl)` | table Global (original line 2156) | the inserted hook runs first | `engineChat` (if it returns non-nil, return it); then `if ENGINE_MODE then return end`, which skips all of the table's own chat handling |
| `onExternalMessage(m)` | mec:332 | new (the table has none) | dispatch §2 |
| `onPlayerAction(player, action, targets)` | er:900 (phase 2) | er:900 → `phase1PlayerAction` = er:657 | phase 2 gestures, then the own-area rule |
| `onObjectDrop(color, obj)` | er:683 | new | drag → intent |
| `onObjectEnterContainer(container, obj)` | er:722 | er:722 → table's own (original Global 1861, cascade tracking and unhide) | breaks up engine-card decks |
| `onObjectLeaveContainer(container, obj)` | er:1173 | pile er:1173 → library er:1059 → enabler bag mec:357 | picks and snap-backs |
| `tryObjectEnterContainer(container, obj)` | er:1200 | er:1200 → earlier one (none in the table) → `true` | engine decks refuse physics merges |
| `onObjectSpawn(obj)` | er:926 | → `tableObjectSpawn` (the table's is commented out at original line 995, so nil) | undo/paste copies are removed |
| `onObjectDestroy(obj)` | er:941 | → `tableObjectDestroy` (nil) | redraw after an engine card is destroyed |
| `onSave()` | er:950 | new | saves the stash |
| load | er:958 top-level `Wait.frames(…, 30)` | — (the table Global has no `onLoad`) | restore, sweep, `hello` |
| UI callbacks | er:568-594 | new | panel |

Table globals used: `data[color]` (`playmat`, `libraryZone`, `graveyard`), `getDeckFromZone`, `hoveredObjs` (set by the table's `onObjectHover`, original lines 392-395), `Turns`.

### 4.2 Chat commands (`engineChat`, mec:184)

| Command | Who | Action |
|---|---|---|
| `mtg engine on`/`off` | anyone, seated or not (off is refused while a game runs) | `setEngineMode(true/false)` |
| `mtg engine` (anything else) | same | shows the current mode |
| `mtg ready` | anyone | `engineSendDecks({own colour}, own colour)` |
| `mtg friendly 0\|1\|2` | anyone | `engineSetFriendly(n, pl)`: the one shared count in `engineFriendly`, told to everyone; the `start` message's `friendly` |
| `mtg ready all` | host | all seated colours that have `data[c]` |
| `mtg commander` | anyone | `engineMarkCommander(pl)` |
| `mtg start [ai N]` / `mtg start N` | anyone, seated or not | `engineSend("start", {seats, bots: first number in the rest, requireReady: true})` |
| `mtg reset` | anyone once the game is over; host mid-game | `engineSend("reset", {})` |
| `mtg undo` / `mtg undo N` | anyone | lists `engineRewind.points` / `engineAskRewind(colour, N)` (M4.5) |
| `mtg vote yes` / `mtg vote no` | anyone (the bridge checks the vote awaits them) | `engineSend("rewindVote", {color, accept})` |
| `mtg concede` | anyone | first time: asks to confirm; again within 15 s (`engineConcedeAsk`, `os.clock`): `engineSend("concede", {color})` (M4.6) |
| `mtg winner <colour>` | host, admin or promoted | `engineSend("winner", {color, by})`; unknown colours refused |
| `mtg`, `mtg help`, any other | anyone | help text via `pl.broadcast` |

Every handled line returns `false`, which hides it from chat. A non-`mtg` line returns nil. Matching is case-insensitive (`lower`), and `mtg` must be followed by a non-letter or the end (`%f[%A]`).

### 4.3 ENGINE MODE block (make-engine-copy.js)

#### Inserted `onChat` hook — mec:154-157
- Inserted as the first lines of the table's `onChat`, before that function lowercases and strips punctuation from `message`. `engineChat` therefore sees the raw text.
- If `ENGINE_MODE` is on, it returns nil, so the table's turn and other chat commands don't run while the message still shows.

#### `ENGINE_MODE` — mec:162 (global)
- `false` on every load. Written only by `setEngineMode`. Read by the guards, the hook and every renderer handler.

#### `engineBlockedAt` — mec:163 (local)
- Tool name → `os.clock()` of the last message.

#### `engineBlocked(what)` — mec:166
- If the same tool was reported within 3 s, returns. Otherwise records the time and calls `broadcastToAll("[MTG] Engine mode is on: '<what>' is handled by the rules engine.", orange)`.
- Called by Global guards directly and by object guards through `Global.call('engineBlocked', label)`.

#### `setEngineMode(on)` — mec:173
- Sets `ENGINE_MODE` to a boolean and `Turns.pass_turns = not ENGINE_MODE`. Broadcasts ON (green) or OFF (white).
- Called by `engineChat`, `engineStarted` (er:350), `engineClear` (er:338).

#### `engineChat(message, pl)` — mec:184
- Returns nil unless the message starts with `mtg`. Parses `cmd` (letters) and `rest`. `isHost = pl.host or pl.admin or pl.promoted`. Branches are listed in §4.2. Non-host attempts get a `pl.broadcast` refusal. Returns false.

#### `COMMAND_ZONES` — mec:223 (local)
- Colour → the two tax-label GUIDs. Same values as er `TAX_LABELS` (duplicated).

#### `commanderPick` — mec:224 (local)
- Colour → `{[guid] = true}`. Never cleared except by toggling.

#### `readyRequest` — mec:225 (local)
- Incremented when a request is sent and again when its report arrives.

#### `cardName(nick)` — mec:227
- First line of a nickname with trailing spaces removed.

#### `cardInfo(d, deckImages)` — mec:234
- `d` is object data. Takes the first `CustomDeck` entry's Face/BackURL. If there is none and `deckImages` + `CardID` are given, looks up `deckImages[floor(CardID/100)]` (number or string key). Returns `{n = cardName(Nickname), f, b}`.

#### `isIdentity(o)` — mec:247
- True when the name contains "Identity" (Treachery roles).

#### `handCards(color)` — mec:250
- Hand objects that are cards, not identity cards, and not engine cards.

#### `commandersFor(color)` — mec:258
- If cards were marked with `mtg commander` and still exist, returns their `cardInfo`. Otherwise returns every non-identity card within 2.5 units (squared distance < 6.25) of either command-zone label.
- Bug?: the proximity scan doesn't exclude `engine:` cards, so `mtg ready` during a game would also read the engine's command-zone cards.

#### `engineSendDecks(colors, requester)` — mec:282
- Per colour: `entry = {library = {}, commander = commandersFor(color), deckName = ""}`. If `getDeckFromZone(libraryZone)` returns a deck: `deckName` = its name, and each contained card is added with the deck's `CustomDeck` images. Then imported hand cards are added. Sends `decks {seats, request}`. Tells the requester "Checking deck(s)…". After 4 s, if `readyRequest` is unchanged, warns "No answer from the bridge".
- Note: a single loose card in the library zone (not a deck) is not read unless `getDeckFromZone` returns it.

#### `engineMarkCommander(pl)` — mec:307
- `o = hoveredObjs[pl.color]`. Not a live card → instructions. Otherwise toggles the GUID in `commanderPick[color]` and broadcasts "marked" or "no longer marked".

#### `engineSend(t, payload)` — mec:325
- Sets `payload.t = t` (mutates the table passed in) and calls `sendExternalMessage({t = t, json = JSON.encode(payload)})`.

#### `onExternalMessage(m)` — mec:332
- Not a table → return. A string `m.json` that fails to decode → return; otherwise `m` = the decoded table. Dispatch: `chat` (to a seated colour, else everyone; gold), `deckReport` (only when `request` matches `readyRequest`), `started`, `table`, `prompt`, `clear`, `refused`, `log` (grey). Other types (e.g. `view`) are ignored.

#### `onObjectLeaveContainer(container, obj)` — mec:357
- In engine mode, an object taken out of the enabler bag (GUID `4f3387`) → `engineBlocked("Enabler tools")` and, one frame later, `container.putObject(obj)`. It doesn't chain to any earlier handler.

### 4.4 engine-renderer.lua: constants and state

| Name | Line | Scope | Meaning; writers |
|---|---|---|---|
| `ENGINE_BACK` | 6 | local | back URL |
| `LIFE_TRACKERS` | 7 | local | colour → life tracker GUID; also used by `clickGesture` |
| `CMD_DAMAGE` | 9 | local | victim → attacker → counter GUID |
| `TAX_LABELS` | 15 | local | colour → 2 tax-label GUIDs (command-zone anchors) |
| `SURFACE_Y` | 19 | local | 1.15 |
| `GRID`, `ROWS` | 22-23 | local | grid spacing; rows creature 0 / other 2 / land 4.7 (centred in the mat's mana box, which runs 3.46 to 10.375 along the forward axis) |
| `engineObjs` | 25 | local | id → object. Writers: `place` callback, `engineRender` cleanup, `engineClear`, library/pile code, leave handlers (adopt) |
| `engineSpawning` | 26 | local | id → true while spawning |
| `enginePlanned` | 27 | local | id → position this render; reset in `engineRender` |
| `engineInHand` | 28 | local | id → in a hand |
| `engineFace` | 29 | local | id → face URL at spawn |
| `engineMeta` | 30 | local | id → `{zone, color}`; set by `place`, library, pile |
| `engineManual` | 31 | local | id → player-chosen position |
| `engineHeld` | 32 | local | id → `os.clock()` of a pending gesture |
| `lastTurnSet` | 33 | local | last colour given to `Turns` |
| `stashed` | 34 | local | GUID → `{pos, rot, lock}` |
| `lastTable` | 35 | local | last `table` message; nil = no engine game |
| `renderQueued` | 36 | local | unused |
| `engineColors` | 37 | local | written by `engineRender`/`engineClear`, never read |
| `enginePrompts` | 356 | global | colour → open prompt (the tests read it) |
| `engineSelected` | 357 | local | colour → {option index = true} |
| `engineShown` | 358 | local | colour → why the panel is open: nil (hidden, the default), "pin" (Engine: show), "ask" (a question the table can't answer; cleared by the next question the table answers or when it closes), "browse" (Graveyards / exile) |
| `engineFilter` | 359 | local | colour → search text |
| `engineVisible` | 360 | local | colour → {slot k = option index} |
| `baseXml` | 361 | local | the table's UI XML, captured on the first build |
| `builtFor` | 362 | local | seated-colour key of the built panels |
| `panelReady` | 363 | local | panels exist |
| `uiCache` | 364 | local | id or `id|attr` → last value |
| `POOL` | 365 | local | 60 slots |
| `enginePick` | 557 | global | = local `pick` (for phase 2 and tests) |
| `engineConfirmIfComplete` | 560 | global fn | auto-confirm helper (see 4.5) |
| `toldAt` | 624 | local | throttle for `tell` |
| `GLOW` | 743 | local | highlight colours: mana, attack, block, target, picked |
| `glowing` | 744 | local | colour → {object = true} highlighted |
| `menued` | 745 | local | colour → {object = true} with our context menu |
| `pendingBlocker` | 746 | local | colour → blocker id waiting for its attacker |
| `phase1PlayerAction` | 899 | local | the phase-1 `onPlayerAction` |
| `resyncQueued` | 918 | local | redraw pending |
| `tableObjectSpawn`, `tableObjectDestroy`, `tableEnterContainer` | 925, 940, 721 | local | the earlier handlers |
| `libraryState` | 972 | local | colour → `{qty, key, pendingRebuild?}` |
| `engineSearch` | 973 | global | colour → library-search card models |
| `engineSearchIds` | 974 | global | id → in the current search deck |
| `libraryAnimUntil` | 975 | local | colour → end of the draw animation window |
| `FLAT` | 977 | local | zero transform |
| `libraryLeaveBefore` | 1058 | local | the enabler handler |
| `engineInPile` | 1089 | global | id → inside a pile deck |
| `pileState` | 1090 | local | pile id → id list key |
| `engineChoosable` | 1091 | global | colour → {id = true} pile picks |
| `pileLeaveBefore` | 1172 | local | the library handler |
| `tryEnterBefore` | 1199 | local | earlier `tryObjectEnterContainer` (nil) |

Object ids: card id; `stack:<id>`; `library:<Color>`, `graveyard:<Color>`, `exile:<Color>`. GMNotes `engine:<id>`; library fillers have GMNotes `libcard`.

### 4.5 engine-renderer.lua: functions

#### `onTable(v, lift)` — er:20
- Returns `Vector(v.x, 1.15 + lift, v.z)`.

#### `seatGeometry(color)` — er:40
- Returns nil without `data[color].playmat` or `libraryZone`. Otherwise `{mat, right, fwd, lib, libFwd, grave (graveyard position, or the library position), rotY, handPos}`. `rotY` = hand transform y (or playmat y) + 180. `handPos` is nil without a hand transform.
- Called by `engineRender`.

#### `gridPos(g, col, row)` — er:55
- `mat + right·(−col·2.4 + 10.75) + fwd·(row·3.2 − 8)` at table height.

#### `nickname(c)` — er:60
- "Face-down card" for hidden cards; else "Name\nType line\n<cmc>CMC" (the Card Importer format; `cardName` in mec reads the first line).

#### `description(c)` — er:65
- Rules text plus `[b]P/T[/b]`; `"` is replaced with `'`.

#### `engineCardData(c, how)` — er:193
- The one builder of an engine card's data: a `Card` with GMNotes `engine:<id>`, `CardID key·100`, `CustomDeck[key]` (key from `engineDeckKey(face, back)`; a hidden card gets the back image as its face). `how` nil: a card on its own, locked, tag `engine`. `"inside"`: a pile deck member, or a card spawned to go straight into one (`addToPile`): no `Locked`, no `Tags`. `"search"`: a library search member, the same with the plain back. See "Core moves: engineCardEntry and trackMarks, table half" below.

#### `firstLine(s)` — er:82
- The text up to the first newline.

#### `isInHand(o, color)` — er:84
- True if `o` is among that player's hand objects.

#### `keepOnly(id, obj)` — er:92
- Destroys every other object whose GMNotes equal `engine:<id>`. Scans all objects.
- Called by the library and pile spawn callbacks.

#### `isFree(meta)` — er:99
- True for a battlefield or command card whose colour is a seated player.

#### `place(c, pos, rot, seen, handColor, meta)` — er:104
- Returns if `c` or `c.id` is nil. Marks `seen`, sets `enginePlanned`, stores `meta`. `free = isFree(meta)`.
- Held card: `decided` = the new zone is neither hand nor command. If not decided, held for less than 3 s, and the object exists → return (leave it where the player dropped it). Otherwise clears the hold.
- Existing object that is destroyed, has a different first nickname line, or a new face URL → destroy it and forget it.
- No object: returns if a spawn is already running. Else marks `engineSpawning`, marks `engineInHand` for hand cards, `spawnObjectData` at pos/rot. The callback stores the object and face and sets the lock (hand cards unlocked, otherwise locked unless `free`).
- Existing object: updates the description if it changed.
  - For a hand (`handColor`): marks `engineInHand`; if it isn't in the hand yet: unlock, `setPosition`, `setRotation`. Return.
  - Leaving a hand: clears `engineInHand`, sets the lock, jumps (non-smooth) to pos/rot. Return.
  - Else: sets the lock to `not free`. Moves smoothly if it is more than 0.05 away on x/z or more than 0.4 in y. Rotates smoothly if more than 1° off (y + z).
- Called by `layoutRow`, `engineRender` (attachments, command, hand, stack), `engineZonePile` (single card).

#### `hasType(c, t)` — er:157
- True if `t` is in `c.ty`.

#### `layoutRow(g, cards, row, seen, color)` — er:162
- Rows longer than 10 cards are squeezed (`step` < 1). Position = `engineManual[id]` or the grid. Rotation y = `rotY` (+90 when tapped); z = 180 when face-down. Meta `{battlefield, color}`.

#### `pile(...)` — er:172
- Old stacked-pile layout. Never called.

#### `setLife(color, life)` — er:179
- Returns if there is no tracker or no life, or `count` already equals it. Else `setVar("count")`, `call("sL", life)`, `call("updateSave")` on the table's tracker.

#### `setCounterVal(guid, val)` — er:187
- Same pattern with `val`, `updateVal`, `updateSave`.

#### `setTax(guid, tax)` — er:195
- If `val` changed: `setVar("val")` and, wrapped in `pcall`, `editButton` label for button indices 0–9.

#### `updateTrackers(m)` — er:202
- Per player with a colour: life; commander damage per attacker colour (0 when missing); tax per label index. If `m.active` changed since the last call: when that colour is seated and `Turns.turn_color` differs, sets `Turns.enable = true` and `Turns.turn_color` (pcall).
- Note: `lastTurnSet` updates even when the colour isn't seated, so an AI's turn is never shown in `Turns`.

#### `keepStashed()` — er:220
- Every stashed object that came back above y = −5 is locked and moved 15 below its saved position.

#### `engineRender(m)` — er:227 (global)
- Sets `lastTable`; `keepStashed`; new `seen`; resets `enginePlanned`.
- Per player with geometry: `engineColors[color] = true`; sorts the battlefield into attached / lands / creatures / others; lays out three rows. Attachments go under their host (`enginePlanned[att]`, else the "other" row start), offset by `fwd·0.6k` and lowered 0.05k. Graveyard pile at `g.grave`; exile pile at `lib + libFwd·4.16`. Command cards sit on tax label `i` (else label 1, else the library position), or at their manual spot. The hand is placed only when it is known, a hand position exists, and the colour is seated. Library deck.
- Stack: entry `i` at `(−3 + 1.2(i−1), 3 + 0.1i, 0)`, rotation y 180, id `stack:<id>`.
- `engineManual` cleanup: forgets the spot of any seen card that is no longer on the battlefield or in the command zone.
- Destroys every tracked object not in `seen`. `updateTrackers(m)`. `engineRenderPanels("none")`.
- Callers: `onExternalMessage`, `snapBack`, `engineOnPrompt` (deferred), library/pile code.
- Bug?: players without geometry (an AI with a null colour, or no `data`) are skipped, so their cards are never drawn.
- Bug?: an aura whose host belongs to a player processed later falls back to the row start, because `enginePlanned` for the host isn't set yet.
- Note: it does not call `enginePhase2Prompt`, so cards spawned after a prompt opened get no glow or menu.

#### `stashObject(o)` — er:285
- Skips nil objects and ones already stashed. Records position, rotation and lock; locks it; moves it 15 down.

#### `stashImported(colors)` — er:292
- Per colour: the deck in the library zone; imported hand cards (non-identity, non-engine); every non-identity, non-engine card within 2.5 units of that colour's tax labels.

#### `restoreStash()` — er:315
- Puts every existing stashed object back (position, rotation, lock) and empties `stashed`.

#### `sweepEngineCards()` — er:1986
- Every object with GMNotes starting `engine:`, `enginetrash` or `libcard` goes to the trash (`engineDispose`); older `engine:trash` decks are destroyed. Since 2026-11-06 also any deck with no such GM notes whose cards are all `libcard` (one TTS formed from library cards added together, left on the library).

#### `engineClear()` — er:330 (global)
- Sweep; resets `engineObjs`, `engineSpawning`, `enginePlanned`, `engineColors`, `engineInHand`, `engineFace`, `engineMeta`, `engineManual`, `engineHeld`, `lastTurnSet`, `lastTable`, `enginePrompts`; `restoreStash`; `engineRenderPanels()`; turns engine mode off.
- Bug?: it does not reset `engineSearch`, `engineSearchIds`, `engineChoosable`, `engineInPile`, `libraryState`, `pileState`, `engineSelected`, `engineFilter`, or the phase-2 `glowing`/`menued`/`pendingBlocker`. A search open at reset would make the next game's library a search deck until the next prompt.

#### `engineStarted(m)` — er:341 (global)
- `humans` = colours not in `m.ai`. If `lastTable` is nil (new game, or after a reload), sweeps engine cards. `stashImported(humans)`. Turns engine mode on if it is off.

#### `count(t)` — er:367
- Number of keys.

#### `setText(id, text)` — er:369
- Skips values already in `uiCache`. A Button (every Button of the built XML, `engineBtnLook`) goes through `setButton`, which sends one `UI.setAttributes` carrying the colour as last set (or the XML's) and a text colour flipped between two that look the same (`engineFlipColor`): TTS redraws a Button at every set, dark label without a new textColor, white without a colour of its own (batch B, docs/engine-ui-spec.md 2.1). Others: `UI.setValue`.

#### `setAttr(id, attr, value)` — er:384
- Cached `UI.setAttribute`; a Button's goes through `setButton` (see `setText`).

#### `statusText()` — er:392
- Empty without `lastTable`. "<active>'s Nth turn (game turn T) - step - priority: X" with the right ordinal suffix; stack names top first; "GAME OVER - winner" line first when the game is over.

#### `panelXml(color)` — er:409
- XML for the dock `eng_dock_<color>` (batch B: the tabs Choices `eng_toggle_`, Graveyards `eng_browse_`, Undo `eng_undo_`, Settings `eng_set_` and the Log switch `eng_logbtn_`, UpperLeft x 96 y -140), the log panel, and the window `eng_panel_<color>` (UpperLeft x 96 y -176, 430×600): status, title, text, search input, scroll view with `POOL` option buttons, Confirm/Cancel, the stops row `eng_stops_<color>`. Every element is visible only to that colour, starts inactive, and is named `eng_*_<color>`.

#### `optionList(p)` — er:436
- Number mode: `min..min(max, min+59)` as `{index = n, label}`. Else `{index = i, label}` per option.

#### `updateOptions(color)` — er:446
- No prompt: title "Game over" or "Waiting for other players..."; hides search, confirm, cancel and every slot. Return.
- Else: title, text (" " when empty); search shown when there are more than 8 options. Applies the filter (plain substring, case-insensitive). Fills up to 60 slots: label prefixed `[x] `/`[  ] ` in multi mode; colour blue when picked, green for the first single option, else grey. Hides the remaining slots. Multi: Confirm text "Confirm (n selected, need m)", interactable only within min..max. Cancel shown when `p.cancel`.

#### `updatePanel(color)` — er:490
- The tabs (`ENGINE_TABS`) shown while a game exists, the open one gold on `ENGINE_THEME.tabOn`; Undo's shown state is `engineRewindUpdate`'s. The window is active when a game exists and something opened it. The stops row hides under a side tab; an open Settings tab is listed again. Updates the status text.

#### `engineRenderPanels(promptColor)` — er:499 (global)
- `seated` = seated colours that have `data`. If the set changed: reset the cache, capture `baseXml` once, `UI.setXml(base + panels)`, and 3 frames later mark ready and update every panel. Return.
- Not ready → return. Else `updatePanel` for each, and `updateOptions` for `promptColor` (or all when nil; `"none"` matches none).
- Note: the table's UI XML is captured once. Later changes the table makes to its own UI are overwritten whenever the seated colours change.

#### `engineAnswer(color, choice)` — er:522
- No prompt → return. Sends `answer {color, promptId, choice}`. Clears the prompt, selection and filter. If ready, clears the search box and calls `updateOptions`.
- Note: the panel clears locally even if the bridge later ignores the answer (promptId mismatch).

#### `pick(color, i)` — er:533
- A side tab open (`engineBrowse[color]`): Undo → `engineAskRewind(color, i)` and the tab shuts; Settings → the line's switch (`onMtgFx` / `onMtgSnd` / `onMtgAnim` / `onMtgPace`) and the list again; Graveyards → the card's text in the chat. Else: no prompt or `i` → return. Number mode → answer `{i}`. Single → answer `{options[i].id}` (returns if missing). Multi → toggles `i`, adding only below `max`; refreshes the options.
- Also exported as `enginePick` (er:557).

#### `engineSelectedFor(color, i)` — er:547 (global)
- True when option `i` is selected. Used by `isSelected`.

#### `engineConfirmIfComplete(color)` — er:560 (global)
- Returns unless a multi prompt is open with `min == max >= 1`. When exactly `max` options are selected, calls `confirm(color)`.
- Called by `clickGesture` after a target pick (er:872), so a one-target spell is answered by one click.

#### `confirm(color)` — er:549
- Sends the ids of the selected options, in option order.

#### `idColor(id)` — er:566
- Colour from `eng_<kind>_<Color>…`.

#### `onMtgSlot(player, value, id)` — er:568
- Parses `eng_opt_<Color>_<k>`. Returns unless it is the clicking player's colour. `pick(color, engineVisible[color][k])`.

#### `onMtgConfirm` / `onMtgCancel` — er:573 / 574
- Own colour only → `confirm`, or answer `{"__cancel"}`.

#### `onMtgToggle` — er:575
- Own colour only: `engineOpenTab(color, "choices")`: from a side tab → the answers, pinned; else open → closed (any reason), closed → pinned ("pin"). `onMtgBrowse`, `onMtgUndo`, `onMtgSettings` open their tabs the same way.

#### `engineOpenTab(color, tab)` (global, batch B)
- `tab` "choices", "browse", "undo" or "settings". A side tab sets `engineBrowse[color]` (and `engineShown` "browse" if the window was shut); the open side tab clicked again goes back (`engineShown` "browse" → shut). Clears the search; `updatePanel`, `updateOptions`.

#### `engineSidePrompt(color)` (global, batch B)
- The open side tab's look-only list for the answer buttons (mode "browse", `nosearch` for Undo and Settings): restore points; the four switches with their state (Table animations tinted `ENGINE_THEME.muted` for anyone but the host, `o.tint` read by `optionColor`); else `browsePrompt`.

#### `onMtgSearch(player, value, id)` — er:580
- Own colour only: sets the filter and calls `updateOptions` (even before the panels are ready).

#### `onMtgClick(player, value, id)` — er:587
- Legacy ids `o|C|i` / `n|C|n` → `pick`; `confirm|C`; `cancel|C`; `toggle|C`. Own colour only. Used by `tools/tts-autoplay*.js`.

#### `engineOnPrompt(m)` — er:596 (global)
- Stores the prompt or clears it (`promptId` nil). Resets `engineChoosable[color]`, then fills it from `pileChoices`. `search` = `librarySearch` while a prompt is open. When it differs from `engineSearch[color]`, stores it and re-renders one frame later. Clears selection, filter and hidden; clears the search box; `engineRenderPanels(color)`; `enginePhase2Prompt(color)` if defined.
- Note: `engineSearch` is compared by table identity, so every new search prompt triggers a re-render even with the same cards.

#### `isEngineCard(o)` / `engineIdOf(o)` — er:621 / 622
- GMNotes starts with `engine:` / the GMNotes without that prefix.

#### `tell(color, text)` — er:625
- The same text to the same colour at most every 3 s. Orange `broadcastToColor` if seated.

#### `insideZone(zoneObj, pos)` — er:632
- Local position inside ±0.5 on x and z (the zone's unit box). False for nil.

#### `dropArea(color, pos)` — er:639
- Checks, in order: graveyard zone, library zone, playmat → `battlefield`; exile point (`lib + fwd·4.16`, squared radius 2.5); tax labels (squared radius 2.25) → `command`; else `elsewhere`. No `data` → `elsewhere`.

#### `onPlayerAction` (phase 1) — er:657
- Allows everything outside engine mode, without a game, or for `Select`. For each target that is an engine card: `mine` = meta colour is the player's; `movable` = mine and the zone is hand/battlefield/command. Any action other than `PickUp`, or a non-movable card → `tell` and return false (the action is cancelled). Else true.
- Now called through the phase-2 wrapper (er:912).

#### `snapBack()` — er:674
- `engineRender(lastTable)` when there is a game.

#### `request(color, kind, id, obj)` — er:678
- `engineHeld[id] = os.clock()`; sends `intent`. `obj` is unused.

#### `onObjectDrop(color, obj)` — er:683
- Ignored outside engine mode, without a game, or for non-engine objects. Without meta, or for another player's card → snap back after 2 frames.
- 2 frames later: destroyed → return. A hand card still in the hand → return (rearranged). Then by `area`: hand/command → battlefield: remember the spot, `play`. Hand → graveyard: `discard`. Hand → library: `bottom`. Battlefield → battlefield: remember the spot, unlock. Command → command: nothing. Else: message if it landed in another named area, then snap back.

#### `engineRefused(m)` — er:711 (global)
- Clears the hold; forgets the manual spot unless the card is on the battlefield; snaps back.

#### `onObjectEnterContainer(container, obj)` — er:722
- Engine mode + game + engine card: one frame later, if the container still exists: a deck made only of engine cards is destroyed; otherwise this card is taken out (`takeObject` by GUID) and destroyed. Snap back 2 frames after that. Returns without calling the table handler.
- Otherwise calls the table's own handler.

#### Phase 2 (er:740-913)

##### `promptKind(p)` — er:748
- nil for no prompt. Title starts `Pay ` → `mana`; `Declare attackers` → `attack`; `Declare blockers` → `block`; equals `Your priority` → `action`. Else `target` if any option id starts `card|` or `player|`. Else nil.
- Bug?: the kind is detected from the title text. A target prompt from a card whose name starts with "Pay " (title "Pay …: choose 1 target(s)") would count as `mana`.

##### `startsWith(s, prefix)` — er:762
- Prefix test on `tostring(s)`.

##### `unglow(color)` — er:764
- `highlightOff()` on every live object in `glowing[color]`; resets it.

##### `glowCard(color, id, rgb)` — er:769
- If `engineObjs[id]` is alive: `highlightOn(rgb)` (no duration) and records it.
- Note: TTS highlights are seen by every player, not only the deciding colour. Cards inside decks or not yet spawned can't glow.

##### `clearMenus(color)` — er:777
- `clearContextMenu()` on every live object in `menued[color]` (this removes all custom menu items on that card); resets it.

##### `findOption(color, test)` — er:783
- The first index (and option) of the open prompt that passes `test`, else nil.

##### `isSelected(color, i)` — er:788
- Multi mode and `engineSelectedFor`.

##### `enginePhase2Prompt(color)` — er:794 (global)
- Unglow, clear menus, clear `pendingBlocker`. Kind nil → return. Per option:
  - `mana`: options with `cardId` and a `tap:` id → glow that card gold. Options with an `untap:` id (sources already tapped for this cost, which can be undone) → glow green (er:804).
  - `attack`: glow the attacker (part before `|`): green if selected, else red.
  - `block`: glow the blocker: green if selected, else blue. The `attacker` variable at er:807 is unused, so attackers are not glowed.
  - `target`: `card|<id>` → orange glow. `player|` options get no glow.
  - `action` with `cardId`: adds a context-menu item to the card (label trimmed to 38 characters + "…"). The callback ignores other colours, finds the option by id, and calls `enginePick`.
- Called by `engineOnPrompt` (every prompt and close) and after gestures.
- Note: menu items stay until the next `prompt` message for that colour. Every player sees them, but only the owner's click works.

##### `tapGesture(color, id)` — er:830
- `mana`: picks the `tap:` option for that card; if there is none, the `untap:` option (gives the mana back, er:836). Single mode, so it answers at once → true. Neither → `tell "That can't pay for this."` → true.
- `attack`: the first option starting `<id>|` → `enginePick` (toggle) → re-glow → true; none → tell the bridge's reason from the question's `cantAttack[id]` ("Hill Giant can't attack: summoning sick."), else "That creature can't attack right now." → true.
- Other kinds → false.
- Note: for attack, Q/E toggles the creature's first option. The bridge keeps that option first (`keepOrder`): its "→ whom?" when it has several targets, so whom it attacks is asked after (`attackWhom`).

##### `clickGesture(color, obj)` — er:854
- Kind nil → false. `id` = the engine id when `obj` is an engine card.
- `target`: the option `card|<id>`; else, if `obj` is a player's life tracker (via `LIFE_TRACKERS` and `lastTable.players[].slot`), the option `player|<slot>`. Found → `enginePick` (toggle) → `engineConfirmIfComplete` (sends the answer when exactly the required number is chosen; otherwise the player presses Confirm) → re-glow → true (er:870-875). Not found → false.
- `block` with an engine card: if the card is one of your blockers → `pendingBlocker = id`, green glow, tell "Now click the attacker" → true. Else, with a pending blocker: the option `<blocker>|<id>` → pick, clear pending, re-glow → true; none → tell → true.
- Otherwise false.
- Note: after a target pick, `enginePhase2Prompt` re-glows chosen targets orange, not green.
- Note: only table clicks on targets auto-confirm. Panel clicks, block pairs and attack toggles never do.
- Note: in block mode, clicking your own blocker that is already paired toggles nothing; it just becomes the new pending blocker.

##### `onPlayerAction` (phase 2) — er:900
- In engine mode with a game and an open prompt for the player: per target: a rotate (Q/E) on the player's own engine card → `tapGesture`; true → return false (cancel the rotation). `Select` or `PickUp` → `clickGesture`; true → return false. Otherwise falls through to phase 1.
- Note: when a gesture isn't used, phase 1 still runs and refuses the rotation with "The engine handles that".
- Note: during a target or block prompt, picking up your own hand card that is also a candidate is consumed as a click, so it can't be dragged.

#### `resyncSoon()` — er:919
- At most one pending: snap back after 5 frames.

#### `onObjectSpawn(obj)` — er:926
- Engine mode + game + engine card that isn't a deck id, isn't being spawned, isn't the tracked object, isn't in a search deck and isn't in a pile → one frame later destroy it (if still untracked) and `resyncSoon`. Then the table's handler (nil).

#### `onObjectDestroy(obj)` — er:941
- Engine card destroyed in engine mode with a game → `resyncSoon`. This also fires for the renderer's own destroys and is harmless, because the redraw is idempotent but costs a render.

#### `onSave()` — er:950
- Returns `JSON.encode({engineStash = {guid = {pos, rot, lock}}})`. This replaces Global `script_state`; the table had no `onSave`.

#### Load block — er:958-968
- After 30 frames: decode `Global.script_state`; restore `stashed` from `engineStash`; sweep; `restoreStash`; send `hello`.
- Note: this runs on every script load, including Save & Play mid-game. The bridge then redraws.

#### `libraryDeckData(color, count, candidates)` — er:4311
- The plain back's `CustomDeck` entry is `deckEntry(ENGINE_BACK, ENGINE_BACK)` (`backDeckEntry` was removed 2026-11-06). Each candidate is `engineCardData(c, "search")`. Then filler `libcard`s ("Library card", `CardID backKey·100`) up to `max(count, candidates)` objects in total. A locked deck with GMNotes `engine:library:<Color>`. The libAdd path in `engineLibraryDeck` reuses it for the cards it adds.
- Note: the candidates sit first in `ContainedObjects`, which is the top of the deck.

#### `engineLibraryDeck(color, g, count, seen)` — er:1000 (global)
- Marks `library:<C>` seen; meta `{library, color}`. `key` = `search:<n>` or `plain`.
- Alive with the same key and count → return.
- Spawning → record `{qty, key, pendingRebuild = true}` and return.
- Plain deck shrank (to `count ≥ 2`): set the 2 s animation window; take `min(diff, quantity−1)` cards toward the hand (or library) + 2 y, smoothly; each is destroyed 0.6 s later. Update `qty`. Return.
- Plain deck grew (cards put on the bottom, a mulligan's cards back; op `libAdd`): ONE object is spawned 2 above it, a plain card for 1, else a deck of the N plain backs (`libraryDeckData`, unlocked, GMNotes `libcard`), and put into the library with one `enginePutInDeck` (a deck put into a deck merges its cards). If the library was destroyed meanwhile the object goes to the trash. Update `qty`. Return. (Before 2026-11-06 it spawned N cards on one spot; on the real table they merged into their own deck lying on the library.)
- Else: destroy the old deck; new state; rebuild `engineSearchIds` from the candidates. Nothing to show → return. One card and no search → a single `engineCardData` card named "Library". Else `libraryDeckData`. Spawn at the library position + 0.3, face down. Callback: from an earlier game (`engineSpawnStale`) → nothing. If the state changed and is marked `pendingRebuild` → destroy, clear the state, re-render. Else track it, lock it, `keepOnly`.
- Note: `engineSearchIds` is a single global table, so rebuilding one colour's library clears every other colour's search ids.
- Note: a library at 1 card that then draws to 0 is rebuilt (destroyed), not animated.

#### `onObjectLeaveContainer` (library) — er:1059
- Only for containers with GMNotes `engine:library:<Color>` in engine mode.
  - A search candidate while a search is open → adopt the object, hold it, send `intent choose`. Return.
  - A `libcard` during the draw animation window → return.
  - Else `tell` and, one frame later: destroy the object, clear the state, destroy the library deck, destroy every loose `libcard`, re-render. Return.
- Other containers → enabler handler.

#### `engineZonePile(color, zone, cards, base, rotY, seen)` — er:1093 (global)
- Marks `<zone>:<C>` seen; meta zone `graveyardpile`/`exilepile`.
- 0 or 1 card: destroys any pile deck, clears the state, places the single card at the base (face down if `fd`). Return.
- Same id list and the deck exists or is spawning → mark the cards seen; return.
- Else: each card still a loose object slides onto the pile (locked) and is destroyed 0.6 s later; it is marked `engineInPile`. Destroy the old deck; store the new key. Build a face-up deck, newest first (hidden cards show the back). 0.5 s later spawn it at base + 0.2. Callback: a newer key → destroy; else track, lock, `keepOnly`.
- Note: there is a 0.5 s gap where the pile shows no deck.

#### `engineRebuildPile(id)` — er:1159 (global)
- Clears the state; destroys the deck and every loose object for a card in a pile (or carrying the pile's GMNotes) that isn't the tracked object; re-renders 2 frames later.

#### `onObjectLeaveContainer` (pile) — er:1173
- Only for `engine:graveyard:<C>` / `engine:exile:<C>` in engine mode.
  - The card is choosable for some colour → adopt it, clear `engineInPile`, hold it, send `intent choose` for that colour. Return.
  - Else `tell` the pile owner "Look only…" and, one frame later, destroy the card and `engineRebuildPile`. Return.
- Other containers → library handler.
- Bug?: TTS doesn't say who pulled the card, so any player who takes a choosable card counts as the chooser's pick. If two colours could choose the same card, the last one in `pairs` order wins.

#### `tryObjectEnterContainer(container, obj)` — er:1200
- In engine mode, refuses entry into engine library/graveyard/exile decks. Else the earlier handler, else true.

---

### 4.7 engine-renderer.lua: M5 lines and the setup buttons (added 2026-10-21)

| Function | Details |
|---|---|
| `engineDrawLines(m, stackSpot)` | target arcs (cyan, thickness 0.3001: stack item or ability source → card / life counter / other stack item), attack (red-pink 0.2201: attacker → life counter or planeswalker), block (gold 0.1601: blocker → attacker); arcs of 11 points; redrawn only when the end points change; players' own vector lines (any other thickness) are kept; `engineDrawLines(nil)` on reset clears ours |
| `enginePopupsClose(m)` | hides the stack pop-up once its item has left the stack, at least `POP_MIN` (2.5 s) after it appeared |
| `engineSetupButtons()` | READY buttons (half size, just below each seated player's Draw button) and the middle "Start" tile (spawned once, GMNotes `mtgsetup`; under the table unless every seated player is ready, after a game for NEW GAME, or with engine mode off); hides a ready player's own table buttons (`engineTableButtons(fn)`, per seat by nearest playmat); redraws only when mode, game state, seats or readiness change |
| `engineDeckReport(m)` | from the bridge's `deckReport` (`ready`, `checked`): ready → green, checked but not ready → red |
| `onMtgSetupReady`, `onMtgSetupStart` | Ready: only the seat's own player (= `mtg ready`; pressed when ready: un-ready). Start: when all seated are ready, anyone (`engineStartGame`, "ai 1" when alone); after game over, `mtg reset` (anyone) |
| `onPlayerChangeColor` | redraws the setup buttons when someone sits down or leaves |
| `scoopXml(c)`, `onMtgScoopAsk/Yes/No` | Scoop (2026-10-21): a screen-UI button beside the player's name at the top (`eng_scoop_<colour>`, visible to that player only, only while they are still playing); it opens a large "Concede this game?" box (`eng_scoopask_<colour>`) with Scoop / Keep playing; Scoop sends `concede`. Each handler ignores clicks on another player's ids |
| `engineHideForEngine(on)` | the Pirate Cannon (540e21) and the first-player die (ee33ec) go under the table (y −30, locked) in engine mode and back when it is off; their position and lock state are kept in the object's `memo` as text (`mtghome x y z locked`), so they return to the same spot after a save and reload |
| `clickGesture` (target questions) | a click on a battlefield card that can't be chosen tells the player so (it used to do nothing visible); a planeswalker says "That planeswalker", and a question of players only (no card, no spell) says "it asks for a player. Click a glowing life counter." (item 24, 2026-11-11) |
| `engineTargetSorts(q)` | what a target question offers: `{ cards, players, spells, walkers }` from its `card|` / `player|` / `spell|` ids; `walkers` = it offers cards and each is a Planeswalker (`engineStatic[id].ty`). Read by the hint (`engineUpdateCorner`: players + planeswalkers only → "Click a player's life counter or a glowing planeswalker.") and by `clickGesture`'s refusal (item 24) |

Planeswalkers by click (item 24, 2026-11-11): a planeswalker on the battlefield is a card target like a creature. Forge's
`chooseBoardTargets` offers it as `{ kind: "card" }` (for "any target" the harness sends the players first, then the
cards: `ManaBrewInteractiveSession`, `choose_target_any`), so the table's one target path covers it: `engineOnPrompt`
unlocks it even when it is the AI's (`engineClickable`), `enginePhase2Prompt` glows it `GLOW.target`, and its click
answers `card|<id>`, as a life counter answers `player|<slot>`. The other shape, a choice of players and permanents
that is no target, is turned into the same target question by the bridge (`entityChoiceIds`, below).

Crash recovery (2026-10-22): `saveResume` writes the running game to `tmp/bridge-game.json` (`MTG_RESUME_FILE`; the headless test bridge uses its own) when it starts and every 5 s: seats (colour, deck, relay username, slot, room), slot names and colours, deck names, `turnOwners`. At startup `resumeGame` rejoins a save younger than 50 s (the relay gives a dropped seat away at ~65 s): each `Seat` is rebuilt with `resume` (same username, slot, room, `lostAt` set), so its login is handled as a reconnect (RequestResync; JoinRoom if the session was not kept). A reset or game over deletes the save. Checked live: the bridge killed twice mid-game, back in 8 s and 0.3 s, the game played on to the end. `tools/start-bridge.ps1` also runs Node with `--report-on-fatalerror` (reports in `tmp/node-reports`).

Stack pop-up X (2026-10-22): `eng_pop_x` calls `onMtgPopClose`, which takes that colour out of the pop-up's `visibility` (`enginePopClosed`; none left → inactive). `enginePopOpen()` (every new pop-up and COUNTERED) shows it to everyone again.

Plain questions (2026-10-22): `plainQuestion(title, text)` rewrites Forge's titles ("Use triggered ability of X?" / "Apply replacement effect of X?" → "Use X?", a second title line moves to the text, "Do you want to shuffle the library?" → "Shuffle your library?", " (0-1)" → " (up to 1)"); the text gets "Source: X" only when the title doesn't name X, and the ability text once, cut to 160 characters (`shorten`). Order questions (`reorder`): triggers "Your triggers: click the one that happens first/next" (the first resolves first: Manabrew's client says "Leftmost resolves first"), a library card's own reorder "X: click the card to put on top / next (number n from the top)", cards bound for the bottom say the order hardly matters; `orderSteps` takes the title as text or as a function of how many are placed.

Arena wording (2026-10-22 ease-of-use pass, from every question 24 hand-play decks met): `arenaWords(ui, src, slot)` is the last pass over every question (CARDNAME → the card, `player-view-N` → the player or "you", Forge's Accept / Decline → Yes / No, double spaces); `yesNoWords` puts verbs on yes/no buttons ("Pay 1 life" / "Don't pay", "Sacrifice" / "Keep it", "Cast it" / "Don't cast", "Stop searching" / "Keep searching", "Command zone" / "Leave it") and turns "Do you want to X?" into "X?"; `targetTitle` replaces Forge's AI hint titles ("Buff", "Hostile", "Destroy", "Choose player to heal") with "<card>: choose a target to destroy"; `countWords` writes counts as Arena does ("a card", "up to 2 cards"); modes read "<card>: choose one", counter kinds "+1/+1 counter"; mulligan "Keep this hand?" Keep / Mulligan; attack/block "Choose attackers" / "Choose blockers"; scry "Scry 2: choose cards to put on the bottom"; reveal button OK; the pass button "Next" or, with something on the stack, "Resolve" (and "Resolve all (N)"). The table: "Done" for Confirm, "Attack" to confirm attackers, the instruction line is the question with one short how-to line under it.

What a bare question is for (sweep question audit 2026-10-27/28, `tools/question-audit.js`): `purposeOf(words, kind)` reads the asking ability's own words (the card's text when Forge sends none, its reminder text only when the rules text has no such sentence) and answers only when exactly one sentence says it. Targets: the one-target sentence as a question ("put a +1/+1 counter on which creature?", "destroy which other creature?"). Cards: a library search, anyone's ("search target opponent's library for which artifact, creature, enchantment, or land card?"), a graveyard return, "look at the top N … exile one face down / put one into your hand" ("exile which card face down?"), a tap ("tap which untapped artifact, creature, or land? (choose 4)"), proliferate. Modes: two token kinds ("create which token?"). A mana source tapped while paying: "Tap Command Tower for which mana?" (any "Add … mana of any …"). Optional costs: "pay Kicker ({1}{B})?", "pay Jump-start (Discard a card)?", "promise an opponent a card?" (Gift, from "Gift a card"), "collect evidence 8?"; a keyword asked as "pay for X?" with a reminder that says "you may …" asks that ("Rally the Galadhrim: tap two untapped creatures you control that share a color with it?", Conspire).

From the review of all 24 hand-play decks (2026-10-22, `tools/question-review.js`): every question gets the asking card's name in front unless its title already names it or has its own heading ("Scry 1: ..."); after the name the question reads on in lower case. Answered without asking: a reorder bound for the bottom of the library, Forge's "Cancel Search?" right after Done with fewer cards (`seat.cardsDone`), a selection or colour with only one possible answer. Notices with no cards ("White picked AI 1", votes) go to chat and the game log instead of an OK question, with "You" for the player and the vote count in plain words. Number questions: "pay for Offspring? {2}" (0 to 1) becomes a yes/no, a non-mana cost (Casualty) "Use Casualty?" with "It costs: ..." under it, "choose Amount for Multikicker: {2}" becomes "<card>: pay {2} how many times? (Multikicker)", Forge's no-limit maximum is capped at 20, "Choose a value for X" reads "choose X". Clash: "<card>: clash" with "You: Island (0), AI 1: Island (0). Nobody wins." The game log gets one line for the table, "Clash (<card>): White reveals Island (mana value 0), AI 1 reveals Forest (mana value 0). Nobody wins." Forge shows the clash to every human seat, one after another, so `game.lastClash` remembers the line and the seats shown it: the same line for a seat not yet shown it (within `CLASH_SAME_MS`, 2 minutes) is that clash again and is not logged; for a seat already shown it, it is a new clash with the same cards and is logged. Then "Keep <card> on top of your library?" Top / Bottom. Ward: "<card> has ward: pay {2}, or your spell is countered?". The free cast "Cast <card> for free?" Cast it / Put in hand. Mode buttons lose reminder text in brackets. Combat damage: "<attacker>: assign N combat damage", Auto-assign / Assign it myself. A question with no title gets a plain one ("Choose"), never the engine's type name.

Payment: `costLeft(cost, pool)` is what a cost still asks for once the floating mana is used; tap buttons are ranked against it (and `seat.payingCost`, for Command Tower's colour), because Forge repeats the full cost in every payment question. Ranked against the full cost, City of Brass kept being tapped for {U} with {U} already floating, and one hand-play game asked "Pay {1}{U}{B}" 1,648 times.

`engineCut(text, n)` cuts text to n bytes without splitting a character (used for the pop-up text, corner labels, the card row's text and names, chat labels).

The Engine panel (`engineOnPrompt`): a question counts as handled by the table (panel stays shut) when it is a table question (`enginePromptKind`) other than a library search, a one- or End-turn/No-style two-button question, a number, or fits the card row: up to 7 pictures plus 4 buttons, or up to 5 buttons (4 with Done) for the row's button kinds or a question with the card's picture. A 352-way creature-type list or a library search opens the panel.

Payment ranks: a needed colour that no other source in the payment offers ranks 3 (a Forest that is also a Swamp pays {G} for {B}{G}). Buttons that would read the same ("{G}" twice) get what else they do (`distinctLabels`).

M5 effects without an AssetBundle (2026-10-22): `engineEffects(m)` runs after the pop-ups on every board, comparing with the last board (`FX.prev`: battlefield, graveyard, stack, status per player; zones a board leaves out are carried over). Deaths: battlefield → graveyard, or a token gone → `deathFlash` (waits for the pile to be rebuilt, ~40 frames, then the pile or the card itself: violet highlight 1.2 s, "xN" button 1.4 s). Countered: a stack item whose text says "counter target" left, and a spell it targeted (`tg`, kind `s`) left too → the pop-up says "COUNTERED: <name>" for 1.8 s. Knocked out: status turns `lost` → `eng_result_<colour>` banner (DEFEAT / "<NAME> IS OUT"), the life counter tinted dark (back on `engineEffectsReset`, called by `engineClear`). Game over → VICTORY / DEFEAT 2.5 s later. Banners are per player and skipped for `engineEffectsOff[colour]` (`mtg effects off`). Test hooks: `engineFxLast.died`, `engineFxFlashed`. Screenshots of a live game: `node tools/effect-shots.js`.

"Pay or else" questions and Sylvan Library (2026-10-22, from a raw capture of Forge's questions, `MTG_RAW=1` logs them):
- **`otherwiseText`:** Forge's `otherwise: "..."` text of an "unless you pay" yes/no, as an instruction ("sacrifice Mystic Remora", "put a card on top of your library"). The No button says it; `{LIFE}` reads "life" (`plainWords`); a yes/no whose title lacks its card's name gets it in front.
- **Sylvan Library as Forge runs it:** choose 2 drawn cards → order them → per card "Pay 4 {LIFE}?" → after a No, "Select a card from your hand" (which one goes back). `seat.unless` = { src, ids (chosen, still in hand), n, k, awaitingPick, putBack }: the order step is answered as is, the yes/no reads "Pay 4 life? (k of n)" with the chosen cards pictured, the follow-up reads "which card goes back on top of your library?". Dragging a chosen card onto the library during the yes/no answers No and the follow-up with that card (`onIntent`, `aboutCards` / `otherwiseDo`); dragging the permanent to the graveyard answers a "pay or sacrifice" (Mystic Remora). Any other question from the same card ends a round (Forge skips the follow-up when only one card can go back); a follow-up is a one-card pick.
- **Table, `detectPending`:** draws that an open question is about aren't held on the library (Forge sends the question ~50 ms before the board that draws them, so they stayed out of reach and the question couldn't be answered on the table).

M5 step 2 (2026-10-22):
- **`badgeParts(c)` / `updateBadge`:** up to three buttons per battlefield card (`BADGE` positions and colours): `pt` bottom right (P/T with damage taken off toughness, blue raised / red lowered or damaged; loyalty or defense when there is no P/T), `ctr` top right (+1/+1 and -1/-1 summed, then other counters, one per line), `grp` top left (`xN`). `badgeText` is the one string that decides a redraw.
- **`setLife` / `engineLifeSeen`:** a life change calls the counter's `engineLifeChange({ life, delta })` (make-engine-copy patch on the 4 life counters); changes within 3 s are summed from the life before the first one; the first board of a game (and after `engineClear`) only sets the number.
- **`tools/tts-push-global.js --objects=<guid,...>`** also sends those objects' scripts (needed for object-script patches like this one).

Hand-play sweep fixes (2026-10-21, `tmp/handplay/report.md`):
- **Paying by turning a land:** the bridge ranks each payment button against the cost still due (`manaRank`: 2 = a colour a coloured or hybrid symbol needs, 1 = generic only, 0 = no use; option field `rank`); `tapGesture` uses the land's best button and says "wrong colour" when none helps (it used the first button, so City of Brass always gave {W}).
- **Control change:** `layoutRow` forgets the spot a player arranged a permanent at when its controller changes.
- **Too few targets:** `chooseBoardTargets` with fewer candidates than `minTargets` says only Cancel can finish it.
- **Discard / bottom by drag:** each partial pick sends `{ t: "picked", color, id }`; the table marks that option chosen (`enginePickById`), and the chat names the card and how many more.
- **Targets in a pile:** a graveyard/exile target gets `img`, so it shows in the card row (it had no card to click).

Bridge (2026-10-21): turning a card (Q/E) that has no mana ability uses its `{T}` ability (Hermit Druid, fetch lands); several `{T}` abilities ask which; a cast or a land play never counts.

`engineStartGame(pl, rest)` (make-engine-copy.js): the body of `mtg start`, shared by the chat command and the Start button (anyone, seated or not).

### 4.6 engine-renderer.lua: rewind UI and profiling (added 2026-10-20)

| Function / element | Details |
|---|---|
| `rewindXml(c)` | per colour: Auto-resolve `eng_autores_<c>` (dock row, x 468), `eng_vote_<c>` pop-up with `eng_votetext_<c>`, `eng_voteyes_<c>` (Rewind), `eng_voteno_<c>` (Keep playing). The Undo button is a dock tab since batch B (`panelXml`); the `eng_undolist_<c>` panel and `UNDO_MAX` are gone |
| `engineRewindUpdate(r, gameOver)` | called from `engineRender` (pcall) with `m.rewind`; skips when its string signature (`rewindSig`) is unchanged. Per seated colour: the Undo tab shown while points exist and the game isn't over; an open Undo tab listed again, or shut with no points; the vote pop-up shown while pending, the buttons only for awaited colours, others see "Waiting for ..." |
| `engineRewindRedraw()` | after the panels are rebuilt (someone sat down): clears `rewindSig` and draws the rewind UI again |
| `onMtgUndo`, `onMtgUndoPick`, `engineAskRewind(color, k)` | `onMtgUndo` opens / shuts the Undo tab (`engineOpenTab`); a pick in it (`pick`) or `onMtgUndoPick` (old ids `eng_undopt_<c>_<k>`, kept for the tests) shuts it and sends `rewind` with point k's id; `engineAskRewind` returns false for a missing point (used by `mtg undo N`) |
| `onMtgVote` | `rewindVote` accept true/false from the clicking player's colour |
| `engineResetUi` (changed) | also hides the rewind UI (`engineRewindUpdate(nil, true)`), so "mtg reset" doesn't leave Undo or a vote on screen |
| `sect(name)` | profiling only: adds the time since the previous mark to `engineProfile.sect[name]` (ms). Marks in `engineRender`: status, takeFromPiles, keepStashed, battlefield, attached, piles, commandHand, library, popups, stack, glow, dispose, trackers, browse, panels. No effect on the table |

## 5. make-engine-copy.js

Run: `node tools/make-engine-copy.js [source.json] [dest.json]`. The defaults are the workshop file `…/Mods/Workshop/2296042369.json` → `…/Saves/MTG 4 player table - ENGINE MODE.json` (mec:8-10). Prints OK/FAIL per step. Any FAIL sets `process.exitCode = 1`; then nothing is written (mec:443-444). Otherwise it writes the JSON (2-space indented) and copies the `.png` thumbnail. Rebuild after every change to `engine-renderer.lua` or this script. Then load the save, or push Global with `tools/tts-push-global.js`. A dry run into a scratch folder on 2026-10-17 printed OK for every step.

### Helpers

#### `allObjects(list)` — mec:17 (generator)
- Yields every object, recursing into `ContainedObjects` and `States`.

#### `patchScripts(label, find, replace, expect = 1, {global})` — mec:26
- Targets: `save` (Global) or every object. For each script that contains `find` (as-is, or with CRLF line endings), replaces every occurrence and counts the script once. Reports OK when count ≥ `expect`; else FAIL.

#### `removeObjects(label, guid)` — mec:40
- Removes objects with that GUID at any depth of `ContainedObjects`. Note: it doesn't look inside `States`. FAIL if none were removed.

#### `guard(label, marker, names, {silent, ret, global, min = 1, exclude})` — mec:127
- Removes `'` from the label. Body: in Global `if ENGINE_MODE then engineBlocked('<label>') return [ret] end`; in object scripts `if Global.getVar('ENGINE_MODE') then Global.call('engineBlocked', '<label>') return [ret] end`. `silent` leaves out the message.
- For every script containing `marker` (and not `exclude`), and every name: the regex `^[ \t]*(local )?function <name>(…)` (multiline; only the first match per script) gets the body appended on the same line, followed by `-- [engine copy]`.
- OK when the total ≥ `min` and (min is 0 or every name was found at least once).
- Notes: only one-line headers at the start of a line match, so `name = function()` forms are never guarded. Only the first definition per script is guarded.

### Security fixes

| Step | Line | Change | Result in the dry run |
|---|---|---|---|
| 1 | 54 | Global `onChat`: remove the "promote me" auto-promote for Steam ID <table author Steam ID> | 1 script |
| 2 | 66 | Remove the hidden smart-mulligan button object `dc2d88` | 1 removed |
| 2 | 67 | Global `if smartMulligan then` → `if false then` | 1 |
| 3 | 72, 75 | Easy Modules: `force encoder` / `force importer` disabled (`if false and …`) | 1 + 1 |
| 3 | 78 | Easy Modules `SelfUpdateCheck` returns at once | 1 |
| 4 | 83 | Encoder: the menu-module download replaced by a broadcast | 1 |
| 4 | 86 | Encoder `callVersionCheck` returns after a broadcast | 1 |
| 5 | 91 | Phasing + Color Module `updateModule` returns at once | 2 |
| 6 | 96 | rikrassen importer: `spawnObjectJSON` through `engineCopyStripScripts` | 2 |
| 6 | 99 | adds `engineCopyStripScripts(json)`: decodes (`"{}"` on failure), strips `LuaScript`, `LuaScriptState`, `XmlUI` recursively (contained objects and states), re-encodes | 2 |
| 6 | 117 | rikrassen `M.check_version` returns at once | 2 |
| check | 435-441 | no script still contains `steam_id == '<table author Steam ID>'` | OK |

Other edits: `SaveName` (121); the `onChat` hook (154); the ENGINE MODE block (158-363); the renderer (366); Pirate Cannon: the "goes first!" die only sets the turn when engine mode is off (395).

### Guard groups (mec:369-430)

The counts come from the dry run: 345 insertions in total, plus the Pirate Cannon patch. PLAN.md says 346.

| Label | Marker | Functions | Options | Count |
|---|---|---|---|---|
| Draw | `function playerDraw` | playerDraw | global | 1 |
| Scry | `function playerScry` | playerScry | global | 1 |
| Mill | `function playerMill` | playerMill | global | 1 |
| Untap | `function playerUntap` | playerUntap | global | 1 |
| Mulligan | `function playerMulligan` | playerMulligan | global | 1 |
| Reveal | `function revealFan` | revealFan, revealStack | global | 2 |
| Typed numbers on table buttons | `function onObjectNumberTyped` | onObjectNumberTyped | global, silent, `ret true` | 1 |
| Hotkeys | `function onScriptingButtonDown` | onScriptingButtonDown | global | 1 |
| Zone context menus | `function onObjectEnterZone` | onObjectEnterZone, onObjectLeaveZone | global, silent | 2 |
| Get basic land | `function deckRampW` | deckRampW/U/R/B/G/Wa | global | 6 |
| Make token copy | `function cardToken` | cardToken | global | 1 |
| Cascade | `function cardCascade` | cardCascade, deckCascade | global | 2 |
| Random discard | `function randomDiscard` | randomDiscard | global | 1 |
| Reveal until type | `function deckSeachType` | deckSeachType | global | 1 |
| Life counter | `function resetLife` | option, click_changeValue, resetLife, onNumberTyped | — | 16 |
| Life chat commands | `function resetLife` | onChat | silent | 4 |
| Counters | `function add_subtract` | add_subtract | min 5, exclude `noencode=true` | 80 |
| Counters | `function add_subtract` | reset_val, onNumberTyped | min 5, exclude | 120 |
| Counter chat reset | `function add_subtract` | onChat | silent, min 2 | 20 |
| Turn skipper | `function assignColor` | onPlayerTurn, onDrop | silent | 4 |
| Card buttons (P/T, counters, control, face, copies) | `_MTG_Simplified_UNIFIED` | 20 `Receive…`, MakeExactCopy, ReImport, EmblemsAndTokens | — | 20 |
| Keyword counters | `function toggleKeywordsMenu` | toggleStatus | — | 1 |
| Token marker | `function toggleToken` | toggleToken | — | 1 |
| Phasing | `function unPhased` | phaseOut, unPhased | — | 2 |
| Face-down | `function genericFlipUp` | toggleFaceDown, changeMode, contextMorph, contextDisguise, contextGenericFlipUp | — | 5 |
| Face-down context menus | `function genericFlipUp` | onObjectEnterZone, onObjectLeaveZone | silent | 2 |
| Flip from card menu | `function piFlipMenu` | piFlipMenu | — | 1 |
| Card importer | `function parseImporterChatArgs` | onChat, ENC, eRespawn | — | 3 |
| Day/Night | `function switchState` | switchState | min 2 | 3 |
| Day/Night card transforms | `function switchState` | onStateChange | silent, min 2 | 2 |
| The Ring | `function upDown` | press1–4, upDown | — | 5 |
| Deck search tools | `function changeDeckDir` | onCollisionEnter | min 4 | 14 |
| Get deck data | `function fixDeckText` | onCollisionEnter | — | 1 |
| Treachery identity token buttons | `function getToken` | getToken, getToken1, getToken2 | min 10 | 11 |
| Treachery identity token buttons | `function green(obj,ply)` | red | — | 1 |
| Dungeon tokens | `function spawnTokens` | spawnTokens | silent, min 5 | 7 |

Left alone on purpose: highlight mats, timers, hand counters, CardCustom, dungeon room markers, sort hand, notes, dice. The enabler bag is handled by mec:357; TTS's end-turn button by `Turns.pass_turns`.

Note: the Global guards on `onObjectEnterZone`/`onObjectLeaveZone` are silent and turn off the table's zone context menus. That is also what the table's `clearContextMenu` wipe ran in.

---

## 6. Tools and tests

| File | Functions / steps | Run |
|---|---|---|
| `tools/build-forge-card-index.js` | `docker exec` + awk over `cardsfolder/*.txt`: one line per script `split\tface…` (11-17). `norm` (20) is the same as `normName`. Index keys: canonical name (split → "A // B", else the front face), the joined faces, and each face. A front-face name overrides a back face (34). Writes `bridge/forge-cards.json` `{built, cards, index}` | Stack running; `node tools/build-forge-card-index.js [container=stack-forge-room-1]` |
| `tools/extract-tts-scripts.js` | `safe`, `hash` (31-multiplier string hash), `visit` (groups identical Lua+XML). Writes `_Global.lua/.xml`, one file per unique script, and `_index.json` sorted by size | `node tools/extract-tts-scripts.js <save.json> <outDir>` |
| `tools/make-test-deck-lua.js` | Fetches images (Scryfall → klrmngr, 75 per request, 150 ms apart). Builds a deck (GMNotes `testcard`, nickname `Test Player`) and a commander card. Writes Lua that spawns them on White's library and command zone and deals 7 | `node tools/make-test-deck-lua.js <presetId \| file.json> <out.lua>` |
| `tools/tts-exec.sh` | `curl POST /exec` with a file or stdin | `tools/tts-exec.sh f.lua` |
| `tools/tts-push-global.js` | Sends `{messageID:1, scriptStates:[{name:"Global", guid:"-1", script, ui}]}` to 39999 (like Save & Play) | `node tools/tts-push-global.js [save.json]` |
| `tools/tts-autoplay.js` | `exec`, `sleep`, `getState` Lua. Wraps `engineRender` to record `lastTableTurn`. Loop: keep, play a land, cast at most twice, single-option payments (exits 2 if a payment prompt repeats), multi = the first `min` options + confirm, number = min. Stops after 40 idle polls | `node tools/tts-autoplay.js [maxSteps=150] [stopAtTurn=6]` |
| `tools/tts-autoplay2.js` | `exec` (collects errors), `state` (`/state`), `check` (runs `tts-check.lua`), `drag` (calls `simDrop` to the graveyard or a random battlefield spot). Loads `tts-sim.lua`; installs the `debugTable` hook. Loop: drag lands; drag spells 70% of the time; else Pass/End turn; drag discards; first or last option when stuck. Records stuck prompts. Prints a JSON report | `node tools/tts-autoplay2.js [stopTurn=14] [maxSteps=600]` |
| `tools/tts-run-game.sh` | reset → cleanup → spawn test deck (cached in `tmp/`) → wait for deck/hand `92/7` → `engineSendDecks` → `mtg start ai N` → autoplay2 → reset → cleanup | `tools/tts-run-game.sh [deck] [stopTurn] [ai]` |
| `tools/tts-summarize.js` | Prints the header, first problem, problems, errors, stuck prompts and counts of a run report | `node tools/tts-summarize.js report.txt` |
| `tools/tts-check.lua` | Calls `engineSelfCheck` in the table script (Keeping the three aligned, below). Duplicate objects; missing or misplaced cards per zone (hand membership, playmat zone, 1.6 radius for piles and command); tap state from the rotation; leftover engine objects; life tracker vs. the engine. Returns JSON `{turn, step, active, counts, problems}` | via `tts-exec.sh`; needs the `debugTable` hook |
| `tools/tts-cleanup-test.lua` | Destroys `testcard` objects and decks made only of them | via `tts-exec.sh` |
| `tools/tts-inspect.lua` | `near`, `where` (area of an object). JSON summary: engine cards per area, samples, White life, turn colour, engine mode, White's prompt, whether the imported deck is still in the zone | via `tts-exec.sh` |
| `tools/tts-sim.lua` | `simFind(pred)`, `simHand(color)`, `simDrop(color, o, pos)` (unlock, move, call `onObjectDrop`), `simWhere(o)` | loaded by autoplay2 |
| `bridge/engine-test.js` | `loadPreset` (`NOSET` env drops set codes), `onEnvelope` (timing samples, patch apply + fingerprint check, resync), `onBoard` (turn log, stops after `--turns`), `respond`, `answer` (auto-player for every prompt type; remembers failed actions per turn), `pct`, `stats`, `finish` (CSV `latency-engine-<N>p[-full][-tag].csv`, summary, `--dump`) | `node bridge/engine-test.js [--seats 2] [--turns 8] [--deck id] [--minutes 10] [--bots N] [--tag x] [--dump f] [--full]` |
| `bridge/echo-bridge.js` | `sendToTTS`, `percentile`, `summarize`, `handle` (`ping` → `pong`; `results` → summary + `latency-echo.csv`; `hello`) | `node bridge/echo-bridge.js` (needs 39998, so not alongside bridge.js) |
| `tts/echo-test.lua` | `onLoad` (hello), `onChat` (`echotest [N]`), `nextPing`, `onExternalMessage` (pong → RTT), `finish` (percentiles, sends `results`) | paste into Global |
| `bridge/test-fake-tts.js` | Fake TTS on 48999: `hello`, `start` White + 1 AI; random answers per mode; after turn 8 prints statistics and resets; 240 s timeout | `node bridge/bridge.js --tts-in 48998 --tts-out 48999`, then `node bridge/test-fake-tts.js` |
| `bridge/test-mtg-ready.js` | Sends `decks` with a good White deck and a broken Red one, then `start` White + 1; prints chat/report/view; resets | same two-step start |
| `tts/mtg-board.lua` | M3 text board: `send` (11), `esc` (18), `list` (24), `count` (30), `seatedColors` (36, not Grey or Black), `boardText` (45), `button` (77), `promptXml` (82, number buttons min..min+20), `panelXml` (110), `render` (131, rebuilds all UI XML next frame), `answer` (143), `onMtgClick` (152), `onExternalMessage` (179: `view`, `prompt`, `chat`, `clear`), `onChat` (206: help/start/deck/decks/reset), `onPlayerChangeColor` (227), `onLoad` (229) | paste into a plain table's Global; its `start` has no `requireReady`, so preset decks are used |

Notes:
- `test-fake-tts.js`, `test-mtg-ready.js` and `mtg-board.lua` need `view` messages. The bridge sends those only when a game was started without `requireReady` (br:523).
- `mtg decks` in mtg-board sends `t:"deck"` with no deck, which lists the presets.

2026-10-25 additions:
- **Turn order** (bridge `clockwiseOrder`, relay `StartGame.seat_order`): the bridge asks the relay to seat players in TABLE_COLORS order (White, Red, Yellow, Blue), AIs in the empty colours; the relay uses the list only when it names exactly the room's players. `node bridge/seat-order-check.js --relay ws://127.0.0.1:9444 [--plain|--bad]` tests a relay on its own.
- **Hand backs** (bridge `sendTable`, Lua `engineFaceKey`): a hand card is sent with the plain back; a double-faced card gets its other face as the back once it is elsewhere, and the table replaces the object when face or back changes.
- **Token stacks** (Lua `groupTokens`, `ENGINE_GROUP_MIN` = 5, `engineGroupMembers`, `engineSplit`, `engineGroupKey`): identical tokens stack from five; clicking a stack in an attack picks every token in it; the Split box (an ability-box entry `__split:<id>`) lays a stack out for the open attack/block/target question, undone in `engineExitPrompt`.
- **Auto-pay** (manabrew `AutoPay.collectPlayableManaAbilities`): for the table's players, sources that sacrifice themselves (Treasure) sort after every other source.
- **Permissions** (`engineChat` `atTable`): any seated player switches engine mode, starts, and clears a finished game; ending a running game stays the host's.

---

## 7. Bugs and oddities (all "Bug?" items, by file)

**bridge.js** (status as of 2026-10-20; line numbers dropped, they drift. Reviews: `docs/reviews/*-bridge-2026-10-20.md`)
1. Fixed: the `hello` replay re-shows each seat's open question (`st.prompt.ui`), not the last raw prompt.
2. Fixed: relay callbacks check `game`; every relay message, TCP message and timer now runs inside `guarded()`.
3. Fixed: a non-JSON or binary relay frame is logged, not fatal (`binaryType = "arraybuffer"`).
4. Fixed: a `scry` with one zone puts every card there (answered by itself).
5. Fixed: `tappedFor` is reset on every payment answer.
6. Open: tax order comes from the object order of `commanderCasts`, not the order of the command-zone cards.
7. Fixed by a limit: games are capped at the 4 table colours (`TABLE_COLORS`); 5-8 players is PLAN M6.
8. Open: a drag to the graveyard answers any `chooseCards` prompt that includes the card, not only discards. (A yes/no
   is now answered only when it asks to sacrifice that very card.)
9. Fixed: env names use `_` (`MTG_TTS_IN`); the old hyphenated names still work.
10. Unused or stale: `stripQuery`, `Seat.ready`, the startup message's mtg-board.lua hint, the header comment.
11. Fixed: the debug port refuses requests with an `Origin` header (browsers) or a foreign `Host` (DNS rebinding);
    `/exec` itself is still unauthenticated for local tools.
- Also fixed 2026-10-20: answers are checked against the question's options (`answerProblem`); Scryfall failures back
  off and aren't cached as "no picture"; one atomic writer for the image cache; `/img` survives a dropped download;
  `/exec` replies keep their console lines after 500; a stuck TTS connection times out after 10 s.

**state-delta.js**
12. sd:43: several keyless array elements collapse into one (`""` key).

**ENGINE MODE block (make-engine-copy.js)**
13. mec:270-277: during a game, `commandersFor` would also read engine command-zone cards.
14. mec:223 duplicates er:15 (the tax-label GUIDs).

**engine-renderer.lua** (2026-10-20 review: `docs/reviews/*-table-lua-2026-10-20.md`. Fixed that day: one-pause reset
via the trash deck; game state cleared at reset (`engineGen`, per-id tables, `engineResetUi`); crash barrier in
onExternalMessage; number questions searchable over their whole range; enchanted tokens not grouped; select+pickup
counted once for every click kind; per-item auto-pace timers; labels never nil; panel picks redraw glows; whole-word
"top/bottom"; a search's library invisible to other players; outbox watchdog; dead preload code removed.)
15. er:330-339: `engineClear` leaves search/pile/library/phase-2 state behind (`engineSearch`, `engineSearchIds`, `engineChoosable`, `engineInPile`, `libraryState`, `pileState`, selection/filter, `glowing`, `menued`, `pendingBlocker`).
16. er:247-249: an aura on another player's permanent may be placed at the row start.
17. er:234-235: players without geometry are not drawn at all.
18. er:748-760: prompt kind comes from the title, so a card name starting "Pay " breaks targeting.
19. er:769-774, 817: glows and context-menu items are visible to every player.
20. er:841: Q/E attack always uses the first target in A–Z order.
21. er:807: the unused `attacker` variable; attackers are not glowed during blocks.
22. er:1179: any player who pulls a choosable card out of a pile counts as the chooser.
23. er:1030: `engineSearchIds` is one global table, so one colour's library rebuild clears another colour's search ids.
24. er:505: the table UI XML is captured once and re-applied whenever the seated colours change.
25. er:212-215: `lastTurnSet` updates even for unseated (AI) colours, so `Turns` never shows an AI's turn.
26. Unused: `renderQueued` (36), `engineColors` (written, never read), `pile` (172), the `obj` parameter of `request` (678).


### Animations and Settings (2026-10-22)

| Function | Details |
|---|---|
| `engineCombatLunge(m)` | remembers attackers and their blockers from the combat steps before damage; on the first damage-step board of a turn each attacker still on the table winds up (lift 0.9, back 0.8), moves 92% of the way onto its blocker, planeswalker/battle or the defender's `playerSpot`, and returns (0.2 s / 0.55 s); `engineAnimUntil[id]` keeps `place()` off it for 1.6 s |
| `playerSpot(color)` | the back centre of a player's board (just behind the land row, in the mana box): where attacks, attack lines and spell target lines aim at a player |
| `engineMillDetect(m)` | per board, every player: new graveyard cards that weren't public before while the library shrank are mills; `engineMillNow[color]` tells the library deck to drop that many backs without flying them; unheld ones (up to `MILL_FLY` = 5, `MILL_GAP` 0.25 s apart) get `engineMillFly` stand-ins (GMNotes `enginefx`), face down on the library turning face up onto the graveyard |
| held mills | `place()` spawns a `heldmill` card on the library face down and turns it onto its fan spot; when let go, `engineZonePile` slides the object into the graveyard pile |
| Settings | `eng_set_<colour>` opens the window's Settings tab (batch B; the `eng_setpanel_<colour>` panel is gone), whose lines call `onMtgFx` (`engineEffectsOff`: result banners, turn banner, stack pop-up visibility), `onMtgSnd` (`engineSoundOff`, for the coming sounds), `onMtgAnim` (host only, `engineSetAnimations` / `engineAnimOff`: swing, mill stand-ins and held-mill turn-over, death flash) |


### Linked and playable exile, manual fix (2026-10-23)

Needs our engine build: `stack/compose.yml` runs `mtg-forge-node:exile` and `mtg-relay:exile` (built from
`../manabrew`; the stock relay drops the `applyState` directive as an "unauthorized game envelope").

| Where | Function | Details |
|---|---|---|
| bridge | `playableOf(own, toCard)` | the exile and graveyard cards with `mayPlay` in a seat's own view (hidden ones left out); sent as the row's `playable` |
| bridge | `FIX_OPS`, `FIX_CHECK`, `fixOps(list, pub)` | each op's fields and their kinds (the engine's `StateOp`); a list from the table is refused with a reason unless every field is right; colours become slots; only known fields go on; returns `{ops, lines}` (the English list) or `{error}` |
| bridge | `onFix(m)` | `call` (refused during a rewind vote, after the game, twice) → `fixAsk` (vote of the other playing humans; none: `fixPaused`); `vote` (a no at the start ends it, a no to the list goes back to editing); `done` → `fixOps` → review vote or `fixApply`; `cancel` (not while applying) → `endFix` |
| bridge | `holdForFix(seat, prompt, gv)` | called first for every `chooseAction`: while a fix is on, a priority question with an empty stack is held unanswered (the newest replaces an older one); pausing → editing |
| bridge | `fixApply`, `fixNews`, `fixWatchdog`, `fixBackToEditing` | sends `applyState {fixId, ops}` (a new id per apply) from the held seat; the engine's `gameView.stateFix` with that id ends the fix (applied) or goes back to editing (refused); no answer in 20 s (5-second tick): back to editing; the question the apply went out on is kept until a new one comes |
| bridge | `tokenScript(text)` | a typed token → Forge's token script (`bridge/token-scripts.json`, `tools/make-token-list.js`): same colour and size, every other word in the name, fewest extra words |
| bridge | commander damage by colour | `from` a colour → that player's commander (`commanderCasts`); with partners the first takes what the others haven't dealt |
| bridge | `onRewind` | refused while a fix is on |
| table | `engineMarkSpecial(m)`, `engineWithoutSpecial(list)`, `enginePlaceSpecial(m, seen)` | which cards are playable (seated players only) or linked (exiled with a permanent still on a battlefield); those leave the piles; playable: public row in front of hand zone 2 (green glow), private (face down, foretold) inside hand zone 2; linked: half-size under the host |
| table | `engineFixHolds(m)` | first thing in `engineRender`: while editing, review or applying the board is held (kept zones merged, `lastTable` updated, panel redrawn) |
| table | `engineFixUpdate(fix)`, `engineFixPanel(fix, c)`, `onMtgFix` | the Fix... button and the panel per seat and state; entering editing unlocks the engine's cards |
| table | from the table (M7) | an aura/equipment dropped onto (within 1.3 of) another permanent → `attach`; one attached before and put down alone → `attach` without a host; right-click "Fix: top / bottom of its library" (`engineFixBottom`); the life counters (`count`) and commander-damage counters (`val`) work while editing (`ENGINE_FIX_EDIT`, read by their guarded scripts: `fixOpen` in make-engine-copy.js) and are read at Done; after the fix the life counters are set back to the engine's numbers; `mtg fix token <what> [for <colour>] [tapped]` → `createToken` |
| table | `engineFixRead()`, `engineFixWhere(o)`, `engineFixDone(color)` | Done: every touched card (picked up, turned, flipped, taken from or dropped on a pile) is read by area (`dropArea`, both hand zones); a card within 1 unit of where the table put it keeps its zone; tapped by rotation, face down by `is_face_down`, another player's mat = control; a card in no area blocks Done; plus the chat numbers (`engineFixSet`: life, poison, counters) |
| table | wrappers of `onPlayerAction`, `onObjectDrop`, `onObjectEnterContainer`, `onObjectLeaveContainer` | while editing: players in the game may pick up, turn and flip engine cards (not delete; spectators nothing); drops do nothing; a card dropped on a pile or the library is taken back out onto it |
| engine | `ManaBrewInteractiveSession.applyState` | only at a priority question with an empty stack; snapshot, stack resolving + triggers suppressed, ops (`applyStateOp`), on any failure the snapshot is restored and `stateFix {applied:false, message}`; then state-based actions and a restore point (if restore points are on); the controller asks again (`REPROMPT`) |

### Second playtest batch (2026-10-23): pictures, UI size, paging, flick containment, cost Cancel

| Where | Function | Details |
|---|---|---|
| table | `engineUiImage(u)` | a card picture the screen UI can draw for every player: a klrmngr .webp becomes `https://wsrv.nl/?url=cards.scryfall.io/normal/<side>/<a>/<b>/<id>.jpg` (TTS's UI draws no .webp; Scryfall's CDN answers TTS's user-agent with 400); anything else unchanged. The bridge's old `/img/` route reached only the host and is gone |
| table | `engineXmlCompact(xml)` | each element's look (every attribute but `id`, `visibility`, `on...` events) becomes a class `m<n>` in `<Defaults>` when two elements share it; elements with a class are left alone. 1 seat 27 KB, 2 seats 39 KB, 4 seats 57 KB (warning above 60 KB) |
| table | `updateOptions` paging, `enginePage`, `onMtgSlot` | 30 answer buttons (`POOL`); a longer list shows 29 and a **More... (a-b of n)** button that turns the page (wraps); the page belongs to one question as shown (prompt id, title, list size, search, mode) and is forgotten with the game (`engineResetUi`) |
| table | corner Cancel | a multi-choice question with `cancel` (a cost being chosen) puts Cancel on the corner's second button (`cornerPress` → `__cancel`) |
| table | `engineContainTick` (5/s), `engineContainHome(id)` | flick containment: a card you may move (`isFree` or clickable) in the battlefield, command, attached or linked zone, not held, not smooth-moving, not waiting on the engine (`engineHeld`), and 2+ units from where the board put it (`enginePlanned`): your own permanent resting on your own playmat becomes your arrangement (`engineManual`), anything else is stopped and slides back. Off during a manual fix. `engineContain.back` counts the slides; errors are caught per card and printed once |
| table | `engineTell` | the global alias of the local `tell` for code above it (`onMtgAutoResolve` called the nil local and errored) |
| table | `engineAutoChoices`, `engineAutoListXml`, `engineAutoListDraw`, `engineOnAutoState`, `onMtgAutoPick` | the Auto-resolve list: one panel `eng_autolist` shared by all seats (`visibility` = who has it open); a pick sends `autoresolve` or `skipto`, the label follows the bridge's `autostate` |
| table | `engineFriendly`, `FRIENDLY_SPOT`, `engineFriendlyLabel`, `engineSetFriendly`, `onMtgSetupFriendly` | friendly mulligans: one shared count, one button on the setup tile at the Pirate Cannon's home (-60, 0), turned 90 (`setupButton`'s `tileTurn`: real TTS mirrors a tile button's x), anyone may click; survives `engineClear`, a table reload clears it |
| bridge | `friendlyCount`, `friendlyExtra`, `friendlyFreeLeft`, `friendlyText`, `mulliganTaken`, `friendlyEnded` | friendly mulligans: `game.friendly` set at Start, `seat.mullsTaken` counted in `respond`, both in the crash-recovery snapshot |
| engine | `ManaBrewInteractiveSession.takeMulliganFree`, `ManaBrewInteractiveController.mulliganKeepHand` | friendly mulligans: the Keep answer's `free_cards` is taken off the cards a kept hand owes |
| bridge | `autoNotice(seat)` | sends `autostate` {color, phase, on} on every change, when a skip ends, and in `resendToTable`; a skip and auto-resolve are never both on |
| bridge | `chooseCards` | `cancel: input.cancellable`; the answer `__cancel` → `{type: "cancel"}` |
| engine | `choose_cards.rs`, `prompts/mod.rs` | `ChooseCardsInput.cancellable` (serde default false), `ChooseCardsOutput::Cancel`; `validate_response` refuses a Cancel the prompt didn't offer |
| engine | `HarnessCostPlumbing` frames | one frame per cost payment: reserved sacrifices, `cancellable` (spells and abilities paid through the 4-argument `payWithControllerDecision`, not mandatory, not an effect), `asking` (a cost's own card or sacrifice choice is open: the `ask` wrapper), `cancelled`; `costCancellable()` = cancellable and asking; a cancelled payment returns false |
| engine | controller `cancelledIfNull`, `playChosenSpellAbility` | a Cancel comes back from the session as `null` → `cancelPayment()`; a cast that fails undoes the mana abilities it put on the stack's undo list (`MagicStack.undo()` down to the mark taken before the cast: the lands untap, the mana leaves the pool). A full `GameSnapshot` restore was tried and dropped: it ends combat, adds stale remembered objects and keeps frozen triggers |
| engine | session `awaitCardChoice` (11 args), `awaitSacrificeChoice`, `publishSacrificePrompt` | `cancellable` on the prompt; Cancel returns `null`; a mana ability's sacrifice is still cancellable on its own (`sacrificeForMana`): mana abilities pay through the 3-argument path, which has no frame that may be cancelled |
| tests | `rules-check --game costcancel` | Fling (sacrifice) and Tormenting Voice (discard): Cancel offered; afterwards the card in hand, nothing sacrificed or discarded, the lands untapped, the pool empty (deck `test_rules_costcancel`) |


### Hand-test fix round (2026-10-26, docs/HAND-TEST-40.md)

| Where | Function | Details |
|---|---|---|
| bridge | `logSnapshot`, `logEvents` | face-down cards and spells unnamed ("a face-down card/spell"); "X is turned face up"; a card that came back says "returns to the battlefield from X's graveyard" (the graveyard's owner) or "from exile"; `day` → "It becomes day/night" |
| bridge | `isAbilityOnStack(s, pub)` | a stack item is an ability unless it is a permanent spell, or its source is in no zone and its text isn't a trigger (When/Whenever/At/As) |
| bridge | `revealCards` | a private look ("Look at", or your own library/hand without "reveal") logs only "X looked at N cards" |
| bridge | `checkDeckImages(images)`, `deadImages` | the table's deck picture links are checked (HEAD, 8 at a time); a dead one is never used; `imagesFor` skips dead, missing or card-back faces |
| bridge | `sendTable` | `day` ("day"/"night", absent otherwise) beside the turn; `tableCard` adds `cp` for a copy (`isCopy`) |
| bridge | `Seat.respond` | records `activated` (an ability: its own "Sacrifice X?" is answered yes within 30 s) and `played` (a cast or non-mana ability) |
| bridge | `payManaCost` | pays from the pool by itself when the pool covers it and the payment is for the card the player started in the last 60 s (`played`), or after auto-pay / a hand tap; anyone else's cost still asks |
| bridge | `attach` intent | equipment dropped on a creature: its Equip/Reconfigure action (regex `^([^:(]*: )?(Equip|Reconfigure)\b`); `seat.attachTo` answers the target question that follows with that creature (30 s); otherwise refused with the reason |
| bridge | "how do you play it?" / "cast it now?" | **Back** sends `refused` for the card so the table puts it back in the hand (since 2026-11-06 `askUnder`'s `returns`, see "Core moves" below) |
| bridge | `chooseBoardTargets` | the range still needed (`chosenTargets`): an optional extra target can be skipped with Done |
| table | `engineEquipTarget(color, id, obj)` | your creature within 1.6 units of a dropped Equipment (type line), nearest first; `onObjectDrop` sends `attach` |
| table | `engineStepBanner(color, t)`, `engineStepNames` | the step's banner (once per turn and step, after the turn banner, never with Auto-resolve or effects off) for a priority question, and for any question at cleanup (CLEANUP) |
| table | `engineGameOverBanner(m)`, `engineNameOf(c)` | VICTORY / X WINS / DRAW for 4 s; names are Steam names (AI names for AI seats) |
| table | `engineUpdateCorner` | the bar names Cleanup at cleanup and shows DAY / NIGHT; `engineCorner[color]` keeps the labels and when a new question changed them (`bigAt`, `smallAt`): `cornerPress` ignores a click for 0.6 s after that |
| table | `badgeParts` | a copy gets a purple COPY label at the card's lower left (`BADGE.cp`) |
| table | ability buttons | `engineAbilityButtons(o, c)` draws one object button per ability on the card (up to `ENGINE_AB_BUTTONS` = `ENGINE_AB_MAX` = 6, the panel's rows); nine-or-fewer shared click functions `engineAbBtn1..N` find the ability from the clicked card (`engineAbilityAt(obj, k, colour)` → `engineAbilityWant[id].list[k]`), ignore right-clicks, and pass the `promptId` the buttons were drawn for: `engineUseAbility(colour, optionId, promptId)` refuses another question (option ids are positions). `engineAbilityWant[id]` = `{ color, promptId, list, sig }`, `sig` the texts only (a shifted id list redraws nothing). An ability is an option with `ab`; without any `ab` in the question the label decides (not Cast / Play / Mana: / Untap). A card that left the battlefield loses its buttons; a question the table draws nothing for (`promptKind` nil) takes them all away; `engineClear` → `engineAbilityReset` (wants, panel). The screen panel: `engineAbPanelShow` on hover (`onObjectHover`, chained to the table's own), `onMtgAbPanel` |
| table | `engineSetImage(id, url)`, `engineImgWant` | a panel picture shows the card back first, then the picture 2 frames later (TTS kept an old picture) |
| table | `engineManualPlay` | a card dropped to be played: a land goes to the mana box once it is on the battlefield; any other card stays where it was dropped (2026-11-10) |
| bridge | `chooseCards` keep mode | a discard from the hand of more cards than would stay (`min = max`, `cards - min < min`) asks which to keep (`ui.keep`, `min = max = cards - min`); the answer is turned into the cards not kept. Drag-to-graveyard intents still count discards |
| table | `engineAbilityShort(text, n)` | an ability button's label: its cost and the effect's first words up to n characters, then "…"; the tooltip has the whole text. Buttons sit on the card (x 0), top down, width 1000, font 115 |
| table | `engineRender` end | runs `engineAbilityBoxes` again for an open question while `p.__abWait` (an ability's card is not one of your permanents on the table yet, or a token stack it names), so a question that arrived before its permanents (a reload) gets its buttons; unchanged lists redraw nothing. A card arriving after its question redraws that question on the next frame (`engineGlowLate`, `engineRedrawSoon`, at most once a frame) |
| table | exact picks | `engineExactPick(p)` (min = max ≥ 1): the last click answers (`engineConfirmIfComplete` from the card click, a target click, `enginePickById` for drags and pile picks), the corner counts "N of M chosen" instead of Done, the hint says so |
| table | `enginePlayerCounters(o, pl)` | the player's marks as small boxes, one a mark (`engineMarksBoxes`: the largest font that fits `ENGINE_MARKS_FIT.max`, cut past the smallest, "+n MORE" past `boxes`), buttons of the life counter (`ENGINE_COUNTERS_TIP`) stacked down the inner corner of the mat under it, in the strip the battlefield grid leaves free: `pl.allMarks`, the bridge's marks (nothing when the row has none or it isn't a list; the old fields' fallback went in trackMarks step 6); redrawn on a change or when the tracker lost them, boxes edited in place and extra ones removed; `engineCountersReset` at `engineClear` |
| bridge | seat records | `seat.note(kind, id, name, text)` / `justDid(kind, ms)` / `forget(kind)`: "activate", "manaTap" (with the cost text: the auto-yes for "Sacrifice X?" / "pay N life?" needs the cost to name it), "start" (a spell or ability started, or Pay on your own card's may-pay: the pool pays the next cost), "search" (a look at your library: the next hand gain is "puts", forgotten at a new turn), "discard" (an answer to Forge's "Discard" question: an instant reaching the graveyard is then a discard). Cancel forgets "start"/"activate" and that one play; a rewind (`checkRestored`) forgets all of them and End turn, resolve-stack, a queued play, an attach |
| bridge | game log plays | `notePlay` → `game.pendingPlays` (a land play, which Forge sends as a cast, is not one); `logEvents` says each once: from the stack (spell or ability by the player's record), from a public zone, or after priority came back (`game.saidEarly` keeps the stack from saying it again) |
| bridge | `lossReasons(gv)`, `noteOuts`, `outLast` | life, poison, 21 commander damage, for the players who lost last only (`game.outOrder`, stamped as each board shows them out). `noteOuts` also keeps, per player, where they went out (`game.outWhere` {step, active, turn}), their library on the last board that showed them playing (`game.inLibrary`), and where it was first seen empty (`game.emptyAt` {turn, step}): `deckedPlayers` says "drew from an empty library" only for a player out in their own draw step whose library was empty before that draw step. All four are in the resume file |
| table | `enginePlaceSpecial` | the public playable row: on the wood strip between the mat and the hand, `PLAYABLE_DEPTH` 12.2 along the mat's forward axis, centred on the hand, `PLAYABLE_STEP` 2.3 apart, squeezed past `PLAYABLE_SPAN` 20.7 (measured 2026-11-10: mat edge 10.38, hand counter screen from 14.07); the table check accepts a playable card within 1.6 of its planned spot; `onObjectDrop` puts a playable card dropped within 1.8 of its spot back instead of playing it |
| table | top-left row | since batch B (2026-11-10) one row at y -140: the dock `eng_dock_<c>` (Choices, Graveyards, Undo, Settings tabs and the Log switch, x 96), Auto-resolve (x 468) and Fix (x 622); the window under it (x 96, y -176); the Log panel stays top right. See "Batch B" below |

### hp-07 re-test additions (2026-10-27)
| side | name | what |
|---|---|---|
| bridge | `cardKeywords(c)` → `statusLists` → `kw`, `ow` | `kw`: keywords a card has that its own text doesn't name, in words ("Toxic 1", "Hexproof from red", "Swampwalk", "Protection from black"), plus goaded, exerted and the like. `ow`: its own always-on keywords (`ALWAYS_ON`), sent only when the card has a `kw` or is phased out. Forge's internal names left out (`NOT_KEYWORD`) |
| table | `badgeParts` `kw` | the status box: one box at the bottom edge of the art, every status, `kw` then `ow`, wrapped at 20 characters, growing up the card, PHASED OUT on top. Turned to stay upright on a tapped card. Ability buttons stay separate, above it |
| bridge | `checkRestored` | a rewind is told by the turn going down, the newest restore point going down, or a newly seen approved vote (`seat.lastApprovedVote`); it clears End turn and the records, the answers kept for the log (`game.picked`, `game.answers`, `game.sourceShields`, `game.painTaps`, `game.declaredBlocks`) and how a player it brought back went out (`outOrder`, `outWhere`), says "[MTG] Rewound to turn N (step)." in chat, logs one "--- Rewound to <player>'s turn (step) ---" line (the step in the table's words, `rewindStep`: the rewind list's own, else `STEP_WORDS`, never Forge's name such as "combatBegin") and makes the board it went back to the log's new start (`game.logPrev = null`) |
| bridge | `chooseBoardTargets` `seat.targetPicks` | the player's picks for a whole target question; Forge's one-at-a-time follow-ups for the same card are answered from them (the rest, then Done) |
| bridge | `CONFIRMS` | the "Sacrifice X" / "pay N life" auto-yes also matches Forge's bare title (no "?") |
| table | `engineLifePayOption(p)`, `engineRowUpdate` | a cost payable with life puts Auto-pay / Pay N life / Cancel in the card row; the hint names it |
| table | `onMtgRow` | a picture in the card row answers an exact pick at the last click |
| bridge | `GET /card/<name or id>` | debug: the card as the engine sends it (keywords, counters, raw fields) |
| tools | `tts-push-global.js --patched` | also pushes every object script make-engine-copy.js patched ("-- [engine copy]"); Save & Play saves the live table over its save first, so without it those patches never reach a loaded table |

### Hand tests hp-03 to hp-05 (2026-10-28, docs/HAND-TEST-HP03.md, HP04.md, HP05.md)

| Where | Function | Details |
|---|---|---|
| bridge | `logEvents` names | a battlefield card under the same id with a new name (face up both times): "X becomes Y" (transform, copy) |
| bridge | `logEvents` hand | `libLoss(o)` (what left a library, never below 0) is the one count the draw, discard-cap and mill rules use; `libToHand(o)` is that less `elsewhere[o]`, the cards that came public from nowhere (not cast, played, a token or off the stack), counted only when a graveyard/exile card of that owner left public view (`vanished`); the draw line needs it above 0 and says at most that many; `handRoom` (graveyard/exile cards said "is put into X's hand from ...") is the hand's gain less the unclamped `libToHandRaw(o)` |
| bridge | `logEvents` order | a stack ability with no record of the player's (a trigger, or an AI's) seen beside a battlefield entry is said after the entries (`afterEntries`); a discard by the last turn's active player seen with a new turn goes before the turn's line |
| bridge | `logSnapshot` stack | `upkeepCost`: echo ("X's echo: pay its echo cost, or it is sacrificed") and cumulative upkeep by its cost ("pay {1}" for mana, "pay 2 life" otherwise; with or without the reminder) |
| bridge | `cardLabel` | counters in words: `counterWords(k)` or "k counter", plural past 1 ("[1 +1/+1 counter, 3 burden counters]") |
| bridge | `purposeOf` | crew ("tap which creatures to crew it (total power N or more)?"), "a X card from among them and put it into your hand", and the put rule with a count, "from among them" and a "with ..." clause (Kodama: "put which permanent card onto the battlefield?") |
| bridge | target title "fit" | of several target sentences, the one the candidates fit (all yours: "you control"; all not yours: "you don't control" / "an opponent controls") |
| bridge | `chooseCards` toOutput | a pick from your own library notes "search" when made, so the card into the hand next is put, not drawn |

### Hand tests hp-09 to hp-13 (2026-10-29, docs/HAND-TEST-HP09.md, HP10.md, HP11.md, HP13.md)

| Where | Function | Details |
|---|---|---|
| bridge | `FORGE_STEPS`, `forgeStepWords(desc, ctx)` | a card pick's title (and note) from Forge's description, one entry each, first answer wins: "Select N cards to X", Learn's "Reveal a Lesson card" (discard to draw), "Collect evidence N", "Behold", "Choose cards to manifest" (manifest dread), "X for cost" (the card's cost line and its keyword: escape, station) |
| bridge | `searchTheCardsFit(words, cards, max)` | of several "search your library for ..." sentences, the one whose kind (type/supertype/subtype words, "X or Y") every offered card is; null unless exactly one |
| bridge | `keywordOnly(text)` | a cast way's keyword + cost with only its reminder ("Sneak {1}{B} (...)"): the card's own text is read instead for a library look or pick |
| bridge | `keywordLine(kind, ctl, name)` | a player's keyword activation by its keyword, stack seen or not: foretells / levels up / suspends, unearths, crews, saddles; a morph/megamorph/disguise turn (record "faceup") says nothing beside "is turned face up"; any record but a cast is an ability on the stack |
| bridge | `onPrompt` `srcCardText` | the asking card's rules text, from the prompt or the board ("" when neither) |
| bridge | `logSnapshot` | `step`; `merged` (mutate's mergedCardIds); `rebound`; a spell on the stack keyed by its card (`id|spell`), an ability by its text |
| bridge | `logEvents` order | a draw seen with a nonland entry past the draw step of the same turn is said after the entries (`drawAfter`) |
| bridge | `logEvents` lines | "X mutates onto/under Y"; "is exiled with rebound: ... may cast it at their next upkeep"; cards exiled from one graveyard together, one line; "puts a card onto the battlefield face down" / "A face-down creature enters"; arrivals "with N +1/+1 counters"; a nontoken permanent gone while its owner's hand gained a card (counting cards cast or played from the hand, a new spell on the stack included) "returns to X's hand"; a card off the stack known by its id too (a split card's half) |
| bridge | target titles | a mutating spell's own target while not on the battlefield: "mutate onto which ...?"; Bargain's sacrifice while cast: "sacrifice which artifact, enchantment or token (bargain)?" |
| bridge | `chooseCards` | cards all in the hand or all in your library take the sentences that say so first (`zoneSaid`); the put rule takes "up to N/X ... cards" and "with ..." |
| bridge | `revealCards` | discover/cascade: "discover N: cards exiled from the top of your library" |
| bridge | `chooseBoolean` | after yes to "you may cast X without paying its mana cost", Forge's "Do you want to play X?" answers itself (30 s, `freeCast`); a free cast question says so ("Put in hand" when that is the alternative); Devour and Exploit's bare "Do you want to sacrifice?" said by keyword |
| bridge | `reorder` | an "exile all" order over permanents is kept without asking |
| bridge | `whyNot` | a permanent on the battlefield: "none of its abilities can be used right now" (+ the mana-ability hint) |
| bridge | `withoutForgeNotes` | drops Forge's " (Original)" tag |

### Hand tests hp-14 to hp-17 (2026-10-29, docs/HAND-TEST-HP14.md to HP17.md)

| Where | Function | Details |
|---|---|---|
| bridge | `KEYWORD_YESNO`, `keywordYesNo(ctx)` | a yes/no Forge words without its keyword, said by it: Extort ("extort: pay {W/B}?"), Devour, Exploit, Dredge ("dredge N instead of drawing?" Dredge / Draw); first answer wins |
| bridge | `chooseBoolean` | Fabricate's "Pay Put a +1/+1 counter ...?" as "fabricate N: a +1/+1 counter on it, or a 1/1 Servo token?"; a cascade/discover hit's bare "Do you want to play X?" (30 s after the reveal, `exiledHit`) as a free cast; "Pay {..}" on your own card's question starts the payment (from the pool) |
| bridge | target titles | Strive's extra cost per target as a note; Support N ("which (other) creatures get a +1/+1 counter?"); Awaken N; Bargain's sacrifice |
| bridge | `chooseFromSelection` | Assist's helper among the players: "assist: ask which player to pay up to {N} of it?" |
| bridge | `FORGE_STEPS` | + Cipher's "Choose a creature you control to encode" |
| bridge | `revealCards` | cascade by Forge's "Cascade - <card>"; Hideaway's look answers itself (its pick shows the cards) |
| bridge | ways | a split card's whole cast "Cast both halves (fuse)"; "(MTMtE)" spelled out |
| bridge | `isAbilityOnStack` | Forge's "<Keyword> - <card>" trigger text is an ability (a cascade trigger is no second cast) |
| bridge | `logEvents` | a second of one card's spell on the stack: "copies"; a land play's record stays a play while its land's trigger is on the stack; a card whose ability its owner used from the hand, into the graveyard: "discards"; mills over six cards by count ("mills 46 cards: Swamp ×42, ..."); the mill's drawn count capped by what left the library for the hand (dredge); every line starts with a capital |

### Hand tests hp-18 to hp-21 (2026-10-29, docs/HAND-TEST-HP18.md to HP21.md)

| Where | Function | Details |
|---|---|---|
| bridge | `KEYWORD_TARGETS` | a target question said by the card's keyword, every entry in turn: Awaken N (over a purpose read from its reminder), Support N, Strive's note, Bargain's sacrifice |
| bridge | `chooseBoolean` | Riot's "Pay Put a +1/+1 counter on X?" (card with Riot, otherwise haste): "riot: a +1/+1 counter, or haste?" |
| bridge | `otherwiseText(seat, input, card, src)` | a sentence about the asking card stays as it is ("No: Spider-Punk gains haste") |
| bridge | `chooseFromSelection` | a played/cast card's own enter effects' order (every option says "enters") answered without asking; "Choose a Protection" as "protection from which color?" |
| bridge | `chooseNumber` | a 0-to-1 number whose title is a question is a yes/no; Harmonize's "Choose power of creature to tap"; Read ahead's "How many counters?" as "start on which chapter?" |
| bridge | target titles | a modal spell's chosen modes (Forge's text after the list and a blank line) as the target's words; the one-target sentence rule up to 130 characters |
| bridge | `chooseCards` | Amplify's "Choose cards" from the hand: "amplify N: reveal which X cards from your hand?" |
| bridge | `logSnapshot` / `logEvents` | `phasing` (keyword); a phasing card gone from the view "phases out", back "phases in" (`game.phasedOut`); a land arriving "with N +1/+1 counters" |

### Hand tests hp-08, hp-23, hp-24, hp-26 (2026-10-29, docs/HAND-TEST-HP08.md, HP23.md, HP24.md, HP26.md)

| Where | Function | Details |
|---|---|---|
| bridge | `tableCard` | a card that ventures or takes the initiative asks for every dungeon's picture ahead (`DUNGEON_NAMES`; a dungeon is in no deck) (hp-08) |
| bridge | `withoutForgeNotes` | any "[Name: ...]" note left out, one bracket deep, and one cut short with no "]" ("[Room: ...]", "[Card: X, Activator: ...]") (hp-08) |
| bridge | `purposeOf` | Ninjutsu's cost: "return which unblocked attacker to your hand?"; Sweep's "return any number of X you control to their owner's hand" (hp-08, hp-23) |
| bridge | `chooseFromSelection` | venture: "venture into which dungeon?" and "<dungeon>: which room next?"; Abundance's Land/Nonland, asked under the drawing card: "Abundance: reveal until a land or a nonland card?" (notes `revealInstead` with the asking card) (hp-08, hp-26) |
| bridge | `scry` | nothing to look at answers itself; each answer said: "White scries N: K cards on the bottom" / "all on top" (scry only) (hp-08, hp-26) |
| bridge | `chooseNumber` | Join forces: "join forces: pay how much mana?" with the shared draw under it (hp-23) |
| bridge | `logEvents` | a land token "creates"; a trigger (When/Whenever/At, not the player's own record) "X's ability triggers (White)"; a permanent its own ability puts on top of its owner's library (by the record, or by its ability's stack ids gone) "is put on top of X's library", the draw counted (hp-23, hp-26) |
| bridge | `FORGE_STEPS` | Fateseal's "Choose card(s) to put on the bottom of X library": "put which cards on the bottom of AI 1's library?" (hp-24) |
| bridge | `revealCards` | after `revealInstead`, the asking card's look is that card's reveal: "Abundance: revealed until a nonland card", named in the log, the card into the hand not a draw (hp-26) |
| bridge | `chooseCards` | a library pick put on top ("reveal it, then shuffle and put th(at\|e) card on top"): "White reveals X, shuffles and puts it on top of their library", unrevealed "puts a card on top"; Brainstorm's cards from the hand: `sayPutOnTop`; Scroll Rack: "exile which cards face down?"; Sylvan Library's card back: `sayPutOnTop` (hp-26) |
| bridge | `chooseBoolean` | `OPTIONAL_ASK` (Forge's "Use triggered ability of X?" / "Apply replacement effect of X?"): Yes notes `mayYes` with the "you may" words; the same card's next yes/no whose words are all in them is answered yes (Sylvan Library's "Draw two Cards") (hp-26) |
| bridge | `gameLogLine(line)` | one line to `game.log` (kept for a table reload) and the table's log panel |
| bridge | `logEvents` `resolved` | the one list of what left the stack and wasn't countered, one entry per stack entry with `gone` (how many of its items left) and the targets of those items (`tgBy`, per stack id); read by `damageNews`, `unlessNews`, `tapNews`, the counterspell-fizzle line, suspect, goad and detain. `unseen`: what resolved with no board showing it on the stack (the player's own targeted trigger, a spell reaching a graveyard), for suspect, goad and detain only (Kykar hand test) |
| bridge | `damageNews(prev, cur, resolved, facts)` | `{ lines, loss, gain }`, said only where certain (a wrong source is worse than none): combat damage of each unblocked attacker still on the battlefield at the player Forge's `attackTargetId` names (unblocked only once the blocks are known: the board before is at declare blockers or later, and the blocks are either board's or the ones a player declared this turn, `game.declaredBlocks`), for each damage step crossed (double strike twice), and its lifelink; a resolved item whose words say "<its name> deals N damage" once, with no "divided": N at its targets (Forge's, or the player's picks; none known, nothing) and at "each opponent/player" per item. A creature's line only with no combat damage step crossed: one item at it (its marked-damage rise), items of fixed amounts summing to the rise, or a target of one item gone to its graveyard after the spell by Forge's order with no other cause. A source chosen for Reflect Damage's redirect or a Circle's / Deflecting Palm's prevention (`game.sourceShields`, exact kinds only, the chooser's, this turn, used once) is said only when the life totals show it; Deflecting Palm's damage back in combat only while the attacker's power is the same on both boards. The life line shows the parts only when they add up to the change (`lifeWords`); a loss nothing explains stays bare |
| bridge | `unlessNews(prev, cur, resolved, facts)` | "unless that player pays" / "you may pay ... If you do" outcomes, only when certain: the payer's own "Pay {X}?" answers (`game.answers`, real true/false only, all of that card's items answered; for a draw-only trigger checked against the draws Forge says it caused, and with no feed for the window a "you may pay" yes only when the payer's hand grew), else only for a trigger whose sole effect is a draw, told by the draws Forge says it caused (`facts.drawsBy`); an optional draw's "no" answers by its controller. {X} is the source's power only for "where X is <its name>'s power". Extort, Soul Barrier, Chancellor of the Annex and any other effect: nothing said. No feed for the window and no answer: nothing. The payer of an "unless" is Forge's "Activator" |
| bridge | `tapNews(prev, cur, resolved)` | "X taps/untaps Y" by a resolved tap ability's targets; "X becomes a creature"; each keyword gained said with the resolved item whose words name it and that could give it ("target": its known targets; "you control": its controller's), "gains vigilance, double strike (Akroma's Will)"; one named by none is not said |
| bridge | `notePain(seat, act, card)` | a pain land tapped for a painful colour, the amount its pay button says (`manaPainDamage`, shared with `manaPainText`: the line that adds that colour and says "deals N damage to you", none under an "if/unless/as long as"): `game.painTaps`, named on that player's loss on the first logged board that shows the land tapped only; a board from before the tap keeps it (10 s), one without the land drops it |
| bridge | `Seat.respond` notes | target picks by source with the words they were asked for (`game.picked` {ids, text}: "casts Counterspell targeting Marble Diamond", used only for a stack item with those words; a follow-up pick adds; a cancel, or `notePlay` of a new cast, forgets them), "Choose a source" said and kept (`game.sourceShields`), each yes/no to a "Pay" or a "may" kept per card (`game.answers`), the attackers a player blocked this turn (`game.declaredBlocks`); picks and answers last 60 s (`ANSWER_MS`, `fresh`) for every reader |
| bridge | `logEvents` `activationLine` | an equip "White equips Spirit token with Skullclamp"; a loyalty ability "activates Ral Zarek's -2 (loyalty 4 -> 2) targeting Hill Giant" (Forge's counter key is "Loyalty"; the loyalty part only when both boards show it); else "uses X's ability targeting Y"; "is countered by X" (`counteredBy`) |
| table | engine hand guard | a card of the table's own in its owner's second hand zone is no "another player's hand" (a scry's card laid there) (hp-08) |

### Engine events (2026-11-02, Forge's own record of what moved)
Our image of Forge sends `gameView.events`: the last 256 zone moves, each `{ id, seq, cardId?, from, to, ownerId, how? }`. `how` is what no board shows: `draw`, `played`, `sacrificed`, `destroyed`, `surveil`, `discard`. `cardId` is left out when the move is hidden from that seat. The Rust engine and older Forge images send `[]`.
| side | name | what |
|---|---|---|
| bridge | `engineFacts(events)` | the moves since `game.eventSeq`, as `{ moves, draws, tutors, mills }`. Null means "no facts": the first board, an empty list, or a gap (the ring moved past the last one read). `logEvents` then falls back to working it out from the two boards, as it always did |
| bridge | `logEvents(prev, cur, pub, facts)` | where `facts.moves` has a card, that decides the line (`moved`, `gone`, `landPlayed`, `toHand`); the board guesses run only without one |
| bridge | `updateLog` | reads `engineFacts` before its first-board return, so a rewind's board moves the place on and what came before it isn't told after it |
| Forge | `EngineEventLog` | the Guava subscriber that fills the ring. `isPublic` decides `cardId`. A move onto a graveyard reads `sacrificed` from Forge's event and `destroyed` from `card.wasDestroyed()` |
| relay | `state_delta.rs` `element_key` | needs a string `id`, which is why each event has `event-<seq>`: without it the whole ring went out on every change |

### Keeping the three aligned (2026-11-02)

The bridge, the table script and the engine are built and started apart, and each works alone. These keep them together.
None of it shows at the table except the out-of-step warning, and nothing here can stop a game.

| where | what | does |
|---|---|---|
| `bridge/versions.js` | `outOfStep`, `waiting`, `containerImages`, `fileHash`, `bridgeHash` | compares what is running with `stack/deployed.json`: the bridge's loaded code (`bridge.js` and the files of ours it loads), the stamp the table sends with its hello, each check and Start, the images of `stack-forge-room-1` and `stack-relay-1`. `waiting` lists source edited since the deploy |
| `bridge/bridge.js` | `warnIfOutOfStep`, `GET /versions` | warns in chat on a hello and on Start, real bridge only. `/versions` shows the same, plus the check and guess counts (`alignment`) |
| `tools/deploy.js` | `mustBeIdle`, `bridgeCameUp`, `livePassed` | refuses during a game or with TTS open, and asks again before each step that would land on a game. Dry-runs the save patch, runs the gates, plays `test_table_check` on the script going out, with `--image <tag>` live-tests and swaps the engine (a live test passes only on its own `PASSED:` line), restarts the bridge and waits for the new code to answer, patches the save, writes the manifest. A failure after the engine swap leaves the old record, so `/versions` shows what moved |
| `tools/patch-save.js` | `patch`, `hunks`, `heldBy`, `unheld`, `rewrite`, `ttsRunning` | brings the save's script up to a fresh build line by line, except hunks matching `tools/deploy-holds.json` (empty since 2026-11-06, when the Auto-resolve dropdown came back to the table; it held the dropdown before), then stamps it. A hunk is held whole, so the dry run prints lines the hold doesn't name. Default is a dry run; the result must load on the fake TTS before it is written; `rewrite` replaces the script's text and no other byte |
| `tools/engine-renderer.lua` | `engineSelfCheck` | the table's own check, moved here from `tools/tts-check.lua`, which now only calls it. New: `badges`, `attack`, `attackLine`, `hoverName`, `hoverText`. Not faults: held untaps and mills, a card moving or in a hand, a scry's cards, cards playable from a library's top, a foretold card named from another seat's view. Counters are read through the badges |
| `tools/engine-renderer.lua` | `engineCheckDue`, `engineCheckRun` | asked for once as a turn starts and once when attackers are declared, run 3 s later on the newest board. A problem must still be there 2 s on, since a board can change mid-check. A finished game isn't checked. Sent as `check` |
| `tools/engine-renderer.lua` | `engineStamp` | "dev" in source, the script's hash in the save |
| `bridge/bridge.js` | `noteCheck` | counts and appends to `tmp/table-check.log`; no chat |
| `bridge/bridge.js` | `noteGuess` | the log worked something out while the feed was on: `no feed` (once a game), `feed gap`, `arrival`, `departure`. To `tmp/guess-log.log` |
| `bridge/bridge.js` | `tableCard(c, blockers, active)`, `loreOf` | new status box lines: Summoning sick (a creature, its controller's turn, on the battlefield; a token's status keeps it out of a stack, `engineTokenKey`), Crewed, Bestowed, Ring-bearer, Chapter N of M, Level N. `active` is passed only for battlefield cards, because Forge calls a creature card sick in hand too |
| `tools/engine-renderer.lua` | `description`, `COMES_BACK` | a linked exile card that returns says so in its hover text; `rl` was sent and read by nothing, though the map said otherwise |

`tests/test_alignment.js` and `tests/test_table_check.js` hold these. The second runs the check on every 10th board of two
recorded games, quiet, then breaks the table one way per `map:` line, and fails if a new line has no case. `docs/spec-own-engine.md` is the separate plan for dropping the bridge and Forge.

### Table-map gaps filled (2026-11-03)

Every fact Forge sends about a card or a player that the table showed nowhere (`node tests/test_table_map.js --gaps`).

| File | Function | What it does |
|---|---|---|
| `bridge/bridge.js` | `tableCard(c, blockers, active, zone)` | `zone` is "battlefield", "graveyard" or "exile" (absent for hand, command, stack). New status box lines: the next Saga chapter (`nextChapter`), the next Class level's cost (`nextLevel`), "Dies in this combat as it stands" (Forge's `wouldDieInCombat`, attackers and blockers only), "Owned by X" on the battlefield, and what a permanent chose (`choiceWords`) |
| `bridge/bridge.js` | `cardNotes`, `keywordCostText` | `nt`: flashback in a graveyard; madness, warp and plot in exile; counters in exile only. A cost as the card prints it, else Forge's mana string as symbols, else none ("Has flashback") |
| `bridge/bridge.js` | `choiceWords`, `game.choiceViews` | a choice is said only when every seated player's view has it, since the table is drawn the same for everyone and a secret choice reaches only some views |
| `bridge/bridge.js` | `playerMarks(p, pub)` | `allMarks` on the player row, the whole label from `PLAYER_MARKS` / `trackMarks`: poison, energy and the other counters, the monarch, the initiative, the city's blessing, an enduring story, the Ring's temptations, speed, a turn run by someone else, an extra turn (while it is theirs), prevention shields, a hand size other than 7, the player's keywords (see "Core moves" below) |
| `bridge/table-map.js` | `PLAYER_FACTS` | every `PlayerDto` field: shown, or why not |
| `tools/engine-renderer.lua` | `description` | a card's `nt` lines in its hover text |
| `tools/engine-renderer.lua` | `enginePileNotes`, `enginePileDescribe` | a graveyard or exile pile deck's hover text lists its cards' notes, newest first; set again when only the notes change (a suspended card's time counters), without rebuilding the pile |
| `tools/engine-renderer.lua` | `enginePlayerCounters` | draws `pl.allMarks`; the label is sized to its letters |

Pinned by bridge scenarios "table: what a card in a graveyard or exile can still do", "table: sagas, classes, combat deaths and owners", "table: choices are said only when every seat sees them", "table: player marks", and the last steps of the 1v1 table game ("notes: ...").

### Keyword sweep (2026-11-03, PLAN "The next 1½–2 days" item 3)

| Where | Function | Details |
|---|---|---|
| bridge | `KEYWORD_WORDS`, `keywordKind(way)`, `keywordLine` | one table of activated keywords and their lines; `keywordKind` reads an action's words or a stack item's text ("Unearth {U} (...)") by it, cycling by its own pattern, else "faceup" / "ability" |
| bridge | `isAbilityOnStack` | a keyword activation's text is an ability wherever its card is (another player's transmute from a hidden hand) |
| bridge | `logSnapshot` `kwTrigger` | a keyword with its reminder straight after it and no cost ("Evoke (...)", "Paradigm (...)") is that keyword's trigger |
| bridge | `notePlay`, `castFrom(zone, card)` | one lookup of the card; a cast says where from: the top of the library, exile, a graveyard by retrace or jump-start ("(retrace)"), else "from their graveyard"; an ability keeps its plain name |
| bridge | `logEvents` stack | an item seen before under its own stack id is not new (Forge never reuses one); another player's keyword activation by its stack text; an early line of any kind but a cast hides its card's next stack item |
| bridge | `logEvents` buyback | a spell from the stack to a hand: "returns to X's hand", "(buyback)" when the move has no cause and the engine names causes (`game.feedCauses`, set in `engineFacts`) |
| bridge | `engineFacts` `offStack`, `takenOffStack(offStack, prevSpellOf, cards, pubIndex)` | (2026-11-06, kw-14 / kw-20 and their suite review) `offStack`: every card that left the stack, in Forge's order, `{ id, to, owner }`. `takenOffStack` -> card id -> `{ how: "counter" or "return", by }`: what a spell no board showed on the stack took off it, by Forge's order (a spell's targets move as it resolves, the spell itself after them). The taker is an instant or sorcery gone to a graveyard or exile, with "counter target ... spell" and no "unless", or "return target spell"; a seen one has its targets, one itself taken off took nothing. It takes the 1 to n cards just before it, and stops at one that resolved onto the battlefield, for "return" at one not in a hand, for an AI's taker at a spell its own team controls (Forge's CounterAi, ChangeZoneAi), and for a counter of abilities (Disallow) at one no board showed |
| bridge | `logEvents` countered | a spell another took off: "is countered", "is countered and exiled", "is countered and returns to X's hand", "is countered and returns to the command zone", "is countered and put on top of / on the bottom of / into X's library" (by the counter's words: Memory Lapse, Spell Crumple, Hinder), after the taker's "casts" line when no board showed it (`later`, `sayAfter`); with a new turn, one seen on the last board's stack and its taker go above the header. A spell cast another way (`castWayOnly`: cleave, web-slinging) counters by its card's text, not Forge's stack words |
| bridge | `COST_KEYWORDS` | + embalm, eternalize, encore, scavenge, transmute, reinforce |
| bridge | `OPTIONAL_COST_WORDS`, `optionalWords(opt)` | a cast's extra costs from the stack item's `optionalCosts` (Forge's OptionalCost names): "(kicked)", "(kicked twice)", "(entwined)", "(bargained)", "(gift promised)"; retrace, jump-start and buyback are said elsewhere (2026-11-04) |
| bridge | `logSnapshot` | a spell still being cast (`isCasting`) is left out until it lands, so its line carries the costs chosen during the cast; a retrace spell mid-cast no longer looks like an ability (2026-11-04) |
| bridge | `logSnapshot` `kwTrigger` | + a keyword with a cost whose reminder is a cost paid while casting ("Offspring {2} (You may pay an additional ...", squad) is that keyword's trigger |
| bridge | `KEYWORD_WORDS` reinforce, `notePlay` prototype | "White reinforces with Mosquito Guard"; a cast whose label ends "(Prototype)" says "(prototype)" |
| harness | `InteractiveSnapshotExtractor.putOptionalCosts`, `ManaBrewInteractiveSession` | stack items carry `optionalCosts` (`StackObjectDto.optional_costs`); a prototype cast's action label ends "(Prototype)". Node image `mtg-forge-node:optcost` |
| `tests/live_events_check.js` | `--sweep <file>`, `--dump <file>` | plays `tests/keyword-sweep.json` (from `tools/keyword-sweep/pick.js`); the log replay is fed each seat's own actions through `notePlay`; must-attack creatures attack, casualty pays, triggers keep their order, a step is done once its spell was on the stack |
| `tools/live-check.sh` | `LIVE_STACK=<n>` | stack n: containers `mtg-test-relay-n` / `mtg-test-node-n`, port 9444+n, log `tmp/live-<check>-<tag>-n.log`, so two checks run at once; stack 0 keeps the old names; the check gets `--relay` |

Pinned by the bridge events checks "stack: ...", "cost: ...", "cast: ..." and the golden scenario "log: a cast said early leaves its card's enter trigger to be said".

### Core moves: askUnder and trackMarks, bridge half (2026-11-06, docs/core-moves/askunder.md, trackmarks.md)

| Where | Function | Details |
|---|---|---|
| bridge | `askUnder(seat, ui, pick, { back, returns })` | a question of the bridge's own under the open engine question: "how do you play it?", "cast it now?" (`onIntent` play), "which ability?", "which mana?" (`onIntent` tapmana), the "Mana: tap X" colour (`manaChoice`). Adds the option `__back` (label `back`: "Back", "Wait (keep it)" or "Cancel") last, runs `prepareUi`, keeps the question underneath in `seat.prompt.under = { ui, toOutput, step, returns }`, sends the sub-question with a new step. `__back`: `refused` for `returns`, then the question underneath is re-sent exactly as first sent (its ui, its step), `under` is null again. Any other option: `pick(picks)` is the engine's answer. Returns `ASKED` |
| bridge | `ASKED` | what a `toOutput` returns once it has asked a sub-question itself or taken its way back; `onAnswer` then sends nothing |
| bridge | `timeoutChoice(ui)` | `ui.onTimeout` first, then `__back`, then `__pass`, `keep`, `__cancel`, ...: a timed-out sub-question goes back, then the priority question passes |
| bridge | `closePrompt(seat, answered)` | sends `refused` for an open sub-question's card unless `answered` (only `onAnswer`'s last line passes it: the sub-question's own option was taken, so the card goes ahead) |
| bridge | `onPrompt` (first line) | a new engine question while a sub-question is open closes it (`closePrompt`): its card goes back and the panel is cleared, even when the bridge answers the new question itself (End turn); a late Back or Pass on the old id is then ignored |
| bridge | `checkRestored` | a rewind while a sub-question is open closes it the same way |
| bridge | `onIntent` (first rule) | while a sub-question is open, every gesture is refused: "X stays: answer "<question>" first (or Back)." The open question stays; nothing reaches the engine |
| bridge | `PLAYER_MARKS` | one row per mark under a player's life total: `key`, `read(p, pub)`, `label(value, at)` (a list for keywords), optional `say(who, now, was, at)` (the log line: poison, energy, monarch, initiative, blessing, story, and since step 7 the Ring, speed and another player in control); `at` is whose turn another player runs (`turnRuns`), read by `controlledBy` only: a turn's control is "TURN RUN BY X" / "X takes control of Y's turn" / "X's control of Y's turn ends", any other (Opposition Agent's search, a spell cast under another's control) "CONTROLLED BY X" / "X controls Y for now" / "X no longer controls Y". Row order = label order: poison, energy, monarch, initiative, blessing, story, experience, rad, tickets, Ring, speed, controlled by, extra turn, prevent, hand size, keywords |
| bridge | `positive(n)`, `counterOf(name)` | a number mark (the counters, the Ring, speed, prevention) is a positive number or 0: a "0", "3", true or -1 is 0, so the label and the log agree |
| bridge | `trackMarks(p, pub, at)` | `{ values: key -> value, labels: the whole label in order }`; a value of 0, false, null, "" or [] shows nothing (`markShown`); `at` goes to each `label` |
| bridge | `playerMarks(p, pub)` | the row's mark field: `allMarks` (left out when empty), with `at.turnRun` from `game.logPrev` (updateLog has just read the board); and each `PLAYER_MARKS` row that names a `row` key sent under it when it shows something (`extraTurns`, Forge's `extraTurnCount`, drawn as a badge beside the life counter). The old fields (`poison`, `energy`, `monarch`, `initiative`, `blessed`, `story`, `marks`) went in trackMarks step 6 |
| bridge | `logSnapshot(pub, prev)` `marks`, `turnRun` | `marks`: `{ playerId: trackMarks values }`; `logEvents` says each row's `say` in row order, only when the earlier board has that player and the value changed; the venture rooms after the marks. `turnRun`: `turnRuns(prev, marks, pub)` |
| bridge | `turnRuns(prev, marks, pub)` | `{ playerId: controller }` for a control that is a turn's: one a board shows on the active player with an empty stack (Forge's ControlPlayerEffect hands a turn over as it begins), kept while `prev.turnRun` has the same controller. Forge's other controls (Opposition Agent: ChangeZoneEffect, ChooseCardEffect; a spell cast under another's control: PlayEffect, MagicStack) last only while an ability resolves, which Forge keeps on the stack |
| bridge | `extraTurn(cur)` | the turn header's "(extra turn)": exactly when the active player's `extraTurn` value in `cur.marks` is true (Forge's `isExtraTurn`, read once, by the row); no guess from turn order since trackMarks step 7, a board without the flag is a plain turn |
| bridge | `sendView` | the text board's `poison` from `trackMarks` |

Pinned by the bridge golden's "askUnder: ...", "review askUnder: ...", "trackMarks: ...", "review trackMarks: ..." and "table: player marks" scenarios, and by `tests/test_bridge_claims.js` (Back re-sends the question as it was, for A to E; every gesture in `bridge/table-map.js` GESTURES is refused while a sub-question is open; poison's label and log agree for every pair of nine values; the header's "(extra turn)" for 20 flag and turn-order combinations; the Ring and speed lines for every pair of values; `turnRun` and the control line for every chain of three boards of controller, active player, stack and priority, and the label for 128 of them; Opposition Agent's shapes in the golden).

### Core moves: engineCardEntry and trackMarks, table half (2026-11-06, docs/core-moves/cardentry.md, trackmarks.md)

| Where | Function | Details |
|---|---|---|
| table | `engineCardEntry(id, obj, c, opts)` (global) | the one way an object becomes engine card `id`'s object: `place`'s spawn callback (`c` = the board's card, `opts.zone`, `opts.lock`) and every take-over with `c` nil (a search card pulled out of the library, a card the table takes out of a pile, a pile pick, a pile's remainder). Sets `engineObjs`, clears `engineSpawning`, records `engineFace` (from `c`, else `engineStatic`), clears `engineInPile` for a taken card only, stamps `engineHeld` for `opts.held`, resets `engineBadge` and `engineStackGlow`; a spawned card gets its badges, its lock and half size when attached or linked; then `engineGlowLate` |
| table | `engineSpawnStale(gen, obj, id)` (global) | true for a spawn callback from an earlier game (`gen` ≠ `engineGen`, "mtg reset" while it spawned): the caller touches nothing; an object the reset's sweep missed (still `engine:<id>`) goes to the trash. Used by `place` and `engineLibraryDeck` |
| table | `enginePileRemainder(id, deck)` (global) | a pile deck taken down to one card (TTS's `deck.remainder`): the card left becomes that card's object (only an engine card), the pile's object and state are cleared, returns true. After `engineTakeFromPiles` and a pile pick |
| table | `engineCardData(c, how)` | the one data builder: nil, "inside", "search" (see 4.5) |
| table | `addToPile` | a card with no object joining a pile is spawned as `engineCardData(c, "inside")` |
| table | `engineLibraryDeck` libAdd | cards added to a plain library go in as one object (4.5) |
| table | `sweepEngineCards` | also a stray deck of nothing but `libcard`s (4.5) |
| table | `enginePlayerCounters(o, pl)` | `pl.allMarks` when it is a table; anything else (no `allMarks`, an empty one, one that isn't a list, the old six fields and `marks`) draws nothing (the fallback went in trackMarks step 6) |

Pinned by the table golden's "card entry: every way a card object is made" game (sections 1-6, its "ce: ..." reports) and the last steps of the 1v1 game ("marks: ..."), and by `tests/test_table_claims.js` (the engineCardEntry, libAdd, sweep, remainder, "one way" and trackMarks checks). The golden's fake TTS merges a deck put into a deck, as TTS does (`withDeckMerge` in `tests/golden/table-run.js`).

### Batch B: engine screen UI cleanup, tabs and the ability panel (2026-11-10, docs/engine-ui-spec.md)
| side | name | what |
|---|---|---|
| table | `ENGINE_THEME` | the engine UI's colours, from the table's own buttons: window #161616F0, button #262626, dock #1A1A1A, tab on #3A3022 with gold #FFD27A, muted #1C1C1C with #8C9199 text; second level #333333 (More..., X) |
| table | `setButton(id, attrs)`, `engineBtnLook`, `engineRecordButtons(xml)`, `engineFlipColor(key, hex)` | every call on a Button that doesn't only hide it carries `color` (as last set, else the XML's, recorded by `engineRecordButtons` at build) and a `textColor` that alternates between two that look the same: TTS redraws a Button at every set, dark label without a new text colour, white without a colour of its own (the grey ability panel with black text, the dim Auto-resolve, Scoop's dark-red label). `isButton(id)` = recorded in `engineBtnLook` |
| table | tool covers removed | `engineToolCoverXml` and `eng_cover_1..3` are gone (measured on one screen, they floated as black boxes on others); `engineScoopRedraw` sets Scoop through `setAttr` |
| table | `updatePanel` log | the log panel shows only once the log has a line; `engineOnLog` redraws the panels when it goes from empty to not |
| table | the dock and the window | `panelXml`: `eng_dock_<c>` with the tabs; `engineOpenTab`, `engineSidePrompt`, `ENGINE_TABS`; `engineBrowse[c]` is the open side tab ("browse", "undo", "settings"); `optionColor` reads an option's `tint`; `updateOptions` hides the search for `nosearch` lists |
| table | removed | `eng_pace_<c>` (now the Settings line "Draw / mill / untap by itself"), `eng_setpanel_<c>` with `eng_fx_/eng_snd_/eng_anim_<c>` (Settings lines), `eng_undolist_<c>` with `eng_undopt_<c>_<k>` / `eng_undoclose_<c>` (Undo lines), `undoList`, `undoOpen`, `UNDO_MAX`, `engineSettingsOpen` |
| tests | `tests/lua/tts-sim.lua` | the fake TTS redraws a Button as real TTS does (`__sim.drawn(id)` = "background|label"); claims "button colours", "black boxes", "tabs", "top-left row" |
| table | the ability panel (stage 3) | `engineAbPanelXml(c)`: 6 rows `eng_abp_<c>_<k>` (left-aligned), the pager `eng_abpg_<c>`, the X `eng_abpx_<c>`. `engineAbList(color, id)` → rows `{ opt, text, cost, why, mana }`: casts / plays first, then each activated ability of the card's text (`engineTextAbilities`: "cost: effect" lines with a mana symbol, a loyalty number or a cost word; Equip, Crew, Fortify, Reconfigure, Level up, Outlast, Station; reminder text and quoted granted abilities left out) matched to the open priority question's options by cost and effect, the unmatched greyed with `engineAbWhy` (Tapped, Untapped for {Q}, Summoning sickness, loyalty timing, Needs N loyalty, Only as a sorcery, Once each turn, Not your priority (waiting for X), Answer the open question first, mana abilities "Used while paying a cost", last); then offered options the text doesn't name. `engineAbPanelRows`: nil for a card not yours, a land with only mana lines, a hand card with fewer than two ways to play. `engineAbPanelShow` pages `ENGINE_AB_MAX` at a time (`engineAbPage`), one `setButton` per row with its colours and tooltip, height to fit; `onMtgAbPanel` uses an offered line (`engineUseAbility` with the question it was drawn for) or says a greyed line's reason. `onObjectHover` shows it for any of your engine cards. Redrawn at each question (`engineAbilityBoxes`) and board (`engineUpdateCorner`); `engineAbilityReset` clears `engineAbShown` / `engineAbPage` too |
