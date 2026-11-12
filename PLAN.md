# Project plan: rules-enforced MTG Commander in TTS

Last updated: 2026-11-10. The design is in [SPEC.md](SPEC.md); test results and how to rerun them are in [TESTING.md](TESTING.md).

**Status key:** ✅ done · 🔶 built, needs testing in TTS · ⬜ to do · 💡 idea, not scheduled

---

## 2026-11-11
- ✅ Round 3 live check (deploy 05641398 / 71f6557, scenarios/live-r3.json, White vs a Forge AI, 21:36–22:01):
  - passed:
    - Green glow: on Prodigal Pyromancer only, not on Llanowar Elves (its ability makes mana).
    - Mill with Auto on: Thought Scour on White, nothing held in the air, 3 cards in the graveyard.
    - Glimpse on the AI: 10 cards in the AI's graveyard, all named in the log.
    - "attacks Jace Beleren (AI 1)" for Hero and a token.
    - The per-token "attack which player or planeswalker?" reads "AI 1" on the table.
    - The attacker gets priority after blocks.
    - Giant Growth logged before combat damage.
    - Counterspell on your own Giant Growth ("is countered by Counterspell").
    - COMBAT green on your turn, red on the AI's; All attack green, Done red.
    - Blocks: Grizzly Bears blocks Craw Wurm.
    - Sounds: death played and paused; 4 deaths gave wipe_x4.
    - Game over: banner, chat, "you can only touch your own cards".
    - After reset, the music player stays paused.
    - The debug Jace had its loyalty (1 → 3 on +2).
  - not seen:
    - The COUNTERED pop-up: it shows for 1.8 s and the capture came later.
    - The chat confirmation on a block click: the game was driven by script because a Razer pop-up blocked clicks.
    - Custom art, and the companion's presets and debug tools.
  - found, sent to the bug fixes:
    - No priority stop after your own Lightning Bolt in main 1, but there was one after Giant Growth in combat.
    - "White attacks with Soldier token" and "AI 1 attacks with Craw Wurm" don't name the player attacked.
    - Fury's 4 deaths were logged after the next action (Jace +2), 23 s late.
    - "Sneak Attack is exiled" for Fury's evoke cost doesn't say why.
    - The AI's attack line ends on White's lands row, not the heart.
- ✅ Round 1 seen on the real table (live check, scenarios live-r1*.json): the Free mulligans button, the Day piece
  mid-table, the flashback row card's hover, a planeswalker clicked as Lightning Bolt's target, "Attack whom with Hero
  of Bladehold 3/4?" offering the AI's planeswalker (answered by clicking it), the Propaganda tax hint, attackers with
  their sizes. The monarch's mat also showed Undercity, City's Blessing and The Ring: a bare `local` in a for-in body
  is the looped table in TTS. Fixed with three more such locals (one dropped the ability panel's greyed reasons) and a
  gate, test_moonsharp_loop_locals (f51b184), deployed and seen fixed.
- ⬜ Found in that check, not fixed: a debug scenario's planeswalker enters with no loyalty and dies at once (✅ fixed
  in 8fb86e6, live in c9295fcc); a player-or-permanent choice the bridge can't map (two cards of one name anywhere) still reads "choose one" with
  "Jace Beleren (201)"; the log's "White attacks with Hero of Bladehold" doesn't name the planeswalker, and it put
  the Giant Growth cast (declare-attackers step) after the combat damage; a mid-game `mtg debug` without keepHand
  bottoms the hand and adds 20 lands. The pump-on-attacker payment title wasn't seen (the pool paid by itself).
- 🔶 (source, live check fixes) The side game log shows the newest entries that fit its box by estimated rows (58 a
  row, 18 rows), the newest always, a giant one cut with "…" (engineLogFit): wrapped lines no longer push the newest
  out of the bottom.
- 🔶 (source) A life counter or planeswalker clicked for an attacker says what it set: "Hero of Bladehold 3/4 attacks
  AI 1." / "... attacks Jace Beleren (AI 1).", "6 creatures attack AI 1." for a stack, not "Target set."
- ✅ (seen live 2026-11-11 round 3) The attacking player gets priority after blockers when something blocks and they hold a non-mana action
  (attackerStop), as Arena: Craw Wurm blocking Hero of Bladehold passed White's Giant Growth by.
- ✅ Tests can't reach the live table: tests/no-live-ports.js refuses and records every connection to 39999, 39998,
  48787 and 9443 (and the harness's decoy TTS port 1), failing the run; the All attack check that put its chat into a
  real game twice now runs before restore().
- 🔶 (source, needs the next node image) Hero of Bladehold's per-token "attack which player or planeswalker?" names
  the token: the harness sends Forge's question ("Choose which defender to attack with Soldier Token") as the
  description and the token (chooseSingleEntityForEffect's Attacker param) as the question's one target
  (AttackDefenderChoiceTest); the bridge titles it "Hero of Bladehold: Soldier Token 1/1 attacks which player or
  planeswalker?" (or "... attacks whom?" in words) and the table lights the token red (ui.attacker). Bridge and table
  need deploying with that image.
- Checked 2026-11-11 (engine bugs pass): the debug planeswalker's loyalty (8fb86e6) is in the deployed engine
  c9295fcc and seen live (scenarios/live-r3.json, Jace kept 3); no failing case found (either side, mid-game, four
  walkers: ApplyStateCreateCardTest). The Mindslaver auto-pass (no defect: on the controlled turn White had no Plains
  on the battlefield, so Reflect Damage was not castable; table-log #45-#76) and the passive AI's Counterspell
  (PassiveLobbyPlayerAi, in c9295fcc) stay as under "Live-check bugs" below.
- 🔶 (source) The companion's TTS light goes green only for a table heard since this TTS started (/versions
  tableHeardMs against the TTS process start time), not for the last session's stamp.
- 🔶 (source) AI seats are named as the game log names them in the rewind list and vote ("AI 2's attacks"), and a
  harmless bot isn't "waited for" in the vote chat or banner (it votes by itself).
- 🔶 (source) The companion's game banner says "turn 6, 3 players (2 AI)." (/state players and ai), not "1 seats.".
- 🔶 (source) Fixed: the "COUNTERED: <name>" pop-up never showed for a countered instant or sorcery (it needed the
  stack item's `spell`, which is false for any spell with spell text). The bridge now marks those `sp`, and the
  pop-up takes either (test_table_effects, red without the fix). Needs the bridge and table deployed together.
- ✅ (seen live 2026-11-11 round 3) Reported by the user 2026-11-11: when a card is milled, its move to the graveyard sticks part-way until the
  player clicks the card in flight (the "pile" it is moving to the graveyard). Found: with Auto on, a seated player's
  mill was held face up in the air a quarter of the way to the graveyard until Auto let it go ~2 s later (a click on
  it let it go at once). Now, with Auto on, mills aren't held: they fly to the graveyard as stand-ins, like an AI's;
  Auto off keeps the hold. To see on the next real-table session.
- ⬜ Custom card art (docs/custom-art-spec.md): the user said yes to every default (2026-11-11). Order: first check on
  the real table whether a plain card's link already keeps its picture in engine mode; then the plain-cards slice;
  DFC backs later. Art for game-made tokens and the AI's decks: a later item.
- ⬜ Cost badge (docs/cost-badge-spec.md): the user's design, a counter-token look (like the Mindsplice app's
  counters) covering the colorless number with the new total. Ready to build.
- 🔶 (source) Small queued bugs, bridge and table side (docs/next-features-2026-11-09.md "Also queued"), each
  reproduced by a test from its real report first: the flashback row card's hover-text alarm; a stray copy left
  beside a pile (Rancor) and plays queued for graveyard cards; payment taps that can't pay anything owed (Viscera
  Seer's loop); attackers listed with their size and numbered; one spell's draws split by a dredge question joined into
  one log line; the self-check's playable cards judged on the caster's mat and hand. Not changed: the rewind vote (the
  only open one in the logs waited on Blue, who never voted), "#10 after #1" (already fixed 2026-11-09, Kykar #9), the
  cipher copy's "casts" (still no recorded board of it).
- 🔶 (source) Attack reminders, spec part 2 (item 23): taxes per defender, each creature's own price and the limits
  are listed on the attack question, with "Can't attack: X (reason)" and the reason on Q/E. The tax payment names
  the tax and its Cancel is "Don't attack with X". Part 3 (engine) in source 2026-11-11: Forge's own taxes,
  reasons and limits on the attackers prompt (War Tax, Sivitri, emblems), text reading kept as the fallback; needs a
  node image build from engine/manabrew.patch.
- 🔶 (source) Attack targets (item 25): "Attack" and "All attack" ask whom when there is more than one player or
  planeswalker to attack: a life counter or planeswalker click, the buttons, One by one, or Back.

## 2026-11-10
- ✅ "All attack" over a limit stops and says the limit (d3bbd18); refused plays say why (0858382).
- ✅ Batch A in source: Victory/Defeat banner (b852a65), resolve-until stays on (133f619), dig looks not asked twice
  (3e399ba), play-from cards beside the hand (547f3da).
- ✅ Free mulligans: one shared count anyone sets, total including the rules' free one (8dbde25); anyone may switch
  the engine and start. Only lands snap; other dragged cards stay put (39dff3d).
- ✅ Batch B (engine UI with tabs, the ability panel restyled and complete): merged 5cfae03, deployed with 9ab42d3 (2026-11-10 23:08), spec docs/engine-ui-spec.md.
- ✅ Bridge sweep of the 2026-11-09 small bugs: fixed (a20e36a) and deployed with 9ab42d3.
- ✅ (source) The Free mulligans button where the Pirate Cannon sits, turned a quarter left (721d091).
- ✅ (source) Player marks as small boxes, one a mark, stacked down the inner corner of the mat under the heart (the
  user: "corner of your playmat under your heart"; "multiple boxes ... instead of cramming everything in one box").
- 🔶 Planeswalkers by click (docs/next-features-2026-11-09.md item 24, 2026-11-11): a planeswalker answers a target
  question by a click as a creature does (Forge offers it as a card target, so the table's one target path already
  unlocked, lit and answered it; now with tests); "player or planeswalker" questions say to click either, a refused
  click says why; and a choice of players and permanents that is no target (Hero of Bladehold's attacking tokens when
  there is a planeswalker to attack, Zevlor's copies) is asked as a target question, so a life counter or the card answers it. Needs a look on
  the real table.
- ✅ (source, 2026-11-11, not yet on the real table) Status objects (spec docs/status-objects-spec.md, the user
  2026-11-10): the original table's crown, initiative, City's Blessing, the Ring, Day // Night and counter tokens come
  back parked under the table, hidden, and move onto the holder's mat under their mark's box. One copy a seat of the
  blessing, the Ring and the three counters; the deploy's save patch adds the pieces to the user's save.

## 2026-11-11
- ✅ Live check of deploy 9d8e0f2a (48a8bdc), White vs a Forge AI, turn 4:
  - passed: the log panel fits and shows the newest line; "Hero of Bladehold 3/4 attacks Jace Beleren (AI 1)."; the
    attacker gets priority after blocks; Giant Growth cast on Hero; burst picks by count (death 5 → x4, exile 6 → x6,
    wipe 9 → x8, damage 2 → x2, lifegain 3 → x3, by title and link); a deck card's own picture kept in hand and on the
    battlefield.
  - found and fixed in 6ea2ff2:
    - No sound ever played: TTS rejected the VLC mp3s and anything under ~1.5 s. All 30 were re-encoded (ffmpeg, 2 s)
      and re-uploaded.
    - The save's paused music blocked every sound; only a playing track blocks now.
    - Custom art leaked by name to the AI's Mountain; a known owner now uses only its own deck's pictures.
  - open:
    - A prompt option shows the raw AI id "self-hosted-node-…-bot" (Hero's defender choice).
    - COUNTERED not seen live: the AI deck had no counterspell; the tests cover it.
    - The touch rule needs a second human.
  - pending: hear the new clips on the real table, including a burst. Check that the players' own track doesn't start
    by itself after one of our clips ends.
- ✅ (seen live 2026-11-11 round 3) Green glow on permanents with a usable ability, seen only by their controller (SPEC.md "Green glow on
  permanents with a usable ability", the user 2026-11-11). It reuses the hand's per-player green frame, from the ability
  boxes' list; mana-only abilities are left out at priority; token stacks glow; first builds go 4 a frame. Needs the
  live check in SPEC.md.
- 🔶 (colours seen live 2026-11-11 round 3; tabs and click confirmations not yet) Combat clarity (docs/next-features-2026-11-09.md item 2, docs/engine-ui-spec.md 9): attack lines and
  buttons green, blockers lines and Done red, COMBAT green / red in the phase bar; attack and blockers questions of
  more than 8 lines under tabs by name (20 Spirit tokens one tab); every block click confirms in the chat, and the
  blockers' lines are numbered. Needs a look on the real table. Suite-reviewed 2026-11-11 (tabs by name without
  counters or damage, More tabs opens its first tab, the frame queue survives a bad card, a card that changes sides
  stops glowing for its old controller).

## Monday 2026-11-09 (after the weekly usage reset)
- ✅ **Update Forge for Star Trek: done and live 2026-11-09** (bfba2e0, docs/forge-update-2026-11.md: TRK 311/311, TRC 337/337). 2026-11-10: four upstream script fixes (Kirk, Commanding Officer; Dr. McCoy, Surly Surgeon; Cantankerous Captain; Starfleet Communicator) being taken into a new node image. Old note: Our Forge copy (`manabrew/forge`, through
  Manabrew's fork witchesofthehill/forge) is from 2026-09-21: Star Trek (TRK) has 92 cards and Star Trek Commander
  (TRC) 40, with Borg Queen, Perfection Manifest missing and ~76 cards still preview scripts in `upcoming/`. The
  official Card-Forge/forge has ~311 TRK and ~337 TRC cards (checked 2026-11-06) and 15 Star Trek edition commits since
  2026-10-09, Borg Queen included. Steps: bring the official Forge changes into our copy (two months of other Forge
  changes come with it), rebuild mtg-forge-node and mtg-relay (one build at a time), rules checks + a test game,
  deploy, then a debug game with Beam me up, Federation and Borg Queen. About 2–3 h plus build time.
- 🔶 (source) **Token stacks the Arena way** ([docs/token-stacks-spec.md](docs/token-stacks-spec.md)), built 2026-11-11:
  right-click menu on a stack in the attack question (all / one / pick one by one), picked tokens drawn as their own
  stack, blocks one token at a time from a stack, block lines while blocking, counted log lines. Needs the live check
  in the spec.
- ✅ **Extra-turn counter by a player's life: built and live** ([docs/extra-turn-counter-spec.md](docs/extra-turn-counter-spec.md)):
  extra turns coming + 1 (one extra turn shows 2). Bridge row, log line and table badge 7c33b9f (2026-11-07); the
  engine's count of every queued extra turn in the Star Trek update (bfba2e0, `ExtraTurnState.queuedFor`,
  `live_extra_turn_check` 10 of 10); the turn header reads Forge's `isExtraTurn`. Not yet seen on the real table:
  cast Time Walk, see "2" beside your life, take the turn, see it go.
- ⬜ **See and cast a card's other side** (Valki // Tibalt, Exdeath), with TTS object states
  ([docs/card-other-side-spec.md](docs/card-other-side-spec.md)): readable in your hand too, cast from the side shown.
- ✅ Small sweep bugs (fixed 2026-11-07 in 33ffb05; checked again 2026-11-10, each with a claim check): the second AI
  named "AI 1 2" in questions and votes; persist's -1/-1 counter missing from the return line; Halflingcycling's
  question naming a basic land; the log gaps in tmp/kw-runs/SUMMARY.md. 2026-11-10 added the clash's cards and winner
  to the log. Left: cipher's free copy reads "casts" (no recorded board shows the copy on the stack), kw-03's damage
  questions read the printed amount (not wrong).
- Live-check bugs (2026-11-07, tmp/live-checks/RESULTS.md). The bridge ones were fixed 2026-11-07 (33ffb05, 133f619)
  and checked again 2026-11-10: the turn header, "Skip ended" (and a rewind's step, fixed 2026-11-10), "Game over"
  twice, forage's order, the Ring-bearer question, the timer warning, Done with too few cards (the renderer). Still
  open: the mark labels' overlap and the Auto-resolve text (renderer), Mindslaver (harness).
  - a turn header lost after a cleanup discard: in `logEvents` the discard is put at index 0 but `attackAt` isn't
    shifted, so the attack splice deletes the header (`White discards Blasphemous Act`, "", `AI 1 draws a card`);
  - two players' mark labels overlap under the life counters (TURN RUN BY WHITE over RING TEMPTED 2 SPEED 3);
  - ✅ Mindslaver: the log and label say White controls AI 1's turn, but the AI still made AI 1's choices (harness);
    fixed by the controlling-seat routing (trek), confirmed live 2026-11-11 against a Forge AI: all 17 of the AI's
    questions in the controlled turn went to the controller (tests/live_mindslaver_ai_check.js). The release check's
    "White's own priority passed in the blockers step and after the Shock" was no bug: White's lands were Islands and
    Mountains and its {W} debug mana empties at cleanup, so Reflect Damage was not castable; with a Plains the engine
    offers it and the bridge stops there (live boards in tests/golden/fixtures/mindslaver-ai-live.json);
  - ✅ the harmless AI (`ai_passive_lands`) cast a Counterspell and a Llanowar Elves a scenario gave it: an AI seat with a
    lands-only deck now plays lands only, never casts, activates or attacks (harness `PassiveLobbyPlayerAi`,
    2026-11-11, image `bugs1111`);
  - small: "Skip ended: combatBegin" uses Forge step names; "Game over" printed twice; forage log order and "with
    Treetop Sentries" twice; "Claim the Precious: choose a card"; the timer warning told to everyone; Done with too
    few cards gives no message; the Auto-resolve button's text dim next to "Fix...".
- ⬜ Slow-tail re-measure on a quiet PC. Offline findings and the live questions left: `docs/slow-tail-2026-11.md`.

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
- **Button delay, measured:** the panel answers in a few frames. The 0.1-0.9 s wait is Forge (the AI takes its priority between your actions). Since done: instant click feedback, a "Thinking..." hint. Still to do: Forge's own "pass until" to cut round trips.
- **Remote players' Q/E on mana creatures:** works for the host. Untested for remote players; the panel button is the sure route.

## Spec additions (2026-10-19)
- **Turn timer with a vote:** a turn that runs out isn't skipped automatically. The other players vote to skip it.
- **AFK vote:** players can vote to mark someone away; their turns then pass, or the AI covers them, until they return.
- **Status (checked 2026-11-05):** the timer was built differently. `mtg timer` gives each decision a clock plus a time
  bank, and a question that runs out takes its default answer. Neither vote is built.

The first game's original list (9 items) is the done list above. Item 9, engine card support (Forge has sets through
Star Trek, Nov 2026, so keyword trouble is the table's wording), was covered by the keyword passes and the keyword
sweep below.

## Next up (user's order, 2026-10-18): done
1. ✅ **Picture and name check for every card** (2026-10-18, `docs/card-image-check.md`): 33,975 names; 274 show the
   card back (230 digital-only Alchemy cards, 44 crossover printings Scryfall does not list).
2. ✅ **Automated games on representative cards, every prompt type and layout:** covered by the keyword decks (324
   keywords, 2026-10-19/20), the 27 hand-test decks and the mechanic runs (2026-11-05).

## Every mechanic through the core moves (decided 2026-11-03, SPEC §4a)

**Rule for all new and changed mechanics:** build them on the core moves (zone move, counter, life). The engine names
the cause, and the bridge words it as a label. Do not write separate handling per mechanic.

Why: an audit of the bridge and the table on 2026-11-03 found about 125 places that word or handle a mechanic on their
own. It also found mill worked out twice on the table (`detectPending` and `engineMillDetect`). Bugs it caused:
- explore's card logged as "mills";
- dredge never named in the log;
- surveil never said "surveils".

Done 2026-11-03, live since 2026-11-04:
- ✅ The harness sends `cause`, `causeName` and `causeCardId` on every zone move, and `how: "mill"` from Forge's own
  flag (first image `:cause`; the running engine is retagged `mtg-forge-node:exile` by `tools/deploy.js --image`).
- ✅ The bridge words moves out of a library through one table, covering mill, dredge, surveil, explore and a plain
  put. Tested in `tests/test_bridge_events.js`.

### The next 1½–2 days (the user's go-ahead, 2026-11-03): steps 1–3 done and live

TTS is not needed for any of this: the bridge tests and the test stack on port 9444 cover it.
1. ✅ **Engine causes for costs and special actions (live 2026-11-04).** Harness `Cost:<name>` causes and `how`
   foretell / plot / suspend (image `:costs`); the bridge labels discard, sacrifice and graveyard-exile lines with
   `costWords`. The harness names the cost or special action that moved a card:
   - cycling's discard;
   - delve's and escape's exile;
   - a sacrifice paid as a cost;
   - foretell, plot and suspend.
2. ✅ **Every other zone move onto the kind + wording table (done 2026-11-03).** Each table has a function that
   decides the kind:
   - `EXILE_WORDS` (`exileKind`);
   - `HAND_WORDS` (draws, puts into hand, discards);
   - `LEAVE_WORDS` (`departureKind`: dies, destroyed, sacrificed, bounced, tucked, tokens gone).

   One `grouped()` serves every one-line-for-many move. The golden test is unchanged, and the mutation grades caught
   17 of 17 (exile) and 18 of 18 (hand and leave). Exile, graveyard and the other
   moves follow the pattern `libraryKind` / `LIBRARY_WORDS` set: one function decides the kind, one table words it. It
   replaces the ~7 exile wordings, `libExiles` / `gyExiles` / `bfExiles`, and the draw and discard wording.
3. ✅ **An automated keyword sweep (2026-11-03, live 2026-11-04).** `tools/keyword-sweep/pick.js` picks a test card per
   keyword from Forge's cardsfolder (18 keywords; disturb has no single-faced card) into `tests/keyword-sweep.json`.
   `tests/live_events_check.js --sweep <file>` plays them all on the 9444 test stack; the log replay is fed the seats'
   own actions the way `Seat.respond` feeds `notePlay`, and `--dump <file>` saves the boards for an offline replay.
   The first run reached 4 keywords and named none. The bridge fixes it led to:
   - encore and transmute said by their keyword ("Yellow encores Impulsive Pilferer"), and evoke's sacrifice trigger;
   - another player's keyword activation said from its stack text, not "uses X's ability";
   - an ability activated from a hand no one else sees (transmute, cycling, ninjutsu) is no longer read as a cast;
   - retrace and jump-start casts named; any other graveyard cast says "from their graveyard";
   - buyback's return to the hand said;
   - a stack item seen before under its own stack id is not said again. Retrace's cast was said twice; the golden's
     bounced Sensei's Top read "Blue casts Sensei's Divining Top" and no longer does;
   - an early keyword-ability line hides its stack item (it only did for plain "ability" records).

   No engine rebuild was needed: the `:costs` image already sends every cause the fixes use. Mutation grade 22 of 22
   (the first pass caught 11 of 19; each escape got a test). Final runs: sweep 34 of 34, live events 51 of 51,
   phasing 23 of 23.
   Two stacks in parallel: done (`LIVE_STACK=1`; events 51/51 ran beside the sweep). Sweep widened to 33 keywords
   (2026-11-03): first run 58 of 63, now 62 of 63 on node image `:optcost` (2026-11-04). Fixed: kicker/entwine named
   from the harness's new stack `optionalCosts`, spells mid-cast left out until they land (their costs are chosen
   during the cast), reinforce's line and cost label, offspring's trigger, prototype's cast button labelled by the
   harness and said by the bridge; the sweep pays offspring. Mutation 22 of 23 caught; the escape is equivalent (only a spell's
   own cast action is ever labelled "(Prototype)"). The one sweep
   failure left is a set-up step that varies per deal (landcycling, retrace once); the events check's delve step can
   also stop on a deal with too few graveyard cards (Treasure Cruise, twice in five runs; 51/51 otherwise on both images).
   2026-11-05: cleave and disturb added (Dig Up, Chaplain of Alms: a cleave card with no target, a disturb back that is
   not an Aura), and an AI's prototype or cleave cast is said from the stack (node `:cleave`, optionalCosts Prototype /
   Cleave). Found on the way: Dig Up's two casts both read "Cast Dig Up", so the table merged them and cleave could not
   be chosen; the harness now labels it "Cast Dig Up (Cleave)". Emerge's sacrifice asks with minTargets 0, and the sweep
   had passed "was used" on a cast that fell through (the card was later discarded); the check now needs the stack or
   a seen zone. 51/51 events check on `:cleave`.

Still to move onto the core moves, in this order (checked 2026-11-05; the last three are being specified 2026-11-05):
- ✅ The table's mill: one detector instead of two. `engineBoardDiff` compares each board with the one before once, and
  the draw/mill holder (`detectPending`) and the mill stand-ins (`engineMillDetect`) both read it. Surveil is not
  counted twice: a held card is not also flown. `tests/test_table_board_diff.js` pins the two things the recorded games
  never exercise (a discard beside a mill, the tapped list the untap holder reads); 6 mutants, all caught between it
  and the table golden.
- ✅ Exile wording: one table (was done before this list was checked).
- ✅ Draw and discard wording onto the same move list (the same).
- ✅ One keyword reader: `hasKeyword(card, word)` in the bridge ("Flashback" is not "Flash", "Suspend 1—{R}" is
  Suspend); Rebound, Suspend, Jump-start, Retrace and Flash read through it.
- ✅ Prompt wording: the `KEYWORD_TARGETS` / `KEYWORD_YESNO` registries.
- ✅ One follow-up memory per seat (`lately`: note / justDid / forget).
- ✅ On the table: one `engineBoardDiff` for the two board comparisons (the other "previous board" copies do other jobs:
  merging zones the bridge left out, life changes), and one `engineSlideAway` for the three "slide there and go" moves
  (mill stand-ins, strays joining a pile, cards a new pile is built from). The attack lunge and the held-mill arrival
  are different moves and stay.
- ✅ `askUnder` for prompts asked while another is open (2026-11-06, `docs/core-moves/askunder.md`). Its plan's step 4
  done 2026-11-11: one `Seat.clearFollowUps()` holds the list a rewind clears (`checkRestored`), now with `textWord` and
  `mustAttack` too; a claims check names every field.
- ✅ `trackMarks` for player marks (2026-11-06, steps 1-7, `docs/core-moves/trackmarks.md`).
- ✅ `engineCardEntry` (one way a card object is made) (2026-11-06, `docs/core-moves/cardentry.md`).

## Copy engine experiment (2026-11-02): closed 2026-11-03, not worth continuing

Result: the Lua copy plays a whole correct game inside real TTS from its own save ("Copy Engine Test", branch commit
ddcc69a), but 4.4 times slower than outside TTS: 906 s for one AI game, single freezes up to 43 s, and a freeze can get
TTS closed through Windows' Not Responding prompt. The profile says no runtime fix buys more than about 4 times, and
it was never wired to the table. The current build stays the game. Kept on the `copy-engine` branch, not merged (its
worktree folder `../mtg-tts-copy-engine` is gone; git lists it as prunable).

What it was for: one place for the rules and the table (spec: `docs/spec-own-engine.md`, refreshed 2026-11-11 with what is still open), so that big fixes would not
be spread across Forge/harness Java, the bridge and the table with an image rebuild in between. That was never proved:
the planned same-bugs-in-both-builds comparison and the people-only speed test (`docs/compare-current-vs-copy.md` on
the branch) were not run before it closed on speed.

## Where we are (updated 2026-11-05)

Details per day: `docs/changes-2026-10-31-to-11-05.md`. Everything up to `980aece` is committed and pushed.

- **Debug mode (2026-11-04):** `mtg debug <scenario>` sets up a test board from `scenarios/<name>.json` through the
  manual fix's new `createCard` op.
- **Log bugs a–i** from re-test 2 of the rebuilt decks: fixed and live 2026-11-05.
- **Mechanic runs (2026-11-05):** 28 of 28 deck scenarios played on the live table through debug mode, no TTS crash.
  21 fixes, all live; 20 confirmed on the real table, the bounced token (#21) by test only
  (`docs/mechanic-runs-2026-11-05.md`).
- **Engine on 2 WSL cores** (2026-11-05): no TTS crash or GPU reset since.
- **Friendly mulligans:** built, then rolled back 2026-11-01 over a stutter suspicion the staged tests did not support.
  Being restored 2026-11-05.
- **Auto-resolve dropdown:** rolled back 2026-11-02; still in source, held back by `tools/deploy-holds.json`.
- **Fix from hand:** specified in M7 §12 (`docs/m7-manual-fix-spec.md`), not built.
- **Tests:** bridge golden 926 scenarios, `test_bridge_events` 221 checks, both passing.
- **Being specified 2026-11-05 (open):**
  - ✅ Companion .exe: built (six start lights, browser status page, table tools, friend-package self-update); the spec was rewritten from the code 2026-11-11 (`docs/companion-app-spec.md`, §14 lists what is not built).
  - ⬜ Own engine: refreshed plan 2026-11-11 (`docs/spec-own-engine.md`); its new Phase 0 (people-only speed, fixes-in-one-place comparison, native engine without Docker) has not started.
  - ✅ Core-moves cleanups: `askUnder`, `trackMarks`, `engineCardEntry` (2026-11-06; askUnder's `clearFollowUps` 2026-11-11).
  - ⬜ M5 step 4: particle effects with sound hooks.
  - ⬜ Planechase plane and dungeon room: engine changes.
  - ⬜ Investigations: the engine's p95 slow tail (offline part done 2026-11-11, `docs/slow-tail-2026-11.md`; the live
    part waits for a game on the new bridge's GET /stats), External Editor message size.
- **Left after that:** things that need other people (4 humans, hand privacy, M7's 2-person test, M5's sync test, remote
  players' gestures, the host's upload with `tools/net-upload-meter.ps1`) or are optional (effects, sounds, game modes, 6 seats).

From 2026-10-31: all 19 gap decks and 127 keywords are played. Turn timers (`mtg timer`) and hold priority (`mtg hold`,
Hold button) work through the table. The engine builds from public source plus `engine/`.

Notes below from 2026-10-20 (still true unless marked):

Everything runs end to end in real TTS, and has been played over TTS multiplayer with a friend (1v1).

```
TTS (the "Mock MTGA 4 player" save) ⇄ bridge.js ⇄ Manabrew relay ⇄ self-hosted node ⇄ Java Forge
            ✅                            ✅            ✅                 ✅               ✅
```

- **Stutter:** fixed. Rewind snapshots, `destruct()` pauses and JSON size are all solved; a full game's worst frame is ~244 ms. See the stutter notes below.
- **Rules coverage:** every keyword the first pass flagged is now played: 42 of 47 in the headless recheck, the last 5 (Aftermath, Fuse, Enrage, Fight, Spree) by the scripted check; 0 rules-engine errors (`docs/keyword-test-results.md`).
- **Big late-game board (2026-10-20):** 4 players vs 3 harmless AIs to turn 103, 125 permanents: 127 fps, median frame 6–7 ms (flat as the board grew), ~1 frame over 250 ms per 30 s of fast AI play, `mtg reset` under 1 s, 0 errors (`tools/bigboard-test.sh`, QUIET=1).
- **Table bugs from testing:** P1, P2, P3, P4, P7 and P8 are fixed; P9 is fixed but not yet confirmed in a real game (`docs/problem-log.md`).
- **Engine link recovery (2026-10-20):** the bridge reconnects to the relay by itself (heartbeat every 20 s, retries for up to ~1 min, resync of board and question); tested live by restarting the relay mid-game: back in 3 s, game finished with 0 errors.
- **2026-10-20, review and tests (jr-programmer-suite):** the bridge went through all stages (structure, simplify,
  correctness with 20 findings fixed or decided, claims, docs); golden masters for the bridge (145 scenarios then, 926 now) and the
  table script (two recorded games replayed on fengari), both graded by mutation; rule checks M0.5 pass; a 4-player
  game to turn 17 with no errors (slowest update 118 ms). The table script went through the same suite (golden master graded SOUND: 26 mutations, 1 equivalent escape; claims; relation test).
  Commands: TESTING.md, "Golden masters and rule checks".

---

## Done ✅

| | What | Where |
|---|---|---|
| Research | Decided the approach: no MTGA decompiling. TTS is the front end and Forge is the rules engine, through Manabrew | `Desktop/MTG/mtg-tts-engine-handoff.md` |
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

  Only those 6 scripts plus 1 removed object differ from the original. Loaded and played in TTS since 2026-10-17. The ENGINE MODE save has since been deleted: the table is now the user's "Mock MTGA 4 player" save (`TS_Save_1.json`), updated by `tools/deploy.js` with TTS closed.
- [x] **Step 1 (built 2026-10-17, in use in every game since):** `ENGINE_MODE` switch. `mtg engine on|off` (host/promoted only), off on every load. 346 guards added by `tools/make-engine-copy.js`; each blocked tool posts "[MTG] Engine mode is on: '<tool>' is handled by the rules engine." What's blocked:
  - **Global:** Draw/Scry/Mill/Untap/Mulligan/Reveal buttons, hotkeys, typed numbers, the zone context-menu handlers (incl. the `clearContextMenu` wipe), Get basic, Token copy, Cascade, Random discard, Reveal-until-type, and the "my/your turn" chat.
  - **Trackers:** life buttons and chat; commander damage, tax, energy/poison/experience, mana/suspend and card-counter buttons.
  - **Turns:** Turn Skipper, the Pirate Cannon who-goes-first hook, and TTS's own end-turn button (`Turns.pass_turns=false`).
  - **Card buttons:** Easy Modules clicks, keywords, token marker, phasing, face-down, menu flip.
  - **Other:** Card Importer (import before turning it on), Day/Night clicks and card transforms, the Ring, deck-search tools, the enabler bag (items go back in), Treachery token buttons, and dungeon token spawns.
  - **Deliberately left alone:** highlight mats, timers, hand counters, CardCustom, dungeon room markers, sort hand, notes, dice.
- [x] **Step 3 (built 2026-10-17; tested live the same day, below):** `mtg start [ai N]` / `mtg reset` (host).
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
  - **Friendly (free) mulligans:** built 2026-10-31 in our harness, without touching `forge/`, taken out 2026-11-01 and put back 2026-11-05 (the user: "add back in friendly mulligans the way it was before"). Forge has no free-mulligan setting, and answering its "put N on the bottom" with fewer cards would abort the game, so the harness asks for fewer. Spec in SPEC.md, "Friendly mulligans by vote".
- [x] **P2 (2026-10-18):** gestures answer the open prompt exactly like the panel buttons do.
  - **Pay by tapping:** Q/E on a glowing (gold) land or mana source taps it for the cost. Turning a tapped one back gives its mana back. The payment finishes by itself once the last tap covers the cost.
  - **Attack by tapping:** Q/E on a glowing (red) creature toggles it as an attacker, and it glows green when picked. Confirm in the panel. With several opponents it attacks the first one in A-Z order; pick others in the panel.
  - **Block by clicking:** click your glowing (blue) creature, then the attacker. Confirm in the panel.
  - **Click to target:** click a glowing (orange) card, or a player's life tracker. When the required number is picked, it answers right away.
  - **Right-click to cast:** spells and abilities you can use appear in that card's right-click menu during your priority.
  - **Guard:** a multi-choice answer outside min–max is refused and asked again, both in Lua and in the bridge. An empty "choose 1" made Forge abort a game during testing.
  - Known limits: glows are visible to every player (TTS highlights aren't per-player; the green playable frame is per-player since 2026-10-20). The prompt type was read from the title until the bridge sent `kind` (2026-10-20).
- [x] **P3:** library as a real face-down deck (draw animation; tutors via right-click → Search); table buttons mapped (Mulligan, Scry via πScry, Draw, Untap, Mill) (built: Round 4 and "Table buttons" above, 2026-10-17/18)
- [x] **P4:** Arena feel (highlights, sounds, shake) (moved to M5)
- [x] Layout tuned from TTS screenshots through the 27 hand-test decks
- [x] Spawn cards in the Card Importer's format at Global `data[color]` zone positions; lock them; track engine ID → GUID (built in M4 step 3: `place()` in tools/engine-renderer.lua)
- [x] Feed the displays: life, commander damage, commander tax, `Turns.turn_color`, phase, energy/poison, and Encoder overlays (P/T, counters, keywords, phasing, token, face-down) (built: `updateTrackers`, the M5 badges)
- [x] Hands in TTS hand zones (hidden), library as a face-down pile, stack area (built: hand zones, library deck, stack spot)
- [x] Prompts in the table's style: πScry for scry/surveil, ✓/✗ for yes/no, πMenu for card actions, side panel for the rest (replaced by the Arena-style panel and wording, 2026-10-20/22)
- [x] Click-to-select cards on the table for targets, attackers and blockers (P2)
- [x] Real UI for trigger order, damage assignment order and combat damage split
- [x] **Step 2 (built 2026-10-17; in use live since, now behind the READY buttons, M8):** `mtg ready` / `mtg ready all` (host) / `mtg commander` (hover a card).
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
- [ ] Drive the Eternities Map centre plane and the dungeon room markers (one per player) from the engine; turn off their manual moves and token spawns. See `table-review/notes-variants.md`. The engine changes are being specified 2026-11-05.

### M4.5: rewind by vote ✅ (built 2026-10-20; 2-person vote test pending)
- [x] Engine side checked headless (`bash tools/rules-check.sh rewind`): checkpoints ~8 per turn, last 25 kept; a restore to "turn 6 upkeep" from turn 8 brings back life, commander casts and every zone exactly (3 of 3 runs)
- [x] "Undo..." button (bottom right) lists the last 12 points (upkeep, main, attacks, second main of each turn); `mtg undo` / `mtg undo N` in chat
- [x] Sends `requestRestore` / `restoreVote` directives; refuses unknown points, a second vote, players who are out, votes not awaited
- [x] Vote pop-up for the awaited players (Rewind / Keep playing; `mtg vote yes|no`); request, decline and "no longer kept" posted to chat. Against AI only it applies at once (Forge asks humans only)
- [x] After a rewind the bridge closes the question that was open (an answer to it crashed Forge in a test) and the per-player turn count goes back too
- [x] Rewind race fixed (engine lock: 0 failures in 52 rewinds) and a "Rewind to <point>" button when a question holds an agreed vote (live 2026-11-02)
- Tests (2026-10-20): bridge golden 151 scenarios (8 deliberate breaks of the rewind code, all caught), table golden 705 steps (7 of 7 caught)

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
- [x] **Linked exile, playable exile, face-down exile on the table** (research: reports/MTG linked exile and zone quirks.md). Built 2026-10-23, golden-tested, checked live (the last two items):
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
- [ ] Step 4: pooled particle effects for death (smoke + shatter), countered spell, damage hit, player knocked out, with sound hooks; CC0 sounds (Kenney, Cockatrice set). Being specified 2026-11-05
  - [x] **The user's sounds in, and four new sound kinds (2026-11-11, source only, not heard on the real table):** the six TTS Cloud links of `docs/sounds.md` in `engineSounds` (death, wipe, damage, exile, instant, lifegain; counter and knockout still silent); new kinds wipe (3+ to graveyards on one board, instead of death), exile (a permanent from the battlefield to exile, tokens by the bridge's new `exd`), instant (an instant spell on the stack, by the bridge's new `ins`; not abilities, not copies), lifegain (a life total going up); one sound per board, knockout > wipe > death > exile > damage > lifegain > instant > counter, the first with a pick (docs/m5-effects-design.md §6); `mtg sounds test <kind>` takes all eight. Needs the bridge and table deployed together; real-table check 5 (music player delay) still open
  - [x] **Sound bursts (2026-11-11, source only, not heard):** the 24 stacked clips of `docs/sounds.md` ("Bursts") as `engineSounds.<kind>_x<N>`; a board with several deaths, exiles, hits or gains plays the largest bucket at or under its count (×2 ×3 ×4 ×6 ×8, wipe from ×3, capped at ×8), still one clip per board under the same limits (docs/m5-effects-design.md §6, "Bursts"); `mtg sounds test <kind> [N]`
- [x] ~~Camera shake~~ dropped: none in any Arena frame (video research)

### M6: 4–6 players (was 5–8; shrunk 2026-11-05 to fit the 6-player Workshop table 2293586471)
**Spec: `docs/m6-six-seat-spec.md`** (2026-11-05): 16 steps, about 44.5 hours, UI shrink first (six seats 78,699 → about 45,600 bytes, budget 50,000), then relay cap, bridge seats and the table port. UI measurements: `docs/m6-ui-size.md`.
- [x] `SEATS=6 docker compose up -d forge-room`, then `node bridge/engine-test.js --seats 6 --turns 12` (2026-10-20): 1 test seat + 5 Forge AI to turn 12 in 24 s; 113 answers, 0 resyncs, 0 fingerprint mismatches; response → next engine message p50 182 ms / p95 356 ms (mostly the 5 AIs thinking between our prompts; relay hop p50 9 ms). Room set back to 4 seats afterwards
- [x] The lobby's 4-seat limit doesn't block it: the room the node creates with `SELF_HOSTED_NODE_MAX_PLAYERS=6` seated all 6
- [ ] A full game in TTS with 5 or 6 seats: **blocked by the table**, which has 4 playmats and 4 seat colours (`TABLE_COLORS`, the bridge refuses more). Needs the 6-seat table below and its geometry in `seatGeometry`
- [x] A 6-player table found: Workshop 2293586471, on the host's PC (2026-10-31); compared with the 4-player table, plan in SPEC §7
- [ ] Cut the screen UI first: six seats would be about 77.5 KB against the 60 KB limit
- [ ] `make-engine-copy.js` and the renderer: per-table profiles (seats, GUIDs, layout) instead of the 4-player values
- [ ] 6-player engine table: our scripts patched in (not the 4-player script pasted over), background objects removed, table buttons added; then the full 5–6 seat game above

### M8: game modes (spec 2026-10-21: docs/game-modes-spec.md)
- [x] **Ready / Start buttons (2026-10-21, revised with the user):** a small READY? just below each seated player's Draw button (yellow → green when the deck checks out, red "FIX DECK" with the reason in chat; only that seat's player can press it; = "mtg ready"; press again to un-ready). A ready player's own table buttons (untap, reveal, draw, mill, scry, mulligan) go under the table until they un-ready or the game is reset. "Start" appears between the four life counters only when every seated player is ready; anyone can press it (= "mtg start"; alone: against 1 Forge AI); hidden during the game, NEW GAME afterwards (host, = "mtg reset"). Engine mode only. Checked live on the table
- [ ] Standard 1v1 (our side only: no-commander decks, 20 life)
- [ ] Engine spike: teams, per-player starting life and hand in Forge (the forge submodule is checked out since M7)
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
- [x] `createCard` op (2026-11-04), used by `mtg debug <scenario>` to build test boards
- [ ] Snap points (not needed so far: `dropArea` reads the zones)
- [x] Fix from hand (built and live 2026-11-06, committed 8d75957; m7-manual-fix-spec §12): the fix panel offers your hand's cards: Cast free / Activate free / Play land / To graveyard, plus a "what should have happened" note; no card moved by hand; new ops `freeCast` / `freeActivate` / `freeLand` (Forge's dev-mode free cast)
- [ ] Live test with 2 people

---

## Ideas 💡 (in the spec, not scheduled)

| Idea | Spec | Notes |
|---|---|---|
| Companion .exe: choose self-host or dedicated server | §10b, `docs/companion-app-spec.md` | The bridge always stays on the host's PC. Self-host also starts Docker. Status lights, latency readout. Built (Windows only, 6 lights, browser status page); spec rewritten from the code 2026-11-11. Own server and Cloud modes not built |
| Dedicated server | §10b, `docs/server-setup-spec.md` | TLS relay, strong server key, measure the internet round-trip cost (~62 ms measured by Manabrew). Full AWS hosting paused by the user 2026-11-02 |
| Bridge forwards editor messages to VSCode | §8 | Lets the host use the VSCode TTS plugin while the bridge runs |
| Decklist import | §11 | Paste an Arena/Moxfield list as well as importing with the table's Card Importer (`mtg ready`) |

---

## Open questions / risks

- **Forge Commander rules:** confirmed headless on 2026-10-20 (M0.5): tax, 21 commander damage, command-zone choice, 4-player priority, turn order after elimination.
- **TTS render speed on a big board:** answered 2026-10-20: fine at 125 permanents (avg update 36 ms, worst 152 ms).
- **External Editor message size:** does TTS cut off very large messages? Patches keep them small (~1 KB), but the first full state is ~25 KB. Investigation being specified 2026-11-05.
- **Slow tail in the engine:** p95 ~90 ms. Check whether it's the engine or CPU contention by running clients on another machine. Investigation being specified 2026-11-05 (the engine has run on 2 WSL cores since 2026-11-05). 2026-11-11: in live play the tail is engine time (84% of a reply's wall time) times the priority stops the bridge passes one round trip at a time; `docs/slow-tail-2026-11.md`..
- **Manabrew is pre-release and changes fast:** relay and node are our own builds (`mtg-relay:exile`, `mtg-forge-node:exile`, from Manabrew `fd16e2f` plus `engine/manabrew.patch`); the web client is pinned by digest in `stack/compose.yml`. A newer Manabrew means bringing the patch forward and rerunning the rules checks and golden tests.
- **Licensing:** fine for private play. Before publishing on the Workshop or running a public server, review §9 (AGPL obligations if Manabrew is modified, e.g. for M7).

---

## Everyday commands

```bash
docker compose -f stack/compose.yml up -d   # start the engine stack
node bridge/bridge.js                       # start the bridge (or tools/start-bridge.ps1: hidden, restarts itself)
node tools/deploy.js                        # ship the bridge and the table script together (TTS closed; --image <tag> for the engine)
```
In TTS chat: `mtg help`, `mtg start ai 1`, `mtg deck <id>`, `mtg decks`, `mtg reset`, `mtg debug <scenario>`.
