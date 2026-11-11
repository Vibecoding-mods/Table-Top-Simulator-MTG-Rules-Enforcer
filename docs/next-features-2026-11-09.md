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
3. **Resolve until X.**
   - The button is undone when a new phase pops up.
   - It should also apply on the opponent's turn. "Until combat" stops at my combat and my opponents'.
4. **Floating black boxes** behind the UI: find what they are and remove them.
5. **Doubled prompts.** For example, a library search shows "look at these top cards"; you click OK, and then a second "select a card that is an instant" prompt follows. Drop the first prompt when the second one makes it pointless.
6. **Engine UI** cleaned up and brought in line with the main UI. About half the players use the main UI and half the engine UI.
7. **Planeswalker and ability box** (bottom right): make it legible and match the main UI's theme.
8. **Friendly mulligans** should stop at 2. Today you can take a third friendly one, possibly unlimited.
9. **Card placement.**
   - Mana (lands) doesn't land in the mana box on the mat. It is placed above it and keeps stacking rightwards.
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
        - It is an AI player to the table ("AI n"), takes no vote and has no prompts on the table.
        - A restarted bridge logs it back in; a dropped link isn't retried, so the engine concedes that seat.
        - Its default deck is `ai_passive_lands`, and any deck can be given.
      - **Forge AI** is the node's own Forge AI. The node has one AI profile; picking a profile would need a node change.
      - **Deck lists.** Pasted or loaded from a .txt/.dek/.dck file on the page. Arena/Moxfield style: `1 Name`,
        `1x Name`, `Name (SET) 123 *F*`, tags; the commander under `Commander` or marked `*CMDR*`; `Sideboard`,
        `Maybeboard` and `Companion` parts aren't played. Every card must be known to the engine. The deck size isn't
        checked: an AI's deck is the host's business.
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
        that run's token.
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
      - **Draw and mill aren't built.** The engine's board never shows library cards (the library zone is empty in
        every view), so no fix op can move one. They need a new harness StateOp (`draw`/`mill` with player and n) in
        manabrew, and then an engine image rebuild (node and relay both parse directives strictly).
      - **Needs a live check on the real table:** each tool once in a game with a second person (the vote) and vs AI.
22. **Monte Carlo simulation: CUT** (the user, 2026-11-10).
    - Too slow on an ordinary PC: about 30 s to 2 min a game on 2 cores, so 1,000 games takes overnight.
    - The user already runs deck tests in separate sessions.
    - Reconsider only if it is hosted on a server. Route notes, if it ever returns: Forge's headless `sim` (SimulateMatch,
      `-f commander -d a b c d -n N -c <timeout>`), one JVM per core.

19. **One-click friend package** (asked 2026-11-09, top priority). The user is handing the current build to a friend.
    - A zip with MTG Companion.exe, bundled node, a bridge that runs from the package (MTG_HOME), saved engine images, the table save and a README.
    - The friend installs Docker Desktop, unzips, and double-clicks. Then they load "MTG Table (rules engine)" in TTS.
    - Being built in parallel on branches friend-pkg and companion, then tested as a fresh install.

Also queued from earlier work:
- The graveyard-castable hover-text alarm.
- Rancor sitting off the graveyard pile.
- Viscera Seer's cancel loop.
- A hanging rewind vote.
- Token attackers listed with no size.
- #10 sorting after #1 in option lists.
- Dredge splitting "draws two cards" into two lines.
- Mayhem, Harmonize, Beam me up and Plot cards never get mayPlay, so they aren't playable from the row (e.g. Rocket-Powered Goblin Glider). Harness: add the keywords to the graveyard clause and isPlotted() to exile; engine image rebuild.
- The table self-check false-alarms "wrong place" on a card in an opponent's graveyard or exile that you may play (Mnemonic Betrayal, Thief of Sanity). The check uses the owner's mat, but the card lies on the caster's (engine-renderer.lua ~7090). Seen only from reading the code.
- Reveal stand-in tests: priority-frame own-player condition, stand-in frame, stand-in hover text (mutants S11, S12, S16 escape).
