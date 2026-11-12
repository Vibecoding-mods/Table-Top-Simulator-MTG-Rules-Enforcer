# Debug scenarios

`mtg debug <name>` sets up `scenarios/<name>.json` through the manual fix (one `applyState` to the engine: no
triggers, state-based actions after, a restore point before). Names are lower case (chat is read lower case).
`mtg debug list` lists them, `mtg debug off` drops one waiting for the next game.

- Typed before a game: it waits for your first priority on your own turn with nothing on the stack (your opening hand
  is kept by itself). That first priority is usually your upkeep, so a sorcery-speed card waits until you pass to your
  main phase. Typed during one: at the next moment with nothing on the stack, whoever's turn it is. Against the AI it
  applies at once; other people vote.
- Every card put on the battlefield is ready (no summoning sickness), untapped unless `"tapped": true`. A planeswalker
  or battle there gets its printed loyalty or defense (an engine image from 2026-11-11 on; before it, it had none and
  died at once). Nothing else a card enters with is applied (Spike Feeder's +1/+1 counters, a Saga's lore counter, an
  "as this enters, choose" choice): the engine adds the card straight to the battlefield, as Forge's own "no triggers"
  dev-mode add does. Add counters afterwards with the manual fix.

```json
{
  "label": "what it tests",
  "lands": 20,
  "keepHand": false,
  "hand": ["Lightning Bolt", { "name": "Opt" }],
  "battlefield": [{ "name": "Goblin Guide", "tapped": true }],
  "graveyard": [], "exile": [], "library": [],
  "tokens": ["treasure", "2/2 red goblin shaman"],
  "life": 40,
  "mana": 0,
  "opponents": { "battlefield": ["Llanowar Elves"], "hand": ["Shock"], "lands": 3, "life": 40 },
  "Red": { "life": 5 }
}
```

- `lands`: a number (that many basics in your commander's colours, in turn; Wastes when it has none), a list of land
  names, or counts by name (`{ "Mountain": 10, "Island": 10 }`). Yours default to 20 when typed before a game and to
  none during one; the opponents' to none. At most 60 (of each name).
- `keepHand`: before a game, without it your dealt hand goes to the bottom of your library, so the hand is just the
  scenario's cards. During a game your hand is kept unless the file says `"keepHand": false`.
- `library`: each card goes on top, the last one named ends up first.
- `tokens`: as `mtg fix token` takes them (Forge's token scripts by colour, size and words).
- `mana`: that many of each colour (W U B R G C) until the end of the turn, as `mtg mana` (at most 99).
- `opponents`: every other player still in the game; a colour (`"Red"`) has its own part instead.
- `dungeon`: `{ "name": "Lost Mine of Phandelver", "room": "Goblin Lair" }`, in your part or a player's: that player
  is in the dungeon, in that room (no `room`: none yet, the next venture enters its first room). Room names as Forge's
  dungeon scripts have them. `completedDungeons`: a list of dungeon names that player has completed already.
- `initiative`: `"you"` or a colour (top level only): that player takes the initiative (Undercity's first room, as
  Forge's take-the-initiative does). These three need an engine image with the dungeon ops (from the planechase-1111
  build on, relay and node included); an older relay or node drops the whole change list unread, and the setup
  goes back to editing after 20 s with no answer.

A file of the wrong shape (not an object, `lands` of another kind, a zone or `tokens` that isn't a list) is refused
when typed, saying what is wrong. A choice made before a game is dropped (and said) if that colour isn't in it.
The engine refuses a name it doesn't know ("no card named ..."); the setup then goes back to editing as an ordinary
manual fix (Done applies what the table shows, Cancel ends it).
Tests: `node tests/test_bridge_debug.js` (55 checks).
