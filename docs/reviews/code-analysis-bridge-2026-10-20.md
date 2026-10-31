# Code Analysis Report: bridge/bridge.js

**Analyzed file:** `bridge/bridge.js` (1,664 lines, SHA-256 `b4c2705b…5900b`, unchanged by this review)
**Read for context (not under review):** `bridge/state-delta.js` (apply/fingerprint), `tests/bridge-harness.js`, `tests/test_bridge_golden.js`, `tests/golden/bridge-cases.js` (setup helpers), `tools/engine-renderer.lua` (answer/cancel/number paths), `tts/mtg-board.lua` (send path), `docs/our-code-reference.md` §7, `TESTING.md:161`, `docs/server-setup-spec.md:100`, `docs/reviews/structural-review-bridge-2026-10-20.md`
**Ruleset:** code-analysis-ruleset v1.2 (findings only, no fixes applied)
**Date:** 2026-10-20 · **Runtime used for repros:** Node v24.15.0 · **Golden test before:** 130/130 pass

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 10 |
| LOW | 9 |

---

## Executive Summary

The biggest risk is that the bridge has no crash barrier on three of its four input paths. These are the relay WebSocket listener, the TCP 39998 listener and the timer callbacks. In Node 24 an exception thrown inside any of them ends the process, and every seat's relay session dies with it, so the game is lost. Several ordinary inputs reach a throw: a prompt missing an expected array, an unlabeled selection option, `mtg deck index`, or a bad answer on the TCP path. Only `/msg` wraps its handler in try/catch (F1). The second group of findings is answers that reach the engine without full validation. `onAnswer` checks only the number of picks, so the engine can receive duplicate or unknown ids or a scry decision with cards missing. A gesture can also answer a "sacrifice … unless you pay" yes/no with "yes" (F4–F7). The third group is the Scryfall image path. With no network it retries every 40 ms with no backoff, which the comment says it doesn't do. A brief outage records "no picture" permanently. Two writers can also corrupt the 4.4 MB cache file, and each write blocks the event loop for about 97 ms (F8–F10). The `/exec` and `/msg` endpoints are open to any web page the host's browser loads, and they are always on, not "development only" (F2). `/img` is safe against path traversal and SSRF, but it can crash the process on a mid-download network error (F3).

Domain/regulatory coverage: not applicable / not assessed (no MTG-rules or compliance checklist supplied). MTG rules correctness of the answers (e.g. damage-assignment order legality) was **not** verified against Forge; it is flagged as an assumption where relevant. Third-party protocol semantics (Manabrew relay, Forge prompt shapes, TTS External Editor API) were inferred from this repo only.

---

## Reading Audit Trail

| File | Lines read | Passes | Notes |
|---|---|---|---|
| bridge/bridge.js | 1–1664 (100%) | 1 full + targeted re-reads | Re-read: 29–71 (outbox/pump), 207–295 (Seat), 386–529 (image/token fetch), 1003–1339 (onPrompt), 1345–1496 (gestures/answers), 1556–1664 (debug server) |
| bridge/state-delta.js | 1–80 | 1 | to judge whether `delta.apply` can throw (it practically cannot) |
| tests/bridge-harness.js | 1–109 | 1 | used read-only to drive repros |
| tools/engine-renderer.lua | 1075–1100, 1325–1380, 1486–1494, 1565–1582 | 1 | what the panel can send (number range, `__cancel`) |
| docs (listed above) | relevant sections | 1 | Layer 7 cross-checks |

Repro scripts were written in the session scratchpad (not in the repo) and loaded the bridge through `tests/bridge-harness.js` without modifying it. Repro IDs (R1…R15) are cited per finding.

---

## Findings

### F1. HIGH · Error handling: any throw in a relay, TCP or timer callback kills the whole bridge

**Lines:** 222 (relay `message` listener: `JSON.parse` + `onRelay`, no try), 230–292 (`onRelay`/`onEnvelope`), 1003–1339 (`onPrompt`), 78–90 (TCP `end` handler → `onTTS`, no try), 471 / 788 / 1402 (timer callbacks → `sendTable` / `sendView` / bounce-land check). Only `/msg` (1602–1606) catches.

**Mechanism (verified):** In Node 24, an exception in an EventTarget listener (which is what `WebSocket.addEventListener` is), in a `net` socket `end` handler, or in a timer callback is an uncaught exception, and the process exits with code 1. All three were reproduced locally (`node-crash.js`: eventtarget / netend → exit 1).

**Concrete triggers (reproduced, R1/R2b/R15):**
- `prompt` with `input.type:"chooseCards"` and no `cards` → `Cannot read properties of undefined (reading 'map')` at 1152. Same for `payManaCost` without `actions` (1127), and for `scry` without `zones` (1215) at `.length`. Unguarded array reads of the same kind are at 1026, 1142, 1181, 1186–1187, 1202, 1241, 1248, 1266, 1274 and 1285.
- `chooseFromSelection` with one option lacking `label` → `localeCompare` of undefined at **1325** (the A–Z sort runs for every multi prompt).
- `mtg deck index` → `index.json` exists, so 1536 accepts it. When the room update arrives, `loadPreset("index")` throws `p.cards is not iterable` (106, 114) inside the relay listener (325). The process dies at game setup.
- An answer whose id isn't among the options, sent to an `orderSteps` prompt (reorder, damage order, ordering the top of the library), throws in `toOutput` (915–917 → 910 reads `.label` of undefined). On `/msg` this is logged. On the TCP path (88) it crashes.
- A non-JSON relay frame crashes at 222. A **binary** relay frame does too: Node's WebSocket default `binaryType` is `"blob"`, and `Buffer.from(Blob)` throws `ERR_INVALID_ARG_TYPE` (verified). *Unsure* whether the relay ever sends binary or non-JSON frames.
- *Unsure:* `zoneOf()` returns the engine's zone object as-is, and callers then read `.cards` unguarded (557, 715, 733–736, 865, 1158, 1404). A zone sent with only `count` would throw inside the 40 ms `sendTable` timer. `logSnapshot` (574, 578) and `cardIndex` (824) do guard `z.cards || []`, so the author expected this shape at least once.

**Impact:** The process exits, every seat's relay socket closes, and the Forge game is orphaned ("Room is busy", so `mtg reset` is needed). The friends' game is lost.

**Overlap:** Known issue `our-code-reference.md` §7 #3 (relay JSON.parse) is still open; its line reference (br:193) is stale.

**Potential Fix Direction:** Put one try/catch barrier at each entry point: the relay listener, the TCP `end` handler, and the `scheduleTable`/`scheduleView`/intent timers. Log the error with the message type and promptId, and keep the process alive. For an unhandled prompt, fall back to the existing "Unsupported prompt" chat instead of throwing. Validate the `deck`/`aideck` ids against `listCommanderPresets()` rather than `existsSync`.

---

### F2. MEDIUM (HIGH if the VPS plan ships) · Vulnerability: `/exec` and `/msg` can be driven by any web page; "development only" is not enforced

**Lines:** 1556–1559 (comment: "Debug channel (development only, localhost)"), 1594–1619, 1654 (listens unconditionally whenever run as main).

**Issue:** No authentication, no `Origin`/`Host` check, and no Content-Type requirement. A web page open in the host's browser can send a no-preflight "simple" `POST` (`text/plain`) to `http://127.0.0.1:48787/exec`. That runs arbitrary Lua in the loaded TTS game: it can move or flip any object (including other players' hands) and make `WebRequest` calls from the host. The same page can `POST /msg` with `{"t":"reset"}` (which runs `docker compose restart forge-room`), `start`, or `answer`. A DNS-rebinding page can also **read** responses (`/state` includes `rawPrompt`, which can contain a seat's hand; `/exec` returns Lua values), because the `Host` header isn't checked. Binding to 127.0.0.1 doesn't prevent any of this: the browser runs on the same host.

**Uncertainty:** Recent Chromium versions add a permission prompt or block for public→loopback requests (Private/Local Network Access). Current behaviour in each browser was **not verified** in this session. Firefox and older browsers should be assumed exposed. Impact is limited by TTS's Lua sandbox (no file system access).

**Cross-artifact:** `our-code-reference.md` §7 #11 records "no authentication (localhost only)". "Localhost only" is the assumption this finding disproves. `server-setup-spec.md:100` plans to point `/msg` at a public VPS. If that happens without auth, the `/msg` surface becomes remote. That is out of scope here (§2.8 forward-looking) but noted.

**Not a finding (verified clean):** `/img` path traversal and SSRF. The regex at 1624 is anchored, allows only `front|back` plus 36 `[0-9a-f-]` characters, and the fetch host is fixed (1630). A query string makes the match fail (404).

**Potential Fix Direction:** Gate `/exec` behind an explicit flag or env var (off by default). Require a per-run random token header on `/exec` and `/msg`. TTS's `WebRequest.custom` can send headers (already done at `tools/tts-stutter-synth.lua:38`). Reject requests whose `Host` isn't `127.0.0.1:<port>`.

---

### F3. MEDIUM · Error handling: `/img` can crash the process on a mid-download network error

**Lines:** 1628–1636.

**Scenario:** The stack pop-up requests `/img/front/<uuid>.jpg` that isn't cached. `fetch` resolves (headers received), then the connection drops during the body. `await r.arrayBuffer()` (1633) rejects inside an `async` `fs.readFile` callback that nothing awaits. That is an unhandled rejection, and Node 24 exits with code 1 (mechanism reproduced: `node-crash.js asynccb` → exit 1). The `.catch(() => null)` at 1631 covers only `fetch()` itself. The HTTP response is also never ended.

**Secondary (LOW):** `fs.writeFile(file, got)` (1634) isn't atomic. A process kill mid-write leaves a truncated jpg, which 1629 then serves with status 200 forever. There's no fetch timeout either.

**Potential Fix Direction:** Wrap the async body in try/catch and reply 502. Write to a temporary file, then `rename`.

---

### F4. MEDIUM · Output: `onAnswer` validates only the count of picks; duplicates, unknown ids and bad step answers reach the engine

**Lines:** 1479–1486 (comment: "A multi-choice answer outside min..max makes Forge throw and abort the whole game: refuse it"), 913–919, 967–969, 1178, 1195, 1207.

**Repros:**
- R4: `chooseCards` min 2 / max 2, answer `["engine-card-43","engine-card-43"]` → sent `chosenCardIds:["engine-card-43","engine-card-43"]`.
- R3: a 3-zone scry, answer `["bogus"]` → sent `zoneCardIds:[[],[],[]]` (the scried card vanishes from the decision).
- R2: unknown id in an ordering step → throws (see F1).
- `"__cancel"` skips the count check (1481) even when the prompt isn't cancellable. `chooseCards` then sends `chosenCardIds:["__cancel"]`. `chooseNumber` passes `Number(a[0])` with no range check, and `NaN` serialises as `null` (1178).

**Likelihood:** The panel normally sends only valid ids: the number buttons stay within min..max (`engine-renderer.lua:1080–1082`) and Cancel is shown only when `p.cancel` (1247). So the realistic trigger is a panel/bridge mismatch, a stale panel, or F2. The comment's own premise (bad answers abort the game) is what makes the missing check matter.

**Potential Fix Direction:** In `onAnswer`, reject picks not in `ui.options` ids (or out of min..max for number mode), reject duplicates, and allow `__cancel` only when `ui.cancel`. Have the step builders (`orderSteps`, `scryPlaceSteps`) refuse unknown ids rather than build on them.

---

### F5. MEDIUM (unsure of engine shape) · Output: a scry with a single destination zone drops the unselected cards

**Lines:** 1215, 1224–1232.

**Repro R13:** `zones:["graveyard"]`, cards c1, c2, player selects c1 → sent `zoneCardIds:[["c1"]]`, and c2 is missing from the decision. `moveZone` falls back to `keepZone` (1225), so the `build` ternary always takes the `moveZone` branch.

**Uncertainty:** Whether Forge ever sends a one-zone scry is not verified. Already listed as `our-code-reference.md` §7 #4 and still open.

**Potential Fix Direction:** With one zone, put all cards there (or auto-answer). In general, assert that every input card appears exactly once before responding.

---

### F6. MEDIUM (unsure of Forge wording) · Output: dragging *any* card to the graveyard answers an open "sacrifice …" yes/no with **yes**

**Lines:** 1438–1441.

**Repro R5:** open `chooseBoolean` titled "Pay {1}?" with `sourceAbilityText` "sacrifice this unless you pay {1}". A sacrifice intent for `engine-card-999-not-a-card` sends `decision:true`. Two problems:
1. `m.id` isn't checked at all in this branch.
2. The regex matches "sacrific" anywhere in the title or source text, so in "sacrifice X unless you pay" templates "yes" can mean **pay**, the opposite of the gesture.

Related, still open (§7 #8): 1430–1431 turns a graveyard drag into a pick for *any* `chooseCards` prompt that lists the card (not only sacrifices).

**Potential Fix Direction:** Require `m.id` to be the prompt's source card, and answer only when the boolean's yes-label or title is itself the sacrifice. Otherwise refuse with a chat explanation.

---

### F7. MEDIUM · State: games with more than 4 players (allowed by the "2-8" check) break table colours and AI decks

**Lines:** 304 (`total < 2 || total > 8`), 341 (bot deck list), 364–368 (`freeColors` from 4 `TABLE_COLORS`), 371 / 1510 (`ai` = slots whose *name* isn't a table colour), 762–768 (`sentZones` keyed by `color|zone`), 39–44 (outbox merge keyed by color).

**Repro R8:** 2 seated + 3 AI. The bridge sends **2** bot decks for 3 bots (`decks.length 2`), so the relay is asked for fewer decks than bots. `slotColor` gives the 5th player `null`.

**Repro R7:** two AIs with `null` colour share the `sentZones` key `null|<zone>`. The second AI was sent `keep:["exile","command"]` that refers to the *other* AI's zones, and the table cannot tell the two null-colour players apart. The 4-seats + 1-AI case also gives the AI `null` and an empty `botDecks` (`deck: undefined`).

**Repro R8b (LOW, known §7 #7):** a human seated at Green gets `started.ai:["Green","White"]`, so the human is reported to the table as an AI.

**Potential Fix Direction:** Cap the total at the number of table colours (or add colours), and build `botDecks` with repetition so its length equals `bots`. Key `sentZones` and the merge by `slot`, not by colour. Derive `ai` from "slot has no seat", not from the colour name.

---

### F8. MEDIUM · CPU / claim: with no network, Scryfall is retried every 40 ms with no backoff

**Lines:** 401–402 (comment: "When Scryfall … fails, wait before asking again (5 s, doubling up to 2 min)"), 416–420, 462–464, 394–397, 535–538.

**Repro R6:** `fetch` rejects (offline/DNS) → **125 collection requests in 4.96 virtual seconds, 40 ms apart**, plus one log line each. HTTP 500 does back off correctly (5 s, 10 s, … 120 s).

**Cause:** On a rejection, the batch was already removed from `imageWanted` (419) and the catch (462) sets no `imageRetryAt`. `failed` stays false, so `scheduleTable()` runs, and `sendTable → tableCard → cachedImage` re-adds the names and fires `fetchImages` again. `fetchTokens` has the same loop shape (526–528 → `tokenImage` re-adds). It also runs the full `sendTable` work (turn tracking, log diff) 25 times a second for the whole game.

**Potential Fix Direction:** Treat a thrown fetch like a non-OK status: put the batch back and set the backoff. Don't `scheduleTable()` after a failure.

---

### F9. MEDIUM · State (fail-open): transient Scryfall failures are cached as "no picture" permanently, on disk

**Lines:** 513–524 (tokens), 453–458 + 404–409 (split/Room cards via `fetchNamed`).

**Repro R14:** token search returns HTTP 503 for all 3 queries → `imageCache["token:Insect|1/1|g"] = {face:null}` is written to disk. After the outage, **0** further searches happen, because `tokenImage` (499) returns the truthy `{face:null}` object. The same happens for split cards: `fetchNamed` returns `null` on any network error or 429, and 455–457 store `{face:null}`. The 429 branch (518) waits 5 s, then `continue`s to the *next* query instead of retrying, so a burst of 429s also ends in a permanent miss. The cache already holds 62 null entries (61 `token:` keys, 34,290 entries total). Some may be real "not found", some transient. They can't be told apart.

**Potential Fix Direction:** Cache a negative entry only for a definitive answer (a 200 with empty `data` / a `not_found` entry). On 429, 5xx or a thrown fetch, keep the key wanted and back off.

---

### F10. MEDIUM · Memory/CPU/integrity: the 4.4 MB image cache is rewritten whole, from two concurrent writers

**Lines:** 389 (`catch {}` → empty cache on parse failure), 459, 524.

**Measured:** `JSON.stringify` of the current cache (34,290 entries, 4.4 MB) takes **~97 ms** of main-thread time on this machine. That cost is paid after every collection batch (≤75 names) and after **every single token**, all while relay prompts and the 40 ms table updates wait.

**Race:** `fetchImages` and `fetchTokens` run concurrently (separate flags 391/489), and both `fs.writeFile` the same path without waiting. Node's documentation states that doing so is unsafe. Local repro R12: concurrent big+small `writeFile` to one path produced unparseable JSON in **25/40** runs. On the next start, 389 silently replaces the cache with `{}`, so all 34k entries are lost and refetched, and nothing is logged.

**Potential Fix Direction:** Use one serialized, debounced writer (write to a temp file, then `rename`), and log a parse failure at 389.

---

### F11. MEDIUM · Error handling / claim: `/exec` stops returning prints and errors once 500 console lines exist

**Lines:** 1563, 1578–1579 (cap 500 via `shift`), 1614, 1618. Claim: 1558–1559 and `TESTING.md:161` ("The reply carries the return value plus any TTS prints and errors").

**Repro R11:** once the buffer is full, `mark = 500`. New lines `push` then `shift`, so the length stays 500 and `consoleLines.slice(500)` is `[]`. Every `/exec` reply then has `console: []`, and Lua errors raised by the posted script are invisible to `tools/tts-exec.sh`. The current `tts-console.log` is 528 KB, so long sessions do pass 500 lines.

**Potential Fix Direction:** Use a monotonically increasing line counter (total lines ever pushed) as the mark, or collect lines through a per-exec listener.

---

### F12. MEDIUM (plausible, not observed with real TTS) · Queue: one TTS connection that never closes stalls all output; the queue grows without bound

**Lines:** 57–71 (`sending` cleared only by `close`, no socket timeout), 54.

**Repro R10:** a listener on the TTS port that accepts and half-closes but never closes its side. After 50 chat messages, it had received **1 connection, with 49 messages still queued**, and the queue is never drained. Only `table` messages coalesce (36–53); `prompt`, `chat`, `texts` and `gamelog` accumulate. A frozen TTS (see the JSON.encode hang note in project memory) can behave this way at the OS level, but that was not tested.

**Related (LOW):** delivery failures other than ECONNREFUSED are silent (70). `sentZones`/`sentStatic`/`lastTableSig` are updated before delivery (687, 759, 768), so a dropped table leaves TTS on stale zones until the next `hello`.

**Potential Fix Direction:** `sock.setTimeout(…)` → destroy and move on. Cap the non-table queue, or count drops in `ttsStats`.

---

### F13. LOW · Logging: engine-fatal, game-aborted and login failures go only to TTS chat

**Lines:** 233, 240–241, 262–264, 289–291 (each `chat(...)` without `log(...)`); 35 (`autoplay` drops every `toTTS`, so in autoplay these events vanish completely).

**Scenario:** Forge sends `fatal`. TTS isn't loaded (or autoplay is on), so the bridge console shows nothing.

**Potential Fix Direction:** `log()` alongside each of these chats.

### F14. LOW · State after "mtg reset": callbacks from the old game still fire; some choices persist

**Lines:**
- 1402–1407: the 2.5 s bounce-land timer chats about the old game after a reset.
- 783–789: a pending `sendView(seat)` for an old seat runs with `game === null` (849 `game?.fromTable` is undefined, so a `view` is sent after `clear`).
- 1529–1534: repeated `reset` starts concurrent `docker compose restart` runs.
- 101–102 / 1525: `deckChoice` and `aiDeckChoice` survive reset (*unsure whether intended*). `aiDeckChoice` is appended without de-duplication.

The relay-side late-message guards (237, 255, 321, 359) check the *current* `game`, not the seat's own game. This is mitigated because `ws.close()` stops message delivery. *Unsure* whether a late `close` event (223) can print "lost the engine connection" during the *next* game.

**Potential Fix Direction:** Give each `Seat` a `game` reference and compare it with the current game in callbacks. Keep timer handles on `game` and clear them in `resetGame`.

### F15. LOW · Memory/disk: unbounded inputs and logs

**Lines:**
- 1598–1599 and 1611–1612: HTTP bodies accumulate with no limit. 76–77: the TCP 39998 chunks likewise (local callers only).
- 1464–1470: `game-log.txt` and 1580 `tts-console.log` (528 KB now) are appended forever.
- 387 `tmp/img-cache`: no eviction (2.8 MB now).
- 62: `MTG_RECORD` (opt-in).

**Potential Fix Direction:** Cap body size (e.g. 1 MB, then 413), and rotate the logs at startup.

### F16. LOW (unsure, perf trade-off) · State: a patched board's fingerprint is trusted, not verified

**Lines:** 276–277. The base fingerprint is compared, but the result of `delta.apply` is never checked against `env.fingerprint`, even though `state-delta.js` exports `fingerprint()`. A patch-application bug (e.g. the keyless-element collapse already noted as §7 #12) would drift silently until the next full state. Hashing the whole state per patch may be too costly, so treat this as a decision to make explicitly.

**Potential Fix Direction:** Verify periodically (every Nth patch) or under `MTG_TRACE`, and request a resync on mismatch.

### F17. LOW (unsure if intended) · CPU / claim: games not drawn by the table still send `table` and `texts`

**Lines:** 297 (comment: "fromTable: the group's table draws the game"), 703–704 (no `fromTable` check), 849.

The golden scenario "text board (not drawn by the table)" shows `view,…,table,texts,texts,table,texts…`. Each `table` costs TTS a decode, according to the bridge's own comments (739–741).

**Potential Fix Direction:** Return early in `sendTable` when `!game.fromTable`, or document why both are sent.

### F18. LOW · Input validation: `deck` / `aideck` accept any reachable `.json` path

**Lines:** 1525, 1536. `path.join(PRESETS, `${id}.json`)` accepts `../…` traversal and `index.json`, which crashes (F1). It also accepts the 56 non-Commander presets for a Commander game.

**Potential Fix Direction:** Allow only ids from `listCommanderPresets()`.

### F19. LOW · Config: env fallbacks for hyphenated options are named `MTG_TTS-IN` / `MTG_TTS-OUT` / `MTG_DEBUG-PORT`

**Lines:** 11–13. These names can't be set with POSIX `export` (known §7 #9). This was confirmed while writing R10: `MTG_TTS_OUT` is ignored and the bridge talked to the real port 39999.

**Potential Fix Direction:** Replace `-` with `_` in the env name.

### F20. LOW · Output: lethal damage for a blocker missing from the seat's view defaults to 1

**Lines:** 1281–1284. `Number(c?.toughness) || 1` fails in the "less lethal" direction: auto-assignment could move damage past a blocker before it has lethal, which breaks the rule that each blocker must get lethal damage before the next. Blockers are public, so this should be unreachable in practice. MTG-rules legality of `damageSteps` (925–943, which lets the player assign 0 to the first blocker) was **not verified** against Forge's validation.

---

## §2.4 Layer 6: Fail-Safe Direction Audit

| Line | Default / fallback | Triggered by | Communicates | Safe side? |
|---|---|---|---|---|
| 128–129 | `forgeCards = {}` | missing/bad forge-cards.json | "engine knows no cards" | **YES**: every deck becomes "not ready" (fails closed, logged) |
| 389 | `imageCache = {}` | unreadable cache | "nothing cached" | Safe for correctness (refetch), but silent; hides F10 corruption |
| 455–457, 513/523 | `{face:null}` stored | any non-success | "card has no picture" | **NO** (F9): a transient failure becomes a permanent fact |
| 462 | catch, no backoff | fetch rejects | "try again now" | **NO** (F8): fails open into a 40 ms retry loop |
| 1010 | `cname` → raw id | card not in view | display only | n/a |
| 1283 | toughness → 1 | blocker not in view | "1 damage is lethal" | **NO** in principle (F20), likely unreachable |
| 1455 | `need = max(1, min)` | `chooseCards` min 0 | "one pick finishes" | Acceptable: a legal answer with fewer picks |
| 1475 | stale/foreign promptId → ignore | late answer | "no answer" | **YES**: never answers the wrong prompt |
| 1481 | `__cancel` skips count check | Cancel pressed | "cancel is always legal" | **NO** (F4) for non-cancellable prompts |
| 276 | base mismatch → `RequestResync` | lost patch | "board unknown" | **YES** |
| 1475 / 228 | `promptId ?? 0` | missing id | "priority prompt 0" | Unsure: an answer with a null id compares equal to prompt 0 |
| 35 | `autoplay` → drop all TTS output | test mode | "nothing to show" | Intended, but also drops error chats (F13) |

## §2.4 Layer 7: Cross-Artifact Promise Consistency

| Claim (where) | Code reality | Finding |
|---|---|---|
| "wait before asking again (5 s, doubling up to 2 min)" (401–402) | only for HTTP non-OK, not network errors | F8 |
| "Debug channel (development only, localhost)" (1556) | always on; reachable from browsers | F2 |
| "/exec reply carries … prints/errors" (1558–1559, TESTING.md:161) | empty after 500 lines | F11 |
| "multi-choice answer outside min..max … refuse it" (1479) | count only; membership/duplicates/cancel unchecked | F4 |
| "Need 2-8 players total" (304) | >4 breaks colours and bot decks | F7 |
| "fromTable: the group's table draws the game" (297) | table messages sent regardless | F17 |
| "Every option can also come from env `MTG_<NAME uppercased>`" (our-code-reference.md:144) | literally true; names unusable in shells | F19 |
| our-code-reference.md §7 #1, #2, #5 | appear **fixed** in current code (hello replays `st.prompt.ui`; relay callbacks check `game`; `tappedFor` reset on every answer at 1134) | the §7 list's line numbers are stale |

---

## §2.8 Explicit Scope Boundary: what this report does NOT cover

- **MTG rules / Forge semantics:** whether each `toOutput` builds a *legal* answer under the Comprehensive Rules (damage assignment order, attack/block requirements, scry ordering) was not checked against Forge. The report flags only answers that are structurally wrong (missing, duplicate or unknown ids).
- **Third-party protocols:** the Manabrew relay message shapes, Forge prompt field presence, and TTS External Editor API behaviour (including whether a frozen TTS keeps connections half-open, F12) are inferred from this repo, not verified against those systems.
- **Browser network-access policy (F2):** not verified per browser or version in this session.
- **Other files:** `tools/engine-renderer.lua`, `tts/*.lua`, the relay and `state-delta.js` were read only where needed to judge bridge behaviour. They were not audited.
- **Non-code copy** (README/SPEC wording) and **forward-looking scale** (the VPS deployment in server-setup-spec.md) are out of charter, except where noted in F2.
- **Community sources:** no web access was used. Per the operator note, no GitHub/Stack Overflow/Reddit citations are given rather than invented. Platform behaviours were instead verified by local experiment on Node v24.15.0: EventTarget/socket/async-callback throws exit the process, WebSocket `binaryType` defaults to `"blob"`, and concurrent `fs.writeFile` corrupts output.

## Validation Notes

- Every finding marked "Repro" was run through `tests/bridge-harness.js` (fake network/disk/clock) or a standalone Node script in the session scratchpad. No repo file other than this report was written.
- Golden test `node tests/test_bridge_golden.js`: 130/130 before the review.

## Recommended Next Steps (priority order)

1. F1: entry-point try/catch barriers, plus preset-id allow-list (also closes F18).
2. F4 / F5 / F6: validate answers against the options and the input card set before `respond`.
3. F2: token-gate `/exec` and `/msg`; make `/exec` opt-in.
4. F3: guard the `/img` async body.
5. F8 / F9 / F10: unified Scryfall backoff, no negative caching on transient errors, single atomic cache writer.
6. F7: cap players at table colours or key by slot; fill `botDecks` to `bots`.
7. F11, F12, then the LOW items.
