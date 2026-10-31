# Hand test: hp-06 "Keywords 4" (40 cards)

Played 2026-10-28 on the live table, seat White (kit "Test 06: Keywords 4" loaded by tmp/kit-06-direct.lua, made with
tmp/make-kit-direct.js), against `mtg start 1` with `mtg aideck ai_handplay_rats`, `mtg mana 99`, Kenrith draws.
From this deck on, actions are real mouse drags and clicks in the TTS window (computer use); only Kenrith's draws go
through the table's functions (tmp/act.js). The user's own deck c9e8b7 and Thantis c5b11f were moved to x=51 first
(tmp/white-deck-moved.txt): the first start picked up the user's 100-card deck instead of the kit.

Covers: Prepared, Affinity, Delirium, Suspend, Amass, Manifest, Changeling, Madness, Unearth, Domain, Explore,
Foretell, Partner with, Echo, Connive.

## Worked (by hand)
- Keep by clicking Keep; a land and three spells cast by dragging from the hand (Forest, Ledger Shredder, Alisaie,
  Kenrith from the command zone by drag), paid from the pool.
- Connive (Ledger Shredder on the second spell): drew, then the discard by clicking Emry in the hand.
- Partner with (Alisaie): the player chosen by clicking White's life counter; the search yes/no; Alphinaud isn't in
  the deck, so Forge showed the library.
- The log's turn headers: "White's turn 1" on game turn 2 (the hp-22 re-test fix).

## Findings
1. Connive's discard said "Ledger Shredder: discard a card" with nothing on the +1/+1 counter a nonland card gives.
2. Partner with's player choice read "choose a player to search their library", naming neither the partner nor that
   it's a may.
3. The search that follows read "look in your library for a card?".
4. With no Alphinaud in the library Forge showed all 30 cards as "look at these cards (your library)".
5. (table) A question answered on the table (glowing cards, life counters) showed only its title and how to click:
   the bridge's note (Connive here, and Soulbond, Bolster, Retrace, Cipher before) was only in the hidden panel.

## Fixes (bridge/bridge.js unless said)
1. "Connive: a nonland card discarded puts a +1/+1 counter on Ledger Shredder." ("the creature that connives" when
   another creature does).
2. "Alisaie Leveilleur: which player may search their library for Alphinaud Leveilleur?" with the note "Partner with:
   that player may put Alphinaud Leveilleur into their hand from their library, then shuffle."
3. "Alisaie Leveilleur: search your library for Alphinaud Leveilleur?" (the card the ability names).
4. "Alisaie Leveilleur: no Alphinaud Leveilleur in your library", the cards as "Your library, as the search saw it";
   the next card into the hand isn't marked searched.
5. A "note" field the table shows under the corner's click hint (tools/engine-renderer.lua; the hint box 70 -> 130 high);
   the bridge sets it for Connive, Partner with and every purpose with a text (Soulbond, Bolster, Retrace, Cipher).
   Not seen yet: the table script is pushed only at the end of the deck.

More worked: Karmic Guide cast by drag; its return chosen by clicking Emry's picture in the card row (the graveyard pile
glowed too); Emry's mill; the cleanup discard of 5 by clicking five hand cards, then Done (all five were picked,
though the "Chosen" message showed twice: the table doesn't repeat a message).

6. Emry's mill read as four "X is put into White's graveyard" lines.
7. Karmic Guide's echo, unpayable (one Forest), was sacrificed with no question (Forge doesn't ask then); the log said
   "White uses Karmic Guide's ability", "Karmic Guide dies".

6. Fixed: cards into a graveyard from no seen zone, up to what left the library and didn't reach the hand, are one line
   where the first was: "White mills Swamp, Swamp, Mana Confluence, Reality Shift".
7. Fixed: the echo trigger reads "Karmic Guide's echo: pay its echo cost, or it is sacrificed".

Turn 4 (by hand): Changeling (Realmwalker's creature type picked by typing "Orc" in the Engine panel's search, then
Done); a second Connive (Orcish Bowmasters as the second spell) discarding Emrakul; Madness (Emrakul cast for six {C});
Emrakul's cast trigger aimed at the AI by clicking its life counter; Bowmasters' 1 damage at the AI; Amass, which put
its counter on Realmwalker: a changeling is an Army, so no token (Forge right).

8. Madness asked "Cast Emrakul, the World Anew?" (Cast it | Don't cast): no cost, not that it goes to the graveyard.
9. After Cast it, the payment asked "Pay from mana pool" though the pool covered it (a cast from the hand pays itself);
   it also offered "Tap Forest for {G}" for a {C} cost (Forge's list; left as it is, noted).
10. Emrakul's cast trigger read "choose a player to control" (it gains control of that player's creatures).
11. Amass onto Realmwalker logged nothing; the player sees no Army and no reason.

8. Fixed: "Cast Emrakul, the World Anew for its madness cost {C}{C}{C}{C}{C}{C}?" (Cast it | To graveyard), "Madness:
   if you don't cast it now, it goes from exile to your graveyard." Seen live. (Forge's raw "Play Madness ... -
   Emrakul" still follows in the panel text.)
9. Fixed: Cast it on your own card's cast question marks the cast as started, so the pool pays it.
10. Fixed: a player question whose verb we don't know says the card's one "target player" sentence (no reminder text,
    no cost, no trigger words): "gain control of all creatures which player controls?". Seen live.
11. Fixed: "Realmwalker gets a +1/+1 counter" (a permanent gaining +1/+1 counters on the battlefield).
Mutation run tmp/mut12.js: 13/13 caught.

TTS crashed at 12:19:39 (NVIDIA reset) with 2.74/8 GB VRAM, 47°C, ~83.3k objects, 10 s after a bridge restart's full
redraw. Relaunched; after loading, the table stayed blank: TTS's "game loaded" came 3 s after the table's hello, whose
answer was lost (the hp-22 #14 cause). Fixed: the bridge resends a running game on TTS's "game loaded" (scenarios "game
loaded resends the running game", "... with no game: nothing sent"; the console line's clock is Date.now, so the
frozen test clock covers it). Also: after the relaunch TTS was full-screen and Explorer had the focus, so clicks went
nowhere until a click on the TTS window.

After the relaunch (by hand): Island and three spells by slow drags (press, move, release); Domain (Scion of Draco,
two basic types); Grave Researcher (Prepared, checked at the next upkeep); Molten Gatekeeper; Foretell (Delayed
Blast Fireball dragged: "how do you play it?" Foretell | Cast, then Foretell).

12. The Foretell button read "Foretell (During your turn, you may pay {2} and exile", cut off.
13. The game log said "White uses Delayed Blast Fireball's ability": a foretold card is face down, and the log named
    it to the table.

12. Fixed: a way's label drops a reminder sentence and keeps its cost: "Foretell (pay {2})", "Suspend 2—{1}{B}",
    "Plot"; a short tag stays ("Cast X (WebSlinging)").
13. Fixed: "White foretells a card".
Not seen live yet (the bridge isn't restarted above ~80k objects): 12, 13.

More of game 1 by hand: Suspend (Profane Tutor dragged: its only way, exiled with 2 time counters; the upkeep trigger
took it to 1), the upkeep trigger order (Keep this order), surveil keeping the top card, Foretell cast later from
exile by dragging the face-down card (5 damage, "cast from exile"). 15. The surveil card laid beside the hand set off
"Cards can't go into another player's hand" again (hp-08 #4 not fully fixed). Fixed in the table script: the guard
skips a card of that player's open scry/surveil question. 14. Suspend logged as "uses Profane Tutor's ability":
fixed, "White suspends Profane Tutor" (and Unearth: "White unearths X"). Game 1 ended by Connive drawing from an
empty library (Kenrith had drawn the deck out).

Relaunch, then game 2 (TTS reloaded with the ENGINE MODE save by hand through the Games menu: Create, Singleplayer,
Save & Load, Load; the window had come back windowed, so the click positions moved). Hint box 130: the new table script.
The game at 13:44 had been another save (old script, the user's deck on it).

By hand in game 2: Unearth (Molten Gatekeeper, dragged from the playable row on the mat; dragging the graveyard pile
does nothing), Affinity (Emry {2}{U} for {U} with two Map tokens and Gatekeeper), Explore (Map token: clicked, its
ability button cut at a word with "…" — hp-22 #15 seen live —, the creature clicked, the reveal, the graveyard
question), Manifest (Reality Shift on Gatekeeper: a face-down 2/2), Prepared (Grave Researcher with 3+ creature cards
in the graveyard: its Reanimate copy in exile and in the playable row), Madness's new wording seen live at cleanup,
the mill line seen live. Explore had no card of its own in the kit: the Map tokens from Get Lost carry it.

16. Explore's reveal read "revealed for Explore - (your library)". Fixed: Forge's trailing " - " left out.
17. "[Explore] Put Profane Tutor in your graveyard?" Yes | No. Fixed: "Explore: put Profane Tutor into your
    graveyard?" Graveyard | Keep on top, with what the explore does.
18. (deferred, design) A face-down permanent you control shows only "Face-down card / 2/2": the rules let you look at
    it; the table needs a per-player view to show it to its controller only.
19. (open, table) After Madness's "To graveyard", the table said "Look only: the engine moves cards out of the exile
    when an effect lets you" — the engine had moved it; the exile guard took that for the player's move.
20. (open, log) Prepared logged only "Reanimate is exiled".

Not tested: Delirium (Shifting Woodland was the last library card both games; Kenrith's draws took the deck).

Tests: 496 bridge scenarios; all four suites pass. (Later: the ENGINE MODE save rebuilt 15:56 with fix 15's guard;
TTS relaunched and loaded fresh before hp-02, so 15 is live from then.)

Tests: hp-06 scenarios in tests/golden/bridge-cases.js (487 in all); tests/golden/table_golden.json re-recorded for
the hint box's height (its only change). Mutation run tmp/mut11.js: 17/17 caught after three more inputs (a Partner
with card's other player question, the searched mark kept for a found card, a draw beside a graveyard card).
Shell trap seen again: a heredoc wrote "\b" as backspace characters into bridge.js (tmp/fix-bs.js replaced the two).

## Gap fill (2026-10-29): Delirium played
Kit "Gap 06" (tmp/handplay/gap-06.json), against ai_passive_lands. Expedition Map fetched Shifting Woodland (an
artifact into the graveyard), Vampiric Tutor put Traverse the Ulvenwald on top; Traverse cast without delirium offered
basic lands only; Griselbrand discarded at cleanup made four card types (artifact, instant, sorcery, creature). Shifting
Woodland's Delirium ability then offered the permanent cards in the graveyard: it became Griselbrand (7/7, "Shifting
Woodland becomes Griselbrand") and changed back at end of turn ("Griselbrand becomes Shifting Woodland").

Finding and fix (bridge/bridge.js):
1. Traverse the Ulvenwald's search read "Traverse the Ulvenwald: choose up to 1 card": both its searches ("a basic land
   card", with delirium "a creature or land card") fit the basic lands offered, and a tie said nothing. Fixed: the
   narrowest fitting kind, "search your library for which basic land card?". hp-13's Analyze the Pollen case with
   basic lands offered, whose comment already wanted this, now reads the same (it had recorded the plain title).
