# Hand test: hp-21 "Keywords 19" (40 cards)

Played 2026-10-29, seat White (kit "Test 21: Keywords 19" by tmp/kit-21-direct.lua), against `mtg start 1` with
`mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws; actions through the table's functions (tmp/act.js).
Same TTS session as hp-18 onward (~83,000 loaded objects, no crash).

Covers: Prowl, Increment, Recruit, Radiance, Addendum, Provoke, Ingest, Amplify, Dethrone, Escalate, Storied, Time
Travel, Forage, Chroma, Cohort.

## Worked
- Escalate (Collective Resistance): only the creature mode had a target, so Forge asked no modes; the hexproof target.
- Amplify (Kilnmouth Dragon): Scourge of the Throne revealed, "enters the battlefield with 3 +1/+1 counters".
- Addendum (Unbreakable Formation) in the main phase: a +1/+1 counter on each creature.
- Increment (Pensive Professor): a counter when a spell's mana spent was more than its power or toughness.
- Radiance (Bathe in Light): Kenrith's colour shared, protection from red.

## Findings and fixes (bridge/bridge.js)
1. Collective Resistance's target read "choose a target" (several target sentences). Fixed: a modal spell's chosen
   modes, which Forge adds after its list and a blank line, are the target's words: "which creature gains hexproof and
   indestructible until end of turn?".
2. Amplify's pick read "Kilnmouth Dragon: choose cards (up to 1)". Fixed: "amplify 3: reveal which Dragon cards from
   your hand?" with "It enters with 3 +1/+1 counters for each." under it.
3. Radiance's target read "choose a target": its sentence was over the 90-character cap. Fixed: up to 130 characters
   ("which creature and each other creature that shares a color with it gain protection from the chosen color until
   end of turn?"); Pack's Disdain in the recorded dump now reads "which creature gets -1/-1 until end of turn for each
   permanent of the chosen type you control?" too.
4. "choose a Protection" over colours. Fixed: "Bathe in Light: protection from which color?".
Not tested: Prowl, Recruit, Provoke, Ingest, Dethrone, Escalate's mode choice (only one mode was legal), Storied, Time
Travel, Forage, Chroma, Cohort.
Tests: 629 bridge scenarios. Mutation pass tmp/mut31.js: 5/6; the escape (Amplify over cards not in the hand) is now
an input: 6/6.

## Gap fill (2026-10-30)
Kit "Gap 21" (tmp/handplay/gap-21.json) against ai_gap_spells (mono-blue, image 8b8d6ff33d14). Every keyword left over
from the first run was played live.

Played:
- Storied: Kíli the Resourceful with Kenrith and The Queen of Dale out: an enduring story (Forge's
  `hasEnduringStory`).
- Chroma: Springjack Shepherd made one Goat per {W} in my permanents' mana costs (5 Goats).
- Cohort: Munda's Vanguard tapped with Changeling Outcast (an Ally by changeling): a +1/+1 counter on each creature.
- Ingest: Benthic Infiltrator connected; the AI exiled its top card.
- Dethrone: Scourge of the Throne attacked at the AI's life ≥ mine: its counter and the extra combat (a second
  attackers question).
- Prowl: after Rogues dealt combat damage, Notorious Throng for its prowl cost in main 2: 15 Faerie Rogue tokens and
  the extra turn (White's turn followed White's turn).
- Time Travel: The Tenth Doctor's attack exiled Gilded Goose with 3 time counters and suspend; {7}: time travel three
  times, each "Remove one": the last counter's suspend trigger cast the Goose free.
- Escalate's mode choice: Rancor on a creature, a Food out; Collective Resistance with all three modes ("choose 1 to
  3"), each target asked by the mode it fits.
- Forage: Camellia's {2}, Forage paid by sacrificing the Goose's Food (Camellia's Squirrel trigger beside it).
- Recruit: the AI had only Islands, so Kenrith's {3}{U} made it draw; it cast Fading Hope (bouncing Scourge of the
  Throne), The Queen of Dale recruited: drew, discarded Eladamri's Call, a Human Soldier token.
- Provoke: the AI cast Talrand; Goblin Grappler attacked and provoked it: Talrand blocked, both died.

Findings and fixes (bridge/bridge.js):
1. Storied's enduring story showed nowhere. Fixed: "White has an enduring story" in the log once, and the table's
   player rows carry `story` and `blessed` (the city's blessing), shown as ENDURING STORY / CITY'S BLESSING by
   tools/engine-renderer.lua.
2. Cohort read sixteen "gets a +1/+1 counter" lines. Fixed: one line per number of counters, with counts ("Munda's
   Vanguard, Goat Token ×5 each get a +1/+1 counter").
3. Time Travel's card read "choose up to 1 card". Fixed: "time travel: add or remove a time counter on which card?";
   its add or remove read "choose what to do with 'Time' counter on Gilded Goose?": now "add or remove a time counter
   on Gilded Goose?" with Add one / Remove one.
4. Collective Resistance with three modes read "choose a target". Fixed: the chosen modes Forge lists after the card
   text are the target's words, each target by the mode its candidates fit.
5. Forage as a cost read "Camellia, the Seedmiser: Forage?". Fixed: "forage to pay for it (exile three cards from your
   graveyard or sacrifice a Food)?"; its way, asked under the harness's Add Counter / Remove Counter buttons: "sacrifice a
   Food, or exile three cards from your graveyard?".
6. The Tenth Doctor's ability read "Timey-Wimey — {7}: Timey-Wimey — {7}: Time travel ..." everywhere (its script gives
   the words in PrecostDesc and again in SpellDescription; one other card, a Parley one, does the same). Fixed: the
   Forge-text cleanup drops an ability word (and cost) given twice.
7. Provoke's target read "provoke: you may have which creature defending player controls untap and block it if
   able?". Fixed: "Goblin Grappler: provoke: which creature untaps and must block it?".
8. Provoke's "you may" on resolution read "have target creature defending player controls untap ...": the pick was over
   30 s old (the Doctor's reveal came between). Fixed: the trigger's targets are read off the stack, where it stays while
   it resolves: "have Talrand, Sky Summoner untap and block it if able?".
9. The Doctor's attack trigger read "White uses The Tenth Doctor's ability". Fixed: a flavor word with "-", "'" or "!"
   is an ability word too: "The Tenth Doctor's allons-y triggers".
10. The Doctor's exile-until read "White looked at a card (their library)", hiding a face-up exile; discover and
    cascade read the same. Fixed: "White exiles from the top of their library (The Tenth Doctor): Diabolic Tutor".
11. The suspended card read "Diabolic Tutor is exiled". Fixed: "Diabolic Tutor is exiled suspended with 3 time
    counters: White may cast it without paying its mana cost when the last is removed".

12. Ingest's exile read "Island is exiled". Fixed: a hidden card exiled, up to what left its owner's library for no
    hand, is from that library, one line per owner: "Island ×2, Opt are exiled from AI 1's library" (a plotted card
    and a spell off the stack keep their own lines).

Open:
- Prowl wasn't offered the first time (only Benthic Infiltrator, a Merfolk Rogue, had dealt combat damage); it was
  offered once a Faerie Rogue token had hit too. Unexplained.
- Storied's log line and table rows are golden-tested only: the bridge running this game predates them.
- Recruit's discard reads "The Queen of Dale: discard a card" (its card text, shown with it, says the rest).

Tests: 823 bridge scenarios, 24 bridge claims, 192 table checks, 4 table games (re-recorded: a line number in a mocked
error moved with the renderer edit). Mutation pass tmp/mut53.js over fixes 1-11: 26 mutations, 3 escaped (12%, SOUND),
each closed with an input (a provoke card's other target; another card's trigger on the stack with no pick known; time
counters without suspend) and re-run caught (tmp/mut53b.js 3/3). tmp/mut54.js over fix 12: 9 mutations, 2 escaped
(a plotted card, a spell off the stack), both added to the scenario and caught (tmp/mut54b.js 2/2).
