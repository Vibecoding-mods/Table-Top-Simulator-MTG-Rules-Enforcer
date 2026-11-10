# Real-table check of release-1110, 2026-11-10

Deployed: bridge d76307fa, table a9a1370e, save d9a5ed74, node a8c9de3ee222 (`:reveal`), relay dbfe69213fff.
Game: White on `rebuilt_niv` vs one Forge AI (`ai_passive_lands`), set up with `mtg debug release-check` (then
`release-check2` and `release-check3` mid-game). Moves were sent through the table's own functions (enginePick,
engineConfirm, `mtg hold`, `mtg concede`). Screenshots are TTS-window captures (tools/tts-shot.ps1).

| # | Check | Result | Shot |
|---|---|---|---|
| 1 | Revelation: the AI's revealed hand is a strip of small cards on its mat | PASS (10 cards, matches the engine's `revealed` list) | 01-table.jpg |
| 2 | Courser of Kruphix + Opt's scry: the top card is offered once beside Done, nothing thrown around the board | PASS | 02-scry.jpg |
| 3 | Arc Trail asks "deal 2 damage to which target?" then "deal 1 damage to which other target?" | PASS | 03-arc1.jpg, 04-arc2.jpg |
| 4 | Two Serra Angels (Clone's copy and the AI's) are told apart: "Serra Angel 4/4 (AI 1's)" / "(yours)" | PASS (Bolt's and Shock's target lists) | 05-serra-tags.jpg |
| 5 | Mindslaver: "AI 1's priority (you control)", "TURN RUN BY WHITE" by the AI's life, the AI's hand as stand-ins in White's second hand zone with its castable card glowing; log "White takes control of AI 1's turn" / "...ends" | PASS | 06-mindslaver.jpg |
| 6 | Sen Triplets: the AI's hand cards as glowing stand-ins in White's playable row; the reveal strip stays | PASS | 07-sen.jpg |
| 7 | Redirect line: "Lightning Bolt's damage is dealt to White instead (Reflect Damage)" and "White: 35 -> 32 life (-3, damage from Lightning Bolt, redirected by Reflect Damage)"; Reflect Damage's list titled "choose a source", sorted, with owner tags | PASS | 08-redirect.jpg |
| 8 | Game over: "GAME OVER White conceded. AI 1 wins", no Next / End turn left | PASS | 09-gameover.jpg |

Not reached: the combat-damage redirect (Kykar #6, Hill Giant). On the Mindslaver turn the table passed White's own
priority in the blockers step and after the Shock, so Reflect Damage could not be cast there. The same line for
combat damage is covered by the bridge events test (the real Kykar #6 sequence).

New findings (queued):
- Under GAME OVER, the Sen Triplets stand-ins in White's playable row still glow (09-gameover.jpg).
- On a turn White controls (Mindslaver), White's own priority as White is passed by itself in the blockers step and
  with a spell on the stack (the Auto timer was on, 2 s); check whether a held priority or the timer is the cause.
- The AI with `ai_passive_lands` still cast the Counterspell a scenario put in its hand.
