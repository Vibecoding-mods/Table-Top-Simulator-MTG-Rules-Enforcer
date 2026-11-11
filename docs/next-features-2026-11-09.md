# Next task list (asked 2026-11-09)

The user's list, in their order. Most items need a running TTS table in debug mode to fix and confirm.

1. **Moving cards.** Before the game starts, any player can move any card, and not only before the engine is turned on. After a game ends, players can't touch other players' cards.
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
18. **More debugging commands inside TTS.**
    - Debug mode (`mtg debug`) exists; this means more of it.

20. **AI seat presets in the companion page** (asked 2026-11-10). This merges with item 17.
    - For each empty seat, pick one of:
      - **Harmless bot:** passes priority, keeps its hand, never attacks or blocks. Good for testing.
      - **Forge AI:** a real opponent, with an AI profile.
    - Each AI seat gets its own imported deck, from a deck list or a file.
    - Rough size: 8–12 h.
21. **Debug tools in the companion page** (asked 2026-11-10). This merges with item 18.
    - Add X mana, add card X to a hand, draw, set life, mill, put a card on the battlefield, and untap.
    - Host only, and only in debug mode.
    - Builds on `mtg debug` and the M7 createCard/applyState ops. Adding mana may need a harness op and an image rebuild.
    - Rough size: 8–14 h.
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
    - **Seen live 2026-11-10 ~11:48** (the user vs vinlea2203, packaged build): White had Crawlspace and Norn's Annex.
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
      and its Cancel is "Don't attack with Grizzly Bears". Part 3 (engine) is not built: it is needed for effects
      with no text on the board (War Tax, emblems, resolved spells).

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
- The graveyard-castable hover-text alarm.
- Rancor sitting off the graveyard pile.
- Viscera Seer's cancel loop.
- A hanging rewind vote.
- Token attackers listed with no size.
- #10 sorting after #1 in option lists.
- Dredge splitting "draws two cards" into two lines.
- ✅ Mayhem, Harmonize, Beam me up and Plot cards never get mayPlay, so they aren't playable from the row (e.g. Rocket-Powered Goblin Glider). Harness: add the keywords to the graveyard clause and isPlotted() to exile; engine image rebuild. Done 2026-11-11 (image `bugs1111`; Mayhem only for a card discarded this turn; MayPlayVisibilityTest).
- The table self-check false-alarms "wrong place" on a card in an opponent's graveyard or exile that you may play (Mnemonic Betrayal, Thief of Sanity). The check uses the owner's mat, but the card lies on the caster's (engine-renderer.lua ~7090). Seen only from reading the code.
- ~~Reveal stand-in tests (S11, S12, S16)~~: done in f1e2a16.
- From the 2026-11-10 real-table check (docs/release-check-2026-11-10/):
  - ~~under GAME OVER, Sen Triplets' stand-ins in the playable row still glow~~: fixed in source 287a12b (no playable
    row once the game is over), not deployed;
  - on a Mindslaver turn, White's own priority was passed by itself in the blockers step and with a spell on the stack (Auto timer on), so Reflect Damage couldn't be cast there;
  - `ai_passive_lands` still casts a Counterspell a scenario puts in its hand.
