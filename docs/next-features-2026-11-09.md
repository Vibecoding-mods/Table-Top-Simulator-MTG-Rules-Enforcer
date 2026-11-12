# Next task list (asked 2026-11-09)

The user's list, in their order. Most items need a running TTS table in debug mode to fix and confirm.

1. **Moving cards.** Before the game starts, any player can move any card, and not only before the engine is turned on. After a game ends, players can't touch other players' cards.
   - **Built 2026-11-11 (round 2 C), decided where the list was silent.** The rule follows the game, not engine mode
     (`onPlayerAction` in engine-renderer.lua, `engineSeatOf`):
     - no engine game on the table (engine mode off; on but before the first Start; after New game cleared the last
       one): anyone moves any card;
     - a game being played: unchanged, your own cards as the engine allows;
     - a game over, its board still lying there until New game: nobody touches another player's cards, not even a
       click. That covers the engine's cards and any other card or deck lying on that player's mat, piles or command
       zone. Your own can still be picked up and flipped. The refusal says "The game is over: those are X's cards."
   - What the playtest actually hit isn't known. The fake TTS showed the old rule already let anyone touch anything
     with no engine board, and already kept others' engine cards from being picked up after GAME OVER (clicks and
     loose cards went through). Check on the real table which case it was.
2. **Combat clarity.**
   - Attack/block parts are highlighted green, and turn red when you're the one being attacked.
   - Attacker and defender pickers are organised under tabs, so a big token board doesn't need endless scrolling.
     - Same-named tokens (e.g. #1 to #20) sit under one tab.
   - Assigning a blocker to an attacker sometimes gives no confirmation. Always confirm.
   - **Done in source 2026-11-11** (docs/engine-ui-spec.md 9): the colours, the tabs and the confirmations (the cause:
     a chat line said in the last 3 s was dropped, and an attacker clicked after a block was taken back did nothing).
     Not yet seen on the real table.
3. **Resolve until X.**
   - The button is undone when a new phase pops up.
   - It should also apply on the opponent's turn. "Until combat" stops at my combat and my opponents'.
4. **Floating black boxes** behind the UI: find what they are and remove them.
5. **Doubled prompts.** For example, a library search shows "look at these top cards"; you click OK, and then a second "select a card that is an instant" prompt follows. Drop the first prompt when the second one makes it pointless.
6. **Engine UI** cleaned up and brought in line with the main UI. About half the players use the main UI and half the engine UI.
7. **Planeswalker and ability box** (bottom right): make it legible and match the main UI's theme.
8. **Friendly mulligans** should stop at 2. Today you can take a third friendly one, possibly unlimited.
9. **Card placement.**
   - ~~Mana (lands) doesn't land in the mana box on the mat. It is placed above it and keeps stacking rightwards.~~
     Fixed in source 2026-11-10 (item 26).
   - The second-to-the-right spot is good, but cards have to be re-placed after they're put down.
10. **Floating XL cards** (cards you may play, temporarily or permanently) float above the main pile. They should sit closer to your own hand.
11. **Scry glitch.** Cards were thrown around the board between the user's side and an opponent's. The opponent was running a green enchantment deck. It isn't known how to reproduce it, so check the logs.

11a. **Scry glitch, cause found.**
    - It was the 2026-11-08 20:23 game, Blue's Sythis deck. After Blue's Courser of Kruphix, Blue's revealed top card was in White's playable row as well as Blue's. Forge's external-zone list counts "may look at" as playable.
    - During each scry the renderer placed that one card in three spots per board.
    - Fixes:
      - The harness reports "may play" and "may look" separately.
      - playableOf keeps only cards the viewer can really play.
      - enginePlaceSpecial skips scry-held cards.
    - Full report: scratchpad scry2.
12. **Revealed hands never shown.**
    - Cause found. Continuous reveals (Revelation; Sen Triplets on AI 1) arrive only as hand-card visibility in other seats' views. The bridge sends only handCount for others (and null for an AI), and the renderer has no revealed-hand display.
    - One-time reveal prompts do show, but only 7 pictures.
    - Fix: a `revealed` list per player, shown in a public locked strip at the owner's seat. Sen Triplets' cast-from-their-hand also goes into the playable list. A few times, an effect should have revealed someone's hand, for a while or permanently, and the table never showed it. The game isn't known; search the logs for it.

## Ideas (asked 2026-11-09, design first)

13. **Cost-change counter on cards.** When an effect makes a spell cost more or less, show a highlighted counter over the generic-mana symbol, like the age-counter badge. For example, a card in hand printed {2}{R}{R} under a 2-less effect shows a highlighted 0 over the grey mana.
    - It is display only, so the engine still decides what you actually pay.
    - Open questions: where Forge's adjusted cost comes from (the cast action's cost); hand vs battlefield vs command zone; X costs; whether colour reductions show too.
14. **Victory/Defeat overlay.** At game end, each player first sees VICTORY or DEFEAT for 2 s, then "X wins the game" for 4 s.
15. **Team modes: 2v2 and 3v3.** NOTES ONLY (the user, 2026-11-09): not scheduled, no spec yet.
    - Rules still to decide: Two-Headed Giant (shared life and turns) or teams with separate life.
    - Rough size: 2v2 about 15–25 h (engine work on teams and turns). 3v3 needs the parked 6-seat table
      (docs/m6-six-seat-spec.md, about 45 h more).
16. **Custom card art, player-made.**
    - Pictures only; card rules stay Forge's.
    - The likely route is a per-card image URL in the deck import, used in place of the Scryfall picture.
    - The images must be hosted online (TTS loads faces by URL).

17. **In-table chat commands to pick what decks the AI opponents play.**
    - **Built 2026-11-11 (round 2 C)**, with item 20. The host types `mtg ai <colour> harmless|forge [deck]`,
      `mtg ai <colour> off`, `mtg ai clear`, or plain `mtg ai` for the list. A Forge AI needs a deck name; a harmless
      bot with none plays `ai_passive_lands`. Pasted deck lists come only from the companion page: chat can't carry a
      100-line list.
18. **More debugging commands inside TTS.**
    - Debug mode (`mtg debug`) exists; this means more of it.
    - **Built 2026-11-11 (round 2 C)** as the companion page's debug tools (item 21). No new chat commands:
      `mtg debug` scenarios and `mtg mana` already cover chat.

20. **AI seat presets in the companion page** (asked 2026-11-10). This merges with item 17.
    - For each empty seat, pick one of:
      - **Harmless bot:** passes priority, keeps its hand, never attacks or blocks. Good for testing.
      - **Forge AI:** a real opponent, with an AI profile.
    - Each AI seat gets its own imported deck, from a deck list or a file.
    - Rough size: 8–12 h.
    - **Built 2026-11-11 (round 2 C). Decisions where the list was silent:**
      - A colour set as an AI seat is an AI player in every game while nobody sits there, whatever count Start asks
        for. The total is the larger of the two; extra AI players take the colours left. A person sitting at that colour
        plays it as usual. The choice is kept until changed, like `mtg aideck`, and is lost when the bridge restarts.
      - The seat's deck comes before `mtg aideck` and before a deck lying in that seat. Forge AI seat k gets the k-th
        bot deck, and the bridge seats that bot at its colour (`clockwiseOrder`, `game.colorOfUser`).
      - **Harmless bot.** The engine has no passive AI, so the bridge plays the seat itself (`HarmlessSeat`). It logs in
        like a person once every person's seat is in the room, and answers every question at once (`harmlessAnswer`):
        - keeps its hand, passes, cancels a cost;
        - says no to every "may";
        - makes the fewest picks a question allows (the first ones), and keeps a scry on top;
        - attacks only with creatures that must, and blocks only an attacker that must be blocked (when the engine
          refuses no blocks).
        - It is an AI player to the table ("AI n"), takes no manual-fix vote and has no prompts on the table.
        - The engine counts it as a person, so it is asked in every rewind vote; it says yes at once (`harmlessVotes`).
          Without that, a rewind in a game with one waited for it for ever.
        - A restarted bridge logs it back in. A dropped link isn't retried, so the engine concedes that seat; the table
          is told. A link lost while setting up is said too ("mtg reset", then "mtg start"), as for a person's seat.
        - Its default deck is `ai_passive_lands`, and any deck can be given.
      - **Forge AI** is the node's own Forge AI. The node has one AI profile; picking a profile would need a node change.
      - **Deck lists.** Pasted or loaded from a .txt/.dek/.dck file on the page. Arena/Moxfield style: `1 Name`,
        `1x Name`, `Name (SET) 123 *F*`, tags; the commander under `Commander` or marked `*CMDR*`; `Sideboard`,
        `Maybeboard` and `Companion` parts aren't played. Every card must be known to the engine. The deck size isn't
        checked: an AI's deck is the host's business. The page sends at most 16 KB (the companion's body limit), and a
        deck name loses any TTS colour codes in brackets, since it is said in chat.
      - **Needs a live check on the real table:** a game with a harmless bot and a Forge AI seat (who sits where, the
        mats, the bot never stalling a question type the tests don't have).
21. **Debug tools in the companion page** (asked 2026-11-10). This merges with item 18.
    - Add X mana, add card X to a hand, draw, set life, mill, put a card on the battlefield, and untap.
    - Host only, and only in debug mode.
    - Builds on `mtg debug` and the M7 createCard/applyState ops. Adding mana may need a harness op and an image rebuild.
    - Rough size: 8–14 h.
    - **Built 2026-11-11 (round 2 C). Decisions where the list was silent:**
      - "Only in debug mode" means a debug-tools switch on the page, a bridge setting that is off at every bridge start
        and is said to the whole table both ways. "Host only" means the page, which opens only on the host's PC with
        that run's token. Switching it off cancels a debug tool still waiting for its pause or votes.
      - Each tool is one manual fix: the game pauses at a moment with nothing on the stack, the other people vote
        (nobody does vs AI), and `applyState` runs. It is made in the name of the player it's for when a person sits
        there, else of the first person still playing.
      - Tools:
        - Add mana: n (1–99) of one colour, until the end of the turn.
        - Add card to hand: `createCard`.
        - Put on battlefield: `createCard`, or a token by its words, as `mtg fix token` takes them.
        - Set life: 0–999.
        - Untap all: every tapped permanent that player controls.
        - Mana needed no harness op: the `mana` op already exists.
      - **Draw and mill: built 2026-11-11 in source; in every engine image since `batch1112` (2026-11-12), so the
        deployed `batch2-1112` (node 975d62f6279e, relay 57aa07a9b314) has them.** Checked 2026-11-12 on that image:
        harness-tests.sh 12 of 12 classes (ApplyStateDrawMillTest included), and a headless live check (the bridge's
        own debug tool building the directive from the live board, sent to the engine) 20 of 20: draw 2 (library -2,
        hand +2, two `draw` events, which name no card since both zones are hidden), mill 3 and mill the whole
        library (library to 0, graveyard up by as many, one `mill` event each), the bridge refusing a mill from the
        empty library, and a raw engine mill from it applied with nothing moved. The engine's board never shows
        library cards (the library zone is empty in every view), so no fix op can move one. They are new harness
        StateOps, `draw` and `mill` (`player`, `n`: 1–99 from the page), in engine/manabrew.patch: applyState makes
        them after its other ops with triggers on, as it does the free plays, through Forge's own `Player.drawCards`
        and `GameAction.mill`. So a draw counts as a draw (draw triggers, "cards drawn this turn", drawing from an
        empty library loses) and a mill as a mill (mill and graveyard triggers), and the event log calls them `draw`
        and `mill`. The page shows Draw and Mill only when the bridge lists them. A mill from an empty library is
        refused; more than the library holds is allowed and said. An engine built before them drops the directive
        unread (node and relay parse directives strictly): the fix watchdog then says so after 20 s.
      - **Needs a live check on the real table:** each tool once in a game with a second person (the vote) and vs AI.
22. **Monte Carlo simulation: CUT** (the user, 2026-11-10).
    - Too slow on an ordinary PC: about 30 s to 2 min a game on 2 cores, so 1,000 games takes overnight.
    - The user already runs deck tests in separate sessions.
    - Reconsider only if it is hosted on a server. Route notes, if it ever returns: Forge's headless `sim` (SimulateMatch,
      `-f commander -d a b c d -n N -c <timeout>`), one JVM per core.

23. **Attack reminders** (asked 2026-11-10): "if there's a pay to attack or multiple creatures can't attack, a prompt
    should pop up to remind players".
    - Attack taxes (Propaganda, Ghostly Prison, ...) shown before attackers are picked, with the cost per defender.
    - Creatures that can't attack listed with the reason, instead of silently missing from the list.
    - Spec in progress: docs/attack-reminder-spec.md. Propaganda's tax has never been seen live (Kykar test: the AI
      never attacked into it).
    - **Seen live 2026-11-10 ~11:48** (the user vs a friend, packaged build): White had Crawlspace and Norn's Annex.
      Blue sent "All attack" with 3 creatures 8 times. Forge's refusal is a bare "Attack declaration invalid" with no
      reason, and the bridge (~line 6299) words it "That attack isn't legal. Something on the table limits who can
      attack..." without naming Crawlspace's 2-creature limit. Players thought it was a glitch. The cheapest fix is
      bridge only: name the restricting cards and the limit in that message.
    - **Spec part 1 done in source 2026-11-10** (bridge `attackRefusalReason`): the refusal names the broken limit
      ("Crawlspace (White): no more than 2 creatures can attack White each combat. You chose 3."), and it stays on
      the next attack question as its note and text until answered. Covers global limits (Silent Arbiter), limits at
      a player (Crawlspace, Judoon Enforcers, Mirri while tapped) or at a planeswalker (The Eternal Wanderer), "can't
      attack alone" and "can only attack alone" (Errantry too). Otherwise it lists the cards whose text limits
      attacks, reminder text ignored. Wording checked against all of Forge's Oracle lines. Not deployed.
      Still open: the "All attack" pre-check (needs the user's answer), parts 2 and 3 of the spec.
    - The "All attack" pre-check is done (d3bbd18). **Part 2 done in source 2026-11-11** (bridge `attackReminder`):
      the attack question lists each tax per defender ("Propaganda (AI 1): {2} for each creature attacking AI 1."),
      summed when there are several, with the planeswalkers' share. It also lists each creature's own price
      (Brainwash), the open mana, the limits, and "Can't attack: Hill Giant (summoning sick), ..." with the reason.
      Pressing Q/E on such a creature says the reason. The tax payment says "pay {2} to attack with Grizzly Bears?"
      and its Cancel is "Don't attack with Grizzly Bears". **Part 3 (engine) done in source 2026-11-11**: the
      harness sends Forge's taxes per defender with their sources, why each creature can't attack, and the attack
      limits, so War Tax, emblems and resolved spells show too; the bridge reads text only when an older engine
      sends none of it. Needs a node image build.

24. **Planeswalkers by click** (asked 2026-11-10): click a planeswalker card to target it with a spell or ability,
    the way a life counter picks a player.
25. **Attack targets** (asked 2026-11-10): "Attack" and "All attack" ask which player or planeswalker to attack
    when there is more than one choice, instead of taking Forge's first target for everyone.
    - **Done in source 2026-11-11** (bridge `attackWhom`): a creature with several targets has "X → whom? (asked
      next)" first. "Attack" with it, or "All attack", then asks "Attack whom with ...?". You can click a life
      counter or a planeswalker, or use the row buttons (each with its tax), "One by one", or "Back". A creature that
      can't attack the one you picked is asked again. The defender ids are `player|` / `card|`, the same ones item 24
      clicks.
26. **Lands snap into the mana box** (asked 2026-11-10: "i want the mana to snap to the mana zone properly"; first
    read as "stay where dropped", reverted). Measured on the real table with test cards: the mat's lower box runs
    from 3.46 past the mat's centre to its near edge at 10.375; the land row (3, at 1.6) lay above it, and the
    playable row (4.25) lay inside it. Now `ROWS.land = 4.7` (centred in the box, room for a tapped land) and
    `PLAYABLE_ROW = 3` (the strip just above the box). Lands put down by the table and lands dragged from the hand
    both end in the box (two new claims checks). Also meets item 9's first point. In source, not deployed.
    Not done: item 10 (play-from cards near your hand); the wood strip between the mat and the hand has the hand
    counter screen in its middle (x 16.9-23.1 on White's side), so that needs its own layout.
    (Engine UI cleanup, item 6, was raised again the same day: still not done, it is in batch B.)

19. **One-click friend package** (asked 2026-11-09, top priority). The user is handing the current build to a friend.
    - A zip with MTG Companion.exe, bundled node, a bridge that runs from the package (MTG_HOME), saved engine images, the table save and a README.
    - The friend installs Docker Desktop, unzips, and double-clicks. Then they load "MTG Table (rules engine)" in TTS.
    - Being built in parallel on branches friend-pkg and companion, then tested as a fresh install.

Also queued from earlier work:
- Fixed in source 2026-11-11 (not deployed), each reproduced by a test first:
  - ~~The graveyard-castable hover-text alarm~~: the row's entry now carries its zone's notes ("Flashback {2}{R}").
  - ~~Rancor sitting off the graveyard pile~~: a stray object left beside a pile goes; a pile card's drag reads as a
    graveyard card; a graveyard card with nothing letting it be cast isn't queued as a play.
  - ~~Viscera Seer's cancel loop~~: taps that can pay none of the cost aren't offered (Mountain's {R} for {B}).
  - ~~Token attackers listed with no size~~: "Spirit Token 1/1 #3 → Blue".
  - ~~Dredge splitting "draws two cards" into two lines~~: one spell's draws over two boards are joined.
- Not changed 2026-11-11:
  - A hanging rewind vote: the only vote in the logs left open (2026-11-09 01:18, turn 8) waited on Blue, who never
    voted before White conceded 43 s later; Yellow's yes reached the bridge. Nothing shows a fault; it needs a report
    of what was on screen.
  - #10 sorting after #1 in option lists: fixed 2026-11-09 (Kykar #9, live PASS); attack lists are checked for it too.
- ✅ Mayhem, Harmonize, Beam me up and Plot cards never get mayPlay, so they aren't playable from the row (e.g. Rocket-Powered Goblin Glider). Harness: add the keywords to the graveyard clause and isPlotted() to exile; engine image rebuild. Done 2026-11-11 (image `bugs1111`; Mayhem only for a card discarded this turn; MayPlayVisibilityTest).
- ~~The table self-check false-alarms "wrong place" on a card in an opponent's graveyard or exile that you may play (Mnemonic Betrayal, Thief of Sanity)~~: fixed in source 2026-11-11; the check reads the caster's mat and second hand zone (reproduced with Thief of Sanity's face-down card in the caster's hand zone).
- ~~Reveal stand-in tests (S11, S12, S16)~~: done in f1e2a16.
- From the 2026-11-10 real-table check (docs/release-check-2026-11-10/):
  - ~~under GAME OVER, Sen Triplets' stand-ins in the playable row still glow~~: fixed in source 287a12b (no playable
    row once the game is over), not deployed;
  - on a Mindslaver turn, White's own priority was passed by itself in the blockers step and with a spell on the stack (Auto timer on), so Reflect Damage couldn't be cast there;
  - `ai_passive_lands` still casts a Counterspell a scenario puts in its hand.
