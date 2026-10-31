# Hand test: hp-13 "Keywords 11" (40 cards)

Played 2026-10-29, seat White (kit "Test 13: Keywords 11" by tmp/kit-13-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js).
Same TTS session as hp-09 to hp-11 on NVIDIA 621.01 (~82-83k loaded objects, no crash).

Covers: Bloodthirst, Evolve, Exploit, Intimidate, Devour, Collect evidence, Hellbent, Dash, Bargain, Learn, Battalion,
Split second, Reconfigure, Prototype, Spree.

## Worked
- Bargain (Beseech the Mirror): "pay Bargain?", The Reality Chip sacrificed; the search; Gyre Sage cast for free.
- Evolve (Gyre Sage): each bigger creature entering gave it a +1/+1 counter.
- Devour (Mycoloth): Frontline Medic sacrificed, Mycoloth entered with two counters.
- Collect evidence (Analyze the Pollen): three cards exiled from the graveyard (one line); the creature-or-land search.
- Bloodthirst (Indoraptor) with no damage dealt: no counters. Exploit (Sidisi): Indoraptor sacrificed; Mikaeus's undying
  brought it back with a +1/+1 counter; Sidisi's search.
- Split second (Krosan Grip): Gibbering Descent destroyed. Learn (First Day of Class): a Forest discarded to draw.
- Intimidate (Mikaeus), Steel Seraph, Gibbering Descent cast.

## Findings and fixes (bridge/bridge.js)
1. Bargain's sacrifice read "choose a creature to sacrifice" (The Reality Chip, an artifact creature). Fixed: "Beseech
   the Mirror: sacrifice which artifact, enchantment or token (bargain)?" while the spell is cast.
2. Beseech's free cast read "Cast Gyre Sage?" Cast it | Don't cast. Fixed: "cast Gyre Sage without paying its mana
   cost?" Cast it | Put in hand (when the card goes to the hand otherwise).
3. Devour read "Mycoloth: sacrifice?". Fixed: "devour: sacrifice creatures as it enters?" Sacrifice creatures | None,
   with the counters per creature under it. Exploit the same: "Sidisi, Undead Vizier: exploit: sacrifice a creature?"
   Sacrifice one | No, with what it does when it exploits.
4. A permanent arriving with +1/+1 counters didn't say so (Mycoloth's devour, Indoraptor's undying). Fixed: "enters
   the battlefield with 2 +1/+1 counters", "returns to the battlefield from White's graveyard with a +1/+1 counter".
5. Collect evidence's cards read "choose up to 3 cards". Fixed: "collect evidence 8: exile which cards from your
   graveyard?" with "Their mana values must add up to 8 or more."
6. Analyze the Pollen's search read "choose up to 1 card" (two search sentences). Fixed: of several "search your library
   for ..." sentences, the one whose kind every offered card is (searchTheCardsFit); a creature offered: "search your
   library for which creature or land card?"; a basic land, both fit: plain.
7. Learn read "choose up to 1 card from your hand". Fixed: "learn: discard which card to draw a card?".
(Open: Steel Seraph was cast for its prototype cost with no choice: the harness gives both casts the same label, "Cast
Steel Seraph", dropping the cost that tells them apart (ActionSpace/formatActionLabel), so the bridge's ways merge them;
a fix needs a harness change and an engine image rebuild between games. Beseech's face-down exile logged "Gyre Sage is
exiled" by name before the free cast: to check whether a non-bargained Beseech names the card hidden in exile.)
Not tested: Dash, Hellbent, Battalion (Frontline Medic was devoured), Reconfigure (The Reality Chip was bargained away),
Spree (Return the Favor needs a spell or ability to copy), Intimidate evasion (the AI had no creatures).
Tests: 579 bridge scenarios. Mutation pass tmp/mut21.js: 15/17 at first; the escapes (a Bargain card on the
battlefield asking a sacrifice; a card that mentions exploiting without Exploit) are now inputs: 17/17.

## Gap fill (2026-10-30): every keyword played
Kit "Gap 13" (tmp/handplay/gap-13.json) against ai_gap_creatures. `mtg skip upkeep` (the new skip) stopped in the AI's
upkeep for the Spree test.

Played:
- Dash: "Cast Ragavan, Nimble Pilferer — dash" ("White casts Ragavan, Nimble Pilferer (dash)"), attacked: a Treasure and
  the AI's top card exiled; back to the hand at the end step.
- Spree: Return the Favor in the AI's upkeep on White's own Gibbering Descent trigger (the only legal mode, copy, taken
  without asking): the copy made the AI discard two more and lose 2 more life.
- Reconfigure: The Reality Chip attached to Kenrith ("Reconfigure {2}{U}: Attach"): "Cast Enlightened Tutor" offered
  from the top of the library; "Unattach": a 0/4 artifact creature again.
- Battalion: Frontline Medic attacking with Kenrith, Ragavan and The Reality Chip: Kenrith had indestructible.
- Hellbent: One with Nothing emptied the hand; White's next upkeep was skipped (no Gibbering Descent trigger).
- Intimidate: Mikaeus attacked unblocked past an untapped white Sisay.

Findings and fixes (bridge/bridge.js):
1. A Treasure tapped by hand while paying ("Tap Treasure Token for {R} (also sacrifice this token)") still asked
   "Sacrifice Treasure Token?". Fixed: tapping it was the choice. One auto-pay picked is still asked, by the earlier
   decision (an auto-pay must not spend a Treasure unasked).
2. "Undo mana from engine-card-143": the sacrificed Treasure was gone from every zone. Fixed: a gone card by the name
   it had this game (game.namesSeen): "Undo mana from Treasure Token".
3. The Reality Chip's top card, playable, showed nowhere on the table (only "Cast Enlightened Tutor" among the
   priority options). Fixed: a library card Forge marks playable and visible joins the owner's playable row (their own
   second hand zone).
4. An ability word's trigger ("Battalion — Whenever ...") would read "White uses Frontline Medic's ability". Fixed:
   "Frontline Medic's battalion triggers (White)" (here it resolved between two boards and wasn't seen).
Open: a copied ability (Return the Favor's copy) reads as a second trigger; Forge marks no copy on the stack.
