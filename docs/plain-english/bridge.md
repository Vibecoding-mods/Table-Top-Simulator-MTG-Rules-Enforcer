# bridge/bridge.js in plain English

The bridge is the program that sits between the Tabletop Simulator table and the Forge rules engine. The table tells it
what the players click; the engine tells it what is happening in the game and what it needs to ask. The bridge turns the
engine's questions into the buttons the players see, sends their answers back, and draws the board on the table.

This file explains, without code, what the bridge does. It starts with the features added between 2026-11-18 and
2026-11-24; older features are described in [docs/our-code-reference.md](../our-code-reference.md) section 3 (the
technical reference) and in the feature specs under `docs/`.

## Formats and ban lists (2026-11-18 to 11-19)

The host picks a format on the table's Format button (Modern, Pauper Commander, Vintage and so on). When a player presses
READY, the bridge checks their deck against that format: the deck's size and shape, how many copies of each card, and
whether any card is banned, restricted or simply not legal there. A deck that fails is told exactly which cards are the
problem. The ban lists come from Scryfall, refreshed once a day and kept on disk; without them, Standard falls back to
Forge's own list and other formats say they could not be checked.

The host can switch off "banned cards" (so a banned card is allowed) and "restricted cards". A deck is remembered as
ready only for the exact rules it was checked under. If the host changes the format or a switch, or the daily refresh
changes a ban list, a deck checked before is no longer ready: the player is told and presses READY again. A player who
joins a game already running keeps the deck they readied, even if the list was refreshed in between, as long as their
deck still passed the new list. The game log's last line names the format ("Game over: Blue won (Modern)").

The format's name is read the same way everywhere: "Pauper Commander", "pauper commander" and "paupercommander" are one
format, both for the deck check and for the ban-list count the table's Banned list button shows.

## Taxes button (2026-11-23)

Some cards make other players pay or let them off: Rhystic Study, Smothering Tithe, Esper Sentinel, Mystic Remora.
Each time, the player is asked "Pay {1}?". The Taxes button lets a player answer those questions once and for all:
always pay (and the payment is made with Auto-pay), never pay, or ask each time. It only answers another player's
question; a player's own card (their Mystic Remora's upkeep cost) is always asked. Changing the setting while such a
question is open answers that question at once. The setting is kept from game to game, and the table repeats it to a
restarted bridge. If the player rewinds the game, a pending "pay this with Auto-pay" is forgotten with the rest.

## The trigger-loop shortcut (2026-11-23 to 11-24)

Some card pairs trigger each other forever (Sanguine Bond with Exquisite Blood). Clicking through every trigger is
tedious, so when the same trigger has gone on the stack three times in one step, all from one player, the bridge offers
that player "Run the loop how many times?" (x10, x100, x1000, all, a number, or answer as usual). The player answers the
loop's question once; the bridge gives the same answer on each later pass.

Everyone else is asked to accept: all of it, fewer, or no. A player who accepts has their priority passed for them, but
only while nothing but the loop's own triggers is new on the stack, and only for as many passes as they accepted. The run
stops at the smallest number anyone accepted. It also stops, and says how many times it ran, when a different spell or
ability goes on the stack (someone responded), the step changes, the game ends, the engine's "this turn passed the limit"
question comes up, or a player types `mtg stop`. A loop that was stopped or declined is not offered again in that step.
For an AI's loop, the other players get "Pass for this loop" instead.

Triggers that come from casting spells are not counted (that is a different rule, CR 732.4), and the same trigger twice on
the stack at once (three creatures entering together) is a batch, not a loop. An Undo forgets the loop and the counting.

## Repeat xN (fixes, 2026-11-24)

"Repeat xN" replays a whole sequence of plays (a combo that comes back to the same board). Two fixes: a sequence that ends
with mana abilities (sacrificing the tokens it made for mana) is still offered, because the sequence began before those
abilities; and the engine's runaway-limit question is never recorded as a step of the sequence, so repeating it no longer
stopped at once.

## Exile link (2026-11-24)

When one card exiles another, the table can lay the exiled card beside the card that exiled it, as Oblivion Ring's prisoner
or a hideaway land's hidden card. The engine names the "exiler" for every exile, though, so The Wandering Emperor's
permanent exile was laid next to her as if she held it. Now the link is shown only when it matters: the card comes back
when the exiler leaves, the player may play it through the exiler, or the exiler's own text talks about what it exiled
("cards exiled with", "until ... leaves the battlefield", hideaway, imprint, cage counters). Everything else goes to the
exile pile. If the exiler's text cannot be read (it is face down), the link is kept.

## Proliferate picks (2026-11-20)

When a player proliferates, the bridge pre-ticks the choices that help them: their own +1/+1 or loyalty counters, an
opponent's -1/-1 or poison counters. Choices that would hurt them, or that it can't judge (time counters, a card with one
good and one bad counter), are left unticked. The player can still change any of them.

## Sacrifice X for mana (2026-11-18)

With several alike sources that sacrifice themselves for mana (five Treasures, three Eldrazi Spawn), the player gets one
"Sacrifice X" button instead of clicking each one: it asks which colour (when there is a choice) and how many, then
sacrifices them one after another, answering each "Sacrifice Treasure?" for the player. Any unexpected question stops the
run and says how many were not sacrificed.

## Smaller changes (2026-11-19 to 11-23)

- A deck's size counts the cards the engine doesn't know: an unknown card is still a card in the deck.
- A harmless bot passes its priority through its own whole turn in one answer, which makes big boards faster.
- Bolas's Citadel and similar: the top card of the player's library they may look at is shown to them even when they
  can't play it right now.
- Zimone and Dina's "Search your hand?" now says "Put a land card from your hand onto the battlefield tapped?".
- A spell still being cast whose target isn't chosen yet reads "a copy of its target (not chosen yet)" instead of "a copy of .".

## Mana you can take back

When a player tapped a land and hasn't spent the mana, the engine lets them untap it ("mana back"). The bridge then asks
them at a priority it would otherwise pass for them, so they don't lose the mana. The passes the player asked for
themselves (End turn, Resolve all, `mtg skip`, Auto-resolve, a repeat or loop they accepted) still pass. Whether mana is
unspent is read from the mana pool, because the engine's undo list can be out of date.

## Attack all split evenly (2026-11-25)

When more than 10 of a player's creatures can attack, the attack question has a third quick choice after All attack:
"Attack all split evenly". It sends every creature that can attack, including ones that must attack, and shares them
out over the opponents it can attack. Each opponent gets the same number of creatures, give or take one, and inside
that the power is kept as even as it can be: the biggest creature goes first, each to the opponent with the least
power so far. A creature that can attack only one opponent goes to that one. Planeswalkers and battles are left out,
except for a creature that can attack nothing else. Nothing more is asked ("whom?" is skipped). It is checked like All
attack: a limit such as Crawlspace stops it with a message that names "Attack all split evenly", and an attack tax is
still asked. Once sent, chat says the split, for example "Split evenly: 6 at Blue (14 power), 6 at Red (13 power).".
