# Hand test: Kykar, Wind's Fury (the user's deck, 2026-11-07)

Deck: `decks/kykar_winds_fury.json` (Jeskai spells/tokens, 100 cards, commander Kykar, Wind's Fury). Every name has a
Forge script (cardsfolder) and an entry in `bridge/forge-cards.json`; split cards are Forge's `Expansion // Explosion`
(`e/expansion_explosion.txt`) and `Wear // Tear` (`w/wear_tear.txt`).

Set-up: White = `kykar_winds_fury` vs one Forge AI on `ai_bigboard` (walls, rocks, self-mill: it casts spells to
counter and is harmless), debug scenarios `scenarios/kykar-*.json` put batches of the deck's cards in hand with 99 of
each mana floating; the AI gets four plain creatures (Grizzly Bears, Hill Giant, Serra Angel, Craw Wurm) as removal
targets and attackers, and 400 life so token damage doesn't end the game. Actions through `tmp/live-checks/lc.js`
(the table's own play intent and panel picks). Bridge e63981d4, table 88506f9f (deployed 2026-11-07T02:30:57Z).

TTS objects: fresh table 68,991; after the game start and the first turn's rocks 82,896 (over the ~78k mark at once:
the first game per launch adds ~11k plus the deck's own pictures).

## Bugs found (numbered as found)

1. TABLE BUG (turn 2, White main 2). The priority panel offers Kykar's mana ability as `Mana: tap Kykar, Wind's Fury`
   (`{__mana:engine-card-199}`), but the ability is "Sacrifice a Spirit: Add {R}." and doesn't tap Kykar. Picking it
   asked the right question (`Kykar, Wind's Fury: choose a creature to sacrifice`, text `Sacrifice a Spirit: Add {R}.`,
   the 7 Spirit tokens) and Kykar stayed untapped (rotation y 180, engine tapped false). Expected a label like
   `Mana: Kykar, Wind's Fury (sacrifice a Spirit)`; actual "tap".
2. TABLE BUG, log wording (turn 2). Sacrificing a Spirit to Kykar's mana ability logs
   `Spirit token is sacrificed (to pay for Kykar, Wind's Fury)`, which reads as paying for casting Kykar. No spell was
   being paid for (R pool 98 -> 99). Expected "for mana (Kykar, Wind's Fury)" as other mana sacrifices say.
3. TABLE BUG, log (turn 2). Skullclamp's equip logs `White uses Skullclamp's ability` and then `Elemental token dies`,
   `Skullclamp's ability triggers (White)`, `White draws 2 cards`: the line never says what Skullclamp was attached to.
   Expected "White equips Elemental token with Skullclamp" (or the target in the uses line).
4. TABLE BUG (turn 3, AI 1's combat). Painlands: paying Reflect Damage with `Tap Adarkar Wastes for {W}`,
   `Tap Battlefield Forge for {R}`, `Tap Shivan Reef for {U}` logged three bare lines `White: 38 -> 37 life (-1)`,
   `White: 37 -> 36 life (-1)`, `White: 36 -> 35 life (-1)` with no source, and the pay labels don't say the coloured
   tap costs 1 life. Expected "White: 38 -> 37 life (-1, Adarkar Wastes)" and a label like "Tap Adarkar Wastes for {W}
   (1 damage to you)".
5. TABLE BUG (turn 3). Reflect Damage's source question lists Forge's two separator rows as pickable options:
   `1. --PERMANENTS:--   {engine-card-263}` and `2. --SPELLS ON THE STACK:--   {engine-card-264}` (raw prompt: two fake
   cards named so, setCode "???"). Its title is `Reflect Damage: choose a card` while Forge's description is
   `Choose a source `. Expected: separators dropped (or shown as headings), title "Reflect Damage: choose a source".
6. TABLE BUG, log (turn 3). Reflect Damage then redirected Hill Giant's 3 combat damage to AI 1: the log has only
   `AI 1: 404 -> 401 life (-3)`; nothing says which source was chosen or that the damage was redirected (and Hill
   Giant's attack dealt no damage line at all). Expected e.g. "White chooses Hill Giant (Reflect Damage)" and
   "Hill Giant's damage is dealt to AI 1 instead (Reflect Damage)".
7. TABLE BUG, log (turn 3). "Unless that player pays" outcomes are not logged. Esper Sentinel's trigger on AI 1's
   Marble Diamond resolved with no line; AI 1 paid {1} (its third Island got tapped, White drew nothing). Rhystic
   Study (`Rhystic Study: draw a card?` Yes) and Mystic Remora (`Mystic Remora: draw a card?` Yes) only gave
   `White draws a card`. Expected "AI 1 pays {1} (Esper Sentinel)" / "AI 1 doesn't pay {1}: White draws (Rhystic
   Study)". Same as HAND-TEST-REBUILT #13, still open.
8. TABLE BUG, log (turn 3). `White casts Counterspell` names no target and the result is `Marble Diamond is countered`
   without what countered it. Expected "White casts Counterspell targeting Marble Diamond" or "Marble Diamond is
   countered by Counterspell". (Also `White casts Swords to Plowshares` / `Path to Exile`: no target in the cast line;
   the exile line does name the spell: `Serra Angel is exiled with Swords to Plowshares`.)
9. TABLE BUG, small (turn 2). Lists of same-named tokens sort as text: Skullclamp's `attach to which creature`
   offered `Spirit Token 1/1 (token) #1`, `#10`, `#11`, `#2`, `#3` ... Expected #1, #2, ... #10, #11.
10. TABLE BUG, log (turn 4). Fact or Fiction: after `White reveals Ghostly Prison, Mind Stone, Island, Anointed
    Procession, Experimental Augury from their library (Fact or Fiction)` and the pile pick (`-- Pile 2 (3 cards) --
    Ghostly Prison Mind Stone Experimental Augury`), the log says `White puts 3 cards from their library into their
    hand` (the cards were revealed: names are public) and nothing about AI 1 splitting the piles or White's choice.
    Expected "White puts Ghostly Prison, Mind Stone, Experimental Augury into their hand (Fact or Fiction)".
11. TABLE BUG, log (turn 4). Noncombat damage to a creature isn't logged: two Niv-Mizzet, Parun pings at Grizzly Bears
    gave only `Niv-Mizzet, Parun's ability triggers (White)` (twice) and then `Grizzly Bears dies`. Damage to players
    shows as a bare life line (`AI 1: 384 -> 383 life (-1)`) without the source. Expected "Niv-Mizzet, Parun deals 1
    damage to Grizzly Bears" / "... to AI 1".
12. TABLE BUG, log (turn 5, extra turn). Chaos Warp on Hill Giant (owned by AI 1, controlled by White through Blue
    Sun's Twilight) logged `Hill Giant is put into White's library`; the engine put it into AI 1's library (AI 1 library
    90 -> 91, then `AI 1 reveals Fellwar Stone from their library (Chaos Warp)`, `Fellwar Stone enters the battlefield
    (AI 1)`). Expected "Hill Giant is shuffled into AI 1's library": the zone line uses the controller, not the owner.
13. TABLE BUG, log (turn 5). Planeswalker abilities log only `White uses Ral Zarek's ability` /
    `White uses Ral, Storm Conduit's ability`: not which ability (Ral Zarek's -2, Ral, Storm Conduit's -2), the loyalty
    change (Ral Zarek 4 -> 2, engine counters {"Loyalty":2}) or the target. Ral Zarek's -2 at Errant, Street Artist (AI
    1's commander) was followed only by `Errant, Street Artist returns to the command zone` (no "deals 3 damage", no
    "dies" first). Expected "White activates Ral Zarek's -2 (loyalty 4 -> 2) targeting Errant, Street Artist", "Ral
    Zarek deals 3 damage to Errant, Street Artist", "Errant, Street Artist dies and returns to the command zone".
14. TABLE BUG, log, small (turn 5). Casting only the Explosion half logs `White casts Expansion // Explosion`
    (the questions were titled `Explosion: choose X`, `Explosion: choose a target to deal damage to`). Expected
    "White casts Explosion" (a split card on the stack is only the half cast). The copy from Ral, Storm Conduit's -2
    logged well (`White copies Explosion`), but its questions word the same choice differently: original
    `Explosion: which player draws X cards?`, copy `Copy of Explosion: choose a player to draw`.
15. RULES BUG (engine cap), game 1 turn 5 (White's Time Warp extra turn), 06:06:08 UTC. The game was force-ended as a
    DRAW in the middle of White's turn: White passed priority in main 1 (empty stack, question #760) and the engine
    answered `gameOver`. Forge room log: `Game: Runaway-game soft cap hit: 5001 triggers fired on turn 5 (cap 5000);
    forcing a Draw to protect co-tenant games.` and `forge.game.Game$RunawayGameException: Runaway game: 5001 triggers
    fired in one turn (cap 5000); game force-ended as a draw.` (at `Game.checkRunawayCap(Game.java:1215)`). That turn
    White cast ~12 spells with Kykar, Young Pyromancer, Monastery Mentor (and ~20 Monk tokens with prowess), Third
    Path Iconoclast, Storm-Kiln Artist, Firebrand Archer, Archmage Emeritus, Niv-Mizzet, Parun, Ral, Storm Conduit,
    Saheeli, Impact Tremors, and Veyran doubling every cast trigger: ordinary play for this deck, no loop. Not a
    rules-correct result (a real game goes on); the cap is far too low for a Kykar/Veyran/Mentor turn, or it should
    count only a repeating loop. Also the game can't be rewound after it: the engine session was aborted (`aborting
    stale engine session ... reason="room reset to lobby"`), the Undo... and Fix... buttons are gone, and `mtg undo`
    to `turn 5, White's upkeep` answered `[MTG] Players who are out can't ask to rewind.` So the user loses the whole
    game, with no rewind, to a turn the deck is built to have.
16. TABLE BUG (game 1, same moment). The table never says why the game ended: chat `[MTG] White has lost the game.`,
    `[MTG] AI 1 has lost the game.`, `[MTG] GAME OVER - draw.`, `[MTG] Game over.`, `[MTG] Game aborted.`; game log
    `Game over`. The rewind refusal `Players who are out can't ask to rewind.` is wrong too (nobody conceded; the game
    was aborted). The top bar still reads `YOUR TURN ... MAIN 1` (shot `k-gameover.jpg`). Expected a line like "The
    engine stopped the game: over 5000 triggers in one turn (runaway cap). It counts as a draw." and a refusal that
    says the game has ended.

Game 2 (after the forced draw; fresh TTS launch, `scenarios/kykar-g2.json`: the cards game 1 never reached, no
Veyran / Young Pyromancer / Monastery Mentor so the turn stays under the cap):

17. TABLE BUG (game 2 turn 2). With Anointed Procession and Mondrak, Glory Dominus out, Kykar's Spirit asked which
    replacement goes first as `Kykar, Wind's Fury: choose one` with the two options
    `If an effect would create one or more tokens under your control, it creates twice that many of those tokens
    instead.` / `If one or more tokens would be created under your control, twice that many of those tokens are created
    instead.` No card names (raw prompt: chooseFromSelection, title `Choose`, source card Kykar). Expected a title like
    "Kykar's Spirit: which token doubler applies first?" and options "Anointed Procession: ..." / "Mondrak, Glory
    Dominus: ...". (The result was right: `White creates 4 Spirit tokens`.)
18. TABLE BUG, small (game 2 turn 2). Mondrak's ability label reads `Sacrifice two other artifacts and/or
    creatureses` (Forge's cost description is already plural: `other artifacts and/or creatures`).
19. TABLE BUG, log (game 2 turn 3, White's Time Warp extra turn). AI 1 cracking a Clue in response logs as a cast:
    `AI 1 casts Clue Token`, `Clue token is sacrificed`, `AI 1 draws a card` (bridge: `payManaCost "Pay {2} for Clue
    Token"`). The other Clue, destroyed by Jin-Gitaxias's copy of Wear, shows as `Clue token leaves the battlefield`
    instead of "is destroyed". Expected "AI 1 sacrifices a Clue token: draws a card" and "Clue token is destroyed".
20. TABLE BUG, small (game 2 turn 3). Fused Wear // Tear asks both targets with the same title and the fuse reminder
    as text: `Wear // Tear: choose a target to destroy` (text `Fuse (You may cast one or both halves of this card from
    your hand.)`) for the artifact, then the same title for the enchantment; the copy too (`Copy of Wear // Tear:
    choose a target to destroy`). Expected "Wear: destroy which artifact?" / "Tear: destroy which enchantment?". The
    how-to-play question was right: `Cast Wear`, `Cast Tear`, `Cast both halves (fuse)`, `Back`.
21. TABLE BUG, log, small (game 2 turn 3). Slip Out the Back on Jin-Gitaxias logged `Jin-Gitaxias, Progress Tyrant
    phases out` and then `Jin-Gitaxias, Progress Tyrant gets a +1/+1 counter`: the card puts the counter on first, then
    phases it out. The engine was right (GET /card: `"counters": {"P1P1": 1}`, `"phasedOut": true`, power 6) and the
    table showed it tinted blue with a PHASED OUT label (shots `g2-slip.jpg`, `g2-conceal.jpg`). Expected the two
    lines the other way round. Also Mentor of the Meek paid ({1} from the pool, `Mentor of the Meek: pay {1}?` Yes)
    logs only `White draws a card`: no "White pays {1} (Mentor of the Meek)" (like #7).
22. TABLE BUG (game 2 turns 3 and 8). The free casts of Flawless Maneuver and Fierce Guardianship (Kykar on the
    battlefield) are offered as `Cast Flawless Maneuver — alternative cost` / `Cast Fierce Guardianship — alternative
    cost` (engine action `mode: {"type": "staticAlternative"}`, label `Cast Flawless Maneuver`, no description). Both
    were free (no payment question, pool unchanged), but the log says only `White casts Flawless Maneuver` /
    `White casts Fierce Guardianship`. Expected a label like "Cast Flawless Maneuver without paying its mana cost (you
    control a commander)" and a log line "White casts Flawless Maneuver without paying its mana cost". When Kykar was
    phased out (Guardian of Faith) the free option was correctly not offered.
23. TABLE BUG, small (game 2 turns 3 and 6). Multi-target questions don't say what the targets are for:
    Guardian of Faith's trigger `Guardian of Faith: choose up to 70 targets` (no text line at all), Clever
    Concealment's `Clever Concealment: choose up to 120 targets`, Experimental Augury's proliferate
    `Experimental Augury: choose up to 1 card` (text `Choose any number of permanents and/or players for proliferate`).
    Expected "Guardian of Faith: which creatures phase out?", "Clever Concealment: which permanents phase out?",
    "Experimental Augury: proliferate which?". The Guardian list also sorts `Spirit Token 2/2 (token) #1` then `#10`
    (#9).
24. TABLE BUG (game 2 turn 7, AI 1's turn). Deflecting Palm repeats #5 and #6: `Deflecting Palm: choose a card` with
    three separator rows as options (`1. --CARDS IN THE COMMAND ZONE:--`, `2. --PERMANENTS:--`, `3. --SPELLS ON THE
    STACK:--`), and choosing Serra Angel logged nothing (no "White chooses Serra Angel (Deflecting Palm)"). Expected
    "Deflecting Palm: choose a source" and no separators.
25. TABLE BUG (game 2 turn 12). Big Score reads as an ability. Fierce Guardianship's target list showed
    `1. Big Score (your ability)   {spell|engine-stack-286}` for the spell, and Jin-Gitaxias's copy of it logged
    `White uses Big Score's ability` (then `White creates 4 Treasure tokens`, `White draws 2 cards`) instead of
    "White copies Big Score" (Reverberate's and Expansion's copies of Mystical Tutor logged `White copies Mystical
    Tutor` correctly). Likely cause (from reading the code, not tested): `bridge/bridge.js` `isAbilityOnStack`
    (line 1399) treats any stack text starting with `As` as a trigger (`/^(When|Whenever|At|As)\b/`), and Big Score's
    text starts "As an additional cost to cast this spell, discard a card." The cast itself logged right (`White casts
    Big Score`, `White discards Mountain (to pay for Big Score)`). Also the counter wasn't logged: after `White casts
    Fierce Guardianship` the next Big Score line is `Big Score is exiled from White's graveyard with Arcane
    Bombardment`; there's no "Big Score is countered".
26. TABLE BUG, log (game 2). More events with no source, the same family as #4 and #11. Kykar's double-strike
    lifelink attack logged `White attacks with Kykar, Wind's Fury`, `White: 48 -> 51 life (+3)`,
    `AI 1: 348 -> 345 life (-3)`, `White: 51 -> 54 life (+3)`, `AI 1: 345 -> 342 life (-3)`, with no "Kykar deals 3
    combat damage". Electrostatic Field's lifelink ping is a bare `White: 42 -> 43 life (+1)`. Akroma's Will (both
    modes) resolved with no line at all (the keywords did reach the cards: GET /card Kykar `Flying, Vigilance, Double
    Strike, Lifelink, Indestructible, Protection from each color`). The original Arcane Denial, its target already
    countered by Jin-Gitaxias's copy, left the stack with no line.
27. TABLE BUG, small (game 2 turns 5 and 8). Arcane Bombardment's cast question is
    `Arcane Bombardment: play which card?` with the text `Pick from the list, or right-click the graveyard/exile →
    Search and drag the card out.`: the options are copies of the exiled cards, which can't be dragged out of the
    exile. Expected "Arcane Bombardment: cast which copy?" without the drag hint. (Picking a copy worked: Fateful
    Absence's copy destroyed Errant, Street Artist.)

Repeats seen in game 2 (not new): #9 (token sort), #10 (`White puts 2 cards from their library into their hand`
after Fact or Fiction; the piles shown were `-- Pile 1 (2 cards) -- Ral, Storm Conduit Mystic Remora`), #13
(`Errant, Street Artist returns to the command zone` after Fateful Absence's copy, no "is destroyed"), #14 (`White
casts Expansion // Explosion` for the Expansion half), #19 (`AI 1 casts Clue Token` at White's end step), #8 (Jin's
counter: `Talisman of Dominance is countered`, no source).

## Seen working

Game 1: shockland question (pay 2 life or tapped), Sulfur Falls untapped, Time Warp header `--- White's turn N
(extra turn) ---` with the EXTRA TURN mark, Mystic Remora cumulative upkeep (pay and decline), Kykar's sacrifice in a
payment (`Use Kykar ... (sacrifice a Spirit)`), tutors, Blue Sun's Twilight X=5 copy, Veyran doubling, Ral, Storm
Conduit's -2 copy (`White copies Explosion`), Saheeli's -2 (`Fellwar Stone becomes Archmage Emeritus`), the legend
rule question, Raugrin Triome cycling.

Game 2: Steam Vents declined, so it entered tapped; Path of Ancestry tapped; Glacial Fortress and Clifftop Retreat
untapped (check lands); Spirebluff Canal, Seachrome Coast, Inspiring Vantage tapped (fast lands with 3+ other lands);
Mystic Monastery tapped; Karn's Bastion proliferate; Mindsplice Apparatus oil counters and cost reduction (`Pay {U}`
for Arcane Denial, `Pay {U}{U}{R}` for cleaved Alchemist's Gambit); Jin-Gitaxias copying Solve the Equation, Wear //
Tear, Arcane Denial, Alchemist's Gambit and countering AI 1's Talisman of Dominance; Arcane Bombardment; Fateful
Absence and its Clue; `White creates 4 Spirit tokens` with both doublers; Akroma's Will `choose 1 to 2` with a
commander out, both modes applied; Intangible Virtue (Spirits 2/2, back to 1/1 while it was phased out); Experimental
Augury; Fact or Fiction piles; `mtg hold`, then Reverberate (`Reverberate: copy which instant or sorcery spell?`) and
Expansion (`Expansion: copy which instant or sorcery spell with mana value 4 or less?`) on Mystical Tutor, three
tutors (`White reveals Counterspell, shuffles and puts it on top of their library`); Brass's Bounty
(`White creates 44 Treasure tokens`, 22 lands doubled by Mondrak; the table shows one x44 stack; objects 85,431 to
85,510); Alchemist's Gambit cleave twice (`White casts Alchemist's Gambit (cleave)`), extra turns
`--- White's turn 6 (extra turn) ---` and `7 (extra turn)` and no lose trigger, including Jin's copy (Forge's script
copies the cleave ability); Guardian of Faith flash and phasing (Kykar and Jin left the attacker list and phased in at
White's untap: `Kykar, Wind's Fury phases in`); Clever Concealment convoke (`Tap Spirit Token (Convoke: pays {1} or
one mana of its colour)` twice), phasing out Mindsplice and Intangible Virtue; Arcane Denial's delayed draws (`White
draws a card`, `AI 1 draws 2 cards`); Counterspell on AI 1's commander (`Errant, Street Artist is countered and
returns to the command zone`); Big Score's discard cost.

## How it was played

- Game 1 (`scenarios/kykar-1.json`, then `kykar-2.json` mid-game): turns 1-5. Two TTS relaunches mid-game at safe
  points (the bridge resumed the game both times). Ended by the engine's runaway cap (#15), a forced draw that can't
  be rewound.
- Game 2 (`scenarios/kykar-g2.json`, fresh TTS launch): turns 1-12 (White's turns 1-8, three of them extra turns).
  Veyran, Young Pyromancer and Monastery Mentor were kept off the battlefield so the trigger count stayed under the cap.
- No freeze, no crash, no NVIDIA driver reset in either game. Loaded Objects stayed above the 78k mark the whole
  time (82.9k after game 1's first turn; a relaunch only redraws to ~84.6k, so relaunching never gets under 78k).
  Game 2 ended at 86,326 with no trouble.

## Cards played / not played

Played (cast, played as a land, activated or used for mana): 73 of the 90 names by the game logs. Also played: the
lands the scenarios put straight onto the battlefield, all tapped for mana every turn (Adarkar Wastes, Battlefield
Forge, Shivan Reef (painland life, #4), Command Tower, Floodfarm Verge, Riverpyre Verge, Karn's Bastion (proliferate),
Reliquary Tower, Island, Mountain). Raugrin Triome was cycled, not played.

NOT PLAYED:
- Sacred Foundry: stayed in the library (never drawn; the deck's tutors can't find lands).
- Not fully tested: Propaganda was on the battlefield from game 2 turn 2, but AI 1 never attacked, so the {2} tax
  never came up. Deflecting Palm was cast and a source chosen, but that source never dealt damage, so the
  prevent-and-redirect never happened. Reflect Damage was tested in game 1 only.
- Path of Ancestry's scry: not seen (no Wizard cast with its mana).

## End state

Game 2 is still running and was left alive (no `mtg reset`). It's turn 12, White's main phase 1 (White's 8th turn):
White 54 life, AI 1 334 life, stack empty. It can be rewound with Undo: the `mtg` rewind points list goes back to
turn 9 (the menu shows the newest 12). So everything from turn 9 on, including Big Score (#25), can be re-tested
from there. Game 1 can't be rewound (#15). Bridge e63981d4, table 88506f9f, node image 369481787d62, Loaded Objects
86,326.

## Re-test 2026-11-09

Deploy: bridge e517dd99, table 0fa50b21, engine mtg-forge-node:trek ef61822078a0 (main 829c900). One game on the real
table: White = `kykar_winds_fury` vs one Forge AI on `ai_bigboard`, set up by `scenarios/kykar-r1.json` (game start),
then `kykar-r2.json` and `kykar-r3.json` typed mid-game (`mtg debug ...`). Driven with `tmp/live-checks/lc.js`; badges and
the extra-turn number read from the table's Lua (`engineBadge`, the life tracker's buttons). Ended by White's concession.
TTS objects: 68,991 fresh, 76,769 at the first priority, peak 85,061; no freeze, crash or driver reset.

### The 27 Kykar bugs

| # | result | what the table showed |
|---|---|---|
| 1 | PASS | `Mana: Kykar, Wind's Fury (sacrifice a Spirit)`; Treasures read `Mana: tap Treasure Token (also sacrifice this token)` |
| 2 | PASS | `Spirit token is sacrificed for mana (Kykar, Wind's Fury)` |
| 3 | PASS | `White equips Spirit token with Skullclamp`, `Spirit token dies`, `White draws 2 cards` |
| 4 | PASS | labels `Tap Adarkar Wastes for {U} (1 damage to you)`; log `White: 40 -> 39 life (-1, damage from Adarkar Wastes)`, `White: 39 -> 38 life (-1, damage from Shivan Reef)` |
| 5 | PASS | `Reflect Damage: choose a source`, no separator rows; sources say `Deflecting Palm (on the stack)`, `Errant, Street Artist 0/3 (command zone)` |
| 6 | FAIL (half) | `White chooses Hill Giant (Reflect Damage)` is there, but the redirect isn't: Hill Giant's 3 (Reflect Damage) and Deflecting Palm's 2 came out as one bare `AI 1: 378 -> 373 life (-5)` |
| 7 | PASS | `AI 1 pays {1} (Rhystic Study)`, `AI 1 doesn't pay {1} (Rhystic Study)`, `AI 1 doesn't pay {1} (Esper Sentinel)`, `AI 1 doesn't pay {4} (Mystic Remora)` |
| 8 | PASS | `White casts Counterspell targeting Errant, Street Artist`, `Errant, Street Artist is countered by Counterspell and returns to the command zone`; `Hedron Archive is countered by Fierce Guardianship` |
| 9 | PASS | `Spirit Token 1/1 (token) #1` ... `#10`, `#11` in order (and on up to `#42`) |
| 10 | PASS | `White reveals Rhystic Study, Talisman of Progress, Island, Island, Chaos Warp from their library (Fact or Fiction)`, `White puts Island, Chaos Warp into their hand`, `White puts Island, Rhystic Study, Talisman of Progress into their graveyard from their library` |
| 11 | PASS | `Lightning Bolt deals 3 damage to Grizzly Bears`, `Ral Zarek deals 3 damage to Craw Wurm` |
| 12 | FAIL | Chaos Warp on AI 1's Serra Angel (stolen with Control Magic): `Serra Angel is put into White's library`, then `AI 1 reveals Wall of Air 1/5 from their library (Chaos Warp)`. AI 1's library stayed 92 (Serra in, Wall out) and White's stayed 97, so it went to AI 1's library |
| 13 | PASS | `White activates Ral Zarek's -2 (loyalty 4 -> 2) targeting Craw Wurm`, `Ral Zarek deals 3 damage to Craw Wurm`, `White activates Liliana of the Veil's -2 (loyalty 3 -> 1) targeting AI 1`, `Wall of Air is sacrificed (Liliana of the Veil)`. A commander dying: not reached |
| 14 | PASS | `White casts Explosion targeting AI 1 and White` |
| 15 | NOT REACHED | the engine's trigger cap (engine batch); no Veyran/Mentor turn this game |
| 16 | PASS | concession: `[MTG] GAME OVER - White conceded. AI 1 wins.`, log `Game over: White conceded. AI 1 wins`, top bar `GAME OVER White conceded. AI 1 wins` |
| 17 | PASS | `Kykar, Wind's Fury: which applies first?` with `Anointed Procession: ...` / `Mondrak, Glory Dominus: ...` (also `Big Score: which applies first?` for its Treasures) |
| 18 | PASS | `Mondrak, Glory Dominus: {1}{W/P}{W/P}, Sacrifice two other artifacts and/or creatures: ...` |
| 19 | NOT REACHED | AI 1 got a Clue from Fateful Absence (`AI 1 creates a Clue token`) but never cracked it in 3 turns |
| 20 | PASS | `Wear: destroy which artifact?`, `Tear: destroy which enchantment?`; `White casts Wear // Tear targeting Mind Stone and Exploration`, `Mind Stone is destroyed`, `Exploration is destroyed` |
| 21 | PASS | `Dinosaur Beast Token gets a +1/+1 counter` then `Dinosaur Beast Token phases out`; `White pays {1} (Mentor of the Meek)`, `White doesn't pay {1} (Mentor of the Meek)` |
| 22 | PASS | `Cast Flawless Maneuver without paying its mana cost (you control a commander)`, `White casts Flawless Maneuver without paying its mana cost`; `White casts Fierce Guardianship without paying its mana cost targeting Hedron Archive` |
| 23 | PASS | `Guardian of Faith: which other creatures you control phase out?`, `Clever Concealment: which nonland permanents you control phase out?`, `Experimental Augury: give which another counter (proliferate)?` |
| 24 | PASS | `Deflecting Palm: choose a source`, no separators; `White chooses Grizzly Bears (Deflecting Palm)`, `Grizzly Bears' combat damage to White is prevented (Deflecting Palm)` (its 2 damage back: see #6) |
| 25 | PASS | Reverberate's list: `Big Score (your spell)`; `White casts Reverberate targeting Big Score`, `White copies Big Score`. Countering Big Score itself: not reached |
| 26 | PASS | `White: 38 -> 47 life (+9, lifelink from Kykar, Wind's Fury; lifelink from Quartzwood Crasher)`, `AI 1: 396 -> 387 life (-9, combat damage from Kykar, Wind's Fury; combat damage from Quartzwood Crasher)`, twice (double strike); Akroma's Will's keyword line |
| 27 | PASS | `Arcane Bombardment: cast which copy?`, text `The copy is cast; the card stays where it is.`; with one copy: `Cast Counterspell?` |

### Log-line rounds

- Damage: PASS. `AI 1: 400 -> 398 life (-2, damage from Shock)`, `AI 1: 397 -> 396 life (-1, damage from Explosion)`,
  Bolt and Ral above. Arc Trail (two amounts) stays bare by design: `AI 1: 398 -> 397 life (-1)`, nothing for its 2 at
  Craw Wurm.
- "Each creature", plain (Pyroclasm): amount and source right, but see new bug 3 (one line per token). With an exclusion
  (Fiery Cannonade, "non-Pirate"): PASS, no damage line, only `Craw Wurm dies`.
- Rhystic Study, Esper Sentinel, Mystic Remora: PASS (#7).
- Reflect Damage, Circle of Protection, Deflecting Palm: choices and preventions PASS (`White chooses Gray Ogre (Circle of
  Protection: Red)`, `Gray Ogre's combat damage to White is prevented (Circle of Protection: Red)`); the redirect and the
  Palm's damage back FAIL (#6).
- Targets on casts: PASS. `White casts Arc Trail targeting Craw Wurm and AI 1`, `White casts Pacifism targeting Craw
  Wurm`, `White casts Diabolic Edict targeting AI 1` + `Gray Ogre is sacrificed (Diabolic Edict)`.
- Cost sacrifice: PASS. `White casts Bone Splinters targeting Hill Giant`, `Spirit token is sacrificed (to pay for Bone
  Splinters)`.
- Planeswalker loyalty: PASS (#13).

### Live-report fixes

- X/X token badge: PASS. Quartzwood Crasher's trample made two `Dinosaur Beast Token`s (base nil/nil, 6/6): badge
  `pt=6/6`, black.
- Each deck's basics: NOT REACHED. The debug start plays preset decks, which have no deck pictures, so both sides use the
  lookup by name (White's and AI 1's Island are both `.../1335d293-3dd2-4f13-bd2c-22181f4528ee.webp`). This needs decks
  readied from the table (live spawns, not done).
- Clone: PASS. Clone as Serra Angel: 4/4 over base 4/4, badge only `cp=COPY`.
- Face-down: PASS. Soul Summons' manifest: 2/2 over base 2/2, no P/T badge; after Giant Growth `pt=5/5 ... =under`.
- Concession: PASS (#16).

### Engine batch

- Extra turn: PASS. After Time Warp (`White will take an extra turn (1 coming)`) the life tracker has a button `2`,
  tooltip `White has 1 extra turn coming` (shot `tmp/live-checks/shots/r3-extra-turn.jpg`). It's gone in the extra turn.
- Rewind across it: PASS. From the extra turn's upkeep, Undo to `turn 5, White's second main phase` brought the `2`
  back (extraTurns 1), and passing on gave `--- White's turn 4 (extra turn) ---` again.
- Mindslaver: HALF. `White takes control of AI 1's turn`, mark `TURN RUN BY WHITE`, and AI 1's `Choose attackers` came
  to White; but see new bug 1: AI 1's main-phase priority never reached White.
- Star Trek: PASS. Assimilate the Wounded: `Grizzly Bears returns to the battlefield from AI 1's graveyard with a +1/+1
  counter (White)` (GET /card: Artifact Creature, Borg, 3/3); Make It So (`White casts Make It So targeting Karn's Bastion
  and AI 1`, `AI 1 draws 2 cards`, `Make It So untaps Karn's Bastion`); Vexing Drone entered as a 2/2 Borg.

### New bugs (re-test)

1. TABLE/BRIDGE BUG (Mindslaver turn). AI 1's main-phase questions were answered without being shown, so White could
   not play AI 1's land or cast its spells (AI 1 kept 7 cards and played no land). Bridge log: `White prompt #244
   chooseAction`, `#245` (main1), `#246`, `#247` (combatBegin) with no `prompt White #2xx` display line, then `prompt White
   #248: chooseAttackers`; after combat `#319` ... `#325` (combatDamage, combatEnd, main2) went the same way, up to
   `#326` at the end step. White had pressed Next only once, at AI 1's draw step.
2. TABLE BUG. Combat damage with Reflect Damage, Circle of Protection: Red and Deflecting Palm all set up asked
   `Choose` (no card name) with the three replacement texts as options (`The next time a source of your choice would deal
   damage this turn, that damage is dealt to that source's controller instead.` / `The next time the chosen red source
   deals damage to you, prevent that damage.` / `The next time the chosen source deals damage to you, prevent that
   damage.`), then `Choose` again with one option. #17's fix doesn't cover this prompt.
3. TABLE BUG, log. Pyroclasm writes one grouped line (`Pyroclasm deals 2 damage to Esper Sentinel, Spirit token, Kykar,
   ... Craw Wurm`) plus about 50 lines `Pyroclasm deals 2 damage to Spirit token`. One spell fills the 200-line game log.
4. TABLE BUG, small. Two Serra Angels (White's Clone copy and AI 1's original) show as `Serra Angel 4/4 #1` / `#2` in
   Control Magic's and Chaos Warp's lists, though they differ by owner and (for Control Magic) by controller.
5. TABLE BUG, small. Arc Trail asks `Arc Trail: choose a target to deal damage to` twice; Forge's prompts say `Select any
   target (2 damage)` / `Select any other target (1 damage)`.
6. TABLE BUG, log, small. Order: `Pacifism goes to the graveyard` before `Craw Wurm dies`; `AI 1 draws 2 cards` before
   `Make It So untaps Karn's Bastion` (the card untaps first).
7. TABLE BUG, log, small. Akroma's Will and Flawless Maneuver name every token: `Spirit token, Spirit token, ...` up to
   about 50 times in one line, instead of a count.
8. TABLE BUG, small. After the concession the panel still shows `Next` and `End turn`, and `Your priority` (#491) is
   still open under `GAME OVER` (shot `tmp/live-checks/shots/r3-gameover.jpg`).
9. ENGINE VIEW, small. The assimilated Grizzly Bears read `ownerId player-0` (White) in GET /card while on the
   battlefield; when sacrificed it went to AI 1's graveyard (`ownerId player-1`). A log line keyed on that owner would be
   wrong (compare #12).
10. TABLE BUG, log, small. Mondrak's Phyrexian cost paid with life is a bare `White: 55 -> 53 life (-2)`.

Scenarios: `scenarios/kykar-r1.json` (game start), `kykar-r2.json` and `kykar-r3.json` (mid-game, `"lands": 0`,
`"keepHand": true`). The game ended by concession; TTS was left running with the table loaded.

### Fixes (branch retest-fixes, source and tests only, not yet on the real table)

1. The bridge's Arena-style passing read "your main phase" as the seat's own slot; under Mindslaver the active player
   (and the board's priority) is AI 1, so AI 1's priority, routed to White, passed by itself. Now a question for a
   player the seat controls (`controlledBy`, the board's priority or active player, or what that player just cast)
   counts that player's turn and stack, is titled `AI 1's priority (you control)` / `AI 1 (you control): ...`, and pays
   from that player's pool. The controlled hand (Forge's MindSlaveMaster view shows it to White) is sent as `ctlHand`
   and laid in White's second hand zone, which only White sees; dragged out, White plays it. No engine change.
2. #12 / new bug 9: Forge's battlefield card names its controller as owner (InteractiveSnapshotExtractor builds a
   battlefield card with the index of the player whose battlefield holds it). The owner now comes from any other zone,
   a stack item, or Forge's events (`noteOwners`); the departure line uses the move's own owner. Stolen permanents also
   show `Owned by ...` again. (Engine side not changed.)
3. #6: the "which applies first?" question sits inside the damage, so the first damage board shows no loss yet and the
   redirect / Palm's damage back were dropped. What a shield owes a source's controller is kept for the next board of
   that step and said there only when the loss is exactly that.
4. New bugs 3 and 7: one line per amount, same names counted (`Spirit token ×50`), `each creature (N)` when every
   creature took it. New bug 2: prevention sentences count as replacement texts; options named by the sources chosen
   this turn (the card's "a red source of your choice would deal damage" against Forge's "the chosen red source deals
   damage"). New bug 4: same-named targets told apart by controller, then owner, before `#n`. New bug 5: Arc Trail's
   two questions say `deal 2 damage to which target?` / `deal 1 damage to which other target?`. New bug 6: an Aura
   gone after its host (Forge's order) and an untap before a draw (the spell's own order) are said in that order. New
   bug 8: a game over closes every open question (bridge) and the table drops its buttons (renderer). New bug 10:
   `(-2, paid for Mondrak, Glory Dominus)`.
5. Verifier's findings on this branch (source and tests only): the amount kept for #6 is said only on a board of the
   same step, after a "which applies first?" answer in that step, when nothing else known (a damage spell, a pain land,
   life paid) is part of that player's loss; a Reflect Damage that never applied stays chosen until it does. A first
   strike's split (the next board already the regular damage) stays bare. The Phyrexian label goes only on a board
   where that card is on the stack or just left it. A shield's source is named only for the seat that chose it. What a
   seat played for a controlled player lasts that turn and that control, and a choice among the seat's own hand cards
   is its own.
6. Verifier round 2 (source and tests only): the kept amount is said only when the shield that answer put first is
   known and is its own (Reflect Damage first), or is a shield chosen this turn for a different source; Circle of Protection: Red put
   first on the same attacker leaves Reflect Damage unapplied, and the loss stays bare. A choice among a controlled
   player's hand cards is that player's (`AI 1 (you control): Mind Rot: discard a card`).
