# Live checks: one debug scenario a feature group

Each scenario sets a board up at your first priority on your own turn (`mtg debug <name>` typed **before** the game;
see `README.md`). Every one was played headless on the real engine with the bridge in the loop
(`node tools/check-scenarios.js <engine tree>`). `node tests/test_bridge_scenario_checks.js` replays what happened.
"Checked headless" below says what that run showed; "On the table" is what only a real table can show.

Commands are typed in TTS chat by the host, seated (White on the four-seat table unless it says otherwise).

## (a) Rewind: `live-rewind`

```
mtg mode commander
mtg debug live-rewind
mtg start ai 1
```

- **The board:** Bitterblossom, Phyrexian Arena and Luminarch Aspirant on your battlefield, 7 lands, your hand empty.
- **On each of your turns:**
  - you lose 2 life (each upkeep);
  - you get a 1/1 Faerie Rogue token;
  - you draw an extra card;
  - Luminarch Aspirant asks which creature gets a +1/+1 counter (at the beginning of combat).
- **Play three of your turns** (answer No attacks, or attack as you like).
- **Checked headless** (a run to turn 8):

  | | Turn 2 (setup) | Turn 4 | Turn 6 | Turn 8 |
  |---|---|---|---|---|
  | Life | 40 | 40 | 38 | 36 |
  | Faeries | 0 | 0 | 1 | 2 |
  | +1/+1 counters | 0 | 1 | 2 | 3 |

  - The engine kept restore points (upkeep, main phase, attacks, second main of each turn).
  - The table's Undo got the newest 12, named "turn 7, AI 1's second main phase" and so on.
- **On the table:**
  - **Undo... → Rewind to...** lists those points, newest first.
  - Pick one from two turns back: the life total, the Faerie tokens and the counters go back to what they were then.
  - The hand, too.
  - `mtg undo 1` does the same for the last one.

## (b) Archenemy on four seats: `live-archenemy`

```
mtg mode commander
mtg archenemy White
mtg debug live-archenemy
mtg start ai 3
```

- **The setup:**
  - you are the archenemy (80 life, goes first, 20 random schemes); the others are three AI at 40;
  - the scenario adds 7 lands, a Hill Giant and a Grizzly Bears for you, and a Wall of Wood and 2 lands each for the
    others.
- **On turn 1, at your first main phase,** the engine sets the top scheme in motion.
  - Headless, it was "Chaos Is My Plaything": a card from each player's library onto the battlefield.
  - Its trigger waits on the stack for your priority, then the scheme goes back under the deck.
- **Checked headless:**
  - the engine's setInMotion event on turn 1;
  - the board the table gets while the trigger waits: schemeNow seq 1, that scheme;
  - the teams naming White the archenemy;
  - White's row marked archenemy with the scheme deck count.
- **On the table:**
  - the scheme face up and large in front of you with the SET IN MOTION banner;
  - the scheme deck stand-in beside it;
  - the next scheme on your next turn (turn 5: the three others take turns 2–4);
  - Undo off, and saying why.

## (c) Art and effects: `live-art`

```
mtg mode commander
mtg debug live-art
mtg start ai 1
```

- **The board:**
  - Huntmaster of the Fells (double-faced) on the battlefield;
  - Delver of Secrets (double-faced) and Raise the Alarm in hand;
  - a Treasure token;
  - 10 lands.
- **Cast Raise the Alarm:** two 1/1 Soldier tokens.
- **Checked headless:**
  - both double-faced cards are double-faced on the engine's board;
  - the Treasure reaches the table as a token;
  - Raise the Alarm resolved, and both Soldiers reach the table as tokens.

  The back faces' pictures and names come from Scryfall, which the harness stands in for, so they are a table check.
- **On the table:**
  - **Backs:** Huntmaster's back (Ravager of the Fells) when you flip it, and Delver's second state in your hand.
  - **Custom art:** `mtg art back Huntmaster of the Fells <link>` gives the back your own picture.
    `mtg art token Soldier <link>` before casting gives the Soldiers yours.
  - **Effects:** the GIF frame's still beside your battlefield (`mtg gif <words>`, then `mtg gifs still`), and the
    token and spell sounds as Raise the Alarm resolves (`mtg sounds on`).
  - **The Treasure:** its mana ability in your priority, "Mana: tap Treasure Token (also sacrifice this token)".

## (d) The runaway limit: `live-runaway`

```
mtg mode commander
mtg debug live-runaway
mtg start ai 1
```

- **The board:** Marauding Raptor on the battlefield, Polyraptor in hand, 10 lands (8 Forests).
- **Cast Polyraptor** ({6}{G}{G}).
  - Each Polyraptor that enters is dealt 2 damage by the Raptor, and its enrage makes a token copy: a loop with no
    choices.
  - It runs until the engine stops counting the pile and the turn passes its trigger limit.
- **Checked headless:**
  - "This turn passed the engine's limit" asked three times (Keep going / End in a draw); Keep going each time, each
    said in chat ("Blue kept the turn going past the engine's limit.");
  - then the engine stopped counting: about 500 Polyraptors flagged unbounded, sent to the table as `inf`;
  - the loop ended with the stack empty.
  - **`mtg stop` wasn't exercised headless:** the run never posted "N triggers resolve back to back … mtg stop".
- **On the table:**
  - the Polyraptor pile as one stack with **x∞**;
  - the limit question with its two buttons (End in a draw ends the game as a draw, said why);
  - while triggers resolve by themselves, `mtg stop`: "Stopped (mtg stop): the stack waits for you.", and your next
    priority with the stack full is asked.
  - It is a slow turn on a real table: give it time.

## (e) The "also costs" hover: `live-also-costs`

```
mtg mode commander
mtg debug live-also-costs
mtg start ai 1
```

- **The board:**
  - three Grizzly Bears on the battlefield;
  - 10 lands (Forest, Island, Swamp);
  - in your graveyard: Dread Return, Uro, Titan of Nature's Wrath, and five other cards.
- **Checked headless:** both are in your playable row with FROM GRAVEYARD. Their hovers say:
  - Dread Return: "Flashback also costs: sacrifice three creatures.";
  - Uro: "Escape also costs: exile five other cards from your graveyard.".
- **On the table:**
  - the FROM GRAVEYARD chip on both;
  - the hover lines above;
  - casting Dread Return asks for the three creatures to sacrifice;
  - casting Uro asks for the five cards to exile (the escape cost).

## Also here

- `hand-overflow`, `repeat-yesno`, `repeat-yesno-pay`: the "+N more in hand" card and "No ×3" (see `README.md`).
- `team-block-live`: the Two-Headed Giant team block panel. Before a 2HG game: `mtg debug team-block-live`, then
  `mtg start ai 3`, with Red your partner.
