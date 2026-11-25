# tools/engine-renderer.lua, in plain English

`tools/engine-renderer.lua` is the Lua that runs inside Tabletop Simulator (TTS) and draws the engine's game onto the
table. The bridge sends it the board ("table"), the questions a player must answer ("prompt") and a few other messages.
It moves card objects, lights them up, draws the buttons and the screen panels, and turns a player's clicks back into
answers. This file explains, without code, what each part changed since 2026-11-18 does. The technical notes sit in the
comments above each function in the Lua itself.

## Formats and ban lists (2026-11-18)

The host picks a format with the Format button on the middle tile. This is where the Game mode button used to be.
A left-click goes to the next format and a right-click goes back. The host can also type `mtg format <name>`. Each
format decides the game mode, so it also decides the deck size, the starting life and whether there is a commander.
Most formats also have a ban list, which the bridge downloads. A format whose list the bridge hasn't downloaded yet is
skipped by the button, and refused with a reason when typed.

Formats with a list get a "Banned cards" switch, and the formats that also have a restricted list get a "Restricted"
switch. Only the host can flip them. A flipped switch is a house rule and shows yellow. Every change is announced to
everyone and sent to the bridge. Everyone has to press READY again, because their deck was checked under the old rules.
The "Banned list" button is for anyone: it says how many cards are banned and writes the names into a Notebook tab called
"Banned list".

The table only states the rules. The bridge checks the decks. Casual Commander, the default, sends nothing, so an older
bridge still understands the table.

## Taxes button (2026-11-22)

Beside the Fix button there is a Taxes button for each seated player. It decides how the bridge answers the other
players' "unless you pay" questions for you (Rhystic Study, Smothering Tithe and the like). Each click moves it along:
ask, then always pay, then never pay, then back to ask. Only your own button works for you. The setting goes to the
bridge whenever the table says hello.

## Look-only library top (2026-11-23)

Some cards let you look at the top of your library without letting you play it, for example Citadel's top card. That card
is shown to its owner but never gets the green "you can play this" glow.

## Players promoted before a game (2026-11-23)

Every seated player is promoted, so they can move and delete their own decks before a game too. A player the table
promoted this way still doesn't get the host-only `mtg` commands. That includes `mtg gifs on|off`, whose check is now
the same one, `engineIsHost`, which lives in `tools/make-engine-copy.js`.

## Floating mana on the original table's mana counters (2026-11-24)

The original table had a mana counter for each colour (W U B R G C) at every seat. The engine copy keeps them parked
under the table, and now uses them to show each player's floating mana instead of the small chips. Each colour has a fixed
slot on the player's life counter, so the counters don't shift around. A colour with mana shows its counter and the
number. Above 99, which is the most the original counter could show, a black box with the real amount replaces the
number. A colour at zero fades out completely. Nobody can drag or click them, because the engine owns the amount. They
are only moved, never spawned, because spawning many objects mid-game has crashed TTS. They go back under the table
when the game ends, when engine mode goes off, and when the table loads.

## Two-Headed Giant partners see each other's hand (2026-11-24)

In a shared-life team game (Two-Headed Giant, Three-Headed Giant), the table puts each side on its own TTS team
(Hearts, Clubs, ...). TTS lets teammates see each other's hands, so partners see the real cards, live. If a player can't
be put on their team, the table falls back to the old look-only copies of the partner's hand. When the game ends, the
table takes off only the teams it set itself.

## Planned attack lines (2026-11-19)

While you choose attackers, each attacker you have picked so far gets a line to whoever it will attack. The line is
drawn like a block line: solid, thin and low, in a light shade of your seat colour.

## A counterspell's target glows (2026-11-24)

When a question asks which spell or ability on the stack to target (Counterspell, Stifle), the thing that shows it on
the table glows green, like every other target, and clicking it answers. That thing is the spell's own card on the
stack, an ability's "On the stack" card, or the ability's source on the battlefield. If it is folded under the caster's
"+N more" card, it is that card. A pick in a question that takes several turns orange-gold.

The table decides which object stands for each stack item once, while it draws the stack, and the glow and the click
both read that decision. Before, the glow and the click each worked it out again for themselves.

One object can stand for several stack items, for example a "+3 more" card or a permanent with two triggers waiting. If
more than one of them is offered, clicking it can't tell which one you meant. The table then says to pick it in the
Engine panel and answers nothing, rather than guessing and countering the wrong spell.

## DeckCheck bracket label for rikrassen's importer (2026-11-24, tools/deckcheck-rik.lua)

When a deck is imported from a deckcheck.co link through rikrassen's importer, the server only ever sees a plain card
list. So the importer remembers the DeckCheck tag (bracket and threat) for that seat, and writes it into the notes of
the deck the server spawns. The renderer's bracket label reads it from there. A later import from another site clears
the tag. Only the most recent DeckCheck import from a seat may set it: an earlier one whose answer arrives late can't
put its tag on a newer deck.
