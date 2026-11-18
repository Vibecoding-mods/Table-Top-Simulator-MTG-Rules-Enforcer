# Hand test: Mairsil, the Pretender (the user's deck, 2026-11-18)

Deck: the user's 100-card Mairsil list (Grixis cage/clone/steal), loaded from a temporary preset
`decks/user_mairsil_1118.json` (not committed). White = the deck vs three Forge AIs, debug scenarios
`scenarios/mairsil-1.json` .. `mairsil-7.json` (25 floating mana, cards put in hand/battlefield/graveyard):

1. cage: Mairsil cages Kiki-Jiki from the graveyard and uses Pestermite's/Kiki's abilities once a turn; Necrotic Ooze;
   Patchwork Crawler
2. clones: Clone, Phantasmal Image, Phyrexian Metamorph, Spark Double, Mocking Doppelganger, Cackling Counterpart,
   Rite of Replication (kicked), Saw in Half, Mirage Mirror, Fable of the Mirror-Breaker
3. graveyard: Entomb, Buried Alive, Body Double, Dimir Doppelganger, Lazav, Volrath's Shapeshifter, Animate Dead,
   Reanimate, Insurrection, Crawlspace
4. giving away: Illusions of Grandeur, Donate, Harmless Offering, Exchange of Words, Kitnap, Demonic Pact,
   Perplexing Chimera, Phyrexian Dreadnought, Bazaar Trader
5. goad: Coercive Impetus, Disrupt Decorum, The Rani, Deadpool, Agitator Ant, Life of the Party, Propaganda,
   Collective Restraint
6. spells: Rhystic Study, Helm of the Host, Brainstorm, Ponder, Fact or Fiction, Faithless Looting (and flashback),
   Diabolic Tutor, Cryptic Command, Cyclonic Rift (overload), Long River's Pull
7. lands and rocks: Watery Grave, Temple of Deceit, Dimir Aqueduct, Foreboding Ruins, Sol Ring, Arcane Signet,
   Dimir Signet, Talisman of Dominance

## What worked (rules and look)

Mairsil's cage (Kiki-Jiki tucked under it) and the once-a-turn limit (no second use after Pestermite untapped it);
Necrotic Ooze gaining and losing graveyard abilities (all graveyards); Patchwork Crawler; Red Death's goad ("Goaded
by White"); Clone, Spark Double (non-legendary Mairsil with its own cage trigger), Phantasmal Image, Metamorph,
kicked Rite of Replication (×5 COPY), Cackling Counterpart with the legend rule, Saw in Half, Fable chapters I-III
(Reflection of Kiki-Jiki), Mirage Mirror, Mocking Doppelganger; Entomb and Buried Alive searches, Body Double,
Dimir Doppelganger, Volrath's Shapeshifter (and dying as a 0/0 under a Phantasmal Image), Animate Dead (tucked under
the creature, "Owned by AI 3"), Reanimate, Insurrection (20+ creatures, haste, all
returned at end of turn); Donate, Harmless Offering, Bazaar Trader (cards move to the new controller's side), Kitnap
("3 Stun" badge, tapped, "Owned by AI 1"), Exchange of Words ("Text changed" with the swapped text), Perplexing
Chimera both ways, Phyrexian Dreadnought's sacrifice; Disrupt Decorum ("Goaded by White" on every opponent creature),
Coercive Impetus' attack draw, Agitator Ant, Life of the Party tokens, Deadpool's text swap, Rottenmouth Viper's
choices; Rhystic Study, Brainstorm, Fact or Fiction piles, Faithless Looting flashback (exiled after), Cryptic Command
modes (counter mode left out with an empty stack), Cyclonic Rift overload (tokens cease to exist), Diabolic Tutor
search with the filter, Watery Grave, Temple scry, Dimir Aqueduct bounce, Foreboding Ruins reveal, the rocks.

## Bugs found (numbered as found)

Answers and panels

1. Mairsil with a delayed trigger ("At end step: sacrifice Pestermite" label) on it: the label covers the card's
   upper half and catches clicks meant for the card when it is a target.
3. Clicking an opponent's card to answer a choice works but also prints "[MTG] You can only touch your own cards."
4. Mairsil's cage choice mixes hand and graveyard cards: only the hand cards glow; the graveyard ones have no list,
   picture or hint (bridge pileChoices needs every option in a pile). Reachable only through Choices.
10. Dimir Doppelganger's graveyard target (9 candidates) said "Click a glowing card" with nothing glowing and no
    panel, while Animate Dead (12 candidates) opened the Engine panel.
13. The Choices search box keeps the last text ("Serra", "Illus", "Flashback", "Overload") on the next question,
    while the list under it is unfiltered.
14. Volrath's Shapeshifter's "{2}: Discard a card" cost (an exact pick of 1): Choices Done, the corner "1 of 1
    chosen" button and clicking the hand card never sent an answer; only dragging the card onto the graveyard did.
    (A discard for Rottenmouth Viper through Choices worked: the cost path is the broken one.)
16. Not a table bug: my Done click for Reanimate hit the panel's Cancel button, and the table sent exactly a cancel.
    A list pick now answers on the click, so there is no Done to aim for.
20. A card's action panel (bottom right) stays up with "Answer the open question first" after the question is
    answered (Bazaar Trader, Mirage Mirror).
26. The corner button cuts long labels: "Sacrifice a nonland p...", "Pay Reveal a Swamp or...".

Placement and look

5. Two caged cards (Kiki-Jiki, Red Death) tucked under Mairsil overlap and are mostly hidden; Red Death, caged by the
   Spark Double copy, was drawn under the original Mairsil.
6. Caged cards in the exile pile show nothing of the cage counter or that they still give abilities.
7. Rite of Replication shows the card back in the kicker question and preview before it reaches the stack.
9. Static goad is never shown: Mocking Doppelganger's same-name goad, Coercive Impetus (and the other Impetus
   auras), Mark of the Rani. game.goaded is only filled from resolved goad spells and abilities.
12. The tie banner ("AI 1 can't lose the game ... a forced tie") sits over the top row of White's battlefield for the
    rest of the game, and over the title of every centre question (reveal, Kitnap's gift, Chimera).
25. An Aura controlled by one player on another player's creature is placed wrong: AI 3's Coercive Impetus on AI 1's
    Craw Wurm (x -26.5) was drawn on top of the neighbouring Universal Automaton (x -28.4, y 1.17, on top instead of
    tucked); White's Mark of the Rani token on AI 2's Craw Wurm lies loose on White's side (10.6, -14.6).

Text and log

2. Pestermite's "may" is titled "Tap or untap Mairsil?" with Yes/No and then asked again with Tap/Untap.
8. A token's trigger line is cut at the comma in its name: "Mairsil, the Pretender token's ability triggers
   (White): the Pretender enters, ...".
11. "Abyssal Persecutor is exiled from White's graveyard by Dimir Doppelganger with Abyssal Persecutor" is garbled.
17. Lists of names that contain commas are ambiguous ("White puts Body Double, Deadpool, Trading Card, Kiki-Jiki,
    Mirror Breaker into their graveyard"), and long lists are not grouped: Disrupt Decorum's goad line lists 30+
    names one by one, Insurrection's end logs 25 separate "AI n gains control of X from White" lines without a cause
    (its start already groups "Craw Wurm ×10").
19. Donate's and Harmless Offering's preview reads "White gains control of (nothing)" before the targets are chosen;
    the gaining player is the target player/opponent.
22. A copy is listed under the copied name only: Phyrexian Dreadnought's sacrifice list showed Phantasmal Image as
    "Craw Wurm 6/4" (the log says "Craw Wurm (Phantasmal Image)").
23. The Choices header names the turn by seat colour ("Red's 4th turn", "Blue's 7th turn") while the top bar says
    "AI 1'S TURN".
24. Forge's object number leaks into a title: "Perplexing Chimera: Change targets of Murderous Compulsion (177)?".
27. Deadpool's text swap shows "Chose 1 card" on the card, and the log has no line for the swap.
29. Fact or Fiction's piles are buttons with cut text only ("-- Pile 1 (2 cards) -- Necrotic Ooze Thought"), no
    pictures.
30. Not logged: Cryptic Command's "tap all creatures your opponents control", Perplexing Chimera giving White the
    spell (only the Chimera's move is logged).
33. Foreboding Ruins: "Pay Reveal a Swamp or Mountain card from your hand" (the button reads "Pay Reveal").

Library order

28. Probably a real rules-visible bug: after Brainstorm put Cryptic Command and Diabolic Tutor on top, Ponder showed
    "Island, Diabolic Tutor, Cryptic Command" as "top card first"; "Keep this order" then drew the Island, and Fact
    or Fiction next revealed Diabolic Tutor, Cryptic Command. So either the list is shown bottom-first or "Keep this
    order" reverses it. To confirm with a test before fixing.

Engine

31. Long River's Pull with its gift promised should be able to counter any spell; with only a noncreature spell on
    the stack the table said "can't be cast right now (no legal targets)". Check Forge's gift/target handling.

Minor, not fixed: cards I dropped at the same spot stack (my test's drop helper); "Serra Angel blocks Serra Angel"
has no owners; Fable chapter II logged no discard choice; Brainstorm's question says "up to 2".

## Outcome (2026-11-18)

Fixed on four branches, merged into local main 7f32845; not yet deployed or re-tested live.

- Answers and panels (fix/mairsil-answers): 4, 10, 13, 14 (the one dead end found is closed; the live failure was not
  reproduced in tests), 16 (list picks answer at once).
- Placement and look (fix/mairsil-look): 1 (a click on a label chooses the card under it; the label still covers it),
  5, 6, 9 (Life of the Party's tokens are not derived), 12 (the banner becomes a strip under the turn bar with a close
  button), 25, 26 (two-line corner labels). Not fixed and not reproduced on the fake table: 7 and 20.
- Text and log (fix/mairsil-text): 2, 3, 8, 11, 17, 19, 22, 23, 24, 27, 29, 30, 33.
- Library order (fix/mairsil-order): 28 was real. Forge lists the top card first and the table showed the list
  reversed; Sensei's Top had the same bug.
- Engine: 31 is fixed in engine1128-gift (cloud/gift-targets, merged), not yet built or deployed.

To re-check live after the deploy: 14, 7, 20, the tie strip, the two-line corner labels, a click on a status label,
side-by-side caged cards, caged cards beside the exile pile, static goad on an Impetus aura, Long River's Pull.

## Live re-test (2026-11-18, engine1128, table 594aef5e then 7299c332)

Seen fixed on the real table:
- 14: a pick in the Choices list sent Volrath's Shapeshifter's discard at once.
- 10: Dimir Doppelganger's graveyard target opened the picture panel.
- 11: the exile line reads cleanly.
- 2: Pestermite's may question reads "use its ability (tap or untap Plains)?".
- 23: the Choices header names the player.
- 7: Rite of Replication shows its front in the kicker question, the preview and on the stack.

New from the re-test:
- The tie strip at 114 px covered the name plate and the Scoop button. It was moved to 170 px (5bcdf31), with a test,
  and deployed in table 7299c332. Its new place is not yet seen live.
- Rite of Replication's kicker hint repeats ("Pick, then Done. Pick it, then Done."), and the preview read "a copy of ."
  before the target was chosen. Both fixed (3bac5c6): a question whose own words say "then Done" gets no second hint,
  and an empty target name falls back to the spell's text or "its target (not chosen yet)".
- The user asked that the game log not open by itself: it now stays closed until the Log button (8f8a9ec).
- Found by the user: rikrassen's importer refused DeckCheck links. They now go through the table's DeckCheck code as a
  decklist (1bc5c00, deployed in 7299c332). Its panel is not yet tried live.

Not re-checked live: 20, which was never reproduced; the corner labels and label clicks; caged cards; static goad;
Reanimate; Insurrection's grouped log; Long River's Pull. Synthetic clicks don't reach TTS unless it is the front
window, so these need a person at the table or a long scripted run.
