# Test notes: latency (SPEC.md §6)

All tests were run on 2026-10-17 on the host PC: HP Pavilion Gaming TG01, Ryzen 5 3500 (6 cores), Windows 11. The stack (relay, web client and Forge room) runs in Docker Desktop through WSL2, started from `stack/compose.yml`. Manabrew v3.56.1 images; Forge loads 35,237 cards.

Percentiles: p50 is the typical value; p95 means 95% of samples were faster.

## Before any test

```bash
cd stack
docker compose up -d
```

Docker Desktop must be running ("Engine running"). Virtualization (SVM) has to be enabled in the BIOS: Esc, then F10, then Advanced → System Options. The web client is at http://localhost:8080.

---

## Test 1: TTS ↔ bridge echo

**Question:** is TTS's External Editor API (localhost TCP, ports 39999/39998) fast enough to carry game traffic?

**How:**
- `bridge/echo-bridge.js` listens on 39998 and answers every `ping` with a `pong`.
- `tts/echo-test.lua` goes in the Global script. It sends 500 pings one after another and times each round trip with `os.clock`.

**Run:**
```bash
node bridge\echo-bridge.js
```
Then, in TTS: Modding → Scripting → Global, paste `tts/echo-test.lua`, click Save & Play, and type `echotest` in chat. You can add a count, as in `echotest 2000`.

**Result:**

| p50 | p95 | p99 | max |
|---|---|---|---|
| 10.4 ms | 12.8 ms | 13.7 ms | 17.0 ms |

- The chat timestamps agree: 500 round trips took about 5 s.
- The bridge accounts for about 2–3 ms of each round trip. The rest is TTS handling the message on its main thread, which takes about one frame.
- **Pass** (target < 30 ms). The External Editor API is the transport; the WebRequest fallback isn't needed.

**Gotchas:**
- The red "Error no save found" on Save & Play appears when the table was loaded from the Games menu instead of a save. It's harmless.
- Only one program can listen on port 39998. Close the VSCode/Atom TTS plugin while the bridge runs.

---

## Test 2: engine round trip

**Question:** how long from answering a prompt until the engine's next message reaches that seat?

**How:** `bridge/engine-test.js` connects to the relay as one seat in the `tts-commander` Forge room and auto-plays it:
- keeps its opening hand;
- plays lands;
- casts spells about 60% of the time;
- auto-pays mana;
- picks the first legal targets;
- attacks with everything and never blocks.

It writes a CSV with one row per response: `n, turn, prompt, reply, rtt_ms, engine_ms, emit_ms, bytes`. `engine_ms` is the engine host's own processing time; the relay hop is `rtt − engine_ms − emit_ms`.

**Options:**

| Option | Meaning |
|---|---|
| `--seats N` | total seats in the game |
| `--bots N` | Forge AI seats to request (default N−1) |
| `--turns N` | stop after this turn |
| `--minutes N` | time limit |
| `--deck <preset id>` | deck from `decks/` (ours) or `manabrew/public/preset_decks` (bridge/presets.js) |
| `--full` | old full-state mode |
| `--tag x` | adds a suffix to the CSV file name |

"Direct" replies are answers the engine acts on immediately (mana payment, targets, reveals). `chooseAction` samples are mostly priority passes.

### 2a: one client against Forge AI, full states (first run)
```bash
node engine-test.js --seats 2 --turns 6
node engine-test.js --seats 4 --turns 12
```

| Seats | Direct reply p50 / p95 | chooseAction p50 / p95 | Message size | Game |
|---|---|---|---|---|
| 2 | 13 / 33 ms | 26 / 45 ms | ~13 KB | 7 turns in 2.8 s, 0 rejections |
| 4 | 40 / 91 ms | 86 / 142 ms | ~20 KB | 13 turns in 13.5 s, 0 rejections |

At first I concluded that the relay hop dominated. **That was wrong** (see 2b): in full-state mode, the `engineMs` on states the relay expanded doesn't mean anything.

### 2b: change-only patches vs full states (4 seats, 3 Forge AI, 2 runs each)
```bash
node engine-test.js --seats 4 --turns 12          # patches (client_version 3.56.0)
node engine-test.js --seats 4 --turns 12 --full   # full states
```
The client announces `client_version` ≥ 3.17.0, so the relay sends it `stateDelta` patches. `bridge/state-delta.js` applies each patch and checks the result against the engine's FNV-1a fingerprint.

| | Patches | Full states |
|---|---|---|
| Message size, avg / max | ~2 KB / 8 KB | ~19 KB / 26 KB |
| Relay hop p50 | ~4 ms | up to 50–90 ms |
| Total, direct reply p50 | ~29 ms | ~30 ms |
| Total, chooseAction p50 | ~60 ms | ~55–63 ms |
| Correctness | 283 patches, 0 mismatches, 0 resyncs, apply ≈ 0.05 ms | — |

**Conclusions:**
- Patches remove the hop cost and make messages about 9× smaller.
- The remaining time is inside the engine host, and with Forge AI seats that includes the AI deciding on every priority pass.
- **Decision:** the bridge always uses patches.

Data: `latency-4p-delta-run1/2.csv`, `latency-4p-full-run1/2.csv`.

### 2c: four test clients, no AI (pure engine)
```bash
# four terminals, or in background; one per seat
node engine-test.js --seats 4 --bots 0 --turns 12 --deck neheb_minotaur_commander --tag client0
node engine-test.js --seats 4 --bots 0 --turns 12 --deck ashling_limitless_commander --tag client1
node engine-test.js --seats 4 --bots 0 --turns 12 --deck ramses_commander --tag client2
node engine-test.js --seats 4 --bots 0 --turns 12 --deck real_teval_commander --tag client3
```
One shared 12-turn game produced 500 responses. Each seat received 494 patches, with 0 mismatches and 0 resyncs. Messages averaged about 0.9 KB.

| | p50 | p95 | p99 | max |
|---|---|---|---|---|
| **Total** | **21.5 ms** | 91 ms | 162 ms | 359 ms |
| Engine (`engineMs`) | 14 ms | 83 ms | 159 ms | 353 ms |
| Relay hop | 4 ms | 16 ms | 37 ms | 94 ms |
| Direct replies only | 34 ms | 119 ms | — | 131 ms |

- **Slow tail:** 56 of the 500 samples took more than 60 ms of engine time, mostly after `chooseAction`, spread across all turns. These are probably spells resolving and turn-step processing.
- **CPU contention:** 4 Node clients and Docker were sharing 6 cores, which may add to the tail.
- **Conclusion:** the typical action takes about 22 ms (engine plus relay).

Data: `latency-engine-4p-client0..3.csv`.

---

## Combined estimate: 4 human players, click → update reaches TTS

| | Typical | p95 |
|---|---|---|
| TTS ↔ bridge hop (test 1) | ~10 ms | ~13 ms |
| Engine + relay (test 2c) | ~22 ms | ~91 ms |
| **Total before rendering** | **~32 ms** | **~105 ms** |

The target is < 150 ms including rendering. TTS rendering time hasn't been measured yet; that's test 3, which needs the board (M4).

## Bridge integration test (M3, headless)

```bash
node bridge/bridge.js --tts-in 48998 --tts-out 48999
node bridge/test-fake-tts.js
```

The fake TTS takes TTS's place on spare ports. It sends `hello`, then `start` with seat White plus 1 AI, and answers every prompt: first or second option, minimum picks, lowest number.

Result on 2026-10-17: 9 turns, 74–79 board views, and 72–78 prompts answered, including Mulligan ×4 and "Put 3 cards on the bottom". There were no engine rejections. At the end, `reset` restarts the Forge room.

## Engine on the group's table: live TTS test (M4 steps 2–3), 2026-10-17

Run by Claude through the bridge's **debug channel**, without a person at the keyboard. TTS was open with the engine-mode copy; seated: White (host).

- **Run Lua in the open game:** `tools/tts-exec.sh file.lua` posts to `http://127.0.0.1:48787/exec`. The reply carries the return value plus any TTS prints and errors (all of them are also written to `bridge/tts-console.log`).
- **Bridge view of the game:** `GET /state` shows each seat's board and its raw engine prompt.
- **Reload Global after a rebuild:** `node tools/tts-push-global.js`, the same "Save & Play" the VSCode plugin uses. Only Global is replaced. **Note:** this reloads the game, so anything spawned since the last save disappears.
- **Board summary:** `tools/tts-inspect.lua` lists engine cards per zone, the open prompt and the trackers.
- **Autoplay:** `node tools/tts-autoplay.js [steps] [stopTurn]` plays White by pressing the engine panel's buttons.

**Result:** the full flow works in real TTS.
1. A test deck was spawned in the Card Importer format (99 cards + commander).
2. `mtg ready` reported *"ready, 99 cards + commander Neheb"*.
3. `mtg start ai 1` started the game; engine mode switched on and the imported deck moved aside.
4. The 7-card hand landed in the TTS hand zone; both players got a library marker.
5. Commanders appeared next to their tax labels, and the mulligan prompt showed in the panel.
6. 8 turns played through the panel: lands played, Neheb cast from the command zone, Anaba Bodyguard cast, attack and block prompts answered.
7. **Board:** creatures in the front row of each playmat, lands in the back row, tapped cards turned 90°. The AI's graveyard filled up, and the stack card floated over the centre.
8. **Trackers:** life 37 and 39, commander tax 2 and 2, and 2 commander damage on White from Red, all following the engine. `Turns.turn_color` followed the active player.
9. `mtg reset` removed all engine cards and brought the imported deck back. It now also switches engine mode off.
10. No errors from the table's code during the game. All 4 console errors came from Claude's own debug commands.

**Bugs found and fixed during the run:**
1. **TTS only passes flat External Editor messages.** Nested tables sent from Lua are silently dropped; nested data from the bridge arrives as C# objects that Lua can't use. **Fix:** every message now carries its payload as a JSON string, `{ t, json }`, in both directions.
2. **Auto-pay looped forever.** After auto-paying, the mana sits in the pool and the engine waits for "pay from pool" (`canConfirmFromPool`), but the panel offered Auto-pay again. **Fix:** the bridge confirms automatically after an Auto-pay, and "Pay from mana pool" becomes the first button when the pool already covers the cost. Undo actions get readable labels.
3. **Played lands stayed in the hand.** TTS re-lays-out hand cards, so a smooth move never leaves the hand. **Fix:** cards leaving a hand jump out instantly.
4. **Test-setup only, not a code bug:** repeated commander spawns stacked into a deck on the command zone. Real play has one commander card there.

**Round 2, after the user's first look (screenshots, 2026-10-17).** The user reported:
- the deck and commander were floating;
- card pictures were missing;
- the panel was white and unreadable;
- the panel didn't match the cards in hand;
- cards could still be moved by hand.

Causes found through the debug channel, and their fixes:
1. **Pictures.** TTS can't load Scryfall's redirecting `named?format=image` links ("unsupported format UNKNOWN"). The imported deck's own pictures were also being missed, because the Card Importer stores images only on the **deck** (`CustomDeck` keyed by `CardID / 100`), not on each card.
   - **Fix:** `mtg ready` reads the deck's images.
   - **Fix:** any other card (AI decks, tokens) gets a direct `cards.scryfall.io/...jpg` link from Scryfall's card API. It's looked up in batches of 75 and cached in `bridge/image-cache.json`, and cards are redrawn when their picture arrives.
2. **Floating cards.** Cards were placed at the zone objects' height (y 2.4 for the library). **Fix:** every card now sits on the table surface (y 1.15).
3. **White panel.** TTS doesn't accept `rgba(10,12,16,0.9)` with 0–255 values. **Fix:** the panel uses hex colours.
4. **Hand mismatch.** The 7 imported cards the user had drawn before starting stayed in the TTS hand next to the engine's hand, and `mtg ready` didn't count them (the deck read as 92). **Fix:** `mtg ready` counts the hand too, and `mtg start` moves hand cards aside with the deck.
5. **Manual moves.** **Fix:** `onPlayerAction` refuses pick-up, flip, delete and the like on engine cards. Selecting, and rearranging your own hand, are still allowed. A card dropped elsewhere snaps back.
6. **Dice-roll prompt showed raw JSON.** **Fix:** it now shows "White: 19 (goes first)".

**Re-tested in TTS** with a deck in the real importer format (images on the deck only, 7 cards already in hand):
- `mtg ready` reported 99 + commander.
- The hand showed only the engine's 7 cards, all with pictures loaded and no image errors.
- The library and commander sit on the table.
- The action block refused pick-up, flip and delete, and allowed select and own-hand pick-up.
- 8 turns of play completed, and the graveyard stacked correctly.

## Bug hunt: automated games in TTS (2026-10-17)

**Tools:**
- `tools/tts-run-game.sh <presetDeck> <stopTurn> <aiCount>` runs one full game: reset, deal the deck in the real importer format to White (7 in hand, commander on the zone), `mtg ready`, `mtg start ai N`, autoplay, then reset and clean up.
- `tools/tts-autoplay2.js` plays like a person. It drags lands and spells onto the battlefield, drags discards to the graveyard, and presses End turn about a third of the time. Everything else goes through the panel.
- `tools/tts-check.lua` runs after every action and compares every zone the engine reports with the objects in TTS: missing, wrong place, wrong tap state, duplicates, leftovers, life trackers.
- `tools/tts-summarize.js` prints a game's report.
- Test cards carry `GMNotes = "testcard"`, and `tools/tts-cleanup-test.lua` removes only those.

| Game | Deck vs | Turns | Result |
|---|---|---|---|
| 1 | Neheb vs 1 AI | 13 | Duplicates and leftovers from the very first check. **Cause:** a Global reload (Save & Play, also loading a save or reloading scripts) keeps all objects but forgets which cards the renderer drew. The previous game's cards stayed as orphans. |
| 3 | Neheb vs 1 AI | 10 | Clean, except a dragged land didn't rotate when tapped. **Cause:** a dropped card rests lower than the planned height, so every redraw started a small move that cancelled the rotation. |
| 4 | Ramses vs 1 AI | 12+ | Stuck: auto-pay for Beseech the Queen ({2/B}{2/B}{2/B}) looped. Forge didn't allow confirming from the pool even with 5 mana floating (an engine quirk with hybrid generic costs). |
| 4 (rerun) | Ramses vs 1 AI | 15 | **Clean**: 7 drags, 20 decisions, no problems, no errors |
| 5 | Teval vs 2 AI (3 players) | 17 | **Clean**, apart from one card caught mid-slide into the graveyard (a checker timing issue). Draw counts were correct for every White turn. |
| Undo test | — | — | A stray copy of a hand card plus a deleted hand card (what Ctrl+Z does) was repaired automatically. |

**Fixes from the bug hunt and the user's round-3 feedback:**
1. **Reload survival.** Starting or resetting a game sweeps every engine card off the table, tracked or not. A reload sweeps leftovers too. The positions of moved-aside decks and hands are saved with the game (`onSave` → `Global.script_state`) and put back after a reload. The bridge redraws a still-running game when the table says hello.
2. **Undo / copy / paste.** Engine cards the renderer didn't make are removed. A deleted engine card triggers a redraw from the engine.
3. **Tap rotation.** Cards are only moved when they're off in x/z (or more than 0.4 off in height). Rotation is updated separately. Positions you arrange are stored at table height.
4. **Auto-pay loop.** Once Auto-pay has failed for a spell, it isn't offered again; the panel says "Auto-pay couldn't finish this payment. Tap other sources, undo some taps, or Cancel."
5. **Round-3 feedback:**
   - End turn button in the panel: passes until the turn number changes, but blocks and targets still stop you.
   - The status line shows each player's own turn number ("White's 5th turn (game turn 10)"); Forge counts turns across all players.
   - Mana abilities removed from the priority panel.
   - "Into your hand: …" message.
   - The commander sits on the command-zone slot itself.

**Mistake during testing (owned):** an earlier test clean-up deleted every card found under the table. After a reload, that included the user's moved-aside Thantis commander from their open session. The user's 99-card deck was found and put back. Since then, clean-up only touches cards marked as test cards.

**Known engine quirks:**
- Hybrid generic costs ({2/B}) sometimes can't be confirmed from the pool. Workaround: Cancel, then tap specific sources.
- The engine sends its game log only to spectators, so there's no game log in chat yet.

**Not checked yet (needs eyes or a second player):**
- how it actually looks: card images, which way the cards face, the panel layout;
- hand privacy against another seated player;
- 4 human players.

## Phase 2 gestures: live TTS test (2026-10-18)
These were real table actions fired through `onPlayerAction` over the debug channel: White against 1 Forge AI, Neheb deck.
- **Tap to pay:** Lightning Visionary {1}{R} and Blades of Velis Vel paid by Q/E on two Mountains. The cards turned 270° and, after the fix, the payment finished by itself.
- **Undo:** Heated Debate {2}{R}. Tapping a Mountain, then turning it back, restored the `tap:` option and the card's rotation (180°).
- **Attack by tapping:** Q on Lightning Visionary selected it as an attacker; Confirm declared the attack.
- **Click to target:** Tainted Strike on our own creature, and Heated Debate on the AI's Ashling. The click went straight to payment after the auto-answer fix.
- **Block by clicking:** Neheb, then the attacking Cavalier of Dawn, selected the right blocker|attacker pair. Neheb died and the commander-return prompt followed.
- **Engine abort found:** an empty Confirm on a "choose 1" (Rottenmouth Viper) gave `IllegalArgumentException: selected option total out of range: 0`, and Forge aborted the game. The test driver caused it, but the same path was reachable. Now guarded in Lua and the bridge.
- **Not testable over the debug channel:** right-click menus (TTS has no API to open one). A human needs to try them.

## Stutter measurement (2026-10-18)
Measured with `engineProfile`: per-handler call counts and average and max times. Neheb test deck against 1 AI, 8 turns.
| | onExternalMessage avg | max | engineRender avg |
|---|---|---|---|
| Full board every update | 73.4 ms | 361 ms | 9.2 ms |
| Card details sent once | 35.5 ms | 251 ms | 9.9 ms |
| + defaults dropped, queue merged | 21.4 ms | 215 ms | 11.0 ms |
Board messages now average about 1.6 KB (bridge `/stats`). The remaining spikes are spawns: new cards and rebuilt piles.

## Still to test
- **Test 3:** how long TTS takes to move and spawn objects for a large board, measured in TTS.
- **5–8 players:** `SEATS=6 docker compose up -d`, then `engine-test.js --seats 6`.
- **WebRequest fallback** (test 4): only needed if the External Editor API causes problems.
- **CPU contention:** rerun 2c with the clients on another machine to separate it from engine cost.

## Golden masters and rule checks (2026-10-20, jr-programmer-suite)

| What | Run | Covers |
|---|---|---|
| Bridge behaviour | `node tests/test_bridge_golden.js` | 145 scenarios: every prompt type and answer, gestures, board messages, reload, Scryfall up/down/busy. Network, disk, clock and timers are faked (`tests/bridge-harness.js`). Re-record with `node tools/capture_bridge_golden.js` only for a deliberate behaviour change. |
| Bridge promises | `node tests/test_bridge_claims.js` | hidden hands never sent or logged, outbox merge keeps card details, one-pick answers, one cache writer, debug port refuses browsers |
| Table script | `node tests/test_table_golden.js` | rebuilds the Global script from the sources and replays two recorded games (4-player and 1v1 with clicks) on fengari with a fake TTS (`tests/lua/tts-sim.lua`); ~35 s. Re-record: `node tools/capture_table_golden.js` |
| Table fixes the games don't reach | `node tests/test_table_claims.js` | number questions above 59, crash barrier, select+pickup clicks, one-pause reset, game state forgotten at reset, enchanted tokens not grouped (each check shown to fail on the old script) |
| A card's other side | `node tests/test_card_other_side.js` | a two-faced card's other face and name sent in a hand too, the side each way plays, a drag plays the side shown or says it can't; on the fake TTS: two states (the plain back behind both in a hand), the object kept when a player turns it, the side sent with the drop, the right-click list's order; every Forge layout from Scryfall's real cards (modal, transform with MTMtE and Disturb and a battle, meld, flip, split, fuse, aftermath, Room, adventure, omen, prepare with its spell copy, specialize, prototype; a classic card a prepare spell copies, Lightning Bolt, kept without an other side): the other side's picture, name and hover text, the deck's picture for a one-picture card's face name asked of Scryfall once, the side of each way (docs/card-other-side-spec.md, the layouts table). `OTHER_SIDE_BRIDGE_ONLY=1` runs the bridge's checks alone |
| Foreign printings, non-ASCII names | `node tests/test_foreign_names.js` | a deck's foreign printings get their English names from Scryfall (fake): by the printing id in the picture link, else a search on the printed name; asked once (`bridge/foreign-names.json`), the deck checked again, the translations said; no network keeps the old message; a name that arrives as UTF-8 bytes one character each is read as UTF-8 on both ports, and goes back to TTS encoded once |
| Players' own card art | `node tests/test_bridge_custom_art.js` | a deck line's `#https://...` picture: the link checks (https, png/jpg/jpeg/webp, 500 characters, no quotes or spaces), one picture per name per owner (the first link; basics mix), a bad link falls back, the `mtg ready` lines, every zone, the known-owner rule, the host's `mtg art off/on` and the resume file (docs/custom-art-spec.md) |
| Engine and table map | `node tests/test_table_map.js` (`--gaps` lists them) | every fact Forge sends about a card or a player, every zone and every gesture is in `bridge/table-map.js`: shown, a named gap, or why not; every key and check it names still exists |
| Mechanics by the rules | `sh tools/live-check.sh <node tag>` | real engine, no TTS: expected results written from the Comprehensive Rules (`tests/live_phasing_check.js`: phasing, then a rewind agreed with a question open) |
| Question types | `node tests/test_table_kind_relation.js` | relation: the recorded games with and without the bridge's `kind` on each question make the table do exactly the same (no recorded answer needed) |
| Full games without TTS | `node tests/lua/headless-tts.js --save <save> --seated White` + `node bridge/bridge.js --tts-in 39988 --tts-out 39989 --debug-port 48788`, then `BRIDGE_PORT=48788 BRIDGE_LOG=tmp/bridge2.log bash tools/run-coverage.sh 25 <decks>` | the real table script on fengari behind the External Editor API; real Forge games played by the autoplay driver and checked by tts-check, no TTS window. Uses the Forge room, so not while a real game runs. |
| Hand-play sweep | `bash tools/handplay-sweep.sh [stopTurn=30]` → `tmp/handplay/report.md` | the same headless setup, but `tools/handplay.js` plays with the table's gestures instead of the panel (drag lands/spells/discards, Q/E for mana, {T} abilities and paying, click attackers + life counter, blockers + attacker, targets, cards) and checks after each gesture that the engine did what it meant. 24 decks of 40 (`tools/make-handplay-decks.js`): 2 everyday-mechanics decks against an attacking AI (`decks/ai_handplay_rats.json`), then every keyword in `tmp/kwdecks/keyword-cards.json` (15 per deck) against the passive AI. Blind to TTS's own mouse handling and physics (scripted gestures call the table's handlers directly). Uses the Forge room. |
| Question audit | `node tools/question-audit.js tmp/tts-stream-headless.jsonl <sinceMs> tmp/sweep-decks.txt > tmp/question-audit.md` | every question a sweep asked, per deck, with wording that has meant a bug before flagged (a bare "choose a card", "Use X?", Forge's own marks, empty or repeated labels). A review list, not a test: the card's own question ("Choose one —" on a modal spell, "choose a creature type") is flagged too and is fine. 22-deck sweep 2026-10-28: 61 flagged kinds, fixed generally in `purposeOf` and the optional-cost wording (bridge scenarios "purpose: ..."). |
| DeckCheck links | `node tests/test_deckcheck.js` (gate) | `tools/deckcheck.lua` on fengari with TTS's JSON and pattern limits: every link kind and variant, links rejected (other hosts, `/app/home`, an empty id), the `/deck` response to spawn entries (partner commanders first, quantities, merges, a non-Commander deck's null bracket, an empty mainboard, missing boards and fields), every error status, the GM-notes tag and the label; no goto, no TTS calls, no bare locals in for-in bodies. The fixture is hand-made, never a recorded response (docs/deckcheck-spec.md). Live API drift, by hand only: `node tools/deckcheck-smoke.js <link>` (one request, nothing saved) |
| Lua static scan | `node tools/lua-scan.js` | names used before a later top-level `local` (they resolve to nil globals) |
| Commander rules | `bash tools/rules-check.sh tax`, `bash tools/rules-check.sh cmddmg`, `node bridge/priority-check.js` | tax, 21 commander damage, command-zone choice, turn order after elimination, 4-player priority (needs the Docker stack; restarts the Forge room) |
| Situational keywords | `bash tools/rules-check.sh keywords` (`KW_ONLY=Fuse,Spree` to narrow) | casts Aftermath, Fuse, Enrage, Fight and Spree on purpose (deck `decks/test_rules_keywords.json`); an action the engine undoes 3 times in a turn is dropped |
| Rewind (M4.5) | `bash tools/rules-check.sh rewind` | at turn 8 asks for the turn-6 upkeep checkpoint; checks turn, step, life, commander casts and every zone match what they were |
| Concede (M4.6) | `bash tools/rules-check.sh concede` | concedes at turn 4; the player is marked conceded and the other player wins |
| 5–8 seats (M6) | `SEATS=6 docker compose -f stack/compose.yml up -d forge-room`, then `node bridge/engine-test.js --seats 6 --turns 12` | the engine runs a 6-seat game (set SEATS=4 back afterwards) |
| Grading the tests | `node tools/mutate-bridge.js`, `node tools/mutate-table.js` | applies plausible careless edits to copies and reports how many the tests miss (bridge: 22 edits, 1 equivalent escape) |

Limits: the table run is Lua 5.3 (fengari), not TTS's MoonSharp; physics, other objects' scripts and rendering are not
modelled. The bridge fakes are inferred from recorded engine messages, not the relay's specification.

### Which end of an order list is which (2026-10-22, headless against Forge)

- **Cards put back on the library** (`reorder`, Ponder / Mirri's Guile / Sensei's Top): the LAST id in `orderedIds`
  ends on top. Headless game, deck lib-01: Ponder offered Abundance, Command Tower, Swamp; the bot kept that order and
  declined the shuffle; Ponder then drew Swamp and the next draw was Command Tower. The bridge shows these top first
  and sends the list turned round.
- **Triggers** ("Order triggered abilities"): the first id resolves first, as Manabrew's own client says ("Leftmost
  resolves first") and as Forge's `orderAndPlaySimultaneousSa` adds them to the stack last-to-first.
- **Scry** (`scryDecision`, the `libraryTop` list): the FIRST id ends on top, unlike `reorder`. Headless deck scry-01: Augury Owl scried Island, Omen of the Sea, Island, all kept on top in that order; the next draw was that first Island.
- The bot (`tools/handplay.js`) answers No to "Shuffle your library?" so a Ponder in a sweep shows the order.
- A run stalled once with "no prompt for 60s" right after a payment question reached the headless table: most likely the same crash (see "Ease-of-use review" below). That run's game had in fact ended: Forge threw a NullPointerException writing the game's result (`PlayerOutcome.toString`), the same crash that turns a loss by drawing from an empty library into "game aborted" (the player's live game, 2026-10-22, turn 28, library 0).


### Ease-of-use review of every question (2026-10-22)

`tools/handplay.js` records, for each question, what the player saw (`HP.seen` in tools/handplay.lua: the instruction
line, the corner buttons, the card row and whether the Engine panel had to open). `node tools/question-review.js`
groups them by shape and flags friction (the panel needed, engine jargon, long titles or buttons, many choices) into
tmp/handplay/questions.md. The 24-deck run (turn 18 each): 1,497 questions in 78 shapes; the panel opened 18 times,
all for the combat damage split (now in the card row). Found and fixed from it: the payment ranking against the full
cost (a 1,648-question loop), a 352-way list and library searches with no panel, 15 OK-only notices in one game,
forced one-option choices, and the wordings listed in docs/our-code-reference.md. The sweeps that stopped between decks ("White's zones
hold the player's own things ()") were not a slow table, as first thought: the headless table had crashed. The table
cut a text by bytes (`:sub(1, 220)`) in the middle of a "—" or "…", and the broken character made the headless
table's frame output unreadable JSON, which ended the process. Fixed on both sides: the table cuts whole characters
(`engineCut`; in real TTS the cut showed one garbled character) and the headless table logs an unreadable frame
instead of stopping. The safety checks also wait up to 90 s, 5 tries.
