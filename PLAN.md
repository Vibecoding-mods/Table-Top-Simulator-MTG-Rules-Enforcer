# Project plan: rules-enforced MTG Commander in TTS

Last updated: 2026-10-20. The design is in [SPEC.md](SPEC.md); test results and how to rerun them are in [TESTING.md](TESTING.md).

**Status key:** ✅ done · 🔶 built, needs testing in TTS · ⬜ to do · 💡 idea, not scheduled

---

## From the first friends game: done 2026-10-19 (tested live in single player)
- **Opening hand visible:** draws are only held after a player's first real decision (mulligans are no longer "draws"); one click takes every held card. Tested: 7 cards in hand right away.
- **Casts say how:** web-slinging, flashback, back face, foretell and the like are in the button; identical copies (four Forests) show once; several ways to cast the same card are numbered.
- **Mana creatures and rocks:** one "Mana: tap X" button each, then a colour choice if needed. Q/E on Delighted Halfling also works for the host. Tested both.
- **Fewer passes:** your own main phase only stops when you can do something there.
- **Phase bar:** big bar at the top, "YOUR TURN" in green and the current step in gold capitals.
- **Pass hotkey:** "MTG: pass priority / main button". Each player binds it to P once (Options → Controls → scripting hotkeys).
- **Attack target by clicking:** Q/E an attacker, then click a life counter, planeswalker or battle. Tested: "Target set."
- **Also fixed:**
  - Commanders and decks tucked under the table were counted as commanders ("Exdeath & Exdeath") and pushed further down every game. They are now ignored, and every tucked-away object carries its own spot so it comes back.
  - The table's messages arrive in order (a start could overtake its deck check).
  - The bridge joins a free room when an older one is still busy.
  - Picture preloading goes one at a time (six at once froze TTS).
- **Button delay, measured:** the panel answers in a few frames. The 0.1-0.9 s wait is Forge (the AI takes its priority between your actions). Still to do: instant click feedback, a "thinking..." hint, and Forge's own "pass until" to cut round trips.
- **Remote players' Q/E on mana creatures:** works for the host. Untested for remote players; the panel button is the sure route.

## Spec additions (2026-10-19)
- **Turn timer with a vote:** a turn that runs out isn't skipped automatically. The other players vote to skip it.
- **AFK vote:** players can vote to mark someone away; their turns then pass, or the AI covers them, until they return.

## From the first friends game (2026-10-19, 1v1 over TTS multiplayer): original list
1. **Opening hand held back as draws.** The table counted the opening 7 as held draws, so players had to click Mulligan or click the library one card at a time to see their hand, and the count showed more than 7 before correcting. Fix: never hold draws before the first turn starts or while a mulligan question is open. Taking held draws should also take them **all** with one click (Draw / library).
2. **Alternative costs look identical.** Forge offered Scarlet Spider 4 ways (normal, and web-slinging {R}{G} returning each tapped creature), but the panel showed four identical "Cast Scarlet Spider" buttons. Label every cast with its mode and cost, e.g. "Cast Scarlet Spider: web-slinging {R}{G}, return Delighted Halfling". Apply the same to kicker, flashback, foretell, adventure, morph and similar options.
3. **Tapping creatures for mana (Delighted Halfling).** No tap gesture on the Halfling reached the bridge, and Forest taps were refused because Forge listed no mana ability for it at that moment (most likely already tapped). Log every intent's kind and card, show "Tap X for mana" buttons in the panel for every untapped mana source, and test Q/E on mana creatures for remote players.
4. **Button delay is still felt.** Measure click → panel update time per player, including remote players, and remove any wait.
5. **Fewer passes.** Don't ask a player to pass when they can't do anything: no instant, flash, activated ability or response available. That includes their own main phase when nothing is castable or playable (Arena auto-passes this too). Keep the Stop toggles for players who want to hold priority.
6. **"P" passes.** A keyboard shortcut for Pass priority (scripting hotkeys or onScriptingButtonDown), plus the big button.
7. **Phases large and obvious.** A big phase bar (Upkeep, Draw, Main 1, Combat, Main 2, End) with the current step highlighted and whose turn it is, readable from across the table.
8. **Attack target by clicking.** After choosing an attacker, click the opponent's life tracker or player badge, or a planeswalker or battle, to choose what it attacks, instead of the first target A-Z.
9. **Engine card support.** Forge in our Docker image (manabrew-node, built 2026-10-17) has sets through Star Trek (Nov 2026), so new mechanics exist in the engine. Problems with keywords are most likely in how the table presents them (see 2). Show keywords and abilities clearly on hover.

## Next up (user's order, 2026-10-18)
1. **Picture and name check for every card**, about 2 minutes: every name in `bridge/forge-cards.json` gets a picture lookup, and failures are listed.
2. **Automated games on 60–100 representative cards** covering every prompt type and card layout (double-faced, split, adventure, flip, meld, saga, planeswalker, aura, equipment, tokens, copies, face-down), about a day. **Order: most popular first (EDHREC rank), then newest sets**, so the cards the group is likely to play get tested first.

## Where we are (updated 2026-10-31)

All 19 gap decks and 127 keywords are played. Turn timers (`mtg timer`) and hold priority (`mtg hold`, Hold button) work through the table. The engine builds from public source plus `engine/`. What's left needs other people (4 humans, hand privacy, M7's 2-person test, M5's sync test) or is optional (effects, sounds, game modes, 5+ seats).

Notes below from 2026-10-20:

Everything runs end to end in real TTS, and has been played over TTS multiplayer with a friend (1v1).

```
TTS (group table, ENGINE MODE) ⇄ bridge.js ⇄ Manabrew relay ⇄ self-hosted node ⇄ Java Forge
            ✅                       ✅            ✅                 ✅               ✅
```

- **Stutter:** fixed. Rewind snapshots, `destruct()` pauses and JSON size are all solved; a full game's worst frame is ~244 ms. See the stutter notes below.
- **Rules coverage:** every keyword the first pass flagged is now played: 42 of 47 in the headless recheck, the last 5 (Aftermath, Fuse, Enrage, Fight, Spree) by the scripted check; 0 rules-engine errors (`docs/keyword-test-results.md`).
- **Big late-game board (2026-10-20):** 4 players vs 3 harmless AIs to turn 103, 125 permanents: 127 fps, median frame 6–7 ms (flat as the board grew), ~1 frame over 250 ms per 30 s of fast AI play, `mtg reset` under 1 s, 0 errors (`tools/bigboard-test.sh`, QUIET=1).
- **Table bugs from testing:** P1, P2, P3, P4, P7 and P8 are fixed; P9 is fixed but not yet confirmed in a real game (`docs/problem-log.md`).
- **Engine link recovery (2026-10-20):** the bridge reconnects to the relay by itself (heartbeat every 20 s, retries for up to ~1 min, resync of board and question); tested live by restarting the relay mid-game: back in 3 s, game finished with 0 errors.
- **Next real-world checks:** a game with friends (hand privacy, remote players' gestures, measuring the host's upload with `tools/net-upload-meter.ps1`).
- **2026-10-20, review and tests (jr-programmer-suite):** the bridge went through all stages (structure, simplify,
  correctness with 20 findings fixed or decided, claims, docs); golden masters for the bridge (145 scenarios) and the
  table script (two recorded games replayed on fengari), both graded by mutation; rule checks M0.5 pass; a 4-player
  game to turn 17 with no errors (slowest update 118 ms). The table script went through the same suite (golden master graded SOUND: 26 mutations, 1 equivalent escape; claims; relation test).
  Commands: TESTING.md, "Golden masters and rule checks".

---

## Done ✅

| | What | Where |
|---|---|---|
| Research | Decided the approach: no MTGA decompiling. TTS is the front end and Forge is the rules engine, through Manabrew | `Desktop/mtg-tts-engine-handoff.md` |
| Spec | Architecture, protocol, UI, latency targets, licensing, milestones | `SPEC.md` |
| Setup | Docker Desktop installed; virtualization enabled in the BIOS | — |
| M0 (stack) | Relay, web client and a 4-seat Forge Commander room run locally | `stack/compose.yml` |
| M1 | TTS ↔ bridge echo: **p50 10.4 ms**, p99 13.7 ms (target < 30 ms) | `bridge/echo-bridge.js`, `tts/echo-test.lua` |
| M2 | Engine round trip with 2 and 4 seats; the auto-player answers every prompt type | `bridge/engine-test.js` |
| M2b | Change-only updates (`stateDelta`): messages 9× smaller, relay hop ~4 ms, 0 mismatches | `bridge/state-delta.js` |
| M2c | 4 test clients, no AI: **p50 21.5 ms**, p95 91 ms engine plus relay | `TESTING.md` |
| Test notes | Every test documented and rerunnable | `TESTING.md` |
| M3 (code) | Bridge plus text board: per-player panels, every prompt as buttons, chat commands | `bridge/bridge.js`, `tts/mtg-board.lua` |
| M3 (headless) | A stand-in for TTS played 9 turns against Forge AI with no errors | `bridge/test-fake-tts.js` |
| Table review | All 119 scripts of the group's table reviewed for engine compatibility; security issues found | `table-review/COMPATIBILITY.md`, `tools/extract-tts-scripts.js` |

**Estimated latency, click → TTS gets the update (4 players):** ~32 ms typical, ~105 ms p95, before TTS rendering. The target is < 150 ms.

---

## Arena-style interaction (2026-10-20, from the user's video + an MTG Arena reference video)
- [x] **Choose cards on the table.** Any question whose options are cards on the table or in your hand (put on the bottom, discard, Brainstorm, mulligan put-back...) makes those cards glow white; a click chooses one (red), a second click undoes it. Clicking your library confirms "put on the bottom/top"; dragging still works. Tested: mulligan → "Put 1 on the bottom" → click Cathartic Reunion → click library → done.
- [x] **Playable cards glow green in your hand, only for you.** Drawn by the card's own UI with `visibility` set to the owner (TTS highlights are seen by everyone). Toggle: `mtg glow`. Each frame is built once and then only shown/hidden: 8 toggles cost one 65 ms frame (a full rebuild each time cost up to 193 ms). Tested: exactly the 3 playable lands framed.
- [x] **Instruction line** under the phase bar (Arena's top-centre prompt), in table terms: "click a card, then your library or Confirm", "click attackers, then a life counter"...; "Waiting for AI 1..." while someone else has priority.
- [x] **Turn banner** "YOUR TURN" / "AI 1'S TURN" in the middle of the screen for 1.6 s when the turn changes.
- [x] **Stack pop-up fixed:** it was a white box. TTS's screen UI can't draw .webp and Scryfall's CDN refuses TTS, so the bridge serves the card's .jpg on the host (`/img/`); remote players see name and text only. Stays 8.5 s. The text no longer shows engine usernames ("tts-Blue-cp9g") or "Ponder (18) - ".
- [x] "End turn (pass until the next turn)" → "End turn".
- [x] Green frame fixed (it was hidden under the card) and checked by screenshot; instruction line moved above the corner buttons; every copy of a playable card glows.
- [x] **Card row** (2026-10-20): order / scry / reveal / small "choose a card" questions show the cards as pictures mid-screen; click to pick or select (red), buttons under them (Keep this order, Top/Bottom, Confirm, Resolve). Checked by screenshot through the real prompt code.
- [x] "Engine: hide" stays hidden for questions the table answers itself (2026-10-20).
- [x] **Every question answerable without the side panel** (2026-10-20): numbers (−/+/Min/Max/OK picker), modes,
  colours (tinted buttons), "which mana?", yes/no and reveals as buttons in the centre row, with the asking card's
  picture; damage splitting shows each blocker. Checked by screenshot and tests/test_table_claims.js.
- [x] **Rewrites from the structural review** (2026-10-20): the bridge says what each question is (`kind`, `dest`) and
  the table reads it in one place (describePrompt; titles only for older messages); one open/close for a player's
  question (engineEnterPrompt / engineExitPrompt); one way to adopt an object as a card (engineAdopt).
- [x] **Panel restyle** to match the table's own UI: Arena pill buttons (orange main, blue alternative), the Engine panel hidden unless pinned.

## M3 ✅ (done; the 2-human item was played as a 1v1 with a friend, 2026-10-19)

- [x] Stop `echo-bridge.js` and start `node bridge/bridge.js`
- [x] Paste `tts/mtg-board.lua` into Global, then Save & Play
- [x] Type `mtg start ai 1` and play a game against Forge AI
- [x] Fix the panel layout and sizing from screenshots (written blind)
- [x] Check every prompt type in real TTS: mulligan, cast, pay, targets, attack, block, scry, yes/no, numbers
- [x] 2 human players on one TTS server (a friend joins), with private hands verified (done: the 1v1 with a friend over TTS multiplayer, 2026-10-19)
- [x] Mark M3 done in SPEC.md (SPEC.md §milestones says Done)

---

## Next milestones ⬜

### M0.5: rules check ✅ (2026-10-20, headless against Forge: `bash tools/rules-check.sh tax|cmddmg`, `node bridge/priority-check.js`)
- [x] Commander tax goes up on each recast: casts counted 0, 1, 2, 3 over four casts (Rograkh killed by its own burn)
- [x] 21 commander damage from one commander knocks a player out: out at 21 commander damage with 19 life left (Kogla, 4 players)
- [x] The option to send your commander to the command zone: offered and taken 3 of 3 times each when it dies (burn), is exiled (Swords, Path, Journey, O-Ring: `rules-check.sh exile`) and is put into the library (Oust, Excommunicate, Unexpectedly Absent: `rules-check.sh library`)
- [x] Priority passes in order around 4 players: 326 passes, 0 out of order; the active player is asked first in 97 of 97 steps (four scripted seats)
- [x] Turn order skips eliminated players: 76 turns in seat order, the eliminated player never active again
- Each checker was shown to fail on a corrupted record (a swapped seat; life 0; 20 damage).

### M4: engine mode for the group's table ("MTG 4 player table - scripted", workshop 2296042369)
Decided 2026-10-17: the group's existing table is the face. The full review is in [table-review/COMPATIBILITY.md](table-review/COMPATIBILITY.md).
- [x] Extract and review all 119 table scripts (keep / feed from engine / reuse / disable / manual layer)
- [x] Decisions (2026-10-17):
  - Treachery = manual honour-system layer.
  - Planechase and dungeons = later (after M4).
  - A separate engine-mode copy, so the original stays untouched.
  - Deck import: see "Deck intake" below.
- [x] Engine-mode copy with the security fixes: `Saves/MTG 4 player table - ENGINE MODE.json`, built by `tools/make-engine-copy.js` from the workshop file. Fixes:
  - Global's hard-coded permission removed.
  - Smart-mulligan button removed and its weighted shuffle turned off.
  - Easy Modules "force … update" turned off, and its self-update.
  - Encoder menu auto-download and the "Update" menu turned off.
  - Phasing and Color Module self-updaters turned off.
  - The rikrassen importer strips scripts from spawned objects and its version download is off.

  Only those 6 scripts plus 1 removed object differ from the original. Still to do: load it in TTS and check that the table works as before.
- [x] **Step 1 (built 2026-10-17, needs a TTS test):** `ENGINE_MODE` switch. `mtg engine on|off` (host/promoted only), off on every load. 346 guards added by `tools/make-engine-copy.js`; each blocked tool posts "[MTG] Engine mode is on: '<tool>' is handled by the rules engine." What's blocked:
  - **Global:** Draw/Scry/Mill/Untap/Mulligan/Reveal buttons, hotkeys, typed numbers, the zone context-menu handlers (incl. the `clearContextMenu` wipe), Get basic, Token copy, Cascade, Random discard, Reveal-until-type, and the "my/your turn" chat.
  - **Trackers:** life buttons and chat; commander damage, tax, energy/poison/experience, mana/suspend and card-counter buttons.
  - **Turns:** Turn Skipper, the Pirate Cannon who-goes-first hook, and TTS's own end-turn button (`Turns.pass_turns=false`).
  - **Card buttons:** Easy Modules clicks, keywords, token marker, phasing, face-down, menu flip.
  - **Other:** Card Importer (import before turning it on), Day/Night clicks and card transforms, the Ring, deck-search tools, the enabler bag (items go back in), Treachery token buttons, and dungeon token spawns.
  - **Deliberately left alone:** highlight mats, timers, hand counters, CardCustom, dungeon room markers, sort hand, notes, dice.
- [x] **Step 3 (built 2026-10-17, headless-tested on the bridge side; first TTS test pending):** `mtg start [ai N]` / `mtg reset` (host).
  - **Bridge:** sends a whole-table model (`t:"table"`, about 5 KB per update, coalesced). Public zones come from any seat's view; each hand only from its own player's view. AI hands are counts only. Cards use the deck's own images; anything else falls back to the Scryfall image URL. AI players take the free table colours.
  - **Renderer:** `tools/engine-renderer.lua`, appended to Global.
    - Spawns locked cards in the Card Importer format, at your table's zones: battlefield grid on the playmat (creatures / other / lands rows, tapped turned 90°), graveyard and exile piles, command zone next to the tax labels, the hand via each player's hand zone, one face-down library marker with a count, and the stack floating over the table centre.
    - Moves cards smoothly when they change zone; removes cards that left.
    - Feeds life, commander damage (per attacking colour), commander tax and `Turns.turn_color`.
    - Shows a prompt panel per player, added to the table's own Global UI rather than replacing it.
  - **Imported decks** step aside under the table during the game and come back on `mtg reset`.
  - **Start rule:** a game only starts when every seated player's deck is ready.
- [x] **Live TTS test of steps 2–3 (2026-10-17, run by Claude through the bridge debug channel):** 8 turns played; board, trackers, tax and reset all work. 3 bugs found and fixed: messages need JSON-string payloads, auto-pay looped, lands stuck in the hand. Details in TESTING.md.
- [x] Visual check round 1 (user, 2026-10-17): fixed pictures, floating cards, the white panel, the hand mismatch, manual moves and dice text (see TESTING.md).
- [ ] Visual check by a person: hand privacy with a second player

### M4-interactive: tabletop freedom, Arena rules (SPEC §10a, decided 2026-10-17)
Players drag and use the table normally; every move is a request the engine accepts or refuses. Each player can only touch their own colour's area.
- [x] **P1 (built and tested live in TTS, 2026-10-17):**
  - Turn-announcement spam fixed: only seated colours get the turn, and only when it changes.
  - Own-area restriction: you can only pick up your own hand, battlefield and command cards. Opponents' cards are look-only; flip, rotate, copy and delete are off.
  - Drag from hand → battlefield = play the land or cast the spell; drag commander → battlefield = cast it with tax. Snaps back with a reason when not allowed ("only at sorcery speed…", "already played a land…", "isn't your priority").
  - Rearranging your own permanents is remembered, including a spell's drop spot while it's on the stack.
  - Drag from hand → graveyard answers a discard prompt; drag to the library answers a put-on-bottom prompt.
  - Priority passes automatically when nothing but mana abilities is available.
  - Cards dropped onto each other into a TTS deck are split back apart; your own decks are never destroyed.
- [x] **Round 4 from user feedback (2026-10-17, tested live):**
  - **AI and other non-imported cards** use the Card Importer's image server (`img.klrmngr.com/large/{front|back}/…`); Scryfall's own CDN failed to load in TTS.
  - **Panel rebuilt to stop the choppiness:** it's built once and then updated in place (no more whole-UI rebuilds). Scrolling no longer resets when you pick something. It has a search box (shown for lists over 8) and A–Z order for card/type/target lists. Example: a "gob" search narrowed 352 creature types to Goblin.
  - **No auto-pass during your own main phases** (Pass / End turn), so turns no longer run out from under you. This was the real cause of "Cavern then Temple": the turn had already passed.
  - **Library is a real face-down deck** with the engine's count. Draws fly off it toward the hand. During a library search it holds exactly the cards you may pick, so **right-click → Search → drag one out** answers the tutor; anything else pulled out goes back. Tested with Diabolic Tutor: 89 searchable cards, the pick went to hand, and the deck returned to 88 face-down cards.
  - **Prompt text:** player names in prompts are replaced regardless of capitalisation.
- [x] **Graveyard and exile as searchable decks (2026-10-17, tested live):**
  - Each pile is a face-up deck (a single card is a plain card), and right-click → Search looks through it.
  - When a prompt lets you pick from a graveyard or exile, dragging that card out of the Search window is the pick. Anything else pulled out is removed and the pile is redrawn from the engine (no duplicates).
  - Cards slide onto the pile, then join the deck. `tryObjectEnterContainer` stops physics from merging cards into engine decks. Only one copy of each pile or library deck can exist.
- [x] Panel text is white (status, title, description).
- [x] Bug-hunt fixes: duplicate library deck while respawning; dragged cards released as soon as the engine confirms them (enters-tapped lands now show tapped); the autoplay stops at game over.
- [x] Game log: the bridge builds its own from the public board, shown on the table's Log panel (no spectator connection needed)
- [x] **Doing it yourself + freeze work (2026-10-18, after the user's video):**
  - **Held moves:** draws, mills and your untaps wait for you. A drawn card stays on top of your library until you click the library, drag it or press Draw. Milled cards wait until you drag them or press Mill; tapped permanents until you press Untap. A per-player "Auto" toggle (off by default) finishes them after 15 s, and a decision that needs a held card releases it at once.
  - **Table buttons:** they're back on the table and call `engineTableButton`: Draw, Mill and Untap release held moves, Mulligan answers the mulligan question, Scry and Reveal point to the panel; otherwise they say "Not now".
  - **Tested live:** a held draw (table 7 cards against the engine's 8, status line shown), the Draw button, clicking the library, and the "Not now" replies. Not yet seen live: held untap, held mill.
  - **Sacrifice by dragging** a permanent to your graveyard answers sacrifice choices, "Sacrifice this token?" and sacrifice-cost abilities (untested live). **Tapping a land at priority** floats its mana (tested: "Your mana pool: R"); dual lands ask which colour.
  - **Freezes:** the video showed 0.2–0.35 s per prompt round trip. Forge asked "return Exdeath to the command zone?" four times. Panel UI calls are now one per button (text, colour and visibility together, alternating whites instead of a second call). Measured: clicks, casts, payments, taps and land drops show no slow frames; short hitches remain on AI turns and draws.
  - **Transformed cards:** each double-faced card's back face is now cached under its own name, with the back picture. Before, the back-face name was never found, so the card showed no back and Scryfall was asked over and over until it refused with 429. Scryfall refusals now back off (5 s, doubling up to 2 min).
  - **Incident:** `tools/tts-push-global.js` ("Save & Play") reloads the table from its last saved state and wiped the user's imported deck and commander, twice. It now refuses while any non-engine, non-test card or deck is on the table.
- [x] **Phase 3 (2026-10-18):**
  - **Step-by-step choices:** the bridge shows one small decision at a time and sends Forge only the final answer (`orderSteps`, `damageSteps`, `scryPlaceSteps`; a step's toOutput returns `{ __next }`).
    - **Order:** trigger order and damage-assignment order are picked 1st, 2nd and so on, or "Keep this order".
    - **Combat damage:** auto (lethal to each blocker in order) or a number per blocker and the trampled player.
    - **Scry and surveil:** with two destinations, pick the cards that move, then order the top. With three or more, each card gets a destination.
    - **Blocks:** labels note "needs 2+ blockers" and "must be blocked", and picking a blocker for one attacker drops its other pick.
    - Checked offline with test data. Not yet seen live, since the test decks rarely produce these prompts.
  - **Game log:** a "Log" panel (draggable, toggled by its button) shows the last 16 lines. The bridge builds it from public board changes only: turns, land drops, casts, abilities, draws (count only), deaths, exile, tokens, attacks, life changes. It's resent after a table reload. Tested live: correct over 10 turns.
  - **Mana pool:** your floating mana shows in the panel's status line.
  - **Card labels:** counters, damage and changed power/toughness show as a small label on the card. Tested live: "3x Shield".
  - **Table buttons:** Untap, Reveal, Draw, Mill, Scry and the Mulligan tiles move under the table in engine mode and come back when it's off or when the table loads. Tested live.
  - **Click freeze:** TTS's `sendExternalMessage` froze the game for about 80 ms per call, so the table now sends to the bridge with background web requests (`POST /msg`), falling back to the old way if that fails. Casting no longer replaces the hand card with a new "stack" object: the card itself moves, and abilities make their source glow purple instead. Identical board updates are skipped and bursts merge over 40 ms. Measured: clicks, casting and paying no longer cause slow frames. Some short hitches remain when many cards change at once (AI turns, draws), from TTS decoding and its memory clean-up.
- [x] **Playtest fixes (2026-10-18):**
  - **Card pictures:** every image gets its own CustomDeck number, a hash of its URL, so engine cards no longer show the table's "The Ring" picture. `cards.scryfall.io` and klrmngr `large/*.jpg` links are rewritten to klrmngr `display/*.webp`, the format the Card Importer uses. Tokens find their art through Scryfall token search (name, P/T, colours).
  - **Decks:** `mtg start` always re-reads the decks on the table, and `mtg reset` forgets readied decks. A leftover test deck had been dealt instead of the user's.
  - **Panel:** moved to the left and draggable (it covered TTS's Search window). End turn is red, attacker choices red, blocker choices blue. Button text stays white when a button reappears. A **Graveyards / exile** button gives a searchable, look-only list of every graveyard and exile; click a card to read it.
  - **Table:** spells on the stack float above their caster's playmat instead of over the life trackers. Players can flip their own battlefield and command cards (looks only). 125 side-clutter objects removed from the ENGINE MODE copy (counters, dice, keyword markers, commander-damage bags, dungeon and monarch cards, turn-order sheets, skip pucks, Treachery, Planechase).
  - **Stutter:** TTS took 73 ms on average (up to 361 ms) to take in each board update, mostly JSON decoding. Each card's details are now sent once, defaults are left out, and queued board updates collapse into one. Result: about 21 ms per update, about 1.6 KB. `engineProfile` (Lua) and `/stats` (bridge) measure it.
  - **Stutter, root causes found (2026-10-19, PresentMon):**
    - *2.7 s freeze every ~10 s:* TTS's rewind snapshot. Its cost grew with each card's picture number. The engine's hashed numbers (1–20 million) cost up to 25 ms per card per snapshot, against 0 ms for small numbers. Engine pictures are now numbered from 3000 upward, and 30 cards dropped from 707 ms to 4 ms. Old cards with big numbers keep the cost until renumbered; `tools/add-exported-objects.js` renumbers them in a save.
    - *~360 ms freeze per removed card:* every `destruct()` costs that, and five in one frame cost 1.8 s. Merging into a deck is free, so removed engine cards now go into a hidden trash deck in a table corner (`engineDispose`). Measured: no long frames.
    - *Graveyard and library adds silently failed:* a locked deck refuses `putObject`, so cards stayed loose on top. Fixed with `enginePutInDeck` (unlock, put, re-lock next frame).
    - *Messages the table decodes (2026-10-19):* TTS's `JSON.decode` costs ~12–20 ms per KB. Board updates now leave out zones that didn't change (`keep`), library searches send card details once (Cultivate's search went from 13 KB to 6 KB), and picture links travel shortened (`shortUrl` / `engineExpandUrl`).
    - *Clean full game, measured with the in-TTS autopilot and no debug polling:* before these fixes there were 5–12 s freezes. After: max frame 244 ms, p99 9 ms; 19 frames over 50 ms and 4 over 100 ms in 225 s.
    - *Stress ramp (2026-10-19):* 50 → 300 cards on the table took the frame rate from 162 to 103 fps. Idle frames stayed under 140 ms. Moving 20 cards with 300 on the table cost up to 150 ms. A 40-card board wipe cost 69 ms at worst (it was ~14 s before the trash deck). TTS itself runs a ~270 ms asset clean-up about every 3 minutes, even when idle; that one is outside our control.
  - **AI decks from the table (2026-10-19):** a deck with its commander in an EMPTY seat's library and command zone is played by an AI (`mtg start ai N`). `mtg aideck <preset>` picks built-in decks for the remaining AIs; `mtg aideck clear` resets. Added the preset `miles_spider_verse_commander`: a Naya Spider-Man deck with commander Miles Morales, built from Scryfall data and checked against Forge's card list. Tested 3-player: White plus AI Spider-Man plus AI Yuriko, 26 turns, no engine errors.
  - **Web-slinging and ninjutsu checked (2026-10-19):**
    - *Web-slinging:* a test deck (4× each web-slinging card plus 20 Ornithopters) got "Cast Spider-Man, Web-Slinger — web slinging" in main 2 with a tapped creature, and paid {W} instead of {2}{W}. The engine only offers it while you control a tapped creature to return.
    - *Ninjutsu:* the AI used commander ninjutsu and ninjutsu every turn. A human Yuriko deck saw the commander ninjutsu option in the panel, but the Arena-style auto-pass skipped combat. Fix: the bridge now always stops after blockers, and in the combat damage steps, when a ninjutsu or sneak action is available.
    - *Labels:* "(WebSlinging): web slinging" now reads "— web slinging".
  - **Table interaction (2026-10-19):**
    - *Colours:* white = can attack/block; red = attacking or a picked target; blue = blocking; orange = can be targeted.
    - *Combat:* attackers stay red and blockers blue for everyone until combat ends (board fields `atk` / `blk` from the engine's `isAttacking` and blocker list).
    - *Attacking:* click your creature to attack, then a life counter or a planeswalker to choose what it attacks; click it again to cancel.
    - *Targets:* players' life counters glow too.
    - *Equipment and auras:* half size beside their host, with the row making room.
    - *Win/loss:* "has lost" and "GAME OVER – X wins" go to everyone.
    - *Tested by clicking through the table's own handler (tools/tts-gesture-test.js):* attack then life counter → the engine got "attacker|player-1"; damage and sacrifice targets were answered by one click; Smoke Shroud showed at 0.5 scale beside its host; "White has lost / Red wins" was announced.
  - **Keyword test:** `tools/make-keyword-decks.js` builds 6 decks with one card for each of 324 keywords; `tools/run-coverage.sh 25 tmp/kwdecks/kwdeck-0*.json`, then `tools/keyword-report.js` → docs/keyword-test-results.md.
    - *First pass (2026-10-19):* 6 games, 0 engine errors. 25 keywords played, 24 more seen, 261 never drawn (one game draws ~25 of 100 cards). The problems were table sync, not keywords:
      - a commander back in the command zone stayed at its battlefield drop spot (**fixed**: `engineManualLanded`);
      - intermittent "missing object" for cards that had been milled or played: not reproduced on the rerun; `engineDebugCard` now explains it in the checker output;
      - "should be tapped" and "missing (hand)" at single steps are the checker catching a rotation or a draw mid-update.
    - *Recheck (2026-10-20, headless, small decks with tutors against Errant + 99 Islands):* 42 of the 47 flagged keywords now played, 0 table problems on them, 0 engine/TTS errors. The last 5 (Aftermath, Fuse, Enrage, Fight, Spree) pass in `bash tools/rules-check.sh keywords`, which casts each on purpose (0 engine errors). Every flagged keyword is now played.
  - **Online notice:** `mtg start` with other people seated tells everyone that the host needs at least 5 Mbps upload (10+ recommended), a wired connection and no VPN. This is a guideline, not measured yet: run `tools/net-upload-meter.ps1` on the host during an online game to measure it.
  - **Not possible yet: friendly (free) mulligans.** Forge has no free-mulligan setting, and answering its "put N on the bottom" with fewer cards would abort the game. It needs a Forge change.
- [x] **P2 (2026-10-18):** gestures answer the open prompt exactly like the panel buttons do.
  - **Pay by tapping:** Q/E on a glowing (gold) land or mana source taps it for the cost. Turning a tapped one back gives its mana back. The payment finishes by itself once the last tap covers the cost.
  - **Attack by tapping:** Q/E on a glowing (red) creature toggles it as an attacker, and it glows green when picked. Confirm in the panel. With several opponents it attacks the first one in A-Z order; pick others in the panel.
  - **Block by clicking:** click your glowing (blue) creature, then the attacker. Confirm in the panel.
  - **Click to target:** click a glowing (orange) card, or a player's life tracker. When the required number is picked, it answers right away.
  - **Right-click to cast:** spells and abilities you can use appear in that card's right-click menu during your priority.
  - **Guard:** a multi-choice answer outside min–max is refused and asked again, both in Lua and in the bridge. An empty "choose 1" made Forge abort a game during testing.
  - Known limits: glows are visible to every player (TTS highlights aren't per-player). The prompt type is read from the title.
- [x] **P3:** library as a real face-down deck (draw animation; tutors via right-click → Search); table buttons mapped (Mulligan, Scry via πScry, Draw, Untap, Mill) (built: Round 4 and "Table buttons" above, 2026-10-17/18)
- [x] **P4:** Arena feel (highlights, sounds, shake) (moved to M5)
- [x] Layout tuned from TTS screenshots through the 27 hand-test decks
- [x] Spawn cards in the Card Importer's format at Global `data[color]` zone positions; lock them; track engine ID → GUID (built in M4 step 3: `place()` in tools/engine-renderer.lua)
- [x] Feed the displays: life, commander damage, commander tax, `Turns.turn_color`, phase, energy/poison, and Encoder overlays (P/T, counters, keywords, phasing, token, face-down) (built: `updateTrackers`, the M5 badges)
- [x] Hands in TTS hand zones (hidden), library as a face-down pile, stack area (built: hand zones, library deck, stack spot)
- [x] Prompts in the table's style: πScry for scry/surveil, ✓/✗ for yes/no, πMenu for card actions, side panel for the rest (replaced by the Arena-style panel and wording, 2026-10-20/22)
- [x] Click-to-select cards on the table for targets, attackers and blockers (P2)
- [x] Real UI for trigger order, damage assignment order and combat damage split
- [x] **Step 2 (built 2026-10-17, headless-tested; TTS test pending):** `mtg ready` / `mtg ready all` (host) / `mtg commander` (hover a card).
  - **Table side:** Global reads the deck in your library zone plus the card(s) on your command zone. Treachery identity cards are skipped. It sends their names and images to the bridge.
  - **Bridge side:** it checks every name against Forge's 33,975 cards (`bridge/forge-cards.json`, built by `tools/build-forge-card-index.js`), handling split cards, double-faced back faces and accents.
  - **Report:** the bridge sends back ready / not ready with reasons (no deck, no commander, unknown cards), plus warnings for card count and extra copies.
  - **Game start:** a ready deck is used for that seat, with names only. Verified: Forge accepts decks with no set codes and picks the printings itself.
  - **Test:** `bridge/test-mtg-ready.js`.
- [x] Deck intake: **keep importing exactly as today** (Card Importer), with the commander placed in the command zone. Then type `mtg ready`: the bridge reads the deck and commander objects, checks every name against Forge's card database, reports anything Forge doesn't know *before* the game starts, and keeps each card's own image (custom art included). Fallback: paste an Archidekt/Moxfield link to the bridge. (built: Step 2 above, `mtg ready`)
- [x] **Test 3 (2026-10-20):** large 4-player board, 125 permanents: board update avg 36 ms, max 152 ms (target < 300 ms met); frames 127 fps median 6–7 ms. Polish later: the update re-checks every card even when nothing moved (timers per section now in `engineProfile.sect`).
- [ ] 4 human players on the real table

### M4.6: Treachery as an honour-system layer ✅ (built 2026-10-20; live test with 4 people pending)
- [x] Keep the randomizer and identity cards as they are; the engine runs a normal 4-player Commander game underneath
- [x] Identity cards' token-spawn buttons are refused in engine mode (`guard("Treachery identity token buttons")`, 10+ functions)
- [x] Identity cards are never read, moved, stashed or swept: the deck reader skips `Identity` names, the stash skips them, the engine's cleanup only touches `engine:` objects
- [x] Command-zone slot: engine commander cards go on the command-zone label spots (one per commander), so with one commander the second spot is free for the identity card (with partners, put it beside them)
- [x] `mtg concede` (asks once more, 15 s) and `mtg winner <colour>` (host: everyone else at the table concedes; AI seats can't, the host then types `mtg reset`). Engine side checked headless: `bash tools/rules-check.sh concede` → conceded, game over, the other player wins
- [ ] Not possible: "the Leader goes first" (no engine option to choose the starting player); unveil costs and identity powers stay honour-system

### Later (decided 2026-10-17): Planechase and dungeons
- [ ] Drive the Eternities Map centre plane and the dungeon room markers (one per player) from the engine; turn off their manual moves and token spawns. See `table-review/notes-variants.md`.

### M4.5: rewind by vote ✅ (built 2026-10-20; needs a table reload and a 2-person vote test)
- [x] Engine side checked headless (`bash tools/rules-check.sh rewind`): checkpoints ~8 per turn, last 25 kept; a restore to "turn 6 upkeep" from turn 8 brings back life, commander casts and every zone exactly (3 of 3 runs)
- [x] "Undo..." button (bottom right) lists the last 12 points (upkeep, main, attacks, second main of each turn); `mtg undo` / `mtg undo N` in chat
- [x] Sends `requestRestore` / `restoreVote` directives; refuses unknown points, a second vote, players who are out, votes not awaited
- [x] Vote pop-up for the awaited players (Rewind / Keep playing; `mtg vote yes|no`); request, decline and "no longer kept" posted to chat. Against AI only it applies at once (Forge asks humans only)
- [x] After a rewind the bridge closes the question that was open (an answer to it crashed Forge in a test) and the per-player turn count goes back too
- Tests: bridge golden 151 scenarios (8 deliberate breaks of the rewind code, all caught), table golden 705 steps (7 of 7 caught)

### M5: Arena feel (plan: docs/m5-plan.md; research: reports/MTG Arena style effects for TTS.md, reports/MTG Arena effects from gameplay video.md)
- [x] **Step 1 (2026-10-21), no AssetBundle needed:**
  - glow colours after Arena's code: green = you can act on it (targets, attackers, blockers, cards to choose), orange-gold = chosen; red/blue stay attacking/blocking;
  - lines for everyone: cyan arcs from a spell (or an ability's source card) to each target (card, player's life counter, other spell), red-pink attacker → player or planeswalker, gold blocker → attacker (players' own drawings are kept);
  - turn banner gold for your turn, blue-white for someone else's, fading in and out;
  - the stack pop-up stays while its spell is on the stack (at least 2.5 s) instead of a fixed 8.5 s.
- [x] **Step 2 (2026-10-22):** life changes on the life counters (red "-N" / green "+N" under the number for 3 s, changes within 3 s add up, nothing on a game's first board); card badges in Arena's layout (power/toughness bottom right: blue raised, red lowered or damaged with damage taken off toughness; loyalty/defense there for planeswalkers and battles; +1/+1 and other counters as a dark-blue tag top right; "xN" top left on grouped tokens). Checked in real TTS (screenshots). The counters' own change line was a 0-size button TTS doesn't draw: it gets a size while it shows
- [x] **Sylvan Library and "pay or else" questions (2026-10-22, from playtest):** clear wording ("Pay 4 life? (1 of 2)", "No: put a card on top of your library", "which card goes back?"), playable on the table (the drawn cards reach the hand; drag a chosen card onto the library to put it back; Mystic Remora to the graveyard to sacrifice it). Checked headless against Forge: 11 Sylvan rounds in one game, 22/22 drags
- [x] **Effects without an AssetBundle (2026-10-22):** knocked out (DEFEAT for that player, "<NAME> IS OUT" for the others, their life counter goes dark), game over (gold VICTORY / violet DEFEAT, 2.5 s after the knock-out), deaths (the owner's graveyard pile flashes violet, "xN" when several die at once: a board wipe shows once), countered spells (the stack pop-up shows "COUNTERED: <spell>", only for a spell a "counter target" spell or ability was aimed at). `mtg effects on/off` turns a player's own big banners off
- [x] **Bridge crash recovery (2026-10-22):** the running game is saved every 5 s; a restarted bridge rejoins it as the same players within the relay's ~60 s grace. Checked live: bridge killed twice mid-game, the game carried on to the end
- [x] **Playtest fixes (2026-10-22, from 4 recordings):** the Engine panel is hidden unless you pin it (Engine: show) or a question the table can't answer is open, and closes again after it; the stack pop-up has an X (closes it for you only, until the next card); plain question titles ("Use Mirri's Guile?", "Shuffle your library?", "Mystical Tutor (up to 1)", no repeated "Source: X", ability text cut to ~160 characters); order questions in plain words ("Mirri's Guile: click the card to put on top", "Your triggers: click the one that happens first", cards bound for the bottom say the order hardly matters); "Choose a color" while paying lists the colours the cost needs first, marked "(needed)" (Command Tower kept offering White for {1}{B})
- [x] **Ease-of-use pass over the 24 hand-test decks (2026-10-22):** every question the headless hand-play bot met is recorded with what the player saw (`tools/question-review.js` → tmp/handplay/questions.md) and reworded in Arena's style (see docs/our-code-reference.md, "Arena wording"); the pass button reads Next / Resolve, Confirm reads Done
- [x] **Mills like the table's own Mill button (2026-10-22):** milled cards held for you come off the library turning face up, a beat apart, and slide into the graveyard pile when let go; other mills (AI players, more than 5) fly face up from library to graveyard as stand-ins (the first 5). The library's plain backs no longer fly to the hand on a mill (`libraryAnimTo` was never set)
- [x] **Attack swing (2026-10-22, after Arena, reference video hOY2wZcuMJk 12:11):** at combat damage each attacker winds up (lifts, pulls back), lands on its blocker / the planeswalker / the back centre of the defending player's board (Arena's player portrait), and goes back; attack and spell target lines aim at that back centre too
- [x] **Settings button (2026-10-22):** My effects (your banners, turn banner, stack pop-up), My sounds (ready for the sounds), Table animations (host only: swings, mills, the graveyard flash, which everyone sees); also `mtg effects|sounds|animations on/off`
- [x] **Linked exile, playable exile, face-down exile on the table** (research: reports/MTG linked exile and zone quirks.md). Built 2026-10-23, golden-tested; waiting on a live check with our Forge build:
  - our node image (`mtg-forge-node:exile`) sends `exiledWith`, `returnsWhenHostLeaves`, `isForetold`, `mayPlay` per card (Forge's own `getExiledWith`, `getUntilLeavesBattlefield`, `getCardsActivatableInExternalZones`)
  - bridge: `ew` / `rl` / `fo` per card and a `playable` list per seat
  - table: a public playable row (green glow) in front of the second hand zone, private ones (foretold, face-down) inside it, linked cards half-size under their permanent; dragging a playable card onto the battlefield plays it
  - [x] `stack/compose.yml` runs our images; headless live check passes (`rules-check --game exile`: the commander reported as exiled with the removal spell)
  - [x] a hand test in TTS (2026-10-31): Tibalt's exile linked and playable, including the AI's cards, a spell and a land played from it; Banishing Light exiled and returned when it left; foretell cast from its private zone; flashback earlier (HAND-TEST-HP04)
- [x] **Playtest fixes (2026-10-23, second batch):**
  - card pictures in the card row and the stack pop-up for every player (wsrv.nl serves Scryfall's jpg; the host's local /img route reached only the host, Blue saw grey tiles)
  - the screen UI for four players: each element's look becomes a shared class in <Defaults>, and the answer list pages at 30 ("More..."): one seat 27 KB, two 39 KB, four 57 KB (was ~90; the second player's buttons died past ~64 KB)
  - flick containment: a movable card nobody holds that ends up off its owner's mat is stopped and slides back (5 checks a second; free on your own mat; off during a manual fix)
  - Cancel on the card or sacrifice question of a non-mandatory cost of a spell or ability (sacrifice, discard, exile, return, tap...), in the corner: the spell goes back and the lands tapped for it untap (our Forge build: `cancellable` on chooseCards, cost-payment frames, the cast's mana abilities undone; checked live with `rules-check --game costcancel`). A part of a two-part cost paid before the question stays paid, as in Forge
  - [x] "Resolve" stops: 292 logged stops sampled 2026-10-31, each with something to respond with; `mtg hold` covers your own spell
- [ ] Step 3: the 2-player sync test (do effects, highlights and bundle sounds show for everyone?), then one test AssetBundle (Unity 6000.0.62f1 vs the installed 6000.3) with a pooled effect
- [ ] Step 4: pooled particle effects for death (smoke + shatter), countered spell, damage hit, player knocked out; CC0 sounds (Kenney, Cockatrice set)
- [x] ~~Camera shake~~ dropped: none in any Arena frame (video research)

### M6: 5–8 players
- [x] `SEATS=6 docker compose up -d forge-room`, then `node bridge/engine-test.js --seats 6 --turns 12` (2026-10-20): 1 test seat + 5 Forge AI to turn 12 in 24 s; 113 answers, 0 resyncs, 0 fingerprint mismatches; response → next engine message p50 182 ms / p95 356 ms (mostly the 5 AIs thinking between our prompts; relay hop p50 9 ms). Room set back to 4 seats afterwards
- [x] The lobby's 4-seat limit doesn't block it: the room the node creates with `SELF_HOSTED_NODE_MAX_PLAYERS=6` seated all 6
- [ ] A full game in TTS with 5+ seats: **blocked by the table**, which has 4 playmats and 4 seat colours (`TABLE_COLORS`, the bridge refuses more). Needs a 6–8 seat table (TTS has 10 colours) and its geometry in `seatGeometry`

### M8: game modes (spec 2026-10-21: docs/game-modes-spec.md)
- [x] **Ready / Start buttons (2026-10-21, revised with the user):** a small READY? just below each seated player's Draw button (yellow → green when the deck checks out, red "FIX DECK" with the reason in chat; only that seat's player can press it; = "mtg ready"; press again to un-ready). A ready player's own table buttons (untap, reveal, draw, mill, scry, mulligan) go under the table until they un-ready or the game is reset. "Start" appears between the four life counters only when every seated player is ready; anyone can press it (= "mtg start"; alone: against 1 Forge AI); hidden during the game, NEW GAME afterwards (host, = "mtg reset"). Engine mode only. Checked live on the table
- [ ] Standard 1v1 (our side only: no-commander decks, 20 life)
- [ ] Engine spike: teams, per-player starting life and hand in Forge (needs the forge submodule)
- [ ] Teams + per-player settings through protocol, harness and node (fork or upstream PR); 2v2 Team Commander
- [ ] Juggernaut 3v1: settings, perks (extra draw), "Juggernaut wins" / "team wins"
- [ ] Later: Two-Headed Giant (shared life), Juggernaut turn-order option, Archenemy schemes

### M7: manual fix mode by vote (§10c Tier B; needs engine work)
- [x] Check out the `forge/` submodule (Forge's own puzzle setup is the model: triggers suppressed, apply, state-based actions)
- [x] `applyState { fixId, ops }` directive and `stateFix` answer in `manabrew-protocol` (2026-10-23)
- [x] Handler in `forge-harness`: refuses with a spell on the stack, restore point before, triggers off while applying, state-based actions after, the whole list undone on any failure
- [x] Our own images (`mtg-forge-node:exile` + `mtg-relay:exile`: the stock relay drops the new directive); `rules-check --game fix` passes on a real Forge game
- [x] Bridge: vote → pause (the next empty-stack priority question is held) → editing → review vote → apply; refusal back to editing; Cancel (golden-tested, 27 mutations caught)
- [x] TTS: Fix... button, fix panel per state, cards unlocked while editing, board held, Done reads the touched cards; chat: mtg fix / yes / no / done / cancel / life / poison / counters
- [x] From the table (2026-10-23): drop an aura/equipment onto its permanent (attach; put down alone = off), right-click "top / bottom of its library", the life and commander-damage counters work while editing and are read at Done, `mtg fix token <what> [for <colour>] [tapped]` (Forge's token scripts, `bridge/token-scripts.json`)
- [ ] Snap points (not needed so far: `dropArea` reads the zones)
- [ ] Live test with 2 people

---

## Ideas 💡 (in the spec, not scheduled)

| Idea | Spec | Notes |
|---|---|---|
| Companion .exe: choose self-host or dedicated server | §10b | The bridge always stays on the host's PC. Self-host also starts Docker. Status lights, latency readout |
| Dedicated server | §10b | TLS relay, strong server key, measure the internet round-trip cost (~62 ms measured by Manabrew) |
| Bridge forwards editor messages to VSCode | §8 | Lets the host use the VSCode TTS plugin while the bridge runs |
| Decklist import | §11 | Paste an Arena/Moxfield list instead of using only Manabrew's preset decks |

---

## Open questions / risks

- **Forge Commander rules:** confirmed headless on 2026-10-20 (M0.5): tax, 21 commander damage, command-zone choice, 4-player priority, turn order after elimination.
- **TTS render speed on a big board:** answered 2026-10-20: fine at 125 permanents (avg update 36 ms, worst 152 ms).
- **External Editor message size:** does TTS cut off very large messages? Patches keep them small (~1 KB), but the first full state is ~25 KB.
- **Slow tail in the engine:** p95 ~90 ms. Check whether it's the engine or CPU contention by running clients on another machine.
- **Manabrew is pre-release and changes fast:** the Docker images use `:latest`. Pin a version once the board works.
- **Licensing:** fine for private play. Before publishing on the Workshop or running a public server, review §9 (AGPL obligations if Manabrew is modified, e.g. for M7).

---

## Everyday commands

```bash
cd stack && docker compose up -d      # start the engine stack
node bridge\bridge.js                 # start the bridge (TTS must use tts/mtg-board.lua)
```
In TTS chat: `mtg help`, `mtg start ai 1`, `mtg deck <id>`, `mtg decks`, `mtg reset`.
